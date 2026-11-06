// スモークテスト：dist をプレビューで配信し、作品ページ → 「入る」→ 物語モード、受付 → ギャラリー → 作品ページ（docs/ENTRANCE.md）が動き、コンソールエラーが 0 であることを見る。
// 使い方：npm run build && npm run smoke [-- --shots <dir>]
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');   // 事前インストール済みの Playwright を使う
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const shotsDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
const PORT = 4173;

// preview をプロセスグループで起動し、終わりにグループごと止める（残ったプロセスがポートを塞がないように）
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
server.stderr.on('data', (d) => process.stderr.write(d));
const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch {} };
process.on('exit', stop); process.on('SIGINT', () => { stop(); process.exit(130); });
await new Promise((res, rej) => {
  const t0 = Date.now();
  const poll = async () => {
    try { const r = await fetch(`http://localhost:${PORT}/`); if (r.ok) return res(); } catch {}
    if (Date.now() - t0 > 40000) return rej(new Error('preview が起動しない'));
    setTimeout(poll, 500);
  };
  poll();
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
  // 文字が出るまで最大 20 秒待つ（文と文の間は空になる）
  let floatText = '';
  for (let i = 0; i < 40 && !floatText; i++) {
    await page.waitForTimeout(500);
    floatText = await page.locator('.float-text').evaluate((el) => (getComputedStyle(el).opacity !== '0' ? el.textContent : '')).catch(() => '');
  }
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/${name}-T3.png` });
  // 触れる：なぞる（流れ）とタップ（波紋）。エラーが出ないこと
  await page.mouse.move(120, 300); await page.mouse.down(); for (let i = 1; i <= 8; i++) { await page.mouse.move(120 + i * 25, 300 + i * 30); await page.waitForTimeout(30); } await page.mouse.up();
  await page.mouse.click(300, 500);
  await page.waitForTimeout(600);
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/${name}-touch.png` });
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

// コンソールエラーの数え方：vite preview には Pages Functions が無いので、/api/ への要求は 404 などで失敗し、
// Chromium はそれを「Failed to load resource」のエラーとして出す（受付はそれを受けてルールだけの版に落ちる。想定どおり）。
// 文言ではなく、エラーの出どころの URL が /api/ のものだけを除く
function collectErrors(page) {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const where = m.location()?.url || '';
    if (/\/api\//.test(where) && /Failed to load resource/i.test(m.text())) return;
    errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

// 要素が画面の中に収まっているか。吹き出しは会話の欄（スクロールする）の中に収まっていることも見る
async function inView(page, locator, clip = null) {
  const vp = page.viewportSize();
  const b = await locator.boundingBox();
  if (!b || b.height <= 0) return false;
  const box = clip ? await clip.boundingBox() : { x: 0, y: 0, width: vp.width, height: vp.height };
  const top = Math.max(0, box.y), bottom = Math.min(vp.height, box.y + box.height);
  return b.y >= top - 1 && b.x >= -1 && b.y + b.height <= bottom + 1 && b.x + b.width <= vp.width + 1;
}

// 受付（ルールだけの版。API 無し）→ 3 問 → カード → 別のにする → ギャラリー全体 → 1 点 → S0 → 入る → T0。作品ページの帯 →「別のにする」→ 受付の再提案
// docs/ENTRANCE.md 9 節の受け入れ 1、3、4、6
async function entranceCase(name, viewport) {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ locale: 'ja', viewport });
  const errors = collectErrors(page);
  const shot = async (n) => { if (shotsDir) await page.screenshot({ path: `${shotsDir}/${name}-${n}.png` }); };
  try {
    // C 受付：絵は出ない。見出し・キャラクター・最初の 2 文・選択肢・入力欄は HTML
    const t0 = Date.now();
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    const title = (await page.locator('.cg-title').textContent())?.trim();
    check(/ようこそ、SHEER のギャラリーへ/.test(title || '') && /Welcome to SHEER/.test(title || ''), `${name}: 受付の見出し（ja / en）= ${title}`);
    const faceOk = await page.locator('.cg-face.is-on img').evaluate((img) => img.complete && img.naturalWidth > 0);
    check(faceOk, `${name}: キャラクターの画像が出る（${Date.now() - t0}ms）`);
    const paintings = await page.locator('img[src*="painting_"]').count();
    check(paintings === 0, `${name}: 受付には絵が出ない（${paintings}）`);
    await page.waitForTimeout(1600);   // 最初の 2 文が 0.4 秒ずつ現れる
    const greet = await page.locator('.cg-thread .cg-greet.cg-line:visible').allTextContents();
    check(greet.length === 2 && greet[0].includes('いらっしゃいませ'), `${name}: 最初の 2 文（${greet.join(' / ')}）`);
    const openers = await page.locator('.cg-openers button[data-opener-index]').count();
    check(openers === 3, `${name}: 選択肢 ${openers} 個`);
    const inputFs = await page.locator('.cg-form input').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    check(inputFs >= 16, `${name}: 入力欄の文字 ${inputFs}px（16px 以上）`);
    const lastTwo = page.locator('.cg-thread .cg-line');
    const n = await lastTwo.count();
    const thread = page.locator('.cg-thread');
    const seen = await Promise.all([inView(page, page.locator('.cg-title')), inView(page, page.locator('.cg-faces')), inView(page, lastTwo.nth(n - 2), thread), inView(page, lastTwo.nth(n - 1), thread), inView(page, page.locator('.cg-form input'))]);
    check(seen.every(Boolean), `${name}: 見出し・キャラクター・最新 2 吹き出し・入力欄が同時に見える（${seen.join(',')}）`);
    await shot('c-first');

    // 選択肢を押す → API が無いのでルールだけの版 → 3 問
    await page.click('.cg-openers button[data-opener-index="0"]');
    for (let i = 0; i < 3; i++) {
      const choice = page.locator('.cg-choices button').first();
      await choice.waitFor({ timeout: 15000 });
      if (i === 0) check(true, `${name}: ルールだけの版の問いが同じ画面に出る`);
      if (i === 1) await shot('c-rules');
      await choice.click();
    }
    const card = page.locator('.cg-card');
    await card.waitFor({ timeout: 8000 });
    await page.waitForTimeout(2600);   // くるんくるん → ピカーン → ボタン
    const imgOk = await card.locator('.cg-front img').evaluate((img) => new Promise((res) => {
      if (img.complete) return res(img.naturalWidth > 0);
      img.onload = () => res(img.naturalWidth > 0); img.onerror = () => res(false);
    }));
    check(imgOk, `${name}: カードに絵が出る`);
    const head = (await card.locator('.cg-card-head').textContent())?.trim();
    check(head === '今日のあなたへの 1 点', `${name}: カードの見出し = ${head}`);
    const firstId = await card.getAttribute('data-work');
    const enterHref = await card.locator('.cg-enter').getAttribute('href');
    const enterText = (await card.locator('.cg-enter').textContent())?.trim();
    check(enterText === 'この絵の中に入る' && new RegExp(`/w/${firstId}/\\?via=concierge$`).test(enterHref || ''), `${name}: 「${enterText}」→ ${enterHref}`);
    const heights = await card.locator('.cg-enter, .cg-other, .cg-all').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    check(heights.length === 3 && heights.every((x) => x >= 44), `${name}: 3 つの選択（高さ ${heights.map(Math.round).join('/')}px）`);
    const cardSeen = await inView(page, card.locator('.cg-enter'), page.locator('.cg-thread'));
    check(cardSeen, `${name}: カードの「この絵の中に入る」が見える`);
    await shot('c-card');
    await page.locator('.cg-thread').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await shot('c-card-choices');

    // 「別のにする」→ 2 番目に近い作品に差し替え（API は呼ばない）
    await card.locator('.cg-other').click();
    await page.waitForFunction((id) => { const c = document.querySelector('.cg-card'); return c && c.dataset.work !== id; }, firstId, { timeout: 5000 });
    const secondId = await page.locator('.cg-card').getAttribute('data-work');
    const otherLine = await page.locator('.cg-line.cg-ai').last().textContent();
    check(secondId && secondId !== firstId && /こちらはどうでしょう/.test(otherLine || ''), `${name}: 「別のにする」で ${firstId} → ${secondId}（${otherLine}）`);
    await page.waitForTimeout(1800);

    // 「ギャラリー全体を見る」→ G：6 点、おすすめが最初
    await page.locator('.cg-card .cg-all').click();
    await page.waitForURL(/\/gallery\/\?from=/, { timeout: 10000 });
    const items = await page.locator('.gw-item').count();
    check(items === 6, `${name}: ギャラリーに ${items} 点`);
    const firstItem = page.locator('.gw-item').first();
    const lead = await firstItem.getAttribute('data-id');
    const forYou = await firstItem.locator('.gw-foryou').isVisible();
    check(lead === secondId && forYou, `${name}: おすすめの 1 点（${lead}）が最初、「あなたへの 1 点」`);
    const layout = await page.locator('.gw-wall').evaluate((el) => getComputedStyle(el).flexDirection);
    check(viewport.width < 768 ? layout === 'column' : layout === 'row', `${name}: ${viewport.width < 768 ? 'スマホは縦並び' : 'PC は横に長い壁'}（${layout}）`);
    await page.waitForTimeout(800);
    await shot('g-gallery');

    // 1 点を選ぶ → S0（?via=gallery、帯は出ない）→ 入る → T0
    await firstItem.locator('img').click();
    await page.waitForURL(/\/w\/[^/]+\/\?via=gallery$/, { timeout: 10000 });
    check(await page.locator('.via-band').count() === 0, `${name}: ギャラリーから来た S0 には帯が無い`);
    await page.click('#enter');
    await page.waitForSelector('#stage:not([hidden])', { timeout: 15000 });
    await page.waitForTimeout(3000);
    check(await page.locator('#stage canvas').count() === 1, `${name}: 「入る」で物語モード（T0）`);
    await shot('t0');

    // 受付から来た S0：帯「今日のあなたへの 1 点」→「別のにする」→ 受付で再提案
    await page.goto(`http://localhost:${PORT}/w/${secondId}/?via=concierge`, { waitUntil: 'load' });
    const band = page.locator('.via-band');
    await band.waitFor({ timeout: 5000 });
    const bandText = (await band.textContent())?.replace(/\s+/g, '');
    check(/今日のあなたへの1点/.test(bandText || '') && /別のにする/.test(bandText || '') && /ギャラリー全体を見る/.test(bandText || ''), `${name}: S0 の帯（${bandText}）`);
    const bandAbove = await page.evaluate(() => { const b = document.querySelector('.via-band'), a = document.querySelector('.actions'), p = document.querySelector('.painting'); return !!b && !!a && !!p && b.getBoundingClientRect().top < a.getBoundingClientRect().top && b.getBoundingClientRect().top > p.getBoundingClientRect().top; });
    check(bandAbove, `${name}: 帯は絵の下、「入る」の上`);
    await band.scrollIntoViewIfNeeded();
    await shot('s0-band');
    await band.locator('a', { hasText: '別のにする' }).click();
    await page.waitForURL(`http://localhost:${PORT}/`, { timeout: 10000 });
    await page.locator('.cg-card').waitFor({ timeout: 15000 });
    const retryLine = await page.locator('.cg-line.cg-ai', { hasText: '別の絵を考えますね' }).count();
    const retryId = await page.locator('.cg-card').getAttribute('data-work');
    check(retryLine === 1 && retryId !== secondId, `${name}: ?retry で「別の絵を考えますね」→ ${retryId}`);
    await page.waitForTimeout(2200);
    await shot('c-retry');

    // 「もう一度、話す」で最初に戻る
    await page.locator('.cg-card .cg-again').click();
    check(await page.locator('.cg-openers').isVisible() && await page.locator('.cg-form input').isVisible(), `${name}: 「もう一度、話す」で最初に戻る`);
    check(errors.length === 0, `${name}: コンソールエラー ${errors.length}${errors.length ? '\n    ' + errors.join('\n    ') : ''}`);
  } finally {
    await browser.close();
  }
}

// 合言葉（E-5）：config が passphrase: true → 最初の送信の前に 1 回だけ聞く → 403 passphrase ならルールだけの版、localStorage に残さない
// ?chara=cat：キャラクターの画像の組を切り替えて覚える
async function passphraseCase() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ locale: 'ja', viewport: { width: 375, height: 667 } });
  const errors = collectErrors(page);
  let sentPass = null;
  await page.route('**/api/recommend/config', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"passphrase":true}' }));
  await page.route('**/api/recommend', (r) => { sentPass = r.request().headers()['x-passphrase'] ?? null; r.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"passphrase"}' }); });
  try {
    await page.goto(`http://localhost:${PORT}/?chara=cat`, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    const src = await page.locator('.cg-face.is-on img').evaluate((img) => img.currentSrc || img.src);
    const stored = await page.evaluate(() => localStorage.getItem('etp.chara'));
    check(/\/concierge\/cat\//.test(src) && stored === 'cat', `chara: ?chara=cat で猫の組（${src.split('/').slice(-2).join('/')}、覚える=${stored}）`);
    await page.fill('.cg-form input', '夜に静かに見たい');
    await page.press('.cg-form input', 'Enter');
    await page.locator('.cg-line.cg-ai', { hasText: '合言葉をいただけますか' }).waitFor({ timeout: 8000 });
    const type = await page.locator('.cg-form input').getAttribute('type');
    check(type === 'password', `passphrase: キャラクターが合言葉を聞く（入力欄 ${type}）`);
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/sp-c-passphrase.png` });
    await page.fill('.cg-form input', 'not-the-word');
    await page.press('.cg-form input', 'Enter');
    await page.locator('.cg-choices button').first().waitFor({ timeout: 8000 });
    const kept = await page.evaluate(() => localStorage.getItem('etp.passphrase'));
    check(sentPass === 'not-the-word' && kept === null, `passphrase: X-Passphrase で送り、403 でルールだけの版へ（保存 ${kept}）`);
    await page.goto(`http://localhost:${PORT}/?chara=artist`, { waitUntil: 'load' });
    check(await page.evaluate(() => localStorage.getItem('etp.chara')) === 'artist', 'chara: ?chara=artist で戻す');
    check(errors.length === 0, `passphrase: コンソールエラー ${errors.length}${errors.length ? '\n    ' + errors.join('\n    ') : ''}`);
  } finally {
    await browser.close();
  }
}

try {
  await runCase('story',{ webgl: true, lang: 'ja', query: '?from=qr' });
  await runCase('story-en', { webgl: true, lang: 'en-US' });
  await runCase('static-fallback', { webgl: false, lang: 'ja' });
  // ギャラリー（フランス語の端末）
  const browser = await chromium.launch();
  const page = await browser.newPage({ locale: 'fr' });
  const errors = collectErrors(page);
  await page.goto(`http://localhost:${PORT}/gallery/`, { waitUntil: 'load' });
  const items = await page.locator('.gw-item').count();
  check(items === 6, `gallery: 作品 ${items} 点`);
  const footText = await page.locator('footer [data-i18n="privacy"]').textContent();
  check(footText?.includes('cookies'), `gallery: フランス語設定でフランス語（${footText}）`);
  check(errors.length === 0, `gallery: エラー ${errors.length}`);
  await browser.close();
  await entranceCase('pc', { width: 1280, height: 800 });
  await entranceCase('sp', { width: 375, height: 667 });
  await passphraseCase();
} catch (e) {
  console.error(e); failed++;
} finally {
  stop();
}
console.log(failed ? `\n${failed} 件失敗` : '\nすべて通過');
process.exit(failed ? 1 : 0);
