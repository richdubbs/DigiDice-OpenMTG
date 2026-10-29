/**
 * Rendering sounds off the server's event loop (Godot plan phase 3): a small pool of worker threads (worker.ts, through boot.mjs) that each render one
 * sound at a time (the longest, ambient.grid, takes about 0.2 to 0.3 s: on the event loop it would hold every other request that long). At most `size`
 * renders run at once; the rest wait in order. A worker that has nothing to do does not keep the process alive.
 *
 * Where no worker can start (a build that bundles the server into one file has no worker module next to it: the desktop app's bundle), the sounds are
 * rendered on the event loop instead, one at a time with a turn of the loop between them (`setImmediate`): each render still blocks for its own length,
 * once per sound and version, since the result is kept on disk (service.ts).
 */
import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { SOUND_IDS, type SoundId } from '@openmtg/play/audio/catalog';
import { RENDER_RATE, renderStereo } from '@openmtg/play/audio/render';
import { wavBytes } from '@openmtg/play/audio/wav';

/** What a render thread is asked. */
export interface RenderJob {
  job: number;
  id: string;
  variant: number;
}

/** A render thread's answer: the WAV file (transferred), or why it could not render it. */
export type RenderJobReply = { job: number; ok: true; wav: ArrayBuffer } | { job: number; ok: false; message: string };

const BOOT = new URL('./boot.mjs', import.meta.url);
const ENTRY = new URL('./worker.ts', import.meta.url).href;

/** The default number of render threads: one less than the machine's cores, at least 1, at most 2 (the game and the table go on meanwhile). */
export function defaultPoolSize(): number {
  return Math.max(1, Math.min(2, availableParallelism() - 1));
}

interface Pending {
  job: RenderJob;
  resolve: (wav: Uint8Array) => void;
  reject: (e: Error) => void;
}

interface Slot {
  worker: Worker;
  busy: Pending | null;
}

export interface RenderPoolOptions {
  /** Render threads (default `defaultPoolSize()`). */
  size?: number;
  /** Render on the event loop, never in a thread (tests of the fallback). */
  inline?: boolean;
}

export class RenderPool {
  readonly size: number;
  /** How many sounds this pool rendered (tests: the cache hit path renders nothing). */
  renders = 0;
  private inline: boolean;
  private readonly slots: Slot[] = [];
  private readonly queue: Pending[] = [];
  private nextJob = 1;
  private inlineRunning = false;
  private closed = false;

  constructor(opts: RenderPoolOptions = {}) {
    this.size = Math.max(1, Math.floor(opts.size ?? defaultPoolSize()));
    this.inline = opts.inline === true || !existsSync(fileURLToPath(BOOT));
  }

  /** The WAV file of variant `variant` of sound `id` (RENDER_RATE, 16-bit stereo). */
  render(id: SoundId, variant: number): Promise<Uint8Array> {
    if (this.closed) return Promise.reject(new Error('The sound renderer is closed.'));
    return new Promise((resolve, reject) => {
      this.queue.push({ job: { job: this.nextJob++, id, variant }, resolve, reject });
      this.pump();
    });
  }

  /** Stop every render thread; renders still waiting are refused. */
  async close(): Promise<void> {
    this.closed = true;
    for (const p of this.queue.splice(0)) p.reject(new Error('The sound renderer is closed.'));
    const slots = this.slots.splice(0);
    for (const s of slots) s.busy?.reject(new Error('The sound renderer is closed.'));
    await Promise.all(slots.map((s) => s.worker.terminate()));
  }

  private pump(): void {
    if (this.inline) return this.pumpInline();
    while (this.queue.length > 0) {
      let slot: Slot | null = this.slots.find((s) => s.busy === null) ?? null;
      if (!slot) {
        if (this.slots.length >= this.size) return;
        slot = this.spawn();
        if (!slot) return this.pumpInline(); // no thread can start here: the event loop renders
      }
      const p = this.queue.shift()!;
      slot.busy = p;
      slot.worker.ref();
      slot.worker.postMessage(p.job);
    }
  }

  private spawn(): Slot | null {
    let worker: Worker;
    try {
      worker = new Worker(BOOT, { workerData: { entry: ENTRY }, name: 'openmtg-sound-render' });
    } catch {
      this.inline = true;
      return null;
    }
    const slot: Slot = { worker, busy: null };
    worker.unref();
    worker.on('message', (r: RenderJobReply) => {
      const p = slot.busy;
      if (!p || p.job.job !== r.job) return;
      slot.busy = null;
      worker.unref();
      if (r.ok) {
        this.renders++;
        p.resolve(new Uint8Array(r.wav));
      } else p.reject(new Error(r.message));
      this.pump();
    });
    const lost = (): void => {
      const i = this.slots.indexOf(slot);
      if (i < 0) return;
      this.slots.splice(i, 1);
      if (this.closed) return;
      // The thread failed (it could not load, or it died): its job and the rest are rendered on the event loop from now on.
      this.inline = true;
      if (slot.busy) this.queue.unshift(slot.busy);
      slot.busy = null;
      this.pump();
    };
    worker.on('error', lost);
    worker.on('exit', lost);
    this.slots.push(slot);
    return slot;
  }

  /** The fallback: one render per turn of the event loop, in order. */
  private pumpInline(): void {
    if (this.inlineRunning || this.queue.length === 0) return;
    this.inlineRunning = true;
    setImmediate(() => {
      this.inlineRunning = false;
      const p = this.queue.shift();
      if (!p) return;
      try {
        if (!(SOUND_IDS as string[]).includes(p.job.id)) throw new Error(`No sound ${p.job.id}`);
        const wav = wavBytes(renderStereo(p.job.id as SoundId, p.job.variant), RENDER_RATE);
        this.renders++;
        p.resolve(wav);
      } catch (e) {
        p.reject(e instanceof Error ? e : new Error(String(e)));
      }
      this.pumpInline();
    });
  }
}
