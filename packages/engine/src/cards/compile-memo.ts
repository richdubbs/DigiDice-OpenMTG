/**
 * P1 (performance): compiled definitions of the default compiler, keyed by the compile sources and the card's content, so a card compiled again (the same
 * deck loaded twice, a decklist with a card the last one had, a test or a bot building many games from the same cards) costs a copy instead of a parse.
 *
 * Key: the sources object `compileCard(card)` uses (cards/compile.ts#defaultCompileSources; it carries `compilerVersion`, and a new object is made when the
 * engine's capabilities are installed) and the card's JSON (every Oracle field the compiler reads, `unsanctioned` included).
 *
 * Contract (the same as before P1, whatever the call history): EVERY caller, the first one included, gets its own deep copy, mutable all the way down, so the
 * stored definition is never handed out and a caller may edit or freeze what it gets. The pipeline's output is itself mutable and owns its abilities (it copies
 * the parser's out of the frozen parse memo, cards/pipeline.ts), so a fresh compile and a memo hit hand out the same kind of data.
 * Least recently used first out. The disk cache of compiled definitions by compiler version and text hash belongs to the server (docs/design/m8-client.md,
 * `.cache/compiled/`). A process-wide memo that outlives actions: an accepted deviation (P1, 2026-10-12; see docs/ARCHITECTURE.md) (see rules/characteristics.ts `RECENT`).
 */
import type { CardDef, OracleCard } from '../types/card';
import { copyData } from '../util/copy-data';

const SIZE = 1024;
const BY_SOURCES = new WeakMap<object, Map<string, CardDef>>();

/** A copy of `compile(card)` for these sources, made from the definition compiled for the same sources and card content before when there is one. */
export function memoCompile(sources: object, card: OracleCard, compile: (card: OracleCard) => CardDef): CardDef {
  let key: string;
  try {
    key = JSON.stringify(card);
  } catch {
    return compile(card); // not plain data (contract C1: compiling never throws): compiled without the memo
  }
  if (typeof key !== 'string') return compile(card);
  let memo = BY_SOURCES.get(sources);
  if (memo === undefined) BY_SOURCES.set(sources, (memo = new Map()));
  const hit = memo.get(key);
  if (hit !== undefined) {
    memo.delete(key);
    memo.set(key, hit); // most recently used last
    return copyData(hit);
  }
  const def = compile(card);
  memo.set(key, def); // kept, never handed out: the first caller gets a copy too
  if (memo.size > SIZE) memo.delete(memo.keys().next().value!);
  return copyData(def);
}
