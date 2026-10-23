/**
 * Restrictions on players that the end-of-game and life rules must respect (CR 104.3, 104.2, 119.7, 119.8): "you can't lose the game",
 * "your opponents can't win the game", "you can't gain life", "you can't lose life".
 *
 * Transition T1 (design 4.5, WP16): milestone 4 stored these as ad hoc records with a string duration. They are now ordinary restrictions: a typed
 * `ContinuousEffectRec` whose effect is `{s:'restrict', subject:{ref:'fixed', players:[player]}, mode:'cant', action}` for the ones created here, and any
 * static ability or resolved effect with the same `RestrictionDef` (Platinum Angel: "You can't lose the game and your opponents can't win the game"). Both
 * functions are thin wrappers over statics/hooks.ts: `playerRestricted` asks `cantHappen`, which reads every source, and `addPlayerRestriction` keeps its
 * milestone 4 signature (the string durations map to `Duration` objects).
 */
import type { Duration, RuleAction } from '../types/ability';
import type { PlayerId } from '../types/ids';
import type { GameState } from '../types/state';
import type { Game } from '../core/game';
import { EngineBug } from '../core/errors';
import { cantHappen } from '../statics/hooks';

export type PlayerRestriction = 'cantGainLife' | 'cantLoseLife' | 'cantLoseGame' | 'cantWinGame';

/** The `RuleAction` of each milestone 4 restriction (design 4.5). */
export const RESTRICTION_ACTION: Readonly<Record<PlayerRestriction, RuleAction>> = { cantGainLife: 'gainLife', cantLoseLife: 'loseLife', cantLoseGame: 'lose', cantWinGame: 'win' };

/** The milestone 4 duration strings as `Duration` objects (design 4.5). */
const DURATIONS: Readonly<Record<string, Duration>> = {
  endOfTurn: { d: 'endOfTurn' },
  endOfCombat: { d: 'endOfCombat' },
  permanent: { d: 'permanent' },
  whileSourceOnBattlefield: { d: 'whileSource', as: 'onBattlefield' }, // CR 611.2b
};

/** Is the player under this restriction now, from any source (a static ability, a resolved effect, a record made by `addPlayerRestriction`)? */
export function playerRestricted(s: GameState, player: PlayerId, restriction: PlayerRestriction): boolean {
  return cantHappen(s, { action: RESTRICTION_ACTION[restriction], subject: player }) !== null;
}

/** Create a player restriction as a continuous effect (CR 611.2): a typed restriction record on exactly this player (CR 611.2c). */
export function addPlayerRestriction(g: Game, player: PlayerId, restriction: PlayerRestriction, duration = 'endOfTurn', sourceId?: string): void {
  const d = DURATIONS[duration];
  if (!d) throw new EngineBug(`addPlayerRestriction: unknown duration "${duration}"`);
  const src = sourceId ? g.s.objects[sourceId] : undefined;
  if (sourceId && !src) throw new EngineBug(`addPlayerRestriction: no object ${sourceId}`);
  g.s.continuousEffects.push({
    id: g.newEffectId(),
    source: src ? { id: src.id, zone: src.zone } : null,
    sourceName: src ? g.nameOf(src.id) : 'an effect',
    controller: src ? src.controller : player,
    timestamp: g.newTimestamp(),
    startedTurn: g.s.turn.number,
    duration: d,
    effect: { s: 'restrict', subject: { ref: 'fixed', players: [player] }, mode: 'cant', action: RESTRICTION_ACTION[restriction] },
  });
}
