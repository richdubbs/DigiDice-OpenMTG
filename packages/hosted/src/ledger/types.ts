/**
 * The results ledger's contract (design section 7, D13; review 7, 11). Server only: the database and milestone 15 read `Placement` and `GameRecord`;
 * players receive only `PublicPlacement` (api.ts) through `publicPlacements`.
 *
 * Written by the table (M13-7 owns the rest of ledger/*) at the end of every started game, in one transaction with the final log record and the game's
 * status. Append-only; `ranked` is false for every game of milestone 13.
 */
import { createHmac } from 'node:crypto';
import type { CommanderVariant, PlayerId } from '@openmtg/engine';
import { PUBLIC_PLACEMENT_KEYS, type GameOutcome, type LossCode, type PublicPlacement, type SeatNumber, type TableSize, type TableSource } from '../api';

export type { LossCode, PublicPlacement } from '../api';
export { LOSS_CODES, PUBLIC_PLACEMENT_KEYS } from '../api';

/** Server only (the database and milestone 15). `PublicPlacement` is exactly its public part (pinned by test/m13-1/ledger.test.ts). */
export interface Placement extends PublicPlacement {
  /** p1-p4, the seat's player. */
  player: PlayerId;
  /** The guest session id (a random id, never the token). */
  session: string;
  /** Milestone 14 (accounts); null in milestone 13. */
  account: string | null;
  /** `deckFingerprint`: HMAC-SHA256(LEDGER_SECRET, the normalized decklist), a fingerprint nobody can test a guessed list against (review 7). */
  deckHash: string;
  /** 1 = first out; players out at the same time share one order (M12's `PlayerState.left.order`, one per set of simultaneous losers). */
  outOrder: number | null;
  timeUsedMs: number;
  /** 0 or 1. */
  timeouts: number;
  disconnectedMs: number;
}

export interface GameRecord {
  /** The game id (a ULID). */
  game: string;
  format: string;
  variant: CommanderVariant | null;
  seats: TableSize;
  source: TableSource;
  /** Milestone 15 sets true for ranked-queue games. */
  ranked: false;
  outcome: GameOutcome;
  /** The engine's `GameResult.reason`, or the void reason ('abandoned', 'limit', 'recovery', 'commit', 'quarantined', 'updated'). */
  reason: string;
  turns: number;
  actions: number;
  startedAt: string;
  endedAt: string;
  engineBuild: string;
  /** In seat order; empty for a void game (never rated). */
  placements: Placement[];
  /**
   * M13-7 INTERFACE CHANGE (additive, optional): every seat's logged actions at the end (the last record's `ClockReading.actions`: answered decisions
   * and accepted cancels), in seat order, void games included. Milestone 15's open item (design 5.5): who drove a game to a per-game cap.
   */
  seatActions?: SeatActions[];
}

/** One seat's logged actions at the end of a game (`GameRecord.seatActions`). */
export interface SeatActions {
  seat: SeatNumber;
  actions: number;
}

/** Why a game was void (design 2.2, 2.3, 4.4, D5): its `GameRecord.reason`. */
export const VOID_REASONS = ['abandoned', 'limit', 'recovery', 'commit', 'quarantined', 'updated'] as const;
export type VoidReason = (typeof VOID_REASONS)[number];

/** The public part of a placement (design 7, review 7): a new object with exactly `PUBLIC_PLACEMENT_KEYS`, nothing else copied. */
export function publicPlacement(p: PublicPlacement): PublicPlacement {
  return { seat: p.seat, name: p.name, place: p.place, loss: p.loss, lossRule: p.lossRule, outTurn: p.outTurn };
}

/** What `result` carries: the public placements, best place first (ties in seat order). */
export function publicPlacements(ps: readonly PublicPlacement[]): PublicPlacement[] {
  return ps.map(publicPlacement).sort((a, b) => a.place - b.place || a.seat - b.seat);
}

// Keep publicPlacement and PUBLIC_PLACEMENT_KEYS in step (a compile-time check).
const _keysCovered: readonly (keyof PublicPlacement)[] = PUBLIC_PLACEMENT_KEYS;
void _keysCovered;

/**
 * Places with ties (review 11; the rule of M12's `placements(s)`): `ranks[i]` orders player i (lower is better: the winner 0, then the players who
 * stayed in until the end, then the players who left, the last set to leave first); equal ranks share a place, and a place counts the players strictly
 * ahead: ranks [0, 1, 2, 2] give places [1, 2, 3, 3]; two players out together first of four, [0, 1, 3, 3] give [1, 2, 3, 3].
 */
export function sharedPlaces(ranks: readonly number[]): number[] {
  return ranks.map((r) => 1 + ranks.filter((x) => x < r).length);
}

/** A placement's place as the ledger's type (1-4); throws for a table of more than 4. */
export function asPlace(n: number): SeatNumber {
  if (n !== 1 && n !== 2 && n !== 3 && n !== 4) throw new Error(`asPlace: ${n} is not a place of a table of at most 4.`);
  return n;
}

/** The resolved deck a fingerprint is taken of: Oracle names, one entry per card (net's `PreparedDeck` fields). */
export interface FingerprintDeck {
  main: readonly string[];
  sideboard: readonly string[];
  commanders: readonly string[];
  /** The revealed companion (CMP1, CR 702.139a; `PreparedDeck.companion`), absent without one. */
  companion?: string;
}

/**
 * The normalized decklist (design 7): one line per section and card, `section<TAB>count<TAB>name`, sections in the order commander, companion, main,
 * sideboard (a deck without a companion has no companion line, so its text is as before CMP1), names
 * in code-unit order, joined by "\n". The same cards give the same text whatever their order or how the player spelled them (the names are the resolved
 * Oracle names).
 */
export function normalizedDecklist(deck: FingerprintDeck): string {
  const lines: string[] = [];
  const section = (name: string, cards: readonly string[]) => {
    const counts = new Map<string, number>();
    for (const c of cards) counts.set(c, (counts.get(c) ?? 0) + 1);
    for (const n of [...counts.keys()].sort()) lines.push(`${name}\t${counts.get(n)}\t${n}`);
  };
  section('commander', deck.commanders);
  section('companion', deck.companion !== undefined ? [deck.companion] : []);
  section('main', deck.main);
  section('sideboard', deck.sideboard);
  return lines.join('\n');
}

/** LEDGER_SECRET's least length (config.ts checks it at start). */
export const LEDGER_SECRET_MIN = 32;

/** The deck fingerprint: HMAC-SHA256(secret, normalizedDecklist(deck)) in lowercase hex. Throws for a secret shorter than 32 characters. */
export function deckFingerprint(secret: string, deck: FingerprintDeck): string {
  if (secret.length < LEDGER_SECRET_MIN) throw new Error(`deckFingerprint: the ledger secret must have at least ${LEDGER_SECRET_MIN} characters.`);
  return createHmac('sha256', secret).update(normalizedDecklist(deck), 'utf8').digest('hex');
}
