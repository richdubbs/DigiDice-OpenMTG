/**
 * M12-1 (docs/design/m12-multiplayer.md D1, D4, D10, 4.1-4.2): the multiplayer game configuration, the starting life of the multiplayer Commander variants,
 * the draw of the starting player's first turn, and the pure readers of core/multiplayer.ts. Leaving the game, priority with leavers and the free mulligan
 * are M12-2's (test/m12/rules/*; M12-2 deleted the M12-1 pin test/m12/skeleton/absent-m12-2.test.ts that said they had not arrived yet).
 */
import { describe, expect, it } from 'vitest';
import {
  COMMANDER_VARIANTS, ConfigError, MAX_PLAYERS, commanderOptions, compileCard, createGame, isMultiplayer, placements, playersInGame, seatNeighbor,
  type CardDef, type CommanderVariant, type GameConfig, type GameState, type MultiplayerOptions,
} from '../../../src/index';
import { cloneState } from '../../../src/util/clone';
import { act } from '../../helpers';
import { FREE_FOR_ALL, mainPhaseGame, playersConfig } from './helpers';

const LEGEND: CardDef = {
  ...compileCard({ name: 'Test Legend', layout: 'normal', mana_cost: '{2}{G}', type_line: 'Legendary Creature — Elf', power: '2', toughness: '2', oracle_text: '' }),
  colorIdentity: ['G'],
};

/** An `n`-player Commander game of `variant`, every player with Test Legend as their commander. */
function commanderConfig(n: number, variant: CommanderVariant, extra: Partial<GameConfig['options']> = {}): GameConfig {
  const base = playersConfig(n, 'm12-commander');
  return {
    ...base,
    defs: [...(base.defs as CardDef[]), LEGEND],
    players: base.players.map((p) => ({ ...p, commanders: [LEGEND.id] })),
    options: { ...base.options, startingPlayer: 'p1', skipMulligans: true, commander: commanderOptions(variant), ...extra },
  };
}

const lives = (s: GameState): number[] => s.players.map((p) => p.life);
const lose = (s: GameState, ids: string[], reason = 'test'): GameState => {
  const t = cloneState(s);
  for (const p of t.players) if (ids.includes(p.id)) { p.hasLost = true; p.lostReason = reason; }
  return t;
};

describe('M12-1: the game configuration (CR 800.1, 806; m12 design D1, D4)', () => {
  it('MAX_PLAYERS is 4; a game begins with two players, or with 3-4 players and options.multiplayer', () => {
    expect(MAX_PLAYERS).toBe(4);
    expect(createGame(playersConfig(2)).players).toHaveLength(2);
    for (const n of [3, 4]) {
      const s = createGame(playersConfig(n));
      expect(s.players.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4'].slice(0, n));
      expect(s.options.multiplayer).toEqual(FREE_FOR_ALL);
      expect(isMultiplayer(s)).toBe(true);
    }
    expect(isMultiplayer(createGame(playersConfig(2)))).toBe(false);
  });

  it('CR 800.1: refused with 1 or 5 players, with options.multiplayer and two players, and with 3-4 players without it', () => {
    expect(() => createGame(playersConfig(1))).toThrow(ConfigError);
    expect(() => createGame(playersConfig(5))).toThrow(/2 to 4 players/);
    expect(() => createGame({ ...playersConfig(2), options: { multiplayer: FREE_FOR_ALL } })).toThrow(/not a multiplayer game/);
    expect(() => createGame({ ...playersConfig(3), options: {} })).toThrow(/needs options.multiplayer/);
    expect(() => createGame({ ...playersConfig(4), options: {} })).toThrow(ConfigError);
  });

  it('CR 806.2a-b, 802, 803: only Free-for-All with the attack multiple players option (no attack left / right)', () => {
    const bad = (mp: unknown) => () => createGame({ ...playersConfig(3), options: { multiplayer: mp as MultiplayerOptions } });
    expect(bad({ variant: 'twoHeadedGiant', attack: 'multiple' })).toThrow(/Unsupported multiplayer variant/);
    expect(bad({ variant: 'freeForAll', attack: 'left' })).toThrow(/Unsupported attack option/);
    expect(bad({ variant: 'freeForAll', attack: 'right' })).toThrow(ConfigError);
  });

  it('a multiplayer game outside Commander starts at 20 life (CR 103.4), or the life the config gives', () => {
    expect(lives(createGame(playersConfig(4)))).toEqual([20, 20, 20, 20]);
    expect(lives(createGame({ ...playersConfig(3), options: { multiplayer: FREE_FOR_ALL, startingLife: 25 } }))).toEqual([25, 25, 25]);
  });
});

describe('M12-1: multiplayer Commander, Brawl and Standard Brawl (CR 903.7, 903.12f)', () => {
  it('COMMANDER_VARIANTS[v].multiplayerLife: Commander 40, Brawl and Standard Brawl 30, Duel Commander none (two players only)', () => {
    expect(Object.fromEntries(Object.entries(COMMANDER_VARIANTS).map(([k, v]) => [k, v.multiplayerLife]))).toEqual({ commander: 40, duel: null, brawl: 30, standardbrawl: 30 });
  });

  it('CR 903.7: a 4-player Commander game starts at 40; CR 903.12f: a 3-player Brawl or Standard Brawl game at 30 (two-player Brawl stays 25)', () => {
    expect(lives(createGame(commanderConfig(4, 'commander')))).toEqual([40, 40, 40, 40]);
    expect(lives(createGame(commanderConfig(3, 'brawl')))).toEqual([30, 30, 30]);
    expect(lives(createGame(commanderConfig(4, 'standardbrawl')))).toEqual([30, 30, 30, 30]);
    expect(lives(createGame(commanderConfig(2, 'brawl')))).toEqual([25, 25]); // CR 903.12f, two players: unchanged
    expect(lives(createGame(commanderConfig(3, 'commander', { startingLife: 35 })))).toEqual([35, 35, 35]); // an explicit life wins
    expect(createGame(commanderConfig(4, 'commander')).zones.command).toHaveLength(4); // CR 903.6: every commander in the command zone
  });

  it('Duel Commander is a two-player format: refused with 3-4 players, even with a starting life given', () => {
    expect(() => createGame(commanderConfig(3, 'duel'))).toThrow(/two-player format/);
    expect(() => createGame(commanderConfig(4, 'duel', { startingLife: 20 }))).toThrow(ConfigError);
    expect(lives(createGame(commanderConfig(2, 'duel')))).toEqual([20, 20]);
  });
});

describe('M12-1: CR 103.8, 800.7: the draw of the starting player\'s first turn', () => {
  it('CR 103.8a: in a two-player game the starting player skips it; CR 103.8c, 800.7: in a multiplayer game nobody does', () => {
    expect(mainPhaseGame(2).zones.hand['p1']).toHaveLength(7);
    expect(mainPhaseGame(3).zones.hand['p1']).toHaveLength(8);
    const four = mainPhaseGame(4);
    expect(four.zones.hand['p1']).toHaveLength(8);
    expect(four.log.some((l) => /draw/i.test(l.text) && l.rules?.includes('CR 103.8a'))).toBe(false);
  });
});

describe('M12-1: the multiplayer readers (core/multiplayer.ts, m12 design 4.2)', () => {
  it('playersInGame: turn order from the active player (CR 101.4), without players who left; from the next player when the active player left (CR 800.4j)', () => {
    const s = mainPhaseGame(4);
    expect(playersInGame(s)).toEqual(['p1', 'p2', 'p3', 'p4']);
    const t = cloneState(s);
    t.turn.activePlayer = 'p3';
    expect(playersInGame(t)).toEqual(['p3', 'p4', 'p1', 'p2']);
    expect(playersInGame(lose(t, ['p4']))).toEqual(['p3', 'p1', 'p2']);
    expect(playersInGame(lose(t, ['p3']))).toEqual(['p4', 'p1', 'p2']);
  });

  it('seatNeighbor (m12 design D6): left = the next player in turn order still in the game (CR 101.4, 103.1), right = the previous one', () => {
    const s = mainPhaseGame(4);
    expect(seatNeighbor(s, 'p1', 'left')).toBe('p2');
    expect(seatNeighbor(s, 'p1', 'right')).toBe('p4');
    expect(seatNeighbor(s, 'p4', 'left')).toBe('p1');
    const t = lose(s, ['p2']);
    expect(seatNeighbor(t, 'p1', 'left')).toBe('p3'); // a player who left has no seat any more
    expect(seatNeighbor(t, 'p3', 'right')).toBe('p1');
    expect(seatNeighbor(t, 'p2', 'left')).toBe('p3'); // counted from the seat of a player who left
    expect(seatNeighbor(lose(s, ['p2', 'p3', 'p4']), 'p1', 'left')).toBeUndefined(); // nobody else in the game
    expect(seatNeighbor(s, 'p9', 'left')).toBeUndefined();
  });

  it('seatNeighbor in a two-player game: both neighbors are the opponent', () => {
    const s = mainPhaseGame(2);
    expect([seatNeighbor(s, 'p1', 'left'), seatNeighbor(s, 'p1', 'right'), seatNeighbor(s, 'p2', 'left')]).toEqual(['p2', 'p2', 'p1']);
  });

  it('placements (m12 design D10): the winner, then the last to lose, then the players who left, the last one out first; ties share a place', () => {
    const s = cloneState(mainPhaseGame(4));
    const [p1, p2, p3, p4] = s.players;
    p3!.hasLost = true; p3!.lostReason = 'conceded'; p3!.left = { turn: 2, order: 1, reason: 'conceded' };
    p1!.hasLost = true; p1!.lostReason = '0 life'; p1!.left = { turn: 5, order: 2, reason: '0 life' };
    expect(placements(s).map((x) => [x.player, x.place])).toEqual([['p2', 1], ['p4', 1], ['p1', 3], ['p3', 4]]); // the game goes on: p2 and p4 share 1st
    p4!.hasLost = true; p4!.lostReason = '21 combat damage from Test Legend';
    s.result = { winner: 'p2', reason: 'last player in the game' };
    expect(placements(s)).toEqual([
      { player: 'p2', place: 1 },
      { player: 'p4', place: 2, reason: '21 combat damage from Test Legend' },
      { player: 'p1', place: 3, reason: '0 life' },
      { player: 'p3', place: 4, reason: 'conceded' },
    ]);
    p2!.hasLost = true;
    s.result = { winner: null, reason: 'draw' }; // CR 104.4a: the remaining players lost at once: they share the best place
    expect(placements(s).map((x) => [x.player, x.place])).toEqual([['p2', 1], ['p4', 1], ['p1', 3], ['p3', 4]]);
  });

  it('players who lose at the same time share ONE left.order and one place (m12 design D8; coordination with the results ledger of milestone 13)', () => {
    const s = cloneState(mainPhaseGame(4));
    const [p1, p2, p3, p4] = s.players;
    // turn 4: p3 and p4 lose in the same state-based action check (CR 704.3, 104.4a): one elimination, order 1; turn 7: p1, order 2; p2 wins
    for (const p of [p3!, p4!]) { p.hasLost = true; p.lostReason = '0 life'; p.left = { turn: 4, order: 1, reason: '0 life', rules: ['CR 704.5a'] }; }
    p1!.hasLost = true; p1!.lostReason = 'conceded'; p1!.left = { turn: 7, order: 2, reason: 'conceded', rules: ['CR 104.3a'] };
    s.result = { winner: 'p2', reason: 'last player in the game' };
    expect(placements(s).map((x) => [x.player, x.place])).toEqual([['p2', 1], ['p1', 2], ['p3', 3], ['p4', 3]]);
    expect(p2!.left).toBeUndefined();
  });

  it('placements of a two-player game: the winner 1st, the other player 2nd (no `left`: the game is over, CR 104.2a)', () => {
    const s = act(mainPhaseGame(2), { type: 'concede', player: 'p2' });
    expect(s.result?.winner).toBe('p1');
    expect(s.players.every((p) => p.left === undefined)).toBe(true);
    expect(placements(s).map((x) => [x.player, x.place])).toEqual([['p1', 1], ['p2', 2]]);
  });
});
