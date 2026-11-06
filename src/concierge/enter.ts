// 受付と作品ページで共有する小さな判定（E-12）。page.ts からも静的に読むので、重いものは import しない

// 「VR でのぞく」を出す条件：immersive-vr が使えて、Quest のブラウザ（または ?vr=1 で強制）のときだけ
// Android Chrome が Cardboard で true を返すことがあるため、UA でも絞る
export function vrEntryAllowed(supported: boolean, userAgent: string, forceVr: boolean): boolean {
  return supported && (forceVr || /OculusBrowser|Quest/i.test(userAgent));
}

export async function vrAvailable(forceVr: boolean): Promise<boolean> {
  const xr = (navigator as Navigator & { xr?: { isSessionSupported(m: string): Promise<boolean> } }).xr;
  if (!xr) return false;
  try { return vrEntryAllowed(await xr.isSessionSupported('immersive-vr'), navigator.userAgent, forceVr); }
  catch { return false; }
}

// 作品ページの絵の下の帯（docs/ENTRANCE.md 3.1）
// - via=concierge：「今日のあなたへの 1 点」＋「別のにする」「ギャラリー全体を見る」
// - via=concierge&after=1（C2 から絵の中に入って戻ってきた）：「絵の中から戻ってきました」＋「もう一度のぞく」「部屋で見る」「ギャラリー全体を見る」
// 部屋の画像が無い作品では「部屋で見る」を出さない
export type BandItem = { key: string; action: 'retry' | 'gallery' | 'again' | 'rooms' };
export type Band = { kind: 'via' | 'after'; head: string; items: BandItem[] } | null;

export function bandFor(params: URLSearchParams, hasRooms: boolean): Band {
  if (params.get('via') !== 'concierge') return null;
  if (params.get('after') === '1') {
    const items: BandItem[] = [{ key: 'cg_after_again', action: 'again' }];
    if (hasRooms) items.push({ key: 'cg_after_rooms', action: 'rooms' });
    items.push({ key: 'cg_all', action: 'gallery' });
    return { kind: 'after', head: 'cg_after_head', items };
  }
  return { kind: 'via', head: 'cg_card_head', items: [{ key: 'cg_other', action: 'retry' }, { key: 'cg_all', action: 'gallery' }] };
}

// 体験が終わったあとに行く作品ページ（/w/<id>/?via=concierge&after=1）
export function afterUrl(workUrl: string, base: string | URL): string {
  const u = new URL(workUrl, base);
  u.searchParams.set('via', 'concierge');
  u.searchParams.set('after', '1');
  return u.href;
}
