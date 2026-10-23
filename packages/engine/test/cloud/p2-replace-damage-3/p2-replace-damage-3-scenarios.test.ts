/**
 * Phase 2 lane p2-replace-damage, round p2-replace-damage-3: the round's damage redirections played through the engine with synthetic cards (invented names, design
 * 6.10), compiled by the game's default compiler. Each test is named after the rule it checks and has its negative case. CR cites from memory, unverified (rules/cr/
 * is not in the cloud checkout).
 *
 *   CR 614.9, 611.2a        "All damage that would be dealt to target creature this turn is dealt to you instead.": that creature's damage, to you; another's is not
 *   CR 614.9, 510.2          "All combat damage that would be dealt to you this turn is dealt to target attacking creature instead.": the attacker is dealt it
 *   CR 614.9, 615.7          "The next 2 damage that would be dealt to target creature this turn is dealt to you instead.": a budget of 2, then used up
 *   CR 614.9, 609.7a         "The next time a source of your choice would deal damage to you this turn, that damage is dealt to ~ instead.": that source, once
 *   CR 614.9, 609.7a         "The next time a source of your choice would deal damage to target creature this turn, that damage is dealt to ~ instead.": that recipient only
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, advanceTo, find, legal, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Every ability of the card automated (no manual ability, no manual step). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
type Target = { kind: 'player'; id: PlayerId } | { kind: 'object'; id: ObjectId };
const P1: Target = { kind: 'player', id: 'p1' };
const P2: Target = { kind: 'player', id: 'p2' };
const obj = (id: ObjectId): Target => ({ kind: 'object', id });
const marked = (s: GameState, id: ObjectId): number => s.objects[id]!.damage;

/** Answer the decisions that come up until priority (payments automatic; targets in order; object choices from `objects` in order, else the first allowed). */
function drive(s0: GameState, targets: Target[][] = [], objects: ObjectId[][] = []): GameState {
  let s = s0;
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: objects.shift() ?? p.options.slice(0, Math.max(1, p.min)) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, targets: Target[][] = [], objects: ObjectId[][] = []): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), targets, objects);
  return s;
}
const cast = (s: GameState, name: string, targets: Target[][] = [], objects: ObjectId[][] = []): GameState =>
  resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), targets, objects), targets, objects);
/** `player` activates the first ability of `src` (p2 gets priority by p1 passing first), and the stack resolves. */
function activate(s0: GameState, src: ObjectId, targets: Target[][] = [], player: PlayerId = 'p1'): GameState {
  let s = s0;
  if (player === 'p2') s = pass(s);
  const a = legal(s, player, 'activate').find((x) => x.object === src);
  if (a === undefined) throw new Error(`no activation of ${src} for ${player}`);
  return resolveAll(drive(act(s, a.action), targets), targets);
}
/** Pass to the declare-attackers decision, attack p2 with `attackers`, and play on until combat damage was dealt (no blocks). */
function attackAndDamage(s0: GameState, attackers: ObjectId[]): GameState {
  let s = s0;
  for (let i = 0; i < 60 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
  s = answer(s, { kind: 'declareAttackers', attacks: attackers.map((attacker) => ({ attacker, defender: 'p2' })) });
  for (let i = 0; i < 60 && s.turn.step !== 'endCombat' && s.turn.step !== 'main2'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
  return s;
}

const RED_BLASTER = card('Test Red Blaster', 'Creature — Goblin', '{0}: This creature deals 3 damage to any target.', { pt: ['1', '1'], colors: ['R'] });
const BLUE_BLASTER = card('Test Blue Blaster', 'Creature — Merfolk', '{0}: This creature deals 3 damage to any target.', { pt: ['1', '1'], colors: ['U'] });
const BEAR = card('Test Brown Bear', 'Creature — Bear', '', { pt: ['2', '20'] });
const BASE = [RED_BLASTER, BLUE_BLASTER, BEAR];

describe('CR 614.9, 611.2a: "All damage that would be dealt to target creature this turn is dealt to you instead."', () => {
  const VALOR = card('Test Stand In', 'Instant', 'All damage that would be dealt to target creature this turn is dealt to you instead.');
  const defs = [...BASE, VALOR];
  it('is automated', () => expect(full(VALOR)).toBe(true));
  it('the damage to that creature is dealt to you instead; damage to another creature is not moved', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Stand In'], battlefield: ['Test Red Blaster', 'Test Brown Bear'] }, p2: { battlefield: ['Test Brown Bear'] } });
    const bear = find(s0, 'Test Brown Bear', 'battlefield', 'p1');
    const other = find(s0, 'Test Brown Bear', 'battlefield', 'p2');
    const red = find(s0, 'Test Red Blaster', 'battlefield');
    const s1 = cast(s0, 'Test Stand In', [[obj(bear)]]);
    const s2 = activate(s1, red, [[obj(bear)]]);
    expect(marked(s2, bear)).toBe(0);
    expect(life(s2, 'p1')).toBe(20 - 3);
    expect(marked(activate(s1, red, [[obj(other)]]), other)).toBe(3);
  });
});

describe('CR 614.9, 510.2: "All combat damage that would be dealt to you this turn is dealt to target attacking creature instead."', () => {
  const TABLES = card('Test Turnabout', 'Instant', 'All combat damage that would be dealt to you this turn is dealt to target attacking creature instead.');
  const defs = [...BASE, TABLES];
  it('is automated', () => expect(full(TABLES)).toBe(true));
  it('the attacker\'s combat damage to you is dealt to it instead', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Turnabout'], battlefield: ['Test Red Blaster'] }, p2: { battlefield: ['Test Brown Bear'] } });
    let s = advanceTo(s0, 2, 'declareAttackers');
    const bear = find(s, 'Test Brown Bear', 'battlefield', 'p2');
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p1' }] });
    for (let i = 0; i < 10 && !(s.pending?.kind === 'priority' && s.pending.player === 'p1'); i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Turnabout', 'hand', 'p1') }), [[obj(bear)]]));
    for (let i = 0; i < 60 && s.turn.step !== 'endCombat' && s.turn.step !== 'main2'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    expect(life(s, 'p1')).toBe(20);
    expect(marked(s, bear)).toBe(2);
  });
  it('only combat damage to you is replaced (the event pattern names combat damage)', () => {
    expect(JSON.stringify(TABLES.faces)).toContain('"replaces":{"ev":"damage","combat":true,"recipient":{"player":"you"}}');
  });
});

describe('CR 614.9, 615.7: "The next 2 damage that would be dealt to target creature this turn is dealt to you instead."', () => {
  const DUTY = card('Test Liege Oath', 'Instant', 'The next 2 damage that would be dealt to target creature this turn is dealt to you instead.');
  const defs = [...BASE, DUTY];
  it('is automated', () => expect(full(DUTY)).toBe(true));
  it('of 3 damage, 2 are dealt to you and 1 to the creature; the next 3 are all the creature\'s', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Liege Oath'], battlefield: ['Test Red Blaster', 'Test Brown Bear'] } });
    const bear = find(s0, 'Test Brown Bear', 'battlefield');
    const red = find(s0, 'Test Red Blaster', 'battlefield');
    const s1 = activate(cast(s0, 'Test Liege Oath', [[obj(bear)]]), red, [[obj(bear)]]);
    expect(marked(s1, bear)).toBe(1);
    expect(life(s1, 'p1')).toBe(20 - 2);
    const s2 = activate(s1, red, [[obj(bear)]]);
    expect(marked(s2, bear)).toBe(4);
    expect(life(s2, 'p1')).toBe(20 - 2);
  });
});

describe('CR 614.9, 609.7a: "The next time a source of your choice would deal damage to you this turn, that damage is dealt to ~ instead."', () => {
  const BEACON = card('Test Signal Fire', 'Creature — Human', '{0}: The next time a source of your choice would deal damage to you this turn, that damage is dealt to this creature instead.', { pt: ['1', '20'] });
  const defs = [...BASE, BEACON];
  it('is automated', () => expect(full(BEACON)).toBe(true));
  it('the chosen source\'s damage to you is dealt to it, once; another source\'s damage is not moved', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Signal Fire', 'Test Red Blaster', 'Test Blue Blaster'] } });
    const beacon = find(s0, 'Test Signal Fire', 'battlefield');
    const red = find(s0, 'Test Red Blaster', 'battlefield');
    let s = s0;
    const a = legal(s, 'p1', 'activate').find((x) => x.object === beacon)!;
    s = resolveAll(drive(act(s, a.action)), [], [[red]]);
    const s2 = activate(s, find(s, 'Test Blue Blaster', 'battlefield'), [[P1]]);
    expect(life(s2, 'p1')).toBe(20 - 3);
    const s3 = activate(s2, red, [[P1]]);
    expect(life(s3, 'p1')).toBe(20 - 3);
    expect(marked(s3, beacon)).toBe(3);
    expect(life(activate(s3, red, [[P1]]), 'p1')).toBe(20 - 6);
  });
});

describe('CR 614.9, 609.7a: "The next time a source of your choice would deal damage to target creature this turn, that damage is dealt to ~ instead."', () => {
  const SHAMAN = card('Test Ward Shaman', 'Creature — Kor Shaman', '{0}: The next time a source of your choice would deal damage to target creature this turn, that damage is dealt to this creature instead.', { pt: ['1', '20'] });
  const defs = [...BASE, SHAMAN];
  it('is automated', () => expect(full(SHAMAN)).toBe(true));
  it('the chosen source\'s damage to the target is dealt to it; its damage to you is not moved', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Ward Shaman', 'Test Red Blaster', 'Test Brown Bear'] } });
    const shaman = find(s0, 'Test Ward Shaman', 'battlefield');
    const bear = find(s0, 'Test Brown Bear', 'battlefield');
    const red = find(s0, 'Test Red Blaster', 'battlefield');
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === shaman)!;
    const s1 = resolveAll(drive(act(s0, a.action), [[obj(bear)]]), [], [[red]]);
    expect(life(activate(s1, red, [[P1]]), 'p1')).toBe(20 - 3);
    const s2 = activate(s1, red, [[obj(bear)]]);
    expect(marked(s2, bear)).toBe(0);
    expect(marked(s2, shaman)).toBe(3);
  });
});
