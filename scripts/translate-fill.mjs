#!/usr/bin/env node
// 翻訳キャッシュを、Claude API を使わずに埋めるための道具
//   node scripts/translate-fill.mjs --list [--work <id>] [--all]
//     未訳（8 言語のどれかが無い）の原文を JSON で出す。既定では、いま使われている文
//     （works/*/generated/space.json と public/catalog.json に出てくる ja）だけ。--all で古い項目も
//   node scripts/translate-fill.mjs --apply <file.json>
//     { "<キャッシュのパス>": { "<ja のハッシュ>": { "<lang>": "訳", ... } } } を書き戻す。
//     原文（ja / en）は変えない。既にある訳は上書きしない（作家の手直しを守る）
// 鍵（ja のハッシュ）とキャッシュの形は scripts/generate/translate.js のものをそのまま使う
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { key, loadCache, saveCache, LANGS } from './generate/translate.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = LANGS.filter((l) => l !== 'ja' && l !== 'en');

function cachePaths() {
  const out = [];
  const wd = join(ROOT, 'works');
  for (const id of existsSync(wd) ? readdirSync(wd).sort() : []) {
    const p = join(wd, id, 'generated', 'translations.json');
    if (existsSync(p)) out.push({ id, path: p });
  }
  const r = join(ROOT, 'recommend', 'translations.json');
  if (existsSync(r)) out.push({ id: 'recommend', path: r });
  return out;
}

// いま画面に出る原文（space.json / catalog.json の ja）
function liveJa() {
  const s = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (k === 'ja' && typeof x === 'string') s.add(x);
        else if (k === 'ja' && Array.isArray(x)) x.forEach((y) => typeof y === 'string' && s.add(y));
        walk(x);
      }
    }
  };
  const wd = join(ROOT, 'works');
  for (const id of existsSync(wd) ? readdirSync(wd) : []) {
    const p = join(wd, id, 'generated', 'space.json');
    if (existsSync(p)) walk(JSON.parse(readFileSync(p, 'utf8')));
  }
  const c = join(ROOT, 'public', 'catalog.json');
  if (existsSync(c)) walk(JSON.parse(readFileSync(c, 'utf8')));
  return s;
}

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

if (args.includes('--list')) {
  const only = opt('--work');
  const live = args.includes('--all') ? null : liveJa();
  const out = {};
  let n = 0;
  for (const { id, path } of cachePaths()) {
    if (only && id !== only) continue;
    const cache = loadCache(path);
    const items = {};
    for (const [k, e] of Object.entries(cache)) {
      if (!e.ja || (live && !live.has(e.ja))) continue;
      const missing = TARGET.filter((l) => !e[l]);
      if (!missing.length) continue;
      items[k] = { ja: e.ja, ...(e.en ? { en: e.en } : {}), missing };
      n += missing.length;
    }
    if (Object.keys(items).length) out[relative(ROOT, path)] = items;
  }
  console.log(JSON.stringify(out, null, 2));
  console.error(`未訳：${n} 件`);
} else if (opt('--apply')) {
  const patch = JSON.parse(readFileSync(opt('--apply'), 'utf8'));
  let wrote = 0, kept = 0;
  for (const [rel, entries] of Object.entries(patch)) {
    const path = join(ROOT, rel);
    if (!cachePaths().some((c) => c.path === path)) throw new Error(`翻訳キャッシュではない：${rel}`);
    const cache = loadCache(path);
    for (const [k, langs] of Object.entries(entries)) {
      const e = cache[k];
      if (!e) throw new Error(`${rel}: 鍵 ${k} が無い`);
      if (key(e.ja) !== k) throw new Error(`${rel}: 鍵 ${k} が原文のハッシュと合わない`);
      for (const [l, text] of Object.entries(langs)) {
        if (!TARGET.includes(l)) throw new Error(`${rel}: ${k} の ${l} は書けない（ja / en は原文）`);
        if (typeof text !== 'string' || !text.trim()) throw new Error(`${rel}: ${k} の ${l} が空`);
        if (e[l]) { kept++; continue; }
        e[l] = text.trim();
        wrote++;
      }
    }
    saveCache(path, cache);
  }
  console.log(`書いた：${wrote} 件、既にあったので残した：${kept} 件`);
} else {
  console.error('使い方：--list [--work <id>] [--all] ／ --apply <file.json>');
  process.exit(1);
}
