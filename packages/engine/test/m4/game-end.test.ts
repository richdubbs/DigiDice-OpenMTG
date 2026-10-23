/**
 * Winning, losing and drawing the game (CR 104) and the life helpers (CR 119).
 */
import { describe, expect, it } from 'vitest';
import {
  addPlayerRestriction, applyAction, canPayLife, cloneState, concedeGame, drawGame, gainLife, loseGame, loseLife, payLife, winGame, type GameEvent, type GameState,
} from '../../src/index';
import { Game } from '../../src/core/game';
import { act, answer, find, lifeOf, logHas, pass, scenario, tweak } from './helpers';

/** Run engine code on a copy of the state, the way an effect would, and return the resulting state with the events. */
function run(s: GameState, f: (g: Game) => void): { s: GameState; events: GameEvent[] } {
  const g = new Game(cloneState(s));
  f(g);
  return { s: g.s, events: g.events };
}

const base = () => scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });

describe('CR 104.2-104.4: ending the game', () => {
  it('CR 104.3a: a player can concede at any time; the other player wins (CR 104.2a)', () => {
    const s = act(base(), { type: 'concede', player: 'p2' });
    expect(s.result).toEqual({ winner: 'p1', reason: 'Alice is the last player remaining' });
    expect(s.players[1]).toMatchObject({ hasLost: true, lostReason: 'conceded' });
    expect(logHas(s, /Bob concedes/, 'CR 104.3a')).toBe(true);
    expect(s.pending).toBeNull();
  });

  it('CR 104.3a: no effect stops a concession ("you can\'t lose the game" does not)', () => {
    const { s: restricted } = run(base(), (g) => addPlayerRestriction(g, 'p2', 'cantLoseGame', 'permanent'));
    const s = act(restricted, { type: 'concede', player: 'p2' });
    expect(s.result).toMatchObject({ winner: 'p1' });
  });

  it('CR 104.1: nothing can be done once the game is over', () => {
    const s = act(base(), { type: 'concede', player: 'p2' });
    expect(applyAction(s, { type: 'pass', player: 'p1' }).error?.rules).toContain('CR 104.1');
  });

  it('CR 104.3b, 704.5a: a player at 0 or less life loses the next time a player would receive priority (a manual life change)', () => {
    const s0 = scenario(['Lightning Bolt', 'Mountain'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] }, manual: ['Lightning Bolt'] });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Lightning Bolt', 'hand') });
    s = answer(s, { kind: 'payCost', auto: true });
    s = pass(pass(s));
    s = answer(s, { kind: 'manualResolve', ops: [{ op: 'damage', target: 'p2', amount: 25 }] }); // Lightning Bolt, resolved by hand
    expect(s.result?.winner).toBe('p1');
    expect(lifeOf(s, 'p2')).toBe(-5);
  });

  it('CR 104.2b: an effect that makes a player win the game makes every opponent lose', () => {
    const { s, events } = run(base(), (g) => winGame(g, 'p1', 'Test Win'));
    expect(s.result).toMatchObject({ winner: 'p1' });
    expect(s.players[1]).toMatchObject({ hasLost: true, lostReason: 'Alice won the game' });
    expect(events.map((e) => e.type)).toEqual(['playerLost', 'gameOver']);
    expect(logHas(s, /Alice wins the game: Test Win/, 'CR 104.2b')).toBe(true);
  });

  it('CR 104.3f: a player who has lost can not win the game', () => {
    const lost = run(base(), (g) => loseGame(g, 'p1', 'Test Loss', ['CR 104.3e'])).s;
    expect(lost.result).toMatchObject({ winner: 'p2' });
    const { s } = run(tweak(base(), (t) => { t.players[0]!.hasLost = true; }), (g) => winGame(g, 'p1', 'too late'));
    expect(s.result).toBeNull();
  });

  it('CR 104.3e: an effect that says a player loses the game', () => {
    const { s } = run(base(), (g) => loseGame(g, 'p2', 'Test Loss', ['CR 104.3e']));
    expect(s.result).toMatchObject({ winner: 'p1' });
    expect(logHas(s, /Bob loses the game: Test Loss/, 'CR 104.3e')).toBe(true);
  });

  it('CR 104.4c: an effect can state that the game is a draw', () => {
    const { s, events } = run(base(), (g) => drawGame(g, 'Test Draw'));
    expect(s.result).toEqual({ winner: null, reason: 'Test Draw' });
    expect(s.stage).toBe('over');
    expect(events).toEqual([{ type: 'gameOver', winner: null, reason: 'Test Draw' }]);
  });

  it('CR 104.4a: if all the players remaining lose simultaneously (life and an empty library), the game is a draw', () => {
    const s0 = tweak(base(), (t) => { t.players[0]!.life = 0; t.players[1]!.drewFromEmptyLibrary = true; });
    const s = pass(s0);
    expect(s.result).toEqual({ winner: null, reason: 'all players lost simultaneously' });
  });

  it('CR 104.2a: a player wins when their opponents have all left the game, which overrides "can\'t win the game"', () => {
    const { s: restricted } = run(base(), (g) => addPlayerRestriction(g, 'p1', 'cantWinGame', 'permanent'));
    const s = act(restricted, { type: 'concede', player: 'p2' });
    expect(s.result).toMatchObject({ winner: 'p1' });
  });
});

describe('"can\'t lose the game" and "can\'t win the game"', () => {
  it('CR 104.3b: a player who can\'t lose the game stays in it at 0 life (the state-based action does nothing)', () => {
    const { s: restricted } = run(tweak(base(), (t) => { t.players[1]!.life = 0; }), (g) => addPlayerRestriction(g, 'p2', 'cantLoseGame', 'permanent'));
    const s = pass(restricted);
    expect(s.result).toBeNull();
    expect(s.players[1]!.hasLost).toBe(false);
    expect(lifeOf(s, 'p2')).toBe(0);
    // The restriction does not spam the log on every check.
    expect(s.log.filter((l) => /can't lose/.test(l.text))).toEqual([]);
  });

  it('CR 104.2b: "you win the game" does not end the game while an opponent can\'t lose; one who can\'t win does not win', () => {
    const { s: a } = run(base(), (g) => { addPlayerRestriction(g, 'p2', 'cantLoseGame', 'permanent'); winGame(g, 'p1', 'Test Win'); });
    expect(a.result).toBeNull();
    expect(logHas(a, /Bob can't lose the game/)).toBe(true);
    const { s: b } = run(base(), (g) => { addPlayerRestriction(g, 'p1', 'cantWinGame', 'permanent'); winGame(g, 'p1', 'Test Win'); });
    expect(b.result).toBeNull();
    expect(logHas(b, /Alice can't win the game/)).toBe(true);
  });

  it('CR 104.3e: "loses the game" is also prevented by "can\'t lose the game"', () => {
    const { s } = run(base(), (g) => { addPlayerRestriction(g, 'p2', 'cantLoseGame', 'permanent'); loseGame(g, 'p2', 'Test Loss', ['CR 104.3e']); });
    expect(s.result).toBeNull();
  });

  it('CR 611.2b: a restriction that lasts while its source is on the battlefield ends when the source leaves', () => {
    const s0 = scenario(['Grizzly Bears'], { p2: { battlefield: ['Grizzly Bears'] } });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const { s: restricted } = run(tweak(s0, (t) => { t.players[1]!.life = 0; }), (g) => addPlayerRestriction(g, 'p2', 'cantLoseGame', 'whileSourceOnBattlefield', bears));
    let s = pass(restricted);
    expect(s.result).toBeNull();
    s = pass(tweak(s, (t) => { t.objects[bears]!.damage = 2; })); // the source dies; the next check ends the restriction and Bob loses
    expect(s.result).toMatchObject({ winner: 'p1' });
  });
});

describe('CR 119: life', () => {
  it('CR 119.3: gaining and losing life change the total and are recorded in the stats and the log', () => {
    const { s, events } = run(base(), (g) => { gainLife(g, 'p1', 3, 'Test'); loseLife(g, 'p1', 5, 'Test'); });
    expect(lifeOf(s, 'p1')).toBe(18);
    expect(s.players[0]!.turnStats).toMatchObject({ lifeGained: 3, lifeLost: 5 });
    expect(events).toEqual([
      { type: 'lifeChanged', player: 'p1', delta: 3, life: 23, cause: 'Test' },
      { type: 'lifeChanged', player: 'p1', delta: -5, life: 18, cause: 'Test' },
    ]);
  });

  it('CR 119.9: gaining or losing 0 life is no event', () => {
    const { s, events } = run(base(), (g) => { gainLife(g, 'p1', 0, 'Test'); loseLife(g, 'p1', 0, 'Test'); });
    expect(events).toEqual([]);
    expect(s.log.length).toBe(base().log.length);
  });

  it('CR 119.7, 119.8: "can\'t gain life" and "can\'t lose life" stop the change', () => {
    const { s } = run(base(), (g) => {
      addPlayerRestriction(g, 'p1', 'cantGainLife');
      addPlayerRestriction(g, 'p2', 'cantLoseLife');
      expect(gainLife(g, 'p1', 4, 'Test')).toBe(0);
      expect(loseLife(g, 'p2', 4, 'Test')).toBe(0);
      expect(loseLife(g, 'p1', 4, 'Test')).toBe(4);
    });
    expect(lifeOf(s, 'p1')).toBe(16);
    expect(lifeOf(s, 'p2')).toBe(20);
  });

  it('CR 119.8: a player who can\'t lose life can\'t pay life either', () => {
    run(base(), (g) => {
      addPlayerRestriction(g, 'p1', 'cantLoseLife');
      expect(canPayLife(g, 'p1', 2)).toBe(false);
      expect(canPayLife(g, 'p1', 0)).toBe(true);
    });
  });

  it('CR 119.4: a player can pay life only up to their life total (and can always pay 0)', () => {
    const { s } = run(base(), (g) => {
      expect(canPayLife(g, 'p1', 21)).toBe(false);
      expect(payLife(g, 'p1', 21)).toBe(false);
      expect(payLife(g, 'p1', 20)).toBe(true); // paying all your life is allowed; you lose at the next check
      expect(payLife(g, 'p1', 0)).toBe(true);
    });
    expect(lifeOf(s, 'p1')).toBe(0);
    expect(pass(s).result).toMatchObject({ winner: 'p2' });
  });

  it('CR 122.1f: poison counters are given by infect and toxic; ten lose the game (CR 704.5c)', () => {
    const s = pass(tweak(base(), (t) => { t.players[1]!.poison = 10; }));
    expect(s.result).toMatchObject({ winner: 'p1' });
  });

  it('concedeGame exists for the apply layer: marks the loss and ends the game', () => {
    const { s } = run(base(), (g) => concedeGame(g, 'p1'));
    expect(s.result).toMatchObject({ winner: 'p2' });
  });
});
