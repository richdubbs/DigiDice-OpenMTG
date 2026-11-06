/**
 * edh-d-49 (CR 706.2, 706.6; Night Shift of the Living Dead, Xenosquirrels, Monitor Monitor): the "after you roll" options of the roller's rule-modifying statics
 * (`rollAdjust`: "you may pay ... If you do, increase or decrease the result by 1"; `rollReroll`: "you may pay {1} to reroll one or more dice you rolled"; types/ability.ts
 * RuleModDef). They are the roller's choices, made when the instruction's dice are rolled and before anything (an event, a trigger, a results table) sees a result, so a rerolled
 * original roll never happened and "whenever you roll a 6" sees the adjusted result. Called by core/dice.ts#rollDice through the hook this builds; the handler
 * effects/handlers/game.ts#rollDie only passes it in. Nothing here proposes an event: paying the cost goes through the ordinary `pay` step.
 */
import { installRollHookProvider, type RollHook, type RolledDie } from '../core/dice';
import type { EffectStep } from '../types/ability';
import type { PlayerId } from '../types/ids';
import { rollOptions } from '../statics/hooks';
import type { Game } from '../core/game';
import { makeCtx } from './ctx';
import { runSteps } from './run';

/** The hook for `player`'s roll of N-sided dice, or none when no such option applies to them (so the roll behaves as before). */
export function rollHook(g: Game, player: PlayerId, sides: number): RollHook | undefined {
  // CR 706.2b: when several effects may modify the natural result, the effects that reroll the die are considered first, then those that increase or decrease the result
  const sources = [...rollOptions(g.s, player)].sort((a, b) => Number(b.effect.s === 'rule' && b.effect.rule === 'rollReroll') - Number(a.effect.s === 'rule' && a.effect.rule === 'rollReroll'));
  if (sources.length === 0) return undefined;
  return (dice, reroll) => {
    for (const src of sources) {
      const eff = src.effect;
      if (eff.s !== 'rule' || eff.cost === undefined || dice.length === 0) continue;
      const obj = src.source === null ? undefined : g.s.objects[src.source];
      if (!obj || obj.zone !== 'battlefield') continue; // the source must still be there to be asked (CR 400.7)
      const stats = g.player(player).turnStats;
      if (eff.oncePerTurn === true && stats.rollOptionsUsed?.includes(obj.id)) continue; // "Do this only once each turn": counted for the source object
      const scx = makeCtx(g, obj, { targets: [], steps: [] });
      scx.controller = src.controller;
      const pay: EffectStep = { op: 'pay', who: { ref: 'you' }, cost: eff.cost };
      if (!runSteps(scx, [pay]).performed) continue; // declined, or the cost can't be paid: nothing changes
      if (eff.oncePerTurn === true) (stats.rollOptionsUsed ??= []).push(obj.id); // used up even if the choice that follows changes nothing (ruling 2022-10-07)
      if (eff.rule === 'rollAdjust') adjust(g, player, sides, dice, typeof eff.value === 'number' ? eff.value : 1, g.nameOf(obj.id));
      else reroll(rerollChoice(g, player, sides, dice, g.nameOf(obj.id)));
    }
  };
}

/** CR 706.2: "increase or decrease the result by N" of ONE die: the roller sees every result first and picks the die and the direction (ruling 2022-10-07). */
function adjust(g: Game, player: PlayerId, sides: number, dice: RolledDie[], by: number, source: string): void {
  const options: { id: string; label: string }[] = [];
  const seen = new Set<number>();
  dice.forEach((d, i) => {
    if (seen.has(d.result)) return; // dice with the same result are the same choice
    seen.add(d.result);
    const where = dice.length > 1 ? ` (die ${i + 1})` : '';
    options.push({ id: `${i}:up`, label: `Increase ${d.result} to ${d.result + by}${where}` }, { id: `${i}:down`, label: `Decrease ${d.result} to ${d.result - by}${where}` });
  });
  const picked = g.choose({
    kind: 'chooseOption', player, prompt: `${source}: change a d${sides} result by ${by}.`, options, min: 1, max: 1, rules: ['CR 706.2'],
  }).ids[0];
  const [index, dir] = (picked ?? '').split(':');
  const die = dice[Number(index)];
  if (!die || (dir !== 'up' && dir !== 'down')) return;
  const before = die.result;
  die.result += dir === 'up' ? by : -by;
  g.log(`${g.player(player).name} changes a d${sides} result from ${before} to ${die.result} (${source}).`, { rules: ['CR 706.2'], level: 'action' });
}

/** "Reroll one or more dice you rolled": the roller picks any of the dice just rolled (the one payment covers all of them, ruling 2022-10-07). */
function rerollChoice(g: Game, player: PlayerId, sides: number, dice: RolledDie[], source: string): number[] {
  if (dice.length === 1) return [0];
  const ids = g.choose({
    kind: 'chooseOption', player, prompt: `${source}: choose the d${sides} to reroll.`, min: 1, max: dice.length, rules: ['CR 706.2'],
    options: dice.map((d, i) => ({ id: String(i), label: `Die ${i + 1}: ${d.result}` })),
  }).ids;
  return ids.map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < dice.length);
}

installRollHookProvider(rollHook); // edh-d-49: a die rolled to pay a cost (rules/pay-parts.ts) reaches the same options
