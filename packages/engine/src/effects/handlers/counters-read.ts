/** The reader of the counters on an object or a player (CR 122.1), apart from the handlers of counters.ts so that choose.ts can read them (design 5.4: no import cycles). */
import type { PlayerId } from '../../types/ids';
import type { ObjHandle } from '../../types/state';
import type { ExecCtx } from '../api';

type Holder = ObjHandle | PlayerId;

/**
 * The counters on an object or a player right now (CR 122.1; a player's poison counters live in `PlayerState.poison`, CR 122.1f). Kinds in a fixed order.
 * Exported for the native proliferate (actions-native-counters.ts, PUSH1 T1: INTERFACE CHANGE, one reader of counters instead of two).
 */
export function countersOn(cx: ExecCtx, on: Holder): Record<string, number> {
  const raw: Record<string, number> = typeof on === 'string'
    ? (() => { const p = cx.g.player(on); return { ...p.counters, ...(p.poison > 0 ? { poison: p.poison } : {}) }; })()
    : { ...(cx.g.s.objects[on.id]?.counters ?? {}) };
  const out: Record<string, number> = {};
  for (const k of Object.keys(raw).sort()) if ((raw[k] ?? 0) > 0) out[k] = raw[k]!; // determinism (design 8.8 rule 1)
  return out;
}

