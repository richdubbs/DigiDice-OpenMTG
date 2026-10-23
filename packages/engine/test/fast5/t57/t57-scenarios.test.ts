/**
 * FAST5 T57: the shapes of parser/templates/zz-fast5/t57.json (and the engine support they needed) played through the engine with synthetic cards compiled by
 * the game's default compiler (invented wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 614.1c, 614.12a, 607.2d   "This land enters tapped. As it enters, choose a color." and "{T}: Add one mana of the chosen color."
 *   CR 509.1b, 702.111b          "~ can't be blocked except by three or more creatures": a minimum on the set of blockers of one attacker
 *   CR 509.1b, 611.2a            "~ can't be blocked by creatures with power 2 or less this turn": checked as blockers are declared, ends with the turn
 *   CR 615.12                    "Damage can't be prevented this turn": prevention shields and protection prevent nothing, to a creature or a player
 *   CR 613.1f, 502.3             "Enchanted creature loses all abilities and doesn't untap during its controller's untap step."
 *   CR 613.1d, 613.1f, 613.4b    "Enchanted creature is a Frog with base power and toughness 1/1. It has defender and loses all other abilities." (layers)
 *   CR 105.2, 115.1              "Exile target creature or planeswalker that's green or blue." (a red creature is not a legal target)
 */
import { describe, expect, it } from 'vitest';
import { applyAction, blockCandidates, compileCard, type CardDef, type Color, type DecisionAnswer, type DeclareBlockersDecision, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, legal, pass, pool, scenario, life } from '../../m3/scenario';
import { declareAttackers, passUntil, tweak, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const manual = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities.filter((a) => a.kind === 'manual').map((a) => a.text)).concat(JSON.stringify(d.faces).includes('"op":"manual"') ? ['a manual step'] : []);
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

/** Answer the decisions that come up (pay automatically, choose `targets`, then `answers` in order); stop at priority. */
function settle(s0: GameState, targets: TargetChoice[] = [], answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
const cast = (s: GameState, name: string, targets: TargetChoice[] = [], player = 'p1'): GameState => settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), targets);
const resolve = (s: GameState): GameState => settle(pass(pass(s)));
function activate(s: GameState, name: string, targets: TargetChoice[] = []): GameState {
  const id = find(s, name, 'battlefield', 'p1');
  const la = legal(s, 'p1', 'activate').find((a) => a.object === id && !a.isMana);
  if (!la) throw new Error(`no activated ability of ${name}`);
  return settle(act(s, la.action), targets);
}

/** The answer action for the decision that is pending, by `player`. */
const reply = (s: GameState, a: DecisionAnswer) => ({ type: 'answer' as const, player: s.pending!.player, decisionId: s.pending!.id, answer: a });

/** Is there an object of this name in this zone of this player (a creature that died or was exiled is a new object, CR 400.7)? */
const inZone = (s: GameState, zone: 'graveyard' | 'exile' | 'battlefield', player: string, name: string): boolean =>
  (zone === 'exile' || zone === 'battlefield' ? s.zones[zone] : s.zones[zone][player]!).some((id) => s.objects[id]!.defId === name && s.objects[id]!.owner === player);

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['G'] });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['3', '3'], colors: ['R'] });

// ---- CR 614.1c, 614.12a, 607.2d: the land -------------------------------------------------------------------------------------------------------------------------
describe('CR 614.1c, 614.12a, 607.2d: "This land enters tapped. As it enters, choose a color." and "{T}: Add one mana of the chosen color."', () => {
  const HAVEN = card('Test Haven', 'Land', 'This land enters tapped. As it enters, choose a color.\n{T}: Add one mana of the chosen color.');
  it('is compiled to data (a land with no manual ability)', () => {
    expect(manual(HAVEN)).toEqual([]);
    expect(HAVEN.automation.level).toBe('full');
  });
  it('the land is played, its controller chooses a color as it enters, and it enters tapped (one replacement effect with both parts)', () => {
    const s0 = scenario([], { defs: [HAVEN], p1: { hand: ['Test Haven'] } });
    let s = act(s0, { type: 'playLand', player: 'p1', card: find(s0, 'Test Haven', 'hand', 'p1') });
    expect(s.pending?.kind).toBe('chooseColor');
    expect(s.pending!.player).toBe('p1');
    s = answer(s, { kind: 'chooseColor', color: 'R' });
    const land = find(s, 'Test Haven', 'battlefield', 'p1');
    expect(s.objects[land]!.tapped).toBe(true);
    expect(s.pending?.kind).toBe('priority');
  });
  it('once untapped it taps for one mana of the color it chose (CR 607.2d: the linked choice), not of another color', () => {
    const s0 = scenario([], { defs: [HAVEN], p1: { hand: ['Test Haven'] } });
    let s = answer(act(s0, { type: 'playLand', player: 'p1', card: find(s0, 'Test Haven', 'hand', 'p1') }), { kind: 'chooseColor', color: 'U' });
    const land = find(s, 'Test Haven', 'battlefield', 'p1');
    expect(legal(s, 'p1', 'activate').some((a) => a.object === land)).toBe(false); // tapped: nothing to activate
    s = tweak(s, (t) => { t.objects[land]!.tapped = false; });
    const mana = legal(s, 'p1', 'activate').find((a) => a.object === land);
    expect(mana).toBeDefined();
    s = settle(act(s, mana!.action));
    expect(pool(s, 'p1')).toBe('U');
  });
});

// ---- CR 509.1b, 702.111b: the minimum on the blockers --------------------------------------------------------------------------------------------------------------
describe('CR 509.1b, 702.111b: "This creature can\'t be blocked except by three or more creatures."', () => {
  const CERATOPS = card('Test Ceratops', 'Creature — Dinosaur', "This creature can't be blocked except by three or more creatures.", { pt: ['5', '5'], colors: ['G'] });
  const MENACER = card('Test Menacer', 'Creature — Human', 'Menace', { pt: ['3', '3'], colors: ['R'] });
  const board = (blockers: number, attacker = 'Test Ceratops'): { s: GameState; attacker: ObjectId } => {
    const s0 = scenario([], { defs: [CERATOPS, MENACER, OGRE], p1: { battlefield: [attacker] }, p2: { battlefield: Array(blockers).fill('Test Ogre') as string[] } });
    const a = find(s0, attacker, 'battlefield', 'p1');
    return { s: declareAttackers(toDeclareAttackers(s0), [[a]]), attacker: a };
  };
  const toBlockers = (s: GameState): GameState => passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage' || x.turn.step === 'endCombat', 'blockers or damage');
  const ogres = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2');

  it('is compiled to data (full)', () => {
    expect(manual(CERATOPS)).toEqual([]);
    expect(CERATOPS.automation.level).toBe('full');
  });
  it('the decision says it: the attacker needs three blockers (`minBlockers`), and `needsMultiple` lists it too', () => {
    const { s, attacker } = board(3);
    const d = toBlockers(s).pending as DeclareBlockersDecision;
    expect(d.kind).toBe('declareBlockers');
    expect(d.needsMultiple).toEqual([attacker]);
    expect(d.minBlockers).toEqual([{ attacker, min: 3 }]);
  });
  it('one blocker is not enough, two are not enough, three are (the whole declaration is judged, not each blocker)', () => {
    const { s: s0, attacker } = board(3);
    const s = toBlockers(s0);
    const [a, b, c] = ogres(s);
    const blocks = (...ids: ObjectId[]) => reply(s, { kind: 'declareBlockers', blocks: ids.map((blocker) => ({ blocker, attacker })) });
    expect(applyAction(s, blocks(a!)).error?.message).toMatch(/can't be blocked except by three or more creatures/);
    expect(applyAction(s, blocks(a!, b!)).error?.message).toMatch(/three or more/);
    expect(applyAction(s, blocks(a!, b!, c!)).error).toBeUndefined();
    expect(applyAction(s, reply(s, { kind: 'declareBlockers', blocks: [] })).error).toBeUndefined(); // no block at all is always legal
  });
  it('with only two creatures able to block it, the attacker is not offered: no blockers decision is asked and it is unblocked', () => {
    const { s, attacker } = board(2);
    const offered = blockCandidates(s, 'p2');
    expect(offered.candidates.some((c) => c.attackers.includes(attacker))).toBe(false);
    expect(offered.minBlockers).toEqual([]);
    expect(toBlockers(s).pending?.kind).not.toBe('declareBlockers');
  });
  it('menace keeps its two (`needsMultiple` only, no `minBlockers`): the new field is for a minimum above two', () => {
    const { s, attacker } = board(2, 'Test Menacer');
    const d = toBlockers(s).pending as DeclareBlockersDecision;
    expect(d.needsMultiple).toEqual([attacker]);
    expect(d.minBlockers).toBeUndefined();
  });
});

// ---- CR 509.1b, 611.2a: "can't be blocked by creatures with power 2 or less this turn" -----------------------------------------------------------------------------
describe('CR 509.1b, 611.2a: "{1}: This creature can\'t be blocked by creatures with power 2 or less this turn."', () => {
  const OUTRIDER = card('Test Outrider', 'Creature — Elf', "{1}: This creature can't be blocked by creatures with power 2 or less this turn.", { pt: ['3', '3'], colors: ['G'] });
  const setup = (): { s: GameState; attacker: ObjectId; bear: ObjectId; ogre: ObjectId } => {
    const s = scenario([], { defs: [OUTRIDER, BEAR, OGRE], p1: { battlefield: ['Test Outrider', 'Plains'] }, p2: { battlefield: ['Test Bear', 'Test Ogre'] } });
    return { s, attacker: find(s, 'Test Outrider', 'battlefield', 'p1'), bear: find(s, 'Test Bear', 'battlefield', 'p2'), ogre: find(s, 'Test Ogre', 'battlefield', 'p2') };
  };
  const candidates = (s: GameState, attacker: ObjectId): ObjectId[] => (s.pending as DeclareBlockersDecision).candidates.filter((c) => c.attackers.includes(attacker)).map((c) => c.id).sort();
  it('is compiled to data (full)', () => {
    expect(manual(OUTRIDER)).toEqual([]);
    expect(OUTRIDER.automation.level).toBe('full');
  });
  it('before the ability: both creatures may block; after it: the 2/2 may not (power 2 or less), the 3/3 may', () => {
    const { s: s0, attacker, bear, ogre } = setup();
    const plain = passUntil(declareAttackers(toDeclareAttackers(s0), [[attacker]]), (x) => x.pending?.kind === 'declareBlockers', 'blockers');
    expect(candidates(plain, attacker)).toEqual([bear, ogre].sort());
    const s1 = resolve(activate(s0, 'Test Outrider'));
    const s = passUntil(declareAttackers(toDeclareAttackers(s1), [[attacker]]), (x) => x.pending?.kind === 'declareBlockers', 'blockers');
    expect(candidates(s, attacker)).toEqual([ogre]);
    expect(applyAction(s, reply(s, { kind: 'declareBlockers', blocks: [{ blocker: bear, attacker }] })).error?.message).toMatch(/not allowed/i);
    expect(applyAction(s, reply(s, { kind: 'declareBlockers', blocks: [{ blocker: ogre, attacker }] })).error).toBeUndefined();
  });
  it('CR 611.2a: it lasts this turn only; on the next turn of the same player both may block again', () => {
    const { s: s0, attacker, bear, ogre } = setup();
    const s1 = resolve(activate(s0, 'Test Outrider'));
    const next = advanceTo(s1, 3, 'declareAttackers');
    expect(next.turn.activePlayer).toBe('p1');
    const s = passUntil(declareAttackers(next, [[attacker]]), (x) => x.pending?.kind === 'declareBlockers', 'blockers');
    expect(candidates(s, attacker)).toEqual([bear, ogre].sort());
  });
  it('the power is read as blockers are declared: a 1/1 that has been pumped to power 3 may block (CR 509.1b)', () => {
    const { s: s0, attacker, bear, ogre } = setup();
    let s = resolve(activate(s0, 'Test Outrider'));
    s = tweak(s, (t) => { t.objects[bear]!.counters['+1/+1'] = 1; }); // a 3/3 now
    s = passUntil(declareAttackers(toDeclareAttackers(s), [[attacker]]), (x) => x.pending?.kind === 'declareBlockers', 'blockers');
    expect(candidates(s, attacker)).toEqual([bear, ogre].sort());
  });
});

// ---- CR 615.12: damage can't be prevented ---------------------------------------------------------------------------------------------------------------------------
describe('CR 615.12: "Damage can\'t be prevented this turn."', () => {
  const JOKE = card('Test Joke', 'Instant', "Damage can't be prevented this turn. ~ deals 2 damage to target creature.".replace('~', 'Test Joke'), { colors: ['R'] });
  const BOLT = card('Test Spark', 'Instant', 'Test Spark deals 2 damage to target creature.', { colors: ['R'] });
  const SHIELD = card('Test Ward', 'Instant', 'Prevent the next 5 damage that would be dealt to target creature this turn.', { colors: ['W'] });
  const FLAME = card('Test Flame', 'Instant', "Damage can't be prevented this turn. Test Flame deals 3 damage to target player.", { colors: ['R'] });
  const MIST = card('Test Mist', 'Instant', 'Prevent the next 5 damage that would be dealt to any target this turn.', { colors: ['W'] });
  const LOT = [JOKE, BOLT, SHIELD, FLAME, MIST, BEAR];

  it('is compiled to data (full) with the restrictions on every permanent and every player', () => {
    for (const d of [JOKE, FLAME]) { expect(manual(d), d.name).toEqual([]); expect(d.automation.level, d.name).toBe('full'); }
    const json = JSON.stringify(JOKE.faces);
    expect(json).toContain('"action":"preventDamage"');
    expect(json).toContain('"ref":"each","who":"player"');
  });
  it('control: a prevention shield on a creature stops a plain 2 damage spell (the bear survives)', () => {
    let s = scenario([], { defs: LOT, p1: { hand: ['Test Ward', 'Test Spark'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = resolve(cast(s, 'Test Ward', [obj(bear)]));
    s = resolve(cast(s, 'Test Spark', [obj(bear)]));
    expect(inZone(s, 'battlefield', 'p2', 'Test Bear')).toBe(true);
    expect(s.objects[bear]!.damage).toBe(0);
  });
  it('the shield prevents nothing once damage can\'t be prevented: the 2/2 takes 2 damage and dies (the pipeline reads the recipient, CR 615.12)', () => {
    let s = scenario([], { defs: LOT, p1: { hand: ['Test Ward', 'Test Joke'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = resolve(cast(s, 'Test Ward', [obj(bear)]));
    s = resolve(cast(s, 'Test Joke', [obj(bear)]));
    expect(inZone(s, 'graveyard', 'p2', 'Test Bear')).toBe(true);
  });
  it('a player is a recipient too: the shield on a player stops 3 damage, but not after "Damage can\'t be prevented this turn."', () => {
    let a = scenario([], { defs: LOT, p1: { hand: ['Test Mist', 'Test Flame'] } });
    a = resolve(cast(a, 'Test Mist', [{ kind: 'player', id: 'p2' }]));
    a = resolve(cast(a, 'Test Flame', [{ kind: 'player', id: 'p2' }]));
    expect(life(a, 'p2')).toBe(17);
    let b = scenario([], { defs: LOT, p1: { hand: ['Test Mist'] } });
    b = resolve(cast(b, 'Test Mist', [{ kind: 'player', id: 'p2' }]));
    expect(life(b, 'p2')).toBe(20);
  });
  it('CR 611.2a, 615.12: the ruling ends with the turn; the next turn a shield works again', () => {
    let s = scenario([], { defs: LOT, p1: { hand: ['Test Flame'] } });
    s = resolve(cast(s, 'Test Flame', [{ kind: 'player', id: 'p2' }]));
    expect(life(s, 'p2')).toBe(17);
    const records = (x: GameState): number => x.continuousEffects.filter((e) => JSON.stringify(e).includes('preventDamage')).length;
    expect(records(s)).toBe(2); // one on every permanent, one on every player
    s = advanceTo(s, 2, 'main1');
    expect(records(s)).toBe(0);
  });
});

// ---- CR 613.1f, 502.3: the lockdown Aura ----------------------------------------------------------------------------------------------------------------------------
describe('CR 613.1f, 502.3: "Enchanted creature loses all abilities and doesn\'t untap during its controller\'s untap step."', () => {
  const STASIS = card('Test Stasis', 'Enchantment — Aura', "Enchant creature\nWhen Test Stasis enters, tap enchanted creature.\nEnchanted creature loses all abilities and doesn't untap during its controller's untap step.", { colors: ['U'] });
  const FALCON = card('Test Falcon', 'Creature — Bird', 'Flying\nVigilance', { pt: ['2', '2'], colors: ['W'] });
  it('is compiled to data (full)', () => {
    expect(manual(STASIS)).toEqual([]);
    expect(STASIS.automation.level).toBe('full');
  });
  it('the enchanted creature is tapped, has no abilities (no flying, no vigilance) and keeps its +1/+1 counter (layer 6 does not touch layer 7c)', () => {
    let s = scenario([], { defs: [STASIS, FALCON], p1: { hand: ['Test Stasis'] }, p2: { battlefield: [{ name: 'Test Falcon', counters: { '+1/+1': 1 } }] } });
    const falcon = find(s, 'Test Falcon', 'battlefield', 'p2');
    expect(hasKeyword(getChars(s, falcon)!, 'flying')).toBe(true);
    s = resolve(resolve(cast(s, 'Test Stasis', [obj(falcon)]))); // the Aura, then its enters trigger
    expect(s.objects[falcon]!.tapped).toBe(true);
    const c = getChars(s, falcon)!;
    expect(hasKeyword(c, 'flying')).toBe(false);
    expect(hasKeyword(c, 'vigilance')).toBe(false);
    expect(pt(s, falcon)).toBe('3/3');
  });
  it('CR 502.3: it stays tapped through its controller\'s untap step, while an unenchanted creature untaps', () => {
    let s = scenario([], { defs: [STASIS, FALCON, BEAR], p1: { hand: ['Test Stasis'] }, p2: { battlefield: ['Test Falcon', { name: 'Test Bear', tapped: true }] } });
    const falcon = find(s, 'Test Falcon', 'battlefield', 'p2');
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = resolve(cast(s, 'Test Stasis', [obj(falcon)]));
    s = advanceTo(s, 2, 'upkeep'); // p2's turn: the untap step has run
    expect(s.objects[bear]!.tapped).toBe(false);
    expect(s.objects[falcon]!.tapped).toBe(true);
  });
  it('when the Aura leaves, the creature untaps normally again', () => {
    let s = scenario([], { defs: [STASIS, FALCON], p1: { hand: ['Test Stasis'] }, p2: { battlefield: ['Test Falcon'] } });
    const falcon = find(s, 'Test Falcon', 'battlefield', 'p2');
    s = resolve(cast(s, 'Test Stasis', [obj(falcon)]));
    const aura = find(s, 'Test Stasis', 'battlefield', 'p1');
    s = tweak(s, (t) => { t.objects[aura]!.zone = 'graveyard'; t.zones.battlefield = t.zones.battlefield.filter((x) => x !== aura); t.zones.graveyard.p1!.push(aura); });
    s = advanceTo(s, 2, 'upkeep');
    expect(s.objects[falcon]!.tapped).toBe(false);
  });
});

// ---- CR 613: the identity Auras -------------------------------------------------------------------------------------------------------------------------------------
describe('CR 613.1d, 613.1f, 613.4b: "Enchanted creature is a Frog with base power and toughness 1/1. It has defender and loses all other abilities." and the "can\'t attack" form', () => {
  const FROGGER = card('Test Froggish', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature is a Frog with base power and toughness 1/1. It has defender and loses all other abilities.', { colors: ['U'] });
  const SHRINK = card('Test Shrink', 'Enchantment — Aura', "Enchant creature\nEnchanted creature is a Turtle with base power and toughness 0/1. It can't attack and loses all abilities.", { colors: ['U'] });
  const FALCON = card('Test Falcon', 'Creature — Bird', 'Flying\nVigilance', { pt: ['2', '2'], colors: ['W'] });
  it('both are compiled to data (full)', () => {
    for (const d of [FROGGER, SHRINK]) { expect(manual(d), d.name).toEqual([]); expect(d.automation.level, d.name).toBe('full'); }
  });
  it('base power and toughness is layer 7b, counters are 7c: a 2/2 with a +1/+1 counter under the 1/1 Aura is 2/2, and it has defender but no flying or vigilance', () => {
    let s = scenario([], { defs: [FROGGER, FALCON], p1: { hand: ['Test Froggish'] }, p2: { battlefield: [{ name: 'Test Falcon', counters: { '+1/+1': 1 } }] } });
    const falcon = find(s, 'Test Falcon', 'battlefield', 'p2');
    expect(pt(s, falcon)).toBe('3/3');
    s = resolve(cast(s, 'Test Froggish', [obj(falcon)]));
    const c = getChars(s, falcon)!;
    expect(pt(s, falcon)).toBe('2/2'); // base 1/1 (layer 7b), then the counter (layer 7c)
    expect(c.subtypes).toEqual(['Frog']);
    expect(hasKeyword(c, 'defender')).toBe(true);
    expect(hasKeyword(c, 'flying')).toBe(false);
    expect(hasKeyword(c, 'vigilance')).toBe(false);
  });
  it('the 0/1 Turtle: it loses all abilities and can\'t attack (the Aura\'s restriction is not an ability of the creature, so it is not lost), counters still count', () => {
    let s = scenario([], { defs: [SHRINK, FALCON], p1: { hand: ['Test Shrink'] }, p2: { battlefield: [{ name: 'Test Falcon', counters: { '+1/+1': 2 } }] } });
    const falcon = find(s, 'Test Falcon', 'battlefield', 'p2');
    s = resolve(cast(s, 'Test Shrink', [obj(falcon)]));
    expect(pt(s, falcon)).toBe('2/3');
    expect(getChars(s, falcon)!.subtypes).toEqual(['Turtle']);
    expect(hasKeyword(getChars(s, falcon)!, 'flying')).toBe(false);
    // p2's creature may not attack on p2's turn
    s = advanceTo(s, 2, 'declareAttackers');
    const attackers = (s.pending as { candidates?: { id: ObjectId }[] } | undefined)?.candidates?.map((c) => c.id) ?? [];
    expect(attackers).not.toContain(falcon);
  });
});

// ---- CR 105.2, 115.1: color-qualified exile -------------------------------------------------------------------------------------------------------------------------
describe('CR 105.2, 115.1: "Exile target creature or planeswalker that\'s green or blue."', () => {
  const DECREE = card('Test Decree', 'Instant', "Exile target creature or planeswalker that's green or blue.", { colors: ['W'] });
  const MERFOLK = card('Test Merfolk', 'Creature — Merfolk', '', { pt: ['1', '1'], colors: ['U'] });
  const GOLD = card('Test Gold', 'Creature — Elf', '', { pt: ['2', '2'], colors: ['G', 'W'] });
  const defs = [DECREE, BEAR, OGRE, MERFOLK, GOLD];
  it('is compiled to data (full)', () => {
    expect(manual(DECREE)).toEqual([]);
    expect(DECREE.automation.level).toBe('full');
  });
  it('a green creature, a blue creature and a green-white creature are legal targets, a red one is not (a target must match when chosen, CR 115.1, 601.2c)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Decree'] }, p2: { battlefield: ['Test Bear', 'Test Ogre', 'Test Merfolk', 'Test Gold'] } });
    const id = (n: string) => find(s0, n, 'battlefield', 'p2');
    const spell = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Decree', 'hand', 'p1') });
    expect(spell.pending?.kind).toBe('chooseTargets');
    const legalTargets = [...(spell.pending as unknown as { objects: ObjectId[] }).objects].sort();
    expect(legalTargets).toEqual([id('Test Bear'), id('Test Merfolk'), id('Test Gold')].sort());
  });
  it('the blue creature is exiled', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Decree'] }, p2: { battlefield: ['Test Merfolk', 'Test Ogre'] } });
    const merfolk = find(s, 'Test Merfolk', 'battlefield', 'p2');
    s = resolve(cast(s, 'Test Decree', [obj(merfolk)]));
    expect(inZone(s, 'exile', 'p2', 'Test Merfolk')).toBe(true);
    expect(inZone(s, 'battlefield', 'p2', 'Test Ogre')).toBe(true);
  });
});
