// 受付のキャラクター画像を作る（docs/ENTRANCE.md 3.3）
// 使い方：node scripts/concierge-assets.mjs <元フォルダ> <出力フォルダ>
//   例：node scripts/concierge-assets.mjs ../../_meta/development/enter-the-painting/concept/concierge-v5/cutouts public/concierge/artist
//
// 元：全身の透過 PNG（正方形）。ポーズ 3 枚は listening / smile / present（第 4・5 案の名前 03-listening / 01-welcome-hands / 02-welcome-wave でもよい）
//     コマ（任意）：blink / wave-1 / wave-2 / smile-2（.png）。他の名前の PNG もそのまま同じ扱いで書き出す
// 出す：<名前>-full（全身）と <名前>-bust（上半身：上から 58% の高さ、横は中央 72% を切り出す）を、1x（幅 512）と @2x（幅 1024）、PNG と WebP で
//      ページは WebP を先に読み、PNG は fallback（<picture>）。差し替えるときは必ずこのスクリプトで全部を作り直す
//      frames.json：コマ列（docs/ENTRANCE.md 3.3）。元にそろっているコマ列だけを書く（コマが無ければ {}。ページは何もしない）
//      形は ["a", "b"]（1 コマ 120ms）か { "seq": [...], "ms": 160 | [120, 160, ...] }（コマごとの時間）。ページはどちらも読む
//      コマ列の中の表情の名前（listening / smile / present）は「いまの表情の止まっているコマ」に置き換えて再生する（index.ts の play）
// 11-07（A-1）：nod / tilt / tilt2 / think / happy を追加。元は Codex 生成の 1254×1254（concept/concierge-v6-frames/）を
//      smile（01-welcome-hands）の足元（下端と下 100 行の重心）に整数の平行移動で合わせて cutouts/ に置いたもの（拡縮なし。ずれは 0.03% 以内、happy-2 は跳ねるので上下はそのまま）
// 11-07（A-2）：nod-down-1/2・tilt-down-1/2（listening の姿勢）、happy-up-1/2（present の姿勢）を追加。元は concept/concierge-v6-frames2/。
//      listening（03-listening）／present（02-welcome-wave）の足元に同じ方法で合わせた（横 0px・縦 0〜2px。happy-up-2 は跳ねるので縦は happy-up-1 と同じだけ）。
//      内側の不透明度（240〜254）は 255 にそろえた
import sharp from 'sharp';
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('使い方：node scripts/concierge-assets.mjs <元フォルダ> <出力フォルダ>'); process.exit(1); }

const BUST_H = 0.58;   // 上半身：上から 58% の高さ
const BUST_W = 0.72;   // 上半身：横は中央 72%
// ポーズの名前の手がかり（第 4・5 案の名前も受ける）
const POSES = { listening: /^(\d+-)?listening$/i, smile: /^(\d+-)?(smile|welcome-hands)$/i, present: /^(\d+-)?(present|welcome-wave)$/i };
// コマ列（docs/ENTRANCE.md 3.3）。すべてのコマがそろったものだけを frames.json に書く
const SEQUENCES = {
  blink: ['listening', 'blink', 'listening'],
  wave: ['present', 'wave-1', 'wave-2', 'wave-1', 'present'],
  smileDeep: ['smile', 'smile-2'],
  // nod / tilt / tilt2 / happy：手を胸の前で合わせた形（smile 用）。11-07 A-2 から smile のときだけ使う
  nod: { seq: ['smile', 'nod-1', 'nod-2', 'nod-1', 'smile'], ms: 160 },
  // かしげる：1 コマ 120ms では「ぴくっ」としか見えないので、かしげたコマを 0.8 秒保つ
  tilt: { seq: ['smile', 'tilt-1', 'smile'], ms: [120, 800, 120] },
  tilt2: { seq: ['smile', 'tilt-2', 'smile'], ms: [120, 800, 120] },
  think: ['think-1', 'think-2', 'think-1'],
  happy: { seq: ['smile', 'happy-1', 'happy-2', 'happy-1', 'smile'], ms: [120, 120, 160, 120, 120] },
  // 11-07 A-2：手の位置を合わせたコマ。listening（手を下ろす）用のうなずき・かしげ、present（手を差し出す）用のうれしい
  'nod-down': { seq: ['listening', 'nod-down-1', 'nod-down-2', 'nod-down-1', 'listening'], ms: 160 },
  'tilt-down': { seq: ['listening', 'tilt-down-1', 'listening'], ms: [120, 800, 120] },
  'tilt-down2': { seq: ['listening', 'tilt-down-2', 'listening'], ms: [120, 800, 120] },
  'happy-up': { seq: ['present', 'happy-up-1', 'happy-up-2', 'happy-up-1', 'present'], ms: [120, 120, 160, 120, 120] },
};
const seqOf = (d) => (Array.isArray(d) ? d : d.seq);
// WebP の質：21 枚（表情 3 + コマ 18）の合計を 3.0MB 以内に（11-07 A-2。A-1 の 15 枚は 2.5MB 以内、q72 / alpha 70）。
// A-2 の 21 枚は q72 / alpha 70 で 3.30MB、q68 だけでも 3.17MB。alpha 60 と preset 'picture' を足して 2.98MB。
// コマだけ下げると入れ替えの瞬間に画質が跳ねるので、全部を同じ質に（2x の顔の拡大で差は見えない）
const WEBP = { quality: 68, alphaQuality: 60, effort: 6, preset: 'picture' };

const files = readdirSync(src).filter((f) => /\.png$/i.test(f));
const named = new Map();   // 出力の名前 → 元のファイル
for (const f of files) {
  const stem = basename(f, extname(f));
  const pose = Object.entries(POSES).find(([, re]) => re.test(stem))?.[0];
  named.set(pose || stem.toLowerCase(), f);
}
for (const pose of Object.keys(POSES)) if (!named.has(pose)) { console.error(`${pose} の元画像が見つからない（${src}）`); process.exit(1); }

mkdirSync(out, { recursive: true });
let firstLoad = 0;   // 最初に読む分（smile の bust、1x + 2x の WebP）の目安
let total = 0;
for (const [name, f] of named) {
  const path = join(src, f);
  const { width: W, height: H } = await sharp(path).metadata();
  const bustBox = { left: Math.round(W * (1 - BUST_W) / 2), top: 0, width: Math.round(W * BUST_W), height: Math.round(H * BUST_H) };
  for (const [variant, crop] of [['full', null], ['bust', bustBox]]) {
    for (const [width, suffix] of [[512, ''], [1024, '@2x']]) {
      let img = sharp(path);
      if (crop) img = img.extract(crop);
      img = img.resize({ width });
      const base = join(out, `${name}-${variant}${suffix}`);
      const png = await img.clone().png({ palette: true, colors: 128, dither: 0.6, effort: 10, compressionLevel: 9 }).toFile(`${base}.png`);
      const webp = await img.clone().webp(WEBP).toFile(`${base}.webp`);
      total += webp.size;
      if (name === 'smile' && variant === 'bust') firstLoad += webp.size;
      console.log(`${name}-${variant}${suffix}  ← ${f}  png ${(png.size / 1024).toFixed(0)}KB  webp ${(webp.size / 1024).toFixed(0)}KB`);
    }
  }
}
const frames = Object.fromEntries(Object.entries(SEQUENCES).filter(([, seq]) => seqOf(seq).every((n) => named.has(n))));
writeFileSync(join(out, 'frames.json'), JSON.stringify(frames, null, 2) + '\n');
console.log(`frames.json：${Object.keys(frames).join(', ') || '（コマなし）'}`);
console.log(`WebP の合計 ${(total / 1024).toFixed(0)}KB、最初に読む smile の上半身 ${(firstLoad / 1024).toFixed(0)}KB`);
