/**
 * Commander lane graveyard, third round edh-next-80 (code edhn80): the round's readings played through the engine with synthetic cards compiled by the game's default
 * compiler (invented names, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites are from memory (no rules/cr in cloud sessions): unverified.
 *
 *   CR 608.2d, 202.3   "Return any number of creature cards with total mana value 5 or less from your graveyard to the battlefield." (Technomancer)
 *   CR 608.2d, 208.1   "... any number of other creature cards with total power X or less ..., where X is this creature's power." (Moorland Rescuer)
 *   CR 608.2g, 601.2   "Cast any number of red instant and/or sorcery cards from your graveyard without paying their mana costs." (Chandra Ablaze)
 *   CR 608.2d, 202.3   "Return any number of cards with different mana values from your graveyard to your hand." (Seasons Past)
 *   CR 608.2c          "Return a creature card from your graveyard to the battlefield, then return another creature card from your graveyard to your hand." (Blood for Bones)
 *   CR 113.6m, 400.7   "{0}: Return this card and up to one other target creature card from your graveyard to the battlefield." (Slimefoot and Squee)
 *   CR 113.6, 613.1f   "As long as ~ is in your graveyard, creatures you control have haste." (Riftstone Portal)
 *   CR 708.3, 400.7    "... return ~ from your graveyard to the battlefield face up or face down." (Deathmist Raptor)
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type GameState, type ObjectId } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, card, cast, drive, find, full, obj, passBoth, resolveAll, scenario } from '../r3-cost/support';

const nameOf = (s: GameState, id: string): string => getChars(s, id).name;
const gy = (s: GameState): string[] => s.zones.graveyard.p1!.map((id) => nameOf(s, id)).sort();
const hand = (s: GameState): string[] => s.zones.hand.p1!.map((id) => nameOf(s, id)).sort();
const bf = (s: GameState): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1').map((id) => nameOf(s, id)).sort();
const idsIn = (s: GameState, name: string): ObjectId[] => s.zones.graveyard.p1!.filter((id) => nameOf(s, id) === name);

const C1 = card('Test One', 'Creature — Bear', '', '{1}', ['1', '1']);
const C2 = card('Test Two', 'Creature — Bear', '', '{2}', ['2', '2']);
const C3 = card('Test Three', 'Creature — Bear', '', '{3}', ['3', '3']);
const C4 = card('Test Four', 'Creature — Bear', '', '{4}', ['4', '4']);

describe('"Return any number of creature cards with total mana value 5 or less from your graveyard to the battlefield." (CR 608.2d, 202.3; Technomancer)', () => {
  const SPELL = card('Test Raise', 'Sorcery', 'Return any number of creature cards with total mana value 5 or less from your graveyard to the battlefield.');
  const defs = [SPELL, C1, C2, C3, C4];
  const start = (): GameState => scenario([], { p1: { hand: ['Test Raise'], graveyard: ['Test Two', 'Test Three', 'Test Four'] }, p2: {}, defs });
  it('has no manual part', () => expect(full(SPELL)).toBe(true));
  it('returns the chosen cards when their total mana value is within the limit', () => {
    const s0 = start();
    const s = resolveAll(cast(s0, 'Test Raise'), { objects: [[idsIn(s0, 'Test Two')[0]!, idsIn(s0, 'Test Three')[0]!]] });
    expect(bf(s)).toEqual(['Test Three', 'Test Two']);
    expect(gy(s)).toEqual(['Test Four', 'Test Raise']);
  });
  it('negative: a choice over the total (3 + 4) is refused, and choosing none returns none', () => {
    const s0 = start();
    expect(() => resolveAll(cast(s0, 'Test Raise'), { objects: [[idsIn(s0, 'Test Three')[0]!, idsIn(s0, 'Test Four')[0]!]] })).toThrow();
    const s = resolveAll(cast(s0, 'Test Raise'), { objects: [[]] });
    expect(bf(s)).toEqual([]);
  });
});

describe('"... any number of other creature cards with total power X or less ..., where X is this creature\'s power" (CR 608.2d, 208.1; Moorland Rescuer)', () => {
  const RESCUER = card('Test Rescuer', 'Creature — Human', 'When this creature enters, return any number of other creature cards with total power X or less from your graveyard to the battlefield, where X is this creature\'s power.', '{0}', ['3', '3']);
  const defs = [RESCUER, C1, C2, C3];
  it('has no manual part', () => expect(full(RESCUER)).toBe(true));
  it('returns cards whose powers add up to at most the creature\'s power', () => {
    const s0 = scenario([], { p1: { hand: ['Test Rescuer'], graveyard: ['Test One', 'Test Two', 'Test Three'] }, p2: {}, defs });
    const s = resolveAll(cast(s0, 'Test Rescuer'), { objects: [[idsIn(s0, 'Test One')[0]!, idsIn(s0, 'Test Two')[0]!]] });
    expect(bf(s)).toEqual(['Test One', 'Test Rescuer', 'Test Two']);
  });
  it('negative: 2 + 3 is over 3 and is refused', () => {
    const s0 = scenario([], { p1: { hand: ['Test Rescuer'], graveyard: ['Test One', 'Test Two', 'Test Three'] }, p2: {}, defs });
    expect(() => resolveAll(cast(s0, 'Test Rescuer'), { objects: [[idsIn(s0, 'Test Two')[0]!, idsIn(s0, 'Test Three')[0]!]] })).toThrow();
  });
});

describe('"When this creature dies, return any number of other creature cards with total power X or less ..., where X is this creature\'s power." (CR 608.2h, 603.10a; Moorland Rescuer ruling: the power it last had on the battlefield)', () => {
  const RESCUER = card('Test Dying Rescuer', 'Creature — Human', 'When this creature dies, return any number of other creature cards with total power X or less from your graveyard to the battlefield, where X is this creature\'s power. Exile this card.', '{0}', ['3', '3']);
  const ANTHEM = card('Test Anthem', 'Enchantment', 'Creatures you control get +1/+1.');
  const DOOM = card('Test Doom', 'Sorcery', 'Destroy target creature.');
  const defs = [RESCUER, ANTHEM, DOOM, C4];
  it('has no manual part', () => expect(full(RESCUER)).toBe(true));
  it('reads the power it had on the battlefield (4 with the anthem), not its power in the graveyard (3), and exiles itself afterwards', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Dying Rescuer', 'Test Anthem'], hand: ['Test Doom'], graveyard: ['Test Four'] }, p2: {}, defs });
    const target = find(s0, 'Test Dying Rescuer', 'battlefield', 'p1');
    const s = resolveAll(cast(s0, 'Test Doom', { targets: [[obj(target)]] }), { objects: [[idsIn(s0, 'Test Four')[0]!]] });
    expect(bf(s)).toEqual(['Test Anthem', 'Test Four']);
    expect(s.zones.exile.map((id) => nameOf(s, id))).toEqual(['Test Dying Rescuer']);
  });
});

describe('"Cast any number of red instant and/or sorcery cards from your graveyard without paying their mana costs." (CR 608.2g, 601.2; Chandra Ablaze)', () => {
  const CAST = card('Test Burst', 'Sorcery', 'Cast any number of red instant and/or sorcery cards from your graveyard without paying their mana costs.');
  const DRAW = card('Test Red Draw', 'Instant', 'Draw a card.', '{2}{R}', undefined, ['R']);
  const STUDY = card('Test Red Study', 'Sorcery', 'You gain 2 life.', '{1}{R}', undefined, ['R']);
  const BLUE = card('Test Blue Draw', 'Instant', 'Draw a card.', '{1}{U}', undefined, ['U']);
  const RED_BEAR = card('Test Red Bear', 'Creature — Bear', '', '{1}{R}', ['2', '2'], ['R']);
  const defs = [CAST, DRAW, STUDY, BLUE, RED_BEAR];
  const start = (): GameState => scenario(['Mountain'], { p1: { hand: ['Test Burst'], graveyard: ['Test Red Draw', 'Test Red Study', 'Test Blue Draw', 'Test Red Bear'] }, p2: {}, defs });
  it('has no manual part', () => expect(full(CAST)).toBe(true));
  it('casts every chosen red instant or sorcery without paying, and only those are offered', () => {
    const s0 = start();
    let s = cast(s0, 'Test Burst');
    s = resolveAll(s, { objects: [[idsIn(s0, 'Test Red Draw')[0]!, idsIn(s0, 'Test Red Study')[0]!]] });
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(22);
    expect(hand(s).length).toBe(1);
    expect(gy(s)).toEqual(['Test Blue Draw', 'Test Burst', 'Test Red Bear', 'Test Red Draw', 'Test Red Study']);
  });
  it('negative: the blue instant and the red creature are not offered to the choice', () => {
    const s0 = start();
    const s = passAfterCast(s0);
    const p = s.pending;
    expect(p?.kind === 'chooseObjects' ? p.options.map((id) => nameOf(s, id)).sort() : []).toEqual(['Test Red Draw', 'Test Red Study']);
  });
  function passAfterCast(s0: GameState): GameState {
    return passBoth(cast(s0, 'Test Burst'));
  }
});

describe('"Return any number of cards with different mana values from your graveyard to your hand." (CR 608.2d, 202.3; Seasons Past)', () => {
  const PAST = card('Test Seasons', 'Sorcery', 'Return any number of cards with different mana values from your graveyard to your hand. Put ~ on the bottom of its owner\'s library.');
  const defs = [PAST, C1, C2, C4];
  const start = (): GameState => scenario([], { p1: { hand: ['Test Seasons'], graveyard: ['Test One', 'Test One', 'Test Two'] }, p2: {}, defs });
  it('has no manual part', () => expect(full(PAST)).toBe(true));
  it('returns one card of each mana value chosen', () => {
    const s0 = start();
    const s = resolveAll(cast(s0, 'Test Seasons'), { objects: [[idsIn(s0, 'Test One')[0]!], [idsIn(s0, 'Test Two')[0]!]] });
    expect(hand(s)).toEqual(['Test One', 'Test Two']);
    expect(gy(s)).toEqual(['Test One']);
  });
  it('negative: two cards of one mana value are refused', () => {
    const s0 = start();
    const ones = idsIn(s0, 'Test One');
    expect(() => resolveAll(cast(s0, 'Test Seasons'), { objects: [[ones[0]!], [ones[1]!]] })).toThrow();
  });
});

describe('"Return a creature card ... to the battlefield, then return another creature card ... to your hand." (CR 608.2c; Blood for Bones)', () => {
  const BONES = card('Test Bones', 'Sorcery', 'Return a creature card from your graveyard to the battlefield, then return another creature card from your graveyard to your hand.');
  const defs = [BONES, C1, C2, C3];
  it('has no manual part', () => expect(full(BONES)).toBe(true));
  it('puts the first chosen card onto the battlefield and a different one into your hand', () => {
    const s0 = scenario([], { p1: { hand: ['Test Bones'], graveyard: ['Test One', 'Test Two', 'Test Three'] }, p2: {}, defs });
    const s = resolveAll(cast(s0, 'Test Bones'), { objects: [[idsIn(s0, 'Test One')[0]!], [idsIn(s0, 'Test Two')[0]!]] });
    expect(bf(s)).toEqual(['Test One']);
    expect(hand(s)).toEqual(['Test Two']);
    expect(gy(s)).toEqual(['Test Bones', 'Test Three']);
  });
  it('negative: with one creature card only, it goes to the battlefield and nothing goes to the hand', () => {
    const s0 = scenario([], { p1: { hand: ['Test Bones'], graveyard: ['Test One'] }, p2: {}, defs });
    const s = resolveAll(cast(s0, 'Test Bones'));
    expect(bf(s)).toEqual(['Test One']);
    expect(hand(s)).toEqual([]);
  });
});

describe('"You may cast a creature, instant, sorcery, or planeswalker spell from your graveyard with mana value less than or equal to that spell\'s mana value without paying its mana cost." (CR 608.2g, 202.3; Counterpoint)', () => {
  const POINT = card('Test Counterpoint', 'Instant', 'Counter target spell. You may cast a creature, instant, sorcery, or planeswalker spell from your graveyard with mana value less than or equal to that spell\'s mana value without paying its mana cost.');
  const LUMP = card('Test Lump', 'Creature — Bear', '', '{2}', ['2', '2']);
  const defs = [POINT, LUMP, C1, C4];
  const start = (): GameState => {
    const s0 = scenario(['Island'], { p1: { battlefield: ['Island', 'Island'], hand: ['Test Lump', 'Test Counterpoint'], graveyard: ['Test One', 'Test Four'] }, p2: {}, defs });
    const withLump = cast(s0, 'Test Lump');
    const lump = withLump.zones.stack[withLump.zones.stack.length - 1]!;
    return drive(act(withLump, { type: 'cast', player: 'p1', card: find(withLump, 'Test Counterpoint', 'hand', 'p1') }), { targets: [[obj(lump)]] });
  };
  it('has no manual part', () => expect(full(POINT)).toBe(true));
  it('offers only cards of mana value 2 or less (the countered spell\'s), and casts the chosen one for free', () => {
    const s0 = start();
    const pending = passBoth(s0);
    expect(pending.pending?.kind === 'chooseObjects' ? pending.pending.options.map((id) => nameOf(pending, id)).sort() : []).toEqual(['Test Lump', 'Test One']);
    const s = resolveAll(s0, { objects: [[s0.zones.graveyard.p1!.find((id) => nameOf(s0, id) === 'Test One')!]] });
    expect(bf(s)).toEqual(['Island', 'Island', 'Test One']);
    expect(gy(s)).toEqual(['Test Counterpoint', 'Test Four', 'Test Lump']);
  });
});

describe('"{0}: Return this card and up to one other target creature card from your graveyard to the battlefield." (CR 113.6m, 400.7; Slimefoot and Squee)', () => {
  const SLIME = card('Test Slime', 'Creature — Fungus', '{0}: Return this card and up to one other target creature card from your graveyard to the battlefield. Activate only as a sorcery.', '{0}', ['1', '1']);
  const defs = [SLIME, C2];
  it('has no manual part', () => expect(full(SLIME)).toBe(true));
  it('returns itself and the other target from the graveyard', () => {
    const s0 = scenario([], { p1: { graveyard: ['Test Slime', 'Test Two'] }, p2: {}, defs });
    const a = legalActions(s0, 'p1').find((x) => x.kind === 'activate' && s0.objects[x.object!]?.zone === 'graveyard');
    expect(a).toBeDefined();
    const s = resolveAll(drive(act(s0, a!.action), { targets: [[obj(idsIn(s0, 'Test Two')[0]!)]] }));
    expect(bf(s)).toEqual(['Test Slime', 'Test Two']);
  });
  it('negative: with no other target it returns only itself', () => {
    const s0 = scenario([], { p1: { graveyard: ['Test Slime'] }, p2: {}, defs });
    const a = legalActions(s0, 'p1').find((x) => x.kind === 'activate' && s0.objects[x.object!]?.zone === 'graveyard');
    const s = resolveAll(drive(act(s0, a!.action), { targets: [[]] }));
    expect(bf(s)).toEqual(['Test Slime']);
  });
});

describe('"As long as ~ is in your graveyard, creatures you control have haste." (CR 113.6, 613.1f; Riftstone Portal)', () => {
  const PORTAL = card('Test Portal', 'Land', 'As long as ~ is in your graveyard, creatures you control have haste.');
  const defs = [PORTAL, C2];
  const hasHaste = (s: GameState, id: string): boolean => hasKeyword(getChars(s, id)!, 'haste');
  it('has no manual part', () => expect(full(PORTAL)).toBe(true));
  it('gives haste while the card is in the graveyard', () => {
    const s = scenario([], { p1: { battlefield: ['Test Two'], graveyard: ['Test Portal'] }, p2: {}, defs });
    expect(hasHaste(s, find(s, 'Test Two', 'battlefield', 'p1'))).toBe(true);
  });
  it('negative: no haste while the card is on the battlefield or in hand', () => {
    const s = scenario([], { p1: { battlefield: ['Test Two', 'Test Portal'] }, p2: {}, defs });
    expect(hasHaste(s, find(s, 'Test Two', 'battlefield', 'p1'))).toBe(false);
    const t = scenario([], { p1: { battlefield: ['Test Two'], hand: ['Test Portal'] }, p2: {}, defs });
    expect(hasHaste(t, find(t, 'Test Two', 'battlefield', 'p1'))).toBe(false);
  });
});

describe('"... return ~ from your graveyard to the battlefield face up or face down." (CR 708.3, 400.7; Deathmist Raptor)', () => {
  const RAPTOR = card('Test Raptor', 'Creature — Lizard', '{0}: You may return ~ from your graveyard to the battlefield face up or face down.', '{0}', ['3', '3']);
  const defs = [RAPTOR];
  const run = (down: boolean): GameState => {
    const s0 = scenario([], { p1: { graveyard: ['Test Raptor'] }, p2: {}, defs });
    const a = legalActions(s0, 'p1').find((x) => x.kind === 'activate' && s0.objects[x.object!]?.zone === 'graveyard');
    expect(a).toBeDefined();
    return resolveAll(drive(act(s0, a!.action)), { yes: [true, down] });
  };
  it('has no manual part', () => expect(full(RAPTOR)).toBe(true));
  it('enters face down as a 2/2 when the player says so', () => {
    const s = run(true);
    const id = s.zones.battlefield.find((x) => s.objects[x]!.owner === 'p1')!;
    expect(s.objects[id]!.faceDown).toBe(true);
    expect(getChars(s, id).power).toBe('2');
  });
  it('negative: enters face up as itself when the player says so', () => {
    const s = run(false);
    const id = s.zones.battlefield.find((x) => s.objects[x]!.owner === 'p1')!;
    expect(s.objects[id]!.faceDown).toBe(false);
    expect(nameOf(s, id)).toBe('Test Raptor');
  });
});
