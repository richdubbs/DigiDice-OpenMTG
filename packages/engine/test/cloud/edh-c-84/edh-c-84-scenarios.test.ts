/**
 * Commander effort (coordinator C), round edh-c-84: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default compiler.
 * Alice (p1) is the active player. Each test is named after the rule it checks and has its negative case. CR cites are checked against the Comprehensive Rules text of 2026-09-25.
 *
 *   CR 614.1a, 510.2, 120.3, 122.1, 701.17   "If ~ would deal combat damage to a player, instead put that many +1/+1 counters on ~ and that player mills that many cards."
 *   CR 601.2f, 118.7, 201.3, 607.2d, 602.2b  "Spells your opponents cast with the chosen name cost {2} more to cast." / "Activated abilities of sources with the chosen name cost {2} more to activate unless they're mana abilities."
 *   CR 614.12a, 701.20a, 201.3, 601.3        "As ~ enters, each opponent reveals their hand. You choose the name of a nonland card revealed this way. Your opponents can't cast spells with the chosen name."
 *   CR 608.2e, 701.21a, 701.9a, 101.4        "Each player chooses a number of lands they control equal to the number of lands controlled by the player who controls the fewest, then sacrifices the rest. Players ..."
 *   CR 602.5b, 506.1, 510.4                  "Activate only before the combat damage step."
 *   CR 406.1, 108.3, 602.5b                  "Activate only if you own a card in exile."
 *   CR 208.1, 107.3, 608.2b                  "destroy target non-Elf creature an opponent controls with power X or less, where X is the number of lands you control."
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, legal, life, pass, reject, scenario } from '../../m3/scenario';
import { card, counters, full, settle } from '../cmd3/helpers';
import { runCombat } from '../../m4/helpers';

const lib = (s: GameState, p: string): number => (s.zones.library[p] ?? []).length;
const yard = (s: GameState, p: string): number => (s.zones.graveyard[p] ?? []).length;
const hand = (s: GameState, p: string): string[] => (s.zones.hand[p] ?? []).map((id) => s.objects[id]!.defId);
const onField = (s: GameState, p: string, type: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.defs[s.objects[id]!.defId]!.faces[0]!.typeLine.includes(type));
const refuse = (s: GameState, name: string): string => reject(s, { type: 'answer', player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'chooseName', name } }).message;
const castable = (s: GameState, p: string, name: string): boolean => legal(s, p, 'cast').some((a) => (a as { object?: string }).object === find(s, name, 'hand', p));

// ---- Szadek ---------------------------------------------------------------------------------------------------------------------------------------------------
const SPIRIT = card('Test Secret Spirit', 'Creature — Spirit', 'If ~ would deal combat damage to a player, instead put that many +1/+1 counters on ~ and that player mills that many cards.', ['3', '3']);
const PLAIN = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
const WALL = card('Test Stone Wall', 'Creature — Wall', '', ['0', '5']);

describe('CR 614.1a, 510.2, 120.3, 122.1, 701.17: "If ~ would deal combat damage to a player, instead put that many +1/+1 counters on ~ and that player mills that many cards"', () => {
  const board = (blocker = false): GameState => scenario(['Island', 'Mountain'], { defs: [SPIRIT, PLAIN, WALL], p1: { battlefield: ['Test Secret Spirit', 'Test Plain Bear'] }, p2: { library: Array(10).fill('Island') as string[], ...(blocker ? { battlefield: ['Test Stone Wall'] } : {}) } });
  it('is automated', () => expect(full(SPIRIT)).toBe(true));
  it('unblocked, it deals no damage: it gets three +1/+1 counters and the player mills three cards', () => {
    const s0 = board();
    const spirit = find(s0, 'Test Secret Spirit', 'battlefield', 'p1');
    const before = lib(s0, 'p2');
    const s = runCombat(s0, { attack: [[spirit]] });
    expect(life(s, 'p2')).toBe(20);
    expect(counters(s, spirit, '+1/+1')).toBe(3);
    expect(lib(s, 'p2')).toBe(before - 3);
    expect(yard(s, 'p2')).toBe(3);
  });
  it('the negative case: another creature without the ability deals its damage as usual, and the Spirit blocked by a creature deals damage to that creature (not a player)', () => {
    const s0 = board();
    const bear = find(s0, 'Test Plain Bear', 'battlefield', 'p1');
    const s = runCombat(s0, { attack: [[bear]] });
    expect(life(s, 'p2')).toBe(18);
    expect(lib(s, 'p2')).toBe(lib(s0, 'p2'));
    const b0 = board(true);
    const spirit = find(b0, 'Test Secret Spirit', 'battlefield', 'p1');
    const wall = find(b0, 'Test Stone Wall', 'battlefield', 'p2');
    const b = runCombat(b0, { attack: [[spirit]], block: [[wall, spirit]] });
    expect(b.objects[wall]!.damage).toBe(3);
    expect(counters(b, spirit, '+1/+1')).toBe(0);
    expect(lib(b, 'p2')).toBe(lib(b0, 'p2'));
  });
});

// ---- Anointed Peacekeeper -------------------------------------------------------------------------------------------------------------------------------------
const WARDEN = card('Test Warden', 'Artifact', "As ~ enters, look at an opponent's hand, then choose any card name.\nSpells your opponents cast with the chosen name cost {2} more to cast.\nActivated abilities of sources with the chosen name cost {2} more to activate unless they're mana abilities.");
const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to any target.', undefined, '{R}');
const FONT = card('Test Font', 'Artifact', '{1}, {T}: You gain 1 life.');
const DRUID = card('Test Druid', 'Creature — Elf Druid', '{T}: Add {G}.', ['1', '1']);

describe('CR 601.2f, 118.7, 201.3, 607.2d, 602.2b, 605.1a: "Spells your opponents cast with the chosen name cost {2} more" and "activated abilities of sources with the chosen name cost {2} more to activate unless they\'re mana abilities"', () => {
  const named = (name: string, p2lands: number, p1lands = 2): GameState => {
    const s0 = scenario(['Island', 'Mountain'], { defs: [WARDEN, BOLT, FONT, DRUID], p1: { hand: ['Test Warden', 'Test Bolt'], battlefield: ['Test Font', 'Test Druid', 'Mountain', ...Array<string>(p1lands).fill('Island')] }, p2: { hand: ['Test Bolt'], battlefield: Array<string>(p2lands).fill('Mountain') } });
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Warden', 'hand', 'p1') }));
    for (let i = 0; i < 6 && s.pending?.kind !== 'chooseName'; i++) s = settle(pass(s));
    expect(s.pending).toMatchObject({ kind: 'chooseName', what: 'cardName' });
    return settle(answer(s, { kind: 'chooseName', name }));
  };
  const activatable = (s: GameState, name: string): boolean => legal(s, 'p1', 'activate').some((a) => (a as { object?: string }).object === find(s, name, 'battlefield', 'p1') && !(a as { isMana?: boolean }).isMana);
  it('is automated', () => expect(full(WARDEN), JSON.stringify(WARDEN.automation)).toBe(true));
  it('an opponent\'s Test Bolt costs {2} more: one Mountain is not enough, three are; a card of another name is untouched', () => {
    const one = named('Test Bolt', 1);
    expect(castable(pass(one), 'p2', 'Test Bolt')).toBe(false);
    const two = named('Test Bolt', 2);
    expect(castable(pass(two), 'p2', 'Test Bolt')).toBe(false);
    const three = named('Test Bolt', 3);
    expect(castable(pass(three), 'p2', 'Test Bolt')).toBe(true);
    const other = named('Test Font', 1);
    expect(castable(pass(other), 'p2', 'Test Bolt')).toBe(true);
  });
  it('the negative case: the Warden\'s controller casts the chosen card at its normal cost ("your opponents")', () => {
    const s = named('Test Bolt', 1);
    expect(castable(s, 'p1', 'Test Bolt')).toBe(true);
  });
  it('an activated ability of the named source costs {2} more: the Font\'s {1} becomes {3} (with 3 other mana sources it is offered, with 2 not); an unnamed Font costs {1}', () => {
    // sources: Mountain + Druid ({T}: Add {G}) + the Islands, the Font itself taps as part of its cost
    expect(activatable(named('Test Font', 1, 1), 'Test Font')).toBe(true); // Mountain, Island and the Druid pay exactly {3} (the Font's own {T} is a cost, not mana)
    expect(activatable(named('Test Font', 1, 0), 'Test Font')).toBe(false); // two sources: not enough for {3}, though enough for {1}
    expect(activatable(named('Test Druid', 1, 0), 'Test Font')).toBe(true); // another name: the Font costs {1}
  });
  it('a mana ability of the named source is not taxed ("unless they\'re mana abilities")', () => {
    const s = named('Test Druid', 1, 0);
    const druid = find(s, 'Test Druid', 'battlefield', 'p1');
    expect(legal(s, 'p1', 'activate').some((a) => (a as { object?: string }).object === druid)).toBe(true);
  });
});

// ---- Alhammarret ----------------------------------------------------------------------------------------------------------------------------------------------
const ARBITER = card('Test Arbiter', 'Creature — Sphinx', "Flying\nAs ~ enters, each opponent reveals their hand. You choose the name of a nonland card revealed this way.\nYour opponents can't cast spells with the chosen name.", ['3', '5']);
const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 1 damage to any target.', undefined, '{R}');

describe('CR 614.12a, 701.20a, 201.3, 601.3: "As ~ enters, each opponent reveals their hand. You choose the name of a nonland card revealed this way." and "Your opponents can\'t cast spells with the chosen name"', () => {
  const toChoice = (p2hand: string[], p2lands = 3): GameState => {
    const s0 = scenario(['Island', 'Mountain'], { defs: [ARBITER, BOLT, ZAP], p1: { hand: ['Test Arbiter', 'Test Bolt'], battlefield: ['Mountain'] }, p2: { hand: p2hand, battlefield: Array<string>(p2lands).fill('Mountain') } });
    return settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Arbiter', 'hand', 'p1') }));
  };
  it('is automated', () => expect(full(ARBITER), JSON.stringify(ARBITER.automation)).toBe(true));
  it('the choice offers the nonland cards of the revealed hand only (not a land, not a card nobody revealed); the chosen card can\'t be cast by an opponent, a card of another name can', () => {
    let s = toChoice(['Test Bolt', 'Test Zap', 'Mountain']);
    for (let i = 0; i < 6 && s.pending?.kind !== 'chooseName'; i++) s = settle(pass(s));
    expect(s.pending).toMatchObject({ kind: 'chooseName', what: 'cardName', options: expect.arrayContaining(['Test Bolt', 'Test Zap']) });
    expect((s.pending as unknown as { options: string[] }).options).not.toContain('Mountain');
    expect(refuse(s, 'Test Arbiter')).toBeTruthy();
    s = settle(answer(s, { kind: 'chooseName', name: 'Test Bolt' }));
    expect(castable(s, 'p1', 'Test Bolt')).toBe(true); // "your opponents": the Arbiter's controller may cast the named card
    s = pass(s);
    expect(castable(s, 'p2', 'Test Bolt')).toBe(false);
    expect(castable(s, 'p2', 'Test Zap')).toBe(true);
  });
  it('the negative case: with no nonland card in the opponents\' hands no name is chosen and nothing is stopped; the controller\'s own copy is never stopped', () => {
    let s = toChoice(['Mountain', 'Mountain']);
    for (let i = 0; i < 3 && s.pending?.kind !== 'priority'; i++) s = settle(s);
    expect(s.pending?.kind).not.toBe('chooseName');
    expect(castable(s, 'p1', 'Test Bolt')).toBe(true);
    const t = pass(s);
    expect(t.pending?.player === 'p2' || t.pending?.kind === 'priority').toBe(true);
  });
});

// ---- Balance --------------------------------------------------------------------------------------------------------------------------------------------------
const SCALE = card('Test Scale', 'Sorcery', 'Each player chooses a number of lands they control equal to the number of lands controlled by the player who controls the fewest, then sacrifices the rest. Players sacrifice creatures and discard cards the same way.');
const CLERK = card('Test Clerk', 'Artifact', '{T}: Each player chooses a number of lands they control equal to the number of lands controlled by the player who controls the fewest, then sacrifices the rest. Players discard cards and sacrifice creatures the same way.');
const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', ['1', '1']);

describe('CR 608.2e, 701.21a, 701.9a, 101.4: "Each player chooses a number of lands ... equal to the number of lands controlled by the player who controls the fewest, then sacrifices the rest. Players sacrifice creatures and discard cards the same way."', () => {
  const board = (extra: { p1Lands?: number; p2Lands?: number; p2Creatures?: number; p2Hand?: number } = {}): GameState => scenario(['Island', 'Mountain'], {
    defs: [SCALE, CLERK, GOBLIN],
    p1: { hand: ['Test Scale', 'Island', 'Island', 'Island', 'Island'], battlefield: [...Array<string>(extra.p1Lands ?? 4).fill('Island'), 'Test Goblin', 'Test Goblin', 'Test Goblin', 'Test Clerk'] },
    p2: { hand: Array<string>(extra.p2Hand ?? 1).fill('Island'), battlefield: [...Array<string>(extra.p2Lands ?? 2).fill('Island'), ...Array<string>(extra.p2Creatures ?? 1).fill('Test Goblin')] },
  });
  it('is automated, in both orders of the later parts', () => {
    expect(full(SCALE), JSON.stringify(SCALE.automation)).toBe(true);
    expect(full(CLERK), JSON.stringify(CLERK.automation)).toBe(true);
  });
  it('each player keeps as many lands, creatures and cards as the player with the fewest (2 lands, 1 creature, 1 card in hand): the other player loses the rest, the player with the fewest loses nothing', () => {
    const s0 = board();
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Scale', 'hand', 'p1') }));
    for (let i = 0; i < 4 && s.zones.stack.length > 0; i++) s = settle(pass(s));
    expect(onField(s, 'p1', 'Land')).toHaveLength(2);
    expect(onField(s, 'p1', 'Creature')).toHaveLength(1);
    expect(hand(s, 'p1')).toHaveLength(1);
    expect(onField(s, 'p2', 'Land')).toHaveLength(2);
    expect(onField(s, 'p2', 'Creature')).toHaveLength(1);
    expect(hand(s, 'p2')).toHaveLength(1);
  });
  it('the negative case: with equal numbers nothing is lost; a player with no lands makes the other sacrifice all of theirs', () => {
    const eq = board({ p1Lands: 2 });
    let s = settle(act(eq, { type: 'cast', player: 'p1', card: find(eq, 'Test Scale', 'hand', 'p1') }));
    for (let i = 0; i < 4 && s.zones.stack.length > 0; i++) s = settle(pass(s));
    expect(onField(s, 'p1', 'Land')).toHaveLength(2);
    expect(onField(s, 'p2', 'Land')).toHaveLength(2);
    const none = board({ p2Lands: 0 });
    let t = settle(act(none, { type: 'cast', player: 'p1', card: find(none, 'Test Scale', 'hand', 'p1') }));
    for (let i = 0; i < 4 && t.zones.stack.length > 0; i++) t = settle(pass(t));
    expect(onField(t, 'p1', 'Land')).toHaveLength(0);
  });
  it('the other order (cards, then creatures) is the same rule', () => {
    const s0 = board();
    const clerk = find(s0, 'Test Clerk', 'battlefield', 'p1');
    const a = legal(s0, 'p1', 'activate').find((x) => (x as { object?: string }).object === clerk)!;
    let s = settle(act(s0, a.action));
    for (let i = 0; i < 4 && s.zones.stack.length > 0; i++) s = settle(pass(s));
    expect(onField(s, 'p1', 'Land')).toHaveLength(2);
    expect(onField(s, 'p1', 'Creature')).toHaveLength(1);
    expect(hand(s, 'p1').length).toBeLessThanOrEqual(1 + 1);
  });
});

// ---- Angus Mackenzie ------------------------------------------------------------------------------------------------------------------------------------------
const SEER = card('Test Seer', 'Creature — Human Wizard', '{T}: Prevent all combat damage that would be dealt this turn. Activate only before the combat damage step.', ['1', '1']);

describe('CR 602.5b, 506.1, 510.4: "Activate only before the combat damage step"', () => {
  const board = (): GameState => scenario(['Island', 'Mountain'], { defs: [SEER, PLAIN], p1: { battlefield: ['Test Seer', 'Test Plain Bear'] } });
  const offered = (s: GameState): boolean => legal(s, 'p1', 'activate').some((a) => (a as { object?: string }).object === find(s, 'Test Seer', 'battlefield', 'p1'));
  it('is automated', () => expect(full(SEER)).toBe(true));
  it('it can be activated in the first main phase and the declare blockers step, and prevents the combat damage', () => {
    const s0 = board();
    expect(offered(s0)).toBe(true);
    const seer = find(s0, 'Test Seer', 'battlefield', 'p1');
    const a = legal(s0, 'p1', 'activate').find((x) => (x as { object?: string }).object === seer)!;
    let s = settle(act(s0, a.action));
    for (let i = 0; i < 4 && s.zones.stack.length > 0; i++) s = settle(pass(s));
    const bear = find(s, 'Test Plain Bear', 'battlefield', 'p1');
    s = runCombat(s, { attack: [[bear]] });
    expect(life(s, 'p2')).toBe(20);
  });
  it('the negative case: in the second main phase it is not offered', () => {
    const s = advanceTo(board(), 1, 'main2');
    expect(offered(s)).toBe(false);
  });
});

// ---- Dreadlight Monstrosity -----------------------------------------------------------------------------------------------------------------------------------
const LURKER = card('Test Lurker', 'Creature — Horror', '{0}: ~ can\'t be blocked this turn. Activate only if you own a card in exile.', ['3', '3']);

describe('CR 406.1, 108.3, 602.5b: "Activate only if you own a card in exile"', () => {
  const offered = (s: GameState): boolean => legal(s, 'p1', 'activate').some((a) => (a as { object?: string }).object === find(s, 'Test Lurker', 'battlefield', 'p1'));
  it('is automated', () => expect(full(LURKER)).toBe(true));
  it('it is offered when you own a card in exile, not otherwise, and not for a card an opponent owns', () => {
    const none = scenario(['Island', 'Mountain'], { defs: [LURKER, PLAIN], p1: { battlefield: ['Test Lurker'] } });
    expect(offered(none)).toBe(false);
    const mine = scenario(['Island', 'Mountain'], { defs: [LURKER, PLAIN], p1: { battlefield: ['Test Lurker'], exile: ['Test Plain Bear'] } });
    expect(offered(mine)).toBe(true);
    const theirs = scenario(['Island', 'Mountain'], { defs: [LURKER, PLAIN], p1: { battlefield: ['Test Lurker'] }, p2: { exile: ['Test Plain Bear'] } });
    expect(offered(theirs)).toBe(false);
  });
});

// ---- Invasion of Lorwyn ---------------------------------------------------------------------------------------------------------------------------------------
const REAPER = card('Test Reaper', 'Creature — Elemental', 'When ~ enters, destroy target non-Elf creature an opponent controls with power X or less, where X is the number of lands you control.', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['4', '4']);
const IMP = card('Test Imp', 'Creature — Imp', '', ['3', '2']);
const ELF = card('Test Elf', 'Creature — Elf', '', ['1', '1']);

describe('CR 208.1, 107.3, 608.2b: "destroy target non-Elf creature an opponent controls with power X or less, where X is the number of lands you control"', () => {
  const cast = (lands: number): GameState => {
    const s0 = scenario(['Island', 'Mountain'], { defs: [REAPER, OGRE, IMP, ELF], p1: { hand: ['Test Reaper'], battlefield: Array<string>(lands).fill('Island') }, p2: { battlefield: ['Test Ogre', 'Test Imp', 'Test Elf'] } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Reaper', 'hand', 'p1') });
    for (let i = 0; i < 6 && s.pending?.kind !== 'chooseTargets' && s.zones.stack.length > 0; i++) s = pass(s);
    return s;
  };
  it('is automated', () => expect(full(REAPER)).toBe(true));
  it('with three lands only the 3-power non-Elf is a target (the 4-power Ogre is too big); with four lands the Ogre is too', () => {
    const three = cast(3);
    expect(three.pending).toMatchObject({ kind: 'chooseTargets' });
    const imp = find(three, 'Test Imp', 'battlefield', 'p2');
    const ogre = find(three, 'Test Ogre', 'battlefield', 'p2');
    const opts = JSON.stringify(three.pending);
    expect(opts).toContain(imp);
    expect(opts).not.toContain(ogre);
    expect(opts).not.toContain(find(three, 'Test Elf', 'battlefield', 'p2')); // an Elf is no target (non-Elf)
    const four = cast(4);
    expect(JSON.stringify(four.pending)).toContain(find(four, 'Test Ogre', 'battlefield', 'p2'));
  });
  it('the chosen creature is destroyed when the trigger resolves', () => {
    const three = cast(3);
    const imp = find(three, 'Test Imp', 'battlefield', 'p2');
    const s = answer(three, { kind: 'chooseTargets', targets: [{ kind: 'object', id: imp }] });
    let t = s;
    for (let i = 0; i < 4 && t.zones.stack.length > 0; i++) t = settle(pass(t));
    expect(t.zones.battlefield).not.toContain(imp);
    expect(findAll(t, 'Test Ogre', 'battlefield', 'p2')).toHaveLength(1);
  });
});
