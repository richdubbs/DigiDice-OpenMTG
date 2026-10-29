/**
 * Spell sounds (docs/design/sound.md "Spells"): the casts and impacts of the seven spell looks (board/fx/plan.ts SpellStyle). Each element is played
 * on the grid's instruments, as if the grid simulated it: fire is crushed noise, driven saws and sample-and-hold embers; lightning fast FM zaps and
 * crackle; arcane FM bells and phasing; shadow low detuned FM, ring modulation and reversed swells; nature resonant synth plucks and a resonant saw
 * "vine"; radiant a gated D major chord, crystal and a white flash; force clean sine and square pulses and a pressure wave.
 *
 * Two chassis keep the fourteen one family. A cast charges for the card's flight (0 - 0.44 s), each element with its own gesture (fire a stepped roar,
 * lightning a capacitor whine, arcane a phasing bell trill, shadow a reversed inhale, nature a growing vine, radiant an accelerating tremolo, force a
 * rail-gun pulse train), releases on its arrival on the stack (0.44 s: the element's flare over a shared sub pulse) and rings out in the table room
 * with the same ping-pong echo. An impact strikes at once (a 1 ms transient), its body falls 12 dB within 70 ms (the spacing of a spell's several
 * impacts) over a short kick on D2, and it has no echo, so impacts landing 70 ms apart stay separate.
 */
import type { Recipe, SoundId } from '../catalog';
import {
  bp,
  compress,
  crush,
  drive,
  env,
  flange,
  fm,
  glide,
  hp,
  len,
  lp,
  Mix,
  mul,
  noise,
  osc,
  perc,
  pluck,
  reverse,
  ring,
  type Ctx,
  type Param,
  type Stereo,
  type Wave,
} from '../dsp';
import { crystal, D_MAJOR, hz, scaleNoteBetween, shimmer, SPACE, thump, tick } from '../palette';

// ---- timing ---------------------------------------------------------------------------------------------------------------------

/** A cast: the card's flight to the stack takes about 0.44 s; the release lands with it. */
const CAST_DUR = 0.86;
const R = 0.44;
/** An impact: immediate attack, body down 12 dB by 70 ms, tail faded out by 0.7 s. */
const IMPACT_DUR = 0.7;

const TAU = Math.PI * 2;

// ---- small helpers --------------------------------------------------------------------------------------------------------------

type Pt = readonly [number, number];

function fnOf(p: Param): (t: number) => number {
  return typeof p === 'number' ? () => p : p;
}

/** `x` times a breakpoint envelope as long as `x`. */
function shape(ctx: Ctx, x: Float32Array, points: readonly Pt[], curve: 'lin' | 'exp' = 'exp'): Float32Array {
  return mul(x, env(ctx, points, x.length / ctx.sr, curve));
}

function mixInto(dst: Float32Array, src: Float32Array, g = 1, offset = 0): Float32Array {
  const n = Math.min(dst.length - offset, src.length);
  for (let i = 0; i < n; i++) dst[offset + i] = dst[offset + i]! + src[i]! * g;
  return dst;
}

/** Several oscillators summed (a chord or a fifth), each following `freq * ratio`. */
function voices(ctx: Ctx, wave: Wave, freq: Param, ratios: readonly number[], dur: number): Float32Array {
  const f = fnOf(freq);
  const out = new Float32Array(len(ctx, dur));
  for (const r of ratios) mixInto(out, osc(ctx, wave, (t) => f(t) * r, dur, { phase: ctx.rand() }), 1 / ratios.length);
  return out;
}

/**
 * Sample-and-hold crackle: random values held at `rate` Hz (the digital "grain" of the spark), gated into `count` micro-bursts that crowd toward the
 * end ('in', a charge) or thin out from the start ('out', a discharge), then band-limited to `lo`..`hi` Hz.
 */
function crackle(ctx: Ctx, dur: number, o: { rate: Param; count: number; lo: number; hi: number; fade: 'in' | 'out'; burst?: number }): Float32Array {
  const n = len(ctx, dur);
  const src = new Float32Array(n);
  const rate = fnOf(o.rate);
  let held = 0;
  let ph = 1;
  for (let i = 0; i < n; i++) {
    ph += rate(i / ctx.sr) / ctx.sr;
    if (ph >= 1) {
      ph -= Math.floor(ph);
      held = ctx.rand() * 2 - 1;
    }
    src[i] = held;
  }
  const gate = new Float32Array(n);
  const burst = o.burst ?? 0.018;
  for (let k = 0; k < o.count; k++) {
    const x = ctx.rand();
    const t = o.fade === 'in' ? Math.sqrt(x) * dur : x * x * dur;
    const bl = burst * (0.25 + ctx.rand());
    const lvl = (o.fade === 'in' ? 0.35 + 0.65 * (t / dur) : 1 - 0.75 * (t / dur)) * (0.5 + 0.5 * ctx.rand());
    const s0 = Math.round(t * ctx.sr);
    const m = Math.round(bl * ctx.sr);
    const ramp = Math.max(1, Math.round(0.0006 * ctx.sr));
    for (let j = 0; j < m && s0 + j < n; j++) {
      const a = j < ramp ? j / ramp : Math.exp((-5 * (j - ramp)) / m);
      gate[s0 + j] = Math.max(gate[s0 + j]!, a * lvl);
    }
  }
  mul(src, gate);
  return lp(ctx, hp(ctx, src, o.lo, 0.7), o.hi, 0.7);
}

/**
 * A gated tremolo: `x` chopped by a soft square gate at `rate` Hz (which may accelerate), `depth` 0 (untouched) to 1 (fully gated). Light pulsing,
 * a charging stutter.
 */
function gateTrem(ctx: Ctx, x: Float32Array, rate: Param, depth: Param): Float32Array {
  const r = fnOf(rate);
  const d = fnOf(depth);
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / ctx.sr;
    const g = 0.5 + 0.5 * Math.tanh(5 * Math.cos(TAU * ph));
    x[i] = x[i]! * (1 - d(t) * (1 - g));
    ph = (ph + r(t) / ctx.sr) % 1;
  }
  return x;
}

/** A flanger whose sweep rate changes over time (dsp.flange has a fixed rate): the phasing that speeds up as the arcane charge builds. */
function sweepFlange(ctx: Ctx, x: Float32Array, o: { rate: Param; depth: number; base: number; feedback: number; mix: number }): Float32Array {
  const size = Math.ceil((o.base + o.depth) * ctx.sr) + 4;
  const buf = new Float32Array(size);
  const out = new Float32Array(x.length);
  const rate = fnOf(o.rate);
  let ph = 0;
  let w = 0;
  let last = 0;
  for (let i = 0; i < x.length; i++) {
    const d = (o.base + o.depth * 0.5 * (1 - Math.cos(TAU * ph))) * ctx.sr;
    buf[w] = x[i]! + o.feedback * last;
    const p = (((w - d) % size) + size) % size;
    const i0 = Math.floor(p);
    const f = p - i0;
    const y = buf[i0]! * (1 - f) + buf[(i0 + 1) % size]! * f;
    last = y;
    out[i] = x[i]! * (1 - o.mix) + y * o.mix;
    w = (w + 1) % size;
    ph = (ph + rate(i / ctx.sr) / ctx.sr) % 1;
  }
  return out;
}

/** Fades a mix out between `from` and `to` seconds (squared), silent after: the room's tail never runs past the sound's length. */
function fadeTail(ctx: Ctx, st: Stereo, from: number, to: number): Stereo {
  const a = Math.round(from * ctx.sr);
  const b = Math.round(to * ctx.sr);
  for (const ch of [st.l, st.r]) {
    for (let i = a; i < ch.length; i++) {
      const g = i >= b ? 0 : ((b - i) / (b - a)) ** 2;
      ch[i] = ch[i]! * g;
    }
  }
  return st;
}

/**
 * A filter sweep quantized to the key: from `from` to `to` Hz over `dur` seconds (evenly in pitch), snapping to the nearest note of D minor at each
 * moment. A resonant filter on it rings in key instead of gliding through every pitch: the grid's stepped sweep.
 */
function keySweep(from: number, to: number, dur: number): (t: number) => number {
  const g = glide(from, to, dur);
  const inKey = [true, false, true, true, false, true, false, true, true, false, true, false];
  // The filter asks every sample; the note is recomputed every half millisecond.
  let lastT = -1;
  let last = from;
  return (t) => {
    if (t >= lastT && t - lastT < 0.0005) return last;
    lastT = t;
    const m = 69 + 12 * Math.log2(g(t) / 440);
    let best = Math.round(m);
    let dist = 99;
    for (let d = -1; d <= 1; d++) {
      const r = Math.round(m) + d;
      if (inKey[(((r - 2) % 12) + 12) % 12] && Math.abs(r - m) < dist) {
        dist = Math.abs(r - m);
        best = r;
      }
    }
    last = 440 * 2 ** ((best - 69) / 12);
    return last;
  };
}

/** A short linear fade-in (an impact's 1 ms attack, never a click). */
function fadeIn(ctx: Ctx, st: Stereo, dur: number): Stereo {
  const n = Math.round(dur * ctx.sr);
  for (let i = 0; i < n && i < st.l.length; i++) {
    st.l[i] = st.l[i]! * (i / n);
    st.r[i] = st.r[i]! * (i / n);
  }
  return st;
}

/** Normalizes to a peak of 1 and compresses (a fixed threshold below that peak): body up, spikes down, so the sound can reach its loudness. */
function glue(ctx: Ctx, st: Stereo, threshold: number, ratio: number, attack = 0.0015, release = 0.07): Stereo {
  let pk = 1e-9;
  for (let i = 0; i < st.l.length; i++) pk = Math.max(pk, Math.abs(st.l[i]!), Math.abs(st.r[i]!));
  const g = 1 / pk;
  mul(st.l, g);
  mul(st.r, g);
  return compress(ctx, st, { threshold, ratio, attack, release, knee: 6 });
}

/** The impacts' weight: a sine kick dropping to D2 (still heard on small speakers) that is gone within about 0.1 s. */
function kick(ctx: Ctx, from: number, dur: number): Float32Array {
  const s = osc(ctx, 'sine', glide(from, hz('D2'), 0.02), dur);
  return shape(ctx, s, [[0, 0], [0.002, 1], [0.045, 0.3], [dur, 0]]);
}

// ---- the chassis ------------------------------------------------------------------------------------------------------------------

/**
 * A cast: `build` adds the element's charge (0 - R) and release (at R); the chassis adds the shared landing (a short sub pulse on D as the card locks
 * onto the stack), the table room with the grid's ping-pong echo (one beat of 0.125 s for the whole set), the faded tail and the glue.
 */
function castChassis(ctx: Ctx, build: (m: Mix) => void, o: { sub?: number; echo?: number; fb?: number; wet?: number } = {}): Stereo {
  const m = new Mix(ctx, CAST_DUR);
  build(m);
  const sub = o.sub ?? 0.3;
  if (sub > 0) m.add(thump(ctx, { from: hz('A2'), to: hz('D2'), drop: 0.045, dur: 0.24 }), { at: R, gain: sub });
  const st = m.out({ space: SPACE.table, echo: { time: o.echo ?? 0.125, feedback: o.fb ?? 0.36, mix: o.wet ?? 0.42, pingpong: true, damp: 4200 } });
  fadeTail(ctx, st, 0.62, CAST_DUR);
  return glue(ctx, st, -9, 2);
}

/**
 * An impact: `build` adds the element's transient and body from 0 (each body falls 12 dB within 70 ms); the chassis adds the kick on D2 (the weight
 * that the game scales with the damage), the table room (no echo: its repeats would land between a spell's impacts), the faded tail and a light glue.
 */
function impactChassis(ctx: Ctx, build: (m: Mix) => void, o: { kick?: number; from?: number; kickDur?: number } = {}): Stereo {
  const m = new Mix(ctx, IMPACT_DUR);
  build(m);
  const k = o.kick ?? 0.4;
  if (k > 0) m.add(kick(ctx, o.from ?? hz('A3'), o.kickDur ?? 0.16), { gain: k });
  const st = m.out({ space: SPACE.table });
  fadeTail(ctx, st, 0.4, IMPACT_DUR);
  fadeIn(ctx, st, 0.0008);
  return glue(ctx, st, -8, 2, 0.0008, 0.03);
}

// ---- element voices ---------------------------------------------------------------------------------------------------------------

/** Digital flame: noise through a closing low-pass, driven and bit-crushed (the sample rate drops as it burns out). */
function flame(ctx: Ctx, dur: number, o: { from: number; to: number; close: number; bits?: number; hold?: Param }): Float32Array {
  let s = lp(ctx, noise(ctx, dur), glide(o.from, o.to, o.close), 0.8);
  s = drive(s, 2.6);
  return crush(ctx, s, o.bits ?? 7, o.hold ?? 2);
}

/**
 * A bell of the arcane: two-operator FM, its index falling as it rings. At the default ratio 2.5 the partials fall on the fifth, the minor seventh and
 * the octave (1.5, 3.5, 4, 6 times the note): a glassy bell that stays inside D minor.
 */
function fmBell(ctx: Ctx, f: number, dur: number, o: { ratio?: number; index?: number; decay?: number } = {}): Float32Array {
  const s = fm(ctx, f, dur, { ratio: o.ratio ?? 2.5, index: glide(o.index ?? 2.6, 0.25, (o.decay ?? dur) * 0.7, 'lin') });
  return mul(s, perc(ctx, 0.0015, o.decay ?? dur, dur));
}

/** Dark detuned FM: two low FM voices a minor second apart (A and Bb, in key) beating against each other. */
function darkFm(ctx: Ctx, f: number, dur: number, o: { index?: Param; fall?: number; path?: readonly number[]; step?: number } = {}): Float32Array {
  // One loop for both voices (the shadow uses several of them; this keeps its render cheap). Voice a: carrier f, modulator f * 1.005 with a little
  // feedback (rough); voice b: carrier a minor second up, modulator an octave down (hollow). Both fall by `fall` over 80% of the length, or step
  // through the notes of `path` (`step` seconds each: a quantized fall that stays in key).
  const n = len(ctx, dur);
  const out = new Float32Array(n);
  const idx = fnOf(o.index ?? 2.2);
  const fall = o.fall ?? 1;
  let ca = 0;
  let ma = 0;
  let cb = 0;
  let mb = 0;
  let last = 0;
  for (let i = 0; i < n; i++) {
    const t = i / ctx.sr;
    const hzNow = o.path ? o.path[Math.min(o.path.length - 1, Math.floor(t / (o.step ?? 0.05)))]! : f * fall ** Math.min(1, t / (dur * 0.8));
    const fr = hzNow / ctx.sr;
    const k = idx(t);
    const m = Math.sin(TAU * ma + 0.25 * last);
    last = m;
    const a = Math.sin(TAU * ca + k * m);
    const b = Math.sin(TAU * cb + k * Math.sin(TAU * mb));
    out[i] = (a + b * 0.8) * 0.55;
    ca = (ca + fr) % 1;
    ma = (ma + fr * 1.005) % 1;
    cb = (cb + fr * 1.0595) % 1;
    mb = (mb + fr * 1.0595 * 0.5) % 1;
  }
  return out;
}

/** The shadow's toll: two hollow FM tones a minor second apart (A and Bb in key), beating darkly as they fade. */
function toll(ctx: Ctx, f: number, dur: number, decay = dur): Float32Array {
  const a = fm(ctx, f, dur, { ratio: 0.5, index: glide(2.4, 0.4, dur * 0.6, 'lin') });
  const b = fm(ctx, f * 1.0595, dur, { ratio: 0.5, index: glide(2.4, 0.4, dur * 0.6, 'lin') });
  for (let i = 0; i < a.length; i++) a[i] = (a[i]! + b[i]!) * 0.5;
  mul(a, perc(ctx, 0.002, decay, dur));
  return lp(ctx, a, 3200, 0.7);
}

/**
 * A synth pluck of the nature spells: a Karplus-Strong string through its own resonant low-pass that snaps from `cut` Hz down to the octave of its own
 * note in 80 ms, in steps of the key (the "bwow" of a resonant synth), lightly bit-crushed (`crushed` false leaves that to the caller, for a sum of
 * buds): a growing bud of light, not an acoustic string.
 */
function bud(ctx: Ctx, f: number, dur: number, o: { cut?: number; decay?: number; bright?: number; q?: number; crushed?: boolean } = {}): Float32Array {
  const p = pluck(ctx, f, dur, { decay: o.decay ?? 0.4, bright: o.bright ?? 0.7 });
  const filtered = lp(ctx, p, keySweep(o.cut ?? 3000, f * 2, 0.08), o.q ?? 6);
  return o.crushed === false ? filtered : crush(ctx, filtered, 10, 2);
}

// ---- the recipes -----------------------------------------------------------------------------------------------------------------

export const SPELL_SOUNDS: Partial<Record<SoundId, Recipe>> = {
  // ---- fire ------------------------------------------------------------------------------------------------------------------------
  'cast.fire': (ctx) =>
    castChassis(ctx, (m) => {
      // Charge: crushed noise sweeping up while its sample rate climbs (the flame catching), over a driven saw fifth stepping up D3 F3 A3 D4, with
      // slow, low sample-and-hold embers (pops of 12-20 ms, 0.9-3.5 kHz) crowding in.
      let hiss = bp(ctx, noise(ctx, R + 0.05), glide(450, 3000, R), 0.9);
      shape(ctx, hiss, [[0, 0], [0.06, 0.18], [R - 0.03, 1], [R + 0.05, 0]], 'lin');
      hiss = lp(ctx, crush(ctx, drive(hiss, 3), 6, glide(9, 2, R)), 7000, 0.7);
      m.add(hiss, { gain: 0.2, send: 0.15 });
      const rise = [hz('D3'), hz('F3'), hz('A3'), hz('D4')];
      let roar = voices(ctx, 'saw', (t) => rise[Math.min(3, Math.floor(t / 0.11))]!, [0.5, 1, 1.5], R + 0.06);
      roar = drive(lp(ctx, roar, glide(260, 2600, R), 1.4), 2.4);
      shape(ctx, roar, [[0, 0], [0.1, 0.25], [R - 0.01, 1], [R + 0.06, 0]], 'lin');
      m.add(roar, { gain: 0.2, send: 0.12 });
      m.add(crackle(ctx, R, { rate: 2000, count: 16, lo: 900, hi: 3500, fade: 'in', burst: 0.016 }), { gain: 0.32, pan: -0.2, send: 0.2 });
      // Release: the fireball ignites, a "fwoomp" of crushed flame and a driven saw stab on D and A closing fast, embers flying.
      const burst = flame(ctx, 0.42, { from: 8500, to: 650, close: 0.28, bits: 6, hold: 3 });
      shape(ctx, burst, [[0, 0], [0.003, 1], [0.07, 0.5], [0.42, 0]]);
      m.add(burst, { at: R, gain: 0.75, send: 0.3 });
      let stab = voices(ctx, 'saw', glide(hz('D4') * 1.06, hz('D4'), 0.05), [0.5, 1, 1.5], 0.4);
      stab = drive(lp(ctx, stab, glide(4200, 380, 0.3), 1.2), 2.2);
      shape(ctx, stab, [[0, 0], [0.004, 1], [0.12, 0.35], [0.4, 0]]);
      m.add(stab, { at: R, gain: 0.5, send: 0.25 });
      m.add(crackle(ctx, 0.38, { rate: 1800, count: 12, lo: 900, hi: 3500, fade: 'out', burst: 0.018 }), { at: R + 0.02, gain: 0.48, pan: 0.2, send: 0.35 });
    }),

  'impact.fire': (ctx) =>
    impactChassis(
      ctx,
      (m) => {
        // The gulp: crushed noise through a low-pass that bursts open (300 -> 5000 Hz in 35 ms) and swallows itself (500 Hz by 0.2 s): the fireball
        // engulfing the target. Over it, a crushed mid flare whose sample rate drops (the flame breaking into digital grit).
        const open = (t: number) => (t < 0.035 ? 300 * (5000 / 300) ** (t / 0.035) : 5000 * (500 / 5000) ** Math.min(1, (t - 0.035) / 0.165));
        let gulp = drive(lp(ctx, noise(ctx, 0.3), open, 1.1), 1.5);
        gulp = crush(ctx, gulp, 7, 2);
        shape(ctx, gulp, [[0, 0], [0.002, 1], [0.05, 0.3], [0.3, 0]]);
        m.add(gulp, { gain: 0.9, send: 0.25 });
        let flare = bp(ctx, noise(ctx, 0.18), hz('D6'), 1.2);
        flare = crush(ctx, drive(flare, 2), 6, glide(1, 10, 0.12, 'lin'));
        shape(ctx, flare, [[0, 0], [0.002, 1], [0.04, 0.25], [0.18, 0]]);
        m.add(flare, { gain: 0.45, send: 0.2 });
        // The embers lead the tail: slow, low sample-and-hold pops (0.9-3.5 kHz, unlike lightning's fine crackle) thinning out, and six pitched
        // sparks on notes of the key flying off.
        m.add(crackle(ctx, 0.45, { rate: 2200, count: 30, lo: 900, hi: 3500, fade: 'out', burst: 0.016 }), { at: 0.01, gain: 0.35, pan: -0.15, send: 0.3 });
        for (let k = 0; k < 6; k++) {
          const t = 0.03 + ctx.rand() * 0.3;
          const s = tick(ctx, { freq: scaleNoteBetween(ctx, 2000, 5000), dur: 0.014, q: 6 });
          m.add(s, { at: t, gain: (0.5 + ctx.rand() * 0.4) * (1 - t), pan: ctx.rand() * 1.6 - 0.8, send: 0.35 });
        }
      },
      { kick: 0.35, from: hz('D3') },
    ),

  // ---- lightning -------------------------------------------------------------------------------------------------------------------
  'cast.lightning': (ctx) =>
    castChassis(
      ctx,
      (m) => {
        // Charge: a capacitor whine (FM, index rising) climbing from D4 to D6 in steps of the key, stuttering faster (24 -> 40 Hz) in its last 0.12 s, and
        // sample-and-hold crackle crowding toward the release.
        let whine = fm(ctx, keySweep(hz('D4'), hz('D6'), R), R + 0.02, { ratio: 2, index: glide(0.6, 1.8, R, 'lin') });
        shape(ctx, whine, [[0, 0], [0.04, 0.1], [R - 0.02, 1], [R + 0.02, 0]], 'lin');
        whine = gateTrem(ctx, lp(ctx, whine, 3500, 0.7), glide(24, 40, 0.12, 'lin', R - 0.12), (t) => (t < R - 0.12 ? 0 : Math.min(0.8, (t - R + 0.12) * 40)));
        m.add(whine, { gain: 0.16, send: 0.15 });
        m.add(crackle(ctx, R, { rate: glide(1500, 8000, R), count: 34, lo: 2400, hi: 8000, fade: 'in', burst: 0.012 }), { gain: 0.28, pan: -0.25, send: 0.2 });
        m.add(crackle(ctx, R, { rate: glide(1200, 7000, R), count: 26, lo: 2400, hi: 8000, fade: 'in', burst: 0.012 }), { gain: 0.24, pan: 0.3, send: 0.2 });
        // Release: the arc jumps: a crack, two falling FM zaps ring-modulated (L then R), a discharge of crackle, and a short electric buzz on D.
        const crack = shape(ctx, lp(ctx, hp(ctx, noise(ctx, 0.05), 1600, 0.7), 8000, 0.7), [[0, 0], [0.0004, 1], [0.04, 0]]);
        m.add(crack, { at: R, gain: 0.6, send: 0.3 });
        [[5500, -0.4, 0], [4400, 0.45, 0.028]].forEach(([from, pan, dt]) => {
          const z = fm(ctx, glide(from!, hz('D4'), 0.13), 0.16, { ratio: 1, index: glide(4, 0.8, 0.16, 'lin'), feedback: 0.15 });
          mul(z, perc(ctx, 0.0008, 0.15, 0.16));
          m.add(lp(ctx, ring(ctx, z, hz('A3'), 0.3), 8000, 0.7), { at: R + dt!, gain: 0.55, pan: pan!, send: 0.35 });
        });
        m.add(crackle(ctx, 0.3, { rate: 6000, count: 18, lo: 2400, hi: 8000, fade: 'out', burst: 0.016 }), { at: R, gain: 0.45, send: 0.3 });
        const buzz = lp(ctx, voices(ctx, 'square', hz('D4'), [1, 1.5], 0.25), 2200, 0.8);
        shape(ctx, buzz, [[0, 0], [0.003, 1], [0.25, 0]]);
        m.add(ring(ctx, buzz, hz('D3'), 0.6), { at: R, gain: 0.18, send: 0.2 });
      },
      { sub: 0.15, fb: 0.4 },
    ),

  'impact.lightning': (ctx) =>
    impactChassis(
      ctx,
      (m) => {
        // The strike: a sharp crack, then three short FM zaps falling from the sky to D4 / A3 / D3 (the bolt forking), panned C / L / R.
        m.add(shape(ctx, lp(ctx, hp(ctx, noise(ctx, 0.05), 1400, 0.7), 8000, 0.7), [[0, 0], [0.0003, 1], [0.012, 0.3], [0.05, 0]]), { gain: 0.6, send: 0.3 });
        [[6000, 0, 0, hz('D4')], [4800, -0.55, 0.018, hz('A3')], [4000, 0.55, 0.036, hz('D3')]].forEach(([from, pan, dt, to]) => {
          const z = fm(ctx, glide(from!, to!, 0.07), 0.11, { ratio: 1, index: glide(4.5, 0.8, 0.11, 'lin'), feedback: 0.15 });
          mul(z, perc(ctx, 0.0006, 0.09, 0.11));
          m.add(lp(ctx, crush(ctx, ring(ctx, z, hz('A3'), 0.3), 9, 1), 8000, 0.7), { at: dt!, gain: 0.55, pan: pan!, send: 0.25 });
        });
        // The discharge: sample-and-hold crackle thinning out across the field, and an electrified buzz on D4 / A4 snapping off.
        const discharge = { count: 26, lo: 2200, hi: 6000, fade: 'out', burst: 0.01 } as const;
        m.add(crackle(ctx, 0.35, { ...discharge, rate: glide(8000, 2500, 0.35) }), { at: 0.02, gain: 0.25, pan: -0.3, send: 0.25 });
        m.add(crackle(ctx, 0.35, { ...discharge, rate: glide(7000, 2200, 0.35), count: 20 }), { at: 0.02, gain: 0.22, pan: 0.35, send: 0.25 });
        const buzz = lp(ctx, voices(ctx, 'square', hz('D4'), [1, 1.006, 1.5], 0.2), 2600, 0.8);
        shape(ctx, buzz, [[0, 0], [0.004, 1], [0.05, 0.3], [0.2, 0]]);
        m.add(ring(ctx, buzz, hz('D3'), 0.6), { gain: 0.32, send: 0.15 });
      },
      { kick: 0.28 },
    ),

  // ---- arcane ----------------------------------------------------------------------------------------------------------------------
  'cast.arcane': (ctx) =>
    castChassis(
      ctx,
      (m) => {
        // Charge: a reversed FM bell swelling into the release (time running backward into the spell), and an FM bell trill alternating A5 / C6 every
        // 40 ms, growing until the 8th note and easing for the last two (the release chord is the accent), through a flanger whose sweep speeds up
        // from 1 to 6 Hz: the phasing of the spell spinning faster.
        // The reversed bells ease off in the last 25 ms (a held breath), so the release chord is the accent.
        const ease: Pt[] = [[0, 1], [R - 0.025, 1], [R, 0.35]];
        m.add(shape(ctx, reverse(fmBell(ctx, hz('D5'), R, { index: 3, decay: R })), ease, 'lin'), { gain: 0.34, pan: -0.15, send: 0.35 });
        m.add(shape(ctx, reverse(fmBell(ctx, hz('D4'), R, { index: 1.5, decay: R })), ease, 'lin'), { gain: 0.22, pan: 0.15, send: 0.2 });
        const trill = new Float32Array(len(ctx, R + 0.06));
        for (let k = 0; k < 10; k++) {
          const b = fmBell(ctx, k % 2 ? hz('C6') : hz('A5'), 0.07, { index: 1.5, decay: 0.065 });
          mixInto(trill, b, k < 8 ? 0.35 + 0.65 * (k / 7) : 0.7, Math.round((0.03 + k * 0.04) * ctx.sr));
        }
        const phased = sweepFlange(ctx, trill, { rate: glide(1, 6, R, 'lin'), depth: 0.003, base: 0.0008, feedback: 0.6, mix: 0.5 });
        m.add(phased, { gain: 0.42, send: 0.45 });
        // Release: an FM bell chord (D5 A5 C6) over a sine D4, phased, with the long ping-pong echo of the table.
        const chord = new Float32Array(len(ctx, 0.45));
        [hz('D5'), hz('A5'), hz('C6')].forEach((f, k) => mixInto(chord, fmBell(ctx, f, 0.45, { index: 2.4 - k * 0.4, decay: 0.42 }), 0.45));
        mixInto(chord, mul(osc(ctx, 'sine', hz('D4'), 0.45), perc(ctx, 0.002, 0.4, 0.45)), 0.5);
        m.add(flange(ctx, chord, { rate: 3.1, depth: 0.0025, base: 0.0008, feedback: 0.5, mix: 0.45 }), { at: R, gain: 0.75, send: 0.45 });
        m.add(tick(ctx, { freq: 7000, dur: 0.003 }), { at: R, gain: 0.3 });
      },
      { sub: 0.15, wet: 0.5, fb: 0.42 },
    ),

  'impact.arcane': (ctx) =>
    impactChassis(
      ctx,
      (m) => {
        // The lead: a jet of pink noise through a deep flanger sweeping down (the phasing wave of the spell breaking over the target).
        let wave = bp(ctx, noise(ctx, 0.3, 'pink'), glide(3500, 900, 0.25), 0.8);
        shape(ctx, wave, [[0, 0], [0.002, 1], [0.04, 0.5], [0.07, 0.22], [0.3, 0]]);
        wave = sweepFlange(ctx, wave, { rate: glide(8, 2, 0.25), depth: 0.004, base: 0.0006, feedback: 0.75, mix: 0.6 });
        m.add(wave, { gain: 0.75, send: 0.25 });
        // Under it: a glass FM ping (D7) and the arcane bell chord struck short (D5 A5 C6 F6, FM ratio 2.5), phased left and right.
        m.add(tick(ctx, { freq: 6500, dur: 0.003 }), { gain: 0.4 });
        m.add(fmBell(ctx, hz('D7'), 0.06, { ratio: 1.41, index: 3, decay: 0.05 }), { gain: 0.18, send: 0.3 });
        const bells = new Float32Array(len(ctx, 0.32));
        [hz('D5'), hz('A5'), hz('C6'), hz('F6')].forEach((f, k) => {
          mixInto(bells, fmBell(ctx, f, 0.32, { index: 3.4 - k * 0.5, decay: 0.28 - k * 0.03 }), 0.4);
        });
        m.add(flange(ctx, bells, { rate: 3.5, depth: 0.003, base: 0.0006, feedback: 0.6, mix: 0.5 }), { gain: 0.6, pan: -0.25, send: 0.3 });
        m.add(flange(ctx, bells, { rate: 2.6, depth: 0.0035, base: 0.0009, feedback: 0.6, mix: 0.5 }), { gain: 0.45, pan: 0.3, send: 0.3 });
        m.add(fmBell(ctx, hz('D4'), 0.25, { index: 2, decay: 0.2 }), { gain: 0.3, send: 0.15 });
      },
      { kick: 0.25 },
    ),

  // ---- shadow ----------------------------------------------------------------------------------------------------------------------
  'cast.shadow': (ctx) =>
    castChassis(
      ctx,
      (m) => {
        // Charge: played backward, sucked in toward the release: a reversed noise decay (a backward whoosh) and a reversed dark FM hit, over an FM
        // pair A2 / Bb2 (a minor second, beating) whose index and filter rise, and a hollow whisper of noise ring-modulated on A3.
        const suck = reverse(mul(bp(ctx, noise(ctx, R, 'pink'), 1300, 0.6), perc(ctx, 0.001, R * 0.85, R)));
        shape(ctx, suck, [[0, 0], [0.03, 1], [R, 1]], 'lin');
        m.add(suck, { gain: 0.4, pan: -0.25, send: 0.45 });
        const back = reverse(mul(darkFm(ctx, hz('A3'), R, { index: 3.5 }), perc(ctx, 0.002, R * 0.8, R)));
        shape(ctx, back, [[0, 0], [0.03, 1], [R, 1]], 'lin');
        m.add(lp(ctx, back, 3000, 0.7), { gain: 0.32, pan: 0.25, send: 0.45 });
        const drone = darkFm(ctx, hz('A2'), R + 0.02, { index: glide(0.8, 3.5, R, 'lin') });
        shape(ctx, drone, [[0, 0], [0.12, 0.25], [R - 0.01, 1], [R + 0.02, 0]], 'lin');
        m.add(hp(ctx, lp(ctx, drone, glide(500, 2400, R), 1.2), 70, 0.7), { gain: 0.18, send: 0.15 });
        const whisper = ring(ctx, bp(ctx, noise(ctx, R + 0.02), glide(500, 2000, R), 3), hz('A3'), 0.8);
        shape(ctx, whisper, [[0, 0], [R - 0.02, 1], [R + 0.02, 0]], 'lin');
        m.add(whisper, { gain: 0.4, send: 0.3 });
        // Release: the shadow falls. A dark FM hit on A3 / Bb3 stepping down A F D, ring-modulated an octave below itself; a hollow minor-second toll
        // (A4 against Bb4, beating); a crushed edge.
        const fallTo = [hz('A3'), hz('F3'), hz('D3')];
        let hit = darkFm(ctx, hz('A3'), 0.42, { index: glide(5, 0.6, 0.3, 'lin'), path: fallTo, step: 0.06 });
        hit = ring(ctx, hit, (t) => fallTo[Math.min(2, Math.floor(t / 0.06))]! / 2, 0.45);
        shape(ctx, hit, [[0, 0], [0.003, 1], [0.12, 0.45], [0.42, 0]]);
        m.add(hp(ctx, lp(ctx, hit, glide(4000, 700, 0.3), 0.7), 70, 0.7), { at: R, gain: 0.8, send: 0.3 });
        m.add(toll(ctx, hz('A4'), 0.42), { at: R, gain: 0.3, send: 0.45 });
        let edge = lp(ctx, noise(ctx, 0.18), glide(4500, 300, 0.12), 0.9);
        shape(ctx, edge, [[0, 0], [0.002, 1], [0.18, 0]]);
        edge = crush(ctx, edge, 5, 4);
        m.add(edge, { at: R, gain: 0.45, send: 0.2 });
        // A single crushed glint at 2.5 kHz (5 ms): the cut of the shadow, so the release reads on small speakers.
        const glint = crush(ctx, shape(ctx, bp(ctx, noise(ctx, 0.005), 2500, 2), [[0, 0], [0.0005, 1], [0.005, 0]]), 6, 2);
        m.add(glint, { at: R, gain: 0.35, send: 0.25 });
      },
      { sub: 0.3, wet: 0.34, fb: 0.32 },
    ),

  'impact.shadow': (ctx) =>
    impactChassis(
      ctx,
      (m) => {
        // The strike: a crushed muffled crack and detuned FM pairs (A3 / Bb3 and A2 / Bb2, minor seconds) stepping down A F D, their index collapsing,
        // ring-modulated an octave below themselves: the target drained. Over it the hollow minor-second toll of the cast (A4 against Bb4).
        const crack = crush(ctx, lp(ctx, noise(ctx, 0.05), glide(5000, 900, 0.04), 0.8), 5, 3);
        shape(ctx, crack, [[0, 0], [0.0008, 1], [0.05, 0]]);
        m.add(crack, { gain: 0.5, send: 0.2 });
        const fallTo = [hz('A3'), hz('F3'), hz('D3')];
        let body = darkFm(ctx, hz('A3'), 0.35, { index: glide(5, 0.5, 0.25, 'lin'), path: fallTo, step: 0.05 });
        body = ring(ctx, body, (t) => fallTo[Math.min(2, Math.floor(t / 0.05))]! / 2, 0.5);
        shape(ctx, body, [[0, 0], [0.002, 1], [0.05, 0.3], [0.35, 0]]);
        m.add(hp(ctx, lp(ctx, body, glide(4000, 600, 0.25), 0.8), 80, 0.7), { gain: 0.65, send: 0.2 });
        m.add(toll(ctx, hz('A4'), 0.32, 0.3), { gain: 0.4, send: 0.3 });
        const deep = darkFm(ctx, hz('A2'), 0.25, { index: glide(4, 0.5, 0.2, 'lin'), path: [hz('A2'), hz('F2'), hz('D2')], step: 0.05 });
        shape(ctx, deep, [[0, 0], [0.002, 1], [0.05, 0.25], [0.25, 0]]);
        m.add(hp(ctx, lp(ctx, deep, 1400, 0.7), 60, 0.7), { gain: 0.28, send: 0.1 });
        // The rush: noise in the low mids ring-modulated on A3 (a hollow, voice-like hiss) sinking with the hit, and crushed square grit stepping down D4 A3 F3 D3.
        const rush = ring(ctx, bp(ctx, noise(ctx, 0.25), glide(1600, 400, 0.2), 2.5), hz('A3'), 0.8);
        shape(ctx, rush, [[0, 0], [0.003, 1], [0.05, 0.3], [0.25, 0]]);
        m.add(rush, { gain: 0.45, send: 0.25 });
        let grit = mul(osc(ctx, 'square', (t: number) => [hz('D4'), hz('A3'), hz('F3'), hz('D3')][Math.min(3, Math.floor(t / 0.03))]!, 0.15), perc(ctx, 0.002, 0.12, 0.15));
        grit = crush(ctx, lp(ctx, grit, 2200, 0.7), 4, 6);
        m.add(grit, { gain: 0.3, send: 0.1 });
      },
      { kick: 0.28, from: hz('A2'), kickDur: 0.2 },
    ),

  // ---- nature ----------------------------------------------------------------------------------------------------------------------
  'cast.nature': (ctx) =>
    castChassis(
      ctx,
      (m) => {
        // Charge: the vine grows: a saw-like tone on D2 through a resonant band-pass rising 200 -> 3000 Hz in steps of the key. Buds of light sprout on it at uneven moments: synth
        // plucks on notes of D minor, each with its own resonant filter snapping shut, opening wider (1500 -> 5000 Hz) as the vine grows.
        // The vine's saw keeps only the harmonics that fall on D and A (1 2 3 4 6 8 12): the swept resonance never lights an F#.
        let vine: Float32Array = new Float32Array(len(ctx, R + 0.03));
        for (const h of [1, 2, 3, 4, 6, 8, 12]) mixInto(vine, osc(ctx, 'sine', hz('D2') * h, R + 0.03, { phase: ctx.rand() }), 1 / h);
        vine = bp(ctx, vine, keySweep(200, 3000, R), 4);
        shape(ctx, vine, [[0, 0], [0.08, 0.3], [R - 0.01, 1], [R + 0.03, 0]], 'lin');
        m.add(vine, { gain: 0.65, send: 0.2 });
        const buds = [hz('A4'), hz('D4'), hz('F4'), hz('C5'), hz('A4'), hz('D5')];
        const budL = new Float32Array(len(ctx, R + 0.05));
        const budR = new Float32Array(len(ctx, R + 0.05));
        let t = 0.04;
        buds.forEach((f, k) => {
          const cut = 1500 * (5000 / 1500) ** (t / R);
          mixInto(k % 2 ? budR : budL, bud(ctx, f, 0.25, { cut, decay: 0.3, crushed: false }), 0.18 + 0.03 * k, Math.round(t * ctx.sr));
          t += 0.05 + ctx.rand() * 0.035;
        });
        m.add(crush(ctx, budL, 10, 2), { pan: -0.5, send: 0.3 });
        m.add(crush(ctx, budR, 10, 2), { pan: 0.5, send: 0.3 });
        // Release: the bloom: a resonant saw stab (D3 A3 D4, filter 300 -> 4000 -> 600 Hz), a chord of synth plucks (D4 A4 D5 F5) and a resonant
        // sweep through crushed noise (leaves of light).
        const stabCut = (x: number) => (x < 0.015 ? 300 * (4000 / 300) ** (x / 0.015) : 4000 * (600 / 4000) ** Math.min(1, (x - 0.015) / 0.25));
        let stab = voices(ctx, 'saw', hz('D3'), [1, 1.5, 2.003], 0.4);
        stab = lp(ctx, stab, stabCut, 5);
        shape(ctx, stab, [[0, 0], [0.004, 1], [0.15, 0.4], [0.4, 0]]);
        m.add(stab, { at: R, gain: 0.45, send: 0.3 });
        [hz('D4'), hz('A4'), hz('D5'), hz('F5')].forEach((f, k) => {
          m.add(bud(ctx, f, 0.35, { cut: 5000, decay: 0.4, bright: 0.8 }), { at: R + k * 0.008, gain: 0.35, pan: [-0.4, 0.4, -0.2, 0.2][k]!, send: 0.35 });
        });
        const sweep = (x: number) => (x < 0.08 ? 400 * (3500 / 400) ** (x / 0.08) : 3500 * (600 / 3500) ** Math.min(1, (x - 0.08) / 0.25));
        const leaves = lp(ctx, crush(ctx, noise(ctx, 0.36), 10, 3), sweep, 6);
        shape(ctx, leaves, [[0, 0], [0.006, 1], [0.1, 0.5], [0.36, 0]]);
        m.add(leaves, { at: R, gain: 0.4, send: 0.3 });
      },
      { sub: 0.3 },
    ),

  'impact.nature': (ctx) =>
    impactChassis(
      ctx,
      (m) => {
        // The lead: a vine whips in: noise through a resonant low-pass snapping down 3000 Hz -> A3 in 60 ms in steps of the key, with a band-passed
        // thwack.
        const snap = lp(ctx, noise(ctx, 0.15), keySweep(3000, hz('A3'), 0.06), 6);
        shape(ctx, snap, [[0, 0], [0.004, 1], [0.04, 0.3], [0.15, 0]]);
        m.add(snap, { gain: 0.55, send: 0.2 });
        m.add(shape(ctx, bp(ctx, noise(ctx, 0.012), 1200, 1.5), [[0, 0], [0.0005, 1], [0.012, 0]]), { gain: 0.85, send: 0.1 });
        // Under it: synth plucks (D3 A3 D4 A4) with resonant filters snapping shut, and two leaf plucks (A5, D5) flying off.
        [hz('D3'), hz('A3'), hz('D4'), hz('A4')].forEach((f, k) => {
          const p = bud(ctx, f, 0.3, { cut: 3500, decay: 0.25, bright: 0.6 });
          m.add(p, { gain: 0.3, pan: [0, -0.25, 0.25, 0][k]!, send: 0.2 });
        });
        [hz('A5'), hz('D5')].forEach((f, k) => {
          m.add(bud(ctx, f, 0.14, { cut: 6000, decay: 0.1, bright: 0.7, q: 4 }), { at: 0.06 + k * 0.05, gain: 0.12, pan: k ? 0.5 : -0.5, send: 0.4 });
        });
      },
      { kick: 0.32 },
    ),

  // ---- radiant ---------------------------------------------------------------------------------------------------------------------
  'cast.radiant': (ctx) =>
    castChassis(
      ctx,
      (m) => {
        // Charge: light pulsing brighter: a held D major chord (D5 F#5 A5) swelling, gated by a tremolo that speeds up from 8 to 24 Hz, with air
        // rising from 2 to 8 kHz and a little glitter.
        let chord = voices(ctx, 'triangle', 1, [hz('D5'), hz('F#5'), hz('A5'), hz('D5') * 1.004], R + 0.03);
        chord = lp(ctx, chord, glide(1800, 5000, R), 0.7);
        shape(ctx, chord, [[0, 0], [0.05, 0.12], [R - 0.15, 0.4], [R - 0.01, 1], [R + 0.03, 0]], 'lin');
        // The gate opens up (depth 0.85 -> 0.5) as the light swells toward the release.
        m.add(gateTrem(ctx, chord, glide(8, 24, R), glide(0.85, 0.5, R, 'lin')), { gain: 0.8, send: 0.4 });
        const air = bp(ctx, noise(ctx, R + 0.02), glide(2000, 8000, R), 1);
        shape(ctx, air, [[0, 0], [R - 0.02, 1], [R + 0.02, 0]], 'lin');
        m.add(air, { gain: 0.22, send: 0.3 });
        m.addStereo(shimmer(ctx, { dur: R, density: 30, lo: 1500, hi: 6000, grain: 0.1, scale: D_MAJOR, fade: 'in' }), { gain: 0.35, send: 0.45 });
        // Release: a white flash (noise above 5 kHz) and the crystal chord in D major (D5 A5 D6 F#6 A6) struck bright, a sine choir on D A D under it,
        // and a burst of glitter.
        m.add(shape(ctx, hp(ctx, noise(ctx, 0.03), 5000, 0.7), [[0, 0], [0.0005, 1], [0.03, 0]]), { at: R, gain: 0.5, send: 0.4 });
        [hz('D5'), hz('A5'), hz('D6'), hz('F#6'), hz('A6')].forEach((f, k) => {
          const c = crystal(ctx, { freq: f, dur: 0.45, bright: 0.55 });
          m.add(c, { at: R, gain: [0.6, 0.5, 0.42, 0.32, 0.24][k]!, pan: [0, -0.3, 0.3, -0.5, 0.5][k]!, send: 0.45 });
        });
        const choir = voices(ctx, 'sine', 1, [hz('D4'), hz('A4'), hz('D5'), hz('D4') * 1.003, hz('A4') * 0.997], 0.42);
        shape(ctx, choir, [[0, 0], [0.008, 1], [0.15, 0.5], [0.42, 0]]);
        m.add(choir, { at: R, gain: 0.5, send: 0.35 });
        m.addStereo(shimmer(ctx, { dur: 0.32, density: 60, lo: 2000, hi: 7000, grain: 0.09, scale: D_MAJOR, fade: 'out' }), { at: R, gain: 0.6, send: 0.5 });
      },
      { sub: 0.18, wet: 0.48, fb: 0.4 },
    ),

  'impact.radiant': (ctx) =>
    impactChassis(
      ctx,
      (m) => {
        // The lead: a white flash, noise through a band-pass sweeping down from 6 to 2 kHz in 50 ms, and a fast fifth glint above (A6 -> D7).
        const flash = bp(ctx, noise(ctx, 0.05), glide(6000, 2000, 0.05), 0.9);
        shape(ctx, flash, [[0, 0], [0.0004, 1], [0.015, 0.5], [0.05, 0]]);
        m.add(flash, { gain: 0.6, send: 0.3 });
        const glint = osc(ctx, 'sine', (t: number) => (t < 0.03 ? hz('A6') : hz('D7')), 0.12);
        m.add(mul(glint, perc(ctx, 0.002, 0.11, 0.12)), { at: 0.005, gain: 0.2, pan: 0.2, send: 0.4 });
        // Under it: the crystal chord in D major struck short (D5 F#5 A5 D6 A6), a sine body on D4 A4 and glitter flying out.
        [hz('D5'), hz('F#5'), hz('A5'), hz('D6'), hz('A6')].forEach((f, k) => {
          m.add(crystal(ctx, { freq: f, dur: 0.24, bright: 0.7 }), { gain: [0.45, 0.32, 0.36, 0.3, 0.2][k]!, pan: [0, -0.35, 0.35, -0.2, 0.2][k]!, send: 0.35 });
        });
        const body = voices(ctx, 'sine', 1, [hz('D4'), hz('A4')], 0.25);
        shape(ctx, body, [[0, 0], [0.003, 1], [0.05, 0.3], [0.25, 0]]);
        m.add(body, { gain: 0.4, send: 0.2 });
        const glitter = shimmer(ctx, { dur: 0.25, density: 50, lo: 2000, hi: 7500, grain: 0.07, scale: D_MAJOR, fade: 'out' });
        m.addStereo(glitter, { at: 0.01, gain: 0.3, send: 0.35 });
      },
      { kick: 0.26 },
    ),

  // ---- force -----------------------------------------------------------------------------------------------------------------------
  'cast.force': (ctx) =>
    castChassis(
      ctx,
      (m) => {
        // Charge: a rail-gun capacitor: square pulses accelerating and stepping up D minor (D4 A4 D5 F5 A5 C6 D6), each doubled by a sine an octave
        // down, over pure sines on D3 and D4 swelling.
        const pulses = [0.0, 0.11, 0.2, 0.27, 0.32, 0.36, 0.39, 0.415];
        const pitches = [hz('D4'), hz('A4'), hz('D5'), hz('F5'), hz('A5'), hz('C6'), hz('D6'), hz('D6')];
        pulses.forEach((t, k) => {
          const p = lp(ctx, mul(osc(ctx, 'square', pitches[k]!, 0.04), perc(ctx, 0.001, 0.035, 0.04)), 4500, 0.7);
          m.add(p, { at: 0.02 + t, gain: 0.1 + 0.035 * k, pan: k % 2 ? 0.25 : -0.25, send: 0.25 });
          m.add(mul(osc(ctx, 'sine', pitches[k]! / 2, 0.05), perc(ctx, 0.001, 0.045, 0.05)), { at: 0.02 + t, gain: 0.12 + 0.03 * k });
        });
        const swell = voices(ctx, 'sine', 1, [hz('D3'), hz('D4')], R + 0.02);
        shape(ctx, swell, [[0, 0], [R - 0.01, 1], [R + 0.02, 0]], 'lin');
        m.add(swell, { gain: 0.16 });
        // Release: the shot: a clean sine punch dropping from D5 to D3, a square body on D4 closing, and a short clean metallic FM ring (A5 and D6).
        const punch = osc(ctx, 'sine', glide(hz('D5'), hz('D3'), 0.05), 0.3);
        shape(ctx, punch, [[0, 0], [0.002, 1], [0.08, 0.4], [0.3, 0]]);
        m.add(punch, { at: R, gain: 0.5 });
        const sq = lp(ctx, osc(ctx, 'square', hz('D4'), 0.2), glide(4000, 500, 0.15), 0.8);
        shape(ctx, sq, [[0, 0], [0.002, 1], [0.2, 0]]);
        m.add(sq, { at: R, gain: 0.3, send: 0.2 });
        const metal = fm(ctx, hz('A5'), 0.24, { ratio: 1.41, index: glide(2.5, 0.2, 0.18, 'lin') });
        mul(metal, perc(ctx, 0.001, 0.22, 0.24));
        m.add(metal, { at: R, gain: 0.3, pan: -0.15, send: 0.4 });
        const metal2 = fm(ctx, hz('D6'), 0.25, { ratio: 1.41, index: glide(1.8, 0.2, 0.2, 'lin') });
        mul(metal2, perc(ctx, 0.001, 0.22, 0.25));
        m.add(metal2, { at: R, gain: 0.18, pan: 0.2, send: 0.45 });
      },
      { sub: 0.4 },
    ),

  'impact.force': (ctx) =>
    impactChassis(
      ctx,
      (m) => {
        // The strike: a clean sine punch dropping in quantized steps (D5 A4 D4 A3 D3, 8 ms each) with a single square edge, then the pressure front: a
        // triangle "whomp" stepping D3 A2 D2 and noise closing from 2 kHz to 200 Hz through a jet flanger (the air shoved aside).
        const drop = [hz('D5'), hz('A4'), hz('D4'), hz('A3'), hz('D3')];
        const punch = osc(ctx, 'sine', (t: number) => drop[Math.min(4, Math.floor(t / 0.008))]!, 0.2);
        shape(ctx, punch, [[0, 0], [0.0015, 1], [0.04, 0.3], [0.2, 0]]);
        m.add(punch, { gain: 0.6 });
        const edge = lp(ctx, mul(osc(ctx, 'square', hz('D4'), 0.03), perc(ctx, 0.0005, 0.025, 0.03)), 5000, 0.7);
        m.add(edge, { gain: 0.3 });
        const whomp = osc(ctx, 'triangle', (t: number) => [hz('D3'), hz('A2'), hz('D2')][Math.min(2, Math.floor(t / 0.02))]!, 0.16);
        shape(ctx, whomp, [[0, 0], [0.003, 1], [0.05, 0.3], [0.16, 0]]);
        m.add(whomp, { gain: 0.45 });
        let front = lp(ctx, noise(ctx, 0.12), glide(2000, 200, 0.08), 0.8);
        shape(ctx, front, [[0, 0], [0.002, 1], [0.04, 0.35], [0.12, 0]]);
        front = flange(ctx, front, { rate: 6, depth: 0.003, base: 0.0005, feedback: 0.7, mix: 0.5 });
        m.add(front, { gain: 0.67, send: 0.2 });
        // The ring: a short clean FM ring on D5, and a pressure wave of square pulses on D3 and D4 fading in two throbs.
        const metal = fm(ctx, hz('D5'), 0.2, { ratio: 1.41, index: glide(1.8, 0.2, 0.12, 'lin') });
        mul(metal, perc(ctx, 0.001, 0.18, 0.2));
        m.add(metal, { gain: 0.42, pan: -0.15, send: 0.3 });
        const wave = lp(ctx, voices(ctx, 'square', hz('D3'), [1, 2], 0.24), 2200, 0.9);
        shape(ctx, wave, [[0, 0], [0.004, 0.9], [0.04, 0.1], [0.09, 0.3], [0.2, 0]], 'lin');
        m.add(wave, { gain: 0.3, send: 0.1 });
      },
      { kick: 0.45, from: hz('A3') },
    ),
};
