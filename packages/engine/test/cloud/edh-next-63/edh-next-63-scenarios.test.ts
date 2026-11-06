/**
 * edh-next-63 (Commander lane counters): the round's readings played through applyAction with synthetic cards compiled by the game's default compiler (invented names
 * and wordings, design 6.10). Nothing is mocked. Each describe names the rules it pins. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, legal, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual node). */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const p2: TargetChoice = { kind: 'player', id: 'p2' };

type Opts = { targets?: TargetChoice[][]; picks?: ObjectId[][]; answers?: DecisionAnswer[] };
/** Answer the decisions that come up, in order, until priority (or nothing scripted is left). */
function settle(s0: GameState, opts: Opts = {}): GameState {
  let s = s0;
  const groups = opts.targets ?? [];
  const picks = opts.picks ?? [];
  const queue = opts.answers ?? [];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
    else if (s.pending.kind === 'chooseTargets' && groups.length > 0) s = answer(s, { kind: 'chooseTargets', targets: groups.shift()! });
    else if (s.pending.kind === 'chooseObjects' && picks.length > 0) s = answer(s, { kind: 'chooseObjects', ids: picks.shift()! });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
/** Pass priority until the stack is empty, answering what comes up. */
function drain(s0: GameState, opts: Opts = {}): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 12; guard++) s = settle(pass(pass(s)), opts);
  return s;
}
function cast(s0: GameState, name: string, opts: Opts = {}, player: 'p1' | 'p2' = 'p1'): GameState {
  const q = { targets: [...(opts.targets ?? [])], picks: [...(opts.picks ?? [])], answers: [...(opts.answers ?? [])] };
  return drain(settle(act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) }), q), q);
}
/** Cast a card from where it is with the cast action legalActions offers for it (its method, if any), and resolve it. */
function castFrom(s0: GameState, id: ObjectId, opts: Opts = {}, player: 'p1' | 'p2' = 'p1'): GameState {
  const offer = legal(s0, player, 'cast').find((a) => a.object === id);
  if (!offer) throw new Error(`no cast action for ${id}`);
  const q = { targets: [...(opts.targets ?? [])], picks: [...(opts.picks ?? [])], answers: [...(opts.answers ?? [])] };
  return drain(settle(act(s0, offer.action), q), q);
}
function activate(s0: GameState, source: ObjectId, ability: string, opts: Opts = {}): GameState {
  const q = { targets: [...(opts.targets ?? [])], picks: [...(opts.picks ?? [])], answers: [...(opts.answers ?? [])] };
  return drain(settle(act(s0, { type: 'activate', player: 'p1', source, ability }), q), q);
}
/** Pass priority (declaring no attackers and no blockers) until `done`. */
function passTo(s0: GameState, done: (s: GameState) => boolean, opts: Opts = {}, max = 400): GameState {
  let s = s0;
  for (let guard = 0; guard < max && !done(s); guard++) {
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = pass(s);
    else s = settle(s, opts);
  }
  if (!done(s)) throw new Error(`never reached (turn ${s.turn.number} ${s.turn.step}, pending ${s.pending?.kind})`);
  return s;
}
function onBattlefield(s: GameState, name: string): ObjectId | undefined { return s.zones.battlefield.find((id) => s.objects[id]!.defId === name); }
const countersOf = (s: GameState, id: ObjectId, kind = '+1/+1'): number => s.objects[id]!.counters[kind] ?? 0;
const has = (s: GameState, id: ObjectId): boolean => s.zones.battlefield.includes(id);
const handSize = (s: GameState, p: 'p1' | 'p2' = 'p1'): number => (s.zones.hand[p] ?? []).length;
const life = (s: GameState, id: 'p1' | 'p2'): number => s.players.find((p) => p.id === id)!.life;

describe('CR 122.1, 608.2d, 608.2c: "remove any number of +1/+1 counters from among creatures you control. If you do, put twice that many +1/+1 counters on ~" (removeCounters.among)', () => {
  const LIZ = card('Test Lizard', 'Creature — Lizard', 'Trample\nWhen this creature enters, you may remove any number of +1/+1 counters from among creatures you control. If you do, put twice that many +1/+1 counters on this creature.', ['2', '2']);
  const A = card('Test Alpha', 'Creature — Ox', '', ['1', '1']);
  const B = card('Test Beta', 'Creature — Ox', '', ['1', '1']);
  it('is automated', () => expect(automated(LIZ)).toBe(true));
  it('removes the numbers asked from each creature (a total over the group) and puts twice the total on the Lizard; other kinds of counters stay', () => {
    let s = scenario([], { p1: { hand: ['Test Lizard'], battlefield: [{ name: 'Test Alpha', counters: { '+1/+1': 3, charge: 2 } }, { name: 'Test Beta', counters: { '+1/+1': 1 } }] }, defs: [LIZ, A, B] });
    const a = find(s, 'Test Alpha', 'battlefield', 'p1');
    const b = find(s, 'Test Beta', 'battlefield', 'p1');
    s = cast(s, 'Test Lizard', { answers: [{ kind: 'yesNo', yes: true }] });
    // the questions that come up: how many from each creature with +1/+1 counters, then the draw of the triggers resolves
    for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 10; guard++) {
      const p = s.pending as unknown as { kind: string; prompt?: string };
      if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: /Test Alpha/.test(p.prompt ?? '') ? 2 : 1 });
      else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
      else break;
    }
    s = drain(s);
    const liz = onBattlefield(s, 'Test Lizard')!;
    expect(countersOf(s, a)).toBe(1);
    expect(countersOf(s, a, 'charge')).toBe(2);
    expect(countersOf(s, b)).toBe(0);
    expect(countersOf(s, liz)).toBe(6); // twice the 3 removed
  });
  it('removing none (answer 0) puts none', () => {
    let s = scenario([], { p1: { hand: ['Test Lizard'], battlefield: [{ name: 'Test Alpha', counters: { '+1/+1': 3 } }] }, defs: [LIZ, A] });
    const a = find(s, 'Test Alpha', 'battlefield', 'p1');
    s = cast(s, 'Test Lizard', { answers: [{ kind: 'yesNo', yes: true }, { kind: 'chooseNumber', n: 0 }] });
    const liz = onBattlefield(s, 'Test Lizard')!;
    expect(countersOf(s, a)).toBe(3);
    expect(countersOf(s, liz)).toBe(0);
  });
});

describe('CR 608.2d, 122.1 (Overseer of Vault 76 ruling 2024-03-08): "you may remove three quest counters from among permanents you control. When you do, ..." removes exactly three, from the permanents the player picks', () => {
  const OV = card('Test Overseer', 'Creature — Human', 'At the beginning of combat on your turn, you may remove three quest counters from among permanents you control. When you do, put a +1/+1 counter on each creature you control.', ['1', '1']);
  const PAL = card('Test Pal', 'Creature — Ox', '', ['1', '1']);
  const RELIC = card('Test Relic', 'Artifact', '');
  it('is automated', () => expect(automated(OV)).toBe(true));
  it('with three counters spread over two permanents, all three go (only quest counters) and every creature gets a +1/+1 counter', () => {
    let s = scenario([], { p1: { battlefield: [{ name: 'Test Overseer', counters: { quest: 1 } }, { name: 'Test Pal', counters: { quest: 1 } }, { name: 'Test Relic', counters: { quest: 1, charge: 4 } }] }, defs: [OV, PAL, RELIC] });
    s = advanceTo(s, 1, 'beginCombat');
    s = drain(s, { answers: [{ kind: 'yesNo', yes: true }, { kind: 'yesNo', yes: true }] });
    const o = onBattlefield(s, 'Test Overseer')!;
    const p = onBattlefield(s, 'Test Pal')!;
    const r = onBattlefield(s, 'Test Relic')!;
    expect([countersOf(s, o, 'quest'), countersOf(s, p, 'quest'), countersOf(s, r, 'quest')]).toEqual([0, 0, 0]);
    expect(countersOf(s, r, 'charge')).toBe(4);
    expect(countersOf(s, o)).toBe(1);
    expect(countersOf(s, p)).toBe(1);
  });
  it('with only two quest counters nothing is removed and the reflexive trigger does not happen', () => {
    let s = scenario([], { p1: { battlefield: [{ name: 'Test Overseer', counters: { quest: 1 } }, { name: 'Test Pal', counters: { quest: 1 } }] }, defs: [OV, PAL] });
    s = advanceTo(s, 1, 'beginCombat');
    s = drain(s, { answers: [{ kind: 'yesNo', yes: true }, { kind: 'yesNo', yes: true }] });
    const o = onBattlefield(s, 'Test Overseer')!;
    const p = onBattlefield(s, 'Test Pal')!;
    expect([countersOf(s, o, 'quest'), countersOf(s, p, 'quest')]).toEqual([1, 1]);
    expect(countersOf(s, o)).toBe(0);
    expect(countersOf(s, p)).toBe(0);
  });
});

describe('CR 122.1, 608.2d, 608.2c: "you may remove up to three stun counters from among all permanents. Draw cards equal to the number of stun counters removed this way" (any player\'s permanents; Sensational Spider-Man ruling 2025-09-19)', () => {
  const WEB = card('Test Webber', 'Creature — Human', '{0}: You may remove up to three stun counters from among all permanents. Draw cards equal to the number of stun counters removed this way.', ['1', '1']);
  const OX = card('Test Ox', 'Creature — Ox', '', ['1', '1']);
  it('is automated', () => expect(automated(WEB)).toBe(true));
  it('takes exactly the chosen total (three of four) from both players\' permanents and draws that many cards; other counters stay', () => {
    let s = scenario([], { p1: { battlefield: [{ name: 'Test Webber', counters: { stun: 2, charge: 1 } }], library: ['Plains', 'Plains', 'Plains', 'Plains'] }, p2: { battlefield: [{ name: 'Test Ox', counters: { stun: 2 } }] }, defs: [WEB, OX] });
    const web = find(s, 'Test Webber', 'battlefield', 'p1');
    const ox = find(s, 'Test Ox', 'battlefield', 'p2');
    s = activate(s, web, 'p:0:0', { answers: [{ kind: 'yesNo', yes: true }, { kind: 'chooseNumber', n: 3 }, { kind: 'chooseOption', ids: ['0'] }, { kind: 'chooseOption', ids: ['0'] }, { kind: 'chooseOption', ids: ['1'] }] });
    expect(countersOf(s, web, 'stun') + countersOf(s, ox, 'stun')).toBe(1);
    expect(countersOf(s, web, 'charge')).toBe(1);
    expect(handSize(s)).toBe(3);
  });
  it('"up to" is satisfied by fewer: answering 1 removes one counter and draws one card; answering 0 does nothing', () => {
    let s = scenario([], { p1: { battlefield: [{ name: 'Test Webber', counters: { stun: 2 } }], library: ['Plains', 'Plains'] }, defs: [WEB] });
    const web = find(s, 'Test Webber', 'battlefield', 'p1');
    s = activate(s, web, 'p:0:0', { answers: [{ kind: 'yesNo', yes: true }, { kind: 'chooseNumber', n: 1 }] });
    expect(countersOf(s, web, 'stun')).toBe(1);
    expect(handSize(s)).toBe(1);
    s = activate(s, web, 'p:0:0', { answers: [{ kind: 'yesNo', yes: true }, { kind: 'chooseNumber', n: 0 }] });
    expect(countersOf(s, web, 'stun')).toBe(1);
    expect(handSize(s)).toBe(1);
  });
});

describe('CR 122.1, 122.5, 608.2d: "move any number of +1/+1 counters from other permanents you control onto this creature" (moveCounters.among with a kind; Aetherborn Marauder ruling 2016-09-20)', () => {
  const MAR = card('Test Marauder', 'Creature — Aetherborn', 'When this creature enters, move any number of +1/+1 counters from other permanents you control onto this creature.', ['1', '1']);
  const A = card('Test Alpha', 'Creature — Ox', '', ['1', '1']);
  const OPP = card('Test Opposing Ox', 'Creature — Ox', '', ['1', '1']);
  it('is automated', () => expect(automated(MAR)).toBe(true));
  it('moves the +1/+1 counters the player names from each of their other permanents; charge counters and an opponent\'s counters stay', () => {
    let s = scenario([], { p1: { hand: ['Test Marauder'], battlefield: [{ name: 'Test Alpha', counters: { '+1/+1': 3, charge: 2 } }] }, p2: { battlefield: [{ name: 'Test Opposing Ox', counters: { '+1/+1': 2 } }] }, defs: [MAR, A, OPP] });
    const a = find(s, 'Test Alpha', 'battlefield', 'p1');
    const o = find(s, 'Test Opposing Ox', 'battlefield', 'p2');
    s = cast(s, 'Test Marauder', { answers: [{ kind: 'chooseNumber', n: 2 }] });
    const m = onBattlefield(s, 'Test Marauder')!;
    expect(countersOf(s, m)).toBe(2);
    expect(countersOf(s, a)).toBe(1);
    expect(countersOf(s, a, 'charge')).toBe(2);
    expect(countersOf(s, o)).toBe(2);
  });
  it('moving none (answer 0) moves none', () => {
    let s = scenario([], { p1: { hand: ['Test Marauder'], battlefield: [{ name: 'Test Alpha', counters: { '+1/+1': 3 } }] }, defs: [MAR, A] });
    const a = find(s, 'Test Alpha', 'battlefield', 'p1');
    s = cast(s, 'Test Marauder', { answers: [{ kind: 'chooseNumber', n: 0 }] });
    expect(countersOf(s, a)).toBe(3);
    expect(countersOf(s, onBattlefield(s, 'Test Marauder')!)).toBe(0);
  });
});

describe('CR 122.6, 603.2c: "Whenever you put one or more counters on another creature, put the same number and kind of counters on ~" (putCounters.ofEvent; Captain Marvel, Apex Avenger)', () => {
  const MARVEL = card('Test Marvel', 'Creature — Human', 'Whenever you put one or more counters on another creature, put the same number and kind of counters on ~.\n{0}: Put two +1/+1 counters on target creature.\n{0}: Put a charge counter on target creature.\n{0}: Put a +1/+1 counter on ~.', ['1', '1']);
  const OX = card('Test Ox', 'Creature — Ox', '', ['1', '1']);
  it('is automated', () => expect(automated(MARVEL)).toBe(true));
  it('copies the number and the kind: two +1/+1 counters on an Ox give Marvel two +1/+1; a charge counter gives it one charge counter', () => {
    let s = scenario([], { p1: { battlefield: ['Test Marvel', 'Test Ox'] }, defs: [MARVEL, OX] });
    const m = find(s, 'Test Marvel', 'battlefield', 'p1');
    const ox = find(s, 'Test Ox', 'battlefield', 'p1');
    s = activate(s, m, 'p:0:1', { targets: [[obj(ox)]] });
    expect(countersOf(s, ox)).toBe(2);
    expect(countersOf(s, m)).toBe(2);
    s = activate(s, m, 'p:0:2', { targets: [[obj(ox)]] });
    expect(countersOf(s, ox, 'charge')).toBe(1);
    expect(countersOf(s, m, 'charge')).toBe(1);
  });
  it('counters put on Marvel itself do not trigger it ("another creature")', () => {
    let s = scenario([], { p1: { battlefield: ['Test Marvel'] }, defs: [MARVEL] });
    const m = find(s, 'Test Marvel', 'battlefield', 'p1');
    s = activate(s, m, 'p:0:3');
    expect(countersOf(s, m)).toBe(1);
  });
});

describe('CR 122.6, 603.2c (Bold Plagiarist ruling 2021-04-16): "Whenever an opponent puts one or more counters on a creature they control, they put the same number and kind of counters on ~"', () => {
  const PLAG = card('Test Plagiarist', 'Creature — Human', 'Whenever an opponent puts one or more counters on a creature they control, they put the same number and kind of counters on this creature.', ['1', '1']);
  const PUMPER = card('Test Pumper', 'Creature — Human', '{0}: Put two +1/+1 counters on target creature.', ['1', '1']);
  const OX = card('Test Ox', 'Creature — Ox', '', ['1', '1']);
  it('is automated', () => expect(automated(PLAG)).toBe(true));
  const opponentPumps = (s0: GameState, source: ObjectId, target: ObjectId): GameState => {
    let s = pass(s0); // the active player passes: the opponent gets priority
    s = act(s, { type: 'activate', player: 'p2', source, ability: 'p:0:0' });
    s = settle(s, { targets: [[obj(target)]] });
    for (let guard = 0; guard < 12 && s.zones.stack.length > 0 && s.pending?.kind === 'priority'; guard++) s = settle(pass(pass(s)));
    return s;
  };
  it('an opponent putting counters on THEIR creature gives the opponent\'s +1/+1 counters to the Plagiarist too, put by that opponent', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Plagiarist'] }, p2: { battlefield: ['Test Pumper', 'Test Ox'] }, defs: [PLAG, PUMPER, OX] });
    const plag = find(s0, 'Test Plagiarist', 'battlefield', 'p1');
    const pump = find(s0, 'Test Pumper', 'battlefield', 'p2');
    const ox = find(s0, 'Test Ox', 'battlefield', 'p2');
    const s = opponentPumps(s0, pump, ox);
    expect(countersOf(s, ox)).toBe(2);
    expect(countersOf(s, plag)).toBe(2);
  });
  it('an opponent putting counters on a creature they do NOT control (mine) does not trigger it', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Plagiarist', 'Test Ox'] }, p2: { battlefield: ['Test Pumper'] }, defs: [PLAG, PUMPER, OX] });
    const plag = find(s0, 'Test Plagiarist', 'battlefield', 'p1');
    const pump = find(s0, 'Test Pumper', 'battlefield', 'p2');
    const ox = find(s0, 'Test Ox', 'battlefield', 'p1');
    const s = opponentPumps(s0, pump, ox);
    expect(countersOf(s, ox)).toBe(2);
    expect(countersOf(s, plag)).toBe(0);
  });
  it('counters I put on my own creature do not trigger it', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Plagiarist', 'Test Pumper', 'Test Ox'] }, defs: [PLAG, PUMPER, OX] });
    const plag = find(s0, 'Test Plagiarist', 'battlefield', 'p1');
    const s = activate(s0, find(s0, 'Test Pumper', 'battlefield', 'p1'), 'p:0:0', { targets: [[obj(find(s0, 'Test Ox', 'battlefield', 'p1'))]] });
    expect(countersOf(s, plag)).toBe(0);
  });
});

describe('CR 603.10a, 700.4, 903.9, 122.1: "Whenever a creature you control dies or is put into the command zone, if it had one or more +1/+1 counters on it, you may put that many +1/+1 counters on target creature" (Reyhan; ruling 2020-11-10)', () => {
  const REY = card('Test Reyhan', 'Creature — Human', 'Whenever a creature you control dies or is put into the command zone, if it had one or more +1/+1 counters on it, you may put that many +1/+1 counters on target creature.', ['1', '1']);
  const OX = card('Test Ox', 'Creature — Ox', '', ['1', '1']);
  const KILL = card('Test Smite', 'Instant', 'Destroy target creature.');
  it('is automated', () => expect(automated(REY)).toBe(true));
  it('a creature that dies with three +1/+1 counters gives three counters to the target (the counters it had, not one)', () => {
    let s = scenario([], { p1: { hand: ['Test Smite'], battlefield: ['Test Reyhan', { name: 'Test Ox', counters: { '+1/+1': 3, charge: 5 } }] }, defs: [REY, OX, KILL] });
    const rey = find(s, 'Test Reyhan', 'battlefield', 'p1');
    const ox = find(s, 'Test Ox', 'battlefield', 'p1');
    s = cast(s, 'Test Smite', { targets: [[obj(ox)], [obj(rey)]], answers: [{ kind: 'yesNo', yes: true }] });
    expect(has(s, ox)).toBe(false);
    expect(countersOf(s, rey)).toBe(3);
    expect(countersOf(s, rey, 'charge')).toBe(0);
  });
  it('a creature with no +1/+1 counter (only charge counters) dying does nothing', () => {
    let s = scenario([], { p1: { hand: ['Test Smite'], battlefield: ['Test Reyhan', { name: 'Test Ox', counters: { charge: 5 } }] }, defs: [REY, OX, KILL] });
    const rey = find(s, 'Test Reyhan', 'battlefield', 'p1');
    const ox = find(s, 'Test Ox', 'battlefield', 'p1');
    s = cast(s, 'Test Smite', { targets: [[obj(ox)]], answers: [{ kind: 'yesNo', yes: true }] });
    expect(has(s, ox)).toBe(false);
    expect(countersOf(s, rey)).toBe(0);
  });
});

describe('CR 603.10a, 122.1: "Whenever a legendary creature with counters on it dies, draw a card for each counter on it. You lose 2 life." (Cleopatra; ruling 2024-07-05)', () => {
  const CLEO = card('Test Pharaoh', 'Creature — Human', 'Whenever a legendary creature with counters on it dies, draw a card for each counter on it. You lose 2 life.', ['1', '1']);
  const KING = card('Test King', 'Legendary Creature — Human', '', ['1', '1']);
  const OX = card('Test Ox', 'Creature — Ox', '', ['1', '1']);
  const KILL = card('Test Smite', 'Instant', 'Destroy target creature.');
  it('is automated', () => expect(automated(CLEO)).toBe(true));
  it('a legendary creature with three counters of two kinds dies: draw three cards, lose 2 life (not 6)', () => {
    let s = scenario([], { p1: { hand: ['Test Smite'], battlefield: ['Test Pharaoh', { name: 'Test King', counters: { '+1/+1': 2, charge: 1 } }], library: ['Plains', 'Plains', 'Plains', 'Plains'] }, defs: [CLEO, KING, KILL] });
    const king = find(s, 'Test King', 'battlefield', 'p1');
    s = cast(s, 'Test Smite', { targets: [[obj(king)]] });
    expect(handSize(s)).toBe(3);
    expect(life(s, 'p1')).toBe(18);
  });
  it('a legendary creature with no counters, or a nonlegendary one with counters, does nothing', () => {
    let s = scenario([], { p1: { hand: ['Test Smite', 'Test Smite'], battlefield: ['Test Pharaoh', 'Test King', { name: 'Test Ox', counters: { '+1/+1': 2 } }], library: ['Plains', 'Plains'] }, defs: [CLEO, KING, OX, KILL] });
    s = cast(s, 'Test Smite', { targets: [[obj(find(s, 'Test King', 'battlefield', 'p1'))]] });
    s = cast(s, 'Test Smite', { targets: [[obj(find(s, 'Test Ox', 'battlefield', 'p1'))]] });
    expect(handSize(s)).toBe(0);
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 122.6, 614.1c, 603.2c: "enters with a +1/+1 counter on it for each loyalty counter on planeswalkers you control" and "whenever one or more loyalty counters are put on planeswalkers you control, put that many +1/+1 counters on ~" (Bioessence Hydra; ruling 2019-05-03)', () => {
  const HYDRA = card('Test Hydra', 'Creature — Hydra', 'Trample\nThis creature enters with a +1/+1 counter on it for each loyalty counter on planeswalkers you control.\nWhenever one or more loyalty counters are put on planeswalkers you control, put that many +1/+1 counters on this creature.', ['0', '0'], '{0}');
  const WALKER = card('Test Walker', 'Planeswalker — Test', '+1: You gain 1 life.\n-2: You gain 2 life.');
  const HYDRA1 = card('Test Hydra', 'Creature — Hydra', 'Whenever one or more loyalty counters are put on planeswalkers you control, put that many +1/+1 counters on this creature.', ['1', '1'], '{0}');
  it('is automated', () => expect(automated(HYDRA)).toBe(true));
  it('enters with one +1/+1 counter per loyalty counter (4 and 2 on two planeswalkers, a rival\'s not counted)', () => {
    let s = scenario([], { p1: { hand: ['Test Hydra'], battlefield: [{ name: 'Test Walker', counters: { loyalty: 4 } }, { name: 'Test Walker', counters: { loyalty: 2 } }] }, p2: { battlefield: [{ name: 'Test Walker', counters: { loyalty: 5 } }] }, defs: [HYDRA, WALKER] });
    s = cast(s, 'Test Hydra');
    expect(countersOf(s, onBattlefield(s, 'Test Hydra')!)).toBe(6);
  });
  it('a loyalty ability that adds a loyalty counter gives it one +1/+1 counter; one that removes loyalty does not', () => {
    const WALKER2 = card('Test Walker Two', 'Planeswalker — Test', '+1: You gain 1 life.\n-2: You gain 2 life.');
    let s = scenario([], { p1: { battlefield: ['Test Hydra', { name: 'Test Walker', counters: { loyalty: 3 } }, { name: 'Test Walker Two', counters: { loyalty: 3 } }] }, defs: [HYDRA1, WALKER, WALKER2] });
    const hydra = find(s, 'Test Hydra', 'battlefield', 'p1');
    const w = find(s, 'Test Walker', 'battlefield', 'p1');
    const w2 = find(s, 'Test Walker Two', 'battlefield', 'p1');
    s = activate(s, w, 'p:0:0');
    expect(countersOf(s, w, 'loyalty')).toBe(4);
    expect(countersOf(s, hydra)).toBe(1);
    s = activate(s, w2, 'p:0:1');
    expect(countersOf(s, w2, 'loyalty')).toBe(1);
    expect(countersOf(s, hydra)).toBe(1);
  });
});

describe('CR 614.12a, 122.1b: "enters with your choice of a +1/+1, first strike, or vigilance counter on it" (Denry Klin) and "your choice of two different counters on it from among menace, deathtouch, and lifelink" (Grimdancer)', () => {
  const THREE = card('Test Chooser', 'Creature — Human', 'This creature enters with your choice of a +1/+1, first strike, or vigilance counter on it.', ['1', '1'], '{0}');
  const TWO = card('Test Dancer', 'Creature — Human', 'This creature enters with your choice of two different counters on it from among menace, deathtouch, and lifelink.', ['1', '1'], '{0}');
  it('are automated', () => { expect(automated(THREE)).toBe(true); expect(automated(TWO)).toBe(true); });
  it('the player picks one of the three kinds and gets exactly one counter of it', () => {
    let s = scenario([], { p1: { hand: ['Test Chooser'] }, defs: [THREE] });
    s = cast(s, 'Test Chooser', { answers: [{ kind: 'chooseOption', ids: ['2'] }] });
    const c = onBattlefield(s, 'Test Chooser')!;
    expect(s.objects[c]!.counters).toEqual({ vigilance: 1 });
  });
  it('the player picks one of the three pairs and gets those two counters (never the same kind twice, never three)', () => {
    let s = scenario([], { p1: { hand: ['Test Dancer'] }, defs: [TWO] });
    s = cast(s, 'Test Dancer', { answers: [{ kind: 'chooseOption', ids: ['2'] }] });
    const c = onBattlefield(s, 'Test Dancer')!;
    expect(s.objects[c]!.counters).toEqual({ deathtouch: 1, lifelink: 1 });
  });
});

describe('CR 122.1, 122.6, 608.2h: "put the same number of each kind of counter on that creature" (Denry Klin; ruling 2022-04-29)', () => {
  const DENRY = card('Test Editor', 'Creature — Human', 'Whenever a nontoken creature you control enters, if this creature has counters on it, put the same number of each kind of counter on that creature.', ['1', '1'], '{0}');
  const OX = card('Test Ox', 'Creature — Ox', '', ['1', '1'], '{0}');
  it('is automated', () => expect(automated(DENRY)).toBe(true));
  it('a nontoken creature that enters gets the same number of each kind (two +1/+1 and one vigilance); with no counters on the Editor nothing happens', () => {
    let s = scenario([], { p1: { hand: ['Test Ox'], battlefield: [{ name: 'Test Editor', counters: { '+1/+1': 2, vigilance: 1 } }] }, defs: [DENRY, OX] });
    s = cast(s, 'Test Ox');
    expect(s.objects[onBattlefield(s, 'Test Ox')!]!.counters).toEqual({ '+1/+1': 2, vigilance: 1 });
    let t = scenario([], { p1: { hand: ['Test Ox'], battlefield: ['Test Editor'] }, defs: [DENRY, OX] });
    t = cast(t, 'Test Ox');
    expect(t.objects[onBattlefield(t, 'Test Ox')!]!.counters).toEqual({});
  });
});

describe('CR 122.1, 608.2c, 119.3, 121.1: "Remove any number of counters from among permanents on the battlefield. You draw cards and lose life equal to the number of counters removed this way." (Eventide\'s Shadow; ruling 2025-11-17: any player\'s permanents)', () => {
  const SHADOW = card('Test Shadow', 'Sorcery', 'Remove any number of counters from among permanents on the battlefield. You draw cards and lose life equal to the number of counters removed this way.');
  const OX = card('Test Ox', 'Creature — Ox', '', ['1', '1']);
  it('is automated', () => expect(automated(SHADOW)).toBe(true));
  it('counters of any kind from both players\' permanents: draws and loses life equal to the total taken', () => {
    let s = scenario([], { p1: { hand: ['Test Shadow'], battlefield: [{ name: 'Test Ox', counters: { '+1/+1': 2, charge: 1 } }], library: ['Plains', 'Plains', 'Plains', 'Plains'] }, p2: { battlefield: [{ name: 'Test Ox', counters: { stun: 3 } }] }, defs: [SHADOW, OX] });
    const mine = find(s, 'Test Ox', 'battlefield', 'p1');
    const theirs = find(s, 'Test Ox', 'battlefield', 'p2');
    // any number: one question per permanent and kind (in the order of the group): take +1/+1 x2, charge x0, stun x1
    s = cast(s, 'Test Shadow', { answers: [{ kind: 'chooseNumber', n: 2 }, { kind: 'chooseNumber', n: 0 }, { kind: 'chooseNumber', n: 1 }] });
    const total = (countersOf(s, mine) + countersOf(s, mine, 'charge') + countersOf(s, theirs, 'stun'));
    expect(total).toBe(6 - 3);
    expect(handSize(s)).toBe(3);
    expect(life(s, 'p1')).toBe(17);
  });
  it('removing none draws none and loses none', () => {
    let s = scenario([], { p1: { hand: ['Test Shadow'], battlefield: [{ name: 'Test Ox', counters: { '+1/+1': 2 } }], library: ['Plains'] }, defs: [SHADOW, OX] });
    s = cast(s, 'Test Shadow', { answers: [{ kind: 'chooseNumber', n: 0 }] });
    expect(handSize(s)).toBe(0);
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 122.6, 603.2c, 122.1b: "Whenever you put one or more counters on ~, put one of each of those kinds of counters on up to one other target creature" and "put your choice of a counter from among first strike, vigilance, deathtouch, and lifelink on ~" (Aragorn, Company Leader)', () => {
  const LEAD = card('Test Leader', 'Creature — Human', 'Whenever you put one or more counters on this creature, put one of each of those kinds of counters on up to one other target creature.\n{0}: Put a +1/+1 counter and a charge counter on this creature.\n{0}: Put a +1/+1 counter on this creature.', ['1', '1']);
  const PICK = card('Test Picker', 'Creature — Human', 'When this creature enters, put your choice of a counter from among first strike, vigilance, deathtouch, and lifelink on this creature.', ['1', '1'], '{0}');
  const OX = card('Test Ox', 'Creature — Ox', '', ['1', '1']);
  it('are automated', () => { expect(automated(LEAD)).toBe(true); expect(automated(PICK)).toBe(true); });
  it('one counter of each kind that was just put (not the number): a +1/+1 and a charge counter on the Leader give the Ox one of each; a lone +1/+1 gives one +1/+1; no target is fine', () => {
    let s = scenario([], { p1: { battlefield: ['Test Leader', 'Test Ox'] }, defs: [LEAD, OX] });
    const lead = find(s, 'Test Leader', 'battlefield', 'p1');
    const ox = find(s, 'Test Ox', 'battlefield', 'p1');
    s = activate(s, lead, 'p:0:1', { targets: [[obj(ox)]] });
    expect(countersOf(s, ox)).toBe(1);
    expect(countersOf(s, ox, 'charge')).toBe(1);
    s = activate(s, lead, 'p:0:2', { targets: [[obj(ox)]] });
    expect(countersOf(s, ox)).toBe(2);
    expect(countersOf(s, ox, 'charge')).toBe(1);
    expect(countersOf(s, lead)).toBe(2);
  });
  it('the player picks one of the four kinds: exactly one counter of the picked kind', () => {
    let s = scenario([], { p1: { hand: ['Test Picker'] }, defs: [PICK] });
    s = cast(s, 'Test Picker', { answers: [{ kind: 'chooseOption', ids: ['2'] }] });
    expect(s.objects[onBattlefield(s, 'Test Picker')!]!.counters).toEqual({ deathtouch: 1 });
  });
});
