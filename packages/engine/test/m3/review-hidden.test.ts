/**
 * Fixes from the milestone 3 review: hidden information (CR 400.2), cancellable actions (CR 733.1) and answers that must be
 * rejected cleanly (docs/ARCHITECTURE.md principle 4).
 */
import { describe, expect, it } from 'vitest';
import { viewFor, type GameState, type StopSettings } from '../../src/index';
import { startedGame } from '../helpers';
import { act, answer, find, reject, scenario } from './scenario';

const cardNumber = (cardId: string | undefined): number => Number(cardId!.slice(1));
const idNumber = (id: string): number => Number(id.slice(1));

describe('CR 400.2: hidden cards do not give away their identity through ids', () => {
  it('a deck listed as 20 Forest then 20 Test Bear can\'t be read from the card ids, object ids or timestamps of hidden objects', () => {
    const s = startedGame();
    const v = viewFor(s, 'p2');
    const hidden = [...s.zones.hand.p1!, ...s.zones.library.p1!];
    expect(hidden.length).toBe(40);
    // The old scheme created cards in decklist order, so "number <= 20" meant Forest. That must not predict anything now.
    // (H1: the view carries no card id, timestamp or creation turn on hidden objects at all; the engine's own numbering is checked here.)
    const wrongByCard = hidden.filter((id) => (cardNumber(s.objects[id]!.cardId) <= 20 ? 'Forest' : 'Test Bear') !== s.objects[id]!.defId).length;
    const libraryWrongById = s.zones.library.p1!.filter((id) => (idNumber(id) <= 20 ? 'Forest' : 'Test Bear') !== s.objects[id]!.defId).length;
    const wrongByTime = hidden.filter((id) => (s.objects[id]!.timestamp <= 20 ? 'Forest' : 'Test Bear') !== s.objects[id]!.defId).length;
    expect(wrongByCard).toBeGreaterThan(5);
    expect(libraryWrongById).toBeGreaterThan(3);
    expect(wrongByTime).toBeGreaterThan(5);
    // The opponent's view still names no hidden card, and gives none of them a card id or a timestamp (m4: the hand cards under aliases of that view).
    const shown = [...v.zones.hand.p1!, ...v.zones.library.p1!];
    expect(shown.length).toBe(40);
    expect(shown.every((id) => v.objects[id]!.defId === '__hidden__')).toBe(true);
    expect(shown.every((id) => v.objects[id]!.cardId === undefined && v.objects[id]!.timestamp === 0)).toBe(true);
  });

  it('the cards are the same set as before (ids are only permuted): both players still have their 40 cards', () => {
    const s = startedGame();
    expect(s.zones.hand.p1!.length + s.zones.library.p1!.length).toBe(40);
    expect(new Set(Object.values(s.objects).map((o) => o.cardId)).size).toBe(80);
  });
});

describe('CR 733.1, 400.2: an abandoned cast reveals nothing', () => {
  const cast = (): GameState => {
    const s = scenario(['Fireball', 'Mountain'], { p1: { hand: ['Fireball'], battlefield: Array(3).fill('Mountain') } });
    return act(s, { type: 'cast', player: 'p1', card: find(s, 'Fireball', 'hand') });
  };

  it('while the caster is still choosing X the opponent and spectators see the card in a hand and an empty stack', () => {
    const s = cast();
    expect(s.pending).toMatchObject({ kind: 'chooseNumber', cancellable: true });
    for (const viewer of ['p2', null] as const) {
      const v = viewFor(s, viewer);
      expect(v.zones.stack, String(viewer)).toEqual([]);
      expect(JSON.stringify(v), String(viewer)).not.toContain('Fireball');
      expect(v.pending!.prompt, String(viewer)).not.toMatch(/Fireball|value for X/);
      expect(v.midAction).toBe(true);
    }
    const mine = viewFor(s, 'p1');
    expect(mine.pending!.prompt).toMatch(/Fireball/);
    expect(mine.zones.stack).toHaveLength(1);
  });

  it('after cancelling, the opponent\'s view is what it was before the cast', () => {
    const before = scenario(['Fireball', 'Mountain'], { p1: { hand: ['Fireball'], battlefield: Array(3).fill('Mountain') } });
    const s = act(cast(), { type: 'cancel', player: 'p1' });
    expect(JSON.stringify(viewFor(s, 'p2').zones)).toBe(JSON.stringify(viewFor(before, 'p2').zones));
  });

  it('once the cast is complete the spell is public', () => {
    let s = cast();
    s = answer(s, { kind: 'chooseNumber', n: 1 });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }); // W3b: Fireball's damage line is understood, its targets are announced (CR 601.2c)
    s = answer(s, { kind: 'payCost', auto: true });
    const v = viewFor(s, 'p2');
    expect(v.midAction).toBe(false);
    expect(v.objects[v.zones.stack[0]!]!.defId).toBe('Fireball');
  });
});

describe('manual operations do not reveal hidden cards (CR 400.2)', () => {
  const resolving = (): GameState => {
    let s = scenario(['Lightning Bolt', 'Grizzly Bears', 'Mountain'], { p1: { hand: ['Lightning Bolt'], library: ['Grizzly Bears'], battlefield: ['Mountain'] }, manual: ['Lightning Bolt'] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Lightning Bolt', 'hand') });
    s = answer(s, { kind: 'payCost', auto: true });
    s = act(s, { type: 'pass', player: 'p1' });
    return act(s, { type: 'pass', player: 'p2' });
  };

  it('a card tutored from the library to the hand by hand is named only to the player who may know it', () => {
    let s = resolving();
    expect(s.pending).toMatchObject({ kind: 'manualResolve' });
    const bears = find(s, 'Grizzly Bears', 'library', 'p1');
    s = answer(s, { kind: 'manualResolve', ops: [{ op: 'move', object: bears, to: 'hand' }] });
    const mine = viewFor(s, 'p1').log.map((e) => e.text).join('\n');
    const theirs = viewFor(s, 'p2').log.map((e) => e.text).join('\n');
    expect(mine).toContain('Grizzly Bears');
    expect(theirs).not.toContain('Grizzly Bears');
    expect(theirs).toContain('moves a card to hand by hand');
  });

  it('a card that goes to a public zone is named publicly (that is what milling or discarding shows everyone)', () => {
    let s = resolving();
    const bears = find(s, 'Grizzly Bears', 'library', 'p1');
    s = answer(s, { kind: 'manualResolve', ops: [{ op: 'move', object: bears, to: 'graveyard' }] });
    expect(viewFor(s, 'p2').log.map((e) => e.text).join('\n')).toContain('Grizzly Bears');
  });
});

describe('stops changed while an action is in progress (docs/ARCHITECTURE.md auto-pass)', () => {
  const stops: StopSettings = { fullControl: false, ownTurn: ['main1'], opponentTurn: [] };

  it('setStops during a cast survives answering and cancelling', () => {
    const s0 = scenario(['Fireball', 'Mountain'], { p1: { hand: ['Fireball'], battlefield: Array(3).fill('Mountain') } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Fireball', 'hand') });
    expect(s.players[0]!.stops.fullControl).toBe(true);
    s = act(s, { type: 'setStops', player: 'p1', stops });
    expect(s.players[0]!.stops).toEqual(stops);
    const cancelled = act(s, { type: 'cancel', player: 'p1' });
    expect(cancelled.players[0]!.stops).toEqual(stops);
    s = answer(s, { kind: 'chooseNumber', n: 1 });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }); // W3b: Fireball's damage line is understood, its targets are announced (CR 601.2c)
    s = answer(s, { kind: 'payCost', auto: true });
    expect(s.players[0]!.stops).toEqual(stops);
  });
});

describe('malformed payment answers are rejected, not crashes', () => {
  it('CR 601.2g: a manual payCost answer needs its activations; bad lists are IllegalActions with the state unchanged', () => {
    let s = scenario(['Lightning Bolt', 'Mountain'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] }, manual: ['Lightning Bolt'] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Lightning Bolt', 'hand') });
    expect(s.pending).toMatchObject({ kind: 'payCost' });
    const send = (a: object) => ({ type: 'answer' as const, player: 'p1', decisionId: s.pending!.id, answer: a as never });
    for (const bad of [
      { kind: 'payCost', auto: false },
      { kind: 'payCost', auto: false, activations: 'all' },
      { kind: 'payCost', auto: false, activations: [{ objectId: 'x' }] },
      { kind: 'payCost', auto: false, activations: [null] },
      { kind: 'payCost', auto: false, activations: [], lifeForPhyrexian: 3 },
      { kind: 'payCost', auto: false, activations: [], spendPool: [-1] },
      { kind: 'payCost', auto: false, activations: [], spendPool: [0, 0] },
      { kind: 'payCost' },
    ]) {
      expect(() => reject(s, send(bad)), JSON.stringify(bad)).not.toThrow();
    }
    // A well-formed manual payment still works.
    const t = answer(s, { kind: 'payCost', auto: false, activations: [{ objectId: find(s, 'Mountain', 'battlefield'), abilityKey: 'r:basic:R' }] });
    expect(t.zones.stack).toHaveLength(1);
  });
});
