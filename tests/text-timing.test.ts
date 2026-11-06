// 物語モードの文字の秒数（docs/EXPERIENCE.md 3 節 T3、T-1）
import { describe, it, expect } from 'vitest';
import { holdSeconds, screenTextTiming, HOLD_MIN_S, HOLD_MAX_S } from '../src/text/timing';

describe('文字の秒数', () => {
  it('留まる = 文字数 × 0.12 秒', () => {
    expect(holdSeconds('あ'.repeat(25))).toBeCloseTo(3.0);
    expect(holdSeconds('あ'.repeat(30))).toBeCloseTo(3.6);
  });
  it('短い文は最短 2.2 秒、長い文は最長 4.5 秒', () => {
    expect(holdSeconds('もっと上へ、もっと高く。')).toBe(HOLD_MIN_S);   // 12 文字
    expect(holdSeconds('')).toBe(HOLD_MIN_S);
    expect(holdSeconds('a'.repeat(80))).toBe(HOLD_MAX_S);
  });
  it('前後の空白は数えない', () => {
    expect(holdSeconds('  ' + 'あ'.repeat(25) + '  ')).toBeCloseTo(3.0);
  });
  it('現れる 0.5、消える 0.4、間 0.3', () => {
    const t = screenTextTiming('頂に行くぞ、という気持ちを、火のような赤に込めた。');
    expect(t.rise).toBe(0.5); expect(t.dissolve).toBe(0.4); expect(t.gap).toBe(0.3);
    expect(t.hold).toBeCloseTo(25 * 0.12);
  });
  it('1 文の合計は旧（6 + 最短 4 + 3 = 13 秒以上）より短い', () => {
    for (const s of ['あ'.repeat(12), 'あ'.repeat(30), 'a'.repeat(60)]) {
      const t = screenTextTiming(s);
      expect(t.rise + t.hold + t.dissolve + t.gap).toBeLessThanOrEqual(5.7);
    }
  });
});
