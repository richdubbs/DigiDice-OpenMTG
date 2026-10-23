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
 * A game in progress with history, for UIs and bots. Keeps every intermediate state so
 * undo is O(1); the action log alone is enough to rebuild everything.
 */
export class GameSession {
  readonly config: GameConfig;
  private readonly history: GameState[];
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

  apply(action: Action): { ok: true; events: GameEvent[] } | { ok: false; error: ActionError } {
    const r = applyAction(this.state, action);
    if (r.error) return { ok: false, error: r.error };
    this.history.push(r.state);
    this.log.push(action);
    this.lastEvents = r.events;
    return { ok: true, events: r.events };
  }

  /** Undo the last `n` actions (rollback). Returns false if there is nothing to undo. */
  undo(n = 1): boolean {
    if (this.log.length < n || n < 1) return false;
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
