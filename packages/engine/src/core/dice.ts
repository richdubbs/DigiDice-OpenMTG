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

/** edh-d-49: one kept die of an instruction: its natural result and its result after modifiers (CR 706.2). */
export interface RolledDie { natural: number; result: number }

/**
 * edh-d-49 (CR 706.2, 706.6; Night Shift of the Living Dead, Monitor Monitor): what the roller's "after you roll" options do once the kept dice are known and before any
 * event is emitted: `dice` may have their `result` changed, and `reroll` rolls the dice at those indexes again (an original roll that is rerolled never happened).
 */
export type RollHook = (dice: RolledDie[], reroll: (indexes: readonly number[]) => void) => void;

/**
 * edh-d-49: the roller's "after you roll" options come from the rule-modifying statics (effects/roll-options.ts, which installs itself here as the effects layer loads), so that a roll
 * made while paying a cost (rules/pay-parts.ts, `rollDie` cost part) reaches them without the rules layer importing the effects layer (the pattern of effects/nested.ts).
 */
type RollHookProvider = (g: Game, player: PlayerId, sides: number) => RollHook | undefined;
let rollHookProvider: RollHookProvider | null = null;
export function installRollHookProvider(f: RollHookProvider): void {
  rollHookProvider = f;
}
/** The hook for `player`'s roll of one N-sided die, or none when no option applies (or none is installed). */
export const rollHookFor = (g: Game, player: PlayerId, sides: number): RollHook | undefined => rollHookProvider?.(g, player, sides);

/**
 * CR 706.1a-706.2: `player` rolls `count` N-sided dice as one instruction; each result is 1 to N, each equally likely. p2-c-dieroll-1 (CR 706.6, unverified
 * cite): plus `ignore` more dice, the `ignore` lowest rolls ignored ("instead roll that many dice plus one and ignore the lowest roll"). An ignored roll is not
 * considered rolled: only the kept rolls emit `dieRolled` (the `ev:dieRoll` event), each with the instruction they share. Returns the kept dice, in the
 * order rolled, with the results after `modifier` and after the `hook` (edh-d-49).
 */
export function rollDice(g: Game, player: PlayerId, sides: number, count: number, ignore = 0, modifier = 0, hook?: RollHook): RolledDie[] {
  const instruction = g.events.length; // the rolls of this instruction share it (one occurrence of "whenever you roll one or more dice", CR 603.2c)
  const rolls = Array.from({ length: count + Math.max(ignore, 0) }, () => 1 + randomIndex(g, sides));
  const name = g.player(player).name;
  let kept = rolls;
  if (ignore > 0) {
    const dropped = new Set(rolls.map((r, i) => [r, i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, ignore).map(([, i]) => i));
    kept = rolls.filter((_, i) => !dropped.has(i));
    g.log(`${name} rolls ${rolls.length} d${sides} (${rolls.join(', ')}) and ignores the lowest ${ignore === 1 ? 'roll' : `${ignore} rolls`}: ${kept.join(', ')}.`, { rules: ['CR 706.1', 'CR 706.2', 'CR 706.6'], level: 'action' });
  } else for (const result of rolls) g.log(`${name} rolls a d${sides}: ${result}.`, { rules: ['CR 706.1', 'CR 706.2'], level: 'action' });
  const dice: RolledDie[] = kept.map((natural) => ({ natural, result: natural + modifier }));
  if (hook) {
    hook(dice, (indexes) => {
      for (const i of indexes) {
        const natural = 1 + randomIndex(g, sides);
        g.log(`${name} rerolls a d${sides}: ${natural}.`, { rules: ['CR 706.2'], level: 'action' });
        dice[i] = { natural, result: natural + modifier };
      }
    });
  }
  for (const d of dice) g.emit({ type: 'dieRolled', player, sides, result: d.result, instruction, natural: d.natural }); // edh-next-43 (CR 706.2, ruling of Atomwheel Acrobats 2022-10-07): the event's result is the result after modifiers; edh-d-49: and after the roller's own "after you roll" options (rulings of Night Shift 2022-10-07)
  return dice;
}

/**
 * CR 705.1-705.2: `player` flips a coin. With a `call` (the effect cares who wins, 705.2), the flip is won when the call matches, and `coinFlipped` is emitted;
 * without one the flip has no winner and no event. Returns the side and, with a call, whether it was won.
 */
export function flipCoin(g: Game, player: PlayerId, call?: 'heads' | 'tails', rigged = false, extra = 0): { side: 'heads' | 'tails'; won?: boolean } {
  const name = g.player(player).name;
  // r4-mech (CR 705.1-705.2, 614.1a): "those coins come up heads and you win those flips": no random outcome and no call; the flip is won (its event says so)
  if (rigged) {
    g.emit({ type: 'coinFlipped', player, won: true });
    g.log(`${name} flips a coin: heads, and wins the flip.`, { rules: ['CR 705.2', 'CR 614.1a'], level: 'action' });
    return { side: 'heads', won: true };
  }
  let side: 'heads' | 'tails' = randomIndex(g, 2) === 0 ? 'heads' : 'tails'; // CR 705.1: two outcomes of equal likelihood
  // edh-next-12 (CR 705.1, 614.1a; Krark's Thumb): `extra` more coins are flipped and all but one result are ignored, the one kept being the player's choice when they differ
  // (an ignored coin is not flipped: no event, nothing counted)
  if (extra > 0) {
    const flips: ('heads' | 'tails')[] = [side, ...Array.from({ length: extra }, () => (randomIndex(g, 2) === 0 ? 'heads' as const : 'tails' as const))];
    const sides = (['heads', 'tails'] as const).filter((x) => flips.includes(x));
    if (sides.length > 1) {
      side = g.choose({
        kind: 'chooseOption', player, prompt: `Flip ${flips.length} coins (${flips.join(', ')}) and ignore all but one: which result do you keep?`, min: 1, max: 1,
        options: sides.map((x) => ({ id: x, label: x === 'heads' ? 'Heads' : 'Tails' })), rules: ['CR 705.1', 'CR 614.1a'],
      }).ids[0] as 'heads' | 'tails';
    }
    g.log(`${name} flips ${flips.length} coins (${flips.join(', ')}) and ignores all but one: ${side}.`, { rules: ['CR 705.1', 'CR 614.1a'], level: 'action' });
  }
  if (call === undefined) {
    g.log(`${name} flips a coin: ${side}.`, { rules: ['CR 705.1'], level: 'action' });
    return { side };
  }
  const won = call === side;
  g.emit({ type: 'coinFlipped', player, won });
  g.log(`${name} calls ${call} and flips ${side}: ${won ? 'wins' : 'loses'} the flip.`, { rules: ['CR 705.2'], level: 'action' });
  return { side, won };
}
