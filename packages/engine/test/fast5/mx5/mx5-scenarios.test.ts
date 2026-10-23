/**
 * FAST5 MX5: block, activation and untap riders (parser/templates/zz-fast5/mx5.json, the `throughNextUntap` duration, the block limit of
 * statics/hooks.ts#blockSetValid and `ActivatedAbilityDef.anyPlayer`), played through the engine with synthetic cards compiled by the game's default
 * compiler (wordings are invented, design 6.10).
 *
 *   CR 502.3, 611.2a  "It doesn't untap during its controller's next untap step": kept tapped through that untap step only, judged per object at that step
 *                     (a permanent that changed controllers stays tapped during its new controller's next untap step)
 *   CR 502.3, 109.5   "Lands you control don't untap during your next untap step"; "... during that player's next untap step"
 *   CR 603.6a, 201.5  "When ~ enters, tap target creature an opponent controls. That creature ...": "that creature" is the target, never the object itself
 *   CR 509.1b         "~ can't be blocked by more than one creature" (a limit on the set of blockers, checked on the whole declaration)
 *   CR 602.2, 602.2a  "Any player may activate this ability" (the activating player controls the ability: "you" is that player), "but only as a sorcery"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DeclareBlockersDecision, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, legal, life, pass, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** No ability of the card left manual. */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'))
  && (d.automation.faces ?? []).every((f) => f.abilities.every((a) => a.level !== 'manual' && a.manual.length === 0));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const tapped = (s: GameState, id: ObjectId): boolean => s.objects[id]!.tapped;

/** Answer the decisions that come up (costs automatically, `targets` when asked, yes/no with yes); stop at priority. */
function settle(s0: GameState, targets: TargetChoice[] = []): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (s.pending.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else break;
  }
  return s;
}
function resolveAll(s0: GameState, targets: TargetChoice[] = []): GameState {
  let s = s0;
  for (let guard = 0; s.zones.stack.length > 0 && guard < 30; guard++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s, targets);
  return s;
}
const cast = (s0: GameState, name: string, targets: TargetChoice[] = [], player = 'p1'): GameState =>
  resolveAll(settle(act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) }), targets), targets);
const tapAll = (s: GameState, ids: ObjectId[]): GameState => tweak(s, (t) => { for (const id of ids) t.objects[id]!.tapped = true; });

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3']);
const RUINS = card('Test Ruins', 'Land', '{T}: Add {C}.');

describe('CR 502.3, 611.2a: "It doesn\'t untap during its controller\'s next untap step"', () => {
  const CHILL = card('Test Chill', 'Instant', "Tap target creature. It doesn't untap during its controller's next untap step.");
  it('is automated, as a `throughNextUntap` restriction on the target', () => {
    expect(automated(CHILL)).toBe(true);
    const spell = CHILL.faces[0]!.abilities[0]!;
    expect(JSON.stringify(spell)).toContain('"duration":{"d":"throughNextUntap"}');
    expect(JSON.stringify(spell)).toContain('"action":"untapDuringUntapStep"');
  });
  it('the opponent\'s creature stays tapped through their next untap step and untaps in the one after; the record ends with that step', () => {
    const s0 = scenario([], { p1: { hand: ['Test Chill'] }, p2: { battlefield: ['Test Bear'] }, defs: [CHILL, BEAR] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s1 = cast(s0, 'Test Chill', [obj(bear)]);
    expect(tapped(s1, bear)).toBe(true);
    expect(s1.continuousEffects.some((e) => e.duration.d === 'throughNextUntap')).toBe(true);
    const t2 = advanceTo(s1, 2, 'upkeep'); // p2's turn: its untap step kept the bear tapped
    expect(t2.turn.activePlayer).toBe('p2');
    expect(tapped(t2, bear)).toBe(true);
    expect(t2.continuousEffects.some((e) => e.duration.d === 'throughNextUntap')).toBe(false);
    const t4 = advanceTo(t2, 4, 'upkeep'); // p2's next turn: it untaps as usual
    expect(tapped(t4, bear)).toBe(false);
  });
  it('the effect is not ended by another player\'s untap step (its own controller\'s turn comes later)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Chill'], battlefield: ['Test Ogre'] }, defs: [CHILL, OGRE] });
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p1');
    const s1 = cast(s0, 'Test Chill', [obj(ogre)]);
    const t2 = advanceTo(s1, 2, 'upkeep');
    expect(t2.continuousEffects.some((e) => e.duration.d === 'throughNextUntap')).toBe(true); // p2's untap step: not p1's
    const t3 = advanceTo(t2, 3, 'upkeep');
    expect(tapped(t3, ogre)).toBe(true);
    const t5 = advanceTo(t3, 5, 'upkeep');
    expect(tapped(t5, ogre)).toBe(false);
  });
  it('a permanent that changed controllers stays tapped during its NEW controller\'s next untap step (the effect follows the object)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Chill'] }, p2: { battlefield: ['Test Bear'] }, defs: [CHILL, BEAR] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s1 = tweak(cast(s0, 'Test Chill', [obj(bear)]), (t) => { t.objects[bear]!.controller = 'p1'; });
    const t2 = advanceTo(s1, 2, 'upkeep'); // p2's untap step: the bear is p1's now, so it is not that step
    expect(t2.continuousEffects.some((e) => e.duration.d === 'throughNextUntap')).toBe(true);
    const t3 = advanceTo(t2, 3, 'upkeep'); // p1's untap step: kept tapped, then the effect ends
    expect(tapped(t3, bear)).toBe(true);
    expect(t3.continuousEffects.some((e) => e.duration.d === 'throughNextUntap')).toBe(false);
    expect(tapped(advanceTo(t3, 5, 'upkeep'), bear)).toBe(false);
  });
});

describe('CR 502.3, 611.2a: plural subjects, each with its own controller\'s untap step', () => {
  const FROST = card('Test Frost', 'Instant', "Tap up to two target creatures. Those creatures don't untap during their controllers' next untap steps.");
  const BREATH = card('Test Breath', 'Instant', "Tap up to two target creatures. Those creatures don't untap during their controller's next untap step.");
  it('both wordings are automated', () => { expect(automated(FROST)).toBe(true); expect(automated(BREATH)).toBe(true); });
  it('one record per object: each ends in its own controller\'s untap step', () => {
    const s0 = scenario([], { p1: { hand: ['Test Frost'], battlefield: ['Test Ogre'] }, p2: { battlefield: ['Test Bear'] }, defs: [FROST, OGRE, BEAR] });
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p1');
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s1 = cast(s0, 'Test Frost', [obj(ogre), obj(bear)]);
    expect(s1.continuousEffects.filter((e) => e.duration.d === 'throughNextUntap')).toHaveLength(2);
    const t2 = advanceTo(s1, 2, 'upkeep');
    expect(tapped(t2, bear)).toBe(true);
    expect(tapped(t2, ogre)).toBe(true);
    expect(t2.continuousEffects.filter((e) => e.duration.d === 'throughNextUntap')).toHaveLength(1); // the bear's ended, the ogre's waits for p1
    const t3 = advanceTo(t2, 3, 'upkeep');
    expect(tapped(t3, ogre)).toBe(true);
    expect(t3.continuousEffects.filter((e) => e.duration.d === 'throughNextUntap')).toHaveLength(0);
    const t4 = advanceTo(t3, 4, 'upkeep');
    expect(tapped(t4, bear)).toBe(false);
    expect(tapped(advanceTo(t4, 5, 'upkeep'), ogre)).toBe(false);
  });
});

describe('CR 502.3, 109.5: "during your next untap step" and "during that player\'s next untap step"', () => {
  const RECKON = card('Test Reckoning', 'Sorcery', "You gain 1 life. Lands you control don't untap during your next untap step.");
  const SLUMBER = card('Test Slumber', 'Sorcery', "Tap all creatures target player controls. Those creatures don't untap during that player's next untap step.");
  it('both are automated', () => { expect(automated(RECKON)).toBe(true); expect(automated(SLUMBER)).toBe(true); });
  it('your lands stay tapped during your next untap step only (the opponent\'s untap step does not end it)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Reckoning'], battlefield: [{ name: 'Test Ruins', tapped: true }] }, p2: { battlefield: [{ name: 'Test Ruins', tapped: true }] }, defs: [RECKON, RUINS] });
    const mine = find(s0, 'Test Ruins', 'battlefield', 'p1');
    const theirs = find(s0, 'Test Ruins', 'battlefield', 'p2');
    const s1 = cast(s0, 'Test Reckoning');
    const t2 = advanceTo(s1, 2, 'upkeep');
    expect(tapped(t2, theirs)).toBe(false); // not their lands
    const t3 = advanceTo(t2, 3, 'upkeep');
    expect(tapped(t3, mine)).toBe(true);
    expect(tapped(advanceTo(t3, 5, 'upkeep'), mine)).toBe(false);
  });
  it('"that player": the targeted player\'s creatures stay tapped through that player\'s next untap step', () => {
    const s0 = scenario([], { p1: { hand: ['Test Slumber'] }, p2: { battlefield: ['Test Bear', 'Test Ogre'] }, defs: [SLUMBER, BEAR, OGRE] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p2');
    const s1 = cast(s0, 'Test Slumber', [{ kind: 'player', id: 'p2' }]);
    expect(tapped(s1, bear) && tapped(s1, ogre)).toBe(true);
    const t2 = advanceTo(s1, 2, 'upkeep');
    expect(tapped(t2, bear) && tapped(t2, ogre)).toBe(true);
    const t4 = advanceTo(t2, 4, 'upkeep');
    expect(tapped(t4, bear) || tapped(t4, ogre)).toBe(false);
  });
});

describe('CR 603.6a, 201.5: "that creature" after the object\'s own enters trigger is the target', () => {
  const LYNX = card('Test Lynx', 'Creature — Cat', "When this creature enters, tap target creature an opponent controls. That creature doesn't untap during its controller's next untap step.", ['2', '2']);
  it('is automated, and keeps the target tapped through its controller\'s next untap step', () => {
    expect(automated(LYNX)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Lynx'] }, p2: { battlefield: ['Test Bear'] }, defs: [LYNX, BEAR] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s1 = cast(s0, 'Test Lynx', [obj(bear)]);
    expect(tapped(s1, bear)).toBe(true);
    expect(tapped(advanceTo(s1, 2, 'upkeep'), bear)).toBe(true);
    expect(tapped(advanceTo(s1, 4, 'upkeep'), bear)).toBe(false);
  });
});

describe('CR 509.1b: "~ can\'t be blocked by more than one creature"', () => {
  const RHINO = card('Test Rhino', 'Creature — Rhino', "This creature can't be blocked by more than one creature.", ['4', '4']);
  const HORNS = card('Test Horns', 'Artifact — Equipment', "Equipped creature has trample and can't be blocked by more than one creature.\nEquip {1}");
  const GROUND = card('Test Ground', 'Enchantment', "Each creature you control can't be blocked by more than one creature.");
  const blockers = (s: GameState): DeclareBlockersDecision => s.pending as DeclareBlockersDecision;
  const rejected = (f: () => GameState): boolean => { try { f(); return false; } catch (e) { return /rejected|illegal|not allowed/i.test(String(e)); } };
  it('the three wordings are automated', () => { expect(automated(RHINO)).toBe(true); expect(automated(HORNS)).toBe(true); expect(automated(GROUND)).toBe(true); });
  it('one blocker is legal; two blockers are not (the whole declaration is checked)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Rhino'] }, p2: { battlefield: ['Test Bear', 'Test Ogre'] }, defs: [RHINO, BEAR, OGRE] });
    const rhino = find(s0, 'Test Rhino', 'battlefield', 'p1');
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p2');
    const s = passUntil(declareAttackers(toDeclareAttackers(s0), [[rhino]]), (x) => x.pending?.kind === 'declareBlockers', 'the declare blockers decision');
    expect(blockers(s).candidates.some((c) => c.id === bear && c.attackers.includes(rhino))).toBe(true);
    expect(rejected(() => declareBlockers(s, [[bear, rhino], [ogre, rhino]]))).toBe(true);
    const one = declareBlockers(s, [[bear, rhino]]);
    expect(one.combat?.blockers.some((b) => b.id === bear && b.blocking.includes(rhino))).toBe(true);
  });
  it('"each creature you control": a creature of the other player is not limited', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Ground', 'Test Rhino'] }, p2: { battlefield: ['Test Ogre', 'Test Bear'] }, defs: [GROUND, RHINO, OGRE, BEAR] });
    const rhino = find(s0, 'Test Rhino', 'battlefield', 'p1');
    const s = passUntil(declareAttackers(toDeclareAttackers(s0), [[rhino]]), (x) => x.pending?.kind === 'declareBlockers', 'the declare blockers decision');
    expect(rejected(() => declareBlockers(s, [[find(s, 'Test Ogre', 'battlefield', 'p2'), rhino], [find(s, 'Test Bear', 'battlefield', 'p2'), rhino]]))).toBe(true);
  });
});

describe('CR 602.2, 602.2a: "Any player may activate this ability"', () => {
  const HYDRA = card('Test Hydra', 'Creature — Hydra', '{0}: Put a +1/+1 counter on this creature. Any player may activate this ability.', ['1', '1']);
  const FONT = card('Test Font', 'Artifact', '{0}: You gain 1 life. Any player may activate this ability but only as a sorcery.');
  const PLAIN = card('Test Idol', 'Artifact', '{0}: You gain 1 life.');
  it('both are automated', () => { expect(automated(HYDRA)).toBe(true); expect(automated(FONT)).toBe(true); });
  it('the opponent may activate it; the ability resolves for them (a counter on the creature)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Hydra'] }, defs: [HYDRA] });
    const hydra = find(s0, 'Test Hydra', 'battlefield', 'p1');
    const s1 = pass(s0); // p2 has priority in p1's main phase
    expect(s1.pending?.player).toBe('p2');
    const la = legal(s1, 'p2', 'activate').find((a) => a.object === hydra);
    expect(la).toBeDefined();
    const s2 = settle(act(s1, la!.action));
    const onStack = s2.objects[s2.zones.stack[s2.zones.stack.length - 1]!]!;
    expect(onStack.controller).toBe('p2'); // CR 602.2a
    const s3 = resolveAll(s2);
    expect(s3.objects[hydra]!.counters['+1/+1']).toBe(1);
  });
  it('"you" is the activating player; "but only as a sorcery" is read for that player; an ability without the sentence stays its controller\'s', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Font', 'Test Idol'] }, defs: [FONT, PLAIN] });
    const font = find(s0, 'Test Font', 'battlefield', 'p1');
    const idol = find(s0, 'Test Idol', 'battlefield', 'p1');
    const p2prio = pass(s0);
    expect(legal(p2prio, 'p2', 'activate').some((a) => a.object === font)).toBe(false); // not p2's main phase
    expect(legal(p2prio, 'p2', 'activate').some((a) => a.object === idol)).toBe(false); // CR 602.2: only its controller
    const t2 = advanceTo(s0, 2, 'main1');
    expect(t2.pending?.player).toBe('p2');
    const la = legal(t2, 'p2', 'activate').find((a) => a.object === font);
    expect(la).toBeDefined();
    const before = life(t2, 'p2');
    const t3 = resolveAll(settle(act(t2, la!.action)));
    expect(life(t3, 'p2')).toBe(before + 1);
    expect(life(t3, 'p1')).toBe(life(t2, 'p1'));
  });
});
