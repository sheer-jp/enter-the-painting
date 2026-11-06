// 作品ページ / 受付 / ギャラリーの小さなスクリプト。言語の切り替えと「入る」。受付の会話と体験は import() で読む
import { detectLang, rememberLang, applyLang, fillLangSelect, t, type Lang } from './i18n';
import { Soundscape } from './audio/Soundscape';
import './ui/page.css';

const workId = document.querySelector<HTMLMetaElement>('meta[name="work"]')?.content || null;
let lang: Lang = detectLang();

function setLang(l: Lang) { lang = l; rememberLang(l); applyLang(document, l); }
setLang(lang);
const select = document.getElementById('lang') as HTMLSelectElement | null;
if (select) fillLangSelect(select, lang, setLang);

const url = new URL(location.href);
const fromQr = url.searchParams.get('from') === 'qr';
const forceVr = url.searchParams.get('vr') === '1';
const debug = url.searchParams.get('debug') === '1';

// 共有：Web Share API があればそれ、無ければコピー
document.getElementById('share')?.addEventListener('click', async () => {
  const shareUrl = location.origin + location.pathname;
  const title = document.title;
  try {
    if (navigator.share) await navigator.share({ title, url: shareUrl });
    else { await navigator.clipboard.writeText(shareUrl); toast(t('copied', lang)); }
  } catch {}
});

function toast(msg: string) {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#fff;color:#000;padding:8px 16px;border-radius:999px;font-size:13px;z-index:100';
  document.body.appendChild(el); setTimeout(() => el.remove(), 1800);
}

// 「VR で入る」は Quest のブラウザだけ（Android Chrome が Cardboard で true を返すことがあるため）
async function vrAvailable(): Promise<boolean> {
  const xr = (navigator as Navigator & { xr?: { isSessionSupported(m: string): Promise<boolean> } }).xr;
  if (!xr) return false;
  try {
    const ok = await xr.isSessionSupported('immersive-vr');
    return ok && (forceVr || /OculusBrowser|Quest/i.test(navigator.userAgent));
  } catch { return false; }
}

// 受付（/。docs/ENTRANCE.md 3 節）：会話のコードは import() で読む（体験バンドルは読まない）
// 読み込み前の操作（選択肢 / 送る）は止めておき、読めたらもう一度起こす
const cg = document.getElementById('concierge');
if (cg) {
  // キャラクターは女の子（public/concierge/artist/）に確定（11-06 作家）。画像は HTML のまま
  const retry = url.searchParams.get('retry');
  if (retry) { url.searchParams.delete('retry'); history.replaceState(null, '', url.pathname + url.search + url.hash); }
  const api = document.querySelector<HTMLMetaElement>('meta[name="recommend-api"]')?.content.trim() || null;
  let ready = false;
  const hold = (e: Event) => {
    if (ready) return;
    const target = e.target as Element;
    if (e.type === 'submit' || target.closest('button[data-opener-index]')) {
      e.preventDefault(); e.stopImmediatePropagation();
      loading.then(() => { if (!ready) return; if (e.type === 'submit') (target as HTMLFormElement).requestSubmit(); else (target.closest('button') as HTMLButtonElement).click(); });
    }
  };
  cg.addEventListener('click', hold, true);
  cg.addEventListener('submit', hold, true);
  const loading = import('./concierge/index').then((m) => {
    m.mountConcierge(cg, { lang, api, configUrl: api ? `${api.replace(/\/$/, '')}/config` : '', catalogUrl: 'catalog.json', retry });
    ready = true;
  }).catch((e) => { console.warn('受付を読めない', e); });
}

// ギャラリー（/gallery/。docs/ENTRANCE.md 4 節）：おすすめの 1 点（?from=<id>）を最初に、PC はホイールの縦を横に
const wall = document.querySelector<HTMLElement>('.gw-wall');
if (wall) {
  const from = url.searchParams.get('from');
  const item = from ? [...wall.querySelectorAll<HTMLElement>('.gw-item')].find((el) => el.dataset.id === from) : null;
  if (item) {
    wall.prepend(item);
    item.classList.add('is-for-you');
    item.querySelector<HTMLElement>('.gw-foryou')!.hidden = false;
  }
  wall.addEventListener('wheel', (e) => {
    if (!matchMedia('(min-width: 768px)').matches || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    const max = wall.scrollWidth - wall.clientWidth;
    if (max <= 0) return;
    const next = Math.min(max, Math.max(0, wall.scrollLeft + e.deltaY));
    if (next === wall.scrollLeft) return;
    e.preventDefault();
    wall.scrollLeft = next;
  }, { passive: false });
}

if (workId) {
  // 受付から来たとき（?via=concierge）：絵の下・「入る」の上に細い帯（docs/ENTRANCE.md 3.1）
  if (url.searchParams.get('via') === 'concierge') {
    const assetRoot = document.querySelector<HTMLMetaElement>('meta[name="asset-base"]')?.content ?? '../../';
    const band = document.createElement('div');
    band.className = 'via-band';
    const label = document.createElement('span');
    label.dataset.i18n = 'cg_card_head'; label.textContent = t('cg_card_head', lang);
    const other = document.createElement('a');
    other.dataset.i18n = 'cg_other'; other.textContent = t('cg_other', lang);
    other.href = `${assetRoot}?retry=${encodeURIComponent(workId)}`;
    const all = document.createElement('a');
    all.dataset.i18n = 'cg_all'; all.textContent = t('cg_all', lang);
    all.href = `${assetRoot}gallery/?from=${encodeURIComponent(workId)}`;
    const links = document.createElement('span');
    links.className = 'via-links';
    links.append(other, all);
    band.append(label, links);
    document.querySelector('.actions')?.before(band);
  }
  const enter = document.getElementById('enter') as HTMLButtonElement;
  const enterVr = document.getElementById('enter-vr') as HTMLButtonElement;
  vrAvailable().then((ok) => { if (ok) enterVr.hidden = false; });
  const start = async (vr: boolean) => {
    enter.disabled = true; enterVr.disabled = true;
    const label = enter.textContent; enter.textContent = t('loading', lang) + '…';
    // 「入る」のハンドラ内で（ユーザー操作の直後に）：音の許可、声の準備、XR セッションの要求
    const sound = new Soundscape();
    const unlocking = sound.unlock();
    const voiceUrl = enter.dataset.voice;
    if (voiceUrl) { const a = new Audio(voiceUrl); a.muted = true; a.play().then(() => { a.pause(); a.muted = false; }).catch(() => {}); }
    let xrSession: XRSession | null = null;
    if (vr) {
      try { xrSession = await (navigator as Navigator & { xr: XRSystem }).xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] }); }
      catch (e) { console.warn('XR セッションを要求できない', e); }
    }
    try {
      await unlocking;
      const { run } = await import('./experience/main');
      await run({ workId, lang, vr, fromQr, debug, sound, xrSession, onExit: () => { enter.disabled = false; enterVr.disabled = false; enter.textContent = label; } });
    } catch (e) {
      console.error(e);
      enter.disabled = false; enterVr.disabled = false; enter.textContent = label;
      toast(String((e as Error).message || e));
    }
  };
  enter.addEventListener('click', () => start(false));
  enterVr.addEventListener('click', () => start(true));
  // 部屋で見る：帯の画像をタップすると拡大表示（寸法線と詳しい説明）。コードと space.json は初めて開くときに読む
  const figs = [...document.querySelectorAll<HTMLElement>('.room[data-room-index]')];
  if (figs.length) {
    const assetBase = document.querySelector<HTMLMetaElement>('meta[name="asset-base"]')?.content ?? '../../';
    let loading: Promise<[unknown, typeof import('./ui/lightbox')]> | null = null;
    const load = () => (loading ||= Promise.all([
      fetch(`${assetBase}works/${workId}/generated/space.json`).then((r) => { if (!r.ok) throw new Error('space.json ' + r.status); return r.json(); }),
      import('./ui/lightbox'),
    ]).catch((e) => { loading = null; throw e; }));
    const imgs = figs.map((f) => f.querySelector('img')!);
    const open = async (i: number) => {
      try {
        const [space, mod] = await load();
        mod.openLightbox({ space: space as import('./ui/lightbox').LightboxSpace, srcs: imgs.map((im) => im.currentSrc || im.src), index: i, lang, returnFocus: imgs[i] });
      } catch (e) { console.warn('拡大表示を開けない', e); }
    };
    imgs.forEach((im, i) => {
      im.setAttribute('role', 'button'); im.tabIndex = 0;
      im.addEventListener('click', () => open(+figs[i].dataset.roomIndex! || i));
      im.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(i); } });
      im.addEventListener('pointerenter', () => { load().catch(() => {}); }, { once: true });   // ホバーで先に読む
    });
  }
  // 絵をタップ / クリックしても入れる
  const paintingImg = document.querySelector<HTMLImageElement>('.painting img');
  if (paintingImg) {
    paintingImg.style.cursor = 'pointer';
    paintingImg.setAttribute('role', 'button'); paintingImg.tabIndex = 0;
    paintingImg.setAttribute('aria-label', t('enter', lang));
    paintingImg.addEventListener('click', () => { if (!enter.disabled) start(false); });
    paintingImg.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !enter.disabled) { e.preventDefault(); start(false); } });
  }
}
