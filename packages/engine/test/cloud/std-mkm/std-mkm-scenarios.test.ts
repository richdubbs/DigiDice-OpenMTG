/**
 * CLOUD std-mkm (zz-cloud/std-mkm.json and the engine changes beside it), played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings are invented, design 6.10).
 *
 *   CR 500.5, 106.4      "Until end of turn, you don't lose this mana as steps and phases end": the mana stays through every step of the turn, lost in its cleanup
 *   CR 119.3, 120.3a     "investigate for each opponent who lost life this turn": a player who lost life (and gained it back) counts, a gain alone doesn't
 *   CR 120.1, 115.1      "target creature that dealt damage this turn": the creature as the SOURCE of damage this turn, not one that was dealt damage
 *   CR 120.2, 510.2      "is dealt 3 or more damage": the damage dealt to it at one time, from all sources together (two blockers at once count as one 3)
 *   CR 508.1a, 603.2c    "whenever a player attacks with two or more creatures": one trigger for the declaration of either player, none for one attacker
 *   CR 118.12a, 101.4    "each opponent loses 3 life unless they discard a card or sacrifice a creature": each player of the group pays or loses the life;
 *                        a cost a player can't pay is not offered (CR 118.3)
 *   CR 701.60a, 701.60d  "can't become suspected": suspecting it does nothing, a suspected creature stays suspected; "if it's suspected, it's no longer suspected"
 *   CR 701.60a, 608.2d   "you may suspect one of them": exactly one of the creatures that entered, chosen as the ability resolves (no target)
 *   CR 708.8, 701.40a    "you may turn a creature you control face up": a manifested creature card is turned face up and is that card again
 *   CR 205.1b, 613.1d    "This enchantment is a 3/3 Elk creature with trample in addition to its other types" (layers 4, 6 and 7b; the card types kept)
 *   CR 400.3, 603.4      "two or more creature cards were put into graveyards from anywhere this turn" (a dying creature and a milled card both count)
 *   CR 603.7, 513.1      "Sacrifice it at the beginning of your next end step" (after an instruction that names the token)
 *   CR 508.1d, 611.2a    "target creature attacks or blocks this turn if able"; CR 613.1f "loses defender and gains flying until end of turn"
 *   CR 201.2, 102.3      "the number of differently named creatures you control"; "deals 1 damage to each of your opponents"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, legal, life, passBoth, pool, scenario, zoneNames } from '../../m3/scenario';
import { declareAttackers, runCombat, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual ability, no manual step). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

interface Script { yes?: boolean[]; targets?: TargetChoice[][]; objects?: ObjectId[][] }
/** Answer the decisions that come up (yes/no, targets, chosen objects in order; costs paid automatically) until a player has priority or must declare. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { yes: [...(script.yes ?? [])], targets: [...(script.targets ?? [])], objects: [...(script.objects ?? [])] };
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority' && s.pending.kind !== 'declareAttackers' && s.pending.kind !== 'declareBlockers'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: q.yes.shift() ?? false });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: q.objects.shift() ?? p.options.slice(0, p.min) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
/** Resolve the whole stack, answering with the script as decisions come up. */
function resolveAll(s0: GameState, script?: Script): GameState {
  let s = drive(s0, script);
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = drive(passBoth(s), script);
  return s;
}
const cast = (s: GameState, name: string, script?: Script, player: PlayerId = 'p1'): GameState => drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script);
/** Cast, then resolve everything (the script answers the decisions of both). */
const castResolve = (s: GameState, name: string, script?: Script): GameState => resolveAll(cast(s, name, script), script);
function activate(s: GameState, name: string, script?: Script, mana = false): GameState {
  const id = find(s, name, 'battlefield', 'p1');
  const la = legal(s, 'p1', 'activate').find((a) => a.object === id && a.isMana === mana);
  if (!la) throw new Error(`no ${mana ? 'mana' : 'activated'} ability of ${name}`);
  return drive(act(s, la.action), script);
}
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: PlayerId): TargetChoice => ({ kind: 'player', id });
const named = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name);
const tokens = (s: GameState, p: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p);
const suspected = (s: GameState, id: ObjectId): boolean => s.objects[id]?.suspected !== undefined;
const pt = (s: GameState, id: ObjectId): [number, number] => [Number(getChars(s, id)!.power), Number(getChars(s, id)!.toughness)];

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const PUP = card('Test Pup', 'Creature — Dog', '', ['1', '1']);
const BRUTE = card('Test Brute', 'Creature — Giant', '', ['3', '6']);
const HOUND = card('Test Hound', 'Creature — Dog', '', ['2', '1']);
const ROCK = card('Test Rock', 'Artifact', '');

describe('CR 500.5, 106.4: "{T}: Add {R}{R}. Until end of turn, you don\'t lose this mana as steps and phases end."', () => {
  const KILN = card('Test Kiln', 'Artifact', "{T}: Add {R}{R}. Until end of turn, you don't lose this mana as steps and phases end.");
  const STOVE = card('Test Stove', 'Artifact', '{T}: Add {R}{R}.');
  it('is automated, and it stays a mana ability (no target, could add mana: CR 605.1a)', () => {
    expect(full(KILN)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Kiln'] }, defs: [KILN] });
    expect(legal(s0, 'p1', 'activate').some((a) => a.object === find(s0, 'Test Kiln', 'battlefield', 'p1') && a.isMana)).toBe(true);
  });
  it('the mana stays in the pool through combat, the second main phase and the end step, and is gone by the next turn; plain mana empties at the end of the step', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Kiln', 'Test Stove'] }, defs: [KILN, STOVE] });
    let s = activate(s0, 'Test Kiln', {}, true);
    expect(pool(s, 'p1')).toBe('RR');
    s = advanceTo(s, 1, 'main2');
    expect(pool(s, 'p1')).toBe('RR');
    s = advanceTo(s, 1, 'end');
    expect(pool(s, 'p1')).toBe('RR');
    s = advanceTo(s, 2, 'upkeep');
    expect(pool(s, 'p1')).toBe('');
    const plain = advanceTo(activate(s0, 'Test Stove', {}, true), 1, 'main2');
    expect(pool(plain, 'p1')).toBe('');
  });
});

describe('CR 119.3, 120.3a: "At the beginning of your end step, investigate for each opponent who lost life this turn."', () => {
  const LEDGER = card('Test Ledger', 'Enchantment', 'At the beginning of your end step, investigate for each opponent who lost life this turn.');
  const DRAIN = card('Test Drain', 'Instant', 'Target player loses 1 life.');
  const MEND = card('Test Mend', 'Instant', 'Target player gains 3 life.');
  const atEnd = (s: GameState): GameState => resolveAll(advanceTo(s, 1, 'end'));
  it('is automated', () => expect(full(LEDGER)).toBe(true));
  it('one Clue when the opponent lost life this turn (even if they gained it back), none when they only gained life or nothing happened', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Ledger'], hand: ['Test Drain', 'Test Mend'] }, defs: [LEDGER, DRAIN, MEND] });
    expect(tokens(atEnd(s0), 'p1')).toHaveLength(0);
    const lost = castResolve(s0, 'Test Drain', { targets: [[player('p2')]] });
    expect(life(lost, 'p2')).toBe(19);
    expect(tokens(atEnd(lost), 'p1')).toHaveLength(1);
    const back = castResolve(lost, 'Test Mend', { targets: [[player('p2')]] });
    expect(life(back, 'p2')).toBe(22);
    expect(tokens(atEnd(back), 'p1')).toHaveLength(1);
    const gained = castResolve(s0, 'Test Mend', { targets: [[player('p2')]] });
    expect(tokens(atEnd(gained), 'p1')).toHaveLength(0);
  });
  it('your own loss of life does not count (only opponents)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Ledger'], hand: ['Test Drain'] }, defs: [LEDGER, DRAIN] });
    const own = castResolve(s0, 'Test Drain', { targets: [[player('p1')]] });
    expect(life(own, 'p1')).toBe(19);
    expect(tokens(atEnd(own), 'p1')).toHaveLength(0);
  });
});

describe('CR 120.1, 115.1: "Destroy target creature that dealt damage this turn." (the creature as the source of damage)', () => {
  const VERDICT = card('Test Verdict', 'Instant', 'Destroy target creature that dealt damage this turn.');
  const SPARK = card('Test Spark', 'Instant', 'Test Spark deals 2 damage to target creature.');
  it('is automated', () => expect(full(VERDICT)).toBe(true));
  it('only the creature that dealt combat damage is a legal target: not the one that stayed home, not the one that was dealt damage; next turn none', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bear', 'Test Pup'], hand: ['Test Verdict', 'Test Spark'] }, p2: { battlefield: ['Test Brute'] }, defs: [VERDICT, SPARK, BEAR, PUP, BRUTE] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const brute = find(s0, 'Test Brute', 'battlefield', 'p2');
    let s = castResolve(s0, 'Test Spark', { targets: [[obj(brute)]] });
    expect(s.objects[brute]!.damage).toBe(2);
    s = runCombat(s, { attack: [[bear]] });
    expect(life(s, 'p2')).toBe(18);
    const asked = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Verdict', 'hand', 'p1') });
    expect(asked.pending).toMatchObject({ kind: 'chooseTargets' });
    expect(asked.pending!.kind === 'chooseTargets' && asked.pending!.objects).toEqual([bear]);
    const done = resolveAll(drive(asked, { targets: [[obj(bear)]] }));
    expect(zoneNames(done, 'graveyard', 'p1')).toContain('Test Bear');
    // the next turn: the history of this turn is gone, so nothing is a legal target and the spell can't be cast (CR 601.2c)
    const later = advanceTo(s, 2, 'main1');
    expect(legal(later, 'p1', 'cast').some((a) => a.object === find(later, 'Test Verdict', 'hand', 'p1'))).toBe(false);
  });
});

describe('CR 120.2, 510.2: "Whenever a creature an opponent controls is dealt 3 or more damage, you gain 2 life." (the damage dealt at one time)', () => {
  const WITNESS = card('Test Witness', 'Enchantment', 'Whenever a creature an opponent controls is dealt 3 or more damage, you gain 2 life.');
  const SPARK = card('Test Spark', 'Instant', 'Test Spark deals 2 damage to target creature.');
  const FLARE = card('Test Flare', 'Instant', 'Test Flare deals 3 damage to target creature.');
  it('is automated', () => expect(full(WITNESS)).toBe(true));
  it('2 damage does not trigger it, 3 does; damage to your own creature does not', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Witness', 'Test Pup'], hand: ['Test Spark', 'Test Flare'] }, p2: { battlefield: ['Test Brute'] }, defs: [WITNESS, SPARK, FLARE, PUP, BRUTE] });
    const brute = find(s0, 'Test Brute', 'battlefield', 'p2');
    const two = castResolve(s0, 'Test Spark', { targets: [[obj(brute)]] });
    expect(life(two, 'p1')).toBe(20);
    const three = castResolve(s0, 'Test Flare', { targets: [[obj(brute)]] });
    expect(life(three, 'p1')).toBe(22);
    // two separate times: 2 damage, then 2 more (4 in total this turn, never 3 at one time)
    const s2 = scenario([], { p1: { battlefield: ['Test Witness'], hand: ['Test Spark', 'Test Spark'] }, p2: { battlefield: ['Test Brute'] }, defs: [WITNESS, SPARK, BRUTE] });
    const brute2 = find(s2, 'Test Brute', 'battlefield', 'p2');
    const twice = castResolve(castResolve(s2, 'Test Spark', { targets: [[obj(brute2)]] }), 'Test Spark', { targets: [[obj(brute2)]] });
    expect(twice.objects[brute2]!.damage).toBe(4);
    expect(life(twice, 'p1')).toBe(20);
    const own = castResolve(s0, 'Test Flare', { targets: [[obj(find(s0, 'Test Pup', 'battlefield', 'p1'))]] });
    expect(life(own, 'p1')).toBe(20);
  });
  it('two blockers dealing 2 and 1 combat damage at the same time to the attacker deal it 3 damage: one trigger', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Witness', 'Test Bear', 'Test Pup'] }, p2: { battlefield: ['Test Brute'] }, defs: [WITNESS, BEAR, PUP, BRUTE] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const pup = find(s0, 'Test Pup', 'battlefield', 'p1');
    const brute = find(s0, 'Test Brute', 'battlefield', 'p2');
    const s1 = advanceTo(s0, 2, 'main1');
    const both = runCombat(s1, { attack: [[brute]], block: [[bear, brute], [pup, brute]], assign: { [brute]: [{ id: bear, amount: 2 }, { id: pup, amount: 1 }] } });
    expect(both.objects[brute]!.damage).toBe(3);
    expect(life(both, 'p1')).toBe(22);
    const one = runCombat(s1, { attack: [[brute]], block: [[bear, brute]], assign: { [brute]: [{ id: bear, amount: 3 }] } });
    expect(one.objects[brute]!.damage).toBe(2);
    expect(life(one, 'p1')).toBe(20);
  });
});

describe('CR 508.1a, 603.2c: "Whenever a player attacks with two or more creatures, you gain 1 life."', () => {
  const RALLY = card('Test Rally', 'Enchantment', 'Whenever a player attacks with two or more creatures, you gain 1 life.');
  it('is automated', () => expect(full(RALLY)).toBe(true));
  it('triggers once when you attack with two, not with one, and also when an opponent attacks with two', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Rally', 'Test Bear', 'Test Pup'] }, p2: { battlefield: ['Test Brute', 'Test Hound'] }, defs: [RALLY, BEAR, PUP, BRUTE, HOUND] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const pup = find(s0, 'Test Pup', 'battlefield', 'p1');
    const two = runCombat(s0, { attack: [[bear], [pup]] });
    expect(life(two, 'p1')).toBe(21);
    const one = runCombat(s0, { attack: [[bear]] });
    expect(life(one, 'p1')).toBe(20);
    const theirs = runCombat(advanceTo(s0, 2, 'main1'), { attack: [[find(s0, 'Test Brute', 'battlefield', 'p2')], [find(s0, 'Test Hound', 'battlefield', 'p2')]] });
    expect(life(theirs, 'p1')).toBe(21 - 5);
  });
});

describe('CR 118.12a, 101.4, 118.3: "Each opponent loses 3 life unless they discard a card or sacrifice a creature"; "each player loses 2 life unless they sacrifice ..."', () => {
  const ORB = card('Test Orb', 'Artifact', '{0}: Each opponent loses 3 life unless they discard a card or sacrifice a creature.');
  const IDOL = card('Test Idol', 'Artifact', '{0}: Each player loses 2 life unless they sacrifice a nontoken creature of their choice.');
  it('are automated', () => {
    expect(full(ORB)).toBe(true);
    expect(full(IDOL)).toBe(true);
  });
  it('the opponent discards, or sacrifices, or loses the life: their choice', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Orb'] }, p2: { hand: ['Test Rock'], battlefield: ['Test Bear'] }, defs: [ORB, ROCK, BEAR] });
    const discarded = resolveAll(activate(s0, 'Test Orb'), { yes: [true] });
    expect(life(discarded, 'p2')).toBe(20);
    expect(zoneNames(discarded, 'graveyard', 'p2')).toEqual(['Test Rock']);
    expect(named(discarded, 'Test Bear')).toHaveLength(1);
    const sacrificed = resolveAll(activate(s0, 'Test Orb'), { yes: [false, true] });
    expect(life(sacrificed, 'p2')).toBe(20);
    expect(zoneNames(sacrificed, 'graveyard', 'p2')).toEqual(['Test Bear']);
    expect(zoneNames(sacrificed, 'hand', 'p2')).toEqual(['Test Rock']);
    const neither = resolveAll(activate(s0, 'Test Orb'), { yes: [false, false] });
    expect(life(neither, 'p2')).toBe(17);
    expect(life(neither, 'p1')).toBe(20);
  });
  it('an opponent with no card in hand and no creature cannot pay: the life is lost with no question', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Orb'] }, defs: [ORB] });
    const s = resolveAll(activate(s0, 'Test Orb'));
    expect(s.pending?.kind).toBe('priority');
    expect(life(s, 'p2')).toBe(17);
  });
  it('each player in turn: you, with no creature, lose 2 life; the opponent sacrifices the creature of their choice instead', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Idol'] }, p2: { battlefield: ['Test Bear', 'Test Pup'] }, defs: [IDOL, BEAR, PUP] });
    const pup = find(s0, 'Test Pup', 'battlefield', 'p2');
    const s = resolveAll(activate(s0, 'Test Idol'), { yes: [true], objects: [[pup]] });
    expect(life(s, 'p1')).toBe(18);
    expect(life(s, 'p2')).toBe(20);
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual(['Test Pup']);
    const declined = resolveAll(activate(s0, 'Test Idol'), { yes: [false] });
    expect(life(declined, 'p2')).toBe(18);
    expect(named(declined, 'Test Bear')).toHaveLength(1);
  });
});

describe('CR 701.60a, 701.60d: "Enchanted creature gets +1/+1 and can\'t become suspected."; "Untap target creature. If it\'s suspected, it\'s no longer suspected."', () => {
  const ALIBI = card('Test Alibi', 'Enchantment — Aura', "Enchant creature\nEnchanted creature gets +1/+1 and can't become suspected.");
  const ACCUSE = card('Test Accuse', 'Instant', 'Suspect target creature.');
  const RELEASE = card('Test Release', 'Instant', "Untap target creature. If it's suspected, it's no longer suspected.");
  it('are automated', () => {
    for (const d of [ALIBI, ACCUSE, RELEASE]) expect(full(d), d.name).toBe(true);
  });
  it('the enchanted creature gets +1/+1 and suspecting it does nothing; another creature is suspected', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bear', 'Test Pup'], hand: ['Test Alibi', 'Test Accuse', 'Test Accuse'] }, defs: [ALIBI, ACCUSE, BEAR, PUP] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const pup = find(s0, 'Test Pup', 'battlefield', 'p1');
    let s = castResolve(s0, 'Test Alibi', { targets: [[obj(bear)]] });
    expect(pt(s, bear)).toEqual([3, 3]);
    s = castResolve(s, 'Test Accuse', { targets: [[obj(bear)]] });
    expect(suspected(s, bear)).toBe(false);
    s = castResolve(s, 'Test Accuse', { targets: [[obj(pup)]] });
    expect(suspected(s, pup)).toBe(true);
  });
  it('a creature already suspected stays suspected when the Aura comes (only an effect makes it no longer suspected)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bear'], hand: ['Test Accuse', 'Test Alibi'] }, defs: [ALIBI, ACCUSE, BEAR] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = castResolve(castResolve(s0, 'Test Accuse', { targets: [[obj(bear)]] }), 'Test Alibi', { targets: [[obj(bear)]] });
    expect(suspected(s, bear)).toBe(true);
    expect(pt(s, bear)).toEqual([3, 3]);
  });
  it('"If it\'s suspected, it\'s no longer suspected": the suspected creature is untapped and no longer suspected; a creature that isn\'t stays so', () => {
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Bear', tapped: true }, { name: 'Test Pup', tapped: true }], hand: ['Test Accuse', 'Test Release', 'Test Release'] }, defs: [ACCUSE, RELEASE, BEAR, PUP] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const pup = find(s0, 'Test Pup', 'battlefield', 'p1');
    let s = castResolve(s0, 'Test Accuse', { targets: [[obj(bear)]] });
    expect(suspected(s, bear)).toBe(true);
    s = castResolve(s, 'Test Release', { targets: [[obj(bear)]] });
    expect(suspected(s, bear)).toBe(false);
    expect(s.objects[bear]!.tapped).toBe(false);
    s = castResolve(s, 'Test Release', { targets: [[obj(pup)]] });
    expect(suspected(s, pup)).toBe(false);
    expect(s.objects[pup]!.tapped).toBe(false);
  });
});

describe('CR 701.60a, 608.2d: "Whenever one or more other creatures you control enter, you may suspect one of them."', () => {
  const LINEUP = card('Test Lineup', 'Enchantment', 'Whenever one or more other creatures you control enter, you may suspect one of them.');
  const SQUAD = card('Test Squad', 'Sorcery', 'Create two 1/1 white Soldier creature tokens.');
  it('is automated', () => expect(full(LINEUP)).toBe(true));
  it('two tokens enter at once: one trigger, the controller chooses exactly one of the two, the other is not suspected; declining suspects none', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Lineup', 'Test Bear'], hand: ['Test Squad'] }, defs: [LINEUP, SQUAD, BEAR] });
    const asked = drive(passBoth(cast(s0, 'Test Squad')));
    const pair = tokens(asked, 'p1');
    expect(pair).toHaveLength(2);
    expect(asked.zones.stack).toHaveLength(1); // one trigger for the batch (CR 603.2c)
    const s = resolveAll(asked, { yes: [true], objects: [[pair[1]!]] });
    expect(s.pending?.kind).toBe('priority');
    expect(pair.map((id) => suspected(s, id))).toEqual([false, true]);
    expect(suspected(s, find(s0, 'Test Bear', 'battlefield', 'p1'))).toBe(false);
    const none = resolveAll(asked, { yes: [false] });
    expect(pair.map((id) => suspected(none, id))).toEqual([false, false]);
  });
  it('the choice is among the creatures that entered: the creature already on the battlefield is not offered', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Lineup', 'Test Bear'], hand: ['Test Squad'] }, defs: [LINEUP, SQUAD, BEAR] });
    let s = drive(passBoth(cast(s0, 'Test Squad')));
    s = passBoth(s); // the trigger resolves: "you may"
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p1' });
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', min: 1, max: 1 });
    expect(s.pending!.kind === 'chooseObjects' && [...s.pending!.options].sort()).toEqual([...tokens(s, 'p1')].sort());
  });
});

describe('CR 708.8, 701.40a: "You may turn a creature you control face up."', () => {
  const MANIFEST = card('Test Manifest', 'Sorcery', 'Manifest the top card of your library.');
  const UNMASK = card('Test Unmask', 'Sorcery', 'You may turn a creature you control face up.');
  it('is automated', () => expect(full(UNMASK)).toBe(true));
  it('the manifested creature card is turned face up: it is the Brute again, a 3/6', () => {
    const s0 = scenario([], { p1: { hand: ['Test Manifest', 'Test Unmask'], library: ['Test Brute'] }, defs: [MANIFEST, UNMASK, BRUTE] });
    let s = castResolve(s0, 'Test Manifest');
    const [down] = s.zones.battlefield.filter((id) => s.objects[id]!.faceDown);
    expect(down).toBeDefined();
    expect(pt(s, down!)).toEqual([2, 2]);
    s = castResolve(s, 'Test Unmask', { yes: [true], objects: [[down!]] });
    expect(s.objects[down!]!.faceDown).toBe(false);
    expect(getChars(s, down!)!.name).toBe('Test Brute');
    expect(pt(s, down!)).toEqual([3, 6]);
  });
});

describe('CR 205.1b, 613.1d, 613.4b: "This enchantment is a 3/3 Elk creature with trample in addition to its other types."', () => {
  const GROVE = card('Test Grove', 'Enchantment', 'This enchantment is a 3/3 Elk creature with trample in addition to its other types.');
  it('is automated; on the battlefield it is an Enchantment Creature — Elk, 3/3, with trample', () => {
    expect(full(GROVE)).toBe(true);
    const s = scenario([], { p1: { battlefield: ['Test Grove'] }, defs: [GROVE] });
    const id = find(s, 'Test Grove', 'battlefield', 'p1');
    const c = getChars(s, id)!;
    expect(c.types).toEqual(expect.arrayContaining(['Enchantment', 'Creature']));
    expect(c.subtypes).toContain('Elk');
    expect(pt(s, id)).toEqual([3, 3]);
    expect(hasKeyword(getChars(s, id)!, 'trample')).toBe(true);
  });
});

describe('CR 400.3, 603.4: "This creature gets +2/+2 as long as two or more creature cards were put into graveyards from anywhere this turn."', () => {
  const MOURNER = card('Test Mourner', 'Creature — Elk', 'This creature gets +2/+2 as long as two or more creature cards were put into graveyards from anywhere this turn.', ['1', '1']);
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
  const DREDGE = card('Test Dredge', 'Sorcery', 'Mill two cards.');
  it('is automated', () => expect(full(MOURNER)).toBe(true));
  it('a creature dying is one, a creature card milled from the library the second: +2/+2 for the rest of the turn only', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Mourner'], hand: ['Test Kill', 'Test Dredge'], library: ['Test Pup'] }, p2: { battlefield: ['Test Bear'] }, defs: [MOURNER, KILL, DREDGE, PUP, BEAR] });
    const mourner = find(s0, 'Test Mourner', 'battlefield', 'p1');
    let s = castResolve(s0, 'Test Kill', { targets: [[obj(find(s0, 'Test Bear', 'battlefield', 'p2'))]] });
    expect(pt(s, mourner)).toEqual([1, 1]);
    s = castResolve(s, 'Test Dredge');
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Pup');
    expect(pt(s, mourner)).toEqual([3, 3]);
    s = advanceTo(s, 2, 'upkeep');
    expect(pt(s, mourner)).toEqual([1, 1]);
  });
});

describe('CR 603.7, 513.1: "Create a 1/1 colorless Thopter artifact creature token with flying. It gains haste until end of turn. Sacrifice it at the beginning of your next end step."', () => {
  const SHOP = card('Test Workshop', 'Sorcery', 'Create a 1/1 colorless Thopter artifact creature token with flying. It gains haste until end of turn. Sacrifice it at the beginning of your next end step.');
  it('is automated; the token has haste this turn and is sacrificed at the beginning of this turn\'s end step', () => {
    expect(full(SHOP)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Workshop'] }, defs: [SHOP] });
    let s = castResolve(s0, 'Test Workshop');
    const [thopter] = tokens(s, 'p1');
    expect(thopter).toBeDefined();
    expect(hasKeyword(getChars(s, thopter!)!, 'haste')).toBe(true);
    s = resolveAll(advanceTo(s, 1, 'end'));
    expect(tokens(s, 'p1')).toEqual([]);
  });
});

describe('CR 508.1d, 611.2a: "Target creature attacks or blocks this turn if able."; CR 613.1f: "{0}: This creature loses defender and gains flying until end of turn."', () => {
  const HUSTLE = card('Test Hustle', 'Instant', 'Target creature attacks or blocks this turn if able.');
  const WALL = card('Test Wall', 'Creature — Wall', 'Defender\n{0}: This creature loses defender and gains flying until end of turn.', ['2', '4']);
  it('are automated', () => {
    expect(full(HUSTLE)).toBe(true);
    expect(full(WALL)).toBe(true);
  });
  it('the creature must attack this turn: a declaration without it is not accepted', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bear'], hand: ['Test Hustle'] }, defs: [HUSTLE, BEAR] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = toDeclareAttackers(castResolve(s0, 'Test Hustle', { targets: [[obj(bear)]] }));
    expect(() => declareAttackers(s, [])).toThrow();
    expect(declareAttackers(s, [[bear]]).combat?.attackers.map((a) => a.id)).toEqual([bear]);
  });
  it('the Wall loses defender and gains flying until end of turn, then has defender again', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Wall'] }, defs: [WALL] });
    const wall = find(s0, 'Test Wall', 'battlefield', 'p1');
    expect(hasKeyword(getChars(s0, wall)!, 'defender')).toBe(true);
    const s = resolveAll(activate(s0, 'Test Wall'));
    expect(hasKeyword(getChars(s, wall)!, 'defender')).toBe(false);
    expect(hasKeyword(getChars(s, wall)!, 'flying')).toBe(true);
    const later = advanceTo(s, 2, 'upkeep');
    expect(hasKeyword(getChars(later, wall)!, 'defender')).toBe(true);
    expect(hasKeyword(getChars(later, wall)!, 'flying')).toBe(false);
  });
});

describe('CR 201.2, 102.3: "the number of differently named creatures you control"; "deals 1 damage to each of your opponents"', () => {
  const COUNT = card('Test Census', 'Sorcery', 'Draw cards equal to the number of differently named creatures you control.');
  const FLASH = card('Test Flash', 'Instant', 'Test Flash deals 1 damage to each of your opponents.');
  it('are automated', () => {
    expect(full(COUNT)).toBe(true);
    expect(full(FLASH)).toBe(true);
  });
  it('two Bears and a Pup are two names: two cards drawn', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bear', 'Test Bear', 'Test Pup'], hand: ['Test Census'] }, p2: { battlefield: ['Test Brute'] }, defs: [COUNT, BEAR, PUP, BRUTE] });
    const s = castResolve(s0, 'Test Census');
    expect(s.zones.hand.p1).toHaveLength(2);
  });
  it('each of your opponents is dealt 1 damage; you are not', () => {
    const s = castResolve(scenario([], { p1: { hand: ['Test Flash'] }, defs: [FLASH] }), 'Test Flash');
    expect(life(s, 'p2')).toBe(19);
    expect(life(s, 'p1')).toBe(20);
  });
});
