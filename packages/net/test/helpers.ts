/** Shared helpers for the game-level tests: the engine's offline card fixtures as a card database, decks, waiting. */
import { readFileSync } from 'node:fs';
import { CardDatabase } from '@openmtg/cards';
import type { OracleCard } from '@openmtg/engine';
import type { DeckSubmission } from '../src/protocol/messages';

let db: CardDatabase | undefined;

/** The engine's test fixture cards (Oracle fields of a named list of cards; no network). */
export function fixtureDb(): CardDatabase {
  if (!db) {
    const file = new URL('../../engine/test/fixtures/cards.json', import.meta.url);
    const data = JSON.parse(readFileSync(file, 'utf8')) as { cards: OracleCard[]; tokens?: OracleCard[] };
    db = CardDatabase.fromCards(data.cards, { tokens: data.tokens ?? [] });
  }
  return db;
}

export function deck(main: Record<string, number>, sideboard: Record<string, number> = {}): DeckSubmission {
  const list = (r: Record<string, number>) => Object.entries(r).map(([name, count]) => ({ name, count }));
  return { main: list(main), sideboard: list(sideboard) };
}

export async function until(cond: () => boolean, ms = 5000, what = 'condition'): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Link timings for tests on 127.0.0.1. */
export const FAST_LINK = { tickMs: 5, rtoInitial: 60, rtoMin: 20, rtoMax: 500, pingInterval: 100, idleTimeout: 3000 };
