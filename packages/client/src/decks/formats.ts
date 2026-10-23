/**
 * The formats a deck can be built for (docs/design/decks-and-formats.md "Format validation"). The client only needs ids, names and which formats use a
 * commander; the rules themselves live in the cards package (work package F1) and are reached through POST /api/decks/validate.
 *
 * MERGE NOTE (F1): the ids match FORMATS in packages/cards/src/formats/formats.ts on branch par/f1 (Scryfall legality keys, plus "casual" for no
 * restrictions; F1 also accepts "freeform" as an alias of casual). If F1 changes its ids, update this table; nothing else in the client depends on them.
 */
export interface FormatOption {
  id: string;
  name: string;
  /** The deck has a commander slot (CR 903.3). */
  commander: boolean;
  /** Legality key for search ("legal in <format>"), absent for casual. */
  legalityKey?: string;
}

export const FORMAT_OPTIONS: readonly FormatOption[] = [
  { id: 'casual', name: 'Casual (no restrictions)', commander: false },
  { id: 'standard', name: 'Standard', commander: false, legalityKey: 'standard' },
  { id: 'pioneer', name: 'Pioneer', commander: false, legalityKey: 'pioneer' },
  { id: 'modern', name: 'Modern', commander: false, legalityKey: 'modern' },
  { id: 'legacy', name: 'Legacy', commander: false, legalityKey: 'legacy' },
  { id: 'vintage', name: 'Vintage', commander: false, legalityKey: 'vintage' },
  { id: 'pauper', name: 'Pauper', commander: false, legalityKey: 'pauper' },
  { id: 'commander', name: 'Commander', commander: true, legalityKey: 'commander' },
  { id: 'duel', name: 'Duel Commander', commander: true, legalityKey: 'duel' },
  { id: 'brawl', name: 'Brawl', commander: true, legalityKey: 'brawl' },
  { id: 'standardbrawl', name: 'Standard Brawl', commander: true, legalityKey: 'standardbrawl' },
  { id: 'historic', name: 'Historic', commander: false, legalityKey: 'historic' },
  { id: 'timeless', name: 'Timeless', commander: false, legalityKey: 'timeless' },
];

export const DEFAULT_FORMAT = 'casual';

/** The option for an id; unknown ids (from an older or newer version) fall back to a plain entry rather than being lost. */
export function formatOption(id: string): FormatOption {
  return FORMAT_OPTIONS.find((f) => f.id === id) ?? { id, name: id, commander: false };
}

/** Recognize a format name written in an exported deck ("// Format: Modern"). */
export function findFormatId(text: string): string | undefined {
  const t = text.trim().toLowerCase();
  const alias: Record<string, string> = { edh: 'commander', freeform: 'casual', 'duel commander': 'duel', 'standard brawl': 'standardbrawl' };
  if (alias[t]) return alias[t];
  return FORMAT_OPTIONS.find((f) => f.id === t || f.name.toLowerCase() === t)?.id;
}
