/**
 * The `umbraArmor` replacement body (CR 702.89a). Owner: std-rx24.
 *
 * Umbra armor (formerly totem armor) is a static ability of an Aura: "If enchanted permanent would be destroyed, instead remove all damage marked on it and
 * destroy this Aura." (keywords/data/umbra-armor.json writes it as a `replace` of the destruction of the permanent the Aura is attached to). Applying it:
 *  - the destruction does not happen (CR 614.6); all damage marked on the enchanted permanent is removed (CR 120.6, 702.89a); then the Aura is destroyed (an
 *    ordinary destruction: it can be regenerated or be indestructible itself, the ruling);
 *  - an indestructible permanent would not be destroyed at all (CR 702.12b), so umbra armor does not apply and the Aura stays (the ruling);
 *  - a regeneration shield on the same permanent would replace the same destruction (rules/destroy.ts applies shields after the replacement effects): its
 *    controller chooses which applies first (CR 616.1, as effects/rule-replacements/shield.ts asks); choosing regeneration leaves the event to the shield.
 * Unlike regeneration, umbra armor neither taps the permanent nor removes it from combat (CR 702.89a vs 701.19a). Two Auras with umbra armor are two
 * replacement effects; the controller orders them as any others (CR 616.1), and only one applies to one destruction (CR 614.5).
 */
import { charsOfObject, hasKeyword } from '../../rules/characteristics';
import { cantDo } from '../../rules/cant';
import { regenerationShieldIndex } from '../../rules/destroy';
import { proposeNested } from '../nested';
import { performRemoveAllDamage } from '../perform-events';
import type { BodyKinds } from '../registries';

export const UMBRA_ARMOR_BODY_KINDS: Pick<BodyKinds, 'umbraArmor'> = {
  umbraArmor: {
    capabilities: ['umbraArmor'],
    fits: (g, e) => {
      if (e.ev !== 'destroy' || e.object.zone !== 'battlefield') return false;
      const o = g.s.objects[e.object.id];
      return o !== undefined && !hasKeyword(charsOfObject(g.s, o), 'indestructible'); // CR 702.12b: it would not be destroyed
    },
    apply: (g, e, _b, c) => {
      if (e.ev !== 'destroy') return e;
      const id = e.object.id;
      // CR 616.1: a regeneration shield replaces the same destruction; the affected permanent's controller chooses which applies
      if (e.canRegenerate && !cantDo(g.s, 'beRegenerated', id) && regenerationShieldIndex(g.s, id) >= 0) {
        const pick = g.choose({
          kind: 'chooseOption', player: g.obj(id).controller, prompt: `${g.nameOf(id)} would be destroyed. Which effect applies first?`,
          options: [{ id: 'umbra', label: `Umbra armor of ${c.sourceName}` }, { id: 'regenerate', label: 'Use the regeneration shield' }], min: 1, max: 1, rules: ['CR 616.1', 'CR 702.89a', 'CR 701.19a'],
        }).ids[0];
        if (pick === 'regenerate') return e;
      }
      performRemoveAllDamage(g, id); // CR 120.6, 702.89a: all damage marked on it is removed
      g.log(`${g.nameOf(id)} is not destroyed: all damage is removed from it and ${c.sourceName} is destroyed instead (umbra armor).`, { rules: ['CR 702.89a', 'CR 614.6'], level: 'action' });
      const aura = g.s.objects[c.source.id];
      // the Aura's destruction is an event of its own (CR 701.8a): it may be regenerated or be indestructible itself
      if (aura !== undefined && aura.zone === 'battlefield') proposeNested(g, { ev: 'destroy', object: { id: aura.id, zone: 'battlefield' }, canRegenerate: !cantDo(g.s, 'beRegenerated', aura.id) });
      return null; // CR 614.6: the destruction never happens
    },
  },
};
