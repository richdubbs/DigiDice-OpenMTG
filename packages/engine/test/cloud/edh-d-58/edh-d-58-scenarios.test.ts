/**
 * edh-d-58 (Commander coordinator D, lane exile-play, fourth pass): the round's readings played through applyAction with synthetic cards compiled by the game's default compiler (invented
 * names and wordings, design 6.10). Nothing is mocked. Each describe names the rules it pins. CR cites from memory, unverified (cloud session).
 */
import { describe, expect, it } from 'vitest';
import { act, answer, automated, card, cast, castFrom, castable, exiled, find, obj, onBattlefield, passTo, scenario, activate, legal } from './support';

const OX = card('Test Ox', 'Creature — Ox', '', ['1', '4']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{2}');
const BLUE = card('Test Blue Bird', 'Creature — Bird', '', ['1', '1'], '{U}');
const SWORD = card('Test Sword', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nEquip {2}', undefined, '{5}');
const MTN = card('Test Mountain', 'Land', '{T}: Add {R}.');
const FOR = card('Test Forest', 'Land', '{T}: Add {G}.');
const LAND = ['Test Mountain', 'Test Mountain', 'Test Mountain', 'Test Mountain'];

describe('CR 611.2a, 514.2, 601.3, 305.1: "Exile the top card of your library. During your next turn, you may play that card."', () => {
  const RELAY = card('Test Relay', 'Artifact', '{T}: Exile the top card of your library. During your next turn, you may play that card.');
  const start = () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Relay'], library: ['Test Ox', 'Test Mountain', 'Test Mountain'], hand: [] }, p2: { library: ['Test Mountain', 'Test Mountain', 'Test Mountain', 'Test Mountain'] }, defs: [MTN, FOR, RELAY, OX] });
    return activate(s0, find(s0, 'Test Relay', 'battlefield', 'p1'), 'p:0:0');
  };
  it('is automated', () => { expect(automated(RELAY)).toBe(true); });
  it('the card is exiled but may not be played the rest of this turn', () => {
    const s = start();
    const ox = exiled(s, 'Test Ox')[0];
    expect(ox).toBeDefined();
    expect(castable(s)).not.toContain(ox);
  });
  it('it may be played on your next turn, and then only on that turn', () => {
    let s = start();
    const ox = exiled(s, 'Test Ox')[0]!;
    s = passTo(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.kind === 'priority', {}, 900);
    expect(castable(s, 'p1')).not.toContain(ox);
    s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'main1' && x.pending?.kind === 'priority', {}, 900);
    expect(castable(s)).toContain(ox);
    s = castFrom(s, ox);
    expect(onBattlefield(s, 'Test Ox')).toBeDefined();
  });
  it('negative: after that turn is over the card can no longer be played', () => {
    let s = start();
    const ox = exiled(s, 'Test Ox')[0]!;
    s = passTo(s, (x) => x.turn.number === 5 && x.turn.step === 'main1' && x.pending?.kind === 'priority', {}, 1500);
    expect(exiled(s, 'Test Ox')).toEqual([ox]);
    expect(castable(s)).not.toContain(ox);
  });
});

describe('CR 608.2c, 611.2b, 609.4b: "Exile all creatures. For each card exiled this way, you may play that card for as long as it remains exiled, and mana of any type can be spent to cast that spell."', () => {
  const WRATH = card('Test Wrath', 'Sorcery', 'Exile all creatures. For each card exiled this way, you may play that card for as long as it remains exiled, and mana of any type can be spent to cast that spell.', undefined, '{0}');
  it('is automated', () => { expect(automated(WRATH)).toBe(true); });
  it('every creature exiled (either player\'s) may be cast by the caster with mana of any type', () => {
    const s0 = scenario([], { p1: { hand: ['Test Wrath'], battlefield: ['Test Mountain'] }, p2: { battlefield: ['Test Blue Bird'] }, defs: [MTN, FOR, WRATH, BLUE] });
    const s = cast(s0, 'Test Wrath');
    const bird = exiled(s, 'Test Blue Bird')[0]!;
    expect(bird).toBeDefined();
    expect(castable(s, 'p1')).toContain(bird); // {U} paid with the Mountain's red mana
    expect(castable(s, 'p2')).not.toContain(bird);
    expect(onBattlefield(castFrom(s, bird), 'Test Blue Bird')).toBeDefined();
  });
  it('negative: without the rider a blue creature cannot be cast with red mana', () => {
    const s0 = scenario([], { p1: { hand: [], battlefield: ['Test Mountain'] }, p2: { battlefield: [] }, defs: [MTN, FOR, BLUE] });
    expect(legal(s0, 'p1', 'cast').length).toBe(0);
  });
});

describe('CR 608.2c, 611.2b, 609.4b: "Exile all opponents\' graveyards. Choose a nonland card exiled this way. You may cast that card for as long as it remains exiled, and you may spend mana as though it were mana of any color to cast that spell."', () => {
  const AUTHOR = card('Test Author', 'Creature — Horror', 'When this creature enters, exile all opponents\' graveyards. Choose a nonland card exiled this way. You may cast that card for as long as it remains exiled, and you may spend mana as though it were mana of any color to cast that spell.', ['1', '1']);
  it('is automated', () => { expect(automated(AUTHOR)).toBe(true); });
  it('the chosen nonland card (a land is not a choice) may be cast with other colors of mana; the other cards stay exiled and uncastable', () => {
    const s0 = scenario([], { p1: { hand: ['Test Author'], battlefield: ['Test Mountain'] }, p2: { graveyard: ['Test Blue Bird', 'Test Forest', 'Test Ox'] }, defs: [MTN, FOR, AUTHOR, BLUE, OX] });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Author', 'hand', 'p1') });
    s = passTo(s, (x) => x.pending?.kind === 'chooseObjects', {}, 40);
    const choices = (s.pending as unknown as { options?: string[]; ids?: string[]; candidates?: string[] });
    const pool = (choices.options ?? choices.ids ?? choices.candidates ?? []) as string[];
    expect(pool.includes(find(s0, 'Test Forest', 'graveyard', 'p2'))).toBe(false);
    const bird = pool.find((id) => s.objects[id]!.defId === 'Test Blue Bird')!;
    expect(bird).toBeDefined();
    s = answer(s, { kind: 'chooseObjects', ids: [bird] });
    s = passTo(s, (x) => x.pending?.kind === 'priority' && x.zones.stack.length === 0, {}, 60);
    expect(castable(s)).toContain(bird);
    const ox = exiled(s, 'Test Ox')[0]!;
    expect(castable(s)).not.toContain(ox);
    expect(onBattlefield(castFrom(s, bird), 'Test Blue Bird')).toBeDefined();
  });
});

describe('CR 118.9, 601.2b, 205.3: "You may play that card this turn. You may cast Equipment spells this way without paying their mana costs."', () => {
  const SPELL = card('Test Trick', 'Sorcery', 'Exile the top card of your library. You may play that card this turn. You may cast Equipment spells this way without paying their mana costs.');
  it('is automated', () => { expect(automated(SPELL)).toBe(true); });
  it('an Equipment spell exiled this way is cast for nothing with no mana at all', () => {
    const s0 = scenario([], { p1: { hand: ['Test Trick'], library: ['Test Sword', 'Test Mountain'] }, defs: [MTN, FOR, SPELL, SWORD] });
    const s = cast(s0, 'Test Trick');
    const sword = exiled(s, 'Test Sword')[0]!;
    expect(castable(s)).toContain(sword);
    expect(onBattlefield(castFrom(s, sword), 'Test Sword')).toBeDefined();
  });
  it('negative: another card exiled this way is not free (a 2-mana creature cannot be cast with no mana)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Trick'], library: ['Test Bear', 'Test Mountain'] }, defs: [MTN, FOR, SPELL, BEAR] });
    const s = cast(s0, 'Test Trick');
    const bear = exiled(s, 'Test Bear')[0]!;
    expect(castable(s)).not.toContain(bear);
  });
  it('and it can still be cast for its mana cost when there is mana (the free cast is an option)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Trick'], library: ['Test Bear', 'Test Mountain'], battlefield: LAND }, defs: [MTN, FOR, SPELL, BEAR] });
    const s = cast(s0, 'Test Trick');
    const bear = exiled(s, 'Test Bear')[0]!;
    expect(castable(s)).toContain(bear);
  });
});

describe('CR 601.2f, 109.5, 611.2a: "Exile target nonland permanent. For as long as that card remains exiled, its owner may play it. A spell cast by an opponent this way costs {2} more to cast."', () => {
  const PART = card('Test Partition', 'Sorcery', 'Exile target nonland permanent. For as long as that card remains exiled, its owner may play it. A spell cast by an opponent this way costs {2} more to cast.');
  it('is automated', () => { expect(automated(PART)).toBe(true); });
  it('the opponent who owns the exiled card needs {2} more to cast it', () => {
    const s0 = scenario([], { p1: { hand: ['Test Partition'] }, p2: { battlefield: ['Test Bear', 'Test Mountain', 'Test Mountain'] }, defs: [MTN, FOR, PART, BEAR] });
    const s = cast(s0, 'Test Partition', { targets: [[obj(find(s0, 'Test Bear', 'battlefield', 'p2'))]] });
    const bear = exiled(s, 'Test Bear')[0]!;
    expect(bear).toBeDefined();
    // two Mountains pay its {2}, not the {4} it now costs
    expect(castable(passTo(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.kind === 'priority', {}, 900), 'p2')).not.toContain(bear);
  });
  it('the opponent with four mana casts it', () => {
    const s0 = scenario([], { p1: { hand: ['Test Partition'] }, p2: { battlefield: ['Test Bear', 'Test Mountain', 'Test Mountain', 'Test Mountain', 'Test Mountain'] }, defs: [MTN, FOR, PART, BEAR] });
    let s = cast(s0, 'Test Partition', { targets: [[obj(find(s0, 'Test Bear', 'battlefield', 'p2'))]] });
    const bear = exiled(s, 'Test Bear')[0]!;
    s = passTo(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.kind === 'priority', {}, 900);
    expect(castable(s, 'p2')).toContain(bear);
  });
  it('negative: when the caster exiles their own permanent they pay only its mana cost', () => {
    const s0 = scenario([], { p1: { hand: ['Test Partition'], battlefield: ['Test Bear', 'Test Mountain', 'Test Mountain'] }, defs: [MTN, FOR, PART, BEAR] });
    const s = cast(s0, 'Test Partition', { targets: [[obj(find(s0, 'Test Bear', 'battlefield', 'p1'))]] });
    const bear = exiled(s, 'Test Bear')[0]!;
    expect(castable(s, 'p1')).toContain(bear);
  });
});
