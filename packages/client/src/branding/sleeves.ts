/**
 * Deck sleeves: the DigiDice card back ("classic") and its mana-color versions, one for every color and every combination of colors (31). The files are
 * made by scripts/brand/make-cardback.py --sleeves into assets/brand/sleeves/ with the list in sleeves.json; like every brand asset they are not MIT
 * licensed (assets/brand/README.md). A deck's sleeve is never chosen: it is the sleeve of the deck's colors (deckSleeve), the classic back for a
 * colorless deck; a player's hidden cards are drawn in their deck's sleeve.
 *
 * Each sleeve is two pictures: the card back itself (a still picture, with a little depth) and its moving lights, comets that run along the circuit
 * lines in each line's color, drawn over it (CardBack). The classic sleeve is the DigiDice card back with the same depth and lights; card-back.svg itself
 * stays the flat brand original.
 */
import type { Color } from '@openmtg/engine';
import sleevesJson from '../../../../assets/brand/sleeves/sleeves.json';

export interface Sleeve {
  /** The colors in lower case, in their usual written order ("wu", "ubr"). */
  id: string;
  colors: Color[];
  /** "White-Blue", "All five colors". */
  name: string;
  /** Path under /brand/. */
  file: string;
  /** The moving lights drawn over it, path under /brand/. */
  tracers: string;
}

/** The DigiDice card back: the sleeve of a deck that has none. */
export const CLASSIC_SLEEVE = 'classic';

const LIST = sleevesJson as { classic: { file: string; tracers: string }; sleeves: Sleeve[] };

export const SLEEVES: readonly Sleeve[] = LIST.sleeves;

const BY_ID: ReadonlyMap<string, Sleeve> = new Map(SLEEVES.map((s) => [s.id, s]));

/** A sleeve by id; undefined for the classic back and for an id this build does not have. */
export function sleeveById(id: string | null | undefined): Sleeve | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/** The picture of a sleeve; the classic sleeve for no sleeve or an unknown id. */
export function sleeveUrl(id: string | null | undefined): string {
  return `/brand/${(sleeveById(id) ?? LIST.classic).file}`;
}

/** The moving lights of a sleeve (the classic sleeve's for no sleeve or an unknown id). */
export function sleeveTracersUrl(id: string | null | undefined): string {
  return `/brand/${(sleeveById(id) ?? LIST.classic).tracers}`;
}

export function sleeveName(id: string | null | undefined): string {
  return sleeveById(id)?.name ?? 'Classic';
}

/** The sleeve of exactly these colors (in any order); none for a colorless list. */
export function sleeveForColors(colors: readonly Color[]): Sleeve | undefined {
  const want = new Set(colors);
  return SLEEVES.find((s) => s.colors.length === want.size && s.colors.every((c) => want.has(c)));
}

/** A deck's sleeve id: the sleeve of its colors (decks/look.ts deckColors); undefined, the classic back, for a colorless deck or colors not known yet. */
export function deckSleeve(colors: readonly Color[] | null | undefined): string | undefined {
  return colors ? sleeveForColors(colors)?.id : undefined;
}
