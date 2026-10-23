/**
 * Robustness: ability JSON arrives from the LLM cache, rules packs and hand-written data. Whatever its shape, the functions of model/ must not throw:
 * the validator reports, the walkers skip what the schema does not describe, and the rest is only ever called on validated data. This mutates the
 * worked examples at random (deterministic seed) and calls everything.
 */
import { describe, expect, it } from 'vitest';
import { canonicalize, capabilitiesOf, classifyAbility, degradeAbility, hydrateAbility, manualNodes, stripAbility, validateAbility, validateCardAbilities } from '../../../src/model';
import type { AbilityDef } from '../../../src/types/ability';
import { EXAMPLES } from './examples';

type J = Record<string, unknown>;

function rng(seed: number): () => number {
  return () => ((seed ^= seed << 13), (seed ^= seed >>> 17), (seed ^= seed << 5), (seed >>> 0) / 4294967296);
}

/** Collect every container (object or array) of a value. */
function containers(v: unknown, out: (J | unknown[])[] = []): (J | unknown[])[] {
  if (Array.isArray(v)) {
    out.push(v);
    v.forEach((x) => containers(x, out));
  } else if (v && typeof v === 'object') {
    out.push(v as J);
    Object.values(v as J).forEach((x) => containers(x, out));
  }
  return out;
}

function mutate(a: AbilityDef, next: () => number): AbilityDef {
  const copy = JSON.parse(JSON.stringify(a)) as AbilityDef;
  const all = containers(copy);
  const target = all[Math.floor(next() * all.length)]!;
  const junk: unknown[] = [null, 0, -1, 'zzz', [], {}, true, { op: 'nope' }, { ref: 'bound' }, [null]];
  const keys = Array.isArray(target) ? target.map((_, i) => String(i)) : Object.keys(target);
  const key = keys[Math.floor(next() * keys.length)];
  const bag = target as Record<string, unknown>;
  const pick = Math.floor(next() * 4);
  if (key === undefined || pick === 3) bag[`extra${Math.floor(next() * 3)}`] = junk[Math.floor(next() * junk.length)];
  else if (pick === 0) delete bag[key];
  else if (pick === 1) bag[key] = junk[Math.floor(next() * junk.length)];
  else bag[key] = typeof bag[key] === 'string' ? `${bag[key] as string}x` : junk[Math.floor(next() * junk.length)];
  return copy;
}

describe('no function of model/ throws on malformed ability JSON', () => {
  const abilities = EXAMPLES.flatMap((e) => e.faces.flatMap((f) => f.abilities));
  it('validate, walk, degrade, classify, canonicalize, strip and hydrate survive 4000 random mutations', () => {
    const next = rng(2463534242);
    const caps = new Set<string>();
    for (let i = 0; i < 4000; i++) {
      const m = mutate(abilities[i % abilities.length]!, next);
      const where = `mutation ${i} of ${JSON.stringify(m).slice(0, 200)}`;
      const issues = validateAbility(m);
      expect(Array.isArray(issues), where).toBe(true);
      // the downstream functions are only promised for well-formed data; for malformed data they must still not throw
      expect(() => capabilitiesOf(m), where).not.toThrow();
      expect(() => manualNodes(m), where).not.toThrow();
      expect(() => canonicalize(m), where).not.toThrow();
      expect(() => stripAbility(m), where).not.toThrow();
      if (issues.every((x) => x.severity !== 'error')) {
        expect(() => degradeAbility(m, caps, { lines: [], sentences: [] }), where).not.toThrow();
        expect(() => classifyAbility(m, caps), where).not.toThrow();
        expect(() => hydrateAbility(stripAbility(m), { lines: ['x'], sentences: [['x']] }, 'h', 'h'), where).not.toThrow();
      }
    }
  });
  it('validateCardAbilities survives non-array input and abilities without a kind', () => {
    expect(() => validateCardAbilities([{ abilities: [{} as AbilityDef] }])).not.toThrow();
    expect(() => validateCardAbilities([{ abilities: undefined as unknown as AbilityDef[] }])).not.toThrow();
    expect(() => validateCardAbilities(undefined as never)).not.toThrow();
  });
});
