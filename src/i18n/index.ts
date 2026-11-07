import ui from './ui.json';
import { LANGS, pickLang, type Lang } from './normalize';
export { LANGS, pickLang, normalizeLang, type Lang } from './normalize';

type Dict = Record<string, Partial<Record<Lang, string>>>;
const UI = ui as Dict;

export function t(key: string, lang: Lang, vars?: Record<string, string | number>): string {
  const e = UI[key];
  let s = (e && (e[lang] || e.en || e.ja)) || key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

// 日本語と英語以外の UI 文言は dist/i18n/<lang>.json から後で読む（vite.config.ts の splitUi）。dev とテストは全言語が入っているので読まない
const langWaiters = new Map<Lang, Promise<void>>();
const langListeners = new Set<(l: Lang) => void>();
export const isLangReady = (lang: Lang): boolean => !!UI.language?.[lang];
export function onLangLoaded(cb: (l: Lang) => void): void { langListeners.add(cb); }
export function ensureLang(lang: Lang): Promise<void> {
  if (isLangReady(lang)) return Promise.resolve();
  let w = langWaiters.get(lang);
  if (!w) {
    const here = import.meta.url;   // ページ用 JS は /assets/ にある。base: './' でも置き場に依存しない
    w = fetch(new URL('../i18n/' + lang + '.json', here))
      .then((r) => { if (!r.ok) throw new Error('i18n ' + r.status); return r.json() as Promise<Record<string, string>>; })
      .then((dict) => {
        for (const [k, s] of Object.entries(dict)) (UI[k] ||= {})[lang] = s;
        langListeners.forEach((cb) => cb(lang));
      })
      .catch((e) => { langWaiters.delete(lang); console.warn('言語を読めない（英語で表示）', lang, e); });
    langWaiters.set(lang, w);
  }
  return w;
}

// 多言語の値から、閲覧者の言語のものを取る（無ければ en → ja）
export function pick<T extends Partial<Record<Lang, string>>>(obj: T | null | undefined, lang: Lang): string {
  if (!obj) return '';
  return obj[lang] || obj.en || obj.ja || '';
}

export function detectLang(): Lang {
  const url = new URL(location.href);
  let saved: string | null = null;
  try { saved = localStorage.getItem('lang'); } catch {}
  return pickLang(navigator.languages || [navigator.language], url.searchParams.get('lang') || saved);
}

export function rememberLang(lang: Lang) {
  try { localStorage.setItem('lang', lang); } catch {}
}

// data-i18n 属性の要素と、data-lang の段落を差し替える
// 題名の主従（11-07 作家）：日本語では「日本語を大きく、英語を小さく」、それ以外の言語では逆（英語を大きく、日本語を小さく）。
// 英語が無ければ ja を主に。主と従が同じ文字列なら従は無し
export function titlePair(title: Partial<Record<Lang, string>> | null | undefined, lang: Lang): { main: string; sub: string; mainLatin: boolean } {
  const ja = title?.ja || '', en = title?.en || '';
  if (lang === 'ja') return { main: ja || en, sub: en && en !== ja ? en : '', mainLatin: !ja };
  const main = en || ja;
  return { main, sub: ja && ja !== main ? ja : '', mainLatin: !!en };
}

export function applyLang(root: ParentNode, lang: Lang) {
  // 題名の主従：data-title-ja / data-title-en を持つ要素の .t-main / .t-sub を言語で入れ替える
  root.querySelectorAll<HTMLElement>('[data-title-ja], [data-title-en]').forEach((el) => {
    const { main, sub, mainLatin } = titlePair({ ja: el.dataset.titleJa, en: el.dataset.titleEn }, lang);
    if (el instanceof HTMLImageElement) { el.alt = main; return; }   // 作品ページの絵の alt（題名は訳さず、ja 以外は英題）
    const m = el.querySelector<HTMLElement>('.t-main'), s = el.querySelector<HTMLElement>('.t-sub');
    if (m) { m.textContent = main; m.classList.toggle('latin', mainLatin); }
    if (s) { s.textContent = sub; s.classList.toggle('latin', !mainLatin && !!sub); s.hidden = !sub; }
  });
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n!;
    if (UI[key]) el.textContent = t(key, lang, el.dataset.i18nW ? { w: el.dataset.i18nW } : undefined);
  });
  // 属性の訳（AUDIT-1 P1-6）：data-i18n-attr="aria-label:key" 。複数は ; 区切り。差し込みは data-i18n-vars（JSON。値が多言語のオブジェクトなら閲覧者の言語を取る）
  root.querySelectorAll<HTMLElement>('[data-i18n-attr]').forEach((el) => {
    let vars: Record<string, string> | undefined;
    try { const v = JSON.parse(el.dataset.i18nVars || 'null'); if (v) { vars = {}; for (const k in v) vars[k] = typeof v[k] === 'string' ? v[k] : pick(v[k], lang); } } catch {}
    for (const p of el.dataset.i18nAttr!.split(';')) { const [a, k] = p.split(':'); if (a && k && UI[k]) el.setAttribute(a, t(k, lang, vars)); }
  });
  root.querySelectorAll<HTMLElement>('[data-lang]').forEach((el) => { el.hidden = el.dataset.lang !== lang; });
  // data-lang の段落が閲覧者の言語に無ければ en、それも無ければ ja を出す
  const groups = new Map<HTMLElement, HTMLElement[]>();
  root.querySelectorAll<HTMLElement>('[data-lang]').forEach((el) => {
    const g = el.parentElement!; if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(el);
  });
  for (const els of groups.values()) {
    if (!els.some((e) => !e.hidden)) {
      const fb = els.find((e) => e.dataset.lang === 'en') || els.find((e) => e.dataset.lang === 'ja');
      if (fb) fb.hidden = false;
    }
  }
  document.documentElement.lang = lang;
}

export function fillLangSelect(select: HTMLSelectElement, lang: Lang, onChange: (l: Lang) => void) {
  select.innerHTML = '';
  for (const l of LANGS) {
    const o = document.createElement('option');
    o.value = l; o.textContent = t('lang_names', l); o.selected = l === lang;
    select.appendChild(o);
  }
  select.addEventListener('change', () => onChange(select.value as Lang));
}
