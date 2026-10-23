/**
 * CLOUD std-fdn (the Standard backlog of Foundations), played through the engine with synthetic cards compiled by the game's default compiler (wordings are
 * invented, design 6.10).
 *
 *   CR 609.4b            "you can spend mana of any type to cast creature spells": only for the spells it describes, judged as the spell (CR 601.3e)
 *   CR 701.21a, 608.2h   "that creature's toughness" after a sacrifice of the player's choice is read from its last known information
 *   CR 614.1a, 614.6     "if an instant or sorcery card would be put into a graveyard from anywhere, exile it instead"
 *   CR 608.2h, 107.3a    "put X +1/+1 counters on this creature, where X is its power"
 *   CR 120.1, 603.2      "whenever a source you control deals noncombat damage to an opponent, you draw that many cards"
 *   CR 201.2, 603.4      "if you control N or more Gates with different names, you win the game"
 *   CR 202.3, 608.2h     "create X ... tokens, where X is the mana value of that spell"
 *   CR 500.8, 603.2c     "after this phase, there is an additional combat phase"; "for the first time each turn"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, castAuto, find, life, pass, scenario, zoneNames } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

/** Answer the decisions in front of the spell (targets, payment, choices) and let everything resolve. */
function settle(s0: GameState, targets: TargetChoice[] = []): GameState {
  let s = s0;
  for (let guard = 0; s.pending && guard < 40; guard++) {
    const d = s.pending;
    if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, d.min) });
    else if (d.kind === 'priority' && s.zones.stack.length > 0) s = pass(s);
    else break;
  }
  return s;
}
const onBf = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name);

describe('CR 609.4b: "You can spend mana of any type to cast creature spells."', () => {
  const VIZIER = card('Test Menagerie Sage', 'Creature — Snake Cleric', 'You can spend mana of any type to cast creature spells.', { pt: ['3', '4'] });
  const BEAST = card('Test Green Beast', 'Creature — Beast', '', { pt: ['3', '3'], cost: '{G}{G}' });
  const GROWTH = card('Test Green Growth', 'Sorcery', 'Draw a card.', { cost: '{G}{G}' });
  it('is automated', () => expect(full(VIZIER)).toBe(true));
  it('with it, a {G}{G} creature spell is cast with two Islands', () => {
    const s0 = scenario(['Island'], { defs: [VIZIER, BEAST], p1: { battlefield: ['Test Menagerie Sage', 'Island', 'Island'], hand: ['Test Green Beast'] } });
    const s = settle(castAuto(s0, 'Test Green Beast'));
    expect(onBf(s, 'Test Green Beast').length).toBe(1);
  });
  it('without it the same spell can\'t be paid with Islands, and a {G}{G} sorcery still can\'t with it (only creature spells)', () => {
    const none = scenario(['Island'], { defs: [BEAST], p1: { battlefield: ['Island', 'Island'], hand: ['Test Green Beast'] } });
    expect(() => settle(castAuto(none, 'Test Green Beast'))).toThrow();
    const sorcery = scenario(['Island'], { defs: [VIZIER, GROWTH], p1: { battlefield: ['Test Menagerie Sage', 'Island', 'Island'], hand: ['Test Green Growth'] } });
    expect(() => settle(castAuto(sorcery, 'Test Green Growth'))).toThrow();
  });
});

describe('CR 701.21a, 608.2h: "Target opponent sacrifices a creature of their choice. You gain life equal to that creature\'s toughness."', () => {
  const TRIBUTE = card('Test Hungry Tribute', 'Instant', "Target opponent sacrifices a creature of their choice. You gain life equal to that creature's toughness.");
  const WALL = card('Test Wall', 'Creature — Wall', '', { pt: ['0', '4'] });
  const ANTHEM = card('Test Bulwark', 'Enchantment', 'Creatures you control get +0/+3.');
  it('is automated', () => expect(full(TRIBUTE)).toBe(true));
  it('the life is the toughness the creature had as it was sacrificed (an anthem included), not the card\'s in the graveyard', () => {
    const s0 = scenario([], { defs: [TRIBUTE, WALL, ANTHEM], p1: { hand: ['Test Hungry Tribute'] }, p2: { battlefield: ['Test Wall', 'Test Bulwark'] } });
    const before = life(s0, 'p1');
    const s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Hungry Tribute', 'hand', 'p1') }), [{ kind: 'player', id: 'p2' }]);
    expect(zoneNames(s, 'graveyard', 'p2')).toContain('Test Wall');
    expect(life(s, 'p1')).toBe(before + 7);
  });
  it('"each opponent sacrifices ..." followed by "that creature" is not automated (several objects, CR 608.2c)', () => {
    const EACH = card('Test Hungry Chorus', 'Instant', "Each opponent sacrifices a creature of their choice. You gain life equal to that creature's toughness.");
    expect(full(EACH)).toBe(false);
  });
});

describe('CR 614.1a, 614.6: "If an instant or sorcery card would be put into a graveyard from anywhere, exile it instead."', () => {
  const MILITANT = card('Test Grove Militant', 'Creature — Dryad Soldier', 'If an instant or sorcery card would be put into a graveyard from anywhere, exile it instead.', { pt: ['2', '1'] });
  const DRAW = card('Test Quick Study', 'Instant', 'Draw a card.');
  it('is automated, and a resolved instant goes to exile; without it, to the graveyard', () => {
    expect(full(MILITANT)).toBe(true);
    const s0 = scenario([], { defs: [MILITANT, DRAW], p2: { battlefield: ['Test Grove Militant'] }, p1: { hand: ['Test Quick Study'] } });
    const s = settle(castAuto(s0, 'Test Quick Study'));
    expect(zoneNames(s, 'graveyard', 'p1')).not.toContain('Test Quick Study');
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Quick Study')).toBe(true);
    const plain = settle(castAuto(scenario([], { defs: [DRAW], p1: { hand: ['Test Quick Study'] } }), 'Test Quick Study'));
    expect(zoneNames(plain, 'graveyard', 'p1')).toContain('Test Quick Study');
  });
});

describe('CR 608.2h, 107.3a: "{1}: Put X +1/+1 counters on this creature, where X is its power."', () => {
  const HYDRA = card('Test Bane Hydra', 'Creature — Hydra', '{0}: Put X +1/+1 counters on this creature, where X is its power.', { pt: ['3', '3'] });
  it('is automated and doubles its power: 3/3 becomes 6/6', () => {
    expect(full(HYDRA)).toBe(true);
    const s0 = scenario([], { defs: [HYDRA], p1: { battlefield: ['Test Bane Hydra'] } });
    const id = find(s0, 'Test Bane Hydra', 'battlefield', 'p1');
    const s = settle(act(s0, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' }));
    expect(s.objects[id]!.counters['+1/+1']).toBe(3);
    expect(Number(getChars(s, id)!.power)).toBe(6);
  });
});

describe('CR 120.1, 603.2: "Whenever a source you control deals noncombat damage to an opponent, you draw that many cards."', () => {
  const NIV = card('Test Visionary Drake', 'Creature — Dragon', 'Whenever a source you control deals noncombat damage to an opponent, you draw that many cards.', { pt: ['5', '5'] });
  const BOLT = card('Test Spark', 'Instant', 'Test Spark deals 3 damage to any target.');
  it('is automated; 3 damage to the opponent draws 3; 3 damage to its own controller draws none', () => {
    expect(full(NIV)).toBe(true);
    const s0 = scenario([], { defs: [NIV, BOLT], p1: { battlefield: ['Test Visionary Drake'], hand: ['Test Spark', 'Test Spark'] } });
    const hand0 = s0.zones.hand.p1!.length;
    const s1 = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Spark', 'hand', 'p1') }), [{ kind: 'player', id: 'p2' }]);
    expect(s1.zones.hand.p1!.length).toBe(hand0 - 1 + 3);
    const s2 = settle(act(s1, { type: 'cast', player: 'p1', card: find(s1, 'Test Spark', 'hand', 'p1') }), [{ kind: 'player', id: 'p1' }]);
    expect(s2.zones.hand.p1!.length).toBe(hand0 - 2 + 3);
  });
});

describe('CR 201.2, 603.4: "If you control three or more Gates with different names, you win the game."', () => {
  const MAZE = card('Test Maze Call', 'Sorcery', 'If you control three or more Gates with different names, you win the game.');
  const GATES = ['North', 'South', 'East'].map((n) => card(`Test ${n} Gate`, 'Land — Gate', ''));
  it('is automated; three differently named Gates win, three copies of one Gate do not', () => {
    expect(full(MAZE)).toBe(true);
    const win = settle(castAuto(scenario([], { defs: [MAZE, ...GATES], p1: { hand: ['Test Maze Call'], battlefield: ['Test North Gate', 'Test South Gate', 'Test East Gate'] } }), 'Test Maze Call'));
    expect(win.result).toMatchObject({ winner: 'p1' });
    const same = settle(castAuto(scenario([], { defs: [MAZE, ...GATES], p1: { hand: ['Test Maze Call'], battlefield: ['Test North Gate', 'Test North Gate', 'Test North Gate'] } }), 'Test Maze Call'));
    expect(same.result ?? null).toBeNull();
  });
});

describe('CR 202.3, 608.2h: "Whenever you cast a noncreature spell, create X 1/1 red Goblin creature tokens, where X is the mana value of that spell."', () => {
  const OVIKA = card('Test Goblin Engine', 'Creature — Nightmare', 'Whenever you cast a noncreature spell, create X 1/1 red Goblin creature tokens, where X is the mana value of that spell.', { pt: ['6', '6'] });
  const THREE = card('Test Big Thought', 'Sorcery', 'Draw a card.', { cost: '{3}' });
  it('is automated; a spell of mana value 3 makes three Goblins', () => {
    expect(full(OVIKA)).toBe(true);
    const s0 = scenario([], { defs: [OVIKA, THREE], p1: { battlefield: ['Test Goblin Engine', 'Plains', 'Plains', 'Plains'], hand: ['Test Big Thought'] } });
    const s = settle(castAuto(s0, 'Test Big Thought'));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1').length).toBe(3);
  });
});

describe('CR 500.8, 603.2c: "Whenever this creature attacks for the first time each turn, untap all creatures you control. After this phase, there is an additional combat phase."', () => {
  const AURELIA = card('Test War Angel', 'Creature — Angel', 'Haste\nWhenever this creature attacks for the first time each turn, untap all creatures you control. After this phase, there is an additional combat phase.', { pt: ['3', '4'] });
  it('is automated; the first attack untaps and adds one combat phase; the attack in that phase adds no other', () => {
    expect(full(AURELIA)).toBe(true);
    let s = scenario([], { defs: [AURELIA], p1: { battlefield: ['Test War Angel'] } });
    const angel = find(s, 'Test War Angel', 'battlefield', 'p1');
    let combats = 0;
    let triggered = 0;
    for (let guard = 0; guard < 400 && s.turn.number === 1; guard++) {
      const d = s.pending;
      if (d?.kind === 'declareAttackers') {
        combats++;
        s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: angel, defender: 'p2' }] });
        const onStack = s.zones.stack.length;
        if (onStack > 0) triggered++;
      } else if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (d?.kind === 'priority') s = s.zones.stack.length > 0 ? settle(s) : pass(s);
      else if (d) s = settle(s);
      else break;
    }
    expect(combats).toBe(2);
    expect(triggered).toBe(1);
  });
});
