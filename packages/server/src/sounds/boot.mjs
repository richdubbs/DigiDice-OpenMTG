// The entry of the sound render threads (pool.ts): the package runs from its TypeScript sources (through tsx, as the rest of the repository does), and a
// worker thread starts without the parent's loader, so this registers tsx's ESM loader in the thread when the worker's module is TypeScript, then imports
// it (`workerData.entry`, a file URL).
import { workerData } from 'node:worker_threads';

if (/\.[cm]?tsx?$/.test(new URL(workerData.entry).pathname)) {
  const { register } = await import('tsx/esm/api');
  register();
}
await import(workerData.entry);
