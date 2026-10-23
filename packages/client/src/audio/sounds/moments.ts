/**
 * Big moments and the online link (docs/design/sound.md "Game flow"): the final blow, victory, defeat and draw, day and night, the
 * monarch, the online connection cues and the table ambience. The end screens and the ambience use the `arena` room and slow pads.
 *
 * These are long, layered sounds, so they are rendered in two layers to stay inside the render budget: the body (pads, brass, bass, the rooms and
 * echoes, nothing above about 10 kHz) is computed at half the sample rate and up-sampled, the glitter (crystal partials, shimmer, noise ticks) at
 * the full rate. The ambience, all under 3 kHz, is computed at a quarter of the rate.
 */
import type { Recipe, SoundId } from '../catalog';
import {
  addInto,
  bp,
  clamp,
  compress,
  crush,
  drive,
  echo,
  env,
  fm,
  glide,
  hp,
  len,
  lp,
  Mix,
  mul,
  noise,
  osc,
  panGains,
  perc,
  reverb,
  varispeed,
  type Ctx,
  type EchoOpts,
  type Param,
  type SpaceOpts,
  type Stereo,
  type Wave,
} from '../dsp';
import { arp, blip, clang, crystal, D_MAJOR, hz, scan, scaleNoteBetween, shimmer, SPACE, thump, tick, voxels } from '../palette';

// ---- rendering at a lower rate --------------------------------------------------------------------------------------------------

/** The same context at 1/`factor` of the sample rate (same random stream): for layers with nothing above its Nyquist. */
function slow(ctx: Ctx, factor: number): Ctx {
  return { sr: ctx.sr / factor, variant: ctx.variant, rand: ctx.rand };
}

/** Up-samples by an integer `factor` (4-point Hermite) to `n` samples; `circular` wraps around the ends (a loop). */
function upsample(x: Float32Array, factor: number, n: number, circular = false): Float32Array {
  const out = new Float32Array(n);
  const N = x.length;
  // Hermite weights of the four neighbours for each output phase.
  const w = Array.from({ length: factor }, (_, p) => {
    const t = p / factor;
    return [(-t * t * t + 2 * t * t - t) / 2, (3 * t * t * t - 5 * t * t + 2) / 2, (-3 * t * t * t + 4 * t * t + t) / 2, (t * t * t - t * t) / 2] as const;
  });
  const get = (i: number) => (circular ? x[((i % N) + N) % N]! : i < 0 || i >= N ? 0 : x[i]!);
  for (let i = 0; i < N; i++) {
    const inside = i >= 1 && i + 2 < N;
    const xm = inside ? x[i - 1]! : get(i - 1);
    const x0 = x[i]!;
    const x1 = inside ? x[i + 1]! : get(i + 1);
    const x2 = inside ? x[i + 2]! : get(i + 2);
    const base = i * factor;
    for (let p = 0; p < factor && base + p < n; p++) {
      const c = w[p]!;
      out[base + p] = c[0] * xm + c[1] * x0 + c[2] * x1 + c[3] * x2;
    }
  }
  return out;
}

/**
 * Halves the rate of a signal at `ctx`'s rate (anti-alias low-pass, then a 1-2-1 decimation) to `n` samples. Only the part up to its last audible
 * sample is filtered: a filter ringing down into silence turns denormal and becomes very slow.
 */
function decimate(ctx: Ctx, x: Float32Array, n: number): Float32Array {
  let end = x.length;
  while (end > 0 && Math.abs(x[end - 1]!) < 1e-9) end--;
  const out = new Float32Array(n);
  if (end === 0) return out;
  const f = lp(ctx, x.subarray(0, Math.min(x.length, end + Math.round(0.01 * ctx.sr))), ctx.sr * 0.19, 0.6);
  for (let j = 0; j < n; j++) {
    const i = 2 * j;
    out[j] = 0.25 * (f[i - 1] ?? 0) + 0.5 * (f[i] ?? 0) + 0.25 * (f[i + 1] ?? 0);
  }
  return out;
}

/** One of the shared rooms (dsp.reverb) on a send bus at `ctx`'s rate, computed at half that rate when `half` (for dark, long tails). */
function room(ctx: Ctx, send: Stereo, space: SpaceOpts, half: boolean): Stereo {
  if (!half) return reverb(ctx, send, space);
  const n = send.l.length;
  const m = Math.ceil(n / 2);
  const w = reverb(slow(ctx, 2), { l: decimate(ctx, send.l, m), r: decimate(ctx, send.r, m) }, space);
  return { l: upsample(w.l, 2, n), r: upsample(w.r, 2, n) };
}

/**
 * A two-layer mix: `lo` (context `lc`, half the rate) for the body, `hi` (full rate) for the glitter. `out` sends both into one room and one echo
 * (run at the low rate: the rooms are dark above 6 kHz anyway; `quarter` runs the room at a quarter of the rate) and returns the full-rate result.
 */
class Stage {
  readonly lc: Ctx;
  readonly lo: Mix;
  readonly hi: Mix;

  constructor(
    readonly ctx: Ctx,
    dur: number,
  ) {
    this.lc = slow(ctx, 2);
    this.lo = new Mix(this.lc, dur);
    this.hi = new Mix(ctx, dur);
  }

  out(o: { space?: SpaceOpts; echo?: EchoOpts; quarter?: boolean } = {}): Stereo {
    const n = this.lo.length;
    const dl = this.lo.dry.l.slice();
    const dr = this.lo.dry.r.slice();
    let send: Stereo = { l: this.lo.send.l.slice(), r: this.lo.send.r.slice() };
    addInto(send.l, decimate(this.ctx, this.hi.send.l, n));
    addInto(send.r, decimate(this.ctx, this.hi.send.r, n));
    if (o.echo) {
      const e = echo(this.lc, send, o.echo);
      for (let i = 0; i < n; i++) {
        dl[i] = dl[i]! + e.l[i]! - send.l[i]!;
        dr[i] = dr[i]! + e.r[i]! - send.r[i]!;
      }
      send = e;
    }
    if (o.space) {
      const wet = room(this.lc, send, o.space, o.quarter ?? false);
      addInto(dl, wet.l);
      addInto(dr, wet.r);
    }
    const N = this.hi.length;
    const l = upsample(dl, 2, N);
    const r = upsample(dr, 2, N);
    addInto(l, this.hi.dry.l);
    addInto(r, this.hi.dry.r);
    return { l, r };
  }
}

// ---- private helpers ------------------------------------------------------------------------------------------------------------

/** A state-variable filter whose moving cutoff is updated every 16 samples (the same TPT form as dsp.svf, a tenth of the cost for sweeps). */
function sweep(ctx: Ctx, x: Float32Array, mode: 'lp' | 'bp', cutoff: Param, q = 0.707): Float32Array {
  if (typeof cutoff === 'number') return mode === 'lp' ? lp(ctx, x, cutoff, q) : bp(ctx, x, cutoff, q);
  const out = new Float32Array(x.length);
  const k = 1 / Math.max(0.05, q);
  const nyq = ctx.sr * 0.49;
  let ic1 = 0;
  let ic2 = 0;
  let a1 = 0;
  let a2 = 0;
  let a3 = 0;
  for (let i = 0; i < x.length; i++) {
    if ((i & 15) === 0) {
      const g = Math.tan((Math.PI * clamp(cutoff(i / ctx.sr), 5, nyq)) / ctx.sr);
      a1 = 1 / (1 + g * (g + k));
      a2 = g * a1;
      a3 = g * a2;
    }
    const v3 = x[i]! - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    // Flush the state before it decays into (very slow) denormal numbers.
    if (ic1 < 1e-20 && ic1 > -1e-20) ic1 = 0;
    if (ic2 < 1e-20 && ic2 > -1e-20) ic2 = 0;
    out[i] = mode === 'lp' ? v2 : k * v1;
  }
  return out;
}

/** Detuned unison voices on every note of `notes`, spread across the stereo field (summed straight into two buses). */
function voices(ctx: Ctx, wave: Wave, notes: readonly number[], dur: number, o: { voices?: number; cents?: number; width?: number; gain?: number } = {}): Stereo {
  const n = len(ctx, dur);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  const v = Math.max(1, o.voices ?? 3);
  const g = (o.gain ?? 1) / Math.sqrt(v * notes.length);
  for (const f of notes) {
    for (let k = 0; k < v; k++) {
      const x = v === 1 ? 0 : (k / (v - 1)) * 2 - 1;
      const s = osc(ctx, wave, f * 2 ** ((x * (o.cents ?? 10)) / 1200), dur, { phase: ctx.rand() });
      const [gl, gr] = panGains(x * (o.width ?? 0.8));
      addInto(l, s, 0, g * gl);
      addInto(r, s, 0, g * gr);
    }
  }
  return { l, r };
}

/** A stereo pair through the same (moving) low-pass and envelope. */
function shape(ctx: Ctx, st: Stereo, cutoff: Param, q: number, e: Float32Array): Stereo {
  return { l: mul(sweep(ctx, st.l, 'lp', cutoff, q), e), r: mul(sweep(ctx, st.r, 'lp', cutoff, q), e) };
}

/**
 * Tron brass (the palette's `stab`, on the fast filter): unison saws on `notes` through a low-pass that opens from `from` to `peak` in `open` seconds
 * and closes to `to` (or follows `cutoff`), under a punchy envelope (or the envelope `points`).
 */
function brass(
  ctx: Ctx,
  notes: readonly number[],
  dur: number,
  o: { from: number; peak: number; to: number; open?: number; cutoff?: Param; q?: number; voices?: number; cents?: number; points?: readonly (readonly [number, number])[] },
): Stereo {
  const st = voices(ctx, 'saw', notes, dur, { voices: o.voices ?? 3, cents: o.cents ?? 10 });
  const open = o.open ?? 0.03;
  const curve = (t: number) => (t < open ? o.from * (o.peak / o.from) ** (t / open) : o.peak * (o.to / o.peak) ** Math.min(1, (t - open) / Math.max(0.01, dur - open)));
  const e = env(ctx, o.points ?? [[0, 0], [0.004, 1], [dur * 0.6, 0.5], [dur, 0]], dur, 'exp');
  return shape(ctx, st, o.cutoff ?? curve, o.q ?? 1.1, e);
}

/** A sustained synth chord (unison triangles for body, detuned saws for edge) through a low-pass that may move, under the envelope `points`. */
function pad(
  ctx: Ctx,
  notes: readonly number[],
  dur: number,
  o: { cutoff: Param; points: readonly (readonly [number, number])[]; saw?: number; q?: number; cents?: number },
): Stereo {
  const tri = voices(ctx, 'triangle', notes, dur, { voices: 2, cents: o.cents ?? 8, gain: 0.7 });
  const saw = voices(ctx, 'saw', notes, dur, { voices: 1, gain: o.saw ?? 0.25 });
  addInto(tri.l, saw.l);
  addInto(tri.r, saw.r);
  return shape(ctx, tri, o.cutoff, o.q ?? 0.7, env(ctx, o.points, dur, 'lin'));
}

/** A mono signal moving across the stereo field along `pan(t)` (-1 left .. 1 right). */
function panned(ctx: Ctx, x: Float32Array, pan: (t: number) => number): Stereo {
  const l = new Float32Array(x.length);
  const r = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const [gl, gr] = panGains(pan(i / ctx.sr));
    l[i] = x[i]! * gl;
    r[i] = x[i]! * gr;
  }
  return { l, r };
}

/** Points of a piecewise exponential curve as a function of time (filter sweeps with several moves). */
function path(points: readonly (readonly [number, number])[]): (t: number) => number {
  return (t) => {
    if (t <= points[0]![0]) return points[0]![1];
    for (let k = 1; k < points.length; k++) {
      const [t1, v1] = points[k]!;
      if (t < t1) {
        const [t0, v0] = points[k - 1]!;
        return v0 * (v1 / v0) ** ((t - t0) / (t1 - t0));
      }
    }
    return points[points.length - 1]![1];
  };
}

/** The palette's whoosh (noise through a swept band-pass, swelling to its peak) on the fast filter. */
function swish(ctx: Ctx, o: { dur: number; from: number; to: number; q: number; peak: number; color?: 'white' | 'pink' }): Float32Array {
  const s = sweep(ctx, noise(ctx, o.dur, o.color ?? 'pink'), 'bp', glide(o.from, o.to, o.dur), o.q);
  return mul(s, env(ctx, [[0, 0], [o.dur * o.peak, 1], [o.dur, 0]], o.dur, 'lin'));
}

/** An FM bell (index falling). Ratio 1.5 puts its partials on D major (1, 0.5, 2.5, 4 times the note): a consonant, regal chime. */
function bell(ctx: Ctx, freq: number, dur: number, o: { ratio?: number; index?: number } = {}): Float32Array {
  const s = fm(ctx, freq, dur, { ratio: o.ratio ?? 1.5, index: glide(o.index ?? 2.2, 0.2, dur * 0.6) });
  return mul(s, perc(ctx, 0.0015, dur, dur));
}

/** A soft sine "ping" with an optional quiet octave and a touch of FM (radar, chat, lock tones): no noise transient, so it never stabs the ear. */
function ping(ctx: Ctx, freq: Param, dur: number, o: { attack?: number; octave?: number; fmIndex?: number } = {}): Float32Array {
  const s = o.fmIndex ? fm(ctx, freq, dur, { ratio: 2, index: glide(o.fmIndex, 0, dur * 0.5) }) : osc(ctx, 'sine', freq, dur);
  if (o.octave) {
    const f = typeof freq === 'number' ? () => freq * 2 : (t: number) => freq(t) * 2;
    addInto(s, osc(ctx, 'sine', f, dur), 0, o.octave);
  }
  return mul(s, perc(ctx, o.attack ?? 0.003, dur, dur));
}

/** Gates a signal on only inside `windows` ([start, end] in seconds), with 1.5 ms ramps: a broken, stuttering signal. In place. */
function chop(ctx: Ctx, x: Float32Array, windows: readonly (readonly [number, number])[]): Float32Array {
  const g = new Float32Array(x.length);
  const ramp = Math.round(0.0015 * ctx.sr);
  for (const [a, b] of windows) {
    const s = Math.round(a * ctx.sr);
    const e = Math.min(x.length, Math.round(b * ctx.sr));
    for (let i = Math.max(0, s); i < e; i++) g[i] = Math.max(g[i]!, Math.min(1, (i - s) / ramp, (e - i) / ramp));
  }
  return mul(x, g);
}

/**
 * A buffer-repeat stutter: the first `seg` seconds of `src` repeated once per entry of `rates` (the playback speed: the repeat's pitch), each repeat
 * `shrink` times shorter and more crushed. A program freezing in a crash.
 */
function stutter(ctx: Ctx, src: Float32Array, o: { rates: readonly number[]; seg: number; shrink: number }): Float32Array {
  let total = 0;
  for (let k = 0, seg = o.seg; k < o.rates.length; k++, seg *= o.shrink) total += seg;
  const out = new Float32Array(len(ctx, total + 0.01));
  let t = 0;
  let seg = o.seg;
  o.rates.forEach((rate, k) => {
    const piece = varispeed(ctx, src, rate, seg);
    const n = piece.length;
    const ramp = Math.min(Math.round(0.001 * ctx.sr), n >> 2);
    for (let i = 0; i < ramp; i++) {
      piece[i] = piece[i]! * (i / ramp);
      piece[n - 1 - i] = piece[n - 1 - i]! * (i / ramp);
    }
    addInto(out, crush(ctx, piece, Math.max(4, 10 - k * 0.7), 1 + 0.5 * k), Math.round(t * ctx.sr), 1 - 0.05 * k);
    t += seg;
    seg *= o.shrink;
  });
  return out;
}

/** A sum of oscillators on `notes` (same wave), mono. */
function stack(ctx: Ctx, wave: Wave, notes: readonly number[], dur: number): Float32Array {
  const out = new Float32Array(len(ctx, dur));
  for (const f of notes) addInto(out, osc(ctx, wave, f, dur, { phase: ctx.rand() }), 0, 1 / notes.length);
  return out;
}

/** Fades the last `fade` seconds of a stereo mix (raised cosine): a long room tail that has to stop inside maxDur ends smoothly. */
function fadeTail(ctx: Ctx, st: Stereo, fade: number): Stereo {
  const n = st.l.length;
  const f = Math.min(n, Math.round(fade * ctx.sr));
  for (let i = 0; i < f; i++) {
    const g = 0.5 + 0.5 * Math.cos((Math.PI * (i + 1)) / f);
    const k = n - f + i;
    st.l[k] = st.l[k]! * g;
    st.r[k] = st.r[k]! * g;
  }
  return st;
}

/** Scales a stereo mix so its peak is 1 (in place). */
function normalize(st: Stereo): Stereo {
  let p = 1e-9;
  for (let i = 0; i < st.l.length; i++) p = Math.max(p, Math.abs(st.l[i]!), Math.abs(st.r[i]!));
  mul(st.l, 1 / p);
  mul(st.r, 1 / p);
  return st;
}

/** Normalizes a finished mix, then a gentle compressor tames its transients so the sound can reach its loudness. */
function glue(ctx: Ctx, st: Stereo, threshold: number, ratio: number, release = 0.12): Stereo {
  return compress(ctx, normalize(st), { threshold, ratio, attack: 0.002, release });
}

/**
 * A look-ahead peak limiter on a normalized mix: the gain dips smoothly (over `look` seconds before a peak, recovering in `release`) only where the
 * signal would pass `thr`, so a single sharp transient stops setting the level without the intermodulation of a clipper.
 */
function limit(ctx: Ctx, st: Stereo, thr: number, look = 0.003, release = 0.08): Stereo {
  const n = st.l.length;
  const L = Math.max(1, Math.round(look * ctx.sr));
  const g = new Float32Array(n).fill(1);
  for (let i = 0; i < n; i++) {
    const a = Math.max(Math.abs(st.l[i]!), Math.abs(st.r[i]!));
    if (a > thr) {
      const want = thr / a;
      for (let j = Math.max(0, i - L); j <= i; j++) g[j] = Math.min(g[j]!, 1 - (1 - want) * ((j - (i - L)) / L));
    }
  }
  const rel = 1 - Math.exp(-1 / (release * ctx.sr));
  for (let i = 1; i < n; i++) g[i] = Math.min(g[i]!, g[i - 1]! + (1 - g[i - 1]!) * rel);
  return { l: mul(st.l, g), r: mul(st.r, g) };
}

// ---- the loop -------------------------------------------------------------------------------------------------------------------

/** The ambience loop's length (s): every periodic part completes whole cycles in it. */
const LOOP = 12;

/** `f` rounded to a whole number of cycles per loop, so the oscillator joins itself at the seam. */
function loopHz(f: number): number {
  return Math.max(1, Math.round(f * LOOP)) / LOOP;
}

/** A slow LFO (0..1) completing `cycles` whole cycles per loop, `n` samples long, its loop starting at sample `start` (a cheap recursive sine). */
function lfo(ctx: Ctx, n: number, cycles: number, phase: number, start: number): Float32Array {
  const out = new Float32Array(n);
  const w = (2 * Math.PI * cycles) / (LOOP * ctx.sr);
  const p0 = 2 * Math.PI * phase - w * start;
  const c = 2 * Math.cos(w);
  let s1 = Math.sin(p0 - w);
  let s2 = Math.sin(p0 - 2 * w);
  for (let i = 0; i < n; i++) {
    const s = c * s1 - s2;
    out[i] = 0.5 + 0.5 * s;
    s2 = s1;
    s1 = s;
  }
  return out;
}

/** A steady sine of `n` samples at `freq` starting at `phase` cycles (a recursive oscillator: much cheaper than dsp.osc for long drones). */
function sine(ctx: Ctx, n: number, freq: number, phase: number): Float32Array {
  const out = new Float32Array(n);
  const w = (2 * Math.PI * freq) / ctx.sr;
  const c = 2 * Math.cos(w);
  let s1 = Math.sin(2 * Math.PI * phase - w);
  let s2 = Math.sin(2 * Math.PI * phase - 2 * w);
  for (let i = 0; i < n; i++) {
    const v = c * s1 - s2;
    out[i] = v;
    s2 = s1;
    s1 = v;
  }
  return out;
}

/** A periodic signal rendered for one loop, laid out over `n` samples with its loop starting at sample `start`. */
function tile(x: Float32Array, n: number, start: number): Float32Array {
  const out = new Float32Array(n);
  const N = x.length;
  for (let i = 0; i < n; i++) out[i] = x[(((i - start) % N) + N) % N]!;
  return out;
}

// ---- recipes --------------------------------------------------------------------------------------------------------------------

export const MOMENT_SOUNDS: Partial<Record<SoundId, Recipe>> = {
  'game.finalBlow': (ctx) => {
    // The heaviest hit of the game, then a system crash. Impact: a sub drop onto D1, a contact crack, a driven D power chord and a crushed metallic
    // clang. Crash (the lead): the disc's signal freezes into a buffer loop that stutters down the D minor scale, shorter and grittier each time,
    // then its tone drops out on its own thin pulse line (D C A F D) and the disc breaks into falling voxels. All of it is over by 0.65 s, before the
    // result screen's music; only the arena is left ringing.
    const s = new Stage(ctx, 1.6);
    const lc = s.lc;
    const crack = mul(bp(ctx, noise(ctx, 0.07), 1700, 0.6), perc(ctx, 0.0005, 0.07));
    const snap = mul(hp(ctx, noise(ctx, 0.02), 5500), perc(ctx, 0.0002, 0.016));
    s.hi.add(crack, { gain: 0.9, send: 0.35 });
    s.lo.add(thump(lc, { from: 200, to: hz('D1'), drop: 0.1, dur: 0.75 }), { gain: 0.6 });
    const body = drive(sweep(lc, stack(lc, 'saw', [hz('D2'), hz('A2'), hz('D3')], 0.6), 'lp', glide(3600, 180, 0.45), 1.4), 2.8);
    s.lo.add(mul(body, env(lc, [[0, 0], [0.003, 1], [0.15, 0.45], [0.6, 0]], 0.6, 'exp')), { gain: 0.4, send: 0.2 });
    s.lo.add(crush(lc, clang(lc, { freq: hz('D3'), dur: 0.5, index: 6 }), 7, 2), { gain: 0.18, pan: -0.15, send: 0.45 });
    // The crash: a bright FM chord on D5 caught in a buffer loop, each repeat a step lower in the scale (D C A G F D C A), shorter and grittier.
    const buzz = new Float32Array(len(lc, 0.08));
    for (const f of [hz('D5'), hz('A5'), hz('D6')]) addInto(buzz, fm(lc, f, 0.08, { ratio: 2, index: 3, feedback: 0.25 }), 0, 1 / 3);
    const steps = ['D5', 'C5', 'A4', 'G4', 'F4', 'D4', 'C4', 'A3'].map((n) => hz(n) / hz('D5'));
    s.lo.add(lp(lc, stutter(lc, buzz, { rates: steps, seg: 0.07, shrink: 0.86 }), 5000, 0.7), { at: 0.05, gain: 0.45, pan: 0.1, send: 0.3 });
    // The power-down: the disc's own tone, a thin pulse, dropping D4 C4 A3 F3 D3 in ever faster steps, crushed harder as it dies.
    let at = 0;
    const dying = new Float32Array(len(lc, 0.32));
    ['D4', 'C4', 'A3', 'F3', 'D3'].forEach((n, k) => {
      const d = 0.085 * 0.8 ** k;
      const b = blip(lc, { freq: hz(n), dur: d + 0.008, wave: 'pulse', pw: 0.25, attack: 0.002, decay: d * 1.5, cutoff: 3200 });
      addInto(dying, crush(lc, b, 9 - k * 0.8, 1 + k * 0.7), Math.round(at * lc.sr), 1 - 0.08 * k);
      at += d;
    });
    s.lo.add(dying, { at: 0.36, gain: 0.2, pan: -0.1, send: 0.3 });
    s.lo.addStereo(voxels(lc, { dur: 0.6, count: 50, from: 5000, to: 220 }), { at: 0.05, gain: 0.5, send: 0.45 });
    // A look-ahead limiter on the glued mix keeps the first spike from setting the level (the blow is loud, not spiky); the contact crack and snap
    // go on after it, so the impact keeps its edge.
    const st = limit(ctx, normalize(glue(ctx, s.out({ space: SPACE.arena, quarter: true }), -20, 4, 0.15)), 0.3);
    addInto(st.l, crack, 0, 0.14);
    addInto(st.r, crack, 0, 0.14);
    addInto(st.l, snap, 0, 0.07);
    addInto(st.r, snap, 0, 0.07);
    return fadeTail(ctx, st, 0.45);
  },

  'game.victory': (ctx) => {
    // The fanfare: brass stabs climbing Bb -> C (bVI-bVII), an arpeggio running through them and a fast 16th run A4 D5 F#5 A5 shooting up into the
    // arrival: a big D major brass chord that flashes fully open (7 kHz) before it settles and swells again, a sub hit and a held pad, then a Tron
    // arpeggio rolling over the chord on a ping-pong echo, crystal glints and D major shimmer thrown into the arena.
    const s = new Stage(ctx, 4.2);
    const lc = s.lc;
    const beat = 0.24;
    const hit = { from: 450, peak: 5200, to: 1400, open: 0.03, voices: 2 };
    s.lo.addStereo(brass(lc, [hz('Bb2'), hz('F3'), hz('Bb3'), hz('D4'), hz('F4')], 0.34, hit), { gain: 0.42, send: 0.25 });
    s.lo.addStereo(brass(lc, [hz('C3'), hz('G3'), hz('C4'), hz('E4'), hz('G4')], 0.34, hit), { at: beat, gain: 0.45, send: 0.25 });
    s.lo.add(thump(lc, { from: 120, to: hz('Bb1'), drop: 0.05, dur: 0.25 }), { gain: 0.35 });
    s.lo.add(thump(lc, { from: 120, to: hz('C2'), drop: 0.05, dur: 0.25 }), { at: beat, gain: 0.35 });
    const T = beat * 2;
    s.lo.add(arp(lc, { notes: [hz('Bb4'), hz('D5'), hz('F5'), hz('C5'), hz('E5')], step: beat / 3, gate: 0.1, wave: 'square', cutoff: 4800, decay: 0.09 }), { gain: 0.16, send: 0.35 });
    s.lo.add(arp(lc, { notes: [hz('A4'), hz('D5'), hz('F#5'), hz('A5')], step: 0.03, gate: 0.05, wave: 'square', cutoff: 5000, decay: 0.05 }), {
      at: T - 0.12,
      gain: 0.2,
      send: 0.3,
    });
    // The arrival: D major, the outer voices fuller than the inner ones.
    const flash = path([[0, 600], [0.03, 7000], [0.15, 7000], [0.6, 1800], [1.4, 3400], [2.2, 1100]]);
    const pts: readonly (readonly [number, number])[] = [[0, 0], [0.004, 1], [0.35, 0.6], [1.3, 0.55], [2.2, 0]];
    s.lo.addStereo(brass(lc, [hz('D3'), hz('D5')], 2.2, { from: 600, peak: 7000, to: 1100, cutoff: flash, q: 1.15, cents: 11, voices: 3, points: pts }), {
      at: T,
      gain: 0.36,
      send: 0.35,
    });
    s.lo.addStereo(brass(lc, [hz('A3'), hz('D4'), hz('F#4'), hz('A4')], 2.2, { from: 600, peak: 7000, to: 1100, cutoff: flash, q: 1.15, cents: 11, voices: 2, points: pts }), {
      at: T,
      gain: 0.5,
      send: 0.35,
    });
    s.lo.addStereo(pad(lc, [hz('A3'), hz('D4'), hz('F#4')], 2.5, { cutoff: 2600, saw: 0.3, points: [[0, 0], [0.25, 1], [1.5, 0.8], [2.5, 0]] }), {
      at: T + 0.05,
      gain: 0.3,
      send: 0.4,
    });
    s.lo.add(thump(lc, { from: 140, to: hz('D1'), drop: 0.08, dur: 0.7 }), { at: T, gain: 0.7 });
    s.lo.add(thump(lc, { from: 110, to: hz('D1'), drop: 0.1, dur: 0.8 }), { at: T + 1.4, gain: 0.3 });
    // The sparkle: a 16th-note D major arpeggio rolling over the held chord, fading, bounced left and right.
    const seq = ['D5', 'F#5', 'A5', 'D6', 'F#6', 'D6', 'A5', 'F#5', 'D5', 'F#5', 'A5', 'D6', 'F#6', 'A6', 'D7'];
    const sparkle = new Mix(lc, 1.3);
    seq.forEach((n, k) => {
      const f = hz(n);
      sparkle.add(blip(lc, { freq: f, dur: 0.08, wave: 'square', decay: 0.075, cutoff: Math.min(6500, f * 3) }), { at: k * 0.085, gain: 0.9 - 0.035 * k });
    });
    s.lo.addStereo(echo(lc, sparkle.out(), { time: 0.17, feedback: 0.35, mix: 0.5, pingpong: true, damp: 4500 }), { at: T + 0.36, gain: 0.2, send: 0.35 });
    s.hi.add(crystal(ctx, { freq: hz('D6'), dur: 1.6, bright: 0.7 }), { at: T, gain: 0.3, pan: 0.25, send: 0.55 });
    s.hi.add(crystal(ctx, { freq: hz('A6'), dur: 1.3, bright: 0.5 }), { at: T + 0.24, gain: 0.18, pan: -0.3, send: 0.6 });
    s.hi.addStereo(shimmer(ctx, { dur: 2.4, density: 16.7, lo: 1400, hi: 6200, scale: D_MAJOR, grain: 0.16 }), { at: T + 0.08, gain: 0.4, send: 0.6 });
    return fadeTail(ctx, glue(ctx, s.out({ space: SPACE.arena, quarter: true }), -12, 2.5, 0.2), 0.9);
  },

  'game.defeat': (ctx) => {
    // A dignified power-down: slow, dark chords in D minor (Dm -> Bb -> Dm), each quieter than the last, carried by a square top line falling
    // A4 -> F4 -> D4. The last chord then slows to a quarter of its speed while its bits run out and its filter closes, like a system switching off,
    // and a soft sine falls from D4 to D2 as the screen goes dark; the arena holds the tail.
    const s = new Stage(ctx, 4.2);
    const lc = s.lc;
    // The pads: high-passed at 100 Hz, with a faint (12%) 6-bit, sample-held copy blended in: a grid chord already losing resolution.
    const grit = (x: Float32Array) => {
      const y = hp(lc, x, 100, 0.7);
      return addInto(y, crush(lc, y, 6, 2), 0, 0.12);
    };
    const thin = (st: Stereo): Stereo => ({ l: grit(st.l), r: grit(st.r) });
    const chords = [
      { at: 0, notes: [hz('D3'), hz('F3'), hz('A3')], bass: hz('D2'), top: hz('A4'), dur: 1.05, gain: 1 },
      { at: 0.9, notes: [hz('Bb2'), hz('D3'), hz('F3')], bass: hz('Bb1'), top: hz('F4'), dur: 1.05, gain: 0.55 },
    ];
    const lead = (f: number, dur: number) => mul(lp(lc, osc(lc, 'square', f, dur), 2800, 0.7), env(lc, [[0, 0], [0.03, 1], [dur * 0.5, 0.6], [dur, 0]], dur, 'lin'));
    for (const c of chords) {
      const p = pad(lc, c.notes, c.dur, { cutoff: glide(2200, 1000, c.dur), saw: 0.35, points: [[0, 0], [0.06, 1], [c.dur * 0.6, 0.7], [c.dur, 0]] });
      s.lo.addStereo(thin(p), { at: c.at, gain: 0.5 * c.gain, send: 0.35 });
      s.lo.add(mul(osc(lc, 'triangle', c.bass, c.dur), env(lc, [[0, 0], [0.04, 1], [c.dur, 0]], c.dur, 'lin')), { at: c.at, gain: 0.2 * c.gain });
      s.lo.add(lead(c.top, c.dur), { at: c.at, gain: 0.22 * c.gain, pan: 0.1, send: 0.45 });
    }
    s.lo.add(thump(lc, { from: 90, to: hz('D1'), drop: 0.1, dur: 0.6 }), { gain: 0.35 });
    // The last chord: D minor with its own D4 lead, held, then powering down.
    const dur = 1.6;
    const held = thin(pad(lc, [hz('D3'), hz('F3'), hz('A3'), hz('D4')], dur, { cutoff: 1800, saw: 0.35, points: [[0, 0], [0.08, 1], [dur, 0.8]] }));
    const top = lead(hz('D4'), dur);
    addInto(top, osc(lc, 'triangle', hz('D2'), dur), 0, 0.2);
    addInto(held.l, top, 0, 0.32);
    addInto(held.r, top, 0, 0.32);
    const rate = (t: number) => (t < 0.45 ? 1 : 1 - 0.75 * Math.min(1, (t - 0.45) / 0.9) ** 1.3);
    const fall = env(lc, [[0, 1], [0.45, 1], [1.2, 0.6], [1.55, 0]], 1.55, 'lin');
    const down = (x: Float32Array) => {
      const v = crush(lc, varispeed(lc, x, rate, 1.55), glide(14, 6, 0.9, 'lin', 0.5), glide(1, 3, 0.9, 'lin', 0.5));
      return mul(hp(lc, sweep(lc, v, 'lp', glide(2800, 300, 1.0, 'exp', 0.45), 0.8), 45, 0.7), fall);
    };
    s.lo.addStereo({ l: down(held.l), r: down(held.r) }, { at: 1.8, gain: 0.25, send: 0.3 });
    s.lo.add(ping(lc, glide(hz('D4'), hz('D2'), 0.35), 0.5, { attack: 0.01 }), { at: 3.0, gain: 0.14, send: 0.5 });
    return fadeTail(ctx, glue(ctx, s.out({ space: SPACE.arena, quarter: true }), -14, 1.5, 0.25), 0.6);
  },

  'game.drawn': (ctx) => {
    // Neutral and unresolved: an open D suspended chord (no third: neither major nor minor; E5 on top) struck once, a square motif that rises and
    // comes back to hang on the ninth (E) without resolving, the chord held on a slowly breathing pad and then stopped flat with one low tick; no
    // rise, no fall, just an end.
    const s = new Stage(ctx, 3.2);
    const lc = s.lc;
    s.lo.addStereo(brass(lc, [hz('D3'), hz('A3'), hz('D4'), hz('E4'), hz('A4'), hz('E5')], 0.9, { from: 500, peak: 4200, to: 1000, open: 0.03, cents: 9, voices: 2 }), {
      gain: 0.5,
      send: 0.3,
    });
    s.lo.add(thump(lc, { from: 110, to: hz('D2'), drop: 0.06, dur: 0.4 }), { gain: 0.35 });
    const motif = new Mix(lc, 1.6);
    [['A4', 0.18], ['D5', 0.18], ['A4', 0.18], ['E5', 0.9]].forEach(([n, d], k) => {
      motif.add(blip(lc, { freq: hz(n as string), dur: d as number, wave: 'square', attack: 0.004, decay: d as number, cutoff: 3000 }), { at: k * 0.2 });
    });
    s.lo.addStereo(echo(lc, motif.out(), { time: 0.2, feedback: 0.3, mix: 0.4, pingpong: true, damp: 3500 }), { at: 0.1, gain: 0.3, send: 0.35 });
    s.lo.addStereo(
      pad(lc, [hz('D3'), hz('A3'), hz('E4'), hz('A4')], 1.9, { cutoff: path([[0, 1200], [0.95, 2200], [1.9, 1200]]), saw: 0.3, points: [[0, 0], [0.3, 1], [1.7, 0.85], [1.9, 0]] }),
      { at: 0.35, gain: 0.42, send: 0.35 },
    );
    s.hi.add(crystal(ctx, { freq: hz('E6'), dur: 0.9, bright: 0.4 }), { at: 0.7, gain: 0.15, pan: 0.3, send: 0.6 });
    s.lo.add(ping(lc, hz('D3'), 0.25, { attack: 0.002, octave: 0.4 }), { at: 2.25, gain: 0.2 });
    s.hi.add(tick(ctx, { freq: 2500, dur: 0.004 }), { at: 2.25, gain: 0.15 });
    return fadeTail(ctx, glue(ctx, s.out({ space: SPACE.arena }), -12, 2, 0.2), 0.6);
  },

  'world.day': (ctx) => {
    // Light rising: one long upward sweep. A low, wide D major pad (D3 A3 D4 F#4 A4) whose filter opens from 300 Hz to 5 kHz over 0.9 s, an airy
    // rising swish, and a pure tone stepping D5 -> A5 -> D6 as it travels from left to right; at the top, one wide crystal chord (D6 F#6 A6) blooms and
    // rings out.
    const s = new Stage(ctx, 1.8);
    const lc = s.lc;
    s.lo.addStereo(pad(lc, [hz('D3'), hz('A3'), hz('D4'), hz('F#4'), hz('A4')], 1.5, { cutoff: glide(300, 5000, 0.9), saw: 0.4, points: [[0, 0], [0.88, 1], [1.05, 0.85], [1.5, 0]] }), {
      gain: 0.5,
      send: 0.35,
    });
    s.lo.add(swish(lc, { dur: 0.95, from: 500, to: 7000, q: 1.3, peak: 0.85, color: 'pink' }), { gain: 0.16, send: 0.4 });
    const rise = (t: number) => (t < 0.3 ? hz('D5') : t < 0.6 ? hz('A5') : hz('D6'));
    const tone = osc(lc, 'sine', rise, 0.95);
    addInto(tone, osc(lc, 'sine', (t) => rise(t) * 2, 0.95), 0, 0.12);
    mul(tone, env(lc, [[0, 0], [0.04, 0.5], [0.6, 1], [0.8, 0.8], [0.95, 0]], 0.95, 'lin'));
    s.lo.addStereo(panned(lc, tone, (t) => -0.7 + 1.4 * Math.min(1, t / 0.9)), { at: 0.05, gain: 0.1, send: 0.4 });
    const T = 0.92;
    s.hi.add(crystal(ctx, { freq: hz('D6'), dur: 1.2, bright: 0.6 }), { at: T, gain: 0.28, pan: -0.6, send: 0.55 });
    s.hi.add(crystal(ctx, { freq: hz('F#6'), dur: 1.1, bright: 0.5 }), { at: T + 0.005, gain: 0.2, pan: 0, send: 0.55 });
    s.hi.add(crystal(ctx, { freq: hz('A6'), dur: 1.2, bright: 0.5 }), { at: T + 0.01, gain: 0.23, pan: 0.6, send: 0.55 });
    return fadeTail(ctx, s.out({ space: SPACE.table, echo: { time: 0.19, feedback: 0.3, mix: 0.25, pingpong: true, damp: 5000 } }), 0.3);
  },

  'world.night': (ctx) => {
    // Light sinking: a D minor pad (D3 A3 F4) that starts bright and darkens as its filter closes, crystal notes falling A5 F5 D5 A4 and dimming from
    // right to left, a falling sweep, and the grid's low hum rising underneath as the light goes.
    const s = new Stage(ctx, 1.8);
    const lc = s.lc;
    s.lo.addStereo(pad(lc, [hz('D3'), hz('A3'), hz('F4')], 1.5, { cutoff: glide(4500, 280, 1.2), saw: 0.35, points: [[0, 0], [0.1, 1], [0.7, 0.75], [1.5, 0]] }), {
      gain: 0.5,
      send: 0.35,
    });
    s.lo.add(swish(lc, { dur: 1.0, from: 5500, to: 300, q: 1.3, peak: 0.2, color: 'pink' }), { gain: 0.15, send: 0.4 });
    [hz('A5'), hz('F5'), hz('D5'), hz('A4')].forEach((f, k) => {
      s.lo.add(crystal(lc, { freq: f, dur: 0.7, bright: 0.6 - 0.13 * k }), { at: 0.05 + k * 0.19, gain: 0.26 - 0.045 * k, pan: 0.5 - k * 0.33, send: 0.5 });
    });
    const low = new Float32Array(len(lc, 1.5));
    for (const [f, g] of [[hz('D2'), 1], [hz('D3') * 1.003, 0.4], [hz('A2'), 0.25]] as const) addInto(low, osc(lc, 'sine', f, 1.5, { phase: ctx.rand() }), 0, g);
    s.lo.add(mul(low, env(lc, [[0, 0], [0.9, 1], [1.5, 0]], 1.5, 'lin')), { at: 0.2, gain: 0.15 });
    return fadeTail(ctx, s.out({ space: SPACE.table, echo: { time: 0.19, feedback: 0.3, mix: 0.25, pingpong: true, damp: 3000 } }), 0.3);
  },

  'world.crown': (ctx) => {
    // A regal designation: a crown of light materializes (a quick rising glitter) as a carillon of D major FM bells peals D6 A5 F#5 then D6 + A6,
    // over a broad brass swell on D major (slow to bloom, like a horn call, not a stab) and a soft low drum.
    const s = new Stage(ctx, 1.3);
    const lc = s.lc;
    s.hi.addStereo(shimmer(ctx, { dur: 0.3, density: 60, lo: 2500, hi: 7500, scale: D_MAJOR, fade: 'in', grain: 0.1 }), { gain: 0.22, send: 0.45 });
    const peal: [string, number, number][] = [['D6', 0.02, -0.3], ['A5', 0.15, 0.3], ['F#5', 0.28, -0.15], ['D6', 0.44, 0.15], ['A6', 0.44, 0.35]];
    for (const [n, t, pan] of peal) s.hi.add(bell(ctx, hz(n), 0.8, { index: 1.3 }), { at: t, gain: n === 'A6' ? 0.15 : 0.25, pan, send: 0.45 });
    s.lo.addStereo(
      brass(lc, [hz('D3'), hz('F#3'), hz('A3'), hz('D4')], 1.05, {
        from: 300,
        peak: 4200,
        to: 900,
        cutoff: path([[0, 300], [0.42, 4200], [1.05, 900]]),
        q: 0.9,
        cents: 9,
        points: [[0, 0], [0.12, 0.6], [0.42, 1], [0.6, 0.75], [1.05, 0]],
      }),
      { gain: 0.5, send: 0.3 },
    );
    s.lo.add(thump(lc, { from: 110, to: hz('D2'), drop: 0.08, dur: 0.5 }), { at: 0.42, gain: 0.3 });
    const st = s.out({ space: SPACE.table, echo: { time: 0.13, feedback: 0.3, mix: 0.3, pingpong: true, damp: 4500 } });
    return fadeTail(ctx, glue(ctx, st, -10, 2, 0.15), 0.25);
  },

  'net.connected': (ctx) => {
    // A clean handshake: a call (a pulsed sine climbing D5 -> A5 on the left), the answer (A5 -> D6 on the right), then both lock on one clear
    // two-note tone in the centre.
    const s = new Stage(ctx, 1.0);
    const lc = s.lc;
    s.lo.add(scan(lc, { from: hz('D5'), to: hz('A5'), dur: 0.12, rate: 48, duty: 0.5 }), { gain: 0.3, pan: -0.45, send: 0.15 });
    s.lo.add(scan(lc, { from: hz('A5'), to: hz('D6'), dur: 0.12, rate: 48, duty: 0.5 }), { at: 0.15, gain: 0.3, pan: 0.45, send: 0.15 });
    s.lo.add(ping(lc, hz('D6'), 0.45, { octave: 0.15, fmIndex: 0.6 }), { at: 0.31, gain: 0.32, send: 0.25 });
    s.lo.add(ping(lc, hz('A5'), 0.45), { at: 0.31, gain: 0.22, send: 0.25 });
    s.hi.add(tick(ctx, { freq: 5000, dur: 0.003 }), { at: 0.31, gain: 0.25 });
    return fadeTail(ctx, s.out({ space: SPACE.ui, echo: { time: 0.12, feedback: 0.3, mix: 0.3, pingpong: true, damp: 4000 } }), 0.15);
  },

  'net.joined': (ctx) => {
    // The opponent rezzes in and locks on: voxels rising and converging with a rising swish, snapping onto a two-note interlock (D5 + A5 FM pings in
    // the centre, a 5 kHz tick and a D6 crystal flash), then a D5 A5 D6 A6 arpeggio thrown wide on the echo. Light and high (nothing below
    // 250 Hz): the big arrival is left to game.start, which follows.
    const s = new Stage(ctx, 1.0);
    const lc = s.lc;
    s.hi.addStereo(voxels(ctx, { dur: 0.4, count: 50, from: 3800, to: 350, up: true }), { gain: 1.3, send: 0.3 });
    s.lo.add(swish(lc, { dur: 0.42, from: 600, to: 6500, q: 1.8, peak: 0.92, color: 'pink' }), { gain: 0.4, send: 0.25 });
    const T = 0.4;
    s.lo.add(ping(lc, hz('D5'), 0.5, { octave: 0.2, fmIndex: 1.2 }), { at: T, gain: 0.36, pan: -0.1, send: 0.3 });
    s.lo.add(ping(lc, hz('A5'), 0.45, { fmIndex: 0.9 }), { at: T, gain: 0.28, pan: 0.1, send: 0.3 });
    s.hi.add(tick(ctx, { freq: 5000, dur: 0.004 }), { at: T, gain: 0.35 });
    s.hi.add(crystal(ctx, { freq: hz('D6'), dur: 0.5, bright: 0.7 }), { at: T, gain: 0.15, send: 0.4 });
    s.lo.add(arp(lc, { notes: [hz('D5'), hz('A5'), hz('D6'), hz('A6')], step: 0.065, gate: 0.07, wave: 'square', cutoff: 5500, decay: 0.065 }), { at: T + 0.08, gain: 0.2, send: 0.6 });
    const st = s.out({ space: SPACE.table, echo: { time: 0.13, feedback: 0.35, mix: 0.45, pingpong: true, damp: 4500 } });
    st.l = hp(ctx, st.l, 250, 0.7);
    st.r = hp(ctx, st.r, 250, 0.7);
    return fadeTail(ctx, glue(ctx, st, -10, 2, 0.12), 0.2);
  },

  'net.lost': (ctx) => {
    // Signal lost: a carrier tone slips down a half step (Bb -> A) and starts to waver, stutters and breaks up, bursts of crushed static fill the
    // gaps, and the last of it sinks in steps (A F D A) and dissolves into grit: a worried glitch, then dead air.
    const s = new Stage(ctx, 1.1);
    const lc = s.lc;
    const sink = [hz('A5'), hz('F5'), hz('D5'), hz('A4')];
    const base = (t: number) => (t < 0.11 ? hz('Bb5') : t < 0.3 ? hz('A5') : sink[Math.min(3, Math.floor((t - 0.3) / 0.07))]!);
    const fr = (t: number) => base(t) * 2 ** ((Math.min(1, t / 0.35) * 35 * Math.sin(2 * Math.PI * 9 * t)) / 1200);
    const carrier = new Float32Array(len(lc, 0.8));
    addInto(carrier, osc(lc, 'square', fr, 0.8), 0, 0.35);
    addInto(carrier, osc(lc, 'sine', (t) => fr(t) / 2, 0.8), 0, 0.65);
    const tone = crush(lc, lp(lc, carrier, 3200, 0.7), glide(12, 4, 0.7, 'lin', 0.1), glide(1, 5, 0.7, 'lin', 0.1));
    chop(lc, tone, [[0, 0.1], [0.115, 0.2], [0.23, 0.26], [0.285, 0.36], [0.375, 0.42], [0.445, 0.5], [0.515, 0.56], [0.6, 0.63], [0.66, 0.8]]);
    s.lo.add(mul(tone, env(lc, [[0, 0], [0.004, 1], [0.3, 0.9], [0.8, 0]], 0.8, 'lin')), { gain: 0.5, send: 0.25 });
    const stat = crush(lc, bp(lc, noise(lc, 0.8), 2600, 0.8), 5, 4);
    chop(lc, stat, [[0.2, 0.23], [0.36, 0.375], [0.42, 0.445], [0.56, 0.6], [0.63, 0.66]]);
    s.lo.add(stat, { gain: 0.22, pan: 0.15, send: 0.25 });
    s.lo.addStereo(voxels(lc, { dur: 0.35, count: 18, from: 1600, to: 250 }), { at: 0.55, gain: 0.3, send: 0.35 });
    return fadeTail(ctx, s.out({ space: SPACE.table, echo: { time: 0.09, feedback: 0.25, mix: 0.25, pingpong: true, damp: 3000 } }), 0.2);
  },

  'net.restored': (ctx) => {
    // Signal back: a crushed, flickering tone on A4 cleans up as it leaps a fourth to D5 and locks, then resolves into a warm D major chime (D5 F#5
    // A5 rolled, then a D6 glint) on a ping-pong echo: relief.
    const s = new Stage(ctx, 1.0);
    const lc = s.lc;
    const fr = (t: number) => (t < 0.17 ? hz('A4') : hz('D5'));
    const c = new Float32Array(len(lc, 0.32));
    addInto(c, osc(lc, 'square', fr, 0.32), 0, 0.3);
    addInto(c, osc(lc, 'sine', fr, 0.32), 0, 0.7);
    const tone = crush(lc, lp(lc, c, 3000, 0.7), glide(4, 14, 0.24, 'lin'), glide(5, 1, 0.24, 'lin'));
    chop(lc, tone, [[0, 0.04], [0.06, 0.1], [0.115, 0.32]]);
    s.lo.add(mul(tone, env(lc, [[0, 0], [0.004, 0.8], [0.25, 1], [0.32, 0]], 0.32, 'lin')), { gain: 0.35, send: 0.2 });
    const T = 0.3;
    [hz('D5'), hz('F#5'), hz('A5')].forEach((f, k) => {
      s.lo.add(ping(lc, f, 0.6, { octave: 0.12, fmIndex: 0.5 }), { at: T + k * 0.05, gain: 0.2, pan: (k - 1) * 0.3, send: 0.3 });
    });
    s.hi.add(crystal(ctx, { freq: hz('D6'), dur: 0.5, bright: 0.5 }), { at: T + 0.15, gain: 0.16, pan: 0.2, send: 0.4 });
    return fadeTail(ctx, s.out({ space: SPACE.table, echo: { time: 0.11, feedback: 0.3, mix: 0.3, pingpong: true, damp: 4500 } }), 0.2);
  },

  'net.chat': (ctx) => {
    // A message in from across the table: three tiny crushed C6 pips 22 ms apart, like a packet typing in, then one D6 note with a faint D7 glint,
    // all from the opponent's side (to the right, a little up-table in the room), in the small room with a tiny echo.
    const s = new Stage(ctx, 0.5);
    const lc = s.lc;
    const note = (f: number, dur: number) =>
      mul(lp(lc, osc(lc, 'pulse', f, dur, { pw: 0.3 }), 3000, 0.7), env(lc, [[0, 0], [0.003, 1], [dur * 0.35, 0.55], [dur, 0]], dur, 'lin'));
    for (let k = 0; k < 3; k++) s.lo.add(crush(lc, note(hz('C6'), 0.014), 6, 2), { at: k * 0.022, gain: 0.3, pan: 0.35, send: 0.25 });
    const T = 0.075;
    s.lo.add(note(hz('D6'), 0.09), { at: T, gain: 0.42, pan: 0.3, send: 0.3 });
    s.hi.add(crystal(ctx, { freq: hz('D7'), dur: 0.25, bright: 0.3 }), { at: T, gain: 0.08, pan: 0.4, send: 0.35 });
    return fadeTail(ctx, s.out({ space: SPACE.ui, echo: { time: 0.09, feedback: 0.25, mix: 0.22, pingpong: true, damp: 3500 } }), 0.1);
  },

  'net.waiting': (ctx) => {
    // A calm radar ping: one short, soft sine on D5 with a faint octave, a touch of FM shine and a faint A5 glint, a faint return a fourth lower,
    // and the echoes of both bouncing left and right. Gentle so it can repeat every few seconds for a minute without wearing on the ear.
    const s = new Stage(ctx, 0.9);
    s.lo.add(ping(s.lc, hz('D5'), 0.13, { attack: 0.005, octave: 0.15, fmIndex: 0.4 }), { gain: 0.5, send: 0.3 });
    s.hi.add(crystal(ctx, { freq: hz('A5'), dur: 0.2, bright: 0.2 }), { gain: 0.1, send: 0.3 });
    // The return, 0.32 s on (between the first two echoes): the same ping, 14 dB down and a fourth lower (A4), as if bounced back from far across the grid.
    s.lo.add(ping(s.lc, hz('A4'), 0.13, { attack: 0.005, octave: 0.15, fmIndex: 0.3 }), { at: 0.32, gain: 0.1, pan: 0.3, send: 0.4 });
    return fadeTail(ctx, s.out({ space: SPACE.table, echo: { time: 0.26, feedback: 0.35, mix: 0.45, pingpong: true, damp: 2500 } }), 0.15);
  },

  'ambient.grid': (ctx) => {
    // The grid hum: a low D drone (sines on D2 and its harmonics, each breathing on its own slow cycle, separately on the left and the right, with a
    // faint electric upper series), sparse far-off crystal glints, a slow beating pair on D3 spread wide, a dark D1 + D2 saw drone whose filter
    // breathes, and faint filtered air in the table room. Every partial sits on the same D (no two beat at the loop's period). Every periodic part completes whole cycles in the 12 s
    // loop; the air and the room are made seamless by rendering past the end and crossfading that overrun into the head. The hum is computed at an
    // eighth of the rate, the rest at a quarter, and up-sampled around the loop.
    const q = slow(ctx, 4);
    const h = slow(ctx, 8);
    const pre = 1.25;
    const fade = 0.8;
    const total = pre + LOOP + fade;
    const n = len(q, LOOP);
    const N = len(q, total);
    const p = len(q, pre);
    const m = new Mix(q, total);
    // The hum, one loop of it per side: [harmonic, level, breaths per loop]. f0 has an even number of cycles per loop so D1 = f0 / 2 does too.
    const f0 = (2 * Math.round((hz('D2') * LOOP) / 2)) / LOOP;
    const nh = len(h, LOOP);
    const humL = new Float32Array(nh);
    const humR = new Float32Array(nh);
    const harm: readonly (readonly [number, number, number])[] = [
      [1, 0.7, 1],
      [2, 0.5, 2],
      [3, 0.4, 3],
      [4, 0.25, 1],
      [5, 0.15, 2],
      [6, 0.11, 3],
      [8, 0.1, 2],
      [10, 0.06, 3],
      [12, 0.045, 1],
      [14, 0.03, 2],
      [16, 0.04, 3],
    ];
    harm.forEach(([k, g, cyc], idx) => {
      // Each side has its own phase (a fixed quarter-cycle apart or so: wide, but no movement in mono) and its own breath.
      const ph = ctx.rand();
      const sl = sine(h, nh, f0 * k, ph);
      const sr = sine(h, nh, f0 * k, ph + 0.2 + 0.1 * ctx.rand());
      const bl = lfo(h, nh, cyc, idx * 0.17, 0);
      const br = lfo(h, nh, cyc, idx * 0.17 + 0.37, 0);
      for (let i = 0; i < nh; i++) {
        humL[i] = humL[i]! + sl[i]! * g * (0.7 + 0.3 * bl[i]!);
        humR[i] = humR[i]! + sr[i]! * g * (0.7 + 0.3 * br[i]!);
      }
    });
    m.add(tile(upsample(humL, 2, n, true), N, p), { gain: 0.5, pan: -0.7 });
    m.add(tile(upsample(humR, 2, n, true), N, p), { gain: 0.5, pan: 0.7 });
    // A slow beat on D3 (the two sines drift 3 cycles apart per loop: a 4 s throb), spread wide.
    const d3 = loopHz(hz('D3'));
    m.add(tile(sine(q, n, d3, 0.1), N, p), { gain: 0.1, pan: -0.8, send: 0.2 });
    m.add(tile(sine(q, n, d3 + 3 / LOOP, 0.6), N, p), { gain: 0.1, pan: 0.8, send: 0.2 });
    // The dark saw drone: D1 a little left, D2 a little right (both exactly on the hum's D), the low-pass breathing between 140 and 450 Hz twice per loop.
    const cut = lfo(q, N, 2, 0.25, p);
    const cf = (t: number) => 140 * (450 / 140) ** cut[Math.min(N - 1, Math.round(t * q.sr))]!;
    for (const [f, pan] of [[f0 / 2, -0.25], [f0, 0.25]] as const) {
      const saw = tile(osc(q, 'saw', f, LOOP, { phase: ctx.rand() }), N, p);
      m.add(sweep(q, saw, 'lp', cf, 0.9), { gain: 0.25, pan, send: 0.1 });
    }
    // Faint air: pink noise through slowly wandering band-passes, breathing three times per loop.
    const airCut = lfo(q, N, 1, 0.6, p);
    const airAmp = lfo(q, N, 3, 0.1, p);
    const ac = (t: number) => airCut[Math.min(N - 1, Math.round(t * q.sr))]!;
    const airL = sweep(q, noise(q, total, 'pink'), 'bp', (t) => 900 * 2.4 ** ac(t), 0.8);
    const airR = sweep(q, noise(q, total, 'pink'), 'bp', (t) => 1200 * 2.2 ** (1 - ac(t)), 0.8);
    for (let i = 0; i < N; i++) {
      const a = 0.4 + 0.6 * airAmp[i]!;
      airL[i] = airL[i]! * a;
      airR[i] = airR[i]! * a * 0.8;
    }
    m.add(airL, { gain: 0.2, pan: -0.5, send: 0.5 });
    m.add(airR, { gain: 0.2, pan: 0.5, send: 0.5 });
    // Glints: sparse high crystal grains (D minor, 1.5-3 kHz), about one every 1.5 s, like far-off light catching the grid. The room hears a
    // quarter-rate copy laid out periodically (so their echoes cross the seam too); the grains themselves are added at the full rate, wrapping around
    // the loop.
    const glints = Array.from({ length: 8 }, (_, k) => ({
      t: k * 1.5 + 0.2 + ctx.rand() * 1.0,
      f: scaleNoteBetween(ctx, 1500, 3000),
      pan: ctx.rand() * 1.6 - 0.8,
      g: 0.6 + 0.4 * ctx.rand(),
    }));
    const lay = (c: Ctx, st: Stereo, gain: number): Stereo => {
      const L = st.l.length;
      for (const gl of glints) {
        const x = crystal(c, { freq: gl.f, dur: 0.5, bright: 0.35 });
        const [a, b] = panGains(gl.pan);
        const off = Math.round(gl.t * c.sr);
        for (let i = 0; i < x.length; i++) {
          const j = (off + i) % L;
          st.l[j] = st.l[j]! + x[i]! * a * gl.g * gain;
          st.r[j] = st.r[j]! + x[i]! * b * gl.g * gain;
        }
      }
      return st;
    };
    const GLINT = 0.12;
    const gq = lay(q, { l: new Float32Array(n), r: new Float32Array(n) }, GLINT * 0.6);
    addInto(m.send.l, tile(gq.l, N, p));
    addInto(m.send.r, tile(gq.r, N, p));
    const dry = m.out();
    const wet = room(q, m.send, SPACE.table, true);
    // One overall breath, twice per loop.
    const whole = lfo(q, N, 2, 0.75, p);
    // The loop: [pre, pre + LOOP), with the rendered overrun crossfaded into its head (linearly: the periodic parts are identical in both, so their
    // level stays constant), then up-sampled around the circle.
    const out: Stereo = { l: new Float32Array(0), r: new Float32Array(0) };
    const fn = len(q, fade);
    for (const ch of ['l', 'r'] as const) {
      const src = dry[ch];
      addInto(src, wet[ch]);
      const loop = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let v = src[p + i]!;
        if (i < fn) {
          const w = i / fn;
          v = v * w + src[p + n + i]! * (1 - w);
        }
        loop[i] = v * (0.88 + 0.12 * whole[p + i]!);
      }
      out[ch] = upsample(loop, 4, len(ctx, LOOP), true);
    }
    return lay(ctx, out, GLINT);
  },
};
