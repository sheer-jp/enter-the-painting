export const LANGS = ['ja', 'en', 'zh-Hans', 'zh-Hant', 'ko', 'fr', 'de', 'es', 'it', 'pt'] as const;
export type Lang = (typeof LANGS)[number];

// 端末の言語タグを 10 言語のどれかに正規化する。該当なしは null
export function normalizeLang(tag: string | null | undefined): Lang | null {
  if (!tag) return null;
  const t = tag.trim().toLowerCase();
  if (t.startsWith('zh')) {
    if (/^zh-(hant|tw|hk|mo)/.test(t) || /-hant\b/.test(t)) return 'zh-Hant';
    return 'zh-Hans';
  }
  const base = t.split(/[-_]/)[0];
  const hit = LANGS.find((l) => l.toLowerCase() === base);
  return hit ?? null;
}

// navigator.languages の順に見て最初に一致したもの。無ければ en
export function pickLang(tags: readonly string[], forced?: string | null): Lang {
  const f = normalizeLang(forced);
  if (f) return f;
  for (const t of tags) {
    const l = normalizeLang(t);
    if (l) return l;
  }
  return 'en';
}
