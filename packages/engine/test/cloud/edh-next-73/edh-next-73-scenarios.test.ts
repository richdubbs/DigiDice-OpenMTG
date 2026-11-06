/**
 * edh-next-73 (Commander lane exile-play, third round): the round's readings played through applyAction with synthetic cards compiled by the game's default compiler
 * (invented names and wordings, design 6.10). Nothing is mocked. Each describe names the rules it pins. CR cites from memory, unverified (cloud session).
 */
import { describe, expect, it } from 'vitest';
import { type Opts, act, activate, answer, automated, card, castFrom, castable, drain, exiled, find, obj, onBattlefield, p2, pass, passTo, scenario, settle } from './support';
import type { GameState } from '../../../src/index';

const TRINKET = card('Test Trinket', 'Artifact', '');
const OX = card('Test Ox', 'Creature — Ox', '', ['1', '4']);
const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 1 damage to any target.');

/** Attack with the creature `name` of p1 (haste) and pass until `done`. */
function attack(s0: GameState, name: string, done: (s: GameState) => boolean, opts: Opts = {}): GameState {
  let s = passTo(s0, (x) => x.pending?.kind === 'declareAttackers');
  s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, name, 'battlefield', 'p1'), defender: 'p2' }] });
  return passTo(s, done, opts, 600);
}

describe('CR 701.23, 701.24, 400.7, 611.2a, 601.3: "search that player\'s library for an artifact card and exile it. Then that player shuffles. Until end of turn, you may play that card."', () => {
  const THIEF = card('Test Thief', 'Creature — Rogue', 'Haste\nWhenever ~ deals combat damage to a player, search that player\'s library for an artifact card and exile it. Then that player shuffles. Until end of turn, you may play that card.', ['2', '2']);
  it('is automated', () => { expect(automated(THIEF)).toBe(true); });
  it('the artifact found is exiled and its attacker may play it this turn; the opponent may not', () => {
    let s = scenario([], { p1: { battlefield: ['Test Thief'] }, p2: { library: ['Test Trinket', 'Plains', 'Plains'] }, defs: [THIEF, TRINKET] });
    s = attack(s, 'Test Thief', (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', { picks: [[find(s, 'Test Trinket', 'library', 'p2')]] });
    const trinket = exiled(s, 'Test Trinket')[0];
    expect(trinket).toBeDefined();
    expect(castable(s)).toContain(trinket);
    expect(castable(s, 'p2')).not.toContain(trinket);
    s = castFrom(s, trinket!);
    expect(onBattlefield(s, 'Test Trinket')).toBeDefined();
  });
  it('negative: without the artifact in the library nothing is exiled and no card may be played', () => {
    let s = scenario([], { p1: { battlefield: ['Test Thief'] }, p2: { library: ['Plains', 'Plains'] }, defs: [THIEF, TRINKET] });
    s = attack(s, 'Test Thief', (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority');
    expect(s.zones.exile.length).toBe(0);
  });
  it('negative: the permission lasts until end of turn only (the card stays exiled and is not castable on the next turn)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Thief'] }, p2: { library: ['Test Trinket', 'Plains', 'Plains'] }, defs: [THIEF, TRINKET] });
    s = attack(s, 'Test Thief', (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', { picks: [[find(s, 'Test Trinket', 'library', 'p2')]] });
    const trinket = exiled(s, 'Test Trinket')[0]!;
    s = passTo(s, (x) => x.turn.number >= 3 && x.turn.step === 'main1' && x.pending?.kind === 'priority', {}, 900);
    expect(exiled(s, 'Test Trinket')).toEqual([trinket]);
    expect(castable(s)).not.toContain(trinket);
  });
});

describe('CR 702.75a, 607.2a, 603.4, 305.1, 118.9: "Hideaway 3, hideaway 3" ... "if there are cards exiled with it, you may play one of them without paying its mana cost."', () => {
  const BEAR = card('Test Bear', 'Creature — Bear', 'Haste\nHideaway 1, hideaway 1\nWhenever ~ deals combat damage to a player, if there are cards exiled with it, you may play one of them without paying its mana cost.', ['2', '2']);
  const BARE = card('Test Bare Bear', 'Creature — Bear', 'Haste\nWhenever ~ deals combat damage to a player, if there are cards exiled with it, you may play one of them without paying its mana cost.', ['2', '2']);
  it('is automated', () => { expect(automated(BEAR)).toBe(true); expect(automated(BARE)).toBe(false); /* no exiling instruction on the face: unlinked, stays manual */ });
  it('negative: with no card exiled with it the intervening "if" is false and nothing is played', () => {
    const NOHIDE = card('Test Hideless Bear', 'Creature — Bear', 'Haste\n{9}: Exile the top card of your library.\nWhenever ~ deals combat damage to a player, if there are cards exiled with it, you may play one of them without paying its mana cost.', ['2', '2']);
    expect(automated(NOHIDE)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Hideless Bear'], hand: ['Test Ox'] }, p2: { library: ['Plains'] }, defs: [NOHIDE, OX] });
    s = attack(s, 'Test Hideless Bear', (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority');
    expect(s.pending?.kind).toBe('priority');
    expect(onBattlefield(s, 'Test Ox')).toBeUndefined();
  });
  it('after two hideaways the combat damage trigger lets the controller play one of the two cards for free (a land too is played, not cast)', () => {
    let s = scenario([], { p1: { hand: ['Test Bear'], library: ['Test Ox', 'Plains', 'Plains', 'Test Ox', 'Plains'] }, p2: { library: ['Plains'] }, defs: [BEAR, OX] });
    s = castFrom(s, find(s, 'Test Bear', 'hand', 'p1'), { picks: [[find(s, 'Test Ox', 'library', 'p1')], [find(s, 'Plains', 'library', 'p1')]] });
    expect(exiled(s, 'Plains').length + exiled(s, 'Test Ox').length).toBe(2);
    s = attack(s, 'Test Bear', (x) => x.pending?.kind === 'chooseObjects' || (x.turn.step === 'main2' && x.pending?.kind === 'priority'));
    expect(s.pending?.kind).toBe('chooseObjects');
    const ox = exiled(s, 'Test Ox')[0]!;
    s = drain(settle(answer(s, { kind: 'chooseObjects', ids: [ox] })));
    expect(onBattlefield(s, 'Test Ox')).toBeDefined();
  });
});

describe('CR 601.3, 305.1, 122.1, 400.7: "You may play lands and cast spells from among cards you own in exile with croak counters on them."', () => {
  const FROG = card('Test Frog', 'Creature — Frog', '{0}: Exile the top card of your library with a croak counter on it.\n{0}: Exile the top card of your library.\nYou may play lands and cast spells from among cards you own in exile with croak counters on them.', ['1', '1']);
  const THIEF2 = card('Test Pickpocket', 'Creature — Rogue', '{0}: Exile the top card of target opponent\'s library with a croak counter on it.', ['1', '1']);
  it('is automated', () => { expect(automated(FROG)).toBe(true); });
  it('a card of yours exiled with a croak counter can be cast; a card exiled without the counter cannot', () => {
    let s = scenario([], { p1: { battlefield: ['Test Frog'], library: ['Test Ox', 'Test Trinket', 'Plains'] }, defs: [FROG, OX, TRINKET] });
    const frog = find(s, 'Test Frog', 'battlefield', 'p1');
    s = activate(s, frog, 'p:0:0');
    s = activate(s, frog, 'p:0:1');
    const ox = exiled(s, 'Test Ox')[0]!;
    const trinket = exiled(s, 'Test Trinket')[0]!;
    expect(castable(s)).toContain(ox);
    expect(castable(s)).not.toContain(trinket);
    s = castFrom(s, ox);
    expect(onBattlefield(s, 'Test Ox')).toBeDefined();
  });
  it('negative: the opponent cannot cast it, and a card of the opponent\'s exiled with a croak counter is not "owned by you"', () => {
    let s = scenario([], { p1: { battlefield: ['Test Frog', 'Test Pickpocket'], library: ['Test Ox'] }, p2: { library: ['Test Trinket', 'Plains'] }, defs: [FROG, THIEF2, OX, TRINKET] });
    s = activate(s, find(s, 'Test Frog', 'battlefield', 'p1'), 'p:0:0');
    const ox = exiled(s, 'Test Ox')[0]!;
    expect(castable(s, 'p2')).not.toContain(ox);
    s = activate(s, find(s, 'Test Pickpocket', 'battlefield', 'p1'), 'p:0:0', { targets: [[p2]] });
    const trinket = exiled(s, 'Test Trinket')[0]!;
    expect(castable(s)).toContain(ox);
    expect(castable(s)).not.toContain(trinket);
  });
});

describe('CR 607.2a, 400.7, 608.2c: "Exile target creature. Then if there are three or more cards exiled with ~, <do X>." (the ability both exiles and reads its own link; Profane Procession)', () => {
  const PROC = card('Test Procession', 'Enchantment', '{0}: Exile target creature. Then if there are three or more cards exiled with ~, draw a card.');
  it('is automated', () => { expect(automated(PROC)).toBe(true); });
  it('the card is drawn only when the third creature is exiled with it, not for the first two', () => {
    let s = scenario([], { p1: { battlefield: ['Test Procession', 'Test Ox', 'Test Ox', 'Test Ox'], library: ['Plains', 'Plains', 'Plains', 'Plains'] }, defs: [PROC, OX] });
    const proc = find(s, 'Test Procession', 'battlefield', 'p1');
    const handSize = (x: GameState) => x.zones.hand.p1!.length;
    const h0 = handSize(s);
    for (let i = 0; i < 3; i++) {
      const ox = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Ox')!;
      s = activate(s, proc, 'p:0:0', { targets: [[obj(ox)]] });
      expect(handSize(s) - h0).toBe(i === 2 ? 1 : 0);
    }
  });
});
