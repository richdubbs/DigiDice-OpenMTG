/**
 * Mana, resolution, abilities, bolts, counters and copies (docs/design/sound.md "Spells"): the five colours of mana and the colourless one,
 * a spell resolving and sending its effect, abilities activating and triggering.
 *
 * The six manas are one family of short energy pings (immediate attack, a 60-90 ms body, a soft tail in the small `ui` room) that stay clear when
 * several are staggered 45 ms apart: each colour has its own register and timbre, all on notes of D minor so a mixed run forms a chord.
 */
import type { Recipe, SoundId } from '../catalog';
import {
  bp,
  crush,
  drive,
  env,
  eq,
  flange,
  fm,
  glide,
  hp,
  lp,
  Mix,
  mul,
  noise,
  osc,
  perc,
  ring,
  steps,
  type Ctx,
  type Stereo,
  varispeed,
  vibrato,
} from '../dsp';
import { blip, crystal, hz, scaleNoteBetween, shimmer, SPACE, thump, tick, unison, whoosh } from '../palette';

// ---- helpers ----------------------------------------------------------------------------------------------------------------------

/** Fades the last `secs` of a mix (a room tail cut by the sound's length never ends abruptly). In place. */
function fadeEnd(ctx: Ctx, st: Stereo, secs: number): Stereo {
  const n = Math.min(st.l.length, Math.round(secs * ctx.sr));
  for (let i = 0; i < n; i++) {
    const g = (i / n) ** 2;
    const j = st.l.length - 1 - i;
    st.l[j] = st.l[j]! * g;
    st.r[j] = st.r[j]! * g;
  }
  return st;
}

/** Sums `b` (times `g`) into `a`, in place. */
function add(a: Float32Array, b: Float32Array, g = 1): Float32Array {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) a[i] = a[i]! + b[i]! * g;
  return a;
}

/** A two-operator FM bell under a percussive envelope (index falling from `index` to `indexEnd` as it rings). */
function bell(ctx: Ctx, freq: number, dur: number, o: { ratio?: number; index?: number; indexEnd?: number; decay?: number; attack?: number } = {}): Float32Array {
  const s = fm(ctx, freq, dur, { ratio: o.ratio ?? 2, index: glide(o.index ?? 2, o.indexEnd ?? 0.2, (o.decay ?? dur) * 0.7, 'lin') });
  return mul(s, perc(ctx, o.attack ?? 0.001, o.decay ?? dur, dur));
}

/**
 * Gates a signal into `count` crisp pulses at `rate` per second (flat tops and short steep gaps: pulses of light). The gate ends closed, in the
 * gap after the last pulse, and the rest fades back in over `fade` seconds, so the tail never reads as another pulse. In place.
 */
function gatePulses(ctx: Ctx, x: Float32Array, rate: number, count: number, fade = 0.03): Float32Array {
  const end = Math.min(x.length, Math.round(((count - 0.5) / rate) * ctx.sr));
  const fadeN = Math.max(1, Math.round(fade * ctx.sr));
  for (let i = 0; i < Math.min(x.length, end + fadeN); i++) {
    const g = i < end ? Math.min(1, Math.max(0, 0.5 + 1.6 * Math.cos(2 * Math.PI * rate * (i / ctx.sr)))) : (i - end) / fadeN;
    x[i] = x[i]! * g;
  }
  return x;
}

/** A pitch held on `values` in turn, `step` seconds each, cycling (a sample-and-hold wobble), after a glide from `from` into the first one. */
function holdCycle(values: readonly number[], step: number, from: number, into: number): (t: number) => number {
  return (t) => (t < into ? from * (values[0]! / from) ** (t / into) : values[Math.floor((t - into) / step) % values.length]!);
}

/**
 * A Karplus-Strong pluck tuned exactly (a fractional, interpolated delay line), so a G mana run stays in tune with the W/U/C pings at any sample
 * rate. Excitation: a triangle roughened by low-passed noise.
 */
function tunedPluck(ctx: Ctx, freq: number, dur: number, o: { decay: number; bright: number }): Float32Array {
  const n = Math.round(dur * ctx.sr);
  const out = new Float32Array(n);
  const period = ctx.sr / freq;
  // The two-point average in the loop adds half a sample.
  const delay = period - 0.5;
  const size = Math.ceil(delay) + 4;
  const buf = new Float32Array(size);
  const exN = Math.round(period);
  const ex = new Float32Array(exN);
  let prev = 0;
  let mean = 0;
  for (let i = 0; i < exN; i++) {
    prev += o.bright * (ctx.rand() * 2 - 1 - prev);
    ex[i] = (1 - 4 * Math.abs(i / exN - 0.5)) * (1 - 0.5 * o.bright) + prev * o.bright * 0.6;
    mean += ex[i]! / exN;
  }
  const loss = 0.001 ** (1 / Math.max(1, o.decay * freq));
  let w = 0;
  let last = 0;
  for (let i = 0; i < n; i++) {
    const pos = w - delay + size;
    const i0 = Math.floor(pos);
    const fr = pos - i0;
    const y = buf[i0 % size]! * (1 - fr) + buf[(i0 + 1) % size]! * fr;
    buf[w] = (y + last) * 0.5 * loss + (i < exN ? ex[i]! - mean : 0);
    last = y;
    out[i] = y;
    w = (w + 1) % size;
  }
  return out;
}

// ---- mana ---------------------------------------------------------------------------------------------------------------------------

const MANA_DUR = 0.4;

/** The shared shell of every mana ping: the orb's tiny spark at the start, the core, the `ui` room (optionally a faint ping-pong), a soft end. */
function manaOut(ctx: Ctx, m: Mix, sparkHz: number, echoFeedback = 0): Stereo {
  m.add(tick(ctx, { freq: sparkHz, dur: 0.0025, q: 1.4 }), { gain: 0.22 });
  const st = m.out({ space: SPACE.ui, ...(echoFeedback ? { echo: { time: 0.062, feedback: echoFeedback, mix: 0.2, pingpong: true, damp: 5000 } } : {}) });
  return fadeEnd(ctx, st, 0.08);
}

const MANA: Record<'W' | 'U' | 'B' | 'R' | 'G' | 'C', Recipe> = {
  // White: the brightest, a high crystal bell (A6 / D7) with a warm octave under it and its signature sparkle: two glints above it (a fifth,
  // then an octave), thrown right and left, and a faint ping-pong of light.
  W: (ctx) => {
    const f = ctx.variant ? hz('D7') : hz('A6');
    const m = new Mix(ctx, MANA_DUR);
    m.add(crystal(ctx, { freq: f, dur: 0.3, bright: 0.75 }), { gain: 0.42, send: 0.4 });
    m.add(blip(ctx, { freq: f / 2, dur: 0.16, wave: 'sine', decay: 0.13 }), { gain: 0.38, send: 0.2 });
    m.add(crystal(ctx, { freq: f * 1.5, dur: 0.1, bright: 0.3 }), { at: 0.014, gain: 0.18, pan: 0.35, send: 0.5 });
    m.add(crystal(ctx, { freq: f * 2, dur: 0.08, bright: 0.2 }), { at: 0.035, gain: 0.08, pan: -0.35, send: 0.5 });
    return manaOut(ctx, m, 7500, 0.12);
  },
  // Blue: a glassy FM strike (A5 / F5) that drips up into its note (from a fourth below in 10 ms), then wobbles in sample-and-hold steps
  // (+-15 cents every 30 ms), with a smoothly wavering chorus twin: water rendered on the grid.
  U: (ctx) => {
    const f = ctx.variant ? hz('F5') : hz('A5');
    const m = new Mix(ctx, MANA_DUR);
    const pitch = holdCycle([f, f * 1.009, f, f * 0.991], 0.03, f * 0.75, 0.01);
    const core = fm(ctx, pitch, 0.32, { ratio: 2, index: glide(1.8, 0.1, 0.18, 'lin') });
    mul(core, perc(ctx, 0.0015, 0.26, 0.32));
    m.add(core, { gain: 0.5, pan: -0.12, send: 0.3 });
    const twin = osc(ctx, 'sine', vibrato(glide(f * 0.75 * 1.004, f * 1.004, 0.01), 7.1, 8), 0.3);
    mul(twin, perc(ctx, 0.002, 0.22, 0.3));
    m.add(twin, { gain: 0.3, pan: 0.25, send: 0.35 });
    return manaOut(ctx, m, 6200);
  },
  // Black: dark low FM on A3 / F3 (harmonic, dropping a quantized octave into place, low-passed, its tail turning to grit) with a faint
  // minor-second shadow (Bb / E) beating against it.
  B: (ctx) => {
    const f = ctx.variant ? hz('F3') : hz('A3');
    const edge = ctx.variant ? hz('E3') : hz('Bb3');
    const m = new Mix(ctx, MANA_DUR);
    let core = fm(ctx, steps([f * 2, f], 0.018), 0.34, { ratio: 1, index: glide(3, 0.6, 0.2, 'lin'), feedback: 0.2 });
    core = hp(ctx, lp(ctx, core, glide(1500, 600, 0.16), 1.1), 110);
    mul(core, perc(ctx, 0.002, 0.28, 0.34));
    core = crush(ctx, core, (t) => (t < 0.15 ? 16 : 11), (t) => (t < 0.15 ? 1 : 2));
    m.add(core, { gain: 0.6, send: 0.25 });
    m.add(blip(ctx, { freq: edge, dur: 0.26, wave: 'sine', decay: 0.22 }), { gain: 0.07, pan: 0.2, send: 0.2 });
    m.add(blip(ctx, { freq: f, dur: 0.28, wave: 'sine', decay: 0.24 }), { gain: 0.16, send: 0.15 });
    m.add(blip(ctx, { freq: f * 2, dur: 0.14, wave: 'triangle', decay: 0.1, cutoff: 1800 }), { gain: 0.1, send: 0.15 });
    return manaOut(ctx, m, 2600);
  },
  // Red: a hot, buzzy narrow pulse (D5 / C5) that snaps down a fifth into its note and rounds out (width 0.15 -> 0.4) through a resonant
  // filter closing fast, driven, with two small sparks.
  R: (ctx) => {
    const f = ctx.variant ? hz('C5') : hz('D5');
    const m = new Mix(ctx, MANA_DUR);
    let core = osc(ctx, 'pulse', steps([f * 1.5, f], 0.009), 0.22, { pw: glide(0.15, 0.4, 0.18, 'lin') });
    core = lp(ctx, core, glide(5200, 1100, 0.09), 2.2);
    core = lp(ctx, hp(ctx, drive(core, 2.2), 160), 5000, 0.6);
    mul(core, perc(ctx, 0.001, 0.15, 0.22));
    m.add(core, { gain: 0.42, send: 0.22 });
    m.add(blip(ctx, { freq: f / 2, dur: 0.12, wave: 'sine', decay: 0.09 }), { gain: 0.25 });
    for (let k = 0; k < 2; k++) {
      m.add(tick(ctx, { freq: 4000 + ctx.rand() * 1500, dur: 0.002, q: 3 }), { at: 0.02 + ctx.rand() * 0.06, gain: 0.12, pan: ctx.rand() * 1.2 - 0.6, send: 0.3 });
    }
    return manaOut(ctx, m, 5000);
  },
  // Green: led by a resonant filter formant (q 6.5) that blooms open in 40 ms and slowly closes ("bwow"), excited by a bright tuned pluck
  // (G4 / A4) that gives it harmonics to sweep, its first 50 ms lightly crushed, over a faint sine core: a growing note made of light.
  G: (ctx) => {
    const f = ctx.variant ? hz('A4') : hz('G4');
    const m = new Mix(ctx, MANA_DUR);
    let s = tunedPluck(ctx, f, 0.34, { decay: 0.3, bright: 0.6 });
    const wah = env(ctx, [[0, 900], [0.04, 3800], [0.3, 1300]], 0.34, 'exp');
    s = hp(ctx, lp(ctx, s, (t) => wah[Math.min(wah.length - 1, Math.round(t * ctx.sr))]!, 6.5), 120);
    s = crush(ctx, s, (t) => (t < 0.05 ? 12 : 16), (t) => (t < 0.05 ? 2 : 1));
    mul(s, perc(ctx, 0.001, 0.3, 0.34));
    m.add(s, { gain: 0.6, send: 0.25 });
    m.add(blip(ctx, { freq: f, dur: 0.22, wave: 'sine', decay: 0.18 }), { gain: 0.06, send: 0.15 });
    m.add(blip(ctx, { freq: f * 2, dur: 0.12, wave: 'sine', decay: 0.09 }), { gain: 0.08, pan: -0.2, send: 0.2 });
    return manaOut(ctx, m, 4200);
  },
  // Colourless: grey metal, not a bell: an inharmonic FM strike on D6 / C6 (ratio 5:3, so its sidebands land on G; index 1.1 -> 0 in 40 ms,
  // so it rings out clean), struck twice 30 ms apart like a machine's double tap, over a faint square body.
  C: (ctx) => {
    const f = ctx.variant ? hz('C6') : hz('D6');
    const m = new Mix(ctx, MANA_DUR);
    const hit = (): Float32Array => mul(fm(ctx, f, 0.2, { ratio: 5 / 3, index: glide(1.1, 0.05, 0.04, 'lin') }), perc(ctx, 0.001, 0.12, 0.2));
    m.add(hit(), { gain: 0.45, pan: -0.08, send: 0.25 });
    m.add(hit(), { at: 0.03, gain: 0.225, pan: 0.08, send: 0.25 });
    m.add(blip(ctx, { freq: f / 2, dur: 0.06, wave: 'square', decay: 0.04, cutoff: 2400 }), { gain: 0.06 });
    return manaOut(ctx, m, 6800);
  },
};

// ---- spells and abilities ---------------------------------------------------------------------------------------------------------

export const MAGIC_SOUNDS: Partial<Record<SoundId, Recipe>> = {
  'mana.W': MANA.W,
  'mana.U': MANA.U,
  'mana.B': MANA.B,
  'mana.R': MANA.R,
  'mana.G': MANA.G,
  'mana.C': MANA.C,

  'spell.resolve': (ctx) => {
    // Executing: from the first moment a filtered saw D4+A4 swells linearly (LP 400 -> 3000 Hz) under a rising whoosh while a "processing" tick
    // train on A6 accelerates (30 -> 12 ms apart); at 0.19 s it flares: an open D stab whose filter pops open, a crystal ping and a push of air,
    // bouncing across the grid.
    const dur = 0.55;
    const hit = 0.19;
    const m = new Mix(ctx, dur);
    const sw = hit + 0.005;
    let swell = add(osc(ctx, 'saw', hz('D4'), sw), osc(ctx, 'saw', hz('A4') * 1.003, sw, { phase: 0.3 }), 0.8);
    swell = lp(ctx, swell, glide(400, 3000, hit), 1.3);
    mul(swell, env(ctx, [[0, 0], [0.004, 0.08], [hit, 0.55], [sw, 0]], sw, 'lin'));
    m.add(swell, { gain: 0.24, send: 0.3 });
    m.add(whoosh(ctx, { dur: hit + 0.01, from: 700, to: 6000, q: 2, peak: 0.95 }), { gain: 0.32, send: 0.2 });
    let at = 0.035;
    for (let k = 0; k < 8; k++) {
      m.add(blip(ctx, { freq: hz('A6'), dur: 0.008, wave: 'square', decay: 0.006, cutoff: 5000 }), { at, gain: 0.06 + (0.08 * k) / 7, pan: k % 2 ? 0.3 : -0.3, send: 0.2 });
      at += 0.03 - (0.018 * k) / 6;
    }
    const fl = new Mix(ctx, 0.34);
    for (const f of [hz('D4'), hz('A4'), hz('D5')]) fl.addStereo(unison(ctx, 'saw', f, 0.34, { voices: 3, cents: 9 }), { gain: 0.5 });
    const st = fl.out();
    const cut = glide(5500, 700, 0.26);
    const shape = env(ctx, [[0, 0], [0.003, 1], [0.08, 0.5], [0.34, 0]], 0.34, 'exp');
    m.addStereo({ l: mul(lp(ctx, st.l, cut, 1.2), shape), r: mul(lp(ctx, st.r, cut, 1.2), shape) }, { at: hit, gain: 0.32, send: 0.3 });
    m.add(crystal(ctx, { freq: hz('D6'), dur: 0.32, bright: 0.6 }), { at: hit, gain: 0.25, pan: 0.15, send: 0.5 });
    m.add(mul(bp(ctx, noise(ctx, 0.12, 'pink'), glide(4000, 1200, 0.1), 0.9), perc(ctx, 0.002, 0.1, 0.12)), { at: hit, gain: 0.35, send: 0.3 });
    m.add(blip(ctx, { freq: hz('D3'), dur: 0.16, wave: 'sine', decay: 0.13 }), { at: hit, gain: 0.14 });
    const out = m.out({ space: SPACE.table, echo: { time: 0.09, feedback: 0.3, mix: 0.3, pingpong: true, damp: 4500 } });
    return fadeEnd(ctx, out, 0.12);
  },

  'spell.bolt': (ctx) => {
    // In flight: a quick launch "pew", then a beam of light rushing toward its target: a band-passed rush and a flanged saw rising two octaves
    // (A3 -> A5; variant 1 C4 -> C6, panned the other way, a different pew and sizzle), its filter lifting in two steps, swelling until 0.3 s and
    // clearing out by 0.37 s for the impact.
    const v = ctx.variant % 2;
    const dur = 0.55;
    const arrive = 0.3;
    const lo = v ? hz('C4') : hz('A3');
    const pan = v ? 0.2 : -0.2;
    const m = new Mix(ctx, dur);
    const pew = v ? 3100 : 2600;
    m.add(mul(fm(ctx, glide(pew, pew / 2, 0.03), 0.04, { ratio: 2, index: 2 }), perc(ctx, 0.001, 0.035, 0.04)), { gain: 0.22, pan, send: 0.15 });
    const beamDur = arrive + 0.07;
    const swell = env(ctx, [[0, 0.3], [0.04, 0.4], [arrive, 1.6], [beamDur, 0]], beamDur, 'exp');
    let beam = add(osc(ctx, 'saw', glide(lo, lo * 4, arrive), beamDur), osc(ctx, 'saw', glide(lo * 1.006, lo * 4 * 1.006, arrive), beamDur, { phase: 0.4 }));
    const sweep = glide(700, 3000, arrive);
    beam = lp(ctx, beam, (t) => sweep(t) * (t < 0.15 ? 1 : t < 0.24 ? 1.35 : 1.7), 1.3);
    beam = flange(ctx, beam, { rate: 5, depth: 0.003, base: 0.0015, feedback: 0.45, mix: 0.5 });
    m.add(mul(beam, swell), { gain: 0.2, pan, send: 0.2 });
    m.add(whoosh(ctx, { dur: beamDur, from: 600, to: 5200, q: 2.4, peak: arrive / beamDur, color: 'pink' }), { gain: 0.4, pan: pan * 0.5, send: 0.2 });
    const sizzle = crush(ctx, fm(ctx, glide(1200, 2400, arrive), beamDur, { ratio: v ? 2.51 : 3.01, index: 1.4 }), 10, 3);
    m.add(mul(hp(ctx, sizzle, 1500), env(ctx, [[0, 0], [arrive, 1], [beamDur, 0]], beamDur, 'exp')), { gain: 0.07, pan: -pan, send: 0.25 });
    const out = m.out({ space: SPACE.ui });
    return fadeEnd(ctx, out, 0.1);
  },

  'spell.touch': (ctx) => {
    // Effect applied, "data written": a soft contact, at once a crushed data-write chirp (six square blips racing up D6 F6 A6 C7 D7 A7, 10 ms
    // apart) and a glow that is there from the first moment: a D minor triad (F4 A4 D5) of triangles whose filter breathes open and closed.
    const dur = 0.6;
    const m = new Mix(ctx, dur);
    m.add(tick(ctx, { freq: 4500, dur: 0.003 }), { gain: 0.3 });
    m.add(blip(ctx, { freq: hz('D5'), dur: 0.05, wave: 'sine', decay: 0.04 }), { gain: 0.3 });
    const chirp = new Float32Array(Math.round(0.08 * ctx.sr));
    [hz('D6'), hz('F6'), hz('A6'), hz('C7'), hz('D7'), hz('A7')].forEach((f, k) => {
      add(chirp.subarray(Math.round((0.006 + k * 0.01) * ctx.sr)), blip(ctx, { freq: f, dur: 0.012, wave: 'square', decay: 0.01, cutoff: 5000 }), 1 - 0.08 * k);
    });
    m.add(crush(ctx, chirp, 8, 1), { gain: 0.24, send: 0.25 });
    const glowDur = 0.42;
    const glow = new Mix(ctx, glowDur);
    for (const f of [hz('F4'), hz('A4'), hz('D5')]) glow.addStereo(unison(ctx, 'triangle', f, glowDur, { voices: 3, cents: 8, width: 0.6 }), { gain: 0.4 });
    const g = glow.out();
    const cut = (t: number): number => 700 + 1700 * Math.sin(Math.PI * Math.min(1, t / 0.3)) ** 2;
    const shape = env(ctx, [[0, 0.15], [0.025, 1], [0.16, 0.7], [glowDur, 0]], glowDur, 'exp');
    m.addStereo({ l: mul(lp(ctx, g.l, cut, 1.4), shape), r: mul(lp(ctx, g.r, cut, 1.4), shape) }, { gain: 0.42, send: 0.3 });
    m.add(crystal(ctx, { freq: hz('A6'), dur: 0.25, bright: 0.4 }), { at: 0.07, gain: 0.08, pan: 0.3, send: 0.6 });
    const out = m.out({ space: SPACE.table });
    return fadeEnd(ctx, out, 0.12);
  },

  'spell.countered': (ctx) => {
    // Denied: the spell's bright D-A chord jams (a buffer-repeat glitch: the same 28 ms slice stuttering four times, each a step lower in key
    // and more crushed), then it breaks at 0.12 s: a crack and a firm hit, a ring-modulated E-Bb tritone clamp collapsing downward, and a short
    // scatter of glass shards in key, crushed into grit and kept soft above 3.5 kHz.
    const dur = 1.0;
    const brk = 0.12;
    const m = new Mix(ctx, dur);
    // The jolt.
    const slice = 0.028;
    const chordSrc = add(add(osc(ctx, 'saw', hz('D5'), 0.06), osc(ctx, 'saw', hz('A5'), 0.06, { phase: 0.5 }), 0.8), osc(ctx, 'square', hz('D4'), 0.06), 0.5);
    const chordF = lp(ctx, chordSrc, 4500, 0.9);
    [0, -2, -5, -7].forEach((semis, k) => {
      let g = varispeed(ctx, chordF, 2 ** (semis / 12), slice);
      g = crush(ctx, g, 11 - 1.6 * k, 1 + k);
      mul(g, env(ctx, [[0, 0], [0.001, 1], [slice - 0.004, 0.85], [slice, 0]], slice));
      m.add(g, { at: k * (brk / 4), gain: 0.3 - 0.03 * k, pan: k % 2 ? 0.2 : -0.2, send: 0.15 });
    });
    m.add(thump(ctx, { from: 150, to: 60, drop: 0.05, dur: 0.16 }), { gain: 0.3 });
    // The break.
    m.add(mul(hp(ctx, noise(ctx, 0.07), 3000), perc(ctx, 0.0005, 0.06, 0.07)), { at: brk, gain: 0.5, send: 0.3 });
    m.add(thump(ctx, { from: 200, to: 60, drop: 0.06, dur: 0.26 }), { at: brk, gain: 0.3 });
    const clampDur = 0.36;
    let clamp = add(osc(ctx, 'square', hz('E4'), clampDur), osc(ctx, 'square', hz('Bb4'), clampDur, { phase: 0.3 }));
    clamp = hp(ctx, lp(ctx, ring(ctx, clamp, hz('D2'), 0.6), 3200, 0.8), 110);
    const fall = varispeed(ctx, clamp, glide(1, 0.4, 0.3), clampDur);
    const fallC = crush(ctx, fall, glide(12, 4, clampDur, 'lin'), glide(1, 6, clampDur, 'lin'));
    mul(fallC, env(ctx, [[0, 0], [0.002, 1], [0.05, 0.6], [clampDur, 0]], clampDur, 'exp'));
    m.add(fallC, { at: brk, gain: 0.24, send: 0.2 });
    const shards = new Mix(ctx, 0.6);
    for (let k = 0; k < 24; k++) {
      const x = ctx.rand();
      const f = scaleNoteBetween(ctx, 1800 - 900 * x, 7500 - 3500 * x);
      const g = crystal(ctx, { freq: f, dur: 0.05 + ctx.rand() * 0.16, bright: 0.8 });
      shards.add(g, { at: x * x * 0.32, gain: (0.18 + 0.2 * ctx.rand()) * (1 - 0.6 * x), pan: ctx.rand() * 1.8 - 0.9 });
    }
    const sh = shards.out();
    const bits = glide(12, 6, 0.5, 'lin');
    const hold = glide(1, 3, 0.5, 'lin');
    const tame = (x: Float32Array): Float32Array => eq(ctx, lp(ctx, crush(ctx, x, bits, hold), 7000, 0.7), 'highshelf', 3500, -2);
    m.addStereo({ l: tame(sh.l), r: tame(sh.r) }, { at: brk, gain: 0.8, send: 0.35 });
    const out = m.out({ space: SPACE.table, echo: { time: 0.12, feedback: 0.3, mix: 0.22, pingpong: true, damp: 3500 } });
    return fadeEnd(ctx, out, 0.15);
  },

  'spell.copied': (ctx) => {
    // Duplicated: the spell's glyph (a quick FM sweep up an octave into a ringing D6 over an F5 body) far left, a scan sweeps across, and its
    // exact copy appears far right, audibly more digital (6-bit, sample-held), its echoes trailing off.
    const dur = 0.8;
    const copyAt = 0.2;
    const m = new Mix(ctx, dur);
    const motif = (): Float32Array => {
      const d = 0.28;
      const s = fm(ctx, glide(hz('D5'), hz('D6'), 0.03), d, { ratio: 2, index: glide(2.2, 0.3, 0.2, 'lin') });
      mul(s, env(ctx, [[0, 0], [0.002, 0.5], [0.03, 1], [d, 0]], d, 'exp'));
      add(s, blip(ctx, { freq: hz('F5'), dur: 0.2, wave: 'triangle', decay: 0.17 }), 0.45);
      return lp(ctx, s, 6000, 0.7);
    };
    m.add(tick(ctx, { freq: 5500, dur: 0.003 }), { gain: 0.3, pan: -0.6 });
    m.add(motif(), { gain: 0.4, pan: -0.7, send: 0.25 });
    const scanDur = 0.12;
    const sc = mul(bp(ctx, noise(ctx, scanDur), glide(1500, 5500, scanDur), 4), env(ctx, [[0, 0], [0.08, 1], [scanDur, 0]], scanDur));
    m.add(sc, { at: 0.085, gain: 0.22, pan: 0.1, send: 0.2 });
    m.add(tick(ctx, { freq: 5500, dur: 0.003 }), { at: copyAt, gain: 0.3, pan: 0.6 });
    m.add(crush(ctx, motif(), 6, 3), { at: copyAt, gain: 0.4, pan: 0.7, send: 0.4 });
    const out = m.out({ space: SPACE.table, echo: { time: 0.11, feedback: 0.22, mix: 0.25, pingpong: true, damp: 4000 } });
    return fadeEnd(ctx, out, 0.15);
  },

  'ability.activated': (ctx) => {
    // A function powers up: a fast rising charge whine (A4 -> E5 in 60 ms) that locks in through quantized steps (G5, C6, E6), then it engages:
    // a click and a cool E6/G5 tone gated into two crisp pulses of light.
    const dur = 0.45;
    const on = 0.085;
    const m = new Mix(ctx, dur);
    const rise = glide(hz('A4'), hz('E5'), 0.06);
    const pitch = (t: number): number => (t < 0.06 ? rise(t) : t < 0.07 ? hz('G5') : t < on ? hz('C6') : hz('E6'));
    const charge = fm(ctx, pitch, on + 0.01, { ratio: 2, index: 0.9 });
    mul(charge, env(ctx, [[0, 0], [0.004, 0.3], [on, 1], [on + 0.01, 0]], on + 0.01, 'exp'));
    m.add(lp(ctx, charge, 5000, 0.7), { gain: 0.24, send: 0.15 });
    m.add(tick(ctx, { freq: 5200, dur: 0.003 }), { at: on, gain: 0.4 });
    const tone = add(osc(ctx, 'triangle', hz('E6'), 0.3), osc(ctx, 'sine', hz('G5'), 0.3), 0.8);
    gatePulses(ctx, tone, 15, 2);
    mul(tone, perc(ctx, 0.002, 0.26, 0.3));
    m.add(tone, { at: on, gain: 0.42, pan: -0.1, send: 0.3 });
    const twin = gatePulses(ctx, blip(ctx, { freq: hz('E6') * 1.005, dur: 0.24, wave: 'sine', decay: 0.2 }), 15, 2);
    m.add(twin, { at: on, gain: 0.18, pan: 0.3, send: 0.3 });
    const out = m.out({ space: SPACE.ui, echo: { time: 0.07, feedback: 0.22, mix: 0.2, pingpong: true, damp: 4500 } });
    return fadeEnd(ctx, out, 0.08);
  },

  'ability.triggered': (ctx) => {
    // Something happened because of this card: a relay tripping in gold, three rapid strikes 45 ms apart (fading 1 / 0.75 / 0.55) of a brassy
    // FM dyad on F5 + C6, with a spray of glints over it and a slow, faint echo.
    const dur = 0.55;
    const m = new Mix(ctx, dur);
    const strike = (at: number, g: number): void => {
      m.add(tick(ctx, { freq: 4000, dur: 0.002 }), { at, gain: 0.15 * g });
      m.add(bell(ctx, hz('C6'), 0.28, { ratio: 1, index: 2.5, indexEnd: 0.4, decay: 0.24 }), { at, gain: 0.28 * g, pan: 0.12, send: 0.3 });
      m.add(bell(ctx, hz('F5'), 0.28, { ratio: 1, index: 2.5, indexEnd: 0.4, decay: 0.22 }), { at, gain: 0.32 * g, pan: -0.12, send: 0.3 });
    };
    strike(0, 1);
    strike(0.045, 0.75);
    strike(0.09, 0.55);
    m.addStereo(shimmer(ctx, { dur: 0.22, density: 30, lo: 2500, hi: 6000, grain: 0.06 }), { at: 0.01, gain: 0.09, send: 0.4 });
    const out = m.out({ space: SPACE.table, echo: { time: 0.16, feedback: 0.25, mix: 0.15, pingpong: true, damp: 4500 } });
    return fadeEnd(ctx, out, 0.12);
  },
};
