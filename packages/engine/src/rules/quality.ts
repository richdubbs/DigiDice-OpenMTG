/**
 * Qualities for protection and hexproof ("protection from red", "protection from Goblins", "hexproof from monocolored";
 * CR 702.16a, 702.11d). A quality is stored on the keyword ability as a canonical string so the engine never reads Oracle
 * text at runtime:
 *
 *   color:W|U|B|R|G   a color                  type:Artifact      a card type      supertype:Snow    a supertype
 *   color:any         "all colors"             subtype:goblins    a creature (or other) type, plural as printed
 *   multicolored | monocolored | colorless     everything         protection from everything (CR 702.16j)
 *   mv:le:N | mv:ge:N "protection from mana value 3 or less / 3 or greater" (pc-statics-1, CR 702.16a, 202.3: the source's mana value)
 *   ability            "hexproof from activated and triggered abilities" (edh-top-9, Volatile Stormdrake; CR 702.11d): the source is an ability on the stack
 *   spell | castThisTurn  "protection from spells", "protection from permanents that were cast this turn" (edh-mana-keywords-10, Emrakul, the World Anew; CR 702.16a)
 *   A&B&!C            edhv31 (Harbinger of Spring, Tsabo Tavoc; CR 702.16a): every part must hold, a part starting with `!` must not: "legendary creatures" is
 *                     `type:Creature&supertype:Legendary`, "non-Spirit creatures" is `type:Creature&!subtype:spirits`; edh-c-54 (Devoted Caretaker): "instant spells" is `spell&type:Instant`.
 *   counter:<kind>    "protection from permanents with corruption counters on them" (edh-next-88, Geyadrone Dihada; CR 122.1, 702.16a): a source that has a counter of that kind on it now
 *   ringBearer        "protection from Ring-bearers": sources that are the Ring-bearer of a player (edh-replace-6, Lord of the Nazgûl; CR 701.54e, 702.16a)
 *   A&B&!C            edhv31 (Harbinger of Spring, Tsabo Tavoc; CR 702.16a): every part must hold, a part starting with `!` must not: "legendary creatures" is
 *                     `type:Creature&supertype:Legendary`, "non-Spirit creatures" is `type:Creature&!subtype:spirits`.
 *   opp:type:Creature "protection from creatures your opponents control" (edh-c-49, Crypsis; CR 702.16a): a source of the type whose controller is an opponent of the protected permanent's controller.
 *                     Like player:opponents it needs both controllers: `hasQuality` tests only the type half; rules/protection.ts adds the controllers.
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
  /** edh-mana-keywords-10 (CR 111.1, 601.2a): the source is a spell (an object on the stack that is not an ability), for the `spell` quality. */
  isSpell?: boolean;
  /** edh-top-9 (CR 113.1, 702.11d): the source is an activated or triggered ability (an ability object on the stack), for the `ability` quality. */
  isAbility?: boolean;
  /** edh-mana-keywords-10 (CR 601.2a, 608.3): the source is a permanent that was cast this turn (not put onto the battlefield some other way), for the `castThisTurn` quality. */
  castThisTurn?: boolean;
  /** edh-replace-6 (CR 701.54e): the source is a permanent that is a player's Ring-bearer now, for the `ringBearer` quality. */
  ringBearer?: boolean;
  /** edh-next-88 (CR 122.1, 702.16a; Geyadrone Dihada): the kinds of counter the source has on it now (a permanent on the battlefield), for the `counter:<kind>` quality; absent = none known. */
  counterKinds?: readonly string[];
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
  { const o = /^(artifacts|creatures|enchantments|lands|planeswalkers|battles) your opponents control$/.exec(lower); if (o !== null) return `opp:type:${TYPE_PLURALS[o[1]!]}`; } // edh-c-49 (CR 702.16a)
  if (lower === 'each of your opponents') return 'player:opponents'; // std-rx15 (CR 702.16b-f)
  if (lower === 'activated and triggered abilities') return 'ability'; // edh-top-9 (CR 702.11d, 113.1)
  if (lower === 'spells') return 'spell'; // edh-mana-keywords-10 (CR 702.16a, 111.1): sources that are spells
  { const m = /^(instant|sorcery|creature|artifact|enchantment|planeswalker|battle) spells$/.exec(lower); if (m !== null) return `spell&type:${m[1]!.charAt(0).toUpperCase()}${m[1]!.slice(1)}`; } // edh-c-54 (CR 702.16a, 111.1, 205.2): the composite `spell&type:X`
  if (lower === 'ring-bearers') return 'ringBearer'; // edh-replace-6 (CR 701.54e, 702.16a)
  if (lower === 'permanents that were cast this turn') return 'castThisTurn'; // edh-mana-keywords-10 (CR 702.16a, 601.2a)
  if (TYPE_PLURALS[lower]) return `type:${TYPE_PLURALS[lower]}`;
  if (SUPERTYPE_WORDS[lower]) return `supertype:${SUPERTYPE_WORDS[lower]}`;
  // A creature type (or other subtype), written capitalized and in the plural: "Goblins", "Werewolves", "Elk"; one of the vocabulary's (G2)
  // edhv31 (CR 702.16a, 205.3, 205.4): "legendary creatures", "non-Spirit creatures": a creature that has (or lacks) the supertype / creature type
  if (lower === 'legendary creatures') return 'type:Creature&supertype:Legendary';
  const nonType = /^non-?([a-z]+) creatures$/.exec(lower);
  if (nonType !== null && /^[A-Z]/.test(t.replace(/^non-?/i, '')) && subtypes?.has(`${nonType[1]}s`) === true) return `type:Creature&!subtype:${nonType[1]}s`;
  // edh-d-5 (CR 702.16a, 205.3m; Sigrid, God-Favored): "protection from God creatures": a creature that has the creature type (one of the vocabulary's plurals, G2)
  { const sc = /^([A-Z][a-z]+) creatures$/.exec(t); if (sc !== null && subtypes?.has(`${sc[1]!.toLowerCase()}s`) === true) return `type:Creature&subtype:${sc[1]!.toLowerCase()}s`; }
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
  if (quality === 'spell') return c.isSpell === true; // edh-mana-keywords-10
  if (quality === 'ability') return c.isAbility === true; // edh-top-9
  if (quality === 'castThisTurn') return c.castThisTurn === true;
  if (quality === 'ringBearer') return c.ringBearer === true; // edh-replace-6
  if (quality === 'multicolored') return c.colors.length >= 2;
  if (quality === 'monocolored') return c.colors.length === 1;
  if (quality === 'colorless') return c.colors.length === 0;
  if (quality.includes('&')) return quality.split('&').every((part) => (part.startsWith('!') ? !hasQuality(c, part.slice(1)) : hasQuality(c, part))); // edhv31
  const i = quality.indexOf(':');
  const kind = quality.slice(0, i);
  const value = quality.slice(i + 1);
  if (kind === 'mv') { // pc-statics-1: "mv:le:3", "mv:ge:3" (CR 702.16a, 202.3)
    const [cmp, n] = value.split(':');
    if (c.manaValue === undefined || n === undefined) return false;
    return cmp === 'le' ? c.manaValue <= Number(n) : cmp === 'ge' ? c.manaValue >= Number(n) : false;
  }
  switch (kind) {
    case 'counter': return c.counterKinds?.includes(value) === true; // edh-next-88 (CR 122.1, 702.16a)
    case 'color': return value === 'any' ? c.colors.length > 0 : c.colors.includes(value);
    case 'type': return c.types.includes(value);
    case 'supertype': return c.supertypes.includes(value);
    case 'subtype': return c.subtypes.some((st) => pluralForms(st).includes(value));
    default: return false;
  }
}

/** Readable form for the log ("red", "goblins"). */
export function qualityText(quality: string): string {
  if (quality === 'spell') return 'spells'; // edh-mana-keywords-10
  if (quality === 'ability') return 'activated and triggered abilities'; // edh-top-9
  if (quality === 'castThisTurn') return 'permanents that were cast this turn';
  if (quality === 'ringBearer') return 'Ring-bearers'; // edh-replace-6
  const spellOf = /^spell&type:(.+)$/.exec(quality);
  if (spellOf !== null) return `${spellOf[1]!.toLowerCase()} spells`; // edh-c-54
  if (quality === 'type:Creature&supertype:Legendary') return 'legendary creatures'; // edhv31
  const typedCreature = /^type:Creature&subtype:([a-z]+)s$/.exec(quality);
  if (typedCreature !== null) return `${typedCreature[1]!.replace(/^./, (ch) => ch.toUpperCase())} creatures`; // edh-d-5
  const nonCreature = /^type:Creature&!subtype:(.+)$/.exec(quality);
  if (nonCreature !== null) return `non-${nonCreature[1]!.replace(/^./, (ch) => ch.toUpperCase()).replace(/s$/, '')} creatures`; // edhv31
  const i = quality.indexOf(':');
  if (i < 0) return quality;
  const value = quality.slice(i + 1);
  switch (quality.slice(0, i)) {
    case 'color': return value === 'any' ? 'all colors' : ({ W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' } as Record<string, string>)[value] ?? value;
    case 'type': return `${value.toLowerCase()}s`;
    case 'opp': return `${qualityText(value)} your opponents control`; // edh-c-49
    case 'counter': return `permanents with ${value} counters on them`; // edh-next-88
    case 'player': return value === 'opponents' ? 'each of your opponents' : value; // std-rx15
    case 'mv': { const [cmp, n] = value.split(':'); return `mana value ${n ?? ''} or ${cmp === 'le' ? 'less' : 'greater'}`; }
    default: return value;
  }
}
