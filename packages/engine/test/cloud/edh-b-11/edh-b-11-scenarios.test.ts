/**
 * Commander lane edh-b, round edh-b-11: the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented
 * names, design 6.10). Each test is named after the rule it checks, with its negative case.
 *
 *   CR 118.12, 122.1b, 608.2d   "you may pay {E}. If you do, put your choice of a +1/+1, first strike, or trample counter on that creature."
 *   CR 705.2, 613.4c            "flip a coin until you lose a flip" with "whenever a player wins a coin flip, double ~'s power and toughness until end of turn"
 *   CR 118.12, 701.21a          "you may sacrifice another creature or an artifact. If you do, ..." (no sacrifice: nothing; the source itself can't be the creature)
 *   CR 701.21a, 701.23a, 110.2  "Target artifact creature's controller sacrifices it. That player may search their library for a noncreature artifact card, put it onto the battlefield, then shuffle."
 *   CR 608.2c, 603.4            "draw a card if that creature has a +1/+1 counter on it. If it doesn't, put a +1/+1 counter on it."
 *   CR 702.70a-b                poisonous N (a combat-damage trigger: that player gets N poison counters)
 *   CR 122.1, 608.2d            "Put two +1/+1 counters on up to one creature. It gains lifelink until end of turn."
 *   CR 702.6a, 602.5d, 117.1a   "You may activate equip abilities any time you could cast an instant." (with a spell on the stack, and on an opponent's turn; without it, neither)
 *   CR 701.10b, 608.2c          "Until end of turn, double target creature's power X times." (each doubling reads the power the one before left)
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, GameState } from '../../../src/index';
import { act, answer, attackUnblocked, declareAttackers, declareBlockers, find, pass, poisonOf, scenario, toDeclareAttackers, tweak } from '../../m5/helpers';
import { attackWith, card, pt, resolveAll, settle } from '../cmd3/helpers';
import { advanceTo, findAll, legal } from '../../m3/scenario';

const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const counterOn = (s: GameState, name: string, kind: string): number => {
  const id = s.zones.battlefield.find((x) => s.defs[s.objects[x]!.defId]!.name === name)!;
  return s.objects[id]!.counters[kind] ?? 0;
};

describe('CR 118.12, 122.1b, 608.2d: "you may pay {E}. If you do, put your choice of a +1/+1, first strike, or trample counter on that creature."', () => {
  const DOM = card('Test Salvo Dominator', 'Creature — Robot', 'Whenever an artifact creature you control attacks, you may pay {E}. If you do, put your choice of a +1/+1, first strike, or trample counter on that creature.', ['2', '2']);
  const GEAR = card('Test Gear Runner', 'Artifact Creature — Construct', '', ['1', '1']);
  const DEFS = [DOM, GEAR];
  const start = (energy: number): GameState => tweak(scenario(['Plains'], { p1: { battlefield: ['Test Salvo Dominator', 'Test Gear Runner'] }, defs: DEFS }), (t) => { t.players.find((p) => p.id === 'p1')!.counters.energy = energy; });
  it('compiles with no manual part', () => { expect(noManual(DOM)).toBe(true); });
  it('paying one energy lets you choose; the chosen kind (trample) goes on the attacking artifact creature, once', () => {
    let s = start(2);
    s = attackWith(s, [find(s, 'Test Gear Runner', 'battlefield', 'p1')]);
    s = resolveAll(s, { yes: true, option: '2' });
    expect(s.players.find((p) => p.id === 'p1')!.counters.energy).toBe(1);
    expect(counterOn(s, 'Test Gear Runner', 'trample')).toBe(1);
    expect(counterOn(s, 'Test Gear Runner', 'first strike')).toBe(0);
    expect(counterOn(s, 'Test Gear Runner', '+1/+1')).toBe(0);
  });
  it('the +1/+1 choice makes the creature 2/2', () => {
    let s = start(1);
    s = attackWith(s, [find(s, 'Test Gear Runner', 'battlefield', 'p1')]);
    s = resolveAll(s, { yes: true, option: '0' });
    expect(pt(s, find(s, 'Test Gear Runner', 'battlefield', 'p1'))).toBe('2/2');
  });
  it('declining the payment puts no counter and keeps the energy', () => {
    let s = start(2);
    s = attackWith(s, [find(s, 'Test Gear Runner', 'battlefield', 'p1')]);
    s = resolveAll(s, { yes: false });
    expect(s.players.find((p) => p.id === 'p1')!.counters.energy).toBe(2);
    for (const k of ['trample', 'first strike', '+1/+1']) expect(counterOn(s, 'Test Gear Runner', k)).toBe(0);
  });
  it('with no energy the payment cannot be made: no counter', () => {
    let s = start(0);
    s = attackWith(s, [find(s, 'Test Gear Runner', 'battlefield', 'p1')]);
    s = resolveAll(s, { yes: true, option: '2' });
    for (const k of ['trample', 'first strike', '+1/+1']) expect(counterOn(s, 'Test Gear Runner', k)).toBe(0);
  });
  it('a nonartifact attacker does not trigger it', () => {
    const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
    let s = tweak(scenario(['Plains'], { p1: { battlefield: ['Test Salvo Dominator', 'Test Plain Bear'] }, defs: [DOM, BEAR] }), (t) => { t.players.find((p) => p.id === 'p1')!.counters.energy = 2; });
    s = attackWith(s, [find(s, 'Test Plain Bear', 'battlefield', 'p1')]);
    s = resolveAll(s, { yes: true, option: '2' });
    expect(s.players.find((p) => p.id === 'p1')!.counters.energy).toBe(2);
  });
});

describe('CR 705.2, 613.4c: "flip a coin until you lose a flip" and "whenever a player wins a coin flip, double ~\'s power and toughness until end of turn"', () => {
  const EYE = card('Test Chaos Eye', 'Creature — Dog', '{0}: Flip a coin until you lose a flip.\nWhenever a player wins a coin flip, double Test Chaos Eye\'s power and toughness until end of turn.', ['1', '1']);
  it('compiles with no manual part', () => { expect(noManual(EYE)).toBe(true); });
  it('each won flip doubles once: the power ends at 2 to the number of calls minus 1 (the last flip is the lost one)', () => {
    for (const seed of ['okaun-a', 'okaun-b', 'okaun-c', 'okaun-d']) {
      let s = scenario(['Plains'], { p1: { battlefield: ['Test Chaos Eye'] }, defs: [EYE], seed });
      const g = find(s, 'Test Chaos Eye', 'battlefield', 'p1');
      s = act(s, { type: 'activate', player: 'p1', source: g, ability: 'p:0:0' });
      let calls = 0;
      for (let guard = 0; guard < 300; guard++) {
        const d = s.pending as unknown as { kind: string; prompt?: string } | undefined;
        if (d?.kind === 'chooseOption' && (d.prompt ?? '').startsWith('Call the coin flip')) { calls++; s = answer(s, { kind: 'chooseOption', ids: ['heads'] }); }
        else if (d?.kind === 'priority' && s.zones.stack.length === 0) break;
        else if (d?.kind === 'priority') s = pass(s);
        else break;
      }
      expect(calls, seed).toBeGreaterThanOrEqual(1);
      expect(pt(s, g), seed).toBe(`${2 ** (calls - 1)}/${2 ** (calls - 1)}`);
    }
  });
});

describe('CR 118.12, 701.21a: "you may sacrifice another creature or an artifact. If you do, create a token"', () => {
  const ZEAL = card('Test Bone Pilgrim', 'Creature — Goblin', 'Whenever you attack, you may sacrifice another creature or an artifact. If you do, create a 4/1 black Skeleton creature token with menace that\'s tapped and attacking.', ['2', '2']);
  const FODDER = card('Test Spare Bear', 'Creature — Bear', '', ['1', '1']);
  const TRINKET = card('Test Brass Trinket', 'Artifact', '');
  const DEFS = [ZEAL, FODDER, TRINKET];
  const skeletons = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1').length;
  it('with only the source (no other creature or artifact) there is nothing to sacrifice: no token, the source stays', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Bone Pilgrim'] }, defs: DEFS });
    s = attackWith(s, [find(s, 'Test Bone Pilgrim', 'battlefield', 'p1')]);
    s = resolveAll(s, { yes: true });
    expect(skeletons(s)).toBe(0);
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Bone Pilgrim')).toBe(true);
  });
  it('another creature may be sacrificed: the token is made; declining makes none and keeps the creature', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Bone Pilgrim', 'Test Spare Bear'] }, defs: DEFS });
    s = attackWith(s, [find(s, 'Test Bone Pilgrim', 'battlefield', 'p1')]);
    const bear = find(s, 'Test Spare Bear', 'battlefield', 'p1');
    const yes = resolveAll(s, { yes: true, objects: [bear] });
    expect(skeletons(yes)).toBe(1);
    expect(yes.zones.battlefield.includes(bear)).toBe(false);
    const no = resolveAll(s, { yes: false });
    expect(skeletons(no)).toBe(0);
    expect(no.zones.battlefield.includes(bear)).toBe(true);
  });
});

describe('CR 701.21a, 701.23a, 110.2: "Target artifact creature\'s controller sacrifices it. That player may search their library for a noncreature artifact card, put it onto the battlefield, then shuffle."', () => {
  const ARC = card('Test Arc Dwarf', 'Legendary Creature — Dwarf', "{T}: Target artifact creature's controller sacrifices it. That player may search their library for a noncreature artifact card, put it onto the battlefield, then shuffle.", ['1', '1']);
  const RUNNER = card('Test Gear Runner', 'Artifact Creature — Construct', '', ['1', '1']);
  const TRINKET = card('Test Brass Trinket', 'Artifact', '');
  const GOLEM = card('Test Brass Golem', 'Artifact Creature — Golem', '', ['3', '3']);
  const DEFS = [ARC, RUNNER, TRINKET, GOLEM];
  const names = (s: GameState, who: string): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === who).map((id) => s.defs[s.objects[id]!.defId]!.name);
  const run = (yes: boolean, library: string[]): GameState => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Arc Dwarf'] }, p2: { battlefield: ['Test Gear Runner'], library }, defs: DEFS });
    s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Arc Dwarf', 'battlefield', 'p1'), ability: 'p:0:0' });
    s = settle(s, { targets: [{ kind: 'object', id: find(s, 'Test Gear Runner', 'battlefield', 'p2') }] });
    const trinket = s.zones.library.p2!.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Brass Trinket');
    return resolveAll(s, { yes, ...(trinket !== undefined ? { objects: [trinket] } : {}) });
  };
  it('compiles with no manual part', () => { expect(noManual(ARC)).toBe(true); });
  it('the opponent who controls the creature sacrifices it, then searches their own library: the noncreature artifact comes under their control', () => {
    const s = run(true, ['Test Brass Golem', 'Test Brass Trinket']);
    expect(names(s, 'p2')).toEqual(['Test Brass Trinket']);
    expect(names(s, 'p1')).toEqual(['Test Arc Dwarf']);
    expect(s.zones.graveyard.p2!.map((id) => s.defs[s.objects[id]!.defId]!.name)).toEqual(['Test Gear Runner']);
  });
  it('declining the search leaves the library alone: the creature is still sacrificed', () => {
    const s = run(false, ['Test Brass Trinket']);
    expect(names(s, 'p2')).toEqual([]);
    expect(s.zones.library.p2!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Brass Trinket')).toBe(true);
  });
  it('a creature artifact is not a noncreature artifact: with only the Golem in the library nothing comes', () => {
    const s = run(true, ['Test Brass Golem']);
    expect(names(s, 'p2')).toEqual([]);
  });
});

describe('CR 608.2c: "draw a card if that creature has a +1/+1 counter on it. If it doesn\'t, put a +1/+1 counter on it."', () => {
  const MAYOR = card('Test Mutant Mayor', 'Legendary Creature — Mutant', "Whenever a creature you control deals combat damage to a player, draw a card if that creature has a +1/+1 counter on it. If it doesn't, put a +1/+1 counter on it.", ['2', '2']);
  const run = (counters: number): GameState => {
    let s = scenario(['Plains'], { p1: { battlefield: [{ name: 'Test Mutant Mayor', counters: counters > 0 ? { '+1/+1': counters } : {} }] }, defs: [MAYOR] });
    s = attackUnblocked(s, [find(s, 'Test Mutant Mayor', 'battlefield', 'p1')]);
    return resolveAll(s);
  };
  it('compiles with no manual part', () => { expect(noManual(MAYOR)).toBe(true); });
  it('a creature without a counter gets one and nothing is drawn', () => {
    const start = scenario(['Plains'], { p1: { battlefield: ['Test Mutant Mayor'] }, defs: [MAYOR] }).zones.hand.p1!.length;
    const s = run(0);
    expect(counterOn(s, 'Test Mutant Mayor', '+1/+1')).toBe(1);
    expect(s.zones.hand.p1!.length).toBe(start);
  });
  it('a creature that already has a counter draws a card and gets no more', () => {
    const start = scenario(['Plains'], { p1: { battlefield: ['Test Mutant Mayor'] }, defs: [MAYOR] }).zones.hand.p1!.length;
    const s = run(1);
    expect(counterOn(s, 'Test Mutant Mayor', '+1/+1')).toBe(1);
    expect(s.zones.hand.p1!.length).toBe(start + 1);
  });
});

describe('CR 702.70a-b: poisonous N', () => {
  const SLIVER = card('Test Venom Sliver', 'Creature — Sliver', 'Each Sliver creature you control has poisonous 1.', ['1', '1']);
  const KIN = card('Test Plain Sliver', 'Creature — Sliver', '', ['2', '2']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const attack = (...who: string[]): GameState => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Venom Sliver', 'Test Plain Sliver', 'Test Plain Bear'] }, defs: [SLIVER, KIN, BEAR] });
    s = declareAttackers(toDeclareAttackers(s), who.map((n) => [find(s, n, 'battlefield', 'p1')] as [string]));
    for (let guard = 0; guard < 60 && s.turn.step !== 'endCombat'; guard++) {
      const d = s.pending as unknown as { kind: string; items?: { id: string }[] } | undefined;
      if (d?.kind === 'declareBlockers') s = declareBlockers(s, []);
      else if (d?.kind === 'order') s = answer(s, { kind: 'order', ids: d.items!.map((x) => x.id) });
      else s = pass(s);
    }
    return s;
  };
  it('compiles with no manual part', () => { expect(noManual(SLIVER)).toBe(true); });
  it('a Sliver that deals combat damage to a player gives that player one poison counter per Sliver; a Bear gives none', () => {
    expect(poisonOf(attack('Test Plain Sliver'), 'p2')).toBe(1);
    expect(poisonOf(attack('Test Plain Sliver', 'Test Venom Sliver'), 'p2')).toBe(2);
    expect(poisonOf(attack('Test Plain Bear'), 'p2')).toBe(0);
  });
});

describe('CR 122.1, 608.2d: "Put two +1/+1 counters on up to one creature. It gains lifelink until end of turn."', () => {
  const PUMP = card('Test Hushed Boon', 'Sorcery', 'Put two +1/+1 counters on up to one creature. It gains lifelink until end of turn.');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const run = (pick: 'bear' | 'none' | 'foe'): GameState => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Hushed Boon'], battlefield: ['Test Plain Bear'] }, p2: { battlefield: ['Test Plain Bear'] }, defs: [PUMP, BEAR] });
    const mine = find(s, 'Test Plain Bear', 'battlefield', 'p1');
    const theirs = find(s, 'Test Plain Bear', 'battlefield', 'p2');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Hushed Boon', 'hand', 'p1') });
    return resolveAll(s, { objects: pick === 'bear' ? [mine] : pick === 'foe' ? [theirs] : [] });
  };
  it('compiles with no manual part', () => { expect(noManual(PUMP)).toBe(true); });
  it('the chosen creature gets two counters and lifelink; no target is announced (it may be an opponent\'s creature)', () => {
    const s = run('bear');
    const mine = find(s, 'Test Plain Bear', 'battlefield', 'p1');
    expect(s.objects[mine]!.counters['+1/+1']).toBe(2);
    expect(pt(s, mine)).toBe('4/4');
    const foe = run('foe');
    expect(foe.objects[find(foe, 'Test Plain Bear', 'battlefield', 'p2')]!.counters['+1/+1']).toBe(2);
  });
  it('choosing none puts nothing anywhere', () => {
    const s = run('none');
    for (const id of s.zones.battlefield) expect(s.objects[id]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});

describe('CR 701.10b, 608.2c: "Until end of turn, double target creature\'s power X times."', () => {
  const GROW = card('Test Swelling Surge', 'Instant', "Until end of turn, double target creature's power X times.", undefined, '{X}{G}');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const run = (x: number): GameState => {
    let s = scenario(['Forest'], { p1: { hand: ['Test Swelling Surge'], battlefield: ['Test Plain Bear', ...Array(x + 1).fill('Forest')] }, defs: [GROW, BEAR] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Swelling Surge', 'hand', 'p1') });
    for (let guard = 0; guard < 6; guard++) {
      const kind = s.pending?.kind;
      if (kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: x });
      else if (kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Test Plain Bear', 'battlefield', 'p1') }] });
      else break;
    }
    return resolveAll(s);
  };
  it('compiles with no manual part', () => { expect(noManual(GROW)).toBe(true); });
  it('each doubling reads the power the one before left: X=3 on a 2/2 makes a 16/2; X=1 a 4/2; X=0 changes nothing', () => {
    const bear = (s: GameState): string => pt(s, find(s, 'Test Plain Bear', 'battlefield', 'p1'));
    expect(bear(run(3))).toBe('16/2');
    expect(bear(run(1))).toBe('4/2');
    expect(bear(run(0))).toBe('2/2');
  });
});

describe('CR 702.6a, 602.5d, 117.1a: "You may activate equip abilities any time you could cast an instant."', () => {
  const SHIKARI = card('Test Cat Samurai', 'Creature — Cat Samurai', 'You may activate equip abilities any time you could cast an instant.', ['1', '1']);
  const AXE = card('Test Axe', 'Artifact — Equipment', 'Equipped creature gets +1/+0.\nEquip {0}', undefined, '{1}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const IDEA = card('Test Idea', 'Sorcery', 'Draw a card.');
  const DEFS = [SHIKARI, AXE, BEAR, IDEA];
  const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
  const equips = (s: GameState, who: 'p1' | 'p2' = 'p1'): string[] => legal(s, who, 'activate').flatMap((a) => (a.object !== undefined && nameOf(s, a.object) === 'Test Axe' ? [a.object] : []));
  const board = (shikari: boolean): GameState => scenario([], { defs: DEFS, p1: { hand: ['Test Idea'], battlefield: [...(shikari ? ['Test Cat Samurai'] : []), 'Test Axe', 'Test Bear'] } });
  const withSpellOnStack = (s: GameState): GameState => settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Idea', 'hand', 'p1') }));
  it('compiles with no manual part', () => { expect(noManual(SHIKARI)).toBe(true); });
  it('with a spell on the stack the equip is still offered, and activating it puts it on the stack above the spell', () => {
    const s1 = withSpellOnStack(board(true));
    expect(s1.zones.stack.length).toBe(1);
    const axe = findAll(s1, 'Test Axe', 'battlefield', 'p1')[0]!;
    expect(equips(s1)).toContain(axe);
    const s2 = settle(act(s1, legal(s1, 'p1', 'activate').find((a) => a.object === axe)!.action), { targets: [{ kind: 'object', id: find(s1, 'Test Bear', 'battlefield', 'p1') }] });
    expect(s2.zones.stack.length).toBe(2);
  });
  it("it applies on an opponent's turn too (it has no turn condition): offered during the opponent's upkeep", () => {
    let s = advanceTo(board(true), 2, 'upkeep');
    s = act(s, { type: 'pass', player: s.pending!.player });
    expect(s.turn.activePlayer).toBe('p2');
    expect(s.pending?.player).toBe('p1');
    expect(equips(s).length).toBe(1);
  });
  it('negative: without it the equip is not offered with a spell on the stack, nor on the opponent\'s turn; on its own main phase it is', () => {
    expect(equips(board(false)).length).toBe(1);
    expect(equips(withSpellOnStack(board(false)))).toEqual([]);
    let s = advanceTo(board(false), 2, 'upkeep');
    s = act(s, { type: 'pass', player: s.pending!.player });
    expect(equips(s)).toEqual([]);
  });
});
