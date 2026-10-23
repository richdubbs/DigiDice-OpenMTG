/**
 * Reading the hosted game's clocks (hosted design 5.1, 3.4 `clock`). The server sends the clocks only when one starts or stops, never every second; the
 * page counts down itself from the moment the message arrived (HostedLink rewrites `ClockView.at` to the page's own clock then, so nothing here depends
 * on the server's time of day).
 *
 * This is the same arithmetic as the server's `clock/rope.ts` (`seatClockAt`), which `@openmtg/hosted/api` does not export yet: test/m13/clocks.test.ts
 * pins the two against each other, so a change on either side fails there.
 *
 * - A running seat spends its free delay first (the delay of its control period), then its bank. Values stop at 0.
 * - A seat whose drop clock runs (it is away and somebody in the game is connected) spends its away time instead (design 5.3).
 * - The rope is shown when the seat's clock runs and its delay is spent; it turns urgent under a minute of bank.
 */
import type { ClockView, SeatClock, SeatNumber } from '@openmtg/hosted/api';

/** The rope turns urgent under 60 s of bank (design 5.1). */
export const ROPE_URGENT_MS = 60_000;

export interface SeatClockAt extends SeatClock {
  /** The rope is shown: the seat's clock runs and its free delay is spent. */
  rope: boolean;
  /** The rope is urgent: shown, and under `ROPE_URGENT_MS` of bank. */
  urgent: boolean;
}

/** One seat's clock at the page's time `now`, counted down from the clock's `at`. */
export function seatClockAt(c: SeatClock, at: number, now: number): SeatClockAt {
  const dt = Math.max(0, now - at);
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

export interface ClocksAt {
  seats: SeatClockAt[];
  /** While nobody still in the game is connected: the time left before the game ends without a result. */
  abandonMs?: number;
}

/** Every seat's clock, and the abandonment time left, at the page's time `now`. */
export function clocksAt(view: ClockView, now: number): ClocksAt {
  const out: ClocksAt = { seats: view.seats.map((c) => seatClockAt(c, view.at, now)) };
  if (view.abandonMs !== undefined) out.abandonMs = Math.max(0, view.abandonMs - Math.max(0, now - view.at));
  return out;
}

/** A seat's clock by its seat number. */
export function clockOfSeat(c: ClocksAt | null, seat: SeatNumber | null): SeatClockAt | null {
  if (!c || seat === null) return null;
  return c.seats.find((s) => s.seat === seat) ?? null;
}

/** A time as m:ss (h:mm:ss from an hour), rounded up to the next second and never below 0:00: "14:32". */
export function clockText(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => (n < 10 ? `0${n}` : String(n));
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** Whether any clock is moving, so the page needs a timer to redraw it (the drop clocks and the abandonment timer count too). */
export function clocksMoving(view: ClockView | null): boolean {
  return view !== null && (view.abandonMs !== undefined || view.seats.some((s) => s.running || s.dropRunning));
}
