/**
 * edh-d-62 (Commander lane commander, third pass): the folds of its templates (parser/templates/zz-cloud/edh-d-62.json), called from render/fold.ts#foldAt. Each applies only when
 * every part is exactly what the idiom says.
 *
 * `nextTurnEachMustAttack` (CR 508.1d, 611.2a, 500.1; Rowan Kenrith, eff.edhd62.player.nextTurn.eachCreatureMustAttack): "During target player's next turn, each creature that player
 * controls attacks if able.": one lasting attack requirement for every creature the player controls, lasting through that player's next turn (`duringNextTurn` with `whose` the player).
 *
 * `eachBasePtLoseAll` (CR 611.2a, 613.1f, 613.4b, 113.1; Will Kenrith, eff.edhd62.dur.objs.each.basept.loseAll): "Until your next turn, up to two target creatures each have base power and
 * toughness 0/3 and lose all abilities.": one lasting effect on a group of objects, loss of all abilities (layer 6) and a base power and toughness (layer 7b), said in this order.
 *
 * `forEachOppMillReturnUnlessPays` (CR 608.2c, 701.17a, 118.12, 119.4; Sivriss, Nightmare Speaker, eff.edhd62.forEachOpp.mill.returnUnlessPays): "For each opponent, you mill a card, then return that
 * card from your graveyard to your hand unless that player pays 3 life.": for each opponent in turn you mill one card, and that opponent may pay life to stop you returning it.
 *
 * `putsCardOfTheirChoiceUnderYourControl` (CR 608.2d, 110.2, 108.3; Visions of Dread, eff.edhd62.player.putsCardOfTheirChoice.fromTheirGraveyard.underYourControl): "Target opponent puts a creature card
 * of their choice from their graveyard onto the battlefield under your control.": the named player chooses one card of a description in their own graveyard (`chooseObjects`, the player's
 * own choice), and the card enters under the control of the ability's controller.
 */
import type { EffectStep, ObjRef } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { cloneState, type RenderState } from './state';
import { lasting } from './stat';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function nextTurnEachMustAttack(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'effect' || s.guard !== undefined || s.as !== undefined || s.effects.length !== 1 || s.duration?.d !== 'duringNextTurn' || s.duration.turn !== undefined || s.duration.whose === undefined) return null;
  const whose = s.duration.whose;
  if (whose.ref !== 'target') return null;
  const e = s.effects[0]!;
  if (e.s !== 'restrict' || e.mode !== 'mustIfAble' || e.action !== 'attack' || !Object.keys(e).every((k) => ['s', 'subject', 'mode', 'action'].includes(k))) return null;
  const sub = e.subject as { ref?: string; filter?: unknown };
  if (sub.ref !== 'each' || !same(sub.filter, { types: ['Creature'], controller: whose })) return null;
  const who = K.player(whose, st, 'possessive');
  return { clauses: [plain(`during ${who.text} next turn, each creature that player controls attacks if able`, { standalone: true })], consumed: 1 };
}

function eachBasePtLoseAll(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'effect' || s.guard !== undefined || s.as !== undefined || s.duration === undefined || s.duration.d === 'permanent' || s.effects.length !== 1) return null;
  const e = s.effects[0]!;
  if (e.s !== 'continuous' || e.cda === true || e.mods.length !== 2 || !('ref' in e.affects) || e.affects.ref !== 'target') return null; // targets only: a group ("creatures target player controls lose all abilities and have ...", edh-b-12) keeps its own reading
  const [a, b] = e.mods as unknown as [Record<string, unknown>, Record<string, unknown>];
  if (!same(a, { layer: 6, removeAll: true }) || b.layer !== '7b' || typeof b.power !== 'number' || typeof b.toughness !== 'number' || Object.keys(b).length !== 3) return null;
  if (!K.obj(e.affects as ObjRef, cloneState(st), 'subject').plural) return null; // a probe on a copy: naming an object changes how later words say it
  const who = K.obj(e.affects as ObjRef, st, 'subject');
  return { clauses: [plain(lasting(`${who.text} each have base power and toughness ${b.power}/${b.toughness} and lose all abilities`, s.duration, st), { standalone: true })], consumed: 1 };
}

function forEachOppMillReturnUnlessPays(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'forEach' || s.guard !== undefined || s.gather !== undefined || s.as !== 'opp' || !same(s.over, { ref: 'each', who: 'opponent' }) || s.do.length !== 2) return null;
  const pay = s.do[1];
  if (pay?.op !== 'pay' || pay.cost.other?.length !== 1) return null;
  const life = pay.cost.other[0]!;
  if (life.kind !== 'payLife' || typeof life.amount !== 'number') return null;
  const expected = [
    { op: 'mill', who: { ref: 'you' }, count: 1, as: 'milled' },
    { op: 'pay', who: { ref: 'iterating' }, cost: { other: [{ kind: 'payLife', amount: life.amount }] }, else: [{ op: 'move', what: { ref: 'each', filter: { is: { ref: 'bound', name: 'milled' }, zone: 'graveyard', owner: 'you' } }, to: { zone: 'hand' } }] },
  ];
  if (!same(s.do, expected)) return null;
  void st;
  return { clauses: [plain(`for each opponent, you mill a card, then return that card from your graveyard to your hand unless that player pays ${life.amount} life`, { standalone: true })], consumed: 1 };
}

function putsCardOfTheirChoiceUnderYourControl(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  const m = list[i + 1];
  if (c?.op !== 'chooseObjects' || m?.op !== 'move' || c.guard !== undefined || m.guard !== undefined || c.as === undefined || c.min !== 1 || c.max !== 1) return null;
  if (c.who.ref !== 'target' || !same(m.what, { ref: 'bound', name: c.as }) || !same(m.to, { zone: 'battlefield', controller: { ref: 'you' } }) || m.as !== undefined) return null;
  if (c.from.ref !== 'each' || !('filter' in c.from)) return null;
  const f = c.from.filter as { anyOf?: Record<string, unknown>[]; isCard?: boolean; zone?: unknown; owner?: unknown };
  if (f.isCard !== true || f.zone !== 'graveyard' || !same(f.owner, c.who) || f.anyOf?.length !== 1 || Object.keys(f).length !== 4) return null;
  const kind = f.anyOf[0]!;
  if (Object.keys(kind).length !== 1 || (kind.types === undefined && kind.subtypes === undefined)) return null;
  const who = K.player(c.who, st, 'subject');
  const noun = K.np(kind, st, { det: 'none' });
  return { clauses: [plain(`${who.text} puts a ${noun} card of their choice from their graveyard onto the battlefield under your control`, { standalone: true })], consumed: 2 };
}

/** The folds of edh-d-62 (render/fold.ts#foldAt). */
export function foldEdhD62(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return nextTurnEachMustAttack(list, i, st) ?? eachBasePtLoseAll(list, i, st) ?? forEachOppMillReturnUnlessPays(list, i, st) ?? putsCardOfTheirChoiceUnderYourControl(list, i, st);
}
