import { readFileSync } from 'node:fs';
import { LANGS } from './translate.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const t = (obj, lang) => (obj && (obj[lang] || obj.ja || obj.en)) || '';

const UI_JA = {
  enter: '入る', enter_vr: 'VR で入る', rooms: '部屋で見る', contact: '作家に連絡', share: '共有', others: '他の作品',
  size: '寸法', medium: '技法', available: '販売中', sold: '売約済み', not_for_sale: '非売',
  room_cat_studio: '一人暮らしの部屋', room_cat_house: '広い家のリビング',
  rooms_note: '部屋は AI 生成のイメージ。絵は実物の写真。寸法は目安', story_note: '小さな物語', language: '言語', tap_for_size: '画像をタップすると、寸法と詳しい説明が見られます',
  gallery_title: 'ギャラリー', tagline: '絵の中に入る', privacy: '計測は Cookie なし、IP は保存しません',
  statement: '小さな絵の、奥へ。', statement_en: 'Into the depth of a small painting.',
};
const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@400;500&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300&family=Noto+Sans+JP:wght@300;400;500&display=swap">`;

// 二言語併記（美術館の作法）：言語設定に関わらず日本語と英語を並べる
const brand = (prefix) => `<a class="brand" href="${prefix}"><b>${UI_JA.tagline}</b><span class="latin">Enter the Painting</span></a>`;
const langSel = () => `<label class="lang"><span data-i18n="language">${UI_JA.language}</span> <select id="lang" aria-label="${UI_JA.language}"></select></label>`;

// 作品ページ /w/<id>/index.html。絵は JS を待たずに出る。JS は「入る」のためだけ
export function workPage({ work, space, baseUrl, allWorks }) {
  const id = work.id;
  const title = t(space.title, 'ja');
  const titleEn = t(space.title, 'en');
  const url = `${baseUrl}/w/${id}/`;
  const img = `../../works/${id}/generated/painting_1024.jpg`;
  const blur = `../../works/${id}/generated/${space.painting_blur || 'painting_1024.jpg'}`;
  const ogImg = `${baseUrl}/works/${id}/generated/painting_1024.jpg`;
  const [w, h] = work.size_cm;
  const avail = work.availability ? `<span class="avail" data-i18n="${esc(work.availability)}">${esc(UI_JA[work.availability] || '')}</span>` : '';
  // 部屋で見る：帯は全景だけ。キャプションは「部屋の種類 ─ 場所」（母語。無ければ en → ja）。比較の一文と寸法は拡大表示（page.ts）
  const caption = (m) => m ? LANGS.filter((l) => m[l]).map((l) => `<span lang="${l}" data-lang="${l}"${l === 'ja' ? '' : ' hidden'}>${esc(m[l])}</span>`).join('') : '';
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
<title>${esc(title)}${titleEn && titleEn !== title ? ` / ${esc(titleEn)}` : ''}</title>
<meta name="description" content="${esc(title)}（${w} × ${h} cm）。この絵の中に入れます。">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${w} × ${h} cm — この絵の中に入れます / Enter the painting">
<meta property="og:image" content="${ogImg}">
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary_large_image">
<meta name="work" content="${id}">
<meta name="theme-color" content="${esc(space.back_color)}">
${FONTS}
<link rel="stylesheet" href="../../src/ui/page.css">
</head>
<body style="--back:${esc(space.back_color)};--text:${esc(space.text_color)};--blur-url:url('${blur}')">
<div class="atmosphere" aria-hidden="true"></div>
<main class="work">
  <div class="top">${brand('../../')}${langSel()}</div>
  <figure class="painting" style="aspect-ratio:${w}/${h}">
    <img src="${img}" alt="${esc(title)}" fetchpriority="high">
  </figure>
  <header class="titling">
    <h1>${esc(title)}${titleEn && titleEn !== title ? `<span class="latin">${esc(titleEn)}</span>` : ''}</h1>
    <p class="meta">${work.year ? `<span>${esc(work.year)}</span>` : ''}<span>${w} × ${h} cm</span><span>${LANGS.map((l) => work.medium?.[l] ? `<span data-lang="${l}" hidden>${esc(work.medium[l])}</span>` : '').join('')}</span>${avail}</p>
  </header>
  <div class="actions">
    <button class="btn primary" id="enter" data-i18n="enter"${space.audio?.voice ? ` data-voice="../../works/${id}/${esc(space.audio.voice)}"` : ''}>${UI_JA.enter}</button>
    <button class="btn" id="enter-vr" data-i18n="enter_vr" hidden>${UI_JA.enter_vr}</button>
    <button class="btn ghost" id="share" data-i18n="share">${UI_JA.share}</button>
    ${contact}
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
function readConfig() {
  const fallback = {
    title: { ja: 'SHEER ギャラリー', en: 'SHEER Gallery' },
    greeting: { ja: ['いらっしゃいませ。', '今日は、どんな絵をお探しですか？'], en: ['Welcome.', 'What kind of painting are you looking for today?'] },
    openers: { ja: ['頑張る活力がほしい', '寂しい夜によりそってほしい', '明るい気持ちになれる絵を'] },
    persona: { name: { ja: '', en: '' }, intro_line: { ja: '', en: '' } },
  };
  try { return { ...fallback, ...JSON.parse(readFileSync(new URL('../../recommend/config.json', import.meta.url), 'utf8')) }; } catch { return fallback; }
}

// ja と en を data-lang で持つ（en は最初は隠す。page.ts が端末の言語で出し分ける。他の言語は en に落ちる）
const jaEn = (ja, en) => `<span lang="ja" data-lang="ja">${esc(ja)}</span>${en ? `<span lang="en" data-lang="en" hidden>${esc(en)}</span>` : ''}`;

// キャラクターの表情 1 枚（<picture>）。ファイル名は固定：作家が差し替える（scripts/concierge-assets.mjs が <表情>-full / -bust を作る）
// 横向き（スマホの横、PC の幅 900px 以上）は全身（full）を縦いっぱいに、それ以外は上半身（bust）。選ぶのは media query（JS ではない）
// WebP を先に、PNG を fallback に。画像は 2 組（public/concierge/artist/ と cat/）。HTML は既定の artist を書き、?chara=cat のときは page.ts が差し替える
// src/concierge/index.ts の faceEl() と同じ形にする
export const FULL_MQ = '(orientation: landscape) and (max-height: 500px), (orientation: landscape) and (min-width: 900px)';
export function facePicture(face, prefix, { on = false, priority = false, chara = 'artist' } = {}) {
  const b = `${prefix}concierge/${chara}/${face}`;
  const set = (v, ext) => `${b}-${v}.${ext} 1x, ${b}-${v}@2x.${ext} 2x`;
  return `<picture class="cg-face${on ? ' is-on' : ''}" data-face="${face}"><source media="${FULL_MQ}" type="image/webp" srcset="${set('full', 'webp')}"><source media="${FULL_MQ}" srcset="${set('full', 'png')}"><source type="image/webp" srcset="${set('bust', 'webp')}"><img src="${b}-bust.png" srcset="${set('bust', 'png')}" width="512" height="412" alt=""${priority ? ' fetchpriority="high"' : ' loading="lazy"'}></picture>`;
}

// 受付 /index.html（docs/ENTRANCE.md 3 節）。絵は出さない。見出し・キャラクター・最初の 2 文・選択肢・入力欄は JS の前に HTML で出す
export function galleryPage({ works, baseUrl }) {
  const cfg = readConfig();
  const title = cfg.title || {};
  const greet = cfg.greeting || {};
  const name = cfg.persona?.name || {};
  const intro = cfg.persona?.intro_line || {};
  const lines = [];
  if (intro.ja) lines.push([intro.ja, intro.en]);
  (greet.ja || []).slice(0, 2).forEach((ja, i) => lines.push([ja, greet.en?.[i]]));
  // 最初の文は 0.4 秒ずつ間を置いて現れる（CSS の animation-delay）
  const greeting = lines.map(([ja, en], i) => `<p class="cg-line cg-ai cg-greet" style="--d:${(0.3 + i * 0.4).toFixed(1)}s">${jaEn(ja, en)}</p>`).join('\n        ');
  const openers = (cfg.openers?.ja || []).slice(0, 3).map((ja, i) =>
    `<button type="button" class="cg-opt" data-opener-index="${i}">${jaEn(ja, cfg.openers?.en?.[i])}</button>`).join('\n          ');
  const host = name.ja ? `<figcaption class="cg-name">${jaEn(name.ja, name.en)}</figcaption>` : '';
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<title>${esc(title.ja)}${title.en ? ` / ${esc(title.en)}` : ''}</title>
<meta name="description" content="${esc(title.ja)}。気分を話すと、あなたへの 1 点をおすすめします。絵の中に入れるギャラリー">
<meta property="og:title" content="${esc(title.ja)} / ${esc(title.en)}">
<meta property="og:image" content="${baseUrl}/works/${works[0]?.id}/generated/painting_1024.jpg">
<meta property="og:url" content="${baseUrl}/">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#f6f4ef">
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
        <div class="cg-openers cg-greet" style="--d:${(0.3 + lines.length * 0.4).toFixed(1)}s" role="group" aria-label="近いものがあれば、選んでください">
          <span class="cg-openers-cap">${jaEn('近いものがあれば、選んでください', 'Pick one if it fits')}</span>
          ${openers}
        </div>
    </div>
  </section>
  <form class="cg-form" action="#concierge"><input name="q" type="text" maxlength="600" autocomplete="off" enterkeyhint="send" placeholder="こんな気分のときに、こうしたい" aria-label="こんな気分のときに、こうしたい" data-i18n-ph="cg_placeholder"><button type="submit" data-i18n="rec_send">送る</button></form>
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
<title>ギャラリー / Gallery</title>
<meta name="description" content="白い壁に、絵を実物の寸法の比で並べたギャラリー。選ぶと絵の中に入れます">
<meta property="og:title" content="ギャラリー / Gallery">
<meta property="og:image" content="${baseUrl}/works/${works[0]?.id}/generated/painting_1024.jpg">
<meta property="og:url" content="${baseUrl}/gallery/">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#f6f4ef">
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
