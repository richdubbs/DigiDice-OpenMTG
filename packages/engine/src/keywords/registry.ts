/**
 * The keyword registry: loads keywords/data/*.json and combines each entry with its hook implementations and special actions (design 7.1). Owner: WP3.
 *
 * - The data files are the single source of truth (principle 1). They are validated when the registry is built (`keywordDataSetProblems`): a malformed file or a
 *   duplicate name is a loud failure at import time, never a keyword that silently does nothing. Loaded data is deep-frozen, and so is every `KeywordDef`
 *   that `get`/`all` hand out (the only part bound later is `hookImpl`, which is a getter over the registry's own table), so a caller cannot change a status or a
 *   hook list and thereby the behavior of the engine.
 * - `status` decides what the engine may do (design 7.1): only `implemented` keywords expand into abilities; `native` keywords are acted on by engine code that
 *   predates the data form (flashback), so expanding them as well would act twice; `planned` keywords parse and display and nothing else. The capability
 *   `keyword:<name>` of `capabilities()` is declared for `implemented` and `native` keywords only (design 5.2); `keywordCapabilities` (capabilities.ts) further withholds an
 *   expanding keyword whose expansion needs a capability the engine lacks.
 * - Hook implementations are NOT imported here (design 5.4: only rules/hookpoints reaches keywords/hooks, or characteristics -> layers -> registry -> hooks ->
 *   characteristics would be an import cycle). keywords/hooks/index.ts registers its implementations with `bindKeywordHooks` when it loads, so `get(name).hookImpl`
 *   is filled as soon as the keyword provider exists, which is whenever the engine is in use.
 */
import { deepFreeze } from '../util/clone';
import type { AbilityDef, KeywordAbilityDef } from '../types/ability';
import { KEYWORD_DATA_FILES } from './data';
import { expandKeyword } from './expand';
import { SPECIAL_BY_KEYWORD } from './special';
import { keywordDataSetProblems } from './validate';
import type { ExpandContext, KeywordDef, KeywordDefData, KeywordHooks, KeywordRegistry, SpecialActionDef } from './types';

export interface KeywordRegistryHandle extends KeywordRegistry {
  /** Attach hook implementations by canonical keyword name (called by keywords/hooks/index.ts). An unknown name is a programming error and throws. */
  bindHooks(impls: Readonly<Record<string, Partial<KeywordHooks>>>): void;
  /** Every keyword definition (frozen), sorted by name. A copy: changing the answer changes nothing. */
  all(): readonly KeywordDef[];
}

const NO_HOOKS: Partial<KeywordHooks> = Object.freeze({});

export class KeywordRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeywordRegistryError';
  }
}

/** Build a registry from data files (exported so tests can build one from fake data). Throws `KeywordRegistryError` listing every problem of the data. */
export function createKeywordRegistry(files: readonly unknown[], special: Readonly<Record<string, readonly SpecialActionDef[]>> = SPECIAL_BY_KEYWORD): KeywordRegistryHandle {
  const problems = keywordDataSetProblems(files);
  if (problems.length > 0) throw new KeywordRegistryError(`invalid keyword data:\n  ${problems.join('\n  ')}`);

  const byName = new Map<string, KeywordDef>();
  const bound = new Map<string, Partial<KeywordHooks>>(); // bound later by bindHooks; read through the `hookImpl` getter of each definition
  const byAlias = new Map<string, KeywordDef>();
  for (const file of files) {
    const data = deepFreeze(file as KeywordDefData);
    const def = { ...data, special: Object.freeze([...(special[data.name] ?? [])]) } as KeywordDef;
    Object.defineProperty(def, 'hookImpl', { enumerable: true, get: () => bound.get(data.name) ?? NO_HOOKS });
    Object.freeze(def);
    byName.set(data.name, def);
    for (const a of data.aliases ?? []) byAlias.set(a, def);
  }
  const sorted = [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const lookup = (name: string): KeywordDef | undefined => {
    const key = name.trim().toLowerCase();
    return byName.get(key) ?? byAlias.get(key);
  };

  return {
    get: lookup,
    names: () => sorted.map((d) => d.name),
    all: () => [...sorted],
    expand(kw: KeywordAbilityDef, ctx: ExpandContext): AbilityDef[] {
      const def = lookup(kw.keyword);
      if (def === undefined) throw new KeywordRegistryError(`unknown keyword "${kw.keyword}": it is not in the keyword library, so it must stay a manual node (design 7.1.5)`);
      // Only `implemented` keywords act through their data. `native` ones are acted on by engine code, `planned` ones by nothing (design 7.1).
      if (def.status !== 'implemented') return [];
      return expandKeyword(def, kw, ctx);
    },
    capabilities: () => sorted.filter((d) => d.status === 'implemented' || d.status === 'native').map((d) => `keyword:${d.name}`),
    bindHooks(impls) {
      for (const [name, impl] of Object.entries(impls)) {
        if (!byName.has(name)) throw new KeywordRegistryError(`hook implementation for unknown keyword "${name}"`);
        bound.set(name, impl);
      }
    },
  };
}

export const keywordRegistry: KeywordRegistryHandle = createKeywordRegistry(KEYWORD_DATA_FILES.map((f) => f.data));
