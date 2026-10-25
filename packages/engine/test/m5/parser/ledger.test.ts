/**
 * WP5, the character ledger (design 6.2 step 7, guard G4): every non-space character of the normalized text is in exactly one entry. Unit tests of the helpers,
 * tiling over every fixture card, and over the whole local Oracle index when the cache exists.
 */
import { describe, expect, it } from 'vitest';
import type { LedgerEntry } from '../../../src/index';
import { completeLedger, ledgerProblems, markLedger } from '../../../src/parser/preprocess';
import type { AbilitySegment, SegmentedFace } from '../../../src/parser/segment';
import { tokenize, type Token } from '../../../src/parser/tokenize';
import { loadFixtureCards } from '../../fixtures';
import { SLOW, slowTitle } from '../../slow';
import { faceContexts, localIndex, segment } from './support';

const text = 'Flying (reminder)\nWhen it dies, draw.';

describe('ledgerProblems', () => {
  it('reports a gap: a non-space character no entry covers', () => {
    const ledger: LedgerEntry[] = [{ range: [0, 6], status: 'manual' }];
    expect(ledgerProblems(text, ledger).some((p) => p.startsWith('uncovered character'))).toBe(true);
  });

  it('reports an overlap and a range outside the text', () => {
    expect(ledgerProblems('abc', [{ range: [0, 2], status: 'manual' }, { range: [1, 3], status: 'manual' }])).toEqual(['overlap at 1']);
    expect(ledgerProblems('abc', [{ range: [0, 9], status: 'manual' }])[0]).toMatch(/bad range/);
  });

  it('spaces and line breaks need no entry', () => {
    expect(ledgerProblems('a b\nc', [{ range: [0, 1], status: 'manual' }, { range: [2, 3], status: 'manual' }, { range: [4, 5], status: 'manual' }])).toEqual([]);
  });
});

describe('completeLedger', () => {
  it('fills every gap with a manual entry, one per line, trimmed', () => {
    const ledger = completeLedger(text, [{ range: [7, 17], status: 'reminder' }]);
    expect(ledgerProblems(text, ledger)).toEqual([]);
    expect(ledger.map((e) => [e.status, text.slice(...e.range)])).toEqual([
      ['manual', 'Flying'],
      ['reminder', '(reminder)'],
      ['manual', 'When it dies, draw.'],
    ]);
    expect(ledger[0]!.reason).toBe('not parsed');
  });

  it('keeps what it is given (any order) and refuses overlapping claims', () => {
    const a: LedgerEntry = { range: [0, 6], status: 'consumed', by: 'kw.flying' };
    const b: LedgerEntry = { range: [7, 17], status: 'reminder' };
    expect(completeLedger(text, [b, a]).map((e) => e.status)).toEqual(['consumed', 'reminder', 'manual']);
    expect(() => completeLedger(text, [a, { range: [3, 9], status: 'manual' }])).toThrow(/overlap/);
  });

  it('an empty text has an empty ledger', () => {
    expect(completeLedger('', [])).toEqual([]);
    expect(completeLedger(' \n ', [])).toEqual([]);
  });
});

describe('markLedger (how later packages move a span to consumed)', () => {
  const base = completeLedger(text, [{ range: [7, 17], status: 'reminder' }]);

  it('a range inside an entry splits it', () => {
    const l = markLedger(text, base, [18, 22], 'consumed', 'trg.when', undefined);
    expect(ledgerProblems(text, l)).toEqual([]);
    expect(l.map((e) => [e.status, text.slice(...e.range)])).toEqual([
      ['manual', 'Flying'],
      ['reminder', '(reminder)'],
      ['consumed', 'When'],
      ['manual', 'it dies, draw.'],
    ]);
    expect(l[2]!.by).toBe('trg.when');
  });

  it('a range that covers several entries replaces them', () => {
    const l = markLedger(text, base, [0, text.length], 'manual', undefined, 'whole ability');
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ status: 'manual', reason: 'whole ability', range: [0, text.length] });
  });
});

describe('the front end tiles every fixture card, face by face', () => {
  const cards = Object.values(loadFixtureCards());
  it('ledger complete for all fixture cards', () => {
    let faces = 0;
    for (const card of cards) {
      for (const ctx of faceContexts(card)) {
        faces++;
        const f = segment(ctx);
        expect(ledgerProblems(f.pre.normalized, f.ledger), ctx.name).toEqual([]);
      }
    }
    expect(faces).toBeGreaterThan(200);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The whole local index
// ---------------------------------------------------------------------------------------------------------------------------------

// QT: a slow suite (npm run test:all); the index is read only when the suite runs.
const index = SLOW ? localIndex() : null;
const allTokens = (ts: readonly Token[]): Token[] => ts.flatMap((t) => [t, ...allTokens(t.sub ?? [])]);

function* walk(a: AbilitySegment): Generator<AbilitySegment> {
  yield a;
  for (const c of a.children ?? []) yield* walk(c);
}

describe.skipIf(!SLOW || !index)(slowTitle('the whole local Oracle index (corpus test; skipped when .cache/ is absent)'), () => {
  const names = new Set((index ?? []).map((c) => c.name));
  const results: SegmentedFace[] = [];
  const failures: string[] = [];

  it('every face of every card segments without throwing, with a complete ledger (G4: 100%)', () => {
    for (const card of index!) {
      for (const ctx of faceContexts(card)) {
        let f: SegmentedFace;
        try {
          f = segment(ctx, { cardNames: names });
        } catch (e) {
          failures.push(`${ctx.name}: threw ${(e as Error).message}`);
          continue;
        }
        const problems = ledgerProblems(f.pre.normalized, f.ledger);
        if (problems.length > 0) failures.push(`${ctx.name}: ${problems[0]}`);
        results.push(f);
      }
    }
    expect(failures.slice(0, 5)).toEqual([]);
    expect(results.length).toBeGreaterThan(30000);
  }, 120_000);

  it('reminder text never reaches a token', () => {
    let leaks = 0;
    for (const f of results) {
      const reminders = f.pre.reminders.map((r) => r.range);
      for (const a of f.abilities) {
        for (const seg of walk(a)) {
          const sentenceTokens = [...seg.sentences, ...(seg.modal?.modes ?? []).flatMap((m) => m.sentences), ...(seg.rollTable ?? []).flatMap((r) => r.sentences)].flatMap((s) => s.tokens);
          for (const t of allTokens(sentenceTokens)) if (t.kind !== 'QUOTE' && reminders.some((r) => t.range[0] < r[1] && t.range[1] > r[0])) leaks++;
        }
      }
    }
    expect(leaks).toBe(0);
  });

  it('tokens lie inside their ability, in order, and their text is the parse text they cover', () => {
    let bad = 0;
    for (const f of results) {
      for (const a of f.abilities) {
        for (const seg of walk(a)) {
          for (const s of seg.sentences) {
            let at = s.range[0];
            for (const t of s.tokens) {
              if (t.range[0] < at || t.range[1] > f.pre.normalized.length || t.text !== f.pre.parse.slice(...t.range)) bad++;
              at = t.range[1];
            }
          }
        }
      }
    }
    expect(bad).toBe(0);
  });

  it('every line with text belongs to exactly one ability', () => {
    let bad = 0;
    for (const f of results) {
      const owner = new Map<number, number>();
      for (const a of f.abilities) for (const line of a.lines) owner.set(line, (owner.get(line) ?? 0) + 1);
      for (const l of f.pre.lines) {
        if (l.blank || l.reminderOnly) continue;
        if (owner.get(l.index) !== 1) bad++;
      }
    }
    expect(bad).toBe(0);
  });

  it('shapes are plausible over the corpus (a regression guard for the decision list)', () => {
    const count = new Map<string, number>();
    for (const f of results) for (const a of f.abilities) for (const s of walk(a)) count.set(s.shape, (count.get(s.shape) ?? 0) + 1);
    const n = (s: string): number => count.get(s) ?? 0;
    expect(n('keyword')).toBeGreaterThan(12000);
    expect(n('triggered')).toBeGreaterThan(14000);
    expect(n('activated')).toBeGreaterThan(8000);
    expect(n('spell')).toBeGreaterThan(6500);
    expect(n('loyalty')).toBeGreaterThan(900);
    expect(n('chapter')).toBeGreaterThan(550);
    expect(n('classLevel')).toBeGreaterThan(90);
    expect(n('levelBracket')).toBeGreaterThan(40);
    expect(n('unknown')).toBeLessThanOrEqual(3);
  });

  it('unmatched quotes are a handful (nested double quotes), not a systematic loss', () => {
    let unmatched = 0;
    for (const f of results) for (const d of f.diagnostics) if (d.message === 'unmatched quote') unmatched++;
    expect(unmatched).toBeLessThanOrEqual(5);
  });

  it('labels: abilities words are recognised; no label is rules text (no game words in a flavor word)', () => {
    let abilityWords = 0;
    for (const f of results) {
      for (const l of f.pre.lines) {
        if (!l.label) continue;
        if (l.label.kind === 'ability-word') abilityWords++;
        // merge wave 6: r4-mech reads a title-case flavor word that ends in "!" or "?" as a label (CR 207.2d: no rules meaning), and Oracle prints one
        // with a game word, The Unbeatable Squirrel Girl's "Do You Like Squirrels?"; every word of such a label is capitalized, so it is never a sentence
        // trek-2: so does a flavor word of two or more words in title case ("Shaka, When the Walls Fell", "Make Them Pay"); its game words are capitalized,
        // which rules text never does after its first word
        else if (!/^(?:[A-Z][\w'-]*\s+)*[A-Z][\w'-]*[!?]$/.test(l.label.text) && !/^[A-Z][\w'-]*,?(?:\s+(?:[A-Z][\w'-]*|a|an|the|of|to|in|on|for|and|with|up|at|by),?)+$/.test(l.label.text)) {
          expect(l.label.text, f.pre.context.name).not.toMatch(/\b(each|you|when|whenever|target|opponent)\b/i);
        }
      }
    }
    expect(abilityWords).toBeGreaterThan(1200);
  });
});

describe('tokenize is total on real text', () => {
  it('a sample of tokens covers every non-space character exactly once', () => {
    const cards = Object.values(loadFixtureCards());
    for (const card of cards) {
      for (const ctx of faceContexts(card)) {
        const f = segment(ctx);
        // blanked reminders and "~" paddings are spaces in the parse text; everything else must be inside a token
        for (const l of f.pre.lines) {
          if (l.blank || l.reminderOnly) continue;
          const toks = tokenize(f.pre.parse, { from: l.range[0], to: l.range[1] });
          const covered = new Uint8Array(f.pre.parse.length);
          for (const t of toks) for (let i = t.range[0]; i < t.range[1]; i++) covered[i]!++;
          for (let i = l.range[0]; i < l.range[1]; i++) {
            if (f.pre.parse[i] !== ' ') expect(covered[i], `${ctx.name} char ${i}`).toBe(1);
          }
        }
      }
    }
  });
});
