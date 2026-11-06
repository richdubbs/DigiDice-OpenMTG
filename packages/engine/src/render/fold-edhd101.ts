/**
 * edh-d-101 render folds: shapes only this round's templates build (parser/templates/zz-cloud/edh-d-101.json). Each returns null for any other shape, so the general renderers
 * then say it or refuse. No value is imported from render/fold.ts (it imports this file).
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { cloneState, type RenderState } from './state';
import { alt } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const onlyKeys = (x: object, keys: readonly string[]): boolean => Object.entries(x).every(([k, v]) => v === undefined || keys.includes(k));

/**
 * edh-d-101 (CR 115.1, 601.2c, 608.2c, 101.4, 701.23a, 400.7; Disorienting Choice, eff.edhd101.eachOpp.chooseTarget.controllerMayExile.searchRemaining): after "For each opponent, choose
 * up to one target ... that player controls." (said by render/program.ts#chosenFirst), "For each permanent chosen this way, its controller may exile it. Then if one or more of the chosen
 * permanents are still on the battlefield, you search your library for up to that many land cards, put them onto the battlefield tapped, then shuffle.": a `forEach` over the players in turn
 * order (CR 101.4) in which each chooses any of the per-opponent targets they control (each controller's "may"), the move to exile of every permanent chosen together (the 2024-09-20 ruling), then, when at least one target is still on the battlefield (a target exiled is a new object, CR 400.7), a search of your
 * library for up to that number of land cards put onto the battlefield tapped, and a shuffle. Only that exact shape.
 */
function controllersMayExileThenSearch(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [fe, mv, cond] = [list[i], list[i + 1], list[i + 2]];
  if (fe?.op !== 'forEach' || mv?.op !== 'move' || cond?.op !== 'if' || !same(fe.over, { ref: 'each', who: 'player' }) || fe.gather === undefined || !onlyKeys(fe, ['op', 'over', 'as', 'do', 'gather']) || !onlyKeys(cond, ['op', 'cond', 'then'])) return null;
  const only = fe.do[0];
  const T = only?.op === 'chooseObjects' && only.from.ref === 'each' ? only.from.filter?.is : undefined;
  if (T?.ref !== 'target') return null;
  const spec = st.specs.get(T.id);
  if (spec === undefined || (spec as { perOpponent?: true }).perOpponent !== true || spec.min !== 0 || spec.max !== 1) return null;
  // each player in turn order (CR 101.4) chooses which of the chosen permanents they control they exile (each controller's "may"), then every permanent chosen is exiled at once (the
  // 2024-09-20 ruling: the choices first, in turn order, then all of them exiled simultaneously)
  const it = { ref: 'iterating' };
  if (!same(fe.do, [{ op: 'chooseObjects', who: it, from: { ref: 'each', filter: { is: T, controller: it } }, min: 0, max: 'any', as: fe.gather }])) return null;
  if (!same(mv, { op: 'move', what: { ref: 'bound', name: fe.gather }, to: { zone: 'exile' } })) return null;
  const count = { q: 'count', of: { ref: 'each', filter: { is: T } } };
  if (!same(cond.cond, { cond: 'compare', left: count, op: '>=', right: 1 }) || cond.then.length !== 3) return null;
  const [search, put, shuffle] = cond.then;
  if (search?.op !== 'search' || search.as === undefined || !same(search, { op: 'search', who: { ref: 'you' }, zone: 'library', filter: { types: ['Land'] }, min: 0, max: count, as: search.as })) return null;
  if (!same(put, { op: 'move', what: { ref: 'bound', name: search.as }, to: { zone: 'battlefield', controller: { ref: 'you' }, tapped: true } }) || !same(shuffle, { op: 'shuffle', who: { ref: 'you' } })) return null;
  if (list.length !== i + 3) return null;
  K.obj(T, st, 'object'); // (the targets are read, as every step that names them reads them)
  const text = 'for each permanent chosen this way, its controller may exile it. then if one or more of the chosen permanents are still on the battlefield, you search your library for up to that many land cards, put them onto the battlefield tapped, then shuffle';
  return { clauses: [plain(text, { standalone: true })], consumed: 3 };
}

/** A quantity that is computed (not a number, not the announced X nor a fixed variable): what "where X is" can name. */
const computed = (q: unknown): boolean => typeof q === 'object' && q !== null && (q as { q?: string }).q !== 'X' && (q as { q?: string }).q !== 'var';

/**
 * edh-d-101 (CR 107.3, 202.3, 608.2c; Blood on the Snow; family choose-mana-value-where-x): "return a creature or planeswalker card with mana value X or less from your graveyard to the
 * battlefield, where X is the amount of {S} spent to cast this spell": a card you choose as the effect resolves (no target) whose mana value is limited by a calculated quantity, said
 * with X and one "where X is" clause closing the sentence, as a target's is (render/program.ts#targetManaValueWhereX). The quantity is read as the card is chosen, the same number
 * either way. Only a choice of exactly one card from your graveyard put onto the battlefield under your control; the plain reading ("with mana value less than or equal to ...") stays.
 */
/** The choices whose plain reading is being rendered (by the general renderers) right now. */
const RENDERING = new Set<EffectStep>();

function chooseReturnManaValueWhereX(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [ch, mv] = [list[i], list[i + 1]];
  if (ch?.op !== 'chooseObjects' || mv?.op !== 'move' || ch.from.ref !== 'each' || ch.min !== 1 || ch.max !== 1 || !onlyKeys(ch, ['op', 'who', 'from', 'min', 'max', 'as'])) return null;
  const f = ch.from.filter;
  const lim = f?.manaValue;
  if (f === undefined || lim === undefined || lim.op !== '<=' || !computed(lim.value) || f.zone !== 'graveyard' || f.owner !== 'you') return null;
  if (!same(ch.who, { ref: 'you' }) || !same(mv, { op: 'move', what: { ref: 'bound', name: ch.as }, to: { zone: 'battlefield', controller: { ref: 'you' } } })) return null;
  if (RENDERING.has(ch)) return null; // the plain reading below is the general renderers' (this fold steps aside for it)
  const withX = { ...ch, from: { ...ch.from, filter: { ...f, manaValue: { op: '<=', value: { q: 'X' } } } } } as EffectStep;
  RENDERING.add(ch);
  let plainText: string;
  try { plainText = K.steps([ch, mv], cloneState(st)).replace(/\.$/, ''); } finally { RENDERING.delete(ch); }
  const body = K.steps([withX, mv], st).replace(/\.$/, '');
  if (body === '' || /[.!?]\s/.test(body) || / where x is /.test(body) || plainText === '') return null;
  return { clauses: [plain(alt(plainText, `${body}, where x is ${K.qty(lim.value as never, st)}`), { standalone: true })], consumed: 2 };
}

const LINK = { ref: 'linked', link: 'exiled' };
const PERMANENT_CARD_TYPES = ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'];
/** "if it's a <type> card": one of the cards exiled with the source is of that one card type (the type word said back, null for any other condition). */
function anyOfType(c: unknown): string | null {
  const types = (c as { left?: { of?: { filter?: { types?: unknown } } } }).left?.of?.filter?.types;
  if (!Array.isArray(types) || types.length !== 1 || typeof types[0] !== 'string') return null;
  if (!same(c, { cond: 'compare', left: { q: 'count', of: { ref: 'each', filter: { zone: 'exile', is: LINK, types } } }, op: '>=', right: 1 })) return null;
  const w = types[0].toLowerCase();
  return `${/^[aeiou]/.test(w) ? 'an' : 'a'} ${w} card`;
}

/**
 * edh-d-101 (CR 406.3, 607.2a, 202.3, 119.3; The Creation of Avacyn, eff.edhd101.linked.turnFaceUp.ifTypeLoseManaValue): "Turn the exiled card face up. If it's a creature card, you lose
 * life equal to its mana value.": every face-down card exiled with the source turned face up in exile, then, if one of them is a creature card, you lose life equal to their total mana
 * value (the rulings of 2024-06-07: in the rare case of several cards, all are turned face up and the combined mana value is lost). Only that exact shape.
 */
function linkedTurnFaceUpLoseLife(list: EffectStep[], i: number, _st: RenderState): Folded | null {
  const [up, cond] = [list[i], list[i + 1]];
  if (!same(up, { op: 'changeFace', what: LINK, to: 'faceUp', inExile: true }) || cond?.op !== 'if') return null;
  const kind = anyOfType(cond.cond);
  if (kind === null || !same(cond, { op: 'if', cond: cond.cond, then: [{ op: 'loseLife', who: { ref: 'you' }, amount: { q: 'stat', stat: 'manaValue', of: LINK, sum: true } }] })) return null;
  return { clauses: [plain(`turn the exiled card face up. if it's ${kind}, you lose life equal to its mana value`, { standalone: true })], consumed: 2 };
}

/**
 * edh-d-101 (CR 607.2a, 608.2d, 110.2, 400.3; The Creation of Avacyn, eff.edhd101.linked.mayPutIfType.elseHand): "You may put the exiled card onto the battlefield if it's a creature card.
 * If you don't put it onto the battlefield, put it into its owner's hand.": if one of the cards exiled with the source is a creature card, you may put the permanent cards among them onto
 * the battlefield (all or none), then every one of them still in exile goes to its owner's hand (the rulings of 2024-06-07). Only that exact shape.
 */
function linkedMayPutElseHand(list: EffectStep[], i: number, _st: RenderState): Folded | null {
  const [cond, hand] = [list[i], list[i + 1]];
  const put = { op: 'move', what: { ref: 'each', filter: { zone: 'exile', is: LINK, types: PERMANENT_CARD_TYPES } }, to: { zone: 'battlefield', controller: { ref: 'you' } } };
  const kind = cond?.op === 'if' ? anyOfType(cond.cond) : null;
  if (kind === null || !same(cond, { op: 'if', cond: (cond as { cond: unknown }).cond, then: [{ op: 'may', who: { ref: 'you' }, do: [put] }] })) return null;
  if (!same(hand, { op: 'move', what: { ref: 'each', filter: { zone: 'exile', is: LINK } }, to: { zone: 'hand' } })) return null;
  return { clauses: [plain(`you may put the exiled card onto the battlefield if it's ${kind}. if you don't put it onto the battlefield, put it into its owner's hand`, { standalone: true })], consumed: 2 };
}

/**
 * edh-d-101 (CR 118.12a, 701.21a, 119.3, 608.2h; Archfiend of Spite, template eff.t34.loseLife.unlessTheyPayCost): "that source's controller loses that much life unless they sacrifice that many
 * permanents of their choice": in a damage trigger, the controller of the source (as it last existed, CR 608.2h) may sacrifice as many permanents as the damage dealt; if they don't, they lose
 * that much life (the rulings of 2019-08-23: all of them or the life, never part; a player who can't sacrifice enough loses the life). Only that exact shape: one sacrifice part whose count
 * is the event's amount, the same payer and loser.
 */
function sourceControllerUnlessSacrificeThatMany(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const pay = list[i];
  const who = { ref: 'controllerOf', object: { ref: 'event', role: 'source' } };
  const amount = { q: 'eventAmount' };
  if (pay?.op !== 'pay' || !onlyKeys(pay, ['op', 'who', 'cost', 'else']) || !same(pay.who, who) || !same(pay.else, [{ op: 'loseLife', who, amount }])) return null;
  const part = pay.cost.other?.[0];
  if (Object.keys(pay.cost).length !== 1 || pay.cost.other?.length !== 1 || part?.kind !== 'sacrifice' || !same(part.count, amount) || !onlyKeys(part, ['kind', 'filter', 'count'])) return null;
  const f = part.filter ?? {};
  if (Object.keys(f).some((k) => k !== 'types' || !same(f.types, ['Permanent'])) && Object.keys(f).length > 0) return null;
  return { clauses: [plain("that source's controller loses that much life unless they sacrifice that many permanents of their choice", { standalone: true })], consumed: 1 };
}

/** The folds of this round's templates, called from render/fold.ts#foldAtPlain. */
export function foldEdhD101(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return controllersMayExileThenSearch(list, i, st) ?? chooseReturnManaValueWhereX(list, i, st) ?? linkedTurnFaceUpLoseLife(list, i, st) ?? linkedMayPutElseHand(list, i, st) ?? sourceControllerUnlessSacrificeThatMany(list, i, st);
}
