/**
 * FAST5 T50 (T-THISTURN): the turn-scoped delayed triggers of parser/templates/zz-fast5/t50.json ("Until end of turn, whenever ...", "Whenever ... this turn",
 * "When it dies this turn", "Exile those tokens when ~ leaves the battlefield") and the engine support they need (`delay.batch`; the delayed trigger's own
 * event for the pronouns of its instructions), played through applyAction with synthetic cards compiled by the game's default compiler (wordings are
 * invented, design 6.10).
 *
 *   CR 603.7, 603.7b   a delayed triggered ability with a stated duration triggers every time until the duration ends; without one, once
 *   CR 603.7c          what it refers to is fixed as it is created: a target stays that object; "it" in its instructions is the object of ITS event
 *   CR 603.10a         "dies under your control": judged by who controlled the object as it died (last known information)
 *   CR 603.2c          "whenever you attack" and "one or more ..." are ONE trigger for all the events of one batch
 *   CR 511.1, 514.2    "until end of turn" ends at the cleanup step: the next turn's events trigger nothing
 *   CR 603.7a          a delayed trigger cannot trigger from an event before it was created
 */
import { describe, expect, it } from 'vitest';
import { compileCard, charsOfObject, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, pass, pool, scenario } from '../../m3/scenario';
import { declareAttackers, runCombat, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: cost, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard as never);
}
/** The abilities of a card that are manual or hold a manual step. */
const manualParts = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' || JSON.stringify(a).includes('"op":"manual"')).map((a) => a.text);
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;
const handSize = (s: GameState, p: string): number => s.zones.hand[p]!.length;
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const clues = (s: GameState, p: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.defs[s.objects[id]!.defId]!.name === 'Clue Token').length;
const pt = (s: GameState, id: ObjectId): string => { const c = charsOfObject(s, s.objects[id]!); return `${c.power}/${c.toughness}`; };

/** Answer the decisions that come up: costs automatically, each target choice from the queue in order, yes/no with `yes`; stop at priority. */
function settle(s0: GameState, targets: TargetChoice[][] = [], yes = true): GameState {
  let s = s0;
  const queue = [...targets];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 30; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: queue.shift() ?? [] });
    else if (s.pending.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else if (s.pending.kind === 'order') s = answer(s, { kind: 'order', ids: s.pending.items.map((i) => i.id) });
    else break;
  }
  return s;
}
/** Both players pass until the stack is empty; triggers put on the stack on the way choose from the queue. */
function resolveAll(s0: GameState, targets: TargetChoice[][] = [], yes = true): GameState {
  let s = settle(s0, targets, yes);
  const queue = [...targets];
  for (let guard = 0; guard < 40; guard++) {
    if (s.zones.stack.length === 0 && s.pending?.kind === 'priority') return s;
    s = settle(s.pending?.kind === 'priority' ? pass(s) : s, queue, yes);
  }
  throw new Error(`the stack did not empty: ${JSON.stringify(s.pending)} ${s.zones.stack.length} ${s.log.slice(-4).map((l) => l.text).join(' / ')}`);
}
/** Cast the first card of that name from p1's hand (targets in order) and let everything resolve. */
const castFirst = (s0: GameState, name: string, targets: TargetChoice[][] = [], yes = true): GameState =>
  resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), targets.slice(0, 1), yes), targets.slice(1), yes);

const BEAR = 'Grizzly Bears';
const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
const delays = (s: GameState): number => s.delayedTriggers.length;

/** Go to the declare attackers step, attack with `ids`, no blocks, through combat damage and every trigger on the way (several triggers: any order); stops at the end of combat. */
function attack(s0: GameState, ids: ObjectId[]): GameState {
  let s = declareAttackers(toDeclareAttackers(s0), ids.map((i) => [i] as [ObjectId]));
  for (let i = 0; i < 120; i++) {
    const d = s.pending;
    if (!d || s.result) throw new Error('the game ended in combat');
    if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((x) => x.id) });
    else if (d.kind === 'payCost' || d.kind === 'chooseTargets' || d.kind === 'yesNo') s = settle(s);
    else if (d.kind === 'priority') {
      if (s.turn.step === 'endCombat' && s.zones.stack.length === 0) return s;
      s = pass(s);
    } else throw new Error(`Unexpected ${d.kind} decision: ${d.prompt}`);
  }
  throw new Error('combat did not finish');
}
/** Pass priority (answering the decisions that come up with the defaults) until the turn number is `n` and a player has priority. */
function toTurn(s0: GameState, n: number): GameState {
  let s = s0;
  for (let i = 0; i < 200; i++) {
    const d = s.pending;
    if (!d || s.result) throw new Error('the game ended');
    if (s.turn.number >= n && d.kind === 'priority') return s;
    if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((x) => x.id) });
    else if (d.kind === 'priority') s = pass(s);
    else s = settle(s);
  }
  throw new Error(`never reached turn ${n}`);
}

describe('CR 603.7b, 603.7c, 514.2: "Until end of turn, whenever a creature you control deals combat damage to a player, investigate."', () => {
  const RUSH = card('Test Probe', 'Instant', 'Until end of turn, whenever a creature you control deals combat damage to a player, investigate.');
  it('is automated (no manual part)', () => expect(manualParts(RUSH)).toEqual([]));
  it('triggers once for each creature that deals combat damage, not for the opponent\'s creatures, and the delayed trigger is gone after the turn', () => {
    const s0 = scenario([BEAR], { p1: { hand: ['Test Probe'], battlefield: [BEAR, BEAR] }, p2: { battlefield: [BEAR] }, defs: [RUSH] });
    let s = castFirst(s0, 'Test Probe');
    expect(delays(s)).toBe(1);
    expect(s.delayedTriggers[0]!.duration).toEqual({ d: 'endOfTurn' });
    const mine = findAll(s, BEAR, 'battlefield', 'p1');
    s = attack(s, mine);
    expect(clues(s, 'p1')).toBe(2);
    expect(delays(s)).toBe(1); // it keeps waiting until the end of the turn (CR 603.7b)
    s = toTurn(s, 2);
    expect(delays(s)).toBe(0);
    expect(clues(s, 'p1')).toBe(2);
  });
  it('CR 603.7a: damage dealt BEFORE the delayed trigger was created triggers nothing (an attack, then the spell after combat damage)', () => {
    const s0 = scenario([BEAR], { p1: { hand: ['Test Probe'], battlefield: [BEAR] }, defs: [RUSH] });
    const bears = find(s0, BEAR, 'battlefield', 'p1');
    let s = runCombat(s0, { attack: [[bears]], until: 'endCombat' });
    s = castFirst(s, 'Test Probe');
    expect(clues(s, 'p1')).toBe(0);
  });
});

describe('CR 603.7c: an ability\'s "Until end of turn, whenever ~ deals combat damage to a player, draw two cards."', () => {
  const GEM = card('Test Gem Knight', 'Creature — Knight', '{0}: Until end of turn, whenever ~ deals combat damage to a player, draw two cards.', '{0}', ['2', '2']);
  it('is automated, and only the creature itself draws, once per combat damage dealt', () => {
    expect(manualParts(GEM)).toEqual([]);
    const s0 = scenario([BEAR], { p1: { battlefield: ['Test Gem Knight', BEAR] }, defs: [GEM] });
    const knight = find(s0, 'Test Gem Knight', 'battlefield', 'p1');
    const bears = find(s0, BEAR, 'battlefield', 'p1');
    const lib = s0.zones.library['p1']!.length;
    let s = settle(act(s0, { type: 'activate', player: 'p1', source: knight, ability: 'p:0:0' }));
    s = resolveAll(s);
    expect(delays(s)).toBe(1);
    s = attack(s, [knight, bears]);
    expect(handSize(s, 'p1')).toBe(2);
    expect(s.zones.library['p1']!.length).toBe(lib - 2);
  });
});
describe('CR 603.7, 603.7c, 400.7: "Target creature gets +2/+0 until end of turn. When it dies this turn, draw a card." (a one-shot with a duration)', () => {
  const PUMP = card('Test Last Wish', 'Instant', 'Target creature gets +2/+0 until end of turn. When it dies this turn, draw a card.');
  it('is automated', () => expect(manualParts(PUMP)).toEqual([]));
  it('the target dying draws one card; another creature dying draws nothing; the trigger fires only once', () => {
    const s0 = scenario([BEAR], { p1: { hand: ['Test Last Wish', 'Test Smite', 'Test Smite'], battlefield: [BEAR, BEAR] }, defs: [PUMP, SMITE] });
    const [a, b] = findAll(s0, BEAR, 'battlefield', 'p1') as [ObjectId, ObjectId];
    let s = castFirst(s0, 'Test Last Wish', [[obj(a)]]);
    expect(pt(s, a)).toBe('4/2');
    const hand = handSize(s, 'p1');
    s = castFirst(s, 'Test Smite', [[obj(b)]]); // another creature
    expect(handSize(s, 'p1')).toBe(hand - 1); // the Smite left the hand, nothing was drawn
    s = castFirst(s, 'Test Smite', [[obj(a)]]);
    expect(handSize(s, 'p1')).toBe(hand - 2 + 1); // the Smite left the hand, one card was drawn
  });
  it('CR 603.7b: it triggers only for events of this turn: the creature dying on a later turn draws nothing', () => {
    const s0 = scenario([BEAR], { p1: { hand: ['Test Last Wish'], battlefield: [BEAR] }, defs: [PUMP, SMITE], p2: { hand: [] } });
    const a = find(s0, BEAR, 'battlefield', 'p1');
    let s = castFirst(s0, 'Test Last Wish', [[obj(a)]]);
    s = toTurn(s, 2);
    expect(delays(s)).toBe(0);
  });
});

describe('CR 603.10a, 603.7c: "Target creature gets +1/-1 until end of turn. When it dies under your control this turn, draw two cards."', () => {
  const DRAIN = card('Test Bleed', 'Instant', 'Target creature gets +1/-1 until end of turn. When it dies under your control this turn, draw two cards.');
  it('is automated', () => expect(manualParts(DRAIN)).toEqual([]));
  it('your own creature dying: two cards; the opponent\'s creature dying (under their control): nothing', () => {
    const s0 = scenario([BEAR], { p1: { hand: ['Test Bleed', 'Test Bleed', 'Test Smite', 'Test Smite'], battlefield: [BEAR] }, p2: { battlefield: [BEAR] }, defs: [DRAIN, SMITE] });
    const mine = find(s0, BEAR, 'battlefield', 'p1');
    const theirs = find(s0, BEAR, 'battlefield', 'p2');
    let s = castFirst(s0, 'Test Bleed', [[obj(theirs)]]);
    const h = handSize(s, 'p1');
    s = castFirst(s, 'Test Smite', [[obj(theirs)]]);
    expect(handSize(s, 'p1')).toBe(h - 1); // Smite cast; no card drawn: it died under an opponent's control
    s = castFirst(s, 'Test Bleed', [[obj(mine)]]);
    const h2 = handSize(s, 'p1');
    s = castFirst(s, 'Test Smite', [[obj(mine)]]);
    expect(handSize(s, 'p1')).toBe(h2 - 1 + 2);
  });
});

describe('CR 603.7, 603.10a: "Exile those tokens when ~ leaves the battlefield." (created by the same ability)', () => {
  const MAKER = card('Test Illusionist', 'Creature — Wizard', 'When ~ enters, create two 1/1 white Spirit creature tokens. Exile those tokens when ~ leaves the battlefield.', '{0}', ['1', '1']);
  const OTHER = card('Test Spirit Caller', 'Creature — Wizard', 'When ~ enters, create a 1/1 white Spirit creature token.', '{0}', ['1', '1']);
  it('is automated', () => expect(manualParts(MAKER)).toEqual([]));
  it('the two tokens leave with their maker; the token of another source stays', () => {
    const s0 = scenario([BEAR], { p1: { hand: ['Test Illusionist', 'Test Spirit Caller', 'Test Smite'] }, defs: [MAKER, OTHER, SMITE] });
    let s = castFirst(s0, 'Test Illusionist');
    s = castFirst(s, 'Test Spirit Caller');
    const spirits = (x: GameState): number => x.zones.battlefield.filter((id) => x.objects[id]!.kind === 'token').length;
    expect(spirits(s)).toBe(3);
    expect(delays(s)).toBe(1);
    s = castFirst(s, 'Test Smite', [[obj(find(s, 'Test Illusionist', 'battlefield', 'p1'))]]);
    expect(spirits(s)).toBe(1);
    expect(delays(s)).toBe(0); // no duration: it triggered once and is gone (CR 603.7b)
  });
});

describe('CR 603.7, 119.3: "Whenever a creature you control enters this turn, each opponent loses 1 life and you gain 1 life."', () => {
  const SWARM = card('Test Rally Song', 'Sorcery', 'Whenever a creature you control enters this turn, each opponent loses 1 life and you gain 1 life.');
  const IMP = card('Test Imp', 'Creature — Imp', '', '{0}', ['1', '1']);
  it('is automated', () => expect(manualParts(SWARM)).toEqual([]));
  it('each creature of yours entering drains 1; the opponent\'s creatures do not; a creature entering next turn does not', () => {
    const s0 = scenario([BEAR], { p1: { hand: ['Test Rally Song', 'Test Imp', 'Test Imp'] }, p2: { hand: [] }, defs: [SWARM, IMP] });
    let s = castFirst(s0, 'Test Rally Song');
    s = castFirst(s, 'Test Imp');
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2')]).toEqual([21, 19]);
    s = castFirst(s, 'Test Imp');
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2')]).toEqual([22, 18]);
  });
});

describe('CR 603.7c, 508.1: "Whenever a creature you control attacks alone this turn, put two +1/+1 counters on it."', () => {
  const SAGA = card('Test Lone Wolf Rite', 'Sorcery', 'Whenever a creature you control attacks alone this turn, put two +1/+1 counters on it.');
  it('is automated', () => expect(manualParts(SAGA)).toEqual([]));
  it('"it" is the lone attacker: it gets the counters; attacking with two creatures puts none', () => {
    const s0 = scenario([BEAR], { p1: { hand: ['Test Lone Wolf Rite'], battlefield: [BEAR, BEAR] }, defs: [SAGA] });
    const [a, b] = findAll(s0, BEAR, 'battlefield', 'p1') as [ObjectId, ObjectId];
    const s = castFirst(s0, 'Test Lone Wolf Rite');
    const alone = attack(s, [a]);
    expect(pt(alone, a)).toBe('4/4');
    expect(pt(alone, b)).toBe('2/2');
    const both = attack(s, [a, b]);
    expect(pt(both, a)).toBe('2/2');
    expect(pt(both, b)).toBe('2/2');
  });
});

describe('CR 603.2c, 508.1: "Whenever you attack this turn, create two 1/1 red Warrior creature tokens that are tapped and attacking." (one trigger for the whole declaration)', () => {
  const RALLY = card('Test War Horn', 'Sorcery', 'Whenever you attack this turn, create two 1/1 red Warrior creature tokens that are tapped and attacking.');
  it('is automated, with a batch delay', () => {
    expect(manualParts(RALLY)).toEqual([]);
    expect(JSON.stringify(RALLY)).toContain('"batch":true');
  });
  it('attacking with two creatures makes two tokens, not four', () => {
    const s0 = scenario([BEAR], { p1: { hand: ['Test War Horn'], battlefield: [BEAR, BEAR] }, defs: [RALLY] });
    const s = castFirst(s0, 'Test War Horn');
    const mine = findAll(s, BEAR, 'battlefield', 'p1');
    const t = attack(s, mine);
    const warriors = t.zones.battlefield.filter((id) => t.objects[id]!.kind === 'token' && t.defs[t.objects[id]!.defId]!.faces[0]!.subtypes.includes('Warrior'));
    expect(warriors.length).toBe(2);
  });
});

describe('CR 603.2c: "Whenever one or more creatures you control deal combat damage to a player this turn, draw a card."', () => {
  const BATCH = card('Test Pack Hunt', 'Sorcery', 'Whenever one or more creatures you control deal combat damage to a player this turn, draw a card.');
  it('is automated, and two creatures dealing damage together draw one card', () => {
    expect(manualParts(BATCH)).toEqual([]);
    const s0 = scenario([BEAR], { p1: { hand: ['Test Pack Hunt'], battlefield: [BEAR, BEAR] }, defs: [BATCH] });
    const s = castFirst(s0, 'Test Pack Hunt');
    const h = handSize(s, 'p1');
    const t = attack(s, findAll(s, BEAR, 'battlefield', 'p1'));
    expect(handSize(t, 'p1')).toBe(h + 1);
  });
});

describe('CR 603.7: "Whenever a creature you control deals combat damage to a player or planeswalker this turn, draw a card."', () => {
  const SPY = card('Test Spy Network', 'Sorcery', 'Whenever a creature you control deals combat damage to a player or planeswalker this turn, draw a card.');
  it('each creature that hits the player draws a card', () => {
    expect(manualParts(SPY)).toEqual([]);
    const s0 = scenario([BEAR], { p1: { hand: ['Test Spy Network'], battlefield: [BEAR, BEAR] }, defs: [SPY] });
    const s = castFirst(s0, 'Test Spy Network');
    const h = handSize(s, 'p1');
    const t = attack(s, findAll(s, BEAR, 'battlefield', 'p1'));
    expect(handSize(t, 'p1')).toBe(h + 2);
  });
});

describe('CR 603.10a, 111.10: "Creatures you control get +2/+0 until end of turn. Whenever a nontoken creature you control dies this turn, create a 1/1 black Rat creature token with \\"This token can\'t block.\\""', () => {
  const CRESCENDO = card('Test Crescendo', 'Instant', 'Creatures you control get +2/+0 until end of turn. Whenever a nontoken creature you control dies this turn, create a 1/1 black Rat creature token with "This token can\'t block."');
  it('is automated', () => expect(manualParts(CRESCENDO)).toEqual([]));
  it('a nontoken creature of yours dying makes one Rat; the Rat dying (a token) and the opponent\'s creatures dying do not', () => {
    const s0 = scenario([BEAR], { p1: { hand: ['Test Crescendo', 'Test Smite', 'Test Smite', 'Test Smite'], battlefield: [BEAR] }, p2: { battlefield: [BEAR] }, defs: [CRESCENDO, SMITE] });
    const mine = find(s0, BEAR, 'battlefield', 'p1');
    const theirs = find(s0, BEAR, 'battlefield', 'p2');
    const rats = (x: GameState): ObjectId[] => x.zones.battlefield.filter((id) => x.objects[id]!.kind === 'token' && x.defs[x.objects[id]!.defId]!.faces[0]!.subtypes.includes('Rat'));
    let s = castFirst(s0, 'Test Crescendo');
    s = castFirst(s, 'Test Smite', [[obj(theirs)]]);
    expect(rats(s).length).toBe(0);
    s = castFirst(s, 'Test Smite', [[obj(mine)]]);
    expect(rats(s).length).toBe(1);
    s = castFirst(s, 'Test Smite', [[obj(rats(s)[0]!)]]);
    expect(rats(s).length).toBe(0); // a token dying makes no Rat
  });
});

describe('CR 603.7c: "Target creature gets +2/+0 until end of turn. Whenever that creature deals combat damage to a player this turn, you draw a card."', () => {
  const HOWL = card('Test Howl', 'Instant', 'Target creature gets +2/+0 until end of turn. Whenever that creature deals combat damage to a player this turn, you draw a card.');
  it('is automated; only the target\'s combat damage draws', () => {
    expect(manualParts(HOWL)).toEqual([]);
    const s0 = scenario([BEAR], { p1: { hand: ['Test Howl'], battlefield: [BEAR, BEAR] }, defs: [HOWL] });
    const [a, b] = findAll(s0, BEAR, 'battlefield', 'p1') as [ObjectId, ObjectId];
    const s = castFirst(s0, 'Test Howl', [[obj(a)]]);
    const h = handSize(s, 'p1');
    expect(handSize(attack(s, [b]), 'p1')).toBe(h);
    expect(handSize(attack(s, [a, b]), 'p1')).toBe(h + 1);
  });
});

describe('CR 603.7: "Until end of turn, whenever a Wolf, Bear, or Cat attacks, draw a card."', () => {
  const LEVI = card('Test Hunt Call', 'Instant', 'Until end of turn, whenever a Wolf, Bear, or Cat attacks, draw a card.');
  it('is automated; a Bear attacking draws, a Human attacking does not', () => {
    expect(manualParts(LEVI)).toEqual([]);
    const WOLFMAN = card('Test Guard', 'Creature — Human', '', '{0}', ['2', '2']);
    const s0 = scenario([BEAR], { p1: { hand: ['Test Hunt Call'], battlefield: [BEAR, 'Test Guard'] }, defs: [LEVI, WOLFMAN] });
    const bears = find(s0, BEAR, 'battlefield', 'p1');
    const guard = find(s0, 'Test Guard', 'battlefield', 'p1');
    const s = castFirst(s0, 'Test Hunt Call');
    const h = handSize(s, 'p1');
    expect(handSize(attack(s, [guard]), 'p1')).toBe(h);
    expect(handSize(attack(s, [bears]), 'p1')).toBe(h + 1);
  });
});

describe('CR 603.7b, 605.1b, 605.4a: "Until end of turn, whenever a player taps an Island for mana, that player adds an additional {U}." (a delayed triggered mana ability)', () => {
  const TIDE = card('Test Rising Water', 'Instant', 'Until end of turn, whenever a player taps an Island for mana, that player adds an additional {U}.');
  it('is automated; an Island tapped after it resolved adds {U}{U}, a Forest still adds {G}', () => {
    expect(manualParts(TIDE)).toEqual([]);
    const s0 = scenario(['Island', 'Forest'], { p1: { hand: ['Test Rising Water'], battlefield: ['Island', 'Forest'] }, defs: [TIDE] });
    let s = castFirst(s0, 'Test Rising Water');
    s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Island', 'battlefield'), ability: 'r:basic:U' });
    expect(pool(s, 'p1')).toBe('UU');
    s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Forest', 'battlefield'), ability: 'r:basic:G' });
    expect(pool(s, 'p1')).toBe('GUU');
  });
});

describe('CR 603.7, 603.10a, 704.5f: "All creatures get -2/-2 until end of turn. Whenever a creature dies this turn, you gain 1 life." (the delayed trigger exists when the state-based actions kill)', () => {
  const FRENZY = card('Test Grim Wave', 'Instant', 'All creatures get -2/-2 until end of turn. Whenever a creature dies this turn, you gain 1 life.');
  it('every creature the -2/-2 itself kills gains 1 life', () => {
    expect(manualParts(FRENZY)).toEqual([]);
    const s0 = scenario([BEAR], { p1: { hand: ['Test Grim Wave'], battlefield: [BEAR, BEAR] }, p2: { battlefield: [BEAR] }, defs: [FRENZY] });
    const s = castFirst(s0, 'Test Grim Wave');
    expect(lifeOf(s, 'p1')).toBe(23);
  });
});

describe('CR 603.7, 509.1, 122.1b: "Creatures you control get +2/+2 until end of turn. Whenever a creature blocks this turn, its controller gets a poison counter."', () => {
  const ASSAULT = card('Test Toxic Charge', 'Instant', 'Creatures you control get +2/+2 until end of turn. Whenever a creature blocks this turn, its controller gets a poison counter.');
  it('the blocking player (the opponent) gets one poison counter for the block', () => {
    expect(manualParts(ASSAULT)).toEqual([]);
    const s0 = scenario([BEAR], { p1: { hand: ['Test Toxic Charge'], battlefield: [BEAR] }, p2: { battlefield: [BEAR] }, defs: [ASSAULT] });
    const mine = find(s0, BEAR, 'battlefield', 'p1');
    const theirs = find(s0, BEAR, 'battlefield', 'p2');
    let s = castFirst(s0, 'Test Toxic Charge');
    s = declareAttackers(toDeclareAttackers(s), [[mine]]);
    for (let i = 0; i < 6 && s.pending?.kind !== 'declareBlockers'; i++) s = pass(s);
    s = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: theirs, attacker: mine }] });
    s = resolveAll(s);
    expect(s.players.find((x) => x.id === 'p2')!.poison).toBe(1);
    expect(s.players.find((x) => x.id === 'p1')!.poison).toBe(0);
  });
});

describe('CR 601.2i, 603.7: "Whenever you cast a creature spell this turn, draw a card."', () => {
  const GLIMPSE = card('Test Forest Glimpse', 'Sorcery', 'Whenever you cast a creature spell this turn, draw a card.');
  const IMP = card('Test Imp', 'Creature — Imp', '', '{0}', ['1', '1']);
  it('a creature spell draws a card (when cast), a noncreature spell does not', () => {
    expect(manualParts(GLIMPSE)).toEqual([]);
    const s0 = scenario([BEAR], { p1: { hand: ['Test Forest Glimpse', 'Test Imp', 'Test Smite'], battlefield: [BEAR] }, defs: [GLIMPSE, IMP, SMITE] });
    let s = castFirst(s0, 'Test Forest Glimpse');
    const h = handSize(s, 'p1');
    s = castFirst(s, 'Test Smite', [[obj(find(s, BEAR, 'battlefield', 'p1'))]]);
    expect(handSize(s, 'p1')).toBe(h - 1);
    s = castFirst(s, 'Test Imp');
    expect(handSize(s, 'p1')).toBe(h - 1 - 1 + 1);
  });
});

describe("CR 603.7c, 608.2h: a damage spell whose delayed trigger damages the dead creature's controller (its controller as it died)", () => {
  const BLOOD = card('Test Searing Mark', 'Instant', "Test Searing Mark deals 2 damage to target creature. When that creature dies this turn, Test Searing Mark deals 3 damage to the creature's controller.");
  it('is automated; the controller of the creature that died takes 3 (the opponent or you)', () => {
    expect(manualParts(BLOOD)).toEqual([]);
    const s0 = scenario([BEAR], { p1: { hand: ['Test Searing Mark', 'Test Searing Mark'], battlefield: [BEAR] }, p2: { battlefield: [BEAR] }, defs: [BLOOD] });
    const theirs = find(s0, BEAR, 'battlefield', 'p2');
    const mine = find(s0, BEAR, 'battlefield', 'p1');
    let s = castFirst(s0, 'Test Searing Mark', [[obj(theirs)]]);
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2')]).toEqual([20, 17]);
    s = castFirst(s, 'Test Searing Mark', [[obj(mine)]]);
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2')]).toEqual([17, 17]);
  });
});

describe('CR 603.7c, 601.2d, 608.2c: "~ deals 3 damage divided as you choose among any number of target creatures. Whenever a creature dealt damage this way dies this turn, draw a card."', () => {
  const FLAMES = card('Test Fan Flames', 'Instant', 'Test Fan Flames deals 3 damage divided as you choose among any number of target creatures. Whenever a creature dealt damage this way dies this turn, draw a card.');
  it('is automated; only the creatures that were dealt damage draw when they die (this turn)', () => {
    expect(manualParts(FLAMES)).toEqual([]);
    const s0 = scenario([BEAR], { p1: { hand: ['Test Fan Flames', 'Test Smite', 'Test Smite'], battlefield: [BEAR, BEAR] }, p2: { battlefield: [BEAR] }, defs: [FLAMES, SMITE] });
    const [mine, other] = findAll(s0, BEAR, 'battlefield', 'p1') as [ObjectId, ObjectId];
    const theirs = find(s0, BEAR, 'battlefield', 'p2');
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Fan Flames', 'hand', 'p1') }), [[obj(theirs), obj(mine)]]);
    expect(s.pending).toMatchObject({ kind: 'chooseDivision' });
    s = answer(s, { kind: 'chooseDivision', amounts: [2, 1] });
    s = resolveAll(s);
    expect(findAll(s, BEAR, 'battlefield', 'p2').length).toBe(0); // died from 2 damage
    const h = handSize(s, 'p1');
    expect(h).toBe(3 - 1 + 1); // the spell left the hand, one card was drawn for the creature that died
    s = castFirst(s, 'Test Smite', [[obj(other)]]); // never dealt damage this way
    expect(handSize(s, 'p1')).toBe(h - 1);
    s = castFirst(s, 'Test Smite', [[obj(mine)]]); // dealt 1 damage this way
    expect(handSize(s, 'p1')).toBe(h - 2 + 1);
  });
});

describe('CR 603.7b, 603.3d: a target in the instructions of an event-timed delayed trigger is chosen when the delayed trigger is put on the stack', () => {
  // T50 left this manual; cloud std-tdm moves the target into the `delay` step (`delay.targets`, parser/lower/conditions.ts#lowerDelayTargets): the spell announces
  // none, the delayed trigger announces its own each time it triggers (played in test/cloud/std-tdm/std-tdm-scenarios.test.ts)
  it('"Whenever you cast a noncreature spell this turn, target creature you control gains double strike until end of turn." is automated with the delayed trigger\'s own target', () => {
    const d = card('Test Double Rite', 'Sorcery', 'Whenever you cast a noncreature spell this turn, target creature you control gains double strike until end of turn.');
    expect(manualParts(d)).toEqual([]);
    const spell = d.faces[0]!.abilities[0] as unknown as { effect: { targets: unknown[]; steps: { op: string; targets?: unknown[] }[] } };
    expect(spell.effect.targets).toEqual([]);
    expect(spell.effect.steps.find((x) => x.op === 'delay')?.targets).toHaveLength(1);
  });
});
