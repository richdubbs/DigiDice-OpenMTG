/**
 * Noun phrases: an `ObjectFilter` printed as English ("target nonblack creature", "creatures you control with flying", "a Plains or an Island",
 * "each other non-Aura enchantment"). Owner: WP2. The phrase is built from the filter fields alone, never from display text (design 2.1 principle 8),
 * so a swapped or dropped field changes the words and fails the render gate.
 *
 * Shape: [determiner] [adjectives] head [suffix] [post-modifiers]. Adjectives follow Oracle's order (status, supertype, color, non-X); post-modifiers are
 * zone, controller, owner, "with ...", "without ...", relative clauses, name.
 */
import { isPlayerOnlyRef, type Cmp, type NumberCmp, type ObjectFilter, type ObjRef, type PlayerPred, type PlayerRef, type ZoneName } from '../types/ability';
import { K, type NpOpts } from './kernel';
import { attachedOptions } from './refs';
import { isSuspendedCard } from './suspended';
import { cloneState, PUT_INTO_GRAVEYARD_THIS_WAY, type RenderState } from './state';
import { alt, ALT_OPEN, article, COLOR_WORD, displayFirst, joinList, lowerType, NoRenderer, numWord, pluralize, withArticle } from './text';

const STACK_HEAD: Record<string, string> = {
  spell: 'spell',
  activatedAbility: 'activated ability',
  triggeredAbility: 'triggered ability',
  ability: 'ability',
  copy: 'spell copy',
};

const ZONE_WORD: Record<string, string> = { graveyard: 'graveyard', hand: 'hand', library: 'library', exile: 'exile', stack: 'stack', command: 'command zone', battlefield: 'battlefield' };

const HAS_ABILITY: Record<string, string> = { activated: 'an activated ability', mana: 'a mana ability', triggered: 'a triggered ability', static: 'a static ability' };

const CHOSEN_QUALITY: Record<string, string> = {
  color: 'of the chosen color',
  creatureType: 'of the chosen type',
  cardType: 'of the chosen type',
  landType: 'of the chosen land type',
  cardName: 'with the chosen name',
  oddEven: 'with mana value of the chosen quality', // Cloud std-eoe (CR 202.3)
  oddEvenPower: 'with power of the chosen quality', // edh-d-95 (CR 208.1)
  landOrNonland: 'of the chosen kind', // edh-zones-16 (CR 205.2a)
  planeswalkerType: 'of the chosen type', // edh-d-94 (CR 205.3j; Deification)
};

const SHARES_QUALITY: Record<string, string> = { creatureType: 'a creature type', color: 'a color', cardType: 'a card type', name: 'a name', landType: 'a land type', permanentType: 'a permanent type', manaValue: 'a mana value' };

interface Parts {
  adj: string[];
  heads: string[];
  /** Appended to the head and the only word that takes the plural ("creature card"). */
  suffix: string;
  post: string[];
  /** Singular subtypes get an article each ("a Plains or an Island"). */
  elementArticles: boolean;
  /** No determiner ever: "equipped creature". */
  bare: boolean;
  /** Relative clauses need the plural verb. */
  plural: boolean;
  /** "Knights" or "Knight creatures": the creature word is optional after a creature subtype. */
  creatureOptional: boolean;
  /** edh-next-7: a creature token of one creature type, "Pest tokens" and "Pest creature tokens" (CR 111.1, 205.3m). */
  tokenCreatureWord?: boolean;
  /** FAST3 T12: "a Garruk" or "a Garruk planeswalker": the card type a planeswalker type belongs to may follow it (CR 205.3j). */
  typeAfter?: string;
  /** "nonartifact", "nonblack": negated adjectives, listed together once all of them are known. */
  negs: string[];
  /** edh-perms-7: 2 to 5 excluded creature types of a singular noun, said as "nonA, nonB" or "that isn't an A, B, or C". */
  notSubs?: string[];
  /** edh-d-12 (CR 205.4a, 109.2; Surgical Extraction): the excluded kind of a singular card description (`not` of card types / supertypes only), said "that isn't a basic land" and also
   *  "other than a basic land card" after the zone words: the text of the "that isn't ..." entry of `post` and of the kind in the second wording. */
  otherThanKind?: { isnt: string; kind: string };
  /** edh-next-8: the one adjective is `equipped` of a plural description: it may also be said after the rest ("that are equipped"). */
  equippedPost?: true;
  enchantedPost?: true;
  /** edh-next-35 (family team-controls): the index in `post` of a plain "you control" that "your team controls" also says (set only for a plain group of a creature type, `teamWords`). */
  teamAt?: number;
  /** edh-c-55: set to false while the singular "that's enchanted" alternative is composed (stops the recursion). */
  thatsEnchanted?: boolean;
  /** cloud std-dsk: "that doesn't have the same name as a Room you control" (CR 201.2), said where the positive "with the same name as" goes. */
  notSameName?: string;
  /** edh-next-126: "each Aura you control", the set of a `notSameName` said "with a different name than each ..." too. */
  notSameNameEach?: string;
  /** edh-next-126: the index in `post` of the "with ..." phrase of the description, when it was pushed last as its own phrase. */
  withAt?: number;
  /** The whole noun is one of these phrases ("enchanted creature", "equipped creature"): adjective and noun go together, and each is pluralized as a whole. */
  headChoice?: string[];
  /** The whole phrase, when it is not built from words ("~", "it"). */
  whole?: string;
  /** FAST3 T17: `whole` is a list of noun phrases (an `anyOf` spelled out), so a count goes before it ("up to two basic land cards and/or Desert cards"). */
  wholeCounted?: boolean;
  /** std-re: `whole` already starts with its determiner ("each other creature you control that's a token or a Rabbit"), so compose() says it as it is. */
  wholeHasDet?: boolean;
  other: boolean;
  /** edh-perms-9 (CR 205.2a): the kinds of a plural description that are only negations ("nonland, nontoken"), said out as "except for lands and tokens". */
  exceptList?: string;
}

/** The zones a filter looks in (default: the battlefield). */
function zonesOf(f: ObjectFilter): (ZoneName | 'any')[] {
  if (f.zone === undefined) return ['battlefield'];
  if (f.zone === 'any') return ['any'];
  return Array.isArray(f.zone) ? f.zone : [f.zone];
}

/** FAST5 T42: the zone words of a filter's cards ("from your graveyard"), nothing for the battlefield. */
export function zoneTail(f: ObjectFilter, st: RenderState): string {
  return zonePhrase(f, st, zonesOf(f), false);
}

const isBattlefield = (zs: (ZoneName | 'any')[]): boolean => zs.length === 1 && zs[0] === 'battlefield';

/** Exactly the permanent types (lower case), in any order (CR 110.4). */
const PERMANENT_TYPE_WORDS = ['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker'];
const isPermanentTypes = (types: readonly string[]): boolean => types.length === PERMANENT_TYPE_WORDS.length && PERMANENT_TYPE_WORDS.every((t) => types.includes(t));

function possessorOf(pred: PlayerPred | undefined, st: RenderState, plural: boolean): string {
  if (pred === 'you') return 'your';
  if (pred === 'opponent') return plural ? alt("an opponent's", "your opponents'") : "an opponent's";
  if (pred === 'any' || pred === undefined) return 'a';
  return K.player(pred as PlayerRef, st, 'possessive').text;
}

/** "you own", "an opponent owns", "target player owns"; empty for no owner. */
function ownerWords(owner: PlayerPred | undefined, st: RenderState): string {
  if (owner === undefined || owner === 'any') return '';
  if (owner === 'you') return 'you own';
  if (owner === 'opponent') return 'an opponent owns';
  return `${K.player(owner as PlayerRef, st, 'subject').text} owns`;
}

/**
 * edh-next-35 (CR 102.3, 810.1; family team-controls; Khorvath Brightflame, Thrasher Brute): the game has no team of several players, so "Knights your team controls" says the
 * same set as "Knights you control". Only a plain description of creatures of a type (a subtype, at most "other"), whose phrase nothing else rearranges; any other description keeps
 * its one wording (many callers compare or search the controller words).
 */
function teamWords(f: ObjectFilter): boolean {
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined);
  // edh-next-61 (Pir, Imaginative Rascal): also the plain "permanent you control" ("a permanent your team controls"), no other field
  if (keys.length === 1 && f.controller === 'you') return true;
  return Array.isArray(f.subtypes) && f.subtypes.length > 0 && f.controller === 'you' && keys.every((k) => k === 'subtypes' || k === 'controller' || k === 'other');
}

/** Subtypes that belong to one card type other than creature (CR 205.3g-k). Every other subtype is a creature type (CR 205.3m). */
const OTHER_SUBTYPES: Record<string, string[]> = {};
for (const [type, names] of Object.entries({
  Artifact: 'Attraction Blood Bobblehead Book Clue Contraption Equipment Food Fortification Gold Heartwood Incubator Infinity Junk Lander Map Mutagen Powerstone Spacecraft Stone Treasure Vehicle Vibranium',
  Enchantment: 'Aura Background Cartouche Case Class Curse Plan Role Room Rune Saga Shard Shrine',
  Land: 'Cave Desert Forest Gate Island Lair Locus Mine Mountain Plains Planet Power-Plant Sphere Swamp Tower Town Urza\'s', // straight apostrophe, as in Oracle type lines (statics/subtypes.ts, test/m5/render/wp30-subtypes.test.ts)
  Planeswalker: 'Ajani Aminatou Angrath Arlinn Ashiok Bahamut Basri Bolas Calix Chandra Comet Dack Dakkon Daretti Davriel Dellian Dihada Domri Dovin Ellywick Elminster Elspeth Estrid Freyalise Garruk Gideon Grist Guff Huatli Jace Jared Jaya Jeska Kaito Karn Kasmina Kaya Kiora Koth Liliana Lolth Lukka Minsc Mordenkainen Nahiri Narset Niko Nissa Nixilis Oko Quintorius Ral Rowan Saheeli Samut Sarkhan Serra Sivitri Sorin Szat Tamiyo Tasha Teferi Teyo Tezzeret Tibalt Tyvar Ugin Urza Venser Vivien Vraska Vronos Will Windgrace Wrenn Xenagos Yanggu Yanling Zariel',
  Battle: 'Siege',
  'Instant Sorcery': 'Adventure Arcane Lesson Omen Trap',
})) for (const n of names.split(' ')) OTHER_SUBTYPES[n] = type.split(' ');
/** edh-c-12 (CR 205.3m): the subtypes are all creature types (a creature type is only a creature's: "Zubera that died this turn"). */
export const areCreatureTypes = (subtypes: readonly string[]): boolean => subtypes.length > 0 && subtypes.every((n) => OTHER_SUBTYPES[n] === undefined);
// std-r9b (CR 301.7, 205.3g): a crewed Vehicle is an artifact creature that keeps its artifact subtype: "Vehicle creatures you control" is no contradiction
OTHER_SUBTYPES['Vehicle'] = ['Artifact', 'Creature'];
// trek-3 (CR 205.3g, 721.2b): a Spacecraft whose station threshold is met is an artifact creature that keeps its artifact subtype: "Spacecraft creatures you
// control get +3/+3" (Captain Kirk, Boldly Going) is no contradiction either
OTHER_SUBTYPES['Spacecraft'] = ['Artifact', 'Creature'];
// edh-b-6 (CR 205.3g, 111.10b, 613.1d; Brenard, Ginger Sculptor): a Food that is also a creature (an artifact creature Food Golem token, or a creature that became a Food) keeps its artifact subtype: "each creature you control that's a Food or a Golem"
OTHER_SUBTYPES['Food'] = ['Artifact', 'Creature'];

/**
 * A type beside a subtype must be one the subtype can have (design 3.3: all fields ANDed; a contradiction is an error of the JSON, not a filter that
 * matches something). "Creature" goes with creature types, "Artifact" with Equipment, and so on.
 */
function checkSubtypeTypes(types: string[], subtypes: string[], other = false): void {
  for (const t of types) {
    const ok = subtypes.some((s) => {
      const owners = s === 'Food' && other ? ['Artifact'] : OTHER_SUBTYPES[s]; // edh-b-6: "other Food creatures" stays unread (only the Brenard wording is)
      return owners === undefined ? t === 'Creature' : owners.includes(t);
    });
    if (!ok) throw new NoRenderer(`the type ${t} does not go with the subtype ${subtypes.join(' or ')}`);
  }
}

function zonePhrase(f: ObjectFilter, st: RenderState, zs: (ZoneName | 'any')[], plural: boolean, forEach = false): string {
  const real = zs.filter((z): z is ZoneName => z !== 'any' && z !== 'battlefield');
  if (real.length === 0) return '';
  // r5-mech (CR 108.3, 404.1, 406.1): cards you own in either zone, "cards you own in exile and in your graveyard" (parser/holes/filter.ts)
  if (real.length === 2 && real.includes('exile') && real.includes('graveyard') && f.owner === 'you' && f.controller === undefined) return 'you own in exile and in your graveyard';
  // edh-next-75 (CR 108.3, 400.1, 408.1, 404.1; Campfire): cards you own in the command zone or your graveyard, "from the command zone and from your graveyard" (parser/holes/filter.ts#zoneForms)
  if (real.length === 2 && real.includes('command') && real.includes('graveyard') && f.owner === 'you' && f.controller === undefined) return 'you own from the command zone and from your graveyard';
  const own = f.owner ?? f.controller;
  const parts: string[] = [];
  const mine = real.filter((z) => z === 'hand' || z === 'library' || z === 'graveyard');
  if (mine.length > 0) {
    const poss = possessorOf(own, st, plural);
    const words = mine.map((z) => ZONE_WORD[z]!);
    // r4-fxz (CR 400.1): two zones of one player are also "your hand and/or graveyard" (a card in either: the same set)
    const list = words.length === 2 ? alt(joinList(words, 'or'), words.join(' and/or '), ...(plural && Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).every((k) => k === 'zone' || k === 'owner' || k === 'isCard') ? [words.join(' and ')] : []) /* edh-c-36 (Identity Crisis; family hand-and-graveyard-all): all cards of both zones, no other description */) : joinList(words, 'or');
    // r5-fxz (CR 102.3, 404.1): cards every opponent owns are also in "your opponents' graveyards" (the zone word plural, as Oracle prints it)
    // p2-pt-3 (CR 102.3, 404.1, 613.4c): also one card of such a count, "for each creature card in your opponents' graveyards" (Wight of Precinct Six)
    const owned = poss === 'a' ? `a ${list}` : own === 'opponent' && plural && words.length === 1 ? alt(`${poss} ${list}`, `your opponents' ${pluralize(words[0]!)}`)
      : own === 'opponent' && forEach && words.length === 1 ? alt(`${poss} ${list}`, `your opponents' ${pluralize(words[0]!)}`) : `${poss} ${list}`;
    // FAST2 T9: a set of cards in any player's graveyard is "creature cards in all graveyards" (CR 404.1: each player has a graveyard); FAST3 T14: or
    // "cards from graveyards" ("exile up to three target cards from graveyards")
    // r4-fxz: "put all creature cards from all graveyards onto the battlefield under your control" (Rise of the Dark Realms) is the same set
    // std-ry5 (CR 404.1): "Cards in graveyards lose all abilities" (Yixlid Jailer) names that set too
    // p2-graveyard-2 (CR 404.1, 401.1; family cards-in-zones-plural): and a set of cards in any player's graveyard or library is "creature cards in graveyards and
    // libraries" (Grafdigger's Cage): the zone words plural, joined by "and", in Oracle's order
    const ORDER = ['graveyard', 'library', 'hand'];
    const HAND_FIRST: typeof mine = ['hand', 'graveyard', 'library'];
    const inAll = [...mine].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).map((z) => pluralize(ZONE_WORD[z]!)).join(' and ');
    // edh-mana-keywords-2 (CR 404.1): a counted or plural set is also "in each graveyard" (Rite of Flame: "for each card named Rite of Flame in each graveyard")
    parts.push(poss === 'a' && plural && words.length === 1 ? alt(`${alt('from', 'in')} ${owned}`, `in all ${pluralize(words[0]!)}`, `from ${pluralize(words[0]!)}`, `from all ${pluralize(words[0]!)}`, `in ${pluralize(words[0]!)}`, ...(words[0] === 'graveyard' ? ['in each graveyard'] : []), ...(words[0] === 'hand' && f.owner === 'any' ? ["in each player's hand"] : [] /* edh-next-142 (CR 402.1; Homing Sliver; family in-each-players-hand) */))
      : poss === 'a' && forEach && words[0] === 'graveyard' && words.length === 1 ? alt(`${alt('from', 'in')} ${owned}`, 'in all graveyards', 'in each graveyard')
      // edh-b-3 (CR 404.1, 400.1; Worldfire): and "all cards from all hands and graveyards" (every player's, the hand word first)
      : poss === 'a' && plural && words.length === 2 && real.length === 2 ? alt(`${alt('from', 'in')} ${owned}`, `in ${inAll}`, ...(mine.includes('hand') ? [`from all ${HAND_FIRST.filter((z) => mine.includes(z)).map((z) => pluralize(ZONE_WORD[z]!)).join(' and ')}`] : []))
      // edh-mana-keywords-10 (CR 404.1; The Deck of Many Things): a graveyard of any player (`owner: 'any'`) is also "from any graveyard"
      // edh-next-142 (CR 402.1; Homing Sliver; family in-each-players-hand): and a hand of any player is "in each player's hand" ("Each Sliver card in each player's hand has ...")
      : poss === 'a' && f.owner === 'any' && !plural && !forEach && words.length === 1 && (words[0] === 'graveyard' || words[0] === 'hand') && real.length === 1 ? alt(`${alt('from', 'in')} ${owned}`, words[0] === 'graveyard' ? 'from any graveyard' : "in each player's hand") : `${alt('from', 'in')} ${owned}`);
  }
  for (const z of real) {
    // the owner of a card in exile or the command zone is a part of where it is (CR 108.3, 406, 408): "a card you own in exile"
    // p2-pt-3 (CR 102.3, 406.1, 613.4c): cards every opponent owns, also "for each card your opponents own in exile" (Umbris, Fear Manifest)
    // edh-d-85 (CR 108.3, 406.1; family they-own-in-exile; Ravenloft Adventurer): a player named before ("defending player loses 1 life for each card they own in exile") is also "they"
    const knownOwner = typeof f.owner === 'object' && ['target', 'event', 'bound', 'iterating', 'defending'].includes((f.owner as PlayerRef).ref);
    const owns = f.owner === 'opponent' && (plural || forEach) ? alt('an opponent owns', 'your opponents own') : knownOwner && z === 'exile' && K.player(f.owner as PlayerRef, cloneState(st), 'subject').person !== 'pl' ? alt(ownerWords(f.owner, st), 'they own') : ownerWords(f.owner, st);
    if (z === 'exile') parts.push(owns === '' ? 'in exile' : alt(`${owns} in exile`, `${owns} from exile`, `in exile ${owns}`));
    else if (z === 'stack') parts.push('on the stack');
    // edh-misc-2 (CR 408.1, 903.8): a card moved out of the command zone is "from the command zone" as well ("put a commander you own from the command zone onto the battlefield")
    else if (z === 'command') parts.push(alt(...(owns === '' ? ['in the command zone', 'from the command zone'] : [`${owns} in the command zone`, `in the command zone ${owns}`, `${owns} from the command zone`])));
  }
  return parts.join(' or ');
}

/** edh-c-45 (CR 700.4; Death's Oasis): is the trigger being rendered about one creature dying (a battlefield to graveyard change of a creature)? */
function diesTrigger(st: RenderState): boolean {
  const on = st.trigger ?? [];
  return on.length === 1 && on[0]!.ev === 'zoneChange' && on[0]!.from === 'battlefield' && on[0]!.to === 'graveyard' && on[0]!.subject?.types?.length === 1 && on[0]!.subject.types[0] === 'Creature';
}

/** edh-next-32: `{op, value: the power of the object itself}`, the filter "power less than ~'s" / "equal or lesser power" reads. */
function isOwnPowerCmp(c: NumberCmp, op: '<' | '<='): boolean {
  const v = c.value;
  return c.op === op && typeof v === 'object' && 'q' in v && v.q === 'stat' && v.stat === 'power' && v.of.ref === 'self';
}

/** edh-c-86: `{op: '<', value: the power of the event's subject}`, the filter "lesser power" reads. */
function isLesserPowerThanSelf(c: NumberCmp, stat: 'power' | 'toughness' = 'power' /* edh-next-86: "lesser toughness" */): boolean {
  const v = c.value;
  return c.op === '<' && typeof v === 'object' && 'q' in v && v.q === 'stat' && v.stat === stat && v.of.ref === 'event' && v.of.role === 'subject';
}

/** edh-next-103: `{op: '<=', value: the toughness of the event's subject}`, the filter "equal or lesser toughness" reads (Bane, Lord of Darkness). */
function isEqualOrLesserToughnessThanEvent(c: NumberCmp): boolean {
  const v = c.value;
  return c.op === '<=' && typeof v === 'object' && 'q' in v && v.q === 'stat' && v.stat === 'toughness' && v.of.ref === 'event' && v.of.role === 'subject';
}

/** FAST5 T42: `{op: '<', value: the mana value of the event's subject}`, the filter "lesser mana value" reads. */
function isLesserThanEventSubject(c: NumberCmp): boolean {
  const v = c.value;
  return c.op === '<' && typeof v === 'object' && 'q' in v && v.q === 'stat' && v.stat === 'manaValue' && v.of.ref === 'event' && (v.of.role === 'subject' || v.of.role === 'spell'); // edh-top-7: also the spell of a cast trigger (Jodah, the Unifier)
}

/** edh-c-66: `{op: '==', value: the mana value of the event's spell}`, the filter "with that spell's mana value" reads (Celestial Kirin). */
function isEqualEventSpell(c: NumberCmp): boolean {
  const v = c.value;
  return c.op === '==' && typeof v === 'object' && 'q' in v && v.q === 'stat' && v.stat === 'manaValue' && v.of.ref === 'event' && v.of.role === 'spell';
}

/**
 * std-rx28: `{op: '<=', value: the mana value of the event's spell}`, the filter "equal or lesser mana value" reads (Kellan, the Kid). edh-perms-9: also of the
 * event's subject, in a trigger about a permanent entering or dying (parser/lower/ability.ts, Kodama of the East Tree).
 */
function isAtMostEventSpell(c: NumberCmp): boolean {
  const v = c.value;
  return c.op === '<=' && typeof v === 'object' && 'q' in v && v.q === 'stat' && v.stat === 'manaValue' && v.of.ref === 'event' && (v.of.role === 'spell' || v.of.role === 'subject');
}

/**
 * edh-next-126 (CR 202.3; Light-Paws, Emperor's Voice): `{op: '<=', value: the mana value of the event's subject}` also said with the object alone, "an Aura card with mana value less
 * than or equal to that Aura" (the statistic left unsaid after it). The object is named on a copy of the state (its mention is the other reading's).
 */
function atMostEventObject(c: NumberCmp, st: RenderState): string[] {
  const v = c.value;
  if (c.op !== '<=' || typeof v !== 'object' || !('q' in v) || v.q !== 'stat' || v.stat !== 'manaValue' || v.agg !== undefined || v.of.ref !== 'event' || v.of.role !== 'subject') return [];
  return [`mana value less than or equal to ${K.obj(v.of, cloneState(st), 'object').text}`];
}

/** edh-next-54: `{op: '<=', value: the mana value of an earlier target}`, the second target of an exchange "with equal or lesser mana value" (Puca's Mischief; lower/ability.ts). */
function isAtMostEarlierTarget(c: NumberCmp): boolean {
  const v = c.value;
  return c.op === '<=' && typeof v === 'object' && 'q' in v && v.q === 'stat' && v.stat === 'manaValue' && v.of.ref === 'target';
}

function cmpPhrase(c: NumberCmp, st: RenderState): string {
  const v = K.qty(c.value, st);
  const op: Cmp = c.op;
  // FAST5 T45: a computed bound is written in front, "mana value less than or equal to ~'s power" (Oracle never puts "or less" after a phrase such as "~'s power")
  const computed = typeof c.value === 'object' && c.value.q !== 'X' && c.value.q !== 'var';
  // edh-d-23 (CR 107.3, 608.2h; Emergent Woodwurm): after "look at the top X cards of your library, where X is its power", the same computed bound is X again: "mana value X or less"
  if (computed && op === '<=' && st.mentioned.has(`x=${JSON.stringify(c.value)}`)) return alt(`less than or equal to ${v}`, 'X or less', 'X or fewer');
  if (computed && op === '<=') return `less than or equal to ${v}`;
  if (computed && op === '>=') return `greater than or equal to ${v}`;
  switch (op) {
    // FAST5 T42 (CR 107.1, 202.3): Oracle also writes the comparison out, "mana value less than or equal to ~'s power" (the first option is the display form:
    // a computed value reads best that way, a number as "3 or less")
    case '>=': return /^\d+$/.test(v) ? alt(`${v} or greater`, `${v} or more`, `greater than or equal to ${v}`) : alt(`greater than or equal to ${v}`, `${v} or greater`, `${v} or more`);
    case '<=': return /^\d+$/.test(v) ? alt(`${v} or less`, `${v} or fewer`, `less than or equal to ${v}`) : alt(`less than or equal to ${v}`, `${v} or less`, `${v} or fewer`);
    // FAST5 T42: a computed value is also written "mana value equal to 1 plus the sacrificed artifact's mana value" (Repurposing Bay)
    case '==': return typeof c.value === 'number' ? v : alt(`equal to ${v}`, v);
    case '!=': return `other than ${v}`;
    case '<': return computed && st.mentioned.has(`x=${JSON.stringify(c.value)}`) ? alt(`less than ${v}`, 'less than X') : `less than ${v}`; // edh-d-23 (Kiora, Sovereign of the Deep)
    case '>': return `greater than ${v}`;
  }
}

function countPhrase(c: { kind: string; cmp?: NumberCmp }, st: RenderState, plural = false): string {
  const k = c.kind;
  // FAST4 T27: kind 'any' is "a counter" of any kind (CR 122.1)
  // FAST5 T41 (CR 122.1): a set of objects "with counters on them" has a counter of any kind on each
  // FAST5X E21 (CR 122.1): one object 'with one or more counters on it' is 'with a counter on it'; 'with no counters on it' has none of any kind
  if (k === 'any' && !c.cmp) return plural ? alt('counters on them', 'one or more counters on them') : alt('a counter on it', 'one or more counters on it', 'counters on it' /* edhn63: Cleopatra, Exiled Pharaoh */);
  // FAST5 T59 (CR 122.1): "creature with no counters on it": the sum of the counters of every kind is 0 (rules/filter.ts); no other count of any kind is a phrase
  if (k === 'any' && c.cmp?.op === '==' && c.cmp.value === 0) return plural ? 'no counters on them' : 'no counters on it';
  // r4-static (CR 122.1): "with three or more counters on it": counters of any kind together
  if (k === 'any' && !plural && (c.cmp?.op === '>=' || c.cmp?.op === '<=')) return `${typeof c.cmp.value === 'number' ? numWord(c.cmp.value) : K.qty(c.cmp.value, st)} or ${c.cmp.op === '>=' ? 'more' : 'fewer'} counters on it`;
  if (k === 'any') throw new NoRenderer('a counted number of counters of any kind in a filter');
  // FAST4 T33 (CR 122.1): a set of objects says "with +1/+1 counters on them" or "with a +1/+1 counter on them" (one or more each; family counters-on-them)
  if (!c.cmp && plural) return alt(`${withArticle(`${k} counter`)} on them`, `${k} counters on them`);
  // edh-c-53 (CR 122.1; Cinderslash Ravager): one object too, "permanents you control with oil counters on it" (one or more; family counters-on-them)
  if (!c.cmp) return alt(`${withArticle(`${k} counter`)} on it`, `${k} counters on it`);
  const n = c.cmp.value;
  const word = typeof n === 'number' ? numWord(n) : K.qty(n, st);
  const noun = `${k} counter${typeof n === 'number' && n === 1 ? '' : 's'}`;
  // p2-counters-state-1 (CR 122.1): a set of objects counts the counters on each, "creatures you control with three or more +1/+1 counters on them" (Runadi,
  // Behemoth Caller), "creatures with no +1/+1 counters on them" (Hindervines); no Oracle text says "on it" after a counted plural
  const on = plural ? 'on them' : 'on it';
  switch (c.cmp.op) {
    case '>=': return `${word} or more ${k} counters ${on}`;
    case '<=': return `${word} or fewer ${k} counters ${on}`;
    case '==': return typeof n === 'number' && n === 0 ? `no ${k} counters ${on}` : `${word} ${noun} ${on}`;
    case '!=': return `a number of ${k} counters other than ${word} ${on}`;
    case '<': return `fewer than ${word} ${k} counters ${on}`;
    case '>': return `more than ${word} ${k} counters ${on}`;
  }
}

/** The adjective an Aura, Equipment or Fortification gives its attached object. */
export function attachWord(st: RenderState): string {
  const t = st.ctx.selfTypes?.map((x) => x.toLowerCase());
  if (t?.includes('equipment')) return 'equipped';
  if (t?.includes('fortification')) return 'fortified';
  if (t?.includes('aura')) return 'enchanted';
  return displayFirst('attached', 'enchanted', 'equipped', 'fortified');
}

/** "nonartifact, nonblack" in every order (and with "and"): the model says the set, Oracle chooses the order. */
function negationList(negs: string[]): string {
  const perms = (xs: string[]): string[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest])));
  const orders = negs.length <= 3 ? perms(negs) : [negs];
  return alt(...orders.flatMap((o) => [o.join(', '), o.join(' and ')]));
}

function negated(not: ObjectFilter, st: RenderState, p: Parts, plural: boolean): boolean {
  const keys = Object.keys(not).filter((k) => (not as Record<string, unknown>)[k] !== undefined);
  if (keys.length !== 1) return false;
  const k = keys[0]!;
  const v = (not as Record<string, unknown>)[k];
  switch (k) {
    case 'controller': {
      const who = not.controller!;
      if (who === 'you') p.post.push("you don't control");
      else if (who === 'opponent') p.post.push(plural ? alt("an opponent doesn't control", "your opponents don't control") : "an opponent doesn't control");
      else if (who === 'any') return false;
      else p.post.push(`${K.player(who as PlayerRef, st, 'subject').text} ${plural ? "don't" : "doesn't"} control`);
      return true;
    }
    case 'owner': {
      const who = not.owner!;
      p.post.push(who === 'you' ? "you don't own" : who === 'opponent' ? "an opponent doesn't own" : who === 'any' ? '' : `${K.player(who as PlayerRef, st, 'subject').text} doesn't own`);
      return p.post[p.post.length - 1] !== '';
    }
    case 'types': p.negs.push(...(v as string[]).map((t) => `non${lowerType(t)}`)); return true;
    // FAST5 T66 (CR 205.3m): three or more creature types are written as a list, "each creature that isn't a Kraken, Leviathan, or Serpent" (the longer form, not "non-Kraken non-Leviathan non-Serpent")
    case 'subtypes': if ((v as string[]).length >= 3) return false; p.negs.push(...(v as string[]).map((t) => `non-${t}`)); return true;
    case 'supertypes': p.negs.push(...(v as string[]).map((t) => `non${lowerType(t)}`)); return true;
    case 'colors': p.negs.push(...(v as string[]).map((c) => `non${COLOR_WORD[c] ?? c}`)); return true;
    case 'tapped': p.adj.push(v === true ? 'untapped' : 'tapped'); return true;
    case 'token': p.adj.push(v === true ? 'nontoken' : 'token'); return true;
    case 'attacking': if (v === true) { p.adj.push('nonattacking'); return true; } return false;
    case 'blocking': if (v === true) { p.adj.push('nonblocking'); return true; } return false;
    case 'keyword': p.post.push(`without ${[v].flat().join(' or ')}`); return true;
    case 'self': if (v === true) { p.other = true; return true; } return false;
    // p2-pt-2 (CR 109.4, 613.4c): "for each other legendary creature you control" counted for each object a continuous effect modifies: not the object modified
    case 'is': if ((v as { ref?: string }).ref === 'subject' && Object.keys(v as object).length === 1) { p.other = true; return true; } return false;
    // CLOUD C5 (CR 607.2d): "creatures that aren't of the chosen type" (Kindred Dominance)
    case 'chosen': {
      const q = not.chosen!.quality;
      // edh-b-14 (CR 608.2d, 607.2d; Harsh Mercy): the types every player chose are "a type chosen this way", also after "that aren't"
      // edh-c-78 (CR 202.3; Ashling's Prerogative): the other parity, "creatures without mana value of the chosen quality"
      if (q === 'oddEven') { p.post.push('without mana value of the chosen quality'); return true; }
      const words = q === 'creatureType' && st.groupChoices?.has(not.chosen!.link) === true ? 'of a type chosen this way'
        : q === 'color' ? 'of the chosen color' : q === 'creatureType' || q === 'cardType' || q === 'landType' || q === 'planeswalkerType' /* edh-d-94 */ ? 'of the chosen type' : undefined;
      if (words === undefined) return false;
      p.post.push(`${plural ? "that aren't" : "that isn't"} ${words}`);
      return true;
    }
    // cloud std-dsk (CR 201.2): "a Room card that doesn't have the same name as a Room you control" (parser/holes/filter.ts#notSameNameAs)
    case 'sharesWith': {
      const sw = not.sharesWith!;
      // r5-static (CR 201.2a): "creatures you control that don't have the same name as ~" (Marvin, Murderous Mimic): the object itself
      if (sw.with.ref === 'self' && sw.quality === 'name') {
        p.notSameName = `that ${plural ? "don't" : "doesn't"} have the same name as ${K.obj({ ref: 'self' }, st, 'object').text}`;
        return true;
      }
      // edh-zones-26 (CR 201.2; Tibalt's Trickery): "a nonland card with a different name than that spell": the name of one object named by a reference, none shared
      if (sw.quality === 'name' && sw.with.ref !== 'each' && sw.with.ref !== 'self' && sw.with.ref !== 'subject' && sw.other !== true) {
        p.post.push(`with a different name than ${K.obj(sw.with, st, 'object').text}`);
        return true;
      }
      // edh-next-41 (CR 205.3m; Radagast the Brown): "a creature card that doesn't share a creature type with a creature you control" (parser/holes/filter.ts#notSharesCreatureType)
      if (sw.with.ref === 'each' && sw.quality === 'creatureType' && sw.other === undefined) {
        p.notSameName = `that ${plural ? "don't" : "doesn't"} share a creature type with ${K.np(sw.with.filter, st, { det: 'a' })}`;
        return true;
      }
      if (sw.with.ref !== 'each' || sw.quality !== 'name') return false;
      // said after the controller and zone phrases of the noun ("target creature you control that doesn't have ..."), where the positive form goes too
      // std-rx32: "another permanent you control" (the object itself is not compared with, `other`)
      const asA = K.np(sw.other === true ? { ...sw.with.filter, self: false } : sw.with.filter, st, { det: 'a' });
      p.notSameName = `that ${plural ? "don't" : "doesn't"} have the same name as ${asA}`;
      // edh-next-126 (CR 201.2; Light-Paws, Emperor's Voice): also "with a different name than each Aura you control" (the same set: no name in common with any of them), from the same words
      const bare = /^an? /.test(asA) ? asA.replace(/^an? /, '') : null;
      if (bare !== null && sw.other !== true && !plural) p.notSameNameEach = `each ${bare}`;
      return true;
    }
    default: return false;
  }
}

function build(f: ObjectFilter, st: RenderState, plural: boolean, o: NpOpts): Parts {
  // edh-d-22 (CR 113.1; Jasmine Boreal of the Seven): "creatures with abilities", the any-of of the three ability kinds, said as one feature of the description
  if (f.anyOf !== undefined && isAnyAbility(f.anyOf) && o.anyAbilities !== true) return build({ ...f, anyOf: undefined }, st, plural, { ...o, anyAbilities: true });
  const p: Parts = { adj: [], heads: [], suffix: '', post: [], elementArticles: false, bare: false, plural, other: false, creatureOptional: false, negs: [] };
  // Standard round 4, r4-trig (CR 115.9b; parser/holes/filter.ts): "a spell that targets an opponent or a creature an opponent controls", one `targets` per option
  const targetOptions = f.stackKind !== undefined && f.anyOf?.length === 2 && f.anyOf.every((x) => Object.keys(x).length === 1 && x.targets !== undefined) ? f.anyOf : null;
  if (targetOptions !== null) {
    const base = build({ ...f, anyOf: undefined }, st, plural, o);
    const said = targetOptions.map((x) => {
      const t = x.targets as { ref?: string; filter?: ObjectFilter };
      const who = (x.targets as { who?: string }).who;
      if (t.ref === 'each' && (who === 'opponent' || who === 'player')) return who === 'opponent' ? 'an opponent' : 'a player';
      return t.ref === 'each' && t.filter !== undefined ? K.np(t.filter, st, { det: 'a' }) : K.player(x.targets as PlayerRef, st, 'object').text;
    });
    // std-rx28 (family targets-or-player): an object first and then a player, "that targets a creature or player" (the article left out)
    const bare = said[1] === 'a player' && targetOptions[0]!.targets !== undefined && (targetOptions[0]!.targets as { filter?: unknown }).filter !== undefined;
    base.post.push(`that ${plural ? 'target' : 'targets'} ${bare ? alt(said.join(' or '), `${said[0]} or player`) : said.join(' or ')}`);
    return base;
  }
  // std-craft-1 (CR 702.167c, 607.2a): "an exiled creature card used to craft ~": one of the cards the craft cost exiled (the object's link `craft`), still in exile,
  // that the one description of `anyOf` describes (parser/templates/zz-cloud/std-craft-1.json); the participle and "used to craft ~" say the zone
  if (f.is?.ref === 'linked' && f.is.link === 'craft' && f.zone === 'exile') {
    const { is: _is, zone: _zone, anyOf, ...others } = f;
    if (anyOf === undefined || anyOf.length !== 1 || anyOf[0]!.zone !== undefined || Object.values(others).some((v) => v !== undefined)) throw new NoRenderer('a card used to craft it with another description');
    const inner = build({ ...anyOf[0]!, zone: 'exile' }, st, plural, { ...o, noZone: true });
    if (inner.whole !== undefined || !inner.heads.length) throw new NoRenderer('"used to craft it" after a whole reference');
    inner.adj.unshift('exiled');
    inner.post.push(`used to craft ${alt(K.obj({ ref: 'self' }, st, 'object').text, 'it')}`);
    return inner;
  }
  // edh-combat-2 (CR 303.4b, 301.5; Reyav, Master Smith): an Aura or an Equipment attached ("a creature you control that's enchanted or equipped"), the
  // two options of exactly that shape (parser/holes/filter.ts#ENCHANTED_OR_EQUIPPED), said after the rest of the description
  if (f.anyOf?.length === 2 && f.anyOf.every((x) => Object.keys(x).length === 1) && f.anyOf[0]!.enchanted === true && f.anyOf[1]!.equipped === true) {
    const inner = build({ ...f, anyOf: undefined }, st, plural, o);
    if (inner.whole !== undefined) throw new NoRenderer('"that is enchanted or equipped" after a whole reference');
    inner.post.push(plural ? 'that are enchanted or equipped' : "that's enchanted or equipped");
    return inner;
  }
  // edh-c-18 (CR 509.1h, 506.4; Heat Stroke): a creature that blocked or was blocked this turn, the two options of exactly that shape (parser/holes/filter.ts#BLOCKED_OR_WAS_BLOCKED)
  if (f.anyOf?.length === 2 && f.anyOf.every((x) => Object.keys(x).length === 1) && f.anyOf[0]!.blockedThisTurn === true && f.anyOf[1]!.wasBlockedThisTurn === true) {
    const inner = build({ ...f, anyOf: undefined }, st, plural, o);
    if (inner.whole !== undefined) throw new NoRenderer('"that blocked or was blocked" after a whole reference');
    inner.post.push(plural ? 'that blocked or were blocked this turn' : 'that blocked or was blocked this turn');
    return inner;
  }
  // p2-pt-2 (CR 109.4, 613.4c): a one-option `anyOf` beside other fields is that option's fields beside them (the parser writes it to add a field to a described
  // set, "for each other Sliver on the battlefield" read for each object modified); never when a key is said on both sides
  if (f.anyOf?.length === 1) {
    const { anyOf: [only], ...rest } = f;
    if (Object.keys(only!).every((k) => (rest as Record<string, unknown>)[k] === undefined)) return build({ ...rest, ...only }, st, plural, o);
  }
  // edh-c-73 (CR 108.3, 109.4; parser/holes/filter.ts#controlForms; Telim'Tor's Edict): "permanent you own or control", the two options of exactly that shape
  if (f.anyOf?.length === 2 && f.controller === undefined && f.owner === undefined && f.anyOf.every((x) => Object.keys(x).length === 1) && f.anyOf[0]!.owner === 'you' && f.anyOf[1]!.controller === 'you') {
    const base = build({ ...f, anyOf: undefined }, st, plural, o);
    if (base.whole !== undefined) throw new NoRenderer('"you own or control" after a whole reference');
    base.post.push('you own or control');
    return base;
  }
  // p2-damage-3 (CR 109.4, 115.1; parser/holes/filter.ts#controlForms): "creatures that player or that planeswalker's controller controls" after "target player or
  // planeswalker": controlled by the target if it is a player, or by its controller if it is a planeswalker (one target, both options of the same one)
  const ppc = f.anyOf?.length === 2 && f.controller === undefined ? f.anyOf : null;
  if (ppc !== null && Object.keys(ppc[0]!).length === 1 && Object.keys(ppc[1]!).length === 1 && typeof ppc[0]!.controller === 'object' && typeof ppc[1]!.controller === 'object') {
    const a = ppc[0]!.controller as PlayerRef;
    const b = ppc[1]!.controller as PlayerRef;
    if (a.ref === 'target' && b.ref === 'controllerOf' && b.object.ref === 'target' && b.object.id === a.id) {
      const base = build({ ...f, anyOf: undefined }, st, plural, o);
      base.post.push(`${K.player(a, st, 'subject').text} or ${K.obj(b.object, st, 'possessive').text} controller controls`);
      return base;
    }
  }
  if (f.anyOf && f.anyOf.length > 0) return buildAnyOf(f, st, plural, o);
  if (f.self === true && Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).length === 1) {
    p.whole = K.obj({ ref: 'self' }, st, 'subject').text;
    return p;
  }
  if (f.is) {
    // FAST4 T19: "a creature dealt damage this way": one of what a step acted on (RefInfo.thisWay) that the rest of the filter describes (design 3.3: ANDed)
    let way = f.is.ref === 'bound' ? st.info.get(`b:${f.is.name}`)?.thisWay : undefined;
    // Cloud r3-moved (CR 608.2c, 400.7): "a land card discarded this way": one of the cards a discard bound, still in the graveyard it put them in (lower/quantities.ts#movedGroups)
    const discarded = way === undefined && f.is.ref === 'bound' && st.info.get(`r:${f.is.name}`)?.moved === 'discarded' && f.zone === 'graveyard' && f.owner === undefined;
    if (discarded) way = 'discarded this way';
    const { is: _is0, ...rest0 } = f;
    // std-lci: what a move exiled is still "those cards" when nothing else describes it (the participle is the reading of a noun with it, below)
    // trek-5 (CR 608.2c; family chosen-cards-named): and what a choice for each player chose is "the chosen cards" when nothing else describes it (render/steps-flow.ts#chooseObjects)
    const bare = (way === 'exiled this way' || way === 'chosen this way') && !Object.values(rest0).some((v) => v !== undefined);
    if (way !== undefined && !bare) {
      const { is: _is, ...all } = f;
      // Cloud std-eoe: "put into a graveyard this way" says the zone itself, and "your graveyard" its owner (parser/holes/filter.ts)
      const putThere = way === PUT_INTO_GRAVEYARD_THIS_WAY && all.zone === 'graveyard' && (all.owner === undefined || all.owner === 'you');
      const { owner: _o, ...noOwner } = all;
      const rest: ObjectFilter = putThere ? noOwner : all; // (the zone stays for the noun, "card"; its words are the participle's: `noZone` below)
      if (putThere && all.owner === 'you') way = 'put into your graveyard this way';
      // edh-zones-22 (CR 701.20a, 608.2c; Old Stickfingers): the cards of a counted reveal until are the ones it stopped at, so a description that names others than those ("Horror cards revealed this way" after
      // "until you reveal X creature cards") is another group, not this one: not said
      const hits = way === 'revealed this way' && f.is.ref === 'bound' ? st.info.get(`b:${f.is.name}`)?.hitsAre : undefined;
      if (hits !== undefined) {
        const one = all.anyOf?.length === 1 && Object.keys(all).filter((k) => (all as Record<string, unknown>)[k] !== undefined).sort().join(',') === 'anyOf,zone' ? all.anyOf[0] : (all.anyOf === undefined ? all : undefined); // edh-d-35 (Mass Polymorph): or the one description itself, when the parser folded its single `anyOf`
        if (one === undefined || np({ ...one, zone: 'library' }, st, { det: 'none', plural: true, noZone: true }) !== hits) throw new NoRenderer('"revealed this way" after a description that is not the one the reveal stopped at');
      }
      // edh-replace-2 (CR 608.2c, 120.3): "a permanent dealt damage this way" (Spikefield Hazard): the generic noun is `permanent`, a description with no field of its own
      if (!Object.values(rest).some((v) => v !== undefined) && !(way === 'dealt damage this way' && o.head === undefined)) throw new NoRenderer(`"${way}" without a noun`);
      // std-lci: "card exiled this way" says where the card is (parser/holes/filter.ts#EXILED_THIS_WAY reads the zone with the participle): no "in exile"
      const inner = build(way === 'revealed this way' && rest.zone === 'any' ? { ...rest, zone: 'library' } : rest /* trek-17: said as a card of a library, the group's cards are cards wherever they are now */, st, plural, putThere || discarded || (way === 'exiled this way' && rest.zone === 'exile') || (way === 'revealed this way' && (rest.zone === 'library' || rest.zone === 'any' /* trek-17: drawn since, or moved otherwise */)) /* edh-zones-18 */ ? { ...o, noZone: true } : o);
      if (inner.whole !== undefined) throw new NoRenderer(`"${way}" after a whole reference`);
      // trek-5 (CR 108.3, 406.1, 608.2c; family owner-in-exiled-this-way): the owner of a card exiled this way is a part of where it is, so the participle may say whose it is, "a land
      // card that player owns exiled this way" (a player the effect iterates over), or leave it to the participle as before
      const owns = way === 'exiled this way' && rest.zone === 'exile' && rest.owner !== undefined && typeof rest.owner === 'object' ? ownerWords(rest.owner, st) : '';
      // edh-next-127 (CR 400.3, 608.2c; Danse Macabre; family put-into-graveyards-this-way): the cards of several players' graveyards are also "put into graveyards this way" (each card went to its owner's)
      const graveyards = putThere && all.owner === undefined && way === PUT_INTO_GRAVEYARD_THIS_WAY ? alt(way, 'put into graveyards this way') : way;
      inner.post.push(way === 'fought this way' ? 'that fought this way' /* trek-22 */ : owns === '' ? graveyards : alt(way, `${owns} ${way}`));
      return inner;
    }
    // std-rx5 (CR 607.2a): "target creature card exiled with ~": one of what the linked exiling instruction exiled, that the rest of the filter describes; the
    // participle says the zone (parser/holes/filter.ts#W_EXILED_WITH_SELF)
    if (f.is.ref === 'linked' && f.is.link === 'exiled' && f.zone === 'exile' && Object.entries(rest0).some(([k, v]) => v !== undefined && k !== 'zone')) {
      const inner = build(rest0, st, plural, { ...o, noZone: true });
      if (inner.whole !== undefined) throw new NoRenderer('"exiled with ~" after a whole reference');
      inner.post.push(`exiled with ${K.obj({ ref: 'self' }, st, 'object').text}`);
      return inner;
    }
    // edh-next-139 (CR 607.2a; Havengul Mystery): "the creature put onto the battlefield with ~": what the linked instruction put onto the battlefield, a creature
    if (f.is.ref === 'linked' && f.is.link === 'putOntoWith' && !plural && Object.entries(rest0).every(([k, v]) => v === undefined || (k === 'types' && Array.isArray(v) && v.length === 1 && v[0] === 'Creature'))) {
      p.whole = `the creature put onto the battlefield with ${K.obj({ ref: 'self' }, st, 'object').text}`;
      return p;
    }
    p.whole = K.obj(f.is as ObjRef, st, 'subject').text;
    return p;
  }
  // M11-4 (CR 903.3, 903.3e; 702.124e: with two commanders, either one): "your commander" is a commander you own (parser/holes/filter.ts); "you control your
  // commander" (CR 903.3d) is the controller beside it, which the caller words ("you control" + this phrase). The other reading is the plain one. std-rl: so are
  // the commanders you own in every zone ("the greatest mana value among your commanders", parser/holes/qty.ts#commandersAnywhere)
  const present = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined);
  if (f.commander === true && f.owner === 'you' && (o.det === undefined || o.det === 'a' || o.det === 'none') && o.count === undefined && !o.head
    && (f.zone === undefined || f.zone === 'battlefield' || f.zone === 'any') && present.every((k) => k === 'commander' || k === 'owner' || k === 'zone' || (k === 'controller' && o.noController === true))) {
    p.whole = plural ? alt('your commanders', 'commanders you own') : alt('your commander', 'a commander you own');
    return p;
  }
  // MX3 (CR 701.54e): "your Ring-bearer" (one permanent or none); "a Ring-bearer" / "Ring-bearers" is a head noun of its own (below)
  if (f.ringBearer === 'you' && Object.entries(f).every(([k, v]) => v === undefined || k === 'ringBearer')) {
    if (plural) throw new NoRenderer('"your Ring-bearer" is one permanent');
    p.whole = 'your Ring-bearer';
    return p;
  }
  if (f.ringBearer !== undefined && f.ringBearer !== 'any') throw new NoRenderer('a Ring-bearer of one player among other filter fields');
  if (f.ringBearer === 'any' && ((f.types ?? []).length > 0 || (f.allTypes ?? []).length > 0 || (f.subtypes ?? []).length > 0 || f.stackKind !== undefined || o.head !== undefined)) throw new NoRenderer('"Ring-bearer" is the head noun: no type words beside it');
  const zs = zonesOf(f);
  const bf = isBattlefield(zs);
  const onStack = zs.length === 1 && zs[0] === 'stack';
  // design 3.3: every present field is ANDed. A field with no wording is refused, never dropped (a dropped constraint passes the gate unseen).
  // `self:true` beside other fields would name the source and say nothing of the rest; `self:false` is "another" (CR 109.1).
  if (f.self === true) throw new NoRenderer('self:true combined with other filter fields');
  // FAST5 T62 (CR 603.4): "five other Forests" after "Whenever a Forest you control enters": not the object the trigger event is about (parser/lower/ability.ts#otherThanEventSubject)
  const notEvent = isNotEventSubject(f.not);
  p.other = f.other === true || f.self === false || notEvent;
  // tokens are not cards (CR 111.1): `isCard:false` is a token
  if (f.isCard === false && !bf) throw new NoRenderer('isCard:false outside the battlefield');
  const isToken = f.token === true || f.isCard === false;
  if (f.transformed === false) throw new NoRenderer('transformed:false has no wording');
  if (f.isCopy === false) throw new NoRenderer('isCopy:false has no wording');
  if (f.monocolored === false) throw new NoRenderer('monocolored:false has no wording');
  if (f.allColors === true) throw new NoRenderer('allColors:true has no wording'); // edh-d-51

  // --- adjectives -------------------------------------------------------------------------------------------------------------------------------------
  if (f.token === false || (f.isCard === true && bf)) p.adj.push('nontoken');
  if (f.faceDown === true) p.adj.push('face-down');
  else if (f.faceDown === false) p.adj.push('face-up');
  if (f.transformed === true) p.adj.push('transformed');
  if (f.doubleFaced === true) p.adj.push('double-faced'); // std-rx31: CR 712.1
  else if (f.doubleFaced === false) throw new NoRenderer('doubleFaced:false has no wording');
  if (f.tapped === true) p.adj.push('tapped');
  else if (f.tapped === false) p.adj.push('untapped');
  const attackingYou = typeof f.attacking === 'object' && f.attacking.defender === 'you' && f.attacking.orPlaneswalker === undefined;
  if (f.attacking === true) p.adj.push('attacking');
  else if (f.attacking === false) p.adj.push('nonattacking');
  // r4-static (CR 508.1b, 102.3): attacking a player who is an opponent (not a planeswalker or battle), "each creature that's attacking one of your opponents"
  // edh-next-84 (CR 506.3, 508.5; Roar of Resistance): an opponent or a planeswalker an opponent controls (`orPlaneswalker`): the plural wording only (it was said as "attacking your opponents" before, which is a player alone)
  else if (f.attacking && typeof f.attacking === 'object' && f.attacking.defender === 'opponent' && f.attacking.orPlaneswalker === true) {
    p.post.push(plural ? 'attacking your opponents and/or planeswalkers they control' : "that's attacking one of your opponents or a planeswalker an opponent controls");
  }
  else if (f.attacking && typeof f.attacking === 'object' && f.attacking.defender === 'opponent') p.post.push(plural ? alt("that are attacking one of your opponents", 'attacking one of your opponents', 'attacking your opponents' /* edh-combat-7 (Blast-Furnace Hellkite) */) : alt("that's attacking one of your opponents", 'attacking one of your opponents'));
  // p2-combat-flow-1: attacking you, said after the other words that follow the noun (below, with "that's attacking alone")
  else if (attackingYou) { /* below */ }
  // pc-combat-3 (CR 506.3, 508.1b; Soul Snare): attacking you or a planeswalker you control
  else if (f.attacking && typeof f.attacking === 'object' && f.attacking.defender === 'you' && f.attacking.orPlaneswalker === true) p.post.push(plural ? alt('that are attacking you or a planeswalker you control', 'attacking you or a planeswalker you control') : alt("that's attacking you or a planeswalker you control", 'attacking you or a planeswalker you control'));
  else if (f.attacking && typeof f.attacking === 'object' && f.attacking.orPlaneswalker === true) throw new NoRenderer('attacking a player or a planeswalker other than "you or a planeswalker you control"');
  // edh-perms-17 (CR 508.1b; Echoing Assault): attacking a player the text named, "target nontoken creature that's attacking that player" (family attacking-you-relative says the same of "you")
  else if (f.attacking && typeof f.attacking === 'object') {
    const def = K.player(f.attacking.defender as PlayerRef, st, 'object').text;
    p.post.push(f.attacking.defender === 'you' || plural ? `attacking ${def}` : alt(`attacking ${def}`, `that's attacking ${def}`, `that is attacking ${def}`));
  }
  // FAST4 T32: "an attacking nontoken creature" is Oracle's order of the same two adjectives (design 3.3: the fields are ANDed, the order says nothing)
  const ntIdx = p.adj.indexOf('nontoken');
  if (ntIdx >= 0 && p.adj[ntIdx + 1] === 'attacking' && ntIdx + 2 === p.adj.length) p.adj.splice(ntIdx, 2, alt('nontoken attacking', 'attacking nontoken'));
  // edh-next-8 (Meria, Scholar of Antiquity): "an untapped nontoken artifact", the same two adjectives in the other order (family untapped-nontoken-order)
  // edh-d-73 (Illithid Harvester): and "target tapped nontoken creatures", the same with "tapped"
  else if (ntIdx >= 0 && (p.adj[ntIdx + 1] === 'untapped' || p.adj[ntIdx + 1] === 'tapped') && ntIdx + 2 === p.adj.length) p.adj.splice(ntIdx, 2, alt(`nontoken ${p.adj[ntIdx + 1]}`, `${p.adj[ntIdx + 1]} nontoken`));
  if (f.blocking === true) p.adj.push('blocking');
  else if (f.blocking === false) p.adj.push('nonblocking');
  if (f.blocked === true) p.adj.push('blocked');
  // p2-combat-flow-2 (CR 509.1h; family unblocked-attacking-order): "unblocked attacking creature" is Oracle's order of the same two adjectives (Curtain of Light)
  else if (f.blocked === false && p.adj[p.adj.length - 1] === 'attacking') p.adj.splice(p.adj.length - 1, 1, alt('attacking unblocked', 'unblocked attacking'));
  else if (f.blocked === false) p.adj.push('unblocked');
  // FAST4 T33: "attacking equipped creature" (CR 301.5), "modified creatures" (CR 700.9)
  // std-hob (CR 301.5): Oracle also says "equipped attacking creature" (Dáin Ironfoot), the same two adjectives in the other order (design 3.3: the fields are ANDed)
  if (f.equipped === true && f.attacking === true && p.adj[p.adj.length - 1] === 'attacking') p.adj.splice(p.adj.length - 1, 1, alt('attacking equipped', 'equipped attacking'));
  else if (f.equipped === true) { p.adj.push('equipped'); if (plural) p.equippedPost = true; } // edh-next-8 (family equipped-that-are): "creatures you control that are equipped" says the same set
  else if (f.equipped === false) throw new NoRenderer('equipped:false has no wording');
  if (f.modified === true) p.adj.push('modified');
  else if (f.modified === false) throw new NoRenderer('modified:false has no wording');
  // FAST5 T39 (CR 303.4b): "enchanted creatures you control"
  if (f.enchanted === true) { p.adj.push('enchanted'); if (plural) p.enchantedPost = true; } // edh-c-20 (family enchanted-that-are): "creatures you control that are enchanted" says the same set
  else if (f.enchanted === false) p.post.push(plural ? "that aren't enchanted" : "that isn't enchanted"); // p2-damage-3 (CR 303.4b): Winds of Rath, Brainspoil
  if (f.allColors === false) p.post.push(plural ? "that aren't all colors" : "that isn't all colors"); // edh-d-51 (CR 105.2; Iridian Maelstrom)
  if (f.minCardTypes !== undefined) { if (!Number.isInteger(f.minCardTypes) || f.minCardTypes < 2 || f.minCardTypes > 4) throw new NoRenderer('minCardTypes other than 2-4'); p.post.push(`with ${numWord(f.minCardTypes)} or more card types`); } // edh-d-86 (CR 205.2a; Rendmaw, Creaking Nest)
  // FAST5X E3 (CR 702.171b): "a saddled creature"
  if (f.saddled === true) p.adj.push('saddled');
  else if (f.saddled === false) throw new NoRenderer('saddled:false has no wording in a noun phrase');
  // FAST5X E12 (CR 701.60b): "a suspected creature"
  if (f.suspected === true) p.adj.push('suspected');
  // std-costs-2 (CR 702.185a): "a warped creature card"
  if (f.warped === true) p.adj.push('warped');
  else if (f.suspected === false) throw new NoRenderer('suspected:false has no wording in a noun phrase');
  // std-rx34 (CR 701.37b): "a monstrous creature"
  if (f.monstrous === true) p.adj.push('monstrous');
  else if (f.monstrous === false) throw new NoRenderer('monstrous:false has no wording in a noun phrase');
  // M12-3 (CR 701.15b): "a goaded creature"
  if (f.goaded === true) p.adj.push('goaded');
  else if (f.goaded === false) throw new NoRenderer('goaded:false has no wording in a noun phrase');
  // std-ry8 (CR 702.112b): "a renowned creature"
  if (f.renowned === true) p.adj.push('renowned');
  else if (f.renowned === false) throw new NoRenderer('renowned:false has no wording in a noun phrase');
  // edh-top-2 (CR 702.95b): "another unpaired creature you control", "a paired creature"
  if (f.paired === true) p.adj.push('paired');
  else if (f.paired === false) p.adj.push('unpaired');
  // std-copy-2 (CR 722.3d): "a prepared spell" (a prepare spell, rules/filter.ts#isPrepareSpell)
  if (f.prepareSpell === true) p.adj.push('prepared');
  else if (f.prepareSpell === false) throw new NoRenderer('prepareSpell:false has no wording in a noun phrase');
  const bareAttached = f.attachedToSource === true && !f.types?.length && !f.allTypes?.length && !f.subtypes?.length && !f.stackKind;
  if (f.attachedToSource === true) {
    p.bare = true;
    if (!bareAttached) p.adj.push(attachWord(st));
  }
  for (const s of f.supertypes ?? []) p.adj.push(lowerType(s));
  // edh-replace-2 (CR 105.2; family colors-and-or): a list of colors is "black or red" and also "black and/or red" (Surge of Salvation): "or" in Magic text includes both
  if (f.colors && f.colors.length > 0) {
    const names = f.colors.map((c) => COLOR_WORD[c] ?? c);
    p.adj.push(names.length > 1 ? alt(joinList(names, 'or'), joinList(names, 'and/or')) : joinList(names, 'or'));
  }
  // edh-c-8 (family nontoken-color-order; Spectral Bears): "black nontoken permanents" is Oracle's order of "nontoken black permanents" (design 3.3: the fields are ANDed, the order says nothing); one color only
  const ntC = p.adj.indexOf('nontoken');
  if (f.token === false && ntC >= 0 && ntC + 2 === p.adj.length && f.colors?.length === 1) p.adj.splice(ntC, 2, alt(`nontoken ${p.adj[ntC + 1]!}`, `${p.adj[ntC + 1]!} nontoken`));
  if (f.colorless === true) p.adj.push('colorless');
  else if (f.colorless === false) p.adj.push('colored');
  if (f.multicolored === true) p.adj.push('multicolored');
  else if (f.multicolored === false) p.adj.push('nonmulticolored');
  if (f.kicked === true) p.adj.push('kicked'); // edh-next-13 (CR 702.33d): "kicked spells"
  if (f.monocolored === true) p.adj.push('monocolored');
  for (const c of f.notColors ?? []) p.negs.push(`non${COLOR_WORD[c] ?? c}`);
  for (const t of f.notTypes ?? []) p.negs.push(`non${lowerType(t)}`);
  for (const t of f.notSupertypes ?? []) p.negs.push(`non${lowerType(t)}`);
  // FAST5X E1, CR 700.12: the five outlaw creature types together are "non-outlaw"
  if (isOutlaws(f.notSubtypes)) p.negs.push('non-outlaw');
  else for (const t of f.notSubtypes ?? []) p.negs.push(`non-${t}`);
  // edh-perms-7 (CR 205.3m; Swarmyard Massacre): a creature type list on one card type is also "creature that isn't an Insect, Rat, Spider, or Squirrel" (compose says both)
  if (!plural && (f.notSubtypes?.length ?? 0) >= 1 && (f.notSubtypes?.length ?? 0) <= 5 && (f.types?.length === 1 || ((f.types?.length ?? 0) === 0 && f.subtypes?.length === 1)) && !isOutlaws(f.notSubtypes) && p.negs.length === f.notSubtypes!.length) p.notSubs = f.notSubtypes!;
  // C6 (CR 608.2c): without what an earlier step of the ability chose, "creatures they control not chosen this way", "all creatures except creatures chosen this way"
  // (said last, after the controller: below)
  let noCounterAt = -1; // edh-c-52
  const notWay = f.not?.is?.ref === 'bound' ? st.info.get(`b:${f.not.is.name}`)?.thisWay : undefined;
  // r4-mech (CR 108.3, 109.4): "you control but don't own" is said with the controller (below)
  const butNotOwn = f.controller === 'you' && f.not !== undefined && JSON.stringify(f.not) === '{"owner":"you"}' && !o.noController;
  if (f.not && notWay !== undefined) { /* C6: below */ }
  else if (butNotOwn) { /* r4-mech: below */ }
  else if (f.not && !notCastFromHand(f.not) && !isNoAbilities(f.not) && !notEvent && !otherThanObject(f.not) && !otherThanObjectOrSelf(f.not) && !otherThanSelfAndChosen(f.not)) {
    // pc-counters-1/2 (CR 122.1): "each creature without a +1/+1 counter on it" (the filter's `not` is only a counter of one kind; Oracle says "on it" in the plural too)
    const noCounter = Object.keys(f.not).filter((k) => (f.not as Record<string, unknown>)[k] !== undefined).join() === 'counters' && f.not.counters?.cmp === undefined && f.not.counters?.kind !== 'any';
    // edh-d-4 (CR 605.1a; Midnight Arsonist): "target artifacts without mana abilities" (the filter's `not` is only the mana-ability kind)
    if (JSON.stringify(f.not) === '{"hasAbility":"mana"}') p.post.push('without mana abilities');
    else if (noCounter) {
      const kind = f.not.counters!.kind;
      noCounterAt = p.post.push(`without ${withArticle(`${kind} counter`)} on it`) - 1; // Oracle says "on it" after "each creature" too
    } else if (!negated(f.not, st, p, plural)) {
      const isnt = `that isn't ${K.np(f.not, st, { det: 'a', noZone: true })}`;
      // edh-d-12 (Surgical Extraction): a description of cards (zone words in `post`) that leaves out one plain kind is also "target card in a graveyard other than a basic land card"
      const plainKind = !plural && o.det !== 'each' && f.zone !== undefined && f.not.is === undefined && Object.keys(f.not).filter((k) => (f.not as Record<string, unknown>)[k] !== undefined).every((k) => k === 'types' || k === 'supertypes') && f.types === undefined;
      if (plainKind) p.otherThanKind = { isnt, kind: `${K.np(f.not, st, { det: 'a', noZone: true })} card` };
      // FAST5 T49 (CR 205.2, 608.2b): "deals 4 damage to each creature except for tokens you control": the set without a smaller set of its own kind
      p.post.push(plural || o.det === 'each' ? alt(isnt, `except for ${K.np(f.not, st, { det: 'none', plural: true, noZone: true })}`) : isnt);
    }
  }
  // M11-4 (CR 903.3): "noncommander creature" (parser/holes/filter.ts#negated)
  if (f.commander === false) p.negs.push('noncommander');
  // FAST5 T66: "nonland, nontoken permanent": nontoken is one of the negations when others are said, and is listed with them
  const ntAt = p.adj.indexOf('nontoken');
  if (ntAt >= 0 && p.negs.length > 0) { p.adj.splice(ntAt, 1); p.negs.push('nontoken'); }
  // several negations are a set: Oracle lists them in an order of its own ("nonartifact, nonblack creature")
  // edh-next-22 (CR 105.1, 205.4a; family color-negation-order; Woodland Bellower): "a nonlegendary green creature card" is Oracle's order of "a green nonlegendary creature card" (design 3.3: the fields are ANDed, the order says nothing); one color, one negation, nothing else before them
  const colorAt = f.colors?.length === 1 ? p.adj.length - 1 : -1;
  if (p.negs.length === 1 && colorAt === 0 && p.adj[0] === (COLOR_WORD[f.colors![0]!] ?? f.colors![0]!)) p.adj.splice(0, 1, alt(`${p.adj[0]!} ${p.negs[0]!}`, `${p.negs[0]!} ${p.adj[0]!}`));
  // edh-c-54 (CR 506.4, 205.2; family attacking-nonwhite-order; Exile): "nonwhite attacking creature" is Oracle's order of "attacking nonwhite creature" (design 3.3: the fields are ANDed, the order says nothing); one negated color after "attacking"
  else if (p.negs.length === 1 && (f.notColors?.length ?? 0) === 1 && p.adj.length > 0 && p.adj[p.adj.length - 1] === 'attacking') p.adj.splice(p.adj.length - 1, 1, alt(`attacking ${p.negs[0]!}`, `${p.negs[0]!} attacking`));
  else if (p.negs.length === 1) p.adj.push(p.negs[0]!);
  else if (p.negs.length > 1) p.adj.push(negationList(p.negs));
  // edh-next-22 (CR 111.1, 708.2; family nontoken-face-order; Whisperwood Elemental): "nontoken face-up creatures" is Oracle's order of "face-up nontoken creatures" (design 3.3: the fields are ANDed, the order says nothing)
  const ntF = p.adj.indexOf('nontoken');
  if (ntF >= 0 && (p.adj[ntF + 1] === 'face-up' || p.adj[ntF + 1] === 'face-down')) p.adj.splice(ntF, 2, alt(`nontoken ${p.adj[ntF + 1]!}`, `${p.adj[ntF + 1]!} nontoken`));
  // edhv31 (Assassin's Blade): "target nonblack attacking creature", the same two adjectives as "attacking nonblack" (family attacking-nonblack-order)
  const ncIdx = p.adj.findIndex((a) => /^non(?:white|blue|black|red|green)$/.test(a));
  if (ncIdx >= 0 && p.adj[ncIdx - 1] === 'attacking' && ncIdx + 1 === p.adj.length) p.adj.splice(ncIdx - 1, 2, alt(`attacking ${p.adj[ncIdx]}`, `${p.adj[ncIdx]} attacking`));
  // edh-next-31 (CR 205.2a, 506.4; family attacking-color-order; Tori D'Avenant, Fury Rider): "other red attacking creatures" is Oracle's order of "other attacking red creatures" (design 3.3: the fields are ANDed, the order says nothing); one color right after "attacking"
  const colWord = f.colors?.length === 1 ? (COLOR_WORD[f.colors[0]!] ?? f.colors[0]!) : undefined;
  if (colWord !== undefined && o.anyOfOption !== true && p.adj.length >= 2 && p.adj[p.adj.length - 2] === 'attacking' && p.adj[p.adj.length - 1] === colWord && p.negs.length === 0) p.adj.splice(p.adj.length - 2, 2, alt(`attacking ${colWord}`, `${colWord} attacking`));
  // edh-perms-9 (family except-for-kinds; Elspeth Tirel): "all other permanents except for lands and tokens" is "all other nonland, nontoken permanents"
  if (plural && p.negs.length >= 2 && p.adj.length === 1 && (f.notColors ?? []).length === 0 && (f.notSupertypes ?? []).length === 0 && f.commander !== false) {
    const kinds = [...(f.notTypes ?? []).map((x) => pluralize(lowerType(x))), ...(f.notSubtypes ?? []).map((x) => pluralize(x)), ...(f.token === false ? ['tokens'] : [])];
    if (kinds.length === p.negs.length) p.exceptList = joinList(kinds, 'and');
  }

  // --- head ----------------------------------------------------------------------------------------------------------------------------------------------
  const types = (f.types ?? []).map(lowerType);
  const all = (f.allTypes ?? []).map(lowerType);
  const subtypes = f.subtypes ?? [];
  let basicLandType = false; // edh-zones-1
  // M11-4 (CR 903.3, 903.3d): the designation is the adjective next to a type or "spell" ("commander creatures you control", "commander spells you cast") and
  // the noun itself otherwise ("a commander", "commanders you control", "a commander you own in the command zone": no "card" or "permanent" after it)
  const commanderNoun = f.commander === true && types.length === 0 && all.length === 0 && subtypes.length === 0 && !isToken && !f.stackKind && !onStack && !o.head;
  if (f.commander === true && !commanderNoun) {
    if (isToken) throw new NoRenderer('a commander token'); // CR 903.3: a token is never a commander
    p.adj.push('commander');
  }
  if (commanderNoun) {
    p.heads = ['commander'];
  } else if (f.stackKind || onStack) {
    p.heads = [f.loyaltyAbility === true && f.stackKind === 'activatedAbility' ? 'loyalty ability' : (STACK_HEAD[f.stackKind ?? 'spell'] ?? 'spell')]; // edhd36
    // "Goblin creature spells", "Aura spells": the subtypes come before the types (CR 205.3)
    if (isOutlaws(subtypes)) {
      // FAST5 T45, CR 700.12: "an outlaw spell" (parser/holes/filter.ts reads the word as the five creature types); FAST5X E20 (family outlaw-word): with no
      // card type, also the five types listed ("an Assassin, Mercenary, Pirate, Rogue, or Warlock spell")
      p.adj.push(types.length === 0 ? alt('outlaw', joinList(subtypes, 'or')) : 'outlaw');
    } else if (subtypes.length > 0) {
      // edh-cast-8 (CR 110.4b; Archmage of Echoes): "a Faerie or Wizard permanent spell": the subtypes with exactly the six permanent types (no one subtype goes with all of them)
      if (!(types.length > 0 && isPermanentTypes(types) && all.length === 0)) checkSubtypeTypes(f.types ?? [], subtypes, f.other === true);
      p.adj.push(joinList(subtypes, 'or'));
    }
    // FAST1 T5: a set of spells of several types also reads "instant and sorcery spells" (family type-list)
    // FAST5 T45 (same family): after "for each" too, "for each other instant and sorcery spell you've cast before it this turn" (each spell that is one of them)
    // std-lci (CR 110.4b): the six permanent types are what "permanent spell" means (parser/holes/filter.ts reads it so, as "permanent card")
    if (types.length > 0 && isPermanentTypes(types) && all.length === 0) p.adj.push('permanent');
    // edh-next-113 (family and-or-types; Display of Power): and a single targeted spell of either type, "target instant and/or sorcery spell" (no "and": one spell has one of them)
    else if (types.length > 0) {
      const several = (plural || o.forEach === true) && types.length > 1;
      p.adj.push(several || (o.det === 'target' && o.anyOfOption !== true && types.length === 2 && subtypes.length === 0 && all.length === 0) ? alt(joinList(types, 'or'), ...(several ? [joinList(types, 'and')] : []), andOr(types)) : joinList(types, 'or'));
    }
    if (all.length > 0) p.adj.push(all.join(' '));
  } else if (subtypes.length >= 1 && !isToken && all.length === 0 && isPermanentTypes(types)) { // edh-c-86: also several subtypes ("Bird and/or Cleric permanent cards")
    // FAST2 T10: "a Rebel permanent card" (CR 110.4: a card of a permanent type) is the subtype with exactly the six permanent types
    p.heads = subtypes.slice();
    p.suffix = bf ? 'permanent' : 'permanent card';
  } else if (isOutlaws(subtypes) && types.length === 0 && all.length === 0 && !isToken && !bareAttached && f.attachedToSource === undefined) {
    p.heads = ['outlaw']; // FAST5 T60, CR 700.12: "outlaws you control", "affinity for outlaws" (parser/holes/filter.ts reads the bare plural as the five creature types)
  } else if (isOutlaws(subtypes) && types.length === 1 && types[0] === 'creature' && all.length === 0 && !isToken) {
    // FAST5X E1, CR 700.12: "an outlaw creature" (parser/holes/filter.ts reads the word as the five creature types)
    p.adj.push('outlaw');
    p.heads = ['creature'];
  } else if (isOutlaws(subtypes) && types.length === 0 && all.length === 0 && !isToken) {
    // FAST5X E20, CR 700.12: "an outlaw", "outlaws you control" (parser/holes/filter.ts reads the noun as the five creature types) (FAST5 T62: "another outlaw you control")
    p.heads = ['outlaw'];
  } else if (isBasicLandTypeLand(types, all, subtypes) && !isToken) {
    // edh-zones-1 (CR 205.3i; family basic-land-type-with): a land that has a basic land type, "a land card with a basic land type" (parser/holes/filter.ts#featureAt)
    p.heads = ['land'];
    basicLandType = true;
  } else if (subtypes.length > 0) {
    const sub = subtypes.slice();
    checkSubtypeTypes(f.types ?? [], sub, f.other === true);
    // edh-mana-keywords-3 (CR 205.3i): "Urza's" is a land type that Oracle says with its noun, "an Urza's land you control", "for each Urza's land you control" (Urza's
    // Workshop): not "Urza'ses"; the head is the two words, so the plural is "Urza's lands"
    p.heads = sub.length === 1 && sub[0] === "Urza's" && types.length === 1 && types[0] === 'land' && !isToken ? ["Urza's land"] : sub;
    // "Knight creatures" (types and subtypes) is not "Knights" (subtypes alone: any permanent or spell with the subtype)
    p.creatureOptional = types.includes('creature') && !isToken;
    p.elementArticles = sub.length > 1 && !p.creatureOptional;
    // FAST3 T12: "as long as you control a Garruk planeswalker" names the card type the planeswalker type belongs to (CR 205.3j); the words without it stay
    if (!isToken && sub.length === 1 && types.length === 1 && f.types![0] === 'Planeswalker' && OTHER_SUBTYPES[sub[0]!]?.includes('Planeswalker')) p.typeAfter = 'planeswalker';
    if (isToken) p.suffix = 'token';
    if (isToken && types.includes('creature') && sub.length === 1 && types.length === 1) p.tokenCreatureWord = true;
  } else if (types.length > 0 || all.length > 0) {
    if (all.length > 0 && types.length === 0) p.heads = [all.join(' ')];
    // FAST1 T6: the six permanent types are what "permanent card" means (CR 110.4; parser/holes/filter.ts lowers "permanent card" to them)
    else if (all.length === 0 && !isToken && isPermanentTypes(types)) p.heads = ['permanent'];
    else {
      p.heads = types;
      if (all.length > 0) p.adj.push(all.join(' '));
    }
    if (isToken) p.suffix = 'token';
  } else if (f.ringBearer === 'any') {
    if (!bf || isToken) throw new NoRenderer('a Ring-bearer outside the battlefield or as a token');
    p.heads = ['Ring-bearer']; // MX3 (CR 701.54b): a permanent with the designation
  } else if (isToken) {
    p.heads = ['token'];
  } else if (bareAttached) {
    p.headChoice = attachedOptions(st);
    p.heads = [p.headChoice[0]!];
  } else {
    p.heads = [bf ? 'permanent' : f.isCard ? 'card' : 'card'];
  }
  if (!bf && !onStack && !f.stackKind && zs[0] !== 'any' && p.suffix === '' && p.heads[0] !== 'card' && !isToken && !commanderNoun) p.suffix = 'card';
  if (f.isCard === true && !bf && p.heads[0] === 'card') p.heads = ['card'];
  if (o.head) {
    // FAST5 T48: a set of spells of several types also reads "instant and sorcery spells" (CR 106.6: "Spend this mana only to cast instant and sorcery spells")
    // CLOUD std-ecl (CR 110.4): the six permanent types are "permanent" here too, "one or more permanent cards are put into your graveyard" (parser/holes/filter.ts)
    // edh-next-64 (CR 110.4b, 205.3; Disa the Restless): with subtypes too, "a Lhurgoyf permanent card is put into your graveyard": the subtypes, then "permanent" (same words as the plain case, the order of the noun phrase above)
    const permanentWithSubtypes = types.length > 0 && subtypes.length > 0 && all.length === 0 && !isToken && isPermanentTypes(types) && !isOutlaws(subtypes);
    if (permanentWithSubtypes) p.adj.push(subtypes.join(' or '), 'permanent');
    else if (types.length > 0 && subtypes.length === 0 && all.length === 0 && !isToken && isPermanentTypes(types)) p.adj.push('permanent');
    // Standard round 4, r4-trig (CR 603.2c; family and-or-types; Dredger's Insight): "one or more artifact and/or creature cards leave your graveyard" (each card of either type)
    else if (types.length > 0) p.adj.push(plural && types.length > 1 ? alt(joinList(types, 'or'), joinList(types, 'and'), andOr(types)) : joinList(types, 'or'));
    // edh-d-6 (CR 700.12, 106.6; Discreet Retreat): "activate abilities of outlaw sources", the five outlaw types said as the word
    if (subtypes.length > 0 && !permanentWithSubtypes) p.adj.push(isOutlaws(subtypes) ? 'outlaw' : subtypes.join(' or '));
    p.heads = o.head.split(' or ');
    p.suffix = '';
    p.creatureOptional = false;
    delete p.typeAfter;
  }

  // --- post-modifiers ------------------------------------------------------------------------------------------------------------------------------------
  let zoneAt = -1;
  let zoneInHistory = ''; // edh-c-61
  if (o.singleZone === true && f.owner === 'opponent' && zs.length === 1 && zs[0] === 'graveyard' && f.controller === undefined) {
    // edh-c-3 (CR 115.1, 404.1): targets of one opponent's graveyard (TargetSpec.sameOwner with an opponent owner) are said "from an opponent's graveyard"
    const z = zonePhrase(f, st, zs, plural, o.forEach === true);
    if (z) zoneAt = p.post.push(z) - 1;
  } else if (o.singleZone === true) {
    // FAST3 T14: "target cards from a single graveyard" (CR 115.1, 404.1): cards in a graveyard, no owner named
    if (zs.length !== 1 || zs[0] !== 'graveyard' || f.owner !== undefined || f.controller !== undefined) throw new NoRenderer('a single zone that is not "a single graveyard"');
    zoneAt = p.post.push('from a single graveyard') - 1;
  } else if (!o.noZone && !onStack && !f.stackKind) {
    const z = zonePhrase(f, st, zs, plural, o.forEach === true);
    // edh-c-61 (CR 400.3, 700.4; Fell Shepherd; family put-into-your-graveyard-from-battlefield): "cards that were put into your graveyard from the battlefield this turn" says the zone inside the history words, below
    if (z && f.putThereThisTurn === true && f.putThereFrom === 'battlefield' && f.owner === 'you' && f.controller === undefined && zs.length === 1 && zs[0] === 'graveyard') zoneInHistory = z;
    else if (z) zoneAt = p.post.push(z) - 1;
  }
  let ctrlAt = -1;
  if (!o.noController && f.controller !== undefined) {
    const c = f.controller;
    // edh-perms-20 (CR 608.2h; Hateful Eidolon): "an Aura you controlled that was attached to it": the controller as the object last existed (wasAttachedTo)
    if (c === 'you') { ctrlAt = p.post.push(butNotOwn ? "you control but don't own" : f.wasAttachedTo !== undefined ? 'you controlled' : 'you control') - 1; if (!butNotOwn && f.wasAttachedTo === undefined && teamWords(f)) p.teamAt = ctrlAt; } // edh-next-35 (family team-controls): said in compose(), at the end, so no caller comparing the controller words sees the alternative
    // edh-c-36 (CR 109.4, 102.1; family each-opponent-controls): "each creature each opponent controls" (Aku Djinn) names the same set as "each creature your opponents control"
    // FAST1 T6: "each creature your opponents control" names the same set as "each creature an opponent controls"; FAST3 T12: so does "for each Swamp your
    // opponents control" (NpOpts.forEach)
    else if (c === 'opponent') ctrlAt = p.post.push(plural || o.det === 'each' || o.forEach === true ? alt('your opponents control', 'an opponent controls', ...(plural || o.det === 'each' ? ['each opponent controls'] : [])) : 'an opponent controls') - 1;
    else if (c !== 'any') {
      // C6 (CR 608.2e): the player of a group choosing in turn ("each opponent sacrifices a creature with the greatest power among creatures they control") is "they" too
      const known = (c as PlayerRef).ref === 'target' || (c as PlayerRef).ref === 'event' || (c as PlayerRef).ref === 'bound' || (c as PlayerRef).ref === 'iterating' || (c as PlayerRef).ref === 'defending'; // edh-zones-7: "defending player exiles two permanents they control" (Bane of Bala Ged)
      const who = K.player(c as PlayerRef, st, 'subject');
      const text = who.text;
      // r3-choose: several players named before control ("creatures those players control", a plural player target: render/refs.ts#player)
      const verb = who.person === 'pl' ? 'control' : 'controls';
      const at = p.post.push(known ? alt(`${text} ${verb}`, 'they control') : `${text} ${verb}`) - 1;
      if ((c as PlayerRef).ref === 'iterating') ctrlAt = at; // C6: "with power 2 or less that player controls" (below)
      // p2-damage-3 (family without-keyword-controller-order): "each creature without flying that player controls" (Siege Dragon) after a player named before
      else if (known && f.notKeyword !== undefined && f.keyword === undefined) ctrlAt = at;
      // edh-perms-24 (CR 607.2d; Turnabout): "permanents of the chosen type target player controls" names the same permanents as "permanents target player controls of the chosen type"
      else if (known && f.chosen !== undefined) ctrlAt = at;
    }
  }
  if (f.owner !== undefined && (bf || onStack)) {
    const w = f.owner;
    if (w === 'you') p.post.push('you own');
    else if (w === 'opponent') p.post.push(alt('an opponent owns', 'owned by an opponent', 'owned by another player')); // edh-b-10 (CR 108.3): family owned-by-opponent
    else if (w !== 'any') p.post.push(`${K.player(w as PlayerRef, st, 'subject').text} owns`);
    // r4-copy (CR 108.3, 109.4): "target permanent you own but don't control" (Coveted Falcon; parser/holes/filter.ts#controlForms)
    const neg = p.post.indexOf("you don't control");
    if (w === 'you' && neg >= 0 && p.post[p.post.length - 1] === 'you own' && f.not !== undefined && Object.keys(f.not).every((k) => k === 'controller' || (f.not as Record<string, unknown>)[k] === undefined)) {
      p.post.pop();
      p.post[neg] = "you own but don't control";
    }
    // edh-c-54 (CR 108.3, 109.4; Conjured Currency; family neither-own-nor-control): owned and controlled by opponents, "target permanent you neither own nor control" (one object, not a plural group)
    if (w === 'opponent' && f.controller === 'opponent' && !plural && o.forEach !== true && ctrlAt >= 0 && ctrlAt === p.post.length - 2 && p.post[ctrlAt] === 'an opponent controls') {
      p.post.splice(ctrlAt, 2, 'you neither own nor control');
      ctrlAt = p.post.length - 1;
    }
    // edh-zones-15 (CR 108.3, 109.4; Yorion, Sky Nomad): both fields of you, "other nonland permanents you own and control"
    if (w === 'you' && f.controller === 'you' && !butNotOwn && ctrlAt >= 0 && ctrlAt === p.post.length - 2 && p.post[ctrlAt] === 'you control' && p.post[p.post.length - 1] === 'you own') {
      p.post.splice(ctrlAt, 2, alt('you own and control', 'you both own and control')); // edh-c-69 (Obelisk of Undoing): family you-both-own-and-control
      ctrlAt = p.post.length - 1;
    }
    // std-rf (CR 108.3, 109.4): "a permanent you own that your opponents control" (Iroh, Tea Master): the owner first, the controller after it as a relative clause
    // (the order the filter's two fields were written in is not the order of the words)
    if (w === 'you' && f.controller === 'opponent' && ctrlAt >= 0 && ctrlAt === p.post.length - 2 && p.post[p.post.length - 1] === 'you own') {
      const ctrl = p.post[ctrlAt]!;
      p.post.splice(ctrlAt, 2, 'you own', `that ${ctrl}`);
      ctrlAt = p.post.length - 1;
    }
  }
  // FAST4 T33: "other than enchanted creature" (not the object the source is attached to, CR 303.4, 301.5; parser/holes/filter.ts)
  // edh-c-52 (CR 122.1; family no-counter-controller-order; Coiling Stalker): "target creature you control that doesn't have a +1/+1 counter on it" says the same set as "target creature
  // without a +1/+1 counter on it you control" (the older wording is kept as an alternative); Oracle's order puts the controller first ("creature you control without a +1/+1 counter on it", "creature you control that doesn't have ...")
  if (noCounterAt >= 0 && ctrlAt === noCounterAt + 1 && ctrlAt === p.post.length - 1 && !plural) {
    const none = p.post[noCounterAt]!; // "without a +1/+1 counter on it"
    const ctrl = p.post[ctrlAt]!;
    p.post.splice(noCounterAt, 2, alt(`${ctrl} ${none}`, `${ctrl} that doesn't have ${none.slice('without '.length)}`, `${none} ${ctrl}`));
    ctrlAt = noCounterAt;
  }
  if (f.attachedToSource === false) p.post.push(`other than ${attachWord(st)} creature`);
  const withs: string[] = [];
  const wPlural = plural && o.eachWithSingular !== true; // std-rx11: "each with power greater than its base power"
  // edh-b-2 (CR 702; Henrika Domnathi): three or more keywords are a list closed by "or" or "and/or" ("with flying, deathtouch, and/or lifelink"); two are "flying or reach"
  if (f.keyword !== undefined) {
    const kws = [f.keyword].flat();
    // edh-c-14 (CR 702.29f): "with a cycling ability" is cycling or any typecycling (parser/holes/filter.ts#featureAt)
    if (kws.length === 2 && kws[0] === 'cycling' && kws[1] === 'typecycling') withs.push(alt('a cycling ability', 'cycling or typecycling', 'cycling abilities' /* edh-next-90: Herald of the Forgotten, "permanent cards with cycling abilities" */));
    // edh-c-77 (CR 702.33c; Coralhelm Chronicler): "with a kicker ability" is kicker or multikicker (parser/holes/filter.ts#featureAt)
    else if (kws.length === 2 && kws[0] === 'kicker' && kws[1] === 'multikicker') withs.push(alt('a kicker ability', 'kicker or multikicker'));
    else if (kws.length === 2 && kws[0] === 'morph' && kws[1] === 'megamorph') withs.push(alt('a morph ability', 'morph or megamorph')); // edh-c-57 (CR 702.37a-b; family morph-ability-keyword)
    else withs.push(kws.length < 3 ? kws.join(' or ') : alt(`${kws.slice(0, -1).join(', ')}, or ${kws[kws.length - 1]!}`, `${kws.slice(0, -1).join(', ')}, and/or ${kws[kws.length - 1]!}`));
  }
  if (basicLandType) withs.push('a basic land type'); // edh-zones-1
  // FAST5X E15 (CR 208.1, 202.3, 608.2d): "a creature with the greatest power among creatures they control" (parser/holes/filter.ts#featureAt)
  const most = (field: 'power' | 'toughness' | 'manaValue', c: NumberCmp): string => {
    const v = c.value;
    // edh-c-14 (CR 208.1, 608.2d; Triumph of Gerrard): "target creature you control with the greatest power" names the set by the noun it describes (creatures you control): the same filter as
    // "... with the greatest power among creatures you control" (parser/holes/object.ts, only a target creature you control)
    if (field === 'power' && typeof v === 'object' && v.q === 'stat' && v.stat === 'power' && v.agg === 'max' && c.op === '>=' && 'ref' in v.of && v.of.ref === 'each' && JSON.stringify(v.of.filter) === '{"types":["Creature"],"controller":"you"}'
      && f.controller === 'you' && JSON.stringify(f.types) === '["Creature"]' && o.det === 'target') return alt(K.qty(v, st), 'the greatest power');
    // edh-c-83 (CR 208.1, 202.3; Favor of the Mighty; family bare-greatest-stat): "each creature with the greatest mana value": the set compared with is the description itself, the same
    // objects as "... with the greatest mana value among creatures" (the parser fills it, parser/holes/filter.ts#fillHeadSet); the stat is named by itself
    if (typeof v === 'object' && v.q === 'stat' && v.stat === field && v.agg === 'max' && c.op === '>=' && 'ref' in v.of && v.of.ref === 'each') {
      const { [field]: _own, ...rest } = f;
      // edh-c-87 (Culling Scales' family; its own branch below is reached only for "lowest"): a target with no controller said is also "with the highest <stat>"
      const w83 = field === 'manaValue' ? 'mana value' : field;
      if (JSON.stringify(v.of.filter) === JSON.stringify(rest)) return alt(K.qty(v, st), `the greatest ${w83}`, ...(o.det === 'target' && f.controller === undefined && f.owner === undefined ? [`the highest ${w83}`] : []));
    }
    // edh-c-87 (CR 202.3, 208.1, 115.1, 608.2d; Culling Scales): "target nonland permanent with the lowest mana value" names the set by its own noun (no controller said): the same filter as
    // "... with the lowest mana value among nonland permanents" (parser/holes/object.ts#extremeTarget); the greatest / highest / lowest / least word of any of the three statistics
    if (typeof v === 'object' && v.q === 'stat' && v.stat === field && v.agg !== undefined && ((v.agg === 'max' && c.op === '>=') || (v.agg === 'min' && c.op === '<=')) && 'ref' in v.of && v.of.ref === 'each'
      && o.det === 'target' && f.controller === undefined && f.owner === undefined && JSON.stringify(v.of.filter) === JSON.stringify({ ...f, power: undefined, toughness: undefined, manaValue: undefined }) /* undefined fields vanish in JSON */) {
      const words = field === 'manaValue' ? 'mana value' : field;
      return alt(K.qty(v, st), v.agg === 'max' ? `the greatest ${words}` : `the lowest ${words}`, ...(v.agg === 'max' ? [`the highest ${words}`] : []));
    }
    if (typeof v === 'object' && v.q === 'stat' && v.stat === field && v.agg !== undefined && ((v.agg === 'max' && c.op === '>=') || (v.agg === 'min' && c.op === '<='))) return K.qty(v, st);
    // CLOUD std-msh (CR 202.3, 208.1): "a Villain with greater mana value than that creature" (Evil's Thrall): more (less) than that object's own statistic
    // (parser/holes/filter.ts#featureAt); the object is named on a copy of the state, so both readings are its mention
    const words = field === 'manaValue' ? 'mana value' : field;
    if (typeof v === 'object' && v.q === 'stat' && v.stat === field && v.agg === undefined && (c.op === '>' || c.op === '<') && 'ref' in v.of && v.of.ref !== 'each') {
      const than = `${c.op === '>' ? 'greater' : 'lesser'} ${words} than ${K.obj(v.of as ObjRef, cloneState(st), 'object').text}`;
      // edh-players-15 (CR 208.1; Éowyn, Fearless Knight; family greater-power-of-source): "with greater power" is more power than the object whose ability it is
      const own = field === 'power' && c.op === '>' && (v.of as { ref?: string }).ref === 'self' ? ['greater power'] : [];
      return alt(`${words} ${cmpPhrase(c, st)}`, than, ...own);
    }
    // edh-c-84 (CR 208.1, 107.3; Invasion of Lorwyn; family power-x-or-less-where-x): "with power X or less, where X is the number of lands you control" is the power at most that number
    if (field === 'power' && c.op === '<=' && typeof v === 'object' && v.q === 'count') return alt(`${words} ${cmpPhrase(c, st)}`, `${words} X or less, where X is ${K.qty(v, st)}`);
    return `${words} ${cmpPhrase(c, st)}`;
  };
  // edh-next-7 (CR 208.1; The Seedcore): a power and a toughness each equal to a fixed number is the "1/1 creature" prefix (parser/holes/filter.ts#modAt)
  const exactPt = f.power !== undefined && f.toughness !== undefined && f.power.op === '==' && f.toughness.op === '==' && typeof f.power.value === 'number' && typeof f.toughness.value === 'number';
  if (exactPt) p.adj.push(`${f.power!.value as number}/${f.toughness!.value as number}`);
  else {
    // edh-c-86 (CR 208.1; Rangers of Ithilien, parser/holes/filter.ts#featureAt): "with lesser power" is a power lower than the object the trigger's event is about
    // edh-next-32 (CR 208.1; Mirko, Obsessive Theorist, Body Launderer; parser/holes/filter.ts): a power compared with the object's own power is also said "power less than ~'s" (the possessive alone)
    // and "equal or lesser power" (families own-power-less-than-possessive, equal-or-lesser-power)
    if (f.power) withs.push(isLesserPowerThanSelf(f.power) ? alt(most('power', f.power), 'lesser power') : isOwnPowerCmp(f.power, '<') ? alt(most('power', f.power), "power less than ~'s") : isOwnPowerCmp(f.power, '<=') ? alt(most('power', f.power), 'equal or lesser power') : most('power', f.power));
    if (f.toughness) withs.push(isLesserPowerThanSelf(f.toughness, 'toughness') ? alt(most('toughness', f.toughness), 'lesser toughness') : isEqualOrLesserToughnessThanEvent(f.toughness) ? alt(most('toughness', f.toughness), 'equal or lesser toughness') : most('toughness', f.toughness)); // edh-next-86 (Colfenor, the Last Yew; family lesser-power)
  }
  if (f.totalPowerToughness) withs.push(isSameTotalPT(f.totalPowerToughness) ? 'the same total power and toughness' /* edh-next-112 (Wild Pair) */ : `total power and toughness ${cmpPhrase(f.totalPowerToughness, st)}`); // std-rx10 (CR 208.1)
  if (f.basePower) withs.push(`base power ${cmpPhrase(f.basePower, st)}`); // edh-next-23 (CR 208.1, 613.4)
  if (f.basePowerAndToughness) withs.push(`base power and toughness ${f.basePowerAndToughness.power}/${f.basePowerAndToughness.toughness}`); // edh-next-19 (CR 208.1, 613.4b)
  if (f.basePowerOrToughness) withs.push(`base power or toughness ${cmpPhrase(f.basePowerOrToughness, st)}`); // edh-perms-11 (CR 208.1, 613.4)
  if (f.toughnessGreaterThanPower === true) withs.push(wPlural ? 'toughness greater than their power' : 'toughness greater than its power'); // Standard round 4, r4-trig (CR 208.1)
  if (f.powerEqualsToughness === true) withs.push(wPlural ? 'power equal to their toughness' : 'power equal to its toughness'); // edh-next-32 (CR 208.1)
  if (f.powerNotEqualToughness === true) p.post.push("whose power and toughness aren't equal"); // edh-c-20 (CR 208.1)
  if (f.powerGreaterThanBase === true) withs.push(wPlural ? 'power greater than their base power' : 'power greater than its base power'); // std-rx11 (CR 208.1, 613.4)
  // FAST5 T42: "with lesser mana value" is a lower mana value than the event's subject (the creature that died or entered; parser/holes/filter.ts#featureAt)
  // std-rx28: "with equal or lesser mana value" is a mana value at most that of the spell the cast trigger is about (parser/holes/filter.ts#featureAt)
  // edh-top-3 (CR 202.3): "creature cards that each have a different mana value X or less" (TargetSpec.differentManaValues; the comparison is each card's own)
  if (o.differentManaValues === true) {
    if (f.manaValue === undefined || !plural || o.differentNames === true || o.total !== undefined || o.eachWithSingular === true) throw new NoRenderer('different mana values without a mana value comparison of each card');
    withs.push(`a different ${most('manaValue', f.manaValue)}`);
  } else if (f.manaValue) withs.push(isLesserThanEventSubject(f.manaValue) ? alt(`mana value ${cmpPhrase(f.manaValue, st)}`, 'lesser mana value', ...(diesTrigger(st) ? ['lesser mana value than the creature that died'] : [])) : isAtMostEventSpell(f.manaValue) || isEqualEventSpell(f.manaValue) || isAtMostEarlierTarget(f.manaValue) ? alt(`mana value ${cmpPhrase(f.manaValue, st)}`, isEqualEventSpell(f.manaValue) ? "that spell's mana value" : 'equal or lesser mana value', ...atMostEventObject(f.manaValue, st)) : most('manaValue', f.manaValue));
  if (f.manaValueParity !== undefined) withs.push(wPlural ? `${f.manaValueParity} mana values` : alt(`${f.manaValueParity} mana value`, `an ${f.manaValueParity} mana value`)); // edh-cast-4 (CR 202.3); edh-players-10 (Desecrate Reality) and edh-zones-13 (Gyruda): one object, with or without the article
  // edh-cast-12 (CR 202.3, 404.1; Drown in the Loch): "with mana value less than or equal to the number of cards in its controller's graveyard" (parser/holes/filter.ts#featureAt)
  if (f.manaValueVsGraveyard !== undefined) {
    if (f.manaValueVsGraveyard.op !== '<=' || f.manaValueVsGraveyard.of !== 'controller' || wPlural) throw new NoRenderer("a mana value compared with a graveyard other than \"less than or equal to the number of cards in its controller's graveyard\"");
    withs.push("mana value less than or equal to the number of cards in its controller's graveyard");
  }
  // edh-next-32 (CR 201.2, 404.1; Dragonlord Kolaghan): "with the same name as a card in their graveyard" (parser/holes/filter.ts#featureAt); only the controller's graveyard
  if (f.nameInGraveyard !== undefined) {
    if (f.nameInGraveyard.of !== 'controller') throw new NoRenderer("a name compared with a graveyard other than the controller's");
    withs.push(wPlural ? 'the same names as cards in their graveyards' : 'the same name as a card in their graveyard');
  }
  // FAST5X E23 (CR 107.3): "spells with {X} in their mana costs"
  // edh-d-9 (CR 107.3; Rosheen, Roaring Prophet): and "cards with {X} in their mana cost" (one mana cost each)
  if (f.manaCostHasX === true) withs.push(wPlural ? alt('{X} in their mana costs', '{X} in their mana cost') : alt('{X} in its mana cost', 'a mana cost that contains {X}') /* edh-next-74 (CR 107.3, 202.1; Unbound Flourishing; family x-in-mana-cost-contains) */);
  // Standard round 5, r5-trig (CR 107.4, 202.1): "with one or more blue mana symbols in its mana cost" (only "N or more")
  if (f.manaSymbols !== undefined) {
    const { color, cmp: m } = f.manaSymbols;
    if (m.op !== '>=' || typeof m.value !== 'number' || m.value < 1 || wPlural) throw new NoRenderer('manaSymbols other than "N or more" of one object');
    withs.push(`${numWord(m.value)} or more ${color === 'colored' ? 'colored' /* edh-next-142: Omnath, Locus of All */ : COLOR_WORD[color]} mana symbols in its mana cost`);
  }
  else if (f.manaCostHasX === false) throw new NoRenderer('manaCostHasX:false has no wording');
  // edh-zones-6 (CR 202.1; parser/holes/filter.ts#featureAt): "an artifact card with mana cost {0} or {1}"
  if (f.manaCostIs !== undefined) {
    if (f.manaCostIs.length === 0) throw new NoRenderer('manaCostIs without a cost');
    withs.push(`mana cost ${f.manaCostIs.join(' or ')}`);
  }
  if (f.counters) withs.push(countPhrase(f.counters, st, wPlural));
  // trek-9 (CR 301.5, 303.4; parser/holes/trek9.ts#attachedWithAt): "creatures you control with a Communicator attached to them" (Starfleet Communicator)
  if (f.attachedWith !== undefined) withs.push(`${f.attachedWithOther === true ? `another ${f.attachedWith.toLowerCase()}` : withArticle(f.attachedWithLegendary === true ? `legendary ${f.attachedWith}` : f.attachedWith)} attached to ${wPlural ? 'them' : 'it'}`);
  if (f.abilityNotMana === true && (f.hasAbility !== 'activated' || f.abilityTapCost === true)) throw new NoRenderer('abilityNotMana beside another ability feature'); // edh-c-44
  if (f.hasAbility) withs.push(f.abilityTapCost === true && f.hasAbility === 'activated' ? 'an activated ability with {T} in its cost' : f.abilityNotMana === true ? "an activated ability that isn't a mana ability" /* edh-c-44: CR 605.1a */ : f.hasAbility === 'mana' && wPlural ? alt(HAS_ABILITY.mana!, 'mana abilities') /* edhd36 (Power Sink): "lands with mana abilities" */ : HAS_ABILITY[f.hasAbility]!); // edh-perms-8: CR 602.1
  if (f.not && isNoAbilities(f.not)) withs.push('no abilities'); // FAST5 T42
  if (o.anyAbilities === true) withs.push('abilities'); // edh-d-22 (CR 113.1; Jasmine Boreal of the Seven)
  // FAST5 T42 (CR 201.2): "up to six target creature cards with different names" (TargetSpec.differentNames; never part of a filter)
  if (o.differentNames === true) withs.push('different names');
  if (o.total !== undefined) withs.push(o.total); // FAST5 T66
  if (o.eachWithSingular === true && (withs.length === 0 || !plural || o.differentNames === true || o.total !== undefined)) throw new NoRenderer('"each with" without a feature of each object');
  let notNameSaid = false;
  if (withs.length > 0) {
    // CLOUD std-misc (CR 201.2; Omenpath Journey): "up to five land cards that have different names" says the same as "... with different names"; edh-zones-13: also "that each have different names" (Tiamat)
    // edh-perms-8 (CR 602.1; Magewright's Stone): the ability with {T} in its cost is said "that has", never "with" (an activated ability with {T} in its cost: one "with" more)
    if (o.differentManaValues === true && withs.length !== 1) throw new NoRenderer('different mana values beside another feature'); // edh-top-3
    const tapAbil = f.abilityTapCost === true && f.hasAbility === 'activated' && withs.length === 1;
    // edh-zones-13 (CR 201.2; Tiamat, Burning-Rune Demon): "Dragon cards not named ~ that each have different names": the set's own words come after the name, in this one order
    notNameSaid = f.notName !== undefined && withs.length === 1 && o.differentNames === true && plural && !tapAbil;
    const dnWords = notNameSaid ? ['that have different names', 'that each have different names'] : ['with different names', 'that have different names', 'that each have different names'];
    const w0 = o.differentManaValues === true ? `that ${alt('each have', 'have')} ${withs[0]}` : tapAbil ? `that ${wPlural ? 'have' : 'has'} ${withs[0]}` : withs.length === 1 && o.differentNames === true && plural ? `${notNameSaid ? `not named ${f.notName} ` : ''}${alt(...dnWords)}` : o.differentNames === true && plural && withs.length === 2 && withs[1] === 'different names' && withs[0]!.startsWith('mana value ') ? alt(`with ${withs.join(' and ')}`, `with different names that each have ${withs[0]}`) /* edh-next-117 (family different-names-each-mana-value; CR 201.2, 202.3; Uncage the Menagerie) */ : `with ${withs.join(' and ')}`;
    // Cloud r3-repl: a plural description says what each object has also as "each with" ("up to two target creature cards each with mana value 2 or less", Dewdrop
    // Cure); never for a property of the set (different names, a total)
    // edh-next-9 (CR 702.1, 601.2; family that-has-keyword): "a spell that has flash" says the same set as "a spell with flash" (a keyword alone, Slitherwisp, Saint Traft and Rem Karolus)
    // edh-b-4 (CR 122.1; Slurrk, All-Ingesting): one object "that has a +1/+1 counter on it" says the same as "with a +1/+1 counter on it" (a counter alone, one object; parser/holes/filter.ts#postModAt)
    const w0k = f.keyword !== undefined && withs.length === 1 && !tapAbil && o.differentNames !== true && o.differentManaValues !== true && o.total === undefined && o.eachWithSingular !== true ? alt(w0, `that ${wPlural ? 'have' : 'has'} ${withs[0]}`) : w0;
    // edh-next-36 (CR 202.3; Grozoth): "cards that have mana value 9" says the same set as "cards with mana value 9" (a mana value alone)
    const counterHas = (f.counters !== undefined || (f.manaValue?.op === '==' && typeof f.manaValue.value === 'number' && withs[0] === `mana value ${f.manaValue.value}`)) && withs.length === 1 && !tapAbil && o.differentNames !== true && o.differentManaValues !== true && o.total === undefined && o.eachWithSingular !== true;
    // edh-next-76 (CR 208.1; Catapult Fodder): "creatures that each have toughness greater than their power" says the same set as "creatures with toughness greater than their power"
    const w0t = f.toughnessGreaterThanPower === true && withs.length === 1 && wPlural && plural && !tapAbil && o.differentNames !== true && o.differentManaValues !== true && o.total === undefined && o.eachWithSingular !== true ? alt(w0, `that each have ${withs[0]}`) : w0;
    const w = tapAbil ? w0 : w0t !== w0 ? w0t : counterHas ? alt(w0, `that ${wPlural ? 'have' : 'has'} ${withs[0]}`) /* edh-c-72 (Grind // Dust): also a set, "that have -1/-1 counters on them" */ : o.eachWithSingular === true ? `each ${w0}` : plural && o.differentNames !== true && o.differentManaValues !== true && o.total === undefined ? alt(w0k, `each ${w0}`) : w0k;
    // FAST1 T6: "a creature card with mana value 3 or less from your graveyard" says the same as "... from your graveyard with mana value 3 or less"
    // (comparisons only: a keyword filter such as "with awaken" needs an engine capability, and a card it gates would lose its automated trigger, G8/G10)
    // p2-graveyard-2 (CR 702.1, 404.1; family keyword-card-before-zone): ... and a card of a graveyard with a keyword, "target creature card with infect from your
    // graveyard" (Corpse Cur, Otrimi): only a keyword alone, the keyword's own capability still required (model/cap-walk.ts)
    const kwOnly = f.keyword !== undefined && withs.length === 1 && f.zone !== undefined && [f.zone].flat().every((z) => z === 'graveyard');
    if (zoneAt >= 0 && zoneAt === p.post.length - 1 && (f.keyword === undefined || kwOnly)) p.post[zoneAt] = alt(`${p.post[zoneAt]} ${w}`, `${w} ${p.post[zoneAt]}`);
    // FAST3 T12: "creatures with flying your opponents control" says the same set as "creatures your opponents control with flying" (a keyword alone after the
    // controller; the keyword's own capability is required either way, model/cap-walk.ts)
    // C6: "a creature with power 2 or less that player controls" (the player of a choice for each player, `{ref:'iterating'}`) says the same set as "... that player controls with power 2 or less"
    // std-rl (family with-stat-before-controller): "target creature with power 4 or greater an opponent controls" says the same set as "... an opponent controls with
    // power 4 or greater" (one comparison of power, toughness or mana value with a number, Hidden Dragonslayer, Leafkin Avenger)
    else if (ctrlAt >= 0 && ctrlAt === p.post.length - 1 && zoneAt < 0 && withs.length === 1 && (f.keyword !== undefined || (f.hasAbility === 'mana' && wPlural && f.abilityNotMana === undefined) /* edhd36 */ || (typeof f.controller === 'object' && f.controller.ref === 'iterating') || statBeforeController(f))) p.post[ctrlAt] = alt(`${p.post[ctrlAt]} ${w}`, `${w} ${p.post[ctrlAt]}`);
    else {
      p.post.push(w);
      p.withAt = p.post.length - 1;
    }
  }
  let notKwAt = -1;
  if (f.notKeyword !== undefined) {
    // edh-c-78 (CR 702; Grand Master of Flowers): three or more are a serial list, "without first strike, double strike, or vigilance" (two stay "A or B")
    const nks = [f.notKeyword].flat();
    const without = `without ${nks.length >= 3 ? `${nks.slice(0, -1).join(', ')}, or ${nks[nks.length - 1]}` : nks.join(' or ')}`;
    // std-rx18 (family without-keyword-controller-order): "creatures without flying your opponents control" says the same set as "creatures your opponents control without
    // flying" (a lacked keyword alone after the controller, as FAST3 T12's "with flying"; Stoneshock Giant)
    if (ctrlAt >= 0 && ctrlAt === p.post.length - 1 && zoneAt < 0 && withs.length === 0) p.post[ctrlAt] = alt(`${p.post[ctrlAt]} ${without}`, `${without} ${p.post[ctrlAt]}`);
    // edh-c-6 (family without-keyword-controller-order; Street Spasm): the same for a negated controller, "target creature without flying you don't control"
    else if (zoneAt < 0 && withs.length === 0 && p.post.length > 0 && p.post[p.post.length - 1] === "you don't control") p.post[p.post.length - 1] = alt(`you don't control ${without}`, `${without} you don't control`);
    else p.post.push(alt(without, `that ${wPlural ? "don't" : "doesn't"} have ${nks.length >= 3 ? `${nks.slice(0, -1).join(', ')}, or ${nks[nks.length - 1]}` : nks.join(' or ')}`)); // edh-next-92 (family none-of-keywords-relative; Path of Mettle)
    notKwAt = p.post.length - 1;
  }
  // CLOUD std-ecl (CR 205.3m): "two target creature cards that share a creature type from your graveyard" (TargetSpec.sharedCreatureType; never part of a filter): in
  // front of or behind the zone ("creatures you control that share a creature type" after the controller)
  if (o.shareCreatureType === true) {
    if (!plural) throw new NoRenderer('a shared creature type for a single object');
    const sh = 'that share a creature type';
    // edh-d-59 (CR 205.3m; Aphetto Dredging): Oracle's other wording of a creature type in common, "of the creature type of your choice" (a type is chosen, every target has it), always before the zone
    const ch = 'of the creature type of your choice';
    if (zoneAt >= 0 && zoneAt === p.post.length - 1) p.post[zoneAt] = alt(`${p.post[zoneAt]} ${sh}`, `${sh} ${p.post[zoneAt]}`, `${ch} ${p.post[zoneAt]}`);
    else p.post.push(alt(sh, ch));
  }
  const was = plural ? 'were' : 'was';
  // CLOUD std-msh (CR 506.5): "target creature you control that's attacking alone" (parser/holes/filter.ts#postModAt), after the controller
  if (f.attackingAlone === true) p.post.push(alt("that's attacking alone", 'that is attacking alone'));
  // p2-copy-perm-2: where "that entered this turn" is, for "of the chosen type" said before it (below)
  let enteredAt = -1;
  // p2-combat-flow-1 (CR 506.3, 508.1b): attacking you, the player: "a creature without flying that's attacking you" or "... attacking you" (family
  // attacking-you-relative)
  if (attackingYou) p.post.push(alt('attacking you', ...(plural ? ['that are attacking you'] : ["that's attacking you", 'that is attacking you'])));
  if (f.enteredThisTurn === true && f.enteredUnderYourControl === true) enteredAt = p.post.push('that entered the battlefield under your control this turn') - 1; // edh-next-109 (CR 110.2; Shaile, Dean of Radiance)
  else if (f.enteredThisTurn === true) enteredAt = p.post.push(alt('that entered the battlefield this turn', 'that entered this turn')) - 1;
  else if (f.enteredThisTurn === false) p.post.push(f.attackedThisTurn === false ? "that didn't attack or enter this turn" /* edh-next-89 (CR 508.1a, 400.7; The Fifth Doctor): the two negations are one phrase */ : alt("that didn't enter the battlefield this turn", "that didn't enter this turn"));
  // edh-c-61 (CR 120.1; family dealt-damage-participle): "that was dealt damage", "that has been dealt damage" and the bare participle "dealt damage this turn"
  if (f.dealtDamageThisTurn === true) p.post.push(alt(`that ${was} dealt damage this turn`, `that ${plural ? 'have' : 'has'} been dealt damage this turn`, 'dealt damage this turn'));
  // std-mkm (CR 120.1): "a creature that dealt damage this turn" (the object as the source of the damage)
  if (f.dealtDamageAsSourceThisTurn === true) p.post.push('that dealt damage this turn');
  else if (f.dealtDamageAsSourceThisTurn === false) throw new NoRenderer('dealtDamageAsSourceThisTurn:false has no wording');
  // edh-players-9 (CR 120.1, 510.2): "a creature that dealt combat damage to you this turn" (the object as the source of the damage, to the controller)
  if (f.dealtDamageToYouThisTurn !== undefined) p.post.push(`that dealt ${f.dealtDamageToYouThisTurn === 'combat' ? 'combat ' : ''}damage to you this turn`);
  if (f.dealtDamageByYourSourceThisTurn === true) p.post.push('dealt damage this turn by a source you controlled'); // edh-c-48 (CR 120.1)
  // edh-next-130 (CR 120.1, 400.7; Shelob, Child of Ungoliant): "dealt damage this turn by a Spider you controlled": a source of one subtype (and at most one card type), controlled by "you" then
  if (f.dealtDamageThisTurnBy !== undefined) {
    const by = f.dealtDamageThisTurnBy;
    const keys = Object.keys(by).filter((k) => (by as Record<string, unknown>)[k] !== undefined);
    const sub = by.subtypes?.length === 1 ? by.subtypes[0]! : undefined;
    const ty = by.types === undefined ? '' : by.types.length === 1 ? ` ${by.types[0]!.toLowerCase()}` : undefined;
    if (sub === undefined || ty === undefined || by.controller !== 'you' || keys.some((k) => !['subtypes', 'types', 'controller'].includes(k))) throw new NoRenderer('dealtDamageThisTurnBy other than one subtype a player controlled');
    p.post.push(`dealt damage this turn by ${/^[aeiou]/i.test(sub) ? 'an' : 'a'} ${sub}${ty} you controlled`);
  }
  // r3-choose (CR 400.7): "target permanent card in your graveyard that was put there from anywhere this turn" ("there" is the zone the noun phrase names)
  if (f.putThereFrom !== undefined && f.putThereThisTurn !== true) throw new NoRenderer('putThereFrom without putThereThisTurn'); // r5-fxz
  if (f.putThereThisTurn === true) {
    if (typeof f.zone !== 'string' || f.zone === 'battlefield' || f.zone === 'any') throw new NoRenderer('"put there this turn" with no one zone named');
    // r5-fxz: from the battlefield (`putThereFrom`); "from anywhere" may be left unsaid ("that was put there this turn", Abyssal Harvester)
    p.post.push(f.putThereFrom === 'battlefield' ? (zoneInHistory !== '' ? alt(`${zoneInHistory} that ${was} put there from the battlefield this turn`, `that ${was} put into your graveyard from the battlefield this turn`) : `that ${was} put there from the battlefield this turn`) : f.putThereFrom === 'mill' ? `that ${was} milled this turn` : f.putThereFrom === 'discard' ? alt('that you cycled or discarded this turn', 'that you discarded this turn') /* edh-d-102 */ : f.putThereFrom === 'discardOrLibrary' ? `that ${was} discarded or put there from a library this turn` /* edh-d-85 */ : f.putThereFrom === 'library' ? `that ${was} put there from their library this turn` : alt(`that ${was} put there from anywhere this turn`, `that ${was} put there this turn`));
  }
  // edh-next-116 (CR 400.7, 506.1; Storrev, Devkarin Lich): "a creature card in your graveyard that wasn't put there this combat" ("there" is the zone the noun phrase names)
  if (f.putThereThisCombat !== undefined) {
    if (typeof f.zone !== 'string' || f.zone === 'battlefield' || f.zone === 'any' || f.putThereThisTurn !== undefined) throw new NoRenderer('"put there this combat" with no one zone named, or beside "this turn"');
    p.post.push(f.putThereThisCombat ? `that ${was} put there this combat` : `that ${plural ? "weren't" : "wasn't"} put there this combat`);
  }
  // FAST3 T14: "a creature dealt damage by ~ this turn" (the participle, as Oracle prints it)
  // FAST5 T66 (CR 510.2, 120.1): "each nonland permanent with mana value X whose controller was dealt combat damage by ~ this turn" (Steel Hellkite)
  if (f.controllerDealtCombatDamageBySourceThisTurn === true) p.post.push('whose controller was dealt combat damage by ~ this turn');
  else if (f.controllerDealtCombatDamageBySourceThisTurn === false) throw new NoRenderer('controllerDealtCombatDamageBySourceThisTurn:false has no wording');
  // edh-next-134 (CR 510.2, 120.1; Admiral Beckett Brass): "controlled by a player who was dealt combat damage by three or more Pirates this turn"
  if (f.controllerDealtCombatDamageBy !== undefined) {
    const { atLeast, by } = f.controllerDealtCombatDamageBy;
    if (atLeast < 2 || f.controller !== undefined) throw new NoRenderer('controllerDealtCombatDamageBy with a count below two or with a controller of its own');
    p.post.push(`controlled by a player who was dealt combat damage by ${numWord(atLeast)} or more ${K.np(by, cloneState(st), { det: 'none', plural: true })} this turn`);
  }
  // Cloud std-woe (CR 400.7, 120.3; family dealt-by-spell): an instant or sorcery is that object only while it is a spell, so the damage it dealt was dealt this
  // turn: "If a permanent dealt damage by ~ would die this turn, exile it instead" (Torch the Tower)
  const spellSelf = st.ctx.selfTypes?.some((t) => t === 'Instant' || t === 'Sorcery') === true;
  if (f.dealtDamageBySourceThisTurn === true) p.post.push(spellSelf ? alt('dealt damage by ~ this turn', 'dealt damage by ~') : 'dealt damage by ~ this turn');
  else if (f.dealtDamageBySourceThisTurn === false) throw new NoRenderer('dealtDamageBySourceThisTurn:false has no wording');
  if (f.dealtDamageByAttachedThisTurn === true) p.post.push('dealt damage by equipped creature this turn'); // edh-c-113 (CR 120.1, 301.5; Unscythe, Killer of Kings)
  if (f.crewedBySourceThisTurn === true) p.post.push('crewed by ~ this turn'); // Standard round 5, r5-trig (CR 702.122c)
  else if (f.crewedBySourceThisTurn === false) throw new NoRenderer('crewedBySourceThisTurn:false has no wording');
  else if (f.dealtDamageThisTurn === false) p.post.push(`that ${plural ? "weren't" : "wasn't"} dealt damage this turn`);
  // std-rx12 (CR 122.6): "that you've put one or more +1/+1 counters on this turn"
  if (f.countersPutThisTurn !== undefined) {
    if (f.countersPutThisTurn.kind === 'any') p.post.push("that you've put a counter on this turn"); // trek-14 (La Forge, Thoughtful as Ever)
    else p.post.push(`that you've put one or more ${f.countersPutThisTurn.kind} counters on this turn`);
  }
  if (f.drawnThisTurn === true) p.post.push('drawn this turn'); // edh-players-7 (CR 121.1): "cards in your hand drawn this turn"
  if (f.foughtThisTurn === true) p.post.push('that fought this turn'); // edh-next-139 (CR 701.14a)
  if (f.attackedThisTurn === true) p.post.push('that attacked this turn');
  else if (f.attackedThisTurn === false && f.enteredThisTurn !== false) p.post.push("that didn't attack this turn");
  if (f.blockedThisTurn === true) p.post.push('that blocked this turn');
  else if (f.blockedThisTurn === false) p.post.push("that didn't block this turn");
  if (f.wasBlockedThisTurn === true) p.post.push(plural ? 'that were blocked this turn' : 'that was blocked this turn'); // edh-c-18 (CR 509.1h)
  // cloud std-dsk (CR 201.2); edh-next-126 (Light-Paws, Emperor's Voice): "with a different name than each Aura you control", after a "with" phrase of its own "and with ..."
  if (p.notSameName !== undefined) p.post.push(p.notSameNameEach === undefined ? p.notSameName : alt(p.notSameName, `${p.withAt === p.post.length - 1 ? 'and ' : ''}with a different name than ${p.notSameNameEach}`));
  if (f.sharesWith && f.sharesWith.with.ref === 'each' && f.sharesWith.quality === 'name') {
    // std-hob (CR 201.2): "with the same name as a legendary permanent you control": the name of any one object of a described set (parser/holes/filter.ts)
    const sameAs = K.np(f.sharesWith.with.filter, st, { det: 'a' });
    // edh-next-14 (CR 201.2; family same-name-that-has): "that has the same name as a card in your graveyard" (Pyromancer Ascension), the zone said with "in"
    p.post.push(alt(`with the same name as ${sameAs}`, `that has the same name as ${sameAs.replace(/ from (your|a|their|an opponent's) graveyard$/, ' in $1 graveyard')}`));
  } else if (f.sharesWith && (f.sharesWith.with.ref === 'subject' || (f.sharesWith.with.ref === 'attachedTo' && f.other === true)) && f.sharesWith.other === true && f.sharesWith.quality === 'creatureType') {
    // edh-b-14 (Alpha Status): under "enchanted creature", the enchanted creature is the "it" compared with (`attachedTo`), left out by `sharesWith.other`; "other" is said (`other`, the Aura is no creature)
    // p2-pt-1 (CR 205.3m, 613.4c): "for each other creature on the battlefield that shares at least one creature type with it" (Coat of Arms): the object being
    // modified is compared with, and is not one of the objects counted ("other")
    p.other = true;
    // (family on-the-battlefield: permanents of every controller, also said with the zone before the relative clause)
    const shares = `that ${plural ? 'share' : 'shares'} ${alt('a creature type', 'at least one creature type')} with it`;
    p.post.push(f.controller === undefined && f.owner === undefined && (f.zone === undefined || f.zone === 'battlefield') ? alt(shares, `on the battlefield ${shares}`) : shares);
  } else if (f.sharesWith && f.sharesWith.with.ref === 'subject' && f.sharesWith.other === true && f.sharesWith.quality === 'name') {
    // edh-perms-6 (CR 201.2, 613.4c; Mirror Box): "for each other creature you control with the same name as that creature": the object being modified is compared with, and is
    // not one of the objects counted ("other")
    p.other = true;
    p.post.push(alt('with the same name as that creature', 'with the same name as it', `that ${plural ? 'share' : 'shares'} a name with it`));
  } else if (f.sharesWith && f.sharesWith.quality === 'otherSpellType') {
    // edh-d-96 (CR 304.1, 307.1; Gale, Waterdeep Prodigy): "target card of the other type from your graveyard": of instant and sorcery, the type the triggering spell does not have; said only
    // of the spell of a cast trigger, and before the zone of the card
    const sw = f.sharesWith.with;
    if (sw.ref !== 'event' || sw.role !== 'spell' || f.sharesWith.other === true || plural) throw new NoRenderer('"of the other type" names only the spell of a cast trigger, of one card (edh-d-96)');
    // (review edh-d-96: only after a trigger on "an instant or sorcery spell": of any other pair of types "the other type" means another quality, and a single type has none)
    const trig = st.trigger ?? [];
    const spellTypes = trig.length === 1 && trig[0]!.ev === 'cast' ? JSON.stringify([...((trig[0] as { spell?: { types?: string[] } }).spell?.types ?? [])].sort()) : '';
    if (spellTypes !== '["Instant","Sorcery"]') throw new NoRenderer('"of the other type" after a cast trigger on spells other than "an instant or sorcery spell" (edh-d-96)');
    if (zoneAt >= 0 && zoneAt === p.post.length - 1) p.post[zoneAt] = `of the other type ${p.post[zoneAt]}`;
    else p.post.push('of the other type');
} else if (f.sharesWith) {
    // edh-zones-5 (Ringsight): the set form with a quality other than a name, "that shares a color with a legendary creature you control"
    const sw = f.sharesWith.with;
    if (f.sharesWith.quality === 'permanentType' && (f.sharesWith.other !== true || !p.other)) throw new NoRenderer('"shares a permanent type with it" without "another" (edh-zones-10)');
    // edh-mana-keywords-9 (the parser's rule, parser/lower/scope.ts#eventMentions: a filter's own reference names nothing): the card a trigger's description is compared with ("a land with the same name as
    // the exiled card", Extraplanar Lens) is no antecedent of a later "its"
    const comparedKey = sw.ref === 'linked' ? `l:${sw.link}` : null;
    const wasMentioned = comparedKey !== null && st.mentioned.has(comparedKey);
    // edh-next-145 (CR 205.3m; Cryptic Gateway): `each` only with the creatures the ability's tap cost tapped, "each creature tapped this way"
    if (f.sharesWith.each === true && (sw.ref !== 'costTapped' || f.sharesWith.other === true)) throw new NoRenderer('a quality shared with each object of a set other than the creatures tapped this way');
    const other = f.sharesWith.each === true ? 'each creature tapped this way' : sw.ref === 'each' && f.sharesWith.quality !== 'name' && sw.filter.commander !== true ? K.np(sw.filter, st, { det: 'a' }) : K.obj(f.sharesWith.with, st, 'object').text;
    if (comparedKey !== null && !wasMentioned) { st.mentioned.delete(comparedKey); st.info.delete(comparedKey); }
    const shares = `that ${plural ? 'share' : 'shares'} ${SHARES_QUALITY[f.sharesWith.quality] ?? 'a quality'} with ${other}`;
    // FAST3 T18: Oracle's other wording of a shared name, "with the same name as that creature" (CR 201.2)
    // pc-keywords-mana-2 (CR 903.3d, 903.3e; Path of Ancestry): the commanders you own are also "your commander"
    const w = f.sharesWith.with;
    const yours = w.ref === 'each' && w.filter.commander === true && w.filter.owner === 'you' && Array.isArray(w.filter.zone) && w.filter.zone.includes('command') && Object.keys(w.filter).filter((k) => (w.filter as Record<string, unknown>)[k] !== undefined).length === 3;
    // edh-zones-13 (CR 202.3, 205.3m; Pyre of Heroes): "a creature card that shares a creature type with the sacrificed creature and has mana value equal to 1 plus that creature's
    // mana value": a computed mana value is also said after the shared quality, "and has", and the object the value reads is also "that creature" (the one the clause named)
    // edh-b-8 (CR 201.2, 110.1; Strata Scythe): permanents of every controller, also said with the zone before the words (family on-the-battlefield): "each land on the battlefield with the
    // same name as the exiled card"
    const nameOnBf = f.controller === undefined && f.owner === undefined && (f.zone === undefined || f.zone === 'battlefield') && w.ref === 'linked';
    const mvAt = p.post.length - 1;
    const mvText = f.manaValue !== undefined && typeof f.manaValue.value === 'object' && f.manaValue.op === '==' ? `mana value ${cmpPhrase(f.manaValue, cloneState(st))}` : '';
    if (!plural && f.sharesWith.quality !== 'name' && !yours && mvText !== '' && mvAt >= 0 && p.post[mvAt] === `with ${mvText}`) {
      const mvPost = p.post.pop()!;
      const has = `has ${mvText}`;
      p.post.push(alt(`${mvPost} ${shares}`, `${shares} and ${has}`, `${shares} and ${has.replace(/the sacrificed (\w+)'s/, "that $1's")}`));
    } else
    // edh-next-139 (CR 202.3, 603.2; Boxing Ring; family same-mana-value-unsaid): the object of the triggering event is also left unsaid, "it fights ... with the same mana value"
    p.post.push(f.sharesWith.quality === 'manaValue' ? (sw.ref === 'event' && (sw as { role?: string }).role === 'subject' ? alt(`with the same mana value as ${other}`, 'with the same mana value') : `with the same mana value as ${other}`)
      : f.sharesWith.quality === 'name' && sw.ref === 'event' && sw.role === 'spell' && zoneAt >= 0 && zoneAt === p.post.length - 1 ? ((): string => {
        // edh-d-59 (CR 201.2, 601.2; Harness the Storm): "target card with the same name as that spell from your graveyard": the words of the shared name come before the zone of the card
        // compared (the spell that was cast is "that spell" or "it")
        const zone = p.post.pop()!;
        const names = [shares, `with the same name as ${other}`, 'with the same name as that spell'];
        return alt(...names.flatMap((w) => [`${zone} ${w}`, `${w} ${zone}`]));
      })()
      : f.sharesWith.quality === 'name' ? alt(shares, `with the same name as ${other}`, ...(nameOnBf ? [`on the battlefield with the same name as ${other}`] : []))
      : yours ? alt(shares, `that ${plural ? 'share' : 'shares'} ${SHARES_QUALITY[f.sharesWith.quality] ?? 'a quality'} with your commander`)
      // edh-next-54 (CR 205.2a, 608.2c; Daring Thief, family shares-type-with-earlier-target): a later target that shares a quality with an EARLIER target of the same sentence, said "with it"
      : sw.ref === 'target' && !plural && o.specTarget === true && f.sharesWith.quality === 'cardType' ? alt(shares, `that shares ${SHARES_QUALITY[f.sharesWith.quality] ?? 'a quality'} with it`) : shares);
  }
  // FAST3 T18: "creatures blocking it" (CR 509.1g)
  // edh-d-12 (CR 509.1g; Labyrinth Raptor; family that-is-blocking): the participle is also the relative clause, "a creature that's blocking it"
  if (f.blockingObject) { const host = K.obj(f.blockingObject, st, 'object').text; p.post.push(alt(`blocking ${host}`, `${plural ? 'that are' : 'that is'} blocking ${host}`)); }
  // edh-top-3 (CR 509.1h, 506.4; Tinder Wall): the creature the source itself blocks is also said "target creature it's blocking" (the source is the "it" of the sentence)
  if (f.blockedByObject) {
    const by = `blocked by ${K.obj(f.blockedByObject, st, 'object').text}`;
    p.post.push(f.blockedByObject.ref === 'self' || (f.blockedByObject.ref === 'event' && f.blockedByObject.role === 'blocker') /* edh-c-13: the blocker of the trigger's event (Serene Master) */ ? alt(by, "it's blocking", 'it is blocking', "that it's blocking", 'that it is blocking', ...(f.blockedByObject.ref === 'self' ? ['~ is blocking', 'that ~ is blocking'] : [])) : by); // edh-c-34: the object named by its own name (Wall of Corpses) // p2-combat-flow-1 (CR 509.1h)
  }
  // p2-combat-flow-1 (CR 509.1g-h; family blocking-or-being-blocked): "blocking or blocked by ~", also "blocking or being blocked by ~"
  if (f.blockingOrBlockedBy) { const o = K.obj(f.blockingOrBlockedBy, st, 'object').text; p.post.push(alt(`blocking or blocked by ${o}`, `blocking or being blocked by ${o}`)); }
  // FAST4 T22: "Auras attached to it", "Equipment attached to enchanted creature" (CR 301.5, 303.4)
  // std-ry5 (CR 303.4): "an Aura attached to a creature you control": attached to any one permanent of that description
  if (f.attachedToObject?.ref === 'each' && 'filter' in f.attachedToObject) {
    // edh-perms-2 (family attached-relative; parser/holes/filter.ts W_THATS_ATTACHED_TO): also with the relative pronoun, "each Aura you control that's attached to a creature"
    const host = K.np(f.attachedToObject.filter, st, { det: 'a' });
    // edh-perms-14 (Umbra Mystic): and of several, "Auras attached to permanents you control" (the host described in the plural)
    const hosts = plural ? K.np(f.attachedToObject.filter, st, { det: 'none', plural: true }) : null;
    p.post.push(alt(`attached to ${host}`, `that's attached to ${host}`, `that are attached to ${host}`, ...(hosts === null ? [] : [`attached to ${hosts}`, `that are attached to ${hosts}`])));
  }
  else if (f.attachedToObject) p.post.push(`attached to ${K.obj(f.attachedToObject, st, 'object').text}`);
  if (f.attachedToPlayer !== undefined) p.post.push(`attached to ${K.player(f.attachedToPlayer, st, 'object').text}`); // p2-damage-2 (CR 303.4, 702.5d)
  // FAST5X E3 (CR 702.171c): "a creature that saddled it this turn"
  if (f.saddledThisTurn) p.post.push(`that saddled ${K.obj(f.saddledThisTurn, st, 'object').text} this turn`);
  if (f.crewedThisTurn) p.post.push(`that crewed ${K.obj(f.crewedThisTurn, st, 'object').text} this turn`); // r5-fxb (CR 702.122)
  if (f.couldEnchant) p.post.push(`that could enchant ${K.obj(f.couldEnchant, st, 'object').text}`); // edh-d-24 (CR 303.4a, 702.5a)
  if (f.wasAttachedTo) p.post.push(`that was attached to ${K.obj(f.wasAttachedTo, st, 'object').text}`); // r5-fxb (CR 603.10a)
  const choice = f.chosen ? st.choiceWords?.get(f.chosen.link) : undefined;
  if (f.chosen && choice !== undefined && choice.quality === f.chosen.quality) {
    choice.used++; // FAST3 T13: the choice made as the ability resolves, said where it is used (render/fold.ts#choiceThenEffect)
    p.post.push(`of the ${choice.words} of your choice`);
  } else if (f.chosen) {
    // FAST5 T67 (CR 608.2c-d): a type chosen earlier in the same ability is also "that type" ("Choose a creature type. Draw a card for each permanent you
    // control of that type."; the parser links it, parser/lower/links.ts)
    const q = f.chosen.quality;
    // CLOUD C5 (CR 607.2d): a land type chosen is also "the chosen type" ("Lands of the chosen type have ...")
    // CLOUD std-misc (CR 607.2d, 608.2c-d): a card name chosen earlier in the same ability is also "that name" ("Choose a card name. ... cards with that name")
    // edh-players-13 (CR 608.2d; Patriarch's Bidding): the types every player chose are "a type chosen this way" (parser/holes/filter.ts W_OF_A_TYPE_CHOSEN_THIS_WAY), the chosen type of one chooser is not
    const words = f.chosen.quality === 'creatureType' && st.groupChoices?.has(f.chosen.link) === true ? 'of a type chosen this way'
      : q === 'creatureType' || q === 'cardType' || q === 'landType' || q === 'planeswalkerType' /* edh-d-94 */ ? alt(CHOSEN_QUALITY[q]!, 'of the chosen type', 'of that type')
      : q === 'cardName' ? alt(CHOSEN_QUALITY[q]!, 'with that name')
      : q === 'oddEven' ? alt(CHOSEN_QUALITY[q]!, 'with mana value of that quality') /* edh-next-40 (Twins of Discord): family chosen-that-quality */
        : q === 'color' ? alt(CHOSEN_QUALITY[q]!, 'of that color') /* edh-players-8: family chosen-color-that-color */ : CHOSEN_QUALITY[q] ?? 'of the chosen kind';
    // FAST5 T67: "creature cards of the chosen type from your graveyard" names the same cards as "... from your graveyard of the chosen type"
    if (zoneAt >= 0 && zoneAt === p.post.length - 1) p.post[zoneAt] = alt(`${p.post[zoneAt]} ${words}`, `${words} ${p.post[zoneAt]}`);
    // CLOUD C5: "creatures of the chosen type your opponents control" names the same creatures as "creatures your opponents control of the chosen type"
    else if (ctrlAt >= 0 && ctrlAt === p.post.length - 1 && zoneAt < 0) p.post[ctrlAt] = alt(`${p.post[ctrlAt]} ${words}`, `${words} ${p.post[ctrlAt]}`);
    // p2-copy-perm-2 (CR 607.2d, 400.7): "each token you control of the chosen type that entered this turn" (Renewed Solidarity) names the same tokens as "... that
    // entered this turn of the chosen type": the chosen type is said before the relative clause too
    else if (enteredAt >= 0 && enteredAt === p.post.length - 1) p.post[enteredAt] = alt(`${p.post[enteredAt]} ${words}`, `${words} ${p.post[enteredAt]}`);
    // edh-c-7 (CR 607.2d, 702.9; Teferi's Moat): "creatures of the chosen color without flying" names the same creatures as "creatures without flying of the chosen color"
    else if (notKwAt >= 0 && notKwAt === p.post.length - 1 && f.chosen.quality === 'color') p.post[notKwAt] = alt(`${p.post[notKwAt]} ${words}`, `${words} ${p.post[notKwAt]}`);
    else p.post.push(words);
  }
  const tf = f.targets as { ref?: string; filter?: ObjectFilter } | undefined;
  if (f.stackKind && tf?.ref === 'each' && tf.filter !== undefined) {
    // FAST4 T23 (parser/holes/filter.ts REL): "a spell that targets a creature": one of its targets is such an object (CR 115.9b)
    // std-rx28 (family targets-one-or-more): said "that targets one or more creatures" too (Storm, Windrider), the same test of its targets
    const one = K.np(tf.filter, st, { det: 'a' });
    p.post.push(`that ${plural ? 'target' : 'targets'} ${alt(one, K.np(tf.filter, cloneState(st), { det: 'none', plural: true, count: 'one or more' }))}`);
  } else if (f.stackKind && f.targets) {
    const t = f.targets as ObjRef | PlayerRef;
    // M12-1: the one table of player-only references (types/ability.ts, m12 design 4.3); 'each' here is a set of players (a filter is the branch above)
    const isPlayer = isPlayerOnlyRef(t) || t.ref === 'each' || ('ref' in t && t.ref === 'target' && st.specs.get((t as { id: string }).id)?.kind === 'player');
    // Standard round 4, r4-trig (CR 115.9b): one player of a set is "that targets an opponent" / "a player" (parser/holes/filter.ts)
    const anyOne = t.ref === 'each' && 'who' in t ? ((t as { who: string }).who === 'opponent' ? 'an opponent' : (t as { who: string }).who === 'player' ? 'a player' : null) : null;
    const target = anyOne ?? (isPlayer ? K.player(t as PlayerRef, st, 'object').text : K.obj(t as ObjRef, st, 'object').text);
    p.post.push(`that ${plural ? 'target' : 'targets'} ${target}`);
  } else if (f.targets) {
    p.post.push(`that ${plural ? 'target' : 'targets'} ${K.obj(f.targets as ObjRef, st, 'object').text}`);
  }
  // std-rx28: the objects a spell targets are said only as a group the trigger named (render/refs.ts#obj), never as a description
  if (f.targetedBy !== undefined) throw new NoRenderer('a description of the objects a spell or ability targets');
  // FAST5 T45 (CR 113.7a): "ability you control from an artifact source": the source of an ability on the stack, described by one card type or by being colorless
  if (f.abilitySource) p.post.push(f.loyaltyAbility === true && JSON.stringify(f.abilitySource) === '{"types":["Planeswalker"]}' ? 'of a planeswalker' : `from ${abilitySourceText(f.abilitySource)}`); // edhd36: Verdant Command
  // FAST5 T45 (CR 115.9a, 115.9c): "that targets only a single creature you control", "that targets only ~", "with a single target"
  if (f.targetsOnly) {
    const to = f.targetsOnly as { ref?: string; filter?: ObjectFilter };
    // edh-next-74 (CR 115.9c; Radiate): "a single permanent or player"
    if (to.ref === 'each' && to.filter !== undefined && f.targetsOnlyPlayer === true) {
      if (JSON.stringify(to.filter) !== '{"zone":"battlefield"}') throw new NoRenderer('a "targets only a single <thing> or player" other than permanent or player');
      p.post.push('that targets only a single permanent or player');
    } else if (to.ref === 'each' && to.filter !== undefined && to.filter.other === true) {
      // edh-next-133 (CR 115.9c, 109.2; Ivy, Gleeful Spellthief; family targets-only-other-than-self): "that targets only a single creature other than ~" is "... a single other creature"
      const { other: _o, ...rest } = to.filter;
      const fork = cloneState(st);
      p.post.push(alt(`that targets only a single ${K.np(to.filter, st, { det: 'none' })}`, `that targets only a single ${K.np(rest, fork, { det: 'none' })} other than ~`));
    } else if (to.ref === 'each' && to.filter !== undefined) p.post.push(`that targets only a single ${K.np(to.filter, st, { det: 'none' })}`);
    else if (to.ref === 'self') p.post.push('that targets only ~');
    else throw new NoRenderer('a spell that targets only a reference other than a described object or itself');
  }
  if (f.targetCount) {
    // edh-next-121 (CR 115.9a; Wyll's Reversal): or "with one or more targets"
    if (f.targetCount.op === '>=' && f.targetCount.value === 1) p.post.push('with one or more targets');
    else if (f.targetCount.op !== '==' || f.targetCount.value !== 1) throw new NoRenderer('a number of targets other than a single one or one or more');
    else p.post.push('with a single target');
  }
  // edh-next-100 (CR 601.2a; Wash Away): "target spell that wasn't cast from its owner's hand"
  if (notCastFromHand(f.not)) p.post.push("that wasn't cast from its owner's hand");
  if (f.castFrom) p.post.push(`that ${was} cast from ${f.castFrom === 'hand' ? 'a hand' : `a ${ZONE_WORD[f.castFrom] ?? f.castFrom}`}`);
  if (f.isCopy === true) p.post.push("that's a copy of something");
  if (f.uncast === true) p.post.push("that wasn't cast"); // edhd60 (CR 707.10, 707.12)
  // FAST5 T68 (CR 303.4b): "creatures you control that are enchanted by Auras you control", "each creature that's enchanted by an Aura you control"
  if (f.enchantedBy !== undefined) {
    if (f.enchantedBy !== 'you') throw new NoRenderer('enchanted by an Aura somebody other than "you" controls');
    p.post.push(plural ? alt('that are enchanted by Auras you control', 'that are enchanted by an Aura you control') : "that's enchanted by an Aura you control"); // edh-next-26 (family enchanted-by-an-aura-plural; Killian, Decisive Mentor)
  }
  // FAST5 T68 (CR 715.1): "a card in exile that has an Adventure" (the lists of kinds, "that are instant cards, sorcery cards, and/or have an Adventure", are thatAreForm's)
  // r4-static: said before the zone too, "return target card that has an Adventure from your graveyard to your hand" (Edgewall Inn), as the "with" clause above
  const adv = plural ? 'that have an Adventure' : 'that has an Adventure';
  if (f.adventure === true && zoneAt >= 0 && zoneAt === p.post.length - 1) p.post[zoneAt] = alt(`${p.post[zoneAt]} ${adv}`, `${adv} ${p.post[zoneAt]}`);
  else if (f.adventure === true) p.post.push(adv);
  else if (f.adventure === false) throw new NoRenderer('adventure:false has no wording');
  if (f.attached === true) p.post.push("that's attached to a permanent");
  else if (f.attached === false) p.post.push("that isn't attached to a permanent");
  // FAST5 T68 (CR 201.2, 109.4): "permanents named Food Fight you control" says the same set as "permanents you control named Food Fight" (the name beside the
  // controller, in either order; Oracle prints both)
  if (f.name !== undefined) {
    // std-sos (CR 201.2, 400.1): the same beside a zone, "cards named Ancestral Anger in your graveyard" / "cards in your graveyard named Ancestral Anger" (only a zone or only a controller)
    const nameAt = ctrlAt >= 0 && ctrlAt === p.post.length - 1 && zoneAt < 0 ? ctrlAt : zoneAt >= 0 && zoneAt === p.post.length - 1 && ctrlAt < 0 ? zoneAt : -1;
    // edh-d-85 (CR 201.2, 201.5; Galactus, Devourer of Worlds): a name that contains the name of the card printing it (never the whole name) has that part said "~", as Oracle's own text is
    // normalized for the gate ("a creature named Silver Surfer, ~'s Herald")
    const own = st.ctx.selfNames.includes(f.name) ? undefined : [...st.ctx.selfNames, ...st.ctx.selfNames.filter((n) => n.includes(', ')).map((n) => n.split(', ')[0]!) /* the legendary short name before the comma */].sort((a, b) => b.length - a.length).find((n) => n !== '' && n !== f.name && new RegExp(`(^|[^A-Za-z])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`).test(f.name!));
    const shown = own === undefined ? f.name : f.name.split(own).join('~');
    if (nameAt >= 0) p.post[nameAt] = alt(`${p.post[nameAt]} named ${shown}`, `named ${shown} ${p.post[nameAt]}`);
    else p.post.push(`named ${shown}`);
  }
  if (f.notName !== undefined && !notNameSaid) {
    // edh-next-85 (CR 201.2, 400.1; Staff of Eden, Vault's Key): the same beside a zone, "target legendary permanent card not named X from a graveyard" says the set of
    // "... from a graveyard not named X" (the name beside the card, before or after the zone; only a zone, as `name` above)
    if (zoneAt >= 0 && zoneAt === p.post.length - 1 && ctrlAt < 0) p.post[zoneAt] = alt(`${p.post[zoneAt]} not named ${f.notName}`, `not named ${f.notName} ${p.post[zoneAt]}`);
    else p.post.push(`not named ${f.notName}`);
  }
  // r5-static (CR 201.2a, 708.2a): "creatures that don't have a name" (parser/holes/filter.ts REL)
  if (f.nameless === true) p.post.push(plural ? "that don't have a name" : "that doesn't have a name");
  else if (f.nameless === false) throw new NoRenderer('nameless:false has no wording');
  // FAST5 T59 (CR 115.3, 608.2c): "target creature you control other than that creature": not the object an earlier phrase or the event named
  // (the trigger event's subject is "other" itself, FAST5 T62: np() spells it out as the other reading)
  if (f.not && otherThanObject(f.not) && !notEvent) p.post.push(`other than ${K.obj(f.not.is!, st, 'object').text}`);
  // FAST5 T78 (CR 608.2c): "a permanent other than that creature or this Equipment" (Saw): not that object and not the source itself
  if (f.not && otherThanObjectOrSelf(f.not)) p.post.push(`other than ${K.obj(f.not.anyOf!.find((x) => x.is !== undefined)!.is!, st, 'object').text} or ${K.obj({ ref: 'self' }, st, 'object').text}`);
  // std-control-1 (CR 608.2c): "creatures other than ~ and the chosen creature" (Zenos yae Galvus): not the source and not the object an earlier choice of the ability named
  if (f.not && otherThanSelfAndChosen(f.not)) p.post.push(`other than ${K.obj({ ref: 'self' }, st, 'object').text} and ${K.obj(f.not.anyOf![1]!.is!, st, 'object').text}`);
  // C6 (CR 608.2c): "creatures they control not chosen this way", "all creatures except creatures chosen this way": without what an earlier step chose
  if (f.not && notWay !== undefined) {
    if (Object.entries(f.not).every(([k, v]) => v === undefined || k === 'is')) p.post.push(`not ${notWay}`);
    else p.post.push(`except ${K.np(f.not, st, { det: 'none', plural: true, noZone: true })}`);
  }
  return p;
}

/** FAST5 T59: `not: {is: <an object>}` and nothing else, "other than <that object>". */
function otherThanObject(not: ObjectFilter): boolean {
  const keys = Object.keys(not).filter((k) => (not as Record<string, unknown>)[k] !== undefined);
  return keys.length === 1 && keys[0] === 'is' && not.is !== undefined && not.is.ref !== 'bound' && not.is.ref !== 'subject'; // p2-pt-2: the object modified is "other" (negated)
}

/** FAST5 T78: `not: {anyOf: [{is: <an object>}, {self: true}]}` and nothing else, "other than <that object> or ~". */
/** edh-next-100: the `not` of "wasn't cast from its owner's hand". */
function notCastFromHand(not: ObjectFilter | undefined): boolean {
  return not !== undefined && not.castFrom === 'hand' && Object.keys(not).filter((k) => (not as Record<string, unknown>)[k] !== undefined).length === 1;
}

function otherThanObjectOrSelf(not: ObjectFilter): boolean {
  const keys = Object.keys(not).filter((k) => (not as Record<string, unknown>)[k] !== undefined);
  const a = not.anyOf;
  if (keys.length !== 1 || keys[0] !== 'anyOf' || a === undefined || a.length !== 2) return false;
  const one = a.find((x) => Object.keys(x).length === 1 && x.is !== undefined && x.is.ref !== 'bound');
  const self = a.find((x) => Object.keys(x).length === 1 && x.self === true);
  return one !== undefined && self !== undefined;
}

/** std-control-1: `not: {anyOf: [{self: true}, {is: <a bound object>}]}` and nothing else, "other than ~ and <that object>". */
function otherThanSelfAndChosen(not: ObjectFilter): boolean {
  const keys = Object.keys(not).filter((k) => (not as Record<string, unknown>)[k] !== undefined);
  const a = not.anyOf;
  if (keys.length !== 1 || keys[0] !== 'anyOf' || a === undefined || a.length !== 2) return false;
  return Object.keys(a[0]!).length === 1 && a[0]!.self === true && Object.keys(a[1]!).length === 1 && a[1]!.is?.ref === 'bound';
}

/**
 * FAST5 T42 (CR 113.1, 702): `not: {anyOf: [activated, triggered, static]}`, "creature cards with no abilities" (Rise from the Wreck): a keyword is an ability of one of
 * those kinds (rules/filter.ts#hasAbilityOfKind), a mana ability is an activated one; an ability whose kind is not known makes the card unevaluable, never "no abilities".
 */
function isAnyAbility(anyOf: readonly ObjectFilter[]): boolean {
  return anyOf.map((x) => x.hasAbility).sort().join() === 'activated,static,triggered' && anyOf.every((x) => Object.keys(x).filter((k) => (x as Record<string, unknown>)[k] !== undefined).length === 1);
}
function isNoAbilities(not: ObjectFilter): boolean {
  const keys = Object.keys(not).filter((k) => (not as Record<string, unknown>)[k] !== undefined);
  const kinds = not.anyOf?.map((x) => x.hasAbility).sort().join();
  return keys.length === 1 && keys[0] === 'anyOf' && kinds === 'activated,static,triggered' && not.anyOf!.every((x) => Object.keys(x).length === 1);
}

/** FAST5 T45: "an artifact source", "a colorless source", "a creature source": a source described by one card type, or colorless (nothing else has a wording). */
function abilitySourceText(f: ObjectFilter): string {
  const keys = Object.entries(f).filter(([, v]) => v !== undefined).map(([k]) => k);
  if (keys.length === 1 && keys[0] === 'colorless' && f.colorless === true) return 'a colorless source';
  if (keys.length === 1 && keys[0] === 'types' && f.types!.length === 2) return `${withArticle(lowerType(f.types![0]!))} or ${lowerType(f.types![1]!)} source`; // edhd43: "from an artifact or enchantment source"
  if (keys.length === 1 && keys[0] === 'types' && f.types!.length === 1) return `${withArticle(lowerType(f.types![0]!))} source`;
  if (keys.length === 1 && keys[0] === 'notTypes' && f.notTypes!.length === 1) return `${withArticle(`non${lowerType(f.notTypes![0]!)}`)} source`; // edhd36: "from a noncreature source"
  if (JSON.stringify(f) === JSON.stringify({ supertypes: ['Legendary'], other: true, not: { commander: true } })) return "another legendary source that's not a commander"; // edh-next-131: The Peregrine Dynamo
  throw new NoRenderer('a source of an ability described by more than one card type or by other fields');
}

/**
 * std-rl: one comparison of power, toughness or mana value with a number, and no other feature said with "with", of a permanent you or an opponent controls.
 * edh-d-45 (Grim Giganotosaurus): also in a count of an opponent's permanents ("for each creature with power 4 or greater your opponents control"); it was held back
 * until its own review (an ability-level cost change of formerly partial abilities: manual units only, checked by the whole-index G10).
 */
function statBeforeController(f: ObjectFilter): boolean {
  if (f.controller !== 'you' && f.controller !== 'opponent') return false;
  const stats = [f.power, f.toughness, f.manaValue].filter((c) => c !== undefined);
  return stats.length === 1 && typeof stats[0]!.value === 'number';
}

/** FAST4 T25: the one comparison of `[{power: c}, {toughness: c}]` (in either order), or null. */
function powerOrToughness(options: readonly ObjectFilter[]): NonNullable<ObjectFilter['power']> | null {
  const only = (o: ObjectFilter, k: 'power' | 'toughness'): boolean => Object.keys(o).every((x) => x === k || (o as Record<string, unknown>)[x] === undefined) && o[k] !== undefined;
  const [a, b] = options as [ObjectFilter, ObjectFilter];
  const p = only(a, 'power') ? a : only(b, 'power') ? b : null;
  const t = only(a, 'toughness') ? a : only(b, 'toughness') ? b : null;
  if (p === null || t === null || p === t || JSON.stringify(p.power) !== JSON.stringify(t.toughness)) return null;
  return p.power!;
}

/** CLOUD C4: `not: {is: <a target, or the objects an earlier instruction bound>}` and nothing else (the group leaves out what an earlier instruction named). */
const otherThanTarget = (not: ObjectFilter | undefined): boolean => not !== undefined && Object.keys(not).length === 1 && (not.is?.ref === 'target' || not.is?.ref === 'bound');
/** FAST5 T62: the filter `{not: {is: the subject of the trigger event}}`, which says "other" of the object the event is about. */
const isNotEventSubject = (not: ObjectFilter | undefined): boolean => not !== undefined && Object.keys(not).length === 1 && (JSON.stringify(not.is) === '{"ref":"event","role":"subject"}' || JSON.stringify(not.is) === '{"ref":"event","role":"object"}' /* edh-next-99: the damaged object of a damage trigger, "each other creature" (Kusari-Gama) */);

/** FAST5X E1, CR 700.12: the outlaw creature types exactly (in any order). */
const OUTLAWS = ['Assassin', 'Mercenary', 'Pirate', 'Rogue', 'Warlock'];
const isOutlaws = (list: readonly string[] | undefined): boolean => list !== undefined && list.length === OUTLAWS.length && [...list].sort().join() === OUTLAWS.join();

/** The three options of "historic" (CR 700.6), as parser/holes/filter.ts reads the word: an artifact, a legendary object or a Saga. */
function isHistoric(options: readonly ObjectFilter[]): boolean {
  const key = (o: ObjectFilter): string => JSON.stringify(Object.entries(o).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)));
  const want = [{ types: ['Artifact'] }, { supertypes: ['Legendary'] }, { subtypes: ['Saga'] }].map(key).sort();
  return options.length === 3 && JSON.stringify(options.map(key).sort()) === JSON.stringify(want);
}

/**
 * FAST5 T49 (CR 205.2a, 715.1): "cards in your graveyard that are instant cards, sorcery cards, and/or have an Adventure", "permanents you control that are
 * creatures and/or Vehicles": a plural set of cards or permanents (nothing but where they are and who has them said of it) of which each is one of a few kinds.
 * The kinds are single card types or subtypes, or "have an Adventure" (the model's `adventure`). Null for any other filter.
 */
function thatAreForm(f: ObjectFilter, st: RenderState, o: NpOpts, plural: boolean, det: NonNullable<NpOpts['det']> = 'none'): string | null {
  const { anyOf, ...rest } = f;
  if (anyOf === undefined || anyOf.length < 2 || anyOf.length > 5) return null; // p2-pt-2: up to five kinds ("that's a Cat, Elemental, Nightmare, Dinosaur, or Beast")
  const base = build(rest, st, plural, o);
  // edh-d-76 (CR 205.2a, 202.3; Desdemona, Freedom's Edge): one object that is a card type or has a mana value comparison, "target creature card in your graveyard that's an artifact or that has
  // mana value 3 or less" (parser/holes/filter.ts#thatsTypeOrMv): the type first, the comparison second, each said with its own "that"
  if (!plural && anyOf.length === 2 && anyOf[0]!.types?.length === 1 && Object.keys(anyOf[0]!).length === 1 && anyOf[1]!.manaValue !== undefined && Object.keys(anyOf[1]!).length === 1
    && base.whole === undefined && base.heads.length === 1) {
    return `${compose(base, { det }, plural)} that is ${withArticle(lowerType(anyOf[0]!.types![0]!))} or that has mana value ${cmpPhrase(anyOf[1]!.manaValue!, st)}`;
  }
  // std-lci: after one card type of permanents, the kinds are subtypes ("creatures you control that are Fungi and/or Saprolings", The Mycotyrant)
  // edh-b-2 (CR 205.2a, 205.3m; Paladin Danse): one card type after the noun's type, then subtypes: "each creature you control that's an artifact or Human" (parser/holes/filter.ts#thatsTypeOrSubtype)
  const typeFirst = anyOf[0]!.types?.length === 1 && Object.keys(anyOf[0]!).length === 1 && anyOf.slice(1).every((opt) => opt.subtypes?.length === 1 && Object.keys(opt).length === 1);
  const typed = rest.types?.length === 1 && base.heads.length === 1 && base.heads[0] === lowerType(rest.types[0]!) && ((anyOf.every((opt) => opt.subtypes?.length === 1 || opt.token === true) && anyOf.some((opt) => opt.subtypes !== undefined)) || (typeFirst && o.shareCreatureType !== true));
  // edh-next-68 (CR 205.3m; Solemn Doomguide): "each creature card in your graveyard that's a Cleric, Rogue, Warrior, and/or Wizard": the noun phrase of a card type with its "card" after it, then the subtypes
  const typedCard = base.suffix === 'card' && typed && o.shareCreatureType !== true && anyOf.every((opt) => opt.subtypes?.length === 1 && Object.keys(opt).length === 1);
  if (base.whole !== undefined || (base.suffix !== '' && !typedCard) || base.heads.length !== 1 || (base.heads[0] !== 'card' && base.heads[0] !== 'permanent' && !typed)) return null;
  const cards = base.heads[0] === 'card';
  const items: string[] = [];
  for (const opt of anyOf) {
    const keys = Object.keys(opt).filter((k) => (opt as Record<string, unknown>)[k] !== undefined);
    if (keys.length !== 1) return null;
    // std-re (CR 111.1): "each other creature you control that's a token or a Rabbit" (parser/holes/filter.ts#thatsKinds)
    const kind = opt.types?.length === 1 ? lowerType(opt.types[0]!) : opt.subtypes?.length === 1 ? opt.subtypes[0]! : opt.token === true && !cards ? 'token' : null;
    if (opt.adventure === true) items.push(plural ? 'have an Adventure' : 'has an Adventure');
    else if (kind !== null) items.push(plural ? (cards ? `${kind} cards` : pluralize(kind)) : withArticle(cards ? `${kind} card` : kind));
    else return null;
  }
  // "have an Adventure" is a verb phrase beside noun phrases: only after at least one noun phrase, and at most once
  const verb = items.filter((i) => /^has?e? an Adventure$/.test(i) || i === 'have an Adventure' || i === 'has an Adventure').length;
  if (verb > 1 || items[0] === 'have an Adventure' || items[0] === 'has an Adventure') return null;
  // one object, "for each card ... that is an instant card, a sorcery card, or has an Adventure": the same set counted object by object
  // merge of lines C and D (CR 205.3m): after one card type the subtypes also read with "or", "creatures you control that are Wolves or Werewolves" (Cloud C3's
  // family that-are-subtypes, whose own alternative in K.np is not reached once this list is the whole phrase)
  // edh-d-17 (CR 205.2a, 715.1; Sailors' Bane): one card that is one of several card types or has an Adventure is also "an instant card, a sorcery card, or a card that has an Adventure"
  const advLast = !plural && items.length >= 3 && items[items.length - 1] === 'has an Adventure' ? joinList([...items.slice(0, -1), 'a card that has an Adventure'], 'or') : null;
  // edh-d-102 (CR 205.2a, 715.1; Candlekeep Inspiration; family that-are-kinds-are-again): the plural list of cards with the verb said again before each later kind, "that are instant cards, are
  // sorcery cards, and/or have an Adventure"
  const areAgain = plural && cards && items.length >= 2 ? [andOr(items.map((x, i) => (i === 0 || x === 'have an Adventure' ? x : `are ${x}`)))] : [];
  const kinds0 = plural && typed ? alt(andOr(items), joinList(items, 'or'), ...areAgain) : plural ? alt(andOr(items), ...areAgain) : typedCard ? alt(joinList(items, 'or'), andOr(items)) : joinList(items, 'or');
  const kinds = advLast !== null ? alt(kinds0, advLast) : kinds0;
  // std-re (CR 205.3m): one article for the whole singular list is printed too, "each other creature you control that's a Skeleton or Pirate" (parser/holes/filter.ts#thatsKinds)
  // edh-zones-19 (CR 205.2a, 205.3; Ao, the Dawn Sky): and a permanent that's a card type or a subtype, "each permanent you control that's a creature or Vehicle" (parser/holes/filter.ts#thatsTypeOrSubtype)
  const typeThenKinds = !plural && !cards && anyOf.length >= 2 && anyOf[0]!.types?.length === 1 && Object.keys(anyOf[0]!).length === 1 && anyOf.slice(1).every((opt) => opt.subtypes?.length === 1 && Object.keys(opt).length === 1);
  const oneArticle = !plural && !cards && (typed && !typeThenKinds ? anyOf.every((opt) => opt.subtypes?.length === 1 || opt.token === true) : typeThenKinds)
    ? joinList(items.map((x, i) => (i === 0 ? x : x.replace(/^an? /, ''))), 'or') : null;
  const oneArticleAndOr = oneArticle !== null && typedCard ? andOr(items.map((x, i) => (i === 0 ? x : x.replace(/^an? /, '')))) : null;
  return `${compose(base, { det }, plural)} that ${plural ? 'are' : 'is'} ${oneArticle !== null && oneArticle !== joinList(items, 'or') ? (oneArticleAndOr !== null ? alt(kinds, oneArticle, oneArticleAndOr) : alt(kinds, oneArticle)) : oneArticleAndOr !== null ? alt(kinds, oneArticleAndOr) : kinds}`;
}

/**
 * edh-d-21: the kinds of `{anyOf: [{types: [T1]}, ..., {types: [Tn], notSubtypes: [S]}], isCard: true, ...}` (two or more options, each one card type, only the last with a "non-<subtype>"
 * of its own, `isCard` beside it) as the words before the shared head "card": "artifact or non-Aura enchantment", "artifact, creature, or non-Aura enchantment". Null for any other filter.
 */
function sharedCardKinds(f: ObjectFilter, plural = false): string | null {
  const a = f.anyOf;
  if (a === undefined || a.length < 2 || a.length > 5 || f.isCard !== true) return null;
  const items: string[] = [];
  for (let i = 0; i < a.length; i++) {
    const opt = a[i]!;
    const keys = Object.keys(opt).filter((k) => (opt as Record<string, unknown>)[k] !== undefined).sort().join();
    // edh-next-116 (Rob the Hoard): "artifact, enchantment, or legendary card": the last option is the supertype alone, after two or more bare card types
    if (i === a.length - 1 && i >= 1 && keys === 'supertypes' && opt.supertypes?.length === 1 && opt.supertypes[0] === 'Legendary' && items.length === i) { items.push('legendary'); continue; }
    if (opt.types?.length !== 1) return null;
    if (i < a.length - 1) {
      if (keys !== 'types') return null;
      items.push(lowerType(opt.types[0]!));
    } else {
      if (keys !== 'notSubtypes,types' || opt.notSubtypes?.length !== 1) return null;
      items.push(`non-${opt.notSubtypes[0]!} ${lowerType(opt.types[0]!)}`);
    }
  }
  // edh-next-125 (family shared-card-kinds-and-or; CR 205.2a; Dance of the Manse): the plural list is also said with "and/or", "artifact and/or non-Aura enchantment cards"
  // (cards each of one of the kinds: a plural "and/or" list of kinds is "or", as Oracle prints "artifact and/or enchantment cards")
  if (plural && items.length === 2) return alt(joinList(items, 'or'), `${items[0]} and/or ${items[1]}`);
  return joinList(items, 'or');
}

function buildAnyOf(f: ObjectFilter, st: RenderState, plural: boolean, o: NpOpts): Parts {
  if (o.shareCreatureType === true) throw new NoRenderer('a shared creature type beside a list of kinds'); // CLOUD std-ecl
  // edh-next-116 (CR 208.1, 400.1; Skanos Dragonheart): "other Dragons you control and Dragon cards in your graveyard": one description on the battlefield and one in a graveyard (the parser's
  // two-zone set, parser/holes/qty.ts), said as two noun phrases joined by "and"; "other" belongs to the first
  if (f.anyOf?.length === 2 && JSON.stringify(f.zone) === '["battlefield","graveyard"]' && (f.anyOf[0]!.zone === undefined || f.anyOf[0]!.zone === 'battlefield') && f.anyOf[1]!.zone === 'graveyard'
    && Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).every((k) => k === 'anyOf' || k === 'zone' || k === 'other')) {
    if (o.det !== undefined && o.det !== 'none') throw new NoRenderer('two noun phrases in two zones after a determiner');
    const { zone: _bz, ...first } = f.anyOf[0]!;
    const a = build({ ...first, ...(f.other === true ? { other: true } : {}) }, st, plural, o);
    const b = build(f.anyOf[1]!, st, plural, o);
    if (a.whole !== undefined || b.whole !== undefined) throw new NoRenderer('two noun phrases in two zones with a whole reference');
    return { ...a, whole: `${compose(a, { det: 'none' }, plural)} and ${compose(b, { det: 'none' }, plural)}` };
  }
  // edh-d-21 (lane type-change; CR 205.2a, 205.3m; Abuelo's Awakening, Excava, the Risen Past): "artifact or non-Aura enchantment card", "artifact, creature, or non-Aura enchantment card":
  // cards that are one card type each, one of them not of a subtype, the word "card" said once for the whole list (parser/holes/filter.ts#orPhrases, #listPhrases)
  const sharedCards = sharedCardKinds(f, plural);
  if (sharedCards !== null) {
    const { anyOf: _kinds, ...rest } = f;
    const base = build({ ...rest, isCard: true }, st, plural, o);
    if (base.heads.length === 1 && base.heads[0] === 'card' && base.whole === undefined && base.adj.length === 0 && base.negs.length === 0) {
      base.adj.push(sharedCards);
      return base;
    }
    throw new NoRenderer('a list of card kinds beside other words before the card');
  }
  // FAST5 T42: "basic land cards and/or Town cards with different names": the words once, after the whole list (the set chosen, not each kind of card)
  if (o.differentNames === true) {
    const p = buildAnyOfPlain(f, st, plural, { ...o, differentNames: false });
    if (p.whole !== undefined) p.whole = `${p.whole} with different names`;
    else p.post.push('with different names');
    return p;
  }
  // std-re (CR 205.3m): also after a determiner, "each creature you control that's a Wolf or a Werewolf", "each other creature you control that's a token or a
  // Rabbit" (parser/holes/filter.ts#thatsKinds): the determiner with the noun before "that is", the words said so far kept beside it
  if (o.det !== undefined && o.det !== 'none' && TARGETING_DETS.has(o.det) && o.count === undefined && !(f.anyOf ?? []).some((opt) => opt.adventure !== undefined)) {
    const { r: withDet, said } = apart(st, () => thatAreForm(f, st, o, plural, o.det));
    if (withDet !== null) {
      const plain = buildAnyOfPlain(f, st, plural, o);
      for (const k of said) st.mentioned.add(k);
      return { ...plain, whole: alt(compose(plain, o, plural), withDet), wholeHasDet: true };
    }
  }
  const { r: says, said } = apart(st, () => ((o.det === undefined || o.det === 'none') && o.count === undefined ? thatAreForm(f, st, o, plural) : null));
  const hasAdventure = (f.anyOf ?? []).some((opt) => opt.adventure !== undefined);
  if (says === null) {
    if (hasAdventure) throw new NoRenderer('an Adventure beside no "that are" list of kinds');
    return buildAnyOfPlain(f, st, plural, o);
  }
  // "cards that are X, Y, and/or have an Adventure" is the only wording of an Adventure; the other kinds also read "X cards, Y cards in your graveyard"
  if (hasAdventure) return { ...build({ ...f, anyOf: undefined }, st, plural, o), whole: says };
  const plain = buildAnyOfPlain(f, st, plural, o);
  for (const k of said) st.mentioned.add(k);
  return { ...plain, whole: alt(plain.whole ?? compose(plain, { det: 'none' }, plural), says) };
}

/** edh-next-20 (CR 115.1, 608.2c): one wording of a group is written from the same point as the next, so what it mentions ("target player controls") is not mentioned yet for the other; returns the mentions to add after both. */
function apart<T>(st: RenderState, run: () => T): { r: T; said: Set<string> } {
  const start = new Set(st.mentioned);
  const r = run();
  const said = st.mentioned;
  st.mentioned = start;
  return { r, said };
}

/** FAST5 T59: the determiners compose() puts before a whole list of alternatives. */
const TARGETING_DETS: ReadonlySet<string> = new Set(['target', 'all', 'each', 'any', 'the']);

/**
 * FAST5 T66: the options of an `anyOf` that are one filter each with a different exact mana value (`{anyOf:[F], manaValue: ==N}`, the alternatives of
 * "mana value 4 or 5"): the common filter F and the numbers in order. Null for anything else (two or more options, all of that exact shape, one F, different numbers).
 */
function manaValueAlternatives(anyOf: ObjectFilter[] | undefined): { base: ObjectFilter; values: number[] } | null {
  if (anyOf === undefined || anyOf.length < 2) return null;
  const values: number[] = [];
  let base: ObjectFilter | undefined;
  for (const opt of anyOf) {
    const keys = Object.keys(opt).filter((k) => (opt as Record<string, unknown>)[k] !== undefined);
    const mv = opt.manaValue;
    if (keys.length !== 2 || opt.anyOf?.length !== 1 || mv === undefined || mv.op !== '==' || typeof mv.value !== 'number') return null;
    const inner = opt.anyOf[0]!;
    if (base !== undefined && JSON.stringify(base) !== JSON.stringify(inner)) return null;
    base = inner;
    values.push(mv.value);
  }
  return new Set(values).size === values.length && base !== undefined ? { base, values } : null;
}

/** std-rx5: `anyOf` of exactly one manaValue, one power and one toughness option with the same comparison ("with mana value, power, or toughness equal to N"). */
function mvPowerOrToughness(options: readonly ObjectFilter[]): NonNullable<ObjectFilter['power']> | null {
  if (options.length !== 3) return null;
  const only = (k: 'manaValue' | 'power' | 'toughness'): ObjectFilter | undefined =>
    options.find((o) => o[k] !== undefined && Object.keys(o).every((x) => x === k || (o as Record<string, unknown>)[x] === undefined));
  const [m, p, t] = [only('manaValue'), only('power'), only('toughness')];
  if (m === undefined || p === undefined || t === undefined) return null;
  const cmp = JSON.stringify(m.manaValue);
  return cmp === JSON.stringify(p.power) && cmp === JSON.stringify(t.toughness) ? m.manaValue! : null;
}

/** edh-zones-1 (CR 205.3i): the type Land with exactly the five basic land types as its subtypes (any of them): "a land card with a basic land type". */
function isBasicLandTypeLand(types: string[], all: string[], subtypes: string[]): boolean {
  return types.length === 1 && types[0] === 'land' && all.length === 0 && subtypes.length === 5 && [...BASIC_LAND_TYPES].every((t) => subtypes.includes(t));
}

/** trek-9 (CR 205.3i, 202.3): a description of lands only ("a Plains card", "a land card"): the Plains-like basic land types or the type Land, nothing else of the cards named. */
const BASIC_LAND_TYPES: ReadonlySet<string> = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']);
function isLandDescription(o: ObjectFilter): boolean {
  const keys = Object.keys(o).filter((k) => (o as Record<string, unknown>)[k] !== undefined);
  if (keys.some((k) => k !== 'types' && k !== 'subtypes' && k !== 'supertypes')) return false;
  if (o.types !== undefined) return o.types.length === 1 && o.types[0] === 'Land' && (o.subtypes ?? []).every((x) => BASIC_LAND_TYPES.has(x));
  return o.subtypes !== undefined && o.subtypes.length > 0 && o.subtypes.every((x) => BASIC_LAND_TYPES.has(x));
}

/** trek-9: a mana value limit that every land meets, "mana value N or less" / "mana value less than N" (a land's mana value is 0, CR 202.3): no other words of the description count. */
function landsMeetMvLimit(o: ObjectFilter): boolean {
  const c = o.manaValue;
  if (c === undefined || typeof c.value !== 'number') return false;
  return (c.op === '<=' && c.value >= 0) || (c.op === '<' && c.value >= 1);
}

function buildAnyOfPlain(f: ObjectFilter, st: RenderState, plural: boolean, o: NpOpts, spellOut = false): Parts {
  const { anyOf, ...rest } = f;
  // std-rx5 (CR 202.3, 208.1): "a spell with mana value, power, or toughness equal to the chosen number": one comparison any of the three statistics meets
  const mpt = anyOf !== undefined ? mvPowerOrToughness(anyOf) : null;
  if (mpt !== null) {
    if (rest.keyword !== undefined || rest.power || rest.toughness || rest.manaValue || rest.counters || rest.hasAbility) throw new NoRenderer('"with mana value, power, or toughness" beside another feature');
    const inner = build(rest, st, plural, o);
    if (inner.whole !== undefined) throw new NoRenderer('"with mana value, power, or toughness" after a whole reference');
    inner.post.push(`with mana value, power, or toughness ${cmpPhrase(mpt, st)}`);
    return inner;
  }
  // FAST4 T25 (CR 208.1): "with power or toughness 4 or greater": one comparison that either statistic meets (parser/holes/filter.ts#featureAt); only beside
  // no other "with" feature, so the one "with" phrase is the whole feature list
  const pt = anyOf !== undefined && anyOf.length === 2 ? powerOrToughness(anyOf) : null;
  if (pt !== null) {
    if (rest.keyword !== undefined || rest.power || rest.toughness || rest.manaValue || rest.counters || rest.hasAbility) throw new NoRenderer('"with power or toughness" beside another feature');
    const inner = build(rest, st, plural, o);
    if (inner.whole !== undefined) throw new NoRenderer('"with power or toughness" after a whole reference');
    inner.post.push(`with power or toughness ${cmpPhrase(pt, st)}`);
    return inner;
  }
  // r5-mech (CR 201.2, 205.3m): "cards ... that are Oozes or are named Slime Against Humanity" (parser/holes/filter.ts#areOrNamed): one subtype or one name
  const sub = anyOf?.length === 2 && Object.keys(anyOf[0]!).join() === 'subtypes' && anyOf[0]!.subtypes!.length === 1 && Object.keys(anyOf[1]!).join() === 'name' ? anyOf : null;
  if (sub !== null && rest.subtypes === undefined && rest.name === undefined) {
    const inner = build(rest, st, plural, o);
    if (inner.whole !== undefined) throw new NoRenderer('"that are <subtypes> or are named" after a whole reference');
    inner.post.push(`${plural ? 'that are' : "that's"} ${plural ? pluralize(sub[0]!.subtypes![0]!) : withArticle(sub[0]!.subtypes![0]!)} or ${plural ? 'are' : 'is'} named ${sub[1]!.name}`);
    return inner;
  }
  // edh-d-11 (CR 205.4a, 205.3m; Narfi, Betrayer King): "snow and Zombie creatures": one supertype option and one subtype option beside a card type (parser/holes/filter.ts#headAt)
  const supSub = anyOf?.length === 2 && Object.keys(anyOf[0]!).join() === 'supertypes' && anyOf[0]!.supertypes!.length === 1 && Object.keys(anyOf[1]!).join() === 'subtypes' && anyOf[1]!.subtypes!.length === 1 ? anyOf : null;
  if (supSub !== null && rest.subtypes === undefined && rest.supertypes === undefined && rest.types?.length === 1 && rest.allTypes === undefined) {
    const inner = build({ ...rest, subtypes: supSub[1]!.subtypes }, st, plural, o);
    if (inner.whole !== undefined || inner.heads.length !== 1) throw new NoRenderer('a whole reference beside "<supertype> and <subtype> <type>"');
    inner.heads = [`${supSub[0]!.supertypes![0]!.toLowerCase()} and ${inner.heads[0]!}`];
    return inner;
  }
  // edhd60 (Nashi, Moon's Legacy): "legendary or Rat card": the same two options beside no card type, the head "card" of the singular (parser/holes/filter.ts)
  if (supSub !== null && rest.subtypes === undefined && rest.supertypes === undefined && rest.types === undefined && rest.allTypes === undefined && !plural) {
    const inner = build({ ...rest, subtypes: supSub[1]!.subtypes }, st, plural, o);
    if (inner.whole !== undefined || inner.heads.length !== 1 || inner.suffix !== 'card') throw new NoRenderer('a whole reference beside "<supertype> or <subtype> card"');
    inner.heads = [`${supSub[0]!.supertypes![0]!.toLowerCase()} or ${inner.heads[0]!}`];
    return inner;
  }
  // edh-next-131 (CR 205.3m, 702.173a; Jacob Frye): "Assassin card or card with freerunning": one subtype option and one keyword option, each a card, beside no type or keyword of their own;
  // the singular target phrase, the two nouns said apart and the rest of the description (the zone) after both; any other determiner keeps the reading below ("a Spirit card or a card with disturb")
  const subKw = anyOf?.length === 2 && Object.keys(anyOf[0]!).sort().join() === 'isCard,subtypes' && anyOf[0]!.subtypes!.length === 1 && anyOf[0]!.isCard === true
    && Object.keys(anyOf[1]!).sort().join() === 'isCard,keyword' && anyOf[1]!.isCard === true && typeof anyOf[1]!.keyword === 'string' ? anyOf : null;
  if (subKw !== null && !plural && o.det === 'target' && rest.types === undefined && rest.subtypes === undefined && rest.keyword === undefined && rest.allTypes === undefined && rest.isCard === undefined) {
    const inner = build({ ...rest, isCard: true }, st, plural, o);
    if (inner.whole !== undefined || inner.heads.length !== 1 || inner.heads[0] !== 'card' || inner.adj.length > 0 || inner.negs.length > 0) throw new NoRenderer('a whole reference beside "<subtype> card or card with <keyword>"');
    return { ...inner, heads: [`${subKw[0]!.subtypes![0]!} card or card with ${String(subKw[1]!.keyword)}`], suffix: '' };
  }
  // FAST5 T66 (CR 202.3): "an artifact card with mana value 4 or 5": alternatives that are the same filter with one mana value each, the numbers said once
  const mvs = manaValueAlternatives(anyOf);
  if (mvs !== null) {
    if (rest.manaValue) throw new NoRenderer('"with mana value N or M" beside another mana value');
    const inner = build({ ...rest, anyOf: [mvs.base] }, st, plural, o);
    if (inner.whole !== undefined) throw new NoRenderer('"with mana value N or M" after a whole reference');
    inner.post.push(`with mana value ${joinList(mvs.values.map(String), 'or')}`);
    return inner;
  }
  // edh-perms-8 (CR 202.3; Kozilek's Unsealing): "a creature spell with mana value 4, 5, or 6": options that are each one exact mana value (holes/filter.ts), the numbers said once;
  // edh-next-86 (CR 208.1; Sarkhan's Unsealing): and the same with power or toughness ("with power 4, 5, or 6")
  for (const stat of ['manaValue', 'power', 'toughness'] as const) {
    const word = stat === 'manaValue' ? 'mana value' : stat;
    if (anyOf !== undefined && anyOf.length >= 2 && anyOf.every((x) => Object.keys(x).filter((k) => (x as Record<string, unknown>)[k] !== undefined).join() === stat && (x[stat] as { op: string }).op === '==' && typeof (x[stat] as { value: unknown }).value === 'number')) {
      if (rest[stat]) throw new NoRenderer(`"with ${word} N, M, or K" beside another ${word}`);
      const inner = build(rest, st, plural, o);
      if (inner.whole !== undefined) throw new NoRenderer(`"with ${word} N, M, or K" after a whole reference`);
      inner.post.push(`with ${word} ${joinList(anyOf.map((x) => String((x[stat] as { value: number }).value)), 'or')}`);
      return inner;
    }
  }
  // FAST4 T23: "a spell that's both green and blue" is one color AND another (CR 105.2: an object is each of its colors): `colors` of one color with a lone
  // `anyOf` alternative of another one color (the fields beside `anyOf` are ANDed with it, design 3.3)
  const both = anyOf?.length === 1 ? anyOf[0]! : undefined;
  if (both !== undefined && Object.keys(both).length === 1 && both.colors?.length === 1 && rest.colors?.length === 1 && rest.colors[0] !== both.colors[0]) {
    const { colors: _c, ...noColor } = rest;
    const p = build(noColor, st, plural, o);
    p.post.push(`${plural ? 'that are' : "that's"} both ${COLOR_WORD[rest.colors[0]!] ?? rest.colors[0]} and ${COLOR_WORD[both.colors[0]!] ?? both.colors[0]}`);
    return p;
  }
  // std-rk (CR 700.6; family historic): "target attacking historic creature" (Tegan Jovanka): one card type said with the word, before which the three options are
  // not each spelled (an option's own card type would take the place of the head's: "an artifact or legendary creature or Saga" is another set)
  if (isHistoric(anyOf ?? []) && rest.types?.length === 1 && rest.allTypes === undefined) {
    const h = build(rest, st, plural, o);
    // edh-next-14 (family historic-attacking-order; Tegan Jovanka): "target attacking historic creature" is also "historic attacking creature", the same two adjectives
    if (h.whole === undefined && h.adj.length === 1 && h.adj[0] === 'attacking') return { ...h, adj: [alt('historic attacking', 'attacking historic')] };
    if (h.whole === undefined) return { ...h, adj: ['historic', ...h.adj] };
  }
  // edh-next-47 (CR 105.2, 205.2a; parser/holes/filter.ts#colorMod; Soldevi Adnate): "a black or artifact creature": the noun's own card type beside `anyOf` of one color list and one
  // other card type: an object of the noun that is one of the colors or has the type (the options are not each spelled: an option's own card type would take the head's place)
  if (anyOf?.length === 2 && Object.keys(anyOf[0]!).join() === 'colors' && Object.keys(anyOf[1]!).join() === 'types' && anyOf[1]!.types!.length === 1 && rest.types?.length === 1
    && rest.allTypes === undefined && rest.colors === undefined && rest.types[0] !== anyOf[1]!.types![0]) {
    const h = build(rest, st, plural, o);
    if (h.whole === undefined && h.adj.length === 0) return { ...h, adj: [`${joinList(anyOf[0]!.colors!.map((c) => COLOR_WORD[c] ?? c), 'or')} or ${anyOf[1]!.types![0]!.toLowerCase()}`] };
  }
  // edh-next-20 (CR 115.1, 608.2c; Brigid, Hero of Kinsbaile): every option is written from the same point, so a target the shared fields name ("target player controls") is said in full in
  // each, never "that player" in the later ones; what any option mentions is mentioned after the list
  const start = new Set(st.mentioned);
  const seen = new Set(start);
  const ps = (anyOf ?? []).map((opt) => {
    st.mentioned = new Set(start);
    const p = build({ ...rest, ...opt }, st, plural, { ...o, anyOfOption: true });
    for (const k of st.mentioned) seen.add(k);
    return p;
  });
  st.mentioned = seen;
  const first = ps[0]!;
  const same = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
  const merged: Parts = { ...first, adj: first.adj.slice(), heads: first.heads.slice(), post: first.post.slice() };
  // edh-next-23 (CR 205.3m, 109.2, 613.4c; family subtype-groups-and-other, Verdeloth the Ancient): two plural groups of one card type that differ in the subtype, the second "other": "Saproling creatures and other
  // Treefolk creatures" is every object of either group (also said with "or"), never for a set with anything else said of it
  if (plural && anyOf?.length === 2 && ps.length === 2 && Object.keys(rest).length === 0 && anyOf[0]!.subtypes?.length === 1 && anyOf[1]!.subtypes?.length === 1 && JSON.stringify(anyOf[0]!.types) === JSON.stringify(anyOf[1]!.types) && Object.keys(anyOf[0]!).length === 2 && Object.keys(anyOf[1]!).length === 3 && ps.every((p) => p.whole === undefined && p.post.length === 0 && p.suffix === '' && p.heads.length === 1) && !ps[0]!.other && ps[1]!.other === true) {
    const a = compose(ps[0]!, { det: 'none' }, plural);
    const b = compose(ps[1]!, { det: 'none' }, plural);
    return { ...first, adj: [], heads: [], post: [], whole: alt(`${a} or ${b}`, `${a} and ${b}`) };
  }
  if (ps.some((p) => p.whole !== undefined)) {
    merged.whole = ps.map((p) => p.whole ?? compose(p, { det: 'none' }, plural)).join(' or ');
    return merged;
  }
  // edh-b-1 (CR 205.4a, 205.2a; family legendary-last-in-list, Acclaimed Contender): "a Knight, Aura, Equipment, or legendary artifact card": a list of card types or subtypes whose last item
  // is a legendary one, the card noun said once after it (the parser's `ListedCard` hole); the two descriptions stay spelled out in the display
  if (anyOf?.length === 2 && ps.length === 2 && Object.keys(anyOf[0]!).length === 1 && (anyOf[0]!.types !== undefined || anyOf[0]!.subtypes !== undefined)
    && anyOf[1]!.supertypes?.length === 1 && anyOf[1]!.supertypes[0] === 'Legendary' && Object.keys(anyOf[1]!).length === 2 && (anyOf[1]!.types?.length === 1 || anyOf[1]!.subtypes?.length === 1)) {
    const [a, b] = ps as [Parts, Parts];
    if (a.adj.length === 0 && same(b.adj, ['legendary']) && b.heads.length === 1 && a.suffix === 'card' && b.suffix === 'card' && a.post.length === 0 && b.post.length === 0 && a.typeAfter === undefined && b.typeAfter === undefined) {
      return { ...merged, adj: [], heads: [...a.heads, `legendary ${b.heads[0]}`], post: [] };
    }
  }
  // FAST5X E27 review (CR 115.1): "artifact, enchantment, or creature with flying": the keyword after a list of card types belongs to the last type only
  // (parser/holes/filter.ts#keywordOnLastType): [the other types], [the last type with the keyword], said as one list with the feature after it
  const kwLast = anyOf?.length === 2 ? anyOf[1]! : undefined;
  if (!spellOut && kwLast !== undefined && Object.keys(anyOf![0]!).join() === 'types' && (anyOf![0]!.types?.length ?? 0) >= 1 && kwLast.types?.length === 1
    && Object.keys(kwLast).sort().join() === (kwLast.keyword !== undefined ? 'keyword,types' : 'notKeyword,types')) {
    const [a, b] = ps as [Parts, Parts];
    const extra = b.post.filter((x) => !a.post.includes(x));
    if (a.whole === undefined && b.whole === undefined && same(a.adj, b.adj) && a.suffix === b.suffix && extra.length === 1 && b.post.length === a.post.length + 1) {
      const list: Parts = { ...b, adj: b.adj.slice(), heads: [...a.heads, ...b.heads], post: b.post.slice() };
      // FAST5X batch 1 integration (E27 beside FAST5 T56): the same two descriptions are also spelled out, "an instant or sorcery card or a creature card with
      // flying" (Steamcore Scholar): the keyword is said with the last description only either way, the same set (CR 115.1, 608.2c). The list stays the display.
      let spelled: Parts | null = null;
      try {
        spelled = buildAnyOfPlain(f, st, plural, o, true);
      } catch (e) {
        if (!(e instanceof NoRenderer)) throw e;
      }
      if (spelled === null || spelled.whole === undefined || spelled.other || list.other) return list;
      return { ...spelled, whole: alt(compose(list, { det: o.det === 'a' ? 'a' : 'none' }, plural), spelled.whole) };
    }
    throw new NoRenderer('a keyword on the last of a list of card types beside other words');
  }
  // FAST5 T45 (CR 113.3b-c, 603.1): the two kinds of ability on the stack are "activated or triggered ability", the adjectives sharing one head noun
  const kinds = (anyOf ?? []).map((opt) => (Object.keys(opt).length === 1 ? opt.stackKind : undefined)).sort().join(',');
  if (kinds === 'activatedAbility,triggeredAbility' && ps.every((p) => same(p.adj, first.adj) && same(p.post, first.post) && p.suffix === first.suffix)) {
    merged.heads = ['activated or triggered ability'];
    return merged;
  }
  // FAST5 T75: "a Mount creature card or a Plains card" is not "a Mount or Plains creature card": the optional "creature" belongs to the heads that have it only
  // edh-zones-22 (CR 109.2; Sorin, Lord of Innistrad): "other" before one noun of the list only, "creatures and/or other planeswalkers": the options are spelled out (below), the shared heads would lose it
  if (ps.every((p) => same(p.adj, first.adj) && same(p.post, first.post) && p.suffix === first.suffix && p.creatureOptional === first.creatureOptional && (first.other === true || p.other !== true))) {
    // std-cardcopy-1 (family planeswalker-type, CR 205.3j): a card head with its type word after it keeps it in the list ("instant, sorcery, and/or Tamiyo
    // planeswalker cards"); the heads of cards are not pluralized (the suffix is)
    merged.heads = ps.flatMap((p) => (p.typeAfter !== undefined && p.suffix === 'card' && p.heads.length === 1 ? [`${p.heads[0]}${alt('', ` ${p.typeAfter}`)}`] : p.heads));
    if (ps.some((p) => p.typeAfter !== undefined && p.suffix === 'card')) delete merged.typeAfter; // only what this rewrote: a permanent keeps its own ("a Gideon planeswalker you control")
    // FAST5 T44: "a token or a land" says an article for each alternative (a token is not a card type, so Oracle does not share one); the one-article form stays
    merged.elementArticles = ps.some((p) => p.elementArticles) || ps.some((p) => p.heads.length === 1 && p.heads[0] === 'token');
    // edh-perms-9 (CR 205.4a; family supertype-before-each-type): "a legendary artifact or legendary creature" (Sauron, the Dark Lord's ward): one article, the supertype said for each type
    if (o.det === 'a' && !plural && ps.length > 1 && first.adj.length > 0 && first.suffix === '' && !first.other && ps.every((p) => p.whole === undefined && p.heads.length === 1 && same(p.adj, first.adj)
      && p.adj.every((a) => a === 'legendary'))) {
      const spelled = ps.map((p) => compose({ ...p, post: [] }, { det: 'none' }, plural)).join(' or ');
      const tailWords = first.post.length > 0 ? ` ${first.post.join(' ')}` : '';
      merged.whole = alt(`${compose(merged, { det: 'a' }, plural)}`, `${article(spelled)} ${spelled}${tailWords}`);
      merged.wholeHasDet = true;
    }
    // FAST5 T59: modifiers that every alternative has are also said for each ("target noncreature artifact or noncreature enchantment"); the shared form stays the display
    else if (ps.length > 1 && first.adj.length > 0 && first.suffix === '' && !first.other && ps.every((p) => p.whole === undefined && p.heads.length === 1) && TARGETING_DETS.has(o.det ?? 'none')) {
      // (what follows every alternative, "you control", is said once after the last one)
      const spelled = ps.map((p) => compose({ ...p, post: [] }, { det: 'none' }, plural));
      const shared = compose(merged, { det: 'none' }, plural);
      merged.whole = alt(shared, `${spelled.join(' or ')}${first.post.length > 0 ? ` ${first.post.join(' ')}` : ''}`);
    }
    // edh-d-17 (CR 205.2a, 608.2c; Roots of Wisdom): and one card of either kind after "a" ("return a land card or Elf card"): the noun said for each kind, one article for both
    else if (!plural && o.det === 'a' && ps.length === 2 && first.suffix === 'card' && !first.other && ps.every((p) => p.whole === undefined && p.heads.length === 1 && p.typeAfter === undefined)) {
      const spelled = ps.map((p) => compose({ ...p, post: [] }, { det: 'none' }, plural)).join(' or ');
      merged.whole = alt(compose(merged, { det: 'a' }, plural), `${article(spelled)} ${spelled}${first.post.length > 0 ? ` ${first.post.join(' ')}` : ''}`);
      merged.wholeHasDet = true;
    }
    // edh-next-132 (CR 111.1, 205.2a; family token-kinds-and-or, Battle for Bretagard): two plural kinds of tokens are also "artifact tokens and/or creature tokens you control" (the head said for
    // each kind, each token one of them: parser/holes/filter.ts#orPhrases); what follows both is said once after the last
    else if (plural && ps.length === 2 && first.suffix === 'token' && first.adj.length === 0 && !first.other && ps.every((p) => p.whole === undefined && p.heads.length === 1 && p.typeAfter === undefined)) {
      const spelled = ps.map((p) => compose({ ...p, post: [] }, { det: 'none' }, plural));
      merged.whole = alt(compose(merged, { det: 'none' }, plural), `${spelled.join(' and/or ')}${first.post.length > 0 ? ` ${first.post.join(' ')}` : ''}`);
      merged.wholeCounted = true;
    }
    // edh-zones-4 (CR 205.2a, 608.2c; family card-or-card-words): "target creature card or planeswalker card from your graveyard" (Haven of the Spirit Dragon): cards of either kind, the
    // noun said for each and what follows every alternative said once after the last one; the shared head ("creature or planeswalker card") stays the display
    else if (ps.length > 1 && first.suffix === 'card' && !first.other && ps.every((p) => p.whole === undefined && p.heads.length === 1 && p.typeAfter === undefined) && TARGETING_DETS.has(o.det ?? 'none')) {
      const spelled = ps.map((p) => compose({ ...p, post: [] }, { det: 'none' }, plural));
      merged.whole = alt(compose(merged, { det: 'none' }, plural), `${spelled.join(' or ')}${first.post.length > 0 ? ` ${first.post.join(' ')}` : ''}`);
    }
    return merged;
  }
  if (ps.every((p) => same(p.heads, first.heads) && same(p.post, first.post) && p.suffix === first.suffix)) {
    const listedPlain = joinList(ps.map((p) => p.adj.join(' ')), 'or');
    // edh-next-14 (CR 205.2a; family list-of-three-flat): "an instant, sorcery, or Wizard spell": an option that is itself "instant or sorcery" is three kinds of one list
    const flatItems = ps.every((p) => p.adj.length === 1 && !p.adj[0]!.includes(ALT_OPEN)) ? ps.flatMap((p) => p.adj[0]!.split(' or ')) : [];
    const listed = flatItems.length > 2 && flatItems.length > ps.length ? alt(listedPlain, joinList(flatItems, 'or')) : listedPlain;
    // edh-combat-3 (CR 700.4; family shared-adjectives-list): the words every option ends with are said once before the list, "a goaded attacking or blocking creature"
    // (Baeloth Barrityl): the fields beside `anyOf` hold for every option (design 3.3); the words said for each option stay the display
    let common = 0;
    while (ps.length > 1 && ps.every((p) => p.adj.length > common + 1 && p.adj[p.adj.length - 1 - common] === first.adj[first.adj.length - 1 - common])) common++;
    const shared = common > 0 ? `${first.adj.slice(first.adj.length - common).join(' ')} ${joinList(ps.map((p) => p.adj.slice(0, p.adj.length - common).join(' ')), 'or')}` : null;
    // FAST1 T4, CR 700.6: "historic" is the word for "artifact, legendary, or Saga" ("a historic spell"); only when nothing else is said of the options
    // edh-c-69 (CR 700.4; family attacking-or-blocking-color-first): "target attacking or blocking white creature" (Gideon's Defeat): the words that differ first, a color every option has after them
    const colorLast = common > 0 && ps.length === 2 && ps.every((p) => p.adj.length === common + 1) && first.adj.slice(first.adj.length - common).every((a) => Object.values(COLOR_WORD).includes(a))
      ? `${listedPlain.replace(new RegExp(` ${first.adj.slice(first.adj.length - common).join(' ')}( or |$)`, 'g'), '$1')} ${first.adj.slice(first.adj.length - common).join(' ')}` : null;
    // edh-next-134 (CR 701.15b, 701.60b; family goaded-and-or-suspected; Hot Pursuit): the two designations as options are also "goaded and/or suspected" (either one or both)
    const designations = ps.length === 2 && ps.every((p) => p.adj.length === 1) && [ps[0]!.adj[0], ps[1]!.adj[0]].sort().join() === 'goaded,suspected' ? alt(listed, `${ps[0]!.adj[0]} and/or ${ps[1]!.adj[0]}`) : null;
    merged.adj = [isHistoric(anyOf ?? []) && ps.every((p) => p.adj.length === 1) ? alt(listed, 'historic') : designations !== null ? designations : shared !== null ? alt(listed, shared, ...(colorLast === null ? [] : [colorLast])) : listed];
    // edh-c-69 (CR 506.4, 509.1; Gideon's Defeat): "target white creature that's attacking or blocking": the same two options said after the noun (family attacking-or-blocking-color-first)
    if (ps.length === 2 && ps[0]!.adj[0] === 'attacking' && ps[1]!.adj[0] === 'blocking' && ps.every((p) => p.adj.length === first.adj.length && same(p.adj.slice(1), first.adj.slice(1)) && p.post.length === 0 && p.whole === undefined && p.heads.length === 1 && p.typeAfter === undefined && p.suffix === '' && p.other !== true)
      && TARGETING_DETS.has(o.det ?? 'none') && merged.whole === undefined) {
      const direct = compose(merged, { det: 'none' }, plural);
      const relBase = compose({ ...merged, adj: first.adj.slice(1) }, { det: 'none' }, plural);
      merged.whole = alt(direct, `${relBase} ${plural ? 'that are' : "that's"} attacking or blocking`);
    }
    // edh-c-43 (CR 105.2, 205.2; family two-groups-and, Masked Gorgon): "Green creatures and white creatures": two plural groups of one noun that differ in one adjective are also said
    // group by group, joined with "and" (each object of either group); the shared head with "or" stays the display (a plain subject, no determiner: the two groups say it themselves)
    if (plural && ps.length === 2 && o.det === 'none' && ps[0]!.adj[0] !== ps[1]!.adj[0] && ps.every((p) => p.adj.length === 1 && p.heads.length === 1 && p.whole === undefined && p.post.length === 0 && p.suffix === '' && !p.other && p.typeAfter === undefined)) {
      const groups = ps.map((p) => compose(p, { det: 'none' }, plural));
      const both = compose({ ...merged }, { det: 'none' }, plural);
      merged.whole = alt(both, `${groups[0]} and ${groups[1]}`);
      merged.wholeHasDet = true;
    }
    return merged;
  }
  // different heads with different adjectives: spell each alternative out
  const spelled = ps.map((p) => compose(p, { det: 'none' }, plural));
  // FAST3 T17: several cards of either description also read "basic land cards and/or Desert cards" (a set may mix them; each card is one of them)
  // std-rj (CR 205.4a, 205.2a; Nashi): "legendary and/or enchantment cards": the supertype and the card type share the head word, the cards that are either
  const legendaryOr = plural && spelled.length === 2 && spelled[0] === 'legendary cards' && /^[a-z]+ cards$/.test(spelled[1]!) ? [`legendary and/or ${spelled[1]!}`, `legendary or ${spelled[1]!}`] : [];
  // edh-next-93 (CR 205.2a, 205.4a; family cards-shared-head, Kamahl's Druidic Vow): "land and/or legendary permanent cards": a bare card type and a legendary description of cards,
  // the head word "cards" said once after the second (each card is one of the two descriptions, as in "land cards and/or legendary permanent cards")
  const sharedCards = plural && spelled.length === 2 && /^[a-z]+ cards$/.test(spelled[0]!) && /^legendary [a-z ]+ cards$/.test(spelled[1]!)
    ? [`${spelled[0]!.slice(0, -' cards'.length)} and/or ${spelled[1]!}`, `${spelled[0]!.slice(0, -' cards'.length)} or ${spelled[1]!}`] : [];
  merged.whole = plural && spelled.length > 1 ? alt(spelled.join(' or '), andOr(spelled), ...legendaryOr, ...sharedCards) : spelled.length > 2 ? alt(joinList(spelled, 'or'), spelled.join(' or ')) : spelled.join(' or '); // FAST5 T64: "artifact, non-Aura enchantment, or land"
  // std-lci (parser/holes/filter.ts#listPhrases, CR 205.2a): a list of three or more also reads with commas when plural, "all artifacts, enchantments, and nonbasic
  // lands" (each object of any of the kinds); and what follows every alternative, "you control", is said once after the last one ("target creature, Vehicle,
  // or nonbasic land you control": the parser distributes who controls or owns them over the whole list, design 6.3)
  if (spelled.length > 2) {
    const readings: string[] = plural ? [joinList(spelled, 'or'), joinList(spelled, 'and')] : [];
    if (first.post.length > 0 && ps.every((p) => p.whole === undefined && same(p.post, first.post))) {
      const bare = ps.map((p) => compose({ ...p, post: [] }, { det: 'none' }, plural));
      const tail = ` ${first.post.join(' ')}`;
      readings.push(`${joinList(bare, 'or')}${tail}`);
      if (plural) readings.push(`${joinList(bare, 'and')}${tail}`, `${andOr(bare)}${tail}`);
    }
    if (readings.length > 0) merged.whole = alt(merged.whole, ...readings);
  }
  // edh-zones-4 (CR 608.2c; family card-or-card-words): two cards of different descriptions in one zone, "target Dragon creature card or Ugin planeswalker card from your graveyard"
  // (Haven of the Spirit Dragon): what follows both is said once after the second
  else if (spelled.length === 2 && first.post.length > 0 && first.suffix === 'card' && ps.every((p) => p.whole === undefined && same(p.post, first.post))) {
    const bare = ps.map((p) => compose({ ...p, post: [] }, { det: 'none' }, plural));
    // edh-next-93 (family cards-shared-head): "land and/or legendary permanent cards with mana value X or less"
    const tailText = first.post.join(' ');
    const shared = plural && /^[a-z]+ cards$/.test(bare[0]!) && /^legendary [a-z ]+ cards$/.test(bare[1]!)
      ? [`${bare[0]!.slice(0, -' cards'.length)} and/or ${bare[1]!} ${tailText}`, `${bare[0]!.slice(0, -' cards'.length)} or ${bare[1]!} ${tailText}`] : [];
    merged.whole = alt(merged.whole, `${bare.join(' or ')} ${tailText}`, ...shared);
  }
  // edh-next-17 (CR 205.2a, 303.4; family creature-or-creature-words, Kestia): two creatures of different descriptions of one player, "an enchanted creature or enchantment creature you control":
  // the article before the first and what follows both said once after the second (each description spelled out keeps its article, "an enchanted creature you control or an enchantment creature you control")
  else if (spelled.length === 2 && !plural && o.det === 'a' && first.post.length > 0 && first.suffix === '' && ps.every((p) => p.whole === undefined && !p.other && p.heads.length === 1 && same(p.post, first.post))) {
    const bare = ps.map((p) => compose({ ...p, post: [] }, { det: 'none' }, plural)).join(' or ');
    merged.whole = alt(ps.map((p) => compose(p, { det: 'a' }, plural)).join(' or '), `${article(bare)} ${bare} ${first.post.join(' ')}`);
    merged.wholeHasDet = true;
  }
  // cmd1 (CR 700.6; family historic): "each historic card in your hand": the three kinds of cards said by their one word (a card head, "historic card")
  // std-rk (same family): and of permanents, "the number of historic permanents you control" (Alistair, the Brigadier), "affinity for historic permanents"
  if (isHistoric(anyOf ?? []) && ps.every((p) => p.whole === undefined)) {
    const permanents = rest.isCard === undefined && rest.stackKind === undefined && rest.zone === undefined ? [rest] : [];
    const hs = [{ ...rest, isCard: rest.isCard ?? true }, ...permanents].map((g) => build(g, st, plural, o)).filter((h) => h.whole === undefined);
    // TREK-6 (CR 700.6): one permanent after "a" is "a historic permanent you control" / "another historic permanent you control" (Jean-Luc Picard, Luminary), the article or
    // "another" said before the word, as the spelled-out options take theirs (above); the plural and every other determiner keep the form without
    // edh-c-76 (CR 700.6, 115.3; Guardians of Koilos): and "another target historic permanent you control", the "another target" of a target with `other` said before the word
    const lead = !plural && o.det === 'a' ? 'a' : !plural && o.det === 'target' && rest.other === true && o.count === undefined ? 'target' : 'none';
    // pc-zones-1 (CR 700.6): "target nonland historic permanent" (Lost to Legend): a lone negation comes before the word "historic", as it comes before any other adjective // edh-players-14: and a lone "nontoken" (Arbaaz Mir)
    if (hs.length > 0) merged.whole = alt(merged.whole, ...hs.map((h) => compose({ ...h, adj: (h.negs.length > 0 || h.adj[0] === 'nontoken') && h.adj.length === 1 ? [...h.adj, 'historic'] : ['historic', ...h.adj] }, { det: lead }, plural)));
  }
  merged.wholeCounted = true;
  // cloud std-spm (CR 205.2a, 205.4a): one object of either description after "each" also reads with "and", the halves spelled out and what they share said once
  // ("each Spider and legendary creature you control", Ultimate Spider-Man: each permanent you control that is a Spider or a legendary creature)
  if (!plural && o.det === 'each' && spelled.length > 1 && ps.every((p) => !p.other && p.whole === undefined && p.suffix === first.suffix && same(p.post, first.post))) {
    const bare = ps.map((p) => compose({ ...p, post: [] }, { det: 'none' }, false));
    merged.whole = alt(merged.whole, `${joinList(bare, 'and')}${first.post.length > 0 ? ` ${first.post.join(' ')}` : ''}`);
  }
  // edh-players-3 (CR 205.2a, 205.4a, 614.1c): the plural of the same coordination, "creatures and nonbasic lands your opponents control enter tapped" (Thalia, Heretic
  // Cathar): the objects that are either description, with no determiner; the halves are spelled out and what they share said once
  if (plural && (o.det === undefined || o.det === 'none') && o.count === undefined && spelled.length === 2 && ps.every((p) => !p.other && p.whole === undefined && p.suffix === first.suffix && same(p.post, first.post))) {
    const bare = ps.map((p) => compose({ ...p, post: [] }, { det: 'none' }, true));
    merged.whole = alt(merged.whole, `${joinList(bare, 'and')}${first.post.length > 0 ? ` ${first.post.join(' ')}` : ''}`);
  }
  // FAST4 T31: one card of either description after "a" says an article for each ("a basic Plains card or a creature card with mana value 1 or less"),
  // or one article and the shared head word once when only that word is shared ("a Bird or basic land card"); a search for one card (CR 701.23a)
  if (!plural && o.det === 'a' && !first.other && spelled.length > 1) {
    const readings = [spelled.map(withArticle).join(' or ')];
    const plainParts = ps.every((p) => !p.other && !p.creatureOptional && p.headChoice === undefined && p.typeAfter === undefined && p.negs.length === 0);
    if (plainParts && first.suffix !== '' && ps.every((p) => p.suffix === first.suffix && same(p.post, first.post))) {
      const bare = ps.map((p) => compose({ ...p, suffix: '', post: [] }, { det: 'none' }, false)).join(' or ');
      readings.push(`${withArticle(bare)} ${first.suffix}${first.post.length > 0 ? ` ${first.post.join(' ')}` : ''}`);
      // std-lci (CR 701.23a): ... or one article for the whole list, each description with its head word ("a basic land card or Cave card", Compass Gnome,
      // Open the Gates): the same one card of either description
      if (first.post.length === 0) readings.push(withArticle(spelled.join(' or ')));
    }
    // trek-9 (CR 202.3, 205.3i; family card-or-card-last-qualifier): "a Plains card or nonland permanent card with mana value 3 or less" (There's Coffee in that Nebula; Oracle
    // prints Airlift Chaplain and Starfield Shepherd with an article for each): one article for the whole list, and the words after the LAST description said once after it.
    // Those words are the last description's own: English does not say whether they are the first's too, so this wording is written only when it cannot matter: the
    // descriptions before the last are lands with no words of their own, and the only words after the last one are a mana value limit every land meets ("N or less",
    // "less than N": a land's mana value is 0; landsMeetMvLimit), so reading the limit as theirs too gives the same cards. Any other list keeps one article for each description
    else if (first.suffix !== '' && ps.every((p) => !p.other && !p.creatureOptional && p.headChoice === undefined && p.typeAfter === undefined && p.suffix === first.suffix)
      && ps.slice(0, -1).every((p) => p.post.length === 0) && ps[ps.length - 1]!.post.length === 1 && (anyOf ?? []).slice(0, -1).every(isLandDescription)
      && (anyOf ?? []).length === ps.length && landsMeetMvLimit((anyOf ?? [])[ps.length - 1]!)) {
      readings.push(withArticle(spelled.join(' or ')));
    }
    merged.whole = alt(merged.whole, ...readings);
  }
  return merged;
}

/** Head words in the plural or singular, with their suffix. */
function headText(p: Parts, plural: boolean, target = false): string {
  if (p.headChoice) {
    const options = p.headChoice.map((c) => (plural ? pluralize(c) : c));
    // the card's types are unknown: the display is neutral ("attached creature"), the gate takes any of the real words
    return p.headChoice.length > 1 && p.headChoice[0]!.startsWith('enchanted') && p.headChoice.includes('equipped creature') ? displayFirst(plural ? 'attached creatures' : 'attached creature', ...options) : alt(...options);
  }
  // edh-perms-5 (CR 205.3m; Silver-Fur Master): several creature types before the plural noun are also joined with "and" ("Other Ninja and Rogue creatures you control": each creature has one of them)
  // trek-19 (CR 205.3m; Kirk, Man of Action): the plural of each creature type is also said, "Officers, Artificers, and Spacecraft creatures you control" (family creature-type-plurals-list)
  if (p.creatureOptional && p.suffix === '' && plural && p.heads.length > 1) {
    return alt(`${joinHeads(p.heads, plural)} creatures`, `${joinList(p.heads.map((h) => pluralize(h)), 'and')} creatures`);
  }
  if (p.creatureOptional && p.suffix === '') return `${joinHeads(p.heads, plural)} ${plural ? 'creatures' : 'creature'}`;
  // FAST3 T17: a card with a creature type AND the type creature is "an Ally creature card" (CR 205.3m: a kindred card has creature types too, so "an Ally
  // card" is a larger set); the subtype alone stays "an Ally card"
  // trek-15 (family subtype-card-set-and; The Promise of Kahless): a set of creature cards of several creature types is also "Klingon and Warrior creature cards" (never a target)
  if (p.creatureOptional && p.suffix === 'card') return `${joinHeads(p.heads, plural && !target)} ${plural ? 'creature cards' : 'creature card'}`;
  // FAST3 T12: "a Garruk planeswalker" (the subtype is singular here, the type word takes the plural)
  if (p.typeAfter !== undefined && p.suffix === '' && p.heads.length === 1) return plural ? alt(pluralize(p.heads[0]!), `${p.heads[0]} ${pluralize(p.typeAfter)}`) : `${p.heads[0]}${alt('', ` ${p.typeAfter}`)}`;
  // std-cardcopy-1 (same family, CR 205.3j): ... and of cards, "target Tamiyo planeswalker cards from your graveyard" (the type word before "card", singular)
  if (p.typeAfter !== undefined && p.suffix === 'card' && p.heads.length === 1) return `${p.heads[0]}${alt('', ` ${p.typeAfter}`)} ${plural ? 'cards' : 'card'}`;
  const elems = p.heads.map((h) => (plural && p.suffix === '' ? pluralize(h) : h));
  // FAST3 T12: a set of cards of several types also reads "instant and sorcery cards" (the set is the same, as for spells above; family type-list); not for
  // targets: "two target instant and sorcery cards" is not how Oracle names targets of either type (FAST3 T14, family and-or-types: "and/or" or "or")
  const joined = plural && (p.suffix === '' || (p.suffix === 'card' && !p.elementArticles && !target));
  const base = joinHeads(elems, joined);
  // FAST3 T14: several cards of either type also read "instant and/or sorcery cards" (a set may mix them; each one is of one of the types)
  // r3-fx (family subtype-card-set-and): a set of cards of several subtypes also reads with "and", "all Mount and Vehicle cards" (each card is one of them), as a
  // set of cards of several card types does above; never for a target
  if (p.suffix !== '' && plural && elems.length > 1 && !joined) return `${alt(base, andOr(elems), ...(p.suffix === 'card' && !target ? [joinList(elems, 'and')] : []))} ${pluralize(p.suffix)}`;
  // r4-dig (family and-or-types): ... and when the list is joined ("creature and land cards"), "up to two creature and/or land cards" too (never for a target)
  if (p.suffix === 'card' && plural && elems.length > 1 && joined && !target) return `${alt(base, andOr(elems))} ${pluralize(p.suffix)}`;
  // edh-next-7 (CR 111.1, 205.3m; family token-creature-word; Pest Rescuer): "a Pest creature token" is also "a Pest token" (the creature type already says creature)
  if (p.tokenCreatureWord === true && p.suffix === 'token' && elems.length === 1) return `${alt(base, `${base} creature`)} ${plural ? pluralize(p.suffix) : p.suffix}`;
  if (p.suffix !== '') return `${base} ${plural ? pluralize(p.suffix) : p.suffix}`;
  // FAST4 T27 (family and-or-one): one object of either of two kinds also reads "another Villain and/or artifact you control" (an inclusive "or": the object
  // may be both); never for a target, which Oracle names with "or"
  if (!plural && !target && elems.length === 2) return alt(base, andOr(elems));
  return base;
}

/** FAST3 T14: "instant and/or sorcery", "artifact, creature, and/or enchantment". */
function andOr(elems: string[]): string {
  return elems.length === 2 ? `${elems[0]} and/or ${elems[1]}` : `${elems.slice(0, -1).join(', ')}, and/or ${elems[elems.length - 1]}`;
}

/** "artifact, creature, or enchantment"; a set of them also reads "artifacts, creatures, and enchantments" (Oxford comma both ways). */
function joinHeads(elems: string[], plural = false): string {
  if (elems.length <= 1) return elems[0] ?? '';
  // FAST3 T14: ... and "creatures and/or planeswalkers" (a set that may mix them)
  return plural ? alt(joinList(elems, 'or'), joinList(elems, 'and'), andOr(elems)) : joinList(elems, 'or');
}

function compose(p: Parts, o: NpOpts, plural: boolean): string {
  // edh-c-55 (CR 303.4b; Necromancer's Magemark): one creature an Aura is attached to is "an enchanted creature you control" or "a creature you control that's enchanted"
  // (the plural pair is edh-c-20's enchantedPost)
  if (!plural && p.whole === undefined && p.notSubs === undefined && p.adj.length === 1 && p.adj[0] === 'enchanted' && p.post.length > 0 && p.thatsEnchanted !== false) {
    return alt(compose({ ...p, thatsEnchanted: false }, o, plural), compose({ ...p, adj: [], post: [...p.post, "that's enchanted"], thatsEnchanted: false }, o, plural));
  }
  // edh-next-8 (CR 301.5; Hexgold Hoverwings): plural creatures an Equipment is attached to are "equipped creatures you control" or "creatures you control that are equipped"
  if (p.equippedPost === true && p.whole === undefined && p.notSubs === undefined && p.adj.includes('equipped') && p.adj.length === 1 && p.post.length > 0) {
    const { equippedPost: _e, ...rest } = p;
    return alt(compose(rest, o, plural), compose({ ...rest, adj: [], post: [...p.post, 'that are equipped'] }, o, plural));
  }
  // edh-c-20 (CR 303.4b; Infiltrator's Magemark): plural creatures an Aura is attached to are "enchanted creatures you control" or "creatures you control that are enchanted"
  if (p.enchantedPost === true && p.whole === undefined && p.notSubs === undefined && p.adj.includes('enchanted') && p.adj.length === 1 && p.post.length > 0) {
    const { enchantedPost: _e, ...rest } = p;
    return alt(compose(rest, o, plural), compose({ ...rest, adj: [], post: [...p.post, 'that are enchanted'] }, o, plural));
  }
  if (p.otherThanKind !== undefined) {
    const { otherThanKind: ot, ...rest } = p;
    const zoneAt = rest.post.findIndex((x) => /\b(graveyards?|librar(y|ies)|hands?|exile)\b/.test(x));
    const at = rest.post.indexOf(ot.isnt);
    if (zoneAt >= 0 && at >= 0 && at < zoneAt && rest.post.length === 2) return alt(compose(rest, o, plural), compose({ ...rest, post: [rest.post[zoneAt]!, `other than ${ot.kind}`] }, o, plural));
    return compose(rest, o, plural);
  }
  if (p.notSubs !== undefined) {
    const list = p.notSubs;
    const { notSubs: _n, ...rest } = p;
    // edh-perms-7: the two wordings of the same description (family not-subtypes-that-isnt)
    const oldAdj = negationList(list.map((t) => `non-${t}`));
    // edh-cast-8 (Heliod, the Radiant Dawn): "enchantment card that isn't a God from your graveyard": the kinds come before the zone phrase of a card
    const isnt = `that isn't ${withArticle(list[0]!).split(' ')[0]} ${joinList(list, 'or')}`;
    const zoneAt = p.post.findIndex((x) => /\b(graveyards?|librar(y|ies)|hands?|exile)\b/.test(x));
    const post = zoneAt < 0 ? [...p.post, isnt] : [...p.post.slice(0, zoneAt), isnt, ...p.post.slice(zoneAt)];
    return alt(compose(rest, o, plural), compose({ ...rest, adj: p.adj.filter((x) => x !== oldAdj), post }, o, plural));
  }
  if (p.whole !== undefined) {
    if (p.wholeHasDet === true) return p.whole; // std-re
    // FAST5 T59: the determiner of a description spelled out by alternatives is said once, before the first of them ("destroy target land creature or nonbasic land",
    // "destroy all noncreature artifacts or noncreature enchantments"); not for "a", which names each alternative with its own article (buildAnyOfPlain)
    if (!p.other && (o.det === 'target' || o.det === 'all' || o.det === 'each' || o.det === 'any' || o.det === 'the')) {
      return o.count !== undefined && o.det === 'target' ? `${o.count} target ${p.whole}` : `${o.det} ${p.whole}`;
    }
    return p.wholeCounted === true && o.count !== undefined && (o.det === 'none' || o.det === undefined) ? `${o.count} ${p.whole}` : p.whole;
  }
  const adj = p.adj.join(' ');
  const listed = headText(p, plural, o.det === 'target');
  // FAST4 T22 (family for-each-type-list): after "for each" a list of types also reads with "and", the set it counts ("for each Aura and Equipment attached to it")
  // FAST4 T24 (same family): of cards too, "for each instant and sorcery card in your graveyard" (each card that is an instant or a sorcery, once)
  const cardList = p.suffix === 'card' && !p.elementArticles;
  const body = !plural && (o.forEach === true || o.det === 'each') && (p.suffix === '' || cardList) && p.headChoice === undefined && !p.creatureOptional && p.typeAfter === undefined && p.heads.length > 1
    // FAST5 T42: and after "each" ("return each artifact and creature card ...", Fix What's Broken: each card that is an artifact or a creature)
    // FAST4 T29: "and/or" too; FAST4 T28 (same family): ... and with "and/or", "for each other creature and/or artifact you control" (each object of either type, counted once)
    ? alt(listed, `${joinList(p.heads, 'and')}${cardList ? ' card' : ''}`, `${andOr(p.heads)}${cardList ? ' card' : ''}`) : listed;
  const core0 = [adj, body].filter((x) => x !== '').join(' ');
  // edh-perms-9 (CR 205.2a; family except-for-kinds): the negated kinds said out after the plain noun
  const core = p.exceptList !== undefined && p.suffix === '' && p.headChoice === undefined && !p.creatureOptional && p.typeAfter === undefined && p.post.length === 0 && body === listed
    ? alt(core0, `${listed} except for ${p.exceptList}`, `${listed} other than ${p.exceptList}`) : core0; // edh-replace-6: Moonmist prints "creatures other than Werewolves and Wolves"
  const tail = p.post.length > 0 ? ` ${(p.teamAt !== undefined && p.post[p.teamAt] === 'you control' ? p.post.map((x, i) => (i === p.teamAt ? alt('you control', 'your team controls') : x)) : p.post).join(' ')}` : '';
  const det = p.bare && (o.det === 'a' || o.det === 'the' || o.det === 'none' || o.det === undefined) ? 'none' : (o.det ?? 'none');
  const count = o.count;
  const other = p.other;
  let lead = '';
  if (count !== undefined) lead = other ? `${count} other${det === 'target' ? ' target' : ''}` : `${count}${det === 'target' ? ' target' : ''}`;
  else {
    switch (det) {
      case 'target': lead = other ? (o.third === true ? alt('another target', 'a third target') : 'another target') : 'target'; break; // edh-c-6 (family third-target)
      case 'a': lead = other ? 'another' : plural ? '' : article(adj !== '' ? adj : body); break;
      case 'the': lead = other ? 'the other' : 'the'; break;
      case 'all': lead = other ? 'all other' : 'all'; break;
      case 'each': lead = other ? 'each other' : 'each'; break;
      case 'any': lead = other ? 'any other' : 'any'; break;
      case 'none': lead = other ? 'other' : ''; break;
    }
  }
  let phrase: string;
  if (det === 'a' && !plural && !other && count === undefined && p.elementArticles && p.heads.length > 1 && p.suffix === '') {
    const bare = p.heads.map((h, i) => (i === 0 && adj !== '' ? `${adj} ${h}` : h));
    const elems = bare.map(withArticle);
    // FAST4 T27 (family one-article-subtypes): "a Mount or a Vehicle you control" is also printed with one article, "a Mount or Vehicle you control"
    phrase = `${alt(joinHeads(elems), `${withArticle(bare[0]!)}${joinHeads(bare).slice(bare[0]!.length)}`)}${p.suffix ? ` ${p.suffix}` : ''}`;
    return `${phrase}${tail}`;
  }
  phrase = [lead, core].filter((x) => x !== '').join(' ');
  // FAST5 T42 (CR 109.2, 115.3): "up to one target nonland permanent other than ~" says the same as "up to one other target nonland permanent" (Council of
  // Echoes): other than the object the ability is on; only with nothing said after the description
  // FAST5 T61 (CR 109.2, 608.2h): "put a +1/+1 counter on it for each Mount and/or Vehicle you control other than ~" says the same as "for each other Mount or Vehicle
  // you control": a count of the things of a description besides the object the ability is on (parser/holes/filter.ts, "other than ~")
  // edh-perms-1 (CR 109.2; Rosie Cotton of South Lane): also after a controller phrase, "put a +1/+1 counter on target creature you control other than ~" says the same as
  // "... on another target creature you control"
  const besideTarget = other && det === 'target' && (p.post.length === 0 || p.post.every((x) => /\b(you|an opponent|a player|they) controls?$/.test(x)));
  // edh-players-7 (CR 109.2, 608.2h; Massacre Girl): and of a group after "each" / "all", "each creature other than ~ gets -1/-1" says the same as "each other creature gets -1/-1"
  const groupOther = other && (det === 'each' || det === 'all') && o.forEach !== true && count === undefined;
  // edh-perms-11 (CR 109.2, 608.2h; Thundering Raiju): and a group counted without a determiner, "the number of modified creatures you control other than ~" says the same as
  // "the number of other modified creatures you control"
  const countedOther = other && plural && det === 'none' && o.forEach !== true && count === undefined;
  // edh-b-6 (CR 109.2, 608.2h; Demonic Taskmaster): one object after "a", "sacrifice a creature other than this creature" says the same as "sacrifice another creature"
  const aOther = other && det === 'a' && !plural && count === undefined && p.elementArticles !== true && !/\bnamed\b/.test(core + tail);
  if (aOther) return alt(`${phrase}${tail}`, `${article(adj !== '' ? adj : body)} ${core}${tail} other than ~`);
  if (besideTarget || groupOther || countedOther || (other && o.forEach === true && det === 'none' && count === undefined)) {
    const plain = besideTarget ? [count !== undefined ? `${count} target` : 'target', core].filter((x) => x !== '').join(' ') : groupOther ? `${det} ${core}` : core;
    return alt(`${phrase}${tail}`, `${plain}${tail} other than ~`);
  }
  return `${phrase}${tail}`;
}

/**
 * FAST5 T64 (CR 115.1, 400.1): a description of objects on the battlefield and of cards in graveyards, `zone: ['battlefield', 'graveyard']` with nothing about their
 * controllers or owners: the filter of "up to one target creature on the battlefield or creature card in a graveyard" (Taskmaster). The two halves, or null.
 */
function battlefieldOrGraveyard(f: ObjectFilter): [ObjectFilter, ObjectFilter] | null {
  if (!Array.isArray(f.zone) || f.zone.length !== 2 || !f.zone.includes('battlefield') || !f.zone.includes('graveyard')) return null;
  if (f.controller !== undefined || f.owner !== undefined || f.anyOf !== undefined) return null;
  return [{ ...f, zone: 'battlefield' }, { ...f, zone: 'graveyard' }];
}

/** The noun phrase for a filter. */
export function np(f: ObjectFilter, st: RenderState, o: NpOpts = {}): string {
  // std-rx32 (CR 205.3m): "a Spider Hero card": both subtypes, said together where one subtype would be
  if (f.allSubtypes !== undefined) {
    if (f.subtypes !== undefined || f.allSubtypes.length !== 2) throw new NoRenderer('several subtypes together beside another subtype');
    const { allSubtypes, ...rest } = f;
    return np({ ...rest, subtypes: [allSubtypes.join(' ')] }, st, o);
  }
  const pair = battlefieldOrGraveyard(f);
  if (pair !== null) {
    if (o.plural === true || o.det !== 'target') throw new NoRenderer('a description of permanents and graveyard cards outside a single target phrase');
    const half = (g: ObjectFilter): string => compose(build(g, st, false, { ...o, det: 'none', count: undefined }), { det: 'none' }, false);
    return `${o.count !== undefined ? `${o.count} ` : ''}target ${half(pair[0])} on the battlefield or ${half(pair[1])}`;
  }
  const plural = o.plural === true || o.det === 'all';
  // p2-modal-1 (CR 702.62b): "each suspended card": a card in exile with suspend and a time counter on it, one word for the three facts (parser/holes/filter.ts)
  if (isSuspendedCard(f)) {
    const q = build({ isCard: true, zone: 'exile' }, st, plural, o);
    q.post = q.post.filter((x) => x !== 'in exile');
    if (q.whole !== undefined || q.adj.length > 0 || q.post.length > 0) throw new NoRenderer(`a suspended card beside other words`);
    q.adj.push('suspended');
    return compose(q, o, plural);
  }
  // edhd68 (CR 702.62b, 108.3; Rose Tyler, Rift Elemental, Amy Pond): "suspended card you own": the same word with the owner said after it
  if (f.owner !== undefined && f.owner !== 'any' && isSuspendedCard({ ...f, owner: undefined })) {
    const q = build({ isCard: true, zone: 'exile' }, st, plural, o);
    q.post = q.post.filter((x) => x !== 'in exile');
    const who = build({ isCard: true, owner: f.owner }, cloneState(st), plural, o).post; // "you own": the owner said as after any card noun
    if (q.whole !== undefined || q.adj.length > 0 || q.post.length > 0 || who.length !== 1 || !/^(you|an opponent|that player|target player) owns?$/.test(who[0]!)) throw new NoRenderer('a suspended card with its owner beside other words');
    q.post.push(who[0]!);
    q.adj.push('suspended');
    return compose(q, o, plural);
  }
  const p = build(f, st, plural, o);
  let text = compose(p, o, plural);
  // FAST5 T57 (CR 105.2): "target creature or planeswalker that's green or blue" says the same as "target green or blue creature or planeswalker" (colors only,
  // beside nothing else that is about colors; parser/holes/filter.ts#postModAt reads exactly this)
  if (f.colors !== undefined && f.colors.length > 0 && p.whole === undefined && f.anyOf === undefined && f.colorless === undefined && f.multicolored === undefined && f.monocolored === undefined) {
    const q = build({ ...f, colors: undefined }, st, plural, o);
    if (q.whole === undefined) {
      const cs = f.colors.map((c) => COLOR_WORD[c] ?? c);
      const that = `${plural ? 'that are' : "that's"} ${cs.length > 1 && plural ? alt(joinList(cs, 'or'), joinList(cs, 'and/or')) /* edh-c-27 (family colors-and-or; Glistening Deluge) */ : joinList(cs, 'or')}`;
      // edh-c-45 (Sanctifier en-Vec; family colors-that-are-before-zone): the colors come before the zone phrase, "exile all cards that are black or red from all graveyards"
      const zoneAt = q.post.findIndex((x) => /\b(graveyards?|librar(y|ies)|hands?|exile)\b/.test(x));
      const before = zoneAt < 0 ? null : { ...q, post: [...q.post.slice(0, zoneAt), that, ...q.post.slice(zoneAt)] };
      q.post.push(that);
      text = before === null ? alt(text, compose(q, o, plural)) : alt(text, compose(q, o, plural), compose(before, o, plural));
    }
  }
  // Cloud C3 (CR 205.3m): "creatures you control that are Wolves or Werewolves" says the same as "Wolf or Werewolf creatures you control" (one card type, and
  // two or more alternatives that are one subtype each; plural only, as Oracle prints it; parser/holes/filter.ts reads exactly this)
  const kinds = f.anyOf?.map((x) => (Object.keys(x).length === 1 && x.subtypes?.length === 1 ? x.subtypes[0]! : null));
  if (plural && kinds !== undefined && kinds.length >= 2 && kinds.every((k) => k !== null) && f.types?.length === 1 && p.whole === undefined) {
    const q = build({ ...f, anyOf: undefined }, st, plural, o);
    if (q.whole === undefined) {
      q.post.push(`that are ${joinList(kinds.map((k) => pluralize(k!)), 'or')}`);
      text = alt(text, compose(q, o, plural));
    }
  }
  // edh-zones-3 (CR 205.4a, 700.6; family not-legendary-after): "all nonland, nonlegendary permanents" is also "all nonland permanents that aren't legendary" (Urza's Ruinous
  // Blast), and the three negations that make "not historic" (no artifact, no legendary, no Saga) are "each nonland permanent that's not historic" (Desynchronization)
  if (p.whole === undefined && f.anyOf === undefined && f.notSupertypes?.includes('Legendary') === true) {
    const hist = f.notTypes?.includes('Artifact') === true && f.notSubtypes?.includes('Saga') === true;
    const drop = <T,>(xs: T[] | undefined, x: T): T[] | undefined => { const r = (xs ?? []).filter((y) => y !== x); return r.length > 0 ? r : undefined; };
    const q = build({ ...f, notSupertypes: drop(f.notSupertypes, 'Legendary'), ...(hist ? { notTypes: drop(f.notTypes, 'Artifact'), notSubtypes: drop(f.notSubtypes, 'Saga') } : {}) }, st, plural, o);
    if (q.whole === undefined) {
      const word = hist ? 'historic' : 'legendary';
      q.post.push(plural ? alt(`that aren't ${word}`, `that are not ${word}`) : alt(`that isn't ${word}`, `that is not ${word}`));
      text = alt(text, compose(q, o, plural));
    }
  }
  // edh-zones-12 (CR 205.2a; family card-thats-types; parser/holes/filter.ts#thatsCardTypes): "target instant or sorcery card from your graveyard" is also "target card
  // that's an instant or sorcery from your graveyard" (Mizzix's Mastery): the card types after "that's", for a card noun with two or more of them, singular
  if (!plural && f.isCard === true && f.types !== undefined && f.types.length >= 2 && f.anyOf === undefined && p.whole === undefined) {
    const q = build({ ...f, types: undefined }, st, plural, o);
    if (q.whole === undefined) {
      q.post.unshift(`that's ${withArticle(joinList(f.types.map((t) => t.toLowerCase()), 'or'))}`);
      text = alt(text, compose(q, o, plural));
    }
  }
  // edh-next-26 (CR 205.2a, 110.4; family permanent-thats-types; Bounty Agent): "target legendary artifact, creature, or enchantment" is also "target legendary permanent
  // that's an artifact, creature, or enchantment": three or more permanent types said after "permanent that's", singular only
  if (!plural && f.isCard !== true && f.types !== undefined && f.types.length >= 3 && f.anyOf === undefined && p.whole === undefined) {
    const q = build({ ...f, types: undefined }, st, plural, o);
    if (q.whole === undefined && !q.other) {
      q.post.unshift(`that's ${withArticle(joinList(f.types.map((t) => t.toLowerCase()), 'or'))}`);
      text = alt(text, compose(q, o, plural));
    }
  }
  // CLOUD std-misc (CR 105.2): a colored object is also "a spell that's one or more colors" (Ancient Cornucopia), beside nothing else that is about colors
  if (f.colorless === false && p.whole === undefined && f.colors === undefined && f.anyOf === undefined && f.multicolored === undefined && f.monocolored === undefined) {
    const q = build({ ...f, colorless: undefined }, st, plural, o);
    if (q.whole === undefined) {
      q.post.push(`${plural ? 'that are' : "that's"} one or more colors`);
      text = alt(text, compose(q, o, plural));
    }
  }
  // FAST5 T59 + T62 (CR 603.4, 115.3): not the object the trigger event is about is "other Forests" (T62) and also "target creature you control other than that
  // creature" (T59): the same set, the event's object named or not
  if (isNotEventSubject(f.not) && f.other !== true && f.self !== false) {
    const q = build({ ...f, not: undefined }, st, plural, o);
    if (q.whole === undefined && !q.other) {
      q.post.push(`other than ${K.obj(f.not!.is!, st, 'object').text}`);
      text = alt(text, compose(q, o, plural));
    }
  }
  // CLOUD C4 (CR 608.2c, 109.2): a group of objects that leaves out the target or the objects of an earlier instruction is also "all other creatures" ("Create X
  // 1/1 Soldier creature tokens. If X is 5 or more, destroy all other creatures."): "other" there can only be other than what the ability named
  // (parser/lower/anaphora.ts#anaphoricOther)
  // r4-copy (CR 109.2, 611.2c): the same for one object of the group at a time, "Each other creature you control becomes a copy of that creature until end of turn."
  // (Naga Fleshcrafter): "each other" there is other than the target or the object an earlier instruction named
  // (r5-dig made the same change for "deals damage equal to its power to each other creature", r5-dig.json#eff.r5dig.damage.equal.eachOtherCreature; one kept)
  if ((plural || o.det === 'each' || o.forEach === true) && otherThanTarget(f.not) && f.other !== true && f.self !== false) {
    const q = build({ ...f, not: undefined }, st, plural, o);
    if (q.whole === undefined && !q.other) text = alt(text, compose({ ...q, other: true }, o, plural));
  }
  // FAST5X E2 (CR 406.1, 115.1): a target card in exile is also "target exiled card" (parser/holes/object.ts#targetObjects reads exactly this)
  if (o.det === 'target' && f.zone === 'exile' && f.owner === undefined && f.controller === undefined) {
    const q = build({ ...f, zone: 'any' }, st, plural, o);
    const isCardHead = q.suffix === 'card' || (q.suffix === '' && q.heads.length === 1 && q.heads[0] === 'card');
    // edh-b-8 (Pull from Eternity): a card's face status comes before the participle, "target face-up exiled card"
    const faceFirst = q.adj.filter((a) => a === 'face-up' || a === 'face-down');
    if (q.whole === undefined && isCardHead && faceFirst.length === 1) {
      return alt(text, compose({ ...q, adj: ['exiled', ...q.adj] }, o, plural), compose({ ...q, adj: [...faceFirst, 'exiled', ...q.adj.filter((a) => a !== faceFirst[0])] }, o, plural));
    }
    if (q.whole === undefined && isCardHead) return alt(text, compose({ ...q, adj: ['exiled', ...q.adj] }, o, plural));
  }
  // edh-zones-7 (CR 406.1, 108.3; family exiled-card-owner-owns): one card in exile that a player owns is also "an exiled card an opponent owns with a void counter on it"
  // (Dauthi Voidwalker): the owner's words follow the noun, before the rest of its description
  // edh-c-12 (Runic Repetition): also a target, and the owner's words after the rest of the description, "target exiled card with flashback you own"
  if (!plural && (o.det === 'a' || o.det === 'the' || o.det === 'target') && f.zone === 'exile' && f.owner !== undefined && f.controller === undefined) {
    const owns = ownerWords(f.owner, st);
    const q = build({ ...f, zone: 'any', owner: undefined }, st, plural, o);
    const isCardHead = q.suffix === 'card' || (q.suffix === '' && q.heads.length === 1 && q.heads[0] === 'card');
    if (owns !== '' && q.whole === undefined && isCardHead) return alt(text, compose({ ...q, adj: ['exiled', ...q.adj], post: [owns, ...q.post] }, o, plural), ...(q.post.length > 0 ? [compose({ ...q, adj: ['exiled', ...q.adj], post: [...q.post, owns] }, o, plural), compose({ ...q, post: [...q.post, owns, 'from exile'] }, o, plural) /* edh-d-76 (Rootcoil Creeper): "target card with flashback you own from exile" */] : []));
  }
  // edh-d-17 (CR 406.1, 108.3; Seize the Storm): a group of cards in exile that a player owns, counted, is also "the number of cards with flashback you own in exile": the owner's words
  // and the zone after the rest of the description
  if (plural && o.det === 'none' && f.zone === 'exile' && f.owner === 'you' && f.controller === undefined) {
    const q = build({ ...f, zone: 'any', owner: undefined }, st, plural, o);
    const isCardHead = q.suffix === 'card' || (q.suffix === '' && q.heads.length === 1 && q.heads[0] === 'card');
    if (q.whole === undefined && isCardHead && q.post.length > 0) return alt(text, compose({ ...q, post: [...q.post, 'you own in exile'] }, o, plural));
  }
  return text;
}

/** The singular nouns an anaphor can use for what a filter describes. */
export function nounsOf(f: ObjectFilter): string[] {
  if (f.anyOf && f.anyOf.length > 0) {
    // FAST4 T19: the fields beside `anyOf` hold for every alternative (design 3.3: ANDed), so "target attacking or blocking creature" is a creature too
    const { anyOf, ...rest } = f;
    const shared = Object.values(rest).some((v) => v !== undefined);
    return [...new Set(shared ? [...nounsOf(rest), ...anyOf.flatMap((x) => nounsOf({ ...rest, ...x }))] : anyOf.flatMap(nounsOf))];
  }
  const zs = zonesOf(f);
  const bf = isBattlefield(zs);
  if (f.stackKind || (zs.length === 1 && zs[0] === 'stack')) return [f.stackKind === 'copy' ? 'spell' : (STACK_HEAD[f.stackKind ?? 'spell'] ?? 'spell')];
  const out: string[] = [];
  // FAST2 T10: "an artifact creature" (every one of `allTypes`) is called by each of its types too ("destroy that creature")
  const types = [...new Set([...(f.types ?? []), ...(f.allTypes ?? [])])].filter((t) => !(f.notTypes ?? []).includes(t)).map(lowerType); // edh-replace-4: "nonland permanent card" is no land
  out.push(...(f.subtypes && f.subtypes.length > 0 && types.length === 0 ? f.subtypes.map((s) => s.toLowerCase()) : types));
  // edh-c-56 (CR 205.3i, 305.6; Peak Eruption): a permanent described by a basic land type alone is a land: "destroy target Mountain. ... that land's controller"
  if (bf && types.length === 0 && f.subtypes && f.subtypes.length > 0 && f.subtypes.every((x) => OTHER_SUBTYPES[x]?.length === 1 && OTHER_SUBTYPES[x]![0] === 'Land')) out.push('land');
  // FAST5 T41 (CR 205.3d, 205.3m): a permanent with a creature type is a creature, so "another Ally you control" is "that creature" afterwards
  if (bf && types.length === 0 && f.subtypes?.some((s) => OTHER_SUBTYPES[s] === undefined)) out.push('creature');
  // edh-c-113 (CR 205.3d, 608.2c; Zirilan of the Claw): "a Dragon permanent card" lists every permanent type, and its creature type still names it afterwards: "That Dragon gains haste"
  if (types.length >= 6 && f.subtypes?.length === 1 && ['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker'].every((t) => types.includes(t))) out.push(f.subtypes[0]!.toLowerCase());
  if (out.length === 0 && f.token) out.push('token');
  else if (f.token === true && types.length > 0 && bf) out.push('token'); // edh-perms-17 (CR 111.1; Redoubled Stormsinger): a token with a card type is also "that token"
  if (bf) out.push('permanent');
  else out.push('card');
  return [...new Set(out)];
}

/** edh-next-112 (CR 208.1; Wild Pair): the total power and toughness equal to that of the trigger event's subject, "the same total power and toughness". */
function isSameTotalPT(c: NumberCmp): boolean {
  const v = c.value;
  return c.op === '==' && typeof v === 'object' && v.q === 'math' && v.op === '+' && v.args.length === 2
    && v.args.every((a, i) => typeof a === 'object' && a.q === 'stat' && a.stat === (i === 0 ? 'power' : 'toughness') && a.of.ref === 'event' && (a.of as { role?: string }).role === 'subject');
}
