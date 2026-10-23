/**
 * WP11: "as it enters" replacement effects of a permanent's own static abilities (CR 614.1c-d, 614.12, design 8.5 and 3.8): Kavu Titan with and without kicker,
 * shock lands, check lands, choices made first (CR 614.12a), entering under another player's control, attached, or with abilities. They apply however the
 * permanent enters: resolving (CR 608.3), played as a land (CR 305.1), or moved by an effect or by hand.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, GameState } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { moveObject } from '../../../src/core/zones';
import { applyManualOps } from '../../../src/core/manual';
import { act, answer, find, lifeOf, logHas, passBoth, scenario } from '../helpers';
import { drive } from '../announce/support';
import { entersSelf, eventsOf, permanent, run, staticAbility, withAbilities } from './support';

/** Kavu Titan exactly as design section 13.4 writes it. */
const KAVU: AbilityDef[] = [
  { kind: 'keyword', text: 'Kicker {2}{G}', keyword: 'kicker', cost: { mana: [{ kind: 'generic', amount: 2 }, { kind: 'colored', color: 'G' }] } },
  {
    kind: 'static',
    text: 'If ~ was kicked, it enters with three +1/+1 counters on it and with trample.',
    condition: { cond: 'wasCast', kicked: true },
    effects: [
      { s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, body: { b: 'enters', counters: [{ kind: '+1/+1', count: 3 }] } },
      { s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: 6, add: [{ kind: 'keyword', text: 'Trample', keyword: 'trample' }] }] },
    ],
  },
];

const kavuBoard = (): GameState =>
  scenario(['Forest'], { p1: { hand: ['Kavu Titan'], battlefield: Array(5).fill('Forest') as string[] }, defs: [withAbilities('Kavu Titan', KAVU)] });

const castKavu = (kick: boolean): GameState => {
  let s = act(kavuBoard(), { type: 'cast', player: 'p1', card: find(kavuBoard(), 'Kavu Titan', 'hand') });
  s = drive(s, [{ kind: 'yesNo', yes: kick }]);
  return passBoth(s);
};

describe('CR 614.1c, 400.7d: Kavu Titan with and without kicker (design 13.4, ruling 15.3 #3)', () => {
  it('kicked: it enters with three +1/+1 counters (before any state-based action) and has trample (layer 6, read from the cast record)', () => {
    const s = castKavu(true);
    const kavu = find(s, 'Kavu Titan', 'battlefield');
    expect(s.objects[kavu]!.counters['+1/+1']).toBe(3);
    const c = getChars(s, kavu);
    expect([c.power, c.toughness]).toEqual(['5', '5']);
    expect(c.keywords.some((k) => k.keyword === 'trample')).toBe(true);
    expect(logHas(s, /Kavu Titan enters with 3 \+1\/\+1 counters/, 'CR 614.1c')).toBe(true);
  });

  it('not kicked: the condition is false, so it enters as a 2/2 without trample', () => {
    const s = castKavu(false);
    const kavu = find(s, 'Kavu Titan', 'battlefield');
    expect(s.objects[kavu]!.counters['+1/+1']).toBeUndefined();
    const c = getChars(s, kavu);
    expect([c.power, c.toughness]).toEqual(['2', '2']);
    expect(c.keywords.some((k) => k.keyword === 'trample')).toBe(false);
  });

  it('CR 702.33d: put onto the battlefield without being cast it was not kicked (no counters)', () => {
    const s0 = scenario([], { p1: { graveyard: ['Kavu Titan'] }, defs: [withAbilities('Kavu Titan', KAVU)] });
    const r = run(s0, (g) => moveObject(g, find(s0, 'Kavu Titan', 'graveyard'), 'battlefield', { controller: 'p1' }));
    expect(r.g.s.objects[r.result!]!.counters['+1/+1']).toBeUndefined();
  });
});

/** A shock land (Hallowed Fountain, design 13.6) as a synthetic card: the dual basic types give the mana abilities (CR 305.6). */
const shockland = permanent('Test Fountain', 'Land — Plains Island', [
  staticAbility('As ~ enters, you may pay 2 life. If you don\'t, it enters tapped.', [entersSelf({ tappedUnlessPay: { other: [{ kind: 'payLife', amount: 2 }] } })], { zone: ['stack', 'battlefield'] }),
]);
/** A check land (Glacial Fortress, design 13.6). */
const checkland = permanent('Test Fortress', 'Land', [
  staticAbility('~ enters tapped unless you control a Plains or an Island.', [entersSelf({ tapped: true, tappedUnless: { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Plains', 'Island'], controller: 'you' } } } })], { zone: ['stack', 'battlefield'] }),
]);

const playLand = (s: GameState, name: string): GameState => act(s, { type: 'playLand', player: 'p1', card: find(s, name, 'hand') });

describe('CR 614.1c, 614.12: shock lands and check lands (design 13.6)', () => {
  it('a shock land played: its controller is asked (CR 614.12a) while the land is still in the hand; paying 2 life, it enters untapped', () => {
    const s0 = scenario([], { p1: { hand: ['Test Fountain'] }, defs: [shockland] });
    let s = playLand(s0, 'Test Fountain');
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p1', prompt: expect.stringContaining('pay 2 life') });
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Fountain')).toBe(false); // the choice comes before it enters
    s = answer(s, { kind: 'yesNo', yes: true });
    const land = find(s, 'Test Fountain', 'battlefield');
    expect(s.objects[land]!.tapped).toBe(false);
    expect(lifeOf(s, 'p1')).toBe(18);
  });

  it('declining: it enters tapped and no life is paid; entering tapped is not "becomes tapped" (CR 603.2e: no tapped event)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Fountain'] }, defs: [shockland] });
    const r = run(s0, (g) => moveObject(g, find(s0, 'Test Fountain', 'hand'), 'battlefield', { controller: 'p1', cause: 'play land' }), [{ kind: 'yesNo', yes: false }]);
    expect(r.g.s.objects[r.result!]!.tapped).toBe(true);
    expect(lifeOf(r.g.s, 'p1')).toBe(20);
    expect(eventsOf(r.g, 'tapped')).toEqual([]);
  });

  it('CR 119.4, 119.8: a player who can\'t pay the life is not asked; the land enters tapped', () => {
    const s0 = scenario([], { p1: { hand: ['Test Fountain'] }, defs: [shockland], life: 1 });
    const s = playLand(s0, 'Test Fountain');
    expect(s.pending?.kind).toBe('priority');
    expect(s.objects[find(s, 'Test Fountain', 'battlefield')]!.tapped).toBe(true);
  });

  it('a check land enters tapped unless its controller controls a Plains or an Island', () => {
    const without = playLand(scenario(['Mountain'], { p1: { hand: ['Test Fortress'], battlefield: ['Mountain'] }, defs: [checkland] }), 'Test Fortress');
    expect(without.objects[find(without, 'Test Fortress', 'battlefield')]!.tapped).toBe(true);
    const withIsland = playLand(scenario(['Island'], { p1: { hand: ['Test Fortress'], battlefield: ['Island'] }, defs: [checkland] }), 'Test Fortress');
    expect(withIsland.objects[find(withIsland, 'Test Fortress', 'battlefield')]!.tapped).toBe(false);
  });

  it('"you" is the player it enters under: an opponent\'s Island does not count', () => {
    const s = scenario(['Island'], { p1: { hand: ['Test Fortress'] }, p2: { battlefield: ['Island'] }, defs: [checkland] });
    const after = playLand(s, 'Test Fortress');
    expect(after.objects[find(after, 'Test Fortress', 'battlefield')]!.tapped).toBe(true);
  });

  it('design 3.8, CR 118.12: a mana cost "you may pay" as it enters is paid through a payCost decision with origin optional (the player chooses how)', () => {
    const vault = permanent('Test Vault', 'Land', [
      staticAbility('As ~ enters, you may pay {1}. If you don\'t, it enters tapped.', [entersSelf({ tappedUnlessPay: { mana: [{ kind: 'generic', amount: 1 }] } })], { zone: ['stack', 'battlefield'] }),
    ]);
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Vault'], battlefield: ['Plains'] }, defs: [vault] });
    let s = playLand(s0, 'Test Vault');
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(s.pending).toMatchObject({ kind: 'payCost', player: 'p1', origin: 'optional' });
    s = answer(s, { kind: 'payCost', auto: true });
    expect(s.objects[find(s, 'Test Vault', 'battlefield')]!.tapped).toBe(false);
    expect(s.objects[find(s, 'Plains', 'battlefield')]!.tapped).toBe(true);
  });
});

describe('CR 614.12a, 607.2d: choices are made before the permanent enters', () => {
  const chooser = permanent('Test Banner', 'Artifact', [
    staticAbility('As ~ enters, choose a color.', [entersSelf({ choose: [{ what: 'color', link: 'color' }] })], { zone: ['stack', 'battlefield'] }),
  ], { cost: '{0}' });

  it('the color is chosen while the spell is still on the stack and lands in the new object\'s link store', () => {
    const s0 = scenario([], { p1: { hand: ['Test Banner'] }, defs: [chooser] });
    let s = passBoth(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Banner', 'hand') }));
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    expect(s.pending).toMatchObject({ kind: 'chooseColor', player: 'p1' });
    expect(s.zones.stack.length).toBe(1); // still a spell: nothing has entered yet
    s = answer(s, { kind: 'chooseColor', color: 'R' });
    const banner = find(s, 'Test Banner', 'battlefield');
    expect(s.objects[banner]!.links).toEqual({ color: { values: ['R'] } });
  });

  it('a creature type is chosen from the closed list (chooseName)', () => {
    const s0 = scenario([], { p1: { graveyard: ['Test Idol'] }, defs: [permanent('Test Idol', 'Artifact', [staticAbility('As ~ enters, choose a creature type.', [entersSelf({ choose: [{ what: 'creatureType', link: 't' }] })])])] });
    const id = find(s0, 'Test Idol', 'graveyard');
    const first = run(s0, (g) => moveObject(g, id, 'battlefield', { controller: 'p1' }));
    expect(first.need).toMatchObject({ kind: 'chooseName', what: 'creatureType', options: expect.arrayContaining(['Goblin', 'Elf']) });
    const r = run(s0, (g) => moveObject(g, id, 'battlefield', { controller: 'p1' }), [{ kind: 'chooseName', name: 'Goblin' }]);
    expect(r.g.s.objects[r.result!]!.links).toEqual({ t: { values: ['Goblin'] } });
  });
});

describe('CR 614.1c: other "as it enters" bodies (under, attached, with abilities)', () => {
  it('CR 616.1b, 110.2: "enters under the control of an opponent"', () => {
    const gift = permanent('Test Gift', 'Creature — Test', [staticAbility('~ enters under the control of an opponent of your choice.', [entersSelf({ under: { ref: 'anOpponent' } })])], { pt: ['1', '1'] });
    const s0 = scenario([], { p1: { graveyard: ['Test Gift'] }, defs: [gift] });
    const r = run(s0, (g) => moveObject(g, find(s0, 'Test Gift', 'graveyard'), 'battlefield', { controller: 'p1' }));
    expect(r.g.s.objects[r.result!]!.controller).toBe('p2');
  });

  it('CR 303.4f: an Aura that enters attached to a creature you control (the only one there)', () => {
    const aura = withAbilities('Rancor', [
      { kind: 'keyword', text: 'Enchant creature', keyword: 'enchant', filter: { types: ['Creature'] } },
      staticAbility('~ enters attached to a creature you control.', [entersSelf({ attachTo: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } })], { zone: ['graveyard', 'battlefield'] }),
    ]);
    const s0 = scenario(['Grizzly Bears'], { p1: { graveyard: ['Rancor'], battlefield: ['Grizzly Bears'] }, defs: [aura] });
    const r = run(s0, (g) => moveObject(g, find(s0, 'Rancor', 'graveyard'), 'battlefield', { controller: 'p1' }));
    expect(r.g.s.objects[r.result!]!.attachedTo).toBe(find(s0, 'Grizzly Bears', 'battlefield'));
    expect(eventsOf(r.g, 'attached')).toEqual([{ type: 'attached', objectId: r.result, to: find(s0, 'Grizzly Bears', 'battlefield') }]);
  });

  it('CR 303.4g, 303.4i: an Aura with nothing it could enchant stays where it is', () => {
    const aura = withAbilities('Rancor', [
      { kind: 'keyword', text: 'Enchant creature', keyword: 'enchant', filter: { types: ['Creature'] } },
      staticAbility('~ enters attached to a creature you control.', [entersSelf({ attachTo: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } })], { zone: ['graveyard', 'battlefield'] }),
    ]);
    const s0 = scenario([], { p1: { graveyard: ['Rancor'] }, defs: [aura] });
    const r = run(s0, (g) => moveObject(g, find(s0, 'Rancor', 'graveyard'), 'battlefield', { controller: 'p1' }));
    expect(r.result).toBeNull();
    expect(r.g.s.zones.graveyard.p1).toContain(find(s0, 'Rancor', 'graveyard'));
    expect(logHas(r.g.s, /nothing it could enchant/, 'CR 303.4g')).toBe(true);
  });

  it('CR 303.4g, 608.3e: an Aura on the stack with nothing it could enchant is put into its owner\'s graveyard instead', () => {
    const aura = withAbilities('Rancor', [
      { kind: 'keyword', text: 'Enchant creature', keyword: 'enchant', filter: { types: ['Creature'] } },
      staticAbility('~ enters attached to a creature you control.', [entersSelf({ attachTo: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } })], { zone: ['stack', 'battlefield'] }),
    ]);
    const s0 = scenario([], { p1: { hand: ['Rancor'] }, defs: [aura] });
    const r = run(s0, (g) => {
      const onStack = moveObject(g, find(s0, 'Rancor', 'hand'), 'stack', { controller: 'p1' })!;
      return moveObject(g, onStack, 'battlefield', { controller: 'p1' });
    });
    expect(r.g.s.zones.stack).toEqual([]);
    expect(r.g.s.zones.graveyard.p1!.map((id) => r.g.s.objects[id]!.defId)).toContain('Rancor');
    expect(r.result && r.g.s.objects[r.result]!.zone).toBe('graveyard');
  });

  it('CR 303.4h: a permanent that is not an Aura, Equipment or Fortification with nothing to enter attached to enters unattached', () => {
    const banner = permanent('Test Banner', 'Artifact', [
      staticAbility('~ enters attached to a creature you control.', [entersSelf({ attachTo: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } })], { zone: ['graveyard', 'battlefield'] }),
    ]);
    const s0 = scenario([], { p1: { graveyard: ['Test Banner'] }, defs: [banner] });
    const r = run(s0, (g) => moveObject(g, find(s0, 'Test Banner', 'graveyard'), 'battlefield', { controller: 'p1' }));
    expect(r.g.s.objects[r.result!]).toMatchObject({ zone: 'battlefield' });
    expect(r.g.s.objects[r.result!]!.attachedTo).toBeUndefined();
    expect(logHas(r.g.s, /enters unattached/, 'CR 303.4h')).toBe(true);
  });

  it('CR 708.2a, 614.12: a card put onto the battlefield face down has no abilities, so its own "as it enters" replacements do not apply', () => {
    const brute = permanent('Test Brute', 'Creature — Test', [
      staticAbility('~ enters with two +1/+1 counters on it.', [entersSelf({ counters: [{ kind: '+1/+1', count: 2 }] })]),
      staticAbility('~ enters tapped.', [entersSelf({ tapped: true })]),
      staticAbility('As ~ enters, choose a color.', [entersSelf({ choose: [{ what: 'color', link: 'c' }] })]),
    ], { pt: ['3', '3'] });
    const s0 = scenario([], { p1: { library: ['Test Brute'] }, defs: [brute] });
    const id = s0.zones.library.p1!.find((x) => s0.objects[x]!.defId === 'Test Brute')!;
    const r = run(s0, (g) => moveObject(g, id, 'battlefield', { controller: 'p1', faceDown: true }));
    expect(r.need).toBeUndefined();
    expect(r.g.s.objects[r.result!]).toMatchObject({ faceDown: true, tapped: false, counters: {} });
  });

  it('CR 614.1c: "enters with flying" grants the ability to the new object (a layer 6 effect)', () => {
    const bird = permanent('Test Fledgling', 'Creature — Bird', [staticAbility('~ enters with flying.', [entersSelf({ withAbilities: [{ kind: 'keyword', text: 'Flying', keyword: 'flying' }] })])], { pt: ['1', '1'] });
    const s0 = scenario([], { p1: { graveyard: ['Test Fledgling'] }, defs: [bird] });
    const r = run(s0, (g) => moveObject(g, find(s0, 'Test Fledgling', 'graveyard'), 'battlefield', { controller: 'p1' }));
    expect(getChars(r.g.s, r.result!).keywords.map((k) => k.keyword)).toContain('flying');
  });

  it('a manual move onto the battlefield is an entry like any other (CR 614.12): the counters are applied', () => {
    const brute = permanent('Test Brute', 'Creature — Test', [staticAbility('~ enters with two +1/+1 counters on it.', [entersSelf({ counters: [{ kind: '+1/+1', count: 2 }] }, { selfReplacement: true })])], { pt: ['0', '0'] });
    const s0 = scenario([], { p1: { hand: ['Test Brute'] }, defs: [brute] });
    const r = run(s0, (g) => applyManualOps(g, 'p1', [{ op: 'move', object: find(s0, 'Test Brute', 'hand'), to: 'battlefield' }]));
    expect(r.g.s.objects[find(r.g.s, 'Test Brute', 'battlefield')]!.counters['+1/+1']).toBe(2);
  });
});
