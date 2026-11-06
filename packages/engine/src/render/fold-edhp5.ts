/**
 * edh-players-5 (Commander lane edh-players): the folds of its templates (parser/templates/zz-cloud/edh-players-5.json), called from render/fold.ts#foldAt.
 *
 * `drawHalfLibraryLoseHalfLife` (CR 107.1a, 121.1, 119.3; Peer into the Abyss; eff.edhp5.draw.halfLibrary.loseHalfLife): "Target player draws cards equal to half the number of
 * cards in their library and loses half their life. Round up each time.": a draw of half that player's own library and a loss of half their own life, both rounded up.
 * Only that exact shape, for a player other than "you" (whose words are "your").
 *
 * `gainLifeAndDrawEqual` (CR 119.1, 121.1, 608.2h; Lifeblood Hydra; eff.edhp5.player.gainLife.andDraw.equalTo): "You gain life and draw cards equal to its power.": a gain of life
 * and a draw of cards, both by the same player and of the same amount, a statistic of the object the event is about ("its power"). Only that exact shape: two steps with no guard or name.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

function drawHalfLibraryLoseHalfLife(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'draw' || b?.op !== 'loseLife' || [a, b].some((x) => x.guard !== undefined || x.as !== undefined) || JSON.stringify(a.who) !== JSON.stringify(b.who) || a.who.ref === 'you') return null;
  const half = (q: unknown): string => JSON.stringify({ q: 'math', op: 'ceilDiv', args: [q, 2] });
  if (JSON.stringify(a.count) !== half({ q: 'zoneSize', zone: 'library', of: a.who }) || JSON.stringify(b.amount) !== half({ q: 'life', of: b.who })) return null;
  const who = K.player(a.who, st, 'subject');
  return { clauses: [plain(`${who.text} draws cards equal to half the number of cards in their library and loses half their life. round up each time`, { standalone: true })], consumed: 2 };
}

function gainLifeAndDrawEqual(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'gainLife' || b?.op !== 'draw' || [a, b].some((x) => x.guard !== undefined || x.as !== undefined) || JSON.stringify(a.who) !== JSON.stringify(b.who)) return null;
  if (typeof a.amount === 'number' || JSON.stringify(a.amount) !== JSON.stringify(b.count)) return null;
  // only the stat of the event's subject ("its power"): a sacrificed creature's power is said "you gain X life and draw X cards, where X is that creature's power" (Disciple of Freyalise)
  if (typeof a.amount !== 'object' || a.amount.q !== 'stat' || JSON.stringify(a.amount.of) !== JSON.stringify({ ref: 'event', role: 'subject' })) return null;
  const who = K.player(a.who, st, 'subject');
  const amount = K.qty(a.amount, st);
  return { clauses: [plain(`${who.text} ${who.person === 'you' ? 'gain' : 'gains'} life and ${who.person === 'you' ? 'draw' : 'draws'} cards equal to ${amount}`)], consumed: 2 };
}

export function foldEdhP5(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return drawHalfLibraryLoseHalfLife(list, i, st) ?? gainLifeAndDrawEqual(list, i, st);
}
