/**
 * FAST4 T27: the trigger clauses of parser/templates/zz-fast4/t27.json and the intervening "if" clauses the package added to the hole grammars, played through
 * the engine with synthetic cards compiled by the game's default compiler (invented wordings, design 6.10).
 *
 *   CR 603.1, 603.2      a condition of the trigger event ("while you control ...", "during an opponent's turn", `TriggerDef.while`) is judged when the
 *                        event happens and never again: unlike an intervening "if" (CR 603.4) it is not checked as the ability resolves
 *   CR 603.2, 603.2c     "for the first time each turn" (`TriggerDef.first`): the first event of the turn, counted over the whole turn (the game history),
 *                        also before the source was on the battlefield; "for the first time during each of your turns"
 *   CR 119.9, 119.10     "Whenever you gain or lose life during your turn"
 *   CR 115.1, 611.2c     "Whenever ~ becomes the target of a spell or ability you control for the first time each turn, it gets +0/+2": "it" is the object
 *   CR 120.2b            "Whenever an opponent is dealt noncombat damage"
 *   CR 603.2c            "Whenever a player discards one or more cards": once for each player who discards in the batch
 *   CR 603.4, 601.2a     "if you cast it", "if another creature entered the battlefield under your control this turn", "a creature with a counter on it"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type Color, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, pass, put, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, lifeOf, passUntil, toDeclareAttackers, toDeclareBlockers, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
/** Every ability of the card automated (an experimental template caps the card at partial, design 6.9, but leaves nothing manual). */
const automated = (d: CardDef): boolean => d.automation.level !== 'manual' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const plus = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['+1/+1'] ?? 0;
const handSize = (s: GameState, p: string): number => s.zones.hand[p]!.length;
const tokens = (s: GameState, p = 'p1'): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p).length;

/** Answer the decisions that come up (targets, costs, then `answers` in order); stop at priority. */
function settle(s0: GameState, targets: TargetChoice[] = [], answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    // a choice of objects (the cards to discard): the first ones offered
    // simultaneous triggers (CR 603.3b): in the order offered
    else if (s.pending.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
    else if (s.pending.kind === 'chooseObjects') { const d = s.pending as unknown as { options: ObjectId[]; min: number }; s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, d.min) }); }
    else break;
  }
  return s;
}
/** Pass priority until the stack is empty (each object resolves after both players pass), answering what comes up. */
function resolveAll(s0: GameState, targets: TargetChoice[] = [], answers: DecisionAnswer[] = []): GameState {
  let s = settle(s0, targets, answers);
  for (let guard = 0; (s.zones.stack.length > 0 || s.pendingTriggers.length > 0) && guard < 40; guard++) s = settle(pass(s), targets, answers);
  expect(s.zones.stack.length).toBe(0);
  return s;
}
const cast = (s: GameState, name: string, targets: TargetChoice[] = [], who = 'p1'): GameState => settle(act(s, { type: 'cast', player: who, card: find(s, name, 'hand', who) }), targets);
/** Give priority to `who` (passing as needed) without leaving the current step. */
function priorityTo(s0: GameState, who: string): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.player !== who && guard < 4; guard++) s = pass(s);
  expect(s.pending?.player).toBe(who);
  return s;
}

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['5', '5'] });
const SIP = card('Test Sip', 'Instant', 'You gain 1 life.');
const BLEED = card('Test Bleed', 'Instant', 'You lose 1 life.');
const PUMP = card('Test Pump', 'Instant', 'Target creature gets +1/+0 until end of turn.');
const SHOCK = card('Test Shock', 'Instant', 'Test Shock deals 2 damage to any target.');
const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');

describe('CR 603.2: "Whenever you cast a spell during an opponent\'s turn, put a +1/+1 counter on ~."', () => {
  const CUT = card('Test Tide Cutter', 'Creature — Merfolk Pirate', 'Flash\nWhenever you cast a spell during an opponent\'s turn, put a +1/+1 counter on this creature.', { pt: ['2', '1'] });
  it('is automated; a spell cast on the opponent\'s turn triggers it, one on your own turn does not, nor an opponent\'s spell', () => {
    expect(automated(CUT)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Tide Cutter'], hand: ['Test Sip', 'Test Sip'] }, p2: { hand: ['Test Sip'] }, defs: [CUT, SIP] });
    const cutter = find(s, 'Test Tide Cutter', 'battlefield', 'p1');
    s = resolveAll(cast(s, 'Test Sip'));
    expect(plus(s, cutter)).toBe(0);
    s = advanceTo(s, 2, 'main1');
    s = resolveAll(cast(s, 'Test Sip', [], 'p2'));
    expect(plus(s, cutter)).toBe(0);
    s = resolveAll(cast(priorityTo(s, 'p1'), 'Test Sip'));
    expect(plus(s, cutter)).toBe(1);
  });
});

describe('CR 603.1, 603.2 (not 603.4): "Whenever ~ attacks while you control a creature with power 4 or greater, ~ gets +1/+0 until end of turn."', () => {
  const PUP = card('Test Brave Pup', 'Creature — Dog', 'Whenever this creature attacks while you control a creature with power 4 or greater, this creature gets +1/+0 until end of turn.', { pt: ['2', '2'] });
  it('is automated; it triggers only while the condition is true as it attacks, and is not checked again as it resolves', () => {
    expect(automated(PUP)).toBe(true);
    // without a creature with power 4 or greater: no trigger
    let s = scenario([], { p1: { battlefield: ['Test Brave Pup', 'Test Bear'] }, defs: [PUP, BEAR] });
    let pup = find(s, 'Test Brave Pup', 'battlefield', 'p1');
    s = declareAttackers(toDeclareAttackers(s), [[pup]]);
    expect(s.zones.stack.length).toBe(0);
    // with the Ogre it triggers; the Ogre is destroyed before the ability resolves, which still gives +1/+0 (a "while" is no intervening "if")
    s = scenario([], { p1: { battlefield: ['Test Brave Pup', 'Test Ogre'] }, p2: { hand: ['Test Kill'] }, defs: [PUP, OGRE, KILL] });
    pup = find(s, 'Test Brave Pup', 'battlefield', 'p1');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p1');
    s = declareAttackers(toDeclareAttackers(s), [[pup]]);
    expect(s.zones.stack.length).toBe(1);
    s = cast(priorityTo(s, 'p2'), 'Test Kill', [obj(ogre)], 'p2');
    s = resolveAll(s, [obj(ogre)]);
    expect(s.zones.battlefield.includes(ogre)).toBe(false);
    expect(pt(s, pup)).toBe('3/2');
  });
});

describe('CR 603.2: "Whenever ~ attacks or blocks while you control a Dinosaur, ~ gets +1/+1 until end of turn."', () => {
  const RIDER = card('Test Sun Rider', 'Creature — Human Knight', 'Whenever this creature attacks or blocks while you control a Dinosaur, this creature gets +1/+1 until end of turn.', { pt: ['1', '1'] });
  const DINO = card('Test Dino', 'Creature — Dinosaur', '', { pt: ['3', '3'] });
  it('is automated; attacking or blocking with a Dinosaur triggers it', () => {
    expect(automated(RIDER)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Sun Rider', 'Test Dino'] }, p2: { battlefield: ['Test Bear'] }, defs: [RIDER, DINO, BEAR] });
    const rider = find(s, 'Test Sun Rider', 'battlefield', 'p1');
    s = declareAttackers(toDeclareAttackers(s), [[rider]]);
    s = resolveAll(s);
    expect(pt(s, rider)).toBe('2/2');
    // on the opponent's turn it blocks (a new game: it attacked and is still tapped)
    s = advanceTo(scenario([], { p1: { battlefield: ['Test Sun Rider', 'Test Dino'] }, p2: { battlefield: ['Test Bear'] }, defs: [RIDER, DINO, BEAR] }), 2, 'main1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = declareAttackers(toDeclareAttackers(s), [[bear]]);
    s = declareBlockers(toDeclareBlockers(s), [[find(s, 'Test Sun Rider', 'battlefield', 'p1'), bear]]);
    expect(s.zones.stack.length).toBe(1);
    s = resolveAll(s);
    expect(pt(s, find(s, 'Test Sun Rider', 'battlefield', 'p1'))).toBe('2/2');
  });
});

describe('CR 603.2c, 603.2: "Whenever you attack while you control a creature with power 4 or greater, you draw a card and lose 1 life."', () => {
  const WARG = card('Test Pack Lord', 'Creature — Wolf', 'Whenever you attack while you control a creature with power 4 or greater, you draw a card and lose 1 life.', { pt: ['2', '2'] });
  it('is automated; once for the attack, only with such a creature', () => {
    expect(automated(WARG)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Pack Lord', 'Test Ogre', 'Test Bear'], library: ['Test Bear', 'Test Bear'] }, defs: [WARG, OGRE, BEAR] });
    const hand = handSize(s, 'p1');
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Bear', 'battlefield', 'p1')], [find(s, 'Test Pack Lord', 'battlefield', 'p1')]]);
    s = resolveAll(s);
    expect(handSize(s, 'p1')).toBe(hand + 1);
    expect(lifeOf(s, 'p1')).toBe(19);
    s = scenario([], { p1: { battlefield: ['Test Pack Lord', 'Test Bear'], library: ['Test Bear'] }, defs: [WARG, BEAR] });
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Bear', 'battlefield', 'p1')]]);
    expect(s.zones.stack.length).toBe(0);
  });
});

describe('CR 603.2, 603.2c: "Whenever you gain life for the first time each turn, draw a card."', () => {
  const SERAPH = card('Test Dawn Seraph', 'Creature — Angel', 'Whenever you gain life for the first time each turn, draw a card.', { pt: ['2', '2'] });
  const lib = Array.from({ length: 6 }, () => 'Test Bear');
  it('is automated; the first life gain of the turn triggers it, a second does not, and it triggers again the next turn', () => {
    expect(automated(SERAPH)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Dawn Seraph'], hand: ['Test Sip', 'Test Sip', 'Test Sip'], library: lib }, defs: [SERAPH, SIP, BEAR] });
    const hand = handSize(s, 'p1');
    s = resolveAll(cast(s, 'Test Sip'));
    expect(handSize(s, 'p1')).toBe(hand - 1 + 1);
    s = resolveAll(cast(s, 'Test Sip'));
    expect(handSize(s, 'p1')).toBe(hand - 2 + 1);
    s = advanceTo(s, 2, 'main1');
    s = resolveAll(cast(priorityTo(s, 'p1'), 'Test Sip'));
    expect(handSize(s, 'p1')).toBe(hand - 3 + 2);
  });
  it('counts a gain of the turn from before the creature was on the battlefield: then the next gain is not the first', () => {
    let s = scenario([], { p1: { hand: ['Test Sip', 'Test Dawn Seraph', 'Test Sip'], library: lib }, defs: [SERAPH, SIP, BEAR] });
    s = resolveAll(cast(s, 'Test Sip'));
    s = resolveAll(cast(s, 'Test Dawn Seraph'));
    const hand = handSize(s, 'p1');
    s = resolveAll(cast(s, 'Test Sip'));
    expect(handSize(s, 'p1')).toBe(hand - 1);
  });
  it('two gains in one resolution, and a history question read in the middle of it (syncHistory), still trigger it once', () => {
    const TWICE = card('Test Twice Sip', 'Sorcery', 'You gain 2 life. You gain 3 life. If an opponent lost life this turn, you gain 1 life.');
    expect(automated(TWICE)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Dawn Seraph'], hand: ['Test Twice Sip'], library: lib }, defs: [SERAPH, TWICE, BEAR] });
    const hand = handSize(s, 'p1');
    s = resolveAll(cast(s, 'Test Twice Sip'));
    expect(lifeOf(s, 'p1')).toBe(25);
    expect(handSize(s, 'p1')).toBe(hand - 1 + 1);
  });
  it('an opponent\'s life gain is not yours', () => {
    let s = scenario([], { p1: { battlefield: ['Test Dawn Seraph'], hand: ['Test Sip'], library: lib }, p2: { hand: ['Test Sip'] }, defs: [SERAPH, SIP, BEAR] });
    const hand = handSize(s, 'p1');
    s = resolveAll(cast(priorityTo(s, 'p2'), 'Test Sip', [], 'p2'));
    expect(handSize(s, 'p1')).toBe(hand);
    s = resolveAll(cast(priorityTo(s, 'p1'), 'Test Sip'));
    expect(handSize(s, 'p1')).toBe(hand - 1 + 1);
  });
});

describe('CR 603.2, 500.1: "Whenever you gain life for the first time during each of your turns, create a 1/1 white Cat creature token."', () => {
  const KEEPER = card('Test Cat Keeper', 'Creature — Cat', 'Whenever you gain life for the first time during each of your turns, create a 1/1 white Cat creature token.', { pt: ['1', '1'] });
  it('is automated; not on an opponent\'s turn, once on yours', () => {
    expect(automated(KEEPER)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Cat Keeper'], hand: ['Test Sip', 'Test Sip', 'Test Sip'] }, defs: [KEEPER, SIP] });
    s = advanceTo(s, 2, 'main1');
    s = resolveAll(cast(priorityTo(s, 'p1'), 'Test Sip'));
    expect(tokens(s)).toBe(0);
    s = advanceTo(s, 3, 'main1');
    s = resolveAll(cast(s, 'Test Sip'));
    expect(tokens(s)).toBe(1);
    s = resolveAll(cast(s, 'Test Sip'));
    expect(tokens(s)).toBe(1);
  });
});

describe('CR 119.9, 119.10, 603.2: "Whenever you gain or lose life during your turn, ~ gets +1/+0 until end of turn."', () => {
  const WIT = card('Test Wane Witness', 'Creature — Bat Cleric', 'Whenever you gain or lose life during your turn, this creature gets +1/+0 until end of turn.', { pt: ['1', '4'] });
  it('is automated; a gain and a loss on your turn each trigger it, not on the opponent\'s turn', () => {
    expect(automated(WIT)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Wane Witness'], hand: ['Test Sip', 'Test Bleed', 'Test Sip'] }, defs: [WIT, SIP, BLEED] });
    const w = find(s, 'Test Wane Witness', 'battlefield', 'p1');
    s = resolveAll(cast(s, 'Test Sip'));
    s = resolveAll(cast(s, 'Test Bleed'));
    expect(pt(s, w)).toBe('3/4');
    s = advanceTo(s, 2, 'main1');
    s = resolveAll(cast(priorityTo(s, 'p1'), 'Test Sip'));
    expect(pt(s, w)).toBe('1/4');
  });
});

describe('CR 603.2, 115.1, 611.2c: "Whenever ~ becomes the target of a spell or ability you control for the first time each turn, it gets +0/+2 until end of turn."', () => {
  const GUARD = card('Test Nettle Ward', 'Creature — Mouse Soldier', 'Valiant — Whenever this creature becomes the target of a spell or ability you control for the first time each turn, it gets +0/+2 until end of turn.', { pt: ['1', '1'] });
  it('is automated; the first time your spell targets it, once a turn; an opponent\'s spell does not count', () => {
    expect(automated(GUARD)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Nettle Ward'], hand: ['Test Pump', 'Test Pump', 'Test Pump'] }, p2: { hand: ['Test Pump'] }, defs: [GUARD, PUMP] });
    const g = find(s, 'Test Nettle Ward', 'battlefield', 'p1');
    // the opponent targets it first: no trigger, and it does not use up the first time
    s = resolveAll(cast(priorityTo(s, 'p2'), 'Test Pump', [obj(g)], 'p2'), [obj(g)]);
    expect(pt(s, g)).toBe('2/1');
    s = resolveAll(cast(priorityTo(s, 'p1'), 'Test Pump', [obj(g)]), [obj(g)]);
    expect(pt(s, g)).toBe('3/3');
    s = resolveAll(cast(s, 'Test Pump', [obj(g)]), [obj(g)]);
    expect(pt(s, g)).toBe('4/3');
    s = advanceTo(s, 3, 'main1');
    s = resolveAll(cast(s, 'Test Pump', [obj(g)]), [obj(g)]);
    expect(pt(s, g)).toBe('2/3');
  });
});

describe('CR 120.2b, 603.2: "Whenever an opponent is dealt noncombat damage, put a +1/+1 counter on ~."', () => {
  const GIRL = card('Test Pain Collector', 'Creature — Human Assassin', 'Whenever an opponent is dealt noncombat damage, put a +1/+1 counter on this creature.', { pt: ['2', '2'] });
  it('is automated; a spell\'s damage to the opponent triggers it, combat damage and damage to you do not', () => {
    expect(automated(GIRL)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Pain Collector', 'Test Bear'], hand: ['Test Shock', 'Test Shock'] }, defs: [GIRL, SHOCK, BEAR] });
    const g = find(s, 'Test Pain Collector', 'battlefield', 'p1');
    s = resolveAll(cast(s, 'Test Shock', [player('p2')]), [player('p2')]);
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(plus(s, g)).toBe(1);
    s = resolveAll(cast(s, 'Test Shock', [player('p1')]), [player('p1')]);
    expect(plus(s, g)).toBe(1);
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Bear', 'battlefield', 'p1')]]);
    s = passUntil(s, (x) => x.turn.step === 'main2' || x.turn.step === 'end', 'after combat', 40);
    expect(lifeOf(s, 'p2')).toBe(16);
    expect(plus(s, g)).toBe(1);
  });
});

describe('CR 603.2c: "Whenever a player discards one or more cards, ~ deals 1 damage to each opponent."', () => {
  const BONES = card('Test Pocket Bones', 'Creature — Skeleton', 'Whenever a player discards one or more cards, this creature deals 1 damage to each opponent.', { pt: ['1', '1'] });
  const PURGE = card('Test Purge', 'Sorcery', 'Discard two cards.');
  const BOTH = card('Test Both Purge', 'Sorcery', 'Each player discards a card.');
  it('is automated; two cards discarded together are one trigger; each player discarding is one trigger for each player', () => {
    expect(automated(BONES)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Pocket Bones'], hand: ['Test Purge', 'Test Bear', 'Test Bear', 'Test Both Purge', 'Test Bear'] }, p2: { hand: ['Test Bear'] }, defs: [BONES, PURGE, BOTH, BEAR] });
    s = resolveAll(cast(s, 'Test Purge'));
    expect(handSize(s, 'p1')).toBe(2);
    expect(lifeOf(s, 'p2')).toBe(19);
    s = resolveAll(cast(s, 'Test Both Purge'));
    expect(handSize(s, 'p1') + handSize(s, 'p2')).toBe(0);
    expect(lifeOf(s, 'p2')).toBe(17);
  });
});

describe('CR 603.2, 205.3: "Whenever you cast a noncreature or Dragon spell, ~ deals 1 damage to each opponent."', () => {
  const WHELP = card('Test Spit Whelp', 'Creature — Dragon', 'Whenever you cast a noncreature or Dragon spell, this creature deals 1 damage to each opponent.', { pt: ['1', '1'] });
  const DRAKE = card('Test Drake', 'Creature — Dragon', '', { pt: ['2', '2'] });
  it('is automated; a noncreature spell and a Dragon spell trigger it, another creature spell does not', () => {
    expect(automated(WHELP)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Spit Whelp'], hand: ['Test Sip', 'Test Drake', 'Test Bear'] }, defs: [WHELP, SIP, DRAKE, BEAR] });
    s = resolveAll(cast(s, 'Test Sip'));
    expect(lifeOf(s, 'p2')).toBe(19);
    s = resolveAll(cast(s, 'Test Drake'));
    expect(lifeOf(s, 'p2')).toBe(18);
    s = resolveAll(cast(s, 'Test Bear'));
    expect(lifeOf(s, 'p2')).toBe(18);
  });
});

describe('CR 603.6a, 205.3: "Whenever another Villain and/or artifact you control enters, ~ deals 1 damage to target opponent."', () => {
  const BOT = card('Test Assault Bot', 'Artifact Creature — Robot Villain', 'Whenever another Villain and/or artifact you control enters, this creature deals 1 damage to target opponent.', { pt: ['2', '2'] });
  const VILLAIN = card('Test Henchman', 'Creature — Human Villain', '', { pt: ['1', '1'] });
  const TRINKET = card('Test Trinket', 'Artifact', '');
  const BOTH = card('Test Evil Golem', 'Artifact Creature — Golem Villain', '', { pt: ['1', '1'] });
  it('is automated; a Villain, an artifact and an artifact Villain each trigger it once, a Bear does not', () => {
    expect(automated(BOT)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Assault Bot'], hand: ['Test Henchman', 'Test Trinket', 'Test Evil Golem', 'Test Bear'] }, defs: [BOT, VILLAIN, TRINKET, BOTH, BEAR] });
    for (const n of ['Test Henchman', 'Test Trinket', 'Test Evil Golem']) s = resolveAll(cast(s, n), [player('p2')]);
    expect(lifeOf(s, 'p2')).toBe(17);
    s = resolveAll(cast(s, 'Test Bear'), [player('p2')]);
    expect(lifeOf(s, 'p2')).toBe(17);
  });
});

describe('CR 603.4: intervening "if" clauses: "another creature entered the battlefield under your control this turn", "a creature with a counter on it"', () => {
  const WARDEN = card('Test Spout Warden', 'Creature — Merfolk', 'Whenever this creature attacks, if another creature entered the battlefield under your control this turn, this creature gains flying until end of turn.', { pt: ['3', '2'] });
  const FLIES = card('Test Delta Flies', 'Creature — Insect', 'Whenever this creature attacks, if you control a creature with a counter on it, each opponent loses 1 life.', { pt: ['1', '1'] });
  const flying = (s: GameState, id: ObjectId): boolean => getChars(s, id)!.keywords.some((k) => k.keyword === 'flying');
  it('the Warden gains flying only when another creature entered under your control this turn (not itself)', () => {
    expect(automated(WARDEN)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Spout Warden', 'Test Bear'] }, defs: [WARDEN, BEAR] });
    s = resolveAll(cast(s, 'Test Spout Warden'));
    s = tweak(s, (t) => { t.objects[find(t, 'Test Spout Warden', 'battlefield', 'p1')]!.controlledSinceTurn = 0; });
    let w = find(s, 'Test Spout Warden', 'battlefield', 'p1');
    let a = declareAttackers(toDeclareAttackers(s), [[w]]);
    expect(a.zones.stack.length).toBe(0);
    s = scenario([], { p1: { battlefield: ['Test Spout Warden'], hand: ['Test Bear'] }, defs: [WARDEN, BEAR] });
    s = resolveAll(cast(s, 'Test Bear'));
    w = find(s, 'Test Spout Warden', 'battlefield', 'p1');
    a = resolveAll(declareAttackers(toDeclareAttackers(s), [[w]]));
    expect(flying(a, w)).toBe(true);
  });
  it('the Flies drain only while a creature you control has a counter of any kind', () => {
    expect(automated(FLIES)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Delta Flies', 'Test Bear'] }, defs: [FLIES, BEAR] });
    let a = resolveAll(declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Delta Flies', 'battlefield', 'p1')]]));
    expect(lifeOf(a, 'p2')).toBe(20);
    s = scenario([], { p1: { battlefield: ['Test Delta Flies', { name: 'Test Bear', counters: { stun: 1 } }] }, defs: [FLIES, BEAR] });
    a = resolveAll(declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Delta Flies', 'battlefield', 'p1')]]));
    expect(lifeOf(a, 'p2')).toBe(19);
  });
});

describe('CR 603.4, 601.2a: "When ~ enters, if you cast it, add {R}{G}." and "if there\'s a Lesson card in your graveyard"', () => {
  const TIGER = card('Test Prism Tiger', 'Creature — Cat', 'When this creature enters, if you cast it, add {R}{G}.', { pt: ['3', '4'] });
  const REANIMATE = card('Test Reanimate', 'Sorcery', 'Return target creature card from your graveyard to the battlefield.');
  const SENTRY = card('Test Wall Sentry', 'Creature — Plant Wall', 'When this creature dies, if there\'s a Lesson card in your graveyard, you gain 2 life.', { pt: ['0', '4'] });
  const LESSON = card('Test Lesson', 'Sorcery — Lesson', 'You gain 0 life.');
  const pool = (s: GameState): string => s.players.find((p) => p.id === 'p1')!.manaPool.map((u) => u.type).sort().join('');
  it('the Tiger adds the mana when it was cast, not when it was put onto the battlefield', () => {
    expect(automated(TIGER)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Prism Tiger', 'Test Reanimate'], graveyard: ['Test Prism Tiger'] }, defs: [TIGER, REANIMATE] });
    s = resolveAll(cast(s, 'Test Prism Tiger'));
    expect(pool(s)).toBe('GR');
    s = tweak(s, (t) => { t.players.find((p) => p.id === 'p1')!.manaPool = []; });
    s = resolveAll(cast(s, 'Test Reanimate', [obj(find(s, 'Test Prism Tiger', 'graveyard', 'p1'))]), [obj(find(s, 'Test Prism Tiger', 'graveyard', 'p1'))]);
    expect(pool(s)).toBe('');
  });
  it('the Sentry gains life when it dies only with a Lesson card in your graveyard', () => {
    expect(automated(SENTRY)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Wall Sentry'] }, p2: { hand: ['Test Kill'] }, defs: [SENTRY, LESSON, KILL] });
    s = resolveAll(cast(priorityTo(s, 'p2'), 'Test Kill', [obj(find(s, 'Test Wall Sentry', 'battlefield', 'p1'))], 'p2'), [obj(find(s, 'Test Wall Sentry', 'battlefield', 'p1'))]);
    expect(lifeOf(s, 'p1')).toBe(20);
    s = scenario([], { p1: { battlefield: ['Test Wall Sentry'], graveyard: ['Test Lesson'] }, p2: { hand: ['Test Kill'] }, defs: [SENTRY, LESSON, KILL] });
    s = resolveAll(cast(priorityTo(s, 'p2'), 'Test Kill', [obj(find(s, 'Test Wall Sentry', 'battlefield', 'p1'))], 'p2'), [obj(find(s, 'Test Wall Sentry', 'battlefield', 'p1'))]);
    expect(lifeOf(s, 'p1')).toBe(22);
  });
});

// keep the imports used by helpers that a later edit may drop
void put;
