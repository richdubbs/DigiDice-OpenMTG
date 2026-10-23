/** Counters on permanents (CR 122). Players' poison counters are in rules/life.ts. */
import type { ObjectId, PlayerId } from '../types/ids';
import type { Game } from '../core/game';
import { cantDo } from './cant';
import { KEYWORD_COUNTERS } from '../statics/mods';

const KEYWORD_COUNTER_SET: ReadonlySet<string> = new Set(KEYWORD_COUNTERS);

/**
 * Put (delta > 0) or remove (delta < 0) counters; a permanent can't have fewer than 0. Returns the change that actually happened. WP31: counters can't be put
 * on an object a "can't have counters put on it" effect protects (CR 122.6, 614.17: as it enters, from wither and infect damage, from an effect).
 */
export function addCounters(g: Game, id: ObjectId, counter: string, delta: number, by?: PlayerId): number {
  const o = g.obj(id);
  if (delta > 0 && cantDo(g.s, 'haveCountersPut', id)) {
    g.log(`No ${counter} counter can be put on ${g.nameOf(id)}: a "can't" effect forbids it.`, { rules: ['CR 122.6', 'CR 614.17'], level: 'info' });
    return 0;
  }
  const before = Object.hasOwn(o.counters, counter) ? o.counters[counter]! : 0; // counter names are data: "toString" is not an inherited member
  const after = Math.max(0, before + delta);
  if (after === 0) delete o.counters[counter];
  else o.counters[counter] = after;
  const change = after - before;
  // r4-fxb (CR 122.1b, 613.7c): the keyword a keyword counter gives has the timestamp of the counter; the latest one put on decides (statics/live.ts#counterEffects)
  if (change > 0 && KEYWORD_COUNTER_SET.has(counter)) (o.counterStamps ??= {})[counter] = g.newTimestamp();
  else if (after === 0 && o.counterStamps && Object.hasOwn(o.counterStamps, counter)) {
    delete o.counterStamps[counter];
    if (Object.keys(o.counterStamps).length === 0) delete o.counterStamps;
  }
  if (change !== 0) g.emit({ type: 'countersChanged', target: id, counter, delta: change, ...(by !== undefined && change > 0 ? { by } : {}) }); // FAST5X E21: who put them (CR 122.6)
  return change;
}
