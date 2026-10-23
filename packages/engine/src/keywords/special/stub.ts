/**
 * Special actions (CR 116.2) that keywords grant are PLANNED, not implemented, in milestone 5 (design 7.4: foretell, suspend, plot "later", morph and disguise
 * "M6"). A stub defines the action completely (key, rule, zones, timing) so that the registry, the renderer and the traceability tests know it exists, but its
 * `check` ALWAYS denies with the reason, so `legalActions` can never list it and a player can never half-perform it. `perform` is unreachable and throws.
 * Owner: WP3. The day a special action is implemented its file replaces `plannedSpecialAction(...)` by a real definition.
 */
import { deny } from '../../rules/denial';
import type { SpecialActionDef } from '../types';
import type { ZoneName } from '../../types/ability';

/** M6-0: the planned stubs, so core/special-actions.ts can skip them without asking `check` for every object (it would deny every one). */
const PLANNED = new WeakSet<SpecialActionDef>();
export const isPlannedSpecialAction = (d: SpecialActionDef): boolean => PLANNED.has(d);

export function plannedSpecialAction(key: string, rule: string, zones: ZoneName[], timing: SpecialActionDef['timing'], what: string): SpecialActionDef {
  const d: SpecialActionDef = {
    key,
    rule,
    zones,
    timing,
    check: () => deny(`${what} is not implemented yet.`, rule),
    perform: () => {
      throw new Error(`special action "${key}" (${rule}) is planned, not implemented`);
    },
  };
  PLANNED.add(d);
  return d;
}
