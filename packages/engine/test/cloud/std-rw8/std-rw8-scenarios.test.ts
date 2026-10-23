/**
 * Card wave 2 round std-rw8 (slice s8): the readings this round added, played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names and wordings, design 6.10). Each test is named after the rule it checks, with its negative case (CR cites from memory, unverified: rules/cr/ is
 * not in the cloud checkout).
 *
 *   CR 603.12, 608.2h, 118.12   "You may sacrifice another creature. When you do, ~ deals damage equal to that creature's power to another target creature.": the
 *                               reflexive trigger reads the sacrificed creature's power as it last existed; declined, nothing happens
 *   CR 120.4a, 120.10, 701.47a  "If excess damage was dealt this way, amass Goblins X, where X is that excess damage." after that damage: only excess damage amasses
 *   CR 118.12, 603.12           "You may sacrifice an artifact or discard a nonland card. When you do, ...": either payment makes the reflexive trigger; neither does not
 *   CR 601.2b, 602.2b, 118.3    "{1}, {T}, Sacrifice an artifact or discard a nonland card: ...": either cost pays for the activation; with neither payable it can't be
 *                               activated
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, legal, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';

/** Answer the decisions that come up until priority (payments automatic; targets in order, a player id for a player; other choices the first allowed, or `yes`). */
function drive(s0: GameState, targets: string[][] = [], yes = true): GameState {
  let s = s0;
  const q = [...targets];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (q.shift() ?? []).map((id) => (id === 'p1' || id === 'p2' ? { kind: 'player' as const, id } : { kind: 'object' as const, id })) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.filter((o) => o.disabled === undefined).slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, Math.max(p.min, 1)) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, targets?: string[][], yes = true): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), targets, yes);
  return s;
}
const cast = (s: GameState, name: string, targets?: string[][], yes = true): GameState =>
  resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), targets, yes), targets, yes);
const onField = (s: GameState, name: string, p: 'p1' | 'p2'): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]?.name === name && s.objects[id]!.controller === p);
const armies = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && (getChars(s, id).subtypes ?? []).includes('Army'));

const RAVAGER = card('Test Ravager', 'Creature — Goblin Soldier', "When this creature enters, you may sacrifice another creature. When you do, this creature deals damage equal to that creature's power to another target creature. If excess damage was dealt this way, amass Goblins X, where X is that excess damage.", { pt: ['3', '3'] });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['4', '4'] });
const BANNER = card('Test War Banner', 'Enchantment', 'Ogres you control get +1/+0.');
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const WURM = card('Test Wurm', 'Creature — Wurm', '', { pt: ['6', '6'] });
const GUNNER = card('Test Gunner', 'Creature — Human Assassin', 'When this creature enters, you may sacrifice an artifact or discard a nonland card. When you do, this creature deals 2 damage to any target.', { pt: ['2', '2'] });
const MARKSMAN = card('Test Marksman', 'Creature — Human Assassin', '{1}, {T}, Sacrifice an artifact or discard a nonland card: This creature deals 2 damage to any target.', { pt: ['2', '2'] });
const RELIC = card('Test Relic', 'Artifact', '');
const BOLT = card('Test Spark', 'Instant', 'Test Spark deals 1 damage to any target.');
const DEFS = [RAVAGER, OGRE, BANNER, BEAR, WURM, GUNNER, MARKSMAN, RELIC, BOLT];

describe('std-rw8 cards compile fully', () => {
  it('the synthetic cards of these scenarios are fully automated', () => {
    for (const d of [RAVAGER, GUNNER, MARKSMAN, BANNER]) expect(full(d), d.name).toBe(true);
  });
});

describe('CR 603.12, 608.2h, 118.12: "When you do, ~ deals damage equal to that creature\'s power" reads the sacrificed creature as it last existed', () => {
  it('the Ogre (4/4, 5/4 with the banner) is sacrificed: 5 damage to the Wurm, the power it had on the battlefield; no excess, no Army', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Ravager'], battlefield: ['Test Ogre', 'Test War Banner'] }, p2: { battlefield: ['Test Wurm'] } });
    const wurm = find(s0, 'Test Wurm', 'battlefield', 'p2');
    const s = cast(s0, 'Test Ravager', [[wurm]]);
    expect(onField(s, 'Test Ogre', 'p1')).toHaveLength(0);
    expect(s.objects[wurm]!.damage).toBe(5);
    expect(armies(s)).toHaveLength(0);
  });
  it('the option declined: nothing is sacrificed, no reflexive trigger, no damage', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Ravager'], battlefield: ['Test Ogre'] }, p2: { battlefield: ['Test Wurm'] } });
    const wurm = find(s0, 'Test Wurm', 'battlefield', 'p2');
    const s = cast(s0, 'Test Ravager', [[wurm]], false);
    expect(onField(s, 'Test Ogre', 'p1')).toHaveLength(1);
    expect(s.objects[wurm]!.damage).toBe(0);
  });
});

describe('CR 120.4a, 120.10, 701.47a: "If excess damage was dealt this way, amass Goblins X, where X is that excess damage."', () => {
  it('4 damage to a 2/2: 2 excess, a Goblin Army with two +1/+1 counters', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Ravager'], battlefield: ['Test Ogre'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s = cast(s0, 'Test Ravager', [[bear]]);
    expect(onField(s, 'Test Bear', 'p2')).toHaveLength(0);
    const army = armies(s);
    expect(army).toHaveLength(1);
    expect(s.objects[army[0]!]!.counters['+1/+1']).toBe(2);
    expect(getChars(s, army[0]!).subtypes).toContain('Goblin');
  });
  it('4 damage to a 6/6: no excess, no Army', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Ravager'], battlefield: ['Test Ogre'] }, p2: { battlefield: ['Test Wurm'] } });
    const s = cast(s0, 'Test Ravager', [[find(s0, 'Test Wurm', 'battlefield', 'p2')]]);
    expect(armies(s)).toHaveLength(0);
  });
});

describe('CR 118.12, 603.12: "You may sacrifice an artifact or discard a nonland card. When you do, ..." waits for either payment', () => {
  it('with no artifact, the nonland card is discarded and the reflexive trigger deals 2 damage', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Gunner', 'Test Spark'] } });
    const s = cast(s0, 'Test Gunner', [['p2']]);
    expect(s.zones.graveyard.p1!.map((id) => s.defs[s.objects[id]!.defId]!.name)).toEqual(['Test Spark']);
    expect(life(s, 'p2')).toBe(18);
  });
  it('with an artifact, sacrificing it makes the trigger too', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Gunner'], battlefield: ['Test Relic'] } });
    const s = cast(s0, 'Test Gunner', [['p2']]);
    expect(onField(s, 'Test Relic', 'p1')).toHaveLength(0);
    expect(life(s, 'p2')).toBe(18);
  });
  it('both declined: nothing is paid and no damage is dealt', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Gunner', 'Test Spark'], battlefield: ['Test Relic'] } });
    const s = cast(s0, 'Test Gunner', [['p2']], false);
    expect(onField(s, 'Test Relic', 'p1')).toHaveLength(1);
    expect(s.zones.hand.p1).toHaveLength(1);
    expect(life(s, 'p2')).toBe(20);
  });
});

describe('CR 601.2b, 602.2b, 118.3: "{1}, {T}, Sacrifice an artifact or discard a nonland card: ..." (one cost part, a choice between two costs)', () => {
  const marksman = (s: GameState) => legal(s, 'p1', 'activate').filter((a) => a.object === find(s, 'Test Marksman', 'battlefield', 'p1'));
  it('with only a nonland card in hand, the activation discards it and deals 2 damage', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Spark'], battlefield: ['Test Marksman', 'Plains'] } });
    const acts = marksman(s0);
    expect(acts).toHaveLength(1);
    const s = resolveAll(drive(act(s0, acts[0]!.action), [['p2']]), [['p2']]);
    expect(s.zones.hand.p1).toHaveLength(0);
    expect(life(s, 'p2')).toBe(18);
  });
  it('with an artifact and no nonland card, the artifact is sacrificed', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Plains'], battlefield: ['Test Marksman', 'Plains', 'Test Relic'] } });
    const s = resolveAll(drive(act(s0, marksman(s0)[0]!.action), [['p2']]), [['p2']]);
    expect(onField(s, 'Test Relic', 'p1')).toHaveLength(0);
    expect(s.zones.hand.p1).toHaveLength(1);
    expect(life(s, 'p2')).toBe(18);
  });
  it('with neither an artifact nor a nonland card (only a land card in hand), it can\'t be activated', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Plains'], battlefield: ['Test Marksman', 'Plains'] } });
    expect(marksman(s0)).toHaveLength(0);
  });
});
