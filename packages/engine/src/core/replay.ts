/**
 * Replay and undo. A game is (initial config, action log); replaying the log on a fresh
 * game reproduces the exact same state (seeded RNG, deterministic engine).
 */
import type { Action } from '../types/actions';
import type { GameState } from '../types/state';
import type { GameEvent } from '../types/events';
import { applyAction, type ActionError } from './apply';
import { createGame, type GameConfig } from './create';

export interface ReplayResult {
  state: GameState;
  /** Index and error of any action in the log that was rejected. */
  errors: { index: number; error: ActionError }[];
}

export function replay(config: GameConfig, actions: readonly Action[]): ReplayResult {
  let state = createGame(config);
  const errors: ReplayResult['errors'] = [];
  actions.forEach((a, index) => {
    const r = applyAction(state, a);
    if (r.error) errors.push({ index, error: r.error });
    else state = r.state;
  });
  return { state, errors };
}

/**
 * A game in progress with history, for UIs and bots. Keeps the intermediate states from its undo floor on, so undo is O(1); the action log alone is
 * enough to rebuild everything. `setFloor` drops the states below a point undo will never go back past (bounded memory in a long game); the log is
 * kept whole, so saving and replaying are unchanged.
 */
export class GameSession {
  readonly config: GameConfig;
  /** `history[i]` is the state after `base + i` actions of the log; the last one is the current state. */
  private readonly history: GameState[];
  /** How many logged actions lie before the first kept state (the undo floor). */
  private base = 0;
  private readonly log: Action[] = [];
  lastEvents: GameEvent[] = [];

  constructor(config: GameConfig) {
    this.config = config;
    this.history = [createGame(config)];
  }

  get state(): GameState {
    return this.history[this.history.length - 1]!;
  }

  get actions(): readonly Action[] {
    return this.log;
  }

  /** Undo never goes below this many logged actions (0 until `setFloor` raises it). */
  get floor(): number {
    return this.base;
  }

  apply(action: Action): { ok: true; events: GameEvent[] } | { ok: false; error: ActionError } {
    const r = applyAction(this.state, action);
    if (r.error) return { ok: false, error: r.error };
    this.history.push(r.state);
    this.log.push(action);
    this.lastEvents = r.events;
    return { ok: true, events: r.events };
  }

  /**
   * Undo will never go below `index` logged actions: the states before that point are dropped (the log is kept). The floor only rises; it is capped at
   * the log's length.
   */
  setFloor(index: number): void {
    const target = Math.min(Math.max(0, Math.floor(index)), this.log.length);
    if (target <= this.base) return;
    this.history.splice(0, target - this.base);
    this.base = target;
  }

  /** Undo the last `n` actions (rollback). Returns false if there is nothing to undo, or if it would go below the floor (`setFloor`). */
  undo(n = 1): boolean {
    if (n < 1 || this.log.length - n < this.base) return false;
    this.history.splice(this.history.length - n, n);
    this.log.splice(this.log.length - n, n);
    this.lastEvents = [];
    return true;
  }

  /** Serialize for saving: the config plus the action log. */
  toJSON(): { config: GameConfig; actions: Action[] } {
    return { config: this.config, actions: [...this.log] };
  }

  static fromJSON(data: { config: GameConfig; actions: Action[] }): GameSession {
    const s = new GameSession(data.config);
    for (const a of data.actions) {
      const r = s.apply(a);
      if (!r.ok) throw new Error(`Replay failed: ${r.error.message}`);
    }
    return s;
  }
}
