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
  rooms: { name: string; image: string; label: Multi; wall_width_cm: number; image_px?: [number, number]; quad_px?: [number, number][] }[];
  availability: string | null; contact: string | null;
}
