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
  // edh-next-99 (CR 608.2c, 118.12; Insatiable Frugivore): "..., then you may exile three cards from your graveyard. If you do, repeat this process.": the sentence before the
  // marker is part of the same unit (steps before the last one), the option is a `pay` whose `then` holds the marker, and "this process" is the whole effect
  const lastStep = u.steps[u.steps.length - 1];
  if (lastStep === undefined || (u.steps.length !== 1 && lastStep['op'] !== 'pay')) return null;
  let s = lastStep;
  let others = 0;
  // edh-next-87 (CR 608.2c, 603.4; Primal Surge): "Exile the top card of your library. If it's a permanent card, you may put it onto the battlefield. If you do, repeat this process.": the marker
  // is the last instruction of an `if` (the "If you do" of the option) that is itself the last instruction of the `then` of the top-level `if`; every `if` on the way has no `else`
  for (let depth = 0; depth < 3; depth++) {
    const then = s['then'];
    if ((s['op'] !== 'if' && !(depth === 0 && s['op'] === 'pay' && u.steps.length > 1)) || s['else'] !== undefined || !Array.isArray(then) || then.length === 0) return null;
    const last = then[then.length - 1];
    visit(then.slice(0, -1) as Rec[], (n) => {
      if (n['op'] === 'repeat' && n['process'] === true) others++;
    });
    if (isRec(last) && isMarker(last) && last['again'] === true) return others === 0 ? last : null;
    if (!isRec(last) || last['op'] !== 'if') return null;
    s = last;
  }
  return null;
}

/**
 * edh-d-1 (CR 701.30, 608.2c; Hoarder's Greed): "...then clash with an opponent. If you win, repeat this process.": the `again` marker is the only step of the `onWin` of the
 * LAST step of the unit, a clash (the result sentence is folded into the clash, parser/lower/clash.ts); no other repeat of a process in the unit.
 */
function clashAgainMarkerOf(u: Unit): Rec | null {
  const last = u.steps[u.steps.length - 1];
  if (last === undefined || last['op'] !== 'clash' || last['onLose'] !== undefined) return null;
  const win = last['onWin'];
  if (!Array.isArray(win) || win.length !== 1 || !isRec(win[0]) || !isMarker(win[0]) || win[0]['again'] !== true) return null;
  let others = 0;
  visit(u.steps.slice(0, -1), (n) => {
    if (n['op'] === 'repeat' && n['process'] === true) others++;
  });
  return others === 0 ? win[0] : null;
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
      const m = againMarkerOf(u) ?? clashAgainMarkerOf(u);
      if (m === null) return manualMarker('with no count, not the last instruction of a condition of its own sentence');
      // edh-d-1: the result sentences folded into a clash leave units without steps after it
      // edh-d-101 (CR 608.2c; Demonlord Belzenlok): "Exile cards ... until you exile a nonland card, then put that card into your hand. If the card's mana value is 4 or greater, repeat
      // this process. ~ deals 1 damage to you for each card put into your hand this way.": an instruction after the marker's sentence is no part of "this process" (the words name what came
      // before them); it runs once, after the last run, and "this way" there counts every run (effects/handlers/control.ts#repeatHandler gathers the results). Only understood sentences
      // after it, none of them a repeat of a process, and only for a marker of an `if` (never a clash's)
      const later = seq.slice(i + 1);
      if (later.some((p) => p.manual !== undefined)) return manualMarker('with no count, a sentence after it that is not understood');
      let laterRepeat = false;
      for (const p of later) visit(p.steps, (n) => { if (n['op'] === 'repeat') laterRepeat = true; });
      if (later.some((p) => p.steps.length > 0) && (laterRepeat || againMarkerOf(u) === null)) return manualMarker('with no count, a sentence after it');
      const before = seq.slice(0, i);
      // edh-d-1: a clash's marker also has the earlier instructions of its own unit ("lose 2 life and draw two cards, then clash")
      const ownEarlier = u.steps.length > 1;
      if ((before.length === 0 && !ownEarlier) || before.some((p) => p.manual !== undefined)) return fail('no earlier instruction, or one that is not understood');
      const steps = before.flatMap((p) => p.steps);
      let nested = false;
      visit(steps, (n) => {
        if (n['op'] === 'repeat' && n['process'] === true) nested = true;
      });
      visit(u.steps.slice(0, -1), (n) => {
        if (n['op'] === 'repeat' && n['process'] === true) nested = true;
      });
      if ((steps.length === 0 && !ownEarlier) || nested) return fail('no earlier instruction, or earlier instructions that repeat a process themselves');
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
    // edh-zones-10 (CR 608.2c; Tainted Pact): "Repeat this process until C" is a do-while: the instructions before the sentence are the process, done once and again until C holds,
    // so they MOVE into the body (a copy beside them would run the first pass twice) and their sentences keep their places with no step of their own. "The cards exiled this
    // way" (`gather`) are the cards the first instruction of the process that exiles a card named (`of`); with none the sentence stays unresolved
    if (marker['until'] !== undefined) {
      const exiler = steps.find((s) => s['op'] === 'move' && isRec(s['to']) && s['to']['zone'] === 'exile' && typeof s['as'] === 'string');
      const gather = marker['gather'];
      if (isRec(gather) && gather['of'] === undefined) {
        if (exiler === undefined) return fail('no named instruction of the process that exiles a card');
        gather['of'] = exiler['as'];
      }
      marker['do'] = JSON.parse(JSON.stringify(steps)) as Rec[];
      for (const p of before) p.steps = [];
      return;
    }
    marker['do'] = JSON.parse(JSON.stringify(steps)) as Rec[];
  });
}

/** edh-misc-2: the marker of "Repeat the following process X times." (template eff.edhx2.repeatFollowing): a `repeat` with a count, neither `process` nor `again`, and an empty `do`. */
const isFollowingMarker = (n: Rec): boolean => n['op'] === 'repeat' && n['process'] === undefined && n['again'] === undefined && Array.isArray(n['do']) && (n['do'] as unknown[]).length === 0;

/**
 * edh-misc-2 (CR 608.2c; Torment of Hailfire): "Repeat the following process X times. Each opponent loses 3 life unless that player sacrifices a nonland permanent of
 * their choice or discards a card." The sentence after the marker, understood, with no target of its own and on the same Oracle line, is the body: its steps move into
 * the `do` of the repeat (the sentence keeps its place, with no step left of its own). A marker with no such sentence after it (or a manual one) stays unresolved and the
 * sentence is manual (design 6.4: no guessing at what "the following process" covers).
 */
export function foldRepeatFollowing(seq: Unit[]): void {
  seq.forEach((u, i) => {
    if (u.manual !== undefined || u.steps.length !== 1 || !isRec(u.steps[0]) || !isFollowingMarker(u.steps[0])) return;
    const marker = u.steps[0];
    const next = seq[i + 1];
    const fail = (why: string): void => setManual(u, { code: 'unbound-reference', reason: `"repeat the following process": ${why} (CR 608.2c)`, unresolved: true });
    if (next === undefined || next.manual !== undefined || next.rider !== undefined || next.steps.length === 0 || (next.targetIds ?? []).length > 0 || next.line !== u.line) return fail('no understood sentence with no target of its own follows it on the same line');
    if (seq.slice(i + 2).some((x) => x.line === u.line)) return fail('a process of more than one sentence (only the one sentence after it is read)');
    let nested = false;
    visit(next.steps, (n) => {
      if (n['op'] === 'repeat') nested = true;
    });
    if (nested) return fail('the sentence after it repeats a process itself');
    marker['do'] = JSON.parse(JSON.stringify(next.steps)) as Rec[];
    next.steps = [];
  });
}

/**
 * edh-next-99 (CR 601.2, 608.2g, 406.1; Glorious Purpose): "You may cast any number of spells from among them without paying their mana costs. Put the rest into your hand.": a chosen
 * spell that cannot be cast (no legal target, an extra cost that can't be paid) stays in exile and is part of "the rest", so the cast leaves it out of its binding (`dropUncast`, trek-21).
 * Only the free cast of an any-number choice that a later move of "the rest" (the group less that choice, still in exile) reads.
 */
export function markDropUncast(seq: Unit[]): void {
  const all: Rec[] = [];
  for (const u of seq) visit(u.steps, (n) => { all.push(n); });
  for (const c of all) {
    if (c['op'] !== 'cast' || c['free'] !== true || c['dropUncast'] !== undefined || !isRec(c['what']) || c['what']['ref'] !== 'bound' || typeof c['what']['name'] !== 'string') continue;
    const name = c['what']['name'];
    const choice = all.find((n) => n['op'] === 'chooseObjects' && n['as'] === name);
    if (choice === undefined || choice['max'] !== 'any') continue;
    const restRead = all.some((n) => n['op'] === 'move' && isRec(n['what']) && n['what']['ref'] === 'each' && isRec(n['what']['filter']) && isRec(n['what']['filter']['not'])
      && isRec(n['what']['filter']['not']['is']) && n['what']['filter']['not']['is']['name'] === name && n['what']['filter']['zone'] === 'exile');
    if (restRead) c['dropUncast'] = true;
  }
}
