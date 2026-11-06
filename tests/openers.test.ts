// 受付の選択肢（REVIEW-1 P2）：プールから 3 つ。Fisher–Yates で偏りなく、種類がばらけ、言語を切り替えても選び直さない
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { pickOpeners, openerTexts } from '../src/concierge/index';
import type { Lang } from '../src/i18n';

// 決まった乱数（mulberry32）
const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const catalog = JSON.parse(readFileSync(new URL('../public/catalog.json', import.meta.url), 'utf8'));
const pool = catalog.openers_pool as Partial<Record<Lang, string[]>> & { ja: string[]; fr: string[]; kinds: string[] };

describe('pickOpeners', () => {
  it('3 つとも違う種類で、重複しない', () => {
    for (let s = 1; s <= 200; s++) {
      const p = pickOpeners(pool.ja, pool.kinds, 3, rng(s));
      expect(p).toHaveLength(3);
      expect(new Set(p).size).toBe(3);
      expect(new Set(p.map((i) => pool.kinds[i])).size).toBe(3);
    }
  });
  it('偏らない：先頭の 1 つがプールの全体に散らばる（sort(() => Math.random() - 0.5) の偏りの再発防止）', () => {
    const n = pool.ja.length, runs = 20000;
    const count = new Array(n).fill(0);
    const r = rng(42);
    for (let k = 0; k < runs; k++) for (const i of pickOpeners(pool.ja, pool.kinds, 3, r)) count[i]++;
    // 種類ごとの出やすさ（同じ種類どうしは等しい確率）：種類の中での最大と最小の比が 1.5 未満
    const byKind = new Map<string, number[]>();
    pool.kinds.forEach((k, i) => { if (!byKind.has(k)) byKind.set(k, []); byKind.get(k)!.push(count[i]); });
    for (const [k, cs] of byKind) if (cs.length > 1) expect(Math.max(...cs) / Math.max(1, Math.min(...cs)), k).toBeLessThan(1.5);
  });
  it('種類が足りなければ残りから埋める・種類が無ければ全部別扱い', () => {
    expect(pickOpeners(['a', 'b', 'c', 'd'], ['x', 'x', 'x', 'x'], 3, rng(1))).toHaveLength(3);
    expect(new Set(pickOpeners(['a', 'b', 'c'], [], 3, rng(2))).size).toBe(3);
    expect(pickOpeners(['a', 'b'], [], 3, rng(3))).toHaveLength(2);
  });
  it('同じ乱数なら同じ 3 つ', () => {
    expect(pickOpeners(pool.ja, pool.kinds, 3, rng(7))).toEqual(pickOpeners(pool.ja, pool.kinds, 3, rng(7)));
  });
});

describe('openerTexts', () => {
  it('言語を ja → fr → ja と切り替えても同じ 3 つで、日本語に戻る（8e9e8c2 のバグの再発防止）', () => {
    const picked = pickOpeners(pool.ja, pool.kinds, 3, rng(11));
    const ja1 = openerTexts(pool, picked, 'ja');
    const fr = openerTexts(pool, picked, 'fr');
    const ja2 = openerTexts(pool, picked, 'ja');
    expect(ja1).toEqual(picked.map((i) => pool.ja[i]));
    expect(fr).toEqual(picked.map((i) => pool.fr[i]));
    expect(fr).not.toEqual(ja1);
    expect(ja2).toEqual(ja1);
  });
  it('訳が無い言語は en → ja に落ちる', () => {
    expect(openerTexts({ ja: ['あ', 'い'], en: ['A'] }, [0, 1], 'de')).toEqual(['A', 'い']);
  });
});
