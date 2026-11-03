import { LANGS } from './translate.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const t = (obj, lang) => (obj && (obj[lang] || obj.ja || obj.en)) || '';

const UI_JA = {
  enter: '入る', enter_vr: 'VR で入る', rooms: '部屋で見る', contact: '作家に連絡', share: '共有', others: '他の作品',
  size: '寸法', medium: '技法', available: '販売中', sold: '売約済み', not_for_sale: '非売',
  rooms_note: '部屋は AI 生成のイメージ。絵は実物の写真。寸法は目安', story_note: '物語', language: '言語',
  gallery_title: 'ギャラリー', tagline: '絵の中に入る', privacy: '計測は Cookie なし、IP は保存しません',
};

// 作品ページ /w/<id>/index.html。絵は JS を待たずに出る。JS は「入る」のためだけ
export function workPage({ work, space, baseUrl, allWorks }) {
  const id = work.id;
  const title = t(space.title, 'ja');
  const titleEn = t(space.title, 'en');
  const url = `${baseUrl}/w/${id}/`;
  const img = `../../works/${id}/generated/painting_1024.jpg`;
  const ogImg = `${baseUrl}/works/${id}/generated/painting_1024.jpg`;
  const [w, h] = work.size_cm;
  const avail = work.availability ? `<span class="avail" data-i18n="${esc(work.availability)}">${esc(UI_JA[work.availability] || '')}</span>` : '';
  const rooms = (space.rooms || []).map((r) => `
      <figure class="room">
        <img src="../../works/${id}/generated/${esc(r.image)}" alt="${esc(title)} を部屋に置いたイメージ（AI 生成の部屋）" loading="lazy">
        <figcaption><span data-i18n="rooms_note">${UI_JA.rooms_note}</span>${r.wall_width_cm ? `（<span data-i18n="wall_note" data-i18n-w="${(r.wall_width_cm / 100).toFixed(1)}">壁幅 約 ${(r.wall_width_cm / 100).toFixed(1)} m として合成</span>）` : ''}</figcaption>
      </figure>`).join('');
  const story = space.story ? `
    <section class="story">
      <h2><span data-i18n="story_note">${UI_JA.story_note}</span></h2>
      ${LANGS.map((l) => space.story[l] ? `<p lang="${l}" data-lang="${l}" hidden>${esc(space.story[l])}</p>` : '').join('')}
    </section>` : '';
  const others = allWorks.filter((o) => o.id !== id).map((o) => `
      <a class="other" href="../${o.id}/"><img src="../../works/${o.id}/generated/painting_1024.jpg" alt="${esc(t(o.title, 'ja'))}" loading="lazy"><span>${esc(t(o.title, 'ja'))}</span></a>`).join('');
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
<link rel="stylesheet" href="../../src/ui/page.css">
</head>
<body style="--back:${esc(space.back_color)};--text:${esc(space.text_color)}">
<main class="work">
  <a class="back" href="../../" data-i18n="gallery_title">${UI_JA.gallery_title}</a>
  <figure class="painting" style="aspect-ratio:${w}/${h}">
    <img src="${img}" alt="${esc(title)}" fetchpriority="high">
  </figure>
  <header>
    <h1>${esc(title)}${titleEn && titleEn !== title ? `<small>${esc(titleEn)}</small>` : ''}</h1>
    <p class="meta">${work.year ? `${esc(work.year)} · ` : ''}${w} × ${h} cm · ${LANGS.map((l) => work.medium?.[l] ? `<span data-lang="${l}" hidden>${esc(work.medium[l])}</span>` : '').join('')} ${avail}</p>
  </header>
  <div class="actions">
    <button class="btn primary" id="enter" data-i18n="enter"${space.audio?.voice ? ` data-voice="../../works/${id}/${esc(space.audio.voice)}"` : ''}>${UI_JA.enter}</button>
    <button class="btn" id="enter-vr" data-i18n="enter_vr" hidden>${UI_JA.enter_vr}</button>
    <button class="btn ghost" id="share" data-i18n="share">${UI_JA.share}</button>
    ${contact}
    <label class="lang"><span data-i18n="language">${UI_JA.language}</span> <select id="lang"></select></label>
  </div>
  ${rooms ? `<section class="rooms"><h2 data-i18n="rooms">${UI_JA.rooms}</h2><div class="strip">${rooms}</div></section>` : ''}
  ${story}
  ${others ? `<section class="others"><h2 data-i18n="others">${UI_JA.others}</h2><div class="strip">${others}</div></section>` : ''}
  <footer><small data-i18n="privacy">${UI_JA.privacy}</small></footer>
</main>
<div id="stage" hidden></div>
<script type="module" src="../../src/page.ts"></script>
</body>
</html>
`;
}

// ギャラリー /index.html。作品を実物の寸法比で並べる
export function galleryPage({ works, baseUrl }) {
  const maxW = Math.max(...works.map((w) => w.size_cm[0]), 1);
  const items = works.map((w) => {
    const rel = Math.max(0.18, w.size_cm[0] / maxW);   // 最小でも 18%（小品が消えないように）
    return `
    <a class="item" href="w/${w.id}/" style="--rel:${rel.toFixed(3)};aspect-ratio:${w.size_cm[0]}/${w.size_cm[1]}">
      <img src="works/${w.id}/generated/painting_1024.jpg" alt="${esc(t(w.title, 'ja'))}" loading="lazy">
      <span class="cap">${esc(t(w.title, 'ja'))}<small>${w.size_cm[0]} × ${w.size_cm[1]} cm</small></span>
    </a>`;
  }).join('');
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>絵の中に入る</title>
<meta name="description" content="小さな絵の中に入れるデジタルギャラリー">
<meta property="og:title" content="絵の中に入る / Enter the painting">
<meta property="og:image" content="${baseUrl}/works/${works[0]?.id}/generated/painting_1024.jpg">
<meta property="og:url" content="${baseUrl}/">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="src/ui/page.css">
</head>
<body class="gallery-body">
<main class="gallery">
  <header><h1 data-i18n="tagline">${UI_JA.tagline}</h1><label class="lang"><span data-i18n="language">${UI_JA.language}</span> <select id="lang"></select></label></header>
  <div class="wall">${items}</div>
  <footer><small data-i18n="privacy">${UI_JA.privacy}</small></footer>
</main>
<script type="module" src="src/page.ts"></script>
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
