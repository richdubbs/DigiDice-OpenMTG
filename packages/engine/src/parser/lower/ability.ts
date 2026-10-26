/**
 * The ability driver: one segmented ability (parser/segment.ts) to `AbilityDef`s, through the chart (lower/units.ts), the lowering passes (lower/index.ts)
 * and the taint pass (parser/taint.ts). Owner: WP17.
 *
 * Shapes (design 6.2 table, 6.6 "where manual nodes go"):
 *   keyword      each item of the line through the `ability` templates (CR 702); an item that does not parse is a manual static ability
 *   spell        every effect line of the face is ONE SpellAbilityDef (CR 113.3a, 608.2)
 *   activated    "[cost]: [effect]" (CR 602.1); the cost is parsed part by part, a part that does not parse is a manual cost part (design 6.6, CR 602.2b:
 *                the controller confirms it; declining cancels the activation, CR 733.1); a mana ability is decided from the shape of the ability, not from
 *                what was automated (CR 605.1a: no target, could add mana, not loyalty), and one whose effect or cost is not fully automated is a manual
 *                ability with `mana: true` (a mana ability cannot ask, CR 605.3b); every trailing "Activate only ..." / "Activate no more than ..."
 *                sentence is a restriction (EBNF ActivationLimit, design 6.3): sorcery speed, a limit, or `onlyIf` (`{cond:'ask'}` when the model cannot
 *                state it, CR 602.5b), never an effect sentence
 *   loyalty      "+N: [effect]" (CR 606)
 *   triggered    "[When/Whenever/At] [event], [if condition,] [effect]" (CR 603.1, 603.4); an unparsed trigger clause, intervening "if" or "This ability
 *                triggers only ..." restriction (CR 603.2h) makes the ability a manual triggered ability whose effect is kept when it was understood
 *                ("Trigger now", design 10.1); that effect is lowered with the trigger's roles when the trigger was understood, and with an opaque
 *                trigger otherwise (no pronoun can be resolved), then linted and gated on its own text by lower/verify.ts
 *   static       every sentence through the `static` templates; any sentence that does not parse makes the line a manual static ability (CR 604)
 *   chapter      CR 714.2: a chapter ability with its effect
 *   levelBracket CR 711: the bracket with its abilities
 *   others       (Class levels, Cases, dice tables, Spree, unknown shapes) manual until their structural support exists (design 12.5)
 * Modal abilities (CR 700.2): "Choose one / two / three / one or both / one or more / up to N --" followed by bullets.
 */
import type { AbilityDef, ActivatedAbilityDef, Condition, CostDef, EffectProgram, EffectStep, EventPattern, KeywordAbilityDef, ManualAbilityDef, ObjectFilter, ObjRef, Quantity, StaticAbilityDef, StaticEffect, TriggerDef, TriggeredAbilityDef } from '../../types/ability';
import { TARGETED_PLAYER_LINK } from '../../types/ability';
import { homeZone, offBattlefield } from './trigger-zone';
import { castSelfAutomated, castSelfProgramSafe } from './cast-self';
import type { Diagnostic, LedgerEntry } from '../types';
import type { AbilitySegment, Sentence } from '../segment';
import type { PreprocessedFace } from '../front/types';
import { collapse } from '../front/text';
import { parseManaCost } from '../../types/mana';
import { adaptTokens, canonicalJson, runHole } from '../holes';
import type { Tok } from '../holes/tok';
import type { Discourse, HoleEnv } from '../holes';
import { applyTaint, untaintedProgram } from '../taint';
import { NUMBER_WORDS, type AnaphorInfo } from '../holes/core';
import { castOnly, castSpellMarker, resolveAnaphor, withoutKey } from './anaphora';
import { lowerProgram } from './index';
import { eventMentions, headsOfFilter } from './scope';
import type { Draft, ManualInfo, Mention, ModesDraft, Range, Rec, Unit } from './types';
import type { UnitEnv } from './units';
import { parseEffectUnit, parseWhole, unitDiagnostic } from './units';
import { activationLimits, activationZone, costOf, TIMES, type DriverIO } from './activation';
import { stepsInOrder } from './mentions';
import { abilityLevel, isRec, isStaticEffects, leftoverMarker, rewrite, visit } from './util';
import { resolveFaceChoices } from './links';
import { resolveEntersSelfMarker, resolvePreventedAmount, resolveReplacedAmount, resolveStaticIt } from './static-anaphora';
import { resolveStaticExiledCard } from './p2ep1';
import { EMINENCE_COND } from '../holes/cond';
import type { ZoneName } from '../../types/ability';

/** M11-4 (eminence, CR 113.6b): the zones an ability that says "~ is in the command zone or on the battlefield" functions in. */
const EMINENCE_ZONES: readonly ZoneName[] = ['battlefield', 'command'];

/** LNK1 (CR 607.1): the player another ability of the face targeted, "that player" of this one (FaceInfo.linkedPlayer, Mention.linked). */
const LINKED_PLAYER: Mention = { sort: 'player', number: 'singular', heads: ['player'], ref: { ref: 'linked', link: TARGETED_PLAYER_LINK }, origin: 'event', unit: -1, linked: true };

export interface FaceInfo {
  pre: PreprocessedFace;
  /** Lower-case card types and subtypes of the face ("~" can be called by them). */
  selfHeads: string[];
  /**
   * FAST5 T47 ADDITION (optional): the face has an ability that makes the object a creature ("~ becomes a 2/3 black and red Insect creature until end of turn"):
   * its "other creatures" / "another target creature" can mean "other than this object" although it prints no creature type (lower/targets.ts#otherNotSource).
   */
  animates?: boolean;
  /**
   * FAST3 T18 ADDITION (optional): the additional cost of the spell on this face ("As an additional cost to cast this spell, sacrifice a creature.", CR 601.2b),
   * when it is one cost the parser understood: "the sacrificed creature" of the spell's effect names what it sacrificed (`sacrificedMentions`).
   */
  spellCost?: CostDef;
  /**
   * LNK1 ADDITION (optional): set by parseFace for the ability being lowered when exactly one OTHER ability of the face targets a player (parser/parse.ts#
   * playerLinkable): its "that player" with no antecedent of its own is the player that ability targeted (CR 607.1, `Mention.linked`).
   */
  linkedPlayer?: boolean;
  /**
   * CLOUD C5 ADDITION (optional): set by parseFace for the ability being lowered: the choices the face's OTHER abilities make as the object enters ("As ~ enters,
   * choose a color.", CR 614.12a), read by "the chosen color" / "the chosen type" of this one (CR 607.2d, lower/links.ts#resolveFaceChoices).
   */
  choices?: { link: string; what: string }[];
}

export interface AbilityResult {
  abilities: AbilityDef[];
  /** Ledger claims: ranges consumed by templates and ranges left manual (with the reason). */
  claims: LedgerEntry[];
  diagnostics: Diagnostic[];
  templates: string[];
  experimental: string[];
  /**
   * Per ability (same order): the form the render gate checks, when it differs from the ability: the program BEFORE taint, with every manual sentence a
   * manual step in place (parser/taint.ts#untaintedProgram). Undefined: gate the ability itself.
   */
  gateForms: (AbilityDef | undefined)[];
  /**
   * Per ability (same order): for a manual ability that keeps an understood effect, the Oracle text of that effect alone (lower/verify.ts lints and
   * gates the effect against it before it is handed out, design 6.6) and the trigger it was lowered with, if any.
   */
  kept: (KeptEffect | undefined)[];
  /**
   * WP19 ADDITION (review): per ability (same order), less automated forms of it that parseCard tries in order when the lint or the render gate refuses
   * the ability. Each keeps only parts the gate can still check: (1) the trigger, cost or chapter with the whole effect as ONE manual step that announces
   * no targets (the T2 form of design 6.7); (2) for a triggered ability, the manual triggered ability that keeps the understood effect, exactly as for a
   * trigger clause that is not understood (design 6.6). So a template that adds a reading the renderer cannot print back never takes away what was
   * automated without it (design 6.8 G10).
   */
  fallbacks: (() => Fallback[])[];
  /**
   * T35 ADDITION (optional): per ability (same order), the Oracle line(s) its render gate compares with, when they are not the whole segment's lines (a Station
   * card's threshold rows share the segment with the Station keyword line, CR 721.2: each row is gated against its own line). Undefined: the segment's lines.
   */
  oracles?: (string[] | undefined)[];
}

export interface KeptEffect { lines: string[]; trigger?: TriggerDef }

/** A less automated form of an ability (AbilityResult.fallbacks); `kept` is the text a manual ability's kept effect is gated against. */
export interface Fallback { def: AbilityDef; kept?: KeptEffect }

interface Acc { claims: LedgerEntry[]; diagnostics: Diagnostic[]; templates: string[]; experimental: string[]; untainted: Map<EffectProgram, EffectProgram>; kept: Map<EffectProgram, KeptEffect>; fallbacks: Map<AbilityDef, () => Fallback[]> }

const newAcc = (): Acc => ({ claims: [], diagnostics: [], templates: [], experimental: [], untainted: new Map(), kept: new Map(), fallbacks: new Map() });

/** The Oracle text of the sentences of each built (non-modal) program, joined as the T2 manual step joins them (taint.ts): fallback (1). */
const effectTexts = new WeakMap<EffectProgram, string>();

const FALLBACK_REASON = 'the render gate or the lint refused the understood effect (design 6.6, 6.8 G6): it is one manual step, the rest stays automated';

/** Fallback (1): the same ability with its whole effect as one manual step that announces no targets (design 6.7 T2 form). */
function effectManual(def: AbilityDef): Fallback | null {
  if (def.kind !== 'activated' && def.kind !== 'triggered' && def.kind !== 'chapter') return null;
  // CR 605.3b: a mana ability cannot ask, so one whose effect is not automated is a manual ability (lower/verify.ts#demote keeps `mana`), never this
  // form (the lint refuses it too; this keeps the fallback from being tried at all)
  if (def.kind === 'activated' && def.isMana === true) return null;
  const text = effectTexts.get(def.effect);
  if (text === undefined || def.effect.modes !== undefined) return null;
  // also when taint already made the effect one manual step: the gate then checked the UNTAINTED form, and this form is gated on its own
  return { def: { ...def, effect: { targets: [], steps: [{ op: 'manual', text, reason: FALLBACK_REASON }] } } as AbilityDef };
}
const norms = (t: readonly Tok[]): string => t.map((x) => x.norm).join(' ');
const span = (t: readonly Tok[]): Range => (t.length === 0 ? [0, 0] : [t[0]!.start, t[t.length - 1]!.end]);
const textAt = (face: FaceInfo, r: Range): string => collapse(face.pre.parse, [r], ' ');

function use(acc: Acc, templates: readonly string[], experimental: readonly string[]): void {
  for (const t of templates) if (!acc.templates.includes(t)) acc.templates.push(t);
  for (const t of experimental) if (!acc.experimental.includes(t)) acc.experimental.push(t);
}

function claim(acc: Acc, range: Range, status: 'consumed' | 'manual', by?: string, reason?: string): void {
  if (range[0] >= range[1]) return;
  acc.claims.push({ range, status, ...(by !== undefined ? { by } : {}), ...(reason !== undefined ? { reason } : {}) });
}

function manualAbility(seg: AbilitySegment, shape: ManualAbilityDef['shape'], reason: string, extra: Partial<ManualAbilityDef> = {}): ManualAbilityDef {
  return { kind: 'manual', text: seg.text, src: [...seg.lines], prov: { by: 'fallback' }, reason, shape, ...extra };
}

// ---------------------------------------------------------------------------
// effect programs
// ---------------------------------------------------------------------------

interface ProgramPiece { tokens: Tok[] }

/**
 * p2-c-dieroll-1 (CR 706.3a): the result rows of the ability being lowered by rollTableAbilities, each with its sentences; buildProgram lowers them after the
 * ability's own sentences. Undefined outside rollTableAbilities.
 */
let ROLL_ROWS: { min: number; max: number; pieces: Tok[][] }[] | undefined;

/**
 * FAST5 T75: the groups of cards the sentences `before` made, as the pronoun holes `Seen` and `Milled` need them (holes/core.ts#Discourse): a mill step anywhere in them, a
 * look at or a reveal of cards anywhere in them. Read from the steps the chart built (before lowering), so it is a fact of the words, not of a binding.
 */
function discourseOf(before: readonly Unit[]): Discourse {
  let milled = false;
  let seen = false;
  let chose = false;
  for (const u of before) {
    visit(u.steps, (n) => {
      if (n['op'] === 'mill') milled = true;
      if (n['op'] === 'look' || n['op'] === 'reveal') seen = true;
      if (n['lower'] === 'chooseTargets') chose = true; // r3-choose: "Choose target opponent." (the chart's node, lower/choose.ts removes it later)
    });
  }
  return { milled, seen, ...(chose ? { chose } : {}) };
}

/** "Choose one --" and friends (CR 700.2); null when the header is not one the model can state. */
function modalHeader(tokens: readonly Tok[], options: number): { min: number; max: number; unchosen?: 'object' | 'turn'; random?: true } | null {
  return modalHeaderWords(norms(tokens), options);
}

/** modalHeader over the header's normalized words (p2-modal-1: differentPlayerHeader reads the counts of a header ended with a full stop through it). */
function modalHeaderWords(words: string, options: number): { min: number; max: number; unchosen?: 'object' | 'turn'; random?: true } | null {
  const w = words.replace(/ \.$/, '');
  // p2-modal-2 (CR 700.2): "choose one at random --": one of the modes, picked at random (`ModeSpec.random`)
  if (w === 'choose one at random --') return options >= 2 ? { min: 1, max: 1, random: true } : null;
  // r3-choose (CR 700.2, 603.3c): "choose one that hasn't been chosen --" (a mode the ability of this object never had chosen) and "... this turn --" (`ModeSpec.unchosen`)
  // r4-cost (CR 700.2): Oracle also ends that header with a full stop before its bullets ("choose one that hasn't been chosen this turn.")
  const u = /^choose one that hasn't been chosen( this turn)?( --)?$/.exec(w);
  if (u !== null) return options >= 2 ? { min: 1, max: 1, unchosen: u[1] !== undefined ? 'turn' : 'object' } : null;
  const m = /^choose (one|two|three|four|one or both|one or more|up to one|up to two|up to three) --$/.exec(w);
  if (m === null) return null;
  const n: Record<string, [number, number]> = { one: [1, 1], two: [2, 2], three: [3, 3], four: [4, 4], 'one or both': [1, 2], 'one or more': [1, options], 'up to one': [0, 1], 'up to two': [0, 2], 'up to three': [0, 3] };
  const [min, max] = n[m[1]!]!;
  return max > options ? null : { min, max };
}

/**
 * r3-choose (CR 700.2): "choose one that hasn't been chosen [this turn] and <instruction> --": the header's words up to "and", and the instruction as a sentence of its own
 * (its last token, the dash, read as the sentence's full stop). Null for any other header, or one without an instruction after "and".
 */
function unchosenAnd(tokens: readonly Tok[], options: number): { head: Tok[]; rest: Tok[]; unchosen: 'object' | 'turn' } | null {
  const words = tokens.map((t) => t.norm);
  const lead = ['choose', 'one', 'that', "hasn't", 'been', 'chosen'];
  if (options < 2 || lead.some((w, i) => words[i] !== w)) return null;
  const turn = words[6] === 'this' && words[7] === 'turn';
  const and = turn ? 8 : 6;
  const dash = tokens[tokens.length - 1];
  if (words[and] !== 'and' || dash === undefined || dash.kind !== 'PUNCT' || dash.norm !== '--' || tokens.length - 1 <= and + 1) return null;
  const stop: Tok = { ...dash, text: '.', norm: '.' };
  return { head: tokens.slice(0, and + 1), rest: [...tokens.slice(and + 1, -1), stop], unchosen: turn ? 'turn' : 'object' };
}

/** r5-cost (CR 603.12, 700.2): the counts of "when you do , choose one --" (the modal header of a reflexive trigger), or null. */
function reflexiveHeader(tokens: readonly Tok[], options: number): { min: number; max: number; thatMany?: true } | null {
  const words = tokens.map((t) => t.norm);
  if (words[0] !== 'when' || words[1] !== 'you' || words[2] !== 'do' || words[3] !== ',') return null;
  // std-combat-2 (CR 603.12, 700.2, 608.2h): "you may pay {1} up to three times. When you do, choose up to that many --": none up to the number of times paid
  // (reflexiveModes makes `max` that count, and insists on a payment of a chosen number of times)
  if (words.slice(4).join(' ') === 'choose up to that many --') return { min: 0, max: options, thatMany: true };
  const head = modalHeader(tokens.slice(4), options);
  return head === null || head.unchosen !== undefined || head.random === true ? null : { min: head.min, max: head.max }; // p2-modal-2: no random reflexive modes
}

/** r3-choose (CR 700.2, 107.3a): the quantity of "choose up to x , where x is <quantity> --" (one reading, nothing left to resolve), or null. */
function whereXModes(tokens: readonly Tok[], env: HoleEnv): Quantity | null {
  const words = tokens.map((t) => t.norm);
  const lead = ['choose', 'up', 'to', 'x', ',', 'where', 'x', 'is'];
  const dash = tokens[tokens.length - 1];
  if (lead.some((w, i) => words[i] !== w) || dash?.kind !== 'PUNCT' || dash.norm !== '--' || tokens.length <= lead.length + 1) return null;
  const q = tokens.slice(lead.length, -1);
  const readings = new Map<string, Quantity>();
  for (const a of runHole('Qty', q, 0, env)) if (a.end === q.length) readings.set(canonicalJson(a.value), a.value as Quantity);
  const only = readings.size === 1 ? [...readings.values()][0]! : null;
  // Standard round 3, r3-trig: a `$spell` marker (the spell of a cast trigger, "the number of times you chose a mode for that spell") is resolved by the caller,
  // lower/ability.ts#castSpellModes; any other marker has no reading here
  return only === null || typeof only === 'number' || JSON.stringify(withoutKey(only as unknown as Rec, '$spell')).includes('"$') ? null : only;
}

/**
 * Standard round 3, r3-trig (CR 700.2, 603.3c, 601.2b): the calculated number of modes of a triggered ability may read the spell of its cast trigger ("Whenever you
 * cast a modal spell, choose up to X, where X is the number of times you chose a mode for that spell --"): the `$spell` marker of that quantity names "that spell",
 * which is the triggering spell only when every event of the trigger is a cast (the one spell the event names). Returns the modes without the marker, the modes
 * unchanged when they have none, or null when the marker cannot be resolved (the ability is manual).
 */
function castSpellModes(modes: ModalParts, trigger: TriggerDef): ModalParts | null {
  const q = modes.maxQty as unknown as Rec | undefined;
  if (q === undefined || !isRec(q) || !('$spell' in q)) return modes;
  const s = q['$spell'];
  const that = isRec(s) && isRec(s['$anaphor']) && (s['$anaphor'] as Rec)['text'] === 'that spell';
  if (!that || !castOnly(trigger.on) || trigger.on.length !== 1) return null;
  return { ...modes, maxQty: withoutKey(q, '$spell') as unknown as Quantity };
}

interface Built { program: EffectProgram; understood: boolean; complete: boolean }

/**
 * Lower and taint a program. `understood`: at least one sentence's behavior is automated or a target is announced (otherwise the caller may prefer a
 * manual ability); `complete`: nothing in it is manual.
 */
function buildProgram(pieces: ProgramPiece[], face: FaceInfo, ue: UnitEnv, acc: Acc, extra: { modes?: ModalParts; trigger?: TriggerDef; unknownTrigger?: boolean; condition?: Rec; mentions?: Mention[]; spell?: boolean }): Built {
  let index = 0;
  // FAST5 T75: the pronoun holes read what the sentences before this one (of the same sequence) made (holes/core.ts#Discourse)
  const unitOf = (p: ProgramPiece, before: readonly Unit[]): Unit => {
    const r = span(p.tokens);
    const unit = parseEffectUnit({ index: index++, tokens: p.tokens, text: textAt(face, r), discourse: discourseOf(before) }, ue);
    // trek-8: the Oracle line of the sentence (a paragraph; lower/delay-tail.ts keeps a delayed trigger's tail to its own paragraph)
    const line = face.pre.lines.findIndex((l) => r[0] >= l.range[0] && r[0] < l.range[1]);
    return line >= 0 ? { ...unit, line } : unit;
  };
  const sequence = (ps: readonly ProgramPiece[], prior: readonly Unit[] = []): Unit[] => {
    const us: Unit[] = [];
    for (const p of joinThoseSpellsGain(joinGainsSuspend(joinSpeedFloor(joinFightsDifferent(joinPreventedThisWay(joinChosenFromOutside(joinRevealedByTheOther(joinRoundDown(joinAlternatingPicks(joinOnlyAttackers(joinYouChooseKeepFour(joinChoosesDestroyRest(ps))))))))))))) us.push(unitOf(p, [...prior, ...us]));
    // CLOUD std-fra (guard G10): a sentence-initial "Then if ..." that eff.stdfra.then.effects reads stays a sentence the parser does not understand where an "If you do"
    // sentence follows it (a conditional instruction is not an instruction done "you do": the "if you do" would read it)
    return us.map((u, i) => {
      if (!u.templates.includes('eff.stdfra.then.effects') || u.manual !== undefined) return u;
      const next = us[i + 1]?.tokens;
      const ifYouDo = next !== undefined && (next[0]?.norm === 'if' || next[0]?.norm === 'when') && next[1]?.norm === 'you' && next[2]?.norm === 'do';
      // ... and a "Then if ..." that reads "the difference" (an intervening "if" that compares an amount, CR 603.4: the generic reading leaves that reference unbound and its taint would
      // take the instructions before it too, where no template matching the sentence takes nothing)
      const difference = u.tokens.some((t) => t.norm === 'difference');
      if (u.tokens[1]?.norm !== 'if' || !(ifYouDo || difference)) return u;
      return { ...u, steps: [], templates: [], experimental: [], manual: { code: 'no-template', reason: 'no template matches the sentence' } } as Unit;
    });
  };
  const units = sequence(pieces);
  // p2-c-dieroll-1 (CR 706.3a): the sentences of each die-roll result row follow the ability's own, tagged with their row (lower/die-roll.ts#foldRollTable)
  if (ROLL_ROWS !== undefined && !extra.modes) {
    const own = [...units]; // a row's pronouns read the sentences before the table, never another row (only one row happens, CR 706.3a)
    ROLL_ROWS.forEach((r, index) => { for (const u of sequence(r.pieces.map((tokens) => ({ tokens })), own)) units.push({ ...u, row: { index, min: r.min, max: r.max } }); });
  }
  let modes: ModesDraft | undefined;
  if (extra.modes) {
    const costs = extra.modes.costs;
    modes = { min: extra.modes.min, max: extra.modes.max, options: extra.modes.options.map((o, i) => { const us = sequence(o); const c = costs?.[i]; const said = us.map((u) => u.text).join(' '); const pt = extra.modes!.chosenPt?.[i]; return { text: pt === undefined ? said : said.replace(/\bthe chosen base power and toughness\b/i, `base power and toughness ${pt}`), units: us, ...(c ? { cost: c } : {}) }; }) }; // std-combat-2: each mode's text says its own size
    claim(acc, extra.modes.header, 'consumed', 'modal');
    for (const r of extra.modes.costRanges ?? []) claim(acc, r, 'consumed', extra.modes.tiered ? 'tiered' : extra.modes.pawprints ? 'pawprint' : 'spree'); // FAST5X E1: the "+ {cost}" of each Spree mode (CR 702.172a); E11: tiered (CR 702.183a); std-blb: the pawprints (CR 700.2i)
  }
  const draft: Draft = { units, ...(modes ? { modes } : {}), targets: [], ...(extra.trigger ? { trigger: extra.trigger } : {}), ...(extra.unknownTrigger ? { unknownTrigger: true } : {}), ...(extra.condition ? { condition: extra.condition } : {}), ...(extra.spell ? { spell: true } : {}), selfHeads: face.selfHeads, ...(face.animates ? { animates: true } : {}), ...(face.choices ? { faceChoices: face.choices } : {}), mentions: [...(extra.mentions ?? []), ...(face.linkedPlayer === true ? [LINKED_PLAYER] : [])], names: [], diagnostics: [] };
  const { program } = lowerProgram(draft);
  const tainted = applyTaint(program);
  const untainted = untaintedProgram(program);
  // FAST5X E11: the condition that changes the number of modes (CR 700.2, 702.194b) is kept on both forms (the render gate prints it back)
  const ov = extra.modes?.override;
  if (ov !== undefined) for (const p of [tainted.program, untainted]) if (p.modes) p.modes.override = JSON.parse(JSON.stringify(ov)) as NonNullable<typeof p.modes.override>;
  // FAST5X E11: the modes' printed names (CR 207.2d), display data on each option
  const labels = extra.modes?.labels;
  if (labels !== undefined) for (const p of [tainted.program, untainted]) p.modes?.options.forEach((o, i) => { const l = labels[i]; if (l !== undefined) o.label = l; });
  // std-blb (CR 700.2d, 700.2i): repeatable modes and the pawprints of each mode, on both forms (the render gate prints them back)
  const paw = extra.modes?.pawprints;
  for (const p of [tainted.program, untainted]) {
    if (p.modes === undefined) continue;
    if (extra.modes?.allowRepeat) p.modes.allowRepeat = true;
    if (extra.modes?.unchosen !== undefined) p.modes.unchosen = extra.modes.unchosen; // r3-choose (CR 700.2)
    if (extra.modes?.random === true) p.modes.random = true; // p2-modal-2 (CR 700.2)
    if (extra.modes?.maxQty !== undefined) p.modes.max = JSON.parse(JSON.stringify(extra.modes.maxQty)) as Quantity; // r3-choose (CR 700.2, 107.3a)
    if (paw !== undefined) { p.modes.pawprints = paw.budget; p.modes.options.forEach((o, i) => { o.pawprints = paw.each[i]!; }); }
  }
  // r5-cost (CR 603.12, 700.2, 118.12): "you may pay {1}. When you do, choose one --": the modes move into a reflexive trigger of the last instruction, which must be one
  // the player may choose to do ("you may pay", "you may <instruction>"); with any other last instruction the modes have no reading and stay a manual step
  if (extra.modes?.reflexive === true) for (const p of [tainted.program, untainted]) reflexiveModes(p, extra.modes.thatMany === true);
  if (extra.modes?.shared === true) for (const p of [tainted.program, untainted]) hoistShared(p); // std-costs-2 (CR 700.2, 608.2c)
  if (extra.modes?.differentPlayers === true) for (const p of [tainted.program, untainted]) differentPlayerModes(p); // p2-modal-1 (CR 700.2, 115.3)
  acc.untainted.set(tainted.program, untainted);
  for (const { unit, manual } of tainted.units) {
    const d = unitDiagnostic(unit);
    if (d) acc.diagnostics.push(d);
    use(acc, unit.templates, unit.experimental);
    if (manual) claim(acc, unit.range, 'manual', undefined, unit.manual?.reason ?? 'tainted by a manual sentence (design 6.7)');
    else claim(acc, unit.range, 'consumed', unit.templates.join(',') || 'rider');
  }
  acc.diagnostics.push(...tainted.diagnostics);
  let manualSteps = 0;
  visit(tainted.program, (n) => { if (n['op'] === 'manual') manualSteps++; });
  const anyAuto = tainted.units.some((u) => !u.manual);
  if (!modes) effectTexts.set(tainted.program, units.map((u) => u.text).filter((t) => t !== '').join(' '));
  return { program: tainted.program, understood: anyAuto || tainted.program.targets.length > 0 || (tainted.program.modes?.options.some((o) => o.program.targets.length > 0) ?? false), complete: manualSteps === 0 };
}

/**
 * std-costs-2 (CR 700.2, 115.1, 608.2c): see sharedInstructionModes. Each mode was read as the shared instruction on its own target: when every mode has one
 * target and one step that names it once, and the steps are the same but for that target, the step leaves the modes and acts once on the union of the modes'
 * targets ("Return those cards ...": the cards of the chosen modes together, CR 608.2c; a mode not chosen has no target, so it adds nothing). Anything else
 * replaces the modes' steps by a manual step, never a guess.
 */
function hoistShared(p: EffectProgram): void {
  const m = p.modes;
  if (m === undefined) return;
  let shape: string | undefined;
  const refs: ObjRef[] = [];
  const fits = m.options.every((o) => {
    const t = o.program.targets;
    if (t.length !== 1 || o.program.steps.length !== 1 || o.program.modes !== undefined) return false;
    const ref = JSON.stringify({ ref: 'target', id: t[0]!.id });
    const parts = JSON.stringify(o.program.steps[0]).split(ref);
    if (parts.length !== 2) return false;
    const s = parts.join('"$shared"');
    if (shape !== undefined && s !== shape) return false;
    shape = s;
    refs.push({ ref: 'target', id: t[0]!.id });
    return true;
  });
  if (!fits || shape === undefined) {
    p.steps.unshift({ op: 'manual', text: 'the instruction shared by the modes', reason: 'modes that are only targets of an instruction the model cannot share among them (CR 700.2, 608.2c)' } as EffectStep);
    return;
  }
  for (const o of m.options) o.program.steps = [];
  p.steps.unshift(JSON.parse(shape.replace('"$shared"', JSON.stringify({ ref: 'union', of: refs }))) as EffectStep);
}

/**
 * p2-modal-1 (CR 700.2, 115.3; unverified cites): the counts of "choose <count>." followed by "Each mode must target a different player.", or null. The counts are those
 * of the same header ended with a dash (modalHeader); "choose one" has nothing to keep apart, and "that hasn't been chosen" is another header.
 */
function differentPlayerHeader(header: readonly Tok[], rider: readonly Tok[], options: number): { min: number; max: number } | null {
  if (norms(rider).replace(/ \.$/, '') !== 'each mode must target a different player') return null;
  const w = norms(header).replace(/ \.$/, '');
  if (!/^choose (two|three|four|one or both|one or more|up to two|up to three)$/.test(w)) return null;
  const m = modalHeaderWords(`${w} --`, options);
  return m === null || m.max < 2 ? null : m;
}

/**
 * p2-modal-1 (CR 700.2, 115.3): "Each mode must target a different player": every mode targets exactly one player (one spec of kind 'player', one target), and the
 * player target of each mode names those of the modes printed before it in `distinctFrom` ("another target", CR 115.3), so the targets of the chosen modes, announced
 * as one set (actions/announce-targets.ts), are different players, and a set of modes with no such targets is refused (actions/announce.ts#chooseModes). Any other
 * shape of modes adds a manual step, never a guess.
 */
function differentPlayerModes(p: EffectProgram): void {
  const m = p.modes;
  if (m === undefined) return;
  const specs = m.options.map((o) => (o.program.targets.length === 1 ? o.program.targets[0]! : undefined));
  const fits = specs.every((t) => t !== undefined && t.kind === 'player' && t.min === 1 && t.max === 1 && t.distinctFrom === undefined) && m.options.every((o) => o.program.modes === undefined);
  if (!fits) {
    p.steps.unshift({ op: 'manual', text: 'Each mode must target a different player.', reason: 'modes that do not each target one player, kept apart (CR 700.2, 115.3)' } as EffectStep);
    return;
  }
  specs.forEach((t, i) => { if (i > 0) t!.distinctFrom = specs.slice(0, i).map((x) => x!.id); });
}

/** r5-cost: see buildProgram. Moves `p.modes` into a `reflexive` step after the last step (a `pay` or `may`), or replaces them by a manual step. */
function reflexiveModes(p: EffectProgram, thatMany = false): void {
  const modes = p.modes;
  if (modes === undefined) return;
  delete p.modes;
  const last = p.steps[p.steps.length - 1];
  // std-combat-2: "choose up to that many" counts the times a payment of a chosen number of times was made (`pay.upTo`); after anything else it has no reading
  if (thatMany && (last?.op !== 'pay' || last.upTo === undefined)) {
    p.steps.push({ op: 'manual', text: 'When you do, choose up to that many --', reason: '"that many" modes after an instruction that is not a payment made a chosen number of times (CR 603.12, 608.2h)' } as EffectStep);
    return;
  }
  if (last === undefined || (last.op !== 'pay' && last.op !== 'may')) {
    p.steps.push({ op: 'manual', text: 'When you do, choose --', reason: 'a reflexive trigger with modes after an instruction the player does not choose to do (CR 603.12)' } as EffectStep);
    return;
  }
  const used = new Set<string>();
  visit(p, (n) => { if (typeof n['as'] === 'string') used.add(n['as']); });
  let did = last.as;
  if (did === undefined) {
    did = 'paid';
    for (let i = 2; used.has(did); i++) did = `paid${i}`;
    last.as = did;
  }
  if (thatMany) modes.max = { q: 'resultCount', step: did };
  p.steps.push({ op: 'reflexive', when: { did }, targets: [], modes, do: [] });
}

/**
 * pc-players-1 (CR 101.4, 608.2d, 701.8a): "Each player chooses a creature they control. Destroy the rest." (Divine Reckoning) is one instruction: the sentence that has every
 * player choose is joined to a next one "Destroy the rest.", so one template reads both (eff.pcp1.eachPlayer.chooses.destroyRest). Any other sentences are left as they are.
 */
function joinChoosesDestroyRest<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const next = pieces[i + 1];
    if (next !== undefined && norms(p.tokens).startsWith('each player chooses ') && norms(p.tokens).endsWith(' they control .') && norms(next.tokens) === 'destroy the rest .') {
      out.push({ ...p, tokens: [...p.tokens, ...next.tokens] });
      i++;
      continue;
    }
    out.push(p);
  }
  return out;
}

/**
 * pc-players-1 (CR 101.4, 608.2d, 701.21a): "For each player, you choose from among the permanents that player controls an artifact, a creature, an enchantment, and a
 * planeswalker. Then each player sacrifices all other nonland permanents they control." (Tragic Arrogance) is one instruction, the choices and the sacrifice of the rest: the
 * first sentence is joined to the next, so one template reads both (eff.pcp1.youChoose.keepFourTypes). Any other sentences are left as they are.
 */
function joinYouChooseKeepFour<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const next = pieces[i + 1];
    if (next !== undefined && norms(p.tokens).startsWith('for each player , you choose from among the permanents that player controls ') && /^(then )?each player sacrifices all other nonland permanents they control/.test(norms(next.tokens))) {
      out.push({ ...p, tokens: [...p.tokens, ...next.tokens] });
      i++;
      continue;
    }
    out.push(p);
  }
  return out;
}

/**
 * std-rq (CR 500.8, 508.1c): "After this phase, there is an additional combat phase. Only land creatures can attack during that combat phase." is one instruction,
 * the added combat phase with the attackers it allows: the sentence that adds a combat phase is joined to a next one "Only ... can attack during that combat phase.",
 * so one template reads both (eff.stdrq.extraCombat.onlyAttackers). Any other sentences are left as they are.
 */
function joinOnlyAttackers<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const next = pieces[i + 1];
    const words = norms(next?.tokens ?? []);
    if (next !== undefined && norms(p.tokens).endsWith('there is an additional combat phase .') && words.startsWith('only ') && words.endsWith(' can attack during that combat phase .')) {
      out.push({ ...p, tokens: [...p.tokens, ...next.tokens] });
      i++;
      continue;
    }
    out.push(p);
  }
  return out;
}

/** std-rx30: the sentences after "<players> each reveal the top card of their library." that name the card the other player revealed (joinRevealedByTheOther). */
const REVEALED_BY_THE_OTHER: readonly string[] = ['they each lose life equal to the mana value of the card revealed by the other player .', 'then they each put the card they revealed into their hand .'];

/**
 * std-rx30 (CR 608.2c, 701.20a): "Two target players each reveal the top card of their library. They each lose life equal to the mana value of the card revealed by the
 * other player. Then they each put the card they revealed into their hand." (Parker Luck) is one instruction pairing the two players' cards: the three sentences are
 * joined, so one template reads them. Any other sentences are left as they are.
 */
function joinRevealedByTheOther<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const next = pieces.slice(i + 1, i + 1 + REVEALED_BY_THE_OTHER.length);
    if (norms(p.tokens).endsWith(' each reveal the top card of their library .') && next.length === REVEALED_BY_THE_OTHER.length && next.every((x, k) => norms(x.tokens) === REVEALED_BY_THE_OTHER[k])) {
      out.push({ ...p, tokens: [...p.tokens, ...next.flatMap((x) => x.tokens)] });
      i += REVEALED_BY_THE_OTHER.length;
      continue;
    }
    out.push(p);
  }
  return out;
}

/**
 * std-rx30 (CR 107.1a): "Round down each time." says how every "half" of the sentence before it is rounded ("Each player loses half their life, then discards half
 * the cards in their hand, then sacrifices half the permanents they control of their choice. Round down each time.", Pox Plague): it is joined to that sentence,
 * so one template reads both. Any other sentences are left as they are.
 */
function joinRoundDown<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (const p of pieces) {
    const prev = out[out.length - 1];
    if (prev !== undefined && norms(p.tokens) === 'round down each time .' && norms(prev.tokens).includes(' half ')) { out[out.length - 1] = { ...prev, tokens: [...prev.tokens, ...p.tokens] }; continue; }
    out.push(p);
  }
  return out;
}

/** std-rx30: the sentences after "You may reveal exactly N cards you own with different names from outside the game." (joinChosenFromOutside). */
const CHOSEN_FROM_OUTSIDE: readonly string[] = ['an opponent chooses one of them .', 'you put that card into your hand .'];

/**
 * std-rx30 (CR 400.11b, 608.2d): "You may reveal exactly two cards you own with different names from outside the game. An opponent chooses one of them. You put that card
 * into your hand." (Extrapolate the Impossible) is one instruction: the three sentences are joined, so one template reads them. Any other sentences are left as they are.
 */
function joinChosenFromOutside<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const next = pieces.slice(i + 1, i + 1 + CHOSEN_FROM_OUTSIDE.length);
    if (/ cards you own with different names from outside the game \.$/.test(norms(p.tokens)) && next.length === CHOSEN_FROM_OUTSIDE.length && next.every((x, k) => norms(x.tokens) === CHOSEN_FROM_OUTSIDE[k])) {
      out.push({ ...p, tokens: [...p.tokens, ...next.flatMap((x) => x.tokens)] });
      i += CHOSEN_FROM_OUTSIDE.length;
      continue;
    }
    // ... and "Search your library and/or outside the game for exactly four legendary creature cards you own with different names, then reveal those cards. An opponent
    // chooses two of them. Put the chosen cards into your hand and shuffle the rest into your library." (Turtles Forever)
    const two = pieces.slice(i + 1, i + 3).map((x) => norms(x.tokens));
    if (/^search your library and\/or outside the game for .* , then reveal those cards \.$/.test(norms(p.tokens)) && two.length === 2 && /^an opponent chooses \S+ of them \.$/.test(two[0]!)
      && two[1] === 'put the chosen cards into your hand and shuffle the rest into your library .') {
      out.push({ ...p, tokens: [...p.tokens, ...pieces.slice(i + 1, i + 3).flatMap((x) => x.tokens)] });
      i += 2;
      continue;
    }
    out.push(p);
  }
  return out;
}

/** std-rx30: the sentences of the alternating picks after "Put one of them into your hand." (joinAlternatingPicks). */
const ALTERNATING_PICKS: readonly string[] = [
  'then choose an opponent .', 'they put one on the bottom of your library .', 'then you put one into your hand .', 'then they put one on the bottom of your library .',
];

/**
 * std-rx30 (CR 608.2c-d, 701.20a): "Put one of them into your hand. Then choose an opponent. They put one on the bottom of your library. Then you put one into your hand.
 * Then they put one on the bottom of your library." (Memories Returning) is one instruction, picks made in turn by you and the chosen opponent among the cards that are
 * left: the five sentences are joined, so one template reads them (eff.stdrx30.alternatingPicks.youOpponent). Any other sentences are left as they are.
 */
function joinAlternatingPicks<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const next = pieces.slice(i + 1, i + 1 + ALTERNATING_PICKS.length);
    if (norms(p.tokens) === 'put one of them into your hand .' && next.length === ALTERNATING_PICKS.length && next.every((x, k) => norms(x.tokens) === ALTERNATING_PICKS[k])) {
      out.push({ ...p, tokens: [...p.tokens, ...next.flatMap((x) => x.tokens)] });
      i += ALTERNATING_PICKS.length;
      continue;
    }
    out.push(p);
  }
  return out;
}

/**
 * std-rx35 (CR 615.5, 609.7a): "The next time a source of your choice would deal damage to you this turn, prevent that damage. You gain life equal to the damage
 * prevented this way." is one instruction, a prevention shield with its additional instruction (`prevent.then`, applied each time the shield prevents damage): the
 * shield sentence is joined to that exact next sentence, so one template reads both (eff.stdrx35.prevent.nextSourceOfChoice.you.gainLife). Any other sentences are
 * left as they are.
 * std-library-2: also the reflexive trigger on that prevention ("When damage is prevented this way, ...", New Way Forward).
 */
function joinPreventedThisWay<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const next = pieces[i + 1];
    const words = norms(p.tokens);
    // std-library-2 (CR 603.12, 615.5): or a reflexive trigger on the prevention, "When damage is prevented this way, ~ deals that much damage to ..." (New Way Forward;
    // eff.stdlibrary2.prevent.nextSourceOfChoice.you.whenPrevented.damageDraw)
    const after = next === undefined ? '' : norms(next.tokens);
    if (next !== undefined && words.includes('the next time a source of your choice would deal damage to you ') && words.endsWith(', prevent that damage .')
      && (after === 'you gain life equal to the damage prevented this way .' || after.startsWith('when damage is prevented this way , '))) {
      out.push({ ...p, tokens: [...p.tokens, ...next.tokens] });
      i++;
      continue;
    }
    out.push(p);
  }
  return out;
}

/**
 * std-copy-2 (CR 707.10, 608.2c, 611.2c): "You may copy it. If you do, those spells gain wither." (Spinerock Tyrant): "those spells" are the spell copied and its
 * copy, which only the copying sentence names together, and the copy's new targets are said after them ("You may choose new targets for the copy.", CR 707.10c): the
 * three sentences are joined, so one template reads them (eff.stdcopy2.mayCopy.thoseSpellsGain.newTargets). Any other sentences are left as they are.
 */
function joinThoseSpellsGain<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const [next, third] = [pieces[i + 1], pieces[i + 2]];
    if (next !== undefined && third !== undefined && /^you may copy (it|that spell) \.$/.test(norms(p.tokens)) && /^if you do , those spells gain [^.]* \.$/.test(norms(next.tokens))
      && norms(third.tokens) === 'you may choose new targets for the copy .') {
      out.push({ ...p, tokens: [...p.tokens, ...next.tokens, ...third.tokens] });
      i += 2;
      continue;
    }
    out.push(p);
  }
  return out;
}

/**
 * std-copy-6 (CR 707.10, 702.62a-b, 608.2c): "copy it, then exile the spell you cast with four time counters on it. If it doesn't have suspend, it gains suspend."
 * (Taigam, Master Opportunist): both "it"s of the second sentence are the card the first one exiled (the spell it was is gone from the stack, CR 400.7), which
 * only the exiling sentence names: the two sentences are joined, so one template reads both (eff.stdcopy6.copy.thenExileSpellCast.timeCounters.gainsSuspend).
 * Any other sentences are left as they are.
 */
function joinGainsSuspend<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const next = pieces[i + 1];
    if (next !== undefined && /^copy (it|that spell) , then exile the spell you cast with \S+ time counters on it \.$/.test(norms(p.tokens))
      && norms(next.tokens) === "if it doesn't have suspend , it gains suspend .") {
      out.push({ ...p, tokens: [...p.tokens, ...next.tokens] });
      i++;
      continue;
    }
    out.push(p);
  }
  return out;
}

/**
 * std-control-1 (CR 702.179, 608.2c): "Reduce that opponent's speed by 1. This effect can't reduce their speed below 1." is one instruction, a speed reduction with
 * its floor: the sentence that reduces a player's speed is joined to that exact next sentence, so one template reads both (eff.stdcontrol1.speed.reduce.floor).
 * Likewise "Take an extra turn after this one." with a next "During that turn, <keyword> abilities can't be activated." (eff.stdcontrol1.extraTurn.thatTurn.cantActivate),
 * so "that turn" can only be the extra turn. Any other sentences are left as they are.
 */
function joinSpeedFloor<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const next = pieces[i + 1];
    const joins = / 's speed by \S+ \.$/.test(norms(p.tokens)) && norms(next?.tokens ?? []) === "this effect can't reduce their speed below 1 .";
    // std-control-1 (CR 500.7, 611.2a): "Take an extra turn after this one. During that turn, power-up abilities can't be activated.": "that turn" is the extra turn
    const thatTurn = norms(p.tokens).endsWith('take an extra turn after this one .') && /^during that turn , \S+ abilities can't be activated \.$/.test(norms(next?.tokens ?? []));
    // std-control-1 (CR 105.1, 608.2c): "for each color, put a +1/+1 counter on a Dragon you control of that color." with a next "If you put +1/+1 counters on five Dragons
    // this way, you win the game.": "this way" is the five puts of the sentence before (eff.stdcontrol1.forEachColor.counter.winIfFive)
    const fiveWays = norms(p.tokens) === 'for each color , put a +1/+1 counter on a dragon you control of that color .' && norms(next?.tokens ?? []) === 'if you put +1/+1 counters on five dragons this way , you win the game .';
    if (next !== undefined && (joins || thatTurn || fiveWays)) {
      out.push({ ...p, tokens: [...p.tokens, ...next.tokens] });
      i++;
      continue;
    }
    out.push(p);
  }
  return out;
}

/**
 * p2-damage-2 (CR 701.14a, 608.2d): "For each creature your opponents control, create a 4/4 ... token. Each of those tokens fights a different one of those
 * creatures." (Ezuri's Predation) is one instruction: "those creatures" are the creatures the first sentence counts and "those tokens" the tokens it creates, so the
 * sentence is joined to that exact next one and one template reads both (eff.p2damage2.forEach.token.fightsDifferent). Any other sentences are left as they are.
 */
function joinFightsDifferent<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const next = pieces[i + 1];
    const first = norms(p.tokens);
    if (next !== undefined && first.startsWith('for each ') && first.endsWith(' token .') && first.includes(', create ') && norms(next.tokens) === 'each of those tokens fights a different one of those creatures .') {
      out.push({ ...p, tokens: [...p.tokens, ...next.tokens] });
      i++;
      continue;
    }
    out.push(p);
  }
  return out;
}

/** The sentences of an ability as pieces; `first` replaces the tokens of the first sentence (after a cost or a trigger clause). */
/**
 * r4-cost (CR 106.1, 106.4, 605.1a): "Choose a color. Add one mana of that color for each ..." is one instruction, adding mana of one color the player picks: the
 * sentence "Choose a color." is joined to the next one when that one adds mana "of that color", so one template reads both (the choice is made as the mana is
 * added, never earlier). Any other sentences are left as they are.
 */
function joinChooseColor(pieces: Tok[][]): Tok[][] {
  const out: Tok[][] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const next = pieces[i + 1];
    const words = norms(next ?? []);
    if (next !== undefined && norms(p) === 'choose a color .' && words.startsWith('add ') && words.includes(' of that color')) { out.push([...p, ...next]); i++; continue; }
    out.push(p);
  }
  return out;
}

function piecesOf(sentences: readonly Sentence[], first?: Tok[]): Tok[][] {
  return sentences.map((s, i) => (i === 0 && first !== undefined ? first : adaptTokens(s.tokens)));
}

/** The modes of an ability as the lowering needs them: the header (claimed), the counts and the sentences of each option. */
interface ModalParts {
  header: Range;
  min: number;
  max: number;
  options: { tokens: Tok[] }[][];
  /** FAST5X E1: Spree, the additional cost of each mode (CR 702.172a, 700.2h), and the ranges of those costs (claimed). */
  costs?: CostDef[];
  costRanges?: Range[];
  /** FAST5X E11: "If this spell was cast using teamwork, choose both instead." (CR 700.2, 702.194b): `ModeSpec.override`. */
  override?: { when: Condition; min: number; max: number; chosen?: true };
  /** FAST5X E11: the name printed before each mode's effect, if any (CR 207.2d): `ModeSpec.options[i].label`. */
  labels?: (string | undefined)[];
  /** FAST5X E11: the modes of a tiered spell (CR 702.183a): their costs are claimed as `tiered`, not `spree`. */
  tiered?: true;
  /** std-blb (CR 700.2d): "You may choose the same mode more than once." (`ModeSpec.allowRepeat`). */
  allowRepeat?: true;
  /** std-blb (CR 700.2i): "Choose up to N {P} worth of modes": N (`ModeSpec.pawprints`) and the pawprints of each mode (`options[].pawprints`). */
  pawprints?: { budget: number; each: number[] };
  /** r3-choose (CR 700.2): "choose one that hasn't been chosen [this turn]" (`ModeSpec.unchosen`). */
  unchosen?: 'object' | 'turn';
  /** r3-choose (CR 700.2, 107.3a): "choose up to X, where X is ..." (`ModeSpec.max`, a calculated quantity; `max` holds the number of modes meanwhile). */
  maxQty?: Quantity;
  /** r5-cost (CR 603.12, 700.2): "When you do, choose one --": the modes of a reflexive trigger of the last instruction (`reflexive.modes`). */
  reflexive?: true;
  /** std-costs-2 (CR 700.2, 608.2c): the modes are only targets and the instruction after the header acts on all of them (sharedInstructionModes, hoistShared). */
  shared?: true;
  /** p2-modal-1 (CR 700.2, 115.3): "Each mode must target a different player." (differentPlayerModes): the modes' player targets are kept apart. */
  differentPlayers?: true;
  /** p2-modal-2 (CR 700.2): "choose one at random" (`ModeSpec.random`). */
  random?: true;
  /** std-combat-2 (CR 603.12, 700.2): "When you do, choose up to that many --": the reflexive trigger chooses up to the number of times the payment before it was made. */
  thatMany?: true;
  /** std-combat-2 (CR 702.183a): tiered modes that are each a base power and toughness ("3/2") for "the chosen base power and toughness": each mode's size. */
  chosenPt?: string[];
}

/**
 * std-costs-2 (CR 700.2, 115.1, 608.2c): "Choose up to two. Return those cards from your graveyard to your hand." over bullets that are each only a target ("• Target
 * artifact card.", Call Damage Control): each chosen mode announces its target, and the one instruction after the header acts on the targets of the chosen modes
 * together. Each mode is read as that instruction with "those cards" replaced by the mode's target phrase ("Return target artifact card from your graveyard to your
 * hand."), the borrowed words placed at the bullet's ends so the bullet is what the mode's sentence claims; buildProgram#hoistShared then moves the instruction,
 * identical in every mode, out of the modes into one step on the union of their targets. Null for any other wording (a mode that is more than "target ... card.").
 */
function sharedInstructionModes(header: readonly Tok[], instr: readonly Tok[], options: { tokens: Tok[] }[][]): { min: number; max: number; options: { tokens: Tok[] }[][] } | null {
  const h = /^choose (up to )?(one|two|three|four) \.$/.exec(norms(header));
  if (h === null || options.length < 2) return null;
  const n = NUMBER_WORDS[h[2]!]!;
  if (n > options.length) return null;
  const words = instr.map((t) => t.norm);
  const at = words.findIndex((w, i) => w === 'those' && words[i + 1] === 'cards');
  if (at < 1 || words.indexOf('those', at + 1) >= 0 || words[words.length - 1] !== '.' || words.slice(0, -1).includes('.')) return null;
  const out: { tokens: Tok[] }[][] = [];
  for (const o of options) {
    const t = o.length === 1 ? o[0]!.tokens : undefined;
    const ws = t?.map((x) => x.norm) ?? [];
    // one target, one card ("target artifact card"): no list, no second target, no other sentence
    if (t === undefined || ws[0] !== 'target' || ws[ws.length - 1] !== '.' || ws[ws.length - 2] !== 'card' || ws.slice(1, -1).some((w) => w === '.' || w === ',' || w === 'target' || w === 'and' || w === 'or')) return null;
    const first = t[0]!;
    const stop = t[t.length - 1]!;
    const lead = instr.slice(0, at).map((x) => ({ ...x, start: first.start, end: first.start }));
    const tail = instr.slice(at + 2).map((x, i, all) => (i === all.length - 1 ? { ...x, start: stop.start, end: stop.end } : { ...x, start: stop.start, end: stop.start }));
    out.push([{ tokens: [...lead, ...t.slice(0, -1), ...tail] }]);
  }
  return { min: h[1] !== undefined ? 0 : n, max: n, options: out };
}

/**
 * FAST5X E11 (CR 700.2, 702.194b): the two-sentence header "Choose one. If this spell was cast using teamwork, choose both instead." over two bullets. Only this
 * wording: the condition is the cast record's teamwork cost (`wasCast.kicked: 'teamwork'`, read while announcing, actions/announce.ts#effectiveModes).
 */
function modalOverride(header: readonly Tok[], rider: readonly Tok[], options: number, env?: HoleEnv): { min: number; max: number; override: { when: Condition; min: number; max: number } } | null {
  if (norms(header).replace(/ \.$/, '') !== 'choose one') return null;
  const m = options === 2 ? /^if ~ was cast using (teamwork) , choose both instead$/.exec(norms(rider).replace(/ \.$/, '')) : null;
  if (m !== null) return { min: 1, max: 1, override: { when: { cond: 'wasCast', kicked: m[1]! }, min: 2, max: 2 } };
  // FAST5 T52 (delirium, CR 700.2, 205.2a, 601.2b): "Choose one. If there are four or more card types among cards in your graveyard, choose one or more instead."
  // over three or more bullets: the condition is read while the modes are chosen (actions/announce-cond.ts#announceCond reads the card types of the cards in
  // the graveyard, FAST5X E13). Tried before FAST5X E22's general reading below, which covers any other condition.
  const text = norms(rider).replace(/ \.$/, '');
  const d = options >= 3 ? /^if there are (\d+|[a-z]+) or more card types among cards in your graveyard , choose one or more instead$/.exec(text) : null;
  const n = d === null ? undefined : (/^\d+$/.test(d[1]!) ? Number(d[1]) : NUMBER_WORDS[d[1]!]);
  if (n !== undefined && n >= 1) {
    const when: Condition = { cond: 'compare', left: { q: 'distinct', what: 'cardTypes', among: { ref: 'each', filter: { zone: 'graveyard', owner: 'you', isCard: true } } }, op: '>=', right: n };
    return { min: 1, max: 1, override: { when, min: 1, max: options } };
  }
  return env !== undefined ? conditionalModeCount(rider, options, env) : null;
}

/**
 * p2-modal-2 (CR 700.2; unverified cite): "Choose one at random." followed by "If [condition], you choose one instead.": the override of `ModeSpec.random` (one mode, of
 * the player's choice, `chosen`). The condition must have exactly one reading; whether it can be read as the modes are chosen is the capability walker's question.
 */
function randomOrChosen(header: readonly Tok[], rider: readonly Tok[], options: number, env: HoleEnv): { when: Condition; min: number; max: number; chosen: true } | null {
  if (options < 2 || norms(header).replace(/ \.$/, '') !== 'choose one at random' || rider[0]?.norm !== 'if') return null;
  const comma = rider.findIndex((x) => x.kind === 'PUNCT' && x.norm === ',');
  if (comma < 2 || norms(rider.slice(comma + 1)).replace(/ \.$/, '') !== 'you choose one instead') return null;
  const cond = rider.slice(1, comma);
  const readings = new Map<string, Condition>();
  for (const a of runHole('Cond', cond, 0, env)) if (a.end === cond.length) readings.set(canonicalJson(a.value), a.value as Condition);
  return readings.size === 1 ? { when: [...readings.values()][0]!, min: 1, max: 1, chosen: true } : null;
}

/**
 * FAST5X E22 (CR 700.2, 601.2b, 700.11): a spell's "Choose one." followed by "If [condition], you may choose both instead." (Molten Collapse: "If you descended
 * this turn") or "If [condition] as you cast this spell, choose one or more instead." (Wail of the Forgotten: "If there are eight or more permanent cards in
 * your graveyard"). The modes are chosen as the spell is cast (CR 601.2b), which is when `ModeSpec.override.when` is read (actions/announce.ts#effectiveModes),
 * so "as you cast this spell" is that timing and adds nothing to the condition. The condition must have exactly one reading; whether it can be read at
 * announcement is the capability walker's question (model/forms.ts#announceCondForms: anything else keeps the spell manual).
 *   "you may choose both instead" (two modes): one or both; "choose both instead": both; "choose one or more instead": one up to all of them.
 */
function conditionalModeCount(rider: readonly Tok[], options: number, env: HoleEnv): { min: number; max: number; override: { when: Condition; min: number; max: number } } | null {
  if (rider[0]?.norm !== 'if') return null;
  const comma = rider.findIndex((x) => x.kind === 'PUNCT' && x.norm === ',');
  if (comma < 2) return null;
  const tail = norms(rider.slice(comma + 1)).replace(/ \.$/, '');
  const counts: Record<string, { min: number; max: number } | undefined> = {
    'you may choose both instead': options === 2 ? { min: 1, max: 2 } : undefined,
    'choose both instead': options === 2 ? { min: 2, max: 2 } : undefined,
    'choose one or more instead': options >= 2 ? { min: 1, max: options } : undefined,
    // p2-modal-1 (CR 700.2, 601.2b, 702.33d; unverified cites): "If this spell was kicked, choose any number instead." (the Inscriptions of Zendikar Rising): one up to
    // all of the modes, as "choose one or more instead" (a spell's modes are chosen as it is cast and at least one is chosen; Gatherer ruling on the Inscriptions)
    'choose any number instead': options >= 3 ? { min: 1, max: options } : undefined,
  };
  const count = counts[tail];
  if (count === undefined) return null;
  let cond = rider.slice(1, comma);
  const n = cond.length;
  // "as you cast this spell" (this spell is "~"): the time the modes are chosen anyway (CR 601.2b)
  if (n > 4 && norms(cond.slice(n - 4, n - 1)) === 'as you cast' && cond[n - 1]?.kind === 'SELF') cond = cond.slice(0, n - 4);
  const readings = new Map<string, Condition>();
  for (const a of runHole('Cond', cond, 0, env)) if (a.end === cond.length) readings.set(canonicalJson(a.value), a.value as Condition);
  if (readings.size !== 1) return null;
  return { min: 1, max: 1, override: { when: [...readings.values()][0]!, ...count } };
}

/**
 * std-combat-2 (CR 702.183a, 613.4b): the options of tiered modes that each print only a power and toughness ("3/2.") after an instruction of the spell that says
 * "the chosen base power and toughness" once: each option is that instruction with "base power and toughness <the mode's P/T>". Null for anything else.
 */
function chosenBasePtModes(piece: readonly Tok[], options: readonly { tokens: Tok[] }[][]): { tokens: Tok[] }[][] | null {
  const words = ['the', 'chosen', 'base', 'power', 'and', 'toughness'];
  const at = piece.findIndex((_, i) => words.every((w, k) => piece[i + k]?.norm === w));
  if (at < 0 || piece.slice(at + words.length).some((_, i) => words.every((w, k) => piece[at + words.length + i + k]?.norm === w))) return null;
  const out: { tokens: Tok[] }[][] = [];
  for (const o of options) {
    const t = o.length === 1 ? o[0]!.tokens : [];
    if (t.length !== 2 || t[0]!.kind !== 'PT' || !/^\d+\/\d+$/.test(t[0]!.norm) || t[1]!.norm !== '.') return null;
    out.push([{ tokens: [...piece.slice(0, at), ...piece.slice(at + 2, at + words.length), t[0]!, ...piece.slice(at + words.length)] }]);
  }
  return out.length > 0 ? out : null;
}

/** Split off a modal header: the last piece must be it; the bullets become options. */
/** `face`: the spell's face (Spree and tiered modes); `labelFace`: the face of any other ability, for the names of its modes only (FAST5X E11). */
/** `env`: the hole environment of the ability, for a mode count that changes with a condition (FAST5X E22, CMD2) and a calculated number of modes (r3-choose:
 * "choose up to X, where X is ...", whereXModes). Standard merge wave 4: r3-choose's separate `countEnv` folded in, since CMD2 gives triggered abilities `env`. */
function withModes(seg: AbilitySegment, pieces: Tok[][], face?: FaceInfo, labelFace?: FaceInfo, env?: HoleEnv): { pieces: Tok[][]; modes?: ModalParts } | string {
  if (!seg.modal) return { pieces };
  // std-blb (CR 700.2i, 700.2d): "Choose up to five {P} worth of modes. You may choose the same mode more than once." over "{P} -- effect" lines: the modes, each
  // with its pawprints; the chosen modes' pawprints total at most five (actions/announce.ts#chooseModes), a mode chosen twice counting twice. Only this header.
  if (seg.modal.kind === 'pawprint') {
    if (face === undefined || pieces.length < 1 || pieces.length > 2) return 'a pawprint modal header the model cannot state (CR 700.2i)';
    const head = /^choose up to (one|two|three|four|five|six|seven|\d+) \{p\} worth of modes\.$/.exec(textAt(face, span(pieces[0]!)).toLowerCase());
    const budget = head === null ? undefined : /^\d+$/.test(head[1]!) ? Number(head[1]) : NUMBER_WORDS[head[1]!];
    const repeat = pieces.length === 2 ? /^you may choose the same mode more than once\.$/i.test(textAt(face, span(pieces[1]!))) : false;
    if (budget === undefined || budget < 1 || (pieces.length === 2 && !repeat)) return 'a pawprint modal header the model cannot state (CR 700.2i)';
    const modes = seg.modal.modes;
    if (modes.length === 0 || modes.some((m) => m.pawprints === undefined)) return 'pawprint modes without pawprints (CR 700.2i)';
    return {
      pieces: [],
      modes: {
        header: [span(pieces[0]!)[0], span(pieces[pieces.length - 1]!)[1]], min: 0, max: budget, ...(repeat ? { allowRepeat: true as const } : {}),
        pawprints: { budget, each: modes.map((m) => m.pawprints!) }, costRanges: modes.map((m) => m.marker),
        options: modes.map((m) => m.sentences.map((x) => ({ tokens: adaptTokens(x.tokens) }))),
      },
    };
  }
  if (seg.modal.kind !== 'bullets') {
    // FAST5X E1 (CR 702.172a): "Spree" means "Choose one or more modes. As an additional cost to cast this spell, pay the costs associated with those modes."
    // The "+ {cost} -- effect" lines are the modes of the spell, each with its cost (CR 700.2h); a Spree spell states no other instruction of its own.
    if (face === undefined || pieces.length > 0) return 'Spree modes with other instructions are not supported by this parser version (CR 702.172)';
    const costs: CostDef[] = [];
    for (const m of seg.modal.modes) {
      const mana = m.cost ? parseManaCost(face.pre.parse.slice(m.cost[0], m.cost[1]).trim()) : null;
      if (!mana || mana.length === 0) return 'a Spree cost that is not a mana cost (CR 702.172a)';
      costs.push({ mana });
    }
    const first = seg.modal.modes[0];
    if (first === undefined) return 'Spree with no modes (CR 702.172a)';
    return {
      pieces: [],
      modes: {
        header: [first.marker[0], first.marker[0]], min: 1, max: seg.modal.modes.length, costs, costRanges: seg.modal.modes.flatMap((m) => (m.cost ? [m.cost] : [])),
        options: seg.modal.modes.map((m) => m.sentences.map((s) => ({ tokens: adaptTokens(s.tokens) }))),
      },
    };
  }
  // FAST5X E11: the names printed before the modes' effects (flavor words, CR 207.2d; display data the render gate prints back)
  const modes = seg.modal.modes;
  const named = face ?? labelFace;
  if (modes.some((m) => m.label !== undefined) && named === undefined) return 'named modes need the face text (CR 700.2)';
  const labels = modes.some((m) => m.label !== undefined) ? modes.map((m) => (m.label !== undefined ? textAt(named!, m.label) : undefined)) : undefined;
  const options = modes.map((m) => m.sentences.map((s) => ({ tokens: adaptTokens(s.tokens) })));
  const withLabels = labels !== undefined ? { labels } : {};
  // FAST5X E11 (CR 702.183a, 700.2h): "Tiered" means "Choose one. As an additional cost to cast this spell, pay the cost associated with that mode." The
  // "• Name -- {cost} -- effect" lines are the modes of the spell; a tiered spell states no instruction of its own and no header (the keyword line says it)
  if (modes.some((m) => m.cost !== undefined)) {
    // std-combat-2 (CR 702.183a, 700.2, 613.4b): "Until end of turn, target creature you control gains ... and has the chosen base power and toughness." over modes
    // that are each only a power and toughness ("• Galian Beast -- {0} -- 3/2."): each mode is that instruction with its own base power and toughness
    const shared = face !== undefined && pieces.length === 1 ? chosenBasePtModes(pieces[0]!, options) : null;
    const chosenPt = shared === null ? undefined : options.map((o) => o[0]!.tokens[0]!.text);
    if (shared !== null) { pieces = []; options.splice(0, options.length, ...shared); }
    if (face === undefined || pieces.length > 0 || !modes.every((m) => m.cost !== undefined && m.label !== undefined)) return 'tiered modes with other instructions are not supported by this parser version (CR 702.183)';
    if (!/^tiered\b/im.test(face.pre.normalized)) return 'modes with costs and names on a spell without tiered (CR 700.2h)';
    const costs: CostDef[] = [];
    for (const m of modes) {
      const mana = parseManaCost(face.pre.parse.slice(m.cost![0], m.cost![1]).trim());
      if (!mana || mana.length === 0) return 'a tiered cost that is not a mana cost (CR 702.183a)';
      costs.push({ mana });
    }
    return { pieces: [], modes: { header: [modes[0]!.marker[0], modes[0]!.marker[0]], min: 1, max: 1, costs, costRanges: modes.map((m) => m.cost!), tiered: true, options, ...withLabels, ...(chosenPt ? { chosenPt } : {}) } };
  }
  // FAST5X E11 (CR 700.2, 601.2b, 702.194b): "Choose one. If this spell was cast using teamwork, choose both instead." The count changes with an additional
  // cost announced before the modes (CR 601.2b: modes are chosen after the intention to pay additional costs is announced): `ModeSpec.override`
  if (pieces.length === 2) {
    // std-costs-2 (CR 700.2, 115.1, 608.2c): "Choose up to two. Return those cards from your graveyard to your hand." over bullets that are only targets
    const shared = sharedInstructionModes(pieces[0]!, pieces[1]!, options);
    if (shared !== null) return { pieces: [], modes: { header: [span(pieces[0]!)[0], span(pieces[1]!)[1]], ...shared, shared: true, ...withLabels } };
    // std-blb (CR 700.2d): "Choose three. You may choose the same mode more than once." over bullets (the Confluences): the modes may repeat
    // r5-cost (CR 700.2, 700.2d): "Choose up to four. You may choose the same mode more than once." (Moment of Reckoning): none up to that many, a mode chosen again
    // with targets of its own (rules/mode-instances.ts)
    const rep = /^choose (up to )?(one|two|three|four|five) \.$/.exec(norms(pieces[0]!));
    if (rep !== null && /^you may choose the same mode more than once \.?$/.test(norms(pieces[1]!))) {
      const n = NUMBER_WORDS[rep[2]!]!;
      return { pieces: [], modes: { header: [span(pieces[0]!)[0], span(pieces[1]!)[1]], min: rep[1] !== undefined ? 0 : n, max: n, allowRepeat: true, options, ...withLabels } };
    }
    // p2-modal-1 (CR 700.2, 115.3): "Choose one or more. Each mode must target a different player." (Balor, the Turtles' pairs): the header, then a rider over the modes' targets
    const dp = differentPlayerHeader(pieces[0]!, pieces[1]!, modes.length);
    if (dp !== null) return { pieces: [], modes: { header: [span(pieces[0]!)[0], span(pieces[1]!)[1]], ...dp, differentPlayers: true, options, ...withLabels } };
    // p2-modal-2 (CR 700.2): "Choose one at random. If you discarded a card this turn, you choose one instead." (Typhoid Mary, Fractured): one mode at random, or of
    // your choice when the condition holds as the modes are chosen (`override.chosen`); the condition has exactly one reading
    const rnd = env !== undefined ? randomOrChosen(pieces[0]!, pieces[1]!, modes.length, env) : null;
    if (rnd !== null) return { pieces: [], modes: { header: [span(pieces[0]!)[0], span(pieces[1]!)[1]], min: 1, max: 1, random: true, override: rnd, options, ...withLabels } };
    const ov = modalOverride(pieces[0]!, pieces[1]!, modes.length, env);
    if (ov !== null) {
      const range: Range = [span(pieces[0]!)[0], span(pieces[1]!)[1]];
      return { pieces: [], modes: { header: range, min: ov.min, max: ov.max, override: ov.override, options, ...withLabels } };
    }
  }
  const last = pieces[pieces.length - 1];
  const head = last ? modalHeader(last, modes.length) : null;
  // r3-choose (CR 700.2, 603.3c): "choose one that hasn't been chosen and you lose 2 life --" (Zuko, Conflicted): the instruction after "and" is the ability's own, done with
  // the chosen mode as it resolves; the header claims the words around it
  const split = head === null && last !== undefined && pieces.length === 1 ? unchosenAnd(last, modes.length) : null;
  if (split !== null) return { pieces: [split.rest], modes: { header: span(split.head), min: 1, max: 1, unchosen: split.unchosen, options, ...withLabels } };
  // r3-choose (CR 700.2, 107.3a, 603.3c): "choose up to X, where X is the number of Lesson cards in your graveyard --" (Bumi): a calculated number of modes
  const upToX = head === null && last !== undefined && pieces.length === 1 && env !== undefined ? whereXModes(last, env) : null;
  if (upToX !== null) return { pieces: [], modes: { header: span(last!), min: 0, max: modes.length, maxQty: upToX, options, ...withLabels } };
  // r5-cost (CR 700.2, 107.3m): "When ~ enters, choose up to X --" (The Ruinous Wrecking Crew): an ability of a permanent (not a spell: `face` is a spell's) whose X is
  // the X its source was cast with, read as the modes are chosen (CR 603.3c; actions/announce-cond.ts reads a triggered ability's X so), 0 for one not cast
  if (head === null && last !== undefined && pieces.length === 1 && env !== undefined && face === undefined && norms(last) === 'choose up to x --') {
    return { pieces: [], modes: { header: span(last), min: 0, max: modes.length, maxQty: { q: 'X' }, options, ...withLabels } };
  }
  // r5-cost (CR 603.12, 700.2): "you may pay {1}. When you do, choose one --" (Hylda of the Icy Crown): the modes belong to a reflexive trigger of the instruction
  // before, chosen as that trigger is put on the stack (CR 603.3c); buildProgram moves them into the `reflexive` step it appends
  const rx = head === null && last !== undefined && pieces.length >= 2 ? reflexiveHeader(last, modes.length) : null;
  if (rx !== null) return { pieces: pieces.slice(0, -1), modes: { header: span(last!), ...rx, reflexive: true, options, ...withLabels } };
  if (!last || head === null || pieces.length !== 1) return 'a modal header the model cannot state (CR 700.2)';
  return { pieces: [], modes: { header: span(last), ...head, options, ...withLabels } };
}

// ---------------------------------------------------------------------------
// shapes
// ---------------------------------------------------------------------------

/**
 * M6-5: the keyword abilities of one "[Keyword] {A} and/or {B}" item (CR 702.33b: "Kicker {A} and/or {B}" is "Kicker {A}, kicker {B}"), each with its own words,
 * or null when the template built one ability (the usual case). Only a list of keyword abilities of ONE keyword, one per "and/or" part, is split.
 */
function andOrItems(value: unknown, text: string): { def: KeywordAbilityDef; text: string }[] | null {
  if (!Array.isArray(value)) return null;
  const parts = text.split(/\s+and\/or\s+/i);
  const defs = value as KeywordAbilityDef[];
  if (defs.length < 2 || parts.length !== defs.length || defs.some((d) => !isRec(d) || d.kind !== 'keyword' || d.keyword !== defs[0]!.keyword)) return null;
  const name = parts[0]!.split(/\s+/)[0]!;
  return defs.map((def, i) => ({ def, text: i === 0 ? parts[0]! : `${name} ${parts[i]!}` }));
}

/** The number of "It's an artifact creature at 7+." in the reminder text of a Station line (CR 702.184, 721.2b): the threshold whose striation holds the P/T box. */
const STATION_CREATURE_AT = /\bcreature at (\d+)\+/i;

/**
 * T35 (CR 702.184, 721): a Station card. The Station keyword line is the keyword ability (keywords/data/station.json expands it into the activated ability), and
 * each threshold row `N+ | abilities` is a static ability: "As long as this permanent has N or more charge counters on it, it has [abilities]" (CR 721.2a) and,
 * for the row whose striation holds the P/T box, "and is a creature with base power and toughness [P/T] in addition to its other types" (CR 721.2b). The Scryfall
 * data gives that box as the card's power and toughness and names its threshold only in the reminder text of the Station line ("It's an artifact creature at
 * 8+."): the reminder names the one symbol whose striation holds the box, so every other symbol is understood without it (T54, CR 721.2b); a card whose
 * reminder does not name a threshold the rows have, or whose P/T is not a number, has all its rows manual. trek-6: a Station line printed with no reminder text at all
 * (the Star Trek cards: "Station" alone) names nothing, but with exactly one symbol the box can only be in its striation (CR 721.2b), so that symbol is the one; with
 * two or more symbols and no reminder the rows stay manual. T54: every ability printed in a row's striation (the
 * text after the symbol and the lines under it, CR 721.2: parser/segment.ts#stationSeg) is lowered like any ability of its kind (keywords, static, triggered,
 * activated and mana abilities) and is one of the abilities the row adds in layer 6, the one form FAST5X-4 (max speed) introduced for "has [ability]" under a
 * condition; a row with an ability that is not understood stays manual and says why. A row is gated against
 * its own line (AbilityResult.oracles); the printed form `N+ | flying, lifelink` is render/abil.ts#stationRow.
 */
function stationAbilities(seg: AbilitySegment, face: FaceInfo, ue: UnitEnv, acc: Acc): { abilities: AbilityDef[]; oracles: (string[] | undefined)[] } {
  const item = seg.keywordItems![0]!;
  const head = keywordLine({ ...seg, keywordItems: [item] }, face, ue, acc);
  const abilities: AbilityDef[] = [...head];
  const oracles: (string[] | undefined)[] = head.map(() => undefined);
  const rows = seg.rollTable!;
  type Row = (typeof rows)[number];
  const lineOf = (row: Row): Range => {
    const last = row.sentences[row.sentences.length - 1];
    return [row.prefix[0], last !== undefined ? last.range[1] : row.prefix[1]];
  };
  /** The Oracle lines of a row's striation (CR 721.2): the symbol's line, then the lines below it. */
  const linesOf = (row: Row): Range[] => [lineOf(row), ...(row.more ?? []).flatMap((m): Range[] => (m.sentences.length > 0 ? [[m.sentences[0]!.range[0], m.sentences[m.sentences.length - 1]!.range[1]]] : []))];
  const manualRow = (row: Row, reason: string): void => {
    const ranges = linesOf(row);
    const text = ranges.map((r) => textAt(face, r)).join('\n');
    for (const r of ranges) claim(acc, r, 'manual', undefined, reason);
    acc.diagnostics.push({ level: 'manual', code: 'no-template', message: `${reason}: "${text}"`, range: ranges[0]! });
    abilities.push({ kind: 'manual', text, src: [row.line, ...(row.more ?? []).map((m) => m.line)], prov: { by: 'fallback' }, reason, shape: 'static' });
    oracles.push(undefined);
  };
  const power = face.pre.context.power;
  const toughness = face.pre.context.toughness;
  const hasBox = power !== undefined || toughness !== undefined;
  const creatureAt = ((): number | undefined => {
    const found = seg.reminders.map((r) => STATION_CREATURE_AT.exec(face.pre.normalized.slice(r[0], r[1]))).filter((m): m is RegExpExecArray => m !== null).map((m) => Number(m[1]));
    if (found.length === 1) return found[0]!;
    // TREK-6 (CR 721.2b): a Station line printed without its reminder text (Star Trek, "Station" alone) names no threshold, but a card with exactly one station symbol has exactly one
    // striation: the printed power and toughness box can be in no other, so it is that symbol's. With two or more symbols the box's striation cannot be told from the Oracle
    // text, and the rows stay manual; a reminder that names a threshold (or two) is never second-guessed, and neither is a Station reminder that leaves it out (T35: that is a
    // card whose text is not what Oracle prints, the rows stay manual).
    const stationReminder = seg.reminders.some((r) => /\btap another creature you control\b/i.test(face.pre.normalized.slice(r[0], r[1])));
    return hasBox && found.length === 0 && !stationReminder && rows.length === 1 && rows[0]!.max === null && rows[0]!.min >= 1 ? rows[0]!.min : undefined;
  })();
  const box = power !== undefined && toughness !== undefined && /^\d+$/.test(power) && /^\d+$/.test(toughness) ? { power: Number(power), toughness: Number(toughness) } : undefined;
  // T54 (CR 721.2b): the reminder text names the symbol whose striation holds the power and toughness box; every other symbol of the card is not that one
  const boxRowKnown = creatureAt !== undefined && rows.some((r) => r.min === creatureAt && r.max === null);
  for (const row of rows) {
    if (row.max !== null || row.min < 1) { manualRow(row, 'a station threshold that is not "N+" (CR 721.2)'); continue; }
    const isCreatureRow = boxRowKnown && creatureAt === row.min;
    if (hasBox && !boxRowKnown) { manualRow(row, 'the station symbol whose striation holds the power and toughness box cannot be told from the reminder text (CR 721.2b)'); continue; }
    if (isCreatureRow && box === undefined) { manualRow(row, 'a station power and toughness box that is not a number (CR 721.2b)'); continue; }
    const segs = row.segs ?? [];
    if (row.segsBroken === true || segs.length === 0) { manualRow(row, 'a station symbol with no abilities, or with text that is not an ability (CR 721.2)'); continue; }
    // every line of the striation is an ability the permanent has (CR 721.2a), lowered like any ability of its kind; one that is not understood keeps the row manual
    const granted: (KeywordAbilityDef | ActivatedAbilityDef | TriggeredAbilityDef | StaticAbilityDef)[] = [];
    const inners: AbilityResult[] = [];
    let bad: string | null = null;
    for (const sg of segs) {
      const inner = lowerAbility(sg, face, ue);
      const worse = inner.abilities.find((a) => a.kind !== 'keyword' && a.kind !== 'activated' && a.kind !== 'triggered' && a.kind !== 'static');
      const man = inner.abilities.find((a) => a.kind === 'manual');
      if (inner.abilities.length === 0 || worse !== undefined || man !== undefined) {
        bad = man?.kind === 'manual' ? man.reason : worse !== undefined ? `a station symbol with ${worse.kind} abilities (CR 721.2)` : 'a station symbol with no abilities';
        acc.diagnostics.push(...inner.diagnostics);
        break;
      }
      // a keyword the row grants is the keyword and its words (as the rows of plain keywords always were): where it is printed is the row's line, not its behavior
      for (const a of inner.abilities as typeof granted) {
        if (a.kind === 'keyword') { const { src: _src, prov: _prov, ...rest } = a; granted.push(rest as KeywordAbilityDef); } else granted.push(a);
      }
      inners.push(inner);
    }
    if (bad !== null) { manualRow(row, bad); continue; }
    // the symbol, the commas between keywords and the line ends are the station's own words; the abilities' claims follow and take their parts (a ledger claim made later wins)
    for (const r of linesOf(row)) claim(acc, r, 'consumed', 'station');
    for (const inner of inners) {
      acc.claims.push(...inner.claims);
      acc.diagnostics.push(...inner.diagnostics);
      use(acc, inner.templates, inner.experimental);
    }
    const ranges = linesOf(row);
    const mods: Rec[] = [];
    if (isCreatureRow && box !== undefined) {
      mods.push({ layer: 4, types: { add: ['Creature'] } });
      mods.push({ layer: '7b', power: box.power, toughness: box.toughness });
    }
    mods.push({ layer: 6, add: granted });
    abilities.push({
      kind: 'static', text: ranges.map((r) => textAt(face, r)).join('\n'), src: [row.line, ...(row.more ?? []).map((m) => m.line)], prov: { by: 'template' }, station: true,
      condition: { cond: 'matches', object: { ref: 'self' }, filter: { counters: { kind: 'charge', cmp: { op: '>=', value: row.min } } } },
      effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: mods as never }],
    } as StaticAbilityDef);
    oracles.push(ranges.map((r) => textAt(face, r)));
  }
  return { abilities, oracles };
}

function keywordLine(seg: AbilitySegment, face: FaceInfo, ue: UnitEnv, acc: Acc): AbilityDef[] {
  const out: AbilityDef[] = [];
  for (const item of seg.keywordItems ?? []) {
    const toks = adaptTokens(item.tokens);
    const text = textAt(face, item.range);
    const r = parseWhole(toks, 'ability', ue);
    const pair = r.ok ? andOrItems(r.value, text) : null;
    if (r.ok && pair !== null) {
      // M6-5 (INTERFACE CHANGE, additive): "Kicker {A} and/or {B}" means "Kicker {A}, kicker {B}" (CR 702.33b): a template of parser/templates/zz-m6/costs.json
      // builds the list, and each keyword ability keeps its own words ("Kicker {A}", "Kicker {B}") for the render gate and the display
      use(acc, r.d.templatesUsed, r.d.experimental);
      claim(acc, item.range, 'consumed', r.d.templatesUsed.join(','));
      for (const k of pair) out.push({ ...k.def, text: k.text, src: [...seg.lines], prov: { by: 'keyword', id: k.def.keyword } });
    } else if (r.ok && (r.value as KeywordAbilityDef).kind === 'keyword') {
      use(acc, r.d.templatesUsed, r.d.experimental);
      claim(acc, item.range, 'consumed', r.d.templatesUsed.join(','));
      out.push({ ...(r.value as KeywordAbilityDef), text, src: [...seg.lines], prov: { by: 'keyword', id: (r.value as KeywordAbilityDef).keyword } });
    } else {
      const reason = r.ok ? 'the keyword template did not produce a keyword ability' : r.manual.reason;
      claim(acc, item.range, 'manual', undefined, reason);
      acc.diagnostics.push({ level: 'manual', code: 'unknown-keyword', message: `${reason}: "${text}"`, range: item.range });
      out.push({ kind: 'manual', text, src: [...seg.lines], prov: { by: 'fallback' }, reason: `unknown-keyword: ${reason}`, shape: 'static' });
    }
  }
  if (out.length === 0) return [manualAbility(seg, 'static', 'a keyword line with no keyword')];
  return out;
}

/** An `addMana` step among the ability's own instructions (CR 605.1a); one inside a token's or a granted quoted ability belongs to that ability. */
const hasAddMana = (p: EffectProgram): boolean =>
  [p.steps, ...(p.modes?.options.map((o) => o.program.steps) ?? [])].some((l) => stepsInOrder(l).some(({ step }) => step['op'] === 'addMana'));
/**
 * CR 605.3b: a mana ability resolves at once through the engine's mana path (rules/mana.ts#activateManaAbility with rules/mana-text.ts#manaUnitsOf), which
 * runs only top-level `addMana` steps with their units. Any other instruction (an `if` of an "instead" fold, a reflexive trigger, CR 603.12) would be skipped
 * there without a word, so such a mana ability is a manual one (WP23 review).
 */
const onlyAddMana = (p: EffectProgram): boolean =>
  p.modes === undefined && p.steps.length > 0 && p.steps.some((st) => plainAddMana(st) || manaBranch(st)) && p.steps.every((st) => plainAddMana(st) || selfCounters(st) || selfDamageToYou(st) || gainLifeYou(st) || drawYou(st) || selfNoUntapNext(st) || delayedDrawYou(st) || manaBranch(st) || reflexiveAfterMana(st, p.steps) || selfManaColor(st, p.steps));
/**
 * r3-cost (CR 605.3b, 603.12, 605.5a-like: "{T}, Exile a card from your graveyard: Add {R}. When you do, this creature deals 1 damage to each opponent.", Rubble Rouser):
 * a reflexive trigger of the mana the ability adds; the trigger is not a mana ability and goes on the stack the next time a player would receive priority
 * (effects/handlers/lasting.ts#reflexive). Only one with no targets, waiting for an `addMana` step of the same effect (mirrors model/cap-walk.ts#nativeManaEffect).
 */
const reflexiveAfterMana = (st: EffectProgram['steps'][number], all: readonly EffectProgram['steps'][number][]): boolean =>
  st.op === 'reflexive' && st.guard === undefined && st.when.if === undefined && st.targets.length === 0 && all.some((x) => x.op === 'addMana' && x.as === st.when.did);
/**
 * std-mana-12 (CR 605.3b, 106.1, 611.2a; mirrors model/cap-walk.ts#nativeManaEffect): beside adding one mana of any color, the source becomes that color until end of turn
 * ("{1}: Add one mana of any color. This creature becomes that color until end of turn.", Foraging Wickermaw): the resolver runs every step in order, the color the
 * addMana step recorded (`link`) is fixed into the effect as it begins (effects/handlers/lasting-fix.ts#fixChosen).
 */
const selfManaColor = (st: EffectProgram['steps'][number], all: readonly EffectProgram['steps'][number][]): boolean => {
  if (st.op !== 'effect' || st.guard !== undefined || st.as !== undefined || (st.duration as { d?: string }).d !== 'endOfTurn' || st.effects.length !== 1) return false;
  const e = st.effects[0] as { s?: string; affects?: { ref?: string }; mods?: { layer?: unknown; colors?: Record<string, unknown> }[] };
  const m = e.mods?.length === 1 ? e.mods[0]! : undefined;
  return e.s === 'continuous' && e.affects?.ref === 'self' && Object.keys(e.affects).length === 1 && m?.layer === 5 && typeof m.colors?.['chosen'] === 'string'
    && Object.keys(m.colors).length === 1 && all.some((x) => x.op === 'addMana' && (x as { link?: string }).link === m.colors!['chosen']);
};
const plainAddMana = (st: EffectProgram['steps'][number]): boolean => st.op === 'addMana' && (Array.isArray((st as { units?: unknown }).units) || resolvedDynamic(st));
/**
 * std-lci (CR 605.3b, 122.1; mirrors model/cap-walk.ts#nativeManaEffect): beside adding mana, a counter put on or removed from the object itself ("{T}: Add {U}.
 * Remove a time counter from this land.", Temple of Cyclical Time), and a choice between two plain productions by a condition ("{T}: Add {G}. If you control a
 * creature with power 4 or greater, add {G}{G} instead."): rules/mana.ts#activateManaAbility runs such an effect at once through the resolver (effects/
 * mana-ability.ts runs every step); the payment planner offers only plain units, so the player activates it (rules/sources.ts).
 */
const selfCounters = (st: EffectProgram['steps'][number]): boolean => {
  const x = st as { op: string; from?: { ref?: string }; on?: { ref?: string }; guard?: unknown; as?: unknown };
  return (x.op === 'removeCounters' ? x.from?.ref === 'self' : x.op === 'putCounters' && x.on?.ref === 'self') && x.guard === undefined && x.as === undefined;
};
/**
 * CMD5 (CR 605.1a, 605.3b, 120.3; mirrors model/cap-walk.ts#nativeManaEffect): beside adding mana, the source deals a fixed amount of damage to its controller
 * ("{T}: Add {W} or {B}. This land deals 1 damage to you.": the pain lands, the Talismans, "{T}: Add {C}{C}. This land deals 2 damage to you."). Run like
 * std-lci's selfCounters: the resolver runs every step in order (the mana, then the damage, dealt by the source as any damage is, CR 120.3a); the payment
 * planner offers only plain units, so the player activates it by hand (rules/sources.ts#withInstructionBesideMana).
 */
const selfDamageToYou = (st: EffectProgram['steps'][number]): boolean => {
  const x = st as { op: string; source?: { ref?: string }; to?: { ref?: string }; amount?: unknown; guard?: unknown; as?: unknown };
  return x.op === 'damage' && x.source?.ref === 'self' && x.to?.ref === 'you' && Object.keys(x.to).length === 1 && typeof x.amount === 'number' && x.guard === undefined && x.as === undefined;
};
/**
 * std-rx22 (CR 605.1a, 605.3b, 119.3; mirrors model/cap-walk.ts#nativeManaEffect): beside adding mana, its controller gains a fixed amount of life ("{T}: Add {C}.
 * You gain 1 life.", Pristine Talisman; "{T}: Add {G}{G}. You gain 2 life.", The Great Henge). Run like CMD5's selfDamageToYou: the resolver runs every step in
 * order; the payment planner offers only plain units, so the player activates it by hand (rules/sources.ts#withInstructionBesideMana).
 */
const gainLifeYou = (st: EffectProgram['steps'][number]): boolean => {
  const x = st as { op: string; who?: { ref?: string }; amount?: unknown; guard?: unknown; as?: unknown };
  return x.op === 'gainLife' && x.who?.ref === 'you' && Object.keys(x.who).length === 1 && typeof x.amount === 'number' && x.guard === undefined && x.as === undefined;
};
/**
 * std-ry7 (CR 605.1a, 605.3b, 121.1; mirrors model/cap-walk.ts#nativeManaEffect): beside adding mana, its controller draws a fixed number of cards ("{2}, {T},
 * Sacrifice this artifact: Add {W}{U}. Draw a card.", the Eggs). A mana ability may do more than add mana and still is one (it has no target and is no loyalty
 * ability, CR 605.1a), so the card is drawn at once, also while a cost is being paid (CR 605.3b). Run like CMD5's selfDamageToYou: the resolver runs every step in
 * order; the payment planner offers only plain units, so the player activates it by hand. It reads nothing of the source, so also after "Sacrifice ~".
 */
const drawYou = (st: EffectProgram['steps'][number]): boolean => {
  const x = st as { op: string; who?: { ref?: string }; count?: unknown; guard?: unknown; as?: unknown };
  return x.op === 'draw' && x.who?.ref === 'you' && Object.keys(x.who).length === 1 && typeof x.count === 'number' && x.guard === undefined && x.as === undefined;
};
/**
 * std-ry7 (CR 605.3b, 502.3, 611.2a): beside adding mana, the source itself stays tapped through its controller's next untap step ("{T}: Add {W} or {U}. This land
 * doesn't untap during your next untap step.", the Tempest lands): MX5's eff.mx5.untap.next.your, a lasting restriction of the object itself, created at once by
 * the resolver.
 */
const selfNoUntapNext = (st: EffectProgram['steps'][number]): boolean => {
  if (st.op !== 'effect' || st.guard !== undefined || st.as !== undefined) return false;
  const d = st.duration as { d?: string; whose?: unknown };
  const r = st.effects.length === 1 ? (st.effects[0] as { s?: string; subject?: { ref?: string }; mode?: string; action?: string; other?: unknown }) : undefined;
  return d.d === 'throughNextUntap' && d.whose === 'you' && r !== undefined && r.s === 'restrict' && r.subject?.ref === 'self' && Object.keys(r.subject).length === 1
    && r.mode === 'cant' && r.action === 'untapDuringUntapStep' && r.other === undefined;
};
/**
 * std-ry7 (CR 605.3b, 603.7): beside adding mana, a delayed draw for its controller ("{1}, {T}, Sacrifice this artifact: Add one mana of any color. Draw a card at
 * the beginning of the next turn's upkeep.", Barbed Sextant): the resolver creates the delayed triggered ability at once (it uses the stack when it triggers).
 */
const delayedDrawYou = (st: EffectProgram['steps'][number]): boolean =>
  st.op === 'delay' && st.guard === undefined && st.as === undefined && (st.targets ?? []).length === 0 && st.duration === undefined && st.when.at === 'step'
  && st.do.length > 0 && st.do.every(drawYou);
const manaBranch = (st: EffectProgram['steps'][number]): boolean => {
  if (st.op !== 'if' || st.guard !== undefined) return false;
  const lists = [st.then, ...(st.else !== undefined ? [st.else] : [])];
  return lists.every((l) => Array.isArray(l) && l.length > 0 && l.every((x) => x.op === 'addMana' && (Array.isArray((x as { units?: unknown }).units) || resolvedDynamic(x)) && x.guard === undefined)); // pc-keywords-mana-2: and a resolved dynamic production
};
/**
 * FAST2 T7 (INTERFACE CHANGE, mirrors model/cap-walk.ts#nativeManaEffect): an `addMana` whose mana is decided as it resolves ("one mana of the chosen color",
 * "{G} for each creature you control", "three mana of any one color", "an amount of {G} equal to ~'s power") is run exactly by the mana path since WP31:
 * rules/mana.ts#activateManaAbility hands it to the interpreter's addMana handler at once, without the stack (effects/mana-ability.ts, CR 605.3b). Not
 * `sameAsSpent`: that one reads the costs paid for a stack object, which a mana ability does not have (the handler asks by hand).
 */
// M11-4: and "one mana of any color in your commander's color identity" (CR 903.4, 903.4f), as model/cap-walk.ts reads it since M11-0; the addMana handler
// and the payment solver run it once M11-1 registers feature:mana.commanderIdentity (until then the ability stays manual: needs-engine)
const RESOLVED_DYNAMIC: ReadonlySet<string> = new Set([
  'anyColor', 'anyOneColor', 'chosen', 'ofType',
  'eachColorAmong', 'colorsOf', // FAST5 T48
  'commanderIdentity', // M11-4
  'couldProduce', // p2-mana-1: CR 106.7, gated by feature:mana.couldProduce
  'devotionColor', // p2-mana-2: CR 700.5, gated by feature:mana.devotionColor
]);
const resolvedDynamic = (st: EffectProgram['steps'][number]): boolean => {
  const d = (st as { dynamic?: { kind?: unknown } }).dynamic;
  return d !== undefined && typeof d.kind === 'string' && RESOLVED_DYNAMIC.has(d.kind);
};
const hasTargets = (p: EffectProgram): boolean => p.targets.length > 0 || (p.modes?.options.some((o) => o.program.targets.length > 0) ?? false);
/** "Add {G}", "Add one mana of any color", "Add X mana": the words of an instruction that could add mana (CR 605.1a), read from the text. */
const ADDS_MANA = /(^|[.,;:]\s*|\bthen\s+)add\b[^.]*?(\{[^}]+\}|\bmana\b)/i;
/** The text without its quoted abilities: a token's or a granted "{T}: Add {G}." is not an instruction of this ability (CR 605.1a). */
const unquoted = (text: string): string => text.replace(/"[^"]*"/g, '""');
const piecesText = (face: FaceInfo, pieces: readonly Tok[][]): string => pieces.map((p) => textAt(face, span(p))).join(' ');
const ioOf = (face: FaceInfo, acc: Acc): DriverIO => ({ text: (t) => textAt(face, span(t)), claim: (range, status, by, reason) => claim(acc, range, status, by, reason) });

/** Cost parts that act on the object itself ("Sacrifice ~", "Remove a +1/+1 counter from ~", "Exile ~ from your graveyard"; CR 602.2b, 118). */
const SELF_COST_KINDS: ReadonlySet<string> = new Set(['sacrifice', 'discard', 'exileFrom', 'removeCounters', 'putCounters', 'returnToHand', 'reveal', 'putIntoLibrary' /* trek-9 */]);

/**
 * PUSH1 T2 (design 6.4: "cost objects" are mentions): an activation cost that names the object itself makes it a candidate for the effect's pronouns, so
 * "Sacrifice ~: It deals 2 damage to any target" reads "it" as ~ (its last known information when it is gone, CR 113.7a, 608.2h). Written {ref:'self'},
 * the reference "~" itself has; a cost that names no object adds nothing. It is a FALLBACK candidate (lower/anaphora.ts#resolveAnaphor): it counts only when
 * no other mention fits, because milestone 5 resolved "Sacrifice ~: Search ... put it onto the battlefield" to the searched card without it (guard G10:
 * no binding that worked is lost), and Oracle writes "~", never "it", for the object of its own cost when anything else could be meant.
 */
function costMentions(cost: CostDef, face: FaceInfo): Mention[] {
  return costMentionsOf(cost, face.selfHeads);
}

/** FAST5 T68: as `costMentions`, for a quoted ability (lower/quoted.ts), whose self heads are the nouns of the object that has it. */
export function costMentionsOf(cost: CostDef, selfHeads: readonly string[]): Mention[] {
  const names = (cost.other ?? []).some((c) => SELF_COST_KINDS.has(c.kind) && 'self' in c && c.self === true);
  const self: Mention[] = names ? [{ sort: 'object', number: 'singular', heads: [...new Set([...selfHeads, 'permanent', 'card', 'source'])], ref: { ref: 'self' }, origin: 'event', unit: -1, fallback: true }] : [];
  return [...self, ...sacrificedMentions(cost), ...discardedMentions(cost), ...exiledMentions(cost), ...tappedMentions(cost), ...costGroupMentions(cost), ...anyNumberMentions(cost), ...counterCostMentions(cost)];
}

/**
 * std-rx5 (CR 107.1c, 602.2b, 608.2h): the number of counters "Remove any number of <kind> counters from ~" removed (the ability's X, types/ability.ts CostPart
 * `anyNumber`): a number the effect's "that many" / "that much" may name. Only for ONE such part.
 */
export function anyNumberMentions(cost: CostDef): Mention[] {
  const parts = (cost.other ?? []).filter((c) => c.kind === 'removeCounters' && c.anyNumber === true);
  return parts.length === 1 ? [{ sort: 'number', number: 'singular', heads: [], ref: { q: 'X' }, origin: 'event', unit: -1 }] : [];
}

/**
 * p2-mana-1 (CR 107.1c, 602.2b, 608.2c): the counters a cost removed from ~ when their number is the ability's X ("Remove any number of storage counters from ~",
 * "Remove X charge counters from ~"), for "for each storage counter removed this way" when no instruction of the ability removed counters before it
 * (lower/conditions.ts#resolveCountersRemoved). The verb `cost:removed:<kind>` is no participle: no description or pronoun names it (Mention.participleOnly).
 * Only for ONE such part.
 */
export function counterCostMentions(cost: CostDef): Mention[] {
  const parts = (cost.other ?? []).filter((c) => c.kind === 'removeCounters' && c.self === true && typeof c.count === 'object' && (c.count as { q?: string }).q === 'X');
  if (parts.length !== 1) return [];
  const p = parts[0] as Extract<NonNullable<CostDef['other']>[number], { kind: 'removeCounters' }>;
  return [{ sort: 'number', number: 'singular', heads: [], ref: { q: 'X' }, origin: 'event', unit: -1, verbs: [`cost:removed:${p.counter}`], participleOnly: true }];
}

/**
 * Cloud r3-moved (CR 602.2b, 601.2b, 601.2h, 608.2c): what a cost sacrificed, discarded or exiled, however many objects ("{T}, Exile any number of cards from your
 * graveyard: Target creature gets -X/-X until end of turn, where X is the number of cards exiled this way"), for a count of what was moved "this way" when no
 * instruction of the ability is of that kind (lower/quantities.ts). Only a cost with ONE part of that kind, of objects other than ~ (craft's materials and a linked
 * exile are their own keywords'). The verb `cost:<kind>` is no participle: no description or pronoun names it (Mention.participleOnly).
 */
export function costGroupMentions(cost: CostDef): Mention[] {
  const out: Mention[] = [];
  const one = <K extends string>(kind: K): Extract<NonNullable<CostDef['other']>[number], { kind: K }> | undefined => {
    const parts = (cost.other ?? []).filter((c) => c.kind === kind);
    return parts.length === 1 ? (parts[0] as Extract<NonNullable<CostDef['other']>[number], { kind: K }>) : undefined;
  };
  const sac = one('sacrifice');
  if (sac !== undefined && sac.self !== true) out.push(groupMention('sacrificed', sac.filter, { ref: 'costSacrificed' }));
  const dis = one('discard');
  if (dis !== undefined && dis.self !== true) out.push(groupMention('discarded', dis.filter ?? {}, { ref: 'costDiscarded' }));
  const ex = one('exileFrom');
  if (ex !== undefined && ex.self !== true && ex.orGraveyard !== true && ex.link === undefined) out.push(groupMention('exiled', ex.filter ?? {}, { ref: 'costExiled' }));
  return out;
}

const groupMention = (kind: 'sacrificed' | 'discarded' | 'exiled', filter: ObjectFilter, ref: Rec): Mention =>
  ({ sort: 'object', number: 'plural', heads: [], verbs: [`cost:${kind}`], ref, origin: 'event', unit: -1, participleOnly: true, costPart: { kind, filter } });

/**
 * CLOUD C8 (CR 602.2b, 608.2h): what a cost tapped ("{3}, {T}, Tap an untapped creature you control: ~ deals damage equal to the tapped creature's power ..."), as a
 * mention only "the tapped creature" can name (Mention.participleOnly). Only a cost with ONE "tap an untapped ..." part of ONE permanent (a waterbend tap pays mana and
 * names nothing, rules/pay.ts). Written `{ref:'costTapped'}` (T35): the permanent on the battlefield, or its last known information once it left (effects/refs.ts).
 */
export function tappedMentions(cost: CostDef): Mention[] {
  const parts = (cost.other ?? []).filter((c) => c.kind === 'tapUntapped');
  const p = parts[0];
  if (parts.length !== 1 || p === undefined || p.kind !== 'tapUntapped' || p.count !== 1) return [];
  return [{ sort: 'object', number: 'singular', heads: headsOfFilter(p.filter, 'battlefield'), verbs: ['tapped'], ref: { ref: 'costTapped' }, origin: 'event', unit: -1, participleOnly: true }];
}

/**
 * CLOUD C8 (CR 602.2b, 601.2b, 400.7j): what a cost discarded ("Discard a card: If the discarded card was a land card, ..."; "As an additional cost to cast this spell,
 * discard a card"), as a mention only "the discarded card" can name (Mention.participleOnly), as `sacrificedMentions` does for a sacrifice. Only a cost with ONE
 * discard part of cards other than ~: "the discarded card" for one card, "the discarded cards" for several (a group). Written `{ref:'costDiscarded'}`: the cards in the
 * zone the discard put them (effects/refs.ts), read there or from their last known information once they left (CR 608.2h).
 */
export function discardedMentions(cost: CostDef): Mention[] {
  const parts = (cost.other ?? []).filter((c) => c.kind === 'discard');
  const p = parts[0];
  if (parts.length !== 1 || p === undefined || p.kind !== 'discard' || p.self === true) return [];
  const number = p.hand !== true && p.count === 1 ? 'singular' : 'plural';
  return [{ sort: 'object', number, heads: headsOfFilter(p.filter, 'other'), verbs: ['discarded'], ref: { ref: 'costDiscarded' }, origin: 'event', unit: -1, participleOnly: true }];
}

/**
 * CLOUD C8 (CR 602.2b, 601.2b, 400.7j): what a cost exiled ("As an additional cost to cast this spell, exile a creature card from your graveyard. ~ deals damage equal to the
 * exiled card's power ..."), as a mention only "the exiled card" can name (Mention.participleOnly). Only a cost with ONE exile part of ONE object other than ~ (craft's
 * materials are its keyword's own). Written `{ref:'costExiled'}`: the card it is in exile (effects/refs.ts).
 */
export function exiledMentions(cost: CostDef): Mention[] {
  const parts = (cost.other ?? []).filter((c) => c.kind === 'exileFrom');
  const p = parts[0];
  if (parts.length !== 1 || p === undefined || p.kind !== 'exileFrom' || p.self === true || p.orGraveyard === true || p.link !== undefined) return [];
  // std-cardcopy-7 (CR 400.7j, 608.2c): "Exile any number of black cards from your graveyard ...: Copy those exiled cards." the cards of an "any number of" part, a group
  if (p.count === 'any' && p.zone === 'graveyard' && p.atLeast === undefined) return [{ sort: 'object', number: 'plural', heads: headsOfFilter(p.filter, 'other'), verbs: ['exiled'], ref: { ref: 'costExiled' }, origin: 'event', unit: -1, participleOnly: true }];
  if (p.count !== 1) return [];
  return [{ sort: 'object', number: 'singular', heads: headsOfFilter(p.filter, p.zone === 'battlefield' ? 'unknown' : 'other'), verbs: ['exiled'], ref: { ref: 'costExiled' }, origin: 'event', unit: -1, participleOnly: true }];
}

/**
 * p2-refs-1 (CR 601.2b, 701.20a, 608.2h): what a spell's additional cost revealed ("As an additional cost to cast this spell, reveal a creature card from your hand. ...
 * where X is the revealed card's mana value", Disaster Radius), as a mention only "the revealed card" can name (Mention.participleOnly). Only a cost with ONE reveal part
 * of ONE card other than ~. Written `{ref:'costRevealed'}`: the card in the hand, read there or as it last existed (effects/refs.ts).
 */
export function revealedMentions(cost: CostDef): Mention[] {
  const parts = (cost.other ?? []).filter((c) => c.kind === 'reveal');
  const p = parts[0];
  if (parts.length !== 1 || p === undefined || p.kind !== 'reveal' || p.self === true || p.count !== 1) return [];
  return [{ sort: 'object', number: 'singular', heads: headsOfFilter(p.filter, 'other'), verbs: ['revealed'], ref: { ref: 'costRevealed' }, origin: 'event', unit: -1, participleOnly: true }];
}

/**
 * FAST3 T18: what a cost sacrificed ("Sacrifice a creature: You gain life equal to the sacrificed creature's toughness"; CR 602.2b, 601.2b), as a mention
 * only "the sacrificed <noun>" can name (Mention.participleOnly: a bare "it" never means it, so no other reading changes). Only a cost with ONE sacrifice
 * part of ONE permanent other than ~: with several, "the sacrificed creature" could be any of them. Written `{ref:'costSacrificed'}`, read from last known
 * information (CR 608.2h; effects/refs.ts).
 */
export function sacrificedMentions(cost: CostDef): Mention[] {
  const parts = (cost.other ?? []).filter((c) => c.kind === 'sacrifice');
  const p = parts[0];
  if (parts.length !== 1 || p === undefined || p.kind !== 'sacrifice' || p.self === true || p.count !== 1) return [];
  return [{ sort: 'object', number: 'singular', heads: headsOfFilter(p.filter, 'battlefield'), verbs: ['sacrificed'], ref: { ref: 'costSacrificed' }, origin: 'event', unit: -1, participleOnly: true }];
}

function activated(seg: AbilitySegment, face: FaceInfo, ue: UnitEnv, acc: Acc): AbilityDef[] {
  const first = adaptTokens(seg.sentences[0]?.tokens ?? []);
  const colon = first.findIndex((t) => t.kind === 'PUNCT' && t.norm === ':');
  if (colon <= 0) return [manualAbility(seg, 'activated', 'no cost before the colon (CR 602.1a)')];
  const costToks = first.slice(0, colon);
  const scratch = newAcc();
  const cost = costOf(costToks, ioOf(face, scratch), ue);
  use(acc, cost.templates, cost.experimental); // the cost stays understood (and paid by the engine) on every path below
  claim(scratch, span(first.slice(colon, colon + 1)), 'consumed', 'cost');
  const limits = activationLimits(piecesOf(seg.sentences, first.slice(colon + 1)), ioOf(face, scratch), ue, { costChange: true });
  use(scratch, limits.extras.templates, limits.extras.experimental); // T38: the template that read "This ability costs {1} less to activate ..."
  const text = piecesText(face, limits.pieces) + (seg.modal ? ` ${seg.text.split('\n').slice(1).join(' ')}` : '');
  // CR 605.1a: decided from the shape of the ability (no target, could add mana), not from what the templates automated
  // std-copy-3 (CR 605.1a, 603.2): "When that mana is spent to cast ..., copy that spell and you may choose new targets for the copy" is a triggered ability the mana
  // carries, not a target of this ability: its words don't make the ability a non-mana ability
  const manaShape = !/\btargets?\b/i.test(text.replace(/\bwhen that mana is spent\b[^.]*\./gi, '')) && ADDS_MANA.test(unquoted(text));
  // CR 113.6j, 113.6m: where the cost or the effect needs ~ when that is not the battlefield ("Discard ~", "Exile ~ from your graveyard", "Return ~ from
  // your graveyard"); the engine offers the ability only from `zone` (rules/abilities.ts#activationZones), so a zone that cannot be stated is manual
  const where = activationZone(cost.cost, `${text} ${limits.text}`, limits.fields.onlyIf);
  const zone0 = 'zone' in where && where.zone !== undefined ? { zone: where.zone } : {};
  // FAST1 T4 (CR 702.177a): a wrapper keyword written before the cost ("Exhaust -- {3}{G}: ...") gives the ability its restrictions (ParseOptions.keywords[].wraps).
  // The ability may state none of its own: its text is then the keyword, the cost and the effect (render/abil.ts prints only the keyword).
  const wraps = seg.wrapper ? ue.opts.keywords.find((k) => k.name.toLowerCase() === seg.wrapper!.keyword)?.wraps : undefined;
  // cloud std-dsk (CR 702.177a, 602.5b): a restriction of the ability's own that the keyword does not give is added to the keyword's ("Exhaust -- {5}{B}: ... Activate only as
  // a sorcery.": once, and as a sorcery); the same restriction from both, or a zone from both, is a clash the model cannot state
  const ownRestrictions = Object.entries(limits.fields).filter(([, v]) => v !== undefined).map(([k]) => k);
  const wrapClash = seg.wrapper !== undefined && (wraps === undefined || ownRestrictions.some((k) => (wraps as Record<string, unknown>)[k] !== undefined) || (wraps.zone !== undefined && zone0.zone !== undefined));
  const fields = { ...limits.fields, ...(wraps && !wrapClash ? { ...wraps } : {}) };
  const zone = wraps?.zone && !wrapClash ? {} : zone0;
  const modal = withModes(seg, joinChooseColor(limits.pieces), undefined, face);
  const manual = (reason: string): AbilityDef[] => {
    acc.claims.push(...scratch.claims);
    acc.diagnostics.push(...scratch.diagnostics);
    // on a manual ability `onlyIf` is always attested (types/ability.ts#ManualAbilityDef, CR 602.5b)
    // a manual ability keeps the wrapper keyword's restrictions too, whatever else it states (it is still activated only as the keyword says)
    // MX5: a manual ability is activated by hand by its controller only (`anyPlayer` is read for automated abilities alone; its text still says it)
    const { onlyIf, anyPlayer: _anyPlayer, xMin: _xMin, tapForMana: _tapForMana, uncopiable: _uncopiable, ...rest } = { ...limits.fields, ...(wraps ?? {}) }; // std-rx12: X is announced by hand there too; std-rx27: a manual ability is paid as its cost says (tapping instead is not offered, never an overcharge of what may be paid)
    const only = onlyIf === undefined ? {} : { onlyIf: onlyIf.cond === 'ask' ? onlyIf : { cond: 'ask' as const, text: limits.text } };
    // T38: the ability's own cost change ("This ability costs {1} less to activate ...") is not part of a manual ability, which the engine charges exactly its `cost`:
    // the mana cost is then confirmed by the controller instead of being charged in full (never an overcharge, CR 118.7, 601.2f)
    const costed = limits.extras.costChange === undefined ? cost.cost : { ...cost.cost, mana: undefined, other: [...(cost.cost.other ?? []), { kind: 'manual' as const, text: 'the mana cost of this ability, lowered as its text says' }] };
    if (costed.mana === undefined) delete costed.mana;
    return [manualAbility(seg, 'activated', reason, { cost: costed, ...rest, ...only, ...zone, ...(manaShape ? { mana: true } : {}) })];
  };
  if ('manual' in where) return manual(where.manual);
  if (wrapClash) return manual(`the keyword ${seg.wrapper!.keyword} gives this ability its restrictions, and the ability states restrictions of its own (CR 702.177a, 602.5b)`);
  if (typeof modal === 'string') return manual(modal);
  const built = buildProgram(modal.pieces.map((tokens) => ({ tokens })), face, ue, scratch, { ...(modal.modes ? { modes: modal.modes } : {}), mentions: costMentions(cost.cost, face) });
  for (const m of cost.manual) scratch.diagnostics.push({ level: 'manual', code: 'no-template', message: `cost: ${m.reason}: "${textAt(face, m.range)}"`, range: m.range });
  if (cost.understood === 0 && !built.understood) return manual(cost.manual[0]?.reason ?? 'not understood');
  const isMana = manaShape && !hasTargets(built.program) && (hasAddMana(scratch.untainted.get(built.program) ?? built.program) || ADDS_MANA.test(unquoted(text)));
  // a mana ability resolves at once, even in the middle of a payment: it cannot ask (CR 605.3b), so one that is not fully automated is run by hand
  if (isMana && (!built.complete || cost.manual.length > 0)) return manual(cost.manual.length > 0 ? cost.manual[0]!.reason : 'a mana ability whose effect is not fully understood (CR 605.3b)');
  if (isMana && !onlyAddMana(built.program)) return manual('a mana ability with an instruction other than adding mana: the mana path runs only addMana steps (CR 605.3b)');
  acc.claims.push(...scratch.claims);
  acc.diagnostics.push(...scratch.diagnostics);
  use(acc, scratch.templates, scratch.experimental);
  scratch.untainted.forEach((v, k) => acc.untainted.set(k, v));
  // std-control-1 (CR 400.7, 602.2b): "{3}, Exile this card from your hand: Target land gains ... until this card is cast from exile. You may cast this card for as long as
  // it remains exiled.": the card the cost exiled is a new object in exile, and "this card" of the effect is that card (`costExiled` self), never the card that was in the hand
  if ((cost.cost.other ?? []).some((p) => p.kind === 'exileFrom' && p.self === true && p.zone === 'hand')) {
    selfIsExiledCard(built.program);
    const untainted = scratch.untainted.get(built.program);
    if (untainted !== undefined && untainted !== built.program) selfIsExiledCard(untainted);
  }
  const def: ActivatedAbilityDef = { kind: 'activated', text: seg.text, src: [...seg.lines], prov: { by: 'template' }, cost: cost.cost, effect: built.program, ...fields, ...zone, ...(limits.extras.costChange !== undefined ? { costChange: limits.extras.costChange } : {}), ...(limits.extras.costChangeIf !== undefined ? { costChangeIf: limits.extras.costChangeIf } : {}) };
  if (isMana) def.isMana = true; // CR 605.1a
  if (seg.wrapper) def.keyword = seg.wrapper.keyword; // FAST1 T4
  return [def];
}

/**
 * std-control-1 (CR 400.7, 602.2b): in the effect of an ability whose cost exiled its own card from the hand, "this card" is the card in exile: each `{ref:'self'}` becomes
 * `{ref:'costExiled', self: true}` and each object filter `{self: true}` (the spell of "until this card is cast from exile") the filter of that card. In place: the
 * program keeps its identity (the untainted map is keyed by it).
 */
function selfIsExiledCard(program: unknown): void {
  const EXILED = { ref: 'costExiled', self: true };
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach((x, i) => { if (isSelfRef(x)) v[i] = { ...EXILED }; else walk(x); }); return; }
    if (v === null || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    // a quoted ability granted to another object, a token's or an emblem's: its "this ..." is the object that has it (CR 113.7a), never this card
    if (typeof o['kind'] === 'string' && ABILITY_KINDS.has(o['kind'])) return;
    for (const [k, x] of Object.entries(o)) {
      if (isSelfRef(x)) o[k] = { ...EXILED };
      else if ((k === 'spell' || k === 'subject' || k === 'object') && isSelfFilter(x)) o[k] = { is: { ...EXILED } };
      else walk(x);
    }
  };
  walk(program);
}
const ABILITY_KINDS: ReadonlySet<string> = new Set(['activated', 'triggered', 'static', 'keyword', 'spell', 'manual', 'loyalty']);
const isSelfRef = (x: unknown): boolean => x !== null && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length === 1 && (x as Record<string, unknown>)['ref'] === 'self';
const isSelfFilter = (x: unknown): boolean => x !== null && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length === 1 && (x as Record<string, unknown>)['self'] === true;

function loyalty(seg: AbilitySegment, face: FaceInfo, ue: UnitEnv, acc: Acc): AbilityDef[] {
  const l = seg.loyalty!;
  // std-r9 (CR 606.4, 107.3a): "−X" is announced as it is activated (CostDef.loyaltyX); "+X" stays manual
  if (l.amount === 'X' && l.sign !== '-') return [manualAbility(seg, 'activated', 'a loyalty cost of +X (CR 606.4) is not supported by this parser version')];
  const cost: CostDef = l.amount === 'X' ? { loyaltyX: true } : { loyalty: l.sign === '-' ? -l.amount : l.amount };
  // CR 606.3 already makes a loyalty ability sorcery-speed and once per turn; any other "Activate only ..." is a restriction (CR 602.5b), never an effect
  const limits = activationLimits(piecesOf(seg.sentences), ioOf(face, acc), ue);
  const only = limits.fields.onlyIf ? { onlyIf: limits.fields.onlyIf } : {};
  const modal = withModes(seg, limits.pieces, undefined, face);
  if (typeof modal === 'string') return [manualAbility(seg, 'activated', modal, { cost, ...(limits.fields.onlyIf ? { onlyIf: limits.fields.onlyIf.cond === 'ask' ? limits.fields.onlyIf : { cond: 'ask' as const, text: limits.text } } : {}) })];
  const built = buildProgram(modal.pieces.map((tokens) => ({ tokens })), face, ue, acc, modal.modes ? { modes: modal.modes } : {});
  return [{ kind: 'activated', text: seg.text, src: [...seg.lines], prov: { by: 'template' }, cost, isLoyalty: true, effect: built.program, ...only, ...(limits.fields.limit ? { limit: limits.fields.limit } : {}) }];
}

/**
 * "This ability triggers only N times each turn." (CR 603.2h); anything else after "This ability triggers only" is a restriction the model cannot state.
 * FAST5X E17: "This ability triggers only once." (no "each turn"): once for the object (`per: 'game'`, remembered on the object, triggers/collect.ts#applyLimit),
 * so the same card as a new object may trigger again (CR 400.7); it is used up only when it triggers (after an intervening "if" held, CR 603.4).
 */
/**
 * FAST5X E21 (CR 603.2h): the effect a "Do this only once each turn" limits: one optional action (a `may` step). Cloud std-spm: or that `may` followed only by
 * instructions that run only if the player took it ("you may discard a card. If you do, draw a card."): `if` steps on its "if you do", without an "otherwise".
 * Taking the action is what is counted (effects/run.ts), and an ability that no longer triggers loses nothing then: every later step needed the action.
 */
function onceAction(steps: readonly EffectStep[]): boolean {
  // std-rx27 (CR 603.2h): or "look at the top card of your library. You may cast that card without paying its mana cost. Do this only once each turn." (Planetarium
  // of Wan Shi Tong): looks, then one optional cast, which is the action (onceActionStep)
  if (onceCastAt(steps) !== null) return true;
  const [first, ...rest] = steps;
  if (first?.op !== 'may') return false;
  return rest.every((s) => s.op === 'if' && s.else === undefined && s.guard === undefined && s.cond.cond === 'did' && s.cond.step === first.as && first.as !== undefined
    && s.cond.not !== true && s.cond.which === undefined && s.cond.to === undefined);
}

/** std-rx27 (CR 603.2h): the index of the optional cast a "do this only once each turn" limits when the steps are only looks followed by it, else null. */
function onceCastAt(steps: readonly EffectStep[]): number | null {
  const last = steps.length - 1;
  const cast = steps[last];
  if (last < 1 || cast?.op !== 'cast' || cast.optional !== true) return null;
  return steps.slice(0, last).every((s) => s.op === 'look') ? last : null;
}

/** The step a "do this only once each turn" counts (CR 603.2h): the optional cast after looks (std-rx27), else the first step, a `may`. */
function onceActionStep(steps: EffectStep[]): EffectStep | undefined {
  const at = onceCastAt(steps);
  return at !== null ? steps[at] : steps[0];
}

export function triggerLimitOf(p: readonly Tok[]): { per: 'turn' | 'game'; max: number } | 'unknown' | null {
  const w = norms(p);
  if (!w.startsWith('this ability triggers only ')) return null;
  if (w === 'this ability triggers only once .') return { per: 'game', max: 1 };
  const m = /^this ability triggers only (once|twice|three times|four times) each turn \.$/.exec(w);
  return m ? { per: 'turn', max: TIMES[m[1]!]! } : 'unknown';
}

/**
 * CR 603.4: the readings of an intervening "if" at the start of `rest` (the tokens right after the trigger clause; `rest[0]` is "if"): one per comma that ends a
 * whole condition, its pronouns resolved against the trigger's event roles (design 6.4) and keyed by comma and JSON, so more than one entry is two readings
 * (guard G5). `at` is the comma's index in `rest`. The one reader of a printed trigger (`triggered`) and of a quoted, granted one (lower/quoted.ts, cmd1).
 */
export function interveningIfReads(rest: readonly Tok[], trigger: TriggerDef, face: Pick<FaceInfo, 'selfHeads'>, env: HoleEnv): { at: number; value: unknown }[] {
  const reads = new Map<string, { at: number; value: unknown }>();
  rest.forEach((x, j) => {
    if (x.kind !== 'PUNCT' || x.norm !== ',') return;
    for (const a of runHole('Cond', rest.slice(1, j), 0, env)) {
      if (a.end !== j - 1) continue;
      const resolved = resolveCondAnaphors(a.value, trigger, face);
      const value0 = resolved === null ? null : otherThanEventSubject(resolved, trigger, face);
      const value = value0 === null ? null : selfAsItLeft(value0, trigger, rest.slice(1, j));
      if (value !== null) reads.set(`${j}|${canonicalJson(value)}`, { at: j, value });
    }
    // Standard round 3, r3-trig (CR 601.2i, 603.4, 400.7): "if you've cast another spell this turn," of a cast trigger of the spell itself (Sage of the Skies): a spell you
    // cast this turn other than the source, which is that spell on the stack (rules/history.ts compares the history entry's spell with the source). Read here and not
    // in the Cond hole, where FAST4 T32's "~ costs {2} less to cast if you've cast another spell this turn" (the spells cast before this one) has its own reading
    const words = rest.slice(1, j).map((t) => t.norm).join(' ');
    if (castSelfOnly(trigger) && (words === "you've cast another spell this turn" || words === 'you have cast another spell this turn')) {
      const value = { cond: 'happened', event: { ev: 'cast', player: 'you', spell: { other: true, zone: 'stack' } }, scope: 'turn', times: { op: '>=', value: 1 } };
      reads.set(`${j}|${canonicalJson(value)}`, { at: j, value });
    }
    // Standard round 3, r3-trig (CR 606.4, 603.4): "if you removed two or more loyalty counters to activate it," of "Whenever you activate a loyalty ability" (Way of the
    // Mind Sculptor): the loyalty counters the cost of the activated ability removed (the activation's `loyaltyRemoved`, fixed as the cost was paid; "it" is that ability)
    const removed = /^you removed (\w+) or more loyalty counters to activate it$/.exec(words);
    const n = removed ? NUMBER_WORDS[removed[1]!] : undefined;
    if (n !== undefined && trigger.on.length === 1 && trigger.on[0]!.ev === 'activate' && trigger.on[0]!.ability === 'loyalty' && trigger.on[0]!.player === 'you') {
      const value = { cond: 'compare', left: { q: 'loyaltyRemoved' }, op: '>=', right: n };
      reads.set(`${j}|${canonicalJson(value)}`, { at: j, value });
    }
  });
  return [...reads.values()];
}


/**
 * std-rx31 (CR 603.10a, 603.4, 700.4): "When Tom, Bert, and William die, if they were a creature, ...": in a trigger on the object itself leaving the battlefield, a
 * past-tense condition on "~" ("~ was a creature", "~ were a creature") asks what the object was as it left (its last known information, the event's subject), not
 * what the card is now in its new zone (a card in a graveyard is a creature card again). Only one event, the object itself from the battlefield, and only when the
 * condition's words are in the past tense ("was", "were").
 */
function selfAsItLeft(value: unknown, trigger: TriggerDef, words: readonly Tok[]): unknown {
  const [ev] = trigger.on;
  const self = trigger.on.length === 1 && ev !== undefined && ev.ev === 'zoneChange' && ev.from === 'battlefield' && JSON.stringify(ev.subject) === JSON.stringify({ self: true });
  if (!self || !words.some((t) => t.norm === 'was' || t.norm === 'were')) return value;
  return rewrite(value, (n) => (n['cond'] === 'matches' && isRec(n['object']) && n['object']['ref'] === 'self' ? { ...n, object: { ref: 'event', role: 'subject' } } : undefined));
}

/** Standard round 3, r3-trig: the trigger is the cast trigger of the spell itself ("When you cast this spell"), one event. */
const castSelfOnly = (trigger: TriggerDef): boolean => trigger.on.length === 1 && trigger.on[0]!.ev === 'cast' && trigger.on[0]!.spell?.self === true;

/** Resolve the pronouns of an intervening "if" against the trigger's event roles (design 6.4, CR 603.4); null when one does not resolve uniquely. */
function resolveCondAnaphors(value: unknown, trigger: TriggerDef, face: Pick<FaceInfo, 'selfHeads'>): unknown {
  const mentions = eventMentions(trigger.on, trigger.batch === true, face.selfHeads, trigger.wholeBatch === true);
  let ok = true;
  const out = rewrite(value, (node) => {
    if (!ok || !isRec(node['$anaphor'])) return undefined;
    const r = resolveAnaphor(node['$anaphor'] as unknown as AnaphorInfo, mentions);
    if (!r.ok) { ok = false; return undefined; }
    return JSON.parse(JSON.stringify(r.mention.ref)) as unknown;
  });
  // M6-5a: "if it was kicked" (parser/holes/cond.ts): `wasCast` reads the cast history of the ability's own object, so the pronoun must be that object
  // (CR 603.6a: the object's own enters trigger); any other antecedent keeps the marker, and the intervening "if" stays manual
  const castTrigger = castOnly(trigger.on);
  const own = ok ? rewrite(out, (node) => {
    // FAST5 T51 (CR 601.2h): "the colors of mana spent to cast that spell": the spell of a cast trigger (lower/anaphora.ts#castSpellMarker)
    const spell = castSpellMarker(node, castTrigger);
    if (spell !== null) return spell === 'drop' ? withoutKey(node, '$spell') : undefined;
    // M6-5: also "if it was kicked twice" (a `compare` of `kickCount`, CR 702.33d), which reads the same cast record
    // p2-intervening-2: also a `happened` of the source's own history ("if it dealt combat damage to a player this turn", parser/holes/p2iv2.ts)
    if (!('$self' in node) || (node['cond'] !== 'wasCast' && node['cond'] !== 'compare' && node['cond'] !== 'happened')) return undefined;
    const { $self, ...rest } = node;
    if (isRec($self) && $self['ref'] === 'self' && Object.keys($self).length === 1) return rest;
    // p2-intervening-2 (CR 603.10a, 120.1): "When this creature dies, if it dealt combat damage to a player this turn": in a trigger on the source itself leaving the
    // battlefield, "it" is the source as it last existed, whose own history this turn the condition reads (`happened` / `happenedCount` only)
    const [ev0] = trigger.on;
    const selfLeaves = trigger.on.length === 1 && ev0?.ev === 'zoneChange' && ev0.from === 'battlefield' && JSON.stringify(ev0.subject) === JSON.stringify({ self: true });
    const ownHistory = node['cond'] === 'happened' || (node['cond'] === 'compare' && isRec(node['left']) && node['left']['q'] === 'happenedCount');
    if (selfLeaves && ownHistory && isRec($self) && $self['ref'] === 'event' && $self['role'] === 'subject' && Object.keys($self).length === 2) return rest;
    // std-tdm (CR 601.2a, 603.4, 400.7d): "Whenever a creature you control enters, if you cast it, ...": "you cast it" of the object that entered reads THAT object's
    // cast record (`wasCast.object`); only the caster part, only for the subject of a trigger whose events are all enters
    const entered = isRec($self) && $self['ref'] === 'event' && $self['role'] === 'subject' && Object.keys($self).length === 2
      && trigger.batch !== true && trigger.on.every((e) => e.ev === 'zoneChange' && e.to === 'battlefield');
    if (entered && node['cond'] === 'wasCast' && rest['by'] === 'you' && Object.keys(rest).length === 2) return { ...rest, object: { ref: 'event', role: 'subject' } };
    // p2-intervening-1 (CR 601.2a, 603.4, 400.7d; parser/holes/p2iv1.ts): also "it was cast" / "it wasn't cast" and "you (didn't) cast it from your hand" of the object that
    // entered (a spell is cast from its caster's own hand, CR 601.2a): that object's cast record, nothing else of it
    if (entered && node['cond'] === 'wasCast' && (Object.keys(rest).length === 1 || (Object.keys(rest).length === 2 && rest['from'] === 'hand'))) return { ...rest, object: { ref: 'event', role: 'subject' } };
    // p2-intervening-1 (CR 702.33d, 603.4): "Whenever you cast a spell, if that spell was kicked, ...": the cast record of the spell the cast trigger names
    const spellOfCast = castTrigger && isRec($self) && $self['ref'] === 'event' && $self['role'] === 'spell' && Object.keys($self).length === 2;
    if (spellOfCast && node['cond'] === 'wasCast' && rest['kicked'] === true && Object.keys(rest).length === 2) return { ...rest, object: { ref: 'event', role: 'spell' } };
    return node;
  }) : out;
  return ok && leftoverMarker(own) === null ? own : null;
}

/**
 * FAST5 T62 (CR 603.4, 608.2): "other" in an intervening "if" of a trigger about an object it describes ("Whenever a Forest you control enters, if you control at
 * least five other Forests") is other than THAT object, the Forest that entered. The filter's `other` is "other than the source", which differs from it unless the
 * source is the event's object. So in an enters-the-battlefield trigger about a described object (not the source, not "another ..."), a described object of the same
 * subtypes that the source's own face could not be is read as "not the object of the event". When the source could be one of them the two readings differ and the
 * filter stays as it was (the owner of the shape decides).
 */
function otherThanEventSubject(value: unknown, trigger: TriggerDef, face: Pick<FaceInfo, 'selfHeads'>): unknown {
  const p = trigger.on.length === 1 ? trigger.on[0]! : undefined;
  if (p?.ev !== 'zoneChange' || p.to !== 'battlefield' || p.from !== undefined || p.subject.self === true || p.subject.other === true) return value;
  const subjectSubtypes = p.subject.subtypes ?? [];
  if (subjectSubtypes.length === 0) return value;
  return rewrite(value, (node) => {
    if (node['other'] !== true || node['not'] !== undefined || node['is'] !== undefined || node['anyOf'] !== undefined) return undefined;
    const subs = Array.isArray(node['subtypes']) ? (node['subtypes'] as string[]) : [];
    if (subs.length === 0 || !subs.every((x) => subjectSubtypes.includes(x)) || subs.some((x) => face.selfHeads.includes(x.toLowerCase()))) return undefined;
    const { other: _other, ...rest } = node;
    return { ...rest, not: { is: { ref: 'event', role: 'subject' } } };
  });
}

/**
 * std-combat-1 (CR 603.2, 701.3a; Eriette, the Beguiler): the references inside the descriptions of a "becomes attached" event ("an Aura you control becomes attached to a
 * nonland permanent ... with mana value less than or equal to that Aura's mana value"): a reference in the description of one object of the event names another role of
 * the event, never that object itself (a description compared with its own statistic says nothing), by the unique-candidate rule (design 6.4). The attached object
 * (`object`) is the event's `subject`, the permanent it became attached to (`by`) its `object` (triggers/match.ts). Null when one does not resolve.
 */
function resolveAttachAnaphors(on: readonly EventPattern[], face: Pick<FaceInfo, 'selfHeads'>): EventPattern[] | null {
  const mentions = eventMentions(on as EventPattern[], false, face.selfHeads, false);
  const out: EventPattern[] = [];
  for (const p of on) {
    const q = { ...p } as Record<string, unknown>;
    for (const [key, role] of [['object', 'subject'], ['by', 'object']] as const) {
      if (q[key] === undefined) continue;
      const others = mentions.filter((m) => !(isRec(m.ref) && m.ref['ref'] === 'event' && m.ref['role'] === role));
      let ok = true;
      q[key] = rewrite(q[key], (node) => {
        if (!ok || !isRec(node['$anaphor'])) return undefined;
        const r = resolveAnaphor(node['$anaphor'] as unknown as AnaphorInfo, others);
        if (!r.ok) { ok = false; return undefined; }
        return JSON.parse(JSON.stringify(r.mention.ref)) as unknown;
      });
      if (!ok) return null;
    }
    out.push(q as unknown as EventPattern);
  }
  return leftoverMarker(out) === null ? out : null;
}

/**
 * std-combat-3 (CR 603.10a, 109.4): the player references inside the description of an object that leaves the battlefield ("... creatures that player controls dies",
 * "... they control dies"): the event's player, the one who controlled it as it left, by the unique-candidate rule among the event's player roles (design 6.4).
 * Only player references; any other reference left in the pattern keeps it unread. Null when one does not resolve.
 */
function resolveLeavingPlayerAnaphors(on: readonly EventPattern[], face: Pick<FaceInfo, 'selfHeads'>): EventPattern[] | null {
  const players = eventMentions(on as EventPattern[], false, face.selfHeads, false).filter((m) => m.sort === 'player');
  let ok = true;
  const out = rewrite(on, (node) => {
    if (!ok || !isRec(node['$anaphor'])) return undefined;
    const a = node['$anaphor'] as unknown as AnaphorInfo;
    if (a.sort !== 'player' && !(a.sort === 'any' && a.text === 'they')) { ok = false; return undefined; }
    const r = resolveAnaphor(a, players);
    if (!r.ok) { ok = false; return undefined; }
    return JSON.parse(JSON.stringify(r.mention.ref)) as unknown;
  }) as EventPattern[];
  return ok && leftoverMarker(out) === null ? out : null;
}

function triggered(seg: AbilitySegment, face: FaceInfo, ue: UnitEnv, acc: Acc): AbilityDef[] {
  const first = adaptTokens(seg.sentences[0]?.tokens ?? []);
  const commas = first.flatMap((t, i) => (t.kind === 'PUNCT' && t.norm === ',' ? [i] : []));
  const found = new Map<string, { at: number; trigger: TriggerDef; templates: string[]; experimental: string[] }>();
  let failure: ManualInfo = { code: 'no-template', reason: 'no trigger template matches the trigger clause (CR 603.1)' };
  for (const c of commas) {
    const r = parseWhole(first.slice(0, c), 'trigger', ue);
    if (!r.ok) { if (r.manual.code !== 'no-template' && r.manual.code !== 'unknown-word') failure = r.manual; continue; }
    // CLOUD C5 (CR 607.2d): "whenever a player casts a spell of the chosen color": the color the face's "As ~ enters, choose a color." chose
    let v = resolveFaceChoices(r.value, face.choices) as Partial<TriggerDef>;
    // FAST5X E21 (CR 603.1, 603.2): a pronoun of the event's condition names a role of the event ("whenever ~ becomes tapped while it has a -1/-1 counter on it")
    if (Array.isArray(v.on) && v.on.length > 0 && v.while !== undefined && leftoverMarker(v.while) !== null) {
      const w = resolveCondAnaphors(v.while, { on: v.on, ...(v.batch === true ? { batch: true } : {}) }, face);
      if (w === null) continue;
      v = { ...v, while: w as Condition };
    }
    // std-combat-1 (CR 603.2, 701.3a, 202.3; Eriette, the Beguiler): "Whenever an Aura you control becomes attached to a nonland permanent an opponent controls with mana value
    // less than or equal to that Aura's mana value": a reference in the description of one object of the event names the other object of the same event (the Aura,
    // its `subject`), read as the event happens (triggers/match.ts passes the event to the filter). Only the attach event, which looks back at nothing (CR 603.10)
    if (Array.isArray(v.on) && v.on.length > 0 && v.on.every((p) => p.ev === 'becomes' && p.what === 'attached') && leftoverMarker(v.on) !== null) {
      const on = resolveAttachAnaphors(v.on, face);
      if (on === null) continue;
      v = { ...v, on };
    }
    // std-combat-3 (CR 603.10a, 109.4; Kraven the Hunter): "Whenever a creature an opponent controls with the greatest power among creatures that player controls dies":
    // a player reference inside the description of the object that leaves the battlefield names the event's player (the player who controlled it, as it last existed);
    // the pattern is then read on the battlefield as it was (triggers/lookback-board.ts)
    if (Array.isArray(v.on) && v.on.length > 0 && v.on.every((p) => p.ev === 'zoneChange' && p.from === 'battlefield') && leftoverMarker(v.on) !== null) {
      const on = resolveLeavingPlayerAnaphors(v.on, face);
      if (on === null) continue;
      v = { ...v, on };
    }
    if (!Array.isArray(v.on) || v.on.length === 0 || leftoverMarker(v) !== null) continue;
    // FAST4 T27: a condition of the trigger event ("while ...", "during ...") and "for the first time each turn" come from the template (CR 603.1, 603.2)
    const trig: TriggerDef = {
      on: v.on, ...(v.batch === true || r.d.flags.includes('batch') ? { batch: true } : {}),
      // CLOUD std-misc (CR 603.2c): "one or more players ..."; Standard merge wave 3: also the event hole's flag ("one or more of your opponents are attacked", std-tmt)
      ...((v.wholeBatch === true && v.batch === true) || (r.d.flags.includes('wholeBatch') && r.d.flags.includes('batch')) ? { wholeBatch: true as const } : {}),
      ...(v.while !== undefined ? { while: v.while } : {}), ...(v.first === 'turn' ? { first: 'turn' as const } : {}),
    };
    found.set(`${c}|${canonicalJson(trig)}`, { at: c, trigger: trig, templates: r.d.templatesUsed, experimental: r.d.experimental });
  }
  const trimmed = (at: number): Tok[] => first.slice(at + 1);
  let pieces = piecesOf(seg.sentences, commas.length > 0 ? trimmed(commas[0]!) : []);
  // CR 603.2h: "This ability triggers only ..." is a restriction of the trigger, never an effect sentence
  let limit: { per: 'turn' | 'game'; max: number; action?: true } | undefined;
  let unknownLimit: Tok[] | undefined;
  pieces = pieces.filter((p, i) => {
    const l = i > 0 ? triggerLimitOf(p) : null;
    if (l === null) return true;
    if (l === 'unknown' || limit !== undefined) unknownLimit = p;
    else { limit = l; claim(acc, span(p), 'consumed', 'trigger-limit'); }
    return false;
  });

  const manualTrigger = (reason: string, at: number | undefined, trigger?: TriggerDef, into: Acc = acc, extra: Partial<ManualAbilityDef> = {}): AbilityDef[] => {
    // the effect is kept when it was understood: "Trigger now" then goes through announcement (design 6.6, 10.1). It is lowered with the trigger's event
    // roles when the trigger was understood; otherwise those roles are unknown (an opaque mention): no pronoun of the effect can be resolved (design 6.4)
    let effect: EffectProgram | undefined;
    if (at !== undefined || commas.length > 0) {
      const ps = pieces.slice();
      ps[0] = trimmed(at ?? commas[0]!);
      const modal = withModes(seg, ps, undefined, face, ue.env);
      if (typeof modal !== 'string') {
        const scratch = newAcc();
        const built = buildProgram(modal.pieces.map((tokens) => ({ tokens })), face, ue, scratch, { ...(trigger ? { trigger } : { unknownTrigger: true }), ...(modal.modes ? { modes: modal.modes } : {}) });
        if (built.complete) {
          effect = built.program;
          into.claims.push(...scratch.claims);
          use(into, scratch.templates, scratch.experimental);
          scratch.untainted.forEach((v, k) => into.untainted.set(k, v));
          const lines = modal.modes ? [piecesText(face, [ps[0]!]), ...seg.text.split('\n').slice(1)] : [piecesText(face, modal.pieces)];
          into.kept.set(effect, { lines, ...(trigger ? { trigger } : {}) });
        }
      }
    }
    claim(into, span(at !== undefined ? first.slice(0, at + 1) : first), 'manual', undefined, reason);
    if (unknownLimit) claim(into, span(unknownLimit), 'manual', undefined, reason);
    into.diagnostics.push({ level: 'manual', code: 'no-template', message: `trigger: ${reason}`, range: span(first) });
    return [manualAbility(seg, 'triggered', reason, { ...(effect ? { effect } : {}), ...(limit ? { limit } : {}), ...extra })];
  };

  if (found.size === 0) return manualTrigger(failure.reason, undefined);
  // Cloud std-woe (guard G5, CR 603.1): a trigger clause that ends at more than one comma ("Whenever you cast a spell that's white, blue, black, or red, ...":
  // "a spell that's white" is already a whole trigger event) is read at the one comma after which the rest of the sentence is a fully understood effect, when
  // exactly one split has that; otherwise it stays manual (two splits with understood effects, or none, are still two readings)
  if (found.size > 1) {
    const whole = [...found.values()].filter((c) => {
      const ps = pieces.slice();
      ps[0] = trimmed(c.at);
      const modal = withModes(seg, ps, undefined, face);
      return typeof modal !== 'string' && buildProgram(modal.pieces.map((tokens) => ({ tokens })), face, ue, newAcc(), { trigger: c.trigger, ...(modal.modes ? { modes: modal.modes } : {}) }).complete;
    });
    if (whole.length !== 1) return manualTrigger(`the trigger clause has ${found.size} readings (guard G5)`, undefined);
    found.clear();
    found.set('whole', whole[0]!);
  }
  const t = [...found.values()][0]!;
  if (unknownLimit) return manualTrigger(`a trigger restriction the model cannot state: "${textAt(face, span(unknownLimit))}" (CR 603.2h)`, t.at, t.trigger);
  // CR 113.6k, 113.6m: an ability that functions outside the battlefield. The engine would look for it on the battlefield only, so it is a manual
  // triggered ability that functions in the zone the rules name ("Trigger now" there), with its understood effect kept
  let away = offBattlefield(t.trigger, piecesText(face, [trimmed(t.at), ...pieces.slice(1)]));
  // CMD2 (CR 113.6k, 601.2i): "When you cast this spell, ..." functions on the stack and is automated like the cycle trigger below (lower/cast-self.ts)
  // (not on an unsanctioned card, CR 100.7: cards/unsanctioned.ts makes every automated ability of it manual without its effect, so it keeps its manual one)
  if (away !== null && away.automate !== true && face.pre.context.unsanctioned !== true && castSelfAutomated(t.trigger, away)) away = { ...away, automate: true };
  // FAST5 T37 (CR 702.29d): "When you cycle ~" is automated only when its whole effect is understood (no intervening "if", no manual step): otherwise it stays
  // the manual ability that functions in the graveyard, with its understood effect kept, as before
  if (away?.automate === true) {
    let restTokens = trimmed(t.at);
    // Standard round 3, r3-trig (CR 603.4, 113.6k): a cast trigger of the spell itself may have an intervening "if" with one reading that does not name the spell
    // ("When you cast this spell, if you've cast another spell this turn, copy this spell."): it is checked as the spell is cast and again as the ability
    // resolves (the intervening "if" below); the spell is still on the stack under it. Any other trigger off the battlefield keeps the rule of FAST5 T37
    const onStack = away.zone.length === 1 && away.zone[0] === 'stack';
    let stackIf: Rec | undefined;
    if (restTokens[0]?.norm === 'if' && onStack) {
      const reads = interveningIfReads(restTokens, t.trigger, face, ue.env);
      // p2-c-cast-zone-1 (CR 603.4): the condition goes on to the whole-effect check, as the graveyard's does below ("if you have fewer than seven cards in hand, draw
      // cards equal to the difference", Kozilek, the Great Distortion: the difference is read from the condition)
      if (reads.length === 1 && !namesSelf(reads[0]!.value)) { stackIf = reads[0]!.value as Rec; restTokens = restTokens.slice(reads[0]!.at + 1); }
    }
    let whole = false;
    // r5-cost (CR 603.4, 113.6m): a trigger that functions in the graveyard may have an intervening "if" ("Whenever you attack with one or more Rats, if there are
    // seven or more cards in your graveyard, you may pay {2}{B}. If you do, return this card ...", Persistent Marshstalker): read as for any trigger below. The cycle
    // trigger (onlyAsSource) keeps FAST5 T37's rule: no intervening "if". Merge wave 8: r5-fxz read the same intervening "if" here ("At the beginning of combat on
    // your turn, if two or more creatures died this turn, return ~ ..."); one reading is kept, this one, which also passes the condition to the whole-effect check
    // and leaves a cast trigger out (Kozilek)
    let ifCond: Rec | undefined = stackIf;
    if (restTokens[0]?.norm === 'if' && away.onlyAsSource !== true && away.zone.length === 1 && away.zone[0] === 'graveyard' && t.trigger.on.every((p) => p.ev !== 'cast')) {
      const reads = interveningIfReads(restTokens, t.trigger, face, ue.env);
      if (reads.length === 1) { ifCond = reads[0]!.value as Rec; restTokens = restTokens.slice(reads[0]!.at + 1); }
    }
    if (restTokens[0]?.norm !== 'if') {
      const ps = pieces.slice();
      ps[0] = restTokens;
      const modal = withModes(seg, ps, undefined, face, ue.env);
      if (typeof modal !== 'string') {
        const built = buildProgram(modal.pieces.map((tokens) => ({ tokens })), face, ue, newAcc(), { trigger: t.trigger, ...(ifCond !== undefined ? { condition: ifCond } : {}), ...(modal.modes ? { modes: modal.modes } : {}) });
        // p2-c-cast-zone-1 (CR 113.6k, 400.7): a cast trigger's effect names the spell itself only to copy or counter it (lower/cast-self.ts#castSelfProgramSafe)
        whole = built.complete && (away.onlyAsSource !== true || cycledCardOnlyAsSource(built.program)) && (!onStack || castSelfProgramSafe(built.program));
      }
    }
    if (!whole) away = { ...away, automate: false, ...(away.manualZone !== undefined ? { zone: away.manualZone } : {}) };
  }
  if (away !== null && away.automate !== true) return manualTrigger(away.reason, t.at, t.trigger, acc, away.zone.length > 0 ? { zone: away.zone } : {});
  use(acc, t.templates, t.experimental);
  claim(acc, span(first.slice(0, t.at + 1)), 'consumed', t.templates.join(','));
  let rest = trimmed(t.at);
  // CR 603.4: "if" right after the trigger condition is an intervening "if"; its pronouns refer to the event (design 6.4)
  let interveningIf: unknown;
  if (rest[0]?.norm === 'if') {
    const reads = interveningIfReads(rest, t.trigger, face, ue.env);
    if (reads.length !== 1) return manualTrigger(reads.length === 0 ? 'an intervening "if" the model cannot state (CR 603.4)' : 'an intervening "if" with several readings (CR 603.4)', t.at, t.trigger);
    const r = reads[0]!;
    claim(acc, span(rest.slice(0, r.at + 1)), 'consumed', 'intervening-if');
    interveningIf = JSON.parse(JSON.stringify(r.value));
    // p2-c-cast-zone-1 (CR 603.4, 113.6k): in a cast trigger of the spell itself, "if it was kicked" names the cast event's spell, which is this spell on the stack:
    // the cast record of the ability's own object (no `object`), as an enters trigger's "if it was kicked" is read (Sowing Mycospawn)
    const iv = interveningIf as Rec;
    if (castSelfOnly(t.trigger) && iv['cond'] === 'wasCast' && JSON.stringify(iv['object']) === JSON.stringify({ ref: 'event', role: 'spell' }) && iv['by'] === undefined) delete iv['object'];
    rest = rest.slice(r.at + 1);
  }
  pieces[0] = rest;
  // FAST5X E21 (CR 603.2h): "you may <action>. Do this only once each turn.": a limit on taking the action (`limit.action`) when the rest of the effect is that
  // one optional action, whose result (its `as` name) says whether the player took it (effects/run.ts). Any other shape keeps the sentence as an effect
  // sentence the parser does not understand (as before: the ability stays partial)
  // cloud std-spm: also the optional action followed by instructions that need it ("you may discard a card. If you do, draw a card. Do this only once each
  // turn."; `onceAction`)
  let actionOnce: Tok[] | undefined;
  const last = pieces.length >= 2 && limit === undefined ? pieces[pieces.length - 1]! : undefined;
  if (last !== undefined && norms(last) === 'do this only once each turn .') {
    const trial = withModes(seg, pieces.slice(0, -1), undefined, face);
    const condition0 = interveningIf !== undefined ? { condition: interveningIf as Rec } : {};
    const tried = typeof trial === 'string' || trial.modes ? null : buildProgram(trial.pieces.map((tokens) => ({ tokens })), face, ue, newAcc(), { trigger: t.trigger, ...condition0 });
    if (tried?.complete === true && onceAction(tried.program.steps)) {
      actionOnce = last;
      pieces = pieces.slice(0, -1);
    }
  }
  // CMD2 (CR 603.3c, 700.2): a triggered ability's mode count may change with a condition read as it is put on the stack ("If you control a commander, you may choose both
  // instead"); r3-choose: the same environment reads a calculated number of modes (whereXModes, "choose up to X, where X is ...")
  const modal0 = withModes(seg, pieces, undefined, face, ue.env);
  if (typeof modal0 === 'string') return manualTrigger(modal0, t.at, t.trigger);
  // Standard round 3, r3-trig: "choose up to X, where X is the number of times you chose a mode for that spell" (castSpellModes)
  const castModes = modal0.modes ? castSpellModes(modal0.modes, t.trigger) : undefined;
  if (castModes === null) return manualTrigger('a number of modes that reads a spell the trigger does not name (CR 700.2, 603.3c)', t.at, t.trigger);
  const modal = castModes === undefined ? modal0 : { ...modal0, modes: castModes };
  // the intervening "if" names objects a pronoun of the effect may refer to (design 6.4; WP21 review)
  const condition = interveningIf !== undefined ? { condition: interveningIf as Rec } : {};
  const built = buildProgram(modal.pieces.map((tokens) => ({ tokens })), face, ue, acc, { trigger: t.trigger, ...condition, ...(modal.modes ? { modes: modal.modes } : {}) });
  // FAST5X E21 (CR 603.2h): "you may <action>. Do this only once each turn": the program is that one optional action, whose result (its `as` name) says whether
  // the player took it (effects/run.ts); any other shape is a restriction the model cannot state
  if (actionOnce !== undefined) {
    const only = onceAction(built.program.steps) ? onceActionStep(built.program.steps) : undefined;
    if ((only?.op !== 'may' && only?.op !== 'cast') || modal.modes) return manualTrigger('a "do this only once each turn" the model cannot state (CR 603.2h)', t.at, t.trigger); // (not reached: tried above)
    if (only.as === undefined) only.as = 'once';
    claim(acc, span(actionOnce), 'consumed', 'trigger-limit');
    limit = { per: 'turn', max: 1, action: true };
  }
  const home = homeZone(t.trigger);
  const def: TriggeredAbilityDef = {
    kind: 'triggered', text: seg.text, src: [...seg.lines], prov: { by: 'template' }, trigger: t.trigger,
    ...(interveningIf !== undefined ? { interveningIf: interveningIf as Condition } : {}),
    effect: built.program, ...(limit ? { limit } : {}),
    // M11-4 (eminence, CR 113.6b): "if ~ is in the command zone or on the battlefield" states the zones the ability functions in (it triggers from both; the
    // intervening "if" is checked again as it resolves, CR 603.4). Functioning in the command zone needs feature:zone.command (model/cap-walk.ts, M11-1)
    // FAST5 T37: "When you cycle ~" functions in the graveyard; FAST5X E6 (CR 113.6k): a trigger condition that happens in one zone the engine collects
    // triggered abilities in ("When this card becomes plotted": exile)
    ...(interveningIf !== undefined && canonicalJson(interveningIf) === canonicalJson(EMINENCE_COND)
      ? { zone: [...EMINENCE_ZONES] }
      : away !== null ? { zone: away.zone } : home !== null ? { zone: home } : {}),
  };
  // fallback (2) (AbilityResult.fallbacks): the trigger clause treated as not understood, its effect kept as lowered with an opaque trigger (design 6.6)
  // (computed only when the gate refuses the ability: it lowers the effect once more)
  acc.fallbacks.set(def, () => {
    const scratch = newAcc();
    const [asManual] = manualTrigger('the render gate or the lint refused the trigger clause (design 6.6, 6.8 G6): a manual triggered ability', t.at, undefined, scratch);
    const keptEffect = (asManual as ManualAbilityDef).effect;
    const kept = keptEffect !== undefined ? scratch.kept.get(keptEffect) : undefined;
    return keptEffect !== undefined && kept !== undefined ? [{ def: asManual!, kept }] : [];
  });
  return [def];
}

/**
 * Standard round 3, r3-trig (CR 603.4, 113.6k): does an intervening "if" of a cast trigger of the spell itself name the spell (`{ref:'self'}`, `self: true`, or
 * a marker the anaphora pass did not resolve)? Such a condition is read where the spell may have become a permanent by then (CR 400.7), so it stays manual.
 * "other" (`other: true`, "another spell") is not a mention: it excludes the spell.
 */
function namesSelf(value: unknown): boolean {
  let found = false;
  visit(value, (node) => {
    if (node['ref'] === 'self' || node['self'] === true || Object.keys(node).some((k) => k.startsWith('$'))) found = true;
  });
  return found;
}

/**
 * CLOUD std-dft (CR 702.29c, 113.7a, 609.7a): the effect of "When you cycle ~" names the cycled card (the source `{ref:'self'}` or the event's own object) only as
 * the source of damage ("it deals 1 damage to each opponent", "you may have it deal 2 damage to target creature"): the card is in the graveyard it triggered
 * from, and a source that left its zone still deals the damage with its last known information (effects/handlers/lifedamage.ts). Any other use of it (moving
 * it, counting it, a counter on it) keeps the ability manual.
 */
function cycledCardOnlyAsSource(program: EffectProgram): boolean {
  const names = (v: unknown): boolean => isRec(v) && (v['ref'] === 'self' || (v['ref'] === 'event' && (v['role'] === 'object' || v['role'] === 'subject')));
  const ok = (v: unknown, damageSource: boolean): boolean => {
    if (Array.isArray(v)) return v.every((x) => ok(x, false));
    if (!isRec(v)) return true;
    if (names(v)) return damageSource;
    return Object.entries(v).every(([k, x]) => ok(x, v['op'] === 'damage' && k === 'source'));
  };
  return ok(program, false);
}

function spell(seg: AbilitySegment, face: FaceInfo, ue: UnitEnv, acc: Acc): AbilityDef[] {
  const modal = withModes(seg, piecesOf(seg.sentences), face, undefined, ue.env); // FAST5X E22: a spell's mode count may change with a condition (CR 700.2)
  if (typeof modal === 'string') return [manualAbility(seg, 'spell', modal)];
  const scratch = newAcc();
  // FAST3 T18: what the spell's additional cost sacrificed is a mention of its effect ("the sacrificed creature", CR 601.2b, 608.2h)
  // CLOUD C8: ... and what it discarded or exiled ("the discarded card", "the exiled card"; CR 601.2b, 400.7j)
  const sacrificed = face.spellCost ? [...sacrificedMentions(face.spellCost), ...discardedMentions(face.spellCost), ...exiledMentions(face.spellCost), ...revealedMentions(face.spellCost) /* p2-refs-1 */, ...costGroupMentions(face.spellCost)] : [];
  const built = buildProgram(modal.pieces.map((tokens) => ({ tokens })), face, ue, scratch, { ...(modal.modes ? { modes: modal.modes } : {}), ...(sacrificed.length > 0 ? { mentions: sacrificed } : {}), spell: true });
  acc.diagnostics.push(...scratch.diagnostics);
  if (!built.understood) {
    // nothing automated and nothing to announce: the line stays the manual ability it was (design 6.6 row 1)
    for (const c of scratch.claims) claim(acc, c.range, 'manual', undefined, c.reason ?? 'not understood');
    return [manualAbility(seg, 'spell', scratch.diagnostics.find((d) => d.level === 'manual')?.message ?? 'not understood')];
  }
  acc.claims.push(...scratch.claims);
  use(acc, scratch.templates, scratch.experimental);
  scratch.untainted.forEach((v, k) => acc.untainted.set(k, v));
  return [{ kind: 'spell', text: seg.text, src: [...seg.lines], prov: { by: 'template' }, effect: built.program }];
}

/** r4-repl: the choices an entering body of `value` makes itself (`enters.choose`: its links), for "the chosen type" in the same body. */
function ownEntersChoices(value: unknown): { link: string; what: string }[] {
  const out: { link: string; what: string }[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isRec(v)) {
      if (v['b'] === 'enters' && Array.isArray(v['choose'])) for (const c of v['choose']) if (isRec(c) && typeof c['link'] === 'string' && typeof c['what'] === 'string') out.push({ link: c['link'], what: c['what'] });
      Object.values(v).forEach(walk);
    }
  };
  walk(value);
  return out;
}

/**
 * std-promote-3 (CR 701.43a, 603.12, 603.12a): "You may exert ~ as it attacks. When you do, create a tapped and attacking token that's a copy of target creature
 * you control. Sacrifice the token at the beginning of the next end step." (Sandstorm Crasher): the instructions of the reflexive trigger name a target, which
 * is chosen when the trigger is put on the stack, so they are lowered as a program of their own (with every later sentence of the ability) and its targets
 * become the reflexive step's. Only when the one-unit reading of std-ry8's template failed, the program has a target and no modes, and every sentence is
 * understood; the static effects, or null.
 */
function exertWhenYouDo(seg: AbilitySegment, face: FaceInfo, ue: UnitEnv, acc: Acc): StaticEffect[] | null {
  if (seg.sentences.length < 2) return null;
  const first = adaptTokens(seg.sentences[0]!.tokens);
  const p = parseWhole(first, 'static', ue);
  const rule = p.ok && leftoverMarker(p.value) === null ? p.value : undefined;
  if (!p.ok || !isRec(rule) || rule['s'] !== 'rule' || rule['rule'] !== 'mayExertAsAttacks' || Object.keys(rule).length !== 2) return null;
  const second = adaptTokens(seg.sentences[1]!.tokens);
  if (second.slice(0, 4).map((t) => t.norm).join(' ') !== 'when you do ,') return null;
  const pieces = [second.slice(4), ...seg.sentences.slice(2).map((s) => adaptTokens(s.tokens))];
  const units = pieces.map((tokens, index) => parseEffectUnit({ index, tokens }, ue));
  if (units.some((u) => u.manual)) return null;
  const t = applyTaint(lowerProgram({ units, targets: [], selfHeads: face.selfHeads, mentions: [], names: [], diagnostics: [] }).program);
  let manual = false;
  visit(t.program, (n) => { if (n['op'] === 'manual') manual = true; });
  if (manual || t.units.some((u) => u.manual) || t.program.targets.length === 0 || t.program.modes !== undefined) return null;
  use(acc, p.d.templatesUsed, p.d.experimental);
  for (const u of units) use(acc, u.templates, u.experimental);
  claim(acc, seg.range, 'consumed', [...p.d.templatesUsed, ...units.flatMap((u) => u.templates)].join(','));
  return [{ s: 'rule', rule: 'mayExertAsAttacks', then: { as: 'exerted', do: [{ op: 'reflexive', when: { did: 'exerted' }, targets: t.program.targets, do: t.program.steps }] } }];
}

function staticAbility(seg: AbilitySegment, face: FaceInfo, ue: UnitEnv, acc: Acc): AbilityDef[] {
  const def = (effects: unknown[], level: { condition?: Condition; zone?: StaticAbilityDef['zone']; otherwise?: StaticAbilityDef['otherwise'] } = {}): StaticAbilityDef =>
    ({ kind: 'static', text: seg.text, src: [...seg.lines], prov: { by: 'template' }, ...level, effects: effects as StaticEffect[] });
  // WP22 ADDITION (INTERFACE CHANGE): a static ability of several sentences is first tried as ONE unit by the ability-level templates, which may state
  // several sentences together ("As ~ enters, you may pay 2 life. If you don't, it enters tapped.", CR 614.12, 614.1c). Only an ability-level value is
  // taken this way; anything else is parsed sentence by sentence as before.
  if (seg.sentences.length > 1) {
    const all = seg.sentences.flatMap((s) => adaptTokens(s.tokens));
    const r0 = parseWhole(all, 'static', ue);
    // CLOUD C5 (CR 607.2d); r4-repl (CR 614.12a, 607.2d): and the choice the ability itself makes as the object enters ("As ~ enters, choose a creature type. ~
    // enters with a fellowship counter on it for each creature you control of the chosen type."), made before the counters are counted
    const r1 = r0.ok ? { ...r0, value: resolveFaceChoices(r0.value, [...(face.choices ?? []), ...ownEntersChoices(r0.value)]) } : r0;
    // std-ry8 (CR 701.43a, 603.12; design 6.4): "You may exert ~ as it attacks. When you do, it gets +1/+1 ...": the plain "it" of the reflexive trigger is ~, the
    // one object the ability names (lower/static-anaphora.ts); only for this ability, other multi-sentence statics keep refusing a leftover pronoun
    const exertIt = r1.ok && leftoverMarker(r1.value) === '$anaphor' && JSON.stringify(r1.value).includes('"rule":"mayExertAsAttacks"') ? resolveStaticIt(r1.value) : null;
    const r = r1.ok && exertIt !== null ? { ...r1, value: exertIt } : r1;
    const lv = r.ok && leftoverMarker(r.value) === null ? abilityLevel(r.value) : null;
    if (r.ok && lv !== null && isStaticEffects(lv.effects)) {
      use(acc, r.d.templatesUsed, r.d.experimental);
      claim(acc, span(all), 'consumed', r.d.templatesUsed.join(','));
      const { effects, ...level } = lv;
      return [def(effects, level)];
    }
    const exert = exertWhenYouDo(seg, face, ue, acc);
    if (exert !== null) return [def(exert)];
    // r3-cost (CR 602.5b, 702.122a): "Crew 1. Activate only once each turn.": a keyword with the restriction printed on its line, read whole by a template
    // whose build is that keyword with its `limit` (FAST5X E27; keywords/expand.ts puts it on the activated ability the keyword stands for)
    // r4-cost (CR 601.2f, 702.6a): ... and "Equip {4}. This ability costs {1} less to activate for each color of the creature it targets." (its `costChange`)
    if (r.ok && leftoverMarker(r.value) === null && isRec(r.value) && r.value['kind'] === 'keyword' && (isRec(r.value['limit']) || isRec(r.value['costChange']))) {
      use(acc, r.d.templatesUsed, r.d.experimental);
      claim(acc, span(all), 'consumed', r.d.templatesUsed.join(','));
      const kw = r.value as unknown as KeywordAbilityDef;
      return [{ ...kw, text: seg.text, src: [...seg.lines], prov: { by: 'keyword', id: kw.keyword } }];
    }
    // std-rh (CR 113.1, 604.1, 611.3a; Elenda, Saint of Dusk): a paragraph of statics that EACH state their own "as long as" condition ("As long as A, ~ gets
    // +1/+1 and has menace. ~ gets an additional +5/+5 as long as B.") is one static ability per sentence, each with its own condition: no condition is read
    // across a sentence (WP22). Only when every sentence is a conditional ability-level static with that condition alone (no zones, no "otherwise") and
    // understood; any other mix stays manual below. Each ability is gated against its own sentence (AbilityResult.oracles).
    const split = seg.sentences.map((s, i) => {
      if (i > 0 && s.continuation) return null;
      const toks = adaptTokens(s.tokens);
      const p = parseWhole(toks, 'static', ue);
      if (!p.ok) return null;
      const value = resolveFaceChoices(p.value, face.choices);
      const lv1 = leftoverMarker(value) === null ? abilityLevel(value) : null;
      if (lv1 === null || lv1.condition === undefined || lv1.zone !== undefined || lv1.otherwise !== undefined || !isStaticEffects(lv1.effects)) return null;
      return { s, toks, p, lv1 };
    });
    if (split.every((x) => x !== null)) {
      const out: AbilityDef[] = [];
      for (const x of split as NonNullable<(typeof split)[number]>[]) {
        use(acc, x.p.d.templatesUsed, x.p.d.experimental);
        claim(acc, span(x.toks), 'consumed', x.p.d.templatesUsed.join(','));
        const { effects: e, ...l } = x.lv1;
        out.push({ ...def(e, l), text: textAt(face, x.s.range) });
      }
      return out;
    }
  }
  const effects: unknown[] = [];
  const scratch = newAcc();
  let level: { condition?: Condition; zone?: StaticAbilityDef['zone']; otherwise?: StaticAbilityDef['otherwise'] } = {};
  for (const s of seg.sentences) {
    const toks = adaptTokens(s.tokens);
    const parsed0 = parseWhole(toks, 'static', ue);
    // CLOUD C5 (CR 607.2d): "Creatures of the chosen type get +1/+1": the type the face's "As ~ enters, choose a creature type." chose
    const parsed = parsed0.ok ? { ...parsed0, value: resolveFaceChoices(parsed0.value, face.choices) } : parsed0;
    // FAST2 T7: a plain "it" naming the one object of a one-sentence static ability (lower/static-anaphora.ts, design 6.4)
    // FAST5 T51: ... or the "it" of a cast-history condition in the entering replacement of the object itself (`$self`, CR 614.12)
    const marker0 = parsed.ok && seg.sentences.length === 1 ? leftoverMarker(parsed.value) : null;
    // cloud std-spm (CR 615.5): "that many" in a prevention's additional steps is the damage it prevented (lower/static-anaphora.ts#resolvePreventedAmount)
    // std-library-4 (CR 614.1a): ... or in a replacement's condition or `instead` steps, the replaced event's amount (lower/static-anaphora.ts#resolveReplacedAmount)
    const prevented = marker0 === '$anaphor' && parsed.ok ? resolvePreventedAmount(parsed.value) ?? resolveReplacedAmount(parsed.value) : null;
    const value0 = prevented ?? (parsed.ok ? parsed.value : null);
    const marker = prevented !== null ? leftoverMarker(prevented) : marker0;
    // p2-exile-play-1 (CR 607.2a): ... or "the exiled card" of a one-sentence static ability, the card the face's linked exiling instruction exiled (lower/p2ep1.ts)
    const resolvedIt = marker === '$anaphor' ? resolveStaticIt(value0) ?? (seg.sentences.length === 1 ? resolveStaticExiledCard(value0) : null) : marker === '$self' ? resolveEntersSelfMarker(value0) : prevented;
    const r = parsed.ok && resolvedIt !== null ? { ...parsed, value: resolvedIt } : parsed;
    if (!r.ok || leftoverMarker(r.value) !== null) {
      const reason = r.ok ? 'a reference the static template left unresolved' : r.manual.reason;
      claim(acc, seg.range, 'manual', undefined, reason);
      acc.diagnostics.push({ level: 'manual', code: r.ok ? 'unbound-reference' : r.manual.code, message: `static: ${reason}: "${textAt(face, span(toks))}"`, range: span(toks) });
      return [manualAbility(seg, 'static', reason)];
    }
    // r4-fxb (CR 702.189a, 107.3): "Firebending X, where X is ~'s power.": a keyword line whose parameter is a quantity the line states, read whole by a
    // static template whose build is that keyword (the keyword's expansion reads the quantity as its ability resolves, CR 608.2h)
    if (seg.sentences.length === 1 && isRec(r.value) && r.value['kind'] === 'keyword') {
      use(acc, r.d.templatesUsed, r.d.experimental);
      claim(acc, span(toks), 'consumed', r.d.templatesUsed.join(','));
      const kw = r.value as unknown as KeywordAbilityDef;
      return [{ ...kw, text: seg.text, src: [...seg.lines], prov: { by: 'keyword', id: kw.keyword } }];
    }
    use(scratch, r.d.templatesUsed, r.d.experimental);
    claim(scratch, span(toks), 'consumed', r.d.templatesUsed.join(','));
    const lv = abilityLevel(r.value);
    if (lv !== null) {
      // an ability-level sentence must be the ability's only sentence: a condition stated in one sentence never silently covers another (WP22)
      if (seg.sentences.length !== 1) {
        const reason = 'an ability-level static sentence (a condition or zones) in a static ability of several sentences';
        claim(acc, seg.range, 'manual', undefined, reason);
        acc.diagnostics.push({ level: 'manual', code: 'no-template', message: `static: ${reason}: "${seg.text}"`, range: seg.range });
        return [manualAbility(seg, 'static', reason)];
      }
      const { effects: e, ...l } = lv;
      level = l;
      effects.push(...e);
      continue;
    }
    effects.push(...(Array.isArray(r.value) ? r.value : [r.value]));
  }
  if (!isStaticEffects(effects)) return [manualAbility(seg, 'static', 'not a static effect')];
  acc.claims.push(...scratch.claims);
  use(acc, scratch.templates, scratch.experimental);
  return [def(effects, level)];
}

function chapter(seg: AbilitySegment, face: FaceInfo, ue: UnitEnv, acc: Acc): AbilityDef[] {
  // p2-modal-2 (CR 714.2, 700.2, 603.3c): a chapter ability with modes ("I, II, III -- Choose one at random -- • ..."): its modes are read as a triggered ability's are; a
  // header the model cannot state keeps the old reading (the sentences without the bullets, which the render gate refuses)
  const modal = seg.modal ? withModes(seg, piecesOf(seg.sentences), undefined, face, ue.env) : undefined;
  if (modal !== undefined && typeof modal !== 'string') {
    const built = buildProgram(modal.pieces.map((tokens) => ({ tokens })), face, ue, acc, modal.modes ? { modes: modal.modes } : {});
    return [{ kind: 'chapter', text: seg.text, src: [...seg.lines], prov: { by: 'template' }, chapters: [...(seg.chapters ?? [])], effect: built.program }];
  }
  const built = buildProgram(piecesOf(seg.sentences).map((tokens) => ({ tokens })), face, ue, acc, {});
  return [{ kind: 'chapter', text: seg.text, src: [...seg.lines], prov: { by: 'template' }, chapters: [...(seg.chapters ?? [])], effect: built.program }];
}

/**
 * M6-6 (m6 design 3.7, CR 719.3): a Case. "To solve -- [condition]" (the segment's sentences) is read by the condition hole, as an intervening "if" is (CR 603.4);
 * "Solved -- [ability]" is the child, lowered like any ability. A Case line without its partner, a condition that does not read exactly one way, or a solved
 * ability that is not understood keeps the whole Case manual (never half: the structure is one ability, statics/levels.ts).
 */
function caseAbility(seg: AbilitySegment, face: FaceInfo, ue: UnitEnv, acc: Acc): AbilityDef[] {
  const child = seg.children?.[0];
  if (seg.case?.solve === undefined || !child || seg.sentences.length !== 1) return [manualAbility(seg, 'static', 'a Case needs both "To solve" and "Solved" (CR 719.3)')];
  const toks = adaptTokens(seg.sentences[0]!.tokens);
  const end = toks.length > 0 && toks[toks.length - 1]!.kind === 'PUNCT' && toks[toks.length - 1]!.norm === '.' ? toks.length - 1 : toks.length;
  const reads = new Map<string, unknown>();
  for (const a of runHole('Cond', toks.slice(0, end), 0, ue.env)) {
    if (a.end !== end || leftoverMarker(a.value) !== null) continue; // the whole condition (`end` is exclusive, as in `triggered`)
    reads.set(canonicalJson(a.value), a.value);
  }
  if (reads.size !== 1) {
    const reason = reads.size === 0 ? 'a "To solve" condition the model cannot state (CR 719.3a)' : 'a "To solve" condition with several readings (CR 719.3a)';
    claim(acc, seg.range, 'manual', undefined, reason);
    acc.diagnostics.push({ level: 'manual', code: 'no-template', message: `case: ${reason}: "${seg.text}"`, range: seg.range });
    return [manualAbility(seg, 'static', reason)];
  }
  const solve = JSON.parse(JSON.stringify([...reads.values()][0])) as Condition;
  claim(acc, span(toks), 'consumed', 'case-solve');
  const inner = lowerAbility(child, face, ue);
  inner.abilities.forEach((a, k) => { const e = (a as { effect?: EffectProgram }).effect; const kk = inner.kept[k]; if (e && kk) acc.kept.set(e, kk); });
  acc.claims.push(...inner.claims);
  acc.diagnostics.push(...inner.diagnostics);
  use(acc, inner.templates, inner.experimental);
  return [{ kind: 'case', text: seg.text, src: [...seg.lines], prov: { by: 'template' }, solve, solved: inner.abilities }];
}

/**
 * FAST5X-4 (CR 702.178a-b, 113.6c): "Max speed -- [Ability]" means "As long as your speed is 4, this object has '[Ability]'". The ability after the dash (the
 * segment's one child) is lowered like any line; the result is a static ability with the keyword's condition (`seg.grant.while`), one continuous effect on the
 * object itself that adds that ability in layer 6, and the zones the granted ability states ("{3}, Exile this card from your graveyard: ...", "You may cast
 * this card from your graveyard": the max speed ability functions there too, CR 702.178b). A granted ability that is not understood keeps the whole line
 * manual (never half: the ability is had or not).
 * Cloud r3-mech (CR 614.12a, 607.2d): a Siege's "• [Word] -- [Ability]" (parser/segment.ts#siegeMode) is the same static ability with the condition "the word
 * chosen as it entered is this one" (`{cond:'chosen', link, equals}`) and `chosenMode` (the word) in place of `keyword`.
 */
function grantLine(seg: AbilitySegment, face: FaceInfo, ue: UnitEnv, acc: Acc): AbilityDef[] {
  const cm = seg.chosenMode;
  // cloud r3-mech (CR 701.64): "∞ -- [Ability]" is granted while the permanent itself is harnessed
  const harnessed: Condition = { cond: 'matches', object: { ref: 'self' }, filter: { harnessed: true } };
  const g = seg.grant ?? { keyword: cm!.word, range: cm!.range, while: cm!.word === '∞' ? harnessed : { cond: 'chosen', link: cm!.link, equals: cm!.word } as Condition };
  const child = seg.children?.[0];
  if (!child || (seg.children?.length ?? 0) !== 1) return [manualAbility(seg, 'static', `"${g.keyword} -- [ability]" needs exactly one ability after the dash (CR 702.178a)`)];
  const inner = lowerAbility(child, face, ue);
  const ab = inner.abilities.length === 1 ? inner.abilities[0]! : undefined;
  if (!ab || (ab.kind !== 'activated' && ab.kind !== 'triggered' && ab.kind !== 'static' && ab.kind !== 'keyword')) {
    const reason = !ab ? `the ability ${g.keyword} grants is several abilities (CR 702.178a)` : `the ability ${g.keyword} grants is not understood`;
    acc.diagnostics.push(...inner.diagnostics);
    return [manualAbility(seg, 'static', ab?.kind === 'manual' ? `${reason}: ${ab.reason}` : reason)];
  }
  inner.abilities.forEach((a, k) => { const e = (a as { effect?: EffectProgram }).effect; const kk = inner.kept[k]; if (e && kk) acc.kept.set(e, kk); });
  acc.claims.push(...inner.claims);
  acc.diagnostics.push(...inner.diagnostics);
  use(acc, inner.templates, inner.experimental);
  const zone = ab.kind !== 'keyword' && ab.zone !== undefined ? [...ab.zone] : undefined; // CR 702.178b, 113.6c
  const def: StaticAbilityDef = {
    kind: 'static',
    text: seg.text,
    src: [...seg.lines],
    prov: { by: 'template', id: cm ? 'r3mech:chosenMode' : `keyword:${g.keyword}` },
    ...(cm ? { chosenMode: cm.word } : { keyword: g.keyword }),
    condition: JSON.parse(JSON.stringify(g.while)) as Condition,
    effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: 6, add: [ab] }] }],
    ...(zone ? { zone } : {}),
  };
  return [def];
}

/** The permanent types (CR 110.4). Kindred is not one: a kindred card is a permanent only through its other card types. */
const PERMANENT_TYPES: ReadonlySet<string> = new Set(['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker']);

/**
 * Keywords that work only while the card is being cast or is a spell: flash (CR 702.8a), cascade (702.85a), split second (702.61a), storm (702.40a),
 * convoke (702.51a), delve (702.66a), improvise (702.126a), replicate (702.56a), casualty (702.153a), demonstrate (702.144a). FAST1 T5: a static of ~
 * granting ~ one of them ("This spell has cascade as long as ...") is dead on the battlefield, where this engine runs a static with no zone.
 */
const CAST_ONLY_KEYWORDS: ReadonlySet<string> = new Set(['flash', 'cascade', 'split second', 'storm', 'convoke', 'delve', 'improvise', 'replicate', 'casualty', 'demonstrate']);

/** A static ability of ~ that gives ~ flash (or another keyword of casting): it is about casting the card, never about a permanent (CR 702.8a). */
function grantsSelfFlash(a: StaticAbilityDef): boolean {
  return a.effects.some((e) => e.s === 'continuous' && (e.affects as { ref?: string }).ref === 'self'
    && e.mods.some((m) => m.layer === 6 && (m.add ?? []).some((x) => x.kind === 'keyword' && CAST_ONLY_KEYWORDS.has((x as KeywordAbilityDef).keyword.toLowerCase()))));
}

/**
 * W3b audit (Crashing Tide, Hero cards): an ability that states no zone functions, in this engine, only on the battlefield (statics/live.ts,
 * rules/abilities.ts#activationZones: `zone ?? ['battlefield']`). Two kinds of such ability can never do what they say, so they are manual, never full:
 *   - any static, activated or triggered ability with no zone on a face with no permanent type: an instant or sorcery never reaches the battlefield
 *     (CR 110.4), its abilities function on the stack (CR 113.6); a Conspiracy, Hero, plane or scheme card's abilities function in the command zone
 *     (CR 113.6p);
 *   - "This spell has flash as long as ..." (a static of ~ granting ~ flash): it functions in every zone the card can be cast from and on the stack
 *     (CR 113.6e, 702.8a, 601.3d), and the casting rules (rules/timing.ts#castTiming) read flash only from the card's own characteristics.
 * Returns the reason, or null when the abilities can function where the engine runs them.
 */
function deadWhereItFunctions(abilities: readonly AbilityDef[], face: FaceInfo): string | null {
  const ctx = face.pre.context;
  const permanent = ctx.types.some((t) => PERMANENT_TYPES.has(t.toLowerCase()));
  for (const a of abilities) {
    if (a.kind !== 'static' && a.kind !== 'activated' && a.kind !== 'triggered') continue;
    if (a.zone !== undefined) continue;
    // CMDF (CR 113.6n, 903.3a): a deck-construction ability functions before the game begins, in no zone of it ("~ can be your commander" on a legendary sorcery)
    if (a.kind === 'static' && a.effects.length > 0 && a.effects.every((e) => e.s === 'deckConstruction')) continue;
    if (!permanent) return 'an ability of a card that is never a permanent functions on the stack or in the command zone, not on the battlefield (CR 110.4, 113.6, 113.6p): not automated by this parser version';
    // p2-c-cast-zone-1 (CR 113.6, 113.6m): a condition that needs the object itself in another zone ("As long as this card is in your graveyard, lands you control have
    // ...", Riftstone Portal) is never true where an ability with no zone functions (the battlefield): the ability functions in that zone, which it does not state
    const cond = a.kind === 'static' ? a.condition : a.kind === 'activated' ? (a as { onlyIf?: unknown }).onlyIf : (a as { interveningIf?: unknown }).interveningIf;
    if (JSON.stringify(cond ?? null).match(/"cond":"matches","object":\{"ref":"self"\},"filter":\{"zone":"(?!battlefield")/)) return 'a condition on ~ in a zone other than the battlefield, of an ability that states no zone (CR 113.6m): not automated by this parser version';
    if (a.kind === 'static' && grantsSelfFlash(a)) return '"this spell has flash (or cascade, convoke, ...) as long as ..." functions where the card is cast from and on the stack (CR 113.6e, 702.8a, 601.3d): not automated by this parser version';
  }
  return null;
}

/**
 * p2-c-dieroll-1 (CR 706.1-706.3a, unverified cites): a spell, activated or triggered ability with a die-roll result table ("Roll a d20." over "1-9 | ..." rows):
 * the ability lowered as usual with each row's sentences after its own (buildProgram, ROLL_ROWS); lower/die-roll.ts#foldRollTable moves the rows into the roll.
 * Fail closed: null (the whole ability stays manual, as before) unless every ability is automated with no manual step anywhere and holds exactly one roll whose
 * table has every row. A row "N+" (a result that a modifier can raise past the die's sides) is not read.
 */
function rollTableAbilities(seg: AbilitySegment, face: FaceInfo, ue: UnitEnv): { abilities: AbilityDef[]; acc: Acc } | null {
  const rows = seg.rollTable!;
  if (seg.modal !== undefined || rows.some((r) => r.max === null || r.more !== undefined || r.segs !== undefined)) return null;
  const inner = newAcc();
  const saved = ROLL_ROWS;
  ROLL_ROWS = rows.map((r) => ({ min: r.min, max: r.max!, pieces: piecesOf(r.sentences) }));
  let abilities: AbilityDef[];
  try {
    if (seg.shape === 'spell') abilities = spell(seg, face, ue, inner);
    else if (seg.shape === 'activated') abilities = activated(seg, face, ue, inner);
    else if (seg.shape === 'triggered') abilities = triggered(seg, face, ue, inner);
    else return null;
  } finally {
    ROLL_ROWS = saved;
  }
  let manual = false;
  const tables: number[] = [];
  for (const a of abilities) {
    if (a.kind === 'manual') return null;
    visit(a as unknown as Rec, (n) => {
      if (n['op'] === 'manual') manual = true;
      if (n['op'] === 'rollDie') tables.push(Array.isArray(n['table']) ? (n['table'] as unknown[]).length : 0);
    });
  }
  if (manual || tables.length !== 1 || tables[0] !== rows.length) return null;
  return { abilities, acc: inner };
}

/** One segmented ability to its AbilityDefs (never throws for a well-formed segment; parseCard catches the rest). */
export function lowerAbility(seg: AbilitySegment, face: FaceInfo, ue: UnitEnv): AbilityResult {
  const acc = newAcc();
  let abilities: AbilityDef[];
  let oracles: (string[] | undefined)[] | undefined;
  let rollTable = false;
  const stationShape = seg.shape === 'keyword' && seg.rollTable !== undefined && seg.rollTable.length > 0 && seg.keywordItems?.length === 1 && seg.keywordItems[0]!.name.toLowerCase() === 'station';
  if (stationShape) {
    const st = stationAbilities(seg, face, ue, acc);
    abilities = st.abilities;
    oracles = st.oracles;
  } else if (seg.rollTable && seg.rollTable.length > 0) {
    const rolled = rollTableAbilities(seg, face, ue);
    if (rolled !== null) {
      abilities = rolled.abilities;
      acc.claims.push(...rolled.acc.claims);
      acc.diagnostics.push(...rolled.acc.diagnostics);
      use(acc, rolled.acc.templates, rolled.acc.experimental);
      for (const [k, v] of rolled.acc.untainted) acc.untainted.set(k, v);
      for (const [k, v] of rolled.acc.kept) acc.kept.set(k, v);
      rollTable = true;
    } else abilities = [manualAbility(seg, seg.shape === 'spell' ? 'spell' : seg.shape === 'activated' ? 'activated' : seg.shape === 'triggered' ? 'triggered' : 'static', 'a die-roll table (CR 706) is not supported by this parser version')];
  } else {
    switch (seg.shape) {
      case 'keyword': abilities = keywordLine(seg, face, ue, acc); break;
      case 'spell': abilities = spell(seg, face, ue, acc); break;
      case 'activated': abilities = activated(seg, face, ue, acc); break;
      case 'loyalty': abilities = loyalty(seg, face, ue, acc); break;
      case 'triggered': abilities = triggered(seg, face, ue, acc); break;
      case 'static':
        abilities = seg.grant || seg.chosenMode ? grantLine(seg, face, ue, acc) : staticAbility(seg, face, ue, acc);
        // std-rh: one static ability per sentence (staticAbility): each is gated against its own sentence
        if (!seg.grant && !seg.chosenMode && abilities.length > 1) oracles = abilities.map((a) => [a.text]);
        break;
      case 'chapter': abilities = chapter(seg, face, ue, acc); break;
      case 'levelBracket': {
        const children = (seg.children ?? []).map((c) => lowerAbility(c, face, ue));
        children.forEach((c) => c.abilities.forEach((a, k) => { const e = (a as { effect?: EffectProgram }).effect; const kk = c.kept[k]; if (e && kk) acc.kept.set(e, kk); }));
        for (const c of children) { acc.claims.push(...c.claims); acc.diagnostics.push(...c.diagnostics); use(acc, c.templates, c.experimental); }
        const lv = seg.level!;
        abilities = [{ kind: 'levelBracket', text: seg.text, src: [...seg.lines], prov: { by: 'template' }, min: lv.min, max: lv.max, ...(lv.power !== undefined ? { power: lv.power } : {}), ...(lv.toughness !== undefined ? { toughness: lv.toughness } : {}), abilities: children.flatMap((c) => c.abilities) }];
        break;
      }
      case 'classLevel': {
        // WP22 ADDITION (INTERFACE CHANGE): a Class level (CR 716.2) has the structure of a level bracket: "[cost]: Level N" and the abilities that
        // function from that level on, each lowered like any ability (a part that is not understood is manual inside the level, never dropped)
        const cl = seg.classLevel!;
        const mana = cl.cost ? parseManaCost(face.pre.parse.slice(cl.cost[0], cl.cost[1])) : undefined;
        if (mana === null) { abilities = [manualAbility(seg, 'static', 'a Class level cost that is not a mana cost (CR 716.2a)')]; break; }
        const children = (seg.children ?? []).map((c) => lowerAbility(c, face, ue));
        children.forEach((c) => c.abilities.forEach((a, k) => { const e = (a as { effect?: EffectProgram }).effect; const kk = c.kept[k]; if (e && kk) acc.kept.set(e, kk); }));
        for (const c of children) { acc.claims.push(...c.claims); acc.diagnostics.push(...c.diagnostics); use(acc, c.templates, c.experimental); }
        abilities = [{ kind: 'classLevel', text: seg.text, src: [...seg.lines], prov: { by: 'template' }, level: cl.level, ...(mana ? { cost: { mana } } : {}), abilities: children.flatMap((c) => c.abilities) }];
        break;
      }
      case 'case':
        abilities = caseAbility(seg, face, ue, acc);
        break;
      default:
        abilities = [manualAbility(seg, 'unknown', `${seg.shape} abilities are not supported by this parser version`)];
    }
  }
  const dead = deadWhereItFunctions(abilities, face);
  if (dead !== null) {
    abilities = [manualAbility(seg, seg.shape === 'activated' || seg.shape === 'triggered' ? seg.shape : 'static', dead)];
    acc.diagnostics.push({ level: 'manual', code: 'no-template', message: `${dead}: "${seg.text}"`, range: seg.range });
  }
  if (abilities.every((a) => a.kind === 'manual' && a.effect === undefined)) {
    // nothing of the ability runs automatically: all of its text is manual in the ledger (what was consumed only on the way is not behavior)
    const reason = (abilities[0] as ManualAbilityDef | undefined)?.reason ?? 'not understood';
    acc.claims = [];
    for (const r of seg.ranges) claim(acc, r, 'manual', undefined, reason);
    if (!acc.diagnostics.some((d) => d.level === 'manual')) acc.diagnostics.push({ level: 'manual', code: 'no-template', message: `${reason}: "${seg.text}"`, range: seg.range });
  }
  const gateForms = abilities.map((a): AbilityDef | undefined => {
    const eff = (a as { effect?: EffectProgram }).effect;
    const pre = eff !== undefined ? acc.untainted.get(eff) : undefined;
    return pre !== undefined && canonicalJson(pre) !== canonicalJson(eff) ? ({ ...a, effect: pre } as AbilityDef) : undefined;
  });
  const kept = abilities.map((a) => (a.kind === 'manual' && a.effect !== undefined ? acc.kept.get(a.effect) : undefined));
  const fallbacks = abilities.map((a) => (): Fallback[] => {
    if (rollTable) return []; // p2-c-dieroll-1: a refused die-roll table is the whole ability manual (one manual step would drop the rows' results, CR 706.3a)
    const one = effectManual(a);
    return [...(one ? [one] : []), ...(acc.fallbacks.get(a)?.() ?? [])];
  });
  const { claims, diagnostics, templates, experimental } = acc;
  return { abilities, claims, diagnostics, templates, experimental, gateForms, kept, fallbacks, ...(oracles ? { oracles } : {}) };
}
