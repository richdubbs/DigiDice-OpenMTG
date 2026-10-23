/**
 * CLOUD std-msh (the Standard backlog of Marvel Super Heroes), played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings are invented, design 6.10). One block per template of parser/templates/zz-cloud/std-msh.json, then the grammar the slice added to the holes.
 *
 *   CR 613.4b, 613.4c    base power and toughness are set in layer 7b; counters and "gets +N/+N" (and doubling) apply in layer 7c
 *   CR 701.10b-c         to double a creature's power and toughness, it gets +X/+Y, X and Y read as the effect begins (CR 608.2h): later changes don't redouble
 *   CR 608.2c            "... if <condition>. Otherwise, ..." is checked as the ability resolves
 *   CR 608.2g, 118.9     a spell cast during a resolution "without paying its mana cost"; a land is never cast (CR 305.9)
 *   CR 702.8a, 601.3e    "as though it had flash": cast any time you could cast an instant
 *   CR 601.2f            cost reductions reduce only generic mana, and never below zero
 *   CR 614.1a, 120.3     a replacement effect adds to the damage a source would deal
 *   CR 707.2, 707.9b     a copy takes the copiable values, "except it isn't legendary" is part of them
 *   CR 701.20a, 608.2d   a player reveals cards from their hand; you choose one of them
 *   CR 701.26b, 502.3    "can't become untapped": neither the untap step nor an effect untaps it, for the duration
 *   CR 702.6a            equip targets a creature you control; "worthy" restricts it further
 *   CR 506.5             a creature attacking alone is the only creature declared as an attacker
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type Color, type DecisionAnswer, type GameState, type ManaSymbol, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { modifiedPlan } from '../../../src/actions/cast';
import { emptyPlan } from '../../../src/rules/cost';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, life, pass, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
/** No ability of the card is manual, at any depth. */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });
const pick = (...ids: string[]): DecisionAnswer => ({ kind: 'chooseObjects', ids });
const nameOf = (s: GameState, id: ObjectId): string => getChars(s, id).name;
const names = (s: GameState, ids: readonly ObjectId[]): string[] => ids.map((id) => s.defs[s.objects[id]!.defId]!.name);
const pt = (s: GameState, id: ObjectId): [number, number] => [Number(getChars(s, id).power), Number(getChars(s, id).toughness)];
const onBf = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => getChars(s, id).name === name);
const plusOne = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['+1/+1'] ?? 0;

/** Answer the decisions in order (mana is paid automatically, targets from `targets`); stops at priority or at a decision with no answer left. */
function drive(s0: GameState, answers: DecisionAnswer[] = [], targets: TargetChoice[][] = []): GameState {
  let s = s0;
  const queue = [...answers];
  const tq = [...targets];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'order' && queue[0]?.kind !== 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((i) => i.id) }); // in the order offered
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
  for (let guard = 0; (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')) && guard < 40; guard++) {
    if (s.pending?.kind === 'priority') s = pass(s);
    else {
      const before = s;
      s = drive(s, queue.splice(0, 1), tq.length > 0 && s.pending?.kind === 'chooseTargets' ? [tq.shift()!] : []);
      if (s === before) break;
    }
  }
  return s;
}
/** Cast a card from the player's hand at these targets (one group per target requirement) and let everything resolve. */
function castAt(s0: GameState, name: string, targets: TargetChoice[][] = [], answers: DecisionAnswer[] = [], who = 'p1'): GameState {
  const s = drive(act(s0, { type: 'cast', player: who, card: find(s0, name, 'hand', who) }), [], targets);
  return resolveAll(s, answers);
}
/** Activate the first non-mana activated ability of a permanent (its first printed one unless `nth`), then let everything resolve. */
function activate(s0: GameState, source: ObjectId, targets: TargetChoice[][] = [], answers: DecisionAnswer[] = [], nth = 0): GameState {
  const las = legalActions(s0, s0.pending!.player).filter((a) => a.kind === 'activate' && !a.isMana && a.object === source);
  const la = las[nth];
  if (!la) throw new Error(`no activation of ${nameOf(s0, source)}`);
  return resolveAll(drive(act(s0, la.action), [], targets), answers);
}
const canCast = (s: GameState, id: ObjectId, who = 'p1'): boolean => legalActions(s, who).some((a) => a.kind === 'cast' && a.object === id);
const manaText = (m: readonly ManaSymbol[]): string => m.map((x) => (x.kind === 'generic' ? `{${x.amount}}` : x.kind === 'colored' ? `{${x.color}}` : `{${x.kind}}`)).join('') || '{0}';
/** The total cost of casting `id` for p1 after the cost modifiers (CR 601.2f). */
function costOf(s: GameState, id: ObjectId, def: CardDef): string {
  const m = modifiedPlan(s, 'p1', id, { ...emptyPlan(), mana: (def.faces[0]!.manaCost ?? []).filter((x) => x.kind !== 'variable') });
  return 'plan' in m ? manaText(m.plan.mana) : `denied: ${m.denial.message}`;
}

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{1}{G}', colors: ['G'] });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['2', '3'] });
const GIANT = card('Test Giant', 'Creature — Giant', 'Trample', { pt: ['4', '6'], cost: '{2}{G}', colors: ['G'] });
const STUDY = card('Test Study', 'Sorcery', 'You gain 3 life.', { cost: '{2}' });
const TONIC = card('Test Tonic', 'Instant', 'You gain 2 life.', { cost: '{W}', colors: ['W'] });
const GROW = card('Test Grow', 'Instant', 'Put a +1/+1 counter on target creature.');
const SHOCK = card('Test Shock', 'Instant', 'Test Shock deals 2 damage to any target.');
const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
const TRINKET = card('Test Trinket', 'Artifact', '');
const COMMON = [BEAR, OGRE, GIANT, STUDY, TONIC, GROW, SHOCK, KILL, TRINKET];

describe('CR 613.4b, 613.1f: "Until end of turn, target creature\'s base power and toughness become 4/4 and it gains flying." (eff.stdmsh.basept.become.lead.gains)', () => {
  const SURGE = card('Test Surge', 'Sorcery', "Until end of turn, target creature's base power and toughness become 4/4 and it gains flying.");
  it('is automated', () => expect(full(SURGE)).toBe(true));
  it('sets the base 4/4 (a +1/+1 counter still applies on top, layer 7c) and grants flying, both ending with the turn', () => {
    const s0 = scenario([], { p1: { hand: ['Test Surge'], battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 1 } }] }, defs: [...COMMON, SURGE] });
    const bear = find(s0, 'Test Bear', 'battlefield');
    expect(pt(s0, bear)).toEqual([3, 3]);
    let s = castAt(s0, 'Test Surge', [[obj(bear)]]);
    expect(pt(s, bear)).toEqual([5, 5]);
    expect(hasKeyword(getChars(s, bear), 'flying')).toBe(true);
    s = advanceTo(s, 2, 'upkeep');
    expect(pt(s, bear)).toEqual([3, 3]);
    expect(hasKeyword(getChars(s, bear), 'flying')).toBe(false);
  });
});

describe('CR 608.2c, 111.1: "When this creature enters, create a tapped 1/1 white Soldier creature token if you control three or more artifacts. Otherwise, you gain 2 life." (eff.stdmsh.token.tapped.ifCond)', () => {
  const MUSTER = card('Test Muster', 'Creature — Human Soldier', 'When this creature enters, create a tapped 1/1 white Soldier creature token if you control three or more artifacts. Otherwise, you gain 2 life.', { pt: ['1', '1'] });
  it('is automated', () => expect(full(MUSTER)).toBe(true));
  it('with three artifacts: a tapped Soldier token, no life', () => {
    const s0 = scenario([], { p1: { hand: ['Test Muster'], battlefield: ['Test Trinket', 'Test Trinket', 'Test Trinket'] }, defs: [...COMMON, MUSTER] });
    const s = castAt(s0, 'Test Muster');
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens.length).toBe(1);
    expect(getChars(s, tokens[0]!).subtypes).toEqual(['Soldier']);
    expect(s.objects[tokens[0]!]!.tapped).toBe(true);
    expect(life(s, 'p1')).toBe(life(s0, 'p1'));
  });
  it('with two artifacts: no token, you gain 2 life (the condition is read as the ability resolves)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Muster'], battlefield: ['Test Trinket', 'Test Trinket'] }, defs: [...COMMON, MUSTER] });
    const s = castAt(s0, 'Test Muster');
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toEqual([]);
    expect(life(s, 'p1')).toBe(life(s0, 'p1') + 2);
  });
});

describe('CR 701.10b-c, 608.2h: "Double target creature\'s power and toughness until end of turn." (eff.stdmsh.double.pt.possessive)', () => {
  const DOUBLE = card('Test Double', 'Instant', "Double target creature's power and toughness until end of turn.");
  it('is automated', () => expect(full(DOUBLE)).toBe(true));
  it('a 2/3 becomes 4/6; a counter put afterwards adds once (the doubling was locked in); the doubling ends with the turn', () => {
    const s0 = scenario([], { p1: { hand: ['Test Double', 'Test Grow'], battlefield: ['Test Ogre'] }, defs: [...COMMON, DOUBLE] });
    const ogre = find(s0, 'Test Ogre', 'battlefield');
    let s = castAt(s0, 'Test Double', [[obj(ogre)]]);
    expect(pt(s, ogre)).toEqual([4, 6]);
    s = castAt(s, 'Test Grow', [[obj(ogre)]]);
    expect(pt(s, ogre)).toEqual([5, 7]);
    s = advanceTo(s, 2, 'upkeep');
    expect(pt(s, ogre)).toEqual([3, 4]);
  });
});

describe('CR 608.2g, 118.9, 305.9: "{T}: Look at the top three cards of your library. You may cast a spell from among them [with mana value ...] without paying its mana cost. Put the rest on the bottom ..."', () => {
  const SEER = card('Test Seer', 'Creature — Human Wizard', '{T}: Look at the top three cards of your library. You may cast a spell from among them without paying its mana cost. Put the rest on the bottom of your library in a random order.', { pt: ['1', '1'] });
  const SAGE = card('Test Sage', 'Creature — Human Wizard', '{T}: Look at the top three cards of your library. You may cast a spell from among them with mana value less than or equal to the number of lands you control without paying its mana cost. Put the rest on the bottom of your library in a random order.', { pt: ['1', '1'] });
  const ORACLE = card('Test Oracle', 'Creature — Human Wizard', '{T}: Look at the top three cards of your library. You may cast a spell with mana value 2 or less from among them without paying its mana cost. Put the rest on the bottom of your library in a random order.', { pt: ['1', '1'] });
  const defs = [...COMMON, SEER, SAGE, ORACLE];
  const options = (s: GameState): string[] => names(s, (s.pending as unknown as { options: string[] }).options).sort();
  it('is automated (eff.stdmsh.seen.cast.free, .mvAtMost, .mvOrLess)', () => {
    expect(full(SEER)).toBe(true);
    expect(full(SAGE)).toBe(true);
    expect(full(ORACLE)).toBe(true);
  });
  it('offers the nonland cards among the three; the chosen one is cast free, the other two go to the bottom', () => {
    const s0 = scenario([], { p1: { library: ['Test Study', 'Plains', 'Test Bear'], battlefield: ['Test Seer'] }, defs });
    const before = life(s0, 'p1');
    const seer = find(s0, 'Test Seer', 'battlefield');
    let s = drive(act(s0, legalActions(s0, 'p1').find((a) => a.kind === 'activate' && a.object === seer)!.action));
    s = drive(pass(pass(s)));
    expect(s.pending!.kind).toBe('chooseObjects');
    expect(options(s)).toEqual(['Test Bear', 'Test Study']);
    s = resolveAll(drive(s, [pick(find(s, 'Test Study', 'library'))]));
    expect(life(s, 'p1')).toBe(before + 3);
    expect(s.players[0]!.manaPool).toEqual([]);
    const lib = s.zones.library.p1!;
    expect(names(s, lib.slice(-2)).sort()).toEqual(['Plains', 'Test Bear']);
    expect(names(s, lib.slice(0, 3))).toEqual(['Plains', 'Plains', 'Plains']); // the scenario's filler
  });
  it('choosing none casts nothing and all three go to the bottom', () => {
    const s0 = scenario([], { p1: { library: ['Test Study', 'Plains', 'Test Bear'], battlefield: ['Test Seer'] }, defs });
    const s = activate(s0, find(s0, 'Test Seer', 'battlefield'), [], [pick()]);
    expect(life(s, 'p1')).toBe(life(s0, 'p1'));
    expect(names(s, s.zones.library.p1!.slice(-3)).sort()).toEqual(['Plains', 'Test Bear', 'Test Study']);
  });
  it('"with mana value less than or equal to the number of lands you control" is read as it resolves: two lands, the mana value 3 card is not offered', () => {
    const s0 = scenario([], { p1: { library: ['Test Giant', 'Test Bear', 'Test Study'], battlefield: ['Test Sage', 'Plains', 'Plains'] }, defs });
    const sage = find(s0, 'Test Sage', 'battlefield');
    const s = drive(pass(pass(drive(act(s0, legalActions(s0, 'p1').find((a) => a.kind === 'activate' && a.object === sage)!.action)))));
    expect(options(s)).toEqual(['Test Bear', 'Test Study']);
    const three = tweak(s0, (x) => { x.zones.battlefield.push(x.zones.library.p1!.pop()!); x.objects[x.zones.battlefield.at(-1)!]!.zone = 'battlefield'; });
    const t = drive(pass(pass(drive(act(three, legalActions(three, 'p1').find((a) => a.kind === 'activate' && a.object === sage)!.action)))));
    expect(options(t)).toEqual(['Test Bear', 'Test Giant', 'Test Study']);
  });
  it('"a spell with mana value 2 or less from among them": the mana value 3 card is not offered', () => {
    const s0 = scenario([], { p1: { library: ['Test Giant', 'Test Bear', 'Test Study'], battlefield: ['Test Oracle'] }, defs });
    const oracle = find(s0, 'Test Oracle', 'battlefield');
    const s = drive(pass(pass(drive(act(s0, legalActions(s0, 'p1').find((a) => a.kind === 'activate' && a.object === oracle)!.action)))));
    expect(options(s)).toEqual(['Test Bear', 'Test Study']);
    const r = resolveAll(drive(s, [pick(find(s, 'Test Bear', 'library'))]));
    expect(onBf(r, 'Test Bear').length).toBe(1); // a creature spell cast free resolves onto the battlefield
  });
});

describe('CR 702.8a, 601.3e, 604.1: "As long as <condition>, you may cast <spells> as though they had flash." (sta.stdmsh.aslong.flash)', () => {
  const PERMIT = card('Test Permit', 'Enchantment', 'As long as you control a Wizard, you may cast instant and sorcery spells as though they had flash.');
  const ALERT = card('Test Alert', 'Enchantment', 'As long as an opponent has cast a spell this turn, you may cast spells as though they had flash.');
  const ADEPT = card('Test Adept', 'Creature — Human Wizard', '', { pt: ['1', '1'] });
  const defs = [...COMMON, PERMIT, ALERT, ADEPT];
  it('is automated', () => {
    expect(full(PERMIT)).toBe(true);
    expect(full(ALERT)).toBe(true);
  });
  it('with a Wizard, a sorcery can be cast while a spell is on the stack; without one, it cannot', () => {
    const withWizard = scenario([], { p1: { hand: ['Test Tonic', 'Test Study'], battlefield: ['Test Permit', 'Test Adept', 'Plains', 'Plains', 'Plains'] }, defs });
    let s = drive(act(withWizard, { type: 'cast', player: 'p1', card: find(withWizard, 'Test Tonic', 'hand') }));
    expect(s.zones.stack.length).toBe(1);
    expect(canCast(s, find(s, 'Test Study', 'hand'))).toBe(true);
    const noWizard = scenario([], { p1: { hand: ['Test Tonic', 'Test Study'], battlefield: ['Test Permit', 'Plains', 'Plains', 'Plains'] }, defs });
    s = drive(act(noWizard, { type: 'cast', player: 'p1', card: find(noWizard, 'Test Tonic', 'hand') }));
    expect(canCast(s, find(s, 'Test Study', 'hand'))).toBe(false);
  });
  it('a creature spell is not an instant or sorcery spell: the permission does not cover it (it is castable once the stack is empty)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Tonic', 'Test Ogre'], battlefield: ['Test Permit', 'Test Adept', 'Plains'] }, defs });
    const s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Tonic', 'hand') }));
    expect(canCast(s, find(s, 'Test Ogre', 'hand'))).toBe(false);
    expect(canCast(s0, find(s0, 'Test Ogre', 'hand'))).toBe(true);
  });
  it('"as long as an opponent has cast a spell this turn": after the opponent casts one, a creature spell can be cast in response; before, it cannot', () => {
    const s0 = scenario([], { p1: { hand: ['Test Ogre'], battlefield: ['Test Alert'] }, p2: { hand: ['Test Tonic'], battlefield: ['Plains'] }, defs });
    let s = pass(s0); // p1 passes in its main phase with an empty stack: p2 gets priority
    expect(s.pending!.player).toBe('p2');
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Tonic', 'hand', 'p2') }));
    s = pass(s); // p2 passes: p1 has priority with the opponent's spell on the stack
    expect(s.pending!.player).toBe('p1');
    expect(canCast(s, find(s, 'Test Ogre', 'hand'))).toBe(true);
    const mine = scenario([], { p1: { hand: ['Test Ogre', 'Test Tonic'], battlefield: ['Test Alert', 'Plains'] }, defs });
    const t = drive(act(mine, { type: 'cast', player: 'p1', card: find(mine, 'Test Tonic', 'hand') }));
    expect(canCast(t, find(t, 'Test Ogre', 'hand'))).toBe(false); // your own spell is not an opponent's
  });
});

describe('CR 601.2f, 202.3: "Sorcery spells you cast with mana value 5 or greater cost {X} less to cast, where X is <quantity>." (cm.stdmsh.spells.less.you.manaValue.whereX)', () => {
  const WITCH = card('Test Witch', 'Creature — Human Wizard', "Sorcery spells you cast with mana value 5 or greater cost {X} less to cast, where X is Test Witch's power.", { pt: ['3', '3'] });
  const BLAST = card('Test Blast', 'Sorcery', 'You gain 1 life.', { cost: '{5}{R}', colors: ['R'] });
  const SPARK = card('Test Spark', 'Sorcery', 'You gain 1 life.', { cost: '{3}{R}', colors: ['R'] });
  const BRUTE = card('Test Ox', 'Creature — Ox', '', { pt: ['1', '1'], cost: '{5}{G}', colors: ['G'] });
  const defs = [...COMMON, WITCH, BLAST, SPARK, BRUTE];
  it('is automated', () => expect(full(WITCH)).toBe(true));
  it('reduces a mana value 6 sorcery by its power, not a mana value 4 sorcery nor a creature spell; never below zero generic', () => {
    const s = scenario([], { p1: { hand: ['Test Blast', 'Test Spark', 'Test Ox'], battlefield: ['Test Witch'] }, defs });
    expect(costOf(s, find(s, 'Test Blast', 'hand'), BLAST)).toBe('{2}{R}');
    expect(costOf(s, find(s, 'Test Spark', 'hand'), SPARK)).toBe('{3}{R}');
    expect(costOf(s, find(s, 'Test Ox', 'hand'), BRUTE)).toBe('{5}{G}');
    const big = scenario([], { p1: { hand: ['Test Blast'], battlefield: [{ name: 'Test Witch', counters: { '+1/+1': 4 } }] }, defs });
    expect(costOf(big, find(big, 'Test Blast', 'hand'), BLAST)).toBe('{R}');
  });
});

describe('CR 614.1a, 120.3: "If a source you control would deal [noncombat] damage to an opponent or a permanent an opponent controls, it deals that much damage plus N instead."', () => {
  const FURNACE = card('Test Furnace', 'Enchantment', 'If a source you control would deal noncombat damage to an opponent or a permanent an opponent controls, it deals that much damage plus 3 instead.');
  const ARCHER = card('Test Archer', 'Creature — Human Archer', "If a source you control would deal noncombat damage to an opponent or a permanent an opponent controls, instead it deals that much damage plus X, where X is Test Archer's power.", { pt: ['3', '3'] });
  const BOSS = card('Test Boss', 'Enchantment', 'If a source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 1 instead.');
  const defs = [...COMMON, FURNACE, ARCHER, BOSS];
  it('is automated (rep.stdmsh.damage.noncombat.opp.plus, .insteadFirst.whereX, rep.stddft.damage.plus.yourSource.toOpponentOrTheirPermanent)', () => {
    expect(full(FURNACE)).toBe(true);
    expect(full(ARCHER)).toBe(true);
    expect(full(BOSS)).toBe(true);
  });
  it('2 damage to the opponent becomes 5, to their creature 5; to yourself it stays 2', () => {
    const s0 = scenario([], { p1: { hand: ['Test Shock', 'Test Shock', 'Test Shock'], battlefield: ['Test Furnace'] }, p2: { battlefield: ['Test Giant'] }, defs });
    let s = castAt(s0, 'Test Shock', [[player('p2')]]);
    expect(life(s, 'p2')).toBe(life(s0, 'p2') - 5);
    const giant = find(s, 'Test Giant', 'battlefield', 'p2');
    s = castAt(s, 'Test Shock', [[obj(giant)]]);
    expect(s.objects[giant]!.damage).toBe(5);
    s = castAt(s, 'Test Shock', [[player('p1')]]);
    expect(life(s, 'p1')).toBe(life(s0, 'p1') - 2);
  });
  it('the opponent\'s sources are not yours: their 2 damage to you stays 2', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Furnace'] }, p2: { hand: ['Test Shock'] }, defs });
    let s = pass(s0);
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Shock', 'hand', 'p2') }), [], [[player('p1')]]));
    expect(life(s, 'p1')).toBe(life(s0, 'p1') - 2);
  });
  it('"plus X, where X is its power": 2 damage becomes 5 with a 3-power archer', () => {
    const s0 = scenario([], { p1: { hand: ['Test Shock'], battlefield: ['Test Archer'] }, defs });
    const s = castAt(s0, 'Test Shock', [[player('p2')]]);
    expect(life(s, 'p2')).toBe(life(s0, 'p2') - 5);
  });
  it('noncombat only: combat damage of a 2/2 stays 2 with the furnace, and becomes 3 with the boss (any damage)', () => {
    for (const [ench, dealt] of [['Test Furnace', 2], ['Test Boss', 3]] as const) {
      const s0 = scenario([], { p1: { battlefield: [ench, 'Test Bear'] }, defs });
      let s = declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Test Bear', 'battlefield')]]);
      for (let i = 0; i < 20 && s.turn.step !== 'endCombat'; i++) s = s.pending?.kind === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] }) : pass(s);
      expect(life(s, 'p2'), ench).toBe(life(s0, 'p2') - dealt);
    }
  });
});

describe('CR 707.2, 707.9b: "For each <description>, create a token that\'s a copy of that creature[, except it isn\'t legendary]." (eff.stdmsh.forEach.filter.copy, .notLegendary)', () => {
  const INCURSION = card('Test Incursion', 'Sorcery', "For each nontoken artifact creature you control, create a token that's a copy of that creature, except it isn't legendary.");
  const HALL = card('Test Hall', 'Sorcery', "For each artifact you control, create a token that's a copy of that artifact.");
  const GOLEM = card('Test Golem', 'Legendary Artifact Creature — Golem', '', { pt: ['3', '3'] });
  const AUTOMATON = card('Test Automaton', 'Artifact Creature — Construct', '', { pt: ['1', '2'] });
  const defs = [...COMMON, INCURSION, HALL, GOLEM, AUTOMATON];
  it('is automated', () => {
    expect(full(INCURSION)).toBe(true);
    expect(full(HALL)).toBe(true);
  });
  it('copies each nontoken artifact creature (not the Bear); the legendary one\'s copy is not legendary, so both stay (CR 704.5j)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Incursion'], battlefield: ['Test Golem', 'Test Automaton', 'Test Bear'] }, defs });
    const s = castAt(s0, 'Test Incursion');
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens.map((id) => nameOf(s, id)).sort()).toEqual(['Test Automaton', 'Test Golem']);
    const golemCopy = tokens.find((id) => nameOf(s, id) === 'Test Golem')!;
    expect(getChars(s, golemCopy).supertypes).not.toContain('Legendary');
    expect(pt(s, golemCopy)).toEqual([3, 3]);
    expect(onBf(s, 'Test Golem').length).toBe(2);
  });
  it('the set is fixed as it resolves: two artifacts give two copies, not more (the new tokens are artifacts too)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Hall'], battlefield: ['Test Trinket', 'Test Automaton'] }, defs });
    const s = castAt(s0, 'Test Hall');
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').map((id) => nameOf(s, id)).sort()).toEqual(['Test Automaton', 'Test Trinket']);
  });
});

describe('CR 701.20a, 608.2d: "Target player reveals a number of cards from their hand equal to <N>. You choose one of them. That player discards that card."', () => {
  const PROBE = card('Test Probe', 'Sorcery', 'Target player reveals a number of cards from their hand equal to the number of creatures you control. You choose one of them. That player discards that card.');
  const defs = [...COMMON, PROBE];
  it('is automated (eff.stdmsh.player.reveals.cardsFromHand.equalTo, eff.stdmsh.you.choose.oneOf)', () => expect(full(PROBE)).toBe(true));
  it('two creatures: the player reveals two cards of their choice, you choose one, they discard it', () => {
    const s0 = scenario([], { p1: { hand: ['Test Probe'], battlefield: ['Test Bear', 'Test Ogre'] }, p2: { hand: ['Test Study', 'Test Shock', 'Plains', 'Test Giant'] }, defs });
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Probe', 'hand') }), [], [[player('p2')]]);
    s = drive(pass(pass(s)));
    expect(s.pending!.kind).toBe('chooseObjects');
    expect(s.pending!.player).toBe('p2');
    const reveal = [find(s, 'Test Study', 'hand', 'p2'), find(s, 'Test Giant', 'hand', 'p2')];
    s = drive(s, [pick(...reveal)]);
    expect(s.pending!.kind).toBe('chooseObjects');
    expect(s.pending!.player).toBe('p1');
    expect(names(s, (s.pending as unknown as { options: string[] }).options).sort()).toEqual(['Test Giant', 'Test Study']);
    s = resolveAll(drive(s, [pick(reveal[1]!)]));
    expect(names(s, s.zones.graveyard.p2!)).toEqual(['Test Giant']);
    expect(names(s, s.zones.hand.p2!).sort()).toEqual(['Plains', 'Test Shock', 'Test Study']);
  });
  it('a player with fewer cards reveals them all: one card in hand, it is the one discarded', () => {
    const s0 = scenario([], { p1: { hand: ['Test Probe'], battlefield: ['Test Bear', 'Test Ogre'] }, p2: { hand: ['Test Study'] }, defs });
    const only = find(s0, 'Test Study', 'hand', 'p2');
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Probe', 'hand') }), [], [[player('p2')]]);
    s = resolveAll(s, [pick(only), pick(only)]); // the reveal and the choice have one possible answer each (the engine may take it itself)
    expect(names(s, s.zones.graveyard.p2!)).toEqual(['Test Study']);
    expect(s.zones.hand.p2).toEqual([]);
  });
});

describe('CR 701.26b, 502.3, 611.2b: "When this creature enters, tap target creature an opponent controls. That creature can\'t become untapped for as long as you control <it>." (eff.stdmsh.rst.cant.becomeUntapped)', () => {
  const JAILER = card('Test Jailer', 'Creature — Human Rogue', "When this creature enters, tap target creature an opponent controls. That creature can't become untapped for as long as you control Test Jailer.", { pt: ['1', '1'] });
  const WAKE = card('Test Wake', 'Instant', 'Untap target creature.');
  const defs = [...COMMON, JAILER, WAKE];
  it('is automated', () => expect(full(JAILER)).toBe(true));
  it('the creature stays tapped through its controller\'s untap step and an untap effect; once the Jailer is gone, it untaps', () => {
    const s0 = scenario([], { p1: { hand: ['Test Jailer', 'Test Kill'] }, p2: { hand: ['Test Wake'], battlefield: ['Test Ogre'] }, defs });
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p2');
    let s = castAt(s0, 'Test Jailer', [], [], 'p1');
    if (s.pending?.kind === 'chooseTargets') s = resolveAll(drive(s, [], [[obj(ogre)]]));
    expect(s.objects[ogre]!.tapped).toBe(true);
    s = advanceTo(s, 2, 'main1');
    expect(s.objects[ogre]!.tapped).toBe(true); // p2's untap step did not untap it
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Wake', 'hand', 'p2') }), [], [[obj(ogre)]]));
    expect(s.objects[ogre]!.tapped).toBe(true); // nor an effect
    s = advanceTo(s, 3, 'main1');
    s = castAt(s, 'Test Kill', [[obj(find(s, 'Test Jailer', 'battlefield', 'p1'))]]);
    s = advanceTo(s, 4, 'main1');
    expect(s.objects[ogre]!.tapped).toBe(false);
  });
});

describe('CR 707.2, 611.2a-b: "<object> becomes a copy of <object> <duration>" (eff.stdmsh.becomeCopy.dur)', () => {
  const MIMIC = card('Test Mimic', 'Instant', 'Target creature you control becomes a copy of another target creature until end of turn.');
  const CHARM = card('Test Charm', 'Enchantment — Aura', 'Enchant creature\nWhen this Aura enters, exile up to one target artifact creature until this Aura leaves the battlefield. Enchanted creature becomes a copy of that creature until this Aura leaves the battlefield.');
  const AUTOMATON = card('Test Automaton', 'Artifact Creature — Construct', '', { pt: ['1', '4'] });
  const SHATTER = card('Test Shatter', 'Instant', 'Destroy target enchantment.');
  const defs = [...COMMON, MIMIC, CHARM, AUTOMATON, SHATTER];
  it('is automated', () => {
    expect(full(MIMIC)).toBe(true);
    expect(full(CHARM)).toBe(true);
  });
  it('the Bear is a Test Giant (4/6, trample) until end of turn, then a Bear again', () => {
    const s0 = scenario([], { p1: { hand: ['Test Mimic'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Giant'] }, defs });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    let s = castAt(s0, 'Test Mimic', [[obj(bear)], [obj(find(s0, 'Test Giant', 'battlefield', 'p2'))]]);
    expect(nameOf(s, bear)).toBe('Test Giant');
    expect(pt(s, bear)).toEqual([4, 6]);
    expect(hasKeyword(getChars(s, bear), 'trample')).toBe(true);
    s = advanceTo(s, 2, 'upkeep');
    expect(nameOf(s, bear)).toBe('Test Bear');
    expect(pt(s, bear)).toEqual([2, 2]);
  });
  it('the Aura exiles the artifact creature and the enchanted creature copies it (its last known information, CR 608.2h) until the Aura leaves; then both are back', () => {
    const s0 = scenario([], { p1: { hand: ['Test Charm', 'Test Shatter'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Automaton'] }, defs });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const automaton = find(s0, 'Test Automaton', 'battlefield', 'p2');
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Charm', 'hand') }), [], [[obj(bear)]]);
    s = resolveAll(s, [], [[obj(automaton)]]);
    expect(s.zones.exile.map((id) => nameOf(s, id))).toEqual(['Test Automaton']);
    expect(nameOf(s, bear)).toBe('Test Automaton');
    expect(pt(s, bear)).toEqual([1, 4]);
    expect(s.log.some((l) => /apply it by hand/.test(l.text))).toBe(false);
    s = castAt(s, 'Test Shatter', [[obj(find(s, 'Test Charm', 'battlefield', 'p1'))]]);
    expect(nameOf(s, bear)).toBe('Test Bear');
    expect(onBf(s, 'Test Automaton').length).toBe(1);
  });
  it('with no artifact creature chosen ("up to one"), nothing is exiled and nothing is copied: no copy left to apply by hand', () => {
    const s0 = scenario([], { p1: { hand: ['Test Charm'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Automaton'] }, defs });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Charm', 'hand') }), [], [[obj(bear)]]);
    s = resolveAll(s, [], [[]]);
    expect(s.zones.exile).toEqual([]);
    expect(nameOf(s, bear)).toBe('Test Bear');
    expect(s.log.some((l) => /apply it by hand/.test(l.text))).toBe(false);
  });
});

describe('CR 614.1a, 301.5: "Double all damage equipped creature would deal." (rep.stdmsh.damage.double.attached)', () => {
  const MAUL = card('Test Maul', 'Artifact — Equipment', 'Double all damage equipped creature would deal.\nEquip {0}');
  const PINGER = card('Test Pinger', 'Creature — Human Archer', '{T}: This creature deals 1 damage to any target.', { pt: ['1', '1'] });
  const defs = [...COMMON, MAUL, PINGER];
  it('is automated', () => expect(full(MAUL)).toBe(true));
  it('the equipped creature\'s 1 damage becomes 2; another creature\'s stays 1', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Maul', 'Test Pinger', 'Test Pinger'] }, defs });
    const [a, b] = s0.zones.battlefield.filter((id) => nameOf(s0, id) === 'Test Pinger');
    let s = activate(s0, find(s0, 'Test Maul', 'battlefield'), [[obj(a!)]]);
    expect(s.objects[find(s, 'Test Maul', 'battlefield')]!.attachedTo).toBe(a);
    s = activate(s, a!, [[player('p2')]]);
    expect(life(s, 'p2')).toBe(life(s0, 'p2') - 2);
    s = activate(s, b!, [[player('p2')]]);
    expect(life(s, 'p2')).toBe(life(s0, 'p2') - 3);
  });
});

describe('CR 702.6a: "Equip worthy {0}" (a legendary non-Villain creature that is red and/or white) (kw.stdmsh.equip.worthy)', () => {
  const HAMMER = card('Test Hammer', 'Artifact — Equipment', 'Equip worthy {0}');
  const HERO = card('Test Hero', 'Legendary Creature — Human Hero', '', { pt: ['2', '2'], colors: ['R'] });
  const PALADIN = card('Test Paladin', 'Legendary Creature — Human Knight', '', { pt: ['2', '2'], colors: ['W', 'G'] });
  const VILLAIN = card('Test Villain', 'Legendary Creature — Human Villain', '', { pt: ['2', '2'], colors: ['R'] });
  const SQUIRE = card('Test Squire', 'Creature — Human Soldier', '', { pt: ['2', '2'], colors: ['R'] });
  const DRUID = card('Test Druid', 'Legendary Creature — Elf Druid', '', { pt: ['2', '2'], colors: ['G'] });
  const defs = [...COMMON, HAMMER, HERO, PALADIN, VILLAIN, SQUIRE, DRUID];
  it('is automated', () => expect(full(HAMMER)).toBe(true));
  it('offers only the worthy creatures you control', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Hammer', 'Test Hero', 'Test Paladin', 'Test Villain', 'Test Squire', 'Test Druid'] }, p2: { battlefield: ['Test Hero'] }, defs });
    const hammer = find(s0, 'Test Hammer', 'battlefield');
    const s = act(s0, legalActions(s0, 'p1').find((a) => a.kind === 'activate' && a.object === hammer)!.action);
    expect(s.pending!.kind).toBe('chooseTargets');
    const offered = (s.pending as unknown as { objects: ObjectId[] }).objects;
    expect(offered.map((id) => `${nameOf(s, id)}@${s.objects[id]!.controller}`).sort()).toEqual(['Test Hero@p1', 'Test Paladin@p1']);
  });
});

describe('grammar: "As long as you\'ve put one or more +1/+1 counters on <it> this turn, it has flying." (CR 604.1, 611.3a: counters put by you, this turn)', () => {
  const CLIMBER = card('Test Climber', 'Creature — Beast', "As long as you've put one or more +1/+1 counters on Test Climber this turn, Test Climber has flying.", { pt: ['2', '2'] });
  const defs = [...COMMON, CLIMBER];
  it('is automated', () => expect(full(CLIMBER)).toBe(true));
  it('your counter gives it flying for the turn; the opponent\'s counter does not', () => {
    const s0 = scenario([], { p1: { hand: ['Test Grow'], battlefield: ['Test Climber'] }, p2: { hand: ['Test Grow'] }, defs });
    const climber = find(s0, 'Test Climber', 'battlefield');
    expect(hasKeyword(getChars(s0, climber), 'flying')).toBe(false);
    let s = castAt(s0, 'Test Grow', [[obj(climber)]]);
    expect(hasKeyword(getChars(s, climber), 'flying')).toBe(true);
    s = advanceTo(s, 2, 'main1');
    expect(hasKeyword(getChars(s, climber), 'flying')).toBe(false);
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Grow', 'hand', 'p2') }), [], [[obj(climber)]]));
    expect(plusOne(s, climber)).toBe(2);
    expect(hasKeyword(getChars(s, climber), 'flying')).toBe(false);
  });
});

describe('grammar: "Whenever another nonland permanent you control is returned to its owner\'s hand, put a +1/+1 counter on <it>." (CR 603.6c, 603.10a)', () => {
  const STEWARD = card('Test Steward', 'Creature — Human', "Whenever another nonland permanent you control is returned to its owner's hand, put a +1/+1 counter on Test Steward.", { pt: ['1', '1'] });
  const RECALL = card('Test Recall', 'Instant', "Return target nonland permanent to its owner's hand.");
  const defs = [...COMMON, STEWARD, RECALL];
  it('is automated', () => expect(full(STEWARD)).toBe(true));
  it('your Bear returned: a counter; the opponent\'s Bear returned: none', () => {
    const s0 = scenario([], { p1: { hand: ['Test Recall', 'Test Recall'], battlefield: ['Test Steward', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] }, defs });
    const steward = find(s0, 'Test Steward', 'battlefield');
    let s = castAt(s0, 'Test Recall', [[obj(find(s0, 'Test Bear', 'battlefield', 'p1'))]]);
    expect(plusOne(s, steward)).toBe(1);
    s = castAt(s, 'Test Recall', [[obj(find(s, 'Test Bear', 'battlefield', 'p2'))]]);
    expect(plusOne(s, steward)).toBe(1);
  });
});

describe('grammar: "When you do, it deals damage equal to the number of +1/+1 counters on it to any other target." (CR 603.12, 115.4)', () => {
  const HULK = card('Test Hulk', 'Creature — Human Berserker', 'Whenever Test Hulk is dealt damage, put a +1/+1 counter on it. When you do, it deals damage equal to the number of +1/+1 counters on it to any other target.', { pt: ['3', '5'] });
  const defs = [...COMMON, HULK];
  it('is automated', () => expect(full(HULK)).toBe(true));
  it('the reflexive trigger offers every target but itself, and deals its counters\' worth', () => {
    const s0 = scenario([], { p1: { hand: ['Test Shock'], battlefield: ['Test Hulk', 'Test Bear'] }, defs });
    const hulk = find(s0, 'Test Hulk', 'battlefield');
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Shock', 'hand') }), [], [[obj(hulk)]]);
    for (let i = 0; i < 10 && s.pending?.kind !== 'chooseTargets'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    expect(s.pending!.kind).toBe('chooseTargets');
    const offered = (s.pending as unknown as { objects: ObjectId[] }).objects;
    expect(offered).not.toContain(hulk);
    expect(offered).toContain(find(s, 'Test Bear', 'battlefield'));
    s = resolveAll(drive(s, [], [[player('p2')]]));
    expect(life(s, 'p2')).toBe(life(s0, 'p2') - 1);
  });
});

describe('grammar: "If that creature is another Hero, put two +1/+1 counters on it instead." (CR 608.2c)', () => {
  const GUARD = card('Test Guard', 'Creature — Human Soldier Hero', 'When this creature enters, put a +1/+1 counter on target creature. If that creature is another Hero, put two +1/+1 counters on it instead.', { pt: ['2', '2'] });
  const ALLY = card('Test Ally', 'Creature — Human Hero', '', { pt: ['1', '1'] });
  const defs = [...COMMON, GUARD, ALLY];
  it('is automated', () => expect(full(GUARD)).toBe(true));
  for (const [what, expected] of [['another Hero', 2], ['itself, a Hero', 1], ['a Bear', 1]] as const) {
    it(`targeting ${what}: ${expected} counter(s)`, () => {
      const s0 = scenario([], { p1: { hand: ['Test Guard'], battlefield: ['Test Ally', 'Test Bear'] }, defs });
      let s = castAt(s0, 'Test Guard');
      const target = what === 'another Hero' ? find(s, 'Test Ally', 'battlefield') : what === 'a Bear' ? find(s, 'Test Bear', 'battlefield') : find(s, 'Test Guard', 'battlefield');
      s = resolveAll(s, [], [[obj(target)]]);
      expect(plusOne(s, target)).toBe(expected);
    });
  }
});

describe('grammar: "{T}: Target creature you control that\'s attacking alone gets +1/+0 until end of turn. You gain 1 life." (CR 506.5)', () => {
  const CROWD = card('Test Crowd', 'Creature — Human Citizen', "{T}: Target creature you control that's attacking alone gets +1/+0 until end of turn. You gain 1 life.", { pt: ['0', '1'] });
  const defs = [...COMMON, CROWD];
  it('is automated', () => expect(full(CROWD)).toBe(true));
  it('one attacker can be the target; with two attackers neither is attacking alone', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Crowd', 'Test Bear', 'Test Ogre'] }, defs });
    const [crowd, bear, ogre] = [find(s0, 'Test Crowd', 'battlefield'), find(s0, 'Test Bear', 'battlefield'), find(s0, 'Test Ogre', 'battlefield')];
    const targetsAfter = (attackers: ObjectId[]): ObjectId[] => {
      let s = declareAttackers(toDeclareAttackers(s0), attackers.map((a) => [a] as [ObjectId]));
      for (let i = 0; i < 5 && !(s.pending?.kind === 'priority' && s.pending.player === 'p1'); i++) s = pass(s);
      const la = legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === crowd);
      if (!la) return [];
      const t = act(s, la.action);
      return t.pending?.kind === 'chooseTargets' ? (t.pending as unknown as { objects: ObjectId[] }).objects : [];
    };
    expect(targetsAfter([bear])).toEqual([bear]);
    expect(targetsAfter([bear, ogre])).toEqual([]);
  });
});

describe('grammar: "If you control a Villain with greater mana value than that creature, gain control of that creature until the end of your next turn instead." (CR 608.2c, 613.1b)', () => {
  const THRALL = card('Test Thrall', 'Sorcery', 'Gain control of target creature until end of turn. If you control a Villain with greater mana value than that creature, gain control of that creature until the end of your next turn instead. Untap that creature. It gains haste until end of turn.');
  const BOSS = card('Test Mastermind', 'Creature — Human Villain', '', { pt: ['1', '1'], cost: '{2}{B}', colors: ['B'] });
  const MINION = card('Test Minion', 'Creature — Human Villain', '', { pt: ['1', '1'], cost: '{B}', colors: ['B'] });
  const defs = [...COMMON, THRALL, BOSS, MINION];
  it('is automated', () => expect(full(THRALL)).toBe(true));
  it('with a mana value 3 Villain, the mana value 2 Bear stays yours through the opponent\'s turn, until the end of your next turn', () => {
    const s0 = scenario([], { p1: { hand: ['Test Thrall'], battlefield: ['Test Mastermind'] }, p2: { battlefield: [{ name: 'Test Bear', tapped: true }] }, defs });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    let s = castAt(s0, 'Test Thrall', [[obj(bear)]]);
    expect(s.objects[bear]!.controller).toBe('p1');
    expect(s.objects[bear]!.tapped).toBe(false);
    expect(hasKeyword(getChars(s, bear), 'haste')).toBe(true);
    s = advanceTo(s, 2, 'main1');
    expect(s.objects[bear]!.controller).toBe('p1');
    expect(hasKeyword(getChars(s, bear), 'haste')).toBe(false);
    s = advanceTo(s, 4, 'upkeep');
    expect(s.objects[bear]!.controller).toBe('p2');
  });
  it('with a mana value 1 Villain, control ends with this turn', () => {
    const s0 = scenario([], { p1: { hand: ['Test Thrall'], battlefield: ['Test Minion'] }, p2: { battlefield: ['Test Bear'] }, defs });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    let s = castAt(s0, 'Test Thrall', [[obj(bear)]]);
    expect(s.objects[bear]!.controller).toBe('p1');
    s = advanceTo(s, 2, 'upkeep');
    expect(s.objects[bear]!.controller).toBe('p2');
  });
});

describe('grammar: "{T}, Sacrifice an Equipment attached to <it>: Target creature gets -4/-4 until end of turn." (CR 701.21a, 301.5)', () => {
  const RONIN = card('Test Ronin', 'Creature — Human Ninja', '{T}, Sacrifice an Equipment attached to Test Ronin: Target creature gets -4/-4 until end of turn. Activate only as a sorcery.', { pt: ['2', '2'] });
  const SWORD = card('Test Sword', 'Artifact — Equipment', 'Equip {0}');
  const defs = [...COMMON, RONIN, SWORD];
  it('is automated', () => expect(full(RONIN)).toBe(true));
  it('an unattached Equipment cannot pay the cost; once attached it can, and is sacrificed', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Ronin', 'Test Sword'] }, p2: { battlefield: ['Test Giant'] }, defs });
    const ronin = find(s0, 'Test Ronin', 'battlefield');
    expect(legalActions(s0, 'p1').some((a) => a.kind === 'activate' && a.object === ronin)).toBe(false);
    let s = activate(s0, find(s0, 'Test Sword', 'battlefield'), [[obj(ronin)]]);
    const giant = find(s, 'Test Giant', 'battlefield', 'p2');
    s = activate(s, ronin, [[obj(giant)]], [pick(find(s, 'Test Sword', 'battlefield'))]);
    expect(pt(s, giant)).toEqual([0, 2]);
    expect(names(s, s.zones.graveyard.p1!)).toEqual(['Test Sword']);
  });
});

describe('grammar: "Whenever <it> attacks, if it\'s equipped, each opponent loses X life and you gain X life, where X is the number of Equipment attached to it." (CR 603.4, 301.5)', () => {
  const DUELIST = card('Test Duelist', 'Creature — Human Warrior', "Whenever Test Duelist attacks, if it's equipped, each opponent loses X life and you gain X life, where X is the number of Equipment attached to it.", { pt: ['1', '1'] });
  const SWORD = card('Test Sword', 'Artifact — Equipment', 'Equip {0}');
  const defs = [...COMMON, DUELIST, SWORD];
  it('is automated', () => expect(full(DUELIST)).toBe(true));
  it('with two Equipment attached the opponent loses 2 and you gain 2; unequipped, nothing happens', () => {
    for (const equip of [2, 0]) {
      let s = scenario([], { p1: { battlefield: ['Test Duelist', 'Test Sword', 'Test Sword'] }, defs });
      const duelist = find(s, 'Test Duelist', 'battlefield');
      const [life1, life2] = [life(s, 'p1'), life(s, 'p2')];
      for (const sword of s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Sword').slice(0, equip)) s = activate(s, sword, [[obj(duelist)]]);
      s = declareAttackers(toDeclareAttackers(s), [[duelist]]);
      s = resolveAll(s);
      expect(life(s, 'p2'), `${equip} attached`).toBe(life2 - equip);
      expect(life(s, 'p1'), `${equip} attached`).toBe(life1 + equip);
    }
  });
});

describe('grammar: "Whenever you cast a spell that targets a creature you control, put a +1/+1 counter on <it>." (CR 601.2c, 603.2)', () => {
  const AGENT = card('Test Agent', 'Creature — Human Spy', 'Whenever you cast a spell that targets a creature you control, put a +1/+1 counter on Test Agent.', { pt: ['1', '1'] });
  const defs = [...COMMON, AGENT];
  it('is automated', () => expect(full(AGENT)).toBe(true));
  it('a spell targeting your creature triggers it; one targeting the opponent\'s creature does not', () => {
    const s0 = scenario([], { p1: { hand: ['Test Grow', 'Test Grow'], battlefield: ['Test Agent', 'Test Bear'] }, p2: { battlefield: ['Test Ogre'] }, defs });
    const agent = find(s0, 'Test Agent', 'battlefield');
    let s = castAt(s0, 'Test Grow', [[obj(find(s0, 'Test Bear', 'battlefield', 'p1'))]]);
    expect(plusOne(s, agent)).toBe(1);
    s = castAt(s, 'Test Grow', [[obj(find(s, 'Test Ogre', 'battlefield', 'p2'))]]);
    expect(plusOne(s, agent)).toBe(1);
  });
});

describe('grammar: "exile up to one target creature other than enchanted creature until this Aura leaves the battlefield" (CR 115.1, 303.4)', () => {
  const VEIL = card('Test Veil', 'Enchantment — Aura', 'Enchant creature you control\nWhen this Aura enters, exile up to one target creature other than enchanted creature until this Aura leaves the battlefield. Enchanted creature becomes a copy of that creature until this Aura leaves the battlefield.');
  const defs = [...COMMON, VEIL];
  it('is automated', () => expect(full(VEIL)).toBe(true));
  it('the enchanted creature is not offered as the creature to exile; the other creatures are', () => {
    const s0 = scenario([], { p1: { hand: ['Test Veil'], battlefield: ['Test Bear', 'Test Ogre'] }, p2: { battlefield: ['Test Giant'] }, defs });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Veil', 'hand') }), [], [[obj(bear)]]);
    for (let i = 0; i < 10 && s.pending?.kind !== 'chooseTargets'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    const offered = (s.pending as unknown as { objects: ObjectId[] }).objects;
    expect(offered.map((id) => nameOf(s, id)).sort()).toEqual(['Test Giant', 'Test Ogre']);
    s = resolveAll(drive(s, [], [[obj(find(s, 'Test Giant', 'battlefield', 'p2'))]]));
    expect(nameOf(s, bear)).toBe('Test Giant');
    expect(pt(s, bear)).toEqual([4, 6]);
  });
});

describe('grammar: "Exile up to one target Equipment attached to that creature." (CR 601.2c: a later target\'s description may name an earlier target)', () => {
  const BLAZE = card('Test Blaze', 'Sorcery', 'Test Blaze deals 5 damage to target creature. Exile up to one target Equipment attached to that creature.');
  const SWORD = card('Test Sword', 'Artifact — Equipment', 'Equip {0}');
  const defs = [...COMMON, BLAZE, SWORD];
  it('is automated', () => expect(full(BLAZE)).toBe(true));
  it('only the Equipment attached to the first target is offered; it is exiled and the creature is dealt 5 damage', () => {
    let s = scenario([], { p1: { hand: ['Test Blaze'], battlefield: ['Test Sword', 'Test Sword', 'Test Giant', 'Test Ogre'] }, defs });
    const giant = find(s, 'Test Giant', 'battlefield');
    const [onGiant, onOgre] = s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Sword');
    s = activate(s, onGiant!, [[obj(giant)]]);
    s = activate(s, onOgre!, [[obj(find(s, 'Test Ogre', 'battlefield'))]]);
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Blaze', 'hand') }), [], [[obj(giant)]]);
    expect(s.pending!.kind).toBe('chooseTargets');
    expect((s.pending as unknown as { objects: ObjectId[] }).objects).toEqual([onGiant]);
    s = resolveAll(drive(s, [], [[obj(onGiant!)]]));
    expect(s.zones.exile.map((id) => nameOf(s, id))).toEqual(['Test Sword']);
    expect(s.objects[giant]!.damage).toBe(5);
  });
});
