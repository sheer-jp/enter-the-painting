// 日本語の改行位置（11-07 作家「『踏み出すと／き』のような改行はしない。どんな文章でも改行位置にこだわる」）
// Intl.Segmenter（語）で切り、助詞・助動詞・句読点を前の語にくっつけて「文節」にする。改行は文節の間だけ
// 日本語以外は空白で自然に折り返せるので、文全体を 1 つの文節として返す（韓国語も。語の間の空白を残す）
// 文節の末尾に空白が付くことがある（英数混じり："Golden "）。表示側は空白を文節の外に出す（FloatingText）

const SEG: Intl.Segmenter | null = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('ja', { granularity: 'word' }) : null;
const KANJI_KATAKANA = /[一-鿿゠-ヿ㐀-䶿々ー]/;
// 前の語にくっつける短い語（ひらがなだけ・2 文字以下はすべてくっつける。3 文字以上でもこれらは付属語）
const ATTACH = new Set(['って', 'いる', 'ない', 'よう', 'する', 'じゃ', 'れる', 'られる', 'ます', 'です', 'でした', 'ました', 'ている', 'なら', 'けど', 'から', 'まで', 'だけ', 'など', 'たち', 'ごと']);
const OPEN = /^[（「『【〈《〔[(“‘]/;   // 行頭に来てよい開き括弧：次の語とくっつける
const CLOSE_END = /[」』）)】〉》〕\]”’]$/;   // 閉じ括弧で終わる記号

export function splitPhrases(text: string, lang: string): string[] {
  if (!text) return [];
  if (!lang.startsWith('ja') || !SEG) return [text];
  const out: string[] = [];
  let afterPunct = true;   // 文頭と句読点のあとは必ず新しい文節
  let pendingOpen = '';
  for (const s of SEG.segment(text)) {
    const t = s.segment;
    if (!s.isWordLike) {
      // 句読点・記号・空白：前にくっつける。開き括弧だけは次へ
      if (OPEN.test(t)) { pendingOpen += t; continue; }
      if (out.length) out[out.length - 1] += t; else out.push(t);
      // 閉じ括弧で終わる記号のあとは、付属語を前につける（「頂」へ。の「へ」を行頭にしない。REVIEW-1 P2）。句読点のあとは新しい文節
      afterPunct = CLOSE_END.test(t) ? false : /[、。，．！？!?…]/.test(t) || afterPunct;
      continue;
    }
    const hiraganaOnly = /^[぀-ゟー]+$/.test(t);
    const attach = !afterPunct && out.length > 0 && !pendingOpen && hiraganaOnly && (t.length <= 2 || ATTACH.has(t)) && !KANJI_KATAKANA.test(t);
    if (attach) out[out.length - 1] += t;
    else { out.push(pendingOpen + t); pendingOpen = ''; }
    afterPunct = false;
  }
  if (pendingOpen) { if (out.length) out[out.length - 1] += pendingOpen; else out.push(pendingOpen); }
  return out;
}

// 文節を幅に収めて行に分ける（VR の canvas 用。measure は文字列の幅を返す）
export function wrapPhrases(phrases: string[], maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const p of phrases) {
    const joiner = cur && /[A-Za-z0-9]$/.test(cur) && /^[A-Za-z0-9]/.test(p) ? ' ' : '';
    const next = cur + joiner + p;
    if (cur && measure(next) > maxWidth) { lines.push(cur); cur = p; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}
