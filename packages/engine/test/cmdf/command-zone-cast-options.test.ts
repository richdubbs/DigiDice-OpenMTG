/**
 * CMDF item 1 (Commander follow-ups): a commander cast from the command zone through the cast options that change what the spell is (actions/cast-opt/*):
 * face down (morph, disguise: CR 702.37a, 702.37c, 702.168a-b), mutate (CR 702.140a), prototype (CR 702.160a, 718.3) and more than meets the eye (CR
 * 702.162a). Each is a cast from the command zone (CR 903.8): the commander tax is an additional cost on top of the option's cost (CR 118.8, 118.9d,
 * 601.2f), the cast is counted, and a mutated commander is the merged permanent (CR 903.3c). Real fixture cards on the game path (compiled by the default
 * compiler) as the commanders of a two-player Commander game; nothing is mocked.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, getChars, isCommander, legalActions, type AbilityDef, type CardDef, type GameState } from '../../src/index';
import { castMethods } from '../../src/actions/cast';
import { compiledDefs } from '../fixtures';
import { drive, resolveTop, target } from '../m5/cr-examples/helpers';
import { dfc, lands } from '../m6/dfc/support';
import { OVER } from '../m6/mutate/support';
import { act, commanderRec, commanderScenario, find, forests, inCommand, legend, logHas, pass, tweak, untappedForests } from '../m11/rules/helpers';

const def = (name: string): CardDef => compiledDefs([name])[0]!;
const ANGEL = def('Exalted Angel'); // Morph {2}{W}{W}
const ASSAILANT = def('Alley Assailant'); // Disguise {4}{B}
const GEMRAZER = def('Gemrazer'); // Mutate {1}{G}{G}
const FLESHGORGER = def('Phyrexian Fleshgorger'); // {7}; Prototype {1}{B}{B} -- 3/3
const BOB = legend('Test Bob Commander', '{G}', ['1', '1'], ['G']);
const MTMTE = { kind: 'keyword', keyword: 'more than meets the eye', text: 'More Than Meets the Eye {1}{R}', cost: { mana: [{ kind: 'generic', amount: 1 }, { kind: 'colored', color: 'R' }] } } as unknown as AbilityDef;
const BOT = dfc(
  { name: 'Test Scout Runner', type_line: 'Legendary Artifact Creature — Robot', mana_cost: '{3}{R}', power: '3', toughness: '2', abilities: [MTMTE] },
  { name: 'Test Scout Wheels', type_line: 'Legendary Artifact — Vehicle', power: '2', toughness: '2' },
);

const castLabels = (s: GameState): string[] => legalActions(s, 'p1').filter((a) => a.kind === 'cast').map((a) => a.label);
const castOnce = (s: GameState, name: string): GameState => tweak(s, (t) => { commanderRec(t, 'p1', name).casts = 1; });
const untapped = (s: GameState, land: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && s.defs[s.objects[id]!.defId]!.name === land && !s.objects[id]!.tapped).length;
const castFromCommand = (s: GameState, name: string, method: string, answers = [] as Parameters<typeof drive>[1]): GameState =>
  drive(act(s, { type: 'cast', player: 'p1', card: inCommand(s, name), method }), answers);

describe('CMDF: face-down casts of a commander from the command zone (CR 702.37a, 702.168a, 903.8)', () => {
  it('CR 903.8: a commander cast face down from the command zone pays the tax ({3} + {2}) and is counted; the spell and the permanent are the commander', () => {
    let s = castOnce(commanderScenario({ p1Commanders: [ANGEL], p2Commanders: [BOB], p1: { battlefield: forests(5) } }), 'Exalted Angel');
    expect(castLabels(s)).toEqual(['Cast face down (morph) from the command zone']); // {4}{W}{W} face up: no white mana
    s = castFromCommand(s, 'Exalted Angel', 'morph');
    expect(untappedForests(s, 'p1')).toBe(0); // {3} (CR 702.37c) + {2} tax (CR 903.8)
    expect(commanderRec(s, 'p1', 'Exalted Angel').casts).toBe(2);
    const spell = s.objects[s.zones.stack[0]!]!;
    expect(spell.faceDown).toBe(true);
    expect(isCommander(s, spell)).toBe(true); // CR 903.3: a face-down commander is still a commander
    expect(logHas(s, /casts a face-down spell from the command zone \(commander tax \{2\}\) with morph\./, 'CR 903.8')).toBe(true);
    expect(s.log.some((l) => /Exalted Angel/.test(l.text) && !l.privateText)).toBe(false); // CR 708.5: the log never names it
    s = pass(pass(s));
    const perm = s.zones.battlefield.find((id) => s.objects[id]!.defId === ANGEL.id)!;
    expect(s.objects[perm]!.faceDown).toBe(true);
    expect([getChars(s, perm).power, getChars(s, perm).toughness]).toEqual(['2', '2']);
    expect(isCommander(s, s.objects[perm]!)).toBe(true);
  });

  it('CR 903.8: the first face-down cast from the command zone costs {3} only', () => {
    let s = commanderScenario({ p1Commanders: [ANGEL], p2Commanders: [BOB], p1: { battlefield: forests(3) } });
    s = castFromCommand(s, 'Exalted Angel', 'morph');
    expect(untappedForests(s, 'p1')).toBe(0);
    expect(commanderRec(s, 'p1', 'Exalted Angel').casts).toBe(1);
  });

  it('CR 702.168a-b, 903.8: disguise from the command zone: a face-down 2/2 with ward {2}, {3} plus the tax', () => {
    let s = castOnce(commanderScenario({ p1Commanders: [ASSAILANT], p2Commanders: [BOB], p1: { battlefield: forests(6) } }), 'Alley Assailant');
    expect(castLabels(s)).toContain('Cast face down (disguise) from the command zone');
    s = castFromCommand(s, 'Alley Assailant', 'disguise');
    expect(untappedForests(s, 'p1')).toBe(1);
    expect(s.objects[s.zones.stack[0]!]!.faceDownInfo).toEqual({ by: 'disguise', profile: 'ward2' });
    expect(commanderRec(s, 'p1', 'Alley Assailant').casts).toBe(2);
  });

  it('CR 903.8, 601.2f-h: not offered when the tax makes it unpayable; never offered for another player\'s commander', () => {
    const s = castOnce(commanderScenario({ p1Commanders: [ANGEL], p2Commanders: [ASSAILANT], p1: { battlefield: forests(4) } }), 'Exalted Angel');
    expect(castLabels(s)).toEqual([]); // {3} + {2} with four Forests
    expect(applyAction(s, { type: 'cast', player: 'p1', card: inCommand(s, 'Exalted Angel'), method: 'morph' }).error).toBeDefined();
    expect(applyAction(s, { type: 'cast', player: 'p1', card: inCommand(s, 'Alley Assailant'), method: 'disguise' }).error?.rules).toContain('CR 601.3');
  });
});

describe('CMDF: mutate from the command zone (CR 702.140a, 903.3c, 903.8)', () => {
  it('CR 903.3c: a commander mutated onto a creature from the command zone pays {1}{G}{G} + {2}; the merged permanent is the commander', () => {
    let s = castOnce(commanderScenario({ p1Commanders: [GEMRAZER], p2Commanders: [BOB], cards: ['Llanowar Elves'], p1: { battlefield: [...forests(5), 'Llanowar Elves'] } }), 'Gemrazer');
    expect(castLabels(s)).toContain('Cast Gemrazer (mutate) from the command zone');
    const elves = find(s, 'Llanowar Elves', 'battlefield');
    s = castFromCommand(s, 'Gemrazer', 'mutate', [target(elves)]);
    expect(untappedForests(s, 'p1')).toBe(0); // {1}{G}{G} + {2}
    expect(commanderRec(s, 'p1', 'Gemrazer').casts).toBe(2);
    expect(s.objects[s.zones.stack[0]!]!.stack?.costsPaid.alternative).toBe('mutate');
    s = resolveTop(s, [OVER]);
    const merged = s.objects[elves]!;
    expect(merged.components?.map((c) => c.defId)).toEqual([GEMRAZER.id, 'Llanowar Elves']);
    expect(isCommander(s, merged)).toBe(true); // CR 903.3c
    expect(s.zones.command.some((id) => s.objects[id]!.defId === GEMRAZER.id)).toBe(false);
  });
});

describe('CMDF: prototype from the command zone (CR 702.160a, 718.3, 903.8)', () => {
  it('CR 718.3a-b, 903.8: prototyped from the command zone: {1}{B}{B} + {2}, a black 3/3, counted', () => {
    let s = castOnce(commanderScenario({ p1Commanders: [FLESHGORGER], p2Commanders: [BOB], cards: ['Swamp'], p1: { battlefield: lands('Swamp', 5) } }), 'Phyrexian Fleshgorger');
    expect(castLabels(s)).toEqual(['Cast Phyrexian Fleshgorger (prototype) from the command zone']); // {7} + {2} unpayable with five Swamps
    s = castFromCommand(s, 'Phyrexian Fleshgorger', 'prototype');
    expect(untapped(s, 'Swamp')).toBe(0);
    const spell = s.zones.stack[0]!;
    expect(s.objects[spell]!.prototyped).toBe(true);
    expect([getChars(s, spell).power, getChars(s, spell).manaValue, getChars(s, spell).colors]).toEqual(['3', 3, ['B']]);
    expect(commanderRec(s, 'p1', 'Phyrexian Fleshgorger').casts).toBe(2);
  });
});

describe('CMDF: more than meets the eye from the command zone (CR 702.162a, 903.8)', () => {
  it('CR 702.162a, 903.8: cast converted from the command zone for {1}{R} + {2}; it resolves back face up and is the commander', () => {
    let s = castOnce(commanderScenario({ p1Commanders: [{ ...BOT, colorIdentity: ['R'] }], p2Commanders: [BOB], cards: ['Mountain'], p1: { battlefield: lands('Mountain', 4) } }), 'Test Scout Runner // Test Scout Wheels');
    const id = inCommand(s, 'Test Scout Runner // Test Scout Wheels');
    expect(castMethods(s, id, 0)).toContain('more than meets the eye');
    s = castFromCommand(s, 'Test Scout Runner // Test Scout Wheels', 'more than meets the eye');
    expect(untapped(s, 'Mountain')).toBe(0);
    expect(getChars(s, s.zones.stack[0]!).name).toBe('Test Scout Wheels');
    expect(commanderRec(s, 'p1', 'Test Scout Runner // Test Scout Wheels').casts).toBe(2);
    s = pass(pass(s));
    const perm = s.zones.battlefield.find((x) => s.objects[x]!.defId === BOT.id)!;
    expect(s.objects[perm]!.face).toBe(1);
    expect(isCommander(s, s.objects[perm]!)).toBe(true);
  });
});
