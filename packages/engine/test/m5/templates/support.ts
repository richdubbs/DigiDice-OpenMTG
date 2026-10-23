/**
 * Helpers for the WP21 tests (templates C: zones, tokens, counters, attach; design 15.2 WP21): the template data of parser/templates/effect/{move,destroy,
 * tokens,counters,attach}.json, parse options with the bootstrap templates of WP17, and test-only templates that stand in for the neighbors (WP19 trigger
 * clauses, WP20 "gains life equal to", WP23 "may" and the search sequence) until those packages merge (design 15.1 rule 7). Neighbor templates are written
 * with the `test.` id prefix and are never committed as data.
 */
import type { AbilityDef } from '../../../src/types/ability';
import type { OracleCard } from '../../../src/types/card';
import type { FaceParse, ParseOptions, Template, TemplateKind } from '../../../src/parser/types';
import { BOOTSTRAP_TEMPLATES, defaultParseOptions, parseCard } from '../../../src/parser/parse';
import move from '../../../src/parser/templates/effect/move.json';
import destroy from '../../../src/parser/templates/effect/destroy.json';
import tokens from '../../../src/parser/templates/effect/tokens.json';
import counters from '../../../src/parser/templates/effect/counters.json';
import attach from '../../../src/parser/templates/effect/attach.json';
import wp19Keywords from '../../../src/parser/templates/keyword.json';

export { localIndex } from '../parser/support';

/** The WP21 template files, by file name (the package owns exactly these five, design 15.2). */
export const WP21_FILES: Readonly<Record<string, readonly Template[]>> = {
  move: move as Template[],
  destroy: destroy as Template[],
  tokens: tokens as Template[],
  counters: counters as Template[],
  attach: attach as Template[],
};

/** Every WP21 template. */
export const WP21_TEMPLATES: readonly Template[] = Object.freeze(Object.values(WP21_FILES).flat());

let seq = 0;
/** A test-only template standing in for a neighbor package's template. */
export function fake(kind: TemplateKind, pattern: string, build: unknown, extra: Partial<Template> = {}): Template {
  return { id: extra.id ?? `test.${kind}.${++seq}`, kind, cr: ['CR 608.2c'], pattern, build, examples: [{ text: 'x' }], counterExamples: ['a', 'b'], status: 'stable', since: 1, ...extra };
}

/**
 * Neighbor templates (design 15.1 rule 7: fake the neighbors). WP19 owns trigger clauses, WP20 life, WP23 `may` and search sequences. The search sequence of
 * Path to Exile is one fake on purpose: who puts the land onto the battlefield is the searching player (CR 110.2), and only a sequence template of WP23 can
 * say so (an imperative "put ... onto the battlefield" of this package means the controller of the effect, see safety.test.ts).
 */
export const NEIGHBORS: readonly Template[] = Object.freeze([
  // W3 integration: WP19 is merged and owns the keyword templates; its kw.equip ("Equip {N}") replaced this package's identical kw.equip.mana.
  ...(wp19Keywords as Template[]).filter((t) => t.id === 'kw.equip'),
  fake('trigger', '( when | whenever ) {e:Event}', { on: '$e' }, { id: 'test.trigger', consumes: ['when', 'whenever'] }),
  fake('effect', '{p:Player} gain[s] life equal to {n:Qty}', { op: 'gainLife', who: '$p', amount: '$n' }, { id: 'test.gainlife.equal' }),
  fake('effect', '{p:Player} may {e:Effects}', { op: 'may', who: '$p', do: '$e' }, { id: 'test.may', consumes: ['may'] }),
  fake('effect', '{p:Player} may search their library for a basic land card , put that card onto the battlefield tapped , then shuffle', {
    op: 'may', who: '$p',
    do: [
      { op: 'search', who: '$p', zone: 'library', filter: { zone: 'library', types: ['Land'], supertypes: ['Basic'] }, max: 1, as: 'land' },
      { op: 'move', what: { ref: 'bound', name: 'land' }, to: { zone: 'battlefield', controller: '$p', tapped: true } },
      { op: 'shuffle', who: '$p' },
    ],
  }, { id: 'test.search.basicland', consumes: ['may'] }),
]);

/** Parse options: the bootstrap templates, the WP21 templates and `extra`. */
export function options(extra: readonly Template[] = [], over: Partial<ParseOptions> = {}): ParseOptions {
  return defaultParseOptions({ templates: [...BOOTSTRAP_TEMPLATES, ...WP21_TEMPLATES, ...extra], ...over });
}

/** A synthetic single-faced card (invented names and wordings, design 6.10). */
export function card(name: string, typeLine: string, text: string, extra: Partial<OracleCard> = {}): OracleCard {
  return { name, layout: 'normal', type_line: typeLine, oracle_text: text, ...extra } as OracleCard;
}

/** A synthetic card in which a template example is an ability of the right kind. */
export function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'trigger') return card('Example Wisp', 'Creature — Spirit', text);
  if (t.kind === 'ability') return card('Example Blade', 'Artifact — Equipment', text);
  if (t.kind === 'static') return card('Example Charm', /enchanted/i.test(text) ? 'Enchantment — Aura' : 'Artifact — Equipment', text);
  if (text.includes(':')) return card('Example Totem', 'Artifact Creature — Golem', text);
  return card('Example Bolt', 'Instant', text);
}

/** The first face of a parse. */
export function face(c: OracleCard, opts: ParseOptions = options()): FaceParse {
  return parseCard(c, opts).faces[0]!;
}

type Rec = Record<string, unknown>;

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

/** Every ability is automated: no manual ability, no manual step anywhere. */
export const automated = (defs: readonly AbilityDef[]): boolean => defs.length > 0 && defs.every((a) => a.kind !== 'manual') && !JSON.stringify(defs).includes('"op":"manual"');

/** A fully automated parse: automated abilities and every render gate passed. */
export const fullyAutomated = (f: FaceParse): boolean => automated(f.abilities) && f.gate.every((g) => g.ok);

/** Canonical comparison key of a parse, without the display text. */
export function jsonKey(defs: readonly AbilityDef[]): string {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v === null || typeof v !== 'object') return v;
    const out: Rec = {};
    for (const k of Object.keys(v as Rec).sort()) if (k !== 'src' && k !== 'prov' && k !== 'text') out[k] = strip((v as Rec)[k]);
    return out;
  };
  return JSON.stringify(defs.map(strip));
}
