/**
 * std-mana-12: `reportAction` (CR 603.2): the player performed a keyword action that other abilities can see ("Whenever you waterbend, earthbend, firebend, or airbend",
 * Avatar Aang). The earthbend macro (CR 701.66, keywords/actions/bending.ts) ends with it, and the firebending trigger (CR 702.189, keywords/data/firebending.json)
 * reports "you firebend" as it resolves. It emits `actionPerformed` with the verb, which triggers/normalize.ts turns into the `action` event (and the turn history,
 * so "you've done all four this turn" reads it).
 */
import type { EffectStep } from '../../types/ability';
import type { StepHandler } from '../api';
import { firstPlayer, NOTHING } from './zones-util';

type Step = Extract<EffectStep, { op: 'reportAction' }>;

const reportAction: StepHandler<Step> = (cx, st) => {
  const player = firstPlayer(cx, st.who);
  if (player === undefined) return NOTHING;
  cx.g.emit({ type: 'actionPerformed', verb: st.verb, actor: player });
  return { performed: true, count: 1 };
};

export const REPORT_ACTION_HANDLERS = { reportAction };
