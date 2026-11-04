// 物語モード（PC・スマホ）：T0 絵 → T1 接近 → T2 溶ける → T3 流れと語り → T4 余韻 → T5 終わり
import * as THREE from 'three';
import type { Fluid } from '../fluid/Fluid';
import type { Soundscape } from '../audio/Soundscape';
import type { Hud } from '../experience/hud';
import type { Space } from '../experience/types';
import { ScreenText } from '../text/FloatingText';
import { pick, type Lang } from '../i18n';

export interface StoryCtx {
  renderer: THREE.WebGLRenderer | null; fluid: Fluid | null; space: Space; sound: Soundscape; hud: Hud; lang: Lang;
  reduced: boolean; fromQr: boolean; base: string; debug: boolean; canvas: HTMLCanvasElement;
}

const DISPLAY_FRAG = /* glsl */ `
varying vec2 vUv; uniform sampler2D uDye; uniform vec4 uView; uniform float uFade; uniform float uVivid;
void main() {
  vec2 uv = uView.xy + vUv * uView.zw;
  vec3 c = texture2D(uDye, uv).rgb;
  // 流れている間（uVivid 0〜1）は彩度とコントラストをわずかに上げ、混ざって鈍った色を戻す
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(luma), c, 1.0 + 0.35 * uVivid);
  c = (c - 0.5 * luma * uVivid * 0.1) * (1.0 + 0.08 * uVivid);
  gl_FragColor = vec4(max(c, 0.0) * uFade, 1.0);
  #include <colorspace_fragment>
}`;
const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
// 「バーッ」「シューッ」用：急に加速して急に止まる
const easeInOutExpo = (t: number) => (t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2);
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class StoryMode {
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mesh: THREE.Mesh | null = null;
  private mat: THREE.ShaderMaterial | null = null;
  private roomMesh: THREE.Mesh | null = null;
  private roomMat: THREE.MeshBasicMaterial | null = null;
  private roomTex: THREE.Texture | null = null;
  private posNow = { x: 0, y: 0 };
  private img: HTMLImageElement | null = null;     // 静止画モード
  private text: ScreenText;
  private stage = 'T0';
  private paused = false;
  private running = true;
  private scaleContain = { x: 1, y: 1 };
  private scaleNow = { x: 1, y: 1 };
  private fade = 0;
  private strength = 0;
  private fpsSamples: number[] = [];
  private resolveEnd: ((v: 'again' | 'exit') => void) | null = null;
  private restoreBase: number;

  constructor(private ctx: StoryCtx) {
    this.text = new ScreenText(ctx.hud.textLayer, ctx.space.text_color);
    this.restoreBase = ctx.space.fluid.restore;
  }

  private layout() {
    const vw = innerWidth, vh = innerHeight, a = this.ctx.space.aspect;
    // 60% 幅、80% 高さに収める
    let w = vw * 0.6, h = w / a;
    if (h > vh * 0.8) { h = vh * 0.8; w = h * a; }
    this.scaleContain = { x: w / vw, y: h / vh };
    this.ctx.renderer?.setSize(vw, vh, false);
  }

  private coverScale(): { x: number; y: number } {
    const vw = innerWidth, vh = innerHeight;
    const k = Math.max(vw / (this.scaleContain.x * vw), vh / (this.scaleContain.y * vh)) * 1.15;
    return { x: this.scaleContain.x * k, y: this.scaleContain.y * k };
  }

  private setup() {
    const { fluid, renderer, space, canvas } = this.ctx;
    this.layout();
    if (fluid && renderer) {
      this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: DISPLAY_FRAG, uniforms: { uDye: { value: fluid.texture }, uView: { value: new THREE.Vector4(fluid.placement.x, fluid.placement.y, fluid.placement.w, fluid.placement.h) }, uFade: { value: 0 }, uVivid: { value: 0 } }, depthTest: false });
      this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
      this.scene.add(this.mesh);
      renderer.setClearColor(0x000000, 1);
    } else {
      canvas.remove();
      const img = document.createElement('img');
      img.src = this.ctx.base + 'generated/' + space.painting; img.alt = '';
      img.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:60vw;max-height:80vh;object-fit:contain;transition:transform 1.2s cubic-bezier(.2,.7,.3,1),filter 3s,opacity 2s;opacity:0;';
      this.img = img;
      document.getElementById('stage')!.insertBefore(img, this.ctx.hud.root);
      // 静止画：ゆっくり揺らぐ
      if (!this.ctx.reduced) img.animate([{ filter: 'saturate(1) blur(0px)' }, { filter: 'saturate(1.15) blur(1px)' }, { filter: 'saturate(1) blur(0px)' }], { duration: 9000, iterations: Infinity });
    }
    window.addEventListener('resize', this.onResize);
    this.ctx.hud.close.addEventListener('click', () => this.end('exit'));
    this.ctx.hud.skip.addEventListener('click', () => this.text.skip());
    this.ctx.hud.ending.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-action]'); if (!b) return;
      const a = b.dataset.action;
      if (a === 'again') this.end('again');
      else if (a === 'close') this.end('exit');
      else if (a === 'save') { const url = location.origin + location.pathname; (navigator.share ? navigator.share({ title: document.title, url }) : navigator.clipboard.writeText(url)).catch(() => {}); }
      else if (a === 'rooms') { this.end('exit'); setTimeout(() => document.querySelector('.rooms')?.scrollIntoView({ behavior: 'smooth' }), 50); }
      else if (a === 'contact') { if (this.ctx.space.contact) window.open(this.ctx.space.contact, '_blank', 'noopener'); }
    });
    // タップ / クリックで一時停止と再開（T3 の間だけ）
    const stageEl = document.getElementById('stage')!;
    stageEl.addEventListener('pointerdown', (e) => { if ((e.target as HTMLElement).closest('button')) return; if (this.stage === 'T3') this.setPaused(!this.paused); });
    window.addEventListener('keydown', this.onKey);
  }

  private onResize = () => { this.layout(); };
  private onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') this.end('exit'); else if (e.key === ' ' && this.stage === 'T3') { e.preventDefault(); this.setPaused(!this.paused); } else if (e.key === 'ArrowRight') this.text.skip(); };

  private setPaused(p: boolean) {
    this.paused = p; this.text.setPaused(p); this.ctx.hud.paused.style.opacity = p ? '1' : '0';
    if (p) this.ctx.sound.pauseVoice(); else this.ctx.sound.resumeVoice();
  }

  private end(v: 'again' | 'exit') { this.resolveEnd?.(v); }

  private last = performance.now();
  private frame = () => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    const now = performance.now(); const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    this.fpsSamples.push(1 / Math.max(1e-3, dt)); if (this.fpsSamples.length > 90) this.fpsSamples.shift();
    const { fluid, renderer } = this.ctx;
    if (fluid && renderer && this.mesh && this.mat) {
      if (!this.paused) { fluid.setStrength(this.strength); fluid.step(dt); }
      this.mesh.scale.set(this.scaleNow.x, this.scaleNow.y, 1);
      this.mesh.position.set(this.posNow.x, this.posNow.y, 0);
      this.mat.uniforms.uFade.value = this.fade;
      this.mat.uniforms.uVivid.value = Math.min(1, this.strength);
      this.mat.uniforms.uDye.value = fluid.texture;
      renderer.setRenderTarget(null);
      renderer.render(this.scene, this.camera);
      if (this.ctx.debug) {
        const fps = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
        this.ctx.hud.debug.textContent = `${this.stage}  ${fps.toFixed(0)} fps  q=${fluid.getQuality()}  ${fluid.size.join('x')}  strength=${this.strength.toFixed(2)}`;
      }
    }
  };

  private async tween(sec: number, f: (t: number) => void, ease: (t: number) => number = easeInOut): Promise<void> {
    const t0 = performance.now();
    return new Promise((res) => {
      const tick = () => {
        if (!this.running) return res();
        const t = Math.min(1, (performance.now() - t0) / (sec * 1000)); f(ease(t));
        if (t < 1) requestAnimationFrame(tick); else res();
      };
      tick();
    });
  }

  // 部屋のイメージ（終わりの演出用）。T3 の間に読んでおく
  private loadRoom(): Promise<void> {
    const room = this.ctx.space.rooms?.find((r) => r.quad_px && r.image_px);
    if (!room || !this.ctx.renderer) return Promise.resolve();
    return new Promise((res) => {
      new THREE.TextureLoader().load(this.ctx.base + 'generated/' + room.image, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
        this.roomTex = tex;
        this.roomMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthTest: false });
        this.roomMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.roomMat);
        this.roomMesh.renderOrder = -1;
        this.scene.add(this.roomMesh);
        res();
      }, undefined, () => res());
    });
  }

  // 部屋のイメージを画面に収めたときの、画像座標 → 画面の矩形（NDC のスケールと位置）
  private roomLayout() {
    const room = this.ctx.space.rooms?.find((r) => r.quad_px && r.image_px)!;
    const [iw, ih] = room.image_px!;
    const vw = innerWidth, vh = innerHeight;
    const s = Math.max(vw / iw, vh / ih) * 1.0;   // cover（縦画面でも部屋が画面を満たす）
    const ox = (vw - iw * s) / 2, oy = (vh - ih * s) / 2;
    const xs = room.quad_px!.map((p) => p[0]), ys = room.quad_px!.map((p) => p[1]);
    const x0 = Math.min(...xs) * s + ox, x1 = Math.max(...xs) * s + ox, y0 = Math.min(...ys) * s + oy, y1 = Math.max(...ys) * s + oy;
    const roomScale = { x: (iw * s) / vw, y: (ih * s) / vh };
    const paintScale = { x: (x1 - x0) / vw, y: (y1 - y0) / vh };
    const paintPos = { x: ((x0 + x1) / 2 / vw) * 2 - 1, y: 1 - ((y0 + y1) / 2 / vh) * 2 };
    return { roomScale, paintScale, paintPos };
  }

  async start(): Promise<'again' | 'exit'> {
    this.setup();
    this.frame();
    let result: 'again' | 'exit' = 'exit';
    try {
      do {
        const ended = new Promise<'again' | 'exit'>((res) => (this.resolveEnd = res));
        const timeline = this.timeline();
        result = await Promise.race([ended, timeline.then(() => ended)]);
        this.text.clear();
        if (result === 'again') { this.ctx.fluid?.reset(); this.ctx.fluid?.setRestore(this.restoreBase); this.posNow = { x: 0, y: 0 }; this.fade = 0; if (this.roomMat) this.roomMat.opacity = 0; this.ctx.hud.ending.style.opacity = '0'; this.ctx.hud.ending.style.pointerEvents = 'none'; this.ctx.hud.once.style.opacity = '0'; }
      } while (result === 'again' && this.running);
    } finally {
      this.running = false;
      window.removeEventListener('resize', this.onResize); window.removeEventListener('keydown', this.onKey);
      this.text.dispose(); this.img?.remove(); this.roomTex?.dispose(); this.roomMat?.dispose();
    }
    return result;
  }

  private async timeline() {
    const { sound, space, hud, lang, reduced, fluid } = this.ctx;
    const msgs = space.messages;
    // T0 絵（3 秒）
    this.stage = 'T0';
    hud.skip.hidden = false;
    this.scaleNow = { ...this.scaleContain }; this.strength = 0.05;
    sound.ambient(space.audio.ambient || 'calm', -24);
    hud.title.textContent = pick(space.title, lang); hud.title.style.opacity = '1';
    if (this.img) { this.img.style.opacity = '1'; }
    await this.tween(1.5, (t) => (this.fade = t));
    await wait(1500);
    hud.title.style.opacity = '0';
    // 自動の品質調整（溶ける前に 1 回だけ）
    if (fluid && this.fpsSamples.length > 30) {
      const fps = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
      if (fps < 40 && fluid.getQuality() === 'high') fluid.setQuality('medium');
      else if (fps < 30 && fluid.getQuality() === 'medium') fluid.setQuality('low');
    }
    // T1 接近（1.2 秒）：画面いっぱい × 1.15 まで拡大
    this.stage = 'T1';
    const from = { ...this.scaleContain }, to = this.coverScale();
    sound.setAmbientDb(-16, 1);
    if (this.img) this.img.style.transform = 'translate(-50%,-50%) scale(1.9)';
    await this.tween(reduced ? 0.6 : 1.2, (t) => { this.scaleNow = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }; }, reduced ? easeInOut : easeInOutExpo);
    // T2 溶ける（3 秒）：縁からシュワシュワ
    this.stage = 'T2';
    sound.fizz(!reduced, -18); sound.drone(-14, 2);
    if (fluid && !reduced) {
      await this.tween(3, (t) => { fluid.fizz(t, 1); this.strength = 0.1 + 0.9 * t; });
    } else { await this.tween(1.5, (t) => (this.strength = 0.1 + 0.9 * t)); }
    sound.fizz(false);
    // T3 流れと語り
    this.stage = 'T3';
    setTimeout(() => sound.drone(-22, 3), 4000);
    const roomReady = this.loadRoom();
    const voiceUrl = space.audio.voice ? this.ctx.base + space.audio.voice : null;
    let voiceEnded: Promise<boolean> = Promise.resolve(false);
    let voiceOk = false;
    if (voiceUrl) {
      voiceEnded = sound.playVoice(voiceUrl);
      // 200ms 待って再生できているかを見る
      await wait(250);
      voiceOk = sound.voiceTime() >= 0 && sound.voiceDuration() > 0;
    }
    for (let i = 0; i < msgs.length && this.running; i++) {
      const m = msgs[i];
      if (voiceOk) {
        // 声の文の開始時刻まで待つ（一時停止中は進まない）
        while (this.running && sound.voiceTime() < m.at && sound.voiceTime() >= 0 && !(await raced(voiceEnded, 100))) { /* wait */ }
      }
      await this.text.show(pick(m, lang), { reduced });
    }
    if (voiceOk) await voiceEnded;
    // T4 余韻：最後の文字が終わると同時に、シューッと引きながら流れが止まり、元の絵へ戻る
    this.stage = 'T4';
    hud.skip.hidden = true;
    sound.fadeOutAll(4);
    fluid?.setRestore(0.08);
    const back = { ...this.scaleNow }, target = { ...this.scaleContain };
    await this.tween(reduced ? 1.0 : 1.6, (t) => {
      this.strength = 1 - t;
      this.scaleNow = { x: back.x + (target.x - back.x) * t, y: back.y + (target.y - back.y) * t };
    }, reduced ? easeInOut : easeInOutExpo);
    if (this.img) { this.img.style.transform = 'translate(-50%,-50%) scale(1)'; }
    await this.tween(2.2, () => { /* 静止した絵を見せる。回帰で元の絵に戻りきる */ });
    // T5 終わり：その絵が、誰かの部屋に掛かる
    this.stage = 'T5';
    await roomReady;
    if (this.roomMesh && this.roomMat && fluid) {
      const L = this.roomLayout();
      this.roomMesh.scale.set(L.roomScale.x, L.roomScale.y, 1);
      const s0 = { ...this.scaleNow }, p0 = { ...this.posNow };
      await this.tween(reduced ? 1.2 : 2.6, (t) => {
        this.roomMat!.opacity = Math.min(1, t * 1.6);
        this.scaleNow = { x: s0.x + (L.paintScale.x - s0.x) * t, y: s0.y + (L.paintScale.y - s0.y) * t };
        this.posNow = { x: p0.x + (L.paintPos.x - p0.x) * t, y: p0.y + (L.paintPos.y - p0.y) * t };
      });
      // 流体の絵を消して、合成済みの部屋だけにする（同じ場所に同じ絵がある）
      await this.tween(1.0, (t) => (this.fade = 1 - t));
    }
    fluid?.setRestore(this.restoreBase);
    hud.ending.style.opacity = '1'; hud.ending.style.pointerEvents = 'auto';
    if (this.ctx.fromQr) hud.once.style.opacity = '1';
  }
}

// p が ms 以内に解決すれば true
function raced(p: Promise<unknown>, ms: number): Promise<boolean> {
  return Promise.race([p.then(() => true), wait(ms).then(() => false)]);
}
