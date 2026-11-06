/**
 * edh-zones-16 (Commander lane edh-zones): the folds of its templates (parser/templates/zz-cloud/edh-zones-16.json), called from render/fold.ts#foldAt. Each applies only when
 * every part is exactly what the idiom says.
 *
 * `controllersSearchThenPut` (CR 701.23a, 608.2c, 608.2f, 110.2a, 701.24a; Winds of Abandon): "For each creature exiled this way, its controller searches their library for a basic
 * land card. Those players put those cards onto the battlefield tapped, then shuffle.": for each object of a group, its controller searches for a basic land card (the cards
 * found are gathered), then the cards found are put onto the battlefield tapped under their owners' control, then each of those players shuffles. Exactly the three steps of
 * template eff.edhz16.forEach.controllerSearchesBasic.thenPutTapped.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const controllerOfBound = (name: string) => ({ ref: 'controllerOf', object: { ref: 'bound', name } });

function controllersSearchThenPut(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b, c] = [list[i], list[i + 1], list[i + 2]];
  if (a?.op !== 'forEach' || b?.op !== 'move' || c?.op !== 'forEach' || a.gather === undefined || a.guard !== undefined || b.guard !== undefined || c.guard !== undefined) return null;
  if (a.over.ref !== 'bound' || !same(a.over, c.over) || a.do.length !== 1 || c.do.length !== 1) return null;
  const [search] = a.do;
  const [shuffle] = c.do;
  if (search?.op !== 'search' || shuffle?.op !== 'shuffle' || search.guard !== undefined || shuffle.guard !== undefined || search.as !== a.gather) return null;
  if (!same(search.who, controllerOfBound(a.as)) || !same(shuffle.who, controllerOfBound(c.as))) return null;
  if (search.zone !== 'library' || search.max !== 1 || search.min !== undefined || !same(search.filter, { supertypes: ['Basic'], types: ['Land'] }) || Object.keys(search).length !== 6) return null;
  if (!same(b.what, { ref: 'bound', name: a.gather }) || !same(b.to, { zone: 'battlefield', controller: 'owner', tapped: true }) || b.as !== undefined || b.until !== undefined || b.link !== undefined || b.remember !== undefined) return null;
  if (Object.keys(shuffle).length !== 2) return null;
  // the group the ONE earlier destroy or exile of the ability moved, said by the nouns that instruction recorded (render/steps-flow.ts#forEach, family for-each-this-way)
  const info = st.info.get(`r:${a.over.name}`);
  if (info === undefined || (info.moved !== 'destroyed' && info.moved !== 'exiled') || info.thisWay === undefined) return null;
  const nouns = info.nouns.filter((n) => n !== 'card' && n !== 'object');
  if (nouns.length === 0) return null;
  // (the first noun the earlier instruction recorded is the narrowest: "creature" for a creature, then "permanent")
  const group = `${nouns[0]!} ${info.thisWay}`;
  const text = `for each ${group}, its controller searches their library for a basic land card. those players put those cards onto the battlefield tapped, then shuffle`;
  return { clauses: [plain(text, { standalone: true })], consumed: 3 };
}

/** The folds of edh-zones-16 (render/fold.ts#foldAt). */
export function foldEdhZones16(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return controllersSearchThenPut(list, i, st);
}
