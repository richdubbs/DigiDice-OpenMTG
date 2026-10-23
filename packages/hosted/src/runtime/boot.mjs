// The entry of every runtime worker thread (game workers: src/worker.ts; deck workers: src/deck-worker.ts; package M13-5). The package runs from its
// TypeScript sources (as the rest of the repository does, through tsx), and a worker thread starts without the parent's loader: this registers tsx's
// ESM loader in the thread, then imports the worker's module (`workerData.entry`, a file URL). A build that runs plain JavaScript passes a .js entry and
// works without tsx.
import { workerData } from 'node:worker_threads';

if (/\.[cm]?tsx?$/.test(new URL(workerData.entry).pathname)) {
  const { register } = await import('tsx/esm/api');
  register();
}
await import(workerData.entry);
