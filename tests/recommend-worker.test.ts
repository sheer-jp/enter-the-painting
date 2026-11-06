import { describe, it, expect } from 'vitest';
import { buildSystem, buildBody, buildTool, validateRequest, sanitizeMessages, FALLBACK_BETA, TOOL_NAME } from '../functions/_lib/prompt.js';
import { createSseParser, createEventMapper, mapEvent, normalizeRecommend, relayEvents, sse } from '../functions/_lib/relay.js';

const catalog = {
  version: 1,
  artist: { intro: { ja: 'sheer は抽象画の作家です。', en: 'sheer is an abstract painter.' } },
  openers: { ja: ['朝'], en: ['Morning'] },
  turns: [2, 4],
  works: [
    { id: 'harmoney', title: { ja: 'Harmoney', en: 'Harmoney' }, size_cm: [53, 65.2], size_label: { ja: 'F15 号', en: 'F15' }, year: 2025, availability: 'available',
      axes: { warmth: 0.7, brightness: 0.6, energy: 0.8 }, moods: { ja: ['朝の光'], en: ['Morning light'] }, fit: { ja: '音楽が鳴る夜に', en: 'For a night with music' },
      messages: { ja: ['色がぶつかる。'], en: ['Colors collide.'] }, story: { ja: '朝。', en: 'Morning.' } },
    { id: 'blue-tide', title: { ja: '青い潮', en: 'Blue Tide' }, size_cm: [18, 14], availability: 'sold',
      axes: { warmth: 0.2, brightness: 0.4, energy: 0.3 }, moods: { ja: [] }, messages: { ja: ['海。'] }, story: null },
  ],
};

describe('functions/_lib/prompt.js', () => {
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
    expect(all).toContain('必ずツール recommend_work を 1 回呼ぶ');
    expect(all).not.toContain('{"recommend":"<id>"');
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
  it('buildBody に strict のツール recommend_work が 1 つ入り、tool_choice は auto', () => {
    const body = buildBody(catalog, 'ja', [{ role: 'user', content: 'x' }], 'claude-sonnet-5-5');
    expect(body.tools).toHaveLength(1);
    const t = body.tools[0];
    expect(t.name).toBe(TOOL_NAME);
    expect(TOOL_NAME).toBe('recommend_work');
    expect(t.strict).toBe(true);
    expect(body.tool_choice).toEqual({ type: 'auto' });
    expect(body.thinking).toBeUndefined();
    expect(body.output_config).toEqual({ effort: 'low' });
    const s = t.input_schema;
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(['recommend', 'alt', 'reason', 'matched_moods']);
    expect(s.properties.matched_moods).toMatchObject({ type: 'array', items: { type: 'string' } });
    // strict は minItems / maxItems を受け付けない（本番で 400 になった）ので入れない
    expect(s.properties.matched_moods).not.toHaveProperty('minItems');
    expect(s.properties.matched_moods).not.toHaveProperty('maxItems');
    expect(s.properties.matched_moods.description).toContain('カタログの moods の語をそのまま');
    expect(s.properties.recommend.enum).toEqual(['harmoney', 'blue-tide']);
    expect(s.properties.alt.anyOf).toEqual([{ type: 'string', enum: ['harmoney', 'blue-tide'] }, { type: 'null' }]);
    expect(s.properties.reason.required).toEqual(['ja', 'en']);
    expect(s.properties.reason.additionalProperties).toBe(false);
  });
  it('カタログの文に「向く人・時間」の行が出る（fit が無い作品には出さない）。理由は「その人の言葉 → 絵が応えること」の決まりが入る', () => {
    const sys = buildSystem(catalog, 'ja');
    expect(sys[1].text).toContain('- 向く人・時間：音楽が鳴る夜に / For a night with music');
    expect(sys[1].text.match(/向く人・時間/g)).toHaveLength(1);
    expect(sys[2].text).toContain('まず**その人が話したこと**を 1 つ拾って');   // 理由は、その人の言葉 → 絵の何が応えるか（11-06 作家「ロジックが冷たい」）
    expect(sys[2].text).toContain('ことばを並べない');
  });
  it('作品が無いカタログではツールを付けない（空の enum は不正なスキーマ）', () => {
    expect(buildTool({ works: [] })).toBeNull();
    const body = buildBody({ works: [] }, 'ja', [{ role: 'user', content: 'x' }], 'claude-sonnet-5-5');
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
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

describe('functions/_lib/relay.js', () => {
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
  it('relayEvents：ツール recommend_work の呼び出しを { recommend } 1 回に直す（文はいままで通り）', async () => {
    const input = '{"recommend":"harmoney","alt":"blue-tide","reason":{"ja":"朝の光に合う。","en":"It suits morning light."},"matched_moods":["朝の光"]}';
    const s = ev('message_start', { message: { id: 'm' } })
      + ev('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '' } })
      + ev('content_block_stop', { index: 0 })
      + ev('content_block_start', { index: 1, content_block: { type: 'text', text: '' } })
      + ev('content_block_delta', { index: 1, delta: { type: 'text_delta', text: 'それなら、この絵を。' } })
      + ev('content_block_stop', { index: 1 })
      + ev('content_block_start', { index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'recommend_work', input: {} } })
      + ev('content_block_delta', { index: 2, delta: { type: 'input_json_delta', partial_json: '' } })
      + ev('content_block_delta', { index: 2, delta: { type: 'input_json_delta', partial_json: input.slice(0, 30) } })
      + ev('content_block_delta', { index: 2, delta: { type: 'input_json_delta', partial_json: input.slice(30) } })
      + ev('content_block_stop', { index: 2 })
      + ev('message_delta', { delta: { stop_reason: 'tool_use' } })
      + ev('message_stop', {});
    const bytes = new TextEncoder().encode(s);
    const body = new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < bytes.length; i += 11) c.enqueue(bytes.slice(i, i + 11)); c.close(); } });
    const out = [];
    for await (const e of relayEvents(body)) out.push(e);
    expect(out).toEqual([
      { text: 'それなら、この絵を。' },
      { recommend: { recommend: 'harmoney', alt: 'blue-tide', reason: { ja: '朝の光に合う。', en: 'It suits morning light.' }, matched_moods: ['朝の光'] } },
      { done: true },
    ]);
    expect(sse(out[1])).toBe(`data: {"recommend":${input}}\n\n`);
  });
  it('createEventMapper：壊れた JSON や別のツールは捨てる。alt の null を保つ', () => {
    const map = createEventMapper();
    expect(map({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', name: 'recommend_work' } })).toBeNull();
    expect(map({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"recommend":"har' } })).toBeNull();
    expect(map({ type: 'content_block_stop', index: 0 })).toBeNull();
    map({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', name: 'other' } });
    map({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"recommend":"x","alt":null}' } });
    expect(map({ type: 'content_block_stop', index: 1 })).toBeNull();
    map({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', name: 'recommend_work' } });
    map({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"recommend":"x","alt":null,"reason":{"ja":"a","en":"b"},"matched_moods":["朝の光"]}' } });
    expect(map({ type: 'content_block_stop', index: 2 })).toEqual({ recommend: { recommend: 'x', alt: null, reason: { ja: 'a', en: 'b' }, matched_moods: ['朝の光'] } });
    expect(map({ type: 'message_delta', delta: { stop_reason: 'tool_use' } })).toBeNull();
    expect(map({ type: 'content_block_delta', index: 3, delta: { type: 'text_delta', text: 'a' } })).toEqual({ text: 'a' });
    expect(normalizeRecommend({ recommend: '' })).toBeNull();
    expect(normalizeRecommend({ recommend: 'x', alt: 3 })).toEqual({ recommend: 'x', alt: null, matched_moods: [] });
  });
  it('normalizeRecommend は matched_moods を文字列の配列として通す（文字列以外を捨てる、最大 3）', () => {
    expect(normalizeRecommend({ recommend: 'x', alt: 'y', matched_moods: ['a', 1, null, 'b', '', { c: 1 }, 'c', 'd'] }))
      .toEqual({ recommend: 'x', alt: 'y', matched_moods: ['a', 'b', 'c'] });
    expect(normalizeRecommend({ recommend: 'x', matched_moods: 'a' })?.matched_moods).toEqual([]);
    // ブラウザが受ける SSE の形（docs/RECOMMEND.md 8.4）
    expect(sse({ recommend: normalizeRecommend({ recommend: 'x', alt: null, reason: { ja: 'あ', en: 'a' }, matched_moods: ['朝の光'] }) }))
      .toBe('data: {"recommend":{"recommend":"x","alt":null,"reason":{"ja":"あ","en":"a"},"matched_moods":["朝の光"]}}\n\n');
  });
  it('relayEvents：ツール呼び出しのあとの拒否はいままで通り { refusal }', async () => {
    const out = [];
    for await (const e of relayEvents(upstream([ev('message_start', {}), ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'a' } }), ev('message_delta', { delta: { stop_reason: 'refusal' } }), ev('message_stop', {})]))) out.push(e);
    expect(out).toEqual([{ text: 'a' }, { refusal: true }, { done: true }]);
  });
  it('sse は data: 行を作る', () => {
    expect(sse({ text: 'a' })).toBe('data: {"text":"a"}\n\n');
    expect(sse({ done: true })).toBe('data: {"done":true}\n\n');
  });
});
