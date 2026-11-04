import { t, type Lang } from '../i18n';

export interface Hud {
  root: HTMLDivElement; close: HTMLButtonElement; skip: HTMLButtonElement; pause: HTMLButtonElement; title: HTMLDivElement; paused: HTMLDivElement;
  ending: HTMLDivElement; once: HTMLDivElement; vignette: HTMLDivElement; debug: HTMLDivElement; textLayer: HTMLDivElement;
  setLang(l: Lang): void; dispose(): void;
}

export function buildHud(parent: HTMLElement, lang: Lang, opts: { fromQr: boolean; debug: boolean; hasRooms: boolean; contact: string | null }): Hud {
  const root = document.createElement('div'); root.className = 'hud';
  const textLayer = document.createElement('div'); textLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
  const vignette = document.createElement('div'); vignette.className = 'vignette';
  const close = document.createElement('button'); close.className = 'close'; close.textContent = '×';
  const skip = document.createElement('button'); skip.className = 'skip';
  const pause = document.createElement('button'); pause.className = 'pausebtn'; pause.textContent = '❚❚';
  const title = document.createElement('div'); title.className = 'title';
  const paused = document.createElement('div'); paused.className = 'paused';
  const once = document.createElement('div'); once.className = 'once';
  const ending = document.createElement('div'); ending.className = 'ending';
  const debug = document.createElement('div'); debug.className = 'debug'; debug.hidden = !opts.debug;
  const btn = (id: string, key: string, primary = false) => { const b = document.createElement('button'); b.className = 'btn' + (primary ? ' primary' : ''); b.dataset.i18n = key; b.dataset.action = id; ending.appendChild(b); return b; };
  btn('again', 'again', true);
  if (opts.fromQr) btn('save', 'save');
  if (opts.hasRooms) btn('rooms', 'rooms');
  if (opts.contact) btn('contact', 'contact');
  btn('close', 'close');
  root.append(vignette, textLayer, title, paused, once, ending, pause, skip, close, debug);
  parent.appendChild(root);
  const hud: Hud = {
    root, close, skip, pause, title, paused, ending, once, vignette, debug, textLayer,
    setLang(l) {
      close.setAttribute('aria-label', t('close', l)); skip.textContent = t('skip', l); paused.textContent = t('pause', l); pause.setAttribute('aria-label', t('pause', l));
      once.textContent = opts.fromQr ? t('once_more', l) : '';
      ending.querySelectorAll<HTMLElement>('[data-i18n]').forEach((b) => (b.textContent = t(b.dataset.i18n!, l)));
    },
    dispose() { root.remove(); },
  };
  hud.setLang(lang);
  return hud;
}
