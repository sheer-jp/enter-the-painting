// VR の立体感（docs/VR_DEPTH.md）の純関数：粒の配置、数と品質、場面ごとの見え方
import { describe, it, expect } from 'vitest';
import { placeParticles, particlePos, particleCount, particleVisibility, surroundVisibility, hideRoom, particlesInView, floorRadius, lightWorld, whiteRatio, SHELL_MIN, SHELL_MAX, PARTICLE_MAX } from '../src/space/depth';

const len = (p: number[]) => Math.hypot(p[0], p[1], p[2]);

describe('粒の配置', () => {
  const seeds = placeParticles(PARTICLE_MAX, 6, 42);
  it('80 個まで、品質で 80 / 40 / 0', () => {
    expect(seeds.length).toBe(80);
    expect(particleCount('high')).toBe(80);
    expect(particleCount('medium')).toBe(40);
    expect(particleCount('low')).toBe(0);
  });
  it('周期のどこでも半径 0.6〜1.8m の球殻の中', () => {
    for (const p of seeds) for (let s = 0; s <= 1; s += 0.05) {
      const r = len(particlePos(p, s));
      expect(r).toBeGreaterThanOrEqual(SHELL_MIN - 1e-9);
      expect(r).toBeLessThanOrEqual(SHELL_MAX);
    }
  });
  it('板の大きさ 0.03〜0.09m、形は 4 種、色は主要色の中', () => {
    for (const p of seeds) {
      expect(p.size).toBeGreaterThanOrEqual(0.03); expect(p.size).toBeLessThanOrEqual(0.09);
      expect([0, 1, 2, 3]).toContain(p.shape);
      expect(p.color).toBeLessThan(6);
    }
  });
  it('近い粒ほど周期が短い（速い）傾向', () => {
    const near = seeds.filter((p) => len(p.center) < 0.7), far = seeds.filter((p) => len(p.center) > 0.85);
    const avg = (a: typeof seeds) => a.reduce((s, p) => s + p.period, 0) / a.length;
    expect(avg(near)).toBeLessThan(avg(far));
  });
  it('同じ種なら同じ配置', () => {
    expect(placeParticles(10, 6, 7)).toEqual(placeParticles(10, 6, 7));
  });
  it('6 方向のどれにも粒がある（周期の中央、画角 90°）', () => {
    const pts = seeds.map((p) => particlePos(p, 0.5));
    for (const f of [[0, 0, -1], [0, 0, 1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]] as [number, number, number][]) {
      expect(particlesInView(pts, f, 90)).toBeGreaterThan(0);
    }
  });
});

describe('場面ごとの見え方', () => {
  it('S1・S2 と S3 の前半は出ない', () => {
    expect(particleVisibility('S1', 0, 0).alpha).toBe(0);
    expect(particleVisibility('S2', 0, 0).alpha).toBe(0);
    expect(particleVisibility('S3', 0.3, 5).alpha).toBe(0);
  });
  it('S3 の後半から 1.5 秒でフェードイン、S4 で出ている', () => {
    expect(particleVisibility('S3', 0.6, 0).alpha).toBe(0);
    expect(particleVisibility('S3', 0.6, 0.75).alpha).toBeCloseTo(0.5);
    expect(particleVisibility('S4', 1, 1.5).alpha).toBe(1);
    expect(particleVisibility('S4', 1, 10)).toEqual({ alpha: 1, toLayer: 0 });
  });
  it('S5 は絵の層へ戻りながら消える', () => {
    expect(particleVisibility('S5', 1, 99)).toEqual({ alpha: 1, toLayer: 0 });
    expect(particleVisibility('S5', 0.5, 99)).toEqual({ alpha: 0.5, toLayer: 0.5 });
    expect(particleVisibility('S5', 0, 99)).toEqual({ alpha: 0, toLayer: 1 });
  });
  it('床と奥の光は球面になるにつれて出る。壁の部屋は morph 0.35 で隠す', () => {
    expect(surroundVisibility('S1', 0)).toBe(0);
    expect(surroundVisibility('S2', 0)).toBe(0);
    expect(surroundVisibility('S3', 0.5)).toBe(0.5);
    expect(surroundVisibility('S4', 1)).toBe(1);
    expect(surroundVisibility('S5', 0.2)).toBeCloseTo(0.2);
    expect(hideRoom(0.2)).toBe(false);
    expect(hideRoom(0.5)).toBe(true);
  });
});

describe('光・床・白飛び', () => {
  it('光は頭 + (0, 0.8R, −0.3R)', () => {
    const l = lightWorld([0, 1.5, -2], 2.5);
    expect(l[0]).toBe(0); expect(l[1]).toBeCloseTo(3.5); expect(l[2]).toBeCloseTo(-2.75);
  });
  it('床の円盤は最大 2m、絵の層の球面の内側', () => {
    expect(floorRadius(1.5, 2.5)).toBeCloseTo(1.96);
    const r = floorRadius(1.6, 2.2);
    expect(Math.hypot(r, 1.6)).toBeLessThan(2.2);
    expect(floorRadius(3, 2.5)).toBe(0);
  });
  it('白飛び率：RGB すべて 250 以上の画素の割合', () => {
    const px = new Uint8Array([255, 255, 255, 255, 250, 251, 252, 255, 249, 255, 255, 255, 0, 0, 0, 255]);
    expect(whiteRatio(px)).toBe(0.5);
  });
});
