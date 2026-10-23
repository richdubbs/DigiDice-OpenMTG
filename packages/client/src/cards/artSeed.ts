/**
 * Seeds and classification for the frame's procedural art (CardArt.tsx). Pure and deterministic: the same card name always paints the same picture.
 *
 * Nothing here is official art: the art box is drawn from a hash of the card's name, its colors and its types (ARCHITECTURE.md "Card images" A).
 */
import type { Color } from '@openmtg/engine';

/** FNV-1a, 32 bit: a small string hash. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small seeded generator returning [0, 1). */
export function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The card types the art and the type emblem tell apart. */
export type ArtType = 'creature' | 'instant' | 'sorcery' | 'enchantment' | 'artifact' | 'planeswalker' | 'battle' | 'land';

const TYPE_WORDS: ReadonlyArray<readonly [ArtType, RegExp]> = [
  ['planeswalker', /\bPlaneswalker\b/],
  ['battle', /\bBattle\b/],
  ['creature', /\bCreature\b/],
  ['land', /\bLand\b/],
  ['artifact', /\bArtifact\b/],
  ['enchantment', /\bEnchantment\b/],
  ['instant', /\bInstant\b/],
  ['sorcery', /\bSorcery\b/],
];

/** Every art type named in a type line (a card can be several). */
export function artTypesOf(typeLine: string): ArtType[] {
  return TYPE_WORDS.filter(([, re]) => re.test(typeLine)).map(([t]) => t);
}

/** The one type a card's emblem shows: the first match in the order planeswalker, battle, creature, land, artifact, enchantment, instant, sorcery. */
export function emblemTypeOf(typeLine: string): ArtType {
  if (/\bEmblem\b/.test(typeLine)) return 'enchantment';
  return artTypesOf(typeLine)[0] ?? 'enchantment';
}

const BASIC_COLOR: Record<string, Color> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };
const ORDER: readonly Color[] = ['W', 'U', 'B', 'R', 'G'];

/**
 * The colors a land is drawn in: its basic land types (CR 305.6) and the colors of mana its rules text mentions. A land has no color of its own (CR 202.2),
 * so this only picks the scenery.
 */
export function landColorsOf(typeLine: string, oracleText: string): Color[] {
  const out = new Set<Color>();
  for (const [word, c] of Object.entries(BASIC_COLOR)) if (new RegExp(`\\b${word}\\b`).test(typeLine)) out.add(c);
  for (const m of oracleText.matchAll(/\{([WUBRG])(?:\/[WUBRGP])?\}/g)) out.add(m[1] as Color);
  return ORDER.filter((c) => out.has(c));
}

/** Rules text length class: the art box gives room to long rules text (the frame's text shrinks, too). */
export type TextLen = 'none' | 'short' | 'mid' | 'long' | 'xl';

export function textLenOf(text: string): TextLen {
  const n = text.trim().length;
  if (n === 0) return 'none';
  if (n <= 45) return 'short';
  if (n <= 130) return 'mid';
  if (n <= 230) return 'long';
  return 'xl';
}
