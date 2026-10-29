/**
 * The deck pool (design 2.1, 6.2, review 12; package M13-5): one or two deck workers with the server's card source run `prepareDeck`, one deck at a time
 * each, with a deadline per deck (10 s: a worker past it is terminated and replaced, the deck answered with an error) and a bounded queue (64: a full
 * queue answers `busy`). Decklists are private: nothing here logs a name.
 *
 * F32: the pool is shared by every session (create, join, queue all check decks here), so one session must not fill it:
 * - **Per-session pace**: each session's deck checks take a token of its own bucket (`perSession`, 1 every 2 s, bursts of 3); past it the answer is
 *   `rateLimited` with the wait. The server's own checks (no session) are not paced.
 * - **Cache**: a list a worker has checked for a format is kept (`cacheMs`, 5 minutes; `cacheSize` lists at most, the oldest goes first), keyed by a
 *   hash of the format and the list, and answered from there (a copy) without a worker and without a token. Only a worker's own answer is kept: never
 *   busy, a deadline or a crash.
 */
import { createHash } from 'node:crypto';
import type { Worker } from 'node:worker_threads';
import { checkDeckSubmission, type DeckSubmission, type RateConfig } from '@openmtg/net/server-kit';
import { KeyBuckets } from '../gateway/limits';
import { NULL_LOGGER, type Logger } from '../obs';
import type { CardSourceSpec, DeckPool, DeckResult, DeckWorkerData, DeckWorkerReply } from './api';
import { DECK_WORKER_ENTRY, spawnWorker } from './spawn';

interface Job {
  id: number;
  deck: DeckSubmission;
  format: string;
  /** The cache key (F32). */
  key: string;
  resolve: (r: DeckResult) => void;
}

/** F32 defaults: a session's deck checks (1 every 2 s, bursts of 3) and the cache of checked lists (5 minutes, 512 lists). */
export const DECK_CHECKS_PER_SESSION: RateConfig = { rate: 0.5, burst: 3 };
export const DECK_CACHE_MS = 5 * 60_000;
export const DECK_CACHE_SIZE = 512;

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
  /** F32: a session's deck checks (default DECK_CHECKS_PER_SESSION). */
  perSession?: RateConfig;
  /** F32: how long a checked list is kept, and how many at most (defaults DECK_CACHE_MS, DECK_CACHE_SIZE; 0 turns the cache off). */
  cacheMs?: number;
  cacheSize?: number;
  /** Milliseconds (the pace and the cache); default Date.now. */
  now?: () => number;
}

export class DeckWorkerPool implements DeckPool {
  private readonly slots: Slot[] = [];
  private readonly queue: Job[] = [];
  private nextId = 1;
  private closed = false;
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly sessions: KeyBuckets;
  /** F32: checked lists by key, oldest first (a Map keeps insertion order). */
  private readonly cache = new Map<string, { at: number; result: DeckResult }>();
  /** F32: answers given from the cache (tests, metrics). */
  cacheHits = 0;

  constructor(private readonly o: DeckPoolOptions) {
    this.logger = o.logger ?? NULL_LOGGER;
    this.now = o.now ?? Date.now;
    this.sessions = new KeyBuckets(o.perSession ?? DECK_CHECKS_PER_SESSION);
    for (let i = 0; i < o.workers; i++) this.slots.push(this.spawn(i));
  }

  /** Resolves once every deck worker has its card source (or found it could not make one). */
  async ready(): Promise<void> {
    while (!this.closed && this.slots.some((s) => !s.ready && !s.broken)) await new Promise((r) => setTimeout(r, 20));
  }

  prepare(deck: DeckSubmission, format: string, session?: string): Promise<DeckResult> {
    const problem = checkDeckSubmission(deck);
    if (problem) return Promise.resolve({ ok: false, errors: [`The decklist is malformed (${problem}).`], warnings: [] });
    if (this.closed || this.slots.length === 0 || this.slots.every((s) => s.broken)) {
      return Promise.resolve({ ok: false, errors: ['Deck checks are not available on this server now.'], warnings: [], busy: true });
    }
    const now = this.now();
    const key = deckKey(deck, format);
    const hit = this.cached(key, now);
    if (hit) return Promise.resolve(hit);
    if (session !== undefined && !this.sessions.take(session, now)) {
      const retryAfterMs = Math.max(1, this.sessions.wait(session, now));
      return Promise.resolve({ ok: false, errors: ['You are checking decks too often; wait a moment.'], warnings: [], rateLimited: true, retryAfterMs });
    }
    if (this.queue.length >= this.o.queue) return Promise.resolve({ ok: false, errors: ['The server is checking many decks; try again shortly.'], warnings: [], busy: true });
    return new Promise((resolve) => {
      this.queue.push({ id: this.nextId++, deck, format, key, resolve });
      this.pump();
    });
  }

  /** F32: a copy of the answer for `key` when it is still fresh (a caller may change what it got: the cache keeps its own). */
  private cached(key: string, now: number): DeckResult | null {
    const e = this.cache.get(key);
    if (!e) return null;
    if (now - e.at >= (this.o.cacheMs ?? DECK_CACHE_MS)) {
      this.cache.delete(key);
      return null;
    }
    this.cacheHits++;
    return structuredClone(e.result);
  }

  /** F32: keep a worker's answer (bounded: the oldest goes first, expired ones too). */
  private remember(key: string, result: DeckResult): void {
    const ms = this.o.cacheMs ?? DECK_CACHE_MS;
    const size = this.o.cacheSize ?? DECK_CACHE_SIZE;
    if (ms <= 0 || size <= 0) return;
    const now = this.now();
    this.cache.delete(key);
    for (const [k, e] of this.cache) {
      if (this.cache.size < size && now - e.at < ms) break;
      this.cache.delete(k);
    }
    this.cache.set(key, { at: now, result: structuredClone(result) });
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
        if (slot.job?.id === m.id) {
          this.remember(slot.job.key, m.result);
          this.finish(slot, m.result);
        }
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

/** F32: the cache key of a list for a format: a SHA-256 of both (the list itself is never kept as a key: decklists are private). */
function deckKey(deck: DeckSubmission, format: string): string {
  return createHash('sha256').update(JSON.stringify([format, deck]), 'utf8').digest('hex');
}
