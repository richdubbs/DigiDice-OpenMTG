/**
 * A deck worker (design 2.1, 6.2; package M13-5): holds the server's card source and runs net's `prepareDeck` (name resolution with the bounded fuzzy
 * suggester, the format's `validateDeck`, compiling) one deck at a time, off the main thread. The main thread's pool (runtime/deck-pool.ts) bounds the
 * queue and gives each deck a deadline (a worker past it is replaced).
 *
 * Started through runtime/boot.mjs (`workerData.data` is `DeckWorkerData`).
 */
import { parentPort, workerData } from 'node:worker_threads';
import { prepareDeck, type CardSource } from '@openmtg/net/server-kit';
import type { BootData, DeckWorkerData, DeckWorkerReply, DeckWorkerRequest } from './runtime/api';

const port = parentPort;
if (!port) throw new Error('deck-worker.ts runs as a worker thread');
const data = (workerData as BootData<DeckWorkerData>).data;

function post(m: DeckWorkerReply): void {
  port!.postMessage(m);
}

let cards: CardSource | null = null;
try {
  const mod = (await import(data.cards.module)) as { createCardSource?: (o: unknown) => Promise<CardSource> };
  if (typeof mod.createCardSource !== 'function') throw new Error('the card source module has no createCardSource');
  cards = await mod.createCardSource(data.cards.options);
} catch (e) {
  post({ kind: 'broken', error: e instanceof Error ? e.name : 'error' });
}

port.on('message', (m: DeckWorkerRequest) => {
  if (m.kind !== 'prepare') return;
  if (!cards) return post({ kind: 'failed', id: m.id, error: 'no card source' });
  prepareDeck(m.deck, { cards, format: m.format }).then(
    (result) => post({ kind: 'prepared', id: m.id, result }),
    (e: unknown) => post({ kind: 'failed', id: m.id, error: e instanceof Error ? e.name : 'error' }),
  );
});

if (cards) post({ kind: 'ready' });
