// 筆致の流れ場。グレースケール画像から構造テンソルで主方向を求める。
// 出力：幅 w・高さ h の Float32Array ×3（cos, sin, strength）。向きは軸性（θ と θ+π は同じ）
export function structureTensorFlow(gray, w, h, sigma = 3) {
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  const at = (x, y) => gray[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // Sobel
    gx[y * w + x] = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
    gy[y * w + x] = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
  }
  const jxx = new Float32Array(w * h), jyy = new Float32Array(w * h), jxy = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { jxx[i] = gx[i] * gx[i]; jyy[i] = gy[i] * gy[i]; jxy[i] = gx[i] * gy[i]; }
  blur(jxx, w, h, sigma); blur(jyy, w, h, sigma); blur(jxy, w, h, sigma);
  const cos = new Float32Array(w * h), sin = new Float32Array(w * h), str = new Float32Array(w * h);
  let maxStr = 1e-6;
  for (let i = 0; i < w * h; i++) {
    // 勾配の主方向 θg。筆致の方向はそれに直交
    const theta = 0.5 * Math.atan2(2 * jxy[i], jxx[i] - jyy[i]) + Math.PI / 2;
    const tr = jxx[i] + jyy[i];
    const det = jxx[i] * jyy[i] - jxy[i] * jxy[i];
    const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
    const coherence = tr > 1e-6 ? (l1 - l2) / (l1 + l2 + 1e-6) : 0;
    const s = coherence * Math.sqrt(Math.max(0, l1));
    cos[i] = Math.cos(theta); sin[i] = Math.sin(theta); str[i] = s;
    if (s > maxStr) maxStr = s;
  }
  // 強さを 0〜1 に（上位 2% で飽和）
  const sorted = Float32Array.from(str).sort();
  const p98 = sorted[Math.floor(sorted.length * 0.98)] || maxStr;
  for (let i = 0; i < w * h; i++) str[i] = Math.min(1, str[i] / (p98 || 1));
  return { cos, sin, str };
}

// 分離ガウシアンぼかし（境界は端の値）
export function blur(a, w, h, sigma) {
  const r = Math.max(1, Math.ceil(sigma * 2.5));
  const k = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); sum += v; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0;
    for (let i = -r; i <= r; i++) v += a[y * w + Math.min(w - 1, Math.max(0, x + i))] * k[i + r];
    tmp[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0;
    for (let i = -r; i <= r; i++) v += tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x] * k[i + r];
    a[y * w + x] = v;
  }
}

// flow.png 用の RGB バッファ（R=cos, G=sin を 0〜1 に、B=強さ）
export function flowToRGB({ cos, sin, str }) {
  const n = cos.length;
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = Math.round((cos[i] * 0.5 + 0.5) * 255);
    out[i * 3 + 1] = Math.round((sin[i] * 0.5 + 0.5) * 255);
    out[i * 3 + 2] = Math.round(str[i] * 255);
  }
  return out;
}

// 動きの初期値：エッジ密度（強さの平均）から。穏やかな絵はゆっくり、激しい絵は速く
export function motionFromFlow({ str }) {
  let m = 0;
  for (let i = 0; i < str.length; i++) m += str[i];
  m /= str.length;                     // 0〜1 だが実際は 0.1〜0.4 程度
  const t = Math.min(1, Math.max(0, (m - 0.08) / 0.3));
  return { speed: +(0.25 + 0.4 * t).toFixed(2), vorticity: +(0.3 + 0.4 * t).toFixed(2), edge_density: +m.toFixed(3) };
}

// 絵の具の厚みの初期値（relief.png 用）。明度の高周波（元 − ガウシアン σ=4 の差の絶対値）を 0〜1 にし、
// 筆致の強さ（flow の str）と 0.6 : 0.4 で混ぜ、軽くぼかす（σ=1）。写真から計算するだけで、絵は加工しない
export function reliefFromGray(gray, w, h, str) {
  const low = Float32Array.from(gray);
  blur(low, w, h, 4);
  const hf = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) hf[i] = Math.abs(gray[i] - low[i]);
  // 上位 2% で飽和（flow の強さと同じ正規化）
  const sorted = Float32Array.from(hf).sort();
  const p98 = sorted[Math.floor(sorted.length * 0.98)] || 1;
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = 0.6 * Math.min(1, hf[i] / (p98 || 1)) + 0.4 * (str ? str[i] : 0);
  blur(out, w, h, 1);
  for (let i = 0; i < w * h; i++) out[i] = Math.min(1, Math.max(0, out[i]));
  return out;
}

// 0〜1 の Float32Array → 8bit グレースケール
export const toGray8 = (a) => Uint8Array.from(a, (v) => Math.round(v * 255));
