/**
 * edh-next-8: the fold of its template eff.edhn8.player.searches.upTo.bf (parser/templates/zz-cloud/edh-next-8.json), called from render/fold.ts#foldAt.
 *
 * `eachPlayerSearchesUpToBattlefield` (CR 701.23a, 701.24a, 110.2a, 101.4; Avatar of Growth): "Each player searches their library for up to two basic land cards, puts them onto the
 * battlefield, then shuffles.": every player's search of their own library for up to a number of cards of a description, the move of the cards found onto the battlefield untapped under
 * their owners' control, and every player's shuffle, as one sentence. Only that exact body for the group of all players.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { alt } from './text';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function eachPlayerSearchesUpToBattlefield(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const m = list[i + 1];
  const s = list[i + 2];
  const all = { ref: 'each', who: 'player' };
  if (a?.op !== 'search' || m?.op !== 'move' || s?.op !== 'shuffle' || a.as === undefined) return null;
  if (!same(a.who, all) || a.guard !== undefined || a.zone !== 'library' || a.owner !== undefined || a.min !== 0 || typeof a.max !== 'number') return null;
  if (a.reveal !== undefined || a.differentNames !== undefined || a.and !== undefined || a.alsoZones !== undefined || a.allZones !== undefined || a.alsoOutside !== undefined || a.shareLandType !== undefined) return null;
  if (m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined) return null;
  if (!same(m.what, { ref: 'bound', name: a.as }) || !same(m.to, { zone: 'battlefield', controller: 'owner' })) return null;
  if (s.guard !== undefined || s.as !== undefined || s.ifSearched !== undefined || !same(s.who, all)) return null;
  if (list.slice(i + 3).some((x) => JSON.stringify(x).includes(`"${a.as}"`))) return null;
  const what = K.np({ ...a.filter, zone: 'library' }, st, { det: 'none', plural: true, noZone: true });
  return { clauses: [plain(`each player searches their library for up to ${a.max} ${what}, puts them onto the battlefield, then shuffles`, { standalone: true })], consumed: 3 };
}

/**
 * `playerUntapsAllTheyControl` (CR 701.26a, 109.4, 608.2c; Early Harvest, eff.edhn8.player.untaps.all.theyControl): "Target player untaps all basic lands they control.": the untap of every
 * permanent of a description that the player a target names controls (the player does not act: the permanents untap, CR 701.26a). Only the target player or opponent as the controller.
 */
function playerUntapsAllTheyControl(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const u = list[i];
  if (u?.op !== 'untap' || u.guard !== undefined || u.what.ref !== 'each' || !('filter' in u.what)) return null;
  const f = u.what.filter;
  if (Object.keys(f).length !== 2 || f.anyOf?.length !== 1 || f.controller === undefined || typeof f.controller !== 'object' || !('ref' in f.controller) || f.controller.ref !== 'target') return null;
  if (Object.keys(u).some((k) => !['op', 'what'].includes(k))) return null;
  const subj = K.player(f.controller, st, 'subject').text;
  const what = K.np(f.anyOf[0]!, st, { det: 'none', plural: true });
  return { clauses: [plain(alt(`${subj} untaps all ${what} they control`, `untap all ${what} ${subj} controls`), { standalone: true })], consumed: 1 };
}

/**
 * `returnAllPlayerOwnsToTheirHand` (CR 701.5, 400.3, 108.3, 608.2c; Hurkyl's Recall, eff.edhn8.return.all.playerOwns.theirHand): "Return all artifacts target player owns to their hand.": every
 * permanent of a description that the player a target names owns goes to its owner's hand, which is that player's hand. Only the target player or opponent as the owner.
 */
function returnAllPlayerOwnsToTheirHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  if (m?.op !== 'move' || m.guard !== undefined || m.what.ref !== 'each' || !('filter' in m.what)) return null;
  if (!same(m.to, { zone: 'hand' }) || Object.keys(m).some((k) => !['op', 'what', 'to'].includes(k))) return null;
  const f = m.what.filter;
  if (Object.keys(f).length !== 2 || f.anyOf?.length !== 1 || f.owner === undefined || typeof f.owner !== 'object' || !('ref' in f.owner) || f.owner.ref !== 'target') return null;
  const subj = K.player(f.owner, st, 'subject').text;
  const what = K.np(f.anyOf[0]!, st, { det: 'none', plural: true });
  return { clauses: [plain(alt(`return all ${what} ${subj} owns to their hand`, `return all ${what} ${subj} owns to their owners' hands`), { standalone: true })], consumed: 1 };
}

export function foldEdhN8(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return eachPlayerSearchesUpToBattlefield(list, i, st) ?? playerUntapsAllTheyControl(list, i, st) ?? returnAllPlayerOwnsToTheirHand(list, i, st);
}
