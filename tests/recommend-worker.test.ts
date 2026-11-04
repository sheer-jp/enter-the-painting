import { describe, it, expect } from 'vitest';
import { buildSystem, buildBody, validateRequest, sanitizeMessages, FALLBACK_BETA } from '../worker/src/prompt.js';
import { createSseParser, mapEvent, relayEvents, sse } from '../worker/src/relay.js';

const catalog = {
  version: 1,
  artist: { intro: { ja: 'sheer は抽象画の作家です。', en: 'sheer is an abstract painter.' } },
  openers: { ja: ['朝'], en: ['Morning'] },
  turns: [2, 4],
  works: [
    { id: 'harmoney', title: { ja: 'Harmoney', en: 'Harmoney' }, size_cm: [53, 65.2], size_label: { ja: 'F15 号', en: 'F15' }, year: 2025, availability: 'available',
      axes: { warmth: 0.7, brightness: 0.6, energy: 0.8 }, moods: { ja: ['朝の光'], en: ['Morning light'] },
      messages: { ja: ['色がぶつかる。'], en: ['Colors collide.'] }, story: { ja: '朝。', en: 'Morning.' } },
    { id: 'blue-tide', title: { ja: '青い潮', en: 'Blue Tide' }, size_cm: [18, 14], availability: 'sold',
      axes: { warmth: 0.2, brightness: 0.4, energy: 0.3 }, moods: { ja: [] }, messages: { ja: ['海。'] }, story: null },
  ],
};

describe('worker/src/prompt.js', () => {
  it('system にカタログの id が全部入り、カタログのブロックに cache_control', () => {
    const sys = buildSystem(catalog, 'ja');
    const all = sys.map((b) => b.text).join('\n');
    for (const w of catalog.works) expect(all).toContain(`id: ${w.id}`);
    const cached = sys.filter((b) => b.cache_control);
    expect(cached).toHaveLength(1);
    expect(cached[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(cached[0].text).toContain('harmoney');
    expect(all).toContain('sheer は抽象画の作家です。');
  });
  it('往復の上限と出力の決まりが入る', () => {
    const all = buildSystem(catalog, 'ja').map((b) => b.text).join('\n');
    expect(all).toContain('2 回以上、4 回以下');
    expect(all).toContain('4 往復目の応答では、必ずおすすめを出す');
    expect(all).toContain('{"recommend":"<id>","alt":"<id>"|null}');
    expect(all).toContain('価格');
    expect(all).toContain('個人情報');
  });
  it('応答の言語は lang から。カタログのブロックは言語によらず同じ（キャッシュが効く）', () => {
    const fr = buildSystem(catalog, 'fr');
    const ko = buildSystem(catalog, 'ko');
    expect(fr.map((b) => b.text).join('')).toContain('フランス語');
    expect(ko.map((b) => b.text).join('')).toContain('韓国語');
    expect(fr[0].text + fr[1].text).toBe(ko[0].text + ko[1].text);
  });
  it('buildBody は stream: true、max_tokens 1500、cache_control を持つ', () => {
    const body = buildBody(catalog, 'ja', [{ role: 'user', content: '朝、静かに始めたい', extra: 1 }], 'claude-opus-5-5');
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(1500);
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.system.some((b: { cache_control?: unknown }) => b.cache_control)).toBe(true);
    expect(body.messages).toEqual([{ role: 'user', content: '朝、静かに始めたい' }]);
    expect(body.fallbacks).toBe('default');
    expect(FALLBACK_BETA).toBe('server-side-fallback-2026-07-01');
    expect(JSON.stringify(body.system)).toContain('いまは 1 往復目');
  });
  it('4 往復目では必ずおすすめを出すよう指示する', () => {
    const ms = [];
    for (let i = 0; i < 4; i++) { ms.push({ role: 'user', content: 'u' + i }); if (i < 3) ms.push({ role: 'assistant', content: 'a' + i }); }
    expect(JSON.stringify(buildBody(catalog, 'ja', ms, 'claude-opus-5-5').system)).toContain('この応答で必ずおすすめを出す');
  });
  it('fallbacks は対応するモデルだけ', () => {
    expect(buildBody(catalog, 'ja', [{ role: 'user', content: 'x' }], 'claude-haiku-5-5').fallbacks).toBeUndefined();
  });
  it('sanitizeMessages は role と content だけにし、content を文字列にする', () => {
    expect(sanitizeMessages([{ role: 'user', content: 3, name: 'x' }, { role: 'system', content: 'x' }])).toEqual([{ role: 'user', content: '3' }]);
    expect(sanitizeMessages(null)).toEqual([]);
  });
  it('validateRequest：制限を超えたら理由を返す', () => {
    const u = (content = 'x') => ({ role: 'user', content });
    const a = { role: 'assistant', content: 'y' };
    expect(validateRequest({ lang: 'ja', messages: [u()] })).toBeNull();
    expect(validateRequest({ lang: 'xx', messages: [u()] })).toBe('lang');
    expect(validateRequest({ lang: 'ja', messages: [] })).toBe('messages');
    expect(validateRequest({ lang: 'ja', messages: Array(11).fill(u()) })).toBe('messages');
    expect(validateRequest({ lang: 'ja', messages: [u('あ'.repeat(601))] })).toBe('content');
    expect(validateRequest({ lang: 'ja', messages: [u(), a] })).toBe('order');
    expect(validateRequest({ lang: 'ja', messages: [{ role: 'system', content: 'x' }] })).toBe('role');
    // user は turns[1] + 1 = 5 件まで
    expect(validateRequest({ lang: 'ja', messages: [u(), a, u(), a, u(), a, u(), a, u()] }, [2, 4])).toBeNull();
    expect(validateRequest({ lang: 'ja', messages: [u(), a, u(), a, u(), a, u(), a, u(), u()] }, [2, 4])).toBe('turns');
  });
});

// 上流の SSE を文字列から作る
function upstream(chunks: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({ start(c) { for (const s of chunks) c.enqueue(enc.encode(s)); c.close(); } });
}
const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

describe('worker/src/relay.js', () => {
  it('SSE のパーサは途中で切れた行をつなぐ', () => {
    const p = createSseParser();
    const full = ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'こんにちは' } });
    expect(p.push(full.slice(0, 20))).toEqual([]);
    const out = p.push(full.slice(20));
    expect(out).toHaveLength(1);
    expect(out[0].delta.text).toBe('こんにちは');
  });
  it('mapEvent：文、拒否、終わり、失敗。思考の断片は流さない', () => {
    expect(mapEvent({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } })).toEqual({ text: 'a' });
    expect(mapEvent({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'x' } })).toBeNull();
    expect(mapEvent({ type: 'message_delta', delta: { stop_reason: 'refusal' } })).toEqual({ refusal: true });
    expect(mapEvent({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })).toBeNull();
    expect(mapEvent({ type: 'message_stop' })).toEqual({ done: true });
    expect(mapEvent({ type: 'error', error: { type: 'overloaded_error' } })).toEqual({ error: true });
    expect(mapEvent({ type: 'ping' })).toBeNull();
  });
  it('relayEvents：上流のストリームを順に直す（バイトの途中で切れても）', async () => {
    const s = ev('message_start', { message: { id: 'm' } })
      + ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
      + ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: '朝の' } })
      + ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: '光。' } })
      + ev('content_block_stop', { index: 0 })
      + ev('message_delta', { delta: { stop_reason: 'end_turn' } })
      + ev('message_stop', {});
    const bytes = new TextEncoder().encode(s);
    const body = new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7)); c.close(); } });
    const out = [];
    for await (const e of relayEvents(body)) out.push(e);
    expect(out).toEqual([{ text: '朝の' }, { text: '光。' }, { done: true }]);
  });
  it('relayEvents：文の前の拒否', async () => {
    const out = [];
    for await (const e of relayEvents(upstream([ev('message_start', {}), ev('message_delta', { delta: { stop_reason: 'refusal' } }), ev('message_stop', {})]))) out.push(e);
    expect(out[0]).toEqual({ refusal: true });
  });
  it('sse は data: 行を作る', () => {
    expect(sse({ text: 'a' })).toBe('data: {"text":"a"}\n\n');
    expect(sse({ done: true })).toBe('data: {"done":true}\n\n');
  });
});
