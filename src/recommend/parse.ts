// AI の出力の解釈（docs/RECOMMEND.md 8.5）
// 経路は 2 つ：(1) 中継が流す data: {"recommend": {...}}（ツール recommend_work の呼び出し。正）
//             (2) 文のあとの 1 行 {"recommend":"<id>","alt":"<id>"|null}（古い応答や、ツールが呼ばれなかったときの保険）
import type { Catalog } from './rules';

export interface RecJson { recommend: string; alt: string | null; reason?: { ja: string; en: string }; matched_moods?: string[] }

// 経路 (1)：SSE の data の "recommend" の中身を確かめる。形が合わなければ null
export function parseRecommendEvent(v: unknown): RecJson | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.recommend !== 'string' || !o.recommend) return null;
  const out: RecJson = { recommend: o.recommend, alt: typeof o.alt === 'string' && o.alt ? o.alt : null };
  const r = o.reason as Record<string, unknown> | undefined;
  if (r && typeof r === 'object' && typeof r.ja === 'string' && typeof r.en === 'string') out.reason = { ja: r.ja, en: r.en };
  // 使ったことば（作品の moods の語）。文字列の配列のときだけ通す。空の語は落とす。最大 3 語
  if (Array.isArray(o.matched_moods)) {
    const m = o.matched_moods.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()).slice(0, 3);
    if (m.length) out.matched_moods = m;
  }
  return out;
}

// 文が空のときに出す理由（閲覧者の言語が ja なら ja、それ以外は en）
export function reasonText(json: RecJson, lang: string): string {
  if (!json.reason) return '';
  return (lang === 'ja' ? json.reason.ja : json.reason.en) || json.reason.en || json.reason.ja || '';
}

const MARK = '{"recommend"';

// 経路 (2)：文と JSON に分ける。ストリーム中でも呼べる：JSON の始まり（途中まで来た "{\"rec" なども）から後ろは文に含めない
export function splitRecommendation(text: string): { prose: string; json: RecJson | null } {
  const m = /\{\s*"recommend"/.exec(text);
  if (!m) return { prose: trimTail(stripPartialMark(text)), json: null };
  return { prose: trimTail(text.slice(0, m.index)), json: parseJson(text.slice(m.index)) };
}

// 末尾が MARK の途中まで（"{", "{\"re" …）なら、そこを隠す
function stripPartialMark(text: string): string {
  const i = text.lastIndexOf('{');
  if (i < 0) return text;
  const tail = text.slice(i).replace(/\s+/g, '');
  return MARK.startsWith(tail) ? text.slice(0, i) : text;
}

// 文の終わりの空白と、規則に反して付いた ``` を落とす
function trimTail(s: string): string {
  return s.replace(/\s*(```(json)?)?\s*$/, '');
}

function parseJson(s: string): RecJson | null {
  const end = s.indexOf('}');
  if (end < 0) return null;
  try {
    const o = JSON.parse(s.slice(0, end + 1)) as Record<string, unknown>;
    if (typeof o.recommend !== 'string') return null;
    return { recommend: o.recommend, alt: typeof o.alt === 'string' && o.alt ? o.alt : null };
  } catch { return null; }
}

// カタログに照らす：無い id は最初の作品に、alt は無い id・同じ id なら null
export function resolveRecommendation(json: RecJson, catalog: Catalog): { id: string; alt: string | null } {
  const ids = catalog.works.map((w) => w.id);
  const id = ids.includes(json.recommend) ? json.recommend : ids[0];
  const alt = json.alt && json.alt !== id && ids.includes(json.alt) ? json.alt : null;
  return { id, alt };
}
