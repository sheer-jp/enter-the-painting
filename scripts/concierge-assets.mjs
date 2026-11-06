// 受付のキャラクター画像を作る（docs/ENTRANCE.md 3.3）
// 使い方：node scripts/concierge-assets.mjs <元フォルダ> <出力フォルダ>
//   例：node scripts/concierge-assets.mjs ../../_meta/development/enter-the-painting/concept/concierge-v5/cutouts public/concierge/artist
//
// 元：全身の透過 PNG（正方形）。ポーズ 3 枚は listening / smile / present（第 4・5 案の名前 03-listening / 01-welcome-hands / 02-welcome-wave でもよい）
//     コマ（任意）：blink / wave-1 / wave-2 / smile-2（.png）。他の名前の PNG もそのまま同じ扱いで書き出す
// 出す：<名前>-full（全身）と <名前>-bust（上半身：上から 58% の高さ、横は中央 72% を切り出す）を、1x（幅 512）と @2x（幅 1024）、PNG と WebP で
//      ページは WebP を先に読み、PNG は fallback（<picture>）。差し替えるときは必ずこのスクリプトで全部を作り直す
//      frames.json：コマ列（docs/ENTRANCE.md 3.3）。元にそろっているコマ列だけを書く（コマが無ければ {}。ページは何もしない）
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
};

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
      const webp = await img.clone().webp({ quality: 80, alphaQuality: 90, effort: 6 }).toFile(`${base}.webp`);
      total += webp.size;
      if (name === 'smile' && variant === 'bust') firstLoad += webp.size;
      console.log(`${name}-${variant}${suffix}  ← ${f}  png ${(png.size / 1024).toFixed(0)}KB  webp ${(webp.size / 1024).toFixed(0)}KB`);
    }
  }
}
const frames = Object.fromEntries(Object.entries(SEQUENCES).filter(([, seq]) => seq.every((n) => named.has(n))));
writeFileSync(join(out, 'frames.json'), JSON.stringify(frames, null, 2) + '\n');
console.log(`frames.json：${Object.keys(frames).join(', ') || '（コマなし）'}`);
console.log(`WebP の合計 ${(total / 1024).toFixed(0)}KB、最初に読む smile の上半身 ${(firstLoad / 1024).toFixed(0)}KB`);
