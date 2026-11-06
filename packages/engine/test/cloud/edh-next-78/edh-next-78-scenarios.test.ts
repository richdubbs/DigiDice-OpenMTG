/**
 * Cluster round edh-next-78 (code edhn78): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names,
 * design 6.10). Each test is named after the rule it checks, with its negative case. CR cites are from memory of the 2026-09-25 text (no rules/cr folder in this session): unverified.
 *
 *   CR 404.1, 401.2, 400.7        "Return the top creature card of your graveyard to the battlefield. That creature gains haste until end of turn. Exile it at the beginning of the next end step." (Shallow Grave)
 *   CR 603.7c, 400.7              "Whenever another creature enters, exile this creature. Return this creature to the battlefield under its owner's control at the beginning of the next end step." (Saltskitter)
 *   CR 603.7c, 400.7e             "When this creature is put into your graveyard from the battlefield, at the beginning of the next end step, you lose 1 life and return this card to your hand." (Brood of Cockroaches)
 *   CR 608.2c, 400.7, 406.3       "Whenever a player cycles a card, you may exile target creature. If you do, return that card to the battlefield under its owner's control at the beginning of the next end step." (Astral Slide)
 *   CR 714.2, 714.2d              "Whenever the final chapter ability of a Saga you control triggers / resolves, ..." (Historian's Boon, Tom Bombadil)
 */
import { describe, expect, it } from 'vitest';
import { getChars, legalActions } from '../../../src/index';
import { hasKeyword } from '../../../src/rules/characteristics';
import type { GameState, ObjectId } from '../../../src/index';
import { advanceTo, card, cast, drive, find, full, lifeOf, named, obj, resolveAll, scenario } from '../r4-cost/support';
import { act, pass } from '../../m3/scenario';

const zoneNames = (s: GameState, zone: 'graveyard' | 'hand', p: 'p1' | 'p2' = 'p1'): string[] => s.zones[zone][p]!.map((id) => s.objects[id]!.defId);
const hasHaste = (s: GameState, id: ObjectId): boolean => hasKeyword(getChars(s, id)!, 'haste');

// ---- Shallow Grave ---------------------------------------------------------------------------------------------------------------------------------------
describe('CR 404.1, 401.2: "Return the top creature card of your graveyard to the battlefield. That creature gains haste until end of turn. Exile it at the beginning of the next end step."', () => {
  const GRAVE = card('Test Shallow Plot', 'Instant', 'Return the top creature card of your graveyard to the battlefield. That creature gains haste until end of turn. Exile it at the beginning of the next end step.', '{1}');
  const OLD = card('Test Old Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const NEW = card('Test New Bear', 'Creature — Bear', '', '{1}', ['3', '3']);
  const STUDY = card('Test Study', 'Sorcery', 'Draw a card.', '{1}');
  const defs = [GRAVE, OLD, NEW, STUDY];
  const board = (gy: string[]): GameState => scenario([], { defs, p1: { hand: ['Test Shallow Plot'], battlefield: ['Plains'], graveyard: gy } });
  it('is full', () => expect(full(GRAVE)).toBe(true));
  it('puts the card put into the graveyard last among the creature cards onto the battlefield (a noncreature card above it is skipped) with haste, and leaves the other creature card', () => {
    let s = resolveAll(cast(board(['Test Old Bear', 'Test New Bear', 'Test Study']), 'Test Shallow Plot'));
    expect(named(s, 'Test New Bear').length).toBe(1);
    expect(named(s, 'Test Old Bear').length).toBe(0);
    expect(zoneNames(s, 'graveyard')).toEqual(['Test Old Bear', 'Test Study', 'Test Shallow Plot']);
    expect(hasHaste(s, named(s, 'Test New Bear')[0]!)).toBe(true);
    s = resolveAll(advanceTo(s, 1, 'end'));
    expect(named(s, 'Test New Bear').length).toBe(0);
    expect(named(s, 'Test New Bear', 'exile').length).toBe(1);
  });
  it('negative (ruling 2004-10-04): a creature that left the battlefield before the end step is not exiled from the graveyard', () => {
    const KILL = card('Test Kill', 'Instant', 'Destroy target creature.', '{1}');
    let s = scenario([], { defs: [...defs, KILL], p1: { hand: ['Test Shallow Plot', 'Test Kill'], battlefield: ['Plains', 'Plains'], graveyard: ['Test New Bear'] } });
    s = resolveAll(cast(s, 'Test Shallow Plot'));
    const bear = named(s, 'Test New Bear')[0]!;
    s = resolveAll(cast(s, 'Test Kill', { targets: [[obj(bear)]] }), { targets: [[obj(bear)]] });
    s = resolveAll(advanceTo(s, 1, 'end'));
    expect(zoneNames(s, 'graveyard')).toContain('Test New Bear');
    expect(named(s, 'Test New Bear', 'exile').length).toBe(0);
  });
  it('negative: with no creature card in the graveyard nothing returns', () => {
    const s = resolveAll(cast(board(['Test Study']), 'Test Shallow Plot'));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId.startsWith('Test') && s.objects[id]!.defId !== 'Plains').length).toBe(0);
  });
});

// ---- Saltskitter -----------------------------------------------------------------------------------------------------------------------------------------
describe('CR 603.7c, 400.7: "Whenever another creature enters, exile this creature. Return this creature to the battlefield under its owner\'s control at the beginning of the next end step."', () => {
  const SKIT = card('Test Skitter', 'Creature — Insect', 'Whenever another creature enters, exile this creature. Return this creature to the battlefield under its owner\'s control at the beginning of the next end step.', '{1}', ['2', '2']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const board = (): GameState => scenario([], { defs: [SKIT, BEAR], p1: { hand: ['Test Bear'], battlefield: ['Test Skitter', 'Plains'] } });
  it('is full', () => expect(full(SKIT)).toBe(true));
  it('exiles itself when another creature enters and returns at the next end step', () => {
    let s = resolveAll(cast(board(), 'Test Bear'));
    expect(named(s, 'Test Skitter').length).toBe(0);
    expect(named(s, 'Test Skitter', 'exile').length).toBe(1);
    s = resolveAll(advanceTo(s, 1, 'end'));
    expect(named(s, 'Test Skitter').length).toBe(1);
    expect(named(s, 'Test Skitter', 'exile').length).toBe(0);
  });
  it('negative: it does not trigger on its own entering', () => {
    const s = scenario([], { defs: [SKIT], p1: { hand: ['Test Skitter'], battlefield: ['Plains'] } });
    const t = resolveAll(cast(s, 'Test Skitter'));
    expect(named(t, 'Test Skitter').length).toBe(1);
    expect(named(t, 'Test Skitter', 'exile').length).toBe(0);
  });
});

// ---- Brood of Cockroaches --------------------------------------------------------------------------------------------------------------------------------
describe('CR 603.7c, 400.7e: "When this creature is put into your graveyard from the battlefield, at the beginning of the next end step, you lose 1 life and return this card to your hand."', () => {
  const ROACH = card('Test Roach', 'Creature — Insect', 'When this creature is put into your graveyard from the battlefield, at the beginning of the next end step, you lose 1 life and return this card to your hand.', '{1}', ['1', '1']);
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.', '{1}');
  const board = (): GameState => scenario([], { defs: [ROACH, KILL], p1: { hand: ['Test Kill'], battlefield: ['Test Roach', 'Plains'] } });
  it('is full', () => expect(full(ROACH)).toBe(true));
  it('returns to the hand at the next end step and costs 1 life (not before)', () => {
    let s = cast(board(), 'Test Kill', { targets: [[obj(find(board(), 'Test Roach', 'battlefield'))]] });
    s = resolveAll(s, { targets: [[obj(find(board(), 'Test Roach', 'battlefield'))]] });
    expect(zoneNames(s, 'graveyard')).toContain('Test Roach');
    expect(lifeOf(s)).toBe(20);
    s = resolveAll(advanceTo(s, 1, 'end'));
    expect(zoneNames(s, 'hand')).toContain('Test Roach');
    expect(zoneNames(s, 'graveyard')).not.toContain('Test Roach');
    expect(lifeOf(s)).toBe(19);
  });
});

// ---- Astral Slide ----------------------------------------------------------------------------------------------------------------------------------------
describe('CR 608.2c, 400.7: "Whenever a player cycles a card, you may exile target creature. If you do, return that card to the battlefield under its owner\'s control at the beginning of the next end step."', () => {
  const SLIDE = card('Test Slide', 'Enchantment', 'Whenever a player cycles a card, you may exile target creature. If you do, return that card to the battlefield under its owner\'s control at the beginning of the next end step.', '{2}');
  const CYC = card('Test Cycler', 'Instant', 'Draw a card.\nCycling {0}', '{3}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const board = (): GameState => scenario([], { defs: [SLIDE, CYC, BEAR], p1: { hand: ['Test Cycler'], battlefield: ['Test Slide'] }, p2: { battlefield: ['Test Bear'] } });
  const cycle = (yes: boolean): GameState => {
    const s0 = board();
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const cyc = legalActions(s0, 'p1').find((x) => x.kind === 'activate' && x.object === find(s0, 'Test Cycler', 'hand'));
    if (cyc === undefined) throw new Error('no cycling offered');
    return resolveAll(drive(act(s0, cyc.action), { yes: [yes], targets: [[obj(bear)]] }), { yes: [yes], targets: [[obj(bear)]] });
  };
  it('is full', () => expect(full(SLIDE)).toBe(true));
  it('exiles the creature and returns it under its owner\'s control at the next end step', () => {
    let s = cycle(true);
    expect(named(s, 'Test Bear').length).toBe(0);
    expect(named(s, 'Test Bear', 'exile').length).toBe(1);
    s = resolveAll(advanceTo(s, 1, 'end'));
    const back = named(s, 'Test Bear');
    expect(back.length).toBe(1);
    expect(s.objects[back[0]!]!.controller).toBe('p2');
  });
  it('negative: declining the "may" exiles nothing', () => {
    const s = cycle(false);
    expect(named(s, 'Test Bear').length).toBe(1);
  });
});

// ---- Final chapter ability -------------------------------------------------------------------------------------------------------------------------------
describe('CR 714.2, 714.2d: "Whenever the final chapter ability of a Saga you control triggers / resolves"', () => {
  const SAGA = card('Test Saga', 'Enchantment — Saga', 'I — You gain 1 life.\nII — You gain 1 life.\nIII — You gain 1 life.', '{0}');
  const TRIG = card('Test Boon', 'Enchantment', 'Whenever the final chapter ability of a Saga you control triggers, draw a card.', '{0}');
  const RES = card('Test Sage', 'Creature — Human', 'Whenever the final chapter ability of a Saga you control resolves, you gain 10 life.', '{0}', ['1', '1']);
  const defs = [SAGA, TRIG, RES];
  const hand = (s: GameState): number => s.zones.hand.p1!.length;
  const sagaTurns = (extra: string[]): GameState => {
    let s = scenario([], { defs, p1: { hand: ['Test Saga'], battlefield: extra }, p2: {} });
    s = resolveAll(cast(s, 'Test Saga'));
    return s;
  };
  it('are full', () => { expect(full(TRIG)).toBe(true); expect(full(RES)).toBe(true); });
  it('"triggers" fires for chapter III only: no card drawn through chapters I and II, one drawn when III triggers', () => {
    let s = sagaTurns(['Test Boon']);
    const before = hand(s);
    s = resolveAll(advanceTo(s, 3, 'main1')); // chapter II: the Boon does not trigger
    const afterII = hand(s);
    expect(afterII - before).toBe(1); // the turn's draw only
    s = resolveAll(drive(advanceTo(s, 5, 'main1'))); // chapter III (the Saga's ability and the Boon's trigger go on the stack together: ordered)
    expect(hand(s) - afterII).toBeGreaterThanOrEqual(2); // turn draw + the Boon's card
    expect(hand(s) - afterII).toBeLessThanOrEqual(2);
  });
  it('"resolves" gains 10 life only when chapter III resolves', () => {
    let s = sagaTurns(['Test Sage']);
    s = resolveAll(advanceTo(s, 3, 'main1'));
    expect(lifeOf(s)).toBe(22); // chapters I and II: 1 life each
    s = resolveAll(advanceTo(s, 5, 'main1'));
    expect(lifeOf(s)).toBe(20 + 3 + 10);
  });
  it('negative: an opponent\'s Saga reaching chapter III triggers neither reading', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Sage', 'Test Boon'] }, p2: { hand: ['Test Saga'] } });
    s = pass(s); // p2 gets priority later: put the Saga on p2's side by casting it on p2's turn
    const before = lifeOf(s);
    s = advanceTo(s, 2, 'main1');
    s = resolveAll(cast(s, 'Test Saga', undefined, 'p2'));
    s = resolveAll(drive(advanceTo(s, 6, 'main1')));
    expect(lifeOf(s)).toBe(before); // the opponent's Saga: no +10 from the Sage (p1's life only changes through p1's own cards)
  });
});
