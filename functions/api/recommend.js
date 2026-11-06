// 気分から絵をすすめる：Claude API の中継（Cloudflare Pages Functions。docs/RECOMMEND.md 8.4、docs/ENTRANCE.md 5.2）
// サイト本体と同じ origin の /api/recommend。会話はどこにも保存しない。要求の本文や会話をログに出さない
import { buildBody, validateRequest, FALLBACK_BETA, supportsFallbacks } from '../_lib/prompt.js';
import { relayEvents, sse } from '../_lib/relay.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const CATALOG_TTL = 600_000;      // カタログを isolate の中に持つ時間（ミリ秒）
const RATE_LIMIT = 10;            // IP ごと 1 分あたりの回数
const RATE_WINDOW = 60_000;
const MAX_BODY = 16_000;          // 要求の本文の上限（バイト）
// 同じ origin のほかに許す origin（npm run dev の Vite から叩けるように）
const DEV_ORIGINS = ['http://localhost:5173', 'https://localhost:5173'];

// isolate の中だけのレート制限（厳密でなくてよい）
const hits = new Map();
function rateLimited(ip, now = Date.now()) {
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start > RATE_WINDOW) hits.delete(k);
  const e = hits.get(ip);
  if (!e || now - e.start > RATE_WINDOW) { hits.set(ip, { start: now, count: 1 }); return false; }
  e.count++;
  return e.count > RATE_LIMIT;
}

// 許す origin：同じ origin、localhost:5173、ALLOWED_ORIGINS（任意。カンマ区切り）
function allowedOrigin(req, env) {
  const origin = req.headers.get('Origin');
  if (!origin) return null;
  if (origin === new URL(req.url).origin) return origin;
  const extra = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return [...DEV_ORIGINS, ...extra].includes(origin) ? origin : null;
}

// 同じ origin なら CORS のヘッダは要らない。別の origin（dev サーバー）のときだけ付ける
function corsHeaders(req, origin) {
  if (!origin || origin === new URL(req.url).origin) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (status, obj, cors) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors } });

// カタログ：同じ配信の /catalog.json。env.ASSETS（Pages の静的ファイル）から読み、isolate の中に 10 分持つ
let catalogMemo = null;   // { at, data }
async function loadCatalog(req, env) {
  const now = Date.now();
  if (catalogMemo && now - catalogMemo.at < CATALOG_TTL) return catalogMemo.data;
  const url = new URL('/catalog.json', req.url);
  // 自分の origin への fetch はループになりやすいので、使えるなら ASSETS を使う
  const res = env.ASSETS ? await env.ASSETS.fetch(new Request(url)) : await fetch(url);
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  const data = await res.json();
  catalogMemo = { at: now, data };
  return data;
}

export async function onRequestOptions({ request, env }) {
  const origin = allowedOrigin(request, env);
  return new Response(null, { status: origin ? 204 : 403, headers: corsHeaders(request, origin) });
}

export async function onRequestPost({ request, env }) {
  try { return await handle(request, env); } catch (e) {
    console.error('想定外の失敗', String(e));
    return json(502, { error: 'upstream' }, corsHeaders(request, allowedOrigin(request, env)));
  }
}

async function handle(req, env) {
  const origin = allowedOrigin(req, env);
  const cors = corsHeaders(req, origin);
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
  try { catalog = await loadCatalog(req, env); } catch (e) {
    console.error('catalog の取得に失敗', String(e));
    return json(502, { error: 'upstream' }, cors);
  }
  const turns = Array.isArray(catalog.turns) && catalog.turns.length === 2 ? catalog.turns : [2, 4];
  if (validateRequest(body, turns)) return json(400, { error: 'bad_request' }, cors);

  if (!env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY が無い');
    return json(502, { error: 'upstream' }, cors);
  }
  const model = env.CLAUDE_MODEL || 'claude-sonnet-5-5';
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
        else if ('recommend' in ev) send({ recommend: ev.recommend });
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
        try { controller.close(); } catch { /* 相手が先に切った */ }
      }
    },
    // ブラウザが切った（見切り、ページ移動、「もう一度」）ら上流も止める。読み続けると出力トークンが無駄になる
    cancel() {
      try { events.return(undefined); } catch { /* すでに閉じた */ }
      try { up.body.cancel(); } catch { /* すでに閉じた */ }
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', ...cors } });
}
