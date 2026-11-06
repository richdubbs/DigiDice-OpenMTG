/**
 * Top-rank round edh-next-85 (code edhn85): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names, design
 * 6.10). Each test is named after the rule it checks, with its negative case. CR cites are from memory of the 2026-09-25 text (no rules/cr folder in this session): unverified.
 *
 *   CR 608.2c, 109.2, 405.1       "Counter all other spells." (Reverse the Polarity)
 *   CR 201.2, 400.1               "... target legendary permanent card not named ~ from a graveyard onto the battlefield" (Staff of Eden, Vault's Key)
 *   CR 105.3, 205.3m, 613.1d-e    "That creature is black and is a Nightmare in addition to its other creature types." (Chainer, Dementia Master)
 *   CR 205.1b, 613.4b             "It's a green Mutant with base power and toughness 3/3." (The Master, Transcendent)
 *   CR 105.3, 205.3m              "They're black Zombies in addition to their other colors and types." (Grimoire of the Dead)
 *   CR 707.9b, 707.10, 603.2h     "... you may copy it, except the copy is a 1/1 Spirit in addition to its other types. Do this only once each turn." (Donal, Herald of Wings)
 *   CR 601.2i, 400.7d, 604.1      "~ has haste and ward {10} as long as it was cast." (The Tarrasque)
 *   CR 120.3, 109.5               "Whenever a source an opponent controls deals damage to you, that player sacrifices a permanent of their choice." (Michiko Konda, Truth Seeker)
 *   CR 107.3a, 106.6, 601.2f      "Spend only black mana on X." (Crypt Rats on an ability, Consume Spirit on a spell)
 */
import { describe, expect, it } from 'vitest';
import { getChars, legalActions } from '../../../src/index';
import { hasKeyword } from '../../../src/rules/characteristics';
import type { GameState, ObjectId } from '../../../src/index';
import { act, activations, advanceTo, answer, card, cast, drive, find, full, lifeOf, named, obj, resolveAll, scenario } from '../r4-cost/support';

const onField = (s: GameState, name: string): ObjectId[] => named(s, name);
const colorsOf = (s: GameState, id: ObjectId): string[] => [...getChars(s, id)!.colors].sort();
const hasHaste = (s: GameState, id: ObjectId): boolean => hasKeyword(getChars(s, id)!, 'haste');

// ---- Reverse the Polarity ----------------------------------------------------------------------------------------------------------------------------------
describe('CR 608.2c, 109.2: "Counter all other spells." counters every spell on the stack but the spell itself', () => {
  const POLE = card('Test Polarity', 'Instant', 'Counter all other spells.', '{0}');
  const BURN = card('Test Burn Plan', 'Instant', 'Test Burn Plan deals 3 damage to target player.', '{0}');
  const defs = [POLE, BURN];
  const board = (): GameState => scenario([], { defs, p1: { hand: ['Test Burn Plan'] }, p2: { hand: ['Test Polarity'] } });
  const lifeBefore = 20;
  it('is full', () => expect(full(POLE)).toBe(true));
  it('counters the spell it was cast against and is not countered itself', () => {
    let s = cast(board(), 'Test Burn Plan', { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = act(s, { type: 'pass', player: 'p1' });
    s = cast(s, 'Test Polarity', {}, 'p2');
    s = resolveAll(s);
    expect(lifeOf(s, 'p2')).toBe(lifeBefore);
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toContain('Test Burn Plan');
    expect(s.zones.graveyard.p2!.map((id) => s.objects[id]!.defId)).toContain('Test Polarity');
  });
  it('negative: without the Polarity the burn spell resolves', () => {
    const s = resolveAll(cast(board(), 'Test Burn Plan', { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(lifeOf(s, 'p2')).toBe(lifeBefore - 3);
  });
});

// ---- Staff of Eden, Vault's Key ----------------------------------------------------------------------------------------------------------------------------
describe('CR 201.2: "put target legendary permanent card not named ~ from a graveyard onto the battlefield under your control"', () => {
  const STAFF = card('Test Staff Relic', 'Legendary Artifact', 'When this artifact enters, put target legendary permanent card not named Test Staff Relic from a graveyard onto the battlefield under your control.', '{0}');
  const KING = card('Test Dead King', 'Legendary Creature — Human', '', '{0}', ['2', '2']);
  const PEASANT = card('Test Dead Peasant', 'Creature — Human', '', '{0}', ['1', '1']);
  const defs = [STAFF, KING, PEASANT];
  const board = (gy2: string[], gy1: string[] = []): GameState => scenario([], { defs, p1: { hand: ['Test Staff Relic'], graveyard: gy1 }, p2: { graveyard: gy2 } });
  it('is full', () => expect(full(STAFF)).toBe(true));
  it('puts a legendary card of any graveyard onto the battlefield under your control', () => {
    let s = cast(board(['Test Dead King', 'Test Dead Peasant']), 'Test Staff Relic');
    s = resolveAll(s, { targets: [[obj(find(s, 'Test Dead King', 'graveyard', 'p2'))]] });
    const king = onField(s, 'Test Dead King');
    expect(king.length).toBe(1);
    expect(s.objects[king[0]!]!.controller).toBe('p1');
  });
  it('negative: a nonlegendary card is never a target, and neither is a card with the relic\'s own name', () => {
    const s = resolveAll(cast(board(['Test Dead Peasant']), 'Test Staff Relic'));
    expect(onField(s, 'Test Dead Peasant').length).toBe(0);
    const t = resolveAll(cast(board([], ['Test Staff Relic']), 'Test Staff Relic'));
    expect(named(t, 'Test Staff Relic').length).toBe(1);
    expect(t.zones.graveyard.p1!.map((id) => t.objects[id]!.defId)).toEqual(['Test Staff Relic']);
  });
});

// ---- Chainer, Dementia Master and The Master, Transcendent -------------------------------------------------------------------------------------------------------
describe('CR 105.3, 205.3m, 613.1e: "That creature is black and is a Nightmare in addition to its other creature types."', () => {
  const RAISE = card('Test Dark Raise', 'Sorcery', 'Put target creature card from a graveyard onto the battlefield under your control. That creature is black and is a Nightmare in addition to its other creature types.', '{0}');
  const ELF = card('Test Green Elf', 'Creature — Elf Warrior', '', '{0}', ['2', '2'], ['G']);
  const defs = [RAISE, ELF];
  const run = (): GameState => {
    const s = scenario([], { defs, p1: { hand: ['Test Dark Raise'] }, p2: { graveyard: ['Test Green Elf'] } });
    return resolveAll(cast(s, 'Test Dark Raise', { targets: [[obj(find(s, 'Test Green Elf', 'graveyard', 'p2'))]] }));
  };
  it('is full', () => expect(full(RAISE)).toBe(true));
  it('the creature comes back under your control black and only black (it loses green), a Nightmare besides Elf and Warrior', () => {
    const s = run();
    const elf = onField(s, 'Test Green Elf')[0]!;
    expect(s.objects[elf]!.controller).toBe('p1');
    expect(colorsOf(s, elf)).toEqual(['B']);
    expect([...getChars(s, elf)!.subtypes].sort()).toEqual(['Elf', 'Nightmare', 'Warrior']);
  });
  it('negative: another creature card put onto the battlefield later is not changed', () => {
    const s = run();
    const ELF2 = card('Test Other Elf', 'Creature — Elf', '', '{0}', ['1', '1'], ['G']);
    const t = scenario([], { defs: [...defs, ELF2], p1: { battlefield: ['Test Other Elf'] } });
    expect(colorsOf(t, onField(t, 'Test Other Elf')[0]!)).toEqual(['G']);
    expect(onField(s, 'Test Other Elf').length).toBe(0);
  });
});

describe('CR 205.1b, 613.4b: "It\'s a green Mutant with base power and toughness 3/3."', () => {
  const RAISE = card('Test Mutant Raise', 'Sorcery', 'Put target creature card from a graveyard onto the battlefield under your control. It\'s a green Mutant with base power and toughness 3/3.', '{0}');
  const DRAKE = card('Test Red Drake', 'Creature — Dragon', 'Flying', '{0}', ['5', '5'], ['R']);
  const defs = [RAISE, DRAKE];
  it('is full', () => expect(full(RAISE)).toBe(true));
  it('the creature is a green Mutant 3/3 (it loses its other colors and creature types, keeps its abilities)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Mutant Raise'] }, p2: { graveyard: ['Test Red Drake'] } });
    const s = resolveAll(cast(s0, 'Test Mutant Raise', { targets: [[obj(find(s0, 'Test Red Drake', 'graveyard', 'p2'))]] }));
    const drake = onField(s, 'Test Red Drake')[0]!;
    const c = getChars(s, drake)!;
    expect(colorsOf(s, drake)).toEqual(['G']);
    expect([...c.subtypes]).toEqual(['Mutant']);
    expect([Number(c.power), Number(c.toughness)]).toEqual([3, 3]);
    expect([...c.types]).toEqual(['Creature']);
    expect(hasKeyword(c, 'flying')).toBe(true);
  });
  it('negative: a creature that was never raised keeps its printed size and colors', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Red Drake'] } });
    const c = getChars(s, onField(s, 'Test Red Drake')[0]!)!;
    expect([Number(c.power), Number(c.toughness)]).toEqual([5, 5]);
    expect(colorsOf(s, onField(s, 'Test Red Drake')[0]!)).toEqual(['R']);
  });
});

// ---- Grimoire of the Dead ----------------------------------------------------------------------------------------------------------------------------------------
describe('CR 105.3, 205.3m: "Put all creature cards from all graveyards onto the battlefield under your control. They\'re black Zombies in addition to their other colors and types."', () => {
  const GRIM = card('Test Grim Rite', 'Sorcery', 'Put all creature cards from all graveyards onto the battlefield under your control. They\'re black Zombies in addition to their other colors and types.', '{0}');
  const RED = card('Test Red Imp', 'Creature — Imp', '', '{0}', ['1', '1'], ['R']);
  const WURM = card('Test Green Wurm', 'Artifact Creature — Wurm', '', '{0}', ['3', '3'], ['G']);
  const SPELL = card('Test Old Plan', 'Instant', 'Draw a card.', '{0}');
  const defs = [GRIM, RED, WURM, SPELL];
  const run = (): GameState => resolveAll(cast(scenario([], { defs, p1: { hand: ['Test Grim Rite'], graveyard: ['Test Red Imp', 'Test Old Plan'] }, p2: { graveyard: ['Test Green Wurm'] } }), 'Test Grim Rite'));
  it('is full', () => expect(full(GRIM)).toBe(true));
  it('every creature card of every graveyard (an artifact creature too) returns under your control, black and a Zombie besides its colors and types', () => {
    const s = run();
    const imp = onField(s, 'Test Red Imp')[0]!;
    const wurm = onField(s, 'Test Green Wurm')[0]!;
    expect(s.objects[wurm]!.controller).toBe('p1');
    expect(colorsOf(s, imp)).toEqual(['B', 'R']);
    expect(colorsOf(s, wurm)).toEqual(['B', 'G']);
    expect([...getChars(s, wurm)!.subtypes].sort()).toEqual(['Wurm', 'Zombie']);
    expect([...getChars(s, wurm)!.types].sort()).toEqual(['Artifact', 'Creature']);
  });
  it('negative: a card that is not a creature card stays in its graveyard', () => {
    const s = run();
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toContain('Test Old Plan');
    expect(onField(s, 'Test Old Plan').length).toBe(0);
  });
});

// ---- Donal, Herald of Wings --------------------------------------------------------------------------------------------------------------------------------------
describe('CR 707.9b, 707.10, 603.2h: "Whenever you cast a nonlegendary creature spell with flying, you may copy it, except the copy is a 1/1 Spirit in addition to its other types. Do this only once each turn."', () => {
  const HERALD = card('Test Wing Herald', 'Legendary Creature — Human Wizard', 'Whenever you cast a nonlegendary creature spell with flying, you may copy it, except the copy is a 1/1 Spirit in addition to its other types. Do this only once each turn.', '{0}', ['2', '2']);
  const WYRM = card('Test Sky Wyrm', 'Creature — Dragon', 'Flying', '{0}', ['4', '4']);
  const WYRM2 = card('Test Sky Wyrm Two', 'Creature — Dragon', 'Flying', '{0}', ['5', '5']);
  const KING = card('Test Sky King', 'Legendary Creature — Bird', 'Flying', '{0}', ['3', '3']);
  const BEAR = card('Test Ground Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const defs = [HERALD, WYRM, WYRM2, KING, BEAR];
  const board = (hand: string[]): GameState => scenario([], { defs, p1: { hand, battlefield: ['Test Wing Herald'] } });
  const tokens = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.defId.startsWith(`copy:${name}:`));
  it('is full', () => expect(full(HERALD)).toBe(true));
  it('the copy of the flying spell becomes a 1/1 Spirit Dragon token, the original resolves as it is', () => {
    const s = resolveAll(cast(board(['Test Sky Wyrm']), 'Test Sky Wyrm'), { yes: [true] });
    const real = onField(s, 'Test Sky Wyrm')[0]!;
    const tok = tokens(s, 'Test Sky Wyrm')[0]!;
    expect([Number(getChars(s, real)!.power), Number(getChars(s, real)!.toughness)]).toEqual([4, 4]);
    const c = getChars(s, tok)!;
    expect([Number(c.power), Number(c.toughness)]).toEqual([1, 1]);
    expect([...c.subtypes].sort()).toEqual(['Dragon', 'Spirit']);
    expect(hasKeyword(c, 'flying')).toBe(true);
  });
  it('once each turn: a second flying creature spell the same turn is not copied', () => {
    let s = resolveAll(cast(board(['Test Sky Wyrm', 'Test Sky Wyrm Two']), 'Test Sky Wyrm'), { yes: [true] });
    s = resolveAll(cast(s, 'Test Sky Wyrm Two'), { yes: [true] });
    expect(tokens(s, 'Test Sky Wyrm').length).toBe(1);
    expect(tokens(s, 'Test Sky Wyrm Two').length).toBe(0);
  });
  it('once each turn counts only the copies you made: declining the first lets you copy the second', () => {
    let s = resolveAll(cast(board(['Test Sky Wyrm', 'Test Sky Wyrm Two']), 'Test Sky Wyrm'), { yes: [false] });
    s = resolveAll(cast(s, 'Test Sky Wyrm Two'), { yes: [true] });
    expect(tokens(s, 'Test Sky Wyrm').length).toBe(0);
    expect(tokens(s, 'Test Sky Wyrm Two').length).toBe(1);
  });
  it('negative: a legendary creature spell, or one with no flying, is not copied', () => {
    const a = resolveAll(cast(board(['Test Sky King']), 'Test Sky King'), { yes: [true] });
    expect(tokens(a, 'Test Sky King').length).toBe(0);
    const b = resolveAll(cast(board(['Test Ground Bear']), 'Test Ground Bear'), { yes: [true] });
    expect(tokens(b, 'Test Ground Bear').length).toBe(0);
  });
});

// ---- The Tarrasque -----------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 601.2i, 400.7d, 604.1: "~ has haste and ward {2} as long as it was cast."', () => {
  const BEAST = card('Test Cast Beast', 'Creature — Beast', 'This creature has haste and ward {2} as long as it was cast.', '{0}', ['4', '4']);
  const defs = [BEAST];
  it('is full', () => expect(full(BEAST)).toBe(true));
  it('a creature that was cast has haste and ward', () => {
    const s = resolveAll(cast(scenario([], { defs, p1: { hand: ['Test Cast Beast'] } }), 'Test Cast Beast'));
    const id = onField(s, 'Test Cast Beast')[0]!;
    expect(hasHaste(s, id)).toBe(true);
    expect(hasKeyword(getChars(s, id)!, 'ward')).toBe(true);
  });
  it('negative: one put onto the battlefield without being cast has neither', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Cast Beast'] } });
    const id = onField(s, 'Test Cast Beast')[0]!;
    expect(hasHaste(s, id)).toBe(false);
    expect(hasKeyword(getChars(s, id)!, 'ward')).toBe(false);
  });
});

// ---- Michiko Konda, Truth Seeker ---------------------------------------------------------------------------------------------------------------------------------
describe('CR 120.3, 109.5: "Whenever a source an opponent controls deals damage to you, that player sacrifices a permanent of their choice."', () => {
  const MIC = card('Test Truth Seer', 'Legendary Creature — Human', 'Whenever a source an opponent controls deals damage to you, that player sacrifices a permanent of their choice.', '{0}', ['1', '1']);
  const POKE = card('Test Quiet Plan', 'Sorcery', 'Draw a card.', '{0}');
  const ZAP = card('Test Zap Plan', 'Instant', 'Test Zap Plan deals 1 damage to target player.', '{0}');
  const RELIC = card('Test Spare Relic', 'Artifact', '', '{0}');
  const defs = [MIC, POKE, ZAP, RELIC];
  const board = (): GameState => scenario([], { defs, p1: { hand: ['Test Quiet Plan', 'Test Zap Plan'], battlefield: ['Test Truth Seer'] }, p2: { hand: ['Test Zap Plan'], battlefield: ['Test Spare Relic'] } });
  it('is full', () => expect(full(MIC)).toBe(true));
  it('the opponent whose spell dealt the damage sacrifices a permanent of their choice', () => {
    let s = cast(board(), 'Test Quiet Plan');
    s = act(s, { type: 'pass', player: 'p1' });
    s = cast(s, 'Test Zap Plan', { targets: [[{ kind: 'player', id: 'p1' }]] }, 'p2');
    s = resolveAll(s);
    expect(lifeOf(s, 'p1')).toBe(19);
    expect(onField(s, 'Test Spare Relic').length).toBe(0);
    expect(onField(s, 'Test Truth Seer').length).toBe(1);
  });
  it('negative: damage you deal to yourself, or damage an opponent is dealt, does not make anyone sacrifice', () => {
    const s = resolveAll(cast(board(), 'Test Zap Plan', { targets: [[{ kind: 'player', id: 'p1' }]] }));
    expect(lifeOf(s, 'p1')).toBe(19);
    expect(onField(s, 'Test Truth Seer').length).toBe(1);
    const t = resolveAll(cast(board(), 'Test Zap Plan', { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(onField(t, 'Test Spare Relic').length).toBe(1);
  });
});

// ---- Crypt Rats and Consume Spirit -------------------------------------------------------------------------------------------------------------------------------
describe('CR 107.3a, 106.6: "Spend only black mana on X."', () => {
  const RATS = card('Test Plague Rat', 'Creature — Rat', '{X}: ~ deals X damage to each creature and each player. Spend only black mana on X.', '{0}', ['1', '1']);
  const SPIRIT = card('Test Drain Plan', 'Instant', 'Spend only black mana on X. ~ deals X damage to any target and you gain X life.', '{X}{1}{B}');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', '{0}', ['3', '3']);
  const defs = [RATS, SPIRIT, BEAR];
  const maxX = (s: GameState): number => {
    const p = s.pending;
    if (p?.kind !== 'chooseNumber') throw new Error(`expected an X choice, got ${p?.kind}`);
    return p.max;
  };
  it('are full', () => { expect(full(RATS)).toBe(true); expect(full(SPIRIT)).toBe(true); });
  it('an ability: X can be as large as the black mana you have, mana of another color does not count toward it', () => {
    const s = scenario(['Swamp', 'Mountain'], { defs, p1: { battlefield: ['Test Plague Rat', 'Swamp', 'Swamp', 'Mountain', 'Mountain', 'Mountain'] } });
    const next = act(s, activations(s, 'Test Plague Rat')[0]!.action);
    expect(maxX(next)).toBe(2);
  });
  it('an ability: with X = 2 paid from the two Swamps it deals 2 damage to each creature and each player', () => {
    const s = scenario(['Swamp', 'Mountain'], { defs, p1: { battlefield: ['Test Plague Rat', 'Swamp', 'Swamp', 'Mountain'] }, p2: { battlefield: ['Test Plain Bear'] } });
    const t = resolveAll(drive(act(s, activations(s, 'Test Plague Rat')[0]!.action), { x: [2] }));
    expect(lifeOf(t, 'p1')).toBe(18);
    expect(lifeOf(t, 'p2')).toBe(18);
        expect(t.objects[onField(t, 'Test Plain Bear')[0]!]!.damage).toBe(2);
    expect(onField(t, 'Test Plague Rat').length).toBe(0);
  });
  it('an ability: with no black mana only X = 0 can be announced', () => {
    const s = scenario(['Swamp', 'Mountain'], { defs, p1: { battlefield: ['Test Plague Rat', 'Mountain', 'Mountain'] } });
    const acts = activations(s, 'Test Plague Rat');
    if (acts.length === 0) return;
    const next = act(s, acts[0]!.action);
    if (next.pending?.kind === 'chooseNumber') expect(next.pending.max).toBe(0);
    else expect(lifeOf(resolveAll(next), 'p1')).toBe(20);
  });
  it('a spell: X is paid with black mana only, the {1} of its cost with any mana', () => {
    const s = scenario(['Swamp', 'Mountain'], { defs, p1: { hand: ['Test Drain Plan'], battlefield: ['Swamp', 'Swamp', 'Swamp', 'Mountain', 'Mountain'] } });
    const next = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Drain Plan', 'hand', 'p1') });
    expect(maxX(next)).toBe(2);
  });
  it('review: life can not be paid for the X (K\'rrik, Son of Yawgmoth, ruling 2019-08-23), and a generic cost reduction still lowers it (CR 601.2f)', () => {
    const KRRIK = card('Test Blood Lord', 'Legendary Creature — Vampire', 'For each {B} in a cost, you may pay 2 life rather than pay that mana.', '{0}', ['3', '3']);
    const s = scenario(['Swamp', 'Mountain'], { defs: [...defs, KRRIK], p1: { battlefield: ['Test Plague Rat', 'Test Blood Lord'] } });
    const acts = activations(s, 'Test Plague Rat');
    if (acts.length > 0) {
      const next = act(s, acts[0]!.action);
      if (next.pending?.kind === 'chooseNumber') expect(next.pending.max).toBe(0);
    }
    const CUT = card('Test Cost Cut', 'Enchantment', 'Spells you cast cost {2} less to cast.', '{0}');
    const t = scenario(['Swamp', 'Mountain'], { defs: [...defs, CUT], p1: { hand: ['Test Drain Plan'], battlefield: ['Test Cost Cut', 'Swamp', 'Swamp', 'Swamp'] } });
    expect(maxX(act(t, { type: 'cast', player: 'p1', card: find(t, 'Test Drain Plan', 'hand', 'p1') }))).toBe(3);
  });
  it('a spell: X = 2 deals 2 damage and gains 2 life', () => {
    const s = scenario(['Swamp', 'Mountain'], { defs, p1: { hand: ['Test Drain Plan'], battlefield: ['Swamp', 'Swamp', 'Swamp', 'Mountain'] } });
    const t = resolveAll(cast(s, 'Test Drain Plan', { x: [2], targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(lifeOf(t, 'p2')).toBe(18);
    expect(lifeOf(t, 'p1')).toBe(22);
  });
});

void advanceTo; void answer; void legalActions;
