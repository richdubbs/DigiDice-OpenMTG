/**
 * The sound palette (docs/design/sound.md "Palette"): the shared key, rooms and signature building blocks of the client's grid / Tron sound. Recipes
 * (audio/sounds/*.ts) build from these so every sound belongs to one family: pure synthesized tones (sine, square, saw, FM, crystal modes), quantized
 * to D minor, clean transients, digital grit used as an effect (bit crush, sample-and-hold, voxel grains), and the same three digital rooms.
 */
import {
  bp,
  clamp,
  crush,
  env,
  fm,
  glide,
  hp,
  len,
  lp,
  modes,
  Mix,
  mul,
  noise,
  osc,
  perc,
  type Ctx,
  type Param,
  type SpaceOpts,
  type Stereo,
  type Wave,
} from './dsp';

// ---- pitch ----------------------------------------------------------------------------------------------------------------------

/** Frequency of a MIDI note (A4 = 69 = 440 Hz). */
export function midiHz(m: number): number {
  return 440 * 2 ** ((m - 69) / 12);
}

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Frequency of a note name: 'D4', 'F#5', 'Bb3'. */
export function hz(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  const base = NOTE_INDEX[m[1]!]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return midiHz(12 * (Number(m[3]) + 1) + base);
}

/** The set's key: D minor (D E F G A Bb C). Degrees count from 0 = D; negative and > 6 wrap into other octaves. */
export const D_MINOR = [0, 2, 3, 5, 7, 8, 10] as const;
/** D major, for bright, winning moments (D E F# G A B C#). */
export const D_MAJOR = [0, 2, 4, 5, 7, 9, 11] as const;

/** The frequency of scale `degree` above D in `octave` (D4 = 293.66 Hz at degree 0, octave 4). */
export function degree(deg: number, octave = 4, scale: readonly number[] = D_MINOR): number {
  const o = Math.floor(deg / scale.length);
  const k = ((deg % scale.length) + scale.length) % scale.length;
  return midiHz(12 * (octave + 1 + o) + 2 + scale[k]!);
}

/** A random note of the scale between `lo` and `hi` Hz (grains that glitter in key). */
export function scaleNoteBetween(ctx: Ctx, lo: number, hi: number, scale: readonly number[] = D_MINOR): number {
  const notes: number[] = [];
  for (let oct = 0; oct <= 9; oct++) for (let d = 0; d < scale.length; d++) {
    const f = degree(d, oct, scale);
    if (f >= lo && f <= hi) notes.push(f);
  }
  if (notes.length === 0) return clamp(lo, 20, 20000);
  return notes[Math.floor(ctx.rand() * notes.length)]!;
}

// ---- rooms ------------------------------------------------------------------------------------------------------------------------

/**
 * The three digital rooms every sound shares: `ui` (a small bright cell, for interface feedback), `table` (the game table: a clear medium hall) and
 * `arena` (a vast dark space for the big moments: the start, victory, defeat).
 */
export const SPACE: Record<'ui' | 'table' | 'arena', SpaceOpts> = {
  ui: { decay: 0.32, size: 0.35, damp: 9000, predelay: 0.003, lowCut: 350, diffusion: 0.6 },
  table: { decay: 1.25, size: 0.9, damp: 6500, predelay: 0.012, lowCut: 180, diffusion: 0.7 },
  arena: { decay: 3.2, size: 1.7, damp: 5000, predelay: 0.024, lowCut: 120, diffusion: 0.75 },
};

// ---- building blocks ---------------------------------------------------------------------------------------------------------------

/** A clean synth blip: an oscillator under a percussive envelope, optionally gliding and low-passed. The basic grid-interface tone. */
export function blip(
  ctx: Ctx,
  o: { freq: Param; dur: number; wave?: Wave; attack?: number; decay?: number; cutoff?: Param; pw?: Param },
): Float32Array {
  const s = osc(ctx, o.wave ?? 'sine', o.freq, o.dur, o.pw !== undefined ? { pw: o.pw } : {});
  mul(s, perc(ctx, o.attack ?? 0.001, o.decay ?? o.dur, o.dur));
  return o.cutoff !== undefined ? lp(ctx, s, o.cutoff, 0.7) : s;
}

/** A tiny transient: a few milliseconds of band-passed noise (the "tick" on top of a blip, a relay contact, a key). */
export function tick(ctx: Ctx, o: { freq?: number; dur?: number; q?: number } = {}): Float32Array {
  const d = o.dur ?? 0.006;
  const s = bp(ctx, noise(ctx, d), o.freq ?? 4200, o.q ?? 1.2);
  return mul(s, perc(ctx, 0.0002, d, d));
}

/** A kick-like thump: a sine that drops from `from` to `to` Hz in `drop` seconds and fades in `dur` (weight under impacts and landings). */
export function thump(ctx: Ctx, o: { from?: number; to?: number; drop?: number; dur?: number } = {}): Float32Array {
  const dur = o.dur ?? 0.28;
  const s = osc(ctx, 'sine', glide(o.from ?? 140, o.to ?? 45, o.drop ?? 0.06), dur);
  return mul(s, env(ctx, [[0, 0], [0.002, 1], [dur * 0.35, 0.45], [dur, 0]], dur, 'exp'));
}

/**
 * A digital whoosh: noise through a band-pass swept from `from` to `to` Hz, swelling in the middle (light cycles, panels sliding, cards flying). `tone`
 * adds a soft sine following the sweep a few octaves down, the "hum" of a light cycle.
 */
export function whoosh(
  ctx: Ctx,
  o: { dur: number; from: number; to: number; q?: number; color?: 'white' | 'pink'; peak?: number; tone?: number },
): Float32Array {
  const d = o.dur;
  const sweep = glide(o.from, o.to, d);
  const s = bp(ctx, noise(ctx, d, o.color ?? 'pink'), sweep, o.q ?? 1.6);
  const pk = clamp(o.peak ?? 0.5, 0.05, 0.95);
  mul(s, env(ctx, [[0, 0], [d * pk, 1], [d, 0]], d, 'lin'));
  if (o.tone) {
    const t = osc(ctx, 'sine', (t: number) => sweep(t) / 8, d);
    mul(t, env(ctx, [[0, 0], [d * pk, o.tone], [d, 0]], d, 'lin'));
    for (let i = 0; i < s.length; i++) s[i] = s[i]! + t[i]!;
  }
  return s;
}

/** An FM "laser" zap: a bright buzz falling (or rising) fast in pitch (abilities, bolts, counters). */
export function zap(ctx: Ctx, o: { from: number; to: number; dur: number; index?: number; ratio?: number }): Float32Array {
  const s = fm(ctx, glide(o.from, o.to, o.dur * 0.8), o.dur, { ratio: o.ratio ?? 1, index: glide(o.index ?? 3, 0.3, o.dur, 'lin') });
  return mul(s, perc(ctx, 0.001, o.dur, o.dur));
}

/** A crystal / glass ping (inharmonic modes): mana, notices, radiant light, the bright edge of a grid line. */
export function crystal(ctx: Ctx, o: { freq: number; dur?: number; bright?: number }): Float32Array {
  const d = o.dur ?? 0.6;
  const b = clamp(o.bright ?? 0.6, 0, 1);
  return modes(ctx, o.freq, d, [1, 2.76, 5.4, 8.93], [d, d * 0.55, d * 0.3, d * 0.18], [1, 0.45 * b, 0.25 * b, 0.12 * b]);
}

/** Unison oscillators spread across the stereo field (detuned by up to `cents`): wide, lush leads and stabs. */
export function unison(ctx: Ctx, wave: Wave, freq: Param, dur: number, o: { voices?: number; cents?: number; width?: number } = {}): Stereo {
  const v = Math.max(1, o.voices ?? 3);
  const cents = o.cents ?? 12;
  const width = o.width ?? 0.8;
  const mix = new Mix(ctx, dur);
  const f = typeof freq === 'number' ? () => freq : freq;
  for (let k = 0; k < v; k++) {
    const x = v === 1 ? 0 : (k / (v - 1)) * 2 - 1;
    const ratio = 2 ** ((x * cents) / 1200);
    mix.add(osc(ctx, wave, (t) => f(t) * ratio, dur, { phase: ctx.rand() }), { gain: 1 / Math.sqrt(v), pan: x * width });
  }
  return mix.out();
}

/**
 * A synth chord stab: unison saws (or squares) on `notes`, through a low-pass that opens to `peak` Hz and closes again (Tron brass / a turn banner).
 */
export function stab(
  ctx: Ctx,
  o: { notes: readonly number[]; dur: number; wave?: Wave; cutoff?: { from: number; peak: number; to: number; open?: number }; q?: number; voices?: number; cents?: number },
): Stereo {
  const mix = new Mix(ctx, o.dur);
  for (const f of o.notes) mix.addStereo(unison(ctx, o.wave ?? 'saw', f, o.dur, { voices: o.voices ?? 3, cents: o.cents ?? 10 }), { gain: 1 / Math.sqrt(o.notes.length) });
  const st = mix.out();
  const c = o.cutoff ?? { from: 300, peak: 5000, to: 600 };
  const open = c.open ?? 0.03;
  const curve = (t: number) => (t < open ? c.from * (c.peak / c.from) ** (t / open) : c.peak * (c.to / c.peak) ** Math.min(1, (t - open) / Math.max(0.01, o.dur - open)));
  const shape = env(ctx, [[0, 0], [0.004, 1], [o.dur * 0.6, 0.5], [o.dur, 0]], o.dur, 'exp');
  return { l: mul(lp(ctx, st.l, curve, o.q ?? 1.1), shape), r: mul(lp(ctx, st.r, curve, o.q ?? 1.1), shape) };
}

/**
 * Glitter: short crystal grains on notes of the key between `lo` and `hi` Hz, scattered over `dur` (density grains per second, thinning out), each
 * panned somewhere. Life gain, radiance, a materializing program.
 */
export function shimmer(ctx: Ctx, o: { dur: number; density: number; lo?: number; hi?: number; grain?: number; scale?: readonly number[]; fade?: 'out' | 'in' | 'swell' }): Stereo {
  const mix = new Mix(ctx, o.dur + (o.grain ?? 0.12));
  const count = Math.max(1, Math.round(o.density * o.dur));
  for (let k = 0; k < count; k++) {
    const x = ctx.rand();
    const t = o.fade === 'in' ? Math.sqrt(x) * o.dur : o.fade === 'swell' ? (0.5 + 0.5 * Math.sin(Math.PI * (x - 0.5))) * o.dur : x * x * o.dur;
    const f = scaleNoteBetween(ctx, o.lo ?? 1500, o.hi ?? 7000, o.scale);
    const g = crystal(ctx, { freq: f, dur: (o.grain ?? 0.12) * (0.6 + ctx.rand() * 0.8), bright: 0.4 });
    const level = o.fade === 'in' ? 0.4 + 0.6 * (t / o.dur) : o.fade === 'swell' ? 0.6 + 0.4 * Math.sin((Math.PI * t) / o.dur) : 1 - 0.7 * (t / o.dur);
    mix.add(g, { at: t, gain: (0.25 + 0.2 * ctx.rand()) * level, pan: ctx.rand() * 1.6 - 0.8 });
  }
  return mix.out();
}

/**
 * Voxels: the signature "derezz" texture. Dozens of tiny square/FM blips on random notes, falling in pitch from `from` to `to` Hz and thinning out
 * over `dur`, increasingly bit-crushed: a program breaking into cubes of light. With `up` the same cloud runs backwards (a program rezzing in): it
 * starts sparse around `to` and ends dense around `from`.
 */
export function voxels(ctx: Ctx, o: { dur: number; count: number; from?: number; to?: number; up?: boolean }): Stereo {
  const from = o.from ?? 3500;
  const to = o.to ?? 300;
  const mix = new Mix(ctx, o.dur + 0.06);
  for (let k = 0; k < o.count; k++) {
    const x = ctx.rand();
    // Dense at the start (or at the end, rising), thinning out.
    const pos = o.up ? 1 - x * x : x * x;
    const t = pos * o.dur;
    const centre = from * (to / from) ** (o.up ? 1 - pos : pos);
    const f = scaleNoteBetween(ctx, centre * 0.7, centre * 1.4);
    const d = 0.012 + ctx.rand() * 0.03;
    const wave: Wave = ctx.rand() < 0.5 ? 'square' : 'triangle';
    let g = blip(ctx, { freq: f, dur: d, wave, decay: d, cutoff: Math.min(16000, f * 6) });
    g = crush(ctx, g, 8 - 4 * pos, 1 + 5 * pos);
    mix.add(g, { at: t, gain: 0.16 * (1 - 0.5 * pos) * (0.6 + 0.6 * ctx.rand()), pan: ctx.rand() * 1.8 - 0.9 });
  }
  return mix.out();
}

/** A low grid hum (fundamental and a few harmonics, slow beating): the field under the table, the throb of a power line. */
export function hum(ctx: Ctx, o: { freq?: number; dur: number; harmonics?: readonly number[]; beat?: number }): Float32Array {
  const f = o.freq ?? 55;
  const hs = o.harmonics ?? [1, 0.5, 0.3, 0.12];
  const out = new Float32Array(len(ctx, o.dur));
  hs.forEach((g, k) => {
    const s = osc(ctx, 'sine', f * (k + 1) * (1 + (o.beat ?? 0.002) * k), o.dur, { phase: ctx.rand() });
    for (let i = 0; i < out.length; i++) out[i] = out[i]! + (s[i]! * g);
  });
  return out;
}

/** A scanning sweep: a sine sliding from `from` to `to` Hz, chopped into quick pulses (searching, revealing, targeting). */
export function scan(ctx: Ctx, o: { from: number; to: number; dur: number; rate?: number; duty?: number }): Float32Array {
  const s = osc(ctx, 'sine', glide(o.from, o.to, o.dur), o.dur);
  const rate = o.rate ?? 30;
  const duty = o.duty ?? 0.45;
  for (let i = 0; i < s.length; i++) {
    const ph = ((i / ctx.sr) * rate) % 1;
    const gate = ph < duty ? Math.sin((Math.PI * ph) / duty) : 0;
    s[i] = s[i]! * gate;
  }
  return mul(s, env(ctx, [[0, 0], [0.01, 1], [o.dur * 0.8, 0.8], [o.dur, 0]], o.dur));
}

/** A digital arpeggio: `notes` played `step` seconds apart as blips of `gate` seconds (data transfers, fanfares, coins). */
export function arp(ctx: Ctx, o: { notes: readonly number[]; step: number; gate?: number; wave?: Wave; cutoff?: number; decay?: number }): Float32Array {
  const gate = o.gate ?? o.step * 0.9;
  const out = new Float32Array(len(ctx, o.step * (o.notes.length - 1) + gate + 0.01));
  o.notes.forEach((f, k) => {
    const b = blip(ctx, { freq: f, dur: gate, wave: o.wave ?? 'square', decay: o.decay ?? gate, ...(o.cutoff ? { cutoff: o.cutoff } : {}) });
    const off = Math.round(k * o.step * ctx.sr);
    for (let i = 0; i < b.length && off + i < out.length; i++) out[off + i] = out[off + i]! + b[i]!;
  });
  return out;
}

/** A soft sustained pad (detuned triangles and saws, low-passed), stereo: day and night, the end screens, the ambience. */
export function pad(ctx: Ctx, o: { notes: readonly number[]; dur: number; attack?: number; release?: number; cutoff?: number; bright?: number }): Stereo {
  const mix = new Mix(ctx, o.dur);
  for (const f of o.notes) {
    mix.addStereo(unison(ctx, 'triangle', f, o.dur, { voices: 3, cents: 9 }), { gain: 0.6 / Math.sqrt(o.notes.length) });
    mix.addStereo(unison(ctx, 'saw', f, o.dur, { voices: 2, cents: 14 }), { gain: (0.25 * (o.bright ?? 0.5)) / Math.sqrt(o.notes.length) });
  }
  const st = mix.out();
  const a = o.attack ?? 0.3;
  const r = o.release ?? 0.6;
  const shape = env(ctx, [[0, 0], [a, 1], [Math.max(a, o.dur - r), 0.85], [o.dur, 0]], o.dur, 'lin');
  const c = o.cutoff ?? 2400;
  return { l: mul(lp(ctx, st.l, c, 0.6), shape), r: mul(lp(ctx, st.r, c, 0.6), shape) };
}

/** A metallic digital clang (inharmonic FM over a resonant hum): shields, blocks, prevented damage. */
export function clang(ctx: Ctx, o: { freq: number; dur: number; index?: number }): Float32Array {
  const s = fm(ctx, o.freq, o.dur, { ratio: 1.414, index: glide(o.index ?? 4, 0.5, o.dur * 0.6, 'lin') });
  mul(s, perc(ctx, 0.001, o.dur, o.dur));
  const body = modes(ctx, o.freq * 0.5, o.dur, [1, 2.32, 4.25], [o.dur, o.dur * 0.5, o.dur * 0.25], [0.6, 0.3, 0.15]);
  for (let i = 0; i < s.length; i++) s[i] = s[i]! * 0.6 + (body[i] ?? 0);
  return hp(ctx, s, 120);
}
