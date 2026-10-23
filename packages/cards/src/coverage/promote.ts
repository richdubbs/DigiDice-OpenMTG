/**
 * `coverage --promote <file>` (design 11.6, 6.12): template induction from REVIEWED abilities. Each reviewed ability (a human checked its JSON against
 * the card; the LLM tool of WP26 or a hand-written entry) whose effect is one sentence and one step is turned into a proposed effect template:
 *
 *   - target phrases become typed holes (`{t0:Obj}`, `{t0:Recipient}` for "any target" and players) and the step's `{ref:'target'}` uses become "$t0";
 *   - numbers that occur once in the sentence and once in the step become `{n0:Qty}` holes;
 *   - the template is `experimental` (design 6.9), its examples are SYNTHETIC (other numbers, other target phrases: never the card's own wording, design
 *     6.10) and its counter-examples are near-miss mutations of the first example (G9);
 *   - a proposal that generalizes nothing is refused: a template that matches one wording is memorization, which the retention gate punishes (6.12).
 *
 * Every proposal is then checked the way CI would: G9 (the examples parse, fully automated and gated, with the template added; no counter-example and no
 * near miss parses to the same JSON) and G10 (over the given corpus, adding the template changes only formerly-manual units). A human approves the
 * result; nothing is written into the template files by this command. Reviewed input format (JSON): `[{ "card": "<Oracle name>", "ability": AbilityDef }]`.
 */
import type { AbilityDef, CapabilitySet, OracleCard, Template } from '@openmtg/engine';
import { createCoverageEngine, type CoverageEngine } from './engine';
import { automatedMeaning, exampleCard, nearMisses } from './mutation';
import { buildSnapshot, diffSnapshots, refineWithRuns, cardKey, type UnitViolation } from './snapshot';

export interface ReviewedAbility { card: string; ability: AbilityDef }

export interface Proposal {
  card: string;
  sentence: string;
  template?: Template;
  /** Why no template was proposed. */
  refused?: string;
  checks?: { g9: string[]; g10: UnitViolation[]; changedCards: number };
}

type Rec = Record<string, unknown>;

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const SPECIAL = /[[\]()|^]/;
const OBJ_ALTERNATES = ['target creature', 'target artifact', 'target enchantment'];
const RECIPIENT_ALTERNATES = ['any target', 'target player', 'target creature'];

function replaceDeep(v: unknown, test: (x: unknown) => boolean, by: unknown): unknown {
  if (test(v)) return by;
  if (Array.isArray(v)) return v.map((x) => replaceDeep(x, test, by));
  if (v === null || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v as Rec).map(([k, x]) => [k, replaceDeep(x, test, by)]));
}

function numberCount(v: unknown, n: number, key = ''): number {
  if (typeof v === 'number') return v === n && !['id', 'src', 'sentence', 'min', 'max', 'layer', 'face'].includes(key) ? 1 : 0;
  if (Array.isArray(v)) return v.reduce<number>((s, x) => s + numberCount(x, n, key), 0);
  if (v === null || typeof v !== 'object') return 0;
  return Object.entries(v as Rec).reduce<number>((s, [k, x]) => s + numberCount(x, n, k), 0);
}

function replaceNumber(v: unknown, n: number, by: string, key = ''): unknown {
  if (typeof v === 'number') return v === n && !['id', 'src', 'sentence', 'min', 'max', 'layer', 'face'].includes(key) ? by : v;
  if (Array.isArray(v)) return v.map((x) => replaceNumber(x, n, by, key));
  if (v === null || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v as Rec).map(([k, x]) => [k, replaceNumber(x, n, by, k)]));
}

const countOf = (hay: string, needle: string): number => hay.toLowerCase().split(needle.toLowerCase()).length - 1;

/** The effect sentence of a reviewed ability, and its single step: spell abilities and the effect side of an activated ability. */
function sentenceAndStep(def: AbilityDef): { sentence: string; step: Rec; targets: Rec[] } | string {
  if (def.kind !== 'spell' && def.kind !== 'activated') return `a ${def.kind} ability: only spell and activated effects are promoted`;
  const effect = (def as { effect?: { steps?: unknown[]; targets?: unknown[]; modes?: unknown } }).effect;
  if (!effect || effect.modes !== undefined) return 'no single-program effect';
  if (!Array.isArray(effect.steps) || effect.steps.length !== 1) return `${effect.steps?.length ?? 0} steps: only one-step effects are promoted`;
  const text = (def.text ?? '').trim();
  const sentence = def.kind === 'activated' ? text.slice(text.indexOf(':') + 1).trim() : text;
  if (sentence.includes('\n') || sentence.split(/(?<=\.)\s+(?=\S)/).length !== 1) return 'more than one sentence';
  if (SPECIAL.test(sentence)) return 'the sentence holds pattern syntax characters';
  return { sentence, step: effect.steps[0] as Rec, targets: (effect.targets ?? []) as Rec[] };
}

/** The proposed template for one reviewed ability (or why none). Pure. */
export function proposeTemplate(r: ReviewedAbility, index: number): Proposal {
  const got = sentenceAndStep(r.ability);
  if (typeof got === 'string') return { card: r.card, sentence: r.ability.text ?? '', refused: got };
  let pattern = got.sentence.replace(/\.\s*$/, '');
  let build: unknown = got.step;
  const holes: { name: string; kind: 'target' | 'number'; type: string; original: string }[] = [];
  for (const [k, spec] of got.targets.entries()) {
    const text = typeof spec['text'] === 'string' ? spec['text'] : '';
    if (!text || countOf(pattern, text) !== 1 || spec['min'] !== 1 || spec['max'] !== 1) return { card: r.card, sentence: got.sentence, refused: `target ${String(spec['id'])} cannot be generalized ("${text}")` };
    const kind = spec['kind'];
    const type = kind === 'anyTarget' || kind === 'player' ? 'Recipient' : 'Obj';
    const name = `t${k}`;
    pattern = pattern.replace(new RegExp(text.replace(/[.*+?${}\\]/g, '\\$&'), 'i'), `{${name}:${type}}`);
    build = replaceDeep(build, (x) => x !== null && typeof x === 'object' && (x as Rec)['ref'] === 'target' && (x as Rec)['id'] === spec['id'], `$${name}`);
    holes.push({ name, kind: 'target', type, original: text });
  }
  if (JSON.stringify(build).includes('"ref":"target"')) return { card: r.card, sentence: got.sentence, refused: 'a target reference without a target phrase' };
  let k = 0;
  for (const m of [...pattern.replace(/\{[^}]*\}/g, (s) => ' '.repeat(s.length)).matchAll(/\b(\d+|two|three|four|five|six|seven|eight|nine|ten)\b/gi)]) {
    const word = m[1]!.toLowerCase();
    const n = /^\d+$/.test(word) ? Number(word) : NUMBER_WORDS.indexOf(word);
    if (countOf(` ${pattern} `, ` ${m[1]!} `) !== 1 || numberCount(build, n) !== 1) continue;
    const name = `n${k++}`;
    pattern = pattern.replace(new RegExp(`\\b${m[1]!}\\b`), `{${name}:Qty}`);
    build = replaceNumber(build, n, `$${name}`);
    holes.push({ name, kind: 'number', type: 'Qty', original: m[1]! });
  }
  if (holes.length === 0) return { card: r.card, sentence: got.sentence, refused: 'nothing to generalize: a literal template would memorize one wording (design 6.12)' };
  // synthetic examples: other numbers and other target phrases than the card's (design 6.10)
  const example = (variant: number): string => {
    let t = pattern;
    for (const h of holes) {
      const alt = h.kind === 'number'
        ? String((/^\d+$/.test(h.original) ? Number(h.original) : NUMBER_WORDS.indexOf(h.original.toLowerCase())) + 2 + 3 * variant)
        : (h.type === 'Recipient' ? RECIPIENT_ALTERNATES : OBJ_ALTERNATES).find((x, i) => x.toLowerCase() !== h.original.toLowerCase() && i >= variant) ?? h.original;
      t = t.replace(`{${h.name}:${h.type}}`, alt);
    }
    return `${t[0]!.toUpperCase()}${t.slice(1)}.`;
  };
  const examples = [example(0), example(1)].filter((x, i, a) => a.indexOf(x) === i);
  const counterExamples = nearMisses(examples[0]!).map((m) => m.text).slice(0, 3);
  const op = typeof (got.step as Rec)['op'] === 'string' ? String((got.step as Rec)['op']) : 'step';
  const template: Template = {
    id: `promoted.${op}.${index}`,
    kind: 'effect',
    cr: ['CR 608.2'],
    pattern,
    build,
    examples: examples.map((text) => ({ text })),
    counterExamples,
    status: 'experimental',
    since: 1,
  };
  return { card: r.card, sentence: got.sentence, template };
}

/** G9 for one template against a template set that includes it. */
export function g9Problems(t: Template, engine: CoverageEngine): string[] {
  const problems: string[] = [];
  for (const ex of t.examples) {
    const base = automatedMeaning(engine.run(exampleCard(t, ex.text)));
    if (base === null) {
      problems.push(`example does not parse fully automated: "${ex.text}"`);
      continue;
    }
    for (const c of t.counterExamples) if (automatedMeaning(engine.run(exampleCard(t, c))) === base) problems.push(`counter-example parses to the example's JSON: "${c}"`);
    for (const m of nearMisses(ex.text)) if (automatedMeaning(engine.run(exampleCard(t, m.text))) === base) problems.push(`near miss (${m.kind}) parses to the example's JSON: "${m.text}"`);
  }
  return problems;
}

/** Propose templates and run G9 and G10 on each (G10 over `corpus`, with and without the template). */
export function promote(reviewed: readonly ReviewedAbility[], base: readonly Template[], corpus: readonly OracleCard[], caps?: CapabilitySet): Proposal[] {
  const before = createCoverageEngine({ templates: base, ...(caps ? { caps } : {}) });
  const beforeRuns = corpus.map((c) => before.run(c));
  const beforeSnap = buildSnapshot(beforeRuns, { pipeline: before.pipeline(), compilerVersion: before.compilerVersion, templates: base.length, caps: before.caps });
  return reviewed.map((r, i) => {
    const p = proposeTemplate(r, i);
    if (!p.template) return p;
    const withT = createCoverageEngine({ templates: [...base, p.template], ...(caps ? { caps } : {}) });
    const afterRuns = corpus.map((c) => withT.run(c));
    const afterSnap = buildSnapshot(afterRuns, { pipeline: withT.pipeline(), compilerVersion: withT.compilerVersion, templates: base.length + 1, caps: withT.caps });
    const diff = refineWithRuns(diffSnapshots(beforeSnap, afterSnap), beforeSnap, new Map(afterRuns.map((x) => [cardKey(x), x])));
    const changedCards = diff.up.length + diff.down.length;
    return { ...p, checks: { g9: g9Problems(p.template, withT), g10: diff.violations, changedCards } };
  });
}
