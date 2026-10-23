/**
 * T8 (FAST2 wave, one-shot effects): the templates of parser/templates/zz-fast2/t8.json and the engine and renderer support they needed, played through
 * applyAction with synthetic cards compiled by the game's default compiler (wordings are invented, design 6.10). Each test is named after the rule it checks.
 * The templates are experimental, so the cards are `partial` (design 6.9): their automated steps still run, which is what these tests check.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type AbilityDef, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, castAuto, find, findAll, life, pass, passBoth, scenario } from '../../m3/scenario';

function compiled(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: cost, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard as never);
}
const manualParts = (d: CardDef): AbilityDef[] => d.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' || JSON.stringify(a).includes('"op":"manual"'));

const STORM = compiled('Test Ember Storm', 'Sorcery', '~ deals 2 damage to each creature and each player.');
const GALE = compiled('Test Gale', 'Sorcery', '~ deals 3 damage to each creature with flying and each player.');
const LIFEBRINGER = compiled('Test Lifebringer', 'Creature — Cleric', 'Lifelink\n{0}: ~ deals 1 damage to each creature and each player.', '{0}', ['1', '5']);
const CANNONEER = compiled('Test Cannoneer', 'Creature — Goblin', '{0}: ~ deals 2 damage to any target and 3 damage to you.', '{0}', ['1', '1']);
const CLASH = compiled('Test Inner Clash', 'Instant', 'Target creature deals damage to itself equal to its power.');
const ROCKFALL = compiled('Test Rockfall', 'Sorcery', '~ deals damage to target creature equal to the number of lands you control.');
const LASH = compiled('Test Mind Lash', 'Sorcery', "~ deals damage to target player equal to the number of cards in that player's hand.");
const SNIPER = compiled('Test Sniper', 'Creature — Elf', '{0}: You may have ~ deal 2 damage to target player or planeswalker.', '{0}', ['1', '1']);
const RAIDER = compiled('Test Raider', 'Creature — Human Pirate', '~ enters with a +1/+1 counter on it if you attacked this turn.', '{0}', ['2', '2']);
const HERALD = compiled('Test Herald', 'Creature — Human', 'When ~ enters, you become the monarch.', '{0}', ['1', '1']);
const TIMEWALK = compiled('Test Second Chance', 'Sorcery', 'Take an extra turn after this one.');
const ADAPTER = compiled('Test Adapter', 'Creature — Ooze', '{0}: Adapt 2.', '{0}', ['1', '1']);
const OATH = compiled('Test Oath', 'Sorcery', 'You gain 3 life for each creature you control.');
const GORGER = compiled('Test Gorger', 'Creature — Horror', 'Whenever ~ is dealt damage, draw that many cards.', '{0}', ['1', '5']);
const SPARK = compiled('Test Spark', 'Sorcery', 'You gain 1 life.');
const TAXER = compiled('Test Taxer', 'Creature — Human', 'Whenever an opponent casts a spell, they lose 2 life.', '{0}', ['1', '1']);
const HONORER = compiled('Test Honorer', 'Enchantment', 'Whenever a creature you control is dealt damage, put a +1/+1 counter on it.');
const ORDEAL = compiled('Test Ordeal', 'Enchantment — Aura', 'Enchant creature\nWhenever enchanted creature attacks, put a +1/+1 counter on it. Then if it has two or more +1/+1 counters on it, sacrifice ~.');
const DEFS = [SPARK, STORM, GALE, LIFEBRINGER, CANNONEER, CLASH, ROCKFALL, LASH, SNIPER, RAIDER, HERALD, TIMEWALK, ADAPTER, OATH, GORGER, TAXER, HONORER, ORDEAL];

describe('FAST2 T8: the synthetic cards are automated (their steps run; experimental templates cap them at partial)', () => {
  it('no manual ability or step', () => {
    for (const d of DEFS) expect(manualParts(d), d.name).toEqual([]);
  });
});

/** Cast a p1 spell with the given targets and pay automatically; the spell is on the stack. */
function cast(s0: GameState, name: string, targets: TargetChoice[] = []): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  while (s.pending && s.pending.kind !== 'priority') {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return s;
}

/** Activate a printed ability of an object (the first by default), choose targets and pay automatically. */
function activate(s0: GameState, source: ObjectId, targets: TargetChoice[] = [], ability = 'p:0:0'): GameState {
  let s = act(s0, { type: 'activate', player: 'p1', source, ability });
  while (s.pending && s.pending.kind !== 'priority') {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return s;
}

const obj = (id: string): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });
const damageOf = (s: GameState, id: ObjectId): number => s.objects[id]!.damage;

describe('CR 120.2b, 120.3f: "~ deals N damage to each creature and each player" is one damage event', () => {
  it('every creature and every player is dealt the damage', () => {
    const s0 = scenario(['Grizzly Bears', 'Hill Giant'], { defs: DEFS, p1: { hand: ['Test Ember Storm'], battlefield: ['Hill Giant'] }, p2: { battlefield: ['Grizzly Bears'] } });
    const s = passBoth(cast(s0, 'Test Ember Storm'));
    expect(findAll(s, 'Grizzly Bears', 'graveyard', 'p2')).toHaveLength(1);
    expect(damageOf(s, find(s, 'Hill Giant', 'battlefield'))).toBe(2);
    expect(life(s, 'p1')).toBe(18);
    expect(life(s, 'p2')).toBe(18);
  });
  it('a filter on the creatures ("with flying") limits the creatures, not the players', () => {
    const s0 = scenario(['Serra Angel', 'Grizzly Bears'], { defs: DEFS, p1: { hand: ['Test Gale'], battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Serra Angel'] } });
    const s = passBoth(cast(s0, 'Test Gale'));
    expect(damageOf(s, find(s, 'Serra Angel', 'battlefield'))).toBe(3);
    expect(damageOf(s, find(s, 'Grizzly Bears', 'battlefield'))).toBe(0);
    expect(life(s, 'p1')).toBe(17);
    expect(life(s, 'p2')).toBe(17);
  });
  it('CR 702.15e: a lifelink source gains the life of ALL that damage as ONE life gain (one trigger of a "whenever you gain life" ability)', () => {
    const s0 = scenario(["Ajani's Pridemate", 'Grizzly Bears'], { defs: DEFS, p1: { battlefield: ['Test Lifebringer', "Ajani's Pridemate"] }, p2: { battlefield: ['Grizzly Bears'] } });
    let s = passBoth(activate(s0, find(s0, 'Test Lifebringer', 'battlefield'), [], 'p:0:1'));
    // 1 damage to the Lifebringer, the Pridemate, the Bears and both players: 5 damage, 5 life gained at once; p1 also was dealt 1
    expect(life(s, 'p1')).toBe(20 - 1 + 5);
    s = passBoth(s); // the Pridemate's trigger
    expect(s.objects[find(s, "Ajani's Pridemate", 'battlefield')]!.counters['+1/+1']).toBe(1);
    expect(s.log.filter((l) => /lifelink, once for all its damage/.test(l.text))).toHaveLength(1);
  });
});

describe('CR 120.2b: "~ deals 2 damage to any target and 3 damage to you"', () => {
  it('the target is dealt 2 and the controller 3, by the same source', () => {
    const s0 = scenario(['Grizzly Bears'], { defs: DEFS, p1: { battlefield: ['Test Cannoneer'] }, p2: { battlefield: ['Grizzly Bears'] } });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = passBoth(activate(s0, find(s0, 'Test Cannoneer', 'battlefield'), [obj(bears)]));
    expect(findAll(s, 'Grizzly Bears', 'graveyard', 'p2')).toHaveLength(1);
    expect(life(s, 'p1')).toBe(17);
    expect(life(s, 'p2')).toBe(20);
  });
  it('CR 608.2b: an illegal target is dealt nothing, but "you" is not a target and is still dealt the damage', () => {
    const s0 = scenario(['Grizzly Bears'], { defs: DEFS, p1: { battlefield: ['Test Cannoneer'] }, p2: { battlefield: ['Grizzly Bears'] } });
    let s = activate(s0, find(s0, 'Test Cannoneer', 'battlefield'), [player('p2')]);
    s = passBoth(s);
    expect(life(s, 'p2')).toBe(18);
    expect(life(s, 'p1')).toBe(17);
  });
});

describe('CR 120.2b, 608.2h: "target creature deals damage to itself equal to its power"', () => {
  it('a 3/3 is destroyed by its own 3 damage; a 2/4 survives with 2 damage', () => {
    const s0 = scenario(['Hill Giant', 'Giant Spider'], { defs: DEFS, p1: { hand: ['Test Inner Clash', 'Test Inner Clash'] }, p2: { battlefield: ['Hill Giant', 'Giant Spider'] } });
    let s = passBoth(cast(s0, 'Test Inner Clash', [obj(find(s0, 'Hill Giant', 'battlefield'))]));
    expect(findAll(s, 'Hill Giant', 'graveyard', 'p2')).toHaveLength(1);
    s = passBoth(cast(s, 'Test Inner Clash', [obj(find(s, 'Giant Spider', 'battlefield'))]));
    expect(damageOf(s, find(s, 'Giant Spider', 'battlefield'))).toBe(2);
  });
});

describe('CR 608.2h: "deals damage to <target> equal to <a number>"', () => {
  it('the number of lands you control', () => {
    const s0 = scenario(['Hill Giant'], { defs: DEFS, p1: { hand: ['Test Rockfall'], battlefield: ['Plains', 'Plains'] }, p2: { battlefield: ['Hill Giant'] } });
    const s = passBoth(cast(s0, 'Test Rockfall', [obj(find(s0, 'Hill Giant', 'battlefield'))]));
    expect(damageOf(s, find(s, 'Hill Giant', 'battlefield'))).toBe(2);
  });
  it('"the number of cards in that player\'s hand": that player is the target', () => {
    const s0 = scenario(['Grizzly Bears'], { defs: DEFS, p1: { hand: ['Test Mind Lash', 'Plains'] }, p2: { hand: ['Grizzly Bears', 'Grizzly Bears', 'Grizzly Bears'] } });
    const s = passBoth(cast(s0, 'Test Mind Lash', [player('p2')]));
    expect(life(s, 'p2')).toBe(17);
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 608.2d: "you may have ~ deal 2 damage to target player or planeswalker"', () => {
  it('yes: the damage is dealt; no: nothing happens', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Sniper'] } });
    const sniper = find(s0, 'Test Sniper', 'battlefield');
    let s = pass(activate(s0, sniper, [player('p2')]));
    s = pass(s);
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p1' });
    const yes = answer(s, { kind: 'yesNo', yes: true });
    expect(life(yes, 'p2')).toBe(18);
    const no = answer(s, { kind: 'yesNo', yes: false });
    expect(life(no, 'p2')).toBe(20);
  });
});

describe('CR 614.1c, 614.12: "~ enters with a +1/+1 counter on it if you attacked this turn" (raid)', () => {
  it('no attack this turn: no counter', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Raider'] } });
    const s = passBoth(castAuto(s0, 'Test Raider'));
    expect(s.objects[find(s, 'Test Raider', 'battlefield')]!.counters['+1/+1'] ?? 0).toBe(0);
  });
  it('after an attack this turn: the counter', () => {
    const s0 = scenario(['Grizzly Bears'], { defs: DEFS, p1: { hand: ['Test Raider'], battlefield: ['Grizzly Bears'] } });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = s0;
    for (let i = 0; i < 60 && s.turn.step !== 'main2'; i++) {
      const d = s.pending!;
      if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bears, defender: 'p2' }] });
      else if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else s = pass(s);
    }
    expect(life(s, 'p2')).toBe(18);
    s = passBoth(castAuto(s, 'Test Raider'));
    expect(s.objects[find(s, 'Test Raider', 'battlefield')]!.counters['+1/+1']).toBe(1);
  });
});

describe('CR 725.3: "you become the monarch"', () => {
  it('the controller of the ability becomes the monarch', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Herald'] } });
    let s = passBoth(castAuto(s0, 'Test Herald'));
    s = passBoth(s); // the enters trigger
    expect(s.designations.monarch).toBe('p1');
  });
});

describe('CR 500.7: "take an extra turn after this one"', () => {
  it('the next turn is the same player\'s', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Second Chance'] } });
    let s = passBoth(cast(s0, 'Test Second Chance'));
    expect(s.turn.extraTurns).toEqual(['p1']);
    s = advanceTo(s, 2, 'upkeep');
    expect(s.turn.activePlayer).toBe('p1');
  });
});

describe('CR 701.46a: "Adapt 2"', () => {
  it('two +1/+1 counters when it has none; nothing when it already has one', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Adapter'] } });
    const ooze = find(s0, 'Test Adapter', 'battlefield');
    let s = passBoth(activate(s0, ooze));
    expect(s.objects[ooze]!.counters['+1/+1']).toBe(2);
    s = passBoth(activate(s, ooze));
    expect(s.objects[ooze]!.counters['+1/+1']).toBe(2);
  });
});

describe('CR 119.3, 608.2h: "you gain 3 life for each creature you control"', () => {
  it('two creatures: 6 life', () => {
    const s0 = scenario(['Grizzly Bears'], { defs: DEFS, p1: { hand: ['Test Oath'], battlefield: ['Grizzly Bears', 'Grizzly Bears'] }, p2: { battlefield: ['Grizzly Bears'] } });
    const s = passBoth(cast(s0, 'Test Oath'));
    expect(life(s, 'p1')).toBe(26);
  });
});

describe('CR 603.2, 608.2h: "whenever ~ is dealt damage, draw that many cards"', () => {
  it('2 damage: two cards', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Ember Storm'], battlefield: ['Test Gorger'] } });
    let s = passBoth(cast(s0, 'Test Ember Storm'));
    const before = s.zones.hand.p1!.length;
    s = passBoth(s); // the Gorger's trigger
    expect(s.zones.hand.p1!.length).toBe(before + 2);
  });
});

describe('CR 608.2c (singular "they"): "whenever an opponent casts a spell, they lose 2 life"', () => {
  it('the opponent who cast the spell loses 2 life', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Spark'] }, p2: { battlefield: ['Test Taxer'] } });
    let s = castAuto(s0, 'Test Spark');
    s = passBoth(s); // the trigger
    expect(life(s, 'p1')).toBe(18);
    s = passBoth(s); // the spell
    expect(life(s, 'p1')).toBe(19);
    expect(life(s, 'p2')).toBe(20);
  });
});

describe('CR 603.2, 608.2c: "whenever a creature you control is dealt damage, put a +1/+1 counter on it" (it = the creature dealt damage)', () => {
  it('the damaged creature gets the counter', () => {
    const s0 = scenario(['Giant Spider'], { defs: DEFS, p1: { hand: ['Test Ember Storm'], battlefield: ['Test Honorer', 'Giant Spider'] } });
    let s = passBoth(cast(s0, 'Test Ember Storm'));
    s = passBoth(s);
    expect(s.objects[find(s, 'Giant Spider', 'battlefield')]!.counters['+1/+1']).toBe(1);
  });
});

describe('CR 608.2c: "Then if it has two or more +1/+1 counters on it, sacrifice ~" (Ordeal)', () => {
  it('compiles to: put a counter on the attacking enchanted creature, then a check of ITS counters, then the sacrifice of the Aura', () => {
    const trig = ORDEAL.faces[0]!.abilities.find((a) => a.kind === 'triggered')!;
    expect(JSON.stringify(trig)).toContain('"op":"putCounters"');
    const steps = (trig as { effect: { steps: unknown[] } }).effect.steps;
    expect(steps[0]).toMatchObject({ op: 'putCounters', on: { ref: 'event', role: 'attacker' }, kind: '+1/+1', count: 1 });
    expect(steps[1]).toEqual({ op: 'if', cond: { cond: 'matches', object: { ref: 'event', role: 'attacker' }, filter: { counters: { kind: '+1/+1', cmp: { op: '>=', value: 2 } } } }, then: [{ op: 'sacrifice', what: { ref: 'self' } }] });
  });
});
