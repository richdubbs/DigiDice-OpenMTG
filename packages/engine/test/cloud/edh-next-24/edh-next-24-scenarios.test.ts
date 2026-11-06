/**
 * Commander lane edh-next, round edh-next-24: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's
 * default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites checked against the Comprehensive
 * Rules of 2026-09-25 (see the round's record).
 *
 *   CR 604.1, 613.1f, 613.4c   "Equipped creature has first strike and gets +X/+0, where X is the number of instant and sorcery cards in your graveyard." (Runechanter's Pike)
 *   CR 105.1, 105.2            "~ deals X damage to any target, where X is the number of colors that spell is." (Mana Cannons)
 *   CR 601.2f, 119.1, 103.4    "~ costs {2} less to cast if a player's life total is less than or equal to half their starting life total." (Game Over)
 *   CR 706.2, 706.3a           "Roll a d20 and add the number of cards in your hand." with the last row "15+" (Diviner's Portent)
 *   CR 615.1, 120.2a           "If a creature would deal combat damage to ~, prevent that damage and put a +1/+1 counter on ~." (Ironscale Hydra)
 *   CR 702.14c                 "Target creature loses all landwalk abilities until end of turn." (Hammerheim)
 *   CR 113.6k, 603.10a, 601.2i "When you cast this spell and when this creature dies, create a 0/1 Eldrazi Spawn token." (Eldrazi Repurposer)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, pass, put, scenario } from '../../m3/scenario';
import { tweak, declareAttackers, declareBlockers, toDeclareAttackers, toDeclareBlockers, toStep } from '../../m4/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const namesOn = (s: GameState, p: PlayerId): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => s.defs[s.objects[id]!.defId]!.name);
const idOn = (s: GameState, name: string): ObjectId => s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === name)!;

type Targets = ({ kind: 'player'; id: PlayerId } | { kind: 'object'; id: ObjectId })[][];
interface Opts { targets?: Targets }
function drive(s0: GameState, o: Opts = {}): GameState {
  let s = s0;
  const q = [...(o.targets ?? [])];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min === 0 ? p.max : p.min) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Opts = {}): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), o);
  return s;
}
const cast = (s: GameState, name: string, o: Opts = {}): GameState => resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), o), o);
const obj = (id: ObjectId): { kind: 'object'; id: ObjectId } => ({ kind: 'object', id });
const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const rolled = (s: GameState): number[] => s.log.flatMap((l) => { const m = /rolls a d\d+: (\d+)\./.exec(l.text); return m ? [Number(m[1])] : []; });
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'];

describe('CR 604.1, 613.4c: "Equipped creature has first strike and gets +X/+0, where X is the number of instant and sorcery cards in your graveyard."', () => {
  const PIKE = card('Test Pike', 'Artifact — Equipment', 'Equipped creature has first strike and gets +X/+0, where X is the number of instant and sorcery cards in your graveyard.\nEquip {0}');
  const BOLT = card('Test Bolt', 'Instant', 'Draw a card.');
  const defs = [PIKE, BOLT, BEAR];
  const stat = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
  const equipped = (graveyard: string[]): { s: GameState; bear: ObjectId } => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Pike', 'Test Bear'], graveyard } });
    const bear = idOn(s0, 'Test Bear');
    return { s: tweak(s0, (t) => { t.objects[idOn(s0, 'Test Pike')]!.attachedTo = bear; }), bear };
  };
  it('is understood', () => expect(noManual(PIKE)).toBe(true));
  it('the equipped creature gets +1/+0 for each instant and sorcery card in the graveyard, and first strike', () => {
    const { s, bear } = equipped(['Test Bolt', 'Test Bolt']);
    expect(stat(s, bear)).toBe('4/2');
    expect(getChars(s, bear)!.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword?: string }).keyword))).toContain('first strike');
  });
  it('a creature card or a land card in the graveyard is not counted, and an unequipped creature is unchanged (negative)', () => {
    const { s, bear } = equipped(['Test Bolt', 'Plains', 'Test Bear']);
    expect(stat(s, bear)).toBe('3/2');
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Pike', 'Test Bear'], graveyard: ['Test Bolt'] } });
    expect(stat(s0, idOn(s0, 'Test Bear'))).toBe('2/2');
  });
});

describe('CR 105.1, 105.2: "~ deals X damage to any target, where X is the number of colors that spell is." (cast trigger)', () => {
  const CANNONS = card('Test Cannons', 'Enchantment', 'Whenever you cast a multicolored spell, ~ deals X damage to any target, where X is the number of colors that spell is.');
  const TWO = card('Test Two', 'Sorcery', 'Draw a card.', { cost: '{W}{U}', colors: ['W', 'U'] });
  const THREE = card('Test Three', 'Sorcery', 'Draw a card.', { cost: '{W}{U}{B}', colors: ['W', 'U', 'B'] });
  const ONE = card('Test One', 'Sorcery', 'Draw a card.', { cost: '{W}', colors: ['W'] });
  const defs = [CANNONS, TWO, THREE, ONE];
  const LANDS = ['Plains', 'Island', 'Swamp'];
  const run = (spell: string, lands: string[]): GameState => {
    const s0 = scenario(['Plains', 'Island', 'Swamp'], { defs, p1: { battlefield: ['Test Cannons', ...lands], hand: [spell] } });
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, spell, 'hand', 'p1') }), { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = resolveAll(s, { targets: [[{ kind: 'player', id: 'p2' }]] });
    return s;
  };
  it('is understood', () => expect(noManual(CANNONS)).toBe(true));
  it('a two-color spell deals 2 damage to the target, a three-color spell 3', () => {
    expect(life(run('Test Two', ['Plains', 'Island']), 'p2')).toBe(20 - 2);
    expect(life(run('Test Three', ['Plains', 'Island', 'Swamp']), 'p2')).toBe(20 - 3);
  });
  it('a one-color spell does not trigger it (negative)', () => {
    expect(life(run('Test One', ['Plains']), 'p2')).toBe(20);
  });
});

describe('CR 601.2f, 119.1, 103.4: "~ costs {2} less to cast if a player\'s life total is less than or equal to half their starting life total." (Game Over)', () => {
  const SWEEP = card('Test Sweep', 'Sorcery', '~ costs {2} less to cast if a player\'s life total is less than or equal to half their starting life total.\nDestroy all creatures.', { cost: '{3}{B}{B}', colors: ['B'] });
  const defs = [SWEEP, BEAR];
  const hand = (p2life: number, p1life = 20): GameState => {
    const s = scenario(['Plains', 'Island', 'Swamp'], { defs, p1: { hand: ['Test Sweep'], battlefield: ['Swamp', 'Swamp', 'Swamp'] }, p2: { battlefield: ['Test Bear'] } });
    s.players.find((p) => p.id === 'p2')!.life = p2life;
    s.players.find((p) => p.id === 'p1')!.life = p1life;
    return s;
  };
  it('is understood', () => expect(noManual(SWEEP)).toBe(true));
  it('when an opponent is at half the starting life total (10 of 20) or less, three lands cast it', () => {
    const s = cast(hand(10), 'Test Sweep');
    expect(namesOn(s, 'p2')).toEqual([]);
  });
  it('your own life total counts too: "a player"', () => {
    const s = cast(hand(20, 9), 'Test Sweep');
    expect(namesOn(s, 'p2')).toEqual([]);
  });
  it('at 11 life nobody is low enough: three lands are not enough (negative)', () => {
    const s0 = hand(11);
    let failed = false;
    try { cast(s0, 'Test Sweep'); } catch { failed = true; }
    const s1 = failed ? s0 : cast(s0, 'Test Sweep');
    expect(namesOn(s1, 'p2')).toEqual(['Test Bear']);
  });
});

describe('CR 706.2, 706.3a: "Roll a d20 and add the number of cards in your hand." with the last row "15+" (Diviner\'s Portent)', () => {
  const PORTENT = card('Test Portent', 'Instant', 'Roll a d20 and add the number of cards in your hand.\n1—14 | Gain 1 life.\n15+ | Gain 5 life.');
  const defs = [PORTENT];
  const run = (seed: string, extra: number): GameState => {
    const s0 = scenario(['Plains', 'Island', 'Swamp'], { seed, defs, p1: { hand: ['Test Portent', ...Array(extra).fill('Plains') as string[]] } });
    return cast(s0, 'Test Portent');
  };
  it('is understood: the modifier is the hand, the last row is open ended', () => {
    expect(noManual(PORTENT)).toBe(true);
    expect(JSON.stringify(PORTENT.faces[0]!.abilities[0])).toMatch(/"min":15,"max":1000000|"max":1000000,"min":15/);
  });
  it('the result is the natural roll plus the cards left in hand: 15 or more gains 5, below 15 gains 1', () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) for (const extra of [0, 6]) {
      const s = run(seed, extra);
      const result = rolled(s)[0]! + extra;
      expect(life(s, 'p1'), `${seed} ${extra} ${result}`).toBe(20 + (result >= 15 ? 5 : 1));
      seen.add(result >= 15 ? (rolled(s)[0]! < 15 ? 'raised' : 'natural') : 'low');
    }
    expect(seen.has('low') && seen.has('raised')).toBe(true);
  });
});

describe('CR 615.1, 120.2a: "If a creature would deal combat damage to ~, prevent that damage and put a +1/+1 counter on ~." (Ironscale Hydra)', () => {
  const HYDRA = card('Test Hydra', 'Creature — Hydra', 'If a creature would deal combat damage to ~, prevent that damage and put a +1/+1 counter on ~.', { pt: ['3', '3'] });
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['4', '4'] });
  const defs = [HYDRA, OGRE];
  it('is understood', () => expect(noManual(HYDRA)).toBe(true));
  it('an attacker blocked by the Hydra deals no damage to it and the Hydra gets one counter; it still deals its own damage', () => {
    const s0 = scenario(['Plains', 'Island', 'Swamp'], { defs, p1: { battlefield: ['Test Ogre'] }, p2: { battlefield: ['Test Hydra'] } });
    let s = declareAttackers(toDeclareAttackers(s0), [[idOn(s0, 'Test Ogre')]]);
    s = declareBlockers(toDeclareBlockers(s), [[idOn(s0, 'Test Hydra'), idOn(s0, 'Test Ogre')]]);
    s = toStep(s, 'endCombat');
    const hydra = s.objects[idOn(s, 'Test Hydra')]!;
    expect(hydra.damage).toBe(0);
    expect(hydra.counters['+1/+1']).toBe(1);
    expect(namesOn(s, 'p1')).toEqual(['Test Ogre']); // 3 damage to a 4/4: it lives
  });
  it('damage dealt to a player, not to the Hydra, is not prevented (negative)', () => {
    const s0 = scenario(['Plains', 'Island', 'Swamp'], { defs, p1: { battlefield: ['Test Ogre'] }, p2: { battlefield: ['Test Hydra'] } });
    let s = declareAttackers(toDeclareAttackers(s0), [[idOn(s0, 'Test Ogre')]]);
    s = declareBlockers(toDeclareBlockers(s), []);
    s = toStep(s, 'endCombat');
    expect(life(s, 'p2')).toBe(16);
    expect(s.objects[idOn(s, 'Test Hydra')]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});

describe('CR 702.14c: "Target creature loses all landwalk abilities until end of turn." (Hammerheim)', () => {
  const HAMMER = card('Test Hammer', 'Legendary Land', '{T}: Target creature loses all landwalk abilities until end of turn.');
  const WALKER = card('Test Walker', 'Creature — Bird', 'Islandwalk', { pt: ['2', '2'] });
  const defs = [HAMMER, WALKER, BEAR];
  it('is understood', () => expect(noManual(HAMMER)).toBe(true));
  it('the targeted creature can then be blocked although the defender controls an Island; an untargeted one cannot', () => {
    const s0 = scenario(['Plains', 'Island', 'Swamp'], { defs, p1: { battlefield: ['Test Hammer', 'Test Walker'] }, p2: { battlefield: ['Island', 'Test Bear'] } });
    const s1 = resolveAll(drive(act(s0, { type: 'activate', player: 'p1', source: idOn(s0, 'Test Hammer'), ability: 'p:0:0' } as never), { targets: [[obj(idOn(s0, 'Test Walker'))]] }));
    const a = declareAttackers(toDeclareAttackers(s1), [[idOn(s1, 'Test Walker')]]);
    const blocked = declareBlockers(toDeclareBlockers(a), [[idOn(s1, 'Test Bear'), idOn(s1, 'Test Walker')]]);
    expect(blocked.pending?.kind).not.toBe('declareBlockers');
    // negative: without the ability the Island makes it unblockable
    const b = declareAttackers(toDeclareAttackers(scenario(['Plains', 'Island', 'Swamp'], { defs, p1: { battlefield: ['Test Hammer', 'Test Walker'] }, p2: { battlefield: ['Island', 'Test Bear'] } })), [[idOn(s0, 'Test Walker')]]);
    expect(() => declareBlockers(toDeclareBlockers(b), [[idOn(s0, 'Test Bear'), idOn(s0, 'Test Walker')]])).toThrow();
  });
});

describe('CR 113.6k, 603.10a: "When you cast this spell and when this creature dies, create a 0/1 Eldrazi Spawn token." (Eldrazi Repurposer)', () => {
  const DRONE = card('Test Drone', 'Creature — Eldrazi Drone', 'When you cast this spell and when this creature dies, create a 0/1 colorless Eldrazi Spawn creature token with "Sacrifice this token: Add {C}."', { pt: ['3', '3'], cost: '{0}' });
  const KILL = card('Test Smite', 'Instant', 'Destroy target creature.');
  const defs = [DRONE, KILL, BEAR];
  const spawns = (s: GameState): number => s.zones.battlefield.filter((id) => /Spawn/.test(s.defs[s.objects[id]!.defId]!.name)).length;
  it('is understood', () => expect(noManual(DRONE)).toBe(true));
  it('casting it makes one Spawn, and its death makes another', () => {
    const s0 = scenario(['Plains', 'Island', 'Swamp'], { defs, p1: { hand: ['Test Drone', 'Test Smite'] } });
    const s1 = cast(s0, 'Test Drone');
    expect(spawns(s1)).toBe(1);
    const s2 = cast(s1, 'Test Smite', { targets: [[obj(idOn(s1, 'Test Drone'))]] });
    expect(spawns(s2)).toBe(2);
  });
  it('a creature of another name that dies makes nothing (negative)', () => {
    const s0 = scenario(['Plains', 'Island', 'Swamp'], { defs, p1: { hand: ['Test Smite'], battlefield: ['Test Drone', 'Test Bear'] } });
    const s1 = cast(s0, 'Test Smite', { targets: [[obj(idOn(s0, 'Test Bear'))]] });
    expect(spawns(s1)).toBe(0);
  });
});

describe("CR 607.2a, 613.4c: \"Equipped creature has menace and gets +X/+0, where X is the exiled card's power.\" (Drach'Nyen: the total power when a copied trigger exiled several cards, ruling 2022-10-07)", () => {
  const SWORD = card('Test Sword', 'Artifact — Equipment', "When ~ enters, exile up to one target creature.\nEquipped creature has menace and gets +X/+0, where X is the exiled card's power.\nEquip {2}");
  const BIG = card('Test Big', 'Creature — Bear', '', { pt: ['5', '5'] });
  const MID = card('Test Mid', 'Creature — Bear', '', { pt: ['3', '3'] });
  const defs = [SWORD, BEAR, BIG, MID];
  const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
  const setup = (exiled: string[]): { s: GameState; bear: ObjectId } => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Sword', 'Test Bear'], exile: exiled } });
    const sword = idOn(s0, 'Test Sword'); const bear = idOn(s0, 'Test Bear');
    const ex = exiled.map((n) => s0.zones.exile.find((i) => s0.defs[s0.objects[i]!.defId]!.name === n)!);
    return { bear, s: tweak(s0, (t) => { const o = t.objects[sword] as any; o.attachedTo = bear; o.links = { exiled: { objects: ex.map((id) => ({ id, zone: 'exile' })) } }; }) };
  };
  it('is understood', () => expect(noManual(SWORD)).toBe(true));
  it('one exiled card: +its power; two exiled cards: the total of their powers', () => {
    const one = setup(['Test Big']);
    expect(pt(one.s, one.bear)).toBe('7/2');
    const two = setup(['Test Big', 'Test Mid']);
    expect(pt(two.s, two.bear)).toBe('10/2');
  });
  it('nothing exiled: no bonus (negative)', () => {
    const none = setup([]);
    expect(pt(none.s, none.bear)).toBe('2/2');
  });
});
