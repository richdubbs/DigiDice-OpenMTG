/**
 * Registries of the game core (m6 design 2.6, 4.1, E17). Owner: M6-0, written once; every entry lives in its owner's file and is spread here. Every table
 * starts with the milestone 5 behavior: empty, or null.
 *
 *   MOVE_PARTS               parts of core/zones.ts#moveObject: before the new object enters (copy, CR 707.5; face down, CR 708.3; transformed) and after the old
 *                            one left (reveals, CR 708.9; the components of a melded or merged permanent, CR 712.21, 730.3).
 *   RESOLVE_PERMANENT_PARTS  parts of core/resolve.ts#resolvePermanentSpell (CR 608.3): change the move's options, or take the resolution over.
 *   TURN_BASED               turn-based hooks (CR 502.2 day/night, 714.3c lore counters, 614.10 skipping turns, phases and steps).
 *   SPECIAL_ACTION_HANDLERS  special actions (CR 116.2): core/legal.ts lists them, core/priority-actions.ts performs them. The milestone 5 keyword stubs
 *                            (foretell, suspend, plot, turning face up) are adapted by core/special-actions.ts and list nothing.
 *   VIEW_PARTS               parts of core/view.ts#viewFor: definitions a viewer needs although no visible object has them (copy snapshots, CR 707.2).
 */
import type { Action } from '../types/actions';
import type { CostDef } from '../types/ability';
import type { DefId, ObjectId, PlayerId } from '../types/ids';
import type { GameObject, GameState } from '../types/state';
import type { Proposed } from '../effects/api';
import type { Game } from './game';
import type { MoveOptions } from './zones';
import { COPY_MOVE_PARTS } from './move-parts/copy';
import { FACE_DOWN_MOVE_PARTS } from './move-parts/face-down';
import { COMPONENTS_MOVE_PARTS } from './move-parts/components';
import { PROTOTYPE_MOVE_PARTS } from './move-parts/prototype';
import { BESTOW_MOVE_PARTS } from './move-parts/bestow';
import { SPELL_EFFECTS_MOVE_PARTS } from './move-parts/spell-effects';
import { COMMANDER_MOVE_PARTS } from './move-parts/commander';
import { COPY_TOKEN_RESOLVE_PARTS } from './resolve-parts/copy-token';
import { FACE_DOWN_RESOLVE_PARTS } from './resolve-parts/face-down';
import { TRANSFORMED_RESOLVE_PARTS } from './resolve-parts/transformed';
import { PROTOTYPE_RESOLVE_PARTS } from './resolve-parts/prototype';
import { MUTATE_RESOLVE_PARTS } from './resolve-parts/mutate';
import { DAY_NIGHT_UNTAP } from './day-night';
import { LORE_PRECOMBAT_MAIN } from './lore';
import { RAD_PRECOMBAT_MAIN } from './rad';
import { TURN_SKIP_PROPOSE } from './turn-skip';
import { TURN_FACE_UP_HANDLERS } from './special/turn-face-up';
import { PLOT_HANDLERS } from './special/plot';
import { FORETELL_HANDLERS } from './special/foretell';
import { SUSPEND_HANDLERS } from './special/suspend';
import { COMPANION_HANDLERS } from './special/companion';
import { PLAY_OUTSIDE_HANDLERS } from './special/play-outside';
import { ROOM_MOVE_PARTS, ROOM_SPECIAL_HANDLERS } from './rooms';
import { KEYWORD_SPECIAL_HANDLERS } from './special-actions';
import { COPY_DEFS_VIEW_PARTS } from './view-parts/copy-defs';
import { COMPONENTS_VIEW_PARTS } from './view-parts/components';
import { COMMANDER_VIEW_PARTS } from './view-parts/commander';

/** Parts of core/zones.ts#moveObject. */
export interface MovePart {
  /**
   * After the new object exists in its new zone and BEFORE enterWithPrintedCounters and the zoneChanged event (CR 707.5: Spark Double enters with the copied
   * planeswalker's loyalty; CR 708.3, 712.14a). Reads the facts from `opts.enter`.
   */
  beforeEnter?(g: Game, o: GameObject, opts: MoveOptions): void;
  /** After the object left (old = its last known object), before zoneChanged: reveal (CR 708.9), components (CR 712.21, 730.3), revealedTo cleared. */
  afterLeave?(g: Game, old: GameObject, newId: ObjectId | null, opts: MoveOptions): void;
}
// M6-6 INTERFACE CHANGE: prototyped permanents (CR 718.3b); M6-8 INTERFACE CHANGE (additive): CR 400.7a, the effects that change a permanent spell's
// characteristics follow it onto the battlefield (move-parts/spell-effects.ts)
// M11-1: CR 903.9a, 704.6d: a commander put into a graveyard or exile is flagged (move-parts/commander.ts; after the components part, which splits a melded or
// merged permanent into its cards)
// FAST5X E8 INTERFACE CHANGE (additive): a Room enters with the unlocked designation of the half cast (CR 709.5d, core/rooms.ts)
export const MOVE_PARTS: readonly MovePart[] = [...COPY_MOVE_PARTS, ...FACE_DOWN_MOVE_PARTS, ...COMPONENTS_MOVE_PARTS, ...PROTOTYPE_MOVE_PARTS, ...SPELL_EFFECTS_MOVE_PARTS, ...ROOM_MOVE_PARTS, ...COMMANDER_MOVE_PARTS, ...BESTOW_MOVE_PARTS]; // BESTOW: std-ry7 (CR 702.103b)

/** Parts of core/resolve.ts#resolvePermanentSpell (CR 608.3): may change the move's options, or take over the resolution (return true). */
export interface ResolvePermanentPart {
  options?(g: Game, spell: GameObject, opts: MoveOptions): MoveOptions; // face down (M6-3), prototyped (M6-6), transformed (M6-4)
  instead?(g: Game, spell: GameObject): boolean; // copy of a permanent spell becomes a token (CR 707.10f, M6-2); mutate merges (CR 702.140c, M6-9)
}
export const RESOLVE_PERMANENT_PARTS: readonly ResolvePermanentPart[] = [
  ...COPY_TOKEN_RESOLVE_PARTS, ...FACE_DOWN_RESOLVE_PARTS, ...TRANSFORMED_RESOLVE_PARTS, ...PROTOTYPE_RESOLVE_PARTS, ...MUTATE_RESOLVE_PARTS,
];

/** Turn-based hooks (core/steps.ts, core/turn.ts call them; CR 502.2, 714.3c, 614.10). */
export interface TurnBasedHooks {
  untapSecondPart: readonly ((g: Game) => void)[]; // CR 502.2 (M6-4, core/day-night.ts)
  precombatMainBegins: readonly ((g: Game) => void)[]; // CR 714.3c (M6-6, core/lore.ts)
  /** Before a turn, phase or step begins: false = skipped (CR 614.10; M6-1, core/turn-skip.ts proposes it). M5 behavior: null, always begins. */
  propose: ((g: Game, what: Extract<Proposed, { ev: 'turn' | 'phase' | 'step' }>) => boolean) | null;
}
export const TURN_BASED: TurnBasedHooks = {
  untapSecondPart: DAY_NIGHT_UNTAP,
  precombatMainBegins: [...LORE_PRECOMBAT_MAIN, ...RAD_PRECOMBAT_MAIN], // std-rx17: CR 728.1, the rad counters' trigger (core/rad.ts)
  propose: TURN_SKIP_PROPOSE,
};

/** Special actions (CR 116.2). core/legal.ts lists, core/priority-actions.ts performs. Keyword stubs (foretell, suspend, plot) list nothing. */
export interface SpecialActionHandler {
  kind: string; // 'turnFaceUp', ...
  /**
   * FAST5X E8 INTERFACE CHANGE (additive): `door`, the half of a Room the action is for (the unlock cost, CR 709.5e, 116.2m). CMP1 INTERFACE CHANGE: `object`
   * may be absent for an action about no object (the companion, a card outside the game, CR 400.11, 116.2g); the listed action then has no `object`.
   */
  list(g: Game, player: PlayerId): { object?: ObjectId; via?: string; door?: number; option?: number; outside?: DefId; label: string; cost: CostDef | null }[]; // std-freecast-5: `option` (core/special/plot.ts); trek-11: `outside`, the card outside the game the action plays (core/special/play-outside.ts)
  /** trek-11 INTERFACE CHANGE (additive): the action depends on a hidden place (cards outside the game): core/legal.ts leaves it out of the public questions (`hasPublicPriorityActions`). */
  hidden?: true;
  perform(g: Game, action: Extract<Action, { type: 'special' }>): void; // throws IllegalAction when not listed
}
// FAST5X E6: plot (CR 702.170a-b, 116.2k), core/special/plot.ts, ahead of the adapted keyword stub, which lists nothing; ROOM: FAST5X E8 (CR 116.2m)
// CMP1: the companion special action (CR 702.139a, 116.2g), core/special/companion.ts; trek-11: playing a card from outside the game (CR 400.11), core/special/play-outside.ts
// cloud r3-mech: foretell (CR 702.143a-b, 116.2h), core/special/foretell.ts, ahead of the keyword stub, as plot; std-rx22: suspend (CR 702.62a, 116.2f), the same
export const SPECIAL_ACTION_HANDLERS: readonly SpecialActionHandler[] = [...TURN_FACE_UP_HANDLERS, ...PLOT_HANDLERS, ...FORETELL_HANDLERS, ...SUSPEND_HANDLERS, ...ROOM_SPECIAL_HANDLERS, ...COMPANION_HANDLERS, ...PLAY_OUTSIDE_HANDLERS, ...KEYWORD_SPECIAL_HANDLERS];

/** View parts (core/view.ts#viewFor). */
export interface ViewPart {
  /** Definitions a viewer needs although no visible object has them: those referenced by copy snapshots (M6-2, CR 707.2). */
  usedDefs?(state: GameState, viewer: PlayerId | null): Iterable<DefId>;
}
export const VIEW_PARTS: readonly ViewPart[] = [...COPY_DEFS_VIEW_PARTS, ...COMPONENTS_VIEW_PARTS, ...COMMANDER_VIEW_PARTS]; // M6-9: the components' definitions (core/view-parts/components.ts)
