// Процедурный звук (WebAudio): узнаваемые звуки задач (принтер, листы, печать,
// шкафчики, звонок), «бормотание» реплик, тревога и минимальный офисный гул.
import { settings, onSettings } from './settings.js';

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.listener = { x: 0, z: 0, yaw: 0 };
    this.lastFoot = 0;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain();
    this.master.connect(c.destination);
    this.fx = c.createGain(); this.fx.connect(this.master);
    this.voice = c.createGain(); this.voice.connect(this.master);
    this.amb = c.createGain(); this.amb.connect(this.master);
    this.applyVolumes();
    onSettings(() => this.applyVolumes());
    // Белый шум для синтеза
    const len = c.sampleRate * 1.5;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._startAmbient();
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = settings.volMaster;
    this.fx.gain.value = settings.volFx;
    this.voice.gain.value = settings.volVoice;
    this.amb.gain.value = settings.volAmbient * 0.6;
  }

  get ok() { return !!this.ctx && this.ctx.state === 'running'; }

  _startAmbient() {
    const c = this.ctx;
    // гул ламп дневного света
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 100;
    const f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 180;
    const g = c.createGain(); g.gain.value = 0.018;
    o.connect(f); f.connect(g); g.connect(this.amb);
    o.start();
    const n = c.createBufferSource();
    n.buffer = this.noiseBuf; n.loop = true;
    const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 400; nf.Q.value = 0.4;
    const ng = c.createGain(); ng.gain.value = 0.012;
    n.connect(nf); nf.connect(ng); ng.connect(this.amb);
    n.start();
    this.ambGain = g;
  }

  // Пространственная громкость/панорама относительно слушателя
  _spatial(x, z, maxD = 16) {
    if (x === undefined) return { gain: 1, pan: 0 };
    const dx = x - this.listener.x;
    const dz = z - this.listener.z;
    const d = Math.hypot(dx, dz);
    const gain = Math.max(0, 1 - d / maxD) ** 1.6;
    const ang = Math.atan2(dx, dz) - this.listener.yaw;
    const pan = Math.max(-1, Math.min(1, -Math.sin(ang) * 0.8));
    return { gain, pan };
  }

  _out(bus, x, z, maxD) {
    const c = this.ctx;
    const { gain, pan } = this._spatial(x, z, maxD);
    const g = c.createGain();
    g.gain.value = gain;
    if (c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      g.connect(p); p.connect(bus);
    } else g.connect(bus);
    return { node: g, gain };
  }

  _noise(dest, t0, dur, { type = 'bandpass', freq = 1000, q = 1, vol = 0.3, attack = 0.005 } = {}) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t0, Math.random() * 0.8);
    s.stop(t0 + dur + 0.05);
  }

  _tone(dest, t0, dur, { freq = 440, type = 'sine', vol = 0.2, slide = 0, attack = 0.005 } = {}) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g); g.connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  // Звук действия у объекта (наблюдаемость: TZ 9)
  play(kind, x, z) {
    if (!this.ok) return;
    const c = this.ctx;
    const out = this._out(this.fx, x, z);
    if (out.gain < 0.01) return;
    const d = out.node;
    const t = c.currentTime + 0.01;
    switch (kind) {
      case 'type':
        for (let i = 0; i < 10; i++) this._noise(d, t + i * 0.09 + Math.random() * 0.04, 0.04, { type: 'highpass', freq: 3000, vol: 0.25 });
        break;
      case 'rummage': case 'paper':
        for (let i = 0; i < 4; i++) this._noise(d, t + i * 0.22, 0.25, { freq: 2500, q: 0.6, vol: 0.18, attack: 0.08 });
        break;
      case 'press': case 'printer':
        this._tone(d, t, 1.2, { freq: 70, type: 'square', vol: 0.05, attack: 0.1 });
        for (let i = 0; i < 6; i++) this._noise(d, t + i * 0.18, 0.08, { freq: 900, vol: 0.2 });
        break;
      case 'stamp':
        this._tone(d, t, 0.18, { freq: 120, vol: 0.4, slide: 0.5 });
        this._noise(d, t, 0.1, { freq: 400, vol: 0.3 });
        break;
      case 'locker':
        for (const f of [420, 637, 911]) this._tone(d, t, 0.6, { freq: f, type: 'square', vol: 0.04 });
        this._noise(d, t, 0.2, { freq: 1500, vol: 0.25 });
        break;
      case 'coins':
        for (let i = 0; i < 5; i++) this._tone(d, t + i * 0.08, 0.2, { freq: 2200 + Math.random() * 900, vol: 0.06 });
        break;
      case 'phone':
        for (let i = 0; i < 2; i++) {
          this._tone(d, t + i * 0.5, 0.4, { freq: 440, type: 'square', vol: 0.05 });
          this._tone(d, t + i * 0.5, 0.4, { freq: 480, type: 'square', vol: 0.05 });
        }
        break;
      case 'stir': case 'pour': case 'pump': case 'lift':
        for (let i = 0; i < 5; i++) this._tone(d, t + i * 0.16, 0.12, { freq: 180 + Math.random() * 200, vol: 0.12, slide: 1.8 });
        this._noise(d, t, 0.8, { type: 'lowpass', freq: 600, vol: 0.12, attack: 0.1 });
        break;
      case 'wipe':
        for (let i = 0; i < 3; i++) this._tone(d, t + i * 0.2, 0.12, { freq: 1600, type: 'triangle', vol: 0.05, slide: 1.4 });
        break;
      case 'write': case 'read':
        for (let i = 0; i < 5; i++) this._noise(d, t + i * 0.13, 0.1, { freq: 4000, q: 2, vol: 0.1 });
        break;
      case 'coffee':
        this._tone(d, t, 1.0, { freq: 90, type: 'sawtooth', vol: 0.05, attack: 0.1 });
        this._noise(d, t + 0.3, 0.8, { type: 'lowpass', freq: 800, vol: 0.12, attack: 0.1 });
        break;
      case 'bell':
        for (const f of [880, 1320, 1760]) this._tone(d, t, 1.6, { freq: f, vol: 0.12 });
        for (const f of [880, 1320]) this._tone(d, t + 0.4, 1.4, { freq: f, vol: 0.1 });
        break;
      case 'alarm':
        for (let i = 0; i < 4; i++) this._tone(d, t + i * 0.5, 0.45, { freq: 600, type: 'sawtooth', vol: 0.07, slide: 1.6 });
        break;
      case 'lights_off':
        this._tone(d, t, 0.6, { freq: 220, type: 'sawtooth', vol: 0.12, slide: 0.2 });
        this._noise(d, t, 0.15, { freq: 300, vol: 0.4 });
        break;
      case 'explosion':
        this._noise(d, t, 1.6, { type: 'lowpass', freq: 400, vol: 0.9, attack: 0.01 });
        this._tone(d, t, 1.2, { freq: 60, vol: 0.5, slide: 0.4 });
        break;
      case 'step':
        this._noise(d, t, 0.06, { type: 'lowpass', freq: 300, vol: 0.12 });
        break;
      default:
        this._noise(d, t, 0.15, { freq: 1200, vol: 0.15 });
    }
  }

  // Интерфейс
  ui(kind) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + 0.005;
    const d = this.fx;
    switch (kind) {
      case 'click': this._tone(d, t, 0.05, { freq: 900, type: 'square', vol: 0.04 }); break;
      case 'good': [523, 659, 784].forEach((f, i) => this._tone(d, t + i * 0.07, 0.25, { freq: f, type: 'triangle', vol: 0.12 })); break;
      case 'bad': this._tone(d, t, 0.3, { freq: 140, type: 'sawtooth', vol: 0.12, slide: 0.7 }); break;
      case 'notice': this._tone(d, t, 0.12, { freq: 1200, type: 'triangle', vol: 0.08 }); this._tone(d, t + 0.1, 0.12, { freq: 1500, type: 'triangle', vol: 0.06 }); break;
      case 'alarm': this.play('alarm'); break;
      case 'sab': this._tone(d, t, 0.4, { freq: 300, type: 'sawtooth', vol: 0.08, slide: 0.5 }); break;
      case 'order': [392, 523, 392].forEach((f, i) => this._tone(d, t + i * 0.12, 0.2, { freq: f, type: 'square', vol: 0.05 })); break;
      case 'meeting': this.play('bell'); break;
      case 'type': this._noise(d, t, 0.03, { type: 'highpass', freq: 3000, vol: 0.2 }); break;
      default: this._tone(d, t, 0.08, { freq: 700, vol: 0.06 });
    }
  }

  // «Бормотание» вместо озвучки реплик
  mumble(text, { x, z, female = false, near = false } = {}) {
    if (!this.ok) return;
    const out = near ? this._out(this.voice, x, z, 12) : { node: this.voice, gain: 1 };
    if (out.gain < 0.02) return;
    const t0 = this.ctx.currentTime + 0.02;
    const n = Math.min(14, Math.ceil(text.length / 4));
    const base = female ? 300 : 170;
    for (let i = 0; i < n; i++) {
      this._tone(out.node, t0 + i * 0.075, 0.07, { freq: base * (0.85 + Math.random() * 0.5), type: 'square', vol: 0.035 });
    }
  }

  footstep(x, z) {
    if (!this.ok) return;
    const now = this.ctx.currentTime;
    if (now - this.lastFoot < 0.32) return;
    this.lastFoot = now;
    this.play('step', x, z);
  }
}

export const audio = new AudioEngine();
