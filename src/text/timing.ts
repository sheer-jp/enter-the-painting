// 1 文の「現れる → 留まる → 消える → 次の文までの間」の秒数（docs/EXPERIENCE.md 3 節 T3。11-07 T-1 で改訂）
export interface TextTiming { rise: number; hold: number; dissolve: number; gap: number }

export const RISE_S = 0.5;          // 現れる
export const HOLD_PER_CHAR_S = 0.12; // 留まる：1 文字あたり
export const HOLD_MIN_S = 2.2;      // 留まる：最短
export const HOLD_MAX_S = 4.5;      // 留まる：最長
export const DISSOLVE_S = 0.4;      // 消える
export const GAP_S = 0.3;           // 次の文までの間

// 文字数は書記素ではなくコードポイントで数える（絵文字はほぼ出ない。サロゲートを 2 文字に数えないため）
export function holdSeconds(sentence: string): number {
  const n = Array.from(sentence.trim()).length;
  return Math.min(HOLD_MAX_S, Math.max(HOLD_MIN_S, n * HOLD_PER_CHAR_S));
}

// 物語モード（画面）の 1 文。prefers-reduced-motion でも同じ秒数（通常より長くはしない）
export function screenTextTiming(sentence: string): TextTiming {
  return { rise: RISE_S, hold: holdSeconds(sentence), dissolve: DISSOLVE_S, gap: GAP_S };
}
