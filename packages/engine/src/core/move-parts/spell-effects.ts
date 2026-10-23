/**
 * CR 400.7a: effects from spells, activated abilities and triggered abilities that change the characteristics or controller of a permanent spell on the stack
 * continue to apply to the permanent that spell becomes. Owner: M6-8 (a text change of "target spell or permanent" aimed at a creature spell, CR 612; the rule
 * holds for every resolved effect that changes characteristics or control, layers 1-7).
 *
 * afterLeave: when a spell (not an ability) moves from the stack to the battlefield, every stored continuous effect whose fixed affected set names the spell on
 * the stack also names the permanent it became (CR 611.2c: the set was locked as the effect began; 400.7a carries it over). Rule-modifying effects (restrictions,
 * permissions, cost changes, shields) are not characteristics and are not carried.
 */
import { carried, namesSpellOnStack } from '../../statics/spell-carry';
import type { MovePart } from '../registries';

export const SPELL_EFFECTS_MOVE_PARTS: readonly MovePart[] = [
  {
    afterLeave: (g, old, newId) => {
      if (old.zone !== 'stack' || old.kind === 'ability' || newId === null) return;
      const now = g.s.objects[newId];
      if (now?.zone !== 'battlefield') return;
      const list = g.s.continuousEffects;
      for (let i = 0; i < list.length; i++) {
        const rec = list[i]!;
        if (namesSpellOnStack(rec, old.id)) list[i] = carried(rec, now.id, old.id); // the same carrying as the hypothetical permanent's (statics/spell-carry.ts, CR 614.12)
      }
    },
  },
];
