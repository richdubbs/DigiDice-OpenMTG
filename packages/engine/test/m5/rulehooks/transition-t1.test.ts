/**
 * Design 4.5, transition T1 (WP16's half): milestone 4's player restrictions are typed `restrict` records, and `addPlayerRestriction` / `playerRestricted`
 * are thin wrappers over them (rules/restrictions.ts). The milestone 4 tests of test/m4/game-end.test.ts and review-sba.test.ts run unchanged on top.
 */
import { describe, expect, it } from 'vitest';
import { addPlayerRestriction, cloneState, EngineBug, gainLife, playerRestricted, type GameState } from '../../../src/index';
import { Game } from '../../../src/core/game';
import { RESTRICTION_ACTION } from '../../../src/rules/restrictions';
import { advanceTo, find, scenario, tweak } from '../helpers';
import { cant, OPPONENTS, PLATINUM_ANGEL, withRuleEffect } from './fixtures';

const board = (): GameState => scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
const run = (s: GameState, f: (g: Game) => void): GameState => {
  const g = new Game(cloneState(s));
  f(g);
  return g.s;
};

describe('addPlayerRestriction writes a typed restriction record (design 4.5)', () => {
  it('each milestone 4 restriction maps to its RuleAction on a fixed player, each duration string to a Duration', () => {
    expect(RESTRICTION_ACTION).toEqual({ cantGainLife: 'gainLife', cantLoseLife: 'loseLife', cantLoseGame: 'lose', cantWinGame: 'win' });
    const s0 = board();
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = run(s0, (g) => {
      addPlayerRestriction(g, 'p1', 'cantGainLife');
      addPlayerRestriction(g, 'p2', 'cantLoseLife', 'endOfCombat');
      addPlayerRestriction(g, 'p1', 'cantLoseGame', 'permanent');
      addPlayerRestriction(g, 'p2', 'cantWinGame', 'whileSourceOnBattlefield', bears);
    });
    const recs = s.continuousEffects;
    expect(recs.map((r) => [r.duration, r.effect])).toEqual([
      [{ d: 'endOfTurn' }, { s: 'restrict', subject: { ref: 'fixed', players: ['p1'] }, mode: 'cant', action: 'gainLife' }],
      [{ d: 'endOfCombat' }, { s: 'restrict', subject: { ref: 'fixed', players: ['p2'] }, mode: 'cant', action: 'loseLife' }],
      [{ d: 'permanent' }, { s: 'restrict', subject: { ref: 'fixed', players: ['p1'] }, mode: 'cant', action: 'lose' }],
      [{ d: 'whileSource', as: 'onBattlefield' }, { s: 'restrict', subject: { ref: 'fixed', players: ['p2'] }, mode: 'cant', action: 'win' }],
    ]);
    expect(recs[3]).toMatchObject({ source: { id: bears, zone: 'battlefield' }, sourceName: 'Grizzly Bears', controller: 'p1' });
    expect(recs.map((r) => r.startedTurn)).toEqual([1, 1, 1, 1]);
  });

  it('an unknown duration string or a missing source is an engine bug, never a silent default', () => {
    expect(() => run(board(), (g) => addPlayerRestriction(g, 'p1', 'cantGainLife', 'untilYourNextTurn'))).toThrow(EngineBug);
    expect(() => run(board(), (g) => addPlayerRestriction(g, 'p1', 'cantGainLife', 'permanent', 'o9999'))).toThrow(EngineBug);
  });
});

describe('playerRestricted reads every restriction source (CR 119.7, 104.3)', () => {
  it('CR 514.2: an end-of-turn restriction ends in the cleanup step', () => {
    const s = run(board(), (g) => addPlayerRestriction(g, 'p1', 'cantGainLife'));
    expect(playerRestricted(s, 'p1', 'cantGainLife')).toBe(true);
    expect(playerRestricted(advanceTo(s, 2, 'upkeep'), 'p1', 'cantGainLife')).toBe(false);
  });

  it('CR 611.2b: "for as long as" ends when the source leaves the battlefield (also when it comes back: a new object, CR 400.7)', () => {
    const s0 = board();
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = run(s0, (g) => addPlayerRestriction(g, 'p2', 'cantWinGame', 'whileSourceOnBattlefield', bears));
    expect(playerRestricted(s, 'p2', 'cantWinGame')).toBe(true);
    const gone = tweak(s, (t) => {
      t.zones.battlefield = t.zones.battlefield.filter((id) => id !== bears);
      t.objects[bears]!.zone = 'graveyard';
      t.zones.graveyard.p1!.push(bears);
    });
    expect(playerRestricted(gone, 'p2', 'cantWinGame')).toBe(false);
  });

  it('a static ability (Platinum Angel) and a resolved effect with a non-fixed subject ("your opponents can\'t win") are restrictions too', () => {
    const angel = scenario([], { defs: [PLATINUM_ANGEL], p1: { battlefield: ['Platinum Angel'] } });
    expect([playerRestricted(angel, 'p1', 'cantLoseGame'), playerRestricted(angel, 'p2', 'cantLoseGame'), playerRestricted(angel, 'p2', 'cantWinGame'), playerRestricted(angel, 'p1', 'cantWinGame')]).toEqual([true, false, true, false]);
    const rec = withRuleEffect(board(), cant(OPPONENTS, 'win'), { controller: 'p1', duration: { d: 'permanent' } });
    expect([playerRestricted(rec, 'p1', 'cantWinGame'), playerRestricted(rec, 'p2', 'cantWinGame')]).toEqual([false, true]);
  });

  it('a restriction with a condition ("as long as you have 10 or less life") applies only while it holds (CR 611.3a)', () => {
    const s = withRuleEffect(board(), cant({ ref: 'fixed', players: ['p1'] }, 'gainLife', { when: { cond: 'compare', left: { q: 'life', of: { ref: 'you' } }, op: '<=', right: 10 } }), { controller: 'p1', duration: { d: 'permanent' } });
    expect(playerRestricted(s, 'p1', 'cantGainLife')).toBe(false);
    const low = tweak(s, (t) => { t.players[0]!.life = 8; });
    expect(playerRestricted(low, 'p1', 'cantGainLife')).toBe(true);
    const after = run(low, (g) => gainLife(g, 'p1', 5, 'test'));
    expect(after.players[0]!.life).toBe(8);
  });
});
