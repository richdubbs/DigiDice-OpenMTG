/**
 * The special actions keywords grant (CR 116.2: foretell, suspend, plot, turning a face-down permanent face up; keywords/special/), as entries of
 * core/registries.ts#SPECIAL_ACTION_HANDLERS. Owner: M6-0 (m6 design D8, 2.6, 4.2). A keyword's special action is listed for each object in its zones that the
 * player controls (the owner for objects outside the battlefield and the stack) and that its `check` allows, and performed only when it is listed (CR 116.2:
 * an illegal special action is rejected, CR 733). Every keyword special action of this build is a planned stub (keywords/special/stub.ts) whose check always
 * denies: the stubs list nothing, so special actions are behavior-neutral until their owners implement them (turning face up: M6-3,
 * core/special/turn-face-up.ts).
 */
import type { PlayerId } from '../types/ids';
import { SPECIAL_ACTIONS } from '../keywords/special';
import { isPlannedSpecialAction } from '../keywords/special/stub';
import type { SpecialActionDef } from '../keywords/types';
import { IllegalAction, type Game } from './game';
import type { SpecialActionHandler } from './registries';

/** The objects of `player` in the zones of the action (CR 108.4: what a player may act on). */
function candidates(g: Game, d: SpecialActionDef, player: PlayerId): string[] {
  const z = g.s.zones;
  const out: string[] = [];
  for (const zone of d.zones) {
    const ids = zone === 'battlefield' || zone === 'stack' || zone === 'exile' || zone === 'command' ? z[zone] : z[zone][player] ?? [];
    for (const id of ids) {
      const o = g.s.objects[id];
      if (!o) continue;
      const mine = zone === 'battlefield' || zone === 'stack' ? o.controller === player : o.owner === player;
      if (mine) out.push(id);
    }
  }
  return out;
}

function handlerOf(d: SpecialActionDef): SpecialActionHandler {
  const list: SpecialActionHandler['list'] = (g, player) =>
    isPlannedSpecialAction(d) ? [] : candidates(g, d, player).filter((id) => d.check(g, id, player) === null).map((id) => ({ object: id, label: `${d.key}: ${g.nameOf(id)}`, cost: null }));
  return {
    kind: d.key,
    list,
    perform: (g, action) => {
      const listed = action.object !== undefined && list(g, action.player).some((x) => x.object === action.object);
      if (!listed) throw new IllegalAction(`The special action "${d.key}" is not available for that object now.`, ['CR 116.1', d.rule]);
      d.perform(g, action.object!, action.player);
    },
  };
}

/** The keyword special actions, adapted (m6 design 2.6: "keyword stubs adapted by M6-0"). */
export const KEYWORD_SPECIAL_HANDLERS: readonly SpecialActionHandler[] = SPECIAL_ACTIONS.map(handlerOf);
