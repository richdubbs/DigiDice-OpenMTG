/**
 * Helpers of the WP23 tests (templates E: choice, control flow, delayed and reflexive triggers, search, copy, riders, shields; design 15.2 WP23).
 *
 * The eight template files of WP23 are read as data, as a rules pack or the compile pipeline (WP18) would load them, and parsed together with the
 * bootstrap templates of WP17. Template examples and the wordings here are synthetic (invented numbers and names, design 6.10). Templates of the other
 * template packages that the examples and golden cards need (WP19 triggers and the lead-in "if", WP20 shuffle/discard, WP21 exile/return/put/sacrifice,
 * WP22 grants and "becomes") are written here in test form ("stand-ins", design 15.1.7) and never committed as data.
 */
import type { AbilityDef } from '../../../src/types/ability';
import type { OracleCard } from '../../../src/types/card';
import type { FaceParse, ParseOptions, Template, TemplateKind } from '../../../src/parser/types';
import { BOOTSTRAP_TEMPLATES, defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { parseUnit, type ChartGoal, type ChartResult } from '../../../src/parser/chart';
import { adaptTokens, canonicalJson } from '../../../src/parser/holes';
import { tokenize } from '../../../src/parser/tokenize';
import choice from '../../../src/parser/templates/effect/choice.json';
import flow from '../../../src/parser/templates/effect/flow.json';
import delayed from '../../../src/parser/templates/effect/delayed.json';
import reflexive from '../../../src/parser/templates/effect/reflexive.json';
import search from '../../../src/parser/templates/effect/search.json';
import copy from '../../../src/parser/templates/effect/copy.json';
import rider from '../../../src/parser/templates/effect/rider.json';
import shield from '../../../src/parser/templates/effect/shield.json';
import wp21Tokens from '../../../src/parser/templates/effect/tokens.json';

export { localIndex } from '../parser/support';

/** The eight files of WP23, by file name (design 15.2: parser/templates/effect/{choice,flow,delayed,reflexive,search,copy,rider,shield}.json). */
export const WP23_FILES: Readonly<Record<string, readonly Template[]>> = {
  'choice.json': choice as Template[],
  'flow.json': flow as Template[],
  'delayed.json': delayed as Template[],
  'reflexive.json': reflexive as Template[],
  'search.json': search as Template[],
  'copy.json': copy as Template[],
  'rider.json': rider as Template[],
  'shield.json': shield as Template[],
};

export const WP23_TEMPLATES: readonly Template[] = Object.values(WP23_FILES).flat();

let seq = 0;
/** A test-only template ("stand-in" for a template of another package). */
export function tpl(kind: TemplateKind, pattern: string, build: unknown, extra: Partial<Template> = {}): Template {
  return { id: extra.id ?? `test.wp23.${kind}.${++seq}`, kind, cr: ['CR 608.2c'], pattern, build, examples: [{ text: 'x' }], counterExamples: ['a', 'b'], status: 'stable', since: 1, ...extra };
}

/** Stand-ins for templates of WP19-WP22 that the examples and the golden cards need. */
export const STANDINS: readonly Template[] = [
  // W3 integration: WP21 is merged and owns token creation; its eff.token.you replaced this package's identical (experimental) eff.create.you
  ...(wp21Tokens as Template[]).filter((t) => t.id === 'eff.token.you'),
  tpl('trigger', '( when | whenever ) {e:Event}', { on: '$e' }, { id: 'test.wp23.trigger', consumes: ['when', 'whenever'] }),
  tpl('trigger', 'at {e:Event}', { on: '$e' }, { id: 'test.wp23.trigger.at' }),
  tpl('effect', 'if {c:Cond} , {e:Effects}', { op: 'if', cond: '$c', then: '$e' }, { id: 'test.wp23.if', consumes: ['if'] }),
  tpl('effect', 'exile {o:Objs}', { op: 'move', what: '$o', to: { zone: 'exile' } }, { id: 'test.wp23.exile' }),
  tpl('effect', 'sacrifice {o:Obj}', { op: 'sacrifice', what: '$o' }, { id: 'test.wp23.sacrifice' }),
  tpl('effect', 'tap {o:Objs}', { op: 'tap', what: '$o' }, { id: 'test.wp23.tap' }),
  tpl('effect', '{o:Obj} gain[s] {a:Abilities}', { op: 'effect', duration: { d: 'permanent' }, effects: [{ s: 'continuous', affects: '$o', mods: [{ layer: 6, add: '$a' }] }] }, { id: 'test.wp23.gains' }),
  tpl('effect', "return {o:Objs} to the battlefield under ( its owner 's | their owners' | their owner 's ) control", { op: 'move', what: '$o', to: { zone: 'battlefield', controller: 'owner' } }, { id: 'test.wp23.return' }),
  tpl('effect', 'put {o:Objs} into your hand', { op: 'move', what: '$o', to: { zone: 'hand' } }, { id: 'test.wp23.puthand' }),
  tpl('effect', 'put {o:Objs} onto the battlefield tapped', { op: 'move', what: '$o', to: { zone: 'battlefield', controller: { ref: 'you' }, tapped: true } }, { id: 'test.wp23.putbf' }),
  tpl('effect', 'shuffle', { op: 'shuffle', who: { ref: 'you' } }, { id: 'test.wp23.shuffle' }),
  tpl('effect', '{p:Player} discard[s] {n:Qty} card[s]', { op: 'discard', who: '$p', count: '$n' }, { id: 'test.wp23.discard' }),
  tpl('effect', 'discard {n:Qty} card[s]', { op: 'discard', who: { ref: 'you' }, count: '$n' }, { id: 'test.wp23.discard.you' }),
  tpl('effect', '{p:Player} gain[s] {n:Qty} life', { op: 'gainLife', who: '$p', amount: '$n' }, { id: 'test.wp23.gainlife' }),
  tpl('effect', '{o:Obj} becomes a 2/2 creature {d:Dur}', {
    op: 'effect', duration: '$d', effects: [{ s: 'continuous', affects: '$o', mods: [{ layer: 4, types: { set: ['Creature'] } }, { layer: '7b', power: 2, toughness: 2 }] }],
  }, { id: 'test.wp23.becomes' }),
];

/** Bootstrap (WP17) plus WP23: the template set this package is tested in. */
export const ALL: readonly Template[] = [...BOOTSTRAP_TEMPLATES, ...WP23_TEMPLATES, ...STANDINS];

/** Parse options with the bootstrap, WP23 and stand-in templates, plus `extra`. */
export function options(extra: readonly Template[] = [], over: Partial<ParseOptions> = {}): ParseOptions {
  return defaultParseOptions({ templates: [...ALL, ...extra], ...over });
}

/** A synthetic single-faced card (invented names; design 6.10). */
export function card(name: string, typeLine: string, text: string): OracleCard {
  return { name, layout: 'normal', type_line: typeLine, oracle_text: text } as OracleCard;
}

/** The face an example of a template is an ability of: lines with a colon are activated abilities of an artifact, the rest spell text. */
export function exampleCard(text: string): OracleCard {
  if (/^(when|whenever|at) /i.test(text) && !/^at (the beginning of (the|your) next|end of combat)/i.test(text)) return card('Example Wisp', 'Creature — Spirit', text);
  if (/^\{[^}]+\}(, \{[^}]+\})*: /.test(text)) return card('Example Totem', 'Land', text);
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

/** Abilities without bookkeeping that does not depend on the text's meaning (`src`, `prov`, and with `keepText` false the display text). */
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
export function unit(text: string, goal: ChartGoal, templates: readonly Template[] = ALL, opts: ParseOptions = options(), capabilities?: ReadonlySet<string>): ChartResult {
  return parseUnit({ tokens: adaptTokens(tokenize(text)), templates, env: { lexicon: opts.lexicon, keywords: opts.keywords }, goal, ...(capabilities ? { capabilities } : {}) });
}

/** The parsed meaning of an example that is fully automated and passes the gate, or null. */
export function parsedMeaning(text: string, opts: ParseOptions = options()): string | null {
  const f = face(exampleCard(text), opts);
  return automated(f.abilities) && f.gate.every((g) => g.ok) ? meaning(f.abilities) : null;
}

/** Templates whose `needs` this engine build lacks (design 6.3, guard G8): their examples parse to a manual sentence, with the shape of milestone 6 kept. */
export const gated = (t: Template): boolean => (t.needs ?? []).length > 0;
