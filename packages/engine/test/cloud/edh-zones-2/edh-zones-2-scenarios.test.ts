/**
 * edh-zones-2 (Commander effort, lane edh-zones): the round's readings played through the engine with synthetic cards (invented names, design 6.10). CR cites from memory,
 * unverified.
 *
 *   CR 701.20e, 401.4, 107.3, 608.2h, 104.2b   "Look at the top X cards of your library, where X is your devotion to blue. Put up to one of them on top of your library and the
 *                                               rest on the bottom in a random order. If X is greater than or equal to the number of cards in your library, you win the game."
 *   CR 701.24a, 406.1, 118.9                   "{5}: Shuffle your library, then exile the top card. Until end of turn, you may play that card without paying its mana cost."
 *   CR 701.23a, 107.3, 608.2h                  "Search your library for a creature card with mana value X or less, where X is 2 plus the sacrificed creature's mana value."
 *   CR 701.17a, 608.2c                         "Mill three cards. Then you may pay {1} and 3 life. If you do, put a card from among those cards into your hand."
 *   CR 701.20e, 401.4, 406.1                   "Look at the top three cards of your library. Put one of them into your hand, put one of them on the bottom of your library, and exile one of them. You may play the exiled card this turn."
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type GameState } from '../../../src/index';
import { findAll, put, reject } from '../../m3/scenario';
import { act, activations, answer, card, cast, drive, find, full, passBoth, resolveAll, scenario } from '../r5-cost/support';

const ORACLE = card('Test Oracle', 'Creature — Merfolk Wizard', 'When this creature enters, look at the top X cards of your library, where X is your devotion to blue. Put up to one of them on top of your library and the rest on the bottom of your library in a random order. If X is greater than or equal to the number of cards in your library, you win the game.', '{U}{U}', ['1', '3'], ['U']);
const A = card('Test Card A', 'Sorcery', '');
const B = card('Test Card B', 'Sorcery', '');
const C = card('Test Card C', 'Sorcery', '');
const D = card('Test Card D', 'Sorcery', '');
const E = card('Test Card E', 'Sorcery', '');
const SMITH = card('Test Smith', 'Artifact', '{5}: Shuffle your library, then exile the top card. Until end of turn, you may play that card without paying its mana cost.', '{0}');
const BIGGIE = card('Test Biggie', 'Artifact', '', '{4}');
const TOWN = card('Test Town', 'Land', '');
const XGEM = card('Test Xgem', 'Artifact', '', '{X}{2}');
const EVOLUTION = card('Test Evolution', 'Sorcery', 'As an additional cost to cast this spell, sacrifice a creature.\nSearch your library for a creature card with mana value X or less, where X is 2 plus the sacrificed creature\'s mana value. Put that card onto the battlefield, then shuffle. Exile Test Evolution.', '{2}{G}');
const CUB = card('Test Cub', 'Creature — Bear', '', '{1}', ['1', '1']);
const BEAR3 = card('Test Bear Three', 'Creature — Bear', '', '{2}{G}', ['3', '3']);
const THREE = card('Test Three', 'Creature — Beast', '', '{3}', ['3', '3']);
const FOUR = card('Test Four', 'Creature — Beast', '', '{4}', ['4', '4']);
const FIVE = card('Test Five', 'Creature — Beast', '', '{5}', ['5', '5']);
const GEM = card('Test Gem', 'Artifact', '', '{2}');
const RIPPLE = card('Test Ripple', 'Sorcery', 'Mill three cards. Then you may pay {1} and 3 life. If you do, put a card from among those cards into your hand.');
const ITERATE = card('Test Iterate', 'Sorcery', 'Look at the top three cards of your library. Put one of them into your hand, put one of them on the bottom of your library, and exile one of them. You may play the exiled card this turn.');
const DEFS = [ORACLE, A, B, C, D, E, SMITH, BIGGIE, TOWN, EVOLUTION, CUB, BEAR3, THREE, FOUR, FIVE, GEM, RIPPLE, ITERATE, XGEM];

const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => nameOf(s, id));
/** Replace a player's whole library (the scenario's filler Plains included) with the named cards, top first. */
function setLibrary(s: GameState, p: 'p1' | 'p2', libNames: string[]): void {
  for (const id of s.zones.library[p]!) delete s.objects[id];
  s.zones.library[p] = [];
  for (const n of libNames) put(s, p, 'library', n);
}

describe('the synthetic cards are automated', () => {
  it('play fully', () => { for (const d of [ORACLE, SMITH, EVOLUTION, RIPPLE, ITERATE]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true); });
});

describe('"look at the top X cards ..., where X is your devotion to blue" (CR 701.20e, 107.3, 608.2h, 104.2b; Thassa\'s Oracle)', () => {
  const setup = (lib: string[]) => {
    const s = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Oracle'], battlefield: ['Island', 'Island'] }, p2: {} });
    setLibrary(s, 'p1', lib);
    setLibrary(s, 'p2', ['Test Card A', 'Test Card B']);
    return s;
  };
  it('X (2) is not less than the library (2 cards): you win the game', () => {
    let s = setup(['Test Card A', 'Test Card B']);
    s = cast(s, 'Test Oracle');
    s = resolveAll(s);
    expect(s.result?.winner).toBe('p1');
  });
  it('X (2) is greater than the library (1 card): you win the game', () => {
    let s = setup(['Test Card A']);
    s = cast(s, 'Test Oracle');
    s = resolveAll(s);
    expect(s.result?.winner).toBe('p1');
  });
  it('the negative case: X (2) is less than the library (5 cards): nobody wins, the card chosen goes on top and the other looked-at card goes to the bottom', () => {
    let s = setup(['Test Card A', 'Test Card B', 'Test Card C', 'Test Card D', 'Test Card E']);
    s = cast(s, 'Test Oracle');
    s = passBoth(s); // the creature spell resolves and enters
    s = passBoth(s); // its enters trigger resolves
    expect(s.pending?.kind).toBe('chooseObjects');
    const p = s.pending as { kind: 'chooseObjects'; player: string; options: string[]; min: number; max: number };
    expect(p.player).toBe('p1');
    expect(p.min).toBe(0);
    expect(p.max).toBe(1);
    expect(names(s, p.options).sort()).toEqual(['Test Card A', 'Test Card B']); // exactly the top two cards (devotion to blue is 2)
    s = answer(s, { kind: 'chooseObjects', ids: [p.options.find((id) => nameOf(s, id) === 'Test Card B')!] });
    s = drive(s);
    expect(s.result).toBeNull();
    expect(names(s, s.zones.library.p1!)).toEqual(['Test Card B', 'Test Card C', 'Test Card D', 'Test Card E', 'Test Card A']);
  });
  it('choosing none of them (up to one) sends both to the bottom', () => {
    let s = setup(['Test Card A', 'Test Card B', 'Test Card C', 'Test Card D', 'Test Card E']);
    s = cast(s, 'Test Oracle');
    s = passBoth(s);
    s = passBoth(s);
    s = answer(s, { kind: 'chooseObjects', ids: [] });
    s = drive(s);
    expect(s.result).toBeNull();
    expect(names(s, s.zones.library.p1!).slice(0, 3)).toEqual(['Test Card C', 'Test Card D', 'Test Card E']);
    expect(names(s, s.zones.library.p1!).slice(3).sort()).toEqual(['Test Card A', 'Test Card B']);
  });
  it("the opponent's library size does not matter (the negative case): your library has 5 cards, theirs has 2", () => {
    let s = setup(['Test Card A', 'Test Card B', 'Test Card C', 'Test Card D', 'Test Card E']);
    s = cast(s, 'Test Oracle');
    s = resolveAll(s);
    expect(s.result).toBeNull();
    expect(s.zones.library.p2).toHaveLength(2);
  });
});

const playOptions = (st: GameState, id: string) => legalActions(st, 'p1').filter((a) => (a.action as { card?: string }).card === id && (a.kind === 'cast' || a.kind === 'playLand'));

describe('"Shuffle your library, then exile the top card. Until end of turn, you may play that card without paying its mana cost." (CR 701.24a, 406.1, 118.9, 305.1; Urza, Lord High Artificer / Mind\'s Desire)', () => {
  function afterActivation(top: string): GameState {
    let s = scenario(['Island'], { defs: DEFS, p1: { battlefield: ['Test Smith', 'Island', 'Island', 'Island', 'Island', 'Island'], library: [top] }, p2: { library: ['Test Card A'] } });
    setLibrary(s, 'p1', [top]);
    setLibrary(s, 'p2', ['Test Card A']);
    s = act(s, activations(s, 'Test Smith')[0]!.action);
    s = drive(s);
    return resolveAll(s);
  }
  it('the top card (a spell costing {4}) is exiled and cast for no mana with no lands untapped; the library is empty afterwards', () => {
    let s = afterActivation('Test Biggie');
    for (const id of s.zones.battlefield) if (nameOf(s, id) === 'Island') s.objects[id]!.tapped = true; // the five lands paid for the ability
    expect(s.zones.library.p1).toHaveLength(0);
    const big = find(s, 'Test Biggie', 'exile');
    const opts = playOptions(s, big);
    expect(opts).toHaveLength(1);
    s = act(s, opts[0]!.action);
    while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    s = resolveAll(s);
    expect(findAll(s, 'Test Biggie', 'battlefield')).toHaveLength(1);
  });
  it('the top card (a land) is played from exile as the land drop, for free', () => {
    let s = afterActivation('Test Town');
    const town = find(s, 'Test Town', 'exile');
    const opts = playOptions(s, town);
    expect(opts).toHaveLength(1);
    expect(opts[0]!.kind).toBe('playLand');
    s = act(s, opts[0]!.action);
    expect(findAll(s, 'Test Town', 'battlefield')).toHaveLength(1);
  });
  it('a spell with {X} in its mana cost is cast with X = 0 (CR 107.3b, 118.9): no mana is asked for', () => {
    let s = afterActivation('Test Xgem');
    for (const id of s.zones.battlefield) if (nameOf(s, id) === 'Island') s.objects[id]!.tapped = true;
    const opts = playOptions(s, find(s, 'Test Xgem', 'exile'));
    expect(opts).toHaveLength(1);
    s = act(s, opts[0]!.action);
    while (s.pending?.kind === 'chooseNumber' || s.pending?.kind === 'payCost') {
      const p = s.pending;
      s = p.kind === 'chooseNumber' ? answer(s, { kind: 'chooseNumber', n: p.min }) : answer(s, { kind: 'payCost', auto: true });
    }
    s = resolveAll(s);
    expect(findAll(s, 'Test Xgem', 'battlefield')).toHaveLength(1);
  });
  it('the negative cases: a card in exile that the ability did not exile is not playable, and casting for the mana cost is not allowed', () => {
    const s = afterActivation('Test Biggie');
    const other = (() => { const t = scenario([], { defs: DEFS, p1: { battlefield: ['Test Smith'], exile: ['Test Biggie'] }, p2: {} }); return t; })();
    expect(playOptions(other, find(other, 'Test Biggie', 'exile'))).toHaveLength(0);
    expect(reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Biggie', 'exile') }).rules).toContain('CR 118.9');
  });
  it('the opponent library is not touched (only yours is shuffled and exiled from)', () => {
    const s = afterActivation('Test Biggie');
    expect(s.zones.library.p2).toHaveLength(1);
  });
});

describe('"mana value X or less, where X is 2 plus the sacrificed creature\'s mana value" (CR 701.23a, 107.3, 608.2h, 400.7; Eldritch Evolution)', () => {
  function afterCast(sacrifice: string): { s: GameState; options: string[] } {
    let s = scenario(['Forest'], { defs: DEFS, p1: { hand: ['Test Evolution'], battlefield: ['Test Cub', 'Test Bear Three', 'Forest', 'Forest', 'Forest'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Gem', 'Test Three', 'Test Four', 'Test Five']);
    setLibrary(s, 'p2', ['Test Card A']);
    s = cast(s, 'Test Evolution', { objects: [[find(s, sacrifice, 'battlefield')]] });
    s = passBoth(s);
    expect(s.pending?.kind).toBe('chooseObjects');
    return { s, options: (s.pending as unknown as { options: string[] }).options };
  }
  it('sacrificing a mana value 1 creature: creature cards with mana value 3 or less are offered (Test Three), not 4 or 5, not the artifact', () => {
    const { s, options } = afterCast('Test Cub');
    expect(names(s, options)).toEqual(['Test Three']);
  });
  it('sacrificing a mana value 3 creature (the negative case for the first): mana value 5 or less, so Three, Four and Five are all offered', () => {
    const { s, options } = afterCast('Test Bear Three');
    expect(names(s, options).sort()).toEqual(['Test Five', 'Test Four', 'Test Three']);
  });
  it('the chosen card enters under your control, the library is shuffled, and the spell is exiled (not put into the graveyard)', () => {
    const { s: s0, options } = afterCast('Test Cub');
    let s = answer(s0, { kind: 'chooseObjects', ids: [options[0]!] });
    s = drive(s);
    s = resolveAll(s);
    expect(findAll(s, 'Test Three', 'battlefield', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Test Cub', 'battlefield')).toHaveLength(0); // sacrificed
    expect(names(s, s.zones.exile)).toEqual(['Test Evolution']);
    expect(findAll(s, 'Test Evolution', 'graveyard')).toHaveLength(0);
    expect(s.zones.library.p1).toHaveLength(3);
  });
});

describe('"Mill three cards. Then you may pay {1} and 3 life. If you do, put a card from among those cards into your hand." (CR 701.17a, 608.2c, 118.1; Ripples of Undeath)', () => {
  const setup = () => {
    const s = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Ripple'], battlefield: ['Island'], graveyard: ['Test Gem'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Card A', 'Test Card B', 'Test Card C', 'Test Card D']);
    setLibrary(s, 'p2', ['Test Card A']);
    return s;
  };
  it('paying: only the three milled cards are offered (not the Gem already in the graveyard, not the fourth card), the chosen one goes to hand, 3 life and {1} are paid', () => {
    let s = setup();
    s = cast(s, 'Test Ripple');
    s = passBoth(s);
    // the may-pay question, then the choice among the milled cards
    expect(s.pending?.kind).toBe('yesNo');
    s = answer(s, { kind: 'yesNo', yes: true });
    while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true }); // payment of {1}, automatic
    expect(s.pending?.kind).toBe('chooseObjects');
    const p = s.pending as unknown as { options: string[]; min: number; max: number };
    expect(names(s, p.options).sort()).toEqual(['Test Card A', 'Test Card B', 'Test Card C']);
    expect(p.min).toBe(1);
    expect(p.max).toBe(1);
    s = answer(s, { kind: 'chooseObjects', ids: [p.options.find((id) => nameOf(s, id) === 'Test Card B')!] });
    s = drive(s);
    expect(names(s, s.zones.hand.p1!)).toEqual(['Test Card B']);
    expect(names(s, s.zones.graveyard.p1!).sort()).toEqual(['Test Card A', 'Test Card C', 'Test Gem', 'Test Ripple']);
    expect(s.players.find((x) => x.id === 'p1')!.life).toBe(17);
  });
  it('declining: the cards stay milled, nothing is paid, nothing goes to hand (the negative case)', () => {
    let s = setup();
    s = cast(s, 'Test Ripple');
    s = passBoth(s);
    s = answer(s, { kind: 'yesNo', yes: false });
    s = drive(s);
    expect(s.zones.hand.p1).toHaveLength(0);
    expect(s.players.find((x) => x.id === 'p1')!.life).toBe(20);
    expect(s.zones.library.p1).toHaveLength(1);
  });
});

describe('"Put one of them into your hand, put one of them on the bottom of your library, and exile one of them. You may play the exiled card this turn." (CR 701.20e, 401.4, 406.1, 608.2c-d; Expressive Iteration)', () => {
  function afterLook(): GameState {
    let s = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Iterate'], battlefield: [] }, p2: {} });
    setLibrary(s, 'p1', ['Test Card A', 'Test Biggie', 'Test Card C', 'Test Card D']);
    setLibrary(s, 'p2', ['Test Card A']);
    s = cast(s, 'Test Iterate');
    s = passBoth(s);
    return s;
  }
  it('you choose the card for hand, then the card for the bottom, and the last one is exiled; the fourth card is never touched', () => {
    let s = afterLook();
    expect(s.pending?.kind).toBe('chooseObjects');
    const a = s.pending as unknown as { options: string[] };
    expect(names(s, a.options).sort()).toEqual(['Test Biggie', 'Test Card A', 'Test Card C']);
    s = answer(s, { kind: 'chooseObjects', ids: [a.options.find((id) => nameOf(s, id) === 'Test Card A')!] });
    const b = s.pending as unknown as { options: string[] };
    expect(names(s, b.options).sort()).toEqual(['Test Biggie', 'Test Card C']); // the card put into hand is not offered again
    s = answer(s, { kind: 'chooseObjects', ids: [b.options.find((id) => nameOf(s, id) === 'Test Card C')!] });
    s = drive(s);
    expect(names(s, s.zones.hand.p1!)).toEqual(['Test Card A']);
    expect(names(s, s.zones.library.p1!)).toEqual(['Test Card D', 'Test Card C']); // the untouched fourth card, then the one put on the bottom
    expect(names(s, s.zones.exile)).toEqual(['Test Biggie']);
  });
  it('you may play the exiled card this turn (for its cost: {4} with no lands is not castable, the negative case), a card put into hand or on the bottom is not playable from there as exile', () => {
    let s = afterLook();
    const a = s.pending as unknown as { options: string[] };
    s = answer(s, { kind: 'chooseObjects', ids: [a.options.find((id) => nameOf(s, id) === 'Test Card A')!] });
    const b = s.pending as unknown as { options: string[] };
    s = answer(s, { kind: 'chooseObjects', ids: [b.options.find((id) => nameOf(s, id) === 'Test Card C')!] });
    s = drive(s);
    const big = find(s, 'Test Biggie', 'exile');
    // the permission is there (a cast is a legal action only with the mana; with no lands none is offered), so give mana and check it is castable
    expect(playOptions(s, big)).toHaveLength(0);
    for (let i = 0; i < 4; i++) put(s, 'p1', 'battlefield', 'Island');
    expect(playOptions(s, big)).toHaveLength(1);
  });
  it('a library of only two cards (CR 701.20e, 401.4): one card to hand, the other to the bottom, nothing to exile, and the game goes on', () => {
    let s = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Iterate'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Card A', 'Test Card B']);
    setLibrary(s, 'p2', ['Test Card A']);
    s = cast(s, 'Test Iterate');
    s = passBoth(s);
    s = drive(s);
    expect(s.pending?.kind).toBe('priority');
    expect(s.zones.hand.p1).toHaveLength(1);
    expect(s.zones.library.p1).toHaveLength(1);
    expect(s.zones.exile).toHaveLength(0);
  });
});
