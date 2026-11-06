/**
 * edh-zones-26 (Commander lane edh-zones): the round's readings played through the engine with synthetic cards (invented names, design 6.10). CR cites checked against the
 * 2026-09-25 text (https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt).
 *
 *   CR 701.21a, 115.1, 601.2c, 608.2b, 400.7, 110.2a, 108.3  "{T}: Choose target creature a player controls and target creature card in that player's graveyard. If both targets are still legal
 *                             as this ability resolves, that player simultaneously sacrifices the creature and returns the creature card to the battlefield." (Goblin Welder, with creatures)
 *   CR 107.4h, 601.2h, 701.23a   "Search your library for a Cave card, a legendary card, or a Dragon card, reveal it, put it into your hand, then shuffle. You gain 1 life for each {S} spent to cast this spell."
 *                             (Search for Glory): one card of any of three descriptions; the life is the snow mana spent
 *   CR 401.4, 406.3, 701.20e     "Look at the top two cards of target opponent's library. Exile one of them face down and put the other on the bottom of that library." (Siphon Insight)
 *   CR 404.1, 110.2a, 614.1a     "Target opponent mills three cards. Put a land card from their graveyard onto the battlefield tapped under your control. It gains "If ~ would leave the battlefield, exile it
 *                             instead of putting it anywhere else."" (Realmbreaker, the Invasion Tree)
 *   CR 608.2d, 701.17a, 406.1, 601.2a, 201.2   "Counter target spell. Choose 1, 2, or 3 at random. Its controller mills that many cards, then exiles cards from the top of their library until they exile a nonland
 *                             card with a different name than that spell. They may cast that card without paying its mana cost. Then they put the exiled cards on the bottom of their library in a random order." (Tibalt's Trickery)
 *   CR 701.40a, 701.40e, 110.2   "Whenever one or more creatures you control deal combat damage to a player, create a Treasure token and manifest the top card of that player's library." (Orochi Soul-Reaver)
 */
import { describe, expect, it } from 'vitest';
import { type GameState, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, activations, answer, card, cast, drive, find, full, lifeOf, obj, passBoth, resolveAll, scenario } from '../r3-cost/support';
import { toDeclareAttackers } from '../../m4/helpers';

const nameOf = (s: GameState, id: string): string => getChars(s, id).name;
const bf = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => nameOf(s, id)).sort();
const gy = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.graveyard[p]!.map((id) => nameOf(s, id)).sort();

describe('"{T}: Choose target creature a player controls and target creature card in that player\'s graveyard. If both targets are still legal as this ability resolves, that player simultaneously sacrifices the creature and returns the creature card to the battlefield."', () => {
  const MENDER = card('Test Mender', 'Creature — Goblin', '{T}: Choose target creature a player controls and target creature card in that player\'s graveyard. If both targets are still legal as this ability resolves, that player simultaneously sacrifices the creature and returns the creature card to the battlefield.', '{0}', ['1', '1']);
  const BRUTE = card('Test Brute', 'Creature — Ogre', '', '{0}', ['3', '3']);
  const IMP = card('Test Imp', 'Creature — Imp', '', '{0}', ['1', '1']);
  const GHOUL = card('Test Ghoul', 'Creature — Zombie', '', '{0}', ['2', '2']);
  const WRAITH = card('Test Wraith', 'Creature — Spirit', '', '{0}', ['2', '2']);
  const SNIPE = card('Test Snipe', 'Instant', 'Exile target card from a graveyard.');
  const defs = [MENDER, BRUTE, IMP, GHOUL, WRAITH, SNIPE];
  const setup = (): GameState => scenario([], { defs, p1: { battlefield: ['Test Mender', 'Test Brute'], graveyard: ['Test Ghoul'] }, p2: { battlefield: ['Test Imp'], graveyard: ['Test Wraith'], hand: ['Test Snipe'] } });
  const activate = (s: GameState, targets: TargetChoice[][]): GameState => drive(act(s, activations(s, 'Test Mender')[0]!.action), { targets });
  const resolve = (s: GameState): GameState => {
    let r = s;
    for (let i = 0; i < 8 && r.zones.stack.length > 0; i++) r = drive(passBoth(r));
    return r;
  };
  it('is fully automated', () => expect(full(MENDER)).toBe(true));
  it('your creature is sacrificed and a creature card from your graveyard returns under your control (CR 701.21a, 110.2a)', () => {
    const s0 = setup();
    const s = resolve(activate(s0, [[obj(find(s0, 'Test Brute', 'battlefield', 'p1'))], [obj(find(s0, 'Test Ghoul', 'graveyard', 'p1'))]]));
    expect(bf(s, 'p1')).toEqual(['Test Ghoul', 'Test Mender']);
    expect(gy(s, 'p1')).toEqual(['Test Brute']);
    expect(bf(s, 'p2')).toEqual(['Test Imp']);
  });
  it('an opponent\'s creature: THAT player sacrifices it and the card from THEIR graveyard returns under THEIR control, not yours (CR 701.21a, 108.3)', () => {
    const s0 = setup();
    const s = resolve(activate(s0, [[obj(find(s0, 'Test Imp', 'battlefield', 'p2'))], [obj(find(s0, 'Test Wraith', 'graveyard', 'p2'))]]));
    expect(bf(s, 'p2')).toEqual(['Test Wraith']);
    expect(gy(s, 'p2')).toEqual(['Test Imp']);
    expect(bf(s, 'p1')).toEqual(['Test Brute', 'Test Mender']);
    expect(gy(s, 'p1')).toEqual(['Test Ghoul']);
  });
  it('the card must be in the graveyard of the controller of the first target: after an opponent\'s creature only THEIR graveyard cards are offered, never yours (CR 115.1, 601.2c)', () => {
    const s0 = setup();
    const imp = find(s0, 'Test Imp', 'battlefield', 'p2');
    let s = act(s0, activations(s0, 'Test Mender')[0]!.action);
    expect(s.pending?.kind).toBe('chooseTargets');
    s = act(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'chooseTargets', targets: [obj(imp)] } });
    expect(s.pending?.kind).toBe('chooseTargets');
    const offered = (s.pending as unknown as { objects: string[] }).objects.map((id) => nameOf(s, id));
    expect(offered).toEqual(['Test Wraith']);
    // and the other way: your creature offers only your own graveyard
    let t = act(s0, activations(s0, 'Test Mender')[0]!.action);
    t = act(t, { type: 'answer', player: 'p1', decisionId: t.pending!.id, answer: { kind: 'chooseTargets', targets: [obj(find(s0, 'Test Brute', 'battlefield', 'p1'))] } });
    expect((t.pending as unknown as { objects: string[] }).objects.map((id) => nameOf(t, id))).toEqual(['Test Ghoul']);
  });
  it('if the card is exiled in response, the second target is illegal: nothing is sacrificed and nothing returns (ruling 2008-08-01, CR 608.2b)', () => {
    const s0 = setup();
    let s = activate(s0, [[obj(find(s0, 'Test Brute', 'battlefield', 'p1'))], [obj(find(s0, 'Test Ghoul', 'graveyard', 'p1'))]]);
    s = act(s, { type: 'pass', player: 'p1' });
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Snipe', 'hand', 'p2') }), { targets: [[obj(find(s, 'Test Ghoul', 'graveyard', 'p1'))]] });
    s = resolve(s);
    expect(bf(s, 'p1')).toEqual(['Test Brute', 'Test Mender']);
    expect(gy(s, 'p1')).toEqual([]);
  });
});

describe('"Search ... a Cave card, a legendary card, or a Dragon card ... You gain 1 life for each {S} spent to cast this spell." (CR 107.4h, 701.23a)', () => {
  const FROST = card('Test Frostquest', 'Snow Sorcery', 'Search your library for a Cave card, a legendary card, or a Dragon card, reveal it, put it into your hand, then shuffle. You gain 1 life for each {S} spent to cast this spell.', '{1}{G}', undefined, ['G']);
  const SNOWLAND = card('Test Snowmeadow', 'Basic Snow Land — Forest', '');
  const PLAINLAND = card('Test Meadow', 'Basic Land — Forest', '');
  const CAVE = card('Test Hollow', 'Land — Cave', '');
  const KING = card('Test Monarch', 'Legendary Creature — Human', '', '{0}', ['1', '1']);
  const WYRM = card('Test Wyrmling', 'Creature — Dragon', '', '{0}', ['1', '1']);
  const DULL = card('Test Dullard', 'Creature — Ogre', '', '{0}', ['1', '1']);
  const defs = [FROST, SNOWLAND, PLAINLAND, CAVE, KING, WYRM, DULL];
  const setup = (lands: string): GameState => scenario([], { defs, p1: { hand: ['Test Frostquest'], battlefield: [lands, lands], library: ['Test Dullard', 'Test Hollow', 'Test Monarch', 'Test Wyrmling', 'Test Dullard'] } });
  const run = (s0: GameState, pick: string): GameState => {
    let s = cast(s0, 'Test Frostquest');
    s = drive(passBoth(s), { objects: [[find(s, pick, 'library', 'p1')]] });
    return resolve2(s);
  };
  const resolve2 = (s: GameState): GameState => {
    let r = s;
    for (let i = 0; i < 6 && r.zones.stack.length > 0; i++) r = drive(passBoth(r));
    return r;
  };
  const hand = (s: GameState): string[] => s.zones.hand.p1!.map((id) => nameOf(s, id)).sort();
  it('is fully automated', () => expect(full(FROST)).toBe(true));
  it('every one of the three descriptions can be found: the Cave, the legendary card, the Dragon (CR 701.23a)', () => {
    for (const pick of ['Test Hollow', 'Test Monarch', 'Test Wyrmling']) {
      const s = run(setup('Test Snowmeadow'), pick);
      expect(hand(s), pick).toEqual([pick]);
    }
  });
  it('a card that is none of the three descriptions is not offered (negative)', () => {
    const s0 = setup('Test Snowmeadow');
    let s = cast(s0, 'Test Frostquest');
    s = passBoth(s);
    const offered = (s.pending as unknown as { options: string[] }).options.map((id) => nameOf(s, id)).sort();
    expect(offered).toEqual(['Test Hollow', 'Test Monarch', 'Test Wyrmling']);
  });
  it('one life for each snow mana spent: two snow lands pay {1}{G}, so 2 life (CR 107.4h, 601.2h)', () => {
    const s0 = setup('Test Snowmeadow');
    const l0 = lifeOf(s0, 'p1');
    expect(lifeOf(run(s0, 'Test Hollow'), 'p1') - l0).toBe(2);
  });
  it('mana from lands that are not snow sources is not {S}: no life (negative)', () => {
    const s0 = setup('Test Meadow');
    const l0 = lifeOf(s0, 'p1');
    expect(lifeOf(run(s0, 'Test Hollow'), 'p1') - l0).toBe(0);
  });
});

describe('"Look at the top two cards of target opponent\'s library. Exile one of them face down and put the other on the bottom of that library." (CR 401.4, 406.3)', () => {
  const PEEK = card('Test Peek', 'Instant', 'Look at the top two cards of target opponent\'s library. Exile one of them face down and put the other on the bottom of that library.', '{0}');
  const A = card('Test Alpha', 'Creature — Bear', '', '{0}', ['1', '1']);
  const B = card('Test Beta', 'Creature — Bear', '', '{0}', ['2', '2']);
  const C = card('Test Gamma', 'Creature — Bear', '', '{0}', ['3', '3']);
  const D = card('Test Delta', 'Creature — Bear', '', '{0}', ['4', '4']);
  const defs = [PEEK, A, B, C, D];
  const setup = (): GameState => scenario([], { defs, p1: { hand: ['Test Peek'], library: ['Test Delta'] }, p2: { library: ['Test Alpha', 'Test Beta', 'Test Gamma', 'Test Delta'] } });
  it('is fully automated', () => expect(full(PEEK)).toBe(true));
  it('the chosen card is exiled face down, the other goes to the bottom of THEIR library, the rest is untouched', () => {
    const s0 = setup();
    let s = cast(s0, 'Test Peek', { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = drive(passBoth(s), { objects: [[find(s0, 'Test Beta', 'library', 'p2')]] });
    s = drive(passBoth(s));
    const lib = s.zones.library.p2!.map((id) => nameOf(s, id));
    expect(lib.slice(0, 2)).toEqual(['Test Gamma', 'Test Delta']);
    expect(lib[lib.length - 1]).toBe('Test Alpha');
    expect(lib).not.toContain('Test Beta');
    const exiled = s.zones.exile.map((id) => s.objects[id]!).filter((o) => o.owner === 'p2');
    expect(exiled).toHaveLength(1);
    expect(exiled[0]!.faceDown).toBe(true);
    expect(s.zones.library.p1!.length).toBe(21); // your own library is untouched (one card plus the scenario's padding)
  });
});

describe('"Target opponent mills three cards. Put a land card from their graveyard onto the battlefield tapped under your control. It gains ..." (CR 404.1, 110.2a, 614.1a)', () => {
  const REALM = card('Test Realmstone', 'Artifact', '{T}: Target opponent mills three cards. Put a land card from their graveyard onto the battlefield tapped under your control. It gains "If this land would leave the battlefield, exile it instead of putting it anywhere else."', '{0}');
  const LANDA = card('Test Marsh', 'Basic Land — Swamp', '');
  const IMPA = card('Test Imp', 'Creature — Imp', '', '{0}', ['1', '1']);
  const SMITE = card('Test Smite', 'Instant', 'Destroy target land.', '{0}');
  const defs = [REALM, LANDA, IMPA, SMITE];
  const setup = (library: string[]): GameState => scenario([], { defs, p1: { hand: ['Test Smite'], battlefield: ['Test Realmstone'] }, p2: { library: [...library, 'Test Imp', 'Test Imp'] } });
  const resolve3 = (s: GameState, objects: string[][] = []): GameState => {
    let r = s;
    for (let i = 0; i < 8 && r.zones.stack.length > 0; i++) r = drive(passBoth(r), { objects });
    return r;
  };
  it('is fully automated', () => expect(full(REALM)).toBe(true));
  it('the land milled goes onto the battlefield tapped under YOUR control (not theirs); the rest of the milled cards stay in their graveyard', () => {
    const s0 = setup(['Test Imp', 'Test Marsh', 'Test Imp']);
    const s = resolve3(drive(act(s0, activations(s0, 'Test Realmstone')[0]!.action), { targets: [[{ kind: 'player', id: 'p2' }]] }));
    const land = s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Marsh')!;
    expect(land).toBeDefined();
    expect(s.objects[land]!.controller).toBe('p1');
    expect(s.objects[land]!.tapped).toBe(true);
    expect(s.zones.graveyard.p2!.map((id) => nameOf(s, id)).sort()).toEqual(['Test Imp', 'Test Imp']);
  });
  it('no land milled: nothing is put onto the battlefield (negative)', () => {
    const s0 = setup(['Test Imp', 'Test Imp', 'Test Imp']);
    const s = resolve3(drive(act(s0, activations(s0, 'Test Realmstone')[0]!.action), { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(s.zones.battlefield.map((id) => nameOf(s, id)).sort()).toEqual(['Test Realmstone']);
  });
  it('the land is exiled instead if it would leave the battlefield (it gained the replacement, CR 614.1a, 400.7)', () => {
    const s0 = setup(['Test Imp', 'Test Marsh', 'Test Imp']);
    let s = resolve3(drive(act(s0, activations(s0, 'Test Realmstone')[0]!.action), { targets: [[{ kind: 'player', id: 'p2' }]] }));
    const land = s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Marsh')!;
    s = cast(s, 'Test Smite', { targets: [[obj(land)]] });
    s = resolve3(s);
    expect(s.zones.exile.map((id) => nameOf(s, id))).toEqual(['Test Marsh']);
    expect(s.zones.graveyard.p2!.map((id) => nameOf(s, id)).sort()).toEqual(['Test Imp', 'Test Imp']);
  });
});

describe('"Counter target spell. Choose 1, 2, or 3 at random. Its controller mills that many cards, then exiles cards ... until they exile a nonland card with a different name than that spell. They may cast that card without paying its mana cost. Then they put the exiled cards on the bottom of their library in a random order." (CR 608.2d, 701.17a, 406.1, 601.2a, 201.2)', () => {
  const TRICK = card('Test Trickery', 'Instant', 'Counter target spell. Choose 1, 2, or 3 at random. Its controller mills that many cards, then exiles cards from the top of their library until they exile a nonland card with a different name than that spell. They may cast that card without paying its mana cost. Then they put the exiled cards on the bottom of their library in a random order.', '{0}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{0}', ['3', '3']);
  const LANDX = card('Test Marsh', 'Basic Land — Swamp', '');
  const defs = [TRICK, BEAR, OGRE, LANDX];
  // the top of p1's library: three lands (the mill takes 1 to 3 of them), then a card named like the countered spell, a land, and the card the exile stops at
  const setup = (seed = 'm3-scenario'): GameState => scenario([], { seed, defs, p1: { hand: ['Test Bear'], library: ['Test Marsh', 'Test Marsh', 'Test Marsh', 'Test Bear', 'Test Marsh', 'Test Ogre', 'Test Ogre'] }, p2: { hand: ['Test Trickery'] } });
  const countered = (s0: GameState, yes: boolean): GameState => {
    let s = cast(s0, 'Test Bear');
    s = act(s, { type: 'pass', player: 'p1' });
    s = cast(s, 'Test Trickery', { targets: [[obj(find(s, 'Test Bear', 'stack', 'p1'))]] }, 'p2');
    for (let i = 0; i < 8 && s.zones.stack.length > 0; i++) s = drive(passBoth(s), { yes: [yes] });
    return s;
  };
  const names = (s: GameState, ids: string[]): string[] => ids.map((id) => nameOf(s, id));
  it('is fully automated', () => expect(full(TRICK)).toBe(true));
  it('the milled lands (1 to 3) and the countered spell are in the graveyard; the card with a different name is cast free by the spell\'s controller; every other exiled card goes to the bottom of THAT library', () => {
    const s = countered(setup(), true);
    const gy = names(s, s.zones.graveyard.p1!);
    const milled = gy.filter((n) => n === 'Test Marsh').length;
    expect(milled).toBeGreaterThanOrEqual(1);
    expect(milled).toBeLessThanOrEqual(3);
    expect(gy.filter((n) => n === 'Test Bear')).toHaveLength(1); // the countered spell
    expect(names(s, s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1'))).toEqual(['Test Ogre']); // cast without paying: it resolved under p1
    expect(s.zones.exile).toEqual([]);
    const lib = names(s, s.zones.library.p1!);
    // the cards exiled before the Ogre (the lands the mill left, the card named like the spell, the land) are at the bottom; the other Ogre stays on top
    expect(lib[0]).toBe('Test Ogre');
    expect(lib).toContain('Test Bear'); // not skipped for good: exiled while looking for another name, then put on the bottom
    expect(lib.filter((n) => n === 'Test Bear')).toHaveLength(1);
    expect(lib.slice(-(7 - milled - 1 - 1)).sort()).toEqual(['Test Bear', ...Array(4 - milled).fill('Test Marsh')].sort());
  });
  it('declining to cast: the nonland card it stopped at goes to the bottom with the others (nothing stays in exile)', () => {
    const s = countered(setup(), false);
    expect(s.zones.exile).toEqual([]);
    expect(names(s, s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1'))).toEqual([]);
    const lib = names(s, s.zones.library.p1!);
    expect(lib.filter((n) => n === 'Test Ogre')).toHaveLength(2);
    expect(lib[0]).toBe('Test Ogre'); // the second Ogre was never reached
  });
  it('the count is random: over many games it takes 1, 2 and 3 cards, never another number (nobody chooses it)', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 12; i++) {
      const s = countered(setup(`seed-${i}`), true);
      seen.add(names(s, s.zones.graveyard.p1!).filter((n) => n === 'Test Marsh').length);
    }
    expect([...seen].every((n) => n >= 1 && n <= 3)).toBe(true);
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
  it('a spell that is not countered does nothing here: without Trickery nothing is milled (negative)', () => {
    const s = cast(setup(), 'Test Bear');
    expect(s.zones.graveyard.p1).toEqual([]);
    expect(s.zones.exile).toEqual([]);
  });
});

describe('"Whenever one or more creatures you control deal combat damage to a player, create a Treasure token and manifest the top card of that player\'s library." (CR 701.40a, 110.2)', () => {
  const REAPER = card('Test Reaver', 'Creature — Snake Ninja', 'Whenever one or more creatures you control deal combat damage to a player, create a Treasure token and manifest the top card of that player\'s library.', '{0}', ['2', '2']);
  const FILLER = card('Test Filler', 'Creature — Bear', '', '{0}', ['1', '1']);
  const defs = [REAPER, FILLER];
  const attackWith = (s0: GameState): GameState => {
    let s = answer(toDeclareAttackers(s0), { kind: 'declareAttackers', attacks: [{ attacker: find(s0, 'Test Reaver', 'battlefield', 'p1'), defender: 'p2' }] });
    for (let i = 0; i < 40 && !(s.turn.step === 'main2' && s.pending?.kind === 'priority'); i++) {
      if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player });
      else break;
    }
    return s;
  };
  it('is fully automated', () => expect(full(REAPER)).toBe(true));
  it('the top card of the DAMAGED player\'s library enters face down under YOUR control, and you get a Treasure', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Reaver'] }, p2: { library: ['Test Filler'] } });
    const top = s0.zones.library.p2![0]!;
    const s = attackWith(s0);
    const o = s.objects[top]!;
    expect(o).toBeUndefined(); // (a new object once it moved: CR 400.7)
    const mine = s.zones.battlefield.map((id) => s.objects[id]!).filter((x) => x.controller === 'p1');
    expect(mine.filter((x) => x.faceDown)).toHaveLength(1);
    expect(mine.some((x) => getChars(s, x.id).name === 'Treasure Token')).toBe(true);
    expect(s.zones.library.p2!.length).toBe(s0.zones.library.p2!.length - 1);
    expect(s.zones.library.p1!.length).toBe(s0.zones.library.p1!.length);
  });
});

describe('"As many times as you choose, you may exile the top card of your library. You gain life equal to the total mana value of the cards exiled this way." (CR 608.2c, 406.1, 202.3)', () => {
  const HOARD = card('Test Hoard', 'Sorcery', 'As many times as you choose, you may exile the top card of your library. You gain life equal to the total mana value of the cards exiled this way.');
  const TWO = card('Test Two', 'Creature — Bear', '', '{1}{G}', ['1', '1']);
  const THREE = card('Test Three', 'Creature — Ogre', '', '{2}{G}', ['3', '3']);
  const FIVE = card('Test Five', 'Creature — Wurm', '', '{4}{G}', ['5', '5']);
  const defs = [HOARD, TWO, THREE, FIVE];
  const setup = (): GameState => scenario([], { defs, p1: { hand: ['Test Hoard'], library: ['Test Two', 'Test Three', 'Test Five', 'Test Five'] } });
  const exiled = (s: GameState): string[] => s.zones.exile.map((id) => nameOf(s, id)).sort();
  it('is fully automated', () => expect(full(HOARD)).toBe(true));
  it('exiling twice gathers both cards: the life is their total mana value', () => {
    const s0 = setup();
    const s = resolveAll(cast(s0, 'Test Hoard'), { yes: [true, true, false] });
    expect(exiled(s)).toEqual(['Test Three', 'Test Two']);
    expect(lifeOf(s)).toBe(lifeOf(s0) + 5);
    expect(s.zones.library.p1!.length).toBe(s0.zones.library.p1!.length - 2);
  });
  it('declining at once exiles nothing and gains no life', () => {
    const s0 = setup();
    const s = resolveAll(cast(s0, 'Test Hoard'), { yes: [false] });
    expect(exiled(s)).toEqual([]);
    expect(lifeOf(s)).toBe(lifeOf(s0));
  });
  it('the player may go on for as many cards as they like', () => {
    const s0 = setup();
    const s = resolveAll(cast(s0, 'Test Hoard'), { yes: [true, true, true, true, false] });
    expect(exiled(s)).toEqual(['Test Five', 'Test Five', 'Test Three', 'Test Two']);
    expect(lifeOf(s)).toBe(lifeOf(s0) + 15);
  });
});

describe('Welder\'s sacrifice that can\'t happen: the card still returns (CR 609.3, 701.21a)', () => {
  const MENDER = card('Test Mender', 'Creature — Goblin', '{T}: Choose target creature a player controls and target creature card in that player\'s graveyard. If both targets are still legal as this ability resolves, that player simultaneously sacrifices the creature and returns the creature card to the battlefield.', '{0}', ['1', '1']);
  const BOUND = card('Test Bound', 'Creature — Golem', "~ can't be sacrificed.", '{0}', ['2', '2']);
  const GHOUL = card('Test Ghoul', 'Creature — Zombie', '', '{0}', ['2', '2']);
  const defs = [MENDER, BOUND, GHOUL];
  it('the permanent stays on the battlefield and the creature card returns', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Mender', 'Test Bound'], graveyard: ['Test Ghoul'] } });
    const s1 = drive(act(s0, activations(s0, 'Test Mender')[0]!.action), { targets: [[obj(find(s0, 'Test Bound', 'battlefield', 'p1'))], [obj(find(s0, 'Test Ghoul', 'graveyard', 'p1'))]] });
    let s = s1;
    for (let i = 0; i < 8 && s.zones.stack.length > 0; i++) s = drive(passBoth(s));
    expect(bf(s, 'p1')).toEqual(['Test Bound', 'Test Ghoul', 'Test Mender']);
    expect(gy(s, 'p1')).toEqual([]);
  });
});
