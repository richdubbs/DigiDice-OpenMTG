/**
 * Cloud r4-mech (CR 608.2c): "Repeat this process once." (template `eff.r4mech.repeatProcess`: a `repeat` with `process: true` and an empty `do`). "This process"
 * is every instruction of the effect before the sentence: the steps of all earlier sentences of the same sequence, in order, copied into `do` (they run again when
 * the repeat runs, and a lead-in condition of the sentence, "Then if C, repeat this process once", stays outside it). It is unresolved and manual when there is no
 * earlier sentence, when an earlier sentence is not understood (the process would be read in part), when the marker sits inside another step's branch than an
 * `if` of its own sentence, or when the earlier steps already hold a repeat of a process (design 6.4: no guessing at what "this process" covers).
 * std-cardcopy-1 (CR 608.2c): "If two cards that share a card type were milled this way, draw a card and repeat this process." (The Tale of Tamiyo): with no count
 * (`again`) the marker is the last instruction of the `then` of a top-level `if` of the effect's LAST sentence, and "this process" is the whole effect, that
 * sentence included: `do` is a copy of every step, the marker in it left empty (it asks the running repeat for one more run, effects/handlers/control.ts).
 */
import type { Rec, Unit } from './types';
import { isRec, setManual, visit } from './util';

const isMarker = (n: Rec): boolean => n['op'] === 'repeat' && n['process'] === true && Array.isArray(n['do']) && (n['do'] as unknown[]).length === 0;

const hasMarker = (u: Unit): boolean => {
  let found = false;
  visit(u.steps, (n) => {
    if (isMarker(n)) found = true;
  });
  return found;
};

/** The marker of a unit: a top-level step, or the only step of the `then` of a top-level `if` without an `else`. */
function markerOf(u: Unit): Rec | null {
  if (u.steps.length !== 1) return null;
  const s = u.steps[0]!;
  if (isMarker(s)) return s;
  const then = s['then'];
  if (s['op'] === 'if' && s['else'] === undefined && Array.isArray(then) && then.length === 1 && isRec(then[0]) && isMarker(then[0])) return then[0];
  return null;
}

/** std-cardcopy-1: the `again` marker of a unit: the last step of the `then` of its only step, a top-level `if` without an `else`; no other marker in the unit. */
function againMarkerOf(u: Unit): Rec | null {
  if (u.steps.length !== 1) return null;
  const s = u.steps[0]!;
  const then = s['then'];
  if (s['op'] !== 'if' || s['else'] !== undefined || !Array.isArray(then) || then.length === 0) return null;
  const last = then[then.length - 1];
  if (!isRec(last) || !isMarker(last) || last['again'] !== true) return null;
  let others = 0;
  visit(then.slice(0, -1) as Rec[], (n) => {
    if (n['op'] === 'repeat' && n['process'] === true) others++;
  });
  return others === 0 ? last : null;
}

export function foldRepeatProcess(seq: Unit[]): void {
  seq.forEach((u, i) => {
    if (u.manual || !hasMarker(u)) return;
    const fail = (why: string): void => setManual(u, { code: 'unbound-reference', reason: `"repeat this process": ${why} (CR 608.2c)`, unresolved: true });
    let again = false;
    visit(u.steps, (n) => {
      if (isMarker(n) && n['again'] === true) again = true;
    });
    if (again) {
      // A marker in any other place (a rider folded it into another sentence: "If you do, repeat this process.") is a manual step of its own, as the sentence was
      // before the template existed: the instructions around it stay what they were (never a wider manual part than the words not understood)
      const manualMarker = (why: string): void => visit(u.steps, (n) => {
        if (!isMarker(n) || n['again'] !== true) return;
        for (const k of Object.keys(n)) delete n[k];
        Object.assign(n, { op: 'manual', text: 'Repeat this process.', reason: `"repeat this process": ${why} (CR 608.2c)` });
      });
      const m = againMarkerOf(u);
      if (m === null) return manualMarker('with no count, not the last instruction of a condition of its own sentence');
      if (i !== seq.length - 1) return manualMarker('with no count, a sentence after it');
      const before = seq.slice(0, i);
      if (before.length === 0 || before.some((p) => p.manual !== undefined)) return fail('no earlier instruction, or one that is not understood');
      const steps = before.flatMap((p) => p.steps);
      let nested = false;
      visit(steps, (n) => {
        if (n['op'] === 'repeat' && n['process'] === true) nested = true;
      });
      if (steps.length === 0 || nested) return fail('no earlier instruction, or earlier instructions that repeat a process themselves');
      m['do'] = JSON.parse(JSON.stringify([...steps, ...u.steps])) as Rec[]; // the copy holds the marker as it is now: empty
      return;
    }
    const marker = markerOf(u);
    if (marker === null) return fail('the sentence is more than the repeat and a condition of its own');
    const before = seq.slice(0, i);
    if (before.length === 0 || before.some((p) => p.manual !== undefined)) return fail('no earlier instruction, or one that is not understood');
    const steps = before.flatMap((p) => p.steps);
    if (steps.length === 0) return fail('no earlier instruction');
    let nested = false;
    visit(steps, (n) => {
      if (n['op'] === 'repeat' && n['process'] === true) nested = true;
    });
    if (nested) return fail('the earlier instructions repeat a process themselves');
    marker['do'] = JSON.parse(JSON.stringify(steps)) as Rec[];
  });
}
