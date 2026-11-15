/**
 * Procedural sound effects (WebAudio) — no audio files needed.
 */
import { readPref, writePref } from './identity';

export type Sound =
  | 'deal'
  | 'lay'
  | 'capture'
  | 'chkobba'
  | 'flip'
  | 'hover'
  | 'select'
  | 'myTurn'
  | 'shuffle'
  | 'sweep'
  | 'click'
  | 'win'
  | 'lose'
  | 'message'
  | 'join'
  | 'pop';

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastPlayed = new Map<Sound, number>();
  volume = readPref('volume', 0.7);
  muted = readPref('muted', false);

  /** Must be called from a user gesture at least once. */
  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  setMuted(m: boolean) {
    this.muted = m;
    writePref('muted', m);
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  setVolume(v: number) {
    this.volume = v;
    writePref('volume', v);
    if (this.master && !this.muted) this.master.gain.value = v;
  }

  private tone(
    freq: number,
    start: number,
    dur: number,
    opts: { type?: OscillatorType; gain?: number; to?: number; attack?: number; detune?: number } = {},
  ) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, start);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, start + dur);
    if (opts.detune) osc.detune.value = opts.detune;
    const peak = opts.gain ?? 0.3;
    const attack = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g);
    g.connect(this.master!);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  private hiss(
    start: number,
    dur: number,
    opts: { gain?: number; freq?: number; to?: number; q?: number; type?: BiquadFilterType } = {},
  ) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.setValueAtTime(opts.freq ?? 2500, start);
    if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, start + dur);
    f.Q.value = opts.q ?? 1.2;
    const g = ctx.createGain();
    const peak = opts.gain ?? 0.3;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master!);
    src.start(start, Math.random() * 0.5);
    src.stop(start + dur + 0.05);
  }

  /** Darbuka hits: "doum" (low) and "tek" (high). */
  private doum(t: number, gain = 0.5) {
    this.tone(150, t, 0.28, { gain, to: 70 });
    this.hiss(t, 0.05, { gain: gain * 0.3, freq: 400, q: 0.8 });
  }

  private tek(t: number, gain = 0.3) {
    this.hiss(t, 0.06, { gain, freq: 5200, q: 2.5, type: 'bandpass' });
    this.tone(900, t, 0.04, { gain: gain * 0.3, type: 'triangle' });
  }

  play(name: Sound) {
    if (!this.ctx || !this.master || this.muted) return;
    // Background tabs fast-forward animations: only keep the sounds that call you back.
    if (document.hidden && name !== 'myTurn' && name !== 'message' && name !== 'win' && name !== 'lose') return;
    const nowMs = performance.now();
    const minGap = name === 'deal' ? 35 : name === 'hover' ? 60 : 20;
    if (nowMs - (this.lastPlayed.get(name) ?? 0) < minGap) return;
    this.lastPlayed.set(name, nowMs);
    const t = this.ctx.currentTime + 0.005;
    switch (name) {
      case 'deal':
        this.hiss(t, 0.07, { gain: 0.22, freq: 3200, to: 1800, q: 0.9 });
        break;
      case 'flip':
        this.hiss(t, 0.09, { gain: 0.25, freq: 2200, to: 4200, q: 1 });
        this.tone(520, t + 0.02, 0.05, { gain: 0.05, type: 'triangle' });
        break;
      case 'lay':
        this.hiss(t, 0.05, { gain: 0.25, freq: 1400, q: 0.8 });
        this.tone(170, t, 0.12, { gain: 0.25, to: 90 });
        break;
      case 'capture':
        this.tone(784, t, 0.18, { gain: 0.16, type: 'triangle' });
        this.tone(1175, t + 0.07, 0.25, { gain: 0.14, type: 'triangle' });
        break;
      case 'sweep':
        this.hiss(t, 0.32, { gain: 0.22, freq: 600, to: 3500, q: 0.7 });
        break;
      case 'shuffle':
        for (let i = 0; i < 9; i++) this.hiss(t + i * 0.045, 0.04, { gain: 0.18, freq: 2800 + Math.random() * 1200, q: 1.5 });
        break;
      case 'chkobba': {
        // Darbuka groove + bright arpeggio + shimmer.
        const beat = 0.12;
        this.doum(t, 0.55);
        this.tek(t + beat, 0.3);
        this.tek(t + beat * 2, 0.25);
        this.doum(t + beat * 3, 0.5);
        this.tek(t + beat * 4, 0.3);
        this.doum(t + beat * 5, 0.45);
        this.tek(t + beat * 5.5, 0.25);
        this.tek(t + beat * 6, 0.3);
        const notes = [523, 659, 784, 1047, 1319];
        notes.forEach((f, i) => this.tone(f, t + 0.05 + i * 0.07, 0.35, { gain: 0.14, type: 'square', detune: 4 }));
        this.tone(1568, t + 0.42, 0.6, { gain: 0.12, type: 'triangle' });
        this.hiss(t + 0.4, 0.8, { gain: 0.08, freq: 8000, q: 0.5, type: 'highpass' });
        break;
      }
      case 'myTurn':
        this.tone(880, t, 0.5, { gain: 0.12 });
        this.tone(1320, t + 0.09, 0.6, { gain: 0.1 });
        break;
      case 'hover':
        this.tone(1800, t, 0.03, { gain: 0.025, type: 'triangle' });
        break;
      case 'select':
        this.tone(500, t, 0.08, { gain: 0.12, to: 900, type: 'triangle' });
        break;
      case 'click':
      case 'pop':
        this.tone(660, t, 0.07, { gain: 0.12, to: 990, type: 'triangle' });
        break;
      case 'message':
        this.tone(988, t, 0.09, { gain: 0.08, type: 'sine' });
        this.tone(1319, t + 0.06, 0.12, { gain: 0.07, type: 'sine' });
        break;
      case 'join':
        this.tone(587, t, 0.12, { gain: 0.1, type: 'triangle' });
        this.tone(880, t + 0.08, 0.2, { gain: 0.1, type: 'triangle' });
        break;
      case 'win': {
        const seq = [523, 659, 784, 659, 784, 1047];
        seq.forEach((f, i) => this.tone(f, t + i * 0.12, 0.32, { gain: 0.15, type: 'square', detune: 5 }));
        this.doum(t, 0.5);
        this.doum(t + 0.36, 0.5);
        this.tek(t + 0.48);
        this.tek(t + 0.6);
        this.doum(t + 0.72, 0.6);
        break;
      }
      case 'lose':
        [392, 370, 349, 330].forEach((f, i) => this.tone(f, t + i * 0.2, 0.35, { gain: 0.13, type: 'triangle' }));
        break;
    }
  }
}

export const sfx = new Sfx();
