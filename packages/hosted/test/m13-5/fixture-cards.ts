/**
 * A deck workers' card source for the M13-5 tests (`CardSourceSpec.module`): the engine's fixture cards (packages/engine/test/fixtures), exact names
 * only. Test data only. `hangOn`: a deck naming that card blocks the worker for `hangMs` (the deck pool's deadline test).
 */
import type { CardSource } from '@openmtg/net/server-kit';
import { loadFixtureCards } from '../../../engine/test/fixtures';

export async function createCardSource(options: unknown): Promise<CardSource> {
  const o = (options ?? {}) as { hangOn?: string; hangMs?: number };
  const cards = loadFixtureCards();
  return {
    async resolveNames(names) {
      if (o.hangOn && names.includes(o.hangOn)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, o.hangMs ?? 5_000);
      return { resolved: names.map((name) => ({ name, card: cards[name] ?? null, source: cards[name] ? ('local' as const) : ('none' as const) })) };
    },
    suggest: () => [],
  };
}
