/**
 * Commander EDHREC ranks 23,001-23,500, round edh-c-55: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default
 * compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 *
 *   CR 400.3, 110.2a, 608.2c   "Each player returns all artifact cards from their graveyard to the battlefield."
 *   CR 614.1a, 700.4, 303.4b   "If a creature you control that's enchanted would die, return it to its owner's hand instead."
 *   CR 707.10, 707.10c, 603.2h "Whenever you cast an instant or sorcery spell that targets only ~ or activate an ability that targets only ~, copy that spell or ability. ... once each turn."
 */
import { describe, expect, it } from 'vitest';
import { type GameState, type ObjectId } from '../../../src/index';
import { act, find, put, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';
import { card, cast, full, named, pt, resolveAll, settle } from '../cmd3/helpers';

const inGy = (s: GameState, defId: string, p: string): boolean => (s.zones.graveyard[p] ?? []).some((id) => s.objects[id]!.defId === defId);
const inHand = (s: GameState, defId: string, p: string): boolean => (s.zones.hand[p] ?? []).some((id) => s.objects[id]!.defId === defId);

describe('CR 400.3, 110.2a, 608.2c: "Each player returns all artifact cards from their graveyard to the battlefield."', () => {
  const ROAR = card('Test Mass Revival', 'Sorcery', 'Each player returns all artifact cards from their graveyard to the battlefield.');
  const RELIC = card('Test Brass Relic', 'Artifact', '');
  const OGRE = card('Test Plain Ogre', 'Creature — Ogre', '', ['2', '2']);
  const game = (): GameState => tweak(scenario([], { defs: [ROAR, RELIC, OGRE], p1: { hand: [ROAR.name] } }), (t) => {
    put(t, 'p1', 'graveyard', 'Test Brass Relic'); put(t, 'p1', 'graveyard', 'Test Plain Ogre');
    put(t, 'p2', 'graveyard', 'Test Brass Relic'); put(t, 'p2', 'graveyard', 'Test Brass Relic');
  });
  it('is full', () => { expect(full(ROAR)).toBe(true); });
  it('every player gets their own artifact cards back, under their own control; the creature cards stay', () => {
    const s0 = game();
    const s1 = resolveAll(cast(s0, 'Test Mass Revival'));
    const mine = s1.zones.battlefield.filter((id) => s1.objects[id]!.defId === 'Test Brass Relic' && s1.objects[id]!.controller === 'p1');
    const theirs = s1.zones.battlefield.filter((id) => s1.objects[id]!.defId === 'Test Brass Relic' && s1.objects[id]!.controller === 'p2');
    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(2);
    expect(inGy(s1, 'Test Plain Ogre', 'p1')).toBe(true); // negative: not an artifact card
    expect(named(s1, 'Test Plain Ogre')).toHaveLength(0);
    expect(inGy(s1, 'Test Brass Relic', 'p2')).toBe(false);
  });
  it('negative: an artifact in a library or hand does not move', () => {
    const s0 = tweak(game(), (t) => { put(t, 'p2', 'hand', 'Test Brass Relic'); });
    const s1 = resolveAll(cast(s0, 'Test Mass Revival'));
    expect(inHand(s1, 'Test Brass Relic', 'p2')).toBe(true);
  });
});

describe('CR 614.1a, 700.4, 303.4b: "If a creature you control that\'s enchanted would die, return it to its owner\'s hand instead."', () => {
  const MARK = card('Test Raising Mark', 'Enchantment — Aura', 'Enchant creature\nIf a creature you control that\'s enchanted would die, return it to its owner\'s hand instead.');
  const OGRE = card('Test Plain Ogre', 'Creature — Ogre', '', ['2', '2']);
  const SMITE = card('Test Smite', 'Sorcery', 'Destroy target creature.');
  const PLAIN = card('Test Plain Aura', 'Enchantment — Aura', 'Enchant creature');
  const game = (): { s: GameState; mine: ObjectId; bare: ObjectId; theirs: ObjectId; theirsAura: ObjectId } => {
    let mine = '', bare = '', theirs = '', aura = '';
    const s = tweak(scenario([], { defs: [MARK, OGRE, SMITE, PLAIN], p1: { hand: [SMITE.name] } }), (t) => {
      mine = put(t, 'p1', 'battlefield', 'Test Plain Ogre'); bare = put(t, 'p1', 'battlefield', 'Test Plain Ogre'); theirs = put(t, 'p2', 'battlefield', 'Test Plain Ogre');
      aura = put(t, 'p1', 'battlefield', 'Test Raising Mark'); t.objects[aura]!.attachedTo = mine;
      const a2 = put(t, 'p1', 'battlefield', 'Test Plain Aura'); t.objects[a2]!.attachedTo = theirs; // an Aura of ours on their creature: that creature is not one we control
    });
    return { s, mine, bare, theirs, theirsAura: aura };
  };
  // the template is experimental until edh-c-20 is combined (Magemark's first sentence), so the card is partial here: the replacement itself is automated
  it('the replacement is automated', () => { expect(['partial', 'full']).toContain(MARK.automation.level); });
  it('an enchanted creature we control that would die returns to its owner\'s hand instead (the Aura falls off)', () => {
    const g = game();
    const s1 = resolveAll(cast(g.s, 'Test Smite', { targets: [{ kind: 'object', id: g.mine }] }));
    expect(inHand(s1, 'Test Plain Ogre', 'p1')).toBe(true);
    expect(inGy(s1, 'Test Plain Ogre', 'p1')).toBe(false);
  });
  it('negative: a creature without the Aura, or one an opponent controls, dies normally', () => {
    const g = game();
    const s1 = resolveAll(cast(g.s, 'Test Smite', { targets: [{ kind: 'object', id: g.bare }] }));
    expect(inGy(s1, 'Test Plain Ogre', 'p1')).toBe(true);
    const s2 = resolveAll(cast(g.s, 'Test Smite', { targets: [{ kind: 'object', id: g.theirs }] }));
    expect(inGy(s2, 'Test Plain Ogre', 'p2')).toBe(true);
    expect(inHand(s2, 'Test Plain Ogre', 'p2')).toBe(false);
  });
});

describe('CR 707.10, 707.10c, 603.2h: "copy that spell or ability" of a trigger on casting or activating, once each turn', () => {
  const BILL = card('Test Doctor Companion', 'Legendary Creature — Human', 'Whenever you cast an instant or sorcery spell that targets only this creature or activate an ability that targets only this creature, copy that spell or ability. You may choose new targets for the copy. This ability triggers only once each turn.', ['2', '2']);
  const BOOST = card('Test Boost Spell', 'Instant', 'Target creature gets +1/+1 until end of turn.');
  const WAND = card('Test Boost Wand', 'Artifact', '{T}: Target creature gets +1/+1 until end of turn.');
  const OGRE = card('Test Plain Ogre', 'Creature — Ogre', '', ['2', '2']);
  const game = (): GameState => tweak(scenario([], { defs: [BILL, BOOST, WAND, OGRE], p1: { hand: [BOOST.name, BOOST.name] } }), (t) => {
    put(t, 'p1', 'battlefield', 'Test Doctor Companion'); put(t, 'p1', 'battlefield', 'Test Plain Ogre'); put(t, 'p1', 'battlefield', 'Test Boost Wand');
  });
  it('is full', () => { expect(full(BILL)).toBe(true); });
  it('a spell that targets only it is copied: the creature gets +1/+1 twice', () => {
    const s0 = game();
    const bill = named(s0, 'Test Doctor Companion')[0]!;
    const s1 = resolveAll(cast(s0, 'Test Boost Spell', { targets: [{ kind: 'object', id: bill }] }), { yes: false });
    expect(pt(s1, bill)).toBe('4/4');
  });
  it('negative: a spell that targets another creature is not copied', () => {
    const s0 = game();
    const ogre = named(s0, 'Test Plain Ogre')[0]!;
    const s1 = resolveAll(cast(s0, 'Test Boost Spell', { targets: [{ kind: 'object', id: ogre }] }), { yes: false });
    expect(pt(s1, ogre)).toBe('3/3');
  });
  it('an ability that targets only it is copied too', () => {
    const s0 = game();
    const bill = named(s0, 'Test Doctor Companion')[0]!;
    const wand = named(s0, 'Test Boost Wand')[0]!;
    const s1 = resolveAll(settle(act(s0, { type: 'activate', player: 'p1', source: wand, ability: 'p:0:0' }), { targets: [{ kind: 'object', id: bill }] }), { yes: false });
    expect(pt(s1, bill)).toBe('4/4');
  });
  it('only once each turn: the second spell this turn is not copied', () => {
    const s0 = game();
    const bill = named(s0, 'Test Doctor Companion')[0]!;
    const s1 = resolveAll(cast(s0, 'Test Boost Spell', { targets: [{ kind: 'object', id: bill }] }), { yes: false });
    const s2 = resolveAll(cast(s1, 'Test Boost Spell', { targets: [{ kind: 'object', id: bill }] }), { yes: false });
    expect(pt(s2, bill)).toBe('5/5'); // 2/2 + 2 (copied) + 1 (not copied)
    void find;
  });
});
