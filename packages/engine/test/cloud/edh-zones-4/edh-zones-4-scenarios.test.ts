/**
 * edh-zones-4 (Commander effort, lane edh-zones): the round's readings played through the engine with synthetic cards (invented names, design 6.10). CR cites from memory,
 * unverified.
 *
 *   CR 701.23a, 701.24a, 401.2   "Target player searches their library for a card, then shuffles and puts that card on top." (also two target players)
 *   CR 701.17a, 608.2c           "Mill five cards, then return a creature card milled this way to your hand."
 *   CR 701.23a, 608.2d           "Search your library for up to four cards with different names and reveal them. Target opponent chooses two of those cards. ..." (and one of three)
 *   CR 401.4, 121.1              "Target player puts the cards in their hand on the bottom of their library in any order, then draws that many cards."
 *   CR 701.20e, 406.3            "Look at the top four cards of target opponent's library, exile one of them face down, then put the rest on the bottom of that library ..."
 *   CR 701.23a, 406.3            "Search target opponent's library for a card and exile it face down. Then that player shuffles. You may play that card for as long as it remains exiled."
 *   CR 603.2c, 400.3             "Whenever one or more cards are put into exile from your library and/or your graveyard, put a +1/+1 counter on this creature."
 *   CR 115.1, 400.1              "Return target X creature card or Y planeswalker card from your graveyard to your hand."
 *   CR 701.23a, 605.1a           "Search your library for an artifact card with a mana ability or a basic land card, reveal it, put it into your hand, then shuffle."
 *   CR 608.2d, 201.2             "Return any number of permanent cards with different names from your graveyard to the battlefield."
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type GameState } from '../../../src/index';
import { put } from '../../m3/scenario';
import { advanceTo, act, activations, answer, card, cast, drive, find, full, passBoth, resolveAll, scenario } from '../r5-cost/support';

const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => nameOf(s, id));
/** Replace a player's whole library (the scenario's filler Plains included) with the named cards, top first. */
function setLibrary(s: GameState, p: 'p1' | 'p2', libNames: string[]): void {
  for (const id of s.zones.library[p]!) delete s.objects[id];
  s.zones.library[p] = [];
  for (const n of libNames) put(s, p, 'library', n);
}
const counters = (s: GameState, name: string): number => { const id = s.zones.battlefield.find((x) => nameOf(s, x) === name)!; return s.objects[id]!.counters['+1/+1'] ?? 0; };

const A = card('Test Card A', 'Sorcery', '');
const B = card('Test Card B', 'Sorcery', '');
const C = card('Test Card C', 'Sorcery', '');
const D = card('Test Card D', 'Sorcery', '');
const E = card('Test Card E', 'Sorcery', '');
const F = card('Test Card F', 'Sorcery', '');
const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
const CUB = card('Test Cub', 'Creature — Bear', '', '{1}', ['1', '1']);
const ROCK = card('Test Rock', 'Artifact', '{T}: Add {C}.', '{1}');
const VASE = card('Test Vase', 'Artifact', '{2}: You gain 1 life.', '{1}');
const FARM = card('Test Farm', 'Land', '{T}: Add {G}.');
const KARN = card('Test Karn', 'Legendary Planeswalker — Karn', '', '{3}');
const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', '{3}', ['3', '3']);

const TOP = card('Test Tutor', 'Sorcery', 'Target player searches their library for a card, then shuffles and puts that card on top.', '{B}');
const PAIR = card('Test Pairing', 'Sorcery', 'Choose two target players. Each of them searches their library for a card, then shuffles and puts that card on top.', '{B}');
const DIG = card('Test Dig', 'Sorcery', 'Mill five cards, then return a creature card milled this way to your hand.', '{G}');
const GIFTS = card('Test Gifts', 'Instant', 'Search your library for up to four cards with different names and reveal them. Target opponent chooses two of those cards. Put the chosen cards into your graveyard and the rest into your hand. Then shuffle.', '{U}');
const INTUIT = card('Test Intuit', 'Instant', 'Search your library for three cards and reveal them. Target opponent chooses one. Put that card into your hand and the rest into your graveyard. Then shuffle.', '{U}');
const BOX = card('Test Box', 'Sorcery', 'Target player puts the cards in their hand on the bottom of their library in any order, then draws that many cards.', '{U}');
const PEEK = card('Test Peek', 'Sorcery', "Look at the top four cards of target opponent's library, exile one of them face down, then put the rest on the bottom of that library in a random order. You may cast that card for as long as it remains exiled, and mana of any type can be spent to cast that spell.", '{U}');
const GRASP = card('Test Grasp', 'Sorcery', "Search target opponent's library for a card and exile it face down. Then that player shuffles. You may play that card for as long as it remains exiled.", '{B}');
const WARLORD = card('Test Warlord', 'Creature — Spirit Warrior', 'Whenever one or more cards are put into exile from your library and/or your graveyard, put a +1/+1 counter on this creature.', '{1}', ['1', '1']);
const EXILER = card('Test Exiler', 'Sorcery', 'Exile the top two cards of your library.', '{R}');
const MORGUE = card('Test Morgue', 'Sorcery', 'Exile target card from your graveyard.', '{R}');
const VIZIER = card('Test Vizier', 'Creature — Rakshasa', 'Whenever one or more cards are put into exile from your graveyard, put that many +1/+1 counters on this creature.', '{1}', ['1', '1']);
const PURGE = card('Test Purge', 'Sorcery', 'Exile all cards from your graveyard.', '{R}');
const PURGE2 = card('Test Purge Two', 'Sorcery', "Exile all cards from target opponent's graveyard.", '{R}');
const UNTIL = card('Test Until', 'Sorcery', 'Exile cards from the top of your library until you exile a nonland card.', '{R}');
const PUZZLE = card('Test Puzzle', 'Artifact', "At the beginning of each player's draw step, that player puts the cards in their hand on the bottom of their library in any order, then draws that many cards.", '{1}');
const BOTH = card('Test Both', 'Sorcery', 'Exile target card from your graveyard. Exile cards from the top of your library until you exile a nonland card.', '{R}');
const RAISE = card('Test Raise', 'Sorcery', 'Return target Golem creature card or Karn planeswalker card from your graveyard to your hand.', '{B}');
const KEY = card('Test Key', 'Artifact', '{1}, {T}, Sacrifice this artifact: Search your library for an artifact card with a mana ability or a basic land card, reveal it, put it into your hand, then shuffle.', '{2}');
const ULTIMA = card('Test Ultima', 'Sorcery', 'Return any number of permanent cards with different names from your graveyard to the battlefield.', '{B}');
const DEFS = [BOTH, PUZZLE, UNTIL, VIZIER, PURGE, PURGE2, A, B, C, D, E, F, BEAR, CUB, ROCK, VASE, FARM, KARN, GOLEM, TOP, PAIR, DIG, GIFTS, INTUIT, BOX, PEEK, GRASP, WARLORD, EXILER, MORGUE, RAISE, KEY, ULTIMA];

describe('the synthetic cards are automated', () => {
  it('play fully', () => { for (const d of [TOP, PAIR, DIG, GIFTS, INTUIT, BOX, PEEK, GRASP, WARLORD, RAISE, KEY, ULTIMA]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true); });
});

const pendingObjects = (s: GameState) => s.pending as { kind: 'chooseObjects'; player: string; options: string[]; min: number; max: number };

describe('"Target player searches their library for a card, then shuffles and puts that card on top." (CR 701.23a, 701.24a, 401.2; Varragoth)', () => {
  const setup = () => {
    const s = scenario(['Swamp'], { defs: DEFS, p1: { hand: ['Test Tutor'], battlefield: ['Swamp'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Card A', 'Test Card B']);
    setLibrary(s, 'p2', ['Test Card C', 'Test Card D', 'Test Card E']);
    return s;
  };
  it('the targeted opponent chooses the card from their own library, and it is on top of that library after the shuffle', () => {
    let s = setup();
    s = cast(s, 'Test Tutor', { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = passBoth(s);
    expect(s.pending?.kind).toBe('chooseObjects');
    const p = pendingObjects(s);
    expect(p.player).toBe('p2'); // the target player searches, not you
    expect(names(s, p.options).sort()).toEqual(['Test Card C', 'Test Card D', 'Test Card E']); // their library only
    s = answer(s, { kind: 'chooseObjects', ids: [p.options.find((id) => nameOf(s, id) === 'Test Card D')!] });
    s = resolveAll(drive(s));
    expect(names(s, s.zones.library.p2!)[0]).toBe('Test Card D');
    expect(names(s, s.zones.library.p2!)).toHaveLength(3);
  });
  it("the negative case: your own library is not searched or changed", () => {
    let s = setup();
    s = cast(s, 'Test Tutor', { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = resolveAll(drive(passBoth(s)));
    expect(names(s, s.zones.library.p1!)).toEqual(['Test Card A', 'Test Card B']);
  });
  it('you may target yourself: you choose from your own library', () => {
    let s = setup();
    s = cast(s, 'Test Tutor', { targets: [[{ kind: 'player', id: 'p1' }]] });
    s = passBoth(s);
    expect(pendingObjects(s).player).toBe('p1');
  });
});

describe('"Choose two target players. Each of them searches their library for a card, then shuffles and puts that card on top." (Scheming Symmetry)', () => {
  it('each of the two players chooses a card of their own library and it ends up on top of that library', () => {
    let s = scenario(['Swamp'], { defs: DEFS, p1: { hand: ['Test Pairing'], battlefield: ['Swamp'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Card A', 'Test Card B']);
    setLibrary(s, 'p2', ['Test Card C', 'Test Card D']);
    s = cast(s, 'Test Pairing', { targets: [[{ kind: 'player', id: 'p1' }, { kind: 'player', id: 'p2' }]] });
    s = passBoth(s);
    const who: string[] = [];
    for (let i = 0; i < 4 && s.pending?.kind === 'chooseObjects'; i++) {
      const p = pendingObjects(s);
      who.push(p.player);
      const pick = p.options.find((id) => nameOf(s, id) === (p.player === 'p1' ? 'Test Card B' : 'Test Card D'))!;
      s = answer(s, { kind: 'chooseObjects', ids: [pick] });
    }
    s = resolveAll(s);
    expect(who.sort()).toEqual(['p1', 'p2']);
    expect(names(s, s.zones.library.p1!)[0]).toBe('Test Card B');
    expect(names(s, s.zones.library.p2!)[0]).toBe('Test Card D');
  });
});

describe('"Mill five cards, then return a creature card milled this way to your hand." (CR 701.17a, 608.2c; Zoological Study)', () => {
  it('only a creature card milled this way can be returned; the others (and the creature already in the graveyard) stay', () => {
    let s = scenario(['Forest'], { defs: DEFS, p1: { hand: ['Test Dig'], battlefield: ['Forest'], graveyard: ['Test Cub'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Card A', 'Test Bear', 'Test Card B', 'Test Golem', 'Test Card D', 'Test Card E']);
    s = cast(s, 'Test Dig');
    s = passBoth(s);
    expect(s.pending?.kind).toBe('chooseObjects');
    const p = pendingObjects(s);
    expect(names(s, p.options).sort()).toEqual(['Test Bear', 'Test Golem']); // not Test Cub, already in the graveyard; not a card of the library that was not milled
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [p.options.find((id) => nameOf(s, id) === 'Test Golem')!] }));
    expect(names(s, s.zones.hand.p1!)).toEqual(['Test Golem']);
    expect(names(s, s.zones.graveyard.p1!).sort()).toEqual(['Test Bear', 'Test Card A', 'Test Card B', 'Test Card D', 'Test Cub', 'Test Dig'].sort());
  });
  it('the one creature milled is returned without a choice to make', () => {
    let s = scenario(['Forest'], { defs: DEFS, p1: { hand: ['Test Dig'], battlefield: ['Forest'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Card A', 'Test Bear', 'Test Card B', 'Test Card C', 'Test Card D', 'Test Card E']);
    s = resolveAll(drive(passBoth(cast(s, 'Test Dig'))));
    expect(names(s, s.zones.hand.p1!)).toEqual(['Test Bear']);
  });
  it('the negative case: no creature among the cards milled: nothing is returned, no choice is asked', () => {
    let s = scenario(['Forest'], { defs: DEFS, p1: { hand: ['Test Dig'], battlefield: ['Forest'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Card A', 'Test Card B', 'Test Card C', 'Test Card D', 'Test Card E', 'Test Bear']);
    s = cast(s, 'Test Dig');
    s = resolveAll(drive(passBoth(s)));
    expect(s.pending?.kind).not.toBe('chooseObjects');
    expect(names(s, s.zones.hand.p1!)).toEqual([]);
  });
});

describe('"Search your library for up to four cards with different names ... Target opponent chooses two of those cards." (CR 701.23a, 608.2d; Gifts Ungiven)', () => {
  const setup = (lib: string[]) => {
    const s = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Gifts'], battlefield: ['Island'] }, p2: {} });
    setLibrary(s, 'p1', lib);
    return s;
  };
  it('you find cards with different names, the opponent chooses two of them for your graveyard and the other two go to your hand', () => {
    let s = setup(['Test Card A', 'Test Card B', 'Test Card C', 'Test Card D', 'Test Card E']);
    s = cast(s, 'Test Gifts', { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = passBoth(s);
    // you search: take four
    const search = pendingObjects(s);
    expect(search.player).toBe('p1');
    for (let i = 0; i < 4 && s.pending?.kind === 'chooseObjects' && pendingObjects(s).player === 'p1'; i++) {
      const p = pendingObjects(s);
      s = answer(s, { kind: 'chooseObjects', ids: [p.options[0]!] });
    }
    expect(s.pending?.kind).toBe('chooseObjects');
    const pick = pendingObjects(s);
    expect(pick.player).toBe('p2'); // the opponent chooses
    expect(pick.min).toBe(2);
    expect(pick.max).toBe(2);
    expect(pick.options).toHaveLength(4);
    const chosenNames = names(s, pick.options.slice(0, 2));
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: pick.options.slice(0, 2) }));
    expect(names(s, s.zones.graveyard.p1!).filter((n) => n !== 'Test Gifts').sort()).toEqual(chosenNames.sort());
    expect(names(s, s.zones.hand.p1!)).toHaveLength(2);
    expect(names(s, s.zones.hand.p1!).every((n) => !chosenNames.includes(n))).toBe(true);
  });
  it('you may find fewer than two cards: the opponent must put them into your graveyard (2017-03-14 ruling)', () => {
    let s = setup(['Test Card A', 'Test Card B']);
    s = cast(s, 'Test Gifts', { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = passBoth(s);
    s = answer(s, { kind: 'chooseObjects', ids: [pendingObjects(s).options[0]!] }); // find just one card
    s = answer(s, { kind: 'chooseObjects', ids: [] }); // and stop
    s = resolveAll(drive(s));
    expect(names(s, s.zones.hand.p1!)).toEqual([]);
    expect(names(s, s.zones.graveyard.p1!).filter((n) => n.startsWith('Test Card'))).toHaveLength(1);
  });
  it('the negative case: two cards of one name cannot both be found (different names)', () => {
    let s = setup(['Test Bear', 'Test Bear', 'Test Cub', 'Test Card A']);
    s = cast(s, 'Test Gifts', { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = passBoth(s);
    let p = pendingObjects(s);
    const firstBear = p.options.find((id) => nameOf(s, id) === 'Test Bear')!;
    s = answer(s, { kind: 'chooseObjects', ids: [firstBear] });
    p = pendingObjects(s);
    expect(names(s, p.options)).not.toContain('Test Bear'); // the second Bear shares a name with the first
  });
});

describe('"Search your library for three cards and reveal them. Target opponent chooses one. Put that card into your hand and the rest into your graveyard." (Intuition)', () => {
  it('the chosen card goes to your hand and the other two into your graveyard', () => {
    let s = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Intuit'], battlefield: ['Island'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Card A', 'Test Card B', 'Test Card C', 'Test Card D']);
    s = cast(s, 'Test Intuit', { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = passBoth(s);
    expect(pendingObjects(s).player).toBe('p1');
    s = answer(s, { kind: 'chooseObjects', ids: pendingObjects(s).options.slice(0, 3) }); // exactly three cards, one decision
    const pick = pendingObjects(s);
    expect(pick.player).toBe('p2');
    expect(pick.max).toBe(1);
    const chosen = pick.options[1]!;
    const chosenName = nameOf(s, chosen);
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [chosen] }));
    expect(names(s, s.zones.hand.p1!)).toEqual([chosenName]);
    expect(names(s, s.zones.graveyard.p1!).filter((n) => n !== 'Test Intuit')).toHaveLength(2);
  });
});

describe('"Target player puts the cards in their hand on the bottom of their library in any order, then draws that many cards." (CR 401.4, 121.1; Teferi\'s Puzzle Box)', () => {
  it('the cards of the target player\'s hand go to the bottom of their library and they draw as many cards', () => {
    let s = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Box'], battlefield: ['Island'] }, p2: { hand: ['Test Card A', 'Test Card B', 'Test Card C'] } });
    setLibrary(s, 'p2', ['Test Card D', 'Test Card E', 'Test Card F']);
    s = cast(s, 'Test Box', { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = passBoth(s);
    for (let i = 0; i < 4 && s.pending !== null && s.pending.kind !== 'priority'; i++) {
      const p = s.pending as { kind: string; options?: string[]; player?: string };
      s = p.kind === 'order' ? drive(s) : answer(s, { kind: 'chooseObjects', ids: p.options ?? [] });
    }
    s = resolveAll(drive(s));
    expect(names(s, s.zones.hand.p2!).sort()).toEqual(['Test Card D', 'Test Card E', 'Test Card F']); // three cards drawn from the top
    expect(names(s, s.zones.library.p2!).slice(-3).sort()).toEqual(['Test Card A', 'Test Card B', 'Test Card C']); // the old hand is at the bottom
  });
  it('the negative case: an empty hand puts nothing on the bottom and draws nothing', () => {
    let s = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Box'], battlefield: ['Island'] }, p2: { hand: [] } });
    setLibrary(s, 'p2', ['Test Card D', 'Test Card E']);
    s = cast(s, 'Test Box', { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = resolveAll(drive(passBoth(s)));
    expect(names(s, s.zones.hand.p2!)).toEqual([]);
    expect(names(s, s.zones.library.p2!)).toEqual(['Test Card D', 'Test Card E']);
  });
});

describe('"At the beginning of each player\'s draw step, that player puts the cards in their hand on the bottom of their library in any order, then draws that many cards." (Teferi\'s Puzzle Box)', () => {
  it('the player whose draw step it is (not its controller) swaps their hand after their normal draw: the old hand is at the bottom and they hold as many new cards', () => {
    let s = scenario(['Island'], { defs: DEFS, p1: { battlefield: ['Test Puzzle'] }, p2: { hand: ['Test Card A', 'Test Card B'] } });
    setLibrary(s, 'p2', ['Test Card C', 'Test Card D', 'Test Card E', 'Test Card F']);
    s = advanceTo(s, 2, 'draw');
    expect(names(s, s.zones.hand.p2!).sort()).toEqual(['Test Card A', 'Test Card B', 'Test Card C']); // the normal draw came first
    for (let i = 0; i < 6 && (s.pending?.kind !== 'priority' || s.zones.stack.length > 0); i++) s = s.zones.stack.length > 0 && s.pending?.kind === 'priority' ? passBoth(s) : drive(s);
    expect(names(s, s.zones.hand.p2!).sort()).toEqual(['Test Card D', 'Test Card E', 'Test Card F']);
    expect(names(s, s.zones.library.p2!).sort()).toEqual(['Test Card A', 'Test Card B', 'Test Card C']);
  });
});

describe('"Look at the top four cards of target opponent\'s library, exile one of them face down, then put the rest on the bottom of that library ..." (Gonti)', () => {
  it('the chosen card is exiled, the other three go to the bottom of the opponent\'s library (not yours), and you may cast the exiled card', () => {
    let s = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Peek'], battlefield: ['Island'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Card F']);
    setLibrary(s, 'p2', ['Test Card A', 'Test Card B', 'Test Card C', 'Test Card D', 'Test Card E']);
    s = cast(s, 'Test Peek', { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = passBoth(s);
    expect(s.pending?.kind).toBe('chooseObjects');
    const p = pendingObjects(s);
    expect(p.player).toBe('p1');
    expect(names(s, p.options).sort()).toEqual(['Test Card A', 'Test Card B', 'Test Card C', 'Test Card D']);
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [p.options.find((id) => nameOf(s, id) === 'Test Card C')!] }));
    expect(names(s, s.zones.exile)).toEqual(['Test Card C']);
    expect(names(s, s.zones.library.p2!)[0]).toBe('Test Card E');
    expect(names(s, s.zones.library.p2!).slice(1, 4).sort()).toEqual(['Test Card A', 'Test Card B', 'Test Card D']);
    expect(names(s, s.zones.library.p1!)).toEqual(['Test Card F']);
  });
});

describe('"Search target opponent\'s library for a card and exile it face down. Then that player shuffles. You may play that card for as long as it remains exiled." (Praetor\'s Grasp)', () => {
  it('you choose from their library, the card is exiled face down and you may play it', () => {
    let s = scenario(['Swamp'], { defs: DEFS, p1: { hand: ['Test Grasp'], battlefield: ['Swamp'] }, p2: {} });
    setLibrary(s, 'p2', ['Test Farm', 'Test Card A']);
    s = cast(s, 'Test Grasp', { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = passBoth(s);
    const p = pendingObjects(s);
    expect(p.player).toBe('p1'); // you search their library
    expect(names(s, p.options).sort()).toEqual(['Test Card A', 'Test Farm']);
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [p.options.find((id) => nameOf(s, id) === 'Test Farm')!] }));
    const exiled = s.zones.exile.find((id) => nameOf(s, id) === 'Test Farm')!;
    expect(s.objects[exiled]!.faceDown).toBe(true);
    expect(legalActions(s, 'p1').some((a) => a.kind === 'playLand' && (a.action as { card?: string }).card === exiled)).toBe(true);
    expect(legalActions(s, 'p2').some((a) => (a.action as { card?: string }).card === exiled && (a.kind === 'playLand' || a.kind === 'cast'))).toBe(false); // the owner may not
  });
});

describe('"Whenever one or more cards are put into exile from your library and/or your graveyard, put a +1/+1 counter on this creature." (CR 603.2c; Laelia)', () => {
  const setup = () => {
    const s = scenario(['Mountain'], { defs: DEFS, p1: { hand: ['Test Exiler', 'Test Morgue'], battlefield: ['Test Warlord', 'Mountain', 'Mountain'], graveyard: ['Test Cub'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Card A', 'Test Card B', 'Test Card C']);
    setLibrary(s, 'p2', ['Test Card D', 'Test Card E']);
    return s;
  };
  it('two cards exiled from your library at once are one batch: one counter', () => {
    let s = setup();
    s = resolveAll(cast(s, 'Test Exiler'));
    expect(counters(s, 'Test Warlord')).toBe(1);
  });
  it('a card exiled from your graveyard: one counter', () => {
    let s = setup();
    s = resolveAll(cast(s, 'Test Morgue', { targets: [[{ kind: 'object', id: find(s, 'Test Cub', 'graveyard', 'p1') }]] }));
    expect(counters(s, 'Test Warlord')).toBe(1);
  });
  it('cards exiled one at a time ("until you exile a nonland card", as cascade does) trigger it once for each card (the 2024-06-07 ruling)', () => {
    let s = setup();
    setLibrary(s, 'p1', ['Test Farm', 'Test Farm', 'Test Bear', 'Test Card A']);
    s = scenario(['Mountain'], { defs: DEFS, p1: { hand: ['Test Until'], battlefield: ['Test Warlord', 'Mountain'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Farm', 'Test Farm', 'Test Bear', 'Test Card A']);
    s = resolveAll(cast(s, 'Test Until'));
    expect(names(s, s.zones.exile).sort()).toEqual(['Test Bear', 'Test Farm', 'Test Farm']);
    expect(counters(s, 'Test Warlord')).toBe(3);
  });
  it('what the resolution exiled before the loop is its own occurrence: a graveyard card, then three cards one at a time, is four counters', () => {
    let s = scenario(['Mountain'], { defs: DEFS, p1: { hand: ['Test Both'], battlefield: ['Test Warlord', 'Mountain'], graveyard: ['Test Cub'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Farm', 'Test Farm', 'Test Bear', 'Test Card A']);
    s = resolveAll(cast(s, 'Test Both', { targets: [[{ kind: 'object', id: find(s, 'Test Cub', 'graveyard', 'p1') }]] }));
    expect(counters(s, 'Test Warlord')).toBe(4);
  });
  it("the negative case: cards exiled from an opponent's library are not yours", () => {
    const opp = card('Test Opp Exiler', 'Sorcery', "Exile the top card of target opponent's library.", '{R}');
    let s = scenario(['Mountain'], { defs: [...DEFS, opp], p1: { hand: ['Test Opp Exiler'], battlefield: ['Test Warlord', 'Mountain'] }, p2: {} });
    setLibrary(s, 'p2', ['Test Card D', 'Test Card E']);
    s = resolveAll(cast(s, 'Test Opp Exiler', { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(counters(s, 'Test Warlord')).toBe(0);
  });
});

describe('"Whenever one or more cards are put into exile from your graveyard, put that many +1/+1 counters" (CR 603.2c, 122.1; Rakshasa Vizier)', () => {
  it('that many is the number of cards of the batch: three cards exiled from your graveyard at once, three counters', () => {
    let s = scenario(['Mountain'], { defs: DEFS, p1: { hand: ['Test Purge'], battlefield: ['Test Vizier', 'Mountain'], graveyard: ['Test Card A', 'Test Card B', 'Test Card C'] }, p2: {} });
    s = resolveAll(cast(s, 'Test Purge'));
    expect(counters(s, 'Test Vizier')).toBe(3);
  });
  it("the negative case: cards exiled from an opponent's graveyard are not yours: no counters", () => {
    let s = scenario(['Mountain'], { defs: DEFS, p1: { hand: ['Test Purge Two'], battlefield: ['Test Vizier', 'Mountain'] }, p2: { graveyard: ['Test Card A', 'Test Card B'] } });
    s = resolveAll(cast(s, 'Test Purge Two', { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(counters(s, 'Test Vizier')).toBe(0);
  });
});

describe('"Return target Golem creature card or Karn planeswalker card from your graveyard to your hand." (CR 115.1; Haven of the Spirit Dragon)', () => {
  const setup = () => scenario(['Swamp'], { defs: DEFS, p1: { hand: ['Test Raise'], battlefield: ['Swamp'], graveyard: ['Test Golem', 'Test Karn', 'Test Bear', 'Test Vase'] }, p2: { graveyard: ['Test Golem'] } });
  it('either description may be targeted, in your graveyard only; a card of neither description may not', () => {
    const s = setup();
    const s1 = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Raise', 'hand', 'p1') });
    expect(s1.pending?.kind).toBe('chooseTargets');
    const ids = JSON.stringify(s1.pending);
    expect(ids).toContain(find(s, 'Test Golem', 'graveyard', 'p1'));
    expect(ids).toContain(find(s, 'Test Karn', 'graveyard', 'p1')); // the other description
    expect(ids).not.toContain(find(s, 'Test Bear', 'graveyard', 'p1')); // a Bear is neither
    expect(ids).not.toContain(find(s, 'Test Vase', 'graveyard', 'p1')); // nor an artifact
    expect(ids).not.toContain(find(s, 'Test Golem', 'graveyard', 'p2')); // not their graveyard
  });
  it('returning the Golem puts it into your hand', () => {
    let s = setup();
    s = resolveAll(cast(s, 'Test Raise', { targets: [[{ kind: 'object', id: find(s, 'Test Golem', 'graveyard', 'p1') }]] }));
    expect(names(s, s.zones.hand.p1!)).toEqual(['Test Golem']);
  });
});

describe('"Search your library for an artifact card with a mana ability or a basic land card" (CR 701.23a, 605.1a; Moonsilver Key)', () => {
  it('a mana rock or a basic land may be found; an artifact without a mana ability and a nonbasic land may not', () => {
    let s = scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Test Key', 'Forest', 'Forest'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Vase', 'Test Rock', 'Test Farm', 'Forest', 'Test Card A']);
    s = act(s, activations(s, 'Test Key')[0]!.action);
    s = drive(s);
    s = passBoth(s);
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(names(s, pendingObjects(s).options).sort()).toEqual(['Forest', 'Test Rock']);
  });
});

describe('"Return any number of permanent cards with different names from your graveyard to the battlefield." (CR 608.2d, 201.2; Eerie Ultimatum)', () => {
  it('two cards of one name cannot both be chosen; cards of different names can, and a nonpermanent card cannot be chosen at all', () => {
    let s = scenario(['Swamp'], { defs: DEFS, p1: { hand: ['Test Ultima'], battlefield: ['Swamp'], graveyard: ['Test Bear', 'Test Bear', 'Test Cub', 'Test Card A'] }, p2: {} });
    s = cast(s, 'Test Ultima');
    s = passBoth(s);
    expect(s.pending?.kind).toBe('chooseObjects');
    let p = pendingObjects(s);
    expect(names(s, p.options).sort()).toEqual(['Test Bear', 'Test Bear', 'Test Cub']); // the sorcery card is not a permanent card
    const bear = p.options.find((id) => nameOf(s, id) === 'Test Bear')!;
    s = answer(s, { kind: 'chooseObjects', ids: [bear] });
    p = pendingObjects(s);
    expect(names(s, p.options)).toEqual(['Test Cub']); // the second Bear shares its name
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: p.options }));
    expect(names(s, s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1')).sort()).toEqual(['Swamp', 'Test Bear', 'Test Cub']);
    expect(names(s, s.zones.graveyard.p1!).filter((n) => n === 'Test Bear')).toHaveLength(1);
  });
});
