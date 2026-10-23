/**
 * Cloud std-fin (the Final Fantasy slice of the Standard backlog): the templates of parser/templates/zz-cloud/std-fin.json and the parser and renderer readings they
 * needed, played through the engine with synthetic cards compiled by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 701.17a, 107.1a   mill half a library, rounded down
 *   CR 701.8a, 608.2d    destroy all / up to one of the Equipment attached to a creature (chosen on resolution, not targeted)
 *   CR 120.2, 608.2h     a creature deals damage to another target and to itself at once, both its power as the spell resolves
 *   CR 603.2, 603.4      "Whenever ... during your turn"; "whenever A and whenever B" is one trigger
 *   CR 608.2g, 601.2     "You may cast it" casts the card now, during the resolution; "If you don't, ..." reads that choice
 *   CR 613.4b, 611.2c    "until end of turn, its base power becomes equal to ...": layer 7b, the number read as it resolves
 *   CR 701.24a, 608.2c   cards shuffled into a library "this way" are counted
 *   CR 701.3a, 701.3d    attach any number of / one chosen Equipment; "unattach it" at the next end step (a delayed trigger, CR 603.7a)
 *   CR 608.2c, 400.7     "If you don't put the card onto the battlefield, put it into your hand": the card looked at, whatever happened to the option
 *   CR 118.12            "you may pay {2}. If you do, create a token, then attach ~ to it": the token the branch created
 *   CR 701.20e           look at the top card of a library, then exile it face down; play it while it remains exiled
 *   CR 608.2c            "Then if C, X." conditions only X (eff.t34.thenIf, promoted to stable here)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, life, pass, scenario, zoneNames } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../m4/helpers';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated, and the card full. */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id } as TargetChoice);
const yes: DecisionAnswer = { kind: 'yesNo', yes: true };
const no: DecisionAnswer = { kind: 'yesNo', yes: false };

/**
 * Answer the decisions that come up: targets from `targets`, object choices from `picks`, then `answers` (each list is consumed in place, so one set of answers
 * serves a spell and the abilities it triggers); pay costs automatically; stop at priority.
 */
function settle(s0: GameState, opts: { targets?: TargetChoice[][]; picks?: ObjectId[][]; answers?: DecisionAnswer[] } = {}): { s: GameState; asked: string[] } {
  let s = s0;
  const asked: string[] = [];
  const groups = opts.targets ?? [];
  const picks = opts.picks ?? [];
  const queue = opts.answers ?? [];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    asked.push(s.pending.kind);
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets' && groups.length > 0) s = answer(s, { kind: 'chooseTargets', targets: groups.shift()! });
    else if (s.pending.kind === 'chooseObjects' && picks.length > 0) s = answer(s, { kind: 'chooseObjects', ids: picks.shift()! });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return { s, asked };
}
type Opts = Parameters<typeof settle>[1];
/** Pass priority until the stack is empty, answering what comes up. */
function drain(s0: GameState, opts: Opts = {}): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 8; guard++) s = settle(pass(pass(s)), opts).s;
  return s;
}
/** Cast a spell p1 holds (targets first), let it and what it triggered resolve. */
function cast(s0: GameState, name: string, opts: Opts = {}): GameState {
  const q = { targets: [...(opts.targets ?? [])], picks: [...(opts.picks ?? [])], answers: [...(opts.answers ?? [])] };
  return drain(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), { targets: q.targets }).s, q);
}
/** Activate the first non-mana ability of p1's permanent, then let it resolve. */
function activate(s0: GameState, source: ObjectId, opts: Opts = {}, ability = 'p:0:0'): GameState {
  const q = { targets: [...(opts.targets ?? [])], picks: [...(opts.picks ?? [])], answers: [...(opts.answers ?? [])] };
  return drain(settle(act(s0, { type: 'activate', player: 'p1', source, ability }), { targets: q.targets }).s, q);
}
/** Pass priority (declaring no attackers and no blockers) until `done`. */
function passTo(s0: GameState, done: (s: GameState) => boolean, max = 200): GameState {
  let s = s0;
  for (let guard = 0; guard < max && !done(s); guard++) {
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else s = pass(s);
  }
  if (!done(s)) throw new Error('never reached');
  return s;
}
/** Pass to the end step of this turn (no attackers declared) until its first trigger is on the stack. */
function toEndStepTrigger(s0: GameState): GameState {
  let s = s0;
  for (let guard = 0; guard < 60 && !(s.turn.step === 'end' && s.zones.stack.length > 0); guard++) {
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else s = pass(s);
  }
  return s;
}
const power = (s: GameState, id: ObjectId): number => Number(getChars(s, id)!.power);
const toughness = (s: GameState, id: ObjectId): number => Number(getChars(s, id)!.toughness);
const counters = (s: GameState, id: ObjectId, kind = '+1/+1'): number => s.objects[id]?.counters[kind] ?? 0;
const handSize = (s: GameState, p = 'p1'): number => s.zones.hand[p]!.length;
const librarySize = (s: GameState, p = 'p1'): number => s.zones.library[p]!.length;
const onBattlefield = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name);
const tokens = (s: GameState, name: string, p = 'p1'): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId.startsWith(`token:${name}`) && s.objects[id]!.controller === p);

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['4', '5']);
const SWORD = card('Test Sword', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nEquip {2}');
const AXE = card('Test Axe', 'Artifact — Equipment', 'Equipped creature gets +2/+0.\nEquip {2}');
const LAND = card('Test Land', 'Land', '');
const ROCK = card('Test Rock', 'Artifact', '');

describe('CR 701.17a, 107.1a: "target opponent mills half their library, rounded down"', () => {
  const MILL = card('Test Sieve', 'Sorcery', 'Target opponent mills half their library, rounded down.');
  it('is automated, and an opponent with 21 cards mills 10', () => {
    expect(full(MILL)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Sieve'] }, p2: { library: ['Test Rock'] }, defs: [MILL, ROCK] });
    expect(librarySize(s, 'p2')).toBe(21);
    s = cast(s, 'Test Sieve', { targets: [[player('p2')]] });
    expect(librarySize(s, 'p2')).toBe(11);
    expect(s.zones.graveyard['p2']!.length).toBe(10);
  });
});

describe('CR 701.8a, 608.2d: "Destroy all Equipment attached to that creature." / "Destroy up to one Equipment attached to that creature."', () => {
  const BLAST = card('Test Blast', 'Instant', 'Test Blast deals 1 damage to target creature. Destroy all Equipment attached to that creature.');
  const JUDGE = card('Test Judge', 'Instant', 'Test Judge deals 1 damage to target creature. Destroy up to one Equipment attached to that creature.');
  /** p2's Ogre with p2's Sword and Axe attached, a Sword of p2 attached to nothing, and p2's Bear with an Axe of its own. */
  function board(spell: string): { s: GameState; ogre: ObjectId; sword: ObjectId; axe: ObjectId; loose: ObjectId; other: ObjectId } {
    const s = scenario([], { p1: { hand: [spell] }, p2: { battlefield: ['Test Ogre', 'Test Bear', 'Test Sword', 'Test Axe', 'Test Sword', 'Test Axe'] }, defs: [BLAST, JUDGE, OGRE, BEAR, SWORD, AXE] });
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    const [sword, loose] = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Sword');
    const [axe, other] = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Axe');
    for (const id of [sword!, axe!]) s.objects[id]!.attachedTo = ogre;
    s.objects[other!]!.attachedTo = bear;
    return { s, ogre, sword: sword!, axe: axe!, loose: loose!, other: other! };
  }
  it('are automated', () => {
    expect(full(BLAST)).toBe(true);
    expect(full(JUDGE)).toBe(true);
  });
  it('all: both Equipment attached to the creature are destroyed; the unattached Equipment and the one on another creature stay', () => {
    const b = board('Test Blast');
    const s = cast(b.s, 'Test Blast', { targets: [[obj(b.ogre)]] });
    expect(s.zones.battlefield).not.toContain(b.sword);
    expect(s.zones.battlefield).not.toContain(b.axe);
    expect(s.zones.battlefield).toContain(b.loose);
    expect(s.zones.battlefield).toContain(b.other);
  });
  it('up to one: the caster chooses one of the attached Equipment on resolution (no target); only it is destroyed', () => {
    const b = board('Test Judge');
    const s = cast(b.s, 'Test Judge', { targets: [[obj(b.ogre)]], picks: [[b.axe]] });
    expect(s.zones.battlefield).not.toContain(b.axe);
    expect(s.zones.battlefield).toContain(b.sword);
    expect(s.zones.battlefield).toContain(b.loose);
    expect(s.zones.battlefield).toContain(b.other);
  });
  it('up to one: choosing none destroys nothing', () => {
    const b = board('Test Judge');
    const s = cast(b.s, 'Test Judge', { targets: [[obj(b.ogre)]], picks: [[]] });
    expect(s.zones.battlefield).toContain(b.axe);
    expect(s.zones.battlefield).toContain(b.sword);
  });
});

describe('CR 120.2, 608.2h: "Target creature you control deals X damage to any other target and X damage to itself, where X is its power."', () => {
  const BURST = card('Test Burst', 'Instant', 'Target creature you control deals X damage to any other target and X damage to itself, where X is its power.');
  it('is automated; a 4/5 deals 4 to the opponent and 4 to itself (it survives); a 2/2 dies dealing 2', () => {
    expect(full(BURST)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Burst', 'Test Burst'], battlefield: ['Test Ogre', 'Test Bear'] }, defs: [BURST, OGRE, BEAR] });
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Burst', { targets: [[obj(ogre)], [player('p2')]] });
    expect(life(s, 'p2')).toBe(16);
    expect(s.objects[ogre]!.damage).toBe(4);
    s = cast(s, 'Test Burst', { targets: [[obj(bear)], [player('p2')]] });
    expect(life(s, 'p2')).toBe(14);
    expect(s.zones.battlefield).not.toContain(bear);
  });
});

describe('CR 701.3a, 608.2d: "you may attach any number of Equipment you control to target creature you control"', () => {
  const RALLY = card('Test Rally', 'Sorcery', 'You may attach any number of Equipment you control to target creature you control.');
  it('is automated; the chosen Equipment are attached, the others stay where they were', () => {
    expect(full(RALLY)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Rally'], battlefield: ['Test Ogre', 'Test Bear', 'Test Sword', 'Test Axe', 'Test Sword'] }, defs: [RALLY, OGRE, BEAR, SWORD, AXE] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p1');
    const [sword, sword2] = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Sword');
    const axe = find(s, 'Test Axe', 'battlefield', 'p1');
    s.objects[sword2!]!.attachedTo = ogre;
    s = cast(s, 'Test Rally', { targets: [[obj(bear)]], answers: [yes], picks: [[sword!, axe]] });
    expect(s.objects[sword!]!.attachedTo).toBe(bear);
    expect(s.objects[axe]!.attachedTo).toBe(bear);
    expect(s.objects[sword2!]!.attachedTo).toBe(ogre);
    expect([power(s, bear), toughness(s, bear)]).toEqual([5, 3]);
  });
});

describe('CR 701.3a, 701.3d, 603.7a: "You may attach an Equipment you control to target creature you control. If you do, unattach it at the beginning of the next end step."', () => {
  const LOAN = card('Test Loan', 'Sorcery', 'You may attach an Equipment you control to target creature you control. If you do, unattach it at the beginning of the next end step.');
  it('is automated; the Equipment is attached now and unattached at the beginning of the end step (it stays on the battlefield)', () => {
    expect(full(LOAN)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Loan'], battlefield: ['Test Bear', 'Test Sword'] }, defs: [LOAN, BEAR, SWORD] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const sword = find(s, 'Test Sword', 'battlefield', 'p1');
    s = cast(s, 'Test Loan', { targets: [[obj(bear)]], answers: [yes], picks: [[sword]] });
    expect(s.objects[sword]!.attachedTo).toBe(bear);
    s = toEndStepTrigger(s);
    s = drain(s);
    expect(s.objects[sword]!.attachedTo ?? null).toBeNull();
    expect(s.zones.battlefield).toContain(sword);
  });
  it('declined: nothing is attached and nothing waits for the end step', () => {
    let s = scenario([], { p1: { hand: ['Test Loan'], battlefield: ['Test Bear', 'Test Sword'] }, defs: [LOAN, BEAR, SWORD] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const sword = find(s, 'Test Sword', 'battlefield', 'p1');
    s = cast(s, 'Test Loan', { targets: [[obj(bear)]], answers: [no] });
    expect(s.objects[sword]!.attachedTo ?? null).toBeNull();
    expect(s.delayedTriggers?.length ?? 0).toBe(0);
  });
});

describe('CR 603.2, 500.1: "Whenever an opponent loses life during your turn, put a +1/+1 counter on ~."', () => {
  const LEECH = card('Test Leech', 'Creature — Leech', 'Whenever an opponent loses life during your turn, put a +1/+1 counter on this creature.', ['1', '1']);
  const DRAIN = card('Test Drain', 'Instant', 'Target opponent loses 1 life.');
  it('is automated; it triggers on your turn only', () => {
    expect(full(LEECH)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Drain', 'Test Drain'], battlefield: ['Test Leech'] }, defs: [LEECH, DRAIN] });
    const leech = find(s, 'Test Leech', 'battlefield', 'p1');
    s = cast(s, 'Test Drain', { targets: [[player('p2')]] });
    expect(life(s, 'p2')).toBe(19);
    expect(counters(s, leech)).toBe(1);
    // the opponent's turn: p2 has priority first in their upkeep, then p1 casts the instant
    s = passTo(s, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'upkeep' && x.pending?.kind === 'priority' && x.pending.player === 'p1');
    s = cast(s, 'Test Drain', { targets: [[player('p2')]] });
    expect(life(s, 'p2')).toBe(18);
    expect(counters(s, leech)).toBe(1);
  });
});

describe('CR 603.2, 603.2c: "Whenever you cast a red spell and whenever a Mountain you control enters, put a +1/+1 counter on ~." (one trigger, two events)', () => {
  const HOUND = card('Test Hound', 'Creature — Dog', 'Whenever you cast a red spell and whenever a Mountain you control enters, put a +1/+1 counter on this creature.', ['2', '2']);
  const SPARK = card('Test Spark', 'Instant', 'Draw a card.', undefined, '{0}', ['R']);
  const PEAK = card('Test Peak', 'Basic Land — Mountain', '');
  it('is automated; a red spell and a Mountain each put a counter on it; a colorless spell does not', () => {
    expect(full(HOUND)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Spark', 'Test Peak', 'Test Rock'], battlefield: ['Test Hound'] }, defs: [HOUND, SPARK, PEAK, ROCK] });
    const hound = find(s, 'Test Hound', 'battlefield', 'p1');
    s = cast(s, 'Test Spark');
    expect(counters(s, hound)).toBe(1);
    s = drain(settle(act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Peak', 'hand', 'p1') })).s);
    expect(counters(s, hound)).toBe(2);
    s = cast(s, 'Test Rock');
    expect(counters(s, hound)).toBe(2);
  });
});

describe('CR 608.2g, 601.2: "exile the top card of your library. You may cast it. If you don\'t, you gain 2 life."', () => {
  const RAIDER = card('Test Raider', 'Creature — Pirate', 'Whenever this creature attacks, exile the top card of your library. You may cast it. If you don\'t, you gain 2 life.', ['2', '2']);
  const BOOK = card('Test Book', 'Sorcery', 'Draw two cards.');
  function attack(take: boolean): GameState {
    let s = scenario([], { p1: { battlefield: ['Test Raider'], library: ['Test Book'] }, defs: [RAIDER, BOOK] });
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Raider', 'battlefield', 'p1')]]);
    return drain(s, { answers: [take ? yes : no] });
  }
  it('is automated', () => expect(full(RAIDER)).toBe(true));
  it('cast: the exiled sorcery is cast now, during combat (CR 608.2g), and resolves: two cards drawn, no life gained', () => {
    const s = attack(true);
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Book');
    expect(handSize(s)).toBe(2);
    expect(life(s, 'p1')).toBe(20);
  });
  it("not cast: it stays in exile and you gain 2 life", () => {
    const s = attack(false);
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Book')).toBe(true);
    expect(life(s, 'p1')).toBe(22);
  });
});

describe('CR 613.4b, 611.2c: "{2}: Until end of turn, ~\'s base power becomes equal to the number of Forests you control."', () => {
  const SAUCER = card('Test Saucer', 'Artifact Creature — Construct', '{2}: Until end of turn, this creature\'s base power becomes equal to the number of Forests you control.', ['1', '4']);
  it('is automated; with three Forests it is a 3/4 (a +1/+1 counter still adds on top, layer 7c), and a 1/4 again after the turn', () => {
    expect(full(SAUCER)).toBe(true);
    let s = scenario(['Forest'], { p1: { battlefield: ['Test Saucer', 'Forest', 'Forest', 'Forest', 'Plains', 'Plains'] }, defs: [SAUCER] });
    const saucer = find(s, 'Test Saucer', 'battlefield', 'p1');
    s.objects[saucer]!.counters['+1/+1'] = 1;
    s = activate(s, saucer);
    expect([power(s, saucer), toughness(s, saucer)]).toEqual([4, 5]);
    s = passTo(s, (x) => x.turn.activePlayer === 'p2' && x.pending?.kind === 'priority');
    expect([power(s, saucer), toughness(s, saucer)]).toEqual([2, 5]);
  });
});

describe('CR 701.24a, 608.2c: "Shuffle all creature cards from your graveyard into your library. You gain life equal to the number of cards shuffled into your library this way."', () => {
  const FLASK = card('Test Flask', 'Artifact', '{T}: Shuffle all creature cards from your graveyard into your library. You gain life equal to the number of cards shuffled into your library this way.');
  it('is automated; two creature cards go back (the land card stays) and you gain 2 life', () => {
    expect(full(FLASK)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Flask'], graveyard: ['Test Bear', 'Test Ogre', 'Test Land'] }, defs: [FLASK, BEAR, OGRE, LAND] });
    const before = librarySize(s);
    s = activate(s, find(s, 'Test Flask', 'battlefield', 'p1'));
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Land']);
    expect(librarySize(s)).toBe(before + 2);
    expect(life(s, 'p1')).toBe(22);
  });
});

describe('CR 608.2c, 400.7: "Look at the top card of your library. If it\'s a land card, you may put it onto the battlefield. If you don\'t put the card onto the battlefield, put it into your hand."', () => {
  const SCOUT = card('Test Scout', 'Creature — Elf Scout', '{T}: Look at the top card of your library. If it\'s a land card, you may put it onto the battlefield. If you don\'t put the card onto the battlefield, put it into your hand.', ['1', '1']);
  const run = (top: string, answers: DecisionAnswer[]): GameState => {
    const s = scenario([], { p1: { battlefield: ['Test Scout'], library: [top] }, defs: [SCOUT, LAND, BEAR] });
    return activate(s, find(s, 'Test Scout', 'battlefield', 'p1'), { answers });
  };
  it('is automated', () => expect(full(SCOUT)).toBe(true));
  it('a land card, put onto the battlefield: not into the hand', () => {
    const s = run('Test Land', [yes]);
    expect(onBattlefield(s, 'Test Land')).toHaveLength(1);
    expect(handSize(s)).toBe(0);
  });
  it('a land card, declined: it goes to the hand', () => {
    const s = run('Test Land', [no]);
    expect(onBattlefield(s, 'Test Land')).toHaveLength(0);
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Land']);
  });
  it('a nonland card: never offered, it goes to the hand', () => {
    const s = run('Test Bear', []);
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Bear']);
  });
});

describe('CR 118.12, 701.3a: "When this Equipment enters, you may pay {2}. If you do, create a 1/1 white Soldier creature token, then attach this Equipment to it."', () => {
  const LANCE = card('Test Lance', 'Artifact — Equipment', 'When this Equipment enters, you may pay {2}. If you do, create a 1/1 white Soldier creature token, then attach this Equipment to it.\nEquipped creature gets +1/+0.\nEquip {3}');
  it('is automated; paid, the Equipment is attached to the new token (a 2/1); not paid, no token', () => {
    expect(full(LANCE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Lance'], battlefield: ['Plains', 'Plains'] }, defs: [LANCE] });
    s = cast(s, 'Test Lance', { answers: [yes] });
    const [soldier] = tokens(s, 'Soldier');
    expect(soldier).toBeDefined();
    const lance = find(s, 'Test Lance', 'battlefield', 'p1');
    expect(s.objects[lance]!.attachedTo).toBe(soldier);
    expect([power(s, soldier!), toughness(s, soldier!)]).toEqual([2, 1]);
    let d = scenario([], { p1: { hand: ['Test Lance'], battlefield: ['Plains', 'Plains'] }, defs: [LANCE] });
    d = cast(d, 'Test Lance', { answers: [no] });
    expect(tokens(d, 'Soldier')).toHaveLength(0);
    expect(d.objects[find(d, 'Test Lance', 'battlefield', 'p1')]!.attachedTo ?? null).toBeNull();
  });
});

describe('CR 701.20e, 610.3: "Look at the top card of target opponent\'s library, then exile it face down. You may play that card for as long as it remains exiled."', () => {
  const THIEF = card('Test Thief', 'Artifact', '{T}: Look at the top card of target opponent\'s library, then exile it face down. You may play that card for as long as it remains exiled.');
  it('the card looked at is exiled face down, and its controller may cast it (no manual step; eff.e25.exile.faceDown, promoted to stable by r5-fxb after its matches were read, design 10.4)', () => {
    expect(JSON.stringify(THIEF.faces)).not.toContain('"op":"manual"');
    let s = scenario([], { p1: { battlefield: ['Test Thief'] }, p2: { library: ['Test Bear'] }, defs: [THIEF, BEAR] });
    s = activate(s, find(s, 'Test Thief', 'battlefield', 'p1'), { targets: [[player('p2')]] });
    const exiled = s.zones.exile.filter((id) => s.objects[id]!.defId === 'Test Bear');
    expect(exiled).toHaveLength(1);
    expect(s.objects[exiled[0]!]!.faceDown).toBe(true);
    s = drain(settle(act(s, { type: 'cast', player: 'p1', card: exiled[0]! })).s);
    const bears = onBattlefield(s, 'Test Bear');
    expect(bears).toHaveLength(1);
    expect(s.objects[bears[0]!]!.controller).toBe('p1');
  });
});

describe('CR 608.2c (eff.t34.thenIf, stable since this slice): "Create a 2/2 green Bear creature token. Then if you control three or more Bears, draw two cards."', () => {
  const DEN = card('Test Den', 'Sorcery', 'Create a 2/2 green Bear creature token. Then if you control three or more Bears, draw two cards.');
  it('is full; with two Bears already the new token makes three and you draw two; with none you draw nothing', () => {
    expect(full(DEN)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Den'], battlefield: ['Test Bear', 'Test Bear'] }, defs: [DEN, BEAR] });
    s = cast(s, 'Test Den');
    expect(tokens(s, 'Bear')).toHaveLength(1);
    expect(handSize(s)).toBe(2);
    let t = scenario([], { p1: { hand: ['Test Den'] }, defs: [DEN, BEAR] });
    t = cast(t, 'Test Den');
    expect(handSize(t)).toBe(0);
  });
});

describe('CR 608.2c, 608.2h: "Exile target card from a graveyard. If a creature card was exiled this way, create a Food token."', () => {
  const COOK = card('Test Cook', 'Instant', 'Exile target card from a graveyard. If a creature card was exiled this way, create a Food token.');
  it('is automated; a creature card exiled makes a Food, a land card does not', () => {
    expect(full(COOK)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Cook', 'Test Cook'] }, p2: { graveyard: ['Test Bear', 'Test Land'] }, defs: [COOK, BEAR, LAND] });
    const bear = find(s, 'Test Bear', 'graveyard', 'p2');
    const land = find(s, 'Test Land', 'graveyard', 'p2');
    s = cast(s, 'Test Cook', { targets: [[obj(land)]] });
    expect(tokens(s, 'Food')).toHaveLength(0);
    s = cast(s, 'Test Cook', { targets: [[obj(bear)]] });
    expect(tokens(s, 'Food')).toHaveLength(1);
  });
});

describe('CR 121.1, 603.10a: "Whenever a Bear you control dies, you draw cards equal to its toughness."', () => {
  const GRIEF = card('Test Grief', 'Enchantment', 'Whenever a Bear you control dies, you draw cards equal to its toughness.');
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
  it('is automated; a 2/2 Bear dying draws two cards (its toughness as it last existed)', () => {
    expect(full(GRIEF)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Kill'], battlefield: ['Test Grief', 'Test Bear'] }, defs: [GRIEF, KILL, BEAR] });
    s = cast(s, 'Test Kill', { targets: [[obj(find(s, 'Test Bear', 'battlefield', 'p1'))]] });
    expect(handSize(s)).toBe(2);
  });
});

describe('CR 122.1, 608.2h: "put a number of +1/+1 counters equal to this creature\'s toughness on up to one other target creature"', () => {
  const MENTOR = card('Test Mentor', 'Creature — Human', 'When this creature enters, put a number of +1/+1 counters equal to this creature\'s toughness on up to one other target creature.', ['1', '3']);
  it('is automated; the other creature gets three counters', () => {
    expect(full(MENTOR)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Mentor'], battlefield: ['Test Bear'] }, defs: [MENTOR, BEAR] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    // the trigger's target is chosen when it is put on the stack (CR 603.3d)
    s = cast(s, 'Test Mentor', { targets: [[obj(bear)]] });
    expect(counters(s, bear)).toBe(3);
  });
});

describe('CR 611.2c: "Create a 1/1 white Soldier creature token. Then creatures you control gain vigilance until end of turn."', () => {
  const MUSTER = card('Test Muster', 'Sorcery', 'Create a 1/1 white Soldier creature token. Then creatures you control gain vigilance until end of turn.');
  it('is automated; the new token and the Bear have vigilance this turn', () => {
    expect(full(MUSTER)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Muster'], battlefield: ['Test Bear'] }, defs: [MUSTER, BEAR] });
    s = cast(s, 'Test Muster');
    const ids = [find(s, 'Test Bear', 'battlefield', 'p1'), ...tokens(s, 'Soldier')];
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(getChars(s, id)!.keywords.some((k) => k.keyword === 'vigilance'), id).toBe(true);
  });
});

describe('CR 701.23a, 701.20a: "you may search your library for a Wizard or basic land card, reveal it, put it into your hand, then shuffle"', () => {
  const SEER = card('Test Seer', 'Creature — Human', 'When this creature enters, you may search your library for a Wizard or basic land card, reveal it, put it into your hand, then shuffle.', ['1', '1']);
  it('is automated; a basic land card found goes to the hand', () => {
    expect(full(SEER)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Seer'] }, defs: [SEER] });
    const plains = s.zones.library['p1']![0]!;
    s = cast(s, 'Test Seer', { answers: [yes], picks: [[plains]] });
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Plains']);
  });
});

describe('CR 701.20a: "Look at the top card of your library. If it\'s an Elf card, you may reveal it and put it into your hand."', () => {
  const WARDEN = card('Test Warden', 'Artifact', '{T}: Look at the top card of your library. If it\'s an Elf card, you may reveal it and put it into your hand.');
  const ELF = card('Test Elf', 'Creature — Elf', '', ['1', '1']);
  it('is automated; an Elf on top goes to the hand when you take it; a Bear stays on top', () => {
    expect(full(WARDEN)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Warden'], library: ['Test Elf'] }, defs: [WARDEN, ELF, BEAR] });
    s = activate(s, find(s, 'Test Warden', 'battlefield', 'p1'), { answers: [yes] });
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Elf']);
    let t = scenario([], { p1: { battlefield: ['Test Warden'], library: ['Test Bear'] }, defs: [WARDEN, ELF, BEAR] });
    t = activate(t, find(t, 'Test Warden', 'battlefield', 'p1'));
    expect(handSize(t)).toBe(0);
    expect(zoneNames(t, 'library', 'p1')[0]).toBe('Test Bear');
  });
});

describe('CR 118.12, 701.23a: "When this creature dies, you may exile it. If you do, search your library for an artifact card, put that card onto the battlefield, then shuffle."', () => {
  const TUTOR = card('Test Tutor', 'Creature — Human', 'When this creature dies, you may exile it. If you do, search your library for an artifact card, put that card onto the battlefield, then shuffle.', ['1', '1']);
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
  it('is automated; exiled, the artifact found enters the battlefield (the card found, never the creature exiled)', () => {
    expect(full(TUTOR)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Kill'], battlefield: ['Test Tutor'], library: ['Test Rock'] }, defs: [TUTOR, KILL, ROCK] });
    const rock = find(s, 'Test Rock', 'library', 'p1');
    s = cast(s, 'Test Kill', { targets: [[obj(find(s, 'Test Tutor', 'battlefield', 'p1'))]], answers: [yes], picks: [[rock]] });
    expect(onBattlefield(s, 'Test Rock')).toHaveLength(1);
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Tutor')).toBe(true);
  });
});

describe('CR 111.1, 701.3a: "Create a 1/1 white Kor Warrior creature token. You may attach an Equipment you control to it."', () => {
  const SMITH = card('Test Smith', 'Sorcery', 'Create a 1/1 white Kor Warrior creature token. You may attach an Equipment you control to it.');
  it('is automated; the chosen Equipment ends on the new token', () => {
    expect(full(SMITH)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Smith'], battlefield: ['Test Sword'] }, defs: [SMITH, SWORD] });
    const sword = find(s, 'Test Sword', 'battlefield', 'p1');
    s = cast(s, 'Test Smith', { answers: [yes], picks: [[sword]] });
    const [kor] = tokens(s, 'Kor Warrior');
    expect(kor).toBeDefined();
    expect(s.objects[sword]!.attachedTo).toBe(kor);
  });
});
