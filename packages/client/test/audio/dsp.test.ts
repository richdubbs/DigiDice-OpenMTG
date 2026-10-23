/** The synthesizer's building blocks (audio/dsp.ts) and measurements (audio/analysis.ts): pitch, filtering, levels, stability, determinism. */
import { describe, expect, it } from 'vitest';
import { analyze, loudness100, noteName, powerSpectrum } from '../../src/audio/analysis';
import { crush, echo, env, fm, lp, makeCtx, master, Mix, modes, mono, noise, osc, perc, pluck, reverb, svf } from '../../src/audio/dsp';
import { degree, hz, SPACE } from '../../src/audio/palette';

const SR = 48000;

function peakHz(x: Float32Array, sr = SR): number {
  const size = 8192;
  const p = powerSpectrum(x, Math.max(0, Math.floor(x.length / 2 - size / 2)), size);
  let best = 1;
  for (let k = 1; k < p.length; k++) if (p[k]! > p[best]!) best = k;
  return (best * sr) / size;
}

function rms(x: Float32Array): number {
  let s = 0;
  for (const v of x) s += v * v;
  return Math.sqrt(s / x.length);
}

describe('oscillators', () => {
  const ctx = makeCtx(SR, 1);
  it.each(['sine', 'triangle', 'saw', 'square', 'pulse'] as const)('%s plays its frequency', (wave) => {
    const x = osc(ctx, wave, 440, 0.5);
    expect(Math.abs(peakHz(x) - 440)).toBeLessThan(6);
    expect(Math.max(...x.map(Math.abs))).toBeLessThan(1.2);
  });
  it('FM with an integer ratio stays harmonic around its carrier', () => {
    expect(Math.abs(peakHz(fm(ctx, 220, 0.5, { ratio: 1, index: 0.5 })) - 220)).toBeLessThan(6);
  });
  it('modal resonators and plucks ring at their pitch and fade', () => {
    const m = modes(ctx, 1000, 1, [1], [0.5]);
    expect(Math.abs(peakHz(m) - 1000)).toBeLessThan(6);
    expect(Math.abs(m[0]!)).toBeLessThan(1e-6);
    expect(rms(m.subarray(SR * 0.6))).toBeLessThan(rms(m.subarray(0, SR * 0.1)) / 10);
    const p = pluck(makeCtx(SR, 2), 220, 1, { decay: 0.5 });
    expect(Math.abs(peakHz(p) - 220)).toBeLessThan(8);
  });
});

describe('filters and effects', () => {
  const ctx = makeCtx(SR, 3);
  it('the low-pass keeps the lows and removes the highs', () => {
    const lo = osc(ctx, 'sine', 200, 0.3);
    const hi = osc(ctx, 'sine', 8000, 0.3);
    expect(rms(lp(ctx, lo, 1000))).toBeGreaterThan(0.65);
    expect(rms(lp(ctx, hi, 1000))).toBeLessThan(0.03);
  });
  it('the band-pass has unity gain at its centre and stays stable under a fast sweep', () => {
    const x = osc(ctx, 'sine', 1000, 0.3);
    expect(rms(svf(ctx, x, 'bp', 1000, 2).subarray(SR * 0.1))).toBeCloseTo(Math.SQRT1_2, 1);
    const swept = svf(ctx, noise(ctx, 0.5), 'bp', (t) => 100 * 200 ** (t / 0.5), 8);
    expect(swept.every(Number.isFinite)).toBe(true);
    expect(Math.max(...swept.map(Math.abs))).toBeLessThan(4);
  });
  it('the crusher quantizes and holds', () => {
    const x = osc(ctx, 'sine', 100, 0.1);
    const c = crush(ctx, x, 3, 4);
    expect(new Set(Array.from(c, (v) => Math.round(v * 1000))).size).toBeLessThanOrEqual(9);
    expect(c[1]).toBe(c[2]);
  });
  it('the reverb tail decays and stays finite (an impulse in each room)', () => {
    for (const space of Object.values(SPACE)) {
      const imp = new Float32Array(Math.round(SR * (space.decay + 0.5)));
      imp[0] = 1;
      const wet = reverb(ctx, mono(imp), space);
      expect(wet.l.every(Number.isFinite)).toBe(true);
      const early = rms(wet.l.subarray(Math.round(SR * 0.05), Math.round(SR * 0.15)));
      const late = rms(wet.l.subarray(Math.round(SR * space.decay * 0.9), Math.round(SR * space.decay)));
      expect(early).toBeGreaterThan(0);
      // About 60 dB down at the decay time: allow a wide margin (modulated, damped lines).
      expect(late / early).toBeLessThan(0.05);
    }
  });
  it('the echo repeats at its time', () => {
    const imp = new Float32Array(SR / 2);
    imp[0] = 1;
    const e = echo(ctx, mono(imp), { time: 0.1, feedback: 0.5, mix: 1 });
    expect(Math.abs(e.l[Math.round(SR * 0.1)]!)).toBeGreaterThan(0.3);
  });
});

describe('levels', () => {
  it('master sets the loudness of the loudest 100 ms and never clips', () => {
    const ctx = makeCtx(SR, 4);
    const tone = osc(ctx, 'saw', 220, 0.5);
    for (const target of [-30, -20, -14]) {
      const out = master(ctx, mono(tone.slice()), { lufs: target });
      expect(loudness100(out, SR)).toBeCloseTo(target, 0);
      expect(Math.max(...out.l.map(Math.abs))).toBeLessThanOrEqual(10 ** (-1 / 20) + 1e-6);
    }
    // A spike cannot reach a loud target: it stops at the peak limit instead.
    const spike = new Float32Array(SR / 10);
    spike[100] = 1;
    const out = master(ctx, mono(spike), { lufs: -5 });
    expect(Math.max(...out.l.map(Math.abs))).toBeCloseTo(10 ** (-1 / 20), 3);
  });
  it('the mix pans with equal power and sends to the room', () => {
    const ctx = makeCtx(SR, 5);
    const m = new Mix(ctx, 0.2);
    m.add(osc(ctx, 'sine', 300, 0.1), { pan: -1, send: 0.5 });
    expect(rms(m.dry.r)).toBeLessThan(1e-6);
    expect(rms(m.send.l)).toBeGreaterThan(0);
    const out = m.out({ space: SPACE.ui });
    expect(rms(out.r)).toBeGreaterThan(0);
  });
});

describe('determinism and pitch helpers', () => {
  it('the same seed and variant give the same noise; another variant differs', () => {
    expect(noise(makeCtx(SR, 9, 0), 0.01)).toEqual(noise(makeCtx(SR, 9, 0), 0.01));
    expect(noise(makeCtx(SR, 9, 1), 0.01)).not.toEqual(noise(makeCtx(SR, 9, 0), 0.01));
  });
  it('notes and scale degrees', () => {
    expect(hz('A4')).toBeCloseTo(440, 6);
    expect(hz('D4')).toBeCloseTo(293.665, 2);
    expect(degree(0, 4)).toBeCloseTo(hz('D4'), 6);
    expect(degree(2, 4)).toBeCloseTo(hz('F4'), 6);
    expect(degree(7, 4)).toBeCloseTo(hz('D5'), 6);
    expect(degree(-1, 4)).toBeCloseTo(hz('C4'), 6);
    expect(noteName(440)).toBe('A4');
    expect(noteName(hz('F#5'))).toBe('F#5');
  });
  it('analysis reads envelope, pitch and brightness', () => {
    const ctx = makeCtx(SR, 6);
    const x = osc(ctx, 'sine', 880, 0.4);
    const shaped = env(ctx, [[0, 0], [0.01, 1], [0.4, 0]], 0.4);
    for (let i = 0; i < x.length; i++) x[i] = x[i]! * shaped[i]!;
    const a = analyze(mono(x), SR);
    expect(a.pitch.some((s) => s.kind === 'tone' && Math.abs(s.hz - 880) < 15)).toBe(true);
    expect(a.attackMs).toBeLessThanOrEqual(15);
    expect(a.chroma.startsWith('A ')).toBe(true);
    const n = analyze(mono(lp(ctx, noise(ctx, 0.3), 500)), SR);
    expect(n.centroid).toBeLessThan(a.centroid + 2000);
    expect(analyze(mono(noise(ctx, 0.3)), SR).flatness).toBeGreaterThan(0.3);
    expect(perc(ctx, 0.001, 0.1).length).toBe(Math.round(SR * 0.101));
  });
});
