/**
 * Sound synthesis building blocks (docs/design/sound.md). Every sound effect of the client is computed from a recipe (audio/sounds/*.ts) by these pure
 * functions, the same way in the browser (audio/engine.ts renders a sound the first time it is needed) and in Node (the tests, scripts/sound/render.ts).
 * No recorded samples and no Web Audio graph: a recipe's output is the same array of numbers everywhere, so what the tests and the sound report measure
 * is what the player hears.
 *
 * Signals are mono Float32Arrays at the context's sample rate; a sound's mix is a Stereo pair (see Mix). Times are in seconds, frequencies in Hz.
 */
import { loudness100 } from './analysis';

export interface Stereo {
  l: Float32Array;
  r: Float32Array;
}

export interface Ctx {
  readonly sr: number;
  /** Which variant of the sound (0 for the first): recipes vary details with it so a frequent sound does not repeat exactly. */
  readonly variant: number;
  /** Deterministic random numbers in [0, 1) for this sound and variant. */
  readonly rand: () => number;
}

/** A value that is constant or changes over time (seconds from the start of the signal it shapes). */
export type Param = number | ((t: number) => number);

const TAU = Math.PI * 2;

/** mulberry32: small, fast, good enough for noise and grain scatter. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A string's 32-bit FNV-1a hash (seeds a sound's random numbers from its id). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function makeCtx(sr: number, seed: number, variant = 0): Ctx {
  return { sr, variant, rand: rng((seed ^ Math.imul(variant + 1, 0x9e3779b1)) >>> 0) };
}

/** Number of samples in `dur` seconds (at least 1). */
export function len(ctx: Ctx, dur: number): number {
  return Math.max(1, Math.round(dur * ctx.sr));
}

function at(p: Param, sr: number): (i: number) => number {
  if (typeof p === 'number') return () => p;
  return (i) => p(i / sr);
}

/**
 * A filter's state decaying toward zero ends up in denormal numbers, which the CPU computes 10-100 times slower (a filter running through a silent
 * tail then costs more than through the sound itself). Recursive states below this are set to exactly zero.
 */
const TINY = 1e-25;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

// ---- parameter curves ----------------------------------------------------------------------------------------------------------

/** From `a` to `b` over `dur` (then holds `b`); 'exp' glides evenly in pitch (use it for frequencies), 'lin' evenly in value. */
export function glide(a: number, b: number, dur: number, curve: 'exp' | 'lin' = 'exp', delay = 0): (t: number) => number {
  return (t) => {
    const x = clamp((t - delay) / Math.max(1e-6, dur), 0, 1);
    if (curve === 'lin' || a <= 0 || b <= 0) return a + (b - a) * x;
    return a * (b / a) ** x;
  };
}

/** Steps through `values`, `step` seconds each (holds the last): quantized pitch runs, arpeggios. */
export function steps(values: readonly number[], step: number): (t: number) => number {
  return (t) => values[clamp(Math.floor(t / step), 0, values.length - 1)]!;
}

/** `base` with a vibrato of `cents` at `rate` Hz. */
export function vibrato(base: Param, rate: number, cents: number): (t: number) => number {
  const b = typeof base === 'number' ? () => base : base;
  return (t) => b(t) * 2 ** ((cents / 1200) * Math.sin(TAU * rate * t));
}

// ---- oscillators ---------------------------------------------------------------------------------------------------------------

export type Wave = 'sine' | 'triangle' | 'saw' | 'square' | 'pulse';

function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/**
 * A band-limited oscillator (PolyBLEP saw and pulse). `pw` is the pulse width (0..1) of 'pulse', which is centred on zero (no DC) at any width.
 * `phase` (0..1) defaults to the wave's zero crossing.
 */
export function osc(ctx: Ctx, wave: Wave, freq: Param, dur: number, opts: { phase?: number; pw?: Param } = {}): Float32Array {
  const n = len(ctx, dur);
  const out = new Float32Array(n);
  const f = at(freq, ctx.sr);
  const pw = at(opts.pw ?? 0.5, ctx.sr);
  // By default every wave starts at a zero crossing (sine 0, triangle 0.25, saw 0.5): a note that starts on a step clicks and rings the room.
  let ph = opts.phase ?? (wave === 'triangle' ? 0.25 : wave === 'saw' ? 0.5 : 0);
  for (let i = 0; i < n; i++) {
    const hz = f(i);
    const dt = Math.min(0.5, Math.abs(hz) / ctx.sr);
    let v: number;
    switch (wave) {
      case 'sine':
        v = Math.sin(TAU * ph);
        break;
      case 'triangle':
        v = 1 - 4 * Math.abs(ph - 0.5);
        break;
      case 'saw':
        v = 2 * ph - 1 - polyBlep(ph, dt);
        break;
      default: {
        const w = wave === 'square' ? 0.5 : clamp(pw(i), 0.02, 0.98);
        // Centred: an uneven pulse sits off zero by 2w - 1, which under an envelope would turn into a low thump.
        v = (ph < w ? 1 : -1) + polyBlep(ph, dt) - polyBlep((ph - w + 1) % 1, dt) - (2 * w - 1);
      }
    }
    out[i] = v;
    ph += hz / ctx.sr;
    ph -= Math.floor(ph);
  }
  return out;
}

/**
 * Two-operator FM: a sine carrier at `freq` whose phase is modulated by a sine at `freq * ratio` (or `modFreq`) with `index` (radians). Integer ratios
 * sound harmonic (bright buzzes, brass), others metallic or bell-like. `feedback` (0..1) roughens the modulator toward a saw.
 */
export function fm(ctx: Ctx, freq: Param, dur: number, opts: { ratio?: number; modFreq?: Param; index?: Param; feedback?: number } = {}): Float32Array {
  const n = len(ctx, dur);
  const out = new Float32Array(n);
  const f = at(freq, ctx.sr);
  const mf = opts.modFreq !== undefined ? at(opts.modFreq, ctx.sr) : null;
  const ratio = opts.ratio ?? 1;
  const idx = at(opts.index ?? 1, ctx.sr);
  const fb = opts.feedback ?? 0;
  let pc = 0;
  let pm = 0;
  let last = 0;
  for (let i = 0; i < n; i++) {
    const hz = f(i);
    const m = Math.sin(TAU * pm + fb * last);
    last = m;
    out[i] = Math.sin(TAU * pc + idx(i) * m);
    pc += hz / ctx.sr;
    pc -= Math.floor(pc);
    pm += (mf ? mf(i) : hz * ratio) / ctx.sr;
    pm -= Math.floor(pm);
  }
  return out;
}

/** Noise: white (flat), pink (-3 dB/octave, softer) or brown (-6 dB/octave, rumble). Peak about 1. */
export function noise(ctx: Ctx, dur: number, color: 'white' | 'pink' | 'brown' = 'white'): Float32Array {
  const n = len(ctx, dur);
  const out = new Float32Array(n);
  const r = ctx.rand;
  if (color === 'white') {
    for (let i = 0; i < n; i++) out[i] = r() * 2 - 1;
    return out;
  }
  if (color === 'pink') {
    // Paul Kellet's economy pink filter.
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = r() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      out[i] = (b0 + b1 + b2 + w * 0.1848) * 0.25;
    }
    return out;
  }
  let y = 0;
  for (let i = 0; i < n; i++) {
    y = (y + 0.02 * (r() * 2 - 1)) / 1.02;
    out[i] = y * 3.5;
  }
  return out;
}

/**
 * A struck resonator (modal synthesis): decaying sines at `freq * ratios[k]`, each falling 60 dB in `decays[k]` seconds with level `gains[k]`. Crystal,
 * glass, bells, metal plates, without any noise; cheap and very clean.
 */
export function modes(ctx: Ctx, freq: number, dur: number, ratios: readonly number[], decays: readonly number[], gains: readonly number[] = []): Float32Array {
  const n = len(ctx, dur);
  const out = new Float32Array(n);
  ratios.forEach((ratio, k) => {
    const hz = freq * ratio;
    if (hz >= ctx.sr * 0.45) return;
    const g = gains[k] ?? 1 / (k + 1);
    const d = decays[k] ?? decays[decays.length - 1] ?? 0.5;
    // Recursive oscillator: y[i] = 2cos(w) y[i-1] - y[i-2], times a per-sample decay factor.
    const w = (TAU * hz) / ctx.sr;
    const fall = Math.exp(Math.log(0.001) / (d * ctx.sr));
    const c = 2 * Math.cos(w) * fall;
    const f2 = fall * fall;
    let y1 = Math.sin(-w) * g / fall;
    let y2 = Math.sin(-2 * w) * g / f2;
    for (let i = 0; i < n; i++) {
      let y = c * y1 - f2 * y2;
      if (y < TINY && y > -TINY) y = 0;
      out[i] = out[i]! + y;
      y2 = y1;
      y1 = y;
    }
  });
  return out;
}

/**
 * Karplus-Strong plucked string: a digital pluck at `freq` that rings for about `decay` seconds (`bright` 0..1: how sharp the attack is). Tuned exactly:
 * the loop is the delay line (N samples) + the two-point average (half a sample) + a first-order all-pass for the fraction left over.
 */
export function pluck(ctx: Ctx, freq: number, dur: number, opts: { decay?: number; bright?: number } = {}): Float32Array {
  const n = len(ctx, dur);
  const out = new Float32Array(n);
  const period = ctx.sr / freq;
  const N = Math.max(2, Math.floor(period - 0.6));
  const frac = period - N - 0.5;
  const C = (1 - frac) / (1 + frac);
  const buf = new Float32Array(N);
  const bright = clamp(opts.bright ?? 0.7, 0.05, 1);
  // The excitation: a triangle (a string pulled at one point: a strong fundamental) roughened by low-passed noise (brighter with `bright`).
  let prev = 0;
  let mean = 0;
  for (let i = 0; i < N; i++) {
    prev = prev + bright * (ctx.rand() * 2 - 1 - prev);
    const shape = 1 - 4 * Math.abs(i / N - 0.5);
    buf[i] = shape * (1 - 0.5 * bright) + prev * bright * 0.6;
    mean += buf[i]! / N;
  }
  for (let i = 0; i < N; i++) buf[i] = buf[i]! - mean;
  const loss = 0.001 ** (1 / Math.max(1, (opts.decay ?? 1) * freq));
  let k = 0;
  let last = 0;
  let apIn = 0;
  let apOut = 0;
  for (let i = 0; i < n; i++) {
    const y = buf[k]!;
    out[i] = y;
    const avg = 0.5 * (y + last);
    last = y;
    let ap = C * avg + apIn - C * apOut;
    if (ap < TINY && ap > -TINY) ap = 0;
    apIn = avg;
    apOut = ap;
    buf[k] = ap * loss;
    k = (k + 1) % N;
  }
  return out;
}

// ---- envelopes -------------------------------------------------------------------------------------------------------------------

/**
 * Breakpoint envelope: points [time, level] from time 0 (the level before the first point is the first level, after the last it holds). 'exp' moves
 * between points evenly in decibels (natural decays and swells; a 0 level counts as -100 dB), 'lin' evenly in value.
 */
export function env(ctx: Ctx, points: readonly (readonly [number, number])[], dur?: number, curve: 'lin' | 'exp' = 'lin'): Float32Array {
  const last = points[points.length - 1];
  const total = dur ?? (last ? last[0] : 0);
  const n = len(ctx, total);
  const out = new Float32Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = i / ctx.sr;
    while (k < points.length - 1 && t >= points[k + 1]![0]) k++;
    const p0 = points[k]!;
    const p1 = points[k + 1];
    if (!p1 || t < p0[0]) {
      out[i] = t < p0[0] ? points[0]![1] : p0[1];
      continue;
    }
    const x = (t - p0[0]) / Math.max(1e-9, p1[0] - p0[0]);
    if (curve === 'lin') out[i] = p0[1] + (p1[1] - p0[1]) * x;
    else {
      const a = Math.max(1e-5, p0[1]);
      const b = Math.max(1e-5, p1[1]);
      const v = a * (b / a) ** x;
      out[i] = v <= 1.0001e-5 ? 0 : v;
    }
  }
  return out;
}

/** Percussive envelope: rises in `attack`, then falls 60 dB in `decay` (exponentially). */
export function perc(ctx: Ctx, attack: number, decay: number, dur?: number): Float32Array {
  const n = len(ctx, dur ?? attack + decay);
  const out = new Float32Array(n);
  const a = Math.max(1, Math.round(attack * ctx.sr));
  const k = Math.log(0.001) / Math.max(1, decay * ctx.sr);
  for (let i = 0; i < n; i++) out[i] = i < a ? i / a : Math.exp(k * (i - a));
  return out;
}

/** Attack (linear), decay to `sustain`, hold until `gate`, release (decay and release fall evenly in dB; the release reaches -60 dB in `r`). */
export function adsr(ctx: Ctx, a: number, d: number, sustain: number, gate: number, r: number): Float32Array {
  const A = Math.max(1, a * ctx.sr);
  const D = Math.max(1, d * ctx.sr);
  const G = Math.max(A + D, gate * ctx.sr);
  const R = Math.max(1, r * ctx.sr);
  const s = clamp(sustain, 1e-4, 1);
  const out = new Float32Array(Math.ceil(G + R));
  for (let i = 0; i < out.length; i++) {
    if (i < A) out[i] = i / A;
    else if (i < A + D) out[i] = s ** ((i - A) / D);
    else if (i < G) out[i] = s;
    else out[i] = s * 0.001 ** ((i - G) / R);
  }
  return out;
}

// ---- operations on signals -------------------------------------------------------------------------------------------------------

/** a * b, sample by sample (in place on `a`); a shorter `b` holds its last value, a number is a constant gain. */
export function mul(a: Float32Array, b: Float32Array | number): Float32Array {
  if (typeof b === 'number') {
    for (let i = 0; i < a.length; i++) a[i] = a[i]! * b;
    return a;
  }
  const lastB = b.length > 0 ? b[b.length - 1]! : 0;
  for (let i = 0; i < a.length; i++) a[i] = a[i]! * (i < b.length ? b[i]! : lastB);
  return a;
}

/** Adds `src * g` into `dst` from sample `offset` (in place on `dst`, clipped to its length). */
export function addInto(dst: Float32Array, src: Float32Array, offset = 0, g = 1): Float32Array {
  const start = Math.max(0, offset);
  const end = Math.min(dst.length, offset + src.length);
  for (let i = start; i < end; i++) dst[i] = dst[i]! + (src[i - offset]! * g);
  return dst;
}

/** Sum of signals (as long as the longest). */
export function sum(...xs: Float32Array[]): Float32Array {
  const out = new Float32Array(Math.max(1, ...xs.map((x) => x.length)));
  for (const x of xs) addInto(out, x);
  return out;
}

/** `x` padded (or cut) to `dur` seconds. */
export function fit(ctx: Ctx, x: Float32Array, dur: number): Float32Array {
  const out = new Float32Array(len(ctx, dur));
  out.set(x.subarray(0, out.length));
  return out;
}

export function reverse(x: Float32Array): Float32Array {
  return x.slice().reverse();
}

/** Plays `x` at a varying speed (1 = as is, 0.5 = an octave down and twice as long): tape stops, power-downs, pitch dives. */
export function varispeed(ctx: Ctx, x: Float32Array, rate: Param, dur: number): Float32Array {
  const n = len(ctx, dur);
  const out = new Float32Array(n);
  const r = at(rate, ctx.sr);
  let pos = 0;
  for (let i = 0; i < n; i++) {
    const p = Math.floor(pos);
    if (p >= x.length - 1) break;
    const f = pos - p;
    out[i] = x[p]! * (1 - f) + x[p + 1]! * f;
    pos += Math.max(0, r(i));
  }
  return out;
}

// ---- filters ------------------------------------------------------------------------------------------------------------------

export type FilterMode = 'lp' | 'hp' | 'bp' | 'notch' | 'peak';

/**
 * State-variable filter (Zavalishin's TPT form: stays stable and smooth while its cutoff moves every sample). `q` 0.5 is soft, 0.707 flat, 5+ rings.
 * 'bp' has unity gain at the cutoff.
 */
export function svf(ctx: Ctx, x: Float32Array, mode: FilterMode, cutoff: Param, q: Param = 0.707): Float32Array {
  const out = new Float32Array(x.length);
  const fc = at(cutoff, ctx.sr);
  const qq = at(q, ctx.sr);
  const nyq = ctx.sr * 0.49;
  let ic1 = 0;
  let ic2 = 0;
  const constant = typeof cutoff === 'number' && typeof q === 'number';
  let g = Math.tan((Math.PI * clamp(fc(0), 5, nyq)) / ctx.sr);
  let k = 1 / Math.max(0.05, qq(0));
  for (let i = 0; i < x.length; i++) {
    if (!constant) {
      g = Math.tan((Math.PI * clamp(fc(i), 5, nyq)) / ctx.sr);
      k = 1 / Math.max(0.05, qq(i));
    }
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v0 = x[i]!;
    const v3 = v0 - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    if (ic1 < TINY && ic1 > -TINY) ic1 = 0;
    if (ic2 < TINY && ic2 > -TINY) ic2 = 0;
    switch (mode) {
      case 'lp':
        out[i] = v2;
        break;
      case 'hp':
        out[i] = v0 - k * v1 - v2;
        break;
      case 'bp':
        out[i] = k * v1;
        break;
      case 'notch':
        out[i] = v0 - k * v1;
        break;
      default:
        out[i] = v2 - (v0 - k * v1 - v2);
    }
  }
  return out;
}

export function lp(ctx: Ctx, x: Float32Array, cutoff: Param, q: Param = 0.707): Float32Array {
  return svf(ctx, x, 'lp', cutoff, q);
}
export function hp(ctx: Ctx, x: Float32Array, cutoff: Param, q: Param = 0.707): Float32Array {
  return svf(ctx, x, 'hp', cutoff, q);
}
export function bp(ctx: Ctx, x: Float32Array, cutoff: Param, q: Param = 1): Float32Array {
  return svf(ctx, x, 'bp', cutoff, q);
}

/** Static biquad (RBJ cookbook) for equalizing: peaking bell or shelves. */
export function eq(ctx: Ctx, x: Float32Array, type: 'peak' | 'lowshelf' | 'highshelf', freq: number, gainDb: number, q = 0.707): Float32Array {
  const A = 10 ** (gainDb / 40);
  const w = (TAU * clamp(freq, 5, ctx.sr * 0.49)) / ctx.sr;
  const cw = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (type === 'peak') {
    b0 = 1 + alpha * A;
    b1 = -2 * cw;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a1 = -2 * cw;
    a2 = 1 - alpha / A;
  } else {
    const sq = 2 * Math.sqrt(A) * alpha;
    const s = type === 'lowshelf' ? 1 : -1;
    b0 = A * (A + 1 - s * (A - 1) * cw + sq);
    b1 = 2 * s * A * (A - 1 - s * (A + 1) * cw);
    b2 = A * (A + 1 - s * (A - 1) * cw - sq);
    a0 = A + 1 + s * (A - 1) * cw + sq;
    a1 = -2 * s * (A - 1 + s * (A + 1) * cw);
    a2 = A + 1 + s * (A - 1) * cw - sq;
  }
  return biquad(x, b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
}

export function biquad(x: Float32Array, b0: number, b1: number, b2: number, a1: number, a2: number): Float32Array {
  const out = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i]!;
    let y = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    if (y < TINY && y > -TINY) y = 0;
    out[i] = y;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y;
  }
  return out;
}

/** Removes any constant offset (a 10 Hz high-pass). */
export function dcBlock(x: Float32Array, sr: number): Float32Array {
  const out = new Float32Array(x.length);
  const R = 1 - (TAU * 10) / sr;
  let x1 = 0;
  let y1 = 0;
  for (let i = 0; i < x.length; i++) {
    let y = x[i]! - x1 + R * y1;
    if (y < TINY && y > -TINY) y = 0;
    x1 = x[i]!;
    y1 = y;
    out[i] = y;
  }
  return out;
}

// ---- effects --------------------------------------------------------------------------------------------------------------------

/** Soft saturation (tanh), level kept about the same: `amount` 1 is warm, 4+ is fuzz. In place. */
export function drive(x: Float32Array, amount: number): Float32Array {
  if (amount <= 0) return x;
  const norm = 1 / Math.tanh(amount);
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(amount * x[i]!) * norm;
  return x;
}

/** Wavefolder: folds peaks back down, a hard digital edge (amount 1..6). In place. */
export function fold(x: Float32Array, amount: number): Float32Array {
  for (let i = 0; i < x.length; i++) x[i] = Math.sin((Math.PI / 2) * amount * x[i]!) / Math.max(1, amount * 0.5);
  return x;
}

/**
 * Bit crusher: `bits` of resolution (16 is clean, 4 is gritty) and sample-and-hold of `hold` samples (1 is clean, 8+ is lo-fi aliasing). Both may
 * change over time: a sound that disintegrates into digital grit. Returns a new signal.
 */
export function crush(ctx: Ctx, x: Float32Array, bits: Param, hold: Param = 1): Float32Array {
  const out = new Float32Array(x.length);
  const b = at(bits, ctx.sr);
  const h = at(hold, ctx.sr);
  let held = 0;
  let acc = 1;
  for (let i = 0; i < x.length; i++) {
    acc += 1;
    const hs = Math.max(1, h(i));
    if (acc >= hs) {
      acc -= hs;
      held = x[i]!;
    }
    const levels = 2 ** (clamp(b(i), 1, 24) - 1);
    out[i] = Math.round(held * levels) / levels;
  }
  return out;
}

/** Ring modulation by a sine at `freq` (`mix` 1 = fully modulated). Returns a new signal. */
export function ring(ctx: Ctx, x: Float32Array, freq: Param, mix = 1): Float32Array {
  const m = osc(ctx, 'sine', freq, x.length / ctx.sr);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i]! * (1 - mix + mix * (m[i] ?? 0));
  return out;
}

function readFrac(buf: Float32Array, pos: number): number {
  const size = buf.length;
  const p = ((pos % size) + size) % size;
  const i0 = Math.floor(p);
  const f = p - i0;
  return buf[i0]! * (1 - f) + buf[(i0 + 1) % size]! * f;
}

/**
 * Flanger / chorus: a short delay swept by a slow sine and mixed with the dry signal. Flanger: base 0.001-0.004 s, feedback 0.5-0.8 (a jet sweep);
 * chorus: base 0.012-0.025 s, no feedback (width, shimmer). Returns a new signal.
 */
export function flange(ctx: Ctx, x: Float32Array, opts: { rate: number; depth: number; base: number; feedback?: number; mix?: number }): Float32Array {
  const size = Math.ceil((opts.base + opts.depth) * ctx.sr) + 4;
  const buf = new Float32Array(size);
  const out = new Float32Array(x.length);
  const fb = clamp(opts.feedback ?? 0, -0.95, 0.95);
  const mix = opts.mix ?? 0.5;
  let w = 0;
  let last = 0;
  for (let i = 0; i < x.length; i++) {
    const d = (opts.base + opts.depth * 0.5 * (1 - Math.cos((TAU * opts.rate * i) / ctx.sr))) * ctx.sr;
    buf[w] = x[i]! + fb * last;
    const y = readFrac(buf, w - d);
    last = y;
    out[i] = x[i]! * (1 - mix) + y * mix;
    w = (w + 1) % size;
  }
  return out;
}

/** A comb filter tuned to `freq` (a resonant metallic tone out of noise or clicks); feedback 0.8-0.98. Returns a new signal. */
export function comb(ctx: Ctx, x: Float32Array, freq: Param, feedback: number, damp = 0.2): Float32Array {
  const f = at(freq, ctx.sr);
  const size = Math.ceil(ctx.sr / 20) + 4;
  const buf = new Float32Array(size);
  const out = new Float32Array(x.length);
  let w = 0;
  let lpState = 0;
  for (let i = 0; i < x.length; i++) {
    const d = ctx.sr / clamp(f(i), 20, ctx.sr / 4);
    const y = readFrac(buf, w - d);
    lpState = y + damp * (lpState - y);
    if (lpState < TINY && lpState > -TINY) lpState = 0;
    buf[w] = x[i]! + feedback * lpState;
    out[i] = y;
    w = (w + 1) % size;
  }
  return out;
}

export interface EchoOpts {
  /** Seconds between repeats. */
  time: number;
  feedback: number;
  /** Level of the echoes (the dry signal stays). */
  mix: number;
  /** Each repeat is darker: low-pass in the loop (Hz). */
  damp?: number;
  /** Repeats bounce left-right. */
  pingpong?: boolean;
}

/** Echo (delay with feedback), stereo; ping-pong bounces the repeats between the sides. Returns new arrays, same length as the input. */
export function echo(ctx: Ctx, st: Stereo, o: EchoOpts): Stereo {
  const d = Math.max(1, Math.round(o.time * ctx.sr));
  const n = st.l.length;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  const bl = new Float32Array(d);
  const br = new Float32Array(d);
  const a = 1 - Math.exp((-TAU * (o.damp ?? 6000)) / ctx.sr);
  let zl = 0;
  let zr = 0;
  let w = 0;
  const fb = clamp(o.feedback, 0, 0.95);
  for (let i = 0; i < n; i++) {
    const yl = bl[w]!;
    const yr = br[w]!;
    zl += a * (yl - zl);
    zr += a * (yr - zr);
    if (zl < TINY && zl > -TINY) zl = 0;
    if (zr < TINY && zr > -TINY) zr = 0;
    if (o.pingpong) {
      bl[w] = (st.l[i]! + st.r[i]!) * 0.5 + fb * zr;
      br[w] = fb * zl;
    } else {
      bl[w] = st.l[i]! + fb * zl;
      br[w] = st.r[i]! + fb * zr;
    }
    l[i] = st.l[i]! + o.mix * yl;
    r[i] = st.r[i]! + o.mix * yr;
    w = (w + 1) % d;
  }
  return { l, r };
}

export interface SpaceOpts {
  /** Seconds for the tail to fall 60 dB (RT60). */
  decay: number;
  /** Room size: scales the delay lines (0.3 tiny ... 2 huge). */
  size: number;
  /** Highs fade faster above this frequency (Hz). */
  damp: number;
  /** Seconds before the tail starts. */
  predelay: number;
  /** Lows under this frequency (Hz) are kept out of the tail (no mud). */
  lowCut: number;
  /** 0..1: how smeared the onset of the tail is. */
  diffusion: number;
}

const FDN_MS = [29.7, 37.1, 41.1, 43.7, 53.9, 61.3, 67.1, 79.3];
const DIFFUSER_MS = [4.7, 3.6, 12.7, 9.3];

/**
 * A digital room (8-line feedback delay network with input diffusion and slowly modulated lines): returns the wet tail only, in stereo. The client's
 * sounds share three such rooms (palette.ts SPACE) so they all sit in one place.
 */
export function reverb(ctx: Ctx, st: Stereo, o: SpaceOpts): Stereo {
  const sr = ctx.sr;
  const n = st.l.length;
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  // Input: low cut, predelay, diffusion (series all-passes).
  let inL = hp(ctx, st.l, o.lowCut, 0.6);
  let inR = hp(ctx, st.r, o.lowCut, 0.6);
  const pre = Math.round(o.predelay * sr);
  const diff = clamp(o.diffusion, 0, 0.85);
  for (const [k, ms] of DIFFUSER_MS.entries()) {
    const d = Math.max(1, Math.round((ms * sr) / 1000));
    inL = allpass(inL, d, diff * (k % 2 ? -1 : 1));
    inR = allpass(inR, Math.max(1, d + 7), diff * (k % 2 ? -1 : 1));
  }
  const lines = Int32Array.from(FDN_MS, (ms) => Math.max(8, Math.round((ms * o.size * sr) / 1000)));
  const bufs = Array.from(lines, (d) => new Float32Array(d + 16));
  const sizes = Int32Array.from(bufs, (b) => b.length);
  const pos = new Int32Array(8);
  const gains = Float64Array.from(lines, (d) => 10 ** ((-3 * d) / (Math.max(0.05, o.decay) * sr)));
  const da = 1 - Math.exp((-TAU * o.damp) / sr);
  const lpState = new Float64Array(8);
  const v = new Float64Array(8);
  // Two lines are slowly modulated (against metallic ringing); the rest read whole samples (the same values the fractional read would give).
  const w1 = (TAU * (0.31 + 1 * 0.07)) / sr;
  const w6 = (TAU * (0.31 + 6 * 0.07)) / sr;
  for (let i = 0; i < n; i++) {
    const src = i - pre;
    const xl = src >= 0 ? inL[src]! : 0;
    const xr = src >= 0 ? inR[src]! : 0;
    for (let k = 0; k < 8; k++) {
      const buf = bufs[k]!;
      const size = sizes[k]!;
      let y: number;
      if (k === 1 || k === 6) y = readFrac(buf, pos[k]! - lines[k]! + 6 * Math.sin((k === 1 ? w1 : w6) * i) + size);
      else {
        let r = pos[k]! - lines[k]!;
        if (r < 0) r += size;
        y = buf[r]!;
      }
      let z = lpState[k]! + da * (y - lpState[k]!);
      if (z < TINY && z > -TINY) z = 0;
      lpState[k] = z;
      v[k] = z * gains[k]!;
    }
    outL[i] = (v[0]! + v[2]! + v[4]! + v[6]!) * 0.5;
    outR[i] = (v[1]! + v[3]! + v[5]! + v[7]!) * 0.5;
    // Fast Hadamard transform (orthogonal mixing, energy preserving), then inject the input.
    for (let h = 1; h < 8; h <<= 1) {
      for (let a = 0; a < 8; a += h << 1) {
        for (let b = a; b < a + h; b++) {
          const p = v[b]!;
          const q = v[b + h]!;
          v[b] = p + q;
          v[b + h] = p - q;
        }
      }
    }
    for (let k = 0; k < 8; k++) {
      const buf = bufs[k]!;
      const at = pos[k]!;
      buf[at] = v[k]! * 0.35355339 + (k % 2 ? xr : xl) * 0.5;
      pos[k] = at + 1 === sizes[k]! ? 0 : at + 1;
    }
  }
  return { l: outL, r: outR };
}

function allpass(x: Float32Array, d: number, g: number): Float32Array {
  const out = new Float32Array(x.length);
  const buf = new Float32Array(d);
  let w = 0;
  for (let i = 0; i < x.length; i++) {
    const delayed = buf[w]!;
    let input = x[i]! + g * delayed;
    if (input < TINY && input > -TINY) input = 0;
    out[i] = delayed - g * input;
    buf[w] = input;
    w = (w + 1) % d;
  }
  return out;
}

/** Compressor (peak-sensing, stereo-linked): tames a sound's transients so it can be louder without clipping. Returns new arrays. */
export function compress(ctx: Ctx, st: Stereo, o: { threshold: number; ratio: number; attack?: number; release?: number; knee?: number }): Stereo {
  const n = st.l.length;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  const att = Math.exp(-1 / Math.max(1, (o.attack ?? 0.002) * ctx.sr));
  const rel = Math.exp(-1 / Math.max(1, (o.release ?? 0.08) * ctx.sr));
  const knee = o.knee ?? 6;
  let envDb = -120;
  for (let i = 0; i < n; i++) {
    const peak = Math.max(Math.abs(st.l[i]!), Math.abs(st.r[i]!));
    const db = 20 * Math.log10(peak + 1e-9);
    envDb = db > envDb ? att * envDb + (1 - att) * db : rel * envDb + (1 - rel) * db;
    const over = envDb - o.threshold;
    let cut = 0;
    if (over > knee / 2) cut = over * (1 - 1 / o.ratio);
    else if (over > -knee / 2) cut = ((over + knee / 2) ** 2 / (2 * knee)) * (1 - 1 / o.ratio);
    const g = dbToGain(-cut);
    l[i] = st.l[i]! * g;
    r[i] = st.r[i]! * g;
  }
  return { l, r };
}

// ---- mixing -----------------------------------------------------------------------------------------------------------------------

/** Equal-power pan: -1 left, 0 centre, 1 right. */
export function panGains(pan: number): [number, number] {
  const p = (clamp(pan, -1, 1) + 1) * 0.25 * Math.PI;
  return [Math.cos(p) * Math.SQRT2, Math.sin(p) * Math.SQRT2];
}

export interface AddOpts {
  /** Seconds from the start of the mix. */
  at?: number;
  gain?: number;
  /** -1 left .. 1 right. */
  pan?: number;
  /** How much of it goes into the room (0..1) besides the dry signal. */
  send?: number;
}

/**
 * A sound's mix: a dry stereo bus and a send bus into one room (reverb). `out` adds the room's tail to the dry signal; the result is what `master`
 * then levels.
 */
export class Mix {
  readonly dry: Stereo;
  readonly send: Stereo;

  constructor(
    private readonly ctx: Ctx,
    dur: number,
  ) {
    const n = len(ctx, dur);
    this.dry = { l: new Float32Array(n), r: new Float32Array(n) };
    this.send = { l: new Float32Array(n), r: new Float32Array(n) };
  }

  get length(): number {
    return this.dry.l.length;
  }

  add(sig: Float32Array, o: AddOpts = {}): this {
    const off = Math.round((o.at ?? 0) * this.ctx.sr);
    const g = o.gain ?? 1;
    const [gl, gr] = panGains(o.pan ?? 0);
    addInto(this.dry.l, sig, off, g * gl);
    addInto(this.dry.r, sig, off, g * gr);
    if (o.send) {
      addInto(this.send.l, sig, off, g * gl * o.send);
      addInto(this.send.r, sig, off, g * gr * o.send);
    }
    return this;
  }

  addStereo(st: Stereo, o: Omit<AddOpts, 'pan'> = {}): this {
    const off = Math.round((o.at ?? 0) * this.ctx.sr);
    const g = o.gain ?? 1;
    addInto(this.dry.l, st.l, off, g);
    addInto(this.dry.r, st.r, off, g);
    if (o.send) {
      addInto(this.send.l, st.l, off, g * o.send);
      addInto(this.send.r, st.r, off, g * o.send);
    }
    return this;
  }

  /**
   * The finished mix: dry + room(send). An echo on 'send' (the default) adds the repeats of the send bus to the dry signal and lets the room hear them
   * too; on 'all' it repeats the dry signal.
   */
  out(o: { space?: SpaceOpts; echo?: EchoOpts & { on?: 'send' | 'all' } } = {}): Stereo {
    let l: Float32Array = this.dry.l.slice();
    let r: Float32Array = this.dry.r.slice();
    let send: Stereo = this.send;
    if (o.echo) {
      if (o.echo.on === 'all') {
        const e = echo(this.ctx, { l, r }, o.echo);
        l = e.l;
        r = e.r;
      } else {
        const e = echo(this.ctx, send, o.echo);
        for (let i = 0; i < l.length; i++) {
          l[i] = l[i]! + (e.l[i]! - send.l[i]!);
          r[i] = r[i]! + (e.r[i]! - send.r[i]!);
        }
        send = e;
      }
    }
    if (o.space) {
      const wet = reverb(this.ctx, send, o.space);
      addInto(l, wet.l);
      addInto(r, wet.r);
    }
    return { l, r };
  }
}

/** A mono signal as a centred stereo pair. */
export function mono(x: Float32Array): Stereo {
  return { l: x, r: x.slice() };
}

// ---- mastering ----------------------------------------------------------------------------------------------------------------------

export interface MasterOpts {
  /** Target loudness (LUFS over the loudest 100 ms, K-weighted: analysis.ts loudness100). */
  lufs: number;
  /** The peak never goes above this (dBFS); when the target would exceed it, the sound is left quieter. */
  peakDb?: number;
  /** Fade at the very end (seconds), so a cut tail never clicks; by default 6 ms, or up to 50 ms when a tail is still ringing at the end. */
  fadeOut?: number;
  /** A seamless loop: nothing is trimmed or faded, only levelled. */
  loop?: boolean;
}

/**
 * Levels a finished mix: removes DC, trims the silent end, fades the edges (no clicks), and sets its loudness to `lufs` within the peak limit. Every
 * sound goes through this (catalog.ts), so recipes never worry about absolute levels and the set stays balanced.
 */
export function master(ctx: Ctx, st: Stereo, o: MasterOpts): Stereo {
  let l: Float32Array = o.loop ? st.l.slice() : dcBlock(st.l, ctx.sr);
  let r: Float32Array = o.loop ? st.r.slice() : dcBlock(st.r, ctx.sr);
  let peak = 1e-9;
  if (o.loop) return levelled(ctx, l, r, o);
  // Trim the end below -80 dB of the peak (keeps every audible tail).
  for (let i = 0; i < l.length; i++) peak = Math.max(peak, Math.abs(l[i]!), Math.abs(r[i]!));
  const floor = peak * dbToGain(-80);
  let end = l.length;
  while (end > 1 && Math.abs(l[end - 1]!) < floor && Math.abs(r[end - 1]!) < floor) end--;
  end = Math.min(l.length, end + Math.round(0.002 * ctx.sr));
  l = l.slice(0, end);
  r = r.slice(0, end);
  const fadeIn = Math.min(l.length, Math.round(0.0005 * ctx.sr));
  for (let i = 0; i < fadeIn; i++) {
    l[i] = l[i]! * (i / fadeIn);
    r[i] = r[i]! * (i / fadeIn);
  }
  // A tail still ringing where the sound's length cuts it (a room or an echo) fades over up to 50 ms instead of stopping; a finished sound gets 6 ms.
  const lastN = Math.min(l.length, Math.round(0.01 * ctx.sr));
  let tail = 0;
  for (let i = l.length - lastN; i < l.length; i++) tail = Math.max(tail, Math.abs(l[i]!), Math.abs(r[i]!));
  const cut = tail > peak * dbToGain(-55);
  const fo = Math.min(l.length, Math.round((o.fadeOut ?? (cut ? Math.min(0.05, 0.3 * (l.length / ctx.sr)) : 0.006)) * ctx.sr));
  for (let i = 0; i < fo; i++) {
    const g = (i / fo) ** 2;
    l[l.length - 1 - i] = l[l.length - 1 - i]! * g;
    r[r.length - 1 - i] = r[r.length - 1 - i]! * g;
  }
  return levelled(ctx, l, r, o);
}

function levelled(ctx: Ctx, l: Float32Array, r: Float32Array, o: MasterOpts): Stereo {
  const loud = loudness100({ l, r }, ctx.sr);
  let peak = 1e-9;
  for (let i = 0; i < l.length; i++) peak = Math.max(peak, Math.abs(l[i]!), Math.abs(r[i]!));
  const toTarget = Number.isFinite(loud) ? dbToGain(o.lufs - loud) : 1;
  const toPeak = dbToGain(o.peakDb ?? -1) / peak;
  const g = Math.min(toTarget, toPeak);
  for (let i = 0; i < l.length; i++) {
    l[i] = l[i]! * g;
    r[i] = r[i]! * g;
  }
  return { l, r };
}
