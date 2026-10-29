/**
 * The precombat main phase lore counter of Sagas (CR 714.3c; m6 design 3.7). Owner: M6-6.
 *
 * "As a player's precombat main phase begins, that player puts a lore counter on each Saga they control with one or more chapter abilities. This turn-based
 * action doesn't use the stack." Each counter is a `counters` proposal with the cause 'rule' (effects/api.ts#ProposalCause, CR 614.16): "if one or more lore
 * counters would be put" applies to it, "if an effect would put counters" (Doubling Season) does not. The pipeline is reached through effects/nested.ts
 * (installed by effects/funnels.ts), so this core module imports none of the interpreter's dispatchers (no cycle through core/registries.ts).
 */
import { proposeNested } from '../effects/nested';
import { charsOfObject, controllerOf, readingStable } from '../rules/characteristics';
import { finalChapter } from '../statics/levels';
import type { Game } from './game';

/** CR 714.3c: the active player's Sagas with a chapter ability (CR 714.2d: final chapter number at least 1), each gets a lore counter. */
function putLoreCounters(g: Game): void {
  const ap = g.s.turn.activePlayer;
  // review 2026-10-26 (performance): a pure read of every permanent, so the characteristics cache is checked once (`readingStable`), not once per permanent
  const sagas = readingStable(g.s, () => g.s.zones.battlefield.filter((id) => {
    const o = g.s.objects[id];
    if (!o || o.phasedOut || controllerOf(g.s, o) !== ap) return false;
    const c = charsOfObject(g.s, o);
    return c.subtypes.includes('Saga') && finalChapter(c.abilities) > 0;
  }));
  for (const id of sagas) {
    const o = g.s.objects[id];
    if (!o || o.zone !== 'battlefield') continue; // gone meanwhile (a replacement of an earlier counter could have moved it)
    const done = proposeNested(g, { ev: 'counters', change: 'put', on: { id, zone: 'battlefield' }, kind: 'lore', count: 1, cause: 'rule' });
    const n = done?.amount ?? 0;
    if (n > 0) g.log(`${g.player(ap).name} puts ${n === 1 ? 'a lore counter' : `${n} lore counters`} on ${g.nameOf(id)} (precombat main phase).`, { rules: ['CR 714.3c'], level: 'action' });
  }
}

export const LORE_PRECOMBAT_MAIN: readonly ((g: Game) => void)[] = [putLoreCounters];
