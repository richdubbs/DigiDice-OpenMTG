/**
 * Helpers of the WP22 tests (templates D: statics, continuous effects, restrictions, cost modifications, replacement shapes, ability-level wrappers;
 * design 15.2 WP22).
 *
 * The six template files of WP22 are read as data, exactly as a rules pack or the compile pipeline (WP18) loads them, and parsed together with the
 * bootstrap templates of WP17. Template examples and the test wordings here are synthetic (invented numbers and names, design 6.10). Templates of the
 * other template packages (WP19-WP21, WP23) that the golden cards need are written here in test form ("stand-ins"), as WP17's tests do, and are never
 * committed as data.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AbilityDef } from '../../../src/types/ability';
import type { OracleCard } from '../../../src/types/card';
import type { FaceParse, ParseOptions, Template, TemplateKind } from '../../../src/parser/types';
import { BOOTSTRAP_TEMPLATES, defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { canonicalJson } from '../../../src/parser/holes';
import staticT from '../../../src/parser/templates/static.json';
import abilityT from '../../../src/parser/templates/ability.json';
import continuous from '../../../src/parser/templates/effect/continuous.json';
import restrict from '../../../src/parser/templates/effect/restrict.json';
import costmod from '../../../src/parser/templates/effect/costmod.json';
import replace from '../../../src/parser/templates/effect/replace.json';

export { localIndex } from '../parser/support';

/** The six files of WP22, by path under parser/templates (design 15.2 WP22). */
export const WP22_FILES: Readonly<Record<string, readonly Template[]>> = {
  'static.json': staticT as Template[],
  'ability.json': abilityT as Template[],
  'effect/continuous.json': continuous as Template[],
  'effect/restrict.json': restrict as Template[],
  'effect/costmod.json': costmod as Template[],
  'effect/replace.json': replace as Template[],
};

export const WP22_TEMPLATES: readonly Template[] = Object.values(WP22_FILES).flat();

/** Bootstrap (WP17) plus WP22: the template set this package is tested in. */
export const ALL: readonly Template[] = [...BOOTSTRAP_TEMPLATES, ...WP22_TEMPLATES];

let seq = 0;
/** A test-only template ("stand-in" for a template of another package). */
export function tpl(kind: TemplateKind, pattern: string, build: unknown, extra: Partial<Template> = {}): Template {
  return { id: extra.id ?? `test.wp22.${kind}.${++seq}`, kind, cr: ['CR 608.2c'], pattern, build, examples: [{ text: 'x' }], counterExamples: ['a', 'b'], status: 'stable', since: 1, ...extra };
}

/** Stand-ins for templates of WP19-WP21 and WP23 that the golden cards of WP22 need (Oko, Mutavault, History of Benalia). */
export const STANDINS: readonly Template[] = [
  // WP21 (tokens): "Create a Food token." / "Create a 2/2 white Knight creature token with vigilance."
  tpl('effect', 'create {n:Qty} {t:TokenDesc}', { op: 'createToken', who: { ref: 'you' }, count: '$n', token: '$t' }, { id: 'test.wp22.create' }),
  // WP23 (control flow): the exchange of Oko's -5 (CR 701.12)
  tpl('effect', 'exchange control of {a:Obj} and {b:Obj}', { op: 'exchange', a: '$a', b: '$b', what: 'control' }, { id: 'test.wp22.exchange' }),
  // WP20 (mana): "{T}: Add {C}."
  tpl('effect', 'add {C}', { op: 'addMana', who: { ref: 'you' }, units: [['C']] }, { id: 'test.wp22.manaC' }),
  // WP23 (riders): "It's still a land." turns the layer-4 `set` of a `becomes` (always mods[0] of effects[0], see effect/continuous.json) into `add` (CR 205.1b)
  tpl('rider', "it's still a land", { $patchPrevious: { effects: [{ mods: [{ types: { set: null, add: ['Creature'] } }] }] } }, { id: 'test.wp22.rid.still', attachTo: 'effect', consumes: ['still'] }),
];

/** Parse options with the bootstrap and WP22 templates, plus `extra`. */
export function options(extra: readonly Template[] = [], over: Partial<ParseOptions> = {}): ParseOptions {
  return defaultParseOptions({ templates: [...ALL, ...extra], ...over });
}

/** A synthetic single-faced card (invented names; design 6.10). */
export function card(name: string, typeLine: string, text: string, extra: Partial<OracleCard> = {}): OracleCard {
  return { name, layout: 'normal', type_line: typeLine, oracle_text: text, ...extra } as OracleCard;
}

/** A synthetic card in which a template example is an ability of the right kind. */
export function exampleCard(t: Template, text: string): OracleCard {
  // a self reference written "this <type>" (design 6.2 step 3): a card of that type (WP22 review: the second example of a fixed wording)
  const self = /^(?:as |if )?this (creature|artifact|land|spell)\b/i.exec(text)?.[1]?.toLowerCase();
  if (self === 'creature') return card('Example Golem', 'Artifact Creature — Golem', text);
  if (self === 'artifact') return card('Example Relic', 'Artifact', text);
  if (self === 'land') return card('Example Vale', 'Land', text);
  if (self === 'spell') return card('Example Bolt', 'Instant', text);
  if (t.kind === 'static') {
    if (/^~ enters|^as ~ enters|^if ~ was kicked|you may have ~ enter/i.test(text)) return card('Example Golem', 'Artifact Creature — Golem', text, /(^| )X /.test(text) ? { mana_cost: '{X}{1}' } : {});
    if (/^~ (costs|can't be countered)/i.test(text)) return card('Example Bolt', 'Instant', text);
    if (/opening hand/i.test(text)) return card('Example Banner', 'Enchantment', text);
    const enchanted = /^enchanted (\w+)/i.exec(text)?.[1]?.toLowerCase();
    if (enchanted !== undefined) return card('Example Charm', 'Enchantment — Aura', `Enchant ${enchanted}\n${text}`);
    if (/^equipped /i.test(text)) return card('Example Blade', 'Artifact — Equipment', text);
    if (/^~/.test(text)) return card('Example Golem', 'Artifact Creature — Golem', text);
    return card('Example Banner', 'Enchantment', text);
  }
  if (t.kind === 'trigger' || t.kind === 'ability') return card('Example Wisp', 'Creature — Spirit', text);
  if (/^~ /.test(text) || text.includes(':')) return card('Example Totem', 'Artifact Creature — Golem', text.includes(':') ? text : `{2}: ${text}`);
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

type Rec = Record<string, unknown>;

/**
 * Abilities without bookkeeping that does not depend on the text's meaning (`src`, `prov`), for comparison with the JSON of design section 13. Display
 * text of a keyword granted inside another ability keeps the case it is printed with ("has trample"); section 13 capitalizes it ("Trample"), so with
 * `keywordCase` the first letter of a nested keyword's text is capitalized (display data only, design 2.1 principle 8).
 */
export function bare(defs: readonly AbilityDef[], o: { keywordCase?: boolean } = {}): unknown[] {
  const strip = (v: unknown, nested: boolean): unknown => {
    if (Array.isArray(v)) return v.map((x) => strip(x, nested));
    if (v === null || typeof v !== 'object') return v;
    const out: Rec = {};
    const r = v as Rec;
    for (const [k, x] of Object.entries(r)) {
      if (k === 'src' || k === 'prov') continue;
      if (k === 'text' && nested && o.keywordCase && r['kind'] === 'keyword' && typeof x === 'string') { out[k] = x.charAt(0).toUpperCase() + x.slice(1); continue; }
      out[k] = strip(x, true);
    }
    return out;
  };
  return defs.map((d) => strip(d, false));
}

/** The JSON of a parse without display text anywhere (`text`), for comparing an example with a counter-example. */
export function meaning(defs: readonly AbilityDef[]): string {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v === null || typeof v !== 'object') return v;
    const out: Rec = {};
    for (const [k, x] of Object.entries(v as Rec)) if (k !== 'src' && k !== 'prov' && k !== 'text') out[k] = strip(x);
    return out;
  };
  return canonicalJson(defs.map(strip));
}

/**
 * The Oracle text of a card as design section 13 quotes it ("> " lines under "#### Name"), for golden cards that are not fixture cards (Oko, Mutavault).
 * The design document is the one place the repository quotes it (design 6.10); nothing is copied into a test.
 */
export function designOracle(name: string): string {
  const doc = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../docs/design/m5-ability-model.md'), 'utf8');
  const start = doc.indexOf(`#### ${name}\n`);
  if (start < 0) throw new Error(`design section 13 has no "#### ${name}"`);
  const part = doc.slice(start).split(/\n#### /)[0]!;
  const lines = part.split('\n').filter((l) => l.startsWith('> ')).map((l) => l.slice(2).trim());
  return lines.join('\n');
}

// ---- design 6.10 (WP22 review): examples are synthetic -------------------------------------------------------------------------------------------------

const SELF_NOUNS = 'creature|artifact|enchantment|land|permanent|planeswalker|battle|spell|card|token|aura|equipment|vehicle|saga|class';

/** One Oracle line or example as design 6.2 step 3 sees it: reminder text removed, the object's own name and "this <type>" as "~", case and spaces folded. */
export function normalizeLine(line: string, names: readonly string[] = []): string {
  let t = line.replace(/\([^()]*\)/g, ' ').replace(/[’]/g, "'");
  for (const n of [...names].filter((x) => x !== '').sort((a, b) => b.length - a.length)) t = t.split(n).join('~');
  return t.replace(new RegExp(`\bthis (?:${SELF_NOUNS})\b`, 'gi'), '~').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Every single Oracle line of these cards, normalized (each face's name, the card's name and a legendary's short name read as "~"). */
export function normalizedOracleLines(cards: readonly OracleCard[]): Set<string> {
  const out = new Set<string>();
  for (const c of cards) {
    const faces = (c.card_faces ?? [c]) as { name?: string; oracle_text?: string }[];
    for (const f of faces) {
      const names = [f.name ?? '', c.name, (f.name ?? '').split(', ')[0] ?? ''];
      for (const line of (f.oracle_text ?? '').split('\n')) out.add(normalizeLine(line, names));
    }
  }
  return out;
}

/**
 * A pattern with no hole, no optional part and no alternative: it has exactly one wording, which the committed pattern already spells out, so its
 * example is that wording (it may equal a card's line), and a second example could only repeat it unless it names the object itself ("~" or
 * "this <type>", design 6.2 step 3).
 */
export const fixedWording = (t: Template): boolean => !/[{[(]/.test(t.pattern);
export const fixedWithoutSelf = (t: Template): boolean => fixedWording(t) && !t.pattern.includes('~');
