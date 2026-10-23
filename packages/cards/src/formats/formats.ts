/**
 * The formats OpenMTG validates, as data (docs/design/decks-and-formats.md). Card pools, banned and restricted lists come from Scryfall's `legalities`
 * (kept in the local index since WP24, as current as the last refresh); construction rules are here, with the rule each comes from:
 *   constructed (CR 100.2a, 100.4a): at least 60 cards, at most 4 of a name except basic lands, sideboard of at most 15;
 *   Commander (CR 903.5): exactly 100 cards including the commander(s), singleton except basic lands, no sideboard (903.5e), color identity;
 *   Duel Commander: Commander construction with its own banned list (Scryfall `duel`), its banned-as-commander list (Scryfall `duel: "restricted"`)
 *     and 20 life;
 *   Brawl (CR 903.12): Standard Brawl is 60 cards (903.12d); Arena's "Brawl" (formerly Historic Brawl, Scryfall `brawl`) is 100 cards;
 *   Historic and Timeless (MTG Arena): constructed rules, Arena's card pool (Timeless has a restricted list, like Vintage);
 *   Casual: no restrictions at all.
 */
import type { FormatDef, FormatId } from './types';

const CONSTRUCTED = {
  deckSize: { min: 60, rule: 'CR 100.2a' },
  maxCopies: { count: 4, rule: 'CR 100.2a' },
  sideboard: { count: 15, rule: 'CR 100.4a' },
  startingLife: 20,
} as const;

const COMMANDER = {
  deckSize: { min: 100, max: 100, rule: 'CR 903.5a' },
  maxCopies: { count: 1, rule: 'CR 903.5b' },
  sideboard: { count: 0, rule: 'CR 903.5e' },
  commander: 'commander',
} as const;

export const FORMATS: readonly FormatDef[] = [
  { id: 'standard', name: 'Standard', aliases: [], legalityKey: 'standard', ...CONSTRUCTED },
  { id: 'pioneer', name: 'Pioneer', aliases: [], legalityKey: 'pioneer', ...CONSTRUCTED },
  { id: 'modern', name: 'Modern', aliases: [], legalityKey: 'modern', ...CONSTRUCTED },
  { id: 'legacy', name: 'Legacy', aliases: [], legalityKey: 'legacy', ...CONSTRUCTED },
  { id: 'vintage', name: 'Vintage', aliases: [], legalityKey: 'vintage', ...CONSTRUCTED, restricted: 'one-copy' },
  { id: 'pauper', name: 'Pauper', aliases: [], legalityKey: 'pauper', ...CONSTRUCTED },
  { id: 'commander', name: 'Commander', aliases: ['edh', 'elder dragon highlander'], legalityKey: 'commander', ...COMMANDER, startingLife: 40 },
  { id: 'duel', name: 'Duel Commander', aliases: ['duel commander', 'duelcommander', 'duel-commander', 'french commander'], legalityKey: 'duel', ...COMMANDER, restricted: 'banned-as-commander', startingLife: 20 },
  {
    id: 'brawl',
    name: 'Brawl',
    aliases: ['historic brawl', 'historicbrawl', 'historic-brawl', 'arena brawl'],
    legalityKey: 'brawl',
    ...COMMANDER,
    // MTG Arena's Brawl (renamed from Historic Brawl in 2023) is 100 cards; CR 903.12d's 60 cards is Standard Brawl.
    deckSize: { min: 100, max: 100, rule: 'MTG Arena Brawl (100 cards; CR 903.12 option)' },
    commander: 'brawl',
    startingLife: 25,
  },
  {
    id: 'standardbrawl',
    name: 'Standard Brawl',
    aliases: ['standard brawl', 'standard-brawl'],
    legalityKey: 'standardbrawl',
    ...COMMANDER,
    deckSize: { min: 60, max: 60, rule: 'CR 903.12d' },
    commander: 'brawl',
    startingLife: 25,
  },
  { id: 'historic', name: 'Historic', aliases: [], legalityKey: 'historic', ...CONSTRUCTED },
  { id: 'timeless', name: 'Timeless', aliases: [], legalityKey: 'timeless', ...CONSTRUCTED, restricted: 'one-copy' },
  { id: 'casual', name: 'Casual (no restrictions)', aliases: ['none', 'no restrictions', 'freeform', 'kitchen table'], startingLife: 20 },
];

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** A format by id, display name or alias (case-insensitive), or undefined. */
export function findFormat(name: string): FormatDef | undefined {
  const k = key(name);
  return FORMATS.find((f) => f.id === k || key(f.name) === k || f.aliases.includes(k));
}

/** A format by id (throws for an id that is not in FORMATS: a programming error). */
export function formatById(id: FormatId): FormatDef {
  const f = FORMATS.find((x) => x.id === id);
  if (!f) throw new Error(`Unknown format id "${id}"`);
  return f;
}
