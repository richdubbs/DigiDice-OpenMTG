/**
 * M12-3 (m12 design D14, 4.3): goad (CR 701.15), a native keyword action. Owner: M12-3.
 *
 *   CR 701.15a  "Certain spells and abilities can goad a creature. Until the next turn of the controller of that spell or ability, that creature is goaded."
 *               The goader is the controller of the spell or ability (`cx.controller`), never the step's `who`: the entry `{ by }` is added to
 *               `GameObject.goaded` and ends as that player's next turn begins, or as it would have begun when they left the game (CR 800.4m; M12-2,
 *               core/durations.ts#expireGoad). No turn number is stored (extra and skipped turns, a goader who leaves).
 *   CR 701.15b  Goaded is a designation of a permanent: only a permanent on the battlefield can be goaded; it ends when the permanent leaves the battlefield
 *               (a new object, CR 400.7: core/zones.ts#freshObject has no `goaded`) and stays through a control change. The two combat requirements it
 *               creates ("attacks each combat if able", "attacks a player other than <the goader> if able") are statics/requirements.ts#goadHits.
 *   CR 701.15c  Goaded by several players: one entry per goader, each its own requirements.
 *   CR 701.15d  Goaded again by the same player: no effect (no second entry, no event).
 *
 * Step: `{op:'action', action:'goad', who:{ref:'you'}, subject}`; `as` binds the creatures this action goads (p2-attack-block-2: also one it goaded already, CR
 * 701.15d, which is still one of "those creatures"). Each new goading emits an
 * `actionPerformed` event with the verb `goad` (the `action` trigger pattern, "whenever you goad a creature").
 */
import { isPlayerOnlyRefKind, type EffectStep, type ObjRef } from '../../types/ability';
import type { ObjHandle } from '../../types/state';
import type { StepHandler } from '../api';
import { askManual } from '../manual';
import { performAction } from '../perform';
import { bindAs, did, permanentsOf } from './zones-util';

type ActionStep = Extract<EffectStep, { op: 'action' }>;

/** Capability names (`feature:action.native.<name>`) of the native action of this module. */
export const GOAD_FEATURES: readonly string[] = ['action.native.goad'];

const goad: StepHandler<ActionStep> = (cx, st) => {
  const g = cx.g;
  const by = cx.controller; // CR 701.15a: the controller of the spell or ability
  const subject = st.subject;
  if (subject === undefined || isPlayerOnlyRefKind(subject.ref) || (subject.ref === 'each' && 'who' in subject)) {
    bindAs(cx, st.as, []); // bound before the manual exit (design 3.1 rule 6, CR 609.3)
    return askManual(cx, st.span ?? 'Goad.', 'goad needs the creature it goads (CR 701.15a: a creature is goaded, never a player)');
  }
  const done: ObjHandle[] = [];
  const acted: ObjHandle[] = []; // p2-attack-block-2: every creature the instruction goads, already goaded by this player or not ("those creatures", CR 608.2c)
  for (const h of permanentsOf(cx, subject as ObjRef)) {
    const o = g.s.objects[h.id];
    if (!o || o.phasedOut) continue; // a phased-out permanent is treated as though it doesn't exist (CR 702.26b)
    acted.push(h);
    if (o.goaded?.some((x) => x.by === by)) {
      g.log(`${g.nameOf(o.id)} is already goaded by ${g.player(by).name}: goading it again has no effect.`, { rules: ['CR 701.15d'], level: 'info' });
      continue;
    }
    o.goaded = [...(o.goaded ?? []), { by }];
    performAction(g, { verb: 'goad', actor: by, objectId: o.id });
    g.log(`${g.player(by).name} goads ${g.nameOf(o.id)}: until ${g.player(by).name}'s next turn it attacks each combat if able, and attacks a player other than ${g.player(by).name} if able.`, {
      rules: ['CR 701.15a', 'CR 701.15b', ...(o.goaded.length > 1 ? ['CR 701.15c'] : [])], level: 'action',
    });
    done.push(h);
  }
  bindAs(cx, st.as, acted);
  return did(done.length);
};

/** The native action of this module by `ActionMacro.native` name (effects/handlers/actions-native.ts#NATIVE_ACTIONS). */
export const GOAD_NATIVES: Readonly<Record<string, StepHandler<ActionStep>>> = { goad };
