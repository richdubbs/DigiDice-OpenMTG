/**
 * edh-d-58 (Commander coordinator D, lane exile-play, fourth pass): the folds of its templates (parser/templates/zz-cloud/edh-d-58.json), called from render/fold.ts#foldAt. Each applies
 * only when every part is exactly what the idiom says.
 *
 * `exileAllThenPlayEach` (CR 608.2c, 611.2b, 609.4b, 400.7; Heartless Conscription): "Exile all creatures. For each card exiled this way, you may play that card for as long as it remains
 * exiled, and mana of any type can be spent to cast that spell." is the exile of a group and one permission to play the cards it exiled (a permission for the named group, as "you may play those
 * cards for as long as they remain exiled" is), with mana of any type for the spells cast that way. Exactly the two steps of template eff.edhd58.permit.play.eachExiled.dur.anyType.
 */
import type { EffectStep } from '../types/ability';
import type { Folded } from './fold';
import type { RenderState } from './state';
import { plain } from './clause';
import { K } from './kernel';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function foldEdhD58(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return exileAllThenPlayEach(list, i, st);
}

function exileAllThenPlayEach(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'move' || b?.op !== 'effect' || a.guard !== undefined || b.guard !== undefined || typeof a.as !== 'string' || a.until !== undefined) return null;
  if (a.what.ref !== 'each' || !same(a.to, { zone: 'exile' })) return null;
  if (!same(b.duration, { d: 'remainsExiled' }) || b.effects.length !== 1) return null;
  const e = b.effects[0]!;
  if (e.s !== 'permit' || !same(e, { s: 'permit', who: { ref: 'you' }, action: 'play', of: { is: { ref: 'bound', name: a.as } }, anyManaType: true })) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`))) return null;
  const first = K.steps([a], st);
  return { clauses: [plain(first), plain('for each card exiled this way, you may play that card for as long as it remains exiled, and mana of any type can be spent to cast that spell')], consumed: 2 };
}
