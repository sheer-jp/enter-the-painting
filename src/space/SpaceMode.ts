// VR 空間モード（Quest のブラウザ、WebXR）：S1 接近 → S2 溶ける → S3 包まれる → S4 漂う → S5 戻る
import * as THREE from 'three';
import type { StoryCtx } from '../story/StoryMode';
import type { Fluid } from '../fluid/Fluid';
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
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`;
const MORPH_FRAG = /* glsl */ `
uniform sampler2D uDye;
uniform float uMorph;
uniform float uFade;
varying vec2 vUv;
varying float vInside;
void main() {
  float a = vInside > 0.5 ? 1.0 : smoothstep(0.0, 0.35, uMorph);
  if (a < 0.01) discard;
  gl_FragColor = vec4(texture2D(uDye, vUv).rgb * uFade, a);
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
  private bHoldStart = 0;
  private lastGaze = new THREE.Vector2(0.5, 0.5);
  private hasGaze = false;
  private tmpV = new THREE.Vector3();
  private fps: number[] = [];
  private lastT = 0;

  constructor(private ctx: Ctx, private session: XRSession | null) {}

  private build() {
    const { space, fluid, renderer } = this.ctx;
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
        uDye: { value: fluid.texture }, uFade: { value: 1 },
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
      ctrl.addEventListener('selectstart', () => { this.selectPressed = true; });
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
    this.morphMat.uniforms.uDye.value = fluid.texture;
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

  private tween(sec: number, f: (t: number) => void): Promise<void> {
    const t0 = performance.now();
    return new Promise((res) => {
      const tick = () => { if (!this.running) return res(); const t = Math.min(1, (performance.now() - t0) / (sec * 1000)); f(easeInOut(t)); if (t < 1) setTimeout(tick, 16); else res(); };
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
    // 接近：頭の位置から絵の 1.0m 手前へ、1.2 秒。ビネットで酔いを抑える
    const head = this.camera.getWorldPosition(new THREE.Vector3());
    const target = this.paintingCenter.clone(); target.y = head.y; target.z += space.space.melt_distance_m;
    const delta = target.sub(head);
    const from = this.rig.position.clone();
    const vmat = this.vignette.material as THREE.MeshBasicMaterial;
    sound.setAmbientDb(-16, 1);
    await this.tween(reduced ? 0.6 : 1.2, (t) => { this.rig.position.copy(from).addScaledVector(delta, t); vmat.opacity = 0.9 * Math.sin(t * Math.PI); });
    vmat.opacity = 0;
    // S2 溶ける（3 秒）
    this.stage = 'S2';
    sound.fizz(!reduced, -18); sound.drone(-14, 2);
    if (!reduced) await this.tween(3, (t) => { fluid.fizz(t, 1); this.strength = 0.1 + 0.9 * t; });
    else await this.tween(1.5, (t) => (this.strength = 0.1 + 0.9 * t));
    sound.fizz(false);
    // S3 包まれる（4 秒）：平面 → 球面。球の中心は今の頭の位置
    this.stage = 'S3';
    this.camera.getWorldPosition(this.morphMat.uniforms.uHead.value as THREE.Vector3);
    // 絵の矩形の外側も、壁の延長から球面へ
    await this.tween(reduced ? 2 : 4, (t) => { this.morph = t; });
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
