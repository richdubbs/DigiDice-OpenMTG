/**
 * Faces and the card shell of a CardDef (design 6.1 step 1): type lines (CR 205), mana costs (CR 202, 107), colors (CR 105.2, 202.2, 204), the
 * multi-faced layouts (CR 709 split, 710 flip, 712 double-faced, 715 adventurer, 722 prepare). Owner: WP18 (moved out of cards/compile.ts so the compile
 * pipeline and the legacy compile path share it without an import cycle).
 *
 * Total (contract C1, design 12.1): a mana cost with a symbol CR 107.4 does not define ({D}, {L}, {C/P}) does not throw. The face gets `manaCost: null`
 * and the problem is returned in `badCost`; the pipeline turns it into a manual ability that names the symbol, so the card is playable by hand and the
 * player sees why.
 */
import type { CardDef, CardType, FaceDef, OracleCard, OracleFace, Supertype } from '../types/card';
import { CARD_TYPES, SUPERTYPES } from '../types/card';
import type { Color, ManaCost } from '../types/mana';
import { costColors, parseManaCost, sortColors, toColors } from '../types/mana';

export interface ParsedTypeLine {
  supertypes: Supertype[];
  types: CardType[];
  subtypes: string[];
}

/** Parse a type line such as "Legendary Creature — Human Wizard" (CR 205). */
export function parseTypeLine(typeLine: string): ParsedTypeLine {
  const [left = '', right = ''] = typeLine.split(/\s+[—-]\s+/, 2);
  const supertypes: Supertype[] = [];
  const types: CardType[] = [];
  for (const word of left.trim().split(/\s+/)) {
    if (!word) continue;
    if ((SUPERTYPES as readonly string[]).includes(word)) supertypes.push(word as Supertype);
    else if ((CARD_TYPES as readonly string[]).includes(word)) types.push(word as CardType);
    else if (word === 'Tribal') types.push('Kindred'); // old name of kindred (CR 308)
  }
  const words = right.trim() ? right.trim().split(/\s+/) : [];
  const subtypes: string[] = [];
  for (let i = 0; i < words.length; i++) {
    // CR 205.3m: "Time Lord" is the only two-word creature type.
    if (words[i] === 'Time' && words[i + 1] === 'Lord') { subtypes.push('Time Lord'); i++; continue; }
    subtypes.push(words[i]!);
  }
  return { supertypes, types, subtypes };
}

/** Layouts whose Scryfall `card_faces` are separate rules faces. Meld pieces are other cards, not faces (CR 712.4). */
export const MULTI_FACE_LAYOUTS: ReadonlySet<string> = new Set(['split', 'flip', 'transform', 'modal_dfc', 'adventure', 'prepare', 'double_faced_token', 'reversible_card', 'art_series']);

/** A mana cost the engine could not read (CR 107.4 has no such symbol). */
export interface BadCost {
  text: string;
  message: string;
}

export type FaceBase = Omit<FaceDef, 'abilities'>;

/** Never throws: an unknown symbol gives `null` and the reason (contract C1). */
function readCost(text: string | undefined): { cost: ManaCost | null; bad?: BadCost } {
  try {
    return { cost: parseManaCost(text) };
  } catch (e) {
    return { cost: null, bad: { text: text ?? '', message: e instanceof Error ? e.message : String(e) } };
  }
}

const str = (x: unknown): string => (typeof x === 'string' ? x : '');
const strs = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);

/** Colors from Scryfall letters, ignoring anything that is not W, U, B, R or G. */
function colorsOf(x: unknown): ReturnType<typeof toColors> {
  return toColors(strs(x).filter((c) => ['W', 'U', 'B', 'R', 'G'].includes(c)));
}

export function baseFace(src: OracleFace, card: OracleCard, inheritColors: boolean): { face: FaceBase; bad?: BadCost } {
  const typeLine = str(src.type_line) || str(card.type_line);
  const t = parseTypeLine(typeLine);
  const read = readCost(typeof src.mana_cost === 'string' ? src.mana_cost : undefined);
  const manaCost = read.cost;
  const colorIndicator = src.color_indicator ? colorsOf(src.color_indicator) : undefined;
  const fromCost = (): ReturnType<typeof toColors> => sortColors([...costColors(manaCost), ...(colorIndicator ?? [])]);
  let colors = src.colors ? colorsOf(src.colors) : inheritColors && card.colors ? colorsOf(card.colors) : fromCost();
  // Split halves have their own colors from their own cost (CR 709.3), even though Scryfall lists the union at top level.
  if (card.layout === 'split' || card.layout === 'adventure' || card.layout === 'prepare' || card.layout === 'flip') {
    colors = src.colors ? colorsOf(src.colors) : fromCost();
  }
  const face: FaceBase = {
    name: str(src.name) || str(card.name),
    manaCost,
    typeLine,
    supertypes: t.supertypes,
    types: t.types,
    subtypes: t.subtypes,
    oracleText: str(src.oracle_text),
    colors,
    keywords: strs(card.keywords),
  };
  if (typeof src.power === 'string') face.power = src.power;
  if (typeof src.toughness === 'string') face.toughness = src.toughness;
  if (typeof src.loyalty === 'string') face.loyalty = src.loyalty;
  if (typeof src.defense === 'string') face.defense = src.defense;
  if (colorIndicator) face.colorIndicator = colorIndicator;
  const proto = prototypeOf(face.oracleText);
  if (proto) face.prototype = proto;
  return read.bad ? { face, bad: read.bad } : { face };
}

/**
 * M6-6 (CR 718.1-718.2, 702.160): the alternative mana cost, power and toughness of a prototype card, from its "Prototype {M} -- P/T" line (Scryfall has no field
 * for them). Undefined for every other face, and for a line whose cost or numbers can't be read (the card is then cast only normally: never a wrong prototype).
 */
export function prototypeOf(oracleText: string): FaceDef['prototype'] | undefined {
  const m = /^Prototype ((?:\{[^}]+\})+) ?(?:—|--?) ?(\d+)\/(\d+)/m.exec(oracleText);
  if (!m) return undefined;
  const read = readCost(m[1]);
  return read.cost ? { manaCost: read.cost, power: m[2]!, toughness: m[3]! } : undefined;
}

export interface CardFaces {
  multi: boolean;
  faces: FaceBase[];
  /** Per face, a mana cost the engine could not read. */
  badCosts: (BadCost | undefined)[];
}

/** One FaceBase per rules face, in printed order. */
export function buildFaces(card: OracleCard): CardFaces {
  const multi = MULTI_FACE_LAYOUTS.has(card.layout) && Array.isArray(card.card_faces) && card.card_faces.length > 1;
  const rawFaces: OracleFace[] = multi ? card.card_faces! : [card];
  const badCosts: (BadCost | undefined)[] = [];
  const faces = rawFaces.map((f, i) => {
    const { face, bad } = baseFace(f, card, !multi);
    if (multi && card.layout === 'flip' && i > 0) {
      // CR 710.1c: a flip card's color and mana cost don't change if the permanent is flipped.
      // Scryfall's flipped half has neither `colors` nor a mana cost, so take both from the unflipped half.
      const front = rawFaces[0]!;
      face.colors = card.colors ? colorsOf(card.colors) : colorsOf(front.colors);
      const read = readCost(typeof front.mana_cost === 'string' ? front.mana_cost : undefined);
      face.manaCost = read.cost;
      badCosts.push(read.bad);
      return face;
    }
    badCosts.push(bad);
    return face;
  });
  return { multi, faces, badCosts };
}

/**
 * M11-4 (m11 design D5, 4.2): the card's color identity, CR 903.4, copied from Scryfall's `color_identity` (which applies CR 903.4c-e: no reminder text, back
 * faces and alternative characteristics included) in WUBRG order. Never computed from the engine's own reading of the text: undefined when the data has no
 * identity or holds anything that is not one of the five colors (a commander with an unknown identity resolves "your commander's color identity" by hand).
 */
export function colorIdentityOf(card: OracleCard): Color[] | undefined {
  const raw: unknown = card.color_identity;
  if (!Array.isArray(raw) || !raw.every((c) => typeof c === 'string')) return undefined;
  const colors = toColors(raw as string[]);
  return colors.length === new Set(raw).size ? colors : undefined;
}

/** Everything of a CardDef except the faces' abilities and the automation. */
export function cardShell(card: OracleCard): Omit<CardDef, 'faces' | 'automation'> {
  const name = str(card.name);
  const shell: Omit<CardDef, 'faces' | 'automation'> = {
    id: name,
    name,
    layout: card.layout,
    isToken: card.layout === 'token' || card.layout === 'double_faced_token' || /\bToken\b/.test(str(card.type_line)),
  };
  if (typeof card.oracle_id === 'string') shell.oracleId = card.oracle_id;
  const identity = colorIdentityOf(card);
  if (identity !== undefined) shell.colorIdentity = identity;
  const parts = Array.isArray(card.all_parts) ? card.all_parts : [];
  const tokens = parts.filter((p) => p.component === 'token' && p.name !== name).map((p) => p.name);
  if (tokens.length) shell.tokenNames = [...new Set(tokens)];
  if (card.layout === 'meld') {
    const result = parts.find((p) => p.component === 'meld_result');
    const isResult = result?.name === name;
    const partner = parts.find((p) => p.component === 'meld_part' && p.name !== name);
    shell.meld = { isResult };
    if (result && !isResult) shell.meld.result = result.name;
    if (partner && !isResult) shell.meld.partner = partner.name;
  }
  return shell;
}
