/**
 * std-control-3: controlling another player (CR 723, "Controlling Another Player"; earlier editions numbered it 722. Cites from memory, unverified).
 *
 * "You control target opponent during their next turn" (Mindslaver, Construct a Cosmic Cube, The Dominion Bracelet) and "... during their next combat phase"
 * (Secret of Bloodbending) create a record in `GameState.playerControl` (op `controlPlayer`, effects/handlers/game.ts). The record waits for the next turn
 * that player actually takes (CR 723.1b: a skipped turn does not count; the turn the effect was created in does not either, it has already begun), or for
 * the next combat phase of a turn of theirs, and is active from its beginning:
 *  - a turn: from the moment that turn begins until the next turn begins (CR 723.1: the effect lasts the entire turn, its cleanup steps included);
 *  - a combat phase: from its beginning of combat step until the combat phase ends (CR 500.5a; also when an effect ends the turn, CR 724.1d).
 * While a record is active, every decision of the controlled player (priority, targets, attacks, payments, the choices of spells and abilities) is made by
 * the controller (CR 723.5): the engine still asks the controlled player (`Decision.player`: they are the active player, they cast the spells and pay with
 * their own resources, CR 723.3, 723.5a) and names who answers (`Decision.decidedBy`). Two active records for one player: the most recently created one
 * works (CR 723.1a). The controller sees what the controlled player can see (CR 723.4, core/view.ts). The controller can't make choices for that player that
 * no rule or object asks for (CR 723.5b): a concession and the player's own auto-pass stops stay the controlled player's (`mayActAs`).
 *
 * The engine's actions stay in game terms (`Action.player` is the player who acts in the game); who may send an action for that player is `mayActAs`,
 * which a transport (the net host, a local session, a bot driver) asks with the seat that sent it.
 */
import type { Action } from '../types/actions';
import type { Decision } from '../types/decisions';
import type { PlayerId } from '../types/ids';
import type { GameState, PlayerControlRec } from '../types/state';

/** What the questions below read: a game state, or a player's view of it (core/view.ts keeps both fields). */
type Seen = Pick<GameState, 'players' | 'playerControl'>;
import type { Game } from './game';

const RULES_TURN = ['CR 723.1'];
const RULES_COMBAT = ['CR 723.1', 'CR 506.1'];

/**
 * The player who makes `player`'s decisions now (CR 723.5): the controller of the most recently created active record that controls them (CR 723.1a), while
 * that controller is still in the game (CR 800.4a); otherwise the player themselves.
 */
export function controllerOfPlayer(state: Seen, player: PlayerId): PlayerId {
  const recs = state.playerControl;
  if (recs === undefined || recs.length === 0) return player;
  let best: PlayerControlRec | undefined;
  for (const r of recs) {
    if (!r.active || r.player !== player || r.controller === player) continue;
    if (state.players.find((p) => p.id === r.controller)?.hasLost === true) continue;
    if (best === undefined || r.timestamp > best.timestamp) best = r;
  }
  return best?.controller ?? player;
}

/** The other players `controller` controls now (CR 723.4: the controller sees what they can see). */
export function playersControlledBy(state: Seen, controller: PlayerId): PlayerId[] {
  if (state.playerControl === undefined) return [];
  return state.players.filter((p) => p.id !== controller && controllerOfPlayer(state, p.id) === controller).map((p) => p.id);
}

/** Who answers a decision: its `decidedBy` (CR 723.5), else the player asked. */
export function decidingPlayer(d: Decision): PlayerId {
  return d.decidedBy ?? d.player;
}

/** The decision with `decidedBy` set when its player is controlled now (CR 723.5); unchanged otherwise. */
export function withDecider<D extends Decision>(state: Seen, d: D): D {
  if (state.playerControl === undefined) return d;
  const by = controllerOfPlayer(state, d.player);
  return by === d.player ? d : { ...d, decidedBy: by };
}

/**
 * May the seat of `from` send `action`? Its own player's actions, while nobody else makes that player's decisions; and, while `from` controls another player
 * (CR 723.5), that player's priority actions, answers and cancellations. A concession and the auto-pass stops are always the player's own (CR 723.5b, 104.3a).
 */
export function mayActAs(state: Seen, from: PlayerId, action: Action): boolean {
  if (action.type === 'startGame' || !('player' in action)) return false;
  if (action.type === 'concede' || action.type === 'setStops') return action.player === from;
  return controllerOfPlayer(state, action.player) === from;
}

/** Op `controlPlayer`: `controller` controls `player` during their next turn or their next combat phase (CR 723.1). */
export function addPlayerControl(g: Game, controller: PlayerId, player: PlayerId, during: PlayerControlRec['during'], sourceName: string): void {
  const rec: PlayerControlRec = { id: `pc${g.newEffectId()}`, controller, player, during, timestamp: g.newTimestamp(), sourceName };
  g.s.playerControl = [...(g.s.playerControl ?? []), rec];
  const when = during === 'turn' ? 'their next turn' : 'their next combat phase';
  g.log(`${g.player(controller).name} will control ${g.player(player).name} during ${when} (${sourceName}).`, { rules: during === 'turn' ? RULES_TURN : RULES_COMBAT, level: 'action' });
}

function drop(g: Game, gone: (r: PlayerControlRec) => boolean): void {
  const recs = g.s.playerControl;
  if (recs === undefined) return;
  const kept = recs.filter((r) => !gone(r));
  if (kept.length === recs.length) return;
  for (const r of recs) if (gone(r)) g.log(`${g.player(r.controller).name} no longer controls ${g.player(r.player).name} (${r.sourceName}).`, { rules: ['CR 723.1'], level: 'info' });
  if (kept.length > 0) g.s.playerControl = kept;
  else delete g.s.playerControl;
}

/**
 * A turn begins (core/turn.ts#beginNextTurn, after the turn number and active player are set): the records active in the previous turn end (CR 723.1: the
 * effect doesn't end until the beginning of the next turn), and the waiting turn records of the new active player begin (a skipped turn never begins, so
 * they wait for the next one, CR 723.1b).
 */
export function playerControlAtTurnStart(g: Game, active: PlayerId): void {
  if (g.s.playerControl === undefined) return;
  drop(g, (r) => r.active === true);
  // CR 800.4a: a record whose controller or player has left the game does nothing more
  drop(g, (r) => g.player(r.player).hasLost === true || g.player(r.controller).hasLost === true);
  for (const r of g.s.playerControl ?? []) {
    if (r.during !== 'turn' || r.player !== active) continue;
    r.active = true;
    g.log(`${g.player(r.controller).name} controls ${g.player(r.player).name} during this turn (${r.sourceName}).`, { rules: RULES_TURN, level: 'info' });
  }
}

/** A combat phase begins (its beginning of combat step, CR 506.1): the waiting combat records of the active player begin. */
export function playerControlAtCombatStart(g: Game): void {
  if (g.s.playerControl === undefined) return;
  const active = g.s.turn.activePlayer;
  for (const r of g.s.playerControl) {
    if (r.during !== 'combat' || r.active || r.player !== active) continue;
    r.active = true;
    g.log(`${g.player(r.controller).name} controls ${g.player(r.player).name} during this combat phase (${r.sourceName}).`, { rules: RULES_COMBAT, level: 'info' });
  }
}

/** The combat phase ends (CR 500.5a, core/steps.ts#endCombatPhase): the active combat records end. */
export function playerControlAtCombatEnd(g: Game): void {
  drop(g, (r) => r.during === 'combat' && r.active === true);
}
