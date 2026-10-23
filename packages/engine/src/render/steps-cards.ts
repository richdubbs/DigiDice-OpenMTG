/**
 * Cards and mana (WP2): draw, discard, mill, scry, surveil, reveal, look, search, shuffle, piles, addMana (CR 121, 701.9, 701.17-25, 106).
 */
import { namesOnePlayer } from '../model/focus';
import type { ManaProduction, ManaRestriction, ManaSpentRider, ObjectFilter, ObjRef, Quantity } from '../types/ability';
import { keywordWords } from './kw';
import type { ManaType } from '../types/mana';
import { acting, plain, type Clause } from './clause';
import { K } from './kernel';
import { countParts } from './qty';
import { markTriggerRoles, rangeWords } from './refs';
import { bind, bindCant, byPlayer, countedNoun, countedNp, halfOfOwn, isComputed, markX, perForms, whereX, type StepOf } from './steps-util';
import { MILLED_KEY, cloneState, playerKey, type RenderState } from './state';
import { alt, ALT_OPEN, conj, joinList, NoRenderer, numWord } from './text';

/** "your hand" for a filter that is only a zone of a player ("all cards in your hand"); null for any other filter. */
export function zoneSetPhrase(f: ObjectFilter, st: RenderState): string | null {
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined);
  const z = f.zone;
  // r4-fxz (CR 402.1, 404.1): every card of one player's hand and graveyard, "shuffle your hand and graveyard into your library" (Weftwalking)
  if (Array.isArray(z) && z.length === 2 && z[0] === 'hand' && z[1] === 'graveyard' && keys.every((k) => k === 'zone' || k === 'owner') && f.owner !== undefined && f.owner !== 'any') {
    const ph2 = K.player(f.owner, st, 'possessive');
    return ph2.plural === true ? null : `${ph2.text} hand and graveyard`;
  }
  if (typeof z !== 'string' || !['hand', 'library', 'graveyard'].includes(z)) return null;
  if (!keys.every((k) => k === 'zone' || k === 'owner')) return null;
  const owner = f.owner;
  const ph = owner === undefined || owner === 'any' ? null : K.player(owner, st, 'possessive');
  // cloud std-spm (CR 404.1, 115.1): the zones of several players are plural, each player's own ("exile any number of target players' graveyards")
  const zoneWord = ph?.plural === true ? ({ hand: 'hands', library: 'libraries', graveyard: 'graveyards' } as Record<string, string>)[z]! : z;
  return `${ph === null ? 'a' : ph.text} ${zoneWord}`;
}

/** FAST5 T46: all the cards of one player's hand and nothing else (the shape parser/templates/effect/cards.json writes for "reveals their hand", "look at ... hand"). */
const isHandOf = (ref: ObjRef): boolean => ref.ref === 'each' && ref.filter.zone === 'hand' && ref.filter.owner !== undefined && Object.keys(ref.filter).length === 2;

function refText(ref: ObjRef, st: RenderState): string {
  if (ref.ref === 'each') {
    const zone = zoneSetPhrase(ref.filter, st);
    if (zone) return zone;
  }
  return K.obj(ref, st, 'object').text;
}

const sym = (t: ManaType): string => `{${t}}`;

function manaUnits(units: ManaType[][]): string {
  const all5 = (u: ManaType[]): boolean => ['W', 'U', 'B', 'R', 'G'].every((c) => u.includes(c as ManaType)) && u.length === 5;
  if (units.every((u) => u.length === 1)) {
    const run = units.map((u) => sym(u[0]!)).join('');
    // std-mana-2 (CR 106.4; family mana-and-list): fixed mana of three or more types, each type's symbols together, is also an "and" list of those groups:
    // "Add {W}{W}, {U}{U}, {B}{B}, {R}{R}, and {G}{G}." (Esper Terra); the pool has no order (CR 106.4)
    const groups: string[] = [];
    for (const u of units) {
      const t = sym(u[0]!);
      if (groups.length > 0 && groups[groups.length - 1]!.startsWith(t)) groups[groups.length - 1] += t;
      else groups.push(t);
    }
    const distinct = new Set(units.map((u) => u[0]!)).size === groups.length;
    return groups.length >= 3 && distinct ? alt(run, joinList(groups, 'and')) : run;
  }
  if (units.every(all5)) {
    return units.length === 1 ? alt('one mana of any color', 'one mana of any one color') : `${numWord(units.length)} mana in any combination of colors`;
  }
  // T3 (push wave): two units of the same two options are the filter lands' "{W}{W}, {W}{B}, or {B}{B}" (the pool has no order, CR 106.4: WB = BW)
  if (units.length === 2 && units[0]!.length === 2 && units[1]!.length === 2 && units[0]![0] === units[1]![0] && units[0]![1] === units[1]![1] && units[0]![0] !== units[0]![1]) {
    const [a, b] = units[0]!.map(sym) as [string, string];
    return alt(`${a} or ${b}, then ${a} or ${b}`, `${a}${a}, ${a}${b}, or ${b}${b}`);
  }
  // T3: one unit of three or more options is a list ("{R}, {W}, or {B}", CR 106.1); two options read "{R} or {W}"
  return units.map((u) => (u.length === 1 ? sym(u[0]!) : joinList(u.map(sym), 'or'))).join(', then ');
}

function manaDynamic(d: ManaProduction, st: RenderState): string {
  const n = (c: Parameters<typeof K.qty>[0]): string => (typeof c === 'number' ? (c === 1 ? 'one' : numWord(c)) : K.qty(c, st));
  switch (d.kind) {
    case 'anyColor': {
      // r3-cost (CR 106.1, 106.4): "{R} or {G} for each Raccoon you control": one of two types for each object counted
      if (d.from !== undefined) {
        const per = countParts(d.count, st);
        if (d.from.length !== 2 || !per) throw new NoRenderer('mana of a limited choice of types for each unit, other than "{A} or {B} for each ..."');
        return `{${d.from[0]}} or {${d.from[1]}} for each ${per.singular}`;
      }
      return typeof d.count === 'number' && d.count === 1 ? 'one mana of any color' : `${n(d.count)} mana in any combination of colors`;
    }
    case 'anyOneColor': {
      // FAST5 T48 (CR 106.1b): "Add X {G} or X {W}, where X is the number of other creatures you control": X mana of one of the listed types
      if (d.from !== undefined) {
        if (typeof d.count === 'number' || d.count.q === 'X') throw new NoRenderer('a limited choice of mana types with a fixed amount');
        const x = K.qty(d.count, st);
        return `X ${d.from.map(sym).join(' or X ')}, where X is ${x}`;
      }
      const plain = `${n(d.count)} mana of any one color`;
      // FAST3 T11: a computed amount is also "X mana of any one color, where X is ~'s power" (CR 107.3, 106.4; family mana-where-x); the X of the
      // ability's own cost is the plain "X mana of any one color"
      if (typeof d.count === 'number' || d.count.q === 'X') return plain;
      const x = K.qty(d.count, st);
      // every player's permanents: "the number of Elves" is "the number of Elves on the battlefield" (family on-the-battlefield, CR 110.1)
      const f = d.count.q === 'count' && d.count.of.ref === 'each' ? d.count.of.filter : undefined;
      const everywhere = f !== undefined && f.controller === undefined && f.owner === undefined && (f.zone === undefined || f.zone === 'battlefield');
      const where = [`X mana of any one color, where X is ${x}`, ...(everywhere ? [`X mana of any one color, where X is ${x} on the battlefield`] : [])];
      return alt(plain, ...where);
    }
    // CMD3: "{W} or one mana of the chosen color" (the Thriving lands)
    case 'chosen': {
      // std-mana-1 (CR 106.4, 608.2h): "three mana of the chosen color for each artifact sacrificed this way" (a number times a count, the count said last)
      const c = d.count;
      if (d.or === undefined && typeof c === 'object' && c.q === 'math' && c.op === '*' && c.args.length === 2 && typeof c.args[0] === 'number') {
        const per = countParts(c.args[1] as Quantity, st);
        if (per !== null) return `${n(c.args[0])} mana of the chosen color for each ${per.singular}`;
      }
      return d.or !== undefined ? `${d.or.map(sym).join(' or ')} or ${n(d.count)} mana of the chosen color` : `${n(d.count)} mana of the chosen color`;
    }
    // FAST5 T48 (CR 106.5, 607.2a): "one mana of any of the exiled cards' colors"
    case 'colorsOf': {
      if (d.of.ref !== 'linked' || d.of.link !== 'exiled') throw new NoRenderer('the colors of objects other than the cards a linked ability exiled');
      return `${n(d.count)} mana of any of the exiled cards' colors`;
    }
    case 'eachColorAmong': throw new NoRenderer('a mana production that is the whole clause');
    // p2-mana-1 (CR 106.7): "one mana of any color that a land an opponent controls could produce"
    case 'couldProduce': {
      if (d.among.ref !== 'each' || !('filter' in d.among)) throw new NoRenderer('the mana objects other than a described group could produce');
      return `${n(d.count)} mana of any ${d.colorsOnly === true ? 'color' : 'type'} that ${K.np(d.among.filter, st, { det: 'a' })} could produce`;
    }
    case 'devotionColor': throw new NoRenderer('a devotion production that is the whole clause'); // p2-mana-2: said by the addMana step
    // M11-0 (m11 design 4.5): CR 903.4, 702.124c (Command Tower, Arcane Signet)
    case 'commanderIdentity': return typeof d.count === 'number' && d.count === 1 ? "one mana of any color in your commander's color identity" : `${n(d.count)} mana in any combination of colors in your commander's color identity`;
    case 'ofType': {
      // FAST2 T7: "{G} for each creature you control" is the same amount as "an amount of {G} equal to the number of creatures you control" (CR 106.4)
      const per = countParts(d.count, st);
      const amount = `an amount of {${d.type}} equal to ${K.qty(d.count, st)}`;
      // CLOUD std-tmt (CR 106.4, 603.2; family mana-that-much): the amount of the triggering event is also "add that much {R}"; r3-cost (CR 106.4; family
      // mana-amount-before): a number stands before the symbol too, "add six {R}" (one alt site for both); std-rx4 (CR 120.4a, 608.2c): and the excess damage the
      // condition of the instruction named ("If the creature the opponent controls is dealt excess damage this way, add that much {R}", render/qty.ts says it "that much")
      if (typeof d.count === 'number' || d.count.q === 'eventAmount' || d.count.q === 'excessDamage') return alt(amount, typeof d.count === 'number' ? `${n(d.count)} {${d.type}}` : `that much {${d.type}}`);
      if (!per) return amount;
      // every player's permanents: "for each Elf" is "for each Elf on the battlefield" (family on-the-battlefield, CR 110.1)
      const c = d.count as Extract<typeof d.count, { q: 'count' }>;
      const f = typeof d.count === 'object' && d.count.q === 'count' && c.of.ref === 'each' ? c.of.filter : undefined;
      const everywhere = f !== undefined && f.controller === undefined && f.owner === undefined && (f.zone === undefined || f.zone === 'battlefield');
      return everywhere ? alt(amount, `{${d.type}} for each ${per.singular}`, `{${d.type}} for each ${per.singular} on the battlefield`) : alt(amount, `{${d.type}} for each ${per.singular}`);
    }
    case 'sameAsSpent': return 'one mana of any type that was spent to activate this ability';
    case 'eventProduced': return `${n(d.count)} mana of any type that ${d.noun} produced`; // T38: CR 106.3
  }
}

/**
 * FAST5X E23 (CR 601.2a, 106.6): the zone a spell is cast from, as a mana restriction says it ("spells from exile", "spells from your hand"); the rest of the
 * filter is the spell's description. Null for a filter without `castFrom`.
 */
function castFromPhrase(f: ObjectFilter): { rest: ObjectFilter; from: string } | null {
  // r3-cost (CR 601.2a): "a spell from anywhere other than your hand": a spell not cast from its caster's hand (parser/holes/spend.ts)
  if (f.castFrom === undefined && f.not !== undefined && Object.keys(f.not).length === 1 && f.not.castFrom === 'hand') {
    const { not: _not, ...rest } = f;
    return { rest, from: 'from anywhere other than your hand' };
  }
  if (f.castFrom === undefined) return null;
  const { castFrom, owner, ...rest } = f;
  if (castFrom === 'exile' && owner === undefined) return { rest, from: 'from exile' };
  if ((castFrom === 'hand' || castFrom === 'graveyard') && owner === 'you') return { rest, from: `from your ${castFrom}` };
  throw new NoRenderer(`a spell cast from ${castFrom} in a mana restriction`);
}

/**
 * A plural list of types or subtypes names a set of spells with "or", "and" or "and/or" ("Dwarf, Equipment, and Saga spells", "Aura and/or Equipment spells":
 * spells with any of them, CR 106.6). Only for a plain list (no other words in the description).
 */
function listConjunctions(text: string, f: ObjectFilter): string {
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined && k !== 'stackKind');
  const listed = (f.types?.length ?? 0) > 1 || (f.subtypes?.length ?? 0) > 1;
  const at = text.lastIndexOf(' or ');
  if (!listed || at < 0 || text.includes(ALT_OPEN) || !keys.every((k) => k === 'types' || k === 'subtypes')) return text;
  return alt(text, `${text.slice(0, at)} and ${text.slice(at + 4)}`, `${text.slice(0, at)} and/or ${text.slice(at + 4)}`);
}

/** One spell description of a mana restriction in one number: "a creature spell" or "creature spells" (the same set of spells, CR 106.6), its cast zone after it. */
function spellNp(f: ObjectFilter, st: RenderState, plural: boolean): string {
  const z = castFromPhrase(f);
  const base: ObjectFilter = { ...(z ? z.rest : f), stackKind: 'spell' };
  const np = plural ? listConjunctions(K.np(base, st, { det: 'none', plural: true }), base) : K.np(base, st, { det: 'a' });
  return z ? `${np} ${z.from}` : np;
}

/** The spells of a mana restriction: one description, or several joined by "or" ("a Dragon spell or an Omen spell", the `anyOf` of the parser). */
function spellsPhrase(f: ObjectFilter, st: RenderState, plural: boolean): string {
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined);
  if (keys.length === 1 && keys[0] === 'anyOf' && f.anyOf!.length > 1) return f.anyOf!.map((x) => spellNp(x, st, plural)).join(' or ');
  return spellNp(f, st, plural);
}

/** "activate abilities of artifact sources" / "an ability of an artifact" / "an equip ability" (CR 602.1, 702.6a), in one number. */
function abilitiesPhrase(r: ManaRestriction, st: RenderState, plural: boolean): string {
  const a = r.abilities!;
  const empty = Object.values(a).every((v) => v === undefined);
  if (r.abilityKeyword !== undefined) {
    if (!empty) throw new NoRenderer('a keyword ability of a described source in a mana restriction');
    return plural ? `activate ${r.abilityKeyword} abilities` : `activate an ${r.abilityKeyword} ability`;
  }
  if (empty) return plural ? 'activate abilities' : 'activate an ability';
  return plural
    ? alt(`activate abilities of ${K.np(a, st, { det: 'none', plural: true })}`, `activate abilities of ${K.np(a, st, { det: 'none', plural: true, head: 'source' })}`)
    : alt(`activate an ability of ${K.np(a, st, { det: 'a' })}`, `activate an ability of ${K.np(a, st, { det: 'a', head: 'source' })}`);
}

/** "turn a permanent face up" / "turn creatures face up" (CR 116.2b, 702.37e, 708.7), in one number. */
function faceUpPhrase(f: ObjectFilter, plural: boolean): string {
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined);
  if (keys.length === 0) return plural ? 'turn permanents face up' : 'turn a permanent face up';
  if (keys.length === 1 && f.types?.length === 1 && f.types[0] === 'Creature') return plural ? 'turn creatures face up' : 'turn a creature face up';
  throw new NoRenderer('turning a described permanent face up in a mana restriction');
}

function restrictionText(r: ManaRestriction, st: RenderState): string {
  // FAST5X E23 (CR 106.6): "This mana can't be spent to cast a nonartifact spell" / "... nonartifact spells"
  if (r.notSpells !== undefined) {
    if (r.spells || r.abilities || r.unlock || r.turnFaceUp || r.spellRider || r.abilityKeyword) throw new NoRenderer('"can\'t be spent" beside another mana restriction');
    return `this mana can't be spent to cast ${alt(spellsPhrase(r.notSpells, st, false), spellsPhrase(r.notSpells, st, true))}`;
  }
  if (r.abilityKeyword !== undefined && !r.abilities) throw new NoRenderer('a keyword without abilities in a mana restriction');
  // FAST5X E8 (CR 709.5e): "Spend this mana only to cast Room spells and unlock doors" (its display form first)
  const e8 = r.unlock === true && !r.abilities && !r.turnFaceUp;
  // FAST5X E23 + FAST5 T48 (CR 106.6, 601.2h, 602.2b): the clauses are one set of things the mana may pay for: "X or Y", "X or to Y", "X, Y, or Z", in
  // either order for two. The whole restriction reads in the singular or in the plural (Oracle never mixes them: "cast an artifact spell or activate an
  // ability of an artifact source", "cast artifact spells or activate abilities of artifacts"); "and" joins clauses only in the plural ("cast Elf spells
  // and activate abilities of Elf sources", "cast Room spells and unlock doors"; Oracle prints no singular "cast a ... spell and activate an ability").
  const form = (plural: boolean): string => {
    const parts: string[] = [];
    if (r.spells) parts.push(`cast ${spellsPhrase(r.spells, st, plural)}`);
    if (r.abilities) parts.push(abilitiesPhrase(r, st, plural));
    if (r.unlock === true) parts.push(plural ? 'unlock doors' : 'unlock a door');
    if (r.turnFaceUp) parts.push(faceUpPhrase(r.turnFaceUp, plural));
    if (parts.length === 0) throw new NoRenderer('a mana restriction that allows nothing');
    const joins = plural ? (e8 ? [' and ', ' or ', ' or to '] : [' or ', ' or to ', ' and ']) : [' or ', ' or to '];
    const last = parts.length - 1;
    if (parts.length === 1) return parts[0]!;
    // two clauses in either order ("activate an ability or cast an artifact spell"): the set of payments is the same
    if (parts.length === 2) return alt(parts.join(alt(...joins)), `${parts[1]}${alt(...joins)}${parts[0]}`);
    return `${parts.slice(0, last).join(', ')},${alt(...joins)}${parts[last]}`;
  };
  // the display form: the plural first for E8's sentence and for abilities alone ("activate abilities of artifacts"), else the singular
  const pluralFirst = e8 || (!r.spells && r.abilities !== undefined && r.abilityKeyword === undefined);
  let text = `spend this mana only to ${pluralFirst ? alt(form(true), form(false)) : alt(form(false), form(true))}`;
  if (r.spellRider === 'cantBeCountered') text += ", and that spell can't be countered";
  return text;
}

/**
 * std-mana-1 (CR 106.6): the rider on the spell the mana is spent on, a sentence of its own after the instruction: "if that mana is spent on a dragon creature
 * spell, it gains haste until end of turn", "if any of that mana is spent on a creature spell, ...", "... , that spell can't be countered".
 */
function riderText(r: ManaSpentRider, st: RenderState): string {
  if ((r.gains === undefined) === (r.cantBeCountered === undefined)) throw new NoRenderer('a mana rider needs exactly one of gains and cantBeCountered');
  const what = r.gains !== undefined ? `it gains ${keywordWords(r.gains, st)} until end of turn` : "that spell can't be countered";
  return `if ${r.any === true ? 'any of that mana' : 'that mana'} is spent on ${spellsPhrase(r.spells, st, false)}, ${what}`;
}

/** r3-refs (CR 201.2): the two names of a search for "a card named A and/or a card named B" (up to two cards, different names, each one of the names), else null. */
function twoNames(s: StepOf<'search'>): [string, string] | null {
  const f = s.filter;
  if (s.differentNames !== true || (s.min ?? 0) !== 0 || s.max !== 2 || s.and !== undefined || Object.keys(f).some((k) => k !== 'anyOf' && (f as Record<string, unknown>)[k] !== undefined)) return null;
  const names = (f.anyOf ?? []).map((g) => (Object.keys(g).length === 1 && typeof g.name === 'string' ? g.name : null));
  const [a, b] = names;
  return names.length === 2 && typeof a === 'string' && typeof b === 'string' && a !== b ? [a, b] : null;
}
/** CR 205.3i, 305.6: the five basic land types. */
const BASIC_LAND_TYPES: readonly string[] = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];

/**
 * std-rx26: is `q` `{q:'count', of:{ref:'each', filter:{is:<binding>}}}` of the binding of an earlier control change of ONE player ("Target opponent gains control of
 * any number of target permanents you control", render/steps-lasting.ts binds it with that player as its actor)? The objects it took are the ones that player
 * gained control of this way (CR 613.1b: the newest control-changing effect wins).
 */
function countsGainedControl(q: Quantity, st: RenderState): boolean {
  if (typeof q !== 'object' || q.q !== 'count' || q.of.ref !== 'each' || !('filter' in q.of)) return false;
  const f = q.of.filter as Record<string, unknown>;
  const is = f['is'] as { ref?: string; name?: string } | undefined;
  if (Object.keys(f).length !== 1 || is?.ref !== 'bound' || typeof is.name !== 'string') return false;
  return st.info.get(`b:${is.name}`)?.actor !== undefined;
}

export const CLAUSES_CARDS = {
  draw: (s: StepOf<'draw'>, st: RenderState): Clause => {
    // FAST5X E2 (CR 121.2, 608.2c): "draw another card" is one more card for a player this ability already had draw ("... you draw a card ... If C, draw
    // another card"); the mark is per player (another player's draw is not "another card" of yours)
    const drew = `drew:${playerKey(s.who) ?? 'x'}`;
    const again = st.mentioned.has(drew);
    st.mentioned.add(drew);
    const c = byPlayer(s.who, st, 'draw', () => {
      // CMD2 (CR 903.8, 107.3): "target player draws X cards plus an additional card for each time they've cast a commander from the command zone this game"
      // (Commander's Insight): X and the casts of the player who draws (`of` is that player), never anyone else's
      if (typeof s.count === 'object' && s.count.q === 'math' && s.count.op === '+' && s.count.args.length === 2) {
        const [a, b] = s.count.args;
        if (typeof a === 'object' && a.q === 'X' && typeof b === 'object' && b.q === 'commanderCasts' && b.of !== undefined && s.who.ref !== 'you' && JSON.stringify(b.of) === JSON.stringify(s.who)) {
          return "X cards plus an additional card for each time they've cast a commander from the command zone this game";
        }
      }
      // std-rx26 (CR 608.2c, 613.1b): "draw a card for each one they gained control of this way": the objects an earlier control change of this ability took
      // (its `as`, render/steps-lasting.ts) that the player who gained them controls now
      if (countsGainedControl(s.count, st)) return 'a card for each one they gained control of this way';
      const beforePer = typeof s.count === 'object' && s.count.q === 'happenedCount' ? cloneState(st) : null; // r4-refs, below
      const beforeBase = typeof s.count === 'object' ? cloneState(st) : null; // std-r10: the "for each" readings as from before `base` named a target (steps-util.ts#perForms)
      // p2-zone-moves-1 (CR 701.9a, 121.2, 608.2e): "each player discards their hand, then draws that many cards": a group's draw of the cards each player discarded
      // (parser/lower/quantities.ts#groupDrawsOwnDiscards), said "that many cards"
      if (typeof s.count === 'object' && s.count.q === 'resultCount' && s.who.ref === 'each' && JSON.stringify(s.count.which) === JSON.stringify({ owner: { ref: 'iterating' } })
        && st.info.has(`r:${s.count.step}`)) return 'that many cards';
      // p2-zone-moves-1 (CR 107.1b, 608.2c): "... then draws that many cards minus one" (Dark Deal): a result count less a fixed number (never fewer than none)
      if (typeof s.count === 'object' && s.count.q === 'math' && s.count.op === '-' && s.count.args.length === 2) {
        const [a, b] = s.count.args;
        const own = s.who.ref === 'each' ? JSON.stringify({ owner: { ref: 'iterating' } }) : undefined;
        if (typeof a === 'object' && a.q === 'resultCount' && JSON.stringify(a.which) === own && a.maxPerOwner === undefined && st.info.has(`r:${a.step}`) && typeof b === 'number' && b > 0) return `that many cards minus ${numWord(b)}`;
      }
      // p2-zone-moves-1 (CR 701.9a, 608.2c): "... then draws cards equal to the greatest number of cards a player discarded this way" (Windfall)
      if (typeof s.count === 'object' && s.count.q === 'resultCount' && s.count.maxPerOwner === true && s.count.which === undefined && st.info.get(`r:${s.count.step}`)?.thisWay === 'discarded this way') {
        return 'cards equal to the greatest number of cards a player discarded this way';
      }
      const base = countedNoun(s.count, 'card', st);
      if (again && s.count === 1) return alt(base, 'another card');
      // FAST1 T6: "then draw that many cards" after a discard this ability named (CR 608.2c, 608.2h)
      // (Cloud C7: not a count of a description of what the step moved, "a card for each creature card exiled this way", which countParts says below)
      if (typeof s.count === 'object' && s.count.q === 'resultCount' && s.count.which === undefined && st.info.has(`r:${s.count.step}`)) {
        // std-tdm (CR 701.8a, 608.2c): "draw a card for each permanent destroyed this way" (render/qty.ts#countParts; render/steps-zones.ts#destroy)
        const per = st.info.get(`r:${s.count.step}`)?.thisWay === 'destroyed this way' ? countParts(s.count, st) : null;
        return alt(base, 'that many cards', ...(per ? [`a card for each ${per.singular}`] : []));
      }
      // FAST4 T26: "then draw that many cards plus one": the number of things an earlier step of this ability named, plus a fixed number (CR 608.2c, 608.2h)
      if (typeof s.count === 'object' && s.count.q === 'math' && s.count.op === '+' && s.count.args.length === 2) {
        const [a, b] = s.count.args;
        if (typeof a === 'object' && a.q === 'resultCount' && st.info.has(`r:${a.step}`) && typeof b === 'number' && b > 0) return alt(base, `that many cards plus ${numWord(b)}`);
      }
      // FAST4 T26: "draw X cards, where X is the number of differently named lands you control" (CR 107.3, 608.2h): a count of distinct qualities
      // FAST5 T58: ... and "draw a card for each color among other artifacts you control" (CR 105.1; render/qty.ts#countParts)
      if (typeof s.count === 'object' && s.count.q === 'distinct') {
        const each = countParts(s.count, st);
        return alt(base, `X cards, where X is ${K.qty(s.count, st)}`, ...(each ? [`a card for each ${each.singular}`] : []));
      }
      // FAST2 T8: the amount of the triggering event ("whenever ~ is dealt damage, draw that many cards"; design 3.5 `eventAmount`, CR 603.2)
      if (typeof s.count === 'object' && s.count.q === 'eventAmount') return alt(base, 'that many cards');
      // FAST2 T8: "at the beginning of each player's draw step, that player draws an additional card": a card besides the one drawn for the turn (CR 504.1)
      if (s.count === 1 && st.trigger?.some((e) => e.ev === 'step' && e.step === 'draw') === true) return alt(base, 'an additional card');
      const per = typeof s.count === 'object' ? countParts(s.count, st) : null;
      // r4-fxz (CR 107.3, 608.2h): a computed number is also "draw X cards, where X is ..." (as discard says it, FAST4 T34; from the state before the amount)
      // std-re (CR 608.2c, 608.2h): and a count of a description of what an earlier instruction moved ("draw X cards, where X is the number of cards discarded this
      // way", Cloud C7's `which`); a bare result count stays "that many cards" (above)
      const counted = typeof s.count === 'object' && (s.count.q !== 'resultCount' || s.count.which !== undefined);
      const xForm = typeof s.count === 'object' && isComputed(s.count) && counted ? `X cards, where X is ${K.qty(s.count, beforePer ?? cloneState(st))}` : null;
      if (xForm !== null) markX(s.count, st);
      // r4-fxz (CR 107.1a): "draw half X cards, rounded down": half a number, the rounding said after the cards (as std-misc's token count)
      const c = s.count;
      const half = typeof c === 'object' && c.q === 'math' && (c.op === 'floorDiv' || c.op === 'ceilDiv') && c.args.length === 2 && c.args[1] === 2
        ? `half ${K.qty(c.args[0] as Quantity, cloneState(st))} cards, rounded ${c.op === 'ceilDiv' ? 'up' : 'down'}` : null;
      // r3-refs (CR 504.1, 121.1): "At the beginning of your draw step, draw an additional card for each opponent who has one or fewer cards in hand" (as FAST2 T8's one card)
      const extra = per && st.trigger?.some((e) => e.ev === 'step' && e.step === 'draw') === true ? [`an additional card for each ${per.singular}`] : [];
      // r4-fxz (CR 107.3, 608.2h): a computed number is also "draw X cards, where X is ..." (as discard says it, FAST4 T34); r4-refs: for a count of the turn's
      // history ("... the number of cards that were put into target player's graveyard from their library this turn") it is read on the copy of the state from
      // before the amount was said (beforePer), so every reading names things first (wave 7 merge: one "X cards, where X is" form for both lines)
      const firsts = per && beforeBase !== null ? perForms(c as Quantity, st, beforeBase).filter((x) => x !== per.singular).map((x) => `a card for each ${x}`) : [];
      const forms = [...(per ? [`a card for each ${per.singular}`, ...firsts, ...extra] : []), ...(xForm !== null ? [xForm] : []), ...(half !== null ? [half] : [])];
      return forms.length > 0 ? alt(base, ...forms) : base;
    });
    // FAST4 T26: the cards drawn, for a later "discard one of them" (CR 121.2, 608.2c; effects/handlers/cards-draw.ts binds exactly the cards drawn)
    if (s.as !== undefined) bind(st, s.as, { nouns: ['card'], plural: !(typeof s.count === 'number' && s.count === 1), zone: 'hand' });
    // FAST5X E15: "the number of cards drawn this way" (render/qty.ts, resultCount; CR 121.2, 608.2c)
    if (s.as !== undefined) st.info.set(`r:${s.as}`, { nouns: ['card'], plural: true, thisWay: 'drawn this way' });
    // FAST5 T61 (CR 608.2c): after an instruction that stands alone ("Surveil 3 if you have no cards in hand."), a draw may begin "Then draw three cards."
    return { ...c, leadThen: true };
  },

  discard: (s: StepOf<'discard'>, st: RenderState): Clause => {
    // r5-moved (CR 608.2c, 120.3, 701.9a; template eff.r5moved.dealtThisWay.playerDiscards): "If a player is dealt damage this way, they discard a card": the players among
    // what the damage step right before dealt damage to (render/steps-life.ts marks its binding "dealt damage this way"); nobody discards when no player was dealt damage
    if (s.who.ref === 'bound' && st.info.get(`b:${s.who.name}`)?.thisWay === 'dealt damage this way' && s.filter === undefined && s.mode === undefined && s.as === undefined && typeof s.count === 'number' && s.count >= 1) {
      return plain(`if a player is dealt damage this way, they discard ${countedNoun(s.count, 'card', st)}`, { standalone: true });
    }
    const c = byPlayer(s.who, st, 'discard', () => {
      // FAST1 T6: "each player discards their hand" (each one discards their own hand, CR 701.9a); "each player's hand" is not Oracle wording;
      // "discard all the cards in your hand" is the same as "discard your hand"
      if (s.count === 'hand') {
        const poss = s.who.ref === 'each' ? 'their' : K.player(s.who, st, 'possessive').text;
        return alt(`${poss} hand`, `all the cards in ${poss} hand`);
      }
      const f = s.filter;
      // CLOUD std-otj (family half-of-own; CR 701.9a, 107.1a): "target opponent discards half the cards in their hand, rounded up"
      const halfHand = f === undefined && s.mode === undefined && s.who.ref !== 'you' ? halfOfOwn(s.count, 'hand', s.who) : null;
      if (halfHand !== null) return `half the cards in ${K.player(s.who, st, 'possessive').text} hand, rounded ${halfHand}`;
      // FAST4 T26: "draw two cards, then discard one of them": a number of the cards an earlier step of this ability bound, and nothing else (CR 701.9b)
      const among = f !== undefined && Object.keys(f).length === 1 && f.is?.ref === 'bound' ? f.is : undefined;
      if (among !== undefined && typeof s.count === 'number' && s.count >= 1 && s.mode === undefined && st.info.has(`b:${among.name}`)) {
        const them = K.obj(among, st, 'object');
        if (them.plural) return `${numWord(s.count)} of ${them.text}`;
        // FAST5 T46 (CR 701.9a): "That player discards that card": the one card an earlier step of this ability chose in their hand
        if (s.count === 1 && st.info.get(`b:${among.name}`)?.hand !== true) return them.text;
      }
      const hasFilter = f !== undefined && Object.values(f).some((v) => v !== undefined);
      // FAST4 T34 (CR 107.3, 608.2h): a computed number is also "discards X cards, where X is ..." (from the state before the amount, as the other reading)
      const fork = !hasFilter && s.mode === undefined && typeof s.count === 'object' && isComputed(s.count) && s.count.q !== 'eventAmount' && s.count.q !== 'resultCount' ? cloneState(st) : null;
      const xForm = fork !== null ? `X cards, where X is ${K.qty(s.count as Exclude<typeof s.count, number | 'hand'>, fork)}` : null;
      const what0 = hasFilter ? countedNp({ ...f!, zone: 'hand' }, s.count, st, { noZone: true }) : countedNoun(s.count, 'card', st);
      // CLOUD C8 (family discard-number-equal, CR 701.9a, 608.2h): ... and "discards a number of cards equal to the sacrificed creature's power" (one more reading of this group)
      const numberForm = fork !== null ? `a number of cards equal to ${K.qty(s.count as Exclude<typeof s.count, number | 'hand'>, cloneState(st))}` : null;
      const what = xForm !== null ? alt(what0, xForm, ...(numberForm !== null ? [numberForm] : [])) : what0;
      const how = s.mode === 'random' ? ' at random' : s.mode === 'opponentChooses' ? alt(' of your choice', ' of their choice') : '';
      return `${what}${how}`;
    });
    // FAST1 T6: the discarded cards, for a later "that many" (resultCount; CR 608.2c)
    // FAST4 T26: also "the number of cards discarded this way" (render/qty.ts, resultCount)
    if (s.as !== undefined) st.info.set(`r:${s.as}`, { nouns: ['card'], plural: true, thisWay: 'discarded this way', moved: 'discarded' }); // Cloud C7: `moved`
    // Cloud r3-moved (CR 701.9a, 608.2h; parser/lower/mentions.ts#producedBy): the one card one player discarded is "the discarded card" later
    if (s.as !== undefined && s.count === 1 && (s.who.ref === 'you' || s.who.ref === 'target') && s.mode === undefined) bind(st, s.as, { nouns: ['card'], plural: false, alts: ['the discarded card'] });
    bindCant(st, s.cantAs, s.who); // C6: "each opponent who can't"
    return c;
  },

  mill: (s: StepOf<'mill'>, st: RenderState): Clause => {
    // FAST4 T31 (CR 701.17c): the one card milled is a card in a graveyard ("Mill a card. You may play that card this turn"; parser/lower/mentions.ts)
    // std-ry6 (CR 701.17a, 608.2h; parser/lower/mentions.ts): ... and the one card ONE player milled is "the milled card" later ("draw cards equal to the milled card's
    // mana value"), as the discard step's "the discarded card"
    const one = s.who.ref === 'you' || s.who.ref === 'target';
    if (s.as !== undefined && s.count === 1) bind(st, s.as, { nouns: ['card'], plural: false, zone: 'graveyard', ...(one ? { alts: ['the milled card'] } : {}) });
    // std-tla (CR 701.17a, 608.2c): the milled cards are "milled this way" for a later description of them ("If a land card was milled this way, ...";
    // render/cond.ts#existsPhrase; parser/holes/cond.ts#milledThisWayCond). A key of its own: the name's other readings ("that card") stay as they were
    if (s.as !== undefined) st.info.set(`${MILLED_KEY}${s.as}`, { nouns: ['card'], plural: true });
    // Cloud C7 (CR 701.17a, 608.2c): a named mill reports the cards it put into a graveyard ("for each creature card put into your graveyard this way", render/moved.ts)
    if (s.as !== undefined) st.info.set(`r:${s.as}`, { nouns: ['card'], plural: true, thisWay: 'milled this way', moved: 'graveyard' });
    return byPlayer(s.who, st, 'mill', () => {
      if (!isComputed(s.count)) return countedNoun(s.count, 'card', st);
      // r4-dig (CR 701.17a, 608.2h): "that player mills that many cards" (the amount of the triggering event, or what an earlier step counted) is said
      // as the discard step says it ("that many cards"), never "X cards, where X is that much"
      const n = s.count;
      if (typeof n === 'object' && n.q === 'eventAmount') return alt(countedNoun(n, 'card', st), 'that many cards');
      if (typeof n === 'object' && n.q === 'resultCount' && n.which === undefined && st.info.has(`r:${n.step}`)) return alt(countedNoun(n, 'card', st), 'that many cards');
      // FAST4 T30 (CR 701.17a, 107.1a; family half-of-own): "target opponent mills half their library, rounded up"
      const half = halfOfOwn(s.count, 'library', s.who);
      if (half !== null) return `half ${K.player(s.who, st, 'possessive').text} library, rounded ${half}`;
      const v = K.qty(s.count, st);
      // cloud std-spm (CR 615.5): "prevent that damage and mill twice that many cards" (Angel of Suffering): twice the damage the prevention prevented
      const c = s.count;
      const twice = typeof c === 'object' && c.q === 'math' && c.op === '*' && c.args.length === 2 && c.args[0] === 2 && typeof c.args[1] === 'object' && c.args[1].q === 'preventedAmount';
      // r4-repl (CR 615.5): "prevent that damage and each opponent mills that many cards" (The Mindskinner): the damage the prevention prevented (family prevented-that-many)
      const same = typeof c === 'object' && c.q === 'preventedAmount';
      // p2-dig-1 (CR 701.17a, 107.3): "target player mills twice X cards" (Drown in Dreams): two times the X of the spell
      const twiceX = typeof c === 'object' && c.q === 'math' && c.op === '*' && c.args.length === 2 && c.args[0] === 2 && JSON.stringify(c.args[1]) === '{"q":"X"}';
      return alt(`X cards, where X is ${v}`, `cards equal to ${v}`, ...(twice ? ['twice that many cards'] : []), ...(same ? ['that many cards'] : []), ...(twiceX ? ['twice X cards'] : []));
    });
  },
  // Cloud std-eoe (CR 406.1, 608.2c): "exile cards from the top of your library until you exile a nonland card"; the card it stopped at is "that card" (one card
  // in exile). std-rs: another player's, "target opponent exiles cards from the top of their library until they exile a nonland card"; after "each opponent
  // exiles ..." the cards it stopped at are several (model/focus.ts#namesOnePlayer)
  exileUntil: (s: StepOf<'exileUntil'>, st: RenderState): Clause => {
    // std-rx31 (CR 202.3, 608.2c): "until you exile cards with total mana value 4 or greater": every card exiled this way is the group named afterwards ("them");
    // only your own library is written
    if (s.total !== undefined) {
      if (Object.keys(s.filter).length > 0) throw new NoRenderer('a total of mana values of some of the cards exiled until');
      // std-exile-play-2-1 (CR 608.2c, 400.7): every card it exiled is also "cards exiled this way" (parser/lower/mentions.ts gives the step that participle)
      bind(st, s.as, { nouns: ['card'], plural: true, zone: 'exile', thisWay: 'exiled this way' });
      const total = `cards with total mana value ${K.qty(s.total.atLeast, st)} or greater`;
      if (s.who.ref === 'you') return byPlayer(s.who, st, 'exile', `cards from the top of your library until you exile ${total}`);
      // std-exile-play-2-1 (CR 101.4, 202.3, 608.2c): another player's, or each opponent's, each their own total ("Each opponent exiles cards from the top of their
      // library until they have exiled cards with total mana value 5 or greater this way", the handler's std-rs loop)
      return byPlayer(s.who, st, 'exile', `cards from the top of their library until they have exiled ${total} this way`);
    }
    const what = K.np({ ...s.filter, zone: 'library' }, st, { det: 'a', noZone: true }); // (a card in a library: the noun is "card"; the DiscardDesc hole's filter has no zone)
    // std-exile-play-1-1 (CR 400.7, 608.2c; family exiled-card-until): the one card it stopped at is also "the exiled card", or with its description, "the exiled nonland
    // card" (parser/holes/object.ts, the participle `exiled` with one card type)
    const one = namesOnePlayer(s.who);
    const desc = one ? K.np({ ...s.filter, zone: 'library' }, cloneState(st), { det: 'none', noZone: true }) : '';
    const exiledNames = one ? { alts: [...new Set(['the exiled card', `the exiled ${desc}`])] } : {};
    bind(st, s.as, { nouns: ['card'], plural: !one, zone: 'exile', ...exiledNames });
    if (s.who.ref === 'you') return byPlayer(s.who, st, 'exile', `cards from the top of your library until you exile ${what}`);
    return byPlayer(s.who, st, 'exile', `cards from the top of their library until they exile ${what}`);
  },
  // r3-dig (CR 701.20a, 608.2c): "reveal cards from the top of your library until you reveal a land card" ("... two land cards"); the cards it stopped at are
  // "that card" / "those land cards" (still in the library), every card revealed is the group whose rest the next instruction moves. Only your own library
  revealUntil: (s: StepOf<'revealUntil'>, st: RenderState): Clause => {
    if (s.who.ref !== 'you') throw new NoRenderer('"reveal cards from the top of ... library until ..." of another player');
    const c = s.count ?? 1;
    // Cloud r4-dig (CR 107.3, 608.2h): a computed count, "until you reveal X permanent cards, where X is the number of colors among permanents you control"
    const computed = typeof c === 'object' && isComputed(c) ? c : null;
    const n = computed !== null ? 2 : c; // (a computed count is said in the plural, as several cards)
    if (computed === null && (typeof n !== 'number' || !Number.isInteger(n) || n < 1)) throw new NoRenderer('"reveal ... until you reveal" a count that is not a positive number');
    const f = { ...s.filter, zone: 'library' as const };
    const plural = K.np(f, st, { det: 'none', plural: true, noZone: true });
    const what = computed !== null ? `X ${plural}, where X is ${K.qty(computed, cloneState(st))}` : n === 1 ? K.np(f, st, { det: 'a', noZone: true }) : `${numWord(n as number)} ${plural}`;
    const nouns = [...new Set([...K.nounsOf(s.filter), 'card'])];
    // "those land cards" for several cards of one card type (parser/holes/object.ts#typedThose)
    const typed = n !== 1 && Object.keys(s.filter).join(',') === 'types' && s.filter.types?.length === 1 ? [`those ${s.filter.types[0]!.toLowerCase()} cards`] : [];
    bind(st, s.as, { nouns, plural: n !== 1, zone: 'library', ...(typed.length > 0 ? { alts: typed } : {}) });
    bind(st, s.revealed, { nouns: ['card'], plural: true, zone: 'library' });
    return byPlayer(s.who, st, 'reveal', `cards from the top of your library until you reveal ${what}`);
  },
  // r5-fxz (CR 701.25a, 701.22a): a named scry or surveil reports the cards it left on top ("for each card you put on top of your library", render/moved.ts)
  scry: (s: StepOf<'scry'>, st: RenderState): Clause => {
    if (s.as !== undefined) st.info.set(`r:${s.as}`, { nouns: ['card'], plural: true, moved: 'top' });
    return byPlayer(s.who, st, 'scry', () => whereX(s.count, st));
  },
  surveil: (s: StepOf<'surveil'>, st: RenderState): Clause => {
    // r5-moved (CR 701.25a, 608.2c): the card a surveil 1 of yours put into your graveyard, "if you put a land card into your graveyard this way, put that card into your
    // hand" later (render/steps-zones.ts#surveilledToHand; the parser's participle-only mention `surveilled`, lower/mentions.ts). Merge wave 8: one entry with r5-fxz's
    // report of the cards left on top (`moved: 'top'`, the step result's `kept`); the binding itself is the card put into the graveyard (CR 701.25a)
    const one = s.count === 1 && s.who.ref === 'you';
    if (s.as !== undefined) st.info.set(`r:${s.as}`, { nouns: ['card'], plural: !one, moved: 'top', ...(one ? { thisWay: 'surveilled' as const } : {}) });
    return byPlayer(s.who, st, 'surveil', () => whereX(s.count, st));
  },

  reveal: (s: StepOf<'reveal'>, st: RenderState): Clause => {
    const c = byPlayer(s.who, st, 'reveal', () => {
      const what = refText(s.what, st);
      const to = s.to !== undefined && s.to !== 'all' ? ` to ${K.player(s.to, st, 'object').text}` : '';
      return `${what}${to}`;
    });
    const plural = s.what.ref === 'topCards' ? !(typeof s.what.count === 'number' && s.what.count === 1) : true;
    bind(st, s.as, { nouns: ['card'], plural, zone: s.what.ref === 'topCards' ? 'library' : undefined, ...(isHandOf(s.what) ? { hand: true } : {}), ...(s.what.ref === 'topCards' ? { revealedTop: true as const } : {}) });
    return c;
  },

  look: (s: StepOf<'look'>, st: RenderState): Clause => {
    // std-blb (CR 401.1): several top cards of your own library also read "look at twice X cards from the top of your library" (Stargaze)
    const fromTop = s.at.ref === 'topCards' && s.at.player.ref === 'you' && s.who.ref === 'you' && !(typeof s.at.count === 'number' && s.at.count === 1)
      ? `at ${K.qty(s.at.count, cloneState(st))} cards from the top of your library` : null;
    const c = byPlayer(s.who, st, 'look', () => (fromTop !== null ? alt(`at ${refText(s.at, st)}`, fromTop) : `at ${refText(s.at, st)}`));
    const plural = s.at.ref === 'topCards' ? !(typeof s.at.count === 'number' && s.at.count === 1) : true;
    bind(st, s.as, { nouns: ['card'], plural, zone: s.at.ref === 'topCards' ? 'library' : undefined, ...(isHandOf(s.at) ? { hand: true } : {}) });
    return c;
  },

  search: (s: StepOf<'search'>, st: RenderState): Clause => {
    const c = byPlayer(s.who, st, 'search', () => {
      const owner = s.owner ?? s.who;
      const poss = K.player(owner, st, 'possessive').text;
      const f = { ...s.filter, zone: s.zone } as ObjectFilter;
      let what: string;
      // r3-refs (CR 701.23a, 201.2): "for a card named A and/or a card named B": up to one card of each name, so up to two cards with different names
      const named = twoNames(s);
      // r4-dig (CR 205.3i, 305.6): "for a land card with a basic land type": a land card with one of the five basic land types (the filter the parser writes,
      // parser/templates/zz-cloud/r4-dig.json); said in those words only
      const basicType = s.max === 1 && Object.keys(s.filter).length === 2 && s.filter.types?.length === 1 && s.filter.types[0] === 'Land'
        && s.filter.subtypes !== undefined && [...s.filter.subtypes].sort().join(' ') === [...BASIC_LAND_TYPES].sort().join(' ');
      if (named !== null) what = `a card named ${named[0]} and/or a card named ${named[1]}`;
      else if (basicType) {
        what = 'a land card with a basic land type';
      } else if (s.max === 1) {
        what = K.np(f, st, { det: 'a', noZone: true });
        // CLOUD C9 (CR 701.23d): "for any card" is "for a card" (no stated quality; Demonic Counsel)
        if (Object.keys(s.filter).length === 0 && (s.min === undefined || s.min === 1)) what = alt(what, 'any card');
        // r4-dig (CR 201.2, 701.23a): "for a card named Island or Forest": a card with one of the names (a filter that is only names, `anyOf`)
        const names = Object.keys(s.filter).length === 1 && s.filter.anyOf !== undefined && s.filter.anyOf.length >= 2
          && s.filter.anyOf.every((g) => Object.keys(g).length === 1 && typeof g.name === 'string') ? s.filter.anyOf.map((g) => g.name!) : null;
        if (names !== null) what = alt(what, `a card named ${joinList(names, 'or')}`);
        // r4-dig (CR 701.23a): one card of either of two descriptions, each with its own article, "for a Plains card or a Cave card"
        const parts = names === null && Object.keys(s.filter).length === 1 && s.filter.anyOf?.length === 2 ? s.filter.anyOf : null;
        if (parts !== null) what = alt(what, parts.map((g) => K.np({ ...g, zone: s.zone } as ObjectFilter, cloneState(st), { det: 'a', noZone: true })).join(' or '));
      } else {
        const rw = rangeWords(s.min ?? 0, s.max, st);
        what = K.np(f, st, { det: 'none', plural: true, count: rw.count, noZone: true, ...(s.differentNames === true ? { differentNames: true } : {}) });
      }
      // CLOUD C9 (CR 701.23a): "for a basic land card and a Shrine card": one card of each further description (`and`, only with max 1)
      if (s.and !== undefined) {
        if (s.max !== 1 || s.min !== undefined || s.differentNames !== undefined || s.and.length === 0 || (s.alsoZones !== undefined && s.alsoZones.length > 0)) throw new NoRenderer('a search for several descriptions with a count');
        // std-re (CR 701.23a): three descriptions are a list, "for a black card, a green card, and a blue card"
        what = joinList([what, ...s.and.map((g) => K.np({ ...g, zone: s.zone } as ObjectFilter, st, { det: 'a', noZone: true }))], 'and');
      }
      // CLOUD std-dft (CR 701.23a): "your library and/or graveyard", "your graveyard, hand, and/or library": the zones the searcher may search, in the printed order
      // (r3-refs: Oracle also prints the list of three without the serial comma, "your graveyard, hand and/or library")
      if (s.allZones === true) throw new NoRenderer('a search of every zone listed ("graveyard, hand, and library") outside its fold (render/fold-r4refs.ts)'); // r4-refs
      const listed = [s.zone, ...(s.alsoZones ?? [])];
      const zones = s.alsoZones !== undefined && s.alsoZones.length > 0
        ? (listed.length >= 3 ? alt(joinList(listed, 'and/or'), `${listed.slice(0, -1).join(', ')} and/or ${listed[listed.length - 1]}`) : joinList(listed, 'and/or')) : s.zone;
      let text = `${poss} ${zones} for ${what}`;
      const plural = s.max !== 1 || s.and !== undefined;
      // FAST3 T17: "reveal that card" names the card just found, as "reveal it" does (CR 701.20a, 701.23a: the search is its only antecedent)
      if (s.reveal === true) text += `${alt(', reveal', ' and reveal')} ${plural ? alt('them', 'those cards') : alt('it', 'that card')}`; // FAST5 T75: "search your library for up to two Forest cards and reveal them" (Flourishing Bloom-Kin); std-hob: "reveal those cards" names the found cards as "reveal them" does (CR 701.20a, 701.23a; Cultivate); r3-refs: one card too, "search your library for a creature or land card and reveal it"
      // FAST5X-4 (CR 107.3, 608.2h): "for up to X basic land cards, where X is your speed": a computed maximum is also written with its "where X is" clause
      else if ((s.min ?? 0) === 0 && typeof s.max === 'object' && isComputed(s.max)) {
        const upToX = K.np(f, st, { det: 'none', plural: true, count: 'up to X', noZone: true });
        // FAST5 T74 (CR 701.23b, 608.2h): "for that many basic land cards": a hidden zone searched for a stated quality is searched for AT MOST that many (the searcher
        // may find fewer), so "up to that many" and "that many" are one search; the number is the amount of the event or the cards an earlier step moved
        const thatMany = s.max.q === 'eventAmount' || (s.max.q === 'resultCount' && st.info.has(`r:${s.max.step}`)) ? [`${poss} ${s.zone} for ${K.np(f, st, { det: 'none', plural: true, count: 'that many', noZone: true })}`] : [];
        return alt(text, `${poss} ${s.zone} for ${upToX}, where X is ${K.qty(s.max, st)}`, ...thatMany);
      }
      return text;
    }, s.reveal === true && s.max === 1 ? { serial: true } : {}); // CLOUD std-dft: "search ... for a card, reveal it, and put it into your hand" (Clause.serial)
    // FAST5 T61 (CR 701.23a): the found card is also what its description says (the parser's mention carries the filter's nouns, lower/mentions.ts): "untap that land"
    // CLOUD std-dft: a card found in one of several zones, one of them a library, is "put" where it goes ("put it into your hand", "put it onto the battlefield"),
    // as a card found in a library is: Oracle's words for these searches (the zone is only the renderer's choice of verb, CR 701.23a)
    const many = s.alsoZones !== undefined && s.alsoZones.length > 0;
    const zone = !many ? s.zone : [s.zone, ...s.alsoZones!].includes('library') ? 'library' : undefined;
    bind(st, s.as, { nouns: [...new Set(['card', ...K.nounsOf(s.filter), ...(s.and ?? []).flatMap((g) => K.nounsOf(g))])], plural: s.max !== 1 || s.and !== undefined, optional: true, ...(zone !== undefined ? { zone } : {}),
      // r5-moved (CR 701.23a, 603.12): a search of your own library by you is also "you search your library this way" later (render/cond.ts, render/steps-lasting.ts#reflexive)
      ...(s.who.ref === 'you' && s.zone === 'library' && s.owner === undefined && !many ? { searched: true as const } : {}) });
    return c;
  },

  shuffle: (s: StepOf<'shuffle'>, st: RenderState): Clause => {
    // CLOUD std-dft (CR 701.23a, 701.24a): "If you search your library this way, shuffle." (only the library a search of this resolution searched)
    if (s.ifSearched === true) {
      if (s.who.ref !== 'you') throw new NoRenderer('"if <player> searches their library this way, shuffle" for another player');
      return plain('if you search your library this way, shuffle', { standalone: true });
    }
    const subj = K.player(s.who, st, 'subject');
    const saved = st.actor;
    st.actor = playerKey(s.who);
    const lib = `${K.player(s.who, st, 'possessive').text} library`;
    st.actor = saved;
    const verb = alt('shuffle', `shuffle ${lib}`);
    // p2-dig-1 (CR 608.2d): the "have ... do" form inside the controller's "may", "you may have that player shuffle" (steps-flow.ts#mayClause)
    return acting(playerKey(s.who) ?? 'x', verb, alt(`${subj.text} ${conj('shuffle', subj.person)}`, `${subj.text} ${conj('shuffle', subj.person)} ${lib}`), { leadThen: true, have: `${subj.text} ${verb}` }); // CLOUD std-fra: Oracle also begins the sentence "Then shuffle." (CR 608.2c)
  },

  piles: (s: StepOf<'piles'>, st: RenderState): Clause => {
    bind(st, s.chosen, { nouns: ['pile'], plural: false, alts: ['one pile', 'the chosen pile'] });
    bind(st, s.other, { nouns: ['pile'], plural: false, alts: ['the other pile', 'the other'] });
    const cards = K.obj(s.cards, st, 'object').text;
    const sep = byPlayer(s.separator, st, 'separate', `${cards} into two piles`);
    const chooserKey = playerKey(s.chooser);
    if (chooserKey === 'you' || chooserKey === null) return { ...sep };
    const ch = byPlayer(s.chooser, st, 'choose', 'one of those piles');
    const text = `${sep.sub}. ${ch.sub}`;
    return acting(sep.actor ?? 'x', text, text, { standalone: true });
  },

  addMana: (s: StepOf<'addMana'>, st: RenderState): Clause => {
    if ((s.units === undefined) === (s.dynamic === undefined)) throw new NoRenderer('addMana needs exactly one of units and dynamic');
    // std-copy-3 (CR 106.6, 603.2): "Add {R}. When that mana is spent to cast a red instant or sorcery spell, copy that spell ..." (`whenSpent`), only after fixed mana of
    // your own with nothing else said of it; inside, "that spell" is the spell cast (the trigger's `cast` event, as for a delayed trigger)
    if (s.whenSpent !== undefined) {
      if (s.units === undefined || s.who.ref !== 'you' || s.restriction !== undefined || s.keep !== undefined) throw new NoRenderer('"when that mana is spent" after mana other than fixed mana of your own');
      const whenSpent = s.whenSpent;
      const units = s.units;
      const c = byPlayer(s.who, st, 'add', () => manaUnits(units));
      const ev = K.events([{ ev: 'cast', player: 'you', spell: whenSpent.spells }], st, 'present');
      if (!ev.startsWith('you cast ')) throw new NoRenderer('the spells of "when that mana is spent to cast"');
      const saved = st.trigger;
      st.trigger = [{ ev: 'cast', player: 'you', spell: whenSpent.spells }];
      let body: string;
      try {
        markTriggerRoles(st);
        body = K.steps(whenSpent.do, st, { nested: true });
      } finally {
        st.trigger = saved;
      }
      const t = `. when that mana is spent to cast ${ev.slice('you cast '.length)}, ${body}`;
      return acting(c.actor ?? 'you', `${c.imp}${t}`, `${c.sub}${t}`, { standalone: true });
    }
    // FAST1 T4: "add an additional {G}" (a triggered mana ability, CR 605.1b) adds the same mana as "add {G}": the word only says it comes on top of the mana that
    // triggered it
    // FAST5 T48 (CR 105.1, 106.4): "For each color among permanents you control, add one mana of that color" starts with the sentence's own "for each"
    // p2-mana-2 (CR 700.5, 106.1): "Choose a color. Add an amount of mana of that color equal to your devotion to that color." (its own sentences)
    if (s.dynamic?.kind === 'devotionColor') {
      if (s.who.ref !== 'you' || s.dynamic.of.ref !== 'you' || s.restriction || s.rider || s.keep) throw new NoRenderer('devotion mana of another player, or with a rider');
      const body = 'choose a color. add an amount of mana of that color equal to your devotion to that color';
      return acting('you', body, 'you choose a color. you add an amount of mana of that color equal to your devotion to that color', { standalone: true });
    }
    if (s.dynamic?.kind === 'eachColorAmong' && s.who.ref === 'you') {
      // std-craft-1 (CR 702.167c, 105.1): also among the cards a craft cost exiled, "for each color among the exiled cards used to craft this creature" (Sunbird Effigy)
      const linked = s.dynamic.among.ref === 'linked' && s.dynamic.among.link === 'craft';
      if (s.rider) throw new NoRenderer('a mana rider on mana of each color among objects');
      if (s.dynamic.among.ref !== 'each' && !linked) throw new NoRenderer('the colors among objects other than a group');
      const among = s.dynamic.among.ref === 'each' ? K.np(s.dynamic.among.filter, st, { det: 'none', plural: true }) : K.obj(s.dynamic.among, st, 'object').text;
      const body = `for each color among ${among}, add one mana of that color`;
      const sub = `for each color among ${among}, you add one mana of that color`;
      const c0 = acting('you', body, sub, { standalone: true });
      if (!s.restriction) return c0;
      const extra = restrictionText(s.restriction, st);
      return acting('you', `${body}. ${extra}`, `${sub}. ${extra}`, { standalone: true });
    }
    const c = byPlayer(s.who, st, 'add', () => {
      const what = s.units !== undefined ? manaUnits(s.units) : manaDynamic(s.dynamic!, st);
      return alt(what, `an additional ${what}`);
    });
    // r4-cost (CR 106.1, 106.4; parser/lower/ability.ts#joinChooseColor): X mana of any one color is also "choose a color. add an amount of mana of that color equal to
    // <X>" and, for the different powers among a group, "choose a color. add one mana of that color for each different power among <group>"
    const d = s.dynamic;
    if (d?.kind === 'anyOneColor' && d.from === undefined && s.who.ref === 'you' && !s.restriction && !s.rider && s.keep === undefined && typeof d.count === 'object' && d.count.q !== 'X') {
      const powers = d.count.q === 'distinct' && d.count.what === 'powers' && d.count.among.ref === 'each' ? K.np(d.count.among.filter, st, { det: 'none', plural: true }) : null;
      const chosen = [`choose a color. add an amount of mana of that color equal to ${K.qty(d.count, st)}`, ...(powers !== null ? [`choose a color. add one mana of that color for each different power among ${powers}`] : [])];
      return acting(c.actor ?? 'you', alt(c.imp, ...chosen), alt(c.sub, ...chosen), { standalone: true });
    }
    // std-mkm (CR 500.5, 106.4): "Until end of turn, you don't lose this mana as steps and phases end" (and firebending's "until end of combat ... as steps end"),
    // said after the instruction (and after its spending restriction)
    const kept = s.keep === undefined ? '' : s.who.ref !== 'you' ? null
      : s.keep === 'endOfTurn' ? ". until end of turn, you don't lose this mana as steps and phases end" : ". until end of combat, you don't lose this mana as steps end";
    if (kept === null) throw new NoRenderer('mana another player keeps until a duration ends');
    const rid = s.rider ? `. ${riderText(s.rider, st)}` : ''; // std-mana-1
    if (!s.restriction) return kept === '' && rid === '' ? c : acting(c.actor ?? 'x', `${c.imp}${rid}${kept}`, `${c.sub}${rid}${kept}`, { standalone: true });
    const extra = restrictionText(s.restriction, st);
    return acting(c.actor ?? 'x', `${c.imp}. ${extra}${rid}${kept}`, `${c.sub}. ${extra}${rid}${kept}`, { standalone: true });
  },
};
