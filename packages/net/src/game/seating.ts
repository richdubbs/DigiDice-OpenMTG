/**
 * M12-5a (m12 design 6, D2): seats and seating of an online 3-4 player game.
 *
 * - **Seats** are the join codes' places: the host is seat 1 (player p1), each guest seat 2-4 has its own code and its player is `p<seat>` (one code per
 *   seat, owner; so a code holder can reach only its own seat, wire/crypto.ts).
 * - **Seating** is the turn order around the table (CR 806.3: "the players are randomly seated"): the host shuffles the players with the
 *   game's seed when the game is created (the engine then rotates the order to the starting player, CR 103.1). The same Fisher-Yates over FNV-1a hashes
 *   as the client's hot-seat games (packages/client game/config.ts, M12-4b), so a seed seats a table the same way everywhere; the config in the log
 *   replays it.
 */
import type { PlayerId } from '@openmtg/engine';

/** The player of a seat (1: the host). */
export const playerOfSeat = (seat: number): PlayerId => `p${seat}`;

/** The seat of a player id (`p<seat>`), or null. */
export function seatOfPlayer(player: PlayerId): number | null {
  const m = /^p([1-4])$/.exec(player);
  return m ? Number(m[1]) : null;
}

/** FNV-1a of a text (the seed's hash). */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** The players in a seating order shuffled from the seed (Fisher-Yates, one hash per swap): the same seed always seats them the same way. Pure. */
export function seatAtRandom<T>(players: readonly T[], seed: string): T[] {
  const out = [...players];
  for (let i = out.length - 1; i > 0; i--) {
    const j = hash(`${seed}:seating:${i}`) % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
