// 長時間の構図の残り方を見る：物語モードを 1 件開き、指定秒ごとにスクリーンショット
// node tests/longrun.mjs <出力先> [秒,秒,...] [作品 id]（id の既定は harmoney。環境変数 WORK でも可）
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
// --space [id,id]：VR の空間モードを平面カメラで回す検査（?space=flat、docs/VR_DEPTH.md V-4）。
// S4 に入って粒が出そろったところで、前後左右上下の 6 方向のスクリーンショットと白飛び率（RGB すべて 250 以上の画素の割合）を出す。
// 出力は OUT（既定 /Users/arisa/ai-dev/_meta/development/enter-the-painting/evidence/vr）/<id>/
const spaceMode = process.argv.includes('--space');
const args = process.argv.slice(2).filter((a) => a !== '--space');
const out = spaceMode ? (process.env.OUT || '/Users/arisa/ai-dev/_meta/development/enter-the-painting/evidence/vr') : (args[0] || 'shots-long');
const secs = (args[1] || '6,15,30,60').split(',').map(Number);
const work = args[2] || process.env.WORK || 'harmoney';
const spaceIds = (spaceMode && args[0] ? args[0] : 'harmoney,itadaki').split(',');
mkdirSync(out, { recursive: true });
// 検査モードは別のポート（物語モードの longrun と同時に回しても、相手のサーバーに当たらない）。PORT で変えられる
const port = process.env.PORT || (spaceMode ? '4175' : '4174');
const server = spawn('npx', ['vite', 'preview', '--port', port, '--strictPort'], { stdio: ['ignore', 'pipe', 'inherit'], detached: true });
const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch {} };
process.on('exit', stop);
await new Promise((res, rej) => { const t0 = Date.now(); const poll = async () => { try { if ((await fetch(`http://localhost:${port}/`)).ok) return res(); } catch {} if (Date.now() - t0 > 40000) return rej(new Error('preview')); setTimeout(poll, 500); }; poll(); });
// GPU=1：ソフトウェア描画をやめ、手元の GPU で描く（速い。時計は止めたままなので流体の進み方は同じ）
const browser = await chromium.launch(process.env.GPU ? { headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] } : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
if (spaceMode) {
  const WHITE_MAX = 0.02;
  const summary = [];
  for (const id of spaceIds) {
    const dir = `${out}/${id}`; mkdirSync(dir, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 720, height: 720 } });
    page.on('pageerror', (e) => console.log(`[${id}] pageerror ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') console.log(`[${id}] ${m.type()} ${m.text()}`); });
    await page.clock.install();
    await page.goto(`http://localhost:${port}/w/${id}/?debug=1&space=flat&q=${process.env.Q || 'medium'}`, { waitUntil: 'load' });
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 200));
    await page.click('#enter');
    // 体験のバンドルと space.json を待つ
    for (let i = 0; i < 300 && !(await page.evaluate(() => !!window.__space)); i++) { await page.clock.runFor(50); await page.waitForTimeout(100); }
    // S4 に入ってから 2.5 秒（粒のフェードイン 1.5 秒が終わる）まで、1/30 秒ずつ進める
    let s4 = -1, t = 0;
    while (t < 30000) {
      await page.clock.runFor(1000 / 30); t += 1000 / 30;
      const st = await page.evaluate(() => window.__space?.stage());
      if (st === 'S4' && s4 < 0) s4 = t;
      if (s4 >= 0 && t - s4 >= 2500) break;
    }
    if (!(await page.evaluate(() => !!window.__space))) throw new Error(`${id}: 空間モードの検査の口が無い（入れなかった、または終わった）`);
    const stage = await page.evaluate(() => window.__space?.stage());
    const res = { id, stage, sec: +(t / 1000).toFixed(1), dirs: {} };
    for (const d of ['front', 'back', 'left', 'right', 'up', 'down']) {
      const r = await page.evaluate((d) => { const s = window.__space; s.look(d); return { white: s.white(), particles: s.particlesInView(d), ...s.surround() }; }, d);
      await page.screenshot({ path: `${dir}/${d}.png`, timeout: 180000 });
      res.dirs[d] = { ...r, white: +r.white.toFixed(5) };
      console.log(`${id} ${d.padEnd(5)} white=${(r.white * 100).toFixed(3)}% particles=${r.particles} floor=${r.floor} back=${r.back}`);
    }
    // 合格：どの方向も白飛び 2% 以下、視界に粒が 1 つ以上ある（床・奥の光は全方向で出ているので参考に記録だけ）
    res.pass = Object.values(res.dirs).every((r) => r.white <= WHITE_MAX && r.particles > 0);
    writeFileSync(`${dir}/result.json`, JSON.stringify(res, null, 2));
    summary.push(res);
    await page.close();
  }
  await browser.close(); stop();
  const ok = summary.every((r) => r.pass);
  console.log(ok ? 'PASS' : 'FAIL', out);
  process.exit(ok ? 0 : 1);
}
// 画面の大きさは VIEWPORT=1280x800 などで変えられる（横長の絵の構図を広く見たいとき）
const [vw, vh] = (process.env.VIEWPORT || '600x740').split('x').map(Number);
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
// 時計を止め、1/30 秒ずつ進める（ソフトウェア描画で 1 フレームに数秒かかっても、流体と場面の進み方は実機と同じ）。
// 実時間で見たいときは REALTIME=1。品質は Q=medium などで固定
const realtime = !!process.env.REALTIME;
if (!realtime) await page.clock.install();
await page.goto(`http://localhost:${port}/w/${work}/?debug=1${process.env.Q ? '&q=' + process.env.Q : ''}`, { waitUntil: 'load' });
if (!realtime) await page.clock.pauseAt(await page.evaluate(() => Date.now() + 200));
await page.click('#enter');
// 体験のバンドルと space.json の読み込みを待つ（止めた時計を少しずつ進める）
for (let i = 0; i < 200 && !(await page.locator('#stage:not([hidden]) canvas').count()); i++) { if (!realtime) await page.clock.runFor(50); await page.waitForTimeout(100); }
const t0 = Date.now();
let t = 0;
for (const s of secs) {
  if (realtime) await page.waitForTimeout(Math.max(0, t0 + s * 1000 - Date.now()));
  else while (t < s * 1000) { await page.clock.runFor(1000 / 30); t += 1000 / 30; }
  const dbg = await page.locator('.hud .debug').textContent().catch(() => '');
  await page.screenshot({ path: `${out}/t${s}.png`, timeout: 180000 });   // ソフトウェア描画では 1 フレームが数秒かかる
  console.log(`${s}s  ${dbg}`);
}
await browser.close(); stop();
