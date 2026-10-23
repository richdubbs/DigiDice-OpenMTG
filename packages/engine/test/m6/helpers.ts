/**
 * Shared helpers of the milestone 6 tests (m6 design 4.2: M6-0 owns test/m6/helpers.ts and test/m6/skeleton/). Real fixture cards in scenario states, driven by
 * real actions (test/m5/helpers.ts), plus the means to add a TEST PART to a registry for the duration of one test and take it out again.
 */
export { act, answer, find, pass, scenario, put, tweak } from '../m5/helpers';
export { drive } from '../m5/cr-examples/helpers';
export { ctxOn, putOnStack } from '../m5/eval/helpers';

/**
 * Run `fn` with `entries` appended to a registry array (a `readonly` export, a mutable array at run time) and remove them again whatever happens: a test part
 * must never outlive its test (test/shared-state-guard.ts fails a file that leaves a registry changed).
 */
export function withEntries<T, R>(registry: readonly T[], entries: T[], fn: () => R): R {
  const arr = registry as T[];
  const at = arr.length;
  arr.push(...entries);
  try {
    return fn();
  } finally {
    arr.splice(at, entries.length);
  }
}

/** Run `fn` with `table[key] = value` (a registry record) and restore the key's previous state (absent or its old value) afterwards. */
export function withEntry<R>(table: object, key: string, value: unknown, fn: () => R): R {
  const t = table as Record<string, unknown>;
  const had = Object.hasOwn(t, key);
  const old = t[key];
  t[key] = value;
  try {
    return fn();
  } finally {
    if (had) t[key] = old;
    else delete t[key];
  }
}
