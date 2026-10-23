/**
 * The sound player (docs/design/sound.md): Web Audio in the browser. A sound is rendered (catalog.renderSound, always at 48 kHz) the first time it is
 * needed, or ahead of time with `prerender`, and kept; `play` starts it through its category's volume, the master volume and a limiter, so a crowded
 * moment (a board wipe) never clips. Frequent sounds pick a random variant and a slight detune so they never repeat exactly, and a sound already
 * playing several times at once is not stacked further.
 *
 * Browsers start audio only after a user gesture: the page calls `unlock()` from its first pointer or key press (`installSoundUnlock`); until then
 * nothing is heard. Without Web Audio (jsdom tests, old browsers) the engine stays silent but still tells its listeners what it would play, which is
 * how the tests check that each moment makes its sound.
 */
import type { SoundSettings } from '../settings/settings';
import { renderSound, SOUND_META, variantCount, type SoundCategory, type SoundId, type SoundMeta } from './catalog';
import type { Stereo } from './dsp';

/** The rate every sound is rendered at; the browser resamples to the device's rate on playback. */
export const RENDER_RATE = 48000;

export interface PlayOpts {
  /** -1 left .. 1 right (where it happens on the table). */
  pan?: number;
  /** Extra gain, 0..1.5 (e.g. a hit's damage, the later shatters of a board wipe). */
  gain?: number;
  /** Start this many seconds from now (staggered mana, draws, shatters). */
  delay?: number;
  /** Playback rate (1 = as designed). Frequent sounds get a small random detune when this is not given. */
  rate?: number;
  /** Swap left and right: a sound that moves left to right then moves right to left (Back plays the screen change mirrored). */
  mirror?: boolean;
  /** Start this many seconds into the sound (its accent then comes sooner: a faster animation). */
  offset?: number;
}

/** What the client plays sounds through: the engine, or a recorder in tests. */
export interface SoundPlayer {
  play(id: SoundId, opts?: PlayOpts): void;
}

export type SoundListener = (id: SoundId, opts: PlayOpts) => void;

const MAX_VOICES: Record<SoundMeta['frequency'], number> = { 'very frequent': 4, 'per turn': 4, 'per game': 2, rare: 2, constant: 1 };
/** Two starts of the same sound closer than this are one sound (a burst of identical events). */
const MIN_GAP_S = 0.025;
const MAX_TOTAL_VOICES = 32;

interface AudioParts {
  ctx: AudioContext;
  master: GainNode;
  buses: Record<SoundCategory, GainNode>;
}

type AudioContextCtor = new (opts?: AudioContextOptions) => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Slider position (0..1) -> gain: a squared taper, so the slider feels even to the ear. */
export function volumeGain(v: number): number {
  const x = Math.min(1, Math.max(0, v));
  return x * x;
}

export class SoundEngine implements SoundPlayer {
  private audio: AudioParts | null = null;
  private readonly rendered = new Map<string, Stereo>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly lastVariant = new Map<SoundId, number>();
  private readonly lastStart = new Map<SoundId, number>();
  private readonly voices = new Map<SoundId, number>();
  private total = 0;
  private readonly listeners = new Set<SoundListener>();
  private ambience: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private ambienceUsers = 0;
  private queue: SoundId[] = [];
  private pumping = false;
  private plays = 0;

  constructor(
    private readonly settings: () => SoundSettings,
    private readonly random: () => number = Math.random,
  ) {}

  /** How many sounds were asked for so far (heard or not): the page's click listener uses it to see whether a handler already made a sound. */
  get playCount(): number {
    return this.plays;
  }

  /** True once audio can be heard (Web Audio exists and a user gesture unlocked it). */
  get ready(): boolean {
    return this.audio !== null && this.audio.ctx.state === 'running';
  }

  /** Call from a user gesture: creates or resumes the audio context. Safe to call often. */
  unlock(): void {
    const Ctor = audioContextCtor();
    if (!Ctor) return;
    try {
      if (!this.audio) {
        const ctx = new Ctor({ latencyHint: 'interactive' });
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -8;
        limiter.knee.value = 6;
        limiter.ratio.value = 12;
        limiter.attack.value = 0.002;
        limiter.release.value = 0.12;
        const master = ctx.createGain();
        master.connect(limiter).connect(ctx.destination);
        const bus = () => {
          const g = ctx.createGain();
          g.connect(master);
          return g;
        };
        this.audio = { ctx, master, buses: { interface: bus(), game: bus(), ambience: bus() } };
        this.applySettings();
        if (this.ambienceUsers > 0) this.startLoop();
      }
      if (this.audio.ctx.state === 'suspended') void this.audio.ctx.resume().catch(() => undefined);
    } catch {
      this.audio = null;
    }
  }

  /** Re-read the volumes (call when the settings change). */
  applySettings(): void {
    const a = this.audio;
    if (!a) return;
    const s = this.settings();
    const now = a.ctx.currentTime;
    a.master.gain.setTargetAtTime(s.enabled ? volumeGain(s.master) : 0, now, 0.02);
    a.buses.interface.gain.setTargetAtTime(volumeGain(s.interface), now, 0.02);
    a.buses.game.gain.setTargetAtTime(volumeGain(s.game), now, 0.02);
    a.buses.ambience.gain.setTargetAtTime(volumeGain(s.ambience), now, 0.02);
  }

  subscribe(listener: SoundListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  play(id: SoundId, opts: PlayOpts = {}): void {
    const meta = SOUND_META[id] as SoundMeta | undefined;
    if (!meta) return;
    this.plays++;
    for (const l of [...this.listeners]) l(id, opts);
    const s = this.settings();
    if (!s.enabled || s.master <= 0 || s[meta.category] <= 0) return;
    const a = this.audio;
    if (!a || a.ctx.state !== 'running') return;
    const when = a.ctx.currentTime + Math.max(0, opts.delay ?? 0);
    const last = this.lastStart.get(id);
    if (last !== undefined && Math.abs(when - last) < MIN_GAP_S) return;
    const active = this.voices.get(id) ?? 0;
    if (active >= MAX_VOICES[meta.frequency] || this.total >= MAX_TOTAL_VOICES) return;
    const variant = this.pickVariant(id);
    const buffer = this.buffer(id, variant, a.ctx);
    if (!buffer) return;
    this.lastStart.set(id, when);
    const src = a.ctx.createBufferSource();
    src.buffer = buffer;
    const detune = meta.frequency === 'very frequent' ? 1 + (this.random() * 2 - 1) * 0.015 : 1;
    src.playbackRate.value = opts.rate ?? detune;
    const gain = a.ctx.createGain();
    // The same sound already ringing: each new copy a little softer, so a burst does not pile up.
    gain.gain.value = Math.min(1.5, Math.max(0, opts.gain ?? 1)) * 0.85 ** active;
    let node: AudioNode = src.connect(gain);
    if (opts.mirror) {
      const split = a.ctx.createChannelSplitter(2);
      const merge = a.ctx.createChannelMerger(2);
      node.connect(split);
      split.connect(merge, 0, 1);
      split.connect(merge, 1, 0);
      node = merge;
    }
    if (opts.pan && typeof a.ctx.createStereoPanner === 'function') {
      const panner = a.ctx.createStereoPanner();
      panner.pan.value = Math.min(1, Math.max(-1, opts.pan));
      node = node.connect(panner);
    }
    node.connect(a.buses[meta.category]);
    this.voices.set(id, active + 1);
    this.total++;
    src.onended = () => {
      this.voices.set(id, Math.max(0, (this.voices.get(id) ?? 1) - 1));
      this.total = Math.max(0, this.total - 1);
      try {
        src.disconnect();
        gain.disconnect();
      } catch {
        /* already gone */
      }
    };
    src.start(when, Math.min(Math.max(0, opts.offset ?? 0), Math.max(0, buffer.duration - 0.01)));
  }

  /** Render these sounds now, one per idle moment, so their first play does not have to (the game screen calls it as it opens). */
  prerender(ids: readonly SoundId[]): void {
    // Nothing can be heard without Web Audio (tests, old browsers): rendering would only cost time.
    if (!audioContextCtor()) return;
    for (const id of ids) if (!this.queue.includes(id)) this.queue.push(id);
    if (this.pumping) return;
    this.pumping = true;
    const step = () => {
      const id = this.queue.shift();
      if (!id) {
        this.pumping = false;
        return;
      }
      for (let v = 0; v < variantCount(id); v++) if (!this.buffers.has(`${id}#${v}`)) this.stereo(id, v);
      later(step);
    };
    later(step);
  }

  /** The table ambience (a loop) plays while at least one screen wants it. Returns the release. */
  holdAmbience(): () => void {
    this.ambienceUsers++;
    if (this.ambienceUsers === 1) this.startLoop();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.ambienceUsers = Math.max(0, this.ambienceUsers - 1);
      if (this.ambienceUsers === 0) this.stopLoop();
    };
  }

  private startLoop(): void {
    const a = this.audio;
    if (!a || this.ambience) return;
    const buffer = this.buffer('ambient.grid', 0, a.ctx);
    if (!buffer) return;
    const src = a.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const gain = a.ctx.createGain();
    gain.gain.setValueAtTime(0, a.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(1, a.ctx.currentTime + 1.5);
    src.connect(gain).connect(a.buses.ambience);
    src.start();
    this.ambience = { src, gain };
  }

  private stopLoop(): void {
    const a = this.audio;
    const amb = this.ambience;
    if (!a || !amb) return;
    this.ambience = null;
    const now = a.ctx.currentTime;
    amb.gain.gain.cancelScheduledValues(now);
    amb.gain.gain.setValueAtTime(amb.gain.gain.value, now);
    amb.gain.gain.linearRampToValueAtTime(0, now + 0.8);
    amb.src.stop(now + 0.85);
  }

  private pickVariant(id: SoundId): number {
    const n = variantCount(id);
    if (n <= 1) return 0;
    const last = this.lastVariant.get(id) ?? -1;
    let v = Math.floor(this.random() * n);
    if (v === last) v = (v + 1) % n;
    this.lastVariant.set(id, v);
    return v;
  }

  private stereo(id: SoundId, variant: number): Stereo | null {
    const key = `${id}#${variant}`;
    let st = this.rendered.get(key);
    if (!st) {
      try {
        st = renderSound(id, RENDER_RATE, variant);
      } catch (e) {
        console.error(`[sound] ${id} failed to render`, e);
        return null;
      }
      this.rendered.set(key, st);
    }
    return st;
  }

  private buffer(id: SoundId, variant: number, ctx: AudioContext): AudioBuffer | null {
    const key = `${id}#${variant}`;
    const cached = this.buffers.get(key);
    if (cached) return cached;
    const st = this.stereo(id, variant);
    if (!st) return null;
    try {
      const buf = ctx.createBuffer(2, st.l.length, RENDER_RATE);
      buf.copyToChannel(st.l as Float32Array<ArrayBuffer>, 0);
      buf.copyToChannel(st.r as Float32Array<ArrayBuffer>, 1);
      this.buffers.set(key, buf);
      // The audio buffer holds its own copy now.
      this.rendered.delete(key);
      return buf;
    } catch {
      return null;
    }
  }
}

function later(fn: () => void): void {
  const w = typeof window !== 'undefined' ? (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }) : null;
  if (w?.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 500 });
  else setTimeout(fn, 16);
}

/**
 * Every sound, in the order the page renders them while idle (main.tsx): the interface first (the first screens), then the game's opening and turn
 * cues, the rest of the game, and the ambience last.
 */
export function prerenderOrder(): SoundId[] {
  const first: SoundId[] = ['game.start', 'turn.mine', 'turn.theirs', 'priority.mine', 'priority.pass', 'turn.step', 'card.draw', 'card.land'];
  const game = soundsOf('game').filter((id) => !first.includes(id));
  return [...soundsOf('interface'), ...first, ...game, ...soundsOf('ambience')];
}

/** Every sound of a category (to prerender what a screen will need). */
export function soundsOf(category: SoundCategory): SoundId[] {
  return (Object.keys(SOUND_META) as SoundId[]).filter((id) => (SOUND_META[id] as SoundMeta).category === category);
}

/** Starts the audio on the page's first pointer or key press (browser autoplay rules), and again whenever the browser suspended it. */
export function installSoundUnlock(engine: SoundEngine, target: EventTarget = typeof document !== 'undefined' ? document : new EventTarget()): () => void {
  const unlock = () => engine.unlock();
  const opts = { capture: true, passive: true } as const;
  target.addEventListener('pointerdown', unlock, opts);
  target.addEventListener('keydown', unlock, opts);
  return () => {
    target.removeEventListener('pointerdown', unlock, opts);
    target.removeEventListener('keydown', unlock, opts);
  };
}
