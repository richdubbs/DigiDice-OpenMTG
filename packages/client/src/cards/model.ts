/**
 * What the card component draws, from either source the client has: a compiled `CardDef` (games: `GameView.defs`) or a `CardSummary` (search results,
 * decks; packages/server/src/api.ts). Pure.
 *
 * Image slots come from the engine's `imageSlots` (ARCHITECTURE.md "Card images": one slot per printed side, not per rules face), so an uploaded image
 * binds to the same key wherever the card shows up.
 */
import { formatManaCost, imageSlots, type AutomationLevel, type CardDef, type Color, type FaceDef, type ImageSlot } from '@openmtg/engine';
import type { CardSummary, FaceSummary, ImageUris } from '@openmtg/server/api';

export interface CardFaceModel {
  name: string;
  /** Printed mana cost text ("{2}{G}"); null when the face has none (CR 202.1b). */
  manaCost: string | null;
  typeLine: string;
  oracleText: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  colors: Color[];
  /** Scryfall image URLs of this face (only when the player opted in; taken from the local index, never built by hand). */
  imageUris?: ImageUris;
}

export interface CardModel {
  name: string;
  layout: string;
  faces: CardFaceModel[];
  isToken: boolean;
  /** Null when unknown (the summary of a card the server could not classify never happens; a hand-made model may omit it). */
  automation: AutomationLevel | null;
  /** Text fragments the players resolve by hand (CardAutomation.unsupported). */
  unsupported: string[];
  /** Image slots, one per printed side (engine `imageSlots`). */
  slots: ImageSlot[];
  /** The compiled definition, when the model came from one: the frame paints its manual text (engine `spansOf`). */
  def?: CardDef;
}

/** Layouts printed as one card with two halves and one picture (CR 709 split, 715 adventure, 710 flip, 722 prepare). */
export const ONE_PICTURE: ReadonlySet<string> = new Set(['split', 'adventure', 'flip', 'prepare']);
/** Layouts with two printed sides, each its own picture (CR 712 double-faced cards, reversible cards, double-faced tokens). */
export const TWO_SIDED: ReadonlySet<string> = new Set(['transform', 'modal_dfc', 'reversible_card', 'double_faced_token']);
const TOKEN_LAYOUTS: ReadonlySet<string> = new Set(['token', 'double_faced_token', 'emblem']);

function faceOfDef(f: FaceDef): CardFaceModel {
  return {
    name: f.name,
    manaCost: f.manaCost ? formatManaCost(f.manaCost) : null,
    typeLine: f.typeLine,
    oracleText: f.oracleText,
    colors: [...f.colors],
    ...(f.power !== undefined ? { power: f.power } : {}),
    ...(f.toughness !== undefined ? { toughness: f.toughness } : {}),
    ...(f.loyalty !== undefined ? { loyalty: f.loyalty } : {}),
    ...(f.defense !== undefined ? { defense: f.defense } : {}),
  };
}

/** The model of a compiled definition (a card in a game). */
export function modelFromDef(def: CardDef): CardModel {
  let slots: ImageSlot[];
  try {
    slots = imageSlots(def);
  } catch {
    slots = [{ key: def.name, label: def.name, names: [def.name] }];
  }
  return {
    name: def.name,
    layout: def.layout,
    faces: def.faces.map(faceOfDef),
    isToken: def.isToken,
    automation: def.automation.level,
    unsupported: [...def.automation.unsupported],
    slots,
    def,
  };
}

function faceOfSummary(f: FaceSummary): CardFaceModel {
  const { name, manaCost, typeLine, oracleText, colors, power, toughness, loyalty, defense, imageUris } = f;
  return {
    name,
    manaCost: manaCost === '' ? null : manaCost,
    typeLine,
    oracleText,
    colors: [...colors],
    ...(power !== undefined ? { power } : {}),
    ...(toughness !== undefined ? { toughness } : {}),
    ...(loyalty !== undefined ? { loyalty } : {}),
    ...(defense !== undefined ? { defense } : {}),
    ...(imageUris ? { imageUris } : {}),
  };
}

/**
 * The image slots of a search result. `imageSlots` reads only the layout, the names and (for tokens) the look of each face, so a definition with just
 * those is enough: images never depend on rules (design 12.2, contract C3). A meld card's melded back is not known from a summary (no `all_parts`): only
 * its own slot is listed.
 */
export function slotsOfSummary(s: Pick<CardSummary, 'name' | 'layout' | 'faces'>): ImageSlot[] {
  const isToken = TOKEN_LAYOUTS.has(s.layout) || s.faces.some((f) => /\bToken\b/.test(f.typeLine));
  const faces: FaceDef[] = s.faces.map((f) => ({
    name: f.name, manaCost: null, typeLine: f.typeLine, supertypes: [], types: [], subtypes: [], oracleText: f.oracleText, colors: [...f.colors], keywords: [], abilities: [],
    ...(f.power !== undefined ? { power: f.power } : {}),
    ...(f.toughness !== undefined ? { toughness: f.toughness } : {}),
  }));
  const def: CardDef = { id: s.name, name: s.name, layout: s.layout, faces, isToken, automation: { level: 'manual', unsupported: [], source: 'none' } };
  try {
    return imageSlots(def);
  } catch {
    return [{ key: s.name, label: s.name, names: [s.name] }];
  }
}

/** The model of a search result or deck card (CardSummary from the server). */
export function modelFromSummary(s: CardSummary): CardModel {
  const faces = s.faces.map(faceOfSummary);
  return {
    name: s.name,
    layout: s.layout,
    faces: faces.length > 0 ? faces : [{ name: s.name, manaCost: null, typeLine: '', oracleText: '', colors: [...s.colors] }],
    isToken: TOKEN_LAYOUTS.has(s.layout) || s.faces.some((f) => /\bToken\b/.test(f.typeLine)),
    automation: s.automation,
    unsupported: [],
    slots: slotsOfSummary(s),
  };
}

/** True for a card whose two printed sides are separate pictures (the face toggle applies). */
export const isTwoSided = (m: CardModel): boolean => TWO_SIDED.has(m.layout) && m.faces.length === 2;

/** The face index the frame shows: the given face of a two-sided card, otherwise 0 (one-picture layouts show every face at once). */
export function shownFace(m: CardModel, face: number): number {
  if (!isTwoSided(m)) return 0;
  return face >= 0 && face < m.faces.length ? face : 0;
}

/** The image slot of a face: a two-sided card (and a double-faced token) has one per side; everything else one picture for all faces. */
export function slotOfFace(m: CardModel, face: number): ImageSlot | undefined {
  if (m.slots.length === m.faces.length && m.slots.length > 1) return m.slots[shownFace(m, face)] ?? m.slots[0];
  return m.slots[0];
}

/** Colors of what the frame shows (every face of a one-picture card). */
export function frameColors(m: CardModel, face: number): Color[] {
  const faces = isTwoSided(m) ? [m.faces[shownFace(m, face)]!] : m.faces;
  const out = new Set<Color>();
  for (const f of faces) for (const c of f.colors) out.add(c);
  return (['W', 'U', 'B', 'R', 'G'] as const).filter((c) => out.has(c));
}

export type FrameTone = 'W' | 'U' | 'B' | 'R' | 'G' | 'multi' | 'artifact' | 'land' | 'colorless';

/** The frame's tone: its color, gold for two or more colors, and for colorless cards artifact, land or plain colorless (our own palette). */
export function frameTone(m: CardModel, face: number): FrameTone {
  const colors = frameColors(m, face);
  if (colors.length > 1) return 'multi';
  if (colors.length === 1) return colors[0]!;
  const type = m.faces[shownFace(m, face)]?.typeLine ?? '';
  if (/\bLand\b/.test(type)) return 'land';
  if (/\bArtifact\b/.test(type)) return 'artifact';
  return 'colorless';
}

/** Scryfall image URLs for a face; a one-picture card's picture is the card's (whichever face carries it). */
export function imageUrisOfFace(m: CardModel, face: number): ImageUris | undefined {
  const f = m.faces[shownFace(m, face)];
  if (f?.imageUris) return f.imageUris;
  if (!isTwoSided(m)) return m.faces.find((x) => x.imageUris)?.imageUris;
  return undefined;
}

/**
 * The name of what the card is now: the shown side of a double-faced card; both names of a split card (CR 709.4: its halves combined); the flipped
 * half of a flipped flip card (CR 710.2: once flipped, the alternative name applies); otherwise the normal name (CR 715.4, 722.4).
 */
export function activeFaceName(m: CardModel, face: number, flipped = false): string {
  if (flipped && m.layout === 'flip' && m.faces[1]) return m.faces[1].name;
  if (m.layout === 'split' && m.faces.length > 1) return m.name;
  return m.faces[shownFace(m, face)]?.name ?? m.name;
}
