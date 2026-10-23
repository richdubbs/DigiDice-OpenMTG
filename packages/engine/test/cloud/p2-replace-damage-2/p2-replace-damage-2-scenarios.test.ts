/**
 * Phase 2 lane p2-replace-damage, round p2-replace-damage-2: the round's damage-increase readings played through the engine with synthetic cards (invented names, design
 * 6.10), compiled by the game's default compiler. Each test is named after the rule it checks and has its negative case. CR cites from memory, unverified (rules/cr/
 * is not in the cloud checkout).
 *
 *   CR 614.1a, 120.3         "If a source you control would deal damage to a permanent or player, it deals triple that damage instead.": your sources only
 *   CR 614.1a, 109.2, 105.2  "If another red source you control would deal damage to a permanent or player, it deals that much damage plus 1 to that permanent
 *                            or player instead.": not the permanent itself, not a blue source
 *   CR 614.1a, 120.3         "If an instant or sorcery source you control would deal damage ..., it deals that much damage plus 2 ...": a sorcery, not a creature
 *   CR 614.1a, 102.3         "If a source would deal damage to an opponent, it deals double that damage to that player instead.": not to you
 *   CR 614.1a, 120.2b        "If a source you control would deal noncombat damage to an opponent, it deals that much damage plus 2 instead.": not combat damage
 *   CR 614.1a, 120.3         "If a source would deal 4 or more damage to a permanent or player, that source deals 3 damage ... instead.": less is not changed
 *   CR 614.1a, 611.2a        "If a red source you control would deal damage to a permanent or player this turn, it deals that much damage plus 2 ...": this turn only
 *   CR 614.1a, 120.3         "Double all damage that creature sources you control would deal.": a creature's, not an artifact's
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
const IRON_BLASTER = card('Test Iron Blaster', 'Artifact — Contraption', '{0}: This artifact deals 3 damage to any target.');
const SMALL_BLASTER = card('Test Spark Imp', 'Creature — Imp', '{0}: This creature deals 2 damage to any target.', { pt: ['1', '1'], colors: ['R'] });
const BOLT = card('Test Firebolt', 'Sorcery', 'Test Firebolt deals 3 damage to any target.', { colors: ['R'] });
const BEAR = card('Test Brown Bear', 'Creature — Bear', '', { pt: ['2', '20'] });
const BASE = [RED_BLASTER, BLUE_BLASTER, IRON_BLASTER, SMALL_BLASTER, BOLT, BEAR];

describe('CR 614.1a, 120.3: "If a source you control would deal damage to a permanent or player, it deals triple that damage instead."', () => {
  const FIRE = card('Test Town Ablaze', 'Enchantment', 'If a source you control would deal damage to a permanent or player, it deals triple that damage instead.');
  const defs = [...BASE, FIRE];
  it('is automated', () => expect(full(FIRE)).toBe(true));
  it('your source deals three times the damage, to a player and to a creature; the opponent\'s source does not', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Town Ablaze', 'Test Red Blaster'] }, p2: { battlefield: ['Test Blue Blaster', 'Test Brown Bear'] } });
    const red = find(s0, 'Test Red Blaster', 'battlefield', 'p1');
    const bear = find(s0, 'Test Brown Bear', 'battlefield', 'p2');
    expect(life(activate(s0, red, [[P2]]), 'p2')).toBe(20 - 9);
    expect(marked(activate(s0, red, [[obj(bear)]]), bear)).toBe(9);
    expect(life(activate(s0, find(s0, 'Test Blue Blaster', 'battlefield', 'p2'), [[P1]], 'p2'), 'p1')).toBe(20 - 3);
  });
});

describe('CR 614.1a, 109.2, 105.2: "If another red source you control would deal damage to a permanent or player, it deals that much damage plus 1 to that permanent or player instead."', () => {
  const MAGE = card('Test Ember Adept', 'Creature — Human Wizard', '{0}: This creature deals 3 damage to any target.\nIf another red source you control would deal damage to a permanent or player, it deals that much damage plus 1 to that permanent or player instead.', { pt: ['1', '1'], colors: ['R'] });
  const defs = [...BASE, MAGE];
  it('is automated', () => expect(full(MAGE)).toBe(true));
  it('another red source deals 1 more; the permanent itself and a blue source do not', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Ember Adept', 'Test Red Blaster', 'Test Blue Blaster'] } });
    expect(life(activate(s0, find(s0, 'Test Red Blaster', 'battlefield'), [[P2]]), 'p2')).toBe(20 - 4);
    expect(life(activate(s0, find(s0, 'Test Ember Adept', 'battlefield'), [[P2]]), 'p2')).toBe(20 - 3);
    expect(life(activate(s0, find(s0, 'Test Blue Blaster', 'battlefield'), [[P2]]), 'p2')).toBe(20 - 3);
  });
});

describe('CR 614.1a, 120.3: "If an instant or sorcery source you control would deal damage to a permanent or player, it deals that much damage plus 2 to that permanent or player instead."', () => {
  const SWATH = card('Test Spell Furnace', 'Enchantment', 'If an instant or sorcery source you control would deal damage to a permanent or player, it deals that much damage plus 2 to that permanent or player instead.');
  const defs = [...BASE, SWATH];
  it('is automated', () => expect(full(SWATH)).toBe(true));
  it('a sorcery you cast deals 2 more; a creature does not', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Firebolt'], battlefield: ['Test Spell Furnace', 'Test Red Blaster'] } });
    expect(life(cast(s0, 'Test Firebolt', [[P2]]), 'p2')).toBe(20 - 5);
    expect(life(activate(s0, find(s0, 'Test Red Blaster', 'battlefield'), [[P2]]), 'p2')).toBe(20 - 3);
  });
});

describe('CR 614.1a, 102.3: "If a source would deal damage to an opponent, it deals double that damage to that player instead."', () => {
  const DUO = card('Test Grim Pair', 'Creature — Demon', 'If a source would deal damage to an opponent, it deals double that damage to that player instead.', { pt: ['2', '2'] });
  const defs = [...BASE, DUO];
  it('is automated', () => expect(full(DUO)).toBe(true));
  it('damage to an opponent is doubled; damage to you is not, whoever\'s source it is', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Grim Pair', 'Test Red Blaster'] }, p2: { battlefield: ['Test Blue Blaster'] } });
    expect(life(activate(s0, find(s0, 'Test Red Blaster', 'battlefield', 'p1'), [[P2]]), 'p2')).toBe(20 - 6);
    expect(life(activate(s0, find(s0, 'Test Red Blaster', 'battlefield', 'p1'), [[P1]]), 'p1')).toBe(20 - 3);
    expect(life(activate(s0, find(s0, 'Test Blue Blaster', 'battlefield', 'p2'), [[P1]], 'p2'), 'p1')).toBe(20 - 3);
  });
});

describe('CR 614.1a, 120.2b: "If a source you control would deal noncombat damage to an opponent, it deals that much damage plus 2 instead."', () => {
  const PIT = card('Test Spiked Pit', 'Enchantment', 'If a source you control would deal noncombat damage to an opponent, it deals that much damage plus 2 instead.');
  const defs = [...BASE, PIT];
  it('is automated', () => expect(full(PIT)).toBe(true));
  it('noncombat damage to the opponent is 2 more; combat damage is not', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Spiked Pit', 'Test Red Blaster', 'Test Brown Bear'] } });
    expect(life(activate(s0, find(s0, 'Test Red Blaster', 'battlefield'), [[P2]]), 'p2')).toBe(20 - 5);
    expect(life(attackAndDamage(s0, [find(s0, 'Test Brown Bear', 'battlefield')]), 'p2')).toBe(20 - 2);
  });
});

describe('CR 614.1a, 120.3: "If a source would deal 4 or more damage to a permanent or player, that source deals 3 damage to that permanent or player instead."', () => {
  const CAP = card('Test Gentle Ceiling', 'Enchantment', 'If a source would deal 4 or more damage to a permanent or player, that source deals 3 damage to that permanent or player instead.');
  const BIG = card('Test Big Blaster', 'Creature — Giant', '{0}: This creature deals 5 damage to any target.', { pt: ['5', '5'] });
  const defs = [...BASE, CAP, BIG];
  it('is automated', () => expect(full(CAP)).toBe(true));
  it('5 damage is dealt as 3; 2 damage stays 2 (less than 4)', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Gentle Ceiling', 'Test Big Blaster', 'Test Spark Imp'] } });
    expect(life(activate(s0, find(s0, 'Test Big Blaster', 'battlefield'), [[P2]]), 'p2')).toBe(20 - 3);
    expect(life(activate(s0, find(s0, 'Test Spark Imp', 'battlefield'), [[P2]]), 'p2')).toBe(20 - 2);
  });
});

describe('CR 614.1a, 611.2a: "If a red source you control would deal damage to a permanent or player this turn, it deals that much damage plus 2 to that permanent or player instead."', () => {
  const KELD = card('Test Burning Hour', 'Instant', 'If a red source you control would deal damage to a permanent or player this turn, it deals that much damage plus 2 to that permanent or player instead.');
  const defs = [...BASE, KELD];
  it('is automated', () => expect(full(KELD)).toBe(true));
  it('this turn your red source deals 2 more, a blue one does not; the effect ends with the turn', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Burning Hour'], battlefield: ['Test Red Blaster', 'Test Blue Blaster'] } });
    const s1 = cast(s0, 'Test Burning Hour');
    expect(life(activate(s1, find(s1, 'Test Red Blaster', 'battlefield'), [[P2]]), 'p2')).toBe(20 - 5);
    expect(life(activate(s1, find(s1, 'Test Blue Blaster', 'battlefield'), [[P2]]), 'p2')).toBe(20 - 3);
    expect(advanceTo(s1, 2, 'main1').continuousEffects.length).toBe(s0.continuousEffects.length);
  });
});

describe('CR 614.1a, 120.3: "Double all damage that creature sources you control would deal."', () => {
  const TITAN = card('Test Twin Brutes', 'Legendary Creature — Human', 'Double all damage that creature sources you control would deal.', { pt: ['3', '3'] });
  const defs = [...BASE, TITAN];
  it('is automated', () => expect(full(TITAN)).toBe(true));
  it('a creature you control deals double; an artifact does not', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Twin Brutes', 'Test Red Blaster', 'Test Iron Blaster'] } });
    expect(life(activate(s0, find(s0, 'Test Red Blaster', 'battlefield'), [[P2]]), 'p2')).toBe(20 - 6);
    expect(life(activate(s0, find(s0, 'Test Iron Blaster', 'battlefield'), [[P2]]), 'p2')).toBe(20 - 3);
  });
});
