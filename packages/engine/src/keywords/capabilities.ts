/** The `keyword:*` and `action:*` capability names of the keyword library (design 5.2). Owner: WP3. */
import { ACTION_MACROS } from './actions';
import { actionNeeds, expansionNeeds } from './needs';
import type { KeywordRegistry } from './types';

/**
 * `action:<name>` for every CR 701 action macro whose expansion the engine can run (every capability `actionNeeds` lists is in `available`: WP15 INTERFACE
 * CHANGE, so "Detain target creature." is not `full` while no handler can store a `restrict` effect, nor "Investigate." while `createToken` has no handler),
 * and `keyword:<name>` for every keyword the engine can really act on:
 *   - a native keyword (flashback): engine code acts on it, the data is the spec;
 *   - an implemented keyword that is read through the characteristics or a hook (flying, protection, ...): there is no expansion to check;
 *   - an implemented keyword that EXPANDS into abilities: only when every capability its expansion needs is in `available` (the capabilities of all the other
 *     tables of the engine, see needs.ts). A keyword whose expansion uses an op, event, condition or cost part the engine lacks is not advertised, so a card with
 *     it is classified by what the engine can do and never reads as automated while its trigger could not fire (design 5.2: an unfinished work package can
 *     never make a card wrongly automated).
 * The result lists the keyword names first (sorted), then the action names.
 */
export function keywordCapabilities(registry: KeywordRegistry, available: ReadonlySet<string>): string[] {
  const actions = Object.values(ACTION_MACROS).filter((m) => m !== undefined && actionNeeds(m).every((need) => available.has(need))).map((m) => `action:${m!.name}`);
  const have = new Set<string>([...available, ...actions]);
  const keywords = registry.capabilities().filter((cap) => {
    const def = registry.get(cap.slice('keyword:'.length));
    if (def === undefined || def.status === 'native') return true;
    // CMD3: an expansion that reads its own keyword in a filter ("a creature without flanking", CR 702.25a) needs no more than the keyword itself: the
    // characteristics carry the keyword whatever its status, so that need is met exactly when the rest of the expansion is
    return expansionNeeds(def).every((need) => have.has(need) || need === cap);
  });
  return [...keywords, ...actions];
}
