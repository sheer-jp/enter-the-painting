// 部屋のイメージ（AI 生成、rooms/ に共用）に、絵の写真を壁の 4 隅へ射影して貼る。
// sharp.affine() はアフィンのみなので、ホモグラフィの逆写像を自前で行う（バイリニア補間）
import sharp from 'sharp';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
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
  const results = [];
  for (const name of names) {
    const jsonPath = join(roomsDir, `${name}.json`);
    const imgPath = ['jpg', 'png', 'jpeg'].map((e) => join(roomsDir, `${name}.${e}`)).find(existsSync);
    if (!existsSync(jsonPath) || !imgPath) { console.warn(`  部屋 ${name} の json か画像が無い。スキップ`); continue; }
    const def = JSON.parse(readFileSync(jsonPath, 'utf8'));
    const room = await sharp(imgPath).resize({ width: 1600, withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const scale = room.info.width / (def.image_width_px || room.info.width);
    const wall = { ...def.wall, corners_px: def.wall.corners_px.map(([x, y]) => [x * scale, y * scale]) };
    const quad = paintingQuadOnWall(wall, work.size_cm);
    const buf = warpOnto({ data: room.data, width: room.info.width, height: room.info.height }, { data: painting.data, width: painting.info.width, height: painting.info.height }, quad);
    const outName = `room_${name}.jpg`;
    await sharp(buf, { raw: { width: room.info.width, height: room.info.height, channels: 3 } }).jpeg({ quality: 85 }).toFile(join(outDir, outName));
    results.push({ name, image: outName, label: def.label || { ja: name }, wall_width_cm: def.wall.width_cm, image_px: [room.info.width, room.info.height], quad_px: quad.map(([x, y]) => [Math.round(x), Math.round(y)]) });
  }
  return results;
}
