/**
 * The golden-corpus harness of guard G10 (design 6.8, 15.4 "Golden"): hand-verified ability JSON per card, against which the parser's output is
 * checked with every template that is merged (all files under src/parser/templates). Owner: WP25 (harness); content: WP19-WP23 (and anyone who
 * verifies a card by hand).
 *
 * The rule (never silently wrong):
 *  - every ability the parser FULLY understands (not a manual ability, no manual node, design 10.1) must equal, as behavior, one golden ability of the
 *    same face;
 *  - every PARTIAL ability (understood around one or more manual nodes) runs its automated nodes in play, so those must agree too: the parsed ability
 *    with its manual nodes masked must match one golden ability of the face everywhere outside the masks (a mask matches any subtree, in an array any
 *    run of one or more elements; the golden ability may announce targets the masked sentences would announce). A disagreement is a mismatch;
 *  - the parsed faces must pass the card-wide lint (model/validate#validateCardAbilities): a linked ability (CR 607.1, 607.2a) that reads a link no
 *    ability of the card produces would silently do nothing in play.
 * Golden abilities not matched by a fully understood ability are "pending": allowed, counted, reported. An entry may also pin progress with
 * `expect: "full"`: then every golden ability must be matched by a fully understood ability (a ratchet; a regression fails).
 *
 * Behavior = the canonical JSON (model/canonical) with display fields stripped (model/strip: text, labels, spans, target and mode texts) and without
 * `prov` and `src`, up to the reviewed representation equivalences of `EQUIVALENCES`. So golden files carry NO Oracle text (design 6.10: committed
 * data holds no Wizards text; they are keyed by Oracle name).
 *
 * Sources: the 53 worked examples of design section 13 (read from the design document itself, test/m5/model/examples.ts: no second copy to drift) and
 * every `*.json` file in test/m5/golden/cards/, each an array of entries:
 *   { "card": "<Oracle name>", "faces": [ { "abilities": [ <stored ability> ] } ], "expect"?: "full", "verified": "<who checked it, against which rules>" }
 * Both are enforced the same way. Cards come from the fixture set, else from the local Oracle index (git-ignored; a card that is in neither is skipped).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AbilityDef } from '../../../src/types/ability';
import type { OracleCard } from '../../../src/types/card';
import type { ParseOptions, Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { canonicalize } from '../../../src/model/canonical';
import { stripAbility } from '../../../src/model/strip';
import { manualNodes } from '../../../src/model/classify';
import { validateCardAbilities } from '../../../src/model/validate';
import { ENGINE_CAPABILITIES } from '../../../src/model';
import { loadFixtureCards } from '../../fixtures';
import { EXAMPLES } from '../model/examples';
import { localIndex } from '../parser/support';

const HERE = dirname(fileURLToPath(import.meta.url));
export const GOLDEN_DIR = join(HERE, 'cards');
export const TEMPLATES_DIR = resolve(HERE, '../../../src/parser/templates');

export interface GoldenEntry {
  card: string;
  faces: { abilities: unknown[] }[];
  /** A ratchet: every golden ability must be fully understood by the parser. */
  expect?: 'full';
  /** Who verified the JSON and against which rules. */
  verified?: string;
  /** Where the entry comes from ("design 13" or the file name). */
  source: string;
}

function jsonFiles(dir: string): string[] {
  const out: string[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(dir).sort();
  } catch {
    return out;
  }
  for (const n of names) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...jsonFiles(p));
    else if (n.endsWith('.json')) out.push(p);
  }
  return out;
}

/** Every template under `dir` (default: all files under src/parser/templates, in path order): the golden set is checked with what the build ships. */
export function goldenTemplates(dir: string = TEMPLATES_DIR): Template[] {
  return jsonFiles(dir).flatMap((f) => JSON.parse(readFileSync(f, 'utf8')) as Template[]);
}

export function goldenOptions(templates: readonly Template[] = goldenTemplates()): ParseOptions {
  return defaultParseOptions({ templates: [...templates], capabilities: ENGINE_CAPABILITIES });
}

/**
 * M6-1: the worked examples whose MILESTONE 6 form the M5 design writes in section 14 ("#### <card> (milestone 6 form)"). Once milestone 6 runs that form
 * (Magma Spray's shield with a `modify` body, `feature:shield.modify`), the parser produces it and it is the card's golden JSON; section 13 keeps the
 * milestone 5 form, which the bootstrap-template tests of milestone 5 still read.
 */
function milestone6Forms(): Map<string, { abilities: unknown[] }[]> {
  const text = readFileSync(resolve(HERE, '../../../../../docs/design/m5-ability-model.md'), 'utf8');
  const start = text.indexOf('## 14. Milestone 6 hooks');
  const end = text.indexOf('## 15. Implementation plan');
  const out = new Map<string, { abilities: unknown[] }[]>();
  if (start < 0 || end < 0) return out;
  for (const part of text.slice(start, end).split(/^#### /m).slice(1)) {
    const m = /^(.*) \(milestone 6 form\)\n/.exec(part);
    const block = /```json\n([\s\S]*?)\n```/.exec(part);
    if (!m || !block) continue;
    const json = JSON.parse(block[1]!) as { abilities?: unknown[]; faces?: { abilities: unknown[] }[] };
    out.set(m[1]!.trim(), json.faces ?? [{ abilities: json.abilities ?? [] }]);
  }
  return out;
}

/**
 * FAST5 T76: the documented deviations of a design section 13 card that the parser now automates (the same list as test/m5/templates-e/wp23-golden.test.ts, which
 * checks the card with the WP23 templates alone): Sneak Attack. The Filter hole says the chosen object is a card (CR 400.7a: an object in a hand is a card), the
 * Abilities hole writes the keyword text in lower case, and the instructions after the optional choice carry no `did` guard: with no card chosen the name is bound
 * to nothing, so the continuous effect affects nothing and the delayed trigger sacrifices nothing (CR 608.2c, 603.7c; test/fast5/t76 plays both cases).
 */
function withDeviations(card: string, faces: GoldenEntry['faces']): GoldenEntry['faces'] {
  if (card !== 'Sneak Attack') return faces;
  const strip = (x: unknown): unknown => (Array.isArray(x) ? x.map(strip) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'guard').map(([k, y]) => [k, strip(y)])) : x);
  const json = JSON.stringify(faces)
    .replace('"zone":"hand","owner":"you","types":["Creature"]}', '"zone":"hand","owner":"you","types":["Creature"],"isCard":true}')
    .replace('"text":"Haste"', '"text":"haste"');
  return strip(JSON.parse(json)) as GoldenEntry['faces'];
}

/** The golden entries: design section 13 (its milestone 6 form where section 14 writes one), then every file of test/m5/golden/cards. */
export function loadGolden(dir: string = GOLDEN_DIR): GoldenEntry[] {
  const m6 = milestone6Forms();
  const out: GoldenEntry[] = EXAMPLES.map((e) => ({ card: e.name, faces: withDeviations(e.name, m6.get(e.name) ?? e.faces), source: 'design 13' }));
  for (const f of jsonFiles(dir)) {
    const data = JSON.parse(readFileSync(f, 'utf8')) as Omit<GoldenEntry, 'source'>[];
    if (!Array.isArray(data)) throw new Error(`${f}: a golden file holds an array of entries`);
    for (const e of data) out.push({ ...e, source: f.slice(dir.length + 1).replace(/\\/g, '/') });
  }
  return out;
}

let byName: Map<string, OracleCard> | undefined;
/** The card: the fixture set first, then the local index; undefined when neither has it. */
export function goldenCard(name: string): OracleCard | undefined {
  const fixture = loadFixtureCards()[name];
  if (fixture) return fixture;
  if (!byName) byName = new Map((localIndex() ?? []).map((c) => [c.name, c]));
  return byName.get(name);
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const BOOKKEEPING = new Set(['prov', 'src']);

/**
 * The reviewed representation equivalences: an explicit list, each with the rule that makes the two forms mean the same. Anything else that differs
 * is a mismatch. A new entry needs a review (design 6.8 G10: a golden mismatch is either a parser bug or a golden bug, never "close enough").
 */
export const EQUIVALENCES: readonly string[] = [
  "player target: `players: {who: 'any'}` = no `players` (CR 115.1: no restriction either way; decided by the hole grammars, WP6)",
  'object target: `filter: {}` = no `filter` (CR 115.1)',
  "binding names up to renaming, through ONE map in document order over every place a name is written or read: `as`, an exileUntil step's `exiled`, `{ref:'bound', name}`, " +
    "`{cond:'did', step}`, `{q:'resultCount', step}`, `{op:'let', name}`, `{q:'var', name}`, `delay.capture` (CR 608.2c: 'if you do' reads one " +
    'specific earlier step, so both sides are renamed together)',
  "a token's `name` equal to its subtypes (with or without the word 'Token') = no `name` (CR 111.4: an unnamed token is named after its subtypes)",
  "`types: ['Creature']` on an `attachedToSource` filter ('equipped creature', 'enchanted creature') = no `types`: an Equipment or a creature Aura " +
    'attached to anything else becomes unattached as a state-based action (CR 301.5c, 303.4d, 704.5m-n)',
  "W3 integration (WP22 golden deviation): `stackKind: 'spell'` on a filter with `zone: 'stack'` = no `stackKind` (the Filter hole adds it to every " +
    "\"... spells\"; an object on the stack that a cost modifier's `spells` filter reads is a spell being cast, CR 112.1, 601.2f)",
  "W3b: a `search` step's filter with the step's own `zone` = that filter without `zone` (CR 701.23a: a search looks at the zone the step names; " +
    "effects/handlers/cards-library.ts matches every candidate with the step's zone whatever the filter says; Path to Exile's design 13 JSON writes it twice)",
  'partial abilities only: a step followed by a manual step may lack the `else` branch the golden step has (the manual sentence is that branch, ' +
    "\"if [they] don't, ...\"; design 6.3 `$patchPrevious`); every field the parsed step does have must still be equal",
  'partial abilities only: a golden ManualAbilityDef of shape S with cost C (and restrictions) = an ability of kind S with that cost (and those ' +
    'restrictions) whose every effect step is manual and that announces no target (design 10.2: a manual ability keeps its understood cost; CR 602.2)',
  'partial abilities only, when no automated node of the parsed ability reads a binding name: a step may lack the `as` the golden step has (the ' +
    'golden reader of that name is in the masked sentences; the name only lets a later instruction refer to the step\'s result, CR 608.2c, so the ' +
    'step does the same with or without it: Jace, the Mind Sculptor\'s +2 look at the top card, CR 701.20a, 701.20e, read since LOOK1)',
];

const tokenNameIsDefault = (token: Rec): boolean => {
  const subtypes = Array.isArray(token['subtypes']) ? (token['subtypes'] as unknown[]).join(' ') : '';
  return typeof token['name'] === 'string' && subtypes !== '' && (token['name'] === subtypes || token['name'] === `${subtypes} Token`);
};

/** Apply `EQUIVALENCES` (keys are visited sorted, so "document order" does not depend on how a file orders its keys). */
function equivalences(v: unknown): unknown {
  const names = new Map<string, string>();
  const rename = (n: unknown): unknown => {
    if (typeof n !== 'string') return n;
    if (!names.has(n)) names.set(n, `b${names.size}`);
    return names.get(n)!;
  };
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk);
    if (!isRec(x)) return x;
    const out: Rec = {};
    for (const k of Object.keys(x).sort()) {
      const y = x[k];
      if (y === undefined) continue;
      if (k === 'players' && x['kind'] === 'player' && JSON.stringify(y) === '{"who":"any"}') continue;
      if (k === 'filter' && x['kind'] === 'object' && 'min' in x && JSON.stringify(y) === '{}') continue;
      if (k === 'token' && x['op'] === 'createToken' && isRec(y) && tokenNameIsDefault(y)) {
        const rest: Rec = { ...y };
        delete rest['name'];
        out[k] = walk(rest);
        continue;
      }
      if (k === 'types' && x['attachedToSource'] === true && JSON.stringify(y) === '["Creature"]') continue;
      if (k === 'stackKind' && y === 'spell' && x['zone'] === 'stack') continue;
      if (k === 'filter' && x['op'] === 'search' && isRec(y) && typeof x['zone'] === 'string' && y['zone'] === x['zone']) {
        const rest: Rec = { ...y };
        delete rest['zone'];
        out[k] = walk(rest);
        continue;
      }
      const isName =
        k === 'as' ||
        (k === 'exiled' && x['op'] === 'exileUntil') ||
        (k === 'name' && (x['ref'] === 'bound' || x['q'] === 'var' || x['op'] === 'let')) ||
        (k === 'step' && (x['cond'] === 'did' || x['q'] === 'resultCount'));
      if (isName) out[k] = rename(y);
      else if (k === 'capture' && x['op'] === 'delay' && Array.isArray(y)) out[k] = y.map(rename);
      else out[k] = walk(y);
    }
    return out;
  };
  return walk(v);
}

function drop(v: unknown, keys: ReadonlySet<string>): unknown {
  if (Array.isArray(v)) return v.map((x) => drop(x, keys));
  if (!isRec(v)) return v;
  const out: Rec = {};
  for (const k of Object.keys(v).sort()) if (!keys.has(k) && v[k] !== undefined) out[k] = drop(v[k], keys);
  return out;
}

function canonical(def: unknown): AbilityDef {
  try {
    return canonicalize(def as AbilityDef);
  } catch {
    return def as AbilityDef; // compared as written
  }
}

/** What an ability does, as comparable data. The structure is kept, so a manual-node pointer of the canonical form still resolves in it. */
function comparable(c: AbilityDef): unknown {
  let s: unknown = c;
  try {
    s = stripAbility(c);
  } catch {
    /* compared unstripped */
  }
  return drop(equivalences(s), BOOKKEEPING);
}

/** What an ability does, as comparable JSON: canonical, no display text, no provenance, no source lines, up to `EQUIVALENCES`. */
export function behavior(def: unknown): string {
  return JSON.stringify(comparable(canonical(def)));
}

export const MASK = '<manual>';

/** Replace the node at each JSON pointer by the mask (pointers that do not resolve are ignored). Mutates and returns `root`. */
function maskAt(root: unknown, pointers: readonly string[]): unknown {
  for (const p of pointers) {
    if (p === '' || p === '/') return MASK;
    const parts = p.split('/').slice(1).map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
    let node: unknown = root;
    for (let i = 0; i < parts.length - 1 && node !== null && typeof node === 'object'; i++) node = (node as Rec)[parts[i]!];
    const last = parts[parts.length - 1]!;
    if (node !== null && typeof node === 'object' && last in (node as Rec)) (node as Rec)[last] = MASK;
  }
  return root;
}

/**
 * The behavior of an ability with its manual nodes masked. The pointers are taken from the CANONICAL form (canonicalize sorts the operands of
 * `all`/`any` and commutative `math`), the same form that is masked, so a mask never lands on an automated node.
 */
export function maskedBehavior(def: unknown): unknown {
  const c = canonical(def);
  const pointers = [...new Set(manualNodes(c).map((s) => s.path))].sort();
  return maskAt(comparable(c), pointers);
}

/** EQUIVALENCES (`as` without an automated reader): set by partialAgreesWith while it compares a masked ability that reads no binding name. */
let asMayBeMissing = false;

/**
 * Does `golden` agree with the automated part of `masked`? A mask matches any subtree, and in an array any run of one or more elements; a `targets`
 * array of the golden ability may hold specs the masked one does not have (the targets of the masked sentences); everything else must be equal.
 */
export function agreesOutsideMasks(masked: unknown, golden: unknown, key = '', riderFollows = false, unordered = false): boolean {
  if (masked === MASK) return true;
  if (Array.isArray(masked)) {
    if (!Array.isArray(golden)) return false;
    if (key === 'targets') return masked.every((m) => golden.some((g) => agreesOutsideMasks(m, g)));
    if (unordered) return agreesAsSet(masked, golden);
    const seq = (i: number, j: number): boolean => {
      if (i === masked.length) return j === golden.length;
      if (masked[i] === MASK) {
        // the manual step may be wholly the `else` branch the previous golden step carries (EQUIVALENCES): then it stands for no step of its own
        const prevM = masked[i - 1];
        const prevG = golden[j - 1];
        const absorbed = i > 0 && isRec(prevM) && prevM['else'] === undefined && isRec(prevG) && prevG['else'] !== undefined;
        for (let k = absorbed ? j : j + 1; k <= golden.length; k++) if (seq(i + 1, k)) return true;
        return false;
      }
      return j < golden.length && agreesOutsideMasks(masked[i], golden[j], '', masked[i + 1] === MASK) && seq(i + 1, j + 1);
    };
    return seq(0, 0);
  }
  if (isRec(masked)) {
    if (!isRec(golden)) return false;
    for (const k of new Set([...Object.keys(masked), ...Object.keys(golden)])) {
      if (riderFollows && k === 'else' && masked[k] === undefined) continue; // EQUIVALENCES: the manual step that follows is this branch
      if (asMayBeMissing && k === 'as' && masked[k] === undefined && typeof golden[k] === 'string') continue; // EQUIVALENCES: no automated reader of the name
      if (!agreesOutsideMasks(masked[k], golden[k], k, false, isSetValued(masked, k))) return false;
    }
    return true;
  }
  return masked === golden;
}

/** Lists canonicalize SORTS (all/any operands, commutative math arguments, anyOf): a filled mask may land anywhere in them. */
function isSetValued(parent: Rec, key: string): boolean {
  if (key === 'of') return parent['cond'] === 'all' || parent['cond'] === 'any';
  if (key === 'args') return parent['q'] === 'math' && ['+', '*', 'min', 'max'].includes(String(parent['op']));
  return key === 'anyOf';
}

/** Multiset matching: each automated element matches a distinct golden element; each mask stands for at least one more. */
function agreesAsSet(masked: readonly unknown[], golden: readonly unknown[]): boolean {
  const marks = masked.filter((x) => x === MASK).length;
  const fixed = masked.filter((x) => x !== MASK);
  const used = new Array<boolean>(golden.length).fill(false);
  const assign = (i: number): boolean => {
    if (i === fixed.length) {
      const rest = used.filter((u) => !u).length;
      return marks === 0 ? rest === 0 : rest >= marks;
    }
    for (let j = 0; j < golden.length; j++) {
      if (used[j] || !agreesOutsideMasks(fixed[i], golden[j])) continue;
      used[j] = true;
      if (assign(i + 1)) return true;
      used[j] = false;
    }
    return false;
  };
  return assign(0);
}

const SHAPE_OF: Readonly<Record<string, string>> = {
  spell: 'spell', activated: 'activated', triggered: 'triggered', chapter: 'triggered', static: 'static', keyword: 'static', classLevel: 'static', levelBracket: 'static',
};
const RESTRICTIONS = ['cost', 'sorcerySpeed', 'limit', 'zone'] as const;

/** EQUIVALENCES, last entry: a masked partial ability that automates only its cost and restrictions against a golden ManualAbilityDef. */
function agreesWithManualGolden(masked: unknown, golden: Rec): boolean {
  if (!isRec(masked)) return false;
  const effect = masked['effect'];
  if (effect !== undefined) {
    if (!isRec(effect) || effect['modes'] !== undefined) return false;
    const steps = Array.isArray(effect['steps']) ? effect['steps'] : [];
    const targets = Array.isArray(effect['targets']) ? effect['targets'] : [];
    if (targets.length > 0 || !steps.every((s) => s === MASK)) return false;
  }
  const shape = typeof golden['shape'] === 'string' ? golden['shape'] : 'unknown';
  if (shape !== 'unknown' && SHAPE_OF[String(masked['kind'])] !== shape) return false;
  if ((masked['isMana'] === true) !== (golden['mana'] === true)) return false;
  // an ability's own zone defaults to the battlefield (CR 113.6); canonicalize drops the default for activated abilities only
  const zone = (v: unknown): unknown => (v === undefined ? ['battlefield'] : v);
  return RESTRICTIONS.every((k) => (k === 'zone' ? agreesOutsideMasks(zone(masked[k]), zone(golden[k]), k) : agreesOutsideMasks(masked[k], golden[k], k)));
}

/** Does any node read a binding name (the reads `equivalences` renames: a bound object, a `did` or `resultCount` step, a variable, a delay's capture)? */
function readsBindingName(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(readsBindingName);
  if (!isRec(v)) return false;
  if ((v['ref'] === 'bound' && v['name'] !== undefined) || (v['q'] === 'var' && v['name'] !== undefined)) return true;
  if ((v['cond'] === 'did' || v['q'] === 'resultCount') && v['step'] !== undefined) return true;
  if (v['op'] === 'delay' && v['capture'] !== undefined) return true;
  return Object.values(v).some(readsBindingName);
}

/** Does a masked partial ability (`maskedBehavior`) agree with a golden ability on every automated node? */
export function partialAgreesWith(masked: unknown, goldenAbility: unknown): boolean {
  const g = comparable(canonical(goldenAbility));
  if (isRec(g) && g['kind'] === 'manual') return agreesWithManualGolden(masked, g);
  asMayBeMissing = !readsBindingName(masked);
  try {
    return agreesOutsideMasks(masked, g);
  } finally {
    asMayBeMissing = false;
  }
}

/** Fully understood by the parser: not a manual ability and no manual node anywhere (design 10.1). */
export const understood = (def: AbilityDef): boolean => def.kind !== 'manual' && manualNodes(def).length === 0;
/** Partial: understood around one or more manual nodes; its automated nodes run in play. */
export const partial = (def: AbilityDef): boolean => def.kind !== 'manual' && manualNodes(def).length > 0;

export interface GoldenMismatch { face: number; index: number; actual: string; reason: string }

export interface GoldenResult {
  card: string;
  /** Fully understood abilities equal to a golden ability. */
  matched: number;
  /** Partial abilities whose automated nodes agree with a golden ability (their golden ability stays pending). */
  partialAgree: number;
  /** Golden abilities the parser does not (yet) fully understand. */
  pending: number;
  /** Fully understood abilities equal to NO golden ability of their face; partial abilities whose automated nodes agree with none. */
  mismatches: GoldenMismatch[];
  /** Card-wide lint errors of the parsed faces (an unlinked consumer, CR 607.1): never acceptable. */
  cardLint: string[];
  /** Set when `expect: "full"` does not hold. */
  ratchet?: string;
}

/** The card-wide lint errors of parsed faces (design 6.1 step 8; an unlinked consumer, CR 607.1, reads nothing in play). */
export function cardLintErrors(faces: readonly { abilities: AbilityDef[] }[]): string[] {
  return validateCardAbilities([...faces]).filter((i) => i.severity === 'error').map((i) => `${i.path}: ${i.code}: ${i.message}`);
}

export function checkGolden(entry: GoldenEntry, card: OracleCard, opts: ParseOptions): GoldenResult {
  const parsed = parseCard(card, opts);
  const res: GoldenResult = { card: entry.card, matched: 0, partialAgree: 0, pending: 0, mismatches: [], cardLint: [] };
  res.cardLint = cardLintErrors(parsed.faces);
  if (parsed.faces.length !== entry.faces.length) {
    parsed.faces.forEach((f, fi) => f.abilities.forEach((a, ai) => {
      if (understood(a) || partial(a)) res.mismatches.push({ face: fi, index: ai, actual: behavior(a), reason: `the golden entry has ${entry.faces.length} face(s), the parse ${parsed.faces.length}` });
    }));
    res.pending = entry.faces.reduce((n, f) => n + f.abilities.length, 0);
    if (entry.expect === 'full') res.ratchet = 'face count differs';
    return res;
  }
  parsed.faces.forEach((f, fi) => {
    const goldenDefs = entry.faces[fi]!.abilities;
    const golden = goldenDefs.map(behavior);
    const unused = [...golden];
    f.abilities.forEach((a, ai) => {
      if (!understood(a)) return;
      const b = behavior(a);
      const k = unused.indexOf(b);
      if (k >= 0) {
        unused.splice(k, 1);
        res.matched++;
      } else res.mismatches.push({ face: fi, index: ai, actual: b, reason: golden.includes(b) ? 'matches a golden ability already matched' : 'equals no golden ability of this face' });
    });
    f.abilities.forEach((a, ai) => {
      if (!partial(a)) return;
      const masked = maskedBehavior(a);
      if (goldenDefs.some((g) => partialAgreesWith(masked, g))) res.partialAgree++;
      else res.mismatches.push({ face: fi, index: ai, actual: JSON.stringify(masked), reason: 'the automated nodes of this partial ability agree with no golden ability of this face' });
    });
    res.pending += unused.length;
  });
  if (entry.expect === 'full' && (res.pending > 0 || res.mismatches.length > 0)) res.ratchet = `expected every ability fully understood; ${res.pending} pending, ${res.mismatches.length} mismatched`;
  return res;
}
