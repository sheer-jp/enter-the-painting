// V-6 の検査：VR 空間モードの S1 → S2 → S3 を平面カメラ（?space=flat）で回し、S2 が「トンネル・穴」に見えないかを数値で見る（docs/VR_DEPTH.md 6 節）
// node tests/vr-s2.mjs [作品 id]（既定 itadaki）。先に npm run build。出力は OUT（既定 /Users/arisa/ai-dev/_meta/development/enter-the-painting/evidence/vr-s2）
// 1. spin=1（録画と同じ、カメラを左右に振る）で 1 秒ごとのスクリーンショット
// 2. spin なし（正面固定。spin は描くたびに向きを変えるので中心がずれる）で、S2 の間 0.2 秒ごとに中心 / 周辺の明るさの比、S2 の中ほどで白飛び率
// 合格：S2 の中心 / 周辺 ≥ 0.6（最小値）、白飛び ≤ 2%
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const id = process.argv[2] || 'itadaki';
const out = process.env.OUT || '/Users/arisa/ai-dev/_meta/development/enter-the-painting/evidence/vr-s2';
const port = process.env.PORT || '4181';
const RATIO_MIN = 0.6, WHITE_MAX = 0.02, FRAME = 1000 / 30;
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', port, '--strictPort'], { stdio: ['ignore', 'pipe', 'inherit'], detached: true });
const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch {} };
process.on('exit', stop);
await new Promise((res, rej) => { const t0 = Date.now(); const poll = async () => { try { if ((await fetch(`http://localhost:${port}/`)).ok) return res(); } catch {} if (Date.now() - t0 > 40000) return rej(new Error('preview')); setTimeout(poll, 500); }; poll(); });
const browser = await chromium.launch(process.env.GPU ? { headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] } : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

// 作品ページを開いて「入る」、検査の口が出るまで時計を少しずつ進める
async function open(spin) {
  const page = await browser.newPage({ viewport: { width: 720, height: 720 } });
  page.on('pageerror', (e) => console.log(`pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') console.log(`${m.type()} ${m.text()}`); });
  await page.clock.install();
  await page.goto(`http://localhost:${port}/w/${id}/?debug=1&space=flat&q=${process.env.Q || 'medium'}${spin ? '&spin=1' : ''}`, { waitUntil: 'load' });
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 200));
  await page.click('#enter');
  for (let i = 0; i < 300 && !(await page.evaluate(() => !!window.__space)); i++) { await page.clock.runFor(50); await page.waitForTimeout(100); }
  if (!(await page.evaluate(() => !!window.__space))) throw new Error('空間モードの検査の口が無い');
  return page;
}
const state = (page) => page.evaluate(() => ({ stage: window.__space.stage(), appear: window.__space.appear(), morph: window.__space.morph() }));

// 1. spin=1：1 秒ごと（S4 に入って 1 秒まで、最大 12 枚）
const shots = [];
{
  const page = await open(true);
  let t = 0, next = 0, s4 = -1;
  while (t < 15000 && shots.length < 12) {
    if (t >= next) {
      const st = await state(page);
      const name = `t${String(Math.round(t / 1000)).padStart(2, '0')}s_${st.stage}.png`;
      await page.screenshot({ path: `${out}/${name}`, timeout: 180000 });
      shots.push({ sec: +(t / 1000).toFixed(2), ...st, file: name });
      console.log(`spin ${(t / 1000).toFixed(1)}s ${st.stage} appear=${st.appear.toFixed(2)} morph=${st.morph.toFixed(2)}`);
      if (st.stage === 'S4' && s4 < 0) s4 = t;
      if (s4 >= 0 && t - s4 >= 1000) break;
      next += 1000;
    }
    await page.clock.runFor(FRAME); t += FRAME;
  }
  await page.close();
}

// 2. 正面固定：S1〜S3 の間、0.2 秒ごとに中心 / 周辺
const samples = [];
let white = null;
{
  const page = await open(false);
  let t = 0, next = 0;
  while (t < 15000) {
    await page.clock.runFor(FRAME); t += FRAME;
    const st = await state(page);
    if (st.stage === 'S4') break;
    if (t < next) continue;
    next = t + 200;
    const r = await page.evaluate(() => window.__space.luma());
    samples.push({ sec: +(t / 1000).toFixed(2), ...st, center: +r.center.toFixed(4), periphery: +r.periphery.toFixed(4), ratio: +r.ratio.toFixed(3), white: +r.white.toFixed(5) });
    console.log(`front ${(t / 1000).toFixed(1)}s ${st.stage} appear=${st.appear.toFixed(2)} center=${r.center.toFixed(3)} periphery=${r.periphery.toFixed(3)} ratio=${r.ratio.toFixed(3)} white=${(r.white * 100).toFixed(3)}%`);
    // S2 の中ほど（appear 0.4 を超えた最初）で白飛び 1 回とスクリーンショット
    if (st.stage === 'S2' && st.appear >= 0.4 && !white) {
      white = { sec: +(t / 1000).toFixed(2), appear: +st.appear.toFixed(3), ratio: +r.white.toFixed(5) };
      await page.screenshot({ path: `${out}/front_S2_mid.png`, timeout: 180000 });
    }
  }
  await page.close();
}
await browser.close(); stop();

const s2 = samples.filter((s) => s.stage === 'S2');
const ratios = s2.map((s) => s.ratio);
const res = {
  id, date: new Date().toISOString(),
  method: '中心 = 画面中央の幅・高さ 20% の箱、周辺 = 中心からの距離が半幅の 70% より外。相対輝度の平均の比。spin=1 は描くたびにカメラを振るので、比は spin なし（正面固定）で測った。品質 medium、720×720、SwiftShader、時計は 1/30 秒ずつ',
  pass_rule: `S2 の中心/周辺の最小 ≥ ${RATIO_MIN}、S2 の白飛び ≤ ${WHITE_MAX * 100}%`,
  s2: { n: s2.length, ratio_min: ratios.length ? Math.min(...ratios) : null, ratio_mean: ratios.length ? +(ratios.reduce((a, b) => a + b, 0) / ratios.length).toFixed(3) : null, white },
  pass: ratios.length > 0 && Math.min(...ratios) >= RATIO_MIN && !!white && white.ratio <= WHITE_MAX,
  samples, shots,
};
writeFileSync(`${out}/result.json`, JSON.stringify(res, null, 2));
console.log(res.pass ? 'PASS' : 'FAIL', `S2 ratio min=${res.s2.ratio_min} mean=${res.s2.ratio_mean} white=${white?.ratio}`, out);
process.exit(res.pass ? 0 : 1);
