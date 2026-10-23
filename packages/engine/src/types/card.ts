import type { DefId } from './ids';
import type { Color, ManaCost } from './mana';
import type { AbilityDef } from './ability';
import type { CardAutomation } from './automation';

// `AutomationLevel` moved to types/automation.ts (design D20); re-exported here so existing imports keep working.
export type { AutomationLevel } from './automation';

/**
 * Oracle card data as fetched from Scryfall (subset of the card object).
 * The engine only consumes this shape; fetching/caching lives in @openmtg/cards.
 * Cards are keyed by Oracle name and Oracle text (CR 108.1).
 */
export interface OracleFace {
  name: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  colors?: string[];
  color_indicator?: string[];
  /**
   * Scryfall image URLs (normal/large only), kept in the local index for the client's opt-in
   * "show card images" setting. Display only: the engine never reads them, and test fixtures
   * never contain them.
   */
  image_uris?: { normal?: string; large?: string };
  /**
   * Scryfall's artist of that picture, kept with it so a Scryfall image is always credited to its artist. Display only, like
   * `image_uris`: the engine never reads it, and test fixtures never contain it.
   */
  artist?: string;
  layout?: string;
}

export interface OracleRelatedPart {
  component: string; // "token" | "meld_part" | "meld_result" | "combo_piece"
  name: string;
  type_line?: string;
}

export interface OracleCard extends OracleFace {
  oracle_id?: string;
  layout: string;
  cmc?: number;
  color_identity?: string[];
  keywords?: string[];
  produced_mana?: string[];
  card_faces?: OracleFace[];
  all_parts?: OracleRelatedPart[];
  set_type?: string;
  border_color?: string;
  /**
   * WP24 INTERFACE CHANGE: a card the rules do not cover (CR 100.7: silver border, acorn stamp, Mystery Booster / Unknown Event playtest card), set by the
   * card index (packages/cards trim.ts). Every compile path makes such a card manual-only through `markUnsanctioned` (cards/unsanctioned.ts, design 12.3):
   * `compileCard` does, and WP18's `compileCardV2` must too.
   */
  unsanctioned?: true;
}

/** Card types (CR 205.2a). */
export type CardType =
  | 'Artifact' | 'Battle' | 'Conspiracy' | 'Creature' | 'Dungeon' | 'Enchantment' | 'Instant'
  | 'Kindred' | 'Land' | 'Phenomenon' | 'Plane' | 'Planeswalker' | 'Scheme' | 'Sorcery' | 'Vanguard';
export const CARD_TYPES: readonly CardType[] = [
  'Artifact', 'Battle', 'Conspiracy', 'Creature', 'Dungeon', 'Enchantment', 'Instant',
  'Kindred', 'Land', 'Phenomenon', 'Plane', 'Planeswalker', 'Scheme', 'Sorcery', 'Vanguard',
];
/** Supertypes (CR 205.4a). */
export type Supertype = 'Basic' | 'Legendary' | 'Ongoing' | 'Snow' | 'World';
export const SUPERTYPES: readonly Supertype[] = ['Basic', 'Legendary', 'Ongoing', 'Snow', 'World'];

/** Scryfall layout values that matter to the rules (CR 709-715 and others). */
export type Layout =
  | 'normal' | 'split' | 'flip' | 'transform' | 'modal_dfc' | 'meld' | 'leveler' | 'class' | 'case'
  | 'saga' | 'adventure' | 'mutate' | 'prototype' | 'battle' | 'token' | 'double_faced_token'
  | 'emblem' | 'planar' | 'scheme' | 'vanguard' | 'augment' | 'host' | 'reversible_card' | (string & {});

/** One face (or the only face) of a card definition. */
export interface FaceDef {
  name: string;
  /** null = the face has no mana cost (CR 202.1b), distinct from {0}. */
  manaCost: ManaCost | null;
  typeLine: string;
  supertypes: Supertype[];
  types: CardType[];
  subtypes: string[];
  oracleText: string;
  /** Printed P/T/loyalty/defense as strings: may be "*", "1+*", "X" (CR 208.2). */
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  /** Colors as determined by mana cost, color indicator, or CDA (CR 202.2, 204). */
  colors: Color[];
  colorIndicator?: Color[];
  /** Keyword names Scryfall detected (a hint only; the compiler decides). */
  keywords: string[];
  /** Compiled ability model (data, not code). */
  abilities: AbilityDef[];
  /**
   * M6-0 ADDITION (m6 design 2.3, optional), CR 718.2: the alternative mana cost, power and toughness of a prototype card; its colors come from that cost
   * (CR 718.3b, 105.2). Written by cards/faces.ts from the prototype line (M6-6; Scryfall has no field for it).
   */
  prototype?: { manaCost: ManaCost; power: string; toughness: string };
}

/**
 * M6-0 (m6 design D7, 2.2): the ids of the two face-down pseudo-definitions every game has (core/create.ts#FACE_DOWN_DEFS): a face-down permanent or spell is
 * a 2/2 creature with no name, text, subtypes or mana cost (CR 708.2a); `ward2` adds ward {2} (CR 702.168a, 701.58a). No object has one as its definition: a
 * view shows a face-down object as one (M6-3), and a copy of a face-down object copies one (M6-2).
 */
export const FACE_DOWN_DEF_IDS = { plain: '__facedown__', ward2: '__facedown_ward2__' } as const;

/** A compiled card definition. Stored in GameState.defs so a game state is self-contained. */
export interface CardDef {
  id: DefId;
  oracleId?: string;
  /** Full Oracle name, e.g. "Fire // Ice" for split cards. */
  name: string;
  layout: Layout;
  /** Faces in printed order. Normal cards have one face. */
  faces: FaceDef[];
  isToken: boolean;
  /** For meld cards: the DefId of the melded result and the partner (CR 712.4, 701.42). */
  meld?: { result?: DefId; partner?: DefId; isResult?: boolean };
  /** Names of tokens this card can create (from Scryfall all_parts). */
  tokenNames?: string[];
  /** How well the engine understands the card (design section 10). Computed, never asserted; lives here, never inside the ability JSON. */
  automation: CardAutomation;
  /** A card the index does not know (new set, silver border, a typo the player confirmed): a text-less, rules-less, playable-by-hand definition (design 12.1). */
  stub?: { origin: 'decklist' | 'image' | 'manual' };
  /** Silver-border / acorn cards kept by the optional `--include-unsanctioned` index: manual-only, excluded from default deck validation (design 12.3). */
  unsanctioned?: boolean;
  /**
   * M11-0 (m11 design 4.2), CR 903.4: the card's color identity (Scryfall's `color_identity`: mana symbols in the cost and rules text without reminder text,
   * color indicators, characteristic-defining abilities, back faces, CR 903.4c-e). Filled by the compiler from M11-4; absent in every earlier definition.
   * Read only in a Commander game, as the game begins (CR 903.4a: `CommanderRec.identity`).
   */
  colorIdentity?: Color[];
}
