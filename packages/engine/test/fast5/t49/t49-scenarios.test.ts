/**
 * FAST5 T49 (T-DMG2): the shapes of parser/templates/zz-fast5/t49.json (damage dealt after "Then", by each of several creatures, with computed amounts and a
 * gain of life, to a creature and its controller, to everything except some kind) and the engine additions they need (the `perSource` damage step, the
 * `adventure` filter, "equipped creatures you control", "he" / "his" of a named character, a flavor word between a Saga chapter's numerals and its effect),
 * played through applyAction with synthetic cards compiled by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 120.1, 120.3, 120.2b   damage; each source deals its own damage, all of it at the same time (not a fight, CR 701.14: nothing comes back)
 *   CR 120.3f, 702.15e        lifelink: the controller of each lifelink source gains the life of that source's damage
 *   CR 608.2c, 608.2h         "Then it deals damage equal to its power": after the pump, the power as the damage is dealt
 *   CR 107.3, 608.2h          "where X is ...": one value for X, "draws X cards, deals X damage and you gain X life"
 *   CR 205.2a, 715.1          "cards in your graveyard that are instant cards, sorcery cards, and/or have an Adventure"
 *   CR 301.5                  "the number of equipped creatures you control"
 *   CR 201.5c, 207.2c, 714.2  "he" of a named character; a flavor word on a Saga chapter
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, pass, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string], extra: Partial<OracleCard> = {}): CardDef {
  return compileCard({ name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: cost, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}), ...extra } as OracleCard as never);
}
/** The abilities of a card that are manual or hold a manual step. */
const manualParts = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' || JSON.stringify(a).includes('"op":"manual"')).map((a) => a.text);
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;
const player = (id: string): TargetChoice => ({ kind: 'player', id }) as TargetChoice;
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const damageOf = (s: GameState, id: ObjectId): number => s.objects[id]!.damage;
const alive = (s: GameState, id: ObjectId): boolean => s.objects[id]?.zone === 'battlefield';
const handSize = (s: GameState, p: string): number => s.zones.hand[p]!.length;

/** Answer the decisions that come up: costs automatically, each target choice from the shared queue in order (one array per target spec), yes/no with `yes`; stop at priority. */
function settle(s0: GameState, queue: TargetChoice[][], yes = true): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 30; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: queue.shift() ?? [] });
    else if (s.pending.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else if (s.pending.kind === 'order') s = answer(s, { kind: 'order', ids: s.pending.items.map((i) => i.id) });
    else break;
  }
  return s;
}
/** Both players pass until the stack is empty; target choices (the spell's, then its triggers') come from the queue in order. */
function resolveAll(s0: GameState, queue: TargetChoice[][], yes = true): GameState {
  let s = settle(s0, queue, yes);
  for (let guard = 0; guard < 40; guard++) {
    if (s.zones.stack.length === 0 && s.pending?.kind === 'priority') return s;
    s = settle(s.pending?.kind === 'priority' ? pass(s) : s, queue, yes);
  }
  throw new Error(`the stack did not empty: ${JSON.stringify(s.pending)} ${s.zones.stack.length} ${s.log.slice(-4).map((l) => l.text).join(' / ')}`);
}
/** Cast the first card of that name from p1's hand and resolve everything; `targets` has one array per target spec, the spell's first. */
const castFirst = (s0: GameState, name: string, targets: TargetChoice[][] = [], yes = true): GameState => {
  const queue = [...targets];
  return resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), queue, yes);
};

const BEAR = 'Grizzly Bears'; // 2/2
const GIANT = 'Hill Giant'; // 3/3
const ANGEL = 'Serra Angel'; // 4/4 flying, vigilance
const NIGHTHAWK = 'Vampire Nighthawk'; // 2/3 flying, deathtouch, lifelink
const AIR = 'Air Elemental'; // 4/4 flying
const SPIDER = 'Giant Spider'; // 2/4 reach

describe('CR 120.3, 120.2b: "One or two target creatures you control each deal damage equal to their power to target creature an opponent controls" (perSource damage)', () => {
  const STRIKE = card('Test Pack Strike', 'Sorcery', 'One or two target creatures you control each deal damage equal to their power to target creature an opponent controls.');
  it('is automated and has no manual part', () => {
    expect(manualParts(STRIKE)).toEqual([]);
  });
  it('two creatures deal their own power: 2 + 3 = 5 damage kills a 4/4 that one of them alone would not', () => {
    const s0 = scenario([BEAR, GIANT, ANGEL], { p1: { hand: ['Test Pack Strike'], battlefield: [BEAR, GIANT] }, p2: { battlefield: [ANGEL] }, defs: [STRIKE] });
    const bears = find(s0, BEAR, 'battlefield', 'p1');
    const giant = find(s0, GIANT, 'battlefield', 'p1');
    const angel = find(s0, ANGEL, 'battlefield', 'p2');
    const both = castFirst(s0, 'Test Pack Strike', [[obj(bears), obj(giant)], [obj(angel)]]);
    expect(alive(both, angel)).toBe(false);
    const one = castFirst(s0, 'Test Pack Strike', [[obj(giant)], [obj(angel)]]);
    expect(alive(one, angel)).toBe(true);
    expect(damageOf(one, angel)).toBe(3);
  });
  it('it is not a fight: the creatures that dealt the damage are dealt none back (CR 701.14 versus CR 120.3)', () => {
    const s0 = scenario([BEAR, GIANT, ANGEL], { p1: { hand: ['Test Pack Strike'], battlefield: [BEAR, GIANT] }, p2: { battlefield: [ANGEL] }, defs: [STRIKE] });
    const s = castFirst(s0, 'Test Pack Strike', [[obj(find(s0, BEAR, 'battlefield', 'p1')), obj(find(s0, GIANT, 'battlefield', 'p1'))], [obj(find(s0, ANGEL, 'battlefield', 'p2'))]]);
    expect(damageOf(s, find(s0, BEAR, 'battlefield', 'p1'))).toBe(0);
    expect(damageOf(s, find(s0, GIANT, 'battlefield', 'p1'))).toBe(0);
  });
  it('CR 120.3f: a lifelink source gains its controller the life of its own damage, once', () => {
    const s0 = scenario([NIGHTHAWK, BEAR, ANGEL], { p1: { hand: ['Test Pack Strike'], battlefield: [NIGHTHAWK, BEAR] }, p2: { battlefield: [ANGEL] }, defs: [STRIKE] });
    const s = castFirst(s0, 'Test Pack Strike', [[obj(find(s0, NIGHTHAWK, 'battlefield', 'p1')), obj(find(s0, BEAR, 'battlefield', 'p1'))], [obj(find(s0, ANGEL, 'battlefield', 'p2'))]]);
    expect(lifeOf(s, 'p1')).toBe(22); // the Nighthawk's 2 damage, not the Bears'
    expect(alive(s, find(s0, ANGEL, 'battlefield', 'p2'))).toBe(false); // 2 + 2 damage (and deathtouch)
  });
  it('CR 608.2b: a source that is no longer there as the spell resolves deals no damage; the other still deals its own', () => {
    const s0 = scenario([BEAR, GIANT, ANGEL], { p1: { hand: ['Test Pack Strike'], battlefield: [BEAR, GIANT] }, p2: { battlefield: [ANGEL] }, defs: [STRIKE] });
    const bears = find(s0, BEAR, 'battlefield', 'p1');
    const giant = find(s0, GIANT, 'battlefield', 'p1');
    const angel = find(s0, ANGEL, 'battlefield', 'p2');
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Pack Strike', 'hand', 'p1') }), [[obj(bears), obj(giant)], [obj(angel)]]);
    s = tweak(s, (t) => { delete t.objects[giant]; t.zones.battlefield = t.zones.battlefield.filter((id) => id !== giant); });
    s = resolveAll(s, []);
    expect(damageOf(s, angel)).toBe(2); // only the Bears' power
  });
  it('CR 608.2b: the recipient is gone: no damage is dealt and nothing breaks', () => {
    const s0 = scenario([BEAR, ANGEL], { p1: { hand: ['Test Pack Strike'], battlefield: [BEAR] }, p2: { battlefield: [ANGEL] }, defs: [STRIKE] });
    const bears = find(s0, BEAR, 'battlefield', 'p1');
    const angel = find(s0, ANGEL, 'battlefield', 'p2');
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Pack Strike', 'hand', 'p1') }), [[obj(bears)], [obj(angel)]]);
    s = tweak(s, (t) => { delete t.objects[angel]; t.zones.battlefield = t.zones.battlefield.filter((id) => id !== angel); });
    s = resolveAll(s, []);
    expect(damageOf(s, bears)).toBe(0);
  });
  it('"one or two": a single target deals its damage alone', () => {
    const s0 = scenario([BEAR, GIANT], { p1: { hand: ['Test Pack Strike'], battlefield: [BEAR] }, p2: { battlefield: [GIANT] }, defs: [STRIKE] });
    const s = castFirst(s0, 'Test Pack Strike', [[obj(find(s0, BEAR, 'battlefield', 'p1'))], [obj(find(s0, GIANT, 'battlefield', 'p2'))]]);
    expect(damageOf(s, find(s0, GIANT, 'battlefield', 'p2'))).toBe(2);
  });
});

describe('CR 608.2c, 120.3: "They each deal damage equal to their power" after a pump of the same targets', () => {
  const TEAM = card('Test Team Up', 'Instant', 'One or two target creatures you control each get +1/+0 until end of turn. They each deal damage equal to their power to target creature an opponent controls.');
  it('is automated; the power is the pumped power as the damage is dealt: (2+1) + (2+1) = 6 kills a 4/4 twice over', () => {
    expect(manualParts(TEAM)).toEqual([]);
    const s0 = scenario([BEAR, ANGEL], { p1: { hand: ['Test Team Up'], battlefield: [BEAR, BEAR] }, p2: { battlefield: [ANGEL] }, defs: [TEAM] });
    const [a, b] = findAll(s0, BEAR, 'battlefield', 'p1');
    const angel = find(s0, ANGEL, 'battlefield', 'p2');
    const s = castFirst(s0, 'Test Team Up', [[obj(a!), obj(b!)], [obj(angel)]]);
    expect(alive(s, angel)).toBe(false);
    expect(damageOf(s, a!)).toBe(0);
  });
  const CLOBBER = card('Test Tap Clobber', 'Sorcery', 'Tap one or two target untapped creatures you control. They each deal damage equal to their power to target creature an opponent controls.');
  it('"Tap ... They each deal": tapped creatures still deal their damage', () => {
    expect(manualParts(CLOBBER)).toEqual([]);
    const s0 = scenario([BEAR, GIANT], { p1: { hand: ['Test Tap Clobber'], battlefield: [BEAR] }, p2: { battlefield: [GIANT] }, defs: [CLOBBER] });
    const bears = find(s0, BEAR, 'battlefield', 'p1');
    const giant = find(s0, GIANT, 'battlefield', 'p2');
    const s = castFirst(s0, 'Test Tap Clobber', [[obj(bears)], [obj(giant)]]);
    expect(s.objects[bears]!.tapped).toBe(true);
    expect(damageOf(s, giant)).toBe(2);
  });
});

describe('CR 115.1, 608.2b: "Any number of target enchanted creatures you control and up to one other target creature you control each deal damage equal to their power"', () => {
  const TAKEDOWN = card('Test Takedown', 'Sorcery', 'Any number of target enchanted creatures you control and up to one other target creature you control each deal damage equal to their power to target creature you don\'t control.');
  it('is automated; with no enchanted creature and one other creature, that one deals its damage', () => {
    expect(manualParts(TAKEDOWN)).toEqual([]);
    const s0 = scenario([BEAR, GIANT, ANGEL], { p1: { hand: ['Test Takedown'], battlefield: [BEAR, GIANT] }, p2: { battlefield: [ANGEL] }, defs: [TAKEDOWN] });
    const giant = find(s0, GIANT, 'battlefield', 'p1');
    const angel = find(s0, ANGEL, 'battlefield', 'p2');
    const s = castFirst(s0, 'Test Takedown', [[obj(giant)], [obj(angel)]]); // no enchanted creature: the first spec is not even asked
    expect(damageOf(s, angel)).toBe(3);
  });
});

describe('CR 608.2c, 608.2h: "Put a +1/+1 counter on target creature you control. Then that creature deals damage equal to its power to target creature an opponent controls."', () => {
  const FELL = card('Test Felling', 'Sorcery', 'Put a +1/+1 counter on target creature you control. Then that creature deals damage equal to its power to target creature an opponent controls.');
  const GNAW = card('Test Rabid Gnawing', 'Instant', 'Target creature you control gets +1/+0 until end of turn. Then it deals damage equal to its power to target creature you don\'t control.');
  it('is automated; the counter is on first: a 2/2 deals 3 and kills a 3/3', () => {
    expect(manualParts(FELL)).toEqual([]);
    const s0 = scenario([BEAR, GIANT], { p1: { hand: ['Test Felling'], battlefield: [BEAR] }, p2: { battlefield: [GIANT] }, defs: [FELL] });
    const giant = find(s0, GIANT, 'battlefield', 'p2');
    const s = castFirst(s0, 'Test Felling', [[obj(find(s0, BEAR, 'battlefield', 'p1'))], [obj(giant)]]);
    expect(alive(s, giant)).toBe(false);
  });
  it('"Then it deals": the pump is on first (2+1 = 3 damage); a damaged source takes nothing back', () => {
    expect(manualParts(GNAW)).toEqual([]);
    const s0 = scenario([BEAR, GIANT], { p1: { hand: ['Test Rabid Gnawing'], battlefield: [BEAR] }, p2: { battlefield: [GIANT] }, defs: [GNAW] });
    const bears = find(s0, BEAR, 'battlefield', 'p1');
    const giant = find(s0, GIANT, 'battlefield', 'p2');
    const s = castFirst(s0, 'Test Rabid Gnawing', [[obj(bears)], [obj(giant)]]);
    expect(alive(s, giant)).toBe(false);
    expect(damageOf(s, bears)).toBe(0);
  });
});

describe('CR 608.2c: "Destroy target artifact. Then ~ deals 3 damage to each creature."', () => {
  const BOMB = card('Test Sweep Bomb', 'Sorcery', 'Destroy target artifact. Then ~ deals 3 damage to each creature.');
  it('is automated; the artifact is destroyed, then every creature is dealt 3 (3/3 dies, 4/4 survives marked)', () => {
    expect(manualParts(BOMB)).toEqual([]);
    const s0 = scenario([GIANT, ANGEL, 'Bonesplitter'], { p1: { hand: ['Test Sweep Bomb'], battlefield: [GIANT] }, p2: { battlefield: [ANGEL, 'Bonesplitter'] }, defs: [BOMB] });
    const equip = find(s0, 'Bonesplitter', 'battlefield', 'p2');
    const s = castFirst(s0, 'Test Sweep Bomb', [[obj(equip)]]);
    expect(alive(s, equip)).toBe(false);
    expect(alive(s, find(s0, GIANT, 'battlefield', 'p1'))).toBe(false);
    expect(damageOf(s, find(s0, ANGEL, 'battlefield', 'p2'))).toBe(3);
  });
});

describe('CR 107.3, 608.2h: "~ deals X damage to each opponent and you gain X life, where X is the number of creatures you control with power 2 or less"', () => {
  const DRAIN = card('Test Small Drain', 'Sorcery', '~ deals X damage to each opponent and you gain X life, where X is the number of creatures you control with power 2 or less.');
  it('is automated; X = 2 with two small creatures and one big one', () => {
    expect(manualParts(DRAIN)).toEqual([]);
    const s0 = scenario([BEAR, GIANT], { p1: { hand: ['Test Small Drain'], battlefield: [BEAR, BEAR, GIANT] }, defs: [DRAIN] });
    const s = castFirst(s0, 'Test Small Drain');
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(lifeOf(s, 'p1')).toBe(22);
  });
  it('with no small creature X = 0: nothing is dealt and nothing gained', () => {
    const s0 = scenario([GIANT], { p1: { hand: ['Test Small Drain'], battlefield: [GIANT] }, defs: [DRAIN] });
    const s = castFirst(s0, 'Test Small Drain');
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
  it('a triggered ability says "it deals X damage" the same way: "Whenever ~ attacks, it deals X damage ... where X is ..."', () => {
    const DOLL = card('Test Toy Doll', 'Legendary Artifact Creature — Toy', 'Whenever ~ attacks, it deals X damage to each opponent and you gain X life, where X is the number of creatures you control with power 2 or less.', '{0}', ['1', '1']);
    expect(manualParts(DOLL)).toEqual([]);
    const s0 = scenario([BEAR, GIANT], { p1: { battlefield: ['Test Toy Doll', BEAR, GIANT] }, defs: [DOLL] });
    const doll = find(s0, 'Test Toy Doll', 'battlefield', 'p1');
    let s = declareAttackers(toDeclareAttackers(s0), [[doll]]);
    s = resolveAll(s, []);
    // the doll and the Bears have power 2 or less (X = 2); the unblocked 1/1 then hits for 1 more
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage' || x.turn.step === 'endCombat', 'blockers or damage', 20);
    expect(lifeOf(s, 'p1')).toBeGreaterThanOrEqual(22);
    expect(lifeOf(s, 'p2')).toBeLessThanOrEqual(18);
  });
});

describe('CR 107.3, 601.2h: "Target player draws X cards, ~ deals X damage to any target, and you gain X life, where X is the number of colors of mana spent to cast ~"', () => {
  const TOGETHER = card('Test Converge Burst', 'Sorcery', 'Target player draws X cards, ~ deals X damage to any target, and you gain X life, where X is the number of colors of mana spent to cast this spell.', '{R}{G}');
  it('is automated; two colors spent: draw 2, deal 2, gain 2', () => {
    expect(manualParts(TOGETHER)).toEqual([]);
    const s0 = scenario(['Mountain', 'Forest'], { p1: { hand: ['Test Converge Burst'], battlefield: ['Mountain', 'Forest'] }, defs: [TOGETHER] });
    const hand0 = handSize(s0, 'p1');
    const s = castFirst(s0, 'Test Converge Burst', [[player('p1')], [player('p2')]]);
    expect(handSize(s, 'p1')).toBe(hand0 - 1 + 2); // the spell left the hand, two cards drawn
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(lifeOf(s, 'p1')).toBe(22);
  });
});

describe('CR 120.3, 107.3: "~ deals 5 damage to target creature and X damage to that creature\'s controller, where X is the number of Equipment you control"', () => {
  const BOLT = card('Test Judging Bolt', 'Instant', '~ deals 5 damage to target creature and X damage to that creature\'s controller, where X is the number of Equipment you control.');
  it('is automated; with two Equipment the creature takes 5 and its controller 2, in one damage event', () => {
    expect(manualParts(BOLT)).toEqual([]);
    const s0 = scenario([ANGEL, 'Bonesplitter', 'Cryptic Coat'], { p1: { hand: ['Test Judging Bolt'], battlefield: ['Bonesplitter', 'Cryptic Coat'] }, p2: { battlefield: [ANGEL] }, defs: [BOLT] });
    const angel = find(s0, ANGEL, 'battlefield', 'p2');
    const s = castFirst(s0, 'Test Judging Bolt', [[obj(angel)]]);
    expect(alive(s, angel)).toBe(false);
    expect(lifeOf(s, 'p2')).toBe(18);
  });
  it('with no Equipment X = 0: only the creature is dealt damage', () => {
    const s0 = scenario([ANGEL], { p1: { hand: ['Test Judging Bolt'] }, p2: { battlefield: [ANGEL] }, defs: [BOLT] });
    const s = castFirst(s0, 'Test Judging Bolt', [[obj(find(s0, ANGEL, 'battlefield', 'p2'))]]);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
});

describe('CR 205.2a, 715.1: "~ deals X damage to target creature, where X is 2 plus the number of cards in your graveyard that are instant cards, sorcery cards, and/or have an Adventure"', () => {
  const FIREBOLT = card('Test Frantic Spark', 'Instant', '~ deals X damage to target creature, where X is 2 plus the number of cards in your graveyard that are instant cards, sorcery cards, and/or have an Adventure.', '{0}');
  it('is automated and has no manual part', () => {
    expect(manualParts(FIREBOLT)).toEqual([]);
  });
  it('counts an Adventure card in the graveyard, not a plain creature card: 2 + 1 = 3 damage to a 4/4, which survives', () => {
    const s0 = scenario([ANGEL, BEAR, GIANT, 'Bonecrusher Giant // Stomp'], { p1: { hand: ['Test Frantic Spark'], graveyard: ['Bonecrusher Giant // Stomp', BEAR, GIANT] }, p2: { battlefield: [ANGEL] }, defs: [FIREBOLT] });
    const angel = find(s0, ANGEL, 'battlefield', 'p2');
    const s = castFirst(s0, 'Test Frantic Spark', [[obj(angel)]]);
    expect(damageOf(s, angel)).toBe(3);
  });
  it('counts the instant too: 2 + 2 = 4 damage kills the 4/4', () => {
    const s0 = scenario([ANGEL, BEAR, 'Lightning Bolt', 'Bonecrusher Giant // Stomp'], { p1: { hand: ['Test Frantic Spark'], graveyard: ['Lightning Bolt', 'Bonecrusher Giant // Stomp', BEAR] }, p2: { battlefield: [ANGEL] }, defs: [FIREBOLT] });
    const angel = find(s0, ANGEL, 'battlefield', 'p2');
    expect(alive(castFirst(s0, 'Test Frantic Spark', [[obj(angel)]]), angel)).toBe(false);
  });
  it('the spell itself is on the stack as it resolves, so it does not count (CR 608.2h reads the graveyard as it resolves)', () => {
    const s0 = scenario([ANGEL], { p1: { hand: ['Test Frantic Spark'] }, p2: { battlefield: [ANGEL] }, defs: [FIREBOLT] });
    const angel = find(s0, ANGEL, 'battlefield', 'p2');
    const s = castFirst(s0, 'Test Frantic Spark', [[obj(angel)]]);
    expect(damageOf(s, angel)).toBe(2);
  });
});

describe('CR 301.5: "it deals damage equal to the number of equipped creatures you control to defending player"', () => {
  const BARRET = card('Test Gunner', 'Legendary Creature — Human Rebel', 'Reach\nWhenever ~ attacks, it deals damage equal to the number of equipped creatures you control to defending player.', '{0}', ['2', '2']);
  it('is automated', () => {
    expect(manualParts(BARRET)).toEqual([]);
  });
  it('two equipped creatures (the attacker is one): the attack trigger deals 2 to the defending player; an unequipped one does not count', () => {
    const s0 = scenario([BEAR, 'Bonesplitter'], { p1: { battlefield: ['Test Gunner', BEAR, BEAR, 'Bonesplitter', 'Bonesplitter'] }, defs: [BARRET] });
    const gunner = find(s0, 'Test Gunner', 'battlefield', 'p1');
    const [b1, b2] = findAll(s0, BEAR, 'battlefield', 'p1');
    const [e1, e2] = findAll(s0, 'Bonesplitter', 'battlefield', 'p1');
    const rigged = tweak(s0, (t) => { t.objects[e1!]!.attachedTo = gunner; t.objects[e2!]!.attachedTo = b1!; });
    let s = declareAttackers(toDeclareAttackers(rigged), [[gunner]]);
    s = resolveAll(s, []);
    // before combat damage: only the trigger's damage
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(b2).toBeDefined();
  });
});

describe('CR 201.5c: "he" / "him" / "his" of a named character is the object itself when its own line named it first', () => {
  const HERO = card('Test Gauntlet Hero', 'Legendary Creature — Human Rogue', 'When Test Gauntlet Hero enters, he deals 2 damage to target creature and 2 damage to that creature\'s controller.', '{0}', ['2', '2']);
  it('is automated', () => {
    expect(manualParts(HERO)).toEqual([]);
  });
  it('plays: the creature takes 2 and so does its controller', () => {
    const s0 = scenario([GIANT], { p1: { hand: ['Test Gauntlet Hero'] }, p2: { battlefield: [GIANT] }, defs: [HERO] });
    const giant = find(s0, GIANT, 'battlefield', 'p2');
    const s = castFirst(s0, 'Test Gauntlet Hero', [[obj(giant)]]);
    expect(damageOf(s, giant)).toBe(2);
    expect(lifeOf(s, 'p2')).toBe(18);
  });
  it('"his power" and "on him" are the object too: "When ~ enters, put a +1/+1 counter on him. He deals damage equal to his power to target player."', () => {
    const BIG = card('Test Growing Hero', 'Legendary Creature — Human Warrior', 'When Test Growing Hero enters, put a +1/+1 counter on him. He deals damage equal to his power to target player.', '{0}', ['2', '2']);
    expect(manualParts(BIG)).toEqual([]);
    const s0 = scenario([], { p1: { hand: ['Test Growing Hero'] }, defs: [BIG] });
    const s = castFirst(s0, 'Test Growing Hero', [[player('p2')]]);
    expect(lifeOf(s, 'p2')).toBe(17);
  });
  it('a pronoun in a line that has not named the object (or outside a legendary creature) stays an unknown word: the line is manual, never guessed', () => {
    const NOT = card('Test Plain Beast', 'Creature — Beast', 'When Test Plain Beast enters, he deals 2 damage to target creature.', '{0}', ['2', '2']);
    expect(manualParts(NOT).length).toBeGreaterThan(0);
    const NAMELESS = card('Test Other Hero', 'Legendary Creature — Human Rogue', 'Target creature you control deals damage to him equal to its power.', '{0}', ['2', '2']);
    expect(manualParts(NAMELESS).length).toBeGreaterThan(0);
  });
});

describe('CR 714.2, 207.2c: a flavor word between a Saga chapter and its effect has no rules meaning', () => {
  const SAGA = card('Test Judgment Saga', 'Enchantment — Saga', 'I -- Bright Bolt -- ~ deals 2 damage to target creature an opponent controls.\nII, III -- Draw a card.', '{0}');
  it('the chapter keeps its effect and its label; nothing is manual', () => {
    expect(manualParts(SAGA)).toEqual([]);
    const chapter = SAGA.faces[0]!.abilities.find((a) => a.kind === 'chapter');
    expect(chapter).toBeDefined();
    expect((chapter as { label?: string }).label).toBe('Bright Bolt');
  });
});

describe('CR 205.2, 608.2b: "~ deals 2 damage to each creature except for creatures you control with flying"', () => {
  const SWEEP = card('Test Flame Sweeper', 'Instant', '~ deals 2 damage to each creature except for creatures you control with flying.');
  it('is automated; your flyers and nothing else you have are spared', () => {
    expect(manualParts(SWEEP)).toEqual([]);
    const s0 = scenario([BEAR, AIR], { p1: { hand: ['Test Flame Sweeper'], battlefield: [BEAR, AIR] }, p2: { battlefield: [BEAR, AIR] }, defs: [SWEEP] });
    const mineAir = find(s0, AIR, 'battlefield', 'p1');
    const mineBear = find(s0, BEAR, 'battlefield', 'p1');
    const theirAir = find(s0, AIR, 'battlefield', 'p2');
    const s = castFirst(s0, 'Test Flame Sweeper');
    expect(damageOf(s, mineAir)).toBe(0);
    expect(alive(s, mineBear)).toBe(false);
    expect(damageOf(s, theirAir)).toBe(2);
  });
});
