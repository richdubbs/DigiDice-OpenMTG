/**
 * edh-next-62 (Commander lane exile-play, second round): the round's readings played through applyAction with synthetic cards compiled by the game's default compiler
 * (invented names and wordings, design 6.10). Nothing is mocked. Each describe names the rules it pins. CR cites checked against the real text of 2026-09-25 unless a
 * describe says otherwise.
 */
import { describe, expect, it } from 'vitest';
import { canSee } from '../../../src/core/view';
import { activate, automated, card, castFrom, castable, exiled, find, legal, obj, onBattlefield, p2, scenario } from './support';

const OX = card('Test Ox', 'Creature — Ox', '', ['1', '4']);
const BEHEMOTH = card('Test Behemoth', 'Creature — Beast', '', ['6', '6']);

describe('CR 607.2a, 406.3, 400.2, 601.3: "You may look at the cards exiled with ~, and you may play lands and cast spells from among those cards." (face-down exile)', () => {
  const CACHE = card('Test Cache', 'Artifact', '{0}: Exile the top card of your library face down.\nYou may look at the cards exiled with this artifact, and you may play lands and cast spells from among those cards.');
  const PLAIN = card('Test Plain Cache', 'Artifact', '{0}: Exile the top card of your library face down.\nYou may play lands and cast spells from among cards exiled with this artifact.');
  it('is automated', () => { expect(automated(CACHE)).toBe(true); expect(automated(PLAIN)).toBe(true); });
  it('the controller can look at the face-down exiled card and cast it; the opponent can do neither', () => {
    let s = scenario([], { p1: { battlefield: ['Test Cache'], library: ['Test Behemoth', 'Plains'] }, defs: [CACHE, BEHEMOTH] });
    s = activate(s, find(s, 'Test Cache', 'battlefield', 'p1'), 'p:0:0');
    const big = exiled(s, 'Test Behemoth')[0]!;
    expect(s.objects[big]!.faceDown).toBe(true);
    expect(canSee(s, s.objects[big]!, 'p1')).toBe(true);
    expect(canSee(s, s.objects[big]!, 'p2')).toBe(false);
    expect(castable(s)).toContain(big);
    s = castFrom(s, big);
    expect(onBattlefield(s, 'Test Behemoth')).toBeDefined();
  });
  it('a card exiled face down by an object WITHOUT the look permission stays hidden from both players, even beside another object that has it (the link is per object)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Cache', 'Test Plain Cache'], library: ['Test Ox', 'Test Behemoth'] }, defs: [CACHE, PLAIN, OX, BEHEMOTH] });
    s = activate(s, find(s, 'Test Plain Cache', 'battlefield', 'p1'), 'p:0:0');
    const ox = exiled(s, 'Test Ox')[0]!;
    expect(canSee(s, s.objects[ox]!, 'p2')).toBe(false);
    // the look permission of ANOTHER object does not reach the cards this object exiled (the link is per object, CR 607.2a)
    s = activate(s, find(s, 'Test Cache', 'battlefield', 'p1'), 'p:0:0');
    const big = exiled(s, 'Test Behemoth')[0]!;
    expect(canSee(s, s.objects[big]!, 'p1')).toBe(true);
    expect(canSee(s, s.objects[ox]!, 'p1')).toBe(false);
    expect(canSee(s, s.objects[ox]!, 'p2')).toBe(false);
  });
});

describe('CR 406.3, 611.2b, 400.7, 607.2a: "Exile a card from your hand face down. You may look at it for as long as it remains exiled." / return a card you own exiled with ~ to your hand', () => {
  const SCEPTER = card('Test Scepter', 'Artifact', '{0}: Exile a card from your hand face down. You may look at it for as long as it remains exiled.\n{0}: Return a card you own exiled with this artifact to your hand.\nWhen you lose control of this artifact, put all cards exiled with this artifact into their owner\'s graveyard.');
  it('is automated', () => { expect(automated(SCEPTER)).toBe(true); });
  it('the controller looks at the card they exiled (the opponent does not), and it comes back to hand; the new card in hand is another object', () => {
    let s = scenario([], { p1: { battlefield: ['Test Scepter'], hand: ['Test Ox'] }, defs: [SCEPTER, OX] });
    const scepter = find(s, 'Test Scepter', 'battlefield', 'p1');
    s = activate(s, scepter, 'p:0:0', { picks: [[find(s, 'Test Ox', 'hand', 'p1')]] });
    const ox = exiled(s, 'Test Ox')[0]!;
    expect(s.objects[ox]!.faceDown).toBe(true);
    expect(canSee(s, s.objects[ox]!, 'p1')).toBe(true);
    expect(canSee(s, s.objects[ox]!, 'p2')).toBe(false);
    s = activate(s, scepter, 'p:0:1', { picks: [[ox]] });
    expect(exiled(s, 'Test Ox')).toEqual([]);
    expect(s.zones.hand.p1!.some((id) => s.objects[id]!.defId === 'Test Ox')).toBe(true);
  });
  it('a card exiled by another object is not looked at through this one (the link is per object, CR 607.2a)', () => {
    const OTHER = card('Test Other Cache', 'Artifact', '{0}: Exile the top card of your library face down.');
    let s = scenario([], { p1: { battlefield: ['Test Scepter', 'Test Other Cache'], library: ['Test Ox'] }, defs: [SCEPTER, OTHER, OX] });
    s = activate(s, find(s, 'Test Other Cache', 'battlefield', 'p1'), 'p:0:0');
    expect(canSee(s, s.objects[exiled(s, 'Test Ox')[0]!]!, 'p1')).toBe(false);
  });
});

describe('CR 607.2a, 613.1f, 604.1: "has all activated abilities of all cards exiled with it" / of all land cards exiled with ~', () => {
  const WELDER = card('Test Welder', 'Artifact Creature — Myr', '{0}: Exile target artifact card from a graveyard.\nThis creature has all activated abilities of all cards exiled with it.', ['1', '1']);
  const SPARKER = card('Test Sparker', 'Artifact', '{0}, {T}: Test Sparker deals 1 damage to any target.');
  it('is automated', () => { expect(automated(WELDER)).toBe(true); });
  it('after exiling an artifact card with an activated ability the creature has that ability; before, it does not', () => {
    let s = scenario([], { p1: { battlefield: ['Test Welder'], graveyard: ['Test Sparker'] }, defs: [WELDER, SPARKER] });
    const welder = find(s, 'Test Welder', 'battlefield', 'p1');
    const abilities = (x: typeof s) => legal(x, 'p1', 'activate').filter((a) => a.object === welder).map((a) => JSON.stringify(a.action));
    const before = abilities(s);
    s = activate(s, welder, 'p:0:0', { targets: [[obj(find(s, 'Test Sparker', 'graveyard', 'p1'))]] });
    expect(exiled(s, 'Test Sparker').length).toBe(1);
    expect(abilities(s).some((a) => !before.includes(a))).toBe(true); // an ability of the Sparker, new for the creature
    expect(abilities(s).length).toBeGreaterThan(0);
  });
});

describe('CR 607.2a, 609.4b, 107.4c, 601.3: "You may play cards exiled with ~, and you may spend mana as though it were mana of any color to cast those spells."', () => {
  const RED = card('Test Red Bolt', 'Creature — Imp', '', ['1', '1'], '{R}');
  const ANY = card('Test Any Vault', 'Artifact', '{0}: Exile the top card of your library.\nYou may play cards exiled with this artifact, and you may spend mana as though it were mana of any color to cast those spells.');
  const PLAINV = card('Test Plain Vault', 'Artifact', '{0}: Exile the top card of your library.\nYou may play cards exiled with this artifact.');
  it('is automated', () => { expect(automated(ANY)).toBe(true); });
  it('white mana pays for a red card exiled with it; without the rider the same card cannot be paid for with white mana', () => {
    for (const [vault, ok] of [[ANY, true], [PLAINV, false]] as const) {
      let s = scenario([], { p1: { battlefield: [vault.faces[0]!.name, 'Plains'], library: ['Test Red Bolt'] }, defs: [vault, RED] });
      s = activate(s, find(s, vault.faces[0]!.name, 'battlefield', 'p1'), 'p:0:0');
      const imp = exiled(s, 'Test Red Bolt')[0]!;
      expect(castable(s).includes(imp), vault.faces[0]!.name).toBe(ok);
    }
  });
});

describe('CR 607.2a, 406.3: Kheru-style: "Target opponent exiles a card from their hand face down." then look at and play the cards exiled with ~', () => {
  const MIND = card('Test Mind Eater', 'Artifact', '{0}: Target opponent exiles a card from their hand face down.\nYou may look at cards exiled with this artifact, and you may play lands and cast spells from among those cards.');
  it('is automated', () => { expect(automated(MIND)).toBe(true); });
  it("the card an opponent exiled from their own hand is seen and cast by the controller of the artifact, not by its owner", () => {
    let s = scenario([], { p1: { battlefield: ['Test Mind Eater'] }, p2: { hand: ['Test Ox'] }, defs: [MIND, OX] });
    s = activate(s, find(s, 'Test Mind Eater', 'battlefield', 'p1'), 'p:0:0', { targets: [[p2]], picks: [[find(s, 'Test Ox', 'hand', 'p2')]] });
    const ox = exiled(s, 'Test Ox')[0]!;
    expect(canSee(s, s.objects[ox]!, 'p1')).toBe(true);
    expect(castable(s)).toContain(ox);
  });
});

describe('CR 406.3, 611.2b, 607.2a: a card nobody has seen, exiled face down from the top of a library, then "You may look at it for as long as it remains exiled."', () => {
  const SNEAK = card('Test Sneak', 'Artifact', '{0}: Exile the top card of target opponent\'s library face down. You may look at it for as long as it remains exiled.\nYou may play cards exiled with this artifact.');
  it('the controller can look at it and so cast it; the opponent whose card it was cannot look at it', () => {
    let s = scenario([], { p1: { battlefield: ['Test Sneak'] }, p2: { library: ['Test Ox', 'Plains'] }, defs: [SNEAK, OX] });
    s = activate(s, find(s, 'Test Sneak', 'battlefield', 'p1'), 'p:0:0', { targets: [[p2]] });
    const ox = exiled(s, 'Test Ox')[0]!;
    expect(s.objects[ox]!.faceDown).toBe(true);
    expect(canSee(s, s.objects[ox]!, 'p1')).toBe(true);
    expect(canSee(s, s.objects[ox]!, 'p2')).toBe(false);
    expect(castable(s)).toContain(ox);
  });
});

describe('rulings 2013-04-15 (Colfenor\'s Plans) and 2017-08-25 (Kheru Mind-Eater): once looked at, a face-down exiled card can still be looked at after the permission is gone', () => {
  const LEAVING = card('Test Leaving Cache', 'Artifact', '{0}: Exile the top card of your library face down.\nYou may look at the cards exiled with this artifact, and you may play lands and cast spells from among those cards.\n{0}, Sacrifice this artifact: Draw a card.');
  it('after the artifact is sacrificed the controller still sees the card, the opponent does not', () => {
    let s = scenario([], { p1: { battlefield: ['Test Leaving Cache'], library: ['Test Ox', 'Plains', 'Plains'] }, defs: [LEAVING, OX] });
    const cache = find(s, 'Test Leaving Cache', 'battlefield', 'p1');
    s = activate(s, cache, 'p:0:0');
    const ox = exiled(s, 'Test Ox')[0]!;
    s = activate(s, cache, 'p:0:2');
    expect(s.zones.battlefield.includes(cache)).toBe(false);
    expect(canSee(s, s.objects[ox]!, 'p1')).toBe(true);
    expect(canSee(s, s.objects[ox]!, 'p2')).toBe(false);
  });
});
