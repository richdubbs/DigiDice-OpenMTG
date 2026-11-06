/**
 * edh-next-137 (must-finish round, planeswalkers): folds of adjacent steps that only this round's templates build (render/fold.ts#foldAtPlain calls `foldEdhN137`).
 * Each applies only when every part is exactly what the words say; null otherwise (the general renderers then say the steps or refuse).
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { alt, numWord } from './text';
import { bind } from './steps-util';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const EACH_OPPONENT = { ref: 'each', who: 'opponent' };
const UNTIL_SELF_LEAVES = { d: 'until', event: { ev: 'zoneChange', subject: { self: true }, from: 'battlefield' } };

/**
 * "Each opponent reveals their hand. For each opponent, exile a creature card they revealed this way until ~ leaves the battlefield." (Valki, God of Lies; CR 701.20a, 608.2c,
 * 610.3, 610.3c): right after every opponent revealed their whole hand (the step before), you choose one creature card in each opponent's hand (`perPlayer`, the cards the
 * reveal showed: nothing happens between the two) and exile the chosen cards until the source leaves the battlefield. Only that exact shape.
 */
function exileRevealedPerOpponent(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const prev = list[i - 1];
  const ch = list[i];
  const mv = list[i + 1];
  if (prev?.op !== 'reveal' || !same(prev.who, EACH_OPPONENT) || !same(prev.what, { ref: 'each', filter: { zone: 'hand', owner: EACH_OPPONENT } }) || prev.to !== undefined) return null;
  if (ch?.op !== 'chooseObjects' || ch.as === undefined || ch.guard !== undefined) return null;
  if (!same(ch, { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { zone: 'hand', owner: { ref: 'iterating' }, isCard: true, types: ['Creature'] } }, min: 1, max: 1, perPlayer: EACH_OPPONENT, as: ch.as })) return null;
  if (mv?.op !== 'move' || mv.guard !== undefined || mv.as !== undefined || mv.remember !== undefined) return null;
  const { link: _link, ...core } = mv;
  if (!same(core, { op: 'move', what: { ref: 'bound', name: ch.as }, to: { zone: 'exile' }, until: UNTIL_SELF_LEAVES })) return null;
  const self = K.obj({ ref: 'self' }, st, 'subject').text;
  return { clauses: [plain(`for each opponent, exile a creature card they revealed this way until ${self} leaves the battlefield`, { standalone: true })], consumed: 2 };
}

/**
 * "Choose a creature card exiled with ~ with mana value X. ~ becomes a copy of that card." (Valki, God of Lies; CR 607.2a, 707.2, 707.4, 608.2d, 611.2a): as the ability
 * resolves you choose one creature card among the cards exiled with the source (its exile link) whose mana value equals the amount, then the source becomes a copy of that
 * card for good (a 1a copy effect whose copiable values are read once, effects/copy.ts); none chosen, nothing happens (ruling 2021-02-05). Only that exact shape.
 */
function chooseExiledThenBecomeCopy(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const ch = list[i];
  const ef = list[i + 1];
  if (ch?.op !== 'chooseObjects' || ch.as === undefined || ch.guard !== undefined || ch.from.ref !== 'each') return null;
  const mv = ch.from.filter.manaValue;
  if (mv === undefined || typeof mv !== 'object' || !('op' in mv) || mv.op !== '==') return null;
  if (!same(ch, { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { zone: 'exile', isCard: true, types: ['Creature'], is: { ref: 'linked', link: 'exiled' }, manaValue: mv } }, min: 1, max: 1, as: ch.as })) return null;
  if (ef?.op !== 'effect' || !same(ef, { op: 'effect', duration: { d: 'permanent' }, effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '1a', copyOf: { ref: 'bound', name: ch.as } }] }] })) return null;
  const self = K.obj({ ref: 'self' }, st, 'subject').text;
  const x = K.qty(mv.value as Parameters<typeof K.qty>[0], st);
  return { clauses: [plain(`choose a creature card exiled with ${self} with mana value ${x}. ${self} becomes a copy of that card`, { standalone: true })], consumed: 2 };
}

/**
 * "[+2], then create two 1/1 green Squirrel creature tokens. They gain haste until end of turn." (Comet, Stellar Pup; CR 606.1, 122.1, 111.1, 611.2a, 608.2c): loyalty counters put on
 * the source itself (said with the loyalty symbol, render/steps-life.ts#loyaltySymbol), then tokens and the ability those tokens gain, in a sentence of their own after ", then"
 * (render/fold-edhv25.ts makes the token sentence standalone, which no ", then" may join). Only that exact shape: a plain token with its binding and one effect on exactly it.
 */
function loyaltyThenCreateTheyGain(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const p = list[i];
  const a = list[i + 1];
  const b = list[i + 2];
  if (p?.op !== 'putCounters' || p.kind !== 'loyalty' || !same(p.on, { ref: 'self' }) || typeof p.count !== 'number' || Object.keys(p).some((k) => !['op', 'on', 'kind', 'count'].includes(k))) return null;
  if (a?.op !== 'createToken' || b?.op !== 'effect' || a.as === undefined || a.guard !== undefined || b.guard !== undefined || b.as !== undefined || b.effects.length !== 1) return null;
  if (Object.keys(a.token).some((k) => !['colors', 'types', 'subtypes', 'power', 'toughness'].includes(k))) return null;
  const e = b.effects[0]!;
  if (e.s !== 'continuous' || !same(e.affects, { ref: 'bound', name: a.as })) return null;
  const made = K.clause(a, st);
  if (made.empty === true || made.standalone === true || (made.actor !== null && made.actor !== 'you')) return null;
  const grant = K.clause(b, st);
  if (grant.empty === true || grant.standalone === true || grant.actor !== null) return null;
  return { clauses: [plain(`[+${p.count}], then ${made.imp}. ${grant.imp}`, { standalone: true })], consumed: 3 };
}

/**
 * "~ deals damage equal to the number of loyalty counters on ~ to a creature or player" (Comet, Stellar Pup; CR 120.3, 608.2d, 115.1; ruling 2022-10-07: "None of Comet's abilities
 * require a target. All choices ... are made as the abilities resolve"): you choose a creature or a player as the ability resolves (no target), and the source deals that much damage
 * to it. Exactly the three steps this round's template builds: the choice between the two, then one branch each with the same amount.
 */
function damageToCreatureOrPlayer(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  const a = list[i + 1];
  const b = list[i + 2];
  if (c?.op !== 'chooseValue' || c.link === undefined || !same(c, { op: 'chooseValue', who: { ref: 'you' }, what: 'option', as: c.as, link: c.link, options: ['a creature', 'a player'] })) return null;
  if (a?.op !== 'if' || b?.op !== 'if' || a.else !== undefined || b.else !== undefined || a.guard !== undefined || b.guard !== undefined) return null;
  if (!same(a.cond, { cond: 'chosen', link: c.link, equals: 'a creature' }) || !same(b.cond, { cond: 'chosen', link: c.link, equals: 'a player' })) return null;
  const [pickC, dmgC] = a.then;
  const [pickP, dmgP] = b.then;
  if (a.then.length !== 2 || b.then.length !== 2 || pickC?.op !== 'chooseObjects' || dmgC?.op !== 'damage' || pickP?.op !== 'chooseValue' || dmgP?.op !== 'damage' || pickC.as === undefined || pickP.link === undefined) return null;
  if (!same(pickC, { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { types: ['Creature'] } }, min: 1, max: 1, as: pickC.as })) return null;
  if (!same(pickP, { op: 'chooseValue', who: { ref: 'you' }, what: 'player', as: pickP.as, link: pickP.link })) return null;
  if (!same(dmgC, { op: 'damage', source: { ref: 'self' }, to: { ref: 'bound', name: pickC.as }, amount: dmgC.amount }) || !same(dmgP, { op: 'damage', source: { ref: 'self' }, to: { ref: 'linked', link: pickP.link }, amount: dmgC.amount })) return null;
  const self = K.obj({ ref: 'self' }, st, 'subject').text;
  return { clauses: [plain(`${self} deals damage equal to ${K.qty(dmgC.amount, st)} to a creature or player`)], consumed: 3 };
}

/**
 * "you may activate ~'s loyalty ability two more times this turn" (Comet, Stellar Pup; CR 606.3, 602.5b, 611.2a): until end of turn, the source's loyalty abilities may be
 * activated that many more times this turn (rule additionalActivation `loyalty` with a value, of the source itself; rules/timing.ts#abilityTiming). Only that exact shape.
 */
function selfLoyaltyMoreTimes(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const e = list[i];
  if (e?.op !== 'effect' || e.guard !== undefined || e.as !== undefined || !same(e.duration, { d: 'endOfTurn' }) || e.effects.length !== 1) return null;
  const r = e.effects[0]!;
  if (r.s !== 'rule' || r.rule !== 'additionalActivation' || typeof r.value !== 'number' || r.value < 2 || !same(r, { s: 'rule', rule: 'additionalActivation', keyword: 'loyalty', value: r.value, of: { self: true } })) return null;
  const whose = alt(`${K.obj({ ref: 'self' }, st, 'object').text}'s`, K.obj({ ref: 'self' }, st, 'possessive').text);
  return { clauses: [plain(`you may activate ${whose} loyalty ability ${numWord(r.value)} more times this turn`)], consumed: 1 };
}

/**
 * "you may activate loyalty abilities of ~ twice this turn rather than only once" (Kaito, Dancing Shadow; CR 606.3, 602.5b, 611.2a; rulings 2023-02-04: twice at most, however many
 * times it is granted): until end of turn the source's loyalty-ability limit is two (rule additionalActivation `loyalty:twice` of the source itself). Only that exact shape.
 */
function selfLoyaltyTwiceThisTurn(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const e = list[i];
  if (e?.op !== 'effect' || e.guard !== undefined || e.as !== undefined || !same(e.duration, { d: 'endOfTurn' }) || !same(e.effects, [{ s: 'rule', rule: 'additionalActivation', keyword: 'loyalty:twice', of: { self: true } }])) return null;
  return { clauses: [plain(`you may activate loyalty abilities of ${K.obj({ ref: 'self' }, st, 'object').text} twice this turn rather than only once`)], consumed: 1 };
}

/**
 * "you may return one of them to its owner's hand" (Kaito, Dancing Shadow; CR 608.2c, 608.2d, 603.2c): you choose one object of the group an earlier phrase named (the creatures of a
 * "one or more" trigger) and it goes to its owner's hand (CR 400.3). Only a choice of exactly one of a plural group and the move of exactly that object to a hand.
 */
function returnOneOfThem(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || a.as === undefined || a.from.ref !== 'each' || !('filter' in a.from) || a.from.filter.is === undefined || Object.keys(a.from.filter).length !== 1) return null;
  if (!same(a, { op: 'chooseObjects', who: { ref: 'you' }, from: a.from, min: 1, max: 1, as: a.as })) return null;
  if (b?.op !== 'move' || !same(b, { op: 'move', what: { ref: 'bound', name: a.as }, to: { zone: 'hand' } })) return null;
  const them = K.obj(a.from.filter.is, st, 'object');
  if (!them.plural) return null;
  bind(st, a.as, { nouns: ['creature'], plural: false });
  return { clauses: [plain(`return one of ${them.text} to its owner's hand`)], consumed: 2 };
}

/** The edh-next-137 folds, in order. */
export function foldEdhN137(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return exileRevealedPerOpponent(list, i, st) ?? chooseExiledThenBecomeCopy(list, i, st) ?? loyaltyThenCreateTheyGain(list, i, st) ?? damageToCreatureOrPlayer(list, i, st) ?? selfLoyaltyMoreTimes(list, i, st) ?? selfLoyaltyTwiceThisTurn(list, i, st) ?? returnOneOfThem(list, i, st);
}
