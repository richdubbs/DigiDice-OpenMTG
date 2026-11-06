/**
 * edh-d-25 (Commander coordinator D, lane combat): the fold of its template eff.edhd25.group.assignUnblocked.thisTurn (parser/templates/zz-cloud/edh-d-25.json), called from render/fold.ts#foldAt.
 *
 * (CR 510.1b-c, 609.4, 611.2a, 608.2d; Predatory Focus): "You may have creatures you control assign their combat damage this turn as though they weren't blocked.": the controller chooses
 * as the effect resolves (Scryfall ruling 2008-04-01: "When Predatory Focus resolves, you choose whether to use its effect or not"); if they do, a permission with no further choice (`mandatory`)
 * lets every creature the description matches, at damage time, assign all its combat damage to what it attacks, for the rest of the turn.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { alt } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function mayAssignUnblockedThisTurn(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'may' || s.guard !== undefined || s.otherwise !== undefined || s.anyOne !== undefined || s.villainous !== undefined || s.gather !== undefined || !same(s.who, { ref: 'you' }) || s.do.length !== 1) return null;
  const e = s.do[0]!;
  if (e.op !== 'effect' || e.guard !== undefined || e.effects.length !== 1 || !same(e.duration, { d: 'endOfTurn' }) || Object.keys(e).sort().join(',') !== 'duration,effects,op') return null;
  const p = e.effects[0]!;
  if (p.s !== 'permit' || p.action !== 'assignAsUnblocked' || p.mandatory !== true || !same(p.who, { ref: 'you' }) || p.of === undefined || p.of.controller !== 'you' || p.of.attachedToSource === true) return null;
  const group = K.np(p.of, st, { det: 'none', plural: true });
  return {
    clauses: [plain(alt(`you may have ${group} assign their combat damage this turn as though they weren't blocked`, `you may have ${group} assign their combat damage as though they weren't blocked this turn`), { standalone: true })],
    consumed: 1,
  };
}

/** The folds of edh-d-25 (render/fold.ts#foldAt). */
export function foldEdhD25(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return mayAssignUnblockedThisTurn(list, i, st);
}
