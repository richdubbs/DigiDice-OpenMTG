/**
 * edh-top-6: the fold of its template eff.edht6.eachPlayer.searches.upToX.bf.tapped (parser/templates/zz-cloud/edh-top-6.json), called from render/fold.ts#foldAt.
 *
 * `eachPlayerSearchesUpToXTapped` (CR 701.23a-b, 701.24a, 107.3, 110.2a, 101.4; join forces, Collective Voyage): "Each player searches their library for up to X basic land cards,
 * where X is the total amount of mana paid this way, puts them onto the battlefield tapped, then shuffles.": every player's search of their own library for up to the same number of
 * cards of a description, the move of the cards found onto the battlefield tapped under their owners' control, and every player's shuffle, as one sentence. Only that exact body for
 * the group of all players.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function eachPlayerSearchesUpToXTapped(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const m = list[i + 1];
  const s = list[i + 2];
  const all = { ref: 'each', who: 'player' };
  if (a?.op !== 'search' || m?.op !== 'move' || s?.op !== 'shuffle' || a.as === undefined) return null;
  if (!same(a.who, all) || a.guard !== undefined || a.zone !== 'library' || a.owner !== undefined || a.min !== 0 || typeof a.max !== 'object') return null;
  if (a.reveal !== undefined || a.differentNames !== undefined || a.and !== undefined || a.alsoZones !== undefined || a.allZones !== undefined || a.alsoOutside !== undefined || a.shareLandType !== undefined) return null;
  if (m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined) return null;
  if (!same(m.what, { ref: 'bound', name: a.as }) || !same(m.to, { zone: 'battlefield', controller: 'owner', tapped: true })) return null;
  if (s.guard !== undefined || s.as !== undefined || s.ifSearched !== undefined || !same(s.who, all)) return null;
  if (list.slice(i + 3).some((x) => JSON.stringify(x).includes(`"${a.as}"`))) return null;
  const what = K.np({ ...a.filter, zone: 'library' }, st, { det: 'none', plural: true, noZone: true });
  return { clauses: [plain(`each player searches their library for up to X ${what}, where X is ${K.qty(a.max, st)}, puts them onto the battlefield tapped, then shuffles`, { standalone: true })], consumed: 3 };
}

/**
 * `forEachOpponentMayPut` (CR 115.1, 601.2c, 608.2d, 110.2a; Sepulchral Primordial): "for each opponent, you may put up to one target creature card from that player's graveyard onto the
 * battlefield under your control": the targets (one for each opponent), a choice of any number of them by you (a "you may" for each opponent's card), and one move of the cards chosen,
 * which enter together. Only that exact body.
 */
function forEachOpponentMayPut(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  const m = list[i + 1];
  if (c?.op !== 'chooseObjects' || m?.op !== 'move' || c.guard !== undefined || m.guard !== undefined) return null;
  if (!same(c.who, { ref: 'you' }) || c.from.ref !== 'target' || c.min !== 0 || c.max !== 'any' || c.random !== undefined || c.groupLimit !== undefined || c.perPlayer !== undefined || c.startingWith !== undefined || c.link !== undefined || c.distinct !== undefined) return null;
  if (!same(m.what, { ref: 'bound', name: c.as }) || !same(m.to, { zone: 'battlefield', controller: { ref: 'you' } }) || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined) return null;
  const spec = st.specs.get(c.from.id);
  if (spec?.perOpponent !== true || spec.min !== 0 || spec.max !== 1 || spec.filter?.zone !== 'graveyard') return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"${c.as}"`))) return null;
  const target = K.obj(c.from, st, 'object').text;
  return { clauses: [plain(`for each opponent, you may put ${target} onto the battlefield under your control`, { standalone: true })], consumed: 2 };
}

export function foldEdhT6(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return eachPlayerSearchesUpToXTapped(list, i, st) ?? forEachOpponentMayPut(list, i, st);
}
