/**
 * Applying one replacement or prevention effect to a proposed event (CR 614.1, 614.12, 615), for the proposal pipeline (effects/propose.ts, design 8.5).
 * Owner: WP11 (an addition to the files of design 5.1, split out of propose.ts); M6-1 from W1. Every body returns the modified event, or null when the event no
 * longer happens (prevented entirely, CR 615.6, 614.7a; an Aura with nothing to enchant stays where it is, CR 303.4g, 303.4i).
 *
 * M6-0 (m6 design 2.6, E17): `applyBody` dispatches on the body's `b` through effects/registries.ts#BODY_KINDS (the milestone 5 bodies moved unchanged to
 * effects/bodies/m5.ts), then lets the parts of the M6 fields add what they decide: an `enters` body's copy, face down, transformed and prepared
 * (`ENTERS_PARTS`, CR 614.1c-d, 614.12) and a destination's transformed, face down on the battlefield, attacking, attached, order and owner
 * (`DESTINATION_PARTS`). `effects/replacements.ts#bodyFits` admits a body only when every M6 field it has has a registered part, so with the parts empty (M6-0)
 * nothing changes.
 */
import type { Game } from '../core/game';
import type { ReplacementBody } from '../types/ability';
import type { Proposed } from './api';
import { BODY_KINDS, DESTINATION_PARTS, ENTERS_PARTS, type BodyKind } from './registries';
import { setShieldLeft } from './perform-events';
import type { Candidate } from './replacements';

export { shieldBudgetLeft } from './bodies/m5';

/** The `enters` fields that are M6 parts, and whether a body sets each one. */
export const ENTERS_PART_FIELDS = ['copy', 'faceDown', 'transformed', 'prepared'] as const;
export const entersFieldSet = (b: Extract<ReplacementBody, { b: 'enters' }>, f: (typeof ENTERS_PART_FIELDS)[number]): boolean => b[f] !== undefined && b[f] !== false;

/**
 * The destination fields that are M6 parts and whether a destination sets each one: transformed, attacking, attachedTo, order, owner anywhere, and faceDown on
 * the battlefield (CR 708.2a; face down elsewhere is milestone 5's, CR 406.3).
 */
export const DESTINATION_PART_FIELDS = ['transformed', 'attacking', 'attachedTo', 'order', 'owner', 'faceDown'] as const;
export const destinationFieldSet = (d: NonNullable<Extract<ReplacementBody, { b: 'modify' }>['destination']>, f: (typeof DESTINATION_PART_FIELDS)[number]): boolean =>
  d[f] !== undefined && d[f] !== false && (f !== 'faceDown' || d.zone === 'battlefield');

/**
 * Apply one candidate's body. Unknown combinations never reach here (`bodyFits`); this returns the event unchanged for them as a second line of defence.
 * `shares`: for damage dealt at the same time as other damage, how much of each "prevent the next N" shield (by record id) this event may use (CR 615.7).
 */
export function applyBody(g: Game, e: Proposed, c: Candidate, shares?: ReadonlyMap<string, number>): Proposed | null {
  const b = c.def.body;
  const kind = BODY_KINDS[b.b] as BodyKind | undefined;
  if (!kind) return e;
  let out = kind.apply(g, e, b, c, shares);
  // M6-1 (m6 design 3.2): a shield of any other body counts its applications ("the next time": 1, CR 614.1); prevention and a redirect with a budget count
  // damage themselves (CR 615.7). A body that left the event as it was (a redirect to nothing, CR 614.9) did not apply.
  if (c.recId !== undefined && out !== e && b.b !== 'prevent' && !(b.b === 'redirect' && b.amount !== undefined)) {
    const rec = g.s.continuousEffects.find((r) => r.id === c.recId);
    const uses = rec?.effect.s === 'replace' ? rec.effect.shield?.uses : undefined;
    if (rec && typeof uses === 'number') setShieldLeft(g, rec.id, (rec.usesLeft ?? uses) - 1);
  }
  // M6-0: the parts of the M6 fields, applied to the event as the body left it (choices first, CR 614.12a; empty in M6-0)
  if (b.b === 'enters' && out && out.ev === 'zoneChange' && out.to === 'battlefield' && e.ev === 'zoneChange') {
    for (const p of ENTERS_PARTS) if (entersFieldSet(b, p.field)) out = { ...out, destination: { ...out.destination, ...p.apply(g, e, b, c) } };
  }
  if (b.b === 'modify' && b.destination && out && out.ev === 'zoneChange') {
    const d = b.destination;
    for (const p of DESTINATION_PARTS) {
      if ((DESTINATION_PART_FIELDS as readonly string[]).includes(p.field) && destinationFieldSet(d, p.field as (typeof DESTINATION_PART_FIELDS)[number])) {
        out = { ...out, destination: { ...out.destination, ...p.toFacts(g, e, d) } };
      }
    }
  }
  return out;
}
