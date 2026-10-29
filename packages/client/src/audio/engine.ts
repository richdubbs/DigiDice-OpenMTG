/**
 * The sound player (docs/design/sound.md): Web Audio in the browser. `play` starts a sound through its category's volume, the master volume and a
 * limiter, so a crowded moment (a board wipe) never clips. Frequent sounds pick a random variant and a slight detune so they never repeat exactly, and
 * a sound already playing several times at once is not stacked further.
 *
 * Rendering never happens on the page's thread at the moment a sound plays (Review 2026-10-26, Finding 21: renders of 25 ms on average, up to 213 ms,
 * stalled the animations). Every variant is made by a job: read back from this browser's store (pcmStore.ts, keyed by render.ts `soundCacheKey`), or
 * else rendered by the render worker (renderer.ts, render.worker.ts; without workers, on the page while it is idle) and then stored. Jobs run one at a
 * time: first the variants a `play` found missing (that play is skipped, or uses another variant that is ready; the next play has it), then the
 * `prerender` list in its order. The prerender list waits while the board animates (`data-fx-playing`, board/fx/Animator.ts).
 *
 * Browsers start audio only after a user gesture: the page calls `unlock()` from its first pointer or key press (`installSoundUnlock`); until then
 * nothing is heard. Without Web Audio (jsdom tests, old browsers) the engine stays silent but still tells its listeners what it would play, which is
 * how the tests check that each moment makes its sound.
 */
import type { SoundSettings } from '../settings/settings';
import { SOUND_IDS, SOUND_META, variantCount, type SoundCategory, type SoundId, type SoundMeta } from './catalog';
import type { Stereo } from './dsp';
import { indexedDbPcmStore, type PcmStore } from './pcmStore';
import { RENDER_RATE, soundCacheKey } from './render';
import { defaultRenderer, type SoundRenderer } from './renderer';

export { RENDER_RATE } from './render';

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
/** How often a prerender list paused by an animation looks again. */
const PAUSE_POLL_MS = 250;

/** Where the engine gets its sounds made and kept (tests pass fakes; the page uses the defaults). */
export interface SoundEngineDeps {
  /** Renders a missing sound (default: the render worker, else the page while idle). */
  renderer?: SoundRenderer;
  /** Keeps rendered sounds between sessions (default: IndexedDB; null keeps nothing). */
  store?: PcmStore | null;
  /** True while the prerender list should wait (default: the board is animating, `[data-fx-playing]`). */
  animating?: () => boolean;
}

function boardAnimating(): boolean {
  try {
    return typeof document !== 'undefined' && document.querySelector('[data-fx-playing]') !== null;
  } catch {
    return false;
  }
}

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
  /** Variants being made, or that could not be made (not asked for again). */
  private readonly jobs = new Map<string, 'queued' | 'running' | 'failed'>();
  /** Variants a play found missing: made before the prerender list. */
  private readonly urgent: [SoundId, number][] = [];
  private readonly queue: [SoundId, number][] = [];
  private running = false;
  private waiting: ReturnType<typeof setTimeout> | null = null;
  private pruned = false;
  private renderer: SoundRenderer | null;
  private store: PcmStore | null | undefined;
  private readonly animating: () => boolean;
  private plays = 0;

  constructor(
    private readonly settings: () => SoundSettings,
    private readonly random: () => number = Math.random,
    deps: SoundEngineDeps = {},
  ) {
    this.renderer = deps.renderer ?? null;
    this.store = deps.store;
    this.animating = deps.animating ?? boardAnimating;
  }

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
    const buffer = this.readyBuffer(id, this.pickVariant(id), a.ctx);
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

  /**
   * Make these sounds ahead of their first play, in this order, off the page's thread (stored copies first, else the render worker); the page lists
   * every sound at start (main.tsx) and the game screen its own as it opens. Sounds already made or on the list are not asked for again.
   */
  prerender(ids: readonly SoundId[]): void {
    // Nothing can be heard without Web Audio (tests, old browsers): rendering would only cost time.
    if (!audioContextCtor()) return;
    for (const id of ids) for (let v = 0; v < variantCount(id); v++) this.want(id, v, false);
    this.pump();
  }

  /** True when this variant is ready to play (tests). */
  isReady(id: SoundId, variant = 0): boolean {
    const key = `${id}#${variant}`;
    return this.buffers.has(key) || this.rendered.has(key);
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
    // Not made yet: asked for first, and started when it arrives (made()).
    const buffer = this.readyBuffer('ambient.grid', 0, a.ctx, false);
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

  /**
   * The buffer to play for this variant, never rendered here: when it is not made yet it is asked for (ahead of the prerender list) and another variant
   * that is ready plays instead (`others`), or nothing.
   */
  private readyBuffer(id: SoundId, variant: number, ctx: AudioContext, others = true): AudioBuffer | null {
    const buf = this.buffer(id, variant, ctx);
    if (buf) return buf;
    this.want(id, variant, true);
    this.pump();
    if (!others) return null;
    for (let v = 0; v < variantCount(id); v++) {
      if (v === variant) continue;
      const alt = this.buffer(id, v, ctx);
      if (alt) return alt;
    }
    return null;
  }

  /** Put a variant on the urgent or the prerender list, unless it is made, failed or already on its way (a prerendered one moves up when urgent). */
  private want(id: SoundId, variant: number, urgent: boolean): void {
    const key = `${id}#${variant}`;
    if (this.isReady(id, variant)) return;
    const state = this.jobs.get(key);
    if (state === 'running' || state === 'failed') return;
    if (state === 'queued') {
      if (!urgent) return;
      const i = this.queue.findIndex(([qid, qv]) => qid === id && qv === variant);
      if (i < 0) return;
      this.queue.splice(i, 1);
    }
    this.jobs.set(key, 'queued');
    (urgent ? this.urgent : this.queue).push([id, variant]);
  }

  private pcmStore(): PcmStore | null {
    if (this.store === undefined) this.store = indexedDbPcmStore();
    return this.store;
  }

  /** Runs the next job when none is running: urgent ones first; the prerender list waits while the board animates. */
  private pump(): void {
    if (this.running) return;
    let job = this.urgent.shift();
    if (!job && this.queue.length > 0) {
      if (this.animating()) {
        this.waiting ??= setTimeout(() => {
          this.waiting = null;
          this.pump();
        }, PAUSE_POLL_MS);
        return;
      }
      job = this.queue.shift();
    }
    if (!job) {
      this.prune();
      return;
    }
    this.running = true;
    const [id, variant] = job;
    const key = `${id}#${variant}`;
    this.jobs.set(key, 'running');
    void this.make(id, variant)
      .catch((e: unknown) => {
        console.error(`[sound] ${id} could not be made`, e);
        return null;
      })
      .then((st) => {
        this.running = false;
        if (st) {
          this.jobs.delete(key);
          this.rendered.set(key, st);
          this.made(id);
        } else this.jobs.set(key, 'failed');
        this.pump();
      });
  }

  /** One job: the stored copy, else a render (kept for the next session). */
  private async make(id: SoundId, variant: number): Promise<Stereo | null> {
    const store = this.pcmStore();
    const cacheKey = soundCacheKey(id, variant);
    const kept = store ? await store.get(cacheKey) : undefined;
    if (kept) return kept;
    this.renderer ??= defaultRenderer();
    const st = await this.renderer.render(id, variant);
    if (st && store) void store.put(cacheKey, st);
    return st;
  }

  /** A sound just became ready: the ambience starts if a screen is waiting for it. */
  private made(id: SoundId): void {
    if (id === 'ambient.grid' && this.ambienceUsers > 0) this.startLoop();
  }

  /** Once every list is done: stored sounds of keys no longer in use (another release, a changed recipe) are removed. */
  private prune(): void {
    if (this.pruned) return;
    const store = this.store;
    if (!store) return;
    this.pruned = true;
    const keep = new Set<string>();
    for (const id of SOUND_IDS) for (let v = 0; v < variantCount(id); v++) keep.add(soundCacheKey(id, v));
    void store.prune(keep);
  }

  private buffer(id: SoundId, variant: number, ctx: AudioContext): AudioBuffer | null {
    const key = `${id}#${variant}`;
    const cached = this.buffers.get(key);
    if (cached) return cached;
    const st = this.rendered.get(key);
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

/**
 * Every sound, in the order the page has them made (main.tsx): the interface first (the first screens), then the game's opening and turn
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
