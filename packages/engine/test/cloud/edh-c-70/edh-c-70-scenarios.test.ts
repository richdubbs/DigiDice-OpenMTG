/**
 * Commander lane edh-c, round edh-c-70 (EDHREC ranks 29,001-29,500, second pass): the round's readings played through the engine with synthetic cards (invented names,
 * design 6.10), compiled by the game's default compiler, in 4-player games. Each group has its negative cases. CR cites are checked against the Comprehensive Rules text of 2026-09-25.
 *
 *   CR 303.4, 613.1b    "You control enchanted artifact creature."
 *   CR 615.1a, 115.1    "Prevent all damage that would be dealt this turn to up to two target creatures."
 *   CR 614.9, 615.7     "{0}: The next 1 damage that would be dealt to ~ this turn is dealt to any target instead."
 *   CR 608.2c, 701.9a   "Target player discards a card. If that player does, that player draws a card."
 *   CR 118.12a, 303.4   "At the beginning of the upkeep of enchanted artifact's controller, ~ deals 2 damage to that player unless they sacrifice that artifact."
 *   CR 105.3, 611.2a    "{0}, {T}: Target permanent you control becomes the color of your choice."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, type GameState, type ObjectId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, find, mpScenario, pass } from '../../m12/rules/helpers';
import { advanceTo, answer, legal } from '../../m3/scenario';
import { card, full, resolveAll, settle } from '../cmd3/helpers';

const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const onBf = (s: GameState, p: string, defId: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && s.objects[id]!.controller === p);
const castAs = (s: GameState, name: string, player: string, picks: Parameters<typeof settle>[1] = {}): GameState => settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) } as never), picks);
const target = (id: string, kind: 'object' | 'player' = 'object') => ({ kind, id } as never);

describe('CR 303.4, 613.1b: "You control enchanted artifact creature."', () => {
  const LEASH = card('Test Gear Leash', 'Enchantment — Aura', 'Enchant artifact creature\nYou control enchanted artifact creature.');
  const GOLEM = card('Test Gear Golem', 'Artifact Creature — Golem', '', ['2', '2']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const start = (): GameState => mpScenario({ defs: [LEASH, GOLEM, BEAR], zones: { p1: { hand: ['Test Gear Leash'] }, p2: { battlefield: ['Test Gear Golem', 'Test Plain Bear'] } } });
  it('is automated', () => expect(full(LEASH)).toBe(true));
  it('the enchanted artifact creature is controlled by the Aura\'s controller; the other creature is not', () => {
    const s0 = start();
    const golem = onBf(s0, 'p2', 'Test Gear Golem')[0]!;
    const s1 = resolveAll(castAs(s0, 'Test Gear Leash', 'p1', { targets: [target(golem)] }), { targets: [target(golem)] });
    expect(s1.objects[golem]!.controller).toBe('p1');
    expect(onBf(s1, 'p2', 'Test Plain Bear').length).toBe(1);
  });
  it('a creature that is not an artifact is not a legal target (negative)', () => {
    const s0 = start();
    const bear = onBf(s0, 'p2', 'Test Plain Bear')[0]!;
    const r = applyAction(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Gear Leash', 'hand', 'p1') } as never), { type: 'chooseTargets', player: 'p1', targets: [target(bear)] } as never);
    const s1 = r.error ? s0 : resolveAll(r.state, { targets: [target(bear)] });
    expect(s1.objects[bear]!.controller).toBe('p2');
  });
});

describe('CR 615.1a, 115.1: "Prevent all damage that would be dealt this turn to up to two target creatures."', () => {
  const WARD = card('Test Ward Pair', 'Instant', 'Prevent all damage that would be dealt this turn to up to two target creatures.');
  const BOLT = card('Test Plain Bolt', 'Instant', '~ deals 3 damage to target creature.');
  const OX = card('Test Steady Ox', 'Creature — Ox', '', ['1', '9']);
  const start = (): GameState => mpScenario({ defs: [WARD, BOLT, OX], zones: { p1: { hand: ['Test Ward Pair', 'Test Plain Bolt', 'Test Plain Bolt', 'Test Plain Bolt'] }, p2: { battlefield: ['Test Steady Ox', 'Test Steady Ox', 'Test Steady Ox'] } } });
  it('is automated', () => expect(full(WARD)).toBe(true));
  it('damage to the two chosen creatures is prevented; the third takes it (negative)', () => {
    const s0 = start();
    const [a, b, c] = onBf(s0, 'p2', 'Test Steady Ox');
    let s = resolveAll(castAs(s0, 'Test Ward Pair', 'p1', { targets: [target(a!), target(b!)] }), { targets: [target(a!), target(b!)] });
    for (const t of [a!, b!, c!]) s = resolveAll(castAs(s, 'Test Plain Bolt', 'p1', { targets: [target(t)] }), { targets: [target(t)] });
    expect(s.objects[a!]!.damage).toBe(0);
    expect(s.objects[b!]!.damage).toBe(0);
    expect(s.objects[c!]!.damage).toBe(3);
  });
  it('"up to" allows one target', () => {
    const s0 = start();
    const [a, b] = onBf(s0, 'p2', 'Test Steady Ox');
    let s = resolveAll(castAs(s0, 'Test Ward Pair', 'p1', { targets: [target(a!)] }), { targets: [target(a!)] });
    for (const t of [a!, b!]) s = resolveAll(castAs(s, 'Test Plain Bolt', 'p1', { targets: [target(t)] }), { targets: [target(t)] });
    expect(s.objects[a!]!.damage).toBe(0);
    expect(s.objects[b!]!.damage).toBe(3);
  });
});

describe('CR 614.9, 615.7: "The next 1 damage that would be dealt to ~ this turn is dealt to any target instead."', () => {
  const SQUIRE = card('Test Valiant Squire', 'Creature — Knight', '{0}: The next 1 damage that would be dealt to ~ this turn is dealt to any target instead.', ['1', '5']);
  const BOLT = card('Test Plain Bolt', 'Instant', '~ deals 3 damage to target creature.');
  const OX = card('Test Steady Ox', 'Creature — Ox', '', ['1', '9']);
  const start = (): GameState => mpScenario({ defs: [SQUIRE, BOLT, OX], zones: { p1: { battlefield: ['Test Valiant Squire'], hand: ['Test Plain Bolt'] }, p2: { battlefield: ['Test Steady Ox'] } } });
  const activate = (s: GameState, tgt: ReturnType<typeof target>): GameState => {
    const a = legal(s, 'p1', 'activate').find((x) => x.object === onBf(s, 'p1', 'Test Valiant Squire')[0] && !x.isMana)!;
    return resolveAll(settle(act(s, a.action), { targets: [tgt] }), { targets: [tgt] });
  };
  it('is automated', () => expect(full(SQUIRE)).toBe(true));
  it('1 of the 3 damage goes to the chosen player, 2 stay on the creature', () => {
    const s0 = start();
    const squire = onBf(s0, 'p1', 'Test Valiant Squire')[0]!;
    const s1 = activate(s0, target('p2', 'player'));
    const s2 = resolveAll(castAs(s1, 'Test Plain Bolt', 'p1', { targets: [target(squire)] }), { targets: [target(squire)] });
    expect(s2.objects[squire]!.damage).toBe(2);
    expect(life(s2, 'p2')).toBe(19);
  });
  it('it can be dealt to a creature too; damage to another creature is not redirected; without the activation nothing is (negatives)', () => {
    const s0 = start();
    const squire = onBf(s0, 'p1', 'Test Valiant Squire')[0]!;
    const ox = onBf(s0, 'p2', 'Test Steady Ox')[0]!;
    const s1 = activate(s0, target(ox));
    const s2 = resolveAll(castAs(s1, 'Test Plain Bolt', 'p1', { targets: [target(squire)] }), { targets: [target(squire)] });
    expect(s2.objects[ox]!.damage).toBe(1);
    expect(s2.objects[squire]!.damage).toBe(2);
    const s3 = resolveAll(castAs(s0, 'Test Plain Bolt', 'p1', { targets: [target(squire)] }), { targets: [target(squire)] });
    expect(s3.objects[squire]!.damage).toBe(3);
    const s4 = resolveAll(castAs(s1, 'Test Plain Bolt', 'p1', { targets: [target(ox)] }), { targets: [target(ox)] });
    expect(s4.objects[ox]!.damage).toBe(3);
  });
});

describe('CR 608.2c, 701.9a: "Target player discards a card. If that player does, that player draws a card."', () => {
  const PROBE = card('Test Cycling Probe', 'Sorcery', 'Target player discards a card. If that player does, that player draws a card.');
  const start = (hand: string[]): GameState => mpScenario({ defs: [PROBE], zones: { p1: { hand: ['Test Cycling Probe'] }, p2: { hand } } });
  const handOf = (s: GameState, p: string): number => (s.zones.hand[p] ?? []).length;
  it('is automated', () => expect(full(PROBE)).toBe(true));
  it('the other player discards one and draws one: same hand size, one more card in the graveyard', () => {
    const s0 = start(['Plains', 'Plains']);
    const s1 = resolveAll(castAs(s0, 'Test Cycling Probe', 'p1', { targets: [target('p2', 'player')] }), { targets: [target('p2', 'player')] });
    expect(handOf(s1, 'p2')).toBe(2);
    expect((s1.zones.graveyard['p2'] ?? []).length).toBe(1);
  });
  it('a player with no card to discard does not draw (negative)', () => {
    const s0 = start([]);
    const s1 = resolveAll(castAs(s0, 'Test Cycling Probe', 'p1', { targets: [target('p2', 'player')] }), { targets: [target('p2', 'player')] });
    expect(handOf(s1, 'p2')).toBe(0);
  });
});

describe('CR 118.12a, 303.4: "At the beginning of the upkeep of enchanted artifact\'s controller, ~ deals 2 damage to that player unless they sacrifice that artifact."', () => {
  const HEX = card('Test Rust Hex', 'Enchantment — Aura', 'Enchant artifact\nAt the beginning of the upkeep of enchanted artifact\'s controller, ~ deals 2 damage to that player unless they sacrifice that artifact.');
  const ORB = card('Test Brass Orb', 'Artifact', '');
  const start = (): GameState => mpScenario({ defs: [HEX, ORB], zones: { p1: { hand: ['Test Rust Hex'] }, p2: { battlefield: ['Test Brass Orb'] } } });
  /** The upkeep of the enchanted artifact's controller (player 2, turn 2); the payment is answered `yes`. */
  const toUpkeep = (s0: GameState, yes: boolean): GameState => {
    let s = s0;
    for (let i = 0; i < 80 && !(s.turn.activePlayer === 'p2' && s.turn.step === 'upkeep' && s.zones.stack.length === 0 && s.pending?.kind === 'priority' && s.turn.number >= 2); i++) {
      const d = s.pending!;
      if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes } as never);
      else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (d as { options: ObjectId[] }).options.slice(0, (d as { min: number }).min) } as never);
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true } as never);
      else s = pass(s);
    }
    return s;
  };
  it('is automated', () => expect(full(HEX)).toBe(true));
  it('the controller who does not sacrifice takes 2 damage and keeps the artifact', () => {
    const s0 = start();
    const orb = onBf(s0, 'p2', 'Test Brass Orb')[0]!;
    const s1 = resolveAll(castAs(s0, 'Test Rust Hex', 'p1', { targets: [target(orb)] }), { targets: [target(orb)] });
    const s2 = toUpkeep(s1, false);
    expect(life(s2, 'p2')).toBe(18);
    expect(s2.objects[orb]!.zone).toBe('battlefield');
  });
  it('the controller who sacrifices the artifact takes no damage and the artifact is gone', () => {
    const s0 = start();
    const orb = onBf(s0, 'p2', 'Test Brass Orb')[0]!;
    const s1 = resolveAll(castAs(s0, 'Test Rust Hex', 'p1', { targets: [target(orb)] }), { targets: [target(orb)] });
    const s2 = toUpkeep(s1, true);
    expect(life(s2, 'p2')).toBe(20);
    expect(s2.zones.battlefield.includes(orb)).toBe(false);
  });
});

describe('CR 105.3, 611.2a: "{0}, {T}: Target permanent you control becomes the color of your choice."', () => {
  const TOMB = card('Test Dye Vat', 'Artifact', '{0}, {T}: Target permanent you control becomes the color of your choice.');
  const BEAR = card('Test Ember Bear', 'Creature — Bear', '', ['2', '2'], '{1}{R}');
  const start = (): GameState => mpScenario({ defs: [TOMB, BEAR], zones: { p1: { battlefield: ['Test Dye Vat', 'Test Ember Bear'] }, p2: { battlefield: ['Test Ember Bear'] } } });
  const drive = (s0: GameState, tgt: ObjectId, color: string): GameState => {
    let s = s0;
    for (let g = 0; g < 40 && s.pending && s.pending.kind !== 'priority'; g++) {
      const p = s.pending;
      if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: tgt }] } as never);
      else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true } as never);
      else if (p.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color } as never);
      else throw new Error(`unexpected decision ${p.kind}`);
    }
    return s;
  };
  it('is automated', () => expect(full(TOMB)).toBe(true));
  it('the chosen color replaces the colors and lasts past the end of the turn', () => {
    const s0 = start();
    const bear = onBf(s0, 'p1', 'Test Ember Bear')[0]!;
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === onBf(s0, 'p1', 'Test Dye Vat')[0] && !x.isMana)!;
    let s = drive(act(s0, a.action), bear, 'U');
    for (let i = 0; i < 8 && s.zones.stack.length > 0; i++) s = drive(pass(s), bear, 'U');
    expect(getChars(s, bear).colors).toEqual(['U']);
    const other = onBf(s0, 'p2', 'Test Ember Bear')[0]!;
    expect(getChars(s, other).colors).toEqual([]);
    const n = advanceTo(s, 2, 'upkeep');
    expect(getChars(n, bear).colors).toEqual(['U']);
  });
});
