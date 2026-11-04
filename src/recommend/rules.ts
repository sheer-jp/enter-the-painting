// ルールだけのおすすめ（docs/RECOMMEND.md 8.6）。API が使えないとき、3 問の選択肢を 3 軸に写して最も近い作品を選ぶ
import type { Lang } from '../i18n';

export type L10n = Partial<Record<Lang, string>>;
export interface Axes { warmth: number; brightness: number; energy: number }

// public/catalog.json（docs/RECOMMEND.md 8.3）。ブラウザが使う項目だけを型にする
export interface CatalogWork {
  id: string;
  title: L10n;
  size_cm: [number, number];
  size_label?: string | L10n | null;
  year?: number | null;
  availability?: string | null;
  palette?: string[];
  axes: Axes;
  moods?: Partial<Record<Lang, string[]>>;
  messages?: Partial<Record<Lang, string[]>>;
  story?: L10n | null;
  image: string;
  url: string;
}
export interface Catalog {
  version: number;
  artist?: { intro?: L10n };
  openers?: Partial<Record<Lang, string[]>>;
  turns?: [number, number];
  works: CatalogWork[];
}

export interface Answers { time: 'morning' | 'day' | 'night'; color: 'warm' | 'cool' | 'vivid' | 'soft'; mood: 'quiet' | 'lively' }

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// 答えから目標の 3 軸を作る。決まらない軸は 0.5。同じ軸を 2 問が決めたら平均
export function targetAxes(a: Answers): Axes {
  let brightness = { morning: 0.8, day: 0.6, night: 0.3 }[a.time];
  let warmth: number | null = null;
  let energy: number | null = null;
  if (a.color === 'warm') warmth = 0.85;
  else if (a.color === 'cool') warmth = 0.2;
  else if (a.color === 'vivid') { energy = 0.85; brightness = (brightness + 0.7) / 2; }
  else energy = 0.25;
  const moodEnergy = a.mood === 'quiet' ? 0.25 : 0.8;
  energy = energy == null ? moodEnergy : (energy + moodEnergy) / 2;
  // 夜はあたたかい方へ寄せる
  const w = (warmth ?? 0.5) + (a.time === 'night' ? 0.15 : 0);
  return { warmth: clamp01(w), brightness: clamp01(brightness), energy: clamp01(energy) };
}

export function axisDistance(p: Axes, q: Axes): number {
  return Math.hypot(p.warmth - q.warmth, p.brightness - q.brightness, p.energy - q.energy);
}

// 3 軸のユークリッド距離が最小の作品と次点。同じ距離ならカタログの順
export function recommendByRules(catalog: Catalog, answers: Answers): { id: string; alt: string | null } {
  const target = targetAxes(answers);
  const ranked = catalog.works
    .map((w, i) => ({ id: w.id, i, d: axisDistance(target, w.axes) }))
    .sort((a, b) => a.d - b.d || a.i - b.i);
  if (!ranked.length) throw new Error('カタログに作品が無い');
  return { id: ranked[0].id, alt: ranked[1]?.id ?? null };
}

// 作品の moods を閲覧者の言語で（無ければ en → ja）
export function pickMoods(work: CatalogWork, lang: Lang): string[] {
  const m = work.moods || {};
  for (const l of [lang, 'en', 'ja'] as Lang[]) if (m[l]?.length) return m[l]!;
  return [];
}

// 理由の文を rec_reason の型（「{title}。{mood1}、{mood2}。」）から組む。mood が 1 つなら 2 つめを区切りごと消し、無ければ題名だけ
export function buildReason(template: string, title: string, moods: string[]): string {
  if (!moods.length) return title;
  let s = template.replace('{title}', title).replace('{mood1}', moods[0]);
  s = moods.length > 1 ? s.replace('{mood2}', moods[1]) : s.replace(/\s*[、,，]\s*\{mood2\}/, '').replace('{mood2}', '');
  return s;
}
