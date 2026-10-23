/**
 * COV1: coverage by format and by EDHREC popularity (`coverage --by-format`) and the played-weighted work queue (`unmatched --weight played`), offline:
 * synthetic cards with invented names and wordings (design 6.10) and a tiny fake bulk file.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '@openmtg/engine';
import { main, type Io } from '../../src/commands';
import { halvesOf } from '../../src/coverage/corpus';
import type { CardRun } from '../../src/coverage/engine';
import {
  EDHREC_TOPS, PLAYED_EDHREC_TOP, PLAYED_WEIGHTS, REPORT_FORMATS, formatBreakdown, formatBreakdownLines, loadEdhrecRanks, playedWeight, rankedIds, readEdhrecRanks,
  weightedUnmatched,
} from '../../src/coverage/popularity';
import { gameEngine, synthetic } from './support';

function capture(): Io & { lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, out: (l) => lines.push(l), err: (l) => errors.push(l), readStdin: async () => '' };
}

const dir = mkdtempSync(path.join(tmpdir(), 'openmtg-cov1-'));

/** A fake Scryfall bulk file: one JSON object per line, gzip-compressed like oracle-cards.jsonl.gz. */
function fakeBulk(name: string, rows: readonly object[], extraLines: readonly string[] = []): string {
  const file = path.join(dir, name);
  const text = [...rows.map((r) => JSON.stringify(r)), ...extraLines].join('\n');
  writeFileSync(file, name.endsWith('.gz') ? gzipSync(text) : text);
  return file;
}

const legal = (...formats: string[]): Record<string, string> => Object.fromEntries(['standard', 'pioneer', 'modern', 'pauper', 'legacy', 'commander'].map((f) => [f, formats.includes(f) ? 'legal' : 'not_legal']));

/** A run with a fixed level (by-format only reads the card and its level). */
function run(id: string, level: CardRun['level'], legalities?: Record<string, string>): CardRun {
  const card = { name: `Card ${id}`, oracle_id: id, layout: 'normal', type_line: 'Instant', oracle_text: '', ...(legalities ? { legalities } : {}) } as unknown as OracleCard;
  return { card, level, requiresEngine: [], def: null, parse: { faces: [] } as unknown as CardRun['parse'] };
}

describe('COV1 EDHREC ranks from the bulk file', () => {
  it('reads edhrec_rank per oracle id from a .jsonl.gz file, skipping unranked cards and lines that do not parse; a duplicate keeps its best rank', async () => {
    const file = fakeBulk('ranks.jsonl.gz', [
      { oracle_id: 'a', name: 'A', edhrec_rank: 5 }, { oracle_id: 'b', name: 'B' }, { oracle_id: 'c', name: 'C', edhrec_rank: 2 }, { oracle_id: 'a', name: 'A2', edhrec_rank: 3 },
    ], ['not json', '']);
    const ranks = await readEdhrecRanks(file);
    expect([...ranks]).toEqual([['a', 3], ['c', 2]]);
    expect(rankedIds(ranks)).toEqual(['c', 'a']);
  });
  it('reads a plain JSON array bulk file too (lines with a trailing comma)', async () => {
    const file = path.join(dir, 'ranks.json');
    writeFileSync(file, `[\n${JSON.stringify({ oracle_id: 'x', edhrec_rank: 1 })},\n${JSON.stringify({ oracle_id: 'y', edhrec_rank: 9 })}\n]\n`);
    expect([...(await readEdhrecRanks(file))]).toEqual([['x', 1], ['y', 9]]);
  });
  it('a missing bulk file is reported, never an error', async () => {
    const r = await loadEdhrecRanks(path.join(dir, 'nope.jsonl.gz'));
    expect(r.ranks).toBeNull();
    expect(r.problem).toMatch(/no bulk file/);
  });
});

describe('COV1 coverage by format and popularity', () => {
  const runs = [
    run('a', 'full', legal('standard', 'pioneer', 'modern', 'legacy', 'commander')),
    run('b', 'partial', legal('modern', 'legacy', 'commander')),
    run('c', 'manual', { ...legal('legacy', 'commander'), legacy: 'restricted' }),
    run('d', 'full', { ...legal('pauper'), commander: 'banned' }),
    run('e', 'manual'),
  ];
  it('counts a card in a format when it is legal or restricted there (banned and not_legal are out; no legalities is in no format)', () => {
    const b = formatBreakdown(runs, null);
    expect(b.whole).toEqual({ label: 'whole corpus', cards: 5, full: 2, partial: 1, manual: 2 });
    expect(b.formats.map((t) => t.label)).toEqual([...REPORT_FORMATS]);
    const by = Object.fromEntries(b.formats.map((t) => [t.label, t]));
    expect(by.standard).toMatchObject({ cards: 1, full: 1 });
    expect(by.modern).toMatchObject({ cards: 2, full: 1, partial: 1 });
    expect(by.legacy).toMatchObject({ cards: 3, full: 1, partial: 1, manual: 1 });
    expect(by.pauper).toMatchObject({ cards: 1, full: 1 });
    expect(by.commander).toMatchObject({ cards: 3, full: 1, partial: 1, manual: 1 });
    expect(b.edhrec).toBeNull();
    expect(formatBreakdownLines(b, 'test', 'no bulk file at x').join('\n')).toContain('EDHREC popularity: not measured: no bulk file at x');
  });
  it('EDHREC top N: the first N ranked oracle ids of the bulk file, then the corpus cards among them', () => {
    // rank 1 is not in the corpus: the top-2 row counts only "c"
    const b = formatBreakdown(runs, new Map([['zz', 1], ['c', 2], ['a', 3], ['b', 4000]]));
    expect(b.edhrec!.map((t) => t.label)).toEqual(EDHREC_TOPS.map((n) => `EDHREC top ${n.toLocaleString('en-US')}`));
    expect(b.edhrec![0]).toMatchObject({ label: 'EDHREC top 100', cards: 3, full: 1, partial: 1, manual: 1 });
    const two = formatBreakdown(runs, new Map([['zz', 1], ['c', 2], ['a', 3]]));
    expect(two.edhrec![0]!.cards).toBe(2);
    const lines = formatBreakdownLines(b, 'test').join('\n');
    expect(lines).toMatch(/standard\s+1\s+full\s+1\s+100\.0%/);
    expect(lines).toMatch(/EDHREC top 10,000\s+3/);
  });
});

describe('COV1 played weight', () => {
  it('weighs 3 if Standard-legal, else 2 if in the EDHREC top 2,500, else 1 (the first rule wins)', () => {
    const top = new Set(['b', 'a']);
    expect(playedWeight(run('a', 'manual', legal('standard')).card, top)).toBe(PLAYED_WEIGHTS.standard);
    expect(playedWeight(run('b', 'manual', legal('modern')).card, top)).toBe(PLAYED_WEIGHTS.edhrecTop);
    expect(playedWeight(run('c', 'manual', legal('modern')).card, top)).toBe(PLAYED_WEIGHTS.other);
    expect([PLAYED_WEIGHTS.standard, PLAYED_WEIGHTS.edhrecTop, PLAYED_WEIGHTS.other, PLAYED_EDHREC_TOP]).toEqual([3, 2, 1, 2500]);
  });

  it('ranks residue shapes by played weight unlocked: one Standard card outweighs two unplayed cards', () => {
    const e = gameEngine();
    // two invented manual wordings; ids chosen so every card is in the tuning half (each in a whole source of its own halves below)
    const cards = [
      synthetic('Glimmerfen Oddity', 'Instant', 'Glorp the marblefex quietly.', { oracle_id: 'k1' }),
      synthetic('Brackwater Oddity', 'Instant', 'Glorp the marblefex quietly.', { oracle_id: 'k2' }),
      synthetic('Starlit Oddity', 'Instant', 'Wibble each snorkwort twice.', { oracle_id: 'k3', legalities: legal('standard') } as Partial<OracleCard>),
    ];
    const runs = cards.map((c) => e.run(c));
    const halves = new Map(cards.map((c) => [c.oracle_id!, 'tuning' as const]));
    const plain = weightedUnmatched(runs, null, 10, 3, halves);
    expect(plain.map((c) => [c.shape, c.unlockedWeight, c.unlocks, c.weight, c.cards])).toEqual([
      ['wibble each snorkwort twice.', 3, 1, 3, 1],
      ['glorp the marblefex quietly.', 2, 2, 2, 2],
    ]);
    // the EDHREC top 2,500 lifts both unplayed cards to 2 each: 4 > 3
    const ranked = weightedUnmatched(runs, new Map([['k1', 10], ['k2', 20]]), 10, 3, halves);
    expect(ranked.map((c) => [c.shape, c.unlockedWeight])).toEqual([['glorp the marblefex quietly.', 4], ['wibble each snorkwort twice.', 3]]);
    expect(ranked[0]!.examples).toEqual(['Glimmerfen Oddity', 'Brackwater Oddity']);
    // the held-out half is never in the work queue (design 6.12)
    expect(weightedUnmatched(runs, null, 10, 3, halvesOf(cards)).map((c) => c.cards).reduce((x, y) => x + y, 0)).toBeLessThan(3);
  });
});

describe('COV1 CLI on the fixture set (offline, fake bulk file)', () => {
  it('coverage --by-format prints the whole set, every format row and the EDHREC rows; --json writes the breakdown', async () => {
    const bulk = fakeBulk('fixture-ranks.jsonl.gz', [{ oracle_id: '1c385880-3eea-45c8-8e89-330ad8ad92b1', name: 'Aardvark Sloth', edhrec_rank: 1 }]);
    const json = path.join(dir, 'by-format.json');
    const io = capture();
    expect(await main(['coverage', '--fixtures', '--by-format', '--bulk', bulk, '--json', json], io)).toBe(0);
    const text = io.lines.join('\n');
    expect(text).toContain('Coverage by format and popularity (the fixture set)');
    for (const f of REPORT_FORMATS) expect(text).toMatch(new RegExp(`^  ${f}\\s+0 `, 'm')); // fixture cards carry no legalities
    expect(text).toMatch(/EDHREC top 100\s+1\s+full\s+1\s+100\.0%/);
    expect(text).not.toContain('Template mining');
    const written = JSON.parse(readFileSync(json, 'utf8')) as { whole: { cards: number }; formats: unknown[]; edhrec: { cards: number }[] };
    expect(written.formats).toHaveLength(REPORT_FORMATS.length);
    expect(written.edhrec[0]!.cards).toBe(1);
    expect(written.whole.cards).toBeGreaterThan(100);
  }, 60_000);
  it('unmatched --weight played prints the weighting and the ranked shapes; another weighting is refused', async () => {
    const io = capture();
    expect(await main(['unmatched', '--fixtures', '--weight', 'played', '--bulk', path.join(dir, 'missing.jsonl.gz'), '--top', '5'], io)).toBe(0);
    expect(io.lines.join('\n')).toContain('a card weighs 3 if Standard-legal, 2 if in the EDHREC top 2,500, else 1 (no EDHREC ranks');
    expect(io.lines.some((l) => /^\s+1\. played\s+\d+ \(unlocks/.test(l))).toBe(true);
    expect(io.errors.join('\n')).toContain('EDHREC ranks not available');
    const bad = capture();
    expect(await main(['unmatched', '--fixtures', '--weight', 'price'], bad)).toBe(2);
  }, 60_000);
});
