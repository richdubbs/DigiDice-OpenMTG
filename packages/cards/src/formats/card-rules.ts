/**
 * What deck construction reads from one card's Oracle data: basic land (CR 205.4c), the "A deck can have any number of cards named ..." and "up to N cards
 * named ..." exceptions to the copy limit, the front face (CR 712.8a: a double-faced card has only its front face's characteristics outside the game), and
 * color identity (CR 903.4, from Scryfall's `color_identity`, which follows 903.4c-903.4e). Pure functions of the card data.
 */
import type { OracleCard, OracleFace } from '@openmtg/engine';

/** The face whose characteristics the card has outside the game: the front face of a multi-faced card, else the card itself (CR 712.8a). */
export function frontFace(card: OracleCard): OracleFace {
  return card.card_faces?.[0] ?? card;
}

/** Oracle text of every face (copy-limit text may appear on either face). */
function allText(card: OracleCard): string {
  const faces = card.card_faces?.length ? card.card_faces : [card];
  return faces.map((f) => f.oracle_text ?? '').join('\n');
}

/** Type line words before the dash (supertypes and card types) and after it (subtypes), of the front face. */
export function typeWords(card: OracleCard): { types: string[]; subtypes: string[] } {
  const line = frontFace(card).type_line ?? card.type_line ?? '';
  const [left = '', right = ''] = line.split(/\s+[—-]\s+/, 2);
  return { types: left.split(/\s+/).filter(Boolean), subtypes: right.split(/\s+/).filter(Boolean) };
}

/** A basic land card (CR 205.4c: a land with the supertype basic): exempt from the copy limits of CR 100.2a and 903.5b. */
export function isBasicLand(card: OracleCard): boolean {
  const { types } = typeWords(card);
  return types.includes('Basic') && types.includes('Land');
}

export const BASIC_LAND_TYPES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] as const;

/** The basic land types of the card's front face (CR 205.3i). */
export function basicLandTypes(card: OracleCard): string[] {
  const { subtypes } = typeWords(card);
  return BASIC_LAND_TYPES.filter((t) => subtypes.includes(t));
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The card's own copy-limit text: 'any' for "A deck can have any number of cards named <this card>.", a number for "A deck can have up to <N> cards named
 * <this card>." (Seven Dwarves, Nazgûl), 'unknown' when the card has such a sentence the parser cannot read (never guessed), undefined when it has none.
 * These sentences override both the four-copy limit and Commander's singleton rule.
 */
export function deckLimitText(card: OracleCard): 'any' | number | 'unknown' | undefined {
  const text = allText(card);
  if (!/A deck can have /.test(text)) return undefined;
  const names = [card.name, ...(card.card_faces ?? []).map((f) => f.name)].map(escape).join('|');
  if (new RegExp(`A deck can have any number of cards named (?:${names})\\.`).test(text)) return 'any';
  const m = new RegExp(`A deck can have up to (\\w+) cards named (?:${names})\\.`).exec(text);
  if (m) {
    const word = m[1]!.toLowerCase();
    const n = /^\d+$/.test(word) ? Number(word) : NUMBER_WORDS[word];
    if (n !== undefined) return n;
  }
  return 'unknown';
}

/** Color identity (CR 903.4) from Scryfall's `color_identity`; undefined when the data has none (a card cached without it): never assumed colorless. */
export function colorIdentity(card: OracleCard): string[] | undefined {
  return card.color_identity ? [...card.color_identity] : undefined;
}

/** Oracle text lines of the front face without reminder text (CR 207.2), for keyword lines such as "Partner with X" and "Companion — ...". */
export function frontLines(card: OracleCard): string[] {
  const text = frontFace(card).oracle_text ?? card.oracle_text ?? '';
  return text.split('\n').map((l) => l.replace(/\s*\([^)]*\)/g, '').trim()).filter(Boolean);
}

/**
 * A creature card outside the battlefield by its own static ability: "As long as <this> isn't on the battlefield, it's a ... creature ..." (Grist, the
 * Hunger Tide). CR 113.6c: an ability that names the zones it doesn't function in functions everywhere else, even outside the game and before the game
 * begins, so the card is a creature card for deck construction (CR 903.3).
 */
export function isCreatureOutsideBattlefield(card: OracleCard): boolean {
  return frontLines(card).some((l) => /^As long as [^,.]+ isn['’]t on the battlefield, it['’]s an? [^.]*\bcreature\b/i.test(l));
}

/** Has a companion ability (CR 702.139a: "Companion—[Condition]"). */
export function hasCompanion(card: OracleCard): boolean {
  return card.keywords?.includes('Companion') === true || frontLines(card).some((l) => /^Companion\s*[—-]/.test(l));
}
