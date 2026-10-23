/**
 * M12-5b (docs/design/m12-multiplayer.md 6): what the online screens read from a 3-4 player game's status (M12-5a: `seats`, `players`, `codes`, `seat`).
 * Pure helpers; a two-player game's status has none of these fields, and every helper says so (`isTable` false), so the two-player screens stay
 * milestone 9's.
 */
import type { PlayerId } from '@openmtg/engine';
import type { OnlinePlayerStatus, OnlineStatus } from '@openmtg/server/online';

/** A 3-4 player game (the status carries the table). */
export function isTable(s: OnlineStatus): boolean {
  return s.seats !== undefined || s.players !== undefined;
}

/** The players seated so far (the lobby: open seats have `taken: false`). */
export function seatedPlayers(s: OnlineStatus): OnlinePlayerStatus[] {
  return (s.players ?? []).filter((p) => p.taken !== false);
}

/** How many seats are still open (the lobby; 0 once every seat is taken and the game starts). */
export function openSeats(s: OnlineStatus): number {
  if (!s.seats) return 0;
  return Math.max(0, s.seats - seatedPlayers(s).length);
}

/** "Waiting for 2 more players…" (the lobby). */
export function waitingText(s: OnlineStatus): string {
  const n = openSeats(s);
  if (n === 0) return 'Every seat is taken: the game is starting…';
  return `Waiting for ${n} more ${n === 1 ? 'player' : 'players'} to join… The game starts when every seat is taken.`;
}

/** A player's name from the status (or `fallback` names, e.g. the view's players), "Seat n" for a seat nobody has taken yet. */
export function nameOf(s: OnlineStatus, id: PlayerId | undefined, fallback: readonly { id: PlayerId; name: string }[] = []): string {
  if (!id) return 'A player';
  const p = s.players?.find((x) => x.id === id);
  if (p && p.name) return p.name;
  const f = fallback.find((x) => x.id === id);
  if (f && f.name) return f.name;
  if (p?.seat !== undefined) return `Seat ${p.seat}`;
  return id;
}

/** A list of names in words: "Bob", "Bob and Carol", "Bob, Carol and Dan". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** A forfeit clock as m:ss (rounded up to the next second, never below 0:00). */
export function clockText(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}
