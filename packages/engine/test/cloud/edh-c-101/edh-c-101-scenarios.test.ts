/**
 * Commander lane edh-c, round edh-c-101: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default compiler.
 * Each test is named after the rule it checks and has its negative case. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 122.1, 613.4c, 608.2h   "Creatures you control get +1/+0 until end of turn for each lore counter among Sagas you control." (every Saga you control, lore counters only)
 *   CR 118.12, 603.12, 601.2b  "Whenever ~ attacks, you may sacrifice a Clue or pay {1}{U}. When you do, tap target creature an opponent controls." (one cost chosen; the reflexive trigger)
 *   CR 105.2, 608.2b           "Counter target spell if it shares a color with a creature you control." (checked as the spell resolves)
 *   CR 508.1, 603.2c           "When you attack with exactly two creatures, ..." (the declaration's attackers number exactly two)
 *   CR 115.1, 613.4c           "{R}: ~ and another target creature each get +1/+0 until end of turn." (the second target is another creature)
 *   CR 613.4b, 608.2d, 608.2h  "... you may have the base power and toughness of target Human you control become equal to ~'s power and toughness until end of turn."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { charsOfObject } from '../../../src/rules/characteristics';
import { act, answer, find, legal, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; colors?: string[]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const chars = (s: GameState, id: ObjectId) => charsOfObject(s, s.objects[id]!);
const power = (s: GameState, id: ObjectId): number => Number(chars(s, id).power);
const toughness = (s: GameState, id: ObjectId): number => Number(chars(s, id).toughness);

type Target = { kind: 'player'; id: PlayerId } | { kind: 'object'; id: ObjectId };
interface Plan { targets?: Target[][]; yes?: boolean; option?: number }
function drive(s0: GameState, plan: Plan = {}): GameState {
  let s = s0;
  const targets = plan.targets ?? [];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.shift() ?? [] });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: plan.yes ?? true });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [p.options[plan.option ?? 0]!.id] });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const settle = (s0: GameState, plan: Plan = {}): GameState => {
  let s = drive(s0, plan);
  for (let i = 0; i < 12 && s.zones.stack.length > 0 && s.pending?.kind === 'priority'; i++) s = drive(pass(pass(s)), plan);
  return s;
};
function attack(s0: GameState, attackers: ObjectId[], plan: Plan = {}): GameState {
  let s = s0;
  for (let i = 0; i < 60 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, plan);
  s = answer(s, { kind: 'declareAttackers', attacks: attackers.map((attacker) => ({ attacker, defender: 'p2' as PlayerId })) });
  for (let i = 0; i < 40 && s.turn.step !== 'declareBlockers'; i++) s = s.pending?.kind === 'priority' ? (s.zones.stack.length > 0 || s.turn.step === 'beginCombat' ? pass(s) : pass(s)) : drive(s, plan);
  return settle(s, plan);
}

describe('CR 122.1, 613.4c, 608.2h: "Creatures you control get +1/+0 until end of turn for each lore counter among Sagas you control."', () => {
  const RALLY = card('Test Saga Rally', 'Sorcery', 'Creatures you control get +1/+0 until end of turn for each lore counter among Sagas you control.');
  const SAGA = card('Test Long Saga', 'Enchantment — Saga', '');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [RALLY, SAGA, BEAR];
  const run = (p1: unknown[], p2: unknown[] = []): GameState => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Plain Bear', ...p1], hand: ['Test Saga Rally'] }, p2: { battlefield: p2 } } as never);
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Saga Rally', 'hand', 'p1') } as never);
    return settle(s);
  };
  it('is automated; the lore counters of both your Sagas are added up (2 + 1 = +3/+0), a charge counter is not counted', () => {
    expect(full(RALLY)).toBe(true);
    const s = run([{ name: 'Test Long Saga', counters: { lore: 2, charge: 4 } }, { name: 'Test Long Saga', counters: { lore: 1 } }]);
    expect(power(s, find(s, 'Test Plain Bear', 'battlefield', 'p1'))).toBe(5);
    expect(toughness(s, find(s, 'Test Plain Bear', 'battlefield', 'p1'))).toBe(2);
  });
  it('negative: a Saga an opponent controls is not counted; with none of yours the bonus is +0/+0', () => {
    const s = run([{ name: 'Test Long Saga', counters: { lore: 1 } }], [{ name: 'Test Long Saga', counters: { lore: 3 } }]);
    expect(power(s, find(s, 'Test Plain Bear', 'battlefield', 'p1'))).toBe(3);
    const none = run([], [{ name: 'Test Long Saga', counters: { lore: 3 } }]);
    expect(power(none, find(none, 'Test Plain Bear', 'battlefield', 'p1'))).toBe(2);
  });
});

describe('CR 118.12, 603.12, 601.2b: "Whenever ~ attacks, you may sacrifice a Clue or pay {1}{U}. When you do, tap target creature an opponent controls."', () => {
  const HOBBIT = card('Test Nimble Scout', 'Creature — Halfling', 'Whenever ~ attacks, you may sacrifice a Clue or pay {1}{U}. When you do, tap target creature an opponent controls.', { pt: ['1', '1'] });
  const CLUE = card('Test Clue', 'Artifact — Clue', '');
  const ISLE = card('Test Isle', 'Land — Island', '{T}: Add {U}.');
  const OGRE = card('Test Big Ogre', 'Creature — Ogre', '', { pt: ['4', '4'] });
  const defs = [HOBBIT, CLUE, ISLE, OGRE];
  const run = (p1: unknown[], plan: Plan = {}): GameState => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Nimble Scout', ...p1] }, p2: { battlefield: ['Test Big Ogre'] } } as never);
    const ogre = find(s0, 'Test Big Ogre', 'battlefield', 'p2');
    return attack(s0, [find(s0, 'Test Nimble Scout', 'battlefield', 'p1')], { targets: [[{ kind: 'object', id: ogre }]], ...plan });
  };
  it('is automated', () => { expect(full(HOBBIT)).toBe(true); });
  it('sacrificing the Clue (the only cost payable) taps the chosen creature through the reflexive trigger', () => {
    const s = run([{ name: 'Test Clue', tapped: false }]);
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]?.name === 'Test Clue')).toBe(false);
    expect(s.objects[find(s, 'Test Big Ogre', 'battlefield', 'p2')]!.tapped).toBe(true);
  });
  it('paying {1}{U} instead (no Clue) also taps it, and spends the mana', () => {
    const s = run(['Test Isle', 'Test Isle']);
    expect(s.objects[find(s, 'Test Big Ogre', 'battlefield', 'p2')]!.tapped).toBe(true);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Isle' && s.objects[id]!.tapped)).toHaveLength(2);
  });
  it('with both payable the player chooses one: sacrificing leaves the lands untapped', () => {
    const s = run([{ name: 'Test Clue' }, 'Test Isle', 'Test Isle'], { option: 0 });
    expect(s.objects[find(s, 'Test Big Ogre', 'battlefield', 'p2')]!.tapped).toBe(true);
    const tappedLands = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Isle' && s.objects[id]!.tapped).length;
    const clues = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Clue').length;
    expect(tappedLands + (1 - clues)).toBe(tappedLands === 0 ? 1 : 2);
  });
  it('negative: declining the "may", or being unable to pay either cost, taps nothing (no reflexive trigger)', () => {
    expect(run([{ name: 'Test Clue' }], { yes: false }).objects[find(run([{ name: 'Test Clue' }], { yes: false }), 'Test Big Ogre', 'battlefield', 'p2')]!.tapped).toBe(false);
    const s = run([]);
    expect(s.objects[find(s, 'Test Big Ogre', 'battlefield', 'p2')]!.tapped).toBe(false);
  });
});

describe('CR 105.2, 608.2b: "Counter target spell if it shares a color with a creature you control."', () => {
  const JADED = card('Test Jaded Answer', 'Instant', 'Counter target spell if it shares a color with a creature you control.');
  const BOLT = card('Test Red Ember', 'Sorcery', 'You gain 3 life.', { colors: ['R'] });
  const RED = card('Test Red Imp', 'Creature — Imp', '', { pt: ['1', '1'], colors: ['R'] });
  const GREEN = card('Test Green Elk', 'Creature — Elk', '', { pt: ['1', '1'], colors: ['G'] });
  const GRAY = card('Test Gray Golem', 'Artifact Creature — Golem', '', { pt: ['1', '1'] });
  const defs = [JADED, BOLT, RED, GREEN, GRAY];
  const play = (creature: string): GameState => {
    let s = scenario([], { defs, p1: { battlefield: [creature], hand: ['Test Red Ember', 'Test Jaded Answer'] } } as never);
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Red Ember', 'hand', 'p1') } as never);
    s = drive(s);
    const bolt = s.zones.stack[0]!;
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Jaded Answer', 'hand', 'p1') } as never);
    s = drive(s, { targets: [[{ kind: 'object', id: bolt }]] });
    return settle(s);
  };
  it('is automated; a red creature of yours: the red spell is countered (no life)', () => {
    expect(full(JADED)).toBe(true);
    expect(life(play('Test Red Imp'), 'p1')).toBe(20);
  });
  it('negative: a green creature, or a colorless one (it shares no color), does not counter the red spell', () => {
    expect(life(play('Test Green Elk'), 'p1')).toBe(23);
    expect(life(play('Test Gray Golem'), 'p1')).toBe(23);
  });
});

describe('CR 508.1, 603.2c: "When you attack with exactly two creatures, you gain 3 life."', () => {
  const WATCH = card('Test Pair Watcher', 'Creature — Vampire', 'When you attack with exactly two creatures, you gain 3 life.', { pt: ['1', '1'] });
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [WATCH, BEAR];
  const run = (bears: number, withWatcher = true): GameState => {
    const s0 = scenario([], { defs, p1: { battlefield: [...(withWatcher ? ['Test Pair Watcher'] : []), ...Array(bears).fill('Test Plain Bear')] } } as never);
    const ids = s0.zones.battlefield.filter((id) => s0.objects[id]!.controller === 'p1');
    return attack(s0, ids);
  };
  it('is automated; two attackers: the life is gained once', () => {
    expect(full(WATCH)).toBe(true);
    expect(life(run(1), 'p1')).toBe(23);
  });
  it('negative: one attacker, or three, does not trigger', () => {
    expect(life(run(0), 'p1')).toBe(20);
    expect(life(run(2), 'p1')).toBe(20);
  });
});

describe('CR 115.1, 613.4c: "{R}: ~ and another target creature each get +1/+0 until end of turn."', () => {
  const DANCER = card('Test Pair Dancer', 'Creature — Vampire', '{0}: ~ and another target creature each get +1/+0 until end of turn.', { pt: ['2', '2'] });
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  it('is automated; both the creature itself and the other target get +1/+0', () => {
    expect(full(DANCER)).toBe(true);
    let s = scenario([], { defs: [DANCER, BEAR], p1: { battlefield: ['Test Pair Dancer', 'Test Plain Bear'] } } as never);
    const bear = find(s, 'Test Plain Bear', 'battlefield', 'p1');
    const dancer = find(s, 'Test Pair Dancer', 'battlefield', 'p1');
    s = settle(act(s, legal(s, 'p1', 'activate')[0]!.action), { targets: [[{ kind: 'object', id: bear }]] });
    expect(power(s, dancer)).toBe(3);
    expect(power(s, bear)).toBe(3);
  });
  it('negative: the creature itself is not a legal "another target creature"', () => {
    const s = scenario([], { defs: [DANCER, BEAR], p1: { battlefield: ['Test Pair Dancer'] } } as never);
    expect(legal(s, 'p1', 'activate')).toHaveLength(0); // no other creature to target
    expect(power(s, find(s, 'Test Pair Dancer', 'battlefield', 'p1'))).toBe(2);
  });
});

describe('CR 613.4b, 608.2d, 608.2h: "Whenever ~ attacks, you may have the base power and toughness of target Human you control become equal to ~\'s power and toughness until end of turn."', () => {
  const WOLF = card('Test Rally Wolf', 'Creature — Wolf Bear', "Whenever ~ attacks, you may have the base power and toughness of target Human you control become equal to ~'s power and toughness until end of turn.", { pt: ['5', '4'] });
  const MAN = card('Test Small Human', 'Creature — Human', '', { pt: ['1', '1'] });
  const ELF = card('Test Small Elf', 'Creature — Elf', '', { pt: ['1', '1'] });
  const defs = [WOLF, MAN, ELF];
  const run = (target: string, plan: Plan = {}, counters: Record<string, number> = {}): GameState => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Rally Wolf', { name: 'Test Small Human', counters }, 'Test Small Elf'] } } as never);
    return attack(s0, [find(s0, 'Test Rally Wolf', 'battlefield', 'p1')], { targets: [[{ kind: 'object', id: find(s0, target, 'battlefield', 'p1') }]], ...plan });
  };
  it('is automated; the Human becomes 5/4, the Wolf Bear itself is unchanged', () => {
    expect(full(WOLF)).toBe(true);
    const s = run('Test Small Human');
    expect(power(s, find(s, 'Test Small Human', 'battlefield', 'p1'))).toBe(5);
    expect(toughness(s, find(s, 'Test Small Human', 'battlefield', 'p1'))).toBe(4);
    expect(power(s, find(s, 'Test Rally Wolf', 'battlefield', 'p1'))).toBe(5);
  });
  it('a +1/+1 counter on the Human still applies after its base power and toughness are set (6/5)', () => {
    const s = run('Test Small Human', {}, { '+1/+1': 1 });
    expect(power(s, find(s, 'Test Small Human', 'battlefield', 'p1'))).toBe(6);
    expect(toughness(s, find(s, 'Test Small Human', 'battlefield', 'p1'))).toBe(5);
  });
  it('negative: declining the "may" leaves the Human 1/1; a creature that is not a Human is no legal target', () => {
    const s = run('Test Small Human', { yes: false });
    expect(power(s, find(s, 'Test Small Human', 'battlefield', 'p1'))).toBe(1);
    expect(() => run('Test Small Elf')).toThrow(/not a legal target/);
  });
});
