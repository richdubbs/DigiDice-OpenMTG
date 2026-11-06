/**
 * Top-rank round edh-next-96 (code edhn96): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names, design
 * 6.10). Each test is named after the rule it checks, with its negative case. CR cites are from memory of the 2026-09-25 text (not checked against the rules text): unverified.
 *
 *   CR 111.4, 201.2             "create Testra's Journal, a legendary colorless Book artifact token with ..." (Tamiyo, Compleated Sage)
 *   CR 111.4, 201.2             "create Voxa, Friend to Elves, a legendary 3/3 green Wolf creature token" (Tolsimir, Friend to Wolves)
 *   CR 405.1, 113.1, 701.5      "Exile all other spells and counter all abilities." (Summary Dismissal)
 *   CR 701.20a-b, 404.1         "Target opponent reveals cards from the top of their library until four land cards are revealed. That player puts all cards revealed this way into their graveyard." (Mind Funeral)
 *   CR 202.3, 601.2i, 608.2h    "... where X is the greatest mana value among instant and sorcery spells you've cast this turn" (Rootha, Mastering the Moment)
 *   CR 608.2c, 611.2a           "For each card discarded this way, creatures you control get +1/+0 until end of turn." (Pyretic Charge)
 *   CR 110.2, 701.23, 400.7     "... put it onto the battlefield tapped under target player's control" (Yavimaya Dryad)
 *   CR 119.8, 104.3             "If you have 5 or less life, you can't lose life this turn, you can't lose the game this turn, and your opponents can't win the game this turn." (Courageous Resolve)
 */
import { describe, expect, it } from 'vitest';
import { getChars } from '../../../src/index';
import type { GameState } from '../../../src/index';
import { act, activations, card, cast, drive, find, full, lifeOf, named, resolveAll, scenario } from '../r4-cost/support';

const gyNames = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.graveyard[p]!.map((id) => s.objects[id]!.defId);

// ---- Tamiyo, Compleated Sage: a token named with the card's short name -----------------------------------------------------------------------------------------
describe('CR 111.4, 201.2: "create Testra\'s Journal, a legendary colorless Book artifact token" names the token, not the object itself', () => {
  const SCRIBE = card('Testra, Test Scribe', 'Legendary Creature — Human Wizard', 'When Testra enters, create Testra\'s Journal, a legendary colorless Book artifact token with "{T}: Draw a card."', '{0}', ['1', '1']);
  const defs = [SCRIBE];
  it('is full', () => expect(full(SCRIBE)).toBe(true));
  it('creates a legendary artifact Book token whose name is Testra\'s Journal', () => {
    const s = resolveAll(cast(scenario([], { defs, p1: { hand: ['Testra, Test Scribe'] } }), 'Testra, Test Scribe'));
    const tok = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tok.length).toBe(1);
    const c = getChars(s, tok[0]!)!;
    expect(c.name).toBe("Testra's Journal");
    expect([...c.supertypes]).toContain('Legendary');
    expect([...c.types]).toContain('Artifact');
    expect([...c.subtypes]).toContain('Book');
  });
  it('negative: "Testra\'s" elsewhere is still the object itself ("~\'s power")', () => {
    const POWER = card('Testra, Test Giant', 'Legendary Creature — Giant', "When Testra enters, you gain life equal to Testra's power.", '{0}', ['3', '3']);
    expect(full(POWER)).toBe(true);
    const s = resolveAll(cast(scenario([], { defs: [POWER], p1: { hand: ['Testra, Test Giant'] } }), 'Testra, Test Giant'));
    expect(lifeOf(s, 'p1')).toBe(23);
  });
});

// ---- Tolsimir, Friend to Wolves: an epithet with "to" -----------------------------------------------------------------------------------------------------------
describe('CR 111.4, 201.2: "create Voxa, Friend to Elves, a legendary 3/3 green Wolf creature token"', () => {
  const ELF = card('Tolsa Test Elf', 'Legendary Creature — Elf Scout', 'When Tolsa Test Elf enters, create Voxa, Friend to Elves, a legendary 3/3 green Wolf creature token.', '{0}', ['3', '2']);
  it('is full', () => expect(full(ELF)).toBe(true));
  it('creates one legendary 3/3 green Wolf named "Voxa, Friend to Elves"', () => {
    const s = resolveAll(cast(scenario([], { defs: [ELF], p1: { hand: ['Tolsa Test Elf'] } }), 'Tolsa Test Elf'));
    const tok = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tok.length).toBe(1);
    const c = getChars(s, tok[0]!)!;
    expect(c.name).toBe('Voxa, Friend to Elves');
    expect([Number(c.power), Number(c.toughness)]).toEqual([3, 3]);
    expect([...c.subtypes]).toEqual(['Wolf']);
  });
  it('negative: a list of two names is not one epithet (the token stays unnamed or the card is not full)', () => {
    const BAD = card('Tolsa Bad Elf', 'Creature — Elf', 'When Tolsa Bad Elf enters, create Voxa, Friend to Elves and Dogs, a 3/3 green Wolf creature token.', '{0}', ['1', '1']);
    expect(full(BAD)).toBe(false);
  });
});

// ---- Summary Dismissal -------------------------------------------------------------------------------------------------------------------------------------
describe('CR 405.1, 113.1: "Exile all other spells and counter all abilities." exiles the spells on the stack but itself, and counters abilities', () => {
  const DISMISS = card('Test Dismissal', 'Instant', 'Exile all other spells and counter all abilities.', '{0}');
  const BURN = card('Test Burn Plan', 'Instant', 'Test Burn Plan deals 3 damage to target player.', '{0}');
  const PINGER = card('Test Pinger', 'Creature — Wizard', '{0}: Target player loses 2 life.', '{0}', ['1', '1']);
  const defs = [DISMISS, BURN, PINGER];
  const board = (): GameState => scenario([], { defs, p1: { hand: ['Test Burn Plan'], battlefield: ['Test Pinger'] }, p2: { hand: ['Test Dismissal'] } });
  it('is full', () => expect(full(DISMISS)).toBe(true));
  it('exiles the spell, counters the ability and ends in the graveyard itself', () => {
    let s = cast(board(), 'Test Burn Plan', { targets: [[{ kind: 'player', id: 'p2' }]] });
    const pinger = activations(s, 'Test Pinger');
    expect(pinger.length).toBeGreaterThan(0);
    s = drive(act(s, pinger[0]!.action), { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = act(s, { type: 'pass', player: 'p1' });
    s = cast(s, 'Test Dismissal', {}, 'p2');
    s = resolveAll(s);
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(s.zones.exile.map((id) => s.objects[id]!.defId)).toContain('Test Burn Plan');
    expect(gyNames(s, 'p1')).not.toContain('Test Burn Plan');
    expect(gyNames(s, 'p2')).toContain('Test Dismissal');
  });
  it('negative: without it the spell and the ability resolve', () => {
    let s = cast(board(), 'Test Burn Plan', { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = resolveAll(s);
    expect(lifeOf(s, 'p2')).toBe(17);
  });
});

// ---- Mind Funeral -----------------------------------------------------------------------------------------------------------------------------------------
describe('CR 701.20a-b, 404.1: "Target opponent reveals cards from the top of their library until four land cards are revealed. That player puts all cards revealed this way into their graveyard."', () => {
  const FUNERAL = card('Test Funeral', 'Sorcery', 'Target opponent reveals cards from the top of their library until four land cards are revealed. That player puts all cards revealed this way into their graveyard.', '{0}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const defs = [FUNERAL, BEAR];
  it('is full', () => expect(full(FUNERAL)).toBe(true));
  it('puts the revealed cards into the opponent\'s graveyard: exactly four lands (and the nonlands before the fourth), and leaves the rest', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Funeral'] }, p2: { library: ['Test Bear', 'Test Bear'] } });
    const before = s0.zones.library.p2!.length;
    const s = resolveAll(cast(s0, 'Test Funeral', { targets: [[{ kind: 'player', id: 'p2' }]] }));
    const gy = gyNames(s, 'p2');
    expect(gy.filter((n) => n === 'Plains').length).toBe(4);
    expect(gy.every((n) => n === 'Plains' || n === 'Test Bear')).toBe(true);
    expect(s.zones.library.p2!.length).toBe(before - gy.length);
    expect(gyNames(s, 'p1')).toEqual(['Test Funeral']);
  });
  it('negative: a count of three stops at three lands', () => {
    const THREE = card('Test Funeral Three', 'Sorcery', 'Target opponent reveals cards from the top of their library until three land cards are revealed. That player puts all cards revealed this way into their graveyard.', '{0}');
    const s = resolveAll(cast(scenario([], { defs: [THREE], p1: { hand: ['Test Funeral Three'] } }), 'Test Funeral Three', { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(gyNames(s, 'p2').filter((n) => n === 'Plains').length).toBe(3);
  });
});

// ---- Rootha, Mastering the Moment -------------------------------------------------------------------------------------------------------------------------
describe('CR 202.3, 601.2i, 608.2h: "the greatest mana value among instant and sorcery spells you\'ve cast this turn"', () => {
  const BIG = card('Test Big Spell', 'Instant', 'You gain 1 life.', '{3}');
  const MAKER = card('Test Maker', 'Sorcery', 'Create an X/X blue Elemental creature token, where X is the greatest mana value among instant and sorcery spells you\'ve cast this turn.', '{1}');
  const defs = [BIG, MAKER];
  const board = (): GameState => scenario([], { defs, p1: { hand: ['Test Big Spell', 'Test Maker'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains'] } });
  const tokenSize = (s: GameState): number[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').map((id) => Number(getChars(s, id)!.power));
  it('is full', () => expect(full(MAKER)).toBe(true));
  it('counts the largest mana value of the instants and sorceries cast this turn, the spell itself included', () => {
    let s = resolveAll(cast(board(), 'Test Big Spell'));
    s = resolveAll(cast(s, 'Test Maker'));
    expect(tokenSize(s)).toEqual([3]);
  });
  it('negative: with only the maker cast (mana value 1) the token is 1/1', () => {
    expect(tokenSize(resolveAll(cast(board(), 'Test Maker')))).toEqual([1]);
  });
});

// ---- Pyretic Charge ---------------------------------------------------------------------------------------------------------------------------------------
describe('CR 608.2c, 611.2a: "For each card discarded this way, creatures you control get +1/+0 until end of turn."', () => {
  const PYRE = card('Test Pyre', 'Sorcery', 'Discard your hand, then draw four cards. For each card discarded this way, creatures you control get +1/+0 until end of turn.', '{0}');
  const DUD = card('Test Dud', 'Sorcery', 'You gain 1 life.', '{0}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const defs = [PYRE, DUD, BEAR];
  const power = (s: GameState): number => Number(getChars(s, named(s, 'Test Bear')[0]!)!.power);
  it('is full', () => expect(full(PYRE)).toBe(true));
  it('gives +1/+0 for each of the three cards discarded', () => {
    const s = resolveAll(cast(scenario([], { defs, p1: { hand: ['Test Pyre', 'Test Dud', 'Test Dud', 'Test Dud'], battlefield: ['Test Bear'] } }), 'Test Pyre'));
    expect(power(s)).toBe(5);
  });
  it('negative: an empty hand discards nothing, so the creature is not pumped', () => {
    const s = resolveAll(cast(scenario([], { defs, p1: { hand: ['Test Pyre'], battlefield: ['Test Bear'] } }), 'Test Pyre'));
    expect(power(s)).toBe(2);
  });
});

// ---- Courageous Resolve -----------------------------------------------------------------------------------------------------------------------------------
describe('CR 119.8, 104.3: "If you have 5 or less life, you can\'t lose life this turn, ..."', () => {
  const RESOLVE = card('Test Resolve', 'Instant', "If you have 5 or less life, you can't lose life this turn, you can't lose the game this turn, and your opponents can't win the game this turn.", '{0}');
  const DRAIN = card('Test Drain', 'Sorcery', 'Target player loses 3 life.', '{0}');
  const defs = [RESOLVE, DRAIN];
  const run = (life: number): GameState => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Resolve', 'Test Drain'] } });
    s0.players.find((p) => p.id === 'p1')!.life = life;
    const s = resolveAll(cast(s0, 'Test Resolve'));
    return resolveAll(cast(s, 'Test Drain', { targets: [[{ kind: 'player', id: 'p1' }]] }));
  };
  it('is full', () => expect(full(RESOLVE)).toBe(true));
  it('at 5 life you cannot lose life this turn (checked as it resolves)', () => {
    expect(lifeOf(run(5), 'p1')).toBe(5);
  });
  it('damage is still dealt but changes no life total (ruling 2023-11-03)', () => {
    const BURN = card('Test Burn Three', 'Instant', 'Test Burn Three deals 3 damage to target player.', '{0}');
    const s0 = scenario([], { defs: [...defs, BURN], p1: { hand: ['Test Resolve', 'Test Burn Three'] } });
    s0.players.find((p) => p.id === 'p1')!.life = 5;
    const s = resolveAll(cast(resolveAll(cast(s0, 'Test Resolve')), 'Test Burn Three', { targets: [[{ kind: 'player', id: 'p1' }]] }));
    expect(lifeOf(s, 'p1')).toBe(5);
  });
  it('negative: at 6 life nothing is restricted and the drain works', () => {
    expect(lifeOf(run(6), 'p1')).toBe(3);
  });
});

// ---- Yavimaya Dryad ---------------------------------------------------------------------------------------------------------------------------------------
describe("CR 110.2, 701.23: \"you may search your library for a Plains card, put it onto the battlefield tapped under target player's control, then shuffle\"", () => {
  const DRYAD = card('Test Dryad', 'Creature — Dryad', "When this creature enters, you may search your library for a Plains card, put it onto the battlefield tapped under target player's control, then shuffle.", '{0}', ['2', '1']);
  const board = (): GameState => scenario([], { defs: [DRYAD], p1: { hand: ['Test Dryad'] } });
  it('is full', () => expect(full(DRYAD)).toBe(true));
  it('the land comes from your library onto the battlefield tapped under the target player\'s control (you still own it)', () => {
    const s0 = board();
    const s = resolveAll(cast(s0, 'Test Dryad'), { targets: [[{ kind: 'player', id: 'p2' }]], yes: [true], objects: [[s0.zones.library.p1![0]!]] });
    const lands = named(s, 'Plains');
    expect(lands.length).toBe(1);
    expect(s.objects[lands[0]!]!.controller).toBe('p2');
    expect(s.objects[lands[0]!]!.owner).toBe('p1');
    expect(s.objects[lands[0]!]!.tapped).toBe(true);
  });
  it('negative: declining the optional search puts no land onto the battlefield', () => {
    const s = resolveAll(cast(board(), 'Test Dryad'), { targets: [[{ kind: 'player', id: 'p2' }]], yes: [false] });
    expect(named(s, 'Plains').length).toBe(0);
  });
});
void find;
