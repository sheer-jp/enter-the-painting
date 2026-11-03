// スモークテスト：dist をプレビューで配信し、作品ページ → 「入る」→ 物語モードが動き、コンソールエラーが 0 であることを見る。
// 使い方：npm run build && npm run smoke [-- --shots <dir>]
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');   // 事前インストール済みの Playwright を使う
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const shotsDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
const PORT = 4173;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('preview が起動しない')), 20000);
  server.stdout.on('data', (d) => { if (String(d).includes('Local')) { clearTimeout(t); res(); } });
  server.stderr.on('data', (d) => process.stderr.write(d));
});

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) failed++; };

async function runCase(name, { webgl = true, lang = 'ja', query = '' } = {}) {
  const browser = await chromium.launch({ args: webgl ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--disable-webgl', '--disable-webgl2'] });
  const page = await browser.newPage({ viewport: { width: 420, height: 800 }, locale: lang });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  const t0 = Date.now();
  await page.goto(`http://localhost:${PORT}/w/harmoney/${query}`, { waitUntil: 'load' });
  const imgOk = await page.locator('.painting img').evaluate((img) => img.complete && img.naturalWidth > 0);
  check(imgOk, `${name}: 絵が JS を待たずに出る（${Date.now() - t0}ms）`);
  const enterText = await page.locator('#enter').textContent();
  check(enterText && enterText.trim().length > 0, `${name}: 「入る」の文言 = ${enterText?.trim()}`);
  await page.click('#enter');
  await page.waitForSelector('#stage:not([hidden])', { timeout: 15000 });
  await page.waitForTimeout(4000);
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/${name}-T0.png` });
  await page.waitForTimeout(5000);
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/${name}-T2.png` });
  await page.waitForTimeout(8000);
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/${name}-T3.png` });
  const floatText = await page.locator('.float-text').textContent().catch(() => '');
  check(!!floatText, `${name}: 文字が出ている（${floatText?.slice(0, 20)}）`);
  const hasCanvas = await page.locator('#stage canvas').count();
  check(webgl ? hasCanvas === 1 : true, `${name}: canvas ${hasCanvas}`);
  // 閉じる
  await page.click('.hud .close');
  await page.waitForTimeout(500);
  const hidden = await page.locator('#stage').evaluate((el) => el.hidden);
  check(hidden, `${name}: 閉じると作品ページに戻る`);
  const fatal = errors.filter((e) => !/favicon|ERR_BLOCKED|AudioContext|autoplay|play\(\) failed|NotAllowedError/i.test(e) && !(!webgl && /WebGL context/i.test(e)));
  check(fatal.length === 0, `${name}: コンソールエラー ${fatal.length}${fatal.length ? '\n    ' + fatal.join('\n    ') : ''}`);
  await browser.close();
}

try {
  await runCase('story', { webgl: true, lang: 'ja', query: '?from=qr' });
  await runCase('story-en', { webgl: true, lang: 'en-US' });
  await runCase('static-fallback', { webgl: false, lang: 'ja' });
  // ギャラリー
  const browser = await chromium.launch();
  const page = await browser.newPage({ locale: 'fr' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  const items = await page.locator('.item').count();
  check(items >= 1, `gallery: 作品 ${items} 点`);
  const h1 = await page.locator('h1').textContent();
  check(h1?.includes('Entrer'), `gallery: フランス語設定でフランス語（${h1}）`);
  check(errors.length === 0, `gallery: エラー ${errors.length}`);
  await browser.close();
} catch (e) {
  console.error(e); failed++;
} finally {
  server.kill();
}
console.log(failed ? `\n${failed} 件失敗` : '\nすべて通過');
process.exit(failed ? 1 : 0);
