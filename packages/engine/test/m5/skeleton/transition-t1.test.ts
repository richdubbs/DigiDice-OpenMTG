/**
 * Design 4.5, transition T1: milestone 4 stored regeneration shields and player restrictions in `GameState.continuousEffects` as legacy records (a string
 * duration, an open `effect: {kind}`). WP0 widened the array, WP11 migrated the regeneration shields (rules/destroy.ts), WP16 the player restrictions
 * (rules/restrictions.ts), and WP31 removed the legacy type (`LegacyContinuousEffect`, `ContinuousEffectEntry`, `isTypedEffect`, `isLegacyEffect`): every
 * record is a typed `ContinuousEffectRec` whose duration is a `Duration` object.
 */
import { describe, expect, it } from 'vitest';
import * as engine from '../../../src/index';
import { addPlayerRestriction, playerRestricted, type ContinuousEffectRec, type GameState } from '../../../src/index';
import { hasSimpleDuration } from '../../../src/types/state';
import { Game } from '../../../src/core/game';
import { cloneState } from '../../../src/util/clone';
import { advanceTo, scenario, tweak } from '../helpers';

const typed = (id: string, duration: ContinuousEffectRec['duration']): ContinuousEffectRec => ({
  id,
  source: null,
  sourceName: 'Test',
  controller: 'p1',
  timestamp: 100,
  startedTurn: 1,
  duration,
  effect: { s: 'restrict', subject: { ref: 'fixed', players: ['p1'] }, mode: 'cant', action: 'gainLife' },
});

const board = (): GameState => scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
const ids = (s: GameState): string[] => s.continuousEffects.map((e) => e.id).sort();

describe('design 4.5: transition T1 is complete (WP31)', () => {
  it('the legacy helpers are no longer exported', () => {
    for (const name of ['isLegacyEffect', 'isTypedEffect']) expect(Object.hasOwn(engine, name), name).toBe(false);
  });

  it('hasSimpleDuration reads the Duration object', () => {
    expect(hasSimpleDuration(typed('t', { d: 'endOfTurn' }), 'endOfTurn')).toBe(true);
    expect(hasSimpleDuration(typed('t', { d: 'permanent' }), 'endOfTurn')).toBe(false);
    expect(hasSimpleDuration(typed('t', { d: 'whileSource', as: 'onBattlefield' }), 'whileSource')).toBe(true);
  });
});

describe('CR 514.2: "until end of turn" effects end in the cleanup step', () => {
  it('records with an end-of-turn duration are removed; permanent ones stay', () => {
    const s0 = tweak(board(), (t) => {
      t.continuousEffects.push(typed('t-turn', { d: 'endOfTurn' }), typed('t-perm', { d: 'permanent' }));
    });
    expect(ids(s0)).toEqual(['t-perm', 't-turn']);
    const s = advanceTo(s0, 2, 'upkeep');
    expect(ids(s)).toEqual(['t-perm']);
  });
});

describe('CR 500.5a: "until end of combat" effects end with the combat phase', () => {
  it('records with an end-of-combat duration are removed at the end of combat step', () => {
    const s0 = tweak(board(), (t) => {
      t.continuousEffects.push(typed('t-combat', { d: 'endOfCombat' }), typed('t-turn', { d: 'endOfTurn' }));
    });
    const s = advanceTo(s0, 1, 'main2');
    expect(ids(s)).toEqual(['t-turn']);
  });
});

describe('the milestone 4 users write and read typed records', () => {
  it('WP16: playerRestricted reads typed restriction records, addPlayerRestriction writes one (CR 119.7)', () => {
    const g = new Game(cloneState(board()));
    expect(playerRestricted(g.s, 'p1', 'cantGainLife')).toBe(false);
    g.s.continuousEffects.push(typed('t', { d: 'endOfTurn' }));
    expect(playerRestricted(g.s, 'p1', 'cantGainLife')).toBe(true);
    g.s.continuousEffects = [];
    addPlayerRestriction(g, 'p1', 'cantGainLife');
    expect(playerRestricted(g.s, 'p1', 'cantGainLife')).toBe(true);
    expect(playerRestricted(g.s, 'p2', 'cantGainLife')).toBe(false);
    expect(g.s.continuousEffects).toMatchObject([{ duration: { d: 'endOfTurn' }, effect: { s: 'restrict', subject: { ref: 'fixed', players: ['p1'] }, mode: 'cant', action: 'gainLife' } }]);
  });
});
