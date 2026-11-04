import type { Lang } from '../i18n';
export type Multi = Partial<Record<Lang, string>>;
export interface Space {
  id: string; title: Multi; size_cm: [number, number]; aspect: number; year: number | null;
  painting: string; painting_full?: string; painting_blur?: string; source_px?: [number, number];
  palette: string[]; text_color: string; back_color: string;
  flow: { texture: string; strength: number; edge_density: number };
  fluid: { vorticity: number; speed: number; quality: 'high' | 'medium' | 'low'; restore: number; drive?: number };
  space: { radius_m: number; melt_distance_m: number };
  audio: { voice: string | null; ambient: 'calm' | 'wind' | 'water' | 'drone' | 'none' };
  messages: ({ at: number } & Multi)[];
  story: Multi | null;
  size_label?: Multi | null;
  rooms: Room[];
  availability: string | null; contact: string | null;
}

// 部屋で見る（space.json の rooms[]）。文章は docs/SIZE_UX.md 3・5 節
export interface Room {
  name: string; image: string; label: Multi; wall_width_cm: number;
  image_px?: [number, number]; quad_px?: [number, number][];
  px_per_cm?: number; confidence?: 'high' | 'mid' | 'low' | null; primary_ref?: string | null;
  compare?: Multi | null;    // 比較の一文（数字なし）
  compare2?: Multi | null;   // 2 つ目の比較（基準物の実寸つき）
  about?: Multi | null;      // 部屋の説明（壁の幅、掛ける高さ）
  note?: Multi | null;       // 注記（AI のイメージ、目安）
}
