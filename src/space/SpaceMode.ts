// VR 空間モード（Quest のブラウザ、WebXR）：S1 接近 → S2 溶ける → S3 包まれる → S4 漂う → S5 戻る
import * as THREE from 'three';
import type { StoryCtx } from '../story/StoryMode';
import { touchStroke, touchVortex, tapStrength, TOUCH_TAP_MAX, type Fluid } from '../fluid/Fluid';
import { SHADING, LIGHT_DIR, lookOf, shadingUniforms, updateShading } from '../fluid/shading';
import { SpaceText } from '../text/FloatingText';
import { pick } from '../i18n';
import { Particles } from './Particles';
import { Surround } from './Surround';
import { particleVisibility, surroundVisibility, hideRoom, floorRadius, lightWorld, particlePos, particlesInView, whiteRatio, centerPeriphery, particleCount, type DepthQuality } from './depth';

type Ctx = StoryCtx & { renderer: THREE.WebGLRenderer; fluid: Fluid };

// 絵の層のシェーダー（2 つのメッシュで共用。docs/VR_DEPTH.md 6 節、V-6）
// - 球面（uLayer 1）：UV は色場全体（等距離円筒）。S2 の始めから半径 uRadius の球面に置き、uAppear で流体のように現れる。
//   uMorph は S5（戻る）だけで 1 → 0 に動かす（球面 → 壁の平面）。S2・S3 では膨らませない（空洞が開くように見えるため）
// - 壁の平面（uLayer 0）：UV は絵の矩形だけ。S1 の絵。S2 で画面いっぱいに拡大しながら、球面と同じ模様で消える
const MORPH_VERT = /* glsl */ `
uniform float uMorph;        // 0〜1（イージング済み）。S5 だけ動く
uniform float uLayer;        // 0 = 壁の平面、1 = 球面
uniform vec4 uRect;          // 色場の中の絵の矩形
uniform vec3 uHead;          // 球の中心（世界座標）
uniform float uRadius;
uniform vec3 uPlaneCenter;   // 絵の中心（世界座標）
uniform vec3 uPlaneRight;    // 絵の右方向 × 絵の幅（m）
uniform vec3 uPlaneUp;       // 絵の上方向 × 絵の高さ（m）
varying vec2 vUv;
varying float vInside;
// 質感のための接空間（ビュー空間）：T = u の向き、B = v の向き、N = 見る人の側
varying vec3 vT; varying vec3 vB; varying vec3 vN; varying vec3 vViewPos;
varying vec3 vWorld;
const float PI = 3.141592653589793;
void main() {
  vUv = uv;
  // 絵の矩形内の座標（0〜1）。外側は矩形を延長
  vec2 p = (uv - uRect.xy) / uRect.zw;
  vInside = uLayer < 0.5 ? 1.0 : ((p.x >= 0.0 && p.x <= 1.0 && p.y >= 0.0 && p.y <= 1.0) ? 1.0 : 0.0);
  vec3 planePos = uPlaneCenter + uPlaneRight * (p.x - 0.5) + uPlaneUp * (p.y - 0.5);
  float lon = (uv.x - 0.5) * 2.0 * PI;
  float lat = (uv.y - 0.5) * PI;
  vec3 dir = vec3(sin(lon) * cos(lat), sin(lat), -cos(lon) * cos(lat));
  vec3 spherePos = uHead + dir * uRadius;
  vec3 pos = mix(planePos, spherePos, uMorph);
  vWorld = pos;
  // 接空間：平面は絵の右・上・手前、球面は経度・緯度の向きと中心の側
  vec3 tP = normalize(uPlaneRight), bP = normalize(uPlaneUp), nP = normalize(cross(tP, bP));
  vec3 tS = vec3(cos(lon), 0.0, sin(lon)), bS = vec3(-sin(lon) * sin(lat), cos(lat), cos(lon) * sin(lat)), nS = -dir;
  mat3 vm = mat3(viewMatrix);
  vT = vm * normalize(mix(tP, tS, uMorph)); vB = vm * normalize(mix(bP, bS, uMorph)); vN = vm * normalize(mix(nP, nS, uMorph));
  vec4 vp = viewMatrix * vec4(pos, 1.0);
  vViewPos = vp.xyz;
  gl_Position = projectionMatrix * vp;
}
`;
const MORPH_FRAG = /* glsl */ `
uniform float uMorph;
uniform float uFade;
uniform vec3 uLightView;     // 光の向き（ビュー空間で一定 = 頭の向きに対して固定。頭を振ると光沢が走る）
uniform vec3 uPointLight;    // 世界空間の光の点（VR_DEPTH.md 2 節。頭上やや前）。uPointLightOn = 1 のときこちらを使う
uniform float uPointLightOn;
uniform float uEdgeAlpha;    // 球面になったとき、絵の矩形の外側のアルファ（奥の光が透ける。0.85）
uniform float uLayer;        // 0 = 壁の平面、1 = 球面
uniform float uAppear;       // S2：球面が現れる度合い 0〜1。平面は同じ模様の裏返しで消える（色が平面から球面へ移る）
uniform float uEdge;         // S3：矩形の外側が uEdgeAlpha へ透ける度合い 0〜1
varying vec2 vUv;
varying float vInside;
varying vec3 vT; varying vec3 vB; varying vec3 vN; varying vec3 vViewPos;
varying vec3 vWorld;
uniform vec3 uHead;
${SHADING}
// 流体のフェードの模様：ゆっくり流れる値ノイズ（2 オクターブ、0〜1）。中心からの同心円にならないよう、方向に依らない斑
float meltHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float meltNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(meltHash(i), meltHash(i + vec2(1.0, 0.0)), f.x), mix(meltHash(i + vec2(0.0, 1.0)), meltHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float a = vInside > 0.5 ? 1.0 : smoothstep(0.0, 0.35, uMorph);
  // 流体のフェード：斑の低いところから先に球面が現れ、同じところの平面が消える。
  // 斑は頭から見た向き（経度・緯度）で決める：平面と球面で同じ向きの画素が同じ値になり、穴が開かない。球面は少し先に現れる
  vec3 dd = normalize(vWorld - uHead);
  vec2 q = vec2(atan(dd.x, -dd.z) / 6.2831853 + 0.5, asin(clamp(dd.y, -1.0, 1.0)) / 3.1415927 + 0.5) * vec2(28.0, 14.0) + vec2(uTime * 0.15, -uTime * 0.1);
  float n = 0.65 * meltNoise(q) + 0.35 * meltNoise(q * 2.3 + 7.1);
  float x = uAppear * 1.45 - 0.3;
  a *= uLayer > 0.5 ? smoothstep(n - 0.15, n + 0.15, x + 0.15) : 1.0 - smoothstep(n - 0.15, n + 0.15, x);
  if (a < 0.01) discard;
  vec3 T = normalize(vT), B = normalize(vB), N = normalize(vN);
  vec3 V = normalize(-vViewPos);
  // 光：世界空間の 1 点（頭を動かすと光沢が面の起伏に沿って移る）。目ごとの viewMatrix でビュー空間へ
  vec3 Lv = uPointLightOn > 0.5 ? normalize((viewMatrix * vec4(uPointLight, 1.0)).xyz - vViewPos) : uLightView;
  vec3 Lt = vec3(dot(Lv, T), dot(Lv, B), dot(Lv, N));
  vec3 Vt = vec3(dot(V, T), dot(V, B), dot(V, N));
  if (Vt.z < 0.0) { Lt.z = -Lt.z; Vt.z = -Vt.z; }   // 裏から見たとき
  vec3 c = paintShade(vUv, normalize(Lt), normalize(Vt));
  // 絵の矩形の中は不透明のまま、外側だけ球面になるにつれて uEdgeAlpha へ
  gl_FragColor = vec4(c * uFade, a * mix(1.0, uEdgeAlpha, uEdge * uMorph * (1.0 - vInside)));
  #include <colorspace_fragment>
}
`;

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
// S2：球面が流体のフェードで現れる秒数（docs/VR_DEPTH.md 6 節）
const APPEAR_SEC = 1.5;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class SpaceMode {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(70, 1, 0.05, 60);
  private rig = new THREE.Group();
  private morphMesh!: THREE.Mesh;                 // 球面の絵の層（S2〜S5。S5 だけ平面へ縮む）
  private morphMat!: THREE.ShaderMaterial;
  private planeMesh!: THREE.Mesh;                 // 壁の平面の絵（S1〜S2）
  private planeMat!: THREE.ShaderMaterial;
  private appear = 0;                             // S2：球面が現れる度合い 0〜1
  private vignette!: THREE.Mesh;
  private text!: SpaceText;
  private stage = 'S0';
  private running = true;
  private strength = 0.05;
  private morph = 0;                              // 包まれる度合い：S3 で 0 → 1、S4 は 1、S5 で 1 → 0（粒・床・奥の光・部屋・触れる、S5 の縮み）
  private resolveEnd: ((v: 'exit' | 'fallback') => void) | null = null;
  private wallZ = -3;
  private eyeY = 1.5;
  private paintingCenter = new THREE.Vector3(0, 1.5, -3);
  private paintingW = 0.4; private paintingH = 0.5;
  private selectPressed = false;
  private holding: boolean[] = [false, false];
  private lastPointUv: (THREE.Vector2 | null)[] = [null, null];
  // 触れる強さと長さ（docs/EXPERIENCE.md 8.2）。コントローラごと
  private sources: (XRInputSource | null)[] = [null, null];
  private trigger = [0, 0];                       // トリガーのアナログ値 0〜1（毎フレーム）
  private touches: ({ start: number; startUv: THREE.Vector2 | null; hold: number; stillHold: number; maxMove: number; lastPulse: number } | null)[] = [null, null];
  private bHoldStart = 0;
  private lastGaze = new THREE.Vector2(0.5, 0.5);
  private hasGaze = false;
  private tmpV = new THREE.Vector3();
  private fps: number[] = [];
  private lastT = 0;
  private look = lookOf();
  private t0 = performance.now();
  // 立体感の層（VR_DEPTH.md）
  private particles!: Particles;
  private surround!: Surround;
  private roomMeshes: THREE.Mesh[] = [];
  private head = new THREE.Vector3(0, 1.5, 0);   // 球の中心（S3 で決まる）
  private lightPoint = new THREE.Vector3();
  private appearAt = -1;                          // 粒が現れ始めた時刻（ms）
  private reliefInShading = false;                // shading.ts に uReliefScale の受け口があるか

  // flat = 検査モード（?space=flat）：WebXR を使わず平面のカメラで回す（docs/VR_DEPTH.md 5 節、V-4）
  constructor(private ctx: Ctx, private session: XRSession | null, private flat = false) {}

  private build() {
    const { space, fluid, renderer } = this.ctx;
    const look = lookOf(space.fluid.look);
    // VR では厚みの効きを 1.3 倍（VR_DEPTH.md 2 節）。shading.ts に uReliefScale があればそちらで、無ければ look を 1.3 倍にして渡す
    this.reliefInShading = 'uReliefScale' in shadingUniforms(fluid, look);
    this.look = this.reliefInShading ? look : { ...look, relief: look.relief * 1.3 };
    this.paintingW = space.size_cm[0] / 100; this.paintingH = space.size_cm[1] / 100;
    this.paintingCenter.set(0, this.eyeY, this.wallZ);
    this.scene.background = new THREE.Color(space.back_color).multiplyScalar(0.25);
    // 薄暗い部屋：床の淡い円と、壁
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(space.back_color).multiplyScalar(0.5) }));
    floor.rotation.x = -Math.PI / 2; this.scene.add(floor); this.roomMeshes.push(floor);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(8, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(space.back_color).multiplyScalar(0.7) }));
    wall.position.set(0, 2, this.wallZ - 0.01); this.scene.add(wall); this.roomMeshes.push(wall);
    // 絵（流体の色場）：球面と壁の平面の 2 枚。質感の uniform は同じ実体を共有する（毎フレームの更新は 1 回）
    const rect = fluid.placement;
    const shared: Record<string, THREE.IUniform> = {
      uRect: { value: new THREE.Vector4(rect.x, rect.y, rect.w, rect.h) },
      uHead: { value: new THREE.Vector3(0, this.eyeY, 0) }, uRadius: { value: space.space.radius_m },
      // S5 で球面が縮んで戻る先（壁の絵の実寸）。平面の拡大とは別の実体
      uPlaneCenter: { value: this.paintingCenter.clone() }, uPlaneRight: { value: new THREE.Vector3(this.paintingW, 0, 0) }, uPlaneUp: { value: new THREE.Vector3(0, this.paintingH, 0) },
      ...shadingUniforms(fluid, this.look), uFade: { value: 1 }, uLightView: { value: LIGHT_DIR.clone() },
      uPointLight: { value: this.lightPoint }, uPointLightOn: { value: 1 }, uEdgeAlpha: { value: 0.85 }, uAppear: { value: 0 },
    };
    // 球面：S1 では出さない（ドローコールを増やさない）
    this.morphMat = new THREE.ShaderMaterial({
      vertexShader: MORPH_VERT, fragmentShader: MORPH_FRAG, transparent: true, side: THREE.DoubleSide, depthWrite: false,
      uniforms: { ...shared, uMorph: { value: 1 }, uLayer: { value: 1 }, uEdge: { value: 0 } },
    });
    this.setShadingInputs();
    this.morphMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 192, 96), this.morphMat);
    this.morphMesh.frustumCulled = false; this.morphMesh.visible = false; this.morphMesh.renderOrder = 0;
    this.scene.add(this.morphMesh);
    // 壁の平面：4 頂点、UV は絵の矩形だけ。S2 が終われば出さない
    const pg = new THREE.PlaneGeometry(1, 1, 1, 1);
    const uvA = pg.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uvA.count; i++) uvA.setXY(i, rect.x + uvA.getX(i) * rect.w, rect.y + uvA.getY(i) * rect.h);
    this.planeMat = new THREE.ShaderMaterial({
      vertexShader: MORPH_VERT, fragmentShader: MORPH_FRAG, transparent: true, side: THREE.DoubleSide, depthWrite: false,
      uniforms: {
        ...shared, uMorph: { value: 0 }, uLayer: { value: 0 }, uEdge: { value: 0 },
        uPlaneCenter: { value: this.paintingCenter.clone() }, uPlaneRight: { value: new THREE.Vector3(this.paintingW, 0, 0) }, uPlaneUp: { value: new THREE.Vector3(0, this.paintingH, 0) },
      },
    });
    this.planeMesh = new THREE.Mesh(pg, this.planeMat);
    this.planeMesh.frustumCulled = false; this.planeMesh.renderOrder = 1;   // 球面より手前に重ねる（S2）
    this.scene.add(this.planeMesh);
    // 立体感の層：手前の粒、床、奥の光
    this.updateLight(this.head.set(0, this.eyeY, 0));
    this.particles = new Particles(space.palette, this.lightPoint, space.space.radius_m, hashId(space.id));
    this.scene.add(this.particles.mesh);
    const blur = new THREE.TextureLoader().load(this.ctx.base + 'generated/' + (space.painting_blur || space.painting));
    this.surround = new Surround(blur);
    this.scene.add(this.surround.floor, this.surround.back);
    // 視点のリグ（接近で動かすのはこれ）
    this.rig.add(this.camera);
    this.scene.add(this.rig);
    // ビネット（接近のときだけ）
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d')!; const grad = g.createRadialGradient(128, 128, 60, 128, 128, 128);
    grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,1)'); g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
    const vt = new THREE.CanvasTexture(c);
    this.vignette = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshBasicMaterial({ map: vt, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
    this.vignette.position.z = -0.4; this.vignette.renderOrder = 20; this.camera.add(this.vignette);
    // 文字
    this.text = new SpaceText(space.text_color, this.ctx.lang);
    this.scene.add(this.text.mesh);
    // コントローラ
    for (let i = 0; i < 2; i++) {
      const ctrl = renderer.xr.getController(i);
      // connected の data が、このコントローラの入力元（トリガーと振動はここの gamepad から）
      ctrl.addEventListener('connected', (e) => { this.sources[i] = (e as unknown as { data: XRInputSource }).data ?? null; });
      ctrl.addEventListener('disconnected', () => { this.sources[i] = null; this.trigger[i] = 0; });
      ctrl.addEventListener('selectstart', () => {
        this.selectPressed = true; this.holding[i] = true;
        this.touches[i] = { start: performance.now(), startUv: null, hold: 0, stillHold: 0, maxMove: 0, lastPulse: 0 };
      });
      ctrl.addEventListener('selectend', () => {
        this.holding[i] = false; this.lastPointUv[i] = null;
        // タップ：短く引いて、ほとんど動かさない。引いていた時間で波紋が強くなる
        const t = this.touches[i]; this.touches[i] = null;
        if (t && t.startUv && this.vrTouchable()) {
          const sec = (performance.now() - t.start) / 1000;
          if (sec < TOUCH_TAP_MAX && t.maxMove < 0.01) this.ctx.fluid.burst([t.startUv.x, t.startUv.y], tapStrength(sec), 0.003);
        }
      });
      this.rig.add(ctrl);
    }
    if (this.flat) {
      // 検査モード：目の高さに置き、立方体の 1 面が収まる画角
      this.camera.position.y = this.eyeY;
      this.camera.fov = 90;
      const c = renderer.domElement; this.camera.aspect = c.width / Math.max(1, c.height); this.camera.updateProjectionMatrix();
    } else {
      renderer.xr.enabled = true;
      renderer.xr.setReferenceSpaceType('local-floor');
    }
  }

  // 世界空間の光の点：頭の位置 + (0, 0.8R, −0.3R)
  private updateLight(head: THREE.Vector3) {
    const p = lightWorld([head.x, head.y, head.z], this.ctx.space.space.radius_m);
    this.lightPoint.set(p[0], p[1], p[2]);
    this.setShadingInputs();
  }

  // shading.ts の受け口（別の人が足している）。uniforms に無いあいだは渡さない
  private setShadingInputs() {
    const u = this.morphMat?.uniforms; if (!u) return;
    if ('uLightMode' in u) u.uLightMode.value = 1;
    if ('uLightWorld' in u) { const v = u.uLightWorld.value; if (v instanceof THREE.Vector3) v.copy(this.lightPoint); else u.uLightWorld.value = this.lightPoint.clone(); }
    if ('uReliefScale' in u) u.uReliefScale.value = 1.3;
  }

  // 立体感の層の毎フレームの更新
  private updateDepth(now: number) {
    const time = (now - this.t0) / 1000;
    const pv = particleVisibility(this.stage, this.morph, this.appearAt < 0 ? 0 : (now - this.appearAt) / 1000);
    if (this.appearAt < 0 && (this.stage === 'S4' || (this.stage === 'S3' && this.morph >= 0.5))) this.appearAt = now;
    this.particles.update(time, this.head, this.ctx.fluid.getQuality() as DepthQuality, pv.alpha, pv.toLayer, this.ctx.fluid);
    this.surround.update(time, surroundVisibility(this.stage, this.morph));
    // 壁の部屋：S2 の間は残し（球面は深度を見ずに上から重ねる）、S3・S4 は隠す。S5 は球面が縮むにつれて戻る
    const hide = this.stage === 'S3' || this.stage === 'S4' ? true : this.stage === 'S5' ? hideRoom(this.morph) : false;
    for (const m of this.roomMeshes) m.visible = !hide;
  }

  // 視線が絵に乗っているか（画面中央 ±10°）
  private gazeOnPainting(): boolean {
    this.camera.getWorldDirection(this.tmpV);
    const head = this.camera.getWorldPosition(new THREE.Vector3());
    const to = this.paintingCenter.clone().sub(head).normalize();
    return this.tmpV.dot(to) > Math.cos((10 * Math.PI) / 180);
  }

  // 視線の方向 → 色場の UV（球面の向き）
  private gazeUv(): THREE.Vector2 {
    this.camera.getWorldDirection(this.tmpV);
    const d = this.tmpV;
    const lon = Math.atan2(d.x, -d.z), lat = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
    return new THREE.Vector2(lon / (2 * Math.PI) + 0.5, lat / Math.PI + 0.5);
  }

  private pollButtons(): { bHeld: number } {
    const s = this.ctx.renderer.xr.getSession();
    let bHeld = 0;
    if (s) for (const src of s.inputSources) {
      const gp = src.gamepad; if (!gp) continue;
      // xr-standard：buttons[5] が B / Y
      if (gp.buttons[5]?.pressed) bHeld = 1;
    }
    return { bHeld };
  }

  // トリガーのアナログ値（コントローラの番号ごと、毎フレーム）。値が来ない端末は押している間 1
  private pollTrigger() {
    for (let i = 0; i < 2; i++) {
      const gp = this.sources[i]?.gamepad;
      this.trigger[i] = gp?.buttons[0]?.value ?? (this.holding[i] ? 1 : 0);
    }
  }

  // 触れられる場面：S3 の後半（球面になってから）と S4。S5 は不可
  private vrTouchable() { return this.stage === 'S4' || (this.stage === 'S3' && this.morph >= 0.5); }

  // 手応え：触れている間 50ms ごと。強さ = 0.1 + 0.5p、渦が育っている間 +0.2。振動が無い端末では何もしない
  private pulse(i: number, p: number, growing: boolean, now: number) {
    const t = this.touches[i]; if (!t || now - t.lastPulse < 50) return;
    t.lastPulse = now;
    const gp = this.sources[i]?.gamepad as (Gamepad & { hapticActuators?: { pulse(v: number, ms: number): Promise<boolean> }[] }) | undefined;
    try { gp?.hapticActuators?.[0]?.pulse(Math.min(1, 0.1 + 0.5 * p + (growing ? 0.2 : 0)), 30)?.catch?.(() => {}); } catch { /* 無ければ何もしない */ }
  }

  private onFrame = () => {
    if (!this.running) return;
    const now = performance.now(); const dt = Math.min(0.05, (now - (this.lastT || now)) / 1000); this.lastT = now;
    this.fps.push(1 / Math.max(1e-3, dt)); if (this.fps.length > 120) this.fps.shift();
    const { fluid, renderer } = this.ctx;
    // 視線が絵に乗ると、S1 の流れがわずかに強まる
    let strength = this.strength;
    if (this.stage === 'S1' && this.gazeOnPainting()) strength = Math.max(strength, 0.15);
    fluid.setStrength(strength);
    // S3 の後半と S4：トリガーを引きながら指すと、そこの流れが手についてくる（触れる）。
    // 強く握るほど太く強く、長く握るほど筆が沈み、止めたまま握ると渦が育つ（8.2）。カメラは動かさない。力は手元の局所だけ
    this.pollTrigger();
    if (this.vrTouchable()) {
      for (let i = 0; i < 2; i++) {
        const t = this.touches[i];
        if (!this.holding[i] || !t) continue;
        const p = Math.max(0.3, this.trigger[i]);       // 軽く引いても少しは効く
        t.hold += dt * p;                                // 強く握るほど速く沈む・育つ
        const ctrl = renderer.xr.getController(i);
        ctrl.getWorldDirection(this.tmpV); this.tmpV.multiplyScalar(-1);   // コントローラは -Z が前
        const d = this.tmpV;
        const lon = Math.atan2(d.x, -d.z), lat = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
        const uv = new THREE.Vector2(lon / (2 * Math.PI) + 0.5, lat / Math.PI + 0.5);
        if (!t.startUv) t.startUv = uv.clone();
        else { let mx = Math.abs(uv.x - t.startUv.x); mx = Math.min(mx, 1 - mx); t.maxMove = Math.max(t.maxMove, Math.hypot(mx, uv.y - t.startUv.y)); }
        const prev = this.lastPointUv[i];
        let growing = false;
        if (prev) {
          let dx = uv.x - prev.x; if (dx > 0.5) dx -= 1; else if (dx < -0.5) dx += 1;   // 経度の継ぎ目
          const dy = uv.y - prev.y; const dd = Math.hypot(dx, dy);
          if (dd >= 0.0005) {
            // なぞる：渦はやめる
            t.stillHold = 0;
            if (dd < 0.2) { const m = touchStroke(p, t.hold); fluid.splat([uv.x, uv.y], [dx * 900 * m.force, dy * 900 * m.force], 0.003 * m.radius); }
          } else {
            // 止めている：その点に渦が育つ（0.4 を超えてから）
            t.stillHold += dt * p;
            const v = touchVortex(p, t.stillHold);
            if (v) { fluid.vortex([uv.x, uv.y], v.strength, v.radius); growing = true; }
          }
        }
        this.lastPointUv[i] = uv;
        this.pulse(i, p, growing, now);
      }
    }
    // S4：視線の動きに流れが引き寄せられる
    if (this.stage === 'S4') {
      const uv = this.gazeUv();
      if (this.hasGaze) {
        const dx = uv.x - this.lastGaze.x, dy = uv.y - this.lastGaze.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.0005 && d < 0.2) fluid.splat([uv.x, uv.y], [dx * 400, dy * 400], 0.004);
      }
      this.lastGaze.copy(uv); this.hasGaze = true;
      this.camera.getWorldDirection(this.tmpV); this.text.setGazeDirection(this.tmpV);
    }
    fluid.step(dt);
    updateShading(this.morphMat.uniforms, fluid, this.look, (now - this.t0) / 1000, Math.min(1, strength));
    const u = this.morphMat.uniforms;
    u.uMorph.value = this.stage === 'S5' ? this.morph : 1;          // 膨らませない。縮むのは S5 だけ
    u.uEdge.value = this.stage === 'S3' ? this.morph : this.stage === 'S4' || this.stage === 'S5' ? 1 : 0;
    u.uAppear.value = this.appear;
    this.updateDepth(now);
    // B / Y 長押しで戻る
    const { bHeld } = this.pollButtons();
    if (bHeld) { if (!this.bHoldStart) this.bHoldStart = now; else if (now - this.bHoldStart > 800 && this.stage !== 'S5') this.resolveEnd?.('exit'); } else this.bHoldStart = 0;
    renderer.render(this.scene, this.camera);
    if (this.ctx.debug && Math.floor(now / 5000) !== Math.floor((now - dt * 1000) / 5000)) {
      const f = this.fps.reduce((a, b) => a + b, 0) / this.fps.length;
      console.log(`[space] ${this.stage} ${f.toFixed(0)} fps q=${fluid.getQuality()}`);
    }
  };

  private tween(sec: number, f: (t: number) => void, ease: (t: number) => number = easeInOut): Promise<void> {
    const t0 = performance.now();
    return new Promise((res) => {
      const tick = () => { if (!this.running) return res(); const t = Math.min(1, (performance.now() - t0) / (sec * 1000)); f(ease(t)); if (t < 1) setTimeout(tick, 16); else res(); };
      tick();
    });
  }

  async start(): Promise<'exit' | 'fallback'> {
    const { renderer, sound, space, lang, fluid, reduced } = this.ctx;
    this.build();
    // セッション：「VR で入る」の中で作られたものを受け取る。無ければここで要求（ユーザー操作の直後でないと拒否される）
    let session = this.session;
    if (this.flat) {
      session = null;
      this.installProbe();
      setTimeout(() => { this.selectPressed = true; }, 300);   // 検査モードはすぐ入る
    } else {
      try {
        if (!session) session = await (navigator as Navigator & { xr: XRSystem }).xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
        await renderer.xr.setSession(session);
      } catch (e) {
        console.warn('XR セッションを開始できない。物語モードへ', e);
        return 'fallback';
      }
      session.addEventListener('end', () => this.resolveEnd?.('exit'));
    }
    renderer.setAnimationLoop(this.onFrame);
    const ended = new Promise<'exit' | 'fallback'>((res) => (this.resolveEnd = res));
    let result: 'exit' | 'fallback' = 'exit';
    try {
      result = await Promise.race([ended, this.timeline().then(() => 'exit' as const)]);
    } finally {
      this.running = false;
      renderer.setAnimationLoop(null);
      try { await session?.end(); } catch {}
      renderer.xr.enabled = false;
      this.text.dispose(); this.morphMat.dispose(); this.morphMesh.geometry.dispose(); this.planeMat.dispose(); this.planeMesh.geometry.dispose();
      this.particles.dispose(); this.surround.dispose();
      if (this.flat) delete (window as unknown as { __space?: unknown }).__space;
    }
    return result;
  }

  // 検査モードの口（tests/longrun.mjs --space から呼ぶ）。6 方向を向く、白飛び率、視界の中の粒の数
  private installProbe() {
    const dirs: Record<string, [number, number, number]> = { front: [0, 0, -1], back: [0, 0, 1], left: [-1, 0, 0], right: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
    const probe = {
      stage: () => this.stage,
      morph: () => this.morph,
      appear: () => this.appear,
      // 中心と周辺の明るさ（トンネル・穴に見えないかの検査。V-6）。中心 = 画面中央の 20% 角、周辺 = 中心からの距離が半幅の 70% より外
      luma: () => {
        const r = this.ctx.renderer; r.render(this.scene, this.camera);
        const gl = r.getContext(); const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
        const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return { ...centerPeriphery(px, w, h), white: whiteRatio(px) };
      },
      look: (name: string) => {
        const d = dirs[name]; if (!d) return false;
        const pos = this.camera.getWorldPosition(new THREE.Vector3());
        this.camera.up.set(0, 1, 0);
        if (name === 'up') this.camera.up.set(0, 0, 1); else if (name === 'down') this.camera.up.set(0, 0, -1);
        this.camera.lookAt(pos.x + d[0], pos.y + d[1], pos.z + d[2]);
        return true;
      },
      // その場で描いて読む（RGB すべて 250 以上の画素の割合）
      white: () => {
        const r = this.ctx.renderer; r.render(this.scene, this.camera);
        const gl = r.getContext(); const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
        const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return whiteRatio(px);
      },
      // 視界の中で見えている粒の数（流体による横ずれは除く。周期の両端の消えている粒は数えない）
      particlesInView: (name: string) => {
        const d = dirs[name]; if (!d || !this.particles.mesh.visible) return 0;
        const time = (performance.now() - this.t0) / 1000;
        const n = particleCount(this.ctx.fluid.getQuality() as DepthQuality);
        const pts = this.particles.seeds.slice(0, n).map((p) => ({ p, s: ((time / p.period + p.phase) % 1 + 1) % 1 })).filter((x) => x.s > 0.1 && x.s < 0.9).map((x) => particlePos(x.p, x.s));
        return particlesInView(pts, d, this.camera.fov);
      },
      surround: () => ({ floor: this.surround.floor.visible, back: this.surround.back.visible }),
    };
    (window as unknown as { __space: typeof probe }).__space = probe;
  }

  private async timeline() {
    const { sound, space, lang, fluid, reduced } = this.ctx;
    // S1 接近：壁の小さな絵。トリガーでギュン
    this.stage = 'S1';
    this.strength = 0.05;
    sound.ambient(space.audio.ambient || 'calm', -24);
    this.selectPressed = false;
    const t0 = performance.now();
    while (this.running && !this.selectPressed) {
      await wait(50);
      // 15 秒操作がなければ、声をかける代わりに自動で始める（U-12 で自動接近は落としたが、止まったままにしない保険として 40 秒）
      if (performance.now() - t0 > 40000) break;
    }
    // S1〜S3（11-04 の重ね方 + 11-07 V-6、docs/VR_DEPTH.md 6 節）：近づき始めると同時に絵が溶け出す（泡と渦）。
    // 0〜1.2 秒 S1 接近（視点のリグを動かすのはここだけ）→ 1.2〜2.7 秒 S2 溶ける：カメラは止め、壁の平面の絵が画面いっぱいへ拡大しながら、
    // 最初から半径 radius_m にある球面へ流体のフェードで 1.5 秒で置き換わる（膨らませない）→ 2.7〜5 秒 S3 包まれる：矩形の外が透け、粒・床・奥の光。
    // 泡は 0〜3 秒、合計 5 秒（reduced は 接近 0.6・泡なし・渦は半分・合計 2.6 秒。置き換わりは同じ 1.5 秒、S3 は 0.5 秒）
    const head = this.camera.getWorldPosition(new THREE.Vector3());
    const target = this.paintingCenter.clone(); target.y = head.y; target.z += space.space.melt_distance_m;
    const delta = target.sub(head);
    const from = this.rig.position.clone();
    const vmat = this.vignette.material as THREE.MeshBasicMaterial;
    const APPROACH = reduced ? 0.6 : 1.2, MELT = reduced ? 1.5 : 3, TOTAL = reduced ? 2.6 : 5;
    const ENVELOP = Math.max(0.1, TOTAL - APPROACH - APPEAR_SEC);
    const center = fluid.rectToUv(0.5, 0.5);
    const rect = fluid.placement;
    const rectH = rect.h;
    sound.setAmbientDb(-16, 1);
    sound.fizz(!reduced, -18); sound.drone(-14, 2);
    // 平面の拡大：中心で球面の絵と同じ角の大きさになるまで（高さ h·π ラジアン = 距離 d の平面で d·h·π m。placement は赤道で縦横比を保つので幅も合う）
    const pu = this.planeMat.uniforms;
    const planeFrom = this.paintingCenter.clone(), planeTo = new THREE.Vector3();
    let grow = 1;
    let s2 = false;
    await this.tween(TOTAL, (u) => {
      const t = u * TOTAL;
      // 接近（ビネットで酔いを抑える）
      const a = Math.min(1, t / APPROACH);
      if (!s2) this.rig.position.copy(from).addScaledVector(delta, easeInOut(a));
      vmat.opacity = a < 1 ? 0.9 * Math.sin(a * Math.PI) : 0;
      // 溶ける（縁から泡）
      const m = Math.min(1, t / MELT);
      if (!reduced && m < 1) fluid.fizz(m, 1);
      this.strength = Math.max(this.strength, 0.1 + 0.9 * m);
      if (t >= APPROACH) {
        if (!s2) {
          // S2 の始め：カメラはここで止まる。球の中心 = いまの頭の位置。球面は最初から半径 radius_m（透明）
          s2 = true; this.stage = 'S2';
          this.rig.position.copy(from).add(delta);
          this.camera.getWorldPosition(this.morphMat.uniforms.uHead.value as THREE.Vector3);
          this.head.copy(this.morphMat.uniforms.uHead.value as THREE.Vector3);
          this.updateLight(this.head);
          this.surround.place(this.head, floorRadius(this.head.y, space.space.radius_m));
          const d = Math.max(0.3, this.paintingCenter.distanceTo(this.head));
          grow = Math.max(1, (d * rect.h * Math.PI) / this.paintingH);
          // 拡大した平面の中心は、球面の絵の中心と同じ向き・同じ距離 d に寄せる（頭の高さと絵の高さがずれていても継ぎ目が出ない）
          const [cu, cv] = center;
          const lon = (cu - 0.5) * 2 * Math.PI, lat = (cv - 0.5) * Math.PI;
          planeTo.set(Math.sin(lon) * Math.cos(lat), Math.sin(lat), -Math.cos(lon) * Math.cos(lat)).multiplyScalar(d).add(this.head);
          this.morphMesh.visible = true;
          this.morphMat.depthTest = false;      // S2 の間は壁の部屋の上に重ねる（部屋は S3 で隠す）
        }
        if (this.stage === 'S2') {
          this.appear = Math.min(1, (t - APPROACH) / APPEAR_SEC);
          const g = easeOut(Math.min(1, this.appear / 0.6));
          const k = 1 + (grow - 1) * g;
          (pu.uPlaneRight.value as THREE.Vector3).set(this.paintingW * k, 0, 0);
          (pu.uPlaneUp.value as THREE.Vector3).set(0, this.paintingH * k, 0);
          (pu.uPlaneCenter.value as THREE.Vector3).lerpVectors(planeFrom, planeTo, g);
          if (this.appear >= 1) this.endMelt();
        }
        // S3 包まれる：矩形の外が透け、粒・床・奥の光が出る
        if (this.stage === 'S3') this.morph = easeInOut(Math.min(1, (t - APPROACH - APPEAR_SEC) / ENVELOP));
      }
      // 渦：絵の中心。強さは山形で終わりに 0、半径は広がる（絵の高さに対して 0.05 → 0.35）
      const v = t / TOTAL;
      fluid.vortex(center, Math.sin(Math.PI * Math.pow(v, 0.8)) * (reduced ? 0.5 : 1), rectH * (0.05 + 0.3 * v));
    }, (x) => x);
    vmat.opacity = 0; this.endMelt(); this.morph = 1; this.strength = 1;
    sound.fizz(false);
    sound.setAmbientDb(-18, 2);
    setTimeout(() => sound.drone(-22, 3), 2000);
    // S4 漂う：文字と声
    this.stage = 'S4';
    const voiceUrl = space.audio.voice ? this.ctx.base + space.audio.voice : null;
    let voiceEnded: Promise<boolean> = Promise.resolve(false);
    let voiceOk = false;
    if (voiceUrl) { voiceEnded = sound.playVoice(voiceUrl); await wait(250); voiceOk = sound.voiceTime() >= 0 && sound.voiceDuration() > 0; }
    for (const m of space.messages) {
      if (!this.running) return;
      if (voiceOk) { while (this.running && sound.voiceTime() >= 0 && sound.voiceTime() < m.at) { if (await Promise.race([voiceEnded.then(() => true), wait(100).then(() => false)])) break; } }
      this.text.lang = m[lang] ? lang : m.en ? 'en' : 'ja';   // 文の言語（pick と同じ順）。日本語のときだけ文節に
      await this.text.show(pick(m, lang), this.camera, { reduced });
    }
    if (voiceOk) await voiceEnded;
    // 最後の文が溶けて 60 秒たっても戻る
    await wait(60000);
    await this.leave();
  }

  // S2 の終わり：平面を消し、球面は深度を見る（S3 からは部屋を隠し、床・粒が球面の内側に重なる）
  private endMelt() {
    if (this.stage === 'S2' || this.stage === 'S1') this.stage = 'S3';
    this.appear = 1;
    this.planeMesh.visible = false; this.morphMesh.visible = true;
    this.morphMat.depthTest = true;
  }

  // S5 戻る：球面 → 平面、3 秒。流れが止まり、原画へ
  private async leave() {
    if (this.stage === 'S5') return;
    this.stage = 'S5';
    const { sound, fluid } = this.ctx;
    sound.fadeOutAll(3);
    fluid.setRestore(0.06);
    await this.tween(3, (t) => { this.morph = 1 - t; this.strength = 1 - t; });
    await wait(1500);
  }
}

// 作品 id → 粒の配置の種（作品ごとに同じ配置）
function hashId(id: string): number { let h = 2166136261; for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
