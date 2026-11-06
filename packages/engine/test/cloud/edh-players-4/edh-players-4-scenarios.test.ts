/**
 * edh-players-4 (Commander lane edh-players): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names,
 * wordings of the rules text, design 6.10). Each test is named after the rule it checks, with its negative case.
 *
 *   CR 701.21a, 608.2h             "Sacrifice another creature. You gain X life and draw X cards, where X is that creature's power": the sacrificed creature, as it last existed
 *   CR 701.26a-b, 608.2c           "Untap all attacking creatures. They gain first strike ...": every attacker, also one that was untapped already; nothing else
 *   CR 701.26b, 611.2a, 613.1b     "Untap all creatures and gain control of them until end of turn. They gain haste ...": every creature, back at the end of the turn
 *   CR 608.2d, 701.17a, 202.3      "Target opponent may have you draw N cards. If the player doesn't, you mill N cards, then ~ deals damage to that player equal to the total mana value of those cards"
 *   CR 608.2d, 107.3, 119.3        Palantir-style: the option, then a mill of X and a life loss by the total mana value, at the beginning of your end step
 *   CR 611.2a, 613.1e, 702.10a     "Target creature becomes red and gains haste until end of turn"
 *   CR 504.1, 121.1                "At the beginning of each player's draw step, that player draws two additional cards"
 *   CR 701.21a, 122.1              "Each opponent sacrifices a creature of their choice and gets a poison counter"
 *   CR 107.1, 119.3, 608.2c        "Each opponent loses two times X life. You gain life equal to the life lost this way"
 *   CR 702.3b, 609.4, 508.1a       "Target creature with defender can attack this turn as though it didn't have defender"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, battlefieldNames, find, findAll, life, pass, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';
import { mpScenario, lifeOf, namesOn, playerOf } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as unknown as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;
const PLAYER2 = { kind: 'player', id: 'p2' } as TargetChoice;
const chars = (s: GameState, id: ObjectId) => getChars(s, id);
const has = (s: GameState, id: ObjectId, keyword: string): boolean => chars(s, id).keywords.some((k) => k.keyword === keyword);
const handSize = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const poison = (s: GameState, p: PlayerId): number => playerOf(s, p).poison;

interface Script { yes?: boolean[]; targets?: TargetChoice[][]; x?: number }
/** Answer the decisions that come up (payment automatic; "may" from the script, default yes; the first allowed object); stops at the next priority decision. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { yes: [...(script.yes ?? [])], targets: [...(script.targets ?? [])] };
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: q.yes.shift() ?? true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: script.x ?? p.min });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
/** Everyone passes until the stack is empty again, answering what comes up. */
function resolve(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; s.zones.stack.length > 0 && guard < 40; guard++) s = drive(s.pending?.kind === 'priority' ? pass(s) : s, script);
  return s;
}
const cast = (s: GameState, name: string, player: PlayerId = 'p1', script?: Script): GameState => resolve(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script), script);

const BEAR = (name: string, power: number, toughness = 2) => card(name, 'Creature — Bear', '', { pt: [String(power), String(toughness)] });

describe('CR 701.21a, 608.2h: "Sacrifice another creature. You gain X life and draw X cards, where X is that creature\'s power."', () => {
  const DISCIPLE = card('Test Bargain Wizard', 'Creature — Human Wizard', "When this creature enters, sacrifice another creature. You gain X life and draw X cards, where X is that creature's power.", { pt: ['0', '1'] });
  const BIG = BEAR('Test Big Bear', 4, 4);
  const defs = [DISCIPLE, BIG, BEAR('Test Small Bear', 1)];
  it('is understood', () => expect(noManual(DISCIPLE)).toBe(true));
  it('gains and draws the sacrificed creature\'s power', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Bargain Wizard'], battlefield: ['Test Big Bear'] } });
    const l0 = life(s, 'p1');
    const h0 = handSize(s, 'p1');
    s = cast(s, 'Test Bargain Wizard');
    expect(battlefieldNames(s, 'p1')).toEqual(['Test Bargain Wizard']);
    expect(life(s, 'p1')).toBe(l0 + 4);
    expect(handSize(s, 'p1')).toBe(h0 - 1 + 4); // the wizard left the hand, four cards drawn
  });
  it('reads the power of the creature it sacrificed, not of the one it left (the other bear stays)', () => {
    // the first allowed object is sacrificed: p1's battlefield order puts the small bear first
    let s = scenario([], { defs, p1: { hand: ['Test Bargain Wizard'], battlefield: ['Test Small Bear', 'Test Big Bear'] } });
    const l0 = life(s, 'p1');
    s = cast(s, 'Test Bargain Wizard');
    const left = battlefieldNames(s, 'p1').filter((n) => n.startsWith('Test') && n !== 'Test Bargain Wizard');
    expect(left).toHaveLength(1);
    expect(life(s, 'p1')).toBe(l0 + (left[0] === 'Test Big Bear' ? 1 : 4));
  });
  it('with no other creature nothing is sacrificed and X is 0 (the wizard itself is not "another")', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Bargain Wizard'] } });
    const l0 = life(s, 'p1');
    const h0 = handSize(s, 'p1');
    s = cast(s, 'Test Bargain Wizard');
    expect(battlefieldNames(s, 'p1')).toEqual(['Test Bargain Wizard']);
    expect(life(s, 'p1')).toBe(l0);
    expect(handSize(s, 'p1')).toBe(h0 - 1);
  });
});

describe('CR 701.26a-b, 608.2c: "Untap all attacking creatures. They gain first strike until end of turn." (a trigger of "Whenever you attack")', () => {
  const LEADER = card('Test War Leader', 'Legendary Creature — Human', "Whenever you attack, untap all attacking creatures. They gain first strike until end of turn.", { pt: ['2', '2'] });
  const VIG = card('Test Vigilant Knight', 'Creature — Knight', 'Vigilance', { pt: ['2', '2'] });
  const defs = [LEADER, BEAR('Test Plain Bear', 2), VIG];
  it('is understood', () => expect(noManual(LEADER)).toBe(true));
  it('untaps every attacker, also one that was never tapped, and gives only the attackers first strike', () => {
    const s0 = advanceTo(scenario([], { defs, p1: { battlefield: ['Test War Leader', 'Test Plain Bear', 'Test Plain Bear', 'Test Vigilant Knight'] }, p2: { battlefield: ['Test Plain Bear'] } }), 3, 'main1');
    const bears = findAll(s0, 'Test Plain Bear', 'battlefield', 'p1');
    const knight = find(s0, 'Test Vigilant Knight', 'battlefield', 'p1');
    const leader = find(s0, 'Test War Leader', 'battlefield', 'p1');
    const theirs = find(s0, 'Test Plain Bear', 'battlefield', 'p2');
    let s = declareAttackers(toDeclareAttackers(s0), [[bears[0]!], [knight]]);
    s = resolve(s);
    for (const id of [bears[0]!, knight]) {
      expect(s.objects[id]!.tapped, `${id} untapped`).toBe(false);
      expect(has(s, id, 'first strike')).toBe(true);
    }
    // a creature that did not attack (tapped or not) and the opponent's creature get nothing
    for (const id of [bears[1]!, leader, theirs]) expect(has(s, id, 'first strike')).toBe(false);
  });
  it('the grant lasts until end of turn only', () => {
    const s0 = advanceTo(scenario([], { defs, p1: { battlefield: ['Test War Leader', 'Test Plain Bear'] } }), 3, 'main1');
    const bear = find(s0, 'Test Plain Bear', 'battlefield', 'p1');
    let s = resolve(declareAttackers(toDeclareAttackers(s0), [[bear]]));
    expect(has(s, bear, 'first strike')).toBe(true);
    s = advanceTo(s, 5, 'main1');
    expect(has(s, bear, 'first strike')).toBe(false);
  });
  it('"Tap all creatures ... They ..." names every creature the tap was about, also one that was tapped already (zones-status.ts#tap)', () => {
    const TAPPER = card('Test Frost Sweep', 'Sorcery', 'Tap all creatures your opponents control. They gain first strike until end of turn.');
    expect(noManual(TAPPER)).toBe(true);
    let s = scenario([], { defs: [TAPPER, BEAR('Test Plain Bear', 2)], p1: { hand: ['Test Frost Sweep'], battlefield: ['Test Plain Bear'] }, p2: { battlefield: [{ name: 'Test Plain Bear', tapped: true }, 'Test Plain Bear'] } });
    s = cast(s, 'Test Frost Sweep');
    for (const id of findAll(s, 'Test Plain Bear', 'battlefield', 'p2')) {
      expect(s.objects[id]!.tapped).toBe(true);
      expect(has(s, id, 'first strike')).toBe(true);
    }
    expect(has(s, find(s, 'Test Plain Bear', 'battlefield', 'p1'), 'first strike')).toBe(false);
  });
});

describe('CR 701.26b, 611.2a, 613.1b: "Untap all creatures and gain control of them until end of turn. They gain haste until end of turn."', () => {
  const RAID = card('Test Mass Mutiny', 'Sorcery', 'Untap all creatures and gain control of them until end of turn. They gain haste until end of turn.');
  const defs = [RAID, BEAR('Test Plain Bear', 2)];
  it('is understood', () => expect(noManual(RAID)).toBe(true));
  it('takes every creature of every player (tapped or not), untaps them and gives them haste', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Mass Mutiny'], battlefield: [{ name: 'Test Plain Bear', tapped: true }] }, p2: { battlefield: [{ name: 'Test Plain Bear', tapped: true }, 'Test Plain Bear'] } });
    s = cast(s, 'Test Mass Mutiny');
    const bears = findAll(s, 'Test Plain Bear', 'battlefield');
    expect(bears).toHaveLength(3);
    for (const id of bears) {
      expect(s.objects[id]!.controller).toBe('p1');
      expect(s.objects[id]!.tapped).toBe(false);
      expect(has(s, id, 'haste')).toBe(true);
    }
  });
  it('control and haste end with the turn: the opponent\'s creatures go back, my own stay mine', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Mass Mutiny'], battlefield: ['Test Plain Bear'] }, p2: { battlefield: ['Test Plain Bear'] } });
    s = cast(s, 'Test Mass Mutiny');
    s = advanceTo(s, 2, 'main1');
    const mine = findAll(s, 'Test Plain Bear', 'battlefield', 'p1');
    const theirs = findAll(s, 'Test Plain Bear', 'battlefield', 'p2');
    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(1);
    expect(has(s, mine[0]!, 'haste')).toBe(false);
  });
  it('a creature that enters after it resolves is not taken (the group is locked as it resolves, CR 611.2c)', () => {
    const LATE = card('Test Late Bear', 'Creature — Bear', '', { pt: ['1', '1'] });
    let s = scenario([], { defs: [...defs, LATE], p1: { hand: ['Test Mass Mutiny', 'Test Late Bear'] }, p2: { battlefield: ['Test Plain Bear'] } });
    s = cast(s, 'Test Mass Mutiny');
    s = cast(s, 'Test Late Bear', 'p1');
    expect(has(s, find(s, 'Test Late Bear', 'battlefield', 'p1'), 'haste')).toBe(false);
  });
});

describe('CR 608.2d, 701.17a, 202.3: "Target opponent may have you draw three cards. If the player doesn\'t, you mill three cards, then ~ deals damage to that player equal to the total mana value of those cards."', () => {
  const HULK = card('Test Gambit Golem', 'Artifact Creature — Golem', "First strike\nWhen this creature enters, target opponent may have you draw three cards. If the player doesn't, you mill three cards, then this creature deals damage to that player equal to the total mana value of those cards.", { pt: ['6', '6'] });
  const defs = [HULK, card('Test Four Drop', 'Creature — Bear', '', { cost: '{4}', pt: ['2', '2'] }), card('Test Two Drop', 'Creature — Bear', '', { cost: '{2}', pt: ['2', '2'] }), card('Test Free Rock', 'Artifact', '', { cost: '{0}' })];
  const start = (): GameState => scenario([], { defs, p1: { hand: ['Test Gambit Golem'], library: ['Test Four Drop', 'Test Two Drop', 'Test Free Rock', 'Test Four Drop'] } });
  it('is understood', () => expect(noManual(HULK)).toBe(true));
  it('the opponent lets you draw: you draw three and nothing is milled or damaged', () => {
    let s = start();
    const l2 = life(s, 'p2');
    const g0 = s.zones.graveyard.p1!.length;
    s = cast(s, 'Test Gambit Golem', 'p1', { yes: [true], targets: [[PLAYER2]] });
    expect(life(s, 'p2')).toBe(l2);
    expect(s.zones.graveyard.p1!.length).toBe(g0);
    expect(handSize(s, 'p1')).toBe(3);
  });
  it('the opponent declines: you mill three and they take damage equal to the total mana value of exactly those cards (4 + 2 + 0)', () => {
    let s = start();
    const l2 = life(s, 'p2');
    const h0 = handSize(s, 'p1');
    s = cast(s, 'Test Gambit Golem', 'p1', { yes: [false], targets: [[PLAYER2]] });
    expect(handSize(s, 'p1')).toBe(h0 - 1);
    expect(life(s, 'p2')).toBe(l2 - 6);
    expect(s.zones.graveyard.p1!.map((id) => s.defs[s.objects[id]!.defId]!.name)).toEqual(['Test Four Drop', 'Test Two Drop', 'Test Free Rock']);
  });
  it('the milled cards only: the fourth card of the library is not counted', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Gambit Golem'], library: ['Test Free Rock', 'Test Free Rock', 'Test Free Rock', 'Test Four Drop'] } });
    const l2 = life(s, 'p2');
    s = cast(s, 'Test Gambit Golem', 'p1', { yes: [false], targets: [[PLAYER2]] });
    expect(life(s, 'p2')).toBe(l2);
  });
});

describe('CR 608.2d, 107.3, 119.3: "At the beginning of your end step, put an influence counter ... Then target opponent may have you draw a card. If that player doesn\'t, you mill X cards, where X is the number of influence counters on ~, and that player loses life equal to the total mana value of those cards."', () => {
  const ORB = card('Test Seeing Orb', 'Legendary Artifact', "At the beginning of your end step, put an influence counter on this artifact and scry 2. Then target opponent may have you draw a card. If that player doesn't, you mill X cards, where X is the number of influence counters on this artifact, and that player loses life equal to the total mana value of those cards.");
  const defs = [ORB, card('Test Four Drop', 'Creature — Bear', '', { cost: '{4}', pt: ['2', '2'] }), card('Test Two Drop', 'Creature — Bear', '', { cost: '{2}', pt: ['2', '2'] })];
  const run = (yes: boolean, counters = 0): GameState => {
    let s = scenario([], { defs, p1: { battlefield: [{ name: 'Test Seeing Orb', counters: counters > 0 ? { influence: counters } : {} }], library: ['Test Four Drop', 'Test Two Drop', 'Test Four Drop', 'Test Two Drop'] } });
    s = advanceTo(s, 1, 'end');
    return resolve(s, { yes: [yes], targets: [[{ kind: 'player', id: 'p2' } as TargetChoice]] });
  };
  it('is understood', () => expect(noManual(ORB)).toBe(true));
  it('declined with one counter after the new one is put on (X = 1 on the first turn): one card milled, its mana value lost by the target opponent (not by you)', () => {
    const s = run(false);
    expect(life(s, 'p1')).toBe(20);
    expect(life(s, 'p2')).toBe(20 - 4);
    expect(s.zones.graveyard.p1!.length).toBe(1);
  });
  it('declined with a counter already there (X = 2): two cards milled, 4 + 2 life lost', () => {
    const s = run(false, 1);
    expect(s.zones.graveyard.p1!.length).toBe(2);
    expect(life(s, 'p2')).toBe(20 - 6);
  });
  it('accepted: you draw a card and nothing is milled', () => {
    const s = run(true);
    expect(s.zones.graveyard.p1!.length).toBe(0);
    expect(life(s, 'p2')).toBe(20);
  });
});

describe('CR 611.2a, 613.1e, 702.10a: "Target creature becomes red and gains haste until end of turn."', () => {
  const WISPS = card('Test Ember Wisps', 'Instant', 'Target creature becomes red and gains haste until end of turn. Draw a card.', { colors: ['R'] });
  const defs = [WISPS, card('Test Green Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['G'] })];
  it('is understood', () => expect(noManual(WISPS)).toBe(true));
  it('the target is red only (its green is replaced) and has haste; you draw; it all ends at end of turn', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Ember Wisps'] }, p2: { battlefield: ['Test Green Bear'] } });
    const bear = find(s, 'Test Green Bear', 'battlefield', 'p2');
    const h0 = handSize(s, 'p1');
    s = cast(s, 'Test Ember Wisps', 'p1', { targets: [[obj(bear)]] });
    expect(chars(s, bear).colors).toEqual(['R']);
    expect(has(s, bear, 'haste')).toBe(true);
    expect(handSize(s, 'p1')).toBe(h0); // spent one, drew one
    s = advanceTo(s, 2, 'main1');
    expect(chars(s, bear).colors).toEqual(['G']);
    expect(has(s, bear, 'haste')).toBe(false);
  });
});

describe('CR 504.1, 121.1: "At the beginning of each player\'s draw step, that player draws two additional cards."', () => {
  const FONT = card('Test Spring of Ideas', 'Enchantment', "At the beginning of each player's draw step, that player draws two additional cards.");
  it('is understood', () => expect(noManual(FONT)).toBe(true));
  it('each player draws three cards in their own draw step (one for the turn, two more), and one drawing step of the other player does not draw for me', () => {
    let s = scenario([], { defs: [FONT], p1: { battlefield: ['Test Spring of Ideas'] } });
    const h1 = handSize(s, 'p1');
    const h2 = handSize(s, 'p2');
    s = advanceTo(s, 2, 'main1');
    expect(handSize(s, 'p2')).toBe(h2 + 3);
    expect(handSize(s, 'p1')).toBe(h1);
    s = advanceTo(s, 3, 'main1');
    expect(handSize(s, 'p1')).toBe(h1 + 3);
    expect(handSize(s, 'p2')).toBe(h2 + 3);
  });
  it('without it a draw step draws one card (the negative case)', () => {
    let s = scenario([], { defs: [FONT] });
    const h2 = handSize(s, 'p2');
    s = advanceTo(s, 2, 'main1');
    expect(handSize(s, 'p2')).toBe(h2 + 1);
  });
});

describe('CR 701.21a, 122.1: "Each opponent sacrifices a creature of their choice and gets a poison counter."', () => {
  const FALL = card('Test Cruel Fall', 'Sorcery', 'Each opponent sacrifices a creature or planeswalker of their choice and gets a poison counter.');
  const defs = [FALL, BEAR('Test Plain Bear', 2)];
  it('is understood', () => expect(noManual(FALL)).toBe(true));
  it('every opponent sacrifices one creature and gets one poison counter; I get none', () => {
    let s = mpScenario({ players: 3, defs, zones: { p1: { hand: ['Test Cruel Fall'], battlefield: ['Test Plain Bear'] }, p2: { battlefield: ['Test Plain Bear', 'Test Plain Bear'] }, p3: { battlefield: ['Test Plain Bear'] } } });
    s = cast(s, 'Test Cruel Fall');
    expect(namesOn(s, 'p2')).toEqual(['Test Plain Bear']);
    expect(namesOn(s, 'p3')).toEqual([]);
    expect(namesOn(s, 'p1')).toEqual(['Test Plain Bear']);
    expect([poison(s, 'p1'), poison(s, 'p2'), poison(s, 'p3')]).toEqual([0, 1, 1]);
  });
  it('an opponent with nothing to sacrifice still gets the poison counter (two instructions, CR 608.2c)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Cruel Fall'] } });
    s = cast(s, 'Test Cruel Fall');
    expect(poison(s, 'p2')).toBe(1);
  });
});

describe('CR 107.1, 119.3, 608.2c: "Each opponent loses two times X life. You gain life equal to the life lost this way."', () => {
  const DEBT = card('Test Grim Ledger', 'Sorcery', 'Each opponent loses two times X life. You gain life equal to the life lost this way.', { cost: '{X}{B}' });
  it('is understood', () => expect(noManual(DEBT)).toBe(true));
  it('in a four-player game each of three opponents loses 2X and I gain the total', () => {
    let s = mpScenario({ players: 4, defs: [DEBT], cards: ['Swamp'], zones: { p1: { hand: ['Test Grim Ledger'], battlefield: ['Swamp', 'Swamp', 'Swamp', 'Swamp', 'Swamp'] } } });
    const l = [lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')];
    s = cast(s, 'Test Grim Ledger', 'p1', { x: 2 });
    expect([lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([l[1]! - 4, l[2]! - 4, l[3]! - 4]);
    expect(lifeOf(s, 'p1')).toBe(l[0]! + 12);
  });
});

describe('CR 702.3b, 609.4, 508.1a: "Target creature with defender can attack this turn as though it didn\'t have defender."', () => {
  const FORM = card('Test Siege Drill', 'Enchantment', '{0}: Target creature with defender can attack this turn as though it didn\'t have defender.');
  const WALL = card('Test Stone Wall', 'Creature — Wall', 'Defender', { pt: ['0', '4'] });
  const defs = [FORM, WALL, BEAR('Test Plain Bear', 2)];
  it('is understood', () => expect(noManual(FORM)).toBe(true));
  it('the wall is allowed to attack after the ability resolves, not before, and only that wall', () => {
    let s0 = advanceTo(scenario([], { defs, p1: { battlefield: ['Test Siege Drill', 'Test Stone Wall', 'Test Stone Wall'] } }), 3, 'main1');
    const [wall, other] = findAll(s0, 'Test Stone Wall', 'battlefield', 'p1');
    s0 = resolve(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Siege Drill', 'battlefield', 'p1'), ability: 'p:0:0' }), { targets: [[obj(wall!)]] });
    const s = toDeclareAttackers(s0);
    expect(s.pending?.kind).toBe('declareAttackers');
    const can = (s.pending as unknown as { candidates: { id: ObjectId }[] }).candidates.map((c) => c.id);
    expect(can).toEqual([wall]);
    expect(can).not.toContain(other);
    // the permission ends with the turn
    const next = advanceTo(s, 5, 'main1');
    expect(next.turn.activePlayer).toBe('p1');
    expect(() => toDeclareAttackers(next)).toThrow(/declare attackers/); // no creature can attack on the next turn: no declaration is asked
  });
});

describe('CR 609.4, 702.3b: the permission is for the target whoever controls it', () => {
  it('p1 targets p2\'s wall during p2\'s turn and p2 may declare it as an attacker (an opponent\'s creature is a legal target)', () => {
    const FORM = card('Test Siege Drill', 'Enchantment', '{0}: Target creature with defender can attack this turn as though it didn\'t have defender.');
    const WALL = card('Test Stone Wall', 'Creature — Wall', 'Defender', { pt: ['0', '4'] });
    let s = advanceTo(scenario([], { defs: [FORM, WALL, BEAR('Test Plain Bear', 2)], p1: { battlefield: ['Test Siege Drill'] }, p2: { battlefield: ['Test Stone Wall', 'Test Plain Bear'] } }), 2, 'main1');
    const wall = find(s, 'Test Stone Wall', 'battlefield', 'p2');
    if (s.pending?.player === 'p2') s = pass(s);
    s = resolve(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Siege Drill', 'battlefield', 'p1'), ability: 'p:0:0' }), { targets: [[obj(wall)]] });
    s = toDeclareAttackers(s);
    expect((s.pending as unknown as { candidates: { id: ObjectId }[] }).candidates.map((c) => c.id)).toContain(wall);
  });
});

describe('CR 603.4, 120.3, 107.1b: "that player" in "At the beginning of your upkeep, ..." is the player the ability targets, never the active player (you)', () => {
  const BULWARK = card('Test Hand Wall', 'Enchantment', 'At the beginning of your upkeep, this enchantment deals X damage to target opponent, where X is the number of cards in your hand minus the number of cards in that player\'s hand.');
  const SANCTUARY = card('Test Twin Grove', 'Enchantment', 'At the beginning of your upkeep, if you control a green or white permanent, target player loses 1 life. If you control a green permanent and a white permanent, that player loses 3 life instead.');
  const GREEN = card('Test Green Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['G'] });
  const WHITE = card('Test White Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['W'] });
  const upkeep = (s: GameState, script: Script): GameState => resolve(advanceTo(s, 3, 'upkeep'), script);
  it('are understood', () => { expect(noManual(BULWARK)).toBe(true); expect(noManual(SANCTUARY)).toBe(true); });
  it('Bulwark: X is my hand minus that player\'s hand (the target\'s, not mine), and a negative X is no damage (CR 107.1b)', () => {
    const plains = (n: number) => Array(n).fill('Plains') as string[];
    let s = scenario([], { defs: [BULWARK], p1: { battlefield: ['Test Hand Wall'], hand: plains(5) }, p2: { hand: plains(2) } });
    const l2 = life(s, 'p2');
    s = upkeep(s, { targets: [[{ kind: 'player', id: 'p2' } as TargetChoice]] });
    // (my upkeep of turn 3: the hand is two cards bigger after the draw of turn 1? the starting player skips it; turn 3 draws one: 6 against 3 in theirs after their turn-2 draw)
    expect(life(s, 'p2')).toBe(l2 - (handSize(s, 'p1') - handSize(s, 'p2')));
    let t = scenario([], { defs: [BULWARK], p1: { battlefield: ['Test Hand Wall'], hand: plains(0) }, p2: { hand: plains(6) } });
    const m2 = life(t, 'p2');
    const m1 = life(t, 'p1');
    t = upkeep(t, { targets: [[{ kind: 'player', id: 'p2' } as TargetChoice]] });
    expect(life(t, 'p2')).toBe(m2);
    expect(life(t, 'p1')).toBe(m1);
  });
  it('Necra Sanctuary: the target loses 1 life with one of the colors and 3 with both; I lose nothing; with neither it does not trigger', () => {
    const one = scenario([], { defs: [SANCTUARY, GREEN, WHITE], p1: { battlefield: ['Test Twin Grove', 'Test Green Bear'] } });
    const l = [life(one, 'p1'), life(one, 'p2')];
    const a = upkeep(one, { targets: [[{ kind: 'player', id: 'p2' } as TargetChoice]] });
    expect([life(a, 'p1'), life(a, 'p2')]).toEqual([l[0], l[1]! - 1]);
    const both = scenario([], { defs: [SANCTUARY, GREEN, WHITE], p1: { battlefield: ['Test Twin Grove', 'Test Green Bear', 'Test White Bear'] } });
    const b = upkeep(both, { targets: [[{ kind: 'player', id: 'p2' } as TargetChoice]] });
    expect([life(b, 'p1'), life(b, 'p2')]).toEqual([l[0], l[1]! - 3]);
    const none = scenario([], { defs: [SANCTUARY] , p1: { battlefield: ['Test Twin Grove'] } });
    const c = upkeep(none, {});
    expect([life(c, 'p1'), life(c, 'p2')]).toEqual([l[0], l[1]]);
  });
});
