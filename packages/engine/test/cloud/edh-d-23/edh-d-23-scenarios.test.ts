/**
 * Commander coordinator D, round edh-d-23 (lane dig): the round's digs played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's
 * default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites from the Comprehensive Rules of 2026-09-25.
 *
 *   CR 701.20e, 608.2c-d, 401.4      "Put one of those cards into your hand, one on top of your library, and one on the bottom of your library." (Telling Time)
 *   CR 701.20e, 406.1, 401.4         "Exile any number of those cards, then put the rest back in any order." / "look at the top N cards, then exile any number of them and put the rest back on top ..." (Dimir Machinations, Ancestral Knowledge)
 *   CR 701.20a, 701.24a, 110.2a      "That player puts that card onto the battlefield, then shuffles the rest into their library." (Polymorph, Transmogrify)
 *   CR 701.20e, 202.3, 406.1         "You may exile an instant or sorcery card with mana value X or less from among them." (Keldon Flamesage)
 *   CR 701.20a, 701.20e, 401.4       "Reveal up to one land card from among them, then put that card on top of your library and the rest on the bottom in a random order." (Planar Atlas, Fertile Thicket)
 *   CR 107.3, 608.2h, 701.20e        "Look at the top X cards of your library, where X is ... You may put a permanent card with mana value X or less from among them onto the battlefield." (Emergent Woodwurm)
 */
import { describe, expect, it } from 'vitest';
import { getChars, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { answer, card, cast, drive, full, passBoth, resolveAll, scenario, obj } from '../r3-cost/support';

const nameOf = (s: GameState, id: string): string => getChars(s, id).name;
const names = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p: PlayerId): string[] => s.zones[zone][p]!.map((id) => nameOf(s, id));
/** The library's own test cards in order (the scenario fills the rest of each library with basic lands). */
const lib = (s: GameState, p: PlayerId): string[] => names(s, 'library', p).filter((n) => n.startsWith('Test '));
const exiled = (s: GameState): string[] => s.zones.exile.map((id) => nameOf(s, id));
const bf = (s: GameState, p: PlayerId): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => nameOf(s, id));
const idIn = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p: PlayerId, name: string): ObjectId => s.zones[zone][p]!.find((id) => nameOf(s, id) === name)!;
/** The options of the pending choice of objects, by name (the decision must be a choice of objects). */
const offered = (s: GameState): string[] => {
  const p = s.pending as unknown as { kind: string; options: ObjectId[] };
  expect(p.kind).toBe('chooseObjects');
  return p.options.map((id) => nameOf(s, id)).sort();
};
/** The pending choice of objects is answered with these cards of p1's library. */
const pick = (s: GameState, ...cards: string[]): GameState => answer(s, { kind: 'chooseObjects', ids: cards.map((n) => idIn(s, 'library', 'p1', n)) });

const FOREST = card('Test Forest', 'Land', '');
const MOUNTAIN = card('Test Mountain', 'Land', '');
const SWAMP = card('Test Swamp', 'Land', '');
const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
const BIGBEAR = card('Test Big Bear', 'Creature — Bear', '', '{5}', ['5', '5']);
const RELIC = card('Test Relic', 'Artifact', '');
const BOLT = card('Test Bolt', 'Instant', '', '{1}');
const BIGSPELL = card('Test Big Spell', 'Sorcery', '', '{4}');

describe('"Put one of those cards into your hand, one on top of your library, and one on the bottom of your library." (CR 701.20e, 608.2c-d, 401.4; Telling Time)', () => {
  const SPELL = card('Test Foresight', 'Instant', 'Look at the top three cards of your library. Put one of those cards into your hand, one on top of your library, and one on the bottom of your library.');
  const defs = [SPELL, FOREST, MOUNTAIN, SWAMP, BEAR, RELIC];
  const start = () => scenario([], { p1: { hand: ['Test Foresight'], library: ['Test Forest', 'Test Mountain', 'Test Swamp', 'Test Bear', 'Test Relic'] }, p2: {}, defs });
  it('has no manual part', () => expect(full(SPELL)).toBe(true));
  it('you pick the card for your hand, then the card for the top among the other two; the last one goes to the bottom; the fourth and fifth cards are never touched', () => {
    let s = cast(start(), 'Test Foresight');
    s = passBoth(s);
    expect(offered(s)).toEqual(['Test Forest', 'Test Mountain', 'Test Swamp']);
    s = pick(s, 'Test Mountain');
    expect(offered(s)).toEqual(['Test Forest', 'Test Swamp']); // the card put into the hand is not offered again
    s = pick(s, 'Test Swamp');
    expect(names(s, 'hand', 'p1')).toEqual(['Test Mountain']);
    expect(lib(s, 'p1')).toEqual(['Test Swamp', 'Test Bear', 'Test Relic', 'Test Forest']);
  });
  it('the negative case: a library of only two cards still lets the first two choices through without a third move', () => {
    const s0 = scenario([], { p1: { hand: ['Test Foresight'], library: ['Test Forest', 'Test Mountain'] }, p2: {}, defs });
    let s = passBoth(cast(s0, 'Test Foresight'));
    s = pick(s, 'Test Forest');
    s = drive(s, { objects: [[idIn(s, 'library', 'p1', 'Test Mountain')]] });
    expect(names(s, 'hand', 'p1')).toEqual(['Test Forest']);
    expect(lib(s, 'p1')).toEqual(['Test Mountain']);
  });
});

describe('"Look at the top N cards of your library, then exile any number of them and put the rest back on top of your library in any order." (CR 701.20e, 406.1, 401.4; Ancestral Knowledge)', () => {
  const SPELL = card('Test Sifting', 'Sorcery', 'Look at the top four cards of your library, then exile any number of them and put the rest back on top of your library in any order.');
  const defs = [SPELL, FOREST, MOUNTAIN, SWAMP, BEAR, RELIC];
  const start = () => scenario([], { p1: { hand: ['Test Sifting'], library: ['Test Forest', 'Test Mountain', 'Test Swamp', 'Test Bear', 'Test Relic'] }, p2: {}, defs });
  it('has no manual part', () => expect(full(SPELL)).toBe(true));
  it('the chosen cards are exiled, the others stay on top of the library, the fifth card is never touched', () => {
    let s = passBoth(cast(start(), 'Test Sifting'));
    expect(offered(s)).toEqual(['Test Bear', 'Test Forest', 'Test Mountain', 'Test Swamp']);
    s = drive(pick(s, 'Test Forest', 'Test Bear'));
    expect(exiled(s).sort()).toEqual(['Test Bear', 'Test Forest']);
    expect(lib(s, 'p1').slice(0, 2).sort()).toEqual(['Test Mountain', 'Test Swamp']);
    expect(lib(s, 'p1')[2]).toBe('Test Relic');
    expect(names(s, 'hand', 'p1')).toEqual([]);
  });
  it('the negative case: "any number" includes none (nothing is exiled and all four cards stay on top)', () => {
    let s = passBoth(cast(start(), 'Test Sifting'));
    s = drive(pick(s));
    expect(exiled(s)).toEqual([]);
    expect(lib(s, 'p1').slice(0, 4).sort()).toEqual(['Test Bear', 'Test Forest', 'Test Mountain', 'Test Swamp']);
    expect(lib(s, 'p1')[4]).toBe('Test Relic');
  });
});

describe('"Look at the top three cards of target player\'s library. Exile any number of those cards, then put the rest back in any order." (CR 701.20e, 406.1, 401.4; Dimir Machinations)', () => {
  const SPELL = card('Test Peeking', 'Sorcery', "Look at the top three cards of target player's library. Exile any number of those cards, then put the rest back in any order.");
  const defs = [SPELL, FOREST, MOUNTAIN, SWAMP, BEAR, RELIC];
  const start = () => scenario([], { p1: { hand: ['Test Peeking'], library: ['Test Relic'] }, p2: { library: ['Test Forest', 'Test Mountain', 'Test Swamp', 'Test Bear'] }, defs });
  it('has no manual part', () => expect(full(SPELL)).toBe(true));
  it("the cards are the target player's: the ones you choose are exiled, the rest go back on top of THEIR library, and your own library is untouched", () => {
    let s = cast(start(), 'Test Peeking', { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = passBoth(s);
    expect(offered(s)).toEqual(['Test Forest', 'Test Mountain', 'Test Swamp']);
    s = drive(answer(s, { kind: 'chooseObjects', ids: [s.zones.library['p2']!.find((id) => nameOf(s, id) === 'Test Swamp')!] }));
    expect(exiled(s)).toEqual(['Test Swamp']);
    expect(lib(s, 'p2').slice(0, 2).sort()).toEqual(['Test Forest', 'Test Mountain']);
    expect(lib(s, 'p2')[2]).toBe('Test Bear');
    expect(lib(s, 'p1')).toEqual(['Test Relic']);
  });
});

describe('"Exile target creature. That creature\'s controller reveals cards from the top of their library until they reveal a creature card. That player puts that card onto the battlefield, then shuffles the rest into their library." (CR 701.20a, 701.24a, 110.2a; Transmogrify)', () => {
  const SPELL = card('Test Metamorphosis', 'Sorcery', "Exile target creature. That creature's controller reveals cards from the top of their library until they reveal a creature card. That player puts that card onto the battlefield, then shuffles the rest into their library.");
  const defs = [SPELL, BEAR, BIGBEAR, RELIC, FOREST];
  const start = (lib: string[]) => scenario([], { p1: { hand: ['Test Metamorphosis'] }, p2: { battlefield: ['Test Bear'], library: lib }, defs });
  it('has no manual part', () => expect(full(SPELL)).toBe(true));
  it("the creature's controller (not the caster) gets the first creature card of their library on the battlefield under their control; the cards revealed before it stay in their library", () => {
    const s0 = start(['Test Relic', 'Test Forest', 'Test Big Bear', 'Test Relic']);
    let s = cast(s0, 'Test Metamorphosis', { targets: [[obj(s0.zones.battlefield.find((id) => nameOf(s0, id) === 'Test Bear')!)]] });
    s = resolveAll(s);
    expect(exiled(s)).toEqual(['Test Bear']);
    expect(bf(s, 'p2')).toEqual(['Test Big Bear']);
    expect(bf(s, 'p1')).toEqual([]);
    expect(lib(s, 'p2').sort()).toEqual(['Test Forest', 'Test Relic', 'Test Relic']);
  });
  it('the negative case: a library without a creature card puts nothing onto the battlefield and loses no card', () => {
    const s0 = start(['Test Relic', 'Test Forest', 'Test Relic']);
    let s = cast(s0, 'Test Metamorphosis', { targets: [[obj(s0.zones.battlefield.find((id) => nameOf(s0, id) === 'Test Bear')!)]] });
    s = resolveAll(s);
    expect(bf(s, 'p2')).toEqual([]);
    expect(lib(s, 'p2').sort()).toEqual(['Test Forest', 'Test Relic', 'Test Relic']);
  });
});

describe('"You may exile an instant or sorcery card with mana value 2 or less from among them." (CR 701.20e, 202.3, 406.1; Keldon Flamesage)', () => {
  const SPELL = card('Test Scavenging', 'Sorcery', 'Look at the top four cards of your library. You may exile an instant or sorcery card with mana value 2 or less from among them. Put the rest on the bottom of your library in a random order.');
  const defs = [SPELL, BOLT, BIGSPELL, BEAR, RELIC];
  const start = () => scenario([], { p1: { hand: ['Test Scavenging'], library: ['Test Big Spell', 'Test Bolt', 'Test Bear', 'Test Relic', 'Test Bolt'] }, p2: {}, defs });
  it('has no manual part', () => expect(full(SPELL)).toBe(true));
  it('only the instant or sorcery card with mana value 2 or less is offered (not the 4-drop, not the creature); it is exiled and the rest go to the bottom', () => {
    let s = passBoth(cast(start(), 'Test Scavenging'));
    expect(offered(s)).toEqual(['Test Bolt']);
    s = drive(pick(s, 'Test Bolt'));
    expect(exiled(s)).toEqual(['Test Bolt']);
    const l = lib(s, 'p1');
    expect(l[0]).toBe('Test Bolt'); // the fifth card, never looked at, is on top now
    expect(l.slice(1).sort()).toEqual(['Test Bear', 'Test Big Spell', 'Test Relic']);
  });
  it('the negative case: it is optional ("you may"), choosing none exiles nothing', () => {
    let s = passBoth(cast(start(), 'Test Scavenging'));
    s = drive(pick(s));
    expect(exiled(s)).toEqual([]);
    expect(lib(s, 'p1')).toHaveLength(5);
  });
});

describe('"Reveal up to one land card from among them, then put that card on top of your library and the rest on the bottom in a random order." (CR 701.20a, 701.20e, 401.4; Planar Atlas)', () => {
  const SPELL = card('Test Surveying', 'Sorcery', 'Look at the top four cards of your library. Reveal up to one land card from among them, then put that card on top of your library and the rest on the bottom in a random order.');
  const defs = [SPELL, FOREST, MOUNTAIN, BEAR, RELIC];
  const start = () => scenario([], { p1: { hand: ['Test Surveying'], library: ['Test Bear', 'Test Forest', 'Test Relic', 'Test Mountain', 'Test Relic'] }, p2: {}, defs });
  it('has no manual part', () => expect(full(SPELL)).toBe(true));
  it('only land cards are offered; the chosen one is on top of the library, the other three looked at go to the bottom, the fifth card follows the chosen one', () => {
    let s = passBoth(cast(start(), 'Test Surveying'));
    expect(offered(s)).toEqual(['Test Forest', 'Test Mountain']);
    s = drive(pick(s, 'Test Mountain'));
    const l = lib(s, 'p1');
    expect(l.slice(0, 2)).toEqual(['Test Mountain', 'Test Relic']);
    expect(l.slice(2).sort()).toEqual(['Test Bear', 'Test Forest', 'Test Relic']);
  });
  it('the negative case: choosing no land puts every card looked at on the bottom (nothing goes on top)', () => {
    let s = passBoth(cast(start(), 'Test Surveying'));
    s = drive(pick(s));
    const l = lib(s, 'p1');
    expect(l[0]).toBe('Test Relic'); // the fifth card
    expect(l.slice(1).sort()).toEqual(['Test Bear', 'Test Forest', 'Test Mountain', 'Test Relic']);
  });
});

describe('"Look at the top X cards of your library, where X is the number of creatures you control. You may put a permanent card with mana value X or less from among them onto the battlefield." (CR 107.3, 608.2h, 701.20e; Emergent Woodwurm)', () => {
  const SPELL = card('Test Delving', 'Sorcery', 'Look at the top X cards of your library, where X is the number of creatures you control. You may put a permanent card with mana value X or less from among them onto the battlefield. Put the rest on the bottom of your library in a random order.');
  const defs = [SPELL, BEAR, BIGBEAR, RELIC, FOREST, BOLT];
  const start = () => scenario([], { p1: { hand: ['Test Delving'], battlefield: ['Test Bear', 'Test Bear'], library: ['Test Big Bear', 'Test Relic', 'Test Forest', 'Test Bear'] }, p2: {}, defs });
  it('has no manual part', () => expect(full(SPELL)).toBe(true));
  it('X is two creatures: only the top two cards are looked at, and the same X bounds the mana value (the 5-drop on top is not offered; the artifact is)', () => {
    let s = passBoth(cast(start(), 'Test Delving'));
    expect(offered(s)).toEqual(['Test Relic']);
    s = drive(pick(s, 'Test Relic'));
    expect(bf(s, 'p1').sort()).toEqual(['Test Bear', 'Test Bear', 'Test Relic']);
    const l = lib(s, 'p1');
    expect(l.slice(0, 2)).toEqual(['Test Forest', 'Test Bear']); // the third and fourth cards were not looked at
    expect(l.slice(2)).toEqual(['Test Big Bear']);
  });
});

describe('"Put one of those cards on top of your library and the rest on the bottom of your library in any order." (CR 701.20e, 608.2c-d, 401.4; Cream of the Crop)', () => {
  const SPELL = card('Test Reordering', 'Sorcery', 'Look at the top three cards of your library. Put one of them on top of your library and the rest on the bottom of your library in any order.');
  const defs = [SPELL, FOREST, MOUNTAIN, SWAMP, BEAR, RELIC];
  const start = () => scenario([], { p1: { hand: ['Test Reordering'], library: ['Test Forest', 'Test Mountain', 'Test Swamp', 'Test Bear', 'Test Relic'] }, p2: {}, defs });
  it('has no manual part', () => expect(full(SPELL)).toBe(true));
  it('you pick exactly one of the top three to stay on top; the other two go under the rest of the library; the fourth and fifth cards are untouched and come right after the chosen card', () => {
    let s = passBoth(cast(start(), 'Test Reordering'));
    expect(offered(s)).toEqual(['Test Forest', 'Test Mountain', 'Test Swamp']);
    s = drive(pick(s, 'Test Swamp'));
    const l = lib(s, 'p1');
    expect(l.slice(0, 3)).toEqual(['Test Swamp', 'Test Bear', 'Test Relic']);
    expect(l.slice(3).sort()).toEqual(['Test Forest', 'Test Mountain']);
  });
  it('the negative case: the choice is not optional (exactly one card must be chosen)', () => {
    const s = passBoth(cast(start(), 'Test Reordering'));
    const p = s.pending as unknown as { min: number; max: number };
    expect([p.min, p.max]).toEqual([1, 1]);
  });
});

describe('"Reveal any number of Ally cards from among them, then put those cards on top of your library in any order and the rest on the bottom in any order." (CR 701.20a, 701.20e, 401.4; Munda, Ambush Leader)', () => {
  const SPELL = card('Test Rallying', 'Sorcery', 'Look at the top four cards of your library. Reveal any number of Bear cards from among them, then put those cards on top of your library in any order and the rest on the bottom in any order.');
  const defs = [SPELL, FOREST, BEAR, BIGBEAR, RELIC];
  const start = () => scenario([], { p1: { hand: ['Test Rallying'], library: ['Test Forest', 'Test Bear', 'Test Relic', 'Test Big Bear', 'Test Forest'] }, p2: {}, defs });
  it('has no manual part', () => expect(full(SPELL)).toBe(true));
  it('only Bear cards are offered; the revealed ones stay on top, everything else looked at goes to the bottom, the fifth card is untouched', () => {
    let s = passBoth(cast(start(), 'Test Rallying'));
    expect(offered(s)).toEqual(['Test Bear', 'Test Big Bear']);
    s = drive(pick(s, 'Test Bear', 'Test Big Bear'));
    const l = lib(s, 'p1');
    expect(l.slice(0, 2).sort()).toEqual(['Test Bear', 'Test Big Bear']);
    expect(l[2]).toBe('Test Forest'); // the fifth card
    expect(l.slice(3).sort()).toEqual(['Test Forest', 'Test Relic']);
  });
  it('the negative case: "any number" includes none (every card looked at goes to the bottom)', () => {
    let s = passBoth(cast(start(), 'Test Rallying'));
    s = drive(pick(s));
    const l = lib(s, 'p1');
    expect(l[0]).toBe('Test Forest'); // the fifth card
    expect(l.slice(1)).toHaveLength(4);
  });
});
