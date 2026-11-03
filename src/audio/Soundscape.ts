// 音。声は <audio> 要素（iOS の消音スイッチでも鳴る）、環境音・泡・ドローンは Web Audio で合成。
// すべて「入る」のハンドラ内で unlock() してから使う
export type Ambient = 'calm' | 'wind' | 'water' | 'drone' | 'none';

const dbToGain = (db: number) => Math.pow(10, db / 20);

export class Soundscape {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private ambientGain!: GainNode;
  private droneGain!: GainNode;
  private fizzGain!: GainNode;
  private ambientSrc: AudioBufferSourceNode | null = null;
  private voice: HTMLAudioElement | null = null;
  private muted = false;

  async unlock(): Promise<void> {
    if (this.ctx) { if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = 1; this.master.connect(ctx.destination);
    this.ambientGain = ctx.createGain(); this.ambientGain.gain.value = 0; this.ambientGain.connect(this.master);
    this.droneGain = ctx.createGain(); this.droneGain.gain.value = 0; this.droneGain.connect(this.master);
    this.fizzGain = ctx.createGain(); this.fizzGain.gain.value = 0; this.fizzGain.connect(this.master);
    await ctx.resume().catch(() => {});
    this.buildDrone(); this.buildFizz();
  }

  get ready() { return !!this.ctx; }

  // 茶色ノイズ（低いノイズ）をループ
  ambient(preset: Ambient, gainDb = -24) {
    if (!this.ctx) return;
    this.ambientSrc?.stop(); this.ambientSrc = null;
    if (preset === 'none') { this.ambientGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.5); return; }
    const ctx = this.ctx;
    const len = ctx.sampleRate * 6;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;   // 茶色ノイズ
        d[i] = last * 3.5;
      }
      // ループの継ぎ目を滑らかに
      for (let i = 0; i < 4000; i++) { const f = i / 4000; d[i] *= f; d[len - 1 - i] *= f; }
    }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = preset === 'water' ? 1800 : preset === 'wind' ? 900 : 500;
    src.connect(lp).connect(this.ambientGain);
    src.start();
    this.ambientSrc = src;
    this.ambientGain.gain.setTargetAtTime(dbToGain(gainDb), ctx.currentTime, 1.0);
  }

  setAmbientDb(db: number, sec = 1) { if (this.ctx) this.ambientGain.gain.setTargetAtTime(dbToGain(db), this.ctx.currentTime, sec); }

  private buildDrone() {
    const ctx = this.ctx!;
    for (const [f, g] of [[55, 1], [110, 0.5], [82.4, 0.3]] as const) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const gg = ctx.createGain(); gg.gain.value = g * 0.4;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08 + Math.random() * 0.05;
      const lg = ctx.createGain(); lg.gain.value = g * 0.15;
      lfo.connect(lg).connect(gg.gain);
      o.connect(gg).connect(this.droneGain);
      o.start(); lfo.start();
    }
  }

  drone(gainDb: number, sec = 1.5) { if (this.ctx) this.droneGain.gain.setTargetAtTime(gainDb <= -60 ? 0 : dbToGain(gainDb), this.ctx.currentTime, sec); }

  private fizzSrc: AudioBufferSourceNode | null = null;
  private buildFizz() {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (Math.random() < 0.02 ? 1 : 0.15);   // 粒の立つノイズ
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
    src.connect(hp).connect(this.fizzGain); src.start();
    this.fizzSrc = src;
  }

  fizz(on: boolean, gainDb = -18) { if (this.ctx) this.fizzGain.gain.setTargetAtTime(on ? dbToGain(gainDb) : 0, this.ctx.currentTime, on ? 0.3 : 0.8); }

  // 声。終わりで resolve。失敗（ファイル無し・再生不可）でも resolve(false)
  playVoice(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      const a = new Audio(url);
      a.preload = 'auto';
      this.voice = a;
      a.addEventListener('ended', () => resolve(true));
      a.addEventListener('error', () => resolve(false));
      a.play().catch(() => resolve(false));
    });
  }
  voiceTime(): number { return this.voice?.currentTime ?? -1; }
  voiceDuration(): number { return this.voice && isFinite(this.voice.duration) ? this.voice.duration : 0; }
  pauseVoice() { this.voice?.pause(); this.ctx?.suspend().catch(() => {}); }
  resumeVoice() { this.voice?.play().catch(() => {}); this.ctx?.resume().catch(() => {}); }
  seekVoice(sec: number) { if (this.voice) this.voice.currentTime = sec; }

  fadeOutAll(sec = 2) {
    if (this.ctx) { const t0 = this.ctx.currentTime; for (const g of [this.ambientGain, this.droneGain, this.fizzGain]) g.gain.setTargetAtTime(0, t0, sec / 3); }
    if (this.voice) { const v = this.voice; const step = () => { v.volume = Math.max(0, v.volume - 0.05); if (v.volume > 0 && !v.paused) setTimeout(step, (sec * 1000) / 20); else v.pause(); }; step(); }
  }

  dispose() { this.fadeOutAll(0.3); setTimeout(() => { this.ctx?.close().catch(() => {}); this.ctx = null; }, 500); }
}
