/**
 * Helpers of the WP17 tests: parse options with the bootstrap templates (plus test-only templates for the worked cases of design 6.7, written with
 * invented wordings, design 6.10), synthetic cards, draft builders for the pass-by-pass suite, and the local Oracle index for corpus tests.
 */
import type { AbilityDef } from '../../../src/types/ability';
import type { OracleCard } from '../../../src/types/card';
import type { FaceParse, ParseOptions, Template, TemplateKind } from '../../../src/parser/types';
import { BOOTSTRAP_TEMPLATES, defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { lex, type Tok } from '../../../src/parser/holes';
import type { Draft, Rec, Unit } from '../../../src/parser/lower/types';

export { localIndex } from '../parser/support';

let seq = 0;
/** A test-only template (never committed as data: the bootstrap file is the only template data of WP17). */
export function tpl(kind: TemplateKind, pattern: string, build: unknown, extra: Partial<Template> = {}): Template {
  return { id: extra.id ?? `test.${kind}.${++seq}`, kind, cr: ['CR 608.2c'], pattern, build, examples: [{ text: 'x' }], counterExamples: ['a', 'b'], status: 'stable', since: 1, ...extra };
}

/** Templates of the template packages (WP19-WP23) that the worked cases need, in test form. */
export const EXTRA: Template[] = [
  tpl('effect', 'counter {o:Obj}', { op: 'counter', what: '$o' }, { id: 'test.counter' }),
  tpl('effect', 'tap {o:Objs}', { op: 'tap', what: '$o' }, { id: 'test.tap' }),
  tpl('effect', '{p:Player} lose[s] {n:Qty} life', { op: 'loseLife', who: '$p', amount: '$n' }, { id: 'test.loselife' }),
  tpl('effect', '{p:Player} gain[s] {n:Qty} life', { op: 'gainLife', who: '$p', amount: '$n' }, { id: 'test.gainlife' }),
  tpl('effect', 'you may {e:Effects}', { op: 'may', who: { ref: 'you' }, do: '$e' }, { id: 'test.may', consumes: ['may'] }),
  tpl('effect', '{p:Player} may pay {c:Cost}', { op: 'pay', who: '$p', cost: '$c' }, { id: 'test.maypay', consumes: ['may'] }),
  tpl('effect', 'if {c:Cond} , {e:Effects}', { op: 'if', cond: '$c', then: '$e' }, { id: 'test.if', consumes: ['if'] }),
  tpl('effect', 'exile {o:Objs}', { op: 'move', what: '$o', to: { zone: 'exile' } }, { id: 'test.exile' }),
  tpl('trigger', '( when | whenever ) {e:Event}', { on: '$e' }, { id: 'test.trigger', consumes: ['when', 'whenever'] }),
  tpl('effect', "return {o:Obj} to the battlefield under its owner 's control",{ op: 'move', what: '$o', to: { zone: 'battlefield', controller: 'owner' } }, { id: 'test.return' }),
  tpl('effect', 'put {n:Qty} {k:CounterKind} counter[s] on {o:Obj}', { op: 'putCounters', on: '$o', kind: '$k', count: '$n' }, { id: 'test.counters' }),
  // a rider that folds the destination of "countered this way" into the counter (CR 608.2c, 614.15)
  tpl('rider', "if that spell is countered this way , put it on the bottom of its owner 's library instead of into that player 's graveyard",
    { $patchPrevious: { to: { zone: 'library', position: 'bottom' } } }, { id: 'test.rid.countered', attachTo: 'counter', consumes: ['if', 'this way', 'instead'] }),
  // the type change of a manland, and its rider (CR 205.1b)
  tpl('effect', '{o:Obj} becomes a 3/3 creature with all creature types {d:Dur}', {
    op: 'effect', duration: '$d',
    effects: [{ s: 'continuous', affects: '$o', mods: [{ layer: 4, types: { set: ['Creature'] }, subtypes: { all: true } }, { layer: '7b', power: 3, toughness: 3 }] }],
  }, { id: 'test.becomes', consumes: ['all'] }),
  tpl('rider', "it's still a land", { $patchPrevious: { effects: [{ mods: [{ types: { set: null, add: ['Creature'] } }] }] } }, { id: 'test.rid.still', attachTo: 'effect', consumes: ['still'] }),
];

/** Parse options: the bootstrap templates plus `extra`. */
export function options(extra: readonly Template[] = [], over: Partial<ParseOptions> = {}): ParseOptions {
  return defaultParseOptions({ templates: [...BOOTSTRAP_TEMPLATES, ...extra], ...over });
}

/** A synthetic single-faced card (invented names and wordings). */
export function card(name: string, typeLine: string, text: string, extra: Partial<OracleCard> = {}): OracleCard {
  return { name, layout: 'normal', type_line: typeLine, oracle_text: text, ...extra } as OracleCard;
}

/** The first face of a parse. */
export function face(c: OracleCard, opts: ParseOptions = options(EXTRA)): FaceParse {
  return parseCard(c, opts).faces[0]!;
}

/** Abilities without display-independent bookkeeping (`src`, `prov`), for comparison with the JSON of design section 13. */
export function bare(defs: readonly AbilityDef[]): unknown[] {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v === null || typeof v !== 'object') return v;
    const out: Rec = {};
    for (const [k, x] of Object.entries(v as Rec)) if (k !== 'src' && k !== 'prov') out[k] = strip(x);
    return out;
  };
  return defs.map(strip);
}

/** A unit for the pass-by-pass tests: steps as the chart would give them (markers included). */
export function unit(index: number, text: string, steps: Rec[], extra: Partial<Unit> = {}): Unit {
  const tokens: Tok[] = lex(text);
  return { index, range: [index * 100, index * 100 + text.length], text, tokens, steps, templates: ['test'], experimental: [], flags: [], ...extra };
}

/** A draft for the pass-by-pass tests. */
export function draft(units: Unit[], extra: Partial<Draft> = {}): Draft {
  return { units, targets: [], selfHeads: ['instant'], mentions: [], names: [], diagnostics: [], ...extra };
}

/** Markers as the hole grammars write them (parser/holes/core.ts). */
export const T = (phrase: Rec): Rec => ({ ref: 'target', id: '', $target: phrase });
export const A = (info: Rec): Rec => ({ ref: 'bound', name: '', $anaphor: info });
export const NUM = (text: string): Rec => ({ q: 'eventAmount', $anaphor: { sort: 'number', number: 'singular', text } });
export const creature = (text = 'target creature', min = 1, max = 1): Rec => ({ kind: 'object', filter: { types: ['Creature'] }, min, max, text });

/** Deep freeze: a pass that edits its input throws in strict mode. */
export function freeze<T>(v: T): T {
  if (v !== null && typeof v === 'object') { Object.values(v as Rec).forEach(freeze); Object.freeze(v); }
  return v;
}
