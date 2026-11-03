import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export const LANGS = ['ja', 'en', 'zh-Hans', 'zh-Hant', 'ko', 'fr', 'de', 'es', 'it', 'pt'];
export const key = (ja) => createHash('sha1').update(ja).digest('hex').slice(0, 12);

// translations.json：{ "<ja のハッシュ>": { "ja": "...", "en": "...", ... } }
// 原文（ja）が変わればハッシュが変わり再翻訳。変わらなければ手直しを保持
export function loadCache(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
}

export function saveCache(path, cache) {
  writeFileSync(path, JSON.stringify(cache, null, 2) + '\n');
}

// texts: [{ ja, en? }]。en は作家が書いたもの（あれば正）
export async function translateAll(texts, cachePath, { apiKey = process.env.ANTHROPIC_API_KEY } = {}) {
  const cache = loadCache(cachePath);
  const missing = [];
  for (const t of texts) {
    const k = key(t.ja);
    cache[k] = cache[k] || {};
    cache[k].ja = t.ja;
    if (t.en) cache[k].en = t.en;
    for (const l of LANGS) if (!cache[k][l]) missing.push({ k, lang: l, ja: t.ja, en: cache[k].en });
  }
  if (missing.length && apiKey) {
    const { translateWithClaude } = await import('./claude.js');
    const results = await translateWithClaude(missing, apiKey);
    for (const r of results) cache[r.k][r.lang] = r.text;
  } else if (missing.length) {
    const langs = [...new Set(missing.map((m) => m.lang))];
    console.warn(`  翻訳をスキップ（ANTHROPIC_API_KEY なし）：${missing.length} 件 [${langs.join(', ')}]。generated/translations.json を手で埋めてもよい`);
  }
  saveCache(cachePath, cache);
  return (ja) => {
    const e = cache[key(ja)] || { ja };
    const out = {};
    for (const l of LANGS) if (e[l]) out[l] = e[l];
    return out;
  };
}
