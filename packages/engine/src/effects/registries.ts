/**
 * Registries of the interpreter (m6 design 2.6, 4.1, E17). Owner: M6-0, written once; every entry lives in its owner's file and is spread here, so the
 * packages of a wave never edit a shared file. Every table starts with the milestone 5 behavior (moved unchanged) or empty.
 *
 *   BODY_KINDS          the replacement body kinds by `b`: `bodyFits` (effects/replacements.ts) and `applyBody` (effects/replace-bodies.ts) dispatch on it, and
 *                       `REPLACEMENT_BODIES` (the `body:` capability table, effects/propose.ts) is built from the entries' `capabilities`. M5: enters, modify,
 *                       prevent, regeneration (effects/bodies/m5.ts); M6-1: instead, redirect, skip (effects/instead.ts, effects/prevent.ts); M6-3: during
 *                       (effects/bodies/during.ts).
 *   ENTERS_PARTS        the M6 fields of an `enters` body (copy M6-2, faceDown M6-3, transformed M6-4, prepared M6-6): `bodyFits` accepts an `enters` body only
 *                       if every field it sets has a registered part; `applyBody` adds what each part decides (CR 614.1c-d, 614.12).
 *   DESTINATION_PARTS   the same for the fields of `modify.destination` (order, owner, attacking, attachedTo M6-1; faceDown on the battlefield M6-3;
 *                       transformed M6-4).
 *   PROPOSAL_KINDS      one entry per `Proposed['ev']` (total: a new kind does not compile until it has one): `semOf`, `affectedPlayer` (CR 616.1), the
 *                       "can't" check (CR 614.17), the performer and the `feature:replace.on.*` names. M5 kinds: effects/proposal-kinds/m5.ts; phase and turn
 *                       (M6-1), turnFaceUp (M6-3), transform (M6-4) are stubs with no capability that nothing proposes until their owner lands.
 *   RULE_REPLACEMENTS   replacement effects the rules generate (CR 714.3a-b: Sagas; M6-6, effects/rule-replacements/saga.ts; CR 903.9b: a commander to the
 *                       command zone, M11-1, effects/rule-replacements/commander.ts). Read by `applicable`.
 *   IMMEDIATE_CHECKS    checks that happen "immediately" (CR 702.145c-d, 702.145f-g; M6-4, core/day-night.ts): after every performed event
 *                       (effects/perform.ts) and first in each state-based action check (core/sba.ts).
 *
 * Import rules (m6 design 4.4; test/m5/skeleton/import-rules.test.ts): this module imports only types from effects/api.ts, core/game.ts and types/*, plus the
 * part files. The part files must not import this module's dispatchers (effects/replacements.ts, replace-bodies.ts, propose.ts, perform.ts, cant.ts) or
 * there is an import cycle: they reach the pipeline's helpers through leaf modules (effects/replace-ctx.ts, effects/perform-events.ts, ...).
 */
import type { Game } from '../core/game';
import type { Destination, ReplacementBody } from '../types/ability';
import type { PlayerId, ObjectId } from '../types/ids';
import type { GameObject, GameState, SemEvent } from '../types/state';
import type { Chars } from '../rules/characteristics';
import type { DestinationFacts, Proposed } from './api';
import type { CallerOptions, Performed } from './perform-events';
import type { Candidate } from './replacements';
import { ENTERS_BODY, MODIFY_BODY, PREVENT_BODY, REGENERATION_BODY } from './bodies/m5';
import { DURING_BODY_KINDS } from './bodies/during';
import { HEAL_BODY_KINDS } from './bodies/heal';
import { UMBRA_ARMOR_BODY_KINDS } from './bodies/umbra-armor';
import { INSTEAD_BODY_KINDS } from './instead';
import { PREVENT_BODY_KINDS } from './prevent';
import { ALL_ENTERS_PARTS } from './enters-parts/all'; // CMD3: the list lives in a leaf module (effects/entering-state.ts reads it too)
import { ORDER_DESTINATION_PARTS } from './destination-parts/order';
import { OWNER_DESTINATION_PARTS } from './destination-parts/owner';
import { ATTACKING_DESTINATION_PARTS } from './destination-parts/attacking';
import { ATTACHED_TO_DESTINATION_PARTS } from './destination-parts/attached-to';
import { FACE_DOWN_DESTINATION_PARTS } from './destination-parts/face-down';
import { TRANSFORMED_DESTINATION_PARTS } from './destination-parts/transformed';
import { COUNTERS_KIND, CREATE_TOKEN_KIND, DAMAGE_KIND, DESTROY_KIND, DRAW_KIND, LIFE_KIND, STEP_KIND, ZONE_CHANGE_KIND } from './proposal-kinds/m5';
import { PHASE_KIND } from './proposal-kinds/phase';
import { MILL_KIND } from './proposal-kinds/mill';
import { PAY_LIFE_KIND } from './proposal-kinds/pay-life';
import { DRAW_MANY_KIND } from './proposal-kinds/draw-many';
import { EXPLORE_KIND } from './proposal-kinds/explore';
import { PROLIFERATE_KIND } from './proposal-kinds/proliferate';
import { SCRY_KIND } from './proposal-kinds/scry';
import { CONNIVE_KIND } from './proposal-kinds/connive';
import { TURN_KIND } from './proposal-kinds/turn';
import { TURN_FACE_UP_KIND } from './proposal-kinds/turn-face-up';
import { TRANSFORM_KIND } from './proposal-kinds/transform';
import { SAGA_RULE_REPLACEMENTS } from './rule-replacements/saga';
import { COMMANDER_RULE_REPLACEMENTS } from './rule-replacements/commander';
import { FINALITY_RULE_REPLACEMENTS } from './rule-replacements/finality';
import { PERMIT_ENTERS_RULE_REPLACEMENTS } from './rule-replacements/permit-enters';
import { PERMIT_GRAVEYARD_RULE_REPLACEMENTS } from './rule-replacements/permit-graveyard';
import { SHIELD_BODY, SHIELD_RULE_REPLACEMENTS } from './rule-replacements/shield';
import { DAY_NIGHT_IMMEDIATE_CHECKS } from '../core/day-night';
import { CONTROL_IMMEDIATE_CHECKS } from '../core/control';
import { STORIED_IMMEDIATE_CHECKS } from '../core/enduring-story';
import { ASCEND_IMMEDIATE_CHECKS } from '../core/citys-blessing';

// ---- body kinds ----------------------------------------------------------------------------------------------------------------------------------------

/**
 * A replacement body kind. `bodyFits` / `applyBody` dispatch on `b`; `REPLACEMENT_BODIES` (the `body:` capability table, effects/propose.ts) is built from
 * the `capabilities` of the registered entries (e.g. ['instead'] -> 'body:instead'; empty until the owning package's tests pass).
 */
export interface BodyKind<B extends ReplacementBody = ReplacementBody> {
  capabilities: readonly string[];
  fits(g: Game, e: Proposed, b: B): boolean;
  apply(g: Game, e: Proposed, b: B, c: Candidate, shares?: ReadonlyMap<string, number>): Proposed | null;
}
export type BodyKinds = { [K in ReplacementBody['b']]?: BodyKind<Extract<ReplacementBody, { b: K }>> };

export const BODY_KINDS: BodyKinds = {
  enters: ENTERS_BODY,
  modify: MODIFY_BODY,
  prevent: PREVENT_BODY,
  regeneration: REGENERATION_BODY,
  ...INSTEAD_BODY_KINDS,
  ...PREVENT_BODY_KINDS,
  ...DURING_BODY_KINDS,
  ...HEAL_BODY_KINDS, // Cloud r5-repl: CR 614.1a, "instead that damage is dealt, but all other damage already dealt to him is healed"
  ...UMBRA_ARMOR_BODY_KINDS, // std-rx24: CR 702.89a, umbra armor (keywords/data/umbra-armor.json)
  shieldCounter: SHIELD_BODY, // FAST5X E28: CR 122.1c, generated by the rules only (effects/rule-replacements/shield.ts)
};

/** A field of an `enters` body (copy, faceDown, transformed, prepared). `bodyFits` accepts an `enters` body only if every present field has a registered part (CR 614.1c-d, 614.12). */
export interface EntersPart {
  field: 'copy' | 'faceDown' | 'transformed' | 'prepared';
  capability: string; // 'body:enters.copy', ...; registered by the owner
  /** r4-copy (additive): further value forms of the same field the part runs ('body:enters.copy.then'). */
  extraCapabilities?: readonly string[];
  /** Decide as the object would enter (choices first, CR 614.12a): returns the facts the move carries. */
  apply(g: Game, e: Extract<Proposed, { ev: 'zoneChange' }>, body: Extract<ReplacementBody, { b: 'enters' }>, c: Candidate): Partial<DestinationFacts>;
  /** CR 614.12: put the facts onto the hypothetical object `asItWouldEnter` builds (a copy of the state, never the live one). */
  hypothetical(alt: GameState, o: GameObject, facts: DestinationFacts): void;
}

/** The same for the fields of `modify.destination` (transformed, faceDown on the battlefield, attacking, attachedTo, order, owner). */
export interface DestinationPart {
  field: keyof Destination;
  capability: string; // 'body:modify.destination.transformed', ...
  fits(e: Proposed, d: Destination): boolean;
  toFacts(g: Game, e: Proposed, d: Destination): Partial<DestinationFacts>;
}

export const ENTERS_PARTS: readonly EntersPart[] = ALL_ENTERS_PARTS; // copy M6-2, faceDown M6-3, transformed M6-4, prepared M6-6 (effects/enters-parts/all.ts)
export const DESTINATION_PARTS: readonly DestinationPart[] = [
  ...ORDER_DESTINATION_PARTS, ...OWNER_DESTINATION_PARTS, ...ATTACKING_DESTINATION_PARTS, ...ATTACHED_TO_DESTINATION_PARTS, ...FACE_DOWN_DESTINATION_PARTS,
  ...TRANSFORMED_DESTINATION_PARTS,
];

// ---- proposal kinds ------------------------------------------------------------------------------------------------------------------------------------

/** One proposed event kind: everything that used to be an exhaustive switch over `Proposed` (affectedPlayer, semOf, performEvent, effects/cant.ts). */
export interface ProposalKind<E extends Proposed = Proposed> {
  ev: E['ev'];
  /** The `feature:replace.on.<ev>[.<verb>]` names a pattern of this kind may need (registered by the owner with this entry). */
  capabilities: readonly string[];
  semOf(g: Game, e: E): SemEvent;
  affectedPlayer(g: Game, e: E): PlayerId; // CR 616.1
  forbidden?(g: Game, e: E): string | null; // CR 614.17: why it can't happen (a log line), or null
  /**
   * Perform the event (a performer module: effects/perform-events.ts). `caller` (M6-0, additive to the design's contract): the options of the milestone 3/4
   * call-site a funnel came through (damage, destroy), passed on to the primitive. null: nothing happened.
   */
  perform(g: Game, e: E, caller?: CallerOptions): Performed | null;
  /** CR 614.12, 708.11, 712.20: whose self replacement effects apply, read from the characteristics it WILL have (entering, face up, the other face). */
  selfCandidatesFrom?(g: Game, e: E): { object: ObjectId; chars: Chars } | null;
}
export type ProposalKinds = { [K in Proposed['ev']]: ProposalKind<Extract<Proposed, { ev: K }>> };

export const PROPOSAL_KINDS: ProposalKinds = {
  damage: DAMAGE_KIND,
  life: LIFE_KIND,
  draw: DRAW_KIND,
  zoneChange: ZONE_CHANGE_KIND,
  createToken: CREATE_TOKEN_KIND,
  counters: COUNTERS_KIND,
  destroy: DESTROY_KIND,
  step: STEP_KIND,
  phase: PHASE_KIND,
  turn: TURN_KIND,
  turnFaceUp: TURN_FACE_UP_KIND,
  transform: TRANSFORM_KIND,
  mill: MILL_KIND, // Cloud r3-repl (CR 701.17a, 614.1a)
  drawMany: DRAW_MANY_KIND, // Cloud r4-repl (CR 121.2, 614.1a)
  explore: EXPLORE_KIND, // Cloud r4-repl (CR 701.44a, 614.1a)
  connive: CONNIVE_KIND, // Cloud r3-repl (CR 701.50a, 614.1a)
  payLife: PAY_LIFE_KIND, // std-library-4 (CR 119.4, 614.1a)
  proliferate: PROLIFERATE_KIND, // p2-replace-events-2 (CR 701.34a, 614.1a)
  scry: SCRY_KIND, // p2-replace-events-3 (CR 701.22a, 614.1a)
};

/** The kind of a proposed event (a typed view of `PROPOSAL_KINDS[e.ev]`). */
export const kindOf = (e: Proposed): ProposalKind => PROPOSAL_KINDS[e.ev] as unknown as ProposalKind;

// ---- rule replacements and immediate checks ------------------------------------------------------------------------------------------------------------

/** Replacement effects the RULES generate (not card text): CR 714.3a (a Saga enters with a lore counter), 714.3b (read ahead's chosen number). */
export type RuleReplacement = (g: Game, e: Proposed) => Candidate[];
// FAST5X E13: finality counters (CR 122.1h, effects/rule-replacements/finality.ts)
// M11-1: CR 903.9b (effects/rule-replacements/commander.ts); FAST5X E28: shield counters (CR 122.1c, effects/rule-replacements/shield.ts)
// C10: the "enters with" rider of a graveyard permission (CR 614.1c, effects/rule-replacements/permit-enters.ts)
export const RULE_REPLACEMENTS: readonly RuleReplacement[] = [...SAGA_RULE_REPLACEMENTS, ...FINALITY_RULE_REPLACEMENTS, ...COMMANDER_RULE_REPLACEMENTS, ...SHIELD_RULE_REPLACEMENTS, ...PERMIT_ENTERS_RULE_REPLACEMENTS, ...PERMIT_GRAVEYARD_RULE_REPLACEMENTS];

/** Checks that happen "immediately" (CR 702.145c-d, 702.145f-g): after every performed event (effects/perform.ts) and first in each SBA check (core/sba.ts). */
// MX2: the controller after layer 2 is written to the stored controller first (core/control.ts, CR 613.1b), so the other checks read who controls what now
// FAST5X E18: Storied gives an enduring story "any time" its condition is true (reminder text; ascend's CR 702.131b), core/enduring-story.ts
// CMD3: ascend on a permanent gives the city's blessing "any time" (CR 702.131b), core/citys-blessing.ts
export const IMMEDIATE_CHECKS: readonly ((g: Game) => void)[] = [...CONTROL_IMMEDIATE_CHECKS, ...DAY_NIGHT_IMMEDIATE_CHECKS, ...STORIED_IMMEDIATE_CHECKS, ...ASCEND_IMMEDIATE_CHECKS];
