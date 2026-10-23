import { describe, expect, it } from 'vitest';
import { legalActions, type GameState } from '../../src/index';
import { act, answer, find, isTapped, legal, pass, passBoth, pool, reject, scenario } from './scenario';

const tap = (s: GameState, name: string, key = 'r:basic:G', player = 'p1', zone: 'battlefield' = 'battlefield'): GameState =>
  act(s, { type: 'activate', player, source: find(s, name, zone), ability: key });

describe('mana abilities (CR 605)', () => {
  it('CR 305.6 + 605.3b: a basic land taps for mana at once; it does not use the stack and the player keeps priority', () => {
    let s = scenario(['Forest'], { p1: { battlefield: ['Forest'] } });
    s = tap(s, 'Forest');
    expect(s.zones.stack).toEqual([]);
    expect(pool(s, 'p1')).toBe('G');
    expect(isTapped(s, find(s, 'Forest', 'battlefield'))).toBe(true);
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' }); // CR 117.1d: still p1's priority
  });

  it('CR 118.3 + 602.2: a tapped permanent cannot be tapped for mana again', () => {
    let s = scenario(['Forest'], { p1: { battlefield: [{ name: 'Forest', tapped: true }] } });
    const err = reject(s, { type: 'activate', player: 'p1', source: find(s, 'Forest', 'battlefield'), ability: 'r:basic:G' });
    expect(err.message).toMatch(/already tapped/);
    s = scenario(['Forest'], { p1: { battlefield: ['Forest'] } });
    s = tap(s, 'Forest');
    expect(reject(s, { type: 'activate', player: 'p1', source: find(s, 'Forest', 'battlefield'), ability: 'r:basic:G' }).message).toMatch(/already tapped/);
  });

  it('CR 602.2: only the controller can activate a permanent\'s ability (not the opponent, even with priority)', () => {
    let s = scenario(['Forest'], { p1: { battlefield: ['Forest'] } });
    s = pass(s); // p2 now has priority
    expect(s.pending!.player).toBe('p2');
    const err = reject(s, { type: 'activate', player: 'p2', source: find(s, 'Forest', 'battlefield'), ability: 'r:basic:G' });
    expect(err.message).toMatch(/control/);
  });

  it('CR 117.1d: mana abilities can be activated whenever the player has priority, including on the opponent\'s turn', () => {
    let s = scenario(['Forest'], { p2: { battlefield: ['Forest'] } });
    s = pass(s);
    s = tap(s, 'Forest', 'r:basic:G', 'p2');
    expect(pool(s, 'p2')).toBe('G');
  });

  it('CR 500.5, 106.4: unspent mana empties at the end of the step', () => {
    let s = scenario(['Forest'], { p1: { battlefield: ['Forest'] } });
    s = tap(s, 'Forest');
    expect(s.turn.step).toBe('main1');
    s = passBoth(s); // main1 ends
    expect(s.turn.step).toBe('beginCombat');
    expect(pool(s, 'p1')).toBe('');
  });

  it('CR 302.6 + 602.5a: a creature that came under your control this turn cannot use {T} mana abilities (summoning sickness)', () => {
    const s = scenario(['Llanowar Elves'], { p1: { battlefield: [{ name: 'Llanowar Elves', since: 1 }] } });
    const err = reject(s, { type: 'activate', player: 'p1', source: find(s, 'Llanowar Elves', 'battlefield'), ability: 'p:0:0' });
    expect(err.message).toMatch(/summoning sickness/);
    expect(err.rules).toContain('CR 302.6');
    expect(legal(s, 'p1', 'activate')).toHaveLength(0);
  });

  it('CR 302.6: a creature that was under your control since before your turn began can tap for mana', () => {
    let s = scenario(['Llanowar Elves'], { p1: { battlefield: ['Llanowar Elves'] } });
    s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Llanowar Elves', 'battlefield'), ability: 'p:0:0' });
    expect(pool(s, 'p1')).toBe('G');
  });

  it('CR 302.6: summoning sickness also covers the opponent\'s turn right after the creature arrived on yours, and wears off at the start of your next turn', () => {
    // The Elves came under p1's control during turn 1 (p1's own turn).
    let s = scenario(['Llanowar Elves'], { p1: { battlefield: [{ name: 'Llanowar Elves', since: 1 }] }, stops: { fullControl: true } });
    // Walk to p2's turn 2: still sick.
    while (s.turn.number < 2 || s.turn.step !== 'main1') s = pass(s);
    expect(s.turn.activePlayer).toBe('p2');
    s = pass(s); // p2 passes in main1 -> p1 gets priority with an empty stack? p2 is active; pass to p1
    const err = reject(s, { type: 'activate', player: 'p1', source: find(s, 'Llanowar Elves', 'battlefield'), ability: 'p:0:0' });
    expect(err.message).toMatch(/summoning sickness/);
    // Turn 3 (p1): fine.
    while (s.turn.number < 3 || s.turn.step !== 'main1') s = pass(s);
    expect(s.turn.activePlayer).toBe('p1');
    s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Llanowar Elves', 'battlefield'), ability: 'p:0:0' });
    expect(pool(s, 'p1')).toBe('G');
  });

  it('CR 302.6 + CR 305.6: Dryad Arbor (a Land Creature) is affected by summoning sickness', () => {
    const s = scenario(['Dryad Arbor'], { p1: { battlefield: [{ name: 'Dryad Arbor', since: 1 }] } });
    expect(reject(s, { type: 'activate', player: 'p1', source: find(s, 'Dryad Arbor', 'battlefield'), ability: 'r:basic:G' }).message).toMatch(/summoning sickness/);
  });

  it('CR 702.10b: haste ignores summoning sickness for {T} abilities', () => {
    // Synthetic: a hasty mana creature, compiled with the basic compiler (understands "Haste" and the mana ability).
    const s0 = scenario(['Llanowar Elves'], { p1: { battlefield: [{ name: 'Hasty Elf', since: 1 }] }, defs: [hastyElf()] });
    const s = act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Hasty Elf', 'battlefield'), ability: 'p:0:1' });
    expect(pool(s, 'p1')).toBe('G');
  });

  it('CR 106.1b, 605.1a: Sol Ring adds two colorless mana with one activation', () => {
    let s = scenario(['Sol Ring'], { p1: { battlefield: ['Sol Ring'] } });
    s = tap(s, 'Sol Ring', 'p:0:0');
    expect(pool(s, 'p1')).toBe('CC');
  });

  it('CR 106.1b: a mana ability that offers a choice asks for the type; the answer must be one of the options', () => {
    let s = scenario(['Birds of Paradise'], { p1: { battlefield: ['Birds of Paradise'] } });
    s = tap(s, 'Birds of Paradise', 'p:0:1'); // Flying is p:0:0 (printed line order, WP18)
    expect(s.pending).toMatchObject({ kind: 'chooseColor', options: ['W', 'U', 'B', 'R', 'G'], cancellable: true });
    s = answer(s, { kind: 'chooseColor', color: 'U' });
    expect(pool(s, 'p1')).toBe('U');
    expect(s.pending!.kind).toBe('priority');
  });

  it('CR 733.1: cancelling the type choice leaves the permanent untapped and the pool empty', () => {
    let s = scenario(['Birds of Paradise'], { p1: { battlefield: ['Birds of Paradise'] } });
    const before = s;
    s = tap(s, 'Birds of Paradise', 'p:0:1'); // Flying is p:0:0 (printed line order, WP18)
    s = act(s, { type: 'cancel', player: 'p1' });
    expect(isTapped(s, find(s, 'Birds of Paradise', 'battlefield'))).toBe(false);
    expect(pool(s, 'p1')).toBe('');
    expect(s.zones).toEqual(before.zones);
  });

  it('CR 305.6: a dual land (Mountain Forest) offers a separate mana ability per basic land type, and tapping it once uses both', () => {
    let s = scenario(['Taiga'], { p1: { battlefield: ['Taiga'] } });
    const acts = legal(s, 'p1', 'activate');
    expect(acts.map((a) => a.action)).toEqual([
      expect.objectContaining({ ability: 'r:basic:R' }),
      expect.objectContaining({ ability: 'r:basic:G' }),
    ]);
    s = tap(s, 'Taiga', 'r:basic:R');
    expect(pool(s, 'p1')).toBe('R');
    expect(legalActions(s, 'p1').filter((a) => a.kind === 'activate')).toHaveLength(0); // tapped
  });

  it('CR 106.3, 107.4h: mana from a snow source is snow mana', () => {
    let s = scenario(['Snow-Covered Forest', 'Forest'], { p1: { battlefield: ['Snow-Covered Forest', 'Forest'] } });
    s = tap(s, 'Snow-Covered Forest');
    s = tap(s, 'Forest');
    expect(s.players[0]!.manaPool.map((u) => u.snow === true)).toEqual([true, false]);
  });

  it('CR 605.3b + 118.3: a mana ability whose cost sacrifices the permanent (Lotus Petal) adds mana and the permanent goes to the graveyard', () => {
    let s = scenario(['Lotus Petal'], { p1: { battlefield: ['Lotus Petal'] } });
    s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Lotus Petal', 'battlefield'), ability: 'p:0:0' });
    s = answer(s, { kind: 'chooseColor', color: 'R' });
    expect(pool(s, 'p1')).toBe('R');
    expect(s.zones.battlefield).toEqual([]);
    expect(s.zones.graveyard.p1).toHaveLength(1);
    expect(s.zones.stack).toEqual([]);
  });

  it('legal actions list mana abilities, flagged so auto-pass ignores them', () => {
    const s = scenario(['Forest'], { p1: { battlefield: ['Forest'] } });
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate')!;
    expect(a.isMana).toBe(true);
    expect(a.label).toBe('Forest: {T}: Add {G}.');
  });
});

import { compileCard, type CardDef } from '../../src/index';
function hastyElf(): CardDef {
  return compileCard(
    { name: 'Hasty Elf', layout: 'normal', mana_cost: '{G}', type_line: 'Creature — Elf', oracle_text: 'Haste\n{T}: Add {G}.', power: '1', toughness: '1' },
  );
}
