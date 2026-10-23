/** The runtime (design 2.1-2.3; package M13-5): game workers, routing, group commit, snapshots, recovery, the watchdog, drain, the deck pool, signals. */
export * from './api';
export { GameRuntime, DEFAULT_TUNING } from './runtime';
export { GroupCommitter, type CommitOutcome, type GroupCommitOptions } from './commit';
export { DeckWorkerPool, type DeckPoolOptions } from './deck-pool';
export { RuntimeSignals, percentile, CPU_WINDOW_MS, P95_WINDOW_MS, HEAP_MAX_AGE_MS } from './signals';
export { DEFAULT_CARD_SOURCE, DECK_WORKER_ENTRY, GAME_WORKER_ENTRY } from './spawn';
export { decodeSnapshot, encodeSnapshot, SNAPSHOT_FORMAT } from './snapshot';
export { DEFAULT_OUTAGE, isSettled, isTransient, withRetry, type OutagePolicy, type RetryHooks } from './outage';
export { PendingVoids, type PendingVoid } from './pending';
