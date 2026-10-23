/**
 * One sentence through the chart parser (design 6.3) and guard G3 (critical words, design 6.8), producing a lowering `Unit`. Owner: WP17.
 *
 * A sentence is first parsed as effects; if no derivation exists it is tried as a rider (pass 4 merges it). Any other outcome is a manual unit with the
 * chart's diagnosis: `unknown-word` (guard G2), `no-template`, `ambiguous` (G5, both readings kept), `needs-engine` (G8), `budget`. A derivation that leaves
 * a critical word to a template literal the template does not list in `consumes` is refused (G3): "destroy all other permanents except for lands" parsed
 * by a template that ignores "except" would destroy lands.
 */
import type { Diagnostic, DiagnosticCode, ParseOptions, Template } from '../types';
import type { ChartGoal, ChartResult, Derivation, TemplateUse } from '../chart';
import { parseUnit } from '../chart';
import type { Discourse, HoleEnv } from '../holes';
import type { Tok } from '../holes/tok';
import { spanText } from '../holes/tok';
import { MODIFIER_WORDS } from '../../model/taint';
import type { ManualInfo, Range, Rec, Unit } from './types';
import { clone, isRec } from './util';

/** Design 6.8 G3: the modifier words of 6.7 plus these. */
export const CRITICAL_WORDS: readonly string[] = [...MODIFIER_WORDS, 'each', 'all', 'another', 'other', 'may', 'if', 'whenever', 'when', 'not', 'never', 'must'];
const CRITICAL_PHRASES: readonly string[][] = CRITICAL_WORDS.map((w) => w.split(' ')).sort((a, b) => b.length - a.length);

/** What one ability may spend on the chart (design 6.3 rule 4: the budget is per ability). */
export interface ChartBudget { limit: number; used: number }

export interface UnitEnv {
  opts: ParseOptions;
  env: HoleEnv;
  budget: ChartBudget;
}

/** Token indices covered by holes anywhere in the tree, and for every other index the template whose literal covers it. */
function coverage(tree: TemplateUse, n: number): { hole: boolean[]; owner: (Template | undefined)[] } {
  const hole = new Array<boolean>(n).fill(false);
  const owner = new Array<Template | undefined>(n).fill(undefined);
  const walk = (u: TemplateUse): void => {
    for (let i = u.start; i < u.end && i < n; i++) if (u.template) owner[i] = u.template;
    for (const h of u.holes) for (let i = h.start; i < h.end && i < n; i++) hole[i] = true;
    u.children.forEach(walk); // children are deeper: they overwrite the owner of their own span
  };
  walk(tree);
  return { hole, owner };
}

/** Guard G3: the first critical word of the unit that no hole interpreted and no template lists in `consumes`, or null. */
export function criticalWordProblem(tokens: readonly Tok[], tree: TemplateUse): string | null {
  const { hole, owner } = coverage(tree, tokens.length);
  for (let i = 0; i < tokens.length; i++) {
    for (const ph of CRITICAL_PHRASES) {
      if (!ph.every((w, k) => tokens[i + k]?.norm === w)) continue;
      const span = ph.map((_, k) => i + k);
      if (span.every((k) => hole[k])) break;
      const tpl = owner[i];
      const phrase = ph.join(' ');
      if (tpl?.consumes?.includes(phrase)) break;
      return phrase;
    }
  }
  return null;
}

function manualFrom(r: ChartResult): ManualInfo {
  switch (r.status) {
    case 'fail': {
      const unknown = r.unknownWords.map((w) => w.token);
      const code: DiagnosticCode = unknown.length > 0 ? 'unknown-word' : 'no-template';
      return { code, reason: unknown.length > 0 ? `unknown word${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}` : 'no template matches the sentence', furthest: { token: r.furthest.token, expected: r.furthest.expected } };
    }
    case 'ambiguous': return { code: 'ambiguous', reason: `${r.alternatives.length} readings with different meanings (guard G5)`, alternatives: r.alternatives.map((a) => a.value) };
    case 'needs-engine': return { code: 'needs-engine', reason: `needs-engine: ${r.missing.join(', ')}` };
    case 'budget': return { code: 'budget', reason: 'the sentence exceeds the chart budget (design 6.3 rule 4)' };
    case 'ok': return { code: 'no-template', reason: 'not understood' };
  }
}

/** Run the chart for one goal, charging the ability's budget. */
export function chart(tokens: readonly Tok[], goal: ChartGoal, ue: UnitEnv): ChartResult {
  const remaining = Math.max(1, ue.budget.limit - ue.budget.used);
  const r = parseUnit({ tokens, templates: ue.opts.templates, env: ue.env, goal, capabilities: ue.opts.capabilities, budget: remaining });
  ue.budget.used += r.items;
  return r;
}

/** An accepted derivation, or the reason it is refused (G3). */
export function accept(tokens: readonly Tok[], d: Derivation): string | null {
  const word = criticalWordProblem(tokens, d.tree);
  return word === null ? null : `"${word}" is not interpreted by the template that matched (guard G3)`;
}

const textOf = (tokens: readonly Tok[]): string => spanText(tokens, 0, tokens.length);

export interface UnitInput {
  index: number;
  tokens: readonly Tok[];
  /** Display text; defaults to the tokens' spelling. */
  text?: string;
  /** FAST5 T75: what the earlier sentences of the ability made, for the pronoun holes (holes/core.ts#Discourse). */
  discourse?: Discourse;
}

const rangeOf = (tokens: readonly Tok[]): Range => (tokens.length === 0 ? [0, 0] : [tokens[0]!.start, tokens[tokens.length - 1]!.end]);

/** Parse one effect sentence into a Unit (steps with markers, a rider, or manual). */
export function parseEffectUnit(input: UnitInput, env: UnitEnv): Unit {
  const ue: UnitEnv = input.discourse === undefined ? env : { ...env, env: { ...env.env, discourse: input.discourse } };
  let base: Unit = { index: input.index, range: rangeOf(input.tokens), text: input.text ?? textOf(input.tokens), tokens: input.tokens, steps: [], templates: [], experimental: [], flags: [] };
  if (input.tokens.length === 0 || input.tokens.every((t) => t.kind === 'PUNCT')) return { ...base, manual: { code: 'no-template', reason: 'an empty sentence' } };
  let r = chart(input.tokens, 'effects', ue);
  // CLOUD std-fra (guard G10): a "Then if ..." sentence that only the generic sentence-initial "Then" (eff.stdfra.then.effects, weak) reads is first tried as the rider it
  // always was (eff.t34.thenIf, "the difference" and the other riders of the sentence before): the rider reading keeps what it kept; the generic one is the fallback
  const generic = r.status === 'ok' && input.tokens[0]?.norm === 'then' && input.tokens[1]?.norm === 'if' && r.derivation.templatesUsed.includes('eff.stdfra.then.effects');
  const viaRider = generic && chart(input.tokens, 'rider', ue).status === 'ok';
  // Cloud std-woe (CR 608.2c; design 6.3: "then" implies order only): "Draw two cards. Then discard a card." A later sentence of the ability that begins with "Then"
  // says only that its instructions follow the earlier ones, which every sentence does, so when no template reads the whole sentence it is read without the word
  // (the unit keeps its range and text, so the ledger and the render gate still see "Then"; its tokens are the ones charted). Not "Then if ...": a condition there may
  // be followed by an "If you do" or a value ("the difference") the lowering cannot yet tie to it, and the sentence stays as it was. A sentence a template reads
  // with "then" (`eff.m12.thenPlayerShuffles`, std-fra's generic eff.stdfra.then.effects) is unchanged: this runs only when the chart failed, so the two never give
  // two readings of one sentence (merge line CD).
  if (r.status === 'fail' && input.index > 0 && input.tokens.length > 2 && input.tokens[0]!.norm === 'then' && input.tokens[1]!.norm !== 'if') {
    const rest = input.tokens.slice(1);
    const r2 = chart(rest, 'effects', ue);
    if (r2.status === 'ok') {
      r = r2;
      base = { ...base, tokens: rest };
    }
  }
  if (r.status === 'ok' && !viaRider) {
    const refused = accept(base.tokens, r.derivation);
    if (refused !== null) return { ...base, manual: { code: 'critical-word', reason: refused } };
    const steps = (Array.isArray(r.derivation.value) ? r.derivation.value : [r.derivation.value]).map((s) => clone(s) as Rec);
    return { ...base, steps, templates: r.derivation.templatesUsed, experimental: r.derivation.experimental, flags: r.derivation.flags, tree: r.derivation.tree };
  }
  if (r.status === 'fail' || viaRider) {
    const rr = chart(input.tokens, 'rider', ue);
    if (rr.status === 'ok') {
      const v = rr.derivation.value;
      const tpl = rr.derivation.tree.template;
      const refused = accept(input.tokens, rr.derivation);
      if (refused !== null) return { ...base, manual: { code: 'critical-word', reason: refused } };
      if (isRec(v) && isRec(v['$patchPrevious'])) {
        return {
          ...base, steps: [], rider: { patch: clone(v['$patchPrevious']) as Rec, ...(tpl?.attachTo ? { attachTo: tpl.attachTo } : {}), template: tpl?.id ?? 'rider' },
          templates: rr.derivation.templatesUsed, experimental: rr.derivation.experimental, flags: rr.derivation.flags, tree: rr.derivation.tree,
        };
      }
      return { ...base, manual: { code: 'lint', reason: 'a rider template whose build is not {"$patchPrevious": {...}}' } };
    }
    if (rr.status === 'budget') return { ...base, manual: manualFrom(rr) };
  }
  return { ...base, manual: manualFrom(r) };
}

/** The diagnostic of a manual unit. */
export function unitDiagnostic(u: Unit): Diagnostic | null {
  if (!u.manual) return null;
  return {
    level: 'manual', code: u.manual.code, message: `${u.manual.reason}: "${u.text}"`, range: u.range,
    ...(u.manual.furthest ? { furthest: u.manual.furthest } : {}),
    ...(u.manual.alternatives ? { alternatives: u.manual.alternatives } : {}),
  };
}

/** Parse a whole unit for one goal and return the single value, or the manual info. Used for triggers, costs, statics and keyword items. */
export function parseWhole(tokens: readonly Tok[], goal: ChartGoal, ue: UnitEnv): { ok: true; value: unknown; d: Derivation } | { ok: false; manual: ManualInfo } {
  const r = chart(tokens, goal, ue);
  if (r.status !== 'ok') return { ok: false, manual: manualFrom(r) };
  const refused = accept(tokens, r.derivation);
  if (refused !== null) return { ok: false, manual: { code: 'critical-word', reason: refused } };
  return { ok: true, value: clone(r.derivation.value), d: r.derivation };
}
