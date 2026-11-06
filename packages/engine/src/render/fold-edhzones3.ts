/**
 * edh-zones-3 (Commander lane edh-zones): the folds of its templates (parser/templates/zz-cloud/edh-zones-3.json), called from render/fold.ts#foldAt.
 *
 * `shuffleSelfAndGraveyard` (CR 701.24a, 400.3; Elixir of Immortality): "Shuffle ~ and your graveyard into their owner's library.": the object itself and the cards of your
 * graveyard go into their owners' libraries (the object into its owner's, the cards into yours), then the owner of the object shuffles and you shuffle. Oracle names it as one
 * shuffle "into their owner's library" (or "owners' libraries"). Only that exact shape: the move of the union of the object itself and every card of your graveyard to a library
 * with no owner named, no position, order, guard, name, duration or link, then the two shuffles.
 *
 * `playerPutsGraveyardBottom` (CR 401.4, 400.3; Endurance): "Up to one target player puts all the cards from their graveyard on the bottom of their library in a random
 * order.": every card of a player's graveyard goes to the bottom of that same player's library in a random order, by that player (the cards are theirs, CR 400.3). Only that
 * exact shape, for a player other than you (yours is the plain instruction): one move with no guard, name, duration or link.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import { byPlayer } from './steps-util';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { alt } from './text';

const YOU = JSON.stringify({ ref: 'you' });
const SELF = JSON.stringify({ ref: 'self' });

function shuffleSelfAndGraveyard(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  const a = list[i + 1];
  const b = list[i + 2];
  if (m?.op !== 'move' || a?.op !== 'shuffle' || b?.op !== 'shuffle' || m.what.ref !== 'union' || m.what.of.length !== 2) return null;
  const [x, y] = m.what.of;
  if (JSON.stringify(x) !== SELF || y?.ref !== 'each' || JSON.stringify(y.filter) !== JSON.stringify({ zone: 'graveyard', owner: 'you' })) return null;
  if (JSON.stringify(m.to) !== JSON.stringify({ zone: 'library' }) || [m, a, b].some((s) => s.guard !== undefined || s.as !== undefined) || m.until !== undefined || m.link !== undefined || m.remember !== undefined) return null;
  if (a.who.ref !== 'ownerOf' || JSON.stringify(a.who.object) !== SELF || JSON.stringify(b.who) !== YOU) return null;
  const itself = K.obj(m.what.of[0]!, st, 'object').text;
  return { clauses: [plain(alt(`shuffle ${itself} and your graveyard into their owner's library`, `shuffle ${itself} and your graveyard into their owners' libraries`))], consumed: 3 };
}

function playerPutsGraveyardBottom(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  if (m?.op !== 'move' || m.what.ref !== 'each' || m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined) return null;
  const who = m.what.filter.owner;
  if (typeof who !== 'object' || who.ref === 'you' || Object.keys(m.what.filter).length !== 2 || m.what.filter.zone !== 'graveyard') return null;
  if (JSON.stringify(m.to) !== JSON.stringify({ zone: 'library', owner: who, position: 'bottom', order: 'random' })) return null;
  return { clauses: [byPlayer(who, st, 'put', 'all the cards from their graveyard on the bottom of their library in a random order')], consumed: 1 };
}

export function foldEdhZones3(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return shuffleSelfAndGraveyard(list, i, st) ?? playerPutsGraveyardBottom(list, i, st);
}
