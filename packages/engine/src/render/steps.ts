/**
 * Step sequencing (WP2): the dispatcher from a step to its clause, guards, the folds of adjacent steps that Oracle writes as one idiom, and the
 * joining of clauses into sentences.
 *
 * What a program says is the ORDER of its steps; how Oracle joins them (". ", " and ", ", then ") says nothing the model keeps, so every boundary
 * is an alternative group. Everything else (verbs, objects, numbers, conditions) is exact.
 */
import type { EffectOp, EffectStep } from '../types/ability';
import { fragment, within, type Clause } from './clause';
import { isImpliedGuard } from './cond';
import { COST_SELF } from './costs';
import { actsOnlyOnNamed } from '../model/cost-antecedent';
import { foldAt } from './fold';
import { K, type JoinOpts } from './kernel';
import { CLAUSES_CARDS } from './steps-cards';
import { CLAUSES_FLOW, withAlso } from './steps-flow';
import { CLAUSES_LASTING } from './steps-lasting';
import { CLAUSES_LIFE } from './steps-life';
import { CLAUSES_ZONES, copyNewTargets, noRegeneration } from './steps-zones';
import type { StepOf } from './steps-util';
import { CLAUSES_R3MECH } from './steps-r3mech';
import { CLAUSES_STDR10 } from './steps-stdr10';
import { focusEffect, grantedGroup, keepsFocus, keptFocus, notPutMove, notPutZone } from '../model/focus';
import { antecedentIds } from './refs';
import { cloneState, objKey, type RenderState } from './state';
import { alt, ALT_SEP, mapEnds, NoRenderer, parseMarked, type MarkedNode } from './text';

/** Step lists inside step lists (a `pay` inside a `may` inside an `if` ...). Pay clauses print every branch once per reading, so the text grows with each level. */
const MAX_STEP_NESTING = 6;

export type ClauseFn = (step: never, st: RenderState) => Clause;

/** One clause function per op. An op missing here is not renderable (and so not a capability: design 5.2). */
export const CLAUSES: Readonly<Partial<Record<EffectOp, ClauseFn>>> = {
  ...CLAUSES_FLOW,
  ...CLAUSES_LIFE,
  ...CLAUSES_CARDS,
  ...CLAUSES_ZONES,
  ...CLAUSES_LASTING,
  ...CLAUSES_R3MECH, // cloud r3-mech: fromOutside
  ...CLAUSES_STDR10, // Standard round 10: nextSpell
};

/**
 * r5-fxb (CR 115.1, 601.2c, 608.2f): a step that acts on a target spec with one target for each opponent or each player ("put a -1/-1 counter on up to one target
 * creature that player controls") is said after "for each opponent," / "for each player,", as the ops that say it themselves do (render/steps-zones.ts); only an
 * object the step acts on (not a reference inside its amount), only where the step names the target first (a later "Untap those creatures." is no per-player
 * instruction), and never twice.
 */
const PER_PLAYER_KEYS = ['what', 'on', 'to', 'object', 'subject'] as const;
function perPlayerLead(step: EffectStep, st: RenderState): string | null {
  let any = false;
  for (const spec of st.specs.values()) if (spec.perOpponent === true || spec.perPlayer === true) { any = true; break; }
  if (!any) return null; // the ability has no such target: nothing to look up (the render gate runs this for every step)
  const rec = step as unknown as Record<string, unknown>;
  const effects = step.op === 'effect' ? step.effects.map((e) => (e as { affects?: unknown }).affects) : []; // a continuous effect's object ("gain control of ...")
  const per = [...PER_PLAYER_KEYS.map((k) => rec[k]), ...effects].flatMap((v) => {
    const r = v as { ref?: string; id?: string } | undefined;
    const spec = r?.ref === 'target' && r.id !== undefined && !st.mentioned.has(`t:${r.id}`) ? st.specs.get(r.id) : undefined;
    return spec?.perOpponent === true ? ['opponent'] : spec?.perPlayer === true ? ['player'] : [];
  })[0];
  if (per === undefined) return null;
  // r5-refs (family each-other-player-opponent; CR 102.3): with no teams every other player is an opponent, so Oracle may say "for each other player," too (merge wave 8:
  // moved here from render/steps-zones.ts with r5-fxb's lead)
  return per === 'opponent' ? `${alt('for each opponent', 'for each other player')}, ` : `for each ${per}, `;
}
/** The lead is already said: plain, or as the alternatives above (merge wave 8: also "for each other player,"). */
const LEAD_SAID = new RegExp(`^\\W*for each (?:opponent|player|other player)(?:,|${ALT_SEP})`);
function withLead(lead: string | null, c: Clause): Clause {
  if (lead === null || c.empty || LEAD_SAID.test(c.sub)) return c;
  return { ...c, imp: `${lead}${c.imp}`, sub: `${lead}${c.sub}`, ...(c.have !== undefined ? { have: `${lead}${c.have}` } : {}) };
}

/** pc-players-3: "they control a commander" for a guard `not exists (a description the recipient controls)` on a step that hurts that recipient (template eff.pcp3.damage.unlessTheyControl). */
function unlessTheyControl(step: EffectStep, st: RenderState): string | null {
  const g = step.guard;
  if (g?.cond !== 'not' || g.of.cond !== 'exists' || g.of.atLeast !== undefined || g.of.of.ref !== 'each') return null;
  const f = g.of.of.filter;
  const kinds = f.anyOf;
  if (kinds?.length !== 1 || Object.keys(f).length !== 2 || step.op !== 'damage' || JSON.stringify(f.controller) !== JSON.stringify(step.to)) return null;
  if (step.to.ref === 'each' || step.to.ref === 'eachWho' || step.to.ref === 'controlsMost') return null; // a group is judged player by player; the guard is one check for the step
  return `they control ${K.np(kinds[0]!, cloneState(st), { det: 'a' })}`;
}

/** A step as a clause, with its guard applied. */
export function clause(step: EffectStep, st: RenderState): Clause {
  const fn = Object.hasOwn(CLAUSES, step.op) ? CLAUSES[step.op] : undefined;
  if (!fn) throw new NoRenderer(`op ${step.op}`);
  // the first thing printed after a trigger clause (CR 603.4): a condition there would read as an intervening if, which the model says with `interveningIf`
  const afterTrigger = st.afterTrigger;
  st.afterTrigger = false;
  if (step.op === 'if') st.leadingIf = afterTrigger;
  const lead = perPlayerLead(step, st); // r5-fxb: read before the step names its target
  const run = (): Clause => withLead(lead, (fn as (s: EffectStep, st: RenderState) => Clause)(step, st));
  if (step.guard === undefined || isImpliedGuard(step.guard, st, step)) return run();
  // Standard round 3, r3-trig (CR 707.10c, 608.2c): a guarded spell copy that lets its controller choose new targets says the guard before the new-targets words:
  // "copy it if you gained life this turn. You may choose new targets for the copy." (render/steps-zones.ts#copyNewTargets)
  if (step.op === 'copy' && step.result === 'spell' && copyNewTargets(step) !== '') {
    const { newTargets: _newTargets, ...bare } = step;
    st.afterTrigger = afterTrigger;
    const c = clause(bare as EffectStep, st);
    const nt = copyNewTargets(step);
    return { ...c, imp: c.imp + nt, sub: c.sub + nt, standalone: true };
  }
  // r4-dig (CR 701.8a, 608.2c): "Mill two cards, then destroy the chosen permanent if its mana value is less than or equal to the number of cards in your
  // graveyard." (Quag Feast): a guarded destroy is also said with the instruction first, so it names the object and the condition says "its", and it joins the
  // instruction before it (", then"); read on the state before either is said
  // std-rx22 (CR 701.6a, 608.2c): and a guarded counter, "Counter target spell if it's blue." (Pyroblast, Hydroblast; family stdrx22-guarded-counter-after)
  const first = (step.op === 'destroy' || step.op === 'counter') && !afterTrigger ? cloneState(st) : null;
  // std-rx23 (CR 608.2c, 301.5a): right after a trigger, an instruction on the enchanted or equipped object is also said before its condition names it again,
  // "put a +1/+1 counter on equipped creature if it's black" (the instruction names the object, the condition says "it"); read on the state before either is said
  const onAttached = afterTrigger && ['on', 'what'].some((k) => JSON.stringify((step as unknown as Record<string, unknown>)[k]) === JSON.stringify({ ref: 'attachedTo' })) ? cloneState(st) : null;
  const unlessState = step.op === 'damage' ? cloneState(st) : null; // pc-players-3: the instruction said before its condition names the recipient
  const cond = K.cond(step.guard, st);
  const c = run();
  const body = fragment(c);
  // FAST5X E1: "if C, <subject> also <verb> ..." (render/steps-flow.ts#withAlso)
  const also = afterTrigger ? null : withAlso(body);
  // std-blb: and the condition after it, "It also gets +1/+0 until end of turn if you control a Mouse." (CR 608.2c)
  const bodyFirst = onAttached === null ? null : `${fragment((fn as (s: EffectStep, st: RenderState) => Clause)(step, onAttached))} if ${K.cond(step.guard, onAttached)}`;
  // pc-players-3 (CR 608.2c, 109.4; template eff.pcp3.damage.unlessTheyControl): a damage step guarded by "that player controls none of these" is also said "... unless they control a commander"
  const unless = step.op === 'damage' ? unlessTheyControl(step, st) : null;
  const unlessForms = unless === null || unlessState === null ? [] : [`${fragment((fn as (s: EffectStep, st: RenderState) => Clause)(step, unlessState))} unless ${unless}`];
  const text = afterTrigger ? (bodyFirst === null && unlessForms.length === 0 ? `${body} if ${cond}` : alt(`${body} if ${cond}`, ...(bodyFirst === null ? [] : [bodyFirst]), ...unlessForms)) : alt(`if ${cond}, ${body}`, `${body} if ${cond}`, ...(also !== null ? [`if ${cond}, ${also}`, `${also} if ${cond}`] : []), ...unlessForms);
  if (first !== null) {
    // p2-refs-2 (CR 701.19c, 608.2c): a guarded destroy that can't be regenerated says its condition after the instruction and the regeneration sentence after that,
    // "Destroy target creature if it's white. A creature destroyed this way can't be regenerated." (Soul Rend)
    const noRegen = step.op === 'destroy' && step.regeneration === 'cant';
    const plainStep = noRegen ? (({ regeneration: _r, ...rest }) => rest)(step as StepOf<'destroy'>) as EffectStep : step;
    const trailing0 = `${fragment((fn as (s: EffectStep, st: RenderState) => Clause)(plainStep, first))} if ${K.cond(step.guard, first)}`;
    const trailing = noRegen ? `${trailing0}. ${noRegeneration(step as StepOf<'destroy'>, first)}` : trailing0;
    const both = alt(text, trailing);
    return { imp: both, sub: both, actor: null, leadThen: true };
  }
  // FAST5X E17 (CR 608.2c): a guarded instruction after another may begin "Then" ("Then draw a card if this is the second time ..."), as an `if` step does
  return { imp: text, sub: text, actor: null, standalone: true, ...(afterTrigger ? {} : { leadThen: true }) };
}

/**
 * FAST5 T76 (CR 608.2c; the parser's rule, parser/lower/anaphora.ts#focusAt, model/focus.ts): the key of the object the discourse is focused on after `step`: the token it
 * created (named by its `as`) or the one named object it worked on; undefined otherwise.
 */
function focusAfter(step: EffectStep): string | undefined {
  const fx = focusEffect(step) ?? keptFocus(step); // Cloud std-fin: a name the last instruction of an `if` / a `may` worked on (the parser's rule, anaphora.ts#focusAt)
  if (fx === null) return undefined;
  if (fx.kind === 'makes') {
    const as = (step as unknown as Record<string, unknown>)['as'];
    return typeof as === 'string' ? `b:${as}` : undefined;
  }
  return objKey(fx.on as never) ?? undefined;
}

/**
 * LOOK3 (the parser's rule, parser/lower/anaphora.ts#notPutFocus): the key of the card an "If you don't put the card onto the battlefield, ..." instruction (`step`) is
 * about: what the move it names would have moved, the last instruction of the instruction before it (`before`) inside its `if` and `may` (model/focus.ts#notPutMove).
 * Undefined for any other instruction, or when the condition names another step.
 */
function notPutFocusAfter(before: EffectStep, step: EffectStep): string | undefined {
  const zone = notPutZone(step);
  const mv = zone === undefined ? null : notPutMove(before, zone);
  const cond = (step as unknown as Record<string, unknown>)['cond'] as Record<string, unknown>;
  return mv !== null && mv['as'] === cond['step'] ? objKey(mv['what'] as never) ?? undefined : undefined;
}

/**
 * FAST5 T76: does a condition of this instruction name the object itself without a reference ("If ~ was kicked, it deals 2 damage to another target creature.": the "~"
 * before the pronoun is what "it" means, CR 201.5; a condition that reads the object by a reference makes it a candidate of its own)? Then the focus of the instruction before it does not decide the pronoun (the parser's rule, anaphora.ts, a "~" before the pronoun).
 */
function condNamesSelf(step: EffectStep): boolean {
  let found = false;
  const walk = (v: unknown): void => {
    if (found || typeof v !== 'object' || v === null) return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    const n = v as Record<string, unknown>;
    if (n['cond'] === 'wasCast' && n['kicked'] !== 'gift' && n['kicked'] !== 'collectEvidence') { found = true; return; } // (render/cond.ts#wasCastPhrase: these two never say the object)
    Object.values(n).forEach(walk);
  };
  walk([(step as unknown as Record<string, unknown>)['guard'], (step as unknown as Record<string, unknown>)['cond']]);
  return found;
}

/** The clauses of a list of steps after folding. */
function clausesOf(list: EffectStep[], st: RenderState): Clause[] {
  const items: Clause[] = [];
  const inheritedSeen = st.focusSeen;
  const inherited = st.focus; // the focus of an enclosing list stays for the first instruction of this one ("... at the beginning of the next end step, sacrifice it")
  let focus = inherited;
  for (let i = 0, done = 0; i < list.length; ) {
    if (i > 0 && st.chosen?.list === list) delete st.chosen; // Cloud std-eoe: the chosen target is the focus of the first instruction only (state.ts#chosen)
    for (; done < i; done++) if (!keepsFocus(list[done])) focus = focusAfter(list[done]!); // std-promote-4: "You get {E}{E}" keeps it (model/focus.ts#keepsFocus)
    // LOOK3: "If you don't put the card onto the battlefield, put it into your hand." is about the card the move it names would have moved. The words name that move by
    // its place (render/cond.ts#notPutPhrase), so a condition that names any other step has no wording: since Cloud std-fin's keptFocus (focusAfter) also leaves the
    // focus on that card after the `if` / `may` before, the pronoun alone no longer refuses such a step
    if (notPutZone(list[i]) !== undefined) {
      const f = i > 0 ? notPutFocusAfter(list[i - 1]!, list[i]!) : undefined;
      if (f === undefined) throw new NoRenderer('"if you don\'t put the card ..." whose condition names another step than the move the instruction right before ends with');
      focus = f;
    }
    if (focus === undefined || condNamesSelf(list[i]!)) delete st.focus;
    else {
      st.focus = focus;
      st.focusSeen = antecedentIds(st);
    }
    // PUSH1 T2 review (design 6.4, the parser's rule: parser/lower/anaphora.ts#costWindow): the object the cost named may be "it" only in the first
    // instruction, and only when that instruction introduces no object of its own (model/cost-antecedent.ts)
    if (st.mentioned.has(COST_SELF)) {
      const probe = foldAt(list, i, cloneState(st)); // a fold prints several steps as one clause: every one of them must qualify
      if (!list.slice(i, i + (probe?.consumed ?? 1)).every(actsOnlyOnNamed)) st.mentioned.delete(COST_SELF);
    }
    const folded = foldAt(list, i, st);
    if (folded) {
      st.mentioned.delete(COST_SELF);
      st.afterTrigger = false; // FAST5 T61: a fold is the first thing printed after a trigger too (CR 603.4): the next instruction is not
      items.push(...folded.clauses);
      i += folded.consumed;
      continue;
    }
    let c = clause(list[i]!, st);
    // r5-fxb (family also-after-instruction, CR 611.2a, 608.2c): a continuous effect after another instruction of the list may say "also" after its subject
    // ("Creatures you control get +1/+0 until end of turn. Kithkin creatures you control also gain first strike until end of turn.")
    if (items.length > 0 && list[i]!.op === 'effect' && list[i]!.guard === undefined && c.actor === null && !c.empty && c.imp === c.sub) {
      const also = withAlso(c.sub);
      if (also !== null) {
        const text = alt(c.sub, also);
        c = { ...c, imp: text, sub: text };
      }
    }
    st.mentioned.delete(COST_SELF);
    if (!c.empty) items.push(c);
    const granted = grantedGroup(list[i]); // FAST5 T76: the group a pump or grant just named is also "them" for the instructions after it
    if (granted !== null) st.group = JSON.stringify(granted['filter']);
    i++;
  }
  if (inherited === undefined) delete st.focus;
  else st.focus = inherited;
  if (inheritedSeen === undefined) delete st.focusSeen;
  else st.focusSeen = inheritedSeen;
  return items;
}

/** Steps as text: clauses joined by sentence breaks, "and", ", then". */
export function steps(list: EffectStep[], st: RenderState, o: JoinOpts = {}): string {
  if (st.nest >= MAX_STEP_NESTING) throw new NoRenderer('step lists nested too deeply');
  st.nest++;
  try {
    return joined(list, st, o);
  } finally {
    st.nest--;
  }
}

// r3-fx: also a single quote inside quotes (render/quote.ts). std-control-1: also a reading that already ends its sentence with its own period, the duration said
// after a quoted grant ('... gains "{T}: Add {C}{C}" until end of turn.', render/mods.ts, FAST5 T69): the next sentence follows after a space, never after "..".
const QUOTE_END = /(?:[.!?](?:'?["”]|')|\.)$/;

/** Do all, some or none of the readings of a marked text end inside the closing quote of a quoted ability (the last literal of each reading)? */
function quoteEnds(marked: string): 'all' | 'some' | 'none' {
  const seen = new Set<boolean>();
  const walk = (nodes: MarkedNode[]): void => {
    const last = nodes[nodes.length - 1];
    if (last === undefined) return;
    if (typeof last === 'string') seen.add(QUOTE_END.test(last));
    else for (const a of last.alts) walk(a);
  };
  walk(parseMarked(marked));
  return seen.size === 2 ? 'some' : seen.has(true) ? 'all' : 'none';
}

function joined(list: EffectStep[], st: RenderState, o: JoinOpts): string {
  const items = clausesOf(list, st);
  if (items.length === 0) return '';
  const text = (c: Clause): string => (o.actor !== undefined ? within(c, o.actor) : fragment(c));
  let out = text(items[0]!);
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1]!;
    const cur = items[i]!;
    let sep: string;
    // CR 608.2d: what follows a `may` is not inside it, so it can never be joined to it by "and" or "then"
    // FAST2 T8: "Then if ..." begins a sentence of its own after another (CR 608.2c: "then" only orders the instructions)
    if (prev.standalone || cur.standalone || prev.closesScope === true) {
      // FAST5 T61: a "you may" sentence with its follower also follows a plain instruction after ", then" (Clause.commaThen)
      const thenForms = [...(cur.leadThen === true ? ['. then '] : []), ...(cur.commaThen === true && !prev.standalone && prev.closesScope !== true ? ['. then ', ', then '] : [])];
      // std-mkm (CR 608.2c): "then" only orders the instructions, so the sentence after one that stands alone may also begin with it ("Each player who controls the
      // most creatures investigates. Then destroy all creatures."); never after a "you may" sentence (prev.closesScope), as above. Cloud std-woe's "Then" after a manual
      // step ("... Then shuffle.", family then-after-manual) is one case of it: a manual step stands alone
      // pc-counters-4 (CR 608.2c): ... and after a "you may" sentence too ("You may put two +1/+1 counters on a creature you control. Then all creatures get -4/-4 until end of turn.", Finality):
      // "then" orders the instructions only, what follows a may is still not inside it
      thenForms.push('. then ');
      // p2-refs-2 (CR 608.2d, 608.2c; family may-then-may): a "you may" sentence followed by another "you may" of the same player is also one sentence with ", then"
      // ("You may tap or untap target permanent, then you may tap or untap another target permanent."): each choice is still its own, made in that order
      if (prev.closesScope === true && prev.actor === 'you' && cur.actor === 'you' && /^you may /.test(fragment(prev)) && /^you may /.test(fragment(cur))) thenForms.push(', then ');
      sep = alt('. ', ...new Set(thenForms));
    }
    // CLOUD std-dft (family serial-comma-after-reveal): a clause that is itself two instructions ("search ... for a card, reveal it") is followed with the serial comma
    else if (o.nested === true) {
      // r3-refs (family delayed-trigger-sentences): the instructions of an event-timed delayed trigger may also be sentences of their own (JoinOpts.sentences)
      const own = o.sentences === true ? ['. ', '. then '] : [];
      if (items.length === 2) sep = alt(' and ', ', then ', ', ', ...(prev.serial === true ? [', and '] : []), ...own);
      else sep = i === items.length - 1 ? alt(', then ', ', and ', ' and ', ', ', ', and then ', ...own) : alt(', ', ', then ', ' and ', ...own);
    }
    // FAST5 T65: the last of three or more steps is also joined with the serial comma, "sacrifice it, draw a card, and put a +1/+1 counter on each creature you control"
    else sep = (items.length >= 3 && i === items.length - 1) || prev.serial === true ? alt('. ', ' and ', ', then ', ', ', '. then ', ', and ') : alt('. ', ' and ', ', then ', ', ', '. then ');
    // FAST5X E3: a sentence that ends with a quoted ability ends inside its quotes ('... with "Flying." Draw a card.'): the next one follows after a space
    const strict = prev.standalone || cur.standalone || prev.closesScope === true || o.nested === true;
    const quoteSep = strict && cur.leadThen !== true ? ' ' : alt(' ', ' then ');
    const ends = quoteEnds(out);
    if (ends === 'all') sep = quoteSep;
    else if (ends === 'some') {
      // FAST5 T41: only some readings end inside the quotes ("... gains \"...\" until end of turn" against "Until end of turn, ... gains \"...\""): each reading
      // is followed by its own separator
      out = mapEnds(out, (lit) => lit + (QUOTE_END.test(lit) ? quoteSep : sep)) + text(cur);
      continue;
    }
    const loose = o.actor === undefined && !prev.standalone && !cur.standalone && prev.closesScope !== true && cur.breakBefore !== true;
    // the same player doing two things in a row: "Target player draws a card and loses 1 life"
    if (loose && prev.actor !== null && prev.actor !== 'you' && cur.actor === prev.actor && cur.pred !== undefined) {
      // FAST4 T26: the last of three or more with the serial comma, "discards a card, loses 2 life, and exiles ..."
      out += alt(alt(' and ', ', then ', ', ', ', and ') + cur.pred, sep + text(cur));
      continue;
    }
    // another player doing the second thing, and it is "you": "Target player loses 1 life and you gain 1 life"
    if (loose && prev.actor !== null && prev.actor !== 'you' && cur.actor === 'you') {
      out += alt(' and ' + cur.sub, sep + text(cur));
      continue;
    }

    // r4-repl (Clause.joined): after a plain clause, a standalone clause that begins with a plain instruction is also joined like one
    if (cur.joined !== undefined && !prev.standalone && prev.closesScope !== true && o.nested !== true && ends === 'none') {
      const plainSep = (items.length >= 3 && i === items.length - 1) || prev.serial === true ? alt(' and ', ', then ', ', ', ', and ') : alt(' and ', ', then ', ', ');
      out += alt(sep + text(cur), plainSep + cur.joined);
      continue;
    }
    out += sep + text(cur);
  }
  return out;
}
