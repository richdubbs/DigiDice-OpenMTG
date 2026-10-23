/**
 * M12-1 (docs/design/m12-multiplayer.md D16, 4): the contracts are behavior-neutral in a two-player game. A two-player state, its views, its decisions and
 * its events carry none of the new fields along a seeded random game. The other neutrality gates of D16: the M3 soak with OPENMTG_SLOW=1 (identical
 * tallies), the replay tests (test/m1/replay.test.ts, test/m5/run/replay.test.ts), the fixture gate (0 up, 0 down, 0 changed units for the existing cards)
 * and the two-player AI-against-AI action logs (packages/ai/test/neutrality/two-player-logs.test.ts, byte-identical to the base).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, createGame, isMultiplayer, viewFor, type GameEvent, type GameState } from '../../../src/index';
import { Bot } from '../../m3/bot';
import { simpleConfig } from '../../helpers';
import { mainPhaseGame } from './helpers';

function assertTwoPlayerShape(s: GameState): void {
  expect(Object.hasOwn(s.options, 'multiplayer')).toBe(false);
  expect(isMultiplayer(s)).toBe(false);
  for (const p of s.players) expect(Object.hasOwn(p, 'left'), `${p.id}.left`).toBe(false);
  for (const o of Object.values(s.objects)) expect(Object.hasOwn(o, 'goaded'), `${o.id}.goaded`).toBe(false);
  if (s.pending) expect(Object.hasOwn(s.pending, 'asker')).toBe(false);
}

describe('M12-1: behavior-neutral in a two-player game (m12 design D16)', () => {
  it('a seeded random two-player game: no multiplayer option, no left, no goaded, no asker, no playerLeft event, in the state and in every view', () => {
    let s = createGame(simpleConfig('m12-neutral'));
    assertTwoPlayerShape(s);
    const bot = new Bot('m12-neutral');
    const events: GameEvent[] = [];
    for (let i = 0; i < 400 && s.stage !== 'over' && s.pending; i++) {
      const r = applyAction(s, bot.next(s));
      if (r.error) continue;
      s = r.state;
      events.push(...r.events);
      assertTwoPlayerShape(s);
      if (i % 40 === 0) for (const p of ['p1', 'p2']) {
        const v = viewFor(s, p);
        expect(Object.hasOwn(v.options ?? {}, 'multiplayer')).toBe(false);
        if (v.pending) expect(Object.hasOwn(v.pending, 'asker')).toBe(false);
      }
    }
    expect(events.length).toBeGreaterThan(100);
    expect(events.filter((e) => e.type === 'playerLeft')).toEqual([]);
  });

  it('a two-player game that ends: the loser has lost but not left (CR 104.2a: the game is over, nothing leaves)', () => {
    const r = applyAction(mainPhaseGame(2), { type: 'concede', player: 'p2' });
    expect(r.state.result?.winner).toBe('p1');
    expect(r.events.some((e) => e.type === 'playerLeft')).toBe(false);
    assertTwoPlayerShape(r.state);
  });

  it('CR 103.8a still holds for two players: the starting player skips the draw of their first turn', () => {
    const s = mainPhaseGame(2);
    expect(s.zones.hand['p1']).toHaveLength(7);
    expect(s.players.find((p) => p.id === 'p1')!.turnStats.cardsDrawn).toBe(0);
  });
});
