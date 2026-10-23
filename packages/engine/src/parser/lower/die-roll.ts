/**
 * p2-c-dieroll-1 (CR 706.1-706.3a; cites written from memory, unverified): a die-roll result table. "Roll a d20." followed by result rows ("1-9 | Create a
 * Treasure token.", "10-19 | ...", "20 | ...") is one instruction: roll the die, then do the instructions of the row the result falls in. The segmenter gives the
 * rows to the ability above them (parser/segment.ts#DiceRow); lower/ability.ts lowers each row's sentences after the ability's own, tagged with their row
 * (`Unit.row`), so a row's pronouns read the sentences before the roll ("Its controller creates ..." after "Exile target creature, then roll a d20.").
 *
 * This pass moves every row's steps into the `table` of the roll right before the rows (the `rollDie` step the handler resolves, effects/handlers/game.ts):
 * the last top-level step of the last sentence before the rows, a roll of ONE die by you with no table yet. Fail closed: anything else is unresolved and
 * manual (and lower/ability.ts#rollTableAbilities then keeps the whole ability manual, as before this pass):
 *   - no such roll, or a sentence before the rows that is not understood;
 *   - rows that do not cover each possible result exactly once (1 to the die's sides, in order, no gap, no overlap);
 *   - a row sentence that is not understood, has no step of its own (a rider would patch the step of another row), or reads a name another row binds (that
 *     row's instructions never happen when this row is the result).
 */
import type { Unit } from './types';
import { isRec, setManual, visit } from './util';

/** The names bound (`as`, `let`) anywhere in some steps. */
function boundNames(steps: unknown): Set<string> {
  const out = new Set<string>();
  visit(steps as never, (n) => {
    if (typeof n['as'] === 'string') out.add(n['as']);
    if (typeof n['let'] === 'string') out.add(n['let']);
  });
  return out;
}

/** Does any string value in `steps` equal one of `names`? (a binding read, whatever key holds it) */
function readsAny(steps: unknown, names: ReadonlySet<string>): boolean {
  if (names.size === 0) return false;
  let found = false;
  const walk = (v: unknown): void => {
    if (found) return;
    if (typeof v === 'string') { if (names.has(v)) found = true; return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (isRec(v)) for (const x of Object.values(v)) walk(x);
  };
  walk(steps);
  return found;
}

export function foldRollTable(seq: Unit[]): void {
  const rowUnits = seq.filter((u) => u.row !== undefined);
  if (rowUnits.length === 0) return;
  const fail = (reason: string): void => {
    for (const u of seq) setManual(u, { code: 'unbound-reference', reason, unresolved: true });
  };
  const first = seq.findIndex((u) => u.row !== undefined);
  if (seq.slice(first).some((u) => u.row === undefined)) return fail('a sentence among the rows of a die-roll table (CR 706.3a)');
  const before = seq.slice(0, first).reverse().find((p) => p.manual !== undefined || p.steps.length > 0);
  if (before === undefined || before.manual) return fail('a die-roll table with no understood roll right before it (CR 706.3a)');
  const roll = before.steps[before.steps.length - 1];
  const who = roll?.['who'];
  if (roll === undefined || roll['op'] !== 'rollDie' || roll['table'] !== undefined || (roll['count'] !== undefined && roll['count'] !== 1) || !isRec(who) || who['ref'] !== 'you' || Object.keys(who).length !== 1) {
    return fail('a die-roll table whose roll is not one die rolled by you (CR 706.3a)');
  }
  const sides = roll['sides'];
  if (typeof sides !== 'number') return fail('a die-roll table of a die with no number of sides (CR 706.1)');
  // the rows, in order, each with its units
  const rows: { min: number; max: number; units: Unit[] }[] = [];
  for (const u of rowUnits) {
    const r = u.row!;
    if (rows[r.index] === undefined) rows[r.index] = { min: r.min, max: r.max, units: [] };
    rows[r.index]!.units.push(u);
  }
  let next = 1;
  for (let k = 0; k < rows.length; k++) {
    const r = rows[k];
    if (r === undefined || r.min !== next || r.max < r.min) return fail('die-roll table rows that do not cover each result once (CR 706.3a)');
    next = r.max + 1;
  }
  if (next !== sides + 1) return fail('die-roll table rows that do not cover each result once (CR 706.3a)');
  if (rowUnits.some((u) => u.manual !== undefined || u.steps.length === 0 || u.rider !== undefined)) return fail('a die-roll table row that is not understood (CR 706.3a)');
  const bound = rows.map((r) => boundNames(r.units.flatMap((u) => u.steps)));
  for (let k = 0; k < rows.length; k++) {
    const others = new Set(bound.flatMap((b, j) => (j === k ? [] : [...b])));
    for (const n of bound[k]!) others.delete(n);
    if (readsAny(rows[k]!.units.flatMap((u) => u.steps), others)) return fail("a die-roll table row that reads another row's instructions (CR 706.3a, 608.2c)");
  }
  roll['table'] = rows.map((r) => ({ min: r.min, max: r.max, do: r.units.flatMap((u) => u.steps) }));
  for (const u of rowUnits) u.steps = [];
}
