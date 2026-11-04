// VR 空間モード（Quest のブラウザ、WebXR）：S1 接近 → S2 溶ける → S3 包まれる → S4 漂う → S5 戻る
import * as THREE from 'three';
import type { StoryCtx } from '../story/StoryMode';
import type { Fluid } from '../fluid/Fluid';
import { SHADING, LIGHT_DIR, lookOf, shadingUniforms, updateShading } from '../fluid/shading';
import { SpaceText } from '../text/FloatingText';
import { pick } from '../i18n';

type Ctx = StoryCtx & { renderer: THREE.WebGLRenderer; fluid: Fluid };

// 1 枚のメッシュ：UV は色場全体（等距離円筒）。uMorph 0 = 壁の平面（絵の矩形だけ見える）、1 = 視点を中心とした球面
const MORPH_VERT = /* glsl */ `
uniform float uMorph;        // 0〜1（イージング済み）
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
const float PI = 3.141592653589793;
void main() {
  vUv = uv;
  // 絵の矩形内の座標（0〜1）。外側は矩形を延長
  vec2 p = (uv - uRect.xy) / uRect.zw;
  vInside = (p.x >= 0.0 && p.x <= 1.0 && p.y >= 0.0 && p.y <= 1.0) ? 1.0 : 0.0;
  vec3 planePos = uPlaneCenter + uPlaneRight * (p.x - 0.5) + uPlaneUp * (p.y - 0.5);
  float lon = (uv.x - 0.5) * 2.0 * PI;
  float lat = (uv.y - 0.5) * PI;
  vec3 dir = vec3(sin(lon) * cos(lat), sin(lat), -cos(lon) * cos(lat));
  vec3 spherePos = uHead + dir * uRadius;
  vec3 pos = mix(planePos, spherePos, uMorph);
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
varying vec2 vUv;
varying float vInside;
varying vec3 vT; varying vec3 vB; varying vec3 vN; varying vec3 vViewPos;
${SHADING}
void main() {
  float a = vInside > 0.5 ? 1.0 : smoothstep(0.0, 0.35, uMorph);
  if (a < 0.01) discard;
  vec3 T = normalize(vT), B = normalize(vB), N = normalize(vN);
  vec3 V = normalize(-vViewPos);
  vec3 Lt = vec3(dot(uLightView, T), dot(uLightView, B), dot(uLightView, N));
  vec3 Vt = vec3(dot(V, T), dot(V, B), dot(V, N));
  if (Vt.z < 0.0) { Lt.z = -Lt.z; Vt.z = -Vt.z; }   // 裏から見たとき
  vec3 c = paintShade(vUv, normalize(Lt), normalize(Vt));
  gl_FragColor = vec4(c * uFade, a);
  #include <colorspace_fragment>
}
`;

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class SpaceMode {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(70, 1, 0.05, 60);
  private rig = new THREE.Group();
  private morphMesh!: THREE.Mesh;
  private morphMat!: THREE.ShaderMaterial;
  private vignette!: THREE.Mesh;
  private text!: SpaceText;
  private stage = 'S0';
  private running = true;
  private strength = 0.05;
  private morph = 0;
  private resolveEnd: ((v: 'exit' | 'fallback') => void) | null = null;
  private wallZ = -3;
  private eyeY = 1.5;
  private paintingCenter = new THREE.Vector3(0, 1.5, -3);
  private paintingW = 0.4; private paintingH = 0.5;
  private selectPressed = false;
  private holding: boolean[] = [false, false];
  private lastPointUv: (THREE.Vector2 | null)[] = [null, null];
  private bHoldStart = 0;
  private lastGaze = new THREE.Vector2(0.5, 0.5);
  private hasGaze = false;
  private tmpV = new THREE.Vector3();
  private fps: number[] = [];
  private lastT = 0;
  private look = lookOf();
  private t0 = performance.now();

  constructor(private ctx: Ctx, private session: XRSession | null) {}

  private build() {
    const { space, fluid, renderer } = this.ctx;
    this.look = lookOf(space.fluid.look);
    this.paintingW = space.size_cm[0] / 100; this.paintingH = space.size_cm[1] / 100;
    this.paintingCenter.set(0, this.eyeY, this.wallZ);
    this.scene.background = new THREE.Color(space.back_color).multiplyScalar(0.25);
    // 薄暗い部屋：床の淡い円と、壁
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(space.back_color).multiplyScalar(0.5) }));
    floor.rotation.x = -Math.PI / 2; this.scene.add(floor);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(8, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(space.back_color).multiplyScalar(0.7) }));
    wall.position.set(0, 2, this.wallZ - 0.01); this.scene.add(wall);
    // 絵（流体の色場を貼った 1 枚のメッシュ。平面 → 球面）
    const geo = new THREE.PlaneGeometry(1, 1, 192, 96);
    this.morphMat = new THREE.ShaderMaterial({
      vertexShader: MORPH_VERT, fragmentShader: MORPH_FRAG, transparent: true, side: THREE.DoubleSide, depthWrite: false,
      uniforms: {
        uMorph: { value: 0 }, uRect: { value: new THREE.Vector4(fluid.placement.x, fluid.placement.y, fluid.placement.w, fluid.placement.h) },
        uHead: { value: new THREE.Vector3(0, this.eyeY, 0) }, uRadius: { value: space.space.radius_m },
        uPlaneCenter: { value: this.paintingCenter.clone() }, uPlaneRight: { value: new THREE.Vector3(this.paintingW, 0, 0) }, uPlaneUp: { value: new THREE.Vector3(0, this.paintingH, 0) },
        ...shadingUniforms(fluid, this.look), uFade: { value: 1 }, uLightView: { value: LIGHT_DIR.clone() },
      },
    });
    this.morphMesh = new THREE.Mesh(geo, this.morphMat);
    this.morphMesh.frustumCulled = false;
    this.scene.add(this.morphMesh);
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
      ctrl.addEventListener('selectstart', () => { this.selectPressed = true; this.holding[i] = true; });
      ctrl.addEventListener('selectend', () => { this.holding[i] = false; this.lastPointUv[i] = null; });
      this.rig.add(ctrl);
    }
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
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

  private onFrame = () => {
    if (!this.running) return;
    const now = performance.now(); const dt = Math.min(0.05, (now - (this.lastT || now)) / 1000); this.lastT = now;
    this.fps.push(1 / Math.max(1e-3, dt)); if (this.fps.length > 120) this.fps.shift();
    const { fluid, renderer } = this.ctx;
    // 視線が絵に乗ると、S1 の流れがわずかに強まる
    let strength = this.strength;
    if (this.stage === 'S1' && this.gazeOnPainting()) strength = Math.max(strength, 0.15);
    fluid.setStrength(strength);
    // S4：トリガーを引きながら指すと、そこの流れが手についてくる（触れる）
    if (this.stage === 'S4') {
      for (let i = 0; i < 2; i++) {
        if (!this.holding[i]) continue;
        const ctrl = renderer.xr.getController(i);
        ctrl.getWorldDirection(this.tmpV); this.tmpV.multiplyScalar(-1);   // コントローラは -Z が前
        const d = this.tmpV;
        const lon = Math.atan2(d.x, -d.z), lat = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
        const uv = new THREE.Vector2(lon / (2 * Math.PI) + 0.5, lat / Math.PI + 0.5);
        const prev = this.lastPointUv[i];
        if (prev) { const dx = uv.x - prev.x, dy = uv.y - prev.y; const dd = Math.hypot(dx, dy); if (dd > 0.0003 && dd < 0.2) fluid.splat([uv.x, uv.y], [dx * 900, dy * 900], 0.003); else if (dd <= 0.0003) fluid.splat([uv.x, uv.y], [0, 0], 0.003); }
        else fluid.burst([uv.x, uv.y], 50, 0.003);
        this.lastPointUv[i] = uv;
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
    this.morphMat.uniforms.uMorph.value = this.morph;
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
    try {
      if (!session) session = await (navigator as Navigator & { xr: XRSystem }).xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
      await renderer.xr.setSession(session);
    } catch (e) {
      console.warn('XR セッションを開始できない。物語モードへ', e);
      return 'fallback';
    }
    session.addEventListener('end', () => this.resolveEnd?.('exit'));
    renderer.setAnimationLoop(this.onFrame);
    const ended = new Promise<'exit' | 'fallback'>((res) => (this.resolveEnd = res));
    let result: 'exit' | 'fallback' = 'exit';
    try {
      result = await Promise.race([ended, this.timeline().then(() => 'exit' as const)]);
    } finally {
      this.running = false;
      renderer.setAnimationLoop(null);
      try { await session.end(); } catch {}
      renderer.xr.enabled = false;
      this.text.dispose(); this.morphMat.dispose(); this.morphMesh.geometry.dispose();
    }
    return result;
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
    // S1〜S3（設計変更 11-04）：近づき始めると同時に絵が溶け、渦の中心に吸い込まれるように球面がふくらむ。
    // 接近 1.2 秒 + 溶ける 3 秒 + 包まれる 4 秒を重ねて合計 5 秒（reduced は 0.6 + 2.0 = 2.6 秒、泡なし、渦は半分）。カメラは回さない
    const head = this.camera.getWorldPosition(new THREE.Vector3());
    const target = this.paintingCenter.clone(); target.y = head.y; target.z += space.space.melt_distance_m;
    const delta = target.sub(head);
    const from = this.rig.position.clone();
    const vmat = this.vignette.material as THREE.MeshBasicMaterial;
    const APPROACH = reduced ? 0.6 : 1.2, MELT = reduced ? 1.5 : 3, TOTAL = reduced ? 2.6 : 5;
    const center = fluid.rectToUv(0.5, 0.5);
    const rectH = fluid.placement.h;
    sound.setAmbientDb(-16, 1);
    sound.fizz(!reduced, -18); sound.drone(-14, 2);
    this.stage = 'S2';
    let headSet = false;
    await this.tween(TOTAL, (u) => {
      const t = u * TOTAL;
      // 接近（ビネットで酔いを抑える）
      const a = Math.min(1, t / APPROACH);
      this.rig.position.copy(from).addScaledVector(delta, easeInOut(a));
      vmat.opacity = a < 1 ? 0.9 * Math.sin(a * Math.PI) : 0;
      // 溶ける（縁から泡）
      const m = Math.min(1, t / MELT);
      if (!reduced && m < 1) fluid.fizz(m, 1);
      this.strength = Math.max(this.strength, 0.1 + 0.9 * m);
      // 包まれる：接近の終わりから morph。球の中心はそのときの頭の位置
      if (t >= APPROACH) {
        if (!headSet) { this.camera.getWorldPosition(this.morphMat.uniforms.uHead.value as THREE.Vector3); headSet = true; this.stage = 'S3'; }
        this.morph = easeInOut(Math.min(1, (t - APPROACH) / (TOTAL - APPROACH)));
      }
      // 渦：絵の中心。強さは山形で morph の終わりに 0、半径は広がる（絵の高さに対して 0.05 → 0.35）
      const v = t / TOTAL;
      fluid.vortex(center, Math.sin(Math.PI * Math.pow(v, 0.8)) * (reduced ? 0.5 : 1), rectH * (0.05 + 0.3 * v));
    }, (x) => x);
    vmat.opacity = 0; this.morph = 1; this.strength = 1;
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
      await this.text.show(pick(m, lang), this.camera, { reduced });
    }
    if (voiceOk) await voiceEnded;
    // 最後の文が溶けて 60 秒たっても戻る
    await wait(60000);
    await this.leave();
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
