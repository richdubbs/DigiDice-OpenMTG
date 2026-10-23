/**
 * Game flow sounds (docs/design/sound.md "Game flow"): the start, the opening hand, shuffles, turns, steps, priority, the hot-seat handoff, coins and
 * dice. The turn cues are the set's anchors: a two-note pickup into a synth brass stab in D, with the grid's ping-pong echo; yours is bright D major,
 * the opponent's the same gesture turned down and darkened into D minor.
 *
 * Every note is in D minor (D major for turn.mine and the keep chord). Note for the measurements: the analysis chroma uses 23 Hz FFT bins, so strong
 * partials under ~300 Hz land in a neighbouring pitch class (D3 reads as C#, F3 as E, A3 as G#, D4 as C# or D#): low brass notes show there as
 * stray classes, not as wrong notes.
 */
import type { Recipe, SoundId } from '../catalog';
import {
  addInto,
  bp,
  clamp,
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
  modes,
  mul,
  noise,
  osc,
  panGains,
  perc,
  reverb,
  steps,
  type Ctx,
  type EchoOpts,
  type SpaceOpts,
  type Stereo,
  type Wave,
} from '../dsp';
import { blip, crystal, hum, hz, scaleNoteBetween, shimmer, SPACE, thump, tick, unison, whoosh } from '../palette';

// ---- private helpers -------------------------------------------------------------------------------------------------------------

/** Fades the last `secs` of a stereo signal to silence (raised cosine), so a room tail cut at the sound's length dies away instead of stopping. */
function fadeTail(ctx: Ctx, st: Stereo, secs: number): Stereo {
  const n = st.l.length;
  const f = Math.min(n, Math.round(secs * ctx.sr));
  for (let i = 0; i < f; i++) {
    const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / f);
    st.l[n - 1 - i] = st.l[n - 1 - i]! * g;
    st.r[n - 1 - i] = st.r[n - 1 - i]! * g;
  }
  return st;
}

/**
 * One of the shared rooms (palette.ts SPACE), computed at half the sample rate: the same 8-line network and settings, a quarter of the cost (every
 * room damps its tail far below the half-rate limit of 12 kHz). The send is low-passed at 10 kHz and decimated; the tail is interpolated back.
 */
function room(ctx: Ctx, send: Stereo, space: SpaceOpts): Stereo {
  const half: Ctx = { sr: ctx.sr / 2, variant: ctx.variant, rand: ctx.rand };
  const down = (x: Float32Array): Float32Array => {
    const f = lp(ctx, x, Math.min(10000, ctx.sr * 0.21), 0.6);
    const out = new Float32Array(Math.ceil(f.length / 2));
    for (let i = 0; i < out.length; i++) out[i] = f[2 * i]!;
    return out;
  };
  const wet = reverb(half, { l: down(send.l), r: down(send.r) }, space);
  const up = (w: Float32Array): Float32Array => {
    const out = new Float32Array(send.l.length);
    for (let i = 0; i < out.length; i++) {
      const j = i >> 1;
      out[i] = i & 1 ? 0.5 * (w[j]! + (w[j + 1] ?? 0)) : w[j]!;
    }
    return out;
  };
  return { l: up(wet.l), r: up(wet.r) };
}

/**
 * A mix's finished output, like Mix.out (the echo repeats the send bus and the room hears the repeats), with the half-rate room above. `roomFrom`
 * (s) starts the room there, for a long sound whose opening sends nothing worth a tail (it only saves render time).
 */
function finish(ctx: Ctx, m: Mix, o: { space?: SpaceOpts; echo?: EchoOpts; roomFrom?: number }): Stereo {
  const l = m.dry.l.slice();
  const r = m.dry.r.slice();
  let send: Stereo = m.send;
  if (o.echo) {
    const e = echo(ctx, send, o.echo);
    for (let i = 0; i < l.length; i++) {
      l[i] = l[i]! + (e.l[i]! - send.l[i]!);
      r[i] = r[i]! + (e.r[i]! - send.r[i]!);
    }
    send = e;
  }
  if (o.space) {
    const off = Math.max(0, Math.min(l.length - 1, Math.round((o.roomFrom ?? 0) * ctx.sr)));
    const wet = room(ctx, off ? { l: send.l.subarray(off), r: send.r.subarray(off) } : send, o.space);
    addInto(l, wet.l, off);
    addInto(r, wet.r, off);
  }
  return { l, r };
}

/** Adds a mono signal into a mix with a pan that moves over time (`pan(t)`, t from the signal's start): a sweep across the table. */
function addMoving(ctx: Ctx, m: Mix, sig: Float32Array, o: { at?: number; gain?: number; pan: (t: number) => number; send?: number }): void {
  const off = Math.round((o.at ?? 0) * ctx.sr);
  const g = o.gain ?? 1;
  const end = Math.min(m.length, off + sig.length);
  for (let i = Math.max(0, off); i < end; i++) {
    const [gl, gr] = panGains(o.pan((i - off) / ctx.sr));
    const v = sig[i - off]! * g;
    m.dry.l[i] = m.dry.l[i]! + v * gl;
    m.dry.r[i] = m.dry.r[i]! + v * gr;
    if (o.send) {
      m.send.l[i] = m.send.l[i]! + v * gl * o.send;
      m.send.r[i] = m.send.r[i]! + v * gr * o.send;
    }
  }
}

/**
 * Synth brass (the Tron: Legacy stab): detuned unison saws on `notes` spread across the field, through a low-pass whose envelope opens to `peak`
 * in `open` seconds and closes to `to`; the amplitude swells in `attack` and decays to a held level.
 */
function brass(
  ctx: Ctx,
  o: {
    notes: readonly number[];
    dur: number;
    from: number;
    peak: number;
    to: number;
    open: number;
    attack?: number;
    /** Notes played by one centred voice each (an edge or a root that does not need the unison's width), optionally as [hz, gain]. */
    extra?: readonly (number | readonly [number, number])[];
    voices?: number;
    cents?: number;
    q?: number;
    hold?: number;
    wave?: Wave;
  },
): Stereo {
  const n = len(ctx, o.dur);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  const v = Math.max(1, o.voices ?? 3);
  const cents = o.cents ?? 9;
  const extra = o.extra ?? [];
  const g = 1 / Math.sqrt(v * o.notes.length + extra.length);
  for (const e of extra) {
    const [f, eg] = typeof e === 'number' ? [e, 1] : e;
    const s = osc(ctx, o.wave ?? 'saw', f, o.dur, { phase: ctx.rand() });
    addInto(l, s, 0, g * eg);
    addInto(r, s, 0, g * eg);
  }
  for (const f of o.notes) {
    for (let k = 0; k < v; k++) {
      const x = v === 1 ? 0 : (k / (v - 1)) * 2 - 1;
      const s = osc(ctx, o.wave ?? 'saw', f * 2 ** ((x * cents) / 1200), o.dur, { phase: ctx.rand() });
      const [gl, gr] = panGains(x * 0.7);
      addInto(l, s, 0, g * gl);
      addInto(r, s, 0, g * gr);
    }
  }
  // The filter's path, computed once: open to `peak` in `open` s, then close to `to` by 70% of the length.
  const closeBy = Math.max(o.open + 0.01, o.dur * 0.7);
  const path = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / ctx.sr;
    path[i] = t < o.open ? o.from * (o.peak / o.from) ** (t / o.open) : o.peak * (o.to / o.peak) ** Math.min(1, (t - o.open) / (closeBy - o.open));
  }
  lowpassPair(ctx, l, r, path, o.q ?? 1.0);
  const a = o.attack ?? 0.006;
  const hold = o.hold ?? 0.6;
  const shape = env(ctx, [[0, 0], [a, 1], [a + 0.12, hold], [o.dur * 0.55, hold * 0.55], [o.dur, 0]], o.dur, 'exp');
  return { l: mul(l, shape), r: mul(r, shape) };
}

/**
 * The state-variable low-pass of dsp.ts `svf` (Zavalishin's TPT form, the same response), run on a stereo pair at once with its cutoff read from a
 * precomputed per-sample `path`: one coefficient computation per sample for both sides. In place.
 */
function lowpassPair(ctx: Ctx, l: Float32Array, r: Float32Array, path: Float32Array, q: number): void {
  const k = 1 / Math.max(0.05, q);
  const nyq = ctx.sr * 0.49;
  let l1 = 0;
  let l2 = 0;
  let r1 = 0;
  let r2 = 0;
  for (let i = 0; i < l.length; i++) {
    const g = Math.tan((Math.PI * clamp(path[i] ?? path[path.length - 1]!, 5, nyq)) / ctx.sr);
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const lv3 = l[i]! - l2;
    const lv1 = a1 * l1 + a2 * lv3;
    const lv2 = l2 + a2 * l1 + a3 * lv3;
    l1 = 2 * lv1 - l1;
    l2 = 2 * lv2 - l2;
    l[i] = lv2;
    const rv3 = r[i]! - r2;
    const rv1 = a1 * r1 + a2 * rv3;
    const rv2 = r2 + a2 * r1 + a3 * rv3;
    r1 = 2 * rv1 - r1;
    r2 = 2 * rv2 - r2;
    r[i] = rv2;
  }
}

/**
 * An amplitude flutter: `sig` gated by pulses whose rate follows `rate(t)` (Hz), each pulse a raised sine sharpened by `sharp` (1 soft, 4+ distinct
 * flashes): a spinning coin, a scanning beam. In place.
 */
function flutter(ctx: Ctx, sig: Float32Array, rate: (t: number) => number, sharp: number, depth = 1): Float32Array {
  let ph = 0;
  for (let i = 0; i < sig.length; i++) {
    const g = Math.abs(Math.sin(Math.PI * ph)) ** sharp;
    sig[i] = sig[i]! * (1 - depth + depth * g);
    ph += rate(i / ctx.sr) / ctx.sr;
  }
  return sig;
}

/** A soft FM tine (electric-piano-like): carrier and modulator at the octave, the index decaying fast: a friendly, rounded "ping". */
function tine(ctx: Ctx, freq: number, dur: number, o: { index?: number; decay?: number; attack?: number } = {}): Float32Array {
  const s = fm(ctx, freq, dur, { ratio: 2, index: glide(o.index ?? 1.6, 0.15, 0.09, 'lin') });
  return mul(s, perc(ctx, o.attack ?? 0.003, o.decay ?? dur, dur));
}

/** A digital "readout" knock: a short pitched square under a closing low-pass, crushed a little (a value flashing on a display). */
function readout(ctx: Ctx, freq: number, dur: number, bits = 7): Float32Array {
  const b = blip(ctx, { freq, dur, wave: 'square', decay: dur * 0.9, cutoff: glide(Math.min(9000, freq * 6), freq * 1.5, dur) });
  return crush(ctx, b, bits, 1);
}

// ---- the recipes -----------------------------------------------------------------------------------------------------------------

export const FLOW_SOUNDS: Partial<Record<SoundId, Recipe>> = {
  'game.start': (ctx) => {
    // The grid powers up: a hum and a saw drone swell under a 16th-note arpeggio climbing Dm - Bb - C - C (the epic VI-VII-i lift), a noise riser,
    // then the arrival on D: a wide brass power chord, a sub hit, a crystal flash and glitter thrown into the arena, the hum left running underneath.
    const D = 3.18;
    const hit = 1.44;
    const m = new Mix(ctx, D);
    // Hum: swells into the arrival, then settles and fades out by 2.6 s.
    const hd = 2.6;
    const h = hum(ctx, { freq: hz('D2'), dur: hd, harmonics: [1, 0.45], beat: 0.001 });
    mul(h, env(ctx, [[0, 0], [hit - 0.05, 0.9], [hit + 0.1, 0.35], [2.2, 0.15], [hd, 0]], hd, 'lin'));
    m.add(h, { gain: 0.11 });
    // Drone: D2 + A2 saws, high-passed at 90 Hz (the hum and the sub hit own the lows), under a low-pass climbing from 140 Hz to 2.6 kHz.
    const dd = hit + 0.04;
    const n = len(ctx, dd);
    let dl: Float32Array = new Float32Array(n);
    let dr: Float32Array = new Float32Array(n);
    const voices: [number, number, number, number][] = [
      [hz('D2'), -14, 0.6, -0.7],
      [hz('D2'), 0, 0.6, 0],
      [hz('D2'), 14, 0.6, 0.7],
      [hz('A2'), -10, 0.5, -0.5],
      [hz('A2'), 10, 0.5, 0.5],
    ];
    for (const [f, c, g, pan] of voices) {
      const s = osc(ctx, 'saw', f * 2 ** (c / 1200), dd, { phase: ctx.rand() });
      const [gl, gr] = panGains(pan);
      addInto(dl, s, 0, g * gl);
      addInto(dr, s, 0, g * gr);
    }
    const sweep = new Float32Array(n);
    for (let i = 0; i < n; i++) sweep[i] = 140 * (2600 / 140) ** Math.min(1, i / ctx.sr / hit);
    lowpassPair(ctx, dl, dr, sweep, 1.6);
    dl = hp(ctx, dl, 90);
    dr = hp(ctx, dr, 90);
    const dshape = env(ctx, [[0, 0], [0.5, 0.35], [hit - 0.02, 1], [dd, 0]], dd, 'lin');
    m.addStereo({ l: mul(dl, dshape), r: mul(dr, dshape) }, { gain: 0.1, send: 0.15 });
    // Arpeggio: Dm, Bb, C, C up an octave, 16ths at 90 ms, getting louder and brighter (cutoff 1.8 -> 6 kHz).
    const seq = ['D3', 'A3', 'D4', 'F4', 'Bb3', 'D4', 'F4', 'Bb4', 'C4', 'E4', 'G4', 'C5', 'E4', 'G4', 'C5', 'E5'];
    seq.forEach((note, k) => {
      const x = k / (seq.length - 1);
      const b = blip(ctx, { freq: hz(note), dur: 0.085, wave: 'square', decay: 0.075, cutoff: 1800 * (6000 / 1800) ** x });
      m.add(b, { at: k * 0.09, gain: 0.15 + 0.2 * x, pan: k % 2 ? 0.35 : -0.35, send: 0.25 });
      m.add(blip(ctx, { freq: hz(note) / 2, dur: 0.07, wave: 'triangle', decay: 0.06 }), { at: k * 0.09, gain: 0.05 + 0.05 * x });
    });
    // Riser: noise sweeping up into the hit.
    m.add(whoosh(ctx, { dur: 0.95, from: 500, to: 7000, q: 1.8, peak: 0.97 }), { at: hit - 0.94, gain: 0.3, send: 0.3 });
    // The arrival: brass power chord D3 A3 D4 (three voices each) with A2 and A4 single voices: open fifths, no third, strength without mood.
    m.addStereo(
      brass(ctx, { notes: [hz('D3'), hz('A3'), hz('D4')], extra: [hz('A2'), hz('A4'), hz('D5'), [hz('A5'), 0.6]], dur: 1.25, from: 400, peak: 5200, to: 650, open: 0.03, attack: 0.004, voices: 3, cents: 12, hold: 0.55 }),
      { at: hit, gain: 0.62, send: 0.4 },
    );
    m.add(thump(ctx, { from: 140, to: hz('D2'), drop: 0.08, dur: 0.55 }), { at: hit, gain: 0.35 });
    // The slam: the same sub hit driven into saturation and high-passed at 180 Hz, so its weight survives on laptop and phone speakers (its upper
    // harmonics are D's: D3, A3, D4...).
    const slam = hp(ctx, drive(thump(ctx, { from: 140, to: hz('D2'), drop: 0.08, dur: 0.4 }), 5), 180, 0.7);
    m.add(slam, { at: hit, gain: 0.42, send: 0.2 });
    m.add(mul(bp(ctx, noise(ctx, 0.05), 2600, 0.8), perc(ctx, 0.0005, 0.04)), { at: hit, gain: 0.3, send: 0.4 });
    m.add(crystal(ctx, { freq: hz('D6'), dur: 1.2, bright: 0.6 }), { at: hit + 0.005, gain: 0.16, pan: -0.25, send: 0.6 });
    m.add(crystal(ctx, { freq: hz('A6'), dur: 1.0, bright: 0.5 }), { at: hit + 0.09, gain: 0.1, pan: 0.3, send: 0.6 });
    m.addStereo(shimmer(ctx, { dur: 1.1, density: 22, lo: 1100, hi: 4700, grain: 0.14 }), { at: hit + 0.05, gain: 0.3, send: 0.6 });
    const st = finish(ctx, m, { space: SPACE.arena, roomFrom: 0.45, echo: { time: 0.18, feedback: 0.35, mix: 0.4, pingpong: true, damp: 4200 } });
    return fadeTail(ctx, st, 0.6);
  },

  'game.mulligan': (ctx) => {
    // Rewind and retry: the hand is sucked back (a reversed swell under a quantized run rewinding down the key), its cards fall away as clean pitched
    // blips sinking from 1.9 kHz to 420 Hz (pitched only, no grit: a different texture from the shuffle that follows), then a small rising minor
    // third "again" (D5 -> F5). The engine should start game.shuffle after the "again" (~0.6 s).
    const m = new Mix(ctx, 0.88);
    m.add(whoosh(ctx, { dur: 0.22, from: 600, to: 3200, q: 1.6, peak: 0.95 }), { gain: 0.35, send: 0.2 });
    // Rewind: a quantized run down the key, 22 ms a note, each note its own pulse.
    const run = ['D6', 'C6', 'A5', 'G5', 'F5', 'E5', 'D5', 'C5', 'A4'].map((x) => hz(x));
    const fall = osc(ctx, 'square', steps(run, 0.022), 0.198);
    flutter(ctx, fall, () => 1 / 0.022, 1.5);
    mul(fall, env(ctx, [[0, 0.5], [0.16, 1], [0.198, 0.8]], 0.198, 'lin'));
    m.add(lp(ctx, fall, 3200), { gain: 0.2, pan: -0.15, send: 0.15 });
    // Falling away: 11 pitched blips, their centre sinking from 1.9 kHz to 420 Hz, drifting left to right.
    const count = 11;
    for (let k = 0; k < count; k++) {
      const x = k / (count - 1);
      const c = 1900 * (420 / 1900) ** x;
      const f = scaleNoteBetween(ctx, c * 0.85, c * 1.18);
      const b = blip(ctx, { freq: f, dur: 0.03, wave: k % 2 ? 'triangle' : 'sine', decay: 0.026 });
      m.add(b, { at: 0.2 + k * 0.024, gain: 0.32 * (1 - 0.35 * x), pan: -0.5 + x + 0.2 * (ctx.rand() - 0.5), send: 0.22 });
    }
    [hz('D5'), hz('F5')].forEach((f, k) => {
      const at = 0.5 + k * 0.08;
      m.add(blip(ctx, { freq: f, dur: 0.16, wave: 'triangle', decay: 0.15, cutoff: 3000 }), { at, gain: 0.32, pan: k ? 0.15 : -0.15, send: 0.3 });
      m.add(blip(ctx, { freq: f / 2, dur: 0.12, wave: 'sine', decay: 0.1 }), { at, gain: 0.08 });
    });
    const st = finish(ctx, m, { space: SPACE.table, echo: { time: 0.12, feedback: 0.3, mix: 0.3, pingpong: true, damp: 3500 } });
    return fadeTail(ctx, st, 0.15);
  },

  'game.keep': (ctx) => {
    // Locked in: a latch ("ka" - "chunk": a high tick, then a clamp that stops at 85 Hz, no sub), then a bright D major "ready" chord powering on
    // with a crystal glint.
    const m = new Mix(ctx, 0.78);
    m.add(tick(ctx, { freq: 4200, dur: 0.004 }), { gain: 0.5 });
    m.add(blip(ctx, { freq: hz('A5'), dur: 0.025, wave: 'square', decay: 0.02, cutoff: 4000 }), { gain: 0.6 });
    const clampAt = 0.05;
    m.add(thump(ctx, { from: 180, to: 85, drop: 0.035, dur: 0.15 }), { at: clampAt, gain: 0.3 });
    m.add(mul(bp(ctx, noise(ctx, 0.025), 1300, 1.0), perc(ctx, 0.0005, 0.02)), { at: clampAt, gain: 0.35 });
    m.add(crush(ctx, blip(ctx, { freq: hz('D3'), dur: 0.06, wave: 'square', decay: 0.05, cutoff: 1800 }), 6, 2), { at: clampAt, gain: 0.18 });
    const chordAt = 0.09;
    const cd = 0.55;
    const chord = new Mix(ctx, cd);
    [hz('D5'), hz('F#5'), hz('A5')].forEach((f, k) => {
      chord.add(osc(ctx, 'square', f, cd, { phase: ctx.rand() }), { gain: 0.25, pan: (k - 1) * 0.3 });
      chord.add(osc(ctx, 'triangle', f * 1.003, cd, { phase: ctx.rand() }), { gain: 0.4, pan: (1 - k) * 0.3 });
    });
    chord.add(osc(ctx, 'sine', hz('D4'), cd), { gain: 0.12 });
    const c = chord.out();
    const cut = (t: number) => (t < 0.05 ? 700 * (3800 / 700) ** (t / 0.05) : 3800 * (1200 / 3800) ** Math.min(1, (t - 0.05) / 0.4));
    const shape = env(ctx, [[0, 0], [0.008, 1], [0.12, 0.5], [cd, 0]], cd, 'exp');
    m.addStereo({ l: mul(lp(ctx, c.l, cut, 0.9), shape), r: mul(lp(ctx, c.r, cut, 0.9), shape) }, { at: chordAt, gain: 0.9, send: 0.3 });
    m.add(crystal(ctx, { freq: hz('D6'), dur: 0.5, bright: 0.5 }), { at: chordAt + 0.01, gain: 0.12, pan: 0.2, send: 0.5 });
    const st = finish(ctx, m, { space: SPACE.table, echo: { time: 0.13, feedback: 0.3, mix: 0.3, pingpong: true, damp: 4000 } });
    return fadeTail(ctx, st, 0.15);
  },

  'game.shuffle': (ctx) => {
    // A rapid digital riffle: two halves interleaving (grains alternating left and right: 6-bit crushed clicks and 3 ms square ticks, each with a tiny
    // crushed bit of the key), fast at first then slowing, and the deck squared with two synthetic taps (short thumps with a crushed square knock).
    const m = new Mix(ctx, 0.88);
    const N = 30;
    let t = 0.01;
    for (let k = 0; k < N; k++) {
      const x = k / (N - 1);
      const side = k % 2 ? 1 : -1;
      const g = 0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, x * 1.6));
      const pan = side * (0.55 + 0.15 * ctx.rand());
      if (k % 2) {
        const sq = blip(ctx, { freq: scaleNoteBetween(ctx, 1800, 3000), dur: 0.003, wave: 'square', attack: 0.0003, decay: 0.003 });
        m.add(sq, { at: t, gain: 0.3 * g, pan, send: 0.12 });
      } else {
        const click = crush(ctx, mul(bp(ctx, noise(ctx, 0.006), 1900 + ctx.rand() * 1300, 2.2), perc(ctx, 0.0003, 0.005, 0.006)), 6, 1);
        m.add(click, { at: t, gain: 0.6 * g, pan, send: 0.12 });
      }
      const f = scaleNoteBetween(ctx, 900, 2200);
      m.add(crush(ctx, blip(ctx, { freq: f, dur: 0.012, wave: 'triangle', decay: 0.01 }), 6, 1), { at: t, gain: 0.22 * g, pan: side * 0.5, send: 0.12 });
      t += 0.0125 + 0.022 * x ** 3;
    }
    const air = lp(ctx, whoosh(ctx, { dur: t, from: 900, to: 1600, q: 0.9, peak: 0.4 }), 2200);
    m.add(air, { gain: 0.2, send: 0.1 });
    // Squared: two light taps, D4 then A4 (above the riffle's floor, under its level).
    const s1 = t + 0.04;
    [hz('D4'), hz('A4')].forEach((f, k) => {
      const at = s1 + k * 0.06;
      const g = k ? 0.65 : 1;
      m.add(thump(ctx, { from: 180, to: 110, drop: 0.015, dur: 0.04 }), { at, gain: 0.08 * g });
      m.add(crush(ctx, blip(ctx, { freq: f, dur: 0.025, wave: 'square', decay: 0.022, cutoff: 3000 }), 6, 1), { at, gain: 0.12 * g, send: 0.15 });
    });
    const st = finish(ctx, m, { space: SPACE.table });
    return fadeTail(ctx, st, 0.12);
  },

  'turn.mine': (ctx) => {
    // The anchor: "da-da-DAAH-ding", warm rather than startling (it plays every turn). Two soft FM tine pickups rising (A4, D5) into a D major brass
    // swell (D4 A4 D5 F#5 over a D3 sine) whose filter opens gently to 3.2 kHz in 70 ms (no bite), then a rounded D6 tine "ding" that the ping-pong
    // echo carries across the grid. No ticks, crush or sub hit; a faint crystal glint and a breath of air follow the banner from left to right.
    // Rising and major against turn.theirs' falling minor triangles.
    const m = new Mix(ctx, 1.2);
    const step = 0.09;
    [hz('A4'), hz('D5')].forEach((f, k) => {
      m.add(tine(ctx, f, 0.12, { index: 1.1, decay: 0.11, attack: 0.004 }), { at: k * step, gain: 0.4, pan: k ? 0.15 : -0.15, send: 0.25 });
    });
    const hit = 2 * step;
    const chord = [hz('D4'), hz('A4'), hz('D5'), hz('F#5')];
    m.add(blip(ctx, { freq: hz('D3'), dur: 0.6, wave: 'sine', attack: 0.02, decay: 0.55 }), { at: hit, gain: 0.18 });
    m.addStereo(brass(ctx, { notes: chord, dur: 0.85, from: 500, peak: 3200, to: 1400, open: 0.07, attack: 0.025, voices: 3, cents: 7, hold: 0.5, q: 0.8 }), {
      at: hit,
      gain: 0.75,
      send: 0.3,
    });
    // The ding: a soft D6 tine just after the swell blooms, mostly into the echo.
    m.add(tine(ctx, hz('D6'), 0.3, { index: 0.8, decay: 0.28, attack: 0.004 }), { at: hit + step, gain: 0.16, pan: 0.15, send: 0.8 });
    const trail = whoosh(ctx, { dur: 0.6, from: 1800, to: 4200, q: 1.2, peak: 0.35 });
    addMoving(ctx, m, trail, { at: hit, gain: 0.04, pan: (t) => -0.6 + 1.2 * clamp(t / 0.6, 0, 1), send: 0.3 });
    m.add(crystal(ctx, { freq: hz('D6'), dur: 0.6, bright: 0.25 }), { at: hit + 0.02, gain: 0.08, pan: 0.25, send: 0.5 });
    const st = finish(ctx, m, { space: SPACE.table, echo: { time: 2 * step, feedback: 0.28, mix: 0.25, pingpong: true, damp: 3200 } });
    return fadeTail(ctx, st, 0.25);
  },

  'turn.theirs': (ctx) => {
    // The same gesture turned down: the pickups fall (D4, A3) in triangles into a D minor stab voiced D3 D4 F4 A4 with single A3 and F5 voices (the root
    // low, the minor third doubled on top at -6 dB, no low cluster), its filter opening to 2.8 kHz in 40 ms and settling at 1.3 kHz: darker, lower and calmer than yours, but clean and present on small
    // speakers. A short thump for weight, 2.6 kHz ticks on the pickups and the hit, a dim echo.
    const m = new Mix(ctx, 1.28);
    const step = 0.085;
    [hz('D4'), hz('A3')].forEach((f, k) => {
      m.add(blip(ctx, { freq: f, dur: 0.08, wave: 'triangle', decay: 0.07, cutoff: 2400 }), { at: k * step, gain: 0.34, pan: k ? -0.15 : 0.15, send: 0.25 });
      m.add(tick(ctx, { freq: 2600, dur: 0.003 }), { at: k * step, gain: 0.18 });
    });
    const hit = 2 * step;
    const chord = [hz('D3'), hz('D4'), hz('F4'), hz('A4')];
    m.addStereo(brass(ctx, { notes: chord, extra: [hz('A3'), [hz('F5'), 0.5]], dur: 0.85, from: 300, peak: 2800, to: 1300, open: 0.04, attack: 0.006, voices: 3, cents: 8, hold: 0.5, q: 1.6 }), {
      at: hit,
      gain: 0.65,
      send: 0.3,
    });
    m.add(thump(ctx, { from: 160, to: hz('D2'), drop: 0.05, dur: 0.25 }), { at: hit, gain: 0.22 });
    m.add(tick(ctx, { freq: 2600, dur: 0.003 }), { at: hit, gain: 0.22 });
    m.add(crystal(ctx, { freq: hz('A5'), dur: 0.5, bright: 0.2 }), { at: hit + 0.01, gain: 0.05, pan: -0.25, send: 0.5 });
    const st = finish(ctx, m, { space: SPACE.table, echo: { time: 2 * step, feedback: 0.3, mix: 0.28, pingpong: true, damp: 2400 } });
    return fadeTail(ctx, st, 0.25);
  },

  'turn.step': (ctx) => {
    // A quiet tick of the turn clock: one dry, precise digital "tk", a tiny struck crystal (a short glassy tick, gone in 25 ms) over a click and a
    // breath of A5 body. Variant 0 ticks on E6, variant 1 "tocks" a step lower on D6: alternating or random picks sound like one clock. A single
    // event, so it never blurs with the two soft tines of priority.pass that often come just before it.
    const v = ctx.variant % 2;
    const m = new Mix(ctx, 0.1);
    m.add(tick(ctx, { freq: v ? 2800 : 3200, dur: 0.0025, q: 1.4 }), { gain: 0.5 });
    m.add(modes(ctx, v ? hz('D6') : hz('E6'), 0.05, [1, 2.76], [0.028, 0.012], [1, 0.3]), { gain: 0.5, send: 0.12 });
    m.add(blip(ctx, { freq: hz('A5'), dur: 0.03, wave: 'sine', attack: 0.001, decay: 0.02 }), { gain: 0.35 });
    return finish(ctx, m, { space: SPACE.ui });
  },

  'priority.mine': (ctx) => {
    // "Your move": two soft FM tines rising a fifth (D5 -> A5), open-ended like a question. The A5 lands with a 12 ms crushed square grace an octave
    // up (A6) and its tail blinks at 7 Hz like a terminal cursor waiting for input; a faint crystal halo and a short ping-pong echo.
    const m = new Mix(ctx, 0.44);
    m.add(tine(ctx, hz('D5'), 0.2, { index: 1.4, decay: 0.18 }), { gain: 0.5, pan: -0.15, send: 0.2 });
    // The A5 holds (a lit cursor) so the blink reads above the room: a tine's FM bite with a sustained level that falls only at the end.
    const a5 = mul(fm(ctx, hz('A5'), 0.34, { ratio: 2, index: glide(1.2, 0.15, 0.09, 'lin') }), env(ctx, [[0, 0], [0.003, 1], [0.07, 0.5], [0.28, 0.38], [0.34, 0]], 0.34, 'exp'));
    // Cursor blink from 65 ms into the A5 (150 ms into the sound): an on/off gate at 7 Hz, depth 0.7, 3 ms ramps (a digital blink, not a tremolo).
    const ramp = 0.003 * 7;
    for (let i = 0; i < a5.length; i++) {
      const t = i / ctx.sr - 0.065;
      if (t <= 0) continue;
      const ph = (7 * t) % 1;
      // On for the first half of each period (falling over its last 2 ms), off for the second (rising over its last 2 ms).
      const gate = ph < 0.5 ? Math.min(1, (0.5 - ph) / ramp) : Math.max(0, (ph - (1 - ramp)) / ramp);
      a5[i] = a5[i]! * (1 - 0.7 * (1 - gate));
    }
    m.add(a5, { at: 0.085, gain: 0.5, pan: 0.15, send: 0.12 });
    const grace = blip(ctx, { freq: hz('A6'), dur: 0.012, wave: 'square', attack: 0.0005, decay: 0.012, cutoff: 7000 });
    m.add(crush(ctx, grace, 7, 1), { at: 0.085, gain: 0.18, pan: 0.2, send: 0.3 });
    m.add(blip(ctx, { freq: hz('D4'), dur: 0.15, wave: 'sine', decay: 0.13 }), { gain: 0.18 });
    m.add(crystal(ctx, { freq: hz('A6'), dur: 0.3, bright: 0.3 }), { at: 0.085, gain: 0.06, pan: 0.3, send: 0.4 });
    const st = finish(ctx, m, { space: SPACE.table, echo: { time: 0.11, feedback: 0.2, mix: 0.14, pingpong: true, damp: 3500 } });
    return fadeTail(ctx, st, 0.08);
  },

  'priority.pass': (ctx) => {
    // "Acknowledged, moving on": a soft FM tine dyad (D5 over A4, variant 1 over F4) that steps aside: the same dyad answers from the right, darker
    // (FM index 0.4: the tone dulls as it moves on, which reads even in mono) with a 3 ms crushed tick, as a breath of air slides across. Same pitch,
    // so it never resembles the falling two notes of ui.cancel. The question of priority.mine, answered.
    const v = ctx.variant % 2;
    const low = v ? hz('F4') : hz('A4');
    const idx = v ? 0.85 : 1;
    const m = new Mix(ctx, 0.15);
    const hit = (top: number, at: number, gain: number, pan: number, bright: number) => {
      m.add(tine(ctx, top, 0.09, { index: 0.9 * bright * idx, decay: 0.08, attack: 0.002 }), { at, gain, pan, send: 0.12 });
      m.add(tine(ctx, low, 0.08, { index: 0.6 * bright * idx, decay: 0.07, attack: 0.002 }), { at, gain: gain * 0.55, pan, send: 0.12 });
    };
    const second = v ? 0.064 : 0.055;
    hit(hz('D5'), 0, 0.5, -0.3, 1);
    hit(hz('D5'), second, 0.22, 0.45, 0.4 / (0.9 * idx));
    m.add(crush(ctx, tick(ctx, { freq: 2600, dur: 0.003 }), 6, 1), { gain: 0.08, pan: -0.3 });
    m.add(crush(ctx, tick(ctx, { freq: 2600, dur: 0.003 }), 6, 1), { at: second, gain: 0.12, pan: 0.45 });
    const air = whoosh(ctx, { dur: 0.1, from: v ? 1300 : 1500, to: v ? 3000 : 3500, q: 2.2, peak: 0.45 });
    addMoving(ctx, m, air, { at: 0.004, gain: 0.22, pan: (t) => -0.7 + 1.4 * clamp(t / 0.1, 0, 1), send: 0.15 });
    const st = finish(ctx, m, { space: SPACE.ui });
    return fadeTail(ctx, st, 0.02);
  },

  'game.handoff': (ctx) => {
    // Pass the device: the cover slides down over the screen (a falling whoosh crossing from this side to the other over scanlines stepping down the
    // key), shuts with a crisp clamp, then a calm two-pulse standby (A4 + D5, moving across) waits for the other player.
    const m = new Mix(ctx, 0.88);
    const sl = 0.3;
    const w = whoosh(ctx, { dur: sl, from: 3000, to: 500, q: 1.4, peak: 0.6 });
    addMoving(ctx, m, w, { gain: 0.3, pan: (t) => -0.6 + 1.2 * clamp(t / sl, 0, 1), send: 0.25 });
    // Scanlines: D6 C6 A5 F5 E5 D5, 50 ms each, chopped into two pulses per step (the pulses meet the steps at zero, so no step clicks).
    const lines = ['D6', 'C6', 'A5', 'F5', 'E5', 'D5'].map((x) => hz(x));
    const sc = osc(ctx, 'triangle', steps(lines, 0.05), sl);
    flutter(ctx, sc, () => 40, 2);
    mul(sc, env(ctx, [[0, 0.5], [0.1, 1], [sl, 0.6]], sl, 'lin'));
    addMoving(ctx, m, lp(ctx, sc, 3200), { gain: 0.2, pan: (t) => -0.4 + 0.8 * clamp(t / sl, 0, 1), send: 0.2 });
    // The clamp.
    m.add(tick(ctx, { freq: 3000, dur: 0.004 }), { at: sl, gain: 0.3 });
    m.add(crush(ctx, blip(ctx, { freq: hz('D4'), dur: 0.05, wave: 'square', decay: 0.045, cutoff: 2000 }), 6, 2), { at: sl, gain: 0.25 });
    m.add(thump(ctx, { from: 170, to: 85, drop: 0.03, dur: 0.12 }), { at: sl, gain: 0.2 });
    // Standby.
    [0, 1].forEach((k) => {
      const at = sl + 0.15 + k * 0.18;
      for (const f of [hz('A4'), hz('D5')]) {
        m.add(blip(ctx, { freq: f, dur: 0.17, wave: 'triangle', attack: 0.012, decay: 0.15, cutoff: 2400 }), { at, gain: 0.26 - 0.06 * k, pan: k ? 0.35 : -0.1, send: 0.35 });
      }
    });
    const st = finish(ctx, m, { space: SPACE.table, echo: { time: 0.12, feedback: 0.22, mix: 0.2, pingpong: true, damp: 2500 } });
    return fadeTail(ctx, st, 0.15);
  },

  'game.coin': (ctx) => {
    // A coin flip as data: a crushed flick ping, then the coin spins as a value flashing heads / tails (an FM tone stepping between D6 and A5 on
    // every flash, the flashes slowing from 28 to 16 a second into the landing), a crushed strike, the wobble flashing D6 / A5 faster and faster as it settles, then a
    // clean two-note crystal result.
    const m = new Mix(ctx, 1.08);
    const f0 = hz('D6');
    const f1 = hz('A5');
    m.add(tick(ctx, { freq: 3500, dur: 0.004 }), { gain: 0.35 });
    m.add(crush(ctx, modes(ctx, f0, 0.25, [1, 1.59, 2.41], [0.25, 0.14, 0.08], [1, 0.4, 0.2]), 8, 1), { gain: 0.3, pan: -0.1, send: 0.2 });
    // The spin: one flash per half-turn; the carrier changes note only between flashes (where the gate is silent), so the steps never click.
    const air = 0.47;
    const na = len(ctx, air);
    const ph = new Float64Array(na);
    for (let i = 1; i < na; i++) ph[i] = ph[i - 1]! + (28 * (16 / 28) ** ((i - 1) / na)) / ctx.sr;
    const spin = fm(ctx, (t) => (Math.floor(ph[Math.min(na - 1, Math.round(t * ctx.sr))]!) % 2 ? f1 : f0), air, { ratio: 1.59, index: 0.6 });
    for (let i = 0; i < na; i++) spin[i] = spin[i]! * Math.abs(Math.sin(Math.PI * ph[i]!)) ** 3;
    mul(spin, env(ctx, [[0, 0], [0.04, 0.8], [air * 0.5, 1], [air - 0.02, 0.6], [air, 0]], air, 'lin'));
    addMoving(ctx, m, lp(ctx, spin, 3500, 0.7), { at: 0.03, gain: 0.17, pan: (t) => -0.2 + 0.5 * (t / air), send: 0.25 });
    const land = 0.52;
    m.add(crush(ctx, modes(ctx, f0, 0.35, [1, 1.59, 2.41, 3.3], [0.35, 0.2, 0.12, 0.07], [1, 0.5, 0.3, 0.15]), 8, 1), { at: land, gain: 0.35, pan: 0.2, send: 0.25 });
    m.add(tick(ctx, { freq: 3000, dur: 0.004 }), { at: land, gain: 0.3 });
    m.add(thump(ctx, { from: 300, to: 150, drop: 0.02, dur: 0.06 }), { at: land, gain: 0.25 });
    const wob = 0.3;
    const nw = len(ctx, wob);
    const wph = new Float64Array(nw);
    for (let i = 1; i < nw; i++) wph[i] = wph[i - 1]! + (16 * (55 / 16) ** ((i - 1) / nw)) / ctx.sr;
    const wt = fm(ctx, (t) => (Math.floor(wph[Math.min(nw - 1, Math.round(t * ctx.sr))]!) % 2 ? f1 : f0), wob, { ratio: 1.59, index: 0.6 });
    for (let i = 0; i < nw; i++) wt[i] = wt[i]! * Math.abs(Math.sin(Math.PI * wph[i]!)) ** 3;
    mul(wt, env(ctx, [[0, 1], [0.2, 0.45], [wob, 0]], wob, 'lin'));
    m.add(lp(ctx, wt, 3000), { at: land + 0.03, gain: 0.3, pan: 0.2, send: 0.15 });
    const res = land + 0.32;
    m.add(crystal(ctx, { freq: hz('A5'), dur: 0.24, bright: 0.4 }), { at: res, gain: 0.3, pan: -0.1, send: 0.35 });
    m.add(crystal(ctx, { freq: hz('D6'), dur: 0.22, bright: 0.4 }), { at: res + 0.05, gain: 0.25, pan: 0.15, send: 0.35 });
    const st = finish(ctx, m, { space: SPACE.table });
    return fadeTail(ctx, st, 0.12);
  },

  'game.dice': (ctx) => {
    // A die tumbling across the grid: knocks slowing down (gaps growing; each a short synthetic thump with a click), each flashing a different value
    // (a crushed square readout on a note of the key), then it settles and the result reads out: a firm fifth (D5 + A5) with a crystal glint.
    const m = new Mix(ctx, 1.08);
    const hits = [0, 0.055, 0.12, 0.195, 0.285, 0.395, 0.53];
    let last = 0;
    hits.forEach((t, k) => {
      const x = k / (hits.length - 1);
      const g = 0.8 - 0.3 * x;
      const pan = -0.5 + 0.8 * x;
      m.add(thump(ctx, { from: 200, to: 120, drop: 0.01, dur: 0.03 }), { at: t, gain: 0.45 * g, pan });
      m.add(mul(bp(ctx, noise(ctx, 0.006), 1700 + 600 * ctx.rand(), 1.6), perc(ctx, 0.0003, 0.005, 0.006)), { at: t, gain: 0.35 * g, pan, send: 0.15 });
      let f = scaleNoteBetween(ctx, 520, 1400);
      while (f === last) f = scaleNoteBetween(ctx, 520, 1400);
      last = f;
      m.add(readout(ctx, f, 0.045, 7), { at: t + 0.002, gain: 0.4 * g, pan: pan * 0.6, send: 0.2 });
    });
    const res = 0.66;
    m.add(tick(ctx, { freq: 2800, dur: 0.003 }), { at: res, gain: 0.25 });
    [hz('D5'), hz('A5')].forEach((f, k) => {
      m.add(blip(ctx, { freq: f, dur: 0.3, wave: 'square', attack: 0.002, decay: 0.26, cutoff: glide(3600, 1400, 0.2) }), { at: res, gain: 0.3, pan: k ? 0.15 : -0.15, send: 0.3 });
      m.add(blip(ctx, { freq: f, dur: 0.3, wave: 'triangle', attack: 0.002, decay: 0.28 }), { at: res, gain: 0.4, send: 0.3 });
    });
    m.add(crystal(ctx, { freq: hz('D6'), dur: 0.35, bright: 0.4 }), { at: res + 0.02, gain: 0.12, pan: 0.25, send: 0.4 });
    const st = finish(ctx, m, { space: SPACE.table, echo: { time: 0.12, feedback: 0.25, mix: 0.22, pingpong: true, damp: 3500 } });
    return fadeTail(ctx, st, 0.12);
  },
};
