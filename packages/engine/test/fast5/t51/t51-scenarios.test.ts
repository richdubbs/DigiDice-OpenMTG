/**
 * FAST5 T51: the mana-spent shapes (parser/holes/cond.ts, parser/holes/qty.ts, parser/templates/zz-fast5/t51.json and the quantities `spellManaSpent`,
 * `manaSpent`, `spellColorsSpent`) played through the engine with synthetic cards compiled by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 601.2h        the mana spent to cast a spell: "if at least four mana was spent to cast it", "if five or more mana was spent to cast that spell ... instead",
 *                    "if {R}{R} was spent to cast it" (the evoke hybrids), "equal to the amount of mana spent to cast ~", "for each color of mana spent to cast that spell"
 *   CR 601.2f, 118.7 a cost reduction lowers the mana spent, not the mana value (Tokka & Rahzar)
 *   CR 614.1c, 614.12 "enters with a number of counters equal to the amount of mana spent to cast it"; "if it wasn't cast or no mana was spent to cast it"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (an experimental template caps the card at partial, never an ability). */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const ctr = (s: GameState, id: ObjectId, kind = '+1/+1'): number => s.objects[id]?.counters[kind] ?? 0;
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

/** Answer the decisions that come up: target groups from `targets`, then `answers`; pay costs automatically; stop at priority. */
function settle(s0: GameState, targets: TargetChoice[][] = [], answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const groups = [...targets];
  const queue = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 30; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets' && groups.length > 0) s = answer(s, { kind: 'chooseTargets', targets: groups.shift()! });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
const resolve = (s: GameState, targets: TargetChoice[][] = [], answers: DecisionAnswer[] = []): GameState => settle(pass(pass(s)), targets, answers);
const castWith = (s0: GameState, name: string, targets: TargetChoice[][] = [], answers: DecisionAnswer[] = []): GameState =>
  settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), targets, answers);
/** Cast `name`, then let everything on the stack resolve (the triggers first, then the spell). */
function castAndResolveAll(s0: GameState, name: string, targets: TargetChoice[][] = []): GameState {
  let s = castWith(s0, name, targets);
  for (let guard = 0; s.zones.stack.length > 0 && guard < 12; guard++) s = resolve(s);
  return s;
}

const LANDS = ['Mountain', 'Forest', 'Plains'];
const MOUNTAINS = ['Mountain', 'Mountain', 'Mountain', 'Mountain', 'Mountain', 'Mountain'];
const BIG = card('Test Big Spell', 'Sorcery', '', undefined, '{3}{R}');
const SMALL = card('Test Small Spell', 'Sorcery', '', undefined, '{1}{R}');
const HUGE = card('Test Huge Spell', 'Sorcery', '', undefined, '{4}{R}');

describe('CR 601.2h: "whenever you cast a noncreature spell, if at least four mana was spent to cast it, put a +1/+1 counter on ~"', () => {
  const BOMB = card('Test Bomb', 'Creature — Elemental', 'Whenever you cast a noncreature spell, if at least four mana was spent to cast it, put a +1/+1 counter on this creature.', ['1', '1'], '{R}');
  it('is automated, and a spell cast with four mana puts the counter', () => {
    expect(automated(BOMB)).toBe(true);
    const s0 = scenario(LANDS, { p1: { hand: ['Test Big Spell'], battlefield: ['Test Bomb', ...MOUNTAINS] }, defs: [BOMB, BIG] });
    const s = castAndResolveAll(s0, 'Test Big Spell');
    expect(ctr(s, find(s, 'Test Bomb', 'battlefield'))).toBe(1);
  });
  it('a spell cast with only two mana does not trigger it (the intervening "if" is false, CR 603.4)', () => {
    const s0 = scenario(LANDS, { p1: { hand: ['Test Small Spell'], battlefield: ['Test Bomb', ...MOUNTAINS] }, defs: [BOMB, SMALL] });
    const s = castAndResolveAll(s0, 'Test Small Spell');
    expect(ctr(s, find(s, 'Test Bomb', 'battlefield'))).toBe(0);
  });
  it('a creature spell never triggers it, however much mana was spent', () => {
    const FATTY = card('Test Fatty', 'Creature — Ogre', '', ['4', '4'], '{4}{R}');
    const s0 = scenario(LANDS, { p1: { hand: ['Test Fatty'], battlefield: ['Test Bomb', ...MOUNTAINS] }, defs: [BOMB, FATTY] });
    const s = castAndResolveAll(s0, 'Test Fatty');
    expect(ctr(s, find(s, 'Test Bomb', 'battlefield'))).toBe(0);
  });
});

describe('CR 601.2h, 614.15: opus, "If five or more mana was spent to cast that spell, ... instead"', () => {
  const ARTIST = card('Test Artist', 'Creature — Orc', 'Whenever you cast an instant or sorcery spell, put a +1/+1 counter on this creature. If five or more mana was spent to cast that spell, put two +1/+1 counters on this creature instead.', ['1', '1'], '{R}');
  it('five mana spent: two counters (the first sentence is replaced, not added to)', () => {
    expect(automated(ARTIST)).toBe(true);
    const s0 = scenario(LANDS, { p1: { hand: ['Test Huge Spell'], battlefield: ['Test Artist', ...MOUNTAINS] }, defs: [ARTIST, HUGE] });
    const s = castAndResolveAll(s0, 'Test Huge Spell');
    expect(ctr(s, find(s, 'Test Artist', 'battlefield'))).toBe(2);
  });
  it('four mana spent: one counter', () => {
    const s0 = scenario(LANDS, { p1: { hand: ['Test Big Spell'], battlefield: ['Test Artist', ...MOUNTAINS] }, defs: [ARTIST, BIG] });
    const s = castAndResolveAll(s0, 'Test Big Spell');
    expect(ctr(s, find(s, 'Test Artist', 'battlefield'))).toBe(1);
  });
  const VIRTUOSO = card('Test Virtuoso', 'Creature — Human Wizard', 'Whenever you cast an instant or sorcery spell, this creature gets +1/+1 until end of turn. If five or more mana was spent to cast that spell, this creature gets +2/+2 until end of turn instead.', ['1', '1'], '{R}');
  it('a pump replaced: +2/+2 for five mana, +1/+1 for four', () => {
    expect(automated(VIRTUOSO)).toBe(true);
    const big = castAndResolveAll(scenario(LANDS, { p1: { hand: ['Test Huge Spell'], battlefield: ['Test Virtuoso', ...MOUNTAINS] }, defs: [VIRTUOSO, HUGE] }), 'Test Huge Spell');
    const small = castAndResolveAll(scenario(LANDS, { p1: { hand: ['Test Big Spell'], battlefield: ['Test Virtuoso', ...MOUNTAINS] }, defs: [VIRTUOSO, BIG] }), 'Test Big Spell');
    expect(Number(getChars(big, find(big, 'Test Virtuoso', 'battlefield')).power)).toBe(3);
    expect(Number(getChars(small, find(small, 'Test Virtuoso', 'battlefield')).power)).toBe(2);
  });
  const TIDECALLER = card('Test Tidecaller', 'Creature — Djinn Wizard', 'Whenever you cast an instant or sorcery spell, target player mills three cards. If five or more mana was spent to cast that spell, that player mills ten cards instead.', ['1', '1'], '{U}');
  it('"that player" is the target of the first sentence, not the player who cast the spell', () => {
    expect(automated(TIDECALLER)).toBe(true);
  });
});

describe('CR 601.2f, 601.2h: "whenever a player casts a spell, if the amount of mana spent to cast it was less than its mana value, ~ deal 3 damage to that player" (Tokka & Rahzar)', () => {
  const TWOS = card('Test Twos', 'Creature — Turtle Wolf', 'Whenever a player casts a spell, if the amount of mana spent to cast it was less than its mana value, ~ deal 3 damage to that player.', ['3', '3'], '{B}{R}');
  const REDUCER = card('Test Reducer', 'Artifact', 'Sorcery spells you cast cost {2} less to cast.', undefined, '{0}');
  it('is automated', () => expect(automated(TWOS)).toBe(true));
  it('a spell of mana value 4 cast for two mana: its caster is dealt 3 damage', () => {
    const s0 = scenario(LANDS, { p1: { hand: ['Test Big Spell'], battlefield: ['Test Twos', 'Test Reducer', ...MOUNTAINS] }, defs: [TWOS, REDUCER, BIG] });
    const s = castAndResolveAll(s0, 'Test Big Spell');
    expect(life(s, 'p1')).toBe(17);
  });
  it('a spell cast for its full mana value: no damage', () => {
    const s0 = scenario(LANDS, { p1: { hand: ['Test Big Spell'], battlefield: ['Test Twos', ...MOUNTAINS] }, defs: [TWOS, BIG] });
    const s = castAndResolveAll(s0, 'Test Big Spell');
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 601.2h: "when ~ enters, if {R}{R} was spent to cast it" (the evoke hybrids): at least two red mana, not exactly two', () => {
  const ELEMENTAL = card('Test Elemental', 'Creature — Elemental Incarnation', 'When this creature enters, if {R}{R} was spent to cast it, you gain 3 life.', ['3', '3'], '{4}{R/W}{R/W}');
  it('is automated', () => expect(automated(ELEMENTAL)).toBe(true));
  it('six red mana spent: you gain 3 life', () => {
    const s0 = scenario(LANDS, { p1: { hand: ['Test Elemental'], battlefield: MOUNTAINS }, defs: [ELEMENTAL] });
    const s = castAndResolveAll(s0, 'Test Elemental');
    expect(life(s, 'p1')).toBe(23);
  });
  it('only white mana spent: no life', () => {
    const s0 = scenario(LANDS, { p1: { hand: ['Test Elemental'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'] }, defs: [ELEMENTAL] });
    const s = castAndResolveAll(s0, 'Test Elemental');
    expect(life(s, 'p1')).toBe(20);
  });
  it('red mana for one hybrid symbol only (one red among the six): no life', () => {
    const s0 = scenario(LANDS, { p1: { hand: ['Test Elemental'], battlefield: ['Mountain', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'] }, defs: [ELEMENTAL] });
    const s = castAndResolveAll(s0, 'Test Elemental');
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 601.2h, 122.1: "put a +1/+1 counter on ~ and it can\'t be blocked this turn" (Sahagin)', () => {
  const SAHAGIN = card('Test Merfolk', 'Creature — Merfolk', "Whenever you cast a noncreature spell, if at least four mana was spent to cast it, put a +1/+1 counter on this creature and it can't be blocked this turn.", ['1', '1'], '{1}{U}');
  it('is automated, and the counter goes on ~ (the spell is not "it")', () => {
    expect(automated(SAHAGIN)).toBe(true);
    const s0 = scenario(LANDS, { p1: { hand: ['Test Big Spell'], battlefield: ['Test Merfolk', ...MOUNTAINS] }, defs: [SAHAGIN, BIG] });
    const s = castAndResolveAll(s0, 'Test Big Spell');
    expect(ctr(s, find(s, 'Test Merfolk', 'battlefield'))).toBe(1);
  });
});

describe('CR 601.2h, 611.2c: "creatures you control get +1/+0 until end of turn for each color of mana spent to cast that spell" (Magmablood Archaic)', () => {
  const ARCHAIC = card('Test Archaic', 'Creature — Avatar', 'Whenever you cast an instant or sorcery spell, creatures you control get +1/+0 until end of turn for each color of mana spent to cast that spell.', ['2', '2'], '{R}');
  const ELF = card('Test Elf', 'Creature — Elf', '', ['2', '2'], '{1}');
  const TWOCOLOR = card('Test Two Color', 'Sorcery', '', undefined, '{R}{G}');
  const ONECOLOR = card('Test One Color', 'Sorcery', '', undefined, '{1}{R}');
  it('is automated', () => expect(automated(ARCHAIC)).toBe(true));
  it('two colors spent: +2/+0 to every creature you control', () => {
    const s0 = scenario(LANDS, { p1: { hand: ['Test Two Color'], battlefield: ['Test Archaic', 'Test Elf', 'Mountain', 'Forest'] }, defs: [ARCHAIC, ELF, TWOCOLOR] });
    const s = castAndResolveAll(s0, 'Test Two Color');
    expect(Number(getChars(s, find(s, 'Test Elf', 'battlefield')).power)).toBe(4);
    expect(Number(getChars(s, find(s, 'Test Archaic', 'battlefield')).power)).toBe(4);
  });
  it('one color spent (colorless mana is no color): +1/+0', () => {
    const s0 = scenario(LANDS, { p1: { hand: ['Test One Color'], battlefield: ['Test Archaic', 'Test Elf', 'Mountain', 'Mountain'] }, defs: [ARCHAIC, ELF, ONECOLOR] });
    const s = castAndResolveAll(s0, 'Test One Color');
    expect(Number(getChars(s, find(s, 'Test Elf', 'battlefield')).power)).toBe(3);
  });
});

describe('CR 601.2h: "~ deals damage to target creature equal to the amount of mana spent to cast ~" (Molten Note)', () => {
  const NOTE = card('Test Note', 'Sorcery', 'Test Note deals damage to target creature equal to the amount of mana spent to cast Test Note.', undefined, '{2}{R}');
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['5', '5'], '{3}');
  it('is automated, and three mana spent is three damage', () => {
    expect(automated(NOTE)).toBe(true);
    const s0 = scenario(LANDS, { p1: { hand: ['Test Note'], battlefield: ['Mountain', 'Mountain', 'Mountain'] }, p2: { battlefield: ['Test Ogre'] }, defs: [NOTE, OGRE] });
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p2');
    const s = resolve(castWith(s0, 'Test Note', [[obj(ogre)]]));
    expect(s.objects[ogre]!.damage).toBe(3);
  });
});

describe('CR 601.2h, 614.1c: "~ enters with a number of +1/+1 counters on it equal to the amount of mana spent to cast it" (Dyadrine)', () => {
  const AMALGAM = card('Test Amalgam', 'Creature — Construct', 'Test Amalgam enters with a number of +1/+1 counters on it equal to the amount of mana spent to cast it.', ['0', '0'], '{3}{G}');
  it('is automated, and four mana spent is four counters', () => {
    expect(automated(AMALGAM)).toBe(true);
    const s0 = scenario(LANDS, { p1: { hand: ['Test Amalgam'], battlefield: ['Forest', 'Forest', 'Forest', 'Forest'] }, defs: [AMALGAM] });
    const s = resolve(castWith(s0, 'Test Amalgam'));
    expect(ctr(s, find(s, 'Test Amalgam', 'battlefield'))).toBe(4);
  });
});

describe('CR 601.2h, 614.12: "~ enters with two +1/+1 counters on it if it wasn\'t cast or no mana was spent to cast it" (Freestrider Commando)', () => {
  const COMMANDO = card('Test Commando', 'Creature — Centaur', "This creature enters with two +1/+1 counters on it if it wasn't cast or no mana was spent to cast it.", ['2', '2'], '{2}{G}');
  const FREE = card('Test Free Commando', 'Creature — Centaur', "This creature enters with two +1/+1 counters on it if it wasn't cast or no mana was spent to cast it.", ['2', '2'], '{0}');
  it('is automated', () => expect(automated(COMMANDO)).toBe(true));
  it('cast for mana: no counters', () => {
    const s0 = scenario(LANDS, { p1: { hand: ['Test Commando'], battlefield: ['Forest', 'Forest', 'Forest'] }, defs: [COMMANDO] });
    const s = resolve(castWith(s0, 'Test Commando'));
    expect(ctr(s, find(s, 'Test Commando', 'battlefield'))).toBe(0);
  });
  it('cast with no mana spent (a cost of {0}): two counters', () => {
    const s0 = scenario(LANDS, { p1: { hand: ['Test Free Commando'], battlefield: ['Forest'] }, defs: [FREE] });
    const s = resolve(castWith(s0, 'Test Free Commando'));
    expect(ctr(s, find(s, 'Test Free Commando', 'battlefield'))).toBe(2);
  });
});

describe('fail closed: "that spell" that is not the spell of a cast trigger stays manual', () => {
  it('"Counter target spell. If the amount of mana spent to cast that spell was less than its mana value, you draw a card." is not read as the source\'s own mana (Standard round 4 r4-fxb reads the target\'s, test/cloud/r4-fxb)', () => {
    const def = card('Test Unravel', 'Instant', 'Counter target spell. If the amount of mana spent to cast that spell was less than its mana value, you draw a card.', undefined, '{1}{U}{U}');
    expect(JSON.stringify(def.faces)).not.toContain('"q":"spellManaSpent","of":{"ref":"self"}');
    expect(JSON.stringify(def.faces)).toContain('"q":"spellManaSpent","of":{"ref":"target"');
  });
  it('"if five or more mana was spent to cast that spell" in an ability that is not triggered by a cast stays manual', () => {
    expect(automated(card('Test Wall', 'Creature — Wall', 'Whenever a creature enters, if five or more mana was spent to cast that spell, draw a card.', ['0', '4'], '{1}'))).toBe(false);
  });
});
