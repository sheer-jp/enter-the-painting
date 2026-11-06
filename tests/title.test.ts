// 題名の主従（11-07 作家）：日本語では ja 主・en 従、それ以外の言語では en 主・ja 従
import { describe, it, expect } from 'vitest';
import { titlePair } from '../src/i18n';

describe('titlePair', () => {
  const itadaki = { ja: '頂', en: 'Itadaki' };
  it('日本語では日本語が主、英語が従', () => {
    expect(titlePair(itadaki, 'ja')).toEqual({ main: '頂', sub: 'Itadaki', mainLatin: false });
  });
  it('英語では英語が主、日本語が従', () => {
    expect(titlePair(itadaki, 'en')).toEqual({ main: 'Itadaki', sub: '頂', mainLatin: true });
  });
  it('日本語以外の言語（韓国語）でも英語が主、日本語が従', () => {
    expect(titlePair(itadaki, 'ko')).toEqual({ main: 'Itadaki', sub: '頂', mainLatin: true });
  });
  it('ja と en が同じなら従は無し', () => {
    expect(titlePair({ ja: 'Harmoney', en: 'Harmoney' }, 'fr')).toEqual({ main: 'Harmoney', sub: '', mainLatin: true });
    expect(titlePair({ ja: 'Harmoney', en: 'Harmoney' }, 'ja')).toEqual({ main: 'Harmoney', sub: '', mainLatin: false });
  });
  it('英語が無ければ日本語を主に', () => {
    expect(titlePair({ ja: '本能' }, 'de')).toEqual({ main: '本能', sub: '', mainLatin: false });
  });
});
