import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { paintingRectFromScale, placeQuad, placeSidesPx, drawPlaceSides, warpOnto, scaleFromReferences, loadReferenceTable, roomTexts, PLACE, SIDE_BOTTOM_CM, SIDE_VIEW, CONTACT_SHADOW_CM } from '../scripts/generate/rooms.js';
import { clampOffset, quadRect } from '../src/ui/lightbox';

// 小さな絵は「掛ける」より「置く」（docs/PLACEMENT.md 6 節）
const readRoom = (n: string) => JSON.parse(readFileSync(new URL(`../rooms/${n}.json`, import.meta.url), 'utf8'));
const table = loadReferenceTable(new URL('../rooms', import.meta.url).pathname);

describe('置く場面の 4 隅', () => {
  const pxPerCm = 12;
  const hang = { place: 'easel', ledge_y_px: 800, x_px: 500 };
  const q = placeQuad(hang, [18, 14], pxPerCm);
  const [tl, tr, br, bl] = q;
  const band = placeSidesPx('easel', pxPerCm).bottom;

  it('easel：絵の底（面の下辺 + 側面の帯）が受けの y に乗る', () => {
    expect(bl[1]).toBeCloseTo(br[1]);
    expect(bl[1] + band).toBeCloseTo(800);
  });
  it('easel：上辺は下辺より 2〜4% 短い台形、高さは 0.96 倍', () => {
    const top = tr[0] - tl[0], bottom = br[0] - bl[0];
    expect(bottom).toBeCloseTo(18 * pxPerCm);
    expect(top / bottom).toBeGreaterThanOrEqual(0.96);
    expect(top / bottom).toBeLessThanOrEqual(0.98);
    expect(bl[1] - tl[1]).toBeCloseTo(14 * pxPerCm * 0.96);
    // 中心は x_px（左右対称）
    expect((tl[0] + tr[0]) / 2).toBeCloseTo(500); expect((bl[0] + br[0]) / 2).toBeCloseTo(500);
  });
  it('lean：高さ 0.97 倍、上辺はそのまま（長方形）、底は天板に', () => {
    const l = placeQuad({ place: 'lean', ledge_y_px: 900, x_px: 300 }, [18, 14], pxPerCm);
    expect(l[1][0] - l[0][0]).toBeCloseTo(l[2][0] - l[3][0]);
    expect(l[3][1] - l[0][1]).toBeCloseTo(14 * pxPerCm * 0.97);
    expect(l[3][1] + placeSidesPx('lean', pxPerCm).bottom).toBeCloseTo(900);
  });
  it('側面の帯と接地の影の大きさは cm から出る（下 2.5 cm × 見える割合、easel の右 1 cm、影 1.5 cm）', () => {
    for (const k of [8, 12.143, 20]) {
      const e = placeSidesPx('easel', k), l = placeSidesPx('lean', k);
      expect(e.bottom).toBeCloseTo(SIDE_BOTTOM_CM * SIDE_VIEW * k);
      expect(e.right).toBeCloseTo(1 * k);
      expect(l.right).toBe(0);
      expect(e.shadow).toBeCloseTo(CONTACT_SHADOW_CM * k);
    }
    expect(SIDE_BOTTOM_CM).toBe(2.5);
    expect(PLACE.easel.height).toBe(0.96); expect(PLACE.lean.height).toBe(0.97);
  });
  it('paintingRectFromScale は hang.place があれば置く場面の 4 隅を返す（画像幅の比率も効く）', () => {
    const def = { image_width_px: 1600, scale: { px_per_cm: 12 }, hang };
    expect(paintingRectFromScale(def, [18, 14], 1600)).toEqual(q);
    const half = paintingRectFromScale(def, [18, 14], 800);
    expect(half[3][1] + placeSidesPx('easel', 6).bottom).toBeCloseTo(400);
  });
  it('place が easel / lean 以外ならエラー', () => {
    expect(() => placeQuad({ place: 'hang', ledge_y_px: 1, x_px: 1 }, [1, 1], 1)).toThrow();
  });
});

describe('置く部屋（rooms/*.json）', () => {
  for (const name of ['desk-easel', 'shelf-lean', 'sideboard-easel']) {
    const def = readRoom(name);
    it(`${name}：絵の底が受けに乗り、壁の範囲に収まる（18×14 と 33.3×24.2）`, () => {
      const sc = scaleFromReferences(def.references, table);
      expect(['easel', 'lean']).toContain(def.hang.place);
      expect(def.suits_cm).toEqual([15, 45]);
      for (const size of [[18, 14], [33.3, 24.2]] as [number, number][]) {
        const q = paintingRectFromScale({ ...def, scale: { px_per_cm: sc.px_per_cm } }, size, def.image_width_px);
        const band = placeSidesPx(def.hang.place, sc.px_per_cm).bottom;
        expect(q[3][1] + band).toBeCloseTo(def.hang.ledge_y_px);
        const xs = def.wall.corners_px.map((p: number[]) => p[0]), ys = def.wall.corners_px.map((p: number[]) => p[1]);
        for (const [x, y] of q) {
          expect(x).toBeGreaterThanOrEqual(Math.min(...xs)); expect(x).toBeLessThanOrEqual(Math.max(...xs));
          expect(y).toBeGreaterThanOrEqual(Math.min(...ys)); expect(y).toBeLessThanOrEqual(Math.max(...ys));
        }
      }
    });
  }
  it('イーゼルの部屋は卓上イーゼル 28 cm が縮尺の主', () => {
    for (const n of ['desk-easel', 'sideboard-easel']) expect(readRoom(n).references.find((r: { primary?: boolean }) => r.primary).ref).toBe('tabletop_easel.height');
    expect(table.tabletop_easel.height_cm).toBe(28);
  });
  it('「掛ける」小部屋 4 つは disabled（理由の文字列）、玄関は残す', () => {
    for (const n of ['studio-desk', 'studio-shelf', 'studio-kitchen', 'studio-entrance']) expect(typeof readRoom(n).disabled).toBe('string');
    expect(readRoom('entrance-house').disabled).toBeUndefined();
  });
});

describe('置く部屋 v2（11-07：机のイーゼルを PC の真後ろに、玄関の靴箱の上を追加）', () => {
  it('entrance-console：玄関の靴箱の上。卓上イーゼルが主、靴箱の幅 90 cm が副で、絵の底が受けに乗り壁に収まる', () => {
    const def = readRoom('entrance-console');
    expect(def.category).toBe('studio');
    expect(def.hang.place).toBe('easel');
    expect(def.suits_cm).toEqual([15, 45]);
    expect(def.references.find((r: { primary?: boolean }) => r.primary).ref).toBe('tabletop_easel.height');
    expect(table.shoe_cabinet.width_cm).toBe(90);
    const sc = scaleFromReferences(def.references, table);
    expect(sc.deviation).toBeLessThan(0.15);
    const xs = def.wall.corners_px.map((p: number[]) => p[0]), ys = def.wall.corners_px.map((p: number[]) => p[1]);
    for (const size of [[18, 14], [33.3, 24.2]] as [number, number][]) {
      const q = paintingRectFromScale({ ...def, scale: { px_per_cm: sc.px_per_cm } }, size, def.image_width_px);
      expect(q[3][1] + placeSidesPx('easel', sc.px_per_cm).bottom).toBeCloseTo(def.hang.ledge_y_px);
      for (const [x, y] of q) {
        expect(x).toBeGreaterThanOrEqual(Math.min(...xs)); expect(x).toBeLessThanOrEqual(Math.max(...xs));
        expect(y).toBeGreaterThanOrEqual(Math.min(...ys)); expect(y).toBeLessThanOrEqual(Math.max(...ys));
      }
    }
  });
  it('desk-easel・entrance-console：絵の中心 x は受け桟の中心（±6px）、絵の底は受けの左右の端の中、壁の下端より上', () => {
    for (const n of ['desk-easel', 'entrance-console']) {
      const def = readRoom(n);
      const [l, r] = def.hang.ledge_x_px;
      expect(Math.abs(def.hang.x_px - (l + r) / 2)).toBeLessThanOrEqual(6);
      const sc = scaleFromReferences(def.references, table);
      const q = paintingRectFromScale({ ...def, scale: { px_per_cm: sc.px_per_cm } }, [18, 14], def.image_width_px);
      expect(q[3][0]).toBeGreaterThanOrEqual(l); expect(q[2][0]).toBeLessThanOrEqual(r);
      expect(def.hang.ledge_y_px).toBeLessThan(Math.max(...def.wall.corners_px.map((p: number[]) => p[1])));
    }
  });
});

describe('側面の帯と接地の影の描画', () => {
  // 白い壁 200×200 に、赤い絵（下端だけ青）を easel で置く
  const W = 200, H = 200;
  const room = { data: Buffer.alloc(W * H * 3, 230), width: W, height: H };
  const pw = 40, ph = 30;
  const pdata = Buffer.alloc(pw * ph * 3);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const o = (y * pw + x) * 3; if (y >= ph - 3) { pdata[o + 2] = 200; } else pdata[o] = 200; }
  const painting = { data: pdata, width: pw, height: ph };
  const pxPerCm = 4;
  const q = placeQuad({ place: 'easel', ledge_y_px: 150, x_px: 100 }, [18, 14], pxPerCm);
  const buf = warpOnto(room, painting, q, { shadow: 0 });
  drawPlaceSides(buf, W, H, painting, q, { place: 'easel', pxPerCm });
  const px = (x: number, y: number) => [...buf.subarray((y * W + x) * 3, (y * W + x) * 3 + 3)];
  const s = placeSidesPx('easel', pxPerCm);
  it('下辺の帯は絵の下端の色（青）を暗くしたもの', () => {
    const [r, g, b] = px(100, Math.floor(q[3][1] + s.bottom / 2));
    expect(b).toBeGreaterThan(80); expect(b).toBeLessThan(200 * 0.66); expect(r).toBeLessThan(30); expect(g).toBeLessThan(30);
  });
  it('帯の直下に接地の影（中心が濃く、端が薄い）', () => {
    const y = Math.floor(q[3][1] + s.bottom + 1);
    const center = px(100, y)[0], edge = px(Math.floor(q[2][0] + s.right + s.shadow * 0.8), y)[0];
    expect(center).toBeLessThan(200);
    expect(edge).toBeGreaterThan(center);
  });
  it('壁に落とす影（掛ける影）は無い：絵の上の壁は元の色', () => {
    expect(px(100, Math.floor(q[0][1]) - 3)).toEqual([230, 230, 230]);
  });
});

describe('置く場面の文章', () => {
  it('掛ける高さではなく、置いたことを書く', () => {
    const t = roomTexts({ references: readRoom('desk-easel').references, table, sizeCm: [18, 14], confidence: 'high', wallWidthCm: 120, centerFromFloorCm: 0, place: 'easel' });
    expect(t.about.ja).toContain('イーゼル');
    expect(t.about.ja).not.toContain('掛け');
    expect(t.compare?.ja).toContain('卓上イーゼル');
  });
});

describe('拡大表示：置く場面は横にだけ動かす', () => {
  const r = quadRect([[868, 622], [1086, 622], [1086, 786], [868, 786]]);
  it('縦の移動量は 0（下端は受けに乗ったまま）', () => {
    expect(clampOffset(100, -80, r, 1600, 1600, true)).toEqual([100, 0]);
    expect(clampOffset(-9999, 9999, r, 1600, 1600, true)).toEqual([-868, 0]);
  });
  it('掛ける場面は従来どおり縦にも動く', () => {
    expect(clampOffset(100, -80, r, 1600, 1600)).toEqual([100, -80]);
  });
});

// REVIEW-1 P1-3：shelf-lean だけ ledge_x_px が無く、壁の端まで横に動かせた
describe('置く部屋は受けの横の範囲（ledge_x_px）を持つ', () => {
  const dir = new URL('../rooms/', import.meta.url).pathname;
  const placed = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'REFERENCES.json')
    .map((f) => ({ f, def: JSON.parse(readFileSync(dir + f, 'utf8')) }))
    .filter(({ def }) => def.hang?.place);
  it('置く部屋が 1 つ以上ある', () => { expect(placed.length).toBeGreaterThan(0); });
  for (const { f, def } of placed) {
    it(`${f}：ledge_x_px は [x0, x1]（x0 < x1、画像の幅の中）で、最初の位置 x_px を含む`, () => {
      const lx = def.hang.ledge_x_px;
      expect(Array.isArray(lx) && lx.length === 2).toBe(true);
      expect(lx[0]).toBeLessThan(lx[1]);
      expect(lx[0]).toBeGreaterThanOrEqual(0);
      expect(lx[1]).toBeLessThanOrEqual(def.image_width_px);
      expect(def.hang.x_px).toBeGreaterThanOrEqual(lx[0]);
      expect(def.hang.x_px).toBeLessThanOrEqual(lx[1]);
    });
  }
});
