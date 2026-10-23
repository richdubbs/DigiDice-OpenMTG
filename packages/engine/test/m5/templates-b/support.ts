/**
 * Helpers of the WP20 tests (template package B: parser/templates/effect/{damage,life,cards,mana}.json).
 *
 * The template files are loaded as data, exactly as a rules pack or WP18's pipeline would load them. Some examples and golden cards need sentences that
 * belong to OTHER template packages (a "choose a creature type" enters replacement, WP22; a self cost modifier, WP22; "tap target permanent", WP21).
 * Those neighbors are faked here as test-only templates (design 15.1.3: work packages fake their neighbors), written with the same JSON as
 * design section 13, and never committed as template data.
 */
import damage from '../../../src/parser/templates/effect/damage.json';
import life from '../../../src/parser/templates/effect/life.json';
import cards from '../../../src/parser/templates/effect/cards.json';
import mana from '../../../src/parser/templates/effect/mana.json';
import type { AbilityDef } from '../../../src/types/ability';
import type { OracleCard } from '../../../src/types/card';
import type { FaceParse, ParseOptions, Template, TemplateKind } from '../../../src/parser/types';
import { BOOTSTRAP_TEMPLATES, defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { canonicalJson } from '../../../src/parser/holes';

export { localIndex } from '../parser/support';

/** The four files of WP20, by file name. */
export const FILES: Readonly<Record<'damage' | 'life' | 'cards' | 'mana', readonly Template[]>> = {
  damage: damage as Template[], life: life as Template[], cards: cards as Template[], mana: mana as Template[],
};
export const WP20: readonly Template[] = Object.values(FILES).flat();

let seq = 0;
function fake(kind: TemplateKind, pattern: string, build: unknown, id = `fake.${kind}.${++seq}`, consumes?: string[]): Template {
  return { id, kind, cr: ['CR 608.2c'], pattern, build, examples: [{ text: 'x' }], counterExamples: ['a', 'b'], status: 'stable', since: 1, ...(consumes ? { consumes } : {}) };
}

/** Neighbor templates (WP21, WP22), test-only, with the JSON of design section 13. */
export const NEIGHBORS: readonly Template[] = [
  // WP22: "As this land enters, choose a creature type." (Cavern of Souls), the producer of link "type" (CR 614.12, 607.2d)
  fake('static', 'as ~ enter[s] , choose a creature type', {
    s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, body: { b: 'enters', choose: [{ what: 'creatureType', link: 'type' }] },
  }, 'fake.wp22.choosetype'),
  // WP22: Fireball's self cost modifier (CR 601.2f); it functions on the stack (CR 113.6d, 604.5), as the stable cm.self.* templates state (W3b audit:
  // a zoneless static of a spell face is manual, CR 110.4)
  fake('static', '~ costs {1} more to cast for each target beyond the first', {
    kind: 'static', zone: ['stack'], effects: [{
      s: 'costMod', applies: { self: true, caster: 'you' },
      change: { kind: 'increase', generic: { q: 'math', op: 'max', args: [0, { q: 'math', op: '-', args: [{ q: 'spellTargetCount' }, 1] }] } },
    }],
  }, 'fake.wp22.costmod', ['each']),
  // WP21: "Tap target permanent." (Ice)
  fake('effect', 'tap {o:Objs}', { op: 'tap', what: '$o' }, 'fake.wp21.tap'),
];

/** Bootstrap + WP20 (+ extra). */
export function options(extra: readonly Template[] = [], over: Partial<ParseOptions> = {}): ParseOptions {
  return defaultParseOptions({ templates: [...BOOTSTRAP_TEMPLATES, ...WP20, ...extra], ...over });
}

/** A synthetic card for a template example: a creature for an enters trigger, an artifact creature for an activated ability, a land for "As ~ enters", an instant otherwise. */
export function exampleCard(text: string): OracleCard {
  const x = /\bX\b/.test(text) ? { mana_cost: '{X}{R}' } : {};
  if (/^As ~ enters/.test(text)) return { name: 'Example Grotto', layout: 'normal', type_line: 'Land', oracle_text: text } as OracleCard;
  if (/^When ~ enters/.test(text)) return { name: 'Example Warden', layout: 'normal', type_line: 'Creature — Human Soldier', oracle_text: text } as OracleCard;
  if (text.includes(':')) return { name: 'Example Totem', layout: 'normal', type_line: 'Artifact Creature — Golem', oracle_text: text, ...x } as OracleCard;
  return { name: 'Example Bolt', layout: 'normal', type_line: 'Instant', oracle_text: text, ...x } as OracleCard;
}

/** The first face of a parse of an example sentence. */
export function parseExample(text: string, opts: ParseOptions = options(NEIGHBORS)): FaceParse {
  return parseCard(exampleCard(text), opts).faces[0]!;
}

/** Abilities without `src`/`prov` (bookkeeping that design section 13 does not show). */
export function bare(defs: readonly AbilityDef[]): unknown[] {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v === null || typeof v !== 'object') return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (k !== 'src' && k !== 'prov') out[k] = strip(x);
    return out;
  };
  return defs.map(strip);
}

/** No manual node anywhere (a manual ability, a manual step, a manual ability nested in a level bracket). */
export const automated = (defs: readonly unknown[]): boolean => {
  const s = JSON.stringify(defs);
  return defs.length > 0 && !s.includes('"kind":"manual"') && !s.includes('"op":"manual"');
};

/** Canonical JSON of the abilities without display text (`text`), for "same meaning" comparisons. */
export const meaning = (defs: readonly AbilityDef[]): string => canonicalJson(bare(defs).map((a) => ({ ...(a as object), text: '' })));

/**
 * Binding names renamed in order of first appearance (`as`, `{ref:'bound', name}`, piles `chosen`/`other`): two programs that differ only in the names the
 * anaphora pass chose are the same program (CR 608.2c reads the references, not their spelling).
 */
export function alphaRename(v: unknown): unknown {
  const names = new Map<string, string>();
  const nm = (n: string): string => { if (!names.has(n)) names.set(n, `n${names.size}`); return names.get(n)!; };
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk);
    if (x === null || typeof x !== 'object') return x;
    const o = x as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, y] of Object.entries(o)) {
      if (typeof y === 'string' && (k === 'as' || (k === 'name' && o['ref'] === 'bound') || ((k === 'chosen' || k === 'other') && o['op'] === 'piles'))) out[k] = nm(y);
      else out[k] = walk(y);
    }
    return out;
  };
  return walk(v);
}
