// VR の立体感（docs/VR_DEPTH.md）の純関数。three.js に依存しない（単体テストから直接呼ぶ）
export type DepthQuality = 'high' | 'medium' | 'low';

// 手前の粒の数：high 80、medium 40、low 0（床と奥の光だけ）。VR_DEPTH.md 4 節
export const PARTICLE_MAX = 80;
export function particleCount(q: DepthQuality): number { return q === 'high' ? PARTICLE_MAX : q === 'medium' ? 40 : 0; }

// 粒の球殻（頭からの距離、m）
export const SHELL_MIN = 0.6;
export const SHELL_MAX = 1.8;
export const FADE_IN_SEC = 1.5;

// 1 つの粒：頭のそばを直線で通り過ぎる。中心 c（頭からの最接近点）、向き a（c に直交する単位ベクトル）、片道の長さ h。
// s = 0〜1 の周期で c + a × h × (2s − 1) を進む。最接近 |c|、両端 √(|c|² + h²) がどちらも球殻の中に収まる
export interface ParticleSeed {
  center: [number, number, number];
  axis: [number, number, number];
  half: number;        // 片道の長さ（m）
  size: number;        // 板の大きさ（m）0.03〜0.09
  period: number;      // 1 周期の秒数（近い粒ほど短い = 速い）
  phase: number;       // 0〜1
  shape: number;       // 0〜3（柔らかい丸と欠片 3 種）
  color: number;       // 主要色の番号
  spin: number;        // 板の回転（ラジアン）
}

// 決まった種の乱数（作品ごとに同じ配置になる）
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

const norm = (v: [number, number, number]): [number, number, number] => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: [number, number, number], b: [number, number, number]): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function placeParticles(n: number, paletteSize: number, seed = 1): ParticleSeed[] {
  const r = rng(seed);
  const out: ParticleSeed[] = [];
  for (let i = 0; i < n; i++) {
    // 向きは球面に一様（上・下・後ろにも）
    const z = r() * 2 - 1, th = r() * Math.PI * 2, rr = Math.sqrt(1 - z * z);
    const dir: [number, number, number] = [rr * Math.cos(th), z, rr * Math.sin(th)];
    const d = SHELL_MIN + r() * 0.35;                       // 最接近 0.6〜0.95m
    const hMax = Math.sqrt(SHELL_MAX * SHELL_MAX - d * d) * 0.97;
    const half = hMax * (0.7 + 0.3 * r());
    // 通り過ぎる向き：dir に直交する任意の向き
    const ref: [number, number, number] = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const t1 = norm(cross(dir, ref)), t2 = cross(dir, t1);
    const ang = r() * Math.PI * 2;
    const axis = norm([t1[0] * Math.cos(ang) + t2[0] * Math.sin(ang), t1[1] * Math.cos(ang) + t2[1] * Math.sin(ang), t1[2] * Math.cos(ang) + t2[2] * Math.sin(ang)]);
    out.push({
      center: [dir[0] * d, dir[1] * d, dir[2] * d], axis, half,
      size: 0.03 + r() * 0.06,
      period: 9 + (d - SHELL_MIN) * 20 + r() * 6,           // 近い粒ほど短い周期 = 速く通り過ぎる
      phase: r(), shape: Math.floor(r() * 4), color: Math.floor(r() * Math.max(1, paletteSize)), spin: r() * Math.PI * 2,
    });
  }
  return out;
}

// 周期の位置 s での頭からの位置（流体による横ずれを除く）
export function particlePos(p: ParticleSeed, s: number): [number, number, number] {
  const k = p.half * (2 * s - 1);
  return [p.center[0] + p.axis[0] * k, p.center[1] + p.axis[1] * k, p.center[2] + p.axis[2] * k];
}

// 場面ごとの見え方。alpha = 粒の不透明度、toLayer = 絵の層へ戻る度合い（0 = 粒の位置、1 = 半径 radius_m）。
// S3 の後半（morph ≥ 0.5）から 1.5 秒でフェードイン、S4 で漂う、S5 で morph が 1 → 0 になるのに合わせて絵の層へ戻りながら消える
export function particleVisibility(stage: string, morph: number, secSinceAppear: number): { alpha: number; toLayer: number } {
  if (stage === 'S3' || stage === 'S4') {
    if (stage === 'S3' && morph < 0.5) return { alpha: 0, toLayer: 0 };
    return { alpha: clamp01(secSinceAppear / FADE_IN_SEC), toLayer: 0 };
  }
  if (stage === 'S5') {
    const k = clamp01(1 - morph);
    return { alpha: 1 - k, toLayer: k };
  }
  return { alpha: 0, toLayer: 0 };
}

// 床と奥の光：球面になるにつれて出る（S1・S2 の壁の部屋には出さない）
export function surroundVisibility(stage: string, morph: number): number {
  if (stage === 'S1' || stage === 'S2' || stage === 'S0') return 0;
  return clamp01(morph);
}

// 壁の部屋（S1 の床と壁）を隠すか：絵の層の外側が不透明になる morph 0.35 で隠す（球面の内側に入って視界をふさぐため）
export function hideRoom(morph: number): boolean { return morph >= 0.35; }

// 視界の中にある粒の数（検査モード：6 方向のどれにも粒があるか）。positions は頭からの位置、forward は単位ベクトル
export function particlesInView(positions: [number, number, number][], forward: [number, number, number], fovDeg: number): number {
  const c = Math.cos(((fovDeg / 2) * Math.PI) / 180);
  let n = 0;
  for (const p of positions) {
    const l = Math.hypot(p[0], p[1], p[2]) || 1;
    if ((p[0] * forward[0] + p[1] * forward[1] + p[2] * forward[2]) / l >= c) n++;
  }
  return n;
}

// 床の円盤：本当の床（y = 0）に置き、絵の層の球面の内側に収まる半径（最大 2m）
export function floorRadius(headY: number, radius: number, want = 2): number {
  const inside = radius * radius - headY * headY;
  return inside <= 0 ? 0 : Math.min(want, Math.sqrt(inside) * 0.98);
}

// 世界空間の光：頭の位置 + (0, 0.8R, −0.3R)（VR_DEPTH.md 2 節）
export function lightWorld(head: [number, number, number], radius: number): [number, number, number] {
  return [head[0], head[1] + 0.8 * radius, head[2] - 0.3 * radius];
}

// 白飛び率：RGBA の並びで、RGB すべて 250 以上の画素の割合
export function whiteRatio(px: ArrayLike<number>): number {
  let n = 0, w = 0;
  for (let i = 0; i + 2 < px.length; i += 4) { n++; if (px[i] >= 250 && px[i + 1] >= 250 && px[i + 2] >= 250) w++; }
  return n ? w / n : 0;
}

function clamp01(x: number) { return x < 0 ? 0 : x > 1 ? 1 : x; }

// ── 物語モードのドットの粒（docs/FLUID_PER_WORK.md 5 節、F-6）。VR の粒の層を平面で流用する ──
// 数：look.dots 0 → 出さない、0〜1 → 20〜40
export const FLAT_DOT_MAX = 40;
export function flatDotCount(dots: number): number {
  if (!(dots > 0)) return 0;
  return Math.max(20, Math.min(FLAT_DOT_MAX, Math.round(20 + 20 * Math.min(1, dots))));
}

// 主要色のうち最も明るい色の番号（相対輝度）
export function brightestIndex(palette: string[]): number {
  let best = 0, bl = -1;
  palette.forEach((h, i) => {
    const n = parseInt(h.replace('#', ''), 16);
    if (!Number.isFinite(n)) return;
    const l = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
    if (l > bl) { bl = l; best = i; }
  });
  return best;
}

// 厚み（RGBA の R）の山の位置：3×3 の極大を高い順に、互いに minDist（UV）以上離して n 個。
// 画像の行 0 は上、流体の UV は下が 0 なので v を反転する
export function peakUvs(px: ArrayLike<number>, w: number, h: number, n: number, minDist = 0.06): [number, number][] {
  const R = (x: number, y: number) => px[(y * w + x) * 4];
  const cand: { x: number; y: number; v: number }[] = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const v = R(x, y);
    if (v <= 0) continue;
    let max = true;
    for (let dy = -1; dy <= 1 && max; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && R(x + dx, y + dy) > v) { max = false; break; }
    if (max) cand.push({ x, y, v });
  }
  cand.sort((a, b) => b.v - a.v);
  const out: [number, number][] = [];
  const d2 = minDist * minDist;
  for (const c of cand) {
    if (out.length >= n) break;
    const u = (c.x + 0.5) / w, v = 1 - (c.y + 0.5) / h;
    if (out.every((o) => (o[0] - u) ** 2 + (o[1] - v) ** 2 >= d2)) out.push([u, v]);
  }
  return out;
}
