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
export function applyLang(root: ParentNode, lang: Lang) {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n!;
    if (UI[key]) el.textContent = t(key, lang);
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
