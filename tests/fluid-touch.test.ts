// 触れる強さと長さ、速さの呼吸（docs/EXPERIENCE.md 8.1・8.2）の数値
import { describe, it, expect } from 'vitest';
import { touchStroke, touchVortex, tapStrength, breathing, driveDirVector, DRIVE_DIR_WEIGHT } from '../src/fluid/Fluid';
import { shadingUniforms, lookOf, DEFAULT_LOOK, SHADING } from '../src/fluid/shading';

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

describe('driveDirVector（docs/FLUID_PER_WORK.md F-2）', () => {
  it('正規化して重み 0.3 をかける', () => {
    const [x, y] = driveDirVector([0, 5]);
    expect(x).toBeCloseTo(0); expect(y).toBeCloseTo(DRIVE_DIR_WEIGHT);
    const d = driveDirVector([1, 1]);
    expect(Math.hypot(d[0], d[1])).toBeCloseTo(0.3);
  });
  it('無い・長さ 0・不正なら [0, 0]（従来どおり）', () => {
    expect(driveDirVector(undefined)).toEqual([0, 0]);
    expect(driveDirVector(null)).toEqual([0, 0]);
    expect(driveDirVector([0, 0])).toEqual([0, 0]);
    expect(driveDirVector([NaN, 1])).toEqual([0, 0]);
  });
});

describe('shadingUniforms（docs/FLUID_PER_WORK.md F-1）', () => {
  const fluid = { texture: null, thickness: null } as never;
  it('swell / dots / bleed が入る。既定は 0', () => {
    const u = shadingUniforms(fluid, lookOf({ swell: 0.6, dots: 0.8, bleed: 0.4 }));
    expect(u.uSwell.value).toBe(0.6); expect(u.uDots.value).toBe(0.8); expect(u.uBleed.value).toBe(0.4);
    const d = shadingUniforms(fluid, lookOf());
    expect(d.uSwell.value).toBe(0); expect(d.uDots.value).toBe(0); expect(d.uBleed.value).toBe(0);
    expect(DEFAULT_LOOK.swell).toBe(0);
  });
  it('光の受け口：uLightMode 0（ビュー空間固定）、uReliefScale 1', () => {
    const u = shadingUniforms(fluid, lookOf());
    expect(u.uLightMode.value).toBe(0); expect(u.uReliefScale.value).toBe(1);
    expect(u.uLightWorld.value.toArray()).toEqual([0, 0, 0]);
    for (const n of ['uSwell', 'uDots', 'uBleed', 'uLightWorld', 'uLightMode', 'uReliefScale']) expect(SHADING).toContain(`uniform ${n === 'uLightWorld' ? 'vec3' : 'float'} ${n};`);
  });
});
