import { describe, it, expect } from 'vitest';
import { clampOffset, quadRect } from '../src/ui/lightbox';

// 部屋で見る：拡大表示で絵を動かす範囲（docs/EXPERIENCE.md 4 節「絵を動かせる」）
describe('絵の移動量のクランプ', () => {
  const r = quadRect([[635, 195], [815, 195], [815, 349], [635, 349]]);   // itadaki × entrance-house
  const [iw, ih] = [1586, 992];
  it('4 隅から軸に平行な矩形', () => {
    expect(r).toEqual({ x0: 635, y0: 195, x1: 815, y1: 349 });
  });
  it('範囲の中ならそのまま', () => {
    expect(clampOffset(100, -50, r, iw, ih)).toEqual([100, -50]);
  });
  it('左上・右下の端で止まる（部屋の画像からはみ出さない）', () => {
    expect(clampOffset(-9999, -9999, r, iw, ih)).toEqual([-635, -195]);
    expect(clampOffset(9999, 9999, r, iw, ih)).toEqual([iw - 815, ih - 349]);
  });
  it('どこに動かしても絵の大きさは変わらない', () => {
    for (const [dx, dy] of [[-9999, 0], [0, 9999], [123.4, -56.7]]) {
      const [ox, oy] = clampOffset(dx, dy, r, iw, ih);
      const x0 = r.x0 + ox, x1 = r.x1 + ox, y0 = r.y0 + oy, y1 = r.y1 + oy;
      expect(x1 - x0).toBe(180); expect(y1 - y0).toBe(154);
      expect(x0).toBeGreaterThanOrEqual(0); expect(y0).toBeGreaterThanOrEqual(0);
      expect(x1).toBeLessThanOrEqual(iw); expect(y1).toBeLessThanOrEqual(ih);
    }
  });
  it('絵が画像より大きいときは中央に（壊れない）', () => {
    expect(clampOffset(50, 50, { x0: -10, y0: 0, x1: 110, y1: 50 }, 100, 50)).toEqual([0, 0]);
  });
});

// 動かせる範囲（move_px）：壁の範囲に限る（11-07 作家「椅子の手前に絵が来るとおかしい」）
import { clampOffset as clampB } from '../src/ui/lightbox';
describe('clampOffset with bounds', () => {
  const r = { x0: 100, y0: 100, x1: 200, y1: 180 };
  it('壁の範囲より下（家具の手前）には下げられない', () => {
    expect(clampB(0, 500, r, 1000, 1000, false, [50, 0, 900, 400])).toEqual([0, 220]);
  });
  it('壁の左右の端で止まる', () => {
    expect(clampB(-500, 0, r, 1000, 1000, false, [50, 0, 900, 400])).toEqual([-50, 0]);
    expect(clampB(5000, 0, r, 1000, 1000, false, [50, 0, 900, 400])).toEqual([700, 0]);
  });
  it('範囲が無ければ画像全体', () => {
    expect(clampB(5000, 5000, r, 1000, 1000)).toEqual([800, 820]);
  });
});
