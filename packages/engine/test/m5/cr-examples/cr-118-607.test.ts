/**
 * WP29: the worked examples of CR 118.12 (costs paid on resolution, "If you do / don't") and CR 607 (linked abilities), on real fixture cards compiled by the
 * default compiler, driven through applyAction; nothing is mocked.
 *
 * Equivalent cards: Standstill's "If you do, each of that player's opponents draws three cards" has no template, so Mystery Key ("When equipped creature
 * deals combat damage to a player, sacrifice this Equipment. If you do, draw three cards.") stands in for it: the same sacrifice-as-a-cost shape with the same
 * reward. Gather Specimens and Dermoplasm (118.12's second example) need a foreign replacement and morph (milestone 6).
 * Not run here: 607.5 and 607.5a (gaining a pair of linked abilities, copy effects: milestone 6).
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { advanceTo, answer, find, inGraveyard, onBattlefield, pass, runCombat, scenario } from '../helpers';
import { activate, cast, countOn, drive, gamePath, handSize, resolveAll, resolveTop, stackNames, target } from './helpers';

describe('CR 118.12: "[Do something]. If you do, [effect]" checks whether the cost was paid', () => {
  /** Grizzly Bears equipped with Mystery Key (Equip {1}) deals combat damage to Bob: the Key's ability is on the stack and Alice has priority. */
  const keyTriggers = (): GameState => {
    const s0 = scenario(['Mystery Key', 'Grizzly Bears', 'Disenchant', 'Island', 'Plains'], {
      p1: { battlefield: ['Mystery Key', 'Grizzly Bears', 'Island'] }, p2: { hand: ['Disenchant'], battlefield: ['Plains', 'Plains'] },
    });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = runCombat(resolveTop(activate(s0, find(s0, 'Mystery Key', 'battlefield'), [target(bears)], /Equip/)), { attack: [[bears]], until: 'combatDamage' });
    expect(stackNames(s)).toEqual(['ability of Mystery Key']);
    return s;
  };

  it('the Equipment is sacrificed as the ability resolves, so its controller draws three cards', () => {
    const s0 = keyTriggers();
    const s = resolveTop(s0);
    expect(inGraveyard(s, 'Mystery Key', 'p1')).toBe(true);
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') + 3);
  });

  it('CR 118.12 example (Standstill): the Equipment is destroyed in response (Disenchant), so the sacrifice can\'t be paid and nobody draws', () => {
    const s0 = keyTriggers();
    let s = pass(s0);
    s = resolveTop(cast(s, 'Disenchant', [target(find(s, 'Mystery Key', 'battlefield'))], 'p2'));
    expect(inGraveyard(s, 'Mystery Key', 'p1')).toBe(true);
    s = resolveTop(s);
    expect(s.zones.stack).toEqual([]);
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1'));
  });
});

describe('CR 118.12, 608.2d: "pay ... If you don\'t, you lose the game" (Pact of the Titan)', () => {
  const pactUpkeep = (lands: number): GameState => {
    const s0 = scenario(['Pact of the Titan', 'Mountain'], { p1: { hand: ['Pact of the Titan'], battlefield: Array(lands).fill('Mountain') } });
    const s = resolveTop(cast(s0, 'Pact of the Titan'));
    expect(countOn(s, s.zones.battlefield.map((id) => s.defs[s.objects[id]!.defId]!.name).find((n) => /Giant/.test(n)) ?? '?')).toBe(1);
    return advanceTo(s, 3, 'upkeep');
  };

  it('with five untapped Mountains the player pays {4}{R} at the next upkeep and does not lose', () => {
    let s = pactUpkeep(5);
    expect(stackNames(s)).toEqual(['ability of Pact of the Titan']);
    s = pass(pass(s));
    // the payer chooses whether to pay (CR 118.12); paying taps the five Mountains
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p1', rules: ['CR 118.12a'] });
    s = drive(answer(s, { kind: 'yesNo', yes: true }));
    expect(s.result).toBeFalsy();
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped)).toHaveLength(5);
  });

  it('CR 118.12: choosing not to pay makes "If you don\'t" true: the player loses the game', () => {
    let s = pass(pass(pactUpkeep(5)));
    s = answer(s, { kind: 'yesNo', yes: false });
    expect(s.result).toMatchObject({ winner: 'p2' });
  });

  it('CR 608.2d: with no mana the player can\'t choose to pay (an impossible choice is not offered): the player loses the game', () => {
    const s = pass(pass(pactUpkeep(0)));
    expect(s.result).toMatchObject({ winner: 'p2' });
  });
});

describe('CR 118.12a: "[Do something] unless [a player does something else]": that player decides first', () => {
  const board = () => scenario(['Rhystic Study', 'Lightning Bolt', 'Mountain', 'Island'], {
    p1: { battlefield: ['Rhystic Study'] }, p2: { hand: ['Lightning Bolt'], battlefield: ['Mountain', 'Mountain'] },
  });
  /** Bob casts Lightning Bolt at Alice; Rhystic Study triggers and resolves first; returns the first decision of its resolution. */
  const studyResolves = (): GameState => {
    let s = pass(board()); // Alice passes priority to Bob in her main phase
    s = cast(s, 'Lightning Bolt', [target('p1')], 'p2');
    expect(stackNames(s)).toEqual(['Lightning Bolt', 'ability of Rhystic Study']);
    return pass(pass(s));
  };

  it('Rhystic Study: the opponent is asked first whether to pay {1}; when they pay, its controller is never asked and draws nothing', () => {
    let s = studyResolves();
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p2' });
    const hand = handSize(s, 'p1');
    s = drive(answer(s, { kind: 'yesNo', yes: true })); // Bob pays {1} with his second Mountain
    expect(s.pending?.kind).toBe('priority');
    expect(handSize(s, 'p1')).toBe(hand);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2' && s.objects[id]!.tapped)).toHaveLength(2);
  });

  it('Rhystic Study: when the opponent does not pay, its controller may draw a card', () => {
    let s = studyResolves();
    const hand = handSize(s, 'p1');
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p2' });
    s = answer(s, { kind: 'yesNo', yes: false });
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p1' });
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(handSize(s, 'p1')).toBe(hand + 1);
  });
});

describe('CR 607.2a: an ability that refers to cards exiled "with" another ability is linked to it', () => {
  const board = () => scenario(['Journey to Nowhere', 'Grizzly Bears', 'Hill Giant', 'Disenchant', 'Plains'], {
    p1: { hand: ['Journey to Nowhere', 'Journey to Nowhere', 'Disenchant'], battlefield: Array(6).fill('Plains') }, p2: { battlefield: ['Grizzly Bears', 'Hill Giant'] },
  });

  it('two Journeys to Nowhere each exile a creature; destroying one returns only the card its own first ability exiled', () => {
    const s0 = board();
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const giant = find(s0, 'Hill Giant', 'battlefield');
    let s = resolveTop(cast(s0, 'Journey to Nowhere'));
    s = resolveTop(drive(s, [target(bears)]));
    const first = find(s, 'Journey to Nowhere', 'battlefield');
    s = resolveTop(cast(s, 'Journey to Nowhere'));
    s = resolveTop(drive(s, [target(giant)]));
    expect(onBattlefield(s, 'Grizzly Bears')).toBe(false);
    expect(onBattlefield(s, 'Hill Giant')).toBe(false);
    s = resolveTop(cast(s, 'Disenchant', [target(first)]));
    s = resolveAll(s);
    expect(onBattlefield(s, 'Grizzly Bears', 'p2')).toBe(true);
    expect(onBattlefield(s, 'Hill Giant')).toBe(false);
  });

  it('Oblivion Ring destroyed while its enters ability is on the stack: the leaves ability returns nothing, then the enters ability exiles its target for good', () => {
    const s0 = scenario(['Oblivion Ring', 'Grizzly Bears', 'Disenchant', 'Plains'], {
      p1: { hand: ['Oblivion Ring'], battlefield: Array(3).fill('Plains') }, p2: { hand: ['Disenchant'], battlefield: ['Grizzly Bears', 'Plains', 'Plains'] },
    });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = resolveTop(cast(s0, 'Oblivion Ring'));
    s = drive(s, [target(bears)]);
    expect(stackNames(s)).toEqual(['ability of Oblivion Ring']);
    s = pass(s);
    s = resolveTop(cast(s, 'Disenchant', [target(find(s, 'Oblivion Ring', 'battlefield'))], 'p2'));
    expect(stackNames(s)).toEqual(['ability of Oblivion Ring', 'ability of Oblivion Ring']); // enters below, leaves on top
    s = resolveAll(s);
    expect(onBattlefield(s, 'Grizzly Bears')).toBe(false);
    expect(s.zones.exile.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Grizzly Bears')).toBe(true);
  });
});

describe('CR 607.2i, 607.4: linked abilities the parser does not automate yet stay visible', () => {
  it('CR 607.4 example (Paradise Plume): the color choice is automated, and so are both abilities linked to it: the mana ability (FAST2 T7 eff.t7.mana.chosen, CR 607.2d) and, since CLOUD C5, the trigger (its spell filter reads the link "color", CR 607.2d)', () => {
    const def = gamePath('Paradise Plume');
    expect(def.automation.level).toBe('full');
    expect(def.automation.unsupported).toEqual([]);
    expect(JSON.stringify(def.faces[0]!.abilities[1])).toContain('"chosen":{"link":"color","quality":"color"}');
  });

  it('CR 607.2i example (Stormscape Battlemage): since M6-5 "Kicker {W} and/or {2}{B}" is two kicker abilities (CR 702.33b); since p2-counters-state-1 the abilities linked to each cost ("if it was kicked with its {W} kicker", CR 702.33f) read that one kicker', () => {
    const def = gamePath('Stormscape Battlemage');
    expect(def.automation.level).toBe('full');
    expect(def.faces[0]!.abilities.slice(0, 2)).toMatchObject([{ kind: 'keyword', keyword: 'kicker', text: 'Kicker {W}' }, { kind: 'keyword', keyword: 'kicker', text: 'Kicker {2}{B}' }]);
    expect(def.faces[0]!.abilities.slice(2, 4)).toMatchObject([{ interveningIf: { cond: 'wasCast', kicked: 'kicker' } }, { interveningIf: { cond: 'wasCast', kicked: 'kicker:2' } }]);
    expect(def.automation.unsupported).toEqual([]);
  });
});
