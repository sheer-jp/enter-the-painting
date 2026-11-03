// 長時間の構図の残り方を見る：物語モードを 1 件開き、指定秒ごとにスクリーンショット
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const out = process.argv[2] || 'shots-long';
const secs = (process.argv[3] || '6,15,30,60').split(',').map(Number);
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4174', '--strictPort'], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res) => server.stdout.on('data', (d) => { if (String(d).includes('Local')) res(); }));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 600, height: 740 } });
await page.goto('http://localhost:4174/w/harmoney/?debug=1', { waitUntil: 'load' });
await page.click('#enter');
await page.waitForSelector('#stage:not([hidden])');
const t0 = Date.now();
for (const s of secs) {
  await page.waitForTimeout(Math.max(0, t0 + s * 1000 - Date.now()));
  const dbg = await page.locator('.hud .debug').textContent().catch(() => '');
  await page.screenshot({ path: `${out}/t${s}.png` });
  console.log(`${s}s  ${dbg}`);
}
await browser.close(); server.kill();
