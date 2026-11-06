/**
 * edh-top-16: the folds of its readings, called from render/fold.ts#foldAt.
 *
 * `cantAttackHighestRollers` (CR 706.2, 508.1b, 508.1c, 608.2c; Chaos Dragon): "If one or more opponents had the highest result, ~ can't attack those players or planeswalkers they control this
 * combat.": for each opponent bound by an earlier "each player rolls a d20" (rollDie `highest`), until end of combat the object can't attack that player or a planeswalker that player controls.
 * Exactly the step of template eff.edht16.self.cantAttackHighestRollers.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function cantAttackHighestRollers(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'forEach' || s.guard !== undefined || s.as !== 'restricted' || s.over.ref !== 'bound' || s.do.length !== 1) return null;
  const e = s.do[0];
  if (e?.op !== 'effect' || !same(e.duration, { d: 'endOfCombat' }) || e.effects.length !== 2) return null;
  const [a, b] = e.effects;
  const self = { ref: 'self' };
  if (!same(a, { s: 'restrict', subject: self, mode: 'cant', action: 'attackPlayer', otherPlayer: { ref: 'iterating' } })) return null;
  if (!same(b, { s: 'restrict', subject: self, mode: 'cant', action: 'attack', other: { types: ['Planeswalker'], controller: { ref: 'iterating' } } })) return null;
  const me = K.obj(self as never, st, 'subject').text;
  return { clauses: [plain(`if one or more opponents had the highest result, ${me} can't attack those players or planeswalkers they control this combat`, { standalone: true })], consumed: 1 };
}

export function foldEdhT16(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return cantAttackHighestRollers(list, i, st);
}
