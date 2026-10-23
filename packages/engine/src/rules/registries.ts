/**
 * Registries of the rules layer (m6 design 2.6, 4.1). Owner: M6-0, written once; each entry lives in its owner's part file and is spread here, so the packages
 * of a wave never edit a shared file (design E17). Every table starts with the milestone 5 behavior: empty.
 *
 *   BASE_PARTS     parts of rules/base-chars.ts#baseSource/baseChars: a part may claim the base characteristics of an object (a card exiled face down has
 *                  none, CR 406.3a: M6-3; a melded permanent, CR 712.8g: M6-4; a prototyped spell or permanent, CR 718.3b: M6-6; a Room permanent, CR 709.5: FAST5X E8). Statics may import
 *                  rules/base-chars only, so the parts are imported by base-chars.ts itself (through this module) and import only types and base-chars helpers
 *                  (no cycle through statics/layers; test/m5/skeleton/import-rules.test.ts).
 *   FILTER_PARTS   the `ObjectFilter` status fields (`solved`, `prepared`, `prototyped`, `flipped`) whose `filter:` / `sfilter:` capability is advertised: rules/filter.ts
 *                  and statics/match.ts evaluate all four (M6-0), and each owner lists its own field once its mechanism sets the status (M6-4: flipped; M6-6:
 *                  solved, prepared, prototyped), so a filter on a status nothing sets is never classified automated.
 */
import type { CardDef } from '../types/card';
import type { GameObject, GameState } from '../types/state';
import type { BaseChars } from './characteristics';
import type { BaseSource } from './base-chars';
import { FACE_DOWN_BASE_PARTS } from './base-parts/face-down';
import { MELDED_BASE_PARTS } from './base-parts/melded';
import { PROTOTYPE_BASE_PARTS } from './base-parts/prototype';
import { BESTOW_BASE_PARTS } from './base-parts/bestow';
import { ROOM_BASE_PARTS } from './base-parts/room';
import { DFC_FILTER_PARTS } from './filter-parts/dfc';
import { LEVELS_FILTER_PARTS } from './filter-parts/levels';
import { COMMANDER_FILTER_PARTS } from './filter-parts/commander';

/** A part of rules/base-chars.ts#baseSource/baseChars (m6 design 2.6): it may claim the base of an object. */
export interface BasePart {
  /** The base source of this object if the part claims it ('faceDownExile' (M6-3), 'melded' (M6-4), 'prototype' (M6-6)), or null. */
  source(def: CardDef, o: GameObject): BaseSource | null;
  /** The base characteristics of a claimed object (a fresh record, every array the caller's own). Absent: the M5 builder of that kind of source. */
  chars?(s: GameState, o: GameObject, src: BaseSource): BaseChars;
}

/** The base parts, in the order they are asked (the first that claims an object wins). Empty in M6-0. */
export const BASE_PARTS: readonly BasePart[] = [...FACE_DOWN_BASE_PARTS, ...MELDED_BASE_PARTS, ...PROTOTYPE_BASE_PARTS, ...ROOM_BASE_PARTS, ...BESTOW_BASE_PARTS]; // ROOM: FAST5X E8 (CR 709.5); BESTOW: std-ry7 (CR 702.103b)

/** The status fields of `ObjectFilter` (m6 design 2.1; M11-0, m11 design 4.5: `commander`, CR 903.3). */
export type FilterStatusField = 'solved' | 'prepared' | 'prototyped' | 'flipped' | 'commander' | 'harnessed'; // cloud r3-mech: harnessed (CR 701.64)
export const FILTER_STATUS_FIELDS: readonly FilterStatusField[] = ['solved', 'prepared', 'prototyped', 'flipped', 'commander', 'harnessed'];

/** The status fields whose capability is advertised, one list per owner (m6 design 2.6). Empty in M6-0: no mechanism sets any of them yet. */
// cloud r3-mech: harnessed, set by effects/handlers/levels.ts (designateObject 'harnessed', CR 701.64)
export const FILTER_PARTS: readonly (readonly FilterStatusField[])[] = [DFC_FILTER_PARTS, LEVELS_FILTER_PARTS, COMMANDER_FILTER_PARTS, ['harnessed']]; // M11-0: commander (M11-1)
