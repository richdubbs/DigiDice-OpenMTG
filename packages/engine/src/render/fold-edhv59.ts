/**
 * edh-c-59 (Commander lane edh-c): the folds of its templates (parser/templates/zz-cloud/edh-c-59.json), called from render/fold.ts#foldAt. Each applies only when every part is
 * exactly what the idiom says.
 *
 * `discardAnyNumberAtRandom` (CR 701.9a-b, 608.2d, 107.1; Rites of Initiation, eff.edhv59.discard.anyNumber.atRandom): "Discard any number of cards at random.": you choose a number
 * from 0 to the number of cards in your hand, then discard that many cards at random. Exactly those two steps; the discard reports the cards for a later "for each card discarded this way".
 */
import type { EffectStep } from '../types/ability';
import type { Folded } from './fold';
import { byPlayer } from './steps-util';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function discardAnyNumberAtRandom(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [c, d] = [list[i], list[i + 1]];
  if (c?.op !== 'chooseValue' || d?.op !== 'discard' || c.what !== 'number' || c.link === undefined || c.guard !== undefined || d.guard !== undefined) return null;
  if (!same(c.who, { ref: 'you' }) || !same(d.who, { ref: 'you' }) || c.min !== 0 || c.random !== undefined || c.options !== undefined || c.exclude !== undefined || c.secret !== undefined) return null;
  if (!same(c.max, { q: 'zoneSize', zone: 'hand', of: { ref: 'you' } }) || d.mode !== 'random' || d.filter !== undefined || d.cantAs !== undefined || !same(d.count, { q: 'chosenNumber', link: c.link })) return null;
  if (list.slice(i + 2).some((s) => JSON.stringify(s).includes(`"link":"${c.link}"`))) return null;
  if (d.as !== undefined) st.info.set(`r:${d.as}`, { nouns: ['card'], plural: true, thisWay: 'discarded this way', moved: 'discarded' });
  return { clauses: [byPlayer(d.who, st, 'discard', 'any number of cards at random')], consumed: 2 };
}

export function foldEdhV59(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return discardAnyNumberAtRandom(list, i, st);
}
