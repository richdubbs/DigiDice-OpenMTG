/**
 * Keyword abilities as text (WP2): "Flying", "Kicker {2}{G}", "Protection from red", "Enchant creature", "Ward--Pay 3 life". Reminder text is never
 * printed (CR 207.2); the renderer reads the keyword's parameters only.
 */
import type { KeywordAbilityDef } from '../types/ability';
import { K } from './kernel';
import type { RenderState } from './state';
import { alt, capFirst, joinList, NoRenderer, numWord, pluralize } from './text';

const COLOR: Record<string, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };

/** The canonical quality string of rules/quality.ts as words: "color:R" -> "red", "subtype:goblins" -> "Goblins". */
export function qualityWords(quality: string): string {
  if (quality === 'ownColors') return 'each of its colors'; // std-rg (hexproof only)
  if (quality === 'spell') return 'spells'; // edh-mana-keywords-10 (CR 702.16a, 111.1): rules/quality.ts
  if (quality === 'ability') return 'activated and triggered abilities'; // edh-top-9 (CR 702.11d): rules/quality.ts
  if (quality === 'castThisTurn') return 'permanents that were cast this turn'; // edh-mana-keywords-10 (CR 702.16a, 601.2a)
  if (quality === 'ringBearer') return 'Ring-bearers'; // edh-replace-6 (CR 701.54e, 702.16a)
  const spellOf = /^spell&type:(.+)$/.exec(quality);
  if (spellOf !== null) return `${spellOf[1]!.toLowerCase()} spells`; // edh-c-54 (CR 702.16a, 111.1, 205.2): rules/quality.ts, the composite `spell&type:X`
  if (quality === 'type:Creature&supertype:Legendary') return 'legendary creatures'; // edhv31 (Tsabo Tavoc; rules/quality.ts)
  const typedCreature = /^type:Creature&subtype:([a-z]+)s$/.exec(quality);
  if (typedCreature !== null) return `${typedCreature[1]!.replace(/^./, (ch) => ch.toUpperCase())} creatures`; // edh-d-5 (Sigrid; rules/quality.ts)
  const nonCreature = /^type:Creature&!subtype:(.+)$/.exec(quality);
  if (nonCreature !== null) return `non-${nonCreature[1]!.replace(/^./, (ch) => ch.toUpperCase()).replace(/s$/, '')} creatures`; // edhv31 (Harbinger of Spring)
  const i = quality.indexOf(':');
  if (i < 0) return quality;
  const value = quality.slice(i + 1);
  switch (quality.slice(0, i)) {
    case 'color': return value === 'any' ? alt('all colors', 'each color') : (COLOR[value] ?? value); // r3-choose, CMD2: "protection from each color" (CR 702.16a, 105.1; Akroma's Will)
    case 'type': return pluralize(value.toLowerCase()); // FAST5 T45: "protection from instants and from sorceries"
    case 'supertype': return `${value.toLowerCase()} permanents`;
    case 'subtype': return value.charAt(0).toUpperCase() + value.slice(1);
    case 'identity': return "each color that's not in your commander's color identity"; // edh-perms-2 (Commander's Plate; quality `identity:outside`)
    case 'chosen': return value === 'color' ? alt('the chosen color', 'that color') : value === 'cardType' ? 'the chosen card type' : value === 'creatureType' ? 'creatures of the chosen type' /* edh-d-12 (CR 702.16a, 607.2d; Riders of Gavony) */ : `the chosen ${value}`; // MX2 (additive): "protection from the chosen color" (CR 607.2d); edh-players-8: or "that color" (family chosen-color-that-color)
    case 'player': return value === 'opponents' ? 'each of your opponents' : quality; // std-rx15 (CR 702.16b-f): "protection from each of your opponents"
    case 'counter': return `permanents with ${value} counters on them`; // edh-next-88 (Geyadrone Dihada; quality `counter:<kind>`, CR 122.1, 702.16a)
    case 'opp': return `${qualityWords(value)} your opponents control`; // edh-c-49 (Crypsis; quality `opp:type:Creature`, CR 702.16a)
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
  if (quality === 'chosen:landType') return 'landwalk of the chosen type'; // edh-d-72 (CR 702.14a, 607.2d; Traveler's Cloak)
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
  const { zone, types, supertypes, subtypes, allTypes, ...rest } = f ?? {};
  // edh-next-49 (CR 702.29e; Sojourner's Companion): "Artifact landcycling": a card that is both an artifact and a land
  if (zone === 'library' && Object.keys(rest).length === 0 && types === undefined && supertypes === undefined && subtypes === undefined && allTypes?.length === 2 && allTypes[0] === 'Artifact' && allTypes[1] === 'Land') return 'artifact landcycling';
  if (zone !== 'library' || allTypes !== undefined || Object.keys(rest).length > 0) throw new NoRenderer('typecycling with a filter that is not a type of library card');
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
  // edh-next-59 (CR 702.141a, 107.3; Sliver Gravemother): "has encore {X}, where X is its mana value" (a cost of generic mana equal to its mana value)
  if (k.costIsManaValue === true) {
    if (k.keyword !== 'encore' || k.cost !== undefined || k.costIsManaCost !== undefined || k.amount !== undefined) throw new NoRenderer('a cost equal to its mana value other than a granted encore');
    return 'encore {x}, where x is its mana value';
  }
  // edh-next-146 (CR 702.21b, 107.3; Minthara, Merciless Soul): "~ has ward {X}, where X is the number of experience counters you have.": the object itself has ward, the X of its cost a
  // stated quantity (Oracle words it as a sentence about the object, like edh-next-26's bushido); only ward with the cost {X} alone
  if (k.costX !== undefined) {
    const m = k.cost?.mana;
    if (name !== 'ward' || k.cost === undefined || Object.keys(k.cost).join() !== 'mana' || m?.length !== 1 || m[0]!.kind !== 'variable' || m[0]!.name !== 'X' || k.amount !== undefined || k.quality !== undefined || k.filter !== undefined) {
      throw new NoRenderer('a stated X of a keyword cost other than ward {X}');
    }
    return `~ has ward {x}, where x is ${K.qty(k.costX, st)}`;
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
  // edh-combat-7 (CR 702.48a): "Artifact offering" (the quality, then the keyword); only the quality the parser reads
  if (name === 'offering') {
    // edh-c-92 (CR 702.48a): also the five creature types printed before "offering" (the Patrons); any other quality has no reading
    if (typeof k.quality !== 'string' || !['Artifact', 'Goblin', 'Fox', 'Moonfolk', 'Snake'].includes(k.quality) || k.cost !== undefined) throw new NoRenderer('offering with any quality but artifact or one of the Patrons\' creature types');
    return `${k.quality.toLowerCase()} offering`;
  }
  if (name === 'craft') return craftWords(k, st); // FAST5X E13 (CR 702.167a)
  if (name === 'enchant') {
    if (k.player) return k.player === 'any' ? 'enchant player' : k.player === 'opponent' ? 'enchant opponent' : 'enchant you';
    // FAST2 T7: "Enchant creature or Vehicle" (CR 702.5a): a card type or ONE subtype
    // edh-perms-4 (CR 607.2a, 613.1f): the enchant ability Animate Dead gains, "enchant creature put onto the battlefield with ~": the permanent the Aura put onto the battlefield (its link)
    // the object itself is "~" (this Aura), or the name of the card that prints the quote when that card becomes an Aura (the outer name inside a quote, "¤", CR 201.5a: Necromancy)
    if (putWithEnchant(k)) return `enchant ${k.filter!.types![0]!.toLowerCase()} put onto the battlefield with ${alt('~', '¤')}`;
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
  // edh-d-24 (CR 702.6a, 118.1; Transmogrant's Crown): "Equip {2} or {B}": two mana costs, the player pays one
  if (name === 'equip' && k.filter === undefined && k.amount === undefined && k.quality === undefined && k.cost?.other?.length === 1 && k.cost.other[0]!.kind === 'oneOf' && Object.keys(k.cost).join() === 'other') {
    const opts = (k.cost!.other![0] as Extract<NonNullable<NonNullable<typeof k.cost>['other']>[number], { kind: 'oneOf' }>).options;
    const said = opts.map((o) => costText({ ...k, cost: o }, st));
    if (opts.length === 2 && said.every((c) => c !== null && c.manaOnly && Object.keys(opts[0]!).join() === 'mana')) return `equip ${said.map((c) => c!.text).join(' or ')}`;
  }
  const parts: string[] = [name === 'typecycling' ? typecycling(k.filter) : name];
  // std-rx24 (CR 702.72a): "Champion a Faerie", "Champion an Elemental", "Champion a Goblin or Shaman": the object with its article
  if (k.filter && name !== 'typecycling') parts.push(name === 'affinity' ? `for ${K.np(k.filter, st, { det: 'none', plural: true })}` : name === 'splice' ? `onto ${K.np(k.filter, st, { det: 'none' })}` : K.np(k.filter, st, { det: name === 'champion' ? 'a' : 'none' }));
  // edh-next-127 (CR 702.119b; Crabomination): "Emerge from artifact {5}{B}{B}", the variant "emerge from [quality]": only the quality the parser reads (an artifact)
  if (name === 'emerge' && k.quality !== undefined) {
    if (k.quality !== 'type:Artifact' || k.filter !== undefined || k.amount !== undefined) throw new NoRenderer('emerge from a quality other than artifact');
    parts.push('from artifact');
  } else if (k.quality !== undefined) parts.push(qualityWords(k.quality));
  // r4-fxb (CR 702.189a, 107.3): "Firebending X, where X is ~'s power": an amount that is a stated quantity (not a number, not an announced X), only without
  // a cost, quality or filter
  // edh-next-127 (CR 702.54b; Indoraptor): "Bloodthirst X", its X the total damage your opponents have been dealt this turn (parser/holes/misc.ts#BLOODTHIRST_X), said as the variant's name
  if (name === 'bloodthirst' && k.cost === undefined && k.quality === undefined && k.filter === undefined && isBloodthirstX(k)) return 'bloodthirst x';
  const stated = hasStatedAmount(k);
  if (stated && (k.cost !== undefined || k.quality !== undefined || k.filter !== undefined)) throw new NoRenderer('a stated keyword amount with another parameter');
  // edh-cast-5 (CR 702.86a, 107.3): "Ulamog has annihilator X, where X is the number of +1/+1 counters on it.": the keyword the object itself has, its amount the counters of
  // one kind on it (Oracle words it as a sentence about the object; only this shape and only annihilator)
  const amount = k.amount;
  if (stated && name === 'annihilator' && typeof amount === 'object' && amount.q === 'counters' && amount.on.ref === 'self' && amount.kind !== 'any') return `~ has annihilator x, where x is the number of ${amount.kind} counters on it`;
  // edh-next-26 (CR 702.45a, 107.3; Fumiko the Lowblood): "~ has bushido X, where X is the number of attacking creatures": the creature itself has the keyword, X a stated quantity
  if (stated && name === 'bushido') return `~ has bushido x, where x is ${K.qty(k.amount!, st)}`;
  if (stated) {
    const said = K.qty(k.amount!, st);
    // edh-perms-12 (CR 107.3, 208.1; Infantry Shield: "Equipped creature has menace and mobilize X, where X is its power."): the keyword a creature is given reads the power of that
    // creature, which Oracle calls "its power" as well as "~'s power" (family keyword-where-x-its-power)
    const its = typeof k.amount === 'object' && k.amount.q === 'stat' && k.amount.of.ref === 'self' && k.amount.agg === undefined && (k.amount.stat === 'power' || k.amount.stat === 'toughness') ? alt(said, `its ${k.amount.stat}`) : said;
    return `${parts.join(' ')} x, where x is ${its}`;
  }
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
  // edh-d-14 (CR 702.6c, 111.1; Team Pennant): "Equip creature token {1}": a creature token you control
  if (keys === 'controller,token,types' && f.controller === 'you' && f.token === true && f.types?.length === 1 && f.types[0] === 'Creature') return 'creature token';
  // edh-mana-keywords-12 (CR 702.6c, 301.5c; Luxior): "Equip planeswalker {1}": a planeswalker you control
  if (keys === 'controller,types' && f.controller === 'you' && f.types?.length === 1 && f.types[0] === 'Planeswalker') return 'planeswalker';
  if (keys === 'commander,controller,types' && f.commander === true && f.controller === 'you' && f.types?.length === 1 && f.types[0] === 'Creature') return 'commander';
  // edh-next-27 (CR 702.6c, 205.3m; Robe of the Archmagi): "Equip Shaman, Warlock, or Wizard {1}": a creature you control that is any one of three subtypes (each a single word-group of its own)
  if (keys === 'anyOf,controller,types' && f.controller === 'you' && f.types?.length === 1 && f.types[0] === 'Creature' && f.anyOf?.length === 3) {
    const names = f.anyOf.map((x) => { const o = x as Record<string, unknown>; return Object.keys(o).length === 1 && Array.isArray(o['subtypes']) ? (o['subtypes'] as string[]).join(' ') : null; });
    if (names.every((x): x is string => x !== null && x.length > 0)) return `${names[0]}, ${names[1]}, or ${names[2]}`;
    return null;
  }
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
/** edh-perms-4 (CR 607.2a): the enchant ability that restricts an Aura to the object it put onto the battlefield (parser/holes/edhpm4.ts): a quoted line of its own, ending in a full stop. */
export const putWithEnchant = (k: KeywordAbilityDef): boolean => k.keyword === 'enchant' && k.player === undefined && k.filter?.is?.ref === 'linked' && k.filter.is.link === 'putWith' && k.filter.types?.length === 1 && Object.keys(k.filter).length === 2;

export const hasDashCost = (k: KeywordAbilityDef): boolean => k.keyword !== 'craft' && !(k.keyword === 'equip' && k.cost?.other?.length === 1 && k.cost.other[0]!.kind === 'oneOf' && k.cost.mana === undefined && k.cost.other[0].options.length === 2 && k.cost.other[0].options.every((o) => Object.keys(o).join() === 'mana')) /* edh-d-24: "Equip {2} or {B}" */ && k.cost !== undefined && (k.cost.tap === true || k.cost.untap === true || k.cost.loyalty !== undefined || (k.cost.other?.length ?? 0) > 0);

/** edh-mana-keywords-10 (CR 702.35a, 107.4c; family madness-pay-colorless): the number of colorless symbols of a madness cost that is only that, two or more; else null. */
const madnessColorless = (k: KeywordAbilityDef): number | null =>
  k.keyword === 'madness' && k.cost?.tap !== true && k.cost?.untap !== true && k.cost?.loyalty === undefined && (k.cost?.other?.length ?? 0) === 0
    && (k.cost?.mana?.length ?? 0) >= 2 && k.cost!.mana!.every((m) => m.kind === 'colorless') ? k.cost!.mana!.length : null;

/** "Flying", "Kicker {2}{G}": the line of a keyword ability. */
export function keywordLine(k: KeywordAbilityDef, st: RenderState): string {
  const line = capFirst(keywordWords(k, st));
  // edh-perms-24 (CR 107.3, 601.2b; Thieving Skydiver): "Kicker {X}. X can't be 0."
  if (k.xMin !== undefined) {
    if (k.xMin !== 1 || (k.keyword !== 'kicker' && k.keyword !== 'suspend')) throw new NoRenderer('a smallest X other than 1, or on a keyword other than kicker or suspend (edhn81: "Suspend X--{X}{3}{U}. X can\'t be 0.")');
    return `${line}. X can't be 0.`;
  }
  // edh-next-137 (CR 702.153a, 707.9b, 306.5b; Ob Nixilis, the Adversary): "Casualty X. The copy isn't legendary and has starting loyalty X."
  if (k.copyExcept !== undefined || k.copyLoyalty !== undefined) {
    if (k.keyword !== 'casualty' || JSON.stringify(k.copyExcept) !== '[{"layer":4,"supertypes":{"remove":["Legendary"]}}]' || JSON.stringify(k.copyLoyalty) !== '{"q":"X"}' || JSON.stringify(k.amount) !== '{"q":"X"}') {
      throw new NoRenderer('casualty copy exceptions other than "The copy isn\'t legendary and has starting loyalty X."');
    }
    return `${line}. The copy isn't legendary and has starting loyalty X.`;
  }
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
    // edh-next-48 (CR 702.34a, 601.2f; Visions of Dominance): "Flashback {8}{G}{G}. This spell costs {X} less to cast this way, where X is ..." (a reduction of the spell cast for its flashback cost)
    if (k.keyword === 'flashback') {
      if (k.costChange.kind !== 'reduce' || k.costChangeIf !== undefined) throw new NoRenderer('a flashback cost that is increased, or reduced under a condition');
      return `${line}. ~ costs ${amount} less to cast this way${per}.`;
    }
    const when = k.costChangeIf === undefined ? '' : JSON.stringify(k.costChangeIf) === JSON.stringify({ cond: 'turnOf', whose: 'you' }) ? ' during your turn' : ` if ${K.cond(k.costChangeIf, st)}`; // pc-statics-1 (CR 601.2f)
    return `${line}. This ability costs ${amount} ${k.costChange.kind === 'increase' ? 'more' : 'less'} to activate${per}${when}.`;
  }
  // FAST5X E27 (CR 602.5b): "Equip--Pay 3 life. Activate only once each turn."
  if (k.limit !== undefined) {
    if (k.limit.per !== 'turn' || k.limit.max !== 1) throw new NoRenderer('a keyword limit other than once each turn');
    return `${line}. Activate only once each turn.`;
  }
  // edh-mana-keywords-10 (CR 702.35a, 107.4c; family madness-pay-colorless; Emrakul, the World Anew): a madness cost of colorless mana only, two or more symbols, is also "Madness--Pay six {C}."
  const colorless = madnessColorless(k);
  if (colorless !== null) return alt(line, `${line.split(' ')[0]}--Pay ${numWord(colorless)} {C}.`);
  return hasDashCost(k) || putWithEnchant(k) ? `${line}.` : line;
}

/** A line of several keywords as printed on a card: "Flying, first strike, ward {2}" (a semicolon separates them when a cost holds a comma). */
export function keywordLineOf(list: KeywordAbilityDef[], st: RenderState): string {
  if (list.length === 0) throw new NoRenderer('a keyword line without keywords');
  // FAST5X E27 (CR 602.5b): a keyword with its own activation restriction is a line of its own
  if (list.some((k) => k.limit !== undefined || k.costChange !== undefined || k.xMin !== undefined || k.copyExcept !== undefined || k.copyLoyalty !== undefined /* edh-next-137 */)) { // r4-cost: a keyword with its own cost change, too
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
    // edh-c-82 (CR 702.16g; Oversoul of Dusk): a run of three or more is printed "protection from A, from B, and from C" (or each said whole)
    let run = 1;
    while (list[i + run] !== undefined && fromPair(list[i + run - 1]!, list[i + run]!) && !list.slice(i, i + run).some((x) => x.quality === list[i + run]!.quality)) run++;
    if (run >= 3) {
      const qs = list.slice(i, i + run).map((x) => qualityWords(x.quality!));
      pieces.push(alt(list.slice(i, i + run).map((x) => keywordWords(x, st)).join(sep), `${k.keyword} from ${qs.slice(0, -1).join(', from ')}, and from ${qs[qs.length - 1]!}`));
      i += run - 1;
      continue;
    }
    if (next !== undefined && fromPair(k, next)) {
      pieces.push(alt(`${keywordWords(k, st)}${sep}${keywordWords(next, st)}`, `${k.keyword} from ${qualityWords(k.quality!)} and from ${qualityWords(next.quality!)}`));
      i++;
      continue;
    }
    pieces.push(keywordWords(k, st));
  }
  const line = capFirst(pieces.join(sep));
  // edh-mana-keywords-10: a madness cost of colorless mana only is a line of its own, "Madness--Pay six {C}." (keywordLine)
  const colorless = list.length === 1 ? madnessColorless(list[0]!) : null;
  if (colorless !== null) return alt(line, `${line.split(' ')[0]}--Pay ${numWord(colorless)} {C}.`);
  // r4-fxb (CR 107.3): a keyword whose amount is stated after it ("Firebending X, where X is ...") is a sentence, printed with its period
  return list.some(hasDashCost) || list.some(hasStatedAmount) ? `${line}.` : line;
}

/** r4-fxb: the amount is a quantity the line states ("X, where X is ..."), not a number or an announced X. */
/** edh-next-127 (CR 702.54b): the X of "Bloodthirst X" is defined by the rules, not stated on the line (no "where X is ...", no full stop). */
const isBloodthirstX = (k: KeywordAbilityDef): boolean => k.keyword === 'bloodthirst' && JSON.stringify(k.amount) === JSON.stringify({ q: 'happenedCount', event: { ev: 'damage', recipient: { player: 'opponent' } }, scope: 'turn', sum: 'amount' });
const hasStatedAmount = (k: KeywordAbilityDef): boolean => (k.amount !== undefined && typeof k.amount === 'object' && k.amount.q !== 'X' && !isBloodthirstX(k)) || k.costX !== undefined; // edh-next-146: ward {X}, where X is ...

/** Two "[keyword] from [quality]" abilities of the same keyword (protection, hexproof) that Oracle writes as one item "[keyword] from A and from B". */
const fromPair = (a: KeywordAbilityDef, b: KeywordAbilityDef): boolean =>
  (a.keyword === 'protection' || a.keyword === 'hexproof') && a.keyword === b.keyword && typeof a.quality === 'string' && typeof b.quality === 'string'
  && a.quality !== b.quality && a.filter === undefined && b.filter === undefined && a.cost === undefined && b.cost === undefined;

/** A list of granted keywords in running text: "flying and vigilance", "protection from red and from blue". */
export function keywordList(list: KeywordAbilityDef[], st: RenderState): string {
  const protections = list.filter((k) => k.keyword === 'protection' && k.quality !== undefined);
  // edh-players-2 (CR 702.11d; Veil of Summer): several "hexproof from <quality>" are printed "hexproof from blue and from black" in running text too
  const hexFrom = (k: KeywordAbilityDef): boolean => k.keyword === 'hexproof' && typeof k.quality === 'string' && k.filter === undefined && k.cost === undefined;
  const hexproofs = list.filter(hexFrom);
  const joinHex = hexproofs.length >= 2;
  const rest = list.filter((k) => !(k.keyword === 'protection' && k.quality !== undefined) && !(joinHex && hexFrom(k)));
  // CLOUD std-ecl (CR 702.21a, 113.1a): a granted keyword whose cost is not only mana is its own line in quotes, 'have "Ward--Pay 2 life."' (Oracle never writes
  // it bare in running text: Hexing Squelcher, Hag of Mage's Doom, Mishra, Tamer of Mak Fawa, Decomposition)
  const bits: string[] = rest.map((k) => (hasDashCost(k) ? `"${keywordLine(k, st)}"` : keywordWords(k, st)));
  if (protections.length > 0) bits.push(`protection from ${protections.map((k) => qualityWords(k.quality!)).join(' and from ')}`);
  if (joinHex) bits.push(alt(hexproofs.map((k) => keywordWords(k, st)).join(' and '), `hexproof from ${hexproofs.map((k) => qualityWords(k.quality!)).join(' and from ')}`));
  return joinList(bits);
}
