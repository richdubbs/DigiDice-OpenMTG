/**
 * A game worker (design 2.1, D3; package M13-5): a thread that holds table actors, one per table, and handles one message at a time from the main
 * thread (runtime/runtime.ts). It never touches the store, a socket or a timer: every message carries what it needs (the command and its time; a
 * recovery's records and snapshot), and every reply carries what the main thread commits and sends (`WireStep`, the checkpoint gzipped here so the JSON
 * work stays off the main thread).
 *
 * Started through runtime/boot.mjs (`workerData.data` is `GameWorkerData`).
 */
import { createHash } from 'node:crypto';
import { getHeapStatistics } from 'node:v8';
import { parentPort, workerData } from 'node:worker_threads';
import { createGame, type GameState } from '@openmtg/engine';
import type { LogFields, Logger, LogLevel, LogValue } from './obs';
import { decodeSnapshot, encodeSnapshot } from './runtime/snapshot';
import type { BootData, GameWorkerData, GameWorkerReply, GameWorkerRequest, HeapReading, WireStep } from './runtime/api';
import { TableActor } from './table/actor';
import { checkpointOf } from './table/limits';
import type { SnapshotLoss, TableStep } from './table/types';

const port = parentPort;
if (!port) throw new Error('worker.ts runs as a worker thread');
const data = (workerData as BootData<GameWorkerData>).data;
const actors = new Map<string, TableActor>();
/** Test hook: tables whose next command ends this thread (a poison action). */
const poisoned = new Set<string>();

function post(m: GameWorkerReply, transfer: ArrayBuffer[] = []): void {
  port!.postMessage(m, transfer);
}

function heap(): HeapReading {
  const h = getHeapStatistics();
  return { used: h.used_heap_size, limit: h.heap_size_limit };
}

/** Log lines go to the main thread's logger (the actor logs game, seat and action types only, never card names). */
const logger: Logger = {
  log(level: LogLevel, event: string, fields: LogFields = {}) {
    const clean: Record<string, LogValue> = {};
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) clean[k] = v;
    post({ kind: 'log', level, event, fields: { ...clean, worker: data.index } });
  },
  child() {
    return logger;
  },
};

function wire(step: TableStep, actor: TableActor): { step: WireStep; transfer: ArrayBuffer[] } {
  if (!step.checkpoint) return { step: { ...step, checkpoint: null }, transfer: [] };
  const known = new Set(Array.isArray(actor.config.defs) ? actor.config.defs.map((d) => d.id) : Object.keys(actor.config.defs));
  const bytes = encodeSnapshot(step.checkpoint.stateJson, Object.values(actor.state.defs).filter((d) => !known.has(d.id)), step.checkpoint.losses);
  return { step: { ...step, checkpoint: { seq: step.checkpoint.seq, hash: step.checkpoint.hash, gz: bytes } }, transfer: [bytes.buffer as ArrayBuffer] };
}

function stepReply(id: number, game: string, actor: TableActor, step: TableStep): void {
  const w = wire(step, actor);
  post({ kind: 'step', id, game, step: w.step, seq: actor.seq, engineErrors: actor.engineErrors, heap: heap() }, w.transfer);
}

/** The snapshot's state when it checks out (its text hashes to its hash, and the record at its seq carries the same hash); else null. */
function snapshotState(m: Extract<GameWorkerRequest, { kind: 'recover' }>): { state: GameState; seq: number; losses?: SnapshotLoss[] } | null {
  const s = m.snapshot;
  if (!s || s.seq < 1 || s.seq > m.records.length) return null;
  const { stateJson, defs, losses } = decodeSnapshot(s.state);
  if (createHash('sha256').update(stateJson, 'utf8').digest('hex') !== s.hash) return null;
  const at = m.records[s.seq - 1];
  if (!at || at.seq !== s.seq || (at.check !== undefined && at.check !== s.hash)) return null;
  const rest = JSON.parse(stateJson) as Omit<GameState, 'defs'>;
  const all = { ...createGame(m.config).defs };
  for (const d of defs) if (!all[d.id]) all[d.id] = d;
  return { state: { ...rest, defs: all } as GameState, seq: s.seq, ...(losses ? { losses } : {}) };
}

function recover(m: Extract<GameWorkerRequest, { kind: 'recover' }>): void {
  let from: ReturnType<typeof snapshotState> = null;
  try {
    from = snapshotState(m);
  } catch {
    from = null; // a damaged snapshot: replay from the first record
  }
  const mismatches: number[] = [];
  const { actor, step, fromSnapshot } = TableActor.recover({
    game: m.game, config: m.config, seating: m.seating, at: m.at, records: m.records, logger,
    ...(m.clock ? { clock: m.clock } : {}), ...(m.limits ? { limits: m.limits } : {}),
    ...(from ? { from } : {}),
    onRecord(rec, state) {
      if (rec.check !== undefined && checkpointOf(state).hash !== rec.check) mismatches.push(rec.seq);
      post({ kind: 'progress', id: m.id, game: m.game, seq: rec.seq });
    },
  });
  // The actor says whether it took the snapshot (F31: also after a loss, when the snapshot carries it; else it replays from the first record).
  const started = fromSnapshot ?? 0;
  actors.set(m.game, actor);
  const w = wire(step, actor);
  post(
    { kind: 'recovered', id: m.id, game: m.game, step: w.step, seq: actor.seq, engineErrors: actor.engineErrors, heap: heap(), mismatches, fromSnapshot: started > 0 ? started : null },
    w.transfer,
  );
}

function handle(m: GameWorkerRequest): void {
  switch (m.kind) {
    case 'start': {
      if (data.testHooks && poisoned.has(m.game)) process.exit(1);
      const { actor, step } = TableActor.start({
        game: m.game, config: m.config, seating: m.seating, at: m.at, logger,
        ...(m.connected ? { connected: m.connected } : {}), ...(m.clock ? { clock: m.clock } : {}), ...(m.limits ? { limits: m.limits } : {}),
      });
      actors.set(m.game, actor);
      return stepReply(m.id, m.game, actor, step);
    }
    case 'command': {
      if (data.testHooks && poisoned.has(m.game)) process.exit(1);
      const actor = actors.get(m.game);
      if (!actor) return post({ kind: 'failed', id: m.id, game: m.game, error: 'no such table on this worker' });
      // TableActor.handle never throws for anything a browser sent (audit C4); a failure inside is its engineError.
      return stepReply(m.id, m.game, actor, actor.handle(m.cmd));
    }
    case 'recover':
      return recover(m);
    case 'inspect': {
      const actor = actors.get(m.game);
      const info = actor ? { game: m.game, seq: actor.seq, hash: checkpointOf(actor.state).hash, ended: actor.ended !== null, engineErrors: actor.engineErrors } : null;
      return post({ kind: 'inspected', id: m.id, game: m.game, info });
    }
    case 'unload':
      actors.delete(m.game);
      return post({ kind: 'done', id: m.id, game: m.game });
    case 'hang': {
      if (!data.testHooks) return post({ kind: 'failed', id: m.id, game: m.game, error: 'test hooks are off' });
      // A stuck action, as the watchdog sees it: the thread does nothing else until the time has passed.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, m.ms);
      return post({ kind: 'done', id: m.id, game: m.game });
    }
    case 'exit': {
      if (!data.testHooks) return post({ kind: 'failed', id: m.id, game: m.game, error: 'test hooks are off' });
      // Answered first: the thread then ends between messages (nothing in flight, no suspect).
      post({ kind: 'done', id: m.id, game: m.game });
      setTimeout(() => process.exit(m.code), 20);
      return;
    }
    case 'poison': {
      if (!data.testHooks) return post({ kind: 'failed', id: m.id, game: m.game, error: 'test hooks are off' });
      poisoned.add(m.game);
      return post({ kind: 'done', id: m.id, game: m.game });
    }
  }
}

port.on('message', (m: GameWorkerRequest) => {
  try {
    handle(m);
  } catch (e) {
    const game = 'game' in m ? m.game : '';
    post({ kind: 'failed', id: m.id, game, error: e instanceof Error ? `${e.name}: ${e.message}` : 'error' });
  }
});

post({ kind: 'ready' });
