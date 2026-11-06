import { readFileSync } from 'node:fs';
import { LANGS } from './translate.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const t = (obj, lang) => (obj && (obj[lang] || obj.ja || obj.en)) || '';

const UI_JA = {
  enter: '絵の世界をのぞく', enter_vr: 'VR でのぞく', enter_note: '色が動き出し、作家の言葉が流れます（約 2 分）', rooms: '部屋で見る', contact: '作家に連絡', share: '共有', others: '他の作品',
  size: '寸法', medium: '技法', available: '販売中', sold: '売約済み', not_for_sale: '非売',
  room_cat_studio: '一人暮らしの部屋', room_cat_house: '広い家のリビング',
  rooms_note: '部屋は AI 生成のイメージ。絵は実物の写真。寸法は目安', story_note: '小さな物語', language: '言語', tap_for_size: '画像をタップすると、寸法と詳しい説明が見られます',
  gallery_title: 'ギャラリー', tagline: '絵の中に入る', privacy: '計測は Cookie なし、IP は保存しません',
  statement: '小さな絵の、奥へ。', statement_en: 'Into the depth of a small painting.',
};
const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@400;500&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300&family=Noto+Sans+JP:wght@300;400;500&display=swap">`;

// 10 言語ぶんの data-lang の span（ja だけ最初から見せる。page.ts の applyLang が端末の言語で出し分け、無い言語は en → ja に落ちる）
const multi = (m) => m ? LANGS.filter((l) => m[l]).map((l) => `<span lang="${l}" data-lang="${l}"${l === 'ja' ? '' : ' hidden'}>${esc(m[l])}</span>`).join('') : '';
// size_label・medium は文字列のこともある（古い形）。そのときは ja として出す
const asMulti = (v) => typeof v === 'string' ? { ja: v } : v;

// 二言語併記（美術館の作法）：言語設定に関わらず日本語と英語を並べる
const brand = (prefix) => `<a class="brand" href="${prefix}"><b>SHEER Gallery</b></a>`;   // 11-06 深夜：受付と同じギャラリー名に統一
const langSel = () => `<label class="lang"><span data-i18n="language">${UI_JA.language}</span> <select id="lang" aria-label="${UI_JA.language}"></select></label>`;

// ja と en が同じ（または en が無い）なら 1 回だけ。違えば「ja / en」（11-07 作家：「SHEER Gallery / SHEER Gallery」と同じ語を 2 回並べない）
export const jaEnTitle = (ja, en) => (en && en !== ja ? `${ja} / ${en}` : (ja || en || ''));
export const SITE_NAME = 'SHEER Gallery';
// ファビコン・マニフェスト（E-16）。prefix は受付 ''、ギャラリー '../'、作品 '../../'（base: './' の相対で、置き場のパスに依存しない）
const headIcons = (prefix) => `<link rel="icon" href="${prefix}favicon.svg" type="image/svg+xml">
<link rel="icon" href="${prefix}favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="${prefix}apple-touch-icon.png">
<link rel="manifest" href="${prefix}site.webmanifest">
<meta name="theme-color" content="#ffffff">`;
// SNS カード（OGP 1200×630。画像は scripts/generate/og.js が合成）。URL は BASE_URL の絶対
const headOg = ({ type = 'website', title, description, image, url }) => `<meta property="og:type" content="${type}">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${image}">`;
const RECEPTION_DESC = '彩り美しい抽象画の世界を届けます。会話で、今日のあなたへの 1 点を。';

// 作品ページ /w/<id>/index.html。絵は JS を待たずに出る。JS は「入る」のためだけ
export function workPage({ work, space, baseUrl, allWorks }) {
  const id = work.id;
  const title = t(space.title, 'ja');
  const titleEn = t(space.title, 'en');
  const url = `${baseUrl}/w/${id}/`;
  const img = `../../works/${id}/generated/painting_1024.jpg`;
  const blur = `../../works/${id}/generated/${space.painting_blur || 'painting_1024.jpg'}`;
  const ogImg = `${baseUrl}/works/${id}/generated/og.png`;
  const pageTitle = `${jaEnTitle(title, titleEn)} — ${SITE_NAME}`;
  const [w, h] = work.size_cm;
  const avail = work.availability ? `<span class="avail" data-i18n="${esc(work.availability)}">${esc(UI_JA[work.availability] || '')}</span>` : '';
  // 部屋で見る：帯は全景だけ。キャプションは「部屋の種類 ─ 場所」（母語。無ければ en → ja）。比較の一文と寸法は拡大表示（page.ts）
  const caption = multi;
  const rooms = (space.rooms || []).map((r, i) => `
      <figure class="room" data-room-index="${i}">
        <img src="../../works/${id}/generated/${esc(r.image)}" alt="${esc(title)} を${esc(t(r.label, 'ja'))}に置いたイメージ（AI 生成の部屋）" loading="lazy">
        <figcaption>${r.category ? `<span data-i18n="room_cat_${esc(r.category)}">${esc(UI_JA['room_cat_' + r.category] || '')}</span> ─ ` : ''}${caption(r.label)}</figcaption>
      </figure>`).join('');
  const story = space.story ? `
    <section class="story">
      <h2 class="eyebrow"><span>Story</span><span data-i18n="story_note">${UI_JA.story_note}</span></h2>
      ${LANGS.map((l) => space.story[l] ? `<p lang="${l}" data-lang="${l}" hidden>${esc(space.story[l])}</p>` : '').join('')}
    </section>` : '';
  const others = allWorks.filter((o) => o.id !== id).map((o) => `
      <a class="other" href="../${o.id}/"><img src="../../works/${o.id}/generated/painting_1024.jpg" alt="${esc(t(o.title, 'ja'))}" loading="lazy"><b>${esc(t(o.title, 'ja'))}</b>${o.size_cm[0]} × ${o.size_cm[1]} cm</a>`).join('');
  const contact = work.contact ? `<a class="btn ghost" id="contact" href="${esc(work.contact)}" target="_blank" rel="noopener" data-i18n="contact">${UI_JA.contact}</a>` : '';
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(title)}（${w} × ${h} cm）。この絵の中に入れます。">
${headOg({ type: 'article', title: pageTitle, description: `${w} × ${h} cm — この絵の中に入れます / Enter the painting`, image: ogImg, url })}
<meta name="work" content="${id}">
${headIcons('../../')}
${FONTS}
<link rel="stylesheet" href="../../src/ui/page.css">
</head>
<body style="--blur-url:url('${blur}')">
<div class="atmosphere" aria-hidden="true"></div>
<main class="work">
  <div class="top">${brand('../../')}${langSel()}</div>
  <figure class="painting" style="aspect-ratio:${w}/${h}">
    <img src="${img}" alt="${esc(title)}" fetchpriority="high">
  </figure>
  <header class="titling">
    <h1>${esc(title)}${titleEn && titleEn !== title ? `<span class="latin">${esc(titleEn)}</span>` : ''}</h1>
    <p class="meta">${work.year ? `<span>${esc(work.year)}</span>` : ''}<span>${w} × ${h} cm</span>${(space.medium || work.medium) ? `<span>${multi(asMulti(space.medium || work.medium))}</span>` : ''}${avail}</p>
  </header>
  <div class="actions">
    <button class="btn primary" id="enter" data-i18n="enter"${space.audio?.voice ? ` data-voice="../../works/${id}/${esc(space.audio.voice)}"` : ''}>${UI_JA.enter}</button>
    <button class="btn" id="enter-vr" data-i18n="enter_vr" hidden style="display:none">${UI_JA.enter_vr}</button>
    ${contact}
    <p class="cg-enter-note" data-i18n="enter_note" style="flex-basis:100%;margin:-4px 0 0;font-size:11px;letter-spacing:.1em;color:var(--ink-2)">${UI_JA.enter_note}</p>
  </div>
  ${rooms ? `<section class="rooms"><h2 class="eyebrow"><span>Rooms</span><span data-i18n="rooms">${UI_JA.rooms}</span></h2><div class="strip">${rooms}</div><p class="rooms-hint"><span data-i18n="tap_for_size">${UI_JA.tap_for_size}</span><span data-i18n="rooms_note">${UI_JA.rooms_note}</span></p></section>` : ''}
  ${story}
  ${others ? `<section class="others"><h2 class="eyebrow"><span>Works</span><a class="eyebrow-link" href="../../gallery/" data-i18n="others">${UI_JA.others}</a></h2><div class="strip">${others}</div></section>` : ''}
  <footer><span data-i18n="privacy">${UI_JA.privacy}</span><span>© sheerarts</span></footer>
</main>
<div id="stage" hidden></div>
<script type="module" src="../../src/page.ts"></script>
</body>
</html>
`;
}

// 受付の設定（recommend/config.json）。読めなければ最小の既定値
const CONFIG_FALLBACK = {
  title: { ja: 'SHEER Gallery', en: 'SHEER Gallery' },
  greeting: { ja: ['ようこそ、SHEER のギャラリーへ。', '彩り美しい抽象画の世界を届けます。', '今日は、どんな絵を探してる？'], en: ['Welcome to SHEER\'s gallery.', 'A world of vivid abstract paintings awaits.', 'What kind of painting are you looking for today?'] },
  openers: { ja: ['頑張る活力がほしい', '寂しい夜によりそってほしい', '明るい気持ちになれる絵を'] },
  persona: { name: { ja: '', en: '' }, intro_line: { ja: '', en: '' } },
  present_line: { ja: 'これ、どうかな。', en: 'How about this one?' },
  ui_hint: { ja: '近いものがあれば、選んでください', en: 'Pick one if it fits' },
  ui_write: { ja: '自分のことばで書く', en: 'Write in my own words' },
};
function readConfig() {
  const fallback = CONFIG_FALLBACK;
  try { return { ...fallback, ...JSON.parse(readFileSync(new URL('../../recommend/config.json', import.meta.url), 'utf8')) }; } catch { return fallback; }
}

// ja と en を data-lang で持つ（en は最初は隠す。page.ts が端末の言語で出し分ける。他の言語は en に落ちる）
const jaEn = (ja, en) => `<span lang="ja" data-lang="ja">${esc(ja)}</span>${en ? `<span lang="en" data-lang="en" hidden>${esc(en)}</span>` : ''}`;

// キャラクターの表情 1 枚（<picture>）。どの画面も上半身（-bust）。全身（-full）はいまは使わない（11-06 作家：チャットの UI に人は小さめ）。ファイル名は固定：作家が差し替える（scripts/concierge-assets.mjs）
// 横向き（スマホの横、PC の幅 900px 以上）は全身（full）を縦いっぱいに、それ以外は上半身（bust）。選ぶのは media query（JS ではない）
// WebP を先に、PNG を fallback に。画像は public/concierge/artist/（女の子に確定。11-06 作家）
// src/concierge/index.ts の faceEl() と同じ形にする
export const FULL_MQ = '(orientation: landscape) and (max-height: 500px), (orientation: landscape) and (min-width: 900px)';
export function facePicture(face, prefix, { on = false, priority = false } = {}) {
  const b = `${prefix}concierge/artist/${face}`;
  const set = (v, ext) => `${b}-${v}.${ext} 1x, ${b}-${v}@2x.${ext} 2x`;
  return `<picture class="cg-face${on ? ' is-on' : ''}" data-face="${face}"><source type="image/webp" srcset="${set('bust', 'webp')}"><img src="${b}-bust.png" srcset="${set('bust', 'png')}" width="512" height="412" alt=""${priority ? ' fetchpriority="high"' : ' loading="lazy"'}></picture>`;
}

// 受付 /index.html（docs/ENTRANCE.md 3 節）。絵は出さない。見出し・キャラクター・最初の 2 文・選択肢・入力欄は JS の前に HTML で出す
export function galleryPage({ works, baseUrl }) {
  const cfg = readConfig();
  const title = cfg.title || {};
  const greet = cfg.greeting || {};
  const name = cfg.persona?.name || {};
  const intro = cfg.persona?.intro_line || {};
  const lines = [];
  if (intro.ja) lines.push([intro.ja, intro.en, null]);
  (greet.ja || []).slice(0, 3).forEach((ja, i) => lines.push([ja, greet.en?.[i], i]));   // 3 文まで（11-06 深夜：ようこそ／彩り／どんな絵）
  // 最初の文は 0.4 秒ずつ間を置いて現れる（CSS の animation-delay）。data-greet は catalog.json の greeting の何番目か（他の言語の差し替え用）
  const greeting = lines.map(([ja, en, gi], i) => `<p class="cg-line cg-ai cg-greet"${gi === null ? '' : ` data-greet="${gi}"`} style="--d:${(0.3 + i * 0.4).toFixed(1)}s">${jaEn(ja, en)}</p>`).join('\n        ');
  const hint = cfg.ui_hint?.ja ? cfg.ui_hint : CONFIG_FALLBACK.ui_hint;
  const write = cfg.ui_write?.ja ? cfg.ui_write : CONFIG_FALLBACK.ui_write;
  const openers = (cfg.openers?.ja || []).slice(0, 3).map((ja, i) =>
    `<button type="button" class="cg-opt" data-opener-index="${i}">${jaEn(ja, cfg.openers?.en?.[i])}</button>`).join('\n          ')
    // 4 つ目：自分のことばで書く（押すと入力欄が出る。11-06 作家「最初の画面はボタンだけ」）。data-opener-index="write" は、
    // JS を読み込む前に押されたとき page.ts が預かって読み込み後に押し直すため（選択肢と同じ扱い）
    + `\n          <button type="button" class="cg-opt cg-write" data-opener-index="write">${jaEn(write.ja, write.en)}</button>`;
  const host = name.ja ? `<figcaption class="cg-name">${jaEn(name.ja, name.en)}</figcaption>` : '';
  const present = cfg.present_line?.ja ? cfg.present_line : CONFIG_FALLBACK.present_line;
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<title>${esc(jaEnTitle(title.ja, title.en))}</title>
<meta name="description" content="${esc(title.ja)}。気分を話すと、あなたへの 1 点をおすすめします。絵の中に入れるギャラリー">
${headOg({ title: jaEnTitle(title.ja, title.en) || SITE_NAME, description: RECEPTION_DESC, image: `${baseUrl}/og/gallery.png`, url: `${baseUrl}/` })}
${headIcons('')}
<meta name="recommend-api" content="${esc(process.env.RECOMMEND_API ?? '/api/recommend')}">
${FONTS}
<link rel="stylesheet" href="src/ui/page.css">
</head>
<body class="paper">
<main class="cg" id="concierge">
  <header class="cg-top">
    <h1 class="cg-title">${jaEn(title.ja, title.en)}</h1>
    <div class="cg-tools">${langSel()}<a class="cg-skip" href="gallery/" data-i18n="cg_skip">受付を飛ばしてギャラリーへ</a></div>
  </header>
  <figure class="cg-host">
    <div class="cg-faces" role="img" aria-label="受付のキャラクター">${facePicture('smile', '', { on: true, priority: true })}</div>
    ${host}
  </figure>
  <section class="cg-talk" aria-label="受付の会話">
    <div class="cg-thread" aria-live="polite">
        ${greeting}
        <div class="cg-openers cg-greet" style="--d:${(0.3 + lines.length * 0.4).toFixed(1)}s" role="group" aria-label="${esc(hint.ja)}">
          <span class="cg-openers-cap">${jaEn(hint.ja, hint.en)}</span>
          ${openers}
        </div>
    </div>
  </section>
  <form class="cg-form" action="#concierge" hidden><input name="q" type="text" maxlength="600" autocomplete="off" enterkeyhint="send" placeholder="こんな気分のときに、こうしたい" aria-label="こんな気分のときに、こうしたい" data-i18n-ph="cg_placeholder"><button type="submit" data-i18n="rec_send">送る</button></form>
  <section class="cg2" tabindex="-1" aria-label="今日のあなたへの 1 点" hidden>
    <div class="cg2-in">
      <div class="cg2-host" aria-hidden="true"></div>
      <p class="cg2-line">${jaEn(present.ja, present.en)}</p>
    </div>
  </section>
</main>
<script type="module" src="src/page.ts"></script>
</body>
</html>
`;
}

// ギャラリー /gallery/index.html（docs/ENTRANCE.md 4 節）。白い壁に実寸比で並べる。おすすめ（?from=<id>）は page.ts が先頭に出す
export function galleryWallPage({ works, baseUrl }) {
  const maxW = Math.max(...works.map((w) => w.size_cm[0]), 1);
  const maxH = Math.max(...works.map((w) => w.size_cm[1]), 1);
  const items = works.map((w) => {
    const [cw, ch] = w.size_cm;
    const title = t(w.title, 'ja');
    const titleEn = t(w.title, 'en');
    return `
    <a class="gw-item" data-id="${esc(w.id)}" href="../w/${esc(w.id)}/?via=gallery" style="--wcm:${cw};--hcm:${ch};--rel:${(cw / maxW).toFixed(3)}">
      <span class="gw-foryou" data-i18n="gw_for_you" hidden>あなたへの 1 点</span>
      <img src="../works/${esc(w.id)}/generated/painting_1024.jpg" alt="${esc(title)}" loading="lazy" width="${Math.round(cw * 10)}" height="${Math.round(ch * 10)}" style="aspect-ratio:${cw}/${ch}">
      <span class="gw-cap"><b>${esc(title)}</b>${titleEn && titleEn !== title ? `<i>${esc(titleEn)}</i>` : ''}<span>${cw} × ${ch} cm</span></span>
    </a>`;
  }).join('');
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>ギャラリー / Gallery — ${SITE_NAME}</title>
<meta name="description" content="白い壁に、絵を実物の寸法の比で並べたギャラリー。選ぶと絵の中に入れます">
${headOg({ title: `ギャラリー — ${SITE_NAME}`, description: '白い壁に、絵を実物の寸法の比で並べたギャラリー。選ぶと絵の中に入れます', image: `${baseUrl}/og/gallery.png`, url: `${baseUrl}/gallery/` })}
${headIcons('../')}
${FONTS}
<link rel="stylesheet" href="../src/ui/page.css">
</head>
<body class="paper">
<main class="gw">
  <div class="gw-top">
    <a class="gw-back" href="../" data-i18n="gw_back">受付に戻る</a>
    <h1 class="gw-title"><span>ギャラリー</span><span class="latin">Gallery</span></h1>
    ${langSel()}
  </div>
  <div class="gw-wall" style="--maxh:${maxH}" tabindex="0" aria-label="作品">${items}
  </div>
  <footer><span data-i18n="privacy">${UI_JA.privacy}</span><span>© sheerarts</span></footer>
</main>
<script type="module" src="../src/page.ts"></script>
</body>
</html>
`;
}

// 作品カード（名刺大 91 × 55 mm、裏面）。QR は 22mm
export function cardSvg({ work, space, qrSvgInner, url }) {
  const title = t(space.title, 'ja');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="91mm" height="55mm" viewBox="0 0 91 55" font-family="sans-serif">
  <rect width="91" height="55" fill="#fff"/>
  <g transform="translate(6 6) scale(${(22 / 100).toFixed(4)})">${qrSvgInner}</g>
  <text x="33" y="12" font-size="4.2" font-weight="bold">${esc(title)}</text>
  <text x="33" y="18" font-size="2.8" fill="#444">${work.size_cm[0]} × ${work.size_cm[1]} cm</text>
  <text x="33" y="27" font-size="3" fill="#222">この絵の中に入れます</text>
  <text x="33" y="31.5" font-size="2.6" fill="#666">Enter the painting</text>
  <text x="33" y="40" font-size="2.2" fill="#888">${esc(url)}</text>
  <text x="6" y="51" font-size="2" fill="#999">QR を読むか、URL を開いてください。音が出ます（消音でも文字で楽しめます）</text>
</svg>
`;
}
