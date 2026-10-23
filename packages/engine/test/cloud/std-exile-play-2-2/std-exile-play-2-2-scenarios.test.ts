/**
 * std-exile-play-2-2 (lane std-exile-play-2): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in
 * the cloud checkout).
 *
 *   CR 614.1a, 122.1, 400.7  "Whenever you cast a sorcery spell from your hand, exile that card with a moon counter on it instead of putting it into your graveyard
 *                            as it resolves." (eff.sxp22.castSpell.exileWithCounterAsItResolves)
 *   CR 608.2g, 118.9, 122.1  "Whenever ~ attacks, you may cast a spell from among cards you own in exile with moon counters on them without paying its mana cost."
 *                            (eff.sxp22.cast.fromExile.ownedWithCounters.free)
 */
import { describe, expect, it } from 'vitest';
import { type GameState, type ObjectId } from '../../../src/index';
import { act, advanceTo, find, life, scenario } from '../../m3/scenario';
import { attackWith, card, counters, full, resolveAll, settle } from '../cmd3/helpers';

const DREAMER = card('Test Dreamer', 'Creature — Giant Wizard',
  'Whenever you cast a sorcery spell from your hand, exile that card with a moon counter on it instead of putting it into your graveyard as it resolves.\nWhenever Test Dreamer attacks, you may cast a spell from among cards you own in exile with moon counters on them without paying its mana cost.',
  ['4', '4']);
const TONIC = card('Test Tonic', 'Sorcery', 'You gain 3 life.', undefined, '{0}');
const RUSH = card('Test Rush', 'Instant', 'You gain 1 life.', undefined, '{0}');
const SPELLBOOK = card('Test Spellbook', 'Sorcery', 'You gain 5 life.', undefined, '{5}');
const DEFS = [DREAMER, TONIC, RUSH, SPELLBOOK];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

const inExile = (s: GameState, defId: string): ObjectId | undefined => s.zones.exile.find((id) => s.objects[id]!.defId === defId);
const inYard = (s: GameState, defId: string, p = 'p1'): boolean => (s.zones.graveyard[p] ?? []).some((id) => s.objects[id]!.defId === defId);
const castFromHand = (s: GameState, name: string): GameState => resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand') })));

describe('CR 614.1a, 122.1: a sorcery cast from your hand is exiled with a moon counter on it instead of going to your graveyard as it resolves', () => {
  it('the resolved sorcery is in exile with one moon counter, not in the graveyard', () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: ['Test Dreamer'], hand: ['Test Tonic'] }, defs: DEFS });
    const before = life(s0, 'p1');
    const s = castFromHand(s0, 'Test Tonic');
    expect(life(s, 'p1')).toBe(before + 3);
    const tonic = inExile(s, 'Test Tonic');
    expect(tonic).toBeDefined();
    expect(counters(s, tonic!, 'moon')).toBe(1);
    expect(inYard(s, 'Test Tonic')).toBe(false);
  });
  it('an instant (not a sorcery) goes to the graveyard as usual', () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: ['Test Dreamer'], hand: ['Test Rush'] }, defs: DEFS });
    const s = castFromHand(s0, 'Test Rush');
    expect(inYard(s, 'Test Rush')).toBe(true);
    expect(inExile(s, 'Test Rush')).toBeUndefined();
  });
});

describe('CR 608.2g, 118.9: when it attacks, you may cast a spell from among cards you own in exile with moon counters on them without paying its mana cost', () => {
  const exiledThenAttack = (yes: boolean): { s: GameState; book: ObjectId } => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Dreamer'], hand: ['Test Tonic'], exile: ['Test Spellbook'] }, defs: DEFS });
    s = castFromHand(s, 'Test Tonic');
    const tonic = inExile(s, 'Test Tonic')!;
    const book = inExile(s, 'Test Spellbook')!;
    s = advanceTo(s, 3, 'main1');
    s = attackWith(s, [find(s, 'Test Dreamer', 'battlefield')]);
    s = resolveAll(s, { objects: yes ? [tonic] : [] });
    return { s, book };
  };
  it('the exiled sorcery is cast free (p1 has no mana); cast from exile, it goes to the graveyard this time (not cast from the hand)', () => {
    const before = life(scenario(['Plains'], { defs: DEFS }), 'p1');
    const { s } = exiledThenAttack(true);
    expect(life(s, 'p1')).toBe(before + 6); // gained 3 twice
    expect(inYard(s, 'Test Tonic')).toBe(true);
    expect(inExile(s, 'Test Tonic')).toBeUndefined();
  });
  it('a card in exile without a moon counter is not among the choices (the Spellbook, cost {5}, stays in exile); declining casts nothing', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Dreamer'], exile: ['Test Spellbook'] }, defs: DEFS });
    const book = inExile(s, 'Test Spellbook')!;
    const before = life(s, 'p1');
    s = advanceTo(s, 3, 'main1');
    s = attackWith(s, [find(s, 'Test Dreamer', 'battlefield')]);
    s = resolveAll(s, { objects: [] });
    expect(s.zones.exile.includes(book)).toBe(true);
    expect(life(s, 'p1')).toBe(before);
    const declined = exiledThenAttack(false);
    expect(inExile(declined.s, 'Test Tonic')).toBeDefined();
  });
  it('a card an opponent owns with a moon counter is not yours to cast', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Dreamer'] }, p2: { exile: [{ name: 'Test Tonic', counters: { moon: 1 } }] }, defs: DEFS });
    const theirs = inExile(s, 'Test Tonic')!;
    s = advanceTo(s, 3, 'main1');
    s = attackWith(s, [find(s, 'Test Dreamer', 'battlefield')]);
    const pending = s.pending as unknown as { kind: string; options?: ObjectId[] };
    if (pending.kind === 'chooseObjects') expect(pending.options ?? []).not.toContain(theirs);
    s = resolveAll(s, { objects: [] });
    expect(s.zones.exile.includes(theirs)).toBe(true);
  });
});
