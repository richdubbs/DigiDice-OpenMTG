/**
 * edh-next-83 (Commander lane each-player, third round): the folds of its templates (parser/templates/zz-cloud/edh-next-83.json), called from render/steps.ts#foldHere. Each applies
 * only when every part is exactly what the idiom says. A value import of render/fold.ts here would make an import cycle (render/steps.ts imports both).
 *
 * `memoryJarExile` (CR 608.2c, 101.4, 406.3, 121.1; Memory Jar, Magus of the Jar): "Each player exiles all cards from their hand face down and draws seven cards.": every hand exiled
 * face down (one set, named for the return) and every player draws seven. Exactly the two steps of template eff.edhn83.eachPlayer.exileHandFaceDown.drawSeven.
 *
 * `memoryJarReturn` (CR 603.7a, 608.2c, 101.4, 701.9a): "At the beginning of the next end step, each player discards their hand and returns to their hand each card they exiled this way.": the
 * delayed trigger of template dl.edhn83.nextEnd.eachPlayer.discardHand.returnExiled (each player discards their hand, then the cards exiled that way go to their owners' hands).
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const EACH_PLAYER = { ref: 'each', who: 'player' };
const NAME = 'exiledFromHands';

function memoryJarExile(list: EffectStep[], i: number): Folded | null {
  const [m, d] = [list[i], list[i + 1]];
  if (m?.op !== 'move' || d?.op !== 'draw' || m.guard !== undefined || d.guard !== undefined || m.as !== NAME || d.as !== undefined || d.upTo !== undefined) return null;
  if (!same(m.what, { ref: 'each', filter: { zone: 'hand', isCard: true } }) || !same(m.to, { zone: 'exile', faceDown: true })) return null;
  if (!same(d.who, EACH_PLAYER) || typeof d.count !== 'number') return null;
  return { clauses: [plain(`each player exiles all cards from their hand face down and draws ${d.count === 7 ? 'seven' : String(d.count)} cards`, { standalone: true })], consumed: 2 };
}

function memoryJarReturn(list: EffectStep[], i: number): Folded | null {
  const s = list[i];
  if (s?.op !== 'delay' || s.guard !== undefined || s.duration !== undefined || s.once !== undefined || s.do.length !== 2) return null;
  if (!same(s.when, { at: 'step', step: 'end', next: true }) || !same(s.capture, [NAME])) return null;
  const [dis, mv] = s.do;
  if (dis?.op !== 'discard' || dis.guard !== undefined || dis.as !== undefined || !same(dis.who, EACH_PLAYER) || dis.count !== 'hand' || Object.keys(dis).sort().join() !== 'count,op,who') return null;
  if (mv?.op !== 'move' || mv.guard !== undefined || mv.as !== undefined || !same(mv.what, { ref: 'bound', name: NAME }) || !same(mv.to, { zone: 'hand' })) return null;
  return { clauses: [plain('at the beginning of the next end step, each player discards their hand and returns to their hand each card they exiled this way', { standalone: true })], consumed: 1 };
}

export function foldEdhN83(list: EffectStep[], i: number): Folded | null {
  return memoryJarExile(list, i) ?? memoryJarReturn(list, i);
}
