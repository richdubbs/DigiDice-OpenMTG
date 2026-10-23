/** Starting the runtime's worker threads (package M13-5): every worker goes through boot.mjs, which loads its TypeScript entry. */
import { Worker } from 'node:worker_threads';
import type { BootData } from './api';

export const GAME_WORKER_ENTRY = new URL('../worker.ts', import.meta.url).href;
export const DECK_WORKER_ENTRY = new URL('../deck-worker.ts', import.meta.url).href;
export const DEFAULT_CARD_SOURCE = new URL('./cards.ts', import.meta.url).href;
const BOOT = new URL('./boot.mjs', import.meta.url);

export function spawnWorker<T>(entry: string, data: T, o: { heapMb?: number; name?: string } = {}): Worker {
  const workerData: BootData<T> = { entry, data };
  return new Worker(BOOT, {
    workerData,
    ...(o.name ? { name: o.name } : {}),
    ...(o.heapMb ? { resourceLimits: { maxOldGenerationSizeMb: o.heapMb } } : {}),
  });
}
