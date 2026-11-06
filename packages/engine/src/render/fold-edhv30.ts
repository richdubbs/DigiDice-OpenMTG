/**
 * edh-c-30 (Commander lane edh-c): the folds of its templates (parser/templates/zz-cloud/edh-c-30.json), called from render/fold.ts#foldAtPlain. Each applies only when every part is
 * exactly what the idiom says.
 *
 * `twoIfSpent` (CR 601.2h, 106.1, 608.2c; Firespout, Moonhold; eff.edhv30.damage.eachFilter.ifSpent.andEachFilter.ifSpent, eff.edhv30.player.cant.playLands.ifSpent.cantCast.ifSpent): two
 * instructions of one spell that each carry the condition "{R} was spent to cast ~" are printed as ONE sentence, each instruction followed by its own condition and joined by "and":
 * "~ deals 3 damage to each creature without flying if {R} was spent to cast ~ and 3 damage to each creature with flying if {G} was spent to cast ~." The second instruction keeps no
 * subject of its own (the same source deals the damage; the same player can't). Exactly two steps, both guarded by a `wasCast` condition of the spell itself with a mana color.
 */
import type { Condition, EffectStep, ObjRef } from '../types/ability';
import type { Folded } from './fold';
import { K } from './kernel';
import { plain } from './clause';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The guard `wasCast` of the spell itself with a mana color spent and nothing else. */
const spentGuard = (g: Condition | undefined): g is Condition =>
  g !== undefined && (g as { cond?: string }).cond === 'wasCast' && Object.keys(g).sort().join() === 'cond,spent';

function twoIfSpent(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a === undefined || b === undefined || a.op !== b.op || !spentGuard(a.guard) || !spentGuard(b.guard) || same(a.guard, b.guard)) return null;
  if (a.op === 'damage' && b.op === 'damage') {
    if (!same(a.source, b.source) || a.source.ref !== 'self' || a.to.ref !== 'each' || b.to.ref !== 'each' || a.as !== undefined || b.as !== undefined || a.divided !== undefined || b.divided !== undefined) return null;
    if (!K.isNumber(a.amount) || !K.isNumber(b.amount) || Object.keys(a).length !== 5 || Object.keys(b).length !== 5) return null;
    const to = (s: typeof a): string => K.obj(s.to as ObjRef, st, 'object', { prefer: 'each' }).text;
    const text = `${K.obj(a.source, st, 'subject').text} deals ${K.qty(a.amount, st)} damage to ${to(a)} if ${K.cond(a.guard, st)} and ${K.qty(b.amount, st)} damage to ${to(b)} if ${K.cond(b.guard, st)}`;
    return { clauses: [plain(text, { standalone: true })], consumed: 2 };
  }
  if (a.op === 'effect' && b.op === 'effect') {
    const [x, y] = [a.effects[0], b.effects[0]];
    if (a.effects.length !== 1 || b.effects.length !== 1 || x?.s !== 'restrict' || y?.s !== 'restrict' || x.mode !== 'cant' || y.mode !== 'cant' || x.action !== 'playLand' || y.action !== 'cast') return null;
    if (!same(x.subject, y.subject) || x.subject.ref !== 'target' || a.duration.d !== 'endOfTurn' || b.duration.d !== 'endOfTurn' || Object.keys(a).length !== 4 || Object.keys(b).length !== 4) return null;
    if (Object.keys(x).length !== 4 || Object.keys(y).length !== 5 || y.other === undefined) return null;
    const first = K.clause({ ...a, guard: undefined } as EffectStep, st);
    if (first.empty === true) return null;
    const what = K.np(y.other, st, { det: 'none', plural: true, noZone: true });
    return { clauses: [plain(`${first.sub} if ${K.cond(a.guard, st)} and can't cast ${what} this turn if ${K.cond(b.guard, st)}`, { standalone: true })], consumed: 2 };
  }
  return null;
}

/** The folds of edh-c-30's templates (render/fold.ts#foldAtPlain). */
export function foldEdhV30(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return twoIfSpent(list, i, st);
}
