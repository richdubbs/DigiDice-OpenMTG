/**
 * Words for the lobby, quick match and the capacity queue (hosted design 4.2, 4.5, 4.6): times, clocks and formats in plain sentences. Pure.
 */
import type { ClockSettings, HostedFormatId, QueueSize } from '@openmtg/hosted/api';
import { formatOption } from '../../decks/formats';

/** A start never waits longer than this for room on a busy server (design 4.6: `CAPACITY_WAIT_MAX_MINUTES`, 20 by default); the estimate shown is capped at it. */
export const CAPACITY_ESTIMATE_CAP_MS = 20 * 60_000;

/** "less than a minute", "about a minute", "about 3 minutes", "about 2 hours". */
export function waitPhrase(ms: number): string {
  if (ms < 45_000) return 'less than a minute';
  const minutes = Math.round(ms / 60_000);
  if (minutes <= 1) return 'about a minute';
  if (minutes < 90) return `about ${minutes} minutes`;
  const hours = Math.round(ms / 3_600_000);
  return hours <= 1 ? 'about an hour' : `about ${hours} hours`;
}

/**
 * The wait for room on a busy server: "about 3 minutes", and past the cap "20 minutes at the most" (a start that waits that long is sent back to try again
 * later). Null when the server has no estimate.
 */
export function capacityWait(ms: number | null): string | null {
  if (ms === null) return null;
  return ms > CAPACITY_ESTIMATE_CAP_MS ? '20 minutes at the most' : waitPhrase(ms);
}

/** "M:SS" for a time waited. */
export function elapsedText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? `0${s}` : s}`;
}

function span(ms: number): string {
  if (ms % 60_000 === 0) return `${ms / 60_000} min`;
  return `${Math.round(ms / 1000)} s`;
}

/** A table's clocks on one line: "15 min each, 5 s free per decision". */
export function clockShort(c: ClockSettings): string {
  return `${span(c.bankMs)} each, ${span(c.delayMs)} free per decision`;
}

/** How long ago a table was made, on this page's clock: "just now", "3 min ago", "2 h ago". */
export function ageText(createdAt: number, now: number): string {
  const s = Math.max(0, Math.floor((now - createdAt) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)} h ago`;
}

/** A format's name as the deck library shows it ("Standard", "Duel Commander"). */
export function formatName(id: string): string {
  return formatOption(id).name;
}

/** "Standard", "Casual", ...: the name without a parenthesis ("Casual (no restrictions)" is "Casual" in a sentence). */
export function formatShort(id: string): string {
  return formatName(id).replace(/\s*\(.*\)\s*$/, '');
}

/** The kind of game a quick match looks for: "Standard, two players", "Commander, a pod of 3 or 4". */
export function queueText(format: HostedFormatId | string, size: QueueSize): string {
  return `${formatShort(format)}, ${size === 2 ? 'two players' : 'a pod of 3 or 4'}`;
}

/** "1 of 2 seats taken". */
export function seatsText(filled: number, seats: number): string {
  return `${filled} of ${seats} seats taken`;
}
