/**
 * Standard round 4, slice r4-copy (copies and control, held-out and leftover units), played through the engine with synthetic cards compiled by the game's
 * default compiler (wordings are invented, design 6.10). One block per template of parser/templates/zz-cloud/r4-copy.json.
 *
 *   CR 707.5, 614.1c, 614.12  "you may have this creature enter as a copy of ...": a choice made as it would enter, not a target
 *   CR 707.9a                 a copy effect's exceptions are copiable values ("except it has changeling", "except it has flying and this ability")
 *   CR 707.2, 707.4           "becomes a copy": a copy effect of layer 1a (CR 613.1a) with the copiable values of the object as the effect begins
 *   CR 608.2d                 a choice that is not a target is made as the effect begins ("another creature you control")
 *   CR 109.2, 611.2c          "each other creature you control ... that creature": other than that creature (not the source); the group is locked in
 *   CR 707.12, 608.2g         a copy of a card is created in the card's zone and may be cast while the effect resolves; one not cast ceases to exist
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, pass, scenario } from '../../m3/scenario';
import { mpScenario, resolveStack } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; loyalty?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}), ...(opts.loyalty ? { loyalty: opts.loyalty } : {}),
  } as OracleCard);
}
/** No ability of the card is manual, at any depth (the level may be capped at partial by an experimental template, design 10.4). */
const noManual = (d: CardDef): boolean => d.automation.level !== 'manual' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });
const nameOf = (s: GameState, id: ObjectId): string => getChars(s, id).name;
const pt = (s: GameState, id: ObjectId): [number, number] => [Number(getChars(s, id).power), Number(getChars(s, id).toughness)];
const onBf = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => getChars(s, id).name === name);
const isToken = (s: GameState, id: ObjectId): boolean => s.objects[id]!.kind === 'token';

/** Answer the decisions in order (mana is paid automatically, targets from `targets`); stops at priority or at a decision with no answer left. */
function drive(s0: GameState, answers: DecisionAnswer[] = [], targets: TargetChoice[][] = []): GameState {
  let s = s0;
  const queue = [...answers];
  const tq = [...targets];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'order' && queue[0]?.kind !== 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((i) => i.id) });
    else if (s.pending.kind === 'chooseTargets' && tq.length > 0) s = answer(s, { kind: 'chooseTargets', targets: tq.shift()! });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
/** Both players pass until the stack is empty, answering decisions on the way. */
function resolveAll(s0: GameState, answers: DecisionAnswer[] = [], targets: TargetChoice[][] = []): GameState {
  let s = s0;
  const queue = [...answers];
  const tq = [...targets];
  for (let guard = 0; (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')) && guard < 60; guard++) {
    if (s.pending?.kind === 'priority') s = pass(s);
    else {
      const before = s;
      s = drive(s, queue.splice(0, 1), tq.length > 0 && s.pending?.kind === 'chooseTargets' ? [tq.shift()!] : []);
      if (s === before) break;
    }
  }
  return s;
}
function castAt(s0: GameState, name: string, targets: TargetChoice[][] = [], answers: DecisionAnswer[] = [], who = 'p1'): GameState {
  const s = drive(act(s0, { type: 'cast', player: who, card: find(s0, name, 'hand', who) }), [], targets);
  return resolveAll(s, answers);
}
function activate(s0: GameState, source: ObjectId, targets: TargetChoice[][] = [], answers: DecisionAnswer[] = [], nth = 0): GameState {
  const las = legalActions(s0, s0.pending!.player).filter((a) => a.kind === 'activate' && !a.isMana && a.object === source);
  const la = las[nth];
  if (!la) throw new Error(`no activation of ${nameOf(s0, source)}`);
  return resolveAll(drive(act(s0, la.action), [], targets), answers);
}
const byHandLog = (s: GameState): boolean => s.log.some((l) => /by hand/.test(l.text));

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const GIANT = card('Test Giant', 'Creature — Giant', 'Trample', { pt: ['4', '6'] });
const HERO = card('Test Hero', 'Legendary Creature — Human Knight', 'Vigilance', { pt: ['3', '3'] });
const TRINKET = card('Test Trinket', 'Artifact', '');
const SHOCK = card('Test Shock', 'Instant', 'Test Shock deals 2 damage to any target.');
const COMMON = [BEAR, GIANT, HERO, TRINKET, SHOCK];

const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const choose = (...ids: ObjectId[]): DecisionAnswer => ({ kind: 'chooseObjects', ids });
const yes: DecisionAnswer = { kind: 'yesNo', yes: true };
const no: DecisionAnswer = { kind: 'yesNo', yes: false };

describe('CR 707.5, 614.12: "You may have this creature enter as a copy of an artifact or creature you control." (rep.r4copy.enters.copy.a)', () => {
  const SHAPE = card('Test Shape', 'Creature — Shapeshifter', 'Flash\nYou may have this creature enter as a copy of an artifact or creature you control.', { pt: ['0', '0'] });
  const defs = [...COMMON, SHAPE];
  it('has no manual part', () => expect(noManual(SHAPE)).toBe(true));
  it('only your artifacts and creatures are offered; it enters as a copy of your Giant', () => {
    const s0 = scenario([], { p1: { hand: ['Test Shape'], battlefield: ['Test Giant', 'Test Trinket', 'Plains'] }, p2: { battlefield: ['Test Bear'] }, defs });
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Shape', 'hand') }));
    for (let i = 0; i < 10 && s.pending?.kind === 'priority'; i++) s = pass(s);
    expect(s.pending?.kind).toBe('chooseObjects');
    const offered = (s.pending as unknown as { options: ObjectId[] }).options.map((id) => nameOf(s, id)).sort();
    expect(offered).toEqual(['Test Giant', 'Test Trinket']);
    s = resolveAll(s, [choose(find(s0, 'Test Giant', 'battlefield', 'p1'))]);
    expect(onBf(s, 'Test Giant').length).toBe(2);
    expect(onBf(s, 'Test Shape').length).toBe(0);
    expect(byHandLog(s)).toBe(false);
  });
  it('declining: it enters as itself (a 0/0, put into the graveyard)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Shape'], battlefield: ['Test Giant'] }, defs });
    const s = castAt(s0, 'Test Shape', [], [choose()]);
    expect(onBf(s, 'Test Giant').length).toBe(1);
    expect(onBf(s, 'Test Shape').length).toBe(0);
  });
});

describe('CR 707.5, 707.9a: "You may have this creature enter as a copy of any creature on the battlefield, except it has changeling." (rep.r4copy.enters.copy.any.exceptHas)', () => {
  const MIMIC = card('Test Mimic', 'Creature — Shapeshifter', 'You may have this creature enter as a copy of any creature on the battlefield, except it has changeling.', { pt: ['0', '0'] });
  const defs = [...COMMON, MIMIC];
  it('has no manual part', () => expect(noManual(MIMIC)).toBe(true));
  it("it copies the opponent's Bear and has changeling beside the copied values", () => {
    const s0 = scenario([], { p1: { hand: ['Test Mimic'] }, p2: { battlefield: ['Test Bear'] }, defs });
    const s = castAt(s0, 'Test Mimic', [], [choose(find(s0, 'Test Bear', 'battlefield', 'p2'))]);
    const mine = onBf(s, 'Test Bear').find((id) => s.objects[id]!.controller === 'p1')!;
    expect(mine).toBeDefined();
    expect(pt(s, mine)).toEqual([2, 2]);
    expect(hasKeyword(getChars(s, mine), 'changeling')).toBe(true);
    expect(byHandLog(s)).toBe(false);
  });
});

describe('CR 707.4, 611.2a: "~ becomes a copy of another target creature you control." with no duration lasts indefinitely (eff.r4copy.becomeCopy)', () => {
  const CREEP = card('Test Creep', 'Creature — Horror', '{1}: This creature becomes a copy of another target creature you control.', { pt: ['1', '1'] });
  const defs = [...COMMON, CREEP];
  it('has no manual part', () => expect(noManual(CREEP)).toBe(true));
  it('it is a Test Giant from then on, also after the turn ends', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Creep', 'Test Giant', 'Plains'] }, defs });
    const creep = find(s0, 'Test Creep', 'battlefield', 'p1');
    let s = activate(s0, creep, [[obj(find(s0, 'Test Giant', 'battlefield', 'p1'))]]);
    expect(nameOf(s, creep)).toBe('Test Giant');
    expect(pt(s, creep)).toEqual([4, 6]);
    expect(byHandLog(s)).toBe(false);
    s = advanceTo(s, 2, 'upkeep');
    expect(nameOf(s, creep)).toBe('Test Giant');
  });
});

describe('CR 109.2, 611.2c, 707.4: "Each other creature you control becomes a copy of that creature until end of turn." (eff.r4copy.eachOther.becomeCopy.dur)', () => {
  const FLESH = card('Test Flesh', 'Creature — Snake', '{1}: Put a +1/+1 counter on target creature you control. Each other creature you control becomes a copy of that creature until end of turn.', { pt: ['1', '1'] });
  const defs = [...COMMON, FLESH];
  it('has no manual part', () => expect(noManual(FLESH)).toBe(true));
  it('"other" is other than the target: the source and the Bear become Giants; the Giant keeps its counter; the opponent\'s creature is untouched', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Flesh', 'Test Bear', 'Test Giant', 'Plains'] }, p2: { battlefield: ['Test Hero'] }, defs });
    const flesh = find(s0, 'Test Flesh', 'battlefield', 'p1');
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const giant = find(s0, 'Test Giant', 'battlefield', 'p1');
    let s = activate(s0, flesh, [[obj(giant)]]);
    expect(nameOf(s, flesh)).toBe('Test Giant');
    expect(nameOf(s, bear)).toBe('Test Giant');
    expect(pt(s, bear)).toEqual([4, 6]);
    expect(pt(s, giant)).toEqual([5, 7]);
    expect(nameOf(s, find(s0, 'Test Hero', 'battlefield', 'p2'))).toBe('Test Hero');
    expect(byHandLog(s)).toBe(false);
    s = advanceTo(s, 2, 'upkeep');
    expect(nameOf(s, bear)).toBe('Test Bear');
    expect(nameOf(s, flesh)).toBe('Test Flesh');
  });
});

describe('CR 608.2d, 707.4: "you may have it become a copy of another creature you control until end of turn" (eff.r4copy.may.becomeCopy.chosen.dur)', () => {
  const ECHO = card('Test Echo', 'Creature — Merfolk', '{1}: Put a +1/+1 counter on this creature. Then you may have it become a copy of another creature you control until end of turn.', { pt: ['1', '1'] });
  const defs = [...COMMON, ECHO];
  it('has no manual part', () => expect(noManual(ECHO)).toBe(true));
  it('it is not a target: you choose among your other creatures (not the opponent\'s) as the effect begins; it keeps its counter', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Echo', 'Test Bear', 'Test Giant', 'Plains'] }, p2: { battlefield: ['Test Hero'] }, defs });
    const echo = find(s0, 'Test Echo', 'battlefield', 'p1');
    let s = drive(act(s0, legalActions(s0, 'p1').find((a) => a.kind === 'activate' && !a.isMana && a.object === echo)!.action));
    for (let i = 0; i < 10 && s.pending?.kind === 'priority'; i++) s = pass(s);
    s = drive(s, [yes]);
    expect(s.pending?.kind).toBe('chooseObjects');
    const offered = (s.pending as unknown as { options: ObjectId[] }).options.map((id) => nameOf(s, id)).sort();
    expect(offered).toEqual(['Test Bear', 'Test Giant']);
    s = resolveAll(s, [choose(find(s0, 'Test Giant', 'battlefield', 'p1'))]);
    expect(nameOf(s, echo)).toBe('Test Giant');
    expect(pt(s, echo)).toEqual([5, 7]);
    expect(byHandLog(s)).toBe(false);
    s = advanceTo(s, 2, 'upkeep');
    expect(nameOf(s, echo)).toBe('Test Echo');
  });
  it('declining: it stays itself', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Echo', 'Test Giant', 'Plains'] }, defs });
    const echo = find(s0, 'Test Echo', 'battlefield', 'p1');
    const s = activate(s0, echo, [], [no]);
    expect(nameOf(s, echo)).toBe('Test Echo');
    expect(pt(s, echo)).toEqual([2, 2]);
  });
});

describe('CR 707.9a, 707.4: "~ becomes a copy of target creature card in your graveyard with mana value X, except it has flying and this ability." (eff.r4copy.becomeCopy.exceptHas.thisAbility)', () => {
  const LOOTER = card('Test Looter', 'Creature — Faerie', 'Flying\n{X}: This creature becomes a copy of target creature card in your graveyard with mana value X, except it has flying and this ability. Activate only as a sorcery.', { pt: ['1', '1'] });
  const defs = [...COMMON, LOOTER];
  it('has no manual part', () => expect(noManual(LOOTER)).toBe(true));
  it('it is a Test Giant with flying and still has the ability; the card stays in the graveyard', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Looter'], graveyard: ['Test Giant', 'Test Bear'] }, defs });
    const looter = find(s0, 'Test Looter', 'battlefield', 'p1');
    const s = activate(s0, looter, [[obj(find(s0, 'Test Giant', 'graveyard', 'p1'))]], [{ kind: 'chooseX', value: 0 } as unknown as DecisionAnswer]);
    expect(nameOf(s, looter)).toBe('Test Giant');
    expect(pt(s, looter)).toEqual([4, 6]);
    expect(hasKeyword(getChars(s, looter), 'flying')).toBe(true);
    expect(hasKeyword(getChars(s, looter), 'trample')).toBe(true);
    expect(legalActions(s, 'p1').some((a) => a.kind === 'activate' && !a.isMana && a.object === looter)).toBe(true);
    expect(find(s, 'Test Giant', 'graveyard', 'p1')).toBeDefined();
    expect(byHandLog(s)).toBe(false);
  });
});

describe('CR 707.12, 608.2g: "Exile up to one target instant card from your graveyard and copy it. You may cast the copy. If you do, you lose 2 life." (rid.r4copy.mayCastCopy)', () => {
  const PUNISH = card('Test Punisher', 'Creature — Warlock', '{1}: Exile up to one target instant card from your graveyard and copy it. You may cast the copy. If you do, you lose 2 life.', { pt: ['2', '2'] });
  const defs = [...COMMON, PUNISH];
  it('has no manual part', () => expect(noManual(PUNISH)).toBe(true));
  it('the copy of the exiled Shock is cast (its mana cost paid) and deals 2 damage; you lose 2 life; the card stays in exile', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Punisher', 'Plains'], graveyard: ['Test Shock'] }, defs });
    const punisher = find(s0, 'Test Punisher', 'battlefield', 'p1');
    const la = legalActions(s0, 'p1').find((a) => a.kind === 'activate' && !a.isMana && a.object === punisher)!;
    const s = resolveAll(drive(act(s0, la.action), [], [[obj(find(s0, 'Test Shock', 'graveyard', 'p1'))]]), [yes], [[player('p2')]]);
    expect(life(s, 'p2')).toBe(18);
    expect(life(s, 'p1')).toBe(18);
    expect(s.zones.exile.map((id) => nameOf(s, id))).toEqual(['Test Shock']);
    expect(s.zones.exile.every((id) => s.objects[id]!.kind === 'card')).toBe(true);
    expect(byHandLog(s)).toBe(false);
  });
  it('declining: nothing is cast, no life is lost, and the copy does not remain', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Punisher', 'Plains'], graveyard: ['Test Shock'] }, defs });
    const s = activate(s0, find(s0, 'Test Punisher', 'battlefield', 'p1'), [[obj(find(s0, 'Test Shock', 'graveyard', 'p1'))]], [no]);
    expect(life(s, 'p1')).toBe(20);
    expect(life(s, 'p2')).toBe(20);
    expect(s.zones.exile.length).toBe(1);
  });
});

describe('CR 707.12, 118.9: "Copy it. You may cast the copy without paying its mana cost." and "Copy it, then you may cast the copy ..." (rid.r4copy.mayCastCopy.free, eff.r4copy.copy.thenMayCastCopy.free)', () => {
  const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to any target.', { cost: '{5}{R}' });
  const REENACT = card('Test Reenact', 'Sorcery', 'Exile target instant card from a graveyard. Copy it. You may cast the copy without paying its mana cost.');
  const SAGE = card('Test Sage', 'Creature — Spirit', 'When this creature enters, exile target instant card from your graveyard. Copy it, then you may cast the copy without paying its mana cost.', { pt: ['2', '2'] });
  const defs = [...COMMON, BOLT, REENACT, SAGE];
  it('have no manual part', () => {
    expect(noManual(REENACT)).toBe(true);
    expect(noManual(SAGE)).toBe(true);
  });
  it("the copy of the opponent's six-mana card is cast for free, under your control", () => {
    const s0 = scenario([], { p1: { hand: ['Test Reenact'] }, p2: { graveyard: ['Test Bolt'] }, defs });
    const s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Reenact', 'hand') }), [], [[obj(find(s0, 'Test Bolt', 'graveyard', 'p2'))]]), [yes], [[player('p2')]]);
    expect(s.zones.battlefield.length).toBe(s0.zones.battlefield.length);
    expect(life(s, 'p2')).toBe(17);
    expect(s.zones.exile.map((id) => nameOf(s, id))).toEqual(['Test Bolt']);
    expect(byHandLog(s)).toBe(false);
  });
  it('the enters trigger: the copy is cast for free', () => {
    const s0 = scenario([], { p1: { hand: ['Test Sage'], graveyard: ['Test Bolt'] }, defs });
    let s = castAt(s0, 'Test Sage');
    s = resolveAll(s, [], [[obj(find(s0, 'Test Bolt', 'graveyard', 'p1'))]]);
    expect(s.pending?.kind).toBe('yesNo');
    s = resolveAll(s, [yes], [[player('p2')]]);
    expect(life(s, 'p2')).toBe(17);
    expect(byHandLog(s)).toBe(false);
  });
});

describe('CR 707.9b, 205.4a, 613.4b: "except it\'s not legendary and it\'s a 4/4 Hero in addition to its other types" (eff.r4copy.copyToken.notLegendary.basePT.subtype)', () => {
  const STAGE = card('Test Stage', 'Sorcery', "Create a token that's a copy of target creature you control, except it's not legendary and it's a 4/4 Rogue in addition to its other types.");
  const defs = [...COMMON, STAGE];
  it('has no manual part', () => expect(noManual(STAGE)).toBe(true));
  it('the token is a nonlegendary 4/4 Human Knight Rogue with vigilance; the legend rule does not apply', () => {
    const s0 = scenario([], { p1: { hand: ['Test Stage'], battlefield: ['Test Hero'] }, defs });
    const s = castAt(s0, 'Test Stage', [[obj(find(s0, 'Test Hero', 'battlefield', 'p1'))]]);
    const heroes = onBf(s, 'Test Hero');
    expect(heroes.length).toBe(2);
    const token = heroes.find((id) => isToken(s, id))!;
    const c = getChars(s, token);
    expect(c.supertypes).not.toContain('Legendary');
    expect([...c.subtypes].sort()).toEqual(['Human', 'Knight', 'Rogue']);
    expect(pt(s, token)).toEqual([4, 4]);
    expect(hasKeyword(c, 'vigilance')).toBe(true);
  });
});

describe('CR 707.9b, 105.3, 205.1b: "except it\'s a 1/1 red Balloon creature in addition to its other colors and types and it has flying and haste" (eff.r4copy.copyToken.basePT.colorType.has)', () => {
  const PUMP = card('Test Pump', 'Creature — Clown', "{1}, {T}: Create a token that's a copy of another target creature you control, except it's a 1/1 red Balloon creature in addition to its other colors and types and it has flying and haste. Sacrifice it at the beginning of the next end step.", { pt: ['1', '1'] });
  const GREEN = compileCard({ name: 'Test Wurm', layout: 'normal', mana_cost: '{G}', type_line: 'Creature — Wurm', oracle_text: 'Trample', colors: ['G'], power: '6', toughness: '6' } as OracleCard);
  const defs = [...COMMON, PUMP, GREEN];
  it('has no manual part', () => expect(noManual(PUMP)).toBe(true));
  it('the token is a 1/1 red-and-green Wurm Balloon with trample, flying and haste; it is sacrificed at the next end step', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Pump', 'Test Wurm', 'Plains'] }, defs });
    let s = activate(s0, find(s0, 'Test Pump', 'battlefield', 'p1'), [[obj(find(s0, 'Test Wurm', 'battlefield', 'p1'))]]);
    const token = onBf(s, 'Test Wurm').find((id) => isToken(s, id))!;
    const c = getChars(s, token);
    expect(pt(s, token)).toEqual([1, 1]);
    expect([...c.colors].sort()).toEqual(['G', 'R']);
    expect([...c.subtypes].sort()).toEqual(['Balloon', 'Wurm']);
    for (const k of ['trample', 'flying', 'haste']) expect(hasKeyword(c, k), k).toBe(true);
    expect(byHandLog(s)).toBe(false);
    s = resolveAll(advanceTo(s, 1, 'end'));
    expect(onBf(s, 'Test Wurm').length).toBe(1);
  });
});

describe('CR 608.2f, 707.9a: "For each creature target player controls, create a token that\'s a copy of that creature, except it has haste and ..." (eff.r4copy.forEach.copyToken.exceptHas)', () => {
  const MIRROR = card('Test Mirror', 'Sorcery', 'For each creature target player controls, create a token that\'s a copy of that creature, except it has haste and "At the beginning of the end step, sacrifice this creature."');
  const defs = [...COMMON, MIRROR];
  it('has no manual part', () => expect(noManual(MIRROR)).toBe(true));
  it("you get a hasty copy of each of the target player's creatures (not yours); each is sacrificed at the end step", () => {
    const s0 = scenario([], { p1: { hand: ['Test Mirror'], battlefield: ['Test Hero'] }, p2: { battlefield: ['Test Bear', 'Test Giant'] }, defs });
    let s = castAt(s0, 'Test Mirror', [[player('p2')]]);
    for (const n of ['Test Bear', 'Test Giant']) {
      const mine = onBf(s, n).filter((id) => s.objects[id]!.controller === 'p1');
      expect(mine.length, n).toBe(1);
      expect(hasKeyword(getChars(s, mine[0]!), 'haste')).toBe(true);
    }
    expect(onBf(s, 'Test Hero').length).toBe(1);
    expect(byHandLog(s)).toBe(false);
    s = resolveAll(advanceTo(s, 1, 'end'));
    expect(onBf(s, 'Test Bear').length).toBe(1);
    expect(onBf(s, 'Test Giant').length).toBe(1);
  });
});

describe('CR 108.3, 109.4: "gain control of target permanent you own but don\'t control" (grammar: parser/holes/filter.ts#controlForms)', () => {
  const FALCON = card('Test Falcon', 'Creature — Bird', '{1}: Gain control of target permanent you own but don\'t control.', { pt: ['1', '1'] });
  const defs = [...COMMON, FALCON];
  it('has no manual part', () => expect(noManual(FALCON)).toBe(true));
  it('only a permanent you own that another player controls can be targeted; you get it back', () => {
    let s0 = scenario([], { p1: { battlefield: ['Test Falcon', 'Test Bear', 'Plains'] }, p2: { battlefield: ['Test Giant', 'Test Trinket'] }, defs });
    const trinket = find(s0, 'Test Trinket', 'battlefield', 'p2');
    s0 = { ...s0, objects: { ...s0.objects, [trinket]: { ...s0.objects[trinket]!, owner: 'p1' } } };
    const falcon = find(s0, 'Test Falcon', 'battlefield', 'p1');
    let s = drive(act(s0, legalActions(s0, 'p1').find((a) => a.kind === 'activate' && !a.isMana && a.object === falcon)!.action));
    expect(s.pending?.kind).toBe('chooseTargets');
    expect((s.pending as unknown as { objects: ObjectId[] }).objects).toEqual([trinket]);
    s = resolveAll(drive(s, [], [[obj(trinket)]]));
    expect(s.objects[trinket]!.controller).toBe('p1');
  });
});

describe('CR 108.4, 608.2d: "you may have target opponent gain control of target permanent you control" (eff.r4copy.mayHave.player.gainControl)', () => {
  const GIFT = card('Test Tea', 'Creature — Human', '{1}: You may have target opponent gain control of target artifact you control.', { pt: ['1', '1'] });
  const defs = [...COMMON, GIFT];
  it('has no manual part', () => expect(noManual(GIFT)).toBe(true));
  it('yes: the opponent controls the artifact from then on; no: it stays yours', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Tea', 'Test Trinket', 'Plains'] }, defs });
    const trinket = find(s0, 'Test Trinket', 'battlefield', 'p1');
    const tea = find(s0, 'Test Tea', 'battlefield', 'p1');
    const la = legalActions(s0, 'p1').find((a) => a.kind === 'activate' && !a.isMana && a.object === tea)!;
    let s = resolveAll(drive(act(s0, la.action), [], [[player('p2')], [obj(trinket)]]), [yes]);
    expect(s.objects[trinket]!.controller).toBe('p2');
    s = advanceTo(s, 2, 'upkeep');
    expect(s.objects[trinket]!.controller).toBe('p2');
    const t = resolveAll(drive(act(s0, la.action), [], [[player('p2')], [obj(trinket)]]), [no]);
    expect(t.objects[trinket]!.controller).toBe('p1');
  });
});

describe('CR 707.12, 608.2g: "Copy them. You may cast any number of the copies." (eff.r4copy.copy.group, rid.r4copy.mayCastAnyNumberOfCopies)', () => {
  const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 1 damage to any target.');
  const SAGA = card('Test Recall', 'Sorcery', 'Exile up to two target instant cards from your graveyard. Copy them. You may cast any number of the copies.');
  const defs = [...COMMON, ZAP, SAGA];
  it('has no manual part', () => expect(noManual(SAGA)).toBe(true));
  it('each copy may be cast or not: cast the Shock copy, not the Zap copy', () => {
    const s0 = scenario([], { p1: { hand: ['Test Recall'], graveyard: ['Test Shock', 'Test Zap'], battlefield: ['Plains'] }, defs });
    const shock = find(s0, 'Test Shock', 'graveyard', 'p1');
    const zap = find(s0, 'Test Zap', 'graveyard', 'p1');
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Recall', 'hand') }), [], [[obj(shock), obj(zap)]]);
    for (let i = 0; i < 10 && s.pending?.kind === 'priority'; i++) s = pass(s);
    const answers: DecisionAnswer[] = [];
    for (let i = 0; i < 6 && s.pending && s.pending.kind !== 'priority'; i++) {
      if (s.pending.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: /Shock/.test((s.pending as unknown as { prompt: string }).prompt) });
      else if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [player('p2')] });
      else s = drive(s, answers);
    }
    s = resolveAll(s);
    expect(life(s, 'p2')).toBe(18);
    expect(s.zones.exile.length).toBe(2);
    expect(s.zones.exile.every((id) => s.objects[id]!.kind === 'card')).toBe(true);
  });
});

describe('CR 614.1a, 616.1, 707.2: "The first time you would create one or more tokens each turn, you may instead create that many tokens that are copies of enchanted permanent." (rep.r4copy.firstTokensEachTurn.copies)', () => {
  const MOON = card('Test Moon', 'Enchantment — Aura', 'Enchant artifact or creature you control\nThe first time you would create one or more tokens each turn, you may instead create that many tokens that are copies of enchanted permanent.');
  const SOLDIERS = card('Test Muster', 'Sorcery', 'Create two 1/1 white Soldier creature tokens.');
  const ONE = card('Test Recruit', 'Sorcery', 'Create a 1/1 white Soldier creature token.');
  const defs = [...COMMON, MOON, SOLDIERS, ONE];
  it('has no manual part', () => expect(noManual(MOON)).toBe(true));
  const setup = (): { s: GameState; giant: ObjectId } => {
    const s0 = scenario([], { p1: { hand: ['Test Moon', 'Test Muster', 'Test Recruit'], battlefield: ['Test Giant'] }, defs });
    const giant = find(s0, 'Test Giant', 'battlefield', 'p1');
    return { s: castAt(s0, 'Test Moon', [[obj(giant)]]), giant };
  };
  it('yes: the two Soldiers are two Giant copies instead; the second token event of the turn is not replaced', () => {
    let { s } = setup();
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Moon')).toBe(true);
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Muster', 'hand') }));
    for (let i = 0; i < 6 && s.pending?.kind === 'priority' && s.zones.stack.length > 0; i++) s = pass(s);
    expect(s.pending?.kind).not.toBe('priority');
    s = resolveAll(s, [yes]);
    expect(onBf(s, 'Test Giant').filter((id) => isToken(s, id)).length).toBe(2);
    expect(onBf(s, 'Soldier Token').length + onBf(s, 'Soldier').length).toBe(0);
    s = castAt(s, 'Test Recruit');
    expect(onBf(s, 'Test Giant').filter((id) => isToken(s, id)).length).toBe(2);
    expect(s.zones.battlefield.filter((id) => getChars(s, id).subtypes.includes('Soldier')).length).toBe(1);
    expect(byHandLog(s)).toBe(false);
  });
  it('no: the Soldiers are created; declining uses up the first time this turn', () => {
    let { s } = setup();
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Muster', 'hand') }));
    for (let i = 0; i < 6 && s.pending?.kind === 'priority' && s.zones.stack.length > 0; i++) s = pass(s);
    s = resolveAll(s, [no]);
    expect(s.zones.battlefield.filter((id) => getChars(s, id).subtypes.includes('Soldier')).length).toBe(2);
    s = castAt(s, 'Test Recruit');
    expect(s.zones.battlefield.filter((id) => getChars(s, id).subtypes.includes('Soldier')).length).toBe(3);
    expect(onBf(s, 'Test Giant').filter((id) => isToken(s, id)).length).toBe(0);
  });
});

describe('CR 614.1a, 301.5: "As long as this Equipment is attached to a creature, the first time ..." (rep.r4copy.attached.firstTokensEachTurn.copies)', () => {
  const CROWN = card('Test Crown', 'Artifact — Equipment', 'As long as this Equipment is attached to a creature, the first time you would create one or more tokens each turn, you may instead create that many tokens that are copies of equipped creature.\nEquip {0}');
  const ONE = card('Test Recruit', 'Sorcery', 'Create a 1/1 white Soldier creature token.');
  const defs = [...COMMON, CROWN, ONE];
  it('has no manual part', () => expect(noManual(CROWN)).toBe(true));
  it('unattached: the token is created with no choice; attached: you may make it a copy of the equipped creature', () => {
    const s0 = scenario([], { p1: { hand: ['Test Recruit'], battlefield: ['Test Crown', 'Test Bear'] }, defs });
    const unattached = castAt(s0, 'Test Recruit');
    expect(unattached.zones.battlefield.filter((id) => getChars(unattached, id).subtypes.includes('Soldier')).length).toBe(1);
    const crown = find(s0, 'Test Crown', 'battlefield', 'p1');
    let s = activate(s0, crown, [[obj(find(s0, 'Test Bear', 'battlefield', 'p1'))]]);
    expect(s.objects[crown]!.attachedTo).toBe(find(s0, 'Test Bear', 'battlefield', 'p1'));
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Recruit', 'hand') }));
    for (let i = 0; i < 6 && s.pending?.kind === 'priority' && s.zones.stack.length > 0; i++) s = pass(s);
    s = resolveAll(s, [yes]);
    expect(onBf(s, 'Test Bear').filter((id) => isToken(s, id)).length).toBe(1);
    expect(s.zones.battlefield.filter((id) => getChars(s, id).subtypes.includes('Soldier')).length).toBe(0);
  });
});

describe('CR 707.5, 707.9b-c, 603.12: "You may have ~ enter as a copy of any creature card in a graveyard, except ~\'s name is ~ and ~ is a 4/4 ... When you do, exile that card." (rep.r4copy.enters.copy.keepName.identity.whenYouDo.exile)', () => {
  const SWAP = card('Test Swapper', 'Legendary Creature — Spider Human', "You may have Test Swapper enter as a copy of any creature card in a graveyard, except his name is Test Swapper and he's a 4/4 Spider Human Hero in addition to his other types. When you do, exile that card.", { pt: ['1', '1'] });
  const defs = [...COMMON, SWAP];
  it('has no manual part', () => expect(noManual(SWAP)).toBe(true));
  it("it copies the opponent's Giant card in their graveyard, keeps its own name, is a 4/4 Giant Spider Human Hero with trample, and the card is exiled", () => {
    const s0 = scenario([], { p1: { hand: ['Test Swapper'] }, p2: { graveyard: ['Test Giant'] }, defs });
    const giantCard = find(s0, 'Test Giant', 'graveyard', 'p2');
    const s = castAt(s0, 'Test Swapper', [], [choose(giantCard)]);
    const [me] = onBf(s, 'Test Swapper');
    expect(me).toBeDefined();
    const c = getChars(s, me!);
    expect(pt(s, me!)).toEqual([4, 4]);
    expect([...c.subtypes].sort()).toEqual(['Giant', 'Hero', 'Human', 'Spider']);
    expect(hasKeyword(c, 'trample')).toBe(true);
    expect(s.zones.exile.map((id) => nameOf(s, id))).toEqual(['Test Giant']);
    expect(byHandLog(s)).toBe(false);
  });
  it('declining: it enters as itself and nothing is exiled', () => {
    const s0 = scenario([], { p1: { hand: ['Test Swapper'] }, p2: { graveyard: ['Test Giant'] }, defs });
    const s = castAt(s0, 'Test Swapper', [], [choose()]);
    expect(pt(s, onBf(s, 'Test Swapper')[0]!)).toEqual([1, 1]);
    expect(s.zones.exile.length).toBe(0);
  });
});
