// 日本語の改行位置（文節）。11-07 作家「踏み出すと／き のような改行はしない」
import { describe, it, expect } from 'vitest';
import { splitPhrases, wrapPhrases } from '../src/text/phrases';

describe('splitPhrases', () => {
  it('助詞・助動詞・句読点は前の語につく', () => {
    expect(splitPhrases('新しいことに踏み出すとき、ちょっと怖くて、でもわくわくする。', 'ja')).toEqual(['新しい', 'ことに', '踏み出すとき、', 'ちょっと', '怖くて、', 'でも', 'わくわくする。']);
  });
  it('「踏み出すとき」の途中で切れない', () => {
    const ph = splitPhrases('新しいことに踏み出すとき、ちょっと怖くて、でもわくわくする。', 'ja');
    expect(ph.some((p) => p.endsWith('すと'))).toBe(false);   // 「踏み出すと」で切らない
    expect(ph.join('')).toBe('新しいことに踏み出すとき、ちょっと怖くて、でもわくわくする。');
  });
  it('ほかの文も文節で', () => {
    expect(splitPhrases('迷っているとき、道はひとつじゃないように見える。', 'ja')).toEqual(['迷っているとき、', '道は', 'ひとつじゃないように', '見える。']);
    expect(splitPhrases('もっと上へ、もっと高く。', 'ja')).toEqual(['もっと', '上へ、', 'もっと', '高く。']);
  });
  it('日本語以外はそのまま 1 つ', () => {
    expect(splitPhrases('Higher, and higher still.', 'en')).toEqual(['Higher, and higher still.']);
  });
  it('韓国語はそのまま 1 つ（語の間の空白を残す。REVIEW-1 P1-2）', () => {
    expect(splitPhrases('헤매고 있을 때는, 길이 하나가 아닌 것처럼 보인다.', 'ko')).toEqual(['헤매고 있을 때는, 길이 하나가 아닌 것처럼 보인다.']);
  });
  it('英数混じりの日本語：空白は失われない（表示側で文節の外に出す）', () => {
    const ph = splitPhrases('Golden Path を見る。', 'ja');
    expect(ph.join('')).toBe('Golden Path を見る。');
    expect(ph.some((p) => /\s/.test(p))).toBe(true);
    expect(splitPhrases('AI 生成のイメージです', 'ja').join('')).toBe('AI 生成のイメージです');
  });
  it('閉じ括弧のあとの助詞は前につく（「頂」へ。の「へ」を行頭にしない）', () => {
    expect(splitPhrases('「頂」へ。', 'ja')).toEqual(['「頂」へ。']);
    const ph = splitPhrases('作家は「頂」と呼んだ。', 'ja');
    expect(ph.some((p) => /^[とへにをはがも]/.test(p))).toBe(false);
    expect(ph.join('')).toBe('作家は「頂」と呼んだ。');
    // 句読点のあとは今までどおり新しい文節
    expect(splitPhrases('もっと上へ、もっと高く。', 'ja')).toEqual(['もっと', '上へ、', 'もっと', '高く。']);
  });
});

describe('wrapPhrases', () => {
  it('幅に収まるよう文節の間だけで折り返す', () => {
    const ph = ['新しい', 'ことに', '踏み出すとき、', 'ちょっと', '怖くて、', 'でも', 'わくわくする。'];
    expect(wrapPhrases(ph, 12, (s) => s.length)).toEqual(['新しいことに', '踏み出すとき、ちょっと', '怖くて、でも', 'わくわくする。']);
  });
});
