/**
 * Rolling a die (CR 706) and flipping a coin (CR 705): the one place either happens, with the state's random generator (design 8.8 rule 2: never Math.random,
 * so a re-execution from the same base state rolls the same), and the one place their engine events are emitted. Owner: WP15 (called by the `rollDie` and
 * `flipCoin` handlers, which only evaluate, decide and call these: design 8.6 stage 4, "emit nothing directly"). Neither event is proposed for replacement:
 * the rule-modifying statics that change them (`firstCoinFlipsWon`, `diceAdvantage`) are read by the handlers, so these are performers of non-proposable
 * actions, like tapping.
 */
import type { PlayerId } from '../types/ids';
import { randomIndex } from '../rules/random';
import type { Game } from './game';

/**
 * CR 706.1a-706.2: `player` rolls `count` N-sided dice as one instruction; each result is 1 to N, each equally likely. p2-c-dieroll-1 (CR 706.6, unverified
 * cite): plus `ignore` more dice, the `ignore` lowest rolls ignored ("instead roll that many dice plus one and ignore the lowest roll"). An ignored roll is not
 * considered rolled: only the kept rolls emit `dieRolled` (the `ev:dieRoll` event), each with the instruction they share. Returns the kept results, in the
 * order rolled.
 */
export function rollDice(g: Game, player: PlayerId, sides: number, count: number, ignore = 0): number[] {
  const instruction = g.events.length; // the rolls of this instruction share it (one occurrence of "whenever you roll one or more dice", CR 603.2c)
  const rolls = Array.from({ length: count + Math.max(ignore, 0) }, () => 1 + randomIndex(g, sides));
  const name = g.player(player).name;
  let kept = rolls;
  if (ignore > 0) {
    const dropped = new Set(rolls.map((r, i) => [r, i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, ignore).map(([, i]) => i));
    kept = rolls.filter((_, i) => !dropped.has(i));
    g.log(`${name} rolls ${rolls.length} d${sides} (${rolls.join(', ')}) and ignores the lowest ${ignore === 1 ? 'roll' : `${ignore} rolls`}: ${kept.join(', ')}.`, { rules: ['CR 706.1', 'CR 706.2', 'CR 706.6'], level: 'action' });
  } else for (const result of rolls) g.log(`${name} rolls a d${sides}: ${result}.`, { rules: ['CR 706.1', 'CR 706.2'], level: 'action' });
  for (const result of kept) g.emit({ type: 'dieRolled', player, sides, result, instruction });
  return kept;
}

/**
 * CR 705.1-705.2: `player` flips a coin. With a `call` (the effect cares who wins, 705.2), the flip is won when the call matches, and `coinFlipped` is emitted;
 * without one the flip has no winner and no event. Returns the side and, with a call, whether it was won.
 */
export function flipCoin(g: Game, player: PlayerId, call?: 'heads' | 'tails', rigged = false): { side: 'heads' | 'tails'; won?: boolean } {
  const name = g.player(player).name;
  // r4-mech (CR 705.1-705.2, 614.1a): "those coins come up heads and you win those flips": no random outcome and no call; the flip is won (its event says so)
  if (rigged) {
    g.emit({ type: 'coinFlipped', player, won: true });
    g.log(`${name} flips a coin: heads, and wins the flip.`, { rules: ['CR 705.2', 'CR 614.1a'], level: 'action' });
    return { side: 'heads', won: true };
  }
  const side = randomIndex(g, 2) === 0 ? 'heads' : 'tails'; // CR 705.1: two outcomes of equal likelihood
  if (call === undefined) {
    g.log(`${name} flips a coin: ${side}.`, { rules: ['CR 705.1'], level: 'action' });
    return { side };
  }
  const won = call === side;
  g.emit({ type: 'coinFlipped', player, won });
  g.log(`${name} calls ${call} and flips ${side}: ${won ? 'wins' : 'loses'} the flip.`, { rules: ['CR 705.2'], level: 'action' });
  return { side, won };
}
