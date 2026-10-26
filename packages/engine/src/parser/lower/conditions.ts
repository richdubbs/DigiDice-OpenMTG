/**
 * Pass 7, conditions (design 6.5). Owner: WP17.
 *
 *  - "if you do" / "if you don't" (`{cond:'did', step:'', $step}` from the Cond hole) refer to the instruction RIGHT BEFORE them (CR 118.12: "[Do
 *    something]. If [a player] does, ..." checks that action, optional or not; CR 608.2c): the previous top-level step of the same sentence, or the last
 *    top-level step of the previous sentence. That step gets an `as` name and the condition names it (the interpreter records whether every step was
 *    performed). There is no search further back and no "nearest may" (design 6.4: no "most recent" choice). When that instruction is a sentence of
 *    the same sequence that is not understood, it is still the unique antecedent: the condition names what that manual sentence would have produced, so
 *    taint T1 (design 6.7) makes the reading step manual and nothing else (WP19 review: "~ deals 3 damage ... You may discard a card. If you do, draw a
 *    card." keeps its damage step). The reference is unresolved, so the sentence is manual and contagious (T2), when that instruction is a control step
 *    (`if`, `forEach`, ...), nested, or a sentence of a modal header outside the option.
 *  - LOOK3 (CR 608.2c): "If you don't put the card onto the battlefield / into your hand, ..." (`did` with `not` and `to`, zz-cloud/look3.json) names the move of one
 *    card to that zone that the instruction right before it ends with, inside its `if` and its `may` (model/focus.ts#notPutMove); it is true when that move was not
 *    performed, declined or never offered.
 *  - "[Player] may pay [cost]. If [they do / don't], [effect]." is ONE `pay` step (CR 118.12): a sentence that is only `if did <pay>` right after that pay is
 *    folded into its `then` (did) or `else` (did not). Smothering Tithe's two sentences and Mana Leak's "unless" give the same node (design 13.1).
 *  - FAST5 T44 (CR 118.12): "[Player] may [cost] or [cost]. If you do, X." is a `pay` whose only `else` is a second `pay` by the same player (no `then`, no
 *    `else`): the three outcomes (the first cost, the second, neither). "If you do" is true after either payment, so the sentence is folded into BOTH payments'
 *    `then` (a copy for the second). Any other reader of that payment ("if you don't", "when you do") is unresolved and manual.
 *  - The lead-in "if" and the intervening "if" of a trigger (CR 603.4) are built by templates and by the ability driver; nothing is left for them here.
 *  - A delayed trigger's instructions continue past its sentence (WP23): "At the beginning of your next upkeep, pay {3}{U}{U}. If you don't, you lose the
 *    game." The "if you don't" sentence right after a sentence that ends with a `delay` step is part of the delayed triggered ability (CR 603.7: it is
 *    created with all its instructions) and refers to the last instruction INSIDE it; it moves into the delay's `do` (folded into a `pay` there as above).
 *    Creating a delayed trigger is never itself the action "you do" refers to, so `delay` is not an action for `did`.
 *  - "When you do, X." (WP23, template `rf.whenYouDo`) is a reflexive trigger (CR 603.12): its `when` is the `did` of the instruction right before it,
 *    written `{did: name}`, and the targets named inside it are chosen when the reflexive trigger is put on the stack (CR 603.12a, 603.3d), so their specs
 *    move from the ability into the reflexive step. Anything else ("when you don't", a target also used outside it, a reflexive nested in a branch) is
 *    manual.
 */
import { shieldShape } from '../taint';
import { stepsInOrder } from './mentions';
import type { Draft, Rec, Unit } from './types';
import { clone, cloneDraft, freshName, isRec, rewrite, sequences, setManual, visit } from './util';
import { notPutMove } from '../../model/focus';
import { foldFlips } from './coin-flip';
import { foldClashes } from './clash';
import { foldRollTable } from './die-roll';
import { foldRepeatProcess } from './repeat-process';
import { STEP_DELAY_TARGET_LEADS } from './targets';

/** Steps whose "did" is not the success of one action (control flow), and the manual placeholder: never the producer of `did`. */
const NOT_AN_ACTION: ReadonlySet<string> = new Set(['if', 'forEach', 'repeat', 'let', 'reflexive', 'manual', 'delay']);
const STEP_LISTS: ReadonlySet<string> = new Set(['then', 'else', 'do', 'otherwise', 'onWin', 'onLose']);

/**
 * The instruction right before the condition at `path` (relative to top-level step `top` of `u`), or null. `u.steps[0..top-1]` are the steps as they
 * will be kept (the caller rewrites in place, in order).
 */
function previousInstruction(seq: readonly Unit[], at: number, top: number, path: string, prefix: readonly Unit[], negated = false, raw = false, intoIf = false): Rec | Unit | null {
  const parts = path.split('/').filter((x) => x !== '');
  if (parts.some((x, k) => STEP_LISTS.has(x) && /^\d+$/.test(parts[k + 1] ?? ''))) return null; // inside a nested step list: not resolved here
  const u = seq[at]!;
  let step: Rec | undefined;
  if (top > 0) step = u.steps[top - 1];
  else {
    const before = [...prefix, ...seq.slice(0, at)].filter((x) => x.manual !== undefined || x.steps.length > 0);
    const prev = before[before.length - 1];
    if (prev === undefined) return null; // nothing before it
    // WP19 review: a sentence of THIS sequence that is not understood is the unique antecedent; it is manual, so the condition reading it is poisoned
    // (design 6.7 T1: only that sentence becomes manual), not contagious. One in the prefix (a modal header's sentences) stays unresolved.
    if (prev.manual) return seq.slice(0, at).includes(prev) ? prev : null;
    step = prev.steps[prev.steps.length - 1];
  }
  if (raw) return step ?? null; // LOOK3: the instruction itself, a control step too (resolveDid finds the move inside it)
  // r3-refs (CR 608.2c, 608.2d): "You may X. If you do, Y. If you don't, Z." (and the other order): the sentence right before is the other answer to the same
  // option, an `if` on whether it was done (no `else`, no guard), so "you do" / "you don't" here names the same instruction that one names
  const other = top === 0 ? sameOption(seq, at, prefix, step) : null;
  if (other !== null) return other;
  // T3 (push wave): "If C, you may X. If you do, Y." resolves "you do" to the `may` the lead-in "if" wraps (one instruction, no "otherwise"). This only
  // keeps the rest of the effect out of T2 contagion (CR 608.2c): the name the `may` binds is bound on the "then" path alone, so the lint (unbound-name)
  // still lowers Y as a manual step; Y is never automated by this. "If you don't" there stays unresolved (the text does not settle whether "not doing"
  // includes "not being offered").
  const then = step?.['then'];
  if (!negated && step !== undefined && step['op'] === 'if' && step['else'] === undefined && step['guard'] === undefined && Array.isArray(then) && then.length === 1
    && isRec(then[0]) && then[0]['op'] === 'may') return then[0];
  // std-blb (CR 608.2c, 118.12): "Then if C, X. If you do, Y." resolves "you do" to X, the last instruction of the branch of the `if` right before (no
  // `else`, no guard; not a payment, which foldPay owns). (Cloud std-fin wrote the same reading for a branch of one instruction, "[Then] if C, sacrifice ~. If you
  // do, Y." (The Misty Mountains Cold), with its foldActionInIf: merged into this one, which also reads a longer branch.) Only for a sentence that is nothing but "If you do, Y." (`intoIf`): foldDidInIf then moves it into
  // that branch, the one path on which X's name is bound. "If you don't" stays unresolved, as for T3 above.
  if (intoIf && !negated && step !== undefined && step['op'] === 'if' && step['else'] === undefined && step['guard'] === undefined && Array.isArray(then) && then.length > 0) {
    const last = then[then.length - 1];
    if (isRec(last) && typeof last['op'] === 'string' && !NOT_AN_ACTION.has(last['op']) && last['op'] !== 'pay') return last;
  }
  return step !== undefined && typeof step['op'] === 'string' && !NOT_AN_ACTION.has(step['op']) ? step : null;
}

/**
 * r3-refs (CR 608.2c, 608.2d): `step`, the last instruction of the sentence right before, is "If you do, Y." or "If you don't, Y." (an `if` whose condition is
 * exactly whether a named instruction was done, nothing else: no `else`, no guard, no "which" or destination): the instruction it names, found among the
 * instructions of the earlier sentences of the sequence; else null.
 */
function sameOption(seq: readonly Unit[], at: number, prefix: readonly Unit[], step: Rec | undefined): Rec | null {
  if (step === undefined || step['op'] !== 'if' || step['else'] !== undefined || step['guard'] !== undefined || !isRec(step['cond'])) return null;
  const c = step['cond'];
  if (c['cond'] !== 'did' || typeof c['step'] !== 'string' || Object.keys(c).some((k) => k !== 'cond' && k !== 'step' && k !== 'not')) return null;
  for (const unit of [...prefix, ...seq.slice(0, at)]) {
    for (const { step: s } of stepsInOrder(unit.steps)) if (s['as'] === c['step'] && s !== step) return s;
  }
  return null;
}

/**
 * std-tdm (CR 608.2c, 121.1, 614.11): "If you don't draw a card this way, ..." names the draw RIGHT BEFORE it, as "if you don't" does (`previousInstruction`): a draw
 * of one card by you, a conditional one included ("draw a card if you control a creature with a counter on it": a guarded draw, which binds its name as not done
 * when its guard fails, CR 609.3), or an `if` step whose only instruction is that draw (its result is the draw's, effects/handlers/control.ts#ifHandler). So "did
 * not" holds when the condition failed and when the draw drew nothing (a replaced draw is not a draw, CR 614.11). Anything else (a sentence that is not
 * understood, another instruction, a draw nested deeper) leaves the sentence unresolved.
 */
function drawThisWay(seq: readonly Unit[], at: number, top: number, path: string, prefix: readonly Unit[]): Rec | null {
  const parts = path.split('/').filter((x) => x !== '');
  if (parts.some((x, k) => STEP_LISTS.has(x) && /^\d+$/.test(parts[k + 1] ?? ''))) return null;
  let step: Rec | undefined;
  if (top > 0) step = seq[at]!.steps[top - 1];
  else {
    const before = [...prefix, ...seq.slice(0, at)].filter((x) => x.manual !== undefined || x.steps.length > 0);
    const prev = before[before.length - 1];
    if (prev === undefined || prev.manual) return null;
    step = prev.steps[prev.steps.length - 1];
  }
  // a draw with a guard ("draw a card if C", template eff.t26.draw.ifCond) that did not run answers `did` as not done (effects/run.ts#recordSkipped, CR 609.3)
  const oneDraw = (s: unknown): boolean => isRec(s) && s['op'] === 'draw' && s['count'] === 1 && isRec(s['who']) && s['who']['ref'] === 'you';
  if (step === undefined) return null;
  if (oneDraw(step)) return step;
  const then = step['then'];
  return step['op'] === 'if' && step['else'] === undefined && step['guard'] === undefined && Array.isArray(then) && then.length === 1 && oneDraw(then[0]) && (then[0] as Rec)['guard'] === undefined ? step : null;
}

/**
 * std-rx3 (CR 608.2c, 121.1, 614.11): "If you draw one or more cards this way, ..." names the draw RIGHT BEFORE it: a draw by you of any number of cards (a
 * computed one included, "you may draw X cards"), alone or as the only instruction of your `may`. The condition reads the draw itself, not the `may`: you may
 * choose to draw X cards with X = 0 and draw nothing (a draw replaced is not a draw either), and then nothing "this way" happened. Anything else leaves the
 * sentence unresolved.
 */
function drewThisWay(seq: readonly Unit[], at: number, top: number, path: string, prefix: readonly Unit[]): Rec | null {
  const parts = path.split('/').filter((x) => x !== '');
  if (parts.some((x, k) => STEP_LISTS.has(x) && /^\d+$/.test(parts[k + 1] ?? ''))) return null;
  let step: Rec | undefined;
  if (top > 0) step = seq[at]!.steps[top - 1];
  else {
    const before = [...prefix, ...seq.slice(0, at)].filter((x) => x.manual !== undefined || x.steps.length > 0);
    const prev = before[before.length - 1];
    if (prev === undefined || prev.manual) return null;
    step = prev.steps[prev.steps.length - 1];
  }
  const youDraw = (s: unknown): boolean => isRec(s) && s['op'] === 'draw' && isRec(s['who']) && s['who']['ref'] === 'you' && s['guard'] === undefined;
  if (step === undefined) return null;
  if (youDraw(step)) return step;
  const inner = step['do'];
  const mayYou = step['op'] === 'may' && isRec(step['who']) && step['who']['ref'] === 'you' && step['otherwise'] === undefined;
  return mayYou && Array.isArray(inner) && inner.length === 1 && youDraw(inner[0]) ? (inner[0] as Rec) : null;
}

/**
 * std-rx32 (CR 701.3a-b, 603.12): the attach of the sentence right before (its last step, or the step right before in the same sentence) that attaches objects which are
 * all of the description (targets of that filter) to one object; null for anything else.
 */
function attachedThisWay(seq: readonly Unit[], at: number, top: number, prefix: readonly Unit[], which: unknown, targets: readonly { id: string; filter?: unknown }[]): Rec | null {
  let step: Rec | undefined;
  let unit: Unit | undefined;
  if (top > 0) step = seq[at]!.steps[top - 1];
  else {
    const before = [...prefix, ...seq.slice(0, at)].filter((x) => x.manual !== undefined || x.steps.length > 0);
    unit = before[before.length - 1];
    if (unit === undefined || unit.manual) return null;
    step = unit.steps[unit.steps.length - 1];
  }
  if (!isRec(step) || step['op'] !== 'attach' || step['to'] === null || step['guard'] !== undefined || !isRec(step['what'])) return null;
  const what = step['what'];
  // the attached objects are the targets of one spec whose description is the condition's ("target Equipment you control" for "one or more Equipment")
  if (what['ref'] !== 'target' || !isRec(which)) return null;
  const subs = JSON.stringify((which as Rec)['subtypes'] ?? null);
  const spec = targets.find((t) => t.id === what['id']);
  return subs !== 'null' && isRec(spec?.filter) && JSON.stringify((spec!.filter as Rec)['subtypes'] ?? null) === subs ? step : null;
}

/** FAST5 T44: a payment of one of two costs, `pay A else [pay B]` (the second payment has no branches of its own); the second payment, or null. */
export function eitherOrPay(step: Rec | undefined): Rec | null {
  if (step === undefined || step['op'] !== 'pay' || step['then'] !== undefined || step['mandatory'] !== undefined || step['times'] !== undefined) return null;
  const rest = step['else'];
  if (!Array.isArray(rest) || rest.length !== 1 || !isRec(rest[0])) return null;
  const inner = rest[0];
  if (inner['op'] !== 'pay' || inner['then'] !== undefined || inner['else'] !== undefined || inner['as'] !== undefined || inner['mandatory'] !== undefined || inner['times'] !== undefined) return null;
  return JSON.stringify(inner['who']) === JSON.stringify(step['who']) ? inner : null;
}

const isUnit = (x: Rec | Unit): x is Unit => Array.isArray((x as Unit).steps) && typeof (x as Unit).text === 'string' && 'templates' in x;

/**
 * Cloud C7 (CR 608.2c, 608.2h): the kind of instruction a `did` with `which` reads (parser/holes/moved.ts): a move to its `to` (a mill puts cards into a graveyard
 * too), a sacrifice or a discard (`$op`), else a destroy (FAST5X E17).
 * std-rw9 (CR 701.8a, 608.2c, 614.6): a destroy puts what it destroys into its owner's graveyard, so "Destroy target creature. If a creature card is put into a
 * graveyard this way, ..." (Come Back Wrong) names the destroy; it reports where each object went (StepResult.beforeTo), so one a replacement put elsewhere is not counted.
 */
function movedFits(node: Rec): (s: Rec) => boolean {
  const to = node['to'];
  if (typeof to === 'string') return (s) => (s['op'] === 'move' && isRec(s['to']) && s['to']['zone'] === to && s['until'] === undefined) || (to === 'graveyard' && (s['op'] === 'mill' || s['op'] === 'destroy'));
  const ops = node['$op'] === 'sacrifice' ? ['sacrifice', 'sacrificeChoice'] : node['$op'] === 'discard' ? ['discard'] : ['destroy'];
  return (s) => ops.includes(String(s['op']));
}

/**
 * Cloud C7 (CR 608.2c): the ONE earlier instruction of the ability that `fits`, before top-level step `top` of `seq[at]`, as a count of what an instruction moved
 * finds its instruction (lower/quantities.ts): "Exile the top two cards of your library. You may play them this turn. If you exiled a land card this way, ..."
 * names the exile, not the permission right before. Every earlier sentence must be understood (one that is not may hold such an instruction: an E1 shield aside),
 * and there must be exactly one; otherwise null.
 */
function onlyEarlier(seq: readonly Unit[], at: number, top: number, prefix: readonly Unit[], fits: (s: Rec) => boolean): Rec | null {
  const found: Rec[] = [];
  for (const u of [...prefix, ...seq.slice(0, at + 1)]) {
    if (u.manual) {
      if (u !== seq[at] && shieldShape(u.text) === null) return null;
      continue;
    }
    for (const { step, path } of stepsInOrder(u.steps)) {
      if (u === seq[at] && Number(path.split('/')[1]) >= top) break;
      if (fits(step)) found.push(step);
    }
  }
  return found.length === 1 ? found[0]! : null;
}

/**
 * Cloud r3-moved (CR 608.2c): whether NO earlier instruction of the ability fits, every earlier sentence understood (one that is not may hold such an instruction),
 * so that a "this way" of that kind can only mean what the ability's cost moved.
 */
function noEarlierOfKind(seq: readonly Unit[], at: number, top: number, prefix: readonly Unit[], fits: (s: Rec) => boolean): boolean {
  for (const u of [...prefix, ...seq.slice(0, at + 1)]) {
    if (u.manual) {
      if (u !== seq[at] && shieldShape(u.text) === null) return false;
      continue;
    }
    for (const { step, path } of stepsInOrder(u.steps)) {
      if (u === seq[at] && Number(path.split('/')[1]) >= top) break;
      if (fits(step)) return false;
    }
  }
  return true;
}

/** Cloud r3-moved: the participle of the cost mention (lower/ability.ts#costMentionsOf) a `did` of each kind reads. */
const COST_VERB: Readonly<Record<string, string>> = { sacrifice: 'sacrificed', discard: 'discarded', exile: 'exiled' };

/**
 * Cloud r3-moved (CR 602.2b, 601.2b, 601.2h, 608.2c, 608.2h): "if an outlaw was sacrificed this way", "if a land card was discarded this way", "if a creature card was
 * exiled this way" when the ability's own COST is the only thing of that kind it did: whether the ONE object that cost moved (Cloud C8's `costSacrificed` /
 * `costDiscarded` / `costExiled` mention, a cost with one such part of one object other than ~) matches the description, as it last existed (CR 608.2h) or as the
 * card it became in its new zone (CR 400.7j). The cost was paid by the controller (CR 602.2b, 601.2h), so "you sacrificed" reads the same object. A cost of several
 * objects has no such mention ("a creature card was exiled this way" would ask about any of them): null, and the sentence stays manual.
 */
function costMovedCond(d: Draft, node: Rec): Rec | null {
  if (node['not'] === true || node['$cant'] !== undefined || !isRec(node['which'])) return null;
  const kind = typeof node['to'] === 'string' ? (node['to'] === 'exile' ? 'exile' : null) : typeof node['$op'] === 'string' ? String(node['$op']) : null;
  const verb = kind === null ? undefined : COST_VERB[kind];
  if (verb === undefined) return null;
  const found = d.mentions.filter((m) => m.participleOnly === true && m.origin === 'event' && m.unit === -1 && (m.verbs ?? []).includes(verb));
  const m = found[0];
  if (found.length !== 1 || m === undefined || m.number !== 'singular') return null;
  return { cond: 'matches', object: { ...m.ref }, filter: node['which'] };
}

/**
 * Cloud C7 review (CR 608.2c): "if you exiled a land card this way", "if you put an artifact onto the battlefield this way" (`$actor: 'you'`, parser/holes/moved.ts)
 * ask what YOU moved. The controller performs the instructions of the ability (CR 608.2), but not an instruction inside another player's option or payment ("target
 * opponent may put a creature card from their hand onto the battlefield") or inside a loop over players: `step` must be found with no such step around it.
 */
export function performedByYou(seq: readonly Unit[], prefix: readonly Unit[], step: Rec): boolean {
  const you = (who: unknown): boolean => isRec(who) && who['ref'] === 'you' && Object.keys(who).length === 1;
  for (const u of [...prefix, ...seq]) {
    if (u.manual) continue;
    const hit = stepsInOrder(u.steps).find((x) => x.step === step);
    if (hit === undefined) continue;
    const parts = hit.path.split('/').filter((x) => x !== '');
    let list: unknown = u.steps;
    for (let k = 0; k + 2 < parts.length; k += 2) { // every step around it: parts are index, key, index, key, ..., index
      const around = Array.isArray(list) ? (list as unknown[])[Number(parts[k])] : undefined;
      if (!isRec(around)) return false;
      if ((around['op'] === 'may' || around['op'] === 'pay') && !you(around['who'])) return false;
      if (around['op'] === 'forEach') return false;
      list = around[parts[k + 1]!];
    }
    return true;
  }
  return false;
}

function resolveDid(d: Draft, seq: Unit[], at: number, prefix: Unit[]): void {
  const u = seq[at]!;
  let ok = true;
  const only = didOnly(u) !== null; // std-blb: a sentence that is nothing but "If you do, Y." may read the last instruction of an `if` branch (foldDidInIf)
  u.steps = [...u.steps]; // rewritten in place, in order: a name given to an earlier step of the same sentence is kept
  for (let i = 0; i < u.steps.length && ok; i++) {
    u.steps[i] = rewrite(u.steps[i], (node, path) => {
      if (!ok || node['cond'] !== 'did' || node['$step'] === undefined) return undefined;
      // LOOK3 (CR 608.2c): "If you don't put the card onto the battlefield, put it into your hand." (zz-cloud/look3.json) reads the MOVE the instruction right before it
      // ends with, inside its `if` and its `may` (model/focus.ts#notPutMove): not putting the card there is declining that option or never being offered it, which the
      // words settle (unlike a bare "if you don't" after "If C, you may X", T3 above). The move gets an `as` name the condition reads; a missing result is "not
      // performed" (effects/eval.ts#did), so the condition may read a move nested in a branch (model/lint-flow.ts). Anything else is unresolved. (Cloud std-fin read the
      // same words in its Cond hole with the same condition and a narrower search of the move, through one `may`, of a bound card only: merged into this one reading.)
      if (node['not'] === true && node['which'] === undefined && node['$cant'] === undefined && (node['to'] === 'battlefield' || node['to'] === 'hand')) {
        const prev = previousInstruction(seq, at, i, path, prefix, true, true);
        if (prev !== null && isUnit(prev)) {
          // the sentence before it is not understood: as for "if you do", it is still the antecedent, and taint T1 poisons this sentence alone
          const name = freshName(d, 'did');
          prev.lostNames = [...(prev.lostNames ?? []), name];
          return { cond: 'did', step: name, not: true, to: node['to'] };
        }
        const mv = notPutMove(prev, node['to']);
        if (mv === null) { ok = false; return undefined; }
        if (typeof mv['as'] !== 'string') mv['as'] = freshName(d, 'moved');
        return { cond: 'did', step: mv['as'], not: true, to: node['to'] };
      }
      // std-rj (CR 608.2c, 601.2; Solstice Revelations): "if you don't cast that card this way" names the cast right before it, or the one inside the `if` (no `else`, no
      // guard) that is the instruction right before it ("You may cast that card without paying its mana cost if C."): a cast that never ran (the condition false, or the
      // option declined) has no result, so the cast was not done; anything else is unresolved
      if (node['$cast'] === true) {
        const raw = previousInstruction(seq, at, i, path, prefix, true, true);
        const castStep = raw === null || isUnit(raw) ? null : castOfStep(raw);
        if (castStep === null) { ok = false; return undefined; }
        if (typeof castStep['as'] !== 'string') castStep['as'] = freshName(d, 'cast');
        return { cond: 'did', step: castStep['as'], not: true };
      }
      // std-tdm: "if you don't draw a card this way" names the draw right before it, a conditional one included (drawThisWay)
      if (node['$step'] === 'drawThisWay') {
        const dw = drawThisWay(seq, at, i, path, prefix);
        if (dw === null) { ok = false; return undefined; }
        if (typeof dw['as'] !== 'string') dw['as'] = freshName(d, 'drew');
        return { cond: 'did', step: dw['as'], not: true };
      }
      // std-rx31 (CR 608.2c, 601.2): "Put the exiled card into your hand if it wasn't cast this way" names the ONE optional cast by you earlier in the ability, inside an
      // `if` too ("If this spell was bargained, you may cast the exiled card ..."): a cast that never ran (its condition false) or was declined cast nothing (eval.ts#did)
      if (node['$step'] === 'castThisWay') {
        const cs = node['not'] === true ? onlyEarlier(seq, at, i, prefix, (x) => x['op'] === 'cast' && x['optional'] === true && isRec(x['who']) && x['who']['ref'] === 'you' && x['copyIn'] === undefined) : null;
        if (cs === null) { ok = false; return undefined; }
        if (typeof cs['as'] !== 'string') cs['as'] = freshName(d, 'did');
        return { cond: 'did', step: cs['as'], not: true };
      }
      // std-rx3: "if you draw one or more cards this way" names the draw right before it, inside your `may` too (drewThisWay)
      // std-rx32 (CR 701.3a-b): "when one or more Equipment become attached to that creature this way" names the attach right before it (attachedThisWay)
      if (node['$step'] === 'attachedThisWay') {
        const at2 = attachedThisWay(seq, at, i, prefix, node['$which'], d.targets);
        if (at2 === null) { ok = false; return undefined; }
        if (typeof at2['as'] !== 'string') at2['as'] = freshName(d, 'attached');
        return { cond: 'did', step: at2['as'] };
      }
      if (node['$step'] === 'drewThisWay') {
        const dw = drewThisWay(seq, at, i, path, prefix);
        if (dw === null) { ok = false; return undefined; }
        if (typeof dw['as'] !== 'string') dw['as'] = freshName(d, 'drew');
        return { cond: 'did', step: dw['as'] };
      }
      // r4-fxb (CR 608.2c): "If you do, X. If you don't, Y.": "you don't" reads the same instruction as the "If you do" sentence right before it (an `if` on that
      // instruction's result with no `else` or guard), so Y happens exactly when X does not
      if (node['not'] === true && node['which'] === undefined && node['to'] === undefined && node['$cant'] === undefined && node['$actor'] === undefined) {
        const r = previousInstruction(seq, at, i, path, prefix, true, true);
        const c = r !== null && !isUnit(r) && r['op'] === 'if' && r['else'] === undefined && r['guard'] === undefined && isRec(r['cond']) ? r['cond'] : null;
        if (c !== null && c['cond'] === 'did' && typeof c['step'] === 'string' && Object.keys(c).length === 2) return { cond: 'did', step: c['step'], not: true };
      }
      let p = previousInstruction(seq, at, i, path, prefix, node['not'] === true, false, only);
      if (p === null && node['which'] !== undefined) p = onlyEarlier(seq, at, i, prefix, movedFits(node)); // Cloud C7
      if (p === null) { ok = false; return undefined; }
      // FAST5 T44: "you do" after a payment of one of two costs is folded into both payments (foldPay): only as a sentence of its own, and never "you don't";
      // std-rw8 (CR 603.12, 118.12): or as the "When you do" of a reflexive trigger, the whole sentence ("You may sacrifice an artifact or discard a nonland card. When
      // you do, ~ deals 2 damage to any target."), which waits for either payment (effects/handlers/pay.ts: the result of such a payment is either payment's)
      const reflexiveWhen = path === '/when' && u.steps.length === 1 && u.steps[i]?.['op'] === 'reflexive' && node['which'] === undefined && node['to'] === undefined;
      if (!isUnit(p) && eitherOrPay(p) !== null && (node['not'] === true || (didOnly(u) === null && !reflexiveWhen))) { ok = false; return undefined; }
      // FAST5X E17 (CR 608.2c, 608.2h): "if a creature you controlled was destroyed this way" reads what a destroy step reports (StepResult.before), so the
      // instruction right before it must be that destroy step (understood); anything else is unresolved
      const which = isRec(node['which']) ? { which: node['which'] } : {};
      // FAST5 T75 (CR 608.2c): "if you put a Town card into your hand this way" reads what a move to the hand reports (the cond holds `to: 'hand'`)
      // Cloud C7 (CR 608.2c, 608.2h): every destination of a move the same way ("if a creature card was exiled this way", "if you put an artifact onto the
      // battlefield this way"), and the other actions that report what they moved, a sacrifice or a discard (the hole's `$op`; none is a destroy, E17)
      const moveTo = typeof node['to'] === 'string' ? node['to'] : null;
      const toHand = moveTo !== null;
      // Cloud C7 (CR 608.2c): "You may put a creature card from your hand onto the battlefield. If you put an artifact onto the battlefield this way, ...": the move is
      // the last instruction of the option right before (no "otherwise"); a move that never ran (the option declined) has no result, so nothing was put there
      if (toHand && node['which'] !== undefined && !isUnit(p) && p['op'] === 'may' && p['otherwise'] === undefined && Array.isArray(p['do'])) {
        const inner = (p['do'] as Rec[])[(p['do'] as Rec[]).length - 1];
        if (isRec(inner) && inner['op'] === 'move' && isRec(inner['to']) && inner['to']['zone'] === moveTo && inner['until'] === undefined) p = inner;
      }
      // Cloud C7 (CR 608.2c): "If you exiled a land card this way" after "You may play them this turn": the one earlier instruction of the kind the words name
      // (Cloud std-eoe's "If you didn't put a card into your hand this way" after "Put the rest on the bottom ...", Pulsar Squadron Ace, is read here too: its own
      // handMoveBeforeRest found the same move to the hand and was collapsed into this one reading at the wave 3 merge)
      if (node['which'] !== undefined && (isUnit(p) || !movedFits(node)(p))) p = onlyEarlier(seq, at, i, prefix, movedFits(node)) ?? p;
      if (node['which'] !== undefined && (isUnit(p) || !movedFits(node)(p))) {
        // Cloud r3-moved (CR 602.2b, 601.2h, 608.2c, 608.2h): no instruction of the ability is of that kind, but its cost is: "{1}{B}, Sacrifice another creature: Put a
        // +1/+1 counter on ~. If an outlaw was sacrificed this way, ..." asks what the cost sacrificed (Cloud C8's cost references)
        const cost = noEarlierOfKind(seq, at, i, prefix, movedFits(node)) ? costMovedCond(d, node) : null;
        if (cost !== null) return cost;
        ok = false;
        return undefined;
      }
      // Cloud C7 review (CR 608.2c): "if you exiled ... this way", "if you put ... onto the battlefield this way": a move YOU performed
      if (node['$actor'] === 'you' && (isUnit(p) || !performedByYou(seq, prefix, p))) { ok = false; return undefined; }
      // r4-moved (CR 701.23a, 608.2c): "If you search your library this way, ..." names a search of your own library right before it: the option whose first
      // instruction it is (taken: you searched), or the search itself; anything else is unresolved
      // r5-moved (CR 701.23a, 603.12, 608.2c): ... or, when the instruction right before is another one ("Search your library for a basic land card, put it onto the
      // battlefield tapped, then shuffle. When you search your library this way, ..."), the ONE earlier search of your library by you in the ability, every earlier sentence
      // understood (a search is performed when the library was searched, whatever it found: effects/handlers/cards-library.ts)
      if (node['$searched'] === true && (isUnit(p) || !searchOfYourLibrary(p))) p = onlyEarlier(seq, at, i, prefix, (x) => x['op'] === 'search' && searchOfYourLibrary(x)) ?? p;
      if (node['$searched'] === true && (isUnit(p) || !searchOfYourLibrary(p))) { ok = false; return undefined; }
      if (toHand && node['which'] === undefined) { ok = false; return undefined; }
      // STD-OTJ (CR 608.2d): "if you can't" says the instruction right before it was impossible, so that instruction is a move (understood) that is not optional
      // CMD5 (CR 701.21a, 608.2d): or a sacrifice of a permanent of the player's choice ("Sacrifice another creature. If you can't, ..."): it sacrificed nothing
      // only when the player controlled no permanent of the description that could be sacrificed (effects/handlers/zones-remove.ts#sacrificeChoice)
      // std-typechange-2 (CR 608.2c, 708.7, 701.40g, 701.58g): or a turn face up of the ONE object the ability's source is ("Turn this creature face up. If you can't, ..."):
      // it didn't happen when that permanent is not face down, is an instant or sorcery card that can't be turned face up, or can't be turned face up (effects/handlers/face-ops.ts)
      const faceUpSelf = !isUnit(p) && p['op'] === 'changeFace' && p['to'] === 'faceUp' && p['manifest'] === undefined && isRec(p['what']) && p['what']['ref'] === 'self' && p['guard'] === undefined;
      // TREK-6 (CR 608.2d; assimilate, Star Trek reminder text): or an assimilate of a card chosen among those a linked instruction exiled ("Assimilate a creature card exiled
      // with it. If you can't, ..."): it put no card onto the battlefield when there was none to choose (the macro's moves report nothing, keywords/actions/assimilate.ts)
      const assimilates = !isUnit(p) && p['op'] === 'action' && p['action'] === 'assimilate' && p['guard'] === undefined;
      if (node['$cant'] === true && (isUnit(p) || (p['op'] !== 'move' && !(p['op'] === 'sacrificeChoice' && p['mode'] === undefined) && !faceUpSelf && !assimilates))) { ok = false; return undefined; }
      const how = moveTo !== null ? { to: moveTo } : {};
      if (isUnit(p)) {
        // the name the manual sentence would have produced: taint T1 poisons every step that reads it (parser/taint.ts, model/taint.ts#poisonedSteps)
        const name = freshName(d, 'did');
        p.lostNames = [...(p.lostNames ?? []), name];
        return { cond: 'did', step: name, ...(node['not'] === true ? { not: true } : {}), ...which, ...how };
      }
      if (typeof p['as'] !== 'string') p['as'] = freshName(d, p['op'] === 'pay' ? 'paid' : 'did');
      return { cond: 'did', step: p['as'], ...(node['not'] === true ? { not: true } : {}), ...which, ...how };
    }) as Rec;
  }
  if (!ok) setManual(u, { code: 'unbound-reference', reason: '"if you do" with no understood instruction right before it to refer to (CR 118.12, 608.2c)', unresolved: true });
}

/** std-rj: a `cast` step, or the `cast` that is the only instruction of an `if` with no `else` and no guard (lower/conditions.ts#resolveDid, `$cast`); else null. */
function castOfStep(p: Rec): Rec | null {
  if (p['op'] === 'cast') return p;
  const then = p['then'];
  if (p['op'] === 'if' && p['else'] === undefined && p['guard'] === undefined && Array.isArray(then) && then.length === 1 && isRec(then[0]) && then[0]['op'] === 'cast') return then[0];
  return null;
}

/** r4-moved: a search of your library by you (CR 701.23a), or an option of yours whose first instruction is one (lower/conditions.ts#resolveDid, `$searched`). */
function searchOfYourLibrary(p: Rec): boolean {
  const you = (w: unknown): boolean => isRec(w) && w['ref'] === 'you';
  const search = (x: unknown): boolean => isRec(x) && x['op'] === 'search' && you(x['who']) && x['zone'] === 'library' && x['owner'] === undefined && x['alsoZones'] === undefined;
  if (search(p)) return true;
  return p['op'] === 'may' && you(p['who']) && p['otherwise'] === undefined && Array.isArray(p['do']) && search((p['do'] as unknown[])[0]);
}

/** FAST5X E16: the ops whose result has an amount of excess damage (effects/handlers/lifedamage.ts records `StepResult.excess`, CR 120.4a). */
const EXCESS_OPS: ReadonlySet<string> = new Set(['damage', 'fight']);

const isExcess = (n: unknown): n is Rec => isRec(n) && n['q'] === 'excessDamage';

/**
 * FAST5X E16 (CR 120.4a, 120.10, 608.2c): "the excess damage dealt this way", "if excess damage was dealt [to that creature] this way" (`{q:'excessDamage', step:'',
 * $step}` from the Qty and Cond holes, parser/holes/excess.ts) name the damage or fight instruction RIGHT BEFORE the sentence's instruction, as "if you do"
 * does (`previousInstruction`): it gets an `as` name and the quantity names it. Inside a nested step list only under an `if` whose condition is itself an
 * excess condition (the same "this way": "If excess damage was dealt this way, amass Goblins X, where X is that excess damage"); "that excess damage" takes
 * the condition's `to`. Anything else (no damage or fight right before, a nested damage step) leaves the sentence manual and unresolved; a manual sentence
 * right before is the antecedent and poisons the reader (taint T1), as for "if you do".
 */
function resolveExcess(d: Draft, seq: Unit[], at: number, prefix: Unit[]): void {
  const u = seq[at]!;
  let ok = true;
  let into: Rec[] | null = null;
  u.steps = [...u.steps];
  for (let i = 0; i < u.steps.length && ok; i++) {
    const top = u.steps[i]!;
    const cond = top['op'] === 'if' && isRec(top['cond']) && top['cond']['cond'] === 'compare' && isExcess(top['cond']['left']) ? top['cond']['left'] : undefined;
    let name: string | undefined;
    u.steps[i] = rewrite(top, (node, path) => {
      if (!ok || !isExcess(node) || node['$step'] === undefined) return undefined;
      const parts = path.split('/').filter((x) => x !== '');
      const nested = parts.some((x, k) => STEP_LISTS.has(x) && /^\d+$/.test(parts[k + 1] ?? ''));
      if (nested && cond === undefined) { ok = false; return undefined; }
      if (name === undefined) {
        let p = previousInstruction(seq, at, i, '', prefix);
        // std-rw8 (CR 603.12, 120.4a, 608.2c): "When you do, ~ deals damage ... to another target creature. If excess damage was dealt this way, amass Goblins X, where X is
        // that excess damage.": the damage is the last instruction of the reflexive trigger right before, so the sentence is an instruction of that trigger too (it
        // follows the damage it reads, as the trigger resolves) and moves into its `do`. Only a sentence that is nothing but that excess "if" and announces no target
        const raw = p === null ? previousInstruction(seq, at, i, '', prefix, false, true) : null;
        const inner = raw !== null && !isUnit(raw) && raw['op'] === 'reflexive' && Array.isArray(raw['do']) ? (raw['do'] as Rec[]) : null;
        const last = inner?.[inner.length - 1];
        if (inner !== null && isRec(last) && EXCESS_OPS.has(String(last['op'])) && i === 0 && cond !== undefined && u.steps.length === 1 && (u.targetIds?.length ?? 0) === 0 && u.rider === undefined) {
          p = last;
          into = inner;
        }
        if (p === null || (!isUnit(p) && !EXCESS_OPS.has(String(p['op'])))) { ok = false; return undefined; }
        if (isUnit(p)) {
          name = freshName(d, 'dealt');
          p.lostNames = [...(p.lostNames ?? []), name];
        } else {
          if (typeof p['as'] !== 'string') p['as'] = freshName(d, 'dealt');
          name = p['as'] as string;
        }
      }
      const to = node['$that'] === true ? cond?.['to'] : node['to'];
      return { q: 'excessDamage', step: name, ...(to !== undefined ? { to } : {}) };
    }) as Rec;
  }
  if (!ok) setManual(u, { code: 'unbound-reference', reason: '"this way" with no damage or fight instruction right before it to refer to (CR 120.4a, 608.2c)', unresolved: true });
  else {
    const moveInto = into as Rec[] | null; // set inside the rewrite callback above
    if (moveInto !== null) {
      moveInto.push(...u.steps);
      u.steps = [];
    }
  }
}

/** M12-3: the ops whose result has the life lost (effects/handlers/lifedamage.ts records `StepResult.lifeLost`, CR 119.3). */
const LIFE_LOST_OPS: ReadonlySet<string> = new Set(['loseLife']);

const isLifeLost = (n: unknown): n is Rec => isRec(n) && n['q'] === 'lifeLost';

/**
 * Cloud std-spm (CR 119.3, 701.12c): an instruction whose result has the life lost: a loseLife, an exchange of life totals (effects/handlers/zones-status.ts),
 * or a `may` without an "otherwise" whose optional action has one of those among its own steps (effects/handlers/control.ts keeps what they lost).
 */
function losesLife(p: Rec): boolean {
  const own = (s: unknown): boolean => isRec(s) && (LIFE_LOST_OPS.has(String(s['op'])) || (s['op'] === 'exchange' && s['what'] === 'life'));
  if (own(p)) return true;
  return p['op'] === 'may' && p['otherwise'] === undefined && Array.isArray(p['do']) && (p['do'] as unknown[]).some(own);
}

/**
 * M12-3 (CR 119.3, 608.2c): "the life lost this way" (`{q:'lifeLost', step:'', $step}` from the Qty hole) names the loseLife instruction RIGHT BEFORE the
 * sentence's instruction, as "if you do" and excess damage do (`previousInstruction`): it gets an `as` name and the quantity names it ("Each opponent loses
 * X life. You gain life equal to the life lost this way."; "each opponent loses 3 life, then you gain life equal to the life lost this way"). Anything else
 * (no loseLife right before, the quantity inside a nested step list) leaves the sentence manual and unresolved; a manual sentence right before is the
 * antecedent and poisons the reader (taint T1).
 */
function resolveLifeLost(d: Draft, seq: Unit[], at: number, prefix: Unit[]): void {
  const u = seq[at]!;
  let ok = true;
  u.steps = [...u.steps];
  for (let i = 0; i < u.steps.length && ok; i++) {
    const top = u.steps[i]!;
    // cloud std-spm (CR 608.2c): "If you lost life this way, draw that many cards": under an `if` whose condition is a life-lost condition, the same marker in its
    // steps ("that many", lower/quantities.ts copies the condition's amount) names the same instruction; any other nested marker is not resolved here
    const cond = top['op'] === 'if' && isRec(top['cond']) && top['cond']['cond'] === 'compare' && isLifeLost(top['cond']['left']) ? JSON.stringify(top['cond']['left']) : undefined;
    let name: string | undefined;
    u.steps[i] = rewrite(top, (node, path) => {
      if (!ok || !isLifeLost(node) || node['$step'] === undefined) return undefined;
      const parts = path.split('/').filter((x) => x !== '');
      if (parts.some((x, k) => STEP_LISTS.has(x) && /^\d+$/.test(parts[k + 1] ?? '')) && JSON.stringify(node) !== cond) { ok = false; return undefined; }
      if (name === undefined) {
        const p = previousInstruction(seq, at, i, '', prefix);
        if (p === null || (!isUnit(p) && !losesLife(p))) { ok = false; return undefined; }
        if (isUnit(p)) {
          name = freshName(d, 'lost');
          p.lostNames = [...(p.lostNames ?? []), name];
        } else {
          if (typeof p['as'] !== 'string') p['as'] = freshName(d, 'lost');
          name = p['as'] as string;
        }
      }
      return { q: 'lifeLost', step: name, ...(node['who'] !== undefined ? { who: node['who'] } : {}) }; // cloud std-spm: `who`, "if you lost life this way"
    }) as Rec;
  }
  if (!ok) setManual(u, { code: 'unbound-reference', reason: '"the life lost this way" with no life-loss instruction right before it to refer to (CR 119.3, 608.2c)', unresolved: true });
}

const isDamageDealt = (n: unknown): n is Rec => isRec(n) && n['q'] === 'damageDealt';

/**
 * std-rx20 (CR 120.3, 608.2c): "the damage dealt this way" (`{q:'damageDealt', step:'', $step}` from the Qty hole) names the damage instruction RIGHT BEFORE the
 * sentence's instruction (`previousInstruction`), as the life lost this way does: "~ deals damage to any target equal to the number of Swamps you control. You gain
 * life equal to the damage dealt this way."; "~ deals 4 damage to target creature and you gain life equal to the damage dealt this way". Only a top-level `damage`
 * step of its fixed sources (not `perSource`: each of a group dealing its own damage reports no total); anything else (no damage right before, the quantity
 * inside a nested step list, a manual sentence right before) leaves the sentence manual and unresolved.
 */
function resolveDamageDealt(d: Draft, seq: Unit[], at: number, prefix: Unit[]): void {
  const u = seq[at]!;
  let ok = true;
  u.steps = [...u.steps];
  for (let i = 0; i < u.steps.length && ok; i++) {
    const top = u.steps[i]!;
    let name: string | undefined;
    u.steps[i] = rewrite(top, (node, path) => {
      if (!ok || !isDamageDealt(node) || node['$step'] === undefined) return undefined;
      const parts = path.split('/').filter((x) => x !== '');
      if (parts.some((x, k) => STEP_LISTS.has(x) && /^\d+$/.test(parts[k + 1] ?? ''))) { ok = false; return undefined; }
      if (name === undefined) {
        const p = previousInstruction(seq, at, i, '', prefix);
        if (p === null || isUnit(p) || p['op'] !== 'damage' || p['perSource'] === true) { ok = false; return undefined; }
        if (typeof p['as'] !== 'string') p['as'] = freshName(d, 'dealt');
        name = p['as'] as string;
      }
      return { q: 'damageDealt', step: name };
    }) as Rec;
  }
  if (!ok) setManual(u, { code: 'unbound-reference', reason: '"the damage dealt this way" with no damage instruction right before it to refer to (CR 120.3, 608.2c)', unresolved: true });
}

const isCountersRemoved = (n: unknown): n is Rec => isRec(n) && n['q'] === 'countersRemoved';

/** std-rx14: a removeCounters instruction, or a "you may" whose optional action is one (or holds one). */
function removesCounters(p: Rec): boolean {
  const own = (s: unknown): boolean => isRec(s) && s['op'] === 'removeCounters';
  if (own(p)) return true;
  return p['op'] === 'may' && p['otherwise'] === undefined && Array.isArray(p['do']) && (p['do'] as unknown[]).some(own);
}

/**
 * std-rx14 (CR 122.1, 608.2c): "for each lore counter removed this way" (`{q:'countersRemoved', step:'', $step}` from the Qty hole) names the removeCounters
 * instruction RIGHT BEFORE the sentence's instruction (or the "you may" holding it), as "the life lost this way" does (resolveLifeLost): it gets an `as` name and
 * the quantity names it. Anything else (no such instruction right before, the quantity inside a nested step list) leaves the sentence manual and unresolved; a
 * manual sentence right before is the antecedent and poisons the reader (taint T1).
 */
function resolveCountersRemoved(d: Draft, seq: Unit[], at: number, prefix: Unit[]): void {
  const u = seq[at]!;
  let ok = true;
  u.steps = [...u.steps];
  for (let i = 0; i < u.steps.length && ok; i++) {
    let name: string | undefined;
    u.steps[i] = rewrite(u.steps[i]!, (node, path) => {
      if (!ok || !isCountersRemoved(node) || node['$step'] === undefined) return undefined;
      const parts = path.split('/').filter((x) => x !== '');
      if (parts.some((x, k) => STEP_LISTS.has(x) && /^\d+$/.test(parts[k + 1] ?? ''))) { ok = false; return undefined; }
      if (name === undefined) {
        const p = previousInstruction(seq, at, i, '', prefix);
        // p2-mana-1 (CR 107.1c, 602.2b): no instruction removing counters right before it: the counters the ability's own cost removed, when that number is the ability's X ("{T}, Remove any
        // number of storage counters from ~: Add {B} for each storage counter removed this way"; lower/ability.ts#counterCostMentions)
        if (p === null || (!isUnit(p) && !removesCounters(p))) {
          const cost = d.mentions.find((m) => m.sort === 'number' && (m.verbs ?? []).some((v) => v === `cost:removed:${String(node['kind'])}` || (node['kind'] === undefined && v.startsWith('cost:removed:'))));
          if (cost !== undefined) return clone(cost.ref);
        }
        if (p === null || (!isUnit(p) && !removesCounters(p))) { ok = false; return undefined; }
        if (isUnit(p)) {
          name = freshName(d, 'removed');
          p.lostNames = [...(p.lostNames ?? []), name];
        } else {
          if (typeof p['as'] !== 'string') p['as'] = freshName(d, 'removed');
          name = p['as'] as string;
        }
      }
      return { q: 'countersRemoved', step: name, ...(node['kind'] !== undefined ? { kind: node['kind'] } : {}) };
    }) as Rec;
  }
  if (!ok) setManual(u, { code: 'unbound-reference', reason: '"the counters removed this way" with no instruction removing counters right before it to refer to (CR 122.1, 608.2c)', unresolved: true });
}

const isCountersPut = (n: unknown): n is Rec => isRec(n) && n['q'] === 'countersPut';

/** trek-6: a putCounters instruction, or a "you may" whose optional action is one (or holds one). */
function putsCounters(p: Rec): boolean {
  const own = (s: unknown): boolean => isRec(s) && s['op'] === 'putCounters';
  if (own(p)) return true;
  return p['op'] === 'may' && p['otherwise'] === undefined && Array.isArray(p['do']) && (p['do'] as unknown[]).some(own);
}

/**
 * trek-6 (CR 122.1, 122.6, 608.2c): "if you put two or more +1/+1 counters on creatures this way" (`{q:'countersPut', step:'', $step}` from the Cond hole,
 * parser/holes/cond.ts#countersPutThisWay) names the putCounters instruction RIGHT BEFORE the sentence's instruction (or the "you may" holding it), as "the counters
 * removed this way" does (resolveCountersRemoved): it gets an `as` name and the quantity names it. A kind the words name must be the kind the instruction puts. Anything
 * else (no such instruction right before, the quantity inside a nested step list) leaves the sentence manual and unresolved; a manual sentence right before is the
 * antecedent and poisons the reader (taint T1).
 */
function resolveCountersPut(d: Draft, seq: Unit[], at: number, prefix: Unit[]): void {
  const u = seq[at]!;
  let ok = true;
  u.steps = [...u.steps];
  for (let i = 0; i < u.steps.length && ok; i++) {
    let name: string | undefined;
    u.steps[i] = rewrite(u.steps[i]!, (node, path) => {
      if (!ok || !isCountersPut(node) || node['$step'] === undefined) return undefined;
      const parts = path.split('/').filter((x) => x !== '');
      if (parts.some((x, k) => STEP_LISTS.has(x) && /^\d+$/.test(parts[k + 1] ?? ''))) { ok = false; return undefined; }
      if (name === undefined) {
        const p = previousInstruction(seq, at, i, '', prefix);
        if (p === null || (!isUnit(p) && !putsCounters(p))) { ok = false; return undefined; }
        if (isUnit(p)) {
          name = freshName(d, 'put');
          p.lostNames = [...(p.lostNames ?? []), name];
        } else {
          const put = p['op'] === 'putCounters' ? p : ((p['do'] as Rec[]).find((s) => isRec(s) && s['op'] === 'putCounters') as Rec);
          if (node['kind'] !== undefined && put['kind'] !== node['kind']) { ok = false; return undefined; }
          if (typeof p['as'] !== 'string') p['as'] = freshName(d, 'put');
          name = p['as'] as string;
        }
      }
      return { q: 'countersPut', step: name, ...(node['kind'] !== undefined ? { kind: node['kind'] } : {}) };
    }) as Rec;
  }
  if (!ok) setManual(u, { code: 'unbound-reference', reason: '"the counters put this way" with no instruction putting counters right before it to refer to (CR 122.6, 608.2c)', unresolved: true });
}

const isMayCount = (n: unknown): n is Rec => isRec(n) && n['q'] === 'resultCount' && n['$step'] === 'previous' && n['$who'] === 'each';

/**
 * pc-tokens-1 (CR 608.2c, 608.2d, 101.4): "For each opponent who does, ..." (`{q:'resultCount', step:'', $step:'previous', $who:'each'}`, template
 * eff.pctokens1.forEachWhoDoes) counts the players who did the optional action of the "each opponent may ..." right before it: the `may` step of a group of players
 * (`who` is `each`) gets an `as` name and the quantity names it (the `may` handler's result count is the number of players who did it). Anything else right before
 * (no such `may`, one with an `otherwise`, the quantity inside a nested step list) leaves the sentence manual (not contagious: it was manual before this reading);
 * a manual sentence right before is the antecedent and poisons the reader (taint T1).
 */
function resolveMayCount(d: Draft, seq: Unit[], at: number, prefix: Unit[]): void {
  const u = seq[at]!;
  let ok = true;
  u.steps = [...u.steps];
  for (let i = 0; i < u.steps.length && ok; i++) {
    let name: string | undefined;
    u.steps[i] = rewrite(u.steps[i]!, (node, path) => {
      if (!ok || !isMayCount(node)) return undefined;
      const parts = path.split('/').filter((x) => x !== '');
      if (parts.some((x, k) => STEP_LISTS.has(x) && /^\d+$/.test(parts[k + 1] ?? ''))) { ok = false; return undefined; }
      if (name === undefined) {
        const p = previousInstruction(seq, at, i, '', prefix);
        if (p !== null && isUnit(p)) {
          // a sentence of this sequence right before it that is not understood is the antecedent: the reader is manual with it (taint T1), not contagious
          name = freshName(d, 'did');
          p.lostNames = [...(p.lostNames ?? []), name];
        } else {
          if (p === null || p['op'] !== 'may' || p['otherwise'] !== undefined || p['anyOne'] === true || p['guard'] !== undefined || !isRec(p['who']) || p['who']['ref'] !== 'each') { ok = false; return undefined; }
          if (typeof p['as'] !== 'string') p['as'] = freshName(d, 'did');
          name = p['as'] as string;
        }
      }
      return { q: 'resultCount', step: name };
    }) as Rec;
  }
  // not contagious (no `unresolved`): the sentence alone is manual, as it was when no template read it, so no other instruction of the ability is lost (guard G10)
  if (!ok) setManual(u, { code: 'unbound-reference', reason: '"for each opponent who does" with no "each opponent may ..." right before it to refer to (CR 608.2c, 608.2d)' });
}

/**
 * M12-3 (CR 701.38a-b): the vote markers of the Cond, Qty and Objs holes (parser/holes/vote.ts) name the vote BEFORE them in the ability: a top-level vote
 * step earlier in the same sentence or in an earlier sentence of the sequence ("Starting with you, each player votes for carnage or homage. If carnage gets
 * more votes, ... If homage gets more votes or the vote is tied, ..."): it gets an `as` name and the markers name it.
 *   - "<word> gets more votes [or the vote is tied]": the vote is for exactly two words and <word> is one of them; the other side of the comparison is the
 *     other word (more votes than it; at least as many, "or the vote is tied").
 *   - "the number of <word> votes": <word> is one of the vote's words.
 *   - "each permanent with the most votes or tied for most votes": the vote is for objects; the bound objects are the winners.
 * Anything else (no vote before, another kind of vote, a sentence that is not understood between them that mentions a vote) leaves the sentence manual.
 */
const isVoteMarker = (n: unknown): n is Rec => isRec(n) && n['$vote'] !== undefined;
const isVoteStep = (s: Rec | undefined): s is Rec => s !== undefined && s['op'] === 'action' && s['action'] === 'vote';

function voteBefore(seq: readonly Unit[], at: number, top: number, prefix: readonly Unit[]): Rec | null {
  const u = seq[at]!;
  for (let k = top - 1; k >= 0; k--) if (isVoteStep(u.steps[k])) return u.steps[k]!;
  const before = [...prefix, ...seq.slice(0, at)];
  for (let i = before.length - 1; i >= 0; i--) {
    const x = before[i]!;
    if (x.manual) {
      if (/\bvot(e|es|ed|ing)\b/i.test(x.text)) return null; // a vote that is not understood may be the one meant
      continue;
    }
    for (let k = x.steps.length - 1; k >= 0; k--) if (isVoteStep(x.steps[k])) return x.steps[k]!;
  }
  return null;
}

function resolveVotes(d: Draft, seq: Unit[], at: number, prefix: Unit[]): void {
  const u = seq[at]!;
  let ok = true;
  u.steps = [...u.steps];
  for (let i = 0; i < u.steps.length && ok; i++) {
    u.steps[i] = rewrite(u.steps[i]!, (node) => {
      if (!ok) return undefined;
      const compare = node['cond'] === 'compare' && isVoteMarker(node['left']) ? node : undefined;
      if (compare === undefined && !isVoteMarker(node)) return undefined;
      const vote = voteBefore(seq, at, i, prefix);
      if (vote === null) { ok = false; return undefined; }
      const choices = Array.isArray(vote['choices']) ? (vote['choices'] as unknown[]).map(String) : null;
      const name = (): string => {
        if (typeof vote['as'] !== 'string') vote['as'] = freshName(d, 'vote');
        return vote['as'] as string;
      };
      if (compare !== undefined) {
        const left = compare['left'] as Rec;
        const right = compare['right'];
        const choice = String(left['choice']);
        if (choices === null || choices.length !== 2 || !choices.includes(choice) || !isVoteMarker(right) || right['$other'] !== true) { ok = false; return undefined; }
        const other = choices.find((c) => c !== choice)!;
        const step = name();
        return { cond: 'compare', left: { q: 'votes', step, choice }, op: compare['op'], right: { q: 'votes', step, choice: other } };
      }
      if (node['q'] === 'votes') {
        const choice = String(node['choice']);
        if (choices === null || !choices.includes(choice) || node['$other'] !== undefined) { ok = false; return undefined; }
        return { q: 'votes', step: name(), choice };
      }
      if (node['ref'] === 'bound') {
        const subject = vote['subject'];
        if (choices !== null || !isRec(subject) || subject['ref'] !== 'each' || subject['filter'] === undefined) { ok = false; return undefined; }
        return { ref: 'bound', name: name() };
      }
      ok = false;
      return undefined;
    }) as Rec;
  }
  if (!ok) setManual(u, { code: 'unbound-reference', reason: 'a vote result ("gets more votes", "with the most votes") with no vote of that kind before it to refer to (CR 701.38a-b)', unresolved: true });
}

/** Is `name` read anywhere in the draft (a `did`, a bound reference, a result count, an excess amount)? */
function nameUsed(d: Draft, name: string): boolean {
  let used = false;
  for (const u of sequences(d).flat()) visit(u.steps, (n) => {
    if ((n['cond'] === 'did' && n['step'] === name) || (n['ref'] === 'bound' && n['name'] === name) || ((n['q'] === 'resultCount' || n['q'] === 'excessDamage' || n['q'] === 'lifeLost' || n['q'] === 'countersRemoved' || n['q'] === 'countersPut' || n['q'] === 'votes' || n['q'] === 'damageDealt') && n['step'] === name)) used = true;
  });
  return used;
}

/** CR 118.12: fold "If [they do / don't], X." into the pay step it follows. */
function foldPay(d: Draft, seq: Unit[]): void {
  seq.forEach((u, i) => {
    if (u.manual || u.steps.length !== 1 || i === 0) return;
    const s = u.steps[0]!;
    const cond = s['cond'];
    if (s['op'] !== 'if' || !isRec(cond) || cond['cond'] !== 'did' || cond['which'] !== undefined || s['else'] !== undefined || s['guard'] !== undefined) return;
    const prev = seq.slice(0, i).reverse().find((p) => p.manual !== undefined || p.steps.length > 0);
    if (!prev || prev.manual) return;
    const pay = prev.steps[prev.steps.length - 1]!;
    if (pay['op'] !== 'pay' || pay['as'] !== cond['step']) return;
    const side = cond['not'] === true ? 'else' : 'then';
    const second = eitherOrPay(pay);
    if (second !== null) {
      // FAST5 T44: "you do" is either payment; the same instructions follow whichever was made (a negated reading was refused in resolveDid)
      if (side !== 'then') return;
      pay['then'] = s['then'];
      second['then'] = JSON.parse(JSON.stringify(s['then'])) as unknown;
      u.steps = [];
      if (!nameUsed(d, cond['step'] as string)) delete pay['as'];
      return;
    }
    if (pay[side] !== undefined) return;
    pay[side] = s['then'];
    u.steps = [];
    if (!nameUsed(d, cond['step'] as string)) delete pay['as'];
    if (side === 'then') absorbFollowers(seq, i, pay);
  });
}

/**
 * FAST5 T78 (CR 608.2c, 608.2d): "If C, you may X. If you do, Y." (Take Out the Trash): the `may` is one instruction of the `if`'s branch and the name it binds exists on that
 * branch alone, so the sentence that reads it moves into the branch, after the `may`: "if C then [may X (as did), if did then Y]". With C false nothing was offered, nothing was
 * done and Y does not happen. Only "if you do" (a negated reading was refused in resolveDid), only an `if` with no `else` and no guard whose branch is that one `may`, and
 * only a sentence that is nothing but "If you do, Y.".
 */
function foldMayInIf(seq: Unit[]): void {
  seq.forEach((u, i) => {
    if (u.manual || u.steps.length !== 1 || i === 0) return;
    const s = u.steps[0]!;
    const cond = s['cond'];
    if (s['op'] !== 'if' || !isRec(cond) || cond['cond'] !== 'did' || cond['not'] === true || cond['which'] !== undefined || typeof cond['step'] !== 'string' || s['else'] !== undefined || s['guard'] !== undefined) return;
    const prev = seq.slice(0, i).reverse().find((p) => p.manual !== undefined || p.steps.length > 0);
    if (!prev || prev.manual) return;
    const outer = prev.steps[prev.steps.length - 1]!;
    const branch = outer['then'];
    if (outer['op'] !== 'if' || outer['else'] !== undefined || outer['guard'] !== undefined || !Array.isArray(branch) || branch.length !== 1) return;
    const may = branch[0];
    if (!isRec(may) || may['op'] !== 'may' || may['as'] !== cond['step']) return;
    branch.push(s);
    u.steps = [];
  });
}

/**
 * std-blb (CR 608.2c, 118.12): "Then if you control three or more Clues, sacrifice ~. If you do, draw two cards." (the shape of Systems Override's "If it's a
 * Spacecraft, ... If you do, ..."): "you do" is the last instruction of the branch of the `if` right before (resolveDid: previousInstruction with `intoIf`). The name it
 * binds exists on that branch alone, so the sentence that reads it moves into the branch, after it: "if C then [X (as did), if did then Y]". With C false nothing
 * was done and Y does not happen. As foldMayInIf (which keeps the one-`may` branch): only "if you do", only an `if` with no `else` and no guard, and only a
 * sentence that is nothing but "If you do, Y.". Cloud std-fin's foldActionInIf (the same fold for a branch of one instruction, The Misty Mountains Cold) is
 * merged into this one.
 */
function foldDidInIf(seq: Unit[]): void {
  seq.forEach((u, i) => {
    if (u.manual || u.steps.length !== 1 || i === 0) return;
    const s = u.steps[0]!;
    const cond = s['cond'];
    if (s['op'] !== 'if' || !isRec(cond) || cond['cond'] !== 'did' || cond['not'] === true || cond['which'] !== undefined || cond['to'] !== undefined || typeof cond['step'] !== 'string' || s['else'] !== undefined || s['guard'] !== undefined) return;
    const prev = seq.slice(0, i).reverse().find((p) => p.manual !== undefined || p.steps.length > 0);
    if (!prev || prev.manual) return;
    const outer = prev.steps[prev.steps.length - 1]!;
    const branch = outer['then'];
    if (outer['op'] !== 'if' || outer['else'] !== undefined || outer['guard'] !== undefined || !Array.isArray(branch) || branch.length === 0) return;
    const last = branch[branch.length - 1];
    if (!isRec(last) || last['as'] !== cond['step']) return;
    branch.push(s);
    u.steps = [];
  });
}

/**
 * FAST5 T69 (CR 118.12, 608.2c): "You may pay {1}. If you do, return that card to the battlefield tapped under your control. It's a Treasure artifact with ..."
 * (Vraska, the Silencer): the sentence after a folded "If you do" that does nothing but act on an object only the folded instructions named ("it" is the card
 * they returned, bound under an `as` name inside the `then`) goes with them: with no payment there is no such card, and a name bound on one path alone can
 * not be read after it. Only whole sentences whose every reference to a bound name is to a name bound inside the `then`, and that name at least one.
 */
function absorbFollowers(seq: Unit[], at: number, pay: Rec): void {
  const inside = new Set<string>();
  visit(pay['then'] as Rec[], (n) => {
    if (typeof n['as'] === 'string') inside.add(n['as']);
  });
  if (inside.size === 0) return;
  for (let j = at + 1; j < seq.length; j++) {
    const next = seq[j]!;
    if (next.manual !== undefined) return;
    if (next.steps.length === 0) continue;
    const reads: string[] = [];
    const own = new Set<string>(); // r4-fxz: names the sentence binds itself ("Put one of them into your hand and the other into your graveyard": its own choice)
    visit(next.steps, (n) => {
      if (n['ref'] === 'bound' && typeof n['name'] === 'string') reads.push(n['name']);
      if (n['cond'] === 'did') reads.push('did');
      if (typeof n['as'] === 'string') own.add(n['as']);
    });
    // r4-fxz (CR 608.2c, 701.20e): "If you do, look at the top two cards of your library. Put one of them into your hand and the other into your graveyard." (Marchesa,
    // Dealer of Death): the sentence reads the cards looked at (bound inside the `then`) and its own choice; it goes with the payment too
    if (!reads.some((r) => inside.has(r)) || !reads.every((r) => inside.has(r) || own.has(r))) return;
    (pay['then'] as Rec[]).push(...next.steps);
    next.steps = [];
  }
}

/**
 * Standard round 5, r5-refs (CR 608.2c, 701.23a): "When ~ enters, you may search your library for an artifact card and reveal it. Put it onto the battlefield if
 * its mana value is 2 or less. Otherwise, put it into your hand." The sentences after the controller's option that do nothing but act on what the option's own
 * instructions found or made ("it" is the card the search found, bound under an `as` name inside the `may`, model/focus.ts#searchedOne) go with them: with no
 * search there is no such card, and a name bound on one path alone can not be read after it. absorbFollowers' rule for a payment (FAST5 T69), for one player's
 * option ("its controller may exile that many cards ... They may play those cards ...": the same for another player): only whole sentences with no target and no rider of their own, whose every reference to a bound name or result is to a name bound inside the `do`, and at least one.
 * Wave 8 merge: only the option of a player other than you (your own keeps r3-dig's reading, effects/handlers/control.ts#declinedNames: the names it binds name
 * nothing when it is declined), and only a sentence each of whose instructions reads what the option bound.
 */
function foldMayFollowers(seq: Unit[]): void {
  seq.forEach((u, at) => {
    if (u.manual !== undefined || u.steps.length === 0) return;
    const may = u.steps[u.steps.length - 1]!;
    const who = may['who'];
    // (one player's option: "each player may ..." runs its instructions once per player, a group the sentence after it would have to name again)
    if (may['op'] !== 'may' || may['otherwise'] !== undefined || may['guard'] !== undefined || !Array.isArray(may['do']) || !isRec(who) || who['ref'] === 'each') return;
    // wave 8 merge (duplicate of the base): your own option keeps r3-dig's reading, the names its instructions bind are bound to nothing when it is declined
    // (effects/handlers/control.ts#declinedNames, model/lint-flow.ts), so the sentences after it stay where they are (Daredevil, Norin, Guidelight Pathmaker)
    if (who['ref'] === 'you' && Object.keys(who).length === 1) return;
    const inside = new Set<string>();
    visit(may['do'], (n) => { if (typeof n['as'] === 'string') inside.add(n['as']); });
    if (inside.size === 0) return;
    for (let j = at + 1; j < seq.length; j++) {
      const next = seq[j]!;
      if (next.manual !== undefined) return;
      if (next.steps.length === 0) continue;
      if ((next.targetIds?.length ?? 0) > 0) return;
      // (a name the sentence binds itself is its own, whatever the option bound under the same name: "You may search your library ..., put it onto the battlefield")
      const own = new Set<string>();
      visit(next.steps, (n) => { if (typeof n['as'] === 'string') own.add(n['as']); });
      const reads: string[] = [];
      visit(next.steps, (n) => {
        if (n['ref'] === 'bound' && typeof n['name'] === 'string' && !own.has(n['name'])) reads.push(n['name']);
        // a sentence that reads whether or what the option did ("If a creature card is exiled this way, ...") is read after it as it is (the lint's Cloud std-fin
        // rule: a step that did not run moved nothing), never folded
        if (n['cond'] === 'did' || n['q'] === 'resultCount') reads.push('');
        if (n['op'] === 'manual' || n['op'] === 'reflexive' || n['op'] === 'delay') reads.push('');
      });
      if (reads.length === 0 || !reads.every((r) => inside.has(r))) return;
      // wave 8 review (CR 608.2c, 608.2d): every instruction of the sentence acts on what the option found; one that does not ("..., then draw a card") happens
      // whether or not the option was taken, so the sentence is not the option's
      const readsInside = (step: Rec): boolean => { let hit = false; visit(step, (n) => { if (n['ref'] === 'bound' && typeof n['name'] === 'string' && inside.has(n['name']) && !own.has(n['name'])) hit = true; }); return hit; };
      if (!next.steps.every((s) => readsInside(s))) return;
      (may['do'] as Rec[]).push(...next.steps);
      next.steps = [];
    }
  });
}

/** A sentence that is only "If [they do / don't], X." (a `did` still to resolve), or null. */
function didOnly(u: Unit): Rec | null {
  if (u.manual || u.steps.length !== 1) return null;
  const s = u.steps[0]!;
  const cond = s['cond'];
  if (s['op'] !== 'if' || !isRec(cond) || cond['cond'] !== 'did' || cond['$step'] === undefined || cond['which'] !== undefined || s['else'] !== undefined || s['guard'] !== undefined) return null;
  return s;
}

/**
 * CR 603.7: "If you do / don't, X." right after a sentence ending with a delayed trigger continues that trigger's instructions. The sentence moves into the
 * delay's `do`; its `did` names the last instruction there (a `pay` there takes it as `then` / `else`, CR 118.12). Returns false when it does not apply.
 */
function absorbIntoDelay(d: Draft, seq: Unit[], at: number): boolean {
  const u = seq[at]!;
  const s = didOnly(u);
  if (s === null) return false;
  const prev = seq.slice(0, at).reverse().find((p) => p.manual !== undefined || p.steps.length > 0);
  if (!prev || prev.manual) return false;
  const delay = prev.steps[prev.steps.length - 1]!;
  if (delay['op'] !== 'delay' || !Array.isArray(delay['do'])) return false;
  const inner = delay['do'] as Rec[];
  const last = inner[inner.length - 1];
  const not = (s['cond'] as Rec)['not'] === true;
  if (last === undefined || typeof last['op'] !== 'string' || NOT_AN_ACTION.has(last['op'])) {
    setManual(u, { code: 'unbound-reference', reason: '"if you do" after a delayed trigger with no understood instruction to refer to (CR 603.7, 118.12)', unresolved: true });
    return true;
  }
  const side = not ? 'else' : 'then';
  if (last['op'] === 'pay' && last[side] === undefined) last[side] = s['then'];
  else {
    if (typeof last['as'] !== 'string') last['as'] = freshName(d, last['op'] === 'pay' ? 'paid' : 'did');
    inner.push({ op: 'if', cond: { cond: 'did', step: last['as'], ...(not ? { not: true } : {}) }, then: s['then'] });
  }
  u.steps = [];
  return true;
}

/**
 * std-rB (CR 614.1a, 608.2c, 400.7): "Whenever you cast a multicolored instant or sorcery spell from your hand, exile that spell instead of putting it into your
 * graveyard as it resolves. If you do, it becomes plotted." (Lilah, Undefeated Slickshot): right after a sentence that ends with a lasting replacement of a move
 * (an `effect` step whose one effect is a `replace` with a `modify` body that only changes the destination), "if you do" is that replacement's move being carried
 * out, not the creation of the effect (which is never an action "you do", as for a delayed trigger). The sentence becomes the body's `then` (effects/bodies/m5.ts
 * #thenAfterMove: run once the object arrived where the replacement sent it, with that object bound as `then.as`), and the object the replacement moves (the
 * replaced event's `subject.is`, "it") is rewritten to that name: the card in its new zone (CR 400.7). Only "if you do" (not "if you don't"). Returns false when it
 * does not apply.
 */
function absorbIntoReplacement(d: Draft, seq: Unit[], at: number): boolean {
  const u = seq[at]!;
  const s = didOnly(u);
  if (s === null || (s['cond'] as Rec)['not'] === true || !Array.isArray(s['then'])) return false;
  const prev = seq.slice(0, at).reverse().find((p) => p.manual !== undefined || p.steps.length > 0);
  if (!prev || prev.manual) return false;
  const step = prev.steps[prev.steps.length - 1]!;
  const effects = step['effects'];
  if (step['op'] !== 'effect' || step['as'] !== undefined || !Array.isArray(effects) || effects.length !== 1 || !isRec(effects[0])) return false;
  const e = effects[0];
  const body = e['body'];
  const replaces = e['replaces'];
  if (e['s'] !== 'replace' || e['optional'] === true || !isRec(body) || body['b'] !== 'modify' || body['then'] !== undefined || !isRec(body['destination'])) return false;
  if (Object.keys(body).some((k) => k !== 'b' && k !== 'destination') || !isRec(replaces) || replaces['ev'] !== 'zoneChange') return false;
  const subject = replaces['subject'];
  const moved = isRec(subject) && isRec(subject['is']) ? JSON.stringify(subject['is']) : null;
  if (moved === null) return false;
  const as = freshName(d, 'moved');
  body['then'] = { as, do: rewrite(s['then'], (n) => (JSON.stringify(n) === moved ? { ref: 'bound', name: as } : undefined)) };
  u.steps = [];
  return true;
}

const targetIdsIn = (v: unknown): string[] => {
  const out: string[] = [];
  visit(v, (n) => { if (n['ref'] === 'target' && typeof n['id'] === 'string' && !out.includes(n['id'])) out.push(n['id']); });
  return out;
};

/**
 * FAST5 T76 (CR 603.12a, 608.2c): "When you do, put a +1/+1 counter on target attacking creature. It gains trample until end of turn." The sentences after a
 * reflexive trigger that do nothing but act on a target only the trigger announced ("it" is that target) are instructions of the trigger: the object is chosen
 * when it is put on the stack, so nothing outside can name it. They move into its `do`. Only whole sentences, with no target of their own, whose every
 * target reference is to a target the reflexive step names, and at least one.
 */
function foldReflexive(seq: Unit[]): void {
  seq.forEach((u, at) => {
    if (u.manual !== undefined || u.steps.length === 0) return;
    const refl = u.steps[u.steps.length - 1]!;
    if (refl['op'] !== 'reflexive' || !Array.isArray(refl['do'])) return;
    const own = new Set(targetIdsIn(refl['do']).filter((id) => (u.targetIds ?? []).includes(id)));
    // std-rx12 (CR 603.12a, 111.1, 608.2c): ... or on an object a step of the trigger itself binds ("When you do, create a 1/1 white Ally creature token. Put a +1/+1
    // counter on that token ..."): the token exists only once the trigger resolves, so nothing outside it can name it either
    const ownNames = new Set<string>();
    visit(refl['do'], (n) => { if (typeof n['op'] === 'string' && typeof n['as'] === 'string') ownNames.add(n['as']); });
    if (own.size === 0 && ownNames.size === 0) return;
    for (let j = at + 1; j < seq.length; j++) {
      const next = seq[j]!;
      if (next.manual !== undefined || next.rider !== undefined) return;
      if (next.steps.length === 0) continue;
      if ((next.targetIds?.length ?? 0) > 0) return;
      const targets = targetIdsIn(next.steps);
      // std-rj (CR 603.12a, 608.2c; Doom Reigns Supreme): "When you do, target opponent exiles the top five cards of their library. You may cast up to two spells from among the
      // exiled cards ...": besides the names the trigger's own steps give (std-rx12's ownNames), the sentence may read the names its own steps give (its choice among the
      // exiled cards): it is an instruction of the trigger, which resolves as one (a name from outside keeps the sentence out)
      const local = new Set<string>();
      visit(next.steps, (n) => { if (typeof n['as'] === 'string') local.add(n['as']); });
      let foreign = false;
      let names = 0;
      visit(next.steps, (n) => {
        if (n['ref'] === 'bound' && typeof n['name'] === 'string' && ownNames.has(n['name'])) names++;
        else if (n['op'] === 'reflexive' || n['op'] === 'manual' || (n['ref'] === 'bound' && typeof n['name'] === 'string' && !local.has(n['name']))) foreign = true;
      });
      if (foreign || targets.length + names === 0 || !targets.every((id) => own.has(id))) return;
      // r4-refs (CR 603.12, 603.4): a reflexive trigger that is one condition ("When you do, if it has four or more quest counters on it, put a +1/+1 counter on target
      // creature you control.") does the next sentence's instructions only when the condition held, so they join the condition's instructions
      const only: Rec | undefined = (refl['do'] as Rec[]).length === 1 ? (refl['do'] as Rec[])[0]! : undefined;
      const into: Rec[] = only !== undefined && only['op'] === 'if' && only['else'] === undefined && Array.isArray(only['then']) ? (only['then'] as Rec[]) : (refl['do'] as Rec[]);
      // (wave 7 review, CR 603.4, 603.12: that "if" is an intervening "if": the reflexive ability triggers only if the condition holds right then, so no target is
      // chosen when it does not (a target chosen would trigger valiant and heroic); the `if` kept in `do` checks it again on resolution. `when.if` is read by
      // effects/handlers/lasting.ts#reflexive, set by lowerReflexive; render/steps-lasting.ts#reflexive says it once)
      if (into !== refl['do']) refl['$intervening'] = true;
      into.push(...next.steps);
      next.steps = [];
    }
  });
}

/** CR 603.12: the reflexive steps of a unit get `when: {did}` and their own targets; null when they cannot (the reason). */
function lowerReflexive(d: Draft, u: Unit, all: readonly Unit[]): string | null {
  for (let k = 0; k < u.steps.length; k++) {
    const step = u.steps[k]!;
    let nested = false;
    for (const key of STEP_LISTS) visit(step[key], (n) => { if (n['op'] === 'reflexive') nested = true; });
    if (nested) return 'a reflexive trigger inside another instruction (CR 603.12)';
    if (step['op'] !== 'reflexive') continue;
    const when = step['when'];
    // FAST5X E16 (CR 603.12, 120.10): "When excess damage is dealt to the creature an opponent controls this way, ..." waits for the damage or fight step right
    // before and for its result: `when: {did: <that step>, if: <the excess condition>}`
    const excess = isRec(when) && when['cond'] === 'compare' && isExcess(when['left']) && typeof when['left']['step'] === 'string' && when['left']['step'] !== '' ? when['left']['step'] : null;
    // Cloud r3-moved (CR 603.12, 608.2c, 608.2h): "When you discard a nonland card this way, ..." waits for the instruction the `did` names and for what it moved:
    // `when: {did: <that step>, if: <the moved condition>}` (parser/holes/moved.ts), as the excess damage above
    const moved = excess === null && isRec(when) && when['cond'] === 'did' && typeof when['step'] === 'string' && when['step'] !== '' && when['not'] !== true && isRec(when['which'])
      && Object.keys(when).every((k) => k === 'cond' || k === 'step' || k === 'which' || k === 'to') ? when['step'] : null;
    // std-copy-1 (CR 603.12, 705.2): "When you win the flip, X" waits for the result of the coin flip right before it: the `{cond:'flip', won}` marker stays for
    // parser/lower/coin-flip.ts#foldFlips, which moves the trigger into that flip and names it (unresolved there: manual)
    const flip = isRec(when) && when['cond'] === 'flip' && typeof when['won'] === 'boolean' && Object.keys(when).length === 2;
    if (!flip && excess === null && moved === null && (!isRec(when) || when['cond'] !== 'did' || typeof when['step'] !== 'string' || when['step'] === '' || when['not'] === true || Object.keys(when).length !== 2)) {
      return 'a reflexive trigger that does not wait for "you do" (CR 603.12)';
    }
    const named = targetIdsIn(step['do']);
    const elsewhere = new Set<string>();
    for (const o of all) {
      const rest = o === u ? u.steps.filter((_, j) => j !== k) : o.steps;
      for (const id of targetIdsIn([rest, o.rider?.patch ?? null])) elsewhere.add(id);
    }
    // FAST5 T39 (CR 603.12a, 608.2c): a target the reflexive trigger only REFERS to ("Create a Monster Role token attached to target creature you control. When
    // you do, that creature fights ...") stays a target of the ability that announced it, in an earlier sentence; the engine fixes that object when the reflexive
    // trigger is created (effects/handlers/lasting.ts#reflexive, prepareDeferred). A target this sentence announces itself and also uses elsewhere stays manual.
    const announcedBefore = new Set<string>();
    for (const o of all) { if (o === u) break; for (const id of o.targetIds ?? []) announcedBefore.add(id); }
    const refers = (id: string): boolean => elsewhere.has(id) && !(u.targetIds ?? []).includes(id) && announcedBefore.has(id);
    const ids = named.filter((id) => !refers(id));
    if (ids.some((id) => elsewhere.has(id))) return 'a target of a reflexive trigger is also used outside it (CR 603.12a)';
    const specs = ids.map((id) => d.targets.find((t) => t.id === id));
    if (specs.some((t) => t === undefined)) return 'a target of a reflexive trigger with no spec (CR 603.12a)';
    // Cloud r3-moved: an instruction inside an option right before ("then you may discard a card. When you discard a nonland card this way, ..."): the trigger waits
    // for the option to be taken (CR 603.12, 118.12) and reads what its instruction moved; nested anywhere else, it is refused
    let waits = moved;
    if (moved !== null && !all.some((o) => o.steps.some((x) => x['as'] === moved))) {
      const opt = all.flatMap((o) => o.steps).find((x) => x['op'] === 'may' && x['otherwise'] === undefined && Array.isArray(x['do']) && (x['do'] as Rec[]).some((y) => y['as'] === moved));
      if (opt === undefined) return 'a reflexive trigger that waits for an instruction nested in another (CR 603.12)';
      if (typeof opt['as'] !== 'string') opt['as'] = freshName(d, 'did');
      waits = opt['as'] as string;
    }
    // (wave 7 review, CR 603.4: the intervening "if" foldReflexive marked, `when.if` a copy of the lone `if` of the instructions, which checks it again on resolution)
    // w8-followups (CR 603.4, 603.12): the same for the one-sentence form, "When you do, if there are four or more creature cards in your graveyard, put a +1/+1 counter
    // on target creature you control ..." (Sigil of Myrkul): an "if" right after "When you do," is an intervening "if" whether or not a later sentence joined it (the
    // template rf.whenYouDo reads "when <cond>, <effects>", so a lone `if` with no `else` as the instructions is that "if"). Not when the condition names a target of
    // the reflexive ability itself: those are chosen only after it triggers (CR 603.3d), so the condition could not be checked then (left as it was)
    const { $intervening: _marked, ...plainStep } = step;
    const doList = plainStep['do'];
    const loneIf = Array.isArray(doList) && doList.length === 1 && isRec(doList[0]) && doList[0]['op'] === 'if' && doList[0]['else'] === undefined && doList[0]['otherwise'] === undefined ? (doList[0] as Rec) : null;
    const lone = loneIf !== null && !targetIdsIn(loneIf['cond']).some((id) => ids.includes(id)) ? loneIf : null;
    if (flip && lone !== null) return 'an intervening "if" in a reflexive trigger of a coin flip (CR 603.4, 603.12)'; // std-copy-1: not modeled, fail closed
    u.steps[k] = { ...plainStep, when: flip ? when : excess !== null ? { did: excess, if: when } : waits !== null ? { did: waits, if: when } : lone !== null ? { did: (when as Rec)['step'], if: structuredClone(lone['cond']) } : { did: (when as Rec)['step'] }, targets: specs };
    d.targets = d.targets.filter((t) => !ids.includes(t.id));
    if (u.targetIds) u.targetIds = u.targetIds.filter((id) => !ids.includes(id));
  }
  return null;
}

/**
 * std-tdm (CR 603.7, 603.3d): the targets a sentence announces inside a delayed triggered ability that waits for an event ("Whenever you cast a noncreature spell this
 * turn, target creature you control gains double strike until end of turn") are chosen when IT is put on the stack, after it triggers: their specs move from the
 * ability into the `delay` step (`delay.targets`), as a reflexive trigger's do (lowerReflexive). A target the delay only refers to (announced by an earlier
 * sentence) stays the creating ability's and is fixed when the delay is created (effects/handlers/lasting-fix.ts#prepareDeferred); one this sentence announces and
 * also uses outside the delay is refused (one choice can't be made at two moments).
 */
function lowerDelayTargets(d: Draft, u: Unit, all: readonly Unit[]): string | null {
  const announcedHere = new Set(u.targetIds ?? []);
  for (let k = 0; k < u.steps.length; k++) {
    const step = u.steps[k]!;
    // std-library-1: and a step-timed delay written with a lead template that takes its targets ("At the beginning of the next combat phase this turn, ...";
    // parser/lower/targets.ts#STEP_DELAY_TARGET_LEADS); the tail form and the end step leads keep their older readings (guard G10)
    const stepLead = isRec(step['when']) && step['when']['at'] === 'step' && step['when']['step'] === 'beginCombat' && u.templates.some((t) => STEP_DELAY_TARGET_LEADS.has(t));
    if (step['op'] !== 'delay' || !isRec(step['when']) || (step['when']['at'] !== 'event' && !stepLead)) continue;
    const ids = targetIdsIn(step['do']).filter((id) => announcedHere.has(id));
    if (ids.length === 0) continue;
    const elsewhere = new Set<string>();
    for (const o of all) {
      const rest = o === u ? u.steps.filter((_, j) => j !== k) : o.steps;
      for (const id of targetIdsIn([rest, o.rider?.patch ?? null])) elsewhere.add(id);
    }
    if (ids.some((id) => elsewhere.has(id))) return 'a target of a delayed triggered ability is also used outside it (CR 603.7, 603.3d)';
    const specs = ids.map((id) => d.targets.find((t) => t.id === id));
    if (specs.some((t) => t === undefined)) return 'a target of a delayed triggered ability with no spec (CR 603.3d)';
    u.steps[k] = { ...step, targets: specs };
    d.targets = d.targets.filter((t) => !ids.includes(t.id));
    if (u.targetIds) u.targetIds = u.targetIds.filter((id) => !ids.includes(id));
  }
  return null;
}

/** Pass 7. */
/**
 * std-mana-12 (CR 603.2, 608.2c): "if you've done all four this turn" (holes/cond.ts writes `{cond:'all', of: [], $doneAll: N}`) names the actions of the ability's
 * own trigger ("Whenever you waterbend, earthbend, firebend, or airbend, ..."): when the trigger is exactly N `action` events with N different verbs, all by you,
 * the condition is that each of them happened this turn. Anything else keeps the marker, and normalize makes the sentence manual.
 */
function resolveDoneAll(d: Draft): void {
  const on = d.trigger?.on ?? [];
  const verbs = on.map((p) => (p.ev === 'action' && p.actor === 'you' && Object.keys(p).length === 3 ? p.verb : undefined));
  const ok = verbs.length > 0 && verbs.every((v) => v !== undefined) && new Set(verbs).size === verbs.length;
  for (const seq of sequences(d)) {
    for (const u of seq) {
      if (u.manual) continue;
      u.steps = u.steps.map((s) => rewrite(s, (n) => {
        if (n['cond'] !== 'all' || typeof n['$doneAll'] !== 'number') return undefined;
        if (!ok || n['$doneAll'] !== verbs.length) return undefined;
        return { cond: 'all', of: verbs.map((verb) => ({ cond: 'happened', event: { ev: 'action', verb, actor: 'you' }, scope: 'turn' })) };
      }) as Rec);
    }
  }
}

export function lowerConditions(input: Draft): Draft {
  const d = cloneDraft(input);
  resolveDoneAll(d); // std-mana-12
  sequences(d).forEach((seq, si) => {
    const prefix = si === 0 ? [] : d.units;
    seq.forEach((u, i) => {
      if (u.manual || absorbIntoDelay(d, seq, i) || absorbIntoReplacement(d, seq, i)) return; // std-rB: a lasting replacement's "if you do"
      resolveExcess(d, seq, i, prefix); // FAST5X E16
      if (!u.manual) resolveLifeLost(d, seq, i, prefix); // M12-3
      if (!u.manual) resolveCountersRemoved(d, seq, i, prefix); // std-rx14
      if (!u.manual) resolveCountersPut(d, seq, i, prefix); // trek-6
      if (!u.manual) resolveMayCount(d, seq, i, prefix); // pc-tokens-1
      if (!u.manual) resolveDamageDealt(d, seq, i, prefix); // std-rx20
      if (!u.manual) resolveVotes(d, seq, i, prefix); // M12-3
      if (!u.manual) resolveDid(d, seq, i, prefix);
    });
    foldReflexive(seq); // FAST5 T76
    const all = sequences(d).flat();
    for (const u of seq) {
      if (u.manual) continue;
      const why = lowerReflexive(d, u, all) ?? lowerDelayTargets(d, u, all); // std-tdm: a delayed trigger's own targets
      if (why !== null) setManual(u, { code: 'lint', reason: why });
    }
    foldPay(d, seq);
    foldMayInIf(seq);
    foldDidInIf(seq); // std-blb
    foldFlips(seq, d); // r3-mech: "If you win / lose the flip" (CR 705.2)
    foldClashes(seq); // p2-player-rules-2: "Clash with an opponent. If you win, X. Otherwise, Y." (CR 701.30)
    foldRollTable(seq); // p2-c-dieroll-1: the rows of a die-roll table move into the roll (CR 706.3a)
    absorbIntoDid(seq); // r4-fxz (before the repeat fold: "this process" then copies the if-did with what it absorbed, and the empty marker reads nothing)
    absorbIntoIf(seq); // std-costs-1
    foldMayFollowers(seq); // r5-refs (before the repeat fold, as absorbIntoDid: "this process" copies the option with its followers)
    foldRepeatProcess(seq); // r4-mech: "Repeat this process once" (CR 608.2c)
  });
  return d;
}

/**
 * std-costs-1 (CR 608.2c, 608.2d; Deadly Cover-Up): "If evidence was collected, exile a card from an opponent's graveyard. Then search its owner's graveyard, hand,
 * and library for any number of cards with that name and exile them. That player shuffles, ...": after a sentence that is only "If C, X." (an `if` with no else and
 * no guard, on any condition but "you do", which absorbIntoDid reads), the sentences that act only on what X named go with X: with C false nothing was named, and a
 * name bound on one path alone can not be read after it. Stricter than absorbFollowers: EVERY instruction of such a sentence reads a name the branch binds (or one an
 * earlier instruction of the absorbed sentences binds), so an instruction that would happen whatever C is never moves into the branch.
 */
function absorbIntoIf(seq: Unit[]): void {
  seq.forEach((u, i) => {
    if (u.manual || u.steps.length !== 1) return;
    const s = u.steps[0]!;
    const cond = s['cond'];
    if (s['op'] !== 'if' || !isRec(cond) || cond['cond'] === 'did' || s['else'] !== undefined || s['guard'] !== undefined || !Array.isArray(s['then'])) return;
    const inside = new Set<string>();
    visit(s['then'] as Rec[], (n) => {
      if (typeof n['as'] === 'string') inside.add(n['as']);
    });
    if (inside.size === 0) return;
    for (let j = i + 1; j < seq.length; j++) {
      const next = seq[j]!;
      if (next.manual !== undefined) return;
      if (next.steps.length === 0) continue;
      const known = new Set(inside);
      const fits = next.steps.every((step) => {
        let reads = false;
        visit([step], (n) => {
          if (n['ref'] === 'bound' && typeof n['name'] === 'string' && known.has(n['name'])) reads = true;
        });
        visit([step], (n) => {
          if (typeof n['as'] === 'string') known.add(n['as']);
        });
        return reads;
      });
      if (!fits) return;
      (s['then'] as Rec[]).push(...next.steps);
      next.steps = [];
      for (const n of known) inside.add(n);
    }
  });
}

/**
 * r4-fxz (CR 608.2c, 603.5): "you may sacrifice a Food. If you do, mill three cards. You may put a permanent card from among them into your hand." (Bristlebud
 * Farmer): after a sentence that is only "If you do, X." (an `if` on whether an earlier instruction was done, no else), the sentences that act only on what X
 * named go with X (absorbFollowers, as after a folded payment): with nothing done, there is nothing for them to act on, and a name bound on one path alone can
 * not be read after it.
 */
function absorbIntoDid(seq: Unit[]): void {
  seq.forEach((u, i) => {
    if (u.manual || u.steps.length !== 1) return;
    const s = u.steps[0]!;
    const cond = s['cond'];
    if (s['op'] !== 'if' || !isRec(cond) || cond['cond'] !== 'did' || cond['not'] === true || cond['which'] !== undefined || s['else'] !== undefined || s['guard'] !== undefined || !Array.isArray(s['then'])) return;
    absorbFollowers(seq, i, s);
  });
}
