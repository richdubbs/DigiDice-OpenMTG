/**
 * Combat, life and counter sounds (docs/design/sound.md "Combat"): attacks, blocks, swings, hits by weight, damage to players, life, counters and
 * power changes, prevention.
 *
 * - Hits are physical digital blows, layered by weight: a knock (a short pitched drop) for contact, a crushed noise crack for the digital edge, a
 *   struck square/saw body in the key, and sub bass only from medium up. Heavier hits get longer, darker, more crushed and more room.
 * - The light cycle (attack, swing) is a driven saw / FM growl revving up in pitch with a high whine riding on it.
 * - Counters are stepped (discrete square blips: data increments); stats are smooth (unison saw sweeps: surges and sags). Up rises, down falls.
 */
import type { Recipe, SoundId } from '../catalog';
import {
  bp,
  clamp,
  comb,
  compress,
  crush,
  drive,
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
  panGains,
  perc,
  ring,
  steps,
  varispeed,
  type Ctx,
  type Param,
  type SpaceOpts,
  type Stereo,
  type Wave,
} from '../dsp';
import { blip, clang, crystal, D_MAJOR, hz, scaleNoteBetween, shimmer, SPACE, thump, tick, unison, zap } from '../palette';

// ---- private helpers --------------------------------------------------------------------------------------------------------------

/** A value of a Param at time t. */
function val(p: Param, t: number): number {
  return typeof p === 'number' ? p : p(t);
}

/** Adds a mono signal whose pan moves over time (`pan(t)`, t from the signal's start): motion across the table. */
function addMoving(ctx: Ctx, m: Mix, sig: Float32Array, pan: Param, o: { at?: number; gain?: number; send?: number } = {}): void {
  const off = Math.round((o.at ?? 0) * ctx.sr);
  const g = o.gain ?? 1;
  const s = o.send ?? 0;
  const n = Math.min(sig.length, m.length - off);
  let gl = 1;
  let gr = 1;
  for (let i = 0; i < n; i++) {
    if ((i & 15) === 0) [gl, gr] = panGains(val(pan, i / ctx.sr));
    const v = sig[i]! * g;
    m.dry.l[off + i] = m.dry.l[off + i]! + v * gl;
    m.dry.r[off + i] = m.dry.r[off + i]! + v * gr;
    if (s) {
      m.send.l[off + i] = m.send.l[off + i]! + v * gl * s;
      m.send.r[off + i] = m.send.r[off + i]! + v * gr * s;
    }
  }
}

/** The digital crack of a contact: a burst of band-passed noise, bit-crushed and sample-held. */
function crack(
  ctx: Ctx,
  o: { freq: number; decay: number; q?: number; bits?: Param; hold?: Param; color?: 'white' | 'pink'; tune?: number; ring?: number },
): Float32Array {
  const d = o.decay + 0.004;
  const s = bp(ctx, noise(ctx, d, o.color ?? 'white'), o.freq, o.q ?? 1);
  mul(s, perc(ctx, 0.0004, o.decay, d));
  const c = crush(ctx, s, o.bits ?? 7, o.hold ?? 2);
  if (!o.tune) return c;
  // Tuned: the crack rings briefly on a note of the key (a comb), a pitched digital "tink" instead of plain noise.
  const x = new Float32Array(len(ctx, d + 0.06));
  x.set(c);
  const rung = comb(ctx, x, o.tune, o.ring ?? 0.6, 0.3);
  for (let i = 0; i < x.length; i++) x[i] = x[i]! * 0.5 + rung[i]! * 0.5;
  return x;
}

/**
 * A struck pitched body: `wave` at `from` Hz for `drop` s, then stepping down to `to` (a quantized pitch drop, not a slide: it lands in the key at
 * once), decaying in `decay`, low-passed (the "punch" of a blow).
 */
function knock(ctx: Ctx, o: { from: number; to: number; drop: number; decay: number; wave?: Wave; cutoff?: Param; drive?: number; pw?: number }): Float32Array {
  const d = o.decay + 0.005;
  let s = osc(ctx, o.wave ?? 'square', (t) => (t < o.drop ? o.from : o.to), d, o.pw !== undefined ? { pw: o.pw } : {});
  if (o.drive) s = drive(s, o.drive);
  s = lp(ctx, s, o.cutoff ?? 3000, 0.8);
  return mul(s, perc(ctx, 0.0008, o.decay, d));
}

/** A punch: a sine stepping down through `notes` (`step` s each, then holding the last), with a thump's envelope (a quantized, in-key kick). */
function punch(ctx: Ctx, o: { notes: readonly number[]; step: number; dur: number }): Float32Array {
  const s = osc(ctx, 'sine', steps(o.notes, o.step), o.dur);
  return mul(s, env(ctx, [[0, 0], [0.0015, 1], [o.dur * 0.35, 0.45], [o.dur, 0]], o.dur, 'exp'));
}

/** Peak-normalizes a mix and compresses it (threshold in dB under the peak): hits that reach their loudness without hitting the peak limit. */
function squash(ctx: Ctx, st: Stereo, o: { threshold: number; ratio: number; attack?: number; release?: number }): Stereo {
  let peak = 1e-9;
  for (let i = 0; i < st.l.length; i++) peak = Math.max(peak, Math.abs(st.l[i]!), Math.abs(st.r[i]!));
  const g = 1 / peak;
  for (let i = 0; i < st.l.length; i++) {
    st.l[i] = st.l[i]! * g;
    st.r[i] = st.r[i]! * g;
  }
  return compress(ctx, st, { threshold: o.threshold, ratio: o.ratio, attack: o.attack ?? 0.0015, release: o.release ?? 0.09, knee: 6 });
}

/** Soft-clips a stereo mix after normalizing it to its peak (tanh): saturates the loudest transients, a denser and louder blow. In place. */
function saturate(st: Stereo, amount: number): Stereo {
  let peak = 1e-9;
  for (let i = 0; i < st.l.length; i++) peak = Math.max(peak, Math.abs(st.l[i]!), Math.abs(st.r[i]!));
  for (let i = 0; i < st.l.length; i++) {
    st.l[i] = st.l[i]! / peak;
    st.r[i] = st.r[i]! / peak;
  }
  drive(st.l, amount);
  drive(st.r, amount);
  return st;
}

/** Amplitude modulation at a (possibly moving) rate: a spinning disc's whirr, an engine's pulse, energy draining in throbs. In place. */
function throb(ctx: Ctx, x: Float32Array, rate: Param, depth: number): Float32Array {
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const g = 1 - depth * (0.5 - 0.5 * Math.cos(2 * Math.PI * ph));
    x[i] = x[i]! * g;
    ph += val(rate, i / ctx.sr) / ctx.sr;
    ph -= Math.floor(ph);
  }
  return x;
}

/** A mono signal shaped by a breakpoint envelope. */
function shaped(ctx: Ctx, x: Float32Array, points: readonly (readonly [number, number])[], curve: 'lin' | 'exp' = 'exp'): Float32Array {
  return mul(x, env(ctx, points, x.length / ctx.sr, curve));
}

/** Unison saws (stereo) through a moving low-pass and an envelope: the smooth surges and sags of stats. */
function sweepVoice(
  ctx: Ctx,
  o: { freq: Param; dur: number; cutoff: Param; q?: number; points: readonly (readonly [number, number])[]; voices?: number; cents?: number; wave?: Wave },
): Stereo {
  const u = unison(ctx, o.wave ?? 'saw', o.freq, o.dur, { voices: o.voices ?? 3, cents: o.cents ?? 9, width: 0.5 });
  const e = env(ctx, o.points, o.dur, 'exp');
  return { l: mul(lp(ctx, u.l, o.cutoff, o.q ?? 1), e), r: mul(lp(ctx, u.r, o.cutoff, o.q ?? 1), e) };
}

/** Light debris of a blow: a few tiny crushed square grains in the key, falling from `from` to `to` Hz over `dur` (not the derezz voxels). */
function debris(ctx: Ctx, m: Mix, o: { at: number; dur: number; count: number; from: number; to: number; gain: number; send?: number }): void {
  for (let k = 0; k < o.count; k++) {
    const x = (k + ctx.rand() * 0.8) / o.count;
    const t = x * x * o.dur;
    const centre = o.from * (o.to / o.from) ** x;
    const f = scaleNoteBetween(ctx, centre * 0.8, centre * 1.25);
    const d = 0.008 + ctx.rand() * 0.014;
    const g = crush(ctx, blip(ctx, { freq: f, dur: d, wave: 'square', decay: d, cutoff: Math.min(9000, f * 4) }), 5, 2);
    m.add(g, { at: o.at + t, gain: o.gain * (1 - 0.6 * x) * (0.6 + 0.5 * ctx.rand()), pan: ctx.rand() * 1.4 - 0.7, send: o.send ?? 0.3 });
  }
}

/** Sum of oscillators on `freqs` (each at 1/n), random phases. */
function chordOsc(ctx: Ctx, wave: Wave, freqs: readonly Param[], dur: number): Float32Array {
  const out = new Float32Array(len(ctx, dur));
  for (const f of freqs) {
    const s = osc(ctx, wave, f, dur, { phase: ctx.rand() });
    for (let i = 0; i < s.length; i++) out[i] = out[i]! + s[i]! / freqs.length;
  }
  return out;
}

/** Fades a finished mix out from `from` seconds to its end (a raised cosine), so a room tail never stops abruptly at the sound's length limit. */
function fadeEnd(ctx: Ctx, st: Stereo, from: number): Stereo {
  const a = Math.round(from * ctx.sr);
  const n = st.l.length;
  for (let i = Math.max(0, a); i < n; i++) {
    const g = 0.5 + 0.5 * Math.cos((Math.PI * (i - a)) / Math.max(1, n - a));
    st.l[i] = st.l[i]! * g;
    st.r[i] = st.r[i]! * g;
  }
  return st;
}

/** Throb applied to both channels of a stereo signal (same phase). */
function throbSt(ctx: Ctx, st: Stereo, rate: Param, depth: number): Stereo {
  throb(ctx, st.l, rate, depth);
  throb(ctx, st.r, rate, depth);
  return st;
}

const TABLE: SpaceOpts = SPACE.table;

// ---- recipes ------------------------------------------------------------------------------------------------------------------------

export const COMBAT_SOUNDS: Partial<Record<SoundId, Recipe>> = {
  'combat.attack': (ctx) => {
    // "Charge!": a driven power-chord hit (D2 A2 D3) as the attackers lurch forward, then the light cycles rev: a throttle blip D3 -> A3, a gear
    // shift, a second rev E3 -> D4 held at speed with a whine two octaves up, sweeping across the table and dropping a step (D4 -> C4) as they pass,
    // leaving a ping-pong light trail.
    const D = 1.1;
    const m = new Mix(ctx, D);
    const [d3, e3, a3, c4, d4] = [hz('D3'), hz('E3'), hz('A3'), hz('C4'), hz('D4')];
    m.add(thump(ctx, { from: 360, to: hz('A1'), drop: 0.04, dur: 0.32 }), { gain: 0.6 });
    m.add(crack(ctx, { freq: 1800, decay: 0.05, q: 0.8, bits: 6, hold: 3 }), { gain: 0.45, send: 0.2 });
    const chord = [hz('D2'), hz('A2'), d3].map((f) => glide(f * 0.94, f, 0.03));
    const stab = shaped(ctx, lp(ctx, drive(chordOsc(ctx, 'saw', chord, 0.4), 2.2), glide(4200, 600, 0.3), 1.3), [[0, 0], [0.004, 1], [0.1, 0.5], [0.4, 0]]);
    m.add(stab, { gain: 0.5, send: 0.2 });
    // The rev curve, tabulated once (it drives five layers).
    const ED = 0.95;
    const rev = new Float32Array(len(ctx, ED) + 1);
    for (let i = 0; i < rev.length; i++) {
      const t = i / ctx.sr;
      rev[i] =
        t < 0.12 ? d3 * (a3 / d3) ** (t / 0.12)
        : t < 0.19 ? a3 * (e3 / a3) ** ((t - 0.12) / 0.07)
        : t < 0.42 ? e3 * (d4 / e3) ** (1 - (1 - (t - 0.19) / 0.23) ** 2)
        : t < 0.66 ? d4 * 2 ** ((10 / 1200) * Math.sin(2 * Math.PI * 9 * t))
        : d4 * (c4 / d4) ** Math.min(1, (t - 0.66) / 0.14);
    }
    const revF = (t: number): number => rev[Math.min(rev.length - 1, Math.round(t * ctx.sr))]!;
    const growl = fm(ctx, revF, ED, { ratio: 0.5, index: glide(1.6, 2.6, 0.45, 'lin'), feedback: 0.25 });
    const buzz = osc(ctx, 'pulse', revF, ED, { pw: 0.2 });
    const engine = new Float32Array(growl.length);
    for (let i = 0; i < engine.length; i++) engine[i] = growl[i]! * 0.6 + buzz[i]! * 0.4;
    const eng = shaped(ctx, lp(ctx, drive(engine, 1.8), (t) => 2400 + 1000 * clamp((t - 0.3) / 0.12, 0, 1) * clamp((0.8 - t) / 0.14, 0, 1), 0.9), [[0, 0], [0.02, 0.55], [0.11, 0.8], [0.19, 0.6], [0.3, 0.75], [0.45, 1], [0.66, 0.85], [ED, 0]]);
    throb(ctx, eng, (t) => revF(t) * 0.125, 0.25);
    const travel = (t: number): number => clamp(-0.4 + 0.9 * ((t - 0.2) / 0.6), -0.4, 0.5);
    addMoving(ctx, m, eng, travel, { at: 0.02, gain: 0.5, send: 0.22 });
    const whine = shaped(ctx, osc(ctx, 'triangle', (t) => revF(t) * 4, ED), [[0, 0], [0.11, 0.4], [0.19, 0.12], [0.45, 1], [0.66, 0.8], [ED, 0]]);
    addMoving(ctx, m, whine, travel, { at: 0.02, gain: 0.18, send: 0.5 });
    const rush = bp(ctx, noise(ctx, 0.8, 'pink'), glide(500, 3200, 0.6), 1.2);
    addMoving(ctx, m, shaped(ctx, rush, [[0, 0], [0.55, 1], [0.8, 0]], 'lin'), (t) => -0.5 + 1.1 * (t / 0.8), { at: 0.05, gain: 0.25, send: 0.25 });
    return fadeEnd(ctx, m.out({ space: TABLE, echo: { time: 0.14, feedback: 0.35, mix: 0.4, pingpong: true, damp: 4500 } }), 0.92);
  },

  'combat.block': (ctx) => {
    // A barrier slams into place: a fast swish stepping in, then a hard slam (a 25 ms driven square D3 + A3 stab and a crushed crack over a low
    // punch) and a blue force field snapping on: a wide square chord D3 A3 D4 A4 (the A4 locking down onto D4) through a resonant filter sweeping down, trembling as it
    // settles, a cold metallic edge and a glint.
    const m = new Mix(ctx, 0.7);
    const T = 0.06;
    const sw = shaped(ctx, bp(ctx, noise(ctx, T + 0.01, 'pink'), glide(600, 5000, T), 1.4), [[0, 0], [T * 0.85, 1], [T + 0.008, 0]], 'lin');
    addMoving(ctx, m, sw, (t) => -0.5 + 0.5 * (t / T), { gain: 0.6, send: 0.2 });
    m.add(thump(ctx, { from: 250, to: hz('D2'), drop: 0.03, dur: 0.22 }), { at: T, gain: 0.35 });
    m.add(crack(ctx, { freq: 1600, decay: 0.04, q: 0.7, bits: 6, hold: 2 }), { at: T, gain: 0.7, send: 0.2 });
    const slam = chordOsc(ctx, 'square', [hz('D3'), hz('A3')], 0.03);
    m.add(shaped(ctx, lp(ctx, drive(slam, 2.5), 3000, 0.8), [[0, 0], [0.001, 1], [0.012, 0.6], [0.03, 0]]), { at: T, gain: 0.32, send: 0.15 });
    const FD = 0.5;
    const fieldMix = new Mix(ctx, FD);
    // The top voice steps A4 -> D4 at 0.1 s: the field locks onto the root.
    for (const f of [hz('D3'), hz('A3'), hz('D4'), steps([hz('A4'), hz('D4')], 0.1)]) fieldMix.addStereo(unison(ctx, 'square', f, FD, { voices: 2, cents: 8, width: 0.7 }), { gain: 0.35 });
    const fs = fieldMix.out();
    const cut = glide(5200, 520, 0.3);
    const fe = env(ctx, [[0, 0], [0.003, 1], [0.1, 0.5], [FD, 0]], FD, 'exp');
    const field = throbSt(ctx, { l: mul(lp(ctx, fs.l, cut, 3), fe), r: mul(lp(ctx, fs.r, cut, 3), fe) }, glide(28, 11, FD), 0.55);
    m.addStereo(field, { at: T, gain: 0.5, send: 0.3 });
    m.add(crush(ctx, clang(ctx, { freq: hz('D4'), dur: 0.3, index: 3 }), 8, 1), { at: T, gain: 0.16, send: 0.25 });
    m.add(crystal(ctx, { freq: hz('D6'), dur: 0.3, bright: 0.4 }), { at: T + 0.004, gain: 0.1, pan: 0.3, send: 0.4 });
    return fadeEnd(ctx, m.out({ space: TABLE }), 0.58);
  },

  'combat.arm': (ctx) => {
    // Weapon armed, a small cousin of the attack: a chamber click, then a driven saw growl revving up a fifth in two quantized steps (D4 -> A4) over a
    // crushed low bite stepping up with it (D3 -> A3). Gritty and low where the interface toggles are thin and high; one gesture, all rising.
    const m = new Mix(ctx, 0.15);
    m.add(tick(ctx, { freq: 3200, dur: 0.004, q: 1.6 }), { gain: 0.5 });
    const rev = chordOsc(ctx, 'saw', [steps([hz('D4'), hz('A4')], 0.026), steps([hz('D4') * 1.006, hz('A4') * 1.006], 0.026)], 0.09);
    const sub = osc(ctx, 'pulse', steps([hz('D3'), hz('A3')], 0.026), 0.09, { pw: 0.2 });
    for (let i = 0; i < rev.length; i++) rev[i] = rev[i]! + sub[i]! * 0.5;
    const growl = lp(ctx, drive(rev, 2.4), glide(1400, 3400, 0.05), 1.1);
    m.add(shaped(ctx, growl, [[0, 0], [0.002, 0.7], [0.025, 0.55], [0.028, 1], [0.09, 0]]), { gain: 0.4, send: 0.12 });
    const bite = crush(ctx, knock(ctx, { from: hz('D3'), to: hz('A3'), drop: 0.026, decay: 0.05, wave: 'square', cutoff: 2000 }), 5, 2);
    m.add(bite, { gain: 0.34 });
    return fadeEnd(ctx, m.out({ space: SPACE.ui }), 0.12);
  },

  'combat.assign': (ctx) => {
    // A defensive assignment, a small cousin of the block: a latch ("tk-thunk": a light catch, then one round metallic clunk, A3 body and an A4 plate
    // whose partials are the crystal family's) with a tiny blue field snapping on and closing (a square D4 + A4 fifth through a resonant filter
    // falling): clamped, shielded. No melodic step.
    const m = new Mix(ctx, 0.15);
    const L = 0.016;
    m.add(tick(ctx, { freq: 4200, dur: 0.003 }), { gain: 0.2, pan: -0.1 });
    m.add(tick(ctx, { freq: 2400, dur: 0.004, q: 1.4 }), { at: L, gain: 0.4 });
    m.add(modes(ctx, hz('A4'), 0.1, [1, 2, 2.76, 3], [0.09, 0.05, 0.03, 0.035], [1, 0.4, 0.22, 0.3]), { at: L, gain: 0.3, send: 0.15 });
    m.add(blip(ctx, { freq: hz('A3'), dur: 0.07, wave: 'sine', decay: 0.06 }), { at: L, gain: 0.45 });
    const field = chordOsc(ctx, 'square', [hz('D4'), hz('A4')], 0.11);
    const f2 = lp(ctx, field, glide(3600, 700, 0.08), 2.2);
    m.add(shaped(ctx, f2, [[0, 0], [0.004, 1], [0.03, 0.5], [0.11, 0]]), { at: L + 0.004, gain: 0.16, send: 0.2 });
    return fadeEnd(ctx, m.out({ space: SPACE.ui }), 0.13);
  },

  'combat.swing': (ctx) => {
    // The wind-up: a rising rush of air with an identity disc spinning up inside it (a triangle whirr rising a fifth, D5 -> A5, its spin quickening),
    // building to 0.25 s, then cut away just before contact (0.28 s). Small room sends: several swings 70 ms apart must not smear the hits. Variant 1
    // swings from the other side, a step lower (C5 -> G5); variant 2 a third higher (F5 -> C6).
    const v = ctx.variant % 3;
    const D = 0.5;
    const PK = 0.245;
    const OFF = 0.285;
    const m = new Mix(ctx, D);
    const shape: [number, number][] = [[0, 0], [0.03, 0.1], [PK, 1], [OFF, 0]];
    const dir = v === 1 ? -1 : 1;
    const pan = (t: number): number => dir * (-0.45 + 0.6 * clamp(t / OFF, 0, 1));
    const air = bp(ctx, noise(ctx, OFF + 0.01, 'pink'), glide(300, 3000, PK), 1.0);
    addMoving(ctx, m, shaped(ctx, air, shape), pan, { gain: 0.8, send: 0.1 });
    const hiss = bp(ctx, noise(ctx, OFF + 0.01), 6500, 0.9);
    addMoving(ctx, m, shaped(ctx, hiss, shape), pan, { gain: 0.1, send: 0.1 });
    const base = [hz('D5'), hz('C5'), hz('F5')][v]!;
    const fr = glide(base, base * 1.5, PK * 0.7);
    const whirr = lp(ctx, osc(ctx, 'triangle', fr, OFF + 0.01), 3000, 0.7);
    throb(ctx, whirr, glide(14, 36, PK), 0.8);
    addMoving(ctx, m, shaped(ctx, whirr, shape), pan, { gain: 0.22, send: 0.1 });
    m.add(shaped(ctx, osc(ctx, 'sine', (t) => fr(t) / 4, OFF + 0.01), shape), { gain: 0.08 });
    return fadeEnd(ctx, m.out({ space: TABLE }), 0.34);
  },

  'hit.light': (ctx) => {
    // A crisp light blow, carried by its transient: a crushed high crack ringing briefly on the key (a comb on the knock's note), a square knock
    // snapping down an octave onto D5, E5 or C5, and a small stepped punch (A3 -> E3). No sub: it can be heard often.
    const v = ctx.variant % 3;
    const note = [hz('D5'), hz('E5'), hz('C5')][v]!;
    const m = new Mix(ctx, 0.4);
    m.add(crack(ctx, { freq: [3400, 3000, 3800][v]!, decay: 0.016, q: 1.2, bits: 6, hold: 2, tune: note * 2, ring: 0.6 }), { gain: 0.6, pan: [0, -0.1, 0.1][v]!, send: 0.1 });
    m.add(knock(ctx, { from: note * 2, to: note, drop: 0.005, decay: 0.08, wave: 'square', cutoff: 4200 }), { gain: 0.3, send: 0.15 });
    m.add(punch(ctx, { notes: [hz('A3'), hz('E3')], step: 0.005, dur: 0.07 }), { gain: 0.3 });
    m.add(tick(ctx, { freq: 7500, dur: 0.003 }), { gain: 0.2 });
    return fadeEnd(ctx, squash(ctx, m.out({ space: TABLE }), { threshold: -10, ratio: 3 }), 0.28);
  },

  'hit.medium': (ctx) => {
    // A solid, punchy blow: a loud crushed crack, a bit-crushed pulse knock snapping down an octave onto A3 (or E3) and a driven square dyad A3 + E4
    // closing fast (the mid body small speakers keep), over a stepped punch (A3 E3 A2) and a lighter stepped sub drop onto A1.
    const v = ctx.variant % 2;
    const note = v ? hz('E3') : hz('A3');
    const m = new Mix(ctx, 0.6);
    m.add(punch(ctx, { notes: [hz('A2'), hz('E2'), hz('A1')], step: v ? 0.007 : 0.006, dur: 0.24 }), { gain: 0.3 });
    m.add(punch(ctx, { notes: [hz('A3'), hz('E3'), hz('A2')], step: 0.006, dur: 0.12 }), { gain: 0.3 });
    m.add(crack(ctx, { freq: 1900, decay: 0.05, q: 0.8, bits: 5, hold: 3 }), { gain: 0.7, send: 0.2 });
    m.add(crush(ctx, knock(ctx, { from: note * 2, to: note, drop: 0.008, decay: 0.14, wave: 'pulse', pw: 0.2, cutoff: 3200, drive: 1.5 }), 6, 2), { gain: 0.7, send: 0.18 });
    const dyad = drive(chordOsc(ctx, 'square', [hz('A3'), hz('E4')], 0.13), 2.2);
    m.add(shaped(ctx, lp(ctx, dyad, glide(2800, 700, 0.1), 0.9), [[0, 0], [0.003, 1], [0.04, 0.4], [0.13, 0]]), { gain: 0.5, send: 0.15 });
    m.add(mul(hp(ctx, noise(ctx, 0.012), 6000), perc(ctx, 0.0002, 0.01)), { gain: 0.25 });
    return fadeEnd(ctx, squash(ctx, m.out({ space: TABLE }), { threshold: -10, ratio: 4 }), 0.42);
  },

  'hit.heavy': (ctx) => {
    // A massive, crunching blow: a sub drop onto A1 (or D2), a mid punch, a wide crushed noise crunch closing from bright to dark, a driven saw chord
    // slamming down into place in quantized steps (D4 -> A3 -> D3 with its fifth, over D3 -> A2 -> D2: the weight stays audible on small speakers), a
    // low metallic clang and a scatter of crushed debris; the summed blow is soft-clipped.
    const v = ctx.variant % 2;
    const m = new Mix(ctx, 1.0);
    m.add(thump(ctx, { from: v ? 190 : 170, to: v ? hz('D2') : hz('A1'), drop: 0.06, dur: 0.45 }), { gain: 0.42 });
    m.add(thump(ctx, { from: 200, to: hz('D3'), drop: 0.02, dur: 0.14 }), { gain: 0.45 });
    for (const side of [-1, 1]) {
      let crunch = lp(ctx, noise(ctx, 0.48), glide(5000, 500, 0.3), 0.8);
      crunch = shaped(ctx, crunch, [[0, 0], [0.004, 1], [0.08, 0.55], [0.48, 0]]);
      crunch = crush(ctx, drive(crunch, 3), glide(6, 3, 0.35, 'lin'), glide(2, 8, 0.35, 'lin'));
      m.add(crunch, { gain: 0.4, pan: side * 0.45, send: 0.3 });
    }
    const root = hz('D2');
    const body = chordOsc(ctx, 'saw', [steps([root * 4, root * 3, root * 2], 0.018), steps([root * 6, root * 4, root * 3], 0.018), steps([root * 2, root * 1.5, root], 0.018)], 0.5);
    m.add(shaped(ctx, lp(ctx, drive(body, 3), glide(3000, 220, 0.2), 0.8), [[0, 0], [0.003, 1], [0.1, 0.4], [0.36, 0]]), { gain: 0.8, send: 0.08 });
    m.add(crush(ctx, clang(ctx, { freq: hz('D3'), dur: 0.3, index: 5 }), 6, 2), { gain: 0.22, send: 0.15 });
    debris(ctx, m, { at: 0.015, dur: 0.32, count: 14, from: 1800, to: 350, gain: 0.16, send: 0.35 });
    const st = squash(ctx, m.out({ space: TABLE }), { threshold: -14, ratio: 6, attack: 0.0008, release: 0.12 });
    // A soft clip on the summed blow: the first peaks saturate into the crunch instead of capping the loudness.
    return fadeEnd(ctx, saturate(st, 2.2), 0.8);
  },

  'hit.player': (ctx) => {
    // The player's own system takes the blow: a heavy punch onto D2, a driven saw knock onto D3, the disc ringing like struck metal and shuddering,
    // the impact glitching (two crushed digital repeats) and a crushed alarm stuttering at 13 Hz on a minor second (A4 + Bb4, or E5 + F5).
    const v = ctx.variant % 2;
    const m = new Mix(ctx, 0.85);
    m.add(thump(ctx, { from: v ? 190 : 170, to: hz('D2'), drop: 0.05, dur: 0.4 }), { gain: 0.4 });
    const hitCore = (bits: number, hold: number): Float32Array => {
      const c = crack(ctx, { freq: 2000, decay: 0.045, q: 0.8, bits, hold });
      const k = knock(ctx, { from: hz('D3') * 2, to: hz('D3'), drop: 0.008, decay: 0.18, wave: 'saw', cutoff: 2400, drive: 2.5 });
      const out = new Float32Array(Math.max(c.length, k.length));
      for (let i = 0; i < out.length; i++) out[i] = (c[i] ?? 0) * 0.6 + (k[i] ?? 0) * 0.6;
      return out;
    };
    m.add(hitCore(5, 3), { send: 0.2 });
    m.add(crush(ctx, hitCore(4, 4), 4, 4), { at: 0.055, gain: 0.45, pan: -0.25, send: 0.2 });
    m.add(crush(ctx, hitCore(3, 6), 3, 6), { at: 0.1, gain: 0.3, pan: 0.25, send: 0.2 });
    const disc = modes(ctx, hz('D4'), 0.6, [1, 1.5, 2, 2.76, 4.1], [0.6, 0.4, 0.35, 0.2, 0.12], [1, 0.5, 0.45, 0.3, 0.15]);
    m.add(ring(ctx, disc, glide(11, 5, 0.5), 0.6), { gain: 0.4, send: 0.35 });
    const [a, b] = v ? [hz('E5'), hz('F5')] : [hz('A4'), hz('Bb4')];
    const AD = 0.32;
    const al = chordOsc(ctx, 'square', [a, b], AD);
    for (let i = 0; i < al.length; i++) {
      const ph = ((i / ctx.sr) * 13) % 1;
      al[i] = al[i]! * (ph < 0.5 ? Math.min(1, ph * 200) : 0.04);
    }
    const alarm = crush(ctx, shaped(ctx, lp(ctx, al, 3000, 0.7), [[0, 0], [0.003, 1], [AD * 0.6, 0.55], [AD, 0]]), 6, 2);
    m.add(alarm, { at: 0.035, gain: 0.55, send: 0.3 });
    return fadeEnd(ctx, squash(ctx, m.out({ space: TABLE, echo: { time: 0.11, feedback: 0.25, mix: 0.25, pingpong: true, damp: 3500 } }), { threshold: -11, ratio: 4 }), 0.7);
  },

  'life.gain': (ctx) => {
    // Healing light on the grid: a glossy unison-saw D major pad (D4 F#4 A4) opening from 800 to 2600 Hz, FM bell blips rising D5 F#5 A5 D6 and
    // crystal glitter of the D major scale thickening as it rises, with a ping-pong echo.
    const m = new Mix(ctx, 1.0);
    const PD = 0.8;
    const pad = new Mix(ctx, PD);
    for (const f of [hz('D4'), hz('F#4'), hz('A4')]) pad.addStereo(unison(ctx, 'saw', f, PD, { voices: 3, cents: 10, width: 0.6 }), { gain: 0.45 });
    const ps = pad.out();
    const pe = env(ctx, [[0, 0], [0.16, 1], [0.45, 0.6], [PD, 0]], PD, 'lin');
    const lpc = glide(800, 2600, 0.35);
    m.addStereo({ l: mul(lp(ctx, ps.l, lpc, 1), pe), r: mul(lp(ctx, ps.r, lpc, 1), pe) }, { gain: 0.3, send: 0.35 });
    [hz('D5'), hz('F#5'), hz('A5'), hz('D6')].forEach((f, k) => {
      const bell = fm(ctx, f, 0.24, { ratio: 2, index: glide(1.2, 0.3, 0.12, 'lin') });
      m.add(mul(bell, perc(ctx, 0.003, 0.22, 0.24)), { at: 0.02 + k * 0.075, gain: 0.26, pan: -0.3 + k * 0.2, send: 0.4 });
    });
    m.addStereo(shimmer(ctx, { dur: 0.6, density: 34, lo: 1400, hi: 3800, grain: 0.14, scale: D_MAJOR, fade: 'in' }), { at: 0.08, gain: 0.45, send: 0.5 });
    return fadeEnd(ctx, m.out({ space: TABLE, echo: { time: 0.12, feedback: 0.3, mix: 0.3, pingpong: true, damp: 5000 } }), 0.85);
  },

  'life.loss': (ctx) => {
    // Energy drained away: a dark, ring-modulated burst on the disc with a crushed FM zap falling from it, then a D minor chord (D4 F4 A4) slowing
    // down like a power drain to an octave below, closing, its throb slowing and its resolution crumbling from 10 to 5 bits as it empties.
    const m = new Mix(ctx, 0.9);
    m.add(thump(ctx, { from: 130, to: hz('D2'), drop: 0.04, dur: 0.2 }), { gain: 0.3 });
    const burst = ring(ctx, lp(ctx, noise(ctx, 0.12, 'pink'), 2400, 0.8), hz('D3'), 0.8);
    m.add(shaped(ctx, burst, [[0, 0], [0.003, 1], [0.12, 0]]), { gain: 0.4, send: 0.3 });
    m.add(crush(ctx, zap(ctx, { from: hz('A5'), to: hz('D4'), dur: 0.16, index: 2.5 }), 7, 2), { gain: 0.28, send: 0.3 });
    const CD = 0.8;
    const chord = chordOsc(ctx, 'saw', [hz('D4'), hz('F4') * 1.001, hz('A4') * 0.999], 0.75);
    let drain = varispeed(ctx, chord, glide(1, 0.5, 0.42), CD);
    drain = lp(ctx, drain, glide(3200, 300, 0.65), 1.3);
    throb(ctx, drain, glide(22, 5, 0.65), 0.5);
    drain = shaped(ctx, drain, [[0, 0], [0.03, 1], [0.3, 0.6], [CD, 0]]);
    drain = crush(ctx, drain, (t) => 10 - 5 * clamp((t - 0.3) / 0.4, 0, 1), 1);
    m.add(drain, { at: 0.02, gain: 0.55, send: 0.3 });
    const suck = bp(ctx, noise(ctx, 0.55, 'pink'), glide(2600, 250, 0.5), 2.2);
    m.add(shaped(ctx, suck, [[0, 0], [0.05, 1], [0.55, 0]]), { at: 0.02, gain: 0.25, send: 0.3 });
    return fadeEnd(ctx, m.out({ space: TABLE }), 0.78);
  },

  'counter.up': (ctx) => {
    // A level up, counted in discrete increments: five narrow-pulse blips climbing like a counter ticking up (D5 E5 F5 A5) and landing on D6, each
    // with its own tick, and a small crystal glint on A6 over the landing.
    const m = new Mix(ctx, 0.42);
    const notes = [hz('D5'), hz('E5'), hz('F5'), hz('A5'), hz('D6')];
    const S = 0.032;
    notes.forEach((f, k) => {
      const at = k * S;
      const last = k === notes.length - 1;
      m.add(tick(ctx, { freq: 5200, dur: 0.003 }), { at, gain: 0.3 });
      m.add(blip(ctx, { freq: f, dur: last ? 0.1 : 0.03, wave: 'pulse', pw: 0.25, decay: last ? 0.09 : 0.026, cutoff: 4800 }), { at, gain: 0.3, pan: -0.15 + k * 0.08, send: 0.2 });
      m.add(blip(ctx, { freq: f / 2, dur: last ? 0.08 : 0.026, wave: 'square', decay: last ? 0.07 : 0.022, cutoff: 2000 }), { at, gain: 0.15 });
    });
    m.add(crystal(ctx, { freq: hz('A6'), dur: 0.22, bright: 0.4 }), { at: 4 * S, gain: 0.12, pan: 0.2, send: 0.4 });
    return fadeEnd(ctx, m.out({ space: TABLE, echo: { time: 0.07, feedback: 0.25, mix: 0.2, pingpong: true, damp: 4500 } }), 0.36);
  },

  'counter.down': (ctx) => {
    // A downgrade, the mirror of counter.up: crushed square blips counting down the scale (A5 F5 E5), dropping a tritone onto Bb4 and then breaking a
    // semitone lower to A4, crushed harder; dull ticks, no glint: something was taken away.
    const m = new Mix(ctx, 0.42);
    const S = 0.036;
    [hz('A5'), hz('F5'), hz('E5')].forEach((f, k) => {
      const at = k * S;
      m.add(tick(ctx, { freq: 2600, dur: 0.003 }), { at, gain: 0.25 });
      m.add(crush(ctx, blip(ctx, { freq: f, dur: 0.034, wave: 'square', decay: 0.03, cutoff: 3400 }), 6, 2), { at, gain: 0.3, pan: 0.15 - k * 0.1, send: 0.2 });
      m.add(blip(ctx, { freq: f / 2, dur: 0.03, wave: 'square', decay: 0.026, cutoff: 1500 }), { at, gain: 0.15 });
    });
    const at = 3 * S;
    const fall = steps([hz('Bb4'), hz('A4')], 0.03);
    m.add(tick(ctx, { freq: 2600, dur: 0.003 }), { at, gain: 0.25 });
    const lastBlip = shaped(ctx, lp(ctx, osc(ctx, 'square', fall, 0.11), 3000, 0.7), [[0, 0], [0.001, 1], [0.03, 0.55], [0.11, 0]]);
    m.add(crush(ctx, lastBlip, glide(6, 4, 0.04, 'lin'), glide(2, 4, 0.06, 'lin')), { at, gain: 0.3, pan: -0.15, send: 0.2 });
    m.add(shaped(ctx, lp(ctx, osc(ctx, 'square', (t) => fall(t) / 2, 0.09), 1500, 0.7), [[0, 0], [0.001, 1], [0.09, 0]]), { at, gain: 0.15 });
    return fadeEnd(ctx, m.out({ space: TABLE, echo: { time: 0.07, feedback: 0.2, mix: 0.15, pingpong: true, damp: 3500 } }), 0.34);
  },

  'stat.up': (ctx) => {
    // A quick smooth surge: unison saws sweeping up an octave (D4 -> D5) as the filter opens, peaking at 0.09 s and landing on D5 with a soft A4 under
    // it, over a sub-octave sine and a rising breath of air.
    const m = new Mix(ctx, 0.42);
    const f = glide(hz('D4'), hz('D5'), 0.08);
    m.addStereo(sweepVoice(ctx, { freq: f, dur: 0.36, cutoff: glide(500, 4500, 0.09), q: 1.4, points: [[0, 0], [0.012, 0.5], [0.09, 1], [0.36, 0]] }), { gain: 0.4, send: 0.2 });
    m.add(shaped(ctx, osc(ctx, 'triangle', hz('A4'), 0.27), [[0, 0], [0.02, 1], [0.27, 0]]), { at: 0.08, gain: 0.14, send: 0.25 });
    m.add(shaped(ctx, osc(ctx, 'sine', (t) => f(t) / 2, 0.34), [[0, 0], [0.012, 0.7], [0.09, 1], [0.34, 0]]), { gain: 0.3 });
    m.add(shaped(ctx, bp(ctx, noise(ctx, 0.16, 'pink'), glide(700, 3500, 0.1), 2), [[0, 0], [0.085, 1], [0.16, 0]], 'lin'), { gain: 0.12, send: 0.2 });
    return fadeEnd(ctx, m.out({ space: TABLE, echo: { time: 0.08, feedback: 0.2, mix: 0.2, pingpong: true, damp: 4000 } }), 0.36);
  },

  'stat.down': (ctx) => {
    // A power sag, digital: unison saws sliding down a tritone (E5 -> Bb4, unresolved) as the filter closes, the pitch jittering in sample-and-hold
    // steps (14 Hz, growing to +-30 cents) and the resolution crumbling from 10 to 6 bits; a falling sine under it.
    const m = new Mix(ctx, 0.42);
    const [e5, bb4] = [hz('E5'), hz('Bb4')];
    const jitter: number[] = [];
    for (let k = 0; k < 8; k++) jitter.push(ctx.rand() * 2 - 1);
    const f = (t: number): number => {
      const x = clamp(t / 0.2, 0, 1);
      const step = Math.min(jitter.length - 1, Math.floor(t * 14));
      return e5 * (bb4 / e5) ** (x * x * (3 - 2 * x)) * 2 ** (((6 + 24 * clamp(t / 0.3, 0, 1)) * jitter[step]!) / 1200);
    };
    const sv = sweepVoice(ctx, { freq: f, dur: 0.38, cutoff: glide(3800, 500, 0.3), q: 1.2, points: [[0, 0], [0.008, 1], [0.15, 0.85], [0.38, 0]] });
    const bits = (t: number): number => 10 - 4 * clamp(t / 0.3, 0, 1);
    m.addStereo({ l: crush(ctx, sv.l, bits, 1), r: crush(ctx, sv.r, bits, 1) }, { gain: 0.4, send: 0.08 });
    m.add(shaped(ctx, osc(ctx, 'sine', (t) => f(t) / 2, 0.36), [[0, 0], [0.008, 1], [0.36, 0]]), { gain: 0.3 });
    return fadeEnd(ctx, m.out({ space: TABLE }), 0.34);
  },

  'damage.prevented': (ctx) => {
    // A shield deflects the blow: a dull impact meets a bright metallic clink over a 30 ms square D4 + A4 field flash (the shield is heard) and a
    // crystal ring, then the blow ricochets away (a whistling glide falling from A6 to D5 and flying off to the side), with a ping-pong echo.
    const m = new Mix(ctx, 0.65);
    m.add(thump(ctx, { from: 460, to: hz('D3'), drop: 0.02, dur: 0.1 }), { gain: 0.4 });
    const flash = chordOsc(ctx, 'square', [hz('D4'), hz('A4')], 0.035);
    m.add(shaped(ctx, lp(ctx, flash, glide(4000, 900, 0.03), 1.5), [[0, 0], [0.001, 1], [0.012, 0.6], [0.035, 0]]), { gain: 0.14, send: 0.3 });
    const clink = fm(ctx, hz('D6'), 0.03, { ratio: 1.414, index: glide(3, 0.5, 0.02, 'lin') });
    m.add(mul(clink, perc(ctx, 0.0005, 0.025, 0.03)), { gain: 0.25, send: 0.3 });
    m.add(crystal(ctx, { freq: hz('D6'), dur: 0.3, bright: 0.7 }), { gain: 0.22, pan: 0.1, send: 0.35 });
    m.add(crystal(ctx, { freq: hz('A5'), dur: 0.45, bright: 0.5 }), { gain: 0.18, pan: -0.15, send: 0.4 });
    const RD = 0.3;
    const ric = fm(ctx, glide(hz('A6'), hz('D5'), RD * 0.8), RD, { ratio: 2, index: 0.6 });
    addMoving(ctx, m, shaped(ctx, ric, [[0, 0], [0.008, 1], [0.12, 0.5], [RD, 0]]), (t) => 0.7 * (t / RD), { at: 0.015, gain: 0.22, send: 0.45 });
    return fadeEnd(ctx, m.out({ space: TABLE, echo: { time: 0.09, feedback: 0.3, mix: 0.3, pingpong: true, damp: 5000 } }), 0.55);
  },
};
