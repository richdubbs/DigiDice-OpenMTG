/**
 * std-costs-1 (CR 601.2c, 601.2f, 202.3): "the total mana value of the permanents this spell targets" (`{q:'spellTargetTotal', stat:'manaValue'}`,
 * types/ability.ts): the mana values of the spell's object targets that are on the battlefield, added up. A target that is a player, or an object that is not a
 * permanent (a card in a graveyard, a spell), adds nothing; a permanent chosen for two of its targets (an artifact creature as the "target artifact" and the
 * "target creature", CR 115.3) is one of the permanents it targets and counts once. Shared by the cast path (actions/cast.ts, as the total cost is determined) and the evaluator
 * (effects/eval.ts).
 */
import type { GameState, TargetChoice } from '../types/state';
import { charsOfObject } from './characteristics';

export function spellTargetTotal(s: GameState, targets: readonly (readonly TargetChoice[])[]): number {
  let total = 0;
  const seen = new Set<string>();
  for (const t of targets.flat()) {
    if (t.kind !== 'object' || seen.has(t.id)) continue;
    seen.add(t.id);
    const o = s.objects[t.id];
    if (o === undefined || o.zone !== 'battlefield') continue;
    total += charsOfObject(s, o).manaValue;
  }
  return total;
}
