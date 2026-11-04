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
  const cy = def.hang.floor_y_px * k - def.hang.center_from_floor_cm * pxPerCm;
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

const bbox = (pts) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (v) => String(+v.toFixed(2));

// 寄りの切り出し範囲：絵の中心を中心に、高さ = 絵の高さ × 3、16:10。画像の端を超えるなら端に寄せる
export function closeCropRect(quad, imgW, imgH) {
  const b = bbox(quad);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  let h = (b.y1 - b.y0) * 3, w = h * 1.6;
  if (w > imgW) { w = imgW; h = w / 1.6; }
  if (h > imgH) { h = imgH; w = h * 1.6; }
  w = Math.round(w); h = Math.round(h);
  const left = Math.round(Math.min(Math.max(0, cx - w / 2), imgW - w));
  const top = Math.round(Math.min(Math.max(0, cy - h / 2), imgH - h));
  return { left, top, width: w, height: h };
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

export async function compositeRooms({ root, work, paintingPath, outDir, aspect }) {
  const roomsDir = join(root, 'rooms');
  if (!existsSync(roomsDir)) return [];
  // 部屋の指定が無ければ、作品の大きさ（長辺）に向いている部屋だけを使う（suits_cm: [min, max]）
  const longSide = Math.max(...work.size_cm);
  const names = work.rooms || readdirSync(roomsDir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).filter((n) => {
    const d = JSON.parse(readFileSync(join(roomsDir, `${n}.json`), 'utf8'));
    return !d.suits_cm || (longSide >= d.suits_cm[0] && longSide <= d.suits_cm[1]);
  });
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
    let quad, pxPerCm = null, wallWidthCm = def.wall.width_cm;
    if (def.scale) {
      // 新方式：基準物から出した px/cm
      pxPerCm = def.scale.px_per_cm * scale;
      quad = paintingRectFromScale(def, work.size_cm, W);
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

    // 寄りの画像：幅 1200px
    const closeName = `room_${name}_close.jpg`;
    await sharp(buf, raw).extract(closeCropRect(quad, W, H)).resize({ width: 1200 }).jpeg({ quality: 85 }).toFile(join(outDir, closeName));

    // 確認用画像：rooms/check/<name>_<workId>.jpg
    if (def.scale) {
      mkdirSync(checkDir, { recursive: true });
      const pb = bbox(quad);
      const wPx = Math.round(pb.x1 - pb.x0), hPx = Math.round(pb.y1 - pb.y0);
      const basis = def.scale.basis?.ja || def.scale.basis?.en || '';
      const lines = [
        `px/cm=${fmt(pxPerCm)}  絵 ${work.size_cm[0]}×${work.size_cm[1]}cm = ${wPx}×${hPx}px  confidence=${def.scale.confidence || '?'}`,
        `basis=${basis}`,
        ...(def.scale.cross_check?.ja ? [`cross_check=${def.scale.cross_check.ja}`] : []),
      ];
      const svg = checkOverlaySvg({ width: W, height: H, quad, floorY: def.hang.floor_y_px * scale, lines });
      await sharp(buf, raw).composite([{ input: svg, top: 0, left: 0 }]).jpeg({ quality: 85 }).toFile(join(checkDir, `${name}_${work.id}.jpg`));
    }

    results.push({
      name, image: outName, close: closeName, label: def.label || { ja: name }, wall_width_cm: wallWidthCm,
      image_px: [W, H], quad_px: quad.map(([x, y]) => [Math.round(x), Math.round(y)]),
      ...(def.scale ? { px_per_cm: +pxPerCm.toFixed(3), confidence: def.scale.confidence || null } : {}),
    });
  }
  return results;
}
