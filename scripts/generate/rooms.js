// 部屋のイメージ（AI 生成、rooms/ に共用）に、絵の写真を壁の 4 隅へ射影して貼る。
// sharp.affine() はアフィンのみなので、ホモグラフィの逆写像を自前で行う（バイリニア補間）
import sharp from 'sharp';
import { readFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// 単位正方形 (0,0)-(1,1) → 4 点 への射影行列 H（3×3、行優先）
export function homographyFromUnitSquare([p0, p1, p2, p3]) {
  // p0 左上, p1 右上, p2 右下, p3 左下（時計回り）
  const [x0, y0] = p0, [x1, y1] = p1, [x2, y2] = p2, [x3, y3] = p3;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / det;
  const h = (dx1 * dy3 - dx3 * dy1) / det;
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0;
  const d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;
  return [a, b, c, d, e, f, g, h, 1];
}

export function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g);
  const G = b * f - c * e, Hh = -(a * f - c * d), I = a * e - b * d;
  return [A, D, G, B, E, Hh, C, F, I].map((v) => v / det);
}

// 壁の 4 隅と壁幅から、絵（幅 w_cm × 高さ h_cm）を置く 4 隅を求める
export function paintingQuadOnWall(wall, sizeCm) {
  const H = homographyFromUnitSquare(wall.corners_px);
  const [cx, cy] = wall.hang_center_ratio || [0.5, 0.45];
  const rw = sizeCm[0] / wall.width_cm;
  const wallHeightCm = wall.height_cm || wall.width_cm * ((dist(wall.corners_px[0], wall.corners_px[3]) + dist(wall.corners_px[1], wall.corners_px[2])) / (dist(wall.corners_px[0], wall.corners_px[1]) + dist(wall.corners_px[3], wall.corners_px[2])));
  const rh = sizeCm[1] / wallHeightCm;
  const u0 = cx - rw / 2, u1 = cx + rw / 2, v0 = cy - rh / 2, v1 = cy + rh / 2;
  const map = (u, v) => { const x = H[0] * u + H[1] * v + H[2], y = H[3] * u + H[4] * v + H[5], w = H[6] * u + H[7] * v + H[8]; return [x / w, y / w]; };
  return [map(u0, v0), map(u1, v0), map(u1, v1), map(u0, v1)];
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// 絵を quad に貼る。room: {data,width,height} RGB raw。painting 同様。薄い影つき
export function warpOnto(room, painting, quad, { shadow = 0.35 } = {}) {
  const H = homographyFromUnitSquare(quad);
  const Hi = invert3(H);
  const out = Buffer.from(room.data);
  const xs = quad.map((p) => p[0]), ys = quad.map((p) => p[1]);
  const pad = 14; // 影の範囲
  const minX = Math.max(0, Math.floor(Math.min(...xs)) - pad), maxX = Math.min(room.width - 1, Math.ceil(Math.max(...xs)) + pad);
  const minY = Math.max(0, Math.floor(Math.min(...ys)) - pad), maxY = Math.min(room.height - 1, Math.ceil(Math.max(...ys)) + pad);
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const w = Hi[6] * x + Hi[7] * y + Hi[8];
    const u = (Hi[0] * x + Hi[1] * y + Hi[2]) / w, v = (Hi[3] * x + Hi[4] * y + Hi[5]) / w;
    const o = (y * room.width + x) * 3;
    if (u >= 0 && u < 1 && v >= 0 && v < 1) {
      const px = u * (painting.width - 1), py = v * (painting.height - 1);
      const x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0;
      const x1 = Math.min(painting.width - 1, x0 + 1), y1 = Math.min(painting.height - 1, y0 + 1);
      for (let c = 0; c < 3; c++) {
        const s = (xx, yy) => painting.data[(yy * painting.width + xx) * 3 + c];
        const val = s(x0, y0) * (1 - fx) * (1 - fy) + s(x1, y0) * fx * (1 - fy) + s(x0, y1) * (1 - fx) * fy + s(x1, y1) * fx * fy;
        out[o + c] = Math.round(val);
      }
    } else {
      // 影：絵の外側、下と右に落ちる柔らかい影
      const du = u < 0 ? -u : u > 1 ? u - 1 : 0, dv = v < 0 ? -v : v > 1 ? v - 1 : 0;
      const d = Math.hypot(du * (painting.width), dv * (painting.height)) / Math.max(painting.width, painting.height) * 60;
      const bias = (v > 1 ? 1.0 : 0.5) * (u > 1 ? 1.0 : 0.7);
      const a = Math.max(0, shadow * bias * (1 - d / 1.0));
      if (a > 0) for (let c = 0; c < 3; c++) out[o + c] = Math.round(out[o + c] * (1 - a));
    }
  }
  return out;
}

// 基準物から出した px/cm で、正面の壁に絵を置く 4 隅を求める（左上から時計回り、長方形）
// imageWidthPx：実際に使う画像の幅。def.image_width_px と違えば、その比率を px/cm と座標に掛ける
export function paintingRectFromScale(def, sizeCm, imageWidthPx) {
  const k = imageWidthPx && def.image_width_px ? imageWidthPx / def.image_width_px : 1;
  const pxPerCm = def.scale.px_per_cm * k;
  const w = sizeCm[0] * pxPerCm, h = sizeCm[1] * pxPerCm;
  const cx = def.hang.x_px * k;
  // 掛ける高さ：中心（立って見る壁 145cm など）か、下端（家具の上端 + 20cm）のどちらかで指定
  const centerCm = def.hang.center_from_floor_cm ?? (def.hang.bottom_from_floor_cm + sizeCm[1] / 2);
  const cy = def.hang.floor_y_px * k - centerCm * pxPerCm;
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

const bbox = (pts) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (v) => String(+v.toFixed(2));

// ---- 縮尺：基準物（rooms/REFERENCES.json の実寸 cm と、部屋 JSON の px）から ----

export function loadReferenceTable(roomsDir) {
  const p = join(roomsDir, 'REFERENCES.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
}

// "door_interior.height" → { key, dim: 'height', item, cm }
export function resolveRef(ref, table) {
  const [key, dim] = String(ref).split('.');
  const item = table[key];
  const cm = item?.[`${dim}_cm`];
  if (!item || !cm) throw new Error(`寸法表に ${ref} が無い（rooms/REFERENCES.json）`);
  return { key, dim, item, cm };
}

// ずれ（割合）と基準の数から信頼度：8% 以内 high、15% 以内 mid、それ以上か基準が 1 つ → low
export function confidenceFrom(deviation, count) {
  if (count < 2) return 'low';
  if (deviation <= 0.08) return 'high';
  if (deviation <= 0.15) return 'mid';
  return 'low';
}

// references: [{ ref, px, primary }] → { px_per_cm, deviation, confidence, primary: [...], all: [...] }
// primary が複数あれば、その平均を px/cm にする。ずれは、全基準物の px/cm と採用値の最大のずれ
export function scaleFromReferences(references, table) {
  const all = references.map((r) => { const x = resolveRef(r.ref, table); return { ...x, ref: r.ref, px: r.px, primary: !!r.primary, pxPerCm: r.px / x.cm }; });
  if (!all.length) throw new Error('references が空');
  const prim = all.filter((r) => r.primary).length ? all.filter((r) => r.primary) : [all[0]];
  const pxPerCm = prim.reduce((a, r) => a + r.pxPerCm, 0) / prim.length;
  const deviation = Math.max(0, ...all.map((r) => Math.abs(r.pxPerCm - pxPerCm) / pxPerCm));
  return { px_per_cm: pxPerCm, deviation, confidence: confidenceFrom(deviation, all.length), primary: prim, all };
}

// ---- 比較の一文 ----

// 比率を身近な言い方に丸める（docs/SIZE_UX.md 3 節）
export function fractionOf(r) {
  if (r >= 0.9 && r <= 1.1) return { kind: 'same', ja: 'ほぼ同じ', en: 'about the same' };
  if (r >= 0.6 && r <= 0.75) return { kind: 'frac', ja: '約 3 分の 2', en: 'about two thirds' };
  if (r >= 0.45 && r <= 0.55) return { kind: 'frac', ja: '約半分', en: 'about half' };
  if (r >= 0.28 && r <= 0.38) return { kind: 'frac', ja: '約 3 分の 1', en: 'about one third' };
  if (r >= 0.2 && r < 0.28) return { kind: 'frac', ja: '約 4 分の 1', en: 'about a quarter' };
  const v = Math.max(0.1, Math.round(r * 10) / 10).toFixed(1);
  return { kind: 'times', ja: `約 ${v} 倍`, en: `about ${v} times` };
}

// 顧客に馴染みがある順（ドア > ソファ > 机 > 棚 > カウンター > ナイトテーブル > 天井 > その他）
export const FAMILIAR = ['door_interior', 'door_entrance', 'sofa_2seat', 'armchair', 'bench', 'desk', 'low_shelf', 'kitchen_counter', 'nightstand', 'ceiling', 'ceiling_entrance', 'window', 'kettle', 'table_lamp', 'laptop', 'mug'];
// 幅で比べてよい物（横長の絵と、横に長い家具）
const WIDE = new Set(['sofa_2seat', 'bench', 'desk', 'low_shelf', 'window']);
const rankOf = (k) => { const i = FAMILIAR.indexOf(k); return i < 0 ? FAMILIAR.length : i; };

// 1 つの基準物との比べ方：基本は高さ。横長の絵と横に長い物で、幅の方が 1 に近ければ幅。高さの無い物は幅
export function compareWith(sizeCm, item, key) {
  const [w, h] = sizeCm;
  const opts = [];
  if (item.height_cm) opts.push({ dim: 'height', ratio: h / item.height_cm, cm: item.height_cm });
  if (item.width_cm && (!item.height_cm || (w > h && WIDE.has(key)))) opts.push({ dim: 'width', ratio: w / item.width_cm, cm: item.width_cm });
  opts.sort((a, b) => Math.abs(Math.log(a.ratio)) - Math.abs(Math.log(b.ratio)));
  return opts[0] || null;
}

const DIM = { height: { ja: '高さ', en: 'height' }, width: { ja: '幅', en: 'width' } };

// 比較の文（ja / en）。withCm なら基準物の実寸を括弧で添える（数字を出す場所だけ）
export function compareSentence({ item, dim, ratio, cm }, { withCm = false, approx = false } = {}) {
  const f = fractionOf(ratio);
  const cmJa = withCm ? `（約 ${Math.round(cm)} cm）` : '', cmEn = withCm ? ` (about ${Math.round(cm)} cm)` : '';
  const d = DIM[dim];
  const sp = /\d$/.test(f.ja) ? ' ' : '';   // 「約 3 分の 1 の高さ」：数字のあとは半角スペース
  let ja = f.kind === 'same' ? `この${item.label.ja}${cmJa}と${f.ja}${d.ja}。` : `この${item.label.ja}${cmJa}の${f.ja}${sp}の${d.ja}。`;
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  let en = f.kind === 'same' ? `${cap(f.en)} ${d.en} as ${item.label.en}${cmEn}.` : `${cap(f.en)} the ${d.en} of ${item.label.en}${cmEn}.`;
  if (approx) { ja = ja.replace(/。$/, '（寸法は目安）。'); en = en.replace(/\.$/, ' (size is approximate).'); }
  return { ja, en };
}

// 部屋の文章：比較の一文、2 つ目の比較、部屋の説明、注記（ja / en）
export function roomTexts({ references, table, sizeCm, confidence, wallWidthCm, centerFromFloorCm, aboveFurniture = false }) {
  const seen = new Set();
  const cands = [];
  for (const r of [...references].sort((a, b) => rankOf(a.ref.split('.')[0]) - rankOf(b.ref.split('.')[0]))) {
    const key = r.ref.split('.')[0];
    if (seen.has(key) || !table[key]) continue;
    seen.add(key);
    const c = compareWith(sizeCm, table[key], key);
    if (c) cands.push({ ...c, item: table[key], key });
  }
  const low = confidence === 'low';
  const compare = cands[0] ? compareSentence(cands[0], { approx: low }) : null;
  const compare2 = cands[1] ? compareSentence(cands[1], { withCm: true }) : null;
  const m = (wallWidthCm / 100).toFixed(1);
  const hc = Math.round(centerFromFloorCm / 5) * 5;
  const seated = centerFromFloorCm < 140;
  const about = {
    ja: aboveFurniture
      ? `壁の幅は約 ${m} m。家具の上端から 20 cm ほど空けて掛けています（絵の中心は床から約 ${hc} cm）。`
      : `壁の幅は約 ${m} m。${seated ? '座ったときの目の高さ' : '目の高さ'}（床から約 ${hc} cm）に掛けています。`,
    en: aboveFurniture
      ? `The wall is about ${m} m wide. The painting hangs about 20 cm above the furniture (center about ${hc} cm from the floor).`
      : `The wall is about ${m} m wide. The painting hangs at ${seated ? 'seated eye level' : 'eye level'} (about ${hc} cm from the floor).`,
  };
  const note = {
    ja: '部屋は AI で作ったイメージで、寸法はだいたいこのくらい、という目安です。絵は実物の写真です。' + (low ? 'この部屋は縮尺の手がかりが不確かなので、特に大まかな目安です。' : ''),
    en: 'The room is an AI-generated image, and the size is a rough guide to how it might look. The painting is a real photo.' + (low ? ' The scale cues in this room are uncertain, so treat it as an especially rough guide.' : ''),
  };
  return { compare, compare2, about, note, primary_ref: cands[0]?.key || null };
}

// 確認用の重ね描き（SVG）：絵の枠（赤）、床の線（青、画像内のときだけ）、左上に縮尺の文字
function checkOverlaySvg({ width, height, quad, floorY, lines }) {
  const pts = quad.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const floor = floorY >= 0 && floorY < height ? `<line x1="0" y1="${floorY.toFixed(1)}" x2="${width}" y2="${floorY.toFixed(1)}" stroke="#2060ff" stroke-width="3"/>` : '';
  const text = lines.map((l, i) => `<text x="16" y="${34 + i * 28}">${xmlEsc(l)}</text>`).join('');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <polygon points="${pts}" fill="none" stroke="#ff2020" stroke-width="3"/>
  ${floor}
  <rect x="6" y="6" width="${Math.min(width - 12, 1100)}" height="${lines.length * 28 + 16}" fill="rgba(255,255,255,0.8)"/>
  <g font-family="Noto Sans CJK JP, WenQuanYi Zen Hei, sans-serif" font-size="20" fill="#111">${text}</g>
</svg>`);
}

export async function compositeRooms({ root, work, paintingPath, outDir }) {
  const roomsDir = join(root, 'rooms');
  if (!existsSync(roomsDir)) return [];
  const table = loadReferenceTable(roomsDir);
  // 部屋の指定が無ければ、作品の大きさ（長辺）に向いている部屋を、種類（category）ごとに 2 枚まで（ファイル名順）使う（suits_cm: [min, max]）
  const longSide = Math.max(...work.size_cm);
  const readDef = (n) => { const p = join(roomsDir, `${n}.json`); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {}; };
  let names = work.rooms;
  if (!names) {
    const perCat = {};
    names = readdirSync(roomsDir).filter((f) => f.endsWith('.json') && f !== 'REFERENCES.json').map((f) => f.replace(/\.json$/, '')).sort().filter((n) => {
      const d = readDef(n);
      if (d.suits_cm && !(longSide >= d.suits_cm[0] && longSide <= d.suits_cm[1])) return false;
      const c = d.category || '';
      perCat[c] = (perCat[c] || 0) + 1;
      return perCat[c] <= 2;
    });
  }
  const painting = await sharp(paintingPath).resize({ width: 800 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const checkDir = join(roomsDir, 'check');
  const results = [];
  for (const name of names) {
    const jsonPath = join(roomsDir, `${name}.json`);
    const imgPath = ['jpg', 'png', 'jpeg'].map((e) => join(roomsDir, `${name}.${e}`)).find(existsSync);
    if (!existsSync(jsonPath) || !imgPath) { console.warn(`  部屋 ${name} の json か画像が無い。スキップ`); continue; }
    const def = JSON.parse(readFileSync(jsonPath, 'utf8'));
    const room = await sharp(imgPath).resize({ width: 1600, withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = room.info.width, H = room.info.height;
    const scale = W / (def.image_width_px || W);
    const wall = { ...def.wall, corners_px: def.wall.corners_px.map(([x, y]) => [x * scale, y * scale]) };
    // 縮尺：references（基準物）から。無ければ従来の scale.px_per_cm 直書き（後方互換）
    let sc = null;
    if (def.references?.length) sc = scaleFromReferences(def.references, table);
    else if (def.scale?.px_per_cm) sc = { px_per_cm: def.scale.px_per_cm, deviation: null, confidence: def.scale.confidence || null, all: [] };
    let quad, pxPerCm = null, wallWidthCm = def.wall.width_cm;
    if (sc) {
      pxPerCm = sc.px_per_cm * scale;
      quad = paintingRectFromScale({ ...def, scale: { px_per_cm: sc.px_per_cm } }, work.size_cm, W);
      const wb = bbox(wall.corners_px), pb = bbox(quad);
      wallWidthCm = Math.round((wb.x1 - wb.x0) / pxPerCm);
      const eps = 0.5;
      if (pb.x0 < wb.x0 - eps || pb.y0 < wb.y0 - eps || pb.x1 > wb.x1 + eps || pb.y1 > wb.y1 + eps) {
        console.warn(`  部屋 ${name}：絵（${work.size_cm[0]}×${work.size_cm[1]}cm = ${Math.round(pb.x1 - pb.x0)}×${Math.round(pb.y1 - pb.y0)}px）が壁の範囲（${Math.round(wb.x0)},${Math.round(wb.y0)}〜${Math.round(wb.x1)},${Math.round(wb.y1)}px）からはみ出す。スキップ`);
        continue;
      }
    } else {
      // 従来の方式（後方互換）：壁幅 cm から縮尺を出す
      quad = paintingQuadOnWall(wall, work.size_cm);
    }
    const buf = warpOnto({ data: room.data, width: W, height: H }, { data: painting.data, width: painting.info.width, height: painting.info.height }, quad);
    const raw = { raw: { width: W, height: H, channels: 3 } };
    const outName = `room_${name}.jpg`;
    await sharp(buf, raw).jpeg({ quality: 85 }).toFile(join(outDir, outName));

    // 確認用画像：rooms/check/<name>_<workId>.jpg
    if (sc) {
      mkdirSync(checkDir, { recursive: true });
      const pb = bbox(quad);
      const wPx = Math.round(pb.x1 - pb.x0), hPx = Math.round(pb.y1 - pb.y0);
      const lines = [
        `px/cm=${fmt(pxPerCm)}  絵 ${work.size_cm[0]}×${work.size_cm[1]}cm = ${wPx}×${hPx}px  confidence=${sc.confidence || '?'}${sc.deviation != null ? `（ずれ ${(sc.deviation * 100).toFixed(1)}%）` : ''}`,
        ...sc.all.map((r) => `${r.primary ? '主 ' : '　 '}${r.ref} ${r.px}px = ${r.cm}cm → ${fmt(r.pxPerCm)}`),
        ...(!sc.all.length && def.scale?.basis?.ja ? [`basis=${def.scale.basis.ja}`] : []),
      ];
      const svg = checkOverlaySvg({ width: W, height: H, quad, floorY: def.hang.floor_y_px * scale, lines });
      await sharp(buf, raw).composite([{ input: svg, top: 0, left: 0 }]).jpeg({ quality: 85 }).toFile(join(checkDir, `${name}_${work.id}.jpg`));
    }

    // 顧客向けの文章（ja / en。他の言語は index.js で翻訳キャッシュから）
    const texts = def.references?.length
      ? roomTexts({ references: def.references, table, sizeCm: work.size_cm, confidence: sc.confidence, wallWidthCm, centerFromFloorCm: def.hang.center_from_floor_cm ?? Math.round(def.hang.bottom_from_floor_cm + work.size_cm[1] / 2), aboveFurniture: def.hang.bottom_from_floor_cm != null })
      : { compare: null, compare2: null, about: null, note: null, primary_ref: null };

    results.push({
      name, image: outName, ...(def.category ? { category: def.category } : {}), label: def.label || { ja: name }, wall_width_cm: wallWidthCm,
      image_px: [W, H], quad_px: quad.map(([x, y]) => [Math.round(x), Math.round(y)]),
      ...(sc ? { px_per_cm: +pxPerCm.toFixed(3), confidence: sc.confidence || null } : {}),
      ...texts,
    });
  }
  return results;
}
