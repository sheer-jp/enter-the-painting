// 長時間の構図の残り方を見る：物語モードを 1 件開き、指定秒ごとにスクリーンショット
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const out = process.argv[2] || 'shots-long';
const secs = (process.argv[3] || '6,15,30,60').split(',').map(Number);
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4174', '--strictPort'], { stdio: ['ignore', 'pipe', 'inherit'], detached: true });
const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch {} };
process.on('exit', stop);
await new Promise((res, rej) => { const t0 = Date.now(); const poll = async () => { try { if ((await fetch('http://localhost:4174/')).ok) return res(); } catch {} if (Date.now() - t0 > 40000) return rej(new Error('preview')); setTimeout(poll, 500); }; poll(); });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 600, height: 740 } });
// 時計を止め、1/30 秒ずつ進める（ソフトウェア描画で 1 フレームに数秒かかっても、流体と場面の進み方は実機と同じ）。
// 実時間で見たいときは REALTIME=1。品質は Q=medium などで固定
const realtime = !!process.env.REALTIME;
if (!realtime) await page.clock.install();
await page.goto(`http://localhost:4174/w/harmoney/?debug=1${process.env.Q ? '&q=' + process.env.Q : ''}`, { waitUntil: 'load' });
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
