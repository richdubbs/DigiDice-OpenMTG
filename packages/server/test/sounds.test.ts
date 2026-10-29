// @vitest-environment node
/**
 * Godot plan phase 3, step 4: the game's sounds as WAV files (src/sounds). The manifest lists every sound of the catalog with its variants, its length
 * and whether it loops, under the catalog's hash; a WAV is 16-bit PCM stereo at 48 kHz with exactly the frames the recipe renders; a sound rendered once
 * is read from the disk afterwards (by the same server and by the next one), and a copy the client has is answered 304; the render threads keep the
 * event loop free while the longest sound renders.
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SOUND_IDS, SOUND_META, variantCount, type SoundMeta } from '@openmtg/play/audio/catalog';
import { AUDIO_RENDER_VERSION, catalogHash, RENDER_RATE, renderStereo } from '@openmtg/play/audio/render';
import { wavBytes, wavFrames } from '@openmtg/play/audio/wav';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '../src/http';
import type { SoundsManifest } from '../src/sounds/api';
import { RenderPool } from '../src/sounds/pool';
import { SoundService } from '../src/sounds/service';

const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(path.join(tmpdir(), 'openmtg-sounds-'));
  dirs.push(d);
  return d;
};
const closers: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const c of closers) await c();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** The RIFF header fields of a WAV file. */
function header(b: Uint8Array): { riff: string; wave: string; fmt: string; data: string; format: number; channels: number; rate: number; bits: number; dataBytes: number; riffSize: number } {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (at: number) => String.fromCharCode(...b.subarray(at, at + 4));
  return {
    riff: tag(0), riffSize: v.getUint32(4, true), wave: tag(8), fmt: tag(12), format: v.getUint16(20, true), channels: v.getUint16(22, true), rate: v.getUint32(24, true),
    bits: v.getUint16(34, true), data: tag(36), dataBytes: v.getUint32(40, true),
  };
}

describe('GET /api/sounds (a real server)', () => {
  let running: RunningServer;
  let soundsDir: string;
  beforeAll(async () => {
    const dir = tmp();
    soundsDir = path.join(dir, 'sounds');
    running = await startServer({ port: 0, clientDist: null, cacheDir: path.join(dir, 'scryfall'), online: false, table: false, sounds: { dir: soundsDir, workers: 2 } });
    closers.push(() => running.close());
  });

  it('one WAV: a RIFF header (PCM, 2 channels, 16 bits, 48 kHz) and exactly the frames the recipe renders', async () => {
    const r = await fetch(`${running.url}/api/sounds/ui.confirm/0.wav`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('audio/wav');
    const b = new Uint8Array(await r.arrayBuffer());
    const h = header(b);
    const frames = renderStereo('ui.confirm', 0).l.length;
    expect(h).toEqual({ riff: 'RIFF', riffSize: 36 + frames * 4, wave: 'WAVE', fmt: 'fmt ', format: 1, channels: 2, rate: RENDER_RATE, bits: 16, data: 'data', dataBytes: frames * 4 });
    expect(b.length).toBe(44 + frames * 4);
    expect(wavFrames(b)).toBe(frames);
    expect(Number(r.headers.get('content-length'))).toBe(b.length);
    // the same bytes as encoding the recipe's render here (the render is deterministic)
    expect(Buffer.from(b).equals(Buffer.from(wavBytes(renderStereo('ui.confirm', 0), RENDER_RATE)))).toBe(true);
  }, 60_000);

  it('the manifest: every sound with its variants, length and loop flag, under the catalog hash', async () => {
    const r = await fetch(`${running.url}/api/sounds/manifest`);
    expect(r.status).toBe(200);
    const m = (await r.json()) as SoundsManifest;
    expect(Object.keys(m)).toEqual(['version', 'hash', 'rate', 'sounds']);
    expect(m.version).toBe(AUDIO_RENDER_VERSION);
    expect(m.hash).toBe(catalogHash());
    expect(m.rate).toBe(48000);
    expect(m.sounds.map((s) => s.id)).toEqual(SOUND_IDS);
    expect(m.sounds.length).toBe(113);
    for (const s of m.sounds) {
      expect(s.variants, s.id).toBe(variantCount(s.id as (typeof SOUND_IDS)[number]));
      expect(s.lengthMs, s.id).toBeGreaterThan(0);
      expect(s.lengthMs, s.id).toBeLessThanOrEqual(Math.round((SOUND_META[s.id as (typeof SOUND_IDS)[number]] as SoundMeta).maxDur * 1000) + 1);
      expect(Object.keys(s).every((k) => ['id', 'variants', 'lengthMs', 'loop'].includes(k)), s.id).toBe(true);
    }
    expect(m.sounds.filter((s) => s.loop).map((s) => s.id)).toEqual(SOUND_IDS.filter((id) => (SOUND_META[id] as SoundMeta).loop));
    expect(m.sounds.find((s) => s.id === 'ui.confirm')!.lengthMs).toBe(Math.round((renderStereo('ui.confirm', 0).l.length * 1000) / RENDER_RATE));
    // every variant is now on disk, with the manifest, in the hash's folder
    const files = readdirSync(path.join(soundsDir, m.hash));
    expect(files.filter((f) => f.endsWith('.wav')).length).toBe(m.sounds.reduce((n, s) => n + s.variants, 0));
    expect(files).toContain('manifest.json');
  }, 120_000);

  it('the cache hit path: a sound on disk is read, not rendered; a copy the client has is answered 304; unknown sounds are 404', async () => {
    const before = running.sounds!.pool.renders;
    const r = await fetch(`${running.url}/api/sounds/ui.confirm/0.wav`);
    expect(r.status).toBe(200);
    expect(r.headers.get('x-openmtg-sound-cache')).toBe('hit');
    expect(running.sounds!.pool.renders).toBe(before);
    const etag = r.headers.get('etag')!;
    expect(etag).toBe(`"${catalogHash()}-ui.confirm-0"`);
    const again = await fetch(`${running.url}/api/sounds/ui.confirm/0.wav`, { headers: { 'If-None-Match': etag } });
    expect(again.status).toBe(304);
    for (const p of ['nope.sound/0.wav', 'ui.confirm/1.wav', 'ui.confirm/0.mp3', '..%2F..%2Fmanifest/0.wav', 'ui.confirm']) {
      expect((await fetch(`${running.url}/api/sounds/${p}`)).status, p).toBe(404);
    }
    expect((await fetch(`${running.url}/api/sounds/manifest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(405);
  }, 60_000);
});

describe('SoundService and its render pool', () => {
  it('renders a sound once however many ask, keeps it, and the next service reads it from the disk', async () => {
    const dir = tmp();
    const a = new SoundService({ dir, size: 1 });
    closers.push(() => a.close());
    const [x, y] = await Promise.all([a.wav('turn.mine', 0), a.wav('turn.mine', 0)]);
    expect(a.pool.renders).toBe(1);
    expect(x.cached).toBe(false);
    expect(y).toBe(x);
    const z = await a.wav('turn.mine', 0);
    expect(z.cached).toBe(true);
    expect(a.pool.renders).toBe(1);
    expect(readdirSync(path.join(dir, a.hash))).toEqual(['turn.mine#0.wav']);
    const b = new SoundService({ dir, size: 1 });
    closers.push(() => b.close());
    const w = await b.wav('turn.mine', 0);
    expect(w.cached).toBe(true);
    expect(b.pool.renders).toBe(0);
    expect(Buffer.from(w.bytes).equals(Buffer.from(x.bytes))).toBe(true);
  }, 60_000);

  it('the longest sound renders in a thread: the event loop keeps turning meanwhile; the fallback on the event loop gives the same bytes', async () => {
    const pool = new RenderPool({ size: 1 });
    closers.push(() => pool.close());
    await pool.render('ui.click', 0); // the thread has started and loaded the recipes
    let last = performance.now();
    let gap = 0;
    const timer = setInterval(() => {
      const now = performance.now();
      gap = Math.max(gap, now - last);
      last = now;
    }, 5);
    const t0 = performance.now();
    const threaded = await pool.render('ambient.grid', 0);
    const took = performance.now() - t0;
    clearInterval(timer);
    expect(took).toBeGreaterThan(50); // a real render (about 0.2 to 0.3 s)
    expect(gap).toBeLessThan(150);
    const inline = new RenderPool({ inline: true });
    const same = await inline.render('ambient.grid', 0);
    expect(Buffer.from(same).equals(Buffer.from(threaded))).toBe(true);
    expect(wavFrames(threaded)).toBe(12 * RENDER_RATE);
    await expect(inline.render('nope' as 'ui.click', 0)).rejects.toThrow(/No sound/);
  }, 60_000);
});
