/**
 * Measurements of a rendered sound (docs/design/sound.md "Checks"): loudness (ITU-R BS.1770 K-weighting), peak, how long it is audible, attack,
 * brightness, where its energy sits, how tonal it is and the pitch it follows. `master` (dsp.ts) levels every sound with `loudness100`; the tests
 * check the set with the rest, and scripts/sound/render.ts writes them into the sound report.
 */

export interface StereoLike {
  l: Float32Array;
  r: Float32Array;
}

/** K-weighting (BS.1770-4) at any sample rate: a high shelf (+4 dB above about 1.7 kHz) and a 38 Hz high-pass, as in pyloudnorm. */
function kWeight(x: Float32Array, sr: number): Float32Array {
  // Stage 1, high shelf.
  let K = Math.tan((Math.PI * 1681.974450955533) / sr);
  const Vh = 10 ** (3.999843853973347 / 20);
  const Vb = Vh ** 0.4996667741545416;
  let Q = 0.7071752369554196;
  let a0 = 1 + K / Q + K * K;
  const s1 = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  // Stage 2, high-pass.
  K = Math.tan((Math.PI * 38.13547087602444) / sr);
  Q = 0.5003270373238773;
  a0 = 1 + K / Q + K * K;
  const s2 = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  const run = (inp: Float32Array, c: typeof s2): Float32Array => {
    const out = new Float32Array(inp.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < inp.length; i++) {
      const x0 = inp[i]!;
      let y = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      // Denormals in a decaying state are very slow (dsp.ts TINY).
      if (y < 1e-25 && y > -1e-25) y = 0;
      out[i] = y;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y;
    }
    return out;
  };
  return run(run(x, s1), s2);
}

/** A 4th-order Butterworth high-pass (two biquads): what a laptop or phone speaker leaves of a sound (they play little below ~200 Hz). */
export function highpass4(x: Float32Array, sr: number, fc = 200): Float32Array {
  let y = x;
  for (const q of [0.5412, 1.3066]) {
    const w = (2 * Math.PI * fc) / sr;
    const cw = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    const b0 = (1 + cw) / 2 / a0;
    const b1 = -(1 + cw) / a0;
    const a1 = (-2 * cw) / a0;
    const a2 = (1 - alpha) / a0;
    const out = new Float32Array(y.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < y.length; i++) {
      const x0 = y[i]!;
      let v = b0 * x0 + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
      if (v < 1e-25 && v > -1e-25) v = 0;
      out[i] = v;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = v;
    }
    y = out;
  }
  return y;
}

/** Loudest K-weighted loudness over a sliding window (LUFS); a sound shorter than the window counts its silence too. */
export function maxLoudness(st: StereoLike, sr: number, window: number): number {
  const kl = kWeight(st.l, sr);
  const kr = kWeight(st.r, sr);
  const n = kl.length;
  const w = Math.max(1, Math.round(window * sr));
  const hop = Math.max(1, Math.round(0.005 * sr));
  // Prefix sums of the squares.
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i]! + kl[i]! * kl[i]! + kr[i]! * kr[i]!;
  let best = 0;
  for (let start = 0; start === 0 || start + w <= n; start += hop) {
    const end = Math.min(n, start + w);
    best = Math.max(best, (pre[end]! - pre[start]!) / w);
    if (end === n) break;
  }
  return best > 0 ? -0.691 + 10 * Math.log10(best) : -Infinity;
}

/** Loudness of the loudest 100 ms (what `master` levels): short sounds are judged on their body, not on the silence around them. */
export function loudness100(st: StereoLike, sr: number): number {
  return maxLoudness(st, sr, 0.1);
}

/** BS.1770 momentary loudness: the loudest 400 ms. */
export function loudness400(st: StereoLike, sr: number): number {
  return maxLoudness(st, sr, 0.4);
}

// ---- spectrum -------------------------------------------------------------------------------------------------------------------

/** In-place radix-2 complex FFT (re, im of a power-of-two length). */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const ang = (-2 * Math.PI) / size;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let start = 0; start < n; start += size) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < size / 2; k++) {
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/**
 * Power spectrum (|X|², bins 0..fftSize/2) of `size` samples from `start`, Hann-windowed and zero-padded to `fftSize` (a finer grid of bins: peaks
 * are located more precisely, the resolution stays that of the window).
 */
export function powerSpectrum(x: Float32Array, start: number, size: number, fftSize = size): Float64Array {
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  for (let i = 0; i < size; i++) {
    const v = x[start + i] ?? 0;
    re[i] = v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  fft(re, im);
  const out = new Float64Array(fftSize / 2 + 1);
  for (let k = 0; k <= fftSize / 2; k++) out[k] = re[k]! * re[k]! + im[k]! * im[k]!;
  return out;
}

/** Frequency of the peak at bin `k`, refined by parabolic interpolation of the log magnitudes around it. */
function refine(p: Float64Array, k: number, binHz: number): number {
  const a = Math.log((p[k - 1] ?? 0) + 1e-30);
  const b = Math.log(p[k]! + 1e-30);
  const c = Math.log((p[k + 1] ?? 0) + 1e-30);
  const d = a - 2 * b + c;
  const off = d !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d)) : 0;
  return (k + off) * binHz;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** "A4" (+ cents) for a frequency. */
export function noteName(hz: number): string {
  if (!(hz > 0)) return '-';
  const m = 69 + 12 * Math.log2(hz / 440);
  const r = Math.round(m);
  const cents = Math.round((m - r) * 100);
  return `${NOTE_NAMES[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1}${Math.abs(cents) >= 15 ? (cents > 0 ? `+${cents}c` : `${cents}c`) : ''}`;
}

export interface PitchSegment {
  /** Start and end (seconds). */
  from: number;
  to: number;
  /** 'tone' (a steady pitch), 'glide' (moving from `hz` to `hzEnd`) or 'noise' (no clear pitch). */
  kind: 'tone' | 'glide' | 'noise';
  hz: number;
  hzEnd: number;
}

export interface Analysis {
  sampleRate: number;
  /** Buffer length (s). */
  duration: number;
  /** Until the last moment within 60 dB of the peak (s). */
  audible: number;
  peakDb: number;
  /** LUFS of the loudest 100 ms (the level `master` sets) and of the loudest 400 ms (BS.1770 momentary). */
  lufs100: number;
  lufs400: number;
  /** LUFS100 after a 200 Hz high-pass (what a laptop or phone speaker plays), and how much is lost there (dB). */
  lufs100Small: number;
  smallSpeakerLossDb: number;
  /** Peak over RMS of the audible part (dB): high = sharp transients, low = dense, sustained. */
  crestDb: number;
  /** Time until the envelope first comes within 1 dB of its maximum (ms). */
  attackMs: number;
  /** Envelope (dB re peak) at 10% steps of the audible part. */
  envelope: number[];
  /** Spectral centroid of the whole sound and at 10% steps of the audible part (Hz): how bright it is, and how that moves. */
  centroid: number;
  centroidTrack: number[];
  /** Share of the energy per band: sub <60 Hz, low 60-250, lowMid 250-1k, mid 1-3k, presence 3-6k, high 6-12k, air >12k. */
  bands: Record<'sub' | 'low' | 'lowMid' | 'mid' | 'presence' | 'high' | 'air', number>;
  /** Spectral flatness (0 = pure tones, 1 = white noise), energy-weighted over the sound. */
  flatness: number;
  /** The pitch it follows (strongest partial), as steady tones, glides and noisy stretches. */
  pitch: PitchSegment[];
  /** The strongest pitch classes over the sound with their share of the tonal energy (80-5000 Hz), e.g. "D 41% A 30% F# 18%": its chord or key. */
  chroma: string;
  /** Correlation of left and right (1 = mono, 0 = wide, < 0 = phasey). */
  stereoCorrelation: number;
  dcOffset: number;
  /** Largest sample step at the start and the end (clicks). */
  edgeStep: number;
  /** Wall time to render (ms), filled by the caller. */
  renderMs?: number;
}

const BAND_EDGES: [keyof Analysis['bands'], number, number][] = [
  ['sub', 0, 60],
  ['low', 60, 250],
  ['lowMid', 250, 1000],
  ['mid', 1000, 3000],
  ['presence', 3000, 6000],
  ['high', 6000, 12000],
  ['air', 12000, Infinity],
];

export function analyze(st: StereoLike, sr: number): Analysis {
  const n = st.l.length;
  const m = new Float32Array(n);
  let peak = 0;
  let dc = 0;
  let sll = 0;
  let srr = 0;
  let slr = 0;
  for (let i = 0; i < n; i++) {
    const a = st.l[i]!;
    const b = st.r[i]!;
    m[i] = (a + b) * 0.5;
    peak = Math.max(peak, Math.abs(a), Math.abs(b));
    dc += m[i]!;
    sll += a * a;
    srr += b * b;
    slr += a * b;
  }
  dc /= Math.max(1, n);
  const peakDb = 20 * Math.log10(peak + 1e-12);
  // Envelope: RMS over 5 ms.
  const hop = Math.max(1, Math.round(0.005 * sr));
  const envDb: number[] = [];
  for (let s = 0; s < n; s += hop) {
    let e = 0;
    const end = Math.min(n, s + hop);
    for (let i = s; i < end; i++) e += Math.max(st.l[i]! ** 2, st.r[i]! ** 2);
    envDb.push(10 * Math.log10(e / Math.max(1, end - s) + 1e-14));
  }
  const envMax = Math.max(...envDb);
  let last = 0;
  for (let k = 0; k < envDb.length; k++) if (envDb[k]! > envMax - 60) last = k;
  const audibleN = Math.min(n, (last + 1) * hop);
  const attackIdx = envDb.findIndex((v) => v >= envMax - 1);
  let sq = 0;
  for (let i = 0; i < audibleN; i++) sq += Math.max(st.l[i]! ** 2, st.r[i]! ** 2);
  const rms = Math.sqrt(sq / Math.max(1, audibleN));
  const tenth = (k: number) => Math.min(envDb.length - 1, Math.floor(((last + 1) * k) / 10));
  const envelope = Array.from({ length: 11 }, (_, k) => Math.round((envDb[tenth(k)]! - envMax) * 10) / 10);

  // Spectral frames: 21 ms windows for short sounds (timing), 43 ms for longer ones (low pitches).
  const size = audibleN / sr < 0.25 ? (sr >= 32000 ? 1024 : 512) : sr >= 32000 ? 2048 : 1024;
  const fhop = Math.max(1, Math.round(0.01 * sr));
  const frames: { t: number; p: Float64Array; e: number }[] = [];
  for (let s = -size / 2; s < audibleN - size / 4; s += fhop) {
    const p = powerSpectrum(m, s, size);
    let e = 0;
    for (let k = 1; k < p.length; k++) e += p[k]!;
    frames.push({ t: (s + size / 2) / sr, p, e });
  }
  const binHz = sr / size;
  const bands: Analysis['bands'] = { sub: 0, low: 0, lowMid: 0, mid: 0, presence: 0, high: 0, air: 0 };
  let total = 0;
  let cNum = 0;
  let flatNum = 0;
  const centroidAt: { t: number; c: number; e: number }[] = [];
  const pitchFrames: { t: number; hz: number; conf: number; e: number }[] = [];
  const chroma = new Float64Array(12);
  const eMax = Math.max(1e-30, ...frames.map((f) => f.e));
  for (const f of frames) {
    if (f.e < eMax * 1e-6) {
      pitchFrames.push({ t: f.t, hz: 0, conf: 0, e: f.e });
      continue;
    }
    let c = 0;
    let logSum = 0;
    let cnt = 0;
    let best = 0;
    let bestK = 0;
    for (let k = 1; k < f.p.length; k++) {
      const v = f.p[k]!;
      const hz = k * binHz;
      c += hz * v;
      for (const [name, lo, hi] of BAND_EDGES) if (hz >= lo && hz < hi) bands[name] = bands[name]! + v;
      if (hz < 16000) {
        logSum += Math.log(v + 1e-20);
        cnt++;
      }
      if (hz >= 40 && hz <= 10000 && v > best) {
        best = v;
        bestK = k;
      }
    }
    total += f.e;
    cNum += c;
    const mean = f.e / Math.max(1, f.p.length - 1);
    flatNum += (Math.exp(logSum / Math.max(1, cnt)) / Math.max(1e-30, mean)) * f.e;
    centroidAt.push({ t: f.t, c: c / f.e, e: f.e });
    // Pitch and pitch classes from the same samples zero-padded 8x: the strongest peak (confidence: share of the frame's energy around it) and every
    // clear peak (within 30 dB of the strongest, 80 Hz - 5 kHz) for the chroma. Noise spreads evenly and adds little.
    const fine = powerSpectrum(m, Math.round(f.t * sr - size / 2), size, size * 8);
    const fineHz = sr / (size * 8);
    let fb = 0;
    let fk = 0;
    for (let k = 1; k < fine.length - 1; k++) {
      const hz = k * fineHz;
      if (hz >= 40 && hz <= 10000 && fine[k]! > fb) {
        fb = fine[k]!;
        fk = k;
      }
    }
    let near = 0;
    for (let k = bestK - 2; k <= bestK + 2; k++) near += f.p[k] ?? 0;
    pitchFrames.push({ t: f.t, hz: fk > 0 ? refine(fine, fk, fineHz) : 0, conf: near / f.e, e: f.e });
    const floor = fb * 1e-3;
    for (let k = 1; k < fine.length - 1; k++) {
      const v = fine[k]!;
      if (v < floor || v <= fine[k - 1]! || v < fine[k + 1]!) continue;
      const hz = refine(fine, k, fineHz);
      if (hz < 80 || hz > 5000) continue;
      const pc = (((Math.round(69 + 12 * Math.log2(hz / 440)) % 12) + 12) % 12);
      chroma[pc] = chroma[pc]! + v;
    }
  }
  for (const k of Object.keys(bands) as (keyof Analysis['bands'])[]) bands[k] = Math.round((bands[k] / Math.max(1e-30, total)) * 1000) / 1000;
  const audibleS = audibleN / sr;
  const centroidTrack = Array.from({ length: 11 }, (_, k) => {
    const t = (audibleS * k) / 10;
    let bestF: { c: number } | undefined;
    let bestD = Infinity;
    for (const f of centroidAt) {
      const d = Math.abs(f.t - t);
      if (d < bestD && f.e > eMax * 1e-4) {
        bestD = d;
        bestF = f;
      }
    }
    return Math.round(bestF?.c ?? 0);
  });

  const small = loudness100({ l: highpass4(st.l, sr), r: highpass4(st.r, sr) }, sr);
  return {
    sampleRate: sr,
    duration: n / sr,
    audible: Math.round(audibleS * 1000) / 1000,
    peakDb: Math.round(peakDb * 10) / 10,
    lufs100: Math.round(loudness100(st, sr) * 10) / 10,
    lufs400: Math.round(loudness400(st, sr) * 10) / 10,
    lufs100Small: Math.round(small * 10) / 10,
    smallSpeakerLossDb: Math.round((loudness100(st, sr) - small) * 10) / 10,
    crestDb: Math.round(20 * Math.log10((peak + 1e-12) / (rms + 1e-12)) * 10) / 10,
    attackMs: attackIdx < 0 ? 0 : attackIdx * 5,
    envelope,
    centroid: Math.round(cNum / Math.max(1e-30, total)),
    centroidTrack,
    bands,
    flatness: Math.round((flatNum / Math.max(1e-30, total)) * 1000) / 1000,
    pitch: pitchSegments(pitchFrames, eMax),
    chroma: chromaText(chroma),
    stereoCorrelation: Math.round((slr / Math.sqrt(sll * srr + 1e-30)) * 100) / 100,
    dcOffset: dc,
    edgeStep: Math.max(Math.abs(m[0] ?? 0), Math.abs((m[1] ?? 0) - (m[0] ?? 0)), Math.abs(m[n - 1] ?? 0), Math.abs((m[n - 1] ?? 0) - (m[n - 2] ?? 0))),
  };
}

function chromaText(c: Float64Array): string {
  const total = c.reduce((a, b) => a + b, 0);
  if (total <= 0) return '';
  return [...c]
    .map((v, k) => ({ k, share: v / total }))
    .sort((a, b) => b.share - a.share)
    .filter((x, i) => i < 4 && x.share >= 0.06)
    .map((x) => `${NOTE_NAMES[x.k]} ${Math.round(x.share * 100)}%`)
    .join(' ');
}

/** Frames -> steady tones, glides and noisy stretches (at most 14 segments, the quiet end left out). */
function pitchSegments(frames: { t: number; hz: number; conf: number; e: number }[], eMax: number): PitchSegment[] {
  const segs: PitchSegment[] = [];
  const semis = (hz: number) => 12 * Math.log2(hz / 440);
  for (const f of frames) {
    if (f.e < eMax * 1e-4) continue;
    const tonal = f.conf >= 0.3 && f.hz > 0;
    const prev = segs[segs.length - 1];
    if (!tonal) {
      if (prev && prev.kind === 'noise') prev.to = f.t;
      else segs.push({ from: f.t, to: f.t, kind: 'noise', hz: 0, hzEnd: 0 });
      continue;
    }
    if (prev && prev.kind !== 'noise') {
      const d = semis(f.hz) - semis(prev.hzEnd);
      if (Math.abs(d) < 0.5) {
        prev.to = f.t;
        prev.hzEnd = f.hz;
        continue;
      }
      // Moving steadily in one direction by small steps: a glide.
      if (Math.abs(d) < 4 && (prev.kind === 'glide' ? Math.sign(semis(prev.hzEnd) - semis(prev.hz)) === Math.sign(d) : prev.to - prev.from < 0.025)) {
        prev.kind = 'glide';
        prev.to = f.t;
        prev.hzEnd = f.hz;
        continue;
      }
    }
    segs.push({ from: f.t, to: f.t, kind: 'tone', hz: f.hz, hzEnd: f.hz });
  }
  // Merge tiny segments into their neighbours so the description stays readable.
  const merged: PitchSegment[] = [];
  for (const s of segs) {
    const prev = merged[merged.length - 1];
    if (prev && s.to - s.from < 0.012 && prev.kind === s.kind) prev.to = s.to;
    else merged.push({ ...s });
  }
  return merged.slice(0, 14).map((s) => ({ ...s, from: Math.round(s.from * 1000) / 1000, to: Math.round(s.to * 1000) / 1000, hz: Math.round(s.hz), hzEnd: Math.round(s.hzEnd) }));
}

/** A one-line description of the pitch track: "D5 0-40ms > glide A5->D4 40-300ms > noise 300-420ms". */
export function describePitch(segs: readonly PitchSegment[]): string {
  return segs
    .map((s) => {
      const span = `${Math.round(s.from * 1000)}-${Math.round(s.to * 1000)}ms`;
      if (s.kind === 'noise') return `noise ${span}`;
      if (s.kind === 'glide') return `glide ${noteName(s.hz)}->${noteName(s.hzEnd)} ${span}`;
      return `${noteName(s.hz)} ${span}`;
    })
    .join(' > ');
}
