/**
 * Index card -> API card summary (api.ts CardSummary), shared by search and card detail. Image URLs are copied from the local index (Scryfall's
 * `image_uris`, never built by hand) and only when the client says the player opted in (ARCHITECTURE.md "Card images" B).
 */
import { legalitiesOf, type IndexedCard } from '@openmtg/cards';
import type { AutomationLevel, Color, OracleFace } from '@openmtg/engine';
import type { CardSummary, FaceSummary, ImageUris, Legality } from './api';

export const COLOR_ORDER: readonly Color[] = ['W', 'U', 'B', 'R', 'G'];

/** Known color letters in WUBRG order (unknown letters dropped). */
export function colorList(letters: readonly string[] | undefined): Color[] {
  const set = new Set(letters ?? []);
  return COLOR_ORDER.filter((c) => set.has(c));
}

/** The card's faces: `card_faces` for a multi-face card, otherwise the card itself as its only face. */
export function facesOf(card: IndexedCard): OracleFace[] {
  return card.card_faces && card.card_faces.length > 0 ? card.card_faces : [card];
}

/**
 * The card's colors. Scryfall gives no top-level colors for double-faced cards: their colors outside the battlefield are the front face's (CR 712.8a); a
 * split card's top-level colors already combine both halves (CR 709.4, 709.4b: colors from the combined mana cost).
 */
export function cardColors(card: IndexedCard): Color[] {
  return colorList(card.colors ?? facesOf(card)[0]?.colors);
}

/**
 * Color identity (CR 903.4): Scryfall's `color_identity`. A card without it (test fixtures, hand-made data) falls back to the colors and color indicators of
 * every face, which can miss mana symbols in rules text; the index built from Scryfall always has the field.
 */
export function cardIdentity(card: IndexedCard): Color[] {
  if (card.color_identity) return colorList(card.color_identity);
  return colorList([...(card.colors ?? []), ...facesOf(card).flatMap((f) => [...(f.colors ?? []), ...(f.color_indicator ?? [])])]);
}

/** Colors of a printed mana cost (CR 202.2): every colored, hybrid or Phyrexian symbol counts ("{2/W}", "{G/P}", "{W/U}"); generic, {C}, {X}, {S} do not. */
export function costColors(manaCost: string | undefined): Color[] {
  const letters: string[] = [];
  for (const m of (manaCost ?? '').matchAll(/\{([^}]*)\}/g)) letters.push(...m[1]!.toUpperCase().split('/'));
  return colorList(letters);
}

/**
 * A face's colors. Scryfall gives per-face `colors` only for double-faced cards; the faces of split, adventure, prepare and flip cards have none, so they
 * come from the face's own mana cost and color indicator (CR 202.2, 202.2e; each half has its own characteristics, CR 709.4, 715.3b). A flip card's
 * flipped half has no mana cost and keeps the card's color (CR 710.1c).
 */
export function faceColors(card: IndexedCard, face: OracleFace, index: number): Color[] {
  if (face.colors) return colorList(face.colors);
  if (face === card) return colorList(card.colors);
  if (card.layout === 'flip' && index > 0) return cardColors(card);
  return colorList([...costColors(face.mana_cost), ...(face.color_indicator ?? [])]);
}

/** The picture's URLs with its artist (the face's own, else the card's), so the client can credit it. */
function images(uris: OracleFace['image_uris'], artist: string | undefined): ImageUris | undefined {
  if (!uris) return undefined;
  const out: ImageUris = {};
  if (typeof uris.normal === 'string') out.normal = uris.normal;
  if (typeof uris.large === 'string') out.large = uris.large;
  if (!out.normal && !out.large) return undefined;
  if (artist) out.artist = artist;
  return out;
}

function faceSummary(card: IndexedCard, face: OracleFace, index: number, withImages: boolean): FaceSummary {
  const out: FaceSummary = {
    name: face.name,
    manaCost: face.mana_cost ? face.mana_cost : null,
    typeLine: face.type_line ?? '',
    oracleText: face.oracle_text ?? '',
    colors: faceColors(card, face, index),
  };
  if (face.power !== undefined) out.power = face.power;
  if (face.toughness !== undefined) out.toughness = face.toughness;
  if (face.loyalty !== undefined) out.loyalty = face.loyalty;
  if (face.defense !== undefined) out.defense = face.defense;
  if (withImages) {
    // One picture for the whole card (split, adventure, flip): Scryfall puts it on the card, shown with the first face.
    const uris = images(face.image_uris, face.artist ?? card.artist) ?? (index === 0 ? images(card.image_uris, card.artist ?? face.artist) : undefined);
    if (uris) out.imageUris = uris;
  }
  return out;
}

export function cardSummary(card: IndexedCard, automation: AutomationLevel, withImages: boolean): CardSummary {
  return {
    name: card.name,
    oracleId: card.oracle_id ?? '',
    layout: card.layout,
    manaValue: card.cmc ?? 0,
    colors: cardColors(card),
    colorIdentity: cardIdentity(card),
    faces: facesOf(card).map((f, i) => faceSummary(card, f, i, withImages)),
    legalities: { ...(legalitiesOf(card) ?? {}) } as Record<string, Legality>,
    automation,
  };
}

/** `images=1` in a query: the player turned on "Show card images from Scryfall". Anything else means no image URLs. */
export const wantsImages = (query: Record<string, string>): boolean => query.images === '1';
