/**
 * The deckbuilder's search filters and the API query they make (docs/design/decks-and-formats.md "Deckbuilder": name, rules text, type, subtype, color,
 * color identity, mana value, power/toughness, keywords, "legal in <format>" and automation level). Pure.
 */
import type { AutomationLevel } from '@openmtg/engine';
import type { DeckSearchQuery } from './context';
import type { FormatOption } from './formats';
import { looksLikeScryfall } from './scryfallBuilder';

export const COLOR_FILTERS: readonly { letter: string; name: string }[] = [
  { letter: 'W', name: 'White' },
  { letter: 'U', name: 'Blue' },
  { letter: 'B', name: 'Black' },
  { letter: 'R', name: 'Red' },
  { letter: 'G', name: 'Green' },
  { letter: 'C', name: 'Colorless' },
];

export interface SearchFilters {
  /** The main search box: names and rules text, or Scryfall syntax when it uses a keyword (looksLikeScryfall). */
  q: string;
  colors: string;
  /** Color identity letters (CR 903.4); null = follow the commander's identity in a commander format. */
  identity: string | null;
  types: string;
  mv: string;
  pow: string;
  tou: string;
  keywords: string;
  legalOnly: boolean;
  automation: '' | AutomationLevel;
  /** Advanced search: a query in Scryfall's syntax (the server's scry parameter; scryfallBuilder.ts writes it from a form). */
  scry: string;
}

export const EMPTY_FILTERS: SearchFilters = { q: '', colors: '', identity: null, types: '', mv: '', pow: '', tou: '', keywords: '', legalOnly: true, automation: '', scry: '' };

/** Letters in WUBRGC order, each once. */
export const orderedLetters = (letters: string): string => COLOR_FILTERS.map((c) => c.letter).filter((l) => letters.includes(l)).join('');

/** Toggle one letter in a letter set. */
export const toggleLetter = (letters: string, letter: string): string => orderedLetters(letters.includes(letter) ? letters.replace(letter, '') : letters + letter);

/** The commander's color identity as filter letters (CR 903.4): "C" for a colorless commander, '' when there is no commander (yet). */
export function commanderIdentity(identities: readonly (readonly string[])[]): string {
  if (!identities.length) return '';
  return orderedLetters(identities.flat().join('')) || 'C';
}

/** The identity the filter uses: the player's choice, or (in a commander format) the commander's. */
export const effectiveIdentity = (f: SearchFilters, format: FormatOption, fromCommander: string): string => f.identity ?? (format.commander ? fromCommander : '');

const comparison = (s: string) => s.replace(/\s+/g, '');
const list = (s: string) => s.trim().replace(/\s*,\s*/g, ',');

/** The API query for a set of filters (empty fields are left out). */
export function searchQuery(f: SearchFilters, format: FormatOption, page: number, opts: { identity?: string; images?: boolean } = {}): DeckSearchQuery {
  const q: DeckSearchQuery = { page };
  const box = f.q.trim();
  const boxScry = looksLikeScryfall(box);
  if (box && !boxScry) q.q = box;
  if (f.colors) q.colors = f.colors;
  const identity = opts.identity ?? f.identity ?? '';
  if (identity) q.identity = identity;
  if (f.types.trim()) q.types = list(f.types);
  if (f.mv.trim()) q.mv = comparison(f.mv);
  if (f.pow.trim()) q.pow = comparison(f.pow);
  if (f.tou.trim()) q.tou = comparison(f.tou);
  if (f.keywords.trim()) q.keywords = list(f.keywords);
  if (f.legalOnly && format.legalityKey) q.format = format.legalityKey;
  if (f.automation) q.automation = f.automation;
  // The main box's Scryfall text and the Advanced search's, ANDed (each in parentheses, so an "or" in one stays inside it).
  const scry = [boxScry ? box : '', f.scry.trim()].filter(Boolean);
  if (scry.length) q.scry = scry.length === 1 ? scry[0]! : scry.map((s) => `(${s})`).join(' ');
  if (opts.images) q.images = 1;
  return q;
}

/** Two queries ask for the same cards (the page aside). */
export const sameSearch = (a: DeckSearchQuery, b: DeckSearchQuery): boolean => JSON.stringify({ ...a, page: 0 }) === JSON.stringify({ ...b, page: 0 });
