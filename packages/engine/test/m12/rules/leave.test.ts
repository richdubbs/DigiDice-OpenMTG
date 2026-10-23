/**
 * M12-2 (docs/design/m12-multiplayer.md D8-D10, 4.2, 4.4): leaving a multiplayer game (CR 104.5, 800.4a-e; core/leave.ts). Real fixture cards (CR 800.4a's
 * own examples: Mind Control, Act of Treason, Bribery), driven by real actions.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, placements, type GameEvent, type GameState, type OracleCard } from '../../../src/index';
import { cloneState } from '../../../src/util/clone';
import {
  act, concede, drive, find, lifeOf, logHas, mpScenario, namesOn, ownedBy, pass, passUntil, playerOf, resolveStack, step,
} from './helpers';

/** Mind Control (Alex = Carol here, p3) enchants Bianca's (p2) Grizzly Bears. */
const attachMindControl = (s: GameState): void => {
  s.objects[find(s, 'Mind Control', 'battlefield', 'p3')]!.attachedTo = find(s, 'Grizzly Bears', 'battlefield', 'p2');
};

const leftEvents = (events: GameEvent[]) => events.filter((e): e is Extract<GameEvent, { type: 'playerLeft' }> => e.type === 'playerLeft');

describe('CR 800.4a: the leave procedure', () => {
  it('CR 104.5, 800.4a: a player who concedes a 4-player game leaves it: everything they own leaves the game, in every zone; `left`, one playerLeft event', () => {
    const s = mpScenario({ cards: ['Grizzly Bears', 'Shock'], zones: { p2: { battlefield: ['Grizzly Bears'], hand: ['Shock'], graveyard: ['Shock'] } } });
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    const { state: t, events } = concede(s, 'p2');
    expect(t.result).toBeNull(); // three players are still in the game (CR 104.2a)
    expect(ownedBy(t, 'p2')).toEqual([]); // CR 800.4a: battlefield, hand, graveyard, library
    expect(t.zones.hand['p2']).toEqual([]);
    expect(t.zones.library['p2']).toEqual([]);
    expect(t.zones.graveyard['p2']).toEqual([]);
    const p2 = playerOf(t, 'p2');
    expect(p2.hasLost).toBe(true);
    expect(p2.left).toEqual({ turn: 1, order: 1, reason: 'conceded', rules: ['CR 104.3a'] });
    const left = leftEvents(events);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ player: 'p2', reason: 'conceded', exiled: [], revealed: [] });
    expect(left[0]!.removed).toContain(bears); // public zones only: hidden cards are named to nobody (CR 400.2)
    expect(left[0]!.removed).toHaveLength(2);
    expect(t.lki[bears]?.leftZone).toBe('battlefield'); // last known information (CR 603.10, 608.2h)
    expect(events.findIndex((e) => e.type === 'playerLost')).toBeLessThan(events.findIndex((e) => e.type === 'playerLeft')); // CR 104.5: loses, then leaves
    expect(logHas(t, /Bob leaves the game/, 'CR 800.4a')).toBe(true);
  });

  it('CR 800.4a example: Alex leaves: his Mind Control leaves the game and Bianca\'s creature reverts to her control', () => {
    let s = mpScenario({ cards: ['Grizzly Bears', 'Mind Control'], zones: { p2: { battlefield: ['Grizzly Bears'] }, p3: { battlefield: ['Mind Control'] } }, setup: attachMindControl });
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    s = pass(s); // the control effect is written as state-based actions are checked (core/control.ts)
    expect(s.objects[bears]!.controller).toBe('p3');
    const t = concede(s, 'p3').state;
    expect(t.objects[bears]!.controller).toBe('p2');
    expect(t.objects[bears]!.baseController).toBeUndefined();
    expect(namesOn(t)).not.toContain('Mind Control');
  });

  it('CR 800.4a example: Bianca (the owner) leaves: her creature leaves the game too, and Alex\'s Mind Control is put into his graveyard', () => {
    let s = mpScenario({ cards: ['Grizzly Bears', 'Mind Control'], zones: { p2: { battlefield: ['Grizzly Bears'] }, p3: { battlefield: ['Mind Control'] } }, setup: attachMindControl });
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    s = pass(s);
    const t = concede(s, 'p2').state;
    expect(t.objects[bears]).toBeUndefined(); // owned by Bianca: it left the game (not exiled, CR 800.4a)
    expect(t.zones.exile).toEqual([]);
    expect(t.zones.graveyard['p3']!.map((id) => t.defs[t.objects[id]!.defId]!.name)).toEqual(['Mind Control']); // CR 704.5m
  });

  it('CR 800.4a example: Alex casts Act of Treason on Bianca\'s creature, then leaves (during his own turn): the effect ends and the creature reverts', () => {
    let s = mpScenario({ cards: ['Grizzly Bears', 'Act of Treason', 'Mountain'], zones: { p1: { hand: ['Act of Treason'], battlefield: ['Mountain', 'Mountain', 'Mountain'] }, p2: { battlefield: ['Grizzly Bears'] } } });
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Act of Treason', 'hand', 'p1') }), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: bears }] }]);
    s = resolveStack(s);
    expect(s.objects[bears]!.controller).toBe('p1');
    const t = concede(s, 'p1').state;
    expect(t.objects[bears]!.controller).toBe('p2'); // CR 800.4a: "Act of Treason's change-of-control effect ends"
    expect(t.objects[bears]!.zone).toBe('battlefield');
    // CR 800.4j: Alex's turn goes on without an active player; the next player in turn order receives the active player's priority
    expect(t.turn.activePlayer).toBe('p1');
    expect(t.pending).toMatchObject({ kind: 'priority', player: 'p2' });
  });

  it('CR 800.4a example (Bribery): what Alex controls but Bianca owns is exiled when Alex leaves; it leaves the game when Bianca leaves instead', () => {
    let s = mpScenario({ cards: ['Grizzly Bears'], zones: { p2: { battlefield: ['Grizzly Bears'] } } });
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    s = cloneState(s);
    s.objects[bears]!.controller = 'p3'; // put onto the battlefield under Alex's control (its default controller, no control effect)
    const r = concede(s, 'p3');
    const exiled = r.state.zones.exile.map((id) => r.state.objects[id]!);
    expect(exiled.map((o) => [r.state.defs[o.defId]!.name, o.owner])).toEqual([['Grizzly Bears', 'p2']]);
    expect(leftEvents(r.events)[0]!.exiled).toEqual([exiled[0]!.id]);
    expect(r.events.some((e) => e.type === 'zoneChanged' && e.oldId === bears && e.to === 'exile' && e.cause === 'leftGame')).toBe(true);
    const u = concede(s, 'p2').state;
    expect(u.objects[bears]).toBeUndefined();
    expect(u.zones.exile).toEqual([]);
  });

  it('CR 800.4c: the effect that gave a player still in the game control ends while the default controller has left: the object is exiled', () => {
    let s = mpScenario({ cards: ['Grizzly Bears', 'Act of Treason', 'Mountain'], zones: { p1: { hand: ['Act of Treason'], battlefield: ['Mountain', 'Mountain', 'Mountain'] }, p2: { battlefield: ['Grizzly Bears'] } } });
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    s = cloneState(s);
    s.objects[bears]!.controller = 'p3'; // Bribery: Carol controls Bianca's creature by default
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Act of Treason', 'hand', 'p1') }), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: bears }] }]);
    s = resolveStack(s);
    expect(s.objects[bears]!.controller).toBe('p1');
    s = concede(s, 'p3').state;
    expect(s.objects[bears]!.controller).toBe('p1'); // controlled by Alex: it stays
    s = passUntil(s, (x) => x.turn.number === 2, 'the next turn');
    expect(s.objects[bears]).toBeUndefined(); // "until end of turn" ended: Carol, its default controller, has left
    expect(s.zones.exile.map((id) => s.defs[s.objects[id]!.defId]!.name)).toEqual(['Grizzly Bears']);
    expect(logHas(s, /is exiled: the player who would control it has left the game/, 'CR 800.4c')).toBe(true);
  });

  it('CR 104.4a, m12 design D8: players who lose at the same time leave together and share one order; the next set gets the next order', () => {
    let s = mpScenario({ cards: ['Grizzly Bears'], zones: { p2: { battlefield: ['Grizzly Bears'] }, p3: { battlefield: ['Grizzly Bears'] } } });
    s = cloneState(s);
    playerOf(s, 'p2').life = 0;
    playerOf(s, 'p3').life = 0;
    const r = step(s, { type: 'pass', player: 'p1' }); // CR 704.5a as a player would receive priority
    expect(leftEvents(r.events).map((e) => e.player)).toEqual(['p2', 'p3']);
    expect(playerOf(r.state, 'p2').left).toMatchObject({ order: 1, rules: ['CR 704.5a'] });
    expect(playerOf(r.state, 'p3').left).toMatchObject({ order: 1, rules: ['CR 704.5a'] });
    expect(namesOn(r.state)).toEqual([]);
    expect(r.state.result).toBeNull();
    const t = concede(r.state, 'p4').state; // Dan concedes: Alice is the last player in the game (CR 104.2a)
    expect(t.result?.winner).toBe('p1');
    expect(playerOf(t, 'p4').left).toBeUndefined(); // the game is over: nobody leaves (m12 design D8)
    expect(placements(t).map((x) => [x.player, x.place])).toEqual([['p1', 1], ['p4', 2], ['p2', 3], ['p3', 3]]);
  });

  it('CR 104.2a: the last player standing wins and the board stays (nobody leaves a game that is over); CR 104.4a: everyone left losing at once is a draw', () => {
    const s = mpScenario({ players: 3, cards: ['Grizzly Bears'], zones: { p3: { battlefield: ['Grizzly Bears'] } } });
    const t = concede(concede(s, 'p2').state, 'p3').state;
    expect(t.result?.winner).toBe('p1');
    expect(namesOn(t, 'p3')).toEqual(['Grizzly Bears']);
    let u = cloneState(s);
    for (const p of u.players) p.life = 0;
    u = pass(u);
    expect(u.result).toMatchObject({ winner: null });
    expect(u.players.every((p) => p.left === undefined)).toBe(true);
  });

  it('CR 708.9: the face-down permanents of a player who leaves are revealed to everyone, in the playerLeft event and the public log', () => {
    let s = mpScenario({ cards: ['Grizzly Bears'], zones: { p2: { battlefield: ['Grizzly Bears'] } } });
    s = cloneState(s);
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    s.objects[bears]!.faceDown = true;
    const r = concede(s, 'p2');
    expect(leftEvents(r.events)[0]!.revealed).toEqual([{ id: bears, name: 'Grizzly Bears' }]);
    const line = r.state.log.find((l) => /face-down cards are revealed/.test(l.text))!;
    expect(line.text).toContain('Grizzly Bears');
    expect(line.privateText).toBeUndefined();
    expect(line.rules).toContain('CR 708.9');
  });

  it('CR 603.6c: a phased-in permanent leaving the game with its owner triggers leaves-the-battlefield abilities, never "dies" (Blood Artist stays quiet)', () => {
    const watcher = compileCard({ name: 'Departure Watcher', layout: 'normal', mana_cost: '{1}', type_line: 'Enchantment', oracle_text: 'Whenever a creature leaves the battlefield, you gain 1 life.' } as OracleCard);
    let s = mpScenario({ cards: ['Grizzly Bears', 'Blood Artist'], defs: [watcher], zones: { p1: { battlefield: ['Departure Watcher', 'Blood Artist'] }, p2: { battlefield: ['Grizzly Bears', 'Grizzly Bears'] } } });
    s = cloneState(s);
    s.objects[s.zones.battlefield.filter((id) => s.objects[id]!.owner === 'p2')[1]!]!.phasedOut = true; // CR 702.26k: a phased-out one triggers nothing
    s = concede(s, 'p2').state;
    expect(s.zones.stack.map((id) => s.objects[id]!.stack?.sourceName)).toEqual(['Departure Watcher']);
    s = resolveStack(s);
    expect(lifeOf(s, 'p1')).toBe(21);
  });

  it('CR 800.4a: abilities a leaver controls on the stack cease to exist; their spells leave the game', () => {
    let s = mpScenario({ cards: ['Shock', 'Mountain', 'Grizzly Bears'], zones: { p1: { battlefield: ['Grizzly Bears'] }, p2: { hand: ['Shock'], battlefield: ['Mountain'] } } });
    s = pass(s); // Bob gets priority
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Shock', 'hand', 'p2') }), [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p1' }] }]);
    expect(s.zones.stack).toHaveLength(1);
    const t = concede(s, 'p2').state;
    expect(t.zones.stack).toEqual([]);
    expect(lifeOf(t, 'p1')).toBe(20);
    expect(t.pending).toMatchObject({ kind: 'priority', player: 'p3' }); // Bob held priority after casting: it passes to Carol (CR 800.4a)
  });

  it('CR 104.5: a player who left the game can\'t concede again', () => {
    const s = concede(mpScenario(), 'p2').state;
    expect(() => concede(s, 'p2')).toThrow(/already left the game/);
  });
});
