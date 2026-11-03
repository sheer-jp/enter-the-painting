// GPU 流体シム。領域は 2:1 の等距離円筒。絵は前方の矩形に置き、残りは基調色。
// 色の移流は MacCormack + 原画への弱い回帰（数値拡散で構図が消えないように）。
import * as THREE from 'three';
import * as S from './shaders';

export type Quality = 'high' | 'medium' | 'low';
export interface FluidParams { vorticity: number; speed: number; quality: Quality; restore: number }
export interface PaintingRect { x: number; y: number; w: number; h: number }

const SIZES: Record<Quality, { dye: [number, number]; sim: [number, number]; iters: number }> = {
  high: { dye: [2048, 1024], sim: [512, 256], iters: 20 },
  medium: { dye: [1024, 512], sim: [256, 128], iters: 14 },
  low: { dye: [512, 256], sim: [128, 64], iters: 8 },
};

// 絵の矩形：高さは領域の 75%（緯度 ±67°）、幅は絵の比率から（等距離円筒は赤道で 1:1）
export function placementFor(aspect: number): PaintingRect {
  const h = 0.75;
  let w = (h * aspect) / 2;
  if (w > 0.45) w = 0.45;
  return { x: 0.5 - w / 2, y: 0.5 - h / 2, w, h };
}

class Pass {
  mat: THREE.ShaderMaterial;
  constructor(frag: string, uniforms: Record<string, THREE.IUniform>) {
    this.mat = new THREE.ShaderMaterial({ vertexShader: S.VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
  }
}

function makeRT(w: number, h: number, type: THREE.TextureDataType) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
  });
  return rt;
}

class Double {
  a: THREE.WebGLRenderTarget; b: THREE.WebGLRenderTarget;
  constructor(w: number, h: number, type: THREE.TextureDataType) { this.a = makeRT(w, h, type); this.b = makeRT(w, h, type); }
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
  private passes!: Record<string, Pass>;
  private params: FluidParams;
  private quality: Quality;
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
  get size(): [number, number] { return SIZES[this.quality].dye; }

  init(painting: THREE.Texture, flow: THREE.Texture, p: FluidParams, placement: PaintingRect, back: string, back2?: string) {
    this.params = { ...p };
    this.painting = painting; this.flow = flow; this.placement = placement;
    this.back.set(back); this.back2.set(back2 || back);
    painting.colorSpace = THREE.SRGBColorSpace;
    flow.colorSpace = THREE.NoColorSpace;
    this.allocate(p.quality);
    this.buildPasses();
    this.reset();
  }

  private allocate(q: Quality) {
    this.quality = q;
    const sz = SIZES[q];
    this.iters = sz.iters;
    const type = THREE.HalfFloatType;
    this.dye?.dispose(); this.vel?.dispose(); this.pressure?.dispose();
    this.curl?.dispose(); this.div?.dispose(); this.tmp1?.dispose(); this.tmp2?.dispose(); this.original?.dispose();
    this.dye = new Double(sz.dye[0], sz.dye[1], type);
    this.original = makeRT(sz.dye[0], sz.dye[1], type);
    this.tmp1 = makeRT(sz.dye[0], sz.dye[1], type);
    this.tmp2 = makeRT(sz.dye[0], sz.dye[1], type);
    this.vel = new Double(sz.sim[0], sz.sim[1], type);
    this.pressure = new Double(sz.sim[0], sz.sim[1], type);
    this.curl = makeRT(sz.sim[0], sz.sim[1], type);
    this.div = makeRT(sz.sim[0], sz.sim[1], type);
  }

  private buildPasses() {
    const u = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v }]));
    const rect = new THREE.Vector4(this.placement.x, this.placement.y, this.placement.w, this.placement.h);
    this.passes = {
      initDye: new Pass(S.INIT_DYE, u({ uPainting: this.painting, uRect: rect, uBack: this.back, uBack2: this.back2 })),
      initVel: new Pass(S.INIT_VEL, u({ uFlow: this.flow, uRect: rect, uStrength: 1 })),
      advect: new Pass(S.ADVECT, u({ uVelocity: null, uSource: null, uTexel: new THREE.Vector2(), uDt: 0, uDissipation: 0 })),
      maccormack: new Pass(S.MACCORMACK, u({ uVelocity: null, uPhi0: null, uPhiHat1: null, uPhiHat0: null, uOriginal: null, uTexel: new THREE.Vector2(), uDt: 0, uRestore: 0 })),
      curl: new Pass(S.CURL, u({ uVelocity: null, uTexel: new THREE.Vector2() })),
      vorticity: new Pass(S.VORTICITY, u({ uVelocity: null, uCurl: null, uTexel: new THREE.Vector2(), uCurlStrength: 0, uDt: 0 })),
      divergence: new Pass(S.DIVERGENCE, u({ uVelocity: null, uTexel: new THREE.Vector2() })),
      pressure: new Pass(S.PRESSURE, u({ uPressure: null, uDivergence: null, uTexel: new THREE.Vector2() })),
      gradient: new Pass(S.GRADIENT_SUBTRACT, u({ uPressure: null, uVelocity: null, uTexel: new THREE.Vector2() })),
      splat: new Pass(S.SPLAT, u({ uTarget: null, uPoint: new THREE.Vector2(), uValue: new THREE.Vector3(), uRadius: 0.001, uAspect: 2 })),
      fizz: new Pass(S.FIZZ, u({ uVelocity: null, uRect: rect, uProgress: 0, uAmount: 0, uTime: 0 })),
      copy: new Pass(S.DISPLAY, u({ uDye: null, uView: new THREE.Vector4(0, 0, 1, 1) })),
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
  splat(uv: [number, number], force: [number, number], radius = 0.002) { this.pendingSplats.push({ uv, force, radius }); }

  // 絵の矩形内の座標（0〜1）→ 色場の UV
  rectToUv(px: number, py: number): [number, number] { return [this.placement.x + px * this.placement.w, this.placement.y + py * this.placement.h]; }

  step(dt: number) {
    dt = Math.min(dt, 1 / 30);
    if (dt <= 0) return;
    this.time += dt;
    const sz = SIZES[this.quality];
    const simTexel = new THREE.Vector2(1 / sz.sim[0], 1 / sz.sim[1]);
    const dyeTexel = new THREE.Vector2(1 / sz.dye[0], 1 / sz.dye[1]);
    // 速度の単位：領域の高さに対する割合/秒 → texel/秒 は sim の高さ倍
    const speed = this.params.speed * this.strength;
    const velDt = dt * speed * sz.sim[1] * 0.35;     // 0.35 は手触りの係数
    const dyeDt = dt * speed * sz.dye[1] * 0.35;
    const P = this.passes;

    // 外力
    if (this.fizzProgress >= 0) {
      P.fizz.mat.uniforms.uVelocity.value = this.vel.read.texture;
      P.fizz.mat.uniforms.uProgress.value = this.fizzProgress;
      P.fizz.mat.uniforms.uAmount.value = this.fizzAmount * 1.6 * dt * 60;
      P.fizz.mat.uniforms.uTime.value = this.time;
      this.run(P.fizz, this.vel.write); this.vel.swap();
      this.fizzProgress = -1;
    }
    for (const s of this.pendingSplats) {
      P.splat.mat.uniforms.uTarget.value = this.vel.read.texture;
      P.splat.mat.uniforms.uPoint.value.set(s.uv[0], s.uv[1]);
      P.splat.mat.uniforms.uValue.value.set(s.force[0], s.force[1], 0);
      P.splat.mat.uniforms.uRadius.value = s.radius;
      this.run(P.splat, this.vel.write); this.vel.swap();
    }
    this.pendingSplats.length = 0;

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
    P.advect.mat.uniforms.uTexel.value = simTexel; P.advect.mat.uniforms.uDt.value = velDt; P.advect.mat.uniforms.uDissipation.value = 0.15 * dt;
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
    for (const p of Object.values(this.passes)) p.mat.dispose();
  }
}
