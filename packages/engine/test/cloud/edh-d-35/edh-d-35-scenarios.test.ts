/**
 * Commander coordinator D, round edh-d-35 (lane dig, second pass): the round's digs played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites from the Comprehensive Rules of
 * 2026-09-25 (cites not checked against the text are listed in the round's record).
 *
 *   CR 701.20a-b, 107.3, 608.2c      "Reveal cards from the top of your library until you reveal that many creature cards." (Mass Polymorph) / "a number of ... equal to the number of Zombies sacrificed this way" (Empty the Laboratory)
 *   CR 608.2c, 608.2f, 701.20a       "For each creature exiled this way, its controller reveals cards from the top of their library until they reveal a creature card, puts that card onto the battlefield, then ..." (Divergent Transformations, Chaos Mutation)
 *   CR 701.20e, 608.2c-d, 404.1      "You may put any number of them into your hand and the rest into your graveyard. You lose 3 life for each card you put into your hand this way." (Search for Blex)
 *   CR 701.20a, 601.2a, 608.2c       "Put all revealed cards not cast this way on the bottom of your library in a random order." (Treasure Keeper, Neera, Plargg)
 *   CR 701.26a, 608.2d               "Tap any number of creatures you control." (Augusta, Dean of Order)
 */
import { describe, expect, it } from 'vitest';
import { getChars, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { answer, card, cast, drive, full, passBoth, resolveAll, scenario, obj, lifeOf } from '../r3-cost/support';

const nameOf = (s: GameState, id: string): string => getChars(s, id).name;
const names = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p: PlayerId): string[] => s.zones[zone][p]!.map((id) => nameOf(s, id));
/** The library's own test cards in order (the scenario fills the rest of each library with Plains). */
const lib = (s: GameState, p: PlayerId): string[] => names(s, 'library', p).filter((n) => n.startsWith('Test '));
const exiled = (s: GameState): string[] => s.zones.exile.map((id) => nameOf(s, id));
const bf = (s: GameState, p: PlayerId): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => nameOf(s, id)).filter((n) => n.startsWith('Test '));
const onBf = (s: GameState, p: PlayerId, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && nameOf(s, id) === name);
const idIn = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p: PlayerId, name: string): ObjectId => s.zones[zone][p]!.find((id) => nameOf(s, id) === name)!;

const FOREST = card('Test Forest', 'Land', '');
const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
const BIGBEAR = card('Test Big Bear', 'Creature — Bear', '', '{5}', ['5', '5']);
const RELIC = card('Test Relic', 'Artifact', '');
const BOLT = card('Test Bolt', 'Instant', '', '{1}');
const BIGSPELL = card('Test Big Spell', 'Sorcery', '', '{4}');
const ZOMBIE = card('Test Zombie', 'Creature — Zombie', '', '{0}', ['1', '1']);

describe('"Reveal cards from the top of your library until you reveal that many creature cards." (CR 701.20a-b, 107.3, 608.2c; Mass Polymorph)', () => {
  const SPELL = card('Test Mass Change', 'Sorcery', 'Exile all creatures you control, then reveal cards from the top of your library until you reveal that many creature cards. Put all creature cards revealed this way onto the battlefield, then shuffle the rest of the revealed cards into your library.');
  const defs = [SPELL, BEAR, BIGBEAR, RELIC, FOREST];
  const start = (library: string[], battlefield: string[] = ['Test Bear', 'Test Bear']) => scenario([], { p1: { hand: ['Test Mass Change'], battlefield, library }, p2: { battlefield: ['Test Bear'] }, defs });
  it('has no manual part', () => expect(full(SPELL)).toBe(true));
  it('with two creatures exiled the reveal stops at the second creature card: both enter, the cards before them go back into the library, the cards after are never revealed', () => {
    let s = resolveAll(cast(start(['Test Relic', 'Test Big Bear', 'Test Forest', 'Test Bear', 'Test Relic']), 'Test Mass Change'));
    expect(exiled(s)).toEqual(['Test Bear', 'Test Bear']);
    expect(bf(s, 'p1').sort()).toEqual(['Test Bear', 'Test Big Bear']);
    expect(bf(s, 'p2')).toEqual(['Test Bear']); // an opponent's creature is neither exiled nor counted
    expect(lib(s, 'p1').sort()).toEqual(['Test Forest', 'Test Relic', 'Test Relic']);
  });
  it('the negative case: only one creature card in the library means only that card enters (the reveal ran out of library), and the rest is shuffled back', () => {
    const s = resolveAll(cast(start(['Test Relic', 'Test Big Bear', 'Test Forest']), 'Test Mass Change'));
    expect(bf(s, 'p1')).toEqual(['Test Big Bear']);
    expect(lib(s, 'p1').sort()).toEqual(['Test Forest', 'Test Relic']);
  });
  it('the negative case: with no creature of yours nothing is revealed and nothing enters', () => {
    const s = resolveAll(cast(start(['Test Relic', 'Test Big Bear'], []), 'Test Mass Change'));
    expect(bf(s, 'p1')).toEqual([]);
    expect(lib(s, 'p1').sort()).toEqual(['Test Big Bear', 'Test Relic']);
    expect(exiled(s)).toEqual([]);
  });
});

describe('"Reveal cards from the top of your library until you reveal a number of Zombie creature cards equal to the number of Zombies sacrificed this way." (CR 701.20a-b, 107.3, 608.2c; Empty the Laboratory)', () => {
  const SPELL = card('Test Rite of Raising', 'Sorcery', 'Sacrifice X Zombies, then reveal cards from the top of your library until you reveal a number of Zombie creature cards equal to the number of Zombies sacrificed this way. Put those cards onto the battlefield and the rest on the bottom of your library in a random order.', '{X}');
  const defs = [SPELL, ZOMBIE, BEAR, RELIC, FOREST];
  const start = () => scenario([], { p1: { hand: ['Test Rite of Raising'], battlefield: ['Plains', 'Plains', 'Test Zombie', 'Test Zombie', 'Test Bear'], library: ['Test Relic', 'Test Zombie', 'Test Forest', 'Test Zombie', 'Test Zombie', 'Test Relic'] }, p2: {}, defs });
  it('has no manual part', () => expect(full(SPELL)).toBe(true));
  it('sacrificing two Zombies reveals until two Zombie cards: both enter, the other revealed cards go to the bottom, the third Zombie card is never revealed', () => {
    const s0 = start();
    const zombies = onBf(s0, 'p1', 'Test Zombie');
    let s = cast(s0, 'Test Rite of Raising', { x: [2], objects: [zombies] });
    s = resolveAll(s, { objects: [zombies] });
    expect(bf(s, 'p1').filter((n) => n === 'Test Zombie').length).toBe(2); // two sacrificed, two raised
    expect(onBf(s, 'p1', 'Test Zombie').some((id) => zombies.includes(id))).toBe(false); // the new ones are other objects
    expect(names(s, 'graveyard', 'p1').filter((n) => n === 'Test Zombie').length).toBe(2);
    expect(lib(s, 'p1').slice(0, 2)).toEqual(['Test Zombie', 'Test Relic']); // never revealed: the third Zombie card, then the sixth card
    expect(names(s, 'library', 'p1').slice(-2).sort()).toEqual(['Test Forest', 'Test Relic']); // the revealed non-Zombie cards are now at the bottom
    expect(bf(s, 'p1')).toContain('Test Bear');
  });
  it('the negative case: X = 0 sacrifices nothing and reveals nothing', () => {
    const s = resolveAll(cast(start(), 'Test Rite of Raising', { x: [0] }));
    expect(bf(s, 'p1').filter((n) => n === 'Test Zombie').length).toBe(2);
    expect(lib(s, 'p1')).toEqual(['Test Relic', 'Test Zombie', 'Test Forest', 'Test Zombie', 'Test Zombie', 'Test Relic']);
  });
});

describe('"For each of those creatures, its controller reveals cards from the top of their library until they reveal a creature card, puts that card onto the battlefield, then shuffles the rest into their library." (CR 608.2c, 608.2f, 701.20a, 701.24a; Divergent Transformations)', () => {
  const SPELL = card('Test Twin Change', 'Sorcery', 'Exile two target creatures. For each of those creatures, its controller reveals cards from the top of their library until they reveal a creature card, puts that card onto the battlefield, then shuffles the rest into their library.');
  const defs = [SPELL, BEAR, BIGBEAR, RELIC, FOREST];
  const start = (lib1: string[], lib2: string[]) => scenario([], { p1: { hand: ['Test Twin Change'], battlefield: ['Test Bear'], library: lib1 }, p2: { battlefield: ['Test Bear'], library: lib2 }, defs });
  const targets = (s: GameState) => [s.zones.battlefield.map((id) => obj(id))];
  it('has no manual part', () => expect(full(SPELL)).toBe(true));
  it("each creature's controller reveals from their own library and gets the card on the battlefield under their own control", () => {
    const s0 = start(['Test Relic', 'Test Big Bear'], ['Test Forest', 'Test Bear', 'Test Big Bear']);
    const s = resolveAll(cast(s0, 'Test Twin Change', { targets: targets(s0) }));
    expect(exiled(s)).toEqual(['Test Bear', 'Test Bear']);
    expect(bf(s, 'p1')).toEqual(['Test Big Bear']);
    expect(bf(s, 'p2')).toEqual(['Test Bear']);
    expect(lib(s, 'p1')).toEqual(['Test Relic']);
    expect(lib(s, 'p2').sort()).toEqual(['Test Big Bear', 'Test Forest']);
  });
  it('the negative case: a controller without a creature card in their library gets nothing, the other one still does', () => {
    const s0 = start(['Test Relic', 'Test Forest'], ['Test Big Bear']);
    const s = resolveAll(cast(s0, 'Test Twin Change', { targets: targets(s0) }));
    expect(bf(s, 'p1')).toEqual([]);
    expect(bf(s, 'p2')).toEqual(['Test Big Bear']);
    expect(lib(s, 'p1').sort()).toEqual(['Test Forest', 'Test Relic']);
  });
});

describe('"..., then puts the rest on the bottom of their library in a random order." (CR 608.2c, 608.2f, 701.20a, 401.4; Chaos Mutation)', () => {
  const SPELL = card('Test Wild Change', 'Instant', 'Exile any number of target creatures controlled by different players. For each creature exiled this way, its controller reveals cards from the top of their library until they reveal a creature card, puts that card onto the battlefield, then puts the rest on the bottom of their library in a random order.');
  const defs = [SPELL, BEAR, BIGBEAR, RELIC, FOREST];
  const start = () => scenario([], { p1: { hand: ['Test Wild Change'], battlefield: ['Test Bear'], library: ['Test Relic', 'Test Big Bear', 'Test Forest'] }, p2: { battlefield: ['Test Big Bear'], library: ['Test Forest', 'Test Relic', 'Test Bear', 'Test Relic'] }, defs });
  it('has no manual part', () => expect(full(SPELL)).toBe(true));
  it('the cards revealed before the creature card go to the bottom of their own library; the cards after it stay where they were; a creature of each player', () => {
    const s0 = start();
    const t = [s0.zones.battlefield.find((id) => s0.objects[id]!.controller === 'p1')!, s0.zones.battlefield.find((id) => s0.objects[id]!.controller === 'p2')!];
    const s = resolveAll(cast(s0, 'Test Wild Change', { targets: [t.map((id) => obj(id))] }));
    expect(exiled(s).sort()).toEqual(['Test Bear', 'Test Big Bear']);
    expect(bf(s, 'p1')).toEqual(['Test Big Bear']);
    expect(bf(s, 'p2')).toEqual(['Test Bear']);
    expect(lib(s, 'p2')[0]).toBe('Test Relic'); // the fourth card, never revealed
    expect(names(s, 'library', 'p2').slice(-2).sort()).toEqual(['Test Forest', 'Test Relic']); // revealed: now at the bottom
    expect(lib(s, 'p1')).toEqual(['Test Forest', 'Test Relic']); // the card after the creature card was never revealed (still on top); the one revealed before it is last
    expect(names(s, 'library', 'p1').slice(-1)).toEqual(['Test Relic']);
  });
});

describe('"You may put any number of them into your hand and the rest into your graveyard. You lose 3 life for each card you put into your hand this way." (CR 701.20e, 608.2c-d, 404.1; Search for Blex)', () => {
  const SPELL = card('Test Culling', 'Sorcery', 'Look at the top four cards of your library. You may put any number of them into your hand and the rest into your graveyard. You lose 3 life for each card you put into your hand this way.');
  const defs = [SPELL, FOREST, BEAR, RELIC, BOLT];
  const start = () => scenario([], { p1: { hand: ['Test Culling'], library: ['Test Forest', 'Test Bear', 'Test Relic', 'Test Bolt', 'Test Relic'] }, p2: {}, defs });
  it('has no manual part', () => expect(full(SPELL)).toBe(true));
  it('the cards you choose go into your hand and cost 3 life each; the others go to the graveyard; the fifth card is never looked at', () => {
    let s = passBoth(cast(start(), 'Test Culling'));
    s = drive(s, { objects: [[idIn(s, 'library', 'p1', 'Test Bear'), idIn(s, 'library', 'p1', 'Test Bolt')]] });
    expect(names(s, 'hand', 'p1').sort()).toEqual(['Test Bear', 'Test Bolt']);
    expect(names(s, 'graveyard', 'p1').sort()).toEqual(['Test Forest', 'Test Relic', 'Test Culling'].sort());
    expect(lifeOf(s)).toBe(20 - 6);
    expect(lib(s, 'p1')).toEqual(['Test Relic']);
  });
  it('the negative case: choosing none is the only way to take nothing, and then the rest still goes: all four cards go into the graveyard, nothing to the library top, no life lost', () => {
    let s = passBoth(cast(start(), 'Test Culling'));
    s = drive(s, { objects: [[]] });
    expect(names(s, 'hand', 'p1')).toEqual([]);
    expect(names(s, 'graveyard', 'p1').length).toBe(4 + 1);
    expect(lib(s, 'p1')).toEqual(['Test Relic']);
    expect(lifeOf(s)).toBe(20);
  });
});

describe('"You may cast that card without paying its mana cost. Put all revealed cards not cast this way on the bottom of your library in a random order." (CR 701.20a, 601.2a, 608.2c; Treasure Keeper)', () => {
  const SPELL = card('Test Salvage', 'Sorcery', 'Reveal cards from the top of your library until you reveal a nonland card with mana value 3 or less. You may cast that card without paying its mana cost. Put all revealed cards not cast this way on the bottom of your library in a random order.');
  const defs = [SPELL, FOREST, BIGSPELL, BOLT, RELIC];
  const start = () => scenario([], { p1: { hand: ['Test Salvage'], library: ['Test Forest', 'Test Big Spell', 'Test Bolt', 'Test Relic'] }, p2: {}, defs });
  it('has no manual part', () => expect(full(SPELL)).toBe(true));
  it('the land and the too-expensive card are revealed, the cheap card is cast, and the two revealed cards that were not cast go to the bottom; the fourth card is never revealed', () => {
    const s = resolveAll(cast(start(), 'Test Salvage', { yes: [true] }), { yes: [true] });
    expect(names(s, 'graveyard', 'p1')).toContain('Test Bolt'); // cast and resolved
    expect(names(s, 'graveyard', 'p1')).not.toContain('Test Forest');
    expect(lib(s, 'p1')[0]).toBe('Test Relic');
    expect(names(s, 'library', 'p1').slice(-2).sort()).toEqual(['Test Big Spell', 'Test Forest']);
  });
  it('a card with {X} in its mana cost counts as mana value 0 in the library (Scryfall ruling 2020-08-07): it is the card the reveal stops at', () => {
    const VARIABLE = card('Test Variable', 'Sorcery', '', '{X}{2}');
    const s0 = scenario([], { p1: { hand: ['Test Salvage'], library: ['Test Forest', 'Test Variable', 'Test Bolt'] }, p2: {}, defs: [...defs, VARIABLE] });
    const s = resolveAll(cast(s0, 'Test Salvage', { yes: [false] }));
    expect(lib(s, 'p1')[0]).toBe('Test Bolt'); // never revealed: the reveal stopped at the {X}{2} card, whose mana value is 2
    expect(names(s, 'library', 'p1').slice(-2).sort()).toEqual(['Test Forest', 'Test Variable']);
  });
  it('the negative case: declining the cast puts the card it stopped at on the bottom with the rest', () => {
    const s = resolveAll(cast(start(), 'Test Salvage', { yes: [false] }));
    expect(names(s, 'graveyard', 'p1')).not.toContain('Test Bolt');
    expect(lib(s, 'p1')[0]).toBe('Test Relic');
    expect(names(s, 'library', 'p1').slice(-3).sort()).toEqual(['Test Big Spell', 'Test Bolt', 'Test Forest']);
  });
});

describe('"Tap any number of creatures you control." (CR 701.26a, 608.2d; Augusta, Dean of Order)', () => {
  const SPELL = card('Test Rally', 'Sorcery', 'Untap each creature you control, then tap any number of creatures you control.');
  const defs = [SPELL, BEAR, BIGBEAR];
  const start = () => scenario([], { p1: { hand: ['Test Rally'], battlefield: [{ name: 'Test Bear', tapped: true }, 'Test Bear', 'Test Big Bear'] }, p2: { battlefield: ['Test Bear'] }, defs });
  const tappedCount = (s: GameState, p: PlayerId): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.objects[id]!.tapped).length;
  it('has no manual part', () => expect(full(SPELL)).toBe(true));
  it('untaps all of your creatures, then taps exactly the ones you choose (and never an opponent\'s)', () => {
    const s0 = start();
    let s = passBoth(cast(s0, 'Test Rally'));
    expect(tappedCount(s, 'p1')).toBe(0);
    const mine = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1');
    s = answer(s, { kind: 'chooseObjects', ids: mine.slice(0, 2) });
    expect(tappedCount(s, 'p1')).toBe(2);
    expect(tappedCount(s, 'p2')).toBe(0);
  });
  it('the negative case: choosing none taps none', () => {
    let s = passBoth(cast(start(), 'Test Rally'));
    s = answer(s, { kind: 'chooseObjects', ids: [] });
    expect(tappedCount(s, 'p1')).toBe(0);
  });
});
