/**
 * M15-3's test support: searches of what a store keeps (17.6, 17.10). The service fixtures are in fixtures.ts.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LADDER_STORE_METHODS, type LadderStore } from '../../src/store/api';

/** Hooks around every LadderStore call: `before` may throw (a failure, a crash) or wait (a computation held in flight). */
export interface StoreHooks {
  before?: (method: keyof LadderStore, args: unknown[]) => void | Promise<void>;
  after?: (method: keyof LadderStore, args: unknown[], result: unknown) => void | Promise<void>;
}

/** The store with hooks around its LadderStore methods (a Proxy: the store itself is unchanged; `dump` and the rest pass through, bound). */
export function wrapStore<S extends LadderStore>(store: S, hooks: StoreHooks): S {
  return new Proxy(store, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver) as unknown;
      if (typeof v !== 'function') return v;
      if (typeof prop !== 'string' || !(LADDER_STORE_METHODS as readonly string[]).includes(prop)) return (v as (...a: unknown[]) => unknown).bind(target);
      return async (...args: unknown[]) => {
        await hooks.before?.(prop as keyof LadderStore, args);
        const out = await (v as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        await hooks.after?.(prop as keyof LadderStore, args, out);
        return out;
      };
    },
  });
}

/** A store that, once `crashAfter` has run (and committed), refuses every later call: a process that died right after that write. */
export function crashingStore<S extends LadderStore>(store: S, crashAfter: keyof LadderStore): { store: S; crashed: () => boolean } {
  let crashed = false;
  return {
    store: wrapStore(store, {
      before: () => {
        if (crashed) throw new Error('crashed');
      },
      after: (m) => {
        if (m === crashAfter) crashed = true;
      },
    }),
    crashed: () => crashed,
  };
}

/** The tables of a memory store's dump that hold `needle`. */
export function placesInDump(dump: Record<string, [string, unknown][]>, needle: string): string[] {
  const out: string[] = [];
  for (const [table, entries] of Object.entries(dump)) for (const e of entries) if (JSON.stringify(e).includes(needle)) out.push(table);
  return out;
}

/** Every file of `dir` whose bytes hold `needle`, as `file:<name>`. */
export function placesInDir(dir: string, needle: string): string[] {
  return readdirSync(dir)
    .filter((f) => readFileSync(join(dir, f)).includes(Buffer.from(needle, 'utf8')))
    .map((f) => `file:${f}`);
}
