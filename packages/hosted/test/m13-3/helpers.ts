/** Test helpers for the clocks (fake time only: every instant is an explicit number of milliseconds). */
import type { SeatNumber } from '@openmtg/hosted';
import type { ClockOutcome, ClockStep, TableClock } from '../../src/clock';

export const SEC = 1_000;
export const MIN = 60_000;
export const HOUR = 3_600_000;

export const seat = (n: number): SeatNumber => n as SeatNumber;

/** The outcomes without the informational ones (`ignored`), as compact strings: "timeout:2@1000". */
export function brief(outcomes: ClockOutcome[]): string[] {
  return outcomes.flatMap((o) => {
    switch (o.kind) {
      case 'timeout':
      case 'forfeit':
        return [`${o.kind}:${o.seat}@${o.at}`];
      case 'void':
        return [`void:${o.reason}@${o.at}`];
      case 'limitWarning':
        return [`limitWarning@${o.at}`];
      case 'abandoning':
        return [`abandoning@${o.at}->${o.untilAt}`];
      case 'proposalOpened':
        return [`opened:${o.id}:${o.seat}>${o.approvers.join(',')}`];
      case 'proposalRefused':
        return [`refused:${o.seat}:${o.reason}`];
      case 'proposalClosed':
        return [`closed:${o.id}:${o.outcome}`];
      case 'cancelRefused':
        return [`cancelRefused:${o.seat}`];
      case 'ignored':
        return [];
    }
  });
}

/** Ticks the clock at `at` and returns the brief outcomes. */
export function tick(c: TableClock, at: number): string[] {
  return brief(c.handle({ type: 'tick', at }).outcomes);
}

/** Everything the clock reports while time runs from its time to `until`, waking at each deadline as the timer wheel would. */
export function runTo(c: TableClock, until: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < 1_000; i++) {
    const d = c.nextDeadline();
    if (d === null || d > until) break;
    out.push(...tick(c, d));
  }
  out.push(...tick(c, until));
  return out;
}

export function bank(c: TableClock, s: number, at?: number): number {
  return c.view(at).seats[s - 1]!.bankMs;
}
export function delay(c: TableClock, s: number, at?: number): number {
  return c.view(at).seats[s - 1]!.delayMs;
}
export function drop(c: TableClock, s: number, at?: number): number {
  return c.view(at).seats[s - 1]!.dropMs;
}
export function running(c: TableClock, at?: number): number[] {
  return c.view(at).seats.filter((x) => x.running).map((x) => x.seat);
}
export function dropRunning(c: TableClock, at?: number): number[] {
  return c.view(at).seats.filter((x) => x.dropRunning).map((x) => x.seat);
}
export const outs = (step: ClockStep): string[] => brief(step.outcomes);
