/**
 * r4-cost: mana abilities, cast permissions and an unchosen-modes header (zz-cloud/r4-cost.json; parser/lower/ability.ts#joinChooseColor, render/program.ts),
 * played through the engine with synthetic cards (design 6.10).
 *
 *   CR 106.1, 106.4, 122.1     "add {G} for each charge counter on ~": as many {G} as counters, read as the ability resolves
 *   CR 106.1, 605.1a, 208.1    "{T}: Choose a color. Add one mana of that color for each different power among creatures you control": one color, that much
 *   CR 106.4, 607.2d           "Choose a color. Add an amount of mana of that color equal to the number of creatures you control of the chosen type"
 *   CR 601.2b, 601.3, 118.8    "You may cast ~ from your graveyard by discarding a card / by paying 2 life and sacrificing an artifact or creature in addition
 *                              to paying its other costs": a cast method from the graveyard with those costs added; nothing to discard, no method
 *   CR 118.9, 500.1            "Once during each of your turns, you may cast an instant or sorcery spell from your hand without paying its mana cost": once,
 *                              on your turn only
 *   CR 118.9, 701.59a          "You may collect evidence 10 rather than pay the mana cost for spells you cast": cards with total mana value 10 are exiled
 *   CR 700.2, 603.3c           "choose one that hasn't been chosen this turn." (a full stop before the bullets): the same unchosen modes
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { isGrantedAltMethod } from '../../../src/statics/play-permits';
import { answer, pass, passBoth, pool } from '../../m3/scenario';
import { act, activations, advanceTo, card, cast, drive, find, full, named, resolveAll, scenario } from './support';

const PT: [string, string] = ['2', '2'];
const GARDEN = card('Test Seed Vault', 'Enchantment', 'At the beginning of your first main phase, add {G} for each charge counter on this enchantment.', '{1}');
const LOOTER = card('Test Power Broker', 'Creature — Beast', '{T}: Choose a color. Add one mana of that color for each different power among creatures you control.', '{1}', ['1', '1']);
const CITY = card('Test Tree Hall', 'Land', 'As this land enters, choose a creature type.\n{2}, {T}: Choose a color. Add an amount of mana of that color equal to the number of creatures you control of the chosen type.', '');
const SYMBIOTE = card('Test Grave Symbiote', 'Creature — Horror', 'You may cast this card from your graveyard by discarding a card in addition to paying its other costs.', '{1}', PT);
const WICKER = card('Test Wicker Guard', 'Artifact Creature — Scarecrow', 'You may cast this card from your graveyard by paying 2 life and sacrificing an artifact or creature in addition to paying its other costs.', '{1}', PT);
const TEMPEST = card('Test Storm Bard', 'Creature — Human Bard', 'Once during each of your turns, you may cast an instant or sorcery spell from your hand without paying its mana cost.', '{9}', PT);
const UNRAVELER = card('Test Case Sphinx', 'Creature — Sphinx', 'You may collect evidence 10 rather than pay the mana cost for spells you cast.', '{9}', PT);
const TURTLE = card('Test Pond Mentor', 'Creature — Turtle', "Whenever another creature you control enters, choose one that hasn't been chosen this turn.\n• Put a +1/+1 counter on this creature.\n• You gain 2 life.", '{9}', PT);
const BOLT = card('Test Big Bolt', 'Instant', 'Test Big Bolt deals 5 damage to any target.', '{6}{R}');
const STUDY = card('Test Deep Study', 'Sorcery', 'Draw two cards.', '{8}');
const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{8}', ['3', '3']);
const FROG = card('Test Pond Frog', 'Creature — Frog', '', '{0}', ['1', '1']);
const TOAD = card('Test Big Toad', 'Creature — Frog', '', '{0}', ['3', '3']);
const ROCK = card('Test Pebble', 'Artifact', '', '{0}');
const SLAB = card('Test Heavy Slab', 'Artifact', '', '{10}');
const REALMS = card('Test Tribal Glade', 'Land', 'As this land enters, choose Elemental, Elf, Faerie, Giant, Goblin, Kithkin, Merfolk, or Treefolk.\n{T}: Add {C}.', '');
const DEFS = [GARDEN, LOOTER, CITY, SYMBIOTE, WICKER, TEMPEST, UNRAVELER, TURTLE, BOLT, STUDY, OGRE, FROG, TOAD, ROCK, SLAB, REALMS];

const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const methods = (s: GameState, id: ObjectId, player: PlayerId = 'p1'): (string | undefined)[] =>
  legalActions(s, player).filter((a) => a.kind === 'cast' && a.object === id).map((a) => (a.action as { method?: string }).method);

describe('r4-cost: mana abilities', () => {
  it('the cards are automated', () => {
    for (const d of [GARDEN, LOOTER, CITY]) expect(full(d), d.name).toBe(true);
  });
  it('CR 106.4, 122.1: "add {G} for each charge counter on this enchantment": three counters, {G}{G}{G} at the beginning of the first main phase', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: [{ name: 'Test Seed Vault', counters: { charge: 3 } }], library: ['Plains', 'Plains'] }, p2: { library: ['Plains', 'Plains'] } });
    s = advanceTo(s, 3, 'main1');
    s = resolveAll(s);
    expect(pool(s, 'p1')).toBe('GGG');
  });
  it('CR 106.1, 208.1: "one mana of that color for each different power": powers 1, 3, 3 are two; the color is the player\'s choice', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Power Broker', 'Test Big Toad', 'Test Big Toad'] } });
    const [tap] = activations(s, 'Test Power Broker', true);
    expect(tap).toBeDefined();
    s = drive(act(s, tap!.action), { colors: ['U'] });
    expect(pool(s, 'p1')).toBe('UU');
  });
  it('CR 106.4, 607.2d: "an amount of mana of that color equal to the number of creatures you control of the chosen type": two Frogs, two mana', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Tree Hall'], battlefield: ['Plains', 'Plains', 'Test Pond Frog', 'Test Big Toad', 'Test Ogre'] } });
    const land = find(s, 'Test Tree Hall', 'hand', 'p1');
    s = act(s, { type: 'playLand', player: 'p1', card: land });
    expect(s.pending?.kind).toBe('chooseName');
    s = drive(answer(s, { kind: 'chooseName', name: 'Frog' }));
    expect(named(s, 'Test Tree Hall')).toHaveLength(1);
    const [ability] = activations(s, 'Test Tree Hall', true).filter((a) => /Choose a color/.test(a.label));
    expect(ability).toBeDefined();
    s = drive(act(s, ability!.action), { colors: ['B'] });
    expect(pool(s, 'p1')).toBe('BB');
  });
});

describe('r4-cost: a choice among listed creature types as a permanent enters (CR 614.12a, 607.2d, 205.3m)', () => {
  it('only the eight listed types are offered; another creature type is refused', () => {
    expect(full(REALMS)).toBe(true);
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Tribal Glade'] } });
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Tribal Glade', 'hand', 'p1') });
    expect(s.pending?.kind).toBe('chooseName');
    expect((s.pending as { options?: string[] }).options).toEqual(['Elemental', 'Elf', 'Faerie', 'Giant', 'Goblin', 'Kithkin', 'Merfolk', 'Treefolk']);
    expect(() => answer(s, { kind: 'chooseName', name: 'Human' })).toThrow();
    s = answer(s, { kind: 'chooseName', name: 'Goblin' });
    expect(named(s, 'Test Tribal Glade')).toHaveLength(1);
  });
});

describe('r4-cost: cast permissions', () => {
  it('the cards are automated', () => {
    for (const d of [SYMBIOTE, WICKER, TEMPEST, UNRAVELER, TURTLE]) expect(full(d), d.name).toBe(true);
  });
  it('CR 601.3, 118.8: from the graveyard by discarding a card in addition to its other costs; with no card in hand it is not offered', () => {
    const empty = scenario([], { defs: DEFS, p1: { battlefield: ['Plains'], graveyard: ['Test Grave Symbiote'] } });
    expect(methods(empty, find(empty, 'Test Grave Symbiote', 'graveyard', 'p1'))).toEqual([]);
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Plains'], graveyard: ['Test Grave Symbiote'], hand: ['Test Pebble'] } });
    const sym = find(s, 'Test Grave Symbiote', 'graveyard', 'p1');
    const [m] = methods(s, sym);
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: sym, ...(m !== undefined ? { method: m } : {}) }), { objects: [[find(s, 'Test Pebble', 'hand', 'p1')]] }));
    expect(named(s, 'Test Grave Symbiote')).toHaveLength(1);
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toEqual(['Test Pebble']);
  });
  it('CR 601.3, 118.8: from the graveyard by paying 2 life and sacrificing an artifact or creature', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Plains', 'Test Pebble'], graveyard: ['Test Wicker Guard'] } });
    const guard = find(s, 'Test Wicker Guard', 'graveyard', 'p1');
    const [m] = methods(s, guard);
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: guard, ...(m !== undefined ? { method: m } : {}) }), { objects: [[find(s, 'Test Pebble', 'battlefield', 'p1')]] }));
    expect(named(s, 'Test Wicker Guard')).toHaveLength(1);
    expect(named(s, 'Test Pebble')).toHaveLength(0);
    expect(lifeOf(s, 'p1')).toBe(18);
    const none = scenario([], { defs: DEFS, p1: { battlefield: ['Plains'], graveyard: ['Test Wicker Guard'] } });
    expect(methods(none, find(none, 'Test Wicker Guard', 'graveyard', 'p1'))).toEqual([]); // nothing to sacrifice
  });
  it('CR 118.9, 500.1: "once during each of your turns ... without paying its mana cost": one free instant, not a second, not on the opponent\'s turn', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Storm Bard'], hand: ['Test Big Bolt', 'Test Deep Study', 'Test Ogre'], library: ['Plains', 'Plains', 'Plains', 'Plains'] }, p2: { library: ['Plains', 'Plains'] } });
    const bolt = find(s, 'Test Big Bolt', 'hand', 'p1');
    expect(methods(s, find(s, 'Test Ogre', 'hand', 'p1')).some((m) => isGrantedAltMethod(m))).toBe(false); // a creature spell is not covered
    const free = methods(s, bolt).find((m) => isGrantedAltMethod(m));
    expect(free).toBeDefined();
    const theirs = pass(advanceTo(s, 2, 'main1'));
    expect(methods(theirs, find(theirs, 'Test Big Bolt', 'hand', 'p1')).some((m) => isGrantedAltMethod(m))).toBe(false);
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: bolt, method: free! }), { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(lifeOf(s, 'p2')).toBe(15);
    expect(methods(s, find(s, 'Test Deep Study', 'hand', 'p1')).some((m) => isGrantedAltMethod(m))).toBe(false); // once each turn
  });
  it('CR 118.9, 701.59a: "collect evidence 10 rather than pay the mana cost": graveyard cards with total mana value 10 or more are exiled', () => {
    const few = scenario([], { defs: DEFS, p1: { battlefield: ['Test Case Sphinx'], hand: ['Test Ogre'], graveyard: ['Test Deep Study'] } });
    expect(methods(few, find(few, 'Test Ogre', 'hand', 'p1')).some((m) => isGrantedAltMethod(m))).toBe(false); // 8 is not 10
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Case Sphinx'], hand: ['Test Ogre'], graveyard: ['Test Heavy Slab'] } });
    const ogre = find(s, 'Test Ogre', 'hand', 'p1');
    const alt = methods(s, ogre).find((m) => isGrantedAltMethod(m));
    expect(alt).toBeDefined();
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: ogre, method: alt! }), { objects: [[find(s, 'Test Heavy Slab', 'graveyard', 'p1')]] }));
    expect(named(s, 'Test Ogre')).toHaveLength(1);
    expect(s.zones.exile.map((id) => s.objects[id]!.defId)).toContain('Test Heavy Slab');
  });
});

describe('r4-cost: an unchosen-modes header ending with a full stop (CR 700.2, 603.3c)', () => {
  it('the first trigger may choose either mode; once a mode was chosen this turn, the second trigger offers only the other', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Pond Mentor'], hand: ['Test Pond Frog', 'Test Pond Frog'] } });
    const untilModes = (x: GameState): GameState => {
      let t = x;
      for (let i = 0; i < 12 && t.pending?.kind === 'priority'; i++) t = passBoth(t);
      return t;
    };
    s = untilModes(cast(s, 'Test Pond Frog'));
    const first = s.pending;
    expect(first?.kind).toBe('chooseOption');
    const opts = (first as { options: { id: string; disabled?: string }[] }).options;
    expect(opts.every((o) => o.disabled === undefined)).toBe(true);
    s = resolveAll(answer(s, { kind: 'chooseOption', ids: [opts[1]!.id] })); // gain 2 life
    expect(lifeOf(s, 'p1')).toBe(22);
    s = untilModes(cast(s, 'Test Pond Frog'));
    const second = (s.pending as { options: { id: string; disabled?: string }[] }).options;
    expect(second[1]!.disabled).toBeDefined(); // "it has been chosen this turn"
    expect(second[0]!.disabled).toBeUndefined();
    s = resolveAll(answer(s, { kind: 'chooseOption', ids: [second[0]!.id] }));
    expect((s.objects[find(s, 'Test Pond Mentor', 'battlefield', 'p1')]!.counters ?? {})['+1/+1']).toBe(1);
  });
});
