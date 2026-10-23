/**
 * M12-2 (docs/design/m12-multiplayer.md D12, E9-E12): priority while players leave (CR 117.4, 800.4a, 800.4j). A leaver's pass no longer counts; a leaver
 * who held priority passes it on; an active player who left leaves a turn without an active player.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import { act, concede, drive, find, lifeOf, logHas, mpScenario, pass, passUntil } from './helpers';

const holder = (s: { pending: { kind: string; player: string } | null }): string | undefined => (s.pending?.kind === 'priority' ? s.pending.player : undefined);

describe('CR 117.4, 800.4a: priority with players leaving (m12 design D12)', () => {
  it('CR 117.4: A passes, B passes, C holds, A concedes, C passes: D gets priority (the step does not end on a stale count)', () => {
    let s = mpScenario();
    s = pass(pass(s)); // Alice, then Bob pass in the first main phase
    expect(holder(s)).toBe('p3');
    s = concede(s, 'p1').state;
    expect(holder(s)).toBe('p3'); // Carol still holds priority
    expect(s.priority.passes).toBe(1); // only Bob's pass still counts
    s = pass(s);
    expect(s.turn.step).toBe('main1');
    expect(holder(s)).toBe('p4');
    s = pass(s); // Bob, Carol and Dan have now passed in succession: the step ends (CR 117.4)
    expect(s.turn.step).not.toBe('main1');
  });

  it('CR 800.4a: the player holding priority concedes: priority passes to the next player in turn order still in the game', () => {
    let s = mpScenario();
    s = pass(s);
    expect(holder(s)).toBe('p2');
    s = concede(s, 'p2').state;
    expect(holder(s)).toBe('p3');
    expect(logHas(s, /Priority passes to Carol/, 'CR 800.4a')).toBe(true);
  });

  it('CR 117.4: everyone else passed and the holder concedes: every player still in the game has passed in succession, so the step ends', () => {
    let s = mpScenario();
    s = pass(pass(pass(s)));
    expect(holder(s)).toBe('p4');
    s = concede(s, 'p4').state;
    expect(s.turn.step).toBe('beginCombat');
    expect(holder(s)).toBe('p1');
  });

  it('CR 800.4a, 117.5: the holder concedes after everyone else passed, and their permanents leaving trigger an ability: the next player gets priority to answer it', () => {
    const watcher = compileCard({ name: 'Departure Watcher', layout: 'normal', mana_cost: '{1}', type_line: 'Enchantment', oracle_text: 'Whenever a creature leaves the battlefield, you gain 1 life.' } as OracleCard);
    let s = mpScenario({ cards: ['Grizzly Bears'], defs: [watcher], zones: { p1: { battlefield: ['Departure Watcher'] }, p4: { battlefield: ['Grizzly Bears'] } } });
    s = pass(pass(pass(s)));
    s = concede(s, 'p4').state;
    expect(s.turn.step).toBe('main1');
    expect(s.zones.stack).toHaveLength(1);
    expect(holder(s)).toBe('p1');
    expect(s.priority.passes).toBe(0);
    s = pass(pass(pass(s)));
    expect(lifeOf(s, 'p1')).toBe(21);
    expect(s.turn.step).toBe('main1');
    expect(holder(s)).toBe('p1');
  });

  it('CR 800.4j: after a resolution, the active player who left does not receive priority: the next player in turn order does', () => {
    let s = mpScenario({ cards: ['Shock', 'Mountain'], zones: { p2: { hand: ['Shock'], battlefield: ['Mountain'] } } });
    s = pass(s);
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Shock', 'hand', 'p2') }), [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p3' }] }]);
    s = concede(s, 'p1').state; // Alice, the active player, leaves during her turn
    expect(holder(s)).toBe('p2');
    s = pass(pass(pass(s))); // Bob, Carol, Dan
    expect(lifeOf(s, 'p3')).toBe(18);
    expect(s.zones.stack).toEqual([]);
    expect(holder(s)).toBe('p2'); // CR 117.3b with CR 800.4j
    expect(s.turn.activePlayer).toBe('p1');
  });

  it('CR 800.4j, 800.4k: the turn of an active player who left goes on to its end without them; the next turn is the next player\'s', () => {
    let s = mpScenario();
    s = concede(s, 'p1').state;
    expect(s.turn.activePlayer).toBe('p1');
    s = passUntil(s, (x) => x.turn.step === 'end', 'the end step');
    expect(holder(s)).toBe('p2'); // the step begins: the next player in turn order receives the active player's priority
    s = passUntil(s, (x) => x.turn.number === 2 && x.turn.step === 'main1', 'turn 2');
    expect(s.turn.activePlayer).toBe('p2');
    expect(s.zones.hand['p2']).toHaveLength(1); // Bob draws on his first turn: no draw skip in a multiplayer game (CR 103.8c)
  });
});
