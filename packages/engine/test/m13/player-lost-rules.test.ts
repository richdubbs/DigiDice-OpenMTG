/**
 * M13-7 (docs/design/m13-hosted-server.md 7): the `playerLost` event carries the CR citations of the loss (`rules`), the ones core/sba.ts#markLost logs,
 * for the hosted results ledger. Events are not state: the field changes no state and no action log (the M3 soak's tallies and the replay tests are
 * unchanged; test/m11/skeleton/neutrality.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, cloneState, concedeGame, loseGame, winGame, type GameEvent, type GameState } from '../../src/index';
import { Game } from '../../src/core/game';
import { scenario, tweak } from '../m4/helpers';
import { commanderScenario, legend } from '../m11/rules/helpers';

const lostEvents = (events: readonly GameEvent[]) => events.filter((e): e is Extract<GameEvent, { type: 'playerLost' }> => e.type === 'playerLost');

/** The events of the next priority pass (the state-based actions run before a player would receive priority, CR 704.3). */
function passEvents(s: GameState): { s: GameState; events: GameEvent[] } {
  const r = applyAction(s, { type: 'pass', player: s.pending!.player });
  expect(r.error).toBeUndefined();
  return { s: r.state, events: r.events };
}

function run(s: GameState, f: (g: Game) => void): { s: GameState; events: GameEvent[] } {
  const g = new Game(cloneState(s));
  f(g);
  return { s: g.s, events: g.events };
}

const base = () => scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });

describe('M13-7: playerLost.rules', () => {
  it('the state-based actions cite 704.5a (life), 704.5b (empty library) and 704.5c (poison)', () => {
    const cases: [string, (t: GameState) => void, string][] = [
      ['life', (t) => { t.players[1]!.life = 0; }, 'CR 704.5a'],
      ['library', (t) => { t.players[1]!.drewFromEmptyLibrary = true; }, 'CR 704.5b'],
      ['poison', (t) => { t.players[1]!.poison = 10; }, 'CR 704.5c'],
    ];
    for (const [what, f, rule] of cases) {
      const { s, events } = passEvents(tweak(base(), f));
      expect(lostEvents(events), what).toEqual([{ type: 'playerLost', player: 'p2', reason: s.players[1]!.lostReason, rules: [rule] }]);
    }
  });

  it('simultaneous losers (CR 104.4a): one event each, each with its own citation, then the draw', () => {
    const { s, events } = passEvents(tweak(base(), (t) => { t.players[0]!.life = 0; t.players[1]!.drewFromEmptyLibrary = true; }));
    expect(s.result).toMatchObject({ winner: null });
    expect(lostEvents(events).map((e) => [e.player, e.rules])).toEqual([['p1', ['CR 704.5a']], ['p2', ['CR 704.5b']]]);
  });

  it('CR 704.6c: commander damage', () => {
    const titania = legend('Test Titania', '{G}', ['5', '5'], ['G']);
    const bob = legend('Test Bob Commander', '{G}', ['1', '1'], ['G']);
    const s0 = commanderScenario({ variant: 'commander', p1Commanders: [titania], p2Commanders: [bob] });
    const card = s0.players.find((p) => p.id === 'p1')!.commanders![0]!.card;
    const { s, events } = passEvents(tweak(s0, (t) => { t.players.find((p) => p.id === 'p2')!.commanderDamage = { [card]: 21 }; }));
    expect(s.result?.winner).toBe('p1');
    expect(lostEvents(events).map((e) => [e.player, e.rules])).toEqual([['p2', ['CR 704.6c']]]);
  });

  it('a concession cites 104.3a, an effect 104.3e, another player winning 104.2b', () => {
    const conceded = applyAction(base(), { type: 'concede', player: 'p2' });
    expect(lostEvents(conceded.events).map((e) => e.rules)).toEqual([['CR 104.3a']]);
    expect(lostEvents(run(base(), (g) => concedeGame(g, 'p1')).events).map((e) => e.rules)).toEqual([['CR 104.3a']]);
    expect(lostEvents(run(base(), (g) => loseGame(g, 'p2', 'Test Loss', ['CR 104.3e'])).events).map((e) => e.rules)).toEqual([['CR 104.3e']]);
    expect(lostEvents(run(base(), (g) => winGame(g, 'p1', 'Test Win')).events).map((e) => [e.player, e.rules])).toEqual([['p2', ['CR 104.2b']]]);
  });

  it('the event holds its own copy of the citations (the caller\'s array is not shared)', () => {
    const rules = ['CR 104.3e'];
    const { events } = run(base(), (g) => loseGame(g, 'p2', 'Test Loss', rules));
    const e = lostEvents(events)[0]!;
    expect(e.rules).toEqual(rules);
    expect(e.rules).not.toBe(rules);
  });

  it('no new state field: the citations stay in the log entry, as before', () => {
    const { s } = passEvents(tweak(base(), (t) => { t.players[1]!.life = 0; }));
    expect(Object.keys(s.players[1]!)).not.toContain('lostRules');
    expect(s.log.some((l) => /loses the game/.test(l.text) && l.rules?.includes('CR 704.5a'))).toBe(true);
  });
});
