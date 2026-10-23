/**
 * Whole games with real fixture decks (test/decks.ts): the AI against a random legal-move bot, and the AI against itself. Every game is played through
 * `applyAction`; the AI only ever sees `viewFor(state, itsPlayer)`.
 */
import { beforeAll, expect, it } from 'vitest';
import { replay } from '@openmtg/engine';
import { describeSlow } from '../../engine/test/slow';
import { DECKS, gameConfig } from './decks';
import { aiAgent, playGame, randomAgent, type Played } from './harness';

const pct = (xs: number[], p: number): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]!;

// QT: 70 whole games; slow suites (npm run test:all). The games are played in beforeAll, so a skipped run plays none (Vitest runs a skipped describe's
// body to list its tests). The AI's single decisions are tested in decisions.test.ts and scenarios.test.ts in the default suite.
describeSlow('the AI against a random legal-move bot (50 games)', () => {
  const timings: number[] = [];
  const results: { ai: string; g: Played }[] = [];
  beforeAll(() => {
    for (let i = 0; i < 50; i++) {
      const ai = i % 2 === 0 ? 'p1' : 'p2';
      const cfg = gameConfig(`ai-vs-random-${i}`, DECKS[i % 3]!, DECKS[(i + 1 + Math.floor(i / 3)) % 3]!);
      const agents = { [ai]: aiAgent(`ai-${i}`, timings), [ai === 'p1' ? 'p2' : 'p1']: randomAgent(`random-${i}`) };
      results.push({ ai, g: playGame(cfg, agents) });
    }
  }, 600_000);

  it('every game ends, the engine accepts every AI action, and the AI wins most games', () => {
    const wins = results.filter((r) => r.g.state.result?.winner === r.ai).length;
    console.log(`AI1 win rate against the random bot: ${wins}/${results.length} (${Math.round((wins * 100) / results.length)}%)`);
    for (const r of results) {
      expect(r.g.finished).toBe(true);
      expect(r.g.rejected.filter((x) => x.player === r.ai)).toEqual([]);
    }
    expect(wins / results.length).toBeGreaterThanOrEqual(0.8);
  });

  it('decides quickly: every decision (chooseAction alone) under 200 ms', () => {
    const max = Math.max(...timings);
    console.log(`AI1 decision time over ${timings.length} decisions: median ${pct(timings, 0.5).toFixed(1)} ms, p99 ${pct(timings, 0.99).toFixed(1)} ms, max ${max.toFixed(1)} ms`);
    expect(timings.length).toBeGreaterThan(1000);
    expect(max).toBeLessThan(200);
    expect(pct(timings, 0.5)).toBeLessThan(50);
  });
});

describeSlow('the AI against itself (20 games)', () => {
  const configs = Array.from({ length: 20 }, (_, i) => gameConfig(`ai-vs-ai-${i}`, DECKS[i % 3]!, DECKS[(i + 1 + Math.floor(i / 3)) % 3]!));
  const play = (i: number): Played => playGame(configs[i]!, { p1: aiAgent(`one-${i}`), p2: aiAgent(`two-${i}`) });
  const games: Played[] = [];
  beforeAll(() => {
    games.push(...configs.map((_, i) => play(i)));
  }, 600_000);

  it('every game finishes without errors', () => {
    for (const [i, g] of games.entries()) {
      expect(g.rejected, `game ${i}`).toEqual([]);
      expect(g.finished, `game ${i} finished`).toBe(true);
    }
    const turns = games.map((g) => g.state.turn.number);
    console.log(`AI1 bot-vs-bot: ${games.length} games, turns ${Math.min(...turns)}-${Math.max(...turns)}, p1 won ${games.filter((g) => g.state.result?.winner === 'p1').length}`);
  });

  it('replaying the action log of each game reproduces its final state exactly', { timeout: 300_000 }, () => {
    for (const [i, g] of games.entries()) {
      const r = replay(configs[i]!, g.actions);
      expect(r.errors, `game ${i}`).toEqual([]);
      expect(JSON.stringify(r.state)).toBe(JSON.stringify(g.state));
    }
  });

  it('is deterministic given its seeds: the same game is played again action for action', { timeout: 300_000 }, () => {
    for (const i of [0, 7, 13]) expect(JSON.stringify(play(i).actions)).toBe(JSON.stringify(games[i]!.actions));
  });
});
