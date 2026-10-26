/**
 * Qualities for protection and hexproof ("protection from red", "protection from Goblins", "hexproof from monocolored";
 * CR 702.16a, 702.11d). A quality is stored on the keyword ability as a canonical string so the engine never reads Oracle
 * text at runtime:
 *
 *   color:W|U|B|R|G   a color                  type:Artifact      a card type      supertype:Snow    a supertype
 *   color:any         "all colors"             subtype:goblins    a creature (or other) type, plural as printed
 *   multicolored | monocolored | colorless     everything         protection from everything (CR 702.16j)
 *   mv:le:N | mv:ge:N "protection from mana value 3 or less / 3 or greater" (pc-statics-1, CR 702.16a, 202.3: the source's mana value)
 *   player:opponents  "each of your opponents": everything the protected permanent's controller's opponents control (std-rx15, CR 702.16b-f; unverified 702.16k).
 *                     Not a characteristic of the source: `hasQuality` never matches it; rules/protection.ts reads the two controllers.
 *
 * Qualities the engine cannot test (names, counters, "modified", "enemy-colored", ...) parse to null, and the keyword stays manual text.
 */
import type { Color } from '../types/mana';
import { pluralForms } from '../util/plurals';

/** What a quality is tested against: the characteristics of a source (a permanent, a spell on the stack, ...). */
export interface QualityTarget {
  colors: readonly string[];
  types: readonly string[];
  subtypes: readonly string[];
  supertypes: readonly string[];
  /** pc-statics-1: the mana value of the source, for the `mv:` qualities (a source without it never matches one). */
  manaValue?: number;
}

const COLOR_WORDS: Record<string, Color> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const TYPE_PLURALS: Record<string, string> = {
  artifacts: 'Artifact', creatures: 'Creature', enchantments: 'Enchantment', instants: 'Instant', sorceries: 'Sorcery',
  lands: 'Land', planeswalkers: 'Planeswalker', battles: 'Battle',
};
const SUPERTYPE_WORDS: Record<string, string> = { snow: 'Snow', legendary: 'Legendary', basic: 'Basic' };

/**
 * Parse the words after "protection from" / "hexproof from" (one quality; "and from" lists are split by the caller).
 *
 * W3b (guard G2, closed vocabulary, design 6.8): a subtype quality is accepted only when its printed plural is in `subtypes` (lowercase printed plurals,
 * built by the caller from the generated lexicon: rules/ may not import it). Without a vocabulary no subtype quality is accepted (fail closed): before,
 * any capitalized word was a subtype, so "Protection from Zorblaxine" was a full ability that never applies.
 */
export function parseQuality(text: string, subtypes?: ReadonlySet<string>): string | null {
  const t = text.trim().replace(/\.$/, '');
  const lower = t.toLowerCase();
  if (COLOR_WORDS[lower]) return `color:${COLOR_WORDS[lower]}`;
  if (lower === 'multicolored' || lower === 'monocolored' || lower === 'colorless' || lower === 'everything') return lower;
  if (lower === 'all colors' || lower === 'each color') return 'color:any';
  if (lower === 'each of your opponents') return 'player:opponents'; // std-rx15 (CR 702.16b-f)
  if (TYPE_PLURALS[lower]) return `type:${TYPE_PLURALS[lower]}`;
  if (SUPERTYPE_WORDS[lower]) return `supertype:${SUPERTYPE_WORDS[lower]}`;
  // A creature type (or other subtype), written capitalized and in the plural: "Goblins", "Werewolves", "Elk"; one of the vocabulary's (G2)
  const mv = /^mana value (\d+) or (less|greater)$/.exec(lower); // pc-statics-1 (CR 702.16a, 202.3)
  if (mv !== null) return `mv:${mv[2] === 'less' ? 'le' : 'ge'}:${mv[1]}`;
  if (/^[A-Z][a-z]+$/.test(t) && subtypes?.has(lower) === true) return `subtype:${lower}`;
  return null;
}

/** Printed plural forms a subtype can have (M6-8: moved to util/plurals.ts, unchanged, for statics/text-change.ts). */
export { pluralForms };

/** Whether `c` has the quality (CR 702.16a). */
export function hasQuality(c: QualityTarget, quality: string): boolean {
  if (quality === 'everything') return true;
  if (quality === 'multicolored') return c.colors.length >= 2;
  if (quality === 'monocolored') return c.colors.length === 1;
  if (quality === 'colorless') return c.colors.length === 0;
  const i = quality.indexOf(':');
  const kind = quality.slice(0, i);
  const value = quality.slice(i + 1);
  if (kind === 'mv') { // pc-statics-1: "mv:le:3", "mv:ge:3" (CR 702.16a, 202.3)
    const [cmp, n] = value.split(':');
    if (c.manaValue === undefined || n === undefined) return false;
    return cmp === 'le' ? c.manaValue <= Number(n) : cmp === 'ge' ? c.manaValue >= Number(n) : false;
  }
  switch (kind) {
    case 'color': return value === 'any' ? c.colors.length > 0 : c.colors.includes(value);
    case 'type': return c.types.includes(value);
    case 'supertype': return c.supertypes.includes(value);
    case 'subtype': return c.subtypes.some((st) => pluralForms(st).includes(value));
    default: return false;
  }
}

/** Readable form for the log ("red", "goblins"). */
export function qualityText(quality: string): string {
  const i = quality.indexOf(':');
  if (i < 0) return quality;
  const value = quality.slice(i + 1);
  switch (quality.slice(0, i)) {
    case 'color': return value === 'any' ? 'all colors' : ({ W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' } as Record<string, string>)[value] ?? value;
    case 'type': return `${value.toLowerCase()}s`;
    case 'player': return value === 'opponents' ? 'each of your opponents' : value; // std-rx15
    case 'mv': { const [cmp, n] = value.split(':'); return `mana value ${n ?? ''} or ${cmp === 'le' ? 'less' : 'greater'}`; }
    default: return value;
  }
}
