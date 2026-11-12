/**
 * RUST SIGNAL — procedural audio on raw WebAudio (no external assets).
 * SFX: synthesized shots, explosions, pickups, radio beeps, boss metal.
 * MUSIC: dark synth-rock loop (kick/snare/hats + bassline + arp), built with a
 * lookahead scheduler. Everything is generated from oscillators & noise buffers.
 */

export type SfxName =
  | 'shot_pistol' | 'shot_mg' | 'shot_shotgun' | 'shot_laser' | 'rocket'
  | 'boom_small' | 'boom_big' | 'jump' | 'roll' | 'hurt' | 'pickup'
  | 'ui_move' | 'ui_start' | 'radio' | 'alarm' | 'metal' | 'signal' | 'boss_roar';

class SfxEngine {
  ctx!: AudioContext;
  master!: GainNode;
  sfxBus!: GainNode;
  musicBus!: GainNode;
  noiseBuf!: AudioBuffer;
  enabled = true;
  private lastAt: Partial<Record<SfxName, number>> = {};

  init() {
    if (this.ctx) return;
    const AC = (window.AudioContext || (window as any).webkitAudioContext);
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.9;
    this.sfxBus = this.ctx.createGain(); this.sfxBus.gain.value = 0.75;
    this.musicBus = this.ctx.createGain(); this.musicBus.gain.value = 0.34;
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.master.connect(this.ctx.destination);
    // 2s white-noise buffer reused by percussive sounds
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  resume() {
    this.init();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (on) this.resume();
  }

  private canPlay(name: SfxName, minGapMs: number) {
    const now = performance.now();
    const last = this.lastAt[name] ?? -1e9;
    if (now - last < minGapMs) return false;
    this.lastAt[name] = now;
    return true;
  }

  play(name: SfxName, vol = 1) {
    if (!this.enabled) return;
    this.resume();
    if (!this.ctx || this.ctx.state !== 'running') return;
    const gaps: Partial<Record<SfxName, number>> = { shot_mg: 30, boom_small: 60, alarm: 180, metal: 40 };
    if (!this.canPlay(name, gaps[name] ?? 18)) return;
    const c = this.ctx, t = c.currentTime;
    switch (name) {
      case 'shot_pistol': this.blip(t, 720, 180, 0.07, 'square', 0.5 * vol); this.hiss(t, 0.05, 0.18, 2600, vol); break;
      case 'shot_mg':     this.blip(t, 560, 140, 0.05, 'square', 0.34 * vol); this.hiss(t, 0.04, 0.14, 3000, vol * 0.8); break;
      case 'shot_shotgun':this.hiss(t, 0.16, 0.5, 1400, vol); this.blip(t, 240, 60, 0.14, 'sawtooth', 0.5 * vol); break;
      case 'shot_laser':  this.sweep(t, 1500, 300, 0.16, 'sawtooth', 0.35 * vol, 900); break;
      case 'rocket':      this.hiss(t, 0.5, 0.3, 800, vol); this.sweep(t, 120, 400, 0.5, 'triangle', 0.4 * vol, 300); break;
      case 'boom_small':  this.boom(t, 0.35, 0.7 * vol, 700); break;
      case 'boom_big':    this.boom(t, 0.8, 1.0 * vol, 480); this.blip(t, 90, 30, 0.5, 'sine', 0.8 * vol); break;
      case 'jump':        this.sweep(t, 220, 520, 0.12, 'square', 0.22 * vol, 1200); break;
      case 'roll':        this.hiss(t, 0.18, 0.25, 1800, vol); break;
      case 'hurt':        this.blip(t, 300, 70, 0.3, 'sawtooth', 0.5 * vol); this.boom(t, 0.3, 0.5, 500); break;
      case 'pickup':      this.note(t, 660, 0.09, 'square', 0.3 * vol); this.note(t + 0.09, 880, 0.09, 'square', 0.3 * vol); this.note(t + 0.18, 1320, 0.14, 'square', 0.3 * vol); break;
      case 'ui_move':     this.note(t, 440, 0.06, 'square', 0.22 * vol); break;
      case 'ui_start':    this.note(t, 523, 0.09, 'square', 0.3 * vol); this.note(t + 0.1, 784, 0.09, 'square', 0.3 * vol); this.note(t + 0.2, 1046, 0.2, 'square', 0.3 * vol); break;
      case 'radio':       this.blip(t, 1200, 1200, 0.05, 'square', 0.18 * vol); this.hiss(t + 0.06, 0.2, 0.12, 2000, vol * 0.5); break;
      case 'alarm':       this.sweep(t, 880, 620, 0.28, 'square', 0.2 * vol, 1400); break;
      case 'metal':       this.clank(t, 0.25 * vol); break;
      case 'signal':      this.sweep(t, 300, 1400, 0.5, 'sawtooth', 0.25 * vol, 600); this.sweep(t + 0.25, 1400, 300, 0.5, 'sawtooth', 0.2 * vol, 600); break;
      case 'boss_roar':   this.blip(t, 70, 40, 0.9, 'sawtooth', 0.7 * vol); this.hiss(t, 0.9, 0.5, 350, vol); this.clank(t + 0.1, 0.4 * vol); break;
    }
  }

  // --- primitives -----------------------------------------------------------
  private blip(t0: number, f0: number, f1: number, dur: number, type: OscillatorType, gain: number) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  private sweep(t0: number, f0: number, f1: number, dur: number, type: OscillatorType, gain: number, lpHz: number) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.linearRampToValueAtTime(f1, t0 + dur);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = lpHz;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(lp).connect(g).connect(this.sfxBus);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  private note(t0: number, freq: number, dur: number, type: OscillatorType, gain: number) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  private hiss(t0: number, dur: number, gain: number, lpHz: number, vol = 1) {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(lpHz, t0);
    lp.frequency.exponentialRampToValueAtTime(200, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain * vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    s.connect(lp).connect(g).connect(this.sfxBus);
    s.start(t0); s.stop(t0 + dur + 0.02);
  }

  private boom(t0: number, dur: number, gain: number, lpHz: number) {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(lpHz, t0);
    lp.frequency.exponentialRampToValueAtTime(80, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    s.connect(lp).connect(g).connect(this.sfxBus);
    s.start(t0); s.stop(t0 + dur + 0.05);
    // sub thump
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(110, t0);
    o.frequency.exponentialRampToValueAtTime(35, t0 + dur * 0.7);
    const og = c.createGain();
    og.gain.setValueAtTime(gain * 0.8, t0);
    og.gain.exponentialRampToValueAtTime(0.001, t0 + dur * 0.8);
    o.connect(og).connect(this.sfxBus);
    o.start(t0); o.stop(t0 + dur);
  }

  private clank(t0: number, gain: number) {
    const c = this.ctx;
    for (const [f, d] of [[310, 0.12], [830, 0.09], [1970, 0.06]] as [number, number][]) {
      const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(gain * (f > 1000 ? 0.25 : 0.4), t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + d);
      o.connect(g).connect(this.sfxBus);
      o.start(t0); o.stop(t0 + d + 0.02);
    }
    this.hiss(t0, 0.08, 0.2, 4000, gain);
  }
}

// --- music: dark synth-rock loop -------------------------------------------

type Track = 'menu' | 'level' | 'boss';

interface SongDef { bpm: number; bass: number[]; arp: number[]; drums: ('K' | 'S' | 'H')[][]; lead?: boolean; }

// MIDI note numbers. Am–F–C–G / Am–E progressions in minor for military mood.
const MENU_SONG: SongDef = {
  bpm: 112,
  bass: [45, 0, 45, 43, 41, 0, 41, 40, 36, 0, 36, 38, 43, 0, 43, 41],
  arp:  [69, 72, 76, 72, 65, 69, 72, 69, 60, 64, 67, 64, 67, 71, 74, 71],
  drums: [['K'], ['H'], ['S'], ['H'], ['K'], ['H'], ['S'], ['H', 'S']],
};
const LEVEL_SONG: SongDef = {
  bpm: 132,
  bass: [33, 33, 0, 33, 36, 0, 33, 31, 29, 29, 0, 29, 31, 0, 33, 0],
  arp:  [69, 72, 76, 79, 76, 72, 68, 72, 65, 69, 72, 74, 72, 69, 65, 0],
  drums: [['K'], ['H'], ['S'], ['H'], ['K', 'H'], ['H'], ['S'], ['H', 'S']],
  lead: true,
};
const BOSS_SONG: SongDef = {
  bpm: 150,
  bass: [33, 33, 33, 0, 32, 32, 0, 32, 29, 29, 29, 0, 28, 28, 31, 31],
  arp:  [81, 0, 79, 76, 0, 74, 76, 0, 77, 0, 74, 72, 0, 69, 72, 0],
  drums: [['K', 'K'], ['H'], ['S'], ['H', 'S'], ['K'], ['S'], ['S', 'S'], ['H', 'S']],
  lead: true,
};

class MusicEngine {
  private sfx: SfxEngine;
  private timer: number | null = null;
  private step = 0;
  private nextT = 0;
  current: Track | null = null;
  playing = false;

  constructor(sfx: SfxEngine) { this.sfx = sfx; }

  play(track: Track) {
    this.sfx.init();
    // switching tracks mid-playback: restart scheduling from step 0
    if (this.current !== track && this.timer !== null) {
      clearInterval(this.timer); this.timer = null; this.playing = false;
    }
    this.current = track;
    if (!this.sfx.enabled || this.sfx.ctx.state !== 'running') { this.playing = false; return; }
    if (this.playing && this.timer !== null) return; // already scheduled
    this.playing = true;
    this.step = 0;
    this.nextT = this.sfx.ctx.currentTime + 0.08;
    this.timer = window.setInterval(() => this.schedule(), 90);
  }

  stop() {
    this.playing = false;
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    this.current = null;
  }

  /** Mute/unmute without losing position. */
  setOn(on: boolean) {
    if (on && this.current) this.play(this.current);
    else if (!on) this.stop();
  }

  private schedule() {
    if (!this.playing || !this.current) return;
    const song = this.current === 'menu' ? MENU_SONG : this.current === 'level' ? LEVEL_SONG : BOSS_SONG;
    const stepDur = 60 / song.bpm / 4; // 16th notes
    const ahead = this.sfx.ctx.currentTime + 0.25;
    let guard = 0;
    while (this.nextT < ahead && guard++ < 64) {
      this.emitStep(song, this.step % 16, this.nextT);
      this.nextT += stepDur;
      this.step++;
    }
  }

  private midi(n: number) { return 440 * Math.pow(2, (n - 69) / 12); }

  private emitStep(song: SongDef, i: number, t: number) {
    const c = this.sfx.ctx, bus = this.sfx.musicBus;
    const kick = (time: number) => {
      const o = c.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(150, time); o.frequency.exponentialRampToValueAtTime(40, time + 0.1);
      const g = c.createGain(); g.gain.setValueAtTime(0.9, time); g.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
      o.connect(g).connect(bus); o.start(time); o.stop(time + 0.14);
    };
    const snare = (time: number) => {
      const s = c.createBufferSource(); s.buffer = (c as any)._rsNoise;
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200;
      const g = c.createGain(); g.gain.setValueAtTime(0.5, time); g.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
      s.connect(hp).connect(g).connect(bus); s.start(time); s.stop(time + 0.13);
    };
    const hat = (time: number) => {
      const s = c.createBufferSource(); s.buffer = (c as any)._rsNoise;
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
      const g = c.createGain(); g.gain.setValueAtTime(0.18, time); g.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
      s.connect(hp).connect(g).connect(bus); s.start(time); s.stop(time + 0.05);
    };
    const osc = (time: number, freq: number, dur: number, type: OscillatorType, gain: number, cutoff: number) => {
      const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(gain, time + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, time + dur);
      o.connect(lp).connect(g).connect(bus); o.start(time); o.stop(time + dur + 0.02);
    };

    // drums
    const pat = song.drums[i % 8];
    for (const el of pat) {
      if (el === 'K') kick(t);
      else if (el === 'S') snare(t);
      else hat(t);
    }
    // bass
    const b = song.bass[i];
    if (b > 0) osc(t, this.midi(b), 0.16, 'sawtooth', 0.34, 500);
    // arp (clean square through lowpass)
    const a = song.arp[i];
    if (a > 0) osc(t, this.midi(a), 0.11, 'square', 0.13, 2400);
    // lead: sparse octave melody on level/boss tracks
    if (song.lead && (i === 0 || i === 6 || i === 10) && a > 0) {
      osc(t, this.midi(a + 12), 0.3, 'triangle', 0.1, 3000);
    }
  }
}

// singleton -------------------------------------------------------------------
export const SFX = new SfxEngine();
// attach noise buffer to ctx lazily for the music engine (shares SfxEngine buffer)
const _origInit = SfxEngine.prototype.init;
SfxEngine.prototype.init = function () {
  _origInit.call(this);
  if (this.ctx && !(this.ctx as any)._rsNoise) (this.ctx as any)._rsNoise = this.noiseBuf;
};

export const MUSIC = new MusicEngine(SFX);

export function isAudioMuted(): boolean {
  try {
    return globalThis.localStorage?.getItem('rs_mute') === '1' || !SFX.enabled;
  } catch { return !SFX.enabled; }
}

export function setAudioMuted(muted: boolean): boolean {
  SFX.setEnabled(!muted);
  MUSIC.setOn(!muted);
  try { globalThis.localStorage?.setItem('rs_mute', muted ? '1' : '0'); } catch {}
  return muted;
}

export function toggleAudioMute(): boolean {
  return setAudioMuted(!isAudioMuted());
}

try {
  if (globalThis.localStorage?.getItem('rs_mute') === '1') {
    SFX.enabled = false;
  }
} catch {}

/** Call from any user gesture (click/keydown/touch) to unlock audio. */
export function unlockAudio() {
  if (isAudioMuted()) return;
  SFX.resume();
  if (MUSIC.current && !MUSIC.playing) MUSIC.play(MUSIC.current);
}
