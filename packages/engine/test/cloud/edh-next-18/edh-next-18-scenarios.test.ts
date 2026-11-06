/**
 * edh-next-18 (Commander lane edh-next, EDHREC ranks 5,001-6,500, fifth pass): the round's readings played through the engine with synthetic cards compiled by the game's
 * default compiler (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites checked against the Comprehensive Rules of
 * 2026-09-25 where the record says so.
 *
 *   CR 614.1a, 120.3, 611.2a  "If a source you control would deal damage this turn, it deals double that damage instead.": your damage is doubled this turn, the opponent's is not, and it ends with the turn
 *   CR 509.1b, 509.1c, 101.2  "~ can't be blocked unless all creatures defending player controls block it.": blocked by every creature the defending player controls it is legal;
 *                             by only some of them, or when one of them is tapped, it is not; "hexproof unless attacking or blocking" follows the combat status
 *   CR 118.3, 119.4, 701.21a  "Players can't pay life or sacrifice creatures to cast spells or activate abilities.": a sacrifice-a-creature cost, a pay-life cost and Phyrexian mana
 *                             paid with life are refused; an artifact sacrifice, mana, and an effect that has a player pay life or sacrifice are not
 *   CR 601.3b, 702.8a, 611.2  "The next sorcery spell you cast this turn can be cast as though it had flash.": a sorcery may be cast with another spell on the stack after the
 *                             effect; a creature spell may not; the next sorcery cast uses it up; without the effect a sorcery may not; it ends with the turn
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { isCastOrActivate } from '../../../src/rules/sources';
import { pass } from '../../m3/scenario';
import { act, advanceTo, answer, card, drive, find, full, resolveAll, scenario } from '../r3-cost/support';

const WAVE = card('Test Quick Wave', 'Sorcery', 'The next sorcery spell you cast this turn can be cast as though it had flash.\nDraw a card.', '{0}');
const RING = card('Test Plain Ring', 'Artifact', '', '{0}');
const NOTION = card('Test Notion', 'Sorcery', 'Draw a card.', '{0}');
const IDEA = card('Test Idea', 'Sorcery', 'Draw a card.', '{0}');
const CUB = card('Test Cub', 'Creature — Bear', '', '{0}', ['2', '2']);
const ICON = card('Test Kin Icon', 'Artifact', 'As this artifact enters, choose a creature type.\n{T}: The next spell of the chosen type you cast this turn can be cast as though it had flash.', '{0}');
const WOLF = card('Test Pack Wolf', 'Creature — Wolf', '', '{0}', ['2', '2']);
const HOUND = card('Test Pack Hound', 'Creature — Dog', '', '{0}', ['2', '2']);
const HUSH = card('Test Hush Angel', 'Creature — Angel', 'Players can\'t pay life or sacrifice creatures to cast spells or activate abilities.', '{0}', ['2', '2']);
const FLING = card('Test Fling Goblin', 'Creature — Goblin', 'Sacrifice a creature: Draw a card.', '{0}', ['1', '1']);
const GEARS = card('Test Gear Lathe', 'Artifact', 'Sacrifice an artifact: Draw a card.', '{0}');
const PAIN = card('Test Pain Engine', 'Artifact', 'Pay 2 life: Draw a card.', '{0}');
const SHARD = card('Test Phyrexian Shard', 'Artifact', '', '{G/P}');
const BARGAIN = card('Test Bargain Sorcery', 'Sorcery', 'You may pay 2 life. If you do, draw a card.', '{0}');
const KRAKEN = card('Test Tide Kraken', 'Creature — Kraken', "This creature has hexproof unless it's attacking or blocking.\nThis creature can't be blocked unless all creatures defending player controls block it.", '{0}', ['3', '3']);
const BEAR = card('Test Plain Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
const DOUBLER = card('Test Twin Surge', 'Sorcery', 'If a source you control would deal damage this turn, it deals double that damage instead.', '{0}');
const BOLT = card('Test Ember Bolt', 'Sorcery', 'This spell deals 2 damage to each opponent.', '{0}');
const DEFS = [DOUBLER, BOLT, KRAKEN, BEAR, HUSH, FLING, GEARS, PAIN, SHARD, BARGAIN, WAVE, RING, NOTION, IDEA, CUB, ICON, WOLF, HOUND];

const castable = (s: GameState, id: ObjectId, player: PlayerId = 'p1'): boolean => legalActions(s, player).some((a) => a.kind === 'cast' && a.object === id);
const castOf = (s: GameState, id: ObjectId, player: PlayerId = 'p1') => legalActions(s, player).find((a) => a.kind === 'cast' && a.object === id)!.action;

describe('edh-next-18: the synthetic cards are automated', () => {
  it('every synthetic card compiles fully automated', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 601.3b, 702.8a, 611.2: "The next sorcery spell you cast this turn can be cast as though it had flash."', () => {
  it('without the effect a sorcery can\'t be cast while another spell is on the stack', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Plain Ring', 'Test Notion'] } });
    s = drive(act(s, castOf(s, find(s, 'Test Plain Ring', 'hand', 'p1'))));
    expect(s.zones.stack.length).toBe(1);
    expect(castable(s, find(s, 'Test Notion', 'hand', 'p1'))).toBe(false);
  });
  it('after it resolves, a sorcery may be cast with a spell on the stack, and that cast uses the effect up: a second sorcery may not', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Quick Wave', 'Test Plain Ring', 'Test Notion', 'Test Idea'] } });
    s = resolveAll(drive(act(s, castOf(s, find(s, 'Test Quick Wave', 'hand', 'p1')))));
    expect(s.turn.nextSpell?.map((r) => r.rider)).toEqual(['flash']);
    s = drive(act(s, castOf(s, find(s, 'Test Plain Ring', 'hand', 'p1'))));
    expect(s.zones.stack.length).toBe(1);
    expect(s.turn.nextSpell?.length).toBe(1); // an artifact spell is not "the next sorcery spell"
    const notion = find(s, 'Test Notion', 'hand', 'p1');
    expect(castable(s, notion)).toBe(true);
    s = drive(act(s, castOf(s, notion)));
    expect(s.turn.nextSpell ?? []).toEqual([]);
    expect(castable(s, find(s, 'Test Idea', 'hand', 'p1'))).toBe(false);
  });
  it('a creature spell is not a sorcery: it can\'t be cast with a spell on the stack', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Quick Wave', 'Test Plain Ring', 'Test Cub'] } });
    s = resolveAll(drive(act(s, castOf(s, find(s, 'Test Quick Wave', 'hand', 'p1')))));
    s = drive(act(s, castOf(s, find(s, 'Test Plain Ring', 'hand', 'p1'))));
    expect(castable(s, find(s, 'Test Cub', 'hand', 'p1'))).toBe(false);
  });
  it('it ends with the turn: on the opponent\'s turn the sorcery can\'t be cast', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Quick Wave', 'Test Notion'] } });
    s = resolveAll(drive(act(s, castOf(s, find(s, 'Test Quick Wave', 'hand', 'p1')))));
    s = advanceTo(s, 2, 'main1');
    expect(s.turn.nextSpell).toBeUndefined();
    expect(castable(s, find(s, 'Test Notion', 'hand', 'p1'))).toBe(false);
  });
});

describe('CR 601.3b, 607.2d, 611.2: "The next spell of the chosen type you cast this turn can be cast as though it had flash." (the chosen type of the source)', () => {
  const setup = () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Kin Icon', 'Test Plain Ring', 'Test Pack Wolf', 'Test Pack Hound'] } });
    s = drive(act(s, castOf(s, find(s, 'Test Kin Icon', 'hand', 'p1'))));
    return s;
  };
  it('only a spell of the creature type chosen as the artifact entered is cast at instant timing', () => {
    let s = setup();
    s = act(s, { type: 'pass', player: 'p1' });
    s = act(s, { type: 'pass', player: 'p2' });
    expect(s.pending?.kind).toBe('chooseName');
    s = resolveAll(answer(s, { kind: 'chooseName', name: 'Wolf' }));
    const icon = find(s, 'Test Kin Icon', 'battlefield', 'p1');
    expect(icon).toBeDefined();
    s = resolveAll(drive(act(s, legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === icon)!.action)));
    expect(s.turn.nextSpell?.map((r) => r.rider)).toEqual(['flash']);
    // CR 608.2h: the type is fixed as the ability resolves: the rider holds the value itself, not a pointer to the Icon
    expect(s.turn.nextSpell?.[0]?.filter).toEqual({ subtypes: ['Wolf'], stackKind: 'spell', zone: 'stack' });
    expect(s.turn.nextSpell?.[0]?.sourceId).toBeUndefined();
    s = drive(act(s, castOf(s, find(s, 'Test Plain Ring', 'hand', 'p1'))));
    expect(castable(s, find(s, 'Test Pack Hound', 'hand', 'p1'))).toBe(false);
    expect(castable(s, find(s, 'Test Pack Wolf', 'hand', 'p1'))).toBe(true);
  });
});

describe('CR 118.3, 119.4, 701.21a: "Players can\'t pay life or sacrifice creatures to cast spells or activate abilities."', () => {
  const act1 = (s: GameState, name: string, zone: 'battlefield' | 'hand' = 'battlefield') => legalActions(s, 'p1').find((a) => a.kind === (zone === 'hand' ? 'cast' : 'activate') && a.object === find(s, name, zone, 'p1'));
  it('a sacrifice-a-creature cost can be paid without the Angel and can\'t with it; an artifact sacrifice is not refused', () => {
    const without = scenario([], { defs: DEFS, p1: { battlefield: ['Test Fling Goblin', 'Test Gear Lathe'] } });
    expect(act1(without, 'Test Fling Goblin')).toBeDefined();
    const withAngel = scenario([], { defs: DEFS, p1: { battlefield: ['Test Fling Goblin', 'Test Gear Lathe', 'Test Hush Angel'] } });
    expect(act1(withAngel, 'Test Fling Goblin')).toBeUndefined();
    expect(act1(withAngel, 'Test Gear Lathe')).toBeDefined();
  });
  it('a pay-life cost is refused with the Angel, and an effect that has the player pay life still works', () => {
    const without = scenario([], { defs: DEFS, p1: { battlefield: ['Test Pain Engine'] } });
    expect(act1(without, 'Test Pain Engine')).toBeDefined();
    const withAngel = scenario([], { defs: DEFS, p1: { battlefield: ['Test Pain Engine', 'Test Hush Angel'], hand: ['Test Bargain Sorcery'] } });
    expect(act1(withAngel, 'Test Pain Engine')).toBeUndefined();
    expect(act1(withAngel, 'Test Bargain Sorcery', 'hand')).toBeDefined();
    let s = drive(act(withAngel, act1(withAngel, 'Test Bargain Sorcery', 'hand')!.action), { yes: [true] });
    s = resolveAll(s, { yes: [true] });
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(18); // the effect\'s payment was not stopped (Scryfall ruling 2012-05-01)
  });
  it('Phyrexian mana can\'t be paid with life with the Angel: a spell whose only mana is {G/P} is not castable with no green mana, and is without the Angel', () => {
    const without = scenario([], { defs: DEFS, p1: { hand: ['Test Phyrexian Shard'] } });
    expect(act1(without, 'Test Phyrexian Shard', 'hand')).toBeDefined();
    const withAngel = scenario([], { defs: DEFS, p1: { battlefield: ['Test Hush Angel'], hand: ['Test Phyrexian Shard'] } });
    expect(act1(withAngel, 'Test Phyrexian Shard', 'hand')).toBeUndefined();
  });
});

describe('CR 509.1b, 509.1c: "~ can\'t be blocked unless all creatures defending player controls block it." and hexproof unless attacking or blocking', () => {
  const setup = (tapOne = false) => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Tide Kraken'] }, p2: { battlefield: tapOne ? [{ name: 'Test Plain Bear', tapped: true }, 'Test Plain Bear'] : ['Test Plain Bear', 'Test Plain Bear'] } });
    s = advanceTo(s, 1, 'main1');
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    const kraken = find(s, 'Test Tide Kraken', 'battlefield', 'p1');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: kraken, defender: 'p2' }] });
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareBlockers' && s.turn.step !== 'main2'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    return { s, kraken, bears: s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Plain Bear') };
  };
  it('both creatures of the defending player blocking it is legal; only one of them blocking it is not', () => {
    const { s, kraken, bears } = setup();
    expect(s.pending?.kind).toBe('declareBlockers');
    expect(() => answer(s, { kind: 'declareBlockers', blocks: [{ blocker: bears[0]!, attacker: kraken }] })).toThrow();
    const ok = answer(s, { kind: 'declareBlockers', blocks: bears.map((b) => ({ blocker: b, attacker: kraken })) });
    expect(ok.pending?.kind).not.toBe('declareBlockers');
  });
  it('declining to block at all is legal (it is simply not blocked)', () => {
    const { s } = setup();
    const ok = answer(s, { kind: 'declareBlockers', blocks: [] });
    expect(ok.pending?.kind).not.toBe('declareBlockers');
  });
  it('with one of their creatures tapped (it can\'t block), blocking with the other is not legal: it can\'t be blocked (Scryfall ruling 2014-02-01)', () => {
    const { s, kraken, bears } = setup(true);
    expect(bears.some((b) => s.objects[b]!.tapped)).toBe(true);
    // no set of blockers is legal, so the defending player is never asked to block it: combat goes on to the second main phase
    expect(s.pending?.kind).not.toBe('declareBlockers');
    expect(s.turn.step).toBe('main2');
    expect(kraken).toBeDefined();
  });
  it('hexproof: it has it unless it is attacking or blocking', () => {
    const idle = scenario([], { defs: DEFS, p1: { battlefield: ['Test Tide Kraken'] } });
    const k = find(idle, 'Test Tide Kraken', 'battlefield', 'p1');
    expect(hasKeyword(getChars(idle, k), 'hexproof')).toBe(true);
    const { s, kraken } = setup();
    expect(hasKeyword(getChars(s, kraken), 'hexproof')).toBe(false);
  });
});

describe('CR 614.1a, 120.3, 611.2a: "If a source you control would deal damage this turn, it deals double that damage instead."', () => {
  const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
  it('damage a source you control deals this turn is doubled; without the effect it is not', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Ember Bolt'] } });
    s = resolveAll(drive(act(s, castOf(s, find(s, 'Test Ember Bolt', 'hand', 'p1')))));
    expect(life(s, 'p2')).toBe(18);
    let t = scenario([], { defs: DEFS, p1: { hand: ['Test Twin Surge', 'Test Ember Bolt'] } });
    t = resolveAll(drive(act(t, castOf(t, find(t, 'Test Twin Surge', 'hand', 'p1')))));
    t = resolveAll(drive(act(t, castOf(t, find(t, 'Test Ember Bolt', 'hand', 'p1')))));
    expect(life(t, 'p2')).toBe(16);
  });
  it('only your sources and only this turn: the opponent\'s bolt on their own turn deals its plain damage', () => {
    let t = scenario([], { defs: DEFS, p1: { hand: ['Test Twin Surge'] }, p2: { hand: ['Test Ember Bolt'] } });
    t = resolveAll(drive(act(t, castOf(t, find(t, 'Test Twin Surge', 'hand', 'p1')))));
    t = advanceTo(t, 2, 'main1');
    t = resolveAll(drive(act(t, castOf(t, find(t, 'Test Ember Bolt', 'hand', 'p2'), 'p2'))));
    expect(life(t, 'p1')).toBe(18);
  });
});

describe('CR 116.2b, 118.3: the cost-only ban is for casting and activating, not for special actions', () => {
  it('only a spell or an ability is paid for with a cost the ban reads; turning a permanent face up, plotting, unlocking are special actions', () => {
    expect(isCastOrActivate({ kind: 'spell', id: 'o1' as ObjectId })).toBe(true);
    expect(isCastOrActivate({ kind: 'ability', id: 'o1' as ObjectId })).toBe(true);
    for (const kind of ['faceUp', 'special', 'unlock'] as const) expect(isCastOrActivate({ kind, id: 'o1' as ObjectId }), kind).toBe(false);
    expect(isCastOrActivate(undefined)).toBe(false);
  });
});
