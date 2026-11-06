/**
 * Commander effort (coordinator C), round edh-c-92 (EDHREC ranks 19,001-19,500, later pass): the round's readings played through the engine with synthetic cards
 * (invented names, design 6.10), compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its
 * negative case. CR cites are checked against the Comprehensive Rules text of 2026-09-25.
 *
 *   CR 509.1b, 613.1f, 702.26a          "Enchanted creature has phasing and can't be blocked except by Walls." (Cloak of Invisibility)
 *   CR 613.4b, 613.1f, 603.2, 118.12    "Enchanted creature has base power 0 and has "At the beginning of your upkeep, you lose 1 life unless you sacrifice this creature."" (Withercrown)
 *   CR 101.4, 608.2d, 110.2, 400.7      "Each other player may return a creature card from their graveyard to the battlefield." (Enslaved Horror)
 *   CR 702.16a-b, 201.2, 607.2d         "You have protection from the chosen card name." (Runed Halo)
 *   CR 702.48a-c, 118.9, 601.2b         "Fox offering" (Patron of the Kitsune, and the other Patrons)
 *   CR 201.2, 602.2b                    "Discard another card named Baru, Fist of Krosa: ..." (the grandeur cards, a name with a comma)
 */
import { describe, expect, it } from 'vitest';
import { getChars, type GameState, type ObjectId } from '../../../src/index';
import { hasKeyword } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, labels, life, pass, reject, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers, toDeclareBlockers } from '../../m4/helpers';
import { card, cast, full, pt, resolveAll, settle } from '../cmd3/helpers';
import { castCard } from '../../m5/announce/support';
import { advanceTo as advanceToStep } from '../../m5/helpers';
import { drive } from '../../m5/cr-examples/helpers';
import { synthetic } from '../../m6/costs/support';

const obj = (id: ObjectId) => ({ kind: 'object' as const, id });
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const onField = (s: GameState, name: string, player?: string): ObjectId | undefined => s.zones.battlefield.find((id) => nameOf(s, id) === name && (player === undefined || s.objects[id]!.controller === player));
const inYard = (s: GameState, name: string, player = 'p1'): boolean => (s.zones.graveyard[player] ?? []).some((id) => nameOf(s, id) === name);

const BEAR = card('Test Bear', 'Creature — Bear', '', ['3', '3']);
const WALL = card('Test Wall', 'Creature — Wall', '', ['0', '4']);
const BIRD = card('Test Bird', 'Creature — Bird', 'Flying', ['1', '4']);
const CLOAK = card('Test Cloak', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature has phasing and can\'t be blocked except by Walls.');
const CROWN = card('Test Crown', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature has base power 0 and has "At the beginning of your upkeep, you lose 1 life unless you sacrifice this creature."');
const HORROR = card('Test Horror', 'Creature — Horror', 'When this creature enters, each other player may return a creature card from their graveyard to the battlefield.', ['2', '2']);
const GRUNT = card('Test Grunt', 'Creature — Goblin', '', ['2', '2']);
const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.');
const HALO = card('Test Halo', 'Enchantment', 'As this enchantment enters, choose a card name.\nYou have protection from the chosen card name.');
const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 3 damage to target player.', undefined, '{0}');
const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to target player.', undefined, '{0}');
const WAVE = card('Test Wave', 'Instant', 'Test Wave deals 2 damage to each player.', undefined, '{0}');
const BARU = card('Test Baru, Fist of Tests', 'Legendary Creature — Druid', 'Grandeur — Discard another card named Test Baru, Fist of Tests: Create an X/X green Wurm creature token, where X is the number of lands you control.', ['2', '2']);
const WRAITH = card('Test Wraith, Lich of Tests', 'Legendary Creature — Zombie', 'You may cast this card from your graveyard if a creature not named Test Wraith, Lich of Tests died this turn.', ['3', '3']);
const DEFS = [WRAITH, BEAR, WALL, BIRD, CLOAK, CROWN, HORROR, GRUNT, DOOM, HALO, ZAP, BOLT, WAVE, BARU];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 509.1b, 613.1f, 702.26a: "Enchanted creature has phasing and can\'t be blocked except by Walls." (Cloak of Invisibility)', () => {
  const attack = (): GameState => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Cloak'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Wall', 'Test Bird'] } });
    s = resolveAll(cast(s, 'Test Cloak', { targets: [obj(find(s, 'Test Bear', 'battlefield', 'p1'))] }));
    s = passUntil(s, (x) => x.turn.activePlayer === 'p1' && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'main phase');
    return toDeclareBlockers(declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Bear', 'battlefield', 'p1'), 'p2']]));
  };
  it('the enchanted creature has phasing; a Wall can block it, a creature that is not a Wall cannot', () => {
    const s = attack();
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(hasKeyword(getChars(s, bear)!, 'phasing')).toBe(true);
    expect(() => declareBlockers(s, [[find(s, 'Test Bird', 'battlefield', 'p2'), bear]])).toThrow();
    expect(declareBlockers(s, [[find(s, 'Test Wall', 'battlefield', 'p2'), bear]]).turn).toBeDefined();
  });
  it('negative: another creature of the enchanted player has neither phasing nor the restriction', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Cloak'], battlefield: ['Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Bird'] } });
    const [a, b] = findAll(s, 'Test Bear', 'battlefield', 'p1') as [ObjectId, ObjectId];
    s = resolveAll(cast(s, 'Test Cloak', { targets: [obj(a)] }));
    expect(hasKeyword(getChars(s, a)!, 'phasing')).toBe(true);
    expect(hasKeyword(getChars(s, b)!, 'phasing')).toBe(false);
    s = passUntil(s, (x) => x.turn.activePlayer === 'p1' && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'main phase');
    s = toDeclareBlockers(declareAttackers(toDeclareAttackers(s), [[b, 'p2']]));
    expect(declareBlockers(s, [[find(s, 'Test Bird', 'battlefield', 'p2'), b]]).turn).toBeDefined();
  });
});

describe('CR 613.4b, 613.1f, 603.2, 118.12: "Enchanted creature has base power 0 and has \\"At the beginning of your upkeep, you lose 1 life unless you sacrifice this creature.\\"" (Withercrown)', () => {
  const board = (): GameState => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Crown'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] } });
    s = resolveAll(cast(s, 'Test Crown', { targets: [obj(findAll(s, 'Test Bear', 'battlefield', 'p2')[0]!)] }));
    return s;
  };
  it('the enchanted creature has base power 0 (toughness unchanged); another creature keeps its power', () => {
    const s = board();
    const [a, b] = findAll(s, 'Test Bear', 'battlefield', 'p2') as [ObjectId, ObjectId];
    expect(pt(s, a)).toBe('0/3');
    expect(pt(s, b)).toBe('3/3');
  });
  it('base power is not a lasting stamp: +1/+1 counters still add to the 0 base', () => {
    const s = board();
    const a = findAll(s, 'Test Bear', 'battlefield', 'p2')[0]!;
    s.objects[a]!.counters['+1/+1'] = 2;
    expect(pt(s, a)).toBe('2/5');
  });
  it('its controller loses 1 life at their upkeep unless they sacrifice it: declining the sacrifice costs 1 life and keeps the creature', () => {
    let s = advanceTo(board(), 2, 'upkeep');
    const before = life(s, 'p2');
    s = resolveAll(s, { yes: false });
    expect(life(s, 'p2')).toBe(before - 1);
    expect(findAll(s, 'Test Bear', 'battlefield', 'p2').length).toBe(2);
  });
  it('negative: the opponent of the creature loses nothing at their own upkeep, and at the creature controller\'s upkeep they sacrifice it to keep their life', () => {
    let s = advanceTo(board(), 2, 'upkeep');
    const before = life(s, 'p2');
    s = resolveAll(s, { yes: true });
    expect(life(s, 'p2')).toBe(before);
    expect(findAll(s, 'Test Bear', 'battlefield', 'p2').length).toBe(1);
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 101.4, 608.2d, 110.2, 400.7: "Each other player may return a creature card from their graveyard to the battlefield." (Enslaved Horror)', () => {
  const board = (): GameState => scenario([], { defs: DEFS, p1: { hand: ['Test Horror'], graveyard: ['Test Grunt'] }, p2: { graveyard: ['Test Grunt', 'Test Doom'] } });
  it('an opponent who accepts puts a creature card from their own graveyard onto the battlefield under their control', () => {
    let s = board();
    const grunt = find(s, 'Test Grunt', 'graveyard', 'p2');
    s = resolveAll(cast(s, 'Test Horror'), { objects: [grunt] });
    expect(onField(s, 'Test Grunt', 'p2')).toBeDefined();
    expect(inYard(s, 'Test Doom', 'p2')).toBe(true);
  });
  it('negative: the controller returns nothing (their own creature card stays), and an opponent who declines keeps their graveyard', () => {
    let s = resolveAll(cast(board(), 'Test Horror'));
    expect(onField(s, 'Test Grunt')).toBeUndefined();
    expect(inYard(s, 'Test Grunt', 'p1')).toBe(true);
    expect(inYard(s, 'Test Grunt', 'p2')).toBe(true);
    s = board();
    s = resolveAll(cast(s, 'Test Horror'), { objects: [] });
    expect(onField(s, 'Test Grunt')).toBeUndefined();
  });
  it('negative: only creature cards are offered, never the instant', () => {
    let s = cast(board(), 'Test Horror');
    for (let guard = 0; guard < 20 && s.pending?.kind !== 'chooseObjects'; guard++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s);
    expect(s.pending?.kind).toBe('chooseObjects');
    expect((s.pending as { options: ObjectId[] }).options.map((id) => nameOf(s, id))).toEqual(['Test Grunt']);
  });
});

describe('CR 702.16a-b, 201.2, 607.2d: "You have protection from the chosen card name." (Runed Halo)', () => {
  const board = (name: string): GameState => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Halo', 'Test Zap', 'Test Bolt', 'Test Wave'] } });
    s = cast(s, 'Test Halo');
    for (let guard = 0; guard < 10 && s.pending?.kind !== 'chooseName'; guard++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s);
    s = resolveAll(settle(answer(s, { kind: 'chooseName', name })));
    return s;
  };
  it('a spell with the chosen name cannot target you, a spell with another name can', () => {
    const s = board('Test Zap');
    expect(() => cast(s, 'Test Zap', { targets: [{ kind: 'player', id: 'p1' }] })).toThrow(/not a legal target/); // protection from the name: CR 702.16b
    expect(life(s, 'p1')).toBe(20);
    const bolted = resolveAll(cast(s, 'Test Bolt', { targets: [{ kind: 'player', id: 'p1' }] }));
    expect(life(bolted, 'p1')).toBe(17);
  });
  it('damage from a source with the chosen name is prevented; the same damage from another name is not, and the opponent is hurt either way', () => {
    const named = resolveAll(cast(board('Test Wave'), 'Test Wave'));
    expect(life(named, 'p1')).toBe(20);
    expect(life(named, 'p2')).toBe(18);
    const other = resolveAll(cast(board('Test Zap'), 'Test Wave'));
    expect(life(other, 'p1')).toBe(18);
    expect(life(other, 'p2')).toBe(18);
  });
});

describe('CR 702.48a-c, 118.9, 601.2b: "Fox offering" (Patron of the Kitsune and the other Patrons)', () => {
  const PATRON = synthetic('Test Patron', 'Legendary Creature — Spirit', '{4}{W}{W}', 'Fox offering\nWhenever a creature attacks, you may gain 1 life.', { power: '4', toughness: '4' });
  const FOX = synthetic('Test Fox', 'Creature — Fox', '{1}{W}', '', { power: '1', toughness: '1' });
  const BEARC = synthetic('Test Bear Cub', 'Creature — Bear', '{1}{W}', '', { power: '2', toughness: '2' });
  const GOB = synthetic('Test Goblin Patron', 'Legendary Creature — Spirit', '{4}{W}{W}', 'Goblin offering', { power: '4', toughness: '4' });
  const GOBLIN = synthetic('Test Goblin', 'Creature — Goblin', '{W}', '', { power: '1', toughness: '1' });
  const board = (battlefield: string[], lands: number, hand = 'Test Patron'): GameState =>
    scenario(['Plains'], { defs: [PATRON, FOX, BEARC, GOB, GOBLIN], p1: { hand: [hand], battlefield: [...battlefield, ...Array(lands).fill('Plains')] } });
  const manaPaid = (s: GameState): number => s.objects[s.zones.stack[0]!]!.stack!.costsPaid.manaSpent!.length;
  it('is full', () => {
    expect(full(PATRON)).toBe(true);
    expect(full(GOB)).toBe(true);
  });
  it('at the beginning of combat it is offered; sacrificing a Fox ({1}{W}) takes off {1}{W}: the spell costs {3}{W}', () => {
    let s = advanceToStep(board(['Test Fox'], 4), 1, 'beginCombat');
    expect(labels(s, 'p1')).toContain('Cast Test Patron (offering)');
    s = castCard(s, 'Test Patron', { method: 'offering' });
    expect((s.pending as { options: ObjectId[] }).options.map((id) => nameOf(s, id))).toEqual(['Test Fox']);
    s = answer(s, { kind: 'chooseObjects', ids: [onField(s, 'Test Fox')!] });
    s = drive(s);
    expect(s.zones.stack.map((id) => nameOf(s, id))).toEqual(['Test Patron']);
    expect(inYard(s, 'Test Fox')).toBe(true);
    expect(manaPaid(s)).toBe(4);
  });
  it('negative: a creature that is not a Fox cannot be sacrificed for it, and with no Fox there is no offering cast', () => {
    expect(labels(advanceToStep(board(['Test Bear Cub'], 6), 1, 'beginCombat'), 'p1')).not.toContain('Cast Test Patron (offering)');
    expect(labels(advanceToStep(board([], 6), 1, 'beginCombat'), 'p1')).not.toContain('Cast Test Patron (offering)');
  });
  it('the Goblin Patron wants a Goblin, not a Fox', () => {
    expect(labels(advanceToStep(board(['Test Goblin'], 6, 'Test Goblin Patron'), 1, 'beginCombat'), 'p1')).toContain('Cast Test Goblin Patron (offering)');
    expect(labels(advanceToStep(board(['Test Fox'], 6, 'Test Goblin Patron'), 1, 'beginCombat'), 'p1')).not.toContain('Cast Test Goblin Patron (offering)');
  });
});

describe('CR 201.2, 602.2b: "Discard another card named <own name, with a comma>: ..." (Baru, Fist of Krosa; grandeur)', () => {
  const activate = (s: GameState, picks: Parameters<typeof settle>[1] = {}): GameState =>
    resolveAll(settle(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Baru, Fist of Tests', 'battlefield', 'p1'), ability: 'p:0:0' } as never), picks), picks);
  it('discarding the other copy makes an X/X Wurm, X the number of lands you control', () => {
    let s = scenario(['Forest'], { defs: DEFS, p1: { hand: ['Test Baru, Fist of Tests'], battlefield: ['Test Baru, Fist of Tests', 'Forest', 'Forest', 'Forest'] } });
    s = activate(s);
    expect(inYard(s, 'Test Baru, Fist of Tests')).toBe(true);
    const wurm = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token');
    expect(wurm).toBeDefined();
    expect(pt(s, wurm!)).toBe('3/3');
  });
  it('negative: with no other card of the name in hand the ability cannot be activated', () => {
    const s = scenario(['Forest'], { defs: DEFS, p1: { hand: ['Test Bear'], battlefield: ['Test Baru, Fist of Tests', 'Forest'] } });
    expect(() => reject(s, { type: 'activate', player: 'p1', source: find(s, 'Test Baru, Fist of Tests', 'battlefield', 'p1'), ability: 'p:0:0' } as never)).not.toThrow();
  });
});

describe('CR 201.2, 117.1, 601.3: "You may cast this card from your graveyard if a creature not named <own name, with a comma> died this turn." (Ebondeath, Dracolich; collateral of the comma-name reading)', () => {
  const canCast = (s: GameState): boolean => labels(s, 'p1').some((l) => l.startsWith('Cast Test Wraith'));
  const board = (): GameState => scenario(['Swamp'], { defs: DEFS, p1: { hand: ['Test Doom'], graveyard: ['Test Wraith, Lich of Tests'], battlefield: ['Test Bear', 'Test Wraith, Lich of Tests'] } });
  it('is automated; with nothing dead this turn it cannot be cast; after another creature died it can', () => {
    expect(full(WRAITH)).toBe(true);
    const s0 = board();
    expect(canCast(s0)).toBe(false);
    const s = resolveAll(cast(s0, 'Test Doom', { targets: [obj(find(s0, 'Test Bear', 'battlefield', 'p1'))] }));
    expect(canCast(s)).toBe(true);
  });
  it('negative: when the only creature that died is a creature with that name, it cannot be cast', () => {
    const s0 = board();
    const s = resolveAll(cast(s0, 'Test Doom', { targets: [obj(onField(s0, 'Test Wraith, Lich of Tests', 'p1')!)] }));
    expect(canCast(s)).toBe(false);
  });
});
