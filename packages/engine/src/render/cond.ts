/**
 * Conditions as clauses (WP2): "you control a creature", "~ is tapped", "it's your turn", "~ was kicked", "you do". No leading "if"/"as long as":
 * the frame that holds the condition adds it.
 */
import type { Cmp, Condition, ObjectFilter, ObjRef, PlayerRef, Quantity } from '../types/ability';
import type { Color } from '../types/mana';
import { K } from './kernel';
import { distinctParts, excessRecipient, scopeWords, sizeVsWords, spentObjectText } from './qty';
import { isRoomsOnly } from '../model/room-filter';
import { isOpponentSpellsPerPlayer } from '../model/forms';
import { possessiveStep, STEP_NAME, turnOf } from './turn';
import { costMovedOr, movedAtLeastPhrase, movedCondPhrase } from './moved';
import { isPlayerRef } from './refs';
import { p2iv1CondPhrase } from './p2iv1';
import { p2iv3AllAny, p2iv3Moved } from './p2iv3';
import { MILLED_KEY, cloneState, withVariants, type RenderState } from './state';
import { alt, ALT_OPEN, ALT_SEP, COLOR_WORD, joinList, numWord, NoRenderer, ordinal, parseMarked, pluralize, withArticle } from './text';

const INVERT: Record<Cmp, Cmp> = { '<=': '>', '>=': '<', '==': '!=', '!=': '==', '<': '>=', '>': '<=' };

/** p2-counters-state-1 (CR 702.33f): the printed cost of the face's kicker cost named `name` ("kicker", "kicker:2"), when the face prints two or more. */
function kickerCost(name: string, st: RenderState): string | undefined {
  const costs = st.ctx.kickerCosts ?? [];
  if (costs.length < 2) return undefined;
  const m = /^kicker(?::(\d+))?$/.exec(name);
  return m === null ? undefined : costs[m[1] === undefined ? 0 : Number(m[1]) - 1];
}

function cmpWords(op: Cmp, right: string): string {
  switch (op) {
    // r4-dig (family or-less-written-out): also written out, "if its mana value is less than or equal to the number of cards in your graveyard" (Quag Feast)
    case '>=': return alt(`${right} or greater`, `${right} or more`, `greater than or equal to ${right}`);
    case '<=': return alt(`${right} or less`, `${right} or fewer`, `less than or equal to ${right}`);
    case '==': return alt(right, `exactly ${right}`); // r4-fxb (family exactly-number): "if its power is exactly 20" (CR 208.1)
    case '!=': return `not ${right}`;
    case '<': return `less than ${right}`;
    case '>': return `greater than ${right}`;
  }
}

/** "you control" / "an opponent controls" / "target player controls". Null when the filter names no controller. */
function controls(f: ObjectFilter, st: RenderState): string | null {
  const c = f.controller;
  if (c === undefined || c === 'any') return null;
  if (c === 'you') return 'you control';
  if (c === 'opponent') return 'an opponent controls';
  return `${K.player(c as PlayerRef, st, 'subject').text} controls`;
}

/** M11-4: the filter of "~ is in the command zone or on the battlefield": the source object itself, in exactly those two zones (any order). */
export function isEminence(f: ObjectFilter): boolean {
  const keys = Object.keys(f).filter((k) => f[k as keyof ObjectFilter] !== undefined).sort().join(',');
  const zs = Array.isArray(f.zone) ? [...f.zone].sort().join(',') : '';
  return keys === 'self,zone' && f.self === true && zs === 'battlefield,command';
}

/**
 * r4-repl (CR 608.2c; parser/holes/cond.ts#twoCardsInOneZone): "there is an instant card and a sorcery card in your graveyard": two `exists` of one card each in the
 * same zone (not the battlefield, no controller), the zone said once after the second card. Null for any other pair.
 */
function twoCardsInOneZone(of: readonly Condition[], st: RenderState): string | null {
  if (of.length !== 2) return null;
  const fs = of.map((x) => (x.cond === 'exists' && x.atLeast === undefined && x.of.ref === 'each' && 'filter' in x.of ? x.of.filter : null));
  const [a, b] = fs;
  if (a == null || b == null || a.zone === undefined || a.zone === 'battlefield' || a.zone !== b.zone || JSON.stringify(a.owner) !== JSON.stringify(b.owner) || a.controller !== undefined || b.controller !== undefined) return null;
  const first = K.np(a, st, { det: 'a', noZone: true });
  const second = K.np(b, st, { det: 'a' });
  return `there is ${first} and ${second}`;
}

/** `oneOpponent` (opp-port-1): the permanents counted are one opponent's own (`countPlayers.controlsIs`), not every opponent's together. */
function existsPhrase(of: ObjRef,atLeast: Parameters<typeof K.qty>[0] | undefined, negate: boolean, st: RenderState, oneOpponent = false): string {
  if (of.ref !== 'each') {
    const o = K.obj(of, st, 'subject');
    return `${o.text} ${negate ? "isn't" : 'is'} still on the battlefield`;
  }
  const f = of.filter;
  // M11-4 (eminence, CR 113.6b): "~ is in the command zone or on the battlefield" (parser/holes/cond.ts#EMINENCE_COND): the source itself in one of the two
  if (isEminence(f)) {
    if (negate || atLeast !== undefined) throw new NoRenderer('a negated or counted "in the command zone or on the battlefield"');
    return `${K.obj({ ref: 'self' }, st, 'subject').text} is in the command zone or on the battlefield`;
  }
  // FAST4 T29: "~ is equipped" is "an Equipment is attached to ~" (CR 301.5: an Equipment attached to a creature equips it); nothing else in the filter
  const keys = Object.keys(f).filter((k) => f[k as keyof ObjectFilter] !== undefined);
  if (!negate && atLeast === undefined && f.attachedToObject !== undefined && keys.length === 2 && f.subtypes?.length === 1 && f.subtypes[0] === 'Equipment') {
    return `${K.obj(f.attachedToObject, st, 'subject').text} is equipped`;
  }
  // std-tla (CR 701.17a, 608.2c; parser/holes/cond.ts#milledThisWayCond; family milled-this-way-cond): "a Lesson card is milled this way", "... was milled this way",
  // "at least one Zombie card is milled this way": one of the cards a mill step put into a graveyard (named "milled this way" by render/fold.ts) matches the description
  const milledGroup = f.is !== undefined && f.is.ref === 'bound' && st.info.has(`${MILLED_KEY}${f.is.name}`);
  if (!negate && atLeast === undefined && milledGroup && f.zone === 'any' && f.anyOf === undefined) {
    const { is: _is, zone: _zone, ...rest } = f;
    if (!Object.values(rest).some((v) => v !== undefined)) throw new NoRenderer('"milled this way" without a description');
    const one = K.np({ ...rest, zone: 'graveyard' }, st, { det: 'a', noZone: true });
    const bare = K.np({ ...rest, zone: 'graveyard' }, st, { det: 'none', noZone: true });
    return alt(`${one} is milled this way`, `${one} was milled this way`, `at least one ${bare} is milled this way`, `at least one ${bare} was milled this way`);
  }
  // CMD2 (CR 903.3d): "you control a commander that's a creature or planeswalker" (parser/holes/cond.ts#commanderThatsTypes): two or more card types of a commander
  if (!negate && atLeast === undefined && f.commander === true && f.controller === 'you' && (f.types?.length ?? 0) >= 2 && keys.every((k) => k === 'commander' || k === 'controller' || k === 'types')) {
    return `you control a commander that's ${joinList(f.types!.map((t) => withArticle(t.toLowerCase())), 'or').replace(/ or an? /, ' or ')}`;
  }
  // opp-port-1 (OPP1 and OPP2 of 2026-10-17; CR 102.3, 806): every opponent's permanents counted together, or no opponent controlling one, is what "your
  // opponents control" says; "an opponent controls two or more creatures" and "an opponent controls no creatures" are one opponent's own (`oneOpponent`).
  // Existence (one or more) is the same either way.
  const countedMany = atLeast !== undefined && !(typeof atLeast === 'number' && atLeast === 1);
  const ctrl = f.controller === 'opponent' && (countedMany || negate) && !oneOpponent ? 'your opponents control' : controls(f, st);
  const zoneBf = f.zone === undefined || f.zone === 'battlefield';
  const body = (count: string | undefined, plural: boolean): string => K.np(f, st, { det: count === undefined ? 'a' : 'none', plural, count, noController: ctrl !== null });
  if (negate) {
    const none = K.np(f, st, { det: 'none', plural: true, noController: ctrl !== null });
    // not(exists atLeast N) is "fewer than N" (CR 603.4 style conditions count): "no" is only the case N = 1
    const few = atLeast !== undefined && !(typeof atLeast === 'number' && atLeast === 1);
    const n = typeof atLeast === 'number' ? numWord(atLeast) : atLeast === undefined ? '' : K.qty(atLeast, st);
    const amount = few ? `fewer than ${n}` : 'no';
    // MX3 (family dont-control-a): "you don't control a Ring-bearer" is "you control no Ring-bearers" (not one such permanent, CR 603.4 style)
    if (ctrl === 'you control' && !few) return alt(`${ctrl} ${amount} ${none}`, `you don't control ${body(undefined, false)}`);
    // opp-port-1 (family no-opponent-controls-a): "your opponents control no creatures" is also "no opponent controls a creature" (Vexing Beetle, CR 102.3)
    if (ctrl === 'your opponents control' && !few) return alt(`${ctrl} ${amount} ${none}`, `no opponent controls ${body(undefined, false)}`);
    if (ctrl) return `${ctrl} ${amount} ${none}`;
    // std-tdm (CR 401.1; family library-no-cards-in-it): "there are no cards in your library" is also "your library has no cards in it"
    const ownLibrary = !few && f.zone === 'library' && f.owner === 'you' && f.isCard === true && keys.length === 3;
    if (ownLibrary) return alt(`there are ${amount} ${none}`, 'your library has no cards in it');
    // p2-intervening-1 (CR 603.4; parser/holes/p2iv1.ts): "no creatures are on the battlefield" is "there are no creatures on the battlefield"
    if (zoneBf && !few) return alt(`there are ${amount} ${none} on the battlefield`, `no ${none} are on the battlefield`);
    return zoneBf ? `there are ${amount} ${none} on the battlefield` : `there are ${amount} ${none}`;
  }
  let count: string | undefined;
  let plural = false;
  if (atLeast !== undefined && !(typeof atLeast === 'number' && atLeast === 1)) {
    count = typeof atLeast === 'number' ? `${numWord(atLeast)} or more` : `${K.qty(atLeast, st)} or more`;
    plural = true;
  }
  const phrase = body(count, plural);
  // FAST4 T23: an explicit minimum of one is also "you control one or more Eggs" (the same condition, CR 603.4)
  if (ctrl && typeof atLeast === 'number' && atLeast === 1) return alt(`${ctrl} ${phrase}`, `${ctrl} ${body('one or more', true)}`);
  // FAST4 T29: "you control an artifact creature or a Plan", one existence condition over two descriptions, each with its article (family either-exists)
  const either = f.anyOf;
  if (ctrl && count === undefined && either !== undefined && either.length === 2 && keys.length === 2 && either.every((g) => g.controller === undefined && g.anyOf === undefined)) {
    return alt(`${ctrl} ${phrase}`, `${ctrl} ${either.map((g) => K.np(g, st, { det: 'a' })).join(' or ')}`);
  }
  // FAST5 T62: "you control at least five other Forests" says "five or more" the other way round (CR 603.4)
  if (ctrl && count !== undefined && typeof atLeast === 'number') return alt(`${ctrl} ${phrase}`, `${ctrl} ${body(`at least ${numWord(atLeast)}`, true)}`);
  if (ctrl) return `${ctrl} ${phrase}`;
  // FAST5 T68 (CR 406.1, 108.3): a card in exile has an owner, not a controller: "you own a card in exile that has an Adventure"
  if (count === undefined && f.owner === 'you' && f.controller === undefined && f.zone === 'exile') return `you own ${K.np({ ...f, owner: undefined }, st, { det: 'a' })}`;
  // FAST3 T12: "any player controls a black permanent" is one such permanent on the battlefield (CR 110.2: every permanent has a controller); one object
  // only: "any player controls two or more ..." would count each player's permanents apart
  // Cloud std-woe (family exists-is-status): an attacking, blocking, tapped or untapped permanent is also said with the status after the noun, "a Rat is attacking"
  if (zoneBf && count === undefined && f.controller === undefined && f.owner === undefined) return alt(`there is ${phrase} on the battlefield`, `any player controls ${phrase}`, ...statusAfterNoun(f, st));
  // p2-cost-statics-1 (CR 506.4, 508.1; parser/holes/p2cst1.ts; family exists-counted-are-status): "three or more creatures are attacking" is "there are three or
  // more attacking creatures on the battlefield", the counted form of std-woe's "a Rat is attacking"
  const counted = zoneBf && count !== undefined && f.controller === undefined && f.owner === undefined ? countedStatusAfterNoun(f, count, st) : null;
  if (counted !== null) return alt(`there are ${phrase} on the battlefield`, counted);
  if (zoneBf) return `there ${plural ? 'are' : 'is'} ${phrase} on the battlefield`;
  // p2-intervening-1 (CR 404.1; parser/holes/p2iv1.ts): "you have four or more creature cards in your graveyard", "twenty or more creature cards are in your graveyard"
  if (count !== undefined && f.zone === 'graveyard' && f.owner === 'you' && f.controller === undefined) {
    const cards = K.np(f, st, { det: 'none', plural, count, noZone: true });
    // p2-coinflip-3 (CR 404.1, 602.5b; family at-least-cards-in-your-graveyard): "there are at least three Zombie creature cards in your graveyard" (Tomb Tyrant)
    const atLeastN = typeof atLeast === 'number' ? [`there are ${K.np(f, st, { det: 'none', plural, count: `at least ${numWord(atLeast)}`, noZone: true })} in your graveyard`] : [];
    return alt(`there ${plural ? 'are' : 'is'} ${phrase}`, `you have ${cards} in your graveyard`, `${cards} are in your graveyard`, ...atLeastN);
  }
  return `there ${plural ? 'are' : 'is'} ${phrase}`;
}

/**
 * p2-cost-statics-1 (CR 506.4, 508.1): "three or more creatures are attacking": N or more permanents of a description that are attacking, the status after the noun
 * (statusAfterNoun's counted form). Null for any other status, or a description with nothing but the status.
 */
function countedStatusAfterNoun(f: ObjectFilter, count: string, st: RenderState): string | null {
  if (f.attacking !== true || f.blocking !== undefined || f.tapped !== undefined) return null;
  const { attacking: _a, ...rest } = f;
  if (Object.values(rest).every((v) => v === undefined)) return null;
  return `${count} ${K.np(rest, st, { det: 'none', plural: true })} are attacking`;
}

/** p2-cost-statics-1 (CR 506.4; parser/holes/p2cst1.ts): "exactly one creature is attacking", the number of attacking creatures compared with one. */
function exactlyOneAttacking(c: Extract<Condition, { cond: 'compare' }>): boolean {
  const l = c.left;
  if (c.op !== '==' || c.right !== 1 || typeof l !== 'object' || l.q !== 'count' || l.of.ref !== 'each') return false;
  const f = l.of.filter;
  return f.attacking === true && f.types?.length === 1 && f.types[0] === 'Creature' && Object.keys(f).every((k) => k === 'attacking' || k === 'types');
}

/**
 * Cloud std-woe (CR 506.4, 701.26a; parser/holes/cond.ts#indefiniteStatus): "a Rat is attacking", "another creature is tapped": one permanent of the description
 * with one status, the status said after the noun. Empty when the filter has no status, several, or nothing else to name.
 */
function statusAfterNoun(f: ObjectFilter, st: RenderState): string[] {
  const statuses = [f.attacking, f.blocking, f.tapped].filter((v) => v !== undefined);
  if (statuses.length !== 1) return [];
  // r4-cost (CR 506.3; parser/holes/cost-conds.ts): "a creature is attacking you", the player it attacks after the status
  const attacked = typeof f.attacking === 'object' ? `attacking ${K.player(f.attacking.defender as PlayerRef, st, 'object').text}` : null;
  const word = attacked ?? (f.attacking === true ? 'attacking' : f.blocking === true ? 'blocking' : f.tapped === true ? 'tapped' : f.tapped === false ? 'untapped' : null);
  const { attacking: _a, blocking: _b, tapped: _t, ...rest } = f;
  if (word === null || Object.values(rest).every((v) => v === undefined)) return [];
  return [`${K.np(rest, st, { det: 'a' })} is ${word}`];
}

/** The fields of a filter that `predicates` words itself; everything else goes through the noun phrase (design 3.3: all present fields are ANDed). */
const PREDICATE_FIELDS: (keyof ObjectFilter)[] = [
  'tapped', 'attacking', 'blocking', 'blocked', 'token', 'faceDown', 'transformed', 'colors', 'colorless', 'multicolored', 'monocolored', 'keyword', 'notKeyword',
  'power', 'toughness', 'manaValue', 'counters', 'hasAbility', 'controller', 'self', 'isCopy', 'attached', 'enteredThisTurn', 'dealtDamageThisTurn', 'attackedThisTurn', 'blockedThisTurn',
  'solved', 'prepared', 'prototyped', 'flipped', // M6-0 (m6 design 2.1)
  'saddled', // FAST5X E3 (CR 702.171b)
  'suspected', // FAST5X E12 (CR 701.60b)
  'monstrous', // std-rx34 (CR 701.37b)
  'ringBearer', // MX3 (CR 701.54e)
  'modified', // cloud std-spm (CR 700.9): "as long as it's modified"
  'doubleFaced', // std-rx31 (CR 712.1): "if it's a double-faced card"
  'renowned', // std-ry8 (CR 702.112b)
  'attackingAlone', // p2-attack-block-1 (CR 506.5): "is attacking alone"
];

/** The predicate of a filter applied to one object: "tapped", "a creature", "red", "flying". */
/** FAST4 T34: the fields of a card whose noun phrase is said before "card" ("a land card", "a legendary Zombie card"). */
const CARD_NOUN_FIELDS: ReadonlySet<string> = new Set(['types', 'allTypes', 'subtypes', 'supertypes', 'isCard']);

/** Standard round 4, r4-trig: the object of `{anyOf: [{power > its power}, {toughness > its toughness}]}` (one object, both statistics), or null. */
export function greaterPowerOrToughness(f: ObjectFilter): ObjRef | null {
  const a = f.anyOf;
  if (a === undefined || a.length !== 2) return null;
  const [p, t] = a;
  const of = (x: ObjectFilter, stat: 'power' | 'toughness'): ObjRef | null => {
    const c = x[stat];
    if (Object.keys(x).length !== 1 || c === undefined || c.op !== '>' || typeof c.value !== 'object' || c.value.q !== 'stat' || c.value.stat !== stat || c.value.agg !== undefined) return null;
    return 'ref' in c.value.of ? (c.value.of as ObjRef) : null;
  };
  const po = of(p!, 'power');
  const to = of(t!, 'toughness');
  return po !== null && to !== null && JSON.stringify(po) === JSON.stringify(to) ? po : null;
}

/** std-rx12: the statistics a card noun phrase says after "with", in Oracle's order. */
const CARD_STATS = ['manaValue', 'power', 'toughness'] as const;
const CARD_STAT_WORDS: Readonly<Record<(typeof CARD_STATS)[number], string>> = { manaValue: 'mana value', power: 'power', toughness: 'toughness' };

/**
 * std-rx12 (CR 608.2h, 108.1, 202.3, 208.1; family card-with-stat): one known object that is a card of some types with a statistic compared with a number is "it is a
 * creature card with mana value 3 or less", one noun phrase, as well as predicate by predicate ("it has mana value 3 or less and is a creature card"): the same
 * filter, all its fields ANDed (design 3.3). Only the card noun fields and the statistics; null for anything else.
 */
function cardWithStats(f: ObjectFilter, subject: string, plural: boolean, st: RenderState): string | null {
  if (plural || f.isCard !== true) return null;
  const allowed = new Set<string>([...CARD_NOUN_FIELDS, ...CARD_STATS]);
  if (!Object.entries(f).every(([k, v]) => v === undefined || allowed.has(k))) return null;
  if ((f.types ?? []).length === 0 && (f.allTypes ?? []).length === 0 && (f.subtypes ?? []).length === 0) return null;
  const stats = CARD_STATS.filter((k) => f[k] !== undefined);
  if (stats.length === 0) return null;
  const noun: ObjectFilter = {};
  for (const k of ['types', 'allTypes', 'subtypes', 'supertypes'] as const) if (f[k] !== undefined) (noun as Record<string, unknown>)[k] = f[k];
  const withs = stats.map((k) => `${CARD_STAT_WORDS[k]} ${cmpWords(f[k]!.op, K.qty(f[k]!.value, st))}`);
  return `${subject} is ${K.np(noun, st, { det: 'a', plural: false, noController: true })} card with ${withs.join(' and ')}`;
}

function predicates(f: ObjectFilter, st: RenderState, plural: boolean): string[] {
  const out: string[] = [];
  const isA = plural ? 'are' : 'is';
  const has = plural ? 'have' : 'has';
  const was = plural ? 'were' : 'was';
  if (f.tapped === true) out.push(`${isA} tapped`);
  else if (f.tapped === false) out.push(`${isA} untapped`);
  if (f.attackingAlone === true) out.push(`${isA} attacking alone`); // p2-attack-block-1 (CR 506.5)
  if (f.attacking === true) out.push(`${isA} attacking`);
  else if (f.attacking === false) out.push(`${isA} nonattacking`);
  if (f.blocking === true) out.push(`${isA} blocking`);
  else if (f.blocking === false) out.push(`${isA} nonblocking`);
  if (f.blocked === true) out.push(`${isA} blocked`);
  else if (f.blocked === false) out.push(`${isA} unblocked`);
  if (f.token === true) out.push(`${isA} ${plural ? 'tokens' : 'a token'}`);
  if (f.token === false) out.push(`${isA} nontoken`);
  if (f.faceDown === true) out.push(`${isA} face down`);
  else if (f.faceDown === false) out.push(`${isA} face up`);
  if (f.transformed === true) out.push(`${isA} transformed`);
  else if (f.transformed === false) throw new NoRenderer('transformed:false has no wording');
  if (f.colors && f.colors.length > 0) out.push(`${isA} ${joinList(f.colors.map((c) => COLOR_WORD[c] ?? c), 'or')}`);
  if (f.colorless === true) out.push(`${isA} colorless`);
  else if (f.colorless === false) out.push(`${isA} colored`);
  if (f.multicolored === true) out.push(`${isA} multicolored`);
  else if (f.multicolored === false) out.push(`${isA} nonmulticolored`);
  if (f.monocolored === true) out.push(`${isA} monocolored`);
  else if (f.monocolored === false) throw new NoRenderer('monocolored:false has no wording');
  if (f.keyword !== undefined) out.push(`${has} ${[f.keyword].flat().join(' or ')}`);
  if (f.notKeyword !== undefined) out.push(`${has} no ${[f.notKeyword].flat().join(' or ')}`);
  if (f.power) out.push(`${has} power ${cmpWords(f.power.op, K.qty(f.power.value, st))}`);
  if (f.toughness) out.push(`${has} toughness ${cmpWords(f.toughness.op, K.qty(f.toughness.value, st))}`);
  if (f.manaValue) out.push(`${has} mana value ${cmpWords(f.manaValue.op, K.qty(f.manaValue.value, st))}`);
  if (f.counters) {
    const n = f.counters.cmp;
    // FAST4 T27: kind 'any' is "a counter" of any kind (CR 122.1)
    // FAST5X E21 (CR 122.1): "has no counters on it" (none of any kind); "a counter on it" is also "counters on it" and "one or more counters on it"
    if (f.counters.kind === 'any' && n !== undefined && n.op === '==' && n.value === 0) out.push(`${has} no counters on it`);
    // r4-static (CR 122.1): "has three or more counters on it": counters of any kind together (Warden of the Inner Sky)
    else if (f.counters.kind === 'any' && n !== undefined && (n.op === '>=' || n.op === '<=')) out.push(`${has} ${K.qty(n.value, st)} or ${n.op === '>=' ? 'more' : 'fewer'} counters on it`);
    // p2-counters-state-1 (CR 122.1): "has fewer than three counters on it", "more than ..." (a strict comparison of the count; counters are counted, so "fewer")
    else if (f.counters.kind === 'any' && n !== undefined && (n.op === '<' || n.op === '>')) out.push(`${has} ${n.op === '<' ? 'fewer' : 'more'} than ${K.qty(n.value, st)} counters on it`);
    else if (f.counters.kind === 'any' && n !== undefined) throw new NoRenderer('a counted number of counters of any kind');
    else if (f.counters.kind === 'any') out.push(alt(`${has} a counter on it`, `${has} counters on it`, `${has} one or more counters on it`));
    // std-lci (CR 122.1): none of one kind is "no time counters on it" (Temple of Cyclical Time)
    else if (n !== undefined && n.op === '==' && n.value === 0) out.push(`${has} no ${f.counters.kind} counters on it`);
    // p2-counters-state-1 (CR 122.1): "has fewer than three +1/+1 counters on it" (Runaway Steam-Kin's wording), "more than"; never a bare number for a strict comparison
    else if (n !== undefined && (n.op === '<' || n.op === '>')) out.push(`${has} ${n.op === '<' ? 'fewer' : 'more'} than ${K.qty(n.value, st)} ${f.counters.kind} counters on it`);
    else if (n !== undefined && n.op === '!=') throw new NoRenderer('a number of counters other than N');
    else out.push(n === undefined ? `${has} ${withArticle(`${f.counters.kind} counter`)} on it` : `${has} ${K.qty(n.value, st)} ${n.op === '>=' ? 'or more ' : n.op === '<=' ? 'or fewer ' : ''}${f.counters.kind} counters on it`);
  }
  if (f.hasAbility) out.push(`${has} ${withArticle(`${f.hasAbility} ability`)}`);
  // std-rx31 (CR 712.1, 712.4): having two faces is a property of the card, so Oracle says "card" even of a permanent ("If it's a double-faced card, you may transform it")
  if (f.doubleFaced === true) out.push(`${isA} ${plural ? 'double-faced cards' : 'a double-faced card'}`);
  else if (f.doubleFaced === false) throw new NoRenderer('doubleFaced:false has no wording');
  if (f.isCopy === true) out.push(`${isA} a copy`);
  else if (f.isCopy === false) throw new NoRenderer('isCopy:false has no wording');
  if (f.attached === true) out.push(`${isA} attached to a permanent`);
  else if (f.attached === false) out.push(`${isA} unattached`);
  // std-rx32 (CR 301.5, 303.4): "if it's attached to a creature you control" (Stolen Uniform): attached to one object of a description
  const ato = f.attachedToObject;
  if (ato !== undefined && ato.ref === 'each' && 'filter' in ato) out.push(`${isA} attached to ${K.np(ato.filter, st, { det: 'a' })}`);
  if (f.enteredThisTurn === true) out.push(alt('entered the battlefield this turn', 'entered this turn'));
  else if (f.enteredThisTurn === false) out.push(alt("didn't enter the battlefield this turn", "didn't enter this turn"));
  if (f.dealtDamageThisTurn === true) out.push(`${was} dealt damage this turn`);
  else if (f.dealtDamageThisTurn === false) out.push(`${plural ? "weren't" : "wasn't"} dealt damage this turn`);
  if (f.attackedThisTurn === true) out.push('attacked this turn');
  else if (f.attackedThisTurn === false) out.push("didn't attack this turn");
  if (f.blockedThisTurn === true) out.push('blocked this turn');
  else if (f.blockedThisTurn === false) out.push("didn't block this turn");
  // M6-0: designations and statuses (CR 719.3b, 722.3a, 718.3b, 710)
  for (const k of ['solved', 'prepared', 'prototyped', 'flipped', 'saddled', 'suspected', 'monstrous'] as const) { // std-rx34: monstrous (CR 701.37b)
    if (f[k] === true) out.push(`${isA} ${k}`);
    else if (f[k] === false) out.push(`${isA}n't ${k}`);
  }
  // std-ry8 (CR 702.112b): "as long as ~ is renowned", "if it isn't renowned"
  if (f.renowned === true) out.push(`${isA} renowned`);
  else if (f.renowned === false) out.push(`${isA}n't renowned`);
  // cloud std-spm (CR 700.9): "~ has flying as long as it's modified" (it has a counter on it, is equipped, or is enchanted by an Aura its controller controls)
  if (f.modified === true) out.push(`${isA} modified`);
  else if (f.modified === false) out.push(`${isA}n't modified`);
  // MX3 (CR 701.54e): "~ is your Ring-bearer", "it's a Ring-bearer"
  if (f.ringBearer === 'you') out.push(`${isA} your Ring-bearer`);
  else if (f.ringBearer === 'any') out.push(`${isA} ${plural ? 'Ring-bearers' : 'a Ring-bearer'}`);
  else if (f.ringBearer !== undefined) throw new NoRenderer('a Ring-bearer of a player other than you or any player');
  // Standard round 4, r4-trig (CR 702.100a-b, 208.1; parser/holes/filter.ts#featureAt): "has greater power or toughness than ~": more power than that object's
  // power or more toughness than its toughness (evolve's comparison); said only so (family greater-power-or-toughness)
  const pot = greaterPowerOrToughness(f);
  if (pot !== null) out.push(`${has} greater power or toughness than ${K.obj(pot, cloneState(st), 'object').text}`);
  // the controller is a predicate of the object, whatever its types: "you control it"
  if (f.controller !== undefined && f.controller !== 'any') out.push(f.controller === 'you' ? `you control ${plural ? 'them' : 'it'}` : `${controls(f, st)} ${plural ? 'them' : 'it'}`);
  // everything else (types, subtypes, zone, owner, name, not, anyOf ...) is the noun phrase of what is left of the filter
  const rest: ObjectFilter = { ...f };
  for (const k of PREDICATE_FIELDS) delete rest[k];
  if (pot !== null) delete rest.anyOf;
  if (ato !== undefined && ato.ref === 'each' && 'filter' in ato) delete rest.attachedToObject; // std-rx32: said above
  if (f.doubleFaced === true && rest.isCard === true) delete rest.isCard; // std-rx31: "a double-faced card" says it is a card (the filter reads cards only, rules/filter.ts)
  if (Object.values(rest).some((v) => v !== undefined)) {
    const onlyTypes = Object.entries(rest).every(([k, v]) => v === undefined || k === 'types' || k === 'allTypes' || k === 'isCard');
    const phrase = K.np(rest, st, { det: plural ? 'none' : 'a', plural, noController: true });
    // FAST4 T29: a supertype alone is also its adjective, "as long as equipped creature is legendary" (CR 205.4a; family supertype-adjective)
    const onlySupertypes = Object.entries(rest).every(([k, v]) => v === undefined || k === 'supertypes') && (rest.supertypes ?? []).length > 0;
    if (onlySupertypes) out.push(alt(`${isA} ${phrase}`, `${isA} ${joinList(rest.supertypes!.map((s) => s.toLowerCase()), 'or')}`));
    // std-rx14 (CR 108.1, 607.2d, 608.2c; Gathering Stone, Herald's Horn): "if it's a card of the chosen type", "if it's a creature card of the chosen type": a
    // card (`isCard`, never a token) whose kind is the linked choice, said with the card noun wherever the card is (the object a step looked at; the zone is not printed)
    else if (!plural && rest.isCard === true && rest.chosen !== undefined && rest.zone === undefined && Object.entries(rest).every(([k, v]) => v === undefined || k === 'chosen' || CARD_NOUN_FIELDS.has(k))) {
      const { isCard: _card, ...kind } = rest;
      out.push(`${isA} ${K.np({ ...kind, zone: 'any' }, st, { det: 'a', plural: false, noController: true, head: 'card' })}`);
    }
    else if (!plural && rest.isCard === true && Object.entries(rest).every(([k, v]) => v === undefined || CARD_NOUN_FIELDS.has(k)) && ((rest.types ?? []).length > 0 || (rest.allTypes ?? []).length > 0 || (rest.subtypes ?? []).length > 0)) {
      // FAST4 T34 (CR 108.1, 111.1): "it's a land card", "it was a permanent card": a card of those types (a token is not a card), the card noun after the type
      const noCard: ObjectFilter = { ...rest };
      delete noCard.isCard;
      out.push(alt(`${isA} ${phrase}`, `${isA} ${phrase} card`, `${isA} ${K.np(noCard, st, { det: 'a', plural: false, noController: true })} card`));
    } else out.push(onlyTypes && !plural ? alt(`${isA} ${phrase}`, `${isA} ${phrase} card`) : `${isA} ${phrase}`);
  }
  if (f.self === true) out.push(`${isA} the source`);
  else if (f.self === false) out.push(`${isA}n't the source`);
  return out;
}

/**
 * FAST4 T34 (CR 608.2h, parser/holes/cond.ts#pastTense): the past tense of a condition on an object a step of the same resolution acted on, "if it was a
 * permanent card", "if that permanent was a legendary enchantment", "if it was tapped", "if it had mana value 3 or less" (and "wasn't" / "didn't have"). The
 * model reads the object where it is now, or as it last existed if it moved, for both tenses, so they are one meaning. Only an object other than the source,
 * and only the characteristics and statuses that last known information keeps (attacking and blocking too: types/state.ts#LastKnown.combat, CR 506.4).
 */
const PAST_FIELDS: ReadonlySet<string> = new Set(['types', 'allTypes', 'notTypes', 'subtypes', 'notSubtypes', 'supertypes', 'notSupertypes', 'isCard', 'tapped',
  'manaValue', 'power', 'toughness', 'colors', 'colorless', 'multicolored', 'token', 'dealtDamageThisTurn', 'attacking', 'blocking',
  'suspected', // FAST5X E12 (CR 701.60b): a designation of the permanent, kept in its last known information (LastKnown.object)
  'counters', // FAST5X E21 (CR 122.1, 608.2h): the counters on it, kept in its last known information (LastKnown.object.counters)
]);
let noPastTense = 0;
/**
 * FAST4 T34: render `f` without the past-tense readings: an intervening "if" (CR 603.4) is checked as the event happens too, where triggers/cond.ts reads an event
 * role as the object is now (a creature that died is the card in the graveyard), so "if it was a creature" there is not read as it last existed; it stays manual.
 */
export function withoutPastTense<T>(f: () => T): T {
  noPastTense++;
  try {
    return f();
  } finally {
    noPastTense--;
  }
}

let lookBackCounters = 0;
/**
 * FAST5X E21 (CR 603.10a, 603.4, 608.2h): render `f`, the intervening "if" of a leaves-the-battlefield trigger, with the past tense of a condition on the
 * counters of the object that left ("When ~ dies, if it had a -1/-1 counter on it", "Whenever another creature you control dies, if it had counters on it").
 * Such a trigger looks back in time: both checks of the condition (as it triggers and as it resolves, CR 603.4) read the event's last known information of
 * the object (effects/refs.ts#lookBackInfo through the one evaluator, triggers/cond.ts#holds), counters included, for the source itself too.
 */
export function withLookBackCounters<T>(f: () => T): T {
  lookBackCounters++;
  try {
    return f();
  } finally {
    lookBackCounters--;
  }
}

function pastPredicates(c: Extract<Condition, { cond: 'matches' }>, preds: readonly string[], negate: boolean): string[] | null {
  const countersOnly = Object.entries(c.filter).every(([k, v]) => v === undefined || k === 'counters') && c.filter.counters !== undefined;
  if (!(lookBackCounters > 0 && countersOnly)) {
    if (noPastTense > 0) return null;
    if (c.object.ref === 'self' || Object.entries(c.filter).some(([k, v]) => v !== undefined && !PAST_FIELDS.has(k))) return null;
  }
  const lead = `(^|[${ALT_OPEN}${ALT_SEP}])`;
  const out: string[] = [];
  for (const p of preds) {
    if (!new RegExp(`${lead}(is|are|has|have|was|were) `).test(p)) return null;
    out.push(p
      .replace(new RegExp(`${lead}is `, 'g'), negate ? "$1wasn't " : '$1was ')
      .replace(new RegExp(`${lead}are `, 'g'), negate ? "$1weren't " : '$1were ')
      .replace(new RegExp(`${lead}(has|have) `, 'g'), negate ? "$1didn't have " : '$1had '));
  }
  return out;
}

/** FAST5 T47: every reading of a predicate (its alternative groups at the start included) starts with "is", "are", "has" or "have". */
function startsWithVerb(p: string): boolean {
  const nodes = parseMarked(p);
  const first = nodes[0];
  if (first === undefined) return false;
  const verb = /^(is|are|has|have) /;
  if (typeof first === 'string') return verb.test(first);
  return first.alts.every((a) => typeof a[0] === 'string' && verb.test(a[0]));
}

function notPhrase(c: Condition, st: RenderState): string | null {
  switch (c.cond) {
    case 'exists': return existsPhrase(c.of, c.atLeast, true, st);
    case 'turnOf':
      // FAST5X E9 (CR 505.1): "it isn't your main phase"; a step other than both main phases has no negated wording here (it was dropped before)
      if (isYourMainPhase(c)) return alt("it isn't your main phase", "it's not your main phase", 'it is not your main phase');
      if (c.step !== undefined) throw new NoRenderer('a negated turn condition with a step');
      return `it's not ${turnOf(c.whose, st)}`;
    case 'completedDungeon': return completedPhrase(c, st, true); // MX4
    case 'compare': return K.cond({ cond: 'compare', left: c.left, op: INVERT[c.op], right: c.right }, st);
    case 'did': return K.cond({ cond: 'did', step: c.step, not: !c.not, ...(c.which !== undefined ? { which: c.which } : {}), ...(c.to !== undefined ? { to: c.to } : {}) }, st);
    case 'matches': {
      const o = K.obj(c.object, st, 'subject');
      const positive = predicates(c.filter, st, o.plural);
      // only a predicate that starts with its verb ("is tapped", "has flying") can be negated by rewriting that verb; anything else is negated as a whole
      // FAST5 T47: also a predicate whose every reading starts with its verb ("isn't a creature", "isn't a creature card": the groups of a type phrase)
      const lead = `(^|[${ALT_OPEN}${ALT_SEP}])`;
      const starts = (p: string, words: string): boolean => new RegExp(`${lead}(${words}) `).test(p);
      if (positive.length === 0 || positive.some((p) => !startsWithVerb(p))) return null;
      const preds = positive.map((p) => p.replace(new RegExp(`${lead}(is|are) `, 'g'), `$1${o.plural ? "aren't " : "isn't "}`).replace(new RegExp(`${lead}(has|have) `, 'g'), `$1${o.plural ? "don't have " : "doesn't have "}`));
      // FAST5X E12: Oracle also writes the uncontracted negation ("if it's not suspected", read "it is not suspected"): the same condition; FAST5 T62: each
      // alternative of a group ("is a creature" or "is a creature card") is negated so too (not when a predicate has "has" / "have")
      const full = positive.some((p) => starts(p, 'has|have')) ? [] : [`${o.text} ${positive.map((p) => p.replace(new RegExp(`${lead}(is|are) `, 'g'), o.plural ? '$1are not ' : '$1is not ')).join(' and ')}`];
      const present = alt(`${o.text} ${preds.join(' and ')}`, ...full);
      const past = pastPredicates(c, positive, true);
      return past === null ? present : alt(present, `${o.text} ${past.join(' and ')}`);
    }
    case 'wasCast': {
      // M6-5: "~ escaped" (CR 702.138b) has no " was " to negate: "~ didn't escape"
      if (escapedOnly(c)) return `${K.obj({ ref: 'self' }, st, 'subject').text} didn't escape`;
      // FAST3 T15: both readings negated (the generic rewrite below would negate only the first of them)
      if (castFromHandOnly(c)) {
        st.conds.add(JSON.stringify(c));
        return alt(`${K.obj({ ref: 'self' }, st, 'subject').text} wasn't cast from your hand`, "you didn't cast it from your hand");
      }
      // FAST5X E1: "the gift wasn't promised" (CR 702.174k), "~ wasn't bargained" (CR 702.166b)
      if (namedCostOnly(c, 'gift')) return "the gift wasn't promised";
      if (namedCostOnly(c, 'collectEvidence')) return "evidence wasn't collected"; // FAST5X E12 (CR 701.59c)
      if (namedCostOnly(c, 'bargain')) return alt(`${K.obj({ ref: 'self' }, st, 'subject').text} wasn't bargained`, "it wasn't bargained");
      const base = K.cond(c, st);
      return base.replace(/ was /, " wasn't ");
    }
    case 'happened': {
      // p2-intervening-1 (CR 119.3; parser/holes/p2iv1.ts): "you didn't lose life this turn"
      if (c.event.ev === 'life' && c.event.change === 'loss' && c.event.player === 'you' && Object.keys(c.event).length === 3 && c.scope === 'turn' && c.times === undefined && c.by === undefined) {
        return alt("you didn't lose life this turn", 'you did not lose life this turn', "you haven't lost life this turn");
      }
      // FAST4 T23: "you haven't cast a spell from your hand this turn" (CR 601.2a)
      if (c.event.ev === 'cast' && c.event.from !== undefined) return castFromPhrase(c, st, true);
      // std-rx27 (CR 602.1, 702.177a): "you haven't activated an exhaust ability this turn" (Elvish Refueler), the negated history of your activations of that kind
      if (c.event.ev === 'activate' && c.event.player === 'you' && (c.event.ability === 'exhaust' || c.event.ability === 'loyalty') && Object.keys(c.event).length === 3
        && c.scope === 'turn' && c.times === undefined && c.by === undefined) {
        return `you haven't activated ${c.event.ability === 'exhaust' ? 'an exhaust' : 'a loyalty'} ability this turn`;
      }
      // FAST5X E22 (CR 601.2i, 707.10): "you didn't cast a spell this turn": no spell cast by you this turn (a copy is not cast)
      if (c.event.ev === 'cast' && c.event.player === 'you' && c.scope === 'turn' && c.times === undefined && c.by === undefined && Object.keys(c.event).length === 2) {
        return alt("you didn't cast a spell this turn", 'you did not cast a spell this turn', "you haven't cast a spell this turn");
      }
      // FAST5 T68 (CR 510.2, 400.7; family self-they): "they haven't dealt combat damage yet": the object itself (as the permanent it has been since it entered the
      // battlefield: a later zone change makes it a new object) has dealt no combat damage in the game; Oracle's singular "they" is the object
      if (c.event.ev === 'damage' && c.scope === 'game' && c.times === undefined && c.by === undefined && c.event.combat === true && Object.keys(c.event).length === 3
        && c.event.source?.self === true && Object.keys(c.event.source).length === 1) {
        return alt("they haven't dealt combat damage yet", `${K.obj({ ref: 'self' }, st, 'subject').text} hasn't dealt combat damage yet`, "it hasn't dealt combat damage yet");
      }
      // std-rx12 (CR 120.1, 400.7; family self-they): "it hasn't dealt damage yet": the same with damage of any kind, combat or not (no `combat` field)
      if (c.event.ev === 'damage' && c.scope === 'game' && c.times === undefined && c.by === undefined && Object.keys(c.event).length === 2
        && c.event.source?.self === true && Object.keys(c.event.source).length === 1) {
        return alt("it hasn't dealt damage yet", `${K.obj({ ref: 'self' }, st, 'subject').text} hasn't dealt damage yet`, "they haven't dealt damage yet");
      }
      // M6-0: "if no spells were cast last turn" (the front faces of the Innistrad werewolves; CR 603.4)
      if (c.event.ev !== 'cast' || c.times !== undefined || (c.by !== undefined && c.by !== 'any') || c.event.player !== undefined || c.event.spell !== undefined || c.event.via !== undefined) return null;
      return `no spells were cast ${scopeWords(c.scope)}`;
    }
    default: return null;
  }
}

/**
 * FAST3 T15: "a player has 13 or less life" is "you have 13 or less life or each opponent has 13 or less life": the players are you and your opponents
 * (CR 102.1, 102.3, 119.1). Only the two life comparisons with the same operator and number, one about you and one about each opponent.
 */
function anyPlayerLife(of: Condition[]): string | null {
  if (of.length !== 2) return null;
  const [a, b] = of;
  if (a?.cond !== 'compare' || b?.cond !== 'compare' || a.op !== b.op || typeof a.right !== 'number' || a.right !== b.right) return null;
  const whose = (x: Extract<Condition, { cond: 'compare' }>): string | null =>
    typeof x.left === 'object' && x.left.q === 'life' ? JSON.stringify(x.left.of) : null;
  const pair = [whose(a), whose(b)].sort().join(' ');
  if (pair !== `${JSON.stringify({ ref: 'each', who: 'opponent' })} ${JSON.stringify({ ref: 'you' })}`) return null;
  const pre = COMPARE_MORE[a.op];
  if (!pre || a.op === '==') return null;
  return `a player has ${pre[0]}${String(a.right)}${pre[1]} life`;
}

/** FAST3 T15: "you cast it from your hand" is "~ was cast from your hand" (CR 601.2a: only its controller casts a spell from their own hand). */
const castFromHandOnly = (c: Extract<Condition, { cond: 'wasCast' }>): boolean =>
  c.from === 'hand' && c.kicked === undefined && c.via === undefined && c.xAtLeast === undefined && c.spent === undefined;

/** M6-5: "~ escaped" is the condition "~ was cast with its escape ability" and nothing else (CR 702.138b). */
const escapedOnly = (c: Extract<Condition, { cond: 'wasCast' }>): boolean =>
  c.via === 'escape' && c.kicked === undefined && c.from === undefined && c.xAtLeast === undefined && c.spent === undefined;

/** FAST5X E1: a condition that is only "the additional cost `name` was paid" (gift, bargain). */
const namedCostOnly = (c: Extract<Condition, { cond: 'wasCast' }>, name: string): boolean =>
  c.kicked === name && c.via === undefined && c.from === undefined && c.xAtLeast === undefined && c.by === undefined;

/** FAST5X E7: a condition that is only "~ was cast for its `via` alternative cost" (sneak, web-slinging). */
const viaOnly = (c: Extract<Condition, { cond: 'wasCast' }>, via: string): boolean =>
  c.via === via && c.kicked === undefined && c.from === undefined && c.xAtLeast === undefined && c.by === undefined;

function wasCastPhrase(c: Extract<Condition, { cond: 'wasCast' }>, st: RenderState): string {
  // FAST5X E1: "the gift was promised" (CR 702.174k: its gift cost was paid) and "~ was bargained" (CR 702.166b: its bargain cost was paid)
  if (namedCostOnly(c, 'gift')) return 'the gift was promised';
  // FAST5X E12 (CR 701.59c): "evidence was collected": its optional collect evidence cost was paid
  if (namedCostOnly(c, 'collectEvidence')) return 'evidence was collected';
  if (namedCostOnly(c, 'bargain')) return alt(`${K.obj({ ref: 'self' }, st, 'subject').text} was bargained`, 'it was bargained', "it's bargained");
  // FAST5X E9 (CR 118.8, 601.2b): "this spell's additional cost was paid": its optional additional cost without a keyword name (actions/cast-costs.ts)
  if (namedCostOnly(c, 'additional')) return `${K.obj({ ref: 'self' }, st, 'possessive').text} additional cost was paid`;
  // FAST4 T27 (CR 601.2a): "you cast it": the object was cast by the ability's controller, and nothing else
  if (c.by === 'you') {
    if (c.kicked !== undefined || c.via !== undefined || c.from !== undefined || c.xAtLeast !== undefined || c.spent !== undefined) throw new NoRenderer('"you cast it" with another part of the cast history');
    // std-tdm (CR 601.2a, 603.4): the object that entered (`object`, the trigger's subject) is "it" right after its own trigger event, never "~"
    if (c.object !== undefined) {
      if (c.object.ref !== 'event' || c.object.role !== 'subject') throw new NoRenderer('"you cast it" of an object other than the one that entered');
      return 'you cast it';
    }
    return alt('you cast it', 'you cast ~'); // FAST5 T64: the object named by its name (a plural name, "you cast them" is read as "you cast ~")
  }
  // std-rx14 (CR 702.185a, 118.9): "that creature was cast for its warp cost": the cast record of an object the ability named before (parser/holes/cond.ts#castForAltCost)
  if (c.object !== undefined) {
    if (c.via === undefined || !viaOnly(c, c.via) || c.spent !== undefined || c.fromOwner !== undefined) throw new NoRenderer('a cast history of another object other than its alternative cost');
    return `${K.obj(c.object, st, 'subject').text} was cast for its ${c.via} cost`;
  }
  const self = K.obj({ ref: 'self' }, st, 'subject').text;
  // FAST5X E7 (CR 702.190b, 702.188a): "~'s sneak cost was paid", "~ was cast using web-slinging"; Oracle names a character card "he", "she" or "they"
  // std-ry7 (CR 702.137b): and "~'s spectacle cost was paid" / "its spectacle cost was paid" (family alt-cost-paid; spectacle has no "cast using" wording)
  const paidVia = viaOnly(c, 'sneak') ? 'sneak' : viaOnly(c, 'spectacle') ? 'spectacle' : undefined;
  if (paidVia !== undefined) return alt(...["~'s", 'its', 'his', 'her', 'their'].map((p) => `${p} ${paidVia} cost was paid`), ...(paidVia === 'sneak' ? [`${self} was cast using sneak`] : []));
  if (viaOnly(c, 'foretell')) return alt(`${self} was foretold`, 'it was foretold'); // cloud r3-mech (CR 702.143a)
  if (viaOnly(c, 'mayhem')) return "~'s mayhem cost was paid"; // r4-repl (CR 702.187a): its mayhem alternative cost was paid
  if (viaOnly(c, 'surge')) return alt("~'s surge cost was paid", 'its surge cost was paid'); // std-ry8 (CR 702.117a-b): its surge alternative cost was paid
  if (viaOnly(c, 'web-slinging')) return alt(...['~', 'it', 'he', 'she'].map((p) => `${p} was cast using web-slinging`), 'they were cast using web-slinging');
  // M6-5 (CR 702.138b): "A spell or permanent 'escaped' if that spell or the spell that became that permanent as it resolved was cast from a graveyard with
  // an escape ability"; the cast record's `via` is the alternative cost paid, and escape's cost can only be paid from a graveyard (keywords/data/escape.json)
  if (escapedOnly(c)) return `${self} escaped`;
  // FAST5X E11 (CR 702.194b): "~ was cast using teamwork": its teamwork cost was paid
  if (namedCostOnly(c, 'teamwork')) return `${self} was cast using teamwork`;
  if (castFromHandOnly(c)) return alt(`${self} was cast from your hand`, 'you cast it from your hand');
  const parts: string[] = [];
  // p2-c-cast-zone-1 (CR 603.4, 702.33d; family cast-self-it-was-kicked): in a cast trigger of the spell itself, the spell the trigger named is also "it" ("When you cast
  // this spell, if it was kicked, exile target land.", Sowing Mycospawn)
  const castSelf = st.trigger?.length === 1 && st.trigger[0]!.ev === 'cast' && (st.trigger[0] as { spell?: { self?: boolean } }).spell?.self === true;
  if (c.kicked === true) parts.push(castSelf ? alt(`${self} was kicked`, 'it was kicked') : `${self} was kicked`);
  // p2-counters-state-1 (CR 702.33f): one kicker cost of a face with two, "~ was kicked with its {1}{R} kicker" (RenderContext.kickerCosts); a cost the face does not
  // print (the parser's leftover marker, parser/holes/p2cs1.ts) has no wording
  else if (typeof c.kicked === 'string' && c.kicked.startsWith('kicker@')) throw new NoRenderer(`a kicker cost this face does not print (${c.kicked})`);
  else if (typeof c.kicked === 'string' && kickerCost(c.kicked, st) !== undefined) parts.push(`${self} was kicked with its ${kickerCost(c.kicked, st)} kicker`);
  else if (typeof c.kicked === 'string') parts.push(`${self} was kicked with its ${c.kicked} cost`);
  if (c.via !== undefined) parts.push(`${self} was cast ${alt(`using its ${c.via} cost`, `for its ${c.via} cost`, `with ${c.via}`)}`);
  // Standard round 4, r4-trig (CR 400.3): "it was cast from your graveyard" (`fromOwner`, parser/holes/cond.ts)
  // std-ro (CR 406.1): exile is one zone shared by all players, "was cast from exile" (no article)
  if (c.from !== undefined) parts.push(`${self} was cast from ${c.from === 'exile' ? 'exile' : c.from === 'hand' || c.fromOwner === 'you' ? `your ${c.from}` : `a ${c.from}`}`);
  if (c.xAtLeast !== undefined) parts.push(`X is ${c.xAtLeast} or more`);
  // FAST5 T37 (CR 601.2h; adamant): "at least three white mana was spent to cast ~"
  // FAST5 T51 (CR 601.2h): the evoke hybrids write the mana itself, "{W}{W} was spent to cast it": at least that much mana of the color
  if (c.spent !== undefined) {
    const symbols = `{${c.spent.color}}`.repeat(c.spent.atLeast);
    parts.push(alt(`at least ${numWord(c.spent.atLeast)} ${COLOR_WORD[c.spent.color]} mana was spent to cast ${self}`, `${symbols} was spent to cast ${self}`, `${symbols} was spent to cast it`));
  }
  // cloud std-spm (CR 601.2i): "if it was cast" names the object by a pronoun ("When this creature enters, if it was cast, ...")
  if (parts.length === 0) parts.push(alt(`${self} was cast`, 'it was cast'));
  return parts.join(' and ');
}

/** MX4, CR 309.7: "you've completed a dungeon", "you haven't completed Tomb of Annihilation". */
function completedPhrase(c: Extract<Condition, { cond: 'completedDungeon' }>, st: RenderState, negate: boolean): string {
  const who = K.player(c.who, st, 'subject');
  const what = c.name ?? 'a dungeon';
  // Oracle prints only the contracted forms (Gloom Stalker, Acererak the Archlich): one wording, no alternative group to review
  if (who.person === 'you') return negate ? `you haven't completed ${what}` : `you've completed ${what}`;
  return negate ? `${who.text} hasn't completed ${what}` : `${who.text} has completed ${what}`;
}

/**
 * MX3 (CR 701.54a, 603.4): "you chose a creature other than ~ as your Ring-bearer", the intervening "if" of a trigger on the Ring tempting you: the creature
 * the event names (the one chosen while the Ring tempted you; none when no creature could be chosen) is not the source. Only under that trigger.
 */
function ringChoicePhrase(c: Extract<Condition, { cond: 'matches' }>, st: RenderState): string | null {
  const o = c.object as { ref: string; role?: string };
  if (o.ref !== 'event' || o.role !== 'subject' || JSON.stringify(c.filter) !== JSON.stringify({ other: true })) return null;
  const trigger = st.trigger ?? [];
  if (trigger.length !== 1 || trigger[0]!.ev !== 'action' || trigger[0]!.verb !== 'ringTempts' || trigger[0]!.object !== undefined) return null;
  return `you chose a creature other than ${K.obj({ ref: 'self' }, st, 'object').text} as your Ring-bearer`;
}

function designationPhrase(c: Extract<Condition, { cond: 'designation' }>, st: RenderState): string {
  const who = K.player(c.who, st, 'subject');
  const you = who.person === 'you';
  // M12-3 (CR 724.1): "an opponent is the monarch" (any one of them)
  const anOpponent = c.who.ref === 'each' && (c.who as { who?: string }).who === 'opponent';
  if (anOpponent && c.what !== 'monarch') throw new NoRenderer(`designation ${c.what} of each opponent`);
  switch (c.what) {
    case 'monarch': return you ? alt("you're the monarch", 'you are the monarch') : anOpponent ? 'an opponent is the monarch' : `${who.text} is the monarch`;
    case 'initiative': return you ? 'you have the initiative' : `${who.text} has the initiative`;
    case 'citysBlessing': return you ? "you have the city's blessing" : `${who.text} has the city's blessing`;
    case 'day': return alt("it's day", 'it is day');
    case 'night': return alt("it's night", 'it is night');
    // FAST5X-4 (CR 702.179e): "you have max speed"
    case 'maxSpeed': return you ? 'you have max speed' : `${who.text} has max speed`;
    // FAST5X E18 (Storied reminder text): "you have an enduring story"
    case 'enduringStory': return you ? 'you have an enduring story' : `${who.text} has an enduring story`;
  }
}

/**
 * FAST5 T70 (CR 601.2a, 707.10): "this spell was cast from anywhere other than your hand" is `any` of "was cast from <zone>" for every zone a card is cast from
 * but the hand: the graveyard, exile, the library and the command zone. A spell that was not cast (a copy of a spell, an object put onto the battlefield) has
 * no zone it was cast from, so it is none of them (a negated "cast from your hand" would hold for it). Null for any other shape.
 */
export const CAST_ELSEWHERE_ZONES: readonly string[] = ['graveyard', 'exile', 'library', 'command'];
function castElsewherePhrase(c: Extract<Condition, { cond: 'any' }>, st: RenderState): string | null {
  const zones = c.of.map((x) => (x.cond === 'wasCast' && Object.keys(x).length === 2 && x.from !== undefined ? x.from : null));
  if (zones.some((z) => z === null) || zones.length !== CAST_ELSEWHERE_ZONES.length || !CAST_ELSEWHERE_ZONES.every((z, i) => zones[i] === z)) return null;
  return `${K.obj({ ref: 'self' }, st, 'subject').text} was cast from anywhere other than your hand`;
}

/**
 * MX2 (additive; parser/holes/cond.ts#ownAndControl): "you both own and control ~ and a creature named N" is `all` of the object matching
 * `{owner: you, controller: you}` and a permanent of the description owned and controlled by you. Null for any other shape.
 */
function ownAndControlPhrase(c: Extract<Condition, { cond: 'all' }>, st: RenderState): string | null {
  const [m, e] = c.of;
  if (c.of.length !== 2 || m?.cond !== 'matches' || e?.cond !== 'exists' || e.atLeast !== undefined || m.object.ref !== 'self') return null;
  if (Object.keys(m.filter).length !== 2 || m.filter.owner !== 'you' || m.filter.controller !== 'you') return null;
  if (e.of.ref !== 'each' || e.of.filter.owner !== 'you' || e.of.filter.controller !== 'you') return null;
  const { owner: _o, controller: _c, ...rest } = e.of.filter;
  if (Object.keys(rest).length === 0) return null;
  return `you both own and control ${K.obj({ ref: 'self' }, st, 'object').text} and ${K.np(rest, st, { det: 'a' })}`;
}

/**
 * FAST5 T37 (parser/holes/cond.ts#mostCommonColor): `all` of the four comparisons "the permanents of color X are at least as many as the permanents of color Y"
 * over the other colors Y is "X is the most common color among all permanents or is tied for most common" (CR 105.1). Null for any other shape.
 */
function mostCommonColorPhrase(c: Extract<Condition, { cond: 'all' }>): string | null {
  if (c.of.length !== 4) return null;
  const colorsOf = (q: unknown): Color | null => {
    const f = typeof q === 'object' && q !== null && (q as { q?: string }).q === 'count' ? (q as { of: { ref: string; filter?: Record<string, unknown> } }).of : null;
    if (f === null || f.ref !== 'each' || f.filter === undefined || Object.keys(f.filter).length !== 1) return null;
    const cs = f.filter['colors'];
    return Array.isArray(cs) && cs.length === 1 ? (cs[0] as Color) : null;
  };
  const first = c.of[0];
  if (first?.cond !== 'compare') return null;
  const mine = colorsOf(first.left);
  if (mine === null) return null;
  const others = new Set<Color>();
  for (const x of c.of) {
    if (x.cond !== 'compare' || x.op !== '>=' || colorsOf(x.left) !== mine) return null;
    const o = colorsOf(x.right);
    if (o === null || o === mine) return null;
    others.add(o);
  }
  return others.size === 4 ? `${COLOR_WORD[mine]} is the most common color among all permanents or is tied for most common` : null;
}

/**
 * FAST5 T63 (parser/holes/cond.ts#earlyTurn): "it's your first, second, or third turn of the game": it is your turn and at most N of your turns have begun this
 * game (this one included, CR 500.1). Null for any other shape.
 */
function earlyTurnPhrase(c: Extract<Condition, { cond: 'all' }>): string | null {
  const [t, n] = c.of;
  const q = n?.cond === 'compare' ? n.left : undefined;
  if (c.of.length !== 2 || t?.cond !== 'turnOf' || t.whose !== 'you' || t.step !== undefined || n?.cond !== 'compare' || n.op !== '<=' || typeof n.right !== 'number') return null;
  if (typeof q !== 'object' || q.q !== 'happenedCount' || q.scope !== 'game' || q.by !== undefined || q.per !== undefined || q.beforeEvent !== undefined) return null;
  if (q.event.ev !== 'beginTurn' || q.event.whose !== 'you' || q.event.extra !== undefined || n.right < 1 || n.right > 4) return null;
  const words = ['first', 'second', 'third', 'fourth'].slice(0, n.right);
  const list = n.right === 1 ? 'first' : n.right === 2 ? 'first or second' : `${words.slice(0, -1).join(', ')}, or ${words[n.right - 1]!}`;
  return `it's your ${list} turn of the game`; // the gate reads "it's" and "it is" alike (render/equivalence.ts, contractions)
}

/** FAST5 T65: two or more comparisons whose left sides are each a statistic of the very same object (`stat` of one reference), and nothing else in the list. */
function sameObjectStats(list: readonly Condition[]): boolean {
  if (list.length < 2) return false;
  let of: string | undefined;
  for (const x of list) {
    if (x.cond !== 'compare' || typeof x.left !== 'object' || x.left.q !== 'stat' || x.left.of.ref === 'each' || x.left.agg !== undefined || x.left.sum === true) return false;
    const key = JSON.stringify(x.left.of);
    if (of !== undefined && of !== key) return false;
    of = key;
  }
  return true;
}

/**
 * std-combat-2 (family has-and-doesnt; parser/holes/cond.ts): "that creature has haste and ~ doesn't" is "that creature has haste and ~ doesn't have haste": one
 * object matches a keyword and another does not, the second clause's "have <keyword>" left unsaid. Null for any other list.
 */
function hasButNotPhrase(list: readonly Condition[], st: RenderState): string | null {
  const [a, b] = list;
  if (list.length !== 2 || a?.cond !== 'matches' || b?.cond !== 'not' || b.of.cond !== 'matches') return null;
  const kw = a.filter.keyword;
  if (typeof kw !== 'string' || Object.keys(a.filter).length !== 1 || JSON.stringify(b.of.filter) !== JSON.stringify(a.filter)) return null;
  const first = K.cond(a, st);
  const second = K.cond(b, st);
  const tail = ` doesn't have ${kw}`;
  if (!second.endsWith(tail)) return null;
  return alt(`${first} and ${second}`, `${first} and ${second.slice(0, -tail.length)} doesn't`);
}

/**
 * std-mana-12 (CR 603.2, 608.2c; the parser's lower/conditions.ts#resolveDoneAll): each action of the trigger being rendered happened this turn, by you: "you've done
 * all four this turn" (Avatar Aang), besides the conditions said one by one. Only when the trigger is exactly those actions of yours (two or more different verbs).
 */
function doneAllPhrase(of: readonly Condition[], st: RenderState): string | null {
  const verbs = of.map((x) => (x.cond === 'happened' && x.scope === 'turn' && x.event.ev === 'action' && x.event.actor === 'you' && Object.keys(x.event).length === 3 && Object.keys(x).length === 3 ? x.event.verb : undefined));
  const trig = (st.trigger ?? []).map((e) => (e.ev === 'action' && e.actor === 'you' && Object.keys(e).length === 3 ? e.verb : undefined));
  if (verbs.length < 2 || verbs.some((v) => v === undefined) || new Set(verbs).size !== verbs.length || trig.length !== verbs.length || trig.some((v) => v === undefined || !verbs.includes(v))) return null;
  const n = numWord(verbs.length);
  return alt(joinList(of.map((x) => K.cond(x, cloneState(st))), 'and'), `you've done all ${n} this turn`, `you have done all ${n} this turn`);
}

/**
 * p2-intervening-1 (CR 603.4; render/p2iv1.ts): a condition parser/holes/p2iv1.ts reads is also said the way Oracle prints it (beside any wording it already had; a
 * shape that had none is said only that way).
 */
export function cond(c: Condition, st: RenderState): string {
  const mine = p2iv1CondPhrase(c, cloneState(st));
  if (mine === null) return condBase(c, st);
  try {
    return alt(condBase(c, st), mine);
  } catch (e) {
    if (!(e instanceof NoRenderer)) throw e;
    return p2iv1CondPhrase(c, st) ?? mine;
  }
}

function condBase(c: Condition, st: RenderState): string {
  st.conds.add(JSON.stringify(c));
  switch (c.cond) {
    case 'all':
    case 'any': {
      const early = c.cond === 'all' ? earlyTurnPhrase(c) : null; // FAST5 T63
      if (early !== null) return early;
      const twoAttacked = c.cond === 'all' ? twoAttackedPhrase(c.of, st) : null; // Standard round 4, r4-trig
      if (twoAttacked !== null) return twoAttacked;
      const pair = c.cond === 'all' ? ownAndControlPhrase(c, st) : null; // MX2
      if (pair !== null) return pair;
      const doneAll = c.cond === 'all' ? doneAllPhrase(c.of, st) : null; // std-mana-12
      if (doneAll !== null) return doneAll;
      // r4-repl (CR 702.190b; parser/holes/cond.ts#altCostPaid): "~'s sneak cost was paid this turn", cast for its sneak cost and entered this turn
      if (c.cond === 'all' && c.of.length === 2 && JSON.stringify(c.of[0]) === JSON.stringify({ cond: 'wasCast', via: 'sneak' })
        && JSON.stringify(c.of[1]) === JSON.stringify({ cond: 'happened', event: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, scope: 'turn' })) {
        return alt(...["~'s", 'its', 'his', 'her', 'their'].map((p) => `${p} sneak cost was paid this turn`));
      }
      // r4-repl (family two-cards-one-zone): "there is an instant card and a sorcery card in your graveyard", or the two conditions said one after the other
      const inOneZone = c.cond === 'all' ? twoCardsInOneZone(c.of, cloneState(st)) : null;
      if (inOneZone !== null) return alt(inOneZone, joinList(c.of.map((x) => K.cond(x, st)), 'and'));
      const both = c.cond === 'all' ? bothSpellsPhrase(c.of, st) : null; // FAST5 T62
      if (both !== null) return alt(both, joinList(c.of.map((x) => K.cond(x, st)), 'and'));
      // Standard round 5, r5-trig (CR 305.1, 601.2a; Spider-Man 2099): a land play or a spell cast this turn by you from anywhere other than your hand (parser/holes/cond.ts)
      if (c.cond === 'any' && JSON.stringify(c.of) === JSON.stringify([{ cond: 'happened', event: { ev: 'action', verb: 'playLand', actor: 'you', notFrom: 'hand' }, scope: 'turn' }, { cond: 'happened', event: { ev: 'cast', player: 'you', notFrom: 'hand' }, scope: 'turn' }])) {
        return "you've played a land or cast a spell this turn from anywhere other than your hand";
      }
      const elsewhere = c.cond === 'any' ? castElsewherePhrase(c, st) : null; // FAST5 T70
      if (elsewhere !== null) return elsewhere;
      const common = c.cond === 'all' ? mostCommonColorPhrase(c) : null; // FAST5 T37
      if (common !== null) return common;
      const greatest = c.cond === 'all' ? greatestPowerOrTiedPhrase(c.of) : null; // Cloud std-fin
      if (greatest !== null) return greatest;
      const sc = c.cond === 'any' ? scriedOrSurveilled(c.of) : null; // FAST5X E9
      if (sc !== null) return sc;
      const gl = gainedLostLife(c.cond, c.of); // FAST5X E22
      if (gl !== null) return gl;
      const p3 = p2iv3AllAny(c); // p2-intervening-3 (CR 603.4; render/p2iv3.ts)
      if (p3 !== null) return p3;
      const hasNot = c.cond === 'all' ? hasButNotPhrase(c.of, st) : null; // std-combat-2
      if (hasNot !== null) return hasNot;
      // "A, B, and C" (Oxford comma). A bracket-free "A or B and C" has two readings, so a mixed nesting is refused.
      const mixed = c.of.some((x) => (x.cond === 'all' || x.cond === 'any') && x.cond !== c.cond && x.of.length > 1);
      if (mixed) throw new NoRenderer('all inside any (or any inside all) has no unambiguous wording');
      // FAST5 T65: comparisons of the statistics of ONE object ("its power is greater than ~'s power or its toughness is greater than ~'s toughness") are a
      // parallel list: each names the object the way a lone comparison would, whatever the one before it mentioned (so each is also written from the state
      // the list started with; the list as one sequence stays a reading too)
      const parallel = sameObjectStats(c.of) ? c.of.map((x) => K.cond(x, cloneState(st))) : null;
      const elided = c.cond === 'any' ? elidedReturnedPhrase(c.of, st) : null; // r4-moved
      if (elided !== null) return elided;
      const parts = c.of.map((x) => K.cond(x, st));
      // std-r7 (family or-if; parser/holes/cond.ts): "if A or if B" is "if A or B", the second condition with its "if" said again (two conditions only)
      const listed = c.cond === 'any' && parts.length === 2 ? alt(joinList(parts, 'or'), `${parts[0]} or if ${parts[1]}`) : joinList(parts, c.cond === 'all' ? 'and' : 'or');
      const anyPlayer = c.cond === 'any' ? anyPlayerLife(c.of) : null;
      return anyPlayer === null && parallel === null ? listed : alt(listed, ...(anyPlayer === null ? [] : [anyPlayer]), ...(parallel === null ? [] : [joinList(parallel, c.cond === 'all' ? 'and' : 'or')]));
    }
    case 'not': {
      const phrase = notPhrase(c.of, st);
      if (phrase !== null) return phrase;
      return `it's not the case that ${K.cond(c.of, st)}`;
    }
    case 'compare': {
      // std-combat-1 (CR 603.4, 508.5; parser/holes/cond.ts#thoseAttackingYou): "two or more of those creatures are attacking you and/or planeswalkers you control"
      const att = attackingYouOrWalkers(c);
      // p2-cost-statics-1 (CR 506.4; family exactly-one-attacking): "exactly one creature is attacking" is "the number of attacking creatures is one"
      if (exactlyOneAttacking(c)) return alt(`${K.qty(c.left, st)} is ${cmpWords(c.op, K.qty(c.right, st))}`, 'exactly one creature is attacking');
      if (att !== null) return `${numWord(att.n)} or more of ${K.obj(att.of, st, 'object').text} are attacking you and/or planeswalkers you control`;
      // Standard round P (CR 700.8): "you have a full party", your party size at its most, four (parser/holes/cond.ts#t23Misc)
      if (typeof c.left === 'object' && c.left.q === 'partySize' && c.left.of.ref === 'you' && c.op === '>=' && c.right === 4) return 'you have a full party';
      // Standard round P (CR 119.3, 120.3a): "you lost 2 or more life this turn", the life you lost this turn at least a fixed number (parser/holes/cond.ts#lostLifeAtLeast)
      if (typeof c.left === 'object' && c.left.q === 'lifeLostThisTurn' && c.left.of.ref === 'you' && c.op === '>=' && typeof c.right === 'number') return `you lost ${c.right} or more life this turn`;
      // Standard round 3, r3-trig (CR 606.4): "you removed two or more loyalty counters to activate it" (lower/ability.ts#interveningIfReads)
      if (typeof c.left === 'object' && c.left.q === 'loyaltyRemoved') {
        if (c.op !== '>=' || typeof c.right !== 'number') throw new NoRenderer('loyalty counters removed with another comparison');
        return `you removed ${numWord(c.right)} or more loyalty counters to activate it`;
      }
      // cmd1 (CR 119.1, 102.1): "no opponent has more life than that player" (parser/holes/cond.ts#noOpponentMoreLife); of you it is also std-lci's "you have the most
      // life or are tied for most life" (family no-opponent-more-life)
      const lv = noOpponentMoreLife(c);
      if (lv !== null) {
        const text = `no opponent has more life than ${K.player(lv, st, 'object').text}`;
        return lv.ref === 'you' ? alt(text, 'you have the most life or are tied for most life') : text;
      }
      // M6-0: a quantity with no wording of its own (the per-player maximum of a history count) may still have its comparison idiom
      const plainOrNull = (v: RenderState): string | null => {
        if (noGreaterPower(c)) return null; // STD-OTJ: the idiom alone
        try {
          return `${K.qty(c.left, v)} is ${cmpWords(c.op, K.qty(c.right, v))}`;
        } catch (e) {
          if (e instanceof NoRenderer && typeof c.left === 'object' && c.left.q === 'happenedCount' && c.left.per !== undefined) return null;
          if (e instanceof NoRenderer && typeof c.left === 'object' && c.left.q === 'countPlayers' && c.left.controlsVs !== undefined) return null; // std-sos review: the idiom only
          if (e instanceof NoRenderer && typeof c.left === 'object' && c.left.q === 'happenedDistinct' && c.left.what === 'sources') return null; // cloud r3-mech: the idiom only
          if (e instanceof NoRenderer && typeof c.left === 'object' && c.left.q === 'countPlayers' && c.left.sizeIs !== undefined) return null; // r4-cost: "a player has N or fewer cards in hand", the idiom only
          if (e instanceof NoRenderer && typeof c.left === 'object' && c.left.q === 'countPlayers' && c.left.lifeIs !== undefined) return null; // r4-static: the idiom only
          if (e instanceof NoRenderer && typeof c.left === 'object' && c.left.q === 'countPlayers' && c.left.poisonIs !== undefined) return null; // std-rx24: the idiom only
          if (e instanceof NoRenderer && typeof c.left === 'object' && c.left.q === 'countPlayers' && c.left.lostLifeIs !== undefined) return null; // Standard round P: the idiom only
          if (e instanceof NoRenderer && typeof c.left === 'object' && c.left.q === 'countPlayers' && c.left.controlsIs !== undefined) return null; // std-rx31, opp-port-1: the idiom only
          throw e;
        }
      };
      const [plain, idiom] = withVariants(st, [plainOrNull, (v) => compareIdiom(c, v)]);
      if (plain === null) {
        if (idiom === null || idiom === undefined) throw new NoRenderer('a comparison of a per-player count with no idiom');
        return idiom;
      }
      return idiom === null ? plain! : alt(idiom!, plain!);
    }
    case 'exists': return existsPhrase(c.of, c.atLeast, false, st);
    case 'prime': { // std-rx1 (CR 603.4; parser/holes/cond.ts#control): "you control a prime number of lands", a count of permanents you control only
      const q = c.of;
      if (typeof q !== 'object' || q.q !== 'count' || q.of.ref !== 'each' || q.of.filter.controller !== 'you') throw new NoRenderer('a prime number of something other than permanents you control');
      return `you control a prime number of ${K.np(q.of.filter, st, { det: 'none', plural: true, noController: true })}`;
    }
    case 'share': { // std-cardcopy-1 (CR 205.2a, 105.2, 608.2c; parser/holes/cond.ts#milledThisWayCond): two of the cards a mill step put into a graveyard share a card type or a color
      const f = c.of.ref === 'each' ? c.of.filter : undefined;
      // trek-9 (CR 205.2a, 105.2, 607.2a, 608.2c; parser/holes/trek9.ts#allExiledShareCond): "all cards exiled with ~ share a card type", the cards the object's linked
      // exiling instruction exiled and that are still in exile (nothing else said of them)
      if (c.count === 'all' && f !== undefined && f.zone === 'exile' && f.is?.ref === 'linked' && f.is.link === 'exiled' && Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join() === 'is,zone') {
        return `all cards exiled with ~ share ${c.what === 'color' ? 'a color' : 'a card type'}`;
      }
      const milled = f?.is !== undefined && f.is.ref === 'bound' && st.info.has(`${MILLED_KEY}${f.is.name}`) && f.zone === 'any';
      if (!milled || c.count !== 2) throw new NoRenderer('objects that share a card type or color other than two of the cards milled this way');
      const { is: _is, zone: _zone, ...rest } = f;
      const cards = K.np({ ...rest, zone: 'graveyard' }, st, { det: 'none', plural: true, noZone: true });
      return `two ${cards} that share ${c.what === 'color' ? 'a color' : 'a card type'} ${alt('were', 'are')} milled this way`;
    }
    case 'matches': {
      const ring = ringChoicePhrase(c, st);
      if (ring !== null) return ring;
      // p2-dig-2 (CR 701.20a, 608.2c; parser/holes/cond.ts#revealedThisWayCond; family revealed-this-way-cond): the one card a reveal of the top card of a library revealed
      // (its binding, render/steps-cards.ts#reveal: `revealedTop`, one card) of a description is also "a creature card is revealed this way" (Oracle's present tense)
      const revealed = c.object.ref === 'bound' ? st.info.get(`b:${c.object.name}`) : undefined;
      const revealedWords = revealed?.revealedTop === true && revealed.plural === false && c.filter.isCard === true && Object.keys(c.filter).every((k) => !['controller', 'owner', 'zone', 'is'].includes(k))
        ? `${K.np({ ...c.filter, zone: 'library' }, cloneState(st), { det: 'a', noZone: true })} is revealed this way` : null; // said at the end of this case
      // std-combat-5 (CR 607.2d, 205.3m): "if target attacking creature token is the chosen type": the object has the type the linked choice chose
      const ch = c.filter.chosen;
      if (Object.keys(c.filter).length === 1 && ch !== undefined && (ch.quality === 'creatureType' || ch.quality === 'cardType' || ch.quality === 'landType')) {
        const o = K.obj(c.object, st, 'subject');
        return `${o.text} ${o.plural ? 'are' : 'is'} the chosen type`;
      }
      // std-rx32 (CR 301.5c, 303.4d): "if it's attached to a creature you control": what is attached to a creature is never a creature, so "it" names the attachment
      // (render/refs.ts#candidateCheck with RenderState.attachmentOnly, as "unattach it")
      const ato = c.filter.attachedToObject;
      if (Object.keys(c.filter).length === 1 && ato !== undefined && ato.ref === 'each' && 'filter' in ato) {
        const saved = st.attachmentOnly;
        st.attachmentOnly = true;
        try {
          const o = K.obj(c.object, st, 'subject');
          return `${o.text} ${o.plural ? 'are' : 'is'} attached to ${K.np(ato.filter, st, { det: 'a' })}`;
        } finally {
          if (saved === undefined) delete st.attachmentOnly;
          else st.attachmentOnly = saved;
        }
      }
      // std-costs-2 (CR 607.2d, 205.3m; the parser's holes/cond.ts): "the revealed card is the chosen type": it has the creature type the linked choice chose
      if (Object.keys(c.filter).length === 1 && c.filter.chosen !== undefined && c.filter.chosen.quality === 'creatureType') {
        const o = K.obj(c.object, st, 'subject');
        if (!o.plural) return `${o.text} is the chosen type`;
      }
      // Standard round 5, r5-trig (CR 603.4, 601.2h; Satoru, the Infiltrator): every object of a batch was not cast or was cast with no mana spent
      if (Object.keys(c.filter).length === 1 && c.filter.castWithMana === false) {
        const them = K.obj(c.object, st, 'object').text;
        return `none of ${them} were cast or no mana was spent to cast ${them}`;
      }
      // FAST5X E17 (CR 608.2h): "you controlled it": the controller of an object the ability named, as it last existed (parser/holes/cond.ts#matches)
      // (the source is no antecedent there, as in the parser: AnaphorInfo.notSelf, so "it" names the object even after "When ~ enters")
      if (youControlledOnly(c)) {
        const saved = st.notAntecedent;
        st.notAntecedent = 'self';
        try {
          return `you controlled ${K.obj(c.object, st, 'object').text}`;
        } finally {
          if (saved === undefined) delete st.notAntecedent;
          else st.notAntecedent = saved;
        }
      }
      // Standard round 4, r4-trig (CR 404.1, 603.1): "while ~ is in your graveyard" (a trigger's `while`, zz-cloud/r4-trig.json): the object itself in its owner's graveyard
      if (c.object.ref === 'self' && c.filter.zone === 'graveyard' && c.filter.owner === 'you' && Object.keys(c.filter).length === 2) {
        st.mentioned.add('self');
        return '~ is in your graveyard';
      }
      // trek-12 (CR 113.6, 602.5b; the parser's holes/cond.ts): "Activate only ... if ~ is exiled": the object itself in exile
      if (c.object.ref === 'self' && c.filter.zone === 'exile' && Object.keys(c.filter).length === 1) {
        st.mentioned.add('self');
        return '~ is exiled';
      }
      // r4-fxb (CR 608.2c, 608.2h): "if an opponent controls that creature": the controller of an object the ability named, now, said with the controller first
      // (parser/templates/zz-cloud/r4-fxb.json, eff.fxb.ifOpponentControls); the source is no antecedent there, as for "you controlled it"
      if (opponentControlsOnly(c)) {
        const saved = st.notAntecedent;
        st.notAntecedent = 'self';
        try {
          return `an opponent controls ${K.obj(c.object, st, 'object').text}`;
        } finally {
          if (saved === undefined) delete st.notAntecedent;
          else st.notAntecedent = saved;
        }
      }
      // std-ru (CR 301.5, 303.4; family attached-to-a): "as long as ~ is attached to a creature": the object the source is attached to is such a permanent, said
      // from the source's side as well ("equipped creature is a creature" stays a reading); the parser reads it for the source only (parser/holes/cond.ts)
      const attached = c.object.ref === 'attachedTo' && Object.keys(c.object).length === 1 && c.filter.zone === undefined && c.filter.isCard === undefined
        ? `${K.obj({ ref: 'self' }, cloneState(st), 'subject').text} is attached to ${K.np(c.filter, cloneState(st), { det: 'a' })}` : null;
      const o = K.obj(c.object, st, 'subject');
      // trek-5 (CR 401.5, 400.7; parser/holes/cond.ts, family still-on-top): "If that card is still on top of your library" is a named card that is one of the top 1 cards of
      // your library now; "still" says it is the card it was (a card that moved is a new object, CR 400.7)
      if (!o.plural && JSON.stringify(c.filter) === JSON.stringify({ zone: 'library', is: { ref: 'topCards', player: { ref: 'you' }, count: 1 } })) {
        return alt(`${o.text} is the top card of your library`, `${o.text} is still on top of your library`);
      }
      const preds = predicates(c.filter, st, o.plural);
      if (preds.length === 0) return attached ?? `${o.text} ${o.plural ? 'are' : 'is'} an object`;
      // r5-static (CR 611.3a, 109.4; family is-np): "as long as it's a Detective you control": one object that is of a kind and controlled by you, said as one noun
      // phrase ("is a Detective you control") as well as predicate by predicate ("you control it and it is a Detective")
      const kindKeys = new Set(['types', 'subtypes', 'supertypes', 'controller']);
      const np = !o.plural && c.filter.controller === 'you' && Object.keys(c.filter).length >= 2 && Object.keys(c.filter).every((k) => kindKeys.has(k))
        ? `${o.text} is ${K.np(c.filter, cloneState(st), { det: 'a' })}` : null;
      const withStats = cardWithStats(c.filter, o.text, o.plural, st);
      const plain0 = np === null ? `${o.text} ${preds.join(' and ')}` : alt(`${o.text} ${preds.join(' and ')}`, np);
      const plain = withStats === null ? plain0 : alt(plain0, withStats);
      // FAST5X E28 (equivalence self-by-name, CR 201.5): "as long as ~ has a shield counter on ~" (a character card's "on him", read as "~" by the front end)
      // FAST5 T68 (CR 201.5, 122.1; family counter-on-self): "has a conqueror counter on him": a character card's gendered pronoun reads as "~" (FAST5X E24), so the
      // counter on the object itself is also "on ~" (FAST5 batch 9 integration: either test, one alt site)
      const onSelf = c.object.ref === 'self'
        && ((c.filter.counters !== undefined && c.filter.counters.cmp === undefined && c.filter.counters.kind !== 'any') || / counters? on it$/.test(plain));
      const present = onSelf ? alt(plain, `${o.text} ${preds.map((p) => p.replace(/ on it$/, ' on ~')).join(' and ')}`) : plain;
      const past = pastPredicates(c, preds, false);
      // std-rx31 (CR 603.10a, 201.5; family self-as-it-left): in a trigger on the object itself leaving the battlefield, what it was as it left is said with its name,
      // "if ~ was a creature", and a plural name takes a plural verb, "if ~ were a creature" (the parser's lower/ability.ts#selfAsItLeft)
      const [ev] = st.trigger ?? [];
      const selfLeft = past !== null && JSON.stringify(c.object) === JSON.stringify({ ref: 'event', role: 'subject' }) && (st.trigger ?? []).length === 1 && ev?.ev === 'zoneChange'
        && ev.from === 'battlefield' && JSON.stringify(ev.subject) === JSON.stringify({ self: true });
      const byName = selfLeft ? [`~ ${past!.join(' and ')}`, `~ ${past!.map((p) => p.replace(new RegExp(`(^|[${ALT_OPEN}${ALT_SEP}])was `, 'g'), '$1were ')).join(' and ')}`] : [];
      // Cloud r3-moved (CR 608.2c, 608.2h): "if an outlaw was sacrificed this way" of what the ability's cost moved (render/moved.ts, family moved-this-way-cost)
      const said0 = costMovedOr(c, past === null ? present : alt(present, `${o.text} ${past.join(' and ')}`, ...byName), st);
      const said = revealedWords === null ? said0 : alt(said0, revealedWords); // p2-dig-2: family revealed-this-way-cond
      return attached === null ? said : alt(said, attached); // std-ru: family attached-to-a
    }
    case 'turnOf': {
      const t = turnOf(c.whose, st);
      if (c.step === undefined) return alt(`it's ${t}`, `it is ${t}`);
      if (isYourMainPhase(c)) return alt("it's your main phase", 'it is your main phase'); // FAST5X E9 (CR 505.1)
      if (isYourCombatPhase(c)) return alt("it's your combat phase", 'it is your combat phase'); // r4-fxb (CR 506.1)
      const steps = [c.step].flat();
      const names = steps.map((s) => possessiveStep(s, c.whose, st));
      return alt(`it's ${joinList(names, 'or')}`, `it is ${joinList(names, 'or')}`, `it's ${joinList(steps.map((s) => STEP_NAME[s]), 'or')} on ${t}`);
    }
    case 'wasCast': return wasCastPhrase(c, st);
    case 'happened': return happenedPhrase(c, st);
    case 'did': {
      if (c.which !== undefined && c.to === 'hand' && c.which.zone === 'battlefield') return returnedThisWayPhrase(c.which, c.not === true, st); // STD-OTJ
      if (c.which !== undefined && c.to === 'hand') return putThisWayPhrase(c.which, c.not === true, st); // FAST5 T75
      const moved = c.which !== undefined ? movedCondPhrase(c, st) : null; // Cloud C7: "if a creature card was exiled this way" (CR 608.2c, 608.2h)
      if (moved !== null) return moved;
      // (Cloud std-fin's "a <card> was exiled this way" is rendered by movedCondPhrase since the wave-2 merge: one reader of the words, parser/holes/moved.ts)
      if (c.which === undefined && c.to !== undefined) return notPutPhrase(c.to, c.not === true, st.info.get(`r:${c.step}`)?.revealedPut === true); // LOOK3 (the one reading of Cloud std-fin's words too)
      if (c.which !== undefined) return destroyedThisWayPhrase(c.which, c.not === true, st); // FAST5X E17
      const info = st.info.get(`b:${c.step}`);
      const actor = info?.actor;
      const you = actor === undefined || actor === null || actor === 'you';
      // std-tdm (CR 608.2c, 614.11; family didnt-draw-this-way): after a draw of one card (render/steps-cards.ts#draw records it), "if you don't draw a card this way"
      const drew = c.not === true && st.info.get(`r:${c.step}`)?.thisWay === 'drawn this way';
      // r4-moved (CR 701.23a, 608.2c): after an option of yours that searches your library, "if you search your library this way" (parser marker `$searched`)
      if (you && c.not !== true && info?.searched === true) return alt('you do', 'you did', 'you search your library this way');
      // std-rq (CR 608.2d, 101.4): after "any opponent may ...", whether one of them did: "if a player does", "if they do"; "if no one does"
      if (info?.anyOne === true) return c.not ? alt('no one does', "they don't") : alt('a player does', 'they do');
      // std-rj (CR 608.2c, 601.2): after the free cast of one card (render/steps-zones.ts#cast records it), "if you don't cast that card this way"
      const casted = c.not === true && st.info.get(`r:${c.step}`)?.thisWay === 'cast this way';
      // std-rx3 (CR 608.2c, 121.1; family drew-one-or-more-this-way): naming a draw (render/steps-cards.ts#draw records it), "if you draw one or more cards this way"
      const drewAny = c.not !== true && st.info.get(`r:${c.step}`)?.thisWay === 'drawn this way';
      if (you) return c.not ? alt("you don't", 'you did not', "you can't", ...(drew ? ["you don't draw a card this way"] : []), ...(casted ? ["you don't cast that card this way"] : [])) : alt('you do', 'you did', ...(drewAny ? ['you draw one or more cards this way'] : []));
      return c.not ? alt("that player doesn't", "the player doesn't", "they don't") : alt('that player does', 'the player does', 'they do');
    }
    case 'designation': return designationPhrase(c, st);
    case 'completedDungeon': return completedPhrase(c, st, false); // MX4, CR 309.7
    case 'chosen': return `the chosen ${c.link} is ${c.equals}`;
    case 'ask': return c.text;
    // M6-0 (m6 design 2.1): CR 716.2a, the level of a Class; CR 702.37b, the megamorph flag of the event a `during` body replaces
    case 'classLevel': return `${K.obj(c.object, st, 'subject').text} is level ${c.atLeast} or greater`; // one wording: a second one needs a reviewed family (render/equivalence.ts)
    case 'eventFlag': return 'its megamorph cost was paid';
    // FAST5X E11 (CR 701.4b): "a Dragon was beheld" (the quality: a type, subtype or supertype, render/costs.ts prints the same noun for the cost)
    case 'beheld': return `${K.np(c.quality, st, { det: 'a', noZone: true })} was beheld`;
    case 'asCast': return asCastPhrase(c.held, st); // FAST5X E17 (CR 601.2i)
    case 'firstNamedResolution': return "this is the first time a spell you control with this spell's name has resolved this game"; // FAST5X E26 (CR 702.192a)
    case 'firstSpellCast': return `${K.obj({ ref: 'self' }, st, 'subject').text} is the first spell you've cast this game`; // trek-2 (CR 601.2i)
    case 'firstCombat': return "it's the first combat phase of the turn"; // Standard round 4, r4-trig (CR 500.8, 505.1a)
    case 'someMatch': { // Standard round 5, r5-trig (CR 603.4, 603.6a): "one or more of them entered from exile or was cast from exile"
      const f = c.filter;
      const [a, b] = f.anyOf ?? [];
      const zone = a?.enteredFrom;
      if (Object.keys(f).length !== 1 || f.anyOf?.length !== 2 || zone === undefined || Object.keys(a!).length !== 1 || b?.castFrom !== zone || Object.keys(b).length !== 1 || (zone !== 'exile' && zone !== 'graveyard')) throw new NoRenderer('condition someMatch of this filter');
      const where = zone === 'exile' ? 'exile' : 'a graveyard';
      const them = K.obj(c.object, st, 'object').text;
      const printed = `one or more of ${them} entered from ${where} or was cast from ${where}`;
      // std-rj (family some-match-they): the batch of a trigger is also said "they entered or were cast from a graveyard"
      return zone === 'graveyard' && c.object.ref === 'event' && c.object.role === 'subject' ? alt(printed, 'they entered or were cast from a graveyard') : printed;
    }
    case 'firstTime': { // Standard round 5, r5-trig (CR 603.4, 603.2c)
      const o = K.obj(c.object, st, 'object').text;
      if (c.event.ev === 'becomes' && c.event.what === 'tapped') return `it's the first time ${o} has become tapped this turn`;
      if (c.event.ev === 'counters' && c.event.change === 'put') return `it's the first time counters have been put on ${o} this turn`;
      throw new NoRenderer('condition firstTime of this event');
    }
    case 'controlledSinceUpkeep': return `${c.object.ref === 'self' ? '~' : 'it'} came under your control since the beginning of your last upkeep`; // CMD3 (CR 702.30a)
    default: throw new NoRenderer(`condition ${(c as { cond: string }).cond}`);
  }
}

/**
 * Standard round 4, r4-trig (CR 508.1; parser/holes/cond.ts#history): "a Pirate and a Vehicle attacked this combat": one attacker of each description and two of
 * either (two different creatures). Null for anything else.
 */
function twoAttackedPhrase(of: readonly Condition[], st: RenderState): string | null {
  if (of.length !== 3) return null;
  const att = (x: Condition, times?: number): ObjectFilter | null => {
    if (x.cond !== 'happened' || x.scope !== 'combat' || x.by !== undefined || x.event.ev !== 'attacks' || x.event.attacker === undefined) return null;
    const e = x.event;
    if (e.alone !== undefined || e.defender !== undefined || e.count !== undefined || e.power !== undefined || e.orPlaneswalker !== undefined) return null;
    if (times === undefined ? x.times !== undefined : x.times?.op !== '>=' || x.times.value !== times) return null;
    return e.attacker ?? null;
  };
  const a = att(of[0]!);
  const b = att(of[1]!);
  const ab = att(of[2]!, 2);
  if (a === null || b === null || ab === null || JSON.stringify(ab) !== JSON.stringify({ anyOf: [a, b] })) return null;
  return `${K.np(a, st, { det: 'a' })} and ${K.np(b, st, { det: 'a' })} attacked this combat`;
}

/**
 * FAST5 T62 (CR 601.2i; parser/holes/cond.ts#history): "you've cast both a creature spell and a noncreature spell this turn": two cast histories of one scope, each at
 * least one spell, by you, of a kind of its own. Null for anything else.
 */
function bothSpellsPhrase(of: readonly Condition[], st: RenderState): string | null {
  if (of.length !== 2) return null;
  const kinds: string[] = [];
  let scope: string | undefined;
  for (const x of of) {
    if (x.cond !== 'happened' || x.event.ev !== 'cast' || x.event.player !== 'you' || x.by !== undefined || x.times?.op !== '>=' || x.times.value !== 1) return null;
    if (x.event.spell === undefined || x.event.from !== undefined || x.event.via !== undefined || x.event.orCopy === true || x.event.nth !== undefined || (scope !== undefined && scope !== x.scope)) return null;
    scope = x.scope;
    kinds.push(K.np({ ...x.event.spell, stackKind: 'spell' }, st, { det: 'a' }));
  }
  return scope === undefined ? null : `you've cast both ${kinds[0]} and ${kinds[1]} ${scopeWords(scope as never)}`;
}

/**
 * FAST5X E9 (CR 701.22d, 701.25d; parser/holes/cond.ts#history): "you've scried or surveilled this turn" is the `any` of a scry and a surveil by you in the same
 * scope. Null for anything else.
 */
function scriedOrSurveilled(of: readonly Condition[]): string | null {
  if (of.length !== 2) return null;
  const verbs = new Set<string>();
  let scope: string | undefined;
  for (const x of of) {
    if (x.cond !== 'happened' || x.times !== undefined || x.by !== undefined || x.event.ev !== 'action' || x.event.actor !== 'you' || x.event.object !== undefined) return null;
    if (Object.keys(x.event).length !== 3 || (scope !== undefined && scope !== x.scope)) return null;
    scope = x.scope;
    verbs.add(x.event.verb);
  }
  if (!verbs.has('scry') || !verbs.has('surveil') || scope === undefined) return null;
  const sw = scopeWords(scope as Extract<Condition, { cond: 'happened' }>['scope']);
  return alt(`you've scried or surveilled ${sw}`, `you have scried or surveilled ${sw}`, `you scried or surveilled ${sw}`);
}

/**
 * FAST5X E17 (CR 608.2c, 608.2h; parser/holes/cond.ts#destroyedThisWay): "a creature you controlled was destroyed this way", "a permanent you controlled or a
 * token was destroyed this way". The lowering pass lets `which` read only a destroy step, so the verb is "destroyed". No negated wording.
 */
function destroyedThisWayPhrase(which: ObjectFilter, not: boolean, st: RenderState): string {
  if (not) throw new NoRenderer('a negated "was destroyed this way"');
  const one = (f: ObjectFilter): string => {
    if (f.anyOf !== undefined) throw new NoRenderer('a nested "or" in "was destroyed this way"');
    const { controller, ...rest } = f;
    if (controller !== undefined && controller !== 'you') throw new NoRenderer(`"was destroyed this way" with the controller ${JSON.stringify(controller)}`);
    return `${K.np(rest, st, { det: 'a' })}${controller === 'you' ? ' you controlled' : ''}`;
  };
  const keys = Object.keys(which).filter((k) => (which as Record<string, unknown>)[k] !== undefined);
  const np = which.anyOf !== undefined ? (keys.length === 1 && which.anyOf.length === 2 ? which.anyOf.map(one).join(' or ') : null) : one(which);
  if (np === null) throw new NoRenderer('"was destroyed this way" with an "or" of more than two');
  return `${np} was destroyed this way`;
}

/**
 * LOOK3 (CR 608.2c; parser/templates/zz-cloud/look3.json, model/focus.ts#notPutMove): "you don't put the card onto the battlefield" / "you don't put it into your hand":
 * the named move of one card to that zone, the last instruction of the instruction before, was not performed. "The card" and "it" name that card the same way (family
 * not-put-the-card): the words name the move, which the lowering pass found by its place, not by them. No other wording (never "you put ...").
 */
function notPutPhrase(to: string, not: boolean, revealed = false): string {
  if (!not || (to !== 'battlefield' && to !== 'hand')) throw new NoRenderer('a move named by its zone that is not "you don\'t put the card there"');
  const where = to === 'battlefield' ? 'onto the battlefield' : 'into your hand';
  // std-rx31 (family not-put-the-card): the card a choice revealed (render/fold-stdrx31.ts#revealOneFromGroup), "If you didn't put the revealed card onto the battlefield this way"
  if (revealed) return alt(`you don't put ${alt('the card', 'it')} ${where}`, `you didn't put the revealed card ${where} this way`, `you did not put the revealed card ${where} this way`);
  return `you don't put ${alt('the card', 'it')} ${where}`;
}

/**
 * STD-OTJ (CR 608.2c, 608.2h; parser/holes/cond.ts#returnedThisWay): "a permanent was returned this way": the move to the hand right before it put a permanent that
 * matches the description in its owner's hand. No negated wording.
 */
function returnedThisWayPhrase(which: ObjectFilter, not: boolean, st: RenderState): string {
  if (not) throw new NoRenderer('a negated "was returned this way"');
  const { zone: _zone, ...rest } = which;
  if (which.controller !== undefined || which.owner !== undefined) throw new NoRenderer('"was returned this way" with a controller or an owner');
  return `${K.np(rest, st, { det: 'a' })} was returned this way`;
}

/**
 * FAST5 T75 (CR 608.2c, 608.2h; parser/holes/cond.ts#putIntoHandThisWay): "you put a Town card into your hand this way": the move to the hand right before it
 * put a card that matches the description in your hand. One description of a card, no controller (a card in a hand has none); no negated wording.
 */
/**
 * r4-moved (the parser's reading, parser/holes/cond.ts#returnedToYourHandThisWay): "you control a Squirrel or returned a Squirrel card to your hand this way": two
 * conditions joined by "or", the first said with the subject "you", the second a move to your hand of a card (FAST5 T75's `did` with `to: 'hand'`), said with the
 * subject left out. Null for any other list.
 */
function elidedReturnedPhrase(of: readonly Condition[], st: RenderState): string | null {
  const [a, b] = of;
  if (of.length !== 2 || a === undefined || b === undefined || b.cond !== 'did' || b.to !== 'hand' || b.which === undefined || b.not === true || b.which.zone !== undefined) return null;
  const first = K.cond(a, st);
  if (!first.startsWith('you ')) return null;
  const which = b.which;
  if (which.controller !== undefined || which.owner !== undefined) return null;
  const np = K.np({ ...which, zone: 'hand' }, st, { det: 'a', noZone: true });
  return alt(`${first} or ${K.cond(b, st)}`, `${first} or returned ${np} to your hand this way`);
}

function putThisWayPhrase(which: ObjectFilter, not: boolean, st: RenderState): string {
  if (which.controller !== undefined || which.owner !== undefined || which.zone !== undefined) throw new NoRenderer('"you put ... into your hand this way" with a controller, an owner or a zone');
  const np = K.np({ ...which, zone: 'hand' }, st, { det: 'a', noZone: true }); // (a card in a hand: the noun is "card", not "permanent")
  // Cloud std-eoe (CR 608.2c): "If you didn't put a card into your hand this way": the move put no such card into your hand (`did` with `not`)
  // r4-moved: ... said in the present tense too, "If you don't put a card into your hand this way" (parser/holes/cond.ts#putIntoHandThisWay)
  // r5-moved (family dont-put-into-hand): with no description, also "you put no cards into your hand this way" (Nashi, Searcher in the Dark)
  if (not && Object.values(which).every((v) => v === undefined)) return alt(`you ${alt("didn't", "don't")} put ${np} into your hand this way`, 'you put no cards into your hand this way');
  return not ? `you ${alt("didn't", "don't")} put ${np} into your hand this way` : `you put ${np} into your hand this way`;
}

/** Keys sorted at every level (canonical JSON), so the shape below is recognized whatever the order of its fields and operands. */
const sortedJson = (v: unknown): string => (Array.isArray(v) ? `[${v.map(sortedJson).join(',')}]` : v !== null && typeof v === 'object'
  ? `{${Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${sortedJson((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v));
const YOUR_CREATURES_JSON = sortedJson({ ref: 'each', filter: { types: ['Creature'], controller: 'you' } });
const ALL_CREATURES_JSON = sortedJson({ ref: 'each', filter: { types: ['Creature'] } });

/**
 * Cloud std-fin (CR 208.1; parser/holes/cond.ts#GREATEST_POWER_OR_TIED): "you control the creature with the greatest power or tied for the greatest power" is you control a
 * creature and the greatest power among the creatures you control is at least the greatest power among all creatures. Null for any other shape.
 */
function greatestPowerOrTiedPhrase(of: readonly Condition[]): string | null {
  if (of.length !== 2) return null;
  const ex = of.find((x) => x.cond === 'exists');
  const cmp = of.find((x) => x.cond === 'compare');
  if (ex?.cond !== 'exists' || cmp?.cond !== 'compare' || ex.atLeast !== undefined || sortedJson(ex.of) !== YOUR_CREATURES_JSON || cmp.op !== '>=') return null;
  const stat = (q: unknown, of: string): boolean => typeof q === 'object' && q !== null && sortedJson(q) === sortedJson({ q: 'stat', stat: 'power', of: JSON.parse(of), agg: 'max' });
  return stat(cmp.left, YOUR_CREATURES_JSON) && stat(cmp.right, ALL_CREATURES_JSON) ? 'you control the creature with the greatest power or tied for the greatest power' : null;
}

/** FAST5X E17 (CR 601.2i; parser/holes/cond.ts): "you controlled a Mount as you cast ~". Only that form: you controlled an object of a kind. */
function asCastPhrase(held: Condition, st: RenderState): string {
  // std-rn (CR 601.2i, 505.1): "you cast ~ during your main phase" (addendum): a main phase of your own turn when the spell became cast
  if (held.cond === 'turnOf' && held.whose === 'you' && Array.isArray(held.step) && held.step.length === 2 && held.step.includes('main1') && held.step.includes('main2')) {
    return `you cast ${K.obj({ ref: 'self' }, st, 'object').text} during your main phase`;
  }
  if (held.cond !== 'exists' || held.atLeast !== undefined || held.of.ref !== 'each') throw new NoRenderer('an "as you cast" condition other than "you controlled a ..."');
  const { controller, ...rest } = held.of.filter;
  if (controller !== 'you') throw new NoRenderer('an "as you cast" condition about another player');
  return `you controlled ${K.np(rest, st, { det: 'a' })} as you cast ${K.obj({ ref: 'self' }, st, 'object').text}`;
}

/** FAST5X E17: a `matches` whose only test is that you control the object, which is not the source itself ("you controlled it"). */
/** r4-fxb: a condition that only asks whether an opponent controls one object the ability named (not the source). */
function opponentControlsOnly(c: Extract<Condition, { cond: 'matches' }>): boolean {
  const keys = Object.keys(c.filter).filter((k) => (c.filter as Record<string, unknown>)[k] !== undefined);
  return keys.length === 1 && c.filter.controller === 'opponent' && (c.object as { ref?: string }).ref !== 'self';
}

function youControlledOnly(c: Extract<Condition, { cond: 'matches' }>): boolean {
  const keys = Object.keys(c.filter).filter((k) => (c.filter as Record<string, unknown>)[k] !== undefined);
  return keys.length === 1 && c.filter.controller === 'you' && (c.object as { ref?: string }).ref !== 'self';
}

/**
 * FAST5X E22 (CR 119.3, 119.9, 119.10; parser/holes/cond.ts#e22History): "you gained or lost life this turn" is the `any`, "you gained and lost life this turn"
 * the `all`, of a life gain and a life loss by you in this turn's history (each of any amount, not a net change). Null for anything else.
 */
function gainedLostLife(kind: 'all' | 'any', of: readonly Condition[]): string | null {
  if (of.length !== 2) return null;
  const changes = new Set<string>();
  for (const x of of) {
    if (x.cond !== 'happened' || x.scope !== 'turn' || x.times !== undefined || x.by !== undefined || x.event.ev !== 'life' || x.event.player !== 'you') return null;
    if (x.event.amount !== undefined || Object.keys(x.event).length !== 3) return null;
    changes.add(x.event.change);
  }
  if (!changes.has('gain') || !changes.has('loss')) return null;
  const w = kind === 'any' ? 'or' : 'and';
  return alt(`you gained ${w} lost life this turn`, `you've gained ${w} lost life this turn`);
}

/**
 * FAST5X E22 (parser/holes/cond.ts#e22History): the graveyard, exile and sacrifice histories in Oracle's words: "a card left your graveyard this turn", "three
 * or more cards left your graveyard this turn" (CR 400.3), "one or more cards were put into exile this turn", "you sacrificed a permanent this turn", "you
 * sacrificed two or more permanents this turn" (CR 701.21a). Null for any other `happened`.
 */
function e22HistoryPhrase(c: Extract<Condition, { cond: 'happened' }>): string | null {
  const ev = c.event;
  const t = c.times;
  if (c.scope !== 'turn' || c.by !== undefined) return null;
  if (t !== undefined && (t.op !== '>=' || typeof t.value !== 'number' || t.value < 2)) return null;
  const n = t !== undefined ? `${numWord(t.value as number)} or more` : null;
  const keys = (o: object): string => Object.keys(o).sort().join(',');
  if (ev.ev === 'zoneChange' && ev.cause === undefined && ev.byOpponent === undefined) {
    const s = ev.subject as Record<string, unknown>;
    // a card you own that left a graveyard (it was in yours, CR 400.3), to anywhere
    if (ev.from === 'graveyard' && ev.to === undefined && keys(s) === 'isCard,owner' && s['isCard'] === true && s['owner'] === 'you') {
      return n === null ? alt('a card left your graveyard this turn', 'one or more cards left your graveyard this turn') : `${n} cards left your graveyard this turn`;
    }
    // any card put into exile from anywhere
    if (ev.from === undefined && ev.to === 'exile' && keys(s) === 'isCard' && s['isCard'] === true) {
      return n === null ? alt('one or more cards were put into exile this turn', 'a card was put into exile this turn') : `${n} cards were put into exile this turn`;
    }
    return null;
  }
  if (ev.ev === 'action' && ev.verb === 'sacrifice' && ev.actor === 'you' && ev.object === undefined && keys(ev) === 'actor,ev,verb') {
    return n === null
      ? alt('you sacrificed a permanent this turn', 'you sacrificed one or more permanents this turn', "you've sacrificed a permanent this turn")
      : alt(`you sacrificed ${n} permanents this turn`, `you've sacrificed ${n} permanents this turn`);
  }
  // std-ry5 (CR 701.9a; family discarded-this-turn): "you discarded a card this turn" (Mysterio's Mirage) is also "you've discarded a card this turn" (Gilt-Blade Prowler)
  if (ev.ev === 'action' && ev.verb === 'discard' && ev.actor === 'you' && keys(ev) === 'actor,ev,verb' && n === null) return alt('you discarded a card this turn', "you've discarded a card this turn");
  return null;
}

/** r4-fxb (CR 506.1): the turn condition "your combat phase": your turn, any step of a combat phase (parser/holes/cond.ts reads it). */
function isYourCombatPhase(c: Extract<Condition, { cond: 'turnOf' }>): boolean {
  const steps = c.step === undefined ? [] : [c.step].flat();
  return c.whose === 'you' && steps.length === 5 && ['beginCombat', 'declareAttackers', 'declareBlockers', 'combatDamage', 'endCombat'].every((x) => steps.includes(x as never));
}

/** FAST5X E9 (CR 505.1): the turn condition "your main phase": your turn, either main phase (parser/holes/cond.ts reads it). */
function isYourMainPhase(c: Extract<Condition, { cond: 'turnOf' }>): boolean {
  const steps = c.step === undefined ? [] : [c.step].flat();
  return c.whose === 'you' && steps.length === 2 && steps.includes('main1') && steps.includes('main2');
}

function happenedPhrase(c: Extract<Condition, { cond: 'happened' }>, st: RenderState): string {
  // r4-fxb (CR 500.9, 513.1; parser/holes/cond.ts): "it's the first end step of the turn": exactly one end step has begun this turn
  if (c.event.ev === 'step' && c.event.step === 'end' && c.event.whose === undefined && c.event.nth === undefined && c.scope === 'turn' && c.by === undefined
    && c.times?.op === '==' && c.times.value === 1) return alt("it's the first end step of the turn", 'it is the first end step of the turn');
  const scope = scopeWords(c.scope);
  const ev = c.event;
  const t = c.times;
  // FAST5X E25 (CR 708.8; parser/holes/cond.ts#history): "you turned a permanent face up this turn": a permanent turned face up by you
  if (!t && c.by === 'you' && ev.ev === 'becomes' && ev.what === 'turnedFaceUp' && JSON.stringify(ev) === JSON.stringify({ ev: 'becomes', what: 'turnedFaceUp', object: {} })) {
    return alt(`you turned a permanent face up ${scope}`, `you've turned a permanent face up ${scope}`);
  }
  // `by` is worded only for spells that were cast ("you've cast"); for any other event it would be dropped, so it is refused (design 3.3)
  if (ev.ev !== 'cast' && c.by !== undefined && c.by !== 'any') throw new NoRenderer('happened.by on an event that is not a cast');
  if (ev.ev === 'cast') {
    const by = c.by ?? ev.player;
    // FAST5X E2 (CR 702.185c): "a spell was warped this turn" means a spell was cast for its warp cost this turn, by any player; no other form is worded
    if (ev.via !== undefined) {
      if (ev.via !== 'warp' || (by !== undefined && by !== 'any') || t !== undefined || ev.spell !== undefined || ev.from !== undefined || ev.orCopy === true || ev.nth !== undefined) {
        throw new NoRenderer('a cast history for an alternative cost other than "a spell was warped"');
      }
      return `a spell was warped ${scope}`;
    }
    // FAST4 T23: the zone a spell was cast from is worded ("from your hand", CR 601.2a); any other zone, or a caster other than you, has no wording here
    if (ev.from !== undefined) return castFromPhrase(c, st, false);
    const subject = by === 'you' ? "you've" : by === undefined || by === 'any' ? '' : `${K.player(by, st, 'subject').text} has`;
    const kind = ev.spell ? K.np({ ...ev.spell, stackKind: 'spell' }, st, { det: 'none', plural: true }) : 'spells';
    if (t) {
      const n = K.qty(t.value, st);
      const count = t.op === '>=' ? `${n} or more` : t.op === '==' ? n : cmpWords(t.op, n);
      const counted = subject === '' ? `${count} ${kind} were cast ${scope}` : `${subject} cast ${count} ${kind} ${scope}`;
      // FAST5 T62 (CR 601.2i): at least one is "a creature spell" (parser/holes/cond.ts#history reads "you've cast a creature spell this turn" as at least one)
      if (t.op === '>=' && t.value === 1) {
        const a = ev.spell ? K.np({ ...ev.spell, stackKind: 'spell' }, st, { det: 'a' }) : 'a spell';
        // p2-cost-statics-1 (CR 601.2i; family has-cast-or-cast): another player's "has cast a blue spell this turn" is also "cast a blue spell this turn" (Ricochet Trap)
        const bare = subject.endsWith(' has') ? [`${subject.slice(0, -' has'.length)} cast ${a} ${scope}`] : [];
        return alt(counted, subject === '' ? `${a} was cast ${scope}` : `${subject} cast ${a} ${scope}`, ...bare);
      }
      return counted;
    }
    const one = ev.spell ? K.np({ ...ev.spell, stackKind: 'spell' }, st, { det: 'a' }) : 'a spell';
    return subject === '' ? `${one} was cast ${scope}` : `${subject} cast ${one} ${scope}`;
  }
  // FAST5 T63 (CR 701.21a, 118.3): "you've sacrificed an artifact this turn": a permanent matching the description was sacrificed by you this turn
  if (!t && ev.ev === 'action' && ev.verb === 'sacrifice' && ev.actor === 'you' && ev.object !== undefined && Object.keys(ev).length === 4) {
    const what = K.np(ev.object, st, { det: 'a' });
    return alt(`you've sacrificed ${what} ${scope}`, `you sacrificed ${what} ${scope}`);
  }
  // p2-intervening-1 (pack tactics, CR 508.1, 208.1; parser/holes/p2iv1.ts): "you attacked with creatures with total power 6 or greater this combat"
  if (!t && c.by === undefined && ev.ev === 'attacks' && ev.power !== undefined && ev.power.op === '>=' && Object.keys(ev).length === 3 && JSON.stringify(ev.attacker) === JSON.stringify({ controller: 'you' })) {
    return `you attacked with creatures with total power ${K.qty(ev.power.value, st)} or greater ${scope}`;
  }
  // FAST5 T63 (CR 508.1): "you attacked with a Spacecraft this turn": a creature you control matching the description was declared as an attacker this turn
  if (!t && ev.ev === 'attacks' && Object.keys(ev).length === 2 && ev.attacker !== undefined && ev.attacker.controller === 'you' && Object.keys(ev.attacker).length > 1) {
    const { controller: _c, ...rest } = ev.attacker;
    return `you attacked with ${K.np(rest, st, { det: 'a' })} ${scope}`;
  }
  // CLOUD std-ecl (CR 508.1, parser/holes/cond.ts#history): "you attacked with three or more Merfolk this turn": at least N different creatures you control of the
  // description were declared as attackers this turn (rules/history.ts#countHistory counts each attacker once)
  if (t !== undefined && t.op === '>=' && c.by === undefined && ev.ev === 'attacks' && Object.keys(ev).length === 2 && ev.attacker !== undefined && ev.attacker.controller === 'you'
    && Object.keys(ev.attacker).length > 1) {
    const { controller: _c, ...rest } = ev.attacker;
    return `you attacked with ${K.qty(t.value, st)} or more ${K.np(rest, st, { det: 'none', plural: true })} ${scope}`;
  }
  // r5-fxb (CR 508.1, parser/holes/cond.ts#history): "three or more creatures attacked this turn": at least N different creatures, whoever controlled them
  if (t !== undefined && t.op === '>=' && c.by === undefined && ev.ev === 'attacks' && Object.keys(ev).length === 2 && ev.attacker !== undefined
    && ev.attacker.controller === undefined && (ev.attacker.types ?? []).includes('Creature')) {
    return `${K.qty(t.value, st)} or more ${K.np(ev.attacker, st, { det: 'none', plural: true })} attacked ${scope}`;
  }
  // FAST5X E9 (CR 400.7, parser/holes/cond.ts#history): "~ entered this turn": this object entered the battlefield this turn
  if (!t && ev.ev === 'zoneChange' && ev.to === 'battlefield' && ev.from === undefined && ev.cause === undefined && Object.keys(ev.subject).length === 1 && ev.subject.self === true) {
    const me = K.obj({ ref: 'self' }, st, 'subject').text;
    return alt(`${me} entered ${scope}`, `${me} entered the battlefield ${scope}`);
  }
  // CLOUD std-msh (CR 122.6, 122.6a; parser/holes/cond.ts#history): "you've put one or more +1/+1 counters on ~ this turn" (Beast, Erudite Aerialist): counters of
  // that kind that you put on this object (the putter recorded in the history, FAST5X E21's `by`)
  if (!t && c.by === undefined && ev.ev === 'counters' && ev.change === 'put' && ev.by === 'you' && ev.kind !== undefined && ev.atLeast === undefined && ev.byEffect === undefined
    && !('player' in ev.on) && JSON.stringify(ev.on) === JSON.stringify({ self: true }) && Object.keys(ev).length === 5) {
    const me = K.obj({ ref: 'self' }, st, 'object').text;
    return alt(`you've put one or more ${ev.kind} counters on ${me} ${scope}`, `you put one or more ${ev.kind} counters on ${me} ${scope}`);
  }
  const moved = zoneHistoryPhrase(c, st);
  if (moved !== null) return moved;
  const e22 = e22HistoryPhrase(c); // FAST5X E22
  if (e22 !== null) return e22;
  // std-mkm (CR 400.3, 603.4): "three or more creature cards were put into graveyards from anywhere this turn" (parser/holes/cond.ts#e22History)
  if (c.scope === 'turn' && c.by === undefined && t !== undefined && t.op === '>=' && typeof t.value === 'number' && t.value >= 2 && ev.ev === 'zoneChange' && ev.from === undefined
    && ev.to === 'graveyard' && ev.cause === undefined && ev.byOpponent === undefined && Object.keys(ev).every((k) => ['ev', 'subject', 'to'].includes(k))) {
    const s = ev.subject as ObjectFilter;
    if (s.isCard === true && s.zone === undefined && s.owner === undefined && s.controller === undefined && Object.keys(s).some((k) => k !== 'isCard')) {
      return `${numWord(t.value)} or more ${K.np({ ...s, isCard: undefined }, st, { det: 'none', plural: true, head: 'card' })} were put into graveyards from anywhere this turn`;
    }
  }
  const dealt = damageHistoryPhrase(c, st); // r4-cost
  if (dealt !== null) return dealt;
  const past = K.event(ev, st, 'past');
  // FAST5X E9: "you've lost life this turn" / "you've gained life this turn", the present perfect Oracle also prints (parser/holes/cond.ts#history reads both)
  if (!t && ev.ev === 'life' && ev.player === 'you' && ev.amount === undefined && Object.keys(ev).length === 3) {
    const verb = ev.change === 'loss' ? 'lost' : 'gained';
    return alt(`${past} ${scope}`, `you've ${verb} life ${scope}`, `you have ${verb} life ${scope}`);
  }
  // FAST5X E20 (CR 700.13): "you've committed a crime this turn", the present perfect Oracle prints (parser/holes/cond.ts#history reads both)
  if (!t && ev.ev === 'action' && ev.verb === 'commitCrime' && ev.actor === 'you' && Object.keys(ev).length === 3) return alt(`${past} ${scope}`, `you've committed a crime ${scope}`);
  // Standard round 3, r3-trig (CR 606.3): "you've activated a loyalty ability this turn", the present perfect Oracle prints (parser/holes/cond.ts#history reads both)
  if (!t && ev.ev === 'activate' && ev.player === 'you' && ev.ability === 'loyalty' && Object.keys(ev).length === 3) return alt(`${past} ${scope}`, `you've activated a loyalty ability ${scope}`);
  // FAST2 T8: "you attacked this turn" (raid): a creature you controlled attacked (the parser's reading, parser/holes/cond.ts#history)
  if (!t && ev.ev === 'attacks' && Object.keys(ev).length === 2 && ev.attacker !== undefined && Object.keys(ev.attacker).length === 1 && ev.attacker.controller === 'you') return alt(`${past} ${scope}`, `you attacked ${scope}`);
  if (t) return `${past} ${cmpWords(t.op, K.qty(t.value, st))} ${t.op === '==' && typeof t.value === 'number' && t.value === 1 ? 'time' : 'times'} ${scope}`;
  return p2iv3Moved(c, `${past} ${scope}`); // p2-intervening-3 (CR 400.3; render/p2iv3.ts)
}

/**
 * r4-cost (CR 120.1, 510.2; parser/holes/cost-conds.ts): damage dealt to an opponent this turn, in the passive Oracle prints: "an opponent has been dealt noncombat
 * damage this turn" (beside FAST5X E9's "was dealt"), "an opponent was dealt combat damage by a legendary creature this turn" (the source as it dealt it). Only one
 * event to "an opponent", noncombat with no source or combat with a described source; null for anything else.
 */
function damageHistoryPhrase(c: Extract<Condition, { cond: 'happened' }>, st: RenderState): string | null {
  const ev = c.event;
  if (ev.ev !== 'damage' || c.times !== undefined || c.by !== undefined || ev.amount !== undefined || ev.recipient?.player !== 'opponent' || ev.recipient.object !== undefined) return null;
  if (Object.keys(ev).some((k) => !['ev', 'combat', 'recipient', 'source'].includes(k)) || Object.keys(ev.recipient).length !== 1) return null;
  const scope = scopeWords(c.scope);
  if (ev.combat === false && ev.source === undefined) return alt(`an opponent was dealt noncombat damage ${scope}`, `an opponent has been dealt noncombat damage ${scope}`);
  if (ev.combat === true && ev.source !== undefined && ev.source.self === undefined && Object.keys(ev.source).length > 0) return `an opponent was dealt combat damage by ${K.np(ev.source, st, { det: 'a' })} ${scope}`;
  return null;
}

/**
 * FAST4 T23 (parser/holes/cond.ts#t23Misc): "you've cast a spell from your hand this turn" and its negation "you haven't cast a spell from your hand this
 * turn" (CR 601.2a). Only that shape: a cast history with another zone, caster, kind of spell or count has no wording here.
 */
function castFromPhrase(c: Extract<Condition, { cond: 'happened' }>, st: RenderState, negate: boolean): string {
  const ev = c.event;
  if (ev.ev !== 'cast') throw new NoRenderer('castFromPhrase on an event that is not a cast');
  const by = c.by ?? ev.player;
  if (by !== 'you' || ev.from !== 'hand' || c.times !== undefined || ev.spell !== undefined || ev.orCopy === true || ev.nth !== undefined || ev.via !== undefined) {
    throw new NoRenderer('a cast history from a zone other than "a spell from your hand"');
  }
  const scope = scopeWords(c.scope);
  return negate ? `you haven't cast a spell from your hand ${scope}` : `you've cast a spell from your hand ${scope}`;
}

/**
 * FAST4 T23 (parser/holes/cond.ts#zoneHistory): objects that changed zones this turn, in Oracle's words: "a creature died under your control this turn",
 * "three or more creatures died this turn", "two or more nonland permanents entered the battlefield under your control this turn", "a permanent left the
 * battlefield under your control this turn" (CR 700.4, 603.10a). Null for any other `happened` (and for "a creature died this turn", which keeps its wording).
 */
function zoneHistoryPhrase(c: Extract<Condition, { cond: 'happened' }>, st: RenderState): string | null {
  const ev = c.event;
  if (ev.ev !== 'zoneChange' || ev.cause !== undefined || Array.isArray(ev.from) || Array.isArray(ev.to)) return null;
  const t = c.times;
  if (t !== undefined && (t.op !== '>=' || typeof t.value !== 'number' || t.value < 2)) return null;
  const verb = ev.from === 'battlefield' && ev.to === 'graveyard' ? 'died'
    : ev.from === undefined && ev.to === 'battlefield' ? 'entered the battlefield'
      : ev.from === 'battlefield' && ev.to === undefined ? 'left the battlefield' : null;
  if (verb === null) return null;
  const ctl = ev.subject.controller;
  if (ctl !== undefined && ctl !== 'you' && ctl !== 'opponent') return null; // FAST5 T53 (CR 603.10a): "died under an opponent's control"
  const under = ctl !== undefined;
  if (!under && t === undefined && verb === 'died') return null;
  const f: ObjectFilter = { ...ev.subject };
  delete f.controller;
  // FAST5X E25 (CR 708.3): "a permanent entered the battlefield face down under your control this turn"
  const np = (g: ObjectFilter): string => (t === undefined ? K.np(g, st, { det: 'a' }) : K.np(g, st, { det: 'none', plural: true, count: `${numWord(t.value as number)} or more` }));
  const tail = `${ctl === 'you' ? ' under your control' : ctl === 'opponent' ? " under an opponent's control" : ''} ${scopeWords(c.scope)}`;
  if (f.faceDown === true && verb === 'entered the battlefield') {
    // "a face-down creature entered the battlefield" and "a creature entered the battlefield face down": the object was face down as it entered (CR 708.3)
    const { faceDown: _fd, ...g } = f;
    return alt(`${np(f)} ${verb}${tail}`, `${np(g)} ${verb} face down${tail}`);
  }
  // std-lci (CR 603.4; parser/holes/cond.ts#zoneHistory): "this artifact or another artifact entered the battlefield under your control this turn": the model says "an
  // artifact", which includes the object itself when it is one (RenderContext.selfTypes, as render/evt.ts says "~ or another creature" of a trigger event)
  const selfTypes = st.ctx.selfTypes?.map((x) => x.toLowerCase());
  const kinds = [...(f.types ?? []), ...(f.subtypes ?? [])].map((x) => x.toLowerCase());
  const selfIn = (ws: readonly string[] | undefined): boolean => ws === undefined || ws.length === 0 || ws.some((x) => selfTypes!.includes(x.toLowerCase()));
  if (t === undefined && selfTypes !== undefined && kinds.length > 0 && selfIn(f.types) && selfIn(f.subtypes) && Object.keys(f).every((k) => k === 'types' || k === 'subtypes')) {
    // p2-damage-3 (family landfall-you-had): "Activate only if you had a creature enter the battlefield under your control this turn" on a creature (Zhalfirin Decoy)
    const had = ctl === 'you' && verb === 'entered the battlefield' ? [`you had ${np(f)} enter the battlefield${tail}`] : [];
    return alt(`${np(f)} ${verb}${tail}`, `~ or ${K.np({ ...f, other: true }, st, { det: 'a' })} ${verb}${tail}`, ...had);
  }
  // p2-damage-3 (CR 603.4, 207.2c; parser/holes/cond.ts#zoneHistory): Landfall's "you had a land enter the battlefield under your control this turn" (Searing Blaze)
  if (t === undefined && ctl === 'you' && verb === 'entered the battlefield') return alt(`${np(f)} ${verb}${tail}`, `you had ${np(f)} enter the battlefield${tail}`);
  return `${np(f)} ${verb}${tail}`;
}

const COMPARE_MORE: Partial<Record<Cmp, [string, string]>> = { '>=': ['', ' or more'], '<=': ['', ' or less'], '==': ['exactly ', ''], '>': ['more than ', ''], '<': ['less than ', ''] };

/**
 * STD-OTJ (CR 208.1, 608.2b): "no other creature has greater power" is a power at least the greatest power among all creatures (ties allowed; the object is itself
 * one of the creatures, so "other" excludes only it, and no creature is above it exactly when it is the greatest). The wording names no object, so the object of
 * the comparison (a target of the same sentence) is named by the instruction itself and the plain wording ("its power is at least ...") is not offered.
 */
function noGreaterPower(c: Extract<Condition, { cond: 'compare' }>): boolean {
  const { left, right } = c;
  return typeof left === 'object' && left.q === 'stat' && left.stat === 'power' && left.agg === undefined && left.sum !== true && c.op === '>='
    && typeof right === 'object' && right.q === 'stat' && right.stat === 'power' && right.agg === 'max' && right.sum !== true
    && right.of.ref === 'each' && 'filter' in right.of && Object.keys(right.of.filter).length === 1 && right.of.filter.types?.length === 1 && right.of.filter.types[0] === 'Creature';
}

/**
 * How Oracle writes a comparison of the usual quantities: "you have 40 or more life", "seven or more cards are in your graveyard", "you control three or more
 * creatures", "there are four or more card types among cards in your graveyard", "you have more life than an opponent" (CR 119, 700.5, 404).
 */
/** CLOUD std-dft: the object of n - 2 * floor(n / 2) with n the number of counters of every kind on it (parser/holes/cond.ts#counterParity), or null. */
function counterParityOf(q: Quantity): ObjRef | null {
  if (typeof q !== 'object' || q.q !== 'math' || q.op !== '-' || q.args.length !== 2) return null;
  const [n, twice] = q.args;
  if (typeof n !== 'object' || n.q !== 'counters' || n.kind !== 'any') return null;
  if (typeof twice !== 'object' || twice.q !== 'math' || twice.op !== '*' || twice.args.length !== 2 || twice.args[0] !== 2) return null;
  const half = twice.args[1]!;
  if (typeof half !== 'object' || half.q !== 'math' || half.op !== 'floorDiv' || half.args.length !== 2 || half.args[1] !== 2) return null;
  return JSON.stringify(half.args[0]) === JSON.stringify(n) ? (n.on as ObjRef) : null;
}

function compareIdiom(c: Extract<Condition, { cond: 'compare' }>, st: RenderState): string | null {
  const left = c.left;
  const right = c.right;
  if (typeof left !== 'object') return null;
  const pre = COMPARE_MORE[c.op];
  const num = typeof right === 'number' ? numWord(right) : null;
  switch (left.q) {
    // std-library-3 (CR 608.2c, 608.2h; parser/holes/moved.ts): "you exiled four or more cards this way" (render/moved.ts#movedAtLeastPhrase)
    case 'resultCount': {
      if (c.op !== '>=' || typeof right !== 'number' || right < 2) return null;
      return movedAtLeastPhrase(left, right, st);
    }
    // cloud r3-mech (CR 120.1, 719.3a; parser/holes/cond.ts#sourcesDealtDamage): "three or more sources you controlled dealt damage this turn"
    case 'happenedDistinct': {
      const ev = left.event as { ev?: string; source?: unknown };
      if (left.what !== 'sources' || c.op !== '>=' || num === null || left.scope !== 'turn' || left.by !== undefined || ev.ev !== 'damage' || Object.keys(ev).length !== 2
        || JSON.stringify(ev.source) !== JSON.stringify({ controller: 'you' })) return null;
      return `${num} or more sources you controlled dealt damage this turn`;
    }
    // r4-static (CR 709.5c, 709.5j): "there are two or more unlocked doors among Rooms you control" (parser/holes/cond.ts#thereAre)
    case 'unlockedDoors': {
      if (c.op !== '>=' || num === null || left.among.ref !== 'each' || !('filter' in left.among)) return null;
      return `there are ${num} or more unlocked doors among ${K.np(left.among.filter, st, { det: 'none', plural: true })}`;
    }
    // CLOUD std-dft (CR 122.1; parser/holes/cond.ts#counterParity): "it has an even number of counters on it", "it has an odd number of counters on it"
    case 'math': {
      const parity = counterParityOf(left);
      if (parity === null || (right !== 0 && right !== 1) || (c.op !== '==' && c.op !== '!=')) return null;
      const odd = (right === 1) !== (c.op === '!=');
      return `${K.obj(parity, st, 'subject').text} has an ${odd ? 'odd' : 'even'} number of counters on it`;
    }
    // M12-3 (CR 701.38a-b): "if carnage gets more votes" (more than the other word of a vote for two words), "if homage gets more votes or the vote is tied"
    case 'votes': {
      if (typeof right !== 'object' || right.q !== 'votes' || right.step !== left.step || right.choice === left.choice) return null;
      if (c.op === '>') return `${left.choice} gets more votes`;
      if (c.op === '>=') return `${left.choice} gets more votes or the vote is tied`;
      return null;
    }
    // trek-6 (CR 122.1, 122.6, 608.2c; parser/holes/cond.ts#countersPutThisWay): "you put two or more +1/+1 counters on creatures this way": the counters the instruction right
    // before it put (render/steps-life.ts binds the step's name with what it put them on), the objects said by the nouns they are
    case 'countersPut': {
      if (c.op !== '>=' || typeof right !== 'number' || right < 1 || num === null) return null;
      const nouns = st.info.get(`b:${left.step}`)?.nouns;
      if (nouns === undefined || nouns.length === 0) return null;
      return `you put ${num} or more ${left.kind === undefined ? 'counters' : `${left.kind} counters`} on ${pluralize(nouns[0]!)} this way`; // the first noun is the most specific one (render/np.ts#nounsOf)
    }
    // FAST5X E16 (CR 120.10, 608.2c): "if excess damage was dealt [to that creature] this way", "if that creature is dealt excess damage this way"
    case 'excessDamage': {
      if (c.op !== '>' || right !== 0) return null;
      if (left.to === undefined) return alt('excess damage was dealt this way', 'excess damage is dealt this way');
      const to = excessRecipient(left.to, st);
      return alt(`excess damage was dealt to ${to} this way`, `excess damage is dealt to ${to} this way`, `${to} is dealt excess damage this way`, `${to} was dealt excess damage this way`);
    }
    // cloud std-spm (CR 119.3, 608.2c): "if you lost life this way" (the life one player lost in the instruction before)
    case 'lifeLost': {
      if (c.op !== '>' || right !== 0 || left.who === undefined) return null;
      return `${K.player(left.who, st, 'subject').text} lost life this way`;
    }
    case 'unspentMana': {
      // FAST5X E19 (CR 106.4): "you have six or more unspent mana"
      if (c.op !== '>=' || num === null || left.type !== undefined) return null;
      return `you have ${num} or more unspent mana`;
    }
    case 'spellManaSpent': {
      // FAST5X E19 (CR 601.2h; opus): "five or more mana was spent to cast that spell", "at least four mana was spent to cast it"
      // FAST5 T51 (CR 601.2h): "the amount of mana spent to cast it was less than its mana value" (a quantity to compare with)
      if (num === null && left.of !== undefined && left.from === undefined && (c.op === '<' || c.op === '>')) {
        return `the amount of mana spent to cast ${spentObjectText(left.of, st)} was ${cmpWords(c.op, K.qty(right, st))}`;
      }
      if (c.op !== '>=' || num === null || left.of === undefined) return null;
      const of = spentObjectText(left.of, st);
      // FAST5X E19 (CR 106.3): "mana from a Treasure was spent to cast it"
      if (left.from !== undefined) return right === 1 ? `mana from ${K.np(left.from, st, { det: 'a' })} was spent to cast ${of}` : null;
      return alt(`${num} or more mana was spent to cast ${of}`, `at least ${num} mana was spent to cast ${of}`);
    }
    case 'manaSpent': {
      // FAST5 T51 (CR 601.2h): an object that was not cast had no mana spent on it, so "it wasn't cast or no mana was spent to cast it" is no mana spent on this object
      if (c.op !== '==' || right !== 0) return null;
      const self = K.obj({ ref: 'self' }, st, 'subject').text;
      return alt(`${self} wasn't cast or no mana was spent to cast ${self}`, "it wasn't cast or no mana was spent to cast it", `${self} wasn't cast or no mana was spent to cast it`, `it wasn't cast or no mana was spent to cast ${self}`);
    }
    case 'resolvedThisTurn': {
      // FAST5X E17 (CR 608.2): "this is the second time this ability has resolved this turn"; a later sentence of the ability names the same count again,
      // "if it's the second time" (parser/holes/cond.ts reads both); "the first or second time" is a count of at most 2
      if (typeof right !== 'number' || right < 1) return null;
      const res = 'time this ability has resolved this turn';
      if (c.op === '<=' && right === 2) return `this is the first or second ${res}`;
      if (c.op !== '==' || right > 5) return null;
      const ord = ordinal(right);
      return right >= 2 ? alt(`this is the ${ord} ${res}`, `it's the ${ord} time`, `it is the ${ord} time`) : `this is the ${ord} ${res}`;
    }
    case 'kickCount': {
      // M6-5: "if it was kicked twice" (CR 702.33d: a spell with two kicker costs may be kicked twice; Archangel of Wrath)
      if (c.op !== '>=' || right !== 2 || left.name !== undefined) return null;
      return `${K.obj({ ref: 'self' }, st, 'subject').text} was kicked twice`;
    }
    case 'counters': {
      // std-rx24 (CR 122.1f): "defending player is poisoned", "its controller has three or more poison counters" (parser/holes/cond.ts#poisonCounters): the poison
      // counters of one player; one or more of them is "poisoned" (family poisoned-one-or-more)
      if (left.kind === 'poison' && isPlayerRef(left.on, st)) {
        if (c.op !== '>=' || num === null || typeof right !== 'number' || right < 1) return null;
        const who = K.player(left.on as PlayerRef, st, 'subject');
        const sg = who.person === 'sg';
        const has = `${who.text} ${sg ? 'has' : 'have'} ${num} or more poison counters`;
        return right === 1 ? alt(has, `${who.text} ${sg ? 'is' : 'are'} poisoned`) : has;
      }
      // FAST4 T24: "~ has a counter on it" (CR 122.1): one or more counters of any kind on the object itself
      if (c.op === '>=' && right === 1 && left.kind === 'any' && typeof left.on === 'object' && (left.on as { ref?: string }).ref === 'self') {
        return `${K.obj({ ref: 'self' }, st, 'subject').text} has a counter on it`;
      }
      // std-rg (CR 122.1): "there are twenty-five or more loyalty counters among Jaces you control": the counters of one kind on all the objects of a description
      if (c.op === '>=' && num !== null && left.kind !== 'any' && typeof left.on === 'object' && left.on.ref === 'each' && 'filter' in left.on) {
        return `there are ${num} or more ${left.kind} counters among ${K.np(left.on.filter, st, { det: 'none', plural: true })}`;
      }
      // p2-counters-state-1 (CR 122.1): "there are no depletion counters on ~" (parser/holes/cond.ts#thereAre): none of one kind on the object itself;
      // p2-intervening-1 (family no-kind-counters-on-self): also "~ doesn't have an arrowhead counter on it" (Serrated Arrows)
      if (c.op === '==' && right === 0 && left.kind !== 'any' && typeof left.on === 'object' && (left.on as { ref?: string }).ref === 'self') {
        return alt(`there are no ${left.kind} counters on ${K.obj({ ref: 'self' }, st, 'object').text}`, `${K.obj({ ref: 'self' }, st, 'subject').text} doesn't have ${withArticle(`${left.kind} counter`)} on it`);
      }
      // M6-4: "there are two or more ki counters on ~" (the Kamigawa flip cards; CR 122.1): the counters of one kind on the object itself
      if (c.op !== '>=' || num === null || left.kind === 'any' || typeof left.on !== 'object' || (left.on as { ref?: string }).ref !== 'self') return null;
      return `there are ${num} or more ${left.kind} counters on ${K.obj({ ref: 'self' }, st, 'object').text}`;
    }
    case 'happenedCount': {
      // M6-0: "a player cast two or more spells last turn" (the per-player maximum; the back faces of the Innistrad werewolves)
      const ev = left.event;
      // Standard round 5, r5-trig (CR 120.1, 510.2; Sidequest: Play Blitzball): "a player was dealt 6 or more combat damage this turn" (the per-player total)
      if (left.sum === 'amount' && left.per === 'player' && num !== null && c.op === '>=' && ev.ev === 'damage' && ev.source === undefined && ev.amount === undefined && ev.excess === undefined
        && (ev.recipient?.player === 'any' || ev.recipient?.player === 'opponent') && ev.recipient.object === undefined && left.by === undefined && left.beforeEvent === undefined && left.scope === 'turn') {
        // p2-exile-play-1 (Spinerock Knoll): "an opponent was dealt 7 or more damage this turn", only an opponent's damage added up
        if (ev.recipient.player === 'opponent') return `an opponent was dealt ${num} or more ${ev.combat === true ? 'combat ' : ev.combat === false ? 'noncombat ' : ''}damage this turn`;
        return `a player was dealt ${num} or more ${ev.combat === true ? 'combat ' : ev.combat === false ? 'noncombat ' : ''}damage this turn`;
      }
      // std-rB (CR 120.1; parser/holes/cond.ts#sourcesDealtDamage): "red sources you controlled dealt 4 or more noncombat damage this turn" (this turn's damage added up)
      if (left.sum === 'amount' && left.per === undefined && num !== null && c.op === '>=' && ev.ev === 'damage' && ev.recipient === undefined && ev.amount === undefined && ev.excess === undefined
        && left.by === undefined && left.beforeEvent === undefined && left.scope === 'turn' && ev.source !== undefined && ev.source.controller === 'you') {
        const colors = ev.source.colors;
        if (Object.keys(ev.source).some((k) => k !== 'controller' && k !== 'colors') || (colors !== undefined && colors.length !== 1)) return null;
        const color = colors === undefined ? '' : `${COLOR_WORD[colors[0]!]} `;
        return `${color}sources you controlled dealt ${num} or more ${ev.combat === true ? 'combat ' : ev.combat === false ? 'noncombat ' : ''}damage this turn`;
      }
      if (left.sum !== undefined) return null;
      // p2-cost-statics-1 (CR 601.2i; model/forms.ts#isOpponentSpellsPerPlayer): "an opponent cast three or more spells this turn" (Mindbreak Trap)
      if (isOpponentSpellsPerPlayer(left) && num !== null && c.op === '>=') return `an opponent cast ${num} or more spells this turn`;
      if (left.per !== 'player' || num === null || c.op !== '>=' || ev.ev !== 'cast' || ev.player !== undefined || ev.spell !== undefined || (left.by !== undefined && left.by !== 'any')) return null;
      return `a player cast ${num} or more spells ${scopeWords(left.scope)}`;
    }
    // std-rx4 (CR 119.3, 120.3a): "they lost life this turn", "that player lost life this turn": the life a player named before lost this turn is 1 or more
    // (parser/holes/cond.ts#anaphorLostLife; "you lost life this turn" is the history reading, render/condition.ts)
    case 'lifeLostThisTurn': {
      if (c.op !== '>=' || right !== 1 || left.of.ref === 'you') return null;
      const who = K.player(left.of, st, 'subject');
      return who.they === true ? alt(`${who.text} lost life this turn`, 'they lost life this turn') : `${who.text} lost life this turn`;
    }
    case 'life': {
      const who = K.player(left.of, st, 'subject');
      const have = who.person === 'sg' ? 'has' : 'have';
      if (typeof right === 'object' && right.q === 'life' && (c.op === '>' || c.op === '<')) {
        return `${who.text} ${have} ${c.op === '>' ? 'more' : 'less'} life than ${K.player(right.of, st, 'subject').text}`;
      }
      // FAST5 T60 (CR 103.4, 119.1): "you have at least 7 life more than your starting life total" (Leyline of Hope): at least N above the starting life total
      if (c.op === '>=' && typeof right === 'object' && right.q === 'math' && right.op === '+' && right.args.length === 2) {
        const [a, b] = right.args;
        const n = typeof a === 'object' && a.q === 'startingLife' ? b : typeof b === 'object' && b.q === 'startingLife' ? a : undefined;
        if (typeof n === 'number' && n >= 1) {
          const base = `${who.text} ${have} at least ${n} life more than ${left.of.ref === 'you' ? 'your' : 'their'} starting life total`;
          // std-rh (CR 103.4, 119.1): Elenda, Saint of Dusk prints the same comparison as "your life total is at least 10 greater than your starting life total"
          return left.of.ref === 'you' ? alt(base, `your life total is at least ${n} greater than your starting life total`) : base;
        }
      }
      // r5-fxb (CR 103.4, 119.1): "your life total is less than or equal to half your starting life total": at most half of it rounded down (a life total is whole)
      if (c.op === '<=' && left.of.ref === 'you' && typeof right === 'object' && right.q === 'math' && right.op === 'floorDiv' && right.args.length === 2
        && typeof right.args[0] === 'object' && right.args[0].q === 'startingLife' && right.args[1] === 2) return 'your life total is less than or equal to half your starting life total';
      if (num === null || !pre) return null;
      return `${who.text} ${have} ${pre[0]}${String(right)}${pre[1]} life`;
    }
    // FAST4 T24: "you gained life this turn" is gaining one or more life this turn (CR 119.3, 119.9; the controller's own count, statics/match.ts)
    case 'zoneSize': {
      if (num === null || left.zone === 'battlefield' || (c.op !== '>=' && c.op !== '<=' && c.op !== '==' && !(c.op === '<' && left.zone === 'hand'))) return null;
      const zone = left.zone === 'exile' ? 'exile' : `${K.player(left.of, st, 'possessive').text} ${left.zone}`;
      // FAST5 T62 (CR 402.1): "you have fewer than four cards in hand"
      const amount = c.op === '>=' ? `${num} or more` : c.op === '<=' ? `${num} or fewer` : c.op === '<' ? `fewer than ${num}` : `exactly ${num}`;
      const base = `${amount} cards are in ${zone}`;
      // FAST3 T12: "you have no cards in hand" (hellbent; CR 402.1: your hand): exactly zero cards in your own hand
      if (left.zone === 'hand' && c.op === '==' && right === 0 && left.of.ref === 'you') return alt(base, 'you have no cards in hand');
      // p2-intervening-1 (CR 402.1; parser/holes/p2iv1.ts): "that player has no cards in hand"
      if (left.zone === 'hand' && c.op === '==' && right === 0) { const who = K.player(left.of, st, 'subject'); return alt(base, `${who.text} ${who.person === 'sg' ? 'has' : 'have'} no cards in hand`); }
      // FAST4 T23: "that player has two or fewer cards in hand", "you have seven or more cards in hand" (CR 402.1: the player's own hand)
      if (left.zone === 'hand' && c.op !== '==') {
        const who = K.player(left.of, st, 'subject');
        const has = `${who.text} ${who.person === 'sg' ? 'has' : 'have'} ${amount} cards in`;
        // r3-fx (CR 402.1): "you have seven or more cards in your hand" (Resonating Lute): your own hand said with its possessive
        // p2-intervening-1 (CR 402.1; parser/holes/p2iv1.ts): "you have a card in hand" is one or more
        const one = c.op === '>=' && right === 1 && left.of.ref === 'you' ? ['you have a card in hand'] : [];
        return alt(base, `${has} hand`, ...(left.of.ref === 'you' ? [`${has} your hand`] : []), ...one);
      }
      // p2-attack-block-2 (CR 404.1, 506.2): "defending player has seven or more cards in their graveyard" (Vantress Gargoyle): the player's own graveyard
      if (left.zone === 'graveyard' && left.of.ref === 'defending' && c.op === '>=') return alt(base, `defending player has ${amount} cards in their graveyard`);
      return base;
    }
    // FAST5X E22 (CR 700.11): "you descended this turn" is one or more permanent cards put into your graveyard this turn
    case 'descendedThisTurn': return c.op === '>=' && right === 1 ? 'you descended this turn' : null;
    case 'lifeGainedThisTurn': {
      // FAST4 T24: "you gained life this turn" is gaining one or more life this turn (CR 119.3, 119.9; the controller's own count, statics/match.ts)
      if (c.op === '>=' && right === 1) return 'you gained life this turn';
      // FAST4 T26: "you've gained 3 or more life this turn" (CR 119.3; the quantity counts the life its controller gained this turn)
      if (num === null || c.op !== '>=') return null;
      return alt(`you've gained ${num} or more life this turn`, `you gained ${num} or more life this turn`);
    }
    case 'stat': {
      if (left.sum) {
        // FAST4 T32 (parser/holes/cond.ts#t32Cond): "creatures you control have total toughness 10 or greater" (CR 208.1)
        if (left.stat === 'toughness' && c.op === '>=' && num !== null && left.of.ref === 'each' && 'filter' in left.of) {
          return `${K.np(left.of.filter, st, { det: 'none', plural: true })} have total toughness ${num} or greater`;
        }
        // FAST4 T23 (parser/holes/cond.ts#t23Misc): "creatures you control have total power 8 or greater" (CR 208.1)
        if (left.stat !== 'power' || c.op !== '>=' || num === null || left.of.ref !== 'each' || !('filter' in left.of)) return null;
        return `${K.np(left.of.filter, st, { det: 'none', plural: true })} have total power ${num} or greater`;
      }
      // STD-OTJ (CR 208.1, 608.2b): see `noGreaterPower`
      if (noGreaterPower(c)) return 'no other creature has greater power';
      // FAST4 T26: "if its mana value was 2 or less" (CR 608.2h: a property of an object that may have left is read from last known information); the
      // past tense says the same comparison. CLOUD std-misc (Massacre Girl, Known Killer): also a strict one, "if its toughness was less than 1"
      if (!pre || (c.op !== '<=' && c.op !== '>=' && c.op !== '<' && c.op !== '>')) return null;
      return `${K.qty(left, st)} was ${cmpWords(c.op, K.qty(right, st))}`;
    }
    case 'spellsCastThisTurn': {
      // FAST4 T33: "you've cast two or more spells this turn" (CR 601.2i; the quantity counts the spells its controller cast this turn, statics/match.ts)
      if (num === null || c.op !== '>=') return null;
      return alt(`you've cast ${num} or more spells this turn`, `you cast ${num} or more spells this turn`);
    }
    case 'cardsDrawnThisTurn': {
      // FAST3 T12: "you've drawn two or more cards this turn" (CR 121.1; the quantity counts the cards its controller drew this turn)
      // p2-counters-move-2 (CR 121.1): the strict comparison too, "if you've drawn more than one card this turn" (Proft's Eidetic Memory)
      if (num !== null && c.op === '>' && typeof right === 'number') return `you've drawn more than ${num} card${right === 1 ? '' : 's'} this turn`;
      if (num === null || c.op !== '>=') return null;
      return `you've drawn ${num} or more cards this turn`;
    }
    case 'count': {
      // FAST5 T62 (CR 603.4): the description counted for every opponent together is more than the same one counted for you; FAST5 T70 (CR 608.2c): the same
      // comparison with the description as an `anyOf` of one description beside the controller (FAST5 batch 9 integration: both shapes). opp-port-1 (OPP2 of
      // 2026-10-17; CR 102.3, 806): that is "your opponents control more lands than you"; "an opponent controls more lands than you" is one opponent alone
      // (`countPlayers.controlsVs`, std-sos review), which the parser reads (parser/holes/cond.ts#control). The two agree in a two-player game only.
      if (typeof right === 'object' && right.q === 'count') {
        if (c.op !== '>' || left.of.ref !== 'each' || right.of.ref !== 'each' || !('filter' in left.of) || !('filter' in right.of)) return null;
        const description = (f: ObjectFilter, who: string): ObjectFilter | null =>
          f.anyOf?.length === 1 && f.controller === who && Object.keys(f).every((k) => k === 'anyOf' || k === 'controller') ? f.anyOf[0]! : null;
        const theirs = description(left.of.filter, 'opponent');
        const mine = description(right.of.filter, 'you');
        if (theirs !== null && mine !== null && JSON.stringify(theirs) === JSON.stringify(mine)) {
          return `your opponents control more ${K.np(theirs, st, { det: 'none', plural: true, noController: true })} than you`;
        }
        const { controller: lc, ...lf } = left.of.filter;
        const { controller: rc, ...rf } = right.of.filter;
        if (lc !== 'opponent' || rc !== 'you' || JSON.stringify(lf) !== JSON.stringify(rf)) return null;
        return `your opponents control more ${K.np(lf, st, { det: 'none', plural: true, noController: true })} than you`;
      }
      // FAST5 T60 (CR 607.2a): "there are three or more cards exiled with ~" (Veteran Survivor): the cards the linked ability of this object exiled
      if (left.of.ref === 'linked' && left.of.link === 'exiled') {
        if (c.op !== '>=' || num === null || typeof right !== 'number' || right < 2) return null;
        return `there are ${num} or more cards exiled with ${K.obj({ ref: 'self' }, st, 'object').text}`;
      }
      if (typeof right !== 'number' || left.of.ref !== 'each') return null;
      const f = left.of.filter;
      // std-lci (CR 608.2c, 400.7): "you exiled a land card this way": one of what an earlier move of the ability exiled (parser/holes/cond.ts#exiledThisWay)
      if (c.op === '>=' && right === 1 && f.is?.ref === 'bound' && st.info.get(`b:${f.is.name}`)?.thisWay === 'exiled this way' && f.zone === 'exile') {
        const { is: _is, ...rest } = f;
        return `you exiled ${K.np(rest, st, { det: 'a', noZone: true })} this way`;
      }
      const counted = (amount: string): string => K.np(f, st, { det: 'none', plural: true, count: amount, noController: true });
      // FAST1 T5: "you control two or fewer other lands" (the fast lands; family comparison). Only "you": with several opponents "an opponent controls"
      // would not say whose permanents are counted.
      if (c.op === '<=') return right >= 1 && f.controller === 'you' ? `you control ${counted(`${numWord(right)} or fewer`)}` : null;
      // p2-intervening-1 (CR 603.4; parser/holes/p2iv1.ts): "you control exactly one creature"
      if (c.op === '==' && right >= 1 && f.controller === 'you' && f.zone === undefined) {
        return `you control exactly ${K.np(f, st, { det: 'none', plural: right !== 1, count: numWord(right), noController: true })}`;
      }
      if (c.op !== '>=' || right < 2) return null;
      // FAST1 T5: the count of every opponent's permanents together is "your opponents control eight or more lands" (family comparison; existsPhrase, opp-port-1)
      return existsPhrase(left.of, right, false, st);
    }
    case 'countPlayers': {
      // std-rx31 (CR 102.1, 603.4): "a player controls no creatures": at least one player controls none (parser/holes/cond.ts#control)
      const ci = left.controlsIs;
      if (ci !== undefined && c.op === '>=' && right === 1 && ci.op === '==' && ci.n === 0 && JSON.stringify(left.of) === JSON.stringify({ ref: 'each', who: 'player' })
        && Object.keys(left).length === 3 && ci.filter.controller === undefined) {
        return `a player controls no ${K.np(ci.filter, st, { det: 'none', plural: true, noController: true })}`;
      }
      // opp-port-1 (OPP1 and OPP2 of 2026-10-17; CR 102.3, 806): "an opponent controls two or more creatures", "an opponent controls no creatures": at least one
      // opponent, judged alone, controls that many (none) of them (parser/holes/cond.ts#control)
      if (ci !== undefined && c.op === '>=' && right === 1 && JSON.stringify(left.of) === JSON.stringify({ ref: 'each', who: 'opponent' }) && Object.keys(left).length === 3
        && ci.filter.controller === undefined) {
        const theirs: ObjRef = { ref: 'each', filter: { ...ci.filter, controller: 'opponent' } };
        if (ci.op === '==' && ci.n === 0) return existsPhrase(theirs, undefined, true, st, true);
        if (ci.op === '>=' && ci.n >= 2) return existsPhrase(theirs, ci.n, false, st, true);
        return null;
      }
      if (left.controlsIs !== undefined) return null; // std-rx12: a count of players who control a number of permanents has words as a count only (render/qty.ts)
      // Standard round P (CR 119.3, 120.3a): "an opponent lost 3 or more life this turn", "a player lost 4 or more life this turn": at least one of those players lost
      // that much life this turn (parser/holes/cond.ts#lostLifeAtLeast); with any other narrowing of the players, no words
      if (left.lostLifeIs !== undefined) {
        const l = left.lostLifeIs;
        if (left.sizeVs !== undefined || left.sizeIs !== undefined || left.controlsVs !== undefined || left.lifeVs !== undefined || left.lifeIs !== undefined || left.lostLifeThisTurn !== undefined
          || left.didNot !== undefined || c.op !== '>=' || right !== 1 || l.op !== '>=' || left.of.ref !== 'each' || (left.of.who !== 'opponent' && left.of.who !== 'player')) return null;
        return `${left.of.who === 'opponent' ? 'an opponent' : 'a player'} lost ${l.n} or more life this turn`;
      }
      // std-control-1 (CR 702.179f; parser/holes/cond.ts#speedGreatest): "that opponent's speed is greater than each other player's speed": that player is the only
      // player whose speed is at least theirs
      if (left.speedVs !== undefined) {
        const v = left.speedVs;
        if (Object.keys(left).length !== 3 || c.op !== '==' || right !== 1 || v.op !== '>=' || left.of.ref !== 'each' || left.of.who !== 'player') return null;
        return `${K.player(v.than, st, 'possessive').text} speed is greater than each other player's speed`;
      }
      // std-lci (CR 119.1, 102.1): "you have the most life or are tied for most life": no opponent has more life than you
      if (left.lifeVs !== undefined) {
        const l = left.lifeVs;
        if (left.sizeVs !== undefined || l.op !== '>' || l.than.ref !== 'you' || left.of.ref !== 'each' || left.of.who !== 'opponent') return null;
        // Standard round 6 (CR 119.1, 102.3): "an opponent has more life than you": at least one opponent's life total is greater than yours
        if (c.op === '>=' && right === 1) return 'an opponent has more life than you';
        if (c.op !== '==' || right !== 0) return null;
        return 'you have the most life or are tied for most life';
      }
      // std-rx24 (CR 122.1f): "an opponent has three or more poison counters" (parser/holes/cond.ts#poisonCounters); with 1, "an opponent is poisoned" too
      // (family poisoned-one-or-more)
      if (left.poisonIs !== undefined) {
        const l = left.poisonIs;
        if (left.sizeVs !== undefined || left.sizeIs !== undefined || left.controlsVs !== undefined || left.lifeVs !== undefined || left.lifeIs !== undefined || left.lostLifeThisTurn !== undefined
          || left.lostLifeIs !== undefined || left.didNot !== undefined || c.op !== '>=' || right !== 1 || left.of.ref !== 'each' || left.of.who !== 'opponent' || l.op !== '>=' || l.n < 1) return null;
        const has = `an opponent has ${numWord(l.n)} or more poison counters`;
        return l.n === 1 ? alt(has, 'an opponent is poisoned') : has;
      }
      // r4-static (CR 119.1): "an opponent has 10 or less life": at least one opponent's life total is at most (at least) that number
      if (left.lifeIs !== undefined) {
        const l = left.lifeIs;
        if (left.sizeVs !== undefined || left.sizeIs !== undefined || left.controlsVs !== undefined || left.lostLifeThisTurn !== undefined || c.op !== '>=' || right !== 1
          || left.of.ref !== 'each' || left.of.who !== 'opponent' || (l.op !== '<=' && l.op !== '>=')) return null;
        return `an opponent has ${l.n} or ${l.op === '<=' ? alt('less', 'fewer') : 'more'} life`;
      }
      // FAST5 T53 (CR 402.1, 102.3): "an opponent has more cards in hand than you": at least one opponent has a bigger hand
      if (left.sizeVs !== undefined) {
        if (c.op !== '>=' || right !== 1 || left.of.ref !== 'each' || left.of.who !== 'opponent' || left.lostLifeThisTurn !== undefined) return null;
        return `an opponent has ${sizeVsWords(left.sizeVs)}`;
      }
      // std-sos review (CR 102.2, 102.3): "an opponent controls more lands than you": at least one opponent, judged alone, controls more of them than you
      if (left.controlsVs !== undefined) {
        const v = left.controlsVs;
        if (left.sizeVs !== undefined || c.op !== '>=' || right !== 1 || left.of.ref !== 'each' || left.of.who !== 'opponent' || v.op !== '>' || v.than.ref !== 'you' || v.filter.controller !== undefined) return null;
        return `an opponent controls more ${K.np(v.filter, st, { det: 'none', plural: true, noController: true })} than you`;
      }
      // r4-cost (CR 402.1, 102.1; parser/holes/cost-conds.ts): "a player has one or fewer cards in hand": at least one player whose hand size compares so
      if (left.sizeIs !== undefined) {
        const { zone, op, n } = left.sizeIs;
        // std-rx21 (CR 404.1, 102.3; parser/holes/cond.ts#opponentHasLife): "an opponent has eight or more cards in their graveyard"
        if (zone === 'graveyard' && op === '>=' && c.op === '>=' && right === 1 && left.of.ref === 'each' && left.of.who === 'opponent' && left.lostLifeThisTurn === undefined
          && left.lifeIs === undefined && left.lostLifeIs === undefined && left.didNot === undefined) return `an opponent has ${numWord(n)} or more cards in their graveyard`;
        if (zone !== 'hand' || c.op !== '>=' || right !== 1 || left.of.ref !== 'each' || left.of.who !== 'player' || (op !== '<=' && op !== '>=') || left.lostLifeThisTurn !== undefined) return null;
        return `a player has ${numWord(n)} ${op === '<=' ? 'or fewer' : 'or more'} cards in hand`;
      }
      // FAST1 T5: "you have two or more opponents" (CR 102.3; family comparison)
      if (num === null || c.op !== '>=' || left.of.ref !== 'each' || left.of.who !== 'opponent' || left.lostLifeThisTurn !== undefined) return null;
      return `you have ${num} or more opponents`;
    }
    case 'distinct': {
      if (num === null || c.op !== '>=') return null;
      // cloud std-dsk (CR 709.5, 201.2): "there are eight or more different names among unlocked doors of Rooms you control" (parser/holes/cond.ts#thereAre)
      if (left.what === 'names' && left.among.ref === 'each' && 'filter' in left.among && isRoomsOnly(left.among.filter)) {
        return `there are ${num} or more different names among unlocked doors of ${K.np(left.among.filter, st, { det: 'none', plural: true })}`;
      }
      // CLOUD std-misc (coven, CR 207.2c, 208.1): "you control three or more creatures with different powers": only of a set of plural objects you control
      if (left.what === 'powers') {
        const a = left.among;
        if (a.ref !== 'each' || !('filter' in a) || a.filter.controller !== 'you' || typeof right !== 'number' || right < 2) return null;
        const { controller: _mine, ...rest } = a.filter;
        return `you control ${num} or more ${K.np(rest, st, { det: 'none', plural: true })} with different powers`;
      }
      const { among, w } = distinctParts(left, st);
      const base = `there are ${num} or more ${w} among ${among}`;
      // FAST5X E12 (CR 105.1): there are five colors, so "there are five colors among permanents you control" is five or more (Case of the Shattered Pact)
      // CLOUD std-fdn (CR 201.2): "you control ten or more Gates with different names" is the number of different names among the Gates you control
      const a = left.among;
      if (left.what === 'names' && a.ref === 'each' && 'filter' in a && a.filter.controller === 'you') {
        // trek-5 (CR 201.2; family differently-named-lands): "you control five or more differently named lands" is the same count of different names among the lands you control
        const kind = K.np({ ...a.filter, controller: undefined }, st, { det: 'none', plural: true });
        return alt(base, `you control ${num} or more ${kind} with different names`, `you control ${num} or more differently named ${kind}`);
      }
      return left.what === 'colors' && right === 5 ? alt(base, `there are ${num} ${w} among ${among}`) : base;
    }
    default: return null;
  }
}

/** cmd1: the player P of "no opponent has more life than P": `countPlayers` of each opponent whose life is greater than P's, equal to zero; null for anything else. */
function noOpponentMoreLife(c: Extract<Condition, { cond: 'compare' }>): PlayerRef | null {
  const l = c.left;
  if (c.op !== '==' || c.right !== 0 || typeof l !== 'object' || l.q !== 'countPlayers' || l.lifeVs === undefined || l.sizeVs !== undefined || l.sizeIs !== undefined) return null;
  // only the life comparison: std-mkm's lostLifeThisTurn and std-sos's controlsVs (merged after cmd1 was written) narrow the players counted, which these words do not say
  if (l.lostLifeThisTurn !== undefined || l.lostLifeIs !== undefined || l.controlsVs !== undefined || l.controlsIs !== undefined) return null;
  if (l.of.ref !== 'each' || l.of.who !== 'opponent' || l.lifeVs.op !== '>') return null;
  return l.lifeVs.than;
}

/** True when `node` holds a reference to the binding `name` (`{ref:'bound', name}`) anywhere inside it. */
function refersTo(node: unknown, name: string): boolean {
  if (Array.isArray(node)) return node.some((x) => refersTo(x, name));
  if (node === null || typeof node !== 'object') return false;
  const o = node as Record<string, unknown>;
  if (o.ref === 'bound' && o.name === name) return true;
  return Object.values(o).some((x) => refersTo(x, name));
}

/**
 * Whether a guard prints nothing: a `did` guard on an OPTIONAL CHOICE OF OBJECTS that the guarded step itself names. "You may choose a creature. Destroy
 * it." already says that nothing is destroyed without the choice, because "that creature" presupposes it (CR 608.2c). A guard on the decision of a `may` or
 * a `pay` (binding without objects), or on a choice the step never names, is a dependency the text states: "If you do, ..." (CR 608.2c-d).
 */
export function isImpliedGuard(c: Condition, st: RenderState, step: unknown): boolean {
  if (c.cond !== 'did' || c.not === true) return false;
  const info = st.info.get(`b:${c.step}`);
  if (info?.optional !== true || info.nouns.length === 0) return false;
  const { guard: _guard, ...rest } = step as Record<string, unknown>;
  return refersTo(rest, c.step);
}

/** std-combat-1: the count of a group's objects attacking you or a planeswalker you control, at least N (parser/holes/cond.ts#thoseAttackingYou); else null. */
function attackingYouOrWalkers(c: Extract<Condition, { cond: 'compare' }>): { n: number; of: ObjRef } | null {
  const l = c.left;
  if (c.op !== '>=' || typeof c.right !== 'number' || typeof l !== 'object' || l.q !== 'count' || l.of.ref !== 'each' || !('filter' in l.of)) return null;
  const f = l.of.filter;
  if (Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join(',') !== 'attacking,is' || f.is === undefined) return null;
  return JSON.stringify(f.attacking) === JSON.stringify({ defender: 'you', orPlaneswalker: true }) ? { n: c.right, of: f.is } : null;
}
