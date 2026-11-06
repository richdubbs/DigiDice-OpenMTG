/**
 * Conditions as clauses (WP2): "you control a creature", "~ is tapped", "it's your turn", "~ was kicked", "you do". No leading "if"/"as long as":
 * the frame that holds the condition adds it.
 */
import type { Cmp, Condition, ObjectFilter, ObjRef, PlayerRef, Quantity } from '../types/ability';
import { formatManaCost, type Color } from '../types/mana';
import { K } from './kernel';
import { distinctParts, domainOf, excessRecipient, scopeWords, sizeVsWords, spentObjectText } from './qty';
import { isRoomsOnly } from '../model/room-filter';
import { EACH_LAND_TYPE_AND_EACH_COLOR } from '../model/edhd37';
import { isOpponentDrawsPerPlayer, isOpponentSpellsPerPlayer, isOpponentsHappenedPlayers, isTurnEnergySpent } from '../model/forms';
import { possessiveStep, STEP_NAME, turnOf } from './turn';
import { saidX } from './steps-util';
import { costMovedOr, movedAtLeastPhrase, movedCondPhrase } from './moved';
import { isPlayerRef } from './refs';
import { p2iv1CondPhrase } from './p2iv1';
import { p2iv3AllAny, p2iv3Moved } from './p2iv3';
import { MILLED_KEY, cloneState, withVariants, type RenderState } from './state';
import { alt, ALT_OPEN, firstAlt, ALT_SEP, COLOR_WORD, joinList, numWord, NoRenderer, ordinal, parseMarked, pluralize, withArticle } from './text';

/** edh-c-95: the card types of a permanent (CR 110.1): a spell that is an instant or a sorcery has none of them. */
const PERMANENT_KIND_TYPES: ReadonlySet<string> = new Set(['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker']);
/** edh-c-95: subtypes only spells have (CR 205.3k), which an instant or a sorcery may be. */
const SPELL_SUBTYPES: ReadonlySet<string> = new Set(['arcane', 'trap', 'adventure', 'lesson', 'omen']);
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
    case '>=': return alt(`${right} or greater`, `${right} or more`, `greater than or equal to ${right}`, `equal to or greater than ${right}` /* edh-next-55 */);
    case '<=': return alt(`${right} or less`, `${right} or fewer`, `less than or equal to ${right}`, `equal to or less than ${right}` /* edh-next-55 (Clowning Around) */);
    case '==': return alt(right, `exactly ${right}`, `equal to ${right}`); // r4-fxb (family exactly-number): "if its power is exactly 20" (CR 208.1); edh-c-105 (family is-equal-to): "if its mana value is equal to 1 plus the number of soul counters on ~" (Obscura Ascendancy)
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
/** edh-c-6: set while the generic wording of an exact power and toughness is built (see the `matches` case). */
let inExactPt = false;

/** edh-next-75 (CR 113.6b; Oloro, Ageless Ascetic): the filter of "~ is in the command zone" (parser/holes/cond.ts#COMMAND_ZONE_ONLY_COND). */
export function isCommandZoneOnly(f: ObjectFilter): boolean {
  const keys = Object.keys(f).filter((k) => f[k as keyof ObjectFilter] !== undefined).sort().join(',');
  return keys === 'self,zone' && f.self === true && Array.isArray(f.zone) && f.zone.length === 1 && f.zone[0] === 'command';
}

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

/** edh-c-40 (CR 404.1; parser/holes/cond.ts#cardsInYourGraveyard): the two cards of `twoCardsInOneZone` in your graveyard, said with the verb after them, "an instant card and a sorcery card are in your graveyard". Null for any other pair. */
function twoCardsAreInYourGraveyard(of: readonly Condition[], st: RenderState): string | null {
  const fs = of.map((x) => (x.cond === 'exists' && x.atLeast === undefined && x.of.ref === 'each' && 'filter' in x.of ? x.of.filter : null));
  const [a, b] = fs;
  if (of.length !== 2 || a == null || b == null || a.zone !== 'graveyard' || b.zone !== 'graveyard' || a.owner !== 'you' || b.owner !== 'you' || a.controller !== undefined || b.controller !== undefined) return null;
  return `${K.np(a, st, { det: 'a', noZone: true })} and ${K.np(b, st, { det: 'a', noZone: true })} are in your graveyard`;
}

/** `oneOpponent` (opp-port-1): the permanents counted are one opponent's own (`countPlayers.controlsIs`), not every opponent's together. */
function existsPhrase(of: ObjRef,atLeast: Parameters<typeof K.qty>[0] | undefined, negate: boolean, st: RenderState, oneOpponent = false): string {
  if (of.ref !== 'each') {
    const o = K.obj(of, st, 'subject');
    // edh-perms-4 (CR 603.4, 400.7): "if it's on the battlefield" is the same question as "if it's still on the battlefield": the object is a permanent now
    return negate ? `${o.text} isn't still on the battlefield` : alt(`${o.text} is still on the battlefield`, `${o.text} is on the battlefield`);
  }
  const f = of.filter;
  // M11-4 (eminence, CR 113.6b): "~ is in the command zone or on the battlefield" (parser/holes/cond.ts#EMINENCE_COND): the source itself in one of the two
  if (isEminence(f)) {
    if (negate || atLeast !== undefined) throw new NoRenderer('a negated or counted "in the command zone or on the battlefield"');
    return `${K.obj({ ref: 'self' }, st, 'subject').text} is in the command zone or on the battlefield`;
  }
  // edh-next-75 (CR 113.6b; parser/holes/cond.ts#COMMAND_ZONE_ONLY_COND, Oloro): "~ is in the command zone"
  if (isCommandZoneOnly(f)) {
    if (st.commandOnlyTrigger !== true) throw new NoRenderer('"~ is in the command zone" anywhere but the intervening "if" of a trigger that functions only in the command zone');
    if (negate || atLeast !== undefined) throw new NoRenderer('a negated or counted "in the command zone"');
    return `${K.obj({ ref: 'self' }, st, 'subject').text} is in the command zone`;
  }
  // FAST4 T29: "~ is equipped" is "an Equipment is attached to ~" (CR 301.5: an Equipment attached to a creature equips it); nothing else in the filter
  const keys = Object.keys(f).filter((k) => f[k as keyof ObjectFilter] !== undefined);
  // edh-c-25 (CR 303.4e, 109.5; family its-controller-controls-another; Favorable Destiny): "its controller controls another creature": a creature other than the object the
  // source is attached to, controlled by that object's controller; nothing else in the filter
  if (!negate && atLeast === undefined && f.attachedToSource === false && f.types?.length === 1 && f.types[0] === 'Creature' && keys.length === 3
    && typeof f.controller === 'object' && f.controller.ref === 'controllerOf' && f.controller.object.ref === 'attachedTo') {
    return 'its controller controls another creature';
  }
  if (!negate && atLeast === undefined && f.attachedToObject !== undefined && keys.length === 2 && f.subtypes?.length === 1 && f.subtypes[0] === 'Equipment') {
    return `${K.obj(f.attachedToObject, st, 'subject').text} is equipped`;
  }
  // edh-next-1 (CR 301.5, 303.4; parser/holes/cond.ts#attachedAtLeast; Brass Knuckles): "two or more Equipment are attached to it": a count of two or more permanents of one subtype
  // attached to an object (also "there are two or more Equipment attached to it"; nothing else in the filter)
  if (!negate && typeof atLeast === 'number' && atLeast >= 2 && f.attachedToObject !== undefined && keys.length === 2 && f.subtypes?.length === 1 && (f.subtypes[0] === 'Equipment' || f.subtypes[0] === 'Aura')) {
    const kind = K.np({ subtypes: f.subtypes }, st, { det: 'none', plural: true, noZone: true });
    const base = `${numWord(atLeast)} or more ${kind} are attached to ${K.obj(f.attachedToObject, st, 'object').text}`;
    // edh-d-8 (CR 303.4a, 301.5; parser/holes/edhd8.ts, family enchanted-by-auras; Timber Paladin): the Auras of an object are also said "~ is enchanted by three or more Auras"
    return f.subtypes[0] === 'Aura' ? alt(base, `${K.obj(f.attachedToObject, cloneState(st), 'subject').text} is enchanted by ${numWord(atLeast)} or more Auras`) : base;
  }
  // edh-d-8 (CR 303.4, 109.1; parser/holes/edhd8.ts, Face of Divinity): "another Aura is attached to enchanted creature": an Aura other than the source, attached to the object
  if (!negate && atLeast === undefined && f.attachedToObject !== undefined && f.other === true && keys.length === 3 && f.subtypes?.length === 1 && f.subtypes[0] === 'Aura') {
    return `another Aura is attached to ${K.obj(f.attachedToObject, st, 'object').text}`;
  }
  // std-tla (CR 701.17a, 608.2c; parser/holes/cond.ts#milledThisWayCond; family milled-this-way-cond): "a Lesson card is milled this way", "... was milled this way",
  // "at least one Zombie card is milled this way": one of the cards a mill step put into a graveyard (named "milled this way" by render/fold.ts) matches the description
  const milledGroup = f.is !== undefined && f.is.ref === 'bound' && st.info.has(`${MILLED_KEY}${f.is.name}`);
  if (!negate && atLeast === undefined && milledGroup && f.zone === 'any' && f.anyOf === undefined) {
    const { is: _is, zone: _zone, ...rest } = f;
    if (!Object.values(rest).some((v) => v !== undefined)) throw new NoRenderer('"milled this way" without a description');
    const one = K.np({ ...rest, zone: 'graveyard' }, st, { det: 'a', noZone: true });
    const bare = K.np({ ...rest, zone: 'graveyard' }, st, { det: 'none', noZone: true });
    // edh-d-87 (Anowon, the Ruin Thief; family player-mills-at-least-one-this-way): also with the player who milled as the subject, "the player mills at least one creature card this way"
    return alt(`${one} is milled this way`, `${one} was milled this way`, `at least one ${bare} is milled this way`, `at least one ${bare} was milled this way`,
      `the player mills at least one ${bare} this way`, `that player mills at least one ${bare} this way`);
  }
  // edh-d-33 (CR 701.20a, 402.3, 608.2c; parser/holes/cond.ts#revealedHandCond; Isperia the Inscrutable): "a card with the chosen name is revealed this way": one of the cards of the hand an earlier
  // step revealed (its binding is the hand, render/steps-cards.ts) matches the description
  if (!negate && atLeast === undefined && f.is !== undefined && f.is.ref === 'bound' && st.info.get(`b:${f.is.name}`)?.hand === true && f.zone === 'any' && f.anyOf === undefined) {
    const { is: _is, zone: _zone, ...rest } = f;
    if (!Object.values(rest).some((v) => v !== undefined)) throw new NoRenderer('"revealed this way" without a description');
    return `${K.np({ ...rest, zone: 'hand' }, st, { det: 'a', noZone: true })} is revealed this way`;
  }
  // edh-replace-2 (CR 608.2c, 120.3; template eff.edhr2.ifDealtDamageThisWay.then): "a Dinosaur is dealt damage this way": one of the permanents the damage step right before
  // dealt damage to (render/steps-life.ts marks its binding "dealt damage this way") matches the description; nothing else in the filter
  if (!negate && atLeast === undefined && f.is !== undefined && f.is.ref === 'bound' && st.info.get(`b:${f.is.name}`)?.thisWay === 'dealt damage this way'
    && f.anyOf !== undefined && f.anyOf.length === 1 && keys.length === 2) {
    return `${K.np(f.anyOf[0]!, st, { det: 'a' })} is dealt damage this way`;
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
    // edh-next-117 (CR 402.1, 603.4; parser/holes/cond.ts#youHave; Land Grant; family no-cards-of-kind-in-hand): "there are no land cards in your hand" is also "you have no land cards in hand"
    if (!few && f.zone === 'hand' && f.owner === 'you' && f.isCard === true && keys.length > 3 && f.anyOf === undefined) {
      const bare = K.np({ ...f, owner: undefined }, cloneState(st), { det: 'none', plural: true, noZone: true });
      return alt(`there are ${amount} ${none}`, `you have ${amount} ${bare} in hand`, `you have ${amount} ${bare} in your hand`);
    }
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
  // edh-next-60 (CR 506.4, 611.3a; Sanwell, Avenger Ace; family you-control-is-attacking): "you control an attacking artifact creature" is "an artifact creature you control is attacking"
  if (ctrl === 'you control' && (count === undefined || (typeof atLeast === 'number' && atLeast === 1)) && f.attacking === true && f.blocking === undefined && f.tapped === undefined && f.other !== true && (f.types !== undefined || f.allTypes !== undefined || f.subtypes !== undefined)) {
    return alt(`${ctrl} ${phrase}`, `${K.np({ ...f, attacking: undefined, controller: 'you' }, st, { det: 'a' })} is attacking`);
  }
  // FAST4 T23: an explicit minimum of one is also "you control one or more Eggs" (the same condition, CR 603.4)
  if (ctrl && typeof atLeast === 'number' && atLeast === 1) return alt(`${ctrl} ${phrase}`, `${ctrl} ${body('one or more', true)}`);
  // FAST4 T29: "you control an artifact creature or a Plan", one existence condition over two descriptions, each with its article (family either-exists)
  const either = f.anyOf;
  if (ctrl && count === undefined && either !== undefined && either.length === 2 && keys.length === 2 && either.every((g) => g.controller === undefined && g.anyOf === undefined)) {
    return alt(`${ctrl} ${phrase}`, `${ctrl} ${either.map((g) => K.np(g, st, { det: 'a' })).join(' or ')}`);
  }
  // FAST5 T62: "you control at least five other Forests" says "five or more" the other way round (CR 603.4)
  if (ctrl && count !== undefined && typeof atLeast === 'number') return alt(`${ctrl} ${phrase}`, `${ctrl} ${body(`at least ${numWord(atLeast)}`, true)}`);
  // edh-combat-5 (CR 702.1; family exists-has-keyword; Odric, Lunarch Marshal): "if a creature you control has first strike" is "if you control a creature with first strike"
  if (ctrl === 'you control' && count === undefined && typeof f.keyword === 'string' && f.types?.length === 1 && keys.every((k) => k === 'types' || k === 'controller' || k === 'keyword')) {
    return alt(`${ctrl} ${phrase}`, `${K.np({ types: f.types, controller: 'you' }, st, { det: 'a' })} has ${f.keyword}`);
  }
  // edh-c-68 (CR 102.3; family team-controls; Bull-Rush Bruiser): your team is you (no team of several players is played), "your team controls another Warrior" (only the "another" form, whose text nothing else rearranges)
  if (ctrl) return ctrl === 'you control' && count === undefined && f.other === true ? alt(`${ctrl} ${phrase}`, `your team controls ${phrase}`) : `${ctrl} ${phrase}`;
  // FAST5 T68 (CR 406.1, 108.3): a card in exile has an owner, not a controller: "you own a card in exile that has an Adventure"
  if (count === undefined && f.owner === 'you' && f.controller === undefined && f.zone === 'exile') return `you own ${K.np({ ...f, owner: undefined }, st, { det: 'a' })}`;
  // FAST3 T12: "any player controls a black permanent" is one such permanent on the battlefield (CR 110.2: every permanent has a controller); one object
  // only: "any player controls two or more ..." would count each player's permanents apart
  // Cloud std-woe (family exists-is-status): an attacking, blocking, tapped or untapped permanent is also said with the status after the noun, "a Rat is attacking"
  // edh-c-39 (family exists-has-counter; Tenacious Hunter): "a creature has a -1/-1 counter on it" is "there is a creature with a -1/-1 counter on it on the battlefield" (one permanent of the description, any controller)
  const hasCounter = count === undefined && f.counters !== undefined && typeof f.counters.kind === 'string' && Object.keys(f.counters).length === 1 && f.types?.length === 1 && keys.every((k) => k === 'types' || k === 'counters') ? `${K.np({ types: f.types }, st, { det: 'a' })} has a ${f.counters.kind} counter on it` : null;
  if (zoneBf && count === undefined && f.controller === undefined && f.owner === undefined) return alt(`there is ${phrase} on the battlefield`, `any player controls ${phrase}`, ...statusAfterNoun(f, st), ...(hasCounter !== null ? [hasCounter] : []));
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
  // edh-c-40 (CR 404.1; parser/holes/cond.ts#cardsInYourGraveyard; family card-is-in-your-graveyard): "a Warrior card is in your graveyard" is "there is a Warrior card in your graveyard"
  if (count === undefined && f.zone === 'graveyard' && f.owner === 'you' && f.controller === undefined) {
    // edh-d-99 (CR 702.1, 404.1; family graveyard-card-has-keyword; Bleeding Effect): "a creature card in your graveyard has flying" is "there is a creature card with flying in your graveyard" (one card
    // of one card type with that keyword, nothing else said of it)
    const hasKw = typeof f.keyword === 'string' && f.types?.length === 1 && keys.every((k) => ['types', 'zone', 'owner', 'isCard', 'keyword'].includes(k))
      ? [`${K.np({ types: f.types, isCard: true, zone: 'graveyard' }, cloneState(st), { det: 'a', noZone: true })} in your graveyard has ${f.keyword}`] : [];
    return alt(`there is ${phrase}`, `${K.np(f, st, { det: 'a', noZone: true })} is in your graveyard`, ...hasKw);
  }
  // edh-next-58 (CR 404.1, 102.3; parser/holes/edhn58.ts, family cards-total-in-all-graveyards; Avatar of Woe): the cards of every graveyard together are also "N or more creature cards total in all graveyards"
  if (count !== undefined && f.zone === 'graveyard' && f.owner === undefined && f.controller === undefined) {
    return alt(`there are ${phrase}`, `there are ${K.np(f, st, { det: 'none', plural, count, noZone: true })} total in all graveyards`);
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
  'power', 'toughness', 'manaValue', 'counters', 'hasAbility', 'controller', 'self', 'isCopy', 'attached', 'enteredThisTurn', 'dealtDamageThisTurn', 'dealtExcessDamageThisTurn' /* edh-d-38 */, 'attackedThisTurn', 'blockedThisTurn', 'wasBlockedThisTurn', 'targets' /* edh-next-93 */,
  'solved', 'prepared', 'prototyped', 'flipped', // M6-0 (m6 design 2.1)
  'saddled', // FAST5X E3 (CR 702.171b)
  'suspected', // FAST5X E12 (CR 701.60b)
  'monstrous', // std-rx34 (CR 701.37b)
  'ringBearer', // MX3 (CR 701.54e)
  'modified', // cloud std-spm (CR 700.9): "as long as it's modified"
  'doubleFaced', // std-rx31 (CR 712.1): "if it's a double-faced card"
  'renowned', // std-ry8 (CR 702.112b)
  'paired', // edh-top-2 (CR 702.95b)
  'attackingAlone', // p2-attack-block-1 (CR 506.5): "is attacking alone"
  'manaSymbols', // edh-next-142 (CR 107.4, 202.1): "it has three or more colored mana symbols in its mana cost"
  'hadToAttack', // edh-d-75 (CR 508.1d): "had to attack this combat"
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

const SHARES_WORDS: Record<string, string> = { creatureType: 'a creature type', color: 'a color', cardType: 'a card type', landType: 'a land type' };

function predicates(f: ObjectFilter, st: RenderState, plural: boolean): string[] {
  const out: string[] = [];
  const isA = plural ? 'are' : 'is';
  const has = plural ? 'have' : 'has';
  const was = plural ? 'were' : 'was';
  if (f.tapped === true) out.push(`${isA} tapped`);
  else if (f.tapped === false) out.push(`${isA} untapped`);
  if (f.attackingAlone === true) out.push(`${isA} attacking alone`); // p2-attack-block-1 (CR 506.5)
  if (f.hadToAttack === true) out.push(`had to attack this combat`); // edh-d-75 (CR 508.1d; Firkraag): "if that creature had to attack this combat"
  if (f.attacking === true) out.push(`${isA} attacking`);
  else if (f.attacking === false) out.push(`${isA} nonattacking`);
  // edh-d-89 (CR 508.1b; Scriv, the Obligator's Contract): "it's attacking one of your opponents" (a player, never a planeswalker or battle; the parser's only form)
  else if (typeof f.attacking === 'object' && JSON.stringify(f.attacking) === '{"defender":"opponent"}') out.push(`${isA} attacking one of your opponents`);
  if (f.blocking === true) out.push(`${isA} blocking`);
  else if (f.blocking === false) out.push(`${isA} nonblocking`);
  if (f.blocked === true) out.push(`${isA} blocked`);
  else if (f.blocked === false) out.push(`${isA} unblocked`);
  if (f.token === true) out.push(`${isA} ${plural ? 'tokens' : 'a token'}`);
  if (f.token === false) out.push(`${isA} nontoken`);
  if (f.enchanted === true && Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).length === 1) out.push(`${isA} enchanted`); // edh-d-5 (CR 303.4b; Gunner Conscript): "if it was enchanted"
  if (f.equipped === true && Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).length === 1) out.push(`${isA} equipped`); // edh-d-5 (CR 301.5)
  if (f.faceDown === true) out.push(`${isA} face down`);
  else if (f.faceDown === false) out.push(`${isA} face up`);
  if (f.transformed === true) out.push(`${isA} transformed`);
  else if (f.transformed === false) throw new NoRenderer('transformed:false has no wording');
  // edh-c-9 (CR 105.2; family cond-colors-and-or, as np.ts's colors-and-or): "if that target is white and/or blue" is "white or blue" (Lithomantic Barrage)
  // edh-d-61 (CR 105.2, 108.1; Tamiyo, Seasoned Scholar): "if it's a green card": a card (never a token) with only colors to describe it, said with the card noun
  const colorCard = f.colors !== undefined && f.colors.length > 0 && f.isCard === true && !plural && Object.entries(f).every(([k, v]) => v === undefined || k === 'isCard' || k === 'colors');
  if (colorCard) {
    const names = f.colors!.map((c) => COLOR_WORD[c] ?? c);
    out.push(`${isA} a ${names.length > 1 ? alt(joinList(names, 'or'), joinList(names, 'and/or')) : joinList(names, 'or')} card`);
  } else if (f.colors && f.colors.length > 0) {
    const names = f.colors.map((c) => COLOR_WORD[c] ?? c);
    out.push(`${isA} ${names.length > 1 ? alt(joinList(names, 'or'), joinList(names, 'and/or')) : joinList(names, 'or')}`);
  }
  if (f.colorless === true) out.push(`${isA} colorless`);
  else if (f.colorless === false) out.push(`${isA} colored`);
  if (f.multicolored === true) out.push(`${isA} multicolored`);
  else if (f.multicolored === false) out.push(`${isA} nonmulticolored`);
  if (f.monocolored === true) out.push(`${isA} monocolored`);
  else if (f.monocolored === false) throw new NoRenderer('monocolored:false has no wording');
  if (f.keyword !== undefined) out.push(`${has} ${[f.keyword].flat().join(' or ')}`);
  if (f.notKeyword !== undefined) out.push(`${has} no ${[f.notKeyword].flat().join(' or ')}`);
  // edh-next-142 (CR 107.4, 202.1; Omnath, Locus of All): "if it has three or more colored mana symbols in its mana cost" (only "N or more" of one object, as np.ts says it)
  if (f.manaSymbols !== undefined) {
    const { color, cmp: m } = f.manaSymbols;
    if (m.op !== '>=' || typeof m.value !== 'number' || m.value < 1 || plural) throw new NoRenderer('manaSymbols other than "N or more" of one object');
    out.push(`${has} ${numWord(m.value)} or more ${color === 'colored' ? 'colored' : COLOR_WORD[color]} mana symbols in its mana cost`);
  }
  // trek-14 (CR 208.1, 603.4; Ensign Harry Kim, Operations): "if it has greater power than ~" is more power than that object's: the wording of "has power greater than ~'s power"
  const gv = f.power !== undefined && f.power.op === '>' && typeof f.power.value === 'object' && f.power.value.q === 'stat' && f.power.value.stat === 'power' && f.power.value.sum === undefined && f.power.value.agg === undefined && f.power.value.station === undefined && 'ref' in f.power.value.of ? f.power.value.of : null;
  if (f.power && gv !== null) out.push(alt(`${has} greater power than ${K.obj(gv, cloneState(st), 'object').text}`, `${has} power ${cmpWords(f.power.op, K.qty(f.power.value, st))}`));
  else if (f.power) out.push(`${has} power ${cmpWords(f.power.op, K.qty(f.power.value, st))}`);
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
    // edh-d-48 (CR 122.1; Ayara's Oathsworn): exactly that many counters of the kind, "has exactly four +1/+1 counters on it" (parser/holes/filter.ts, "exactly" only)
    else if (n !== undefined && n.op === '==') out.push(`${has} exactly ${K.qty(n.value, st)} ${f.counters.kind} counters on it`);
    else if (n !== undefined && n.op === '!=') throw new NoRenderer('a number of counters other than N');
    else out.push(n === undefined ? `${has} ${withArticle(`${f.counters.kind} counter`)} on it` : `${has} ${K.qty(n.value, st)} ${n.op === '>=' ? 'or more ' : n.op === '<=' ? 'or fewer ' : ''}${f.counters.kind} counters on it`);
  }
  if (f.abilityNotMana === true) throw new NoRenderer("an activated ability that isn't a mana ability in a condition"); // edh-c-44: said by render/np.ts only
  if (f.hasAbility) out.push(`${has} ${withArticle(`${f.hasAbility} ability`)}`);
  // std-rx31 (CR 712.1, 712.4): having two faces is a property of the card, so Oracle says "card" even of a permanent ("If it's a double-faced card, you may transform it")
  if (f.doubleFaced === true) out.push(`${isA} ${plural ? 'double-faced cards' : 'a double-faced card'}`);
  else if (f.doubleFaced === false) throw new NoRenderer('doubleFaced:false has no wording');
  if (f.isCopy === true) out.push(`${isA} a copy`);
  else if (f.isCopy === false) throw new NoRenderer('isCopy:false has no wording');
  // edh-c-37 (CR 205.3m, 608.2c; Kinship, Ink Dissolver): "if it shares a creature type with ~": the object shares that quality with one object (nothing else is asked of it)
  // edh-c-101 (CR 105.2, 608.2c; Jaded Response): also with a described group, "if it shares a color with a creature you control" (the object shares the quality with one of them)
  const swEach = f.sharesWith !== undefined && f.sharesWith.with.ref === 'each' && 'filter' in f.sharesWith.with && f.sharesWith.other !== true && f.sharesWith.quality === 'color' && Object.entries(f).every(([k, v]) => v === undefined || k === 'sharesWith');
  if (swEach) out.push(`${plural ? 'share' : 'shares'} a color with ${K.np((f.sharesWith!.with as { filter: ObjectFilter }).filter, cloneState(st), { det: 'a' })}`);
  if (f.sharesWith !== undefined && f.sharesWith.with.ref !== 'each' && f.sharesWith.quality !== 'name' && f.sharesWith.quality !== 'permanentType' && Object.entries(f).every(([k, v]) => v === undefined || k === 'sharesWith')) {
    out.push(`${plural ? 'share' : 'shares'} ${SHARES_WORDS[f.sharesWith.quality] ?? 'a quality'} with ${K.obj(f.sharesWith.with, cloneState(st), 'object').text}`); // (a copy of the state: the object compared with is no antecedent of the "it" that follows, as the parser's sharedWithSelf says)
  }
  // edh-c-98 (CR 201.2, 608.2c; Candles of Leng): "if it has the same name as a card in your graveyard": the object (a card, nothing else asked of it) has the name of any one object of a described set
  if (f.sharesWith !== undefined && f.sharesWith.with.ref === 'each' && f.sharesWith.quality === 'name' && f.sharesWith.other !== true && !plural && Object.entries(f).every(([k, v]) => v === undefined || k === 'sharesWith')) {
    out.push(`${has} the same name as ${K.np(f.sharesWith.with.filter, cloneState(st), { det: 'a' }).replace(/ from (your|a|their|an opponent's) graveyard$/, ' in $1 graveyard')}`);
  }
  if (f.attached === true) out.push(`${isA} attached to a permanent`);
  else if (f.attached === false) out.push(`${isA} unattached`);
  // std-rx32 (CR 301.5, 303.4): "if it's attached to a creature you control" (Stolen Uniform): attached to one object of a description
  const ato = f.attachedToObject;
  if (ato !== undefined && ato.ref === 'each' && 'filter' in ato) out.push(`${isA} attached to ${K.np(ato.filter, st, { det: 'a' })}`);
  if (f.enteredThisTurn === true) out.push(alt('entered the battlefield this turn', 'entered this turn'));
  else if (f.enteredThisTurn === false) out.push(alt("didn't enter the battlefield this turn", "didn't enter this turn"));
  if (f.dealtDamageThisTurn === true) out.push(`${was} dealt damage this turn`);
  else if (f.dealtDamageThisTurn === false) out.push(`${plural ? "weren't" : "wasn't"} dealt damage this turn`);
  if (f.dealtExcessDamageThisTurn === true) out.push(`${was} dealt excess damage this turn`); // edh-d-38 (CR 120.10)
  // edh-next-93 (CR 115.9b, 608.2c; Bane's Contingency): "if that spell targets a commander you control": one of the spell's (or ability's) targets is an object of that description
  if (f.targets !== undefined) {
    if (f.targets.ref !== 'each' || !('filter' in f.targets) || plural) throw new NoRenderer('a targets condition of another shape');
    // edh-next-132 (Orvar, the All-Form; family targets-one-or-more): said "targets one or more other permanents you control" too, the same test of its targets
    out.push(`targets ${alt(K.np(f.targets.filter, cloneState(st), { det: 'a' }), K.np(f.targets.filter, cloneState(st), { det: 'none', plural: true, count: 'one or more' }))}`);
  }
  if (f.attackedThisTurn === true) out.push('attacked this turn');
  else if (f.attackedThisTurn === false) out.push("didn't attack this turn");
  if (f.blockedThisTurn === true) out.push('blocked this turn');
  else if (f.blockedThisTurn === false) out.push("didn't block this turn");
  if (f.wasBlockedThisTurn === true) out.push('was blocked this turn'); // edh-c-18
  // M6-0: designations and statuses (CR 719.3b, 722.3a, 718.3b, 710)
  for (const k of ['solved', 'prepared', 'prototyped', 'flipped', 'saddled', 'suspected', 'monstrous'] as const) { // std-rx34: monstrous (CR 701.37b)
    if (f[k] === true) out.push(`${isA} ${k}`);
    else if (f[k] === false) out.push(`${isA}n't ${k}`);
  }
  // std-ry8 (CR 702.112b): "as long as ~ is renowned", "if it isn't renowned"
  if (f.renowned === true) out.push(`${isA} renowned`);
  else if (f.renowned === false) out.push(`${isA}n't renowned`);
  // edh-top-2 (CR 702.95b): soulbond's "as long as ~ is paired with another creature" (a creature is paired with another one by definition), "if ~ isn't paired"
  if (f.paired === true) out.push(`${isA} paired with another creature`);
  else if (f.paired === false) out.push(`${isA}n't paired`);
  // cloud std-spm (CR 700.9): "~ has flying as long as it's modified" (it has a counter on it, is equipped, or is enchanted by an Aura its controller controls)
  if (f.modified === true) out.push(`${isA} modified`);
  else if (f.modified === false) out.push(`${isA}n't modified`);
  // MX3 (CR 701.54e): "~ is your Ring-bearer", "it's a Ring-bearer"
  if (f.ringBearer === 'you') out.push(`${isA} your Ring-bearer`);
  else if (f.ringBearer === 'any') out.push(`${isA} ${plural ? 'Ring-bearers' : 'a Ring-bearer'}`);
  else if (f.ringBearer !== undefined) throw new NoRenderer('a Ring-bearer of a player other than you or any player');
  // edh-combat-2 (CR 509.1g-h, 506.4; Sting, the Glinting Dagger): "it's blocking or blocked by a Goblin or Orc", one description of the creature in the other role
  const bob = f.blockingOrBlockedBy;
  const bobEach = bob !== undefined && bob.ref === 'each' && 'filter' in bob ? bob.filter : undefined;
  if (bobEach !== undefined) out.push(`${isA} blocking or blocked by ${K.np(bobEach, st, { det: 'a' })}`);
  // Standard round 4, r4-trig (CR 702.100a-b, 208.1; parser/holes/filter.ts#featureAt): "has greater power or toughness than ~": more power than that object's
  // power or more toughness than its toughness (evolve's comparison); said only so (family greater-power-or-toughness)
  const pot = greaterPowerOrToughness(f);
  if (pot !== null) out.push(`${has} greater power or toughness than ${K.obj(pot, cloneState(st), 'object').text}`);
  // edh-next-18 (CR 506.4, 508.1k, 509.1g; Tromokratis): "as long as it isn't attacking or blocking": an attacking creature or a blocking creature, said as one predicate
  const aob = f.anyOf !== undefined && f.anyOf.length === 2 && JSON.stringify(f.anyOf) === '[{"attacking":true},{"blocking":true}]';
  if (aob) out.push(`${isA} attacking or blocking`);
  // edh-next-47 (CR 700.6; Curator's Ward): "if it was historic" / "if it's historic": an artifact, a legendary object or a Saga (parser/holes/cond.ts#pastTense)
  if (isHistoricOnly(f)) out.push(`${isA} historic`);
  // edh-d-41 (CR 303.4b, 301.5, 603.10a; Koll, the Forgemaster): "if it was enchanted or equipped": an Aura or an Equipment was attached to it as it last existed
  if (isEnchantedOrEquippedOnly(f)) out.push(`${isA} enchanted or equipped`);
  // the controller is a predicate of the object, whatever its types: "you control it"
  if (f.controller !== undefined && f.controller !== 'any') out.push(f.controller === 'you' ? `you control ${plural ? 'them' : 'it'}` : `${controls(f, st)} ${plural ? 'them' : 'it'}`);
  // everything else (types, subtypes, zone, owner, name, not, anyOf ...) is the noun phrase of what is left of the filter
  const rest: ObjectFilter = { ...f };
  for (const k of PREDICATE_FIELDS) delete rest[k];
  if (pot !== null || aob || isHistoricOnly(f) || isEnchantedOrEquippedOnly(f)) delete rest.anyOf;
  if (out.some((x) => x.startsWith('shares ') || x.startsWith('share ') || x.startsWith('has the same name as ')) && Object.keys(f).every((k) => k === 'sharesWith')) delete rest.sharesWith; // edh-c-37: said above
  // edh-c-43 (CR 506.4, 509.1; Intrepid Ace): "as long as it isn't attacking or blocking": one object that is either attacking or blocking is
  // a predicate pair, never the noun phrase "1 attacking or blocking permanent" (only the two combat roles, nothing else beside them)
  const combatPair = f.anyOf?.length === 2 && f.anyOf.every((g) => Object.keys(g).length === 1) && f.anyOf.some((g) => g.attacking === true) && f.anyOf.some((g) => g.blocking === true) && rest.anyOf !== undefined;
  if (combatPair) { out.push(`${isA} attacking or blocking`); delete rest.anyOf; }
  if (bobEach !== undefined) delete rest.blockingOrBlockedBy; // edh-combat-2: said above
  if (out.includes(`${isA} enchanted`)) delete rest.enchanted; // edh-d-5: said above (the filter has no other field)
  if (out.includes(`${isA} equipped`)) delete rest.equipped; // edh-d-5: said above
  if (ato !== undefined && ato.ref === 'each' && 'filter' in ato) delete rest.attachedToObject; // std-rx32: said above
  if (colorCard) delete rest.isCard; // edh-d-61: said above
  if (f.doubleFaced === true && rest.isCard === true) delete rest.isCard; // std-rx31: "a double-faced card" says it is a card (the filter reads cards only, rules/filter.ts)
  if (Object.values(rest).some((v) => v !== undefined)) {
    const onlyTypes = Object.entries(rest).every(([k, v]) => v === undefined || k === 'types' || k === 'allTypes' || k === 'isCard');
    // edh-b-8 (CR 205.2, 608.2c; Karametra's Blessing): "if it's an enchanted creature or enchantment creature": two descriptions of one object, the article before the first only
    const either = rest.anyOf;
    const orPhrase = !plural && Object.keys(rest).length === 1 && either !== undefined && either.length === 2 && either.every((g) => g.anyOf === undefined && g.controller === undefined && g.isCard === undefined)
      ? `${K.np(either[0]!, st, { det: 'a', noController: true })} or ${K.np(either[1]!, st, { det: 'none', noController: true })}` : null;
    const phrase = orPhrase ?? K.np(rest, st, { det: plural ? 'none' : 'a', plural, noController: true });
    // FAST4 T29: a supertype alone is also its adjective, "as long as equipped creature is legendary" (CR 205.4a; family supertype-adjective)
    const onlySupertypes = Object.entries(rest).every(([k, v]) => v === undefined || k === 'supertypes') && (rest.supertypes ?? []).length > 0;
    // edh-d-55 (CR 712.1, 205.2a, 108.1; Invasion of Pyrulea): "if it's a land or double-faced card": a card of one type, or a double-faced card (`anyOf` of a bare card type and the
    // double-faced quality, with the card flag)
    const typeOrDfc = !plural && rest.isCard === true && Object.keys(rest).length === 2 && rest.anyOf?.length === 2 && Object.keys(rest.anyOf[0]!).length === 1 && rest.anyOf[0]!.types?.length === 1
      && Object.keys(rest.anyOf[1]!).length === 1 && rest.anyOf[1]!.doubleFaced === true ? rest.anyOf[0]!.types![0]!.toLowerCase() : undefined;
    if (typeOrDfc !== undefined) out.push(`${isA} ${withArticle(`${typeOrDfc} or double-faced card`)}`);
    else if (onlySupertypes) out.push(alt(`${isA} ${phrase}`, `${isA} ${joinList(rest.supertypes!.map((s) => s.toLowerCase()), 'or')}`));
    // edh-c-17 (CR 205.4a; Molten Rain): "if that land was nonbasic": the lack of the supertype alone is also its adjective
    else if (Object.entries(rest).every(([k, v]) => v === undefined || k === 'notSupertypes') && JSON.stringify(rest.notSupertypes) === '["Basic"]') out.push(alt(`${isA} ${phrase}`, `${isA} nonbasic`));
    // edh-zones-12 (CR 108.1, 108.2b; Currency Converter): "if it's a nonland card": a card (a token is not a card) that has none of the card types, said with the card noun
    else if (!plural && rest.isCard === true && rest.notTypes !== undefined && rest.notTypes.length > 0 && Object.entries(rest).every(([k, v]) => v === undefined || k === 'isCard' || k === 'notTypes')) {
      out.push(`${isA} ${withArticle(`${rest.notTypes.map((t) => `non${t.toLowerCase()}`).join(', ')} card`)}`);
    }
    // std-rx14 (CR 108.1, 607.2d, 608.2c; Gathering Stone, Herald's Horn): "if it's a card of the chosen type", "if it's a creature card of the chosen type": a
    // card (`isCard`, never a token) whose kind is the linked choice, said with the card noun wherever the card is (the object a step looked at; the zone is not printed)
    else if (!plural && rest.isCard === true && rest.chosen !== undefined && rest.zone === undefined && Object.entries(rest).every(([k, v]) => v === undefined || k === 'chosen' || CARD_NOUN_FIELDS.has(k))) {
      const { isCard: _card, ...kind } = rest;
      out.push(`${isA} ${K.np({ ...kind, zone: 'any' }, st, { det: 'a', plural: false, noController: true, head: 'card' })}`);
    }
    // edh-cast-8 (CR 205.3m, 108.1; Descendants' Path): "if it's a creature card that shares a creature type with a creature you control": the card noun, then what it shares
    else if (!plural && rest.isCard === true && rest.sharesWith !== undefined && rest.zone === undefined && Object.entries(rest).every(([k, v]) => v === undefined || k === 'sharesWith' || CARD_NOUN_FIELDS.has(k)) && (rest.types ?? []).length > 0) {
      const { isCard: _card, ...kind } = rest;
      out.push(`${isA} ${K.np({ ...kind, zone: 'any' }, st, { det: 'a', plural: false, noController: true, head: 'card' })}`);
    }
    // edh-zones-10 (CR 108.1, 111.1; Mind's Dilation): "if it's a nonland card": a card (never a token) that is not of the types, the card noun after the negation (an unzoned filter would
    // be a permanent: "nonland, nontoken permanent"); the zone is not printed, as for the chosen kind above. Only negated types, subtypes and supertypes with the card flag
    else if (!plural && rest.isCard === true && rest.zone === undefined && (rest.notTypes ?? []).length > 0 && (rest.types ?? []).length === 0 && (rest.allTypes ?? []).length === 0 && (rest.subtypes ?? []).length === 0
      && Object.entries(rest).every(([k, v]) => v === undefined || k === 'isCard' || k === 'notTypes' || k === 'notSubtypes' || k === 'notSupertypes')) {
      const { isCard: _card, ...kind } = rest;
      out.push(`${isA} ${K.np({ ...kind, zone: 'any' }, st, { det: 'a', plural: false, noController: true, head: 'card' })}`);
    }
    // edh-d-8 (CR 205.4, 108.1; Frost Augur): "it's a snow card", "it's a legendary card": a card with only a supertype to describe it, the card noun said with the supertype and no zone
    else if (!plural && rest.isCard === true && rest.zone === undefined && (rest.supertypes ?? []).length > 0 && (rest.types ?? []).length === 0 && (rest.allTypes ?? []).length === 0 && (rest.subtypes ?? []).length === 0
      && Object.entries(rest).every(([k, v]) => v === undefined || k === 'isCard' || k === 'supertypes')) {
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
const PAST_FIELDS: ReadonlySet<string> = new Set(['modified' /* edh-d-53 (CR 700.9) */, 'types', 'allTypes', 'notTypes', 'subtypes', 'notSubtypes', 'supertypes', 'notSupertypes', 'isCard', 'tapped',
  'manaValue', 'power', 'toughness', 'colors', 'colorless', 'multicolored', 'token', 'dealtDamageThisTurn', 'dealtExcessDamageThisTurn' /* edh-d-38 */, 'attacking', 'blocking',
  'suspected', // FAST5X E12 (CR 701.60b): a designation of the permanent, kept in its last known information (LastKnown.object)
  'counters', // FAST5X E21 (CR 122.1, 608.2h): the counters on it, kept in its last known information (LastKnown.object.counters)
  'commander', // edh-players-20 (CR 903.3, 608.2h; Tevesh Szat): "if the sacrificed permanent was a commander": the card's designation, kept with the card (statics/commander.ts#isCommander reads its card id)
]);
/** edh-next-47 (CR 700.6): the filter is exactly the word "historic" (an artifact, a legendary object or a Saga), nothing else said. */
function isHistoricOnly(f: ObjectFilter): boolean {
  const live = Object.entries(f).filter(([, v]) => v !== undefined);
  return live.length === 1 && live[0]![0] === 'anyOf' && JSON.stringify(f.anyOf) === '[{"types":["Artifact"]},{"supertypes":["Legendary"]},{"subtypes":["Saga"]}]';
}
/** edh-d-41 (CR 303.4b, 301.5): the filter is exactly "enchanted or equipped" (an Aura or an Equipment attached), nothing else said. */
function isEnchantedOrEquippedOnly(f: ObjectFilter): boolean {
  const live = Object.entries(f).filter(([, v]) => v !== undefined);
  return live.length === 1 && live[0]![0] === 'anyOf' && JSON.stringify(f.anyOf) === '[{"enchanted":true},{"equipped":true}]';
}
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
  // edh-d-5 (CR 603.10a, 303.4b, 301.5; Gunner Conscript): what was attached to the object as it left is kept in its last known information too ("if it was enchanted", "if it was equipped")
  const countersOnly = Object.entries(c.filter).every(([k, v]) => v === undefined || k === 'counters' || (k === 'enchanted' && v === true) || (k === 'equipped' && v === true) || (k === 'anyOf' && isEnchantedOrEquippedOnly(c.filter)))
    && (c.filter.counters !== undefined || c.filter.enchanted === true || c.filter.equipped === true || isEnchantedOrEquippedOnly(c.filter));
  if (!(lookBackCounters > 0 && countersOnly)) {
    if (noPastTense > 0) return null;
    if (c.object.ref === 'self' || Object.entries(c.filter).some(([k, v]) => v !== undefined && !PAST_FIELDS.has(k) && !(k === 'anyOf' && isHistoricOnly(c.filter)) && !(k === 'anyOf' && lookBackCounters > 0 && isEnchantedOrEquippedOnly(c.filter)) && !(k === 'stackKind' || (k === 'zone' && v === 'stack')))) return null; // edh-c-51 (CR 608.2h, 701.6; Jace's Defeat): "if it was a Jace planeswalker spell": the spell it countered, as it last existed on the stack
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
    case 'exists':
      // edh-d-89 (CR 506.3, 508.1b, 603.4; Jin Sakai, Ghost of Tsushima): "no other creatures are attacking that player": no creature but the event's attacker attacks the event's defending player
      if (c.atLeast === undefined && JSON.stringify(c.of) === '{"ref":"each","filter":{"types":["Creature"],"not":{"is":{"ref":"event","role":"attacker"}},"attacking":{"defender":{"ref":"event","role":"defender"}}}}') {
        // review: only in a trigger of an attack on a PLAYER ("attacks a player"), where "that player" is the attacked player (never a planeswalker or battle)
        const t = st.trigger ?? [];
        const onPlayer = t.length === 1 && t[0]!.ev === 'attacks' && typeof (t[0] as { defender?: unknown }).defender === 'string' && !['planeswalker', 'battle'].includes((t[0] as { defender: string }).defender);
        if (!onPlayer) throw new NoRenderer('"no other creatures are attacking that player" outside a trigger of an attack on a player');
        return 'no other creatures are attacking that player';
      }
      return existsPhrase(c.of, c.atLeast, true, st);
    case 'turnOf':
      if (c.extra === true) throw new NoRenderer('a negated extra turn'); // edh-next-31
      // FAST5X E9 (CR 505.1): "it isn't your main phase"; a step other than both main phases has no negated wording here (it was dropped before)
      if (isYourMainPhase(c)) return alt("it isn't your main phase", "it's not your main phase", 'it is not your main phase');
      if (c.step !== undefined) throw new NoRenderer('a negated turn condition with a step');
      { const t = turnOf(c.whose, st); return alt(`it's not ${t}`, `it isn't ${t}`, `it is not ${t}`); } // edh-players-2 (Tataru Taru): Oracle prints "if it isn't that player's turn"
    case 'completedDungeon': return completedPhrase(c, st, true); // MX4
    case 'eventDied': return "it didn't die"; // edh-next-97 (CR 700.4; Taeko, the Patient Avalanche): Oracle prints the contraction
    // edh-perms-13 (CR 725.1; Court of Vantress): "if you're not the monarch" (Oracle's "you're" is read as "you are", as the positive form's; one text, no alternative group)
    case 'designation':
      // edh-c-114 (CR 725.1, 725.2; M'Baku): "if there is no monarch" is no player (each player) being the monarch
      if (c.what === 'monarch' && c.who.ref === 'each' && (c.who as { who?: string }).who === 'player') return 'there is no monarch';
      return c.what === 'monarch' && c.who.ref === 'you' ? 'you are not the monarch' : null;
    case 'putBySource': { // edh-perms-9 (CR 608.2): "if it wasn't put onto the battlefield with this ability"
      const o = K.obj(c.object, st, 'subject');
      return alt(`${o.text} ${o.plural ? "weren't" : "wasn't"} put onto the battlefield with this ability`, `${o.text} ${o.plural ? 'were not' : 'was not'} put onto the battlefield with this ability`);
    }
    case 'compare': {
      // edh-c-30 (CR 122.1f; Ravenous Necrotitan): the negation of "an opponent has three or more poison counters" has no inverted comparison to say: "no opponent has three or more poison counters"
      if (typeof c.left === 'object' && c.left.q === 'countPlayers' && c.left.poisonIs !== undefined && c.op === '>=' && c.right === 1 && c.left.of.ref === 'each' && c.left.of.who === 'opponent' && c.left.poisonIs.op === '>=' && c.left.poisonIs.n >= 2
        && Object.keys(c.left).sort().join() === 'of,poisonIs,q') return `no opponent has ${numWord(c.left.poisonIs.n)} or more poison counters`;
      // edh-c-28 (CR 608.2c, 119.1; Vampire Lacerator): a per-player count that is said by an idiom only ("an opponent has 10 or less life") has no inverted wording; its negation is said by "unless"
      try { return K.cond({ cond: 'compare', left: c.left, op: INVERT[c.op], right: c.right }, st); } catch (e) {
        if (e instanceof NoRenderer && typeof c.left === 'object' && c.left.q === 'countPlayers' && c.left.lifeIs !== undefined) return null;
        throw e;
      }
    }
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
        // edh-players-7 (CR 601.2a, 603.4; Chainer, Nightmare Adept): the object that entered (`object`, the trigger's subject) is "it", never "~" (as std-tdm's "you cast it"):
        // naming "~" here would also make the effect's "it" ambiguous between the two
        if (isEventSubject(c.object) && c.by === 'you') return "you didn't cast it from your hand";
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
      // edh-c-94 (CR 508.1; parser/holes/cond.ts, Aggression): "it didn't attack this turn", the creature an earlier part of the ability named was never declared as an attacker
      if (c.scope === 'turn' && c.by === undefined && c.times === undefined && c.event.ev === 'attacks' && Object.keys(c.event).length === 2 && c.event.attacker?.is !== undefined && Object.keys(c.event.attacker).length === 1) {
        const o = K.obj(c.event.attacker.is, st, 'subject').text;
        return alt(`${o} didn't attack this turn`, `${o} did not attack this turn`);
      }
      // edh-c-1 (CR 700.4, 603.4; family no-creature-died-this-turn; Titan Hunter): "if no creatures died this turn" (also the singular: "no creature died this turn")
      if (c.scope === 'turn' && c.times === undefined && c.by === undefined && c.event.ev === 'zoneChange' && c.event.from === 'battlefield' && c.event.to === 'graveyard' && c.event.subject !== undefined
        && c.event.subject.self !== true && Object.keys(c.event).length === 4) {
        return alt(`no ${K.np(c.event.subject, st, { det: 'none', plural: true, noZone: true })} died this turn`, `no ${K.np(c.event.subject, st, { det: 'none', noZone: true })} died this turn`);
      }
      // edh-next-82 (CR 603.4, 400.7; Sarevok, Deathbringer): "if no permanents left the battlefield this turn"
      if (c.scope === 'turn' && c.times === undefined && c.by === undefined && c.event.ev === 'zoneChange' && c.event.from === 'battlefield' && c.event.to === undefined && c.event.subject !== undefined
        && c.event.subject.self !== true && Object.keys(c.event).length === 3) {
        return alt(`no ${K.np(c.event.subject, st, { det: 'none', plural: true, noZone: true })} left the battlefield this turn`, `no ${K.np(c.event.subject, st, { det: 'none', noZone: true })} left the battlefield this turn`);
      }
      // edh-next-135 (CR 120.2a, 510.2, 500.1; parser/holes/cond.ts; Marchesa, Resolute Monarch): "you haven't been dealt combat damage since your last turn"
      if (c.scope === 'sinceYourLastTurn' && c.times === undefined && c.by === undefined && JSON.stringify(c.event) === JSON.stringify({ ev: 'damage', combat: true, recipient: { player: 'you' } })) {
        return "you haven't been dealt combat damage since your last turn";
      }
      // p2-intervening-1 (CR 119.3; parser/holes/p2iv1.ts): "you didn't lose life this turn"
      if (c.event.ev === 'life' && c.event.change === 'loss' && c.event.player === 'you' && Object.keys(c.event).length === 3 && c.scope === 'turn' && c.times === undefined && c.by === undefined) {
        return alt("you didn't lose life this turn", 'you did not lose life this turn', "you haven't lost life this turn");
      }
      // edh-combat-6 (CR 508.1b, 506.3; parser/holes/cond.ts#noneOfThoseAttackedYou): "none of those creatures attacked you"
      if (c.event.ev === 'attacks' && c.scope === 'combat' && c.times === undefined && c.by === undefined && c.event.defender === 'you' && Object.keys(c.event).length === 3
        && JSON.stringify(c.event.attacker) === '{"types":["Creature"]}') return 'none of those creatures attacked you';
      // FAST4 T23: "you haven't cast a spell from your hand this turn" (CR 601.2a)
      if (c.event.ev === 'cast' && c.event.from !== undefined) return castFromPhrase(c, st, true);
      // std-rx27 (CR 602.1, 702.177a): "you haven't activated an exhaust ability this turn" (Elvish Refueler), the negated history of your activations of that kind
      if (c.event.ev === 'activate' && c.event.player === 'you' && (c.event.ability === 'exhaust' || c.event.ability === 'loyalty') && Object.keys(c.event).length === 3
        && c.scope === 'turn' && c.times === undefined && c.by === undefined) {
        if (c.event.ability === 'loyalty') { // edh-players-6 (CR 606.3; The Chain Veil): "you didn't activate a loyalty ability of a planeswalker this turn" (parser/holes/cond.ts#e22History)
          return alt("you haven't activated a loyalty ability this turn", "you didn't activate a loyalty ability this turn", "you didn't activate a loyalty ability of a planeswalker this turn",
            "you haven't activated a loyalty ability of a planeswalker this turn");
        }
        return `you haven't activated an exhaust ability this turn`;
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

/** edh-players-7: the object a condition is about is the trigger event's subject. */
const isEventSubject = (o: unknown): boolean => typeof o === 'object' && o !== null && (o as { ref?: string }).ref === 'event' && (o as { role?: string }).role === 'subject';

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

/** edh-next-88: `all` of cast histories that each only name an amount of mana of one color spent (distinct colors), said by the symbols together; null for anything else. */
function spentColorsPhrase(of: readonly Condition[], st: RenderState): string | null {
  if (of.length < 2) return null;
  const colors = new Set<string>();
  let symbols = '';
  for (const x of of) {
    if (x.cond !== 'wasCast' || x.spent === undefined || Object.keys(x).filter((k) => (x as Record<string, unknown>)[k] !== undefined).length !== 2 || colors.has(x.spent.color)) return null;
    colors.add(x.spent.color);
    symbols += `{${x.spent.color}}`.repeat(x.spent.atLeast);
  }
  const self = K.obj({ ref: 'self' }, st, 'subject').text;
  return alt(`${symbols} was spent to cast ${self}`, `${symbols} was spent to cast it`);
}

function wasCastPhrase(c: Extract<Condition, { cond: 'wasCast' }>, st: RenderState): string {
  // FAST5X E1: "the gift was promised" (CR 702.174k: its gift cost was paid) and "~ was bargained" (CR 702.166b: its bargain cost was paid)
  if (namedCostOnly(c, 'gift')) return 'the gift was promised';
  // FAST5X E12 (CR 701.59c): "evidence was collected": its optional collect evidence cost was paid
  if (namedCostOnly(c, 'collectEvidence')) return 'evidence was collected';
  if (namedCostOnly(c, 'bargain')) return alt(`${K.obj({ ref: 'self' }, st, 'subject').text} was bargained`, 'it was bargained', "it's bargained");
  // FAST5X E9 (CR 118.8, 601.2b): "this spell's additional cost was paid": its optional additional cost without a keyword name (actions/cast-costs.ts)
  if (namedCostOnly(c, 'additional')) return `${K.obj({ ref: 'self' }, st, 'possessive').text} additional cost was paid`;
  // edh-players-7 (CR 601.2a, 603.4; Chainer, Nightmare Adept): "if you cast it from your hand" of the object that entered (the caster is you)
  if (isEventSubject(c.object) && c.by === 'you' && castFromHandOnly(c)) return 'you cast it from your hand';
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
    // edh-next-116 (CR 601.2a, 603.4; Mirror of Life Trapping): "Whenever a creature enters, if it was cast, ...": the object the trigger is about was cast (nothing more of its cast history)
    if (Object.keys(c).filter((k) => (c as Record<string, unknown>)[k] !== undefined).sort().join() === 'cond,object') return `${K.obj(c.object, st, 'subject').text} was cast`;
    if (c.via === undefined || !viaOnly(c, c.via) || c.spent !== undefined || c.fromOwner !== undefined) throw new NoRenderer('a cast history of another object other than its alternative cost');
    return `${K.obj(c.object, st, 'subject').text} was cast for its ${c.via} cost`;
  }
  // edh-players-11 (CR 118.9, 601.2b; Baleful Mastery): "the {1}{B} cost was paid", the face's alternative cost named by its mana cost (parser/parse.ts#linkAltCostNamed)
  if (c.via === 'alternative' && c.viaCost !== undefined) {
    if (c.kicked !== undefined || c.from !== undefined || c.xAtLeast !== undefined || c.by !== undefined || c.spent !== undefined || c.fromOwner !== undefined || c.kept !== undefined) throw new NoRenderer('an alternative cost named by its mana cost beside another part of the cast history');
    return `the ${formatManaCost(c.viaCost)} cost was paid`;
  }
  const self = K.obj({ ref: 'self' }, st, 'subject').text;
  // FAST5X E7 (CR 702.190b, 702.188a): "~'s sneak cost was paid", "~ was cast using web-slinging"; Oracle names a character card "he", "she" or "they"
  // std-ry7 (CR 702.137b): and "~'s spectacle cost was paid" / "its spectacle cost was paid" (family alt-cost-paid; spectacle has no "cast using" wording)
  const paidVia = viaOnly(c, 'sneak') ? 'sneak' : viaOnly(c, 'spectacle') ? 'spectacle' : undefined;
  if (paidVia !== undefined) return alt(...["~'s", 'its', 'his', 'her', 'their'].map((p) => `${p} ${paidVia} cost was paid`), ...(paidVia === 'sneak' ? [`${self} was cast using sneak`] : []));
  if (viaOnly(c, 'foretell')) return alt(`${self} was foretold`, 'it was foretold'); // cloud r3-mech (CR 702.143a)
  if (viaOnly(c, 'mayhem')) return "~'s mayhem cost was paid"; // r4-repl (CR 702.187a): its mayhem alternative cost was paid
  if (viaOnly(c, 'freerunning')) return alt("~'s freerunning cost was paid", 'its freerunning cost was paid'); // edh-next-82 (CR 702.173a): its freerunning alternative cost was paid
  if (viaOnly(c, 'prowl')) return alt("~'s prowl cost was paid", 'its prowl cost was paid'); // edh-players-22 (CR 702.76a): its prowl alternative cost was paid
  if (viaOnly(c, 'madness')) return alt("~'s madness cost was paid", 'its madness cost was paid'); // edh-d-51 (CR 702.35a-b; Grave Scrabbler)
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
    parts.push(alt(`at least ${numWord(c.spent.atLeast)} ${c.spent.color === 'C' ? 'colorless' : COLOR_WORD[c.spent.color]} mana was spent to cast ${self}`, `${symbols} was spent to cast ${self}`, `${symbols} was spent to cast it`));
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

/**
 * edh-players-18 (CR 102.3, 402.1; Fevered Visions): "if the player is your opponent": the player an earlier instruction named is an opponent of the controller; the player of a
 * trigger's event is also "the player" (family player-is-your-opponent). Only an opponent, a single player that is not "you".
 */
function playerIsPhrase(c: Extract<Condition, { cond: 'playerIs' }>, st: RenderState): string {
  if (c.who.ref === 'you' || c.who.ref === 'each') throw new NoRenderer('a player-is condition other than "<that player> is your opponent"');
  const who = K.player(c.who, st, 'subject');
  const subject = who.text === 'that player' ? alt('that player', 'the player') : who.text;
  if (c.is === 'you') return `${subject} is you`; // edh-d-52 (CR 109.5; The Ghoul, Gunslinger): "if that player is you"
  return `${subject} ${alt('is your opponent', 'is an opponent')}`;
}

/** edh-players-18: "the player is your opponent and has four or more cards in hand": both parts said of the one player, the subject once (family player-is-your-opponent). */
function playerIsAndHandPhrase(c: Extract<Condition, { cond: 'all' }>, st: RenderState): string | null {
  if (c.of.length !== 2 || c.of[0]!.cond !== 'playerIs' || c.of[1]!.cond !== 'compare') return null;
  const [a, b] = [c.of[0] as Extract<Condition, { cond: 'playerIs' }>, c.of[1] as Extract<Condition, { cond: 'compare' }>];
  const left = b.left;
  if (typeof left === 'number' || left.q !== 'zoneSize' || left.zone !== 'hand' || JSON.stringify(left.of) !== JSON.stringify(a.who)) return null;
  if (typeof b.right !== 'number' || (b.op !== '>=' && b.op !== '<=') || b.right < 1) return null;
  return `${playerIsPhrase(a, st)} and has ${b.right} ${b.op === '>=' ? 'or more' : 'or fewer'} cards in hand`;
}

function designationPhrase(c: Extract<Condition, { cond: 'designation' }>, st: RenderState): string {
  // edh-next-82 (CR 726.1, 508.1b; Undercellar Sweep): "you or a player you're attacking has the initiative" / "a player you're attacking has the initiative"
  if (c.who.ref === 'attacked') {
    if (c.what !== 'initiative' || c.who.by !== 'you' || c.asTurnBegan !== undefined) throw new NoRenderer('designation of the players attacked');
    return `${c.who.andYou === true ? 'you or ' : ''}a player you're attacking has the initiative`;
  }
  if (c.asTurnBegan === true) { // edh-next-82 (CR 725.1; Knights of the Black Rose)
    if (c.what !== 'monarch' || c.who.ref !== 'you') throw new NoRenderer('designation as the turn began other than yours as the monarch');
    return 'you were the monarch as the turn began';
  }
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
  // edh-d-89 (CR 508.1k, 108.3, 108.4; Mishra, Claimed by Gix): "~ and a creature named N are attacking, and you both own and control them": both attacking, both yours in both senses
  if (c.of.length === 2 && m?.cond === 'matches' && e?.cond === 'exists' && e.atLeast === undefined && m.object.ref === 'self' && JSON.stringify(m.filter) === '{"owner":"you","controller":"you","attacking":true}'
    && e.of.ref === 'each' && e.of.filter.owner === 'you' && e.of.filter.controller === 'you' && e.of.filter.attacking === true) {
    const { owner: _o, controller: _c, attacking: _a, ...rest } = e.of.filter;
    if (Object.keys(rest).length === 0) return null;
    return `${K.obj({ ref: 'self' }, st, 'subject').text} and ${K.np(rest, st, { det: 'a' })} are attacking, and you both own and control them`;
  }
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
 * edh-c-62 (CR 105.1, 608.2c; parser/holes/cond.ts#sharesMostCommonColor): `any` of the five colors, each `all` of "the object is that color" and "that color is the most
 * common (or tied)", is "<it> shares a color with the most common color among all permanents or a color tied for most common". Null for any other shape.
 */
function sharesMostCommonPhrase(c: Extract<Condition, { cond: 'any' }>, st: RenderState): string | null {
  if (c.of.length !== 5) return null;
  let object: unknown;
  const seen = new Set<string>();
  for (const x of c.of) {
    if (x.cond !== 'all' || x.of.length !== 2) return null;
    const [m, common] = x.of as [Condition, Condition];
    if (m.cond !== 'matches' || common.cond !== 'all' || Object.keys(m.filter).length !== 1 || m.filter.colors?.length !== 1) return null;
    const color = m.filter.colors[0]!;
    if (seen.has(color) || mostCommonColorPhrase(common) !== `${COLOR_WORD[color]} is the most common color among all permanents or is tied for most common`) return null;
    if (object !== undefined && JSON.stringify(object) !== JSON.stringify(m.object)) return null;
    object = m.object;
    seen.add(color);
  }
  return `${K.obj(object as never, st, 'subject').text} shares a color with the most common color among all permanents or a color tied for most common`;
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

/**
 * edh-perms-2 (CR 208.1; parser/holes/cond.ts#statGreaterThanEachOther): "its power is greater than each other creature's power" is `any` of no creature but the
 * named one, and its power (toughness) greater than the greatest of the creatures but it. Exactly that shape; anything else is said as it is built.
 */
function greaterThanEachOtherPhrase(c: Extract<Condition, { cond: 'any' }>, st: RenderState): string | null {
  if (c.of.length !== 2) return null;
  const [none, gt] = c.of as [Condition, Condition];
  if (none.cond !== 'compare' || gt.cond !== 'compare' || none.op !== '==' || gt.op !== '>' || none.right !== 0) return null;
  const n = none.left;
  const l = gt.left;
  const r = gt.right;
  if (typeof n === 'number' || typeof l === 'number' || typeof r === 'number' || n.q !== 'count' || l.q !== 'stat' || r.q !== 'stat' || r.agg !== 'max' || r.stat !== l.stat) return null;
  if (l.stat !== 'power' && l.stat !== 'toughness') return null;
  if (l.agg !== undefined || l.sum !== undefined || l.station !== undefined || r.sum !== undefined || r.station !== undefined) return null;
  if (JSON.stringify(n.of) !== JSON.stringify(r.of) || r.of.ref !== 'each') return null;
  const f = r.of.filter;
  if (JSON.stringify(Object.keys(f).sort()) !== '["not","types"]' || JSON.stringify(f.types) !== '["Creature"]' || f.not === undefined || JSON.stringify(Object.keys(f.not)) !== '["is"]') return null;
  if (JSON.stringify(f.not.is) !== JSON.stringify(l.of)) return null; // the same object on both sides
  return `${K.qty(l, st)} is greater than each other creature's ${l.stat}`;
}

function condBase(c: Condition, st: RenderState): string {
  st.conds.add(JSON.stringify(c));
  switch (c.cond) {
    case 'all':
    case 'any': {
      const gtOthers = c.cond === 'any' ? greaterThanEachOtherPhrase(c, st) : null; // edh-perms-2
      if (gtOthers !== null) return gtOthers;
      const playOrCast = c.cond === 'any' ? playOrCastItPhrase(c.of, st) : null; // edh-d-98
      if (playOrCast !== null) return playOrCast;
      const early = c.cond === 'all' ? earlyTurnPhrase(c) : null; // FAST5 T63
      if (early !== null) return early;
      // edh-d-37 (CR 305.6, 105.1; parser/holes/edhd37.ts; Coalition Victory): all five basic land types among your lands and all five colors among your creatures
      if (c.cond === 'all' && JSON.stringify(c) === JSON.stringify(EACH_LAND_TYPE_AND_EACH_COLOR)) return 'you control a land of each basic land type and a creature of each color';
      const twoAttacked = c.cond === 'all' ? twoAttackedPhrase(c.of, st) : null; // Standard round 4, r4-trig
      if (twoAttacked !== null) return twoAttacked;
      const handPair = c.cond === 'all' ? playerIsAndHandPhrase(c, st) : null; // edh-players-18
      if (handPair !== null) return handPair;
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
      // edh-c-40 (family card-is-in-your-graveyard): ... also "an instant card and a sorcery card are in your graveyard"
      const areInYours = inOneZone !== null ? twoCardsAreInYourGraveyard(c.of, cloneState(st)) : null;
      if (inOneZone !== null) return alt(inOneZone, joinList(c.of.map((x) => K.cond(x, st)), 'and'), ...(areInYours === null ? [] : [areInYours]));
      // edh-next-88 (CR 601.2h; family spent-colors-all; Mythos of Nethroi): mana of two or more colors spent on the spell itself, the symbols together: "{G}{W} was spent to cast ~"
      const spentColors = c.cond === 'all' ? spentColorsPhrase(c.of, st) : null;
      if (spentColors !== null) return alt(spentColors, joinList(c.of.map((x) => K.cond(x, st)), 'and'));
      const both = c.cond === 'all' ? bothSpellsPhrase(c.of, st) : null; // FAST5 T62
      if (both !== null) return alt(both, joinList(c.of.map((x) => K.cond(x, st)), 'and'));
      // pc-keywords-mana-1 (CR 608.2c; parser/holes/cond.ts#control): "you control an Urza's Power-Plant and an Urza's Tower": the control said once, two descriptions
      const ctrlBoth = c.cond === 'all' ? controlBothPhrase(c.of, st) : null;
      // edh-c-8 (family control-named-pair; Scepter of Empires): "you control artifacts named Crown of Empires and Throne of Empires", the same two existences with one description and two names
      const namedPair = c.cond === 'all' ? controlNamedPairPhrase(c.of, st) : null;
      if (ctrlBoth !== null) return alt(ctrlBoth, joinList(c.of.map((x) => K.cond(x, st)), 'and'), ...(namedPair === null ? [] : [namedPair]));
      // edh-c-28 (CR 608.2c; parser/holes/cond.ts#control, Kumena's Speaker): "you control another Merfolk or an Island", the control said once for two descriptions
      const ctrlEither = c.cond === 'any' ? controlBothPhrase(c.of, st, 'or') : null;
      // (coordinator A, 2026-10-31: with std-r7's "if A or if B" too, family or-if, which this branch would otherwise hide)
      if (ctrlEither !== null) {
        const either = c.of.map((x) => K.cond(x, st));
        return alt(ctrlEither, joinList(either, 'or'), `${either[0]} or if ${either[1]}`);
      }
      // Standard round 5, r5-trig (CR 305.1, 601.2a; Spider-Man 2099): a land play or a spell cast this turn by you from anywhere other than your hand (parser/holes/cond.ts)
      if (c.cond === 'any' && JSON.stringify(c.of) === JSON.stringify([{ cond: 'happened', event: { ev: 'action', verb: 'playLand', actor: 'you', notFrom: 'hand' }, scope: 'turn' }, { cond: 'happened', event: { ev: 'cast', player: 'you', notFrom: 'hand' }, scope: 'turn' }])) {
        return "you've played a land or cast a spell this turn from anywhere other than your hand";
      }
      // edh-d-42 (CR 305.1, 601.2a; parser/holes/cond.ts, Visions of Phyrexia): a land play or a spell cast this turn by you from exile is "you played a card from exile this turn"
      if (isPlayedFromExile(c)) return 'you played a card from exile this turn';
      // edh-c-77 (CR 508.1, 509.1, 603.4; parser/holes/cond.ts, Vizier of Deferment): "it attacked or blocked this turn": the same object was an attacker or a blocker this turn
      if (c.cond === 'any' && c.of.length === 2) {
        const [a0, b0] = c.of;
        if (a0?.cond === 'happened' && b0?.cond === 'happened' && a0.scope === 'turn' && b0.scope === 'turn' && a0.event.ev === 'attacks' && b0.event.ev === 'blocks' && Object.keys(a0.event).length === 2 && Object.keys(b0.event).length === 2
          && a0.event.attacker?.is !== undefined && Object.keys(a0.event.attacker).length === 1 && JSON.stringify(a0.event.attacker) === JSON.stringify(b0.event.blocker)) {
          const who = K.obj(a0.event.attacker.is, cloneState(st), 'object').text;
          return alt(`${who} attacked or blocked this turn`, `${who} attacked this turn or ${who} blocked this turn`);
        }
      }
      // edh-c-16 (CR 113.6m; parser/holes/cond.ts, Firemane Angel): "~ is in your graveyard or on the battlefield"
      if (c.cond === 'any' && JSON.stringify(c.of) === JSON.stringify([{ cond: 'matches', object: { ref: 'self' }, filter: { zone: 'graveyard', owner: 'you' } }, { cond: 'matches', object: { ref: 'self' }, filter: { zone: 'battlefield' } }])) {
        st.mentioned.add('self');
        return alt('~ is in your graveyard or on the battlefield', '~ is on the battlefield or in your graveyard'); // edh-next-103 (Skyblade's Boon)
      }
      // edh-next-53 (CR 400.7, 601.2a, 603.4; parser/holes/cond.ts, Fblthp, the Lost): "it entered from your library or was cast from your library" (the object itself)
      if (c.cond === 'any' && c.of.length === 2 && c.of[0]!.cond === 'matches' && JSON.stringify(c.of[0]!.filter) === JSON.stringify({ enteredFrom: 'library', owner: 'you' }) && c.of[1]!.cond === 'wasCast'
        && JSON.stringify({ ...c.of[1]!, object: undefined }) === JSON.stringify({ cond: 'wasCast', from: 'library', fromOwner: 'you' }) && JSON.stringify(c.of[0]!.object) === JSON.stringify(c.of[1]!.object ?? c.of[0]!.object) && (c.of[0]!.object.ref === 'self' || (c.of[0]!.object.ref === 'event' && c.of[0]!.object.role === 'subject'))) {
        return 'it entered from your library or was cast from your library';
      }
      // edh-d-14 (CR 400.7, 601.2a, 603.4; parser/holes/cond.ts, Archfiend's Vessel): "it entered from your graveyard or you cast it from your graveyard" (the object itself)
      if (c.cond === 'any' && c.of.length === 2 && c.of[0]!.cond === 'matches' && JSON.stringify(c.of[0]!.filter) === JSON.stringify({ enteredFrom: 'graveyard', owner: 'you' }) && c.of[1]!.cond === 'wasCast'
        && JSON.stringify({ ...c.of[1]!, object: undefined, by: undefined }) === JSON.stringify({ cond: 'wasCast', from: 'graveyard', fromOwner: 'you' }) && JSON.stringify(c.of[0]!.object) === JSON.stringify(c.of[1]!.object ?? c.of[0]!.object) && (c.of[0]!.object.ref === 'self' || (c.of[0]!.object.ref === 'event' && c.of[0]!.object.role === 'subject'))) {
        return 'it entered from your graveyard or you cast it from your graveyard';
      }
      // edh-d-76 (CR 400.7, 601.2a, 603.4; parser/holes/cond.ts, Breathless Knight): "that creature entered from a graveyard or you cast it from a graveyard" (the object the trigger's event is about)
      if (c.cond === 'any' && c.of.length === 2 && c.of[0]!.cond === 'matches' && JSON.stringify(c.of[0]!.filter) === JSON.stringify({ enteredFrom: 'graveyard' }) && c.of[1]!.cond === 'wasCast'
        && JSON.stringify({ ...c.of[1]!, object: undefined }) === JSON.stringify({ cond: 'wasCast', from: 'graveyard', by: 'you' }) && JSON.stringify(c.of[0]!.object) === JSON.stringify(c.of[1]!.object) && c.of[0]!.object.ref === 'event' && c.of[0]!.object.role === 'subject') {
        return 'that creature entered from a graveyard or you cast it from a graveyard';
      }
      // edh-c-16 (CR 301.5, 303.4; parser/holes/cond.ts, Warchanter Skald): "it's enchanted or equipped": an Aura or an Equipment is attached to the object
      if (c.cond === 'any' && c.of.length === 2) {
        const [m, e] = c.of;
        const eq = e!.cond === 'exists' && e!.atLeast === undefined && e!.of.ref === 'each' && 'filter' in e!.of ? e!.of.filter : null;
        if (m!.cond === 'matches' && JSON.stringify(m!.filter) === '{"enchanted":true}' && eq !== null && eq.attachedToObject !== undefined && JSON.stringify(eq.attachedToObject) === JSON.stringify(m!.object)
          && JSON.stringify(eq.subtypes) === '["Equipment"]' && Object.keys(eq).length === 2) return `${K.obj(m!.object, st, 'subject').text} is enchanted or equipped`;
      }
      // edh-c-10 (CR 402.1; parser/holes/cond.ts, The Biblioplex): "you have exactly zero or seven cards in hand" (a hand size of 0, or of the other number)
      if (c.cond === 'any' && c.of.length === 2) {
        const [z, n] = c.of as [Condition, Condition];
        const hand = (x: Condition): number | null => (x.cond === 'compare' && x.op === '==' && typeof x.right === 'number' && typeof x.left === 'object' && x.left.q === 'zoneSize' && x.left.zone === 'hand' && JSON.stringify(x.left.of) === '{"ref":"you"}' ? x.right : null);
        if (hand(z) === 0 && hand(n) !== null && hand(n)! > 0) return `you have exactly zero or ${numWord(hand(n)!)} cards in hand`;
      }
      // edh-next-37: no other reading makes this shape (the paid optional additional cost or a creature kind controlled as it was cast): its one wording, the cost being the reveal the card's first sentence names
      const revealedCtl = c.cond === 'any' ? revealedOrControlledPhrase(c.of, st) : null;
      if (revealedCtl !== null) return revealedCtl;
      const elsewhere = c.cond === 'any' ? castElsewherePhrase(c, st) : null; // FAST5 T70
      if (elsewhere !== null) return elsewhere;
      const common = c.cond === 'all' ? mostCommonColorPhrase(c) : null; // FAST5 T37
      if (common !== null) return common;
      const sharesCommon = c.cond === 'any' ? sharesMostCommonPhrase(c, st) : null; // edh-c-62
      if (sharesCommon !== null) return sharesCommon;
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
      const mixed = c.of.some((x) => (x.cond === 'all' || x.cond === 'any') && x.cond !== c.cond && x.of.length > 1 && !(x.cond === 'all' && spentColorsPhrase(x.of, st) !== null)); // edh-next-88: mana of several colors spent is one phrase, not a nested list
      if (mixed) throw new NoRenderer('all inside any (or any inside all) has no unambiguous wording');
      // FAST5 T65: comparisons of the statistics of ONE object ("its power is greater than ~'s power or its toughness is greater than ~'s toughness") are a
      // parallel list: each names the object the way a lone comparison would, whatever the one before it mentioned (so each is also written from the state
      // the list started with; the list as one sequence stays a reading too)
      const parallel = sameObjectStats(c.of) ? c.of.map((x) => K.cond(x, cloneState(st))) : null;
      const elided = c.cond === 'any' ? elidedReturnedPhrase(c.of, st) : null; // r4-moved
      if (elided !== null) return elided;
      // trek-18 (CR 500.7; family and-havent-begun-extra-turn; H.M.S. Bounty): "you control a Whale and haven't begun an extra turn this game": the second condition may leave its "you" out
      const lastOf = c.of[c.of.length - 1];
      if (c.cond === 'all' && c.of.length === 2 && lastOf?.cond === 'compare' && lastOf.op === '==' && lastOf.right === 0 && typeof lastOf.left === 'object' && lastOf.left.q === 'extraTurnsBegun') {
        const first = K.cond(c.of[0]!, st);
        return first.startsWith('you ') ? alt(`${first} and you haven't begun an extra turn this game`, `${first} and haven't begun an extra turn this game`) : `${first} and you haven't begun an extra turn this game`;
      }
      const parts = c.of.map((x) => K.cond(x, st));
      // std-r7 (family or-if; parser/holes/cond.ts): "if A or if B" is "if A or B", the second condition with its "if" said again (two conditions only)
      const listed = c.cond === 'any' && parts.length === 2 ? alt(joinList(parts, 'or'), `${parts[0]} or if ${parts[1]}`) : joinList(parts, c.cond === 'all' ? 'and' : 'or');
      const anyPlayer = c.cond === 'any' ? anyPlayerLife(c.of) : null;
      return anyPlayer === null && parallel === null ? listed : alt(listed, ...(anyPlayer === null ? [] : [anyPlayer]), ...(parallel === null ? [] : [joinList(parallel, c.cond === 'all' ? 'and' : 'or')]));
    }
    case 'not': {
      if (isPlayedFromExile(c.of)) return "you didn't play a card from exile this turn"; // edh-d-42 (Visions of Phyrexia)
      // edhd27 (CR 701.38a; parser/holes/vote.ts#voteCondAt): "no creature got votes", nothing of the vote before has the most votes
      if (c.of.cond === 'exists' && c.of.of.ref === 'bound' && c.of.atLeast === undefined) {
        const said = st.info.get(`b:${c.of.of.name}`)?.alts;
        const nouns = (said ?? []).map((a) => /^each (\w+) with the most votes or tied for most votes$/.exec(a)?.[1]);
        if (said !== undefined && said.length > 0 && nouns.every((n) => n !== undefined)) return alt(...nouns.map((n) => `no ${n} got votes`));
      }
      // edh-next-94 (CR 110.2, 608.2c; Modify Memory): of the two targets an earlier sentence named, you control none: "if you control neither creature" (parser/holes/edhn94.ts#edhn94CondAt)
      if (c.of.cond === 'exists' && c.of.atLeast === undefined && c.of.of.ref === 'each' && 'filter' in c.of.of) {
        const f = c.of.of.filter as { is?: { ref?: string; id?: string }; controller?: string };
        const noun = f.is?.ref === 'target' && f.is.id !== undefined ? st.info.get(`t:${f.is.id}`)?.nouns[0] : undefined;
        if (Object.keys(f).length === 2 && f.controller === 'you' && noun !== undefined) return `you control neither ${noun}`;
      }
      const phrase = notPhrase(c.of, st);
      if (phrase !== null) return phrase;
      return `it's not the case that ${K.cond(c.of, st)}`;
    }
    case 'compare': {
      // edh-next-128 (CR 705.2, 608.2c; Yusri, Fortune's Flame): the flips a called flip of several coins won, at least N: "you won five flips this way"
      if (typeof c.left === 'object' && c.left.q === 'resultCount' && Object.keys(c.left).length === 2 && c.op === '>=' && typeof c.right === 'number' && c.right >= 2 && st.info.get(`r:${c.left.step}`)?.thisWay === 'you win') return `you won ${numWord(c.right)} flips this way`;
      // edh-next-143 (CR 701.20a, 202.3, 608.2c; Atemsis, All-Seeing): "cards with at least six different mana values are revealed this way": the different mana values among the cards of
      // the hand an earlier step of the ability revealed, at least N (parser/holes/cond.ts#revealedDistinctManaValuesCond)
      if (typeof c.left === 'object' && c.left.q === 'distinct' && c.left.what === 'manaValues' && c.op === '>=' && typeof c.right === 'number' && c.right >= 2 && c.left.among.ref === 'each') {
        const f = c.left.among.filter as Record<string, unknown>;
        const is = f['is'] as { ref?: string; name?: string } | undefined;
        if (Object.keys(f).sort().join() === 'is,zone' && f['zone'] === 'any' && is?.ref === 'bound' && st.info.get(`b:${is.name}`)?.hand === true) return `cards with at least ${numWord(c.right)} different mana values are revealed this way`;
      }
      // edh-d-28 (CR 705.1, 608.2c; Two-Headed Giant): the coins of a flip of exactly two coins that came up heads are 2 / 0: "both coins come up heads / tails"
      if (typeof c.left === 'object' && c.left.q === 'resultCount' && Object.keys(c.left).length === 2 && c.op === '==' && (c.right === 2 || c.right === 0) && st.info.get(`r:${c.left.step}`)?.twoCoins === true) return `both coins come up ${c.right === 2 ? 'heads' : 'tails'}`;
      // edh-next-51 (CR 506.3, 508.1; parser/holes/cond.ts, Nemesis Phoenix): "you're attacking two or more opponents", the opponents of this combat counted at least N (the count reads the combat's attackers)
      if (typeof c.left === 'object' && c.left.q === 'opponentsAttacked' && c.left.scope === undefined && Object.keys(c.left).length === 1 && c.op === '>=' && typeof c.right === 'number' && c.right >= 2) {
        return alt(`you are attacking ${K.qty(c.right, st)} or more opponents`, `you're attacking ${K.qty(c.right, st)} or more opponents`);
      }
      // edh-d-8 (CR 303.4a, 613.7; parser/holes/edhd8.ts, family enchanted-by-auras; Timber Paladin): "~ is enchanted by exactly two Auras", the number of Auras attached to the object
      if (typeof c.left === 'object' && c.left.q === 'count' && c.left.of.ref === 'each' && 'filter' in c.left.of && c.op === '==' && typeof c.right === 'number' && c.right >= 1) {
        const f = c.left.of.filter;
        if (f.attachedToObject !== undefined && f.subtypes?.length === 1 && f.subtypes[0] === 'Aura' && Object.keys(f).length === 2) {
          return alt(`${K.qty(c.left, st)} is ${cmpWords(c.op, K.qty(c.right, st))}`, `${K.obj(f.attachedToObject, cloneState(st), 'subject').text} is enchanted by exactly ${numWord(c.right)} ${c.right === 1 ? 'Aura' : 'Auras'}`);
        }
      }
      // edh-next-134 (CR 104.3, 800.4a; parser/holes/edhn134.ts, family players-lost-or-more; Hot Pursuit): "two or more players have lost the game"
      if (typeof c.left === 'object' && c.left.q === 'playersLost' && c.op === '>=' && typeof c.right === 'number' && c.right >= 2) return alt(`${K.qty(c.left, st)} is ${cmpWords(c.op, K.qty(c.right, st))}`, `${numWord(c.right)} or more players have lost the game`);
      // edh-c-95 (CR 702.82b, 608.2h; Hellkite Hatchling): the creatures a devour sacrificed as it entered are the linked number; one or more of them is "it devoured a creature"
      if (typeof c.left === 'object' && c.left.q === 'chosenNumber' && c.left.link === 'devoured' && c.op === '>=' && c.right === 1) return 'it devoured a creature';
      // edh-next-15 (CR 608.2c, 120.3; template eff.edhn15.ifPlayerDealtDamageThisWay.then): "a player is dealt damage this way": one of the players the damage step right before dealt damage to
      if (typeof c.left === 'object' && c.left.q === 'countPlayers' && Object.keys(c.left).length === 2 && c.left.of.ref === 'bound' && c.op === '>=' && c.right === 1 && st.info.get(`b:${c.left.of.name}`)?.thisWay === 'dealt damage this way') return 'a player is dealt damage this way';
      // std-combat-1 (CR 603.4, 508.5; parser/holes/cond.ts#thoseAttackingYou): "two or more of those creatures are attacking you and/or planeswalkers you control"
      const att = attackingYouOrWalkers(c);
      // edh-zones-2 (CR 107.3, 608.2h; Thassa's Oracle): a calculated quantity an earlier "X cards, where X is ..." named is also said as X
      // trek-15: and against a number, "If X is 6 or more, create ..." (The Destruction of Praxis)
      if (saidX(c.left, st) && (typeof c.right === 'object' || (c.op === '>=' && typeof c.right === 'number'))) return alt(`${K.qty(c.left, st)} is ${cmpWords(c.op, K.qty(c.right, st))}`, `X is ${cmpWords(c.op, K.qty(c.right, st))}`);
      // p2-cost-statics-1 (CR 506.4; family exactly-one-attacking): "exactly one creature is attacking" is "the number of attacking creatures is one"
      if (exactlyOneAttacking(c)) return alt(`${K.qty(c.left, st)} is ${cmpWords(c.op, K.qty(c.right, st))}`, 'exactly one creature is attacking');
      if (att !== null) return `${numWord(att.n)} or more of ${K.obj(att.of, st, 'object').text} are attacking you and/or planeswalkers you control`;
      // edh-next-55 (CR 706.2, 608.2h; Monoxa, Mr. House; parser/holes/edhn55.ts): the result of the roll against a number is also "the roll was 4 or higher" / "you rolled 6 or higher"
      if (typeof c.left === 'object' && c.left.q === 'dieResult' && typeof c.right === 'number' && (c.op === '>=' || c.op === '<=')) {
        const way = c.op === '>=' ? 'higher' : 'lower';
        return alt(`${K.qty(c.left, st)} is ${cmpWords(c.op, K.qty(c.right, st))}`, `the roll was ${c.right} or ${way}`, `you rolled ${c.right} or ${way}`);
      }
      // edh-d-49 (CR 706.2, 603.2c, 608.2h; Farideh, Devil's Chosen; parser/holes/edhn55.ts): "If any of those results was 10 or higher": the highest result of the dice rolled is at least that number
      if (typeof c.left === 'object' && c.left.q === 'dieResultHighest' && typeof c.right === 'number' && c.op === '>=') return `any of those results was ${c.right} or higher`;
      // edh-mana-keywords-10 (CR 706.2, 608.2h; Luck Bobblehead; parser/holes/cond.ts#rolledExactlyTimes): "you rolled 6 exactly seven times"
      if (typeof c.left === 'object' && c.left.q === 'diceResults' && typeof c.left.match === 'number' && c.op === '==' && typeof c.right === 'number') return `you rolled ${c.left.match} exactly ${numWord(c.right)} time${c.right === 1 ? '' : 's'}`;
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
          if (e instanceof NoRenderer && typeof c.left === 'object' && c.left.q === 'countPlayers' && c.left.sizeVs !== undefined && c.left.of.ref === 'each' && (c.left.of.who === 'player' || c.left.of.who === 'opponent')) return null; // edh-players-9, edh-c-40 ("more cards in hand than each opponent"): "more cards in hand than each other player", the idiom only
          if (e instanceof NoRenderer && typeof c.left === 'object' && c.left.q === 'countPlayers' && c.left.controlsIs !== undefined) return null; // std-rx31, opp-port-1: the idiom only
          if (e instanceof NoRenderer && typeof c.left === 'object' && (c.left.q === 'mostSharingName' || c.left.q === 'mostSharingCreatureType')) return null; // edh-replace-4, edh-c-74: the idiom only
          if (e instanceof NoRenderer && typeof c.left === 'object' && c.left.q === 'happenedPlayers' && c.left.of.ref === 'event') return null; // edh-d-37: "that player had another land enter ...", the idiom only
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
    case 'exists': {
      // pc-players-2 (CR 208.1, 608.2h; parser/holes/cond.ts#greatestPower): one creature you control has at least the greatest power among all creatures: also said "you control
      // the creature with the greatest power or tied for the greatest power" (a tie counts)
      const f = c.of.ref === 'each' ? c.of.filter : undefined;
      const p = f?.power;
      const tied = f !== undefined && c.atLeast === undefined && Object.keys(f).length === 3 && JSON.stringify(f.types) === '["Creature"]' && f.controller === 'you' && p?.op === '>=' && typeof p.value === 'object' && JSON.stringify(p.value) === JSON.stringify({ q: 'stat', stat: 'power', of: { ref: 'each', filter: { types: ['Creature'], zone: 'battlefield' } }, agg: 'max' });
      // edh-c-42 (CR 205.3, 603.4; War Falcon): "you control a Knight or a Soldier": a permanent you control of either of two descriptions (template sta.edhv42.self.cantAttack.unlessControlEither)
      const either = f?.anyOf !== undefined && f.anyOf.length === 2 && c.atLeast === undefined && f.controller === 'you' && Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).length === 2
        && f.anyOf.every((x) => x.subtypes?.length === 1 && Object.keys(x).filter((k) => (x as Record<string, unknown>)[k] !== undefined).length === 1) ? f.anyOf : undefined;
      if (either !== undefined) return `you control ${either.map((x) => K.np(x, st, { det: 'a', noController: true })).join(' or ')}`;
      const said = existsPhrase(c.of, c.atLeast, false, st);
      if (tied && said !== null) return alt(said, 'you control the creature with the greatest power or tied for the greatest power');
      // edh-zones-24 (CR 603.4, 400.7; template eff.edhz24.delayEnd.ifRemainExiled): some of a group of cards an earlier instruction exiled are still in exile, "if any of those cards remain exiled"
      const stillExiled = f !== undefined && c.atLeast === undefined && f.zone === 'exile' && f.is?.ref === 'bound' && Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join() === 'is,zone';
      return stillExiled && said !== null ? alt(said, 'any of those cards remain exiled') : said;
    }
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
        if (c.what === 'allCardTypes') throw new NoRenderer('all cards exiled with ~ share all their card types'); // edh-d-91: no such wording
        return `all cards exiled with ~ share ${c.what === 'color' ? 'a color' : 'a card type'}`;
      }
      const milled = f?.is !== undefined && f.is.ref === 'bound' && st.info.has(`${MILLED_KEY}${f.is.name}`) && f.zone === 'any';
      if (!milled || c.count !== 2) throw new NoRenderer('objects that share a card type or color other than two of the cards milled this way');
      const { is: _is, zone: _zone, ...rest } = f;
      const cards = K.np({ ...rest, zone: 'graveyard' }, st, { det: 'none', plural: true, noZone: true });
      return `two ${cards} that share ${c.what === 'color' ? 'a color' : c.what === 'allCardTypes' ? 'all their card types' /* edh-d-91: Demonic Covenant */ : 'a card type'} ${alt('were', 'are')} milled this way`;
    }
    case 'matches': {
      // edh-d-93 (CR 208.1, 613.4, 608.2h; parser/holes/edhd93.ts; Jason Bright, Glowing Prophet): "its power was different from its base power", nothing else said of the object
      if (Object.keys(c.filter).length === 1 && c.filter.powerDiffersFromBase === true) {
        const o = K.obj(c.object, st, 'possessive');
        if (!o.plural) return `${o.text} power was different from its base power`;
      }
      // edh-next-111 (CR 202.3, 107.1; parser/holes/edhn111.ts; Yennett, Cryptic Sovereign): "its mana value is odd", the object's mana value has that parity, nothing else said of it
      if (Object.keys(c.filter).length === 1 && c.filter.manaValueParity !== undefined) {
        const o = K.obj(c.object, st, 'possessive');
        if (!o.plural) return `${o.text} mana value is ${c.filter.manaValueParity}`;
      }
      // edh-c-6 (CR 208.1, 608.2h; parser/holes/cond.ts#matches; Sigil Captain): "if that creature is 1/1" is also "if it has power 1 and toughness 1": an exact power and toughness, nothing else
      const pw = c.filter.power;
      const tg = c.filter.toughness;
      if (!inExactPt && Object.keys(c.filter).length === 2 && pw !== undefined && tg !== undefined && pw.op === '==' && tg.op === '==' && typeof pw.value === 'number' && typeof tg.value === 'number') {
        const o = K.obj(c.object, st, 'subject');
        const exact = `${o.text} ${o.plural ? 'are' : 'is'} ${pw.value}/${tg.value}`;
        inExactPt = true;
        try {
          const generic = K.cond(c, cloneState(st));
          return alt(exact, generic);
        } finally {
          inExactPt = false;
        }
      }
      // edh-c-59 (CR 115.9a, 601.2c; Captured by the Consulate, family has-single-target): "if it has a single target" (the spell that caused the trigger): the one filter field is the number of its targets
      if (Object.keys(c.filter).length === 1 && c.filter.targetCount?.op === '==' && c.filter.targetCount.value === 1) {
        const o = K.obj(c.object, st, 'subject');
        return `${o.text} ${o.plural ? 'have' : 'has'} a single target`;
      }
      // edh-c-20 (CR 120.1, 603.4; parser/holes/cond.ts; Hawkeye, Avenging Archer): "if ~ dealt damage to it this turn": the object was dealt damage this turn by the source, nothing else
      if (Object.keys(c.filter).length === 1 && c.filter.dealtDamageBySourceThisTurn === true) {
        const o = K.obj(c.object, st, 'subject');
        if (!o.plural) return `${K.obj({ ref: 'self' }, st, 'subject').text} dealt damage to ${o.text} this turn`;
      }
      // edh-next-137 (CR 608.2c, 608.2h; parser/holes/cond.ts#matches; Nissa, Steward of Elements): "if it's a land card or a creature card with mana value ...": either of two whole
      // card descriptions (`anyOf` of two cards and nothing else), each with its own article
      const two = c.filter.anyOf;
      if (Object.keys(c.filter).length === 1 && two !== undefined && two.length === 2 && two.every((f) => f.isCard === true && f.anyOf === undefined)) {
        const o = K.obj(c.object, st, 'subject');
        const card = (f: ObjectFilter): string | null => {
          const noun: ObjectFilter = {};
          for (const k of ['types', 'allTypes', 'subtypes', 'supertypes'] as const) if (f[k] !== undefined) (noun as Record<string, unknown>)[k] = f[k];
          if (Object.entries(f).every(([k, v]) => v === undefined || CARD_NOUN_FIELDS.has(k)) && Object.keys(noun).length > 0) return `${K.np(noun, st, { det: 'a', plural: false, noController: true })} card`;
          const w = cardWithStats(f, '', false, st);
          return w === null ? null : w.replace(/^ is /, '');
        };
        const words = two.map(card);
        if (!o.plural && words.every((w) => w !== null)) return `${o.text} is ${words.join(' or ')}`;
      }
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
      // edh-d-72 (CR 105.1, 607.2d; Tablet of the Guilds): "if it's at least one of the chosen colors": the object is one of the colors the linked "choose two colors" chose (the `chosen` color quality matches
      // any of the values the source kept). A single chosen color has its own wording ("the chosen color"), which no template reads
      if (Object.keys(c.filter).length === 1 && ch !== undefined && ch.quality === 'color') {
        const o = K.obj(c.object, st, 'subject');
        if (!o.plural) return `${o.text} is at least one of the chosen colors`;
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
      // edh-c-76 (CR 303.4, 611.3a; Mishra's Domination): the same test about the permanent this Aura enchants, written in the present by a static ability: "as long as you control enchanted creature"
      if (youControlledOnly(c) && c.object.ref === 'attachedTo') return `you control ${K.obj(c.object, st, 'object').text}`;
      // edh-d-40 (CR 303.4, 102.2; Dog Umbra; family another-player-controls-enchanted): "another player controls enchanted creature" is the test that an opponent controls it (no team is played)
      if (c.object.ref === 'attachedTo' && Object.keys(c.object).length === 1 && JSON.stringify(c.filter) === '{"controller":"opponent"}') {
        const them = K.obj(c.object, st, 'object').text;
        return alt(`an opponent controls ${them}`, `another player controls ${them}`);
      }
      if (youControlledOnly(c)) {
        const saved = st.notAntecedent;
        st.notAntecedent = 'self';
        try {
          const them = K.obj(c.object, st, 'object').text;
          // edh-perms-12 (CR 603.7c; Phelia): "If it entered under your control" is the same test of the permanent a return to the battlefield made (family it-entered-under-your-control)
          // (only for a binding, which follows the card to the battlefield (design 3.1 rule 4): a target handle of a card that moved reads the card as it last existed, where "entered under your
          // control" would be the permanent that came back)
          if (c.object.ref !== 'bound') return `you controlled ${them}`;
          return alt(`you controlled ${them}`, `${them} entered under your control`, `${them} entered the battlefield under your control`);
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
      // edhn95 (CR 702.62b, 113.6m; parser/holes/edhn95.ts): "if ~ is suspended": the object itself is a card in exile with suspend and a time counter on it
      if (c.object.ref === 'self' && c.filter.zone === 'exile' && c.filter.keyword === 'suspend' && c.filter.counters?.kind === 'time' && Object.keys(c.filter).length === 3 && Object.keys(c.filter.counters).length === 1) {
        st.mentioned.add('self');
        return '~ is suspended';
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
      // edh-c-95 (CR 109.2, 110.4, 608.2c; the parser's rule, parser/lower/anaphora.ts#compatible; family it-is-a-kind): an instant or sorcery spell is never a creature
      // or any other kind of permanent, so "If it's an artifact creature" after "~ deals 2 damage to target creature" names the target ("it"), not the spell
      const kindOnly = Object.keys(c.filter).length > 0 && Object.keys(c.filter).every((k) => k === 'types' || k === 'subtypes' || k === 'allTypes')
        && (c.filter.types ?? []).length + (c.filter.allTypes ?? []).length + (c.filter.subtypes ?? []).length > 0
        && [...(c.filter.types ?? []), ...(c.filter.allTypes ?? [])].every((t) => PERMANENT_KIND_TYPES.has(t.toLowerCase()))
        && (c.filter.subtypes ?? []).every((t) => !SPELL_SUBTYPES.has(t.toLowerCase()));
      const spellSelf = c.object.ref !== 'self' && kindOnly && (st.ctx.selfTypes ?? []).length > 0 && st.ctx.selfTypes!.every((t) => ['instant', 'sorcery'].includes(t.toLowerCase()));
      const savedNotSelf = st.notAntecedent;
      if (spellSelf && savedNotSelf === undefined) st.notAntecedent = 'self';
      // edh-c-67 (CR 110.4, 304.4, 307.4; Searing Barb): "If it's a creature": an instant or sorcery spell is never a creature or any other permanent, so it is no candidate of "it" there
      // (the parser's rule, parser/lower/anaphora.ts, the same one as for "sacrifice it"); only a test of permanent types and nothing else
      const permTypes = new Set(['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker']);
      const permTest = Object.keys(c.filter).length === 1 && c.filter.types !== undefined && c.filter.types.length > 0 && c.filter.types.every((x) => permTypes.has(x));
      const savedPerm = st.permanentOnly;
      if (permTest) st.permanentOnly = true;
      let o: ReturnType<typeof K.obj>;
      try {
        o = K.obj(c.object, st, 'subject');
      } finally {
        if (savedNotSelf === undefined) delete st.notAntecedent;
        else st.notAntecedent = savedNotSelf;
        if (savedPerm === undefined) delete st.permanentOnly;
        else st.permanentOnly = savedPerm;
      }
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
      // edh-next-107 (CR 608.2c; parser/holes/cond.ts#matches; Nature's Chosen; family cond-status-and-color): "enchanted creature is white and untapped": a status and a color of one object are said
      // with one verb and in either order
      const copula = o.plural ? 'are' : 'is';
      const statusColor = preds.length === 2 && Object.keys(c.filter).length === 2 && c.filter.tapped !== undefined && c.filter.colors !== undefined && preds.every((x) => x.startsWith(`${copula} `))
        ? [`${o.text} ${copula} ${preds[0]!.slice(copula.length + 1)} and ${preds[1]!.slice(copula.length + 1)}`, `${o.text} ${copula} ${preds[1]!.slice(copula.length + 1)} and ${preds[0]!.slice(copula.length + 1)}`] : null;
      const plainAll = `${o.text} ${preds.join(' and ')}`;
      const plain0 = np === null ? (statusColor === null ? plainAll : alt(plainAll, ...statusColor)) : alt(plainAll, np);
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
      // edh-next-31 (CR 500.7; Medomai the Ageless): an extra turn of any player, no step
      if (c.extra === true) {
        if (c.whose !== 'any' || c.step !== undefined) throw new NoRenderer('an extra turn of one player or step');
        return "it's an extra turn";
      }
      const t = turnOf(c.whose, st);
      if (c.step === undefined) return alt(`it's ${t}`, `it is ${t}`);
      if (isYourMainPhase(c)) return alt("it's your main phase", 'it is your main phase'); // FAST5X E9 (CR 505.1)
      if (isYourCombatPhase(c)) return alt("it's your combat phase", 'it is your combat phase'); // r4-fxb (CR 506.1)
      if (c.whose === 'any' && ['beginCombat', 'declareAttackers', 'declareBlockers', 'combatDamage', 'endCombat'].every((x) => [c.step].flat().includes(x as never)) && [c.step].flat().length === 5) return alt("it's a combat phase", 'it is a combat phase'); // trek-18 (CR 506.1)
      const steps = [c.step].flat();
      const names = steps.map((s) => possessiveStep(s, c.whose, st));
      return alt(`it's ${joinList(names, 'or')}`, `it is ${joinList(names, 'or')}`, `it's ${joinList(steps.map((s) => STEP_NAME[s]), 'or')} on ${t}`);
    }
    case 'wasCast': return wasCastPhrase(c, st);
    case 'happened': return happenedPhrase(c, st);
    case 'did': {
      if (c.which !== undefined && c.to === 'hand' && c.which.zone === 'battlefield') return returnedThisWayPhrase(c.which, c.not === true, st); // STD-OTJ
      if (c.which !== undefined && c.to === 'hand') return putThisWayPhrase(c.which, c.not === true, st); // FAST5 T75
      // edh-perms-5 (CR 700.4, 701.8a; Saw in Half): the destroy of one announced target put it into a graveyard: "if that creature dies this way" (the same `did`)
      const dr = c.which !== undefined && c.to === 'graveyard' && c.not !== true ? st.info.get(`r:${c.step}`)?.diesRef : undefined;
      const dies = dr !== undefined ? ((): string => { const who = K.obj(dr, cloneState(st), 'subject').text; return alt(`${who} dies this way`, `${who} is put into a graveyard this way`) /* edh-d-51 (CR 700.4; Tuktuk Scrapper): a permanent that is not a creature is "put into a graveyard" */; })() : null;
      let moved: string | null = null;
      try {
        moved = c.which !== undefined ? movedCondPhrase(c, st) : null; // Cloud C7: "if a creature card was exiled this way" (CR 608.2c, 608.2h)
      } catch (e) {
        if (dies === null || !(e instanceof NoRenderer)) throw e;
      }
      if (moved !== null) return dies !== null ? alt(moved, dies) : moved;
      if (dies !== null) return dies;
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
      // edh-next-129 (CR 608.2d; Territorial Hellkite): after a random choice of an opponent that may find none, "if you can't choose an opponent this way"
      if (c.not === true && st.info.get(`r:${c.step}`)?.thisWay === 'opponent chosen this way') return "you can't choose an opponent this way";
      const casted = c.not === true && st.info.get(`r:${c.step}`)?.thisWay === 'cast this way';
      const castedYes = c.not !== true && st.info.get(`r:${c.step}`)?.castTarget === true; // edh-d-59 (Helmut Zemo): after the optional cast of a target card, "if you cast a spell this way"
      // std-rx3 (CR 608.2c, 121.1; family drew-one-or-more-this-way): naming a draw (render/steps-cards.ts#draw records it), "if you draw one or more cards this way"
      const drewAny = c.not !== true && st.info.get(`r:${c.step}`)?.thisWay === 'drawn this way';
      // edh-perms-6 (CR 111.1, 707.9, 608.2c; family didnt-create-token-this-way): after a token creation or token copy (render/steps.ts#clause records it), "if you didn't create a token this way"
      const made = c.not === true && st.info.get(`r:${c.step}`)?.tokenMade === true;
      const exchanged = c.not === true && st.info.get(`r:${c.step}`)?.exchanged === true; // edh-top-9
      const revealed = c.not === true && st.info.get(`r:${c.step}`)?.revealMade === true; // edh-next-142 (CR 701.20a; Omnath, Locus of All; family didnt-reveal-it)
      if (you) return c.not ? alt("you don't", 'you did not', "you can't", ...(drew ? ["you don't draw a card this way", "you don't draw cards this way", "you didn't draw cards this way", "you did not draw cards this way", "you do not draw cards this way", "you didn't draw a card this way", "you did not draw a card this way", "you do not draw a card this way"] : []), ...(casted ? ["you don't cast that card this way", "you don't cast it", "you don't cast it this way", "you didn't cast it", "you didn't cast it this way"] : []), ...(exchanged ? ["you don't or can't make an exchange"] : []), ...(revealed ? ["you don't reveal it", "you don't reveal that card", "you didn't reveal it"] : []), ...(made ? ["you didn't create a token this way", "you did not create a token this way", "you don't create a token this way", "you do not create a token this way"] : [])) : alt('you do', 'you did', 'you pay', ...(drewAny ? ['you draw one or more cards this way'] : []), ...(castedYes ? ['you cast a spell this way', 'you cast it this way', 'you cast that card this way'] : []));
      return c.not ? alt("that player doesn't", "the player doesn't", "they don't", "that player can't", "the player can't", "they can't") : alt('that player does', 'the player does', 'they do'); // edh-next-108: "If they can't" (Invoke Despair) // edh-c-103: "If the player can't, sacrifice ~." (Woebringer Demon; the parser reads it after a sacrifice)
    }
    case 'designation': return designationPhrase(c, st);
    case 'otherOpponentNotAttacked': { // edh-next-53 (CR 506.2, 508.1b; parser/holes/cond.ts, Suppressor Skyguard)
      if (c.of.ref !== 'event') throw new NoRenderer('"has another opponent who isn\'t being attacked" of a player other than the attacking player of the event');
      return `${K.player(c.of, st, 'subject').text} has another opponent who isn't being attacked`;
    }
    case 'attackedYouLastTurn': return c.who === undefined ? 'a player attacked you during their last turn' /* edh-d-45 (CR 506.1, 508.1; Avenge) */ : `${K.player(c.who, st, 'subject').text} attacked you during their last turn`; // edh-d-85 (O-Kagachi, Vengeful Kami)
    case 'eventDied': return 'it died'; // edh-next-97 (CR 700.4; Taeko): negated, "it didn't die" (the `not` case below)
    case 'eventCrewers': { // edh-d-89 (CR 702.122e; Mighty Servant of Leuk-o): only after "whenever ~ becomes crewed", whose event carries the crewers (review: never another trigger)
      const t = st.trigger ?? [];
      if (t.length === 0 || !t.every((e) => e.ev === 'becomes' && e.what === 'crewed')) throw new NoRenderer('"it was crewed by exactly N creatures" outside a "becomes crewed" trigger');
      return `it was crewed by exactly ${numWord(c.count)} ${c.count === 1 ? 'creature' : 'creatures'}`;
    }
    case 'playerIs': return playerIsPhrase(c, st); // edh-players-18
    case 'completedDungeon': return completedPhrase(c, st, false); // MX4, CR 309.7
    case 'chosen': return c.link === 'tribute' && (c.equals === 'unpaid' || c.equals === 'paid') ? `tribute ${c.equals === 'paid' ? 'was' : "wasn't"} paid` : `the chosen ${c.link} is ${c.equals}`; // edh-c-37 (CR 702.104b): the tribute link of the keyword
    case 'ask': return c.text;
    // M6-0 (m6 design 2.1): CR 716.2a, the level of a Class; CR 702.37b, the megamorph flag of the event a `during` body replaces
    case 'classLevel': return `${K.obj(c.object, st, 'subject').text} is level ${c.atLeast} or greater`; // one wording: a second one needs a reviewed family (render/equivalence.ts)
    case 'eventFlag': return 'its megamorph cost was paid';
    // FAST5X E11 (CR 701.4b): "a Dragon was beheld" (the quality: a type, subtype or supertype, render/costs.ts prints the same noun for the cost)
    case 'beheld': return `${K.np(c.quality, st, { det: 'a', noZone: true })} was beheld`;
    case 'asCast': return asCastPhrase(c.held, st); // FAST5X E17 (CR 601.2i)
    case 'firstNamedResolution': return "this is the first time a spell you control with this spell's name has resolved this game"; // FAST5X E26 (CR 702.192a)
    case 'firstSpellCast': return `${K.obj({ ref: 'self' }, st, 'subject').text} is the first spell you've cast this game`; // trek-2 (CR 601.2i)
    case 'firstCombat': return c.yourTurn === true ? "it's the first combat phase of your turn" : "it's the first combat phase of the turn"; // Standard round 4, r4-trig (CR 500.8, 505.1a)
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
    case 'putBySource': return `${K.obj(c.object, st, 'subject').text} was put onto the battlefield with this ability`; // edh-perms-9 (CR 608.2)
    case 'controlledSinceTurnStart': return `you've controlled ${c.object.ref === 'self' ? '~' : 'it'} continuously since the beginning of your most recent turn`; // edh-c-110 (CR 302.6)
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
 * pc-keywords-mana-1 (CR 608.2c; parser/holes/cond.ts#control): "you control an Urza's Power-Plant and an Urza's Tower" is the `all` of two existences of permanents
 * you control, each of one description (no count). Null for anything else.
 */
function controlBothPhrase(of: readonly Condition[], st: RenderState, word: 'and' | 'or' = 'and'): string | null {
  // edh-next-140 (CR 608.2c; parser/holes/cond.ts#control, Altar of the Pantheon): or three to five descriptions after "or": "you control a God, a Demigod, or a legendary enchantment"
  if (word === 'or' && of.length >= 3 && of.length <= 5) {
    const parts: string[] = [];
    for (const x of of) {
      if (x.cond !== 'exists' || x.atLeast !== undefined || x.of.ref !== 'each') return null;
      const f = x.of.filter;
      if (f.controller !== 'you' || (f.zone !== undefined && f.zone !== 'battlefield')) return null;
      parts.push(K.np(f, st, { det: 'a', noController: true }));
    }
    return `you control ${parts.slice(0, -1).join(', ')}, or ${parts[parts.length - 1]}`;
  }
  if (of.length !== 2) return null;
  const parts: string[] = [];
  for (const x of of) {
    if (x.cond !== 'exists' || x.atLeast !== undefined || x.of.ref !== 'each') return null;
    const f = x.of.filter;
    if (f.controller !== 'you' || (f.zone !== undefined && f.zone !== 'battlefield')) return null;
    parts.push(K.np(f, st, { det: 'a', noController: true }));
  }
  return `you control ${parts[0]} ${word} ${parts[1]}`;
}

/**
 * edh-c-8 (CR 201.2, 608.2c; parser/holes/cond.ts#control): "you control artifacts named Crown of Empires and Throne of Empires" is the `all` of two existences of permanents you control
 * that differ only in their name. Null for anything else.
 */
function controlNamedPairPhrase(of: readonly Condition[], st: RenderState): string | null {
  if (of.length !== 2) return null;
  const rest: string[] = [];
  const names: string[] = [];
  let base: ObjectFilter | undefined;
  for (const x of of) {
    if (x.cond !== 'exists' || x.atLeast !== undefined || x.of.ref !== 'each') return null;
    const { name, ...r } = x.of.filter;
    if (name === undefined || r.controller !== 'you' || (r.zone !== undefined && r.zone !== 'battlefield')) return null;
    names.push(name);
    rest.push(JSON.stringify(r));
    base = r;
  }
  if (rest[0] !== rest[1] || base === undefined) return null;
  return `you control ${K.np(base, st, { det: 'none', plural: true, noController: true })} named ${names[0]} and ${names[1]}`;
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
  // edh-c-103 (CR 608.2c; Vengeful Rebirth): the move to the hand is also worded as a return, "you return a nonland card to your hand this way" (family returned-to-hand-this-way)
  return not ? `you ${alt("didn't", "don't")} put ${np} into your hand this way` : alt(`you put ${np} into your hand this way`, `you return ${np} to your hand this way`);
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
  for (const which of ['power', 'toughness'] as const) { // edh-b-2: Abzan Beastmaster says it with toughness
    const stat = (q: unknown, of: string): boolean => typeof q === 'object' && q !== null && sortedJson(q) === sortedJson({ q: 'stat', stat: which, of: JSON.parse(of), agg: 'max' });
    if (stat(cmp.left, YOUR_CREATURES_JSON) && stat(cmp.right, ALL_CREATURES_JSON)) return `you control the creature with the greatest ${which} or tied for the greatest ${which}`;
  }
  return null;
}

/** FAST5X E17 (CR 601.2i; parser/holes/cond.ts): "you controlled a Mount as you cast ~". Only that form: you controlled an object of a kind. */
/**
 * edh-next-37 (CR 601.2b, 601.2i, 118.8; parser/holes/cond.ts, Draconic Roar; family revealed-or-controlled-as-cast): `any` of the optional additional cost paid and a creature kind you controlled as
 * you cast it is "you revealed a Dragon card or controlled a Dragon as you cast ~" (the cost the card's first sentence names is that reveal). Null for any other shape.
 */
function revealedOrControlledPhrase(of: readonly Condition[], st: RenderState): string | null {
  const [a, b] = of;
  if (of.length !== 2 || a?.cond !== 'wasCast' || JSON.stringify(a) !== '{"cond":"wasCast","kicked":"additional"}' || b?.cond !== 'asCast') return null;
  const held = b.held;
  if (held.cond !== 'exists' || held.atLeast !== undefined || held.of.ref !== 'each') return null;
  const { controller, ...rest } = held.of.filter;
  if (controller !== 'you' || Object.keys(rest).length !== 1 || rest.subtypes?.length !== 1) return null;
  return `you revealed ${K.np(rest, cloneState(st), { det: 'a' })} card or controlled ${K.np(rest, st, { det: 'a' })} as you cast ${K.obj({ ref: 'self' }, st, 'object').text}`;
}

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
    // edh-next-98 (Syrix, Carrier of the Flame): a creature card you own that left a graveyard
    if (ev.from === 'graveyard' && ev.to === undefined && keys(s) === 'isCard,owner,types' && s['isCard'] === true && s['owner'] === 'you' && JSON.stringify(s['types']) === '["Creature"]' && n === null) {
      return 'a creature card left your graveyard this turn';
    }
    // edh-next-98 (Dimir Strandcatcher): cards you own put into your graveyard from anywhere but the battlefield
    if (ev.to === 'graveyard' && n !== null && Array.isArray(ev.from) && ev.from.length === 5 && ['hand', 'library', 'stack', 'exile', 'command'].every((z) => (ev.from as string[]).includes(z)) && keys(s) === 'isCard,owner' && s['isCard'] === true && s['owner'] === 'you') {
      return `${n} cards were put into your graveyard from anywhere other than the battlefield this turn`;
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
  // edh-next-47 (CR 701.9a; Tinybones, Trinket Thief): "an opponent discarded a card this turn"
  if (ev.ev === 'action' && ev.verb === 'discard' && ev.actor === 'opponent' && keys(ev) === 'actor,ev,verb' && n === null) return 'an opponent discarded a card this turn';
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
  // edh-d-98 (CR 702.29a, 201.2; parser/holes/cond.ts#history; Yidaro, Wandering Monster): "you've cycled a card named <name> four or more times this game"
  {
    const ev = c.event;
    if (ev.ev === 'action' && ev.verb === 'cycle' && ev.actor === 'you' && c.scope === 'game' && c.by === undefined && c.times?.op === '>=' && typeof c.times.value === 'number' && c.times.value >= 2
      && Object.keys(ev).length === 4 && ev.object !== undefined && typeof ev.object.name === 'string' && Object.keys(ev.object).length === 1) {
      return `you've cycled a card named ${ev.object.name} ${numWord(c.times.value)} or more times this game`;
    }
  }
  // edh-d-87 (CR 702.122c, 603.4; parser/holes/edhd87.ts; Adrestia): "an Assassin crewed it this turn": a creature of that description was tapped this turn to pay a crew cost of the Vehicle
  if (c.event.ev === 'becomes' && c.event.what === 'crewCostPaid' && c.event.by !== undefined && c.scope === 'turn' && c.by === undefined && c.times === undefined
    && Object.keys(c.event.object).length === 1 && c.event.object.is !== undefined && Object.keys(c.event).every((k) => k === 'ev' || k === 'what' || k === 'object' || k === 'by')) {
    return `${K.np(c.event.by, st, { det: 'a', noZone: true })} crewed ${K.obj(c.event.object.is, st, 'object').text} this turn`;
  }
  // r4-fxb (CR 500.9, 513.1; parser/holes/cond.ts): "it's the first end step of the turn": exactly one end step has begun this turn
  if (c.event.ev === 'step' && c.event.step === 'end' && c.event.whose === undefined && c.event.nth === undefined && c.scope === 'turn' && c.by === undefined
    && c.times?.op === '==' && c.times.value === 1) return alt("it's the first end step of the turn", 'it is the first end step of the turn');
  const scope = scopeWords(c.scope);
  const ev = c.event;
  const t = c.times;
  // edh-next-31 (CR 700.4, 109.2; Chain Assassination): "if another creature died this turn" in a spell, a creature other than the one target the ability named
  // (lower/anaphora.ts#happenedOtherIsTarget): said as the "another" of a permanent's ability
  if (t === undefined && c.by === undefined && c.scope === 'turn' && ev.ev === 'zoneChange' && ev.from === 'battlefield' && ev.to === 'graveyard' && Object.keys(ev).length === 4
    && ev.subject?.not?.is?.ref === 'target' && Object.keys(ev.subject.not).length === 1 && Object.keys(ev.subject.not.is).length === 2) {
    const { not: _n, ...rest } = ev.subject;
    return `${K.np({ ...rest, other: true }, st, { det: 'a', noZone: true })} died this turn`;
  }
  // edh-next-59 (CR 700.4, 404.1; parser/holes/cond.ts#history; Kami of Transience): "an enchantment was put into your graveyard from the battlefield this turn"
  if (t === undefined && c.by === undefined && c.scope === 'turn' && ev.ev === 'zoneChange' && ev.from === 'battlefield' && ev.to === 'graveyard' && Object.keys(ev).length === 4
    && ev.subject?.owner === 'you' && ev.subject.controller === undefined) {
    const { owner: _o, ...rest } = ev.subject;
    return `${K.np(rest, st, { det: 'a', noZone: true })} was put into your graveyard from the battlefield this turn`;
  }
  // edh-next-104 (CR 120.1, 603.4; parser/holes/cond.ts#history; Wolverine, Best There Is): "if ~ dealt damage to another creature this turn"
  if (!t && c.by === undefined && c.scope === 'turn' && ev.ev === 'damage' && JSON.stringify(ev.source) === '{"self":true}' && Object.keys(ev).length === 3
    && JSON.stringify(ev.recipient) === '{"object":{"types":["Creature"],"other":true}}') return `${K.obj({ ref: 'self' }, st, 'subject').text} dealt damage to another creature this turn`;
  // FAST5X E25 (CR 708.8; parser/holes/cond.ts#history): "you turned a permanent face up this turn"  // FAST5X E25 (CR 708.8; parser/holes/cond.ts#history): "you turned a permanent face up this turn": a permanent turned face up by you
  if (!t && c.by === 'you' && ev.ev === 'becomes' && ev.what === 'turnedFaceUp' && JSON.stringify(ev) === JSON.stringify({ ev: 'becomes', what: 'turnedFaceUp', object: {} })) {
    return alt(`you turned a permanent face up ${scope}`, `you've turned a permanent face up ${scope}`);
  }
  // edh-top-10 (CR 701.54c-d; Frodo, Adventurous Hobbit): "the Ring has tempted you two or more times this game" (parser/holes/cond.ts#ringTemptedTimes)
  if (ev.ev === 'action' && ev.verb === 'ringTempts' && ev.actor === 'you' && ev.object === undefined && c.scope === 'game' && c.by === undefined && t?.op === '>=' && typeof t.value === 'number' && t.value >= 1) {
    return `the Ring has tempted you ${K.qty(t.value, st)} or more times this game`;
  }
  // edh-next-58 (CR 701.6a, 608.2b, 603.4; parser/holes/edhn58.ts; Summoning Trap): "a creature spell you cast this turn was countered by a spell or ability an opponent controlled"
  if (!t && c.by === undefined && c.scope === 'turn' && ev.ev === 'action' && ev.verb === 'counter' && ev.actor === 'opponent' && Object.keys(ev).length === 4 && JSON.stringify(ev.object) === '{"types":["Creature"],"controller":"you"}') {
    return 'a creature spell you cast this turn was countered by a spell or ability an opponent controlled';
  }
  // edh-c-85 (CR 701.8a, 109.5, 603.4; parser/holes/cond.ts#history; Cobra Trap): "a noncreature permanent under your control was destroyed this turn by a spell or ability an
  // opponent controlled": a permanent of the description (yours, or any) destroyed this turn by an instruction of a spell or ability an opponent controlled
  if (!t && c.by === undefined && ev.ev === 'action' && ev.verb === 'destroy' && ev.by === 'opponent' && ev.object !== undefined && ev.actor === undefined
    && (ev.object.controller === undefined || ev.object.controller === 'you') && Object.keys(ev).length === 4) {
    const { controller: ctl, ...rest } = ev.object;
    const what = K.np(rest, st, { det: 'a' });
    return alt(`${what}${ctl === 'you' ? ' under your control' : ''} was destroyed ${scope} by a spell or ability an opponent controlled`,
      `${what}${ctl === 'you' ? ' you control' : ''} was destroyed ${scope} by a spell or ability an opponent controlled`);
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
    const kind0 = ev.spell ? K.np({ ...ev.spell, stackKind: 'spell' }, st, { det: 'none', plural: true }) : 'spells';
    // edh-zones-27 (CR 601.2i, 205.2a; Urabrask // The Great Work, family cast-count-and-or-types): the spells cast of either of two card types are also "instant and/or sorcery spells" (each one is of one of the types)
    const kind = ev.spell?.types?.length === 2 && Object.keys(ev.spell).length === 1 && t !== undefined && t.op === '>=' ? alt(kind0, `${ev.spell.types.map((x) => x.toLowerCase()).join(' and/or ')} spells`) : kind0;
    if (t) {
      const n = K.qty(t.value, st);
      const count = t.op === '>=' ? `${n} or more` : t.op === '==' ? n : cmpWords(t.op, n);
      const counted = subject === '' ? `${count} ${kind} were cast ${scope}` : `${subject} cast ${count} ${kind} ${scope}`;
      // FAST5 T62 (CR 601.2i): at least one is "a creature spell" (parser/holes/cond.ts#history reads "you've cast a creature spell this turn" as at least one)
      if (t.op === '>=' && t.value === 1) {
        const a = ev.spell ? K.np({ ...ev.spell, stackKind: 'spell' }, st, { det: 'a' }) : 'a spell';
        // p2-cost-statics-1 (CR 601.2i; family has-cast-or-cast): another player's "has cast a blue spell this turn" is also "cast a blue spell this turn" (Ricochet Trap)
        const bare = subject.endsWith(' has') ? [`${subject.slice(0, -' has'.length)} cast ${a} ${scope}`] : [];
        // edh-c-93 (CR 601.2i, 109.2; Soul Reap): a spell of a kind other than this object is "another black spell" (the singular of "1 or more other black spells")
        const another = ev.spell?.other === true && subject !== '' ? [`${subject} cast ${K.np({ ...ev.spell, other: undefined, stackKind: 'spell' } as never, st, { det: 'a' }).replace(/^an? /, 'another ')} ${scope}`] : [];
        return alt(counted, subject === '' ? `${a} was cast ${scope}` : `${subject} cast ${a} ${scope}`, ...bare, ...another);
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
  // edh-next-51 (CR 701.21a, 118.3; Briarbridge Patrol): "you sacrificed three or more Clues this turn", the counted form of the above
  if (t !== undefined && t.op === '>=' && typeof t.value === 'number' && t.value >= 2 && c.by === undefined && ev.ev === 'action' && ev.verb === 'sacrifice' && ev.actor === 'you' && ev.object !== undefined && Object.keys(ev).length === 4) {
    const what = K.np(ev.object, st, { det: 'none', plural: true });
    return alt(`you've sacrificed ${numWord(t.value)} or more ${what} ${scope}`, `you sacrificed ${numWord(t.value)} or more ${what} ${scope}`);
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
  // edh-c-16 (CR 122.6, 122.6a; parser/holes/cond.ts#history; Sigardian Paladin): "you've put one or more +1/+1 counters on a creature this turn": counters of that kind that you put on any object
  // of the description (the putter recorded in the history)
  if (!t && c.by === undefined && ev.ev === 'counters' && ev.change === 'put' && ev.by === 'you' && ev.kind !== undefined && ev.atLeast === undefined && ev.byEffect === undefined
    && !('player' in ev.on) && ev.on.self === undefined && ev.on.controller === undefined && ev.on.owner === undefined && Object.keys(ev).length === 5) {
    const on = K.np(ev.on, st, { det: 'a' });
    return alt(`you've put one or more ${ev.kind} counters on ${on} ${scope}`, `you put one or more ${ev.kind} counters on ${on} ${scope}`);
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
    return alt(`${past} ${scope}`, `you've ${verb} life ${scope}`, `you have ${verb} life ${scope}`, ...(ev.change === 'loss' ? [] : [`your team gained life ${scope}`])); // edh-c-17: your team is you (family team-gained-life)
  }
  // edh-d-4 (CR 102.2, 119.3; Ludevic, Necro-Alchemist; family player-other-than-you-lost-life): an opponent who lost life is also "a player other than you" (no team is played)
  if (!t && ev.ev === 'life' && ev.player === 'opponent' && ev.change === 'loss' && ev.amount === undefined && Object.keys(ev).length === 3) return alt(`${past} ${scope}`, `a player other than you lost life ${scope}`);
  // FAST5X E20 (CR 700.13): "you've committed a crime this turn", the present perfect Oracle prints (parser/holes/cond.ts#history reads both)
  if (!t && ev.ev === 'action' && ev.verb === 'commitCrime' && ev.actor === 'you' && Object.keys(ev).length === 3) return alt(`${past} ${scope}`, `you've committed a crime ${scope}`);
  // Standard round 3, r3-trig (CR 606.3): "you've activated a loyalty ability this turn", the present perfect Oracle prints (parser/holes/cond.ts#history reads both)
  if (!t && ev.ev === 'activate' && ev.player === 'you' && ev.ability === 'loyalty' && Object.keys(ev).length === 3) return alt(`${past} ${scope}`, `you've activated a loyalty ability ${scope}`);
  // edh-players-6 (CR 508.1, 611.3a; family it-attacked-this-turn): "~ has indestructible as long as it attacked this turn": the object itself attacked this turn, named by "it" when the
  // effect comes first (parser/holes/cond.ts#history)
  if (!t && ev.ev === 'attacks' && Object.keys(ev).length === 2 && ev.attacker?.self === true && Object.keys(ev.attacker).length === 1 && c.scope === 'turn') return alt(`${past} ${scope}`, `it attacked ${scope}`);
  // FAST2 T8: "you attacked this turn" (raid): a creature you controlled attacked (the parser's reading, parser/holes/cond.ts#history)
  if (!t && ev.ev === 'attacks' && Object.keys(ev).length === 2 && ev.attacker !== undefined && Object.keys(ev.attacker).length === 1 && ev.attacker.controller === 'you') return alt(`${past} ${scope}`, `you attacked ${scope}`);
  if (t) return `${past} ${cmpWords(t.op, K.qty(t.value, st))} ${t.op === '==' && typeof t.value === 'number' && t.value === 1 ? 'time' : 'times'} ${scope}`;
  // edh-next-146 (CR 508.1, 603.4; Ramses, Assassin Lord; parser/holes/cond.ts#history; family attacked-by-passive): "they were attacked this turn by an Assassin you controlled", the
  // passive Oracle prints for a player attacked by a creature you controlled of a description (the same history as "an Assassin you control attacked them this turn")
  const passive = attackedByPassive(c, st);
  return passive === null ? p2iv3Moved(c, `${past} ${scope}`) : alt(p2iv3Moved(c, `${past} ${scope}`), passive); // p2-intervening-3 (CR 400.3; render/p2iv3.ts)
}

/** edh-next-146: "<player> were/was attacked this turn by a <creature description> you controlled" (one player, a described creature you controlled, this turn); null otherwise. */
function attackedByPassive(c: Extract<Condition, { cond: 'happened' }>, st: RenderState): string | null {
  const ev = c.event;
  if (ev.ev !== 'attacks' || c.scope !== 'turn' || c.times !== undefined || c.by !== undefined || ev.attacker === undefined || ev.defender === undefined || typeof ev.defender !== 'object') return null;
  if (Object.keys(ev).some((k) => k !== 'ev' && k !== 'attacker' && k !== 'defender') || Object.keys(c).some((k) => k !== 'cond' && k !== 'event' && k !== 'scope')) return null;
  const { controller, ...rest } = ev.attacker;
  if (controller !== 'you' || Object.keys(rest).length === 0) return null;
  const who = K.player(ev.defender, st, 'subject');
  const by = `attacked this turn by ${K.np(rest, st, { det: 'a' })} you controlled`;
  // one player is "that player was attacked" or, when the pronoun names it alone (the Phrase's `they`), "they were attacked"; a plural reference is "they were" / "those players were"
  if (who.person === 'pl') return `${who.text} were ${by}`;
  return who.they === true ? alt(`${who.text} was ${by}`, `they were ${by}`) : `${who.text} was ${by}`;
}

/**
 * r4-cost (CR 120.1, 510.2; parser/holes/cost-conds.ts): damage dealt to an opponent this turn, in the passive Oracle prints: "an opponent has been dealt noncombat
 * damage this turn" (beside FAST5X E9's "was dealt"), "an opponent was dealt combat damage by a legendary creature this turn" (the source as it dealt it). Only one
 * event to "an opponent", noncombat with no source or combat with a described source; null for anything else.
 */
function damageHistoryPhrase(c: Extract<Condition, { cond: 'happened' }>, st: RenderState): string | null {
  const ev = c.event;
  // edh-c-7 (Skarrgan Firebird): damage of any kind to an opponent, no source
  if (ev.ev === 'damage' && c.times === undefined && c.by === undefined && ev.amount === undefined && ev.combat === undefined && ev.source === undefined && ev.recipient?.player === 'opponent' && Object.keys(ev).length === 2 && Object.keys(ev.recipient).length === 1) {
    return alt(`an opponent was dealt damage ${scopeWords(c.scope)}`, `an opponent has been dealt damage ${scopeWords(c.scope)}`);
  }
  // edh-next-110 (CR 120.10, 603.4; parser/holes/edhn110.ts; Rith, Liberated Primeval): "a creature or planeswalker an opponent controlled was dealt excess damage this turn"
  if (ev.ev === 'damage' && ev.excess === true && c.times === undefined && c.by === undefined && Object.keys(ev).sort().join() === 'ev,excess,recipient' && ev.recipient !== undefined && Object.keys(ev.recipient).join() === 'object'
    && JSON.stringify(ev.recipient.object) === '{"types":["Creature","Planeswalker"],"controller":"opponent"}') return `a creature or planeswalker an opponent controlled was dealt excess damage ${scopeWords(c.scope)}`;
  if (ev.ev !== 'damage' || c.times !== undefined || c.by !== undefined || ev.amount !== undefined || (ev.recipient?.player !== 'opponent' && !(ev.recipient?.player === 'any' && ev.combat === true)) || ev.recipient.object !== undefined) return null; // edh-zones-17: "a player was dealt combat damage by ..."
  if (Object.keys(ev).some((k) => !['ev', 'combat', 'recipient', 'source'].includes(k)) || Object.keys(ev.recipient).length !== 1) return null;
  const scope = scopeWords(c.scope);
  if (ev.recipient.player === 'opponent' && ev.combat === false && ev.source === undefined) return alt(`an opponent was dealt noncombat damage ${scope}`, `an opponent has been dealt noncombat damage ${scope}`);
  if (ev.combat === true && ev.source !== undefined && ev.source.self === undefined && Object.keys(ev.source).length > 0) return `${ev.recipient.player === 'any' ? 'a player' : 'an opponent'} was dealt combat damage by ${K.np(ev.source, st, { det: 'a' })} ${scope}`;
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
  // edh-next-31 (CR 700.4, 603.4; Feast of the Victorious Dead): "one or more creatures died this turn" is the same count with the least number, one
  if (t !== undefined && (t.op !== '>=' || typeof t.value !== 'number' || t.value < 1)) return null;
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
  if (ctl === 'you' && verb === 'entered the battlefield') return alt(`${np(f)} ${verb}${tail}`, `you had ${np(f)} enter the battlefield${tail}`); // edh-c-27: also with a count ("you had two or more creatures enter ...", Park Heights Pegasus)
  // edh-c-9 (CR 603.4, 603.10a; family left-you-controlled; Vrock): "a permanent you controlled left the battlefield this turn" is "a permanent left the battlefield under your control this turn"
  if (t === undefined && ctl === 'you' && verb === 'left the battlefield') return alt(`${np(f)} ${verb}${tail}`, `${np(f)} you controlled ${verb} ${scopeWords(c.scope)}`);
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
function statParityOf(q: Quantity): Quantity | null {
  if (typeof q !== 'object' || q.q !== 'math' || q.op !== '-' || q.args.length !== 2) return null;
  const [n, twice] = q.args;
  if (typeof n !== 'object' || n.q !== 'stat' || (n.stat !== 'power' && n.stat !== 'toughness')) return null;
  if (typeof twice !== 'object' || twice.q !== 'math' || twice.op !== '*' || twice.args.length !== 2 || twice.args[0] !== 2) return null;
  const half = twice.args[1]!;
  if (typeof half !== 'object' || half.q !== 'math' || half.op !== 'floorDiv' || half.args.length !== 2 || half.args[1] !== 2) return null;
  return JSON.stringify(half.args[0]) === JSON.stringify(n) ? n : null;
}

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
  // edh-c-6 (CR 109.4, 608.2c; Unified Will; parser/holes/cond.ts): "you control more creatures than that spell's controller": the same description counted for you and
  // for the controller of an object (the number of one is greater than the number of the other)
  if (left.q === 'count' && typeof right === 'object' && right.q === 'count' && c.op === '>' && left.of.ref === 'each' && right.of.ref === 'each' && left.of.filter.controller === 'you') {
    const rc = right.of.filter.controller;
    if (typeof rc === 'object' && rc.ref === 'controllerOf') {
      const same = JSON.stringify({ ...left.of.filter, controller: undefined }) === JSON.stringify({ ...right.of.filter, controller: undefined });
      if (same) return `you control more ${K.np(left.of.filter, st, { det: 'none', plural: true, noController: true })} than ${K.player(rc, st, 'object').text}`;
    }
    // edh-c-65 (CR 506.2, 508.1c, 509.1c; Goblin Goon): "~ can't attack unless you control more creatures than defending player" / "... than attacking player"
    if (typeof rc === 'object' && (rc.ref === 'defending' || rc.ref === 'active')) {
      const same = JSON.stringify({ ...left.of.filter, controller: undefined }) === JSON.stringify({ ...right.of.filter, controller: undefined });
      if (same) return `you control more ${K.np(left.of.filter, st, { det: 'none', plural: true, noController: true })} than ${rc.ref === 'defending' ? alt('defending player', 'the defending player') : alt('attacking player', 'the attacking player', 'the active player')}`;
    }
  }
  // edh-c-2 (CR 305.6, 205.3i; Path to the Festival): "there are three or more basic land types among lands you control" is domain against a number (parser/holes/cond.ts)
  const dom = left.q === 'math' && c.op === '>=' && num !== null ? domainOf(left) : null;
  if (dom !== null) return `there are ${num} or more basic land types among ${K.np(dom, st, { det: 'none', plural: true })}`;
  // edh-next-144 (CR 205.2a, 608.2h; Baba Lysaga, Night Witch): "there were three or more card types among the sacrificed permanents": the permanents a cost sacrificed, as they last existed (past tense)
  if (left.q === 'distinct' && left.what === 'cardTypes' && left.among.ref === 'costSacrificed' && c.op === '>=' && num !== null) return `there were ${num} or more card types among ${K.obj(left.among, st, 'object').text}`;
  switch (left.q) {
    // std-library-3 (CR 608.2c, 608.2h; parser/holes/moved.ts): "you exiled four or more cards this way" (render/moved.ts#movedAtLeastPhrase)
    case 'resultCount': {
      if (c.op !== '>=' || typeof right !== 'number' || right < 2) return null;
      // trek-14 (CR 608.2c, 121.1; Sarek, Federation Ambassador): after a draw of yours (render/steps-cards.ts#draw marks its binding), "you draw three or more cards this way"
      if (left.which === undefined && st.info.get(`r:${left.step}`)?.thisWay === 'drawn this way') return `you draw ${numWord(right)} or more cards this way`;
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
      // edh-next-19 (parser/holes/cond.ts#statParity): "~'s power is even", "~'s power is odd"
      const sp = statParityOf(left);
      if (sp !== null && (right === 0 || right === 1) && (c.op === '==' || c.op === '!=')) return `${K.qty(sp, st)} is ${(right === 1) !== (c.op === '!=') ? 'odd' : 'even'}`;
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
      if (left.to === undefined) return alt('excess damage was dealt this way', 'excess damage is dealt this way', 'excess damage was dealt to a permanent this way', 'excess damage is dealt to a permanent this way'); // edh-perms-9 (Bottle-Cap Blast)
      const to = excessRecipient(left.to, st);
      return alt(`excess damage was dealt to ${to} this way`, `excess damage is dealt to ${to} this way`, `${to} is dealt excess damage this way`, `${to} was dealt excess damage this way`);
    }
    // cloud std-spm (CR 119.3, 608.2c): "if you lost life this way" (the life one player lost in the instruction before)
    case 'lifeLost': {
      if (c.op === '==' && right === 0 && left.who === undefined) return 'no life is lost this way'; // edh-d-78 (Blitzwing, Cruel Tormentor): nobody lost life in the instruction before
      if (c.op !== '>' || right !== 0 || left.who === undefined) return null;
      return `${K.player(left.who, st, 'subject').text} lost life this way`;
    }
    case 'snowSpent': {
      // edh-next-35 (CR 106.4, 601.2h; Berg Strider; parser/holes/cond.ts): "{S} was spent to cast this spell", at least that many snow mana for the spell itself
      if (c.op !== '>=' || typeof right !== 'number' || right < 1) return null;
      const self = K.obj({ ref: 'self' }, st, 'object').text;
      const symbols = '{s}'.repeat(right);
      return alt(`${symbols} was spent to cast this spell`, `${symbols} was spent to cast ${self}`, `${symbols} was spent to cast it`);
    }
    case 'unspentMana': {
      // FAST5X E19 (CR 106.4): "you have six or more unspent mana"
      if (c.op !== '>=' || num === null || left.type !== undefined) return null;
      return `you have ${num} or more unspent mana`;
    }
    case 'spellManaSpent': {
      // edh-next-139 (CR 602.2b, 106.3; Forsworn Paladin): "mana from a Treasure was spent to activate this ability" (the resolving activated ability's own cost)
      if (left.activation === true) return c.op === '>=' && right === 1 && left.of === undefined && left.from !== undefined ? `mana from ${K.np(left.from, st, { det: 'a' })} was spent to activate this ability` : null;
      // FAST5X E19 (CR 601.2h; opus): "five or more mana was spent to cast that spell", "at least four mana was spent to cast it"
      // FAST5 T51 (CR 601.2h): "the amount of mana spent to cast it was less than its mana value" (a quantity to compare with)
      if (num === null && left.of !== undefined && left.from === undefined && (c.op === '<' || c.op === '>')) {
        return `the amount of mana spent to cast ${spentObjectText(left.of, st)} was ${cmpWords(c.op, K.qty(right, st))}`;
      }
      if (c.op !== '>=' || num === null || left.of === undefined) return null;
      const of = spentObjectText(left.of, st);
      // FAST5X E19 (CR 106.3): "mana from a Treasure was spent to cast it"
      if (left.from !== undefined && right !== 1) {
        // edh-cast-8 (CR 106.3, 205.2a; Inga and Esika): "three or more mana from creatures was spent to cast it" (one card type of the source)
        if (Object.keys(left.from).length !== 1 || left.from.types?.length !== 1) return null;
        const kind = K.np(left.from, st, { det: 'none', plural: true });
        return alt(`${num} or more mana from ${kind} was spent to cast ${of}`, `at least ${num} mana from ${kind} was spent to cast ${of}`);
      }
      if (left.from !== undefined) return `mana from ${K.np(left.from, st, { det: 'a' })} was spent to cast ${of}`;
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
    case 'activatedThisTurn': {
      // edh-c-89 (CR 602.5b; Dragon Whelp): "this ability has been activated four or more times this turn"
      if (c.op !== '>=' || typeof right !== 'number' || right < 2 || right > 10) return null;
      return `this ability has been activated ${numWord(right)} or more times this turn`;
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
        // edh-top-2 (CR 122.1f; Vraska, Betrayal's Sting): "target player has fewer than nine poison counters" (a strict comparison of a count: "fewer")
        if (c.op === '<' && num !== null && typeof right === 'number' && right >= 1) {
          const who = K.player(left.on as PlayerRef, st, 'subject');
          return `${who.text} ${who.person === 'sg' ? 'has' : 'have'} fewer than ${num} poison counters`;
        }
        if (c.op !== '>=' || num === null || typeof right !== 'number' || right < 1) return null;
        const who = K.player(left.on as PlayerRef, st, 'subject');
        const sg = who.person === 'sg';
        const has = `${who.text} ${sg ? 'has' : 'have'} ${num} or more poison counters`;
        return right === 1 ? alt(has, `${who.text} ${sg ? 'is' : 'are'} poisoned`) : has;
      }
      // edh-next-23 (CR 122.1; Nightkin Ambusher): "defending player has a rad counter" (parser/holes/cond.ts): a player with at least one rad counter
      if (left.kind === 'rad' && c.op === '>=' && right === 1 && isPlayerRef(left.on, st)) {
        const who = K.player(left.on as PlayerRef, st, 'subject');
        return `${who.text} ${who.person === 'sg' ? 'has' : 'have'} 1 rad counter`;
      }
      // edh-top-10 (CR 122.1, 122.1i; Vexing Radgull): "they don't have any rad counters" (parser/holes/cond.ts#playerNoKindCounters): a player with no counters of one kind
      if (c.op === '==' && right === 0 && left.kind !== 'any' && left.kind !== 'poison' && isPlayerRef(left.on, st)) {
        const who = K.player(left.on as PlayerRef, st, 'subject');
        const sg = who.person === 'sg';
        return alt(...[`${who.text} ${sg ? "doesn't" : "don't"} have any ${left.kind} counters`, `${who.text} ${sg ? 'has' : 'have'} no ${left.kind} counters`, ...(who.they === true ? [`they don't have any ${left.kind} counters`] : [])]);
      }
      // FAST4 T24: "~ has a counter on it" (CR 122.1): one or more counters of any kind on the object itself
      if (c.op === '>=' && right === 1 && left.kind === 'any' && typeof left.on === 'object' && (left.on as { ref?: string }).ref === 'self') {
        return `${K.obj({ ref: 'self' }, st, 'subject').text} has a counter on it`;
      }
      // edh-replace-1 (CR 122.1; Twenty-Toed Toad): "there are twenty or more counters on it": counters of any kind on one object (parser/holes/cond.ts#thereAre)
      if (c.op === '>=' && num !== null && left.kind === 'any' && typeof left.on === 'object' && 'ref' in left.on && left.on.ref !== 'each') {
        return `there are ${num} or more counters on ${K.obj(left.on as ObjRef, st, 'object').text}`;
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
      // edh-c-56 (CR 122.1, 604.1; Homarid): "there is exactly one tide counter on ~", "there are exactly three tide counters on ~": the counters of one kind on the object itself, exactly that many
      if (c.op === '==' && num !== null && right !== 0 && left.kind !== 'any' && typeof left.on === 'object' && (left.on as { ref?: string }).ref === 'self') {
        return `there ${right === 1 ? 'is' : 'are'} exactly ${num} ${left.kind} ${right === 1 ? 'counter' : 'counters'} on ${K.obj({ ref: 'self' }, st, 'object').text}`;
      }
      // M6-4: "there are two or more ki counters on ~" (the Kamigawa flip cards; CR 122.1): the counters of one kind on the object itself
      if (c.op !== '>=' || num === null || left.kind === 'any' || typeof left.on !== 'object' || (left.on as { ref?: string }).ref !== 'self') return null;
      // edh-c-13 (CR 122.1; Heirloom Mirror, Ludevic's Test Subject; family self-has-n-counters): also "it has three or more ritual counters on it", the same count of the same counters
      return alt(`there are ${num} or more ${left.kind} counters on ${K.obj({ ref: 'self' }, st, 'object').text}`, `${K.obj({ ref: 'self' }, st, 'subject').text} has ${num} or more ${left.kind} counters on it`);
    }
    // edh-c-30 (CR 102.3, 118.9; model/forms.ts#isOpponentsHappenedPlayers; Lavaball Trap): "an opponent had two or more lands enter the battlefield under their control this turn": at least one opponent
    // (edh-players-9's `happenedPlayers`, parser/holes/p2cst1.ts) has that many lands entering under their control in this turn's history
    case 'happenedPlayers': {
      const ev = left.event;
      const t = left.times;
      // edh-next-58 (CR 400.3, 404.1; parser/holes/edhn58.ts; Ravenous Trap): "an opponent had three or more cards put into their graveyard from anywhere this turn"
      if (isOpponentsHappenedPlayers(left) && c.op === '>=' && right === 1 && t !== undefined && t.op === '>=' && t.n >= 2 && ev.ev === 'zoneChange' && ev.to === 'graveyard' && ev.from === undefined
        && Object.keys(ev).sort().join() === 'ev,subject,to' && Object.keys(ev.subject).sort().join() === 'isCard,owner' && ev.subject.owner === 'you' && ev.subject.isCard === true) return `an opponent had ${numWord(t.n)} or more cards put into their graveyard from anywhere this turn`;
      // edh-d-37 (CR 603.4, 305.1; parser/holes/edhd37.ts; Tunnel Ignus, Confounding Conundrum): "that player had another land enter the battlefield under their control this turn": the player the
      // trigger's event names has two lands entering under their control in this turn's history (the land that caused the trigger and another one)
      if (left.of.ref === 'event' && left.of.role === 'player' && c.op === '>=' && right === 1 && t !== undefined && t.op === '>=' && t.n === 2 && left.scope === 'turn' && left.countLeft === undefined
        && ev.ev === 'zoneChange' && ev.to === 'battlefield' && ev.from === undefined && Object.keys(ev).sort().join() === 'ev,subject,to' && Object.keys(ev.subject).sort().join() === 'controller,types'
        && ev.subject.controller === 'you' && ev.subject.types?.length === 1 && ev.subject.types[0] === 'Land') return `${K.player(left.of, st, 'subject').text} had another land enter the battlefield under their control this turn`;
      if (!isOpponentsHappenedPlayers(left) || c.op !== '>=' || right !== 1 || t === undefined || t.op !== '>=' || t.n < 2 || ev.ev !== 'zoneChange' || ev.to !== 'battlefield' || ev.from !== undefined) return null;
      if (Object.keys(ev).sort().join() !== 'ev,subject,to' || Object.keys(ev.subject).sort().join() !== 'controller,types' || ev.subject.controller !== 'you' || ev.subject.types?.length !== 1 || (ev.subject.types[0] !== 'Land' && ev.subject.types[0] !== 'Creature')) return null;
      return `an opponent had ${numWord(t.n)} or more ${ev.subject.types[0] === 'Land' ? 'lands' : 'creatures'} enter the battlefield under their control this turn`; // edh-c-86: creatures too (Whiplash Trap)
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
      // edh-c-29 (CR 120.1, 603.4; parser/holes/cond.ts, Boarded Window): "you were dealt 4 or more damage this turn": all the damage dealt to you this turn added up
      if (left.sum === 'amount' && left.per === undefined && num !== null && c.op === '>=' && ev.ev === 'damage' && ev.source === undefined && ev.amount === undefined && ev.excess === undefined
        && ev.recipient?.player === 'you' && ev.recipient.object === undefined && left.by === undefined && left.beforeEvent === undefined && left.scope === 'turn') {
        return `you were dealt ${num} or more ${ev.combat === true ? 'combat ' : ev.combat === false ? 'noncombat ' : ''}damage this turn`;
      }
      // edh-next-82 (CR 120.1, 400.7; parser/holes/cond.ts#sourcesDealtDamage, Dragon Cultist): "a source you controlled dealt 5 or more damage this turn"
      if (left.sum === 'amount' && left.per === 'source' && num !== null && c.op === '>=' && ev.ev === 'damage' && ev.recipient === undefined && ev.amount === undefined && ev.excess === undefined && ev.combat === undefined
        && left.by === undefined && left.beforeEvent === undefined && left.scope === 'turn' && JSON.stringify(ev.source) === '{"controller":"you"}') {
        return `a source you controlled dealt ${num} or more damage this turn`;
      }
      // std-rB (CR 120.1; parser/holes/cond.ts#sourcesDealtDamage): "red sources you controlled dealt 4 or more noncombat damage this turn" (this turn's damage added up)
      if (left.sum === 'amount' && left.per === undefined && num !== null && c.op === '>=' && ev.ev === 'damage' && ev.recipient === undefined && ev.amount === undefined && ev.excess === undefined
        && left.by === undefined && left.beforeEvent === undefined && left.scope === 'turn' && ev.source !== undefined && ev.source.controller === 'you') {
        const colors = ev.source.colors;
        if (Object.keys(ev.source).some((k) => k !== 'controller' && k !== 'colors') || (colors !== undefined && colors.length !== 1)) return null;
        const color = colors === undefined ? '' : `${COLOR_WORD[colors[0]!]} `;
        return `${color}sources you controlled dealt ${num} or more ${ev.combat === true ? 'combat ' : ev.combat === false ? 'noncombat ' : ''}damage this turn`;
      }
      // edh-replace-5 (CR 107.14; model/forms.ts#isTurnEnergySpent): "you've paid or lost four or more {E} this turn" (Izzet Generatorium)
      if (isTurnEnergySpent(left) && num !== null && c.op === '>=') return `you've paid or lost ${num} or more {e} this turn`;
      if (left.sum !== undefined) return null;
      // edh-next-3 (CR 121.1; model/forms.ts#isOpponentDrawsPerPlayer): "an opponent has drawn four or more cards this turn" (Even the Score)
      if (isOpponentDrawsPerPlayer(left) && num !== null && c.op === '>=') return alt(`an opponent has drawn ${num} or more cards this turn`, `an opponent drew ${num} or more cards this turn`); // edh-c-2 (Runeflare Trap, CR 121.1): both tenses
      // p2-cost-statics-1 (CR 601.2i; model/forms.ts#isOpponentSpellsPerPlayer): "an opponent cast three or more spells this turn" (Mindbreak Trap)
      if (isOpponentSpellsPerPlayer(left) && num !== null && c.op === '>=') return `an opponent cast ${num} or more spells this turn`;
      if (left.per !== 'player' || num === null || c.op !== '>=' || ev.ev !== 'cast' || ev.player !== undefined || ev.spell !== undefined || (left.by !== undefined && left.by !== 'any')) return null;
      return `a player cast ${num} or more spells ${scopeWords(left.scope)}`;
    }
    // std-rx4 (CR 119.3, 120.3a): "they lost life this turn", "that player lost life this turn": the life a player named before lost this turn is 1 or more
    // (parser/holes/cond.ts#anaphorLostLife; "you lost life this turn" is the history reading, render/condition.ts)
    case 'lifeLostThisTurn': {
      // edh-players-19 (CR 119.3, 120.3a, 603.4; Lolth, Spider Queen's emblem): "that player lost less than 8 life this turn" (parser/holes/cond.ts#anaphorLostLess)
      if (c.op === '<' && typeof right === 'number' && left.of.ref !== 'you') {
        const who = K.player(left.of, st, 'subject');
        return who.they === true ? alt(`${who.text} lost less than ${right} life this turn`, `they lost less than ${right} life this turn`) : `${who.text} lost less than ${right} life this turn`;
      }
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
      // edh-next-24 (CR 103.4, 119.1; Game Over): "a player's life total is less than or equal to half their starting life total": the lowest life total of all players is at most half of it
      if (c.op === '<=' && left.of.ref === 'each' && left.agg === 'min' && typeof right === 'object' && right.q === 'math' && right.op === 'floorDiv' && right.args.length === 2
        && typeof right.args[0] === 'object' && right.args[0].q === 'startingLife' && right.args[1] === 2) return "a player's life total is less than or equal to half their starting life total";
      if (num === null || !pre) return null;
      return `${who.text} ${have} ${pre[0]}${String(right)}${pre[1]} life`;
    }
    // FAST4 T24: "you gained life this turn" is gaining one or more life this turn (CR 119.3, 119.9; the controller's own count, statics/match.ts)
    case 'zoneSize': {
      // pc-players-2 (CR 402.1, 608.2c; parser/holes/cond.ts#playerMoreThanYou): "that player has more cards in hand than you": one player's hand against yours
      if (left.zone === 'hand' && c.op === '>' && typeof right === 'object' && right.q === 'zoneSize' && right.zone === 'hand' && right.of.ref === 'you' && left.of.ref !== 'you' && left.of.ref !== 'each') {
        const who = K.player(left.of, st, 'subject');
        return `${who.text} ${who.person === 'sg' ? 'has' : 'have'} more cards in hand than you`;
      }
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
      if (left.zone === 'hand' && (c.op !== '==' || (typeof right === 'number' && right > 0))) { // edh-replace-1 (Triskaidekaphile): also "you have exactly 13 cards in hand"
        const who = K.player(left.of, st, 'subject');
        const has = `${who.text} ${who.person === 'sg' ? 'has' : 'have'} ${amount} cards in`;
        // r3-fx (CR 402.1): "you have seven or more cards in your hand" (Resonating Lute): your own hand said with its possessive
        // p2-intervening-1 (CR 402.1; parser/holes/p2iv1.ts): "you have a card in hand" is one or more
        const one = c.op === '>=' && right === 1 && left.of.ref === 'you' ? ['you have a card in hand'] : [];
        return alt(base, `${has} hand`, ...(left.of.ref === 'you' ? [`${has} your hand`] : []), ...one);
      }
      // p2-attack-block-2 (CR 404.1, 506.2): "defending player has seven or more cards in their graveyard" (Vantress Gargoyle): the player's own graveyard
      if (left.zone === 'graveyard' && left.of.ref === 'defending' && c.op === '>=') return alt(base, `defending player has ${amount} cards in their graveyard`);
      // edh-zones-7 (CR 404.1; parser/holes/cond.ts#graveyardSize; family you-have-cards-in-graveyard): "you have seven or more cards in your graveyard" (Search for Azcanta)
      if (left.zone === 'graveyard' && left.of.ref === 'you' && c.op === '>=') return alt(base, `you have ${amount} cards in your graveyard`);
      return base;
    }
    // FAST5X E22 (CR 700.11): "you descended this turn" is one or more permanent cards put into your graveyard this turn
    case 'descendedThisTurn': return c.op === '>=' && right === 1 ? 'you descended this turn' : null;
    case 'extraTurnsBegun': return c.op === '==' && right === 0 ? "you haven't begun an extra turn this game" : null; // trek-18 (CR 500.7)
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
      // edh-next-55 (CR 208.1, 608.2c; Strength-Testing Hammer): the same comparison of the object the ability named is also "it has the greatest power or is tied for greatest power among creatures on the battlefield"
      if (noGreaterPower(c)) return alt('no other creature has greater power', `${K.obj((c.left as Extract<Quantity, { q: 'stat' }>).of, cloneState(st), 'subject').text} has the greatest power or is tied for greatest power among creatures on the battlefield`);
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
      // edh-d-57 (CR 121.1; Archmage Ascension): Oracle also words it in the simple past, "if you drew two or more cards this turn"
      return alt(`you've drawn ${num} or more cards this turn`, `you drew ${num} or more cards this turn`);
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
        // edh-mana-keywords-4 (CR 607.2a; Ugin's Labyrinth): "a card is exiled with ~", one or more
        // edh-zones-14 (CR 607.2a, 603.4; Valakut Exploration): ... also "there are cards exiled with ~" (family some-cards-exiled-with)
        if (c.op === '>=' && right === 1 && left.of.ever !== true) return alt(`a card is exiled with ${K.obj({ ref: 'self' }, st, 'object').text}`, `there are cards exiled with ${K.obj({ ref: 'self' }, st, 'object').text}`, 'there are cards exiled with it' /* edh-next-73: Evercoat Ursine */, 'a card is exiled with it' /* edh-next-26: Smirking Spelljacker, the attacking creature itself */);
        if (c.op !== '>=' || num === null || typeof right !== 'number' || right < 2) return null;
        // edh-d-96 (CR 607.2a; Colfenor's Urn): every card ever exiled with the object, "three or more cards have been exiled with ~" (no other wording: the cards still in exile are another count)
        if (left.of.ever === true) {
          const text = `${num} or more cards have been exiled with ${K.obj({ ref: 'self' }, st, 'object').text}`;
          // (the cards it counts are "those cards" of a later instruction: parser/lower/mentions.ts#mentionsAt names the linked cards so)
          st.mentioned.add('l:exiled'); st.info.set('l:exiled', { nouns: ['card'], plural: true });
          return text;
        }
        return alt(`there are ${num} or more cards exiled with ${K.obj({ ref: 'self' }, st, 'object').text}`, `there are ${num} or more cards exiled with it` /* edh-next-73 */);
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
      // edh-zones-17 (CR 404.1, 604.2; parser/holes/cond.ts#thereAre; family fewer-cards-in-your-graveyard): "there are fewer than eight cards in your graveyard" (The Warring Triad),
      // the count of the cards in your own graveyard below a number; "N or fewer" is the same count at most N
      if ((c.op === '<' || c.op === '<=') && right >= 1 && f.zone === 'graveyard' && f.owner === 'you' && f.controller === undefined) {
        const cards = K.np(f, st, { det: 'none', plural: true, count: c.op === '<' ? `fewer than ${numWord(right)}` : `${numWord(right)} or fewer`, noZone: true });
        return alt(`there are ${cards} in your graveyard`, `you have ${cards} in your graveyard`);
      }
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
      // edh-players-9 (CR 102.1, 119.1, 402.1; parser/holes/cond.ts#playerMoreThanEachOther): "that player has more life than each other player", "... more cards in hand than each other
      // player", "... controls more lands than each other player": the named player is the only player of the game with at least their own life (cards in hand, permanents)
      if (c.op === '==' && right === 1 && left.of.ref === 'each' && left.of.who === 'player' && left.speedVs === undefined && left.lostLifeThisTurn === undefined && left.lostLifeIs === undefined
        && left.didNot === undefined && left.lifeIs === undefined && left.poisonIs === undefined && left.sizeIs === undefined && left.controlsIs === undefined) {
        const vs = left.lifeVs ?? left.sizeVs ?? left.controlsVs;
        const kinds = [left.lifeVs, left.sizeVs, left.controlsVs].filter((x) => x !== undefined).length;
        if (vs !== undefined && kinds === 1 && vs.op === '>=') {
          const who = K.player(vs.than, st, 'subject').text;
          if (left.lifeVs !== undefined) return `${who} ${who === 'you' ? 'have' : 'has'} more life than each other player`;
          if (left.sizeVs !== undefined && left.sizeVs.zone === 'hand' && left.sizeVs.by === undefined) return `${who} ${who === 'you' ? 'have' : 'has'} more cards in hand than each other player`;
          if (left.controlsVs !== undefined && left.controlsVs.filter.controller === undefined) return `${who} ${who === 'you' ? 'control' : 'controls'} more ${K.np(left.controlsVs.filter, st, { det: 'none', plural: true, noController: true })} than each other player`;
          return null;
        }
      }
      // edh-c-40 (CR 402.1, 102.3; parser/holes/cond.ts#youMoreCardsThanEachOpponent): "you have more cards in hand than each opponent": no opponent has as many cards in hand as you
      if (c.op === '==' && right === 0 && left.sizeVs !== undefined && left.sizeVs.zone === 'hand' && left.sizeVs.by === undefined && left.sizeVs.op === '>=' && left.sizeVs.than.ref === 'you'
        && left.of.ref === 'each' && left.of.who === 'opponent' && Object.keys(left).length === 3) return 'you have more cards in hand than each opponent';
      // std-lci (CR 119.1, 102.1): "you have the most life or are tied for most life": no opponent has more life than you
      if (left.lifeVs !== undefined) {
        const l = left.lifeVs;
        // edh-players-17 (CR 119.1, 102.3; parser/holes/cond.ts#opponentMoreLifeThanAnother): "that opponent has more life than another of your opponents": at least one opponent's
        // life total is below that opponent's own (the named opponent is not below themselves)
        if (l.op === '<' && l.than.ref !== 'you' && c.op === '>=' && right === 1 && left.of.ref === 'each' && left.of.who === 'opponent' && left.sizeVs === undefined && Object.keys(left).length === 3) {
          return `${K.player(l.than, st, 'subject').text} has more life than another of your opponents`;
        }
        if (left.sizeVs !== undefined || (l.op !== '>' && l.op !== '<') || l.than.ref !== 'you' || left.of.ref !== 'each' || left.of.who !== 'opponent') return null;
        // pc-players-1 (CR 119.1, 102.3): "you have more life than an opponent": at least one opponent's life total is less than yours
        if (l.op === '<') return c.op === '>=' && right === 1 ? 'you have more life than an opponent' : null;
        // Standard round 6 (CR 119.1, 102.3): "an opponent has more life than you": at least one opponent's life total is greater than yours
        // edh-c-25 (family less-life-than-opponent; Timely Reinforcements): the same comparison from your side, "you have less life than an opponent"
        if (c.op === '>=' && right === 1) return alt('an opponent has more life than you', 'you have less life than an opponent');
        if (c.op !== '==' || right !== 0) return null;
        return 'you have the most life or are tied for most life';
      }
      // std-rx24 (CR 122.1f): "an opponent has three or more poison counters" (parser/holes/cond.ts#poisonCounters); with 1, "an opponent is poisoned" too
      // (family poisoned-one-or-more)
      if (left.poisonIs !== undefined) {
        const l = left.poisonIs;
        // edh-combat-6 (CR 122.1f, 506.2; parser/holes/cond.ts#poisonCounters; Norn's Decree): "one or more players being attacked are poisoned"
        if (left.of.ref === 'attacked' && l.op === '>=' && l.n === 1 && c.op === '>=' && right === 1 && left.sizeVs === undefined && left.sizeIs === undefined && left.lifeIs === undefined && left.lifeVs === undefined
          && left.controlsVs === undefined && left.lostLifeThisTurn === undefined && left.lostLifeIs === undefined && left.didNot === undefined) return 'one or more players being attacked are poisoned';
        if (left.sizeVs !== undefined || left.sizeIs !== undefined || left.controlsVs !== undefined || left.lifeVs !== undefined || left.lifeIs !== undefined || left.lostLifeThisTurn !== undefined
          || left.lostLifeIs !== undefined || left.didNot !== undefined || c.op !== '>=' || right !== 1 || left.of.ref !== 'each' || left.of.who !== 'opponent' || l.op !== '>=' || l.n < 1) return null;
        const has = `an opponent has ${numWord(l.n)} or more poison counters`;
        return l.n === 1 ? alt(has, 'an opponent is poisoned') : has;
      }
      // r4-static (CR 119.1): "an opponent has 10 or less life": at least one opponent's life total is at most (at least) that number
      if (left.lifeIs !== undefined) {
        const l = left.lifeIs;
        // edh-next-83 (CR 119.1, 103.4; Anya): "an opponent's life total is less than half their starting life total"
        if (l.halfStarting === true) {
          if (c.op !== '>=' || right !== 1 || l.op !== '<' || left.of.ref !== 'each' || left.of.who !== 'opponent' || Object.keys(left).sort().join() !== 'lifeIs,of,q') return null;
          return "an opponent's life total is less than half their starting life total";
        }
        // edh-players-23 (CR 119.1, 102.2; parser/holes/cond.ts#eachHasLife): "each player has 10 or less life": no player of the group has a life total beyond the number
        if (c.op === '==' && right === 0 && left.of.ref === 'each' && (left.of.who === 'player' || left.of.who === 'opponent') && Object.keys(left).length === 3 && (l.op === '>' || l.op === '<')) {
          return `each ${left.of.who} has ${l.n} or ${l.op === '>' ? 'less' : 'more'} life`;
        }
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
        if (left.sizeVs !== undefined || c.op !== '>=' || right !== 1 || left.of.ref !== 'each' || left.of.who !== 'opponent' || v.than.ref !== 'you' || v.filter.controller !== undefined) return null;
        // edh-c-58 (CR 102.2, 102.3; Avatar of Might): "an opponent controls at least four more creatures than you"
        if (v.by !== undefined) return v.op === '>=' && v.by >= 2 ? `an opponent controls at least ${numWord(v.by)} more ${K.np(v.filter, st, { det: 'none', plural: true, noController: true })} than you` : null;
        if (v.op !== '>') return null;
        // edh-c-25 (family fewer-than-opponent; Timely Reinforcements): from your side, "you control fewer creatures than an opponent"
        const group = K.np(v.filter, st, { det: 'none', plural: true, noController: true });
        return alt(`an opponent controls more ${group} than you`, `you control fewer ${group} than an opponent`);
      }
      // r4-cost (CR 402.1, 102.1; parser/holes/cost-conds.ts): "a player has one or fewer cards in hand": at least one player whose hand size compares so
      if (left.sizeIs !== undefined) {
        const { zone, op, n } = left.sizeIs;
        // std-rx21 (CR 404.1, 102.3; parser/holes/cond.ts#opponentHasLife): "an opponent has eight or more cards in their graveyard"
        if (zone === 'graveyard' && op === '>=' && c.op === '>=' && right === 1 && left.of.ref === 'each' && left.of.who === 'opponent' && left.lostLifeThisTurn === undefined
          && left.lifeIs === undefined && left.lostLifeIs === undefined && left.didNot === undefined) return `an opponent has ${numWord(n)} or more cards in their graveyard`;
        // edh-players-8 (CR 404.1, 102.3; parser/holes/cond.ts#aGraveyardHas): "a graveyard has twenty or more cards in it" (family a-graveyard-has-cards)
        if (zone === 'graveyard' && op === '>=' && c.op === '>=' && right === 1 && left.of.ref === 'each' && left.of.who === 'player' && left.lostLifeThisTurn === undefined
          && left.lifeIs === undefined && left.lostLifeIs === undefined && left.didNot === undefined) return alt(`a graveyard has ${numWord(n)} or more cards in it`, `a player has ${numWord(n)} or more cards in their graveyard`, `there are ${numWord(n)} or more cards in a single graveyard`); // edh-c-71: Swimmer in Nightmares
        // edh-c-16 (CR 402.1, 102.3; parser/holes/cond.ts#opponentNoHand): "an opponent has no cards in hand"
        if (zone === 'hand' && op === '==' && n === 0 && c.op === '>=' && right === 1 && left.of.ref === 'each' && left.of.who === 'opponent' && left.lostLifeThisTurn === undefined
          && left.lifeIs === undefined && left.lostLifeIs === undefined && left.didNot === undefined) return 'an opponent has no cards in hand';
        if (zone !== 'hand' || c.op !== '>=' || right !== 1 || left.of.ref !== 'each' || left.of.who !== 'player' || (op !== '<=' && op !== '>=') || left.lostLifeThisTurn !== undefined) return null;
        if (op === '<=' && n === 0) return 'a player has no cards in hand'; // edh-b-4 (Lupine Prototype)
        return `a player has ${numWord(n)} ${op === '<=' ? 'or fewer' : 'or more'} cards in hand`;
      }
      // FAST1 T5: "you have two or more opponents" (CR 102.3; family comparison)
      if (num === null || c.op !== '>=' || left.of.ref !== 'each' || left.of.who !== 'opponent' || left.lostLifeThisTurn !== undefined) return null;
      return `you have ${num} or more opponents`;
    }
    // edh-replace-4 (CR 201.2; parser/holes/cond.ts): "you control eight or more artifacts with the same name as one another"
    case 'mostSharingName': {
      if (num === null || c.op !== '>=' || left.among.ref !== 'each' || !('filter' in left.among) || left.among.filter.controller !== 'you' || typeof right !== 'number' || right < 2) return null;
      const { controller: _mine, ...rest } = left.among.filter;
      const lands = `you control ${num} or more ${K.np(rest, st, { det: 'none', plural: true })} with the same name`;
      return alt(`${lands} as one another`, lands); // edh-mana-keywords-7 (family same-name-count-as-one-another): Sceptre of Eternal Glory, Endless Atlas say it without "as one another"
    }
    // edh-c-74 (CR 205.3m; parser/holes/cond.ts): "you control three or more creatures that share a creature type"
    case 'mostSharingCreatureType': {
      if (num === null || c.op !== '>=' || left.among.ref !== 'each' || !('filter' in left.among) || left.among.filter.controller !== 'you' || typeof right !== 'number' || right < 2) return null;
      const { controller: _mine, ...rest } = left.among.filter;
      return `you control ${num} or more ${K.np(rest, st, { det: 'none', plural: true })} that share a creature type`;
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
      // edh-d-61 (CR 607.2a, 202.3, 603.4; Azor's Gateway, family linked-exile-different-values): "cards with five or more different mana values are exiled with ~" is the number of different mana values among the cards exiled with ~
      if (left.what === 'manaValues' && left.among.ref === 'linked' && left.among.link === 'exiled' && among === 'cards exiled with ~' && typeof right === 'number' && right >= 2) return alt(base, `cards with ${num} or more different mana values are exiled with ~`);
      // edh-d-62 (CR 105.2, 105.2c, 608.2h; Jared Carthalion, eff.edhd62.if.thatCard.wasAllColors): five colors among ONE object is "that card was all colors" (a bound or target object, never a group)
      // edh-next-139 (CR 105.2, 105.2c, 608.2h; Jenson Carthalion, Druid Exile): also the spell of the triggering cast event, "if that spell was all colors"
      if (left.what === 'colors' && right === 5 && (left.among.ref === 'bound' || left.among.ref === 'target' || (left.among.ref === 'event' && left.among.role === 'spell'))) {
        const o = K.obj(left.among, cloneState(st), 'subject').text;
        return alt(base, `${o} was all colors`, `${o} is all colors`, `${o}'s all colors`);
      }
      // FAST5X E12 (CR 105.1): there are five colors, so "there are five colors among permanents you control" is five or more (Case of the Shattered Pact)
      // CLOUD std-fdn (CR 201.2): "you control ten or more Gates with different names" is the number of different names among the Gates you control
      const a = left.among;
      if (left.what === 'names' && a.ref === 'each' && 'filter' in a && a.filter.controller === 'you') {
        // trek-5 (CR 201.2; family differently-named-lands): "you control five or more differently named lands" is the same count of different names among the lands you control
        const kind = K.np({ ...a.filter, controller: undefined }, st, { det: 'none', plural: true });
        return alt(base, `you control ${num} or more ${kind} with different names`, `you control ${num} or more differently named ${kind}`);
      }
      // edh-c-10 (CR 105.1; Spirit of Resistance): "you control a permanent of each color", the permanents you control with all five colors among them
      const ownAll = left.among.ref === 'each' && 'filter' in left.among && JSON.stringify(left.among.filter) === '{"controller":"you"}';
      return left.what === 'colors' && right === 5 ? (ownAll ? alt(base, `there are ${num} ${w} among ${among}`, 'you control 1 permanent of each color') : alt(base, `there are ${num} ${w} among ${among}`)) : base;
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

/** edh-d-42: the condition parser/holes/cond.ts#playedFromExile builds: a land play or a spell cast by you this turn from exile. */
const isPlayedFromExile = (c: Condition): boolean => c.cond === 'any' && JSON.stringify(c.of) === JSON.stringify([
  { cond: 'happened', event: { ev: 'action', verb: 'playLand', actor: 'you', from: 'exile' }, scope: 'turn' },
  { cond: 'happened', event: { ev: 'cast', player: 'you', from: 'exile' }, scope: 'turn' },
]);

/**
 * edh-d-98 (CR 603.4, 603.2; Cemetery Gatekeeper; the parser's lower/ability.ts#playOrCastEach): in "Whenever a player plays a land or casts a spell, if it shares a card type with
 * the exiled card, ...", "it" is the land played or the spell cast: the condition is read once per pattern, `{cond:'any', of:[matches subject, matches spell]}` with one filter.
 * Said once, with "it"; only that shape, under a trigger of exactly those two patterns.
 */
function playOrCastItPhrase(of: readonly Condition[], st: RenderState): string | null {
  const on = st.trigger ?? [];
  if (on.length !== 2 || !on.some((p) => p.ev === 'action' && p.verb === 'playLand') || !on.some((p) => p.ev === 'cast')) return null;
  const [a, b] = of;
  if (of.length !== 2 || a?.cond !== 'matches' || b?.cond !== 'matches' || JSON.stringify(a.filter) !== JSON.stringify(b.filter)) return null;
  if (JSON.stringify(a.object) !== JSON.stringify({ ref: 'event', role: 'subject' }) || JSON.stringify(b.object) !== JSON.stringify({ ref: 'event', role: 'spell' })) return null;
  const w = cloneState(st);
  const subj = firstAlt(K.obj(a.object, cloneState(st), 'subject').text);
  const text = firstAlt(K.cond(a, w));
  return text.startsWith(`${subj} `) ? `it${text.slice(subj.length)}` : null;
}
