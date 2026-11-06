/**
 * edh-top-2: `pair` (CR 702.95a-e), the effect of soulbond's two triggered abilities ("you may pair this creature with another unpaired creature you control",
 * "you may pair that creature with this creature"). The two creatures become paired only if, as the ability resolves, both are still creatures on the battlefield
 * under the control of the player who controls the ability, neither is paired already (an intervening "if", checked again, CR 603.4, 702.95a) and they are two
 * different objects (CR 702.95c: otherwise neither becomes paired). Each creature then names the other (`GameObject.pairedWith`, CR 702.95b, 702.95d: a creature has
 * one partner). The pair ends by the state-based check of core/sba-objects.ts (CR 702.95e).
 */
import type { EffectStep } from '../../types/ability';
import { charsOfObject } from '../../rules/characteristics';
import { isPaired } from '../../statics/pairing';
import type { StepHandler } from '../api';
import { did, NOTHING, permanentsOf } from './zones-util';

type Step = Extract<EffectStep, { op: 'pair' }>;

const pair: StepHandler<Step> = (cx, st) => {
  const g = cx.g;
  const a = permanentsOf(cx, st.what);
  const b = permanentsOf(cx, st.with);
  if (a.length !== 1 || b.length !== 1 || a[0]!.id === b[0]!.id) return NOTHING;
  const x = g.maybeObj(a[0]!.id);
  const y = g.maybeObj(b[0]!.id);
  if (x === undefined || y === undefined) return NOTHING;
  const creature = (o: typeof x): boolean => o.zone === 'battlefield' && !o.phasedOut && o.controller === cx.controller && charsOfObject(g.s, o).types.includes('Creature');
  if (!creature(x) || !creature(y) || isPaired(g.s, x) || isPaired(g.s, y)) return NOTHING; // CR 702.95c, 702.95a
  x.pairedWith = y.id;
  y.pairedWith = x.id;
  x.pairedBy = y.pairedBy = cx.controller; // CR 702.95e: another player gaining control of either ends the pair
  g.log(`${g.nameOf(x.id)} and ${g.nameOf(y.id)} become paired.`, { rules: ['CR 702.95a', 'CR 702.95b'], level: 'action' });
  return did(1);
};

export const PAIR_HANDLERS = { pair };
