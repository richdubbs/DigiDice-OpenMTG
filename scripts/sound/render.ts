/**
 * Renders the client's sound effects to WAV files with their measurements (docs/design/sound.md "Checks"), for listening and for the sound report.
 *
 *   npx tsx scripts/sound/render.ts                      every sound, every variant
 *   npx tsx scripts/sound/render.ts --group spells        one group: ui, flow, moments, spells, magic, combat, cards, zones
 *   npx tsx scripts/sound/render.ts --ids ui.click,turn.mine
 *   options: --out <dir> (default .cache/sound), --sr <rate> (default 48000), --first (variant 0 only),
 *            --dossier (also write <out>/dossier.md: every rendered sound's catalog entry and measurements, for the review)
 *
 * Writes <out>/<id>[.v<n>].wav, <out>/<id>.json (measurements of variant 0) and <out>/report.json, and prints one line per sound with the warnings
 * the tests would raise (too long, peak-limited below its loudness, clicks at the edges, DC).
 * Then `python scripts/sound/spectrogram.py <out>` draws a spectrogram per sound and a contact sheet per group.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { analyze, describePitch, type Analysis } from '../../packages/client/src/audio/analysis';
import { missingRecipes, renderSound, SOUND_IDS, SOUND_META, soundGroup, variantCount, type SoundId, type SoundMeta } from '../../packages/client/src/audio/catalog';
import type { Stereo } from '../../packages/client/src/audio/dsp';

export const groupOf = soundGroup;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function wav(st: Stereo, sr: number): Buffer {
  const n = st.l.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(st.l[i]! * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(st.r[i]! * 32767))), 46 + i * 4);
  }
  return buf;
}

export function warnings(id: SoundId, a: Analysis): string[] {
  const meta = SOUND_META[id] as SoundMeta;
  const w: string[] = [];
  if (a.duration > meta.maxDur + 1e-3) w.push(`too long (${a.duration.toFixed(2)} s > ${meta.maxDur} s)`);
  if (a.lufs100 < meta.lufs - 1.5) w.push(`peak-limited ${(meta.lufs - a.lufs100).toFixed(1)} dB under its loudness`);
  if (a.edgeStep > 0.02 && !meta.loop) w.push(`edge click (${a.edgeStep.toFixed(3)})`);
  if (Math.abs(a.dcOffset) > 0.002) w.push(`DC ${a.dcOffset.toFixed(4)}`);
  if (a.peakDb > -0.9) w.push(`peak ${a.peakDb} dBFS`);
  return w;
}

interface DossierEntry {
  id: SoundId;
  group: string;
  meta: SoundMeta;
  placeholder: boolean;
  analysis: Analysis;
  pitchText: string;
  warnings: string[];
}

/** The review's view of a sound: what it is for, and what the measurements say it is. */
export function dossier(report: Record<string, DossierEntry>): string {
  const lines: string[] = ['# Sound dossier', '', 'Measurements of variant 0 at 48 kHz (scripts/sound/render.ts). Spectrograms: png/<id>.png.', ''];
  for (const e of Object.values(report)) {
    const a = e.analysis;
    const m = e.meta;
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    lines.push(
      `## ${e.id}${e.placeholder ? ' (PLACEHOLDER: no recipe yet)' : ''}`,
      '',
      `- Purpose: ${m.purpose}`,
      `- When: ${m.when}`,
      `- Category ${m.category}, ${m.frequency}; target ${m.lufs} LUFS (loudest 100 ms), at most ${m.maxDur} s${m.variants ? `, ${m.variants} variants` : ''}${m.loop ? ', seamless loop' : ''}`,
      `- Length ${a.duration.toFixed(3)} s, audible ${a.audible.toFixed(3)} s; attack ${a.attackMs} ms; ${a.lufs100} LUFS100 / ${a.lufs400} LUFS400; peak ${a.peakDb} dBFS; crest ${a.crestDb} dB`,
      `- Small speakers (200 Hz high-pass): ${a.lufs100Small} LUFS100, ${a.smallSpeakerLossDb} dB lost`,
      `- Envelope (dB re max, at 0%..100% of the audible part): ${a.envelope.join(' ')}`,
      `- Brightness: centroid ${a.centroid} Hz; track ${a.centroidTrack.join(' ')} Hz; flatness ${a.flatness} (0 tonal, 1 noise); stereo correlation ${a.stereoCorrelation}`,
      `- Energy: sub ${pct(a.bands.sub)}, low ${pct(a.bands.low)}, low-mid ${pct(a.bands.lowMid)}, mid ${pct(a.bands.mid)}, presence ${pct(a.bands.presence)}, high ${pct(a.bands.high)}, air ${pct(a.bands.air)}`,
      `- Pitch: ${e.pitchText || '(none)'}`,
      `- Chroma: ${a.chroma || '(none)'}`,
      `- Render ${a.renderMs} ms${e.warnings.length ? `; WARNINGS: ${e.warnings.join('; ')}` : ''}`,
      '',
    );
  }
  return lines.join('\n');
}

function main(): void {
  const out = path.resolve(arg('out') ?? '.cache/sound');
  const sr = Number(arg('sr') ?? 48000);
  const group = arg('group');
  const only = arg('ids')?.split(',').map((s) => s.trim()) as SoundId[] | undefined;
  const first = process.argv.includes('--first');
  const ids = SOUND_IDS.filter((id) => (!only || only.includes(id)) && (!group || groupOf(id) === group));
  mkdirSync(out, { recursive: true });
  const missing = new Set(missingRecipes());
  const report: Record<string, unknown> = {};
  for (const id of ids) {
    const variants = first ? 1 : variantCount(id);
    let a0: Analysis | null = null;
    for (let v = 0; v < variants; v++) {
      let t0 = performance.now();
      let st = renderSound(id, sr, v);
      let ms = performance.now() - t0;
      // A slow first render is mostly the JIT warming up: time a second one.
      if (ms > 40) {
        t0 = performance.now();
        st = renderSound(id, sr, v);
        ms = performance.now() - t0;
      }
      const a = analyze(st, sr);
      a.renderMs = Math.round(ms * 10) / 10;
      writeFileSync(path.join(out, `${id}${v ? `.v${v}` : ''}.wav`), wav(st, sr));
      if (v === 0) a0 = a;
    }
    const a = a0!;
    const meta = SOUND_META[id] as SoundMeta;
    const entry = { id, group: groupOf(id), meta, placeholder: missing.has(id), analysis: a, pitchText: describePitch(a.pitch), warnings: warnings(id, a) };
    writeFileSync(path.join(out, `${id}.json`), JSON.stringify(entry, null, 2));
    report[id] = entry;
    const flag = missing.has(id) ? ' [PLACEHOLDER]' : '';
    console.log(
      `${id.padEnd(20)} ${a.duration.toFixed(2)}s aud ${a.audible.toFixed(2)}s  ${String(a.lufs100).padStart(6)} LUFS (target ${meta.lufs}, small spk -${a.smallSpeakerLossDb})  pk ${String(a.peakDb).padStart(5)}  att ${String(a.attackMs).padStart(3)}ms  cen ${String(a.centroid).padStart(5)}Hz  flat ${a.flatness.toFixed(2)}  ${a.renderMs}ms${flag}${entry.warnings.length ? `  !! ${entry.warnings.join('; ')}` : ''}`,
    );
    console.log(`${''.padEnd(21)}pitch: ${entry.pitchText || '-'}`);
  }
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  if (process.argv.includes('--dossier')) writeFileSync(path.join(out, 'dossier.md'), dossier(report as Record<string, DossierEntry>));
  console.log(`\n${ids.length} sounds -> ${out}${missing.size ? ` (${[...missing].filter((m) => ids.includes(m)).length} placeholders)` : ''}`);
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('scripts', 'sound', 'render.ts'))) main();
