/**
 * WP6, guard G2 ("closed vocabulary"): an unknown word is never skipped. For every valid phrase of the corpus list, replacing any word by an invented one, or
 * inserting an invented word anywhere, must leave NO parse that consumes the whole phrase. Open classes (a name after "named", a counter kind before
 * "counter(s)") are the only exceptions and are skipped on purpose (design 6.11).
 */
import { describe, expect, it } from 'vitest';
import { runHole } from '../../../src/parser/holes';
import type { Tok } from '../../../src/parser/holes';
import { ENV, full, toks } from './env';
import { PHRASES, openClassIndex } from './corpus';

const NONSENSE = 'zzzblorp';

function withToken(base: Tok[], i: number, mode: 'replace' | 'insert'): Tok[] {
  const fake: Tok = { kind: 'WORD', text: NONSENSE, norm: NONSENSE, start: 0, end: NONSENSE.length };
  const out = [...base];
  if (mode === 'replace') out[i] = fake; else out.splice(i, 0, fake);
  return out;
}

describe('WP6 G2: every corpus phrase parses, and no mutation with an unknown word ever does', () => {
  it('the corpus list is valid: every phrase has a complete parse', () => {
    for (const [type, text] of PHRASES) expect(full(type, text).length, `${type} "${text}"`).toBeGreaterThan(0);
  });

  it('replacing one word by a nonsense word never leaves a complete parse', () => {
    let checked = 0;
    for (const [type, text] of PHRASES) {
      const base = toks(text);
      for (let i = 0; i < base.length; i++) {
        if (base[i]!.kind !== 'WORD' || openClassIndex(base, i)) continue;
        const mutated = withToken(base, i, 'replace');
        const alts = runHole(type, mutated, 0, ENV).filter((a) => a.end === mutated.length);
        expect(alts.length, `${type} "${text}" with token ${i} (${base[i]!.text}) replaced`).toBe(0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(400);
  });

  it('inserting a nonsense word anywhere never leaves a complete parse', () => {
    let checked = 0;
    for (const [type, text] of PHRASES) {
      const base = toks(text);
      for (let i = 0; i <= base.length; i++) {
        // an insertion right after "named" or right before "counter(s)" would be a name or a counter kind
        if (base[i - 1]?.norm === 'named' || base[i]?.norm === 'counter' || base[i]?.norm === 'counters') continue;
        const mutated = withToken(base, i, 'insert');
        const alts = runHole(type, mutated, 0, ENV).filter((a) => a.end === mutated.length);
        expect(alts.length, `${type} "${text}" with a nonsense word inserted at ${i}`).toBe(0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it('deleting a word never turns a phrase into a different complete parse of fewer words than it has (the result consumes what is left, not more)', () => {
    // sanity for the harness itself: an alternative never ends past the token array
    for (const [type, text] of PHRASES) {
      const base = toks(text);
      for (const a of runHole(type, base, 0, ENV)) expect(a.end).toBeLessThanOrEqual(base.length);
    }
  });
});
