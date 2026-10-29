/**
 * Review 2026-10-26 F1: starts the page's engine worker (game.worker.ts: a local game, or a replay's completion job). The only place that names the
 * worker's file: Vite bundles a worker once for each module that references it, and a second reference pushed the build past Node's default heap.
 */
export function startEngineWorker(name: string): Worker {
  return new Worker(new URL('./game.worker.ts', import.meta.url), { type: 'module', name });
}
