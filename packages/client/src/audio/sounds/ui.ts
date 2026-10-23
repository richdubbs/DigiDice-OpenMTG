/**
 * Interface sounds (docs/design/sound.md "Interface"): buttons, toggles, dialogs, notices and the deckbuilder. Short, clean, high blips in D minor in
 * the small `ui` room; they must stay pleasant when heard hundreds of times.
 *
 * The family: pure sine / triangle / thin-pulse tones on notes of the key, a few milliseconds of band-passed noise for the contact, the `ui` room and
 * a short ping-pong echo on the bigger cues. Pairs mirror each other (confirm / cancel, toggle on / off, open / close, add / remove): the same voice,
 * the motion reversed. Digital grit (crush, voxels) is kept for the two failures that earn it: delete and error.
 */
import type { Recipe, SoundId } from '../catalog';
import { crush, type Ctx, env, fm, glide, lp, Mix, mul, osc, panGains, type Param, perc, steps, type Stereo, type Wave } from '../dsp';
import { blip, crystal, D_MAJOR, hz, shimmer, SPACE, tick, voxels, whoosh } from '../palette';

// ---- private helpers ------------------------------------------------------------------------------------------------------------------

/** A thin pulse wave of width `pw` (dsp.osc centres a pulse at any width, so there is no DC offset to thump under an envelope). */
function pulse(ctx: Ctx, freq: Param, dur: number, pw: number): Float32Array {
  return osc(ctx, 'pulse', freq, dur, { pw });
}

/** A thin-pulse blip (the toggles, the deckbuilder, the panels): a DC-free pulse under a percussive envelope, low-passed. */
function pip(ctx: Ctx, o: { freq: Param; dur: number; pw?: number; attack?: number; decay?: number; cutoff: Param }): Float32Array {
  const s = pulse(ctx, o.freq, o.dur, o.pw ?? 0.3);
  mul(s, perc(ctx, o.attack ?? 0.001, o.decay ?? o.dur, o.dur));
  return lp(ctx, s, o.cutoff, 0.7);
}

/**
 * Two thin pulses detuned by +-`cents` (a slightly chorused, glassier pulse than a square), through a low-pass gliding from `cut[0]` to `cut[1]`
 * over `sweep` seconds, under a percussive envelope. The confirm / cancel voice.
 */
function twin(ctx: Ctx, o: { freq: number; dur: number; decay: number; cut: [number, number]; sweep: number; cents?: number; attack?: number }): Float32Array {
  const c = 2 ** ((o.cents ?? 6) / 1200);
  const a = pulse(ctx, o.freq * c, o.dur, 0.3);
  const b = pulse(ctx, o.freq / c, o.dur, 0.3);
  for (let i = 0; i < a.length; i++) a[i] = (a[i]! + b[i]!) * 0.5;
  const f = lp(ctx, a, glide(o.cut[0], o.cut[1], o.sweep), 0.75);
  return mul(f, perc(ctx, o.attack ?? 0.0015, o.decay, o.dur));
}

/** A mono signal moving across the stereo field from `from` to `to` (equal power): a panel sliding past. */
function panSweep(sig: Float32Array, from: number, to: number): Stereo {
  const n = sig.length;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const [gl, gr] = panGains(from + ((to - from) * i) / Math.max(1, n - 1));
    l[i] = sig[i]! * gl;
    r[i] = sig[i]! * gr;
  }
  return { l, r };
}

/**
 * A quantized pitch run: one continuous oscillator stepping through `notes` (`step` s each), through a low-pass moving from `cut[0]` to `cut[1]`,
 * each step re-accented so the steps read as discrete. `rise` swells into the last note (unfolding) instead of falling from the first (folding).
 * The grid's "unfold / fold" gesture (open, close, delete, success).
 */
function run(
  ctx: Ctx,
  o: { notes: readonly number[]; step: number; dur: number; pw?: number; cut: [number, number]; decay?: number; rise?: boolean },
): Float32Array {
  const s = pulse(ctx, steps(o.notes, o.step), o.dur, o.pw ?? 0.35);
  const f = lp(ctx, s, glide(o.cut[0], o.cut[1], o.step * o.notes.length), 0.8);
  const top = o.step * (o.notes.length - 1);
  const shape = o.rise
    ? env(ctx, [[0, 0], [0.002, 0.4], [top, 1], [top + 0.01, 0.8], [o.dur, 0]], o.dur, 'exp')
    : perc(ctx, 0.002, o.decay ?? o.dur, o.dur);
  const runEnd = o.step * o.notes.length;
  for (let i = 0; i < f.length; i++) {
    const t = i / ctx.sr;
    const x = t % o.step;
    const accent = t < runEnd ? 0.72 + 0.28 * (x < 0.0015 ? x / 0.0015 : Math.exp(-(x - 0.0015) / 0.007)) : 0.72;
    f[i] = f[i]! * shape[i]! * accent;
  }
  return f;
}

/** A soft held tone with a gentle attack and an exponential release (a sine or triangle "body" under a chime). */
function tone(ctx: Ctx, wave: Wave, freq: number, dur: number, attack = 0.004): Float32Array {
  return mul(osc(ctx, wave, freq, dur), env(ctx, [[0, 0], [attack, 1], [dur * 0.3, 0.5], [dur, 0]], dur, 'exp'));
}

/**
 * The deck check reading the list: five quiet sine data blips climbing D6 E6 G6 A6 D7 (notes shared by D minor and D major, so the verdict decides
 * the mode), sweeping left to right. The shared prefix of deck.legal and deck.illegal.
 */
function deckScan(ctx: Ctx): Stereo {
  const notes = ['D6', 'E6', 'G6', 'A6', 'D7'].map(hz);
  const m = new Mix(ctx, 0.16);
  notes.forEach((f, k) => {
    m.add(blip(ctx, { freq: f, dur: 0.022, wave: 'sine', attack: 0.0015, decay: 0.018 }), { at: k * 0.028, gain: 0.5 + k * 0.08, pan: -0.5 + k * 0.25 });
  });
  return m.out();
}

/** Two oscillators summed (a dyad), half level each. */
function dyad(ctx: Ctx, wave: Wave, a: number, b: number, dur: number): Float32Array {
  const x = osc(ctx, wave, a, dur);
  const y = osc(ctx, wave, b, dur);
  for (let i = 0; i < x.length; i++) x[i] = (x[i]! + y[i]!) * 0.5;
  return x;
}

/** A raised-cosine fade over the last `secs` of a finished mix (in place): a short sound's room tail closes smoothly instead of being cut. */
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
 * An FM bell: ratio 3.5 (bright, slightly inharmonic), the index falling fast from `index` to 0.15 so the metallic sidebands are only the strike, then
 * low-passed at 6 kHz so it shines without piercing.
 */
function bell(ctx: Ctx, freq: number, dur: number, index = 1.3): Float32Array {
  const s = mul(fm(ctx, freq, dur, { ratio: 3.5, index: glide(index, 0.15, dur * 0.35, 'exp') }), perc(ctx, 0.001, dur, dur));
  return lp(ctx, s, 6000, 0.7);
}

// ---- recipes ------------------------------------------------------------------------------------------------------------------------

export const UI_SOUNDS: Partial<Record<SoundId, Recipe>> = {
  'ui.hover': (ctx) => {
    // The faintest pip of light: a 25 ms crystal glint (the set's glass voice, dimmed) over a whisper of sine; the variants stay within a tone of A6
    // (G6, A6, Bb6) so a sweep across buttons is a shimmer of one note, not a melody. No noise contact (that belongs to the click).
    const f = [hz('A6'), hz('Bb6'), hz('G6')][ctx.variant % 3]!;
    const m = new Mix(ctx, 0.045);
    m.add(crystal(ctx, { freq: f, dur: 0.025, bright: 0.3 }), { gain: 0.7, send: 0.1 });
    m.add(blip(ctx, { freq: f, dur: 0.03, wave: 'sine', attack: 0.0025, decay: 0.024 }), { gain: 0.3 });
    return fadeTail(ctx, m.out({ space: SPACE.ui }), 0.012);
  },

  'ui.click': (ctx) => {
    // A neutral "tk-bip": a 3 ms noise contact, then a thin pulse that snaps down one scale step in 8 ms (D7 -> C7; the variants C7 -> Bb6, and D7 with a
    // softer contact: two semitones of spread) over a small D5 sine body. No falling fourth: that gesture belongs to deck.remove.
    const v = ctx.variant % 3;
    const [top, end] = (v === 1 ? ['C7', 'Bb6'] : ['D7', 'C7']).map(hz) as [number, number];
    const m = new Mix(ctx, 0.08);
    m.add(tick(ctx, { freq: v === 2 ? 5000 : 6000, dur: 0.003 }), { gain: v === 2 ? 0.4 : 0.5 });
    m.add(pip(ctx, { freq: glide(top, end, 0.008), dur: 0.045, pw: 0.25, decay: 0.036, cutoff: 4500 }), { gain: 0.55, send: 0.1 });
    m.add(blip(ctx, { freq: hz('D5'), dur: 0.02, wave: 'sine', decay: 0.016 }), { gain: 0.3 });
    return fadeTail(ctx, m.out({ space: SPACE.ui }), 0.02);
  },

  'ui.confirm': (ctx) => {
    // "Yes": two notes rising a fourth (A5 -> D6), each a pair of thin pulses detuned +-6 cents through a low-pass gliding 5 kHz -> 2 kHz (a glassy
    // pluck rather than a chiptune square), quiet sine sub-octaves, a D7 glint on the arrival and a short ping-pong echo.
    const m = new Mix(ctx, 0.3);
    [hz('A5'), hz('D6')].forEach((f, k) => {
      const at = k * 0.055;
      m.add(twin(ctx, { freq: f, dur: 0.11, decay: 0.1, cut: [5000, 2000], sweep: 0.08 }), { at, gain: 0.36, pan: k ? 0.12 : -0.12, send: 0.2 });
      m.add(blip(ctx, { freq: f / 2, dur: 0.09, wave: 'sine', decay: 0.08 }), { at, gain: 0.28 });
    });
    m.add(crystal(ctx, { freq: hz('D7'), dur: 0.12, bright: 0.3 }), { at: 0.055, gain: 0.08, send: 0.3 });
    m.add(tick(ctx, { freq: 5000, dur: 0.003 }), { gain: 0.32 });
    return m.out({ space: SPACE.ui, echo: { time: 0.075, feedback: 0.22, mix: 0.16, pingpong: true, damp: 4000 } });
  },

  'ui.cancel': (ctx) => {
    // "Back": the mirror of confirm, softer and darker. The same twin-pulse voice falls a fifth (A5 -> D5, settling home); the second note's low-pass
    // closes 3.2 kHz -> 1.3 kHz and only that note feeds one short, dim echo, so it recedes rather than stops.
    const m = new Mix(ctx, 0.25);
    m.add(twin(ctx, { freq: hz('A5'), dur: 0.08, decay: 0.07, cut: [3600, 2400], sweep: 0.06, attack: 0.002 }), { gain: 0.42, pan: 0.1 });
    m.add(blip(ctx, { freq: hz('A4'), dur: 0.06, wave: 'sine', decay: 0.05 }), { gain: 0.16 });
    const second = twin(ctx, { freq: hz('D5'), dur: 0.12, decay: 0.11, cut: [3200, 1300], sweep: 0.06, attack: 0.002 });
    m.add(second, { at: 0.06, gain: 0.4, pan: -0.1, send: 0.35 });
    m.add(blip(ctx, { freq: hz('D4'), dur: 0.08, wave: 'sine', decay: 0.07 }), { at: 0.06, gain: 0.18 });
    m.add(tick(ctx, { freq: 3800, dur: 0.003 }), { gain: 0.2 });
    return m.out({ space: SPACE.ui, echo: { time: 0.06, feedback: 0.15, mix: 0.28, damp: 2500 } });
  },

  'ui.toggleOn': (ctx) => {
    // A relay closes: a contact tick, then a thin pulse steps up a fifth (D6 -> A6) and latches with a second, brighter tick.
    const m = new Mix(ctx, 0.13);
    m.add(tick(ctx, { freq: 4200, dur: 0.003 }), { gain: 0.4 });
    m.add(pip(ctx, { freq: hz('D6'), dur: 0.034, pw: 0.3, decay: 0.03, cutoff: 3800 }), { gain: 0.32, pan: -0.08, send: 0.06 });
    m.add(pip(ctx, { freq: hz('A6'), dur: 0.07, pw: 0.3, decay: 0.06, cutoff: 5200 }), { at: 0.03, gain: 0.34, pan: 0.08, send: 0.08 });
    m.add(blip(ctx, { freq: hz('D5'), dur: 0.05, wave: 'sine', decay: 0.04 }), { at: 0.03, gain: 0.22 });
    m.add(tick(ctx, { freq: 6500, dur: 0.002 }), { at: 0.03, gain: 0.25 });
    return fadeTail(ctx, m.out({ space: SPACE.ui }), 0.03);
  },

  'ui.toggleOff': (ctx) => {
    // The mirror: the same thin pulse steps down a fifth (A6 -> D6) and closes darker, the latch tick lower.
    const m = new Mix(ctx, 0.13);
    m.add(tick(ctx, { freq: 4200, dur: 0.003 }), { gain: 0.4 });
    m.add(pip(ctx, { freq: hz('A6'), dur: 0.034, pw: 0.3, decay: 0.03, cutoff: 3800 }), { gain: 0.3, pan: 0.08, send: 0.06 });
    m.add(pip(ctx, { freq: hz('D6'), dur: 0.07, pw: 0.3, decay: 0.055, cutoff: 2400 }), { at: 0.03, gain: 0.36, pan: -0.08, send: 0.08 });
    m.add(blip(ctx, { freq: hz('D5'), dur: 0.05, wave: 'sine', decay: 0.04 }), { at: 0.03, gain: 0.18 });
    m.add(tick(ctx, { freq: 2600, dur: 0.003 }), { at: 0.03, gain: 0.25 });
    return fadeTail(ctx, m.out({ space: SPACE.ui }), 0.03);
  },

  'ui.select': (ctx) => {
    // A glass tap of light: a short crystal ping on F6 over a soft F5 sine, a hair of contact; one precise point (the click snaps, this rings). F6 keeps
    // it apart from the hover's A6 and the mana crystals.
    const m = new Mix(ctx, 0.11);
    m.add(tick(ctx, { freq: 7000, dur: 0.002 }), { gain: 0.22 });
    m.add(crystal(ctx, { freq: hz('F6'), dur: 0.07, bright: 0.5 }), { gain: 0.5, send: 0.12 });
    m.add(blip(ctx, { freq: hz('F5'), dur: 0.05, wave: 'sine', decay: 0.045 }), { gain: 0.3 });
    return fadeTail(ctx, m.out({ space: SPACE.ui }), 0.03);
  },

  'ui.tick': (ctx) => {
    // A soft digital detent under the click's register: a dull 2.8 kHz contact and a 14 ms thin-pulse "tk" on D6 (the variant E6) through a 3 kHz
    // low-pass with a D5 sine under it, so a slider drag is a quiet, even purr rather than a rattle.
    const f = ctx.variant ? hz('E6') : hz('D6');
    const m = new Mix(ctx, 0.035);
    m.add(tick(ctx, { freq: 2800, dur: 0.002, q: 1.5 }), { gain: 0.25 });
    m.add(pip(ctx, { freq: f, dur: 0.014, pw: 0.35, attack: 0.0012, decay: 0.012, cutoff: 3000 }), { gain: 0.4, send: 0.05 });
    m.add(blip(ctx, { freq: f / 2, dur: 0.012, wave: 'sine', decay: 0.01 }), { gain: 0.18 });
    return fadeTail(ctx, m.out({ space: SPACE.ui }), 0.01);
  },

  'ui.type': (ctx) => {
    // A faint terminal keystroke: a short noise contact and a tiny low-passed square "thock" on D5 or F5; the four variants vary the contact and the
    // filter more than the note, so typing stays percussive, not melodic.
    const v = ctx.variant % 4;
    const note = v % 2 ? hz('F5') : hz('D5');
    const m = new Mix(ctx, 0.03);
    m.add(tick(ctx, { freq: [3000, 3400, 2600, 3800][v]!, dur: 0.003, q: 1.6 }), { gain: 0.5 });
    m.add(blip(ctx, { freq: note, dur: 0.012, wave: 'square', decay: 0.01, cutoff: [2200, 2000, 2600, 1800][v]! }), { gain: 0.25, send: 0.04 });
    return m.out({ space: SPACE.ui });
  },

  'ui.navigate': (ctx) => {
    // A panel of the grid slides across (a band-passed noise sweep travelling left to right, a light-cycle tone stepping up D4 A4 D5 under it)
    // and lands in place: a pulse "thunk" on that D5, a contact tick and a high glint, with a short ping-pong echo. (Back plays it mirrored.)
    const m = new Mix(ctx, 0.4);
    const sd = 0.15;
    const slide = whoosh(ctx, { dur: sd, from: 800, to: 5000, q: 1.5, peak: 0.8 });
    m.addStereo(panSweep(slide, -0.6, 0.4), { gain: 0.36, send: 0.2 });
    const cycle = lp(ctx, osc(ctx, 'triangle', steps([hz('D4'), hz('A4'), hz('D5')], sd * 0.3), sd), 2500, 0.7);
    mul(cycle, env(ctx, [[0, 0], [sd * 0.75, 1], [sd, 0]], sd, 'lin'));
    m.addStereo(panSweep(cycle, -0.5, 0.3), { gain: 0.2, send: 0.1 });
    const land = sd - 0.01;
    m.add(tick(ctx, { freq: 3800, dur: 0.003 }), { at: land, gain: 0.35, pan: 0.3 });
    m.add(pip(ctx, { freq: hz('D5'), dur: 0.1, pw: 0.4, decay: 0.09, cutoff: 2400 }), { at: land, gain: 0.32, pan: 0.2, send: 0.2 });
    m.add(blip(ctx, { freq: hz('D4'), dur: 0.09, wave: 'sine', decay: 0.08 }), { at: land, gain: 0.3 });
    m.add(crystal(ctx, { freq: hz('A6'), dur: 0.16, bright: 0.4 }), { at: land, gain: 0.12, pan: 0.35, send: 0.4 });
    return m.out({ space: SPACE.ui, echo: { time: 0.085, feedback: 0.25, mix: 0.22, pingpong: true, damp: 4500 } });
  },

  'ui.open': (ctx) => {
    // The panel deploys: a thin pulse climbs D5 -> A5 -> D6 -> A6 in quantized steps, swelling as its filter opens, over a faint rising air; the top
    // note is re-struck with a contact tick, a bright pip and a crystal glint (the panel locks open) and rings on a short ping-pong echo.
    const m = new Mix(ctx, 0.32);
    const notes = [hz('D5'), hz('A5'), hz('D6'), hz('A6')];
    const step = 0.026;
    const top = step * 3;
    m.add(run(ctx, { notes, step, dur: 0.2, cut: [1000, 5500], rise: true }), { gain: 0.38, send: 0.22 });
    m.add(whoosh(ctx, { dur: 0.09, from: 1200, to: 5000, q: 1.2, peak: 0.85 }), { gain: 0.14, send: 0.15 });
    m.add(tick(ctx, { freq: 5200, dur: 0.002 }), { at: top, gain: 0.3, pan: 0.15 });
    m.add(pip(ctx, { freq: hz('A6'), dur: 0.05, pw: 0.25, decay: 0.045, cutoff: 6000 }), { at: top, gain: 0.16, pan: 0.15, send: 0.2 });
    m.add(crystal(ctx, { freq: hz('A6'), dur: 0.14, bright: 0.35 }), { at: top, gain: 0.14, pan: 0.2, send: 0.35 });
    m.add(tick(ctx, { freq: 4500, dur: 0.002 }), { gain: 0.15 });
    return m.out({ space: SPACE.ui, echo: { time: 0.07, feedback: 0.2, mix: 0.16, pingpong: true, damp: 4000 } });
  },

  'ui.close': (ctx) => {
    // The mirror: the same pulse folds down A6 -> D6 -> A5 -> D5 while its filter closes, over a falling air, and latches with a low tick.
    const m = new Mix(ctx, 0.28);
    const notes = [hz('A6'), hz('D6'), hz('A5'), hz('D5')];
    m.add(run(ctx, { notes, step: 0.024, dur: 0.16, cut: [5000, 1100], decay: 0.2 }), { gain: 0.4, send: 0.06 });
    m.add(whoosh(ctx, { dur: 0.09, from: 4500, to: 1100, q: 1.2, peak: 0.2 }), { gain: 0.13, send: 0.06 });
    m.add(tick(ctx, { freq: 2400, dur: 0.003 }), { at: 0.072, gain: 0.28 });
    m.add(blip(ctx, { freq: hz('D4'), dur: 0.06, wave: 'sine', decay: 0.05 }), { at: 0.072, gain: 0.17, send: 0.1 });
    return m.out({ space: SPACE.ui });
  },

  'ui.error': (ctx) => {
    // "Denied": two firm pulses of a low-passed square tritone (Bb4 + E5, both in the key) over a soft Bb3 sine body; the second pulse is darker and
    // audibly broken (5 bits, sample-and-hold 4: the grid refusing). Unmistakable without being shrill: everything sits under 2.5 kHz.
    const m = new Mix(ctx, 0.4);
    [0, 0.12].forEach((at, k) => {
      const d = 0.085;
      let s = lp(ctx, dyad(ctx, 'square', hz('Bb4'), hz('E5'), d), k ? 1200 : 2100, 0.9);
      mul(s, env(ctx, [[0, 0], [0.003, 1], [d * 0.7, 0.7], [d, 0]], d, 'lin'));
      if (k) s = lp(ctx, crush(ctx, s, 5, 4), 2500, 0.7);
      m.add(s, { at, gain: 0.5, send: 0.12 });
      m.add(mul(osc(ctx, 'sine', hz('Bb3'), d), env(ctx, [[0, 0], [0.004, 1], [d * 0.7, 0.6], [d, 0]], d, 'lin')), { at, gain: 0.22 });
      m.add(tick(ctx, { freq: 2200, dur: 0.003 }), { at, gain: 0.3 });
    });
    return m.out({ space: SPACE.ui });
  },

  'ui.notify': (ctx) => {
    // An incoming message: a double tap on one crystal note (A6, then A6 again 70 ms later and 4 dB softer, a knock on the glass) over a soft A5 sine,
    // bouncing away on a ping-pong echo. A repeated note, not a rising interval: nothing like "your move" or a toggle; and below success's D7 bell.
    const m = new Mix(ctx, 0.7);
    [0, 0.07].forEach((at, k) => {
      const g = k ? 0.63 : 1;
      m.add(crystal(ctx, { freq: hz('A6'), dur: 0.3, bright: 0.4 }), { at, gain: 0.42 * g, pan: k ? 0.15 : -0.15, send: 0.3 });
      m.add(tone(ctx, 'sine', hz('A5'), 0.16, 0.003), { at, gain: 0.26 * g });
    });
    m.add(tick(ctx, { freq: 6000, dur: 0.002 }), { gain: 0.15 });
    return m.out({ space: SPACE.ui, echo: { time: 0.13, feedback: 0.3, mix: 0.3, pingpong: true, damp: 4000 } });
  },

  'ui.success': (ctx) => {
    // "Write complete": a fast quantized pulse run (D6 A6 D7, 18 ms steps) snaps into one bright FM bell on D7 with a softer A7 bell over it, and a
    // little D-major glitter settles on the ping-pong echo. A run into a bell, not an arpeggio onto a chord (that story is deck.legal's).
    const m = new Mix(ctx, 0.85);
    const step = 0.018;
    const land = step * 2;
    m.add(run(ctx, { notes: [hz('D6'), hz('A6'), hz('D7')], step, dur: 0.07, pw: 0.3, cut: [2500, 4000], rise: true }), { gain: 0.3, pan: -0.15, send: 0.15 });
    m.add(tick(ctx, { freq: 4800, dur: 0.002 }), { gain: 0.2 });
    m.add(bell(ctx, hz('D7'), 0.4), { at: land, gain: 0.42, send: 0.35 });
    m.add(bell(ctx, hz('A7'), 0.2, 0.8), { at: land, gain: 0.07, pan: 0.25, send: 0.4 });
    m.add(tone(ctx, 'sine', hz('D6'), 0.3, 0.004), { at: land, gain: 0.12 });
    m.add(tone(ctx, 'sine', hz('D5'), 0.25, 0.004), { at: land, gain: 0.2 });
    m.add(tick(ctx, { freq: 6000, dur: 0.002 }), { at: land, gain: 0.25 });
    m.addStereo(shimmer(ctx, { dur: 0.3, density: 30, lo: 1800, hi: 5000, grain: 0.08, scale: D_MAJOR }), { at: land + 0.03, gain: 0.34, send: 0.4 });
    return m.out({ space: SPACE.ui, echo: { time: 0.11, feedback: 0.3, mix: 0.25, pingpong: true, damp: 4500 } });
  },

  'ui.delete': (ctx) => {
    // Data wiped: a pulse steps down the key (D6 A5 F5 D5 A4 F4 D4) while the bit depth and sample rate fall away, a small cloud of voxels sinking
    // with it, and a final low D: gone for good.
    const m = new Mix(ctx, 0.7);
    m.add(tick(ctx, { freq: 3500, dur: 0.004 }), { gain: 0.4 });
    const notes = ['D6', 'A5', 'F5', 'D5', 'A4', 'F4', 'D4'].map(hz);
    const r = run(ctx, { notes, step: 0.038, dur: 0.29, pw: 0.4, cut: [5000, 900], decay: 0.55 });
    m.add(crush(ctx, r, glide(12, 4, 0.27, 'lin'), glide(1, 7, 0.27, 'lin')), { gain: 0.32, send: 0.2 });
    m.addStereo(voxels(ctx, { dur: 0.3, count: 22, from: 3000, to: 350 }), { at: 0.01, gain: 0.9, send: 0.3 });
    m.add(tick(ctx, { freq: 1800, dur: 0.004 }), { at: 0.27, gain: 0.3 });
    m.add(blip(ctx, { freq: hz('D4'), dur: 0.16, wave: 'triangle', decay: 0.15, cutoff: 1500 }), { at: 0.27, gain: 0.26, send: 0.25 });
    m.add(tone(ctx, 'sine', hz('D3'), 0.2, 0.004), { at: 0.27, gain: 0.14 });
    return m.out({ space: SPACE.ui });
  },

  'deck.add': (ctx) => {
    // A card slots in: a thin pulse steps up a fourth into D6 (a 10 ms A5 pickup swelling into D6: a quantized grid step, no smear) and locks
    // there with a contact tick and a small sine "thock"; tight enough to repeat four times a second. The variant starts from G5, a touch brighter.
    const from = ctx.variant ? hz('G5') : hz('A5');
    const lock = 0.01;
    const m = new Mix(ctx, 0.14);
    const s = pip(ctx, { freq: steps([from, hz('D6')], lock), dur: 0.085, pw: 0.3, attack: 0.009, decay: 0.075, cutoff: ctx.variant ? 3300 : 2900 });
    m.add(s, { gain: 0.36, pan: 0.06, send: 0.08 });
    m.add(tick(ctx, { freq: 4600, dur: 0.003 }), { at: lock, gain: 0.36 });
    m.add(blip(ctx, { freq: hz('D5'), dur: 0.04, wave: 'sine', decay: 0.035 }), { at: lock, gain: 0.26 });
    return fadeTail(ctx, m.out({ space: SPACE.ui }), 0.025);
  },

  'deck.remove': (ctx) => {
    // The mirror: unlatched with a lower tick and the same "thock", the same pulse sits on D6 for 16 ms, then drops a fourth to A5 while its filter
    // closes to 1 kHz; darker and a little softer than the add.
    const unlock = 0.016;
    const m = new Mix(ctx, 0.14);
    m.add(tick(ctx, { freq: 3000, dur: 0.003 }), { gain: 0.3 });
    m.add(blip(ctx, { freq: hz('D5'), dur: 0.035, wave: 'sine', decay: 0.03 }), { gain: 0.24 });
    const s = pulse(ctx, steps([hz('D6'), hz('A5')], unlock), 0.09, 0.3);
    m.add(mul(lp(ctx, s, glide(3600, 1000, 0.05), 0.7), perc(ctx, 0.002, 0.08, 0.09)), { gain: 0.38, pan: -0.06, send: 0.06 });
    return fadeTail(ctx, m.out({ space: SPACE.ui }), 0.025);
  },

  'deck.legal': (ctx) => {
    // Verified: a quick data scan reads across the deck (left to right), then a clean D major crystal chord (D6 F#6 A6) is struck over a soft sine D5,
    // glinting on the ping-pong echo.
    const m = new Mix(ctx, 0.9);
    m.addStereo(deckScan(ctx), { gain: 0.3, send: 0.15 });
    const at = 0.16;
    m.add(tick(ctx, { freq: 5000, dur: 0.003 }), { at, gain: 0.3 });
    [hz('D6'), hz('F#6'), hz('A6')].forEach((f, k) => {
      m.add(crystal(ctx, { freq: f, dur: 0.55, bright: 0.4 }), { at: at + k * 0.012, gain: 0.26, pan: (k - 1) * 0.3, send: 0.35 });
    });
    m.add(tone(ctx, 'sine', hz('D5'), 0.4, 0.004), { at, gain: 0.25 });
    m.add(crystal(ctx, { freq: hz('D7'), dur: 0.35, bright: 0.3 }), { at: at + 0.04, gain: 0.1, send: 0.5 });
    return m.out({ space: SPACE.ui, echo: { time: 0.12, feedback: 0.28, mix: 0.22, pingpong: true, damp: 4500 } });
  },

  'deck.illegal': (ctx) => {
    // Needs attention: the same scan, then a soft "uh-oh": two triangle notes falling a minor third (F5 -> D5), the second sinking as its low-pass
    // closes 2.6 kHz -> 1.4 kHz with a short dim echo behind it; gentle attacks, no grit, no buzz (softer than an error).
    const m = new Mix(ctx, 0.7);
    m.addStereo(deckScan(ctx), { gain: 0.3, send: 0.1 });
    const at = 0.17;
    m.add(blip(ctx, { freq: hz('F5'), dur: 0.14, wave: 'triangle', attack: 0.004, decay: 0.13, cutoff: 2600 }), { at, gain: 0.5, send: 0.15 });
    m.add(blip(ctx, { freq: hz('F4'), dur: 0.12, wave: 'sine', attack: 0.008, decay: 0.11 }), { at, gain: 0.22 });
    const second = blip(ctx, { freq: hz('D5'), dur: 0.2, wave: 'triangle', attack: 0.004, decay: 0.18, cutoff: glide(2600, 1400, 0.12) });
    m.add(second, { at: at + 0.11, gain: 0.5, send: 0.3 });
    // The glass verdict voice shared with deck.legal, faint (about -14 dB): the same crystals, telling a different story.
    m.add(crystal(ctx, { freq: hz('F6'), dur: 0.25, bright: 0.3 }), { at, gain: 0.1, pan: 0.15, send: 0.3 });
    m.add(crystal(ctx, { freq: hz('D6'), dur: 0.3, bright: 0.3 }), { at: at + 0.11, gain: 0.1, pan: -0.15, send: 0.3 });
    m.add(blip(ctx, { freq: hz('D4'), dur: 0.16, wave: 'sine', attack: 0.008, decay: 0.15 }), { at: at + 0.11, gain: 0.22 });
    return m.out({ space: SPACE.ui, echo: { time: 0.09, feedback: 0.2, mix: 0.3, damp: 3000 } });
  },
};
