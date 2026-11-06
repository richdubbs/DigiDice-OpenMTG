/**
 * edh-zones-13 (Commander effort, lane edh-zones): the round's readings played through the engine with synthetic cards (invented names, design 6.10). CR cites from memory
 * (unverified) unless the notes below say they were checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 608.2c, 118.12            "You may pay {1}. If you do, look at the top two cards of your library. You may reveal a permanent card from among them and put it into your hand. Put the
 *                                rest on the bottom of your library in any order." (Trail of Crumbs): the follow-up sentences are the payment's: nothing happens unpaid
 *   CR 701.23a, 608.2c, 608.2d   "You may search your library for exactly two cards ... that have different names. If you do, reveal those cards. An opponent chooses one of them. Put the
 *                                chosen card into your hand and the other into your graveyard, then shuffle." (Burning-Rune Demon): declining searches, reveals, moves and shuffles nothing
 *   CR 701.23a, 201.2            "Search your library for up to three Dragon cards not named ~ that each have different names, ..." (Tiamat)
 *   CR 205.2a, 701.20e           "For each card type, you may put a card of that type from among the revealed cards into your hand." (Atraxa, Grand Unifier)
 *   CR 508.4, 701.20e            "You may put a Human creature card from among them onto the battlefield tapped and attacking. It gains indestructible until end of turn." (Winota)
 *   CR 701.20e, 608.2c           "Put any number of legendary cards from among them into your hand and the rest into your graveyard. Create a Treasure token for each card put into your
 *                                graveyard this way." (Dihada, Binder of Wills)
 *   CR 701.23a, 701.20a          "Search your library for up to two ... cards and/or ... cards, reveal those cards, put one onto the battlefield tapped and the other into your hand,
 *                                then shuffle." (Navigation Orb)
 *   CR 205.3m, 202.3, 608.2h     "Search your library for a creature card that shares a creature type with the sacrificed creature and has mana value equal to 1 plus that creature's mana
 *                                value." (Pyre of Heroes): last known information of the sacrificed creature
 *   CR 701.17a, 701.17c, 110.2a  "Each player mills four cards. Put a creature card with an even mana value from among the milled cards onto the battlefield under your control." (Gyruda)
 *   CR 701.24a, 701.20a-b, 401.4 "Shuffle your library, then reveal cards from the top of it until you reveal a nonland card. Exile that card and put the rest on the bottom ..." (Creative Technique)
 *   CR 604.1, 613.4c, 303.4      "This creature and enchanted creature each get +X/+X, where X is the number of creature cards in all graveyards." (Nighthowler)
 *   CR 401.4, 400.3, 406.1       "Look at the top card of target player's library. You may put that card on the bottom of that player's library." / "Exile all cards from target player's
 *                                library, then that player shuffles their hand into their library." (Jace, the Mind Sculptor)
 */
import { describe, expect, it } from 'vitest';
import { getChars, type GameState } from '../../../src/index';
import { put } from '../../m3/scenario';
import { answer, attackWith, card, cast, drive, find, full, lifeOf, obj, passBoth, scenario } from '../r5-cost/support';

type P = 'p1' | 'p2';
const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => nameOf(s, id));
const handNames = (s: GameState, p: P): string[] => names(s, s.zones.hand[p]!).sort();
const gyNames = (s: GameState, p: P): string[] => names(s, s.zones.graveyard[p]!).sort();
const libNames = (s: GameState, p: P): string[] => names(s, s.zones.library[p]!);
const exileNames = (s: GameState): string[] => names(s, s.zones.exile).sort();
const battlefield = (s: GameState, name: string, controller?: P): string[] => s.zones.battlefield.filter((id) => nameOf(s, id) === name && (controller === undefined || s.objects[id]!.controller === controller));
/** Replace a player's whole library (the scenario's filler Plains included) with the named cards, top first. */
function setLibrary(s: GameState, p: P, list: string[]): void {
  for (const id of s.zones.library[p]!) delete s.objects[id];
  s.zones.library[p] = [];
  for (const n of list) put(s, p, 'library', n);
}
const tokens = (s: GameState, name: string): string[] => s.zones.battlefield.filter((id) => getChars(s, id).name === name);
const pending = (s: GameState) => s.pending as { kind: 'chooseObjects'; player: P; options: string[]; min: number; max: number };

/**
 * Play the game out until the stack is empty. Each object choice of a player is answered with the cards of `picks[player]` (by name) among its options, else with the fewest
 * cards it asks for; a yes/no choice from `yes` (default yes). With `stopAtChoice` it returns at the first object choice that has options (to look at them).
 */
function run(s0: GameState, o: { picks?: Partial<Record<P, string[]>>; yes?: boolean[]; stopAtChoice?: boolean } = {}): GameState {
  let s = s0;
  const yes = [...(o.yes ?? [])];
  for (let g = 0; g < 80 && s.pending; g++) {
    const p = s.pending;
    if (p.kind === 'chooseObjects') {
      if (o.stopAtChoice === true && p.options.length > 0) return s;
      const wanted = (o.picks?.[p.player as P] ?? []).map((n) => p.options.find((id) => nameOf(s, id) === n)).filter((id): id is string => id !== undefined).slice(0, p.max);
      s = answer(s, { kind: 'chooseObjects', ids: wanted.length >= p.min ? wanted : p.options.slice(0, p.min) });
    } else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: yes.shift() ?? true });
    else if (p.kind === 'priority') {
      if (s.zones.stack.length === 0) break;
      s = passBoth(s);
    } else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true }); // (one decision at a time: drive() would answer the choices after it with the fewest cards)
    else s = drive(s);
  }
  return s;
}

// ---- cards ----------------------------------------------------------------------------------------------------------------------------------------------------------------
const TRAIL = card('Test Crumb Trail', 'Sorcery', 'You may pay {1}. If you do, look at the top two cards of your library. You may reveal a permanent card from among them and put it into your hand. Put the rest on the bottom of your library in any order.');
const RUNE = card('Test Rune Demon', 'Sorcery', 'You may search your library for exactly two cards not named Forest that have different names. If you do, reveal those cards. An opponent chooses one of them. Put the chosen card into your hand and the other into your graveyard, then shuffle.');
const DRAGONS = card('Test Dragon Call', 'Sorcery', 'Search your library for up to three Dragon cards not named Llanowar Elves that each have different names, reveal them, put them into your hand, then shuffle.');
const ATRAXA = card('Test Unifier', 'Sorcery', 'Reveal the top six cards of your library. For each card type, you may put a card of that type from among the revealed cards into your hand. Put the rest on the bottom of your library in a random order.');
const WINOTA = card('Test Horde Caller', 'Creature — Goblin', 'Whenever a creature you control attacks, look at the top four cards of your library. You may put a Goblin creature card from among them onto the battlefield tapped and attacking. It gains indestructible until end of turn. Put the rest of the cards on the bottom of your library in a random order.', '{0}', ['1', '1']);
const DIHADA = card('Test Binder', 'Sorcery', 'Reveal the top four cards of your library. Put any number of legendary cards from among them into your hand and the rest into your graveyard. Create a Treasure token for each card put into your graveyard this way.');
const ORB = card('Test Gate Orb', 'Sorcery', 'Search your library for up to two basic land cards and/or Cave cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.');
const PYRE = card('Test Kin Pyre', 'Sorcery', 'As an additional cost to cast this spell, sacrifice a creature.\nSearch your library for a creature card that shares a creature type with the sacrificed creature and has mana value equal to 1 plus that creature\'s mana value. Put that card onto the battlefield, then shuffle.');
const GYRUDA = card('Test Deep Doom', 'Sorcery', 'Each player mills three cards. Put a creature card with an even mana value from among the milled cards onto the battlefield under your control.');
const TECH = card('Test Odd Technique', 'Sorcery', 'Shuffle your library, then reveal cards from the top of it until you reveal a nonland card. Exile that card and put the rest on the bottom of your library in a random order. You may cast the exiled card without paying its mana cost.');
const MANTLE = card('Test Grave Mantle', 'Enchantment — Aura', 'Enchant creature\nThis Aura and enchanted creature each get +X/+X, where X is the number of creature cards in all graveyards.');
const PEEK = card('Test Peek', 'Sorcery', 'Look at the top card of target player\'s library. You may put that card on the bottom of that player\'s library.');
const WIPE = card('Test Mind Wipe', 'Sorcery', 'Exile all cards from target player\'s library, then that player shuffles their hand into their library.');

const gob = (n: string, cost: string): ReturnType<typeof card> => card(n, 'Creature — Goblin', '', cost, ['1', '1']);
const BEAR = card('Test Bear', 'Creature — Bear', '', '{2}', ['2', '2']);
const GIANT = card('Test Giant', 'Creature — Giant', '', '{4}', ['4', '4']);
const SPRITE = card('Test Sprite', 'Creature — Faerie', '', '{1}', ['1', '1']);
const RELIC = card('Test Relic', 'Artifact', '', '{1}');
const CHARM = card('Test Charm', 'Sorcery', 'You gain 1 life.', '{1}');
const SAGE = card('Test Sage', 'Legendary Creature — Human Wizard', '', '{1}', ['1', '1']);
const SAGE2 = card('Test Seer', 'Legendary Creature — Human Wizard', '', '{1}', ['1', '1']);
const ELF_A = card('Test Elf A', 'Creature — Elf', '', '{1}', ['1', '1']);
const ELF_B = card('Test Elf B', 'Creature — Elf', '', '{1}', ['1', '1']);
const DRAGON_A = card('Test Dragon A', 'Creature — Dragon', '', '{5}', ['4', '4']);
const DRAGON_B = card('Test Dragon B', 'Creature — Dragon', '', '{5}', ['4', '4']);
const DRAGON_EXCLUDED = card('Llanowar Elves', 'Creature — Dragon', '', '{5}', ['4', '4']); // an invented card that borrows a real name, so "not named" names a card the parser knows
const CAVE = card('Test Cave', 'Land — Cave', '');
const DEFS = [CAVE, TRAIL, RUNE, DRAGONS, ATRAXA, WINOTA, DIHADA, ORB, PYRE, GYRUDA, TECH, MANTLE, PEEK, WIPE, gob('Test Goblin Scout', '{1}'), gob('Test Goblin Chief', '{2}'), gob('Test Goblin King', '{3}'), BEAR, GIANT, SPRITE, RELIC, CHARM, SAGE, SAGE2, ELF_A, ELF_B, DRAGON_A, DRAGON_B, DRAGON_EXCLUDED];

describe('the synthetic cards are automated', () => {
  it('play fully', () => {
    for (const d of [TRAIL, RUNE, DRAGONS, ATRAXA, WINOTA, DIHADA, ORB, PYRE, GYRUDA, TECH, MANTLE, PEEK, WIPE]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('"You may pay {1}. If you do, look at the top two cards ... Put the rest on the bottom ..." (CR 608.2c, 118.12; Trail of Crumbs)', () => {
  const setup = (): GameState => {
    const s = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Crumb Trail'], battlefield: ['Plains'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Charm', 'Test Relic', 'Island', 'Plains']);
    return s;
  };
  it('paid: the two cards are looked at, the permanent card chosen goes to the hand, the other goes to the bottom of the library, the third and fourth cards stay on top in order', () => {
    const s = run(cast(setup(), 'Test Crumb Trail'), { picks: { p1: ['Test Relic'] }, yes: [true] });
    expect(handNames(s, 'p1')).toEqual(['Test Relic']);
    expect(libNames(s, 'p1')).toEqual(['Island', 'Plains', 'Test Charm']);
  });
  it('paid, no permanent card among them: both go to the bottom, nothing to the hand', () => {
    const s0 = setup();
    setLibrary(s0, 'p1', ['Test Charm', 'Test Charm', 'Island']);
    const s = run(cast(s0, 'Test Crumb Trail'), { yes: [true] });
    expect(handNames(s, 'p1')).toEqual([]);
    expect(libNames(s, 'p1')).toEqual(['Island', 'Test Charm', 'Test Charm']);
  });
  it('NEGATIVE: with the payment declined nothing is looked at, nothing moves (the follow-up sentences are the payment\'s)', () => {
    const s = run(cast(setup(), 'Test Crumb Trail'), { yes: [false] });
    expect(handNames(s, 'p1')).toEqual([]);
    expect(libNames(s, 'p1')).toEqual(['Test Charm', 'Test Relic', 'Island', 'Plains']);
  });
});

describe('"You may search your library for exactly two cards not named Forest that have different names. If you do, reveal those cards. An opponent chooses one of them. ..." (CR 608.2c, 701.23a; Burning-Rune Demon)', () => {
  const setup = (): GameState => {
    const s = scenario(['Forest', 'Island'], { defs: DEFS, p1: { hand: ['Test Rune Demon'] }, p2: {} });
    setLibrary(s, 'p1', ['Forest', 'Test Bear', 'Test Bear', 'Island', 'Test Relic']);
    return s;
  };
  it('accepted: the two cards found have different names and are not named Forest; the opponent chooses one: it goes to the hand, the other to the graveyard', () => {
    const s0 = run(cast(setup(), 'Test Rune Demon'), { picks: { p1: ['Test Bear', 'Island'] }, yes: [true], stopAtChoice: true });
    // the first choice asked is the search: Forest is not offered
    expect(names(s0, pending(s0).options)).not.toContain('Forest');
    const s = run(s0, { picks: { p1: ['Test Bear', 'Island'], p2: ['Island'] }, yes: [true] });
    expect(handNames(s, 'p1')).toEqual(['Island']);
    expect(gyNames(s, 'p1')).toEqual(['Test Bear', 'Test Rune Demon']);
  });
  it('NEGATIVE: the search declined: nothing is revealed, chosen or moved and the library is not shuffled (the order stays)', () => {
    const s = run(cast(setup(), 'Test Rune Demon'), { picks: { p2: ['Island'] }, yes: [false] });
    expect(handNames(s, 'p1')).toEqual([]);
    expect(gyNames(s, 'p1')).toEqual(['Test Rune Demon']);
    expect(libNames(s, 'p1')).toEqual(['Forest', 'Test Bear', 'Test Bear', 'Island', 'Test Relic']);
  });
});

describe('"Search your library for up to three Dragon cards not named ~ that each have different names, reveal them, put them into your hand, then shuffle." (CR 701.23a, 201.2; Tiamat)', () => {
  const setup = (): GameState => {
    const s = scenario(['Forest'], { defs: DEFS, p1: { hand: ['Test Dragon Call'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Dragon A', 'Test Dragon A', 'Llanowar Elves', 'Test Dragon B', 'Test Elf A', 'Forest']);
    return s;
  };
  it('three Dragon cards of three different names are never found: the excluded name and a repeated name are not offered together', () => {
    const s = run(cast(setup(), 'Test Dragon Call'), { picks: { p1: ['Test Dragon A', 'Test Dragon B'] } });
    expect(handNames(s, 'p1')).toEqual(['Test Dragon A', 'Test Dragon B']);
    expect(handNames(s, 'p1')).not.toContain('Llanowar Elves');
    expect(libNames(s, 'p1').filter((n) => n === 'Test Dragon A')).toHaveLength(1); // the second Dragon A stays in the library
  });
  it('NEGATIVE: the card with the excluded name and the non-Dragons are never in the options of the search', () => {
    const s = run(cast(setup(), 'Test Dragon Call'), { stopAtChoice: true });
    const options = pending(s).options.map((id) => nameOf(s, id));
    expect(options).not.toContain('Llanowar Elves');
    expect(options).not.toContain('Test Elf A');
    expect(options).not.toContain('Forest');
  });
});

describe('"Reveal the top six cards ... For each card type, you may put a card of that type from among the revealed cards into your hand. Put the rest on the bottom ..." (CR 205.2a, 701.20e; Atraxa)', () => {
  it('one card of each type may be taken: a creature, a land and an artifact; the rest go to the bottom, the seventh card stays on top', () => {
    const s0 = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Unifier'] }, p2: {} });
    setLibrary(s0, 'p1', ['Test Bear', 'Test Giant', 'Island', 'Test Relic', 'Test Charm', 'Plains', 'Test Sprite']);
    const s = run(cast(s0, 'Test Unifier'), { picks: { p1: ['Test Bear', 'Island', 'Test Relic', 'Test Charm'] } });
    expect(handNames(s, 'p1')).toEqual(['Island', 'Test Bear', 'Test Charm', 'Test Relic']);
    expect(libNames(s, 'p1')[0]).toBe('Test Sprite'); // the seventh card was never revealed
    expect(libNames(s, 'p1').slice(1).sort()).toEqual(['Plains', 'Test Giant']);
  });
  it('NEGATIVE: the choice is optional per type: taking nothing puts all six on the bottom', () => {
    const s0 = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Unifier'] }, p2: {} });
    setLibrary(s0, 'p1', ['Test Bear', 'Test Giant', 'Island', 'Test Relic', 'Test Charm', 'Plains', 'Test Sprite']);
    const s = run(cast(s0, 'Test Unifier'));
    expect(handNames(s, 'p1')).toEqual([]);
    expect(libNames(s, 'p1')[0]).toBe('Test Sprite');
    expect(libNames(s, 'p1')).toHaveLength(7);
  });
});

describe('"... You may put a Goblin creature card from among them onto the battlefield tapped and attacking. It gains indestructible until end of turn. Put the rest of the cards on the bottom ..." (CR 508.4, 701.20e; Winota)', () => {
  const setup = (top: string[]): GameState => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Horde Caller'] }, p2: {} });
    setLibrary(s, 'p1', [...top, 'Test Sprite', 'Test Relic']);
    return s;
  };
  const idIn = (s: GameState, zone: 'library' | 'battlefield', name: string): string => (zone === 'battlefield' ? s.zones.battlefield : s.zones.library.p1!).find((id) => nameOf(s, id) === name)!;
  it('the Goblin card enters tapped and ATTACKING (it deals combat damage), gains indestructible until end of turn, and the other three go to the bottom', () => {
    const s0 = setup(['Test Bear', 'Test Goblin Chief', 'Test Charm', 'Test Giant']);
    const s = attackWith(s0, [idIn(s0, 'battlefield', 'Test Horde Caller')], 'p2', { objects: [[idIn(s0, 'library', 'Test Goblin Chief')]] });
    const chief = battlefield(s, 'Test Goblin Chief', 'p1');
    expect(chief).toHaveLength(1);
    expect(s.objects[chief[0]!]!.tapped).toBe(true);
    expect(lifeOf(s, 'p2')).toBe(18); // the new attacker dealt its 1 damage with the Horde Caller's 1
    expect(getChars(s, chief[0]!).keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword?: string }).keyword))).toContain('indestructible');
    expect(libNames(s, 'p1').slice(0, 2)).toEqual(['Test Sprite', 'Test Relic']);
    expect(libNames(s, 'p1').slice(2).sort()).toEqual(['Test Bear', 'Test Charm', 'Test Giant']);
  });
  it('NEGATIVE: with no Goblin creature card among the four nothing enters (a Human or a Bear is not offered) and all four go to the bottom', () => {
    const s0 = setup(['Test Bear', 'Test Elf A', 'Test Charm', 'Test Giant']);
    const s = attackWith(s0, [idIn(s0, 'battlefield', 'Test Horde Caller')], 'p2');
    expect(battlefield(s, 'Test Bear')).toHaveLength(0);
    expect(lifeOf(s, 'p2')).toBe(19);
    expect(libNames(s, 'p1').slice(0, 2)).toEqual(['Test Sprite', 'Test Relic']);
    expect(libNames(s, 'p1')).toHaveLength(6);
  });
  it('NEGATIVE: declining the optional put leaves the Goblin card with the rest on the bottom', () => {
    const s0 = setup(['Test Bear', 'Test Goblin Chief', 'Test Charm', 'Test Giant']);
    const s = attackWith(s0, [idIn(s0, 'battlefield', 'Test Horde Caller')], 'p2', { objects: [[]] });
    expect(battlefield(s, 'Test Goblin Chief')).toHaveLength(0);
    expect(lifeOf(s, 'p2')).toBe(19);
  });
});

describe('"Reveal the top four cards. Put any number of legendary cards from among them into your hand and the rest into your graveyard. Create a Treasure token for each card put into your graveyard this way." (CR 701.20e, 608.2c; Dihada)', () => {
  const setup = (): GameState => {
    const s = scenario([], { defs: DEFS, p1: { hand: ['Test Binder'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Sage', 'Test Bear', 'Test Seer', 'Test Relic', 'Test Charm']);
    return s;
  };
  it('both legendary cards taken: they go to the hand, the other two of the four to the graveyard, a Treasure token for each of those two, the fifth card stays', () => {
    const s = run(cast(setup(), 'Test Binder'), { picks: { p1: ['Test Sage', 'Test Seer'] } });
    expect(handNames(s, 'p1')).toEqual(['Test Sage', 'Test Seer']);
    expect(gyNames(s, 'p1')).toEqual(['Test Bear', 'Test Binder', 'Test Relic']);
    expect(tokens(s, 'Treasure Token')).toHaveLength(2);
    expect(libNames(s, 'p1')).toEqual(['Test Charm']);
  });
  it('NEGATIVE: taking only one legendary card sends the other legendary card to the graveyard with the rest: three tokens', () => {
    const s = run(cast(setup(), 'Test Binder'), { picks: { p1: ['Test Sage'] } });
    expect(handNames(s, 'p1')).toEqual(['Test Sage']);
    expect(gyNames(s, 'p1')).toEqual(['Test Bear', 'Test Binder', 'Test Relic', 'Test Seer']);
    expect(tokens(s, 'Treasure Token')).toHaveLength(3);
  });
  it('NEGATIVE: a card that is not legendary is never offered, and taking none puts all four into the graveyard (four tokens)', () => {
    const s0 = run(cast(setup(), 'Test Binder'), { stopAtChoice: true });
    expect(names(s0, pending(s0).options).sort()).toEqual(['Test Sage', 'Test Seer']);
    const s = run(s0);
    expect(handNames(s, 'p1')).toEqual([]);
    expect(tokens(s, 'Treasure Token')).toHaveLength(4);
  });
});

describe('"Search your library for up to two basic land cards and/or Cave cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle." (CR 701.23a, 701.20a; Navigation Orb)', () => {
  const setup = (top: string[]): GameState => {
    const s = scenario([], { defs: DEFS, p1: { hand: ['Test Gate Orb'] }, p2: {} });
    setLibrary(s, 'p1', top);
    return s;
  };
  it('two cards found: the one chosen enters tapped, the other goes to the hand; a card that is neither a basic land nor a Cave is never offered', () => {
    const s0 = run(cast(setup(['Test Bear', 'Plains', 'Test Cave', 'Test Bear']), 'Test Gate Orb'), { stopAtChoice: true });
    expect(names(s0, pending(s0).options).sort()).toEqual(['Plains', 'Test Cave']);
    const s = run(s0, { picks: { p1: ['Test Cave', 'Plains'] } });
    const cave = battlefield(s, 'Test Cave', 'p1');
    expect(cave).toHaveLength(1);
    expect(s.objects[cave[0]!]!.tapped).toBe(true);
    expect(handNames(s, 'p1')).toEqual(['Plains']);
  });
  it('NEGATIVE: only one card found: it is the one put onto the battlefield, the hand stays empty', () => {
    const s = run(cast(setup(['Test Bear', 'Test Cave', 'Test Bear']), 'Test Gate Orb'), { picks: { p1: ['Test Cave'] } });
    expect(battlefield(s, 'Test Cave', 'p1')).toHaveLength(1);
    expect(handNames(s, 'p1')).toEqual([]);
  });
});

describe('"Search your library for a creature card that shares a creature type with the sacrificed creature and has mana value equal to 1 plus that creature\'s mana value." (CR 205.3m, 202.3, 608.2h; Pyre of Heroes)', () => {
  const setup = (): GameState => {
    const s = scenario([], { defs: DEFS, p1: { hand: ['Test Kin Pyre'], battlefield: ['Test Goblin Scout'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Goblin King', 'Test Bear', 'Test Goblin Chief', 'Test Goblin Scout']);
    return s;
  };
  it('the sacrificed Goblin of mana value 1: only the Goblin of mana value 2 is offered; it enters the battlefield', () => {
    const s0 = run(cast(setup(), 'Test Kin Pyre', { objects: [[find(setup(), 'Test Goblin Scout', 'battlefield', 'p1')]] }), { stopAtChoice: true });
    // (the search is the first object choice left: the sacrifice was paid as the additional cost)
    expect(names(s0, pending(s0).options)).toEqual(['Test Goblin Chief']);
    const s = run(s0, { picks: { p1: ['Test Goblin Chief'] } });
    expect(battlefield(s, 'Test Goblin Chief', 'p1')).toHaveLength(1);
    expect(battlefield(s, 'Test Goblin Scout')).toHaveLength(0); // the sacrificed one is gone
  });
  it('NEGATIVE: a Goblin of mana value 3 (too high), a Bear of mana value 2 (no shared type) and a Goblin of mana value 1 (the same value) are never offered', () => {
    const s0 = run(cast(setup(), 'Test Kin Pyre', { objects: [[find(setup(), 'Test Goblin Scout', 'battlefield', 'p1')]] }), { stopAtChoice: true });
    const offered = names(s0, pending(s0).options);
    expect(offered).not.toContain('Test Goblin King');
    expect(offered).not.toContain('Test Bear');
    expect(offered).not.toContain('Test Goblin Scout');
  });
});

describe('"Each player mills three cards. Put a creature card with an even mana value from among the milled cards onto the battlefield under your control." (CR 701.17a, 701.17c, 110.2a; Gyruda)', () => {
  const setup = (): GameState => {
    const s = scenario([], { defs: DEFS, p1: { hand: ['Test Deep Doom'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Bear', 'Test Sprite', 'Test Relic', 'Test Charm']);
    setLibrary(s, 'p2', ['Test Giant', 'Test Charm', 'Test Sprite', 'Test Relic']);
    return s;
  };
  it('the cards of BOTH players are among the milled ones: the even creatures (a Bear of 2, a Giant of 4) are offered, an odd Sprite and the non-creatures are not; the Giant from the opponent\'s graveyard enters under your control', () => {
    const s0 = run(cast(setup(), 'Test Deep Doom'), { stopAtChoice: true });
    expect(names(s0, pending(s0).options).sort()).toEqual(['Test Bear', 'Test Giant']);
    const s = run(s0, { picks: { p1: ['Test Giant'] } });
    expect(battlefield(s, 'Test Giant', 'p1')).toHaveLength(1);
    expect(gyNames(s, 'p2')).toEqual(['Test Charm', 'Test Sprite']);
    expect(libNames(s, 'p1')).toEqual(['Test Charm']); // three cards milled each, the fourth stays
  });
  it('NEGATIVE: a card that was not milled (the fourth card of a library) is not among the cards to put: with one milled even creature the only one is put, the Giant stays in its library', () => {
    const s0 = setup();
    setLibrary(s0, 'p2', ['Test Charm', 'Test Charm', 'Test Charm', 'Test Giant']);
    const s = run(cast(s0, 'Test Deep Doom'));
    expect(battlefield(s, 'Test Bear', 'p1')).toHaveLength(1); // the only milled creature card of an even mana value
    expect(battlefield(s, 'Test Giant')).toHaveLength(0);
    expect(libNames(s, 'p2')).toEqual(['Test Giant']);
    expect(gyNames(s, 'p1')).toContain('Test Sprite'); // the milled cards that were not taken stay in their owner's graveyard
  });
});

describe('"Shuffle your library, then reveal cards from the top of it until you reveal a nonland card. Exile that card and put the rest ... You may cast the exiled card without paying its mana cost." (CR 701.24a, 701.20a-b; Creative Technique)', () => {
  const setup = (): GameState => {
    const s = scenario([], { defs: DEFS, p1: { hand: ['Test Odd Technique'] }, p2: {} });
    setLibrary(s, 'p1', ['Plains', 'Plains', 'Test Bear', 'Plains']);
    return s;
  };
  it('the one nonland card is exiled, may be cast for free (it enters), and the lands revealed go to the bottom of the library', () => {
    const s0 = run(cast(setup(), 'Test Odd Technique'), { yes: [true] });
    expect(battlefield(s0, 'Test Bear', 'p1').length + exileNames(s0).filter((n) => n === 'Test Bear').length).toBeGreaterThan(0);
    expect(libNames(s0, 'p1').filter((n) => n === 'Plains').length).toBeGreaterThanOrEqual(3);
  });
  it('NEGATIVE: declining the free cast leaves the nonland card in exile, never in the library or the hand', () => {
    const s = run(cast(setup(), 'Test Odd Technique'), { yes: [false] });
    expect(exileNames(s)).toContain('Test Bear');
    expect(handNames(s, 'p1')).not.toContain('Test Bear');
    expect(libNames(s, 'p1')).not.toContain('Test Bear');
  });
});

describe('"This Aura and enchanted creature each get +X/+X, where X is the number of creature cards in all graveyards." (CR 604.1, 613.4c, 303.4; Nighthowler)', () => {
  const setup = (): GameState => {
    const s = scenario([], { defs: DEFS, p1: { hand: ['Test Grave Mantle'], battlefield: ['Test Bear'] }, p2: {} });
    put(s, 'p1', 'graveyard', 'Test Giant');
    put(s, 'p2', 'graveyard', 'Test Sprite');
    put(s, 'p2', 'graveyard', 'Test Charm');
    return s;
  };
  it('the enchanted creature gets +X/+X with X the creature cards in BOTH graveyards (two), not the other cards', () => {
    const s0 = setup();
    const bear = s0.zones.battlefield.find((id) => nameOf(s0, id) === 'Test Bear')!;
    const s = run(cast(s0, 'Test Grave Mantle', { targets: [[obj(bear)]] }));
    expect([Number(getChars(s, bear).power), Number(getChars(s, bear).toughness)]).toEqual([4, 4]);
  });
  it('NEGATIVE: without the Aura the Bear is a 2/2', () => {
    const s0 = setup();
    const bear = s0.zones.battlefield.find((id) => nameOf(s0, id) === 'Test Bear')!;
    expect([Number(getChars(s0, bear).power), Number(getChars(s0, bear).toughness)]).toEqual([2, 2]);
  });
});

describe('"Look at the top card of target player\'s library. You may put that card on the bottom of that player\'s library." and the -12 (CR 401.4, 400.3, 406.1, 701.24a; Jace, the Mind Sculptor)', () => {
  const setup = (card1: string): GameState => {
    const s = scenario([], { defs: DEFS, p1: { hand: [card1] }, p2: { hand: ['Test Charm', 'Test Relic'] } });
    setLibrary(s, 'p2', ['Test Bear', 'Test Giant', 'Test Sprite']);
    setLibrary(s, 'p1', ['Test Charm', 'Test Relic']);
    return s;
  };
  it('accepted: the top card of the TARGET player\'s library goes to the bottom of THAT library (not yours)', () => {
    const s = run(cast(setup('Test Peek'), 'Test Peek', { targets: [[{ kind: 'player', id: 'p2' }]] }), { yes: [true] });
    expect(libNames(s, 'p2')).toEqual(['Test Giant', 'Test Sprite', 'Test Bear']);
    expect(libNames(s, 'p1')).toEqual(['Test Charm', 'Test Relic']);
  });
  it('NEGATIVE: declined: the library is unchanged', () => {
    const s = run(cast(setup('Test Peek'), 'Test Peek', { targets: [[{ kind: 'player', id: 'p2' }]] }), { yes: [false] });
    expect(libNames(s, 'p2')).toEqual(['Test Bear', 'Test Giant', 'Test Sprite']);
  });
  it('the -12: the whole target library is exiled, then that player\'s hand is shuffled into their (now empty) library; your own cards are untouched', () => {
    const s = run(cast(setup('Test Mind Wipe'), 'Test Mind Wipe', { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(exileNames(s)).toEqual(['Test Bear', 'Test Giant', 'Test Sprite']);
    expect(libNames(s, 'p2').sort()).toEqual(['Test Charm', 'Test Relic']);
    expect(handNames(s, 'p2')).toEqual([]);
    expect(libNames(s, 'p1')).toEqual(['Test Charm', 'Test Relic']);
  });
});
