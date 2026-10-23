/**
 * M11-1 (m11 design 2): the commander move part. Owner: M11-1.
 *
 *  - CR 903.9a, 704.6d: a commander put into a graveyard or exile gets `GameObject.commanderMoved` on its NEW object (CR 400.7), so the next state-based action
 *    check asks its owner whether to put it into the command zone (core/sba-commander.ts). A melded or merged permanent that is a commander (CR 903.3b-c)
 *    leaves as one and becomes its cards (core/move-parts/components.ts, which runs first): the card that is the commander is the one flagged.
 *  - CR 903.9c (a melded or merged commander its owner puts into the command zone instead of a hand or a library): core/move-parts/components.ts.
 *  - Review finding 2, CR 708.9: a face-down commander that dealt combat damage is revealed as it leaves the battlefield: that damage joins the public tally
 *    (core/commander-damage.ts).
 *
 * The flag is private (core/view.ts#hiddenObject strips it for an object other players can't see: a commander exiled face down, CR 406.3a, 400.2).
 */
import type { ObjectId } from '../../types/ids';
import { commanderOfCard, isCommanderGame } from '../../statics/commander';
import { revealCommanderDamage } from '../commander-damage';
import type { MovePart } from '../registries';

export const COMMANDER_MOVE_PARTS: readonly MovePart[] = [
  {
    afterLeave: (g, old, newId) => {
      if (!isCommanderGame(g.s)) return;
      if (old.zone === 'battlefield' && old.hiddenCommanderDamage) revealCommanderDamage(g, old, false); // CR 708.9
      if (newId === null) return;
      // CR 903.9a: every card the move made (a melded or merged permanent becomes its cards, CR 903.3b-c) that is a commander and is now in a graveyard or exile
      const ids: ObjectId[] = [newId, ...(g.s.lki[old.id]?.alsoBecame ?? [])];
      for (const id of ids) {
        const o = g.s.objects[id];
        if (o && o.kind === 'card' && (o.zone === 'graveyard' || o.zone === 'exile') && commanderOfCard(g.s, o.cardId) !== undefined) o.commanderMoved = true;
      }
    },
  },
];
