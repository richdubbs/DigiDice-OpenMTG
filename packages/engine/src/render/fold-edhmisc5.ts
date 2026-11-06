/**
 * edh-misc-5 (Commander lane edh-misc): the folds of its templates (parser/templates/zz-cloud/edh-misc-5.json), called from render/fold.ts#foldAt.
 *
 * `manifestFromHand` (CR 701.40a, 701.40e, 400.2; eff.edhx5.manifest.fromHand; Scroll of Fate): "manifest a card from your hand": the controller chooses exactly one card
 * of their hand, no target, then manifests it (the native action over the chosen card). Only that shape: one choice by "you" of one card of your own hand, then the
 * `manifest` action of "you" on what was chosen, and nothing after it reading the choice.
 */
import type { EffectStep, ObjRef } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import type { RenderState } from './state';

const boundTo = (r: unknown, name: string | undefined): boolean => (r as ObjRef | null | undefined)?.ref === 'bound' && name !== undefined && (r as { name: string }).name === name;

function manifestFromHand(list: EffectStep[], i: number): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'action' || b.action !== 'manifest' || a.random === true || a.guard !== undefined || b.guard !== undefined || b.as !== undefined) return null;
  if (a.who.ref !== 'you' || a.min !== 1 || a.max !== 1 || a.groupLimit !== undefined || a.perPlayer !== undefined || a.as === undefined || !boundTo(b.subject, a.as)) return null;
  if (b.who.ref !== 'you' || b.n !== undefined || b.arg !== undefined || b.choices !== undefined) return null;
  if (a.from.ref !== 'each' || JSON.stringify(a.from.filter) !== '{"zone":"hand","owner":"you","isCard":true}') return null;
  if (JSON.stringify(list.slice(i + 2)).includes(`"name":"${a.as}"`)) return null;
  return { clauses: [plain('manifest a card from your hand')], consumed: 2 };
}

/**
 * `extraBeginningPhase` (CR 500.8, 500.10, 501.1; eff.edhx5.extraBeginningPhase; Sphinx of the Second Sun): "there is an additional beginning phase after this phase" is the
 * three additional steps of a beginning phase, added after this phase in the order draw, upkeep, untap (the most recently created step occurs first, CR 500.9, so the
 * untap step begins first). Only that shape: three `extraStep`s after the phase, one each, no count.
 */
function extraBeginningPhase(list: EffectStep[], i: number): Folded | null {
  const want = ['draw', 'upkeep', 'untap'];
  for (let k = 0; k < 3; k++) {
    const s = list[i + k];
    if (s?.op !== 'extraStep' || s.step !== want[k] || s.afterPhase !== true || s.count !== undefined || s.guard !== undefined) return null;
  }
  return { clauses: [plain('there is an additional beginning phase after this phase')], consumed: 3 };
}

export function foldEdhMisc5(list: EffectStep[], i: number, _st: RenderState): Folded | null {
  return manifestFromHand(list, i) ?? extraBeginningPhase(list, i);
}
