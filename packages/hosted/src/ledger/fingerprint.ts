/**
 * Deck fingerprints for the ledger (design 7, review 7; package M13-7): `deckFingerprint` (types.ts: HMAC-SHA256 of the normalized decklist under
 * LEDGER_SECRET) of the deck as the server prepared it (net's `PreparedDeck`: resolved Oracle names, so the player's spelling and order do not matter).
 * The decklist itself stays private (`SeatRow.deck`); only the fingerprint goes into a placement, and never to a player.
 */
import { randomBytes } from 'node:crypto';
import type { PreparedDeck } from '@openmtg/net/server-kit';
import { deckFingerprint } from './types';

/** The fingerprint of a prepared deck (`SeatRow.deckHash`, `Placement.deckHash`): 64 lowercase hex digits. */
export function preparedDeckHash(secret: string, deck: Pick<PreparedDeck, 'main' | 'sideboard' | 'commanders' | 'companion'>): string {
  return deckFingerprint(secret, { main: deck.main, sideboard: deck.sideboard, commanders: deck.commanders, ...(deck.companion !== undefined ? { companion: deck.companion } : {}) });
}

/**
 * The ledger secret a server runs with: `LEDGER_SECRET` when set (config.ts checks it: 64 hex digits; required with the Postgres store), else a
 * random one for this process (`ephemeral`: fingerprints compare only within one run, which is all a memory store keeps; with the file store the
 * operator sets LEDGER_SECRET to keep them comparable across restarts).
 */
export function ledgerSecret(configured: string | null, random: (n: number) => Uint8Array = randomBytes): { secret: string; ephemeral: boolean } {
  if (configured !== null) return { secret: configured, ephemeral: false };
  return { secret: Buffer.from(random(32)).toString('hex'), ephemeral: true };
}
