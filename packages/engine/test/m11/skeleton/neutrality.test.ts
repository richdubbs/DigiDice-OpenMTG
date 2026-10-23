/**
 * M11-0 (docs/design/m11-commander.md 8): the contracts are behavior-neutral outside a Commander game. A normal game has none of the new state fields, its
 * views carry no extra definitions, and a seeded random game plays the same before and after (the M3 soak, run with OPENMTG_SLOW=1, compares its tallies;
 * test/m5/run/replay.test.ts replays the recorded action logs). Here: the shape of the state and of every view along a seeded bot game.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, createGame, viewFor, type GameState } from '../../../src/index';
import { Bot } from '../../m3/bot';
import { simpleConfig } from '../../helpers';

const COMMANDER_KEYS = ['commanders', 'commanderDamage'];

function assertNoCommanderState(s: GameState): void {
  expect(s.options.commander).toBeUndefined();
  for (const p of s.players) for (const k of COMMANDER_KEYS) expect(Object.hasOwn(p, k), `${p.id}.${k}`).toBe(false);
  expect(s.zones.command).toEqual([]);
}

describe('M11-0: behavior-neutral outside a Commander game', () => {
  it('a normal game has no commander state, before and after 300 actions of a seeded random game; its views carry only the definitions they did', () => {
    let s = createGame(simpleConfig('m11-neutral'));
    assertNoCommanderState(s);
    const bot = new Bot('m11-neutral');
    for (let i = 0; i < 300 && s.stage !== 'over' && s.pending; i++) {
      const r = applyAction(s, bot.next(s));
      if (!r.error) s = r.state;
      if (i % 50 === 0) {
        const v = viewFor(s, 'p2');
        const used = new Set([...Object.values(v.objects).map((o) => o.defId), ...Object.values(v.lki).map((l) => l.object.defId)]);
        for (const id of Object.keys(v.defs)) expect(used.has(id) || s.defs[id]!.isToken, id).toBe(true);
      }
    }
    assertNoCommanderState(s);
  });

  it('an empty `commanders` list outside a Commander game builds the same game as none', () => {
    const base = simpleConfig('m11-same');
    const withEmpty = { ...base, players: base.players.map((p) => ({ ...p, commanders: [] })) };
    expect(JSON.stringify(createGame(withEmpty))).toBe(JSON.stringify(createGame(base)));
  });
});
