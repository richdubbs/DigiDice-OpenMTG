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
import { alt, article, COLOR_WORD, displayFirst, joinList, lowerType, NoRenderer, numWord, pluralize, withArticle } from './text';

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
};

const SHARES_QUALITY: Record<string, string> = { creatureType: 'a creature type', color: 'a color', cardType: 'a card type', name: 'a name', landType: 'a land type' };

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
  /** FAST3 T12: "a Garruk" or "a Garruk planeswalker": the card type a planeswalker type belongs to may follow it (CR 205.3j). */
  typeAfter?: string;
  /** "nonartifact", "nonblack": negated adjectives, listed together once all of them are known. */
  negs: string[];
  /** cloud std-dsk: "that doesn't have the same name as a Room you control" (CR 201.2), said where the positive "with the same name as" goes. */
  notSameName?: string;
  /** The whole noun is one of these phrases ("enchanted creature", "equipped creature"): adjective and noun go together, and each is pluralized as a whole. */
  headChoice?: string[];
  /** The whole phrase, when it is not built from words ("~", "it"). */
  whole?: string;
  /** FAST3 T17: `whole` is a list of noun phrases (an `anyOf` spelled out), so a count goes before it ("up to two basic land cards and/or Desert cards"). */
  wholeCounted?: boolean;
  /** std-re: `whole` already starts with its determiner ("each other creature you control that's a token or a Rabbit"), so compose() says it as it is. */
  wholeHasDet?: boolean;
  other: boolean;
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
// std-r9b (CR 301.7, 205.3g): a crewed Vehicle is an artifact creature that keeps its artifact subtype: "Vehicle creatures you control" is no contradiction
OTHER_SUBTYPES['Vehicle'] = ['Artifact', 'Creature'];
// trek-3 (CR 205.3g, 721.2b): a Spacecraft whose station threshold is met is an artifact creature that keeps its artifact subtype: "Spacecraft creatures you
// control get +3/+3" (Captain Kirk, Boldly Going) is no contradiction either
OTHER_SUBTYPES['Spacecraft'] = ['Artifact', 'Creature'];

/**
 * A type beside a subtype must be one the subtype can have (design 3.3: all fields ANDed; a contradiction is an error of the JSON, not a filter that
 * matches something). "Creature" goes with creature types, "Artifact" with Equipment, and so on.
 */
function checkSubtypeTypes(types: string[], subtypes: string[]): void {
  for (const t of types) {
    const ok = subtypes.some((s) => {
      const owners = OTHER_SUBTYPES[s];
      return owners === undefined ? t === 'Creature' : owners.includes(t);
    });
    if (!ok) throw new NoRenderer(`the type ${t} does not go with the subtype ${subtypes.join(' or ')}`);
  }
}

function zonePhrase(f: ObjectFilter, st: RenderState, zs: (ZoneName | 'any')[], plural: boolean): string {
  const real = zs.filter((z): z is ZoneName => z !== 'any' && z !== 'battlefield');
  if (real.length === 0) return '';
  // r5-mech (CR 108.3, 404.1, 406.1): cards you own in either zone, "cards you own in exile and in your graveyard" (parser/holes/filter.ts)
  if (real.length === 2 && real.includes('exile') && real.includes('graveyard') && f.owner === 'you' && f.controller === undefined) return 'you own in exile and in your graveyard';
  const own = f.owner ?? f.controller;
  const parts: string[] = [];
  const mine = real.filter((z) => z === 'hand' || z === 'library' || z === 'graveyard');
  if (mine.length > 0) {
    const poss = possessorOf(own, st, plural);
    const words = mine.map((z) => ZONE_WORD[z]!);
    // r4-fxz (CR 400.1): two zones of one player are also "your hand and/or graveyard" (a card in either: the same set)
    const list = words.length === 2 ? alt(joinList(words, 'or'), words.join(' and/or ')) : joinList(words, 'or');
    // r5-fxz (CR 102.3, 404.1): cards every opponent owns are also in "your opponents' graveyards" (the zone word plural, as Oracle prints it)
    const owned = poss === 'a' ? `a ${list}` : own === 'opponent' && plural && words.length === 1 ? alt(`${poss} ${list}`, `your opponents' ${pluralize(words[0]!)}`) : `${poss} ${list}`;
    // FAST2 T9: a set of cards in any player's graveyard is "creature cards in all graveyards" (CR 404.1: each player has a graveyard); FAST3 T14: or
    // "cards from graveyards" ("exile up to three target cards from graveyards")
    // r4-fxz: "put all creature cards from all graveyards onto the battlefield under your control" (Rise of the Dark Realms) is the same set
    // std-ry5 (CR 404.1): "Cards in graveyards lose all abilities" (Yixlid Jailer) names that set too
    // p2-graveyard-2 (CR 404.1, 401.1; family cards-in-zones-plural): and a set of cards in any player's graveyard or library is "creature cards in graveyards and
    // libraries" (Grafdigger's Cage): the zone words plural, joined by "and", in Oracle's order
    const ORDER = ['graveyard', 'library', 'hand'];
    const inAll = [...mine].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).map((z) => pluralize(ZONE_WORD[z]!)).join(' and ');
    parts.push(poss === 'a' && plural && words.length === 1 ? alt(`${alt('from', 'in')} ${owned}`, `in all ${pluralize(words[0]!)}`, `from ${pluralize(words[0]!)}`, `from all ${pluralize(words[0]!)}`, `in ${pluralize(words[0]!)}`)
      : poss === 'a' && plural && words.length === 2 && real.length === 2 ? alt(`${alt('from', 'in')} ${owned}`, `in ${inAll}`) : `${alt('from', 'in')} ${owned}`);
  }
  for (const z of real) {
    // the owner of a card in exile or the command zone is a part of where it is (CR 108.3, 406, 408): "a card you own in exile"
    const owns = ownerWords(f.owner, st);
    if (z === 'exile') parts.push(owns === '' ? 'in exile' : alt(`${owns} in exile`, `${owns} from exile`, `in exile ${owns}`));
    else if (z === 'stack') parts.push('on the stack');
    else if (z === 'command') parts.push(owns === '' ? 'in the command zone' : alt(`${owns} in the command zone`, `in the command zone ${owns}`));
  }
  return parts.join(' or ');
}

/** FAST5 T42: `{op: '<', value: the mana value of the event's subject}`, the filter "lesser mana value" reads. */
function isLesserThanEventSubject(c: NumberCmp): boolean {
  const v = c.value;
  return c.op === '<' && typeof v === 'object' && 'q' in v && v.q === 'stat' && v.stat === 'manaValue' && v.of.ref === 'event' && v.of.role === 'subject';
}

/** std-rx28: `{op: '<=', value: the mana value of the event's spell}`, the filter "equal or lesser mana value" reads (Kellan, the Kid). */
function isAtMostEventSpell(c: NumberCmp): boolean {
  const v = c.value;
  return c.op === '<=' && typeof v === 'object' && 'q' in v && v.q === 'stat' && v.stat === 'manaValue' && v.of.ref === 'event' && v.of.role === 'spell';
}

function cmpPhrase(c: NumberCmp, st: RenderState): string {
  const v = K.qty(c.value, st);
  const op: Cmp = c.op;
  // FAST5 T45: a computed bound is written in front, "mana value less than or equal to ~'s power" (Oracle never puts "or less" after a phrase such as "~'s power")
  const computed = typeof c.value === 'object' && c.value.q !== 'X' && c.value.q !== 'var';
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
    case '<': return `less than ${v}`;
    case '>': return `greater than ${v}`;
  }
}

function countPhrase(c: { kind: string; cmp?: NumberCmp }, st: RenderState, plural = false): string {
  const k = c.kind;
  // FAST4 T27: kind 'any' is "a counter" of any kind (CR 122.1)
  // FAST5 T41 (CR 122.1): a set of objects "with counters on them" has a counter of any kind on each
  // FAST5X E21 (CR 122.1): one object 'with one or more counters on it' is 'with a counter on it'; 'with no counters on it' has none of any kind
  if (k === 'any' && !c.cmp) return plural ? alt('counters on them', 'one or more counters on them') : alt('a counter on it', 'one or more counters on it');
  // FAST5 T59 (CR 122.1): "creature with no counters on it": the sum of the counters of every kind is 0 (rules/filter.ts); no other count of any kind is a phrase
  if (k === 'any' && c.cmp?.op === '==' && c.cmp.value === 0) return plural ? 'no counters on them' : 'no counters on it';
  // r4-static (CR 122.1): "with three or more counters on it": counters of any kind together
  if (k === 'any' && !plural && (c.cmp?.op === '>=' || c.cmp?.op === '<=')) return `${typeof c.cmp.value === 'number' ? numWord(c.cmp.value) : K.qty(c.cmp.value, st)} or ${c.cmp.op === '>=' ? 'more' : 'fewer'} counters on it`;
  if (k === 'any') throw new NoRenderer('a counted number of counters of any kind in a filter');
  // FAST4 T33 (CR 122.1): a set of objects says "with +1/+1 counters on them" or "with a +1/+1 counter on them" (one or more each; family counters-on-them)
  if (!c.cmp && plural) return alt(`${withArticle(`${k} counter`)} on them`, `${k} counters on them`);
  if (!c.cmp) return `${withArticle(`${k} counter`)} on it`;
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
      const words = q === 'color' ? 'of the chosen color' : q === 'creatureType' || q === 'cardType' || q === 'landType' ? 'of the chosen type' : undefined;
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
      if (sw.with.ref !== 'each' || sw.quality !== 'name') return false;
      // said after the controller and zone phrases of the noun ("target creature you control that doesn't have ..."), where the positive form goes too
      // std-rx32: "another permanent you control" (the object itself is not compared with, `other`)
      p.notSameName = `that ${plural ? "don't" : "doesn't"} have the same name as ${K.np(sw.other === true ? { ...sw.with.filter, self: false } : sw.with.filter, st, { det: 'a' })}`;
      return true;
    }
    default: return false;
  }
}

function build(f: ObjectFilter, st: RenderState, plural: boolean, o: NpOpts): Parts {
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
    base.post.push(`that targets ${bare ? alt(said.join(' or '), `${said[0]} or player`) : said.join(' or ')}`);
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
  // p2-pt-2 (CR 109.4, 613.4c): a one-option `anyOf` beside other fields is that option's fields beside them (the parser writes it to add a field to a described
  // set, "for each other Sliver on the battlefield" read for each object modified); never when a key is said on both sides
  if (f.anyOf?.length === 1) {
    const { anyOf: [only], ...rest } = f;
    if (Object.keys(only!).every((k) => (rest as Record<string, unknown>)[k] === undefined)) return build({ ...rest, ...only }, st, plural, o);
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
      if (!Object.values(rest).some((v) => v !== undefined)) throw new NoRenderer(`"${way}" without a noun`);
      // std-lci: "card exiled this way" says where the card is (parser/holes/filter.ts#EXILED_THIS_WAY reads the zone with the participle): no "in exile"
      const inner = build(rest, st, plural, putThere || discarded || (way === 'exiled this way' && rest.zone === 'exile') ? { ...o, noZone: true } : o);
      if (inner.whole !== undefined) throw new NoRenderer(`"${way}" after a whole reference`);
      // trek-5 (CR 108.3, 406.1, 608.2c; family owner-in-exiled-this-way): the owner of a card exiled this way is a part of where it is, so the participle may say whose it is, "a land
      // card that player owns exiled this way" (a player the effect iterates over), or leave it to the participle as before
      const owns = way === 'exiled this way' && rest.zone === 'exile' && rest.owner !== undefined && typeof rest.owner === 'object' ? ownerWords(rest.owner, st) : '';
      inner.post.push(owns === '' ? way : alt(way, `${owns} ${way}`));
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
  else if (f.attacking && typeof f.attacking === 'object' && f.attacking.defender === 'opponent') p.post.push(plural ? alt("that are attacking one of your opponents", 'attacking one of your opponents') : alt("that's attacking one of your opponents", 'attacking one of your opponents'));
  // p2-combat-flow-1: attacking you, said after the other words that follow the noun (below, with "that's attacking alone")
  else if (attackingYou) { /* below */ }
  else if (f.attacking && typeof f.attacking === 'object') p.post.push(`attacking ${K.player(f.attacking.defender as PlayerRef, st, 'object').text}`);
  // FAST4 T32: "an attacking nontoken creature" is Oracle's order of the same two adjectives (design 3.3: the fields are ANDed, the order says nothing)
  const ntIdx = p.adj.indexOf('nontoken');
  if (ntIdx >= 0 && p.adj[ntIdx + 1] === 'attacking' && ntIdx + 2 === p.adj.length) p.adj.splice(ntIdx, 2, alt('nontoken attacking', 'attacking nontoken'));
  if (f.blocking === true) p.adj.push('blocking');
  else if (f.blocking === false) p.adj.push('nonblocking');
  if (f.blocked === true) p.adj.push('blocked');
  // p2-combat-flow-2 (CR 509.1h; family unblocked-attacking-order): "unblocked attacking creature" is Oracle's order of the same two adjectives (Curtain of Light)
  else if (f.blocked === false && p.adj[p.adj.length - 1] === 'attacking') p.adj.splice(p.adj.length - 1, 1, alt('attacking unblocked', 'unblocked attacking'));
  else if (f.blocked === false) p.adj.push('unblocked');
  // FAST4 T33: "attacking equipped creature" (CR 301.5), "modified creatures" (CR 700.9)
  // std-hob (CR 301.5): Oracle also says "equipped attacking creature" (Dáin Ironfoot), the same two adjectives in the other order (design 3.3: the fields are ANDed)
  if (f.equipped === true && f.attacking === true && p.adj[p.adj.length - 1] === 'attacking') p.adj.splice(p.adj.length - 1, 1, alt('attacking equipped', 'equipped attacking'));
  else if (f.equipped === true) p.adj.push('equipped');
  else if (f.equipped === false) throw new NoRenderer('equipped:false has no wording');
  if (f.modified === true) p.adj.push('modified');
  else if (f.modified === false) throw new NoRenderer('modified:false has no wording');
  // FAST5 T39 (CR 303.4b): "enchanted creatures you control"
  if (f.enchanted === true) p.adj.push('enchanted');
  else if (f.enchanted === false) p.post.push(plural ? "that aren't enchanted" : "that isn't enchanted"); // p2-damage-3 (CR 303.4b): Winds of Rath, Brainspoil
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
  // std-copy-2 (CR 722.3d): "a prepared spell" (a prepare spell, rules/filter.ts#isPrepareSpell)
  if (f.prepareSpell === true) p.adj.push('prepared');
  else if (f.prepareSpell === false) throw new NoRenderer('prepareSpell:false has no wording in a noun phrase');
  const bareAttached = f.attachedToSource === true && !f.types?.length && !f.allTypes?.length && !f.subtypes?.length && !f.stackKind;
  if (f.attachedToSource === true) {
    p.bare = true;
    if (!bareAttached) p.adj.push(attachWord(st));
  }
  for (const s of f.supertypes ?? []) p.adj.push(lowerType(s));
  if (f.colors && f.colors.length > 0) p.adj.push(joinList(f.colors.map((c) => COLOR_WORD[c] ?? c), 'or'));
  if (f.colorless === true) p.adj.push('colorless');
  else if (f.colorless === false) p.adj.push('colored');
  if (f.multicolored === true) p.adj.push('multicolored');
  else if (f.multicolored === false) p.adj.push('nonmulticolored');
  if (f.monocolored === true) p.adj.push('monocolored');
  for (const c of f.notColors ?? []) p.negs.push(`non${COLOR_WORD[c] ?? c}`);
  for (const t of f.notTypes ?? []) p.negs.push(`non${lowerType(t)}`);
  for (const t of f.notSupertypes ?? []) p.negs.push(`non${lowerType(t)}`);
  // FAST5X E1, CR 700.12: the five outlaw creature types together are "non-outlaw"
  if (isOutlaws(f.notSubtypes)) p.negs.push('non-outlaw');
  else for (const t of f.notSubtypes ?? []) p.negs.push(`non-${t}`);
  // C6 (CR 608.2c): without what an earlier step of the ability chose, "creatures they control not chosen this way", "all creatures except creatures chosen this way"
  // (said last, after the controller: below)
  const notWay = f.not?.is?.ref === 'bound' ? st.info.get(`b:${f.not.is.name}`)?.thisWay : undefined;
  // r4-mech (CR 108.3, 109.4): "you control but don't own" is said with the controller (below)
  const butNotOwn = f.controller === 'you' && f.not !== undefined && JSON.stringify(f.not) === '{"owner":"you"}' && !o.noController;
  if (f.not && notWay !== undefined) { /* C6: below */ }
  else if (butNotOwn) { /* r4-mech: below */ }
  else if (f.not && !isNoAbilities(f.not) && !notEvent && !otherThanObject(f.not) && !otherThanObjectOrSelf(f.not) && !otherThanSelfAndChosen(f.not)) {
    if (!negated(f.not, st, p, plural)) {
      const isnt = `that isn't ${K.np(f.not, st, { det: 'a', noZone: true })}`;
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
  if (p.negs.length === 1) p.adj.push(p.negs[0]!);
  else if (p.negs.length > 1) p.adj.push(negationList(p.negs));

  // --- head ----------------------------------------------------------------------------------------------------------------------------------------------
  const types = (f.types ?? []).map(lowerType);
  const all = (f.allTypes ?? []).map(lowerType);
  const subtypes = f.subtypes ?? [];
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
    p.heads = [STACK_HEAD[f.stackKind ?? 'spell'] ?? 'spell'];
    // "Goblin creature spells", "Aura spells": the subtypes come before the types (CR 205.3)
    if (isOutlaws(subtypes)) {
      // FAST5 T45, CR 700.12: "an outlaw spell" (parser/holes/filter.ts reads the word as the five creature types); FAST5X E20 (family outlaw-word): with no
      // card type, also the five types listed ("an Assassin, Mercenary, Pirate, Rogue, or Warlock spell")
      p.adj.push(types.length === 0 ? alt('outlaw', joinList(subtypes, 'or')) : 'outlaw');
    } else if (subtypes.length > 0) {
      checkSubtypeTypes(f.types ?? [], subtypes);
      p.adj.push(joinList(subtypes, 'or'));
    }
    // FAST1 T5: a set of spells of several types also reads "instant and sorcery spells" (family type-list)
    // FAST5 T45 (same family): after "for each" too, "for each other instant and sorcery spell you've cast before it this turn" (each spell that is one of them)
    // std-lci (CR 110.4b): the six permanent types are what "permanent spell" means (parser/holes/filter.ts reads it so, as "permanent card")
    if (types.length > 0 && isPermanentTypes(types) && subtypes.length === 0 && all.length === 0) p.adj.push('permanent');
    else if (types.length > 0) p.adj.push((plural || o.forEach === true) && types.length > 1 ? alt(joinList(types, 'or'), joinList(types, 'and')) : joinList(types, 'or'));
    if (all.length > 0) p.adj.push(all.join(' '));
  } else if (subtypes.length === 1 && !isToken && all.length === 0 && isPermanentTypes(types)) {
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
  } else if (subtypes.length > 0) {
    const sub = subtypes.slice();
    checkSubtypeTypes(f.types ?? [], sub);
    p.heads = sub;
    // "Knight creatures" (types and subtypes) is not "Knights" (subtypes alone: any permanent or spell with the subtype)
    p.creatureOptional = types.includes('creature') && !isToken;
    p.elementArticles = sub.length > 1 && !p.creatureOptional;
    // FAST3 T12: "as long as you control a Garruk planeswalker" names the card type the planeswalker type belongs to (CR 205.3j); the words without it stay
    if (!isToken && sub.length === 1 && types.length === 1 && f.types![0] === 'Planeswalker' && OTHER_SUBTYPES[sub[0]!]?.includes('Planeswalker')) p.typeAfter = 'planeswalker';
    if (isToken) p.suffix = 'token';
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
    if (types.length > 0 && subtypes.length === 0 && all.length === 0 && !isToken && isPermanentTypes(types)) p.adj.push('permanent');
    // Standard round 4, r4-trig (CR 603.2c; family and-or-types; Dredger's Insight): "one or more artifact and/or creature cards leave your graveyard" (each card of either type)
    else if (types.length > 0) p.adj.push(plural && types.length > 1 ? alt(joinList(types, 'or'), joinList(types, 'and'), andOr(types)) : joinList(types, 'or'));
    if (subtypes.length > 0) p.adj.push(subtypes.join(' or '));
    p.heads = o.head.split(' or ');
    p.suffix = '';
    p.creatureOptional = false;
    delete p.typeAfter;
  }

  // --- post-modifiers ------------------------------------------------------------------------------------------------------------------------------------
  let zoneAt = -1;
  if (o.singleZone === true) {
    // FAST3 T14: "target cards from a single graveyard" (CR 115.1, 404.1): cards in a graveyard, no owner named
    if (zs.length !== 1 || zs[0] !== 'graveyard' || f.owner !== undefined || f.controller !== undefined) throw new NoRenderer('a single zone that is not "a single graveyard"');
    zoneAt = p.post.push('from a single graveyard') - 1;
  } else if (!o.noZone && !onStack && !f.stackKind) {
    const z = zonePhrase(f, st, zs, plural);
    if (z) zoneAt = p.post.push(z) - 1;
  }
  let ctrlAt = -1;
  if (!o.noController && f.controller !== undefined) {
    const c = f.controller;
    if (c === 'you') ctrlAt = p.post.push(butNotOwn ? "you control but don't own" : 'you control') - 1;
    // FAST1 T6: "each creature your opponents control" names the same set as "each creature an opponent controls"; FAST3 T12: so does "for each Swamp your
    // opponents control" (NpOpts.forEach)
    else if (c === 'opponent') ctrlAt = p.post.push(plural || o.det === 'each' || o.forEach === true ? alt('your opponents control', 'an opponent controls') : 'an opponent controls') - 1;
    else if (c !== 'any') {
      // C6 (CR 608.2e): the player of a group choosing in turn ("each opponent sacrifices a creature with the greatest power among creatures they control") is "they" too
      const known = (c as PlayerRef).ref === 'target' || (c as PlayerRef).ref === 'event' || (c as PlayerRef).ref === 'bound' || (c as PlayerRef).ref === 'iterating';
      const who = K.player(c as PlayerRef, st, 'subject');
      const text = who.text;
      // r3-choose: several players named before control ("creatures those players control", a plural player target: render/refs.ts#player)
      const verb = who.person === 'pl' ? 'control' : 'controls';
      const at = p.post.push(known ? alt(`${text} ${verb}`, 'they control') : `${text} ${verb}`) - 1;
      if ((c as PlayerRef).ref === 'iterating') ctrlAt = at; // C6: "with power 2 or less that player controls" (below)
      // p2-damage-3 (family without-keyword-controller-order): "each creature without flying that player controls" (Siege Dragon) after a player named before
      else if (known && f.notKeyword !== undefined && f.keyword === undefined) ctrlAt = at;
    }
  }
  if (f.owner !== undefined && (bf || onStack)) {
    const w = f.owner;
    if (w === 'you') p.post.push('you own');
    else if (w === 'opponent') p.post.push('an opponent owns');
    else if (w !== 'any') p.post.push(`${K.player(w as PlayerRef, st, 'subject').text} owns`);
    // r4-copy (CR 108.3, 109.4): "target permanent you own but don't control" (Coveted Falcon; parser/holes/filter.ts#controlForms)
    const neg = p.post.indexOf("you don't control");
    if (w === 'you' && neg >= 0 && p.post[p.post.length - 1] === 'you own' && f.not !== undefined && Object.keys(f.not).every((k) => k === 'controller' || (f.not as Record<string, unknown>)[k] === undefined)) {
      p.post.pop();
      p.post[neg] = "you own but don't control";
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
  if (f.attachedToSource === false) p.post.push(`other than ${attachWord(st)} creature`);
  const withs: string[] = [];
  const wPlural = plural && o.eachWithSingular !== true; // std-rx11: "each with power greater than its base power"
  if (f.keyword !== undefined) withs.push([f.keyword].flat().join(' or '));
  // FAST5X E15 (CR 208.1, 202.3, 608.2d): "a creature with the greatest power among creatures they control" (parser/holes/filter.ts#featureAt)
  const most = (field: 'power' | 'toughness' | 'manaValue', c: NumberCmp): string => {
    const v = c.value;
    if (typeof v === 'object' && v.q === 'stat' && v.stat === field && v.agg !== undefined && ((v.agg === 'max' && c.op === '>=') || (v.agg === 'min' && c.op === '<='))) return K.qty(v, st);
    // CLOUD std-msh (CR 202.3, 208.1): "a Villain with greater mana value than that creature" (Evil's Thrall): more (less) than that object's own statistic
    // (parser/holes/filter.ts#featureAt); the object is named on a copy of the state, so both readings are its mention
    const words = field === 'manaValue' ? 'mana value' : field;
    if (typeof v === 'object' && v.q === 'stat' && v.stat === field && v.agg === undefined && (c.op === '>' || c.op === '<') && 'ref' in v.of && v.of.ref !== 'each') {
      const than = `${c.op === '>' ? 'greater' : 'lesser'} ${words} than ${K.obj(v.of as ObjRef, cloneState(st), 'object').text}`;
      return alt(`${words} ${cmpPhrase(c, st)}`, than);
    }
    return `${words} ${cmpPhrase(c, st)}`;
  };
  if (f.power) withs.push(most('power', f.power));
  if (f.toughness) withs.push(most('toughness', f.toughness));
  if (f.totalPowerToughness) withs.push(`total power and toughness ${cmpPhrase(f.totalPowerToughness, st)}`); // std-rx10 (CR 208.1)
  if (f.toughnessGreaterThanPower === true) withs.push(wPlural ? 'toughness greater than their power' : 'toughness greater than its power'); // Standard round 4, r4-trig (CR 208.1)
  if (f.powerGreaterThanBase === true) withs.push(wPlural ? 'power greater than their base power' : 'power greater than its base power'); // std-rx11 (CR 208.1, 613.4)
  // FAST5 T42: "with lesser mana value" is a lower mana value than the event's subject (the creature that died or entered; parser/holes/filter.ts#featureAt)
  // std-rx28: "with equal or lesser mana value" is a mana value at most that of the spell the cast trigger is about (parser/holes/filter.ts#featureAt)
  if (f.manaValue) withs.push(isLesserThanEventSubject(f.manaValue) ? alt(`mana value ${cmpPhrase(f.manaValue, st)}`, 'lesser mana value') : isAtMostEventSpell(f.manaValue) ? alt(`mana value ${cmpPhrase(f.manaValue, st)}`, 'equal or lesser mana value') : most('manaValue', f.manaValue));
  // FAST5X E23 (CR 107.3): "spells with {X} in their mana costs"
  if (f.manaCostHasX === true) withs.push(wPlural ? '{X} in their mana costs' : '{X} in its mana cost');
  // Standard round 5, r5-trig (CR 107.4, 202.1): "with one or more blue mana symbols in its mana cost" (only "N or more")
  if (f.manaSymbols !== undefined) {
    const { color, cmp: m } = f.manaSymbols;
    if (m.op !== '>=' || typeof m.value !== 'number' || m.value < 1 || wPlural) throw new NoRenderer('manaSymbols other than "N or more" of one object');
    withs.push(`${numWord(m.value)} or more ${COLOR_WORD[color]} mana symbols in its mana cost`);
  }
  else if (f.manaCostHasX === false) throw new NoRenderer('manaCostHasX:false has no wording');
  if (f.counters) withs.push(countPhrase(f.counters, st, wPlural));
  // trek-9 (CR 301.5, 303.4; parser/holes/trek9.ts#attachedWithAt): "creatures you control with a Communicator attached to them" (Starfleet Communicator)
  if (f.attachedWith !== undefined) withs.push(`${withArticle(f.attachedWith)} attached to ${wPlural ? 'them' : 'it'}`);
  if (f.hasAbility) withs.push(HAS_ABILITY[f.hasAbility]!);
  if (f.not && isNoAbilities(f.not)) withs.push('no abilities'); // FAST5 T42
  // FAST5 T42 (CR 201.2): "up to six target creature cards with different names" (TargetSpec.differentNames; never part of a filter)
  if (o.differentNames === true) withs.push('different names');
  if (o.total !== undefined) withs.push(o.total); // FAST5 T66
  if (o.eachWithSingular === true && (withs.length === 0 || !plural || o.differentNames === true || o.total !== undefined)) throw new NoRenderer('"each with" without a feature of each object');
  if (withs.length > 0) {
    // CLOUD std-misc (CR 201.2; Omenpath Journey): "up to five land cards that have different names" says the same as "... with different names"
    const w0 = withs.length === 1 && o.differentNames === true && plural ? alt('with different names', 'that have different names') : `with ${withs.join(' and ')}`;
    // Cloud r3-repl: a plural description says what each object has also as "each with" ("up to two target creature cards each with mana value 2 or less", Dewdrop
    // Cure); never for a property of the set (different names, a total)
    const w = o.eachWithSingular === true ? `each ${w0}` : plural && o.differentNames !== true && o.total === undefined ? alt(w0, `each ${w0}`) : w0;
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
    else if (ctrlAt >= 0 && ctrlAt === p.post.length - 1 && zoneAt < 0 && withs.length === 1 && (f.keyword !== undefined || (typeof f.controller === 'object' && f.controller.ref === 'iterating') || statBeforeController(f, o.forEach === true))) p.post[ctrlAt] = alt(`${p.post[ctrlAt]} ${w}`, `${w} ${p.post[ctrlAt]}`);
    else p.post.push(w);
  }
  if (f.notKeyword !== undefined) {
    const without = `without ${[f.notKeyword].flat().join(' or ')}`;
    // std-rx18 (family without-keyword-controller-order): "creatures without flying your opponents control" says the same set as "creatures your opponents control without
    // flying" (a lacked keyword alone after the controller, as FAST3 T12's "with flying"; Stoneshock Giant)
    if (ctrlAt >= 0 && ctrlAt === p.post.length - 1 && zoneAt < 0 && withs.length === 0) p.post[ctrlAt] = alt(`${p.post[ctrlAt]} ${without}`, `${without} ${p.post[ctrlAt]}`);
    else p.post.push(without);
  }
  // CLOUD std-ecl (CR 205.3m): "two target creature cards that share a creature type from your graveyard" (TargetSpec.sharedCreatureType; never part of a filter): in
  // front of or behind the zone ("creatures you control that share a creature type" after the controller)
  if (o.shareCreatureType === true) {
    if (!plural) throw new NoRenderer('a shared creature type for a single object');
    const sh = 'that share a creature type';
    if (zoneAt >= 0 && zoneAt === p.post.length - 1) p.post[zoneAt] = alt(`${p.post[zoneAt]} ${sh}`, `${sh} ${p.post[zoneAt]}`);
    else p.post.push(sh);
  }
  const was = plural ? 'were' : 'was';
  // CLOUD std-msh (CR 506.5): "target creature you control that's attacking alone" (parser/holes/filter.ts#postModAt), after the controller
  if (f.attackingAlone === true) p.post.push(alt("that's attacking alone", 'that is attacking alone'));
  // p2-copy-perm-2: where "that entered this turn" is, for "of the chosen type" said before it (below)
  let enteredAt = -1;
  // p2-combat-flow-1 (CR 506.3, 508.1b): attacking you, the player: "a creature without flying that's attacking you" or "... attacking you" (family
  // attacking-you-relative)
  if (attackingYou) p.post.push(alt('attacking you', ...(plural ? ['that are attacking you'] : ["that's attacking you", 'that is attacking you'])));
  if (f.enteredThisTurn === true) enteredAt = p.post.push(alt('that entered the battlefield this turn', 'that entered this turn')) - 1;
  else if (f.enteredThisTurn === false) p.post.push(alt("that didn't enter the battlefield this turn", "that didn't enter this turn"));
  if (f.dealtDamageThisTurn === true) p.post.push(`that ${was} dealt damage this turn`);
  // std-mkm (CR 120.1): "a creature that dealt damage this turn" (the object as the source of the damage)
  if (f.dealtDamageAsSourceThisTurn === true) p.post.push('that dealt damage this turn');
  else if (f.dealtDamageAsSourceThisTurn === false) throw new NoRenderer('dealtDamageAsSourceThisTurn:false has no wording');
  // r3-choose (CR 400.7): "target permanent card in your graveyard that was put there from anywhere this turn" ("there" is the zone the noun phrase names)
  if (f.putThereFrom !== undefined && f.putThereThisTurn !== true) throw new NoRenderer('putThereFrom without putThereThisTurn'); // r5-fxz
  if (f.putThereThisTurn === true) {
    if (typeof f.zone !== 'string' || f.zone === 'battlefield' || f.zone === 'any') throw new NoRenderer('"put there this turn" with no one zone named');
    // r5-fxz: from the battlefield (`putThereFrom`); "from anywhere" may be left unsaid ("that was put there this turn", Abyssal Harvester)
    p.post.push(f.putThereFrom === 'battlefield' ? `that ${was} put there from the battlefield this turn` : alt(`that ${was} put there from anywhere this turn`, `that ${was} put there this turn`));
  }
  // FAST3 T14: "a creature dealt damage by ~ this turn" (the participle, as Oracle prints it)
  // FAST5 T66 (CR 510.2, 120.1): "each nonland permanent with mana value X whose controller was dealt combat damage by ~ this turn" (Steel Hellkite)
  if (f.controllerDealtCombatDamageBySourceThisTurn === true) p.post.push('whose controller was dealt combat damage by ~ this turn');
  else if (f.controllerDealtCombatDamageBySourceThisTurn === false) throw new NoRenderer('controllerDealtCombatDamageBySourceThisTurn:false has no wording');
  // Cloud std-woe (CR 400.7, 120.3; family dealt-by-spell): an instant or sorcery is that object only while it is a spell, so the damage it dealt was dealt this
  // turn: "If a permanent dealt damage by ~ would die this turn, exile it instead" (Torch the Tower)
  const spellSelf = st.ctx.selfTypes?.some((t) => t === 'Instant' || t === 'Sorcery') === true;
  if (f.dealtDamageBySourceThisTurn === true) p.post.push(spellSelf ? alt('dealt damage by ~ this turn', 'dealt damage by ~') : 'dealt damage by ~ this turn');
  else if (f.dealtDamageBySourceThisTurn === false) throw new NoRenderer('dealtDamageBySourceThisTurn:false has no wording');
  if (f.crewedBySourceThisTurn === true) p.post.push('crewed by ~ this turn'); // Standard round 5, r5-trig (CR 702.122c)
  else if (f.crewedBySourceThisTurn === false) throw new NoRenderer('crewedBySourceThisTurn:false has no wording');
  else if (f.dealtDamageThisTurn === false) p.post.push(`that ${plural ? "weren't" : "wasn't"} dealt damage this turn`);
  // std-rx12 (CR 122.6): "that you've put one or more +1/+1 counters on this turn"
  if (f.countersPutThisTurn !== undefined) {
    if (f.countersPutThisTurn.kind === 'any') throw new NoRenderer('countersPutThisTurn of any kind has no wording');
    p.post.push(`that you've put one or more ${f.countersPutThisTurn.kind} counters on this turn`);
  }
  if (f.attackedThisTurn === true) p.post.push('that attacked this turn');
  else if (f.attackedThisTurn === false) p.post.push("that didn't attack this turn");
  if (f.blockedThisTurn === true) p.post.push('that blocked this turn');
  else if (f.blockedThisTurn === false) p.post.push("that didn't block this turn");
  if (p.notSameName !== undefined) p.post.push(p.notSameName); // cloud std-dsk (CR 201.2)
  if (f.sharesWith && f.sharesWith.with.ref === 'each' && f.sharesWith.quality === 'name') {
    // std-hob (CR 201.2): "with the same name as a legendary permanent you control": the name of any one object of a described set (parser/holes/filter.ts)
    p.post.push(`with the same name as ${K.np(f.sharesWith.with.filter, st, { det: 'a' })}`);
  } else if (f.sharesWith && f.sharesWith.with.ref === 'subject' && f.sharesWith.other === true && f.sharesWith.quality === 'creatureType') {
    // p2-pt-1 (CR 205.3m, 613.4c): "for each other creature on the battlefield that shares at least one creature type with it" (Coat of Arms): the object being
    // modified is compared with, and is not one of the objects counted ("other")
    p.other = true;
    // (family on-the-battlefield: permanents of every controller, also said with the zone before the relative clause)
    const shares = `that ${plural ? 'share' : 'shares'} ${alt('a creature type', 'at least one creature type')} with it`;
    p.post.push(f.controller === undefined && f.owner === undefined && (f.zone === undefined || f.zone === 'battlefield') ? alt(shares, `on the battlefield ${shares}`) : shares);
  } else if (f.sharesWith) {
    const other = K.obj(f.sharesWith.with, st, 'object').text;
    const shares = `that ${plural ? 'share' : 'shares'} ${SHARES_QUALITY[f.sharesWith.quality] ?? 'a quality'} with ${other}`;
    // FAST3 T18: Oracle's other wording of a shared name, "with the same name as that creature" (CR 201.2)
    p.post.push(f.sharesWith.quality === 'name' ? alt(shares, `with the same name as ${other}`) : shares);
  }
  // FAST3 T18: "creatures blocking it" (CR 509.1g)
  if (f.blockingObject) p.post.push(`blocking ${K.obj(f.blockingObject, st, 'object').text}`);
  if (f.blockedByObject) p.post.push(`blocked by ${K.obj(f.blockedByObject, st, 'object').text}`); // p2-combat-flow-1 (CR 509.1h)
  // p2-combat-flow-1 (CR 509.1g-h; family blocking-or-being-blocked): "blocking or blocked by ~", also "blocking or being blocked by ~"
  if (f.blockingOrBlockedBy) { const o = K.obj(f.blockingOrBlockedBy, st, 'object').text; p.post.push(alt(`blocking or blocked by ${o}`, `blocking or being blocked by ${o}`)); }
  // FAST4 T22: "Auras attached to it", "Equipment attached to enchanted creature" (CR 301.5, 303.4)
  // std-ry5 (CR 303.4): "an Aura attached to a creature you control": attached to any one permanent of that description
  if (f.attachedToObject?.ref === 'each' && 'filter' in f.attachedToObject) p.post.push(`attached to ${K.np(f.attachedToObject.filter, st, { det: 'a' })}`);
  else if (f.attachedToObject) p.post.push(`attached to ${K.obj(f.attachedToObject, st, 'object').text}`);
  if (f.attachedToPlayer !== undefined) p.post.push(`attached to ${K.player(f.attachedToPlayer, st, 'object').text}`); // p2-damage-2 (CR 303.4, 702.5d)
  // FAST5X E3 (CR 702.171c): "a creature that saddled it this turn"
  if (f.saddledThisTurn) p.post.push(`that saddled ${K.obj(f.saddledThisTurn, st, 'object').text} this turn`);
  if (f.crewedThisTurn) p.post.push(`that crewed ${K.obj(f.crewedThisTurn, st, 'object').text} this turn`); // r5-fxb (CR 702.122)
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
    const words = q === 'creatureType' || q === 'cardType' || q === 'landType' ? alt(CHOSEN_QUALITY[q]!, 'of the chosen type', 'of that type')
      : q === 'cardName' ? alt(CHOSEN_QUALITY[q]!, 'with that name') : CHOSEN_QUALITY[q] ?? 'of the chosen kind';
    // FAST5 T67: "creature cards of the chosen type from your graveyard" names the same cards as "... from your graveyard of the chosen type"
    if (zoneAt >= 0 && zoneAt === p.post.length - 1) p.post[zoneAt] = alt(`${p.post[zoneAt]} ${words}`, `${words} ${p.post[zoneAt]}`);
    // CLOUD C5: "creatures of the chosen type your opponents control" names the same creatures as "creatures your opponents control of the chosen type"
    else if (ctrlAt >= 0 && ctrlAt === p.post.length - 1 && zoneAt < 0) p.post[ctrlAt] = alt(`${p.post[ctrlAt]} ${words}`, `${words} ${p.post[ctrlAt]}`);
    // p2-copy-perm-2 (CR 607.2d, 400.7): "each token you control of the chosen type that entered this turn" (Renewed Solidarity) names the same tokens as "... that
    // entered this turn of the chosen type": the chosen type is said before the relative clause too
    else if (enteredAt >= 0 && enteredAt === p.post.length - 1) p.post[enteredAt] = alt(`${p.post[enteredAt]} ${words}`, `${words} ${p.post[enteredAt]}`);
    else p.post.push(words);
  }
  const tf = f.targets as { ref?: string; filter?: ObjectFilter } | undefined;
  if (f.stackKind && tf?.ref === 'each' && tf.filter !== undefined) {
    // FAST4 T23 (parser/holes/filter.ts REL): "a spell that targets a creature": one of its targets is such an object (CR 115.9b)
    // std-rx28 (family targets-one-or-more): said "that targets one or more creatures" too (Storm, Windrider), the same test of its targets
    const one = K.np(tf.filter, st, { det: 'a' });
    p.post.push(`that targets ${alt(one, K.np(tf.filter, cloneState(st), { det: 'none', plural: true, count: 'one or more' }))}`);
  } else if (f.stackKind && f.targets) {
    const t = f.targets as ObjRef | PlayerRef;
    // M12-1: the one table of player-only references (types/ability.ts, m12 design 4.3); 'each' here is a set of players (a filter is the branch above)
    const isPlayer = isPlayerOnlyRef(t) || t.ref === 'each' || ('ref' in t && t.ref === 'target' && st.specs.get((t as { id: string }).id)?.kind === 'player');
    // Standard round 4, r4-trig (CR 115.9b): one player of a set is "that targets an opponent" / "a player" (parser/holes/filter.ts)
    const anyOne = t.ref === 'each' && 'who' in t ? ((t as { who: string }).who === 'opponent' ? 'an opponent' : (t as { who: string }).who === 'player' ? 'a player' : null) : null;
    const target = anyOne ?? (isPlayer ? K.player(t as PlayerRef, st, 'object').text : K.obj(t as ObjRef, st, 'object').text);
    p.post.push(`that targets ${target}`);
  } else if (f.targets) {
    p.post.push(`that targets ${K.obj(f.targets as ObjRef, st, 'object').text}`);
  }
  // std-rx28: the objects a spell targets are said only as a group the trigger named (render/refs.ts#obj), never as a description
  if (f.targetedBy !== undefined) throw new NoRenderer('a description of the objects a spell or ability targets');
  // FAST5 T45 (CR 113.7a): "ability you control from an artifact source": the source of an ability on the stack, described by one card type or by being colorless
  if (f.abilitySource) p.post.push(`from ${abilitySourceText(f.abilitySource)}`);
  // FAST5 T45 (CR 115.9a, 115.9c): "that targets only a single creature you control", "that targets only ~", "with a single target"
  if (f.targetsOnly) {
    const to = f.targetsOnly as { ref?: string; filter?: ObjectFilter };
    if (to.ref === 'each' && to.filter !== undefined) p.post.push(`that targets only a single ${K.np(to.filter, st, { det: 'none' })}`);
    else if (to.ref === 'self') p.post.push('that targets only ~');
    else throw new NoRenderer('a spell that targets only a reference other than a described object or itself');
  }
  if (f.targetCount) {
    if (f.targetCount.op !== '==' || f.targetCount.value !== 1) throw new NoRenderer('a number of targets other than a single one');
    p.post.push('with a single target');
  }
  if (f.castFrom) p.post.push(`that ${was} cast from ${f.castFrom === 'hand' ? 'a hand' : `a ${ZONE_WORD[f.castFrom] ?? f.castFrom}`}`);
  if (f.isCopy === true) p.post.push("that's a copy of something");
  // FAST5 T68 (CR 303.4b): "creatures you control that are enchanted by Auras you control", "each creature that's enchanted by an Aura you control"
  if (f.enchantedBy !== undefined) {
    if (f.enchantedBy !== 'you') throw new NoRenderer('enchanted by an Aura somebody other than "you" controls');
    p.post.push(plural ? 'that are enchanted by Auras you control' : "that's enchanted by an Aura you control");
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
    if (nameAt >= 0) p.post[nameAt] = alt(`${p.post[nameAt]} named ${f.name}`, `named ${f.name} ${p.post[nameAt]}`);
    else p.post.push(`named ${f.name}`);
  }
  if (f.notName !== undefined) p.post.push(`not named ${f.notName}`);
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
function isNoAbilities(not: ObjectFilter): boolean {
  const keys = Object.keys(not).filter((k) => (not as Record<string, unknown>)[k] !== undefined);
  const kinds = not.anyOf?.map((x) => x.hasAbility).sort().join();
  return keys.length === 1 && keys[0] === 'anyOf' && kinds === 'activated,static,triggered' && not.anyOf!.every((x) => Object.keys(x).length === 1);
}

/** FAST5 T45: "an artifact source", "a colorless source", "a creature source": a source described by one card type, or colorless (nothing else has a wording). */
function abilitySourceText(f: ObjectFilter): string {
  const keys = Object.entries(f).filter(([, v]) => v !== undefined).map(([k]) => k);
  if (keys.length === 1 && keys[0] === 'colorless' && f.colorless === true) return 'a colorless source';
  if (keys.length === 1 && keys[0] === 'types' && f.types!.length === 1) return `${withArticle(lowerType(f.types![0]!))} source`;
  throw new NoRenderer('a source of an ability described by more than one card type or by other fields');
}

/**
 * std-rl: one comparison of power, toughness or mana value with a number, and no other feature said with "with", of a permanent you or an opponent controls.
 * Not in a count of an opponent's permanents ("for each creature with power 4 or greater your opponents control"): that reading would turn a manual sentence of
 * formerly partial abilities into an ability-level cost change (guard G10), so it waits for its own review.
 */
function statBeforeController(f: ObjectFilter, forEach: boolean): boolean {
  if (f.controller !== 'you' && (f.controller !== 'opponent' || forEach)) return false;
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
const isNotEventSubject = (not: ObjectFilter | undefined): boolean => not !== undefined && Object.keys(not).length === 1 && JSON.stringify(not.is) === '{"ref":"event","role":"subject"}';

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
  // std-lci: after one card type of permanents, the kinds are subtypes ("creatures you control that are Fungi and/or Saprolings", The Mycotyrant)
  const typed = rest.types?.length === 1 && base.heads.length === 1 && base.heads[0] === lowerType(rest.types[0]!) && anyOf.every((opt) => opt.subtypes?.length === 1 || opt.token === true) && anyOf.some((opt) => opt.subtypes !== undefined);
  if (base.whole !== undefined || base.suffix !== '' || base.heads.length !== 1 || (base.heads[0] !== 'card' && base.heads[0] !== 'permanent' && !typed)) return null;
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
  const kinds = plural && typed ? alt(andOr(items), joinList(items, 'or')) : plural ? andOr(items) : joinList(items, 'or');
  // std-re (CR 205.3m): one article for the whole singular list is printed too, "each other creature you control that's a Skeleton or Pirate" (parser/holes/filter.ts#thatsKinds)
  const oneArticle = !plural && !cards && typed && anyOf.every((opt) => opt.subtypes?.length === 1 || opt.token === true)
    ? joinList(items.map((x, i) => (i === 0 ? x : x.replace(/^an? /, ''))), 'or') : null;
  return `${compose(base, { det }, plural)} that ${plural ? 'are' : 'is'} ${oneArticle !== null && oneArticle !== joinList(items, 'or') ? alt(kinds, oneArticle) : kinds}`;
}

function buildAnyOf(f: ObjectFilter, st: RenderState, plural: boolean, o: NpOpts): Parts {
  if (o.shareCreatureType === true) throw new NoRenderer('a shared creature type beside a list of kinds'); // CLOUD std-ecl
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
    const withDet = thatAreForm(f, st, o, plural, o.det);
    if (withDet !== null) {
      const plain = buildAnyOfPlain(f, st, plural, o);
      return { ...plain, whole: alt(compose(plain, o, plural), withDet), wholeHasDet: true };
    }
  }
  const says = (o.det === undefined || o.det === 'none') && o.count === undefined ? thatAreForm(f, st, o, plural) : null;
  const hasAdventure = (f.anyOf ?? []).some((opt) => opt.adventure !== undefined);
  if (says === null) {
    if (hasAdventure) throw new NoRenderer('an Adventure beside no "that are" list of kinds');
    return buildAnyOfPlain(f, st, plural, o);
  }
  // "cards that are X, Y, and/or have an Adventure" is the only wording of an Adventure; the other kinds also read "X cards, Y cards in your graveyard"
  if (hasAdventure) return { ...build({ ...f, anyOf: undefined }, st, plural, o), whole: says };
  const plain = buildAnyOfPlain(f, st, plural, o);
  return { ...plain, whole: alt(plain.whole ?? compose(plain, { det: 'none' }, plural), says) };
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
  // FAST5 T66 (CR 202.3): "an artifact card with mana value 4 or 5": alternatives that are the same filter with one mana value each, the numbers said once
  const mvs = manaValueAlternatives(anyOf);
  if (mvs !== null) {
    if (rest.manaValue) throw new NoRenderer('"with mana value N or M" beside another mana value');
    const inner = build({ ...rest, anyOf: [mvs.base] }, st, plural, o);
    if (inner.whole !== undefined) throw new NoRenderer('"with mana value N or M" after a whole reference');
    inner.post.push(`with mana value ${joinList(mvs.values.map(String), 'or')}`);
    return inner;
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
    if (h.whole === undefined) return { ...h, adj: ['historic', ...h.adj] };
  }
  const ps = (anyOf ?? []).map((opt) => build({ ...rest, ...opt }, st, plural, o));
  const first = ps[0]!;
  const same = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
  const merged: Parts = { ...first, adj: first.adj.slice(), heads: first.heads.slice(), post: first.post.slice() };
  if (ps.some((p) => p.whole !== undefined)) {
    merged.whole = ps.map((p) => p.whole ?? compose(p, { det: 'none' }, plural)).join(' or ');
    return merged;
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
  if (ps.every((p) => same(p.adj, first.adj) && same(p.post, first.post) && p.suffix === first.suffix && p.creatureOptional === first.creatureOptional)) {
    // std-cardcopy-1 (family planeswalker-type, CR 205.3j): a card head with its type word after it keeps it in the list ("instant, sorcery, and/or Tamiyo
    // planeswalker cards"); the heads of cards are not pluralized (the suffix is)
    merged.heads = ps.flatMap((p) => (p.typeAfter !== undefined && p.suffix === 'card' && p.heads.length === 1 ? [`${p.heads[0]}${alt('', ` ${p.typeAfter}`)}`] : p.heads));
    if (ps.some((p) => p.typeAfter !== undefined && p.suffix === 'card')) delete merged.typeAfter; // only what this rewrote: a permanent keeps its own ("a Gideon planeswalker you control")
    // FAST5 T44: "a token or a land" says an article for each alternative (a token is not a card type, so Oracle does not share one); the one-article form stays
    merged.elementArticles = ps.some((p) => p.elementArticles) || ps.some((p) => p.heads.length === 1 && p.heads[0] === 'token');
    // FAST5 T59: modifiers that every alternative has are also said for each ("target noncreature artifact or noncreature enchantment"); the shared form stays the display
    if (ps.length > 1 && first.adj.length > 0 && first.suffix === '' && !first.other && ps.every((p) => p.whole === undefined && p.heads.length === 1) && TARGETING_DETS.has(o.det ?? 'none')) {
      // (what follows every alternative, "you control", is said once after the last one)
      const spelled = ps.map((p) => compose({ ...p, post: [] }, { det: 'none' }, plural));
      const shared = compose(merged, { det: 'none' }, plural);
      merged.whole = alt(shared, `${spelled.join(' or ')}${first.post.length > 0 ? ` ${first.post.join(' ')}` : ''}`);
    }
    return merged;
  }
  if (ps.every((p) => same(p.heads, first.heads) && same(p.post, first.post) && p.suffix === first.suffix)) {
    const listed = joinList(ps.map((p) => p.adj.join(' ')), 'or');
    // FAST1 T4, CR 700.6: "historic" is the word for "artifact, legendary, or Saga" ("a historic spell"); only when nothing else is said of the options
    merged.adj = [isHistoric(anyOf ?? []) && ps.every((p) => p.adj.length === 1) ? alt(listed, 'historic') : listed];
    return merged;
  }
  // different heads with different adjectives: spell each alternative out
  const spelled = ps.map((p) => compose(p, { det: 'none' }, plural));
  // FAST3 T17: several cards of either description also read "basic land cards and/or Desert cards" (a set may mix them; each card is one of them)
  // std-rj (CR 205.4a, 205.2a; Nashi): "legendary and/or enchantment cards": the supertype and the card type share the head word, the cards that are either
  const legendaryOr = plural && spelled.length === 2 && spelled[0] === 'legendary cards' && /^[a-z]+ cards$/.test(spelled[1]!) ? [`legendary and/or ${spelled[1]!}`, `legendary or ${spelled[1]!}`] : [];
  merged.whole = plural && spelled.length > 1 ? alt(spelled.join(' or '), andOr(spelled), ...legendaryOr) : spelled.length > 2 ? alt(joinList(spelled, 'or'), spelled.join(' or ')) : spelled.join(' or '); // FAST5 T64: "artifact, non-Aura enchantment, or land"
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
  // cmd1 (CR 700.6; family historic): "each historic card in your hand": the three kinds of cards said by their one word (a card head, "historic card")
  // std-rk (same family): and of permanents, "the number of historic permanents you control" (Alistair, the Brigadier), "affinity for historic permanents"
  if (isHistoric(anyOf ?? []) && ps.every((p) => p.whole === undefined)) {
    const permanents = rest.isCard === undefined && rest.stackKind === undefined && rest.zone === undefined ? [rest] : [];
    const hs = [{ ...rest, isCard: rest.isCard ?? true }, ...permanents].map((g) => build(g, st, plural, o)).filter((h) => h.whole === undefined);
    // TREK-6 (CR 700.6): one permanent after "a" is "a historic permanent you control" / "another historic permanent you control" (Jean-Luc Picard, Luminary), the article or
    // "another" said before the word, as the spelled-out options take theirs (above); the plural and every other determiner keep the form without
    const lead = !plural && o.det === 'a' ? 'a' : 'none';
    if (hs.length > 0) merged.whole = alt(merged.whole, ...hs.map((h) => compose({ ...h, adj: ['historic', ...h.adj] }, { det: lead }, plural)));
  }
  merged.wholeCounted = true;
  // cloud std-spm (CR 205.2a, 205.4a): one object of either description after "each" also reads with "and", the halves spelled out and what they share said once
  // ("each Spider and legendary creature you control", Ultimate Spider-Man: each permanent you control that is a Spider or a legendary creature)
  if (!plural && o.det === 'each' && spelled.length > 1 && ps.every((p) => !p.other && p.whole === undefined && p.suffix === first.suffix && same(p.post, first.post))) {
    const bare = ps.map((p) => compose({ ...p, post: [] }, { det: 'none' }, false));
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
  if (p.creatureOptional && p.suffix === '') return `${joinHeads(p.heads)} ${plural ? 'creatures' : 'creature'}`;
  // FAST3 T17: a card with a creature type AND the type creature is "an Ally creature card" (CR 205.3m: a kindred card has creature types too, so "an Ally
  // card" is a larger set); the subtype alone stays "an Ally card"
  if (p.creatureOptional && p.suffix === 'card') return `${joinHeads(p.heads)} ${plural ? 'creature cards' : 'creature card'}`;
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
  const core = [adj, body].filter((x) => x !== '').join(' ');
  const tail = p.post.length > 0 ? ` ${p.post.join(' ')}` : '';
  const det = p.bare && (o.det === 'a' || o.det === 'the' || o.det === 'none' || o.det === undefined) ? 'none' : (o.det ?? 'none');
  const count = o.count;
  const other = p.other;
  let lead = '';
  if (count !== undefined) lead = other ? `${count} other${det === 'target' ? ' target' : ''}` : `${count}${det === 'target' ? ' target' : ''}`;
  else {
    switch (det) {
      case 'target': lead = other ? 'another target' : 'target'; break;
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
  const besideTarget = other && det === 'target' && p.post.length === 0;
  if (besideTarget || (other && o.forEach === true && det === 'none' && count === undefined)) {
    const plain = besideTarget ? [count !== undefined ? `${count} target` : 'target', core].filter((x) => x !== '').join(' ') : core;
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
  const p = build(f, st, plural, o);
  let text = compose(p, o, plural);
  // FAST5 T57 (CR 105.2): "target creature or planeswalker that's green or blue" says the same as "target green or blue creature or planeswalker" (colors only,
  // beside nothing else that is about colors; parser/holes/filter.ts#postModAt reads exactly this)
  if (f.colors !== undefined && f.colors.length > 0 && p.whole === undefined && f.anyOf === undefined && f.colorless === undefined && f.multicolored === undefined && f.monocolored === undefined) {
    const q = build({ ...f, colors: undefined }, st, plural, o);
    if (q.whole === undefined) {
      q.post.push(`${plural ? 'that are' : "that's"} ${joinList(f.colors.map((c) => COLOR_WORD[c] ?? c), 'or')}`);
      text = alt(text, compose(q, o, plural));
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
  if ((plural || o.det === 'each') && otherThanTarget(f.not) && f.other !== true && f.self !== false) {
    const q = build({ ...f, not: undefined }, st, plural, o);
    if (q.whole === undefined && !q.other) text = alt(text, compose({ ...q, other: true }, o, plural));
  }
  // FAST5X E2 (CR 406.1, 115.1): a target card in exile is also "target exiled card" (parser/holes/object.ts#targetObjects reads exactly this)
  if (o.det === 'target' && f.zone === 'exile' && f.owner === undefined && f.controller === undefined) {
    const q = build({ ...f, zone: 'any' }, st, plural, o);
    const isCardHead = q.suffix === 'card' || (q.suffix === '' && q.heads.length === 1 && q.heads[0] === 'card');
    if (q.whole === undefined && isCardHead) return alt(text, compose({ ...q, adj: ['exiled', ...q.adj] }, o, plural));
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
  const types = [...new Set([...(f.types ?? []), ...(f.allTypes ?? [])])].map(lowerType);
  out.push(...(f.subtypes && f.subtypes.length > 0 && types.length === 0 ? f.subtypes.map((s) => s.toLowerCase()) : types));
  // FAST5 T41 (CR 205.3d, 205.3m): a permanent with a creature type is a creature, so "another Ally you control" is "that creature" afterwards
  if (bf && types.length === 0 && f.subtypes?.some((s) => OTHER_SUBTYPES[s] === undefined)) out.push('creature');
  if (out.length === 0 && f.token) out.push('token');
  if (bf) out.push('permanent');
  else out.push('card');
  return [...new Set(out)];
}
