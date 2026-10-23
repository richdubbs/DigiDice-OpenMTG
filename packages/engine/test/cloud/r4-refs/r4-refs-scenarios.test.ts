/**
 * Standard round 4, slice r4-refs (references and durations, both halves of Standard): the shapes of this slice played through applyAction with synthetic cards
 * compiled by the game's default compiler (invented wordings, design 6.10). Nothing is mocked. The templates' evidence is these plays and the hand-verified golden
 * cards of test/m5/golden/cards/cloud-r4-refs-review.json.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, life, pass, scenario, zoneNames } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual node). */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: 'p1' | 'p2'): TargetChoice => ({ kind: 'player', id });

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
function cast(s0: GameState, name: string, opts: Opts = {}): GameState {
  const q = { targets: [...(opts.targets ?? [])], picks: [...(opts.picks ?? [])], answers: [...(opts.answers ?? [])] };
  return drain(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), q), q);
}
function activate(s0: GameState, source: ObjectId, opts: Opts = {}, ability = 'p:0:0'): GameState {
  const q = { targets: [...(opts.targets ?? [])], picks: [...(opts.picks ?? [])], answers: [...(opts.answers ?? [])] };
  return drain(settle(act(s0, { type: 'activate', player: 'p1', source, ability }), q), q);
}
const pendingOptions = (s: GameState): ObjectId[] => (s.pending?.kind === 'chooseObjects' ? (s.pending as unknown as { options: ObjectId[] }).options : []);
const keywords = (s: GameState, id: ObjectId): string[] => getChars(s, id).abilities.map((a) => (a.def as { keyword?: string }).keyword ?? '');

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}{G}');
const OX = card('Test Ox', 'Creature — Ox', '', ['1', '4'], '{1}{W}');
const ROCK = card('Test Rock', 'Artifact', '');
const PEAK = card('Test Peak', 'Basic Land — Mountain', '({T}: Add {R}.)');

describe('CR 701.21a, 119.3, 608.2e: "Each opponent sacrifices a creature of their choice and loses 3 life."', () => {
  const EDICT = card('Test Edict', 'Sorcery', 'Each opponent sacrifices a creature of their choice and loses 3 life.');
  it('is automated; the opponent sacrifices a creature they choose and loses 3 life, you neither', () => {
    expect(automated(EDICT)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Edict'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Ox'] }, defs: [EDICT, BEAR, OX] });
    const ox = find(s, 'Test Ox', 'battlefield', 'p2');
    s = cast(s, 'Test Edict', { picks: [[ox]] });
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual(['Test Ox']);
    expect(findAll(s, 'Test Bear', 'battlefield')).toHaveLength(2);
    expect(life(s, 'p2')).toBe(17);
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 701.21a, 109.2: "Target player sacrifices a creature of their choice other than <object>."', () => {
  const PICK = card('Test Pick', 'Sorcery', 'Target player sacrifices a creature of their choice other than target creature.');
  it('the object named is never among the creatures they may sacrifice', () => {
    expect(automated(PICK)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Pick'] }, p2: { battlefield: ['Test Bear', 'Test Ox'] }, defs: [PICK, BEAR, OX] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = cast(s, 'Test Pick', { targets: [[player('p2')], [obj(bear)]] });
    // the only other creature is sacrificed (one possible choice: nothing is asked)
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual(['Test Ox']);
    expect(find(s, 'Test Bear', 'battlefield', 'p2')).toBe(bear);
  });
});

describe('CR 406.1, 608.2c-d: "Target opponent exiles a creature they control and their graveyard." / "..., then they exile a nonland card from their graveyard."', () => {
  const PURGE = card('Test Purge', 'Sorcery', 'Target opponent exiles a creature they control and their graveyard.');
  const SIFT = card('Test Sift', 'Sorcery', 'Target opponent exiles a nontoken creature they control, then they exile a nonland card from their graveyard.');
  it('the opponent exiles the creature they choose and every card of their graveyard', () => {
    expect(automated(PURGE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Purge'], graveyard: ['Test Rock'] }, p2: { battlefield: ['Test Bear'], graveyard: ['Test Rock', 'Test Peak'] }, defs: [PURGE, BEAR, ROCK, PEAK] });
    s = cast(s, 'Test Purge', { targets: [[player('p2')]], picks: [[find(s, 'Test Bear', 'battlefield', 'p2')]] });
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual([]);
    expect(s.zones.exile.map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Bear', 'Test Peak', 'Test Rock']);
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Rock'); // your graveyard is not theirs
  });
  it('"then they exile a nonland card from their graveyard": the opponent exiles a nonland card of their own (the land card stays)', () => {
    expect(automated(SIFT)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Sift'] }, p2: { battlefield: ['Test Bear'], graveyard: ['Test Rock', 'Test Peak'] }, defs: [SIFT, BEAR, ROCK, PEAK] });
    s = cast(s, 'Test Sift', { targets: [[player('p2')]], picks: [[find(s, 'Test Bear', 'battlefield', 'p2')]] });
    expect(s.zones.exile.map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Bear', 'Test Rock']);
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual(['Test Peak']);
  });
});

describe('CR 105.3, 205.1b, 613.1d-e: "Put three +1/+1 counters on ~ and it becomes a black Demon in addition to its other colors and types."', () => {
  const GOAT = card('Test Goat', 'Creature — Goat', '{1}: Put three +1/+1 counters on this creature and it becomes a black Demon in addition to its other colors and types.', ['1', '1']);
  it('the creature gets the counters, keeps its color and types and adds black and Demon', () => {
    expect(automated(GOAT)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Goat', 'Test Peak'] }, defs: [GOAT, PEAK] });
    const g = find(s, 'Test Goat', 'battlefield', 'p1');
    s = activate(s, g);
    expect(s.objects[g]!.counters['+1/+1']).toBe(3);
    const c = getChars(s, g);
    expect(c.subtypes).toEqual(expect.arrayContaining(['Goat', 'Demon']));
    expect(c.colors).toContain('B');
  });
});

describe('CR 205.1b, 611.2a, 613.4b: "~ becomes a 3/3 Monk creature with haste in addition to its other types until end of turn."', () => {
  const SHRINE = card('Test Shrine', 'Enchantment', '{1}: This enchantment becomes a 3/3 Monk creature with haste in addition to its other types until end of turn.');
  it('the enchantment is a 3/3 Monk creature with haste and still an enchantment', () => {
    expect(automated(SHRINE)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Shrine', 'Test Peak'] }, defs: [SHRINE, PEAK] });
    const e = find(s, 'Test Shrine', 'battlefield', 'p1');
    s = activate(s, e);
    const c = getChars(s, e);
    expect(c.types).toEqual(expect.arrayContaining(['Enchantment', 'Creature']));
    expect(c.subtypes).toContain('Monk');
    expect([Number(c.power), Number(c.toughness)]).toEqual([3, 3]);
    expect(keywords(s, e)).toContain('haste');
  });
});

describe('CR 608.2c, 611.2c: "Draw a card for each creature you control with a +1/+1 counter on it. Those creatures gain indestructible until end of turn."', () => {
  const CALL = card('Test Call', 'Instant', 'Draw a card for each creature you control with a +1/+1 counter on it. Those creatures gain indestructible until end of turn.');
  it('draws one card per such creature, and exactly those creatures gain indestructible', () => {
    expect(automated(CALL)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Call'], library: ['Test Rock', 'Test Rock', 'Test Rock'], battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 1 } }, { name: 'Test Ox', counters: { '+1/+1': 2 } }, 'Test Bear'] }, defs: [CALL, BEAR, OX, ROCK] });
    s = cast(s, 'Test Call');
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Rock', 'Test Rock']);
    const [b1, b2] = findAll(s, 'Test Bear', 'battlefield', 'p1');
    const withCounter = s.objects[b1!]!.counters['+1/+1'] ? b1! : b2!;
    const without = withCounter === b1 ? b2! : b1!;
    expect(keywords(s, withCounter)).toContain('indestructible');
    expect(keywords(s, find(s, 'Test Ox', 'battlefield', 'p1'))).toContain('indestructible');
    expect(keywords(s, without)).not.toContain('indestructible');
  });
});

describe('CR 119.1, 608.2c: "If target player has exactly 10 life, ~ deals 10 damage to that player."', () => {
  const RITE = card('Test Rite', 'Instant', 'If target player has exactly 10 life, this spell deals 10 damage to that player.');
  it('deals the damage only to a player with exactly 10 life', () => {
    expect(automated(RITE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Rite', 'Test Rite'] }, defs: [RITE] });
    s = cast(s, 'Test Rite', { targets: [[player('p2')]] });
    expect(life(s, 'p2')).toBe(20);
    s = { ...s, players: s.players.map((p) => (p.id === 'p2' ? { ...p, life: 10 } : p)) };
    s = cast(s, 'Test Rite', { targets: [[player('p2')]] });
    expect(life(s, 'p2')).toBe(0);
  });
});

describe('CR 120.3, 608.2h: "Target creature deals damage equal to its power to itself."', () => {
  const JEST = card('Test Jest', 'Instant', 'Target creature deals damage equal to its power to itself. If that creature is attacking, this spell deals 2 damage to that creature\'s controller.');
  it('the creature is dealt damage equal to its power by itself; not attacking, its controller takes nothing', () => {
    expect(automated(JEST)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Jest'] }, p2: { battlefield: ['Test Bear', 'Test Ox'] }, defs: [JEST, BEAR, OX] });
    s = cast(s, 'Test Jest', { targets: [[obj(find(s, 'Test Bear', 'battlefield', 'p2'))]] });
    expect(zoneNames(s, 'graveyard', 'p2')).toContain('Test Bear'); // 2 damage to a 2/2
    s = scenario([], { p1: { hand: ['Test Jest'] }, p2: { battlefield: ['Test Ox'] }, defs: [JEST, OX] });
    const ox = find(s, 'Test Ox', 'battlefield', 'p2');
    s = cast(s, 'Test Jest', { targets: [[obj(ox)]] });
    expect(s.objects[ox]!.damage).toBe(1);
    expect(life(s, 'p2')).toBe(20);
  });
});

describe('CR 701.23a, 201.2: "Search your library for a card named <Name>, put it onto the battlefield tapped, then shuffle."', () => {
  const SQUAD = card('Test Squad', 'Artifact Creature — Robot', '{1}: Search your library for a card named Test Squad, put it onto the battlefield tapped, then shuffle.', ['1', '1']);
  it('only a card of that name is found, and it enters tapped', () => {
    expect(automated(SQUAD)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Squad', 'Test Peak'], library: ['Test Bear', 'Test Squad'] }, defs: [SQUAD, BEAR, PEAK] });
    s = settle(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Squad', 'battlefield', 'p1'), ability: 'p:0:0' }));
    s = settle(pass(pass(s)));
    expect(pendingOptions(s).map((id) => s.objects[id]!.defId)).toEqual(['Test Squad']);
    s = drain(settle(s, { picks: [[find(s, 'Test Squad', 'library', 'p1')]] }));
    const squads = findAll(s, 'Test Squad', 'battlefield', 'p1');
    expect(squads).toHaveLength(2);
    expect(squads.filter((id) => s.objects[id]!.tapped)).toHaveLength(1);
  });
});

const setLife = (s: GameState, p: 'p1' | 'p2', n: number): GameState => ({ ...s, players: s.players.map((x) => (x.id === p ? { ...x, life: n } : x)) });

describe('CR 122.1, 601.2i, 608.2h: "put two +1/+1 counters on that token for each spell you\'ve cast this turn other than the first"', () => {
  const STITCH = card('Test Stitch', 'Creature — Zombie', "When this creature enters, create a 2/2 black Zombie creature token, then put two +1/+1 counters on that token for each spell you've cast this turn other than the first.", ['1', '1']);
  it('the token gets two counters for each spell after the first (none when this was the first spell)', () => {
    expect(automated(STITCH)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Stitch', 'Test Stitch'] }, defs: [STITCH] });
    s = cast(s, 'Test Stitch');
    const tokens = (x: GameState): ObjectId[] => x.zones.battlefield.filter((id) => x.objects[id]!.kind === 'token');
    expect(tokens(s).map((id) => s.objects[id]!.counters['+1/+1'] ?? 0)).toEqual([0]);
    s = cast(s, 'Test Stitch');
    const second = tokens(s).find((id) => (s.objects[id]!.counters['+1/+1'] ?? 0) > 0);
    expect(second && s.objects[second]!.counters['+1/+1']).toBe(2);
  });
});

describe('CR 115.1, 109.2, 701.65a: "Choose up to one target creature, then airbend all other creatures."', () => {
  const WRATH = card('Test Wrath', 'Sorcery', "Choose up to one target creature, then airbend all other creatures.\nUntil your next turn, your opponents can't cast spells from anywhere other than their hands.");
  it('every creature but the target is exiled (airbent); with no target, every creature', () => {
    expect(automated(WRATH)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Wrath'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Ox', 'Test Bear'] }, defs: [WRATH, BEAR, OX] });
    const ox = find(s, 'Test Ox', 'battlefield', 'p2');
    s = cast(s, 'Test Wrath', { targets: [[obj(ox)]] });
    expect(s.zones.battlefield.map((id) => s.objects[id]!.defId)).toEqual(['Test Ox']);
    expect(s.zones.exile).toHaveLength(2);
    s = scenario([], { p1: { hand: ['Test Wrath'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Ox'] }, defs: [WRATH, BEAR, OX] });
    s = cast(s, 'Test Wrath', { targets: [[]] });
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId !== 'Test Wrath')).toHaveLength(0);
  });
});

describe('CR 400.7, 404.1, 608.2h: "Draw X cards, where X is the number of cards that were put into target player\'s graveyard from their library this turn."', () => {
  const MILL = card('Test Mill', 'Sorcery', 'Target player mills three cards.');
  const COUNT = card('Test Count', 'Sorcery', "Draw X cards, where X is the number of cards that were put into target player's graveyard from their library this turn.");
  it('counts only that player\'s cards that went from their library to their graveyard this turn', () => {
    expect(automated(COUNT)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Mill', 'Test Mill', 'Test Count'], library: ['Test Rock', 'Test Rock', 'Test Rock', 'Test Rock', 'Test Rock', 'Test Rock'] }, p2: { library: ['Test Rock', 'Test Rock', 'Test Rock'] }, defs: [MILL, COUNT, ROCK] });
    s = cast(s, 'Test Mill', { targets: [[player('p2')]] });
    s = cast(s, 'Test Mill', { targets: [[player('p1')]] });
    const before = zoneNames(s, 'hand', 'p1').length;
    s = cast(s, 'Test Count', { targets: [[player('p2')]] });
    expect(zoneNames(s, 'hand', 'p1').length).toBe(before - 1 + 3);
  });
});

describe('CR 122.1, 608.2c: "Then if there are seven or more time counters on it, remove those counters and it deals 20 damage to you." / "..., transform it"', () => {
  const REEL = card('Test Reel', 'Artifact', 'Whenever you cast an instant or sorcery spell, put a time counter on this artifact. Then if there are three or more time counters on it, remove those counters and it deals 5 damage to you.');
  const ZAP = card('Test Zap', 'Instant', 'Draw a card.');
  it('below the number nothing happens; at it, the counters go and the artifact deals the damage', () => {
    expect(automated(REEL)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Zap', 'Test Zap'], library: ['Test Rock', 'Test Rock', 'Test Rock'], battlefield: [{ name: 'Test Reel', counters: { time: 1 } }] }, defs: [REEL, ZAP, ROCK] });
    const r = find(s, 'Test Reel', 'battlefield', 'p1');
    s = cast(s, 'Test Zap');
    expect(s.objects[r]!.counters['time']).toBe(2);
    expect(life(s, 'p1')).toBe(20);
    s = cast(s, 'Test Zap');
    expect(s.objects[r]!.counters['time'] ?? 0).toBe(0);
    expect(life(s, 'p1')).toBe(15);
  });
});

describe('CR 608.2c, 111.1: "Destroy target permanent an opponent controls. They create a Treasure token."', () => {
  const CUT = card('Test Cut', 'Sorcery', 'Destroy target permanent an opponent controls. They create a Treasure token.');
  it('the Treasure is the opponent\'s', () => {
    expect(automated(CUT)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Cut'] }, p2: { battlefield: ['Test Rock'] }, defs: [CUT, ROCK] });
    s = cast(s, 'Test Cut', { targets: [[obj(find(s, 'Test Rock', 'battlefield', 'p2'))]] });
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens).toHaveLength(1);
    expect(s.objects[tokens[0]!]!.controller).toBe('p2');
  });
});

describe('CR 701.20a, 701.9a, 608.2c: "That player reveals their hand. You choose a nonland card from it. They discard that card."', () => {
  const STING = card('Test Sting', 'Sorcery', 'This spell deals 2 damage to target opponent. That player reveals their hand. You choose a nonland card from it. They discard that card.');
  it('the opponent discards the card you chose', () => {
    expect(automated(STING)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Sting'] }, p2: { hand: ['Test Rock', 'Test Bear', 'Test Peak'] }, defs: [STING, ROCK, BEAR, PEAK] });
    s = cast(s, 'Test Sting', { targets: [[player('p2')]], picks: [[find(s, 'Test Bear', 'hand', 'p2')]] });
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual(['Test Bear']);
    expect(life(s, 'p2')).toBe(18);
  });
});

describe('CR 701.9a, 406.3, 608.2c: "You may choose a nonland card from it. If you do, they discard it. Otherwise, you may put a face-up exiled card they own into their graveyard."', () => {
  const DEAL = card('Test Deal', 'Sorcery', 'Target opponent reveals their hand. You may choose a nonland card from it. If you do, they discard it. Otherwise, you may put a face-up exiled card they own into their graveyard.');
  it('choosing: they discard it; not choosing (no nonland card): a face-up exiled card of theirs goes to their graveyard', () => {
    expect(automated(DEAL)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Deal'] }, p2: { hand: ['Test Bear'] }, defs: [DEAL, BEAR] });
    s = cast(s, 'Test Deal', { targets: [[player('p2')]], picks: [[find(s, 'Test Bear', 'hand', 'p2')]] });
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual(['Test Bear']);
    s = scenario([], { p1: { hand: ['Test Deal'] }, p2: { hand: ['Test Peak'], graveyard: ['Test Rock'] }, defs: [DEAL, PEAK, ROCK] });
    const rock = find(s, 'Test Rock', 'graveyard', 'p2');
    s = { ...s, zones: { ...s.zones, graveyard: { ...s.zones.graveyard, p2: [] }, exile: [...s.zones.exile, rock] }, objects: { ...s.objects, [rock]: { ...s.objects[rock]!, zone: 'exile' } } } as GameState;
    s = cast(s, 'Test Deal', { targets: [[player('p2')]], picks: [[rock]] }); // no nonland card to choose: nothing is asked first
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual(['Test Rock']);
    expect(zoneNames(s, 'hand', 'p2')).toEqual(['Test Peak']);
  });
});

describe('CR 105.3, 611.2a, 608.2h: "Draw a card, then choose a color. This artifact becomes the chosen color."', () => {
  const EYE = card('Test Eye', 'Artifact', 'When this artifact enters, draw a card, then choose a color. This artifact becomes the chosen color.');
  it('the artifact is the color chosen', () => {
    expect(automated(EYE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Eye'], library: ['Test Rock'] }, defs: [EYE, ROCK] });
    s = cast(s, 'Test Eye', { answers: [{ kind: 'chooseColor', color: 'G' }] });
    expect(getChars(s, find(s, 'Test Eye', 'battlefield', 'p1')).colors).toEqual(['G']);
  });
});

describe('CR 608.2c (an Otherwise after a chosen target): "Choose target creature an opponent controls. If it\'s tapped, put a stun counter on it. Otherwise, tap it."', () => {
  const SLING = card('Test Sling', 'Sorcery', "Choose target creature an opponent controls. If it's tapped, put a stun counter on it. Otherwise, tap it.");
  it('an untapped creature is tapped; a tapped one gets a stun counter', () => {
    expect(automated(SLING)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Sling', 'Test Sling'] }, p2: { battlefield: ['Test Bear'] }, defs: [SLING, BEAR] });
    const b = find(s, 'Test Bear', 'battlefield', 'p2');
    s = cast(s, 'Test Sling', { targets: [[obj(b)]] });
    expect(s.objects[b]!.tapped).toBe(true);
    expect(s.objects[b]!.counters['stun'] ?? 0).toBe(0);
    s = cast(s, 'Test Sling', { targets: [[obj(b)]] });
    expect(s.objects[b]!.counters['stun']).toBe(1);
  });
});

describe('CR 701.21a, 120.3, 608.2h: "If eight or more mana was spent to cast that spell, sacrifice ~ and it deals that much damage to each opponent."', () => {
  const SAGE = card('Test Sage', 'Creature — Wizard', 'Whenever you cast a noncreature spell, you gain 1 life. If two or more mana was spent to cast that spell, sacrifice this creature and it deals that much damage to each opponent.', ['1', '1']);
  const BOLT = card('Test Bolt', 'Instant', 'Draw a card.', undefined, '{3}');
  it('the creature is sacrificed and deals damage equal to the mana spent', () => {
    expect(automated(SAGE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Bolt'], library: ['Test Rock'], battlefield: ['Test Sage', 'Test Peak', 'Test Peak', 'Test Peak'] }, defs: [SAGE, BOLT, PEAK, ROCK] });
    s = cast(s, 'Test Bolt');
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(expect.arrayContaining(['Test Sage']));
    expect(life(s, 'p2')).toBe(17);
  });
});

describe('CR 510.1a, 510.1c, 611.2a: "until end of turn, creatures you control with toughness greater than their power assign combat damage equal to their toughness"', () => {
  const WALLS = card('Test Walls', 'Sorcery', 'Until end of turn, creatures you control with toughness greater than their power assign combat damage equal to their toughness rather than their power.');
  it('is automated, as one lasting rule effect for your creatures with toughness greater than power', () => {
    expect(automated(WALLS)).toBe(true);
    const steps = (WALLS.faces[0]!.abilities[0] as unknown as { effect: { steps: { op: string; duration?: { d: string }; effects?: { s: string; rule?: string }[] }[] } }).effect.steps;
    expect(steps).toHaveLength(1);
    expect(steps[0]!.duration).toEqual({ d: 'endOfTurn' });
    expect(steps[0]!.effects![0]).toMatchObject({ s: 'rule', rule: 'combatDamageUsesToughness', onlyIf: 'toughnessGreaterThanPower' });
  });
});

describe('CR 701.23a, 122.6, 110.2: "Its controller searches their library for a basic land card, puts it onto the battlefield tapped with a stun counter on it, then shuffles."', () => {
  const KITE = card('Test Kite', 'Sorcery', 'Destroy target nonbasic land an opponent controls. Its controller searches their library for a basic land card, puts it onto the battlefield tapped with a stun counter on it, then shuffles.');
  const VAULT = card('Test Vault', 'Land', '{T}: Add {C}.');
  it('the land\'s controller finds a basic land in their own library; it enters under their control, tapped, with a stun counter', () => {
    expect(automated(KITE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Kite'], library: ['Test Peak'] }, p2: { battlefield: ['Test Vault'], library: ['Test Peak', 'Test Rock'] }, defs: [KITE, VAULT, PEAK, ROCK] });
    s = cast(s, 'Test Kite', { targets: [[obj(find(s, 'Test Vault', 'battlefield', 'p2'))]], picks: [[find(s, 'Test Peak', 'library', 'p2')]] });
    const p = find(s, 'Test Peak', 'battlefield');
    expect(s.objects[p]!.controller).toBe('p2');
    expect(s.objects[p]!.tapped).toBe(true);
    expect(s.objects[p]!.counters['stun']).toBe(1);
    expect(zoneNames(s, 'library', 'p1')).toContain('Test Peak'); // your library is not searched
  });
});

describe('CR 603.10a, 400.7, 109.2: "Whenever a creature you control with an impostor counter on it dies, exile it. Return up to one other target creature card from your graveyard to the battlefield."', () => {
  const MASK = card('Test Mask', 'Enchantment', 'Whenever a creature you control with an impostor counter on it dies, exile it. Return up to one other target creature card from your graveyard to the battlefield.');
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
  it('the dying creature\'s card is not a legal target; another creature card is returned', () => {
    expect(automated(MASK)).toBe(true);
    const spec = (MASK.faces[0]!.abilities[0] as unknown as { effect: { targets: { filter: unknown }[] } }).effect.targets[0]!;
    expect(spec.filter).toMatchObject({ not: { is: { ref: 'event', role: 'subject' } } });
    let s = scenario([], { p1: { hand: ['Test Kill'], battlefield: ['Test Mask', { name: 'Test Bear', counters: { impostor: 1 } }], graveyard: ['Test Ox'] }, defs: [MASK, KILL, BEAR, OX] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Kill', 'hand', 'p1') }), { targets: [[obj(bear)]] });
    s = settle(pass(pass(s)));
    // the trigger asks for its target: the Bear card in the graveyard is not among the legal ones
    expect(s.pending?.kind).toBe('chooseTargets');
    const offered = (s.pending as unknown as { objects: ObjectId[] }).objects.map((id) => s.objects[id]!.defId);
    expect(offered).toEqual(['Test Ox']);
    s = drain(settle(s, { targets: [[obj(find(s, 'Test Ox', 'graveyard', 'p1'))]] }));
    expect(find(s, 'Test Ox', 'battlefield', 'p1')).toBeDefined();
    expect(s.zones.exile.map((id) => s.objects[id]!.defId)).toEqual(['Test Bear']);
  });
});

describe('CR 701.23a, 701.23b: "Search your hand and/or library for a Dragon card and put it onto the battlefield. If you search your library this way, shuffle."', () => {
  const LIGHT = card('Test Light', 'Sorcery', 'Search your hand and/or library for a Bear card and put it onto the battlefield. If you search your library this way, shuffle.');
  it('a Bear card from the hand or the library enters', () => {
    expect(automated(LIGHT)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Light', 'Test Bear'], library: ['Test Ox'] }, defs: [LIGHT, BEAR, OX] });
    s = cast(s, 'Test Light', { answers: [{ kind: 'chooseOption', ids: ['hand', 'library'] }], picks: [[find(s, 'Test Bear', 'hand', 'p1')]] });
    expect(find(s, 'Test Bear', 'battlefield', 'p1')).toBeDefined();
  });
});

describe('CR 603.12, 603.4, 608.2c: "When you do, if it has four or more quest counters on it, put a +1/+1 counter on target creature you control. It gains trample until end of turn."', () => {
  const ASC = card('Test Ascension', 'Enchantment', 'Whenever a land you control enters, put a quest counter on this enchantment. When you do, if it has two or more quest counters on it, put a +1/+1 counter on target creature you control. It gains trample until end of turn.');
  it('the trample sentence is part of the reflexive trigger\'s condition: below the count nothing happens, at it the target gets the counter and trample', () => {
    expect(automated(ASC)).toBe(true);
    const steps = (ASC.faces[0]!.abilities[0] as unknown as { effect: { steps: { op: string; do?: { op: string; then?: { op: string }[] }[] }[] } }).effect.steps;
    expect(steps.map((x) => x.op)).toEqual(['putCounters', 'reflexive']);
    expect(steps[1]!.do!.map((x) => x.op)).toEqual(['if']);
    expect(steps[1]!.do![0]!.then!.map((x) => x.op)).toEqual(['putCounters', 'effect']);
    let s = scenario([], { p1: { hand: ['Test Peak', 'Test Peak'], battlefield: ['Test Ascension', 'Test Bear'] }, defs: [ASC, PEAK, BEAR] });
    const asc = find(s, 'Test Ascension', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = drain(settle(act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Peak', 'hand', 'p1') }), { targets: [[obj(bear)]] }), { targets: [[obj(bear)]] });
    expect(s.objects[asc]!.counters['quest']).toBe(1);
    expect(s.objects[bear]!.counters['+1/+1'] ?? 0).toBe(0);
    expect(keywords(s, bear)).not.toContain('trample');
    s = scenario([], { p1: { hand: ['Test Peak'], battlefield: [{ name: 'Test Ascension', counters: { quest: 1 } }, 'Test Bear'] }, defs: [ASC, PEAK, BEAR] });
    const b2 = find(s, 'Test Bear', 'battlefield', 'p1');
    s = drain(settle(act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Peak', 'hand', 'p1') }), { targets: [[obj(b2)]] }), { targets: [[obj(b2)]] });
    expect(s.objects[b2]!.counters['+1/+1']).toBe(1);
    expect(keywords(s, b2)).toContain('trample');
  });
});

describe('CR 603.4, 603.12 (wave 7 review): "When you do, if ..." is an intervening "if": the reflexive ability does not trigger, and no target is chosen, while it is false', () => {
  const ASC = card('Test Ascension', 'Enchantment', 'Whenever a land you control enters, put a quest counter on this enchantment. When you do, if it has two or more quest counters on it, put a +1/+1 counter on target creature you control. It gains trample until end of turn.');
  it('below the count no target is asked for and nothing goes on the stack; at the count the trigger targets and resolves', () => {
    const refl = (ASC.faces[0]!.abilities[0] as unknown as { effect: { steps: { op: string; when?: { if?: unknown }; do?: { cond?: unknown }[] }[] } }).effect.steps[1]!;
    expect(refl.op).toBe('reflexive');
    expect(refl.when!.if).toEqual(refl.do![0]!.cond); // checked when it would trigger, and again on resolution (the `if` kept in `do`)
    let s = scenario([], { p1: { hand: ['Test Peak'], battlefield: ['Test Ascension', 'Test Bear'] }, defs: [ASC, PEAK, BEAR] });
    s = settle(act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Peak', 'hand', 'p1') }));
    for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 12; guard++) {
      s = settle(pass(pass(s)));
      expect(s.pending?.kind).not.toBe('chooseTargets');
    }
    expect(s.zones.stack.length).toBe(0);
    expect(s.objects[find(s, 'Test Ascension', 'battlefield', 'p1')]!.counters['quest']).toBe(1);
    s = scenario([], { p1: { hand: ['Test Peak'], battlefield: [{ name: 'Test Ascension', counters: { quest: 1 } }, 'Test Bear'] }, defs: [ASC, PEAK, BEAR] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = drain(settle(act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Peak', 'hand', 'p1') }), { targets: [[obj(bear)]] }), { targets: [[obj(bear)]] });
    expect(s.objects[bear]!.counters['+1/+1']).toBe(1);
    expect(keywords(s, bear)).toContain('trample');
  });
});

describe('CR 401.3: "put <object> into its owner\'s library third from the top", also for each opponent', () => {
  const TIDE = card('Test Tide', 'Sorcery', "For each opponent, put up to one target nonland permanent that player controls into its owner's library third from the top.");
  it('the permanent is the third card of its owner\'s library', () => {
    expect(automated(TIDE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Tide'] }, p2: { battlefield: ['Test Rock'], library: ['Test Peak', 'Test Peak', 'Test Peak'] }, defs: [TIDE, ROCK, PEAK] });
    s = cast(s, 'Test Tide', { targets: [[obj(find(s, 'Test Rock', 'battlefield', 'p2'))]] });
    expect(zoneNames(s, 'library', 'p2').slice(0, 4)).toEqual(['Test Peak', 'Test Peak', 'Test Rock', 'Test Peak']);
  });
});

describe('CR 111.1, 122.1, 109.2: "Create a 2/2 Wizard creature token, then put a +1/+1 counter on each other Wizard token you control."', () => {
  const STAGE = card('Test Stage', 'Sorcery', 'Create a 2/2 colorless Wizard creature token, then put a +1/+1 counter on each other Wizard token you control.');
  it('the token just created gets no counter, the other Wizard tokens one each', () => {
    expect(automated(STAGE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Stage', 'Test Stage'] }, defs: [STAGE] });
    s = cast(s, 'Test Stage');
    s = cast(s, 'Test Stage');
    const counts = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').map((id) => s.objects[id]!.counters['+1/+1'] ?? 0).sort();
    expect(counts).toEqual([0, 1]);
  });
});

describe('CR 603.7, 503.1: "Sacrifice that token at the beginning of the next upkeep."', () => {
  const RAID = card('Test Raid', 'Sorcery', 'Create a 1/1 red Goblin creature token. Sacrifice that token at the beginning of the next upkeep.');
  it('the token stays this turn and is sacrificed at the next upkeep', () => {
    expect(automated(RAID)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Raid'] }, defs: [RAID] });
    s = cast(s, 'Test Raid');
    const tok = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(tok).toBeDefined();
    for (let g = 0; g < 200 && !(s.turn.step === 'upkeep' && s.turn.number === 2 && s.zones.stack.length > 0); g++) {
      if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (s.pending?.kind === 'priority') s = pass(s);
      else s = settle(s);
    }
    expect(s.zones.battlefield).toContain(tok);
    s = drain(s);
    expect(s.zones.battlefield).not.toContain(tok);
  });
});

describe('CR 701.23a, 201.2, 607.2d: "Choose a card name. Search target opponent\'s graveyard, hand, and library for up to four cards with that name and exile them. Then that player shuffles."', () => {
  const FEUD = card('Test Feud', 'Sorcery', "Choose a card name. Search target opponent's graveyard, hand, and library for up to four cards with that name and exile them. Then that player shuffles.");
  it('only cards of that name, from the opponent\'s three zones, are exiled', () => {
    expect(automated(FEUD)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Feud'], graveyard: ['Test Bear'] }, p2: { hand: ['Test Bear', 'Test Rock'], graveyard: ['Test Bear'], library: ['Test Bear', 'Test Ox'] }, defs: [FEUD, BEAR, ROCK, OX] });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Feud', 'hand', 'p1') }), { targets: [[player('p2')]] });
    s = settle(pass(pass(s)));
    expect(s.pending?.kind).toBe('chooseName');
    s = settle(answer(s, { kind: 'chooseName', name: 'Test Bear' }));
    const offered = pendingOptions(s).map((id) => s.objects[id]!.defId);
    expect(offered.every((n) => n === 'Test Bear')).toBe(true);
    expect(offered).toHaveLength(3); // the opponent's three Bears, never yours
    s = drain(settle(s, { picks: [pendingOptions(s)] }));
    expect(s.zones.exile.map((id) => s.objects[id]!.defId)).toEqual(['Test Bear', 'Test Bear', 'Test Bear']);
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Bear');
  });
});

describe('CR 119.3, 701.23a: "that player loses 3 life, searches their library for a card, puts it into their hand, then shuffles."', () => {
  const ARIA = card('Test Aria', 'Sorcery', 'Target opponent loses 3 life, searches their library for a card, puts it into their hand, then shuffles.');
  it('the opponent loses the life and puts a card of their library into their hand', () => {
    expect(automated(ARIA)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Aria'] }, p2: { library: ['Test Rock', 'Test Ox'] }, defs: [ARIA, ROCK, OX] });
    const handBefore = zoneNames(s, 'hand', 'p2').length;
    s = cast(s, 'Test Aria', { targets: [[player('p2')]], picks: [[find(s, 'Test Ox', 'library', 'p2')]] });
    expect(life(s, 'p2')).toBe(17);
    expect(zoneNames(s, 'hand', 'p2')).toContain('Test Ox');
    expect(zoneNames(s, 'hand', 'p2')).toHaveLength(handBefore + 1);
  });
});

describe('CR 120.1, 120.3: "Each creature you control deals 1 damage to that creature."', () => {
  const GANG = card('Test Gang', 'Sorcery', 'Each creature you control deals 1 damage to target creature you don\'t control.');
  it('each of your creatures deals 1 damage', () => {
    expect(automated(GANG)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Gang'], battlefield: ['Test Bear', 'Test Bear', 'Test Ox'] }, p2: { battlefield: ['Test Ox'] }, defs: [GANG, BEAR, OX] });
    const ox = find(s, 'Test Ox', 'battlefield', 'p2');
    s = cast(s, 'Test Gang', { targets: [[obj(ox)]] });
    expect(s.objects[ox]!.damage).toBe(3); // three creatures, 1 damage each
  });
});

describe('CR 205.1b, 613.4b: "Each of them is a 1/1 Spirit in addition to its other types."', () => {
  const RAISE = card('Test Raise', 'Sorcery', 'Return all creature cards from your graveyard to the battlefield. Each of them is a 1/1 Spirit in addition to its other types.');
  it('each returned creature is a 1/1 Spirit and keeps its types', () => {
    expect(automated(RAISE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Raise'], graveyard: ['Test Bear', 'Test Ox'] }, defs: [RAISE, BEAR, OX] });
    s = cast(s, 'Test Raise');
    for (const name of ['Test Bear', 'Test Ox']) {
      const c = getChars(s, find(s, name, 'battlefield', 'p1'));
      expect(c.subtypes).toContain('Spirit');
      expect([Number(c.power), Number(c.toughness)]).toEqual([1, 1]);
    }
  });
});
