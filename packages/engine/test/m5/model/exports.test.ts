/**
 * WP1 contract: every function of model/api.ts is exported from its module and from model/index.ts, and none is a stub any more (the skeleton test no
 * longer lists them).
 */
import { describe, expect, it } from 'vitest';
import * as model from '../../../src/model';

const CONTRACT: [string, string][] = [
  ['model/validate', 'validateAbility'], ['model/validate', 'validateCardAbilities'], ['model/lint', 'lintAbility'], ['model/canonical', 'canonicalize'],
  ['model/strip', 'stripAbility'], ['model/strip', 'hydrateAbility'], ['model/hash', 'textHash'], ['model/degrade', 'degradeAbility'],
  ['model/classify', 'classifyAbility'], ['model/classify', 'classifyCard'], ['model/classify', 'manualNodes'],
  ['model/capabilities', 'capabilitiesOf'], ['model/capabilities', 'missingCapabilities'],
];

describe('model/api.ts is implemented', () => {
  it.each(CONTRACT)('%s exports %s as a function that does not throw "not implemented"', async (mod, name) => {
    const fn = ((await import(/* @vite-ignore */ `../../../src/${mod}`)) as Record<string, unknown>)[name];
    expect(typeof fn).toBe('function');
    expect((model as Record<string, unknown>)[name]).toBe(fn);
    try {
      (fn as (...a: unknown[]) => unknown)({ kind: 'keyword', text: 'Flying', keyword: 'flying' }, new Set(), { lines: [], sentences: [] });
    } catch (e) {
      expect(String(e)).not.toContain('not implemented');
    }
  });
});
