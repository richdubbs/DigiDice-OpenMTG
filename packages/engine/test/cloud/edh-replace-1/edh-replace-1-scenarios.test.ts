/**
 * Commander lane edh-replace, round edh-replace-1: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Each test is named after the rule it checks and has its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 614.1a, 120.3          "If a source you control would deal noncombat damage to an opponent or a permanent an opponent controls, it deals double that damage ... instead."
 *   CR 614.1a, 120.3          "If a source would deal damage to an opponent or a permanent an opponent controls, that source deals double that damage ... instead."
 *   CR 615.1, 615.6, 107.1a   "If a source would deal damage to you or a permanent you control, prevent half that damage, rounded up."
 *   CR 614.1a, 122.6, 107.1a  "If an opponent would put one or more counters on a permanent or player, they put half that many ... instead, rounded down."
 *   CR 609.7a, 615.5          "The next time a source of your choice would deal damage to you this turn, prevent that damage. If damage is prevented this way, ~ deals that much damage ..."
 *   CR 615.5, 510.2           "Prevent all combat damage that would be dealt to you this turn. For each 1 damage prevented this way, create a ... token"
 *   CR 107.3, 120.3, 601.2c   "~ deals five times X damage to each of up to X targets."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, legal, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; colors?: string[]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
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
/** `player` activates the first ability of `src` whose label contains `label` (p2 gets priority by p1 passing first), and the stack resolves. */
function activate(s0: GameState, src: ObjectId, targets: Target[][] = [], player: PlayerId = 'p1', label = '', objects: ObjectId[][] = []): GameState {
  let s = s0;
  if (player === 'p2') s = pass(s);
  const a = legal(s, player, 'activate').find((x) => x.object === src && x.label.includes(label));
  if (a === undefined) throw new Error(`no activation of ${src} for ${player}`);
  return resolveAll(drive(act(s, a.action), targets, objects), targets, objects);
}
const counters = (s: GameState, id: ObjectId, kind = '+1/+1'): number => s.objects[id]!.counters[kind] ?? 0;

const RED_BLASTER = card('Test Red Blaster', 'Creature — Goblin', '{0}: This creature deals 3 damage to any target.', { pt: ['1', '1'], colors: ['R'] });
const ONE_BLASTER = card('Test Pinger', 'Creature — Goblin', '{0}: This creature deals 1 damage to any target.', { pt: ['1', '1'], colors: ['R'] });
const BEAR = card('Test Brown Bear', 'Creature — Bear', '', { pt: ['2', '20'] });
const BASE = [RED_BLASTER, ONE_BLASTER, BEAR];

describe('CR 614.1a, 120.3: "If a source you control would deal noncombat damage to an opponent or a permanent an opponent controls, it deals double that damage to that player or permanent instead."', () => {
  const TYRANT = card('Test Doubling Tyrant', 'Creature — Horror', "If a source you control would deal noncombat damage to an opponent or a permanent an opponent controls, it deals double that damage to that player or permanent instead.", { pt: ['3', '3'] });
  const defs = [...BASE, TYRANT];
  it('is automated', () => expect(full(TYRANT)).toBe(true));
  it('your source deals an opponent and their permanents double; your own face, your own permanents and an opponent\'s source are not doubled', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Doubling Tyrant', 'Test Red Blaster', 'Test Brown Bear'] }, p2: { battlefield: ['Test Red Blaster', 'Test Brown Bear'] } });
    const mine = find(s0, 'Test Red Blaster', 'battlefield', 'p1');
    const theirs = find(s0, 'Test Red Blaster', 'battlefield', 'p2');
    const myBear = find(s0, 'Test Brown Bear', 'battlefield', 'p1');
    const theirBear = find(s0, 'Test Brown Bear', 'battlefield', 'p2');
    expect(life(activate(s0, mine, [[P2]]), 'p2')).toBe(20 - 6);
    expect(marked(activate(s0, mine, [[obj(theirBear)]]), theirBear)).toBe(6);
    expect(life(activate(s0, mine, [[P1]]), 'p1')).toBe(20 - 3);
    expect(marked(activate(s0, mine, [[obj(myBear)]]), myBear)).toBe(3);
    expect(life(activate(s0, theirs, [[P1]], 'p2'), 'p1')).toBe(20 - 3);
    expect(life(activate(s0, theirs, [[P2]], 'p2'), 'p2')).toBe(20 - 3);
  });
});

describe('CR 614.1a, 615.1: Gisela\'s two statics: "If a source would deal damage to an opponent or a permanent an opponent controls, that source deals double that damage ... instead." and "... to you or a permanent you control, prevent half that damage, rounded up."', () => {
  const ANGEL = card('Test Blade Angel', 'Creature — Angel', "If a source would deal damage to an opponent or a permanent an opponent controls, that source deals double that damage to that player or permanent instead.\nIf a source would deal damage to you or a permanent you control, prevent half that damage, rounded up.", { pt: ['4', '4'] });
  const defs = [...BASE, ANGEL];
  it('is automated', () => expect(full(ANGEL)).toBe(true));
  it('any source (even an opponent\'s) deals the opponent of the Angel\'s controller double; the Angel\'s controller and permanents are dealt half, rounded down (3 -> 1, 1 -> 0)', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Blade Angel', 'Test Red Blaster', 'Test Pinger', 'Test Brown Bear'] }, p2: { battlefield: ['Test Red Blaster', 'Test Pinger', 'Test Brown Bear'] } });
    const myBlaster = find(s0, 'Test Red Blaster', 'battlefield', 'p1');
    const myPinger = find(s0, 'Test Pinger', 'battlefield', 'p1');
    const theirBlaster = find(s0, 'Test Red Blaster', 'battlefield', 'p2');
    const myBear = find(s0, 'Test Brown Bear', 'battlefield', 'p1');
    const theirBear = find(s0, 'Test Brown Bear', 'battlefield', 'p2');
    expect(life(activate(s0, myBlaster, [[P2]]), 'p2')).toBe(20 - 6);
    expect(life(activate(s0, theirBlaster, [[P2]], 'p2'), 'p2')).toBe(20 - 6); // a source of the opponent's own, at their own face
    expect(marked(activate(s0, myBlaster, [[obj(theirBear)]]), theirBear)).toBe(6);
    expect(life(activate(s0, theirBlaster, [[P1]], 'p2'), 'p1')).toBe(20 - 1); // 3 damage, half (1.5) rounded up is prevented: 2 prevented, 1 dealt
    expect(life(activate(s0, myPinger, [[P1]]), 'p1')).toBe(20); // 1 damage, 1 prevented
    expect(marked(activate(s0, theirBlaster, [[obj(myBear)]], 'p2'), myBear)).toBe(1);
  });
});

describe('CR 614.1a, 122.6, 107.1a: "If an opponent would put one or more counters on a permanent or player, they put half that many of each of those kinds of counters on that permanent or player instead, rounded down."', () => {
  const RAIDER = card('Test Halving Raider', 'Creature — Phyrexian', "If an opponent would put one or more counters on a permanent or player, they put half that many of each of those kinds of counters on that permanent or player instead, rounded down.", { pt: ['3', '3'] });
  const GROWER = card('Test Growth Rite', 'Creature — Druid', '{0}: Put five +1/+1 counters on target creature.', { pt: ['1', '1'] });
  const defs = [...BASE, RAIDER, GROWER];
  it('is automated', () => expect(full(RAIDER)).toBe(true));
  it('an opponent puts half, rounded down (5 -> 2), on any permanent; you put all of yours', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Halving Raider', 'Test Growth Rite', 'Test Brown Bear'] }, p2: { battlefield: ['Test Growth Rite', 'Test Brown Bear'] } });
    const mineGrower = find(s0, 'Test Growth Rite', 'battlefield', 'p1');
    const theirGrower = find(s0, 'Test Growth Rite', 'battlefield', 'p2');
    const myBear = find(s0, 'Test Brown Bear', 'battlefield', 'p1');
    const theirBear = find(s0, 'Test Brown Bear', 'battlefield', 'p2');
    expect(counters(activate(s0, theirGrower, [[obj(theirBear)]], 'p2'), theirBear)).toBe(2);
    expect(counters(activate(s0, theirGrower, [[obj(myBear)]], 'p2'), myBear)).toBe(2);
    expect(counters(activate(s0, mineGrower, [[obj(myBear)]]), myBear)).toBe(5);
    expect(counters(activate(s0, mineGrower, [[obj(theirBear)]]), theirBear)).toBe(5);
  });
});

describe('CR 609.7a, 615.5: "The next time a source of your choice would deal damage to you this turn, prevent that damage. If damage is prevented this way, ~ deals that much damage to that source\'s controller."', () => {
  const PALM = card('Test Mirror Palm', 'Instant', "The next time a source of your choice would deal damage to you this turn, prevent that damage. If damage is prevented this way, ~ deals that much damage to that source's controller.");
  const defs = [...BASE, PALM];
  const setup = (): GameState => scenario([], { defs, p1: { hand: ['Test Mirror Palm'] }, p2: { battlefield: ['Test Red Blaster', 'Test Pinger'] } });
  const shield = (s: GameState, chosen: ObjectId): GameState => resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Mirror Palm', 'hand', 'p1') }), [], [[chosen]]), [], [[chosen]]);
  it('is automated', () => expect(full(PALM)).toBe(true));
  it('the chosen source\'s next damage to you is prevented and dealt back, as much, to ITS controller; its second damage to you is dealt (the shield is used up)', () => {
    const s0 = setup();
    const blaster = find(s0, 'Test Red Blaster', 'battlefield', 'p2');
    const s1 = shield(s0, blaster);
    const s2 = activate(s1, blaster, [[P1]], 'p2');
    expect(life(s2, 'p1')).toBe(20);
    expect(life(s2, 'p2')).toBe(20 - 3);
    const s3 = activate(s2, blaster, [[P1]], 'p2');
    expect(life(s3, 'p1')).toBe(20 - 3);
    expect(life(s3, 'p2')).toBe(20 - 3);
  });
  it('the damage dealt back happens right after the prevention (CR 615.5), not as a triggered ability on the stack', () => {
    const s0 = setup();
    const blaster = find(s0, 'Test Red Blaster', 'battlefield', 'p2');
    const s1 = shield(s0, blaster);
    let s = pass(s1); // p2 gets priority
    const a = legal(s, 'p2', 'activate').find((x) => x.object === blaster)!;
    s = drive(act(s, a.action), [[P1]]);
    s = pass(pass(s)); // the ability resolves once
    expect(s.zones.stack).toHaveLength(0);
    expect(life(s, 'p1')).toBe(20);
    expect(life(s, 'p2')).toBe(20 - 3);
  });
  it('another source\'s damage to you is not prevented and not reflected; the chosen source\'s damage to someone else is not either', () => {
    const s0 = setup();
    const blaster = find(s0, 'Test Red Blaster', 'battlefield', 'p2');
    const pinger = find(s0, 'Test Pinger', 'battlefield', 'p2');
    const s1 = shield(s0, blaster);
    const s2 = activate(s1, pinger, [[P1]], 'p2');
    expect(life(s2, 'p1')).toBe(20 - 1);
    expect(life(s2, 'p2')).toBe(20);
    const s3 = activate(s2, blaster, [[P2]], 'p2');
    expect(life(s3, 'p2')).toBe(20 - 3);
    expect(life(s3, 'p1')).toBe(20 - 1);
  });
});

describe('CR 615.5, 510.2: "Prevent all combat damage that would be dealt to you this turn. For each 1 damage prevented this way, create a 2/1 ... token with flying."', () => {
  const INK = card('Test Ink Veil', 'Instant', 'Prevent all combat damage that would be dealt to you this turn. For each 1 damage prevented this way, create a 2/1 white and black Inkling creature token with flying.');
  const BRUTE = card('Test Strong Bear', 'Creature — Bear', '', { pt: ['3', '3'] });
  const defs = [...BASE, INK, BRUTE];
  it('is automated', () => expect(full(INK)).toBe(true));
  it('combat damage to you is prevented and you create a token for each 1 damage prevented; damage to a creature and noncombat damage are not prevented and make no tokens', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Strong Bear'] }, p2: { hand: ['Test Ink Veil'], battlefield: ['Test Red Blaster'] } });
    const bear = find(s0, 'Test Strong Bear', 'battlefield', 'p1');
    let s = s0;
    for (let i = 0; i < 60 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' }] });
    s = pass(s); // p1, then p2 holds priority
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Ink Veil', 'hand', 'p2') }));
    s = resolveAll(s);
    for (let i = 0; i < 60 && s.turn.step !== 'endCombat' && s.turn.step !== 'main2'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    expect(life(s, 'p2')).toBe(20);
    const inklings = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2' && s.objects[id]!.defId.includes('Inkling'));
    expect(inklings).toHaveLength(3);
    // noncombat damage later the same turn: not prevented, no more tokens
    const blaster = find(s, 'Test Red Blaster', 'battlefield', 'p2');
    const after = activate(s, blaster, [[P2]], 'p2');
    expect(life(after, 'p2')).toBe(20 - 3);
    expect(after.zones.battlefield.filter((id) => after.objects[id]!.controller === 'p2' && after.objects[id]!.defId.includes('Inkling'))).toHaveLength(3);
  });
  it('without the spell the same attack deals its damage and makes no token', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Strong Bear'] } });
    const bear = find(s0, 'Test Strong Bear', 'battlefield', 'p1');
    let s = s0;
    for (let i = 0; i < 60 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' }] });
    for (let i = 0; i < 60 && s.turn.step !== 'endCombat' && s.turn.step !== 'main2'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    expect(life(s, 'p2')).toBe(20 - 3);
  });
});

describe('CR 107.3, 120.3, 601.2c: "~ deals five times X damage to each of up to X targets."', () => {
  const CRACKLE = card('Test Crackling Surge', 'Instant', '~ deals five times X damage to each of up to X targets.', { cost: '{X}{R}' });
  const defs = [...BASE, CRACKLE];
  it('is automated', () => expect(full(CRACKLE)).toBe(true));
  it('X = 2: each of two targets is dealt 10 damage (the amount is not divided); X = 1 allows one target only', () => {
    const run = (x: number, targets: (s: GameState) => Target[]): GameState => {
      const s0 = scenario(['Mountain', 'Mountain', 'Mountain'], { defs, p1: { hand: ['Test Crackling Surge'], battlefield: ['Mountain', 'Mountain', 'Mountain'] }, p2: { battlefield: ['Test Brown Bear'] } });
      let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Crackling Surge', 'hand', 'p1') });
      for (let g = 0; g < 20 && s.pending && s.pending.kind !== 'priority'; g++) {
        const p = s.pending;
        if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: x });
        else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets(s) });
        else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
        else throw new Error(`unexpected ${p.kind}`);
      }
      return resolveAll(s);
    };
    const two = run(2, (s) => [P2, obj(find(s, 'Test Brown Bear', 'battlefield', 'p2'))]);
    expect(life(two, 'p2')).toBe(20 - 10);
    expect(marked(two, find(two, 'Test Brown Bear', 'battlefield', 'p2'))).toBe(10);
    const one = run(1, () => [P2]);
    expect(life(one, 'p2')).toBe(20 - 5);
    expect(() => run(1, (s) => [P2, obj(find(s, 'Test Brown Bear', 'battlefield', 'p2'))])).toThrow(/Choose between 0 and 1/); // X = 1 allows one target at most
  });
});

describe('CR 614.15, 118.12a, 701.6a: "Counter target noncreature spell unless its controller pays {1}. If you control a creature with power 4 or greater, counter that spell instead."', () => {
  const DENIAL = card('Test Hard Refusal', 'Instant', 'Counter target noncreature spell unless its controller pays {1}. If you control a creature with power 4 or greater, counter that spell instead.');
  const GAIN = card('Test Small Gain', 'Instant', 'You gain 5 life.');
  const BIG = card('Test Big Troll', 'Creature — Troll', '', { pt: ['4', '4'] });
  const SMALL = card('Test Small Imp', 'Creature — Imp', '', { pt: ['3', '3'] });
  const defs = [...BASE, DENIAL, GAIN, BIG, SMALL];
  it('is automated', () => expect(full(DENIAL)).toBe(true));
  const run = (battlefield: string[], lands: number): GameState => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Small Gain', 'Test Hard Refusal'], battlefield: [...battlefield, ...Array(lands).fill('Plains')] } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Small Gain', 'hand', 'p1') });
    s = drive(s);
    const gain = s.zones.stack[s.zones.stack.length - 1]!;
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Hard Refusal', 'hand', 'p1') });
    for (let g = 0; g < 30 && s.pending && s.pending.kind !== 'priority'; g++) {
      const p = s.pending;
      if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: gain }] });
      else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected ${p.kind}`);
    }
    for (let g = 0; g < 30 && s.zones.stack.length > 0; g++) {
      s = pass(pass(s));
      for (let h = 0; h < 10 && s.pending && s.pending.kind !== 'priority'; h++) {
        const p = s.pending;
        if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
        else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
        else throw new Error(`unexpected ${p.kind}`);
      }
    }
    return s;
  };
  it('with a creature of power 4 or more the spell is countered whatever its controller could pay', () => {
    expect(life(run(['Test Big Troll'], 2), 'p1')).toBe(20); // countered: no life gained
  });
  it('without one (power 3 is not enough) the controller may pay {1}: able to pay, the spell resolves; unable, it is countered', () => {
    expect(life(run(['Test Small Imp'], 2), 'p1')).toBe(25);
    expect(life(run(['Test Small Imp'], 0), 'p1')).toBe(20);
    expect(life(run([], 0), 'p1')).toBe(20);
  });
});

/** Play from the start of `s` to the declare-attackers decision of the active player, declare `attacks`, block as `blocks` says and pass to the end of combat. */
function combat(s0: GameState, attacks: { attacker: ObjectId; defender: PlayerId }[], blocks: { blocker: ObjectId; attacker: ObjectId }[] = []): GameState {
  let s = s0;
  for (let i = 0; i < 60 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
  s = answer(s, { kind: 'declareAttackers', attacks });
  for (let i = 0; i < 80 && s.turn.step !== 'endCombat' && s.turn.step !== 'main2'; i++) {
    if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks });
    else s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
  }
  return s;
}

describe('CR 510.2, 614.1a, 120.3: combat damage doubled (The Sound of Drums, Inquisitor\'s Flail)', () => {
  const BLADE = card('Test Twin Blade', 'Artifact — Equipment', "If equipped creature would deal combat damage, it deals double that damage instead.\nIf another creature would deal combat damage to equipped creature, it deals double that damage to equipped creature instead.\nEquip {0}");
  const DRUM = card('Test Loud Drum', 'Enchantment — Aura', "Enchant creature\nIf enchanted creature would deal combat damage to a permanent or player, it deals double that damage instead.");
  const STRONG = card('Test Strong Bear', 'Creature — Bear', '', { pt: ['3', '3'] });
  const WALL = card('Test Stout Wall', 'Creature — Wall', '', { pt: ['0', '20'] });
  const defs = [...BASE, BLADE, DRUM, STRONG, WALL];
  it('are automated', () => { expect(full(BLADE)).toBe(true); expect(full(DRUM)).toBe(true); });
  it('the equipped creature deals double combat damage to the player and to the creature blocking it; an unequipped creature deals its damage', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Twin Blade', 'Test Strong Bear', 'Test Strong Bear'] }, p2: { battlefield: ['Test Stout Wall'] } });
    const [armed, plain] = findAll(s0, 'Test Strong Bear', 'battlefield', 'p1') as [ObjectId, ObjectId];
    const s1 = resolveAll(drive(act(s0, legal(s0, 'p1', 'activate').find((x) => x.object === find(s0, 'Test Twin Blade', 'battlefield'))!.action), [[obj(armed)]]), [[obj(armed)]]);
    expect(life(combat(s1, [{ attacker: armed, defender: 'p2' }]), 'p2')).toBe(20 - 6);
    expect(life(combat(s1, [{ attacker: plain, defender: 'p2' }]), 'p2')).toBe(20 - 3);
    const wall = find(s1, 'Test Stout Wall', 'battlefield', 'p2');
    const blocked = combat(s1, [{ attacker: armed, defender: 'p2' }], [{ blocker: wall, attacker: armed }]);
    expect(marked(blocked, wall)).toBe(6);
  });
  it('another creature\'s combat damage to the equipped creature is doubled too (a 1/20 equipped creature blocked by a 2-power attacker takes 4)', () => {
    const TANK = card('Test Tough Tank', 'Creature — Golem', '', { pt: ['1', '20'] });
    const HIT = card('Test Quick Hit', 'Creature — Goblin', '', { pt: ['2', '5'] });
    const s0 = scenario([], { defs: [...defs, TANK, HIT], p1: { battlefield: ['Test Twin Blade', 'Test Tough Tank'] }, p2: { battlefield: ['Test Quick Hit'] } });
    const tank = find(s0, 'Test Tough Tank', 'battlefield', 'p1');
    const hit = find(s0, 'Test Quick Hit', 'battlefield', 'p2');
    const s1 = resolveAll(drive(act(s0, legal(s0, 'p1', 'activate').find((x) => x.object === find(s0, 'Test Twin Blade', 'battlefield'))!.action), [[obj(tank)]]), [[obj(tank)]]);
    const s2 = advanceTo(s1, 2, 'main1');
    const out = combat(s2, [{ attacker: hit, defender: 'p1' }], [{ blocker: tank, attacker: hit }]);
    expect(marked(out, tank)).toBe(4); // 2 combat damage doubled by "another creature ... to equipped creature"
    expect(marked(out, hit)).toBe(2); // the equipped blocker deals 1 doubled: 2
    // without the equipment the same block deals 2 and 1
    const bare0 = scenario([], { defs: [...defs, TANK, HIT], p1: { battlefield: ['Test Tough Tank'] }, p2: { battlefield: ['Test Quick Hit'] } });
    const out0 = combat(advanceTo(bare0, 2, 'main1'), [{ attacker: find(bare0, 'Test Quick Hit', 'battlefield', 'p2'), defender: 'p1' }], [{ blocker: find(bare0, 'Test Tough Tank', 'battlefield', 'p1'), attacker: find(bare0, 'Test Quick Hit', 'battlefield', 'p2') }]);
    expect(marked(out0, find(bare0, 'Test Tough Tank', 'battlefield', 'p1'))).toBe(2);
    expect(marked(out0, find(bare0, 'Test Quick Hit', 'battlefield', 'p2'))).toBe(1);
  });
});

describe('CR 122.6, 614.12: Vorinclex\'s halving also reaches counters an opponent\'s permanent enters with, and counters put on players', () => {
  const RAIDER = card('Test Halving Raider', 'Creature — Phyrexian', "If an opponent would put one or more counters on a permanent or player, they put half that many of each of those kinds of counters on that permanent or player instead, rounded down.", { pt: ['3', '3'] });
  const BIG = card('Test Grown Brute', 'Creature — Beast', 'This creature enters with four +1/+1 counters on it.', { pt: ['0', '0'] });
  const POISON = card('Test Venom Rite', 'Sorcery', 'Target player gets five poison counters.');
  const defs = [...BASE, RAIDER, BIG, POISON];
  it('are automated', () => { expect(full(BIG)).toBe(true); expect(full(POISON)).toBe(true); });
  it('a creature that enters under the opponent with counters gets half (4 -> 2); under you, all four', () => {
    const mine = scenario([], { defs, p1: { hand: ['Test Grown Brute'], battlefield: ['Test Halving Raider'] }, p2: { hand: [] } });
    const castMine = resolveAll(drive(act(mine, { type: 'cast', player: 'p1', card: find(mine, 'Test Grown Brute', 'hand', 'p1') })));
    expect(counters(castMine, find(castMine, 'Test Grown Brute', 'battlefield', 'p1'))).toBe(4);
    const theirs = scenario([], { defs, p1: { battlefield: ['Test Halving Raider'] }, p2: { hand: ['Test Grown Brute'] } });
    const s1 = advanceTo(theirs, 2, 'main1');
    const castTheirs = (() => { let s = act(s1, { type: 'cast', player: 'p2', card: find(s1, 'Test Grown Brute', 'hand', 'p2') }); s = drive(s); return resolveAll(s); })();
    expect(counters(castTheirs, find(castTheirs, 'Test Grown Brute', 'battlefield', 'p2'))).toBe(2);
  });
  it('poison counters an opponent gives a player are halved (5 -> 2); the Raider\'s controller gives all five', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Venom Rite'], battlefield: ['Test Halving Raider'] }, p2: { hand: ['Test Venom Rite'] } });
    const mine = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Venom Rite', 'hand', 'p1') }), [[P2]]), [[P2]]);
    expect(mine.players.find((p) => p.id === 'p2')!.poison).toBe(5);
    const s1 = advanceTo(s0, 2, 'main1');
    const theirs = resolveAll(drive(act(s1, { type: 'cast', player: 'p2', card: find(s1, 'Test Venom Rite', 'hand', 'p2') }), [[P1]]), [[P1]]);
    expect(theirs.players.find((p) => p.id === 'p1')!.poison).toBe(2);
  });
});

describe('CR 615.1, 615.6: "If a source would deal damage to another Dinosaur you control, prevent all but 1 of that damage."', () => {
  const SAUR = card('Test Temple Reptile', 'Creature — Dinosaur', 'If a source would deal damage to another Dinosaur you control, prevent all but 1 of that damage.', { pt: ['4', '4'] });
  const MINOR = card('Test Little Reptile', 'Creature — Dinosaur', '', { pt: ['2', '20'] });
  const defs = [...BASE, SAUR, MINOR];
  it('is automated', () => expect(full(SAUR)).toBe(true));
  it('another Dinosaur you control is dealt 1 of 3 damage; the Reptile itself, a non-Dinosaur of yours and the opponent\'s Dinosaur are dealt all of it; 1 damage still gets through', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Temple Reptile', 'Test Little Reptile', 'Test Brown Bear'] }, p2: { battlefield: ['Test Red Blaster', 'Test Pinger', 'Test Little Reptile'] } });
    const saur = find(s0, 'Test Temple Reptile', 'battlefield', 'p1');
    const little = find(s0, 'Test Little Reptile', 'battlefield', 'p1');
    const bear = find(s0, 'Test Brown Bear', 'battlefield', 'p1');
    const theirs = find(s0, 'Test Little Reptile', 'battlefield', 'p2');
    const blaster = find(s0, 'Test Red Blaster', 'battlefield', 'p2');
    const pinger = find(s0, 'Test Pinger', 'battlefield', 'p2');
    expect(marked(activate(s0, blaster, [[obj(little)]], 'p2'), little)).toBe(1);
    expect(marked(activate(s0, pinger, [[obj(little)]], 'p2'), little)).toBe(1);
    expect(marked(activate(s0, blaster, [[obj(saur)]], 'p2'), saur)).toBe(3);
    expect(marked(activate(s0, blaster, [[obj(bear)]], 'p2'), bear)).toBe(3);
    expect(marked(activate(s0, blaster, [[obj(theirs)]], 'p2'), theirs)).toBe(3);
  });
});

describe('CR 603.4, 104.2b: win-the-game conditions (Triskaidekaphile, Twenty-Toed Toad)', () => {
  const FILE = card('Test Thirteen Seer', 'Creature — Human Wizard', 'You have no maximum hand size.\nAt the beginning of your upkeep, if you have exactly thirteen cards in your hand, you win the game.', { pt: ['1', '1'] });
  const TOAD = card('Test Many-Toed Frog', 'Creature — Frog', 'Whenever this creature attacks, you win the game if there are twenty or more counters on it or you have twenty or more cards in hand.', { pt: ['1', '1'] });
  const defs = [...BASE, FILE, TOAD];
  it('are automated', () => { expect(full(FILE)).toBe(true); expect(full(TOAD)).toBe(true); });
  it('wins at exactly thirteen cards in hand in the upkeep, not with twelve or fourteen', () => {
    const upkeepWith = (n: number): GameState => {
      const s0 = scenario([], { defs, p1: { battlefield: ['Test Thirteen Seer'], hand: Array.from({ length: n }, () => 'Plains') } });
      let s = advanceTo(s0, 3, 'upkeep'); // p1's next turn: its upkeep (the draw step adds a card later: the count is taken in the upkeep)
      for (let i = 0; i < 12 && s.zones.stack.length > 0 && !s.result; i++) s = drive(pass(pass(s)));
      return s;
    };
    expect(upkeepWith(13).result?.winner).toBe('p1');
    expect(upkeepWith(12).result).toBeNull();
    expect(upkeepWith(14).result).toBeNull();
  });
  it('wins when it attacks with twenty counters on it, or twenty cards in hand; not with nineteen of each', () => {
    const attackWith = (counterN: number, handN: number): GameState => {
      const s0 = scenario([], { defs, life: 100, p1: { battlefield: [{ name: 'Test Many-Toed Frog', counters: { '+1/+1': counterN } }], hand: Array.from({ length: handN }, () => 'Plains') } });
      const frog = find(s0, 'Test Many-Toed Frog', 'battlefield', 'p1');
      return resolveAll(combat(s0, [{ attacker: frog, defender: 'p2' }]));
    };
    expect(attackWith(20, 0).result?.winner).toBe('p1');
    expect(attackWith(0, 20).result?.winner).toBe('p1');
    expect(attackWith(19, 19).result).toBeNull();
  });
});
