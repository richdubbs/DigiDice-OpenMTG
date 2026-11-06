/**
 * Must-finish round edh-next-139 (group tokens): the folds of the steps its templates build (render/fold.ts#foldAt tries `foldEdhN139` after the other slices' own folds). A fold
 * applies only when every part is exactly what the idiom says. This file imports no value from render/fold.ts (an import cycle); it takes the types only.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { cloneState, type RenderState } from './state';
import { tokenText } from './steps-zones';

const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, x]) => [k, canon(x)])) : v);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

const PAY_LIFE_IN_TURN = { op: 'pay', who: { ref: 'each', who: 'player' }, startingWith: { ref: 'you' }, cost: { other: [{ kind: 'payLife', amount: 1 }] }, anyAmount: true, as: 'lifePaid', link: 'lifePaid' };
const UNTIL_NO_ONE_PAID = { cond: 'did', step: 'lifePaid', not: true };

/**
 * `payLifeUntilNoOne` (CR 101.4, 119.4, 608.2c; Plague of Vermin, templates eff.edhn139.startingWithYou.eachPlayer.mayPayAnyLife and eff.edhn139.repeatProcess.untilNoOnePaysLife):
 * "Starting with you, each player may pay any amount of life. Repeat this process until no one pays life." Exactly that repeat of that one payment.
 */
function payLifeUntilNoOne(list: EffectStep[], i: number): Folded | null {
  const r = list[i];
  if (r?.op !== 'repeat' || r.guard !== undefined || r.process !== true || r.times !== 1 || r.do.length !== 1 || !same(r.do[0], PAY_LIFE_IN_TURN) || !same(r.until, UNTIL_NO_ONE_PAID)) return null;
  if (Object.keys(r).some((k) => !['op', 'times', 'do', 'process', 'until'].includes(k))) return null;
  return { clauses: [plain('starting with you, each player may pay any amount of life', { standalone: true }), plain('repeat this process until no one pays life', { standalone: true })], consumed: 1 };
}

/**
 * `tokensForLifePaid` (CR 111.1, 608.2c-d; Plague of Vermin, template eff.edhn139.eachPlayer.createsToken.forEachLifeTheyPaid): "Each player creates a 1/1 black Rat creature token for
 * each 1 life they paid this way." Only after the payment it counts, in the same list.
 */
function tokensForLifePaid(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  if (c?.op !== 'createToken' || c.guard !== undefined || c.as !== undefined || !same(c.who, { ref: 'each', who: 'player' }) || !same(c.count, { q: 'chosenNumber', link: 'lifePaid', of: { ref: 'iterating' } })) return null;
  if (Object.keys(c).some((k) => !['op', 'who', 'count', 'token'].includes(k))) return null;
  if (!list.slice(0, i).some((x) => x.op === 'repeat' && x.do.some((y) => same(y, PAY_LIFE_IN_TURN)))) return null;
  const tk = tokenText(c.token, 1, false, cloneState(st));
  return { clauses: [plain(`each player creates ${tk} for each 1 life they paid this way`, { standalone: true })], consumed: 1 };
}

/**
 * `tappedTradeDamage` (CR 608.2c, 608.2d, 120.2b, 120.3; Master of the Wild Hunt, template eff.edhn139.eachWolfTapped.dealsPower.targetDividesBack): "Each Wolf tapped this way deals damage
 * equal to its power to target creature. That creature deals damage equal to its power divided as its controller chooses among any number of those Wolves." Exactly the two damage steps
 * after the tap step that binds what it tapped (`tappedThisWay`).
 */
function tappedTradeDamage(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [tap, a, b] = [list[i - 1], list[i], list[i + 1]];
  if (tap?.op !== 'tap' || tap.as !== 'tappedThisWay' || a?.op !== 'damage' || b?.op !== 'damage' || a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined) return null;
  const src = a.source as { ref: string; name?: string; which?: object };
  const to = b.to as { ref: string; name?: string; which?: object };
  if (src.ref !== 'bound' || src.name !== 'tappedThisWay' || src.which === undefined || to.ref !== 'bound' || to.name !== 'tappedThisWay' || to.which === undefined) return null;
  if (a.perSource !== true || a.divided !== undefined || !same(a.amount, { q: 'stat', stat: 'power', of: { ref: 'subject' } }) || Object.keys(a).some((k) => !['op', 'source', 'to', 'amount', 'perSource'].includes(k))) return null;
  if (a.to.ref !== 'target' || !same(b.source, a.to) || b.divided !== 'bySourceController' || !same(b.amount, { q: 'stat', stat: 'power', of: a.to }) || Object.keys(b).some((k) => !['op', 'source', 'to', 'amount', 'divided'].includes(k))) return null;
  const one = K.np(src.which as never, cloneState(st), { det: 'none' });
  const many = K.np(to.which as never, cloneState(st), { det: 'none', plural: true });
  const target = K.obj(a.to, cloneState(st), 'object').text;
  return {
    clauses: [
      plain(`each ${one} tapped this way deals damage equal to its power to ${target}`, { standalone: true }),
      plain(`that creature deals damage equal to its power divided as its controller chooses among any number of those ${many}`, { standalone: true }),
    ],
    consumed: 2,
  };
}

export function foldEdhN139(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return payLifeUntilNoOne(list, i) ?? tokensForLifePaid(list, i, st) ?? tappedTradeDamage(list, i, st);
}
