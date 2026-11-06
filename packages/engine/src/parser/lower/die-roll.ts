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
import { DIE_ROW_OPEN } from '../../model/die-rows';
import type { Rec, Unit } from './types';
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

/** An `if` with an `else` whose `then` holds an optional action (`may` with no `otherwise` of its own) anywhere inside `steps`. */
function hasOptionThenElse(steps: unknown): boolean {
  let found = false;
  visit(steps as never, (n) => {
    if (n['op'] === 'if' && Array.isArray(n['else']) && Array.isArray(n['then']) && n['then'].some((x) => isRec(x) && x['op'] === 'may' && x['otherwise'] === undefined)) found = true;
  });
  return found;
}

/** A token-making step that stands for the tokens of an earlier row ("Create two of those tokens."). */
function isRowTokenRef(x: Rec): boolean {
  return x['op'] === 'createToken' && isRec(x['token']) && x['token']['@rowToken'] === true;
}

/** edh-next-121: the step of "You may roll again." (template eff.edhn121.mayRollAgain), a mark the fold turns into its row's `again`. */
function isRollAgain(x: unknown): boolean {
  return isRec(x) && x['@rollAgain'] === true;
}

/** edh-next-121: the step of a row "X is N." (template eff.edhn121.dieRow.xIs), a mark the fold turns into the row's `let`. */
function isRowX(x: unknown): boolean {
  return isRec(x) && x['op'] === 'let' && x['@rowX'] === true && x['name'] === 'X';
}

/** edh-next-121: is the face's text free of an {X} symbol (rollTableAbilities sets it for the face it lowers; no {X}: no other X the rows could shadow)? */
let FACE_HAS_X_SYMBOL = false;
export function withFaceX<T>(hasX: boolean, f: () => T): T {
  const saved = FACE_HAS_X_SYMBOL;
  FACE_HAS_X_SYMBOL = hasX;
  try {
    return f();
  } finally {
    FACE_HAS_X_SYMBOL = saved;
  }
}

const X_QTY = '{"q":"X"}';
/** `v` with every `{q:'X'}` replaced by the variable the rows define. */
function xAsVar(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(xAsVar);
  if (!isRec(v)) return v;
  if (JSON.stringify(v) === X_QTY) return { q: 'var', name: 'X' };
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, xAsVar(x)]));
}

/** edh-next-121 (CR 706.3a, 107.3, 608.2h; Wand of Wonder): a table whose rows only say what X is (foldRollTable). */
function defineXRows(seq: Unit[], rowUnits: Unit[], between: Unit[], roll: Rec, fail: (reason: string) => void): void {
  const sides = roll['sides'];
  if (typeof sides !== 'number' || roll['modifier'] !== undefined || roll['afterRoll'] !== undefined || FACE_HAS_X_SYMBOL) return fail('die-roll table rows that define X for a roll they cannot apply to (CR 706.3a, 107.3)');
  const reads = (u: Unit): boolean => JSON.stringify(u.steps).includes(X_QTY);
  if (between.length === 0 || between.some((u) => u.rider !== undefined || u.steps.length === 0) || !between.some(reads)) return fail('die-roll table rows that define an X no instruction between the roll and the rows uses (CR 706.3a, 107.3)');
  if (seq.some((u) => !between.includes(u) && reads(u))) return fail('an X outside the instructions between a die roll and the rows that define it (CR 107.3)');
  let next = 1;
  const rows: { min: number; max: number; value: unknown }[] = [];
  for (const u of rowUnits) {
    const r = u.row!;
    if (r.index !== rows.length || r.min !== next || r.max === null || r.max < r.min || r.max > sides) return fail('die-roll table rows that do not cover each result once (CR 706.3a)');
    const v = u.steps[0]!['value'];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return fail('a die-roll table row that defines X as something other than a number (CR 706.3a)');
    rows.push({ min: r.min, max: r.max, value: v });
    next = r.max + 1;
  }
  if (next !== sides + 1) return fail('die-roll table rows that do not cover each result once (CR 706.3a)');
  roll['table'] = rows.map((r) => ({ min: r.min, max: r.max, do: [{ op: 'let', name: 'X', value: r.value }] }));
  for (const u of between) u.steps = xAsVar(u.steps) as Rec[];
  for (const u of rowUnits) u.steps = [];
}

export function foldRollTable(seq: Unit[]): void {
  const rowUnits = seq.filter((u) => u.row !== undefined);
  if (rowUnits.length === 0) return;
  const fail = (reason: string): void => {
    for (const u of seq) setManual(u, { code: 'unbound-reference', reason, unresolved: true });
  };
  const first = seq.findIndex((u) => u.row !== undefined);
  if (seq.slice(first).some((u) => u.row === undefined)) return fail('a sentence among the rows of a die-roll table (CR 706.3a)');
  // edh-mana-keywords-10 (CR 706.3b; The Deck of Many Things): "Roll a d20 and subtract the number of cards in your hand. If the result is 0 or less, discard your hand." The
  // sentences between the roll and the rows are instructions of the same ability that act on the result: they move into the roll (`afterRoll`) and run before the table. The roll
  // is the last step of the nearest unit before them that is not one of those (a unit that is not understood fails the table, as before)
  const preceding = seq.slice(0, first);
  const understood = preceding.filter((p) => p.manual !== undefined || p.steps.length > 0);
  if (understood.some((p) => p.manual !== undefined)) return fail('a die-roll table with no understood roll right before it (CR 706.3a)');
  const isRoll = (u: Unit): boolean => u.steps.some((s) => s['op'] === 'rollDie' && s['table'] === undefined);
  let rollAt = -1;
  for (let k = understood.length - 1; k >= 0; k--) if (isRoll(understood[k]!)) { rollAt = k; break; }
  const before = rollAt >= 0 ? understood[rollAt] : undefined;
  if (before === undefined || before.manual) return fail('a die-roll table with no understood roll right before it (CR 706.3a)');
  const between = understood.slice(rollAt + 1);
  const rollSteps = before.steps;
  const roll = rollSteps[rollSteps.length - 1];
  const who = roll?.['who'];
  const oneDie = roll !== undefined && (roll['count'] === undefined || roll['count'] === 1 || roll['keepHighest'] === true); // edh-d-49 (CR 706.6): all but the highest roll ignored, one result for the table
  if (roll === undefined || roll['op'] !== 'rollDie' || roll['table'] !== undefined || roll['chooseOne'] !== undefined || !oneDie || !isRec(who) || who['ref'] !== 'you' || Object.keys(who).length !== 1) {
    return fail('a die-roll table whose roll is not one die rolled by you (CR 706.3a)');
  }
  // edh-next-121 (CR 706.3a, 107.3, 608.2h; Wand of Wonder): rows that only say what X is ("1-9 | X is one. 10-19 | X is two. 20 | X is three.") define the X that the instructions
  // printed between the roll and the rows use: each row becomes `let X = N` and those instructions stay where they are, after the roll, reading that value (the row of the result
  // is followed first, then the instructions in order, CR 608.2c). Fail closed: every row is one "X is N" sentence, the instructions between are understood, read X and are no
  // rider, nothing else in the ability reads X, and the ability's text has no {X} (an X of a cost would be another value)
  if (rowUnits.length > 0 && rowUnits.every((u) => u.steps.length === 1 && isRowX(u.steps[0]))) return defineXRows(seq, rowUnits, between, roll, fail);
  // only a condition on the result ("If the result is 0 or less, ..."): any other sentence there ("Roll a d20. Draw a card.") stays manual as before
  const readsResult = (u: Unit): boolean => u.steps.every((s) => s['op'] === 'if' && JSON.stringify(s['cond']).includes('"q":"dieResult"'));
  if (between.some((u) => u.rider !== undefined || u.steps.length === 0 || !readsResult(u))) return fail('a sentence between a die roll and its table that is not an instruction of its own (CR 706.3b)');
  if (between.length > 0) {
    roll['afterRoll'] = between.flatMap((u) => u.steps);
    for (const u of between) u.steps = [];
  }
  const sides = roll['sides'];
  if (typeof sides !== 'number') return fail('a die-roll table of a die with no number of sides (CR 706.1)');
  // edh-next-128 (CR 608.2c, 706.2, 400.7; Revivify): "Roll a d20 and add the number of creature cards in your graveyard that were put there from the battlefield this turn. ... 15+ | Return
  // those cards from your graveyard to the battlefield.": "those cards" in a row are the cards of your graveyard the roll's added number counted (nothing happens between the roll and
  // the row, so they are the cards of that description as the row is followed); only a row that is exactly that sentence, after a roll that adds such a count
  const mod = roll['modifier'];
  const counted = isRec(mod) && mod['q'] === 'count' && isRec(mod['of']) && mod['of']['ref'] === 'each' && isRec(mod['of']['filter']) ? mod['of']['filter'] as Rec : undefined;
  for (const u of rowUnits) {
    const those = /^return those cards from your graveyard to (the battlefield|your hand)\.$/i.exec(u.text.trim());
    if (those === null || u.manual === undefined || u.steps.length > 0) continue;
    if (counted === undefined || counted['zone'] !== 'graveyard' || counted['owner'] !== 'you') continue;
    u.manual = undefined;
    u.steps = [{ op: 'move', what: { ref: 'each', filter: counted }, to: those[1]!.toLowerCase() === 'the battlefield' ? { zone: 'battlefield', controller: { ref: 'you' } } : { zone: 'hand' } }];
    u.templates = ['edhn128.dieRow.thoseCounted'];
  }
  // the rows, in order, each with its units
  const rows: { min: number; max: number | null; units: Unit[] }[] = [];
  for (const u of rowUnits) {
    const r = u.row!;
    if (rows[r.index] === undefined) rows[r.index] = { min: r.min, max: r.max, units: [] };
    rows[r.index]!.units.push(u);
  }
  let next = 1;
  let open = false; // edh-next-24 (CR 706.2, 706.3a): the last row "15+" takes every result from 15 up (a modifier can take the result past the number of sides)
  for (let k = 0; k < rows.length; k++) {
    const r = rows[k];
    if (r === undefined || r.min !== next || r.max === null || r.max < r.min) return fail('die-roll table rows that do not cover each result once (CR 706.3a)');
    if (r.max >= DIE_ROW_OPEN) {
      if (k !== rows.length - 1) return fail('die-roll table rows that do not cover each result once (CR 706.3a)');
      open = true;
    }
    next = r.max + 1;
  }
  if (!open && next !== sides + 1) return fail('die-roll table rows that do not cover each result once (CR 706.3a)');
  // edh-mana-keywords-3: a sentence with no step of its own is a rider that the lowering folded into the step right before it ("Otherwise, put that card into
  // your hand." after "If it's an artifact card, you may put it onto the battlefield."): fine when that step is a sentence of the same row, never a row's first
  // sentence (it would have patched the step of another row)
  const sameRowBefore = (u: Unit): boolean => {
    const at = seq.indexOf(u);
    return at > 0 && seq[at - 1]!.row?.index === u.row!.index;
  };
  if (rowUnits.some((u) => u.manual !== undefined || u.rider !== undefined || (u.steps.length === 0 && !sameRowBefore(u)))) return fail('a die-roll table row that is not understood (CR 706.3a)');
  // edh-mana-keywords-3 (CR 608.2c; Treasure Chest ruling 2021-07-23): "If it's an artifact card, you may put it onto the battlefield. Otherwise, put that card into your
  // hand." The ruling reads "Otherwise" as "you didn't put it onto the battlefield", also when you decline; the lowering reads it as "it isn't an artifact card" (the
  // `else` of the condition), which is a different result when the option is declined. Not automated here: a row with an `if` whose `then` holds an option and which has
  // an `else` stays manual (fail closed) until the general reading is decided (docs/coverage record, owner question).
  if (rowUnits.some((u) => hasOptionThenElse(u.steps))) return fail('a die-roll table row with "If C, you may X. Otherwise, Y." (the ruling reads "otherwise" as not doing X, CR 608.2c)');
  // edh-next-55 (CR 706.3a, 111.1; Swarming Goblins, Delina): "Create two of those tokens." in a row names the tokens an earlier row creates ("Create a 1/1 red Goblin creature
  // token."): the row's step is a copy of that row's last token-making step with its own count (template eff.edhn55.createN.ofThoseTokens leaves `token: {"@rowToken": true}`).
  // Fail closed (the step stays unresolved: the lint refuses it) when no earlier row makes tokens
  // edh-next-121 (CR 706.3a, 707.2, 111.1; Delina, Wild Mage): or the token COPY an earlier row makes ("Create a tapped and attacking token that's a copy of that creature, except
  // ... 15-20 | Create one of those tokens."): the same copy of the same object with the same exceptions, its own count
  const rowTokens = (steps: Rec[]): Rec | undefined => [...steps].reverse().find((x) => (x['op'] === 'createToken' && !isRowTokenRef(x)) || (x['op'] === 'copy' && x['result'] === 'token'));
  for (let k = 0; k < rows.length; k++) {
    for (const u of rows[k]!.units) {
      u.steps = u.steps.map((x) => {
        if (!isRowTokenRef(x)) return x;
        for (let j = k - 1; j >= 0; j--) {
          const made = rowTokens(rows[j]!.units.flatMap((v) => v.steps));
          if (made === undefined) continue;
          const copy = JSON.parse(JSON.stringify(made)) as Rec;
          delete copy['as'];
          copy['count'] = x['count'];
          return copy;
        }
        return x;
      });
    }
  }
  // edh-next-121 (CR 706.2, 706.3a, 608.2c; Delina, Wild Mage ruling 2021-07-23: "rolling again on a result of 15-20 is optional"): "You may roll again." as the LAST
  // sentence of a row: after that row's instructions the roller may roll the same die again, and the row of the new result happens (and so on). Anywhere else (not the
  // row's last instruction, outside a row, a roll of several dice) the mark stays and the lint refuses it (fail closed)
  const again = new Set<number>();
  for (let k = 0; k < rows.length; k++) {
    const units = rows[k]!.units;
    const last = units[units.length - 1]!;
    if (last.steps.length === 1 && isRollAgain(last.steps[0]) && units.length > 1 && !units.slice(0, -1).some((u) => u.steps.some(isRollAgain))) {
      last.steps = [];
      again.add(k);
    }
  }
  if (rows.some((r) => r.units.some((u) => u.steps.some(isRollAgain)))) return fail('"roll again" that is not the last instruction of a die-roll table row (CR 706.3a)');
  const bound = rows.map((r) => boundNames(r.units.flatMap((u) => u.steps)));
  for (let k = 0; k < rows.length; k++) {
    const others = new Set(bound.flatMap((b, j) => (j === k ? [] : [...b])));
    for (const n of bound[k]!) others.delete(n);
    if (readsAny(rows[k]!.units.flatMap((u) => u.steps), others)) return fail("a die-roll table row that reads another row's instructions (CR 706.3a, 608.2c)");
  }
  roll['table'] = rows.map((r, k) => ({ min: r.min, max: r.max, do: r.units.flatMap((u) => u.steps), ...(again.has(k) ? { again: 'may' } : {}) }));
  for (const u of rowUnits) u.steps = [];
}
