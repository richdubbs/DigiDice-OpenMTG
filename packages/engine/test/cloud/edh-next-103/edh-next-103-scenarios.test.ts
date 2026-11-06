/**
 * Top-rank round edh-next-103 (code edhn103, second pass 7): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites are from memory of the 2026-09-25 text: unverified.
 *
 *   CR 106.4, 500.5, 514.2   "that player adds {G}{G}. Until end of turn, they don't lose this mana as steps and phases end." (Shizuko, Caller of Autumn)
 *   CR 208.1, 603.10a, 400.7 "you may put a creature card with equal or lesser toughness from your hand onto the battlefield" (Bane, Lord of Darkness)
 */
import { describe, expect, it } from 'vitest';
import { getChars } from '../../../src/index';
import { advanceTo, legal, pool } from '../../m3/scenario';
import { activations, card, cast, drive, find, full, named, resolveAll, scenario } from '../r4-cost/support';
import { act } from '../r4-cost/support';

// ---- Shizuko, Caller of Autumn -------------------------------------------------------------------------------------------------------------------------------
describe('CR 106.4, 500.5, 514.2: "that player adds {G}{G}. Until end of turn, they don\'t lose this mana as steps and phases end."', () => {
  const KEEP = card('Test Autumn Bloom', 'Enchantment', "At the beginning of each player's upkeep, that player adds {G}{G}. Until end of turn, they don't lose this mana as steps and phases end.");
  const LOSE = card('Test Autumn Fade', 'Enchantment', "At the beginning of each player's upkeep, that player adds {G}{G}.");
  it('is full', () => expect(full(KEEP)).toBe(true));
  it("the active opponent's mana survives the end of the upkeep step (and is still there in the draw step)", () => {
    let s = scenario([], { defs: [KEEP], p1: { battlefield: ['Test Autumn Bloom'] } });
    s = advanceTo(s, 2, 'upkeep');
    s = resolveAll(s);
    expect(pool(s, 'p2')).toBe('GG');
    s = advanceTo(s, 2, 'draw');
    expect(pool(s, 'p2')).toBe('GG');
    expect(pool(s, 'p1')).toBe('');
  });
  it('negative: without the sentence the mana is gone when the step ends', () => {
    let s = scenario([], { defs: [LOSE], p1: { battlefield: ['Test Autumn Fade'] } });
    s = advanceTo(s, 2, 'upkeep');
    s = resolveAll(s);
    expect(pool(s, 'p2')).toBe('GG');
    s = advanceTo(s, 2, 'draw');
    expect(pool(s, 'p2')).toBe('');
  });
  it('negative: "they" after mana of your own is not read (the gate refuses: the card is not full)', () => {
    expect(full(card('Test Autumn Self', 'Enchantment', "At the beginning of your upkeep, add {G}{G}. Until end of turn, they don't lose this mana as steps and phases end."))).toBe(false);
  });
});

// ---- Bane, Lord of Darkness ------------------------------------------------------------------------------------------------------------------------------------
describe('CR 208.1, 603.10a: "If they don\'t, you may put a creature card with equal or lesser toughness from your hand onto the battlefield."', () => {
  const BANE = card('Test Baneling', 'Legendary Creature — Vampire', 'Whenever another nontoken creature you control dies, target opponent may have you draw a card. If they don\'t, you may put a creature card with equal or lesser toughness from your hand onto the battlefield.', '{0}', ['3', '3']);
  const VICTIM = card('Test Victim', 'Creature — Bear', '', '{0}', ['2', '3']);
  const SMALL = card('Test Small Hand', 'Creature — Bear', '', '{0}', ['1', '3']);
  const BIG = card('Test Big Hand', 'Creature — Bear', '', '{0}', ['5', '4']);
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.', '{0}');
  const defs = [BANE, VICTIM, SMALL, BIG, KILL];
  const board = () => scenario([], { defs, p1: { battlefield: ['Test Baneling', 'Test Victim'], hand: ['Test Small Hand', 'Test Big Hand', 'Test Kill'] } });
  const kill = () => {
    const s0 = board();
    return cast(s0, 'Test Kill', { targets: [[{ kind: 'object', id: find(s0, 'Test Victim', 'battlefield', 'p1') }]] });
  };
  it('is full', () => expect(full(BANE)).toBe(true));
  it('the opponent declines the draw: only a creature card with toughness 3 or less may be put onto the battlefield', () => {
    const s0 = kill();
    const s = resolveAll(s0, { targets: [[{ kind: 'player', id: 'p2' }]], yes: [false], objects: [[find(s0, 'Test Small Hand', 'hand', 'p1')]] });
    expect(named(s, 'Test Small Hand').length).toBe(1);
    expect(named(s, 'Test Big Hand').length).toBe(0);
  });
  it('negative: the opponent lets you draw: nothing is put onto the battlefield', () => {
    const s0 = kill();
    const hand = s0.zones.hand.p1!.length;
    const s = resolveAll(s0, { targets: [[{ kind: 'player', id: 'p2' }]], yes: [true] });
    expect(named(s, 'Test Small Hand').length).toBe(0);
    expect(s.zones.hand.p1!.length).toBe(hand + 1);
  });
  it('negative: a card with toughness above the dead creature is not offered (toughness 4 > 3)', () => {
    const s0 = kill();
    expect(() => resolveAll(s0, { targets: [[{ kind: 'player', id: 'p2' }]], yes: [false], objects: [[find(s0, 'Test Big Hand', 'hand', 'p1')]] })).toThrow(/not a legal choice/);
  });
});

// ---- Toxicrene ---------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 613.1f, 605.1a: "All lands have "{T}: Add one mana of any color" and lose all other abilities."', () => {
  const MIASMA = card('Test Miasma', 'Creature — Hydra', 'All lands have "{T}: Add one mana of any color" and lose all other abilities.', '{0}', ['2', '2']);
  const PLAIN = card('Test Plain Fog', 'Creature — Hydra', 'All lands have "{T}: Add one mana of any color."', '{0}', ['2', '2']);
  const HOLLOW = card('Test Hollow', 'Land', '{T}: Add {B}.\n{1}, {T}: Draw a card.');
  const defs = [MIASMA, PLAIN, HOLLOW];
  it('is full', () => expect(full(MIASMA)).toBe(true));
  it('every land keeps only the granted mana ability: the printed draw ability is lost, the granted mana ability is there', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Miasma', 'Test Hollow', 'Plains'] } });
    expect(activations(s, 'Test Hollow', false).length).toBe(0);
    expect(activations(s, 'Test Hollow', true).length).toBeGreaterThan(0);
  });
  it('negative: without "lose all other abilities" the printed non-mana ability stays', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Plain Fog', 'Test Hollow', 'Plains'] } });
    expect(activations(s, 'Test Hollow', false).length).toBeGreaterThan(0);
  });
  it('negative: the creature that makes the effect is not a land and keeps its own abilities', () => {
    const KW = card('Test Miasma Flyer', 'Creature — Hydra', 'Flying\nAll lands have "{T}: Add one mana of any color" and lose all other abilities.', '{0}', ['2', '2']);
    const s = scenario([], { defs: [KW], p1: { battlefield: ['Test Miasma Flyer'] } });
    expect([...getChars(s, find(s, 'Test Miasma Flyer', 'battlefield', 'p1'))!.abilities].some((a) => a.def.kind === 'keyword' && a.def.keyword === 'flying')).toBe(true);
  });
});

// ---- March of the Machines -----------------------------------------------------------------------------------------------------------------------------------
describe('CR 613.1d, 613.4b, 205.1b: "Each noncreature artifact is an artifact creature with power and toughness each equal to its mana value."', () => {
  const MARCH = card('Test March', 'Enchantment', 'Each noncreature artifact is an artifact creature with power and toughness each equal to its mana value.');
  const ROCK = card('Test Rock', 'Artifact', '{T}: Add {C}.', '{3}');
  const ROBOT = card('Test Robot', 'Artifact Creature — Construct', '', '{2}', ['1', '1']);
  const FORGE = card('Test Forge', 'Enchantment Artifact', '', '{2}');
  const defs = [MARCH, ROCK, ROBOT, FORGE];
  const chars = (s: ReturnType<typeof scenario>, name: string) => getChars(s, find(s, name, 'battlefield', 'p1'))!;
  it('is full', () => expect(full(MARCH)).toBe(true));
  it('a noncreature artifact becomes a creature whose power and toughness are its mana value (3/3); an enchantment artifact keeps being an enchantment (ruling 2004-12-01)', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test March', 'Test Rock', 'Test Forge'] } });
    const rock = chars(s, 'Test Rock');
    expect([...rock.types].sort()).toEqual(['Artifact', 'Creature']);
    expect([Number(rock.power), Number(rock.toughness)]).toEqual([3, 3]);
    const forge = chars(s, 'Test Forge');
    expect([...forge.types].sort()).toEqual(['Artifact', 'Creature', 'Enchantment']); // ruling 2004-12-01: it keeps its other types
    expect([Number(forge.power), Number(forge.toughness)]).toEqual([2, 2]);
  });
  it('negative: an artifact creature is not changed (its own 1/1 stays, not its mana value 2), and without the enchantment the rock is no creature', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test March', 'Test Robot'] } });
    expect([Number(chars(s, 'Test Robot').power), Number(chars(s, 'Test Robot').toughness)]).toEqual([1, 1]);
    const t = scenario([], { defs, p1: { battlefield: ['Test Rock'] } });
    expect([...chars(t, 'Test Rock').types]).not.toContain('Creature');
  });
});

// ---- Skyblade's Boon ---------------------------------------------------------------------------------------------------------------------------------------
describe('CR 113.6m, 602.5b: "Activate only if ~ is on the battlefield or in your graveyard."', () => {
  const BOON = card('Test Recall', 'Enchantment', '{0}: Return ~ to its owner\'s hand. Activate only if ~ is on the battlefield or in your graveyard.');
  const offered = (s: ReturnType<typeof scenario>, zone: 'battlefield' | 'graveyard' | 'hand') =>
    legal(s, 'p1', 'activate').filter((a) => a.object === find(s, 'Test Recall', zone, 'p1')).length;
  it('is full', () => expect(full(BOON)).toBe(true));
  it('can be activated while it is on the battlefield', () => expect(offered(scenario([], { defs: [BOON], p1: { battlefield: ['Test Recall'] } }), 'battlefield')).toBeGreaterThan(0));
  it('and while it is in your graveyard', () => expect(offered(scenario([], { defs: [BOON], p1: { graveyard: ['Test Recall'] } }), 'graveyard')).toBeGreaterThan(0));
  it('negative: not from your hand', () => expect(offered(scenario([], { defs: [BOON], p1: { hand: ['Test Recall'] } }), 'hand')).toBe(0));
  it('activated from the graveyard it returns to its owner\'s hand', () => {
    const s0 = scenario([], { defs: [BOON], p1: { graveyard: ['Test Recall'] } });
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === find(s0, 'Test Recall', 'graveyard', 'p1'))!;
    const s = resolveAll(drive(act(s0, a.action)));
    expect(s.zones.hand.p1!.map((id) => s.objects[id]!.defId)).toContain('Test Recall');
  });
});
void drive; void act;
