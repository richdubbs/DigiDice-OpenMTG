/**
 * edh-next-124 (CR 602.2, 601.2f, 605.1a, 109.2; Tezzeret, Betrayer of Flesh, rulings 2022-02-18): "The first activated ability of an artifact you activate each turn costs {2} less to
 * activate." Which activation is the first of a player's activations of abilities of a permanent of a card type this turn. Counted in `GameState.turnActivations` (cleared as each
 * turn begins) under `typeAct:<player>:<type>`, as the activation BEGINS (its total cost is locked in right after, CR 601.2f): mana abilities count too (the ruling: "this does not
 * exclude mana abilities"), and a mana ability activated to pay for the first one comes after it. While the first one's cost is being worked out and paid, its source is marked
 * `typeFirst:<player>:<type>:<source>`, so its cost change applies once and never to an ability activated during that payment. Only a permanent counts ("an artifact", CR 109.2).
 */
import type { PlayerId } from '../types/ids';
import type { GameObject, GameState } from '../types/state';
import { charsOfObject } from './characteristics';
import { actKey, firstKey } from '../statics/typed-activations';

/** The activation of an ability of `source` by `player` begins: count it for each card type of the permanent. Returns the marks to clear once its cost is paid. */
export function beginTypedActivation(s: GameState, player: PlayerId, source: GameObject): string[] {
  if (source.zone !== 'battlefield') return [];
  const marks: string[] = [];
  for (const t of charsOfObject(s, source).types) {
    const k = actKey(player, t);
    if ((s.turnActivations[k] ?? 0) === 0) {
      const f = firstKey(player, t, source.id);
      s.turnActivations[f] = 1;
      marks.push(f);
    }
    s.turnActivations[k] = (s.turnActivations[k] ?? 0) + 1;
  }
  return marks;
}

/** The first activation's cost is locked in and paid: its marks go. */
export function endTypedActivation(s: GameState, marks: readonly string[]): void {
  for (const m of marks) delete s.turnActivations[m];
}
