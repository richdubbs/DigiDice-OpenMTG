/**
 * WP30 review: the forms of `ObjectFilter` that need an environment (`NEEDS_ENV`: references and quantities) are advertised because EVERY reader of a filter
 * passes one. That is enforced, not remembered (design 5.2: capabilities come from the engine's own tables; 15.1 item 5: nothing becomes falsely "full"):
 *   - the compiler: `FilterContext.env` is required (and both of its members), so a call of `matchesFilter` / `findObjects` without one does not build; the
 *     advertisement is derived from that type (`ENV_REQUIRED` in rules/filter.ts);
 *   - this test: engine code never uses the test-only `NO_ENV`, and never builds an environment by hand next to a filter call; environments come from
 *     `effects/refs.ts#filterCtxOf` / `filterEnvOf` (while resolving) and `rules/filter-env.ts#filterCtxOutside` / `filterEnvOutside` (everywhere else),
 *     which resolve every reference and quantity with the resolution's semantics.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FilterContext } from '../../../src/rules/filter';
import { NEEDS_ENV, SUPPORTED_FILTER_FIELDS } from '../../../src/rules/filter';
import { SRC_ROOT } from '../helpers';

/** The files that provide environments (and the evaluator itself). */
const PROVIDERS = new Set(['rules/filter.ts', 'rules/filter-env.ts', 'effects/refs.ts']);

function sources(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts')) out.push({ file: relative(SRC_ROOT, p).replace(/\\/g, '/'), text: readFileSync(p, 'utf8') });
    }
  };
  walk(SRC_ROOT);
  return out;
}

/** Code without comments, so a comment that mentions a name is not a use. */
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('design 5.2, 15.1: every reader of a filter passes a real environment', () => {
  it('FilterContext.env is required by the type (a context without one is a compile error)', () => {
    // @ts-expect-error -- `env` is required: this line must not compile.
    const bare: FilterContext = { you: 'p1' };
    expect(bare.you).toBe('p1');
  });

  it('engine code never uses NO_ENV (it is for tests of the evaluator)', () => {
    const users = sources().filter((f) => f.file !== 'rules/filter.ts' && /\bNO_ENV\b/.test(code(f.text))).map((f) => f.file);
    expect(users).toEqual([]);
  });

  it('engine code that reads filters never builds an environment by hand (only filterCtxOf / filterCtxOutside / filterEnvOf / filterEnvOutside do)', () => {
    const offenders = sources()
      .filter((f) => !PROVIDERS.has(f.file) && /\b(matchesFilter|findObjects)\(/.test(code(f.text)))
      .filter((f) => /\benv\s*:\s*\{/.test(code(f.text)))
      .map((f) => f.file);
    expect(offenders).toEqual([]);
  });

  it('every file that calls matchesFilter / findObjects takes its context from an environment provider', () => {
    const providers = /\b(filterCtxOf|filterCtxOutside|filterEnvOf|filterEnvOutside)\b/;
    const offenders = sources()
      .filter((f) => !PROVIDERS.has(f.file) && /\b(matchesFilter|findObjects)\(/.test(code(f.text)))
      .filter((f) => !providers.test(code(f.text)))
      .map((f) => f.file);
    expect(offenders).toEqual([]);
  });

  it('so the forms that need an environment are capabilities', () => {
    for (const n of NEEDS_ENV) expect(SUPPORTED_FILTER_FIELDS.has(n), n).toBe(true);
  });
});
