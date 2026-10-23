/**
 * The face-down move part (CR 708.3, 708.4, 708.9; m6 design 3.4). Owner: M6-3.
 *
 *  - afterLeave: a face-down spell that becomes a face-down permanent (CR 708.4) keeps its status (`faceDownInfo`: how it was put face down, its profile); a
 *    face-down permanent that leaves the battlefield, or a face-down spell that leaves the stack for any zone but the battlefield, is revealed to every player
 *    (CR 708.9): a public log line names the card (its last known information is visible to everyone: core/view.ts#lkiVisible).
 *  - beforeEnter: an object that enters the battlefield or the stack face down gets its status from the move's facts (manifest, cloak, an effect), from the
 *    object it was (a resolving face-down spell), or the plain profile put there by an effect (CR 708.2a); anywhere else a face-down card has no profile (CR
 *    406.3a). A new object has no list of players it was revealed to (CR 400.7), so a card shown earlier can't be followed into the face-down object.
 */
import type { GameObject } from '../../types/state';
import type { Game } from '../game';
import type { MovePart } from '../registries';

/** The name of the card a face-down object is (for the reveal of CR 708.9): its face's name. */
export function realName(g: Game, o: GameObject): string {
  const def = g.s.defs[o.defId];
  if (!def) return 'a card';
  return def.faces[o.zone === 'stack' ? o.stack?.face ?? o.face : o.face]?.name ?? def.name;
}

/** CR 708.9: a face-down permanent leaving the battlefield, or a face-down spell leaving the stack for anywhere but the battlefield, is revealed. */
export const revealedAsItMoves = (old: GameObject, now: GameObject | undefined): boolean =>
  old.faceDown && old.kind !== 'ability' && (old.zone === 'battlefield' || (old.zone === 'stack' && now?.zone !== 'battlefield'));

export const FACE_DOWN_MOVE_PARTS: readonly MovePart[] = [
  {
    afterLeave: (g, old, newId, opts) => {
      const now = newId ? g.s.objects[newId] : undefined;
      if (now && now.faceDown && old.faceDownInfo && !opts.enter?.faceDownInfo && (now.zone === 'battlefield' || now.zone === 'stack')) now.faceDownInfo = { ...old.faceDownInfo }; // CR 708.4
      if (revealedAsItMoves(old, now)) {
        const what = old.zone === 'stack' ? 'face-down spell' : 'face-down permanent';
        g.log(`The ${what} is revealed as it leaves the ${old.zone}: it is ${realName(g, old)}.`, { rules: ['CR 708.9'], level: 'info' });
      }
    },
    beforeEnter: (_g, o, opts) => {
      if (!o.faceDown || (o.zone !== 'battlefield' && o.zone !== 'stack')) {
        delete o.faceDownInfo; // CR 406.3a: a card face down anywhere else has no profile
        return;
      }
      o.faceDownInfo = opts.enter?.faceDownInfo ? { ...opts.enter.faceDownInfo } : o.faceDownInfo ?? { by: 'effect', profile: 'plain' };
    },
  },
];
