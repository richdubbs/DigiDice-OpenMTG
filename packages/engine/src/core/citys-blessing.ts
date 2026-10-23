/**
 * CMD3 (commander batch): ascend and the city's blessing (CR 702.131). Owner: CMD3.
 *
 *   CR 702.131a  Ascend on an instant or sorcery spell is a spell ability: "If you control ten or more permanents and you don't have the city's blessing, you
 *                get the city's blessing for the rest of the game." (keywords/data/ascend.json: a `designate` step of what `citysBlessing`, below)
 *   CR 702.131b  Ascend on a permanent is a static ability: "Any time you control ten or more permanents and you don't have the city's blessing, you get the
 *                city's blessing for the rest of the game." It does not use the stack: `ascendCheck` runs "immediately" (effects/registries.ts#IMMEDIATE_CHECKS:
 *                after every performed event and first in each state-based action check), as core/enduring-story.ts does for Storied.
 *   CR 702.131c  The city's blessing is a designation with no rules meaning of its own; once a player has it, it stays for the rest of the game (losing the
 *                permanents changes nothing).
 * A phased-out permanent is treated as though it does not exist (CR 702.26b): it counts neither as one of the ten nor as the permanent with ascend.
 */
import type { GameState } from '../types/state';
import type { PlayerId } from '../types/ids';
import { charsOfObject, hasKeyword, readingStable } from '../rules/characteristics';
import type { Game } from './game';

/** The keyword's canonical name (keywords/data/ascend.json). */
export const ASCEND = 'ascend';

/** Does the player have the city's blessing (CR 702.131c)? */
export const hasCitysBlessing = (s: GameState, player: PlayerId): boolean => s.designations.citysBlessing?.includes(player) === true;

/** CR 702.131c: the player gets the city's blessing for the rest of the game. Returns whether anything changed. */
export function giveCitysBlessing(g: Game, player: PlayerId, rule = 'CR 702.131c'): boolean {
  const p = g.player(player);
  if (p.hasLost || hasCitysBlessing(g.s, player)) return false;
  g.s.designations.citysBlessing = [...(g.s.designations.citysBlessing ?? []), player];
  g.log(`${p.name} gets the city's blessing for the rest of the game.`, { rules: [rule, 'CR 702.131c'], level: 'action' });
  return true;
}

/**
 * Can any object of this game have ascend (printed, granted or in a token's definition)? Memoized per definition map (copy-on-write, core/game.ts#addDef), so a
 * game without the keyword pays for one look per definition map, never for characteristics after every event (as core/enduring-story.ts#storiedInGame).
 */
const ASCEND_DEFS = new WeakMap<GameState['defs'], boolean>();
function ascendInGame(defs: GameState['defs']): boolean {
  let v = ASCEND_DEFS.get(defs);
  if (v === undefined) {
    v = Object.values(defs).some((d) => JSON.stringify(d.faces).includes(`"keyword":"${ASCEND}"`));
    ASCEND_DEFS.set(defs, v);
  }
  return v;
}

/** CR 702.131b: each player who controls a permanent with ascend and ten or more permanents gets the city's blessing. */
function ascendCheck(g: Game): void {
  const s = g.s;
  const ids = s.zones.battlefield;
  if (ids.length < 10 || !ascendInGame(s.defs)) return;
  for (const p of s.players) {
    if (p.hasLost || hasCitysBlessing(s, p.id)) continue;
    const gets = readingStable(s, () => {
      let ascend = false;
      let counted = 0;
      for (const id of ids) {
        const o = s.objects[id];
        if (!o || o.phasedOut) continue; // CR 702.26b
        const c = charsOfObject(s, o);
        if (c.controller !== p.id) continue;
        counted++;
        if (hasKeyword(c, ASCEND)) ascend = true;
      }
      return ascend && counted >= 10;
    });
    if (gets) giveCitysBlessing(g, p.id, 'CR 702.131b');
  }
}

/** effects/registries.ts#IMMEDIATE_CHECKS. */
export const ASCEND_IMMEDIATE_CHECKS: readonly ((g: Game) => void)[] = [ascendCheck];

/** model/capabilities.ts: the `designate` step that gives the city's blessing (ascend on an instant or sorcery, CR 702.131a). */
export const CITYS_BLESSING_OP_FORMS: readonly string[] = ['op:designate.citysBlessing'];
