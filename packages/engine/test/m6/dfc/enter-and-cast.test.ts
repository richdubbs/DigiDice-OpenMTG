/**
 * M6-4 (m6 design 3.6): entering transformed (CR 712.14a, 712.13a, 304.4, 616.1d: `enters.transformed`, `modify.destination.transformed`) and casting a
 * double-faced card transformed (disturb, CR 702.146, 712.11a, 712.8c; actions/cast-opt/back-face.ts, core/resolve-parts/transformed.ts).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, ENGINE_CAPABILITIES, getChars, legalActions, type AbilityDef, type GameState } from '../../../src/index';
import { castMethods } from '../../../src/actions/cast';
import { act, cast, dfc, drive, equivalent, find, instantOnTarget, lands, looks, onField, resolveTop, scenario, target } from './support';

const DELVER = 'Delver of Secrets // Insectile Aberration';
const BEGGAR = 'Beloved Beggar // Generous Soul';

/** "If a creature would enter the battlefield under your control, it enters transformed instead." (a foreign `enters.transformed` replacement) */
const MOONVEIL = equivalent({ name: 'Test Moonveil', type_line: 'Enchantment' }, [{
  kind: 'static', text: 'Creatures you control enter transformed.', zone: ['battlefield'],
  effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { types: ['Creature'], controller: 'you' }, to: 'battlefield' }, body: { b: 'enters', transformed: true } }],
} as AbilityDef]);
/** A creature whose back face is a sorcery (CR 712.13a). */
const BEARER = dfc({ name: 'Test Lantern Bearer', type_line: 'Creature — Human', mana_cost: '{0}', power: '1', toughness: '1' }, { name: 'Test Lantern Rite', type_line: 'Sorcery' });
/** "Return each card named <name> from your graveyard to the battlefield transformed." */
const returnTransformed = (name: string, cardName: string) => equivalent({ name, type_line: 'Sorcery', mana_cost: '{0}' }, [{
  kind: 'spell', text: `Return each card named ${cardName} from your graveyard to the battlefield transformed.`,
  effect: { targets: [], steps: [{ op: 'move', what: { ref: 'each', filter: { name: cardName, zone: 'graveyard', owner: 'you' } }, to: { zone: 'battlefield', controller: { ref: 'you' }, transformed: true } }] },
} as AbilityDef]);
const DOOM = instantOnTarget('Test Doom', 'Destroy target creature.', (t) => [{ op: 'destroy', what: t }]);
/** "If this creature would die, return it to the battlefield transformed instead." (a `modify.destination.transformed` self replacement) */
const PHOENIX = dfc(
  {
    name: 'Test Ember Chick', type_line: 'Creature — Bird', mana_cost: '{0}', power: '1', toughness: '1',
    abilities: [{
      kind: 'static', text: 'If this creature would die, return it to the battlefield transformed instead.', zone: ['battlefield'],
      effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, from: 'battlefield', to: 'graveyard' }, body: { b: 'modify', destination: { zone: 'battlefield', controller: 'owner', transformed: true } } }],
    } as AbilityDef],
  },
  { name: 'Test Ember Phoenix', type_line: 'Creature — Phoenix', power: '4', toughness: '4' },
);

describe('CR 712.14a, 616.1d: entering transformed', () => {
  it('a foreign enters-transformed replacement: Delver of Secrets enters as Insectile Aberration; Grizzly Bears (not double-faced) enters as itself', () => {
    let s = scenario([DELVER, 'Grizzly Bears', 'Island', 'Forest'], { p1: { hand: [DELVER, 'Grizzly Bears'], battlefield: ['Test Moonveil', 'Island', 'Forest', 'Forest'] }, defs: [MOONVEIL] });
    s = resolveTop(cast(s, DELVER));
    expect(looks(s, onField(s, DELVER))).toMatchObject({ name: 'Insectile Aberration', face: 1 });
    s = resolveTop(cast(s, 'Grizzly Bears'));
    expect(looks(s, onField(s, 'Grizzly Bears'))).toMatchObject({ name: 'Grizzly Bears', face: 0 });
    expect(ENGINE_CAPABILITIES.has('body:enters.transformed')).toBe(true);
  });

  it('CR 712.13a: a resolving double-faced spell told to enter transformed whose back face is a sorcery goes to its owner\'s graveyard', () => {
    let s = scenario([], { p1: { hand: ['Test Lantern Bearer // Test Lantern Rite'], battlefield: ['Test Moonveil'] }, defs: [MOONVEIL, BEARER] });
    s = resolveTop(cast(s, 'Test Lantern Bearer // Test Lantern Rite'));
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === BEARER.id)).toBe(false);
    expect(s.zones.graveyard.p1!.some((id) => s.objects[id]!.defId === BEARER.id)).toBe(true);
    expect(s.log.some((l) => l.rules?.includes('CR 712.13a'))).toBe(true);
  });

  it('CR 712.14a: "return it to the battlefield transformed": a double-faced card enters back face up; a card that isn\'t double-faced stays in its zone', () => {
    let s = scenario([DELVER, 'Grizzly Bears'], {
      p1: { graveyard: [DELVER, 'Grizzly Bears'], hand: ['Test Raise Delver', 'Test Raise Bears'] }, defs: [returnTransformed('Test Raise Delver', 'Delver of Secrets'), returnTransformed('Test Raise Bears', 'Grizzly Bears')],
    });
    s = resolveTop(cast(s, 'Test Raise Delver'));
    expect(looks(s, onField(s, DELVER))).toMatchObject({ name: 'Insectile Aberration', face: 1 });
    s = resolveTop(cast(s, 'Test Raise Bears'));
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Grizzly Bears')).toBe(false);
    expect(find(s, 'Grizzly Bears', 'graveyard')).toBeDefined();
  });

  it('modify.destination.transformed: "if this creature would die, return it to the battlefield transformed instead"', () => {
    let s = scenario([], { p1: { hand: ['Test Doom'], battlefield: ['Test Ember Chick // Test Ember Phoenix'] }, defs: [PHOENIX, DOOM] });
    const chick = onField(s, 'Test Ember Chick // Test Ember Phoenix');
    s = resolveTop(cast(s, 'Test Doom', [target(chick)]));
    const now = onField(s, 'Test Ember Chick // Test Ember Phoenix');
    expect(now).not.toBe(chick); // a new object (CR 400.7)
    expect(looks(s, now)).toMatchObject({ name: 'Test Ember Phoenix', pt: [4, 4], face: 1 });
    expect(ENGINE_CAPABILITIES.has('body:modify.destination.transformed')).toBe(true);
  });
});

describe('CR 702.146, 712.11a, 712.8c: disturb casts the card transformed from the graveyard', () => {
  const board = (): GameState => scenario([BEGGAR, 'Plains'], { p1: { graveyard: [BEGGAR], hand: [BEGGAR, 'Test Doom'], battlefield: lands('Plains', 6) }, defs: [DOOM] });

  it('offered from the graveyard only (not from the hand); the spell is the back face with the front face\'s mana value', () => {
    let s = board();
    const inYard = find(s, BEGGAR, 'graveyard');
    const inHand = find(s, BEGGAR, 'hand');
    expect(castMethods(s, inYard, 0)).toContain('disturb');
    expect(castMethods(s, inHand, 0)).not.toContain('disturb');
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && (a.action as { card: string; method?: string }).card === inYard && (a.action as { method?: string }).method === 'disturb')).toBe(true);
    expect(applyAction(s, { type: 'cast', player: 'p1', card: inHand, method: 'disturb' }).error).toBeDefined();
    s = drive(act(s, { type: 'cast', player: 'p1', card: inYard, method: 'disturb' }));
    const spell = s.zones.stack[0]!;
    const c = getChars(s, spell);
    expect([c.name, c.manaValue, c.power, c.toughness]).toEqual(['Generous Soul', 2, '4', '4']); // CR 712.8c: Beloved Beggar's {1}{W}
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped)).toHaveLength(6); // {4}{W}{W}
  });

  it('CR 702.146b: it resolves with its back face up; Generous Soul\'s own replacement exiles it when it would die', () => {
    let s = board();
    s = resolveTop(drive(act(s, { type: 'cast', player: 'p1', card: find(s, BEGGAR, 'graveyard'), method: 'disturb' })));
    const soul = onField(s, BEGGAR);
    expect(looks(s, soul)).toMatchObject({ name: 'Generous Soul', pt: [4, 4], face: 1 });
    expect(getChars(s, soul).keywords.map((k) => k.keyword)).toEqual(expect.arrayContaining(['flying', 'vigilance']));
    s = resolveTop(cast(s, 'Test Doom', [target(soul)]));
    expect(find(s, BEGGAR, 'exile')).toBeDefined();
    expect(ENGINE_CAPABILITIES.has('keyword:disturb') && ENGINE_CAPABILITIES.has('keyword:more than meets the eye')).toBe(true);
  });
});

describe('CR 702.162a: more than meets the eye casts the card converted from the hand', () => {
  const mtmte = { kind: 'keyword', keyword: 'more than meets the eye', text: 'More Than Meets the Eye {1}{R}', cost: { mana: [{ kind: 'generic', amount: 1 }, { kind: 'colored', color: 'R' }] } } as unknown as AbilityDef;
  const BOT = dfc(
    { name: 'Test Scout Runner', type_line: 'Artifact Creature — Robot', mana_cost: '{3}{R}', power: '3', toughness: '2', abilities: [mtmte] },
    { name: 'Test Scout Wheels', type_line: 'Artifact — Vehicle', power: '2', toughness: '2' },
  );
  it('the spell is the back face (with the front face\'s mana value) and resolves with it up; the method is not offered from the graveyard', () => {
    let s = scenario(['Mountain'], { p1: { hand: ['Test Scout Runner // Test Scout Wheels'], graveyard: ['Test Scout Runner // Test Scout Wheels'], battlefield: lands('Mountain', 2) }, defs: [BOT] });
    const card = find(s, 'Test Scout Runner // Test Scout Wheels', 'hand');
    expect(castMethods(s, card, 0)).toContain('more than meets the eye');
    expect(castMethods(s, find(s, 'Test Scout Runner // Test Scout Wheels', 'graveyard'), 0)).not.toContain('more than meets the eye');
    s = drive(act(s, { type: 'cast', player: 'p1', card, method: 'more than meets the eye' }));
    const c = getChars(s, s.zones.stack[0]!);
    expect([c.name, c.manaValue]).toEqual(['Test Scout Wheels', 4]); // CR 712.8c
    s = resolveTop(s);
    expect(looks(s, onField(s, 'Test Scout Runner // Test Scout Wheels'))).toMatchObject({ name: 'Test Scout Wheels', face: 1 });
  });
});
