// 気分から絵をすすめる：Claude API の中継（Cloudflare Worker。docs/RECOMMEND.md 8.4）
// 会話はどこにも保存しない。要求の本文や会話をログに出さない
import { buildBody, validateRequest, FALLBACK_BETA, supportsFallbacks } from './prompt.js';
import { relayEvents, sse } from './relay.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const CATALOG_TTL = 600;          // カタログのキャッシュ（秒）
const RATE_LIMIT = 10;            // IP ごと 1 分あたりの回数
const RATE_WINDOW = 60_000;
const MAX_BODY = 16_000;          // 要求の本文の上限（バイト）

// isolate の中だけのレート制限（厳密でなくてよい）
const hits = new Map();
function rateLimited(ip, now = Date.now()) {
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start > RATE_WINDOW) hits.delete(k);
  const e = hits.get(ip);
  if (!e || now - e.start > RATE_WINDOW) { hits.set(ip, { start: now, count: 1 }); return false; }
  e.count++;
  return e.count > RATE_LIMIT;
}

function allowedOrigin(req, env) {
  const origin = req.headers.get('Origin');
  if (!origin) return null;
  const list = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (env.SITE_ORIGIN) list.push(String(env.SITE_ORIGIN).replace(/\/$/, ''));
  return list.includes(origin) ? origin : null;
}

function corsHeaders(origin) {
  return origin ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  } : { Vary: 'Origin' };
}

const json = (status, obj, cors) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors } });

// カタログ：${SITE_ORIGIN}/catalog.json を caches.default に 10 分
async function loadCatalog(env, ctx) {
  const url = `${String(env.SITE_ORIGIN || '').replace(/\/$/, '')}/catalog.json`;
  const cache = caches.default;
  const key = new Request(url, { method: 'GET' });
  let res = await cache.match(key);
  if (!res) {
    const fresh = await fetch(url, { cf: { cacheTtl: CATALOG_TTL } });
    if (!fresh.ok) throw new Error(`catalog ${fresh.status}`);
    res = new Response(await fresh.text(), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${CATALOG_TTL}` } });
    ctx.waitUntil(cache.put(key, res.clone()));
  }
  return res.json();
}

async function handle(req, env, ctx) {
  const origin = allowedOrigin(req, env);
  const cors = corsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response(null, { status: origin ? 204 : 403, headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'bad_request' }, { ...cors, Allow: 'POST, OPTIONS' });
  if (!origin) return json(403, { error: 'bad_request' }, cors);

  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  if (rateLimited(ip)) return json(429, { error: 'rate_limited' }, { ...cors, 'Retry-After': '60' });

  let body;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) return json(400, { error: 'bad_request' }, cors);
    body = JSON.parse(text);
  } catch { return json(400, { error: 'bad_request' }, cors); }
  // 往復の上限はカタログを読む前に既定値で一度確かめ、読んだあとカタログの値で確かめる
  if (validateRequest(body, [2, 10])) return json(400, { error: 'bad_request' }, cors);

  let catalog;
  try { catalog = await loadCatalog(env, ctx); } catch (e) {
    console.error('catalog の取得に失敗', String(e));
    return json(502, { error: 'upstream' }, cors);
  }
  const turns = Array.isArray(catalog.turns) && catalog.turns.length === 2 ? catalog.turns : [2, 4];
  if (validateRequest(body, turns)) return json(400, { error: 'bad_request' }, cors);

  const model = env.CLAUDE_MODEL || 'claude-opus-5-5';
  const headers = { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' };
  if (supportsFallbacks(model)) headers['anthropic-beta'] = FALLBACK_BETA;
  let up;
  try {
    up = await fetch(API_URL, { method: 'POST', headers, body: JSON.stringify(buildBody(catalog, body.lang, body.messages, model)) });
  } catch (e) {
    console.error('Claude API に届かない', String(e));
    return json(502, { error: 'upstream' }, cors);
  }
  if (!up.ok || !up.body) {
    console.error('Claude API の状態', up.status);   // 本文はログに出さない
    return json(502, { error: 'upstream' }, cors);
  }

  // 最初の出来事を待つ：文が来る前の拒否は 422、失敗は 502
  const events = relayEvents(up.body);
  const first = await events.next().catch(() => ({ value: { error: true }, done: false }));
  if (first.done) return json(502, { error: 'upstream' }, cors);
  if ('refusal' in first.value) { events.return(undefined); return json(422, { error: 'refusal' }, cors); }
  if ('error' in first.value) { events.return(undefined); return json(502, { error: 'upstream' }, cors); }

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(enc.encode(sse(obj)));
      let ended = false;
      const handleEv = (ev) => {
        if ('text' in ev) send({ text: ev.text });
        else if ('refusal' in ev) send({ error: 'refusal' });
        else if ('error' in ev) { send({ error: 'upstream' }); send({ done: true }); ended = true; }
        else if ('done' in ev) { send({ done: true }); ended = true; }
      };
      try {
        handleEv(first.value);
        while (!ended) {
          const r = await events.next();
          if (r.done) break;
          handleEv(r.value);
        }
        if (!ended) { send({ error: 'upstream' }); send({ done: true }); }
      } catch (e) {
        console.error('中継が途中で切れた', String(e));
        try { send({ error: 'upstream' }); send({ done: true }); } catch { /* 閉じたあと */ }
      } finally {
        try { await events.return(undefined); } catch { /* すでに閉じた */ }
        controller.close();
      }
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', ...cors } });
}

export default {
  async fetch(req, env, ctx) {
    const path = env.API_PATH || '/api/recommend';
    if (new URL(req.url).pathname !== path) return new Response('Not Found', { status: 404 });
    try { return await handle(req, env, ctx); } catch (e) {
      console.error('想定外の失敗', String(e));
      return json(502, { error: 'upstream' }, corsHeaders(allowedOrigin(req, env)));
    }
  },
};
