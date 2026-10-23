/**
 * P1: a deep copy of plain data that keeps every own key, `undefined` values included, and that is mutable all the way down even when its source is frozen.
 * Used where compiled card data must be the caller's own (cards/compile-memo.ts, and cards/pipeline.ts for the parser's abilities, which the parse memo
 * shares frozen). Unlike util/clone.ts#clone, an `undefined` property is kept, so a copy has the exact object shape of what it copies. Pure.
 */
export function copyData<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(copyData) as T;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) out[k] = copyData((v as Record<string, unknown>)[k]);
  return out as T;
}
