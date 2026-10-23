/**
 * CR 701 actions that no fixed list of primitive steps can express, run by a native handler (design 7.5, `ActionMacro.native`): the handlers live in
 * effects/handlers/actions-native.ts (WP32), which the `action` op (effects/handlers/game.ts) calls by the name given here. Owner: WP32.
 * `action:<name>` is advertised only when that module registers `feature:action.native.<name>` (keywords/needs.ts#actionNeeds).
 */
import type { ActionMacro } from '../types';

/** CR 702.85a: cascade (the keyword's triggered ability performs this action). An unbounded "exile until" loop with a cast in the middle. */
export const CASCADE: ActionMacro = { name: 'cascade', rule: 'CR 702.85a', native: 'cascade' };

/** CR 701.57a: discover N. The same loop with "mana value N or less", and the card goes to its owner's hand if it isn't cast. */
export const DISCOVER: ActionMacro = { name: 'discover', rule: 'CR 701.57a', native: 'discover' };

/**
 * CR 701.34a: proliferate. Choosing among permanents AND players and reading the kinds of counters each one already has is no fixed list of steps; run by
 * effects/handlers/actions-native-counters.ts (PUSH1 T1).
 */
export const PROLIFERATE: ActionMacro = { name: 'proliferate', rule: 'CR 701.34a', native: 'proliferate' };

/** CR 701.39a: bolster N. "The least toughness among creatures you control" is an extremum no ObjectFilter has; run by actions-native-counters.ts (PUSH1 T1). */
export const BOLSTER: ActionMacro = { name: 'bolster', rule: 'CR 701.39a', native: 'bolster' };

/**
 * CR 701.37a: monstrosity N, "If this permanent isn't monstrous, put N +1/+1 counters on it and it becomes monstrous." The designation is the one state of
 * `GameObject.monstrous` (CR 701.37b); run by actions-native-counters.ts (FAST5 T37).
 */
export const MONSTROSITY: ActionMacro = { name: 'monstrosity', rule: 'CR 701.37a', native: 'monstrosity' };
/** std-ry8, CR 702.112a: renown N, "put N +1/+1 counters on it and it becomes renowned" (the keyword's triggered ability, keywords/data/renown.json). */
export const RENOWN: ActionMacro = { name: 'renown', rule: 'CR 702.112a', native: 'renown' };

/**
 * cloud std-spm, CR 701.10e: "double the number of each kind of counter on <subject>": every kind of counter the object or player has is doubled, the kinds read
 * as the action is performed (no fixed list of primitive steps can name them); run by actions-native-counters.ts.
 */
export const DOUBLE_EACH_KIND: ActionMacro = { name: 'doubleEachKind', rule: 'CR 701.10e', native: 'doubleEachKind' };

/**
 * r5-refs, CR 122.6 (and CR 701.34a, proliferate's "give each another counter of each kind already there", for named holders): "for each kind of counter on
 * <subject>, give that permanent or player another counter of that kind": one more counter of every kind the object or player has, the kinds read as the action
 * is performed (as doubleEachKind); run by actions-native-counters.ts.
 */
export const ANOTHER_OF_EACH_KIND: ActionMacro = { name: 'anotherOfEachKind', rule: 'CR 701.34a', native: 'anotherOfEachKind' };

/** CR 701.38a: each player votes, starting with a specified player and proceeding in turn order; only votes for objects (`subject`) are run. */
export const VOTE: ActionMacro = { name: 'vote', rule: 'CR 701.38a', native: 'vote' };

/** FAST5X E1, CR 702.174c: "gives a gift": the event the gift's own data emits after the gift (effects/handlers/gift.ts). */
export const GIVE_GIFT: ActionMacro = { name: 'giveGift', rule: 'CR 702.174c', native: 'giveGift' };
/**
 * MX4, CR 701.49: venture into the dungeon (and "venture into Undercity", CR 701.49d, with `arg`). Choosing a dungeon or a room and triggering the room's
 * ability is no fixed list of steps; run by effects/handlers/venture.ts over core/dungeons.ts.
 */
export const VENTURE: ActionMacro = { name: 'venture', rule: 'CR 701.49', native: 'venture' };
/**
 * FAST5 MX7, CR 701.48a: learn. A choice among a discard-then-draw and the Lesson cards the player owns outside the game (GameState.outside, CR 400.11a); run by
 * effects/handlers/learn.ts.
 */
export const LEARN: ActionMacro = { name: 'learn', rule: 'CR 701.48a', native: 'learn' };
/**
 * CR 701.51: open an Attraction. A player may open one only in a game played with an Attraction deck (CR 701.51a); this build has none, so the handler
 * (effects/handlers/attraction.ts, T38) logs that nothing is opened.
 */
export const OPEN_ATTRACTION: ActionMacro = { name: 'openAttraction', rule: 'CR 701.51a', native: 'openAttraction' };

/**
 * FAST5X E10, CR 701.65a-b: airbend. Exiling the objects and giving each exiled card's OWNER the right to cast it for {2} rather than its mana cost for as long as
 * it stays exiled is a mark on the exiled card and a cast option (actions/cast-opt/airbend.ts), no fixed list of steps; run by effects/handlers/airbend.ts.
 */
export const AIRBEND: ActionMacro = { name: 'airbend', rule: 'CR 701.65a', native: 'airbend' };

/**
 * FAST5X E11, CR 701.4a: behold a [quality]: reveal a [quality] card from your hand or choose a [quality] permanent you control. `arg` is the quality, one
 * subtype ("behold an Elf"); run by effects/handlers/behold.ts. "If you do" reads whether something was beheld.
 */
export const BEHOLD: ActionMacro = { name: 'behold', rule: 'CR 701.4a', native: 'behold' };

/**
 * M12-3 (m12 design D14, 4.3), CR 701.15a-d: goad. The creature records who goaded it (`GameObject.goaded`), which ends at that player's next turn (CR 701.15a,
 * 800.4m; core/durations.ts), and the two combat requirements are read from it (statics/requirements.ts#goadHits, CR 701.15b): no fixed list of steps says
 * "until the next turn of the controller" of a designation with requirements on the choice of defender. Run by effects/handlers/goad.ts.
 */
export const GOAD: ActionMacro = { name: 'goad', rule: 'CR 701.15a', native: 'goad' };
