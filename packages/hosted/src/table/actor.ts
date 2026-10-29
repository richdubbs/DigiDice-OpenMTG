/**
 * The table actor (design 2.2, 6.1-6.3, D9-D12, D15; package M13-2): one hosted game. It takes seat commands in mailbox order and returns, for each, the
 * log records to commit and the messages for each seat. Deterministic (time comes in the commands; the seed is in the config): the same commands give
 * the same steps, byte for byte, and the records replay to the same state (`replayRecords`).
 *
 * For each `act` (design 6.1), in order: the clock is advanced to the command's time and every expiry before it is applied (time-outs and drop
 * forfeits become the seat's concession, CR 104.3a; a seat that is out is refused); the shape and the hosted string rules (`checkAction`,
 * `actionTextProblem`); the seat's player; a resend of the seat's last applied id is answered without a change, an older id is `stale`; `seq` (stale
 * unless the only records since are setStops; concede and setStops are never stale); legality on the full state (`legalActions`, the pending
 * decision, cancellable); by-hand changes become proposals (D12); the engine (`applyAction`; an exception is `engineError` with the state unchanged);
 * the size limits after the apply (objects, log, history; the serialized size at each checkpoint), refusing an action past one; then the record, the
 * clock events (`answered`, the next `decision` with `newStep`, the events count and the active seat; `cancel` for CR 733.1; `seatOut`; `gameOver`), the
 * per-seat payloads, the reply, and the per-game caps (void "limit"; setStops never counts).
 *
 * Only `seatPayload` output (views, redacted events, legal actions, patches) leaves the table about the game; see payload.ts.
 */
import { applyAction, createGame, type Action, type GameConfig, type GameEvent, type GameState, type ManualOp, type PlayerId } from '@openmtg/engine';
import { needsConsent, stopsVerdict } from '@openmtg/net/server-kit';
import {
  checkChat, HOSTED_LIMITS, hostedTextProblem, type ClockSettings, type ClockView, type HostedError, type HostedServerMessage, type HostedServerType,
  type NoticeKind, type SeatNumber,
} from '../api';
import { CLOCK_LIMITS, createTableClock, defaultClockSettings, recoverTableClock, type ClockOutcome, type ClockStep, type TableClock } from '../clock';
import { lossRulesOf } from '../ledger/losses';
import { publicPlacements, type VoidReason } from '../ledger/types';
import type { Logger } from '../obs';
import type { ClockReading, LogRecord } from '../store/api';
import { actionLegalityProblem, actionShapeProblem, isSeq, normalizeStops, offersNoAnswer } from './check';
import { checkpointOf, defaultTableLimits, growthProblem, noteCount, sizeProblem, type TableLimits } from './limits';
import { fullViewJson, proposalView, seatPayload, type SeatBase, type SeatPayload } from './payload';
import { defaultPlacements, type PlacementRule, type PlacementSeat } from './placements';
import type { Checkpoint, SeatSend, SnapshotLoss, TableCause, TableCommand, TableEnd, TableStep } from './types';

export interface TableOptions {
  /** The game id (records and the start message carry it). */
  game: string;
  /** The game configuration with its seed (`tableConfig`): the players p1-pN in seating order. */
  config: GameConfig;
  /** `seating[i]`: the table seat of `config.players[i]` (`tableConfig`'s seating; `StartRow.seating`). */
  seating: readonly SeatNumber[];
  /** The table's clocks (default: the design's for the table size; tables pass `clockFor(config.clocks, format, seats)`). */
  clock?: ClockSettings;
  /** Overrides of the size limits and caps (tests). */
  limits?: Partial<TableLimits>;
  /** The placement rule at the end of a won or drawn game (default `defaultPlacements`: the ledger's `ledgerPlacements`, M13-7). */
  placements?: PlacementRule;
  /** Engine errors are logged here (game, seat, action type: never a card name). */
  logger?: Logger;
}

export interface TableStartOptions extends TableOptions {
  /** The game's start (server time). */
  at: number;
  /** Seats connected at the start (default: all; the ready check has just passed). */
  connected?: readonly SeatNumber[];
}

export interface TableRecoverOptions extends TableOptions {
  /** The time the table is back (the outage before it is charged to nobody: design 2.3). */
  at: number;
  /** Every committed record of the game, in `seq` order (the counts of the table come from all of them, also with `from`). */
  records: readonly LogRecord[];
  /**
   * M13-5 INTERFACE CHANGE (additive): the state at a snapshot's `seq` (the runtime's recovery, design 2.3): the records up to it are not applied
   * again, only counted. A loss's out order, turn and citations come from its change's events, not from the state: F31, the snapshot carries them
   * (`losses`, Checkpoint.losses), so it is taken also after a player has lost when they match the state's losers; a snapshot without them (written
   * before F31) is taken only while no player has lost by then. Otherwise every record is replayed, as without it.
   */
  from?: { state: GameState; seq: number; losses?: readonly SnapshotLoss[] };
  /** M13-5 INTERFACE CHANGE (additive): called after each record is applied (the runtime's watchdog progress and checkpoint-hash checks). */
  onRecord?: (rec: LogRecord, state: GameState) => void;
}

interface Channel {
  seat: SeatNumber;
  player: PlayerId;
  /** The player's index in the engine's order (the clock's seat is index + 1). */
  index: number;
  name: string;
  connected: boolean;
  /** Left the table (Leave): nothing more is sent to this seat. */
  left: boolean;
  /** The view the connection holds (the patch base and the sync cache); null while disconnected. */
  base: SeatBase | null;
  /** The id of this seat's last applied `act` (0: none). */
  lastActId: number;
  /** Accepted cancels in the seat's current control period (the "cancels used up" notice). */
  cancels: { period: number; count: number };
  /** Every accepted cancel of the current control period, stranded ones included (`TableLimits.cancelsPerPeriodMax`). */
  allCancels: { period: number; count: number };
  /** By-hand notes this seat has had applied in the game (`TableLimits.manualNotesPerGame`). */
  notes: number;
  cause: TableCause | null;
  outOrder: number | null;
  outTurn: number | null;
  /** M13-7: the engine's citations of this seat's loss (its `playerLost` event's `rules`), for the ledger's loss code. */
  lossRules: string[] | null;
}

interface OpenProposal {
  id: number;
  seat: SeatNumber;
  actId: number;
  action: Action & { type: 'answer' };
  approvers: SeatNumber[];
}

class StepBuilder {
  readonly records: LogRecord[] = [];
  readonly sends: SeatSend[] = [];
  end: TableEnd | null = null;
  checkpoint: Checkpoint | null = null;
  clockDirty = false;
}

const json = (m: HostedServerMessage): string => JSON.stringify(m);

/** A by-hand answer (a manualResolve answer: the only actions with free text and the growth budget). */
const isManual = (a: Action): boolean => a.type === 'answer' && a.answer.kind === 'manualResolve';

/**
 * F31: whether a snapshot can start a recovery as far as losses go: with its losses (Checkpoint.losses), when they name exactly the players the state
 * shows as lost, each once, with sane numbers; without them (a snapshot written before F31), only while nobody has lost.
 */
function snapshotLossesUsable(from: NonNullable<TableRecoverOptions['from']>, configIndex: (id: PlayerId) => number): boolean {
  const lost = from.state.players.filter((p) => p.hasLost).map((p) => p.id);
  if (!from.losses) return lost.length === 0;
  const named = from.losses.map((l) => l.player);
  if (new Set(named).size !== named.length || named.length !== lost.length || !lost.every((id) => named.includes(id))) return false;
  return from.losses.every((l) => configIndex(l.player) >= 0 && Number.isInteger(l.order) && l.order >= 1 && Number.isInteger(l.turn) && l.turn >= 0);
}

/** ISO time of a record (`LogRecord.at`); a time out of the Date range is clamped (never throws). */
function iso(at: number): string {
  const t = Math.min(Math.max(at, -8.64e15), 8.64e15);
  return new Date(t).toISOString();
}

export class TableActor {
  readonly game: string;
  readonly config: GameConfig;
  readonly limits: TableLimits;
  readonly settings: ClockSettings;
  private stateNow: GameState;
  private readonly clock: TableClock;
  private readonly channels: Channel[];
  /** Channels by player index (engine order). */
  private readonly byIndex: Channel[];
  private readonly placementRule: PlacementRule;
  private readonly logger: Logger | null;
  /** Records applied (the last record's seq; views carry it). */
  private seqNow = 0;
  /** The seq of the last record that was not a setStops: an act chosen from a view at or after it is not stale. */
  private lastProgressSeq = 0;
  /** Actions counted toward the per-game cap. */
  private progress = 0;
  private warnedCap = false;
  private outRound = 0;
  private lastAt: number;
  private lastDecisionKey: string | null = null;
  private proposal: OpenProposal | null = null;
  private rejection: { seat: SeatNumber; reason: string | null } | null = null;
  private endNow: TableEnd | null = null;
  private engineErrorCount = 0;
  private cur = new StepBuilder();
  /** Work deferred until the current apply is complete (concessions from expiries, approved proposals), so records stay in seq order. */
  private readonly queue: (() => void)[] = [];
  private draining = false;

  private constructor(o: TableOptions, at: number, state: GameState, clock: TableClock) {
    this.game = o.game;
    this.config = o.config;
    const n = o.config.players.length;
    if (o.seating.length !== n) throw new Error(`TableActor: ${o.seating.length} seats for ${n} players`);
    this.limits = { ...defaultTableLimits(n), ...o.limits };
    this.settings = o.clock ? { ...o.clock } : defaultClockSettings(n);
    this.placementRule = o.placements ?? defaultPlacements;
    this.logger = o.logger ?? null;
    this.lastAt = at;
    this.stateNow = state;
    this.clock = clock;
    // By the configuration's order (seating[i] is config.players[i]): the engine reorders `state.players` once the starting player is chosen (turn
    // order, CR 103.1), so players are always looked up by id, never by position.
    this.byIndex = o.config.players.map((p, i) => ({
      seat: o.seating[i]!, player: p.id ?? `p${i + 1}`, index: i, name: p.name, connected: false, left: false, base: null, lastActId: 0,
      cancels: { period: 0, count: 0 }, allCancels: { period: 0, count: 0 }, notes: 0, cause: null, outOrder: null, outTurn: null, lossRules: null,
    }));
    this.channels = [...this.byIndex].sort((a, b) => a.seat - b.seat);
  }

  /** A new game: the first views go to every connected seat (seq 0), with the `start` message and the clocks. */
  static start(o: TableStartOptions): { actor: TableActor; step: TableStep } {
    const state = createGame(o.config);
    const n = o.config.players.length;
    const connectedSeats = o.connected ?? o.seating;
    const connected = o.seating.flatMap((s, i) => (connectedSeats.includes(s) ? [(i + 1) as SeatNumber] : []));
    const clock = createTableClock({ seats: n, at: o.at, settings: o.clock ?? defaultClockSettings(n), connected });
    const actor = new TableActor(o, o.at, state, clock);
    const step = actor.run(() => {
      for (const ch of actor.channels) ch.connected = connectedSeats.includes(ch.seat);
      actor.clockDecision(o.at, 0);
      const players = actor.byIndex.map((ch) => ({ id: ch.player, name: ch.name, seat: ch.seat }));
      for (const ch of actor.channels) if (ch.connected) actor.send(ch.seat, 'start', json({ t: 'start', table: actor.game, players }));
      actor.publish([]);
      actor.cur.clockDirty = true;
    });
    return { actor, step };
  }

  /**
   * A table rebuilt from its committed records after an outage (design 2.3): the state by replay (same engine build), the clocks from the last record
   * (`recoverTableClock`: the outage charged to nobody, every seat disconnected with a fresh reconnect window), the per-game counts from the records.
   * Open proposals are not stored (the proposer proposes again). The seats get full views when they reconnect.
   */
  static recover(o: TableRecoverOptions): { actor: TableActor; step: TableStep; fromSnapshot: number | null } {
    const n = o.config.players.length;
    const configIndex = (id: PlayerId) => o.config.players.findIndex((p, i) => (p.id ?? `p${i + 1}`) === id);
    const from = o.from && o.from.seq <= o.records.length && snapshotLossesUsable(o.from, configIndex) ? o.from : null;
    let state = from ? from.state : createGame(o.config);
    const settings = o.clock ?? defaultClockSettings(n);
    const losses: { index: number; order: number; turn: number; rules: string[] | null }[] = [];
    let order = 0;
    // F31: the losses up to the snapshot, as it kept them (the records up to it are not replayed, so their events are not seen here).
    for (const l of from?.losses ?? []) {
      losses.push({ index: configIndex(l.player), order: l.order, turn: l.turn, rules: l.rules ? [...l.rules] : null });
      order = Math.max(order, l.order);
    }
    let progress = 0;
    let lastProgressSeq = 0;
    let prevActions = new Map<number, number>();
    const causes = new Map<number, TableCause>();
    const notes = new Map<number, number>();
    o.records.forEach((rec, k) => {
      if (rec.seq !== k + 1) throw new Error(`TableActor.recover: record ${k + 1} has seq ${rec.seq}`);
      // Up to the snapshot the record is only counted (its losses come with the snapshot, or nobody had lost by then: `from` is taken only so).
      const replayed = !from || rec.seq > from.seq;
      let lost: number[] = [];
      let events: GameEvent[] = [];
      if (replayed) {
        const r = applyAction(state, rec.action);
        if (r.error) throw new Error(`TableActor.recover: record ${rec.seq} does not replay: ${r.error.message}`);
        const before = state;
        state = r.state;
        events = r.events;
        lost = state.players.flatMap((p) => (p.hasLost && !before.players.find((x) => x.id === p.id)!.hasLost ? [configIndex(p.id)] : []));
        o.onRecord?.(rec, state);
      }
      if (lost.length) {
        order++;
        const rules = lossRulesOf(events);
        for (const i of lost) losses.push({ index: i, order, turn: state.turn.number, rules: rules.get(o.config.players[i]?.id ?? `p${i + 1}`) ?? null });
      }
      const actions = new Map(rec.clocks.map((c) => [c.seat, c.actions ?? 0] as const));
      if (rec.action.type !== 'setStops') {
        lastProgressSeq = rec.seq;
        // A cancel the clock did not count (the stranded-player exception) does not count toward the cap either.
        const uncounted = rec.action.type === 'cancel' && actions.get(rec.seat) === (prevActions.get(rec.seat) ?? 0);
        if (!uncounted) progress++;
      }
      prevActions = actions;
      if (rec.cause && rec.cause !== 'approved') causes.set(rec.seat, rec.cause);
      notes.set(rec.seat, (notes.get(rec.seat) ?? 0) + noteCount(rec.action));
    });
    const indexOfSeat = (s: number) => o.seating.indexOf(s as SeatNumber);
    const last = o.records[o.records.length - 1];
    const record = last
      ? { clocks: last.clocks.map((c) => ({ ...c, seat: indexOfSeat(c.seat) + 1 })), elapsedMs: last.elapsedMs }
      : { clocks: [] as ClockReading[], elapsedMs: 0 };
    const pending = state.result ? null : state.pending;
    const playerIndex = configIndex;
    const clock = recoverTableClock({
      seats: n, at: o.at, settings, record,
      controller: pending ? ((playerIndex(pending.player) + 1) as SeatNumber) : null,
      active: (playerIndex(state.turn.activePlayer) + 1) as SeatNumber,
      out: state.players.flatMap((p) => (p.hasLost ? [(configIndex(p.id) + 1) as SeatNumber] : [])),
    });
    const actor = new TableActor(o, o.at, state, clock);
    actor.seqNow = last?.seq ?? 0;
    actor.progress = progress;
    actor.lastProgressSeq = lastProgressSeq;
    actor.outRound = order;
    actor.warnedCap = progress >= Math.ceil(actor.limits.actions * actor.limits.warnAt);
    actor.lastDecisionKey = pending ? actor.decisionKey() : null;
    for (const l of losses) {
      const ch = actor.byIndex[l.index]!;
      ch.outOrder = l.order;
      ch.outTurn = l.turn;
      ch.lossRules = l.rules;
    }
    for (const [seat, cause] of causes) {
      const ch = actor.channelOf(seat);
      if (!ch) continue;
      ch.cause = cause;
      if (cause === 'left') ch.left = true; // a seat that left stays left: no views after a reconnect
    }
    for (const [seat, count] of notes) {
      const ch = actor.channelOf(seat);
      if (ch) ch.notes = count;
    }
    const step = actor.run(() => {
      if (state.result) actor.endGame(o.at);
    });
    return { actor, step, fromSnapshot: from ? from.seq : null };
  }

  /** F31: the losses so far, as a checkpoint keeps them (Checkpoint.losses). */
  private lossFacts(): SnapshotLoss[] {
    return this.byIndex
      .filter((ch) => ch.outOrder !== null)
      .map((ch) => ({ player: ch.player, order: ch.outOrder!, turn: ch.outTurn ?? 0, rules: ch.lossRules ? [...ch.lossRules] : null }));
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Reading (server side only: nothing here is sent anywhere by the actor)

  /** The full game state. It exists only on the server; never send it. */
  get state(): GameState {
    return this.stateNow;
  }

  /** Records applied so far (the `seq` of the views). */
  get seq(): number {
    return this.seqNow;
  }

  /** Actions counted toward the per-game cap. */
  get actions(): number {
    return this.progress;
  }

  /** How the game ended, once it has. */
  get ended(): TableEnd | null {
    return this.endNow;
  }

  /** Engine exceptions so far (`games.engine_errors`: the table goes on, flagged for the developer). */
  get engineErrors(): number {
    return this.engineErrorCount;
  }

  /** When to send the next `tick`, or null. */
  nextDeadline(): number | null {
    return this.endNow ? null : this.clock.nextDeadline();
  }

  /** The clocks as the players see them (table seats). */
  clockView(at?: number): ClockView {
    const v = this.clock.view(at);
    return { ...v, seats: v.seats.map((s) => ({ ...s, seat: this.byIndex[s.seat - 1]!.seat })).sort((a, b) => a.seat - b.seat) };
  }

  /** The player of a table seat. */
  playerOf(seat: SeatNumber): PlayerId | null {
    return this.channelOf(seat)?.player ?? null;
  }

  /**
   * The id of the seat's last applied `act` (0: none; not kept across a recovery). An act with a lower id is `stale`, so a browser that reloads must
   * continue its ids above it (the gateway can tell it in `welcome`, as milestone 9's `lastAction` did).
   */
  lastActId(seat: SeatNumber): number {
    return this.channelOf(seat)?.lastActId ?? 0;
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Commands

  /** Handles one command. Never throws for anything a browser sent (audit C4): a failure refuses that command only. */
  handle(cmd: TableCommand): TableStep {
    return this.run(
      () => {
        const at = Number.isFinite(cmd.at) ? Math.max(this.lastAt, cmd.at) : this.lastAt;
        this.lastAt = at;
        this.dispatch(cmd, at);
      },
      (e) => {
        this.engineErrorCount++;
        this.logger?.log('error', 'tableError', { game: this.game, seat: 'seat' in cmd ? cmd.seat : null, command: cmd.t, error: e instanceof Error ? e.name : 'error' });
        if ('seat' in cmd && 'id' in cmd && typeof cmd.id === 'number') this.reply(cmd.seat, cmd.id, { code: 'engineError', message: 'The server failed on this message.' });
      },
    );
  }

  private run(body: () => void, onError?: (e: unknown) => void): TableStep {
    const step = new StepBuilder();
    this.cur = step;
    try {
      body();
    } catch (e) {
      if (!onError) throw e;
      onError(e);
    }
    this.drain();
    if (step.clockDirty) {
      const v = this.clockView(this.lastAt);
      const text = json({ t: 'clock', ...v });
      for (const ch of this.channels) if (ch.connected && !ch.left) this.send(ch.seat, 'clock', text);
    }
    return { records: step.records, sends: step.sends, end: step.end, checkpoint: step.checkpoint, nextDeadline: this.nextDeadline() };
  }

  private dispatch(cmd: TableCommand, at: number): void {
    if (cmd.t === 'tick') {
      if (!this.endNow) this.clockStep(this.clock.handle({ type: 'tick', at }), at);
      return;
    }
    if (cmd.t === 'void') {
      this.endVoid(cmd.reason, at);
      return;
    }
    const ch = this.channelOf(cmd.seat);
    if (!ch) return; // not a seat of this table: the gateway routes only seated connections
    if ('id' in cmd && cmd.id !== undefined && !(Number.isSafeInteger(cmd.id) && cmd.id > 0)) {
      // A command id is a positive whole number (the protocol's); anything else would defeat the resend and stale checks.
      return this.reply(ch.seat, 0, { code: 'badMessage', message: 'The command id must be a positive whole number.' });
    }
    // Every expiry before this instant first (time-outs and forfeits become concessions), so a seat that is out by then is refused.
    if (!this.endNow) this.clockStep(this.clock.advance(at), at);
    this.drain();
    switch (cmd.t) {
      case 'act':
        return this.onAct(ch, cmd.id, cmd.seq, cmd.action, at);
      case 'vote':
        return this.onVote(ch, cmd.id, cmd.proposal, cmd.accept, cmd.reason, at);
      case 'leave':
        return this.onLeave(ch, cmd.id, at);
      case 'chat':
        return this.onChat(ch, cmd.id, cmd.text);
      case 'sync':
        return this.onSync(ch, cmd.id);
      case 'connect':
        return this.onConnect(ch, at);
      case 'disconnect':
        return this.onDisconnect(ch, at);
    }
  }

  private onAct(ch: Channel, id: number, seq: unknown, raw: unknown, at: number): void {
    const refuse = (e: HostedError) => this.reply(ch.seat, id, e);
    if (ch.left) return refuse({ code: 'notAllowed', message: 'You have left this game.' });
    // A resend of an act that opened a proposal still waiting: its reply comes when the proposal closes.
    if (this.proposal && this.proposal.seat === ch.seat && this.proposal.actId === id) return;
    if (!isSeq(seq)) return refuse({ code: 'badMessage', message: 'The action has no valid seq.' });
    const shape = actionShapeProblem(raw);
    if (shape) return refuse(shape);
    let action = raw as Action;
    if (action.type === 'startGame' || !('player' in action) || action.player !== ch.player) {
      return refuse({ code: 'notYourPlayer', message: `You play ${ch.player}; this action is for another player.` });
    }
    if (this.endNow) return refuse({ code: 'illegalAction', message: 'The game is over.', rules: ['CR 104.1'] });
    // Applied once: the seat's last applied id again is a resend, answered without a change; an older id is out of date (design 6.1 step 4).
    if (ch.lastActId > 0 && id === ch.lastActId) return this.reply(ch.seat, id);
    if (id < ch.lastActId) return refuse({ code: 'stale', message: `Action ${id} is older than the last one applied (${ch.lastActId}).` });
    if (this.isOut(ch)) return refuse({ code: 'illegalAction', message: 'You are out of this game.', rules: ['CR 104.3a'] });
    const stateless = action.type === 'concede' || action.type === 'setStops';
    if (!stateless && (seq > this.seqNow || seq < this.lastProgressSeq)) {
      return refuse({ code: 'stale', message: 'The game moved on since the view this action was chosen from; choose again from the latest view.' });
    }
    // The proposer acting again withdraws its open proposal (milestone 9's rule), before the new action is looked at.
    if (this.proposal && this.proposal.seat === ch.seat && action.type !== 'setStops') {
      this.clockStep(this.clock.handle({ type: 'withdraw', at, seat: this.clockSeat(ch) }), at);
      this.drain();
    }
    if (action.type === 'setStops') {
      action = { ...action, stops: normalizeStops(action.stops) };
      const verdict = stopsVerdict(this.stateNow, action);
      if (verdict === 'over') return refuse({ code: 'illegalAction', message: 'The game is over; stops cannot change any more.', rules: ['CR 104.1'] });
      if (verdict === 'unchanged') {
        ch.lastActId = id;
        return this.reply(ch.seat, id);
      }
      return void this.applyFor(ch, id, action, { at, neutral: true, clock: 'none' });
    }
    if (action.type === 'concede') return void this.applyFor(ch, id, action, { at, clock: 'seatOut' });
    const problem = actionLegalityProblem(this.stateNow, ch.player, action);
    if (problem) return refuse(problem);
    const manual = this.manualProblem(ch, action);
    if (manual) return refuse(manual);
    if (needsConsent(action)) return this.propose(ch, id, action, at);
    if (action.type === 'cancel') return this.cancel(ch, id, action, at);
    return void this.applyFor(ch, id, action, { at, clock: 'answered' });
  }

  /**
   * By-hand answers (M13-2 review CRITICAL 1): each note is one log entry and needs no approval, so notes are bounded: at most
   * `manualOpsPerAnswer` ops and `manualNotesPerAnswer` notes in one answer (badMessage), `manualNotesPerGame` notes per seat, and none once the log
   * is past `notesHeadroom` of its cap (limitReached; an answer without notes still resolves the card).
   */
  private manualProblem(ch: Channel, action: Action): HostedError | null {
    if (action.type !== 'answer' || action.answer.kind !== 'manualResolve') return null;
    const ops = (action.answer as { ops?: unknown }).ops;
    if (!Array.isArray(ops)) return null; // the engine refuses it
    const n = noteCount(action);
    if (ops.length > this.limits.manualOpsPerAnswer) return { code: 'badMessage', message: `At most ${this.limits.manualOpsPerAnswer} adjustments in one answer.` };
    if (n > this.limits.manualNotesPerAnswer) return { code: 'badMessage', message: `At most ${this.limits.manualNotesPerAnswer} notes in one answer.` };
    if (n === 0) return null;
    if (ch.notes + n > this.limits.manualNotesPerGame) return { code: 'limitReached', message: `You have used your ${this.limits.manualNotesPerGame} notes for this game; resolve without notes.` };
    if (this.stateNow.log.length >= this.limits.notesHeadroom * this.limits.maxLogEntries) return { code: 'limitReached', message: 'The game log is nearly full: no more notes; resolve without notes.' };
    return null;
  }

  /**
   * A CR 733.1 cancel: the clock's cap of 3 per control period, except for a player the pending decision offers no answer (never stranded), and a
   * ceiling for every cancel of the period, stranded ones included (`cancelsPerPeriodMax`). The size limits are checked before the clock hears of it.
   */
  private cancel(ch: Channel, id: number, action: Action, at: number): void {
    const period = this.clock.readings()[ch.index]!.period;
    const all = ch.allCancels.period === period ? ch.allCancels.count : 0;
    const used = (): void => this.reply(ch.seat, id, {
      code: 'limitReached',
      message: `You have used your ${CLOCK_LIMITS.cancelsPerPeriod} cancels for this decision: finish the action, or let your clock run.`,
      rules: ['CR 733.1'],
    });
    if (all >= this.limits.cancelsPerPeriodMax) return used();
    // The size limits first: a cancel refused for size must not use one of the period's cancels at the clock.
    let trial: ReturnType<typeof applyAction>;
    try {
      trial = applyAction(this.stateNow, action);
    } catch (e) {
      this.engineFailed(ch.seat, action, e);
      return this.reply(ch.seat, id, { code: 'engineError', message: 'The engine failed on this action; the game is unchanged.' });
    }
    if (trial.error) return this.reply(ch.seat, id, { code: 'illegalAction', message: trial.error.message, rules: trial.error.rules });
    const size = this.sizeRefusal(this.stateNow, trial.state, this.seqNow + 1);
    this.checkpointPending = null;
    if (size) {
      if (size.absolute) this.voidIfStuck(at, ch.seat);
      return this.reply(ch.seat, id, { code: 'limitReached', message: size.message });
    }
    const s = this.clock.handle({ type: 'cancel', at, seat: this.clockSeat(ch) });
    this.clockStep(s, at);
    const refused = s.outcomes.some((o) => o.kind === 'cancelRefused');
    const stranded = refused && this.stateNow.pending !== null && offersNoAnswer(this.stateNow.pending);
    if (refused && !stranded) return used();
    const ok = this.applyFor(ch, id, action, { at, clock: 'none', uncounted: stranded });
    if (!ok) return;
    ch.allCancels = { period, count: all + 1 };
    if (stranded) return;
    ch.cancels = ch.cancels.period === period ? { period, count: ch.cancels.count + 1 } : { period, count: 1 };
    if (ch.cancels.count === CLOCK_LIMITS.cancelsPerPeriod) {
      this.notice('cancelsUsed', `You have used your ${CLOCK_LIMITS.cancelsPerPeriod} cancels for this decision; another cancel is refused until your next turn step.`, [ch], ch.seat);
    }
  }

  /** Applies a seat's own action; on success its id is the seat's last applied one. Returns whether it was applied. */
  private applyFor(ch: Channel, id: number, action: Action, c: { at: number; clock: 'answered' | 'seatOut' | 'none'; neutral?: boolean; uncounted?: boolean }): boolean {
    const err = this.commit({ seat: ch.seat, action, at: c.at, clock: c.clock, neutral: c.neutral, uncounted: c.uncounted, reply: { seat: ch.seat, id } });
    if (err) {
      this.reply(ch.seat, id, err);
      return false;
    }
    ch.lastActId = id;
    return true;
  }

  // ---- by-hand changes (D12): every other player approves; at most two proposals per control period, then notes only

  private propose(ch: Channel, id: number, action: Action & { type: 'answer' }, at: number): void {
    // The engine checks the answer first (decision id, objects, zones): the others are only asked about changes that can be applied.
    let error: HostedError | null = null;
    try {
      const r = applyAction(this.stateNow, action);
      if (r.error) error = { code: 'illegalAction', message: r.error.message, rules: r.error.rules };
    } catch (e) {
      this.engineFailed(ch.seat, action, e);
      error = { code: 'engineError', message: 'The engine failed on these changes; the game is unchanged.' };
    }
    if (error) return this.reply(ch.seat, id, error);
    const s = this.clock.handle({ type: 'propose', at, seat: this.clockSeat(ch) });
    this.clockStep(s, at);
    const refused = s.outcomes.find((o) => o.kind === 'proposalRefused');
    if (refused?.kind === 'proposalRefused') {
      const why = {
        pending: 'Another proposal is waiting for answers.',
        notDeciding: 'It is not your decision now.',
        notesOnly: `You have made ${CLOCK_LIMITS.proposalsPerPeriod} proposals in this decision: resolve it with notes only now (notes need no approval).`,
      }[refused.reason];
      return this.reply(ch.seat, id, { code: 'manualRejected', message: why });
    }
    const opened = s.outcomes.find((o) => o.kind === 'proposalOpened');
    if (opened?.kind !== 'proposalOpened') return this.reply(ch.seat, id, { code: 'manualRejected', message: 'The proposal could not be opened.' });
    const approvers = opened.approvers.map((cs) => this.byIndex[cs - 1]!.seat);
    this.proposal = { id: opened.id, seat: ch.seat, actId: id, action, approvers };
    const ops = (action.answer as { ops: ManualOp[] }).ops;
    for (const seat of approvers) {
      const a = this.channelOf(seat)!;
      if (a.connected && !a.left) {
        const view = proposalView(this.stateNow, opened.id, { seat: ch.seat, player: ch.player }, ops, a.player);
        this.send(seat, 'proposal', json({ t: 'proposal', proposal: view }));
      }
    }
  }

  private onVote(ch: Channel, id: number, proposalId: unknown, accept: unknown, reason: unknown, at: number): void {
    if (typeof accept !== 'boolean' || !isSeq(proposalId)) return this.reply(ch.seat, id, { code: 'badMessage', message: 'The vote is malformed.' });
    let why: string | null = null;
    if (reason !== undefined) {
      if (typeof reason !== 'string' || reason.length > HOSTED_LIMITS.chat || hostedTextProblem(reason)) return this.reply(ch.seat, id, { code: 'badMessage', message: 'The reason is not valid text (at most 500 characters).' });
      why = reason.trim() || null;
    }
    const p = this.proposal;
    if (!p || p.id !== proposalId || this.endNow) return this.reply(ch.seat, id, { code: 'manualRejected', message: 'There is no such proposal (it was answered or withdrawn).' });
    if (!p.approvers.includes(ch.seat)) return this.reply(ch.seat, id, { code: 'notAllowed', message: 'This proposal is not yours to answer.' });
    this.rejection = accept ? null : { seat: ch.seat, reason: why };
    const s = this.clock.handle({ type: 'vote', at, seat: this.clockSeat(ch), approve: accept });
    this.clockStep(s, at);
    if (s.outcomes.some((o) => o.kind === 'ignored')) return this.reply(ch.seat, id, { code: 'notAllowed', message: 'You have answered this proposal already.' });
    this.drain(); // an approval is applied before the voter's reply
    this.reply(ch.seat, id);
  }

  private onProposalClosed(id: number, outcome: 'approved' | 'rejected' | 'withdrawn', at: number): void {
    const p = this.proposal;
    if (!p || p.id !== id) return;
    this.proposal = null;
    const closed = json({ t: 'proposalClosed', proposal: id, outcome });
    for (const seat of [p.seat, ...p.approvers]) {
      const c = this.channelOf(seat)!;
      if (c.connected && !c.left) this.send(seat, 'proposalClosed', closed);
    }
    const proposer = this.channelOf(p.seat)!;
    if (outcome === 'approved') {
      const approvedBy = p.approvers.filter((s) => !this.isOut(this.channelOf(s)!));
      const err = this.commit({ seat: p.seat, action: p.action, at, clock: 'answered', cause: 'approved', approvedBy, reply: { seat: p.seat, id: p.actId } });
      if (err) this.reply(p.seat, p.actId, err);
      else proposer.lastActId = p.actId;
      return;
    }
    const r = this.rejection;
    this.rejection = null;
    const message = outcome === 'rejected'
      ? `Seat ${r?.seat ?? '?'} did not accept your by-hand changes${r?.reason ? `: ${r.reason}` : '.'}`
      : 'Withdrawn: the game moved on, or you sent another action, before everyone answered.';
    this.reply(p.seat, p.actId, { code: 'manualRejected', message });
  }

  // ---- leave, chat, sync, connections

  private onLeave(ch: Channel, id: number, at: number): void {
    if (!this.endNow && !ch.left && !this.isOut(ch)) {
      ch.cause = 'left';
      const err = this.commit({ seat: ch.seat, action: { type: 'concede', player: ch.player }, at, clock: 'seatOut', cause: 'left', reply: { seat: ch.seat, id } });
      if (err) {
        ch.cause = null;
        return this.reply(ch.seat, id, err);
      }
      this.notice('playerLeft', `Seat ${ch.seat} left the game (a concession, CR 104.3a).`, this.channels.filter((c) => c !== ch), ch.seat);
    } else this.reply(ch.seat, id);
    ch.left = true;
    ch.connected = false;
    ch.base = null;
  }

  private onChat(ch: Channel, id: number, text: unknown): void {
    if (ch.left) return this.reply(ch.seat, id, { code: 'notAllowed', message: 'You have left this game.' });
    const c = checkChat(text);
    if (!c.ok) return this.reply(ch.seat, id, { code: 'badMessage', message: c.message });
    const line = json({ t: 'chat', from: ch.seat, text: c.value });
    for (const o of this.channels) if (o.connected && !o.left) this.send(o.seat, 'chat', line);
    this.reply(ch.seat, id);
  }

  private onSync(ch: Channel, id: number | undefined): void {
    if (ch.left) {
      if (id !== undefined) this.reply(ch.seat, id, { code: 'notAllowed', message: 'You have left this game.' });
      return;
    }
    this.sendFull(ch);
    // No id: the gateway's catch-up of a connection that was behind (design 3.5), which dropped the clocks it was sent as well as the patches: the clocks go
    // with the view, as they do on a reconnect.
    if (id === undefined) this.cur.clockDirty = true;
    if (id !== undefined) this.reply(ch.seat, id);
  }

  private onConnect(ch: Channel, at: number): void {
    if (ch.left) return;
    const was = ch.connected;
    ch.connected = true;
    if (!this.endNow && !was) {
      this.clockStep(this.clock.handle({ type: 'reconnect', at, seat: this.clockSeat(ch) }), at);
      this.notice('playerBack', `Seat ${ch.seat} is back.`, this.channels.filter((c) => c !== ch), ch.seat);
    }
    this.sendFull(ch);
    this.cur.clockDirty = true;
    const p = this.proposal;
    if (p && p.approvers.includes(ch.seat) && this.clock.openProposal()?.pending.includes(this.clockSeat(ch))) {
      const proposer = this.channelOf(p.seat)!;
      const view = proposalView(this.stateNow, p.id, { seat: p.seat, player: proposer.player }, (p.action.answer as { ops: ManualOp[] }).ops, ch.player);
      this.send(ch.seat, 'proposal', json({ t: 'proposal', proposal: view }));
    }
    if (this.endNow) this.send(ch.seat, 'result', this.resultJson(this.endNow));
  }

  private onDisconnect(ch: Channel, at: number): void {
    if (!ch.connected) return;
    ch.connected = false;
    ch.base = null;
    if (this.endNow || ch.left) return;
    this.clockStep(this.clock.handle({ type: 'disconnect', at, seat: this.clockSeat(ch) }), at);
    this.notice('playerDropped', `Seat ${ch.seat} lost the connection; the game waits for them only when they must decide.`, this.channels.filter((c) => c !== ch), ch.seat);
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Applying

  /**
   * Applies an action to the game: the engine, the size limits, the seats' payloads (built before anything changes: a failure there leaves the table
   * as it was, design 2.2 step 2), then the state, the record, the clock, the sends, the reply, the end and the caps. Returns the refusal (state
   * unchanged) or null.
   */
  private commit(c: {
    seat: SeatNumber; action: Action; at: number; clock: 'answered' | 'seatOut' | 'none'; cause?: LogRecord['cause']; approvedBy?: SeatNumber[];
    neutral?: boolean; uncounted?: boolean; reply?: { seat: SeatNumber; id: number };
  }): HostedError | null {
    let r: ReturnType<typeof applyAction>;
    try {
      r = applyAction(this.stateNow, c.action);
    } catch (e) {
      this.engineFailed(c.seat, c.action, e);
      return { code: 'engineError', message: 'The engine failed on this action; the game is unchanged.' };
    }
    if (r.error) return { code: 'illegalAction', message: r.error.message, rules: r.error.rules };
    const seq = this.seqNow + 1;
    // A concession is never refused for size (CR 104.3a: a player may concede at any time; the server's time-out and drop forfeits are concessions).
    const size = this.sizeRefusal(this.stateNow, r.state, seq, c.action.type === 'concede', isManual(c.action));
    if (size) {
      if (!c.neutral && size.absolute) this.voidIfStuck(c.at, c.seat);
      return { code: 'limitReached', message: size.message };
    }
    const cp = this.checkpointPending;
    this.checkpointPending = null;
    const prev = this.stateNow;
    let payloads: { ch: Channel; p: SeatPayload }[];
    try {
      payloads = this.channels.filter((ch) => ch.connected && !ch.left).map((ch) => ({ ch, p: seatPayload(r.state, ch.player, seq, r.events, ch.base, prev) }));
    } catch (e) {
      this.engineFailed(c.seat, c.action, e);
      return { code: 'engineError', message: 'The server failed on this action; the game is unchanged.' };
    }
    this.stateNow = r.state;
    this.seqNow = seq;
    if (!c.neutral) {
      this.lastProgressSeq = seq;
      if (!c.uncounted) this.progress++;
    }
    const notes = noteCount(c.action);
    if (notes > 0) this.channelOf(c.seat)!.notes += notes;
    const lost = this.trackLosses(prev, r.events);
    if (cp) this.cur.checkpoint = { seq, hash: cp.hash, stateJson: cp.json, losses: this.lossFacts() };
    if (!c.neutral) {
      try {
        this.clockAfter(c.seat, c.clock, lost, r.events.length, c.at);
      } catch (e) {
        // the change is applied: it is recorded and sent whatever the clock did (flagged for the developer)
        this.engineFailed(c.seat, c.action, e);
      }
    }
    const record: LogRecord = {
      game: this.game, seq, seat: c.seat, action: c.action,
      ...(c.cause ? { cause: c.cause } : {}), ...(c.approvedBy ? { approvedBy: [...c.approvedBy] } : {}),
      ...this.logFields(), at: iso(c.at), ...(cp ? { check: cp.hash } : {}),
    };
    this.cur.records.push(record);
    for (const { ch, p } of payloads) {
      ch.base = p.base;
      this.send(ch.seat, p.t, p.json);
    }
    if (c.reply) this.reply(c.reply.seat, c.reply.id);
    if (this.stateNow.result) this.endGame(c.at);
    else if (!c.neutral) this.checkCap(c.at);
    return null;
  }

  private checkpointPending: { hash: string; json: string } | null = null;

  /**
   * The size limits on a new state (design 2.2 step 3, D15): the absolute ones (objects, log, history; at a checkpoint the serialized size, whose hash
   * the record then carries) and, for a by-hand answer only (`manual`: the free-text driver; M13-2 review CRITICAL 1 and re-review C), the growth of
   * one action. Any other action is judged by the absolute limits alone: the resolution of another player's huge effect happens inside the victim's
   * pass, which must never be refused for its size of growth (the victim would be stuck and time out). `absolute` false: a smaller answer may fit.
   */
  private sizeRefusal(before: GameState, state: GameState, seq: number, exempt = false, manual = false): { message: string; absolute: boolean } | null {
    this.checkpointPending = null;
    if (!exempt) {
      const p = sizeProblem(state, this.limits);
      if (p) return { message: p, absolute: true };
      const g = manual ? growthProblem(before, state, this.limits) : null;
      if (g) return { message: g, absolute: false };
    }
    if (seq % this.limits.checkpointEvery === 0) {
      const cp = checkpointOf(state);
      if (!exempt && cp.bytes > this.limits.maxStateBytes) return { message: `The game state would pass ${this.limits.maxStateBytes} bytes; the action is refused.`, absolute: true };
      this.checkpointPending = { hash: cp.hash, json: cp.json };
    }
    return null;
  }

  /**
   * After a seat's action was refused for an absolute size limit: if that seat's pending decision cannot go on within the limits, the game is void
   * ("limit", design 2.2 step 3), so nobody is left to time out on a decision they can no longer answer (M13-2 review CRITICAL 1). Judged by the
   * continuations that need no choice: passing priority, cancelling the action in progress, resolving by hand with nothing; any other decision is
   * taken as stuck. Only the refused seat's own decision counts.
   */
  private voidIfStuck(at: number, seat: SeatNumber): void {
    const s = this.stateNow;
    const d = s.pending;
    if (!d || s.result || this.endNow) return;
    if (d.player !== this.channelOf(seat)?.player) return;
    const tries: Action[] = [];
    if (d.kind === 'priority') tries.push({ type: 'pass', player: d.player });
    if (d.kind !== 'priority' && d.cancellable && s.suspended) tries.push({ type: 'cancel', player: d.player });
    if (d.kind === 'manualResolve') tries.push({ type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'manualResolve', ops: [] } });
    for (const a of tries) {
      try {
        const r = applyAction(s, a);
        if (!r.error && !this.sizeRefusal(s, r.state, this.seqNow + 1, false, isManual(a))) {
          this.checkpointPending = null;
          return;
        }
      } catch {
        // an engine failure on the continuation: treated as no way on
      }
    }
    this.checkpointPending = null;
    this.endVoid('limit', at);
  }

  /** The per-game action cap (design 2.2 step 4): a warning at 90%, void at the cap. */
  private checkCap(at: number): void {
    if (this.progress >= this.limits.actions) {
      this.endVoid('limit', at);
      return;
    }
    if (!this.warnedCap && this.progress >= Math.ceil(this.limits.actions * this.limits.warnAt)) {
      this.warnedCap = true;
      this.notice('limitWarning', `This game has used ${this.progress} of its ${this.limits.actions} actions; at the limit it ends without a result.`, this.channels);
    }
  }

  /**
   * Players who lost in the last change get their out order (one per change: simultaneous losers share it), turn and the engine's citations of the
   * loss (`playerLost.rules`, M13-7).
   */
  private trackLosses(prev: GameState, events: readonly GameEvent[]): Channel[] {
    const lost = this.byIndex.filter((ch) => this.playerState(ch).hasLost && !prev.players.find((p) => p.id === ch.player)!.hasLost);
    if (lost.length) {
      this.outRound++;
      const rules = lossRulesOf(events);
      for (const ch of lost) {
        ch.outOrder = this.outRound;
        ch.outTurn = this.stateNow.turn.number;
        ch.lossRules = rules.get(ch.player) ?? null;
      }
    }
    return lost;
  }

  /** The clock events of an applied change: `answered` or `seatOut` for the actor, `seatOut` for anyone else out now, then `gameOver` or the next `decision`. */
  private clockAfter(seat: SeatNumber, ev: 'answered' | 'seatOut' | 'none', lost: Channel[], events: number, at: number): void {
    const ch = this.channelOf(seat)!;
    if (ev === 'answered') this.clockStep(this.clock.handle({ type: 'answered', at, seat: this.clockSeat(ch) }), at);
    for (const o of ev === 'seatOut' ? [ch, ...lost.filter((x) => x !== ch)] : lost) {
      if (!this.clock.isOut(this.clockSeat(o))) this.clockStep(this.clock.handle({ type: 'seatOut', at, seat: this.clockSeat(o) }), at);
    }
    if (this.stateNow.result) {
      this.clockStep(this.clock.handle({ type: 'gameOver', at }), at);
      return;
    }
    this.clockDecision(at, events);
  }

  private decisionKey(): string {
    const t = this.stateNow.turn;
    return `${this.stateNow.stage}|${t.number}|${t.step}`;
  }

  /** The pending decision to the clock: whose it is, whether the step changed since the last one, the change's events, the active seat. */
  private clockDecision(at: number, events: number): void {
    const d = this.stateNow.pending;
    if (!d || this.stateNow.result || this.clock.isOver()) return;
    const ch = this.channelOfPlayer(d.player);
    const active = this.channelOfPlayer(this.stateNow.turn.activePlayer);
    if (!ch) return;
    const key = this.decisionKey();
    const newStep = this.lastDecisionKey !== null && key !== this.lastDecisionKey;
    this.lastDecisionKey = key;
    this.clockStep(this.clock.handle({ type: 'decision', at, seat: this.clockSeat(ch), newStep, events, ...(active ? { active: this.clockSeat(active) } : {}) }), at);
  }

  /** The clock's fields of a record (`TableClock.logFields()`, seats as table seats). */
  private logFields(): Pick<LogRecord, 'clocks' | 'elapsedMs'> {
    const f = this.clock.logFields();
    return { clocks: f.clocks.map((r) => ({ ...r, seat: this.byIndex[r.seat - 1]!.seat })).sort((a, b) => a.seat - b.seat), elapsedMs: f.elapsedMs };
  }

  /** The views of a change to every connected seat (`seatPayload`: a patch against the seat's last view, or a full view). */
  private publish(events: readonly GameEvent[]): void {
    for (const ch of this.channels) {
      if (!ch.connected || ch.left) continue;
      const p = seatPayload(this.stateNow, ch.player, this.seqNow, events, ch.base, null);
      ch.base = p.base;
      this.send(ch.seat, p.t, p.json);
    }
  }

  /** A full view for one seat: the cached one when it is current, else built (`seatPayload` with no base). */
  private sendFull(ch: Channel): void {
    if (!ch.base || ch.base.seq !== this.seqNow) ch.base = seatPayload(this.stateNow, ch.player, this.seqNow, [], null, null).base;
    this.send(ch.seat, 'view', fullViewJson(ch.base));
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // The clock's outcomes

  private clockStep(s: ClockStep, at: number): void {
    if (s.changed) this.cur.clockDirty = true;
    for (const o of s.outcomes) this.onClockOutcome(o, at);
  }

  private onClockOutcome(o: ClockOutcome, at: number): void {
    if (this.endNow) return;
    switch (o.kind) {
      case 'timeout':
      case 'forfeit': {
        const ch = this.byIndex[o.seat - 1]!;
        const cause: TableCause = o.kind === 'timeout' ? 'timeout' : 'disconnect';
        this.notice(o.kind, o.kind === 'timeout' ? `Seat ${ch.seat} ran out of time and concedes (CR 104.3a).` : `Seat ${ch.seat} was away too long and concedes (CR 104.3a).`, this.channels, ch.seat);
        this.queue.push(() => this.serverConcession(ch, cause, o.at, at));
        return;
      }
      case 'void':
        this.endVoid(o.reason, at);
        return;
      case 'limitWarning':
        this.notice('limitWarning', 'This game has used 90% of its time limit; at the limit it ends without a result.', this.channels);
        return;
      case 'abandoning':
        this.notice('abandoning', 'Nobody in the game is connected; the game ends without a result unless someone comes back.', this.channels);
        return;
      case 'proposalClosed':
        this.queue.push(() => this.onProposalClosed(o.id, o.outcome, at));
        return;
      default:
        return; // opened, refused, cancelRefused and ignored are read by the caller that sent the event
    }
  }

  /** The server applies a seat's concession (design D11): time-out or drop forfeit. Logged as the seat's `concede` with its cause. */
  private serverConcession(ch: Channel, cause: TableCause, when: number, at: number): void {
    if (this.endNow) return;
    const p = this.playerState(ch);
    if (p.hasLost) return;
    ch.cause = cause;
    const err = this.commit({ seat: ch.seat, action: { type: 'concede', player: ch.player }, at: Math.min(when, at), clock: 'seatOut', cause });
    if (err) {
      ch.cause = null;
      this.logger?.log('error', 'concessionRefused', { game: this.game, seat: ch.seat, cause });
    }
  }

  private drain(): void {
    if (this.draining) return;
    this.draining = true;
    try {
      for (let job = this.queue.shift(); job; job = this.queue.shift()) {
        try {
          job();
        } catch (e) {
          // one failing job (a server concession, an approved proposal) never drops the others
          this.engineErrorCount++;
          this.logger?.log('error', 'tableJobError', { game: this.game, error: e instanceof Error ? e.name : 'error' });
        }
      }
    } finally {
      this.draining = false;
    }
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // The end

  private endGame(at: number): void {
    if (this.endNow || !this.stateNow.result) return;
    const s = this.stateNow;
    if (!this.clock.isOver()) this.clockStep(this.clock.handle({ type: 'gameOver', at }), at);
    const v = this.clock.view();
    const seats: PlacementSeat[] = this.channels.map((ch) => {
      const c = v.seats[ch.index]!;
      return {
        seat: ch.seat, player: ch.player, name: ch.name, cause: ch.cause, outOrder: ch.outOrder, outTurn: ch.outTurn, lossRules: ch.lossRules,
        timeUsedMs: Math.max(0, this.settings.bankMs - c.bankMs), timeouts: ch.cause === 'timeout' ? 1 : 0, disconnectedMs: Math.max(0, this.settings.dropMs - c.dropMs),
      };
    });
    const outcomes = this.placementRule(s, seats);
    const end: TableEnd = {
      outcome: s.result!.winner === null ? 'draw' : 'win', reason: s.result!.reason, result: { ...s.result! }, at, seq: this.seqNow, actions: this.progress,
      turns: s.turn.number, seats: outcomes,
    };
    this.finish(end);
  }

  private endVoid(reason: VoidReason, at: number): void {
    if (this.endNow) return;
    if (!this.clock.isOver()) this.clockStep(this.clock.handle({ type: 'gameOver', at }), at);
    this.cur.clockDirty = true;
    const end: TableEnd = { outcome: 'void', reason, result: null, at, seq: this.seqNow, actions: this.progress, turns: this.stateNow.turn.number, seats: [] };
    const words: Record<VoidReason, string> = {
      abandoned: 'nobody in the game was connected for 5 minutes',
      limit: 'it reached a limit of the server (actions, time or size)',
      recovery: 'the server could not restore it',
      commit: 'the server could not save it',
      quarantined: 'it stopped the server',
      updated: 'the server was updated',
    };
    this.notice('voided', `The game ends without a result: ${words[reason]}.`, this.channels);
    this.finish(end);
  }

  private finish(end: TableEnd): void {
    this.endNow = end;
    this.cur.end = end;
    const p = this.proposal;
    if (p) {
      this.proposal = null;
      const closed = json({ t: 'proposalClosed', proposal: p.id, outcome: 'withdrawn' });
      for (const seat of [p.seat, ...p.approvers]) {
        const c = this.channelOf(seat)!;
        if (c.connected && !c.left) this.send(seat, 'proposalClosed', closed);
      }
      this.reply(p.seat, p.actId, { code: 'manualRejected', message: 'Withdrawn: the game is over.' });
    }
    const text = this.resultJson(end);
    for (const ch of this.channels) if (ch.connected && !ch.left) this.send(ch.seat, 'result', text);
  }

  private resultJson(end: TableEnd): string {
    return json({ t: 'result', outcome: end.outcome, reason: end.reason, result: end.result, placements: publicPlacements(end.seats) });
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Helpers

  private channelOf(seat: number): Channel | undefined {
    return this.channels.find((c) => c.seat === seat);
  }

  private channelOfPlayer(player: PlayerId): Channel | undefined {
    return this.byIndex.find((c) => c.player === player);
  }

  private clockSeat(ch: Channel): SeatNumber {
    return (ch.index + 1) as SeatNumber;
  }

  /** Out of the game: by the engine (lost, conceded) or by the clock (a time-out or forfeit about to be applied). */
  private isOut(ch: Channel): boolean {
    return this.playerState(ch).hasLost || this.clock.isOut(this.clockSeat(ch));
  }

  /** The engine's state of a seat's player (by id: `state.players` is in turn order, which the engine sets at the start). */
  private playerState(ch: Channel): GameState['players'][number] {
    return this.stateNow.players.find((p) => p.id === ch.player)!;
  }

  private send(seat: SeatNumber, t: HostedServerType, text: string): void {
    this.cur.sends.push({ seat, t, json: text });
  }

  private reply(seat: SeatNumber, id: number, error?: HostedError): void {
    this.send(seat, 'reply', json(error ? { t: 'reply', id, ok: false, error } : { t: 'reply', id, ok: true }));
  }

  private notice(kind: NoticeKind, text: string, to: readonly Channel[], seat?: SeatNumber): void {
    const m = json({ t: 'notice', kind, ...(seat !== undefined ? { seat } : {}), text });
    for (const ch of to) if (ch.connected && !ch.left) this.send(ch.seat, 'notice', m);
  }

  private engineFailed(seat: SeatNumber, action: Action, e: unknown): void {
    this.engineErrorCount++;
    this.logger?.log('error', 'engineError', { game: this.game, seat, action: action.type, error: e instanceof Error ? e.name : 'error' });
  }
}
