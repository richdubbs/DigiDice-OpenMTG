/**
 * Standard round 4, slice r4-fxz: one-shot effects on cards, zones and players, played through applyAction with synthetic cards compiled by the game's default
 * compiler (invented wordings, design 6.10). Nothing is mocked. Each describe names the rules it pins.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, life, pass, put, reject, scenario } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';
import { tweak } from '../../m5/helpers';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual node): what a promotion makes full. */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const yes: DecisionAnswer = { kind: 'yesNo', yes: true };

function settle(s0: GameState, opts: { targets?: TargetChoice[][]; picks?: ObjectId[][]; answers?: DecisionAnswer[] } = {}): GameState {
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
type Opts = Parameters<typeof settle>[1];
/** Pass priority until the stack is empty, answering what comes up. */
function drain(s0: GameState, opts: Opts = {}): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 12; guard++) s = settle(pass(pass(s)), opts);
  return s;
}
function cast(s0: GameState, name: string, opts: Opts = {}): GameState {
  const q = { targets: [...(opts.targets ?? [])], picks: [...(opts.picks ?? [])], answers: [...(opts.answers ?? [])] };
  return drain(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), { targets: q.targets }), q);
}
function activate(s0: GameState, source: ObjectId, opts: Opts = {}, ability = 'p:0:0'): GameState {
  const q = { targets: [...(opts.targets ?? [])], picks: [...(opts.picks ?? [])], answers: [...(opts.answers ?? [])] };
  return drain(settle(act(s0, { type: 'activate', player: 'p1', source, ability }), { targets: q.targets }), q);
}
/** Pass priority (declaring no attackers and no blockers) until `done`. */
function passTo(s0: GameState, done: (s: GameState) => boolean, opts: Opts = {}, max = 300): GameState {
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
const onBattlefield = (s: GameState, defId: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId);
const tokensNamed = (s: GameState, sub: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && (getChars(s, id).subtypes ?? []).includes(sub));

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}{G}');
const LAND = card('Test Land', 'Land', '');

describe('CR 701.9a, 119.3, 608.2c: "you discard a card, lose 2 life, and <instruction>" (eff.fxz.you.discard.loselife.and)', () => {
  const PACT = card('Test Pact', 'Enchantment', 'At the beginning of your upkeep, you discard a card, lose 2 life, and create a Treasure token.');
  it('is automated; on your upkeep you discard, lose 2 life and create the Treasure (the opponent loses nothing)', () => {
    expect(automated(PACT)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Pact'], hand: ['Test Bear'] }, defs: [PACT, BEAR] });
    s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'upkeep' && x.zones.stack.length > 0);
    s = drain(s, { picks: [[find(s, 'Test Bear', 'hand', 'p1')]] });
    expect(life(s, 'p1')).toBe(18);
    expect(life(s, 'p2')).toBe(20);
    expect(findAll(s, 'Test Bear', 'graveyard', 'p1')).toHaveLength(1);
    expect(tokensNamed(s, 'Treasure')).toHaveLength(1);
  });
  it('"target players each mill a card and lose 1 life" is not read as your own loss of life (the template needs the subject "you")', () => {
    const MILL = card('Test Mill', 'Sorcery', 'Any number of target players each mill a card and lose 1 life.');
    const step = JSON.stringify(MILL.faces[0]!.abilities);
    expect(step).not.toContain('eff.fxz.you.discard.loselife.and');
    expect(step).not.toMatch(/"op":"loseLife","who":\{"ref":"you"\}/);
  });
});

describe('CR 113.6m, 400.7, 401.1: "Whenever a Forest you control enters, you may put this card from your graveyard on top of your library." (eff.fxz.put.self.gy.libraryTop)', () => {
  const COLOSSUS = card('Test Colossus', 'Artifact Creature — Construct', 'Whenever a Forest you control enters, you may put this card from your graveyard on top of your library.', ['4', '4']);
  it('is automated; it triggers from the graveyard, and the card goes on top of its owner\'s library', () => {
    expect(automated(COLOSSUS)).toBe(true);
    let s = scenario(['Forest'], { p1: { hand: ['Forest'], graveyard: ['Test Colossus'] }, defs: [COLOSSUS] });
    s = settle(act(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'hand', 'p1') }), { answers: [yes] });
    s = drain(s, { answers: [yes] });
    expect(findAll(s, 'Test Colossus', 'graveyard', 'p1')).toHaveLength(0);
    const top = s.zones.library['p1']![0]!;
    expect(s.objects[top]!.defId).toBe('Test Colossus');
  });
  it('on the battlefield it does not trigger (it functions only in the graveyard)', () => {
    let s = scenario(['Forest'], { p1: { hand: ['Forest'], battlefield: ['Test Colossus'] }, defs: [COLOSSUS] });
    s = settle(act(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'hand', 'p1') }));
    expect(s.zones.stack).toHaveLength(0);
    expect(onBattlefield(s, 'Test Colossus')).toHaveLength(1);
  });
});

describe('CR 608.2c: "<instruction> unless <condition>" is the instruction if the condition is false, checked as it resolves (eff.fxz.unless.cond)', () => {
  const FEASTER = card('Test Feaster', 'Creature — Demon', 'At the beginning of your end step, sacrifice a creature unless you gained life this turn.', ['7', '6']);
  const SIP = card('Test Sip', 'Instant', 'You gain 2 life.');
  it('is automated; with no life gained this turn you sacrifice a creature at your end step', () => {
    expect(automated(FEASTER)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Feaster', 'Test Bear'] }, defs: [FEASTER, BEAR] });
    s = passTo(s, (x) => x.turn.number === 1 && x.turn.step === 'end' && x.zones.stack.length > 0);
    s = drain(s, { picks: [[onBattlefield(s, 'Test Bear')[0]!]] });
    expect(onBattlefield(s, 'Test Bear')).toHaveLength(0);
    expect(onBattlefield(s, 'Test Feaster')).toHaveLength(1);
  });
  it('after you gained life this turn nothing is sacrificed', () => {
    let s = scenario([], { p1: { battlefield: ['Test Feaster', 'Test Bear'], hand: ['Test Sip'] }, defs: [FEASTER, BEAR, SIP] });
    s = cast(s, 'Test Sip');
    expect(life(s, 'p1')).toBe(22);
    s = passTo(s, (x) => x.turn.number === 1 && x.turn.step === 'end' && x.zones.stack.length > 0);
    s = drain(s);
    expect(onBattlefield(s, 'Test Bear')).toHaveLength(1);
    expect(onBattlefield(s, 'Test Feaster')).toHaveLength(1);
  });
  const PORTAL = card('Test Portal', 'Instant', 'Draw a card. You lose 2 life unless you control a Wizard.');
  const WIZ = card('Test Wizard', 'Creature — Human Wizard', '', ['1', '1']);
  it('"You lose 2 life unless you control a Wizard": you lose 2 life without one, none with one', () => {
    expect(automated(PORTAL)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Portal'] }, defs: [PORTAL, WIZ] });
    s = cast(s, 'Test Portal');
    expect(life(s, 'p1')).toBe(18);
    let w = scenario([], { p1: { hand: ['Test Portal'], battlefield: ['Test Wizard'] }, defs: [PORTAL, WIZ] });
    w = cast(w, 'Test Portal');
    expect(life(w, 'p1')).toBe(20);
  });
});

describe('CR 118.12a, 701.21a, 608.2f: "each opponent loses 3 life unless that player sacrifices a nonland permanent of their choice or discards a card"', () => {
  const ARTIST = card('Test Artist', 'Creature — Devil', 'When this creature enters, each opponent loses 3 life unless that player sacrifices a nonland permanent of their choice or discards a card.', ['2', '2']);
  const no: DecisionAnswer = { kind: 'yesNo', yes: false };
  it('is automated; the opponent who pays neither cost loses 3 life', () => {
    expect(automated(ARTIST)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Artist'] }, p2: { battlefield: ['Test Bear'], hand: ['Test Bear'] }, defs: [ARTIST, BEAR] });
    s = cast(s, 'Test Artist', { answers: [no, no] });
    expect(life(s, 'p2')).toBe(17);
    expect(onBattlefield(s, 'Test Bear')).toHaveLength(1);
  });
  it('the opponent may sacrifice a nonland permanent instead (and loses no life)', () => {
    let s = scenario([], { p1: { hand: ['Test Artist'] }, p2: { battlefield: ['Test Bear'], hand: ['Test Bear'] }, defs: [ARTIST, BEAR] });
    const bear = onBattlefield(s, 'Test Bear')[0]!;
    s = cast(s, 'Test Artist', { answers: [yes], picks: [[bear]] });
    expect(life(s, 'p2')).toBe(20);
    expect(onBattlefield(s, 'Test Bear')).toHaveLength(0);
  });
  it('or discard a card instead (and loses no life)', () => {
    let s = scenario([], { p1: { hand: ['Test Artist'] }, p2: { battlefield: ['Test Bear'], hand: ['Test Bear'] }, defs: [ARTIST, BEAR] });
    s = cast(s, 'Test Artist', { answers: [no, yes], picks: [[find(s, 'Test Bear', 'hand', 'p2')]] });
    expect(life(s, 'p2')).toBe(20);
    expect(findAll(s, 'Test Bear', 'graveyard', 'p2')).toHaveLength(1);
    expect(onBattlefield(s, 'Test Bear')).toHaveLength(1);
  });
});

describe('CR 601.2i, 109.2, 400.7: "If you\'ve cast another spell this turn, draw a card." in an instant (eff.fxz.if.castAnother.thisTurn)', () => {
  const SLICK = card('Test Slick', 'Instant', 'This spell deals 2 damage to any target. If you\'ve cast another spell this turn, draw a card.');
  const SIP = card('Test Sip', 'Instant', 'You gain 2 life.');
  const p2 = { kind: 'player', id: 'p2' } as TargetChoice;
  it('is automated; cast alone, the spell itself is not "another spell": no card', () => {
    expect(automated(SLICK)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Slick'] }, defs: [SLICK] });
    const hand0 = s.zones.hand['p1']!.length;
    s = cast(s, 'Test Slick', { targets: [[p2]] });
    expect(life(s, 'p2')).toBe(18);
    expect(s.zones.hand['p1']!.length).toBe(hand0 - 1);
  });
  it('after another spell this turn you draw a card', () => {
    let s = scenario([], { p1: { hand: ['Test Slick', 'Test Sip'] }, defs: [SLICK, SIP] });
    s = cast(s, 'Test Sip');
    const hand0 = s.zones.hand['p1']!.length;
    s = cast(s, 'Test Slick', { targets: [[p2]] });
    expect(s.zones.hand['p1']!.length).toBe(hand0);
  });
  it('on a permanent "another spell" is refused (its own spell is another object, CR 400.7)', () => {
    const ELF = card('Test Elf', 'Creature — Elf', 'When this creature enters, if you\'ve cast another spell this turn, draw a card.', ['1', '1']);
    expect(automated(ELF)).toBe(false);
  });
});

describe('CR 113.6m, 602.2: "{2}, Return a tapped creature you control to its owner\'s hand: Put this card from your hand onto the battlefield." (eff.fxz.put.self.hand.battlefield)', () => {
  const RETREAT = card('Test Retreat', 'Land', '{2}, Return a tapped creature you control to its owner\'s hand: Put this card from your hand onto the battlefield. Activate only as a sorcery.');
  it('is automated; activated from the hand, the land goes onto the battlefield and the creature returns to its owner\'s hand', () => {
    expect(automated(RETREAT)).toBe(true);
    let s = scenario(['Plains'], { p1: { hand: ['Test Retreat'], battlefield: ['Plains', 'Plains', { name: 'Test Bear', tapped: true }] }, defs: [RETREAT, BEAR] });
    s = activate(s, find(s, 'Test Retreat', 'hand', 'p1'), { picks: [[onBattlefield(s, 'Test Bear')[0]!]] });
    expect(onBattlefield(s, 'Test Retreat')).toHaveLength(1);
    expect(findAll(s, 'Test Bear', 'hand', 'p1')).toHaveLength(1);
  });
});

describe('CR 400.7, 614.1c, 122.6: "When this creature dies, if it had no counters on it, return it to the battlefield tapped under its owner\'s control with two stun counters on it."', () => {
  const SLASHER = card('Test Slasher', 'Creature — Zombie Assassin', 'When this creature dies, if it had no counters on it, return it to the battlefield tapped under its owner\'s control with two stun counters on it.', ['2', '3']);
  const SWAT = card('Test Swat', 'Instant', 'Destroy target creature.');
  it('is automated; it returns tapped with two stun counters, and with counters on it, it does not return', () => {
    expect(automated(SLASHER)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Swat', 'Test Swat'], battlefield: ['Test Slasher'] }, defs: [SLASHER, SWAT] });
    s = cast(s, 'Test Swat', { targets: [[obj(onBattlefield(s, 'Test Slasher')[0]!)]] });
    const [back] = onBattlefield(s, 'Test Slasher');
    expect(back).toBeDefined();
    expect(s.objects[back!]!.tapped).toBe(true);
    expect(s.objects[back!]!.counters.stun).toBe(2);
    s = cast(s, 'Test Swat', { targets: [[obj(back!)]] });
    expect(onBattlefield(s, 'Test Slasher')).toHaveLength(0);
    expect(findAll(s, 'Test Slasher', 'graveyard', 'p1')).toHaveLength(1);
  });
});

describe('CR 611.2a, 613.1f, 400.7: "return it to the battlefield under its owner\'s control and it loses all abilities" (eff.fxb.loseAll.permanent; wave 7: r4-fxz\'s eff.fxz.loseall.permanent folded into it)', () => {
  const WRETCH = card('Test Wretch', 'Creature — Goblin', 'When this creature dies, if it had a -1/-1 counter on it, return it to the battlefield under its owner\'s control and it loses all abilities.', ['4', '2']);
  const SWAT = card('Test Swat', 'Instant', 'Destroy target creature.');
  it('is automated; with a -1/-1 counter it returns without abilities (the new object, for good), and dying again it stays in the graveyard', () => {
    expect(automated(WRETCH)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Swat', 'Test Swat'], battlefield: [{ name: 'Test Wretch', counters: { '-1/-1': 1 } }] }, defs: [WRETCH, SWAT] });
    s = cast(s, 'Test Swat', { targets: [[obj(onBattlefield(s, 'Test Wretch')[0]!)]] });
    const [back] = onBattlefield(s, 'Test Wretch');
    expect(back).toBeDefined();
    expect(getChars(s, back!).abilities).toHaveLength(0);
    s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'main1');
    expect(getChars(s, back!).abilities).toHaveLength(0);
  });
  it('without a -1/-1 counter it stays in the graveyard', () => {
    let s = scenario([], { p1: { hand: ['Test Swat'], battlefield: ['Test Wretch'] }, defs: [WRETCH, SWAT] });
    s = cast(s, 'Test Swat', { targets: [[obj(onBattlefield(s, 'Test Wretch')[0]!)]] });
    expect(onBattlefield(s, 'Test Wretch')).toHaveLength(0);
  });
});

describe('CR 601.2a, 707.10, 111.1: "If this spell was cast from anywhere other than your hand, put a +1/+1 counter on that creature." (the created token)', () => {
  const ANTICS = card('Test Antics', 'Sorcery', 'Create a 1/1 blue Otter creature token. If this spell was cast from anywhere other than your hand, put a +1/+1 counter on that creature.\nFlashback {0}');
  it('is automated; cast from the hand the token gets no counter, cast with flashback from the graveyard it gets one', () => {
    expect(automated(ANTICS)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Antics'] }, defs: [ANTICS] });
    s = cast(s, 'Test Antics');
    const [a] = tokensNamed(s, 'Otter');
    expect(s.objects[a!]!.counters['+1/+1'] ?? 0).toBe(0);
    s = drain(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Antics', 'graveyard', 'p1'), method: 'flashback' })));
    const b = tokensNamed(s, 'Otter').find((id) => id !== a);
    expect(s.objects[b!]!.counters['+1/+1']).toBe(1);
  });
});

describe('CR 701.9a, 608.2h: "Draw a card for each card you\'ve discarded this turn." (the discard of the cost counts)', () => {
  const KNIGHT = card('Test Knight', 'Creature — Human Detective', '{T}, Discard a card: Draw a card for each card you\'ve discarded this turn.', ['2', '3']);
  const LOOT = card('Test Loot', 'Sorcery', 'Discard a card.');
  it('is automated; one discard (the cost) draws one card, after another discard this turn two', () => {
    expect(automated(KNIGHT)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Knight'], hand: ['Test Bear', 'Test Bear', 'Test Loot'] }, defs: [KNIGHT, BEAR, LOOT] });
    s = cast(s, 'Test Loot', { picks: [[find(s, 'Test Bear', 'hand', 'p1')]] });
    const hand0 = s.zones.hand['p1']!.length;
    s = activate(s, onBattlefield(s, 'Test Knight')[0]!, { picks: [[find(s, 'Test Bear', 'hand', 'p1')]] });
    expect(s.zones.hand['p1']!.length).toBe(hand0 - 1 + 2);
  });
});

describe('CR 202.3, 608.2h: "Draw a card for each different mana value among nonland permanents you control." (a token\'s 0 counts)', () => {
  const INSIGHT = card('Test Insight', 'Sorcery', 'Draw a card for each different mana value among nonland permanents you control.');
  const TWO = card('Test Two', 'Creature — Bear', '', ['2', '2'], '{1}{G}');
  const THREE = card('Test Three', 'Artifact', '', undefined, '{3}');
  const TOKENER = card('Test Tokener', 'Sorcery', 'Create a Treasure token.');
  it('is automated; mana values 2, 2, 3 and a token\'s 0 are three different values', () => {
    expect(automated(INSIGHT)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Insight', 'Test Tokener'], battlefield: ['Test Two', 'Test Two', 'Test Three', 'Plains'] }, defs: [INSIGHT, TWO, THREE, TOKENER] });
    s = cast(s, 'Test Tokener');
    const hand0 = s.zones.hand['p1']!.length;
    s = cast(s, 'Test Insight');
    expect(s.zones.hand['p1']!.length).toBe(hand0 - 1 + 3);
  });
});

describe('CR 107.3, 608.2h: "where X is the amount of mana spent to cast that spell. If X is 4 or more, draw a card."', () => {
  const MAGE = card('Test Mage', 'Creature — Dwarf Wizard', 'Whenever you cast a noncreature spell, this creature gets +X/+0 until end of turn, where X is the amount of mana spent to cast that spell. If X is 4 or more, draw a card.', ['1', '4']);
  const BIG = card('Test Big', 'Sorcery', 'You gain 1 life.', undefined, '{4}');
  const SMALL = card('Test Small', 'Sorcery', 'You gain 1 life.', undefined, '{2}');
  it('is automated; four mana spent: +4/+0 and a card; two mana: +2/+0 and no card', () => {
    expect(automated(MAGE)).toBe(true);
    let s = scenario(['Plains'], { p1: { hand: ['Test Big', 'Test Small'], battlefield: ['Test Mage', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'] }, defs: [MAGE, BIG, SMALL] });
    const mage = onBattlefield(s, 'Test Mage')[0]!;
    let hand0 = s.zones.hand['p1']!.length;
    s = cast(s, 'Test Big');
    expect(getChars(s, mage).power).toBe('5');
    expect(s.zones.hand['p1']!.length).toBe(hand0 - 1 + 1);
    hand0 = s.zones.hand['p1']!.length;
    s = cast(s, 'Test Small');
    expect(getChars(s, mage).power).toBe('7');
    expect(s.zones.hand['p1']!.length).toBe(hand0 - 1);
  });
});

describe('CR 701.23a, 305.6: "search your library for a basic land card or Cave card, put it onto the battlefield tapped, then shuffle." (eff.fxz.search.library.oneOfTwo)', () => {
  const CAVE = card('Test Cave', 'Land — Cave', '');
  const SURVEYOR = card('Test Surveyor', 'Artifact Creature — Gnome', 'When this creature enters, search your library for a basic land card or Cave card, put it onto the battlefield tapped, then shuffle.', ['1', '2']);
  it('is automated; a Cave (not basic) can be found and enters tapped; a nonbasic non-Cave land is not offered', () => {
    expect(automated(SURVEYOR)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Surveyor'], library: ['Test Cave', 'Test Land'] }, defs: [SURVEYOR, CAVE, LAND] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Surveyor', 'hand', 'p1') });
    for (let g = 0; g < 8 && s.pending?.kind !== 'chooseObjects'; g++) s = s.pending?.kind === 'payCost' ? answer(s, { kind: 'payCost', auto: true }) : pass(s);
    const options = (s.pending as unknown as { options: string[] }).options;
    expect(options).toContain(find(s, 'Test Cave', 'library', 'p1'));
    expect(options).not.toContain(find(s, 'Test Land', 'library', 'p1'));
    s = drain(answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Cave', 'library', 'p1')] }));
    const [cave] = onBattlefield(s, 'Test Cave');
    expect(s.objects[cave!]!.tapped).toBe(true);
  });
});

/** Attack with `attacker` on turn 1 (it must not be summoning sick), no blocks, and resolve what combat damage triggers. */
function attackWith(s0: GameState, attacker: ObjectId, opts: Opts = {}): GameState {
  let s = passTo(s0, (x) => x.pending?.kind === 'declareAttackers');
  s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker, defender: 'p2' }] });
  s = passTo(s, (x) => (x.turn.step === 'combatDamage' && x.zones.stack.length > 0) || x.turn.step === 'end', opts);
  return drain(s, opts);
}

describe('CR 608.2c, 613.1b, 603.2: "that player gains control of ~. If they do, you draw that many cards, create that many tapped Treasure tokens, then lose that much life."', () => {
  const KAIN = card('Test Kain', 'Legendary Creature — Human Knight', 'Whenever this creature deals combat damage to a player, that player gains control of this creature. If they do, you draw that many cards, create that many tapped Treasure tokens, then lose that much life.', ['3', '3']);
  it('is automated; the damaged player gains control, and you draw 3, create 3 tapped Treasures and lose 3 life', () => {
    expect(automated(KAIN)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Kain'] }, defs: [KAIN] });
    const kain = onBattlefield(s, 'Test Kain')[0]!;
    const hand0 = s.zones.hand['p1']!.length;
    s = attackWith(s, kain);
    expect(life(s, 'p2')).toBe(17);
    expect(s.objects[kain]!.controller).toBe('p2');
    expect(s.zones.hand['p1']!.length).toBe(hand0 + 3);
    const treasures = tokensNamed(s, 'Treasure');
    expect(treasures).toHaveLength(3);
    expect(treasures.every((id) => s.objects[id]!.tapped && s.objects[id]!.controller === 'p1')).toBe(true);
    expect(life(s, 'p1')).toBe(17);
  });
  it('if it left the battlefield before the trigger resolves, nobody gains control of it, and you get nothing (CR 400.7)', () => {
    const BOUNCE = card('Test Bounce', 'Instant', 'Return target creature to its owner\'s hand.');
    let s = scenario([], { p1: { battlefield: ['Test Kain'], hand: ['Test Bounce'] }, defs: [KAIN, BOUNCE] });
    const kain = onBattlefield(s, 'Test Kain')[0]!;
    s = passTo(s, (x) => x.pending?.kind === 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: kain, defender: 'p2' }] });
    s = passTo(s, (x) => x.turn.step === 'combatDamage' && x.zones.stack.length > 0 && x.pending?.kind === 'priority' && x.pending.player === 'p1');
    const hand0 = s.zones.hand['p1']!.length;
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bounce', 'hand', 'p1') }), { targets: [[obj(kain)]] });
    s = drain(s);
    expect(findAll(s, 'Test Kain', 'hand', 'p1')).toHaveLength(1);
    expect(s.zones.hand['p1']!.length).toBe(hand0); // the Bounce left the hand, Kain came back: no card drawn
    expect(tokensNamed(s, 'Treasure')).toHaveLength(0);
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 608.2c, 613.1b: "Target opponent gains control of another target permanent you control. If they do, you draw a card."', () => {
  const MOOGLE = card('Test Moogle', 'Legendary Creature — Moogle', '{T}: Target opponent gains control of another target permanent you control. If they do, you draw a card.', ['1', '2']);
  it('is automated; the opponent gains control of the permanent and you draw a card', () => {
    expect(automated(MOOGLE)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Moogle', 'Test Bear'] }, defs: [MOOGLE, BEAR] });
    const bear = onBattlefield(s, 'Test Bear')[0]!;
    const hand0 = s.zones.hand['p1']!.length;
    s = activate(s, onBattlefield(s, 'Test Moogle')[0]!, { targets: [[{ kind: 'player', id: 'p2' } as TargetChoice], [obj(bear)]] });
    expect(s.objects[bear]!.controller).toBe('p2');
    expect(s.zones.hand['p1']!.length).toBe(hand0 + 1);
  });
});

describe('CR 107.3, 601.2h, 608.2h: "you may draw X cards, where X is the amount of mana spent to cast that spell. If you do, discard two cards." (eff.fxz.draw.whereX)', () => {
  const LETTERS = card('Test Letters', 'Enchantment', 'Whenever you cast a noncreature spell, you may draw X cards, where X is the amount of mana spent to cast that spell. If you do, discard two cards.');
  const BIG = card('Test Big', 'Sorcery', 'You gain 1 life.', undefined, '{3}');
  it('is automated; three mana spent: you draw three, then discard two; declined, nothing', () => {
    expect(automated(LETTERS)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Big', 'Test Big'], battlefield: ['Test Letters', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'] }, defs: [LETTERS, BIG] });
    const hand0 = s.zones.hand['p1']!.length;
    s = cast(s, 'Test Big', { answers: [yes] });
    if (s.pending?.kind === 'chooseObjects') s = drain(answer(s, { kind: 'chooseObjects', ids: s.zones.hand['p1']!.filter((id) => s.objects[id]!.defId === 'Plains').slice(0, 2) }));
    expect(s.zones.hand['p1']!.length).toBe(hand0 - 1 + 3 - 2);
    const hand1 = s.zones.hand['p1']!.length;
    s = cast(s, 'Test Big', { answers: [{ kind: 'yesNo', yes: false }] });
    expect(s.zones.hand['p1']!.length).toBe(hand1 - 1);
  });
});

describe('CR 400.1, 404.1, 305.4: "draw a card, then you may put a land card from your hand or graveyard onto the battlefield." (a card in either zone)', () => {
  const PALL = card('Test Pall', 'Creature — Giant Scout', 'When this creature enters, draw a card, then you may put a land card from your hand or graveyard onto the battlefield.', ['2', '2']);
  it('is automated; a land card from the graveyard can be chosen, and so can one from the hand', () => {
    expect(automated(PALL)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Pall'], graveyard: ['Test Land'] }, defs: [PALL, LAND] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Pall', 'hand', 'p1') });
    for (let g = 0; g < 10 && s.pending?.kind !== 'chooseObjects'; g++) s = s.pending?.kind === 'payCost' ? answer(s, { kind: 'payCost', auto: true }) : pass(s);
    const options = (s.pending as unknown as { options: string[] }).options;
    const gy = find(s, 'Test Land', 'graveyard', 'p1');
    expect(options).toContain(gy);
    expect(options.some((id) => s.zones.hand['p1']!.includes(id))).toBe(true); // the card drawn (a Plains) is in the hand
    s = drain(answer(s, { kind: 'chooseObjects', ids: [gy] }));
    expect(onBattlefield(s, 'Test Land')).toHaveLength(1);
  });
});

describe('CR 608.2d, 110.2a: "Put up to X land cards from your hand and/or graveyard onto the battlefield tapped." (eff.fxz.put.upTo.battlefield.tapped)', () => {
  const RAGE = card('Test Rage', 'Sorcery', 'Put up to two land cards from your hand and/or graveyard onto the battlefield tapped.');
  it('is automated; one from the hand and one from the graveyard enter tapped, a nonland card is not offered', () => {
    expect(automated(RAGE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Rage', 'Test Land', 'Test Bear'], graveyard: ['Test Land'] }, defs: [RAGE, LAND, BEAR] });
    const fromHand = find(s, 'Test Land', 'hand', 'p1');
    const fromGy = find(s, 'Test Land', 'graveyard', 'p1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Rage', 'hand', 'p1') });
    for (let g = 0; g < 10 && s.pending?.kind !== 'chooseObjects'; g++) s = s.pending?.kind === 'payCost' ? answer(s, { kind: 'payCost', auto: true }) : pass(s);
    const options = (s.pending as unknown as { options: string[] }).options;
    expect(options).not.toContain(find(s, 'Test Bear', 'hand', 'p1'));
    s = drain(answer(s, { kind: 'chooseObjects', ids: [fromHand, fromGy] }));
    const lands = onBattlefield(s, 'Test Land');
    expect(lands).toHaveLength(2);
    expect(lands.every((id) => s.objects[id]!.tapped)).toBe(true);
  });
});

describe('CR 608.2c, 608.2d: "you may put a creature card and/or a land card from your hand onto the battlefield." (eff.fxz.put.eitherOr.fromHand.battlefield)', () => {
  const TURTLE = card('Test Turtle', 'Creature — Mutant Turtle', 'When this creature enters, you may put a creature card and/or a land card from your hand onto the battlefield.', ['3', '3']);
  it('is automated; one creature card and one land card go onto the battlefield, never two of one kind', () => {
    expect(automated(TURTLE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Turtle', 'Test Bear', 'Test Bear', 'Test Land'] }, defs: [TURTLE, BEAR, LAND] });
    s = cast(s, 'Test Turtle', { picks: [[find(s, 'Test Bear', 'hand', 'p1')], [find(s, 'Test Land', 'hand', 'p1')]] });
    expect(onBattlefield(s, 'Test Bear')).toHaveLength(1);
    expect(onBattlefield(s, 'Test Land')).toHaveLength(1);
    expect(findAll(s, 'Test Bear', 'hand', 'p1')).toHaveLength(1);
  });
});

describe('CR 603.6, 400.7, 122.6: "Until end of turn, target creature gains "When this creature dies, return it to the battlefield tapped under its owner\'s control with a +1/+1 counter on it.""', () => {
  const MALICE = card('Test Malice', 'Instant', 'Until end of turn, target creature gains "When this creature dies, return it to the battlefield tapped under its owner\'s control with a +1/+1 counter on it."');
  const SWAT = card('Test Swat', 'Instant', 'Destroy target creature.');
  it('is automated; the creature dies and comes back tapped with a +1/+1 counter', () => {
    expect(automated(MALICE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Malice', 'Test Swat'], battlefield: ['Test Bear'] }, defs: [MALICE, SWAT, BEAR] });
    const bear = onBattlefield(s, 'Test Bear')[0]!;
    s = cast(s, 'Test Malice', { targets: [[obj(bear)]] });
    s = cast(s, 'Test Swat', { targets: [[obj(bear)]] });
    const [back] = onBattlefield(s, 'Test Bear');
    expect(back).toBeDefined();
    expect(s.objects[back!]!.tapped).toBe(true);
    expect(s.objects[back!]!.counters['+1/+1']).toBe(1);
  });
});

describe('CR 701.21a, 608.2c: "Sacrifice any number of permanents you control, then draw that many cards." (the count is what was sacrificed)', () => {
  const CARNAGE = card('Test Carnage', 'Sorcery', 'Sacrifice any number of permanents you control, then draw that many cards.');
  it('is automated; two permanents sacrificed, two cards drawn', () => {
    expect(automated(CARNAGE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Carnage'], battlefield: ['Test Bear', 'Test Bear', 'Test Land'] }, defs: [CARNAGE, BEAR, LAND] });
    const bears = onBattlefield(s, 'Test Bear');
    const hand0 = s.zones.hand['p1']!.length;
    s = cast(s, 'Test Carnage', { picks: [bears] });
    expect(onBattlefield(s, 'Test Bear')).toHaveLength(0);
    expect(onBattlefield(s, 'Test Land')).toHaveLength(1);
    expect(s.zones.hand['p1']!.length).toBe(hand0 - 1 + 2);
  });
});

describe('CR 701.21a, 608.2c, 608.2h: "Sacrifice any number of artifacts, enchantments, and/or tokens. Return that many creature cards from your graveyard to the battlefield."', () => {
  const CONQUEST = card('Test Conquest', 'Sorcery', 'Sacrifice any number of artifacts, enchantments, and/or tokens. Return that many creature cards from your graveyard to the battlefield.');
  const RELIC = card('Test Relic', 'Artifact', '');
  it('is automated; two artifacts sacrificed return two creature cards, a creature you control is not offered for the sacrifice', () => {
    expect(automated(CONQUEST)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Conquest'], battlefield: ['Test Relic', 'Test Relic', 'Test Bear'], graveyard: ['Test Bear', 'Test Bear', 'Test Bear'] }, defs: [CONQUEST, RELIC, BEAR] });
    const relics = onBattlefield(s, 'Test Relic');
    const dead = findAll(s, 'Test Bear', 'graveyard', 'p1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Conquest', 'hand', 'p1') });
    for (let g = 0; g < 10 && s.pending?.kind !== 'chooseObjects'; g++) s = s.pending?.kind === 'payCost' ? answer(s, { kind: 'payCost', auto: true }) : pass(s);
    expect((s.pending as unknown as { options: string[] }).options).not.toContain(onBattlefield(s, 'Test Bear')[0]);
    s = answer(s, { kind: 'chooseObjects', ids: relics });
    s = drain(settle(s, { picks: [dead.slice(0, 2)] }), { picks: [dead.slice(0, 2)] });
    expect(onBattlefield(s, 'Test Relic')).toHaveLength(0);
    expect(onBattlefield(s, 'Test Bear')).toHaveLength(3);
    expect(findAll(s, 'Test Bear', 'graveyard', 'p1')).toHaveLength(1);
  });
});

describe('CR 404.1, 110.2a: "Put all creature cards from all graveyards onto the battlefield under your control."', () => {
  const RISE = card('Test Rise', 'Sorcery', 'Put all creature cards from all graveyards onto the battlefield under your control.');
  it('is automated; creature cards of both graveyards come under your control, a land card stays', () => {
    expect(automated(RISE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Rise'], graveyard: ['Test Bear', 'Test Land'] }, p2: { graveyard: ['Test Bear'] }, defs: [RISE, BEAR, LAND] });
    s = cast(s, 'Test Rise');
    const bears = onBattlefield(s, 'Test Bear');
    expect(bears).toHaveLength(2);
    expect(bears.every((id) => s.objects[id]!.controller === 'p1')).toBe(true);
    expect(findAll(s, 'Test Land', 'graveyard', 'p1')).toHaveLength(1);
  });
});

describe('CR 118.12, 608.2c, 701.20e: "you may pay {1}. If you do, look at the top two cards of your library. Put one of them into your hand and the other into your graveyard."', () => {
  const MARCHESA = card('Test Marchesa', 'Creature — Human Rogue', 'When this creature enters, you may pay {1}. If you do, look at the top two cards of your library. Put one of them into your hand and the other into your graveyard.', ['3', '3']);
  const no: DecisionAnswer = { kind: 'yesNo', yes: false };
  it('is automated; paying, one card goes to the hand and the other to the graveyard', () => {
    expect(automated(MARCHESA)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Marchesa'], battlefield: ['Plains'], library: ['Test Bear', 'Test Land'] }, defs: [MARCHESA, BEAR, LAND] });
    const [top, second] = s.zones.library['p1']!.slice(0, 2).map((id) => s.objects[id]!.defId);
    s = cast(s, 'Test Marchesa', { answers: [yes], picks: [[s.zones.library['p1']![0]!]] });
    expect(s.zones.hand['p1']!.map((id) => s.objects[id]!.defId)).toContain(top);
    expect(s.zones.graveyard['p1']!.map((id) => s.objects[id]!.defId)).toEqual([second]);
  });
  it('not paying, nothing is looked at or moved (the sentence after "If you do" goes with it)', () => {
    let s = scenario([], { p1: { hand: ['Test Marchesa'], battlefield: ['Plains'], library: ['Test Bear', 'Test Land'] }, defs: [MARCHESA, BEAR, LAND] });
    const lib0 = [...s.zones.library['p1']!];
    s = cast(s, 'Test Marchesa', { answers: [no] });
    expect(s.zones.library['p1']).toEqual(lib0);
    expect(s.zones.graveyard['p1']).toHaveLength(0);
  });
});

describe('CR 701.20a, 401.4: "reveal the top five cards of your library. Put all artifact cards from among them into your hand and the rest on the bottom of your library in a random order."', () => {
  const VENDRELL = card('Test Vendrell', 'Creature — Human Warlock', 'When this creature enters, reveal the top four cards of your library. Put all artifact cards from among them into your hand and the rest on the bottom of your library in a random order.', ['3', '3']);
  const RELIC = card('Test Relic', 'Artifact', '');
  it('is automated; both artifacts go to the hand, the other two revealed cards to the bottom, the rest of the library untouched', () => {
    expect(automated(VENDRELL)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Vendrell'], library: ['Test Relic', 'Test Bear', 'Test Relic', 'Test Land'] }, defs: [VENDRELL, RELIC, BEAR, LAND] });
    s = cast(s, 'Test Vendrell');
    expect(findAll(s, 'Test Relic', 'hand', 'p1')).toHaveLength(2);
    const lib = s.zones.library['p1']!;
    const bottom2 = lib.slice(-2).map((id) => s.objects[id]!.defId).sort();
    expect(bottom2).toEqual(['Test Bear', 'Test Land']);
    expect(s.objects[lib[0]!]!.defId).toBe('Plains');
  });
});

describe('CR 701.20e, 608.2d: "Look at the top X cards ... You may put any number of nonland permanent cards with mana value 3 or less from among them onto the battlefield. Then shuffle."', () => {
  const OUTLAND = card('Test Outland', 'Sorcery', 'Look at the top four cards of your library. You may put any number of nonland permanent cards with mana value 3 or less from among them onto the battlefield. Then shuffle.');
  const BIG = card('Test Big Bear', 'Creature — Bear', '', ['4', '4'], '{4}');
  const BOLT = card('Test Bolt', 'Instant', 'This spell deals 1 damage to any target.', undefined, '{1}');
  it('is automated; only a nonland permanent card with mana value 3 or less is offered, and those chosen enter', () => {
    expect(automated(OUTLAND)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Outland'], library: ['Test Bear', 'Test Big Bear', 'Test Bolt', 'Test Land'] }, defs: [OUTLAND, BEAR, BIG, BOLT, LAND] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Outland', 'hand', 'p1') });
    for (let g = 0; g < 10 && s.pending?.kind !== 'chooseObjects'; g++) s = s.pending?.kind === 'payCost' ? answer(s, { kind: 'payCost', auto: true }) : s.pending?.kind === 'yesNo' ? answer(s, yes) : pass(s);
    const options = (s.pending as unknown as { options: string[] }).options;
    const bear = find(s, 'Test Bear', 'library', 'p1');
    expect(options).toEqual([bear]);
    s = drain(answer(s, { kind: 'chooseObjects', ids: [bear] }));
    expect(onBattlefield(s, 'Test Bear')).toHaveLength(1);
    expect(findAll(s, 'Test Bolt', 'library', 'p1')).toHaveLength(1);
  });
});

describe('CR 603.7a, 513.1: "At the beginning of the end step on your next turn, sacrifice that token." (delay turn "later": not this turn\'s end step)', () => {
  const KAV = card('Test Kav', 'Creature — Kavu Soldier', 'When this creature enters, create a Clue token. At the beginning of the end step on your next turn, sacrifice that token.', ['2', '2']);
  it('is automated; the token survives this turn\'s end step and the opponent\'s, and is sacrificed at the end step of your next turn', () => {
    expect(automated(KAV)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Kav'] }, defs: [KAV] });
    s = cast(s, 'Test Kav');
    expect(tokensNamed(s, 'Clue')).toHaveLength(1);
    s = passTo(s, (x) => x.turn.number === 2 && x.turn.step === 'main1');
    expect(tokensNamed(s, 'Clue')).toHaveLength(1);
    s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'main1');
    expect(tokensNamed(s, 'Clue')).toHaveLength(1);
    s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'end' && x.zones.stack.length > 0);
    s = drain(s);
    expect(tokensNamed(s, 'Clue')).toHaveLength(0);
  });
});

describe('CR 701.21a: "Sacrifice all Spirits you control." (eff.fxz.sacrifice.all.youControl)', () => {
  const PURGE = card('Test Purge', 'Sorcery', 'Sacrifice all Bears you control.');
  it('is automated; your Bears are sacrificed, the opponent\'s stay', () => {
    expect(automated(PURGE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Purge'], battlefield: ['Test Bear', 'Test Bear', 'Test Land'] }, p2: { battlefield: ['Test Bear'] }, defs: [PURGE, BEAR, LAND] });
    s = cast(s, 'Test Purge');
    const bears = onBattlefield(s, 'Test Bear');
    expect(bears).toHaveLength(1);
    expect(s.objects[bears[0]!]!.controller).toBe('p2');
    expect(onBattlefield(s, 'Test Land')).toHaveLength(1);
  });
});

describe('CR 603.12, 608.2c: "you may sacrifice an artifact. When you do, put a +1/+1 counter on target creature and draw a card." (both in the reflexive trigger)', () => {
  const MECHAN = card('Test Mechan', 'Artifact Creature — Robot', 'When this creature enters, you may sacrifice an artifact. When you do, put a +1/+1 counter on target creature and draw a card.', ['2', '2']);
  const RELIC = card('Test Relic', 'Artifact', '');
  const no: DecisionAnswer = { kind: 'yesNo', yes: false };
  it('is automated; sacrificing, the counter and the card; declining, neither', () => {
    expect(automated(MECHAN)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Mechan'], battlefield: ['Test Relic', 'Test Bear'] }, defs: [MECHAN, RELIC, BEAR] });
    const bear = onBattlefield(s, 'Test Bear')[0]!;
    const hand0 = s.zones.hand['p1']!.length;
    s = cast(s, 'Test Mechan', { answers: [yes], picks: [[onBattlefield(s, 'Test Relic')[0]!]], targets: [[obj(bear)]] });
    expect(onBattlefield(s, 'Test Relic')).toHaveLength(0);
    expect(s.objects[bear]!.counters['+1/+1']).toBe(1);
    expect(s.zones.hand['p1']!.length).toBe(hand0 - 1 + 1);
    let n = scenario([], { p1: { hand: ['Test Mechan'], battlefield: ['Test Relic', 'Test Bear'] }, defs: [MECHAN, RELIC, BEAR] });
    const hand1 = n.zones.hand['p1']!.length;
    n = cast(n, 'Test Mechan', { answers: [no] });
    expect(onBattlefield(n, 'Test Relic')).toHaveLength(1);
    expect(n.zones.hand['p1']!.length).toBe(hand1 - 1);
  });
});

describe('CR 702.181a, 107.3, 608.2h: "Mobilize X, where X is the number of creature cards in your graveyard." (counted as the trigger resolves)', () => {
  const AVENGER = card('Test Avenger', 'Creature — Human Warrior', 'Mobilize X, where X is the number of creature cards in your graveyard.', ['2', '3']);
  it('is automated; with two creature cards in your graveyard, attacking creates two tapped and attacking Warriors, sacrificed at the next end step', () => {
    expect(automated(AVENGER)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Avenger'], graveyard: ['Test Bear', 'Test Bear', 'Test Land'] }, defs: [AVENGER, BEAR, LAND] });
    s = passTo(s, (x) => x.pending?.kind === 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: onBattlefield(s, 'Test Avenger')[0]!, defender: 'p2' }] });
    s = passTo(s, (x) => x.zones.stack.length > 0);
    s = drain(s);
    const warriors = tokensNamed(s, 'Warrior');
    expect(warriors).toHaveLength(2);
    expect(warriors.every((id) => s.objects[id]!.tapped)).toBe(true);
    s = passTo(s, (x) => x.turn.step === 'end' && x.zones.stack.length > 0);
    s = drain(s);
    expect(tokensNamed(s, 'Warrior')).toHaveLength(0);
  });
});

describe('CR 107.3, 603.2, 601.2b: "Whenever you cast a spell with {X} in its mana cost, look at the top X cards of your library." (the X of that spell)', () => {
  const ARTHROPOD = card('Test Arthropod', 'Creature — Fractal Crab', 'Whenever you cast a spell with {X} in its mana cost, look at the top X cards of your library. Put one of them into your hand and the rest on the bottom of your library in a random order.', ['1', '4']);
  const WAVE = card('Test Wave', 'Sorcery', 'You gain X life.', undefined, '{X}');
  it('is automated; cast with X = 3, the top three cards are looked at, one goes to the hand and two to the bottom', () => {
    expect(automated(ARTHROPOD)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Wave'], battlefield: ['Test Arthropod', 'Plains', 'Plains', 'Plains'], library: ['Test Bear', 'Test Land', 'Test Bear', 'Test Land'] }, defs: [ARTHROPOD, WAVE, BEAR, LAND] });
    const top3 = s.zones.library['p1']!.slice(0, 3);
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Wave', 'hand', 'p1') });
    for (let g = 0; g < 20 && s.pending?.kind !== 'chooseObjects'; g++) {
      if (s.pending?.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: 3 });
      else if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else s = pass(s);
    }
    const options = (s.pending as unknown as { options: string[] }).options;
    expect([...options].sort()).toEqual([...top3].sort());
    s = drain(answer(s, { kind: 'chooseObjects', ids: [top3[0]!] }));
    expect(life(s, 'p1')).toBe(23);
    const lib = s.zones.library['p1']!;
    expect(s.objects[lib[0]!]!.defId).toBe('Test Land'); // the fourth card is on top now
  });
});

describe('CR 302.6, 602.5a, 609.4: "You may activate abilities of creatures you control as though those creatures had haste." (sta.fxz.activate.asThoughHaste)', () => {
  const ELIXIR = card('Test Elixir', 'Artifact', 'You may activate abilities of creatures you control as though those creatures had haste.');
  const PINGER = card('Test Pinger', 'Creature — Human Wizard', '{T}: This creature deals 1 damage to target player.', ['1', '1']);
  const p2 = { kind: 'player', id: 'p2' } as TargetChoice;
  it('is automated; a creature that came under your control this turn may use its {T} ability, but still cannot attack', () => {
    expect(automated(ELIXIR)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Elixir', { name: 'Test Pinger', since: 1 }] }, defs: [ELIXIR, PINGER] });
    const pinger = onBattlefield(s, 'Test Pinger')[0]!;
    s = activate(s, pinger, { targets: [[p2]] });
    expect(life(s, 'p2')).toBe(19);
    s = passTo(s, (x) => x.pending?.kind === 'declareAttackers' || x.turn.step === 'end');
    const candidates = s.pending?.kind === 'declareAttackers' ? (s.pending as unknown as { candidates: { id: string }[] }).candidates.map((c) => c.id) : [];
    expect(candidates).not.toContain(pinger);
  });
  it('without it, the {T} ability of a creature that came under your control this turn is refused (CR 302.6)', () => {
    let s = scenario([], { p1: { battlefield: [{ name: 'Test Pinger', since: 1 }] }, defs: [PINGER] });
    const pinger = onBattlefield(s, 'Test Pinger')[0]!;
    expect(reject(s, { type: 'activate', player: 'p1', source: pinger, ability: 'p:0:0' }).rules).toContain('CR 302.6');
  });
});

describe('CR 404.1, 608.2h: "Draw a card for each graveyard with seven or more cards in it." (every player\'s graveyard is counted)', () => {
  const SAGE = card('Test Sage', 'Sorcery', 'Draw a card for each graveyard with seven or more cards in it.');
  it('is automated; your graveyard of seven and the opponent\'s of eight count, a graveyard of six does not', () => {
    expect(automated(SAGE)).toBe(true);
    const seven = Array.from({ length: 7 }, () => 'Test Bear');
    let s = scenario([], { p1: { hand: ['Test Sage'], graveyard: seven }, p2: { graveyard: [...seven, 'Test Bear'] }, defs: [SAGE, BEAR] });
    let hand0 = s.zones.hand['p1']!.length;
    s = cast(s, 'Test Sage');
    expect(s.zones.hand['p1']!.length).toBe(hand0 - 1 + 2);
    s = scenario([], { p1: { hand: ['Test Sage'], graveyard: seven.slice(1) }, p2: { graveyard: seven }, defs: [SAGE, BEAR] });
    hand0 = s.zones.hand['p1']!.length;
    s = cast(s, 'Test Sage');
    // the Sage itself is in the stack as it resolves, not the graveyard: six cards are not seven
    expect(s.zones.hand['p1']!.length).toBe(hand0 - 1 + 1);
  });
});

describe('CR 107.1a, 107.3, 121.1: "{X}, {T}: Draw half X cards, rounded down." and "rounded up"', () => {
  const DOWN = card('Test Down', 'Artifact', '{X}, {T}: Draw half X cards, rounded down.');
  const UP = card('Test Up', 'Artifact', '{X}, {T}: Draw half X cards, rounded up.');
  const run = (def: CardDef, x: number): number => {
    let s = scenario(['Plains'], { p1: { battlefield: [def.name, 'Plains', 'Plains', 'Plains'] }, defs: [def] });
    const hand0 = s.zones.hand['p1']!.length;
    s = settle(act(s, { type: 'activate', player: 'p1', source: onBattlefield(s, def.name)[0]!, ability: 'p:0:0' }), { answers: [{ kind: 'chooseNumber', n: x }] });
    s = drain(s);
    return s.zones.hand['p1']!.length - hand0;
  };
  it('are automated; X = 3 draws one card rounded down and two rounded up', () => {
    expect(automated(DOWN) && automated(UP)).toBe(true);
    expect(run(DOWN, 3)).toBe(1);
    expect(run(UP, 3)).toBe(2);
  });
});

describe('CR 121.1, 119.1, 115.1: "{T}: Target player draws two cards and gains 2 life." (the same player does both)', () => {
  const FONT = card('Test Font', 'Artifact', '{T}: Target player draws two cards and gains 2 life.');
  it('is automated; the opponent targeted draws two and gains 2, you do neither', () => {
    expect(automated(FONT)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Font'] }, defs: [FONT] });
    const [mine, theirs] = [s.zones.hand['p1']!.length, s.zones.hand['p2']!.length];
    s = activate(s, onBattlefield(s, 'Test Font')[0]!, { targets: [[{ kind: 'player', id: 'p2' } as TargetChoice]] });
    expect([s.zones.hand['p1']!.length, s.zones.hand['p2']!.length]).toEqual([mine, theirs + 2]);
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([20, 22]);
  });
});

describe('CR 701.24a, 401.1: "shuffle your hand and graveyard into your library, then draw five cards."', () => {
  const RESET = card('Test Reset', 'Sorcery', 'Shuffle your hand and graveyard into your library, then draw five cards.');
  it('is automated; hand and graveyard go into the library, then five cards are drawn', () => {
    expect(automated(RESET)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Reset', 'Test Bear', 'Test Bear'], graveyard: ['Test Land', 'Test Land', 'Test Land'] }, defs: [RESET, BEAR, LAND] });
    const total = s.zones.library['p1']!.length + 5;
    s = cast(s, 'Test Reset');
    expect(s.zones.graveyard['p1']!.map((id) => s.objects[id]!.defId)).toEqual(['Test Reset']);
    expect(s.zones.hand['p1']!.length).toBe(5);
    expect(s.zones.library['p1']!.length).toBe(total - 5);
  });
});

describe('CR 406.1, 608.2d: "you may exile one or more land cards from your graveyard." (the chosen cards, at least one)', () => {
  const DIGGER = card('Test Digger', 'Creature — Mole', 'When this creature enters, you may exile one or more land cards from your graveyard.', ['1', '1'], '{1}');
  it('is automated; the chosen land cards are exiled, the creature card stays', () => {
    expect(automated(DIGGER)).toBe(true);
    let s = scenario(['Plains'], { p1: { hand: ['Test Digger'], battlefield: ['Plains'], graveyard: ['Test Land', 'Test Land', 'Test Bear'] }, defs: [DIGGER, LAND, BEAR] });
    const lands = findAll(s, 'Test Land', 'graveyard', 'p1');
    s = cast(s, 'Test Digger', { answers: [yes], picks: [lands] });
    expect(findAll(s, 'Test Land', 'exile', 'p1')).toHaveLength(2);
    expect(findAll(s, 'Test Bear', 'graveyard', 'p1')).toHaveLength(1);
  });
});
