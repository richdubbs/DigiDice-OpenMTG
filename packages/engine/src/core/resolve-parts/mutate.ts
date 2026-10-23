/**
 * A mutating creature spell merges (CR 702.140b-f, 730.2; m6 design 3.7). Owner: M6-9.
 *
 *  - CR 702.140b: as it begins resolving, if its mutate target is illegal, it ceases to be a mutating creature spell and resolves as a creature spell: this part
 *    declines and core/resolve.ts puts it onto the battlefield under its controller's control (its own targets, if any, were checked there, CR 608.3b).
 *  - CR 702.140c: if the target is legal it doesn't enter the battlefield: its controller chooses whether it goes on top of the creature or under it, and it
 *    merges with it (CR 730.2): it leaves the stack and becomes a component of that permanent (`components`, topmost first; the new component records the
 *    timestamp of the merge, CR 730.2a). On top, the permanent's definition, card and kind become the spell's (CR 730.2a, 730.2d) and its face-down status is
 *    the spell's, face up (CR 730.2e: the face-down component stays face down; nothing counts it as turned face up).
 *  - CR 730.2b-c: the permanent is the same object: it does not enter the battlefield (no enters triggers, no "as enters" replacement), keeps its counters,
 *    damage, status, attachments, combat role and the turn it came under its controller's control (summoning sickness), and every effect that applied to it
 *    still does.
 *  - CR 702.140d: `mutated` is emitted for the merged permanent ("whenever this creature mutates", triggers/forms-merge.ts).
 *  - CR 702.140f: the spell's last known information names the permanent it merged with as the object it became (`LastKnown.newId`).
 *
 * Marked for the players (manual-level log, the merge itself is done): merging with a melded permanent, putting the spell on top of a permanent that a copy
 * effect applies to (the component under it then gives its printed abilities, statics/merge.ts), and putting it under a permanent that a copy effect began to
 * apply to after an earlier merge (it stays that copy and gains the spell's abilities, CR 730.2c; whether the earlier components' abilities come back is open).
 */
import type { GameObject } from '../../types/state';
import { charsOfObject } from '../../rules/characteristics';
import { componentOf, isMutating, mutateTargetOf, spellComponent } from '../../rules/merge';
import { firstMergeTimestamp, isMergedObject } from '../../statics/merge';
import { isCopyPermanent, stored1a } from '../../statics/copy';
import { clone } from '../../util/clone';
import type { Game } from '../game';
import type { ResolvePermanentPart } from '../registries';

/** CR 702.140b-c: resolve a mutating creature spell; false when it is not one (or no longer one) and resolves as a creature spell. */
export function resolveMutating(g: Game, spell: GameObject): boolean {
  if (!isMutating(spell)) return false;
  const name = g.nameOf(spell.id);
  const t = mutateTargetOf(g.s, spell);
  if (!t || !t.legal) {
    g.log(`${name}'s mutate target is illegal: it is no longer a mutating creature spell and resolves as a creature spell.`, { rules: ['CR 702.140b'], level: 'info' });
    return false;
  }
  const target = g.obj(t.id);
  const onto = g.nameOf(target.id);
  const ans = g.choose({
    kind: 'chooseOption', player: spell.controller, prompt: `${name} merges with ${onto}: put it on top or underneath?`, min: 1, max: 1, rules: ['CR 702.140c'],
    options: [{ id: 'over', label: `On top (it becomes ${name} with ${onto}'s abilities)` }, { id: 'under', label: `Underneath (it stays ${onto} with ${name}'s abilities)` }],
  });
  const over = ans.ids[0] !== 'under';
  const melded = target.components !== undefined && !isMergedObject(target);
  const copied = over && isCopyPermanent(g.s, target);
  const first = firstMergeTimestamp(target);
  const copiedSince = !over && first !== undefined && stored1a(g.s, target.id).some((e) => e.copy !== undefined && e.timestamp > first);

  // CR 730.2: the spell becomes a component of the permanent (topmost first); CR 730.2a: the merge's timestamp
  const components = target.components ? target.components.map((c) => ({ ...c })) : [componentOf(target)];
  const incoming = spellComponent(spell, g.newTimestamp());
  if (over) {
    components.unshift(incoming);
    target.defId = spell.defId; // CR 730.2a: the characteristics (and the definition the object shows) are the topmost component's
    if (spell.cardId !== undefined) target.cardId = spell.cardId;
    else delete target.cardId;
    target.kind = incoming.kind; // CR 730.2d: a token only if the topmost component is a token
    target.face = spell.stack?.face ?? spell.face;
    if (target.faceDown) {
      // CR 730.2e: its status is the topmost component's; the face-down component keeps its own (componentOf), and nothing counts it as turned face up
      target.faceDown = false;
      delete target.faceDownInfo;
      delete target.faceUpX;
    }
  } else {
    components.push(incoming);
  }
  target.components = components;

  // CR 730.2b: the spell leaves the stack and becomes part of the permanent: no new object, no zone change onto the battlefield
  g.s.lki[spell.id] = { object: clone(spell), chars: charsOfObject(g.s, spell), leftZone: 'stack', newId: target.id }; // CR 702.140f
  const at = g.s.zones.stack.indexOf(spell.id);
  if (at >= 0) g.s.zones.stack.splice(at, 1);
  delete g.s.objects[spell.id];
  g.emit({ type: 'resolved', objectId: spell.id });
  g.emit({ type: 'mutated', objectId: target.id, spell: spell.id, over }); // CR 702.140d
  g.log(`${name} mutates ${over ? 'onto' : 'under'} ${onto}: they are one creature, ${g.nameOf(target.id)}, with the abilities of every card in it.`, {
    rules: ['CR 702.140c', 'CR 702.140e', 'CR 730.2'], level: 'info',
  });
  if (melded) {
    g.log(`${name} merged with a melded permanent: merging with a melded permanent is not automated (CR 730.2, 712.4a). Check its characteristics and adjust them by hand.`, {
      rules: ['CR 730.2', 'CR 712.4a'], level: 'manual',
    });
  }
  if (copied) {
    g.log(`${name} was put on top of a permanent that a copy effect applies to: the abilities the component under it gives are its printed ones here (CR 730.2a, 707.2). Check them and adjust by hand.`, {
      rules: ['CR 730.2a', 'CR 707.2'], level: 'manual',
    });
  }
  if (copiedSince) {
    g.log(`${name} was put under a permanent that became a copy after an earlier merge: it is still that copy with ${name}'s abilities, but the abilities of the cards merged before the copy effect began are not given back here (CR 730.2a, 730.2c). Check them and adjust by hand.`, {
      rules: ['CR 730.2a', 'CR 730.2c'], level: 'manual',
    });
  }
  return true;
}

export const MUTATE_RESOLVE_PARTS: readonly ResolvePermanentPart[] = [{ instead: resolveMutating }];
