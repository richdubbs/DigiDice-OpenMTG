/**
 * Card and zone sounds (docs/design/sound.md "Cards"): drawing, playing lands, permanents entering, tokens, the exits (destroy derezzes into voxels,
 * sacrifice sinks, exile vanishes into light), taps and untaps, flips, attachments, reveals and searches, and the hand's pick-up and drop.
 *
 * One family: arrivals land and light up (a land locks in and powers up, a permanent rezzes in on a stab, a token compiles out of rising grains);
 * exits fall, shrink or break (destroy shatters into falling voxels, sacrifice sinks in a dark swirl, exile collapses into a point of light); the
 * moves between piles are swishes in the table's room (draw rises, graveyard falls, library slides in, bounce rewinds). Timing: land, enter and
 * enterHeavy touch down 45-60 ms in, after a short rush, so they are fired on the landing frame; the exits and pile moves start with their animation
 * and put their accents on its beats (destroy shatters at 0.32 s, exile vanishes at 0.5 s, a token is complete at 0.3 s).
 */
import type { Recipe, SoundId } from '../catalog';
import { addInto, bp, clamp, crush, drive, env, flange, fm, glide, hp, lp, Mix, modes, mul, noise, osc, perc, reverb, ring, steps, type Ctx, type Param, type Stereo } from '../dsp';
import { crystal, degree, hz, scaleNoteBetween, shimmer, SPACE, thump, tick, voxels, whoosh } from '../palette';

// ---- private helpers ------------------------------------------------------------------------------------------------------------

const TAU = Math.PI * 2;

/** A mono signal circling between the speakers (`rate` turns per second, `depth` 0..1 of the full width): smoke swirling, a vortex. */
function swirl(ctx: Ctx, x: Float32Array, rate: Param, depth: number, phase = 0): Stereo {
  const l = new Float32Array(x.length);
  const r = new Float32Array(x.length);
  const f = typeof rate === 'number' ? () => rate : rate;
  let ph = phase;
  for (let i = 0; i < x.length; i++) {
    const p = depth * Math.sin(TAU * ph);
    const a = (p + 1) * 0.25 * Math.PI;
    l[i] = x[i]! * Math.cos(a) * Math.SQRT2;
    r[i] = x[i]! * Math.sin(a) * Math.SQRT2;
    ph += f(i / ctx.sr) / ctx.sr;
  }
  return { l, r };
}

/** Narrows a stereo signal toward the centre over time (`width` 1 = as is, 0 = mono): a sound collapsing into a point. In place. */
function narrow(ctx: Ctx, st: Stereo, width: Param): Stereo {
  const w = typeof width === 'number' ? () => width : width;
  for (let i = 0; i < st.l.length; i++) {
    const m = (st.l[i]! + st.r[i]!) * 0.5;
    const s = (st.l[i]! - st.r[i]!) * 0.5 * clamp(w(i / ctx.sr), 0, 1);
    st.l[i] = m + s;
    st.r[i] = m - s;
  }
  return st;
}

/** Chops a signal into pulses at a (changing) rate: data stepping past, a rewind's flutter. In place. */
function chop(ctx: Ctx, x: Float32Array, rate: Param, duty = 0.5): Float32Array {
  const f = typeof rate === 'number' ? () => rate : rate;
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const g = ph < duty ? Math.sin((Math.PI * ph) / duty) : 0;
    x[i] = x[i]! * g;
    ph += f(i / ctx.sr) / ctx.sr;
    ph -= Math.floor(ph);
  }
  return x;
}

/** A clean tone under a percussive envelope; triangles and sines start at a zero crossing (no step at the start to ring the room). */
function tone(ctx: Ctx, wave: 'sine' | 'triangle' | 'square' | 'pulse', freq: Param, dur: number, o: { attack?: number; decay?: number; cutoff?: number; pw?: number } = {}): Float32Array {
  const s = osc(ctx, wave, freq, dur, { phase: wave === 'triangle' ? 0.25 : 0, ...(o.pw !== undefined ? { pw: o.pw } : {}) });
  mul(s, perc(ctx, o.attack ?? 0.002, o.decay ?? dur, dur));
  return o.cutoff !== undefined ? lp(ctx, s, o.cutoff, 0.7) : s;
}

/**
 * A crisp mechanical-digital clack: a square body snapping down an octave onto `f` after 3 ms, slightly bit-crushed, high-passed (no low thump), with
 * a contact tick on top. The atom of tapping, untapping, latching into the grid and slotting into a deck.
 */
function clack(ctx: Ctx, f: number, o: { dur?: number; bright?: number; tick?: number } = {}): Float32Array {
  const d = o.dur ?? 0.03;
  const body = osc(ctx, 'square', steps([f * 2, f], 0.003), d);
  mul(body, perc(ctx, 0.0004, d * 0.7, d));
  const out = hp(ctx, crush(ctx, lp(ctx, body, 2800 * (o.bright ?? 1), 0.9), 6, 2), 220);
  addInto(out, tick(ctx, { freq: 3600, dur: 0.0025, q: 0.9 }), 0, o.tick ?? 0.9);
  return out;
}

/**
 * A low-pass whose cutoff follows `cutoff(t)`, recomputed every 32 samples (0.7 ms): the same TPT state-variable filter as dsp.ts `lp`, at a
 * fraction of the cost for long, swept chords.
 */
function sweepLp(ctx: Ctx, x: Float32Array, cutoff: (t: number) => number, q = 0.707): Float32Array {
  const out = new Float32Array(x.length);
  const k = 1 / q;
  let ic1 = 0;
  let ic2 = 0;
  let a1 = 0;
  let a2 = 0;
  let a3 = 0;
  for (let i = 0; i < x.length; i++) {
    if ((i & 31) === 0) {
      const g = Math.tan((Math.PI * clamp(cutoff(i / ctx.sr), 20, ctx.sr * 0.45)) / ctx.sr);
      a1 = 1 / (1 + g * (g + k));
      a2 = g * a1;
      a3 = g * a2;
    }
    const v3 = x[i]! - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    out[i] = v2;
  }
  return out;
}

/**
 * A synth chord stab: per note two detuned voices spread left and right and a centre voice, through a low-pass that opens from `from` to `peak` Hz
 * in `open` seconds and closes to `to` (palette `stab`, cheaper: one swept filter per side).
 */
function chordStab(
  ctx: Ctx,
  notes: readonly number[],
  dur: number,
  o: { from: number; peak: number; to: number; open: number; q?: number; cents?: number; wave?: 'saw' | 'square' | 'pulse'; centre?: number },
): Stereo {
  const l = new Float32Array(Math.round(dur * ctx.sr));
  const r = new Float32Array(l.length);
  const c = o.cents ?? 12;
  const g = 1 / Math.sqrt(notes.length * 2);
  for (const f of notes) {
    addInto(l, osc(ctx, o.wave ?? 'saw', f * 2 ** (-c / 1200), dur, { phase: ctx.rand() }), 0, g);
    addInto(r, osc(ctx, o.wave ?? 'saw', f * 2 ** (c / 1200), dur, { phase: ctx.rand() }), 0, g);
    const centre = o.centre ?? 0.6;
    if (centre > 0) {
      const mid = osc(ctx, o.wave ?? 'saw', f, dur, { phase: ctx.rand() });
      addInto(l, mid, 0, g * centre);
      addInto(r, mid, 0, g * centre);
    }
  }
  const curve = (t: number) => (t < o.open ? o.from * (o.peak / o.from) ** (t / o.open) : o.peak * (o.to / o.peak) ** Math.min(1, (t - o.open) / Math.max(0.01, dur - o.open)));
  const shape = env(ctx, [[0, 0], [0.004, 1], [dur * 0.6, 0.5], [dur, 0]], dur, 'exp');
  return { l: mul(sweepLp(ctx, l, curve, o.q ?? 1.1), shape), r: mul(sweepLp(ctx, r, curve, o.q ?? 1.1), shape) };
}

/** The notes of D minor between `lo` and `hi` Hz, from the top down. */
function scaleDown(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let oct = 0; oct <= 9; oct++) for (let d = 0; d < 7; d++) {
    const f = degree(d, oct);
    if (f >= lo && f <= hi) out.push(f);
  }
  return out.sort((a, b) => b - a);
}

/** An FM laser zap falling from `from` to `to` Hz in quantized steps of the D minor scale (one note every `step` s): a digital cascade, in key. */
function stepZap(ctx: Ctx, from: number, to: number, dur: number, o: { step?: number; index?: number; ratio?: number } = {}): Float32Array {
  const all = scaleDown(to, from);
  const n = Math.max(2, Math.min(all.length, Math.round(dur / (o.step ?? 0.012))));
  const notes = Array.from({ length: n }, (_, k) => all[Math.round((k * (all.length - 1)) / (n - 1))]!);
  const s = fm(ctx, steps(notes, dur / n), dur, { ratio: o.ratio ?? 1, index: glide(o.index ?? 4, 0.3, dur, 'lin') });
  return mul(s, perc(ctx, 0.001, dur, dur));
}

/**
 * Rezzing in, the derezz reversed: tiny square and triangle grains on notes of the key, rising from `from` to `to` Hz, denser, louder and cleaner
 * (less bit-crushed) toward the end, and drawn in from the sides to the centre. A program compiling into the grid.
 */
function rezIn(ctx: Ctx, o: { dur: number; count: number; from: number; to: number; spread?: number }): Stereo {
  const mix = new Mix(ctx, o.dur + 0.04);
  for (let k = 0; k < o.count; k++) {
    // `spread` 0.5: the grains crowd toward the end; higher spreads them earlier (no hole at the start of a long build).
    const pos = ctx.rand() ** (o.spread ?? 0.5);
    const centre = o.from * (o.to / o.from) ** pos;
    const f = scaleNoteBetween(ctx, centre * 0.8, centre * 1.25);
    const d = 0.012 + ctx.rand() * 0.02;
    const g = tone(ctx, ctx.rand() < 0.5 ? 'square' : 'triangle', f, d, { attack: 0.001, decay: d, cutoff: Math.min(14000, f * 5) });
    const side = ctx.rand() < 0.5 ? -1 : 1;
    mix.add(crush(ctx, g, 4 + 8 * pos, 4 - 3 * pos), { at: Math.max(0, pos * o.dur - d), gain: (0.06 + 0.14 * pos) * (0.7 + 0.6 * ctx.rand()), pan: side * (0.2 + 0.7 * ctx.rand()) * (1 - 0.7 * pos) });
  }
  return mix.out();
}

/** The note of D minor nearest to `f` (a glide quantized to the key: it steps through the scale instead of sliding). */
function inKey(f: number): number {
  const d4 = degree(0, 4);
  const semis = 12 * Math.log2(f / d4);
  const oct = Math.floor(semis / 12);
  const within = semis - 12 * oct;
  let best = 0;
  for (const st of [0, 2, 3, 5, 7, 8, 10, 12]) if (Math.abs(st - within) < Math.abs(best - within)) best = st;
  return d4 * 2 ** ((12 * oct + best) / 12);
}

/** A mono signal panned along `pan(t)` (-1 left .. 1 right, equal power): a ripple crossing the table. */
function panned(ctx: Ctx, x: Float32Array, pan: (t: number) => number): Stereo {
  const l = new Float32Array(x.length);
  const r = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const a = (clamp(pan(i / ctx.sr), -1, 1) + 1) * 0.25 * Math.PI;
    l[i] = x[i]! * Math.cos(a) * Math.SQRT2;
    r[i] = x[i]! * Math.sin(a) * Math.SQRT2;
  }
  return { l, r };
}

/**
 * A knock that a laptop speaker can play: a square stepping through `notes` (one every `step` s), low-passed and bit-crushed, under a fast decay.
 * The 150-600 Hz body of a landing or a strike, where a sub thump alone would vanish on small speakers.
 */
function knock(ctx: Ctx, notes: readonly number[], dur: number, o: { step?: number; cutoff?: number; bits?: number } = {}): Float32Array {
  const s = tone(ctx, 'square', steps(notes, o.step ?? 0.012), dur, { attack: 0.001, decay: dur, cutoff: o.cutoff ?? 1800 });
  return crush(ctx, s, o.bits ?? 8, 1);
}

/** A low, soft thud (pink noise under a low-pass): the body of something settling on the table. */
function thud(ctx: Ctx, o: { dur?: number; cutoff?: number } = {}): Float32Array {
  const d = o.dur ?? 0.07;
  return mul(lp(ctx, noise(ctx, d, 'pink'), o.cutoff ?? 700, 0.7), perc(ctx, 0.001, d * 0.85, d));
}

// ---- recipes ---------------------------------------------------------------------------------------------------------------------

export const CARD_SOUNDS: Partial<Record<SoundId, Recipe>> = {
  'card.draw': (ctx) => {
    // A quick data pull: a short rising swish, a 10 ms pickup blip, then the landing note a fourth higher as its own triangle (it carries the energy
    // and the room tail), marked as a grid event by a crushed square tick and a faint D7 glint. Variants land on D6, F6 or A5 (a D minor triad), so
    // the opening hand's seven draws, 90 ms apart, sparkle as a broken chord instead of one repeated note. No low end.
    const v = ctx.variant % 3;
    const [from, to] = ([[hz('A5'), hz('D6')], [hz('C6'), hz('F6')], [hz('E5'), hz('A5')]] as const)[v]!;
    const pan = [-0.12, 0.12, 0][v]!;
    const L = 0.012;
    const m = new Mix(ctx, 0.3);
    m.add(whoosh(ctx, { dur: 0.08, from: 1300, to: 6500, q: 1.6, peak: 0.4 }), { gain: 0.45, pan, send: 0.1 });
    m.add(tick(ctx, { freq: 5200, dur: 0.002 }), { gain: 0.12 });
    m.add(tone(ctx, 'triangle', from, 0.012, { attack: 0.001, decay: 0.01 }), { at: 0.001, gain: 0.25, pan });
    m.add(tone(ctx, 'triangle', to, 0.14, { attack: 0.002, decay: 0.12 }), { at: L, gain: 0.55, pan, send: 0.15 });
    m.add(tone(ctx, 'square', to / 2, 0.06, { decay: 0.04, cutoff: 1600 }), { at: L, gain: 0.1, pan });
    m.add(crush(ctx, tone(ctx, 'square', to * 2, 0.004, { attack: 0.0005, decay: 0.003 }), 6, 2), { at: L, gain: 0.12, pan });
    m.add(crystal(ctx, { freq: hz('D7'), dur: 0.1, bright: 0.3 }), { at: L + 0.002, gain: 0.05, pan: -pan, send: 0.3 });
    return m.out({ space: SPACE.table });
  },

  'card.land': (ctx) => {
    // Solid and grounded, in one gesture: a short falling rush, then the touchdown on the squash frame (45 ms): a crushed square knock stepping D4 ->
    // D3 (the body a laptop hears), a thump from 260 Hz down to D2, a thud and two latch clacks as it locks into its grid cell (ka-chunk). The land
    // powers up straight out of the impact: a D4-A4-D5 pulse chord behind a resonant filter peaking 90 ms after the touchdown, settling, and a grid
    // line lights: a crushed D5 -> A5 flick at the filter peak and a crystal D6 glint echoing across the table.
    const T = 0.045;
    const m = new Mix(ctx, 0.63);
    m.add(whoosh(ctx, { dur: T + 0.015, from: 2600, to: 600, q: 1.2, peak: 0.85 }), { gain: 0.25 });
    m.add(knock(ctx, [hz('D4'), hz('D3')], 0.05, { step: 0.02, cutoff: 1800, bits: 8 }), { at: T, gain: 0.65, send: 0.1 });
    m.add(thump(ctx, { from: 260, to: hz('D2'), drop: 0.03, dur: 0.38 }), { at: T, gain: 0.32 });
    m.add(thud(ctx, { dur: 0.08, cutoff: 900 }), { at: T, gain: 0.4 });
    m.add(clack(ctx, hz('D4'), { dur: 0.04, bright: 0.9 }), { at: T + 0.002, gain: 0.6, send: 0.12 });
    m.add(clack(ctx, hz('A3'), { dur: 0.04, bright: 0.8 }), { at: T + 0.05, gain: 0.45, pan: 0.05, send: 0.12 });
    const pd = 0.42;
    const power = new Mix(ctx, pd);
    for (const [f, g] of [[hz('D4'), 0.5], [hz('A4'), 0.4], [hz('D5'), 0.3]] as const) {
      power.add(osc(ctx, 'pulse', f, pd, { pw: 0.3, phase: ctx.rand() }), { gain: g, pan: -0.35 });
      power.add(osc(ctx, 'pulse', f * 1.005, pd, { pw: 0.3, phase: ctx.rand() }), { gain: g, pan: 0.35 });
    }
    const pk = 0.08;
    const sweep = (t: number) => (t < pk ? 300 * (3200 / 300) ** (t / pk) : 3200 * (700 / 3200) ** Math.min(1, (t - pk) / 0.3));
    const pw = power.out();
    const opened = { l: sweepLp(ctx, pw.l, sweep, 1.6), r: sweepLp(ctx, pw.r, sweep, 1.6) };
    const shape = env(ctx, [[0, 0], [0.012, 0.5], [pk, 1], [pd, 0]], pd, 'exp');
    mul(opened.l, shape);
    mul(opened.r, shape);
    m.addStereo(opened, { at: T + 0.01, gain: 0.32, send: 0.25 });
    m.add(crush(ctx, tone(ctx, 'square', steps([hz('D5'), hz('A5')], 0.012), 0.03, { attack: 0.001, decay: 0.028, cutoff: 4000 }), 6, 2), { at: T + 0.09, gain: 0.2, pan: 0.1, send: 0.3 });
    m.add(crystal(ctx, { freq: hz('D6'), dur: 0.3, bright: 0.5 }), { at: T + 0.09, gain: 0.26, pan: 0.25, send: 0.45 });
    return m.out({ space: SPACE.table, echo: { time: 0.12, feedback: 0.3, mix: 0.32, pingpong: true, damp: 4000 } });
  },

  'card.enter': (ctx) => {
    // Materialized: rez grains converge upward and inward into the touchdown (the derezz in reverse) on a short rising rush; the card lands with
    // weight (sub thump, thud, a crushed D3+A3 knock) and a bright open-fifth saw stab on D opens and closes, a program rezzing in; crystals and a
    // shimmer of light settle.
    const T = 0.055;
    const m = new Mix(ctx, 0.72);
    m.addStereo(rezIn(ctx, { dur: T, count: 16, from: 1400, to: 5000 }), { gain: 1.0, send: 0.3 });
    m.add(whoosh(ctx, { dur: T + 0.01, from: 900, to: 5000, q: 1.8, peak: 0.9 }), { gain: 0.3, send: 0.15 });
    m.add(thump(ctx, { from: 150, to: hz('D2'), drop: 0.05, dur: 0.3 }), { at: T, gain: 0.55 });
    m.add(thud(ctx, { dur: 0.06, cutoff: 900 }), { at: T, gain: 0.3 });
    const kn = knock(ctx, [hz('D3')], 0.04, { cutoff: 2000, bits: 8 });
    addInto(kn, knock(ctx, [hz('A3')], 0.04, { cutoff: 2000, bits: 8 }), 0, 0.8);
    m.add(kn, { at: T, gain: 0.3, send: 0.1 });
    const chord = [hz('D3'), hz('A3'), hz('D4'), hz('A4'), hz('D5')];
    m.addStereo(chordStab(ctx, chord, 0.42, { from: 400, peak: 4200, to: 600, open: 0.018, q: 1.0, cents: 12 }), { at: T, gain: 0.45, send: 0.3 });
    m.add(crystal(ctx, { freq: hz('A5'), dur: 0.4, bright: 0.6 }), { at: T, gain: 0.3, pan: -0.2, send: 0.4 });
    m.add(crystal(ctx, { freq: hz('D6'), dur: 0.35, bright: 0.5 }), { at: T + 0.02, gain: 0.24, pan: 0.25, send: 0.4 });
    m.addStereo(shimmer(ctx, { dur: 0.26, density: 60, lo: 1600, hi: 4000, grain: 0.08 }), { at: T + 0.01, gain: 1.3, send: 0.4 });
    return m.out({ space: SPACE.table, echo: { time: 0.14, feedback: 0.28, mix: 0.3, pingpong: true, damp: 4500 } });
  },

  'card.enterHeavy': (ctx) => {
    // card.enter's arrival, much bigger, so it keeps the grid identity: the same rez grains converging into the touchdown, then the ground shakes.
    // A sub thump falling to A1 with a 60 ms crushed D3+A3 square knock on top (the weight a laptop can play), a driven low D power-chord stab whose
    // filter closes to 700 Hz, a crushed crack of the grid floor, a grid ripple (a crushed square stepping A4 F4 D4 A3 D3 while it crosses the table
    // left to right), a short rumble trembling at the rate of the table shake, an aftershock 150 ms later, and crystal glints on D5 and A5.
    const T = 0.06;
    const m = new Mix(ctx, 1.0);
    m.addStereo(rezIn(ctx, { dur: T, count: 16, from: 700, to: 3200 }), { gain: 1.0, send: 0.3 });
    m.add(whoosh(ctx, { dur: T + 0.015, from: 500, to: 3200, q: 1.4, peak: 0.9, tone: 0.3 }), { gain: 0.2, send: 0.15 });
    m.add(thump(ctx, { from: 130, to: hz('A1'), drop: 0.08, dur: 0.6 }), { at: T, gain: 0.45 });
    m.add(thud(ctx, { dur: 0.14, cutoff: 600 }), { at: T, gain: 0.3 });
    const kd = 0.06;
    const k1 = knock(ctx, [hz('D3')], kd, { cutoff: 2000, bits: 7 });
    addInto(k1, knock(ctx, [hz('A3')], kd, { cutoff: 2000, bits: 7 }), 0, 0.8);
    m.add(k1, { at: T, gain: 0.9, send: 0.15 });
    let crack = lp(ctx, noise(ctx, 0.3), glide(7000, 500, 0.18), 0.8);
    mul(crack, env(ctx, [[0, 0], [0.002, 1], [0.05, 0.35], [0.3, 0]], 0.3, 'exp'));
    crack = crush(ctx, drive(crack, 2.2), 6, 3);
    m.add(crack, { at: T, gain: 0.45, send: 0.25 });
    const rd = 0.125;
    const ripple = crush(ctx, tone(ctx, 'square', steps(['A4', 'F4', 'D4', 'A3', 'D3'].map(hz), 0.025), rd, { attack: 0.001, decay: rd * 1.6, cutoff: 3000 }), 6, 2);
    m.addStereo(panned(ctx, ripple, (t) => -0.8 + 1.6 * (t / rd)), { at: T + 0.005, gain: 0.45, send: 0.3 });
    const chord = [hz('D2'), hz('D3'), hz('A3'), hz('D4'), hz('A4')];
    const st = chordStab(ctx, chord, 0.65, { from: 250, peak: 4200, to: 700, open: 0.022, q: 1.1, cents: 9, centre: 0.8 });
    drive(st.l, 2.5);
    drive(st.r, 2.5);
    m.addStereo(st, { at: T, gain: 0.7, send: 0.25 });
    // The table shakes: a short low rumble trembling at about 14 Hz.
    const rmd = 0.45;
    const rumble = lp(ctx, noise(ctx, rmd, 'brown'), 190, 0.8);
    const shake = osc(ctx, 'sine', glide(15, 10, rmd), rmd);
    for (let i = 0; i < rumble.length; i++) rumble[i] = rumble[i]! * (0.5 + 0.5 * shake[i]!);
    mul(rumble, env(ctx, [[0, 0], [0.01, 1], [0.18, 0.5], [rmd, 0]], rmd, 'exp'));
    m.add(rumble, { at: T, gain: 0.15 });
    m.add(thump(ctx, { from: 160, to: hz('D2') * 0.75, drop: 0.05, dur: 0.3 }), { at: T + 0.15, gain: 0.34 });
    m.add(crystal(ctx, { freq: hz('D5'), dur: 0.55, bright: 0.5 }), { at: T, gain: 0.32, pan: 0.2, send: 0.45 });
    m.add(crystal(ctx, { freq: hz('A5'), dur: 0.45, bright: 0.4 }), { at: T + 0.02, gain: 0.2, pan: -0.25, send: 0.45 });
    return m.out({ space: SPACE.table, echo: { time: 0.16, feedback: 0.3, mix: 0.3, pingpong: true, damp: 3500 } });
  },

  'card.token': (ctx) => {
    // Compiled from nothing: a white flash; at 0.08 s, as the token snaps to full size (the scale-up overshoots there), a crushed square snap D5 ->
    // A5 with a tick; meanwhile bits of light keep assembling upward, denser and cleaner (rez grains spread from the start, a chopped scan stepping
    // up the D minor chord, a rising rush) until the motes converge at 0.3 s: a puff of light, a soft D pop and bloom with a crystal glint. No sub,
    // no thump: lighter than a card entering.
    const C = 0.3;
    const m = new Mix(ctx, 0.62);
    m.add(mul(hp(ctx, noise(ctx, 0.05), 5000), perc(ctx, 0.001, 0.04, 0.05)), { gain: 0.2, send: 0.4 });
    m.add(crystal(ctx, { freq: hz('D7'), dur: 0.14, bright: 0.3 }), { gain: 0.1, pan: 0.3, send: 0.4 });
    m.addStereo(rezIn(ctx, { dur: C, count: 50, from: 600, to: 4000, spread: 0.7 }), { at: 0.012, gain: 1.3, send: 0.3 });
    const N = 0.08;
    m.add(crush(ctx, tone(ctx, 'square', steps([hz('D5'), hz('A5')], 0.005), 0.012, { attack: 0.0005, decay: 0.011, cutoff: 5000 }), 6, 2), { at: N, gain: 0.35, send: 0.3 });
    m.add(tick(ctx, { freq: 3000, dur: 0.002 }), { at: N, gain: 0.35, send: 0.3 });
    const run = [hz('D4'), hz('F4'), hz('A4'), hz('D5'), hz('F5'), hz('A5'), hz('D6')];
    const step = (C - 0.02) / run.length;
    const sd = run.length * step;
    const scanTone = osc(ctx, 'square', (t) => run[clamp(Math.floor(t / step), 0, run.length - 1)]!, sd);
    chop(ctx, scanTone, 60, 0.5);
    const scanF = lp(ctx, scanTone, 2400, 0.8);
    mul(scanF, env(ctx, [[0, 0], [0.03, 0.3], [sd - 0.01, 1], [sd, 0]], sd, 'lin'));
    m.add(scanF, { at: 0.01, gain: 0.07, send: 0.25 });
    m.add(whoosh(ctx, { dur: C, from: 800, to: 5000, q: 2, peak: 0.95 }), { gain: 0.18, send: 0.2 });
    m.add(mul(bp(ctx, noise(ctx, 0.03), 3000, 0.8), perc(ctx, 0.001, 0.025, 0.03)), { at: C, gain: 0.18, send: 0.3 });
    m.add(tone(ctx, 'sine', steps([hz('A5'), hz('D5')], 0.008), 0.3, { attack: 0.002, decay: 0.26 }), { at: C, gain: 0.25, send: 0.3 });
    m.add(tone(ctx, 'triangle', hz('A5'), 0.24, { attack: 0.003, decay: 0.2 }), { at: C, gain: 0.1, pan: -0.15, send: 0.4 });
    m.add(crystal(ctx, { freq: hz('D6'), dur: 0.32, bright: 0.6 }), { at: C, gain: 0.18, pan: 0.15, send: 0.45 });
    return m.out({ space: SPACE.table, echo: { time: 0.11, feedback: 0.3, mix: 0.3, pingpong: true, damp: 5000 } });
  },

  'card.destroy': (ctx) => {
    // Derezz, on the beats of the animation. 1. Struck (0 s): a mid knock with a crushed crack (no sub: the blow before it has the weight). 2.
    // Swelling (to 0.32 s, the card lifts and a white-hot rim builds): a crushed saw whine climbing the D minor scale D3 -> D4 in quantized steps
    // (charging) and shuddering faster, a hiss heating up, bit-crushed crackle getting denser, a crescendo cut dead by 3. the shatter (0.32 s, the
    // break flash): a bright break, glassy shards, a short sub drop under a crushed knock, a laser zap stepping down the scale, and the program
    // bursts into falling voxels while its tone powers down in slowing steps into grit. Variants: the tone powers down from D or F, and the grains
    // scatter differently.
    const v = ctx.variant % 2;
    const S = 0.32;
    const m = new Mix(ctx, 1.0);
    // 1. Struck.
    m.add(thump(ctx, { from: 300, to: hz('A2'), drop: 0.04, dur: 0.12 }), { gain: 0.3 });
    m.add(mul(bp(ctx, noise(ctx, 0.03), 2800, 0.8), perc(ctx, 0.0005, 0.022, 0.03)), { gain: 0.4 });
    m.add(crush(ctx, tone(ctx, 'square', steps([hz('D3'), hz('A2'), hz('D2')], 0.02), 0.08, { attack: 0.001, decay: 0.07 }), 4, 6), { gain: 0.18, send: 0.1 });
    // 2. Swelling.
    const climb = ['D3', 'E3', 'F3', 'G3', 'A3', 'Bb3', 'C4', 'D4'].map(hz);
    const whine = osc(ctx, 'saw', steps(climb, S / climb.length), S);
    const trem = osc(ctx, 'sine', glide(14, 34, S), S);
    for (let i = 0; i < whine.length; i++) whine[i] = whine[i]! * (0.65 + 0.35 * trem[i]!);
    const hot = crush(ctx, sweepLp(ctx, whine, glide(500, 3200, S), 1.6), glide(10, 5, S, 'lin'), glide(1, 4, S, 'lin'));
    mul(hot, env(ctx, [[0, 0], [0.03, 0.22], [S - 0.008, 1], [S, 0]], S, 'exp'));
    m.add(hot, { at: 0.01, gain: 0.7, send: 0.2 });
    const hiss = hp(ctx, sweepLp(ctx, noise(ctx, S), glide(3000, 9000, S), 0.8), glide(1500, 4000, S));
    mul(hiss, env(ctx, [[0, 0], [0.04, 0.08], [S - 0.008, 1], [S, 0]], S, 'exp'));
    m.add(hiss, { gain: 0.2, send: 0.2 });
    for (let k = 0; k < 12; k++) {
      const t = 0.04 + Math.sqrt(ctx.rand()) * (S - 0.06);
      const f = scaleNoteBetween(ctx, 1500, 5000);
      const g = crush(ctx, tone(ctx, 'square', f, 0.008, { attack: 0.0005, decay: 0.007 }), 5, 3);
      m.add(g, { at: t, gain: 0.06 + 0.16 * (t / S), pan: ctx.rand() * 1.4 - 0.7, send: 0.2 });
    }
    // 3. Shatter.
    m.add(mul(hp(ctx, noise(ctx, 0.1), 1400), perc(ctx, 0.0005, 0.08, 0.1)), { at: S, gain: 0.5, send: 0.3 });
    for (let k = 0; k < 3; k++) {
      const f = scaleNoteBetween(ctx, 1100, 3000);
      const shard = modes(ctx, f, 0.3, [1, 1.47, 2.13, 2.92], [0.28, 0.18, 0.11, 0.07], [1, 0.5, 0.35, 0.2]);
      m.add(shard, { at: S + k * 0.006, gain: 0.1, pan: (k - 1) * 0.45, send: 0.35 });
    }
    m.add(thump(ctx, { from: 130, to: 40, drop: 0.06, dur: 0.25 }), { at: S, gain: 0.45 });
    m.add(knock(ctx, [hz('A3'), hz('D3')], 0.07, { step: 0.015, cutoff: 2200, bits: 6 }), { at: S, gain: 0.3, send: 0.2 });
    m.add(crush(ctx, stepZap(ctx, 2600, 280, 0.15, { step: 0.011, index: 5 }), 8, 2), { at: S, gain: 0.3, send: 0.2 });
    m.addStereo(voxels(ctx, { dur: 0.58, count: 38, from: 4400, to: 300 }), { at: S + 0.006, gain: 2.45, send: 0.35 });
    // The power-down: a square falling through the D minor chord in steps that slow down like a dying machine.
    const fallNotes = (v ? ['F5', 'D5', 'A4', 'F4', 'D4', 'A3'] : ['D5', 'A4', 'F4', 'D4', 'A3', 'F3']).map(hz);
    const starts = fallNotes.map((_, k) => 0.045 * (1.3 ** k - 1) / 0.3);
    const noteAt = (t: number) => {
      let k = 0;
      while (k + 1 < starts.length && t >= starts[k + 1]!) k++;
      return fallNotes[k]!;
    };
    const pow = osc(ctx, 'square', noteAt, 0.55);
    const down = lp(ctx, pow, 2400, 0.7);
    mul(down, perc(ctx, 0.004, 0.5, 0.55));
    m.add(crush(ctx, down, glide(8, 3, 0.45, 'lin'), glide(1, 12, 0.45, 'lin')), { at: S + 0.01, gain: 0.17, send: 0.25 });
    return m.out({ space: SPACE.table });
  },

  'card.sacrifice': (ctx) => {
    // Given up, not broken: no crack, no grit, no shards. The card lifts and glows slowly (until about 0.44 s), then is pulled down (0.44-0.64 s). A
    // dark detuned FM dyad (D4 over A3, a touch of ring modulation: shadow) holds and swells, its FM index rising, while purple smoke swirls around
    // it (band-passed noise through a flanger, circling the speakers); at 0.40 s both plunge, the dyad gliding down about 1.5 octaves (to A2 and D2)
    // and the smoke falling and circling faster; at 0.62 s, as the card is gone, the table swallows it: a low gulp, a tick and a mid voice D4 -> A3.
    const d = 0.66;
    const H = 0.4;
    const m = new Mix(ctx, 0.84);
    const a = fm(ctx, glide(hz('D4'), hz('A2'), 0.23, 'exp', H), d, { ratio: 1, index: (t) => (t < H ? 1.8 + 1.2 * (t / H) : 3 - 2.7 * Math.min(1, (t - H) / 0.26)) });
    const b = fm(ctx, glide(hz('A3') * 1.006, hz('D2') * 1.006, 0.23, 'exp', H), d, { ratio: 1, index: (t) => (t < H ? 1.5 + 1 * (t / H) : 2.5 - 2.2 * Math.min(1, (t - H) / 0.26)) });
    const dyad = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) dyad[i] = a[i]! * 0.6 + b[i]! * 0.45;
    const dark = lp(ctx, ring(ctx, dyad, 37, 0.25), (t) => (t < H ? 2400 : 2400 * (350 / 2400) ** Math.min(1, (t - H) / 0.24)), 0.8);
    mul(dark, env(ctx, [[0, 0], [0.04, 0.7], [H, 1], [0.6, 0.45], [d, 0]], d, 'exp'));
    m.addStereo(swirl(ctx, dark, 0.9, 0.35), { gain: 0.38, send: 0.3 });
    const sd = 0.66;
    const band = (t: number) => (t < H ? 2600 : 2600 * (300 / 2600) ** Math.min(1, (t - H) / 0.24));
    const smoke = flange(ctx, bp(ctx, noise(ctx, sd, 'pink'), band, 1.8), { rate: 1.3, depth: 0.004, base: 0.0012, feedback: 0.75, mix: 0.5 });
    mul(smoke, env(ctx, [[0, 0], [0.12, 0.6], [H + 0.03, 1], [sd, 0]], sd, 'lin'));
    m.addStereo(swirl(ctx, smoke, (t) => (t < H ? 1.2 : 1.2 + 9 * (t - H)), 0.85, 0.25), { gain: 0.71, send: 0.35 });
    const G = 0.62;
    m.add(lp(ctx, thump(ctx, { from: 110, to: 45, drop: 0.08, dur: 0.2 }), 300), { at: G, gain: 0.2 });
    m.add(tone(ctx, 'triangle', steps([hz('D4'), hz('A3')], 0.03), 0.1, { attack: 0.003, decay: 0.09, cutoff: 900 }), { at: G, gain: 0.25, send: 0.2 });
    m.add(tick(ctx, { freq: 2500, dur: 0.002 }), { at: G, gain: 0.15 });
    return m.out({ space: SPACE.table });
  },

  'card.exile': (ctx) => {
    // Banished: a white flare (a bright air burst and a crystal D chord), then a reverse swell (the room tail of a high crystal chord played
    // backwards) and a tone rising D5 -> D7 while the stereo image collapses into the centre, until a tiny high ping at the vanishing point (0.5 s,
    // when the card is a point) echoes away into nothing.
    const P = 0.5;
    const m = new Mix(ctx, 0.83);
    m.add(mul(hp(ctx, noise(ctx, 0.14), 3000), perc(ctx, 0.002, 0.12, 0.14)), { gain: 0.28, send: 0.4 });
    for (const [f, pan] of [[hz('D6'), -0.3], [hz('A6'), 0.3], [hz('D5'), 0]] as const) {
      m.add(crystal(ctx, { freq: f, dur: 0.22, bright: 0.5 }), { gain: 0.32, pan, send: 0.35 });
    }
    const src = new Mix(ctx, P);
    src.add(crystal(ctx, { freq: hz('D6'), dur: 0.12, bright: 0.5 }), { pan: -0.5 });
    src.add(crystal(ctx, { freq: hz('A6'), dur: 0.12, bright: 0.5 }), { pan: 0.5 });
    src.add(crystal(ctx, { freq: hz('F6'), dur: 0.12, bright: 0.5 }), { pan: 0 });
    const tail = reverb(ctx, src.dry, { ...SPACE.table, decay: 0.8, predelay: 0 });
    const swell: Stereo = { l: tail.l.slice().reverse(), r: tail.r.slice().reverse() };
    const fadeIn = env(ctx, [[0, 0], [0.12, 0.6], [P - 0.012, 1], [P, 0]], P, 'lin');
    mul(swell.l, fadeIn);
    mul(swell.r, fadeIn);
    narrow(ctx, swell, glide(1, 0, P, 'lin'));
    m.addStereo(swell, { gain: 1.6, send: 0.1 });
    const rise = osc(ctx, 'sine', glide(hz('D5'), hz('D7'), P), P);
    mul(rise, env(ctx, [[0, 0], [0.15, 0.25], [P - 0.015, 1], [P, 0]], P, 'exp'));
    m.add(rise, { gain: 0.14, send: 0.2 });
    m.add(whoosh(ctx, { dur: P, from: 700, to: 9000, q: 2.5, peak: 0.94 }), { gain: 0.14 });
    m.add(tone(ctx, 'sine', hz('D7'), 0.14, { attack: 0.001, decay: 0.12 }), { at: P, gain: 0.75, send: 0.5 });
    m.add(crystal(ctx, { freq: hz('A7'), dur: 0.08, bright: 0.2 }), { at: P, gain: 0.14, send: 0.5 });
    return m.out({ space: SPACE.table, echo: { time: 0.085, feedback: 0.45, mix: 0.5, pingpong: true, damp: 6000 } });
  },

  'card.bounce': (ctx) => {
    // Recalled: it unlatches (card.land's two latch clacks in reverse order, A3 then D4), then a reverse whoosh (it swells and stops dead) climbs
    // back toward the hand with a triangle tone rewinding up two octaves through the D minor scale in faster and faster flutters, and a soft
    // two-note pop (A5 -> D6) as it settles in the hand at about 0.3 s.
    const d = 0.3;
    const m = new Mix(ctx, 0.43);
    m.add(clack(ctx, hz('A3'), { dur: 0.03, bright: 0.8 }), { gain: 0.13, pan: -0.05, send: 0.12 });
    m.add(clack(ctx, hz('D4'), { dur: 0.03, bright: 0.9 }), { at: 0.03, gain: 0.13, pan: 0.05, send: 0.12 });
    const back = whoosh(ctx, { dur: d, from: 4500, to: 700, q: 1.6, peak: 0.22 }).reverse();
    m.add(back, { gain: 0.5, send: 0.2 });
    const sweepUp = glide(hz('D4'), hz('D6'), d);
    const rew = osc(ctx, 'triangle', (t) => inKey(sweepUp(t)), d, { phase: 0.25 });
    chop(ctx, rew, glide(16, 50, d), 0.55);
    const rewF = lp(ctx, rew, 3600, 0.7);
    mul(rewF, env(ctx, [[0, 0], [0.12, 0.35], [d - 0.01, 1], [d, 0]], d, 'exp'));
    m.add(rewF, { gain: 0.22, send: 0.2 });
    m.add(tone(ctx, 'triangle', hz('A5'), 0.04, { attack: 0.002, decay: 0.035 }), { at: 0.295, gain: 0.32, pan: -0.08, send: 0.2 });
    m.add(tone(ctx, 'triangle', hz('D6'), 0.06, { attack: 0.002, decay: 0.055 }), { at: 0.325, gain: 0.36, pan: 0.08, send: 0.2 });
    return m.out({ space: SPACE.table });
  },

  'card.toGraveyard': (ctx) => {
    // Filed away: a tiny tick as it leaves (so each card of a mill is heard), a soft falling swish with a lightly crushed triangle gliding down a
    // fifth (A4 -> D4) under it, then the settle on the pile as the card arrives (0.34 s): a 6-bit square blip D5 -> A4 over a low A3 -> D3, a muted
    // thud, and a few crushed grains of light falling after it (a small echo of the derezz). Short and soft: mills put several in a row.
    const P = 0.34;
    const m = new Mix(ctx, 0.415);
    m.add(tick(ctx, { freq: 3500, dur: 0.002 }), { gain: 0.22 });
    m.add(whoosh(ctx, { dur: P, from: 4200, to: 500, q: 1.3, peak: 0.35 }), { gain: 0.85, send: 0.15 });
    const fall = osc(ctx, 'triangle', glide(hz('A4'), hz('D4'), 0.07), 0.3);
    mul(fall, env(ctx, [[0, 0], [0.015, 1], [0.15, 0.6], [0.3, 0]], 0.3, 'exp'));
    m.add(crush(ctx, fall, 10, 2), { gain: 0.12, send: 0.2 });
    m.add(crush(ctx, tone(ctx, 'square', steps([hz('D5'), hz('A4')], 0.012), 0.03, { attack: 0.001, decay: 0.028, cutoff: 3000 }), 6, 2), { at: P, gain: 0.3, send: 0.15 });
    m.add(tone(ctx, 'sine', steps([hz('A3'), hz('D3')], 0.015), 0.06, { attack: 0.002, decay: 0.05 }), { at: P, gain: 0.18 });
    m.add(thud(ctx, { dur: 0.05, cutoff: 800 }), { at: P, gain: 0.12 });
    m.addStereo(voxels(ctx, { dur: 0.05, count: 5, from: 1800, to: 600 }), { at: P, gain: 0.3, send: 0.3 });
    return m.out({ space: SPACE.table });
  },

  'card.toLibrary': (ctx) => {
    // Tucked away: a level sliding swish with a crushed riffle running along it (four square ticks 22 ms apart, the edge of a deck flicking past:
    // the game.shuffle family), then as it arrives (0.34 s) one soft clack on D4 and an A3 "seat" as it slots into the deck. No held tone.
    const S = 0.34;
    const m = new Mix(ctx, 0.415);
    m.add(whoosh(ctx, { dur: S, from: 1300, to: 2600, q: 2.4, peak: 0.6 }), { gain: 0.6, send: 0.15 });
    ['A6', 'F6', 'G6', 'D6'].map(hz).forEach((f, k) => {
      const tk = crush(ctx, tone(ctx, 'square', f, 0.009, { attack: 0.0005, decay: 0.008, cutoff: 6000 }), 6, 2);
      m.add(tk, { at: 0.22 + k * 0.022, gain: 0.22 + 0.04 * k, pan: k % 2 ? 0.3 : -0.3, send: 0.15 });
    });
    m.add(clack(ctx, hz('D4'), { bright: 1.1, dur: 0.03 }), { at: S, gain: 0.32, send: 0.15 });
    m.add(knock(ctx, [hz('A3')], 0.045, { cutoff: 1400, bits: 8 }), { at: S + 0.012, gain: 0.25, send: 0.1 });
    return m.out({ space: SPACE.table });
  },

  'card.tap': (ctx) => {
    // A tiny crisp clack: a square snapping down onto its note (crushed a little, high-passed: no low end) over a short 6-bit pulse blip on the note
    // (a digital relay, 30 ms), then the click of the detent as the card settles sideways 20 ms later. Variants move the note by a scale step (D5,
    // C5, E5).
    const v = ctx.variant % 3;
    const f = [hz('D5'), hz('C5'), hz('E5')][v]!;
    const m = new Mix(ctx, 0.11);
    m.add(clack(ctx, f / 2, { dur: 0.022, bright: 1.5 }), { gain: 0.7, send: 0.1 });
    m.add(tick(ctx, { freq: 6500, dur: 0.002, q: 0.8 }), { gain: 0.4 });
    m.add(crush(ctx, tone(ctx, 'pulse', f, 0.035, { pw: 0.3, attack: 0.0005, decay: 0.03, cutoff: 3000 }), 6, 1), { gain: 0.22, send: 0.12 });
    const at = 0.019 + 0.003 * v;
    m.add(tone(ctx, 'triangle', f * 2, 0.02, { attack: 0.001, decay: 0.014 }), { at, gain: 0.12, pan: 0.1, send: 0.15 });
    m.add(tick(ctx, { freq: 5200, dur: 0.0015 }), { at, gain: 0.2, pan: 0.1 });
    return m.out({ space: SPACE.ui });
  },

  'card.untap': (ctx) => {
    // Everything ready again, in one smooth reset sweep (not a staircase, and only D and A): a ratchet of small clacks (the taps undone) under a
    // rising whoosh, while one pulse voice glides D5 -> D6 over 0.1 s, its filter opening and its image crossing left to right, and settles on D6
    // over a soft D5. Played once for the whole board.
    const m = new Mix(ctx, 0.41);
    m.add(whoosh(ctx, { dur: 0.17, from: 700, to: 6000, q: 1.4, peak: 0.7 }), { gain: 0.45, send: 0.15 });
    for (let k = 0; k < 4; k++) {
      m.add(clack(ctx, [hz('D4'), hz('A4'), hz('D5'), hz('A4')][k]!, { dur: 0.022 }), { at: k * 0.028, gain: 0.3 - k * 0.04, pan: -0.3 + k * 0.2 });
    }
    const G = 0.1;
    const sd = 0.2;
    const sw = osc(ctx, 'pulse', glide(hz('D5'), hz('D6'), G), sd, { pw: 0.35 });
    const swF = sweepLp(ctx, sw, (t) => 1200 * (4500 / 1200) ** Math.min(1, t / G), 0.9);
    mul(swF, env(ctx, [[0, 0], [0.01, 0.35], [G, 1], [sd, 0]], sd, 'exp'));
    m.addStereo(panned(ctx, swF, (t) => -0.4 + 0.7 * Math.min(1, t / G)), { at: 0.012, gain: 0.3, send: 0.2 });
    m.add(tone(ctx, 'sine', hz('D5'), 0.14, { decay: 0.12 }), { at: 0.012 + G, gain: 0.18 });
    m.add(tone(ctx, 'triangle', hz('A5'), 0.1, { decay: 0.08 }), { at: 0.012 + G, gain: 0.07, pan: -0.2, send: 0.2 });
    return m.out({ space: SPACE.table, echo: { time: 0.085, feedback: 0.15, mix: 0.2, pingpong: true, damp: 4500 } });
  },
};
