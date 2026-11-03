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
}
