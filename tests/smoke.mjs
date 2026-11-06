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

// 受付（ルールだけの版。API 無し）→ 3 問 →「…考え中」→ おすすめの画面 C2（会話の中にカードは無い）→ 別のにする → 会話に戻る → もう一度見る
// → 戻るボタン → もう一度見る →「この絵の中に入る」→ S0 の帯 →「別のにする」→ 受付の再提案（C2）→ ギャラリー全体 → 1 点 → S0 → 入る → T0 →「もう一度、話す」
// docs/ENTRANCE.md 9 節の受け入れ 1、3、4、6、9。3 段の待ち時間は window.__ETP_FAST で各 100ms に縮める（時間そのものは単体テスト）
async function entranceCase(name, viewport) {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ locale: 'ja', viewport });
  await page.addInitScript(() => { window.__ETP_FAST = true; });
  const errors = collectErrors(page);
  const shot = async (n) => { if (shotsDir) await page.screenshot({ path: `${shotsDir}/${name}-${n}.png` }); };
  const c2 = page.locator('.cg2:not([hidden])');
  const c2Card = page.locator('.cg2 .cg-card');
  try {
    // C 受付：絵は出ない。見出し・キャラクター・最初の 2 文・選択肢・入力欄は HTML
    const t0 = Date.now();
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    const title = (await page.locator('.cg-title').textContent())?.trim();
    check(/SHEER ギャラリー/.test(title || '') && /SHEER Gallery/.test(title || ''), `${name}: 受付の見出し（ja / en）= ${title}`);
    const faceOk = await page.locator('.cg-faces .cg-face.is-on img').evaluate((img) => img.complete && img.naturalWidth > 0);
    check(faceOk, `${name}: キャラクターの画像が出る（${Date.now() - t0}ms）`);
    const paintings = await page.locator('img[src*="painting_"]').count();
    check(paintings === 0, `${name}: 受付には絵が出ない（${paintings}）`);
    check(await page.locator('.cg2').isHidden(), `${name}: C2 は最初は出ていない`);
    await page.waitForTimeout(1600);   // 最初の 2 文が 0.4 秒ずつ現れる
    const greet = await page.locator('.cg-thread .cg-greet.cg-line:visible').allTextContents();
    check(greet.length === 2 && greet[0].includes('ようこそ'), `${name}: 最初の 2 文（${greet.join(' / ')}）`);
    // 迎えの状態：ボタンだけ（3 つの選択肢と 4 つ目「自分のことばで書く」）。入力欄はまだ無い。キャラクターは大きい
    const openers = await page.locator('.cg-openers button[data-opener-index]:not(.cg-write)').count();
    const write = page.locator('.cg-openers .cg-write');
    check(openers === 3 && (await write.innerText()).trim() === '自分のことばで書く', `${name}: 選択肢 ${openers} 個 + 「自分のことばで書く」`);
    check(await page.locator('.cg-form').isHidden(), `${name}: 最初は入力欄が無い`);
    const lastTwo = page.locator('.cg-thread .cg-line');
    const n = await lastTwo.count();
    const thread = page.locator('.cg-thread');
    const seen = await Promise.all([inView(page, page.locator('.cg-title')), inView(page, page.locator('.cg-faces')), inView(page, lastTwo.nth(n - 2), thread), inView(page, lastTwo.nth(n - 1), thread)]);
    check(seen.every(Boolean), `${name}: 迎えの状態で見出し・キャラクター・最新 2 吹き出しが見える（${seen.join(',')}）`);
    const hostWelcome = await page.locator('.cg-host').evaluate((el) => el.getBoundingClientRect().height);
    await shot('c-first');

    // 4 つ目を押す → 会話の状態（キャラクターが縮む）。選択肢が消え、入力欄が下に出てフォーカス → 入力できる
    await write.click();
    const inputEl = page.locator('.cg-form input');
    await inputEl.waitFor({ state: 'visible', timeout: 3000 });
    await page.waitForTimeout(600);
    const focused = await inputEl.evaluate((el) => document.activeElement === el);
    const inputFs = await inputEl.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    check(focused && await page.locator('.cg-openers').count() === 0, `${name}: 「自分のことばで書く」で入力欄が出てフォーカス（選択肢は消える）`);
    check(inputFs >= 16, `${name}: 入力欄の文字 ${inputFs}px（16px 以上）`);
    const lineFs = await page.locator('.cg-thread .cg-line').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    check(lineFs >= 16, `${name}: 吹き出しの文字 ${lineFs}px`);
    const hostTalk = await page.locator('.cg-host').evaluate((el) => el.getBoundingClientRect().height);
    if (viewport.width < 768) check(hostTalk < hostWelcome * 0.6, `${name}: 会話の状態でキャラクターが小さくなる（${Math.round(hostWelcome)} → ${Math.round(hostTalk)}px）`);
    await inputEl.fill('朝、静かに始めたい');
    const lines2 = page.locator('.cg-thread .cg-line');
    const n2 = await lines2.count();
    const seen2 = await Promise.all([inView(page, page.locator('.cg-title')), inView(page, page.locator('.cg-faces')), inView(page, lines2.nth(n2 - 2), thread), inView(page, lines2.nth(n2 - 1), thread), inView(page, inputEl)]);
    check(seen2.every(Boolean) && await inputEl.inputValue() === '朝、静かに始めたい', `${name}: 会話の状態で見出し・キャラクター・最新 2 吹き出し・入力欄が同時に見える。入力できる（${seen2.join(',')}）`);
    await shot('c-write');
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1600);

    // 選択肢を押す → API が無いのでルールだけの版 → 3 問
    await page.click('.cg-openers button[data-opener-index="0"]');
    for (let i = 0; i < 3; i++) {
      const choice = page.locator('.cg-choices button').first();
      await choice.waitFor({ timeout: 15000 });
      if (i === 0) check(true, `${name}: ルールだけの版の問いが同じ画面に出る`);
      if (i === 1) await shot('c-rules');
      await choice.click();
    }
    // 3 段：読ませる（入力欄は消える）→「…考え中」→ C2
    const ponder = page.locator('.cg-thread .cg-ponder');
    await ponder.waitFor({ timeout: 3000 });
    // 100ms で消えるので、出ている間に 1 回で見る
    const ponderOk = await page.evaluate(() => { const p = document.querySelector('.cg-thread .cg-ponder'), f = document.querySelector('.cg-form'); return !p || (/考え中/.test(p.textContent || '') && f.hidden); });
    check(ponderOk, `${name}: 「…考え中」が会話の下に出る（入力欄は消える）`);
    await c2.waitFor({ timeout: 5000 });
    await c2Card.waitFor({ timeout: 5000 });
    check(await page.locator('.cg-thread .cg-card').count() === 0, `${name}: 会話の中にカードは無い（C2 に出る）`);
    check(await page.locator('.cg-thread .cg-ponder').count() === 0, `${name}: C2 が出たら「…考え中」は消える`);
    check(await page.evaluate(() => location.pathname === '/' && history.state?.cg2 === 1), `${name}: URL は / のまま、履歴に C2 を 1 つ積む`);
    await page.waitForTimeout(2600);   // くるんくるん → ピカーン → ボタン
    const presentLine = (await page.locator('.cg2-line').innerText()).trim();
    check(presentLine === 'これ、どうかな。', `${name}: C2 のひとこと = ${presentLine}`);
    const c2Face = await page.locator('.cg2-host .cg-face img').evaluate((img) => (img.currentSrc || img.src));
    check(/\/concierge\/artist\/present-bust/.test(c2Face), `${name}: C2 のキャラクターは present の上半身（${c2Face.split('/').slice(-2).join('/')}）`);
    const imgOk = await c2Card.locator('.cg-front img').evaluate((img) => new Promise((res) => {
      if (img.complete) return res(img.naturalWidth > 0);
      img.onload = () => res(img.naturalWidth > 0); img.onerror = () => res(false);
    }));
    check(imgOk, `${name}: C2 に絵が出る`);
    const head = (await c2Card.locator('.cg-card-head').textContent())?.trim();
    check(head === '今日のあなたへの 1 点', `${name}: C2 の見出し = ${head}`);
    const firstId = await c2Card.getAttribute('data-work');
    const enterHref = await c2Card.locator('.cg-enter').getAttribute('href');
    const enterText = (await c2Card.locator('.cg-enter').textContent())?.trim();
    check(enterText === 'この絵の中に入る' && new RegExp(`/w/${firstId}/\\?via=concierge$`).test(enterHref || ''), `${name}: 「${enterText}」→ ${enterHref}`);
    const heights = await c2Card.locator('.cg-enter, .cg-other, .cg-all').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    check(heights.length === 3 && heights.every((x) => x >= 44), `${name}: 3 つの選択（高さ ${heights.map(Math.round).join('/')}px）`);
    const foot = await page.locator('.cg2-foot button').allTextContents();
    check(foot.join('/') === '会話に戻る/もう一度、話す', `${name}: 下に小さく ${foot.join('・')}`);
    if (viewport.width < 768) {
      // スマホ：キャンバスは幅いっぱい（実寸比のまま）
      const fill = await page.evaluate(() => { const s = document.querySelector('.cg2 .cg-stage').getBoundingClientRect(), c = document.querySelector('.cg2-in').getBoundingClientRect(); return [Math.round(s.width), Math.round(c.width)]; });
      check(Math.abs(fill[0] - fill[1]) <= 1, `${name}: キャンバスは幅いっぱい（${fill.join(' / ')}px）`);
      const sideways = await page.locator('.cg2').evaluate((el) => [el.scrollWidth, el.clientWidth]);
      check(sideways[0] <= sideways[1], `${name}: C2 は横にスクロールしない（${sideways.join(' / ')}）`);
    } else {
      check(await inView(page, c2Card.locator('.cg-enter')), `${name}: C2 の「この絵の中に入る」が最初から見える`);
    }
    await shot('c2');
    await c2Card.locator('.cg-all').scrollIntoViewIfNeeded();
    await shot('c2-choices');

    // 「別のにする」→ C2 の中で 2 番目に近い作品に差し替え（API は呼ばない）
    await c2Card.locator('.cg-other').click();
    await page.waitForFunction((id) => { const c = document.querySelector('.cg2 .cg-card'); return c && c.dataset.work !== id; }, firstId, { timeout: 5000 });
    const secondId = await c2Card.getAttribute('data-work');
    const otherLine = (await page.locator('.cg2-line').innerText()).trim();
    check(secondId && secondId !== firstId && /こっちはどうかな/.test(otherLine) && await c2.count() === 1, `${name}: 「別のにする」で C2 の中で ${firstId} → ${secondId}（${otherLine}）`);
    await page.waitForTimeout(1800);

    // 「会話に戻る」→ 会話が残っている。入力欄は出さず、最後に「おすすめをもう一度見る」と「もう一度、話す」
    await page.locator('.cg2-foot .cg-back-talk').click();
    await page.locator('.cg2').waitFor({ state: 'hidden', timeout: 3000 });
    const kept = await page.locator('.cg-thread .cg-me').count();
    const after = await page.locator('.cg-thread .cg-after button').allTextContents();
    check(kept >= 4 && await page.locator('.cg-form').isHidden() && after.join('/') === 'おすすめをもう一度見る/もう一度、話す', `${name}: 「会話に戻る」で会話が残る（自分の吹き出し ${kept}、${after.join('・')}）`);
    await page.waitForTimeout(600);
    check(await inView(page, page.locator('.cg-after .cg-reopen'), thread), `${name}: 「おすすめをもう一度見る」が見える`);
    await shot('c-back');

    // 「おすすめをもう一度見る」→ C2（同じ 1 点）。ブラウザの戻るで会話に戻る（popstate）
    await page.locator('.cg-after .cg-reopen').click();
    await c2.waitFor({ timeout: 3000 });
    check(await c2Card.getAttribute('data-work') === secondId, `${name}: 「おすすめをもう一度見る」で C2（${secondId}）`);
    await page.goBack();
    await page.locator('.cg2').waitFor({ state: 'hidden', timeout: 3000 });
    check(new URL(page.url()).pathname === '/' && await page.locator('.cg-after .cg-reopen').count() === 1, `${name}: ブラウザの戻るで C2 を閉じて会話に戻る`);
    await page.locator('.cg-after .cg-reopen').click();
    await c2.waitFor({ timeout: 3000 });
    await page.waitForTimeout(1800);

    // 「この絵の中に入る」→ S0 の帯（?via=concierge）
    await c2Card.locator('.cg-enter').click();
    await page.waitForURL(new RegExp(`/w/${secondId}/\\?via=concierge$`), { timeout: 10000 });
    const band = page.locator('.via-band');
    await band.waitFor({ timeout: 5000 });
    const bandText = (await band.textContent())?.replace(/\s+/g, '');
    check(/今日のあなたへの1点/.test(bandText || '') && /別のにする/.test(bandText || '') && /ギャラリー全体を見る/.test(bandText || ''), `${name}: 「この絵の中に入る」→ S0 の帯（${bandText}）`);
    const bandAbove = await page.evaluate(() => { const b = document.querySelector('.via-band'), a = document.querySelector('.actions'), p = document.querySelector('.painting'); return !!b && !!a && !!p && b.getBoundingClientRect().top < a.getBoundingClientRect().top && b.getBoundingClientRect().top > p.getBoundingClientRect().top; });
    check(bandAbove, `${name}: 帯は絵の下、「入る」の上`);
    await band.scrollIntoViewIfNeeded();
    await shot('s0-band');

    // 帯の「別のにする」→ 受付で「別の絵、考えてみるね」→ 3 段 → C2 に再提案
    await band.locator('a', { hasText: '別のにする' }).click();
    await page.waitForURL(`http://localhost:${PORT}/`, { timeout: 10000 });
    await c2Card.waitFor({ timeout: 15000 });
    await c2.waitFor({ timeout: 5000 });
    const retryLine = await page.locator('.cg-line.cg-ai', { hasText: '別の絵、考えてみるね' }).count();
    const retryId = await c2Card.getAttribute('data-work');
    check(retryLine === 1 && retryId !== secondId && await page.locator('.cg-thread .cg-card').count() === 0, `${name}: ?retry で「別の絵、考えてみるね」→ C2 に ${retryId}`);
    await page.waitForTimeout(2200);
    await shot('c-retry');

    // 「ギャラリー全体を見る」→ G：6 点、おすすめが最初
    await c2Card.locator('.cg-all').click();
    await page.waitForURL(/\/gallery\/\?from=/, { timeout: 10000 });
    const items = await page.locator('.gw-item').count();
    check(items === 6, `${name}: ギャラリーに ${items} 点`);
    const firstItem = page.locator('.gw-item').first();
    const lead = await firstItem.getAttribute('data-id');
    const forYou = await firstItem.locator('.gw-foryou').isVisible();
    check(lead === retryId && forYou, `${name}: おすすめの 1 点（${lead}）が最初、「あなたへの 1 点」`);
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

    // C2 の「もう一度、話す」で最初に戻る（C2 の履歴も下ろす）
    // reduced-motion：C2 の立ち上がりはフェードだけ（時間は同じ 0.5 秒）
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`http://localhost:${PORT}/?retry=${retryId}`, { waitUntil: 'load' });
    await c2Card.waitFor({ timeout: 15000 });
    await c2.waitFor({ timeout: 5000 });
    const rm = await page.locator('.cg2').evaluate((el) => [getComputedStyle(el).animationName, getComputedStyle(el).animationDuration]);
    check(rm[0] === 'cg-fade' && rm[1] === '0.5s', `${name}: reduced-motion で C2 はフェードだけ（${rm.join(' ')}）`);
    await page.waitForTimeout(1500);
    await page.locator('.cg2-foot .cg-again:not(.cg-back-talk)').click();
    await page.locator('.cg2').waitFor({ state: 'hidden', timeout: 3000 });
    await page.waitForTimeout(300);
    check(await page.locator('.cg-openers .cg-write').isVisible() && await page.locator('.cg-form').isHidden() && await page.evaluate(() => !history.state?.cg2), `${name}: 「もう一度、話す」で最初に戻る（ボタンだけ）`);
    check(errors.length === 0, `${name}: コンソールエラー ${errors.length}${errors.length ? '\n    ' + errors.join('\n    ') : ''}`);
  } finally {
    await browser.close();
  }
}

// 合言葉（E-5）：config が passphrase: true → 最初の送信の前に 1 回だけ聞く → 403 passphrase ならルールだけの版、localStorage に残さない
async function passphraseCase() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ locale: 'ja', viewport: { width: 375, height: 667 } });
  const errors = collectErrors(page);
  let sentPass = null;
  await page.route('**/api/recommend/config', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"passphrase":true}' }));
  await page.route('**/api/recommend', (r) => { sentPass = r.request().headers()['x-passphrase'] ?? null; r.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"passphrase"}' }); });
  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    await page.click('.cg-openers .cg-write');
    await page.fill('.cg-form input', '夜に静かに見たい');
    await page.press('.cg-form input', 'Enter');
    await page.locator('.cg-line.cg-ai', { hasText: '合言葉、教えてもらえる' }).waitFor({ timeout: 8000 });
    const type = await page.locator('.cg-form input').getAttribute('type');
    check(type === 'password', `passphrase: キャラクターが合言葉を聞く（入力欄 ${type}）`);
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/sp-c-passphrase.png` });
    await page.fill('.cg-form input', 'not-the-word');
    await page.press('.cg-form input', 'Enter');
    await page.locator('.cg-choices button').first().waitFor({ timeout: 8000 });
    const kept = await page.evaluate(() => localStorage.getItem('etp.passphrase'));
    check(sentPass === 'not-the-word' && kept === null, `passphrase: X-Passphrase で送り、403 でルールだけの版へ（保存 ${kept}）`);
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
