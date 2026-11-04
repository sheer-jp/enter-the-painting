// GPU 流体シム。領域は 2:1 の等距離円筒。絵は前方の矩形に置き、残りは基調色。
// 色の移流は MacCormack + 原画への弱い回帰（数値拡散で構図が消えないように）。
import * as THREE from 'three';
import * as S from './shaders';

export type Quality = 'high' | 'medium' | 'low';
// equirect：2:1 の等距離円筒（VR。横は繰り返し）。painting：絵だけの領域（物語モード。解像度を絵に全部使う）
export type Domain = 'equirect' | 'painting';
export interface FluidParams { vorticity: number; speed: number; quality: Quality; restore: number; drive?: number; tempo?: number }
export interface PaintingRect { x: number; y: number; w: number; h: number }

const EQUIRECT: Record<Quality, { dye: [number, number]; sim: [number, number]; iters: number }> = {
  high: { dye: [2048, 1024], sim: [512, 256], iters: 20 },
  medium: { dye: [1024, 512], sim: [256, 128], iters: 14 },
  low: { dye: [512, 256], sim: [128, 64], iters: 8 },
};
const PAINTING_SPEC: Record<Quality, { long: number; simLong: number; iters: number }> = {
  high: { long: 2048, simLong: 512, iters: 20 },
  medium: { long: 1280, simLong: 320, iters: 14 },
  low: { long: 640, simLong: 160, iters: 8 },
};

function sizesFor(domain: Domain, q: Quality, aspect: number) {
  if (domain === 'equirect') return EQUIRECT[q];
  const sp = PAINTING_SPEC[q];
  const dims = (long: number): [number, number] => (aspect >= 1 ? [long, Math.max(16, Math.round(long / aspect))] : [Math.max(16, Math.round(long * aspect)), long]);
  return { dye: dims(sp.long), sim: dims(sp.simLong), iters: sp.iters };
}

// 絵の矩形：高さは領域の 75%（緯度 ±67°）、幅は絵の比率から（等距離円筒は赤道で 1:1）
export function placementFor(aspect: number): PaintingRect {
  const h = 0.75;
  let w = (h * aspect) / 2;
  if (w > 0.45) w = 0.45;
  return { x: 0.5 - w / 2, y: 0.5 - h / 2, w, h };
}

// 渦の強さ：strength 1 を 1 秒続けると、最大の所の速さが「領域の高さ × これ / 秒」増える（解像度と作品の speed によらない）
const VORTEX_RATE = 0.2;   // 0.5 だと渦で色が混ざりすぎて彩度が落ちた（Fable 調整 11-04）

// 全体の速さの呼吸：周期の揃わない 2 つの正弦（37 秒と 23 秒）。tempo 0.6 で約 0.7〜1.3 倍、tempo 0 で 1
export function breathing(t: number, tempo: number): number {
  return 1 + 0.5 * tempo * (0.6 * Math.sin((2 * Math.PI * t) / 37) + 0.4 * Math.sin((2 * Math.PI * t) / 23 + 1));
}

// 触れる強さと長さ（docs/EXPERIENCE.md 8.2）。p は強さ 0〜1、hold は押し始めからの秒（VR は p をかけて進めた秒）
export const TOUCH_TAP_MAX = 0.4;        // これ未満で離せばタップ。これを超えて止めたままなら渦が育ち始める
// なぞる力と半径の倍率：強いほど太く強く、長いほど沈む（0 → 2 秒で半径 ×1 → ×2、力 ×1 → ×1.4）
export function touchStroke(p: number, hold: number): { force: number; radius: number } {
  const sink = Math.min(1, Math.max(0, hold) / 2);
  return { force: (1 + 0.4 * sink) * (0.6 + 0.8 * p), radius: (1 + sink) * (0.7 + 0.6 * p) };
}
// 止めたまま押し続けたときの渦。0.4 秒までは null。radius は領域の高さに対する割合
export function touchVortex(p: number, hold: number): { strength: number; radius: number } | null {
  if (hold <= TOUCH_TAP_MAX) return null;
  const g = Math.min(1, (hold - TOUCH_TAP_MAX) / 2.5);
  return { strength: g * 0.35 * (0.5 + 0.5 * p), radius: 0.04 + 0.08 * g };
}
// タップの波紋の強さ：押していた時間で 50 → 90（0.1 秒 → 0.4 秒）
export function tapStrength(hold: number): number {
  return 50 + 40 * Math.min(1, Math.max(0, (hold - 0.1) / 0.3));
}

class Pass {
  mat: THREE.ShaderMaterial;
  constructor(frag: string, uniforms: Record<string, THREE.IUniform>) {
    this.mat = new THREE.ShaderMaterial({ vertexShader: S.VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
  }
}

function makeRT(w: number, h: number, type: THREE.TextureDataType, wrapS: THREE.Wrapping = THREE.RepeatWrapping) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    wrapS, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
  });
  return rt;
}

class Double {
  a: THREE.WebGLRenderTarget; b: THREE.WebGLRenderTarget;
  constructor(w: number, h: number, type: THREE.TextureDataType, wrapS: THREE.Wrapping = THREE.RepeatWrapping) { this.a = makeRT(w, h, type, wrapS); this.b = makeRT(w, h, type, wrapS); }
  get read() { return this.a; }
  get write() { return this.b; }
  swap() { const t = this.a; this.a = this.b; this.b = t; }
  dispose() { this.a.dispose(); this.b.dispose(); }
}

export class Fluid {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private dye!: Double; private vel!: Double; private pressure!: Double;
  private curl!: THREE.WebGLRenderTarget; private div!: THREE.WebGLRenderTarget;
  private tmp1!: THREE.WebGLRenderTarget; private tmp2!: THREE.WebGLRenderTarget;
  private original!: THREE.WebGLRenderTarget;
  // 絵の具の厚み（R だけ使う）。品質 medium / low では色場の半分の解像度
  private thick!: Double; private thickOriginal!: THREE.WebGLRenderTarget;
  private thickTmp1!: THREE.WebGLRenderTarget; private thickTmp2!: THREE.WebGLRenderTarget;
  private thickDims: [number, number] = [1, 1];
  private relief: THREE.Texture | null = null;
  private stamps: { x: number; y: number; r: number; amount: number; dx: number; dy: number; kind: number; ring: number }[] = [];
  private pendingVortex: { uv: [number, number]; strength: number; radius: number }[] = [];
  private passes!: Record<string, Pass>;
  private params: FluidParams;
  private quality: Quality;
  private domain: Domain = 'equirect';
  private aspect = 1;
  private sizes = EQUIRECT.high;
  private iters = 20;
  private strength = 1;
  private time = 0;
  private painting!: THREE.Texture; private flow!: THREE.Texture;
  private back = new THREE.Color('#222'); private back2 = new THREE.Color('#333');
  placement: PaintingRect = { x: 0.35, y: 0.125, w: 0.3, h: 0.75 };
  private fizzProgress = -1; private fizzAmount = 0;
  private pendingSplats: { uv: [number, number]; force: [number, number]; radius: number }[] = [];

  constructor(renderer: THREE.WebGLRenderer, params: FluidParams) {
    this.renderer = renderer;
    this.params = { ...params };
    this.quality = params.quality;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.scene.add(this.quad);
  }

  // half float の RenderTarget が使えるか（使えなければ静止画モードに落とす）
  static supported(renderer: THREE.WebGLRenderer): boolean {
    const gl = renderer.getContext();
    if (!(gl instanceof WebGL2RenderingContext)) return false;
    return !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
  }

  get texture(): THREE.Texture { return this.dye.read.texture; }
  get size(): [number, number] { return this.sizes.dye; }
  // 絵の具の厚み（R、0〜1）。表示のシェーダが法線に使う
  get thickness(): THREE.Texture { return this.thick.read.texture; }
  get thicknessSize(): [number, number] { return this.thickDims; }

  // domain = painting のときは placement を無視して絵が領域全体になる。aspect は絵の幅/高さ
  // relief は厚みの初期値（relief.png）。無ければ平ら
  init(painting: THREE.Texture, flow: THREE.Texture, p: FluidParams, placement: PaintingRect, back: string, back2?: string, domain: Domain = 'equirect', aspect = 1, relief: THREE.Texture | null = null) {
    this.params = { ...p };
    this.domain = domain; this.aspect = aspect;
    this.painting = painting; this.flow = flow;
    this.placement = domain === 'painting' ? { x: 0, y: 0, w: 1, h: 1 } : placement;
    this.back.set(back); this.back2.set(back2 || back);
    painting.colorSpace = THREE.SRGBColorSpace;
    flow.colorSpace = THREE.NoColorSpace;
    this.relief = relief;
    if (relief) relief.colorSpace = THREE.NoColorSpace;
    this.allocate(p.quality);
    this.buildPasses();
    this.reset();
  }

  private allocate(q: Quality) {
    this.quality = q;
    const sz = sizesFor(this.domain, q, this.aspect);
    this.sizes = sz;
    this.iters = sz.iters;
    const type = THREE.HalfFloatType;
    const wrap = this.domain === 'equirect' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    this.dye?.dispose(); this.vel?.dispose(); this.pressure?.dispose();
    this.curl?.dispose(); this.div?.dispose(); this.tmp1?.dispose(); this.tmp2?.dispose(); this.original?.dispose();
    this.disposeThick();
    this.dye = new Double(sz.dye[0], sz.dye[1], type, wrap);
    this.original = makeRT(sz.dye[0], sz.dye[1], type, wrap);
    this.tmp1 = makeRT(sz.dye[0], sz.dye[1], type, wrap);
    this.tmp2 = makeRT(sz.dye[0], sz.dye[1], type, wrap);
    this.vel = new Double(sz.sim[0], sz.sim[1], type, wrap);
    this.pressure = new Double(sz.sim[0], sz.sim[1], type, wrap);
    this.curl = makeRT(sz.sim[0], sz.sim[1], type, wrap);
    this.div = makeRT(sz.sim[0], sz.sim[1], type, wrap);
    // 厚み：high は色場と同じ、medium / low は半分。同じ大きさなら色の作業用を共用する（色の移流のあとに使うので衝突しない）
    const half = q !== 'high';
    const tw = half ? Math.max(16, Math.round(sz.dye[0] / 2)) : sz.dye[0], th = half ? Math.max(16, Math.round(sz.dye[1] / 2)) : sz.dye[1];
    this.thickDims = [tw, th];
    this.thick = new Double(tw, th, type, wrap);
    this.thickOriginal = makeRT(tw, th, type, wrap);
    this.thickTmp1 = half ? makeRT(tw, th, type, wrap) : this.tmp1;
    this.thickTmp2 = half ? makeRT(tw, th, type, wrap) : this.tmp2;
  }

  private disposeThick() {
    if (!this.thick) return;
    this.thick.dispose(); this.thickOriginal.dispose();
    if (this.thickTmp1 !== this.tmp1) this.thickTmp1.dispose();
    if (this.thickTmp2 !== this.tmp2) this.thickTmp2.dispose();
  }

  private buildPasses() {
    const u = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v }]));
    const rect = new THREE.Vector4(this.placement.x, this.placement.y, this.placement.w, this.placement.h);
    const wrapX = this.domain === 'equirect' ? 1 : 0;
    this.passes = {
      initDye: new Pass(S.INIT_DYE, u({ uPainting: this.painting, uRect: rect, uBack: this.back, uBack2: this.back2 })),
      initVel: new Pass(S.INIT_VEL, u({ uFlow: this.flow, uRect: rect, uStrength: 1 })),
      advect: new Pass(S.ADVECT, u({ uVelocity: null, uSource: null, uTexel: new THREE.Vector2(), uDt: 0, uDissipation: 0 })),
      maccormack: new Pass(S.MACCORMACK, u({ uVelocity: null, uPhi0: null, uPhiHat1: null, uPhiHat0: null, uOriginal: null, uTexel: new THREE.Vector2(), uDt: 0, uRestore: 0 })),
      curl: new Pass(S.CURL, u({ uVelocity: null, uTexel: new THREE.Vector2() })),
      vorticity: new Pass(S.VORTICITY, u({ uVelocity: null, uCurl: null, uTexel: new THREE.Vector2(), uCurlStrength: 0, uDt: 0 })),
      divergence: new Pass(S.DIVERGENCE, u({ uVelocity: null, uTexel: new THREE.Vector2(), uWrapX: this.domain === 'equirect' ? 1 : 0 })),
      pressure: new Pass(S.PRESSURE, u({ uPressure: null, uDivergence: null, uTexel: new THREE.Vector2() })),
      gradient: new Pass(S.GRADIENT_SUBTRACT, u({ uPressure: null, uVelocity: null, uTexel: new THREE.Vector2() })),
      splat: new Pass(S.SPLAT, u({ uTarget: null, uPoint: new THREE.Vector2(), uValue: new THREE.Vector3(), uRadius: 0.001, uAspect: this.sizes.dye[0] / this.sizes.dye[1] })),
      fizz: new Pass(S.FIZZ, u({ uVelocity: null, uRect: rect, uProgress: 0, uAmount: 0, uTime: 0 })),
      drive: new Pass(S.DRIVE, u({ uVelocity: null, uFlow: this.flow, uRect: rect, uRate: 0, uTarget: 0, uTime: 0, uTempo: 0, uAspect: this.sizes.sim[0] / this.sizes.sim[1], uWrapX: wrapX })),
      copy: new Pass(S.DISPLAY, u({ uDye: null, uView: new THREE.Vector4(0, 0, 1, 1) })),
      initThick: new Pass(S.INIT_THICK, u({ uRelief: this.relief, uRect: rect, uHas: this.relief ? 1 : 0 })),
      thick: new Pass(S.THICK_UPDATE, u({
        uVelocity: null, uPhi0: null, uPhiHat1: null, uPhiHat0: null, uOriginal: null, uDiv: null, uTexel: new THREE.Vector2(), uDt: 0, uRestore: 0, uDivK: 0,
        uRect: rect, uFizzProgress: -1, uFizzAmount: 0, uTime: 0, uAspect: this.thickDims[0] / this.thickDims[1], uWrapX: wrapX,
        uStampCount: 0, uStamp: Array.from({ length: S.MAX_STAMPS }, () => new THREE.Vector4()), uStampDir: Array.from({ length: S.MAX_STAMPS }, () => new THREE.Vector4()),
      })),
      vortex: new Pass(S.VORTEX, u({ uVelocity: null, uPoint: new THREE.Vector2(), uRadius: 0.1, uStrength: 0, uAspect: this.sizes.sim[0] / this.sizes.sim[1], uWrapX: wrapX })),
    };
  }

  private run(pass: Pass, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = pass.mat;
    const prev = this.renderer.getRenderTarget();
    const prevXr = this.renderer.xr.enabled;
    this.renderer.xr.enabled = false;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(prev);
    this.renderer.xr.enabled = prevXr;
  }

  // 絵と速度を初期状態に戻す
  reset() {
    this.run(this.passes.initDye, this.dye.read);
    this.run(this.passes.initDye, this.original);
    this.passes.initVel.mat.uniforms.uStrength.value = 1;
    this.run(this.passes.initVel, this.vel.read);
    this.run(this.passes.initThick, this.thick.read);
    this.run(this.passes.initThick, this.thickOriginal);
    this.stamps.length = 0; this.pendingVortex.length = 0; this.pendingSplats.length = 0;
    // 圧力を 0 に
    this.renderer.setRenderTarget(this.pressure.read); this.renderer.clear(); this.renderer.setRenderTarget(null);
    this.time = 0;
  }

  // 0〜1。S1 のかすかな流れ〜本来の強さ
  setStrength(v: number) { this.strength = Math.max(0, Math.min(1.5, v)); }
  setRestore(v: number) { this.params.restore = v; }
  setParams(p: Partial<FluidParams>) { Object.assign(this.params, p); }
  setQuality(q: Quality) { if (q !== this.quality) { this.allocate(q); this.buildPasses(); this.reset(); } }
  getQuality() { return this.quality; }

  // シュワシュワ。progress 0〜1（縁 → 中心）、amount は強さ
  fizz(progress: number, amount = 1) { this.fizzProgress = progress; this.fizzAmount = amount; }

  // uv は色場の座標（0〜1）。force は texel/秒 相当、radius は正規化
  // 厚みには、軌跡の中心に溝（−）、両脇に盛り上がり（+）。深さは指の速さに比例
  splat(uv: [number, number], force: [number, number], radius = 0.002) {
    this.pendingSplats.push({ uv, force, radius });
    const f = Math.hypot(force[0], force[1]);
    if (f > 1e-3) this.stamp({ x: uv[0], y: uv[1], r: radius, amount: Math.min(0.12, f * 0.0012), dx: force[0] / f, dy: force[1] / f, kind: 1, ring: 0 });
  }
  // タップ：その点から外へ広がる力（8 方向）。strength は texel/秒 相当
  burst(uv: [number, number], strength = 60, radius = 0.003) {
    const aspect = this.sizes.dye[0] / this.sizes.dye[1];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const off = 0.012;
      this.pendingSplats.push({ uv: [uv[0] + Math.cos(a) * off / aspect, uv[1] + Math.sin(a) * off], force: [Math.cos(a) * strength, Math.sin(a) * strength], radius });
    }
    // 厚み：中心が凹み、輪が盛り上がる
    this.stamp({ x: uv[0], y: uv[1], r: radius * 1.5, amount: Math.min(0.35, strength * 0.004), dx: 0, dy: 0, kind: 2, ring: Math.sqrt(radius) * 1.6 });
  }

  // 渦：uv を中心に、中心へ向かう回転 + わずかな吸い込み。strength は 0〜1 程度（VORTEX_RATE を参照）。
  // radius は領域の高さに対する割合（ガウシアンの幅）。毎フレーム呼ぶ前提。厚みは中心が凹む
  vortex(uv: [number, number], strength: number, radius: number) {
    if (strength <= 0 || radius <= 0) return;
    this.pendingVortex.push({ uv, strength, radius });
  }

  private stamp(s: Fluid['stamps'][number]) {
    if (this.stamps.length < S.MAX_STAMPS) this.stamps.push(s);
  }

  // 絵の矩形内の座標（0〜1）→ 色場の UV
  rectToUv(px: number, py: number): [number, number] { return [this.placement.x + px * this.placement.w, this.placement.y + py * this.placement.h]; }

  step(dt: number) {
    dt = Math.min(dt, 1 / 30);
    if (dt <= 0) return;
    this.time += dt;
    const sz = this.sizes;
    const simTexel = new THREE.Vector2(1 / sz.sim[0], 1 / sz.sim[1]);
    const dyeTexel = new THREE.Vector2(1 / sz.dye[0], 1 / sz.dye[1]);
    // 速度の単位：領域の高さに対する割合/秒 → texel/秒 は sim の高さ倍
    const speed = this.params.speed * this.strength;
    const velDt = dt * speed * sz.sim[1] * 0.22;     // 0.22 は手触りの係数（速すぎる、との感想で 0.35 から下げた）
    const dyeDt = dt * speed * sz.dye[1] * 0.22;
    const P = this.passes;

    // 常時の駆動（流れ続ける）。強さは strength に比例。texel/秒 の単位に合わせる
    const drive = this.params.drive ?? 0.3;
    if (drive > 0 && this.strength > 0.001) {
      P.drive.mat.uniforms.uVelocity.value = this.vel.read.texture;
      P.drive.mat.uniforms.uRate.value = Math.min(1, drive * dt * 1.5);          // 1 秒で目標の約 45%（drive=0.3）
      // 速さのむら（docs/EXPERIENCE.md 8.1）。tempo 0 で均一（b = 1、場所の係数も 1）
      const tempo = Math.max(0, Math.min(1, this.params.tempo ?? 0.6));
      const b = breathing(this.time, tempo);
      P.drive.mat.uniforms.uTarget.value = sz.sim[1] * 0.03 * this.strength * b;     // 目標の速さ（sim の高さの 3%/秒）× 呼吸
      P.drive.mat.uniforms.uTime.value = this.time;
      P.drive.mat.uniforms.uTempo.value = tempo;
      this.run(P.drive, this.vel.write); this.vel.swap();
    }
    // 外力
    if (this.fizzProgress >= 0) {
      P.fizz.mat.uniforms.uVelocity.value = this.vel.read.texture;
      P.fizz.mat.uniforms.uProgress.value = this.fizzProgress;
      P.fizz.mat.uniforms.uAmount.value = this.fizzAmount * 1.6 * dt * 60;
      P.fizz.mat.uniforms.uTime.value = this.time;
      this.run(P.fizz, this.vel.write); this.vel.swap();
    }
    for (const s of this.pendingSplats) {
      P.splat.mat.uniforms.uTarget.value = this.vel.read.texture;
      P.splat.mat.uniforms.uPoint.value.set(s.uv[0], s.uv[1]);
      P.splat.mat.uniforms.uValue.value.set(s.force[0], s.force[1], 0);
      P.splat.mat.uniforms.uRadius.value = s.radius;
      this.run(P.splat, this.vel.write); this.vel.swap();
    }
    this.pendingSplats.length = 0;
    const V = P.vortex.mat.uniforms;
    for (const v of this.pendingVortex) {
      V.uVelocity.value = this.vel.read.texture;
      V.uPoint.value.set(v.uv[0], v.uv[1]);
      V.uRadius.value = v.radius;
      // 速度の単位（texel 換算）→ 見た目の速さ：0.22 × speed × strength（上の velDt と同じ換算）
      V.uStrength.value = (v.strength * VORTEX_RATE * dt) / (0.22 * Math.max(0.05, this.params.speed));
      this.run(P.vortex, this.vel.write); this.vel.swap();
      this.stamp({ x: v.uv[0], y: v.uv[1], r: (v.radius * 0.6) ** 2, amount: Math.min(0.05, v.strength * dt * 0.8), dx: 0, dy: 0, kind: 0, ring: 0 });
    }
    this.pendingVortex.length = 0;

    // 渦度の補強
    P.curl.mat.uniforms.uVelocity.value = this.vel.read.texture; P.curl.mat.uniforms.uTexel.value = simTexel;
    this.run(P.curl, this.curl);
    P.vorticity.mat.uniforms.uVelocity.value = this.vel.read.texture; P.vorticity.mat.uniforms.uCurl.value = this.curl.texture;
    P.vorticity.mat.uniforms.uTexel.value = simTexel; P.vorticity.mat.uniforms.uCurlStrength.value = this.params.vorticity * 6; P.vorticity.mat.uniforms.uDt.value = dt;
    this.run(P.vorticity, this.vel.write); this.vel.swap();

    // 圧力
    P.divergence.mat.uniforms.uVelocity.value = this.vel.read.texture; P.divergence.mat.uniforms.uTexel.value = simTexel;
    this.run(P.divergence, this.div);
    P.pressure.mat.uniforms.uDivergence.value = this.div.texture; P.pressure.mat.uniforms.uTexel.value = simTexel;
    for (let i = 0; i < this.iters; i++) {
      P.pressure.mat.uniforms.uPressure.value = this.pressure.read.texture;
      this.run(P.pressure, this.pressure.write); this.pressure.swap();
    }
    P.gradient.mat.uniforms.uPressure.value = this.pressure.read.texture; P.gradient.mat.uniforms.uVelocity.value = this.vel.read.texture; P.gradient.mat.uniforms.uTexel.value = simTexel;
    this.run(P.gradient, this.vel.write); this.vel.swap();

    // 速度の移流（減衰はごく弱く：止まらないが暴れない）
    P.advect.mat.uniforms.uVelocity.value = this.vel.read.texture; P.advect.mat.uniforms.uSource.value = this.vel.read.texture;
    P.advect.mat.uniforms.uTexel.value = simTexel; P.advect.mat.uniforms.uDt.value = velDt; P.advect.mat.uniforms.uDissipation.value = 0.08 * dt;
    this.run(P.advect, this.vel.write); this.vel.swap();

    // 色の移流（MacCormack）：前進 → 後退 → 補正 + 原画への回帰
    P.advect.mat.uniforms.uVelocity.value = this.vel.read.texture; P.advect.mat.uniforms.uTexel.value = dyeTexel; P.advect.mat.uniforms.uDissipation.value = 0;
    P.advect.mat.uniforms.uSource.value = this.dye.read.texture; P.advect.mat.uniforms.uDt.value = dyeDt;
    this.run(P.advect, this.tmp1);
    P.advect.mat.uniforms.uSource.value = this.tmp1.texture; P.advect.mat.uniforms.uDt.value = -dyeDt;
    this.run(P.advect, this.tmp2);
    const M = P.maccormack.mat.uniforms;
    M.uVelocity.value = this.vel.read.texture; M.uPhi0.value = this.dye.read.texture; M.uPhiHat1.value = this.tmp1.texture; M.uPhiHat0.value = this.tmp2.texture;
    M.uOriginal.value = this.original.texture; M.uTexel.value = dyeTexel; M.uDt.value = dyeDt; M.uRestore.value = this.params.restore * dt * 60;
    this.run(P.maccormack, this.dye.write); this.dye.swap();

    // 厚みの移流（MacCormack、色と同じ）+ 増減・跡・泡・回帰を 1 パスに
    const td = this.thickDims;
    const thickTexel = new THREE.Vector2(1 / td[0], 1 / td[1]);
    const thickDt = dt * speed * td[1] * 0.22;
    P.advect.mat.uniforms.uTexel.value = thickTexel;
    P.advect.mat.uniforms.uSource.value = this.thick.read.texture; P.advect.mat.uniforms.uDt.value = thickDt;
    this.run(P.advect, this.thickTmp1);
    P.advect.mat.uniforms.uSource.value = this.thickTmp1.texture; P.advect.mat.uniforms.uDt.value = -thickDt;
    this.run(P.advect, this.thickTmp2);
    const T = P.thick.mat.uniforms;
    T.uVelocity.value = this.vel.read.texture; T.uPhi0.value = this.thick.read.texture; T.uPhiHat1.value = this.thickTmp1.texture; T.uPhiHat0.value = this.thickTmp2.texture;
    T.uOriginal.value = this.thickOriginal.texture; T.uDiv.value = this.div.texture; T.uTexel.value = thickTexel; T.uDt.value = thickDt;
    T.uRestore.value = this.params.restore * dt * 60; T.uDivK.value = 0.5 * dt;
    T.uFizzProgress.value = this.fizzProgress; T.uFizzAmount.value = this.fizzAmount * 0.04 * dt * 60; T.uTime.value = this.time;
    T.uStampCount.value = this.stamps.length;
    this.stamps.forEach((st, i) => { (T.uStamp.value as THREE.Vector4[])[i].set(st.x, st.y, st.r, st.amount); (T.uStampDir.value as THREE.Vector4[])[i].set(st.dx, st.dy, st.kind, st.ring); });
    this.run(P.thick, this.thick.write); this.thick.swap();
    this.stamps.length = 0;
    this.fizzProgress = -1;
  }

  // 色場の矩形を別の RenderTarget や画面に描く（表示用）
  blit(view: PaintingRect, target: THREE.WebGLRenderTarget | null) {
    this.passes.copy.mat.uniforms.uDye.value = this.dye.read.texture;
    this.passes.copy.mat.uniforms.uView.value.set(view.x, view.y, view.w, view.h);
    this.run(this.passes.copy, target);
  }

  dispose() {
    this.dye.dispose(); this.vel.dispose(); this.pressure.dispose();
    this.curl.dispose(); this.div.dispose(); this.tmp1.dispose(); this.tmp2.dispose(); this.original.dispose();
    this.disposeThick();
    for (const p of Object.values(this.passes)) p.mat.dispose();
  }
}
