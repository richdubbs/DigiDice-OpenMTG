/**
 * Phase 2 lane p2-replace-damage, round p2-replace-damage-1: the round's prevention readings played through the engine with synthetic cards (invented names, design
 * 6.10), compiled by the game's default compiler. Each test is named after the rule it checks and has its negative case. CR cites from memory, unverified (rules/cr/
 * is not in the cloud checkout).
 *
 *   CR 615.7, 615.1a, 105.2   "If a red source would deal damage to you, prevent 2 of that damage.": 2 of each damage event from a red source; a blue source's is not
 *   CR 615.7, 109.4           "If a source an opponent controls would deal damage to you, prevent 1 of that damage.": an opponent's source, never your own
 *   CR 615.7, 120.3           "If a source would deal damage to a Cleric creature you control, prevent 1 of that damage.": a Cleric only
 *   CR 615.7, 107.3, 611.3a   "... prevent X of that damage, where X is the number of creatures you control.": X counted as the damage would be dealt
 *   CR 615.1a, 611.2a         "Prevent all damage that would be dealt to target creature this turn.": that creature only
 *   CR 615.1a, 510.2          "Prevent all combat damage target creature would deal this turn.": its combat damage, not its noncombat damage
 *   CR 609.7a, 615.1a         "Prevent all damage a source of your choice would deal this turn." / "... to you this turn.": the chosen source only (and to you only)
 *   CR 615.1a, 120.3          "Prevent all damage that would be dealt to ~ by artifact creatures.": an artifact creature's damage only
 *   CR 615.1a, 109.4          "Prevent all damage that would be dealt to you by sources you don't control.": not your own sources
 *   CR 615.1a, 510.2          "Prevent all combat damage that would be dealt to and dealt by creatures you control.": combat damage by them; noncombat damage to them is dealt
 *   CR 615.7, 107.3           "Prevent the next X damage that would be dealt to target creature this turn, where X is ...": a shield of X, used up
 *   CR 615.1a, 102.1          "Prevent all combat damage that would be dealt to players this turn.": combat damage to a player only
 *   CR 615.1a, 611.2a         "Prevent all damage that would be dealt to you and creatures you control this turn.": you and your creatures, not the opponent
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, findAll, legal, life, pass, scenario } from '../../m3/scenario';

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
const ARTIFACT_BLASTER = card('Test Iron Blaster', 'Artifact Creature — Construct', '{0}: This creature deals 3 damage to any target.', { pt: ['1', '1'] });
const BEAR = card('Test Brown Bear', 'Creature — Bear', '', { pt: ['2', '5'] });
const CLERIC = card('Test Kind Cleric', 'Creature — Human Cleric', '', { pt: ['1', '5'] });
const BASE = [RED_BLASTER, BLUE_BLASTER, ARTIFACT_BLASTER, BEAR, CLERIC];

describe('CR 615.7, 615.1a, 105.2: "If a red source would deal damage to you, prevent 2 of that damage."', () => {
  const SPHERE = card('Test Ruby Sphere', 'Enchantment', 'If a red source would deal damage to you, prevent 2 of that damage.');
  const defs = [...BASE, SPHERE];
  it('is automated', () => expect(full(SPHERE)).toBe(true));
  it('CR 615.7: 2 of each damage event from a red source is prevented, again for a second event', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Ruby Sphere', 'Test Red Blaster'] } });
    const red = find(s0, 'Test Red Blaster', 'battlefield');
    const s1 = activate(s0, red, [[P1]]);
    expect(life(s1, 'p1')).toBe(20 - 1);
    expect(life(activate(s1, red, [[P1]]), 'p1')).toBe(20 - 2);
  });
  it('a blue source is not prevented, nor is red damage to the opponent', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Ruby Sphere', 'Test Blue Blaster', 'Test Red Blaster'] } });
    expect(life(activate(s0, find(s0, 'Test Blue Blaster', 'battlefield'), [[P1]]), 'p1')).toBe(20 - 3);
    expect(life(activate(s0, find(s0, 'Test Red Blaster', 'battlefield'), [[P2]]), 'p2')).toBe(20 - 3);
  });
});

describe('CR 615.7, 109.4: "If a source an opponent controls would deal damage to you, prevent 1 of that damage."', () => {
  const WARD = card('Test Hekma Ward', 'Enchantment', 'If a source an opponent controls would deal damage to you, prevent 1 of that damage.');
  const defs = [...BASE, WARD];
  it('is automated', () => expect(full(WARD)).toBe(true));
  it('the opponent\'s source deals 1 less to you; your own source does not', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Hekma Ward', 'Test Red Blaster'] }, p2: { battlefield: ['Test Blue Blaster'] } });
    expect(life(activate(s0, find(s0, 'Test Blue Blaster', 'battlefield', 'p2'), [[P1]], 'p2'), 'p1')).toBe(20 - 2);
    expect(life(activate(s0, find(s0, 'Test Red Blaster', 'battlefield', 'p1'), [[P1]]), 'p1')).toBe(20 - 3);
  });
});

describe('CR 615.7, 120.3: "If a source would deal damage to a Cleric creature you control, prevent 1 of that damage."', () => {
  const DEFENDER = card('Test Temple Defender', 'Enchantment', 'If a source would deal damage to a Cleric creature you control, prevent 1 of that damage.');
  const defs = [...BASE, DEFENDER];
  it('is automated', () => expect(full(DEFENDER)).toBe(true));
  it('a Cleric you control is dealt 1 less; a Bear is dealt all of it', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Temple Defender', 'Test Red Blaster', 'Test Kind Cleric', 'Test Brown Bear'] } });
    const red = find(s0, 'Test Red Blaster', 'battlefield');
    const cleric = find(s0, 'Test Kind Cleric', 'battlefield');
    const bear = find(s0, 'Test Brown Bear', 'battlefield');
    expect(marked(activate(s0, red, [[obj(cleric)]]), cleric)).toBe(2);
    expect(marked(activate(s0, red, [[obj(bear)]]), bear)).toBe(3);
  });
});

describe('CR 615.7, 107.3, 611.3a: "If a source would deal damage to ~, prevent X of that damage, where X is the number of Clerics you control."', () => {
  const WARDEN = card('Test Choir Warden', 'Creature — Human Cleric', 'If a source would deal damage to ~, prevent X of that damage, where X is the number of Clerics you control.', { pt: ['1', '9'] });
  const defs = [...BASE, WARDEN];
  it('is automated', () => expect(full(WARDEN)).toBe(true));
  it('X is counted as the damage would be dealt: one Cleric prevents 1, two prevent 2', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Choir Warden', 'Test Red Blaster'] } });
    const warden = find(s0, 'Test Choir Warden', 'battlefield');
    expect(marked(activate(s0, find(s0, 'Test Red Blaster', 'battlefield'), [[obj(warden)]]), warden)).toBe(2);
    const s1 = scenario([], { defs, p1: { battlefield: ['Test Choir Warden', 'Test Red Blaster', 'Test Kind Cleric'] } });
    const w1 = find(s1, 'Test Choir Warden', 'battlefield');
    expect(marked(activate(s1, find(s1, 'Test Red Blaster', 'battlefield'), [[obj(w1)]]), w1)).toBe(1);
  });
});

describe('CR 615.1a, 611.2a: "Prevent all damage that would be dealt to target creature this turn."', () => {
  const PASSAGE = card('Test Safe Corridor', 'Instant', 'Prevent all damage that would be dealt to target creature this turn.');
  const defs = [...BASE, PASSAGE];
  it('is automated', () => expect(full(PASSAGE)).toBe(true));
  it('the target is dealt no damage this turn; another creature is dealt all of it', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Safe Corridor'], battlefield: ['Test Red Blaster', 'Test Brown Bear', 'Test Kind Cleric'] } });
    const red = find(s0, 'Test Red Blaster', 'battlefield');
    const bear = find(s0, 'Test Brown Bear', 'battlefield');
    const cleric = find(s0, 'Test Kind Cleric', 'battlefield');
    const s1 = cast(s0, 'Test Safe Corridor', [[obj(bear)]]);
    expect(marked(activate(s1, red, [[obj(bear)]]), bear)).toBe(0);
    expect(marked(activate(s1, red, [[obj(cleric)]]), cleric)).toBe(3);
  });
});

describe('CR 615.1a, 510.2: "Prevent all combat damage target creature would deal this turn."', () => {
  const STALL = card('Test Stall Tactics', 'Instant', 'Prevent all combat damage target creature would deal this turn.');
  const defs = [...BASE, STALL];
  it('is automated', () => expect(full(STALL)).toBe(true));
  it('its combat damage is prevented, its noncombat damage is not; another attacker\'s combat damage is dealt', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Stall Tactics'], battlefield: ['Test Red Blaster', 'Test Brown Bear'] } });
    const red = find(s0, 'Test Red Blaster', 'battlefield');
    const bear = find(s0, 'Test Brown Bear', 'battlefield');
    const s1 = cast(s0, 'Test Stall Tactics', [[obj(red)]]);
    expect(life(activate(s1, red, [[P2]]), 'p2')).toBe(20 - 3);
    expect(life(attackAndDamage(s1, [red, bear]), 'p2')).toBe(20 - 2);
  });
});

describe('CR 609.7a, 615.1a: "Prevent all damage a source of your choice would deal this turn." and "... would deal to you this turn."', () => {
  const HEED = card('Test Pay Mind', 'Instant', 'Prevent all damage a source of your choice would deal this turn.');
  const MINE = card('Test Own Ward', 'Instant', 'Prevent all damage a source of your choice would deal to you this turn.');
  const defs = [...BASE, HEED, MINE];
  it('are automated', () => { expect(full(HEED)).toBe(true); expect(full(MINE)).toBe(true); });
  it('the chosen source deals no damage this turn, to anything; another source does', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Pay Mind'], battlefield: ['Test Red Blaster', 'Test Blue Blaster'] } });
    const red = find(s0, 'Test Red Blaster', 'battlefield');
    const blue = find(s0, 'Test Blue Blaster', 'battlefield');
    const s1 = cast(s0, 'Test Pay Mind', [], [[red]]);
    expect(life(activate(s1, red, [[P2]]), 'p2')).toBe(20);
    expect(life(activate(s1, red, [[P1]]), 'p1')).toBe(20);
    expect(life(activate(s1, blue, [[P2]]), 'p2')).toBe(20 - 3);
  });
  it('"to you": the chosen source\'s damage to you is prevented, its damage to the opponent is not', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Own Ward'], battlefield: ['Test Red Blaster'] } });
    const red = find(s0, 'Test Red Blaster', 'battlefield');
    const s1 = cast(s0, 'Test Own Ward', [], [[red]]);
    expect(life(activate(s1, red, [[P1]]), 'p1')).toBe(20);
    expect(life(activate(s1, red, [[P2]]), 'p2')).toBe(20 - 3);
  });
});

describe('CR 615.1a, 120.3: "Prevent all damage that would be dealt to ~ by artifact creatures."', () => {
  const PIXIE = card('Test Rust Sprite', 'Creature — Faerie', 'Prevent all damage that would be dealt to this creature by artifact creatures.', { pt: ['1', '5'] });
  const defs = [...BASE, PIXIE];
  it('is automated', () => expect(full(PIXIE)).toBe(true));
  it('an artifact creature deals it no damage; a red creature does', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Rust Sprite', 'Test Iron Blaster', 'Test Red Blaster'] } });
    const sprite = find(s0, 'Test Rust Sprite', 'battlefield');
    expect(marked(activate(s0, find(s0, 'Test Iron Blaster', 'battlefield'), [[obj(sprite)]]), sprite)).toBe(0);
    expect(marked(activate(s0, find(s0, 'Test Red Blaster', 'battlefield'), [[obj(sprite)]]), sprite)).toBe(3);
  });
});

describe('CR 615.1a, 109.4: "Prevent all damage that would be dealt to you by sources you don\'t control."', () => {
  const FIELD = card('Test Static Field', 'Enchantment', "Prevent all damage that would be dealt to you by sources you don't control.");
  const defs = [...BASE, FIELD];
  it('is automated', () => expect(full(FIELD)).toBe(true));
  it('the opponent\'s source deals you no damage; your own source does', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Static Field', 'Test Red Blaster'] }, p2: { battlefield: ['Test Blue Blaster'] } });
    expect(life(activate(s0, find(s0, 'Test Blue Blaster', 'battlefield', 'p2'), [[P1]], 'p2'), 'p1')).toBe(20);
    expect(life(activate(s0, find(s0, 'Test Red Blaster', 'battlefield', 'p1'), [[P1]]), 'p1')).toBe(20 - 3);
  });
});

describe('CR 615.1a, 510.2: "Prevent all combat damage that would be dealt to and dealt by creatures you control."', () => {
  const CRAFT = card('Test Peace Accord', 'Enchantment', 'Prevent all combat damage that would be dealt to and dealt by creatures you control.');
  const defs = [...BASE, CRAFT];
  it('is automated', () => expect(full(CRAFT)).toBe(true));
  it('your attackers deal no combat damage; noncombat damage to your creature is still dealt', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Peace Accord', 'Test Red Blaster', 'Test Brown Bear'] } });
    const red = find(s0, 'Test Red Blaster', 'battlefield');
    const bear = find(s0, 'Test Brown Bear', 'battlefield');
    expect(marked(activate(s0, red, [[obj(bear)]]), bear)).toBe(3);
    expect(life(attackAndDamage(s0, [bear]), 'p2')).toBe(20);
  });
  it('without it the attack deals its damage', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Brown Bear'] } });
    expect(life(attackAndDamage(s0, [find(s0, 'Test Brown Bear', 'battlefield')]), 'p2')).toBe(20 - 2);
  });
});

describe('CR 615.7, 107.3: "Prevent the next X damage that would be dealt to target creature this turn, where X is the number of Clerics you control."', () => {
  const PILGRIM = card('Test Road Pilgrim', 'Creature — Human Cleric', '{T}: Prevent the next X damage that would be dealt to target creature this turn, where X is the number of Clerics you control.', { pt: ['1', '1'] });
  const defs = [...BASE, PILGRIM];
  it('is automated', () => expect(full(PILGRIM)).toBe(true));
  it('CR 615.7: a shield of X = 2 prevents 2 of the first 3 damage, then nothing of the next', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Road Pilgrim', 'Test Kind Cleric', 'Test Red Blaster', 'Test Brown Bear'] } });
    const bear = find(s0, 'Test Brown Bear', 'battlefield');
    const red = find(s0, 'Test Red Blaster', 'battlefield');
    const s1 = activate(s0, find(s0, 'Test Road Pilgrim', 'battlefield'), [[obj(bear)]]);
    const s2 = activate(s1, red, [[obj(bear)]]);
    expect(marked(s2, bear)).toBe(1);
    expect(marked(activate(s2, red, [[obj(bear)]]), bear)).toBe(4);
  });
});

describe('CR 615.1a, 102.1: "Prevent all combat damage that would be dealt to players this turn."', () => {
  const TRUCE = card('Test Feast Truce', 'Instant', 'Prevent all combat damage that would be dealt to players this turn.');
  const defs = [...BASE, TRUCE];
  it('is automated', () => expect(full(TRUCE)).toBe(true));
  it('an attacker deals the player no combat damage; noncombat damage to a player is dealt', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Feast Truce'], battlefield: ['Test Red Blaster', 'Test Brown Bear'] } });
    const s1 = cast(s0, 'Test Feast Truce');
    expect(life(attackAndDamage(s1, [find(s1, 'Test Brown Bear', 'battlefield')]), 'p2')).toBe(20);
    expect(life(activate(s1, find(s1, 'Test Red Blaster', 'battlefield'), [[P2]]), 'p2')).toBe(20 - 3);
  });
});

describe('CR 615.1a, 611.2a: "Prevent all damage that would be dealt to you and creatures you control this turn."', () => {
  const ENDURE = card('Test Hold Fast', 'Instant', 'Prevent all damage that would be dealt to you and creatures you control this turn.');
  const defs = [...BASE, ENDURE];
  it('is automated', () => expect(full(ENDURE)).toBe(true));
  it('you and your creature are dealt no damage; the opponent is', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Hold Fast'], battlefield: ['Test Red Blaster', 'Test Brown Bear'] } });
    const red = find(s0, 'Test Red Blaster', 'battlefield');
    const bear = find(s0, 'Test Brown Bear', 'battlefield');
    const s1 = cast(s0, 'Test Hold Fast');
    expect(life(activate(s1, red, [[P1]]), 'p1')).toBe(20);
    expect(marked(activate(s1, red, [[obj(bear)]]), bear)).toBe(0);
    expect(life(activate(s1, red, [[P2]]), 'p2')).toBe(20 - 3);
    expect(findAll(s1, 'Test Brown Bear', 'battlefield')).toHaveLength(1);
  });
});
