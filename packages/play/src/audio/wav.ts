/**
 * A rendered sound as a WAV file (Godot plan phase 3: the local server hands the sounds to the Godot table, which plays them as `AudioStreamWAV`): RIFF,
 * 16-bit PCM, two channels interleaved, at the rate given. Pure (no Node `Buffer`, no DOM): the same bytes wherever it runs.
 */
import type { Stereo } from './dsp';

/** The size of the header `wavBytes` writes (RIFF, "fmt " and "data" chunk headers): the samples start here. */
export const WAV_HEADER_BYTES = 44;

/** A sample in [-1, 1] as a 16-bit integer (clamped, rounded). */
const int16 = (x: number): number => Math.max(-32768, Math.min(32767, Math.round(x * 32767)));

/** `st` (left and right of equal length; the shorter decides) as a 16-bit stereo PCM WAV file at `sampleRate`. */
export function wavBytes(st: Stereo, sampleRate: number): Uint8Array {
  const n = Math.min(st.l.length, st.r.length);
  const data = n * 4;
  const out = new Uint8Array(WAV_HEADER_BYTES + data);
  const v = new DataView(out.buffer);
  const ascii = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + data, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true); // the fmt chunk's size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 2, true); // channels
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 4, true); // bytes per second
  v.setUint16(32, 4, true); // bytes per frame
  v.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  v.setUint32(40, data, true);
  for (let i = 0; i < n; i++) {
    v.setInt16(WAV_HEADER_BYTES + i * 4, int16(st.l[i]!), true);
    v.setInt16(WAV_HEADER_BYTES + i * 4 + 2, int16(st.r[i]!), true);
  }
  return out;
}

/** The number of stereo frames of a WAV file `wavBytes` wrote (from its header), or null when it is not one. */
export function wavFrames(bytes: Uint8Array): number | null {
  if (bytes.length < WAV_HEADER_BYTES) return null;
  const tag = (at: number): string => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || tag(12) !== 'fmt ' || tag(36) !== 'data') return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const data = v.getUint32(40, true);
  if (v.getUint16(22, true) !== 2 || v.getUint16(34, true) !== 16 || data !== bytes.length - WAV_HEADER_BYTES) return null;
  return data / 4;
}
