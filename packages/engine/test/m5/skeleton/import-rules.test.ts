/**
 * Design 5.4, "Import rules (no cycles)": a lint over the import graph of packages/engine/src. It parses every relative `import` / `export ... from`
 * and fails on a forbidden edge, so work packages that fill disjoint files cannot quietly tie the layers together. The rules:
 *
 *   types     imports nothing (value imports); the only type-only imports are the two listed below
 *   model     imports types and model; render imports types, model, render
 *   keywords  imports types, model, keywords and, from rules, ONLY characteristics, protection and denial (design 5.4 amendment, below); never effects,
 *             triggers, statics, parser, cards, actions, core (value). Only rules/hookpoints reaches keywords/hooks: the registry, expand and capabilities never value-import a hook module
 *   parser    imports types, model, render, keywords and NOTHING from core, effects, rules, statics, triggers, actions, cards (not even types): it runs without a game
 *   statics   imports types, keywords, rules/base-chars only (rules/characteristics imports statics/layers, so statics may not import it back)
 *   triggers  imports types, statics, rules, core; effects imports those too and keywords/actions; neither imports cards, parser, render, model
 *   cards     the milestone 5 modules (pipeline, spans, pack, pool) import parser, model, keywords, render, types
 *   engine    core, rules, actions, effects, triggers, statics, keywords never import parser, render or model (tooling stays outside the engine core)
 *   cycles    no import cycle (value imports) beyond the three milestone 3/4 modules listed in KNOWN_CYCLES
 *
 * Documented exceptions: model/forms.ts is pure data about the ability model (it imports only types) that the capability walker (WP1) and the engine's fail-closed
 * announcement checks (actions/announce, actions/activate) share, so a field or value form the build can't honor has ONE name in both places (WP0 review);
 * `core`, `rules` and `actions` may import it and nothing else from `model`. model/capabilities.ts is the one model module that imports other layers (it BUILDS the capability set from their tables,
 * design 5.2), and index.ts / rng.ts at the top of src may import anything.
 */
import { describe, expect, it } from 'vitest';
import { engineModules, type EngineModule, type ImportEdge } from '../helpers';

const KNOWN_CYCLES = [['core/manual', 'core/zones', 'rules/mana']];
const TYPE_IMPORT_ALLOWLIST_FROM_TYPES = new Set(['types/state -> rng', 'types/state -> rules/characteristics']);

const layerOf = (id: string): string => (id.includes('/') ? id.split('/')[0]! : '.');
const MODEL_BUILDER = 'model/capabilities';
/**
 * The milestone 5 card modules (design 5.4: cards imports parser, model, keywords, render, types). WP18 review: the modules WP18 added or rewrote (compile,
 * faces, face-text, target-ids, native) and the milestone 4 recognizers native.ts still calls are checked too.
 */
const NEW_CARDS_MODULES = new Set([
  'cards/pipeline', 'cards/spans', 'cards/pack', 'cards/pool', 'cards/compile', 'cards/faces', 'cards/face-text', 'cards/target-ids', 'cards/native',
  'cards/keywords', 'cards/enters-with', 'cards/keyword-list',
]);
/**
 * DOCUMENTED TEMPORARY EXCEPTION (WP18 review): the milestone 3/4 recognizers kept below the parser (cards/native.ts, design 15.2 WP18) read two rules
 * modules and the milestone 4 keyword-line reader reads rules/quality. They are pure text readers (no game state). The edges go with cards/native.ts and
 * cards/keywords.ts when the template packages WP19-WP23 cover their lines (CompileReport.faces[].nativeLines reaches zero on the whole index).
 */
const NATIVE_RULES_EXCEPTIONS = new Set(['cards/native -> rules/cast-restriction', 'cards/native -> rules/mana-text', 'cards/keywords -> rules/quality']);

interface Rule {
  name: string;
  applies: (m: EngineModule) => boolean;
  /** Layers (or module ids) this module may import with a value import; everything else is a violation. */
  values: (e: ImportEdge, m: EngineModule) => boolean;
  /** Same for type-only imports; defaults to `values`. */
  types?: (e: ImportEdge, m: EngineModule) => boolean;
}

/**
 * DESIGN 5.4 AMENDMENT (WP0 review). Design 5.4 lets `keywords` import only `types`, model types, `rules/denial` and `core/game` types. The keyword provider
 * (keywords/hooks) needs the characteristics function and the protection predicates, so it value-imports exactly these three rules modules and no others.
 * It is safe because nothing under `rules/` or `statics/` value-imports `keywords/hooks` (only `rules/hookpoints` does, lazily): `rules/characteristics`
 * -> `statics/layers` -> `keywords/registry` must never reach `keywords/hooks`, or `characteristics -> layers -> registry -> hooks -> characteristics` is a cycle.
 */
const KEYWORD_RULES_MODULES = new Set(['rules/characteristics', 'rules/protection', 'rules/denial']);

/** `util` (pure helpers with no engine knowledge) may be imported from every layer except types. */
const inLayers = (...layers: string[]) => (e: ImportEdge): boolean => layers.includes(layerOf(e.to)) || layerOf(e.to) === 'util';

const RULES: Rule[] = [
  {
    name: 'types imports nothing',
    applies: (m) => m.layer === 'types',
    values: (e) => layerOf(e.to) === 'types',
    types: (e, m) => layerOf(e.to) === 'types' || TYPE_IMPORT_ALLOWLIST_FROM_TYPES.has(`${m.id} -> ${e.to}`),
  },
  {
    name: 'model imports types and model',
    applies: (m) => m.layer === 'model' && m.id !== MODEL_BUILDER,
    values: inLayers('types', 'model'),
  },
  { name: 'render imports types, model, render', applies: (m) => m.layer === 'render', values: inLayers('types', 'model', 'render') },
  {
    name: 'keywords import types, model, rules, keywords (values); never the interpreter, triggers, statics, parser, cards, actions or core',
    applies: (m) => m.layer === 'keywords',
    values: (e) => inLayers('types', 'model', 'keywords')(e) || KEYWORD_RULES_MODULES.has(e.to),
    types: inLayers('types', 'model', 'rules', 'keywords', 'core'),
  },
  {
    name: 'only rules/hookpoints reaches keywords/hooks: the registry, expand, capabilities and every other keywords module never value-import a hook module (WP3: keep it so)',
    applies: (m) => m.layer === 'keywords' && !m.id.startsWith('keywords/hooks/'),
    values: (e) => !e.to.startsWith('keywords/hooks/'),
  },
  {
    name: 'no module outside rules/hookpoints and the hooks themselves value-imports keywords/hooks',
    applies: (m) => m.id !== 'rules/hookpoints' && !m.id.startsWith('keywords/hooks/') && m.id !== 'index' && m.layer !== '.',
    values: (e) => !e.to.startsWith('keywords/hooks/'),
  },
  {
    name: 'parser imports types, model, render, keywords and nothing from the game',
    applies: (m) => m.layer === 'parser',
    values: inLayers('types', 'model', 'render', 'keywords', 'parser'),
  },
  {
    name: 'statics import types, keywords and rules/base-chars only',
    applies: (m) => m.layer === 'statics',
    values: (e) => ['types', 'keywords', 'statics', 'util'].includes(layerOf(e.to)) || e.to === 'rules/base-chars',
    types: inLayers('types', 'keywords', 'statics', 'rules'),
  },
  {
    name: 'triggers import types, statics, rules, core',
    applies: (m) => m.layer === 'triggers',
    values: inLayers('types', 'statics', 'rules', 'core', 'triggers', 'keywords'),
    types: inLayers('types', 'statics', 'rules', 'core', 'triggers', 'keywords', 'effects'),
  },
  {
    name: 'effects import types, statics, triggers, rules, core, keywords',
    applies: (m) => m.layer === 'effects',
    values: inLayers('types', 'statics', 'triggers', 'rules', 'core', 'keywords', 'effects'),
    types: inLayers('types', 'statics', 'triggers', 'rules', 'core', 'keywords', 'effects'),
  },
  {
    name: 'the milestone 5 card modules import parser, model, keywords, render, types',
    applies: (m) => NEW_CARDS_MODULES.has(m.id),
    // WP24 INTERFACE CHANGE: cards/pool#tokenDefFor returns the predefined token definition the interpreter creates (same content-derived id), so it calls
    // effects/handlers/token-defs#tokenCardDef. That module is data plus pure builders: it imports only types (and the predefined-tokens JSON), so no cycle.
    values: (e, m) =>
      inLayers('types', 'parser', 'model', 'keywords', 'render', 'cards')(e) || NATIVE_RULES_EXCEPTIONS.has(`${m.id} -> ${e.to}`) || (m.id === 'cards/pool' && e.to === 'effects/handlers/token-defs'),
  },
  {
    name: 'engine layers never import the parser, the renderer or the model tooling',
    applies: (m) => ['core', 'rules', 'actions'].includes(m.layer),
    values: (e) => !['parser', 'render', 'model'].includes(layerOf(e.to)) || e.to === 'model/forms', // model/forms: see the header
  },
];

describe('import rules (design 5.4)', () => {
  const modules = engineModules();

  it('the module graph was read (sanity)', () => {
    expect(modules.length).toBeGreaterThan(80);
    expect(modules.find((m) => m.id === 'rules/hookpoints')?.imports.some((e) => e.to === 'keywords/hooks/index')).toBe(true);
  });

  for (const rule of RULES) {
    it(rule.name, () => {
      const violations: string[] = [];
      for (const m of modules.filter(rule.applies)) {
        for (const e of m.imports) {
          const ok = e.typeOnly ? (rule.types ?? rule.values)(e, m) : rule.values(e, m);
          if (!ok) violations.push(`${m.id} -> ${e.to}${e.typeOnly ? ' (type)' : ''}`);
        }
      }
      expect(violations).toEqual([]);
    });
  }

  it('the parser does not even import types from the game (it runs without a game, in the browser)', () => {
    const bad = modules.filter((m) => m.layer === 'parser').flatMap((m) => m.imports.filter((e) => ['core', 'effects', 'rules', 'statics', 'triggers', 'actions', 'cards'].includes(layerOf(e.to))).map((e) => `${m.id} -> ${e.to}`));
    expect(bad).toEqual([]);
  });

  it('rules/characteristics may import statics/layers because statics/layers imports rules/base-chars, never characteristics back', () => {
    const layers = modules.filter((m) => m.layer === 'statics').flatMap((m) => m.imports.filter((e) => !e.typeOnly && e.to === 'rules/characteristics').map((e) => `${m.id} -> ${e.to}`));
    expect(layers).toEqual([]);
    const base = modules.find((m) => m.id === 'rules/base-chars')!;
    expect(base.imports.filter((e) => !e.typeOnly && (layerOf(e.to) === 'statics' || e.to === 'rules/characteristics'))).toEqual([]);
  });

  it('there are no import cycles beyond the known milestone 3/4 ones (value imports)', () => {
    const byId = new Map(modules.map((m) => [m.id, m]));
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const stack: string[] = [];
    const onStack = new Set<string>();
    const cycles: string[][] = [];
    let counter = 0;
    const visit = (v: string): void => {
      index.set(v, counter);
      low.set(v, counter);
      counter++;
      stack.push(v);
      onStack.add(v);
      for (const e of byId.get(v)!.imports) {
        if (e.typeOnly) continue;
        if (!index.has(e.to)) {
          visit(e.to);
          low.set(v, Math.min(low.get(v)!, low.get(e.to)!));
        } else if (onStack.has(e.to)) low.set(v, Math.min(low.get(v)!, index.get(e.to)!));
      }
      if (low.get(v) === index.get(v)) {
        const component: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          component.push(w);
        } while (w !== v);
        if (component.length > 1) cycles.push(component.sort());
      }
    };
    for (const m of modules) if (!index.has(m.id)) visit(m.id);
    expect(cycles.sort()).toEqual(KNOWN_CYCLES);
  });

  it('the keyword lint is narrow: a keywords module importing rules/combat-rules (or any rules module beyond the three) is a violation', () => {
    const rule = RULES.find((r) => r.name.startsWith('keywords import'))!;
    const fake: EngineModule = { id: 'keywords/hooks/fake', layer: 'keywords', imports: [{ to: 'rules/combat-rules', typeOnly: false }] };
    expect(rule.values(fake.imports[0]!, fake)).toBe(false);
    expect(rule.values({ to: 'rules/protection', typeOnly: false }, fake)).toBe(true);
    const registry: EngineModule = { id: 'keywords/registry', layer: 'keywords', imports: [{ to: 'keywords/hooks/index', typeOnly: false }] };
    const guard = RULES.find((r) => r.name.startsWith('only rules/hookpoints'))!;
    expect(guard.applies(registry)).toBe(true);
    expect(guard.values(registry.imports[0]!, registry)).toBe(false);
  });

  it('design 5.4 (WP18 review): the cards rule covers native.ts, and its documented exception is narrow (rules/combat-rules is still a violation)', () => {
    const rule = RULES.find((r) => r.name.startsWith('the milestone 5 card modules'))!;
    const native: EngineModule = { id: 'cards/native', layer: 'cards', imports: [] };
    expect(rule.applies(native)).toBe(true);
    expect(rule.values({ to: 'rules/mana-text', typeOnly: false }, native)).toBe(true);
    expect(rule.values({ to: 'rules/combat-rules', typeOnly: false }, native)).toBe(false);
    expect(rule.values({ to: 'core/game', typeOnly: false }, { id: 'cards/pipeline', layer: 'cards', imports: [] })).toBe(false);
  });

  it('the rule set itself catches a forbidden edge (self-test of the lint)', () => {
    const fake: EngineModule = { id: 'parser/fake', layer: 'parser', imports: [{ to: 'core/game', typeOnly: false }] };
    const rule = RULES.find((r) => r.name.startsWith('parser'))!;
    expect(rule.applies(fake)).toBe(true);
    expect(rule.values(fake.imports[0]!, fake)).toBe(false);
  });
});
