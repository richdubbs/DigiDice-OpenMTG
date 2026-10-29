/**
 * Where the page has its sounds rendered (Review 2026-10-26, Finding 21). Synthesizing a sound takes 25 ms on average and up to 200 ms (the ambience),
 * far over a frame, so the page asks a Web Worker (render.worker.ts) and gets the two channels back when they are ready. Without Web Workers (the tests'
 * jsdom, an old browser), or when the worker fails, sounds are rendered on the page, but only when it is idle (requestIdleCallback without a time-out:
 * never in the middle of an animation, never inside a `play`).
 *
 * A renderer answers each request later, never synchronously: the engine (engine.ts) treats every sound as missing until its answer arrives.
 */
import type { SoundId } from './catalog';
import type { Stereo } from './dsp';
import { renderStereo, type RenderReply, type RenderRequest } from './render';

export interface SoundRenderer {
  /** Render this variant; resolves with its channels, or null when it could not be rendered. Never rejects. */
  render(id: SoundId, variant: number): Promise<Stereo | null>;
}

/** What the worker renderer needs of a Worker (tests pass a fake). */
export interface WorkerLike {
  onmessage: ((e: MessageEvent<RenderReply>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  postMessage(message: RenderRequest): void;
  terminate(): void;
}

type IdleWindow = { requestIdleCallback?: (cb: () => void) => number };

/** Run `fn` when the page is idle (no time-out: an idle moment never comes in the middle of an animation frame's work), else after a frame. */
export function whenIdle(fn: () => void): void {
  const w = typeof window !== 'undefined' ? (window as unknown as IdleWindow) : null;
  if (w?.requestIdleCallback) w.requestIdleCallback(fn);
  else setTimeout(fn, 16);
}

/** The fallback: render on the page, one sound per idle moment. */
export function idleRenderer(): SoundRenderer {
  return {
    render: (id, variant) =>
      new Promise((resolve) => {
        whenIdle(() => {
          try {
            resolve(renderStereo(id, variant));
          } catch (e) {
            console.error(`[sound] ${id} failed to render`, e);
            resolve(null);
          }
        });
      }),
  };
}

function startWorker(): WorkerLike {
  return new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module', name: 'openmtg-sound-render' }) as unknown as WorkerLike;
}

/**
 * The renderer that runs every job in one long-lived module worker, or null when this browser has no Web Workers. If the worker cannot start or fails,
 * its jobs and every later one go to the idle fallback.
 */
export function workerRenderer(make: () => WorkerLike = startWorker, fallback: () => SoundRenderer = idleRenderer): SoundRenderer | null {
  if (make === startWorker && typeof Worker === 'undefined') return null;
  let worker: WorkerLike | null = null;
  let broken: SoundRenderer | null = null;
  let next = 0;
  const pending = new Map<number, { id: SoundId; variant: number; resolve: (st: Stereo | null) => void }>();
  const giveUp = (why: unknown) => {
    console.error('[sound] the render worker failed; sounds are rendered on the page while it is idle', why);
    try {
      worker?.terminate();
    } catch {
      /* already gone */
    }
    worker = null;
    broken = fallback();
    const jobs = [...pending.values()];
    pending.clear();
    for (const j of jobs) void broken.render(j.id, j.variant).then(j.resolve);
  };
  const ensure = (): WorkerLike | null => {
    if (worker || broken) return worker;
    try {
      worker = make();
    } catch (e) {
      giveUp(e);
      return null;
    }
    worker.onmessage = (e) => {
      const m = e.data;
      const job = pending.get(m.job);
      if (!job) return;
      pending.delete(m.job);
      if (m.ok) job.resolve({ l: m.l, r: m.r });
      else {
        console.error(`[sound] ${job.id} failed to render`, m.message);
        job.resolve(null);
      }
    };
    worker.onerror = (e) => {
      e.preventDefault?.();
      giveUp(e.message);
    };
    return worker;
  };
  return {
    render(id, variant) {
      const w = ensure();
      if (!w) return broken!.render(id, variant);
      return new Promise((resolve) => {
        const job = ++next;
        pending.set(job, { id, variant, resolve });
        try {
          w.postMessage({ job, id, variant });
        } catch (e) {
          giveUp(e);
        }
      });
    },
  };
}

/** The renderer a page uses: the worker where there is one, else the idle fallback. */
export function defaultRenderer(): SoundRenderer {
  return workerRenderer() ?? idleRenderer();
}
