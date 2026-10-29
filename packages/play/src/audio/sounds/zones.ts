/**
 * Card states and the hand (docs/design/sound.md "Cards"): flips and transformations, attachments, control changes, phasing, reveals and
 * searches, the card zoom, picking up and dropping a hand card, choosing a target and being targeted.
 *
 * Families inside the group:
 * - the hand pair: pickup is a resonant filter LIFT on a fixed D4+A4 dyad, an octave under the glassy card.zoom (it brightens with no pitch
 *   motion, unlike card.draw and priority.mine); drop is the same dyad's filter CLOSING into a landing;
 * - the scanners: reveal is one sweep exposing an F6/A6 crystal (a minor colour, "data shown"), search is a long scrolling readout whose
 *   resolution, the D6 -> A6 fifth, is kept as its own "match found" signature;
 * - the lock-ons: target = pips stepping UP into a bright D6+A6 lock; targeted = its darker twin, two Bb5 pips then a falling Bb4 -> A4 minor
 *   second whose echo supplies the repeat;
 * - the state changes: flip = a flanged phase shift with a quantized, inverted answer; attach = a magnetic pull-in that latches as the attachment
 *   arrives; control = the card's own data caught in a stutter loop, bent and re-keyed as it reaches the other side; phase = a strobing,
 *   crushing fade with a last point of light.
 * The event cues (attach, control, phase, reveal, search, targeted) play as the board animation starts; moved cards slide from about 0.12 to
 * 0.46 s (board/fx/Animator.ts), so their accents sit there.
 */
import type { Recipe, SoundId } from '../catalog';
import { clamp, compress, crush, env, flange, fm, glide, hp, len, lp, Mix, mul, noise, osc, panGains, perc, steps, type Ctx, type Param, type Stereo } from '../dsp';
import { blip, crystal, hz, scan, scaleNoteBetween, shimmer, SPACE, thump, tick, whoosh } from '../palette';

// ---- private helpers ---------------------------------------------------------------------------------------------------------------

/** A mono signal panned along a moving position (-1 left .. 1 right, equal power). */
function panMove(ctx: Ctx, x: Float32Array, pan: Param): Stereo {
  const p = typeof pan === 'number' ? () => pan : pan;
  const l = new Float32Array(x.length);
  const r = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const [gl, gr] = panGains(p(i / ctx.sr));
    l[i] = x[i]! * gl;
    r[i] = x[i]! * gr;
  }
  return { l, r };
}

/** Fades a finished mix to silence between `from` and `to` seconds (a raised-cosine tail), so a room tail never gets cut off abruptly. */
function fadeTail(ctx: Ctx, st: Stereo, from: number, to: number): Stereo {
  const a = Math.round(from * ctx.sr);
  const b = Math.max(a + 1, Math.round(to * ctx.sr));
  for (let i = a; i < st.l.length; i++) {
    const g = i >= b ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * (i - a)) / (b - a));
    st.l[i] = st.l[i]! * g;
    st.r[i] = st.r[i]! * g;
  }
  return st;
}

/** Sum of sines on `notes` (a clean, pure dyad or chord), each `dur` long. */
function sines(ctx: Ctx, notes: readonly number[], dur: number, gains: readonly number[] = []): Float32Array {
  const out = new Float32Array(len(ctx, dur));
  notes.forEach((f, k) => {
    const s = osc(ctx, 'sine', f, dur, { phase: ctx.rand() });
    const g = gains[k] ?? 1 / notes.length;
    for (let i = 0; i < out.length; i++) out[i] = out[i]! + s[i]! * g;
  });
  return out;
}

/** The hand pair's voice: a D4 + A4 dyad (triangle plus a 40% pulse) through a moving resonant low-pass, `dur` long, not yet enveloped. */
function handDyad(ctx: Ctx, cutoff: Param, dur: number, q = 0.9): Float32Array {
  const out = new Float32Array(len(ctx, dur));
  for (const f of [hz('D4'), hz('A4')]) {
    const t = osc(ctx, 'triangle', f, dur, { phase: ctx.rand() });
    const p = osc(ctx, 'pulse', f, dur, { pw: 0.4, phase: ctx.rand() });
    for (let i = 0; i < out.length; i++) out[i] = out[i]! + t[i]! * 0.5 + p[i]! * 0.22;
  }
  return lp(ctx, out, cutoff, q);
}

/**
 * Buffer-repeat glitch: the slice of `src` starting at `start` s is replayed with each of `lens` (s) in turn, back to back (a stutter roll), each
 * repeat with 1 ms edges so the cuts do not click.
 */
function stutter(ctx: Ctx, src: Float32Array, start: number, lens: readonly number[]): Float32Array {
  const total = lens.reduce((a, b) => a + b, 0);
  const out = new Float32Array(len(ctx, total));
  const s0 = Math.round(start * ctx.sr);
  const edge = Math.round(0.001 * ctx.sr);
  let off = 0;
  for (const d of lens) {
    const n = Math.round(d * ctx.sr);
    for (let i = 0; i < n && off + i < out.length; i++) {
      const g = Math.min(1, i / edge, (n - 1 - i) / edge);
      out[off + i] = (src[s0 + i] ?? 0) * Math.max(0, g);
    }
    off += n;
  }
  return out;
}

/** A flicker gate: on, with dropouts that grow more frequent and longer towards the end (a dying neon tube), each edge 1.5 ms long. */
function flickerGate(ctx: Ctx, dur: number, o: { from: number; count: number; minGap: number; maxGap: number }): Float32Array {
  const g = new Float32Array(len(ctx, dur)).fill(1);
  const edge = Math.round(0.0015 * ctx.sr);
  for (let k = 0; k < o.count; k++) {
    const x = (k + 0.3 + 0.4 * ctx.rand()) / o.count;
    const t = o.from + (dur - o.from) * Math.sqrt(x);
    const gap = o.minGap + (o.maxGap - o.minGap) * x;
    const a = Math.round(t * ctx.sr);
    const b = Math.round((t + gap) * ctx.sr);
    const depth = Math.min(1, 0.7 + 0.4 * x);
    for (let i = a; i < b && i < g.length; i++) {
      const ramp = Math.min(1, (i - a) / edge, (b - i) / edge);
      g[i] = Math.min(g[i]!, 1 - depth * clamp(ramp, 0, 1));
    }
  }
  return g;
}

// ---- the sounds ------------------------------------------------------------------------------------------------------------------

export const ZONE_SOUNDS: Partial<Record<SoundId, Recipe>> = {
  'card.flip': (ctx) => {
    // A flanged unison riser climbs D4 -> D5 while the card shrinks (a phaser jet sweep). At 0.18 s, as it swells, a digital flash: a tick, a D7
    // square pip and an FM burst whose index collapses. The new face answers with the climb inverted in quantized steps (D6, C6, A5) and an A6/C7
    // crystal (its own colour: the D/A fifth belongs to search's "match") echoing across the table.
    const T = 0.18;
    const m = new Mix(ctx, 0.58);
    const rise = osc(ctx, 'saw', glide(hz('D4'), hz('D5'), T, 'exp'), T + 0.02);
    const rise2 = osc(ctx, 'saw', glide(hz('D4') * 1.006, hz('D5') * 1.006, T, 'exp'), T + 0.02, { phase: 0.37 });
    for (let i = 0; i < rise.length; i++) rise[i] = (rise[i]! + rise2[i]!) * 0.5;
    const r = lp(ctx, rise, glide(700, 4200, T), 1.3);
    mul(r, env(ctx, [[0, 0], [0.02, 0.35], [T - 0.01, 1], [T + 0.012, 0]], T + 0.02, 'lin'));
    const air = whoosh(ctx, { dur: T + 0.02, from: 700, to: 6500, q: 1.4, peak: 0.88 });
    for (let i = 0; i < r.length; i++) r[i] = r[i]! + air[i]! * 0.55;
    m.add(flange(ctx, r, { rate: 4.5, depth: 0.0035, base: 0.0006, feedback: 0.72, mix: 0.55 }), { gain: 0.42, send: 0.17 });
    // The flash.
    m.add(tick(ctx, { freq: 6000, dur: 0.002 }), { at: T, gain: 0.45 });
    m.add(blip(ctx, { freq: hz('D7'), dur: 0.025, wave: 'square', decay: 0.022, cutoff: 6500 }), { at: T, gain: 0.18, send: 0.3 });
    const flash = mul(fm(ctx, hz('D6'), 0.03, { ratio: 2, index: glide(3, 0, 0.015, 'lin') }), perc(ctx, 0.0008, 0.028, 0.03));
    m.add(flash, { at: T, gain: 0.45, send: 0.2 });
    // The new face: the inverted run in two 20 ms steps, a soft A4 under it, then the crystal.
    const face = blip(ctx, { freq: steps([hz('D6'), hz('C6'), hz('A5')], 0.02), dur: 0.26, wave: 'triangle', decay: 0.22, cutoff: 5000 });
    m.add(face, { at: T + 0.004, gain: 0.45, send: 0.3 });
    m.add(blip(ctx, { freq: hz('A4'), dur: 0.2, wave: 'sine', decay: 0.16 }), { at: T + 0.044, gain: 0.2 });
    m.add(crystal(ctx, { freq: hz('A6'), dur: 0.38, bright: 0.55 }), { at: T + 0.044, gain: 0.2, pan: -0.2, send: 0.5 });
    m.add(crystal(ctx, { freq: hz('C7'), dur: 0.34, bright: 0.5 }), { at: T + 0.05, gain: 0.12, pan: 0.25, send: 0.5 });
    const st = m.out({ space: SPACE.table, echo: { time: 0.11, feedback: 0.3, mix: 0.3, pingpong: true, damp: 4500 } });
    return fadeTail(ctx, st, 0.44, 0.58);
  },

  'card.attach': (ctx) => {
    // Pulled in while the attachment slides under its permanent: a rising magnetic swish and a triangle accelerating A4 -> D5, then, as it arrives
    // (0.25 s), a double latch: a light clamp and an FM clink, a higher clink with an A5 lock pip and an A6 glint 28 ms later. The field holds it:
    // a D4/A4/D5 hum whose 28 Hz rattle dies away. Short ping-pong echo in the table room.
    const m = new Mix(ctx, 0.42);
    const L = 0.25;
    m.add(whoosh(ctx, { dur: L + 0.01, from: 700, to: 3200, q: 1.8, peak: 0.9 }), { gain: 0.32, send: 0.15 });
    const pull = osc(ctx, 'triangle', (t: number) => hz('A4') * (hz('D5') / hz('A4')) ** clamp((t / L) ** 2, 0, 1), L + 0.01);
    mul(pull, env(ctx, [[0, 0], [L * 0.5, 0.3], [L, 1], [L + 0.01, 0]], L + 0.01, 'lin'));
    m.add(lp(ctx, pull, 3000), { gain: 0.3, send: 0.1 });
    // Latch 1: the clamp.
    m.add(thump(ctx, { from: 200, to: hz('D3'), drop: 0.025, dur: 0.1 }), { at: L, gain: 0.3 });
    m.add(tick(ctx, { freq: 3200, dur: 0.004, q: 1.5 }), { at: L, gain: 0.5 });
    const clink = mul(fm(ctx, hz('D5'), 0.09, { ratio: 1.414, index: glide(3, 0.4, 0.05, 'lin') }), perc(ctx, 0.0008, 0.07, 0.09));
    m.add(lp(ctx, clink, 5000), { at: L, gain: 0.55, send: 0.2 });
    // Latch 2: the lock, with a point of light.
    const L2 = L + 0.028;
    m.add(tick(ctx, { freq: 4600, dur: 0.003, q: 1.5 }), { at: L2, gain: 0.4 });
    const clink2 = mul(fm(ctx, hz('A5'), 0.06, { ratio: 1.414, index: glide(2.2, 0.3, 0.04, 'lin') }), perc(ctx, 0.0008, 0.05, 0.06));
    m.add(lp(ctx, clink2, 5000), { at: L2, gain: 0.35, send: 0.2 });
    m.add(blip(ctx, { freq: hz('A5'), dur: 0.07, wave: 'square', decay: 0.06, cutoff: 3200 }), { at: L2, gain: 0.28, send: 0.3 });
    m.add(crystal(ctx, { freq: hz('A6'), dur: 0.16, bright: 0.5 }), { at: L2, gain: 0.12, pan: 0.2, send: 0.4 });
    // The field: rattling at 28 Hz as the magnet snaps on, the rattle dying into a steady, fading hold.
    const fd = 0.15;
    const field = sines(ctx, [hz('D4'), hz('A4'), hz('D5')], fd, [0.55, 0.3, 0.15]);
    for (let i = 0; i < field.length; i++) {
      const t = i / ctx.sr;
      field[i] = field[i]! * (1 - 0.7 * Math.exp(-t / 0.06) * (0.5 + 0.5 * Math.cos(2 * Math.PI * 28 * t)));
    }
    mul(field, env(ctx, [[0, 0], [0.004, 1], [0.06, 0.6], [fd, 0]], fd, 'exp'));
    m.add(field, { at: L, gain: 0.26, send: 0.1 });
    const st = m.out({ space: SPACE.table, echo: { time: 0.07, feedback: 0.2, mix: 0.25, pingpong: true, damp: 5000 } });
    return fadeTail(ctx, st, 0.38, 0.42);
  },

  'card.control': (ctx) => {
    // Hacked: the card's own data line (a quick square arpeggio D6 A5 F6 C6) gets stuck on its last note and loops in an accelerating, crushed
    // buffer-repeat stutter; its tone bends down a fifth with a wobble as the card slides, snaps up onto A5, and re-keys A5 -> D6 on the new side
    // as the slide ends (about 0.46 s). The whole thing travels across the stereo field.
    const m = new Mix(ctx, 0.66);
    const R0 = 0.12;
    const data = new Float32Array(len(ctx, R0 + 0.03));
    const notes = [hz('D6'), hz('A5'), hz('F6'), hz('C6')];
    notes.forEach((f, k) => {
      const g = blip(ctx, { freq: f, dur: 0.028, wave: 'square', decay: 0.026, cutoff: 5500 });
      const off = Math.round(k * 0.03 * ctx.sr);
      for (let i = 0; i < g.length && off + i < data.length; i++) data[off + i] = data[off + i]! + g[i]!;
    });
    m.addStereo(panMove(ctx, data.subarray(0, len(ctx, R0)), -0.35), { gain: 0.32, send: 0.15 });
    // The stutter: the C6 note (from 0.09 s) replayed ever shorter and ever more crushed.
    const roll = stutter(ctx, data, 0.09, [0.03, 0.02, 0.02, 0.013, 0.013, 0.009, 0.009, 0.006, 0.006, 0.006]);
    const rollDur = roll.length / ctx.sr;
    const rolled = crush(ctx, roll, glide(10, 4, rollDur, 'lin'), glide(1, 6, rollDur, 'lin'));
    m.addStereo(panMove(ctx, lp(ctx, rolled, 6000), glide(-0.35, 0, rollDur, 'lin')), { at: R0, gain: 0.36, send: 0.12 });
    // The bend: a square tone dragged down a fifth with a wobble, then pulled up onto A5 (rewritten), its crush cleaning up as it settles.
    const BD = 0.22;
    const bendF = (t: number) => {
      const wob = 2 ** ((40 / 1200) * Math.sin(2 * Math.PI * 17 * t) * Math.max(0, 1 - t / 0.12));
      if (t < 0.09) return hz('D5') * (hz('G4') / hz('D5')) ** (t / 0.09) * wob;
      if (t < 0.125) return hz('G4') * (hz('A5') / hz('G4')) ** ((t - 0.09) / 0.035) * wob;
      return hz('A5');
    };
    let bend = osc(ctx, 'square', bendF, BD);
    bend = crush(ctx, bend, glide(5, 12, 0.13, 'lin', 0.03), glide(4, 1, 0.13, 'lin', 0.03));
    bend = lp(ctx, bend, glide(1800, 3800, BD), 0.9);
    mul(bend, env(ctx, [[0, 0], [0.004, 0.8], [0.12, 1], [0.15, 0.6], [BD, 0]], BD, 'exp'));
    const b0 = R0 + rollDur - 0.02;
    m.addStereo(panMove(ctx, bend, glide(0, 0.3, BD, 'lin')), { at: b0, gain: 0.3, send: 0.2 });
    m.add(thump(ctx, { from: 160, to: 70, drop: 0.04, dur: 0.12 }), { at: b0, gain: 0.14 });
    // The re-key: A5 -> D6 on the new side, a clean confirmation landing at 0.46 s.
    const k0 = 0.41;
    m.add(blip(ctx, { freq: hz('A5'), dur: 0.06, wave: 'triangle', decay: 0.05 }), { at: k0, gain: 0.7, pan: 0.35, send: 0.3 });
    m.add(blip(ctx, { freq: hz('D6'), dur: 0.12, wave: 'triangle', decay: 0.1 }), { at: k0 + 0.05, gain: 0.82, pan: 0.4, send: 0.35 });
    m.add(tick(ctx, { freq: 5000, dur: 0.003 }), { at: k0 + 0.05, gain: 0.3, pan: 0.4 });
    const st = m.out({ space: SPACE.table, echo: { time: 0.09, feedback: 0.25, mix: 0.25, pingpong: true, damp: 4500 } });
    return fadeTail(ctx, st, 0.58, 0.66);
  },

  'card.phase': (ctx) => {
    // Flickers out of existence: a soft rising "fwip", then a pale chord (D5 A5 D6 over D4) shimmering through a flanger and strobing ever faster
    // (8 -> 26 Hz) with ever shorter "on" moments, plus random dropouts, its last 40% crushing into digital grain (a hologram losing its hold) while
    // a high-pass thins it into air. One faint D7 point of light remains at the end: it is gone for now, not destroyed.
    const D = 0.56;
    const m = new Mix(ctx, 0.65);
    m.add(whoosh(ctx, { dur: 0.1, from: 900, to: 4500, q: 1.5, peak: 0.7 }), { gain: 0.25, send: 0.2 });
    const body = sines(ctx, [hz('D5'), hz('A5'), hz('D6')], D, [0.45, 0.35, 0.25]);
    const tri = osc(ctx, 'triangle', hz('D4'), D);
    for (let i = 0; i < body.length; i++) body[i] = body[i]! + tri[i]! * 0.15;
    let shim = flange(ctx, body, { rate: 2.2, depth: 0.004, base: 0.0007, feedback: 0.6, mix: 0.5 });
    // The strobe: a gate accelerating 8 -> 26 Hz whose duty shrinks 90% -> 25%, 2 ms edges; steady for the first 60 ms.
    let ph = 0;
    for (let i = 0; i < shim.length; i++) {
      const t = i / ctx.sr;
      const x = clamp((t - 0.06) / (D - 0.06), 0, 1);
      const rate = 8 + 18 * x;
      ph += rate / ctx.sr;
      const duty = 0.9 - 0.65 * x;
      const e = rate * 0.002;
      const fr = ph - Math.floor(ph);
      const g = t < 0.06 ? 1 : clamp(fr / e, 0, 1) * clamp((duty - fr) / e, 0, 1);
      shim[i] = shim[i]! * (0.08 + 0.92 * g);
    }
    mul(shim, flickerGate(ctx, D, { from: 0.1, count: 8, minGap: 0.012, maxGap: 0.04 }));
    mul(shim, env(ctx, [[0, 0], [0.03, 1], [0.15, 0.9], [0.35, 0.4], [D, 0]], D, 'lin'));
    // Crushed in the last 40%: 12 -> 7 bits, sample-and-hold 1 -> 3.
    const c0 = D * 0.6;
    shim = crush(ctx, shim, (t) => (t < c0 ? 16 : 12 - 5 * ((t - c0) / (D - c0))), (t) => (t < c0 ? 1 : 1 + 2 * ((t - c0) / (D - c0))));
    const thin = hp(ctx, shim, glide(150, 2000, D), 0.7);
    m.addStereo(panMove(ctx, thin, (t) => 0.25 * Math.sin(2 * Math.PI * 3 * t)), { at: 0.03, gain: 0.6, send: 0.18 });
    m.addStereo(shimmer(ctx, { dur: 0.4, density: 30, lo: 2000, hi: 6500, grain: 0.08, fade: 'out' }), { at: 0.05, gain: 0.3, send: 0.35 });
    m.add(crystal(ctx, { freq: hz('D7'), dur: 0.14, bright: 0.4 }), { at: 0.47, gain: 0.1, pan: 0.2, send: 0.45 });
    const st = m.out({ space: SPACE.table, echo: { time: 0.085, feedback: 0.25, mix: 0.12, pingpong: true, damp: 5000 } });
    return fadeTail(ctx, st, 0.53, 0.65);
  },

  'card.reveal': (ctx) => {
    // A scan line sweeps across (a chopped sine climbing, travelling left to right), then the data is exposed: a soft D5 tone with a crystal F6 and
    // A6 over it (a D minor triad, "data shown"), pinging across the grid. Unlike search, no readout and no D/A "match" fifth.
    const m = new Mix(ctx, 0.65);
    const S = 0.2;
    const sweep = lp(ctx, scan(ctx, { from: 700, to: 2600, dur: S, rate: 42, duty: 0.5 }), 4500);
    m.addStereo(panMove(ctx, sweep, glide(-0.5, 0.5, S, 'lin')), { gain: 0.55, send: 0.15 });
    m.add(lp(ctx, noise(ctx, S, 'pink'), glide(1200, 5000, S), 0.8), { gain: 0.05 });
    m.add(tick(ctx, { freq: 5500, dur: 0.003 }), { at: S, gain: 0.3 });
    m.add(blip(ctx, { freq: hz('D5'), dur: 0.22, wave: 'triangle', decay: 0.18, cutoff: 3500 }), { at: S, gain: 0.35, send: 0.25 });
    m.add(crystal(ctx, { freq: hz('F6'), dur: 0.38, bright: 0.6 }), { at: S, gain: 0.32, pan: -0.15, send: 0.45 });
    m.add(crystal(ctx, { freq: hz('A6'), dur: 0.34, bright: 0.5 }), { at: S + 0.04, gain: 0.22, pan: 0.2, send: 0.45 });
    const st = m.out({ space: SPACE.table, echo: { time: 0.12, feedback: 0.32, mix: 0.3, pingpong: true, damp: 4500 } });
    return fadeTail(ctx, st, 0.52, 0.65);
  },

  'card.search': (ctx) => {
    // Scrolling through the library: a fast readout of square and triangle data blips on notes of the key, alternating left and right, quickening as
    // it hunts, under a low-pass that opens 2500 -> 5000 Hz (the scan converging), over a chopped scan sweeping up and back down; it slows, then
    // "match found": D6 -> A6 with a crystal ping (this fifth is the match's own signature in the set).
    const m = new Mix(ctx, 0.85);
    const R = 0.58;
    const ro = new Mix(ctx, R + 0.03);
    let t = 0;
    let k = 0;
    while (t < R) {
      const x = t / R;
      const f = scaleNoteBetween(ctx, 900 + 500 * Math.sin(Math.PI * x), 2600);
      const b = blip(ctx, { freq: f, dur: 0.018, wave: k % 3 === 0 ? 'square' : 'triangle', decay: 0.016, cutoff: 5000 });
      ro.add(b, { at: t, gain: (0.22 + 0.08 * ctx.rand()) * (0.75 + 0.25 * Math.sin(Math.PI * x)), pan: k % 2 ? 0.25 : -0.25 });
      // Faster in the middle of the hunt (30 ms -> 15 ms), slowing again near the end.
      t += 0.03 - 0.015 * Math.sin(Math.PI * Math.min(1, x * 1.15));
      k++;
    }
    const raw = ro.out();
    const open = glide(2500, 5000, R);
    m.addStereo({ l: lp(ctx, raw.l, open, 0.8), r: lp(ctx, raw.r, open, 0.8) }, { send: 0.08 });
    const sweepF = (s: number) => (s < R * 0.55 ? 500 * (2200 / 500) ** (s / (R * 0.55)) : 2200 * (700 / 2200) ** ((s - R * 0.55) / (R * 0.45)));
    const sw = osc(ctx, 'sine', sweepF, R);
    for (let i = 0; i < sw.length; i++) {
      const p = ((i / ctx.sr) * 24) % 1;
      sw[i] = sw[i]! * (p < 0.5 ? Math.sin(Math.PI * p * 2) : 0);
    }
    mul(sw, env(ctx, [[0, 0], [0.04, 1], [R * 0.8, 0.8], [R, 0]], R));
    m.add(sw, { gain: 0.2, send: 0.15 });
    m.add(lp(ctx, hp(ctx, noise(ctx, R, 'pink'), 700), glide(1500, 4000, R), 0.8), { gain: 0.05 });
    // Match found.
    const F = 0.6;
    m.add(tick(ctx, { freq: 5200, dur: 0.003 }), { at: F, gain: 0.3 });
    m.add(blip(ctx, { freq: hz('D6'), dur: 0.07, wave: 'square', decay: 0.06, cutoff: 4500 }), { at: F, gain: 0.3, pan: -0.1, send: 0.25 });
    m.add(blip(ctx, { freq: hz('A6'), dur: 0.12, wave: 'square', decay: 0.1, cutoff: 5000 }), { at: F + 0.06, gain: 0.28, pan: 0.1, send: 0.3 });
    m.add(blip(ctx, { freq: hz('D5'), dur: 0.16, wave: 'sine', decay: 0.13 }), { at: F + 0.06, gain: 0.3 });
    m.add(crystal(ctx, { freq: hz('A6'), dur: 0.2, bright: 0.5 }), { at: F + 0.06, gain: 0.18, pan: 0.25, send: 0.4 });
    const st = m.out({ space: SPACE.table, echo: { time: 0.09, feedback: 0.25, mix: 0.22, pingpong: true, damp: 4500 } });
    return fadeTail(ctx, st, 0.78, 0.85);
  },

  'card.zoom': (ctx) => {
    // Optical focus: a soft high dyad comes into focus as a resonant low-pass (Q 2) sweeps 350 -> 3000 Hz in 40 ms (blurred -> sharp, no pitch motion), with a 2 ms
    // 7 kHz glass edge and a faint crystal glint as it snaps sharp. 90 ms, very quiet; three variants land on A5, D6 or F5 (notes of the D minor
    // triad) so hundreds of hovers never repeat exactly.
    const v = ctx.variant % 3;
    const [lo, hi] = ([[hz('A5'), hz('D6')], [hz('D6'), hz('F6')], [hz('F5'), hz('A5')]] as const)[v]!;
    const D = 0.085;
    const m = new Mix(ctx, 0.095);
    const dy = new Float32Array(len(ctx, D));
    for (const [f, g] of [[lo, 0.55], [hi, 0.35]] as const) {
      const tr = osc(ctx, 'triangle', f, D, { phase: ctx.rand() });
      const sq = osc(ctx, 'square', f, D, { phase: ctx.rand() });
      for (let i = 0; i < dy.length; i++) dy[i] = dy[i]! + (tr[i]! * 0.8 + sq[i]! * 0.2) * g;
    }
    const focus = lp(ctx, dy, glide(350, 3000, 0.04), 2);
    mul(focus, env(ctx, [[0, 0], [0.025, 1], [0.05, 0.45], [0.08, 0], [D, 0]], D, 'lin'));
    const pan = [0, -0.1, 0.1][v]!;
    m.add(focus, { gain: 0.6, pan, send: 0.12 });
    m.add(tick(ctx, { freq: 7000, dur: 0.002, q: 1.5 }), { at: 0.024, gain: 0.12, pan });
    m.add(crystal(ctx, { freq: hi * 2, dur: 0.06, bright: 0.3 }), { at: 0.024, gain: 0.04, pan, send: 0.3 });
    const st = m.out({ space: SPACE.ui });
    return fadeTail(ctx, st, 0.08, 0.095);
  },

  'card.pickup': (ctx) => {
    // Lifted: a crisp 2.5 kHz "unlatch" tick, then a low D4 + A4 dyad brightening through an audible resonant sweep (low-pass 400 -> 2800 Hz in
    // 60 ms, Q 3.5): a filter lift, no pitch glide and no whoosh (distinct from card.draw's step and priority.mine's rise), a D5 layer joining at
    // 30 ms and a faint D7 glint at the top. An octave under card.zoom (the high, glassy one), so hover-then-drag never sounds twice. Drop mirrors it.
    const m = new Mix(ctx, 0.125);
    m.add(tick(ctx, { freq: 2500, dur: 0.0015, q: 1.4 }), { gain: 0.3 });
    const lift = handDyad(ctx, glide(400, 2800, 0.06), 0.11, 3.5);
    mul(lift, perc(ctx, 0.02, 0.085, 0.11));
    m.add(lift, { gain: 0.5, send: 0.15 });
    m.add(blip(ctx, { freq: hz('D5'), dur: 0.08, wave: 'triangle', attack: 0.012, decay: 0.06 }), { at: 0.03, gain: 0.15, send: 0.15 });
    m.add(crystal(ctx, { freq: hz('D7'), dur: 0.07, bright: 0.3 }), { at: 0.045, gain: 0.04, pan: 0.15, send: 0.35 });
    const st = m.out({ space: SPACE.ui });
    return fadeTail(ctx, st, 0.1, 0.125);
  },

  'card.drop': (ctx) => {
    // Placed: the mirror of pickup. The same D4 + A4 dyad starts bright and its resonant low-pass closes 2800 -> 600 Hz over 35 ms as the card
    // comes down, then lands: a light thump, a tick, a square stepping D5 -> D4 in one quantized 15 ms step over a D4 triangle ("set"), and a D6
    // glint with a short ping-pong echo.
    const m = new Mix(ctx, 0.2);
    const L = 0.035;
    const fall = handDyad(ctx, glide(2800, 600, L), L + 0.02, 2.5);
    mul(fall, env(ctx, [[0, 0], [0.003, 1], [L, 0.55], [L + 0.02, 0]], L + 0.02, 'lin'));
    m.add(fall, { gain: 0.5, send: 0.1 });
    m.add(thump(ctx, { from: 160, to: hz('A2'), drop: 0.03, dur: 0.1 }), { at: L, gain: 0.2 });
    m.add(tick(ctx, { freq: 3500, dur: 0.004, q: 1.4 }), { at: L, gain: 0.35 });
    m.add(blip(ctx, { freq: steps([hz('D5'), hz('D4')], 0.015), dur: 0.09, wave: 'square', decay: 0.07, cutoff: 2000 }), { at: L, gain: 0.34, send: 0.25 });
    m.add(blip(ctx, { freq: hz('D4'), dur: 0.1, wave: 'triangle', decay: 0.08 }), { at: L, gain: 0.3 });
    m.add(crystal(ctx, { freq: hz('D6'), dur: 0.12, bright: 0.4 }), { at: L, gain: 0.08, pan: -0.15, send: 0.4 });
    const mixed = m.out({ space: SPACE.ui, echo: { time: 0.06, feedback: 0.2, mix: 0.12, pingpong: true, damp: 4500 } });
    const st = compress(ctx, mixed, { threshold: -10, ratio: 3, attack: 0.001, release: 0.05 });
    return fadeTail(ctx, st, 0.16, 0.2);
  },

  'card.target': (ctx) => {
    // Target locked: a reticle acquiring, three quick pips stepping up A5, C6, D6 and closing in (30 ms, then 23 ms apart), then the lock: a bright
    // D6 + A6 dyad over D5 with an A6 crystal point of light, crisp and confident.
    const m = new Mix(ctx, 0.25);
    [hz('A5'), hz('C6'), hz('D6')].forEach((f, k) => {
      const at = [0, 0.03, 0.053][k]!;
      m.add(blip(ctx, { freq: f, dur: 0.02, wave: 'triangle', attack: 0.0015, decay: 0.024 }), { at, gain: 0.3 + 0.06 * k, pan: k === 1 ? 0.08 : -0.08 });
    });
    const L = 0.072;
    m.add(tick(ctx, { freq: 5500, dur: 0.003 }), { at: L, gain: 0.35 });
    m.add(blip(ctx, { freq: hz('D6'), dur: 0.11, wave: 'square', decay: 0.1, cutoff: 4200 }), { at: L, gain: 0.22, pan: -0.1, send: 0.2 });
    m.add(blip(ctx, { freq: hz('A6'), dur: 0.11, wave: 'triangle', decay: 0.1 }), { at: L, gain: 0.3, pan: 0.1, send: 0.2 });
    m.add(blip(ctx, { freq: hz('D5'), dur: 0.1, wave: 'sine', decay: 0.08 }), { at: L, gain: 0.25 });
    m.add(crystal(ctx, { freq: hz('A6'), dur: 0.16, bright: 0.45 }), { at: L + 0.004, gain: 0.1, pan: 0.15, send: 0.4 });
    const st = m.out({ space: SPACE.ui, echo: { time: 0.055, feedback: 0.2, mix: 0.15, pingpong: true, damp: 4000 } });
    return fadeTail(ctx, st, 0.21, 0.25);
  },

  'card.targeted': (ctx) => {
    // The darker twin of card.target: someone else's reticle. Two acquire pips on Bb5 (no step up: not yours), then a warning on soft-filtered
    // pulses with a light sine octave under, Bb4 -> A4 (a falling minor second), once; a dark ping-pong echo repeats the pair, softer, from the
    // other side. Attention without panic.
    const m = new Mix(ctx, 0.55);
    [0, 0.03].forEach((at, k) => {
      m.add(lp(ctx, blip(ctx, { freq: hz('Bb5'), dur: 0.02, wave: 'triangle', attack: 0.0015, decay: 0.024 }), 3000), { at, gain: 0.32 + 0.05 * k, pan: k ? 0.08 : -0.08 });
    });
    m.add(crystal(ctx, { freq: hz('Bb5'), dur: 0.12, bright: 0.35 }), { at: 0.03, gain: 0.06, pan: 0.1, send: 0.4 });
    [hz('Bb4'), hz('A4')].forEach((f, k) => {
      const at = 0.07 + k * 0.1;
      const d = 0.11;
      const shape: [number, number][] = [[0, 0], [0.005, 1], [0.07, 0.7], [d, 0]];
      const p = mul(lp(ctx, osc(ctx, 'pulse', f, d, { pw: 0.32 }), 3200, 1.1), env(ctx, shape, d, 'lin'));
      const sub = mul(osc(ctx, 'sine', f / 2, d), env(ctx, shape, d, 'lin'));
      m.add(p, { at, gain: 0.3, pan: k ? 0.1 : -0.1, send: 0.6 });
      m.add(sub, { at, gain: 0.15 });
    });
    const st = m.out({ space: SPACE.table, echo: { time: 0.21, feedback: 0.3, mix: 0.45, pingpong: true, damp: 3500 } });
    return fadeTail(ctx, st, 0.47, 0.55);
  },
};
