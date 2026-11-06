// 気分から絵をすすめる：出力の解釈（parse.ts）とルールだけの版（rules.ts）。docs/RECOMMEND.md 8.8
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { splitRecommendation, resolveRecommendation, parseRecommendEvent, reasonText } from '../src/recommend/parse';
import { recommendByRules, targetAxes, buildReason, pickMoods, type Catalog } from '../src/recommend/rules';

const catalog: Catalog = JSON.parse(readFileSync(new URL('./fixtures/catalog.json', import.meta.url), 'utf8'));

describe('splitRecommendation', () => {
  it('JSON が無ければ文だけ', () => {
    expect(splitRecommendation('朝の光が入る部屋ですね。どんな色が落ち着きますか。')).toEqual({ prose: '朝の光が入る部屋ですね。どんな色が落ち着きますか。', json: null });
  });

  it('文のあとの 1 行の JSON を取り出す', () => {
    const r = splitRecommendation('それなら、この絵を。\n{"recommend":"harmoney","alt":"sample-blue"}');
    expect(r.prose).toBe('それなら、この絵を。');
    expect(r.json).toEqual({ recommend: 'harmoney', alt: 'sample-blue' });
  });

  it('alt が null・空・無いときは null', () => {
    expect(splitRecommendation('a\n{"recommend":"x","alt":null}').json).toEqual({ recommend: 'x', alt: null });
    expect(splitRecommendation('a\n{"recommend":"x","alt":""}').json).toEqual({ recommend: 'x', alt: null });
    expect(splitRecommendation('a\n{"recommend":"x"}').json).toEqual({ recommend: 'x', alt: null });
  });

  it('ストリーム途中：{"recommend" から後ろは出さない（JSON はまだ null）', () => {
    expect(splitRecommendation('この絵を。\n{"recommend":"harm')).toEqual({ prose: 'この絵を。', json: null });
  });

  it('ストリーム途中：JSON の始まりの断片（{ や {"rec）も出さない', () => {
    expect(splitRecommendation('この絵を。\n{').prose).toBe('この絵を。');
    expect(splitRecommendation('この絵を。\n{"rec').prose).toBe('この絵を。');
    // 文の中の普通の括弧は残す
    expect(splitRecommendation('色 {赤} と青').prose).toBe('色 {赤} と青');
  });

  it('規則に反した ``` や空白付きの JSON も読む', () => {
    const r = splitRecommendation('この絵を。\n```json\n{ "recommend": "sample-blue", "alt": null }\n```');
    expect(r.prose).toBe('この絵を。');
    expect(r.json).toEqual({ recommend: 'sample-blue', alt: null });
  });

  it('壊れた JSON は null', () => {
    expect(splitRecommendation('x\n{"recommend": harmoney}').json).toBeNull();
    expect(splitRecommendation('x\n{"recommend": 3}').json).toBeNull();
  });
});

describe('parseRecommendEvent（ツール呼び出しの経路）', () => {
  it('data: {"recommend": {...}} の中身を受ける', () => {
    const r = parseRecommendEvent({ recommend: 'harmoney', alt: 'sample-blue', reason: { ja: '朝の光に。', en: 'For morning light.' } });
    expect(r).toEqual({ recommend: 'harmoney', alt: 'sample-blue', reason: { ja: '朝の光に。', en: 'For morning light.' } });
    expect(resolveRecommendation(r!, catalog)).toEqual({ id: 'harmoney', alt: 'sample-blue' });
  });
  it('alt の null、reason の欠け、形の合わないものを扱う', () => {
    expect(parseRecommendEvent({ recommend: 'x', alt: null })).toEqual({ recommend: 'x', alt: null });
    expect(parseRecommendEvent({ recommend: 'x', alt: null, reason: { ja: 1 } })).toEqual({ recommend: 'x', alt: null });
    expect(parseRecommendEvent({ recommend: 3 })).toBeNull();
    expect(parseRecommendEvent(null)).toBeNull();
    expect(parseRecommendEvent('harmoney')).toBeNull();
  });
  it('reasonText は ja なら ja、ほかは en。理由が無ければ空', () => {
    const r = { recommend: 'x', alt: null, reason: { ja: 'あ', en: 'a' } };
    expect(reasonText(r, 'ja')).toBe('あ');
    expect(reasonText(r, 'fr')).toBe('a');
    expect(reasonText({ recommend: 'x', alt: null }, 'ja')).toBe('');
  });
  it('両方の経路：ツールが無くても文の中の JSON は従来通り拾える', () => {
    expect(splitRecommendation('この絵を。\n{"recommend":"harmoney","alt":null}').json).toEqual({ recommend: 'harmoney', alt: null });
  });
});

describe('resolveRecommendation', () => {
  it('カタログに無い id は最初の作品', () => {
    expect(resolveRecommendation({ recommend: 'nope', alt: null }, catalog)).toEqual({ id: 'harmoney', alt: null });
  });
  it('alt がカタログに無い・同じ id なら null', () => {
    expect(resolveRecommendation({ recommend: 'sample-blue', alt: 'nope' }, catalog)).toEqual({ id: 'sample-blue', alt: null });
    expect(resolveRecommendation({ recommend: 'harmoney', alt: 'harmoney' }, catalog)).toEqual({ id: 'harmoney', alt: null });
    expect(resolveRecommendation({ recommend: 'harmoney', alt: 'sample-blue' }, catalog)).toEqual({ id: 'harmoney', alt: 'sample-blue' });
  });
});

describe('rules', () => {
  it('朝・あたたかい・にぎやか → 暖かく明るい作品、次点がもう一方', () => {
    expect(recommendByRules(catalog, { time: 'morning', color: 'warm', mood: 'lively' })).toEqual({ id: 'harmoney', alt: 'sample-blue' });
    expect(recommendByRules(catalog, { time: 'day', color: 'vivid', mood: 'lively' }).id).toBe('harmoney');
  });

  it('夜・涼しい・静か → 冷たく暗い作品', () => {
    expect(recommendByRules(catalog, { time: 'night', color: 'cool', mood: 'quiet' })).toEqual({ id: 'sample-blue', alt: 'harmoney' });
    expect(recommendByRules(catalog, { time: 'night', color: 'soft', mood: 'quiet' }).id).toBe('sample-blue');
  });

  it('作品が 1 点なら alt は null', () => {
    const one = { ...catalog, works: catalog.works.slice(0, 1) };
    expect(recommendByRules(one, { time: 'night', color: 'cool', mood: 'quiet' })).toEqual({ id: 'harmoney', alt: null });
  });

  it('3 軸への写し方（8.6）', () => {
    expect(targetAxes({ time: 'morning', color: 'warm', mood: 'quiet' })).toEqual({ warmth: 0.85, brightness: 0.8, energy: 0.25 });
    const night = targetAxes({ time: 'night', color: 'cool', mood: 'lively' });
    expect(night.warmth).toBeCloseTo(0.35); expect(night.brightness).toBe(0.3); expect(night.energy).toBe(0.8);
    // 色で energy を決めていれば、静か/にぎやかと平均
    expect(targetAxes({ time: 'day', color: 'vivid', mood: 'quiet' }).energy).toBeCloseTo((0.85 + 0.25) / 2);
    expect(targetAxes({ time: 'night', color: 'warm', mood: 'quiet' }).warmth).toBe(1);   // 0..1 に収める
  });

  it('理由の文：mood 2 つ / 1 つ / 無し', () => {
    expect(buildReason('{title}。{mood1}、{mood2}。', 'Harmoney', ['朝の光', 'にぎやかな静けさ'])).toBe('Harmoney。朝の光、にぎやかな静けさ。');
    expect(buildReason('{title}. {mood1}, {mood2}.', 'Harmoney', ['Morning light'])).toBe('Harmoney. Morning light.');
    expect(buildReason('{title}。{mood1}、{mood2}。', 'Harmoney', [])).toBe('Harmoney');
  });

  it('moods は閲覧者の言語、無ければ en → ja', () => {
    expect(pickMoods(catalog.works[0], 'ja')[0]).toBe('朝の光');
    expect(pickMoods(catalog.works[0], 'fr')[0]).toBe('Morning light');
    expect(pickMoods({ ...catalog.works[0], moods: { ja: ['朝'] } }, 'de')).toEqual(['朝']);
    expect(pickMoods({ ...catalog.works[0], moods: undefined }, 'ja')).toEqual([]);
  });
});
