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
import { cloneDraft, isRec, sequences } from './util';

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

/** Can the unit be moved into the instructions of the delayed trigger `lead` begins? */
function movable(u: Unit, lead: Unit): boolean {
  return u.line !== undefined && u.line === lead.line && u.manual === undefined && u.rider === undefined && u.steps.length > 0 && (u.targetIds ?? []).length === 0 && !LEAD.test(u.text) && u.steps.every((s) => isRec(s) && s['lower'] === undefined);
}

export function lowerDelayTail(draft: Draft): Draft {
  const wanted = sequences(draft).some((seq) => seq.some((u, i) => i < seq.length - 1 && leadDelay(u) !== null));
  if (!wanted) return draft;
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
      delay['do'] = [...(delay['do'] as Rec[]), ...tail.filter(can).flatMap((u) => u.steps)];
      for (const u of tail) if (can(u)) u.steps = [];
      break;
    }
  }
  return d;
}
