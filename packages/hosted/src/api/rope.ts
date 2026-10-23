/**
 * Reading a `ClockView` at a later instant (design 5.1, 3.4 `clock`): the server sends the clocks only when one starts or stops, and the browser counts
 * down itself. Browser-safe: types from `../api` only, no Node imports, so `@openmtg/hosted/api` may re-export it for the client (M13-11).
 *
 * The **rope** (Arena-like) is the visible countdown on the deciding player's prompt: shown once the free delay of the control period is spent (the bank
 * is running), urgent under 60 s of bank.
 *
 * M13-6 INTERFACE CHANGE (additive): this file lives in `src/api/` and `@openmtg/hosted/api` re-exports it (`clocksAt`, `seatClockAt`, `ropeFor`,
 * `ROPE_URGENT_MS`, `SeatClockAt`), so the client counts clocks down with the server's own arithmetic; `src/clock/rope.ts` re-exports it for the server.
 */
import type { ClockView, SeatClock, SeatNumber } from '../api';

/** The rope turns urgent under 60 s of bank (design 5.1). */
export const ROPE_URGENT_MS = 60_000;

/** A seat's clock at a given instant, with its rope. */
export interface SeatClockAt extends SeatClock {
  /** The rope is shown: the seat's clock runs and its delay is spent. */
  rope: boolean;
  /** The rope is urgent: shown, and under `ROPE_URGENT_MS` of bank. */
  urgent: boolean;
}

/** One seat's clock `now` (server time), counted down from the view's `at`; values stop at 0. */
export function seatClockAt(c: SeatClock, viewAt: number, now: number): SeatClockAt {
  const dt = Math.max(0, now - viewAt);
  let { delayMs, bankMs, dropMs } = c;
  if (c.running) {
    const fromDelay = Math.min(delayMs, dt);
    delayMs -= fromDelay;
    bankMs = Math.max(0, bankMs - (dt - fromDelay));
  }
  if (c.dropRunning) dropMs = Math.max(0, dropMs - dt);
  const rope = c.running && delayMs === 0;
  return { ...c, delayMs, bankMs, dropMs, rope, urgent: rope && bankMs < ROPE_URGENT_MS };
}

/** Every seat's clock and the abandonment time left `now`. */
export function clocksAt(view: ClockView, now: number): { at: number; seats: SeatClockAt[]; abandonMs?: number } {
  const seats = view.seats.map((c) => seatClockAt(c, view.at, now));
  const out: { at: number; seats: SeatClockAt[]; abandonMs?: number } = { at: Math.max(now, view.at), seats };
  if (view.abandonMs !== undefined) out.abandonMs = Math.max(0, view.abandonMs - Math.max(0, now - view.at));
  return out;
}

/** The rope of one seat `now`: null when it is not shown. */
export function ropeFor(view: ClockView, seat: SeatNumber, now: number): { bankMs: number; urgent: boolean } | null {
  const c = view.seats.find((s) => s.seat === seat);
  if (!c) return null;
  const at = seatClockAt(c, view.at, now);
  return at.rope ? { bankMs: at.bankMs, urgent: at.urgent } : null;
}
