/**
 * T19 (FAST4 wave, template family T-R: replacement, prevention, redirection and game-end shapes): the cards the T19 templates, the anaphora and renderer
 * additions automate, played through applyAction with synthetic cards compiled by the game's default compiler (wordings are invented, design 6.10). Each test
 * is named after the rule it checks.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type AbilityDef, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, legal, life, pass, passBoth, scenario } from '../../m3/scenario';
import { passUntil, runCombat, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, cost = '{0}', extra: { pt?: [string, string]; loyalty?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: cost, colors: [],
    ...(extra.pt ? { power: extra.pt[0], toughness: extra.pt[1] } : {}), ...(extra.loyalty ? { loyalty: extra.loyalty } : {}),
  } as OracleCard as never);
}
/** The abilities of a card that are manual or hold a manual step. */
const manualParts = (d: CardDef): AbilityDef[] => d.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' || JSON.stringify(a).includes('"op":"manual"'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const p2: TargetChoice = { kind: 'player', id: 'p2' };

function settle(s0: GameState, targets: TargetChoice[]): GameState {
  let s = s0;
  while (s.pending && s.pending.kind !== 'priority') {
    const d = s.pending as { kind: string };
    if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return s;
}
const cast = (s: GameState, name: string, targets: TargetChoice[] = [], player: 'p1' | 'p2' = 'p1'): GameState =>
  settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), targets);
function activate(s0: GameState, source: ObjectId, targets: TargetChoice[] = []): GameState {
  const a = legal(s0, 'p1', 'activate').find((x) => x.object === source && !x.isMana);
  if (!a) throw new Error(`no ability of ${source} to activate`);
  return settle(act(s0, a.action), targets);
}
const BEAR = card('Test Hill Bear', 'Creature — Bear', '', '{1}', { pt: ['2', '2'] });
const WALL = card('Test Stone Wall', 'Creature — Wall', '', '{1}', { pt: ['0', '5'] });
/** Where the card of a former object is now (a zone change makes a new object, CR 400.7): by name and owner. */
const whereIs = (s: GameState, name: string, owner: 'p1' | 'p2'): string[] =>
  Object.values(s.objects).filter((o) => s.defs[o.defId]?.name === name && o.owner === owner).map((o) => o.zone);

describe('CR 614.1a, 614.6, 608.2c: "If a creature dealt damage this way would die this turn, exile it instead" (the creatures the damage step dealt damage to)', () => {
  const SWEEP = card('Test Fire Sweep', 'Sorcery', '~ deals 3 damage to each creature. If a creature dealt damage this way would die this turn, exile it instead.', '{1}{R}{R}');
  const PILLAR = card('Test Flame Pillar', 'Sorcery', '~ deals 2 damage to any target. If a creature dealt damage this way would die this turn, exile it instead.', '{R}');
  it('both are automated: the damage step binds what it dealt damage to, and the replacement names that binding', () => {
    expect(manualParts(SWEEP)).toEqual([]);
    expect(manualParts(PILLAR)).toEqual([]);
    const json = JSON.stringify(SWEEP.faces[0]!.abilities[0]);
    expect(json).toContain('"op":"damage"');
    const name = /"op":"damage","source":\{"ref":"self"\},"to":\{[^]*?\},"amount":3,"as":"(\w+)"/.exec(json)?.[1];
    expect(name, json).toBeDefined();
    expect(json).toContain(`"subject":{"types":["Creature"],"is":{"ref":"bound","name":"${name}"}}`);
  });
  it('a creature the sweep killed is exiled; one dealt damage that survives and dies later this turn is exiled too; another creature is not', () => {
    let s = scenario(['Lightning Bolt', 'Mountain'], { p1: { hand: ['Test Fire Sweep', 'Lightning Bolt'], battlefield: ['Mountain', 'Mountain', 'Mountain', 'Mountain'] }, p2: { battlefield: ['Test Hill Bear', 'Test Stone Wall'] }, defs: [SWEEP, BEAR, WALL] });
    s = cast(s, 'Test Fire Sweep');
    s = passBoth(s);
    expect(whereIs(s, 'Test Hill Bear', 'p2')).toEqual(['exile']);
    const wall = find(s, 'Test Stone Wall', 'battlefield', 'p2');
    expect(s.objects[wall]!.damage).toBe(3);
    s = cast(s, 'Lightning Bolt', [obj(wall)]);
    s = passBoth(s);
    expect(whereIs(s, 'Test Stone Wall', 'p2')).toEqual(['exile']); // dealt damage this way, dies this turn (CR 704.5g)
  });
  it('a creature that was not dealt damage this way goes to the graveyard (it entered after the sweep)', () => {
    let s = scenario(['Lightning Bolt', 'Mountain'], { p1: { hand: ['Test Fire Sweep', 'Lightning Bolt'], battlefield: ['Mountain', 'Mountain', 'Mountain', 'Mountain'] }, defs: [SWEEP, BEAR] });
    s = cast(s, 'Test Fire Sweep');
    s = passBoth(s);
    s = tweak(s, (t) => {
      const id = `o${t.counters.object++}`;
      t.objects[id] = { ...t.objects[find(t, 'Mountain', 'battlefield', 'p1')]!, id, defId: 'Test Hill Bear', owner: 'p2', controller: 'p2', cardId: `c${t.counters.card++}`, tapped: false, timestamp: t.counters.timestamp++, counters: {}, damage: 0 };
      t.zones.battlefield.push(id);
    });
    const bear = find(s, 'Test Hill Bear', 'battlefield', 'p2');
    s = cast(s, 'Lightning Bolt', [obj(bear)]);
    s = passBoth(s);
    expect(whereIs(s, 'Test Hill Bear', 'p2')).toEqual(['graveyard']);
  });
  it('CR 120.3: aimed at a player, it dealt damage to no creature: a creature that dies this turn goes to the graveyard', () => {
    let s = scenario(['Lightning Bolt', 'Mountain'], { p1: { hand: ['Test Flame Pillar', 'Lightning Bolt'], battlefield: ['Mountain', 'Mountain'] }, p2: { battlefield: ['Test Hill Bear'] }, defs: [PILLAR, BEAR] });
    s = cast(s, 'Test Flame Pillar', [p2]);
    s = passBoth(s);
    expect(life(s, 'p2')).toBe(18);
    s = cast(s, 'Lightning Bolt', [obj(find(s, 'Test Hill Bear', 'battlefield', 'p2'))]);
    s = passBoth(s);
    expect(whereIs(s, 'Test Hill Bear', 'p2')).toEqual(['graveyard']);
  });
  it('aimed at a creature it kills, the creature is exiled', () => {
    let s = scenario(['Mountain'], { p1: { hand: ['Test Flame Pillar'], battlefield: ['Mountain'] }, p2: { battlefield: ['Test Hill Bear'] }, defs: [PILLAR, BEAR] });
    s = cast(s, 'Test Flame Pillar', [obj(find(s, 'Test Hill Bear', 'battlefield', 'p2'))]);
    s = passBoth(s);
    expect(whereIs(s, 'Test Hill Bear', 'p2')).toEqual(['exile']);
  });
});

describe('CR 614.1a, 115.1: "If that creature or planeswalker would die this turn, exile it instead"', () => {
  const BOLT = card('Test Wrecking Bolt', 'Sorcery', '~ deals 4 damage to target creature or planeswalker. If that creature or planeswalker would die this turn, exile it instead.', '{1}{R}');
  const WALKER = card('Test Walker', 'Legendary Planeswalker — Testa', '+1: You gain 1 life.', '{3}', { loyalty: '3' });
  it('is automated: the replacement names the target', () => {
    expect(manualParts(BOLT)).toEqual([]);
    expect(JSON.stringify(BOLT)).toContain('"subject":{"is":{"ref":"target","id":"t0"}}');
  });
  it('a planeswalker it kills is exiled (CR 306.9, 704.5i)', () => {
    let s = scenario(['Mountain'], { p1: { hand: ['Test Wrecking Bolt'], battlefield: ['Mountain', 'Mountain'] }, p2: { battlefield: [{ name: 'Test Walker', counters: { loyalty: 3 } }] }, defs: [BOLT, WALKER] });
    s = cast(s, 'Test Wrecking Bolt', [obj(find(s, 'Test Walker', 'battlefield', 'p2'))]);
    s = passBoth(s);
    expect(whereIs(s, 'Test Walker', 'p2')).toEqual(['exile']);
  });
  it('a creature it kills is exiled', () => {
    let s = scenario(['Mountain'], { p1: { hand: ['Test Wrecking Bolt'], battlefield: ['Mountain', 'Mountain'] }, p2: { battlefield: ['Test Hill Bear'] }, defs: [BOLT, BEAR] });
    s = cast(s, 'Test Wrecking Bolt', [obj(find(s, 'Test Hill Bear', 'battlefield', 'p2'))]);
    s = passBoth(s);
    expect(whereIs(s, 'Test Hill Bear', 'p2')).toEqual(['exile']);
  });
});

describe('CR 614.1a: "~ deals 3 damage to target attacking or blocking creature. If that creature would die this turn, exile it instead."', () => {
  const SMITE = card('Test Dawn Smite', 'Instant', '~ deals 3 damage to target attacking or blocking creature. If that creature would die this turn, exile it instead.', '{W}');
  it('is automated (the renderer calls the target "that creature": an attacking or blocking creature is a creature)', () => {
    expect(manualParts(SMITE)).toEqual([]);
    expect(JSON.stringify(SMITE)).toContain('"subject":{"is":{"ref":"target","id":"t0"}}');
  });
});

describe('CR 614.6, 113.6b, 701.24a: "If ~ would be put into a graveyard from anywhere, reveal ~ and shuffle it into its owner\'s library instead"', () => {
  const GOLEM = card('Test Steel Golem', 'Artifact Creature — Golem', "If ~ would be put into a graveyard from anywhere, reveal ~ and shuffle it into its owner's library instead.", '{6}', { pt: ['6', '6'] });
  const MILL = card('Test Tide Mill', 'Sorcery', 'Target player mills three cards.', '{U}');
  it('is automated: a static replacement of the card itself that functions in every zone but the graveyard', () => {
    expect(manualParts(GOLEM)).toEqual([]);
    const a = GOLEM.faces[0]!.abilities[0]! as { kind: string; zone?: string[] };
    expect(a.kind).toBe('static');
    expect(a.zone).toEqual(['battlefield', 'stack', 'hand', 'library', 'exile']);
  });
  it('destroyed on the battlefield, it is revealed and shuffled into its owner\'s library instead', () => {
    let s = scenario(['Murder', 'Swamp'], { p1: { hand: ['Murder'], battlefield: ['Swamp', 'Swamp', 'Swamp'] }, p2: { battlefield: ['Test Steel Golem'] }, defs: [GOLEM] });
    const lib = s.zones.library.p2!.length;
    s = cast(s, 'Murder', [obj(find(s, 'Test Steel Golem', 'battlefield', 'p2'))]);
    s = passBoth(s);
    expect(whereIs(s, 'Test Steel Golem', 'p2')).toEqual(['library']);
    expect(s.zones.library.p2!.length).toBe(lib + 1);
    expect(s.zones.graveyard.p2!.length).toBe(0);
    expect(s.log.some((l) => /reveal/i.test(l.text) && /Test Steel Golem/.test(l.text))).toBe(true);
  });
  it('CR 614.6: milled from the library, it stays in the library (shuffled) instead of going to the graveyard', () => {
    let s = scenario(['Island'], { p1: { hand: ['Test Tide Mill'], battlefield: ['Island'] }, p2: { library: ['Test Steel Golem'] }, defs: [GOLEM, MILL] });
    // put the golem on top of p2's library
    s = tweak(s, (t) => {
      const g = find(t, 'Test Steel Golem', 'library', 'p2');
      t.zones.library.p2 = [g, ...t.zones.library.p2!.filter((x) => x !== g)];
    });
    s = cast(s, 'Test Tide Mill', [p2]);
    s = passBoth(s);
    expect(whereIs(s, 'Test Steel Golem', 'p2')).toEqual(['library']);
    expect(s.zones.graveyard.p2!.length).toBe(2);
  });
  it('CR 614.6 on the stack: countered, it is shuffled into its owner\'s library instead of going to the graveyard', () => {
    let s = scenario(['Counterspell', 'Island', 'Plains'], { p1: { hand: ['Test Steel Golem'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'] }, p2: { hand: ['Counterspell'], battlefield: ['Island', 'Island'] }, defs: [GOLEM] });
    s = cast(s, 'Test Steel Golem');
    s = pass(s); // p1 passes; p2 has priority
    const spell = s.zones.stack[0]!;
    s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Counterspell', 'hand', 'p2') }), [obj(spell)]);
    s = passBoth(s);
    expect(whereIs(s, 'Test Steel Golem', 'p1')).toEqual(['library']);
    expect(s.zones.graveyard.p1!.length).toBe(0);
  });
});

describe('CR 614.9, 615.7: "{0}: The next 1 damage that would be dealt to ~ this turn is dealt to target creature you control instead"', () => {
  const GUARD = card('Test Shield Bearer', 'Creature — Kor Soldier', '{0}: The next 1 damage that would be dealt to ~ this turn is dealt to target creature you control instead.', '{2}{W}', { pt: ['2', '4'] });
  it('is automated: a redirection shield with a budget of 1', () => {
    expect(manualParts(GUARD)).toEqual([]);
    expect(JSON.stringify(GUARD)).toContain('"body":{"b":"redirect","to":{"ref":"target","id":"t0"},"amount":1},"shield":{"uses":"all","amount":1}');
  });
  const boltBearer = (activations: number): { wall: number; bearer: number } => {
    let s = scenario(['Lightning Bolt', 'Mountain'], { p1: { battlefield: ['Test Shield Bearer', 'Test Stone Wall'] }, p2: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] }, defs: [GUARD, WALL] });
    const bearer = find(s, 'Test Shield Bearer', 'battlefield', 'p1');
    const wall = find(s, 'Test Stone Wall', 'battlefield', 'p1');
    for (let i = 0; i < activations; i++) {
      s = activate(s, bearer, [obj(wall)]);
      s = passBoth(s);
    }
    s = pass(s); // the stack is empty: p2 gets priority in p1's main phase
    s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Lightning Bolt', 'hand', 'p2') }), [obj(bearer)]);
    s = passBoth(s);
    // CR 616.1: with two shields that apply, the affected object's controller chooses one to apply first (they are the same: either order)
    for (let i = 0; i < 4 && s.pending?.kind === 'chooseReplacement'; i++) {
      const d = s.pending as { options: { id: string }[] };
      s = answer(s, { kind: 'chooseReplacement', id: d.options[0]!.id });
    }
    return { wall: s.objects[wall]!.damage, bearer: s.objects[bearer]?.damage ?? -1 };
  };
  it('of 3 damage, 1 is dealt to the other creature and 2 to ~ (CR 614.9: the rest of the damage is still dealt to ~)', () => {
    expect(boltBearer(1)).toEqual({ wall: 1, bearer: 2 });
  });
  it('CR 615.7 by analogy: two activations are two shields of 1 each: 2 is redirected, 1 is dealt to ~', () => {
    expect(boltBearer(2)).toEqual({ wall: 2, bearer: 1 });
  });
  it('without an activation all 3 damage is dealt to ~', () => {
    expect(boltBearer(0)).toEqual({ wall: 0, bearer: 3 });
  });
});

describe('CR 615.1a, 510.1: "Prevent all combat damage that would be dealt by target creature this turn"', () => {
  const HORN = card('Test Quiet Horn', 'Artifact', '{1}, {T}: Prevent all combat damage that would be dealt by target creature this turn.', '{3}');
  const PINGER = card('Test Spark Imp', 'Creature — Imp', '{T}: ~ deals 1 damage to any target.', '{1}', { pt: ['1', '1'] });
  it('is automated', () => {
    expect(manualParts(HORN)).toEqual([]);
    expect(JSON.stringify(HORN)).toContain('"replaces":{"ev":"damage","combat":true,"source":{"is":{"ref":"target","id":"t0"}}}');
  });
  it('the creature deals no combat damage this turn; another creature does', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Quiet Horn', 'Plains', 'Test Hill Bear', { name: 'Test Hill Bear' }] }, defs: [HORN, BEAR] });
    const [a, b] = findAll(s, 'Test Hill Bear', 'battlefield', 'p1');
    s = activate(s, find(s, 'Test Quiet Horn', 'battlefield', 'p1'), [obj(a!)]);
    s = passBoth(s);
    s = runCombat(s, { attack: [[a!, 'p2'], [b!, 'p2']] });
    expect(life(s, 'p2')).toBe(18); // only the other bear's 2
  });
  it('CR 615.1a: noncombat damage the creature deals is not prevented', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Quiet Horn', 'Plains', 'Test Spark Imp'] }, defs: [HORN, PINGER] });
    const imp = find(s, 'Test Spark Imp', 'battlefield', 'p1');
    s = activate(s, find(s, 'Test Quiet Horn', 'battlefield', 'p1'), [obj(imp)]);
    s = passBoth(s);
    s = activate(s, imp, [p2]);
    s = passBoth(s);
    expect(life(s, 'p2')).toBe(19);
  });
});

describe('CR 104.3b, 104.2: "You can\'t lose the game and your opponents can\'t win the game"', () => {
  const ANGEL = card('Test Gilded Angel', 'Artifact Creature — Angel', "Flying\nYou can't lose the game and your opponents can't win the game.", '{7}', { pt: ['3', '4'] });
  it('is automated', () => {
    expect(manualParts(ANGEL)).toEqual([]);
  });
  it('at 0 life its controller stays in the game while it is on the battlefield, and loses once it is gone', () => {
    let s = scenario(['Murder', 'Swamp'], { p1: { battlefield: ['Test Gilded Angel'] }, p2: { hand: ['Murder'], battlefield: ['Swamp', 'Swamp', 'Swamp'] }, defs: [ANGEL] });
    s = tweak(s, (t) => { t.players.find((p) => p.id === 'p1')!.life = 0; });
    s = pass(s); // state-based actions are checked before p2 gets priority (CR 704.3)
    expect(s.result).toBeFalsy();
    expect(s.players.find((p) => p.id === 'p1')!.hasLost).toBeFalsy();
    s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Murder', 'hand', 'p2') }), [obj(find(s, 'Test Gilded Angel', 'battlefield', 'p1'))]);
    s = passBoth(s);
    expect(s.players.find((p) => p.id === 'p1')!.hasLost).toBe(true);
  });
});

describe('CR 724.1: "End the turn."', () => {
  const ENDER = card('Test Last Light', 'Sorcery', 'Destroy all artifacts and creatures. End the turn.', '{2}');
  it('is automated', () => {
    expect(manualParts(ENDER)).toEqual([]);
    expect(JSON.stringify(ENDER)).toContain('{"op":"endTurn"}');
  });
  it('CR 724.1b-d: the creatures are destroyed, the spell itself is exiled, and the game goes straight to the cleanup step (no combat, no end step)', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Last Light'], battlefield: ['Plains', 'Plains', 'Test Hill Bear'] }, p2: { battlefield: ['Test Hill Bear'] }, defs: [ENDER, BEAR] });
    const turn = s.turn.number;
    s = cast(s, 'Test Last Light');
    s = passBoth(s);
    expect(findAll(s, 'Test Hill Bear', 'battlefield')).toEqual([]);
    expect(whereIs(s, 'Test Last Light', 'p1')).toEqual(['exile']);
    s = passUntil(s, (x) => x.turn.number > turn, 'the next turn', 20);
    expect(s.turn.activePlayer).toBe('p2');
    expect(s.log.some((l) => l.rules?.includes('CR 724.1d'))).toBe(true);
  });
});
