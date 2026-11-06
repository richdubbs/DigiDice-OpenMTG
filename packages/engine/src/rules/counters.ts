/** Counters on permanents (CR 122). Players' poison counters are in rules/life.ts. */
import type { ObjectId, PlayerId } from '../types/ids';
import type { Game } from '../core/game';
import type { GameState } from '../types/state';
import { cantDo } from './cant';
import type { Denial } from './denial';
import { ruleDenial } from '../statics/hooks';
import { ENTERING_TOGETHER } from '../effects/entering-together';
import { KEYWORD_COUNTERS } from '../statics/mods';

const KEYWORD_COUNTER_SET: ReadonlySet<string> = new Set(KEYWORD_COUNTERS);

/**
 * Does a "can't have counters put on it" effect forbid putting counters on this object now (CR 122.6, 614.17)? edh-fix-4 (CR 614.12; Solemnity ruling 2017-07-14: "If an artifact, creature,
 * enchantment, or land would enter the battlefield with counters on it at the same time that Solemnity enters the battlefield, Solemnity doesn't stop it from getting those counters"): while a
 * group of objects is put onto the battlefield together, the static abilities of the others of the group are not asked (they are not on the battlefield yet).
 */
export function countersPutDenial(g: Game, id: ObjectId, state: GameState = g.s, counter?: string): Denial | null {
  const together = ENTERING_TOGETHER.get(g);
  return ruleDenial(state, { action: 'haveCountersPut', subject: id, ...(counter !== undefined ? { counter } : {}), ...(together !== undefined && together.size > 0 ? { ignoreSources: together } : {}) });
}

/**
 * edh-players-22 (CR 122.1d, 101.2, 614.17; Fear of Sleep Paralysis): "Stun counters can't be removed from permanents your opponents control." Does that stop a stun counter
 * being removed from this permanent now? (Scryfall ruling 2024-09-20: the permanent doesn't untap and the counter stays.)
 */
export function stunRemovalDenial(state: GameState, id: ObjectId): Denial | null {
  return ruleDenial(state, { action: 'haveStunCountersRemoved', subject: id });
}

/** edh-players-22: how many counters of `kind` (every kind for `'any'`) may be removed from the object toward a cost: the stun counters of a permanent they can't be removed from do not count. */
export function removableCounters(state: GameState, id: ObjectId, counters: Readonly<Record<string, number>>, kind: string): number {
  const usable = Object.hasOwn(counters, 'stun') && stunRemovalDenial(state, id) ? { ...counters, stun: 0 } : counters;
  if (kind !== 'any') return Object.hasOwn(usable, kind) ? usable[kind] ?? 0 : 0;
  return Object.keys(usable).reduce((n, k) => n + (usable[k] ?? 0), 0);
}

/**
 * Put (delta > 0) or remove (delta < 0) counters; a permanent can't have fewer than 0. Returns the change that actually happened. WP31: counters can't be put
 * on an object a "can't have counters put on it" effect protects (CR 122.6, 614.17: as it enters, from wither and infect damage, from an effect).
 */
export function addCounters(g: Game, id: ObjectId, counter: string, delta: number, by?: PlayerId): number {
  const o = g.obj(id);
  if (delta > 0 && countersPutDenial(g, id, g.s, counter)) {
    g.log(`No ${counter} counter can be put on ${g.nameOf(id)}: a "can't" effect forbids it.`, { rules: ['CR 122.6', 'CR 614.17'], level: 'info' });
    return 0;
  }
  if (delta < 0 && counter === 'stun' && stunRemovalDenial(g.s, id)) { // edh-players-22 (CR 122.1d, 614.17)
    g.log(`No stun counter can be removed from ${g.nameOf(id)}: a "can't" effect forbids it.`, { rules: ['CR 122.1d', 'CR 614.17'], level: 'info' });
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
  if (change !== 0) g.emit({ type: 'countersChanged', target: id, counter, delta: change, ...(by !== undefined ? { by } : {}) }); // FAST5X E21: who put them (CR 122.6); edhd68: and who removed them
  return change;
}
