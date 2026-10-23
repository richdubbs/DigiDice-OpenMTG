/**
 * Priority actions other than passing: playing lands (CR 305), casting spells (CR 601),
 * activating abilities (CR 602), special actions (CR 116).
 *
 * The player keeps priority afterwards (CR 117.3c, 116.2a). Taking an action also resets the count
 * of consecutive passes: "all players pass in succession" means without any action in between (CR 117.4).
 */
import type { Action } from '../types/actions';
import { activateAbility } from '../actions/activate';
import { castCheck, castSpell } from '../actions/cast';
import { landCheck, playLand } from '../actions/land';
import type { Denial } from '../rules/denial';
import type { GameState } from '../types/state';
import { performByHand } from './by-hand';
import { IllegalAction, type Game } from './game';
import { SPECIAL_ACTION_HANDLERS } from './registries';
import { resetPasses } from './turn';

export function performPriorityAction(g: Game, action: Action): void {
  switch (action.type) {
    case 'playLand':
      playLand(g, action);
      break;
    case 'cast':
      castSpell(g, action);
      break;
    case 'activate':
      activateAbility(g, action);
      break;
    case 'manualTrigger':
    case 'manualStatic':
      performByHand(g, action); // MRE (C6 gap 7): CR 603.3, 604.1
      break;
    case 'special': {
      // CR 116.2 (M6-0, m6 design D8): performed by the handler of its kind (core/registries.ts#SPECIAL_ACTION_HANDLERS), which rejects what it does not list.
      // No handler lists anything in M6-0 (turning face-down creatures face up arrives with M6-3), so every special action is still rejected.
      const h = SPECIAL_ACTION_HANDLERS.find((x) => x.kind === action.kind);
      if (!h) throw new IllegalAction(`There is no special action "${action.kind}" available.`, ['CR 116.1']);
      h.perform(g, action);
      break;
    }
    default:
      throw new IllegalAction(`"${action.type}" is not a priority action.`, ['CR 117.1']);
  }
  resetPasses(g);
}

/**
 * WP32 (performance): the denial `castSpell` or `playLand` would raise first, computed on the settled state before it is cloned for the action. They begin with
 * exactly this check on the clone, which differs from the settled state only in `pending` and `suspended` (no check reads them), so the answer and the
 * error are the same; an illegal cast or land play (CR 601.3, 305.1) is then rejected without copying the game. Null: the action proceeds as usual.
 */
export function earlyDenial(s: GameState, action: Action): Denial | null {
  if (action.type === 'cast') {
    const r = castCheck(s, action.player, action.card, action.face, action.method);
    return 'denial' in r ? r.denial : null;
  }
  if (action.type === 'playLand') {
    const r = landCheck(s, action.player, action.card, action.face);
    return 'denial' in r ? r.denial : null;
  }
  return null;
}
