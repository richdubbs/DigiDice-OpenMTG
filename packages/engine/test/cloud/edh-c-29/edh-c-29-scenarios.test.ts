/**
 * Commander lane edh-c, round edh-c-29: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default compiler.
 * Each test is named after the rule it checks and has its negative case. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 604.1, 613.1f           "Enchanted creature has defender and loses flying."
 *   CR 400.3, 101.4, 608.2c    "Each player returns all creature cards from their graveyard to their hand."
 *   CR 101.4, 121.1, 701.9a    "Each player draws two cards, then discards three cards, then loses 4 life."
 *   CR 608.2d, 101.4, 120.3    "Any player may have ~ deal 6 damage to them. If no one does, target player mills six cards."
 *   CR 122.1, 122.6, 608.2d    "When ~ enters, target opponent puts a deathtouch counter on a creature they control."
 *   CR 613.4b, 611.2a          "{T}: Target creature with flying has base power 0 until end of turn."
 *   CR 615.1a, 615.7, 120.3    "If a source would deal damage to you or a creature you control, prevent 1 of that damage."
 *   CR 603.2c, 119.9           "When you gain life for the first time each turn, return this card from your graveyard to your hand."
 *   CR 120.1, 603.4            "At the beginning of each end step, if you were dealt 4 or more damage this turn, exile this artifact."
 *   CR 700.4, 603.4            "At the beginning of your end step, if an artifact or creature was put into a graveyard from the battlefield this turn, put a +1/+1 counter on ~."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { charsOfObject } from '../../../src/rules/characteristics';
import { act, advanceTo, find, findAll, legal, life, pass, put, scenario } from '../../m3/scenario';
import { cast, resolveAll, settle } from '../cmd3/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; colors?: string[]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const chars = (s: GameState, id: ObjectId) => charsOfObject(s, s.objects[id]!);
const hasKw = (s: GameState, id: ObjectId, kw: string): boolean => chars(s, id).keywords.some((k) => k.keyword === kw);
const names = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p: PlayerId): string[] => (s.zones[zone][p] ?? []).map((id) => s.objects[id]!.defId);
const tgt = (id: PlayerId | ObjectId, kind: 'player' | 'object' = 'player') => ({ kind, id }) as never;
const finish = (s: GameState, p: Parameters<typeof resolveAll>[1] = {}): GameState => resolveAll(s, p);

describe('CR 604.1, 613.1f: "Enchanted creature has defender and loses flying."', () => {
  const TETHER = card('Test Sky Chain', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature has defender and loses flying.');
  const BIRD = card('Test Sky Bird', 'Creature — Bird', 'Flying', { pt: ['2', '2'] });
  const defs = [TETHER, BIRD];
  it('is automated', () => { expect(full(TETHER)).toBe(true); });
  it('the enchanted flyer has defender and no flying; an unenchanted flyer keeps flying and has no defender', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Sky Bird'] }, p2: { battlefield: ['Test Sky Bird'] } });
    const [mine, theirs] = [find(s, 'Test Sky Bird', 'battlefield', 'p1'), find(s, 'Test Sky Bird', 'battlefield', 'p2')];
    expect(hasKw(s, mine, 'flying')).toBe(true);
    s.objects[put(s, 'p1', 'battlefield', 'Test Sky Chain')]!.attachedTo = mine;
    expect(hasKw(s, mine, 'flying')).toBe(false);
    expect(hasKw(s, mine, 'defender')).toBe(true);
    expect(hasKw(s, theirs, 'flying')).toBe(true);
    expect(hasKw(s, theirs, 'defender')).toBe(false);
  });
  it('negative: it does not take other keywords away (a creature with flying and reach keeps reach)', () => {
    const SPIDER = card('Test Sky Spider', 'Creature — Spider', 'Flying\nReach', { pt: ['1', '1'] });
    const s = scenario([], { defs: [TETHER, SPIDER], p1: { battlefield: ['Test Sky Spider'] } });
    const spider = find(s, 'Test Sky Spider', 'battlefield', 'p1');
    s.objects[put(s, 'p1', 'battlefield', 'Test Sky Chain')]!.attachedTo = spider;
    expect(hasKw(s, spider, 'flying')).toBe(false);
    expect(hasKw(s, spider, 'reach')).toBe(true);
  });
});

describe('CR 400.3, 101.4, 608.2c: "Each player returns all creature cards from their graveyard to their hand."', () => {
  const RITE = card('Test Grave Rite', 'Sorcery', 'Each player returns all creature cards from their graveyard to their hand.');
  const OGRE = card('Test Grave Ogre', 'Creature — Ogre', '', { pt: ['2', '2'] });
  const RELIC = card('Test Grave Relic', 'Artifact', '');
  const defs = [RITE, OGRE, RELIC];
  it('is automated', () => { expect(full(RITE)).toBe(true); });
  it('every player gets the creature cards of their own graveyard into their own hand; noncreature cards stay in the graveyard', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Grave Rite'], graveyard: ['Test Grave Ogre', 'Test Grave Ogre', 'Test Grave Relic'] }, p2: { graveyard: ['Test Grave Ogre'] } });
    const s = finish(cast(s0, 'Test Grave Rite'));
    expect(names(s, 'hand', 'p1').filter((n) => n === 'Test Grave Ogre')).toHaveLength(2);
    expect(names(s, 'hand', 'p2')).toEqual(['Test Grave Ogre']);
    expect(names(s, 'graveyard', 'p1')).toContain('Test Grave Relic');
    expect(names(s, 'graveyard', 'p1')).not.toContain('Test Grave Ogre');
    expect(names(s, 'graveyard', 'p2')).toEqual([]);
  });
  it('negative: with no creature card in any graveyard nothing moves', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Grave Rite'], graveyard: ['Test Grave Relic'] } });
    const before = names(scenario([], { defs, p1: { hand: ['Test Grave Rite'], graveyard: ['Test Grave Relic'] } }), 'hand', 'p2').length;
    const s = finish(cast(s0, 'Test Grave Rite'));
    expect(names(s, 'hand', 'p2')).toHaveLength(before);
    expect(names(s, 'graveyard', 'p1')).toEqual(['Test Grave Relic', 'Test Grave Rite']);
  });
});

describe('CR 101.4, 121.1, 701.9a: "Each player draws two cards, then discards three cards, then loses 4 life."', () => {
  const GUILT = card('Test Grim Toll', 'Sorcery', 'Each player draws two cards, then discards three cards, then loses 4 life.');
  const defs = [GUILT];
  it('is automated', () => { expect(full(GUILT)).toBe(true); });
  it('every player draws two, discards three and loses 4 life: a player with four cards ends with one, a player with none ends with none (a hand never goes below zero)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Grim Toll', 'Plains', 'Plains', 'Plains'] }, p2: { hand: [] } });
    const handBefore = (p: PlayerId): number => s0.zones.hand[p]!.length;
    const s = finish(cast(s0, 'Test Grim Toll'));
    expect(life(s, 'p1')).toBe(16);
    expect(life(s, 'p2')).toBe(16);
    expect(s.zones.hand.p1!.length).toBe(handBefore('p1') - 1 + 2 - 3);
    expect(s.zones.hand.p2!.length).toBe(Math.max(0, handBefore('p2') + 2 - 3));
    expect(s.zones.graveyard.p1!.length).toBe(1 + 3);
    expect(s.zones.graveyard.p2!.length).toBe(Math.min(3, handBefore('p2') + 2));
  });
});

describe('CR 608.2d, 101.4, 120.3: "Any player may have ~ deal 6 damage to them. If no one does, target player mills six cards."', () => {
  const BURN = card('Test Book Pyre', 'Sorcery', 'Any player may have ~ deal 6 damage to them. If no one does, target player mills six cards.');
  const defs = [BURN];
  it('is automated', () => { expect(full(BURN)).toBe(true); });
  it('no one agrees: the target player mills six and nobody is damaged', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Book Pyre'] } });
    const lib = s0.zones.library.p2!.length;
    const s = finish(cast(s0, 'Test Book Pyre', { yes: false, targets: [tgt('p2')] }), { yes: false });
    expect(s.zones.library.p2!.length).toBe(lib - 6);
    expect(life(s, 'p1')).toBe(20);
    expect(life(s, 'p2')).toBe(20);
  });
  it('a player agrees: that player takes 6 damage (once, from the first who does) and the target player mills nothing', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Book Pyre'] } });
    const lib = s0.zones.library.p2!.length;
    const s = finish(cast(s0, 'Test Book Pyre', { yes: true, targets: [tgt('p2')] }), { yes: true });
    expect(s.zones.library.p2!.length).toBe(lib);
    expect(20 - life(s, 'p1') + (20 - life(s, 'p2'))).toBe(6);
  });
});

describe('CR 122.1, 122.6, 608.2d: "When ~ enters, target opponent puts a deathtouch counter on a creature they control."', () => {
  const NIGHTMARE = card('Test Hunted Dream', 'Creature — Nightmare', 'When ~ enters, target opponent puts a deathtouch counter on a creature they control.', { pt: ['2', '2'], cost: '{0}' });
  const BEAR = card('Test Dream Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [NIGHTMARE, BEAR];
  const counters = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['deathtouch'] ?? 0;
  it('is automated', () => { expect(full(NIGHTMARE)).toBe(true); });
  it('the opponent (not the controller) chooses which of their creatures gets the counter; their other creature and the controller\'s creature get none', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Hunted Dream'], battlefield: ['Test Dream Bear'] }, p2: { battlefield: ['Test Dream Bear', 'Test Dream Bear'] } });
    const [a, b] = findAll(s0, 'Test Dream Bear', 'battlefield', 'p2');
    const mine = find(s0, 'Test Dream Bear', 'battlefield', 'p1');
    let s = cast(s0, 'Test Hunted Dream');
    s = settle(s, { targets: [tgt('p2')], objects: [b!] });
    for (let i = 0; i < 8 && (s.zones.stack.length > 0 || (s.pending !== null && s.pending.kind !== 'priority')); i++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s, { targets: [tgt('p2')], objects: [b!] });
    expect(counters(s, b!)).toBe(1);
    expect(counters(s, a!)).toBe(0);
    expect(counters(s, mine)).toBe(0);
  });
  it('negative: an opponent with no creature puts no counter (nothing else gets one either)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Hunted Dream'], battlefield: ['Test Dream Bear'] } });
    let s = cast(s0, 'Test Hunted Dream');
    s = settle(s, { targets: [tgt('p2')] });
    for (let i = 0; i < 8 && (s.zones.stack.length > 0 || (s.pending !== null && s.pending.kind !== 'priority')); i++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s, { targets: [tgt('p2')] });
    for (const id of s.zones.battlefield) expect(s.objects[id]!.counters['deathtouch'] ?? 0).toBe(0);
  });
});

describe('CR 122.6, 608.2d: "At the beginning of each player\'s upkeep, that player puts a rope counter on a creature they control." (the player of the event is the one who chooses and puts)', () => {
  const LINE = card('Test Rope Line', 'Artifact', "At the beginning of each player's upkeep, that player puts a rope counter on a creature they control.");
  const BEAR = card('Test Rope Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [LINE, BEAR];
  it('is automated', () => { expect(full(LINE)).toBe(true); });
  it("at p2's upkeep p2 (not the artifact's controller p1) chooses one of their own creatures and the counter goes there; p1's creature and p2's other creature get none", () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Rope Line', 'Test Rope Bear'] }, p2: { battlefield: ['Test Rope Bear', 'Test Rope Bear'] } });
    const [a, b] = findAll(s0, 'Test Rope Bear', 'battlefield', 'p2');
    const mine = find(s0, 'Test Rope Bear', 'battlefield', 'p1');
    // p1's own upkeep is turn 1 (already past): the first upkeep after the setup is p2's on turn 2
    let s = advanceTo(s0, 2, 'upkeep');
    s = resolveAll(s, { objects: [b!] });
    expect(s.objects[b!]!.counters['rope'] ?? 0).toBe(1);
    expect(s.objects[a!]!.counters['rope'] ?? 0).toBe(0);
    expect(s.objects[mine]!.counters['rope'] ?? 0).toBe(0);
  });
});

describe('CR 608.2d, 120.3: choosing to be dealt the damage counts even when it is prevented (ruling of Vexing Devil 2012-05-01)', () => {
  const BURN = card('Test Book Pyre', 'Sorcery', 'Any player may have ~ deal 6 damage to them. If no one does, target player mills six cards.');
  const FOG = card('Test Soft Fog', 'Enchantment', 'Prevent all damage that would be dealt to you.');
  it('p1 (with the prevention) says yes: nobody is asked after, nothing is milled, no damage is dealt', () => {
    const s0 = scenario([], { defs: [BURN, FOG], p1: { hand: ['Test Book Pyre'], battlefield: ['Test Soft Fog'] } });
    const lib = s0.zones.library.p2!.length;
    const s = finish(cast(s0, 'Test Book Pyre', { yes: true, targets: [tgt('p2')] }), { yes: true });
    expect(s.zones.library.p2!.length).toBe(lib);
    expect(life(s, 'p1')).toBe(20);
    expect(life(s, 'p2')).toBe(20);
  });
});

describe('CR 613.4b, 611.2a: "{T}: Target creature with flying has base power 0 until end of turn."', () => {
  const ISLE = card('Test Wak Isle', 'Land', '{T}: Target creature with flying has base power 0 until end of turn.');
  const BIRD = card('Test Wak Bird', 'Creature — Bird', 'Flying', { pt: ['3', '3'] });
  const defs = [ISLE, BIRD];
  it('is automated', () => { expect(full(ISLE)).toBe(true); });
  it('the flyer\'s power becomes 0 and its toughness stays 3; a +1/+1 counter still adds to the base power (layer 7b, then counters in 7c)', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Wak Isle', { name: 'Test Wak Bird', counters: { '+1/+1': 1 } }] } });
    const bird = find(s, 'Test Wak Bird', 'battlefield', 'p1');
    expect(Number(chars(s, bird).power)).toBe(4);
    s = settle(act(s, legal(s, 'p1', 'activate')[0]!.action), { targets: [tgt(bird, 'object')] });
    s = finish(s, { targets: [tgt(bird, 'object')] });
    expect(Number(chars(s, bird).power)).toBe(1);
    expect(Number(chars(s, bird).toughness)).toBe(4);
  });
});

describe('CR 615.1a, 615.7, 120.3: "If a source would deal damage to you or a creature you control, prevent 1 of that damage."', () => {
  const GUARD = card('Test Ward Mender', 'Creature — Human', 'If a source would deal damage to you or a creature you control, prevent 1 of that damage.', { pt: ['1', '1'] });
  const BEAR = card('Test Ward Bear', 'Creature — Bear', '', { pt: ['4', '4'] });
  const BOLT = card('Test Ward Bolt', 'Sorcery', '~ deals 3 damage to any target.');
  const defs = [GUARD, BEAR, BOLT];
  const bolt = (s0: GameState, who: ObjectId | PlayerId, kind: 'player' | 'object'): GameState => finish(cast(s0, 'Test Ward Bolt', { targets: [tgt(who, kind)] }, 'p1'), { targets: [tgt(who, kind)] });
  it('is automated', () => { expect(full(GUARD)).toBe(true); });
  it('you and your creatures take 1 less; damage dealt to the opponent is not reduced', () => {
    const base = (): GameState => scenario([], { defs, p1: { battlefield: ['Test Ward Mender', 'Test Ward Bear'], hand: ['Test Ward Bolt'] }, p2: { battlefield: ['Test Ward Bear'] } });
    expect(life(bolt(base(), 'p1', 'player'), 'p1')).toBe(20 - 2);
    const s0 = base();
    const mine = find(s0, 'Test Ward Bear', 'battlefield', 'p1');
    expect(bolt(s0, mine, 'object').objects[mine]!.damage).toBe(2);
    expect(life(bolt(base(), 'p2', 'player'), 'p2')).toBe(20 - 3);
    const t0 = base();
    const theirs = find(t0, 'Test Ward Bear', 'battlefield', 'p2');
    expect(bolt(t0, theirs, 'object').objects[theirs]!.damage).toBe(3);
  });
  it('negative: without the creature the damage is not reduced', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Ward Bolt'] } });
    expect(life(bolt(s0, 'p1', 'player'), 'p1')).toBe(20 - 3);
  });
});

describe('CR 603.2c, 119.9: "When you gain life for the first time each turn, return this card from your graveyard to your hand."', () => {
  const KNIGHT = card('Test Gravewalker', 'Creature — Knight', 'Haste\nWhen you gain life for the first time each turn, return this card from your graveyard to your hand.', { pt: ['2', '2'] });
  const SIP = card('Test Life Sip', 'Sorcery', 'You gain 1 life.');
  const defs = [KNIGHT, SIP];
  it('is automated', () => { expect(full(KNIGHT)).toBe(true); });
  it('the first life gain of the turn returns it from the graveyard to its owner\'s hand', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Life Sip'], graveyard: ['Test Gravewalker'] } });
    const s = finish(cast(s0, 'Test Life Sip'));
    expect(names(s, 'hand', 'p1')).toContain('Test Gravewalker');
    expect(names(s, 'graveyard', 'p1')).not.toContain('Test Gravewalker');
  });
  it('negative: a card that reaches the graveyard after the turn\'s first life gain stays there at the second gain', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Life Sip', 'Test Life Sip'] } });
    let s = finish(cast(s0, 'Test Life Sip'));
    put(s, 'p1', 'graveyard', 'Test Gravewalker');
    s = finish(cast(s, 'Test Life Sip'));
    expect(names(s, 'graveyard', 'p1')).toContain('Test Gravewalker');
    expect(names(s, 'hand', 'p1')).not.toContain('Test Gravewalker');
  });
  it('negative: an opponent\'s life gain does not return it', () => {
    const s0 = scenario([], { defs, p1: { graveyard: ['Test Gravewalker'] }, p2: { hand: ['Test Life Sip'] } });
    const s1 = advanceTo(s0, 2, 'main1');
    const s = finish(cast(s1, 'Test Life Sip', {}, 'p2'));
    expect(names(s, 'graveyard', 'p1')).toContain('Test Gravewalker');
  });
});

describe('CR 120.1, 603.4: "At the beginning of each end step, if you were dealt 4 or more damage this turn, exile this artifact."', () => {
  const WINDOW = card('Test Boarded Pane', 'Artifact', 'At the beginning of each end step, if you were dealt 4 or more damage this turn, exile this artifact.');
  const SHOCK = card('Test Pane Shock', 'Instant', '~ deals 2 damage to any target.');
  const defs = [WINDOW, SHOCK];
  const shock = (s: GameState, who: PlayerId | ObjectId, kind: 'player' | 'object', player: PlayerId): GameState => finish(cast(s, 'Test Pane Shock', { targets: [tgt(who, kind)] }, player), { targets: [tgt(who, kind)] });
  const base = (): GameState => scenario([], { defs, p1: { battlefield: ['Test Boarded Pane'], hand: ['Test Pane Shock', 'Test Pane Shock'] }, p2: { hand: ['Test Pane Shock', 'Test Pane Shock'], battlefield: [] } });
  const stays = (s: GameState): boolean => s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Boarded Pane');
  it('is automated', () => { expect(full(WINDOW)).toBe(true); });
  it('4 damage in two instances (the total counts) exiles it at the end step; 3 does not', () => {
    let s = shock(shock(base(), 'p1', 'player', 'p1'), 'p1', 'player', 'p1');
    s = advanceTo(s, 1, 'end');
    s = finish(s);
    expect(stays(s)).toBe(false);
    let t = shock(base(), 'p1', 'player', 'p1');
    t = advanceTo(t, 1, 'end');
    t = finish(t);
    expect(stays(t)).toBe(true);
  });
  it('negative: damage dealt to the opponent or to a creature never counts (only damage dealt to you)', () => {
    const BEAR = card('Test Pane Bear', 'Creature — Bear', '', { pt: ['9', '9'] });
    let s = scenario([], { defs: [...defs, BEAR], p1: { battlefield: ['Test Boarded Pane', 'Test Pane Bear'], hand: ['Test Pane Shock', 'Test Pane Shock'] } });
    const bear = find(s, 'Test Pane Bear', 'battlefield', 'p1');
    s = shock(s, bear, 'object', 'p1');
    s = shock(s, 'p2', 'player', 'p1');
    s = advanceTo(s, 1, 'end');
    s = finish(s);
    expect(stays(s)).toBe(true);
  });
});

describe('CR 700.4, 603.4: "At the beginning of your end step, if an artifact or creature was put into a graveyard from the battlefield this turn, put a +1/+1 counter on ~."', () => {
  const SHADE = card('Test Dim Shade', 'Creature — Shade', 'At the beginning of your end step, if an artifact or creature was put into a graveyard from the battlefield this turn, put a +1/+1 counter on ~.', { pt: ['1', '1'] });
  const KILL = card('Test Dim Kill', 'Instant', 'Destroy target permanent.');
  const RELIC = card('Test Dim Relic', 'Artifact', '');
  const PEON = card('Test Dim Peon', 'Creature — Human', '', { pt: ['1', '1'] });
  const defs = [SHADE, KILL, RELIC, PEON];
  const run = (target: string): number => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Dim Shade'], hand: ['Test Dim Kill'] }, p2: { battlefield: [target] } });
    const t = find(s, target, 'battlefield', 'p2');
    s = finish(cast(s, 'Test Dim Kill', { targets: [tgt(t, 'object')] }), { targets: [tgt(t, 'object')] });
    s = advanceTo(s, 1, 'end');
    s = finish(s);
    return s.objects[find(s, 'Test Dim Shade', 'battlefield', 'p1')]!.counters['+1/+1'] ?? 0;
  };
  it('is automated', () => { expect(full(SHADE)).toBe(true); });
  it('a creature or an artifact (of either player) put into a graveyard this turn gives it a counter', () => {
    expect(run('Test Dim Peon')).toBe(1);
    expect(run('Test Dim Relic')).toBe(1);
  });
  it('negative: a land put into a graveyard, or nothing, gives it none', () => {
    expect(run('Plains')).toBe(0);
    const s = scenario([], { defs, p1: { battlefield: ['Test Dim Shade'] } });
    const e = finish(advanceTo(s, 1, 'end'));
    expect(e.objects[find(e, 'Test Dim Shade', 'battlefield', 'p1')]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});
