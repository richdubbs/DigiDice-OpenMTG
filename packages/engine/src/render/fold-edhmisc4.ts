/**
 * edh-misc-4 (Commander lane edh-misc): the folds of its templates (parser/templates/zz-cloud/edh-misc-4.json), called from render/fold.ts#foldAt. CR cites from the
 * Comprehensive Rules of 2026-09-25 (checked against the text) unless marked unverified.
 *
 * `doubleUnspentMana` (CR 106.4, 106.1; Doubling Cube): "Double the amount of each type of unspent mana you have.": one addition of mana for each of the six types of mana,
 * as much of the type as the controller has unspent of it (read when that step runs; adding one type never changes the amount of another). Only that exact list of six
 * steps in the order white, blue, black, red, green, colorless, each with nothing else on it.
 *
 * `proliferateThenChoose` (CR 701.34a, 608.2c, 608.2d; Ripples of Potential): "Proliferate, then choose any number of permanents you control that had a counter put on them
 * this way.": the proliferate (naming the permanents that got a counter) and the choice of any number of those permanents that you control; the choice is the plural
 * "those permanents" of the sentence after it. Only that exact pair.
 */
import type { EffectStep } from '../types/ability';
import type { ManaType } from '../types/mana';
import { plain } from './clause';
import type { Folded } from './fold';
import type { RenderState } from './state';
import { bind } from './steps-util';

const TYPES: readonly ManaType[] = ['W', 'U', 'B', 'R', 'G', 'C'];
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function doubleUnspentMana(list: EffectStep[], i: number): Folded | null {
  for (let k = 0; k < TYPES.length; k++) {
    const s = list[i + k];
    const type = TYPES[k]!;
    if (s?.op !== 'addMana' || s.guard !== undefined || s.as !== undefined || s.units !== undefined || s.restriction !== undefined || s.keep !== undefined || s.link !== undefined) return null;
    if (!same(s.who, { ref: 'you' }) || !same(s.dynamic, { kind: 'ofType', type, count: { q: 'unspentMana', type } })) return null;
  }
  return { clauses: [plain('double the amount of each type of unspent mana you have', { standalone: true })], consumed: TYPES.length };
}

function proliferateThenChoose(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, c] = [list[i], list[i + 1]];
  if (a?.op !== 'action' || a.action !== 'proliferate' || a.as === undefined || c?.op !== 'chooseObjects' || c.as === undefined) return null;
  if (a.guard !== undefined || a.who.ref !== 'you' || a.n !== undefined || a.span !== undefined || c.guard !== undefined || c.min !== 0 || c.max !== 'any' || c.who.ref !== 'you') return null;
  if (!same(c.from, { ref: 'each', filter: { controller: 'you', is: { ref: 'bound', name: a.as } } }) || Object.keys(c).some((k) => !['op', 'who', 'from', 'min', 'max', 'as'].includes(k))) return null;
  bind(st, c.as, { nouns: ['permanent'], plural: true });
  return { clauses: [plain('proliferate, then choose any number of permanents you control that had a counter put on them this way', { standalone: true })], consumed: 2 };
}

export function foldEdhMisc4(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return doubleUnspentMana(list, i) ?? proliferateThenChoose(list, i, st);
}
