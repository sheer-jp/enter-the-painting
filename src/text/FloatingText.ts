// 文字の浮上。screen：DOM で画面の奥から（物語モード）。space：Canvas のスプライトで空間内（VR）
import * as THREE from 'three';

export interface FloatOptions { rise?: number; hold?: number; dissolve?: number; reduced?: boolean }

const holdFor = (s: string, min = 4) => Math.max(min, s.length * 0.25);

export class ScreenText {
  readonly el: HTMLDivElement;
  private token = 0;
  private resolveSkip: (() => void) | null = null;
  private paused = false;
  constructor(parent: HTMLElement, color: string) {
    this.el = document.createElement('div');
    this.el.className = 'float-text';
    this.el.style.cssText = `position:absolute;left:0;right:0;top:50%;transform:translateY(-50%) scale(.3);padding:0 8vw;text-align:center;color:${color};font-size:min(5vmin,34px);line-height:1.7;letter-spacing:.04em;opacity:0;filter:blur(6px);pointer-events:none;text-shadow:0 0 24px rgba(0,0,0,.9),0 0 60px rgba(0,0,0,.7),0 2px 4px rgba(0,0,0,.8);word-break:keep-all;overflow-wrap:anywhere;`;
    parent.appendChild(this.el);
  }
  setPaused(p: boolean) { this.paused = p; this.el.getAnimations().forEach((a) => (p ? a.pause() : a.play())); }
  skip() { this.resolveSkip?.(); }
  // 浮上 → 滞在 → 溶ける。resolve で終わり
  async show(sentence: string, opt: FloatOptions = {}): Promise<void> {
    const my = ++this.token;
    const rise = opt.reduced ? 1.5 : (opt.rise ?? 6), hold = opt.hold ?? holdFor(sentence), dissolve = opt.reduced ? 1 : (opt.dissolve ?? 3);
    this.el.textContent = sentence;
    const anim = (frames: Keyframe[], ms: number) => new Promise<void>((res) => {
      const a = this.el.animate(frames, { duration: ms, fill: 'forwards', easing: 'cubic-bezier(.2,.7,.3,1)' });
      if (this.paused) a.pause();
      a.onfinish = () => res();
    });
    const skippable = (p: Promise<void>) => new Promise<void>((res) => { this.resolveSkip = res; p.then(res); });
    await skippable(anim([{ opacity: 0, transform: 'translateY(-50%) scale(.3)', filter: 'blur(8px)' }, { opacity: 1, transform: 'translateY(-50%) scale(1)', filter: 'blur(0px)' }], rise * 1000));
    if (my !== this.token) return;
    await skippable(this.wait(hold * 1000));
    if (my !== this.token) return;
    this.resolveSkip = null;
    await anim([{ opacity: 1, transform: 'translateY(-50%) scale(1)', filter: 'blur(0px)' }, { opacity: 0, transform: 'translateY(-50%) scale(1.15)', filter: 'blur(10px)' }], dissolve * 1000);
  }
  private wait(ms: number) {
    return new Promise<void>((res) => {
      let left = ms, last = performance.now();
      const tick = () => { const now = performance.now(); if (!this.paused) left -= now - last; last = now; if (left <= 0) res(); else requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
  }
  clear() { this.token++; this.el.getAnimations().forEach((a) => a.cancel()); this.el.style.opacity = '0'; }
  dispose() { this.el.remove(); }
}

// 空間内の文字：Canvas に描いたテクスチャのスプライト。視線の奥 8m → 2m
export class SpaceText {
  readonly mesh: THREE.Mesh;
  private canvas = document.createElement('canvas');
  private tex: THREE.CanvasTexture;
  private mat: THREE.MeshBasicMaterial;
  private token = 0;
  private resolveSkip: (() => void) | null = null;
  private gaze = new THREE.Vector3(0, 0, -1);
  private color: string;
  private font: string;
  constructor(color: string, lang: string) {
    this.color = color;
    this.font = /^(ja|zh|ko)/.test(lang) ? '"Hiragino Sans","Noto Sans JP","Noto Sans CJK JP","Noto Sans SC","Noto Sans KR",sans-serif' : 'system-ui,"Noto Sans",sans-serif';
    this.canvas.width = 2048; this.canvas.height = 512;
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    // 2m で高さ 12cm の 1 行（2 行なら 24cm）→ 幅は 4:1
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), this.mat);
    this.mesh.renderOrder = 10; this.mesh.visible = false;
  }
  setGazeDirection(dir: THREE.Vector3) { this.gaze.copy(dir).normalize(); }
  skip() { this.resolveSkip?.(); }
  private draw(text: string) {
    const c = this.canvas.getContext('2d')!;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.font = `500 110px ${this.font}`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    // 2 行まで（40 文字で折り返し）
    const lines: string[] = [];
    if (/[　-鿿가-힯]/.test(text)) { for (let i = 0; i < text.length; i += 20) lines.push(text.slice(i, i + 20)); }
    else { let cur = ''; for (const w of text.split(' ')) { if ((cur + ' ' + w).trim().length > 34) { lines.push(cur.trim()); cur = w; } else cur += ' ' + w; } if (cur.trim()) lines.push(cur.trim()); }
    const ls = lines.slice(0, 2);
    // 背後のにじみ（柔らかい暗い影）
    c.shadowColor = 'rgba(0,0,0,0.95)'; c.shadowBlur = 40;
    c.fillStyle = this.color;
    ls.forEach((l, i) => { const y = 256 + (i - (ls.length - 1) / 2) * 130; c.fillText(l, 1024, y); c.fillText(l, 1024, y); });
    this.tex.needsUpdate = true;
  }
  // camera は視点。rise 6 秒で 8m → 2m、滞在、3 秒で溶ける
  async show(sentence: string, camera: THREE.Object3D, opt: FloatOptions = {}): Promise<void> {
    const my = ++this.token;
    const rise = opt.reduced ? 1.5 : (opt.rise ?? 6), hold = opt.hold ?? holdFor(sentence), dissolve = opt.reduced ? 1 : (opt.dissolve ?? 3);
    this.draw(sentence);
    this.mesh.visible = true;
    const dir = new THREE.Vector3();
    const headPos = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    const place = (dist: number, scale: number, opacity: number) => {
      camera.getWorldPosition(headPos);
      // 視線の変化にゆっくり追従（毎秒 30%）
      dir.lerp(this.gaze, 0.3 * (1 / 60)).normalize();
      tmp.copy(headPos).addScaledVector(dir, dist);
      this.mesh.position.copy(tmp); this.mesh.lookAt(headPos);
      this.mesh.scale.setScalar(scale * dist / 2);   // 2m で 1 倍（見かけの大きさ一定に近く）
      this.mat.opacity = opacity;
    };
    dir.copy(this.gaze);
    const run = (sec: number, f: (t: number) => void) => new Promise<void>((res) => {
      const t0 = performance.now();
      const tick = () => { if (my !== this.token) return res(); const t = Math.min(1, (performance.now() - t0) / (sec * 1000)); f(t); if (t < 1) requestAnimationFrame(tick); else res(); };
      requestAnimationFrame(tick);
    });
    const ease = (t: number) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const skippable = (p: Promise<void>) => new Promise<void>((res) => { this.resolveSkip = res; p.then(res); });
    await skippable(run(rise, (t) => { const e = ease(t); place(8 - 6 * e, 1, Math.pow(e, 1.5)); }));
    if (my !== this.token) return;
    await skippable(run(hold, () => place(2, 1, 1)));
    if (my !== this.token) return;
    this.resolveSkip = null;
    await run(dissolve, (t) => place(2 - 0.3 * t, 1 + 0.15 * t, 1 - t));
    this.mesh.visible = false;
  }
  clear() { this.token++; this.mesh.visible = false; this.mat.opacity = 0; }
  dispose() { this.tex.dispose(); this.mat.dispose(); this.mesh.geometry.dispose(); }
}
