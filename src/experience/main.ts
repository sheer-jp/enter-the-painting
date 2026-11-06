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
  // ?space=flat：空間モードを WebXR 無しの平面カメラで動かす検査モード（docs/VR_DEPTH.md 5 節、V-4）。流体は VR と同じ等距離円筒
  const flatSpace = new URLSearchParams(location.search).get('space') === 'flat';
  if (flatSpace) o = { ...o, vr: true, xrSession: null };
  // 作品ページは /w/<id>/ にあるので既定は ../../。別の場所に置くとき（アーティファクトなど）は meta で差し替える
  const assetBase = document.querySelector<HTMLMetaElement>('meta[name="asset-base"]')?.content ?? '../../';
  const base = `${assetBase}works/${o.workId}/`;
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
  let relief: THREE.Texture | null = null;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (Fluid.supported(renderer)) {
      // 物語モードは絵だけの領域（解像度を絵に全部使う）、VR は等距離円筒。色場の初期値は写真のフル解像度
      const [painting, flow] = await Promise.all([loadTexture(base + 'generated/' + (space.painting_full || space.painting)), loadTexture(base + 'generated/' + space.flow.texture)]);
      painting.minFilter = THREE.LinearFilter; painting.generateMipmaps = false;
      flow.minFilter = THREE.LinearFilter; flow.generateMipmaps = false;
      // 絵の具の厚みの初期値（無い・読めない作品は平ら）
      relief = space.relief ? await loadTexture(base + 'generated/' + space.relief.texture).catch(() => null) : null;
      if (relief) { relief.minFilter = THREE.LinearFilter; relief.generateMipmaps = false; }
      // ?debug=1&q=medium などで品質を固定できる（スクリーンショットの確認用）
      const forced = o.debug ? new URLSearchParams(location.search).get('q') : null;
      const quality: Quality = forced === 'high' || forced === 'medium' || forced === 'low' ? forced : o.vr ? 'high' : (/Mobi|Android/i.test(navigator.userAgent) ? 'medium' : space.fluid.quality || 'high');
      fluid = new Fluid(renderer, { ...space.fluid, quality });
      fluid.init(painting, flow, { ...space.fluid, quality, speed: reduced ? space.fluid.speed * 0.3 : space.fluid.speed, tempo: reduced ? (space.fluid.tempo ?? 0.6) * 0.5 : space.fluid.tempo }, placementFor(space.aspect), space.back_color, lighten(space.back_color), o.vr ? 'equirect' : 'painting', space.aspect, relief);
      // コンテキスト喪失（iOS のバックグラウンド復帰など）→ 静止画モードに落とす
      canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); console.warn('WebGL context lost'); }, { once: true });
    }
  } catch (e) {
    console.warn('流体を初期化できない。静止画モードへ', e);
    fluid = null;
  }

  const ctx = { renderer, fluid, relief, space, sound, hud, lang: o.lang, reduced, fromQr: o.fromQr, base, debug: o.debug, canvas };
  const exit = () => {
    hud.dispose(); sound.dispose(); fluid?.dispose(); renderer?.dispose(); canvas.remove();
    stage.hidden = true; document.body.style.overflow = '';
    o.onExit?.();
  };
  try {
    let fellBack = false;
    if (o.vr && renderer && fluid) {
      const { SpaceMode } = await import('../space/SpaceMode');
      const r = await new SpaceMode({ ...ctx, renderer, fluid }, o.xrSession ?? null, flatSpace).start();
      fellBack = r === 'fallback';
    }
    if (!o.vr || fellBack || !renderer || !fluid) {
      fluid?.reset();
      await new StoryMode(ctx).start();
    }
  } finally {
    exit();
  }
}

function lighten(hex: string) {
  const c = new THREE.Color(hex); c.lerp(new THREE.Color('#ffffff'), 0.18); return '#' + c.getHexString();
}
