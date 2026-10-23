/**
 * Shared fixtures of the WP25 harness tests: the merged template set, a coverage engine over it, and the fixture cards run once (design 15.2 WP25:
 * "the harness tests itself on the fixture set"). Synthetic cards here use invented names and wordings (design 6.10).
 */
import { BOOTSTRAP_TEMPLATES, type OracleCard, type Template } from '@openmtg/engine';
import { fixtureCards } from '../../src/coverage/corpus';
import { createCoverageEngine, type CardRun, type CoverageEngine } from '../../src/coverage/engine';
import { loadTemplates, type TemplateSet } from '../../src/coverage/templates';

let set: TemplateSet | undefined;
let engine: CoverageEngine | undefined;
let runs: CardRun[] | undefined;
let game: CoverageEngine | undefined;
let gameRuns: CardRun[] | undefined;

export const templateSet = (): TemplateSet => (set ??= loadTemplates());
export const fullEngine = (): CoverageEngine => (engine ??= createCoverageEngine({ templates: templateSet().templates }));
export const bootstrapEngine = (): CoverageEngine => createCoverageEngine({ templates: BOOTSTRAP_TEMPLATES });
export const fixtureRuns = (): CardRun[] => (runs ??= fixtureCards().map((c) => fullEngine().run(c)));
/** W3b: the GAME path (`compileCard(card)`, the default compiler), what the coverage commands measure without `--templates`. */
export const gameEngine = (): CoverageEngine => (game ??= createCoverageEngine());
export const gameFixtureRuns = (): CardRun[] => (gameRuns ??= fixtureCards().map((c) => gameEngine().run(c)));

export function synthetic(name: string, typeLine: string, text: string, extra: Partial<OracleCard> = {}): OracleCard {
  const c = { name, layout: 'normal', type_line: typeLine, oracle_text: text, mana_cost: '{1}', colors: [], keywords: [], oracle_id: `synthetic-${name}`, ...extra } as OracleCard;
  if (/\bCreature\b/.test(typeLine) && c.power === undefined) Object.assign(c, { power: '2', toughness: '2' });
  return c;
}

/** A test-only template (never committed as data). */
export function tpl(id: string, kind: Template['kind'], pattern: string, build: unknown, extra: Partial<Template> = {}): Template {
  return { id, kind, cr: ['CR 608.2c'], pattern, build, examples: [{ text: 'x' }], counterExamples: ['a', 'b'], status: 'stable', since: 1, ...extra };
}
