/**
 * M12-2 (docs/design/m12-multiplayer.md D14, E13): goad ends at the start of the goader's next turn (CR 701.15a), and what lasts until a leaver's next turn
 * ends when that turn would have begun (CR 800.4m; core/durations.ts, core/turn.ts). M12-3 writes `goaded` (the native goad action); here it is set directly.
 */
import { describe, expect, it } from 'vitest';
import type { ContinuousEffectRec, GameState } from '../../../src/index';
import { concede, find, logHas, mpScenario, passUntil } from './helpers';

const toTurn = (s: GameState, n: number): GameState => passUntil(s, (x) => x.turn.number === n && x.turn.step === 'upkeep', `turn ${n}`, 400);

function goadedBears(by: string[]): { s: GameState; bears: string } {
  const s = mpScenario({
    cards: ['Grizzly Bears'], zones: { p2: { battlefield: ['Grizzly Bears'] } },
    setup: (x) => { x.objects[find(x, 'Grizzly Bears', 'battlefield', 'p2')]!.goaded = by.map((p) => ({ by: p })); },
  });
  return { s, bears: find(s, 'Grizzly Bears', 'battlefield', 'p2') };
}

describe('CR 701.15a, 800.4m: goad and "until your next turn" with players leaving', () => {
  it('CR 701.15a, 701.15c: each goader\'s entry ends as that goader\'s next turn begins', () => {
    let { s, bears } = goadedBears(['p3', 'p4']);
    s = toTurn(s, 2); // Bob's turn
    expect(s.objects[bears]!.goaded).toEqual([{ by: 'p3' }, { by: 'p4' }]);
    s = toTurn(s, 3); // Carol's turn begins: her goad ends
    expect(s.objects[bears]!.goaded).toEqual([{ by: 'p4' }]);
    expect(logHas(s, /Grizzly Bears is no longer goaded by Carol/, 'CR 701.15a')).toBe(true);
    s = toTurn(s, 4);
    expect(Object.hasOwn(s.objects[bears]!, 'goaded')).toBe(false);
  });

  it('CR 800.4m: the goad of a player who left the game ends when their turn would have begun, neither at once nor never', () => {
    let { s, bears } = goadedBears(['p3']);
    s = concede(s, 'p3').state;
    expect(s.objects[bears]!.goaded).toEqual([{ by: 'p3' }]); // not at once
    s = toTurn(s, 2); // Bob's turn
    expect(s.objects[bears]!.goaded).toEqual([{ by: 'p3' }]);
    s = toTurn(s, 3); // Carol's turn would have begun; Dan's begins instead (CR 800.4k)
    expect(s.turn.activePlayer).toBe('p4');
    expect(Object.hasOwn(s.objects[bears]!, 'goaded')).toBe(false);
    expect(logHas(s, /no longer goaded by Carol/, 'CR 800.4m')).toBe(true);
  });

  it('CR 800.4m: an effect that lasts "until your next turn" of a player who left ends when that turn would have begun', () => {
    let s = mpScenario({ cards: ['Grizzly Bears'], zones: { p1: { battlefield: ['Grizzly Bears'] } } });
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p1');
    const rec: ContinuousEffectRec = {
      id: 'e-test', source: null, sourceName: 'Test', controller: 'p3', timestamp: 999, startedTurn: 1, duration: { d: 'untilNextTurn', whose: { ref: 'fixed', players: ['p3'] } },
      effect: { s: 'continuous', affects: { ref: 'fixed', objects: [{ id: bears, zone: 'battlefield' }] }, mods: [{ layer: '7c', power: 2, toughness: 2 }] },
    };
    s = { ...s, continuousEffects: [...s.continuousEffects, rec] };
    s = concede(s, 'p3').state;
    s = toTurn(s, 2);
    expect(s.continuousEffects.map((e) => e.id)).toContain('e-test');
    s = toTurn(s, 3);
    expect(s.continuousEffects.map((e) => e.id)).not.toContain('e-test');
    expect(logHas(s, /Carol's turn would have begun/, 'CR 800.4m')).toBe(true);
  });
});
