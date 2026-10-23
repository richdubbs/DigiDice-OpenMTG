/**
 * Standard round 5, slice r5-refs (references and durations: the mechanisms r4-refs skipped): the shapes of this slice played through applyAction with synthetic
 * cards compiled by the game's default compiler (invented wordings, design 6.10). Nothing is mocked. Each describe names the rules it pins.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, legal, life, pass, scenario, zoneNames } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual node). */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

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
/** Pass to the declare attackers decision of turn `turn`. */
const toAttack = (s: GameState, turn: number): GameState => passTo(s, (x) => x.turn.number === turn && x.pending?.kind === 'declareAttackers');
const power = (s: GameState, id: ObjectId): number => Number(getChars(s, id).power);
const keywords = (s: GameState, id: ObjectId): string[] => getChars(s, id).abilities.map((a) => (a.def as { keyword?: string }).keyword ?? '');

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}{G}');
const OX = card('Test Ox', 'Creature — Ox', '', ['1', '4'], '{1}{W}');
const GIANT = card('Test Giant', 'Creature — Giant', '', ['4', '4'], '{3}{R}');
const CUB = card('Test Cub', 'Creature — Bear', '', ['1', '1']);
const TRINKET = card('Test Trinket', 'Artifact', '', undefined, '{1}');
const ENGINE = card('Test Engine', 'Artifact', '', undefined, '{4}');

describe('CR 701.23a, 608.2c, 608.2d: "you may search your library for an artifact card and reveal it. Put it onto the battlefield if <cond>. Otherwise, put it into your hand."', () => {
  const SCOUT = card('Test Scout', 'Creature — Human Scout', 'When this creature enters, you may search your library for an artifact card and reveal it. Put it onto the battlefield if its mana value is 2 or less. Otherwise, put it into your hand. If you search your library this way, shuffle.', ['1', '1']);
  it('is automated: the found card is "it" (the discourse focus of a search for one card); declined, it names nothing (r3-dig declinedNames, wave 8 merge)', () => {
    expect(automated(SCOUT)).toBe(true);
    const steps = JSON.stringify(SCOUT.faces[0]!.abilities[0]);
    expect(steps).toContain('"op":"may"');
    // the conditional move comes after the search (wave 8 merge: after your own option, not inside it; control.ts#declinedNames, CR 608.2b)
    expect(steps.indexOf('"op":"search"')).toBeLessThan(steps.indexOf('"op":"if"'));
  });
  it('a found card of mana value 2 or less is put onto the battlefield', () => {
    let s = scenario([], { p1: { hand: ['Test Scout'], library: ['Test Trinket', 'Test Engine'] }, defs: [SCOUT, TRINKET, ENGINE] });
    s = cast(s, 'Test Scout', { answers: [{ kind: 'yesNo', yes: true }], picks: [[find(s, 'Test Trinket', 'library', 'p1')]] });
    expect(findAll(s, 'Test Trinket', 'battlefield')).toHaveLength(1);
    expect(zoneNames(s, 'hand', 'p1')).toEqual([]);
  });
  it('a found card of greater mana value goes to the hand ("Otherwise")', () => {
    let s = scenario([], { p1: { hand: ['Test Scout'], library: ['Test Trinket', 'Test Engine'] }, defs: [SCOUT, TRINKET, ENGINE] });
    s = cast(s, 'Test Scout', { answers: [{ kind: 'yesNo', yes: true }], picks: [[find(s, 'Test Engine', 'library', 'p1')]] });
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Engine']);
    expect(findAll(s, 'Test Engine', 'battlefield')).toHaveLength(0);
  });
  it('with no search there is no card: nothing moves and the library is not shuffled', () => {
    let s = scenario([], { p1: { hand: ['Test Scout'], library: ['Test Trinket', 'Test Engine'] }, defs: [SCOUT, TRINKET, ENGINE] });
    const before = [...s.zones.library.p1!];
    s = cast(s, 'Test Scout', { answers: [{ kind: 'yesNo', yes: false }] });
    expect(findAll(s, 'Test Scout', 'battlefield')).toHaveLength(1);
    expect(s.zones.library.p1).toEqual(before);
    expect(zoneNames(s, 'hand', 'p1')).toEqual([]);
  });
});

describe('CR 603.7b, 611.2a, 500.1: "Until your next turn, whenever ..., ..." (a delayed trigger that triggers every time until its controller\'s next turn begins)', () => {
  const WARD = card('Test Ward', 'Instant', 'Until your next turn, whenever a creature attacks you or a planeswalker you control, it gets -2/-0 until end of turn.');
  const HOWL = card('Test Howl', 'Instant', 'Until your next turn, whenever one or more creatures attack one of your opponents, those creatures get +2/+2 and gain trample until end of turn.');
  it('is automated', () => {
    expect(automated(WARD)).toBe(true);
    expect(automated(HOWL)).toBe(true);
    expect(JSON.stringify(WARD.faces[0]!.abilities[0])).toContain('"duration":{"d":"untilNextTurn","whose":{"ref":"you"}}');
  });
  it('an opponent\'s attacker gets -2/-0 during their turn; the effect has ended once your next turn begins', () => {
    let s = scenario([], { p1: { hand: ['Test Ward'] }, p2: { battlefield: ['Test Giant'] }, defs: [WARD, GIANT] });
    s = cast(s, 'Test Ward');
    const giant = find(s, 'Test Giant', 'battlefield', 'p2');
    s = toAttack(s, 2);
    s = drain(settle(declareAttackers(s, [[giant, 'p1']])));
    expect(power(s, giant)).toBe(2);
    s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'main1' && x.pending?.kind === 'priority');
    expect(s.delayedTriggers).toHaveLength(0);
    s = toAttack(s, 4);
    s = drain(settle(declareAttackers(s, [[giant, 'p1']])));
    expect(power(s, giant)).toBe(4);
  });
  it('"those creatures" are the creatures that attacked an opponent: they get +2/+2 and trample, and only until your next turn', () => {
    let s = scenario([], { p1: { hand: ['Test Howl'], battlefield: ['Test Bear', 'Test Ox'] }, defs: [HOWL, BEAR, OX] });
    s = cast(s, 'Test Howl');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const ox = find(s, 'Test Ox', 'battlefield', 'p1');
    s = drain(settle(declareAttackers(toDeclareAttackers(s), [[bear]])));
    expect(power(s, bear)).toBe(4);
    expect(keywords(s, bear)).toContain('trample');
    expect(power(s, ox)).toBe(1);
    s = toAttack(s, 3);
    s = drain(settle(declareAttackers(s, [[bear]])));
    expect(power(s, bear)).toBe(2);
  });
});

describe('CR 701.21a, 608.2e, 101.4, 107.1a: "Each player sacrifices half the <permanents> they control of their choice, rounded down." (half of each player\'s own)', () => {
  const HALVE = card('Test Halve', 'Sorcery', 'Each player sacrifices half the creatures they control of their choice, rounded down.');
  it('is automated; each player sacrifices half of their own creatures, rounded down', () => {
    expect(automated(HALVE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Halve'], battlefield: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Ox', 'Test Ox', 'Test Ox'] }, defs: [HALVE, BEAR, OX] });
    const mine = findAll(s, 'Test Bear', 'battlefield', 'p1');
    const theirs = findAll(s, 'Test Ox', 'battlefield', 'p2');
    s = cast(s, 'Test Halve', { picks: [[mine[0]!, mine[1]!], [theirs[0]!]] });
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1')).toHaveLength(2);
    expect(findAll(s, 'Test Ox', 'battlefield', 'p2')).toHaveLength(2);
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual(['Test Ox']);
  });
});

describe('CR 101.4, 608.2d, 701.21a, 109.2: "Each player chooses any number of creatures they control with total power 4 or less, then sacrifices all other creatures they control."', () => {
  const PACT = card('Test Pact', 'Sorcery', 'Each player chooses any number of creatures they control with total power 4 or less, then sacrifices all other creatures they control.');
  it('is automated; each player keeps the creatures they chose and sacrifices the rest', () => {
    expect(automated(PACT)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Pact'], battlefield: ['Test Bear', 'Test Bear', 'Test Giant'] }, p2: { battlefield: ['Test Giant', 'Test Ox'] }, defs: [PACT, BEAR, GIANT, OX] });
    const [b1, b2] = findAll(s, 'Test Bear', 'battlefield', 'p1');
    const g2 = find(s, 'Test Giant', 'battlefield', 'p2');
    s = cast(s, 'Test Pact', { picks: [[b1!, b2!], [g2]] });
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1')).toHaveLength(2);
    expect(zoneNames(s, 'graveyard', 'p1').sort()).toEqual(['Test Giant', 'Test Pact']);
    expect(find(s, 'Test Giant', 'battlefield', 'p2')).toBe(g2);
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual(['Test Ox']);
  });
  it('a choice over the total power limit is refused (CR 608.2d)', () => {
    let s = scenario([], { p1: { hand: ['Test Pact'], battlefield: ['Test Bear', 'Test Giant'] }, p2: {}, defs: [PACT, BEAR, GIANT] });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Pact', 'hand', 'p1') }));
    s = pass(pass(s));
    expect(s.pending?.kind).toBe('chooseObjects');
    const both = findAll(s, 'Test Bear', 'battlefield', 'p1').concat(findAll(s, 'Test Giant', 'battlefield', 'p1'));
    expect(() => answer(s, { kind: 'chooseObjects', ids: both })).toThrow();
  });
});

describe('CR 101.4, 608.2c, 608.2d, 121.1: "Each player may shuffle their hand and graveyard into their library. Each player who does draws N cards."', () => {
  const RESET = card('Test Reset', 'Sorcery', 'Each player may shuffle their hand and graveyard into their library. Each player who does draws three cards.');
  it('is automated; a player who shuffles draws, a player who declines keeps hand and graveyard', () => {
    expect(automated(RESET)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Reset', 'Test Bear'], graveyard: ['Test Ox'] }, p2: { hand: ['Test Ox'], graveyard: ['Test Bear'] }, defs: [RESET, BEAR, OX] });
    s = cast(s, 'Test Reset', { answers: [{ kind: 'yesNo', yes: true }, { kind: 'yesNo', yes: false }] });
    expect(zoneNames(s, 'hand', 'p1')).toHaveLength(3);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Reset']);
    expect(zoneNames(s, 'hand', 'p2')).toEqual(['Test Ox']);
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual(['Test Bear']);
  });
});

describe('CR 607.2a, 601.3, 305.1, 611.3a: "You may play cards exiled with ~" (a static ability of the object whose linked ability exiled them)', () => {
  const THIEF = card('Test Thief', 'Creature — Faerie Rogue', 'When this creature enters, exile the top two cards of target opponent\'s library.\nYou may play cards exiled with this creature.', ['1', '1']);
  it('is automated', () => {
    expect(automated(THIEF)).toBe(true);
  });
  it('the controller may cast a spell card exiled with it (an opponent\'s card, which they then control); a card exiled otherwise is not playable', () => {
    let s = scenario([], { p1: { hand: ['Test Thief'] }, p2: { library: ['Test Cub', 'Test Cub'] }, defs: [THIEF, CUB] });
    s = cast(s, 'Test Thief', { targets: [[{ kind: 'player', id: 'p2' }]] });
    const exiled = s.zones.exile.filter((id) => s.objects[id]!.defId === 'Test Cub');
    expect(exiled).toHaveLength(2);
    const castable = legal(s, 'p1', 'cast').map((a) => a.object);
    expect(castable).toEqual(expect.arrayContaining(exiled));
    // the opponent can't play them (the permission is the controller's)
    expect(legal(s, 'p2', 'cast').map((a) => a.object)).not.toContain(exiled[0]);
    s = drain(settle(act(s, { type: 'cast', player: 'p1', card: exiled[0]! })));
    expect(battlefieldOwnedBy(s, 'Test Cub', 'p2')).toBe(1);
    expect(s.objects[s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Cub')!]!.controller).toBe('p1');
  });
});

function battlefieldOwnedBy(s: GameState, name: string, owner: 'p1' | 'p2'): number {
  return s.zones.battlefield.filter((id) => s.objects[id]!.defId === name && s.objects[id]!.owner === owner).length;
}
void life;
void obj;

describe('CR 607.2a, 611.3a, 400.7: the linked permission ends when the object leaves the battlefield', () => {
  const THIEF = card('Test Thief Two', 'Creature — Faerie Rogue', 'When this creature enters, exile the top card of target opponent\'s library.\nYou may play cards exiled with this creature.', ['1', '1']);
  const ZAP = card('Test Zap', 'Instant', 'Destroy target creature.');
  it('on any turn while it is on the battlefield (a sorcery-speed card still waits for your main phase); not after it left', () => {
    let s = scenario([], { p1: { hand: ['Test Thief Two', 'Test Zap'] }, p2: { library: ['Test Cub'] }, defs: [THIEF, ZAP, CUB] });
    s = cast(s, 'Test Thief Two', { targets: [[{ kind: 'player', id: 'p2' }]] });
    const cub = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Cub')!;
    expect(legal(s, 'p1', 'cast').map((a) => a.object)).toContain(cub);
    s = passTo(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.kind === 'priority');
    // the creature card keeps its timing (CR 601.3, 307.1): not during an opponent's main phase
    expect(legal(s, 'p1', 'cast').map((a) => a.object)).not.toContain(cub);
    s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'main1' && x.pending?.kind === 'priority');
    expect(legal(s, 'p1', 'cast').map((a) => a.object)).toContain(cub);
    s = cast(s, 'Test Zap', { targets: [[obj(find(s, 'Test Thief Two', 'battlefield', 'p1'))]] });
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Thief Two');
    expect(legal(s, 'p1', 'cast').map((a) => a.object)).not.toContain(cub);
  });
});

describe('CR 607.2a, 110.2, 122.6, 613.1d, 613.4b: "Put each creature card exiled with ~ onto the battlefield under your control with a <kind> counter on it. Each of them is a 1/1 Spirit in addition to its other types."', () => {
  const JAR = card('Test Jar', 'Artifact', '{T}: Exile target card from a graveyard.\n{2}, {T}, Sacrifice this artifact: Put each creature card exiled with this artifact onto the battlefield under your control with a flying counter on it. Each of them is a 1/1 Spirit in addition to its other types.');
  const ZAP = card('Test Zap Two', 'Instant', 'Exile target card from a graveyard.');
  it('is automated', () => expect(automated(JAR)).toBe(true));
  it('only the creature cards the artifact exiled come back, under your control, each with a flying counter, as 1/1 Spirits that keep their types', () => {
    let s = scenario([], { p1: { battlefield: ['Test Jar', 'Plains', 'Plains'], hand: ['Test Zap Two'] }, p2: { graveyard: ['Test Giant', 'Test Ox', 'Test Trinket'] }, defs: [JAR, ZAP, GIANT, OX, TRINKET] });
    const jar = find(s, 'Test Jar', 'battlefield', 'p1');
    const activate = (s0: GameState, ability: string, opts: Opts = {}): GameState => {
      const q = { targets: [...(opts.targets ?? [])], picks: [...(opts.picks ?? [])], answers: [...(opts.answers ?? [])] };
      return drain(settle(act(s0, { type: 'activate', player: 'p1', source: jar, ability }), q), q);
    };
    s = activate(s, 'p:0:0', { targets: [[obj(find(s, 'Test Giant', 'graveyard', 'p2'))]] });
    // another card exiled by something else is not "exiled with" the artifact (CR 607.2a)
    s = cast(s, 'Test Zap Two', { targets: [[obj(find(s, 'Test Ox', 'graveyard', 'p2'))]] });
    // untap the artifact for the second ability (a new turn of the controller)
    s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'main1' && x.pending?.kind === 'priority');
    s = activate(s, 'p:0:1');
    const giant = find(s, 'Test Giant', 'battlefield');
    expect(s.objects[giant]!.controller).toBe('p1');
    expect(s.objects[giant]!.counters['flying']).toBe(1);
    const c = getChars(s, giant);
    expect([Number(c.power), Number(c.toughness)]).toEqual([1, 1]);
    expect(c.subtypes).toEqual(expect.arrayContaining(['Giant', 'Spirit']));
    expect(keywords(s, giant)).toContain('flying');
    expect(s.zones.exile.map((id) => s.objects[id]!.defId)).toContain('Test Ox');
  });
});

describe('CR 122.1, 122.6: "For each kind of counter on target permanent or player, give that permanent or player another counter of that kind."', () => {
  const BROKER = card('Test Broker', 'Creature — Human', '{T}: For each kind of counter on target permanent or player, give that permanent or player another counter of that kind.', ['1', '1']);
  const activate = (s0: GameState, source: ObjectId, targets: TargetChoice[][]): GameState => {
    const q = { targets: [...targets] };
    return drain(settle(act(s0, { type: 'activate', player: 'p1', source, ability: 'p:0:0' }), q), q);
  };
  it('is automated', () => expect(automated(BROKER)).toBe(true));
  it('a permanent gets one more of each kind it has (and none of a kind it lacks)', () => {
    let s = scenario([], { p1: { battlefield: [{ name: 'Test Broker', since: -1 }, { name: 'Test Bear', counters: { '+1/+1': 2, stun: 1 } }] }, defs: [BROKER, BEAR] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = activate(s, find(s, 'Test Broker', 'battlefield', 'p1'), [[obj(bear)]]);
    expect(s.objects[bear]!.counters).toEqual({ '+1/+1': 3, stun: 2 });
  });
  it('a player gets one more of each kind too (poison and energy)', () => {
    let s = scenario([], { p1: { battlefield: [{ name: 'Test Broker', since: -1 }] }, defs: [BROKER] });
    const p2 = s.players.find((p) => p.id === 'p2')!;
    p2.poison = 3;
    p2.counters = { energy: 2 };
    s = activate(s, find(s, 'Test Broker', 'battlefield', 'p1'), [[{ kind: 'player', id: 'p2' }]]);
    const after = s.players.find((p) => p.id === 'p2')!;
    expect(after.poison).toBe(4);
    expect(after.counters['energy']).toBe(3);
  });
});

describe('CR 608.2c, 608.2d, 406.1, 601.3, 611.2a: "Whenever a creature is dealt damage, its controller may exile that many cards from the top of their library. They may play those cards until the end of their next turn."', () => {
  const LEGACY = card('Test Legacy', 'Enchantment', 'Whenever a creature is dealt damage, its controller may exile that many cards from the top of their library. They may play those cards until the end of their next turn.');
  const SHOCK = card('Test Shock', 'Instant', 'This spell deals 2 damage to target creature.');
  it('is automated; "they" is the controller of the damaged creature', () => {
    expect(automated(LEGACY)).toBe(true);
    const steps = JSON.stringify(LEGACY.faces[0]!.abilities[0]);
    expect(steps).toContain('"who":{"ref":"controllerOf","object":{"ref":"event"');
    expect(steps).not.toContain('"who":{"ref":"you"}');
  });
  it('the creature\'s controller (not you) chooses, exiles that many of their own cards, and may play them on their turn; you may not', () => {
    let s = scenario([], { p1: { hand: ['Test Shock'], battlefield: ['Test Legacy'] }, p2: { battlefield: ['Test Ox'], library: ['Test Cub', 'Test Cub'] }, defs: [LEGACY, SHOCK, OX, CUB] });
    s = cast(s, 'Test Shock', { targets: [[obj(find(s, 'Test Ox', 'battlefield', 'p2'))]] });
    // the trigger: the opponent is asked
    expect(s.pending?.kind).toBe('yesNo');
    expect(s.pending?.player).toBe('p2');
    s = drain(settle(answer(s, { kind: 'yesNo', yes: true })));
    const exiled = s.zones.exile.filter((id) => s.objects[id]!.defId === 'Test Cub');
    expect(exiled).toHaveLength(2);
    expect(legal(s, 'p1', 'cast').map((a) => a.object)).not.toContain(exiled[0]);
    s = passTo(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.kind === 'priority');
    expect(legal(s, 'p2', 'cast').map((a) => a.object)).toEqual(expect.arrayContaining(exiled));
    s = drain(settle(act(s, { type: 'cast', player: 'p2', card: exiled[0]! })));
    expect(battlefieldOwnedBy(s, 'Test Cub', 'p2')).toBe(1);
  });
  it('a player who declines exiles nothing', () => {
    let s = scenario([], { p1: { hand: ['Test Shock'], battlefield: ['Test Legacy'] }, p2: { battlefield: ['Test Ox'], library: ['Test Cub', 'Test Cub'] }, defs: [LEGACY, SHOCK, OX, CUB] });
    s = cast(s, 'Test Shock', { targets: [[obj(find(s, 'Test Ox', 'battlefield', 'p2'))]] });
    s = drain(settle(answer(s, { kind: 'yesNo', yes: false })));
    expect(s.zones.exile.filter((id) => s.objects[id]!.defId === 'Test Cub')).toHaveLength(0);
  });
});

describe('CR 401.1, 406.3, 101.4, 107.1b: "each player exiles all but the bottom N cards of their library face down"', () => {
  const DOOM = card('Test Doom', 'Creature — Demon', 'When this creature enters, each player exiles all but the bottom six cards of their library face down.', ['6', '6']);
  it('is automated; every library keeps exactly its bottom six cards, the rest are exiled face down; a short library loses nothing', () => {
    expect(automated(DOOM)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Doom'] }, p2: {}, defs: [DOOM] });
    const bottom1 = s.zones.library.p1!.slice(-6);
    s.zones.library.p2 = s.zones.library.p2!.slice(0, 15); // p2 keeps 15 cards; p1 has 20
    const bottom2b = s.zones.library.p2!.slice(-6);
    s = cast(s, 'Test Doom');
    expect(s.zones.library.p1).toEqual(bottom1);
    expect(s.zones.library.p2).toEqual(bottom2b);
    const exiled = s.zones.exile;
    expect(exiled).toHaveLength(14 + 9);
    expect(exiled.every((id) => s.objects[id]!.faceDown)).toBe(true);
  });
});

describe('CR 205.1a, 611.2a, 613.1d: "~ becomes a Werewolf. Put two +1/+1 counters on it and you draw a card." (a new creature type replaces the old ones, for good)', () => {
  const SCHOLAR = card('Test Scholar', 'Creature — Human Advisor', '{0}: This creature becomes a Werewolf. Put two +1/+1 counters on it and you draw a card. Activate only once.', ['1', '1']);
  it('is automated; the creature is a Werewolf only (no longer a Human Advisor) from then on, with the counters, and you draw', () => {
    expect(automated(SCHOLAR)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Scholar'] }, defs: [SCHOLAR] });
    const me = find(s, 'Test Scholar', 'battlefield', 'p1');
    const hand = zoneNames(s, 'hand', 'p1').length;
    s = drain(settle(act(s, { type: 'activate', player: 'p1', source: me, ability: 'p:0:0' })));
    expect(getChars(s, me).subtypes).toEqual(['Werewolf']);
    expect(s.objects[me]!.counters['+1/+1']).toBe(2);
    expect(zoneNames(s, 'hand', 'p1')).toHaveLength(hand + 1);
    s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'main1' && x.pending?.kind === 'priority');
    expect(getChars(s, me).subtypes).toEqual(['Werewolf']);
  });
});

describe('CR 603.7b, 400.7a, 611.2a: "When you next cast a creature spell this turn, it gains haste until end of turn."', () => {
  const RALLY = card('Test Rally Cry', 'Instant', 'When you next cast a creature spell this turn, it gains haste until end of turn.');
  it('is automated; the next creature spell gains haste, which the permanent it becomes keeps (it can attack); the creature after it does not', () => {
    expect(automated(RALLY)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Rally Cry', 'Test Cub', 'Test Bear'], battlefield: ['Plains', 'Plains'] }, defs: [RALLY, CUB, BEAR] });
    s = cast(s, 'Test Rally Cry');
    s = cast(s, 'Test Cub');
    const cub = find(s, 'Test Cub', 'battlefield', 'p1');
    expect(keywords(s, cub)).toContain('haste');
    expect(s.delayedTriggers).toHaveLength(0);
    s = passTo(s, (x) => x.pending?.kind === 'declareAttackers' && x.turn.number === 1);
    expect(() => declareAttackers(s, [[cub]])).not.toThrow();
    // until end of turn only
    s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'main1' && x.pending?.kind === 'priority');
    expect(keywords(s, cub)).not.toContain('haste');
  });
  it('triggers once: a second creature spell that turn gains nothing', () => {
    const FREE_BEAR = card('Test Free Bear', 'Creature — Bear', '', ['2', '2']);
    let s = scenario([], { p1: { hand: ['Test Rally Cry', 'Test Cub', 'Test Free Bear'] }, defs: [RALLY, CUB, FREE_BEAR] });
    s = cast(s, 'Test Rally Cry');
    s = cast(s, 'Test Cub');
    s = cast(s, 'Test Free Bear');
    expect(keywords(s, find(s, 'Test Free Bear', 'battlefield', 'p1'))).not.toContain('haste');
  });
});

describe('CR 102.3, 115.1, 601.2c: "For each other player, exile up to one target creature that player controls."', () => {
  const PURGE = card('Test Purge Two', 'Sorcery', 'For each other player, exile up to one target creature that player controls.');
  it('is automated; the target is a creature an opponent controls (one for each other player), never one of yours', () => {
    expect(automated(PURGE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Purge Two'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Ox'] }, defs: [PURGE, BEAR, OX] });
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    const theirs = find(s, 'Test Ox', 'battlefield', 'p2');
    expect(() => cast(s, 'Test Purge Two', { targets: [[obj(mine)]] })).toThrow();
    s = cast(s, 'Test Purge Two', { targets: [[obj(theirs)]] });
    expect(s.zones.exile.map((id) => s.objects[id]!.defId)).toEqual(['Test Ox']);
    expect(find(s, 'Test Bear', 'battlefield', 'p1')).toBe(mine);
  });
});
