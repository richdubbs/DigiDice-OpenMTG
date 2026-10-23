/**
 * Taint: contagion and poisoning (design 6.7). Owner: WP17. An unparsed sentence can change the meaning of its neighbors in both directions, so three
 * mechanical rules decide the radius of a manual island. They run after lowering, on the main program and on each modal option separately:
 *
 *  - E1 exemption (manual shields). A manual sentence of the shape "If [object] would [event] this turn, [replacement] instead." or "Prevent the next N
 *    damage ... this turn." creates a FUTURE replacement or prevention (CR 614.1, 615.1) and cannot modify an earlier step. It is a `manual` step with
 *    `reminder: {d:'endOfTurn'}` (a chip stays until the end of the turn: a prompt during resolution cannot intercept a death that happens later, in
 *    state-based actions, CR 704) and it does not taint its neighbors (Magma Spray).
 *  - T2 contagion. A manual sentence that contains a modifier word (the closed list of model/taint.ts: `instead`, `this way`, `would`, `still`, `unless`,
 *    `except`, ...) or a pronoun with no unique antecedent makes the WHOLE program one manual step, earlier automated steps included. Targets, modes, cost
 *    and trigger that parsed are kept: the player still announces them and the engine still pays the cost (Mutavault, Memory Lapse).
 *  - T2 for an unannounced target. A manual sentence with a target phrase that introduced no TargetSpec ("Counter target spell." with no counter template)
 *    cannot be announced (CR 601.2c): automated steps next to it would run without the CR 608.2b check of that target (cast with no legal target, never
 *    fail to resolve, or fail to resolve while the unannounced target was still legal). The program becomes one manual step and announces NO targets: a
 *    partial target list would make the spell fail to resolve when only the parsed targets are illegal (CR 608.2b). This applies to E1 shields too
 *    ("Prevent the next 2 damage that would be dealt to any target this turn."): such a shield has a target of its own. When several modes can be chosen
 *    together (CR 700.2), one such bullet makes every bullet manual, because the CR 608.2b check covers the targets of all chosen modes.
 *  - T1 forward poisoning. A step that reads (`bound`, `did`, `resultCount`, `var`, `linked`) a name produced by a manual step is manual too, transitively
 *    (model/taint.ts#poisonedSteps, shared with the degrade pass so both decide alike).
 * A manual sentence that is none of these stays a manual step in place and the steps around it stay automated (Frost Breath).
 */
import type { EffectProgram, EffectStep, ModeSpec } from '../types/ability';
import type { Diagnostic } from './types';
import { modifierWord, poisonedSteps } from '../model/taint';
import type { LoweredProgram, LoweredSeq, Unit } from './lower/types';
import { manualStep } from './lower/sequencing';

export const OWNER = 'WP17' as const;

type Rec = Record<string, unknown>;

/** The E1 shapes (design 6.7): a one-shot replacement or prevention for the rest of the turn. Returns the reason, or null. */
export function shieldShape(text: string): string | null {
  const t = text.trim().replace(/\s+/g, ' ');
  if (/^if .+ would .+ this turn, .+ instead\.?$/i.test(t)) return 'replacement effect (needs milestone 6)';
  if (/^prevent the next \S+ damage .+ this turn\.?$/i.test(t)) return 'prevention effect (needs milestone 6)';
  return null;
}

/** The text of a sentence outside quoted abilities (a quoted ability's targets are chosen when IT is put on the stack, CR 113.1c). */
const unquoted = (text: string): string => text.replace(/["\u201C][^"\u201D]*["\u201D]/g, ' ');

/**
 * A manual sentence with a target phrase it did not announce (CR 601.2c): reminder text is already removed from `Unit.text`. r3-choose (CR 707.10c): "may choose
 * a new target for that copy" / "new targets for the copy" are the targets of a copy, chosen as the copy is created, never targets this spell announces.
 */
export function unannouncedTarget(u: Unit): boolean {
  return u.manual !== undefined && (u.targetIds ?? []).length === 0 && /\btargets?\b/i.test(unquoted(u.text).replace(/\bnew targets?\b/gi, ' '));
}

const UNANNOUNCED = 'contagion: a target phrase that is not announced in a sentence that is not understood (CR 601.2c, 608.2b; design 6.7 T2)';

/** Why a manual unit spreads to its whole program (T2), or null. E1 shields never do, unless they hold a target of their own. */
export function contagionOf(u: Unit): string | null {
  if (!u.manual) return null;
  if (unannouncedTarget(u)) return UNANNOUNCED;
  if (shieldShape(u.text) !== null) return null;
  const w = modifierWord(u.text);
  if (w !== null) return `contagion: "${w}" in a sentence that is not understood (design 6.7 T2)`;
  if (u.manual.unresolved) return 'contagion: a reference with no unique antecedent in a sentence that is not understood (design 6.7 T2)';
  return null;
}

/**
 * PUSH1 T1 review (INTERFACE CHANGE, WP17's file): "The token enters tapped and attacking." (Ghired, Conclave Exile) tells how a token made by an EARLIER step
 * enters (CR 111.1, 508.4); it has no modifier word, but an automated creation before it would put the token onto the battlefield untapped and not attacking,
 * and the enters event (and every trigger on it) would see it that way before anyone resolves the sentence by hand. So such a sentence is contagious (T2)
 * when a step before it creates tokens: `createToken`, `copy`, or a keyword action that creates them (populate, amass, incubate, investigate).
 */
const TOKEN_RIDER = /^(?:the|that|those|these)\s+(?:[\w-]+\s+)*?tokens?\s+enters?\b|^(?:it|they)\s+enters?\b/i;
const TOKEN_MAKER = /"op":"(?:createToken|copy)"|"action":"(?:populate|amass|incubate|investigate)"/;
function tokenRiderOf(seq: LoweredSeq, i: number): string | null {
  const u = seq.units[i]!;
  if (!u.manual || !TOKEN_RIDER.test(u.text.trim())) return null;
  const madeBefore = seq.steps.some((s, k) => seq.stepUnits[k]! < i && TOKEN_MAKER.test(JSON.stringify(s)));
  return madeBefore ? 'contagion: a sentence that is not understood says how a token made by an earlier step enters (CR 111.1, 508.4; design 6.7 T2)' : null;
}

const textOf = (units: readonly Unit[]): string => units.map((u) => u.text).filter((t) => t !== '').join(' ');

/** A step at a JSON-pointer-like path inside a step list ("/2/then/0"). */
function setAt(list: Rec[], path: string, value: Rec): void {
  const parts = path.split('/').filter((p) => p !== '');
  let cur: unknown = list;
  for (let k = 0; k < parts.length - 1; k++) cur = (cur as Record<string, unknown>)[parts[k]!];
  (cur as Record<string, unknown>)[parts[parts.length - 1]!] = value;
}

export interface TaintedSeq {
  steps: EffectStep[];
  diagnostics: Diagnostic[];
  /** T2 fired: the program is one manual step. */
  contagious: boolean;
  /** T2 fired because a target phrase is not announced: the program must announce no targets either (CR 608.2b). */
  unannounced: boolean;
  /** Indices (into the sequence's units) of the sentences whose behavior ended up manual: their own, by contagion or by poisoning. */
  manualUnits: number[];
}

/** E1, T2 and T1 over one sequence. Pure. */
export function taintSeq(seq: LoweredSeq): TaintedSeq {
  const diagnostics: Diagnostic[] = [];
  const manualUnits = new Set<number>(seq.units.flatMap((u, i) => (u.manual ? [i] : [])));
  // T2 first: it decides everything else
  for (const [i, u] of seq.units.entries()) {
    const why = contagionOf(u) ?? tokenRiderOf(seq, i);
    if (why === null) continue;
    diagnostics.push({ level: 'manual', code: 'contagion', message: `${why}: "${u.text}"`, range: u.range });
    return { steps: [{ op: 'manual', text: textOf(seq.units), reason: why }], diagnostics, contagious: true, unannounced: why === UNANNOUNCED, manualUnits: seq.units.map((_, i) => i) };
  }
  // E1: shields keep their place and get a chip until end of turn
  const steps = JSON.parse(JSON.stringify(seq.steps)) as Rec[];
  steps.forEach((s, i) => {
    const u = seq.units[seq.stepUnits[i]!]!;
    const shield = u.manual ? shieldShape(u.text) : null;
    if (s['op'] === 'manual' && shield !== null) {
      steps[i] = { op: 'manual', text: u.text, reason: shield, reminder: { d: 'endOfTurn' } };
      diagnostics.push({ level: 'info', code: 'contagion', message: `manual shield (design 6.7 E1), it does not taint its neighbors: "${u.text}"`, range: u.range });
    }
  });
  // T1: forward poisoning through names
  const poisoned = new Map<string, string>();
  const lost = new Set(seq.units.flatMap((u) => (u.manual ? u.lostNames ?? [] : [])));
  poisonedSteps(steps, '', new Set(), poisoned, { names: lost, vars: lost, links: new Set() });
  for (const [path, reason] of [...poisoned].sort((a, b) => b[0].length - a[0].length)) {
    const top = Number(path.split('/')[1]);
    const u = seq.units[seq.stepUnits[top]!]!;
    setAt(steps, path, { ...(manualStep({ ...u, manual: { code: 'poisoned', reason } }) as unknown as Rec) });
    manualUnits.add(seq.stepUnits[top]!);
    diagnostics.push({ level: 'manual', code: 'poisoned', message: `${reason} (design 6.7 T1): "${u.text}"`, range: u.range });
  }
  return { steps: steps as unknown as EffectStep[], diagnostics, contagious: false, unannounced: false, manualUnits: [...manualUnits].sort((a, b) => a - b) };
}

/** Targets announced by a sequence: the ones its sentences introduced (kept even when a sentence became manual, design 6.7). */
const targetsOf = (p: LoweredProgram, units: readonly Unit[]): EffectProgram['targets'] => {
  const ids = new Set(units.flatMap((u) => u.targetIds ?? []));
  return p.targets.filter((t) => ids.has(t.id));
};

export interface TaintResult {
  program: EffectProgram;
  diagnostics: Diagnostic[];
  /** Every sentence of the program with whether its behavior ended up manual (for the ledger and the "nothing understood" test). */
  units: { unit: Unit; manual: boolean }[];
}

/**
 * The program as lowered, BEFORE taint: every manual sentence is a manual step in place. The render gate (G6) checks this form: it proves that what was
 * understood (targets, steps) means the Oracle text; taint only removes automation from it, so the tainted program inherits that proof (design 6.7, 6.8).
 */
export function untaintedProgram(p: LoweredProgram): EffectProgram {
  const program: EffectProgram = { targets: targetsOf(p, p.main.units), steps: p.main.steps };
  if (p.modes) program.modes = { min: p.modes.min, max: p.modes.max, options: p.modes.options.map((o) => ({ text: o.text, program: { targets: targetsOf(p, o.units), steps: o.steps }, ...(o.cost ? { cost: o.cost } : {}) })) };
  return JSON.parse(JSON.stringify(program)) as EffectProgram;
}

/** The taint pass over a lowered program: the finished EffectProgram plus the diagnostics of the manual islands. */
export function applyTaint(p: LoweredProgram): TaintResult {
  let main = taintSeq(p.main);
  let options = (p.modes?.options ?? []).map(taintSeq);
  // CR 608.2b: one check over the targets of the whole ability (and of every chosen mode): an unannounced target anywhere it can combine with others
  // leaves every sequence manual and the ability with no targets at all
  const all = main.unannounced || (p.modes !== undefined && p.modes.max > 1 && options.some((t) => t.unannounced));
  if (all) {
    const why = main.unannounced ? main : options.find((t) => t.unannounced)!;
    const reason = (why.steps[0] as { reason?: string } | undefined)?.reason ?? UNANNOUNCED;
    const flat = (seq: LoweredSeq, t: TaintedSeq): TaintedSeq => (t.unannounced || seq.units.length === 0 ? { ...t, unannounced: true } : { steps: [{ op: 'manual', text: textOf(seq.units), reason }], diagnostics: t.diagnostics, contagious: true, unannounced: true, manualUnits: seq.units.map((_, i) => i) });
    main = flat(p.main, main);
    options = options.map((t, i) => flat(p.modes!.options[i]!, t));
  }
  const diagnostics = [...main.diagnostics];
  const units = p.main.units.map((unit, i) => ({ unit, manual: main.manualUnits.includes(i) }));
  const program: EffectProgram = { targets: main.unannounced ? [] : targetsOf(p, p.main.units), steps: main.steps };
  if (p.modes) {
    const modes: ModeSpec = {
      min: p.modes.min,
      max: p.modes.max,
      options: p.modes.options.map((o, k) => {
        const t = options[k]!;
        diagnostics.push(...t.diagnostics);
        units.push(...o.units.map((unit, i) => ({ unit, manual: t.manualUnits.includes(i) })));
        return { text: o.text, program: { targets: t.unannounced ? [] : targetsOf(p, o.units), steps: t.steps }, ...(o.cost ? { cost: o.cost } : {}) };
      }),
    };
    program.modes = modes;
  }
  return { program, diagnostics, units };
}
