/**
 * std-freecast-2 (lane std-freecast): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (wordings
 * invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud
 * checkout).
 *
 *   CR 601.3, 611.2a          "You may cast a creature spell from your graveyard this turn.": one creature spell from your own graveyard, only after the effect
 *                             began and only this turn; a second one is not castable; a noncreature card is not
 *   CR 614.1c, 122.1h, 205.1b "If you do, it enters with a finality counter on it and is a Zombie in addition to its other types.": the permanent the spell cast
 *                             this way becomes; a creature cast from the hand is not changed
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, card, drive, find, full, named, resolveAll, scenario } from '../r3-cost/support';

const URN = card('Test Grave Urn', 'Artifact', '{T}: You may cast a creature spell from your graveyard this turn.', '{1}');
const CRYPT = card('Test Night Crypt', 'Artifact', '{T}: You may cast a creature spell from your graveyard this turn. If you do, it enters with a finality counter on it and is a Zombie in addition to its other types.', '{1}');
const BEAR = card('Test Grove Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
const WOLF = card('Test Grove Wolf', 'Creature — Wolf', '', '{1}', ['2', '1']);
const IDEA = card('Test Idea', 'Sorcery', 'Draw a card.', '{1}');
const DEFS = [URN, CRYPT, BEAR, WOLF, IDEA];

const castable = (s: GameState, id: ObjectId, player: PlayerId = 'p1'): boolean => legalActions(s, player).some((a) => a.kind === 'cast' && a.object === id);
const activate = (s: GameState, name: string): GameState =>
  resolveAll(drive(act(s, legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === find(s, name, 'battlefield', 'p1'))!.action)));
const castFrom = (s: GameState, id: ObjectId): GameState => resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: id })));

describe('std-freecast-2: the synthetic cards are automated', () => {
  it('every synthetic card compiles fully automated', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 601.3, 611.2a: "You may cast a creature spell from your graveyard this turn."', () => {
  const board = (): GameState => scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Test Grave Urn', 'Forest', 'Forest', 'Forest'], graveyard: ['Test Grove Bear', 'Test Grove Wolf', 'Test Idea'] } });
  it('before the ability nothing in the graveyard is castable; after it, a creature card is, and it resolves onto the battlefield', () => {
    let s = board();
    const bear = find(s, 'Test Grove Bear', 'graveyard', 'p1');
    expect(castable(s, bear)).toBe(false);
    s = activate(s, 'Test Grave Urn');
    expect(castable(s, bear)).toBe(true);
    expect(castable(s, find(s, 'Test Idea', 'graveyard', 'p1'))).toBe(false); // a sorcery is not a creature spell
    s = castFrom(s, bear);
    expect(named(s, 'Test Grove Bear')).toHaveLength(1);
  });
  it('one spell: after a creature spell was cast this way, the second creature card is not castable', () => {
    let s = activate(board(), 'Test Grave Urn');
    s = castFrom(s, find(s, 'Test Grove Bear', 'graveyard', 'p1'));
    expect(castable(s, find(s, 'Test Grove Wolf', 'graveyard', 'p1'))).toBe(false);
  });
  it('CR 514.2: this turn only: on the next turn the creature card is not castable', () => {
    let s = activate(board(), 'Test Grave Urn');
    s = advanceTo(s, 3, 'main1');
    expect(castable(s, find(s, 'Test Grove Bear', 'graveyard', 'p1'))).toBe(false);
  });
  it('CR 404.1: from your own graveyard only: an opponent\'s creature card is not castable', () => {
    let s = scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Test Grave Urn', 'Forest'] }, p2: { graveyard: ['Test Grove Bear'] } });
    s = activate(s, 'Test Grave Urn');
    expect(castable(s, find(s, 'Test Grove Bear', 'graveyard', 'p2'))).toBe(false);
  });
});

describe('CR 614.1c, 122.1h, 205.1b: "If you do, it enters with a finality counter on it and is a Zombie in addition to its other types."', () => {
  it('the creature cast this way enters with a finality counter and is a Bear Zombie; one cast from the hand is neither', () => {
    let s = scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Test Night Crypt', 'Forest', 'Forest'], graveyard: ['Test Grove Bear'], hand: ['Test Grove Wolf'] } });
    s = activate(s, 'Test Night Crypt');
    s = castFrom(s, find(s, 'Test Grove Bear', 'graveyard', 'p1'));
    const [bear] = named(s, 'Test Grove Bear');
    expect(s.objects[bear!]!.counters?.['finality']).toBe(1);
    expect(getChars(s, bear!).subtypes).toEqual(expect.arrayContaining(['Bear', 'Zombie']));
    expect(getChars(s, bear!).types).toContain('Creature');
    s = castFrom(s, find(s, 'Test Grove Wolf', 'hand', 'p1'));
    const [wolf] = named(s, 'Test Grove Wolf');
    expect(s.objects[wolf!]!.counters?.['finality'] ?? 0).toBe(0);
    expect(getChars(s, wolf!).subtypes).not.toContain('Zombie');
  });
  it('the Zombie type stays after the turn ends: it is part of how the permanent entered (CR 614.1c), not an effect of this turn', () => {
    let s = scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Test Night Crypt', 'Forest'], graveyard: ['Test Grove Bear'] } });
    s = activate(s, 'Test Night Crypt');
    s = castFrom(s, find(s, 'Test Grove Bear', 'graveyard', 'p1'));
    const [bear] = named(s, 'Test Grove Bear');
    s = advanceTo(s, 2, 'main1');
    expect(getChars(s, bear!).subtypes).toContain('Zombie');
  });
});
