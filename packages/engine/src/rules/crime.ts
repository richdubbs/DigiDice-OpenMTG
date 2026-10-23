/**
 * FAST5X E20 (MX23): player-action events that are no keyword action of their own. Each one is reported as an `actionPerformed` event with a verb the trigger
 * normalizer turns into an `action` semantic event and the history records (triggers/normalize.ts, triggers/history.ts):
 *  - `commitCrime` (CR 700.13): a player commits a crime as they cast a spell, activate an ability or put a triggered ability on the stack and that spell or
 *    ability targets at least one opponent, a permanent, spell or ability an opponent controls, and/or a card in an opponent's graveyard. ONE crime per spell
 *    or ability, however many of its targets qualify. A copy is not cast, activated or put on the stack by a trigger (CR 707.10), so it commits no crime.
 *  - `expend` (CR 700.14): a player expends N if they pay a cost to cast a spell and the mana they spent this turn to cast spells was less than N before that
 *    payment and at least N after it. One event per payment carries both totals (`spent`); the `action` pattern's `n` is matched against them
 *    (triggers/match.ts), so each N is crossed once per turn at most. Mana spent on abilities does not count, and neither does a cost reduction (it is no mana).
 *  - `tap` (CR 701.26a): "you tap an untapped creature": a permanent became tapped by an effect or a cost of a player (`actor`): the tap op (the controller of the
 *    spell or ability) and the tap costs a player pays (rules/pay.ts). A creature tapped to attack is tapped by the game's turn-based action for its controller,
 *    not by "you"; that is no `tap` action. A mana ability's {T} cost, convoke and regeneration (CR 701.19a) do not report who tapped, so a `tap` pattern is
 *    supported only for a permanent an opponent controls (triggers/forms.ts), which none of them can tap.
 */
import type { Game } from '../core/game';
import type { ObjectId, PlayerId } from '../types/ids';
import type { TargetChoice } from '../types/state';
import { controllerOf } from './characteristics';

/** CR 700.13: does one target make its spell or ability, controlled by `controller`, a crime? */
export function isCrimeTarget(g: Game, controller: PlayerId, t: TargetChoice): boolean {
  const s = g.s;
  const opponent = (p: PlayerId | undefined): boolean => p !== undefined && p !== controller && s.players.some((x) => x.id === p);
  if (t.kind === 'player') return opponent(t.id);
  const o = s.objects[t.id];
  if (!o) return false;
  // CR 700.13: a permanent, spell or ability an opponent controls (CR 108.4a: a card in a graveyard has no controller; its owner is whose graveyard it is in)
  if (o.zone === 'battlefield' || o.zone === 'stack') return opponent(controllerOf(s, o));
  if (o.zone === 'graveyard') return opponent(o.owner);
  return false; // a card in exile, a hand or a library is none of the three
}

/**
 * CR 700.13: report the crime committed by putting the spell or ability `stackId` (with its chosen targets) on the stack, if it is one. Called right after its
 * targets became targets (actions/cast.ts, actions/activate.ts, triggers/stack.ts), never for a copy (rules/stack-objects.ts).
 */
export function emitCrime(g: Game, stackId: ObjectId, controller: PlayerId, targets: readonly (readonly TargetChoice[])[]): void {
  if (g.s.objects[stackId]?.stack?.isCopy === true) return; // CR 707.10: a copy isn't cast
  if (!targets.flat().some((t) => isCrimeTarget(g, controller, t))) return;
  g.emit({ type: 'actionPerformed', verb: 'commitCrime', actor: controller });
  g.log(`${g.player(controller).name} commits a crime.`, { rules: ['CR 700.13'], level: 'info' });
}

/**
 * CR 700.14: the mana `player` spent to cast a spell (`amount` mana units, paid now) is added to what they spent this turn to cast spells; the change is
 * reported for "whenever you expend N" (nothing when no mana was spent).
 */
export function recordSpellMana(g: Game, player: PlayerId, amount: number): void {
  const stats = g.player(player).turnStats;
  const before = stats.manaSpentOnSpells ?? 0;
  if (amount <= 0) return;
  const after = before + amount;
  stats.manaSpentOnSpells = after;
  g.emit({ type: 'actionPerformed', verb: 'expend', actor: player, spent: { before, after } });
}
