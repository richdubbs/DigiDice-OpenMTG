/**
 * p2-damage-2 (lane p2-damage): the folds of its templates (parser/templates/zz-cloud/p2-damage-2.json), called from render/fold.ts#foldAt.
 *
 * `tokensFightThoseCreatures` (CR 701.14a, 608.2d, 111.1): "For each <creature description>, create <a token>. Each of those tokens fights a different one of those
 * creatures." (Ezuri's Predation; the parser's eff.p2damage2.forEach.token.fightsDifferent): one token for each creature of the description, then each token fights a
 * different creature of it (`fight` `pairs`). Only that exact shape: a token count that is the number of the very creatures the fight names, and the fight of the
 * tokens the create step bound.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

function tokensFightThoseCreatures(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'createToken' || b?.op !== 'fight' || b.pairs !== true || a.as === undefined || a.guard !== undefined || b.guard !== undefined || b.as !== undefined) return null;
  const count = a.count as unknown;
  if (typeof count !== 'object' || count === null || (count as { q?: string }).q !== 'count') return null;
  const of = (count as { of: unknown }).of;
  if (b.a.ref !== 'bound' || b.a.name !== a.as || JSON.stringify(b.b) !== JSON.stringify(of) || b.b.ref !== 'each' || !('filter' in b.b) || b.b.filter.types?.length !== 1 || b.b.filter.types[0] !== 'Creature') return null;
  if (JSON.stringify(list.slice(i + 2)).includes(`"name":"${a.as}"`)) return null; // the tokens are named again later: not this fold
  const { as: _as, ...create } = a;
  const first = K.steps([create as EffectStep], st);
  return { clauses: [plain(`${first}. each of those tokens fights a different one of those creatures`, { standalone: true })], consumed: 2 };
}

export function foldP2Damage2(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return tokensFightThoseCreatures(list, i, st);
}
