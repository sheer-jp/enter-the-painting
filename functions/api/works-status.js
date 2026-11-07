// 作品の販売状況：GET /api/works-status。sheerarts.com の販売状況を同じ origin で中継する。
// 取れないときは空を返す（SOLD を出さないだけ。1 点物の決済リンクは Stripe の側で止まる）
import { fetchStatuses } from '../_lib/works-status.js';

const reply = (statuses, maxAge) => new Response(JSON.stringify({ statuses }), {
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${maxAge}` },
});

export async function onRequestGet() {
  try {
    return reply(await fetchStatuses(), 60);
  } catch (e) {
    console.error('販売状況を取れない', String(e));
    return reply({}, 10);
  }
}
