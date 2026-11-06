/**
 * Top-rank second pass 8, edh-next-98 (code edhn98): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented
 * names, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites are from memory of the 2026-09-25 text (unverified).
 *
 *   CR 608.2c, 608.2h, 119.3   "Exile up to two target cards from graveyards. For each creature card exiled this way, each opponent loses 1 life and you gain 1 life." (Graveyard Trespasser)
 *   CR 118.3, 107.14, 608.2d   "Pay {E}{E}. If you can't, return this creature to its owner's hand and you get {E}." (Greenbelt Rampager)
 *   CR 400.3, 603.4            "if a creature card left your graveyard this turn" (Syrix, Carrier of the Flame)
 *   CR 506.3, 508.1            "the number of opponents being attacked" (Dimir Strandcatcher)
 *   CR 400.3, 603.4            "three or more cards were put into your graveyard from anywhere other than the battlefield this turn" (Dimir Strandcatcher)
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { answer, pass } from '../../m3/scenario';
import { opponentsAttackedCount } from '../../../src/rules/history';
import { advanceTo, card, cast, find, full, lifeOf, named, obj, resolveAll, scenario } from '../r4-cost/support';

const zoneNames = (s: GameState, zone: 'graveyard' | 'hand', p: 'p1' | 'p2' = 'p1'): string[] => s.zones[zone][p]!.map((id) => s.objects[id]!.defId);
const energy = (s: GameState): number => ((s.players[0]! as unknown as { counters?: Record<string, number> }).counters?.['energy'] ?? 0);
const withEnergy = (s: GameState, n: number): GameState => {
  const t = structuredClone(s);
  (t.players[0]! as unknown as { counters?: Record<string, number> }).counters = { energy: n };
  return t;
};

describe('CR 608.2c, 119.3: "For each creature card exiled this way, each opponent loses 1 life and you gain 1 life."', () => {
  const WALKER = card('Test Gravewalker', 'Creature — Zombie', 'When this creature enters, exile up to two target cards from graveyards. For each creature card exiled this way, each opponent loses 1 life and you gain 1 life.', '{0}', ['2', '2']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const ROCK = card('Test Rock', 'Artifact', '', '{1}');
  const defs = [WALKER, BEAR, ROCK];
  const board = (): GameState => scenario([], { defs, p1: { hand: ['Test Gravewalker'], graveyard: ['Test Bear'] }, p2: { graveyard: ['Test Bear', 'Test Rock'] } });
  it('is full', () => expect(full(WALKER)).toBe(true));
  it('exiles the targets; the two creature cards drain 2, the artifact card nothing', () => {
    const s0 = board();
    const targets = [obj(find(s0, 'Test Bear', 'graveyard', 'p1')), obj(find(s0, 'Test Bear', 'graveyard', 'p2'))];
    const s = resolveAll(cast(s0, 'Test Gravewalker', { targets: [targets] }), { targets: [targets] });
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual([]);
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(lifeOf(s, 'p1')).toBe(22);
  });
  it('the two creature cards are ONE life gain and ONE life loss (a "whenever you gain life" creature triggers once, review finding; Suffer the Past ruling)', () => {
    const PRIDE = card('Test Pridemate', 'Creature — Cat', 'Whenever you gain life, put a +1/+1 counter on this creature.', '{0}', ['2', '2']);
    const s0 = scenario([], { defs: [...defs, PRIDE], p1: { hand: ['Test Gravewalker'], battlefield: ['Test Pridemate'], graveyard: ['Test Bear'] }, p2: { graveyard: ['Test Bear', 'Test Rock'] } });
    const targets = [obj(find(s0, 'Test Bear', 'graveyard', 'p1')), obj(find(s0, 'Test Bear', 'graveyard', 'p2'))];
    const s = resolveAll(cast(s0, 'Test Gravewalker', { targets: [targets] }), { targets: [targets] });
    const counters = Object.values(s.objects[named(s, 'Test Pridemate')[0]!]!.counters).reduce((a, b) => a + b, 0);
    expect(counters).toBe(1);
    expect(lifeOf(s, 'p1')).toBe(22);
  });
  it('negative: exiling a creature card and an artifact card drains only 1', () => {
    const s0 = board();
    const targets = [obj(find(s0, 'Test Bear', 'graveyard', 'p2')), obj(find(s0, 'Test Rock', 'graveyard', 'p2'))];
    const s = resolveAll(cast(s0, 'Test Gravewalker', { targets: [targets] }), { targets: [targets] });
    expect(lifeOf(s, 'p2')).toBe(19);
    expect(lifeOf(s, 'p1')).toBe(21);
  });
  it('negative: exiling only the artifact card drains nothing', () => {
    const s0 = board();
    const targets = [obj(find(s0, 'Test Rock', 'graveyard', 'p2'))];
    const s = resolveAll(cast(s0, 'Test Gravewalker', { targets: [targets] }), { targets: [targets] });
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
});

describe('CR 118.3, 107.14, 608.2d: "Pay {E}{E}. If you can\'t, return this creature to its owner\'s hand and you get {E}."', () => {
  const RAMP = card('Test Rampager', 'Creature — Beast', 'When this creature enters, pay {E}{E}. If you can\'t, return this creature to its owner\'s hand and you get {E}.', '{0}', ['2', '2']);
  const board = (n: number): GameState => withEnergy(scenario([], { defs: [RAMP], p1: { hand: ['Test Rampager'] } }), n);
  it('is full', () => expect(full(RAMP)).toBe(true));
  it('with two energy the payment is made (it is an instruction, not a choice): the creature stays, no energy left', () => {
    const s = resolveAll(cast(board(2), 'Test Rampager'));
    expect(named(s, 'Test Rampager').length).toBe(1);
    expect(energy(s)).toBe(0);
  });
  it('with one energy it can\'t pay: the creature returns to hand and its controller gets {E}', () => {
    const s = resolveAll(cast(board(1), 'Test Rampager'));
    expect(named(s, 'Test Rampager').length).toBe(0);
    expect(zoneNames(s, 'hand')).toEqual(['Test Rampager']);
    expect(energy(s)).toBe(2);
  });
  it('negative: "you may pay" with "if you can\'t" is not read this way (the creature stays manual)', () => {
    const MAY = card('Test Maybe', 'Creature — Beast', 'When this creature enters, you may pay {E}{E}. If you can\'t, return this creature to its owner\'s hand.', '{0}', ['2', '2']);
    expect(full(MAY)).toBe(false);
  });
});

describe('CR 400.3, 603.4: "if a creature card left your graveyard this turn"', () => {
  const PHOENIX = card('Test Phoenix', 'Creature — Phoenix', 'At the beginning of each end step, if a creature card left your graveyard this turn, you gain 3 life.', '{0}', ['2', '2']);
  const RAISE = card('Test Raise', 'Sorcery', 'Return target card from your graveyard to your hand.', '{0}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const ROCK = card('Test Rock', 'Artifact', '', '{1}');
  const defs = [PHOENIX, RAISE, BEAR, ROCK];
  const play = (grave: string): GameState => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Raise'], battlefield: ['Test Phoenix'], graveyard: [grave] } });
    const t = [obj(find(s0, grave, 'graveyard', 'p1'))];
    const s = resolveAll(cast(s0, 'Test Raise', { targets: [t] }), { targets: [t] });
    return resolveAll(advanceTo(s, 1, 'end'));
  };
  it('is full', () => expect(full(PHOENIX)).toBe(true));
  it('a creature card returned from the graveyard: the end step trigger gains 3', () => expect(lifeOf(play('Test Bear'), 'p1')).toBe(23));
  it('negative: an artifact card returned from the graveyard: nothing', () => expect(lifeOf(play('Test Rock'), 'p1')).toBe(20));
});

describe('CR 506.3, 508.1: "the number of opponents being attacked" and the graveyard history', () => {
  const CATCHER = card('Test Catcher', 'Creature — Sphinx', 'Whenever you attack, scry X, where X is the number of opponents being attacked.', '{0}', ['2', '2']);
  const FILLER = card('Test Filler', 'Artifact', '', '{1}');
  const COUNTER = card('Test Counter', 'Creature — Sphinx', 'At the beginning of each end step, if three or more cards were put into your graveyard from anywhere other than the battlefield this turn, you gain 5 life.', '{0}', ['2', '2']);
  const DISCARD = card('Test Discard', 'Sorcery', 'Discard two cards.', '{0}');
  const defs = [CATCHER, FILLER, COUNTER, DISCARD];
  it('both are full', () => { expect(full(CATCHER)).toBe(true); expect(full(COUNTER)).toBe(true); });
  it('attacking one opponent scries 1 (one card to look at)', () => {
    const s0 = scenario([], { defs, p1: { battlefield: [{ name: 'Test Catcher', since: -1 }] } });
    let s = s0;
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = pass(s);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s0, 'Test Catcher', 'battlefield'), defender: 'p2' }] });
    for (let i = 0; i < 20 && s.pending?.kind === 'priority'; i++) s = pass(s);
    const p = s.pending as unknown as { kind: string; cards?: unknown[]; ids?: unknown[]; options?: unknown[] };
    expect(p.kind).not.toBe('priority');
    expect((p.cards ?? p.ids ?? p.options ?? []).length).toBe(1);
  });
  it('a player who has left the game since the attack is not counted (ruling 2024-02-02, CR 800.4a)', () => {
    const s0 = scenario([], { defs, p1: { battlefield: [{ name: 'Test Catcher', since: -1 }] } });
    let s = s0;
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = pass(s);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s0, 'Test Catcher', 'battlefield'), defender: 'p2' }] });
    expect(opponentsAttackedCount(s, 'p1', s.combat!.number)).toBe(1);
    const t = structuredClone(s);
    t.players.find((x) => x.id === 'p2')!.hasLost = true;
    expect(opponentsAttackedCount(t, 'p1', t.combat!.number, true)).toBe(0);
    expect(opponentsAttackedCount(t, 'p1', t.combat!.number)).toBe(1); // melee and the turn counts keep counting him (Adriana, Rose rulings)
  });
  it('negative: no attack, no scry', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Catcher'] } });
    expect(advanceTo(s0, 1, 'end').pending?.kind).toBe('priority');
  });
  it('the spell itself plus two discarded cards is three cards put into the graveyard from outside the battlefield: gains 5', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Discard', 'Test Filler', 'Test Filler'], battlefield: ['Test Counter'] } });
    const s = resolveAll(cast(s0, 'Test Discard'));
    expect(lifeOf(resolveAll(advanceTo(s, 1, 'end')), 'p1')).toBe(25);
  });
  it('negative: only the spell and one discarded card is two: nothing', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Discard', 'Test Filler'], battlefield: ['Test Counter'] } });
    const s = resolveAll(cast(s0, 'Test Discard'));
    expect(lifeOf(resolveAll(advanceTo(s, 1, 'end')), 'p1')).toBe(20);
  });
});

describe('CR 701.9a, 608.2c, 202.3: "You may discard a nonland card. If you do, search your library for a card with the same mana value as that card, ..." ("that card" is the discarded card)', () => {
  const DISCIPLE = card('Test Disciple', 'Creature — Wizard', 'At the beginning of your upkeep, you may discard a nonland card. If you do, search your library for a card with the same mana value as that card, reveal it, put it into your hand, then shuffle.', '{0}', ['1', '1']);
  const TWO = card('Test Two', 'Artifact', '', '{2}');
  const TWO_B = card('Test Two Library', 'Artifact', '', '{2}');
  const THREE = card('Test Three Library', 'Artifact', '', '{3}');
  const defs = [DISCIPLE, TWO, TWO_B, THREE];
  const board = (): GameState => scenario([], { defs, p1: { hand: ['Test Two'], battlefield: ['Test Disciple'], library: ['Test Three Library', 'Test Two Library'] } });
  it('is full', () => expect(full(DISCIPLE)).toBe(true));
  it('discarding the mana value 2 card finds the mana value 2 card, not the 3', () => {
    const s0 = board();
    const s = resolveAll(advanceTo(s0, 3, 'upkeep'), { yes: [true], objects: [[find(s0, 'Test Two Library', 'library')]] });
    expect(zoneNames(s, 'graveyard')).toEqual(['Test Two']);
    expect(zoneNames(s, 'hand')).toContain('Test Two Library');
    expect(zoneNames(s, 'hand')).not.toContain('Test Three Library');
  });
  it('negative: declining the discard searches for nothing', () => {
    const s0 = board();
    const s = resolveAll(advanceTo(s0, 3, 'upkeep'), { yes: [false] });
    expect(zoneNames(s, 'hand')).not.toContain('Test Two Library');
    expect(zoneNames(s, 'graveyard')).toEqual([]);
  });
});
