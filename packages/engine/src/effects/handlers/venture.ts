/**
 * MX4: the native keyword action venture into the dungeon (CR 701.49), run by the `action` op (handlers/game.ts) through NATIVE_ACTIONS (actions-native.ts).
 * Step: `{op:'action', action:'venture', who}`; `arg: 'Undercity'` is "venture into Undercity" (CR 701.49d, the initiative's abilities, CR 726.2). The work is
 * core/dungeons.ts#ventureIntoDungeon (choose a dungeon or the next room, trigger the room ability, complete a dungeon on its bottommost room).
 *
 * Fail closed (design 10): while text the engine does not run changes venturing or room abilities ("Each opponent can't venture into the dungeon more than
 * once each turn.", "Room abilities of dungeons you own trigger an additional time."), the venture is resolved by hand.
 */
import { UNDERCITY, ventureIntoDungeon } from '../../core/dungeons';
import type { EffectStep } from '../../types/ability';
import type { StepHandler } from '../api';
import { evalQty } from '../eval';
import { modifiedByManualText } from './manual-text';
import { byHand, firstPlayer, NOTHING } from './zones-util';

type ActionStep = Extract<EffectStep, { op: 'action' }>;

/** Capability names (`feature:action.native.<name>`) of the native action of this module. */
export const VENTURE_FEATURES: readonly string[] = ['action.native.venture'];

/**
 * Text that changes how venturing works (Keen-Eared Sentry: "can't venture into the dungeon more than once each turn"; Hama Pashar, Dungeon Delver: "Room
 * abilities of dungeons you own trigger an additional time"). A manual card that merely ventures ("..., venture into the dungeon.") does not stop it.
 */
const MODIFIERS = /\bcan't venture\b|\broom abilities\b/i;

const venture: StepHandler<ActionStep> = (cx, st) => {
  const g = cx.g;
  const player = firstPlayer(cx, st.who);
  if (player === undefined) return NOTHING;
  if (st.arg !== undefined && st.arg !== UNDERCITY) return byHand(cx, st, `venture into ${st.arg} is not a dungeon quality this build knows (CR 701.49d)`);
  const modified = modifiedByManualText(g, MODIFIERS);
  if (modified) return byHand(cx, st, `venturing is modified by text the engine does not run (CR 701.49), ${modified}`);
  const times = st.n === undefined ? 1 : evalQty(cx, st.n) ?? 0;
  let moved = 0;
  for (let i = 0; i < times; i++) if (ventureIntoDungeon(g, player, st.arg)) moved++;
  return { performed: moved > 0, count: moved };
};

export const VENTURE_NATIVES: Readonly<Record<string, StepHandler<ActionStep>>> = { venture };
