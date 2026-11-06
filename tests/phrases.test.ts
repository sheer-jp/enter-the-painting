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
});

describe('wrapPhrases', () => {
  it('幅に収まるよう文節の間だけで折り返す', () => {
    const ph = ['新しい', 'ことに', '踏み出すとき、', 'ちょっと', '怖くて、', 'でも', 'わくわくする。'];
    expect(wrapPhrases(ph, 12, (s) => s.length)).toEqual(['新しいことに', '踏み出すとき、ちょっと', '怖くて、でも', 'わくわくする。']);
  });
});
