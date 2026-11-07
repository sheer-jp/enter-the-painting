// 作品の販売状況：sheerarts.com の /api/works-status（作品一覧スプレッドシートが正）を読む。/api/works-status と /api/recommend で使う
const UPSTREAM = 'https://sheerarts.com/api/works-status';
const TTL = 60;
const TIMEOUT_MS = 1500;

// 必要な欄だけを通す
export function pickStatuses(body) {
  const src = body && typeof body === 'object' && body.statuses && typeof body.statuses === 'object' ? body.statuses : {};
  const out = {};
  for (const [title, v] of Object.entries(src)) {
    if (v && typeof v === 'object') out[title] = { status: typeof v.status === 'string' ? v.status : '', soldOut: v.soldOut === true };
  }
  return out;
}

export async function fetchStatuses() {
  const r = await fetch(UPSTREAM, { headers: { accept: 'application/json' }, cf: { cacheTtl: TTL, cacheEverything: true }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error('upstream ' + r.status);
  return pickStatuses(await r.json());
}

// 売れた絵をカタログから外す（11-07 作家「売れた絵は外した方がいい」）。元のカタログは変えない。全部売れていたら外さない
export function withoutSold(catalog, statuses) {
  const works = Array.isArray(catalog?.works) ? catalog.works : [];
  const left = works.filter((w) => !statuses?.[w.title?.ja]?.soldOut);
  return left.length && left.length < works.length ? { ...catalog, works: left } : catalog;
}
