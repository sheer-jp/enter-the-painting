// 作品の販売状況：GET /api/works-status。sheerarts.com の /api/works-status（作品一覧スプレッドシートが正）を同じ origin で中継する。
// 取れないときは空を返す（SOLD を出さないだけ。1 点物の決済リンクは Stripe の側で止まる）
const UPSTREAM = 'https://sheerarts.com/api/works-status';
const TTL = 60;

// 必要な欄だけを通す
export function pickStatuses(body) {
  const src = body && typeof body === 'object' && body.statuses && typeof body.statuses === 'object' ? body.statuses : {};
  const out = {};
  for (const [title, v] of Object.entries(src)) {
    if (v && typeof v === 'object') out[title] = { status: typeof v.status === 'string' ? v.status : '', soldOut: v.soldOut === true };
  }
  return out;
}

const reply = (statuses, maxAge) => new Response(JSON.stringify({ statuses }), {
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${maxAge}` },
});

export async function onRequestGet() {
  try {
    const r = await fetch(UPSTREAM, { headers: { accept: 'application/json' }, cf: { cacheTtl: TTL, cacheEverything: true } });
    if (!r.ok) throw new Error('upstream ' + r.status);
    return reply(pickStatuses(await r.json()), TTL);
  } catch (e) {
    console.error('販売状況を取れない', String(e));
    return reply({}, 10);
  }
}
