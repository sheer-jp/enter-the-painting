import { describe, it, expect } from 'vitest';
import { kmeans, toHex, textColor, backColor } from '../scripts/generate/color.js';
import { structureTensorFlow, motionFromFlow } from '../scripts/generate/flow.js';
import { homographyFromUnitSquare, invert3, paintingQuadOnWall, paintingRectFromScale, fractionOf, confidenceFrom, scaleFromReferences, roomTexts } from '../scripts/generate/rooms.js';
import { key } from '../scripts/generate/translate.js';
import { normalizeLang, pickLang } from '../src/i18n/normalize';

describe('主要色', () => {
  it('2 色の画像から 2 色を面積順に取る', () => {
    const px = new Uint8Array(100 * 3);
    for (let i = 0; i < 100; i++) { const red = i < 70; px[i * 3] = red ? 250 : 10; px[i * 3 + 1] = red ? 10 : 10; px[i * 3 + 2] = red ? 10 : 240; }
    const p = kmeans(px, 2);
    expect(p.length).toBe(2);
    expect(p[0].area).toBeCloseTo(0.7, 1);
    expect(toHex(p[0].rgb)).toBe('#fa0a0a');
  });
  it('文字色は最も明るい色をさらに明るく、基調色は面積最大の色を暗く', () => {
    const palette = [{ rgb: [100, 50, 20], area: 0.6 }, { rgb: [200, 200, 180], area: 0.4 }];
    expect(textColor(palette)).toBe('#e9e9e1');
    expect(backColor(palette)).toBe('#231207');
  });
});

describe('筆致の流れ場', () => {
  it('水平の縞では筆致の方向が水平になる', () => {
    const w = 32, h = 32; const g = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = (Math.floor(y / 4) % 2) * 200;
    const f = structureTensorFlow(g, w, h, 2);
    const i = 16 * w + 16;
    expect(Math.abs(f.cos[i])).toBeGreaterThan(0.95);   // 水平（±）
    expect(Math.abs(f.sin[i])).toBeLessThan(0.3);
  });
  it('平坦な画像では強さが 0、動きは最小', () => {
    const w = 16, h = 16; const g = new Float32Array(w * h).fill(120);
    const f = structureTensorFlow(g, w, h, 2);
    expect(Math.max(...f.str)).toBe(0);
    expect(motionFromFlow(f).speed).toBe(0.25);
  });
});

describe('部屋の射影', () => {
  it('単位正方形 → 4 点 の射影は角を正しく写す', () => {
    const q = [[10, 20], [110, 25], [100, 120], [12, 110]] as [[number, number], [number, number], [number, number], [number, number]];
    const H = homographyFromUnitSquare(q);
    const map = (u: number, v: number) => { const x = H[0] * u + H[1] * v + H[2], y = H[3] * u + H[4] * v + H[5], w = H[6] * u + H[7] * v + H[8]; return [x / w, y / w]; };
    expect(map(0, 0)[0]).toBeCloseTo(10); expect(map(1, 0)[1]).toBeCloseTo(25); expect(map(1, 1)[0]).toBeCloseTo(100); expect(map(0, 1)[1]).toBeCloseTo(110);
    const Hi = invert3(H);
    const [x, y] = map(0.3, 0.7);
    const w = Hi[6] * x + Hi[7] * y + Hi[8];
    expect((Hi[0] * x + Hi[1] * y + Hi[2]) / w).toBeCloseTo(0.3); expect((Hi[3] * x + Hi[4] * y + Hi[5]) / w).toBeCloseTo(0.7);
  });
  it('壁幅 300cm の正面の壁に 30cm の絵は幅 1/10 で置かれる', () => {
    const wall = { corners_px: [[0, 0], [1000, 0], [1000, 600], [0, 600]], width_cm: 300, hang_center_ratio: [0.5, 0.5] };
    const q = paintingQuadOnWall(wall, [30, 18]);
    expect(q[1][0] - q[0][0]).toBeCloseTo(100);
    expect(q[3][1] - q[0][1]).toBeCloseTo(60);
  });
  it('px/cm=4 で 50×60cm の絵は 200×240px、中心は床から 150cm 上', () => {
    const def = { scale: { px_per_cm: 4 }, hang: { x_px: 500, floor_y_px: 800, center_from_floor_cm: 150 } };
    const q = paintingRectFromScale(def, [50, 60]);
    expect(q[1][0] - q[0][0]).toBeCloseTo(200);
    expect(q[3][1] - q[0][1]).toBeCloseTo(240);
    expect((q[0][0] + q[2][0]) / 2).toBeCloseTo(500);
    expect((q[0][1] + q[2][1]) / 2).toBeCloseTo(200);
    expect(q[2][0]).toBeGreaterThan(q[3][0]); // 左上から時計回り
  });
});

describe('大きさの伝え方（比較の一文と信頼度）', () => {
  const table = {
    door_interior: { height_cm: 200, width_cm: 78, label: { ja: 'ドア', en: 'the door' } },
    ceiling: { height_cm: 240, label: { ja: '部屋の天井', en: 'the ceiling' } },
    kettle: { height_cm: 24, label: { ja: 'ケトル', en: 'the kettle' } },
  };
  it('比率を身近な分数に丸める', () => {
    expect(fractionOf(0.33).ja).toBe('約 3 分の 1');
    expect(fractionOf(0.5).ja).toBe('約半分');
    expect(fractionOf(1.0).ja).toBe('ほぼ同じ');
    expect(fractionOf(1.4).ja).toBe('約 1.4 倍');
    expect(fractionOf(0.7).ja).toBe('約 3 分の 2');
    expect(fractionOf(0.25).ja).toBe('約 4 分の 1');
    expect(fractionOf(0.42).ja).toBe('約 0.4 倍');
    expect(fractionOf(0.33).en).toBe('about one third');
  });
  it('信頼度：ずれ 8% 以内 high、15% 以内 mid、それ以上か基準が 1 つなら low', () => {
    expect(confidenceFrom(0.03, 2)).toBe('high');
    expect(confidenceFrom(0.08, 2)).toBe('high');
    expect(confidenceFrom(0.12, 2)).toBe('mid');
    expect(confidenceFrom(0.2, 2)).toBe('low');
    expect(confidenceFrom(0, 1)).toBe('low');
  });
  it('主の基準物で px/cm を決め、他とのずれから信頼度を出す', () => {
    const s = scaleFromReferences([{ ref: 'door_interior.height', px: 725, primary: true }, { ref: 'ceiling.height', px: 845 }], table);
    expect(s.px_per_cm).toBeCloseTo(3.625);
    expect(s.deviation).toBeCloseTo(0.029, 2);
    expect(s.confidence).toBe('high');
    expect(() => scaleFromReferences([{ ref: 'piano.height', px: 100 }], table)).toThrow();
  });
  it('比較の一文：馴染みのある物（ドア）を選び、数字を出さない。2 つ目は実寸つき', () => {
    const t = roomTexts({ references: [{ ref: 'ceiling.height', px: 845 }, { ref: 'door_interior.height', px: 725, primary: true }], table, sizeCm: [53, 65.2], confidence: 'high', wallWidthCm: 323, centerFromFloorCm: 150 });
    expect(t.compare!.ja).toBe('このドアの約 3 分の 1 の高さ。');
    expect(t.compare!.en).toBe('About one third the height of the door.');
    expect(t.compare2!.ja).toBe('この部屋の天井（約 240 cm）の約 4 分の 1 の高さ。');
    expect(t.about.ja).toBe('壁の幅は約 3.2 m。目の高さ（床から約 150 cm）に掛けています。');
    expect(t.primary_ref).toBe('door_interior');
  });
  it('信頼度 low は比較の一文に「寸法は目安」を添える', () => {
    const t = roomTexts({ references: [{ ref: 'kettle.height', px: 200, primary: true }], table, sizeCm: [24.2, 33.3], confidence: 'low', wallWidthCm: 137, centerFromFloorCm: 140 });
    expect(t.compare!.ja).toBe('このケトルの約 1.4 倍の高さ（寸法は目安）。');
    expect(t.compare2).toBeNull();
  });
});

describe('言語', () => {
  it('端末の言語タグを 10 言語に正規化する', () => {
    expect(normalizeLang('zh-TW')).toBe('zh-Hant'); expect(normalizeLang('zh-HK')).toBe('zh-Hant'); expect(normalizeLang('zh-Hant-TW')).toBe('zh-Hant');
    expect(normalizeLang('zh-CN')).toBe('zh-Hans'); expect(normalizeLang('zh')).toBe('zh-Hans');
    expect(normalizeLang('pt-BR')).toBe('pt'); expect(normalizeLang('en-US')).toBe('en'); expect(normalizeLang('ja-JP')).toBe('ja');
    expect(normalizeLang('ar')).toBeNull(); expect(normalizeLang('')).toBeNull();
  });
  it('navigator.languages の順で最初に一致、無ければ en、強制があればそれ', () => {
    expect(pickLang(['ar', 'fr-CA', 'en'])).toBe('fr');
    expect(pickLang(['ar', 'he'])).toBe('en');
    expect(pickLang(['ja'], 'ko')).toBe('ko');
  });
  it('翻訳キャッシュの鍵は原文から決まる', () => {
    expect(key('海辺の町で描いた。')).toBe(key('海辺の町で描いた。'));
    expect(key('海辺の町で描いた。')).not.toBe(key('海辺の町で描いた'));
  });
});
