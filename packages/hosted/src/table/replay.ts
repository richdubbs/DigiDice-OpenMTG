/**
 * Replay from the log (design D4, D5): a game is its configuration (seed included) and its committed records; applying the records' actions in `seq`
 * order to a fresh game gives the live state exactly (the engine is pure and deterministic per build). The runtime's recovery (M13-5) starts from a
 * snapshot instead and compares checkpoint hashes; `TableActor.recover` rebuilds a whole table from the records.
 */
import { applyAction, createGame, type GameConfig, type GameState } from '@openmtg/engine';
import type { LogRecord } from '../store/api';
import { checkpointOf } from './limits';

export interface ReplayCheck {
  state: GameState;
  /** Records whose checkpoint hash (`check`) differs from the replayed state's (an engine bug under the same build; another build: void). */
  mismatches: number[];
}

/** Replays the records from the start; throws if a record does not apply or is out of order. Checks every checkpoint hash on the way. */
export function replayRecords(config: GameConfig, records: readonly LogRecord[], from?: { state: GameState; seq: number }): ReplayCheck {
  let state = from ? from.state : createGame(config);
  let seq = from ? from.seq : 0;
  const mismatches: number[] = [];
  for (const rec of records) {
    if (rec.seq !== seq + 1) throw new Error(`replayRecords: expected record ${seq + 1}, got ${rec.seq}`);
    const r = applyAction(state, rec.action);
    if (r.error) throw new Error(`replayRecords: record ${rec.seq} does not apply: ${r.error.message}`);
    state = r.state;
    seq = rec.seq;
    if (rec.check !== undefined && checkpointOf(state).hash !== rec.check) mismatches.push(rec.seq);
  }
  return { state, mismatches };
}
