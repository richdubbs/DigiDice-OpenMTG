/**
 * edh-zones-11 (Commander effort, lane edh-zones): the round's readings played through the engine with synthetic cards (invented names, design 6.10). CR cites checked against the
 * Comprehensive Rules of 2026-09-25 where the notes below say so, else from memory (unverified).
 *
 *   CR 701.20e, 406.3, 400.3     "Look at the top three cards of target opponent's library, exile one of them face down, then put the rest into their graveyard. You may cast that card
 *                                for as long as it remains exiled, ..." (Thief of Sanity): the rest go to their OWNER's graveyard, the exiled card may be cast by the controller
 *   CR 701.20a, 608.2c-d         "You may reveal any number of Rat cards from among them and put the revealed cards into your hand." (Karumonix, the Rat King)
 *   CR 701.20e, 608.2c           "Look at the top X cards of your library, where X is the total amount of life your opponents lost this turn. Exile one of those cards and put the rest on
 *                                the bottom of your library in a random order. You may play the exiled card this turn." (Florian, Voldaren Scion)
 *   CR 601.3, 406.3a, 715.3      "Exile one face down and put the rest on the bottom of your library in any order. For as long as it remains exiled, you may cast it if it's a creature
 *                                spell." (Vivien, Champion of the Wilds): a creature card only, whatever it is face down; an Adventurer only as the creature
 *   CR 508.1a-b, 506.3, 603.2c   "Whenever two or more creatures you control attack a player, ..." (Horn of the Mark)
 *   CR 406.1, 110.2a             "Exile the top seven cards of that player's library, then put a creature card from among them onto the battlefield under your control." (Lord of the Void)
 *   CR 400.3, 603.6a             "Whenever this creature or another permanent enters from a graveyard, ..." (River Kelpie)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type GameState, type OracleCard } from '../../../src/index';
import { put } from '../../m3/scenario';
import { legalActions } from '../../../src/index';
import { mpScenario } from '../../m12/rules/helpers';
import { act, advanceTo, answer, drive, find, full, card, cast, obj, passBoth, scenario, lifeOf, attackWith } from '../r5-cost/support';

const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => nameOf(s, id));
/** Replace a player's whole library (the scenario's filler Plains included) with the named cards, top first. */
function setLibrary(s: GameState, p: 'p1' | 'p2', libNames: string[]): void {
  for (const id of s.zones.library[p]!) delete s.objects[id];
  s.zones.library[p] = [];
  for (const n of libNames) put(s, p, 'library', n);
}
const onBattlefield = (s: GameState, name: string, controller?: string): string[] => s.zones.battlefield.filter((id) => nameOf(s, id) === name && (controller === undefined || s.objects[id]!.controller === controller));
const inExile = (s: GameState): string[] => names(s, s.zones.exile).sort();
const pendingObjects = (s: GameState) => s.pending as { kind: 'chooseObjects'; player: string; options: string[]; min: number; max: number };
const handNames = (s: GameState, p: 'p1' | 'p2'): string[] => names(s, s.zones.hand[p]!).sort();
const gyNames = (s: GameState, p: 'p1' | 'p2'): string[] => names(s, s.zones.graveyard[p]!).sort();
const libNames = (s: GameState, p: 'p1' | 'p2'): string[] => names(s, s.zones.library[p]!);

const THIEF = card('Test Mind Thief', 'Sorcery', "Look at the top three cards of target opponent's library, exile one of them face down, then put the rest into their graveyard. You may cast that card for as long as it remains exiled, and mana of any type can be spent to cast that spell.", '{0}');
const RATS = card('Test Rat Chief', 'Creature — Rat', 'When this creature enters, look at the top five cards of your library. You may reveal any number of Rat cards from among them and put the revealed cards into your hand. Put the rest on the bottom of your library in a random order.', '{0}', ['1', '1']);
const FLORIAN = card('Test Bloody Seer', 'Creature — Vampire', 'At the beginning of each of your postcombat main phases, look at the top X cards of your library, where X is the total amount of life your opponents lost this turn. Exile one of those cards and put the rest on the bottom of your library in a random order. You may play the exiled card this turn.', '{0}', ['2', '2']);
const VIVIEN = card('Test Wild Walker', 'Sorcery', 'Look at the top three cards of your library. Exile one face down and put the rest on the bottom of your library in any order. For as long as it remains exiled, you may cast it if it\'s a creature spell.', '{0}');
const HORN = card('Test War Horn', 'Artifact', 'Whenever two or more creatures you control attack a player, you gain 3 life.', '{0}');
const VOID = card('Test Void Lord', 'Sorcery', "Exile the top four cards of target opponent's library, then put a creature card from among them onto the battlefield under your control.", '{0}');
const KELPIE = card('Test Grave Eel', 'Creature — Beast', 'Whenever this creature or another permanent enters from a graveyard, draw a card.', '{0}', ['2', '2']);
const RAISE = card('Test Raise Dead', 'Sorcery', 'Return target permanent card from your graveyard to the battlefield.', '{0}');
const DRAIN = card('Test Drain', 'Sorcery', 'Each opponent loses 2 life.', '{0}');
const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
const BEAR2 = card('Test Cub', 'Creature — Bear', '', '{0}', ['1', '1']);
const RAT1 = card('Test Rat One', 'Creature — Rat', '', '{0}', ['1', '1']);
const RAT2 = card('Test Rat Two', 'Creature — Rat', '', '{0}', ['1', '1']);
const RAT3 = card('Test Rat Three', 'Creature — Rat', '', '{0}', ['1', '1']);
const CHARM = card('Test Charm', 'Sorcery', 'You gain 1 life.', '{0}');
const ORACLE = card('Test Oracle', 'Artifact', '', '{0}');
const GREENCUB = card('Test Green Cub', 'Creature — Bear', '', '{G}', ['1', '1']);
const SORC = card('Test Idle Sorcery', 'Sorcery', 'You gain 1 life.', '{0}');
const PIXIE = card('Test Pixie', 'Creature — Faerie', '', '{0}', ['1', '1']);
const ADVENTURER = compileCard({
  name: 'Test Page // Test Whisper', layout: 'adventure', mana_cost: '{0} // {0}', type_line: 'Creature — Human Knight // Sorcery — Adventure', colors: [], keywords: [],
  card_faces: [
    { name: 'Test Page', mana_cost: '{0}', type_line: 'Creature — Human Knight', oracle_text: '', power: '1', toughness: '1' },
    { name: 'Test Whisper', mana_cost: '{0}', type_line: 'Sorcery — Adventure', oracle_text: 'You gain 2 life.' },
  ],
} as unknown as OracleCard);
const DEFS = [ADVENTURER, THIEF, RATS, FLORIAN, VIVIEN, HORN, VOID, KELPIE, RAISE, DRAIN, BEAR, BEAR2, RAT1, RAT2, RAT3, CHARM, GREENCUB, SORC, ORACLE, PIXIE];

/**
 * Play the stack out. Each object choice is answered with the cards of `picks` (by name) among its options, else with the fewest cards it asks for; an order as offered. With
 * `stopAtChoice` it stops at the first object choice that has options, to look at them.
 */
function run(s0: GameState, picks: string[] = [], stopAtChoice = false): GameState {
  let s = s0;
  for (let g = 0; g < 60 && s.pending; g++) {
    const p = s.pending;
    if (p.kind === 'chooseObjects') {
      if (stopAtChoice && p.options.length > 0) return s;
      const wanted = picks.map((n) => p.options.find((id) => nameOf(s, id) === n)).filter((id): id is string => id !== undefined).slice(0, p.max);
      s = answer(s, { kind: 'chooseObjects', ids: wanted.length >= p.min ? wanted : p.options.slice(0, p.min) });
    } else if (p.kind === 'priority') {
      if (s.zones.stack.length === 0) break;
      s = passBoth(s);
    } else s = drive(s);
  }
  return s;
}
/** Cast the card `id` from wherever it is (an exiled card) and pay automatically. */
const castFrom = (s: GameState, id: string): GameState => drive(act(s, { type: 'cast', player: 'p1', card: id }));
const resolveAll = (s: GameState): GameState => run(s);
const castable = (s: GameState, id: string, p: 'p1' | 'p2' = 'p1'): number => legalActions(s, p).filter((a) => a.kind === 'cast' && (a.action as { card?: string }).card === id).length;
const idIn = (s: GameState, zone: 'exile' | 'battlefield' | 'graveyard' | 'hand' | 'library', name: string, p: 'p1' | 'p2' = 'p1'): string => {
  const ids = zone === 'exile' || zone === 'battlefield' ? s.zones[zone] : s.zones[zone][p]!;
  const hit = ids.find((id) => nameOf(s, id) === name);
  if (hit === undefined) throw new Error(`no ${name} in ${zone}`);
  return hit;
};
const pickByName = (s: GameState, name: string): string => pendingObjects(s).options.find((id) => nameOf(s, id) === name)!;

describe('the synthetic cards are automated', () => {
  it('play fully', () => { for (const d of [THIEF, RATS, FLORIAN, VIVIEN, HORN, VOID, KELPIE]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true); });
});

describe('"Look at the top three cards of target opponent\'s library, exile one of them face down, then put the rest into their graveyard. You may cast that card ..." (CR 701.20e, 406.3, 400.3; Thief of Sanity)', () => {
  const setup = (): GameState => {
    const s = scenario([], { defs: DEFS, p1: { hand: ['Test Mind Thief'], battlefield: ['Plains'] }, p2: {} });
    setLibrary(s, 'p2', ['Test Bear', 'Test Green Cub', 'Test Oracle', 'Test Idle Sorcery']);
    return s;
  };
  it('the controller chooses one of the three cards, it is exiled face down, the other two go to THEIR owner\'s graveyard (not the controller\'s), the fourth stays', () => {
    let s = run(cast(setup(), 'Test Mind Thief', { targets: [[{ kind: 'player', id: 'p2' }]] }), [], true);
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(pendingObjects(s).player).toBe('p1');
    expect(names(s, pendingObjects(s).options).sort()).toEqual(['Test Bear', 'Test Green Cub', 'Test Oracle']); // exactly the three looked at, never the fourth card
    expect([pendingObjects(s).min, pendingObjects(s).max]).toEqual([1, 1]);
    s = run(answer(s, { kind: 'chooseObjects', ids: [pickByName(s, 'Test Green Cub')] }));
    expect(inExile(s)).toEqual(['Test Green Cub']);
    expect(s.objects[idIn(s, 'exile', 'Test Green Cub')]!.faceDown).toBe(true);
    expect(gyNames(s, 'p2')).toEqual(['Test Bear', 'Test Oracle']);
    expect(gyNames(s, 'p1')).toEqual(['Test Mind Thief']); // nothing of p2's went to p1's graveyard
    expect(libNames(s, 'p2').slice(0, 1)).toEqual(['Test Idle Sorcery']);
  });
  it('the exiled card can be cast with mana of any type ({G} paid with a Plains), the cards put into the graveyard cannot, and a card of the library cannot', () => {
    const s0 = run(cast(setup(), 'Test Mind Thief', { targets: [[{ kind: 'player', id: 'p2' }]] }), [], true);
    let s = run(answer(s0, { kind: 'chooseObjects', ids: [pickByName(s0, 'Test Green Cub')] }));
    const cub = idIn(s, 'exile', 'Test Green Cub');
    expect(castable(s, cub), 'the exiled card is castable').toBe(1);
    expect(castable(s, idIn(s, 'graveyard', 'Test Bear', 'p2')), 'the milled-to-graveyard card is not').toBe(0);
    s = resolveAll(castFrom(s, cub));
    expect(onBattlefield(s, 'Test Green Cub', 'p1')).toHaveLength(1);
  });
  it('the negative case: nobody else may cast the exiled card', () => {
    const s0 = run(cast(setup(), 'Test Mind Thief', { targets: [[{ kind: 'player', id: 'p2' }]] }), [], true);
    const s = run(answer(s0, { kind: 'chooseObjects', ids: [pickByName(s0, 'Test Green Cub')] }));
    expect(castable(s, idIn(s, 'exile', 'Test Green Cub'), 'p2')).toBe(0);
  });
});

describe('"You may reveal any number of Rat cards from among them and put the revealed cards into your hand. Put the rest on the bottom of your library in a random order." (CR 701.20a, 608.2c-d; Karumonix)', () => {
  const setup = (): GameState => {
    const s = scenario([], { defs: DEFS, p1: { hand: ['Test Rat Chief'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Rat One', 'Test Bear', 'Test Rat Two', 'Test Cub', 'Test Rat Three', 'Test Idle Sorcery']);
    return s;
  };
  it('only Rat cards among the top five are offered, any number may be taken (two here), those go to the hand, the other three of the five go to the bottom, the sixth card stays on top', () => {
    let s = run(cast(setup(), 'Test Rat Chief'), [], true);
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(names(s, pendingObjects(s).options).sort()).toEqual(['Test Rat One', 'Test Rat Three', 'Test Rat Two']); // not the Bears, not the sixth card
    expect([pendingObjects(s).min, pendingObjects(s).max]).toEqual([0, 3]);
    s = run(answer(s, { kind: 'chooseObjects', ids: [pickByName(s, 'Test Rat One'), pickByName(s, 'Test Rat Three')] }));
    expect(handNames(s, 'p1')).toEqual(['Test Rat One', 'Test Rat Three']);
    expect(libNames(s, 'p1')[0]).toBe('Test Idle Sorcery'); // the card below the five is the new top card
    expect(libNames(s, 'p1').slice(-3).sort()).toEqual(['Test Bear', 'Test Cub', 'Test Rat Two']); // the rest, at the bottom
  });
  it('the negative case: taking none leaves the hand alone and puts all five at the bottom', () => {
    let s = run(cast(setup(), 'Test Rat Chief'), [], true);
    s = run(answer(s, { kind: 'chooseObjects', ids: [] }));
    expect(handNames(s, 'p1')).toEqual([]);
    expect(libNames(s, 'p1')[0]).toBe('Test Idle Sorcery');
    expect(libNames(s, 'p1').slice(-5).sort()).toEqual(['Test Bear', 'Test Cub', 'Test Rat One', 'Test Rat Three', 'Test Rat Two']);
  });
});

describe('"Exile one face down and put the rest on the bottom of your library in any order. For as long as it remains exiled, you may cast it if it\'s a creature spell." (CR 601.3, 406.3a; Vivien, Champion of the Wilds)', () => {
  const setup = (top: string[]): GameState => {
    const s = scenario([], { defs: DEFS, p1: { hand: ['Test Wild Walker'] }, p2: {} });
    setLibrary(s, 'p1', top);
    return s;
  };
  const exileOne = (s0: GameState, pick: string): GameState => run(cast(s0, 'Test Wild Walker'), [pick]);
  it('a creature card exiled face down may be cast (although it has no characteristics in exile); the other two are on the bottom', () => {
    const s = exileOne(setup(['Test Bear', 'Test Idle Sorcery', 'Test Oracle', 'Test Cub']), 'Test Bear');
    expect(inExile(s)).toEqual(['Test Bear']);
    expect(s.objects[idIn(s, 'exile', 'Test Bear')]!.faceDown).toBe(true);
    expect(castable(s, idIn(s, 'exile', 'Test Bear')), 'a creature card may be cast').toBe(1);
    expect(libNames(s, 'p1')[0]).toBe('Test Cub');
    expect(libNames(s, 'p1').slice(-2).sort()).toEqual(['Test Idle Sorcery', 'Test Oracle']);
  });
  it('the negative cases: a sorcery card and an artifact card exiled this way may not be cast, however they were chosen', () => {
    for (const pick of ['Test Idle Sorcery', 'Test Oracle']) {
      const s = exileOne(setup(['Test Bear', 'Test Idle Sorcery', 'Test Oracle', 'Test Cub']), pick);
      expect(inExile(s)).toEqual([pick]);
      expect(castable(s, idIn(s, 'exile', pick)), pick).toBe(0);
    }
  });
});

describe('CR 715.3, 601.3: an Adventurer exiled this way is a creature spell only as its creature face', () => {
  it('the creature face may be cast, the Adventure face may not (it is a sorcery spell)', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Wild Walker'] }, p2: {} });
    setLibrary(s0, 'p1', ['Test Page // Test Whisper', 'Test Bear', 'Test Cub']);
    const s = run(cast(s0, 'Test Wild Walker'), ['Test Page // Test Whisper']);
    const page = s.zones.exile.find((id) => nameOf(s, id) === 'Test Page // Test Whisper')!;
    expect(page).toBeDefined();
    const faces = legalActions(s, 'p1').filter((a) => a.kind === 'cast' && (a.action as { card?: string }).card === page).map((a) => (a.action as { face?: number }).face ?? 0);
    expect(faces).toEqual([0]);
  });
});

describe('"Look at the top X cards of your library, where X is the total amount of life your opponents lost this turn. Exile one of those cards ... You may play the exiled card this turn." (CR 119.3, 701.20e; Florian)', () => {
  it('X is the life the opponent lost this turn: two cards looked at, one exiled and playable, the other on the bottom', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Drain'], battlefield: ['Test Bloody Seer'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Bear', 'Test Cub', 'Test Idle Sorcery']);
    s = resolveAll(cast(s, 'Test Drain'));
    expect(lifeOf(s, 'p2')).toBe(18);
    s = run(advanceTo(s, 1, 'main2'), [], true);
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(names(s, pendingObjects(s).options).sort()).toEqual(['Test Bear', 'Test Cub']); // two cards: the life the opponent lost
    s = run(answer(s, { kind: 'chooseObjects', ids: [pickByName(s, 'Test Cub')] }));
    expect(inExile(s)).toEqual(['Test Cub']);
    expect(castable(s, idIn(s, 'exile', 'Test Cub')), 'playable this turn').toBe(1);
    expect(libNames(s, 'p1')[0]).toBe('Test Idle Sorcery');
    expect(libNames(s, 'p1').slice(-1)).toEqual(['Test Bear']);
  });
  it('the negative case: no life lost this turn means X = 0, nothing is looked at, exiled or playable', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Bloody Seer'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Bear', 'Test Cub']);
    s = run(advanceTo(s, 1, 'main2'));
    expect(s.pending).not.toMatchObject({ kind: 'chooseObjects' });
    expect(inExile(s)).toEqual([]);
    expect(libNames(s, 'p1').slice(0, 2)).toEqual(['Test Bear', 'Test Cub']);
  });
});

describe('"Whenever two or more creatures you control attack a player, ..." (CR 508.1a-b, 506.3, 603.2c; Horn of the Mark)', () => {
  it('two attackers at the same player trigger it once; one attacker does not', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test War Horn', 'Test Bear', 'Test Cub'] }, p2: {} });
    const two = attackWith(s0, [idIn(s0, 'battlefield', 'Test Bear'), idIn(s0, 'battlefield', 'Test Cub')]);
    expect(lifeOf(two, 'p1')).toBe(23);
    const one = attackWith(s0, [idIn(s0, 'battlefield', 'Test Bear')]);
    expect(lifeOf(one, 'p1')).toBe(20);
  });
  it('the negative case: an opponent\'s two attackers (or none) never trigger the controller\'s horn', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test War Horn'] }, p2: { battlefield: ['Test Bear', 'Test Cub'] } });
    let s = advanceTo(s0, 2, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: idIn(s, 'battlefield', 'Test Bear'), defender: 'p1' }, { attacker: idIn(s, 'battlefield', 'Test Cub'), defender: 'p1' }] });
    s = resolveAll(s);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
});

describe('Horn of the Mark: the attackers are counted at each player (CR 508.1b, 506.3, 603.2c)', () => {
  const WALKER = compileCard({ name: 'Test Walker', layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Planeswalker — Test', oracle_text: '', colors: [], keywords: [], loyalty: '3' } as OracleCard);
  const toAttackers = (s0: GameState): GameState => {
    let s = s0;
    for (let i = 0; i < 60 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? act(s, { type: 'pass', player: s.pending.player }) : drive(s);
    return s;
  };
  const attackAs = (s0: GameState, attacks: { attacker: string; defender: string }[]): GameState => resolveAll(drive(answer(toAttackers(s0), { kind: 'declareAttackers', attacks })));
  const three = (): GameState => mpScenario({ players: 3, defs: DEFS, zones: { p1: { battlefield: ['Test War Horn', { name: 'Test Bear', since: -1 }, { name: 'Test Cub', since: -1 }, { name: 'Test Rat One', since: -1 }] } } });
  it('in a game of three: two creatures at each of two players would be two triggers; here two at one player and one at the other is one trigger, one at each is none', () => {
    const s0 = three();
    const [a, b, c] = ['Test Bear', 'Test Cub', 'Test Rat One'].map((n) => idIn(s0, 'battlefield', n));
    expect(lifeOf(attackAs(three(), [{ attacker: a!, defender: 'p2' }, { attacker: b!, defender: 'p2' }, { attacker: c!, defender: 'p3' }]), 'p1')).toBe(23);
    expect(lifeOf(attackAs(three(), [{ attacker: a!, defender: 'p2' }, { attacker: b!, defender: 'p3' }]), 'p1')).toBe(20);
  });
  it('the negative case: two attackers at a planeswalker are not attackers of a player (CR 506.3), nor is one at the player and one at the planeswalker two at one player', () => {
    const game = (): GameState => scenario([], { defs: [...DEFS, WALKER], p1: { battlefield: ['Test War Horn', { name: 'Test Bear', since: -1 }, { name: 'Test Cub', since: -1 }] }, p2: { battlefield: [{ name: 'Test Walker', counters: { loyalty: 3 } }] } });
    const s0 = game();
    const [a, b] = ['Test Bear', 'Test Cub'].map((n) => idIn(s0, 'battlefield', n));
    const walker = idIn(s0, 'battlefield', 'Test Walker');
    expect(lifeOf(attackAs(game(), [{ attacker: a!, defender: walker }, { attacker: b!, defender: walker }]), 'p1')).toBe(20);
    expect(lifeOf(attackAs(game(), [{ attacker: a!, defender: walker }, { attacker: b!, defender: 'p2' }]), 'p1')).toBe(20);
  });
});

describe('"Exile the top four cards of target opponent\'s library, then put a creature card from among them onto the battlefield under your control." (CR 406.1, 110.2a; Lord of the Void)', () => {
  const setup = (top: string[]): GameState => {
    const s = scenario([], { defs: DEFS, p1: { hand: ['Test Void Lord'] }, p2: {} });
    setLibrary(s, 'p2', top);
    return s;
  };
  it('the top four are exiled, the controller chooses one creature card among them (only creature cards are offered) and it enters under their control; the rest stay exiled', () => {
    let s = run(cast(setup(['Test Bear', 'Test Oracle', 'Test Cub', 'Test Idle Sorcery', 'Test Charm']), 'Test Void Lord', { targets: [[{ kind: 'player', id: 'p2' }]] }), [], true);
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(pendingObjects(s).player).toBe('p1');
    expect(names(s, pendingObjects(s).options).sort()).toEqual(['Test Bear', 'Test Cub']);
    s = run(answer(s, { kind: 'chooseObjects', ids: [pickByName(s, 'Test Cub')] }));
    expect(onBattlefield(s, 'Test Cub', 'p1')).toHaveLength(1);
    expect(inExile(s)).toEqual(['Test Bear', 'Test Idle Sorcery', 'Test Oracle']);
    expect(libNames(s, 'p2')[0]).toBe('Test Charm'); // the fifth card is untouched
  });
  it('the negative case: no creature card among the four means nothing enters; the four are exiled all the same', () => {
    const s = run(cast(setup(['Test Oracle', 'Test Idle Sorcery', 'Test Charm', 'Test War Horn', 'Test Bear']), 'Test Void Lord', { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(s.zones.battlefield).toHaveLength(0);
    expect(inExile(s)).toHaveLength(4);
    expect(libNames(s, 'p2')[0]).toBe('Test Bear');
  });
});

describe('"Whenever this creature or another permanent enters from a graveyard, draw a card." (CR 400.3, 603.6a; River Kelpie)', () => {
  it('another permanent returned from a graveyard draws a card; the creature itself returned from a graveyard draws one too', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Raise Dead'], battlefield: ['Test Grave Eel'], graveyard: ['Test Bear'] }, p2: {} });
    const before = s.zones.hand.p1!.length;
    s = resolveAll(cast(s, 'Test Raise Dead', { targets: [[obj(idIn(s, 'graveyard', 'Test Bear'))]] }));
    expect(onBattlefield(s, 'Test Bear', 'p1')).toHaveLength(1);
    expect(s.zones.hand.p1!.length).toBe(before - 1 + 1); // the spell left the hand, one card was drawn
    let t = scenario([], { defs: DEFS, p1: { hand: ['Test Raise Dead'], graveyard: ['Test Grave Eel'] }, p2: {} });
    const hand0 = t.zones.hand.p1!.length;
    t = resolveAll(cast(t, 'Test Raise Dead', { targets: [[obj(idIn(t, 'graveyard', 'Test Grave Eel'))]] }));
    expect(onBattlefield(t, 'Test Grave Eel', 'p1')).toHaveLength(1);
    expect(t.zones.hand.p1!.length).toBe(hand0 - 1 + 1);
  });
  it('the negative case: a permanent entering from the hand (cast as a spell) or created does not draw', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Bear'], battlefield: ['Test Grave Eel'] }, p2: {} });
    const before = s.zones.hand.p1!.length;
    s = resolveAll(cast(s, 'Test Bear'));
    expect(onBattlefield(s, 'Test Bear', 'p1')).toHaveLength(1);
    expect(s.zones.hand.p1!.length).toBe(before - 1);
  });
});
