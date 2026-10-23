/**
 * p2-pt-2 (lane p2-pt): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by the game's
 * default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 613.4c, 613.1f   "Each creature you control that's a Wolf or a Werewolf gets +1/+1 and has trample": only those kinds, only yours; five kinds after one article
 *   CR 613.4c, 109.4    "All Sliver creatures get +1/+1 for each other Sliver on the battlefield" and "each legendary creature you control gets +1/+1 for each other
 *                       legendary creature you control": each object counts the others, not itself (whether or not ~ is one of them)
 *   CR 613.4c, 301.5    "Equipped creature gets +1/+0 for each Equipment attached to it"; "Each creature you control gets +1/+1 for each +1/+1 counter on it": each
 *                       object's own Equipment or counters
 *   CR 611.2c, 608.2h   "Until end of turn, target creature gains trample and gets +1/+0 for each card you've drawn this turn" and "Until end of turn, creatures you
 *                       control get +1/+1 for each Forest you control and gain trample": the count is locked as the effect begins
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, pass, scenario } from '../../m5/helpers';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** Answer pending decisions (costs, targets, yes to a may, the queued answers) until a player has priority with an empty stack. */
function settle(s0: GameState, answers: DecisionAnswer[] = [], targets: { kind: 'object' | 'player'; id: string }[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; guard < 60 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0); guard++) {
    const d = s.pending;
    if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets as never });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
    else if (queue.length > 0 && queue[0]!.kind === d.kind) s = answer(s, queue.shift()!);
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected decision ${d.kind}: ${d.prompt}`);
  }
  return s;
}
const obj = (id: ObjectId) => ({ kind: 'object' as const, id });
const cast = (s: GameState, name: string, targets: { kind: 'object' | 'player'; id: string }[] = []): GameState =>
  settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), [], targets);
const activate = (s: GameState, source: ObjectId, targets: { kind: 'object' | 'player'; id: string }[] = []): GameState => {
  const a = legalActions(s, s.pending!.player).find((x) => x.kind === 'activate' && x.object === source);
  if (!a) throw new Error('no activation');
  return settle(act(s, a.action), [], targets);
};
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const named = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name);

describe('CR 613.4c, 613.1f: "Each creature you control that\'s a Wolf or a Werewolf gets +1/+1 and has trample" (and five kinds)', () => {
  const PACK = card('Test Pack Call', 'Enchantment', "Each creature you control that's a Wolf or a Werewolf gets +1/+1 and has trample.");
  const GUARD = card('Test Den Guard', 'Creature — Cat', "Each other creature you control that's a Fox, Otter, Rabbit, Mouse, or Bird gets +1/+0 and has first strike.", { pt: ['1', '1'] });
  const WOLF = card('Test Gray Wolf', 'Creature — Wolf', '', { pt: ['2', '2'] });
  const MAN = card('Test Village Man', 'Creature — Human', '', { pt: ['1', '1'] });
  const MOUSE = card('Test Field Mouse', 'Creature — Mouse', '', { pt: ['1', '1'] });
  it('both are automated', () => { expect(full(PACK)).toBe(true); expect(full(GUARD)).toBe(true); });
  it('your Wolf is 3/3 with trample; your Human and the opponent\'s Wolf are unchanged', () => {
    const s = scenario([], { p1: { battlefield: ['Test Pack Call', 'Test Gray Wolf', 'Test Village Man'] }, p2: { battlefield: ['Test Gray Wolf'] }, defs: [PACK, WOLF, MAN] });
    const wolf = find(s, 'Test Gray Wolf', 'battlefield', 'p1');
    expect(pt(s, wolf)).toBe('3/3');
    expect(hasKeyword(getChars(s, wolf)!, 'trample')).toBe(true);
    expect(pt(s, find(s, 'Test Village Man', 'battlefield', 'p1'))).toBe('1/1');
    expect(pt(s, find(s, 'Test Gray Wolf', 'battlefield', 'p2'))).toBe('2/2');
  });
  it('the fifth kind (Mouse) gets +1/+0 and first strike; the source itself does not (other)', () => {
    const s = scenario([], { p1: { battlefield: ['Test Den Guard', 'Test Field Mouse'] }, defs: [GUARD, MOUSE] });
    const mouse = find(s, 'Test Field Mouse', 'battlefield', 'p1');
    expect(pt(s, mouse)).toBe('2/1');
    expect(hasKeyword(getChars(s, mouse)!, 'first strike')).toBe(true);
    expect(pt(s, find(s, 'Test Den Guard', 'battlefield', 'p1'))).toBe('1/1');
  });
});

describe('CR 613.4c, 109.4: "for each other <X>" counted for each object modified', () => {
  const LEGION = card('Test Swarm Lord', 'Legendary Creature — Sliver', 'All Sliver creatures get +1/+1 for each other Sliver on the battlefield.', { pt: ['2', '2'] });
  const SLIVER = card('Test Small Sliver', 'Creature — Sliver', '', { pt: ['1', '1'] });
  const PODIUM = card('Test Hall of Heroes', 'Artifact', 'Each legendary creature you control gets +1/+1 for each other legendary creature you control.');
  const HERO = card('Test Lone Hero', 'Legendary Creature — Human', '', { pt: ['2', '2'] });
  const HERO2 = card('Test Other Hero', 'Legendary Creature — Elf', '', { pt: ['1', '1'] });
  it('both are automated', () => { expect(full(LEGION)).toBe(true); expect(full(PODIUM)).toBe(true); });
  it('three Slivers (the opponent\'s too): each gets +2/+2', () => {
    const s = scenario([], { p1: { battlefield: ['Test Swarm Lord', 'Test Small Sliver'] }, p2: { battlefield: ['Test Small Sliver'] }, defs: [LEGION, SLIVER] });
    expect(pt(s, find(s, 'Test Swarm Lord', 'battlefield', 'p1'))).toBe('4/4');
    for (const id of named(s, 'Test Small Sliver')) expect(pt(s, id)).toBe('3/3');
  });
  it('two legendary creatures you control each get +1/+1 (from the other), the opponent\'s legendary one counts for nobody and gets nothing; ~ is no creature', () => {
    const s = scenario([], { p1: { battlefield: ['Test Hall of Heroes', 'Test Lone Hero', 'Test Other Hero'] }, p2: { battlefield: ['Test Lone Hero'] }, defs: [PODIUM, HERO, HERO2] });
    expect(pt(s, find(s, 'Test Lone Hero', 'battlefield', 'p1'))).toBe('3/3');
    expect(pt(s, find(s, 'Test Other Hero', 'battlefield', 'p1'))).toBe('2/2');
    expect(pt(s, find(s, 'Test Lone Hero', 'battlefield', 'p2'))).toBe('2/2');
  });
});

describe('CR 613.4c, 301.5, 122.1: each object\'s own Equipment or counters', () => {
  const GLOVES = card('Test Iron Gloves', 'Artifact — Equipment', 'Equipped creature gets +1/+0 for each Equipment attached to it.\nEquip {2}');
  const SHIELD = card('Test Plain Shield', 'Artifact — Equipment', 'Equipped creature gets +0/+1.\nEquip {1}');
  const HAILER = card('Test Hailer', 'Creature — Human', 'Each creature you control gets +1/+1 for each +1/+1 counter on it.', { pt: ['1', '1'] });
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  it('both are automated', () => { expect(full(GLOVES)).toBe(true); expect(full(HAILER)).toBe(true); });
  it('a creature with the gloves and a shield gets +2/+1; another creature is unchanged', () => {
    let s = scenario([], { p1: { battlefield: ['Test Iron Gloves', 'Test Plain Shield', 'Test Plain Bear', 'Test Plain Bear'] }, defs: [GLOVES, SHIELD, BEAR] });
    const [bear, other] = named(s, 'Test Plain Bear') as [ObjectId, ObjectId];
    s = structuredClone(s);
    s.objects[find(s, 'Test Iron Gloves', 'battlefield', 'p1')]!.attachedTo = bear;
    s.objects[find(s, 'Test Plain Shield', 'battlefield', 'p1')]!.attachedTo = bear;
    expect(pt(s, bear)).toBe('4/3');
    expect(pt(s, other)).toBe('2/2');
  });
  it('a creature with two +1/+1 counters gets +2/+2 more (6/6); one without counters is unchanged', () => {
    const s = scenario([], { p1: { battlefield: ['Test Hailer', { name: 'Test Plain Bear', counters: { '+1/+1': 2 } }, 'Test Plain Bear'] }, defs: [HAILER, BEAR] });
    const pts = named(s, 'Test Plain Bear').map((id) => pt(s, id)).sort();
    expect(pts).toEqual(['2/2', '6/6']);
    expect(pt(s, find(s, 'Test Hailer', 'battlefield', 'p1'))).toBe('1/1');
  });
});

describe('CR 611.2c, 608.2h: the count of a resolved pump is locked as the effect begins', () => {
  const FISTS = card('Test Burning Fists', 'Instant', "Draw a card. Until end of turn, target creature gains trample and gets +1/+0 for each card you've drawn this turn.");
  const GROVE = card('Test Grove Rally', 'Instant', 'Until end of turn, creatures you control get +1/+1 for each Forest you control and gain trample.');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  it('both are automated (the group form is capped at partial by its experimental template, its effect is still data)', () => {
    expect(full(FISTS)).toBe(true);
    expect(GROVE.automation.level).toBe('partial');
    expect(JSON.stringify(GROVE.faces)).not.toContain('"op":"manual"');
  });
  it('the card drawn by the spell counts (1 on the first turn, no draw step): 3/2 with trample', () => {
    let s = scenario([], { p1: { battlefield: ['Test Plain Bear'], hand: ['Test Burning Fists'] }, defs: [FISTS, BEAR] });
    const bear = find(s, 'Test Plain Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Burning Fists', [obj(bear)]);
    expect(pt(s, bear)).toBe('3/2');
    expect(hasKeyword(getChars(s, bear)!, 'trample')).toBe(true);
  });
  it('two Forests: +2/+2 and trample; a third Forest later changes nothing', () => {
    let s = scenario(['Forest'], { p1: { battlefield: ['Test Plain Bear', 'Forest', 'Forest'], hand: ['Test Grove Rally', 'Forest'] }, defs: [GROVE, BEAR] });
    const bear = find(s, 'Test Plain Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Grove Rally');
    expect(pt(s, bear)).toBe('4/4');
    expect(hasKeyword(getChars(s, bear)!, 'trample')).toBe(true);
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'hand', 'p1') } as never);
    expect(pt(s, bear)).toBe('4/4');
  });
});
