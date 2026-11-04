// npm run generate [-- <id>]：works/<id>/ から流れ場・主要色・翻訳・QR・作品ページを生成する
import sharp from 'sharp';
import QRCode from 'qrcode';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { kmeans, toHex, textColor, backColor } from './color.js';
import { structureTensorFlow, flowToRGB, motionFromFlow } from './flow.js';
import { translateAll } from './translate.js';
import { workPage, galleryPage, cardSvg } from './pages.js';
import { compositeRooms } from './rooms.js';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const BASE_URL = (process.env.BASE_URL || 'https://sheer-jp.github.io/enter-the-painting').replace(/\/$/, '');
const FLOW_W = 256;

async function generateWork(id) {
  const dir = join(ROOT, 'works', id);
  const gen = join(dir, 'generated');
  mkdirSync(gen, { recursive: true });
  const work = JSON.parse(readFileSync(join(dir, 'work.json'), 'utf8'));
  if (work.id !== id) throw new Error(`${id}/work.json の id が一致しない: ${work.id}`);
  const src = join(dir, 'painting.jpg');
  if (!existsSync(src)) throw new Error(`${id}/painting.jpg が無い`);
  console.log(`[${id}] ${work.title?.ja || ''}`);

  // 1. 縮小（1 サイズ）
  const meta = await sharp(src).metadata();
  const aspect = meta.width / meta.height;
  await sharp(src).rotate().resize({ width: 1024 }).jpeg({ quality: 88, mozjpeg: true }).toFile(join(gen, 'painting_1024.jpg'));
  // 流体の色場の初期値用：元の写真の解像度をそのまま（長辺 2048 まで。写真が小さければ拡大しない）
  const longSide = Math.max(meta.width, meta.height);
  const fullW = longSide > 2048 ? Math.round(meta.width * 2048 / longSide) : meta.width;
  await sharp(src).rotate().resize({ width: fullW, withoutEnlargement: true }).jpeg({ quality: 90, mozjpeg: true }).toFile(join(gen, 'painting_full.jpg'));
  if (longSide < 2000) console.warn(`  写真の長辺が ${longSide}px しかない。2000px 以上で撮り直すと流体の中の絵がきれいになる`);
  // ページの背景用：強くぼかした小さな画像（CSS で拡大して使う）
  await sharp(src).rotate().resize({ width: 96 }).blur(6).jpeg({ quality: 70 }).toFile(join(gen, 'painting_blur.jpg'));

  // 2. 主要色
  const small = await sharp(src).rotate().resize({ width: 96 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const palette = kmeans(new Uint8Array(small.data), work.overrides?.palette_k ?? 6);
  const paletteHex = palette.map((p) => toHex(p.rgb));

  // 3. 筆致の流れ場
  const flowH = Math.round(FLOW_W / aspect);
  const g = await sharp(src).rotate().resize({ width: FLOW_W, height: flowH, fit: 'fill' }).grayscale().raw().toBuffer({ resolveWithObject: true });
  const gray = new Float32Array(g.data.length);
  for (let i = 0; i < gray.length; i++) gray[i] = g.data[i];
  const flow = structureTensorFlow(gray, FLOW_W, flowH, work.overrides?.flow_sigma ?? 6);   // 大きめに平滑化：渦が細かくなりすぎない
  await sharp(Buffer.from(flowToRGB(flow)), { raw: { width: FLOW_W, height: flowH, channels: 3 } }).png().toFile(join(gen, 'flow.png'));
  const motion = motionFromFlow(flow);

  // 4. 翻訳（タイトル、メッセージ、物語）
  const messages = (work.messages || []).map((ja, i) => ({ ja, en: work.messages_en?.[i] }));
  const texts = [...messages];
  if (work.title?.ja) texts.push({ ja: work.title.ja, en: work.title.en });
  const storyPath = join(gen, 'stories.json');
  let stories = existsSync(storyPath) ? JSON.parse(readFileSync(storyPath, 'utf8')) : {};
  // 小さな物語の下書き：無ければ Claude API で 1 本（キーが無ければスキップ）。作家が直したものは再生成で消えない
  if (!stories.ja && messages.length && process.env.ANTHROPIC_API_KEY) {
    const { draftStory } = await import('./claude.js');
    stories = { ja: await draftStory({ title: work.title?.ja || id, messages: messages.map((m) => m.ja), note: work.note }, process.env.ANTHROPIC_API_KEY) };
    writeFileSync(storyPath, JSON.stringify(stories, null, 2) + '\n');
    console.log('  小さな物語を下書きした → generated/stories.json（作家が直す）');
  }
  if (stories.ja) texts.push({ ja: stories.ja, en: stories.en });
  const tr = await translateAll(texts, join(gen, 'translations.json'));

  // 声の各文の開始秒。無ければ等間隔（文字数に比例）
  const at = [];
  if (work.audio?.voice_at?.length === messages.length) at.push(...work.audio.voice_at);
  else {
    let s = 0;
    for (const m of messages) { at.push(+s.toFixed(1)); s += Math.max(4, m.ja.length * 0.25) + 3; }
  }

  // 5. 部屋の合成
  const rooms = await compositeRooms({ root: ROOT, work, paintingPath: join(gen, 'painting_1024.jpg'), outDir: gen, aspect });

  // 6. space.json
  const ov = work.overrides || {};
  const space = {
    id, title: work.title?.ja ? { ...tr(work.title.ja), ja: work.title.ja, ...(work.title.en ? { en: work.title.en } : {}) } : { ja: id },
    size_cm: work.size_cm, aspect: +aspect.toFixed(4), year: work.year ?? null,
    painting: 'painting_1024.jpg', painting_full: 'painting_full.jpg', painting_blur: 'painting_blur.jpg',
    source_px: [meta.width, meta.height],
    palette: paletteHex, text_color: ov.text_color || textColor(palette), back_color: ov.back_color || backColor(palette),
    flow: { texture: 'flow.png', strength: ov.flow_strength ?? 0.6, edge_density: motion.edge_density },
    fluid: { vorticity: ov.vorticity ?? motion.vorticity, speed: ov.speed ?? motion.speed, quality: ov.quality || 'high', restore: ov.restore ?? 0.008, drive: ov.drive ?? 0.3 },
    space: { radius_m: ov.radius_m ?? 2.5, melt_distance_m: ov.melt_distance_m ?? 1.0 },
    audio: { voice: work.audio?.voice && existsSync(join(dir, work.audio.voice)) ? work.audio.voice : null, ambient: work.audio?.ambient || 'calm' },
    messages: messages.map((m, i) => ({ at: at[i], ...tr(m.ja), ja: m.ja, ...(m.en ? { en: m.en } : {}) })),
    story: stories.ja ? { ...tr(stories.ja), ja: stories.ja } : null,
    rooms, availability: work.availability || null, contact: work.contact || null,
    generated_at: new Date().toISOString(),
  };
  writeFileSync(join(gen, 'space.json'), JSON.stringify(space, null, 2) + '\n');

  // 7. QR（作品ページ + ?from=qr）とカード
  const url = `${BASE_URL}/w/${id}/?from=qr`;
  const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  writeFileSync(join(gen, 'qr.svg'), qrSvg);
  await QRCode.toFile(join(gen, 'qr.png'), url, { margin: 1, width: 1024, errorCorrectionLevel: 'M' });
  const inner = qrSvg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(qrSvg);
  const scale = vb ? 100 / +vb[1] : 1;
  writeFileSync(join(gen, 'card.svg'), cardSvg({ work, space, qrSvgInner: `<g transform="scale(${scale})">${inner}</g>`, url: `${BASE_URL}/w/${id}/` }));

  console.log(`  palette ${paletteHex.join(' ')}  motion ${JSON.stringify(motion)}  messages ${messages.length}  rooms ${rooms.length}`);
  return { work, space };
}

async function main() {
  const arg = process.argv[2];
  const worksDir = join(ROOT, 'works');
  const ids = arg ? [arg] : readdirSync(worksDir).filter((d) => statSync(join(worksDir, d)).isDirectory() && existsSync(join(worksDir, d, 'painting.jpg')));
  const all = [];
  for (const id of ids) all.push(await generateWork(id));
  // ページ（指定 id だけのときも、他の作品の space.json を読んでギャラリーを作り直す）
  const everyId = readdirSync(worksDir).filter((d) => existsSync(join(worksDir, d, 'generated', 'space.json')));
  const every = everyId.map((id) => ({ work: JSON.parse(readFileSync(join(worksDir, id, 'work.json'), 'utf8')), space: JSON.parse(readFileSync(join(worksDir, id, 'generated', 'space.json'), 'utf8')) }));
  const allWorks = every.map((e) => e.space);
  for (const { work, space } of every) {
    const pdir = join(ROOT, 'w', work.id);
    mkdirSync(pdir, { recursive: true });
    writeFileSync(join(pdir, 'index.html'), workPage({ work, space, baseUrl: BASE_URL, allWorks }));
  }
  writeFileSync(join(ROOT, 'index.html'), galleryPage({ works: allWorks, baseUrl: BASE_URL }));
  writeFileSync(join(ROOT, 'public', 'works.json'), JSON.stringify(allWorks.map((s) => ({ id: s.id, title: s.title, size_cm: s.size_cm })), null, 2) + '\n');
  console.log(`ページ生成：${every.length} 作品、BASE_URL=${BASE_URL}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
