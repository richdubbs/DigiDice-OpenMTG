/**
 * Keyword abilities as text (WP2): "Flying", "Kicker {2}{G}", "Protection from red", "Enchant creature", "Ward--Pay 3 life". Reminder text is never
 * printed (CR 207.2); the renderer reads the keyword's parameters only.
 */
import type { KeywordAbilityDef } from '../types/ability';
import { K } from './kernel';
import type { RenderState } from './state';
import { alt, capFirst, joinList, NoRenderer, pluralize } from './text';

const COLOR: Record<string, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };

/** The canonical quality string of rules/quality.ts as words: "color:R" -> "red", "subtype:goblins" -> "Goblins". */
export function qualityWords(quality: string): string {
  if (quality === 'ownColors') return 'each of its colors'; // std-rg (hexproof only)
  const i = quality.indexOf(':');
  if (i < 0) return quality;
  const value = quality.slice(i + 1);
  switch (quality.slice(0, i)) {
    case 'color': return value === 'any' ? alt('all colors', 'each color') : (COLOR[value] ?? value); // r3-choose, CMD2: "protection from each color" (CR 702.16a, 105.1; Akroma's Will)
    case 'type': return pluralize(value.toLowerCase()); // FAST5 T45: "protection from instants and from sorceries"
    case 'supertype': return `${value.toLowerCase()} permanents`;
    case 'subtype': return value.charAt(0).toUpperCase() + value.slice(1);
    case 'chosen': return `the chosen ${value}`; // MX2 (additive): "protection from the chosen color" (CR 607.2d)
    case 'player': return value === 'opponents' ? 'each of your opponents' : quality; // std-rx15 (CR 702.16b-f): "protection from each of your opponents"
    case 'mv': { const [cmp, n] = value.split(':'); return `mana value ${n ?? ''} or ${cmp === 'le' ? 'less' : 'greater'}`; } // pc-statics-1 (CR 702.16a, 202.3)
    default: return value;
  }
}

/** A cost that is only mana is written after a space ("Kicker {2}{G}"); any other cost after a dash ("Ward--Pay 3 life"). */
function costText(k: KeywordAbilityDef, st: RenderState): { text: string; manaOnly: boolean } | null {
  if (!k.cost) return null;
  const c = k.cost;
  const manaOnly = c.tap !== true && c.untap !== true && c.loyalty === undefined && (c.other?.length ?? 0) === 0;
  return { text: K.cost(c, st), manaOnly };
}

const LANDWALK_SUPER: ReadonlySet<string> = new Set(['nonbasic', 'basic', 'legendary', 'snow', 'artifact']);

function landwalk(quality: string): string {
  const words = quality.split(' ').filter((w) => w !== '');
  if (words.length === 0) return 'landwalk';
  const last = words[words.length - 1]!;
  if (last === 'land') return `${words.join(' ')}walk`;
  // FAST4 T33 (CR 702.14c): a quality that is no land type, "nonbasic landwalk", "legendary landwalk" (keywords/hooks/landwalk.ts reads these words)
  if (LANDWALK_SUPER.has(last)) return `${words.join(' ')} landwalk`;
  return [...words.slice(0, -1), `${last}walk`].join(' ');
}

/** cmd1 (CR 702.124i): the [text] of "Partner--[text]" as the Keyword hole reads it (holes/misc.ts#partnerText): lower-case words, "&" between two of them. */
const PARTNER_TEXT = /^[a-z][a-z'-]*(( | & )[a-z][a-z'-]*)*$/;

/**
 * std-craft-1 (CR 702.167a, 118.3): "Craft with a Dinosaur, a Merfolk, a Pirate, and a Vampire {4}": a list of different materials. The instance has no `filter`;
 * its cost holds one material part per listed material (an exile of one permanent you control or card from your graveyard, `orGraveyard`), so each is a
 * different object (rules/cost-pick.ts#findAssignment), and keywords/data/craft.json adds no material part of its own. Null for any other craft instance.
 */
function craftListWords(k: KeywordAbilityDef, st: RenderState): string | null {
  const c = k.cost;
  if (k.filter !== undefined || c === undefined || (c.other?.length ?? 0) === 0) return null;
  if (k.amount !== undefined || k.quality !== undefined || c.tap === true || c.untap === true || c.loyalty !== undefined || c.mana === undefined) throw new NoRenderer('craft with listed materials and another parameter');
  const parts = c.other!;
  if (parts.length < 2 || !parts.every((x) => x.kind === 'exileFrom' && x.zone === 'battlefield' && x.orGraveyard === true && x.count === 1 && x.self !== true && x.atLeast === undefined && x.filter !== undefined)) {
    throw new NoRenderer('craft with materials that are not one listed object each');
  }
  const names = parts.map((x) => K.np((x as { filter: NonNullable<KeywordAbilityDef['filter']> }).filter, st, { det: 'a' }));
  return `craft with ${joinList(names)} ${K.cost({ mana: c.mana }, st)}`;
}

/** FAST5X E13: the `quality` of a craft instance whose materials are "N or more" (CR 702.167a, keywords/data/craft.json). */
export const CRAFT_OR_MORE = 'or more';

/**
 * FAST5X E13, CR 702.167a: "Craft with [materials] [cost]": "artifact" (one, no article), "two creatures" (`amount`), "one or more Dinosaurs" and "one or more"
 * (`amount` with the quality "or more"; no noun = any objects). The cost is mana only on every printed craft card; anything else is refused.
 */
function craftWords(k: KeywordAbilityDef, st: RenderState): string {
  const listed = craftListWords(k, st);
  if (listed !== null) return listed;
  const cost = costText(k, st);
  if (!cost || !cost.manaOnly) throw new NoRenderer('craft without a mana cost');
  const f = k.filter ?? {};
  const empty = Object.values(f).every((v) => v === undefined);
  const n = k.amount;
  if (n !== undefined && typeof n !== 'number') throw new NoRenderer('craft with a computed number of materials');
  let materials: string;
  if (k.quality === CRAFT_OR_MORE) {
    if (n === undefined) throw new NoRenderer('craft with "or more" materials and no number');
    // std-craft-2 (CR 702.167b; The Enigma Jewel): nonland permanents and cards that have an activated ability are "nonlands with activated abilities"
    const nonlandsActivated = Object.keys(f).length === 2 && f.notTypes?.length === 1 && f.notTypes[0] === 'Land' && f.hasAbility === 'activated';
    materials = `${numWordOf(n)} or more${empty ? '' : ` ${nonlandsActivated ? 'nonlands with activated abilities' : K.np(f, st, { det: 'none', plural: true })}`}`;
  } else if (k.quality !== undefined) {
    throw new NoRenderer(`craft with the quality ${k.quality}`);
  } else if (empty) {
    throw new NoRenderer('craft with materials that have no quality');
  } else if (n !== undefined) {
    if (n < 2) throw new NoRenderer('craft with a number of materials below two');
    materials = `${numWordOf(n)} ${K.np(f, st, { det: 'none', plural: true })}`;
  } else {
    materials = K.np(f, st, { det: 'none' });
  }
  return `craft with ${materials} ${cost.text}`;
}

/** The gate compares numbers as digits ("two" and "2" are one word for it), so the count is written as a digit. */
const numWordOf = (n: number): string => String(n);

/**
 * PUSH1 T1. CR 702.29e: "[Type]cycling [cost]": the type is written in front of "cycling" as one word ("swampcycling", "basic landcycling"). The search
 * filter of the typecycling expansion (keywords/data/typecycling.json) says the type; only the forms Oracle prints are written (one subtype, "land",
 * "basic land"), anything else has no wording.
 */
function typecycling(f: KeywordAbilityDef['filter']): string {
  const { zone, types, supertypes, subtypes, ...rest } = f ?? {};
  if (zone !== 'library' || Object.keys(rest).length > 0) throw new NoRenderer('typecycling with a filter that is not a type of library card');
  if (subtypes?.length === 1 && types === undefined && supertypes === undefined) return `${subtypes[0]!.toLowerCase()}cycling`;
  if (subtypes === undefined && types?.length === 1 && types[0] === 'Land') {
    if (supertypes === undefined) return 'landcycling';
    if (supertypes.length === 1 && supertypes[0] === 'Basic') return 'basic landcycling';
  }
  throw new NoRenderer('typecycling with a type Oracle does not print');
}

/** The keyword in lower case, as it appears in a list ("flying", "protection from red"). */
export function keywordWords(k: KeywordAbilityDef, st: RenderState): string {
  const name = k.keyword;
  // the keyword name is the one free string printed as it is: letters, spaces and hyphens only (CR 702), so "drain {1}{b}. you win the game" is no keyword;
  // a name may end in "!" (start your engines!, CR 702.179; For Mirrodin!, CR 702.163); cmd1: or hold a possessive ("doctor's companion", CR 702.124m)
  if (typeof name !== 'string' || !/^[a-z][a-z -]*('s [a-z][a-z -]*)?!?$/i.test(name)) throw new NoRenderer(`keyword name ${String(name)}`);
  // cmd1 (CR 702.124i): "Partner--Friends forever": the partner ability whose [text] two commanders must share; the text is a label and nothing else
  if (name === 'partner' && k.quality !== undefined) {
    if (!PARTNER_TEXT.test(k.quality) || k.cost !== undefined || k.amount !== undefined || k.filter !== undefined) throw new NoRenderer('partner with a text that is not words');
    return `partner--${k.quality}`;
  }
  if (name === 'protection') {
    if (k.quality !== undefined) return `protection from ${qualityWords(k.quality)}`;
    if (k.filter) return `protection from ${K.np(k.filter, st, { det: 'none', plural: true })}`;
    return 'protection';
  }
  if (name === 'hexproof' && k.quality !== undefined) return `hexproof from ${qualityWords(k.quality)}`;
  // M11-4 (CR 702.124j): "Partner with Toothy, Imaginary Friend": the one name its enters trigger searches for (keywords/data/partner-with.json), nothing else
  if (name === 'partner with') {
    const f = k.filter;
    if (f === undefined || typeof f.name !== 'string' || Object.keys(f).some((x) => x !== 'name') || k.cost !== undefined || k.amount !== undefined || k.quality !== undefined) {
      throw new NoRenderer('partner with anything but one card name');
    }
    return `partner with ${f.name}`;
  }
  if (name === 'landwalk') return landwalk(k.quality ?? '');
  if (name === 'craft') return craftWords(k, st); // FAST5X E13 (CR 702.167a)
  if (name === 'enchant') {
    if (k.player) return k.player === 'any' ? 'enchant player' : k.player === 'opponent' ? 'enchant opponent' : 'enchant you';
    // FAST2 T7: "Enchant creature or Vehicle" (CR 702.5a): a card type or ONE subtype
    const or = typeOrSubtype(k.filter);
    if (or !== null) return `enchant ${or}`;
    return `enchant ${k.filter ? K.np(k.filter, st, { det: 'none' }) : 'permanent'}`;
  }
  // FAST2 T7: "Equip Wizard {1}" (CR 702.6c): the creature you control must have the quality; only ONE subtype is said this way
  const equipSub = name === 'equip' && k.filter !== undefined ? equipQuality(k.filter) : null;
  if (equipSub !== null) {
    const cost = costText(k, st);
    if (!cost || !cost.manaOnly || k.amount !== undefined || k.quality !== undefined) throw new NoRenderer('equip [quality] without a mana cost');
    return `equip ${equipSub} ${cost.text}`;
  }
  const parts: string[] = [name === 'typecycling' ? typecycling(k.filter) : name];
  // std-rx24 (CR 702.72a): "Champion a Faerie", "Champion an Elemental", "Champion a Goblin or Shaman": the object with its article
  if (k.filter && name !== 'typecycling') parts.push(name === 'affinity' ? `for ${K.np(k.filter, st, { det: 'none', plural: true })}` : K.np(k.filter, st, { det: name === 'champion' ? 'a' : 'none' }));
  if (k.quality !== undefined) parts.push(qualityWords(k.quality));
  // r4-fxb (CR 702.189a, 107.3): "Firebending X, where X is ~'s power": an amount that is a stated quantity (not a number, not an announced X), only without
  // a cost, quality or filter
  const stated = hasStatedAmount(k);
  if (stated && (k.cost !== undefined || k.quality !== undefined || k.filter !== undefined)) throw new NoRenderer('a stated keyword amount with another parameter');
  if (stated) return `${parts.join(' ')} x, where x is ${K.qty(k.amount!, st)}`;
  if (k.amount !== undefined) parts.push(K.qty(k.amount, st));
  const cost = costText(k, st);
  const head = parts.join(' ');
  if (!cost) return head;
  // "Kicker {2}", "Suspend 3--{R}" (an amount and a cost), "Ward--Pay 3 life"
  return cost.manaOnly && k.amount === undefined ? `${head} ${cost.text}` : `${head}--${cost.text}`;
}

/** CLOUD std-msh: the creature an "Equip worthy" ability may attach to (the quality its card defines in its reminder text). */
const WORTHY = { types: ['Creature'], supertypes: ['Legendary'], notSubtypes: ['Villain'], colors: ['R', 'W'], controller: 'you' };
/** A filter as JSON with its keys sorted and its lists of words sorted (the order of the fields and of a list of colors says nothing, design 3.3). */
const sortedJson = (f: object): string => JSON.stringify(Object.entries(f).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, Array.isArray(v) ? [...v].sort() : v]));

/** FAST2 T7: `{types:['Creature'], subtypes:[S], controller:'you'}`, the filter of "Equip S" (CR 702.6c), as the subtype S; null for any other filter. */
function equipQuality(f: NonNullable<KeywordAbilityDef['filter']>): string | null {
  const keys = Object.keys(f).filter((x) => (f as Record<string, unknown>)[x] !== undefined).sort().join(',');
  // CLOUD std-msh (CR 702.6c): "Equip worthy {1}" (Mjolnir, Hammer of Thor; its reminder text: "A creature is worthy if it's a legendary non-Villain that's red
  // and/or white"): exactly that quality of a creature you control (parser/templates/zz-cloud/std-msh.json kw.stdmsh.equip.worthy)
  if (sortedJson(f) === sortedJson(WORTHY)) return 'worthy';
  // CMD2 (CR 702.6c, 903.3d): "Equip commander {3}": the creature you control must be a commander
  // edh-mana-keywords-1 (CR 702.6c, 205.4): "Equip legendary creature {3}": a legendary creature you control
  if (keys === 'controller,supertypes,types' && f.controller === 'you' && f.supertypes?.length === 1 && f.supertypes[0] === 'Legendary' && f.types?.length === 1 && f.types[0] === 'Creature') return 'legendary creature';
  if (keys === 'commander,controller,types' && f.commander === true && f.controller === 'you' && f.types?.length === 1 && f.types[0] === 'Creature') return 'commander';
  if (keys !== 'controller,subtypes,types' || f.controller !== 'you') return null;
  if (f.types?.length !== 1 || f.types[0] !== 'Creature' || f.subtypes?.length !== 1) return null;
  return f.subtypes[0]!;
}

/** FAST2 T7: `{anyOf: [{types:[T]}, {subtypes:[S]}]}` as "t or S" ("creature or Vehicle"); null for any other filter. */
function typeOrSubtype(f: KeywordAbilityDef['filter']): string | null {
  if (f === undefined || Object.keys(f).length !== 1 || f.anyOf?.length !== 2) return null;
  const [a, b] = f.anyOf as [Record<string, unknown>, Record<string, unknown>];
  const only = (x: Record<string, unknown>, key: string): string | null => {
    const v = x[key];
    return Object.keys(x).length === 1 && Array.isArray(v) && v.length === 1 && typeof v[0] === 'string' ? v[0] : null;
  };
  const type = only(a, 'types');
  const sub = only(b, 'subtypes');
  return type !== null && sub !== null ? `${type.toLowerCase()} or ${sub}` : null;
}

/** A cost that is not only mana is written after a dash and the line ends with a period (CR 702.21 ward, 702.138 escape). */
// std-craft-1 (CR 702.167a): craft's listed materials are parts of its cost (craftListWords), never a dash cost
export const hasDashCost = (k: KeywordAbilityDef): boolean => k.keyword !== 'craft' && k.cost !== undefined && (k.cost.tap === true || k.cost.untap === true || k.cost.loyalty !== undefined || (k.cost.other?.length ?? 0) > 0);

/** "Flying", "Kicker {2}{G}": the line of a keyword ability. */
export function keywordLine(k: KeywordAbilityDef, st: RenderState): string {
  const line = capFirst(keywordWords(k, st));
  // r4-cost (CR 601.2f, 602.2b, 702.6a): "Equip {4}. This ability costs {1} less to activate for each color of the creature it targets."
  if (k.costChange !== undefined) {
    if (k.limit !== undefined || k.costChange.kind === 'set') throw new NoRenderer('a keyword cost change with a limit, or a cost set outright');
    const { amount, per } = K.costAmount(k.costChange, st);
    // std-freecast-4 (CR 702.168a, 702.37a): the cost of turning a face-down permanent face up is no activated ability: "Disguise {5}{R}. This cost is reduced by {1} for
    // each instant and sorcery card in your graveyard."
    if (k.keyword === 'disguise' || k.keyword === 'morph' || k.keyword === 'megamorph') {
      if (k.costChange.kind !== 'reduce') throw new NoRenderer('a face-up cost that is increased');
      return `${line}. This cost is reduced by ${amount}${per}.`;
    }
    const when = k.costChangeIf === undefined ? '' : JSON.stringify(k.costChangeIf) === JSON.stringify({ cond: 'turnOf', whose: 'you' }) ? ' during your turn' : ` if ${K.cond(k.costChangeIf, st)}`; // pc-statics-1 (CR 601.2f)
    return `${line}. This ability costs ${amount} ${k.costChange.kind === 'increase' ? 'more' : 'less'} to activate${per}${when}.`;
  }
  // FAST5X E27 (CR 602.5b): "Equip--Pay 3 life. Activate only once each turn."
  if (k.limit !== undefined) {
    if (k.limit.per !== 'turn' || k.limit.max !== 1) throw new NoRenderer('a keyword limit other than once each turn');
    return `${line}. Activate only once each turn.`;
  }
  return hasDashCost(k) ? `${line}.` : line;
}

/** A line of several keywords as printed on a card: "Flying, first strike, ward {2}" (a semicolon separates them when a cost holds a comma). */
export function keywordLineOf(list: KeywordAbilityDef[], st: RenderState): string {
  if (list.length === 0) throw new NoRenderer('a keyword line without keywords');
  // FAST5X E27 (CR 602.5b): a keyword with its own activation restriction is a line of its own
  if (list.some((k) => k.limit !== undefined || k.costChange !== undefined)) { // r4-cost: a keyword with its own cost change, too
    if (list.length !== 1) throw new NoRenderer('an activation limit on a keyword in a list of keywords');
    return keywordLine(list[0]!, st);
  }
  const sep = alt(', ', '; ');
  // FAST2 T7: CR 702.16g, "protection from [A] and from [B]" is shorthand for two protection abilities (hexproof from, CR 702.11d, is written the same way):
  // two such abilities in a row may be printed as that one item
  const pieces: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const k = list[i]!;
    const next = list[i + 1];
    if (next !== undefined && fromPair(k, next)) {
      pieces.push(alt(`${keywordWords(k, st)}${sep}${keywordWords(next, st)}`, `${k.keyword} from ${qualityWords(k.quality!)} and from ${qualityWords(next.quality!)}`));
      i++;
      continue;
    }
    pieces.push(keywordWords(k, st));
  }
  const line = capFirst(pieces.join(sep));
  // r4-fxb (CR 107.3): a keyword whose amount is stated after it ("Firebending X, where X is ...") is a sentence, printed with its period
  return list.some(hasDashCost) || list.some(hasStatedAmount) ? `${line}.` : line;
}

/** r4-fxb: the amount is a quantity the line states ("X, where X is ..."), not a number or an announced X. */
const hasStatedAmount = (k: KeywordAbilityDef): boolean => k.amount !== undefined && typeof k.amount === 'object' && k.amount.q !== 'X';

/** Two "[keyword] from [quality]" abilities of the same keyword (protection, hexproof) that Oracle writes as one item "[keyword] from A and from B". */
const fromPair = (a: KeywordAbilityDef, b: KeywordAbilityDef): boolean =>
  (a.keyword === 'protection' || a.keyword === 'hexproof') && a.keyword === b.keyword && typeof a.quality === 'string' && typeof b.quality === 'string'
  && a.quality !== b.quality && a.filter === undefined && b.filter === undefined && a.cost === undefined && b.cost === undefined;

/** A list of granted keywords in running text: "flying and vigilance", "protection from red and from blue". */
export function keywordList(list: KeywordAbilityDef[], st: RenderState): string {
  const protections = list.filter((k) => k.keyword === 'protection' && k.quality !== undefined);
  const rest = list.filter((k) => !(k.keyword === 'protection' && k.quality !== undefined));
  // CLOUD std-ecl (CR 702.21a, 113.1a): a granted keyword whose cost is not only mana is its own line in quotes, 'have "Ward--Pay 2 life."' (Oracle never writes
  // it bare in running text: Hexing Squelcher, Hag of Mage's Doom, Mishra, Tamer of Mak Fawa, Decomposition)
  const bits: string[] = rest.map((k) => (hasDashCost(k) ? `"${keywordLine(k, st)}"` : keywordWords(k, st)));
  if (protections.length > 0) bits.push(`protection from ${protections.map((k) => qualityWords(k.quality!)).join(' and from ')}`);
  return joinList(bits);
}
