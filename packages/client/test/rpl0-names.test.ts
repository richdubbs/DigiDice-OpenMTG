/**
 * RPL-0 review (replays design 4): a replay refuses shown text with control characters (a terminal escape, a bidirectional override), and a text input
 * keeps a pasted tab or U+202E (HTML strips only line breaks). So a local game's player names are cleaned as an online guest's are (engine
 * util/shown-text.ts, packages/net's rule), and a replay of the game records names its own import accepts.
 */
import { compileCard, hasControl, type CardDef } from '@openmtg/engine';
import { describe, expect, it } from 'vitest';
import { buildGameConfig, DEFAULT_START, playerName } from '../src/game/config';

const forest = compileCard({ name: 'Forest', layout: 'normal', type_line: 'Basic Land — Forest', oracle_text: '' });
const DEFS: Record<string, CardDef> = { Forest: forest };
const deck = { main: [{ name: 'Forest', count: 40 }], sideboard: [] };
const STOPS = { ownTurn: [], opponentTurn: [], fullControl: false };

describe('RPL-0 review: local player names carry no control characters', () => {
  it('playerName removes control characters and bidirectional overrides, then trims', () => {
    expect(playerName('  Ann\tLee ')).toBe('AnnLee');
    expect(playerName('Bob‮txt.exe')).toBe('Bobtxt.exe');
    expect(playerName('\u001b[2JCarl')).toBe('[2JCarl');
    expect(playerName('Dana')).toBe('Dana');
  });

  it('the game config gets the cleaned names', () => {
    const config = buildGameConfig({
      players: [{ name: 'Ann‮', deck }, { name: ' Bob\t', deck }], defs: DEFS, seed: 's', start: { ...DEFAULT_START, firstPlayer: 0 }, stops: STOPS,
    });
    expect(config.players.map((p) => p.name)).toEqual(['Ann', 'Bob']);
    for (const p of config.players) expect(hasControl(p.name)).toBe(false);
  });
});
