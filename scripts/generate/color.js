// 主要色の抽出（k-means）。入力は RGB の Uint8Array（長さ 3n）
export function kmeans(pixels, k = 6, iters = 12, seed = 1) {
  const n = pixels.length / 3;
  // 決定的な初期値（k-means++ 風、乱数は線形合同法）
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const centers = [];
  const first = Math.floor(rnd() * n) * 3;
  centers.push([pixels[first], pixels[first + 1], pixels[first + 2]]);
  const d2 = new Float32Array(n);
  while (centers.length < k) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      let best = Infinity;
      for (const c of centers) {
        const dr = pixels[i * 3] - c[0], dg = pixels[i * 3 + 1] - c[1], db = pixels[i * 3 + 2] - c[2];
        const d = dr * dr + dg * dg + db * db;
        if (d < best) best = d;
      }
      d2[i] = best; sum += best;
    }
    let r = rnd() * sum, idx = 0;
    for (let i = 0; i < n; i++) { r -= d2[i]; if (r <= 0) { idx = i; break; } }
    centers.push([pixels[idx * 3], pixels[idx * 3 + 1], pixels[idx * 3 + 2]]);
  }
  const assign = new Uint8Array(n);
  for (let it = 0; it < iters; it++) {
    const acc = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      let best = Infinity, bi = 0;
      for (let c = 0; c < centers.length; c++) {
        const dr = pixels[i * 3] - centers[c][0], dg = pixels[i * 3 + 1] - centers[c][1], db = pixels[i * 3 + 2] - centers[c][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < best) { best = d; bi = c; }
      }
      assign[i] = bi;
      acc[bi][0] += pixels[i * 3]; acc[bi][1] += pixels[i * 3 + 1]; acc[bi][2] += pixels[i * 3 + 2]; acc[bi][3]++;
    }
    for (let c = 0; c < centers.length; c++) {
      if (acc[c][3] > 0) centers[c] = [acc[c][0] / acc[c][3], acc[c][1] / acc[c][3], acc[c][2] / acc[c][3]];
    }
  }
  const counts = new Array(centers.length).fill(0);
  for (let i = 0; i < n; i++) counts[assign[i]]++;
  return centers.map((c, i) => ({ rgb: c.map(Math.round), area: counts[i] / n }))
    .filter((c) => c.area > 0)
    .sort((a, b) => b.area - a.area);
}

export const toHex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export const luminance = (rgb) => (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;

// 文字色：主要色のうち最も明るい色を、さらに明るく薄めて読みやすくする
export function textColor(palette) {
  const brightest = [...palette].sort((a, b) => luminance(b.rgb) - luminance(a.rgb))[0].rgb;
  return toHex(brightest.map((v) => Math.round(v + (255 - v) * 0.6)));
}

// 球面の裏側の基調色：面積最大の色を暗くする
export function backColor(palette) {
  const c = palette[0].rgb;
  return toHex(c.map((v) => Math.round(v * 0.35)));
}

// 最も明るい主要色の重心（入りの渦の中心）。pixels は幅 w・高さ h の RGB。
// 返すのは UV（u は左 → 右、v は下 → 上。three のテクスチャと同じ向き）。該当が無ければ中央
export function brightCenter(pixels, w, h, palette) {
  if (!palette?.length) return [0.5, 0.5];
  const bi = palette.reduce((b, p, i) => (luminance(p.rgb) > luminance(palette[b].rgb) ? i : b), 0);
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 3;
    let best = Infinity, bc = 0;
    for (let c = 0; c < palette.length; c++) {
      const [r, g, b] = palette[c].rgb;
      const d = (pixels[o] - r) ** 2 + (pixels[o + 1] - g) ** 2 + (pixels[o + 2] - b) ** 2;
      if (d < best) { best = d; bc = c; }
    }
    if (bc === bi) { sx += x + 0.5; sy += y + 0.5; n++; }
  }
  if (!n) return [0.5, 0.5];
  return [+(sx / n / w).toFixed(4), +(1 - sy / n / h).toFixed(4)];
}
