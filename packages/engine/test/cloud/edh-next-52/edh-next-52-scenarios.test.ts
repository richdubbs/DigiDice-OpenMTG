/**
 * Commander lane edh-next, round edh-next-52 (EDHREC ranks 16,251-17,500, third pass): the round's readings played through the engine with synthetic cards compiled by the
 * game's default compiler (invented names, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites are checked against the
 * 2026-09-25 Comprehensive Rules text where noted, otherwise from memory (unverified).
 *
 *   CR 607.2a, 400.7, 110.2a            "When this leaves the battlefield, sacrifice all Dragons you control. Then return the exiled cards to the battlefield under your control." (Day of the Dragons)
 *   CR 607.2a, 601.3, 611.2a            "Until end of turn, you may cast a creature spell from among cards exiled with this artifact." (Serpent's Soul-Jar)
 *   CR 607.2a, 610.3, 613.4c            "Exile any number of other nontoken creatures you control until it leaves the battlefield. This creature gets +2/+2 for each card exiled with it." (Lumbering Battlement)
 *   CR 101.4, 608.2d, 122.6             "Each opponent may put a +1/+1 counter on each creature they control. For each opponent who does, put a +1/+1 counter on each creature you control." (Tempt with Glory)
 *   CR 120.3, 201.2, 608.2c             "~ deals 1 damage to target creature and each other creature with the same name as that creature." (Izzet Staticaster)
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { getChars } from '../../../src/index';
import { advanceTo, find, findAll, scenario } from '../../m3/scenario';
import { card, cast, full, obj, resolveAll, drive, act } from '../r4-cost/support';
import { legalActions } from '../../../src/index';

const onBf = (s: GameState, name: string, p?: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name && (p === undefined || s.objects[id]!.controller === p));
const inExile = (s: GameState, name: string): ObjectId[] => s.zones.exile.filter((id) => s.objects[id]!.defId === name);
const inYard = (s: GameState, name: string, p = 'p1'): ObjectId[] => (s.zones.graveyard[p] ?? []).filter((id) => s.objects[id]!.defId === name);
const exileCasts = (s: GameState): ObjectId[] => legalActions(s, 'p1').filter((a) => a.kind === 'cast').map((a) => (a.action as { card: ObjectId }).card).filter((id) => s.objects[id]!.zone === 'exile');
const pt = (s: GameState, id: ObjectId): [number, number] => { const c = getChars(s, id)!; return [Number(c.power), Number(c.toughness)]; };

const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
const OX = card('Test Ox', 'Creature — Ox', '', '{0}', ['2', '3']);
const SMASH = card('Test Smash', 'Instant', 'Destroy target creature.');
const BREAK = card('Test Break', 'Instant', 'Destroy target enchantment.');
const castOn = (s: GameState, name: string, target: ObjectId, player: 'p1' | 'p2' = 'p1'): GameState => resolveAll(cast(s, name, { targets: [[obj(target)]] }, player));

// ---- Day of the Dragons ---------------------------------------------------------------------------------------------------------------------------------------------
const HORDE = card('Test Horde', 'Enchantment', 'When this enchantment enters, exile all creatures you control. Then create that many 5/5 red Dragon creature tokens with flying.\nWhen this enchantment leaves the battlefield, sacrifice all Dragons you control. Then return the exiled cards to the battlefield under your control.');
describe('CR 607.2a, 400.7, 110.2a: "Then return the exiled cards to the battlefield under your control."', () => {
  const DEFS = [HORDE, BEAR, OX, BREAK];
  it('is automated', () => expect(full(HORDE)).toBe(true));
  it('exiles your creatures (an opponent\'s stay), makes one Dragon each, and when it leaves returns exactly those cards under your control and sacrifices the Dragons', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Bear', 'Test Ox'], hand: ['Test Horde', 'Test Break'] }, p2: { battlefield: ['Test Ox'] } });
    s = resolveAll(cast(s, 'Test Horde'));
    expect(inExile(s, 'Test Bear').length).toBe(1);
    expect(inExile(s, 'Test Ox').length).toBe(1);
    expect(onBf(s, 'Test Ox', 'p2').length).toBe(1);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1').length).toBe(2);
    s = castOn(s, 'Test Break', find(s, 'Test Horde', 'battlefield'));
    expect(onBf(s, 'Test Bear', 'p1').length).toBe(1);
    expect(onBf(s, 'Test Ox', 'p1').length).toBe(1);
    expect(onBf(s, 'Test Ox', 'p2').length).toBe(1);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').length).toBe(0);
    expect(inExile(s, 'Test Bear').length + inExile(s, 'Test Ox').length).toBe(0);
  });
  it('negative: a card that left exile before the enchantment leaves is not returned, and a creature exiled by something else never is', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Bear', 'Test Ox'], hand: ['Test Horde', 'Test Break'] }, p2: { battlefield: ['Test Ox'] } });
    s = resolveAll(cast(s, 'Test Horde'));
    const bear = inExile(s, 'Test Bear')[0]!;
    const t = JSON.parse(JSON.stringify(s)) as GameState;
    t.zones.exile = t.zones.exile.filter((x) => x !== bear);
    t.zones.graveyard.p1!.push(bear);
    t.objects[bear]!.zone = 'graveyard';
    s = castOn(t, 'Test Break', find(t, 'Test Horde', 'battlefield'));
    expect(onBf(s, 'Test Bear').length).toBe(0);
    expect(inYard(s, 'Test Bear').length).toBe(1);
    expect(onBf(s, 'Test Ox', 'p1').length).toBe(1);
  });
});

// ---- Serpent's Soul-Jar ---------------------------------------------------------------------------------------------------------------------------------------------
const JAR = card('Test Jar', 'Artifact', 'Whenever an Elf you control dies, exile it.\n{T}, Pay 2 life: Until end of turn, you may cast a creature spell from among cards exiled with this artifact.');
const ELF = card('Test Elf', 'Creature — Elf', '', '{0}', ['1', '1']);
const ELF2 = card('Test Elder', 'Creature — Elf', '', '{0}', ['2', '2']);
describe('CR 607.2a, 601.3, 611.2a: "Until end of turn, you may cast a creature spell from among cards exiled with this artifact."', () => {
  const DEFS = [JAR, ELF, ELF2, SMASH, BEAR];
  const activateJar = (s: GameState): GameState => {
    const la = legalActions(s, 'p1').find((a) => a.kind === 'activate' && !a.isMana && a.object === find(s, 'Test Jar', 'battlefield'));
    if (!la) throw new Error('no activation of the jar');
    return drive(act(s, la.action));
  };
  it('is automated', () => expect(full(JAR)).toBe(true));
  const setup = (): GameState => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Jar', 'Test Elf', 'Test Elder'], hand: ['Test Smash', 'Test Smash'] } });
    s = castOn(s, 'Test Smash', find(s, 'Test Elf', 'battlefield'));
    s = castOn(s, 'Test Smash', find(s, 'Test Elder', 'battlefield'));
    return s;
  };
  it('an Elf that died is exiled with it; until end of turn you may cast ONE of those cards (life paid), not two', () => {
    let s = setup();
    expect(inExile(s, 'Test Elf').length + inExile(s, 'Test Elder').length).toBe(2);
    expect(exileCasts(s).length).toBe(0);
    const life = s.players.find((p) => p.id === 'p1')!.life;
    s = resolveAll(activateJar(s));
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(life - 2);
    const castable = exileCasts(s);
    expect(castable.length).toBe(2);
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Elder', 'exile') })));
    expect(onBf(s, 'Test Elder').length).toBe(1);
    expect(exileCasts(s).length).toBe(0);
  });
  it('negative: a creature exiled after the ability resolved is not castable, and the permission ends with the turn', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Jar', 'Test Elf', 'Test Elder'], hand: ['Test Smash', 'Test Smash'] } });
    s = castOn(s, 'Test Smash', find(s, 'Test Elf', 'battlefield'));
    s = resolveAll(activateJar(s));
    s = castOn(s, 'Test Smash', find(s, 'Test Elder', 'battlefield'));
    expect(inExile(s, 'Test Elder').length).toBe(1);
    const castable = exileCasts(s).map((id) => s.objects[id]!.defId);
    expect(castable).toEqual(['Test Elf']);
    s = advanceTo(s, 3, 'main1');
    expect(exileCasts(s).length).toBe(0);
  });
});

// ---- Lumbering Battlement -------------------------------------------------------------------------------------------------------------------------------------------
const WALL = card('Test Wall', 'Creature — Wall', 'Vigilance\nWhen this creature enters, exile any number of other nontoken creatures you control until it leaves the battlefield.\nThis creature gets +2/+2 for each card exiled with it.', '{0}', ['4', '4']);
describe('CR 607.2a, 610.3, 613.4c: "exile any number of other nontoken creatures you control until it leaves the battlefield. This creature gets +2/+2 for each card exiled with it."', () => {
  const DEFS = [WALL, BEAR, OX, SMASH];
  it('is automated', () => expect(full(WALL)).toBe(true));
  it('the chosen creatures are exiled, it gets +2/+2 for each, and when it leaves they all return', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Bear', 'Test Ox'], hand: ['Test Wall', 'Test Smash'] }, p2: { battlefield: ['Test Ox'] } });
    s = resolveAll(cast(s, 'Test Wall'), { objects: [findAll(s, 'Test Bear', 'battlefield', 'p1').concat(findAll(s, 'Test Ox', 'battlefield', 'p1'))] });
    const wall = find(s, 'Test Wall', 'battlefield');
    expect(inExile(s, 'Test Bear').length + inExile(s, 'Test Ox').length).toBe(2);
    expect(onBf(s, 'Test Ox', 'p2').length).toBe(1);
    expect(pt(s, wall)).toEqual([8, 8]);
    s = castOn(s, 'Test Smash', wall);
    expect(onBf(s, 'Test Bear', 'p1').length).toBe(1);
    expect(onBf(s, 'Test Ox', 'p1').length).toBe(1);
    expect(inExile(s, 'Test Bear').length + inExile(s, 'Test Ox').length).toBe(0);
  });
  it('negative: choosing none exiles none and gives no bonus; an opponent\'s creature is never offered', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Bear'], hand: ['Test Wall'] }, p2: { battlefield: ['Test Ox'] } });
    s = resolveAll(cast(s, 'Test Wall'), { objects: [[]] });
    expect(pt(s, find(s, 'Test Wall', 'battlefield'))).toEqual([4, 4]);
    expect(onBf(s, 'Test Bear', 'p1').length).toBe(1);
    expect(onBf(s, 'Test Ox', 'p2').length).toBe(1);
  });
});

// ---- Tempt with Glory ----------------------------------------------------------------------------------------------------------------------------------------------
const TEMPT = card('Test Tempt', 'Sorcery', 'Put a +1/+1 counter on each creature you control. Each opponent may put a +1/+1 counter on each creature they control. For each opponent who does, put a +1/+1 counter on each creature you control.');
describe('CR 101.4, 608.2d, 122.6: "Each opponent may put a +1/+1 counter on each creature they control. For each opponent who does, put a +1/+1 counter on each creature you control."', () => {
  const DEFS = [TEMPT, BEAR, OX];
  it('is automated', () => expect(full(TEMPT)).toBe(true));
  it('an opponent who accepts puts a counter on each of THEIR creatures, and you put one more on each of yours', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Bear'], hand: ['Test Tempt'] }, p2: { battlefield: ['Test Ox', 'Test Ox'] } });
    s = resolveAll(cast(s, 'Test Tempt'), { yes: [true] });
    expect(pt(s, onBf(s, 'Test Bear')[0]!)).toEqual([4, 4]);
    for (const id of onBf(s, 'Test Ox', 'p2')) expect(pt(s, id)).toEqual([3, 4]);
  });
  it('negative: an opponent who declines gets nothing and you get only the first counter', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Bear'], hand: ['Test Tempt'] }, p2: { battlefield: ['Test Ox'] } });
    s = resolveAll(cast(s, 'Test Tempt'), { yes: [false] });
    expect(pt(s, onBf(s, 'Test Bear')[0]!)).toEqual([3, 3]);
    expect(pt(s, onBf(s, 'Test Ox')[0]!)).toEqual([2, 3]);
  });
});

// ---- Izzet Staticaster ----------------------------------------------------------------------------------------------------------------------------------------------
const SPARK = card('Test Spark', 'Sorcery', 'Test Spark deals 1 damage to target creature and each other creature with the same name as that creature.');
describe('CR 120.3, 201.2, 608.2c: "~ deals 1 damage to target creature and each other creature with the same name as that creature."', () => {
  const DEFS = [SPARK, card('Test Imp', 'Creature — Imp', '', '{0}', ['1', '1']), card('Test Fiend', 'Creature — Imp', '', '{0}', ['1', '1']), OX];
  it('is automated', () => expect(full(SPARK)).toBe(true));
  it('every creature on the battlefield with the target\'s name takes the damage (any controller); a differently named creature does not', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Imp', 'Test Fiend'], hand: ['Test Spark'] }, p2: { battlefield: ['Test Imp', 'Test Ox'] } });
    s = resolveAll(cast(s, 'Test Spark', { targets: [[obj(find(s, 'Test Imp', 'battlefield', 'p1'))]] }));
    expect(onBf(s, 'Test Imp').length).toBe(0);
    expect(inYard(s, 'Test Imp', 'p1').length).toBe(1);
    expect(inYard(s, 'Test Imp', 'p2').length).toBe(1);
    expect(onBf(s, 'Test Fiend', 'p1').length).toBe(1);
    expect(s.objects[onBf(s, 'Test Ox', 'p2')[0]!]!.damage).toBe(0);
  });
});

// ---- Izzet Staticaster, a source with the target's name (G10 change of Homing Lightning's unit: `not the target`, never `other than the source`) ---------------------------------
const ZAP = card('Test Zap', 'Creature — Wizard', '{T}: Test Zap deals 1 damage to target creature and each other creature with the same name as that creature.', '{0}', ['3', '3']);
describe('CR 120.3, 201.2, 608.2c: the source itself is hit when it has the target\'s name', () => {
  const DEFS = [ZAP, OX];
  it('is automated', () => expect(full(ZAP)).toBe(true));
  it('a Zap that targets another Zap damages both, itself included ("each other" means other than the target, not other than the source)', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: [{ name: 'Test Zap', since: -1 } as never] }, p2: { battlefield: ['Test Zap', 'Test Ox'] } });
    const mine = find(s, 'Test Zap', 'battlefield', 'p1');
    const theirs = find(s, 'Test Zap', 'battlefield', 'p2');
    const la = legalActions(s, 'p1').find((a) => a.kind === 'activate' && !a.isMana && a.object === mine);
    if (!la) throw new Error('no activation');
    s = resolveAll(drive(act(s, la.action), { targets: [[obj(theirs)]] }));
    expect(s.objects[theirs]!.damage).toBe(1);
    expect(s.objects[mine]!.damage).toBe(1);
    expect(s.objects[find(s, 'Test Ox', 'battlefield', 'p2')]!.damage).toBe(0);
  });
});
