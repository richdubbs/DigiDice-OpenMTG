/**
 * std-mana-12: `reportAction` (CR 603.2): the player performed a keyword action that other abilities can see ("Whenever you waterbend, earthbend, firebend, or airbend",
 * Avatar Aang). The earthbend macro (CR 701.66, keywords/actions/bending.ts) ends with it, and the firebending trigger (CR 702.189, keywords/data/firebending.json)
 * reports "you firebend" as it resolves. It emits `actionPerformed` with the verb, which triggers/normalize.ts turns into the `action` event (and the turn history,
 * so "you've done all four this turn" reads it).
 */
import { isPlayerOnlyRefKind, type EffectStep } from '../../types/ability';
import type { StepHandler } from '../api';
import { resolveObjs } from '../refs';
import { firstPlayer, NOTHING } from './zones-util';

type Step = Extract<EffectStep, { op: 'reportAction' }>;

const reportAction: StepHandler<Step> = (cx, st) => {
  const player = firstPlayer(cx, st.who);
  if (player === undefined) return NOTHING;
  // edh-next-33 (CR 701.50a): a connive reports the permanent that connived
  const object = st.object === undefined || isPlayerOnlyRefKind(st.object.ref) ? undefined : resolveObjs(cx, st.object)[0];
  // edh-d-89 (CR 702.122e): a crew ability's own crewers go with its "becomes crewed" event (the resolving ability's paid cost; a copy paid nothing)
  const crewers = st.verb === 'crew' && cx.stack !== undefined && cx.stack !== null ? (cx.stack.costsPaid.crewers ?? []).length : undefined;
  cx.g.emit({ type: 'actionPerformed', verb: st.verb, actor: player, ...(object !== undefined ? { objectId: object.id } : {}), ...(crewers !== undefined ? { crewers } : {}) });
  return { performed: true, count: 1 };
};

export const REPORT_ACTION_HANDLERS = { reportAction };
