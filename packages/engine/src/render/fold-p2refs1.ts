/**
 * p2-refs-1 (Phase 2 lane p2-refs): the folds of its templates (parser/templates/zz-cloud/p2-refs-1.json), called from render/fold.ts#foldAt.
 *
 * `exileHandFaceDownThenDraw` (CR 406.3, 121.1, 608.2c): "target player exiles all cards from their hand face down, then draws that many cards" (Induced Amnesia): the
 * move of every card in that player's hand to exile face down, named (a linked ability may read it: `link`, CR 607.2a), then that player's draw of as many cards as the
 * move moved. Only one player named in the third person singular, the move with no guard, duration or other destination field, the draw with no guard or name, and the
 * name read by nothing after.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

function exileHandFaceDownThenDraw(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'move' || b?.op !== 'draw' || a.as === undefined || a.guard !== undefined || a.until !== undefined || a.remember !== undefined || b.guard !== undefined || b.as !== undefined) return null;
  const who = JSON.stringify(b.who);
  if (b.who.ref === 'you' || JSON.stringify(a.what) !== JSON.stringify({ ref: 'each', filter: { zone: 'hand', owner: b.who } })) return null;
  if (JSON.stringify(a.to) !== JSON.stringify({ zone: 'exile', faceDown: true }) || JSON.stringify(b.count) !== JSON.stringify({ q: 'resultCount', step: a.as })) return null;
  if (list.slice(i + 2).some((s) => JSON.stringify(s).includes(`"${a.as}"`)) || who.includes(`"${a.as}"`)) return null;
  const subj = K.player(b.who, st, 'subject');
  if (subj.person !== 'sg' || subj.they === true) return null;
  return { clauses: [plain(`${subj.text} exiles all cards from their hand face down, then draws that many cards`, { standalone: true })], consumed: 2 };
}

export function foldP2Refs1(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return exileHandFaceDownThenDraw(list, i, st);
}
