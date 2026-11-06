// 気分から絵をすすめる（docs/RECOMMEND.md 8.3）：public/catalog.json を作る
// ブラウザ（ルールだけの版）と Worker（system prompt）が同じものを読む。実行時に読む唯一のカタログ
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { luminance } from './color.js';
import { translateAll, LANGS } from './translate.js';

const LOW_SAT = 0.15;   // これより彩度が低い色は色相を持たないとみなす
const round2 = (v) => Math.round(v * 100) / 100;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * "#rrggbb" → { rgb: [0..255]×3, h: 0..360, s: 0..1, l: 0..1 }（HSL）
 * @param {string} hex
 */
export function hexToHsl(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0, s = 0;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
  }
  return { rgb, h, s: clamp01(s), l };
}

/**
 * 主要色から 3 軸（0〜1）を計算する（docs/RECOMMEND.md 8.3 の式）
 * @param {string[]} palette "#rrggbb" の配列
 * @param {number[]} [weights] 各色の重み（無ければ等分）
 * @param {number} [vorticity] space.json の渦の強さ（0〜1）。あれば energy に半分混ぜる
 * @returns {{ warmth: number, brightness: number, energy: number }}
 */
export function axesFromPalette(palette, weights, vorticity) {
  if (!palette?.length) return { warmth: 0.5, brightness: 0.5, energy: 0.5 };
  const cols = palette.map(hexToHsl);
  const ws = weights?.length === palette.length ? weights.map((w) => Math.max(0, +w || 0)) : palette.map(() => 1);
  const total = ws.reduce((a, b) => a + b, 0) || 1;
  let warm = 0, lum = 0, sat = 0, vx = 0, vy = 0, hueW = 0;
  cols.forEach((c, i) => {
    const w = ws[i] / total;
    // 橙 40° で 1、青 220° で 0。灰色は 0.5
    warm += w * (c.s < LOW_SAT ? 0.5 : 0.5 + 0.5 * Math.cos(((c.h - 40) * Math.PI) / 180));
    lum += w * luminance(c.rgb);
    sat += w * c.s;
    // 色相の散らばり：灰色は色相が定まらないので入れない
    if (c.s >= LOW_SAT) {
      const a = (c.h * Math.PI) / 180;
      vx += w * Math.cos(a); vy += w * Math.sin(a); hueW += w;
    }
  });
  const spread = hueW > 0 ? 1 - Math.hypot(vx, vy) / hueW : 0;
  let energy = 0.6 * sat + 0.4 * spread;
  if (typeof vorticity === 'number' && Number.isFinite(vorticity)) energy = 0.5 * energy + 0.5 * clamp01(vorticity);
  return { warmth: round2(clamp01(warm)), brightness: round2(clamp01(Math.sqrt(lum))), energy: round2(clamp01(energy)) };
}

// 訳の関数 tr（translateAll の戻り値）から、文の並びを言語ごとの配列にする
// ある言語で 1 つでも欠けたら、その言語は en（無ければ ja）に落とす
/**
 * @param {Array<Record<string, string>>} items 各文の { ja, en, ... }
 * @returns {Record<string, string[]>}
 */
export function perLangList(items) {
  if (!items.length) return { ja: [] };
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const l of LANGS) if (items.every((t) => t[l])) out[l] = items.map((t) => t[l]);
  const base = out.en || out.ja;
  if (base) for (const l of LANGS) if (!out[l]) out[l] = base;
  return out;
}

// 1 つの文を 10 言語にそろえる（欠けた言語は en、無ければ ja）
/**
 * @param {Record<string, string>} t
 * @returns {Record<string, string>}
 */
export function perLangText(t) {
  /** @type {Record<string, string>} */
  const out = {};
  const base = t.en || t.ja;
  for (const l of LANGS) if (t[l] || base) out[l] = t[l] || base;
  return out;
}

// 作品の気分の言葉：work.json の moods.ja が正 → generated/moods.json（下書き）→ キーがあれば Claude で下書き → 空
async function moodsFor(work, space, gen, apiKey) {
  if (Array.isArray(work.moods?.ja) && work.moods.ja.length) return { ja: work.moods.ja, en: work.moods.en };
  const path = join(gen, 'moods.json');
  if (existsSync(path)) {
    const m = JSON.parse(readFileSync(path, 'utf8'));
    if (Array.isArray(m.ja) && m.ja.length) return m;
  }
  if (!apiKey) return { ja: [] };
  const { draftMoods } = await import('./claude.js');
  const messages = (space.messages || []).map((m) => m.ja).filter(Boolean);
  const m = await draftMoods({ title: space.title?.ja || work.id, messages, palette: space.palette || [] }, apiKey);
  writeFileSync(path, JSON.stringify(m, null, 2) + '\n');
  console.log(`  [${work.id}] 気分の言葉を下書きした → generated/moods.json（作家が work.json の moods に移して直す）`);
  return m;
}

// 1 作品分のカタログの項目
async function catalogWork(root, id, apiKey) {
  const dir = join(root, 'works', id);
  const gen = join(dir, 'generated');
  const work = JSON.parse(readFileSync(join(dir, 'work.json'), 'utf8'));
  const space = JSON.parse(readFileSync(join(gen, 'space.json'), 'utf8'));
  const vort = space.motion?.vorticity ?? space.fluid?.vorticity;

  const moodsSrc = await moodsFor(work, space, gen, apiKey);
  /** @type {Record<string, string[]>} */
  let moods = { ja: [] };
  if (moodsSrc.ja.length) {
    // 気分の言葉は 1 語ずつ別の文として、作品の訳キャッシュに乗せる
    const texts = moodsSrc.ja.map((ja, i) => ({ ja, en: moodsSrc.en?.[i] }));
    const tr = await translateAll(texts, join(gen, 'translations.json'), { apiKey });
    moods = perLangList(texts.map((t) => ({ ...tr(t.ja), ja: t.ja, ...(t.en ? { en: t.en } : {}) })));
  }

  const msgs = (space.messages || []).map(({ at, ...langs }) => langs);
  // 向く人・時間（work.json の moods.fit）。ja / en だけ。訳さない。無ければ省略
  const f = work.moods?.fit;
  const fit = f && typeof f.ja === 'string' && f.ja ? { ja: f.ja, ...(typeof f.en === 'string' && f.en ? { en: f.en } : {}) } : null;
  return {
    id,
    title: space.title || { ja: id },
    size_cm: space.size_cm ?? work.size_cm ?? null,
    size_label: space.size_label ?? work.size_label ?? null,
    year: space.year ?? work.year ?? null,
    availability: space.availability ?? work.availability ?? null,
    palette: space.palette || [],
    axes: axesFromPalette(space.palette || [], space.palette_weights, vort),
    moods,
    ...(fit ? { fit } : {}),
    messages: msgs.length ? perLangList(msgs) : { ja: [] },
    story: space.story || null,
    image: `works/${id}/generated/painting_1024.jpg`,
    url: `w/${id}/`,
  };
}

/**
 * カタログ全体を組み立てる（space.json がある作品すべて）
 * @param {string} root リポジトリのルート
 * @param {{ apiKey?: string }} [opts]
 */
export async function buildCatalog(root, { apiKey = process.env.ANTHROPIC_API_KEY } = {}) {
  const cfgPath = join(root, 'recommend', 'config.json');
  const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};
  const intro = cfg.intro || { ja: '' };
  const openers = cfg.openers || { ja: [] };

  // 作家の紹介と最初の選択肢を訳す（recommend/translations.json。ja のハッシュがキー、en は作家の訳）
  const texts = [];
  if (intro.ja) texts.push({ ja: intro.ja, en: intro.en });
  (openers.ja || []).forEach((ja, i) => texts.push({ ja, en: openers.en?.[i] }));
  let tr = (/** @type {string} */ _ja) => /** @type {Record<string, string>} */ ({});
  if (texts.length) tr = await translateAll(texts, join(root, 'recommend', 'translations.json'), { apiKey });
  const full = (t) => ({ ...tr(t.ja), ja: t.ja, ...(t.en ? { en: t.en } : {}) });

  const worksDir = join(root, 'works');
  const ids = existsSync(worksDir) ? readdirSync(worksDir).filter((d) => existsSync(join(worksDir, d, 'generated', 'space.json'))).sort() : [];
  const works = [];
  for (const id of ids) works.push(await catalogWork(root, id, apiKey));

  const turns = Array.isArray(cfg.turns) && cfg.turns.length === 2 ? cfg.turns.map((n) => Math.max(1, Math.round(+n) || 1)) : [2, 4];
  return {
    version: 1,
    artist: { intro: intro.ja ? perLangText(full(intro)) : { ja: '' } },
    openers: perLangList((openers.ja || []).map((ja, i) => full({ ja, en: openers.en?.[i] }))),
    turns: [Math.min(turns[0], turns[1]), Math.max(turns[0], turns[1])],
    works,
  };
}

/**
 * public/catalog.json を書く（npm run generate の最後に呼ぶ）
 * @param {string} root
 */
export async function writeCatalog(root) {
  const catalog = await buildCatalog(root);
  mkdirSync(join(root, 'public'), { recursive: true });
  writeFileSync(join(root, 'public', 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
  console.log(`カタログ：${catalog.works.length} 作品 → public/catalog.json`);
  return catalog;
}
