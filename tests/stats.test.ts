import { describe, it, expect } from 'vitest';
import { normalizeEvent, statKeys, jstDate, parseKey, checkStatsKey, summarize } from '../functions/_lib/stats.js';
import { onRequestPost } from '../functions/api/stat.js';
import { onRequestGet } from '../functions/api/stats.js';

describe('functions/_lib/stats.js（E-14）', () => {
  it('許すイベントだけを通す', () => {
    expect(normalizeEvent({ ev: 'concierge_start', id: null })).toEqual({ ev: 'concierge_start', id: null, via: null });
    expect(normalizeEvent({ ev: 'concierge_turn' })).toEqual({ ev: 'concierge_turn', id: null, via: null });
    expect(normalizeEvent({ ev: 'concierge_recommend', id: 'harmoney' })).toEqual({ ev: 'concierge_recommend', id: 'harmoney', via: null });
    expect(normalizeEvent({ ev: 'enter', id: 'blue-tide', via: 'gallery' })).toEqual({ ev: 'enter', id: 'blue-tide', via: 'gallery' });
    expect(normalizeEvent({ ev: 'gallery_pick', id: 'harmoney' })).not.toBeNull();
    for (const ev of ['concierge_other', 'concierge_skip']) expect(normalizeEvent({ ev })).not.toBeNull();
  });
  it('知らないイベント・id の過不足・via の誤りは null', () => {
    expect(normalizeEvent({ ev: 'hello' })).toBeNull();
    expect(normalizeEvent({ ev: 'toString' })).toBeNull();
    expect(normalizeEvent({ ev: 'concierge_recommend' })).toBeNull();
    expect(normalizeEvent({ ev: 'concierge_start', id: 'harmoney' })).toBeNull();
    expect(normalizeEvent({ ev: 'enter', id: 'harmoney' })).toBeNull();
    expect(normalizeEvent({ ev: 'enter', id: 'harmoney', via: 'qr' })).toBeNull();
    expect(normalizeEvent({ ev: 'gallery_pick', id: 'harmoney', via: 'page' })).toBeNull();
    expect(normalizeEvent({ ev: 'gallery_pick', id: 'Bad Id' })).toBeNull();
    expect(normalizeEvent({ ev: 'gallery_pick', id: 'a:b' })).toBeNull();
    expect(normalizeEvent({ ev: 'gallery_pick', id: 'x'.repeat(65) })).toBeNull();
    expect(normalizeEvent(null)).toBeNull();
    expect(normalizeEvent([])).toBeNull();
  });
  it('鍵の形：d:<日付>:<ev>[:<via>][:<id>] と t:…', () => {
    expect(statKeys({ ev: 'concierge_turn', id: null, via: null }, '2026-11-06')).toEqual(['d:2026-11-06:concierge_turn', 't:concierge_turn']);
    expect(statKeys({ ev: 'concierge_recommend', id: 'harmoney', via: null }, '2026-11-06')).toEqual(['d:2026-11-06:concierge_recommend:harmoney', 't:concierge_recommend:harmoney']);
    expect(statKeys({ ev: 'enter', id: 'harmoney', via: 'page' }, '2026-11-06')).toEqual(['d:2026-11-06:enter:page:harmoney', 't:enter:page:harmoney']);
    expect(parseKey('d:2026-11-06:enter:page:harmoney')).toEqual({ kind: 'd', date: '2026-11-06', name: 'enter:page:harmoney' });
    expect(parseKey('t:concierge_turn')).toEqual({ kind: 't', date: null, name: 'concierge_turn' });
    expect(parseKey('x:y')).toBeNull();
  });
  it('日付は日本時間', () => {
    expect(jstDate(Date.UTC(2026, 10, 5, 15, 0))).toBe('2026-11-06');
    expect(jstDate(Date.UTC(2026, 10, 5, 14, 59))).toBe('2026-11-05');
  });
  it('見る口の鍵：空なら常に false', () => {
    expect(checkStatsKey('', '')).toBe(false);
    expect(checkStatsKey(undefined, 'x')).toBe(false);
    expect(checkStatsKey('abc', 'abc')).toBe(true);
    expect(checkStatsKey('abc', 'abd')).toBe(false);
    expect(checkStatsKey('abc', 'abcd')).toBe(false);
  });
  it('まとめ：累計と since 以降の日', () => {
    const r = summarize([
      { name: 't:concierge_turn', metadata: { n: 5 } },
      { name: 'd:2026-11-06:concierge_turn', metadata: { n: 3 } },
      { name: 'd:2026-09-01:concierge_turn', metadata: { n: 9 } },
    ], '2026-10-08');
    expect(r).toEqual({ total: { concierge_turn: 5 }, days: { '2026-11-06': { concierge_turn: 3 } } });
  });
});

// KV の模擬（Map）
function fakeKv() {
  const m = new Map<string, { v: string; metadata?: unknown }>();
  return {
    m,
    async get(k: string) { return m.get(k)?.v ?? null; },
    async put(k: string, v: string, o?: { metadata?: unknown }) { m.set(k, { v, metadata: o?.metadata }); },
    async list({ prefix }: { prefix: string }) { return { keys: [...m.entries()].filter(([k]) => k.startsWith(prefix)).map(([name, e]) => ({ name, metadata: e.metadata })), list_complete: true }; },
  };
}
const post = (body: string, origin: string | null = 'https://example.com') =>
  new Request('https://example.com/api/stat', { method: 'POST', body, headers: origin ? { Origin: origin, 'CF-Connecting-IP': '1.2.3.4' } : {} });

describe('functions/api/stat.js と stats.js（E-14）', () => {
  it('同じ origin なら 204 で 2 つの鍵を +1、ほかの origin は 403、悪い本文は 400', async () => {
    const STATS = fakeKv();
    const env = { STATS };
    const waits: Promise<unknown>[] = [];
    const ctx = (request: Request) => ({ request, env, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    expect((await onRequestPost(ctx(post('{"ev":"concierge_turn","id":null}')))).status).toBe(204);
    expect((await onRequestPost(ctx(post('{"ev":"concierge_turn"}', 'http://localhost:5173')))).status).toBe(204);
    expect((await onRequestPost(ctx(post('{"ev":"concierge_turn"}', 'https://evil.example')))).status).toBe(403);
    expect((await onRequestPost(ctx(post('{"ev":"concierge_turn"}', null)))).status).toBe(403);
    expect((await onRequestPost(ctx(post('{"ev":"nope"}')))).status).toBe(400);
    expect((await onRequestPost(ctx(post('not json')))).status).toBe(400);
    await Promise.all(waits);
    expect(STATS.m.get('t:concierge_turn')?.v).toBe('2');
    expect([...STATS.m.keys()].some((k) => /^d:\d{4}-\d{2}-\d{2}:concierge_turn$/.test(k))).toBe(true);
    // 本文の文・IP は鍵にも値にも入らない
    expect(JSON.stringify([...STATS.m.entries()])).not.toContain('1.2.3.4');
  });
  it('/api/stats は STATS_KEY が無い・違うと 404、合えば JSON', async () => {
    const STATS = fakeKv();
    await STATS.put('t:concierge_turn', '2', { metadata: { n: 2 } });
    const get = (q: string, env: Record<string, unknown>) => onRequestGet({ request: new Request('https://example.com/api/stats' + q), env } as never);
    expect((await get('?key=a', { STATS })).status).toBe(404);
    expect((await get('', { STATS, STATS_KEY: 'secret' })).status).toBe(404);
    expect((await get('?key=wrong', { STATS, STATS_KEY: 'secret' })).status).toBe(404);
    const ok = await get('?key=secret', { STATS, STATS_KEY: 'secret' });
    expect(ok.status).toBe(200);
    expect((await ok.json()).total).toEqual({ concierge_turn: 2 });
  });
});
