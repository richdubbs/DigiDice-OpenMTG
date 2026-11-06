/**
 * edh-d-49 render helpers (lane dice, second pass). `rollOptionText`: the "after you roll" options of a rule-modifying static (types/ability.ts RuleModDef `rollAdjust`,
 * `rollReroll`; Night Shift of the Living Dead, Xenosquirrels, Monitor Monitor), as the Oracle text says them. Imports nothing from render/fold.ts (an import cycle).
 */
import type { RuleModDef } from '../types/ability';
import { costVerbs } from './costs';
import type { RenderState } from './state';
import { NoRenderer } from './text';

export function rollOptionText(e: RuleModDef, st: RenderState): string {
  if (e.cost === undefined) throw new NoRenderer(`${e.rule} without a cost`);
  const pay = costVerbs(e.cost, st, 'you');
  if (e.rule === 'rollAdjust') {
    if (e.value !== 1) throw new NoRenderer('a roll adjustment other than by 1');
    return `after you roll a die, you may ${pay}. if you do, increase or decrease the result by 1${e.oncePerTurn === true ? '. do this only once each turn' : ''}`;
  }
  if (e.oncePerTurn !== true) throw new NoRenderer('a reroll option that is not once each turn');
  return `once each turn, you may ${pay} to reroll one or more dice you rolled`;
}
