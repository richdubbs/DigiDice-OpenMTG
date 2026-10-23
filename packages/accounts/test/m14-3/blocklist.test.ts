/**
 * M14-3: the blocklist (design 4.3) and its generator: the committed data names its pinned source, holds only entries in the policy's form of 8 (the
 * lowest PASSWORD_MIN the configuration accepts) to 128 code points plus the context words, unique and sorted; NOTICE records the source, commit, hash
 * and licence; the generator's rules on a fixed text (no download), and its refusal of a source that does not match the pin.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_LIMITS } from '../../src/api';
import { PASSWORD_CONTEXT_WORDS, passwordForm } from '../../src/api/passwords';
import { loadAccountsConfig } from '../../src/config';
import { BLOCKLIST, BLOCKLIST_SOURCE } from '../../src/crypto/blocklist';
import { hostedTextProblem } from '../../src/text';
import {
  BLOCKLIST_PATH, blocklistEntries, blocklistModule, ENTRY_MIN, FULL_LIST_MIN, generate, SHORT_ENTRY_LINES, SOURCE,
} from '../../scripts/gen-blocklist';

const cp = (s: string) => Array.from(s).length;

describe('M14-3: the committed blocklist', () => {
  it('names its pinned source, and NOTICE records it', () => {
    expect(BLOCKLIST_SOURCE.url).toBe(SOURCE.url);
    expect(BLOCKLIST_SOURCE.commit).toBe(SOURCE.commit);
    expect(BLOCKLIST_SOURCE.sha256).toBe(SOURCE.sha256);
    expect(SOURCE.url).toContain(SOURCE.commit);
    expect(SOURCE.url.endsWith(SOURCE.path)).toBe(true);
    expect(SOURCE.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(SOURCE.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(BLOCKLIST_SOURCE.entries).toBe(BLOCKLIST.size);
    const notice = readFileSync(new URL('../../../../NOTICE', import.meta.url), 'utf8');
    for (const s of [SOURCE.commit, SOURCE.sha256, SOURCE.url, SOURCE.path, 'MIT License', 'Copyright (c) 2018 Daniel Miessler']) {
      expect(notice, s).toContain(s);
    }
  });

  it('reaches down to the lowest PASSWORD_MIN the configuration accepts (8), not only the default of 12', () => {
    // review of M14-3: with PASSWORD_MIN 8 the entries of 8 to 11 characters must be there, or the commonest passwords pass
    expect(ENTRY_MIN).toBe(8);
    expect(BLOCKLIST_SOURCE.minLength).toBe(ENTRY_MIN);
    expect(BLOCKLIST_SOURCE.fullListMinLength).toBe(FULL_LIST_MIN);
    expect(FULL_LIST_MIN).toBe(ACCOUNT_LIMITS.passwordMin);
    expect(BLOCKLIST_SOURCE.shortEntryLines).toBe(SHORT_ENTRY_LINES);
    const config = (min: number) => loadAccountsConfig({ PASSWORD_MIN: String(min) });
    const lowest = config(ENTRY_MIN);
    expect(lowest.ok && lowest.config.passwordMin).toBe(ENTRY_MIN);
    expect(config(ENTRY_MIN - 1).ok).toBe(false);
    for (const x of ['password', 'baseball', 'football', 'superman', 'trustno1', 'sunshine', 'iloveyou', 'princess', 'password1', 'iloveyou1']) {
      expect(BLOCKLIST.has(x), x).toBe(true);
    }
    expect([...BLOCKLIST].filter((e) => cp(e) < FULL_LIST_MIN && !PASSWORD_CONTEXT_WORDS.includes(e)).length).toBeGreaterThan(30_000);
  });

  it('holds entries in the policy\'s form, 8 to 128 code points (or a context word), unique and sorted', () => {
    expect(BLOCKLIST.size).toBeGreaterThan(10_000);
    const entries = [...BLOCKLIST];
    const context = new Set(PASSWORD_CONTEXT_WORDS);
    // one assertion over the bad entries: four expect calls for each of the 10,000+ entries took about 5 s, the test timeout
    const bad = entries.filter(
      (e) => passwordForm(e) !== e || hostedTextProblem(e) !== null || (!context.has(e) && (cp(e) < ENTRY_MIN || cp(e) > ACCOUNT_LIMITS.passwordMax)),
    );
    expect(bad).toEqual([]);
    for (const w of PASSWORD_CONTEXT_WORDS) expect(BLOCKLIST.has(w), w).toBe(true);
    const sorted = [...entries].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(entries).toEqual(sorted);
    // the file the generator writes is the one the module loads
    expect(readFileSync(BLOCKLIST_PATH, 'utf8')).toContain(`export const BLOCKLIST: ReadonlySet<string> = new Set(ENTRIES);`);
  });
});

describe('M14-3: the generator (fixed text, no download)', () => {
  const TEXT = [
    'password', '123456', 'abcdefg', 'iloveyou1234', 'ILOVEYOU1234', 'ＰＡＳＳＷＯＲＤ１２３４', 'manchesterunited\r', '', 'short one', 'exactly12chr',
    'eleven char', 'with\u0000nul in it', 'a control \u0007 char', 'x'.repeat(129), `${'y'.repeat(127)}z`, 'zzzzzzzzzzzzz', 'aaaaaaaaaaaaa',
  ].join('\n');

  it('keeps the form of each line of 8 to 128 code points that passes the text rules, adds the context words, unique and sorted', () => {
    expect(blocklistEntries(TEXT)).toEqual([
      'aaaaaaaaaaaaa', 'digidice', 'eleven char', 'exactly12chr', 'iloveyou1234', 'magicthegathering', 'manchesterunited', 'openmtg', 'password',
      'password1234', 'short one', `${'y'.repeat(127)}z`, 'zzzzzzzzzzzzz',
    ]);
  });

  it('keeps entries of 8 to 11 code points only from the first 100,000 lines, longer ones from every line', () => {
    const lines = new Array<string>(SHORT_ENTRY_LINES - 1).fill('');
    lines.push('lastshort', 'too late', 'eleven late', 'late but long enough');
    expect(lines.indexOf('lastshort')).toBe(SHORT_ENTRY_LINES - 1);
    const entries = blocklistEntries(lines.join('\n'));
    expect(entries).toContain('lastshort');
    expect(entries).toContain('late but long enough');
    expect(entries).not.toContain('too late');
    expect(entries).not.toContain('eleven late');
  });

  it('writes a module whose header names the source and whose entries load back', () => {
    const text = blocklistModule(['aaaaaaaaaaaaa', 'quote " and \\ backslash'], { sha256: 'f'.repeat(64), lines: 2 });
    expect(text).toContain(SOURCE.commit);
    expect(text).toContain('f'.repeat(64));
    expect(text).toContain('"quote \\" and \\\\ backslash",');
    expect(text.startsWith('/**\n * GENERATED by packages/accounts/scripts/gen-blocklist.ts')).toBe(true);
  });

  it('refuses a source that does not match the pin; unpinned, it records the source\'s own hash', () => {
    const bytes = new TextEncoder().encode(TEXT);
    expect(() => generate(bytes)).toThrow(/not the pinned/);
    const out = generate(bytes, false);
    expect(out).toContain('"iloveyou1234",');
    expect(out).toMatch(/SHA-256 [0-9a-f]{64}, 16 lines/);
    expect(out).toContain('"minLength":8');
  });
});
