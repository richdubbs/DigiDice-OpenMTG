/**
 * FAST5X E10: airbend (CR 701.65), played through applyAction with synthetic cards compiled by the game's default compiler (invented wordings, design 6.10).
 * "To airbend, exile those objects. For each card exiled this way, for as long as it remains exiled, its owner may cast it by paying {2} rather than paying its
 * mana cost." (701.65a); "whenever a player airbends" triggers when they exile one or more objects as a result of an instruction to airbend (701.65b).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, ENGINE_CAPABILITIES, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, legal, passBoth, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: cost, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard as never);
}
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

const GUST = card('Test Sudden Gust', 'Instant', 'Airbend target nonland permanent.', '{1}{W}');
const GLIDER = card('Test Glider Monk', 'Creature — Human Monk', 'When this creature enters, airbend up to one other target creature.', '{2}{W}', ['2', '2']);
const OGRE = card('Test Hill Ogre', 'Creature — Ogre', '', '{3}{R}{R}', ['5', '5']);
const FIELD = card('Test Calm Field', 'Enchantment', 'Whenever you airbend, you gain 3 life.', '{W}');
const DEFS = [GUST, GLIDER, OGRE, FIELD];

/** Answer targets and automatic payment until priority. */
function settle(s0: GameState, targets: TargetChoice[]): GameState {
  let s = s0;
  const queue = [...targets];
  while (s.pending && s.pending.kind !== 'priority') {
    const d = s.pending;
    if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: queue.splice(0, typeof d.max === 'number' ? d.max : queue.length) });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return s;
}
const mana = (s: GameState, p: 'p1' | 'p2', ...types: string[]): void => { s.players.find((x) => x.id === p)!.manaPool.push(...types.map((type) => ({ type }) as never)); };
const lifeOf = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const exiled = (s: GameState, name: string): ObjectId | undefined => s.zones.exile.find((id) => s.objects[id]!.defId === name);
const castActions = (s: GameState, p: 'p1' | 'p2', id: ObjectId) => legal(s, p, 'cast').filter((a) => a.object === id);

describe('the capabilities: airbend is an action the engine runs', () => {
  it('action:airbend is advertised and the airbend spells here are fully understood (the synthetic templates are new: experimental caps them at partial)', () => {
    expect(ENGINE_CAPABILITIES.has('action:airbend')).toBe(true);
    for (const d of [GUST, GLIDER]) expect(JSON.stringify(d.faces), d.name).not.toContain('"op":"manual"');
  });
});

describe('CR 701.65a: airbending exiles the permanent; its OWNER may cast it for {2} rather than its mana cost while it stays exiled', () => {
  const start = (): { s: GameState; ogre: ObjectId } => {
    let s = scenario([], { p1: { hand: ['Test Sudden Gust'] }, p2: { battlefield: ['Test Hill Ogre'] }, defs: DEFS });
    const ogre = find(s, 'Test Hill Ogre', 'battlefield', 'p2');
    mana(s, 'p1', 'W', 'W');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Sudden Gust', 'hand', 'p1') }), [obj(ogre)]);
    s = passBoth(s);
    return { s, ogre };
  };
  it('the creature is exiled', () => {
    const { s, ogre } = start();
    expect(s.objects[ogre]).toBeUndefined();
    expect(exiled(s, 'Test Hill Ogre')).toBeDefined();
  });
  it('its owner (the opponent) may cast it with the method airbend for {2}, on their own turn with normal timing; the caster of the airbend may not', () => {
    let { s } = start();
    const card = exiled(s, 'Test Hill Ogre')!;
    expect(castActions(s, 'p1', card)).toEqual([]); // not its owner
    // pass to the opponent's turn, main phase
    while (!(s.turn.activePlayer === 'p2' && s.turn.step === 'main1')) s = act(s, { type: 'pass', player: s.pending!.player });
    expect(castActions(s, 'p2', card), 'no mana: {2} can\'t be paid').toEqual([]);
    mana(s, 'p2', 'C', 'C');
    const acts = castActions(s, 'p2', card);
    expect(acts.map((a) => a.action)).toEqual([{ type: 'cast', player: 'p2', card, method: 'airbend' }]);
    expect(acts[0]!.label).toBe('Cast Test Hill Ogre (airbend)');
    s = settle(act(s, acts[0]!.action), []);
    s = passBoth(s);
    expect(find(s, 'Test Hill Ogre', 'battlefield', 'p2')).toBeDefined();
    expect(s.players.find((x) => x.id === 'p2')!.manaPool).toEqual([]); // {2} paid, not {3}{R}{R}
  });
  it('CR 400.7: once the card leaves exile it is a new object and the permission is gone (back in exile by another effect, no airbend cast)', () => {
    let { s } = start();
    const card = exiled(s, 'Test Hill Ogre')!;
    // a hand-made move to the graveyard and back to exile: a new object without the mark
    s = structuredClone(s);
    const o = s.objects[card]!;
    expect(o.chosen?.['airbent']).toBe(true);
    delete o.chosen;
    while (!(s.turn.activePlayer === 'p2' && s.turn.step === 'main1')) s = act(s, { type: 'pass', player: s.pending!.player });
    mana(s, 'p2', 'C', 'C', 'R', 'R', 'C');
    expect(castActions(s, 'p2', card)).toEqual([]);
  });
});

describe('CR 701.65a, 115.1: "When this creature enters, airbend up to one other target creature."', () => {
  it('up to one: choosing no target exiles nothing', () => {
    let s = scenario([], { p1: { hand: ['Test Glider Monk'] }, p2: { battlefield: ['Test Hill Ogre'] }, defs: DEFS });
    mana(s, 'p1', 'W', 'C', 'C');
    s = passBoth(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Glider Monk', 'hand', 'p1') }), []));
    s = settle(s, []);
    s = passBoth(s);
    expect(find(s, 'Test Hill Ogre', 'battlefield', 'p2')).toBeDefined();
  });
  it('the target is exiled; "other": the monk itself can\'t be chosen', () => {
    let s = scenario([], { p1: { hand: ['Test Glider Monk'] }, p2: { battlefield: ['Test Hill Ogre'] }, defs: DEFS });
    mana(s, 'p1', 'W', 'C', 'C');
    s = passBoth(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Glider Monk', 'hand', 'p1') }), []));
    const monk = find(s, 'Test Glider Monk', 'battlefield', 'p1');
    expect(s.pending).toMatchObject({ kind: 'chooseTargets' });
    const opts = JSON.stringify(s.pending);
    expect(opts).not.toContain(`"${monk}"`);
    s = settle(s, [obj(find(s, 'Test Hill Ogre', 'battlefield', 'p2'))]);
    s = passBoth(s);
    expect(exiled(s, 'Test Hill Ogre')).toBeDefined();
  });
});

describe('CR 701.65b: "whenever you airbend" triggers when you exile one or more objects as a result of an instruction to airbend', () => {
  it('airbending a creature triggers it once', () => {
    let s = scenario([], { p1: { hand: ['Test Sudden Gust'], battlefield: ['Test Calm Field'] }, p2: { battlefield: ['Test Hill Ogre'] }, defs: DEFS });
    const life = lifeOf(s, 'p1');
    mana(s, 'p1', 'W', 'W');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Sudden Gust', 'hand', 'p1') }), [obj(find(s, 'Test Hill Ogre', 'battlefield', 'p2'))]);
    s = passBoth(s); // the spell resolves; the trigger goes on the stack
    s = passBoth(s);
    expect(lifeOf(s, 'p1')).toBe(life + 3);
  });
  it('nothing exiled (the target became illegal): no trigger', () => {
    let s = scenario([], { p1: { hand: ['Test Glider Monk'], battlefield: ['Test Calm Field'] }, defs: DEFS });
    const life = lifeOf(s, 'p1');
    mana(s, 'p1', 'W', 'C', 'C');
    s = passBoth(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Glider Monk', 'hand', 'p1') }), []));
    s = settle(s, []);
    s = passBoth(s);
    expect(lifeOf(s, 'p1')).toBe(life);
  });
});
