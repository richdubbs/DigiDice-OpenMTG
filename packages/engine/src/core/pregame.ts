/**
 * FAST4 MX1: actions with cards in the opening hand (CR 103.6). "If this card is in your opening hand, you may begin the game with it on the battlefield"
 * (Leyline of the Void, Leyline of Sanctity, ...: a static ability that functions in the hand, `{ s: 'pregame', action: 'beginOnBattlefield', optional: true }`).
 *
 * Once the mulligans are over (CR 103.5), the starting player may take such actions, then each other player in turn order (CR 103.6): each is asked once,
 * with every card of their hand that has the ability, and may choose any of them, in the order the cards are put onto the battlefield (CR 103.6a: the
 * player puts the card onto the battlefield). The move goes through the proposal pipeline like any other (replacement effects, "as it enters" choices); what
 * triggers on it goes on the stack the first time a player would receive priority (CR 117.5). Each card put there is named in the public log; a player who
 * declines is not mentioned (their hand stays hidden, CR 400.2).
 *
 * The other actions of the model (`reveal`, CR 103.6b, and `exileBeforeShuffle`) and a mandatory one are not run: the walker names them
 * `feature:pregame.<action>` / `feature:pregame.mandatory` (model/cap-walk.ts) and only `PREGAME_FEATURES` below is registered (model/capabilities.ts).
 */
import type { AbilityDef } from '../types/ability';
import type { ObjectId } from '../types/ids';
import type { Game } from './game';
import { moveObject, zoneArray } from './zones';

/** The static kind and the action this module runs (model/capabilities.ts adds `static:pregame` and `feature:pregame.beginOnBattlefield`). */
export const PREGAME_STATIC_KINDS: Readonly<Record<string, true>> = { pregame: true };
export const PREGAME_FEATURES: readonly string[] = ['pregame.beginOnBattlefield'];

/** Does this printed ability say "you may begin the game with it on the battlefield" (functioning in the hand)? */
function beginsOnBattlefield(a: AbilityDef): boolean {
  if (a.kind !== 'static' || !(a.zone ?? []).includes('hand')) return false;
  return a.effects.some((e) => e.s === 'pregame' && e.action === 'beginOnBattlefield' && e.optional);
}

/** The cards in a player's hand whose front face has the ability (a card in a hand has its front face's characteristics, CR 712.8a). */
function candidates(g: Game, player: string): ObjectId[] {
  return zoneArray(g, 'hand', player).filter((id) => {
    const o = g.s.objects[id];
    const def = o ? g.s.defs[o.defId] : undefined;
    return (def?.faces[0]?.abilities ?? []).some(beginsOnBattlefield);
  });
}

/** CR 103.6, 103.6a: the opening-hand actions, the starting player first, then each other player in turn order (`GameState.players` is in turn order). */
export function openingHandActions(g: Game, due: () => boolean = () => false): void {
  for (const p of g.s.players) {
    if (due()) return; // M12-2 (review fix 2): the concessions made while the start of the game waited apply at their point (core/start.ts)
    if (p.hasLost) continue;
    const options = candidates(g, p.id);
    if (options.length === 0) continue;
    const ans = g.choose({
      kind: 'chooseObjects',
      player: p.id,
      prompt: `Begin the game with any of these cards on the battlefield? Choose the ones you want (none to keep them in your hand)${options.length > 1 ? ', in the order they are put there' : ''}.`,
      options,
      min: 0,
      max: options.length,
      ...(options.length > 1 ? { ordered: true } : {}),
      rules: ['CR 103.6', 'CR 103.6a'],
    });
    for (const id of ans.ids) {
      if (!options.includes(id) || g.s.objects[id]?.zone !== 'hand') continue;
      const name = g.nameOf(id);
      moveObject(g, id, 'battlefield', { controller: p.id, cause: 'pregame' });
      g.log(`${p.name} begins the game with ${name} on the battlefield.`, { rules: ['CR 103.6a'], level: 'action' });
    }
  }
}
