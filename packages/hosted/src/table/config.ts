/**
 * The table's game configuration (design 2.4): the seed (128 random bits from the server; stored only in the `games` row, never sent), the players in
 * seating order (shuffled with the seed for 3-4 seats: M12 D2, CR 806.3), the decks the deck pool prepared, the Commander variant of the format (M11-3).
 * It mirrors net's `gameConfigFor` for N seats.
 *
 * Pods: the engine of this base plays exactly two players (`createGame` refuses more); `options.multiplayer` arrives with milestone 12 (M12-1). M13-16
 * adds it here; until then a 3-4 seat configuration is built (seating included) and the engine refuses it.
 */
import { createHash, randomBytes } from 'node:crypto';
import { commanderOptions, type CardDef, type GameConfig, type PlayerConfig, type StopSettings } from '@openmtg/engine';
import { commanderVariantOf, type PreparedDeck } from '@openmtg/net/server-kit';
import type { SeatNumber } from '../api';

/** One seat's player for the configuration: the display name and the prepared deck (`prepareDeck` in the deck pool). */
export interface TableSeatDeck {
  seat: SeatNumber;
  name: string;
  deck: PreparedDeck;
}

/** A new game seed: 128 random bits as hex (design 2.4). The only randomness of a table; never sent to anyone. */
export function newTableSeed(): string {
  return randomBytes(16).toString('hex');
}

/** A deterministic number in [0, n) from the seed and a label (sha256; for the seating shuffle only). */
function seeded(seed: string, label: string, n: number): number {
  const h = createHash('sha256').update(`${seed}|${label}`).digest();
  return h.readUInt32BE(0) % n;
}

/**
 * The seating order: `seating[i]` is the table seat of player `p{i+1}` (`StartRow.seating`). Two seats keep their order (seat 1 is p1); 3-4 seats are
 * shuffled with the seed (Fisher-Yates; M12 D2: random seating, CR 806.3). Turn order is seating order (the engine's player order, CR 101.4).
 */
export function seatingOrder(seats: readonly SeatNumber[], seed: string): SeatNumber[] {
  const out = [...seats].sort((a, b) => a - b);
  if (out.length <= 2) return out;
  for (let i = out.length - 1; i > 0; i--) {
    const j = seeded(seed, `seating|${i}`, i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function mergeDefs(lists: readonly CardDef[][]): CardDef[] {
  const byId = new Map<string, CardDef>();
  for (const list of lists) for (const d of list) if (!byId.has(d.id)) byId.set(d.id, d);
  return [...byId.values()];
}

export interface TableConfigOptions {
  /** Stops for every player (default: the engine's). */
  stops?: Partial<StopSettings>;
  /** Engine options on top of the format's (tests). */
  gameOptions?: GameConfig['options'];
}

/**
 * The game configuration of a hosted table and its seating (`seating[i]` is the table seat of `config.players[i]`, ids p1-pN). In a format with a command
 * zone the game is a Commander game of that variant (`commanderOptions`, CR 903) with each player's commanders in the command zone (CR 903.6); each
 * player's sideboard is outside the game (CR 400.11a) when it is not empty (FAST5 MX7), and a revealed companion is that player's (CR 702.139a).
 */
export function tableConfig(format: string, seats: readonly TableSeatDeck[], seed: string, o: TableConfigOptions = {}): { config: GameConfig; seating: SeatNumber[] } {
  if (seats.length < 2 || seats.length > 4) throw new Error(`tableConfig: 2-4 seats, not ${seats.length}`);
  if (new Set(seats.map((s) => s.seat)).size !== seats.length) throw new Error('tableConfig: a seat is given twice');
  const seating = seatingOrder(seats.map((s) => s.seat), seed);
  const variant = commanderVariantOf(format);
  const options = variant ? { commander: commanderOptions(variant), ...o.gameOptions } : o.gameOptions;
  const ordered = seating.map((n) => seats.find((s) => s.seat === n)!);
  const players: PlayerConfig[] = ordered.map((s, i) => ({
    id: `p${i + 1}`,
    name: s.name,
    deck: [...s.deck.main],
    ...(s.deck.sideboard.length > 0 ? { sideboard: [...s.deck.sideboard] } : {}),
    ...(variant ? { commanders: [...s.deck.commanders] } : {}),
    ...(s.deck.companion !== undefined ? { companion: s.deck.companion } : {}), // CMP1: the revealed companion (CR 702.139a), as net's host does
    ...(o.stops ? { stops: o.stops } : {}),
  }));
  const config: GameConfig = { seed, players, defs: mergeDefs(ordered.map((s) => s.deck.defs)), ...(options ? { options } : {}) };
  return { config, seating };
}
