/**
 * The table clock (design section 5, 4.4, D9, D11, D12; review 1 and 6): a pure, deterministic state machine per table. It never reads a clock and never
 * sets a timer: every input is an explicit `ClockEvent` stamped with the server time `at` (milliseconds), and the caller asks `nextDeadline()` when to
 * send the next `tick` (the timer wheel, `timer-wheel.ts`). Outputs are `ClockOutcome`s (time-outs, drop forfeits, voids, warnings, proposal
 * lifecycle) and `ClockView` snapshots for the players.
 *
 * The rules it keeps:
 *
 * - **Bank** per seat (15 minutes 1v1, 20 in a pod: `DEFAULT_CLOCKS`). It runs only while that seat must decide (`decision`) and is connected, after
 *   the free delay of the seat's control period. At 0 the seat times out: a concession by the table's rule (CR 104.3a), cause `timeout`.
 * - **Control periods** (5.1, review 1). A `decision` starts a new control period, with a fresh delay (5 s) plus the animation allowance of the change
 *   that started it (150 ms per event, at most 10 s), only when the previous period was another seat's, or the step changed, or it is the game's first
 *   decision. Further decisions of the same seat in the same step use what is left of that delay, then the bank.
 * - **Cancel** (CR 733.1): the seat goes on with its own control period as it was: no new delay, the time spent stays spent. At most
 *   `CLOCK_LIMITS.cancelsPerPeriod` (3) cancels per control period; a further one is answered `cancelRefused` and the table refuses it (the player
 *   finishes the action or lets the clock run), so a script cannot drive thousands of logged cancels into the per-game action cap (M13-3 review).
 *   Only the deciding seat may cancel (or, between an answer and the next decision, a seat resuming its own period).
 * - **Proposals** (5.4, D12): proposing stops the proposer's clock; every other seat still in the game is an approver whose own clock runs (one free
 *   delay per proposal, then their bank; several at once). A rejection or a withdrawal resumes the proposer's clock as it was (no new delay). At most
 *   `GAME_LIMITS.proposalsPerDecision` (2) proposals per **control period** (M13-3 review: counted per period, never reset by an answered decision or a
 *   cancel, else cast-propose-propose-cancel loops drained the approvers); then `proposalRefused` with `notesOnly`. So an approver's free delay is
 *   granted at most twice per period of the proposer.
 * - **Actions per seat**: answered decisions and accepted cancels are counted per seat and written in the readings, so that a game that reaches a cap
 *   can be attributed (milestone 15's ranked rules).
 * - **Disconnects** (5.3, 4.4): a disconnected seat's bank (and approval clock) stops and its drop clock runs instead: `dropMs` (5 minutes) in total per
 *   game, cumulative across drops. At 0 the seat forfeits: a concession, cause `disconnect`.
 * - **Abandonment** (4.4, review 6): while no seat still in the game is connected, every drop clock pauses and only the abandonment timer runs (5
 *   minutes); at its end the game is void (`abandoned`). A seat that reconnects stops it; the others' drop clocks resume where they paused.
 * - **Wall-clock cap** (2.2, D9): 2 hours 1v1, 4 in a pod (outages not counted); `limitWarning` at 90%, void (`limit`) at the cap.
 * - **Outages** (2.3): `recoverTableClock` restores the clocks from the last record's readings; the outage is charged to nobody and every seat gets a
 *   fresh reconnect window (5 minutes, not counted in its allowance), which ends at the seat's first reconnect.
 *
 * **Same-instant ordering** (4.4). Events are handled in the order given. Before an event at `at`, every expiry strictly before `at` is processed; the
 * expiries at exactly `at` are processed only by a `tick` (so an input at the instant of an expiry comes first: (1) a player who comes back at the instant
 * their clock would expire keeps the seat; an action at the instant the bank reaches 0 is in time). Expiries at one instant are processed in this order,
 * each re-evaluated after the one before: (2) abandonment (drop clocks are already paused while nobody is connected; its end voids the game), (3) drop
 * forfeits, (4) bank time-outs (approvers included), each in turn order starting with the active seat, (5) the wall-clock warning and cap. When at most
 * one seat is left in the game, the clocks stop (the game is over).
 */
import { DEFAULT_CLOCKS, HOSTED_TIMING, type ClockSettings, type ClockView, type SeatClock, type SeatNumber } from '../api';
import { GAME_LIMITS } from '../config';
import type { ClockReading, LogRecord } from '../store/api';

/** The clock's own fixed times (design 5.1, 2.3). */
export const CLOCK_TIMING = {
  /** The animation allowance added to a control period's delay: 150 ms per event of the change that started it, at most 10 s. */
  animationPerEventMs: 150,
  animationMaxMs: 10_000,
  /** After a recovery every seat gets a fresh reconnect window, not counted in its disconnect allowance (design 2.3). */
  reconnectWindowMs: 5 * 60_000,
  /** The abandonment timer (design 4.4). */
  abandonMs: HOSTED_TIMING.abandonMs,
} as const;

/** The clock's per-control-period limits (design D9, D12; the M13-3 review). */
export const CLOCK_LIMITS = {
  /** Cancels (CR 733.1) per control period of a seat; further cancels are refused (`cancelRefused`). */
  cancelsPerPeriod: 3,
  /** By-hand change proposals per control period of a seat (the contract's `GAME_LIMITS.proposalsPerDecision`); then notes only. */
  proposalsPerPeriod: GAME_LIMITS.proposalsPerDecision,
} as const;

/** The default clocks for a table size (owner answer 7, 8): 1v1 for 2 seats, pod for 3-4. Tables normally pass `clockFor(config.clocks, ...)`. */
export function defaultClockSettings(seats: number): ClockSettings {
  return { ...(seats === 2 ? DEFAULT_CLOCKS['1v1'] : DEFAULT_CLOCKS.pod) };
}

/** The wall-clock cap of a table size (design 2.2): 2 hours 1v1, 4 hours in a pod. */
export function wallClockCapMs(seats: number): number {
  return seats === 2 ? GAME_LIMITS.wallClock1v1Ms : GAME_LIMITS.wallClockPodMs;
}

/** The inputs of the clock. `at` is server time in milliseconds; an `at` earlier than the clock's time is treated as the clock's time. */
export type ClockEvent =
  /** Process every expiry up to and including `at` (the timer wheel's wake-up). */
  | { type: 'tick'; at: number }
  /**
   * A decision is pending for `seat` (the engine's `state.pending.player` or priority holder after an apply). `newStep`: the step or turn changed since
   * the last decision. `events`: how many events the change that led here produced (the animation allowance). `active`: the active player's seat (the
   * same-instant order starts with it).
   */
  | { type: 'decision'; at: number; seat: SeatNumber; newStep?: boolean; events?: number; active?: SeatNumber }
  /** The deciding seat's decision was answered (an action applied, a notes-only resolution included). Nobody's bank runs until the next `decision`. */
  | { type: 'answered'; at: number; seat: SeatNumber }
  /** `seat` cancelled a suspended action (CR 733.1): it goes on with its control period as it was. */
  | { type: 'cancel'; at: number; seat: SeatNumber }
  /** The deciding seat proposes a by-hand change (D12). */
  | { type: 'propose'; at: number; seat: SeatNumber }
  /** An approver answers the open proposal. */
  | { type: 'vote'; at: number; seat: SeatNumber; approve: boolean }
  /** The proposer withdraws the open proposal. */
  | { type: 'withdraw'; at: number; seat: SeatNumber }
  | { type: 'disconnect'; at: number; seat: SeatNumber }
  | { type: 'reconnect'; at: number; seat: SeatNumber }
  /** `seat` is out of the game by the engine (Leave, an in-game concession, a loss in a pod that goes on). Not needed after the clock's own outcomes. */
  | { type: 'seatOut'; at: number; seat: SeatNumber }
  /** The game ended (a win, a draw, a void decided elsewhere): every clock stops. */
  | { type: 'gameOver'; at: number };
export type ClockEventType = ClockEvent['type'];

/** Why a proposal was refused (D12): one is open already, the seat is not the deciding seat, or the decision's proposals are used up (notes only now). */
export type ProposalRefusal = 'pending' | 'notDeciding' | 'notesOnly';

/** The outputs. Expiries carry the exact instant the clock reached 0 (`at`), whatever the time of the tick that found them. */
export type ClockOutcome =
  /** The seat's bank reached 0: apply its concession, cause `timeout` (CR 104.3a). The clock already counts the seat as out. */
  | { kind: 'timeout'; seat: SeatNumber; at: number }
  /** The seat's disconnect allowance reached 0: apply its concession, cause `disconnect` (CR 104.3a). The clock already counts the seat as out. */
  | { kind: 'forfeit'; seat: SeatNumber; at: number }
  /** The game is void: nobody in the game was connected for the abandonment time, or the wall-clock cap. Every clock has stopped. */
  | { kind: 'void'; reason: 'abandoned' | 'limit'; at: number }
  /** 90% of the wall-clock cap (the players get `limitWarning`). */
  | { kind: 'limitWarning'; at: number }
  /** Nobody still in the game is connected: the abandonment timer started; the game is void at `untilAt` unless someone comes back. */
  | { kind: 'abandoning'; at: number; untilAt: number }
  | { kind: 'proposalOpened'; id: number; seat: SeatNumber; approvers: SeatNumber[] }
  | { kind: 'proposalRefused'; seat: SeatNumber; reason: ProposalRefusal }
  | { kind: 'proposalClosed'; id: number; outcome: 'approved' | 'rejected' | 'withdrawn' }
  /** The seat used its cancels of this control period (`CLOCK_LIMITS.cancelsPerPeriod`): the table must refuse the cancel; nothing changed. */
  | { kind: 'cancelRefused'; seat: SeatNumber }
  /** The event did not fit the clock's state (a vote with no open proposal, a seat already out, ...); nothing changed. */
  | { kind: 'ignored'; event: ClockEventType; reason: string };

/** The result of one event: its outcomes, and whether the clocks' shape changed (a clock started or stopped, a delay was granted): send `clock`. */
export interface ClockStep {
  outcomes: ClockOutcome[];
  changed: boolean;
}

interface SeatState {
  seat: SeatNumber;
  bankMs: number;
  /** The delay left in this seat's latest control period. */
  delayMs: number;
  /** The table's number of this seat's latest control period (0: none yet). */
  period: number;
  /** The disconnect allowance left (cumulative per game). */
  dropMs: number;
  /** A reconnect window after a recovery, used before the allowance (design 2.3). */
  graceMs: number;
  connected: boolean;
  out: boolean;
  /** Proposals and cancels in this seat's current control period (reset only when the seat starts a new period). */
  proposals: number;
  cancels: number;
  /** Answered decisions and accepted cancels of this seat in the game (written in the readings). */
  actions: number;
}

interface Proposal {
  id: number;
  seat: SeatNumber;
  /** Approvers who have not answered, in seat order. */
  pending: SeatNumber[];
  /** Each approver's free delay left for this proposal, by seat. */
  delay: Partial<Record<SeatNumber, number>>;
}

export interface TableClockOptions {
  /** 2, 3 or 4 seats (seats 1..n in seating and turn order). */
  seats: number;
  /** The game's start (server time). */
  at: number;
  /** The table's clocks (default: `defaultClockSettings(seats)`). */
  settings?: ClockSettings;
  /** The seats connected at the start (default: all). */
  connected?: SeatNumber[];
}

export interface RecoverOptions {
  seats: number;
  /** The time the table is back (the outage before it is charged to nobody). */
  at: number;
  settings?: ClockSettings;
  /** The last committed record's clock fields (design 5.1): its readings and the wall-clock time used (`TableClock.logFields()`). */
  record: Pick<LogRecord, 'clocks' | 'elapsedMs'>;
  /** The seat whose decision is pending in the recovered state (it continues its control period as it was), if any. */
  controller: SeatNumber | null;
  /** The active player's seat in the recovered state. */
  active?: SeatNumber;
  /** Seats already out of the game in the recovered state. */
  out?: SeatNumber[];
}

/** Bank time left after `ms` of running: the delay is used first, then the bank (never below 0). */
function consume(delayMs: number, bankMs: number, ms: number): [number, number] {
  const fromDelay = Math.min(delayMs, ms);
  return [delayMs - fromDelay, Math.max(0, bankMs - (ms - fromDelay))];
}

export class TableClock {
  readonly settings: ClockSettings;
  readonly capMs: number;
  private readonly seats: SeatState[];
  private now: number;
  /** The seat whose bank runs (absent a proposal), or null between an answer and the next decision. */
  private controller: SeatNumber | null = null;
  /** The seat owning the current control period (stays after `answered`, so the same seat's next decision continues it). */
  private periodOwner: SeatNumber | null = null;
  private periods = 0;
  private active: SeatNumber = 1;
  private proposal: Proposal | null = null;
  private nextProposalId = 1;
  private abandonLeftMs: number | null = null;
  private elapsedMs = 0;
  private warned = false;
  private over = false;

  constructor(opts: TableClockOptions) {
    const n = opts.seats;
    if (!Number.isInteger(n) || n < 2 || n > 4) throw new Error(`TableClock: 2-4 seats, not ${n}`);
    this.settings = { ...(opts.settings ?? defaultClockSettings(n)) };
    this.capMs = wallClockCapMs(n);
    this.now = opts.at;
    const connected = opts.connected ?? null;
    this.seats = Array.from({ length: n }, (_, i) => {
      const seat = (i + 1) as SeatNumber;
      return {
        seat, bankMs: this.settings.bankMs, delayMs: 0, period: 0, dropMs: this.settings.dropMs, graceMs: 0,
        connected: connected === null || connected.includes(seat), out: false, proposals: 0, cancels: 0, actions: 0,
      };
    });
    this.updateAbandon([]);
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Reading

  /** The clock's time: the last instant it has accounted for. */
  get time(): number {
    return this.now;
  }

  /** Wall-clock game time counted toward the cap (outages not counted). */
  get elapsed(): number {
    return this.elapsedMs;
  }

  isOver(): boolean {
    return this.over;
  }

  isOut(seat: SeatNumber): boolean {
    return this.seat(seat)?.out ?? true;
  }

  /** The open proposal's id, proposer and the approvers yet to answer. */
  openProposal(): { id: number; seat: SeatNumber; pending: SeatNumber[] } | null {
    return this.proposal ? { id: this.proposal.id, seat: this.proposal.seat, pending: [...this.proposal.pending] } : null;
  }

  /** Proposals the seat made in its current control period (D12: at most `CLOCK_LIMITS.proposalsPerPeriod`). */
  proposalsMade(seat: SeatNumber): number {
    return this.seat(seat)?.proposals ?? 0;
  }

  /**
   * The next instant at which something expires if no event comes first (a bank, a drop clock, the abandonment timer, the cap or its warning), or
   * null when nothing runs out (the game is over). Send `tick` at this time.
   */
  nextDeadline(): number | null {
    if (this.over) return null;
    let best = Infinity;
    if (this.abandonLeftMs !== null) best = Math.min(best, this.now + this.abandonLeftMs);
    for (const s of this.seats) {
      if (this.dropRunning(s)) best = Math.min(best, this.now + s.graceMs + s.dropMs);
      if (this.bankRunning(s)) best = Math.min(best, this.now + this.runningDelay(s) + s.bankMs);
    }
    if (!this.warned) best = Math.min(best, this.now + Math.max(0, this.warnAtMs() - this.elapsedMs));
    best = Math.min(best, this.now + Math.max(0, this.capMs - this.elapsedMs));
    return best;
  }

  /**
   * The clocks as the players see them at `at` (default: the clock's time), projected without processing expiries (values stop at 0): call it after
   * the events and ticks up to `at`.
   */
  view(at: number = this.now): ClockView {
    const dt = Math.max(0, at - this.now);
    const seats: SeatClock[] = this.seats.map((s) => {
      const running = this.bankRunning(s);
      const dropRunning = this.dropRunning(s);
      let delayMs = this.shownDelay(s);
      let bankMs = s.bankMs;
      if (running) [delayMs, bankMs] = consume(delayMs, bankMs, dt);
      let graceMs = s.graceMs;
      let dropMs = s.dropMs;
      if (dropRunning) [graceMs, dropMs] = consume(graceMs, dropMs, dt);
      return { seat: s.seat, bankMs, running, delayMs, dropMs: graceMs + dropMs, dropRunning };
    });
    const v: ClockView = { at: Math.max(at, this.now), seats };
    if (this.abandonLeftMs !== null && !this.over) v.abandonMs = Math.max(0, this.abandonLeftMs - dt);
    return v;
  }

  /**
   * The readings written with each log record (design 5.1): bank, disconnect allowance, the delay left in the seat's latest period, its number, the
   * seat's action count. Take them after the events of the action (`answered`, then the next `decision`), so the record carries the period the next
   * decision runs in: a recovery from it continues that period.
   */
  readings(): ClockReading[] {
    return this.seats.map((s) => ({ seat: s.seat, bankMs: s.bankMs, dropMs: s.dropMs, delayMs: s.delayMs, period: s.period, actions: s.actions }));
  }

  /** A log record's clock fields (`LogRecord.clocks` and `elapsedMs`), taken as `readings()` says. */
  logFields(): Pick<LogRecord, 'clocks' | 'elapsedMs'> {
    return { clocks: this.readings(), elapsedMs: this.elapsedMs };
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Driving

  /**
   * Accounts for the time up to `at` and processes every expiry strictly before it (call before applying a player's action at `at`: a seat that timed
   * out before it is out, and its action is refused).
   */
  advance(at: number): ClockStep {
    return this.step((out) => {
      this.run(at, false, out);
    });
  }

  /** Handles one event (see `ClockEvent`). Never throws on a bad event: it answers `ignored`. */
  handle(e: ClockEvent): ClockStep {
    return this.step((out) => {
      if (e.type === 'tick') {
        this.run(e.at, true, out);
        return;
      }
      this.run(e.at, false, out);
      this.apply(e, out);
      this.updateAbandon(out);
    });
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Internals

  private step(body: (out: ClockOutcome[]) => void): ClockStep {
    const before = this.shape();
    const out: ClockOutcome[] = [];
    body(out);
    const changed = out.some((o) => o.kind !== 'ignored' && o.kind !== 'proposalRefused' && o.kind !== 'cancelRefused') || this.shape() !== before;
    return { outcomes: out, changed };
  }

  /** The discrete parts of the state: a change means a clock started or stopped or a delay was granted (the browser cannot extrapolate it). */
  private shape(): string {
    return JSON.stringify([
      this.over, this.controller, this.periodOwner, this.periods, this.proposal?.id ?? 0, this.proposal?.pending ?? [], this.abandonLeftMs !== null,
      this.seats.map((s) => [s.connected, s.out, s.period]),
    ]);
  }

  private seat(n: number): SeatState | undefined {
    return Number.isInteger(n) ? this.seats[n - 1] : undefined;
  }

  private warnAtMs(): number {
    return Math.floor(this.capMs * GAME_LIMITS.warnAt);
  }

  private inGame(): SeatState[] {
    return this.seats.filter((s) => !s.out);
  }

  private anyConnected(): boolean {
    return this.seats.some((s) => !s.out && s.connected);
  }

  /** The seat's bank (or approval clock) runs: it must decide or approve, it is connected, the game goes on. */
  private bankRunning(s: SeatState): boolean {
    if (this.over || s.out || !s.connected) return false;
    if (this.proposal) return this.proposal.pending.includes(s.seat);
    return this.controller === s.seat;
  }

  private dropRunning(s: SeatState): boolean {
    return !this.over && !s.out && !s.connected && this.anyConnected();
  }

  /** The delay that runs before the bank: the approver's per-proposal delay, else the seat's control-period delay. */
  private runningDelay(s: SeatState): number {
    if (this.proposal && this.proposal.pending.includes(s.seat)) return this.proposal.delay[s.seat] ?? 0;
    return s.delayMs;
  }

  /** The delay shown to the players: an approver's, the deciding seat's (also while its proposal waits), else 0. */
  private shownDelay(s: SeatState): number {
    if (s.out || this.over) return 0;
    if (this.proposal && this.proposal.pending.includes(s.seat)) return this.proposal.delay[s.seat] ?? 0;
    return this.controller === s.seat ? s.delayMs : 0;
  }

  /** Seats in turn order starting with the active seat (seating order is turn order). */
  private turnOrder(): SeatState[] {
    const n = this.seats.length;
    const start = this.active - 1;
    return Array.from({ length: n }, (_, i) => this.seats[(start + i) % n]!);
  }

  /** Lets `ms` of time pass with the current running clocks (no expiry processing; values stop at 0). */
  private elapse(ms: number): void {
    if (ms <= 0 || this.over) return;
    this.elapsedMs += ms;
    if (this.abandonLeftMs !== null) this.abandonLeftMs = Math.max(0, this.abandonLeftMs - ms);
    const p = this.proposal;
    for (const s of this.seats) {
      if (this.bankRunning(s)) {
        if (p && p.pending.includes(s.seat)) {
          const [d, b] = consume(p.delay[s.seat] ?? 0, s.bankMs, ms);
          p.delay[s.seat] = d;
          s.bankMs = b;
        } else {
          [s.delayMs, s.bankMs] = consume(s.delayMs, s.bankMs, ms);
        }
      }
      if (this.dropRunning(s)) [s.graceMs, s.dropMs] = consume(s.graceMs, s.dropMs, ms);
    }
  }

  /** Moves the clock to `at`, processing each expiry on the way (strictly before `at`, or up to and including it when `inclusive`). */
  private run(at: number, inclusive: boolean, out: ClockOutcome[] = []): ClockOutcome[] {
    // A stale input (stamped before the clock's time) is handled at the clock's time, but never as a tick of that instant: the expiries at the current
    // instant wait for a tick stamped at it (inputs at an instant come first).
    const incl = inclusive && Number.isFinite(at) && at >= this.now;
    const target = Number.isFinite(at) ? Math.max(at, this.now) : this.now;
    for (;;) {
      const d = this.nextDeadline();
      if (d === null || d > target || (d === target && !incl)) break;
      this.elapse(d - this.now);
      this.now = d;
      if (this.expire(out) === 0) break; // cannot happen while deadlines and expiries agree; never loop
    }
    this.elapse(target - this.now);
    this.now = target;
    return out;
  }

  /** Processes everything that has run out at the current instant, in the same-instant order (design 4.4). Returns how many were processed. */
  private expire(out: ClockOutcome[]): number {
    let n = 0;
    while (!this.over) {
      // (2) The abandonment timer (drop clocks are paused while it runs).
      if (this.abandonLeftMs !== null && this.abandonLeftMs <= 0) {
        this.voidGame('abandoned', out);
        n++;
        break;
      }
      const order = this.turnOrder();
      // (3) Drop forfeits, in turn order from the active seat.
      const dropped = order.find((s) => this.dropRunning(s) && s.graceMs + s.dropMs <= 0);
      if (dropped) {
        out.push({ kind: 'forfeit', seat: dropped.seat, at: this.now });
        this.markOut(dropped, out);
        n++;
        continue;
      }
      // (4) Bank time-outs (deciding seat and approvers), same order.
      const timedOut = order.find((s) => this.bankRunning(s) && this.runningDelay(s) + s.bankMs <= 0);
      if (timedOut) {
        out.push({ kind: 'timeout', seat: timedOut.seat, at: this.now });
        this.markOut(timedOut, out);
        n++;
        continue;
      }
      // (5) The wall-clock warning and cap.
      if (!this.warned && this.elapsedMs >= this.warnAtMs()) {
        this.warned = true;
        out.push({ kind: 'limitWarning', at: this.now });
        n++;
        continue;
      }
      if (this.elapsedMs >= this.capMs) {
        this.voidGame('limit', out);
        n++;
      }
      break;
    }
    return n;
  }

  private voidGame(reason: 'abandoned' | 'limit', out: ClockOutcome[]): void {
    out.push({ kind: 'void', reason, at: this.now });
    this.stop();
  }

  private stop(): void {
    this.over = true;
    this.controller = null;
    this.proposal = null;
    this.abandonLeftMs = null;
  }

  /** A seat leaves the game: its clocks stop; an open proposal it made is withdrawn, one it had to approve no longer waits for it. */
  private markOut(s: SeatState, out: ClockOutcome[]): void {
    s.out = true;
    if (this.controller === s.seat) this.controller = null;
    if (this.periodOwner === s.seat) this.periodOwner = null;
    if (this.inGame().length <= 1) {
      // The game is over (the last seat wins by the concession): an open proposal simply ends with it, never "approved" by default.
      this.stop();
      return;
    }
    const p = this.proposal;
    if (p) {
      if (p.seat === s.seat) this.closeProposal('withdrawn', out);
      else if (p.pending.includes(s.seat)) {
        p.pending = p.pending.filter((x) => x !== s.seat);
        delete p.delay[s.seat];
        if (p.pending.length === 0) this.closeProposal('approved', out);
      }
    }
    this.updateAbandon(out);
  }

  /** Starts the abandonment timer when nobody still in the game is connected, and stops it when someone is. */
  private updateAbandon(out: ClockOutcome[]): void {
    if (this.over) return;
    if (this.anyConnected()) this.abandonLeftMs = null;
    else if (this.abandonLeftMs === null) {
      this.abandonLeftMs = CLOCK_TIMING.abandonMs;
      out.push({ kind: 'abandoning', at: this.now, untilAt: this.now + CLOCK_TIMING.abandonMs });
    }
  }

  private closeProposal(outcome: 'approved' | 'rejected' | 'withdrawn', out: ClockOutcome[]): void {
    if (!this.proposal) return;
    out.push({ kind: 'proposalClosed', id: this.proposal.id, outcome });
    // The proposer's clock resumes as it was: the controller and its period's delay were never touched.
    this.proposal = null;
  }

  private apply(e: Exclude<ClockEvent, { type: 'tick' }>, out: ClockOutcome[]): void {
    const ignore = (reason: string): void => {
      out.push({ kind: 'ignored', event: e.type, reason });
    };
    if (this.over) return ignore('the game is over');
    if (e.type === 'gameOver') {
      this.stop();
      return;
    }
    const s = this.seat(e.seat);
    if (!s) return ignore(`no seat ${String(e.seat)}`);
    if (s.out) return ignore(`seat ${s.seat} is out of the game`);
    switch (e.type) {
      case 'decision': {
        if (e.active !== undefined) {
          const a = this.seat(e.active);
          if (a) this.active = a.seat;
        }
        const newPeriod = this.periodOwner !== s.seat || e.newStep === true || this.periods === 0;
        if (this.proposal && (newPeriod || this.proposal.seat !== s.seat)) this.closeProposal('withdrawn', out);
        if (newPeriod) {
          this.periods++;
          const events = Number.isFinite(e.events) && (e.events ?? 0) > 0 ? Math.floor(e.events!) : 0;
          s.period = this.periods;
          s.delayMs = this.settings.delayMs + Math.min(events * CLOCK_TIMING.animationPerEventMs, CLOCK_TIMING.animationMaxMs);
          this.periodOwner = s.seat;
          s.proposals = 0;
          s.cancels = 0;
        }
        this.controller = s.seat;
        return;
      }
      case 'answered': {
        if (this.controller !== s.seat) return ignore(`seat ${s.seat} is not deciding`);
        if (this.proposal) this.closeProposal('withdrawn', out);
        this.controller = null;
        s.actions++;
        return;
      }
      case 'cancel': {
        // CR 733.1: back to the seat's own control period as it was. No new delay, no refund, and the period's counts stay.
        if (this.controller !== null && this.controller !== s.seat) return ignore(`seat ${s.seat} is not deciding`);
        if (s.cancels >= CLOCK_LIMITS.cancelsPerPeriod) return void out.push({ kind: 'cancelRefused', seat: s.seat });
        s.cancels++;
        s.actions++;
        if (this.proposal) this.closeProposal('withdrawn', out);
        this.controller = s.seat;
        this.periodOwner = s.seat;
        return;
      }
      case 'propose': {
        if (this.proposal) return void out.push({ kind: 'proposalRefused', seat: s.seat, reason: 'pending' });
        if (this.controller !== s.seat) return void out.push({ kind: 'proposalRefused', seat: s.seat, reason: 'notDeciding' });
        if (s.proposals >= CLOCK_LIMITS.proposalsPerPeriod) return void out.push({ kind: 'proposalRefused', seat: s.seat, reason: 'notesOnly' });
        s.proposals++;
        const approvers = this.inGame().filter((x) => x.seat !== s.seat).map((x) => x.seat);
        const delay: Partial<Record<SeatNumber, number>> = {};
        for (const a of approvers) delay[a] = this.settings.delayMs;
        this.proposal = { id: this.nextProposalId++, seat: s.seat, pending: approvers, delay };
        out.push({ kind: 'proposalOpened', id: this.proposal.id, seat: s.seat, approvers: [...approvers] });
        return;
      }
      case 'vote': {
        const p = this.proposal;
        if (!p || !p.pending.includes(s.seat)) return ignore(`seat ${s.seat} has no proposal to answer`);
        if (!e.approve) {
          this.closeProposal('rejected', out);
          return;
        }
        p.pending = p.pending.filter((x) => x !== s.seat);
        delete p.delay[s.seat];
        if (p.pending.length === 0) this.closeProposal('approved', out);
        return;
      }
      case 'withdraw': {
        if (!this.proposal || this.proposal.seat !== s.seat) return ignore(`seat ${s.seat} has no open proposal`);
        this.closeProposal('withdrawn', out);
        return;
      }
      case 'disconnect': {
        if (!s.connected) return ignore(`seat ${s.seat} is already disconnected`);
        s.connected = false;
        return;
      }
      case 'reconnect': {
        if (s.connected) return ignore(`seat ${s.seat} is already connected`);
        s.connected = true;
        // A recovery's reconnect window ends at the first return; later drops use only the allowance (5 minutes in total per game).
        s.graceMs = 0;
        return;
      }
      case 'seatOut': {
        this.markOut(s, out);
        return;
      }
    }
  }

  /** Restores a table's clocks after an outage (design 2.3): see `recoverTableClock`. */
  static recover(opts: RecoverOptions): TableClock {
    const c = new TableClock({ seats: opts.seats, at: opts.at, settings: opts.settings, connected: [] });
    const out = new Set(opts.out ?? []);
    for (const s of c.seats) {
      const r = opts.record.clocks.find((x) => x.seat === s.seat);
      if (r) {
        s.bankMs = Math.max(0, r.bankMs);
        s.dropMs = Math.max(0, r.dropMs);
        s.delayMs = Math.max(0, r.delayMs);
        s.period = Math.max(0, Math.floor(r.period));
        s.actions = Math.max(0, Math.floor(r.actions ?? 0));
      }
      s.graceMs = CLOCK_TIMING.reconnectWindowMs;
      s.out = out.has(s.seat);
    }
    c.periods = Math.max(0, ...c.seats.map((s) => s.period));
    c.elapsedMs = Math.max(0, Number.isFinite(opts.record.elapsedMs) ? opts.record.elapsedMs : 0);
    c.warned = c.elapsedMs >= c.warnAtMs();
    const active = opts.active !== undefined ? c.seat(opts.active) : undefined;
    if (active) c.active = active.seat;
    const ctl = opts.controller !== null ? c.seat(opts.controller) : undefined;
    if (ctl && !ctl.out) {
      c.controller = ctl.seat;
      c.periodOwner = ctl.seat;
    }
    if (c.inGame().length <= 1) c.stop();
    // Nobody is connected yet: the abandonment timer runs from `at` (the constructor started it; restart it in case the seats changed).
    c.abandonLeftMs = null;
    c.updateAbandon([]);
    return c;
  }
}

/** A new table's clocks at the game's start. */
export function createTableClock(opts: TableClockOptions): TableClock {
  return new TableClock(opts);
}

/**
 * The clocks of a recovered table (design 2.3): banks, allowances, delays, periods and action counts from the last committed record, and the
 * wall-clock time used (`LogRecord.elapsedMs`); the outage between that record and `at` is charged to nobody (no clock ran, the cap does not count
 * it); every seat starts disconnected with a fresh reconnect window (5 minutes, not counted in its allowance, ending at its first reconnect); as
 * nobody is connected yet, the abandonment timer runs from `at`. Not stored: open proposals (the proposer proposes again) and the per-period
 * proposal and cancel counts (they start again; at most two recoveries per table).
 */
export function recoverTableClock(opts: RecoverOptions): TableClock {
  return TableClock.recover(opts);
}
