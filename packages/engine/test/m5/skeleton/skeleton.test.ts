/**
 * The skeleton of milestone 5 (WP0): every module of design 5.1 exists and exports the contract of 5.3; every stub fails loudly with
 * `not implemented: WPn` naming the package that owns it; the capability tables of unfinished packages are empty, so no card can be classified as
 * automated by a stub (design 5.2).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EngineBug } from '../../../src/core/errors';
import { SRC_ROOT } from '../helpers';

/** Every file of design 5.1 that WP0 creates (JSON data stubs included). */
const FILES = [
  'types/ability.ts', 'types/automation.ts',
  'model/api.ts', 'model/index.ts', 'model/validate.ts', 'model/lint.ts', 'model/schema.generated.json', 'model/canonical.ts', 'model/strip.ts', 'model/hash.ts',
  'model/capabilities.ts', 'model/degrade.ts', 'model/classify.ts',
  'render/api.ts', 'render/render.ts', 'render/cost.ts', 'render/filter.ts', 'render/quantity.ts', 'render/condition.ts', 'render/duration.ts', 'render/event.ts',
  'render/step.ts', 'render/static.ts', 'render/keyword.ts', 'render/equivalence.ts', 'render/gate.ts',
  'keywords/types.ts', 'keywords/registry.ts', 'keywords/expand.ts', 'keywords/capabilities.ts', 'keywords/hooks/index.ts', 'keywords/special/index.ts', 'keywords/actions/index.ts',
  'parser/types.ts', 'parser/lexicon.generated.json', 'parser/preprocess.ts', 'parser/segment.ts', 'parser/tokenize.ts', 'parser/chart.ts', 'parser/holes/index.ts',
  'parser/lower/index.ts', 'parser/taint.ts', 'parser/parse.ts', 'parser/metrics.ts',
  'effects/api.ts', 'effects/ctx.ts', 'effects/refs.ts', 'effects/eval.ts', 'effects/run.ts', 'effects/manual.ts', 'effects/propose.ts', 'effects/perform.ts',
  'effects/predefined-tokens.json', 'effects/handlers/index.ts', 'effects/handlers/control.ts', 'effects/handlers/lifedamage.ts', 'effects/handlers/counters.ts',
  'effects/handlers/cards.ts', 'effects/handlers/zones.ts', 'effects/handlers/tokens.ts', 'effects/handlers/lasting.ts', 'effects/handlers/game.ts',
  'triggers/api.ts', 'triggers/normalize.ts', 'triggers/match.ts', 'triggers/lookback.ts', 'triggers/collect.ts', 'triggers/delayed.ts', 'triggers/state.ts', 'triggers/stack.ts',
  'statics/api.ts', 'statics/layers.ts', 'statics/live.ts', 'statics/mods.ts', 'statics/links.ts', 'statics/hooks.ts', 'statics/costmods.ts',
  'rules/hookpoints.ts', 'rules/base-chars.ts',
  'cards/pipeline.ts', 'cards/spans.ts', 'cards/pack.ts', 'cards/pool.ts',
];

/**
 * [module, export, work package]: calling the export with no arguments throws `not implemented: <WP>`.
 * WP2 (render/) is implemented: its functions and `RENDERERS` are tested in test/m5/render/ and no longer appear here.
 */
const STUB_FUNCTIONS: [string, string, string][] = [
  // WP1 (model/) is implemented: its rows were removed here, test/m5/model/ pins its exports and behavior.
  // WP17 (parser/parse, lower, taint, metrics) is implemented: parseCard never throws (contract C1); test/m5/lower/ pins it.
  // WP10 (effects/run, effects/manual, handlers/control) is implemented: its tests are in test/m5/run/.
  // WP11 (effects/propose, effects/perform) is implemented: its tests are in test/m5/propose/.
  // WP8 (triggers/) and WP9 (statics/layers, live, mods, links) are implemented: their tests are in test/m5/triggers/ and test/m5/statics/.
  // WP16 (statics/hooks, statics/costmods) is implemented: its tests are in test/m5/rulehooks/.
  // WP24 (cards/pool) is implemented: its tests are in test/m5/pool/.
  // WP18 (cards/pipeline, cards/spans) is implemented: compileCardV2 never throws (contract C1); test/m5/compile/ pins it.
];

/** Modules whose contract is only an owner (the 5.3 contracts say nothing about their exports yet). */
const MARKERS: [string, string][] = [
  ['parser/preprocess', 'WP5'], ['parser/segment', 'WP5'], ['parser/tokenize', 'WP5'], ['parser/chart', 'WP6'], ['parser/holes/index', 'WP6'], ['parser/lower/index', 'WP17'],
  ['parser/taint', 'WP17'], ['parser/metrics', 'WP17'], ['cards/pack', 'WP18'],
];

/** [module, export]: a capability table that is EMPTY until its package fills it. */
const EMPTY_TABLES: [string, string][] = [
  // Every handler table is filled (WP10, WP12-WP15: test/m5/run/, lifedamage/, cards/, zones/, tokens/, lasting/), and so are effects/eval#DUR_EVALUATORS (WP15),
  // WP11's REPLACEMENT_BODIES, STATIC_KINDS and FEATURES (test/m5/propose/) and WP16's RULE_HOOK_ACTIONS (test/m5/rulehooks/).
  ['effects/manual', 'FEATURES'],
];

const load = (mod: string): Promise<Record<string, unknown>> => import(/* @vite-ignore */ `../../../src/${mod}`) as Promise<Record<string, unknown>>;

describe('skeleton: every module of design 5.1 exists', () => {
  it.each(FILES)('%s', (file) => {
    expect(existsSync(join(SRC_ROOT, file)), file).toBe(true);
  });
});

describe('skeleton: stubs fail loudly and name their work package', () => {
  it.each(STUB_FUNCTIONS)('%s#%s throws "not implemented: %s"', async (mod, name, wp) => {
    const fn = (await load(mod))[name];
    expect(typeof fn, `${mod} must export ${name}`).toBe('function');
    expect(() => (fn as () => unknown)()).toThrow(`not implemented: ${wp}`);
  });

  it('the keyword registry is real since WP3 (the deep tests live in test/m5/keywords)', async () => {
    const { keywordRegistry } = (await load('keywords/registry')) as { keywordRegistry: import('../../../src/index').KeywordRegistry };
    expect(keywordRegistry.names().length).toBeGreaterThan(190);
    expect(keywordRegistry.get('flying')?.rule).toBe('702.9');
  });

  it.each(MARKERS)('%s exports its owner (%s) until the package defines the module', async (mod, wp) => {
    expect((await load(mod))['OWNER']).toBe(wp);
  });
});

describe('skeleton: capability tables of unfinished packages are empty', () => {
  it.each(EMPTY_TABLES)('%s#%s', async (mod, name) => {
    const table = (await load(mod))[name];
    expect(table, `${mod} must export ${name}`).toBeDefined();
    expect(Array.isArray(table) ? table.length : Object.keys(table as object).length).toBe(0);
  });

  it('the tables of milestone 3 and 4 behavior are honest (they list what is implemented)', async () => {
    const cost = (await load('rules/cost'))['COST_PART_IMPLS'] as object;
    expect(Object.keys(cost).sort()).toEqual(['action', 'behold' /* FAST5X E11 */, 'chooseObject' /* std-costs-2 */, 'discard', 'exileFrom', 'getCounters' /* FAST5X E27 */, 'manual', 'mill', 'oneOf' /* FAST5X E27 */, 'payEnergy', 'payLife', 'putCounters', 'putIntoLibrary' /* trek-9 */, 'removeCounters', 'returnToHand', 'reveal', 'revealChosen' /* std-combat-5 */, 'sacrifice', 'tapPower', 'tapUntapped', 'untapTapped' /* p2-cost-parts-1 */]); // WP7: all CostPart kinds
    expect(Object.keys((await load('rules/targets'))['TARGET_KINDS'] as object).sort()).toEqual(['ability', 'anyTarget', 'object', 'objectOrPlayer', 'player', 'spell', 'stackObject']);
    expect((await load('rules/filter'))['SUPPORTED_FILTER_FIELDS']).toBeInstanceOf(Set);
    expect((await load('core/validate'))['DECISION_KINDS']).toHaveLength(19); // M11-0: commanderZone (CR 903.9)
  });
});

describe('skeleton: effects/eval#evalCount is real for numbers (milestone 3/4 code needs it)', () => {
  it('numbers, "any number" and the announced X', async () => {
    const { evalCount } = (await load('effects/eval')) as { evalCount: (c: unknown, env?: { x?: number }) => number };
    expect(evalCount(3)).toBe(3);
    expect(evalCount(0)).toBe(0);
    expect(evalCount('any')).toBe(Number.POSITIVE_INFINITY);
    expect(evalCount({ q: 'X' }, { x: 4 })).toBe(4);
    expect(evalCount({ q: 'X' }, { x: 0 })).toBe(0);
    expect(() => evalCount({ q: 'X' })).toThrow('not been announced'); // CR 601.2b, 107.3a: a missing environment is loud, never 0
    expect(() => evalCount({ q: 'count', of: { ref: 'self' } })).toThrow(EngineBug);
  });
});

describe('skeleton: generated data stubs parse and have their shape', () => {
  const json = (file: string): Record<string, unknown> => JSON.parse(readFileSync(join(SRC_ROOT, file), 'utf8')) as Record<string, unknown>;

  it('the lexicon stub has every field of the Lexicon contract', () => {
    const lex = json('parser/lexicon.generated.json');
    for (const k of ['crEdition', 'cardTypes', 'supertypes', 'subtypes', 'colors', 'keywordAbilities', 'keywordActions', 'counterKinds', 'predefinedTokens', 'abilityWords']) {
      expect(lex, k).toHaveProperty(k);
    }
  });

  it('the schema is generated; the predefined token table (WP14) lists the 22 predefined tokens of CR 111.10 (test/m5/tokens/predefined.test.ts; Heartwood, 111.10x, since the 2026-09-25 edition)', () => {
    expect((json('effects/predefined-tokens.json')['tokens'] as unknown[]).length).toBe(22);
    expect(json('model/schema.generated.json')).toHaveProperty('$schema');
  });
});
