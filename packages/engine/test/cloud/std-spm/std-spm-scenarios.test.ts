/**
 * Cloud batch 2, slice std-spm (the Standard backlog of Marvel's Spider-Man, tuning half): the templates of parser/templates/zz-cloud/std-spm.json and the hole,
 * lowering, renderer and engine support they needed, played through the engine with synthetic cards compiled by the game's default compiler (invented names
 * and wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 700.9, 611.3a          "This creature has flying as long as it's modified."
 *   CR 115.1, 701.6b          "Counter target sorcery spell or triggered ability." (one target among several kinds of spells and abilities)
 *   CR 701.10e, 122.6         "Double the number of each kind of counter on target creature."
 *   CR 118.3, 122.1           "Remove two counters from ~: ..." (counters of any kinds as a cost)
 *   CR 101.2, 701.6           "Spells and abilities can't be countered."
 *   CR 615.12                 "Damage can't be prevented."
 *   CR 608.2d, 608.2e         "Each player may discard two cards. Each player who doesn't loses 4 life."
 *   CR 107.3, 608.2h, 118.12  "you may sacrifice another creature. If you do, draw X cards, then you may put a permanent card with mana value X or less ..."
 *   CR 105.2c, 613.1e         "{1}: ~ becomes colorless until end of turn." / "~ gains hexproof and becomes colorless until end of turn."
 *   CR 115.1, 400.7           "Exile any number of target players' graveyards."
 *   CR 613.1d, 613.4b         "Target noncreature artifact you control becomes an artifact creature with base power and toughness 2/5 until end of turn."
 *   CR 603.6a, 603.10         "When ~ enters from a graveyard, you gain 2 life."
 *   CR 603.2h                 "you may discard a card. If you do, draw a card. Do this only once each turn."
 *   CR 701.50a                "Whenever another Rogue you control enters, you may have it connive."
 *   CR 701.12a, 701.12c, 119.3 "you may exchange life totals with target opponent. If you lost life this way, draw that many cards."
 *   CR 601.2i, 603.4          "When ~ enters, if it was cast, ..."
 *   CR 615.1, 615.5           "If damage would be dealt to ~, prevent that damage and put that many +1/+1 counters on ~." / "... to you, ... mill twice that many cards."
 *   CR 305.1, 601.2a, 603.2   "Whenever you play a land from exile or cast a spell from exile, you gain 1 life."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, legal, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual (its level is checked by the template tests). */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && !JSON.stringify(d.faces).includes('"kind":"manual"');
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const plr = (id: PlayerId): TargetChoice => ({ kind: 'player', id });
const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const grave = (s: GameState, p: PlayerId): number => s.zones.graveyard[p]!.length;
const counters = (s: GameState, id: ObjectId): Record<string, number> => (s.objects[id]!.counters ?? {}) as Record<string, number>;

/**
 * Answer the decisions until priority: payments automatic, targets from `targets` in order, the answers of `answers` to the decisions of their kind in order
 * (a yes/no question with no answer left is "yes"; a choice of options or objects with none left takes the first allowed).
 */
function drive(s0: GameState, targets: TargetChoice[][] = [], answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const ts = [...targets];
  const as = [...answers];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    const k = as.findIndex((a) => a.kind === p.kind);
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: ts.shift() ?? [] });
    else if (k >= 0) s = answer(s, as.splice(k, 1)[0]!);
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, Math.max(p.min, Math.min(p.max, 1))) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
/** Pass priority until the stack is empty, answering what comes up as `drive` does. */
function resolveAll(s0: GameState, targets?: TargetChoice[][], answers?: DecisionAnswer[]): GameState {
  let s = drive(s0, targets, answers);
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), targets, answers);
  return s;
}
const cast = (s: GameState, name: string, targets?: TargetChoice[][], answers?: DecisionAnswer[], player: PlayerId = 'p1'): GameState =>
  resolveAll(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), targets, answers), targets, answers);
function activate(s: GameState, name: string, targets: TargetChoice[][] = [], answers: DecisionAnswer[] = []): GameState {
  const src = find(s, name, 'battlefield', 'p1');
  const a = legal(s, 'p1', 'activate').find((x) => x.object === src);
  if (a === undefined) throw new Error(`no activation of ${name}`);
  return resolveAll(drive(act(s, a.action), targets, answers), targets, answers);
}
const canActivate = (s: GameState, name: string): boolean => legal(s, 'p1', 'activate').some((x) => x.object === find(s, name, 'battlefield', 'p1'));

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const PEBBLE = card('Test Pebble', 'Artifact', '', { cost: '{2}' });
const BOULDER = card('Test Boulder', 'Artifact', '', { cost: '{3}' });
const SPARK = card('Test Spark', 'Instant', 'Test Spark deals 3 damage to any target.');

describe('CR 700.9, 611.3a: "This creature has flying as long as it\'s modified."', () => {
  const GLIDER = card('Test Glider', 'Creature — Spider', "This creature has flying as long as it's modified.", { pt: ['2', '2'] });
  it('is understood', () => expect(noManual(GLIDER)).toBe(true));
  it('CR 700.9: a counter makes it modified, so it flies; without one it does not', () => {
    const s = scenario([], { defs: [GLIDER], p1: { battlefield: ['Test Glider', { name: 'Test Glider', counters: { '+1/+1': 1 } }] } });
    const [plain, countered] = findAll(s, 'Test Glider', 'battlefield', 'p1');
    expect(hasKeyword(getChars(s, plain!)!, 'flying')).toBe(false);
    expect(hasKeyword(getChars(s, countered!)!, 'flying')).toBe(true);
  });
});

describe('CR 115.1, 701.6b: "Counter target sorcery spell or triggered ability."', () => {
  const SNUFF = card('Test Snuff', 'Instant', 'Counter target sorcery spell or triggered ability.');
  const GREETER = card('Test Greeter', 'Creature — Human', 'When ~ enters, you gain 3 life.', { pt: ['1', '1'] });
  it('is understood', () => expect(noManual(SNUFF)).toBe(true));
  it('CR 701.6b: the triggered ability is countered: it does nothing', () => {
    const s0 = scenario([], { defs: [SNUFF, GREETER], p1: { hand: ['Test Greeter'] }, p2: { hand: ['Test Snuff'] } });
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Greeter', 'hand', 'p1') }));
    s = drive(pass(pass(s))); // the creature resolves; its enters trigger goes on the stack
    expect(s.zones.stack.length).toBe(1);
    const trigger = s.zones.stack[s.zones.stack.length - 1]!;
    s = pass(s); // p1 passes, p2 has priority
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Snuff', 'hand', 'p2') }), [[obj(trigger)]]);
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(20);
  });
  it('CR 115.1: a creature spell is not one of the kinds the target may be', () => {
    const s0 = scenario([], { defs: [SNUFF, GREETER], p1: { hand: ['Test Greeter'] }, p2: { hand: ['Test Snuff'] } });
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Greeter', 'hand', 'p1') }));
    s = pass(s); // p2 has priority with only the creature spell on the stack
    expect(legal(s, 'p2', 'cast').some((x) => x.object === find(s, 'Test Snuff', 'hand', 'p2'))).toBe(false);
  });
});

describe('CR 701.10e, 122.6: "Double the number of each kind of counter on target creature."', () => {
  const DOUBLER = card('Test Doubler', 'Sorcery', 'Double the number of each kind of counter on target creature.');
  it('is understood', () => expect(noManual(DOUBLER)).toBe(true));
  it('CR 701.10e: each kind is doubled: two +1/+1 counters become four and one charge counter two', () => {
    const s0 = scenario([], { defs: [DOUBLER, BEAR], p1: { hand: ['Test Doubler'], battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 2, charge: 1 } }] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = cast(s0, 'Test Doubler', [[obj(bear)]]);
    expect(counters(s, bear)).toEqual({ '+1/+1': 4, charge: 2 });
  });
  it('CR 701.10e: an object without counters gets none', () => {
    const s0 = scenario([], { defs: [DOUBLER, BEAR], p1: { hand: ['Test Doubler'], battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = cast(s0, 'Test Doubler', [[obj(bear)]]);
    expect(Object.values(counters(s, bear)).filter((n) => n > 0)).toEqual([]);
  });
});

describe('CR 118.3, 122.1: "Remove two counters from ~: Draw a card." (counters of any kinds as a cost)', () => {
  const BATTERY = card('Test Battery', 'Artifact', 'Remove two counters from ~: Draw a card.');
  it('is understood', () => expect(noManual(BATTERY)).toBe(true));
  it('CR 118.3: one counter of each of two kinds pays it', () => {
    const s0 = scenario([], { defs: [BATTERY], p1: { battlefield: [{ name: 'Test Battery', counters: { charge: 1, oil: 1 } }] } });
    const h = hand(s0, 'p1');
    const s = activate(s0, 'Test Battery');
    expect(Object.values(counters(s, find(s, 'Test Battery', 'battlefield', 'p1'))).filter((n) => n > 0)).toEqual([]);
    expect(hand(s, 'p1')).toBe(h + 1);
  });
  it('CR 118.3: with one counter the cost cannot be paid, so the ability cannot be activated', () => {
    const s = scenario([], { defs: [BATTERY], p1: { battlefield: [{ name: 'Test Battery', counters: { charge: 1 } }] } });
    expect(canActivate(s, 'Test Battery')).toBe(false);
  });
});

describe('CR 101.2, 701.6: "Spells and abilities can\'t be countered."', () => {
  const BASTION = card('Test Bastion', 'Enchantment', "Spells and abilities can't be countered.");
  const NEGATE = card('Test Negate', 'Instant', 'Counter target spell.');
  const SNUFF = card('Test Snuff', 'Instant', 'Counter target sorcery spell or triggered ability.');
  const GREETER = card('Test Greeter', 'Creature — Human', 'When ~ enters, you gain 3 life.', { pt: ['1', '1'] });
  it('is understood', () => expect(noManual(BASTION)).toBe(true));
  it('CR 101.2: a counterspell does not counter a spell, and a triggered ability is not countered either', () => {
    const s0 = scenario([], { defs: [BASTION, NEGATE, SNUFF, GREETER], p1: { hand: ['Test Greeter'], battlefield: ['Test Bastion'] }, p2: { hand: ['Test Negate', 'Test Snuff'] } });
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Greeter', 'hand', 'p1') }));
    const spell = s.zones.stack[0]!;
    s = pass(s);
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Negate', 'hand', 'p2') }), [[obj(spell)]]);
    s = drive(pass(pass(s))); // Test Negate resolves and does nothing
    s = drive(pass(pass(s))); // the creature resolves; its trigger goes on the stack
    expect(findAll(s, 'Test Greeter', 'battlefield', 'p1')).toHaveLength(1);
    const trigger = s.zones.stack[s.zones.stack.length - 1]!;
    s = pass(s);
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Snuff', 'hand', 'p2') }), [[obj(trigger)]]);
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(23);
  });
});

describe('CR 615.12: "Damage can\'t be prevented."', () => {
  const FURY = card('Test Fury', 'Enchantment', "Damage can't be prevented.");
  const WALL = card('Test Warden', 'Creature — Wall', 'Prevent all damage that would be dealt to ~.', { pt: ['0', '3'] });
  it('is understood', () => expect(noManual(FURY)).toBe(true));
  it('CR 615.12: the prevention effect does not apply: 3 damage destroys the 0/3', () => {
    const base = scenario([], { defs: [WALL, SPARK], p1: { hand: ['Test Spark'] }, p2: { battlefield: ['Test Warden'] } });
    const kept = cast(base, 'Test Spark', [[obj(find(base, 'Test Warden', 'battlefield', 'p2'))]]);
    expect(findAll(kept, 'Test Warden', 'battlefield', 'p2')).toHaveLength(1);
    const s0 = scenario([], { defs: [FURY, WALL, SPARK], p1: { hand: ['Test Spark'], battlefield: ['Test Fury'] }, p2: { battlefield: ['Test Warden'] } });
    const s = cast(s0, 'Test Spark', [[obj(find(s0, 'Test Warden', 'battlefield', 'p2'))]]);
    expect(findAll(s, 'Test Warden', 'battlefield', 'p2')).toHaveLength(0);
  });
});

describe('CR 608.2d, 608.2e: "Each player may discard two cards. Each player who doesn\'t loses 4 life."', () => {
  const TOLL = card('Test Toll', 'Sorcery', "Each player may discard two cards. Each player who doesn't loses 4 life.");
  it('is understood', () => expect(noManual(TOLL)).toBe(true));
  it('CR 608.2e: the player who discards loses no life; the player who does not loses 4', () => {
    const s0 = scenario([], { defs: [TOLL, BEAR], p1: { hand: ['Test Toll', 'Test Bear', 'Test Bear'] }, p2: { hand: ['Test Bear', 'Test Bear'] } });
    const s = cast(s0, 'Test Toll', [], [{ kind: 'yesNo', yes: true }, { kind: 'yesNo', yes: false }, { kind: 'chooseObjects', ids: findAll(s0, 'Test Bear', 'hand', 'p1') }]);
    expect(life(s, 'p1')).toBe(20);
    expect(hand(s, 'p1')).toBe(0);
    expect(life(s, 'p2')).toBe(16);
    expect(hand(s, 'p2')).toBe(2);
  });
});

describe('CR 107.3, 608.2h, 118.12: "you may sacrifice another creature. If you do, draw X cards, then you may put a permanent card with mana value X or less ..."', () => {
  const SYMBIOTE = card('Test Symbiote', 'Creature — Symbiote', "When ~ enters, you may sacrifice another creature. If you do, draw X cards, then you may put a permanent card with mana value X or less from your hand onto the battlefield, where X is the sacrificed creature's power.", { pt: ['3', '3'] });
  it('is understood', () => expect(noManual(SYMBIOTE)).toBe(true));
  it('CR 608.2h: X is the sacrificed creature\'s power (2): two cards are drawn and a card of mana value 2 may enter, one of mana value 3 is not offered', () => {
    const s0 = scenario([], { defs: [SYMBIOTE, BEAR, PEBBLE, BOULDER], p1: { hand: ['Test Symbiote', 'Test Pebble', 'Test Boulder'], battlefield: ['Test Bear'] } });
    const pebble = find(s0, 'Test Pebble', 'hand', 'p1');
    const boulder = find(s0, 'Test Boulder', 'hand', 'p1');
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Symbiote', 'hand', 'p1') }));
    s = pass(pass(pass(pass(s)))); // the creature resolves, then its enters trigger resolves
    expect(s.pending?.kind).toBe('yesNo'); // CR 118.12: the optional sacrifice
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(s.pending?.kind).toBe('chooseObjects');
    const offered = s.pending?.kind === 'chooseObjects' ? [...s.pending.options] : [];
    expect(offered).toContain(pebble);
    expect(offered).not.toContain(boulder);
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [pebble] }));
    expect(findAll(s, 'Test Bear', 'graveyard', 'p1')).toHaveLength(1);
    expect(s.objects[pebble]).toBeUndefined(); // CR 400.7: it is a new object on the battlefield
    expect(findAll(s, 'Test Pebble', 'battlefield', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Test Boulder', 'hand', 'p1')).toHaveLength(1);
    expect(hand(s, 'p1')).toBe(1 + 2); // Test Boulder and the two cards drawn
  });
  it('CR 118.12: without the sacrifice nothing else happens', () => {
    const s0 = scenario([], { defs: [SYMBIOTE, BEAR, PEBBLE], p1: { hand: ['Test Symbiote', 'Test Pebble'], battlefield: ['Test Bear'] } });
    const s = cast(s0, 'Test Symbiote', [], [{ kind: 'yesNo', yes: false }]);
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1')).toHaveLength(1);
    expect(hand(s, 'p1')).toBe(1);
  });
});

describe('CR 105.2c, 613.1e, 613.1f: "~ becomes colorless until end of turn." / "~ gains hexproof and becomes colorless until end of turn."', () => {
  const CHAMELEON = card('Test Chameleon', 'Creature — Lizard', '{1}: ~ becomes colorless until end of turn.', { pt: ['2', '2'], cost: '{G}', colors: ['G'] });
  const SHADE = card('Test Shade', 'Creature — Spider', '{2}: ~ gains hexproof and becomes colorless until end of turn.', { pt: ['2', '2'], cost: '{R}', colors: ['R'] });
  it('is understood', () => {
    expect(noManual(CHAMELEON)).toBe(true);
    expect(noManual(SHADE)).toBe(true);
  });
  it('CR 105.2c: the green creature has no color until end of turn', () => {
    const s0 = scenario([], { defs: [CHAMELEON], p1: { battlefield: ['Test Chameleon', 'Plains'] } });
    const id = find(s0, 'Test Chameleon', 'battlefield', 'p1');
    expect(getChars(s0, id)!.colors).toEqual(['G']);
    const s = activate(s0, 'Test Chameleon');
    expect(getChars(s, id)!.colors).toEqual([]);
  });
  it('CR 613.1e-f: one activation makes it colorless and gives it hexproof', () => {
    const s0 = scenario([], { defs: [SHADE], p1: { battlefield: ['Test Shade', 'Plains', 'Plains'] } });
    const id = find(s0, 'Test Shade', 'battlefield', 'p1');
    const s = activate(s0, 'Test Shade');
    expect(getChars(s, id)!.colors).toEqual([]);
    expect(hasKeyword(getChars(s, id)!, 'hexproof')).toBe(true);
  });
});

describe('CR 115.1, 400.7: "Exile any number of target players\' graveyards."', () => {
  const PURGE = card('Test Purge', 'Sorcery', "Exile any number of target players' graveyards.");
  it('is understood', () => expect(noManual(PURGE)).toBe(true));
  it('CR 115.1: both chosen players\' graveyards are exiled; with one chosen, the other graveyard stays', () => {
    const both0 = scenario([], { defs: [PURGE, BEAR], p1: { hand: ['Test Purge'], graveyard: ['Test Bear'] }, p2: { graveyard: ['Test Bear', 'Test Bear'] } });
    const both = cast(both0, 'Test Purge', [[plr('p1'), plr('p2')]]);
    expect(grave(both, 'p1')).toBe(1); // only the resolved Test Purge itself
    expect(grave(both, 'p2')).toBe(0);
    expect(both.zones.exile.length).toBe(3);
    const one0 = scenario([], { defs: [PURGE, BEAR], p1: { hand: ['Test Purge'], graveyard: ['Test Bear'] }, p2: { graveyard: ['Test Bear', 'Test Bear'] } });
    const one = cast(one0, 'Test Purge', [[plr('p2')]]);
    expect(findAll(one, 'Test Bear', 'graveyard', 'p1')).toHaveLength(1);
    expect(grave(one, 'p2')).toBe(0);
  });
});

describe('CR 613.1d, 613.4b: "Target noncreature artifact you control becomes an artifact creature with base power and toughness 2/5 until end of turn."', () => {
  const ANIMATOR = card('Test Animator', 'Enchantment', '{1}: Target noncreature artifact you control becomes an artifact creature with base power and toughness 2/5 until end of turn.');
  it('is understood', () => expect(noManual(ANIMATOR)).toBe(true));
  it('CR 613.1d, 613.4b: the artifact is a 2/5 artifact creature until end of turn', () => {
    const s0 = scenario([], { defs: [ANIMATOR, PEBBLE], p1: { battlefield: ['Test Animator', 'Test Pebble', 'Plains'] } });
    const pebble = find(s0, 'Test Pebble', 'battlefield', 'p1');
    const s = activate(s0, 'Test Animator', [[obj(pebble)]]);
    const c = getChars(s, pebble)!;
    expect(c.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect([Number(c.power), Number(c.toughness)]).toEqual([2, 5]);
  });
});

describe('CR 603.6a, 603.10: "When ~ enters from a graveyard, you gain 2 life."', () => {
  const PHOENIX = card('Test Phoenix', 'Creature — Phoenix', 'When ~ enters from a graveyard, you gain 2 life.', { pt: ['2', '2'] });
  const RAISE = card('Test Raise', 'Sorcery', 'Return target creature card from your graveyard to the battlefield.');
  it('is understood', () => expect(noManual(PHOENIX)).toBe(true));
  it('CR 603.6a: it triggers when it is returned from the graveyard, not when it is cast from the hand', () => {
    const g0 = scenario([], { defs: [PHOENIX, RAISE], p1: { hand: ['Test Raise'], graveyard: ['Test Phoenix'] } });
    const g = cast(g0, 'Test Raise', [[obj(find(g0, 'Test Phoenix', 'graveyard', 'p1'))]]);
    expect(findAll(g, 'Test Phoenix', 'battlefield', 'p1')).toHaveLength(1);
    expect(life(g, 'p1')).toBe(22);
    const h = cast(scenario([], { defs: [PHOENIX], p1: { hand: ['Test Phoenix'] } }), 'Test Phoenix');
    expect(findAll(h, 'Test Phoenix', 'battlefield', 'p1')).toHaveLength(1);
    expect(life(h, 'p1')).toBe(20);
  });
});

describe('CR 603.2h: "Whenever another creature you control enters, you may discard a card. If you do, draw a card. Do this only once each turn."', () => {
  const TINKER = card('Test Tinker', 'Creature — Goblin', 'Whenever another creature you control enters, you may discard a card. If you do, draw a card. Do this only once each turn.', { pt: ['1', '1'] });
  it('is understood', () => expect(noManual(TINKER)).toBe(true));
  it('CR 603.2h: after the action was taken this turn, the second creature does not offer it again', () => {
    const s0 = scenario([], { defs: [TINKER, BEAR, PEBBLE], p1: { hand: ['Test Bear', 'Test Bear', 'Test Pebble'], battlefield: ['Test Tinker'] } });
    const [b1, b2] = findAll(s0, 'Test Bear', 'hand', 'p1');
    let s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: b1! })), [], [{ kind: 'yesNo', yes: true }, { kind: 'chooseObjects', ids: [find(s0, 'Test Pebble', 'hand', 'p1')] }]);
    expect(findAll(s, 'Test Pebble', 'graveyard', 'p1')).toHaveLength(1); // discarded, then a card drawn
    expect(hand(s, 'p1')).toBe(2);
    let asked = 0;
    s = drive(act(s, { type: 'cast', player: 'p1', card: b2! }));
    for (let i = 0; i < 16 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); i++) {
      if (s.pending?.kind === 'yesNo') { asked++; s = answer(s, { kind: 'yesNo', yes: true }); } else s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    }
    expect(asked).toBe(0);
    expect(hand(s, 'p1')).toBe(1);
  });
  it('CR 603.2h: a declined offer is no action taken: the next creature offers it again', () => {
    const s0 = scenario([], { defs: [TINKER, BEAR, PEBBLE], p1: { hand: ['Test Bear', 'Test Bear', 'Test Pebble'], battlefield: ['Test Tinker'] } });
    const [b1, b2] = findAll(s0, 'Test Bear', 'hand', 'p1');
    let s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: b1! })), [], [{ kind: 'yesNo', yes: false }]);
    expect(hand(s, 'p1')).toBe(2);
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: b2! })), [], [{ kind: 'yesNo', yes: true }, { kind: 'chooseObjects', ids: [find(s0, 'Test Pebble', 'hand', 'p1')] }]);
    expect(findAll(s, 'Test Pebble', 'graveyard', 'p1')).toHaveLength(1);
  });
});

describe('CR 701.50a: "Whenever another Rogue you control enters, you may have it connive."', () => {
  const SCHEMER = card('Test Schemer', 'Creature — Human', 'Whenever another Rogue you control enters, you may have it connive.', { pt: ['1', '1'] });
  const ROGUE = card('Test Rogue', 'Creature — Human Rogue', '', { pt: ['1', '1'] });
  it('is understood', () => expect(noManual(SCHEMER)).toBe(true));
  it('CR 701.50a: its controller draws, discards a nonland card, and a +1/+1 counter is put on the Rogue', () => {
    const s0 = scenario([], { defs: [SCHEMER, ROGUE, PEBBLE], p1: { hand: ['Test Rogue', 'Test Pebble'], battlefield: ['Test Schemer'] } });
    const s = cast(s0, 'Test Rogue', [], [{ kind: 'yesNo', yes: true }, { kind: 'chooseObjects', ids: [find(s0, 'Test Pebble', 'hand', 'p1')] }]);
    const rogue = find(s, 'Test Rogue', 'battlefield', 'p1');
    expect(findAll(s, 'Test Pebble', 'graveyard', 'p1')).toHaveLength(1);
    expect(counters(s, rogue)['+1/+1']).toBe(1);
  });
});

describe('CR 701.12a, 701.12c, 119.3: "you may exchange life totals with target opponent. If you lost life this way, draw that many cards."', () => {
  const INVERTER = card('Test Inverter', 'Creature — Human', 'When ~ enters, you may exchange life totals with target opponent. If you lost life this way, draw that many cards.', { pt: ['2', '2'] });
  const withLife = (s: GameState, p1: number, p2: number): GameState => {
    s.players.find((p) => p.id === 'p1')!.life = p1;
    s.players.find((p) => p.id === 'p2')!.life = p2;
    return s;
  };
  it('is understood', () => expect(noManual(INVERTER)).toBe(true));
  it('CR 701.12c: 20 and 14 become 14 and 20; you lost 6 life, so you draw six cards', () => {
    const s0 = withLife(scenario([], { defs: [INVERTER], p1: { hand: ['Test Inverter'] } }), 20, 14);
    const s = cast(s0, 'Test Inverter', [[plr('p2')]], [{ kind: 'yesNo', yes: true }]);
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([14, 20]);
    expect(hand(s, 'p1')).toBe(6);
  });
  it('CR 119.3: when you gain life in the exchange you lost none, so you draw nothing', () => {
    const s0 = withLife(scenario([], { defs: [INVERTER], p1: { hand: ['Test Inverter'] } }), 10, 20);
    const s = cast(s0, 'Test Inverter', [[plr('p2')]], [{ kind: 'yesNo', yes: true }]);
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([20, 10]);
    expect(hand(s, 'p1')).toBe(0);
  });
  it('CR 608.2d: declining the exchange changes nothing and draws nothing', () => {
    const s0 = withLife(scenario([], { defs: [INVERTER], p1: { hand: ['Test Inverter'] } }), 20, 14);
    const s = cast(s0, 'Test Inverter', [[plr('p2')]], [{ kind: 'yesNo', yes: false }]);
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([20, 14]);
    expect(hand(s, 'p1')).toBe(0);
  });
});

describe('CR 601.2i, 603.4: "When ~ enters, if it was cast, return target creature card from your graveyard to the battlefield."', () => {
  const HEALER = card('Test Healer', 'Creature — Cleric', 'When ~ enters, if it was cast, return target creature card from your graveyard to the battlefield.', { pt: ['2', '2'] });
  const RAISE = card('Test Raise', 'Sorcery', 'Return target creature card from your graveyard to the battlefield.');
  it('is understood', () => expect(noManual(HEALER)).toBe(true));
  it('CR 601.2i: cast from the hand, it returns the creature card', () => {
    const s0 = scenario([], { defs: [HEALER, BEAR], p1: { hand: ['Test Healer'], graveyard: ['Test Bear'] } });
    const s = cast(s0, 'Test Healer', [[obj(find(s0, 'Test Bear', 'graveyard', 'p1'))]]);
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1')).toHaveLength(1);
  });
  it('CR 603.4: put onto the battlefield without being cast, the ability does not trigger', () => {
    const s0 = scenario([], { defs: [HEALER, BEAR, RAISE], p1: { hand: ['Test Raise'], graveyard: ['Test Healer', 'Test Bear'] } });
    const s = cast(s0, 'Test Raise', [[obj(find(s0, 'Test Healer', 'graveyard', 'p1'))], [obj(find(s0, 'Test Bear', 'graveyard', 'p1'))]]);
    expect(findAll(s, 'Test Healer', 'battlefield', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Test Bear', 'graveyard', 'p1')).toHaveLength(1);
  });
});

describe('CR 615.1, 615.5: "If damage would be dealt to ~, prevent that damage and put that many +1/+1 counters on ~." / "... to you, ... mill twice that many cards."', () => {
  const SPONGE = card('Test Sponge', 'Creature — Ooze', 'If damage would be dealt to ~, prevent that damage and put that many +1/+1 counters on ~.', { pt: ['0', '2'] });
  const MOURNER = card('Test Mourner', 'Creature — Angel', 'If damage would be dealt to you, prevent that damage and mill twice that many cards.', { pt: ['2', '2'] });
  it('is understood', () => {
    expect(noManual(SPONGE)).toBe(true);
    expect(noManual(MOURNER)).toBe(true);
  });
  it('CR 615.5: the 3 damage is prevented and three +1/+1 counters are put on it', () => {
    const s0 = scenario([], { defs: [SPONGE, SPARK], p1: { hand: ['Test Spark'], battlefield: ['Test Sponge'] } });
    const sponge = find(s0, 'Test Sponge', 'battlefield', 'p1');
    const s = cast(s0, 'Test Spark', [[obj(sponge)]]);
    expect(s.objects[sponge]!.damage).toBe(0);
    expect(counters(s, sponge)['+1/+1']).toBe(3);
  });
  it('CR 615.5: 3 damage to you is prevented and you mill six cards', () => {
    const s0 = scenario([], { defs: [MOURNER, SPARK], p1: { hand: ['Test Spark'], battlefield: ['Test Mourner'] } });
    const s = cast(s0, 'Test Spark', [[plr('p1')]]);
    expect(life(s, 'p1')).toBe(20);
    expect(grave(s, 'p1')).toBe(1 + 6); // Test Spark and the six milled cards
  });
});

describe('CR 305.1, 601.2a, 603.2: "Whenever you play a land from exile or cast a spell from exile, you gain 1 life."', () => {
  const PORTAL = card('Test Portal', 'Enchantment', 'Whenever you play a land from exile or cast a spell from exile, you gain 1 life.');
  const GLIMPSE = card('Test Glimpse', 'Sorcery', 'Exile the top card of your library. You may play that card this turn.');
  it('is understood', () => expect(noManual(PORTAL)).toBe(true));
  it('CR 305.1: a land played from exile triggers it; a land played from the hand does not', () => {
    const s0 = scenario([], { defs: [PORTAL, GLIMPSE], p1: { hand: ['Test Glimpse', 'Plains'], battlefield: ['Test Portal'] } });
    let s = cast(s0, 'Test Glimpse');
    const exiled = s.zones.exile.find((id) => s.objects[id]!.defId === 'Plains')!;
    expect(exiled).toBeDefined();
    s = resolveAll(act(s, { type: 'playLand', player: 'p1', card: exiled }));
    expect(life(s, 'p1')).toBe(21);
    const h0 = scenario([], { defs: [PORTAL], p1: { hand: ['Plains'], battlefield: ['Test Portal'] } });
    const h = resolveAll(act(h0, { type: 'playLand', player: 'p1', card: find(h0, 'Plains', 'hand', 'p1') }));
    expect(life(h, 'p1')).toBe(20);
  });
  it('CR 601.2a: a spell cast from exile triggers it', () => {
    const s0 = scenario([], { defs: [PORTAL, GLIMPSE, BEAR], p1: { hand: ['Test Glimpse'], library: ['Test Bear'], battlefield: ['Test Portal'] } });
    let s = cast(s0, 'Test Glimpse');
    const exiled = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Bear')!;
    expect(exiled).toBeDefined();
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: exiled })));
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1')).toHaveLength(1);
    expect(life(s, 'p1')).toBe(21);
  });
});
