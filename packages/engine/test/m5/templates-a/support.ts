/**
 * Helpers of the WP19 tests (templates A: costs, triggers, conditions, durations, keyword lines; design 15.2 WP19).
 *
 * The five template files of WP19 are read as data, exactly as a rules pack or the compile pipeline (WP18) would load them, and parsed together with the
 * bootstrap templates of WP17. Template examples and the test wordings here are synthetic (invented numbers and names, design 6.10). Templates of the
 * other template packages (WP20-WP23) that the golden cards need are written here in test form ("stand-ins"), as WP17's tests do, and never committed as data.
 */
import type { AbilityDef } from '../../../src/types/ability';
import type { OracleCard } from '../../../src/types/card';
import type { FaceParse, ParseOptions, Template, TemplateKind } from '../../../src/parser/types';
import { BOOTSTRAP_TEMPLATES, defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { parseUnit, type ChartGoal, type ChartResult } from '../../../src/parser/chart';
import { adaptTokens, canonicalJson } from '../../../src/parser/holes';
import { tokenize } from '../../../src/parser/tokenize';
import cost from '../../../src/parser/templates/cost.json';
import trigger from '../../../src/parser/templates/trigger.json';
import condition from '../../../src/parser/templates/condition.json';
import duration from '../../../src/parser/templates/duration.json';
import keyword from '../../../src/parser/templates/keyword.json';

export { localIndex } from '../parser/support';

/** The five files of WP19, by file name (design 5.1: parser/templates/{cost,trigger,condition,duration,keyword}.json). */
export const WP19_FILES: Readonly<Record<string, readonly Template[]>> = {
  'cost.json': cost as Template[],
  'trigger.json': trigger as Template[],
  'condition.json': condition as Template[],
  'duration.json': duration as Template[],
  'keyword.json': keyword as Template[],
};

export const WP19_TEMPLATES: readonly Template[] = Object.values(WP19_FILES).flat();

/** Bootstrap (WP17) plus WP19: the template set this package is tested in. */
export const ALL: readonly Template[] = [...BOOTSTRAP_TEMPLATES, ...WP19_TEMPLATES];

let seq = 0;
/** A test-only template ("stand-in" for a template of another package). */
export function tpl(kind: TemplateKind, pattern: string, build: unknown, extra: Partial<Template> = {}): Template {
  return { id: extra.id ?? `test.wp19.${kind}.${++seq}`, kind, cr: ['CR 608.2c'], pattern, build, examples: [{ text: 'x' }], counterExamples: ['a', 'b'], status: 'stable', since: 1, ...extra };
}

/** Stand-ins for effect templates of WP20-WP23 that the golden cards of WP19 need (Blood Artist, Mana Vault). */
export const STANDINS: readonly Template[] = [
  tpl('effect', '{p:Player} lose[s] {n:Qty} life', { op: 'loseLife', who: '$p', amount: '$n' }, { id: 'test.wp19.loselife' }),
  tpl('effect', '{p:Player} gain[s] {n:Qty} life', { op: 'gainLife', who: '$p', amount: '$n' }, { id: 'test.wp19.gainlife' }),
  tpl('effect', '{p:Player} may pay {c:Cost}', { op: 'pay', who: '$p', cost: '$c' }, { id: 'test.wp19.maypay', consumes: ['may'] }),
  tpl('effect', 'untap {o:Objs}', { op: 'untap', what: '$o' }, { id: 'test.wp19.untap' }),
];

/** Parse options with the bootstrap and WP19 templates, plus `extra`. */
export function options(extra: readonly Template[] = [], over: Partial<ParseOptions> = {}): ParseOptions {
  return defaultParseOptions({ templates: [...ALL, ...extra], ...over });
}

/** A synthetic single-faced card (invented names; design 6.10). */
export function card(name: string, typeLine: string, text: string): OracleCard {
  return { name, layout: 'normal', type_line: typeLine, oracle_text: text } as OracleCard;
}

/** A synthetic card in which a template example is an ability of the right kind. */
export function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'trigger' || t.kind === 'ability') return card('Example Wisp', 'Creature — Spirit', text);
  if (t.kind === 'cost') return card('Example Totem', 'Artifact Creature — Golem', text.includes(':') ? text : `${text}: Draw a card.`);
  return card('Example Bolt', 'Instant', text);
}

/** The first face of a parse. */
export function face(c: OracleCard, opts: ParseOptions = options()): FaceParse {
  return parseCard(c, opts).faces[0]!;
}

/** Every ability is automated: none is manual, no step is a manual step, no cost part is a manual part (design 6.6). */
export const automated = (defs: readonly AbilityDef[]): boolean => {
  const json = JSON.stringify(defs);
  return defs.length > 0 && defs.every((a) => a.kind !== 'manual') && !json.includes('"op":"manual"') && !json.includes('"kind":"manual"');
};

/** Abilities without bookkeeping that does not depend on the text's meaning (`src`, `prov`, `text`). */
export function bare(defs: readonly AbilityDef[], keepText = true): unknown[] {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v === null || typeof v !== 'object') return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (k !== 'src' && k !== 'prov' && (keepText || (k !== 'text' && k !== 'span'))) out[k] = strip(x);
    return out;
  };
  return defs.map(strip);
}

/** The meaning of a parse: canonical JSON of the abilities without display text. */
export const meaning = (defs: readonly AbilityDef[]): string => canonicalJson(bare(defs, false));

/** One unit through the chart parser with the given goal (no lowering). */
export function unit(text: string, goal: ChartGoal, templates: readonly Template[] = ALL, opts: ParseOptions = options()): ChartResult {
  return parseUnit({ tokens: adaptTokens(tokenize(text)), templates, env: { lexicon: opts.lexicon, keywords: opts.keywords }, goal });
}

/**
 * What a template example lowers to (design 6.8 G9: `TemplateExample.expect`), by template kind: a trigger template's `trigger` (TriggerDef), a cost
 * template's `cost` (CostDef of the activated ability), an effect template's `effect` (EffectProgram of the spell), a keyword-line template's abilities
 * without display text. Null when the example is not fully automated or fails the render gate.
 */
export function loweredOf(t: Template, text: string, opts: ParseOptions = options()): unknown {
  const f = face(exampleCard(t, text), opts);
  if (!automated(f.abilities) || !f.gate.every((g) => g.ok)) return null;
  const a = f.abilities[0] as unknown as Record<string, unknown>;
  const pick = t.kind === 'trigger' ? a['trigger'] : t.kind === 'cost' ? a['cost'] : t.kind === 'effect' ? a['effect'] : f.abilities;
  return JSON.parse(JSON.stringify(bare([pick as never], false)[0] ?? null)) as unknown;
}

/** The parsed result of a fully automated example, or null. */
export function parsedMeaning(t: Template, text: string, opts: ParseOptions = options()): string | null {
  const f = face(exampleCard(t, text), opts);
  return automated(f.abilities) && f.gate.every((g) => g.ok) ? meaning(f.abilities) : null;
}
