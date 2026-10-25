/**
 * A card cache for server API tests: the engine's fixture cards (Oracle fields only, no network) written as a local index (cards.jsonl, tokens.jsonl)
 * into a temporary directory, with test-only legalities, color identities and placeholder image URLs on a few cards (never real image URLs:
 * ARCHITECTURE.md "Card images", test fixtures never contain image URLs; `example.invalid` cannot resolve), and two made-up cards that share a face name.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OracleCard } from '@openmtg/engine';
import { ScryfallClient, type IndexedCard } from '@openmtg/cards';
import { isMeldResult } from '../src/cache';
import type { ServerContext } from '../src/context';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '..', '..', 'engine', 'test', 'fixtures', 'cards.json');

export const SHARED_FACE = 'Shared Echo';

const legal = (formats: Record<string, string>): Record<string, string> => ({ standard: 'not_legal', modern: 'legal', legacy: 'legal', vintage: 'legal', commander: 'legal', ...formats });

/** Placeholder image URLs: they test the pass-through of the index's `image_uris` and cannot be fetched. */
export const TEST_IMAGE = { normal: 'https://example.invalid/normal/test-bolt.jpg', large: 'https://example.invalid/large/test-bolt.jpg' };
/** The picture's artist, sent with its URLs. */
export const TEST_ARTIST = 'Test Artist';

/** Test-only extra data per card name (never in the committed fixture file). */
const EXTRA: Record<string, Partial<OracleCard> & { legalities?: Record<string, string> }> = {
  'Lightning Bolt': { legalities: legal({}), color_identity: ['R'], image_uris: TEST_IMAGE, artist: TEST_ARTIST },
  Counterspell: { legalities: legal({ modern: 'not_legal' }), color_identity: ['U'] },
  'Sol Ring': { legalities: legal({ modern: 'not_legal', legacy: 'banned', vintage: 'restricted' }), color_identity: [] },
  'Grizzly Bears': { legalities: legal({ standard: 'legal' }), color_identity: ['G'] },
  'Birds of Paradise': { legalities: legal({}), color_identity: ['G'] },
};

/** Two made-up split cards whose second half has the same name: that face name is ambiguous. */
function sharedFaceCards(): OracleCard[] {
  return ['Alpha', 'Beta'].map((front, i) => ({
    oracle_id: `00000000-0000-0000-0000-00000000000${i}`,
    name: `${front} Echo // ${SHARED_FACE}`,
    layout: 'split',
    cmc: 2,
    colors: ['U'],
    card_faces: [
      { name: `${front} Echo`, mana_cost: '{U}', type_line: 'Instant', oracle_text: 'Draw a card.', colors: ['U'] },
      { name: SHARED_FACE, mana_cost: '{U}', type_line: 'Instant', oracle_text: 'Draw a card.', colors: ['U'] },
    ],
  }));
}

/** The fixture's meld result: the back face of the Bruna and Gisela meld pair (CR 712.4b), which Scryfall lists as a card of its own. */
export const MELD_RESULT = 'Brisela, Voice of Nightmares';

export interface FixtureCache {
  dir: string;
  ctx: ServerContext;
  /** Every card written to the index (including the meld result, which is no deck card). */
  cards: OracleCard[];
  /** The deckable cards: `cards` without the meld results (what search lists and the classification index counts). */
  deckCards: OracleCard[];
  tokens: OracleCard[];
  cleanup(): void;
}

/** A Scryfall client whose every request fails (no network in tests). */
function offlineScryfall(): ScryfallClient {
  const fetch = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof globalThis.fetch;
  return new ScryfallClient({ fetch, clock: { now: () => 0, sleep: async () => undefined } });
}

export function makeFixtureCache(): FixtureCache {
  const dir = mkdtempSync(path.join(tmpdir(), 'openmtg-c1-'));
  const cacheDir = path.join(dir, 'scryfall');
  mkdirSync(cacheDir);
  const data = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { cards: OracleCard[]; tokens: OracleCard[] };
  const cards = [...data.cards.map((c) => ({ ...c, ...(EXTRA[c.name] ?? {}) }) as OracleCard), ...sharedFaceCards()];
  writeFileSync(path.join(cacheDir, 'cards.jsonl'), cards.map((c) => JSON.stringify(c)).join('\n') + '\n');
  writeFileSync(path.join(cacheDir, 'tokens.jsonl'), data.tokens.map((c) => JSON.stringify(c)).join('\n') + '\n');
  return {
    dir,
    // Offline unless a test injects a fake: a plain search asks for the set lists (sets.ts), which must never reach the real Scryfall.
    ctx: { cacheDir, compiledDir: path.join(dir, 'compiled'), version: 'test', scryfall: offlineScryfall() },
    cards,
    // every meld result (CR 712.4b): Brisela, and Chittering Host since the M6-0 fixture cards
    deckCards: cards.filter((c) => !isMeldResult(c as IndexedCard)),
    tokens: data.tokens,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** A request object for calling a handler directly. */
export const req = (opts: { query?: Record<string, string>; params?: Record<string, string>; body?: unknown } = {}) => ({
  query: opts.query ?? {},
  params: opts.params ?? {},
  body: opts.body,
});
