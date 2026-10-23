/**
 * The cards a coverage run measures: the whole local Oracle index (git-ignored Scryfall data, `.cache/scryfall/cards.jsonl`) or the committed fixture
 * set (`packages/engine/test/fixtures/cards.json`, the cards the tests use; design 15.2 WP25: "the harness tests itself on the fixture set").
 * Cards are returned in `oracle_id` order (then name). The retention split of design 6.12 (`halvesOf`) hashes each card's key and does not depend on the order.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { halfOfKey, type Half as EngineHalf, type OracleCard } from '@openmtg/engine';
import { CardDatabase } from '../database';
import { legalityIn } from '../legalities';
import { defaultFixturesDir } from '../paths';

export type CorpusSource = 'index' | 'fixtures';

export interface CorpusOptions {
  source: CorpusSource;
  /** Keep every n-th card (1 = all), in oracle_id order: a deterministic sample. */
  every?: number;
  /** At most this many cards (after `every`). */
  limit?: number;
  /** Only cards whose name contains this text (case-insensitive). */
  match?: string;
  /** Only cards legal (or restricted) in this format by the index's Scryfall legalities, e.g. 'standard'. */
  format?: string;
}

export interface Corpus {
  source: CorpusSource;
  cards: OracleCard[];
  /** Cards in the source before sampling. */
  total: number;
  /** The half of every card of the WHOLE source (design 6.12), so a sample keeps each card's own half. */
  halves: Halves;
  /** True when `cards` is a sample (every, limit, match or format) of the source. */
  sampled: boolean;
}

/** Design 6.12: the tuning half (even hash of the card key) and the held-out half (odd hash); engine parser/metrics.ts#halfOfKey. */
export type Half = EngineHalf;
/** Card key (`oracle_id`, else `name:<name>`, as snapshot.ts#cardKey) -> its half in the whole source. */
export type Halves = ReadonlyMap<string, Half>;

export const oracleKey = (c: Pick<OracleCard, 'oracle_id' | 'name'>): string => c.oracle_id ?? `name:${c.name}`;

export const byOracleId = (a: OracleCard, b: OracleCard): number => {
  const x = a.oracle_id ?? a.name;
  const y = b.oracle_id ?? b.name;
  return x < y ? -1 : x > y ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
};

/**
 * The halves of design 6.12 over a whole source: each card's half is `halfOfKey` of its key (parser/metrics.ts, the split of #splitHalves), a property of
 * the card and not of its position, so a Scryfall refresh that adds cards moves no card between the halves. Carried into every sample so a sample keeps
 * each card's own half and is never split again into a false "held-out" half (no `--every n` sample is one half any more: the halves are by hash, not position).
 */
export function halvesOf(all: readonly OracleCard[]): Map<string, Half> {
  return new Map(all.map((c) => [oracleKey(c), halfOfKey(oracleKey(c))]));
}

/** The tuning half of `items` (by their card key); `halves` defaults to the halves of `items` themselves (they are then the whole source). */
export function tuningHalf<T extends { card: OracleCard }>(items: readonly T[], halves: Halves = halvesOf(items.map((i) => i.card))): T[] {
  return items.filter((i) => halves.get(oracleKey(i.card)) === 'tuning');
}

/** The fixture cards (synchronous: a committed JSON file). */
export function fixtureCards(dir: string = defaultFixturesDir()): OracleCard[] {
  const data = JSON.parse(readFileSync(path.join(dir, 'cards.json'), 'utf8')) as { cards: OracleCard[] };
  return [...data.cards].sort(byOracleId);
}

export function sampleCards(all: readonly OracleCard[], opts: Omit<CorpusOptions, 'source'>): OracleCard[] {
  const every = Math.max(1, Math.floor(opts.every ?? 1));
  const needle = opts.match?.toLowerCase();
  const format = opts.format?.trim().toLowerCase();
  const inFormat = (c: OracleCard): boolean => { const l = legalityIn(c, format!); return l === 'legal' || l === 'restricted'; };
  let cards = [...all].sort(byOracleId).filter((c) => (!needle || c.name.toLowerCase().includes(needle)) && (!format || inFormat(c)));
  if (every > 1) cards = cards.filter((_, i) => i % every === 0);
  if (opts.limit !== undefined) cards = cards.slice(0, Math.max(0, opts.limit));
  return cards;
}

export async function loadCorpus(opts: CorpusOptions, log?: (m: string) => void): Promise<Corpus> {
  const all = opts.source === 'fixtures' ? fixtureCards() : [...(await CardDatabase.open(log ? { log } : {})).cards()];
  const cards = sampleCards(all, opts);
  return { source: opts.source, cards, total: all.length, halves: halvesOf(all), sampled: cards.length !== all.length };
}
