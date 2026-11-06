/**
 * edh-players-19 (Commander lane edh-players): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names and
 * wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. CR cites were checked against the Comprehensive Rules text of
 * 2026-09-25 (media.wizards.com).
 *
 *   CR 114.2, 114.4, 121.2           "Target opponent gets an emblem with ...": the emblem is the opponent's (its "you" is that opponent), in the command zone, and works
 *   CR 603.7c, 510.2, 603.2c         "Choose up to two target creatures. Until your next turn, whenever either of those creatures deals combat damage, you draw a card.": once for each of them
 *   CR 119.3, 120.3a, 603.4, 608.2h  "... if that player lost less than 8 life this turn, they lose life equal to the difference.": the damage just dealt counts
 *   CR 700.2, 603.3c, 115.3          "you may choose two. Each mode must target a different player.": none or exactly two, never one, with different players
 *   CR 122.1, 122.6, 608.2c          "Target player puts a +1/+1 counter on each creature they control.": that player's creatures, and that player puts them
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find, reject } from '../../m3/scenario';
import { mpScenario, passUntil } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const handSize = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const player = (id: PlayerId): TargetChoice => ({ kind: 'player', id }) as TargetChoice;
const object = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;

interface Script { targets?: TargetChoice[][]; yes?: boolean[]; options?: string[][] }
/** Answer the decisions that come up until someone has priority. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: script.options?.shift() ?? [] } as DecisionAnswer);
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
function settle(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), script);
  return s;
}
const cast = (s: GameState, name: string, script: Script = {}, who: PlayerId = 'p1'): GameState => settle(drive(act(s, { type: 'cast', player: who, card: find(s, name, 'hand', who) }), script), script);

// ---- "Target opponent gets an emblem with ..." --------------------------------------------------------------------------------------------------------------------------

const CURSE = card('Test Curse', 'Sorcery', 'Target opponent gets an emblem with "Whenever a player draws a card, you lose 2 life."');
const STUDY = card('Test Study', 'Sorcery', 'Target player draws a card.');

describe('CR 114.2, 114.4: "Target opponent gets an emblem with ..."', () => {
  const setup = (): GameState => mpScenario({ defs: [CURSE, STUDY], zones: { p1: { hand: ['Test Curse', 'Test Study'] }, p3: { hand: ['Test Study'] } } });
  it('is automated', () => expect(full(CURSE)).toBe(true));
  it('the emblem belongs to the targeted opponent (its "you"), so that opponent loses life whenever any player draws, and nobody else does', () => {
    let s = cast(setup(), 'Test Curse', { targets: [[player('p2')]] });
    const emblems = Object.values(s.objects).filter((o) => o.kind === 'emblem');
    expect(emblems.length).toBe(1);
    expect(emblems[0]!.controller).toBe('p2');
    expect(emblems[0]!.owner).toBe('p2');
    s = cast(s, 'Test Study', { targets: [[player('p1')]] }); // p1 draws: p2 loses 2
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([20, 18, 20, 20]);
  });
  it('a draw by a third player also costs the emblem\'s owner (any player), and a draw before the emblem existed cost nobody (the negative cases)', () => {
    const before = cast(setup(), 'Test Study', { targets: [[player('p3')]] });
    expect([lifeOf(before, 'p1'), lifeOf(before, 'p2'), lifeOf(before, 'p3')]).toEqual([20, 20, 20]);
    let s = cast(setup(), 'Test Curse', { targets: [[player('p2')]] });
    s = cast(s, 'Test Study', { targets: [[player('p3')]] });
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([20, 18, 20, 20]);
    expect(handSize(s, 'p3')).toBe(2);
  });
});

// ---- combat helpers ----------------------------------------------------------------------------------------------------------------------------------------------------

/** From the first main phase: pass priority until p1 declares attackers, declare these against `defender`, then pass through combat damage to the second main phase. */
function attack(s0: GameState, ids: ObjectId[], defender: PlayerId = 'p2', script: Script = {}): GameState {
  let s = s0;
  for (let i = 0; i < 80 && s.pending?.kind !== 'declareAttackers'; i++) {
    s = s.pending?.kind === 'priority' ? act(s, { type: 'pass', player: s.pending.player }) : drive(s, script);
    if (s.result) throw new Error('game over');
  }
  if (s.pending?.kind !== 'declareAttackers') throw new Error('no declareAttackers decision');
  s = answer(s, { kind: 'declareAttackers', attacks: ids.map((attacker) => ({ attacker, defender })) });
  for (let i = 0; i < 80 && s.turn.step !== 'main2' && !s.result; i++) {
    if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player });
    else s = drive(s, script);
  }
  return s;
}

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['3', '3'] });
const WURM = card('Test Wurm', 'Creature — Wurm', '', { pt: ['10', '10'] });

// ---- "Choose up to two target creatures. Until your next turn, whenever either of those creatures deals combat damage, you draw a card." ---------------------------------------------

const WATCH = card('Test Watch', 'Sorcery', 'Choose up to two target creatures. Until your next turn, whenever either of those creatures deals combat damage, you draw a card.');

describe('CR 603.7c, 510.2, 603.2c: "Until your next turn, whenever either of those creatures deals combat damage, you draw a card."', () => {
  const setup = (): GameState => mpScenario({ defs: [WATCH, BEAR, OGRE], zones: { p1: { hand: ['Test Watch'], battlefield: ['Test Bear', 'Test Ogre', 'Test Bear'] } } });
  it('is automated', () => expect(full(WATCH)).toBe(true));
  it('each chosen creature that deals combat damage draws a card (two chosen, two cards); a creature that was not chosen draws nothing', () => {
    const s0 = setup();
    const [b1, ogre, b2] = [...s0.zones.battlefield].filter((id) => s0.objects[id]!.controller === 'p1');
    const names = [b1, ogre, b2].map((id) => s0.defs[s0.objects[id!]!.defId]!.name);
    expect(names).toEqual(['Test Bear', 'Test Ogre', 'Test Bear']);
    let s = cast(s0, 'Test Watch', { targets: [[object(b1!), object(ogre!)]] });
    const hand = handSize(s, 'p1');
    s = attack(s, [b1!, ogre!, b2!]);
    expect(handSize(s, 'p1')).toBe(hand + 2);
    expect(lifeOf(s, 'p2')).toBe(20 - 2 - 3 - 2);
  });
  it('a chosen creature that does not deal damage (it stays home) draws nothing, and no creature chosen means no trigger (the negative cases)', () => {
    const s0 = setup();
    const [b1, ogre, b2] = [...s0.zones.battlefield].filter((id) => s0.objects[id]!.controller === 'p1');
    let s = cast(s0, 'Test Watch', { targets: [[object(b1!), object(ogre!)]] });
    const hand = handSize(s, 'p1');
    s = attack(s, [b2!]);
    expect(handSize(s, 'p1')).toBe(hand);
    const t = cast(setup(), 'Test Watch', { targets: [[]] });
    const h2 = handSize(t, 'p1');
    const u = attack(t, [[...t.zones.battlefield].filter((id) => t.objects[id]!.controller === 'p1')[0]!]);
    expect(handSize(u, 'p1')).toBe(h2);
  });
});

describe('CR 611.2a, 603.7c: the delayed trigger lasts until your next turn begins', () => {
  it('on the turn it was set up it fires, and from the start of the controller\'s next turn it is gone (the negative case)', () => {
    const s0 = mpScenario({ defs: [WATCH, BEAR], zones: { p1: { hand: ['Test Watch'], battlefield: ['Test Bear'] } } });
    const bear = [...s0.zones.battlefield].find((id) => s0.objects[id]!.controller === 'p1')!;
    let s = cast(s0, 'Test Watch', { targets: [[object(bear)]] });
    s = passUntil(s, (x) => x.turn.number >= 5 && x.turn.step === 'main1' && x.turn.activePlayer === 'p1', 'p1 next turn', 600);
    const hand = handSize(s, 'p1');
    s = attack(s, [bear]);
    expect(handSize(s, 'p1')).toBe(hand);
    expect(lifeOf(s, 'p2')).toBeLessThan(20);
  });
});

// ---- Lolth's emblem -----------------------------------------------------------------------------------------------------------------------------------------------------

const OATH = card('Test Oath', 'Sorcery', 'You get an emblem with "Whenever an opponent is dealt combat damage by one or more creatures you control, if that player lost less than 8 life this turn, they lose life equal to the difference."');

describe('CR 119.3, 120.3a, 603.4, 608.2h: "if that player lost less than 8 life this turn, they lose life equal to the difference."', () => {
  const setup = (): GameState => mpScenario({ defs: [OATH, BEAR, OGRE, WURM], zones: { p1: { hand: ['Test Oath'], battlefield: ['Test Bear', 'Test Ogre'] }, p2: { battlefield: [] } } });
  it('is automated', () => expect(full(OATH)).toBe(true));
  it('damage that leaves the player under 8 life lost this turn costs the difference: 5 combat damage, then 3 more life lost, for 8 in total', () => {
    const s0 = cast(setup(), 'Test Oath');
    const mine = [...s0.zones.battlefield].filter((id) => s0.objects[id]!.controller === 'p1');
    const s = attack(s0, mine); // 2 + 3 = 5 combat damage at once; the trigger sees 5 lost: 3 more
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([20, 12, 20, 20]);
  });
  it('a player who lost 8 or more life this turn is not touched again, and nobody else is (the negative cases)', () => {
    const s1 = mpScenario({ defs: [OATH, WURM], zones: { p1: { hand: ['Test Oath'], battlefield: ['Test Wurm'] } } });
    const s0 = cast(s1, 'Test Oath');
    const s = attack(s0, [...s0.zones.battlefield].filter((id) => s0.objects[id]!.controller === 'p1'));
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([20, 10, 20, 20]); // 10 damage, 10 lost: no difference
    const t = cast(setup(), 'Test Oath');
    const u = attack(t, [...t.zones.battlefield].filter((id) => t.objects[id]!.controller === 'p1').slice(0, 1), 'p3');
    expect(lifeOf(u, 'p3')).toBe(20 - 2 - 6); // only the damaged player: 2 damage, 6 more
    expect(lifeOf(u, 'p2')).toBe(20);
  });
});

// ---- "At the beginning of combat on your turn, you may choose two. Each mode must target a different player." -----------------------------------------------------------------

const DRAGON = card('Test Dragon', 'Creature — Dragon', 'At the beginning of combat on your turn, you may choose two. Each mode must target a different player.\n• Target player draws a card.\n• Target player gains 2 life.\n• Target player puts a +1/+1 counter on each creature they control.', { pt: ['4', '4'] });

/** Pass priority until the modal trigger asks for its modes. */
function toModes(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 60 && !(s.pending?.kind === 'chooseOption'); i++) {
    if (s.pending?.kind !== 'priority') throw new Error(`unexpected ${s.pending?.kind}`);
    s = act(s, { type: 'pass', player: s.pending.player });
  }
  if (s.pending?.kind !== 'chooseOption') throw new Error('no mode choice');
  return s;
}
const counters = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['+1/+1'] ?? 0;

describe('CR 700.2, 603.3c, 115.3: "you may choose two. Each mode must target a different player."', () => {
  const setup = (): GameState => mpScenario({ defs: [DRAGON, BEAR, OGRE], zones: { p1: { battlefield: ['Test Dragon', 'Test Bear'] }, p2: { battlefield: ['Test Ogre', 'Test Ogre'] } } });
  it('is automated', () => expect(full(DRAGON)).toBe(true));
  it('zero modes or exactly two are legal; exactly one is refused and the decision stays open', () => {
    const s = toModes(setup());
    const d = s.pending;
    if (d?.kind !== 'chooseOption') throw new Error('no mode choice');
    expect(d.options.length).toBe(3);
    const err = reject(s, { type: 'answer', player: 'p1', decisionId: d.id, answer: { kind: 'chooseOption', ids: [d.options[0]!.id] } as DecisionAnswer });
    expect(err.rules.join(' ')).toMatch(/700\.2/);
    const none = answer(s, { kind: 'chooseOption', ids: [] } as DecisionAnswer);
    expect(none.pending?.kind).toBe('priority');
    expect(none.zones.stack.length).toBe(0);
  });
  it('two modes with two different players: the first draws, the third puts counters on THAT player\'s creatures only and that player is the one who puts them', () => {
    let s = toModes(setup());
    const d = s.pending!;
    if (d.kind !== 'chooseOption') throw new Error('no mode choice');
    const h2 = handSize(s, 'p2');
    s = answer(s, { kind: 'chooseOption', ids: [d.options[0]!.id, d.options[2]!.id] } as DecisionAnswer);
    expect(s.pending?.kind).toBe('chooseTargets'); // one target for each chosen mode, announced in turn
    s = answer(s, { kind: 'chooseTargets', targets: [player('p2')] });
    const second = s.pending;
    if (second?.kind !== 'chooseTargets') throw new Error('no second target decision');
    const err = reject(s, { type: 'answer', player: 'p1', decisionId: second.id, answer: { kind: 'chooseTargets', targets: [player('p2')] } }); // the same player twice is refused
    expect(err.rules.join(' ')).toMatch(/115\.3|700\.2|601\.2c/);
    s = answer(s, { kind: 'chooseTargets', targets: [player('p1')] });
    s = settle(s);
    expect(handSize(s, 'p2')).toBe(h2 + 1);
    const mine = [...s.zones.battlefield].filter((id) => s.objects[id]!.controller === 'p1').map((id) => counters(s, id));
    const theirs = [...s.zones.battlefield].filter((id) => s.objects[id]!.controller === 'p2').map((id) => counters(s, id));
    expect(mine).toEqual([1, 1]); // the dragon and the bear of p1 (the mode targeted p1)
    expect(theirs).toEqual([0, 0]);
  });
  it('the player who is told to put the counters is the one who puts them: "whenever you put counters" triggers for that player, not for the controller of the dragon (CR 122.6)', () => {
    const WARDEN = card('Test Warden', 'Enchantment', 'Whenever you put one or more +1/+1 counters on a creature, you gain 1 life.');
    let s = toModes(mpScenario({ defs: [DRAGON, BEAR, WARDEN], zones: { p1: { battlefield: ['Test Dragon', 'Test Warden'] }, p2: { battlefield: ['Test Bear', 'Test Warden'] } } }));
    const d = s.pending!;
    if (d.kind !== 'chooseOption') throw new Error('no mode choice');
    s = answer(s, { kind: 'chooseOption', ids: [d.options[0]!.id, d.options[2]!.id] } as DecisionAnswer);
    s = answer(s, { kind: 'chooseTargets', targets: [player('p3')] });
    s = answer(s, { kind: 'chooseTargets', targets: [player('p2')] });
    s = settle(s);
    expect(lifeOf(s, 'p2')).toBe(21);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
});
