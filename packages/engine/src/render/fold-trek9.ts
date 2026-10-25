/**
 * trek-9: the folds of its templates (parser/templates/zz-cloud/trek-9.json), called from render/fold.ts#foldAt. CR cites from memory, unverified.
 *
 * `ownersShuffleThem` (CR 701.24a, 400.3, 108.3, 401.4, 608.2c): "Choose up to two target cards in graveyards. The owners of those cards shuffle them into their
 * libraries." (Those Old Scientists): the cards go into their OWNERS' libraries (a move into a library with no player named: each card goes to its owner's, CR 400.3)
 * and the owner of each of those cards shuffles their library, as one sentence. The group is named once, after "the owners of", and "them" says it again.
 * Only a plain move into a library of a group of cards (several of them, never one: "the owner of ... shuffles it into their library" is fold.ts#shuffleInto's),
 * followed by the shuffle of the owners of exactly that group.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

function ownersShuffleThem(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  const s = list[i + 1];
  if (m?.op !== 'move' || s?.op !== 'shuffle' || m.guard !== undefined || s.guard !== undefined || s.ifSearched !== undefined) return null;
  if (m.until !== undefined || m.link !== undefined || m.remember !== undefined || m.as !== undefined || s.as !== undefined) return null;
  if (JSON.stringify(m.to) !== '{"zone":"library"}') return null;
  if (s.who.ref !== 'ownerOf' || JSON.stringify(s.who.object) !== JSON.stringify(m.what)) return null;
  const group = K.obj(m.what, st, 'object');
  if (!group.plural) return null;
  const them = K.obj(m.what, st, 'object');
  return { clauses: [plain(`the owners of ${group.text} shuffle ${them.text} into their libraries`, { standalone: true })], consumed: 2 };
}

export function foldTrek9(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return ownersShuffleThem(list, i, st);
}
