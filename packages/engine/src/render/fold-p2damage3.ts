/**
 * p2-damage-3 (lane p2-damage): the folds of its templates (parser/templates/zz-cloud/p2-damage-3.json), called from render/fold.ts#foldAt.
 *
 * `damageToRandomObject` (CR 608.2d, 120.3): "<source> deals N damage to a <description> chosen at random" (Cinderheart Giant; the parser's
 * eff.p2damage3.damage.toRandomObject): one object of the description chosen at random (no player decides), then the damage to exactly that object. Only that exact
 * shape: one choice by you, at random, of exactly one object of a group with one description, then one damage step to exactly the chosen object and nothing else.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

function damageToRandomObject(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || a.random !== true || a.who.ref !== 'you' || a.min !== 1 || a.max !== 1 || a.from.ref !== 'each' || !('filter' in a.from) || a.guard !== undefined) return null;
  if (a.groupLimit !== undefined || a.perPlayer !== undefined || a.startingWith !== undefined || a.eachCardType !== undefined || a.link !== undefined || a.distinct !== undefined) return null;
  if (b?.op !== 'damage' || b.to.ref !== 'bound' || b.to.name !== a.as || b.guard !== undefined || b.as !== undefined || b.also !== undefined || b.divided !== undefined || b.perSource !== undefined) return null;
  if (JSON.stringify(list.slice(i + 2)).includes(`"name":"${a.as}"`)) return null; // the chosen object is named again later: not this fold
  const { to: _to, ...rest } = b;
  const said = K.steps([{ ...rest, to: { ref: 'self' } } as EffectStep], st);
  const self = K.obj({ ref: 'self' }, st, 'object').text;
  const at = said.lastIndexOf(` to ${self}`);
  if (at < 0) return null;
  const text = `${said.slice(0, at)} to ${K.np(a.from.filter, st, { det: 'a' })} chosen at random${said.slice(at + ` to ${self}`.length)}`;
  return { clauses: [plain(text, { standalone: true })], consumed: 2 };
}

export function foldP2Damage3(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return damageToRandomObject(list, i, st);
}
