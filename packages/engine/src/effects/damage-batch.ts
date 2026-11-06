/**
 * edh-replace-3 (CR 615.13): "Such an ability triggers each time a prevention effect is applied to one or more simultaneous damage events". The number of the simultaneous
 * proposal (effects/funnels.ts#proposeSimultaneous) that is running, so the `damagePrevented` events of one batch can be told from those of separate damage events.
 */
import type { Game } from '../core/game';
import { setShieldLeft } from './perform-events';

const COUNTER = new WeakMap<Game, { next: number; current: number | null }>();
const state = (g: Game): { next: number; current: number | null } => {
  let c = COUNTER.get(g);
  if (!c) COUNTER.set(g, (c = { next: 1, current: null }));
  return c;
};

/** Runs `run` as one simultaneous batch. */
export function inDamageBatch<T>(g: Game, run: () => T): T {
  const c = state(g);
  const before = c.current;
  const mine = c.next++;
  c.current = mine;
  try {
    return run();
  } finally {
    c.current = before;
    releaseSpentShields(g, mine);
  }
}

/**
 * edh-d-15 (CR 615.8, 615.7, 614.5; Dazzling Reflection): "the next time that creature would deal damage this turn, prevent that damage" is used up by ONE time: damage a
 * creature deals at the same moment to several recipients (trample, two blockers) is dealt at that time, so the shield prevents all of it. recId -> the batch that used it.
 */
const USED = new WeakMap<Game, Map<string, { batch: number; spent: boolean; key: string }>>();

/**
 * A "next time" shield applying to a damage event: true when it was already used in this simultaneous batch (it applies again and is not used up a second time).
 * Otherwise remembers the use; `spent` says the use was its last, so the record is removed when the batch ends (effects/prevent.ts#setShieldLeft removes it now when the
 * damage is not in a batch). Damage proposed on its own is a batch of its own (damageBatchId) and has no later events.
 */
export function shieldUsedInBatch(g: Game, recId: string, lastUse: boolean, key: string): boolean {
  const c = state(g);
  if (c.current === null) return false;
  let m = USED.get(g);
  if (!m) USED.set(g, (m = new Map()));
  const u = m.get(recId);
  if (u !== undefined && u.batch === c.current) return true;
  // two shields of the very same wording over the same source (two Dazzling Reflections, ruling 2016-01-22): only one of them applies the next time, so a second one is not used up in this batch
  const twin = [...m.values()].some((x) => x.batch === c.current && x.key === key);
  m.set(recId, { batch: c.current, spent: twin ? false : lastUse, key });
  return twin;
}

/** True when the shield was last used in this batch and its record is held until the batch ends (the shield is spent, but the batch's other events still see it). */
export function shieldHeldInBatch(g: Game, recId: string): boolean {
  const c = state(g);
  const u = USED.get(g)?.get(recId);
  return c.current !== null && u !== undefined && u.batch === c.current && u.spent;
}

function releaseSpentShields(g: Game, batch: number): void {
  const m = USED.get(g);
  if (!m) return;
  for (const [id, u] of [...m]) {
    if (u.batch !== batch) continue;
    m.delete(id);
    if (u.spent) setShieldLeft(g, id, 0); // (a performer: effects/perform-events.ts) a spent shield is gone
  }
}

const APPLIED = new WeakMap<Game, Set<string>>();
/** edh-b-5 (CR 615.5, 614.5): true the first time an effect is applied to a recipient in a batch (and remembers it), false for the later applications of the same batch. */
export function firstApplicationInBatch(g: Game, effect: string, recipient: string): boolean {
  let set = APPLIED.get(g);
  if (!set) APPLIED.set(g, (set = new Set()));
  const key = `${damageBatchId(g)}|${effect}|${recipient}`;
  if (set.has(key)) return false;
  set.add(key);
  return true;
}

/** The batch the prevention is applied in; damage proposed on its own is a batch of its own. */
export function damageBatchId(g: Game): number {
  const c = state(g);
  return c.current ?? c.next++;
}
