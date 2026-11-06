/**
 * edh-c-18: the folds of its templates (parser/templates/zz-cloud/edh-c-18.json), called from render/fold.ts#foldAt. Each one reads exactly the shape its own template builds and nothing else.
 *
 * `playerUntapsOneTheyControl` (CR 701.26b, 608.2d, 109.4; Rising Waters, eff.edhv18.player.untaps.one.theyControl): "that player untaps a land they control.": the player the sentence names
 * chooses one permanent of a description among those they control as the effect resolves, and it untaps (the choice and the untap, as `chooseObjects` then `untap` of what was chosen).
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function playerUntapsOneTheyControl(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  const u = list[i + 1];
  if (c?.op !== 'chooseObjects' || u?.op !== 'untap' || c.as === undefined || c.random !== undefined || c.guard !== undefined || c.groupLimit !== undefined || c.perPlayer !== undefined) return null;
  if (c.link !== undefined || c.startingWith !== undefined || c.min !== 1 || c.max !== 1 || c.who.ref === 'you' || c.who.ref === 'each' || c.who.ref === 'eachWho' || c.who.ref === 'controlsMost' || c.who.ref === 'controlsAny' || c.who.ref === 'attackedBySource' || c.from.ref !== 'each' || !('filter' in c.from)) return null;
  if (u.guard !== undefined || u.as !== undefined || !same(u.what, { ref: 'bound', name: c.as })) return null;
  const f = c.from.filter;
  if (Object.keys(f).length !== 2 || f.anyOf?.length !== 1 || !same(f.controller, c.who)) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"${c.as}"`))) return null;
  const subj = K.player(c.who, st, 'subject').text;
  return { clauses: [plain(`${subj} untaps ${K.np(f.anyOf[0]!, st, { det: 'a' })} they control`, { standalone: true })], consumed: 2 };
}

export function foldEdhV18(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return playerUntapsOneTheyControl(list, i, st);
}
