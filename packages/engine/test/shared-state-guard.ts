/**
 * Setup file of the `node` project in the fast default suite (package QT, vitest.config.ts). There the test files of a worker share one module cache, so
 * a test that changes one of the engine's tables (a handler, a renderer, an evaluator, a hook action, a capability) and does not put it back would
 * change the files that run after it in that worker. This guard takes a copy of every such table before each file and fails that file if any entry is
 * added, removed or replaced when it ends, naming the entries: the file must restore what it changes (see test/m5/run/helpers.ts withoutHandlers).
 */
import { afterAll, beforeAll } from 'vitest';
import { OP_HANDLERS } from '../src/effects/handlers';
import { COND_EVALUATORS, DUR_EVALUATORS, QTY_EVALUATORS } from '../src/effects/eval';
import { FEATURES as MANUAL_FEATURES } from '../src/effects/manual';
import { FEATURES as PROPOSE_FEATURES, REPLACEMENT_BODIES, STATIC_KINDS as PROPOSE_STATIC_KINDS } from '../src/effects/propose';
import { ACTION_MACROS } from '../src/keywords/actions';
import { ENGINE_CAPABILITIES } from '../src/model/capabilities';
import { RENDERERS } from '../src/render/step';
import { STABLE_READS } from '../src/rules/characteristics';
import { RULE_HOOK_ACTIONS, staticsProvider } from '../src/statics/hooks';
import { STATIC_KINDS as LIVE_STATIC_KINDS } from '../src/statics/live';
import { copyTables, tableChanges, type TablesCopy } from './suite-isolation';
import { M6_REGISTRIES } from './m6/registries';

const TABLES: Readonly<Record<string, object>> = {
  // M6-0 (m6 design 2.6): the milestone 6 registries, which tests extend with test parts (each must restore what it adds)
  ...M6_REGISTRIES,
  OP_HANDLERS,
  RENDERERS,
  COND_EVALUATORS,
  QTY_EVALUATORS,
  DUR_EVALUATORS,
  RULE_HOOK_ACTIONS,
  ACTION_MACROS,
  REPLACEMENT_BODIES,
  'propose STATIC_KINDS': PROPOSE_STATIC_KINDS,
  'statics/live STATIC_KINDS': LIVE_STATIC_KINDS,
  'effects/manual FEATURES': MANUAL_FEATURES,
  'effects/propose FEATURES': PROPOSE_FEATURES,
  staticsProvider,
  STABLE_READS,
  ENGINE_CAPABILITIES,
};

let before: TablesCopy;

beforeAll(() => {
  before = copyTables(TABLES);
});

afterAll(() => {
  const changes = tableChanges(before, copyTables(TABLES));
  if (changes.length > 0) {
    throw new Error(
      `this test file left engine tables changed: ${changes.join('; ')}. In the default suite the test files of a worker share their modules (package QT): restore every table entry a test changes (or run the file isolated, packages/engine/test/suite-isolation.ts).`,
    );
  }
});
