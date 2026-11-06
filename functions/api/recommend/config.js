// 受付の設定（docs/ENTRANCE.md 3.1）：合言葉が要るかどうかだけを返す。合言葉の値は返さない・ログに出さない
export function onRequestGet({ env }) {
  return new Response(JSON.stringify({ passphrase: Boolean(env.PASSPHRASE) }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
