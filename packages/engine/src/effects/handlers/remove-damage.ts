/**
 * trek-8: `removeDamage` (CR 120.6, 614.1a, 704.5g-h; cites from memory, unverified): "remove all damage from it" / "all damage already dealt to it is healed" (Dr. McCoy,
 * Surly Surgeon). All the damage marked on each permanent the step names is removed, and so is the mark of deathtouch damage (the same as umbra armor does,
 * effects/bodies/umbra-armor.ts). Nothing else happens to the permanent: it stays tapped or untapped and stays in combat (unlike regeneration, CR 701.19a).
 */
import type { EffectStep } from '../../types/ability';
import type { StepHandler } from '../api';
import { performRemoveAllDamage } from '../perform-events';
import { did, namesOf, permanentsOf } from './zones-util';

type Step = Extract<EffectStep, { op: 'removeDamage' }>;

const removeDamage: StepHandler<Step> = (cx, st) => {
  const g = cx.g;
  const done = permanentsOf(cx, st.what).filter((h) => g.obj(h.id).damage > 0 || g.obj(h.id).deathtouchDamaged === true);
  for (const h of done) performRemoveAllDamage(g, h.id);
  if (done.length > 0) g.log(`All damage marked on ${namesOf(g, done)} is healed.`, { rules: ['CR 120.6', 'CR 614.1a'], level: 'action' });
  return did(done.length);
};

export const REMOVE_DAMAGE_HANDLERS = { removeDamage };
