// 手前の粒の層（docs/VR_DEPTH.md 1 節、V-1）：絵の具の粒・筆の欠片が頭のそばを通って遠ざかる。
// InstancedMesh 1 つ = 1 ドローコール。位置は頂点シェーダで時間から決め（状態を持たない）、流体の速度で横にずらす
// 物語モード（2D）のドットの粒（F-6）も同じシェーダの平面の分岐（uFlat）で描く：aCenter.xy が絵の UV、そこから流れの速度 × 遅れでずらす
import * as THREE from 'three';
import type { Fluid } from '../fluid/Fluid';
import { PARTICLE_MAX, placeParticles, particleCount, flatDotCount, brightestIndex, peakUvs, rng, type DepthQuality, type ParticleSeed } from './depth';

const VERT = /* glsl */ `
attribute vec3 aCenter;      // 最接近点（頭からの位置）
attribute vec3 aAxis;        // 通り過ぎる向き
attribute vec4 aMotion;      // 片道の長さ、周期（秒）、位相、板の大きさ
attribute vec4 aLook;        // 形の番号、回転、（未使用 2 つ）
attribute vec3 aColor;
uniform float uTime;
uniform vec3 uHead;
uniform float uRadius;       // 絵の層の半径（S5 で戻る先）
uniform float uToLayer;
uniform float uAlpha;
uniform sampler2D uVel;      // 流体の速度（等距離円筒、単位はシミュレーションのテクセル / 秒）
uniform vec2 uVelTexel;
uniform float uVelOn;
uniform vec3 uLightWorld;
uniform float uFlat;         // 1：物語モードの平面（画面の NDC に直接置く）
uniform vec4 uPlane;         // 絵のメッシュの位置 xy・大きさ zw（NDC）
uniform float uScreenAspect; // 画面の幅 / 高さ
uniform vec2 uVelToUv;       // 平面：速度 → UV/秒
uniform float uLag;          // 平面：流れに何秒ぶん乗ったか
varying vec2 vUv;
varying vec2 vQ;
varying float vAlpha;
varying vec3 vColor;
varying vec3 vLight;         // 光の向き（ビュー空間）
const float PI = 3.141592653589793;
const float LAG = 1.6;       // 流れに何秒ぶん乗ったか（横ずれの大きさ）
void main() {
  if (uFlat > 0.5) {
    // 物語モード：山の位置（UV）から、その点の流れの速度 × 遅れでずらす。端を出たら反対側へ
    vec2 q = aCenter.xy;
    vec2 v = texture2D(uVel, q).xy * uVelOn;
    q = fract(q + clamp(v * uVelToUv * uLag, -0.25, 0.25));
    vec2 ndc = uPlane.xy + (q * 2.0 - 1.0) * uPlane.zw;
    vQ = position.xy * 2.0;
    vUv = uv * 0.5 + vec2(0.0, 0.5);     // アトラスの柔らかい丸（Canvas の左上のマス。テクスチャは上下反転なので v は上半分）
    vAlpha = uAlpha;
    vColor = aColor;
    vLight = vec3(0.0, 0.0, 1.0);
    gl_Position = vec4(ndc + position.xy * aMotion.w * 2.0 * vec2(1.0 / uScreenAspect, 1.0), 0.0, 1.0);
    return;
  }
  float s = fract(uTime / aMotion.y + aMotion.z);
  vec3 p = aCenter + aAxis * aMotion.x * (2.0 * s - 1.0);
  // 流体の速度に沿ってずらす（自分の方位角・仰角 → UV で 1 回参照）
  vec3 d = normalize(p);
  float lon = atan(d.x, -d.z), lat = asin(clamp(d.y, -1.0, 1.0));
  vec2 vel = texture2D(uVel, vec2(lon / (2.0 * PI) + 0.5, lat / PI + 0.5)).xy * uVelOn;
  vec2 dAng = clamp(vec2(2.0 * PI * vel.x * uVelTexel.x, PI * vel.y * uVelTexel.y) * LAG, -0.5, 0.5);
  vec3 tS = vec3(cos(lon), 0.0, sin(lon));
  vec3 bS = vec3(-sin(lon) * sin(lat), cos(lat), cos(lon) * sin(lat));
  float r = length(p);
  p += (tS * dAng.x + bS * dAng.y) * r;
  // S5：絵の層へ戻る
  p = mix(p, normalize(p) * uRadius, uToLayer);
  vec4 mv = viewMatrix * vec4(uHead + p, 1.0);
  // 板は常に見る人の側を向く。大きさは実寸（近いほど大きく見える）
  float c = cos(aLook.y), sn = sin(aLook.y);
  vQ = position.xy * 2.0;
  mv.xy += mat2(c, sn, -sn, c) * position.xy * aMotion.w;
  // 形は 2×2 のアトラスの 1 マス
  vec2 cell = vec2(mod(aLook.x, 2.0), floor(aLook.x / 2.0));
  vUv = (uv + cell) * 0.5;
  // 周期の両端は消えている（継ぎ目を見せない）
  vAlpha = uAlpha * smoothstep(0.0, 0.15, s) * smoothstep(1.0, 0.85, s);
  vColor = aColor;
  vLight = normalize((viewMatrix * vec4(uLightWorld, 1.0)).xyz - mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uBright;
varying vec2 vUv;
varying vec2 vQ;
varying float vAlpha;
varying vec3 vColor;
varying vec3 vLight;
void main() {
  float a = texture2D(uAtlas, vUv).a * vAlpha;
  if (a < 0.01) discard;
  // 丸みのある絵の具の粒：板の中心が手前に盛り上がった法線で、絵の層と同じ光を受ける（影は落とさない）
  vec3 n = normalize(vec3(vQ * 0.8, 1.0));
  float dif = 0.72 + 0.28 * max(dot(n, vLight), 0.0);
  gl_FragColor = vec4(vColor * dif * uBright, a);
  #include <colorspace_fragment>
}
`;

// 柔らかい丸と欠片 3 種（2×2）を実行時に Canvas で作る
function makeAtlas(seed: number): THREE.CanvasTexture {
  const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S * 2;
  const g = cv.getContext('2d')!;
  let st = seed >>> 0 || 7; const r = () => { st = (st * 1664525 + 1013904223) >>> 0; return st / 4294967296; };
  for (let k = 0; k < 4; k++) {
    const ox = (k % 2) * S, oy = Math.floor(k / 2) * S, cx = ox + S / 2, cy = oy + S / 2;
    if (k === 0) {
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, S * 0.45);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(ox, oy, S, S);
      continue;
    }
    // 欠片：ゆがんだ多角形を、影のぼかしで縁を柔らかく
    const n = 6 + Math.floor(r() * 4);
    g.save();
    g.beginPath(); g.rect(ox, oy, S, S); g.clip();
    g.shadowColor = 'rgba(255,255,255,1)'; g.shadowBlur = 8; g.shadowOffsetX = S * 4;   // 影だけをマスの中に落とす
    g.fillStyle = '#fff';
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2 + r() * 0.4;
      const rad = S * (0.2 + r() * 0.2) * (k === 3 ? (i % 2 ? 0.6 : 1) : 1);
      const x = cx + Math.cos(th) * rad * (k === 2 ? 1.25 : 1) - S * 4, y = cy + Math.sin(th) * rad * (k === 2 ? 0.7 : 1);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath(); g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(cv);
  t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  return t;
}

// 流体の速度テクスチャ。Fluid に公開の口が無いので、内部の vel を読む（src/fluid/ は触らない）。口が足されたらそちらを使う
export function velocityTexture(fluid: Fluid): THREE.Texture | null {
  const f = fluid as unknown as { velocity?: THREE.Texture; vel?: { read?: THREE.WebGLRenderTarget } };
  return f.velocity ?? f.vel?.read?.texture ?? null;
}

export class Particles {
  readonly mesh: THREE.InstancedMesh;
  readonly mat: THREE.ShaderMaterial;
  private atlas: THREE.CanvasTexture;
  // 検査モードのため、配置（頭からの位置の計算に使う）を残す
  readonly seeds: ParticleSeed[];

  // flat：物語モードのドット（山の UV、色、直径＝画面の高さに対する割合）。あれば VR の配置の代わりに使う
  constructor(palette: string[], lightWorld: THREE.Vector3, radius: number, seed = 1, flat?: { uvs: [number, number][]; color: string; sizes: number[] }) {
    const seeds = this.seeds = flat
      ? flat.uvs.map((uv, i) => ({ center: [uv[0], uv[1], 0] as [number, number, number], axis: [0, 0, 0] as [number, number, number], half: 0, size: flat.sizes[i], period: 1, phase: 0, shape: 0, color: 0, spin: 0 }))
      : placeParticles(PARTICLE_MAX, palette.length, seed);
    if (flat) palette = [flat.color];
    const max = seeds.length;
    const geo = new THREE.PlaneGeometry(1, 1);
    const center = new Float32Array(max * 3), axis = new Float32Array(max * 3), motion = new Float32Array(max * 4), look = new Float32Array(max * 4), color = new Float32Array(max * 3);
    const cols = (palette.length ? palette : ['#888888']).map((h) => new THREE.Color(h));
    seeds.forEach((p, i) => {
      center.set(p.center, i * 3); axis.set(p.axis, i * 3);
      motion.set([p.half, p.period, p.phase, p.size], i * 4); look.set([p.shape, p.spin, 0, 0], i * 4);
      const c = cols[p.color % cols.length]; color.set([c.r, c.g, c.b], i * 3);
    });
    geo.setAttribute('aCenter', new THREE.InstancedBufferAttribute(center, 3));
    geo.setAttribute('aAxis', new THREE.InstancedBufferAttribute(axis, 3));
    geo.setAttribute('aMotion', new THREE.InstancedBufferAttribute(motion, 4));
    geo.setAttribute('aLook', new THREE.InstancedBufferAttribute(look, 4));
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(color, 3));
    this.atlas = makeAtlas(seed * 7919);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 }, uHead: { value: new THREE.Vector3() }, uRadius: { value: radius }, uToLayer: { value: 0 }, uAlpha: { value: 0 },
        uVel: { value: null }, uVelTexel: { value: new THREE.Vector2(1 / 512, 1 / 256) }, uVelOn: { value: 0 },
        uLightWorld: { value: lightWorld }, uAtlas: { value: this.atlas }, uBright: { value: flat ? 1 : 0.85 },
        uFlat: { value: flat ? 1 : 0 }, uPlane: { value: new THREE.Vector4(0, 0, 1, 1) }, uScreenAspect: { value: 1 }, uVelToUv: { value: new THREE.Vector2() }, uLag: { value: 2.5 },
      },
    });
    if (flat) { this.mat.depthTest = false; this.mat.side = THREE.FrontSide; }
    this.mesh = new THREE.InstancedMesh(geo, this.mat, max);
    this.mesh.frustumCulled = false;   // 位置は頂点シェーダで動く
    this.mesh.renderOrder = 10;        // 奥の光 < 床 < 絵の層 < 粒
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  // 毎フレーム：数（品質で 80 / 40 / 0）、見え方、流体の速度
  update(time: number, head: THREE.Vector3, quality: DepthQuality, alpha: number, toLayer: number, fluid: Fluid) {
    const u = this.mat.uniforms;
    this.mesh.count = particleCount(quality);
    this.mesh.visible = alpha > 0.001 && this.mesh.count > 0;
    u.uTime.value = time; (u.uHead.value as THREE.Vector3).copy(head);
    u.uAlpha.value = alpha; u.uToLayer.value = toLayer;
    const vt = velocityTexture(fluid);
    u.uVel.value = vt; u.uVelOn.value = vt ? 1 : 0;
    const img = vt?.image as { width?: number; height?: number } | undefined;
    if (img?.width && img?.height) (u.uVelTexel.value as THREE.Vector2).set(1 / img.width, 1 / img.height);
  }

  // 物語モードのドットの層（F-6）。look.dots > 0 で厚みがある作品だけ。無ければ null
  static flat(relief: THREE.Texture, palette: string[], dots: number, seed = 1): Particles | null {
    const n = flatDotCount(dots);
    const img = relief.image as CanvasImageSource & { width?: number; height?: number } | undefined;
    if (!n || !img?.width || !img?.height) return null;
    // 厚みを小さく読んで山を探す（長辺 256）
    const k = Math.min(1, 256 / Math.max(img.width, img.height));
    const w = Math.max(8, Math.round(img.width * k)), h = Math.max(8, Math.round(img.height * k));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true }); if (!g) return null;
    g.drawImage(img, 0, 0, w, h);
    const uvs = peakUvs(g.getImageData(0, 0, w, h).data, w, h, n);
    if (!uvs.length) return null;
    const r = rng(seed);
    const sizes = uvs.map(() => 0.012 + 0.012 * r());     // 直径は画面の高さの 1.2〜2.4%
    const p = new Particles(palette, new THREE.Vector3(), 1, seed, { uvs, color: palette[brightestIndex(palette)] || '#ffffff', sizes });
    p.mesh.count = uvs.length;
    return p;
  }

  // 毎フレーム（物語モード）：絵のメッシュの位置と大きさ（NDC）、流体の速度、不透明度。velToUv は速度 → UV/秒
  updateFlat(alpha: number, pos: { x: number; y: number }, scale: { x: number; y: number }, screenAspect: number, fluid: Fluid, velToUv: [number, number]) {
    const u = this.mat.uniforms;
    this.mesh.visible = alpha > 0.001;
    u.uAlpha.value = alpha;
    (u.uPlane.value as THREE.Vector4).set(pos.x, pos.y, scale.x, scale.y);
    u.uScreenAspect.value = screenAspect;
    const vt = velocityTexture(fluid);
    u.uVel.value = vt; u.uVelOn.value = vt ? 1 : 0;
    (u.uVelToUv.value as THREE.Vector2).set(velToUv[0], velToUv[1]);
  }

  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); this.atlas.dispose(); }
}
