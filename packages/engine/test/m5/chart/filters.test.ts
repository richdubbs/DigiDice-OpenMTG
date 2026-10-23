/**
 * WP6: the noun-phrase grammars (Filter, Obj, Objs, Player, Recipient, Zone) beyond the target phrases of targets.test.ts.
 * Rules cited: CR 109.2 (permanents), 109.4 (control), 110.4 (permanent types), 111.1 (tokens are not cards), 115.1 (targets), 201.5 (names),
 * 205 (types), 608.2h-i (information about an object that left), 610.3 (linked objects), 700.4 (dies).
 */
import { describe, expect, it } from 'vitest';
import { findMarkers, runHole } from '../../../src/parser/holes';
import { ENV, full, one, rejects, target, toks } from './env';

const creature = { types: ['Creature'] };
const itObj = { ref: 'bound', name: '', $anaphor: { sort: 'object', number: 'singular', text: 'it' } };

describe('WP6 Filter: heads, pre-modifiers, post-modifiers (CR 205, 109.4)', () => {
  it.each([
    ['creature', creature],
    ['a creature', creature],
    ['another creature you control', { ...creature, controller: 'you', other: true }],
    ['other creatures you control', { ...creature, controller: 'you', other: true }],
    ['artifact creature', { allTypes: ['Artifact', 'Creature'] }],
    ['legendary creature', { ...creature, supertypes: ['Legendary'] }],
    ['basic land', { types: ['Land'], supertypes: ['Basic'] }],
    ['nonland permanent', { notTypes: ['Land'] }],
    ['noncreature, nonland permanent', { notTypes: ['Creature', 'Land'] }],
    ['non-Human creature', { ...creature, notSubtypes: ['Human'] }],
    ['nonblack creature', { ...creature, notColors: ['B'] }],
    ['red or green creature', { ...creature, colors: ['R', 'G'] }],
    ['red, blue, or green creature', { ...creature, colors: ['R', 'U', 'G'] }],
    ['colorless creature', { ...creature, colorless: true }],
    ['multicolored permanent', { multicolored: true }],
    ['historic permanent', { anyOf: [{ types: ['Artifact'] }, { supertypes: ['Legendary'] }, { subtypes: ['Saga'] }] }],
    ['tapped creature', { ...creature, tapped: true }],
    ['attacking creature', { ...creature, attacking: true }],
    ['Goblin or Elf', { subtypes: ['Goblin', 'Elf'] }],
    ['Elves you control', { subtypes: ['Elf'], controller: 'you' }],
    ['Forest', { subtypes: ['Forest'] }],
    ['artifact, creature, or enchantment', { types: ['Artifact', 'Creature', 'Enchantment'] }],
    ['creature token', { ...creature, token: true }],
    ['nontoken creature', { ...creature, token: false }],
    ['permanent you own', { owner: 'you' }],
    ['creature or planeswalker you control', { types: ['Creature', 'Planeswalker'], controller: 'you' }],
  ])('"%s"', (phrase, expected) => {
    expect(one('Filter', phrase)).toEqual(expected);
  });

  it.each([
    ['creature with flying or reach', { ...creature, keyword: ['flying', 'reach'] }],
    ['creature without flying', { ...creature, notKeyword: 'flying' }],
    ['creature with power 4 or greater', { ...creature, power: { op: '>=', value: 4 } }],
    ['creature with toughness less than 3', { ...creature, toughness: { op: '<', value: 3 } }],
    ['creature with a +1/+1 counter on it', { ...creature, counters: { kind: '+1/+1' } }],
    ['creature with three or more +1/+1 counters on it', { ...creature, counters: { kind: '+1/+1', cmp: { op: '>=', value: 3 } } }],
    ['creature with no +1/+1 counters on it', { ...creature, counters: { kind: '+1/+1', cmp: { op: '==', value: 0 } } }],
    ['permanent with an activated ability', { hasAbility: 'activated' }],
    ['creature named Zzz', { ...creature, name: 'Zzz' }],
    // CLOUD C5 (CR 607.2d): "the chosen type" is the type of whatever kind the linked choice chose (creature, card or land type), resolved by parser/lower/links.ts
    ['creature of the chosen type', { ...creature, chosen: { link: '$link', quality: '$chosenType' } }],
    ['creature of the chosen creature type', { ...creature, chosen: { link: '$link', quality: 'creatureType' } }],
    ['creature that shares a creature type with ~', { ...creature, sharesWith: { with: { ref: 'self' }, quality: 'creatureType' } }],
    ['creature that was dealt damage this turn', { ...creature, dealtDamageThisTurn: true }],
    ['creature that attacked this turn', { ...creature, attackedThisTurn: true }],
    ['creature an opponent controls', { ...creature, controller: 'opponent' }],
    ["creature you don't control", { ...creature, not: { controller: 'you' } }],
    ['creature your opponents control', { ...creature, controller: 'opponent' }], // one JSON form for "an opponent controls" and "your opponents control" (review)
    ['land on the battlefield', { types: ['Land'], zone: 'battlefield' }],
  ])('post-modifier "%s"', (phrase, expected) => {
    expect(one('Filter', phrase)).toEqual(expected);
  });

  it('CR 111.1: "card" means a card, not a token, and leaves the zone to the context (flag zone-unstated)', () => {
    const alts = full('Filter', 'creature card');
    expect(alts).toHaveLength(1);
    expect(alts[0]!.value).toEqual({ ...creature, isCard: true });
    expect(alts[0]!.flags).toEqual(['zone-unstated']);
    expect(full('Filter', 'creature card in your graveyard')[0]!.flags ?? []).toEqual([]);
  });

  it('CR 400.1: zones of cards come from "in"/"from"/"on" phrases', () => {
    expect(one('Filter', 'creature card in your graveyard')).toEqual({ ...creature, zone: 'graveyard', owner: 'you', isCard: true });
    expect(one('Filter', 'creature card from a graveyard')).toEqual({ ...creature, zone: 'graveyard', isCard: true });
    expect(one('Filter', 'card in your hand')).toEqual({ zone: 'hand', owner: 'you', isCard: true });
    expect(one('Filter', 'instant or sorcery card in your graveyard')).toEqual({ types: ['Instant', 'Sorcery'], zone: 'graveyard', owner: 'you', isCard: true });
  });

  it('CR 405 spells are objects on the stack; abilities too', () => {
    expect(one('Filter', 'creature spell')).toEqual({ ...creature, stackKind: 'spell', zone: 'stack' });
    expect(one('Filter', 'noncreature spell')).toEqual({ notTypes: ['Creature'], stackKind: 'spell', zone: 'stack' });
    expect(one('Filter', 'spell an opponent controls')).toEqual({ controller: 'opponent', stackKind: 'spell', zone: 'stack' });
  });

  it('a post-modifier distributes over a coordinated head: one reading, so no ambiguity (design 6.3)', () => {
    const alts = full('Filter', 'artifact or creature you control');
    expect(new Set(alts.map((a) => JSON.stringify(a.value))).size).toBe(1);
    expect(alts[0]!.value).toEqual({ types: ['Artifact', 'Creature'], controller: 'you' });
  });

  it('every prefix of a noun phrase is offered, so a template can stop before its own literal words', () => {
    const ends = runHole('Filter', toks('creatures you control'), 0, ENV).map((x) => x.end);
    expect(ends).toContain(1);
    expect(ends).toContain(3);
    expect(one('Filter', 'creatures')).toEqual(creature);
    expect(one('Filter', 'creatures you control')).toEqual({ ...creature, controller: 'you' });
  });

  it('G2: an unknown adjective, an unknown feature or a bare adjective fails the phrase (nothing is skipped)', () => {
    for (const bad of ['flurb creature', 'creature with zzz', 'red', 'creature with flying and reach', 'nonzzz creature', 'creature that zzz', 'creature in zzz', 'zzz']) {
      expect(rejects('Filter', bad), bad).toBe(true);
    }
  });

  it('contradictions have no parse: two controllers, "artifact creature or land"', () => {
    expect(rejects('Filter', 'creature you control an opponent controls')).toBe(true);
    expect(rejects('Filter', 'artifact creature or land')).toBe(true);
  });
});

describe('WP6 Obj / Objs: references (CR 109.5, 115, 608.2c, 701.x)', () => {
  it.each([
    ['~', { ref: 'self' }],
    ['it', itObj],
    ['that creature', { ref: 'bound', name: '', $anaphor: { sort: 'object', number: 'singular', head: 'creature', text: 'that creature' } }],
    ['the exiled card', { ref: 'bound', name: '', $anaphor: { sort: 'object', number: 'singular', head: 'card', participle: 'exiled', text: 'the exiled card' } }],
    ['enchanted creature', { ref: 'attachedTo' }],
    ['equipped creature', { ref: 'attachedTo' }],
    ['the top card of your library', { ref: 'topCards', player: { ref: 'you' }, count: 1 }],
  ])('Obj "%s"', (phrase, expected) => {
    expect(one('Obj', phrase)).toEqual(expected);
  });

  it.each([
    ['the top three cards of your library', { ref: 'topCards', player: { ref: 'you' }, count: 3 }],
    ['each creature', { ref: 'each', filter: creature }],
    ['all creatures', { ref: 'each', filter: creature }],
    ['all other creatures', { ref: 'each', filter: { ...creature, other: true } }],
    ['each other creature you control', { ref: 'each', filter: { ...creature, other: true, controller: 'you' } }],
    ['creatures you control', { ref: 'each', filter: { ...creature, controller: 'you' } }],
    ['other creatures you control', { ref: 'each', filter: { ...creature, other: true, controller: 'you' } }],
    ['nonland permanents', { ref: 'each', filter: { notTypes: ['Land'] } }],
    ['them', { ref: 'bound', name: '', $anaphor: { sort: 'set', number: 'plural', text: 'them' } }],
    ['those creatures', { ref: 'bound', name: '', $anaphor: { sort: 'set', number: 'plural', head: 'creature', text: 'those creatures' } }],
  ])('Objs "%s"', (phrase, expected) => {
    expect(one('Objs', phrase)).toEqual(expected);
  });

  it('a singular noun without a determiner is not a reference', () => {
    expect(rejects('Objs', 'creature')).toBe(true);
    expect(rejects('Obj', 'a creature')).toBe(true);
  });

  it('"each creature and each artifact" is a union of two sets', () => {
    expect(one('Objs', 'each creature and each artifact')).toEqual({ ref: 'union', of: [{ ref: 'each', filter: creature }, { ref: 'each', filter: { types: ['Artifact'] } }] });
  });

  it('markers are found anywhere in a value, in document order', () => {
    const v = one('Objs', 'target creature and target artifact');
    const m = findMarkers(v);
    expect(m.map((x) => x.kind)).toEqual(['target', 'target']);
    expect((m[0]!.value as { text: string }).text).toBe('target creature');
    expect((m[1]!.value as { text: string }).text).toBe('target artifact');
  });
});

describe('WP6 Player / Recipient (CR 109.5, 115.4, 506.2, 102.1)', () => {
  it.each([
    ['you', { ref: 'you' }],
    ['an opponent', { ref: 'anOpponent' }],
    ['each opponent', { ref: 'each', who: 'opponent' }],
    ['your opponents', { ref: 'each', who: 'opponent' }],
    ['each player', { ref: 'each', who: 'player' }],
    ['each other player', { ref: 'each', who: 'otherPlayer' }],
    ['the active player', { ref: 'active' }],
    ['defending player', { ref: 'defending' }],
    ['the chosen player', { ref: 'linked', link: '$link' }],
    ['that player', { ref: 'bound', name: '', $anaphor: { sort: 'player', number: 'singular', head: 'player', text: 'that player' } }],
    // FAST5X E25 (CR 109.5): "its controller" names the ability's source only when nothing else could be "it" (AnaphorInfo.selfLast)
    ['its controller', { ref: 'controllerOf', object: { ...itObj, $anaphor: { ...itObj.$anaphor, selfLast: true } } }],
    ['its owner', { ref: 'ownerOf', object: itObj }],
    ["that creature's controller", { ref: 'controllerOf', object: { ref: 'bound', name: '', $anaphor: { sort: 'object', number: 'singular', head: 'creature', text: 'that creature' } } }],
    ['the controller of target spell', { ref: 'controllerOf', object: target({ kind: 'spell', min: 1, max: 1, text: 'target spell' }) }],
  ])('Player "%s"', (phrase, expected) => {
    expect(one('Player', phrase)).toEqual(expected);
  });

  it('Recipient: "target creature or player" and "any other target" (older and newer wording)', () => {
    expect(one('Recipient', 'target creature or player')).toEqual(target({ kind: 'objectOrPlayer', filter: creature, players: { who: 'any' }, min: 1, max: 1, text: 'target creature or player' }));
    expect(one('Recipient', 'any other target')).toEqual(target({ kind: 'anyTarget', min: 1, max: 1, text: 'any other target', another: true }));
    expect(one('Recipient', 'each creature')).toEqual({ ref: 'each', filter: creature });
    expect(one('Recipient', 'it')).toEqual(itObj);
  });
});

describe('WP6 Zone and Lib (CR 400.1, 401.3)', () => {
  it.each([
    ['your graveyard', { zone: 'graveyard', owner: 'you' }],
    ['a graveyard', { zone: 'graveyard' }],
    ['the battlefield', { zone: 'battlefield' }],
    ['exile', { zone: 'exile' }],
    ['your hand', { zone: 'hand', owner: 'you' }],
    ["an opponent's hand", { zone: 'hand', owner: 'opponent' }],
    ['the command zone', { zone: 'command' }],
  ])('Zone "%s"', (phrase, expected) => {
    expect(one('Zone', phrase)).toEqual(expected);
  });
  it('Zone with an anaphoric owner', () => {
    expect(one('Zone', "its owner's library")).toEqual({ zone: 'library', owner: { ref: 'ownerOf', object: itObj } });
  });
  it('Lib: top and bottom of a library; "into your library" has no position and does not parse', () => {
    expect(one('Lib', 'on top of your library')).toEqual({ zone: 'library', owner: { ref: 'you' }, position: 'top' });
    expect(one('Lib', "on the bottom of its owner's library")).toEqual({ zone: 'library', owner: { ref: 'ownerOf', object: itObj }, position: 'bottom' });
    expect(rejects('Lib', 'into your library')).toBe(true);
  });
});
