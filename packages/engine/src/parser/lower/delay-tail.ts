/**
 * Pass 8c, delay-tail (trek-8; CR 603.7, 603.7a, 608.2c): the sentences that follow a delayed trigger written in front of its instructions are instructions of that
 * delayed trigger.
 *
 *   "<setup>. At the beginning of the next combat this turn, gain control of that creature until end of turn. Untap it. It gains haste until end of turn."
 *
 * The delayed triggered ability (CR 603.7) is created with the whole rest of the paragraph as its effect: the untap and the haste happen when it triggers, at the
 * beginning of that combat, not now. The chart reads each sentence alone, so the sentence "At the beginning of ..., <instruction>." becomes a `delay` step and the
 * sentences after it become steps of the ability itself (they would run right away). This pass moves them into the `do` of that delay.
 *
 * Only the sure shape (fail closed: anything else stays as it was, so no formerly automated unit changes):
 *  - the unit is one whose text starts with the delayed trigger's own words ("at the beginning of", "at end of combat", "when", "whenever"), its LAST step is a
 *    `delay` with a `do` list and no `else`, and no step of it is manual;
 *  - only the later units on the SAME Oracle line (paragraph) as the lead are moved (the others stay): a spell's paragraphs are separate abilities of the card that the
 *    parser joins into one effect, and a later paragraph ("Until your next turn, prevent all damage ..." after "At the beginning of the next end step, return
 *    those cards ...", Morningtide's Light) is the spell's own instruction, not the delayed trigger's (Oracle puts a delayed trigger last in its paragraph);
 *  - every later unit is understood, is no rider, has steps, announces no target (a delayed trigger's own targets are chosen when it triggers
 *    and are lowered with the delay, CR 603.3d, 603.7), and does not begin another delayed trigger.
 * A name a moved instruction reads from before the delay is captured by the delay (parser/lower/normalize.ts#withCaptures); one it reads from a step inside the
 * delay is bound there. A moved instruction that reads a result the delayed trigger cannot see fails the lint (model/lint-flow.ts) and the ability stays manual.
 */
import type { Draft, Rec, Unit } from './types';
import { cloneDraft, freshName, isRec, rewrite, sequences, visit } from './util';

/** The words a sentence begins with when it is a delayed trigger written in front of its instructions (CR 603.7a). */
const LEAD = /^(?:at (?:the beginning of|the end of|end of) |when(?:ever)? )/i; // ("when": an event delay is left out below)

/** The delay step that is the last step of a unit written as a delayed trigger lead, or null. */
function leadDelay(u: Unit): Rec | null {
  if (u.manual !== undefined || u.rider !== undefined || !LEAD.test(u.text)) return null;
  const last = u.steps[u.steps.length - 1];
  if (!isRec(last) || last['op'] !== 'delay' || !Array.isArray(last['do']) || last['do'].length === 0 || last['else'] !== undefined || last['otherwise'] !== undefined) return null;
  if (last['guard'] !== undefined || last['targets'] !== undefined) return null;
  // (a delayed trigger that waits for an event has its own fold, lower/anaphora.ts#foldIntoDelay: a later sentence joins it only when its pronoun names what the trigger made)
  const when = last['when'];
  if (!isRec(when) || when['at'] === 'event') return null;
  return last;
}

/**
 * edh-perms-12 (CR 603.7c, 400.7, 608.2c; Phelia): "Exile up to one other target nonland permanent. At the beginning of the next end step, return that card to the battlefield
 * under its owner's control. If it entered under your control, ...": a later sentence's "it" was read as the target, which the exile moved (a new object when it comes back,
 * CR 400.7), so the delayed trigger would find nothing. Inside the delayed trigger the card is the binding its own move re-bases (design 3.1 rule 4): the target ids whose
 * move (an earlier instruction, `as`) the delayed trigger moves again by that name (it captures the name, parser/lower/normalize.ts#withCaptures), with the name of that move.
 */
function movedTargets(before: readonly Unit[], delay: Rec): Map<string, string> {
  const out = new Map<string, string>();
  const reMoved = new Set<string>();
  visit(delay['do'], (node) => {
    const what = node['what'];
    if (node['op'] === 'move' && isRec(what) && what['ref'] === 'bound' && typeof what['name'] === 'string') reMoved.add(what['name']);
  });
  for (const u of before) {
    visit(u.steps, (node) => {
      const what = node['what'];
      if (node['op'] === 'move' && isRec(what) && what['ref'] === 'target' && typeof what['id'] === 'string' && typeof node['as'] === 'string' && reMoved.has(node['as'])) out.set(what['id'], node['as']);
    });
  }
  return out;
}

/** Can the unit be moved into the instructions of the delayed trigger `lead` begins? */
function movable(u: Unit, lead: Unit): boolean {
  return u.line !== undefined && u.line === lead.line && u.manual === undefined && u.rider === undefined && u.steps.length > 0 && (u.targetIds ?? []).length === 0 && !LEAD.test(u.text) && u.steps.every((s) => isRec(s) && s['lower'] === undefined);
}

/**
 * edh-perms-20 (CR 603.7, 603.7c, 400.7, 608.2c; Grave Betrayal): "Return it to the battlefield under your control ... at the beginning of the next end step. That creature is a black
 * Zombie in addition to its other colors and types.": the creature the second sentence names is the one the delayed trigger returns, a new object that exists only inside the trigger,
 * so the sentence can name nothing outside it. A sentence whose every reference is to a name that only the instructions of a delayed trigger ending the sentence before it bind
 * (and that has no target of its own) is one of that trigger's instructions. Such a sentence cannot be read anywhere else (the lint refuses a name that is not bound on every path),
 * so no unit that was automated changes.
 */
function boundInside(delay: Rec): Set<string> {
  const names = new Set<string>();
  visit(delay['do'], (n) => { if (typeof n['op'] === 'string' && typeof n['as'] === 'string') names.add(n['as']); });
  return names;
}

function foldNamedTail(draft: Draft): Draft {
  const wanted = sequences(draft).some((seq) => seq.some((u, i) => i < seq.length - 1 && !u.manual && isRec(u.steps[u.steps.length - 1]) && u.steps[u.steps.length - 1]!['op'] === 'delay'));
  if (!wanted) return draft;
  const d = cloneDraft(draft);
  for (const seq of sequences(d)) {
    for (let i = 0; i < seq.length - 1; i++) {
      const lead = seq[i]!;
      if (lead.manual !== undefined || lead.rider !== undefined || lead.line === undefined) continue;
      const delay = lead.steps[lead.steps.length - 1];
      if (!isRec(delay) || delay['op'] !== 'delay' || !Array.isArray(delay['do']) || delay['do'].length === 0 || delay['else'] !== undefined || delay['guard'] !== undefined || delay['targets'] !== undefined) continue;
      const when = delay['when'];
      if (!isRec(when) || when['at'] === 'event') continue;
      const inside = boundInside(delay);
      if (inside.size === 0) continue;
      const next = seq[i + 1]!;
      if (next.line !== lead.line || next.manual !== undefined || next.rider !== undefined || next.steps.length === 0 || (next.targetIds ?? []).length > 0 || LEAD.test(next.text)) continue;
      const names = new Set<string>();
      visit(next.steps, (n) => { if (n['ref'] === 'bound' && typeof n['name'] === 'string') names.add(n['name']); });
      let foreign = false;
      visit(next.steps, (n) => { if (n['ref'] === 'target' || n['ref'] === 'event' || n['ref'] === 'it' || typeof n['$anaphor'] === 'object') foreign = true; });
      if (names.size === 0 || foreign || ![...names].every((nm) => inside.has(nm)) || next.steps.some((st) => !isRec(st) || st['lower'] !== undefined || st['op'] === 'delay')) continue;
      delay['do'] = [...(delay['do'] as Rec[]), ...next.steps];
      next.steps = [];
    }
  }
  return d;
}

/** The step-timed `delay` a unit's last step is, directly or as the whole `then` of an "if you do" (CR 608.2c), or null. */
function lastDelayOf(u: Unit): Rec | null {
  let last: unknown = u.steps[u.steps.length - 1];
  if (isRec(last) && last['op'] === 'if' && last['else'] === undefined && Array.isArray(last['then']) && last['then'].length === 1) last = last['then'][0];
  if (!isRec(last) || last['op'] !== 'delay' || !Array.isArray(last['do']) || last['do'].length === 0) return null;
  if (last['else'] !== undefined || last['guard'] !== undefined || last['targets'] !== undefined) return null;
  const when = last['when'];
  return isRec(when) && when['at'] !== 'event' ? last : null;
}

/** The names a step list's steps read as `bound`, and whether any step reads something that is not of the delay's creator (a target, an event role, ~, a pronoun left over). */
function readsOf(steps: readonly unknown[], name: string): { reads: boolean; foreign: boolean } {
  let reads = false;
  let foreign = false;
  visit(steps, (n) => {
    if (n['ref'] === 'bound' && n['name'] === name) reads = true;
    else if (n['ref'] === 'bound' || n['ref'] === 'target' || n['ref'] === 'event' || n['ref'] === 'self' || n['ref'] === 'it' || typeof n['$anaphor'] === 'object') foreign = true;
  });
  return { reads, foreign };
}

/** A step-timed delay whose last instruction moves a bound name onto the battlefield and gives the returned object no name yet: that move and the name. */
function returnOf(step: unknown): { delay: Rec; mv: Rec; name: string } | null {
  if (!isRec(step) || step['op'] !== 'delay' || !Array.isArray(step['do']) || step['do'].length === 0 || step['else'] !== undefined || step['guard'] !== undefined || step['targets'] !== undefined) return null;
  if (!isRec(step['when']) || step['when']['at'] === 'event') return null;
  const mv = step['do'][step['do'].length - 1];
  if (!isRec(mv) || mv['op'] !== 'move' || mv['as'] !== undefined || !isRec(mv['what']) || mv['what']['ref'] !== 'bound' || typeof mv['what']['name'] !== 'string' || !isRec(mv['to']) || mv['to']['zone'] !== 'battlefield') return null;
  return { delay: step, mv, name: mv['what']['name'] };
}

/** The instructions after a step-timed delayed return in the SAME list ("If you do, return it ... at the beginning of your next upkeep. It gains haste." folded into one `then`) belong to the delay. */
function foldInList(list: unknown[], d: Draft): void {
  for (let k = 0; k < list.length; k++) {
    const st = list[k];
    if (!isRec(st)) continue;
    for (const key of ['then', 'else', 'do'] as const) if (st['op'] !== 'delay' && Array.isArray(st[key])) foldInList(st[key] as unknown[], d);
    const ret = returnOf(st);
    if (ret === null || k === list.length - 1) continue;
    const tail = list.slice(k + 1);
    const { reads, foreign } = readsOf(tail, ret.name);
    if (!reads || foreign || tail.some((x) => !isRec(x) || x['lower'] !== undefined || x['op'] === 'delay' || x['op'] === 'if' || x['op'] === 'may' || x['op'] === 'manual')) continue;
    const as = freshName(d, 'returned');
    ret.mv['as'] = as;
    ret.delay['do'] = [...(ret.delay['do'] as Rec[]), ...(rewrite(tail, (node) => (node['ref'] === 'bound' && node['name'] === ret.name ? { ref: 'bound', name: as } : undefined)) as Rec[])];
    list.length = k + 1;
  }
}

/**
 * edh-next-79 (CR 603.7, 603.7c, 400.7, 608.2c; Obzedat, Ghost Council: "If you do, return it to the battlefield under its owner's control at the beginning of your next upkeep. It gains
 * haste."): the sentence after a delayed return that names the object the return puts onto the battlefield is an instruction of the delayed trigger, done to the object that has
 * come back (a new object, CR 400.7: an effect made now would find only the card in exile). The unit before it ends in a step-timed `delay` whose instruction moves a bound name
 * onto the battlefield; a later unit of the same paragraph that reads that name (and nothing that is not of this resolution) moves into the delay after the move, which binds
 * the returned object (`as`) and which the unit's references now name. Anything else stays as it was (the lint of model/lint-flow.ts refuses it).
 */
/**
 * edh-next-79 (CR 603.7c, 400.7, 608.2c; Legion's Initiative: "At the beginning of the next combat, return those cards to the battlefield ... and those creatures gain haste until end of turn."):
 * inside one delayed trigger, an instruction after the move of a bound group onto the battlefield that reads the same name acts on the objects that came back, not on the cards that
 * were exiled: the move names what it put there (`as`) and the later instructions of the delayed trigger read that name.
 */
function renameInsideDelay(steps: readonly unknown[], d: Draft): void {
  visit(steps, (n) => {
    if (n['op'] !== 'delay' || !Array.isArray(n['do'])) return;
    const body = n['do'] as unknown[];
    for (let k = 0; k < body.length - 1; k++) {
      const mv = body[k];
      if (!isRec(mv) || mv['op'] !== 'move' || mv['as'] !== undefined || !isRec(mv['what']) || mv['what']['ref'] !== 'bound' || typeof mv['what']['name'] !== 'string' || !isRec(mv['to']) || mv['to']['zone'] !== 'battlefield') continue;
      const name = mv['what']['name'];
      const tail = body.slice(k + 1);
      if (!readsOf(tail, name).reads || tail.some((x) => !isRec(x) || x['op'] !== 'effect')) continue; // (only a grant of an ability or the like: other tails keep the reading they had, edh-perms-12's Phelia among them)
      const as = freshName(d, 'returned');
      mv['as'] = as;
      body.splice(k + 1, tail.length, ...(rewrite(tail, (node) => (node['ref'] === 'bound' && node['name'] === name ? { ref: 'bound', name: as } : undefined)) as unknown[]));
    }
  });
}

/** Does a step list hold (anywhere) a delayed return that steps follow in the same list? */
function hasReturnList(steps: readonly unknown[]): boolean {
  let found = false;
  visit(steps, (n) => {
    for (const key of ['then', 'else', 'do']) {
      const l = n[key];
      if (Array.isArray(l) && l.some((x, k) => k < l.length - 1 && returnOf(x) !== null)) found = true;
    }
  });
  return found || steps.some((x, k) => k < steps.length - 1 && returnOf(x) !== null);
}

function hasDelayReturnTail(steps: readonly unknown[]): boolean {
  let found = false;
  visit(steps, (n) => { if (n['op'] === 'delay' && Array.isArray(n['do']) && n['do'].some((x, k, l) => k < l.length - 1 && isRec(x) && x['op'] === 'move' && x['as'] === undefined)) found = true; });
  return found;
}

function foldReturnedTail(draft: Draft): Draft {
  const wanted = sequences(draft).some((seq) => seq.some((u, i) => !u.manual && ((i < seq.length - 1 && lastDelayOf(u) !== null) || hasReturnList(u.steps) || hasDelayReturnTail(u.steps))));
  if (!wanted) return draft;
  const d = cloneDraft(draft);
  for (const seq of sequences(d)) for (const u of seq) if (u.manual === undefined && u.rider === undefined) { foldInList(u.steps as unknown[], d); renameInsideDelay(u.steps, d); }
  for (const seq of sequences(d)) {
    for (let i = 0; i < seq.length - 1; i++) {
      const lead = seq[i]!;
      const delay = lead.manual === undefined && lead.rider === undefined && lead.line !== undefined ? lastDelayOf(lead) : null;
      if (delay === null) continue;
      const body = delay['do'] as Rec[];
      const mv = body[body.length - 1]!;
      const what = mv['what'];
      const to = mv['to'];
      if (mv['op'] !== 'move' || mv['as'] !== undefined || !isRec(what) || what['ref'] !== 'bound' || typeof what['name'] !== 'string' || !isRec(to) || to['zone'] !== 'battlefield') continue;
      const name = what['name'];
      const next = seq[i + 1]!;
      if (next.line !== lead.line || next.manual !== undefined || next.rider !== undefined || next.steps.length === 0 || (next.targetIds ?? []).length > 0 || LEAD.test(next.text)) continue;
      const { reads, foreign } = readsOf(next.steps, name);
      if (!reads || foreign || next.steps.some((st) => !isRec(st) || st['lower'] !== undefined || st['op'] === 'delay')) continue;
      const as = freshName(d, 'returned');
      mv['as'] = as;
      delay['do'] = [...body, ...(rewrite(next.steps, (node) => (node['ref'] === 'bound' && node['name'] === name ? { ref: 'bound', name: as } : undefined)) as Rec[])];
      next.steps = [];
    }
  }
  return d;
}

export function lowerDelayTail(draft: Draft): Draft {
  const wanted = sequences(draft).some((seq) => seq.some((u, i) => i < seq.length - 1 && leadDelay(u) !== null));
  if (!wanted) return foldReturnedTail(foldNamedTail(draft));
  const d = cloneDraft(draft);
  for (const seq of sequences(d)) {
    for (let i = 0; i < seq.length - 1; i++) {
      const lead = seq[i]!;
      const delay = leadDelay(lead);
      if (delay === null) continue;
      if (lead.line === undefined) continue;
      const tail = seq.slice(i + 1).filter((u) => u.line === lead.line); // (the units of a later paragraph are the spell's own, they stay where they are)
      const can = (u: Unit): boolean => movable(u, lead);
      // units with no steps that are folded riders keep to the step they modified; a manual or a not movable later unit leaves the whole sequence as it was
      const empty = (u: Unit): boolean => u.manual === undefined && u.steps.length === 0 && u.rider !== undefined;
      if (!tail.every((u) => can(u) || empty(u)) || !tail.some(can)) continue;
      const names = movedTargets(seq.slice(0, i + 1), delay);
      delay['do'] = [...(delay['do'] as Rec[]), ...tail.filter(can).flatMap((u) => names.size === 0 ? u.steps : (rewrite(u.steps, (node) => (node['ref'] === 'target' && typeof node['id'] === 'string' && names.has(node['id']) ? { ref: 'bound', name: names.get(node['id']) } : undefined)) as Rec[]))];
      for (const u of tail) if (can(u)) u.steps = [];
      break;
    }
  }
  return foldReturnedTail(foldNamedTail(d));
}
