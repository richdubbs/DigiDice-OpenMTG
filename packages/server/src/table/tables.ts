/**
 * The tables of the table channel (Godot plan phase 1; table/api.ts): each one a `GameConnection` (@openmtg/play) run in this process, a hot-seat
 * `LocalConnection` or a `ComputerGame`, and the sender that turns its changes into the channel's messages for the one screen attached to it.
 *
 * The sender (per table: a table is one screen, its seats are the players who sit at it): on every change of the connection (`subscribe`) it takes
 * `view()`, `legalActions()`, `handoff()`, `canUndo()`, `status()`, `clocks()` and `events()`, and sends a `patch` of the last view sent
 * (@openmtg/play `viewDelta`) with the change's events, or a full `view` on attach, when the viewer changed, when the patch is too long, and when the
 * screen is more than MAX_SHOWN_LAG changes behind what it acknowledged (`shown`). Sequence numbers grow by one per change. Only `viewFor` views and
 * events redacted for them (`LocalConnection.events()`, the engine's `eventsFor`) are ever sent (CR 400.2).
 *
 * Staleness (packages/hosted table/actor.ts `lastProgressSeq`, review Finding 28): the seq after the last change that was not a stop toggle; an `act`
 * chosen from an older view (or from a seq not sent yet) is refused, never half-applied. A stop toggle (`setStops`) and a concession (CR 104.3a: a
 * player can concede at any time) are never stale.
 *
 * Pace (review Finding 8, game/computer.ts in @openmtg/play): a computer table's computers wait while the screen has not shown the latest change
 * (`shown`), at most COMPUTER_MAX_BOARD_WAIT_MS (inside `runComputer`), then pause `delayMs`. They play only while a screen is attached (ComputerGame
 * plays from its first subscriber to its last; the sender is that subscriber).
 */
import { randomBytes } from 'node:crypto';
import type { Action, GameConfig, GameEvent, GameView, PlayerId, StopSettings } from '@openmtg/engine';
import { ComputerGame, LocalConnection, computerDelayMs, viewDelta, type Chooser, type ComputerPacer, type GameConnection } from '@openmtg/play';
import type { GameRecording, RecordingInfo } from '../library/replays';
import { gameCapture, makeBugReport, replayCapture, type BugCapture } from './bugs';
import { isReplay, offersReport, perspectiveOf, replayFileOf, replayStateOf, type ReplayConnection } from './replay';
import type { ReportEnvironment, ReportHolds } from '@openmtg/play/bugs/report';
import {
  MAX_SHOWN_LAG, STALE_MESSAGE, TABLE_IDLE_MS, type ActionErrorBody, type ReplyMessage, type StartMessage, type TableKind, type TableServerMessage, type TableSpeed,
} from './api';

/** Where a table's messages go: the socket attached to it. */
export interface TableSink {
  send(m: TableServerMessage): void;
}

export interface TablesOptions {
  /** The computers' AI (default packages/ai `chooseAction`); tests pass their own. */
  choose?: Chooser;
  /** The computer's pause before each action at a speed (default @openmtg/play `computerDelayMs`); tests pass a short one. */
  delayMs?: (speed: TableSpeed) => number;
  /** The longest the computer waits for a busy screen before acting anyway (default @openmtg/play COMPUTER_MAX_BOARD_WAIT_MS). */
  maxBoardWaitMs?: number;
  /** How long a table with no socket is kept for an `attach` (ms; default TABLE_IDLE_MS). */
  idleMs?: number;
  /** The most tables kept at once (default 8): starting one more closes the one detached longest, or is refused when every table is in use. */
  maxTables?: number;
  /**
   * Record each game as a replay (library/replays.ts): called once per table with the game's facts, it gives the recording the table's log feeds
   * (absent: games are not recorded; tests).
   */
  record?: (info: Omit<RecordingInfo, 'version'>) => GameRecording;
}

export class TableError extends Error {}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The ids of a config's players, as the engine gives them (core/create.ts: `p<n>` when the config names none). */
export function playerIds(config: GameConfig): PlayerId[] {
  return config.players.map((p, i) => p.id ?? `p${i + 1}`);
}

function isIdList(x: unknown): x is PlayerId[] {
  return Array.isArray(x) && x.every((p) => typeof p === 'string');
}

/** The table's game from a `start` message: a hot-seat LocalConnection or a ComputerGame. Throws a TableError saying what is wrong. */
function buildGame(m: StartMessage, opts: TablesOptions): { kind: 'hotseat' | 'computer'; game: GameConnection; computer: ComputerGame | null } {
  if (m.kind === 'online' || m.kind === 'hosted') throw new TableError(`A table of kind "${m.kind}" cannot be started over the table channel yet.`);
  if (m.kind !== 'hotseat' && m.kind !== 'computer') throw new TableError('Unknown table kind.');
  const config = m.config;
  if (typeof config !== 'object' || config === null || !Array.isArray(config.players) || config.players.length < 2) throw new TableError('The game has no players.');
  if (m.seats !== undefined && !isIdList(m.seats)) throw new TableError('Bad seats.');
  const ids = playerIds(config);
  if (m.kind === 'hotseat') {
    try {
      return { kind: 'hotseat', game: new LocalConnection(config, m.seats ? { seats: m.seats } : {}), computer: null };
    } catch (e) {
      throw new TableError(`The game could not be started: ${messageOf(e)}`);
    }
  }
  if (!isIdList(m.computers) || m.computers.length === 0) throw new TableError('A game against the computer needs at least one computer player.');
  const unknown = [...m.computers, ...(m.seats ?? [])].filter((p) => !ids.includes(p));
  if (unknown.length > 0) throw new TableError(`No such player: ${unknown.join(', ')}.`);
  const computers = m.computers;
  const humans = m.seats ?? ids.filter((p) => !computers.includes(p));
  const speed: TableSpeed = m.speed === 'off' || m.speed === 'fast' || m.speed === 'slow' ? m.speed : 'normal';
  try {
    const computer = new ComputerGame(config, humans, computers, {
      delayMs: (opts.delayMs ?? computerDelayMs)(speed),
      seed: typeof m.seed === 'string' && m.seed !== '' ? m.seed : randomBytes(8).toString('hex'),
      ...(opts.maxBoardWaitMs !== undefined ? { maxBoardWaitMs: opts.maxBoardWaitMs } : {}),
      ...(opts.choose ? { choose: opts.choose } : {}),
    });
    return { kind: 'computer', game: computer, computer };
  } catch (e) {
    throw new TableError(`The game could not be started: ${messageOf(e)}`);
  }
}

const reply = (id: number, error?: ActionErrorBody): ReplyMessage => (error ? { t: 'reply', id, ok: false, error } : { t: 'reply', id, ok: true });

export class Table {
  readonly id: string;
  readonly kind: TableKind;
  readonly game: GameConnection;
  private readonly computer: ComputerGame | null;
  /** The last change (1: the game as it started). */
  private seq = 1;
  /** The seq after the last change that was not a stop toggle (the staleness rule). */
  private lastProgressSeq = 1;
  /** The last change the screen has shown (`shown`), and the last change sent whole. */
  private shownSeq = 0;
  private wholeSeq = 0;
  private sink: TableSink | null = null;
  private off: (() => void) | null = null;
  /** What the screen holds: the last view sent and its seq, and the last event batch sent (by its seq). */
  private sentView: GameView | null = null;
  private sentSeq = 0;
  private sentEvents: number;
  /** Set while a stop toggle is applied: the change it makes is not progress. */
  private neutral = false;
  private resultSent = false;
  private closedFlag = false;
  /** When the last screen left (for the idle close), or null while one is attached. */
  detachedAt: number | null = Date.now();
  private readonly pacerListeners = new Set<() => void>();
  private detachPacer: (() => void) | null = null;
  /** The computers' pace: busy while the screen has not shown the last change sent. */
  private readonly pacer: ComputerPacer = {
    busy: () => this.shownSeq < this.seq,
    subscribe: (listener) => {
      this.pacerListeners.add(listener);
      return () => {
        this.pacerListeners.delete(listener);
      };
    },
  };

  constructor(m: StartMessage | null, opts: TablesOptions = {}, id = randomBytes(9).toString('base64url'), prebuilt?: { kind: TableKind; game: GameConnection }) {
    if (!m && !prebuilt) throw new TableError('There is no game to start.');
    const built = prebuilt ? { ...prebuilt, computer: null } : buildGame(m!, opts);
    this.format = typeof m?.format === 'string' ? m.format : '';
    this.id = id;
    this.kind = built.kind;
    this.game = built.game;
    this.computer = built.computer;
    this.sentEvents = this.game.events?.().seq ?? 0;
    if (this.computer) this.detachPacer = this.computer.attachPacer(this.pacer);
    // The replay: every action of the game's log as it is applied or undone (a failure there never stops the game).
    const local = this.computer ? this.computer.local : this.game instanceof LocalConnection ? this.game : null;
    // A replay's clock waits for the screen to have shown each change before playing the next (as the computers do); its state follows each change.
    if (isReplay(this.game)) {
      const controller = this.game.controller;
      this.detachPacer = controller.attachPacer({ busy: this.pacer.busy, flush: () => {}, subscribe: this.pacer.subscribe });
      this.offReplay = controller.subscribe(() => this.sendReplayState());
    }
    if (opts.record && local && m) {
      try {
        const ids = playerIds(m.config);
        const seated = this.kind === 'computer' ? ids.filter((p) => !(m.computers ?? []).includes(p)) : (m.seats ?? ids);
        // The config the game was started from: a computer's seat plays with the computer's own stops (@openmtg/play `withComputerStops`), which
        // decide where the engine passes for it, so the replay must start from them too.
        const config = local.session.config;
        this.recording = opts.record({ config, mode: this.kind === 'computer' ? 'computer' : 'hotseat', format: typeof m.format === 'string' ? m.format : '', seated });
        const rec = this.recording;
        rec.onChange = () => this.sendRecording();
        this.stopRecording = local.observeLog({ applied: (a, i, before, after) => rec.applied(a, i, before, after), undone: (n) => rec.undone(n) });
      } catch (e) {
        console.error('[openmtg-server] the game could not be recorded', e);
      }
    }
  }

  /** The replay being recorded (null when games are not recorded). */
  recording: GameRecording | null = null;
  private offReplay: (() => void) | null = null;
  private sentReplayState: object | null = null;
  /** The format the game was started in ('' when not said). */
  private readonly format: string;
  /** "Report a bug": the moment the open report is about. */
  private bug: BugCapture | null = null;
  private stopRecording: (() => void) | null = null;

  get closed(): boolean {
    return this.closedFlag;
  }

  /** The screen attached now, or null. */
  get attached(): TableSink | null {
    return this.sink;
  }

  /** The players who sit at this table's screen. */
  seats(): PlayerId[] {
    return [...(this.game.seated?.() ?? [])];
  }

  /**
   * A screen attaches (a new table, an `attach` after a restart, or a resync): it gets `table` and a full `view` of the current seq, and the computers
   * play while it stays. Returns the screen it replaced, if another one was attached.
   */
  attach(sink: TableSink): TableSink | null {
    if (this.closedFlag) throw new TableError('This table is closed.');
    const previous = this.sink !== sink ? this.sink : null;
    this.sink = sink;
    this.detachedAt = null;
    // Anything that changed while no screen was attached is a change of its own.
    if (this.sentView !== null && this.game.view() !== this.sentView) this.lastProgressSeq = ++this.seq;
    const view = this.game.view();
    sink.send({ t: 'table', table: this.id, kind: this.kind, seats: this.seats(), viewer: view.viewer });
    this.sendWhole(view, []);
    this.sentEvents = this.game.events?.().seq ?? this.sentEvents;
    if (view.result) {
      this.resultSent = true;
      sink.send({ t: 'result', table: this.id, result: view.result });
    }
    // The sender subscribes before the computers (ComputerGame starts them with its first subscriber), so a change is sent, and the pacer busy, before
    // a computer looks at it.
    this.off ??= this.game.subscribe(this.changed);
    this.sentReplayState = null;
    this.sendReplayState();
    this.sendRecording();
    this.tellPacer();
    return previous;
  }

  /** The game's replay: where it stands, Keep and the agreements (the end screen's replay panel). */
  private sendRecording(): void {
    const rec = this.recording;
    if (!rec || !this.sink) return;
    this.send({ t: 'recording', table: this.id, id: rec.id, state: rec.state, error: rec.error, keep: rec.keep, people: rec.people, agreed: rec.agreed });
  }

  /** `bugCapture`: the moment the report opened on this screen is about (a replay's position, or the game so far). Throws a TableError when none. */
  bugCapture(app: ReportEnvironment['app']): { holds: ReportHolds; kind: 'game' | 'recording'; at: number; length: number } {
    if (isReplay(this.game)) {
      const file = replayFileOf(this.game);
      if (!file) throw new TableError('There is no replay to report on.');
      this.bug = replayCapture(file, this.game.controller.state().position);
    } else {
      const batch = this.game.events?.() ?? null;
      const ids = this.game.view().players.map((p) => p.id);
      const computers = this.computer ? ids.filter((p) => this.computer!.computers.includes(p)) : [];
      this.bug = gameCapture(this.recording?.file() ?? null, {
        view: this.game.view(), events: batch?.events ?? [], changes: batch?.seq ?? 0, mode: this.kind === 'computer' ? 'computer' : 'hotseat', format: this.format,
        computers,
      }, app);
    }
    return { holds: this.bug.content.holds, kind: this.bug.kind, at: this.bug.content.at, length: this.bug.length };
  }

  /** `bugReport`: the report of the moment taken, with the reporter's words. */
  async bugReport(words: string, card: string | null, env: ReportEnvironment): Promise<{ name: string; data: string } | { error: string }> {
    if (!this.bug) return { error: 'Open the report again: the moment it was about is gone.' };
    return makeBugReport(this.bug, words, card, env);
  }

  /** `recording`: mark the game's replay Keep, or record whether a person at the screen shows their cards in it. Returns why it refused, or null. */
  recordingControl(keep: unknown, reveal: unknown): string | null {
    const rec = this.recording;
    if (!rec) return 'This game is not recorded.';
    const failed = (e: unknown) => console.error('[table] the replay could not be updated', e);
    if (typeof keep === 'boolean') void rec.setKeep(keep).catch(failed);
    if (typeof reveal === 'object' && reveal !== null) {
      const r = reveal as Record<string, unknown>;
      if (typeof r['player'] !== 'string' || typeof r['agreed'] !== 'boolean') return 'Send {"player": "<id>", "agreed": true or false}.';
      void rec.setAgreed(r['player'], r['agreed']).catch(failed);
    }
    return null;
  }

  /** A watched replay: its controller's state, after the view it describes (once per change of it). */
  private sendReplayState(): void {
    if (!isReplay(this.game) || !this.sink || this.closedFlag) return;
    const s = this.game.controller.state();
    if (s === this.sentReplayState) return;
    this.sentReplayState = s;
    this.send(replayStateOf(this.id, s, offersReport(this.game, s.badge)));
  }

  /** `replay`: drive a watched replay. Returns why it refused, or null. */
  control(op: unknown, value: unknown): string | null {
    if (!isReplay(this.game)) return 'There is no replay at this table.';
    const c = this.game.controller;
    const sign = value === -1 ? -1 : 1;
    switch (op) {
      case 'play':
        c.play();
        return null;
      case 'pause':
        c.pause();
        return null;
      case 'toggle':
        c.toggle();
        return null;
      case 'step':
        c.step(sign);
        return null;
      case 'seek':
        if (typeof value === 'number') c.seek(value);
        return null;
      case 'turn':
        if (typeof value === 'number') c.seekTurn(value);
        return null;
      case 'nextTurn':
        c.nextTurn();
        return null;
      case 'previousTurn':
        c.previousTurn();
        return null;
      case 'speed':
        if (value === 'real' || typeof value === 'number') c.setSpeed(value as Parameters<typeof c.setSpeed>[0]);
        return null;
      case 'changeSpeed':
        c.changeSpeed(sign);
        return null;
      case 'perspective': {
        const p = perspectiveOf(value);
        if (!p) return 'There is no such view of this replay.';
        const r = c.setPerspective(p);
        return r.ok ? null : r.error.message;
      }
      case 'muteFast':
        if (typeof value === 'boolean') c.setMuteFast(value);
        return null;
      default:
        return 'Unknown replay control.';
    }
  }

  /** The screen left (its socket closed): the computers stop until another attaches. */
  detach(sink: TableSink): void {
    if (this.sink !== sink) return;
    this.sink = null;
    this.detachedAt = Date.now();
    this.off?.();
    this.off = null;
    // Nobody watches: a replay stops playing.
    if (isReplay(this.game)) this.game.controller.pause();
  }

  private send(m: TableServerMessage): void {
    try {
      this.sink?.send(m);
    } catch (e) {
      console.error('[table] a message could not be sent', e);
    }
  }

  private sendWhole(view: GameView, events: readonly GameEvent[]): void {
    this.send({ t: 'view', ...this.fields(), view, events: [...events] });
    this.sentView = view;
    this.sentSeq = this.seq;
    this.wholeSeq = this.seq;
  }

  private fields() {
    const clocks = this.game.clocks?.();
    return {
      table: this.id,
      seq: this.seq,
      legal: [...this.game.legalActions()],
      handoff: this.game.handoff(),
      canUndo: this.game.canUndo(),
      status: this.game.status?.() ?? null,
      ...(clocks !== undefined ? { clocks } : {}),
    };
  }

  /** The connection changed: one change, sent as a patch of the last view (or whole, see the file comment). */
  private readonly changed = (): void => {
    if (this.closedFlag) return;
    this.seq++;
    if (!this.neutral) this.lastProgressSeq = this.seq;
    const view = this.game.view();
    const batch = this.game.events?.() ?? null;
    const events = batch !== null && batch.seq !== this.sentEvents ? batch.events : [];
    if (batch !== null) this.sentEvents = batch.seq;
    const behind = this.seq - Math.max(this.shownSeq, this.wholeSeq) > MAX_SHOWN_LAG;
    const delta = viewDelta(this.sentView, view, { whole: behind });
    if (delta.kind === 'whole') this.sendWhole(view, events);
    else {
      this.send({ t: 'patch', ...this.fields(), base: this.sentSeq, ops: delta.kind === 'patch' ? delta.ops : [], events: [...events] });
      this.sentView = view;
      this.sentSeq = this.seq;
    }
    if (view.result && !this.resultSent) {
      this.resultSent = true;
      this.send({ t: 'result', table: this.id, result: view.result });
    }
  };

  private tellPacer(): void {
    for (const l of [...this.pacerListeners]) l();
  }

  /** `act`: the reply, after the change the action made. */
  async act(id: number, seq: number, action: Action): Promise<ReplyMessage> {
    if (this.closedFlag) return reply(id, { message: 'This table is closed.', rules: [] });
    const stateless = action.type === 'concede' || action.type === 'setStops';
    if (!stateless && (!Number.isInteger(seq) || seq > this.seq || seq < this.lastProgressSeq)) return reply(id, { message: STALE_MESSAGE, rules: [] });
    let pending: ReturnType<GameConnection['act']>;
    // The connection applies the action (and announces the change) before its promise settles; a stop toggle's change is not progress.
    this.neutral = action.type === 'setStops';
    try {
      pending = this.game.act(action);
    } finally {
      this.neutral = false;
    }
    const r = await pending;
    return r.ok ? reply(id) : reply(id, { message: r.error.message, rules: [...r.error.rules] });
  }

  /** `stops`: the phase bar's stop toggles for `player` (a setStops action; never stale). */
  stops(id: number, player: PlayerId, stops: StopSettings): Promise<ReplyMessage> {
    return this.act(id, this.seq, { type: 'setStops', player, stops });
  }

  /** `shown`: the screen shows view `seq`; the computers may go on once it shows the latest. */
  shown(seq: number): void {
    if (!Number.isInteger(seq) || seq <= this.shownSeq || seq > this.seq) return;
    this.shownSeq = seq;
    this.tellPacer();
  }

  /** `undo` (hot-seat): whether something was undone. */
  undo(): boolean {
    return !this.closedFlag && this.game.undo();
  }

  /** `handoff`: the next player clicked through the pass cover. */
  handoff(): void {
    if (!this.closedFlag) this.game.acceptHandoff();
  }

  /**
   * `leave`: the players of this screen concede while the game is not over (CR 104.3a: a player who concedes leaves the game; the screen gets the
   * change and the `result`), then the table closes.
   */
  async leave(): Promise<void> {
    if (this.closedFlag) return;
    for (const player of this.seats()) {
      if (this.game.view().result) break;
      const r = await this.game.act({ type: 'concede', player });
      if (!r.ok) console.error('[table] a concession on leaving was refused', player, r.error.message);
    }
    this.close();
  }

  /** Stop the game for good (leave, an idle table, the server stopping). Idempotent. */
  close(): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    if (isReplay(this.game)) {
      this.offReplay?.();
      this.offReplay = null;
      this.game.controller.dispose();
    }
    // A game left before its end is kept as abandoned (one that ended was saved by its last action).
    this.stopRecording?.();
    this.stopRecording = null;
    void this.recording?.finish();
    this.off?.();
    this.off = null;
    this.detachPacer?.();
    this.detachPacer = null;
    this.sink = null;
    this.detachedAt = Date.now();
  }
}

/** The tables of this server, by id; a table no screen has attached to for `idleMs` is closed. */
export class Tables {
  private readonly byId = new Map<string, Table>();
  private sweep: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: TablesOptions = {}) {}

  get(id: string): Table | null {
    const t = this.byId.get(id);
    return t && !t.closed ? t : null;
  }

  get size(): number {
    return this.byId.size;
  }

  /** A table playing a replay back (table/replay.ts). */
  watch(game: ReplayConnection): Table {
    return this.add(new Table(null, {}, undefined, { kind: 'replay', game }));
  }

  /** A new table from a `start` message (throws a TableError). */
  start(m: StartMessage): Table {
    return this.add(new Table(m, this.opts));
  }

  private add(table: Table): Table {
    this.closeIdle();
    const max = this.opts.maxTables ?? 8;
    if (this.byId.size >= max) {
      const oldest = [...this.byId.values()].filter((t) => t.detachedAt !== null).sort((a, b) => a.detachedAt! - b.detachedAt!)[0];
      if (!oldest) throw new TableError(`At most ${max} tables can be open at once.`);
      this.remove(oldest);
    }
    this.byId.set(table.id, table);
    this.sweep ??= setInterval(() => this.closeIdle(), Math.min(60_000, this.opts.idleMs ?? TABLE_IDLE_MS));
    this.sweep.unref?.();
    return table;
  }

  remove(table: Table): void {
    table.close();
    this.byId.delete(table.id);
    if (this.byId.size === 0 && this.sweep !== null) {
      clearInterval(this.sweep);
      this.sweep = null;
    }
  }

  /** Close the tables no screen has attached to for `idleMs`, and forget closed ones. */
  closeIdle(now = Date.now()): void {
    const idle = this.opts.idleMs ?? TABLE_IDLE_MS;
    for (const t of [...this.byId.values()]) if (t.closed || (t.detachedAt !== null && now - t.detachedAt >= idle)) this.remove(t);
  }

  /** Close every table (the server is stopping). */
  closeAll(): void {
    for (const t of [...this.byId.values()]) this.remove(t);
  }
}
