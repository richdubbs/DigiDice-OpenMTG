/**
 * The deck pool (design 2.1, 6.2, review 12; package M13-5): one or two deck workers with the server's card source run `prepareDeck`, one deck at a time
 * each, with a deadline per deck (10 s: a worker past it is terminated and replaced, the deck answered with an error) and a bounded queue (64: a full
 * queue answers `busy`). Decklists are private: nothing here logs a name.
 */
import type { Worker } from 'node:worker_threads';
import { checkDeckSubmission, type DeckSubmission } from '@openmtg/net/server-kit';
import { NULL_LOGGER, type Logger } from '../obs';
import type { CardSourceSpec, DeckPool, DeckResult, DeckWorkerData, DeckWorkerReply } from './api';
import { DECK_WORKER_ENTRY, spawnWorker } from './spawn';

interface Job {
  id: number;
  deck: DeckSubmission;
  format: string;
  resolve: (r: DeckResult) => void;
}

interface Slot {
  index: number;
  worker: Worker;
  ready: boolean;
  broken: boolean;
  job: Job | null;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface DeckPoolOptions {
  workers: number;
  cards: CardSourceSpec;
  deadlineMs: number;
  queue: number;
  logger?: Logger;
}

export class DeckWorkerPool implements DeckPool {
  private readonly slots: Slot[] = [];
  private readonly queue: Job[] = [];
  private nextId = 1;
  private closed = false;
  private readonly logger: Logger;

  constructor(private readonly o: DeckPoolOptions) {
    this.logger = o.logger ?? NULL_LOGGER;
    for (let i = 0; i < o.workers; i++) this.slots.push(this.spawn(i));
  }

  /** Resolves once every deck worker has its card source (or found it could not make one). */
  async ready(): Promise<void> {
    while (!this.closed && this.slots.some((s) => !s.ready && !s.broken)) await new Promise((r) => setTimeout(r, 20));
  }

  prepare(deck: DeckSubmission, format: string): Promise<DeckResult> {
    const problem = checkDeckSubmission(deck);
    if (problem) return Promise.resolve({ ok: false, errors: [`The decklist is malformed (${problem}).`], warnings: [] });
    if (this.closed || this.slots.length === 0 || this.slots.every((s) => s.broken)) {
      return Promise.resolve({ ok: false, errors: ['Deck checks are not available on this server now.'], warnings: [], busy: true });
    }
    if (this.queue.length >= this.o.queue) return Promise.resolve({ ok: false, errors: ['The server is checking many decks; try again shortly.'], warnings: [], busy: true });
    return new Promise((resolve) => {
      this.queue.push({ id: this.nextId++, deck, format, resolve });
      this.pump();
    });
  }

  /** Decks waiting (not counting the ones being checked). */
  get waiting(): number {
    return this.queue.length;
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const j of this.queue.splice(0)) j.resolve({ ok: false, errors: ['The server is stopping.'], warnings: [], busy: true });
    await Promise.all(this.slots.map(async (s) => {
      if (s.timer) clearTimeout(s.timer);
      s.job?.resolve({ ok: false, errors: ['The server is stopping.'], warnings: [], busy: true });
      s.job = null;
      await s.worker.terminate();
    }));
  }

  private spawn(index: number): Slot {
    const data: DeckWorkerData = { cards: this.o.cards };
    const worker = spawnWorker(DECK_WORKER_ENTRY, data, { name: `deck-${index}` });
    const slot: Slot = { index, worker, ready: false, broken: false, job: null, timer: null };
    worker.on('message', (m: DeckWorkerReply) => this.onMessage(slot, m));
    worker.on('error', (e) => {
      this.logger.log('error', 'deckWorkerError', { worker: index, error: e.name });
    });
    worker.on('exit', () => {
      if (this.closed || this.slots[index] !== slot) return;
      // A crash: the deck in progress is answered, the worker replaced.
      this.finish(slot, { ok: false, errors: ['The deck check failed on the server; try again.'], warnings: [] });
      this.slots[index] = this.spawn(index);
    });
    return slot;
  }

  private onMessage(slot: Slot, m: DeckWorkerReply): void {
    switch (m.kind) {
      case 'ready':
        slot.ready = true;
        return this.pump();
      case 'broken':
        slot.broken = true;
        this.logger.log('error', 'deckWorkerBroken', { worker: slot.index, error: m.error });
        // Nobody else can check these decks if every worker is broken.
        if (this.slots.every((s) => s.broken)) for (const j of this.queue.splice(0)) j.resolve({ ok: false, errors: ['Deck checks are not available on this server now.'], warnings: [], busy: true });
        return;
      case 'prepared':
        if (slot.job?.id === m.id) this.finish(slot, m.result);
        return this.pump();
      case 'failed':
        if (slot.job?.id === m.id) {
          this.logger.log('error', 'deckCheckFailed', { worker: slot.index, error: m.error });
          this.finish(slot, { ok: false, errors: ['The deck check failed on the server; try again.'], warnings: [] });
        }
        return this.pump();
    }
  }

  private finish(slot: Slot, r: DeckResult): void {
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = null;
    const job = slot.job;
    slot.job = null;
    job?.resolve(r);
  }

  private pump(): void {
    for (const slot of this.slots) {
      if (this.closed || this.queue.length === 0) return;
      if (!slot.ready || slot.broken || slot.job) continue;
      const job = this.queue.shift()!;
      slot.job = job;
      slot.timer = setTimeout(() => this.timedOut(slot, job), this.o.deadlineMs);
      slot.worker.postMessage({ kind: 'prepare', id: job.id, deck: job.deck, format: job.format });
    }
  }

  private timedOut(slot: Slot, job: Job): void {
    if (slot.job !== job || this.closed) return;
    this.logger.log('warn', 'deckDeadline', { worker: slot.index });
    slot.timer = null;
    slot.job = null;
    job.resolve({ ok: false, errors: ['The deck check took too long; try again with a shorter list.'], warnings: [], timeout: true });
    this.slots[slot.index] = this.spawn(slot.index);
    void slot.worker.terminate();
    this.pump();
  }
}
