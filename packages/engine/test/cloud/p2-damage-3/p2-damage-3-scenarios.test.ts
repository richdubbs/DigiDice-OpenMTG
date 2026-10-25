/**
 * p2-damage-3 (Phase 2 lane p2-damage): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (wordings
 * invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud
 * checkout).
 *
 *   CR 109.4, 115.1        "each creature that player or that planeswalker's controller controls": the creatures of the targeted player, or of the targeted planeswalker's
 *                          controller; never the other player's
 *   CR 603.4, 207.2c       Landfall's "if you had a land enter the battlefield under your control this turn": true after you played a land, false otherwise
 *   CR 303.4b              "Destroy all creatures that aren't enchanted.": a creature with an Aura attached survives
 *   CR 608.2d              "it deals 3 damage to a creature an opponent controls chosen at random": nobody is asked; never your own creature
 *   CR 702.9, 109.4        "each creature without flying that player controls": the defending player's creatures without flying only
 *   CR 120.3               "1 damage to each opponent and 1 damage to each creature your opponents control": your own side is untouched
 *   CR 120.2b, 608.2h      "damage equal to the number of charge counters on it to each creature and each player": read as the artifact last existed after its sacrifice
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, life, put, scenario } from '../../m3/scenario';
import { attackWith, card, full, pt, resolveAll, settle } from '../cmd3/helpers';

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });
const onField = (s: GameState, name: string, who?: string): boolean => s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === name && (who === undefined || s.objects[id]!.controller === who));
const damageOn = (s: GameState, id: ObjectId): number => s.objects[id]?.damage ?? 0;

const FURY = card('Test Fury', 'Instant', "This spell deals 3 damage to target player or planeswalker and 1 damage to each creature that player or that planeswalker's controller controls.");
const SOUL = card('Test Soul', 'Instant', "This spell deals 3 damage to target player or planeswalker and 3 damage to up to one target creature that player or that planeswalker's controller controls.");
const WALKER = compileCard({ name: 'Test Walker', layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Planeswalker — Testy', oracle_text: '', loyalty: '5', colors: [] } as OracleCard);
const SWELL = card('Test Swell', 'Instant', 'Target creature gets +2/+2 until end of turn.\nLandfall — If you had a land enter the battlefield under your control this turn, that creature gets +4/+4 until end of turn instead.');
const WINDS = card('Test Winds', 'Sorcery', "Destroy all creatures that aren't enchanted.");
const AURA = card('Test Aura', 'Enchantment — Aura', 'Enchant creature');
const GIANT = card('Test Giant', 'Creature — Giant', 'When this creature dies, it deals 3 damage to a creature an opponent controls chosen at random.', ['4', '4']);
const SLAY = card('Test Slay', 'Sorcery', 'Destroy target creature.');
const DRAGON = card('Test Dragon', 'Creature — Dragon', 'Whenever this creature attacks, if defending player controls no Walls, it deals 1 damage to each creature without flying that player controls.', ['5', '5']);
const CASTER = card('Test Caster', 'Creature — Lizard', 'When this creature enters, it deals 1 damage to each opponent and 1 damage to each creature your opponents control.', ['2', '2']);
const BOMB = card('Test Bomb', 'Artifact', '{T}, Sacrifice this artifact: This artifact deals damage equal to the number of charge counters on it to each creature and each player.');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3']);
const BIRD = card('Test Bird', 'Creature — Bird', 'Flying', ['1', '3']);
const DEFS: CardDef[] = [SOUL, FURY, WALKER, SWELL, WINDS, AURA, GIANT, SLAY, DRAGON, CASTER, BOMB, BEAR, OGRE, BIRD];

const cast = (s0: GameState, name: string, targets: TargetChoice[] = []): GameState => resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), { targets }), { targets });

describe('the synthetic cards are automated', () => {
  it('every synthetic card with rules text plays fully', () => {
    for (const d of [SOUL, FURY, SWELL, WINDS, GIANT, DRAGON, CASTER, BOMB]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 109.4, 115.1: "each creature that player or that planeswalker\'s controller controls"', () => {
  it('targeting Bob: Bob is dealt 3 and his Ogre 1; Alice\'s Bear is untouched', () => {
    let s = scenario([], { p1: { hand: ['Test Fury'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Ogre'] }, defs: DEFS });
    s = cast(s, 'Test Fury', [player('p2')]);
    expect(life(s, 'p2')).toBe(17);
    expect(damageOn(s, find(s, 'Test Ogre', 'battlefield', 'p2'))).toBe(1);
    expect(damageOn(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe(0);
  });
  it('targeting Bob\'s planeswalker: the creatures of its controller (Bob) are dealt 1, and Bob loses no life', () => {
    let s = scenario([], { p1: { hand: ['Test Fury'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Ogre', { name: 'Test Walker', counters: { loyalty: 5 } }] }, defs: DEFS });
    s = cast(s, 'Test Fury', [obj(find(s, 'Test Walker', 'battlefield', 'p2'))]);
    expect(life(s, 'p2')).toBe(20);
    expect(s.objects[find(s, 'Test Walker', 'battlefield', 'p2')]!.counters['loyalty']).toBe(2);
    expect(damageOn(s, find(s, 'Test Ogre', 'battlefield', 'p2'))).toBe(1);
    expect(damageOn(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe(0);
  });
});

describe('CR 115.1, 601.2c: "up to one target creature that player or that planeswalker\'s controller controls" (a target that depends on the first)', () => {
  it('with Bob\'s planeswalker as the first target, Bob\'s Ogre is a legal second target and is dealt 3', () => {
    let s = scenario([], { p1: { hand: ['Test Soul'] }, p2: { battlefield: ['Test Ogre', { name: 'Test Walker', counters: { loyalty: 5 } }] }, defs: DEFS });
    const walker = find(s, 'Test Walker', 'battlefield', 'p2');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Soul', 'hand', 'p1') });
    s = answer(s, { kind: 'chooseTargets', targets: [obj(walker)] });
    s = resolveAll(answer(s, { kind: 'chooseTargets', targets: [obj(ogre)] }));
    expect(onField(s, 'Test Ogre')).toBe(false);
    expect(s.objects[walker]!.counters['loyalty']).toBe(2);
  });
  it('Alice\'s own Bear is not a legal second target after targeting Bob', () => {
    const s0 = scenario([], { p1: { hand: ['Test Soul'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Ogre'] }, defs: DEFS });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Soul', 'hand', 'p1') });
    s = answer(s, { kind: 'chooseTargets', targets: [player('p2')] });
    const d = s.pending as { kind: string; objects?: ObjectId[] };
    expect(d.kind).toBe('chooseTargets');
    expect(d.objects).toContain(find(s0, 'Test Ogre', 'battlefield', 'p2'));
    expect(d.objects).not.toContain(find(s0, 'Test Bear', 'battlefield', 'p1'));
  });
});

describe('CR 603.4, 207.2c: "if you had a land enter the battlefield under your control this turn"', () => {
  it('after Alice played a land this turn, her Bear gets +4/+4 (6/6)', () => {
    let s = scenario(['Forest'], { p1: { hand: ['Test Swell', 'Forest'], battlefield: ['Test Bear'] }, defs: DEFS });
    s = settle(act(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'hand', 'p1') }));
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Swell', [obj(bear)]);
    expect(pt(s, bear)).toBe('6/6');
  });
  it('without a land this turn it gets +2/+2 (4/4)', () => {
    let s = scenario(['Forest'], { p1: { hand: ['Test Swell'], battlefield: ['Test Bear', 'Forest'] }, defs: DEFS });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Swell', [obj(bear)]);
    expect(pt(s, bear)).toBe('4/4');
  });
});

describe('CR 303.4b: "Destroy all creatures that aren\'t enchanted."', () => {
  it('the Bear with an Aura survives, the Ogre does not', () => {
    const s0 = structuredClone(scenario([], { p1: { hand: ['Test Winds'], battlefield: ['Test Bear', 'Test Ogre'] }, defs: DEFS }));
    s0.objects[put(s0, 'p1', 'battlefield', 'Test Aura')]!.attachedTo = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = cast(s0, 'Test Winds');
    expect(onField(s, 'Test Bear')).toBe(true);
    expect(onField(s, 'Test Ogre')).toBe(false);
  });
});

describe('CR 608.2d: "it deals 3 damage to a creature an opponent controls chosen at random"', () => {
  it('the Giant dies: one of Bob\'s two creatures is dealt 3, nobody is asked, Alice\'s Ogre is never chosen', () => {
    let s = scenario([], { p1: { hand: ['Test Slay'], battlefield: ['Test Giant', 'Test Ogre'] }, p2: { battlefield: ['Test Bear', 'Test Bird'] }, defs: DEFS });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Slay', 'hand', 'p1') });
    s = answer(s, { kind: 'chooseTargets', targets: [obj(find(s, 'Test Giant', 'battlefield', 'p1'))] });
    for (let guard = 0; (s.zones.stack.length > 0 || s.pending?.kind !== 'priority') && guard < 20; guard++) {
      expect(s.pending?.kind === 'chooseObjects' || s.pending?.kind === 'chooseTargets').toBe(false);
      s = settle(act(s, { type: 'pass', player: s.pending!.player }));
    }
    const bobs = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2');
    expect(bobs.length).toBe(1); // the Bear (2/2) or the Bird (1/3) was dealt 3 and died
    expect(damageOn(s, find(s, 'Test Ogre', 'battlefield', 'p1'))).toBe(0);
  });
});

describe('CR 702.9, 109.4: "each creature without flying that player controls" (the defending player)', () => {
  it('Alice attacks Bob: his Bear is dealt 1, his Bird (flying) nothing, Alice\'s Ogre nothing', () => {
    let s = scenario([], { p1: { battlefield: ['Test Dragon', 'Test Ogre'] }, p2: { battlefield: ['Test Bear', 'Test Bird'] }, defs: DEFS });
    s = attackWith(s, [find(s, 'Test Dragon', 'battlefield', 'p1')]);
    s = resolveAll(s);
    expect(damageOn(s, find(s, 'Test Bear', 'battlefield', 'p2'))).toBe(1);
    expect(damageOn(s, find(s, 'Test Bird', 'battlefield', 'p2'))).toBe(0);
    expect(damageOn(s, find(s, 'Test Ogre', 'battlefield', 'p1'))).toBe(0);
  });
});

describe('CR 120.3: "1 damage to each opponent and 1 damage to each creature your opponents control"', () => {
  it('Bob is dealt 1 and his Bear 1; Alice and her Ogre are untouched', () => {
    let s = scenario([], { p1: { hand: ['Test Caster'], battlefield: ['Test Ogre'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    s = cast(s, 'Test Caster');
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([20, 19]);
    expect(damageOn(s, find(s, 'Test Bear', 'battlefield', 'p2'))).toBe(1);
    expect(damageOn(s, find(s, 'Test Ogre', 'battlefield', 'p1'))).toBe(0);
  });
});

describe('CR 120.2b, 608.2h: "damage equal to the number of charge counters on it to each creature and each player"', () => {
  it('sacrificed with two charge counters: every player is dealt 2 and every creature 2', () => {
    let s = scenario([], { p1: { battlefield: [{ name: 'Test Bomb', counters: { charge: 2 } }, 'Test Ogre'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    s = resolveAll(settle(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Bomb', 'battlefield', 'p1'), ability: 'p:0:0' })));
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([18, 18]);
    expect(damageOn(s, find(s, 'Test Ogre', 'battlefield', 'p1'))).toBe(2);
    expect(onField(s, 'Test Bear')).toBe(false); // a 2/2 dealt 2
  });
  it('with no counter nobody is dealt damage', () => {
    let s = scenario([], { p1: { battlefield: ['Test Bomb'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    s = resolveAll(settle(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Bomb', 'battlefield', 'p1'), ability: 'p:0:0' })));
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([20, 20]);
    expect(onField(s, 'Test Bear')).toBe(true);
  });
});
