/**
 * KeywordRegistry (design 5.3, 7.1): get, names, expand, capabilities, and how its capabilities reach ENGINE_CAPABILITIES (design 5.2: built from the tables,
 * never from a second list).
 */
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES } from '../../../src/index';
import { ACTION_MACROS } from '../../../src/keywords/actions';
import { keywordCapabilities } from '../../../src/keywords/capabilities';
import { actionNeeds, expansionNeeds } from '../../../src/keywords/needs';
import { createKeywordRegistry, keywordRegistry } from '../../../src/keywords/registry';
import type { KeywordDefData } from '../../../src/keywords/types';

describe('KeywordRegistry.get and names', () => {
  it('get finds a keyword by its canonical name, ignoring case and surrounding space', () => {
    expect(keywordRegistry.get('flying')?.rule).toBe('702.9');
    expect(keywordRegistry.get('  Flying ')?.name).toBe('flying');
    expect(keywordRegistry.get('Double Strike')?.rule).toBe('702.4');
    expect(keywordRegistry.get('start your engines!')?.rule).toBe('702.179');
  });

  it('get finds a keyword by alias, and an unknown name gives undefined', () => {
    expect(keywordRegistry.get('∞')?.name).toBe('infinity');
    expect(keywordRegistry.get('blorp')).toBeUndefined();
    expect(keywordRegistry.get('')).toBeUndefined();
  });

  it('names are the canonical names, sorted, without duplicates, and a copy (changing the answer changes nothing)', () => {
    const names = keywordRegistry.names();
    expect(names).toEqual([...names].sort());
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(202); // 194 rules (daybound and nightbound are two keywords; storied, FAST5X E18, is CR 702.195 since the 2026-09-25 edition) + multikicker + typecycling + megamorph (M6-3, CR 702.37b) + commander ninjutsu (CR 702.49d) and partner with (CR 702.124j), M11-4 + choose a Background and Doctor's companion (cmd1, CR 702.124k, 702.124m)
    names.pop();
    expect(keywordRegistry.names()).toHaveLength(202);
  });

  it('the loaded data is frozen: a data file cannot be edited at run time', () => {
    const flying = keywordRegistry.get('flying')!;
    expect(Object.isFrozen(flying.mechanisms)).toBe(true);
    expect(() => { (flying.mechanisms as string[]).push('x'); }).toThrow();
    expect(Object.isFrozen(keywordRegistry.get('ward')!.expand)).toBe(true);
  });

  it('every KeywordDef has the hook and special-action slots of the contract', () => {
    for (const d of keywordRegistry.all()) {
      expect(typeof d.hookImpl, d.name).toBe('object');
      expect(Array.isArray(d.special), d.name).toBe(true);
    }
  });
});

describe('KeywordRegistry.capabilities (design 5.2)', () => {
  const caps = keywordRegistry.capabilities();

  it('is `keyword:<name>` for every implemented or native keyword, sorted, and for no planned one', () => {
    expect(caps).toEqual([...caps].sort());
    for (const d of keywordRegistry.all()) expect(caps.includes(`keyword:${d.name}`), d.name).toBe(d.status !== 'planned');
    expect(caps).toContain('keyword:flying');
    expect(caps).toContain('keyword:ward');
    expect(caps).toContain('keyword:flashback'); // native: the engine acts on it
    expect(caps).toContain('keyword:morph'); // native since M6-3: the engine acts on it (casting face down, turning face up)
    expect(caps).toContain('keyword:suspend'); // std-rx22: implemented (core/special/suspend.ts, keywords/data/suspend.json); was the planned example here
    expect(caps).not.toContain('keyword:banding'); // CMD3: was echo, implemented since (CR 702.30a)
  });

  it('an alias is not a capability of its own', () => {
    const fake = createKeywordRegistry([{ name: 'zap', aliases: ['zip'], rule: '702.1', params: [], mechanisms: ['flag'], reminder: '', multiple: 'redundant', status: 'implemented', readers: ['a.ts#f'] } satisfies KeywordDefData]);
    expect(fake.capabilities()).toEqual(['keyword:zap']);
    expect(fake.get('zip')?.name).toBe('zap');
  });

  it('keywordCapabilities adds action:<name> for every registered macro whose expansion can run, and keeps every keyword whose expansion needs nothing missing', () => {
    const everything = new Set([...keywordRegistry.all().flatMap((d) => expansionNeeds(d)), ...Object.values(ACTION_MACROS).flatMap((m) => actionNeeds(m!))]);
    const all = keywordCapabilities(keywordRegistry, everything); // with every need available, nothing is withheld
    expect(all.filter((c) => c.startsWith('action:')).sort()).toEqual(Object.keys(ACTION_MACROS).map((n) => `action:${n}`).sort());
    expect(all.filter((c) => c.startsWith('keyword:'))).toEqual(caps);
    expect(all).toHaveLength(caps.length + Object.keys(ACTION_MACROS).length);
    // with nothing available, only the keywords that need nothing remain: flags, hooks, native ones; and no action (WP15 review: an expansion needs its ops)
    const none = keywordCapabilities(keywordRegistry, new Set());
    const bare = none.filter((c) => c.startsWith('keyword:'));
    expect(bare).toContain('keyword:flying');
    expect(bare).toContain('keyword:flashback');
    expect(bare).not.toContain('keyword:ward');
    expect(none.filter((c) => c.startsWith('action:'))).toEqual([]);
  });

  it('ENGINE_CAPABILITIES is built from these tables (a keyword or macro appears the moment the table has it and the capabilities its expansion needs exist)', () => {
    for (const c of keywordCapabilities(keywordRegistry, ENGINE_CAPABILITIES)) expect(ENGINE_CAPABILITIES.has(c), c).toBe(true);
    expect(ENGINE_CAPABILITIES.has('keyword:trample')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('keyword:morph')).toBe(true); // M6-3: native
    expect(ENGINE_CAPABILITIES.has('keyword:suspend')).toBe(true); // std-rx22: implemented (was planned)
    // a macro is advertised exactly when the ops, effect kinds, ... its expansion uses exist (investigate: createToken, WP14; detain: static:restrict, WP16)
    const runs = (name: string): boolean => actionNeeds(ACTION_MACROS[name as keyof typeof ACTION_MACROS]!).every((n) => ENGINE_CAPABILITIES.has(n));
    expect(ENGINE_CAPABILITIES.has('action:investigate')).toBe(runs('investigate'));
    expect(ENGINE_CAPABILITIES.has('action:cascade')).toBe(runs('cascade')); // a native action: needs feature:action.native.cascade (WP32, effects/handlers/actions-native.ts)
    expect(runs('cascade')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('action:detain')).toBe(runs('detain'));
    expect(ENGINE_CAPABILITIES.has('action:goad')).toBe(runs('goad')); // M12-3: native (effects/handlers/goad.ts)
    expect(runs('goad')).toBe(true);
  });
});
