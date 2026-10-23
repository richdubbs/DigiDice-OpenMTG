/**
 * Design 7.1.6, the traceability test: "each flag/hook keyword lists its engine reader call-sites in its data file's `readers` list (file path and function);
 * a grep test fails if a keyword whose status is `implemented` has no reader, so no keyword is silently ignored."
 *
 * A reader is "<file>#<function>" relative to src. The checker below verifies, for a keyword with status implemented (or native) and mechanism flag or hook:
 *   1. it lists at least one reader;
 *   2. every reader's file exists and mentions the function by name;
 *   3. the keyword really is reached from there: some reader file names the keyword in quotes (`'trample'`: the engine reads it from the characteristics), or the
 *      keyword has a hook implementation (reached through the provider) and the reader call-site goes through `hookpoints`. The hookpoint's own file
 *      (rules/hookpoints.ts) and the keyword library (keywords/) never count as a call-site.
 * Negative tests prove the checker can fail.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUTOMATED_KEYWORDS } from '../../../src/cards/keywords';
import { HOOK_IMPLS } from '../../../src/keywords/hooks';
import { keywordRegistry } from '../../../src/keywords/registry';
import type { KeywordDefData } from '../../../src/keywords/types';
import { SRC_ROOT } from '../helpers';

export function traceabilityProblems(d: KeywordDefData, hooked: ReadonlySet<string>, root: string = SRC_ROOT): string[] {
  const p: string[] = [];
  if (d.status === 'planned') return p;
  const reads = d.mechanisms.includes('flag') || d.mechanisms.includes('hook');
  if (!reads) return p;
  const readers = d.readers ?? [];
  if (readers.length === 0) return [`${d.name}: implemented keyword with mechanism flag/hook but no readers`];
  let reached = false;
  for (const r of readers) {
    const [file, fn] = r.split('#') as [string, string];
    const path = join(root, file);
    if (!existsSync(path)) {
      p.push(`${d.name}: reader file ${file} does not exist`);
      continue;
    }
    const text = readFileSync(path, 'utf8');
    if (!new RegExp(`\\b${fn}\\b`).test(text)) p.push(`${d.name}: ${file} does not mention ${fn}`);
    const isEngineCallSite = file !== 'rules/hookpoints.ts' && !file.startsWith('keywords/');
    // A flag keyword may be read inside the keyword library (reach is read by the flying hook); a HOOK keyword needs a call-site of the engine.
    const quoted = file !== 'rules/hookpoints.ts' && (isEngineCallSite || !d.mechanisms.includes('hook')) && text.includes(`'${d.name}'`);
    // The definition of the hookpoint and the keyword library are not READERS: a reader is an engine call-site that asks the hookpoints (WP3 review: convoke listed
    // rules/hookpoints.ts#paymentOptions, the hookpoint's own definition, and nothing called it).
    const viaProvider = hooked.has(d.name) && text.includes('hookpoints') && isEngineCallSite;
    if (quoted || viaProvider) reached = true;
  }
  if (!reached) p.push(`${d.name}: no reader file reads the keyword (none names '${d.name}' and none reaches its hooks through hookpoints)`);
  return p;
}

describe('design 7.1.6: no implemented keyword is silently ignored', () => {
  const hooked = new Set(Object.keys(HOOK_IMPLS));
  const acting = keywordRegistry.all().filter((d) => d.status !== 'planned' && (d.mechanisms.includes('flag') || d.mechanisms.includes('hook')));

  it('there are flag and hook keywords to check (the combat, targeting, timing and cast keywords of milestones 3 and 4)', () => {
    expect(acting.map((d) => d.name).sort()).toEqual([
      'aftermath', 'convoke', 'deathtouch', 'defender', 'delve' /* std-tdm */, 'double strike', 'enchant', 'fear', 'first strike', 'flash', 'flying', 'fuse', 'haste', 'hexproof', 'horsemanship',
      'improvise' /* FAST5X E26 */, 'indestructible', 'infect', 'intimidate', 'landwalk', 'lifelink', 'menace', 'protection', 'reach', 'shadow', 'shroud', 'skulk', 'split second', 'toxic', 'trample',
      'vigilance', 'wither',
    ]);
  });

  it.each(keywordRegistry.all().filter((d) => d.status !== 'planned').map((d) => d.name))('%s has a reader that reaches it', (name) => {
    expect(traceabilityProblems(keywordRegistry.get(name)!, hooked)).toEqual([]);
  });

  it('flashback is native: the engine acts on it in actions/cast.ts and core/resolve.ts, and the data lists them', () => {
    expect(keywordRegistry.get('flashback')!.readers).toEqual(['actions/cast.ts#castCheck', 'core/resolve.ts#leaveStack']);
  });

  it('every keyword the milestone 4 keyword-line compiler automates is implemented in the library (the library knows everything the engine acts on)', () => {
    for (const name of AUTOMATED_KEYWORDS) {
      const d = keywordRegistry.get(name);
      expect(d, `${name} is automated by cards/keywords.ts but is not in the library`).toBeDefined();
      expect(d!.status, name).toBe('implemented');
    }
  });

  describe('the checker can fail (negative tests)', () => {
    const base: KeywordDefData = { name: 'trample', rule: '702.19', params: [], mechanisms: ['flag'], reminder: '', multiple: 'redundant', status: 'implemented' };

    it('no readers', () => {
      expect(traceabilityProblems(base, hooked)).toEqual(['trample: implemented keyword with mechanism flag/hook but no readers']);
    });

    it('a reader file that does not exist, and a function the file does not mention', () => {
      expect(traceabilityProblems({ ...base, readers: ['core/nowhere.ts#f'] }, hooked).join('\n')).toContain('does not exist');
      expect(traceabilityProblems({ ...base, readers: ['core/combat-damage.ts#notAFunction'] }, hooked).join('\n')).toContain('does not mention notAFunction');
    });

    it('a reader that exists but never reads the keyword', () => {
      expect(traceabilityProblems({ ...base, name: 'banding', readers: ['core/combat-damage.ts#combatDamageStep'] }, hooked).join('\n')).toContain("none names 'banding'");
    });

    it('a keyword that only the data claims to have a hook for is not reached through the provider', () => {
      expect(traceabilityProblems({ ...base, name: 'banding', mechanisms: ['hook'], readers: ['rules/combat-rules.ts#blockDenial'] }, new Set()).join('\n')).toContain("none names 'banding'");
    });

    it('the definition of the hookpoint is not a reader: a hook keyword whose only reader is rules/hookpoints.ts (nothing calls it) fails', () => {
      const hook: KeywordDefData = { ...base, name: 'convoke', mechanisms: ['hook'], hooks: ['paymentOptions'], readers: ['rules/hookpoints.ts#paymentOptions'] };
      expect(traceabilityProblems(hook, hooked).join(' | ')).toContain("none names 'convoke'");
      expect(traceabilityProblems({ ...hook, readers: ['keywords/hooks/convoke.ts#paymentOptions'] }, hooked).join(' | ')).toContain("none names 'convoke'");
    });

    it('a planned keyword needs nothing', () => {
      expect(traceabilityProblems({ ...base, status: 'planned' }, hooked)).toEqual([]);
    });

    it('a keyword that reads nothing (expands only) needs no readers', () => {
      expect(traceabilityProblems({ ...base, mechanisms: ['expands'] }, hooked)).toEqual([]);
    });
  });
});
