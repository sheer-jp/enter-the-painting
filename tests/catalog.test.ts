import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { axesFromPalette, hexToHsl, perLangList, buildCatalog } from '../scripts/generate/catalog.js';

describe('カタログの軸（docs/RECOMMEND.md 8.3）', () => {
  it('赤橙の絵は warmth 0.9 以上', () => {
    expect(axesFromPalette(['#e0502a', '#f07a30', '#c8401e']).warmth).toBeGreaterThanOrEqual(0.9);
  });
  it('青の絵は warmth 0.2 以下', () => {
    expect(axesFromPalette(['#1f4fa0', '#2a6ad0', '#103070']).warmth).toBeLessThanOrEqual(0.2);
  });
  it('灰色の絵は warmth 0.5、色相の散らばり 0', () => {
    const a = axesFromPalette(['#808080', '#a0a0a0', '#404040']);
    expect(a.warmth).toBe(0.5);
    expect(a.energy).toBeLessThan(0.05);
  });
  it('暗い絵でも brightness は 0 に張り付かない', () => {
    const a = axesFromPalette(['#101010', '#1a120c', '#0c1018']);
    expect(a.brightness).toBeGreaterThan(0.05);
    expect(a.brightness).toBeLessThan(0.4);
  });
  it('鮮やかで色相が散らばる絵は energy が高い。vorticity があれば半分混ぜる', () => {
    const vivid = axesFromPalette(['#ff0000', '#00ff00', '#0000ff']);
    const calm = axesFromPalette(['#a09080', '#a89888']);
    expect(vivid.energy).toBeGreaterThan(0.9);
    expect(calm.energy).toBeLessThan(0.2);
    expect(axesFromPalette(['#ff0000', '#00ff00', '#0000ff'], undefined, 0).energy).toBeCloseTo(vivid.energy / 2, 1);
  });
  it('重みがあれば重み付き平均', () => {
    const warm = axesFromPalette(['#e0502a', '#1f4fa0'], [0.9, 0.1]).warmth;
    const cool = axesFromPalette(['#e0502a', '#1f4fa0'], [0.1, 0.9]).warmth;
    expect(warm).toBeGreaterThan(0.75);
    expect(cool).toBeLessThan(0.25);
  });
  it('0〜1 に収まる', () => {
    for (const p of [['#ffffff'], ['#000000'], ['#ff8800', '#0088ff', '#88ff00', '#ff0088']]) {
      for (const v of Object.values(axesFromPalette(p, undefined, 1.5))) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    }
  });
  it('HSL の変換', () => {
    const c = hexToHsl('#ff8000');
    expect(c.h).toBeCloseTo(30, 0);
    expect(c.s).toBeCloseTo(1, 2);
  });
});

describe('言語ごとの並び', () => {
  it('欠けた言語は en に落ちる', () => {
    const out = perLangList([{ ja: 'あ', en: 'a', fr: 'a-fr' }, { ja: 'い', en: 'i' }]);
    expect(out.ja).toEqual(['あ', 'い']);
    expect(out.fr).toEqual(['a', 'i']);
    expect(out.ko).toEqual(['a', 'i']);
    expect(Object.keys(out)).toHaveLength(10);
  });
});

describe('buildCatalog', () => {
  it('space.json と config から 8.3 の形を作る（API キーなし）', async () => {
    const root = mkdtempSync(join(tmpdir(), 'catalog-'));
    mkdirSync(join(root, 'recommend'));
    writeFileSync(join(root, 'recommend', 'config.json'), JSON.stringify({ intro: { ja: '紹介', en: 'Intro' }, openers: { ja: ['朝', '夜'], en: ['Morning', 'Night'] }, turns: [2, 4] }));
    const gen = join(root, 'works', 'w1', 'generated');
    mkdirSync(gen, { recursive: true });
    writeFileSync(join(root, 'works', 'w1', 'work.json'), JSON.stringify({ id: 'w1', moods: { ja: ['朝の光'], en: ['Morning light'] } }));
    writeFileSync(join(gen, 'space.json'), JSON.stringify({
      id: 'w1', title: { ja: '題', en: 'Title' }, size_cm: [10, 20], size_label: 'F0', year: 2025, availability: 'available',
      palette: ['#e0502a', '#1f4fa0'], fluid: { vorticity: 0.5 },
      messages: [{ at: 0, ja: '一', en: 'One' }], story: { ja: '物語', en: 'Story' },
    }));
    const c = await buildCatalog(root, { apiKey: '' });
    expect(c.version).toBe(1);
    expect(c.turns).toEqual([2, 4]);
    expect(c.artist.intro.ja).toBe('紹介');
    expect(c.artist.intro.de).toBe('Intro');
    expect(c.openers.ja).toEqual(['朝', '夜']);
    expect(c.openers.fr).toEqual(['Morning', 'Night']);
    expect(existsSync(join(root, 'recommend', 'translations.json'))).toBe(true);
    const w = c.works[0];
    expect(w.id).toBe('w1');
    expect(w.image).toBe('works/w1/generated/painting_1024.jpg');
    expect(w.url).toBe('w/w1/');
    expect(w.moods.ja).toEqual(['朝の光']);
    expect(w.moods.it).toEqual(['Morning light']);
    expect(w.messages.ja).toEqual(['一']);
    expect(w.messages.en).toEqual(['One']);
    expect(Object.keys(w.axes).sort()).toEqual(['brightness', 'energy', 'warmth']);
    expect(w.story.en).toBe('Story');
  });
});
