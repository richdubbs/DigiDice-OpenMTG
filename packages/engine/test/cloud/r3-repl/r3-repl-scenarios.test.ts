/**
 * Cloud r3-repl (Standard round 3: replacement and prevention effects): the shapes of parser/templates/zz-cloud/r3-repl.json and the engine readings this slice
 * added, played through the engine with synthetic cards compiled by the game's default compiler (invented names, numbers and wordings, design 6.10). Each test
 * is named after the rule it checks.
 *
 *   CR 614.1a, 111.1, 616.1e   "If one or more creature tokens would be created under your control, three times that many ... instead": only creature tokens
 *   CR 614.1a, 700.4, 603.12   "If a creature an opponent controls would die, exile it instead. When you do, <effect>": a reflexive trigger after the move
 *   CR 614.1a, 614.6, 119.3    "If a nontoken creature an opponent controls would die, instead exile it and you gain N life"
 *   CR 614.1a, 701.17a         "If an opponent would mill one or more cards, they mill that many cards plus N instead": the mill proposal
 *   CR 614.1c, 614.12, 202.3   "Each other ... enters with an additional +1/+1 counter on it if its mana value is N or less. Otherwise, ... three ..."
 *   CR 614.1a, 122.6, 122.6a   "If you would put one or more counters on a permanent or player, put twice that many ...": effects, entering counters, costs
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, life, passBoth, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string], colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** Answer the decisions of an announcement or a resolution (targets in order; yes/no; payment automatic) until the next priority decision. */
function drive(s0: GameState, targets: TargetChoice[][] = [], yes: boolean[] = []): GameState {
  let s = s0;
  const t = [...targets];
  const y = [...yes];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: t.shift() ?? [] });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: y.shift() ?? false });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else if (p.kind === 'chooseReplacement') s = answer(s, { kind: 'chooseReplacement', id: p.options[0]!.id }); // CR 616.1: the affected player orders them
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const activate = (s: GameState, source: ObjectId, targets: TargetChoice[][] = [], player = 'p1', ability = 'p:0:0'): GameState => drive(act(s, { type: 'activate', player, source, ability }), targets);
const cast = (s: GameState, name: string, targets: TargetChoice[][] = [], player = 'p1'): GameState => drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), targets);
function resolveAll(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = drive(passBoth(s));
  return s;
}
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const named = (s: GameState, name: string, controller?: string): ObjectId[] =>
  s.zones.battlefield.filter((id) => s.objects[id]!.defId === name).filter((id) => controller === undefined || s.objects[id]!.controller === controller);
const tokensOf = (s: GameState, player: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === player);
const inZone = (s: GameState, name: string, zone: 'exile' | 'graveyard', owner = 'p2'): boolean =>
  (zone === 'exile' ? s.zones.exile : s.zones.graveyard[owner]!).some((id) => s.objects[id]!.defId === name);

const BEAR = card('Test Bear', 'Creature — Bear', '', '{2}', ['2', '2']);
const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');

// ---- token multiplier with a token filter (Ojer Taq) -------------------------------------------------------------------------------------------------------

const TRIPLER = card('Test Tripler', 'Enchantment', 'If one or more creature tokens would be created under your control, three times that many of those tokens are created instead.');
const SOLDIERS = card('Test Barracks', 'Artifact', '{T}: Create a 1/1 white Soldier creature token.');
const TREASURY = card('Test Treasury', 'Artifact', '{T}: Create a Treasure token.');

describe('Cloud r3-repl: "If one or more creature tokens would be created under your control, three times that many of those tokens are created instead."', () => {
  it('is automated', () => expect(full(TRIPLER)).toBe(true));
  it('CR 614.1a, 111.1: one Soldier token becomes three; a Treasure (not a creature) stays one', () => {
    let s = scenario([], { defs: [TRIPLER, SOLDIERS, TREASURY], p1: { battlefield: ['Test Tripler', 'Test Barracks', 'Test Treasury'] } });
    s = resolveAll(activate(s, find(s, 'Test Barracks', 'battlefield')));
    expect(tokensOf(s, 'p1')).toHaveLength(3);
    s = resolveAll(activate(s, find(s, 'Test Treasury', 'battlefield')));
    expect(tokensOf(s, 'p1')).toHaveLength(4);
  });
  it('CR 614.1a: an opponent\'s creature tokens are not tripled', () => {
    let s = scenario([], { defs: [TRIPLER, SOLDIERS], p1: { battlefield: ['Test Barracks'] }, p2: { battlefield: ['Test Tripler'] } });
    s = resolveAll(activate(s, find(s, 'Test Barracks', 'battlefield')));
    expect(tokensOf(s, 'p1')).toHaveLength(1);
  });
});

// ---- dies -> exile with a reflexive trigger (Head of the Hunt), dies -> instead exile and gain life (The Darkness Crystal) ---------------------------------

const HUNTER = card('Test Hunter', 'Creature — Wolf', 'If a creature an opponent controls would die, exile it instead. When you do, create a 1/1 white Spirit creature token.', '{3}', ['2', '2']);
const CRYSTAL = card('Test Crystal', 'Artifact', 'If a nontoken creature an opponent controls would die, instead exile it and you gain 3 life.');
const SPAWNER = card('Test Spawner', 'Artifact', '{T}: Create a 1/1 white Soldier creature token.');

describe('Cloud r3-repl: "If a creature an opponent controls would die, exile it instead. When you do, create ..."', () => {
  it('is automated', () => expect(full(HUNTER)).toBe(true));
  it('CR 614.1a, 700.4, 603.12: the opponent\'s Bear is exiled instead of dying, then the reflexive trigger creates a Spirit for you', () => {
    let s = scenario([], { defs: [HUNTER, KILL, BEAR], p1: { hand: ['Test Kill'], battlefield: ['Test Hunter'] }, p2: { battlefield: ['Test Bear'] } });
    s = resolveAll(cast(s, 'Test Kill', [[obj(find(s, 'Test Bear', 'battlefield', 'p2'))]]));
    expect(inZone(s, 'Test Bear', 'exile')).toBe(true);
    expect(inZone(s, 'Test Bear', 'graveyard')).toBe(false);
    expect(tokensOf(s, 'p1')).toHaveLength(1);
  });
  it('CR 614.1a: your own creature dies as usual and no token is created', () => {
    let s = scenario([], { defs: [HUNTER, KILL, BEAR], p1: { hand: ['Test Kill'], battlefield: ['Test Hunter', 'Test Bear'] } });
    s = resolveAll(cast(s, 'Test Kill', [[obj(find(s, 'Test Bear', 'battlefield', 'p1'))]]));
    expect(inZone(s, 'Test Bear', 'graveyard', 'p1')).toBe(true);
    expect(tokensOf(s, 'p1')).toHaveLength(0);
  });
});

describe('Cloud r3-repl: "If a nontoken creature an opponent controls would die, instead exile it and you gain N life."', () => {
  it('is automated', () => expect(full(CRYSTAL)).toBe(true));
  it('CR 614.1a, 614.6, 119.3: the opponent\'s Bear is exiled and you gain 3 life', () => {
    let s = scenario([], { defs: [CRYSTAL, KILL, BEAR], p1: { hand: ['Test Kill'], battlefield: ['Test Crystal'] }, p2: { battlefield: ['Test Bear'] } });
    s = resolveAll(cast(s, 'Test Kill', [[obj(find(s, 'Test Bear', 'battlefield', 'p2'))]]));
    expect(inZone(s, 'Test Bear', 'exile')).toBe(true);
    expect(life(s, 'p1')).toBe(23);
  });
  it('CR 614.1a: an opponent\'s creature token is not one of them: it dies and you gain no life', () => {
    let s = scenario([], { defs: [CRYSTAL, KILL, SPAWNER], p1: { hand: ['Test Kill'], battlefield: ['Test Crystal'] }, p2: { battlefield: ['Test Spawner'] } });
    s = act(s, { type: 'pass', player: 'p1' }); // p2 gets priority (CR 117.3d)
    s = resolveAll(activate(s, find(s, 'Test Spawner', 'battlefield', 'p2'), [], 'p2'));
    const token = tokensOf(s, 'p2')[0]!;
    s = resolveAll(cast(s, 'Test Kill', [[obj(token)]]));
    expect(tokensOf(s, 'p2')).toHaveLength(0);
    expect(life(s, 'p1')).toBe(20);
  });
});

// ---- mill plus N (The Water Crystal) -----------------------------------------------------------------------------------------------------------------------

const DRAIN = card('Test Drain', 'Artifact', 'If an opponent would mill one or more cards, they mill that many cards plus two instead.');
const MILLER = card('Test Miller', 'Artifact', '{T}: Target player mills two cards.');

describe('Cloud r3-repl: "If an opponent would mill one or more cards, they mill that many cards plus N instead."', () => {
  it('is automated', () => expect(full(DRAIN)).toBe(true));
  const lib = Array.from({ length: 10 }, () => 'Test Bear');
  it('CR 701.17a, 614.1a: an opponent told to mill two mills four', () => {
    let s = scenario([], { defs: [DRAIN, MILLER, BEAR], p1: { battlefield: ['Test Drain', 'Test Miller'], library: lib }, p2: { library: lib } });
    const before = s.zones.library['p2']!.length;
    s = resolveAll(activate(s, find(s, 'Test Miller', 'battlefield'), [[{ kind: 'player', id: 'p2' }]]));
    expect(s.zones.graveyard['p2']).toHaveLength(4);
    expect(s.zones.library['p2']).toHaveLength(before - 4);
  });
  it('CR 701.17a: your own mill is not changed', () => {
    let s = scenario([], { defs: [DRAIN, MILLER, BEAR], p1: { battlefield: ['Test Drain', 'Test Miller'], library: lib } });
    s = resolveAll(activate(s, find(s, 'Test Miller', 'battlefield'), [[{ kind: 'player', id: 'p1' }]]));
    expect(s.zones.graveyard['p1']).toHaveLength(2);
  });
});

// ---- entering counters split by mana value (Thunderous Velocipede) ------------------------------------------------------------------------------------------

const RAMP = card('Test Ramp', 'Artifact — Vehicle', 'Each other Vehicle and creature you control enters with an additional +1/+1 counter on it if its mana value is 3 or less. Otherwise, it enters with three additional +1/+1 counters on it.', '{2}', ['3', '3']);
const GIANT = card('Test Giant', 'Creature — Giant', '', '{5}', ['5', '5']);
const RELIC = card('Test Relic', 'Artifact', '', '{1}');
const LAND = card('Test Land', 'Land', '{T}: Add {C}.');
const LANDS = ['Test Land', 'Test Land', 'Test Land', 'Test Land', 'Test Land', 'Test Land', 'Test Land', 'Test Land'];

describe('Cloud r3-repl: "... enters with an additional +1/+1 counter on it if its mana value is N or less. Otherwise, it enters with three ..."', () => {
  it('is automated', () => expect(full(RAMP)).toBe(true));
  it('CR 614.1c, 614.12, 202.3: a mana value 2 Bear gets one counter, a mana value 5 Giant three, an artifact that is not a Vehicle none', () => {
    let s = scenario([], { defs: [RAMP, GIANT, BEAR, RELIC, LAND], p1: { hand: ['Test Bear', 'Test Giant', 'Test Relic'], battlefield: ['Test Ramp', ...LANDS] } });
    s = resolveAll(cast(s, 'Test Bear'));
    s = resolveAll(cast(s, 'Test Giant'));
    s = resolveAll(cast(s, 'Test Relic'));
    expect(s.objects[named(s, 'Test Bear')[0]!]!.counters['+1/+1']).toBe(1);
    expect(s.objects[named(s, 'Test Giant')[0]!]!.counters['+1/+1']).toBe(3);
    expect(s.objects[named(s, 'Test Relic')[0]!]!.counters['+1/+1']).toBeUndefined();
  });
});

// ---- counters you put, doubled (Innkeeper's Talent) --------------------------------------------------------------------------------------------------------

const KEEPER = card('Test Keeper', 'Enchantment', 'If you would put one or more counters on a permanent or player, put twice that many of each of those kinds of counters on that permanent or player instead.');
const TUTOR = card('Test Tutor', 'Creature — Human', '{T}: Put a +1/+1 counter on target creature.', '{1}', ['1', '1']);
const CHARGER = card('Test Charger', 'Artifact', '{T}: You get {E}{E}.');
const GROWER = card('Test Grower', 'Creature — Hydra', 'This creature enters with two +1/+1 counters on it.', '{2}', ['0', '0']);
const COSTLY = card('Test Costly', 'Creature — Elf', 'Put a +1/+1 counter on this creature: You gain 1 life. Activate only once each turn.', '{1}', ['1', '1']);

describe('Cloud r3-repl: "If you would put one or more counters on a permanent or player, put twice that many ... on that permanent or player instead."', () => {
  it('is automated', () => expect(full(KEEPER)).toBe(true));
  it('CR 614.1a, 122.6: a +1/+1 counter you put on any creature, an opponent\'s too, is two', () => {
    let s = scenario([], { defs: [KEEPER, TUTOR, BEAR], p1: { battlefield: ['Test Keeper', 'Test Tutor'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = resolveAll(activate(s, find(s, 'Test Tutor', 'battlefield'), [[obj(bear)]]));
    expect(s.objects[bear]!.counters['+1/+1']).toBe(2);
  });
  it('CR 122.6: counters you put on a player (energy) are doubled', () => {
    let s = scenario([], { defs: [KEEPER, CHARGER], p1: { battlefield: ['Test Keeper', 'Test Charger'] } });
    s = resolveAll(activate(s, find(s, 'Test Charger', 'battlefield')));
    expect(s.players.find((p) => p.id === 'p1')!.counters['energy']).toBe(4);
  });
  it('CR 122.6a: a permanent you control entering with counters gets twice as many (its controller puts them)', () => {
    let s = scenario([], { defs: [KEEPER, GROWER, LAND], p1: { hand: ['Test Grower'], battlefield: ['Test Keeper', 'Test Land', 'Test Land'] } });
    s = resolveAll(cast(s, 'Test Grower'));
    expect(s.objects[named(s, 'Test Grower')[0]!]!.counters['+1/+1']).toBe(4);
  });
  it('CR 118.3, 122.6: the counters a cost of yours puts are doubled', () => {
    let s = scenario([], { defs: [KEEPER, COSTLY], p1: { battlefield: ['Test Keeper', 'Test Costly'] } });
    const elf = find(s, 'Test Costly', 'battlefield');
    s = resolveAll(activate(s, elf));
    expect(s.objects[elf]!.counters['+1/+1']).toBe(2);
    expect(life(s, 'p1')).toBe(21);
  });
  const WALKER = compileCard({ name: 'Test Walker', layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Planeswalker — Testa', oracle_text: '+1: You gain 1 life.', colors: [], keywords: [], loyalty: '3' } as OracleCard);
  const SEASON = card('Test Season', 'Enchantment', 'If an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.');
  it('CR 606.4, 122.6, 614.1a: a +1 loyalty cost is a cost of yours putting counters: two loyalty counters', () => {
    let s = scenario([], { defs: [KEEPER, WALKER], p1: { battlefield: ['Test Keeper', { name: 'Test Walker', counters: { loyalty: 3 } }] } });
    const pw = find(s, 'Test Walker', 'battlefield');
    const before = s.objects[pw]!.counters['loyalty'] ?? 0;
    s = resolveAll(activate(s, pw));
    expect(s.objects[pw]!.counters['loyalty']).toBe(before + 2);
    expect(life(s, 'p1')).toBe(21);
  });
  it('CR 614.16, 606.4: "if an EFFECT would put" does not apply to a loyalty cost: one loyalty counter', () => {
    let s = scenario([], { defs: [SEASON, WALKER], p1: { battlefield: ['Test Season', { name: 'Test Walker', counters: { loyalty: 3 } }] } });
    const pw = find(s, 'Test Walker', 'battlefield');
    const before = s.objects[pw]!.counters['loyalty'] ?? 0;
    s = resolveAll(activate(s, pw));
    expect(s.objects[pw]!.counters['loyalty']).toBe(before + 1);
  });
  it('CR 614.1a: an opponent\'s counters are not doubled', () => {
    let s = scenario([], { defs: [KEEPER, TUTOR, BEAR], p1: { battlefield: ['Test Tutor', 'Test Bear'] }, p2: { battlefield: ['Test Keeper'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = resolveAll(activate(s, find(s, 'Test Tutor', 'battlefield'), [[obj(bear)]]));
    expect(s.objects[bear]!.counters['+1/+1']).toBe(1);
  });
});

// ---- a connive replaced (Leader, Super-Genius) -------------------------------------------------------------------------------------------------------------

const MENTOR = card('Test Mentor', 'Creature — Human', 'If a creature you control would connive, instead you draw a card, then that creature connives.', '{2}', ['1', '1']);
const SCHEMER = card('Test Schemer', 'Creature — Rogue', '{T}: This creature connives.', '{1}', ['1', '1']);

describe('Cloud r3-repl: "If a creature you control would connive, instead you draw a card, then that creature connives."', () => {
  it('is automated', () => expect(full(MENTOR)).toBe(true));
  it('CR 701.50a, 614.1a, 614.5: you draw a card, then the creature connives once (draw, discard, a counter for a nonland card): two cards drawn, one discarded', () => {
    let s = scenario([], { defs: [MENTOR, SCHEMER, BEAR], p1: { battlefield: ['Test Mentor', 'Test Schemer'], library: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'] } });
    const hand = s.zones.hand['p1']!.length;
    const schemer = find(s, 'Test Schemer', 'battlefield');
    s = resolveAll(activate(s, schemer));
    expect(s.zones.hand['p1']!.length).toBe(hand + 1);
    expect(s.zones.graveyard['p1']).toHaveLength(1);
    expect(s.objects[schemer]!.counters['+1/+1']).toBe(1); // the discarded card is a nonland card (a Bear)
  });
  it('CR 701.50a: without it the creature connives as usual: one card drawn, one discarded', () => {
    let s = scenario([], { defs: [SCHEMER, BEAR], p1: { battlefield: ['Test Schemer'], library: ['Test Bear', 'Test Bear', 'Test Bear'] } });
    const hand = s.zones.hand['p1']!.length;
    s = resolveAll(activate(s, find(s, 'Test Schemer', 'battlefield')));
    expect(s.zones.hand['p1']!.length).toBe(hand);
    expect(s.zones.graveyard['p1']).toHaveLength(1);
  });
});

// ---- noncombat damage raised to a power (Ojer Axonil) ------------------------------------------------------------------------------------------------------

const FORGE = card('Test Forge God', 'Creature — God', 'If a red source you control would deal an amount of noncombat damage less than this creature\'s power to an opponent, that source deals damage equal to this creature\'s power instead.', '{4}', ['4', '4'], ['R']);
const RED_PING = card('Test Red Pinger', 'Artifact Creature — Construct', '{T}: This creature deals 1 damage to any target.', '{1}', ['1', '1'], ['R']);
const BLUE_PING = card('Test Blue Pinger', 'Artifact Creature — Construct', '{T}: This creature deals 1 damage to any target.', '{1}', ['1', '1'], ['U']);
const BLAST = card('Test Blast', 'Instant', 'This spell deals 6 damage to any target.', '{0}', undefined, ['R']);
const P2: TargetChoice = { kind: 'player', id: 'p2' };

describe('Cloud r3-repl: "If a red source you control would deal an amount of noncombat damage less than ~\'s power to an opponent, that source deals damage equal to ~\'s power instead."', () => {
  it('is automated', () => expect(full(FORGE)).toBe(true));
  it('CR 614.1a, 120.2b, 208.1: a red source\'s 1 damage to an opponent is 4 (the power); 6 damage stays 6', () => {
    let s = scenario([], { defs: [FORGE, RED_PING, BLAST], p1: { hand: ['Test Blast'], battlefield: ['Test Forge God', 'Test Red Pinger'] } });
    s = resolveAll(activate(s, find(s, 'Test Red Pinger', 'battlefield'), [[P2]]));
    expect(life(s, 'p2')).toBe(16);
    s = resolveAll(cast(s, 'Test Blast', [[P2]]));
    expect(life(s, 'p2')).toBe(10);
  });
  it('CR 614.1a: a source that is not red, and damage to a creature, are not changed', () => {
    let s = scenario([], { defs: [FORGE, BLUE_PING, RED_PING, BEAR], p1: { battlefield: ['Test Forge God', 'Test Blue Pinger', 'Test Red Pinger'] }, p2: { battlefield: ['Test Bear'] } });
    s = resolveAll(activate(s, find(s, 'Test Blue Pinger', 'battlefield'), [[P2]]));
    expect(life(s, 'p2')).toBe(19);
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = resolveAll(activate(s, find(s, 'Test Red Pinger', 'battlefield'), [[obj(bear)]]));
    expect(s.objects[bear]!.damage).toBe(1);
  });
});

// ---- a self-replacement doubling a creature's damage to itself (Cut Propulsion) ----------------------------------------------------------------------------

const SNAP = card('Test Snap', 'Instant', 'Target creature deals damage to itself equal to its power. If that creature has flying, it deals twice that much damage to itself instead.');
const BIRD = card('Test Bird', 'Creature — Bird', 'Flying', '{2}', ['2', '5']);
const OX = card('Test Ox', 'Creature — Ox', '', '{2}', ['2', '5']);

describe('Cloud r3-repl: "... deals damage to itself equal to its power. If that creature has flying, it deals twice that much damage to itself instead."', () => {
  it('is automated', () => expect(full(SNAP)).toBe(true));
  it('CR 614.15, 608.2c, 120.3: a 2/5 flier deals 4 damage to itself; a 2/5 without flying deals 2', () => {
    let s = scenario([], { defs: [SNAP, BIRD, OX], p1: { hand: ['Test Snap', 'Test Snap'] }, p2: { battlefield: ['Test Bird', 'Test Ox'] } });
    const bird = find(s, 'Test Bird', 'battlefield', 'p2');
    const ox = find(s, 'Test Ox', 'battlefield', 'p2');
    s = resolveAll(cast(s, 'Test Snap', [[obj(bird)]]));
    expect(s.objects[bird]!.damage).toBe(4);
    s = resolveAll(cast(s, 'Test Snap', [[obj(ox)]]));
    expect(s.objects[ox]!.damage).toBe(2);
  });
});

// ---- "each with" after a plural target description (Dewdrop Cure) ------------------------------------------------------------------------------------------

const DEW = card('Test Dew', 'Sorcery', 'Return up to two target creature cards each with mana value 2 or less from your graveyard to the battlefield.');
const GIANT2 = card('Test Big Giant', 'Creature — Giant', '', '{5}', ['5', '5']);

describe('Cloud r3-repl: "up to two target creature cards each with mana value 2 or less"', () => {
  it('is automated', () => expect(full(DEW)).toBe(true));
  it('CR 115.1, 202.3: a mana value 2 card can be chosen, a mana value 5 card cannot', () => {
    let s = scenario([], { defs: [DEW, BEAR, GIANT2], p1: { hand: ['Test Dew'], graveyard: ['Test Bear', 'Test Big Giant'] } });
    const bear = s.zones.graveyard['p1']!.find((id) => s.objects[id]!.defId === 'Test Bear')!;
    const giant = s.zones.graveyard['p1']!.find((id) => s.objects[id]!.defId === 'Test Big Giant')!;
    expect(() => cast(s, 'Test Dew', [[obj(giant)]])).toThrow();
    s = resolveAll(cast(s, 'Test Dew', [[obj(bear)]]));
    expect(named(s, 'Test Bear')).toHaveLength(1);
  });
});

// ---- all damage to you and your other permanents redirected (Ancient Adamantoise) ------------------------------------------------------------------------

const SHELL = card('Test Shell', 'Creature — Turtle', 'All damage that would be dealt to you and other permanents you control is dealt to this creature instead.', '{4}', ['0', '10']);
const BOLT2 = card('Test Bolt Two', 'Instant', 'This spell deals 2 damage to any target.');

describe('Cloud r3-repl: "All damage that would be dealt to you and other permanents you control is dealt to ~ instead."', () => {
  it('is automated', () => expect(full(SHELL)).toBe(true));
  it('CR 614.9: damage to you and to your Bear is dealt to the Shell instead; damage to the opponent is not', () => {
    let s = scenario([], { defs: [SHELL, BOLT2, BEAR], p1: { hand: ['Test Bolt Two', 'Test Bolt Two', 'Test Bolt Two'] }, p2: { battlefield: ['Test Shell', 'Test Bear'] } });
    const shell = find(s, 'Test Shell', 'battlefield', 'p2');
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = resolveAll(cast(s, 'Test Bolt Two', [[P2]]));
    expect(life(s, 'p2')).toBe(20);
    expect(s.objects[shell]!.damage).toBe(2);
    s = resolveAll(cast(s, 'Test Bolt Two', [[obj(bear)]]));
    expect(s.objects[bear]!.damage).toBe(0);
    expect(s.objects[shell]!.damage).toBe(4);
    s = resolveAll(cast(s, 'Test Bolt Two', [[{ kind: 'player', id: 'p1' }]]));
    expect(life(s, 'p1')).toBe(18);
  });
});

// ---- one more token after the tokens you create (Worldwalker Helm) ---------------------------------------------------------------------------------------

const HELM = card('Test Helm', 'Artifact', 'If you would create one or more artifact tokens, instead create those tokens plus an additional Food token.');
const foods = (s: GameState): number => tokensOf(s, 'p1').filter((id) => s.objects[id]!.defId.includes('Food')).length;

describe('Cloud r3-repl: "If you would create one or more artifact tokens, instead create those tokens plus an additional Food token."', () => {
  it('is automated', () => expect(full(HELM)).toBe(true));
  it('CR 614.1a, 614.5: a Treasure comes with one Food, and the Food (an artifact token) brings no other Food', () => {
    let s = scenario([], { defs: [HELM, TREASURY], p1: { battlefield: ['Test Helm', 'Test Treasury'] } });
    s = resolveAll(activate(s, find(s, 'Test Treasury', 'battlefield')));
    expect(tokensOf(s, 'p1')).toHaveLength(2);
    expect(foods(s)).toBe(1);
  });
  it('CR 614.1a: a creature token comes alone', () => {
    let s = scenario([], { defs: [HELM, SOLDIERS], p1: { battlefield: ['Test Helm', 'Test Barracks'] } });
    s = resolveAll(activate(s, find(s, 'Test Barracks', 'battlefield')));
    expect(tokensOf(s, 'p1')).toHaveLength(1);
  });
  it('CR 614.5, 616.1: with two of them each applies once to the event: a Treasure and two Foods', () => {
    let s = scenario([], { defs: [HELM, TREASURY], p1: { battlefield: ['Test Helm', 'Test Helm', 'Test Treasury'] } });
    s = resolveAll(drive(activate(s, find(s, 'Test Treasury', 'battlefield'))));
    expect(tokensOf(s, 'p1')).toHaveLength(3);
    expect(foods(s)).toBe(2);
  });
  const LIVES = card('Test Lives', 'Enchantment', 'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.');
  /** Activate the Treasury with the Helm and the doubler out, applying `first` first (CR 616.1: the affected player orders the two effects). */
  function withDoubler(first: string): GameState {
    let s = scenario([], { defs: [HELM, LIVES, TREASURY], p1: { battlefield: ['Test Helm', 'Test Lives', 'Test Treasury'] } });
    s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Treasury', 'battlefield'), ability: 'p:0:0' });
    let chosen = 0;
    for (let i = 0; i < 40; i++) {
      const p = s.pending;
      if (p?.kind === 'chooseReplacement') {
        chosen++;
        s = answer(s, { kind: 'chooseReplacement', id: (p.options.find((x) => x.label.startsWith(first)) ?? p.options[0]!).id });
      } else if (p?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p?.kind === 'priority' && s.zones.stack.length > 0) s = passBoth(s);
      else break;
    }
    expect(chosen).toBeGreaterThan(0);
    return s;
  }
  it('CR 616.1e, 614.1a: Helm first, then a doubling: the Food is part of the modified event, so it is doubled too (two Treasures, two Foods)', () => {
    const s = withDoubler('Test Helm');
    expect(tokensOf(s, 'p1')).toHaveLength(4);
    expect(foods(s)).toBe(2);
  });
  it('CR 616.1e, 614.5: the doubling first, then Helm: two Treasures and one Food (the doubling never saw the Food)', () => {
    const s = withDoubler('Test Lives');
    expect(tokensOf(s, 'p1')).toHaveLength(3);
    expect(foods(s)).toBe(1);
  });
});
