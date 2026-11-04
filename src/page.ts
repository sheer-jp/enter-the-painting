// 作品ページ / ギャラリーの小さなスクリプト。言語の切り替えと「入る」だけ。体験は「入る」で読む
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

// 気分から絵をすすめる（ギャラリー）：入口に触れたとき（選択肢を押す / 入力欄にフォーカス）に import() で読む
const rec = document.getElementById('recommend');
if (rec) {
  const api = document.querySelector<HTMLMetaElement>('meta[name="recommend-api"]')?.content.trim() || null;
  let loading: Promise<void> | null = null;
  const mount = () => (loading ||= import('./recommend/index').then((m) => {
    off();
    m.mountRecommend(rec, { lang, api, catalogUrl: 'catalog.json' });
  }).catch((e) => { loading = null; console.warn('おすすめを読めない', e); }));
  // 読み込み前の操作は止めておき、読めたらもう一度起こす
  const later = (e: Event, again: () => void) => { e.preventDefault(); e.stopImmediatePropagation(); mount().then(() => { if (!loading) return; again(); }); };
  const onClick = (e: Event) => { const b = (e.target as Element).closest('button'); if (b && rec.contains(b)) later(e, () => b.click()); };
  const onSubmit = (e: Event) => later(e, () => (e.target as HTMLFormElement).requestSubmit());
  const onFocus = () => { mount(); };
  const off = () => { rec.removeEventListener('click', onClick, true); rec.removeEventListener('submit', onSubmit, true); rec.removeEventListener('focusin', onFocus); };
  rec.addEventListener('click', onClick, true);
  rec.addEventListener('submit', onSubmit, true);
  rec.addEventListener('focusin', onFocus);
}

if (workId) {
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
