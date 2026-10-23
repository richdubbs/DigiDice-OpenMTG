/**
 * Format validation types (milestone 7, docs/design/decks-and-formats.md). A check returns structured problems: the rule broken (a CR number, or the
 * format's own rule document), the card when one card is at fault, and a plain-English message. Pure data: the client shows them live, the CLI prints them.
 */
import type { OracleCard } from '@openmtg/engine';

/** The formats OpenMTG validates. Ids are Scryfall's `legalities` keys where one exists; `casual` has no card-pool or construction limits. */
export type FormatId =
  | 'standard' | 'pioneer' | 'modern' | 'legacy' | 'vintage' | 'pauper'
  | 'commander' | 'duel' | 'brawl' | 'standardbrawl'
  | 'historic' | 'timeless' | 'casual';

/** Commander-style construction (CR 903.3-903.5); `brawl` adds planeswalker commanders (903.12c) and the colorless-commander basic land option (903.12e). */
export type CommanderStyle = 'commander' | 'brawl';

export interface FormatDef {
  id: FormatId;
  /** Display name ("Duel Commander", "Standard Brawl"). */
  name: string;
  /** Other spellings accepted by `findFormat` ("edh", "historic brawl", "standard-brawl"), lower case. */
  aliases: readonly string[];
  /** Scryfall `legalities` key for the card pool, banned and restricted lists; absent: any card may be played (casual). */
  legalityKey?: string;
  /** Deck size (main deck, plus the commander(s) in a commander format); absent: no size rule. `max` equal to `min` means exactly. */
  deckSize?: { min: number; max?: number; rule: string };
  /** Most cards of one English name in deck + sideboard (+ commander, + companion); absent: no limit. Basic lands are exempt (CR 100.2a, 903.5b). */
  maxCopies?: { count: number; rule: string };
  /**
   * What Scryfall's `restricted` legality value means in this format: `one-copy` (the Vintage and Timeless restricted lists: at most one copy), or
   * `banned-as-commander` (Duel Commander's list of cards that may be in the 99 but not be the commander; Scryfall encodes it as `duel: "restricted"`).
   * Absent: a `restricted` value is not understood and is reported as a warning, never ignored.
   */
  restricted?: 'one-copy' | 'banned-as-commander';
  /** Most sideboard cards; `count: 0` means sideboards are not used (CR 903.5e); absent: no limit. */
  sideboard?: { count: number; rule: string };
  /** Commander-style deck construction, when the format has commanders. */
  commander?: CommanderStyle;
  /** Starting life in a two-player game (informational: CR 103.4, 903.7, 903.12f; Duel Commander uses 20). */
  startingLife: number;
}

export type Severity =
  /** The deck breaks a rule of the format. */
  | 'error'
  /** The validator could not check something (no legality data, an unknown card, a companion condition): never reported as legal or illegal silently. */
  | 'warning'
  /** Informational (for example: the commander or companion was read from an MTGO-style sideboard). */
  | 'note';

export type ProblemCode =
  | 'deck-too-small'
  | 'deck-too-large'
  | 'too-many-copies'
  | 'restricted'
  | 'restricted-unknown'
  | 'banned-as-commander'
  | 'copy-limit-unknown'
  | 'sideboard-too-large'
  | 'sideboard-not-allowed'
  | 'banned'
  | 'not-legal'
  | 'no-legality-data'
  | 'unresolved-card'
  | 'commander-not-allowed'
  | 'no-commander'
  | 'too-many-commanders'
  | 'not-a-commander'
  | 'invalid-partners'
  | 'color-identity'
  | 'no-color-identity'
  | 'commander-from-sideboard'
  | 'companion-from-sideboard'
  | 'too-many-companions'
  | 'not-a-companion'
  | 'companion-in-deck'
  | 'companion-unchecked'
  /** CMP1: the starting deck does not fulfill the companion's condition (CR 702.139a). */
  | 'companion-condition'
  /** CMP1: several sideboard cards could be the companion of an MTGO-style list; none is chosen for the player. */
  | 'companion-ambiguous';

export type DeckPart = 'main' | 'sideboard' | 'commander' | 'companion';

export interface FormatProblem {
  severity: Severity;
  code: ProblemCode;
  /** The rule broken: "CR 100.2a", "CR 903.5c", "Scryfall legalities (modern: banned)". */
  rule: string;
  message: string;
  /** Oracle name of the card at fault, when one card is. */
  card?: string;
  /** Where the card is. */
  section?: DeckPart;
  /** The number found and the number allowed, for size and copy problems. */
  count?: number;
  limit?: number;
}

/** One deck entry: the shape of `ResolvedEntry` (database.ts). */
export interface DeckEntry {
  count: number;
  card: OracleCard;
}

/** A name the index did not know, the shape of `UnresolvedEntry` (database.ts): counted in deck sizes, never checked. */
export interface UnknownEntry {
  section: DeckPart;
  name: string;
  count: number;
}

/** What `validateDeck` reads; a `ResolvedDecklist` from `CardDatabase.resolveDecklist` fits as is. */
export interface DeckToValidate {
  main: readonly DeckEntry[];
  sideboard?: readonly DeckEntry[];
  commander?: readonly DeckEntry[];
  companion?: readonly DeckEntry[];
  unresolved?: readonly UnknownEntry[];
}

export interface FormatReport {
  format: FormatDef;
  /** No problem of severity "error". Warnings mean something was not checked: read them before calling the deck legal. */
  valid: boolean;
  /** Errors first, then warnings, then notes; otherwise in the order found. */
  problems: FormatProblem[];
  /** Card counts used by the checks (unknown names included). `deck` is the main deck plus the commander(s) in a commander format. */
  counts: { main: number; sideboard: number; commander: number; companion: number; deck: number };
  /** The commander cards checked (from the Commander section, or read from the sideboard; see `commander-from-sideboard`). */
  commanders: string[];
  /**
   * CMP1 INTERFACE CHANGE (additive): the companion the deck reveals (CR 702.139a), by Oracle name: the Companion section's card, or the one read from an
   * MTGO-style sideboard (`companion-from-sideboard`). Absent: no companion (or more than one in the section: `too-many-companions`).
   */
  companion?: string;
}
