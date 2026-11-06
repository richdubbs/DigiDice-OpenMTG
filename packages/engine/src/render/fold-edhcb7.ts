/**
 * edh-combat-7 (Commander lane edh-combat): the folds of its templates (parser/templates/zz-cloud/edh-combat-7.json), called from render/fold.ts#foldAt.
 *
 * `removeAttackersExtraCombat` (CR 506.4, 500.8, 508.1d, 603.7a; eff.edhcb7.removeAttackersExtraCombat; Illusionist's Gambit): "Remove all attacking creatures from combat and untap them.
 * After this phase, there is an additional combat phase. Each of those creatures attacks that combat if able. They can't attack you or planeswalkers you control that combat." is
 * four steps: the removal of a group from combat (the creatures it names are kept as `those`), their untapping, the added combat phase, and a delayed trigger of the beginning of
 * that combat that makes them attack if able and keeps them from attacking you or your planeswalkers until its end. Only that shape.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import { K } from './kernel';
import type { RenderState } from './state';
import type { Folded } from './fold';

/** The step without the display data (`sentence`, `span`) every parsed step carries. */
const bare = (s: EffectStep | undefined): string => JSON.stringify(s, (k, v: unknown) => (k === 'sentence' || k === 'span' ? undefined : v));

const THOSE = { ref: 'bound', name: 'those' };
const UNTAP = { op: 'untap', what: THOSE };
const EXTRA = { op: 'extraPhase', phase: 'combat' };
const DELAY = {
  op: 'delay', when: { at: 'step', step: 'beginCombat', phase: 'added' }, duration: { d: 'endOfTurn' }, once: true,
  do: [{
    op: 'effect', duration: { d: 'endOfCombat' },
    effects: [
      { s: 'restrict', subject: THOSE, mode: 'mustIfAble', action: 'attack' },
      { s: 'restrict', subject: THOSE, mode: 'cant', action: 'attackPlayer', otherPlayer: { ref: 'you' } },
      { s: 'restrict', subject: THOSE, mode: 'cant', action: 'attack', other: { types: ['Planeswalker'], controller: 'you' } },
    ],
  }],
  capture: ['those'], // (the lowering names the bindings a delayed trigger keeps)
};

function removeAttackersExtraCombat(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const first = list[i];
  if (first?.op !== 'removeFromCombat' || first.as !== 'those' || first.guard !== undefined) return null;
  const want = [UNTAP, EXTRA, DELAY];
  for (let k = 0; k < want.length; k++) if (bare(list[i + 1 + k]) !== JSON.stringify(want[k])) return null;
  const text = `remove ${K.obj(first.what, st, 'object').text} from combat and untap them. after this phase, there is an additional combat phase. each of those creatures attacks that combat if able. they can't attack you or planeswalkers you control that combat`;
  return { clauses: [plain(text, { standalone: true })], consumed: want.length + 1 };
}

export function foldEdhCb7(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return removeAttackersExtraCombat(list, i, st);
}
