// 触れる強さと長さ、速さの呼吸（docs/EXPERIENCE.md 8.1・8.2）の数値
import { describe, it, expect } from 'vitest';
import { touchStroke, touchVortex, tapStrength, breathing } from '../src/fluid/Fluid';

describe('touchStroke', () => {
  it('押し始め：p=0.5 で力・半径とも 1 倍', () => {
    const m = touchStroke(0.5, 0);
    expect(m.force).toBeCloseTo(1);
    expect(m.radius).toBeCloseTo(1);
  });
  it('2 秒で沈みきる：半径 ×2、力 ×1.4（p=0.5）。それ以上は変わらない', () => {
    expect(touchStroke(0.5, 2).radius).toBeCloseTo(2);
    expect(touchStroke(0.5, 2).force).toBeCloseTo(1.4);
    expect(touchStroke(0.5, 10)).toEqual(touchStroke(0.5, 2));
  });
  it('強さ：p=0 → 力 0.6・半径 0.7、p=1 → 力 1.4・半径 1.3', () => {
    expect(touchStroke(0, 0).force).toBeCloseTo(0.6);
    expect(touchStroke(0, 0).radius).toBeCloseTo(0.7);
    expect(touchStroke(1, 0).force).toBeCloseTo(1.4);
    expect(touchStroke(1, 0).radius).toBeCloseTo(1.3);
  });
});

describe('touchVortex', () => {
  it('0.4 秒までは渦なし', () => {
    expect(touchVortex(1, 0)).toBeNull();
    expect(touchVortex(1, 0.4)).toBeNull();
  });
  it('2.9 秒で育ちきる：強さ 0.35 × (0.5 + 0.5p)、半径 0.12', () => {
    const v = touchVortex(1, 2.9)!;
    expect(v.strength).toBeCloseTo(0.35);
    expect(v.radius).toBeCloseTo(0.12);
    expect(touchVortex(0, 10)!.strength).toBeCloseTo(0.175);
  });
  it('途中：1.65 秒で半分', () => {
    const v = touchVortex(1, 1.65)!;
    expect(v.strength).toBeCloseTo(0.175);
    expect(v.radius).toBeCloseTo(0.08);
  });
});

describe('tapStrength', () => {
  it('0.1 秒 → 50、0.4 秒 → 90、範囲外は端の値', () => {
    expect(tapStrength(0)).toBe(50);
    expect(tapStrength(0.1)).toBeCloseTo(50);
    expect(tapStrength(0.25)).toBeCloseTo(70);
    expect(tapStrength(0.4)).toBeCloseTo(90);
    expect(tapStrength(1)).toBe(90);
  });
});

describe('breathing', () => {
  it('tempo 0 では常に 1（今までどおり）', () => {
    for (let t = 0; t < 200; t += 3.7) expect(breathing(t, 0)).toBe(1);
  });
  it('tempo 0.6 では 0.7〜1.3 の中で、止まらない', () => {
    let lo = Infinity, hi = -Infinity;
    for (let t = 0; t < 37 * 23; t += 0.1) { const b = breathing(t, 0.6); lo = Math.min(lo, b); hi = Math.max(hi, b); }
    expect(lo).toBeGreaterThanOrEqual(0.7 - 1e-9);
    expect(hi).toBeLessThanOrEqual(1.3 + 1e-9);
    expect(hi - lo).toBeGreaterThan(0.4);
  });
});
