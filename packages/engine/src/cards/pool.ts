/**
 * The card pool (design 12, "every card is known"). Owner: WP24. Contracts: cards/pipeline.ts (`StubCardDef`, `ImageSlots`, `ImageSlot`).
 *
 *  - `stubCardDef`: a name the local index does not know becomes a text-less, rules-less card the players handle by hand (contract C4);
 *  - `imageSlots`: the physical image slots of a card, one per printed side, not per rules face (design 12.2);
 *  - `tokenVariantKey` / `oracleTokenVariantKeys`: the slot key of a token variant ("Spirit (1/1 W Creature — Spirit; Flying)"), the same for the token the
 *    interpreter makes and for that token in the local index, so an uploaded token image binds to both;
 *  - `artSeriesNames`: the real cards an Art Series name depicts, for image matching only (design 12.2);
 *  - `markUnsanctioned` (cards/unsanctioned.ts): a card the rules do not cover (CR 100.7) is manual-only apart from its keywords (design
 *    12.3); `compileCard` applies it to an OracleCard flagged `unsanctioned`;
 *  - `tokenDefFor`: the definition of a token (predefined by name, CR 111.10, or inline, CR 111.3), the very definition the interpreter creates.
 *
 * Pure: no I/O. Images never affect rules automation and rules automation never affects image binding (contract C3).
 */
// Side effect only: model/capabilities installs the token classifier into effects/handlers/token-defs.ts when it loads. A token definition's id is derived
// from its content, automation included, so `tokenDefFor` must classify exactly as the interpreter does (design 5.2).
import '../model/capabilities';
import type { CardDef, FaceDef, OracleCard } from '../types/card';
import { tokenCardDef, type TokenSpec } from '../effects/handlers/token-defs';
import type { ImageSlot, ImageSlots, StubCardDef } from './pipeline';

// ---- stubs (contract C4) ---------------------------------------------------------------------------------------------------------------------------------

/** Prefix of a stub's DefId: a stub never shares an id with a real card, so the Update button can later add the real card next to it. */
export const STUB_ID_PREFIX = 'stub:';

/**
 * A card the local index does not know (a new set, a typo the player confirmed, an uploaded image of an unknown card): one face, no mana cost (CR 202.1b),
 * no types, no text, no abilities, `automation.level: 'manual'`. The engine never casts it: the empty cost alone would not stop an effect that casts it
 * "without paying its mana cost" (CR 118.6a), so actions/cast.ts refuses any stub (CR 305.9, 608.3: the real card may be a land or a permanent). It can be in
 * a deck, be shuffled and drawn, and be moved to any zone by a manual move; the players apply its rules by hand. Total: an empty name becomes "Unknown card".
 */
export const stubCardDef: StubCardDef = (name, origin) => {
  const shown = (typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '') || 'Unknown card';
  const face: FaceDef = { name: shown, manaCost: null, typeLine: '', supertypes: [], types: [], subtypes: [], oracleText: '', colors: [], keywords: [], abilities: [] };
  return {
    id: `${STUB_ID_PREFIX}${shown}`,
    name: shown,
    layout: 'normal',
    faces: [face],
    isToken: false,
    automation: {
      level: 'manual',
      faces: [{ abilities: [] }],
      unsupported: [`${shown} is not in the local card index: play it by hand (its characteristics and rules text are unknown).`],
      source: 'none',
      autoRatio: 0,
    },
    stub: { origin },
  };
};

// ---- unsanctioned cards (design 12.3): cards/unsanctioned.ts ---------------------------------------------------------------------------------------

export { markUnsanctioned, UNSANCTIONED_REASON } from './unsanctioned';

// ---- tokens --------------------------------------------------------------------------------------------------------------------------------------------

/**
 * The definition of the token the interpreter creates, or undefined: a predefined token (CR 111.10: Treasure, Food, Clue, ...) by name, case-insensitive,
 * or an evaluated inline token (CR 111.3: characteristics as numbers, keywords, abilities). It is the very definition the interpreter's "create" makes
 * (same content-derived id, effects/handlers/token-defs.ts), classified against this build's capabilities (design 5.2).
 */
export function tokenDefFor(token: string | TokenSpec): CardDef | undefined {
  if (typeof token === 'string') {
    if (token.trim() === '') return undefined;
    const r = tokenCardDef({ predefined: squash(token).replace(/ Token$/i, '') });
    return 'reason' in r ? undefined : r;
  }
  if (token === null || typeof token !== 'object') return undefined;
  const r = tokenCardDef(token);
  return 'reason' in r ? undefined : r;
}

/** The characteristics that tell token variants of one name apart: P/T, colors, type line, rules text. */
interface TokenLooks {
  name: string;
  power?: string | undefined;
  toughness?: string | undefined;
  colors?: readonly string[] | undefined;
  typeLine?: string | undefined;
  text?: string | undefined;
}

const WUBRG = 'WUBRG';
const squash = (s: string | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

/** "Treasure Token" (the rules name, CR 111.4) and "Treasure" (the name the index gives the printed token) are one token for images. */
export const tokenBaseName = (name: string): string =>
  squash(name)
    .split(/\s*\/\/\s*/)
    .map((side) => side.replace(/ Token$/i, ''))
    .join(' // '); // each side of a double-faced token: "Incubator Token // Phyrexian Token" -> "Incubator // Phyrexian"

/** How a token's rules text refers to the token itself: the engine says "this token" (CR 111.10), a printed token "this artifact", "this Aura", ... */
const SELF_REFERENCE = /\b([Tt])his (?:token|artifact|enchantment|aura|creature|permanent|land|vehicle|equipment)\b/gi;
/** A line of keyword abilities only ("Flying, vigilance"): no sentence, cost or quotation, so its commas separate keywords (CR 702.1). */
const isKeywordLine = (line: string): boolean => line.includes(',') && !/[.:"]/.test(line);
const capFirst = (s: string): string => (s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s);

/**
 * The rules text part of a token variant key, one item per ability, written the same way whoever wrote the text (the engine's token definition or the
 * printed token in the index): reminder text dropped (CR 207.2: it has no rules meaning), a comma-joined keyword line split into one keyword per item with
 * a capital first letter (the engine writes "Flying" and "Vigilance" on lines of their own), and every self-reference written "this token".
 */
function canonicalTokenText(text: string | undefined): string[] {
  return (text ?? '')
    .split('\n')
    .map((line) => squash(line.replace(/\s*\([^()]*\)/g, '')))
    .filter((line) => line !== '')
    .flatMap((line) => (isKeywordLine(line) ? line.split(/\s*,\s*/).filter((k) => k !== '').map(capFirst) : [line]))
    .map((line) => line.replace(SELF_REFERENCE, (_m, t: string) => `${t}his token`));
}

function variantKey(t: TokenLooks): string {
  const colors = [...new Set(t.colors ?? [])].filter((c) => WUBRG.includes(c)).sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b)).join('') || 'C';
  const pt = t.power !== undefined || t.toughness !== undefined ? `${t.power ?? '?'}/${t.toughness ?? '?'} ` : '';
  const type = squash(t.typeLine).replace(/^Token\s+/i, '');
  const text = canonicalTokenText(t.text).join('; ');
  return `${tokenBaseName(t.name)} (${pt}${colors} ${type}${text ? `; ${text}` : ''})`;
}

/** The image slot key of a token face: `Name (variant)` (design 12.2), e.g. "Spirit (1/1 W Creature — Spirit; Flying)". */
export const tokenVariantKey = (face: FaceDef): string =>
  variantKey({ name: face.name, power: face.power, toughness: face.toughness, colors: face.colors, typeLine: face.typeLine, text: face.oracleText });

/**
 * The same keys for an object of the local token index (tokens.jsonl): one per face (two for a double-faced token). The non-token objects that index also
 * holds (Dungeons, helper cards such as "Experience") are not token variants: their key is their name, as `imageSlots` gives it.
 */
export function oracleTokenVariantKeys(card: OracleCard): string[] {
  if (!TOKEN_LAYOUTS.has(card.layout) && !/\bToken\b/.test(card.type_line ?? '')) return [card.name];
  const faces = card.card_faces && card.card_faces.length > 1 ? card.card_faces : [card];
  // The same fallbacks as cards/compile.ts#baseFace: a face without its own type line has the card's; a face without colors has its color indicator's.
  return faces.map((f) => variantKey({ name: f.name, power: f.power, toughness: f.toughness, colors: f.colors ?? f.color_indicator ?? [], typeLine: f.type_line ?? card.type_line, text: f.oracle_text }));
}

// ---- image slots (design 12.2) ----------------------------------------------------------------------------------------------------------------------

/** One physical card, one picture, two rules faces (the default branch of `imageSlots`): split (CR 709), adventure (CR 715), flip (CR 710), prepare (CR 722). */
export const ONE_PICTURE_LAYOUTS: ReadonlySet<string> = new Set(['split', 'adventure', 'flip', 'prepare']);
/** Two printed sides, each with its own picture: double-faced cards (CR 712), reversible cards, double-faced tokens. */
const TWO_SIDES: ReadonlySet<string> = new Set(['transform', 'modal_dfc', 'reversible_card', 'double_faced_token']);
const TOKEN_LAYOUTS: ReadonlySet<string> = new Set(['token', 'double_faced_token', 'emblem']);

const slot = (key: string, label: string, names: string[]): ImageSlot => ({ key, label, names: [...new Set(names.filter((n) => n !== ''))] });

/**
 * Token slots: one per token variant (the "token, emblem" row of the 12.2 table), so an image binds to the token the engine creates (contract C5).
 * Declared deviations from the table, both because each side or half of a printed token is a token of its own: a double-faced token's sides are keyed by
 * variant (not by bare face name), and a flip-layout token (two Roles printed on one card, one per half) has a slot per Role, labelled by name, where the
 * table gives a flip card one picture. A double-faced token's sides are labelled front and back; a flip card has no back face (CR 710.1).
 */
function tokenSlots(def: CardDef): ImageSlot[] {
  return def.faces.map((f, i) => {
    const key = tokenVariantKey(f);
    const side = def.faces.length > 1 && TWO_SIDES.has(def.layout) ? (i === 0 ? ' (front)' : ' (back)') : '';
    return slot(key, `${tokenBaseName(f.name)}${def.layout === 'emblem' ? '' : ' token'}${side}`, i === 0 ? [key, def.name, f.name] : [key, f.name]);
  });
}

function twoSidedSlots(def: CardDef): ImageSlot[] {
  const same = def.faces[0]!.name === def.faces[1]!.name;
  return def.faces.map((f, i) => {
    const side = i === 0 ? 'front' : 'back';
    // A reversible card may show the same card on both sides: the key is still unique per side, and the bare name resolves to the front.
    const key = same ? `${f.name} (${side})` : f.name;
    return slot(key, `${f.name} (${side})`, i === 0 ? [key, def.name, f.name] : same ? [key] : [f.name]);
  });
}

function meldSlots(def: CardDef): ImageSlot[] {
  // CR 712.4, 701.42: the back of each meld card is half of the melded permanent's picture. A meld pair has three pictures (two fronts, one combined back):
  // a front card has its own front and the combined back, the melded card only the combined picture.
  const own = slot(def.name, def.name, [def.name, ...def.faces.map((f) => f.name)]);
  if (def.meld?.isResult === true || def.meld?.result === undefined) return [own];
  return [own, slot(def.meld.result, `${def.meld.result} (melded back)`, [def.meld.result])];
}

/**
 * The physical image slots of a card (design 12.2): one per printed side, not per rules face. Total: never throws, always at least one slot. A layout the
 * table does not name (normal, saga, class, case, leveler, mutate, prototype, planar, scheme, vanguard, ... and any future one) has one slot every name of
 * the card resolves to.
 */
export const imageSlots: ImageSlots = (def) => {
  if (def.stub) return [slot(def.name, def.name, [def.name])];
  if (def.faces.length > 0 && (TOKEN_LAYOUTS.has(def.layout) || def.isToken)) return tokenSlots(def);
  if (def.layout === 'meld') return meldSlots(def);
  if (TWO_SIDES.has(def.layout) && def.faces.length === 2) return twoSidedSlots(def);
  // One picture (ONE_PICTURE layouts and every single-faced card): "Fire", "Ice" and "Fire // Ice" all resolve to it.
  return [slot(def.name, def.name, [def.name, ...def.faces.map((f) => f.name)])];
};

// ---- Art Series (design 12.2) -------------------------------------------------------------------------------------------------------------------------

/**
 * The real card names an Art Series name depicts, for image matching only (Art Series cards are not game cards and stay out of the index). Scryfall names an
 * Art Series card after the two art cards printed back to back: "Gigantosaurus // Gigantosaurus", "Ajani, Nacatl Pariah // Ajani, Nacatl Avenger".
 */
export function artSeriesNames(name: string): string[] {
  if (typeof name !== 'string') return [];
  const parts = name.split('//').map(squash).map((p) => p.replace(/\s+Art Card$/i, '')).filter((p) => p !== '');
  return [...new Set(parts)];
}
