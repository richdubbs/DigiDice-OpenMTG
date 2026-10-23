/**
 * Scryfall's per-format legality data, kept in the local card index for format validation (docs/design/decks-and-formats.md, milestone 7). Informational
 * data from the last refresh: the engine never reads it, and test fixtures never contain it.
 *
 * `unsanctioned` and legalities answer different questions. `unsanctioned` (CR 100.7) is about rules automation: the card is manual-only. Legalities are
 * about format play, and Scryfall's data is the authority there: format validation (M7) must read `legalityIn`, never infer legality from the flag. They
 * disagree for 16 acorn-stamped Mystery Booster cards (Case of the Lost Witness, Emerald Collector, ...), which Scryfall lists as legal in Arena formats
 * (historic, timeless, brawl, gladiator); such a card is legal there and still resolved by hand. With no legalities (a token, or a card cached before
 * WP24) the validator must report "no data", never "not legal".
 */
import type { OracleCard } from '@openmtg/engine';

/** Scryfall's legality values (format -> one of these). */
export type Legality = 'legal' | 'not_legal' | 'banned' | 'restricted';
export const LEGALITIES: readonly Legality[] = ['legal', 'not_legal', 'banned', 'restricted'];

/** Format name as Scryfall spells it ("standard", "modern", "commander", "duel", "premodern", ...) -> legality. */
export type Legalities = Readonly<Record<string, Legality>>;

/** A card of the local index: the engine's OracleCard plus the data only the card tool uses. */
export interface IndexedCard extends OracleCard {
  /** Scryfall's `legalities`, verbatim (only known values are kept). Absent on tokens and on cards cached before WP24. */
  legalities?: Legalities;
  /**
   * Set by buildIndexData on a card the rules do not cover (CR 100.7) whose name another card of the index also has (the six Unstable variants of Garbage
   * Elemental, a playtest card named like a tournament card): the card is indexed as "Name (SET number)" and its printed name is kept here, so the bare name
   * resolves to the tournament card, or is reported as ambiguous among the variants, never silently to one of them.
   */
  variant_of?: string;
}

const isLegality = (v: unknown): v is Legality => typeof v === 'string' && (LEGALITIES as readonly string[]).includes(v);

/** Scryfall `legalities` object -> Legalities: keeps string keys with a known value, in Scryfall's order; undefined when nothing is left. */
export function trimLegalities(v: unknown): Legalities | undefined {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, Legality> = {};
  for (const [format, value] of Object.entries(v as Record<string, unknown>)) if (format !== '' && isLegality(value)) out[format] = value;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The legalities of a card from the index (undefined for a token or a card cached before legalities were kept). */
export function legalitiesOf(card: OracleCard | undefined): Legalities | undefined {
  return card ? trimLegalities((card as IndexedCard).legalities) : undefined;
}

/** The legality of a card in one format (Scryfall's format name, case-insensitive), or undefined when the index has no data for it. */
export function legalityIn(card: OracleCard | undefined, format: string): Legality | undefined {
  return legalitiesOf(card)?.[format.trim().toLowerCase()];
}

/**
 * Is this a card the rules do not cover (CR 100.7: silver border, acorn stamp, playtest card), to be compiled manual-only (design 12.3)? The flag is set by
 * trimCard. Cards cached before WP24 (a one-off name lookup in lookups.json, which is never re-trimmed) have no flag: a silver border still says so, and a
 * `funny`-set card without legalities (pre-WP24 data, every card trimmed since has them) may be an acorn card, so it counts as unsanctioned too (never
 * silently wrong; a black-bordered Un-card legal in some format gets its automation back on its next fetch or index rebuild).
 */
export function isUnsanctioned(card: OracleCard | undefined): boolean {
  if (!card) return false;
  if (card.unsanctioned === true || card.border_color === 'silver') return true;
  return card.set_type === 'funny' && (card as IndexedCard).legalities === undefined;
}
