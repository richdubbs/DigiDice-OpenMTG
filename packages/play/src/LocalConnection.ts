/**
 * Hot-seat connection: the engine runs in the browser through `GameSession` (undo and save come from it). The screen shows the view of the player who
 * must act (`viewFor`, docs/ARCHITECTURE.md "Hidden information"); when that player changes, `handoff()` names the next player and `view()` becomes a
 * spectator view until they accept, so the previous player's hand is never on screen when the next player sits down.
 *
 * Against the computer (C6): `seats` names the players who sit at this screen. With one seat the screen always shows that player's view and never hands
 * off; every other player acts through `seat(player)`, a connection of its own whose view is that player's `viewFor` (CR 400.2: the computer sees only
 * what its player may see) and which can act only for that player.
 *
 * Godot plan phase 1: moved here from packages/client/src/connection (no React, no DOM), so the local server's table channel runs the same games; the
 * client's connection/LocalConnection.ts re-exports it.
 */
import {
  GameSession, decidingPlayer, legalActions as engineLegalActions, mayActAs, replayedEvents, viewFor, type Action, type ActionError, type GameConfig, type GameEvent, type GameState,
  type GameView, type LegalAction, type PlayerId,
} from '@openmtg/engine';
import type { ActResult, EventBatch, GameConnection } from './GameConnection';
import { eventsForViewer } from './redactEvents';
import { irreversibleReason } from './undoFloor';

export interface LocalConnectionOptions {
  /** The players who sit at this screen; default every player (hot-seat). The others act through `seat(player)`. */
  seats?: readonly PlayerId[];
}

/**
 * RPL-1 (replays design 7.1): told of every change of the game's log, for the replay recorder (replays/recorder.ts). Called after the change, before
 * the screen's listeners; an observer that throws is logged and never stops the game.
 */
export interface LogObserver {
  /** The action at `index` of the log was applied: `before` is the state it was applied to, `after` the state it made. */
  applied(action: Action, index: number, before: GameState, after: GameState): void;
  /** Undo took actions back: the log now holds `length` actions. */
  undone(length: number): void;
}

function reject(message: string): ActResult {
  const error: ActionError = { message, rules: [] };
  return { ok: false, error };
}

export class LocalConnection implements GameConnection {
  readonly kind = 'local' as const;
  readonly session: GameSession;
  /** The player whose view is on screen (null until the first hand-off is accepted). */
  private shown: PlayerId | null = null;
  private cached: GameView | null = null;
  private cachedLegal: readonly LegalAction[] | null = null;
  private readonly listeners = new Set<() => void>();
  /**
   * Undo never goes below this many logged actions: it is the log length after the last action that can never be taken back (undoFloor.ts, CR 733.1).
   * A restored game starts with its whole log below the floor, since nothing says which of those actions showed hidden cards. The session is told each
   * time the floor moves (`GameSession.setFloor`): the states below it are never needed again, so a long game's memory stays bounded.
   */
  private floor: number;
  /** The players at this screen (null: every player). */
  private readonly seats: ReadonlySet<PlayerId> | null;
  /** Cached views and legal actions of the other players' seats (seat()), cleared on every change like `cached`. */
  private readonly seatCache = new Map<PlayerId, { view?: GameView; legal?: readonly LegalAction[] }>();
  /**
   * The last applied action's events as the engine returned them, with the state right after them and the state before them (the one the screen showed,
   * for redaction), and its sequence number.
   */
  private lastApplied: { seq: number; events: readonly GameEvent[]; state: GameState | null; before: GameState | null } =
    { seq: 0, events: [], state: null, before: null };
  private cachedBatch: EventBatch | null = null;
  private readonly observers = new Set<LogObserver>();

  constructor(source: GameConfig | GameSession, opts: LocalConnectionOptions = {}) {
    this.session = source instanceof GameSession ? source : new GameSession(source);
    this.floor = this.session.actions.length;
    this.session.setFloor(this.floor);
    const ids = this.session.state.players.map((p) => p.id);
    if (opts.seats) {
      const unknown = opts.seats.filter((p) => !ids.includes(p));
      if (unknown.length > 0 || opts.seats.length === 0) throw new Error(`LocalConnection: no such player to seat: ${unknown.join(', ') || '(none given)'}`);
    }
    this.seats = opts.seats ? new Set(opts.seats) : null;
    // A single seat is always on screen: nobody else sits here, so there is never anything to hide by a hand-off.
    if (opts.seats?.length === 1) this.shown = opts.seats[0]!;
  }

  private isSeat(p: PlayerId): boolean {
    return this.seats === null || this.seats.has(p);
  }

  /** The players who sit at this screen (hot-seat: every player). */
  readonly seated = (): readonly PlayerId[] => this.session.state.players.map((p) => p.id).filter((p) => this.isSeat(p));

  /** The player the engine waits for (null once the game is over). */
  private actor(): PlayerId | null {
    const d = this.session.state.pending;
    return d ? decidingPlayer(d) : null; // std-control-3 (CR 723.5): the player who controls the one asked
  }

  private nameOf(id: PlayerId): string {
    return this.session.state.players.find((p) => p.id === id)?.name ?? id;
  }

  private changed(): void {
    this.cached = null;
    this.cachedLegal = null;
    this.cachedBatch = null;
    this.seatCache.clear();
    for (const l of [...this.listeners]) l();
  }

  readonly view = (): GameView => {
    this.cached ??= viewFor(this.session.state, this.handoff() === null ? this.shown : null);
    return this.cached;
  };

  /**
   * The last applied action's events, redacted for the player `view()` shows (a spectator during a hand-off), like the view itself (CR 400.2). With the
   * state the screen showed before the action (`before`, as packages/net passes each guest the state of its last view), so a card of another player's
   * hand that was revealed to the viewer keeps its id as it leaves that hand (RPL-0 review: local and online games redact alike).
   */
  readonly events = (): EventBatch => {
    if (!this.cachedBatch) {
      const { seq, events, state, before } = this.lastApplied;
      const viewer = this.handoff() === null ? this.shown : null;
      this.cachedBatch = { seq, events: state === null ? [] : eventsForViewer(state, events, viewer, before === null ? {} : { before }) };
    }
    return this.cachedBatch;
  };

  readonly legalActions = (): readonly LegalAction[] => {
    this.cachedLegal ??= this.shown !== null && this.handoff() === null ? engineLegalActions(this.session.state, this.shown) : [];
    return this.cachedLegal;
  };

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The next player to sit down; never a player who does not sit here (the computer acts through its own seat while this screen keeps its view). */
  readonly handoff = (): PlayerId | null => {
    const a = this.actor();
    return a !== null && a !== this.shown && this.isSeat(a) ? a : null;
  };

  readonly acceptHandoff = (): void => {
    const next = this.handoff();
    if (next === null) return;
    this.shown = next;
    this.changed();
  };

  /** Async, so that an unexpected engine error (anything but an illegal action) becomes a rejection the caller sees, never an uncaught throw. */
  readonly act = async (action: Action): Promise<ActResult> => {
    try {
      return this.actNow(action);
    } catch (e) {
      console.error('[LocalConnection] engine error', action, e);
      return reject(`Engine error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  private actNow(action: Action): ActResult {
    if (action.type === 'startGame') return reject('The game has already started.');
    // CR 104.3a: a player can concede at any time, so neither the screen nor a pending hand-off stops it.
    if (action.type === 'concede') return this.isSeat(action.player) ? this.apply(action) : reject('Only a player at this screen can concede here.');
    const next = this.handoff();
    if (next !== null) return reject(`Pass the screen to ${this.nameOf(next)} first.`);
    // std-control-3 (CR 723.5): the shown player also acts for a player they control
    if (this.shown === null || !mayActAs(this.session.state, this.shown, action)) return reject(`Only ${this.shown === null ? 'the player on screen' : this.nameOf(this.shown)} can act on this screen.`);
    return this.apply(action);
  }

  private apply(action: Action): ActResult {
    const prev = this.session.state;
    // The player this screen showed `prev` to (a spectator while a hand-off was pending).
    const viewer = this.handoff() === null ? this.shown : null;
    const r = this.session.apply(action);
    if (!r.ok) return { ok: false, error: r.error };
    if (irreversibleReason(prev, this.session.state) !== null) {
      this.floor = this.session.actions.length;
      this.session.setFloor(this.floor);
    }
    // An answer re-runs its action from the start (engine core/apply.ts): the events this screen was given while the decision waited come again first,
    // and are dropped, so a trigger that resolved before the cleanup's discard (CR 514.1) is not animated a second time.
    const replayed = replayedEvents(prev, action, viewer);
    this.lastApplied = { seq: this.lastApplied.seq + 1, events: replayed > 0 ? r.events.slice(replayed) : r.events, state: this.session.state, before: prev };
    this.tell((o) => o.applied(action, this.session.actions.length - 1, prev, this.session.state));
    this.changed();
    return { ok: true };
  }

  /** RPL-1: watch the game's log (the replay recorder). Returns the function that stops watching. */
  observeLog(observer: LogObserver): () => void {
    this.observers.add(observer);
    return () => {
      this.observers.delete(observer);
    };
  }

  private tell(call: (o: LogObserver) => void): void {
    for (const o of [...this.observers]) {
      try {
        call(o);
      } catch (e) {
        console.error('[LocalConnection] log observer failed', e);
      }
    }
  }

  /**
   * Undo takes back only the shown player's own last action, and never one that cannot be reversed (undoFloor.ts: library changes, shuffles, revealed
   * or seen hidden cards, random results, CR 733.1, CR 400.2) or a finished game (CR 104.1). The opponent's automatic passes run inside the shown
   * player's action, so this floor, not the action's owner, is what keeps hidden information from being taken back.
   */
  readonly canUndo = (): boolean => {
    const log = this.session.actions;
    const last = log[log.length - 1];
    if (this.session.state.result || log.length <= this.floor) return false;
    return this.handoff() === null && this.shown !== null && last !== undefined && last.type !== 'startGame' && last.player === this.shown;
  };

  readonly undo = (): boolean => {
    if (!this.canUndo() || !this.session.undo(1)) return false;
    this.tell((o) => o.undone(this.session.actions.length));
    this.changed();
    return true;
  };

  /**
   * The connection of a player who does not sit at this screen (the computer opponent): its view is that player's own `viewFor` (never more, CR 400.2),
   * its legal actions are that player's, and it acts only for that player. No undo and no hand-off. Throws for a player who sits here.
   */
  seat(player: PlayerId): GameConnection {
    if (this.isSeat(player) || !this.session.state.players.some((p) => p.id === player)) throw new Error(`LocalConnection.seat: ${player} is not a player away from this screen`);
    const cache = () => {
      let c = this.seatCache.get(player);
      if (!c) this.seatCache.set(player, (c = {}));
      return c;
    };
    const act = async (action: Action): Promise<ActResult> => {
      try {
        if (action.type === 'startGame') return reject('The game has already started.');
        if (!mayActAs(this.session.state, player, action)) return reject(`This seat acts only for ${this.nameOf(player)}.`); // std-control-3: and a player it controls (CR 723.5)
        return this.apply(action);
      } catch (e) {
        console.error('[LocalConnection] engine error', action, e);
        return reject(`Engine error: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    return {
      kind: 'local',
      view: () => (cache().view ??= viewFor(this.session.state, player)),
      legalActions: () => (cache().legal ??= engineLegalActions(this.session.state, player)),
      act,
      subscribe: this.subscribe,
      canUndo: () => false,
      undo: () => false,
      handoff: () => null,
      acceptHandoff: () => {},
      seated: () => [player],
    };
  }

  /** Save data: the config and the action log (GameSession.fromJSON restores it). */
  save(): ReturnType<GameSession['toJSON']> {
    return this.session.toJSON();
  }
}
