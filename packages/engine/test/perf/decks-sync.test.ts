/**
 * Package P1 (engine performance): test/perf/decks.ts copies the decks and game setup of the M3 soak (test/m3/soak.test.ts) and the M4 real games
 * (test/m4/realgame.test.ts), because those milestone tests are not edited and importing a test file would run its tests. Every P1 measurement and the
 * verify-mode scope test (cache-p1.test.ts) rely on the copies playing the very games those tests play, so this test reads the originals as text and checks
 * that the copies still say the same thing (full-line comments and whitespace aside).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SOAK_ACTIONS, SOAK_CONVERSE_EVERY, SOAK_GAMES } from './decks';

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const SOAK = read('../m3/soak.test.ts');
const REAL = read('../m4/realgame.test.ts');
const DECKS = read('./decks.ts');
const HARNESS = read('./harness.ts');

/** The text from the line starting with `start` to the first following line starting with `end`, without full-line comments and whitespace. */
function block(text: string, start: string, end: string): string {
  const lines = text.split(/\r?\n/);
  const from = lines.findIndex((l) => l.startsWith(start));
  expect(from, `no line starts with ${start}`).toBeGreaterThanOrEqual(0);
  const to = lines.findIndex((l, i) => i > from && l.startsWith(end));
  expect(to, `no ${end} after ${start}`).toBeGreaterThan(from);
  return lines.slice(from + 1, to + 1).filter((l) => !l.trim().startsWith('//')).join('').replace(/\s+/g, '');
}

const constant = (text: string, name: string): string | undefined => new RegExp(`^(?:export )?const ${name} = (.+);$`, 'm').exec(text)?.[1];

describe('P1 test/perf/decks.ts: the copied decks and setup are the ones the M3 soak and M4 real games play', () => {
  it('the soak: card list, synthetic cards, game count and length, seeds, full control on even games, converse cadence', () => {
    expect(block(DECKS, 'const SOAK_NAMES', '];')).toBe(block(SOAK, 'const NAMES', '];'));
    expect(block(DECKS, 'function soakSynthetic', '}')).toBe(block(SOAK, 'function synthetic', '}'));
    expect(block(DECKS, 'function soakDeck', '}').replace(/SOAK_NAMES/g, 'NAMES')).toBe(block(SOAK, 'function deck', '}'));
    expect(constant(DECKS, 'SYNTH_NAMES')).toBe(constant(SOAK, 'SYNTH_NAMES'));
    // FAST2 MRE: the soak pins the stops it was calibrated with (not DEFAULT_STOPS).
    const stops = (text: string): string | undefined => /^const SOAK_STOPS: Omit<StopSettings, 'fullControl'> = (.+);$/m.exec(text)?.[1];
    expect(stops(SOAK)).toBeDefined();
    expect(stops(DECKS)).toBe(stops(SOAK));
    expect(String(SOAK_GAMES)).toBe(constant(SOAK, 'GAMES'));
    expect(String(SOAK_ACTIONS)).toBe(constant(SOAK, 'ACTIONS'));
    expect(String(SOAK_CONVERSE_EVERY)).toBe(constant(SOAK, 'CONVERSE_EVERY'));
    expect(constant(SOAK, 'VALIDATE_EVERY')).toBe('1'); // the harness applies every listed action at every priority
    expect(HARNESS).toContain('priorities % SOAK_CONVERSE_EVERY === 1');
    expect(SOAK).toContain('priorities % CONVERSE_EVERY === 1');
    for (const text of [SOAK, DECKS]) {
      expect(text).toContain('const fullControl = index % 2 === 0;');
      expect(text).toContain('soak-${index}');
      expect(text).toContain("{ name: 'Alice', deck: d, stops: { ...SOAK_STOPS, fullControl } }");
      expect(text).toContain("{ name: 'Bob', deck: d, stops: { ...SOAK_STOPS, fullControl } }");
      expect(text).toMatch(/\.\.\.compiledDefs\(\[\.\.\.new Set\((SOAK_)?NAMES\.map\(\(\[n\]\) => n\)\)\]\), \.\.\.(soakS|s)ynthetic\(\)/);
    }
  });

  it('the M4 real games: both decks, the players and the options', () => {
    for (const deck of ['DECK_A', 'DECK_B']) expect(constant(DECKS, deck), deck).toBe(constant(REAL, deck));
    const realConfig = DECKS.slice(DECKS.indexOf('export function realConfig'));
    for (const field of ['players:', 'defs:', 'options:']) {
      const line = (text: string): string | undefined => text.split(/\r?\n/).find((l) => l.trim().startsWith(field))?.trim();
      expect(line(realConfig), field).toBe(line(REAL));
    }
    expect(REAL).toContain('m4-real-${i}');
    expect(DECKS).toContain('m4-real-${index}');
  });
});
