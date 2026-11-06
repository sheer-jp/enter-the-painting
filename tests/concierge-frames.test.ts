// 受付のキャラクターのコマ列（A-1）と、受付の文節の改行（P-14）
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseFrameDef, phraseRuns, settledLength, FRAME_MS } from '../src/concierge/index';

describe('parseFrameDef（frames.json の 1 項目）', () => {
  it('従来の形（配列）は 1 コマ 120ms', () => {
    expect(parseFrameDef(['listening', 'blink', 'listening'])).toEqual({ seq: ['listening', 'blink', 'listening'], ms: [120, 120, 120] });
  });
  it('{ seq, ms } の形：ms が数ならすべてのコマ、配列ならコマごと（足りない分は既定）', () => {
    expect(parseFrameDef({ seq: ['a', 'b'], ms: 160 })).toEqual({ seq: ['a', 'b'], ms: [160, 160] });
    expect(parseFrameDef({ seq: ['a', 'b', 'c'], ms: [120, 160] })).toEqual({ seq: ['a', 'b', 'c'], ms: [120, 160, FRAME_MS] });
  });
  it('壊れたものは null（コマは使わない）', () => {
    expect(parseFrameDef([])).toBeNull();
    expect(parseFrameDef(['../x'])).toBeNull();
    expect(parseFrameDef({ seq: 'a' })).toBeNull();
    expect(parseFrameDef(null)).toBeNull();
    expect(parseFrameDef({ seq: ['a'], ms: -5 })).toEqual({ seq: ['a'], ms: [FRAME_MS] });
  });
});

describe('public/concierge/artist/frames.json', () => {
  const dir = new URL('../public/concierge/artist/', import.meta.url);
  const defs = JSON.parse(readFileSync(new URL('frames.json', dir), 'utf8')) as Record<string, unknown>;
  it('11-07 のコマ列がそろっている（nod / tilt / tilt2 / think / happy と従来の blink / wave / smileDeep）', () => {
    for (const k of ['blink', 'wave', 'smileDeep', 'nod', 'tilt', 'tilt2', 'think', 'happy']) expect(parseFrameDef(defs[k]), k).not.toBeNull();
    expect(parseFrameDef(defs.nod)!.seq).toEqual(['listening', 'nod-1', 'nod-2', 'nod-1', 'listening']);
    expect(parseFrameDef(defs.happy)!.seq).toEqual(['present', 'happy-1', 'happy-2', 'happy-1', 'present']);
    expect(parseFrameDef(defs.think)!.seq[0]).toBe('think-1');
  });
  it('どのコマにも 1x / 2x・上半身 / 全身・PNG / WebP の 8 枚がある', () => {
    const names = new Set(Object.values(defs).flatMap((d) => parseFrameDef(d)!.seq));
    for (const n of names) for (const v of ['bust', 'full']) for (const s of ['', '@2x']) for (const ext of ['png', 'webp']) {
      expect(existsSync(new URL(`${n}-${v}${s}.${ext}`, dir)), `${n}-${v}${s}.${ext}`).toBe(true);
    }
  });
});

describe('受付の文節（phraseRuns / settledLength）', () => {
  it('日本語は文節に分け、改行はそれだけの要素', () => {
    expect(phraseRuns('新しいことに踏み出すとき、\nちょっと怖くて。', 'ja')).toEqual(['新しい', 'ことに', '踏み出すとき、', '\n', 'ちょっと', '怖くて。']);
  });
  it('「踏み出すと／き」で切れない（文節をつなぐと元の文）', () => {
    const s = '今日は少し静かな気持ちで、新しいことに踏み出すときの絵を探しているんですね。';
    const r = phraseRuns(s, 'ja');
    expect(r.join('')).toBe(s);
    expect(r.some((p) => p.endsWith('すと'))).toBe(false);
  });
  it('文節の端の空白は別の要素（span の外の文字にして、ラテン文字の語の間の空白を残す）', () => {
    expect(phraseRuns('New Chapter。新しい章、', 'ja')).toEqual(['New', ' ', 'Chapter。', '新しい', '章、']);
  });
  it('日本語以外はそのまま', () => {
    expect(phraseRuns('Something quiet for the morning.', 'en')).toEqual(['Something quiet for the morning.']);
  });
  it('ストリーミング：確定するのは最後の句読点・改行まで（閉じ括弧は含める）', () => {
    expect(settledLength('朝の光のような')).toBe(0);
    expect(settledLength('こんにちは。朝の光の')).toBe(6);
    expect(settledLength('「静か」、それとも「にぎやか」。」つづき')).toBe('「静か」、それとも「にぎやか」。」'.length);
    expect(settledLength('一行目\n二行')).toBe(4);
  });
});
