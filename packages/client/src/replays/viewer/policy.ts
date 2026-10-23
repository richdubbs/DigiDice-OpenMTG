/**
 * RPL-2 (replays design 6, D4, 16.1-16.2): whose view a replay may show. CR 400.2: hidden information is revealed only in a player's own replays, or when
 * every person who played agreed (`ReplayFile.reveal`). A game replay can show
 *  - a seat: `viewFor(state, seat)`, with the events redacted for that seat;
 *  - the public view: `viewFor(state, null)`, what a spectator at the table sees;
 *  - the open view: `openView(state)`, every hand, library and face-down card, and every log line's private text.
 *
 * | Game                               | Opens on          | Without agreement also          | With every person's agreement |
 * |------------------------------------|-------------------|---------------------------------|-------------------------------|
 * | Against the computer (one person)  | that person's seat| the public view, the open view  | every seat                    |
 * | Hot-seat (2-4 people at one screen)| the public view   | nothing else                    | every seat, the open view     |
 * | Online host                        | the host's seat   | the public view                 | every seat, the open view     |
 * | Online guest, hosted               | own seat          | nothing else                    | every seat, the open view     |
 *
 * A computer's hand is nobody's secret (16.1), so computer seats need no agreement and a game against the computer counts its one person alone. A
 * recording shows only the player who recorded it. The replay connection enforces this list (`setPerspective` refuses anything else), so a perspective
 * is never only hidden in the interface.
 */
import type { PlayerId } from '@openmtg/engine';
import type { ReplayFile, ReplayPlayer } from '@openmtg/engine';

export type ReplayPerspective = { kind: 'seat'; player: PlayerId } | { kind: 'public' } | { kind: 'open' };

export const PUBLIC: ReplayPerspective = Object.freeze({ kind: 'public' });
export const OPEN: ReplayPerspective = Object.freeze({ kind: 'open' });
export const seat = (player: PlayerId): ReplayPerspective => ({ kind: 'seat', player });

export function samePerspective(a: ReplayPerspective, b: ReplayPerspective): boolean {
  return a.kind === b.kind && (a.kind !== 'seat' || (b.kind === 'seat' && a.player === b.player));
}

/** A perspective as a short key ("seat:p1", "public", "open"), for a select's values. */
export function perspectiveKey(p: ReplayPerspective): string {
  return p.kind === 'seat' ? `seat:${p.player}` : p.kind;
}

/** The viewer `viewFor` and the event redaction get: the seat's player, or null for the public and the open view. */
export function perspectiveViewer(p: ReplayPerspective): PlayerId | null {
  return p.kind === 'seat' ? p.player : null;
}

/** "Alice", "Public", "All cards" (design 9). */
export function perspectiveLabel(p: ReplayPerspective, players: readonly Pick<ReplayPlayer, 'id' | 'name'>[]): string {
  if (p.kind === 'public') return 'Public';
  if (p.kind === 'open') return 'All cards';
  return players.find((x) => x.id === p.player)?.name ?? p.player;
}

/** Every person of the game agreed to show their cards (`reveal.agreed`); computer seats need no agreement (16.1). */
export function everyoneAgreed(replay: Pick<ReplayFile, 'game' | 'reveal'>): boolean {
  if (replay.reveal.policy !== 'all') return false;
  const persons = replay.game.players.filter((p) => p.kind === 'person');
  return persons.length > 0 && persons.every((p) => replay.reveal.agreed.includes(p.id));
}

/** The one person of a game against the computer, or null when the game had another number of people. */
function lonePerson(replay: Pick<ReplayFile, 'game'>): PlayerId | null {
  if (replay.game.mode !== 'computer') return null;
  const persons = replay.game.players.filter((p) => p.kind === 'person');
  return persons.length === 1 ? persons[0]!.id : null;
}

/** The saver's own seat, when it is a seat of the game. */
function ownSeat(replay: Pick<ReplayFile, 'game'>): PlayerId | null {
  const by = replay.game.savedBy;
  return by !== null && replay.game.players.some((p) => p.id === by) ? by : null;
}

/** In picker order: the seats in seating order (CR 101.4), then the public view, then the open view. */
function ordered(replay: Pick<ReplayFile, 'game'>, list: readonly ReplayPerspective[]): ReplayPerspective[] {
  const rank = (p: ReplayPerspective) => (p.kind === 'seat' ? replay.game.players.findIndex((x) => x.id === p.player) : p.kind === 'public' ? 100 : 101);
  const out: ReplayPerspective[] = [];
  for (const p of list) if (!out.some((q) => samePerspective(p, q))) out.push(p);
  return out.sort((a, b) => rank(a) - rank(b));
}

/**
 * The perspectives a game replay may show (the table above), in picker order. Never empty: a file that names no seat for its saver keeps at least the
 * public view, which shows nothing private.
 */
export function allowedPerspectives(replay: Pick<ReplayFile, 'game' | 'reveal'>): ReplayPerspective[] {
  const list: ReplayPerspective[] = [];
  const person = lonePerson(replay);
  const own = ownSeat(replay);
  switch (replay.game.mode) {
    case 'computer':
      if (person !== null) list.push(seat(person), PUBLIC, OPEN);
      else list.push(PUBLIC); // a game with several people at the screen and computer seats: as hot-seat
      break;
    case 'hotseat':
      list.push(PUBLIC);
      break;
    case 'onlineHost':
      if (own !== null) list.push(seat(own));
      list.push(PUBLIC);
      break;
    case 'onlineGuest':
    case 'hosted':
      if (own !== null) list.push(seat(own));
      break;
  }
  if (everyoneAgreed(replay)) {
    for (const p of replay.game.players) list.push(seat(p.id));
    list.push(PUBLIC, OPEN);
  }
  if (list.length === 0) list.push(PUBLIC);
  return ordered(replay, list);
}

/** The perspective a game replay opens on (the table's first column), always one of `allowedPerspectives`. */
export function defaultPerspective(replay: Pick<ReplayFile, 'game' | 'reveal'>): ReplayPerspective {
  const allowed = allowedPerspectives(replay);
  const person = lonePerson(replay);
  const own = ownSeat(replay);
  let want: ReplayPerspective;
  if (replay.game.mode === 'computer') want = person !== null ? seat(person) : PUBLIC;
  else if (replay.game.mode === 'hotseat') want = PUBLIC;
  else want = own !== null ? seat(own) : PUBLIC;
  return allowed.find((p) => samePerspective(p, want)) ?? allowed[0]!;
}

/** The perspective of a recording: the player who recorded it, or the public view. */
export function recordingPerspective(viewer: PlayerId | null): ReplayPerspective {
  return viewer === null ? PUBLIC : seat(viewer);
}
