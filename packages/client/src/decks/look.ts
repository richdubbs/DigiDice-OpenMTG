/**
 * What the deck screens need to dress a card or a deck: the color "tone" of a card (its deck-list banner), the colors of a deck (the pips on its box in
 * the library, and its sleeve) and the card count a format asks for (the "60/60 Cards" counter). Pure; read from printed card data, not rules decisions.
 */
import type { Color } from '@openmtg/engine';
import type { CardSummary, DeckEntry } from '@openmtg/server/api';
import { COLORS, isLand } from './stats';

export type Tone = Color | 'multi' | 'artifact' | 'land' | 'colorless';

/** The tone of a card: its color, gold for several colors, and grey tones for lands, artifacts and other colorless cards. Unknown cards are colorless. */
export function toneOf(card: CardSummary | undefined): Tone {
  if (!card) return 'colorless';
  if (isLand(card)) return 'land';
  const colors = card.colors;
  if (colors.length > 1) return 'multi';
  if (colors.length === 1) return colors[0]!;
  return /\bArtifact\b/.test(card.faces[0]?.typeLine ?? '') ? 'artifact' : 'colorless';
}

/** The colors of a deck's spells (main deck and commander), in WUBRG order. Takes a saved deck or a game's deck list. */
export function deckColors(deck: { main: readonly DeckEntry[]; commander?: readonly DeckEntry[] }, cards: ReadonlyMap<string, CardSummary>): Color[] {
  const seen = new Set<Color>();
  for (const e of [...deck.main, ...(deck.commander ?? [])]) {
    const c = cards.get(e.name);
    if (c && !isLand(c)) for (const col of c.colors) seen.add(col);
  }
  return COLORS.filter((c) => seen.has(c));
}

/**
 * Cards a deck of the format is built to (the counter shows "N/size"): 100 for the 100-card commander formats (Commander, Duel Commander, and Arena's
 * Brawl, formerly Historic Brawl), otherwise 60 (Standard Brawl is 60 cards, CR 903.12d).
 */
export function deckSize(formatId: string): number {
  return formatId === 'commander' || formatId === 'duel' || formatId === 'brawl' ? 100 : 60;
}
