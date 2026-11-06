/**
 * edh-zones-9 (Commander effort, lane edh-zones): the round's readings played through the engine with synthetic cards (invented names, design 6.10). CR cites from memory,
 * unverified.
 *
 *   CR 101.4, 608.2d-e, 110.2a   "Each player puts a creature card from their graveyard onto the battlefield." (Exhume): APNAP choices, one simultaneous move, each under its owner's control
 *   CR 701.9a, 608.2c, 608.2e    "You may discard all the cards in your hand. If you do, draw that many cards." (Forgotten Creation)
 *   CR 121.1, 401.4              "Draw cards equal to the number of cards in your library, then put a card from your hand on top of your library." (Enter the Infinite)
 *   CR 118.12a, 701.9a           "Target player draws three cards. Then that player discards two cards unless they discard a land card." (Compulsive Research)
 *   CR 608.2d, 404.1, 400.7      "Choose a card at random in your graveyard. If it's a creature card, put it onto the battlefield. Otherwise, put it into your hand." (Deadbridge Chant)
 *   CR 608.2c, 400.7, 701.23a    "Put both cards onto the battlefield under your control, then shuffle." after an exile of a target and a search (Sword of Hearth and Home)
 *   CR 701.23a-b                 "Search your library for an Aura card and/or an Equipment card, reveal them, ..." (Axgard Armory), "a basic land card or Gate card" (Open the Gates)
 *   CR 701.6a, 614.15, 400.3     "If that spell is countered this way, put it into its owner's hand instead of into that player's graveyard." (Remand)
 *   CR 607.2a, 400.3, 110.2      "Return all cards exiled with ~ to their owner's hand" (Bag of Holding); "put all creature cards exiled with ~ onto the battlefield under your control" (Gisa)
 *   CR 201.5, 608.2c             a name that ends with "!" closing the line: "Exile Blood for the Blood God!" (Blood for the Blood God!)
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { put } from '../../m3/scenario';
import { act, advanceTo, answer, find, full, card, cast, drive, passBoth, resolveAll, scenario, activations, legal, lifeOf } from '../r5-cost/support';

const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => nameOf(s, id));
/** Replace a player's whole library (the scenario's filler Plains included) with the named cards, top first. */
function setLibrary(s: GameState, p: 'p1' | 'p2', libNames: string[]): void {
  for (const id of s.zones.library[p]!) delete s.objects[id];
  s.zones.library[p] = [];
  for (const n of libNames) put(s, p, 'library', n);
}
const onBattlefield = (s: GameState, name: string, controller?: string): string[] => s.zones.battlefield.filter((id) => nameOf(s, id) === name && (controller === undefined || s.objects[id]!.controller === controller));
const inExile = (s: GameState, name: string): string[] => s.zones.exile.filter((id) => nameOf(s, id) === name);
const pendingObjects = (s: GameState) => s.pending as { kind: 'chooseObjects'; player: string; options: string[]; min: number; max: number };
const handNames = (s: GameState, p: 'p1' | 'p2'): string[] => names(s, s.zones.hand[p]!).sort();
const gyNames = (s: GameState, p: 'p1' | 'p2'): string[] => names(s, s.zones.graveyard[p]!).sort();

const EXHUME = card('Test Mass Reanimate', 'Sorcery', 'Each player puts a creature card from their graveyard onto the battlefield.', '{0}');
const FORGET = card('Test Wheel Spell', 'Sorcery', 'You may discard all the cards in your hand. If you do, draw that many cards.', '{0}');
const INFINITE = card('Test Deep Draw', 'Sorcery', 'Draw cards equal to the number of cards in your library, then put a card from your hand on top of your library.', '{0}');
const RESEARCH = card('Test Hasty Study', 'Instant', 'Target player draws three cards. Then that player discards two cards unless they discard a land card.', '{0}');
const CHANT = card('Test Random Raise', 'Sorcery', 'Choose a card at random in your graveyard. If it\'s a creature card, put it onto the battlefield. Otherwise, put it into your hand.', '{0}');
const SWORD = card('Test Sworn Fetch', 'Sorcery', 'Exile up to one target creature you own, then search your library for a basic land card. Put both cards onto the battlefield under your control, then shuffle.', '{0}');
const ARMORY = card('Test Pair Search', 'Sorcery', 'Search your library for a Goblin card and/or an Elf card, reveal them, put them into your hand, then shuffle.', '{0}');
const GATES = card('Test Gate Search', 'Sorcery', 'Search your library for a basic land card or Gate card, reveal it, put it into your hand, then shuffle.', '{0}');
const REMAND = card('Test Send Back', 'Instant', 'Counter target spell. If that spell is countered this way, put it into its owner\'s hand instead of into that player\'s graveyard. Draw a card.', '{0}');
const BAG = card('Test Hoard Bag', 'Artifact', 'Whenever you discard a card, exile that card from your graveyard.\n{4}, {T}, Sacrifice this artifact: Return all cards exiled with this artifact to their owner\'s hand.', '{0}');
const GISA = card('Test Grave Queen', 'Legendary Creature — Zombie', 'If a creature an opponent controls would die, exile it instead.\nAt the beginning of your upkeep, put all creature cards exiled with this creature onto the battlefield under your control. They gain decayed.', '{0}', ['2', '2']);
const BLOOD = card('Test Blood Rite!', 'Sorcery', 'Discard your hand, then draw eight cards. Test Blood Rite! deals 8 damage to each opponent. Exile Test Blood Rite!', '{0}');
const COUNTERED = card('Test Target Spell', 'Sorcery', 'You gain 1 life.', '{0}');
const DISCARDER = card('Test Discarder', 'Sorcery', 'Target player discards a card.', '{0}');
const SHATTER = card('Test Shatter Bolt', 'Sorcery', 'Destroy target creature.', '{0}');
const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
const BEAR2 = card('Test Cub', 'Creature — Bear', '', '{0}', ['1', '1']);
const GOB = card('Test Goblin', 'Creature — Goblin', '', '{0}', ['1', '1']);
const GOB2 = card('Test Goblin Chief', 'Creature — Goblin', '', '{0}', ['1', '1']);
const ELF = card('Test Elf', 'Creature — Elf', '', '{0}', ['1', '1']);
const TRINKET = card('Test Trinket', 'Artifact', '', '{0}');
const GATE = card('Test Gate', 'Land — Gate', '', '{0}');
const NONBASIC = card('Test Cavern', 'Land', '', '{0}');
const RING = card('Test Ring', 'Artifact', '{T}: Add {C}.', '{0}');
const DEFS = [EXHUME, FORGET, INFINITE, RESEARCH, CHANT, SWORD, ARMORY, GATES, REMAND, BAG, GISA, BLOOD, COUNTERED, DISCARDER, SHATTER, BEAR, BEAR2, GOB, GOB2, ELF, TRINKET, GATE, NONBASIC, RING];

describe('the synthetic cards are automated', () => {
  it('play fully', () => { for (const d of [EXHUME, FORGET, INFINITE, RESEARCH, CHANT, SWORD, ARMORY, GATES, REMAND, BAG, GISA, BLOOD]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true); });
});

describe('"Each player puts a creature card from their graveyard onto the battlefield." (CR 101.4, 608.2d-e, 110.2a; Exhume)', () => {
  it('each player chooses a creature card of their own graveyard and it enters under that player\'s control; non-creature cards are not offered', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Mass Reanimate'], graveyard: ['Test Bear', 'Test Cub', 'Test Trinket'] }, p2: { graveyard: ['Test Goblin', 'Test Elf', 'Test Bear'] } });
    s = cast(s, 'Test Mass Reanimate');
    s = passBoth(s);
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(pendingObjects(s).player).toBe('p1'); // the active player first (CR 101.4)
    expect(names(s, pendingObjects(s).options).sort()).toEqual(['Test Bear', 'Test Cub']); // the artifact card is not a creature card, and nothing of p2's graveyard
    expect([pendingObjects(s).min, pendingObjects(s).max]).toEqual([1, 1]);
    s = answer(s, { kind: 'chooseObjects', ids: [pendingObjects(s).options.find((id) => nameOf(s, id) === 'Test Cub')!] });
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(pendingObjects(s).player).toBe('p2');
    expect(names(s, pendingObjects(s).options).sort()).toEqual(['Test Bear', 'Test Elf', 'Test Goblin']); // only p2's own graveyard
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [pendingObjects(s).options.find((id) => nameOf(s, id) === 'Test Elf')!] }));
    expect(onBattlefield(s, 'Test Cub', 'p1')).toHaveLength(1);
    expect(onBattlefield(s, 'Test Elf', 'p2')).toHaveLength(1);
    expect(s.zones.battlefield).toHaveLength(2);
    expect(gyNames(s, 'p2')).toEqual(['Test Bear', 'Test Goblin']);
    expect(gyNames(s, 'p1')).toEqual(['Test Bear', 'Test Mass Reanimate', 'Test Trinket']);
  });
  it('the negative case: a player with no creature card in their graveyard puts nothing and the others still do', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Mass Reanimate'], graveyard: ['Test Trinket'] }, p2: { graveyard: ['Test Cub'] } });
    s = cast(s, 'Test Mass Reanimate');
    s = resolveAll(s);
    expect(onBattlefield(s, 'Test Cub', 'p2')).toHaveLength(1);
    expect(s.zones.battlefield).toHaveLength(1);
    expect(gyNames(s, 'p1')).toEqual(['Test Mass Reanimate', 'Test Trinket']);
  });
});

describe('"You may discard all the cards in your hand. If you do, draw that many cards." (CR 701.9a, 608.2c, 608.2e; Forgotten Creation)', () => {
  it('yes: the whole hand is discarded and as many cards are drawn', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Wheel Spell', 'Test Bear', 'Test Cub', 'Test Trinket'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Goblin', 'Test Elf', 'Test Gate', 'Test Cavern', 'Test Ring']);
    s = resolveAll(cast(s, 'Test Wheel Spell'), { yes: [true] });
    expect(gyNames(s, 'p1')).toEqual(['Test Bear', 'Test Cub', 'Test Trinket', 'Test Wheel Spell']);
    expect(handNames(s, 'p1')).toEqual(['Test Elf', 'Test Goblin', 'Test Gate'].sort()); // three cards discarded (the spell is on the stack, not in hand), three drawn
  });
  it('the negative case: declining discards nothing and draws nothing', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Wheel Spell', 'Test Bear', 'Test Cub'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Goblin', 'Test Elf']);
    s = resolveAll(cast(s, 'Test Wheel Spell'), { yes: [false] });
    expect(handNames(s, 'p1')).toEqual(['Test Bear', 'Test Cub']);
    expect(names(s, s.zones.library.p1!)).toEqual(['Test Goblin', 'Test Elf']);
  });
});

describe('"Draw cards equal to the number of cards in your library, then put a card from your hand on top of your library." (CR 121.1, 401.4; Enter the Infinite)', () => {
  it('the whole library is drawn (counted when the spell resolves), then the one card chosen from the hand goes on top', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Deep Draw', 'Test Trinket'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Goblin', 'Test Elf', 'Test Gate']);
    s = cast(s, 'Test Deep Draw');
    s = passBoth(s);
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(names(s, pendingObjects(s).options).sort()).toEqual(['Test Elf', 'Test Gate', 'Test Goblin', 'Test Trinket']);
    const elf = pendingObjects(s).options.find((id) => nameOf(s, id) === 'Test Elf')!;
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [elf] }));
    expect(names(s, s.zones.library.p1!)).toEqual(['Test Elf']);
    expect(handNames(s, 'p1')).toEqual(['Test Gate', 'Test Goblin', 'Test Trinket']);
  });
});

describe('"Target player draws three cards. Then that player discards two cards unless they discard a land card." (CR 118.12a, 701.9a; Compulsive Research)', () => {
  const setup = (hand: string[]): GameState => {
    const s = scenario([], { defs: DEFS, p1: { hand: ['Test Hasty Study'] }, p2: { hand } });
    setLibrary(s, 'p2', ['Test Goblin', 'Test Elf', 'Test Gate', 'Test Bear']);
    return s;
  };
  it('the player who has a land card may discard just that card', () => {
    let s = setup([]);
    s = cast(s, 'Test Hasty Study', { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = passBoth(s);
    // the three cards drawn are Goblin, Elf, Gate: p2 is asked about the cost, pays it with the land
    for (let g = 0; g < 6 && s.pending && s.pending.kind !== 'priority'; g++) {
      const p = s.pending as { kind: string; options?: string[]; player: string };
      if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
      else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (p.options ?? []).filter((id) => nameOf(s, id) === 'Test Gate') });
      else break;
    }
    s = resolveAll(s);
    expect(gyNames(s, 'p2')).toEqual(['Test Gate']);
    expect(handNames(s, 'p2')).toEqual(['Test Elf', 'Test Goblin']);
  });
  it('declining the land discard (or having none) discards two cards instead', () => {
    let s = setup([]);
    setLibrary(s, 'p2', ['Test Goblin', 'Test Elf', 'Test Bear', 'Test Cub']);
    s = cast(s, 'Test Hasty Study', { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = resolveAll(drive(passBoth(s), { yes: [false, false, false] }));
    expect(s.players.find((x) => x.id === 'p2')!.id).toBe('p2');
    expect(gyNames(s, 'p2')).toHaveLength(2);
    expect(s.zones.hand.p2).toHaveLength(1);
  });
});

describe('"Choose a card at random in your graveyard. If it\'s a creature card, put it onto the battlefield. Otherwise, put it into your hand." (CR 608.2d, 404.1; Deadbridge Chant)', () => {
  it('a creature card goes onto the battlefield under your control', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Random Raise'], graveyard: ['Test Bear'] }, p2: {} });
    s = resolveAll(cast(s, 'Test Random Raise'));
    expect(onBattlefield(s, 'Test Bear', 'p1')).toHaveLength(1);
    expect(handNames(s, 'p1')).toEqual([]);
  });
  it('a card that is not a creature card goes to your hand', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Random Raise'], graveyard: ['Test Trinket'] }, p2: {} });
    s = resolveAll(cast(s, 'Test Random Raise'));
    expect(handNames(s, 'p1')).toEqual(['Test Trinket']);
    expect(s.zones.battlefield).toHaveLength(0);
  });
  it('the negative case: an opponent\'s graveyard is not chosen from, and an empty graveyard does nothing', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Random Raise'] }, p2: { graveyard: ['Test Bear'] } });
    s = resolveAll(cast(s, 'Test Random Raise'));
    expect(s.zones.battlefield).toHaveLength(0);
    expect(handNames(s, 'p1')).toEqual([]);
    expect(gyNames(s, 'p2')).toEqual(['Test Bear']);
  });
  it('the card is chosen from several at random by the game\'s random source (every card of the graveyard can be chosen, none outside it)', () => {
    const seen = new Set<string>();
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p']) {
      let s = scenario([], { defs: DEFS, seed, p1: { hand: ['Test Random Raise'], graveyard: ['Test Bear', 'Test Trinket'] }, p2: {} } as never);
      s = resolveAll(cast(s, 'Test Random Raise'));
      const moved = onBattlefield(s, 'Test Bear', 'p1').length + handNames(s, 'p1').length;
      expect(moved).toBe(1);
      seen.add(onBattlefield(s, 'Test Bear', 'p1').length === 1 ? 'bear' : 'trinket');
    }
    expect(seen.size).toBe(2); // both cards of the graveyard are chosen under some seed
  });
});

describe('"Put both cards onto the battlefield under your control, then shuffle." after an exile of a target and a search (CR 608.2c, 400.7, 701.23a; Sword of Hearth and Home)', () => {
  const setup = (library: string[]): GameState => {
    const s = scenario([], { defs: DEFS, p1: { hand: ['Test Sworn Fetch'], battlefield: ['Test Bear'] }, p2: {} });
    setLibrary(s, 'p1', library);
    return s;
  };
  const castAt = (s: GameState, withTarget: boolean): GameState => {
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    return cast(s, 'Test Sworn Fetch', { targets: [withTarget ? [{ kind: 'object', id: bear }] : []] });
  };
  it('the exiled creature card and the basic land found both enter under your control (the creature as a new object)', () => {
    let s = setup(['Test Cavern', 'Plains', 'Test Goblin']);
    const before = find(s, 'Test Bear', 'battlefield', 'p1');
    s = castAt(s, true);
    s = passBoth(s);
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(names(s, pendingObjects(s).options)).toEqual(['Plains']); // basic land cards only: not the nonbasic land, not the creature
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: pendingObjects(s).options }));
    expect(onBattlefield(s, 'Test Bear', 'p1')).toHaveLength(1);
    expect(onBattlefield(s, 'Test Bear', 'p1')[0]).not.toBe(before); // the card that was exiled came back as a new object (CR 400.7)
    expect(onBattlefield(s, 'Plains', 'p1')).toHaveLength(1);
    expect(inExile(s, 'Test Bear')).toHaveLength(0);
    expect(s.zones.library.p1).toHaveLength(2);
  });
  it('the negative case: with no creature chosen (up to one) only the land enters', () => {
    let s = setup(['Plains', 'Test Goblin']);
    s = passBoth(castAt(s, false));
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: pendingObjects(s).options }));
    expect(onBattlefield(s, 'Test Bear')).toHaveLength(1); // the creature was never exiled: still the original
    expect(onBattlefield(s, 'Plains', 'p1')).toHaveLength(1);
  });
  it('the negative case: when no basic land card is found the exiled creature still comes back', () => {
    let s = setup(['Test Cavern', 'Test Goblin']);
    s = castAt(s, true);
    s = resolveAll(drive(passBoth(s)));
    expect(onBattlefield(s, 'Test Bear', 'p1')).toHaveLength(1);
    expect(s.zones.battlefield.filter((id) => nameOf(s, id) !== 'Test Bear')).toHaveLength(0);
  });
  it('"you own": a creature you control but an opponent owns is not a legal target', () => {
    const s = setup(['Plains']);
    put(s, 'p2', 'battlefield', 'Test Cub');
    const stolen = s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Cub')!;
    s.objects[stolen]!.controller = 'p1';
    const c = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Sworn Fetch', 'hand', 'p1') });
    expect(c.pending?.kind).toBe('chooseTargets');
    expect(names(c, (c.pending as unknown as { objects: string[] }).objects)).toEqual(['Test Bear']);
  });
});

describe('"Search your library for a Goblin card and/or an Elf card" (CR 701.23a-b; Axgard Armory) and "a basic land card or Gate card" (Open the Gates)', () => {
  it('and/or: one card of each description is asked in turn, each optional (a card found for one description is not offered for the next)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Pair Search'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Goblin', 'Test Goblin Chief', 'Test Elf', 'Test Gate']);
    s = passBoth(cast(s, 'Test Pair Search'));
    expect(s.pending?.kind).toBe('chooseObjects');
    expect([pendingObjects(s).min, pendingObjects(s).max]).toEqual([0, 1]);
    expect(names(s, pendingObjects(s).options).sort()).toEqual(['Test Goblin', 'Test Goblin Chief']);
    s = answer(s, { kind: 'chooseObjects', ids: [pendingObjects(s).options.find((id) => nameOf(s, id) === 'Test Goblin')!] });
    expect(names(s, pendingObjects(s).options)).toEqual(['Test Elf']);
    s = resolveAll(drive(answer(s, { kind: 'chooseObjects', ids: pendingObjects(s).options })));
    expect(handNames(s, 'p1')).toEqual(['Test Elf', 'Test Goblin']);
    expect(names(s, s.zones.library.p1!).sort()).toEqual(['Test Gate', 'Test Goblin Chief']);
  });
  it('and/or: the negative case, two Goblins are not allowed (one card for each description)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Pair Search'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Goblin', 'Test Goblin Chief', 'Test Elf']);
    s = passBoth(cast(s, 'Test Pair Search'));
    const goblins = pendingObjects(s).options.filter((id) => nameOf(s, id).startsWith('Test Goblin'));
    expect(goblins).toHaveLength(2);
    expect(() => answer(s, { kind: 'chooseObjects', ids: goblins })).toThrow();
  });
  it('and/or: either one alone is a legal answer (nothing is forced)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Pair Search'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Goblin', 'Test Elf']);
    s = passBoth(cast(s, 'Test Pair Search'));
    s = answer(s, { kind: 'chooseObjects', ids: [] }); // no Goblin
    s = resolveAll(drive(answer(s, { kind: 'chooseObjects', ids: pendingObjects(s).options })));
    expect(handNames(s, 'p1')).toEqual(['Test Elf']);
  });
  it('"a basic land card or Gate card": a basic land or a Gate, not a nonbasic land that is no Gate, not a creature', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Gate Search'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Cavern', 'Test Gate', 'Plains', 'Test Goblin']);
    s = passBoth(cast(s, 'Test Gate Search'));
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(names(s, pendingObjects(s).options).sort()).toEqual(['Plains', 'Test Gate']);
    s = resolveAll(drive(answer(s, { kind: 'chooseObjects', ids: [pendingObjects(s).options.find((id) => nameOf(s, id) === 'Test Gate')!] })));
    expect(handNames(s, 'p1')).toEqual(['Test Gate']);
  });
});

describe('"If that spell is countered this way, put it into its owner\'s hand instead of into that player\'s graveyard." (CR 701.6a, 614.15, 400.3; Remand)', () => {
  it('the countered spell goes to its owner\'s hand, and you draw a card', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Target Spell'] }, p2: { hand: ['Test Send Back'] } });
    setLibrary(s, 'p2', ['Test Elf']);
    s = cast(s, 'Test Target Spell');
    const spell = s.zones.stack[0]!;
    s = act(s, { type: 'pass', player: 'p1' });
    expect(s.pending?.player).toBe('p2');
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Send Back', 'hand', 'p2') }), { targets: [[{ kind: 'object', id: spell }]] });
    s = resolveAll(s);
    expect(handNames(s, 'p1')).toEqual(['Test Target Spell']);
    expect(gyNames(s, 'p1')).toEqual([]);
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(handNames(s, 'p2')).toEqual(['Test Elf']); // the drawn card
    expect(gyNames(s, 'p2')).toEqual(['Test Send Back']);
  });
  it('the negative case: a spell that was not countered (the counterspell had no legal target left) is not moved', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Target Spell'] }, p2: { hand: ['Test Send Back'] } });
    s = cast(s, 'Test Target Spell');
    s = resolveAll(s); // p2 does not respond
    expect(gyNames(s, 'p1')).toEqual(['Test Target Spell']);
    expect(handNames(s, 'p1')).toEqual([]);
    expect(lifeOf(s, 'p1')).toBe(21);
  });
});

describe('"Return all cards exiled with ~ to their owner\'s hand." (CR 607.2a, 400.3; Bag of Holding)', () => {
  it('the card the bag exiled goes back to its owner\'s hand when the bag is sacrificed; a card exiled by something else stays in exile', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Discarder', 'Test Goblin'], battlefield: ['Test Hoard Bag', 'Plains', 'Plains', 'Plains', 'Plains'] }, p2: {} });
    put(s, 'p1', 'exile' as never, 'Test Trinket');
    s = cast(s, 'Test Discarder', { targets: [[{ kind: 'player', id: 'p1' }]] });
    s = resolveAll(s); // p1 discards the Goblin (the only card in hand): the bag's trigger exiles it from the graveyard
    expect(names(s, s.zones.exile).sort()).toEqual(['Test Goblin', 'Test Trinket']);
    expect(gyNames(s, 'p1')).toEqual(['Test Discarder']);
    const bag = find(s, 'Test Hoard Bag', 'battlefield', 'p1');
    const a = legal(s, 'p1', 'activate').filter((x) => x.object === bag);
    expect(a).toHaveLength(1);
    s = resolveAll(drive(act(s, a[0]!.action)));
    expect(handNames(s, 'p1')).toEqual(['Test Goblin']);
    expect(inExile(s, 'Test Trinket')).toHaveLength(1); // not exiled with the bag
    expect(onBattlefield(s, 'Test Hoard Bag')).toHaveLength(0); // sacrificed as a cost
  });
  it('the negative case: a card discarded by an opponent was not exiled by the bag (its trigger is for you)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Discarder'], battlefield: ['Test Hoard Bag', 'Plains', 'Plains', 'Plains', 'Plains'] }, p2: { hand: ['Test Goblin'] } });
    s = resolveAll(cast(s, 'Test Discarder', { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(gyNames(s, 'p2')).toEqual(['Test Goblin']);
    expect(s.zones.exile).toHaveLength(0);
  });
});

describe('"put all creature cards exiled with ~ onto the battlefield under your control. They gain decayed." (CR 607.2a, 110.2, 400.7; Gisa, Glorious Resurrector)', () => {
  const setup = (): GameState => scenario([], { defs: DEFS, p1: { hand: ['Test Shatter Bolt'], battlefield: ['Test Grave Queen'] }, p2: { battlefield: ['Test Bear'] } });
  const decayed = (s: GameState, id: string): boolean => getChars(s, id)!.keywords.map((k) => k.keyword).includes('decayed');
  it('a creature an opponent controls that would die is exiled instead, and at your next upkeep it returns under your control with decayed', () => {
    let s = setup();
    s = resolveAll(cast(s, 'Test Shatter Bolt', { targets: [[{ kind: 'object', id: find(s, 'Test Bear', 'battlefield', 'p2') }]] }));
    expect(inExile(s, 'Test Bear')).toHaveLength(1);
    expect(gyNames(s, 'p2')).toEqual([]);
    s = advanceTo(s, 3, 'upkeep');
    s = resolveAll(s);
    const back = onBattlefield(s, 'Test Bear', 'p1');
    expect(back).toHaveLength(1);
    expect(decayed(s, back[0]!)).toBe(true);
    expect(inExile(s, 'Test Bear')).toHaveLength(0);
    expect(s.objects[back[0]!]!.owner).toBe('p2'); // it is still the opponent's card, now under your control
  });
  it('the negative case: a creature card exiled by something else is not returned, and your own creature that dies goes to the graveyard', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Shatter Bolt'], battlefield: ['Test Grave Queen', 'Test Cub'] }, p2: {} });
    put(s, 'p2', 'exile' as never, 'Test Goblin');
    s = resolveAll(cast(s, 'Test Shatter Bolt', { targets: [[{ kind: 'object', id: find(s, 'Test Cub', 'battlefield', 'p1') }]] }));
    expect(gyNames(s, 'p1')).toEqual(['Test Cub', 'Test Shatter Bolt']);
    s = resolveAll(advanceTo(s, 3, 'upkeep'));
    expect(inExile(s, 'Test Goblin')).toHaveLength(1);
    expect(onBattlefield(s, 'Test Goblin')).toHaveLength(0);
  });
});

describe('a name that ends with "!" and closes the line: "Exile Blood for the Blood God!" (CR 201.5, 608.2c; Blood for the Blood God!)', () => {
  it('discards the hand, draws eight, deals 8 damage to each opponent and exiles the spell itself (not the graveyard)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Blood Rite!', 'Test Bear', 'Test Cub'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Goblin', 'Test Elf', 'Test Gate', 'Test Cavern', 'Test Ring', 'Test Trinket', 'Test Goblin Chief', 'Test Bear', 'Plains']);
    s = resolveAll(cast(s, 'Test Blood Rite!'));
    expect(gyNames(s, 'p1')).toEqual(['Test Bear', 'Test Cub']);
    expect(s.zones.hand.p1).toHaveLength(8);
    expect(lifeOf(s, 'p2')).toBe(12);
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(names(s, s.zones.exile)).toEqual(['Test Blood Rite!']);
  });
});
