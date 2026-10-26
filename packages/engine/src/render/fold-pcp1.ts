/**
 * Round pc-players-1 (precon lane pc-players): the fold of the steps its templates build (render/fold.ts#foldAt tries `foldPcPlayers1` after the other slices' own folds).
 * A fold applies only when every part is exactly what the idiom says.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { bind } from './steps-util';
import { numWord } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const ITERATING = { ref: 'iterating' };
const EACH_PLAYER = { ref: 'each', who: 'player' };

/**
 * "Each player chooses a creature they control. Destroy the rest." (Divine Reckoning; CR 101.4, 608.2d, 701.8a): every player, in APNAP order, chooses exactly N of their
 * own permanents of a kind (all of them when they have N or fewer), then every other permanent of that kind, whoever controls it, is destroyed. Exactly the two steps of
 * template eff.pcp1.eachPlayer.chooses.destroyRest.
 */
function eachChoosesDestroyRest(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || a.guard !== undefined || a.random === true || a.groupLimit !== undefined || a.as === undefined || typeof a.min !== 'number' || a.min !== a.max || a.min < 1) return null;
  if (!same(a.who, ITERATING) || !same(a.perPlayer, EACH_PLAYER) || a.from.ref !== 'each' || !('filter' in a.from)) return null;
  const f = a.from.filter;
  const kinds = f.anyOf;
  if (kinds?.length !== 1 || !same(f.controller, ITERATING) || Object.keys(f).length !== 2) return null;
  if (b?.op !== 'destroy' || b.guard !== undefined || b.regeneration !== undefined || b.as !== undefined || b.what.ref !== 'each') return null;
  if (!same(b.what.filter, { anyOf: kinds, not: { is: { ref: 'bound', name: a.as } } })) return null;
  const n = a.min;
  const things = n === 1 ? K.np(kinds[0]!, st, { det: 'a' }) : `${numWord(n)} ${K.np(kinds[0]!, st, { det: 'none', plural: true })}`;
  bind(st, a.as, { nouns: K.nounsOf(kinds[0]!), plural: n !== 1 });
  return { clauses: [plain(`each player chooses ${things} they control. destroy the rest`, { standalone: true })], consumed: 2 };
}

/** The folds of pc-players-1 (render/fold.ts#foldAt). */
export function foldPcPlayers1(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return eachChoosesDestroyRest(list, i, st);
}
