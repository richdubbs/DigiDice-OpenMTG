/**
 * FAST5X E18: Storied and the enduring story. Owner: E18.
 *
 * RULE SOURCE: CR 702.195 (2026-09-25 edition). 702.195a: Storied is a static ability: "Any time you control three or more permanents that are artifacts,
 * Sagas, and/or legendary and you don't have an enduring story, you have an enduring story for the rest of the game." 702.195b: the enduring story is a
 * designation with no rules meaning of its own; any number of players may have it. 702.195c: after a player gets it, continuous effects are reapplied before
 * trigger conditions are checked. (Built first from the reminder text, before the CR had the rule; the analogues below say the same as 702.195.)
 *   - ascend on a permanent (CR 702.131b): "Any time you control ten or more permanents and you don't have the city's blessing, you get the city's blessing
 *     for the rest of the game." Storied is read the same way: a static ability that gives the designation the moment the condition is true (not a triggered
 *     ability, it does not use the stack), only while the Storied permanent is on the battlefield under that player's control.
 *   - CR 702.131c: the city's blessing is a designation with no rules meaning other than what other abilities say, kept for the rest of the game; losing the
 *     Storied permanent or the artifacts later changes nothing. It is not a counter (CR 122).
 *   - "legendaries" are legendary permanents (CR 205.4d); Sagas are enchantments with the subtype Saga (CR 714.1). A permanent that is several of these is one
 *     permanent and counts once ("three or more artifacts, legendaries, and/or Sagas").
 *
 * The check runs "immediately" (effects/registries.ts#IMMEDIATE_CHECKS: after every performed event and first in each state-based action check), like the
 * other designations that happen at once (CR 702.145c-d). A phased-out permanent is treated as though it does not exist (CR 702.26b).
 */
import type { GameState } from '../types/state';
import type { PlayerId } from '../types/ids';
import { charsOfObject, hasKeyword, readingStable } from '../rules/characteristics';
import type { Game } from './game';

/** The keyword's canonical name (keywords/data/storied.json). */
export const STORIED = 'storied';

/** Does the player have an enduring story? */
export const hasEnduringStory = (s: GameState, player: PlayerId): boolean => s.designations.enduringStory?.includes(player) === true;

/**
 * Can any object of this game have Storied (printed, granted or in a token's definition)? Memoized per definition map (copy-on-write, core/game.ts#addDef),
 * so a game without the keyword pays for one look per definition map, never for characteristics after every event (as core/sba.ts#enginesInGame).
 */
const STORIED_DEFS = new WeakMap<GameState['defs'], boolean>();
function storiedInGame(defs: GameState['defs']): boolean {
  let v = STORIED_DEFS.get(defs);
  if (v === undefined) {
    v = Object.values(defs).some((d) => JSON.stringify(d.faces).includes(`"keyword":"${STORIED}"`));
    STORIED_DEFS.set(defs, v);
  }
  return v;
}

/** Storied reminder text: each player who controls a Storied permanent and three or more artifacts, legendaries and/or Sagas gets an enduring story. */
function storiedCheck(g: Game): void {
  const s = g.s;
  const ids = s.zones.battlefield;
  if (ids.length === 0 || !storiedInGame(s.defs)) return;
  for (const p of s.players) {
    if (p.hasLost || hasEnduringStory(s, p.id)) continue;
    const gets = readingStable(s, () => {
      let storied = false;
      let counted = 0;
      for (const id of ids) {
        const o = s.objects[id];
        if (!o || o.phasedOut) continue; // CR 702.26b
        const c = charsOfObject(s, o);
        if (c.controller !== p.id) continue;
        if (hasKeyword(c, STORIED)) storied = true;
        // one permanent counts once, whichever of the three it is (CR 205.4d legendary, 714.1 Saga)
        if (c.types.includes('Artifact') || c.supertypes.includes('Legendary') || c.subtypes.includes('Saga')) counted++;
      }
      return storied && counted >= 3;
    });
    if (!gets) continue;
    s.designations.enduringStory = [...(s.designations.enduringStory ?? []), p.id];
    g.log(`${p.name} has an enduring story for the rest of the game.`, { rules: ['Storied (reminder text)', 'CR 702.131b'], level: 'action' });
  }
}

/** effects/registries.ts#IMMEDIATE_CHECKS. */
export const STORIED_IMMEDIATE_CHECKS: readonly ((g: Game) => void)[] = [storiedCheck];
