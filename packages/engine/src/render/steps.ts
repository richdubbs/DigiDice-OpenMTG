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
import { COST_SELF, COST_SELF_MOVED } from './costs';
import { actsOnlyOnNamed } from '../model/cost-antecedent';
import { foldAt } from './fold';
import { foldEdhZones25 } from './fold-edhzones25';
import { foldEdhN72 } from './fold-edhn72'; // edh-next-72
import { foldEdhN83 } from './fold-edhn83'; // edh-next-83
import { K, type JoinOpts } from './kernel';
import { CLAUSES_CARDS } from './steps-cards';
import { CLAUSES_FLOW, payGuardInside, withAlso } from './steps-flow';
import { CLAUSES_LASTING } from './steps-lasting';
import { CLAUSES_LIFE } from './steps-life';
import { CLAUSES_ZONES, copyNewTargets, noRegeneration } from './steps-zones';
import type { StepOf } from './steps-util';
import { CLAUSES_R3MECH } from './steps-r3mech';
import { CLAUSES_STDR10 } from './steps-stdr10';
import { CLAUSES_EDHV84 } from './steps-edhv84';
import { CLAUSES_EDHN131 } from './steps-edhn131';
import { focusEffect, damagedGroup, grantedGroup, keepsFocus, shufflesYourLibrary, keptFocus, notPutMove, notPutZone } from '../model/focus';
import { antecedentIds } from './refs';
import { cloneState, objKey, type RenderState } from './state';
import { withFaceDownSet } from './steps-edhmk12';
import { alt, ALT_CLOSE, ALT_OPEN, ALT_SEP, mapEnds, NoRenderer, numWord, parseMarked, type MarkedNode } from './text';

/** Step lists inside step lists (a `pay` inside a `may` inside an `if` ...). Pay clauses print every branch once per reading, so the text grows with each level. */
const MAX_STEP_NESTING = 6;

export type ClauseFn = (step: never, st: RenderState) => Clause;

/** One clause function per op. An op missing here is not renderable (and so not a capability: design 5.2). */
const CLAUSES_BASE: Readonly<Partial<Record<EffectOp, ClauseFn>>> = {
  ...CLAUSES_FLOW,
  ...CLAUSES_LIFE,
  ...CLAUSES_CARDS,
  ...CLAUSES_ZONES,
  ...CLAUSES_LASTING,
  ...CLAUSES_R3MECH, // cloud r3-mech: fromOutside
  ...CLAUSES_STDR10, // Standard round 10: nextSpell
  ...CLAUSES_EDHV84, // edh-c-84: balance
  ...CLAUSES_EDHN131, // edh-next-131: discardOrSacrifice
};

type MoveStep = Extract<EffectStep, { op: 'move' }>;
type FaceStep = Extract<EffectStep, { op: 'changeFace' }>;
export const CLAUSES: Readonly<Partial<Record<EffectOp, ClauseFn>>> = {
  ...CLAUSES_BASE,
  // edh-mana-keywords-12 (CR 708.2a): the sentence of the set characteristics of a face-down permanent
  move: withFaceDownSet<MoveStep>(CLAUSES_BASE.move as unknown as (s: MoveStep, st: RenderState) => Clause, (s) => s.to.faceDownAs, (s) => { const { faceDownAs: _a, ...to } = s.to; return { ...s, to }; }, (s) => s.to.faceDown === true && s.to.zone === 'battlefield', (s) => s.what) as unknown as ClauseFn,
  changeFace: withFaceDownSet<FaceStep>(CLAUSES_BASE.changeFace as unknown as (s: FaceStep, st: RenderState) => Clause, (s) => s.faceDownAs, (s) => { const { faceDownAs: _a, ...rest } = s; return rest; }, (s) => s.to === 'faceDown' && s.manifest !== true, (s) => s.what) as unknown as ClauseFn,
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
  let upToOne = false; // edh-players-10: the spec is "up to one target" for each opponent
  let eachGraveyard: string | null = null; // edh-next-127: "for each graveyard with an instant or sorcery card in it,"
  const per = [...PER_PLAYER_KEYS.map((k) => rec[k]), ...effects].flatMap((v) => {
    const r = v as { ref?: string; id?: string } | undefined;
    const spec = r?.ref === 'target' && r.id !== undefined && !st.mentioned.has(`t:${r.id}`) ? st.specs.get(r.id) : undefined;
    if (spec?.perOpponent === true && spec.min === 0 && spec.max === 1) upToOne = true;
    // edh-next-127 (CR 115.1, 404.1; Mysterious Stranger): one target in each graveyard that has a card of the description (`eachWithOne`): the lead names those graveyards
    if (spec?.perPlayer === true && spec.eachWithOne === true && spec.kind === 'object' && spec.filter?.zone === 'graveyard') eachGraveyard = K.np(spec.filter, cloneState(st), { det: 'a', noZone: true });
    return spec?.perOpponent === true ? ['opponent'] : spec?.perPlayer === true ? ['player'] : [];
  })[0];
  if (per === undefined) return null;
  if (eachGraveyard !== null) return `for each graveyard with ${eachGraveyard as string} in it, `;
  // edh-d-96 (CR 601.2c, 122.1f; Geth's Summons): only the opponents with N or more poison counters as the spell is cast, "for each opponent who has three or more poison counters as you cast ~,"
  const poison = [...PER_PLAYER_KEYS.map((k) => rec[k])].map((v) => { const r = v as { ref?: string; id?: string } | undefined; return r?.ref === 'target' && r.id !== undefined ? st.specs.get(r.id)?.perOpponentPoison : undefined; }).find((x) => x !== undefined);
  if (poison !== undefined) return `for each opponent who has ${numWord(poison)} or more poison counters as you cast ${K.obj({ ref: 'self' }, cloneState(st), 'object').text}, `;
  // r5-refs (family each-other-player-opponent; CR 102.3): with no teams every other player is an opponent, so Oracle may say "for each other player," too (merge wave 8:
  // moved here from render/steps-zones.ts with r5-fxb's lead)
  // edh-players-10 (CR 115.1, 601.2c; Windgrace's Judgment): the caster may choose any number of the opponents, a target for each: "for any number of opponents, destroy target ..."
  return per === 'opponent' ? `${upToOne ? alt('for each opponent', 'for each other player', 'for any number of opponents') : alt('for each opponent', 'for each other player')}, ` : `for each ${per}, `;
}
/** The lead is already said: plain, or as the alternatives above (merge wave 8: also "for each other player,"). */
const LEAD_SAID = new RegExp(`^\\W*for (?:each (?:opponent|player|other player|graveyard with [^,]* in it)|any number of opponents)(?:,|${ALT_SEP})`); // edh-next-127: the graveyard lead
function withLead(lead: string | null, c: Clause): Clause {
  if (lead === null || c.empty || LEAD_SAID.test(c.sub)) return c;
  return { ...c, imp: `${lead}${c.imp}`, sub: `${lead}${c.sub}`, ...(c.have !== undefined ? { have: `${lead}${c.have}` } : {}) };
}

/** pc-players-3: "they control a commander" for a guard `not exists (a description the recipient controls)` on a step that hurts that recipient (template eff.pcp3.damage.unlessTheyControl). */
function unlessTheyControl(step: EffectStep, st: RenderState): string | null {
  const g = step.guard;
  // edh-c-18 (CR 608.2c, 402.1; Skullcage; template eff.edhv18.damage.unlessTheyHaveExactlyEither): "unless they have exactly three or exactly four cards in hand": the recipient's hand size is neither number
  if (g?.cond === 'not' && g.of.cond === 'any' && g.of.of.length === 2 && step.op === 'damage' && step.to.ref !== 'each' && step.to.ref !== 'eachWho' && step.to.ref !== 'controlsMost' && step.to.ref !== 'controlsAny' && step.to.ref !== 'attackedBySource') {
    const sizes = g.of.of.map((c) => (c.cond === 'compare' && c.op === '==' && typeof c.right === 'number' && typeof c.left === 'object' && c.left.q === 'zoneSize' && c.left.zone === 'hand' && JSON.stringify(c.left.of) === JSON.stringify(step.to) ? c.right : null));
    if (sizes[0] === null || sizes[1] === null || sizes[0] === undefined || sizes[1] === undefined) return null;
    return `they have exactly ${sizes[0]} or exactly ${sizes[1]} cards in hand`;
  }
  if (g?.cond !== 'not' || g.of.cond !== 'exists' || g.of.of.ref !== 'each') return null;
  // edh-c-26 (CR 608.2c, 109.4; template eff.edhv26.damage.unlessTheyControlNOrMore): "unless they control two or more basic lands" (a count of 2 or more; no new alt site)
  const atLeast = g.of.atLeast;
  if (atLeast !== undefined && (typeof atLeast !== 'number' || atLeast < 2)) return null;
  const f = g.of.of.filter;
  const kinds = f.anyOf;
  if (kinds?.length !== 1 || Object.keys(f).length !== 2 || step.op !== 'damage' || JSON.stringify(f.controller) !== JSON.stringify(step.to)) return null;
  if (step.to.ref === 'each' || step.to.ref === 'eachWho' || step.to.ref === 'controlsMost' || step.to.ref === 'controlsAny' || step.to.ref === 'attackedBySource') return null; // a group is judged player by player; the guard is one check for the step
  if (atLeast !== undefined) return `they control ${atLeast} or more ${K.np(kinds[0]!, cloneState(st), { det: 'none', plural: true })}`;
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
  const run = (): Clause => {
    let c = withLead(lead, (fn as (s: EffectStep, st: RenderState) => Clause)(step, st));
    // edh-top-16 (CR 107.3, 706.2, 115.1; Ancient Brass Dragon): "put any number of target creature cards with total mana value X or less from graveyards onto the battlefield under your control, where X is the result":
    // a limit on the group of targets that reads the die result is also said with X, defined at the end of the sentence
    if (step.op === 'move' && step.what.ref === 'target') {
      const lim = st.specs.get(step.what.id)?.groupLimit;
      if (lim !== undefined && typeof lim.cmp.value === 'object' && lim.cmp.value.q === 'dieResult' && lim.cmp.op === '<=') {
        // (the die result is said as a group of alternatives, "the result" among them)
        const limitX = new RegExp(`total mana value ${ALT_OPEN}[^${ALT_CLOSE}]*?the result[^${ALT_CLOSE}]*${ALT_CLOSE} or less`, 'g');
        const withX = (x: string): string => `${x.replace(limitX, 'total mana value X or less')}, where X is the result`;
        c = { ...c, imp: alt(c.imp, withX(c.imp)), sub: alt(c.sub, withX(c.sub)) };
      }
    }
    // edh-perms-6 (CR 111.1, 707.9, 608.2c): a named token creation or token copy answers "if you didn't create a token this way" (render/cond.ts)
    if ((step.op === 'createToken' || (step.op === 'copy' && step.result === 'token')) && step.as !== undefined) st.info.set(`r:${step.as}`, { ...(st.info.get(`r:${step.as}`) ?? { nouns: ['token'], plural: false }), tokenMade: true });
    // edh-next-142 (CR 701.20a, 608.2c; Omnath, Locus of All): a named option that is one reveal answers "if you don't reveal it" (render/cond.ts)
    if (step.op === 'may' && step.as !== undefined && step.do.length === 1 && step.do[0]!.op === 'reveal') st.info.set(`r:${step.as}`, { ...(st.info.get(`r:${step.as}`) ?? { nouns: [], plural: false }), revealMade: true });
    // edh-top-9 (CR 701.12a, 608.2c; Gilded Drake): a named exchange answers "if you don't or can't make an exchange" (render/cond.ts)
    if (step.op === 'exchange' && step.as !== undefined) st.info.set(`r:${step.as}`, { ...(st.info.get(`r:${step.as}`) ?? { nouns: [], plural: false }), exchanged: true });
    return c;
  };
  if (step.guard === undefined || isImpliedGuard(step.guard, st, step)) return run();
  // edh-perms-6 (CR 118.12, 608.2c; Springheart Nantuko): a guarded payment of yours with an "If you do" branch says its condition right after the cost, "you may pay {1}{G} if C. If you
  // do, ...", not after the branch (render/steps-flow.ts#payClause)
  if (step.op === 'pay' && payGuardInside(step)) return run();
  // Standard round 3, r3-trig (CR 707.10c, 608.2c): a guarded spell copy that lets its controller choose new targets says the guard before the new-targets words:
  // "copy it if you gained life this turn. You may choose new targets for the copy." (render/steps-zones.ts#copyNewTargets)
  if (step.op === 'copy' && step.result === 'spell' && copyNewTargets(step, st) !== '') {
    const { newTargets: _newTargets, ...bare } = step;
    st.afterTrigger = afterTrigger;
    const c = clause(bare as EffectStep, st);
    const nt = copyNewTargets(step, st);
    return { ...c, imp: c.imp + nt, sub: c.sub + nt, standalone: true };
  }
  // r4-dig (CR 701.8a, 608.2c): "Mill two cards, then destroy the chosen permanent if its mana value is less than or equal to the number of cards in your
  // graveyard." (Quag Feast): a guarded destroy is also said with the instruction first, so it names the object and the condition says "its", and it joins the
  // instruction before it (", then"); read on the state before either is said
  // std-rx22 (CR 701.6a, 608.2c): and a guarded counter, "Counter target spell if it's blue." (Pyroblast, Hydroblast; family stdrx22-guarded-counter-after)
  // edh-perms-14 (CR 122.1, 608.2c; Ancient Animus): and a guarded counter put on a target, "Put a +1/+1 counter on target creature you control if it's legendary."
  // edh-zones-15 (CR 701.13a, 608.2c; template eff.edhz15.exile.if, Titan's Presence): and a guarded exile of a bare object description, "Exile target creature if its power is ..."
  // edh-c-14 (CR 608.2c, 613.4c; Savage Swipe): and a guarded pump of a target, "Target creature you control gets +2/+2 until end of turn if its power is 2."
  const pumpsTarget = step.op === 'effect' && step.effects.length === 1 && step.effects[0]!.s === 'continuous' && (step.effects[0] as { affects: { ref: string } }).affects.ref === 'target';
  const first = (step.op === 'destroy' || step.op === 'counter' || pumpsTarget || (step.op === 'putCounters' && step.on.ref === 'target') || (step.op === 'move' && step.to.zone === 'exile' && Object.keys(step.to).length === 1) || (step.op === 'move' && step.to.zone === 'battlefield' && step.what.ref === 'target' /* edh-c-78 (Agadeem Occultist) */)) && !afterTrigger ? cloneState(st) : null;
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
    // edh-c-113 (CR 608.2c; the parser's rule, parser/lower/anaphora.ts, "it" in the step's own guard; Hog-Monkey Rampage): in the condition after the instruction, the object the instruction
    // worked on is "it" even when another object of the same kind was named before ("Put a +1/+1 counter on the creature you control if it has power 4 or greater")
    const body0 = fragment((fn as (s: EffectStep, st: RenderState) => Clause)(plainStep, first));
    const fk = step.op === 'putCounters' ? focusAfter((({ guard: _guard, ...rest }) => rest)(step) as EffectStep) : undefined; // (a guarded instruction has no focus of its own; this one is about its own condition)
    if (fk !== undefined) { first.focus = fk; first.focusSeen = antecedentIds(first); }
    const trailing0 = `${body0} if ${K.cond(step.guard, first)}`;
    const trailing = noRegen ? `${trailing0}. ${noRegeneration(step as StepOf<'destroy'>, first)}` : trailing0;
    const both = alt(text, trailing);
    return { imp: both, sub: both, actor: null, leadThen: true };
  }
  // FAST5X E17 (CR 608.2c): a guarded instruction after another may begin "Then" ("Then draw a card if this is the second time ..."), as an `if` step does
  return { imp: text, sub: text, actor: null, standalone: true, ...(afterTrigger ? {} : { leadThen: true }) };
}

/**
 * edh-c-98 (CR 608.2c, 400.7; Hikari): "You may exile ~. If you do, return it to the battlefield ...": the card the option moved (named by the move's `as`) is what the
 * next sentence's bare "it" means, as for a name an instruction bound before (keptFocus). Only a `may` (no `otherwise`) whose last instruction is the move of the object
 * itself; the key of that name, or undefined.
 */
function selfMovedInMay(step: EffectStep): string | undefined {
  const r = step as unknown as Record<string, unknown>;
  if (r['op'] !== 'may' || r['otherwise'] !== undefined || r['guard'] !== undefined || !Array.isArray(r['do']) || r['do'].length !== 1) return undefined;
  const m = r['do'][0] as Record<string, unknown>;
  const what = m['what'] as Record<string, unknown> | undefined;
  if (m['op'] !== 'move' || m['guard'] !== undefined || typeof m['as'] !== 'string' || what === undefined || what['ref'] !== 'self') return undefined;
  return `b:${m['as']}`;
}

/**
 * FAST5 T76 (CR 608.2c; the parser's rule, parser/lower/anaphora.ts#focusAt, model/focus.ts): the key of the object the discourse is focused on after `step`: the token it
 * created (named by its `as`) or the one named object it worked on; undefined otherwise.
 */
function focusAfter(step: EffectStep): string | undefined {
  const fx = focusEffect(step) ?? keptFocus(step); // Cloud std-fin: a name the last instruction of an `if` / a `may` worked on (the parser's rule, anaphora.ts#focusAt)
  if (fx === null) return selfMovedInMay(step); // edh-c-98: "You may exile ~. If you do, return it ..."
  
  if (fx.kind === 'makes') {
    const as = (step as unknown as Record<string, unknown>)['as'];
    return typeof as === 'string' ? `b:${as}` : undefined;
  }
  return objKey(fx.on as never) ?? undefined;
}

/**
 * edh-next-133 (CR 608.2c; The Flood of Mars: "Put a flood counter on another target creature or land. If it's a creature, it becomes a copy of ~. If it's a land, it becomes an Island ..."): an
 * `if` whose condition tests the object in focus ("if it's a creature", no `else`, no guard) leaves the discourse on that object, so the next sentence's "if it's a land" is about it too (the
 * parser reads it so: its condition subject, parser/lower/anaphora.ts#condSubject). Any other instruction decides the focus as before (focusAfter).
 */
function testsFocus(step: EffectStep, focus: string | undefined): boolean {
  if (focus === undefined || step.op !== 'if' || step.else !== undefined || (step as { guard?: unknown }).guard !== undefined) return false;
  return step.cond.cond === 'matches' && objKey(step.cond.object as never) === focus;
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
    // edh-next-37 (render/cond.ts#revealedOrControlledPhrase): "you revealed a Dragon card or controlled a Dragon as you cast ~" says the object by its name, "~", as the "as you cast" conditions do
    if (n['cond'] === 'any' && Array.isArray(n['of']) && n['of'].length === 2 && JSON.stringify(n['of'][0]) === '{"cond":"wasCast","kicked":"additional"}' && (n['of'][1] as { cond?: string }).cond === 'asCast') return;
    if (n['cond'] === 'wasCast' && n['kicked'] !== 'gift' && n['kicked'] !== 'collectEvidence') { found = true; return; } // (render/cond.ts#wasCastPhrase: these two never say the object)
    Object.values(n).forEach(walk);
  };
  walk([(step as unknown as Record<string, unknown>)['guard'], (step as unknown as Record<string, unknown>)['cond']]);
  return found;
}

/** `foldAt`, after the folds of edh-zones-25 that print other steps through `clause` (they take it as a parameter: render/fold.ts is imported here, not the other way). */
const foldHere = (list: EffectStep[], i: number, st: RenderState): ReturnType<typeof foldAt> => foldEdhZones25(list, i, st, { foldAt, clause, clausesOf }) ?? foldEdhN72(list, i, st, { foldAt, clause, clausesOf }) /* edh-next-72 */ ?? foldEdhN83(list, i) /* edh-next-83 */ ?? foldAt(list, i, st);

/** The clauses of a list of steps after folding. */
function clausesOf(list: EffectStep[], st: RenderState): Clause[] {
  const items: Clause[] = [];
  const inheritedSeen = st.focusSeen;
  const inherited = st.focus; // the focus of an enclosing list stays for the first instruction of this one ("... at the beginning of the next end step, sacrifice it")
  let focus = inherited;
  for (let i = 0, done = 0; i < list.length; ) {
    if (i > 0 && st.chosen?.list === list) delete st.chosen; // Cloud std-eoe: the chosen target is the focus of the first instruction only (state.ts#chosen)
    for (; done < i; done++) if (!keepsFocus(list[done]) && !shufflesYourLibrary(list[done]) && !testsFocus(list[done]!, focus)) focus = focusAfter(list[done]!); // std-promote-4: "You get {E}{E}" keeps it (model/focus.ts#keepsFocus)
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
      const probe = foldHere(list, i, cloneState(st)); // a fold prints several steps as one clause: every one of them must qualify
      if (!list.slice(i, i + (probe?.consumed ?? 1)).every((x) => actsOnlyOnNamed(x, !st.mentioned.has(COST_SELF_MOVED)))) st.mentioned.delete(COST_SELF);
    }
    const folded = foldHere(list, i, st);
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
    else { const hurt = damagedGroup(list[i]); if (hurt !== null) st.group = JSON.stringify(hurt['filter']); } // edh-next-31: the group a damage step dealt damage to is "those creatures" next
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
  // edh-zones-6: a closing quote that is a literal of its own after a group of readings ('with "', {readings}, '"') ends each reading's sentence inside the quote: the
  // literal before it is read with the quote as its suffix
  const walk = (nodes: MarkedNode[], suffix = ''): void => {
    const last = nodes[nodes.length - 1];
    if (last === undefined) return;
    if (typeof last === 'string') {
      if (nodes.length > 1 && /^['"”]+$/.test(last)) walk(nodes.slice(0, -1), last + suffix);
      else seen.add(QUOTE_END.test(last + suffix));
    } else for (const a of last.alts) walk(a, suffix);
  };
  walk(parseMarked(marked));
  return seen.size === 2 ? 'some' : seen.has(true) ? 'all' : 'none';
}

function joined(list: EffectStep[], st: RenderState, o: JoinOpts): string {
  const items = clausesOf(list, st);
  if (items.length === 0) return '';
  const text = (c: Clause): string => (o.actor !== undefined ? within(c, o.actor) : fragment(c));
  // edh-d-95 (CR 109.5, 608.2c; family imperative-or-you, Rocco, Street Chef): the first instruction, a plain one the controller does that Oracle also says with its subject after another
  // player's clause (Clause.andYou: "put a +1/+1 counter on target creature"), is also said with "you" when it opens the instructions ("you put a +1/+1 counter on target creature and
  // create a Food token"): the controller is the default subject
  const first = items[0]!;
  let out = o.actor === undefined && first.actor === null && first.andYou !== undefined && !first.standalone ? alt(text(first), `you ${first.andYou}`) : text(first);
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
      if (prev.closesScope === true && prev.actor === 'you' && cur.actor === 'you' && /^you may /.test(fragment(prev)) && /^you may /.test(fragment(cur))) thenForms.push(', then ', ', and ' /* edh-d-3 (Talus Paladin): "you may have Allies you control gain lifelink until end of turn, and you may put a +1/+1 counter on ~" */);
      // edh-players-11 (CR 608.2c; family may-group-then): the `may` of a group of players whose doers the next instruction names is also followed by ", then" ("Each player may draw a card, then each player who drew a card this way gains 1 life")
      if (prev.thenGroup === true) thenForms.push(', then ');
      // edh-players-14 (CR 608.2c, 701.9a; family discard-then-who-didnt): "each opponent discards a card, then each opponent who didn't discard a nonland card this way loses 3 life"
      if (cur.commaThenWho === true) thenForms.push(', then ');
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
    else sep = (items.length >= 3 && i === items.length - 1) || prev.serial === true ? alt('. ', ' and ', ', then ', ', ', '. then ', ', and ') : alt('. ', ' and ', ', then ', ', ', '. then ', ', and ');
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
      out += alt(alt(' and ', ', then ', ', ', ', and ') + cur.pred, sep + text(cur), ...(cur.predThey !== undefined ? [' and ' + cur.predThey] : [])); // edhd36: "they tap all lands they control and lose all unspent mana"
      continue;
    }
    // edh-zones-1 (family and-you-plain-clause): a plain instruction after another player's clause is the controller's, "Target player discards a card and you untap all lands you control"
    if (loose && prev.actor !== null && prev.actor !== 'you' && cur.actor === null && cur.andYou !== undefined) {
      out += alt(` and you ${cur.andYou}`, sep + text(cur));
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
