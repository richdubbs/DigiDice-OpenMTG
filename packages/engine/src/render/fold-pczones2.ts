/**
 * pc-zones-2: the folds of its templates (parser/templates/zz-cloud/pc-zones-2.json), called from render/fold.ts#foldAt. CR cites from memory, unverified.
 *
 * `eachPlayerSearchesPutsBattlefield` (CR 701.23a, 701.24a, 110.2a, 102.3): "Each player searches their library for a basic land card, puts it onto the battlefield, then
 * shuffles." (Field of Ruin): for each player of the group (every player searches, the found cards enter together under their owners' control, every player shuffles: CR 101.4 choices in turn order, then the actions together), their search of their own library for one card of a description, the move of that card onto the battlefield under
 * their own control (untapped) and the shuffle of their library, as one sentence. Only that exact body for the group of all players; a single player keeps the older
 * folds (render/fold.ts#searchThenMove).
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function eachPlayerSearchesPutsBattlefield(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const m = list[i + 1];
  const s = list[i + 2];
  const all = { ref: 'each', who: 'player' };
  if (a?.op !== 'search' || m?.op !== 'move' || s?.op !== 'shuffle' || a.as === undefined) return null;
  if (!same(a.who, all) || a.guard !== undefined || a.zone !== 'library' || a.owner !== undefined || a.max !== 1 || a.min !== undefined) return null;
  if (a.reveal !== undefined || a.differentNames !== undefined || a.and !== undefined || a.alsoZones !== undefined || a.allZones !== undefined || a.alsoOutside !== undefined || a.shareLandType !== undefined) return null;
  if (m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined) return null;
  if (!same(m.what, { ref: 'bound', name: a.as }) || !same(m.to, { zone: 'battlefield', controller: 'owner' })) return null;
  if (s.guard !== undefined || s.as !== undefined || s.ifSearched !== undefined || !same(s.who, all)) return null;
  if (list.slice(i + 3).some((x) => JSON.stringify(x).includes(`"${a.as}"`))) return null;
  const what = K.np({ ...a.filter, zone: 'library' }, st, { det: 'a', noZone: true });
  return { clauses: [plain(`each player searches their library for ${what}, puts it onto the battlefield, then shuffles`, { standalone: true })], consumed: 3 };
}

export function foldPcZones2(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return eachPlayerSearchesPutsBattlefield(list, i, st);
}
