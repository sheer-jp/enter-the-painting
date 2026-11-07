// 作品の販売状況：sheerarts.com の /api/works-status（作品一覧スプレッドシートが正）を読む。/api/works-status と /api/recommend で使う
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

// 元は 60 秒ごとに cache が切れ、切れた直後は数秒かかることがある。isolate の中に最後の結果を持ち、遅いときや失敗したときはそれを使う（1 時間まで）
let memo = null;
export async function fetchStatuses(timeoutMs = 6000) {
  const now = Date.now();
  if (memo && now - memo.at < TTL * 1000) return memo.data;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(UPSTREAM, { headers: { accept: 'application/json' }, cf: { cacheTtl: TTL, cacheEverything: true }, signal: ctrl.signal });
    if (!r.ok) throw new Error('upstream ' + r.status);
    const data = pickStatuses(await r.json());
    memo = { at: now, data };
    return data;
  } catch (e) {
    if (memo && now - memo.at < 3600_000) return memo.data;
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// 売れた絵をカタログから外す（11-07 作家「売れた絵は外した方がいい」）。元のカタログは変えない。全部売れていたら外さない
export function withoutSold(catalog, statuses) {
  const works = Array.isArray(catalog?.works) ? catalog.works : [];
  const left = works.filter((w) => !statuses?.[w.title?.ja]?.soldOut);
  return left.length && left.length < works.length ? { ...catalog, works: left } : catalog;
}
