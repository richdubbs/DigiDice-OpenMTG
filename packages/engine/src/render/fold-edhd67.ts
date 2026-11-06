/**
 * edh-d-67 (coordinator D, lane prevent-r2): the folds of its templates (parser/templates/zz-cloud/edh-d-67.json), called from render/fold.ts#foldAt. As every fold, one applies only
 * when every part is exactly what the idiom says (same source, nothing else in between). CR cites from memory, unverified where marked in the round's record.
 *
 * `targetAndEachOtherSameController` (CR 120.3, 109.4, 608.2b; Fear, Fire, Foes!; eff.edhd67.damage.targetAndEachOtherSameController): "~ deals X damage to target creature and 1 damage to
 * each other creature with the same controller." Two damage steps of one source: the first to the object, the second to each other creature its controller controls.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function targetAndEachOtherSameController(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'damage' || b?.op !== 'damage' || !same(a.source, b.source) || a.to.ref !== 'target' || b.to.ref !== 'each' || !('filter' in b.to)) return null;
  if (a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined || a.divided !== undefined || b.divided !== undefined) return null;
  if (Object.keys(a).sort().join() !== 'amount,op,source,to' || Object.keys(b).sort().join() !== 'amount,op,source,to') return null;
  if (!same(b.to.filter, { types: ['Creature'], controller: { ref: 'controllerOf', object: a.to }, not: { is: a.to } })) return null;
  const source = K.obj(a.source, st, 'subject').text;
  const first = K.qty(a.amount, st);
  const target = K.obj(a.to, st, 'object').text;
  const second = K.qty(b.amount, st);
  return { clauses: [plain(`${source} deals ${first} damage to ${target} and ${second} damage to each other creature with the same controller`, { standalone: true })], consumed: 2 };
}

/**
 * `chooseSourceFlipDoubleOrPrevent` (CR 609.7a, 705.1-705.2, 615.7, 615.8, 614.1a; Desperate Gambit; templates eff.edhd67.choose.sourceYouControl, eff.r3mech.flipCoin, eff.edhd67.nextTime.objDeals.double and
 * eff.p2rd4.prevent.nextTime.objWouldDeal): "Choose a source you control and flip a coin. If you win the flip, the next time that source would deal damage this turn, it deals double that damage
 * instead. If you lose the flip, the next time it would deal damage this turn, prevent that damage." A choice of one source you control (the objects that can be the source of damage, `damageSource`),
 * then the flip, whose two results are one-use shields on the damage that very source would deal, for the same duration. Only that whole shape.
 */
function chooseSourceFlipDoubleOrPrevent(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [c, f] = [list[i], list[i + 1]];
  if (c?.op !== 'chooseObjects' || f?.op !== 'flipCoin' || c.as === undefined || c.damageSource !== true || c.min !== 1 || c.max !== 1 || c.guard !== undefined || c.random !== undefined) return null;
  if (!same(c.who, { ref: 'you' }) || c.from.ref !== 'each' || !('filter' in c.from) || !same(c.from.filter, { zone: ['battlefield', 'stack', 'command'], controller: 'you' })) return null;
  if (Object.keys(c).filter((k) => (c as unknown as Record<string, unknown>)[k] !== undefined).sort().join() !== 'as,damageSource,from,max,min,op,who') return null;
  if (Object.keys(f).filter((k) => (f as unknown as Record<string, unknown>)[k] !== undefined).sort().join() !== 'onLose,onWin,op,who' || !same(f.who, { ref: 'you' })) return null;
  const [w, l] = [f.onWin?.[0], f.onLose?.[0]];
  if (f.onWin?.length !== 1 || f.onLose?.length !== 1 || w?.op !== 'effect' || l?.op !== 'effect' || !same(w.duration, l.duration) || w.guard !== undefined || l.guard !== undefined || w.as !== undefined || l.as !== undefined) return null;
  if (Object.keys(w).sort().join() !== 'duration,effects,op' || Object.keys(l).sort().join() !== 'duration,effects,op') return null;
  const source = { is: { ref: 'bound', name: c.as } };
  const shield = { uses: 1 };
  if (!same(w.effects, [{ s: 'replace', replaces: { ev: 'damage', source }, body: { b: 'modify', amount: { mul: 2 } }, shield }])) return null;
  if (!same(l.effects, [{ s: 'replace', replaces: { ev: 'damage', source }, body: { b: 'prevent', amount: 'all' }, shield }])) return null;
  if (!same(w.duration, { d: 'endOfTurn' })) return null;
  const dur = 'this turn';
  void st;
  const text = `choose a source you control and flip a coin. if you win the flip, the next time that source would deal damage ${dur}, it deals double that damage instead. if you lose the flip, the next time it would deal damage ${dur}, prevent that damage`;
  return { clauses: [plain(text, { standalone: true })], consumed: 2 };
}

/** The folds of edh-d-67's templates (render/fold.ts#foldAt). */
export function foldEdhD67(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return targetAndEachOtherSameController(list, i, st) ?? chooseSourceFlipDoubleOrPrevent(list, i, st);
}
