/**
 * Review 2026-10-26 F1: a local game (hot-seat, or against the computer) whose engine and AI run in the game worker (game.worker.ts, gameHost.ts), so
 * the page's thread only draws. Before this, each computer move cost the page about 15 ms on average and over 50 at the 95th percentile (applyAction,
 * viewFor twice, legalActions, chooseAction): a third of the moves dropped a frame, late-game combat answers took 150 ms.
 *
 * It is the screen's `GameConnection` (kind `'local'`) exactly as LocalConnection and ComputerGame are: it holds the last snapshot the worker posted
 * (`change`), and `view()`, `legalActions()`, `handoff()`, `canUndo()`, `status()`, `events()` and `seated()` return it, the same objects until the next
 * change, which `subscribe` announces. What the page receives is what LocalConnection would give it: the shown player's `viewFor` (a spectator view while
 * a hand-off is pending), that player's legal actions and the events redacted for that view (CR 400.2); never a `GameState`. A view comes whole or as a
 * patch of the last one (core/view-patch.ts), so the parts of the board that did not change keep their identity.
 *
 * Differences from a game on the page, all of them asynchronous by nature:
 * - `act` resolves once the worker has applied the action, after the change it made (as LocalConnection's `act`, whose promise also settles after it).
 * - `undo()` and `acceptHandoff()` are sent; the change follows. `undo()` answers from the last snapshot's `canUndo` (the worker checks again);
 *   `undoNow()` waits for its answer.
 * - Before the worker's first change, a game started by `rematch` (which must give a connection at once) shows the first snapshot of the same game
 *   worked out once on the page (`bootstrap`); a New game waits for `ready` instead and never does.
 *
 * The replay recorder (replays/recorder.ts) reads it as a `RecordSource` (`recordSource()`): the config (which the page built), and for each applied
 * action the checkpoint and the last state's facts the worker works out. The computers' pace (F8): `attachPacer` forwards the game screen's
 * PacedConnection to the worker (`shown { seq }` when it has shown everything), registered for `attachComputerPacer` like a ComputerGame.
 */
import { PatchError, applyViewPatch, type Action, type GameConfig, type GameView, type LegalAction, type PlayerId } from '@openmtg/engine';
import { withComputerStops } from '../game/computer';
import { registerComputerPacing, type ComputerPacer } from '../game/computerPacer';
import { sealConnection } from '../game/sealed';
import type { RecordEnd, RecordObserver, RecordSource, RecordedStep } from '../replays/recordSource';
import { registerGameCloser } from './closeGame';
import { startEngineWorker } from './engineWorker';
import type { ActResult, EventBatch, GameConnection } from './GameConnection';
import type { ChangeMessage, FromWorker, GameSpec, SavedGame, ToWorker } from './gameWorkerProtocol';

/** What a WorkerConnection needs of a Worker (tests pass one that runs gameHost.ts in their own thread). */
export interface WorkerLike {
  onmessage: ((e: { data: FromWorker }) => void) | null;
  onerror: ((e: { message?: string }) => void) | null;
  postMessage(message: ToWorker): void;
  terminate(): void;
}

/** The first snapshot of a game, worked out on the page when the screen needs one before the worker's first change (see the file comment). */
export interface Snapshot {
  view: GameView;
  legal: readonly LegalAction[];
  events: EventBatch;
  handoff: PlayerId | null;
  canUndo: boolean;
  status: string | null;
  seated: readonly PlayerId[];
}

export interface WorkerConnectionOptions {
  /** Starts the worker (default: the game worker of this build). */
  worker?: () => WorkerLike;
  /** The first snapshot, for a screen that reads the connection before the worker answers (default: none; reading then throws). */
  bootstrap?: () => Snapshot;
}

const EMPTY_BATCH: EventBatch = { seq: 0, events: [] };

function startGameWorker(): WorkerLike {
  return startEngineWorker('openmtg-game') as unknown as WorkerLike;
}

/** Whether games can run in a worker in this browser. */
export function gameWorkerAvailable(): boolean {
  return typeof Worker !== 'undefined';
}

const reject = (message: string): ActResult => ({ ok: false, error: { message, rules: [] } });

export class WorkerConnection implements GameConnection {
  readonly kind = 'local' as const;
  /** The game's config as the worker runs it (a game against the computer: with the computers' stops). */
  readonly config: GameConfig;
  /** Settles true with the worker's first change, false when the worker failed before it. */
  readonly ready: Promise<boolean>;
  private settleReady!: (ok: boolean) => void;
  private worker: WorkerLike | null;
  private snap: Snapshot | null = null;
  /** The last change taken (0: none yet; a bootstrap snapshot is not one). */
  private seq = 0;
  /** Set when the worker failed or was closed: the screen shows it, and nothing more is sent. */
  private broken: string | null = null;
  private readonly listeners = new Set<() => void>();
  private nextId = 1;
  private readonly acts = new Map<number, (r: ActResult) => void>();
  private readonly undos = new Map<number, (ok: boolean) => void>();
  private readonly saves = new Map<number, { resolve: (g: SavedGame) => void; reject: (e: Error) => void }>();
  /** The log as the worker told it (for the recorder), and the facts of its last state. */
  private readonly steps: RecordedStep[] = [];
  private end: RecordEnd | null = null;
  private readonly observers = new Set<RecordObserver>();
  /** The game screen's pace, while attached, and the last change reported shown. */
  private pacer: ComputerPacer | null = null;
  private shownSent = 0;

  private constructor(
    config: GameConfig,
    start: ToWorker,
    readonly game: GameSpec,
    private readonly opts: WorkerConnectionOptions,
  ) {
    this.config = config;
    this.ready = new Promise<boolean>((resolve) => (this.settleReady = resolve));
    let worker: WorkerLike | null = null;
    try {
      worker = (opts.worker ?? startGameWorker)();
    } catch (e) {
      this.fail(`The game could not start in the background: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.worker = worker;
    if (worker) {
      worker.onmessage = (e) => this.receive(e.data);
      worker.onerror = (e) => this.fail(`The game stopped: ${e.message ?? 'its background thread failed'}.`);
      this.post(start);
    }
    if (game.kind === 'computer') registerComputerPacing(this, this);
    // The worker stops when the game leaves the screen for good (app/nav.tsx).
    registerGameCloser([this, sealConnection(this)], () => this.close());
  }

  /** A hot-seat game (every player at this screen, or `seats`), as `new LocalConnection(config, { seats })`. */
  static hotSeat(config: GameConfig, opts: WorkerConnectionOptions & { seats?: readonly PlayerId[] } = {}): WorkerConnection {
    const game: GameSpec = { kind: 'hotseat', ...(opts.seats ? { seats: opts.seats } : {}) };
    return new WorkerConnection(config, { t: 'start', game, config }, game, opts);
  }

  /** A game against the computer, as `new ComputerGame(config, humans, computers, { delayMs, seed })` (the AI is the worker's own). */
  static computer(
    config: GameConfig,
    humans: PlayerId | readonly PlayerId[],
    computers: PlayerId | readonly PlayerId[],
    computerOpts: { delayMs: number; seed: string; maxBoardWaitMs?: number },
    opts: WorkerConnectionOptions = {},
  ): WorkerConnection {
    const list = (p: PlayerId | readonly PlayerId[]) => (typeof p === 'string' ? [p] : [...p]);
    const game: GameSpec = { kind: 'computer', humans: list(humans), computers: list(computers), ...computerOpts };
    // The worker's ComputerGame gives the computers the AI's stops; the recorder's config must be that one (replays play it back exactly).
    const stopped = withComputerStops(config, game.computers);
    return new WorkerConnection(stopped, { t: 'start', game, config: stopped }, game, opts);
  }

  /** A saved game (`save()`, GameSession.toJSON) continued in a new worker. */
  static restore(saved: SavedGame, game: GameSpec, opts: WorkerConnectionOptions = {}): WorkerConnection {
    return new WorkerConnection(saved.config, { t: 'restore', game, saved }, game, opts);
  }

  // ---- the worker ----------------------------------------------------------------------------------------------------------------

  private post(m: ToWorker): void {
    if (this.broken !== null || !this.worker) return;
    try {
      this.worker.postMessage(m);
    } catch (e) {
      this.fail(`The game stopped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private receive(m: FromWorker): void {
    switch (m.t) {
      case 'change':
        this.take(m);
        return;
      case 'reply':
        this.acts.get(m.id)?.(m.result);
        this.acts.delete(m.id);
        return;
      case 'undone':
        this.undos.get(m.id)?.(m.ok);
        this.undos.delete(m.id);
        return;
      case 'saved':
        this.saves.get(m.id)?.resolve(m.game);
        this.saves.delete(m.id);
        return;
      case 'error':
        console.error('[WorkerConnection] the game worker could not handle a message:', m.message);
        if (this.snap === null) this.fail(`The game could not start: ${m.message}`);
        return;
    }
  }

  private take(m: ChangeMessage): void {
    const prev = this.snap;
    let view = m.view ?? prev?.view;
    if (m.patch && prev) {
      try {
        view = applyViewPatch(prev.view, m.patch);
      } catch (e) {
        if (!(e instanceof PatchError)) throw e;
        // Should never happen (the messages arrive in order): keep the last view and ask for the whole one, which comes as the next change.
        console.error('[WorkerConnection] a view patch did not fit; asking for the whole view', e);
        view = prev.view;
        this.post({ t: 'sync' });
      }
    }
    if (!view) {
      this.post({ t: 'sync' });
      return;
    }
    this.seq = m.seq;
    this.snap = {
      view,
      legal: m.legal ?? prev?.legal ?? [],
      events: m.events ?? prev?.events ?? EMPTY_BATCH,
      handoff: m.handoff,
      canUndo: m.canUndo,
      status: m.status,
      seated: m.seated,
    };
    if (m.log) {
      if (m.end !== undefined) this.end = m.end;
      for (const c of m.log) {
        if (c.kind === 'applied') {
          this.steps.length = Math.min(this.steps.length, c.step.index);
          this.steps.push(c.step);
        } else this.steps.length = Math.min(this.steps.length, c.length);
        this.tell((o) => (c.kind === 'applied' ? o.step(c.step) : o.undone(c.length)));
      }
    }
    this.settleReady(true); // the first change (a promise settles once)
    this.changed();
  }

  /** The worker failed (or was closed): every waiting call is answered, the screen shows why, and nothing more is sent. */
  private fail(message: string): void {
    if (this.broken !== null) return;
    this.broken = message;
    console.error('[WorkerConnection]', message);
    try {
      this.worker?.terminate();
    } catch {
      /* already gone */
    }
    this.worker = null;
    for (const done of this.acts.values()) done(reject(message));
    this.acts.clear();
    for (const done of this.undos.values()) done(false);
    this.undos.clear();
    for (const s of this.saves.values()) s.reject(new Error(message));
    this.saves.clear();
    this.settleReady(false);
    if (this.snap) this.snap = { ...this.snap, legal: [], canUndo: false, status: message };
    this.changed();
  }

  /** Stop the game and its worker (the game left the screen for good). Idempotent. */
  close(): void {
    if (this.broken !== null) return;
    this.broken = 'The game was closed.';
    try {
      this.worker?.terminate();
    } catch {
      /* already gone */
    }
    this.worker = null;
    for (const done of this.acts.values()) done(reject(this.broken));
    this.acts.clear();
    for (const done of this.undos.values()) done(false);
    this.undos.clear();
    for (const s of this.saves.values()) s.reject(new Error(this.broken));
    this.saves.clear();
    this.settleReady(false);
  }

  private changed(): void {
    for (const l of [...this.listeners]) l();
  }

  private tell(call: (o: RecordObserver) => void): void {
    for (const o of [...this.observers]) {
      try {
        call(o);
      } catch (e) {
        console.error('[WorkerConnection] log observer failed', e);
      }
    }
  }

  private current(): Snapshot {
    if (!this.snap) {
      if (!this.opts.bootstrap) throw new Error('WorkerConnection: read before the game worker answered (await `ready`).');
      this.snap = this.opts.bootstrap();
    }
    return this.snap;
  }

  // ---- GameConnection ------------------------------------------------------------------------------------------------------------

  readonly view = (): GameView => this.current().view;
  readonly legalActions = (): readonly LegalAction[] => this.current().legal;
  readonly handoff = (): PlayerId | null => this.current().handoff;
  readonly canUndo = (): boolean => this.current().canUndo;
  readonly seated = (): readonly PlayerId[] => this.current().seated;
  readonly events = (): EventBatch => this.current().events;
  readonly status = (): string | null => this.current().status;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.post({ t: 'watch', on: true });
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.post({ t: 'watch', on: false });
    };
  };

  readonly act = (action: Action): Promise<ActResult> => {
    if (this.broken !== null) return Promise.resolve(reject(this.broken));
    const id = this.nextId++;
    return new Promise<ActResult>((resolve) => {
      this.acts.set(id, resolve);
      this.post({ t: 'act', id, action });
    });
  };

  /** Undo, answered when the worker has done it (true) or refused (false). */
  readonly undoNow = (): Promise<boolean> => {
    if (this.broken !== null || !this.current().canUndo) return Promise.resolve(false);
    const id = this.nextId++;
    // Nothing more to undo until the worker's change says otherwise (a second click must not take back a second action unseen).
    this.snap = { ...this.current(), canUndo: false };
    const answered = new Promise<boolean>((resolve) => {
      this.undos.set(id, resolve);
      this.post({ t: 'undo', id });
    });
    this.changed();
    return answered;
  };

  readonly undo = (): boolean => {
    if (!this.canUndo()) return false;
    void this.undoNow();
    return true;
  };

  readonly acceptHandoff = (): void => {
    if (this.current().handoff !== null) this.post({ t: 'acceptHandoff' });
  };

  // ---- the computers' pace (F8) --------------------------------------------------------------------------------------------------

  /** The game screen's pace: the worker's computers wait until it has shown every change. Returns the function that detaches it. */
  attachPacer(pacer: ComputerPacer): () => void {
    this.pacer = pacer;
    this.post({ t: 'pacer', on: true });
    const report = () => {
      if (this.pacer === pacer && !pacer.busy() && this.seq > this.shownSent) {
        this.shownSent = this.seq;
        this.post({ t: 'shown', seq: this.seq });
      }
    };
    const off = pacer.subscribe(report);
    report();
    return () => {
      off();
      if (this.pacer !== pacer) return;
      this.pacer = null;
      this.post({ t: 'pacer', on: false });
    };
  }

  // ---- save and the replay recorder ----------------------------------------------------------------------------------------------

  /** Save data: the config and the action log (GameSession.fromJSON, or `WorkerConnection.restore`, continues it). */
  save(): Promise<SavedGame> {
    if (this.broken !== null) return Promise.reject(new Error(this.broken));
    const id = this.nextId++;
    return new Promise<SavedGame>((resolve, rejectSave) => {
      this.saves.set(id, { resolve, reject: rejectSave });
      this.post({ t: 'save', id });
    });
  }

  /** What the replay recorder reads of this game (replays/recordSource.ts). */
  recordSource(): RecordSource {
    return {
      config: this.config,
      players: this.view().players.map((p) => ({ id: p.id, name: p.name })),
      seated: () => this.seated(),
      actions: () => this.steps.map((s) => s.action),
      steps: (from) => this.steps.slice(from),
      end: () => this.end,
      observe: (o) => {
        this.observers.add(o);
        return () => {
          this.observers.delete(o);
        };
      },
    };
  }
}

/**
 * The first snapshot of a game, worked out on the page once (a rematch's screen reads its connection before the worker answers): the snapshot the worker
 * will send first, from a throwaway LocalConnection with the same seats. Only its view and legal actions are kept (CR 400.2: the session is dropped).
 */
export function bootstrapFrom(make: () => GameConnection): () => Snapshot {
  return () => {
    const c = make();
    return {
      view: c.view(),
      legal: c.legalActions(),
      events: c.events?.() ?? EMPTY_BATCH,
      handoff: c.handoff(),
      canUndo: c.canUndo(),
      status: c.status?.() ?? null,
      seated: c.seated?.() ?? [],
    };
  };
}
