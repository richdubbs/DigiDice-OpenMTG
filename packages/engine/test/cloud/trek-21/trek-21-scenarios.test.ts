/**
 * trek-21 (lane trek, the Star Trek cards revealed since 2026-10-29): the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler. Each test is named after the rule it checks, with its negative case. CR cites checked against the Comprehensive Rules text of 2026-09-25.
 *
 *   CR 603.7, 603.12, 608.2c   "... At the beginning of the next end step, put it on the bottom of your library. When you do, draw a card." (U.S.S. Farragut): the draw waits for the put
 *                              on the bottom inside the delayed trigger; a creature that left first is not put, so nothing is drawn
 *   CR 614.1a, 205.2a, 401.4   "If you would draw a card, you may instead choose land or nonland and reveal cards ... in a random order." (Pavel Chekov): the optional replacement
 *   CR 614.1c, 122.6, 107.3    "It enters with X additional +1/+1 counters on it if it's a creature and X additional charge counters on it if it's a Spacecraft, where X is the number of
 *                              differently named lands you control." (Chief Montgomery Scott): each kind by the type of the card put, X counted as it enters
 *   CR 406.1, 608.2g, 118.9    "Target opponent exiles the top X cards of their library ... You may cast an instant or sorcery spell from among them without paying its mana cost. Then that
 *                              player puts the rest on the bottom of their library in a random order." (Lieutenant Nyota Uhura)
 *   CR 608.2d, 115.1, 701.13a  "Choose target noncreature spell an opponent controls. That player may exile it. If they don't, you may cast a noncreature spell from your hand without
 *                              paying its mana cost." (Brazen Bluff)
 *   CR 400.7j, 602.2b, 603.7   "{4}, Sacrifice another nontoken creature: Return that card to the battlefield under its owner's control at the beginning of the next end step."
 *                              (The Guardian of Forever): the card the sacrifice made, in its owner's graveyard
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { put } from '../../m3/scenario';
import { act, advanceTo, answer, card, cast, drive, find, full, obj, passBoth, resolveAll, scenario } from '../r5-cost/support';

type P = 'p1' | 'p2';
const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => nameOf(s, id));
const hand = (s: GameState, p: P): string[] => names(s, s.zones.hand[p]!).sort();
const lib = (s: GameState, p: P): string[] => names(s, s.zones.library[p]!);
const bf = (s: GameState, p: P): string[] => names(s, s.zones.battlefield.filter((id) => s.objects[id]!.controller === p)).sort();
const gy = (s: GameState, p: P): string[] => names(s, s.zones.graveyard[p]!).sort();
function setLibrary(s: GameState, p: P, list: string[]): void {
  for (const id of s.zones.library[p]!) delete s.objects[id];
  s.zones.library[p] = [];
  for (const n of list) put(s, p, 'library', n);
}
const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
const TONIC = card('Test Tonic', 'Instant', 'You gain 2 life.');
const CHARM = card('Test Charm', 'Sorcery', 'You gain 1 life.');
const SOUL = card('Test Soul', 'Creature — Spirit', '', '{0}', ['1', '1']);
const RELIC = card('Test Relic', 'Artifact', '', '{1}');

// ---- Farragut ------------------------------------------------------------------------------------------------------------------------------------------------------------
const SHIP = card('Test Starship', 'Legendary Artifact — Spacecraft', 'Whenever a land you control enters, you may put a creature card from your hand onto the battlefield. That creature gains haste. At the beginning of the next end step, put it on the bottom of your library. When you do, draw a card.');
const playLand = (s: GameState): GameState => act(s, { type: 'playLand', player: 'p1', card: find(s, 'Plains', 'hand') });

describe('CR 603.7, 603.12: "... At the beginning of the next end step, put it on the bottom of your library. When you do, draw a card." (U.S.S. Farragut)', () => {
  const DEFS = [SHIP, BEAR, CHARM, SOUL];
  const setup = (): GameState => {
    const s = scenario([], { defs: DEFS, p1: { hand: ['Plains', 'Test Bear'], battlefield: ['Test Starship'] } });
    setLibrary(s, 'p1', ['Test Charm', 'Test Soul']);
    return s;
  };
  it('the synthetic card is automated', () => expect(full(SHIP), JSON.stringify(SHIP.automation)).toBe(true));
  it('the creature enters with haste, goes to the bottom of the library at the end step, and only then is a card drawn', () => {
    const s0 = setup();
    let s = resolveAll(playLand(s0), { objects: [[find(s0, 'Test Bear', 'hand', 'p1')]] });
    expect(bf(s, 'p1')).toContain('Test Bear');
    const handMid = s.zones.hand['p1']!.length;
    expect(hand(s, 'p1')).not.toContain('Test Bear');
    s = resolveAll(advanceTo(s, 1, 'end'));
    expect(bf(s, 'p1')).not.toContain('Test Bear');
    expect(lib(s, 'p1')[lib(s, 'p1').length - 1]).toBe('Test Bear');
    expect(s.zones.hand['p1']!.length).toBe(handMid + 1);
  });
  it('NEGATIVE: a creature that left the battlefield before the end step is not put on the bottom, so no card is drawn', () => {
    const s0 = setup();
    let s = resolveAll(playLand(s0), { objects: [[find(s0, 'Test Bear', 'hand', 'p1')]] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = structuredClone(s);
    s.zones.battlefield = s.zones.battlefield.filter((id) => id !== bear);
    s.zones.graveyard['p1']!.push(bear);
    s.objects[bear]!.zone = 'graveyard';
    const handMid = s.zones.hand['p1']!.length;
    s = resolveAll(advanceTo(s, 1, 'end'));
    expect(lib(s, 'p1')).not.toContain('Test Bear');
    expect(s.zones.hand['p1']!.length).toBe(handMid);
  });
  it('NEGATIVE: declining to put the creature does nothing and draws nothing', () => {
    const s0 = setup();
    const handBefore = s0.zones.hand['p1']!.length;
    let s = resolveAll(playLand(s0), { objects: [[]] });
    expect(bf(s, 'p1')).not.toContain('Test Bear');
    s = resolveAll(advanceTo(s, 1, 'end'));
    expect(s.zones.hand['p1']!.length).toBe(handBefore - 1); // only the land left the hand
  });
});

// ---- Chekov --------------------------------------------------------------------------------------------------------------------------------------------------------------
const NAVIGATOR = card('Test Navigator', 'Legendary Creature — Human Pilot', 'If you would draw a card, you may instead choose land or nonland and reveal cards from the top of your library until you reveal a card of the chosen kind. Put that card into your hand and put all other cards revealed this way on the bottom of your library in a random order.', '{0}', ['2', '2']);
const SIGHT = card('Test Sight', 'Sorcery', 'Draw a card.');

describe('CR 614.1a, 205.2a, 401.4: "If you would draw a card, you may instead choose land or nonland and reveal ... in a random order." (Pavel Chekov)', () => {
  const DEFS = [NAVIGATOR, SIGHT, CHARM, RELIC, BEAR];
  const setup = (): GameState => {
    const s = scenario(['Forest'], { defs: DEFS, p1: { hand: ['Test Sight'], battlefield: ['Test Navigator'] } });
    setLibrary(s, 'p1', ['Test Charm', 'Test Relic', 'Forest', 'Test Bear']);
    return s;
  };
  it('the synthetic card is automated', () => expect(full(NAVIGATOR), JSON.stringify(NAVIGATOR.automation)).toBe(true));
  it('yes, land: the cards above the first land are revealed, the land is taken instead of the drawn card, the others go to the bottom', () => {
    const s = resolveAll(cast(setup(), 'Test Sight', { yes: [true], options: [['0']] }), { yes: [true], options: [['0']] });
    expect(hand(s, 'p1')).toEqual(['Forest']);
    expect(lib(s, 'p1')[0]).toBe('Test Bear');
    expect(lib(s, 'p1').slice(1).sort()).toEqual(['Test Charm', 'Test Relic']);
  });
  it('NEGATIVE: declining the replacement draws the top card normally', () => {
    const s = resolveAll(cast(setup(), 'Test Sight', { yes: [false] }), { yes: [false] });
    expect(hand(s, 'p1')).toEqual(['Test Charm']);
  });
});

// ---- Scott ---------------------------------------------------------------------------------------------------------------------------------------------------------------
const ENGINEER = card('Test Engineer', 'Legendary Creature — Human Artificer', '{6}, {T}: You may put a creature or Spacecraft card from your hand onto the battlefield. It enters with X additional +1/+1 counters on it if it\'s a creature and X additional charge counters on it if it\'s a Spacecraft, where X is the number of differently named lands you control.', '{0}', ['2', '2']);
const CRAFT = card('Test Cruiser', 'Artifact — Spacecraft', 'Station');

describe('CR 614.1c, 122.6: "It enters with X additional +1/+1 counters ... if it\'s a creature and X additional charge counters ... if it\'s a Spacecraft, where X is the number of differently named lands you control." (Chief Montgomery Scott)', () => {
  const DEFS = [ENGINEER, BEAR, CRAFT, RELIC];
  const setup = (card_: string): GameState => scenario(['Forest', 'Island', 'Mountain'], {
    defs: DEFS, p1: { hand: [card_], battlefield: ['Test Engineer', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Forest', 'Island'] },
  });
  const run = (s: GameState): GameState => {
    const pick = s.zones.hand['p1']!.map((id) => id);
    return resolveAll(drive(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Engineer', 'battlefield', 'p1'), ability: 'p:0:0' }), { objects: [pick] }), { objects: [pick] });
  };
  it('the synthetic card is automated', () => expect(full(ENGINEER), JSON.stringify(ENGINEER.automation)).toBe(true));
  it('a creature enters with that many +1/+1 counters (three differently named lands: Plains, Forest, Island, not eight lands)', () => {
    const s = run(setup('Test Bear'));
    const id = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(s.objects[id]!.counters['+1/+1']).toBe(3);
    expect(s.objects[id]!.counters['charge'] ?? 0).toBe(0);
    expect(Number(getChars(s, id).power)).toBe(5);
  });
  it('a Spacecraft enters with that many charge counters and no +1/+1 counters', () => {
    const s = run(setup('Test Cruiser'));
    const id = find(s, 'Test Cruiser', 'battlefield', 'p1');
    expect(s.objects[id]!.counters['charge']).toBe(3);
    expect(s.objects[id]!.counters['+1/+1'] ?? 0).toBe(0);
  });
  it('NEGATIVE: another artifact cannot be put (only a creature or Spacecraft card is offered)', () => {
    const s = setup('Test Relic');
    const before = s.zones.hand['p1']!.length;
    const t = run(s);
    expect(t.zones.hand['p1']!.length).toBe(before);
    expect(bf(t, 'p1')).not.toContain('Test Relic');
  });
});

// ---- Uhura ---------------------------------------------------------------------------------------------------------------------------------------------------------------
const OFFICER = card('Test Officer', 'Legendary Creature — Human Officer', '{4}, {T}: Target opponent exiles the top X cards of their library, where X is the number of differently named lands you control. You may cast an instant or sorcery spell from among them without paying its mana cost. Then that player puts the rest on the bottom of their library in a random order.', '{0}', ['2', '2']);

describe('CR 406.1, 608.2g, 118.9: "Target opponent exiles the top X cards of their library ... You may cast an instant or sorcery spell from among them ... Then that player puts the rest on the bottom" (Lieutenant Nyota Uhura)', () => {
  const DEFS = [OFFICER, TONIC, CHARM, BEAR, RELIC];
  const setup = (): GameState => {
    const s = scenario(['Forest', 'Island'], { defs: DEFS, p1: { battlefield: ['Test Officer', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Forest'] }, p2: {} });
    setLibrary(s, 'p2', ['Test Bear', 'Test Tonic', 'Plains', 'Test Relic', 'Test Charm']);
    return s;
  };
  const go = (s: GameState, script: Parameters<typeof drive>[1]): GameState =>
    resolveAll(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Officer', 'battlefield', 'p1'), ability: 'p:0:0' }), script);
  it('the synthetic card is automated', () => expect(full(OFFICER), JSON.stringify(OFFICER.automation)).toBe(true));
  const activate = (s: GameState): GameState => drive(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Officer', 'battlefield', 'p1'), ability: 'p:0:0' }), { targets: [[{ kind: 'player', id: 'p2' }]] });
  it('X = 2 (Plains and Forest, not six lands): the opponent exiles two cards, you cast the instant free, the other exiled card goes to the bottom of THEIR library', () => {
    let s = setup();
    const life = (): number => s.players.find((x) => x.id === 'p1')!.life;
    const l = life();
    s = passBoth(activate(s)); // the ability resolves: the opponent exiles two cards, you choose which spell to cast
    expect(s.pending?.kind).toBe('chooseObjects');
    const offered = (s.pending as { options: string[] }).options;
    expect(offered.map((id) => nameOf(s, id))).toEqual(['Test Tonic']); // the creature is not offered
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: offered }));
    expect(life()).toBe(l + 2);
    expect(gy(s, 'p2')).toEqual(['Test Tonic']);
    expect(lib(s, 'p2')).toEqual(['Plains', 'Test Relic', 'Test Charm', 'Test Bear']);
    expect(s.zones.exile.length).toBe(0);
  });
  it('NEGATIVE: casting nothing puts both exiled cards on the bottom (the creature is never castable: only instants and sorceries are offered)', () => {
    let s = setup();
    const l = s.players.find((x) => x.id === 'p1')!.life;
    s = resolveAll(activate(s), { objects: [[]] });
    expect(s.players.find((x) => x.id === 'p1')!.life).toBe(l);
    expect(lib(s, 'p2').slice(0, 3)).toEqual(['Plains', 'Test Relic', 'Test Charm']);
    expect(lib(s, 'p2').slice(3).sort()).toEqual(['Test Bear', 'Test Tonic']);
    expect(s.zones.exile.length).toBe(0);
  });
});

describe('CR 601.2, 608.2g: a chosen card that cannot be cast is not cast, so it is part of "the rest" (Lieutenant Nyota Uhura, review)', () => {
  const KILL = card('Test Kill', 'Instant', 'Destroy target artifact.');
  it('an instant with no legal target is chosen, cannot be cast, and goes to the bottom of the library with the rest', () => {
    let s = scenario(['Forest', 'Island'], { defs: [OFFICER, KILL, BEAR], p1: { battlefield: ['Test Officer', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Forest'] }, p2: {} });
    setLibrary(s, 'p2', ['Test Kill', 'Test Bear', 'Plains', 'Forest']);
    s = passBoth(drive(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Officer', 'battlefield', 'p1'), ability: 'p:0:0' }), { targets: [[{ kind: 'player', id: 'p2' }]] }));
    const offered = (s.pending as { options: string[] }).options;
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: offered }));
    expect(s.zones.exile.length).toBe(0);
    expect(lib(s, 'p2').slice(0, 2)).toEqual(['Plains', 'Forest']);
    expect(lib(s, 'p2').slice(2).sort()).toEqual(['Test Bear', 'Test Kill']);
  });
});

// ---- Brazen Bluff --------------------------------------------------------------------------------------------------------------------------------------------------------
const BLUFF = card('Test Gambit', 'Instant', 'Choose target noncreature spell an opponent controls. That player may exile it. If they don\'t, you may cast a noncreature spell from your hand without paying its mana cost.');

describe('CR 608.2d, 115.1: "Choose target noncreature spell an opponent controls. That player may exile it. If they don\'t, you may cast a noncreature spell from your hand without paying its mana cost." (Brazen Bluff)', () => {
  const DEFS = [BLUFF, TONIC, CHARM];
  it('the synthetic card is automated', () => expect(full(BLUFF), JSON.stringify(BLUFF.automation)).toBe(true));
  /** Turn 2: p2 casts its Tonic in its upkeep, p1 (holding the Gambit and a Charm) responds. */
  const respond = (script: Parameters<typeof drive>[1], castCharm = false): GameState => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Gambit', 'Test Charm'] }, p2: { hand: ['Test Tonic'] } });
    s = advanceTo(s, 2, 'upkeep');
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Tonic', 'hand', 'p2') }));
    s = act(s, { type: 'pass', player: 'p2' });
    const tonic = find(s, 'Test Tonic', 'stack');
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Gambit', 'hand', 'p1') }), { targets: [[obj(tonic)]] });
    return resolveAll(s, castCharm ? { ...script, objects: [[find(s, 'Test Charm', 'hand', 'p1')]] } : script);
  };
  const lifeOf = (s: GameState, p: P): number => s.players.find((x) => x.id === p)!.life;
  it('they exile it: it never resolves (no 2 life for them) and you cast nothing', () => {
    const s = respond({ yes: [true] });
    expect(lifeOf(s, 'p2')).toBe(20); // the Tonic never resolved: no 2 life
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(names(s, s.zones.exile)).toEqual(['Test Tonic']);
    expect(hand(s, 'p1')).toEqual(['Test Charm']);
  });
  it('NEGATIVE: they decline: the spell resolves (2 life for them) and you may cast the Charm free (1 life for you)', () => {
    const s = respond({ yes: [false] }, true);
    expect(names(s, s.zones.exile)).toEqual([]);
    expect(lifeOf(s, 'p2')).toBe(22);
    expect(lifeOf(s, 'p1')).toBe(21); // the Charm was cast free from the hand
    expect(hand(s, 'p1')).toEqual([]);
  });
});

// ---- Guardian ------------------------------------------------------------------------------------------------------------------------------------------------------------
const GUARDIAN = card('Test Warden', 'Legendary Artifact Creature — Construct', 'Defender\n{4}, Sacrifice another nontoken creature: Return that card to the battlefield under its owner\'s control at the beginning of the next end step.', '{0}', ['4', '4']);

describe('CR 400.7j (review): "that card" is only read when the sacrifice is the one part of the cost that moves cards', () => {
  it('a cost that also discards a card keeps "that card" manual (two cards were moved by the cost)', () => {
    const TWO = card('Test Warden Two', 'Legendary Artifact Creature — Construct', '{1}, Discard a creature card, Sacrifice another nontoken creature: Return that card to the battlefield under its owner\'s control at the beginning of the next end step.', '{0}', ['4', '4']);
    expect(full(TWO)).toBe(false);
  });
});

describe('CR 400.7j, 602.2b, 603.7: "{4}, Sacrifice another nontoken creature: Return that card to the battlefield under its owner\'s control at the beginning of the next end step." (The Guardian of Forever)', () => {
  const DEFS = [GUARDIAN, BEAR];
  const setup = (): GameState => scenario([], { defs: DEFS, p1: { battlefield: ['Test Warden', 'Test Bear', 'Plains', 'Plains', 'Plains', 'Plains'] } });
  it('the synthetic card is automated', () => expect(full(GUARDIAN), JSON.stringify(GUARDIAN.automation)).toBe(true));
  it('the sacrificed creature is in the graveyard until the end step, then returns to the battlefield', () => {
    let s = setup();
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = drive(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Warden', 'battlefield', 'p1'), ability: 'p:0:1' }), { objects: [[bear]] });
    s = resolveAll(s);
    expect(gy(s, 'p1')).toEqual(['Test Bear']);
    expect(bf(s, 'p1')).not.toContain('Test Bear');
    s = resolveAll(advanceTo(s, 1, 'end'));
    expect(bf(s, 'p1')).toContain('Test Bear');
    expect(gy(s, 'p1')).toEqual([]);
  });
});
