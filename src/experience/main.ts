// 「入る」後に読まれる体験バンドル。space.json を読み、流体が使えれば物語モード / 空間モード、使えなければ静止画モード
import * as THREE from 'three';
import { Fluid, placementFor, type Quality } from '../fluid/Fluid';
import { Soundscape } from '../audio/Soundscape';
import { buildHud } from './hud';
import { StoryMode } from '../story/StoryMode';
import type { Lang } from '../i18n';
import type { Space } from './types';

export interface RunOptions {
  workId: string; lang: Lang; vr: boolean; fromQr: boolean; debug: boolean;
  sound?: Soundscape; xrSession?: XRSession | null; onExit?: () => void;
}

const loadTexture = (url: string) => new Promise<THREE.Texture>((res, rej) => new THREE.TextureLoader().load(url, res, undefined, rej));

export async function run(o: RunOptions): Promise<void> {
  const base = `../../works/${o.workId}/`;
  const space: Space = await fetch(base + 'generated/space.json').then((r) => { if (!r.ok) throw new Error('space.json ' + r.status); return r.json(); });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stage = document.getElementById('stage')!;
  stage.hidden = false;
  document.body.style.overflow = 'hidden';
  const sound = o.sound ?? new Soundscape();
  await sound.unlock();
  const hud = buildHud(stage, o.lang, { fromQr: o.fromQr, debug: o.debug, hasRooms: (space.rooms?.length ?? 0) > 0, contact: space.contact });

  const canvas = document.createElement('canvas');
  stage.appendChild(canvas);
  let renderer: THREE.WebGLRenderer | null = null;
  let fluid: Fluid | null = null;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (Fluid.supported(renderer)) {
      const [painting, flow] = await Promise.all([loadTexture(base + 'generated/' + space.painting), loadTexture(base + 'generated/' + space.flow.texture)]);
      painting.minFilter = THREE.LinearFilter; painting.generateMipmaps = false;
      flow.minFilter = THREE.LinearFilter; flow.generateMipmaps = false;
      const quality: Quality = o.vr ? 'high' : (/Mobi|Android/i.test(navigator.userAgent) ? 'medium' : space.fluid.quality || 'high');
      fluid = new Fluid(renderer, { ...space.fluid, quality });
      fluid.init(painting, flow, { ...space.fluid, quality, speed: reduced ? space.fluid.speed * 0.3 : space.fluid.speed }, placementFor(space.aspect), space.back_color, lighten(space.back_color));
      // コンテキスト喪失（iOS のバックグラウンド復帰など）→ 静止画モードに落とす
      canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); console.warn('WebGL context lost'); }, { once: true });
    }
  } catch (e) {
    console.warn('流体を初期化できない。静止画モードへ', e);
    fluid = null;
  }

  const ctx = { renderer, fluid, space, sound, hud, lang: o.lang, reduced, fromQr: o.fromQr, base, debug: o.debug, canvas };
  const exit = () => {
    hud.dispose(); sound.dispose(); fluid?.dispose(); renderer?.dispose(); canvas.remove();
    stage.hidden = true; document.body.style.overflow = '';
    o.onExit?.();
  };
  try {
    if (o.vr && renderer && fluid) {
      const { SpaceMode } = await import('../space/SpaceMode');
      await new SpaceMode({ ...ctx, renderer, fluid }, o.xrSession ?? null).start();
    } else {
      await new StoryMode(ctx).start();
    }
  } finally {
    exit();
  }
}

function lighten(hex: string) {
  const c = new THREE.Color(hex); c.lerp(new THREE.Color('#ffffff'), 0.18); return '#' + c.getHexString();
}
