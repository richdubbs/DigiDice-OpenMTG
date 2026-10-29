/**
 * The sounds of the game as WAV files (Godot plan phase 3, step 4; api.ts has the endpoints): rendered on demand by the render pool (pool.ts, off the event
 * loop), kept on disk under the server's data folder, `<dir>/<hash>/<id>#<variant>.wav` (`dir` defaults to `sounds` next to the card cache, as the
 * compiled cache, the rules packs and the replays are), where `hash` is the catalog's hash: a new build whose sounds changed renders into a new folder.
 * A sound asked for twice while it renders is rendered once. The manifest needs every sound's length, so the first one renders the whole catalog (a
 * few seconds; the files are kept, so later WAV requests are read from disk) and is kept as `<dir>/<hash>/manifest.json`.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { SOUND_IDS, SOUND_META, variantCount, type SoundId, type SoundMeta } from '@openmtg/play/audio/catalog';
import { AUDIO_RENDER_VERSION, catalogHash, RENDER_RATE } from '@openmtg/play/audio/render';
import { wavFrames } from '@openmtg/play/audio/wav';
import { SOUNDS_MANIFEST_PATH, SOUNDS_PREFIX, type SoundsManifest, type SoundsManifestEntry } from './api';
import { RenderPool, type RenderPoolOptions } from './pool';

export interface SoundServiceOptions extends RenderPoolOptions {
  /** Where the rendered sounds are kept (a folder per catalog hash). */
  dir: string;
}

/** A WAV answer: its bytes, and whether they came from the disk (true) or were rendered for this request. */
export interface SoundFile {
  bytes: Uint8Array;
  cached: boolean;
}

const WAV_PATH = /^\/api\/sounds\/([^/]+)\/(\d{1,3})\.wav$/;

export class SoundService {
  readonly dir: string;
  readonly pool: RenderPool;
  private hashValue: string | null = null;
  private readonly inFlight = new Map<string, Promise<SoundFile>>();
  private manifestPromise: Promise<SoundsManifest> | null = null;

  constructor(opts: SoundServiceOptions) {
    this.dir = opts.dir;
    this.pool = new RenderPool(opts);
  }

  /** The catalog's hash (worked out once: it hashes every recipe's code). */
  get hash(): string {
    return (this.hashValue ??= catalogHash());
  }

  /** The file a variant is kept in. */
  filePath(id: SoundId, variant: number): string {
    return path.join(this.dir, this.hash, `${id}#${variant}.wav`);
  }

  /** Whether `id` and `variant` name a sound of the catalog. */
  static known(id: string, variant: number): id is SoundId {
    return (SOUND_IDS as string[]).includes(id) && Number.isInteger(variant) && variant >= 0 && variant < variantCount(id as SoundId);
  }

  /** The WAV file of one variant: from the disk when it was rendered before, else rendered (once, however many ask meanwhile) and kept. */
  wav(id: SoundId, variant: number): Promise<SoundFile> {
    const file = this.filePath(id, variant);
    let p = this.inFlight.get(file);
    if (!p) {
      p = this.load(id, variant, file).finally(() => this.inFlight.delete(file));
      this.inFlight.set(file, p);
    }
    return p;
  }

  private async load(id: SoundId, variant: number, file: string): Promise<SoundFile> {
    try {
      const bytes = new Uint8Array(await readFile(file));
      if (wavFrames(bytes) !== null) return { bytes, cached: true };
    } catch {
      // not rendered yet (or unreadable): render it
    }
    const bytes = await this.pool.render(id, variant);
    try {
      await mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, bytes);
      await rename(tmp, file); // whole files only: a reader never sees half of one
    } catch (e) {
      console.error('[openmtg-server] a rendered sound could not be kept:', e instanceof Error ? e.message : e);
    }
    return { bytes, cached: false };
  }

  /** The manifest (api.ts): kept in memory and on disk once worked out; the first one renders every sound that is not on disk yet. */
  manifest(): Promise<SoundsManifest> {
    this.manifestPromise ??= this.makeManifest().catch((e: unknown) => {
      this.manifestPromise = null; // the next request tries again
      throw e;
    });
    return this.manifestPromise;
  }

  private async makeManifest(): Promise<SoundsManifest> {
    const file = path.join(this.dir, this.hash, 'manifest.json');
    try {
      const kept = JSON.parse(await readFile(file, 'utf8')) as SoundsManifest;
      if (kept.hash === this.hash && kept.version === AUDIO_RENDER_VERSION && kept.rate === RENDER_RATE && Array.isArray(kept.sounds) && kept.sounds.length === SOUND_IDS.length) return kept;
    } catch {
      // not made yet
    }
    const sounds = await Promise.all(SOUND_IDS.map(async (id): Promise<SoundsManifestEntry> => {
      const n = variantCount(id);
      const files = await Promise.all(Array.from({ length: n }, (_, v) => this.wav(id, v)));
      const frames = Math.max(...files.map((f) => wavFrames(f.bytes) ?? 0));
      return { id, variants: n, lengthMs: Math.round((frames * 1000) / RENDER_RATE), ...((SOUND_META[id] as SoundMeta).loop ? { loop: true as const } : {}) };
    }));
    const manifest: SoundsManifest = { version: AUDIO_RENDER_VERSION, hash: this.hash, rate: RENDER_RATE, sounds };
    try {
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify(manifest)}\n`);
      await rename(tmp, file);
    } catch (e) {
      console.error('[openmtg-server] the sound manifest could not be kept:', e instanceof Error ? e.message : e);
    }
    return manifest;
  }

  /** Answer a request under /api/sounds/ (http.ts sends them here; the Host was checked there). */
  async handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') return error(res, 405, `Method ${req.method} not allowed`, { Allow: 'GET, HEAD' });
    if (pathname === SOUNDS_MANIFEST_PATH) {
      const body = JSON.stringify(await this.manifest());
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    const m = WAV_PATH.exec(pathname);
    let id = '';
    try {
      id = m ? decodeURIComponent(m[1]!) : '';
    } catch {
      id = '';
    }
    const variant = m ? Number(m[2]) : -1;
    if (!m || !SoundService.known(id, variant)) return error(res, 404, `No sound ${pathname.slice(SOUNDS_PREFIX.length + 1)}`);
    const etag = `"${this.hash}-${id}-${variant}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' });
      res.end();
      return;
    }
    const f = await this.wav(id, variant);
    res.writeHead(200, {
      'Content-Type': 'audio/wav', 'Content-Length': f.bytes.length, 'Cache-Control': 'no-cache', ETag: etag, 'X-OpenMTG-Sound-Cache': f.cached ? 'hit' : 'miss',
    });
    res.end(req.method === 'HEAD' ? undefined : f.bytes);
  }

  close(): Promise<void> {
    return this.pool.close();
  }
}

function error(res: ServerResponse, status: number, message: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify({ error: message }));
}
