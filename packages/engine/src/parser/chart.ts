/**
 * The Earley chart parser (design 6.3). Owner: WP6.
 *
 * Templates (pure data, parser/types.ts#Template) are compiled to flat productions. A production's symbols are literal words, typed holes (code grammars in
 * parser/holes, each returning every parse) and the nonterminal `Effects` (a sequence of effect templates joined by "," "and" "then" ".", derived here).
 * `parseUnit` runs the parser over the tokens of ONE unit and answers:
 *
 *   ok           exactly one canonical result remains. A derivation must consume EVERY token of the unit (guard G1): there is no prefix matching and no skipping.
 *                Derivations with the same canonical JSON are one (harmless ambiguity, "artifact or creature you control"); the ones that lost the ranking (fewer
 *                unspecific holes, then the highest template priority in the derivation, never the sum) are listed in `outranked` for the CI check on
 *                equal-priority conflicts. Values are deep copies, frozen: the lowering passes are pure.
 *   ambiguous    two or more best derivations whose canonical JSON differs (guard G5): the unit is manual; both are listed.
 *   fail         no derivation; `furthest` is the first token the parser could not get past and `expected` what it would have accepted there (input of the LLM
 *                repair prompt and the mining report), `unknownWords` every word of the unit that no grammar or template knows (guard G2).
 *   needs-engine the best derivation (ranked over ALL templates, so an approximate reading of a lower template never replaces it) uses templates whose
 *                `needs` capabilities this engine lacks (guard G8).
 *   budget       more than `budget` chart items (default 200,000, design 6.3 rule 4), a derivation too large to compare, or a stack overflow: the unit is manual.
 *
 * Every result carries `items`, the number of chart items built, so the caller can enforce the budget "per ability" across the units of one ability.
 *
 * Rules: CR 608.2c (instructions are followed in the order written; "then" orders only), CR 118.12a ("unless pays" wrappers; design D3: a "may" template
 * never wraps an "unless ... pays" wrapper, see mayAroundUnless), CR 115.1 and 601.2c
 * (the target phrases the holes produce), CR 603.2 (trigger clauses), CR 614.15 (rider folds). Guards of design 6.8: G1 (whole units), G2 (closed vocabulary), G5.
 *
 * Items carry their captured values, and two items are the same only if their captures have the same canonical JSON. That is what makes "ambiguity by
 * canonical JSON" exact without building a parse forest.
 */
import type { HoleType, ParseOptions, Template, TemplateKind } from './types';
import type { Alt, HoleCtx } from './holes/core';
import { NUMBER_WORDS, canonicalJson, isGrammarWord } from './holes/core';
import type { HoleEnv } from './holes';
import { CHART_HOLES, HOLES, makeHoleCtx } from './holes';
import type { Tok } from './holes/tok';

export const OWNER = 'WP6' as const;

export const DEFAULT_BUDGET = 200_000;

// ---------------------------------------------------------------------------
// pattern DSL -> productions
// ---------------------------------------------------------------------------

type Node =
  | { t: 'lit'; alts: string[] }
  | { t: 'start' }
  | { t: 'end' }
  | { t: 'hole'; name: string; type: HoleType }
  | { t: 'opt'; seq: Node[] }
  | { t: 'alt'; alts: Node[][] };

type Sym =
  | { t: 'lit'; alts: readonly string[] }
  | { t: 'start' }
  | { t: 'end' }
  | { t: 'hole'; name: string; type: HoleType }
  | { t: 'nt'; name: string; cap: string | null };

const HOLE_TYPES: readonly string[] = [...Object.keys(HOLES), ...CHART_HOLES];
const MAX_EXPANSIONS = 512;

/** Pattern text -> nodes. Throws a plain Error on a malformed pattern. */
export function parsePattern(src: string): Node[] {
  let i = 0;
  const n = src.length;
  const fail = (msg: string): never => { throw new Error(`${msg} at ${i} in "${src}"`); };

  const parseSeq = (stop: string): Node[] => {
    const seq: Node[] = [];
    while (i < n) {
      const c = src[i]!;
      if (c === ' ' || c === '\t') { i++; continue; }
      if (stop.includes(c)) break;
      if (c === '(') {
        i++;
        const alts: Node[][] = [];
        for (;;) {
          alts.push(parseSeq('|)'));
          if (src[i] === '|') { i++; continue; }
          if (src[i] === ')') { i++; break; }
          fail('unclosed (');
        }
        seq.push({ t: 'alt', alts });
        continue;
      }
      if (c === '[') {
        i++;
        const inner = parseSeq(']');
        if (src[i] !== ']') fail('unclosed [');
        i++;
        seq.push({ t: 'opt', seq: inner });
        continue;
      }
      if (c === '{') {
        const j = src.indexOf('}', i);
        if (j < 0) fail('unclosed {');
        const body = src.slice(i + 1, j);
        i = j + 1;
        const colon = body.indexOf(':');
        if (colon < 0) { seq.push({ t: 'lit', alts: [`{${body.toLowerCase()}}`] }); continue; }
        const name = body.slice(0, colon);
        const type = body.slice(colon + 1);
        if (!/^[a-z][A-Za-z0-9]*$/.test(name)) fail(`bad hole name "${name}"`);
        if (!HOLE_TYPES.includes(type)) fail(`unknown hole type "${type}"`);
        seq.push({ t: 'hole', name, type: type as HoleType });
        continue;
      }
      if (c === '^') { i++; seq.push({ t: 'start' }); continue; }
      // r5-dig INTERFACE CHANGE (additive): "$" matches only at the end of the unit (the sentence, its final period stripped), as "^" only at its start: a
      // template that reads an instruction only where nothing is joined after it ("You may reveal up to two creature cards from among them." but never the
      // first half of "... from among them and put them into your hand", which another template reads whole). A rules pack that ships one needs r5-dig or later.
      if (c === '$') { i++; seq.push({ t: 'end' }); continue; }
      if (c === '|' || c === ')' || c === ']' || c === '}') fail(`unexpected ${c}`);
      if (c === ',' || c === '.' || c === ':' || c === ';' || c === '!') { i++; seq.push({ t: 'lit', alts: [c] }); continue; }
      if (c === '~') { i++; seq.push({ t: 'lit', alts: ['~'] }); continue; }
      // a word, possibly with a [s] / [es] agreement suffix glued to it
      const m = /^[A-Za-z0-9'’+\-/*ˣ]+/.exec(src.slice(i)); // FAST5 T65: also the superscript x of "2ˣ"
      if (m === null) fail(`unexpected character "${c}"`);
      const word = m![0].toLowerCase().replace(/’/g, "'");
      i += m![0].length;
      const suf = /^\[(s|es)\]/.exec(src.slice(i));
      if (suf !== null) { i += suf[0].length; seq.push({ t: 'lit', alts: [word, word + suf[1]] }); }
      else seq.push({ t: 'lit', alts: [word] });
    }
    return seq;
  };
  const seq = parseSeq('');
  if (i < n) fail('trailing input');
  return seq;
}

function expand(nodes: Node[], budget: { n: number }): Sym[][] {
  let acc: Sym[][] = [[]];
  for (const node of nodes) {
    let options: Sym[][];
    switch (node.t) {
      case 'lit': options = [[{ t: 'lit', alts: node.alts }]]; break;
      case 'start': options = [[{ t: 'start' }]]; break;
      case 'end': options = [[{ t: 'end' }]]; break;
      case 'hole': options = [[node.type === 'Effects' ? { t: 'nt', name: 'Effects', cap: node.name } : { t: 'hole', name: node.name, type: node.type }]]; break;
      case 'opt': options = [[], ...expand(node.seq, budget)]; break;
      case 'alt': options = node.alts.flatMap((a) => expand(a, budget)); break;
    }
    const next: Sym[][] = [];
    for (const a of acc) {
      for (const o of options) {
        next.push([...a, ...o]);
        if (++budget.n > MAX_EXPANSIONS) throw new Error(`pattern expands to more than ${MAX_EXPANSIONS} productions`);
      }
    }
    acc = next;
  }
  return acc;
}

// ---------------------------------------------------------------------------
// build (the substitution language of Template.build)
// ---------------------------------------------------------------------------

/** Names referenced by a build ("$x", "$x.y", {"$when":"x"}); throws on a directive that does not exist. */
function buildRefs(build: unknown, out: Set<string>): void {
  if (typeof build === 'string') { if (build.startsWith('$')) out.add(build.slice(1).split('.')[0]!); return; }
  if (build === null || typeof build !== 'object') return;
  if (Array.isArray(build)) { for (const x of build) buildRefs(x, out); return; }
  const o = build as Record<string, unknown>;
  if ('$when' in o) {
    const keys = Object.keys(o);
    if (typeof o['$when'] !== 'string' || !keys.every((k) => k === '$when' || k === 'then' || k === 'else') || !('then' in o)) throw new Error('$when needs a hole name and a "then" (and optionally "else")');
    out.add(o['$when']);
    buildRefs(o['then'], out);
    buildRefs(o['else'], out);
    return;
  }
  // FAST5 T64 INTERFACE CHANGE (additive): a target phrase the template spells out in its own words, whose description no hole grammar reads ("up to one target
  // creature on the battlefield or creature card in a graveyard"): `{"ref":"target","id":"","$target":{kind, filter, min, max, text}}`, the marker the Obj
  // hole writes (holes/core.ts#targetRef); `text` is the phrase's words exactly as the pattern spells them (the targets pass finds the phrase by them)
  if ('$target' in o) {
    const t = o['$target'];
    if (o['ref'] !== 'target' || o['id'] !== '' || Object.keys(o).length !== 3 || t === null || typeof t !== 'object' || typeof (t as Record<string, unknown>)['text'] !== 'string'
      || typeof (t as Record<string, unknown>)['kind'] !== 'string' || (t as Record<string, unknown>)['min'] === undefined || (t as Record<string, unknown>)['max'] === undefined) {
      throw new Error('$target must be {"ref":"target","id":"","$target":{kind, min, max, text, filter?}}');
    }
    return;
  }
  // LOOK3 INTERFACE CHANGE (additive): the marker the Cond hole writes for "you do" / "you don't" (holes/cond.ts: `{"cond":"did","step":"","$step":"previous"}`, with
  // `not` and the zone `to`), for a condition a template spells out in its own words ("If you don't put the card onto the battlefield, ...", zz-cloud/look3.json):
  // lower/conditions.ts#resolveDid names the instruction it reads, or the sentence is manual (unbound-reference)
  // std-rx31 INTERFACE CHANGE (additive): or `"$step":"castThisWay"` with `not`, "if it wasn't cast this way" (the one optional cast of yours earlier in the ability, resolveDid)
  if ('$step' in o && o['$step'] === 'castThisWay') {
    if (o['cond'] !== 'did' || o['step'] !== '' || o['not'] !== true || Object.keys(o).length !== 4) throw new Error('$step "castThisWay" must be {"cond":"did","step":"","$step":"castThisWay","not":true}');
    return;
  }
  if ('$step' in o) {
    if (o['cond'] !== 'did' || o['step'] !== '' || o['$step'] !== 'previous' || !Object.keys(o).every((k) => ['cond', 'step', '$step', 'not', 'to'].includes(k))
      || (o['not'] !== undefined && typeof o['not'] !== 'boolean') || (o['to'] !== undefined && o['to'] !== 'battlefield' && o['to'] !== 'hand')) {
      throw new Error('$step must be {"cond":"did","step":"","$step":"previous"} with optionally "not" (a boolean) and "to" ("battlefield" or "hand")');
    }
    return;
  }
  // CLOUD C4 INTERFACE CHANGE (additive): a reference the template spells out in its own words with no pronoun for a hole to read ("destroy all OTHER creatures" after
  // "destroy target creature"): `{"ref":"bound","name":"","$anaphor":{sort, number, text, head?}}`, the marker the Obj hole writes for "it" / "that creature"
  // (holes/core.ts#anaphorObj); the anaphora pass resolves it by the unique-candidate rule (design 6.4) or leaves the sentence manual
  if ('$anaphor' in o) {
    const a = o['$anaphor'] as Record<string, unknown> | null;
    if (o['ref'] !== 'bound' || o['name'] !== '' || Object.keys(o).length !== 3 || a === null || typeof a !== 'object'
      || typeof a['sort'] !== 'string' || typeof a['number'] !== 'string' || typeof a['text'] !== 'string') {
      throw new Error('$anaphor must be {"ref":"bound","name":"","$anaphor":{sort, number, text, head?}}');
    }
    return;
  }
  if ('$patchPrevious' in o) {
    if (Object.keys(o).length !== 1) throw new Error('$patchPrevious must be the only key');
    buildRefs(o['$patchPrevious'], out);
    return;
  }
  // FAST5 T62: {"$concat": [X, Y, ...]} is one array of the arrays and items it lists
  if ('$concat' in o) {
    if (Object.keys(o).length !== 1 || !Array.isArray(o['$concat'])) throw new Error('$concat must be the only key and hold an array');
    buildRefs(o['$concat'], out);
    return;
  }
  for (const k of Object.keys(o)) {
    if (k.startsWith('$')) throw new Error(`unknown directive ${k}`);
    buildRefs(o[k], out);
  }
}

function lookup(caps: Readonly<Record<string, unknown>>, ref: string): unknown {
  const parts = ref.split('.');
  let v: unknown = caps[parts[0]!];
  for (let k = 1; k < parts.length && v !== undefined; k++) {
    if (v === null || typeof v !== 'object') return undefined;
    v = (v as Record<string, unknown>)[parts[k]!];
  }
  return v;
}

/**
 * Substitute captured values into a template build. "$hole" / "$hole.field.path" become the captured value (a missing value drops the member);
 * {"$when":"hole","then":X,"else":Y} chooses by presence; {"$patchPrevious":{...}} is kept as a marker object for the riders pass.
 */
export function instantiate(build: unknown, caps: Readonly<Record<string, unknown>>): unknown {
  if (typeof build === 'string') return build.startsWith('$') ? lookup(caps, build.slice(1)) : build;
  if (build === null || typeof build !== 'object') return build;
  if (Array.isArray(build)) return build.map((x) => instantiate(x, caps)).filter((x) => x !== undefined);
  const o = build as Record<string, unknown>;
  if ('$when' in o) return caps[o['$when'] as string] !== undefined ? instantiate(o['then'], caps) : instantiate(o['else'], caps);
  // FAST5 T62: the arrays and items of a "$concat" list joined into one array (a missing value drops out; a missing array makes the whole list missing)
  if ('$concat' in o) {
    const items = (o['$concat'] as unknown[]).map((x) => instantiate(x, caps));
    return items.some((x) => x === undefined) ? undefined : items.flatMap((x) => (Array.isArray(x) ? x : [x]));
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o)) {
    const v = instantiate(o[k], caps);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// compiled grammar
// ---------------------------------------------------------------------------

interface Prod {
  id: number;
  lhs: string;
  syms: readonly Sym[];
  tpl?: Template;
  /** Effects productions: how the value is built from the captures. */
  special?: 'effects-first' | 'effects-next';
}

export interface CompiledTemplates {
  prods: Prod[];
  errors: { id: string; message: string }[];
  /** Words used as literals by the templates (for unknown-word reporting). */
  words: Set<string>;
}

/** CR 608.2c: effects are joined by commas, "and", "then" and the sentence mark; "then" implies order only, never success (that is "if you do", CR 118.12). */
const JOINERS: string[][] = [[','], ['and'], ['then'], [',', 'then'], [',', 'and'], ['.'], ['.', 'then']];
/**
 * Compiled grammars by array identity, with a snapshot of the elements the grammar was built from: pushing, removing or replacing a template of an
 * array that was already used compiles again. Templates themselves are immutable data; editing one in place is not seen.
 */
const COMPILED = new WeakMap<readonly Template[], { snapshot: readonly Template[]; compiled: CompiledTemplates }>();

const sameTemplates = (a: readonly Template[], b: readonly Template[]): boolean => a.length === b.length && a.every((t, i) => t === b[i]);

/**
 * P1 (performance): compiled grammars by the identities of their templates, in order, for arrays seen for the first time. The G10 retries of parser/parse.ts
 * (`attempt` without one template, `stableOnly`) build a new array for every ability or face they lower again, and compiling the whole set each time was a
 * sixth of the time of a coverage run. The same templates in the same order compile to the same grammar, so an array with the same elements reuses it.
 * Least recently used first out, `CONTENT_SIZE` entries (a grammar holds every production of the set). A process-wide memo that outlives actions: a
 * proposed deviation pending review (see rules/characteristics.ts `RECENT`).
 */
const TEMPLATE_IDS = new WeakMap<Template, number>();
let nextTemplateId = 0;
const BY_CONTENT = new Map<string, CompiledTemplates>();
const CONTENT_SIZE = 48;

/** The identity key of a template array, or null when an element is not an object (a malformed pack entry: compiled without the content cache). */
function contentKey(templates: readonly Template[]): string | null {
  let key = '';
  for (const t of templates) {
    if (t === null || typeof t !== 'object') return null;
    let id = TEMPLATE_IDS.get(t);
    if (id === undefined) TEMPLATE_IDS.set(t, (id = nextTemplateId++));
    key += `${id},`;
  }
  return key;
}

/** Compile templates once per array content (cached). Malformed templates are reported in `errors` and skipped: a bad pack template never breaks parsing. */
export function compileTemplates(templates: readonly Template[]): CompiledTemplates {
  const hit = COMPILED.get(templates);
  if (hit !== undefined && sameTemplates(hit.snapshot, templates)) return hit.compiled;
  const key = contentKey(templates);
  const same = key === null ? undefined : BY_CONTENT.get(key);
  if (same !== undefined) {
    BY_CONTENT.delete(key!);
    BY_CONTENT.set(key!, same); // most recently used last
    COMPILED.set(templates, { snapshot: [...templates], compiled: same });
    return same;
  }
  const out = compileFresh(templates);
  COMPILED.set(templates, { snapshot: [...templates], compiled: out });
  if (key !== null) {
    BY_CONTENT.set(key, out);
    if (BY_CONTENT.size > CONTENT_SIZE) BY_CONTENT.delete(BY_CONTENT.keys().next().value!);
  }
  return out;
}

function compileFresh(templates: readonly Template[]): CompiledTemplates {
  const prods: Prod[] = [];
  const errors: CompiledTemplates['errors'] = [];
  const words = new Set<string>();
  let nextId = 0;

  // the Effects nonterminal: Effects := Effect | Effects Joiner Effect
  prods.push({ id: nextId++, lhs: 'Effects', syms: [{ t: 'nt', name: 'Effect', cap: 'e' }], special: 'effects-first' });
  for (const j of JOINERS) {
    prods.push({
      id: nextId++, lhs: 'Effects', special: 'effects-next',
      syms: [{ t: 'nt', name: 'Effects', cap: 'p' }, ...j.map((w): Sym => ({ t: 'lit', alts: [w] })), { t: 'nt', name: 'Effect', cap: 'e' }],
    });
    for (const w of j) words.add(w);
  }

  const sorted = [...templates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const tpl of sorted) {
    try {
      if (typeof tpl.id !== 'string' || tpl.id === '') throw new Error('missing id');
      const nodes = parsePattern(tpl.pattern);
      const expansions = expand(nodes, { n: 0 });
      const holeNames = new Set<string>();
      const collect = (ns: Node[]): void => { for (const x of ns) { if (x.t === 'hole') holeNames.add(x.name); else if (x.t === 'opt') collect(x.seq); else if (x.t === 'alt') x.alts.forEach(collect); } };
      collect(nodes);
      const refs = new Set<string>();
      buildRefs(tpl.build, refs);
      for (const r of refs) if (!holeNames.has(r)) throw new Error(`build uses $${r} but the pattern has no hole named ${r}`);
      const lhs = tpl.kind === 'effect' ? 'Effect' : tpl.kind;
      const fresh: Prod[] = [];
      for (const syms of expansions) {
        if (syms.length === 0 || syms.every((s) => s.t === 'start' || s.t === 'end')) throw new Error('empty production');
        if (syms.some((s, k) => s.t === 'end' && k !== syms.length - 1)) throw new Error('"$" must be the last symbol of a pattern');
        // A production that is only a nonterminal ("[you may] {e:Effects}" with the optional part left out) is a unit cycle: Effect -> Effects -> Effect derives
        // itself without consuming a token, and every trip around nests the captured value, so no two items are ever equal and the chart never saturates.
        const body = syms.filter((x) => x.t !== 'start' && x.t !== 'end');
        if (body.length === 1 && body[0]!.t === 'nt') throw new Error('an expansion that is only {x:Effects} is a unit cycle (Effect -> Effects -> Effect): give every expansion a literal word or another hole, or write the optional part as a template of its own');
        const seen = new Set<string>();
        for (const s of syms) {
          const nm = s.t === 'hole' ? s.name : s.t === 'nt' && s.cap !== null ? s.cap : null;
          if (nm !== null) { if (seen.has(nm)) throw new Error(`hole name ${nm} used twice`); seen.add(nm); }
        }
        fresh.push({ id: nextId++, lhs, syms, tpl });
      }
      prods.push(...fresh);
      for (const syms of expansions) for (const s of syms) if (s.t === 'lit') for (const a of s.alts) words.add(a);
    } catch (e) {
      errors.push({ id: typeof tpl.id === 'string' ? tpl.id : '?', message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { prods, errors, words };
}

/** Template problems found by compiling (empty = every template is well formed). Used by the CI check on template files. */
export function validateTemplates(templates: readonly Template[]): { id: string; message: string }[] {
  const ids = new Map<string, number>();
  const extra: { id: string; message: string }[] = [];
  for (const t of templates) {
    ids.set(t.id, (ids.get(t.id) ?? 0) + 1);
    if (!Array.isArray(t.cr) || t.cr.length === 0) extra.push({ id: t.id, message: 'a template must cite at least one rule (cr)' });
    if (!Array.isArray(t.counterExamples) || t.counterExamples.length < 2) extra.push({ id: t.id, message: 'a template needs at least two counterExamples' });
    if (!Array.isArray(t.examples) || t.examples.length < 1) extra.push({ id: t.id, message: 'a template needs at least one example' });
  }
  for (const [id, c] of ids) if (c > 1) extra.push({ id, message: 'duplicate template id' });
  return [...compileTemplates(templates).errors, ...extra];
}

// ---------------------------------------------------------------------------
// results
// ---------------------------------------------------------------------------

export interface HoleUse { name: string; type: HoleType; start: number; end: number }

/** One template application inside a derivation, with the token range it covers. `template` is absent for the Effects sequence node. */
export interface TemplateUse { template?: Template; start: number; end: number; holes: HoleUse[]; children: TemplateUse[] }

export interface Derivation {
  /** The built JSON (for the `effects` goal: the array of steps). */
  value: unknown;
  templatesUsed: string[];
  experimental: string[];
  weak: number;
  /** The highest `priority` of any template of the derivation (not the sum: more templates must not rank higher). */
  priority: number;
  flags: string[];
  /** The whole derivation tree: which template covered which tokens and which holes it used (guard G3 and the lowering passes read this). */
  tree: TemplateUse;
}

export type ChartGoal = TemplateKind | 'effects';

export interface ChartInput {
  tokens: readonly Tok[];
  templates: readonly Template[];
  env: HoleEnv;
  goal: ChartGoal;
  /** Capabilities of the running engine: templates whose `needs` are not all present are skipped. Absent = all templates active. */
  capabilities?: ReadonlySet<string>;
  /** Hard limit on chart items (default 200,000). */
  budget?: number;
  /** Ignore one final "." (the sentence mark is not content). Default true. */
  stripFinalPeriod?: boolean;
}

export interface ChartOk {
  status: 'ok';
  derivation: Derivation;
  /** Other derivations with the same canonical JSON (harmless ambiguity). */
  harmless: number;
  /** Derivations with different JSON that lost the ranking (fewer unspecific holes, then priority): CI fails on equal-priority conflicts, so these should be few. */
  outranked: Derivation[];
  /** Chart items built (all runs of this unit). */
  items: number;
}
export interface ChartAmbiguous { status: 'ambiguous'; alternatives: Derivation[]; items: number }
export interface ChartFail {
  status: 'fail';
  furthest: { index: number; token: string; expected: string[] };
  /** Every word of the unit that no grammar, vocabulary or template knows (guard G2); empty when the failure has another cause. */
  unknownWords: { index: number; token: string }[];
  /** Templates skipped for missing capabilities (informational). */
  skipped: string[];
  templateErrors: { id: string; message: string }[];
  items: number;
}
export interface ChartNeedsEngine { status: 'needs-engine'; derivation: Derivation; missing: string[]; templateIds: string[]; items: number }
/** `items` is what was used when the unit was given up (above the limit for a budget that ran out). */
export interface ChartBudget { status: 'budget'; items: number }
export type ChartResult = ChartOk | ChartAmbiguous | ChartFail | ChartNeedsEngine | ChartBudget;

// ---------------------------------------------------------------------------
// the parser
// ---------------------------------------------------------------------------

type Child = { kind: 'hole'; use: HoleUse } | { kind: 'use'; use: TemplateUse };

interface Item {
  prod: Prod;
  dot: number;
  origin: number;
  caps: Readonly<Record<string, unknown>>;
  capsKey: string;
  weak: number;
  flags: readonly string[];
  children: readonly Child[];
}

interface Completed { value: unknown; weak: number; flags: readonly string[]; use: TemplateUse }

class BudgetExceeded extends Error {
  constructor(readonly items: number) { super('budget'); }
}

/** An item whose captured values print longer than this cannot be compared in reasonable time: the unit is given up (budget). */
const MAX_CAPS_KEY = 400_000;

const altKeys = new WeakMap<Alt, string>();
const keyOfAlt = (a: Alt): string => {
  let k = altKeys.get(a);
  if (k === undefined) { k = canonicalJson(a.value); altKeys.set(a, k); }
  return k;
};

/** The shape of a derivation by template ids: derivations that differ only here are different items even when their JSON is equal (so harmless duplicates are counted). */
const sigs = new WeakMap<TemplateUse, string>();
function sigOf(u: TemplateUse): string {
  let s = sigs.get(u);
  if (s === undefined) { s = `${u.template?.id ?? 'E'}(${u.children.map(sigOf).join(',')})`; sigs.set(u, s); }
  return s;
}

const asSteps = (v: unknown): unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function litMatches(alts: readonly string[], tok: Tok | undefined): boolean {
  return tok !== undefined && tok.kind !== 'QUOTE' && alts.includes(tok.norm);
}

/** The last effect template of a sequence use (the Effects node's rightmost Effect), or undefined. */
function lastEffect(u: TemplateUse): TemplateUse | undefined {
  if (u.template) return u;
  const last = u.children[u.children.length - 1];
  return last ? lastEffect(last) : undefined;
}

/**
 * Design D3, CR 118.12a: in "[player] may X unless P pays C" the payer decides first; the controller's "may" is asked only if P declines. A template that
 * consumes "may" whose effects end in an "unless ... pays" wrapper (a template that consumes "unless" but not "may") would put the controller's choice
 * first; that derivation is never built (WP23 review). The one reading is the dedicated "may ... unless ... pays" template.
 */
function mayAroundUnless(it: Item): boolean {
  if (!(it.prod.tpl?.consumes ?? []).includes('may')) return false;
  return it.children.some((c) => {
    if (c.kind !== 'use' || c.use.template) return false;
    const consumes = lastEffect(c.use)?.template?.consumes ?? [];
    return consumes.includes('unless') && !consumes.includes('may');
  });
}

/** A lead-in conditional: a template that consumes "if", starts "if" or "then if" and ends with its instructions ("if {c:Cond} , {e:Effects}", eff.t34.thenIf). */
const LEAD_IN_IF = new WeakMap<Template, boolean>();
function isLeadInIf(t: Template): boolean {
  let v = LEAD_IN_IF.get(t);
  if (v === undefined) {
    const p = t.pattern.trim();
    v = (t.consumes ?? []).includes('if') && /^(\^\s*)?(then\s+)?if\b/i.test(p) && /\{[a-z]+:Effects\}$/i.test(p);
    // r4-fxz (CR 603.12, 608.2c): a reflexive trigger's lead "When you do, A and B." (rf.whenYouDo) is the same: its instructions are the whole sentence
    // ("When you do, put a +1/+1 counter on target creature and draw a card."), never A in the trigger and B after it
    if (!v) v = (t.consumes ?? []).includes('when') && /^(\^\s*)?when\s+\{c:Cond\}\s*,\s*\{e:Effects\}$/i.test(p);
    // r5-fxz (CR 608.2c): a lead-in "for each" ("For each opponent, A and B.", "Then for each card you put on top of your library, A and B.") repeats every
    // instruction of its sentence, never A alone with B after it
    if (!v) v = /^(\^\s*)?(\[?then\]?\s+)?for each\b/i.test(p) && /,\s*\{[a-z]+:Effects\}$/i.test(p);
    // std-exile-play-1-2 (CR 603.7, 608.2c): a delayed triggered ability's lead "When that creature dies this turn, A, then B." (eff.t50.*): every instruction of its
    // sentence is one of the delayed ability's (it is created with all of them, CR 603.7a), never A in it and B done at once
    if (!v) v = /^(\^\s*)?(until end of turn\s*,\s*)?(when|whenever)\b/i.test(p) && /,\s*\{[a-z]+:Effects\}$/i.test(p) && (t.build as { op?: unknown } | null)?.op === 'delay';
    LEAD_IN_IF.set(t, v);
  }
  return v;
}

/**
 * Cloud std-fin (CR 608.2c; design 6.3 rule 3): "If C, A and B." conditions every instruction of its sentence. A lead-in "if" followed by another instruction joined by
 * ",", "and" or "then" in the SAME sentence would leave that instruction outside the condition, a reading English never gives (Oracle starts a new sentence for an
 * instruction that is not conditional: "If C, A. B."). That derivation is never built; the sentence mark "." is not affected. The other reading always exists (the
 * lead-in's own {e:Effects} reads "A and B" with the same joiners), so before this both were built and the unit was ambiguous (G5): "If you put a card into your hand
 * this way, create a Food token and transform ~."
 * (cloud std-spm wrote the same rule for `cond.if` alone, leadInIfJoined; merged into this one, which covers every lead-in "if" template. A pronoun in the joined
 * instruction is read by lower/mentions.ts#mentionsInside, Cloud std-fin.)
 * The left child of the item is an Effects node (effects-first, or effects-next after an earlier instruction), never the lead-in's own use: `lastEffect` finds its
 * last effect template through every nested Effects node, so B with a subject of its own ("each opponent loses 2 life and you gain 2 life") and longer lists ("If C,
 * A, B, then D") are covered too (test/m5/chart/lead-in-if.test.ts).
 */
function leadInIfCutShort(it: Item): boolean {
  if (it.prod.special !== 'effects-next') return false;
  const joiner = it.prod.syms.slice(1, -1).map((s) => (s.t === 'lit' ? s.alts.join('|') : '?')).join(' ');
  if (joiner === '.' || joiner === '. then') return false;
  const left = it.children[0];
  if (left?.kind !== 'use') return false;
  const last = lastEffect(left.use)?.template;
  return last !== undefined && isLeadInIf(last);
}

/**
 * std-promote-3 (CR 603.7a, 608.2c): "At the beginning of the next end step, sacrifice that token unless you pay ..." (Satya, Aetherflux Genius): a delayed triggered
 * ability's lead ("at the beginning of ..., {e:Effects}", "when ..., {e:Effects}": a template whose build is a `delay` and which starts with a word) takes every
 * instruction of its sentence, the "unless" tail too (the delayed ability is created with all of them), so a tail wrapper ("{e:Effects} unless ...") whose
 * instructions end with such a lead is never built: it would offer the payment now and create the delayed ability only if it is declined. The other reading always
 * exists (the lead's own {e:Effects} reads "A unless ..."), so before this both were built and the unit was ambiguous (G5).
 */
function unlessAroundDelayLead(it: Item): boolean {
  const t = it.prod.tpl;
  if (t === undefined || !(t.consumes ?? []).includes('unless') || !/^\{[a-z]+:Effects\}\s+unless\b/i.test(t.pattern.trim())) return false;
  const left = it.children[0];
  if (left?.kind !== 'use') return false;
  const last = lastEffect(left.use)?.template;
  return last !== undefined && (last.build as { op?: unknown } | null)?.op === 'delay' && /^(\^\s*)?[a-z]/i.test(last.pattern.trim()) && /,\s*\{[a-z]+:Effects\}$/i.test(last.pattern.trim());
}

/** A "may" wrapper: a template that consumes "may" and ends with its instructions ("you may {e:Effects}", ch.may). */
const MAY_WRAP = new WeakMap<Template, boolean>();
function isMayWrap(t: Template): boolean {
  let v = MAY_WRAP.get(t);
  if (v === undefined) {
    v = (t.consumes ?? []).includes('may') && /\{[a-z]+:Effects\}$/i.test(t.pattern.trim());
    MAY_WRAP.set(t, v);
  }
  return v;
}

function firstEffect(u: TemplateUse): TemplateUse | undefined {
  if (u.template) return u;
  const first = u.children[0];
  return first ? firstEffect(first) : undefined;
}

/**
 * Standard round 3, r3-fx (CR 608.2c, 608.2d): "You may exile it, then return it to the battlefield transformed ..." and "you may discard your hand, then draw
 * cards ...": one "you may" says every verb of the instruction it begins, so an instruction WITHOUT a subject of its own joined to the optional ones by ",", "and"
 * or "then" in the same sentence is part of the choice (Oracle starts a new sentence, or says "If you do", for what is not: "You may A. Then B."). The
 * derivation that leaves it outside the "may" is never built; the other always exists (the wrapper's own {e:Effects} reads "A, then B" with the same joiners), so
 * before this both were built and the unit was ambiguous (G5). An instruction with a subject of its own ("you may draw a card and each opponent loses 1 life") is
 * a clause of its own and keeps both readings; the sentence mark "." is not affected (as leadInIfCutShort).
 */
function mayCutShort(it: Item): boolean {
  if (it.prod.special !== 'effects-next') return false;
  const joiner = it.prod.syms.slice(1, -1).map((s) => (s.t === 'lit' ? s.alts.join('|') : '?')).join(' ');
  if (joiner === '.' || joiner === '. then') return false;
  const left = it.children[0];
  const right = it.children[it.children.length - 1];
  if (left?.kind !== 'use' || right?.kind !== 'use' || left === right) return false;
  const last = lastEffect(left.use)?.template;
  if (last === undefined || !isMayWrap(last)) return false;
  const next = firstEffect(right.use)?.template;
  return next !== undefined && next.subject === 'none' && !(next.consumes ?? []).includes('may');
}

interface SetState { items: Item[]; keys: Set<string>; waiting: Map<string, Item[]>; predicted: Set<string>; missed: Set<string> }
interface RunOutcome { goal: Completed[]; sets: SetState[]; count: number }

function run(prods: Prod[], goalLhs: string, ctx: HoleCtx, toks: readonly Tok[], budget: number): RunOutcome {
  const n = toks.length;
  const byLhs = new Map<string, Prod[]>();
  for (const p of prods) { const l = byLhs.get(p.lhs); if (l) l.push(p); else byLhs.set(p.lhs, [p]); }

  const sets: SetState[] = Array.from({ length: n + 1 }, () => ({ items: [], keys: new Set(), waiting: new Map(), predicted: new Set(), missed: new Set() }));
  let count = 0;
  const goal: Completed[] = [];

  const add = (i: number, item: Item): void => {
    const s = sets[i]!;
    const key = `${item.prod.id}|${item.dot}|${item.origin}|${item.capsKey}`;
    if (s.keys.has(key)) return;
    s.keys.add(key);
    s.items.push(item);
    if (++count > budget || item.capsKey.length > MAX_CAPS_KEY) throw new BudgetExceeded(count);
  };

  /** Templates are indexed by their first symbol (design 6.3): a production whose first literal is not the next token, or whose first hole has no parse here, never starts. */
  const startable = (p: Prod, i: number): boolean => {
    let s = p.syms[0];
    if (s !== undefined && s.t === 'start') { if (i !== 0) return false; s = p.syms[1]; }
    if (s === undefined) return true;
    if (s.t === 'lit') return litMatches(s.alts, toks[i]);
    if (s.t === 'hole') return ctx.call(s.type, i).some((a) => a.end > i && a.end <= n);
    return true;
  };

  const predict = (i: number, lhs: string): void => {
    const s = sets[i]!;
    if (s.predicted.has(lhs)) return;
    s.predicted.add(lhs);
    for (const p of byLhs.get(lhs) ?? []) {
      if (!startable(p, i)) { const f = p.syms.find((x) => x.t !== 'start' && x.t !== 'end'); const d = f ? describeSym(f) : null; if (d !== null) s.missed.add(d); continue; }
      add(i, { prod: p, dot: 0, origin: i, caps: {}, capsKey: '', weak: 0, flags: [], children: [] });
    }
  };

  const advance = (it: Item, cap: string | null, value: unknown, valueKey: string, weak: number, flags: readonly string[] | undefined, child: Child | null): Item => ({
    prod: it.prod,
    dot: it.dot + 1,
    origin: it.origin,
    caps: cap === null ? it.caps : { ...it.caps, [cap]: value },
    capsKey: cap === null ? it.capsKey : `${it.capsKey};${cap}=${valueKey}`,
    weak: it.weak + weak,
    flags: flags && flags.length > 0 ? [...new Set([...it.flags, ...flags])] : it.flags,
    children: child === null ? it.children : [...it.children, child],
  });

  const complete = (it: Item, end: number): Completed => {
    const p = it.prod;
    let value: unknown;
    if (p.special === 'effects-first') value = asSteps(it.caps['e']);
    else if (p.special === 'effects-next') value = [...asSteps(it.caps['p']), ...asSteps(it.caps['e'])];
    else value = instantiate(p.tpl!.build, it.caps);
    const holes: HoleUse[] = [];
    const children: TemplateUse[] = [];
    for (const c of it.children) { if (c.kind === 'hole') holes.push(c.use); else children.push(c.use); }
    const use: TemplateUse = { ...(p.tpl ? { template: p.tpl } : {}), start: it.origin, end, holes, children };
    return { value, weak: it.weak + (p.tpl?.weak ?? 0), flags: it.flags, use };
  };

  predict(0, goalLhs);

  for (let i = 0; i <= n; i++) {
    const S = sets[i]!;
    for (let k = 0; k < S.items.length; k++) {
      const it = S.items[k]!;
      const sym = it.prod.syms[it.dot];
      if (sym === undefined) {
        if (mayAroundUnless(it) || leadInIfCutShort(it) || mayCutShort(it) || unlessAroundDelayLead(it)) continue;
        const done = complete(it, i);
        if (it.prod.lhs === goalLhs && it.origin === 0 && i === n) goal.push(done);
        const doneKey = `${canonicalJson(done.value)}#${sigOf(done.use)}`;
        for (const w of sets[it.origin]!.waiting.get(it.prod.lhs) ?? []) {
          const ws = w.prod.syms[w.dot] as Extract<Sym, { t: 'nt' }>;
          add(i, advance(w, ws.cap, done.value, doneKey, done.weak, done.flags, { kind: 'use', use: done.use }));
        }
        continue;
      }
      switch (sym.t) {
        case 'lit':
          if (litMatches(sym.alts, toks[i])) add(i + 1, advance(it, null, undefined, '', 0, undefined, null));
          break;
        case 'start':
          if (i === 0) add(i, advance(it, null, undefined, '', 0, undefined, null));
          break;
        case 'end':
          if (i === n) add(i, advance(it, null, undefined, '', 0, undefined, null));
          break;
        case 'hole':
          for (const a of ctx.call(sym.type, i)) {
            if (a.end <= i || a.end > n) continue;
            add(a.end, advance(it, sym.name, a.value, keyOfAlt(a), a.weak ?? 0, a.flags, { kind: 'hole', use: { name: sym.name, type: sym.type, start: i, end: a.end } }));
          }
          break;
        case 'nt': {
          const w = S.waiting.get(sym.name);
          if (w) w.push(it); else S.waiting.set(sym.name, [it]);
          predict(i, sym.name);
          break;
        }
      }
    }
  }
  return { goal, sets, count };
}

// ---------------------------------------------------------------------------
// ranking and diagnostics
// ---------------------------------------------------------------------------

function toDerivation(c: Completed): Derivation {
  const used: string[] = [];
  const experimental: string[] = [];
  let priority = Number.NEGATIVE_INFINITY;
  const walk = (u: TemplateUse): void => {
    if (u.template) {
      if (!used.includes(u.template.id)) used.push(u.template.id);
      if (u.template.status === 'experimental' && !experimental.includes(u.template.id)) experimental.push(u.template.id);
      priority = Math.max(priority, u.template.priority ?? 0);
    }
    for (const ch of u.children) walk(ch);
  };
  walk(c.use);
  return { value: c.value, templatesUsed: used, experimental, weak: c.weak, priority: Number.isFinite(priority) ? priority : 0, flags: [...c.flags], tree: c.use };
}

/** A deep copy that shares nothing with the chart's memoized hole values or with itself, frozen (the lowering passes are pure functions of it). */
function frozenCopy(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return Object.freeze(v.map(frozenCopy));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) out[k] = frozenCopy(x);
  return Object.freeze(out);
}
const published = (d: Derivation): Derivation => ({ ...d, value: frozenCopy(d.value) });

/** Fewer unspecific holes, then the higher priority, then the shape by template ids (so the choice among equals never depends on the order of the input). */
const better = (a: Derivation, b: Derivation): number => a.weak - b.weak || b.priority - a.priority || (sigOf(a.tree) < sigOf(b.tree) ? -1 : sigOf(a.tree) > sigOf(b.tree) ? 1 : 0);

/** Design 6.3 rules 2-3: group by canonical JSON, rank by fewer unspecific holes then priority, ambiguity (G5) when different JSON ties. */
/**
 * p2-counters-state-2 (CR 107.3, 608.2h): does a reading define X with a "where X is" clause (the intermediate `{lower:'whereX'}` node of lower/quantities.ts) and
 * still use X outside it? "Draw X cards and gain X life, where X is ..." has two readings when a template reads the clause after one instruction: the clause after
 * the last instruction defines X for the whole sentence, so a reading that leaves the first X undefined is not a reading of the sentence.
 */
function xFreeBesideWhereX(v: unknown): boolean {
  let where = false;
  let free = false;
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) { for (const x of n) walk(x); return; }
    if (n === null || typeof n !== 'object') return;
    const r = n as Record<string, unknown>;
    if (r['lower'] === 'whereX') { where = true; walk(r['value']); return; }
    if (r['q'] === 'X' && Object.keys(r).length === 1) free = true;
    for (const k in r) walk(r[k]);
  };
  walk(v);
  return where && free;
}

/**
 * p2-counters-state-2 (CR 107.3, 608.2h): the meaning of a reading with its "where X is" clauses applied (each `{lower:'whereX'}` step replaced by its steps with
 * X substituted, as lower/quantities.ts does): "put an oil counter on ~, then create an X/1 ... token, where X is ..." read with the clause over both instructions or
 * over the second only is one meaning when the first does not use X. Readings are grouped by it, so such readings are one (harmless), never two.
 */
function meaningOf(v: unknown): unknown {
  const subst = (n: unknown, x: unknown): unknown => {
    if (Array.isArray(n)) return n.map((e) => subst(e, x));
    if (n === null || typeof n !== 'object') return n;
    const r = n as Record<string, unknown>;
    if (r['q'] === 'X' && Object.keys(r).length === 1) return x;
    const out: Record<string, unknown> = {};
    for (const k in r) out[k] = subst(r[k], x);
    return out;
  };
  const expand = (n: unknown): unknown => {
    if (Array.isArray(n)) {
      return n.flatMap((e) => {
        const r = e as Record<string, unknown> | null;
        if (r !== null && typeof r === 'object' && !Array.isArray(r) && r['lower'] === 'whereX' && Array.isArray(r['steps'])) return subst(expand(r['steps']), expand(r['value'])) as unknown[];
        return [expand(e)];
      });
    }
    if (n === null || typeof n !== 'object') return n;
    const r = n as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k in r) out[k] = expand(r[k]);
    return out;
  };
  return JSON.stringify(v).includes('"whereX"') ? expand(v) : v;
}

function decide(goal0: Completed[], items: number): ChartOk | ChartAmbiguous | null {
  // p2-counters-state-2: a reading that leaves X undefined beside its own "where X is" clause loses to one that does not (xFreeBesideWhereX)
  const clean = goal0.filter((c) => !xFreeBesideWhereX(c.value));
  const goal = clean.length > 0 && clean.length < goal0.length ? clean : goal0;
  if (goal.length === 0) return null;
  const groups = new Map<string, Derivation[]>();
  for (const c of goal) {
    const d = toDerivation(c);
    const k = canonicalJson(meaningOf(d.value)); // p2-counters-state-2: by meaning, "where X is" applied
    const g = groups.get(k);
    if (g) g.push(d); else groups.set(k, [d]);
  }
  // each group is represented by its best derivation, so the representative never depends on which duplicate came first
  const ranked = [...groups.values()].map((g) => ({ g, best: g.reduce((a, b) => (better(b, a) < 0 ? b : a)) }));
  const minWeak = Math.min(...ranked.map((r) => r.best.weak));
  const lowest = ranked.filter((r) => r.best.weak === minWeak);
  const maxPrio = Math.max(...lowest.map((r) => r.best.priority));
  const best = lowest.filter((r) => r.best.priority === maxPrio);
  if (best.length > 1) return { status: 'ambiguous', alternatives: best.map((r) => published(r.best)), items };
  const winner = best[0]!;
  const outranked = ranked.filter((r) => r !== winner).map((r) => published(r.best));
  return { status: 'ok', derivation: published(winner.best), harmless: winner.g.length - 1, outranked, items };
}

function describeSym(s: Sym): string | null {
  switch (s.t) {
    case 'lit': return s.alts.join('|');
    case 'hole': return `<${s.type}>`;
    case 'nt': return `<${s.name}>`;
    case 'start': return null;
    case 'end': return null;
  }
}

function diagnose(sets: SetState[], toks: readonly Tok[]): { index: number; token: string; expected: string[] } {
  let f = 0;
  for (let i = sets.length - 1; i >= 0; i--) if (sets[i]!.items.length > 0 || sets[i]!.missed.size > 0) { f = i; break; }
  const expected = new Set<string>(sets[f]!.missed);
  for (const it of sets[f]!.items) {
    const s = it.prod.syms[it.dot];
    if (s === undefined) continue;
    const d = describeSym(s);
    if (d !== null) expected.add(d);
  }
  return { index: f, token: f < toks.length ? toks[f]!.text : '<end>', expected: [...expected].sort().slice(0, 40) };
}

function knownWord(ctx: HoleCtx, words: ReadonlySet<string>, tok: Tok): boolean {
  if (tok.kind !== 'WORD') return true;
  const w = tok.norm;
  if (words.has(w) || isGrammarWord(w) || NUMBER_WORDS[w] !== undefined) return true;
  const v = ctx.vocab;
  if (v.types.has(w) || v.supertypes.has(w) || v.colors.has(w) || v.subtypes.has(w) || v.counterKinds.has(w) || v.predefined.has(w) || v.keywords.has(w)) return true;
  // parts of multi-word subtypes and keywords
  for (const m of [v.subtypes, v.keywords]) for (const k of m.keys()) if (k.includes(' ') && k.split(' ').includes(w)) return true;
  if (/^non-?/.test(w)) return true; // "nonblack", "non-Human": the filter grammar checks the rest against the vocabulary
  return false;
}

// ---------------------------------------------------------------------------
// the entry point
// ---------------------------------------------------------------------------

/** The chart input for a unit, from the ParseOptions of parseCard (design 5.3): templates, lexicon, keywords, card names, capabilities and budget carry over. */
export function chartInputFrom(opts: ParseOptions, tokens: readonly Tok[], goal: ChartGoal, subParser?: HoleEnv['subParser']): ChartInput {
  return {
    tokens, goal, templates: opts.templates, capabilities: opts.capabilities,
    env: { lexicon: opts.lexicon, keywords: opts.keywords, ...(opts.cardNames ? { cardNames: opts.cardNames } : {}), ...(subParser ? { subParser } : {}) },
    ...(opts.budget !== undefined ? { budget: opts.budget } : {}),
  };
}

/** Parse ONE unit. Malformed templates are skipped and reported (`templateErrors`); the token array is never modified. */
export function parseUnit(input: ChartInput): ChartResult {
  let used = 0;
  try {
    return parseCounting(input, (n) => { used += n; }, () => used);
  } catch (e) {
    if (e instanceof BudgetExceeded) return { status: 'budget', items: used + e.items };
    if (e instanceof RangeError) return { status: 'budget', items: used }; // a derivation nested too deep to compare: manual, never an exception
    throw e;
  }
}

function parseCounting(input: ChartInput, count: (n: number) => void, total: () => number): ChartResult {
  let toks = input.tokens;
  if ((input.stripFinalPeriod ?? true) && toks.length > 0 && toks[toks.length - 1]!.kind === 'PUNCT' && toks[toks.length - 1]!.norm === '.') toks = toks.slice(0, -1);
  const budget = input.budget ?? DEFAULT_BUDGET;
  const compiled = compileTemplates(input.templates);
  const goalLhs = input.goal === 'effect' || input.goal === 'effects' ? 'Effects' : input.goal;

  const missingOf = (t: Template): string[] => (input.capabilities && t.needs ? t.needs.filter((c) => !input.capabilities!.has(c)) : []);
  const active = compiled.prods.filter((p) => p.tpl === undefined || missingOf(p.tpl).length === 0);
  const skipped = [...new Set(compiled.prods.filter((p) => p.tpl !== undefined && missingOf(p.tpl).length > 0).map((p) => p.tpl!.id))];
  const missingIn = (d: Derivation): string[] => {
    const missing = new Set<string>();
    const walk = (u: TemplateUse): void => { if (u.template) for (const m of missingOf(u.template)) missing.add(m); u.children.forEach(walk); };
    walk(d.tree);
    return [...missing].sort();
  };

  const ctx = makeHoleCtx(toks, input.env);
  // Guard G8: rank over ALL templates, so the winner is the same whatever this engine can run. If the winner needs a capability that is missing, the unit is
  // needs-engine; it never falls back to the next best reading, which is a known-approximate one.
  const first = runCounted(skipped.length > 0 ? compiled.prods : active, goalLhs, ctx, toks, budget, count);
  const decided = decide(first.goal, total());
  if (decided !== null) {
    if (skipped.length === 0) return decided;
    if (decided.status === 'ok') {
      const missing = missingIn(decided.derivation);
      return missing.length > 0 ? { status: 'needs-engine', derivation: decided.derivation, missing, templateIds: decided.derivation.templatesUsed, items: total() } : decided;
    }
    // best derivations that tie: if one of them needs a missing capability, the ranking could change with it
    const needy = decided.alternatives.find((d) => missingIn(d).length > 0);
    if (needy !== undefined) {
      const missing = [...new Set(decided.alternatives.flatMap(missingIn))].sort();
      return { status: 'needs-engine', derivation: needy, missing, templateIds: needy.templatesUsed, items: total() };
    }
    return decided;
  }

  // no derivation at all: diagnose over the templates this engine can run
  const outcome = skipped.length > 0 ? runCounted(active, goalLhs, ctx, toks, budget, count) : first;
  const unknownWords: { index: number; token: string }[] = [];
  toks.forEach((t, index) => { if (!knownWord(ctx, compiled.words, t)) unknownWords.push({ index, token: t.text }); });
  return { status: 'fail', furthest: diagnose(outcome.sets, toks), unknownWords, skipped, templateErrors: compiled.errors, items: total() };
}

/** One run of the parser, its items counted for the unit (a run that ran out of budget reports its items through the exception). */
function runCounted(prods: Prod[], goalLhs: string, ctx: HoleCtx, toks: readonly Tok[], budget: number, count: (n: number) => void): RunOutcome {
  const out = run(prods, goalLhs, ctx, toks, budget);
  count(out.count);
  return out;
}
