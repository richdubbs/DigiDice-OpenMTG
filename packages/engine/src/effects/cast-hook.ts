/**
 * The seam through which the `cast` op (effects/handlers/tokens-cast.ts) casts a card while a spell or ability is resolving (CR 608.2g, 701.5). Added by WP14.
 *
 * Casting is actions/cast.ts (CR 601.2a-i), which the interpreter may not import (design 5.4: effects never imports actions, and actions already imports effects).
 * So actions/cast.ts installs its resolution-time caster here when it loads, the way effects/eval.ts installs the quantity evaluator into effects/refs.ts. A
 * function registry, not game data: nothing about a game is kept here. Without a caster (a module graph that never loads actions/) the op is resolved by hand.
 */
import type { Game } from '../core/game';
import type { Denial } from '../rules/denial';
import type { CostDef } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';

/** How a card is cast during a resolution: `free` = "without paying its mana cost" (an alternative cost, CR 118.9; X is 0, CR 107.3b). */
export interface ResolutionCastOptions {
  free: boolean;
  /**
   * WP32 INTERFACE CHANGE (additive): only a face whose resulting spell has at most this mana value may be cast (cascade CR 702.85a, discover CR 701.57a).
   * Absent: no limit.
   */
  maxManaValue?: number;
  /**
   * FXC INTERFACE CHANGE (additive): "cast it transformed" (CR 712.11a): only the back face of a transforming double-faced card is cast, with its back face up
   * (CR 712.8c). A card that is not a transforming double-faced card can't be cast this way.
   */
  transformed?: boolean;
  /**
   * M6-12 INTERFACE CHANGE (additive): "cast it by paying [cost] rather than paying its mana cost" (madness, CR 702.35a-b): an alternative cost (CR 118.9)
   * named `name` (recorded as `CostsPaid.alternative`, read by `wasCast.via`). Not with `free`. Its payment follows CR 601.2b, 601.2f-h (X announced when
   * the cost has one, cost increases and reductions applied, additional costs added).
   */
  alternative?: { name: string; cost: CostDef };
  /**
   * FAST5X E26 INTERFACE CHANGE (additive): the object is a copy of a card the resolving effect just created to be cast (CR 707.12: "cast a copy of an object";
   * paradigm, CR 702.192a). Such a copy (`kind: 'spellCopy'`, not on the stack) may be cast; without this flag only cards can be (CR 601.3).
   */
  copy?: true;
  /** FAST5X E29 INTERFACE CHANGE (additive), CR 609.4b: "and mana of any type can be spent to cast that spell" (rules/sources.ts `SpendContext.anyType`). */
  anyManaType?: boolean;
}

/** Can `player` cast `card` now, as an effect instructs (CR 608.2g)? Null when they can, else why not. Pure. */
export type ResolutionCastCheck = (g: Game, player: PlayerId, card: ObjectId, opts: ResolutionCastOptions) => Denial | null;

/** Cast it (CR 601.2a-i, no player receives priority afterwards, CR 608.2g). Call only after the check said yes. Returns the spell's id on the stack. */
export type ResolutionCast = (g: Game, player: PlayerId, card: ObjectId, opts: ResolutionCastOptions) => ObjectId | null;

export interface ResolutionCaster {
  check: ResolutionCastCheck;
  cast: ResolutionCast;
}

let caster: ResolutionCaster | null = null;

/** Called once by actions/cast.ts when it loads. */
export function installResolutionCaster(c: ResolutionCaster): void {
  caster = c;
}

/**
 * FAST5X E26 (CR 305.2a-b, 305.3, 305.9; hideaway "you may play the exiled card", CR 702.75a): playing a land as part of a resolution. `check` says why the player
 * can't play this card as a land now (not their turn, no land play left, not a land, a restriction), `play` puts it onto the battlefield as their land play.
 * Installed by actions/land.ts (design 5.4: the interpreter does not import actions).
 */
export interface ResolutionLandPlayer {
  check: (g: Game, player: PlayerId, card: ObjectId) => Denial | null;
  play: (g: Game, player: PlayerId, card: ObjectId) => ObjectId | null;
}

let landPlayer: ResolutionLandPlayer | null = null;

/** Called once by actions/land.ts when it loads. */
export function installResolutionLandPlayer(p: ResolutionLandPlayer): void {
  landPlayer = p;
}

/** The installed land player, or null (then playing a land during a resolution is resolved by hand). */
export const resolutionLandPlayer = (): ResolutionLandPlayer | null => landPlayer;

/** The installed caster, or null (then casting during a resolution is resolved by hand). */
export const resolutionCaster = (): ResolutionCaster | null => caster;
