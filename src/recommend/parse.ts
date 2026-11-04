// AI の出力の解釈（docs/RECOMMEND.md 8.5）。文のあとに 1 行だけ {"recommend":"<id>","alt":"<id>"|null}
import type { Catalog } from './rules';

export interface RecJson { recommend: string; alt: string | null }

const MARK = '{"recommend"';

// 文と JSON に分ける。ストリーム中でも呼べる：JSON の始まり（途中まで来た "{\"rec" なども）から後ろは文に含めない
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
