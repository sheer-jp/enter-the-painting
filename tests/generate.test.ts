import { describe, it, expect } from 'vitest';
import { kmeans, toHex, textColor, backColor } from '../scripts/generate/color.js';
import { structureTensorFlow, motionFromFlow } from '../scripts/generate/flow.js';
import { homographyFromUnitSquare, invert3, paintingQuadOnWall } from '../scripts/generate/rooms.js';
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
