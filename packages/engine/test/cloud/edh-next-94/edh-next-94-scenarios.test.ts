/**
 * Commander top-rank second pass 2, edh-next-94: the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler, each with its negative case. CR cites are from the text of 2026-09-25 where marked "checked", otherwise from memory (unverified).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type Color, type GameState, type ObjectId, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, legal, pass, scenario } from '../../m3/scenario';
import { activate } from '../../m5/cr-examples/helpers';
import { mpScenario } from '../../m12/rules/helpers';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const automated = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const chars = (s: GameState, id: ObjectId) => getChars(s, id);

interface Picks { reverse?: boolean; x?: number[]; yes?: boolean; targets?: TargetChoice[][]; options?: string[][]; objects?: ObjectId[][] }
/** Answer every decision until a player has priority: yes/no by `yes`, targets and options in order, mana automatically. */
function drive(s0: GameState, o: Picks = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  const oq = [...(o.options ?? [])];
  const cq = [...(o.objects ?? [])];
  const xq = [...(o.x ?? [])];
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending as unknown as { kind: string; options?: (ObjectId | { id: string })[]; min?: number; max?: number; items?: { id: string }[] };
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: cq.shift() ?? (p.options as ObjectId[]).slice(0, Math.max(p.min ?? 0, 1)).slice(0, p.max) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: oq.shift() ?? (p.options as { id: string }[]).slice(0, p.min ?? 1).map((x) => x.id) } as never);
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: (o.reverse ? [...p.items!].reverse() : p.items!).map((i) => i.id) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: tq.shift() ?? [] });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: xq.shift() ?? p.min ?? 0 } as never);
    else throw new Error(`unexpected decision ${JSON.stringify(s.pending)}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Picks = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
function castAndResolve(s0: GameState, name: string, o: Picks = {}, mana: string[] = ['C', 'C', 'C']): GameState {
  for (const m of mana) s0.players[0]!.manaPool.push({ type: m } as never);
  return resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), o);
}
const onBf = (s: GameState, name: string, controller: 'p1' | 'p2' | 'p3'): ObjectId[] =>
  s.zones.battlefield.filter((id) => s.objects[id]!.controller === controller && chars(s, id).name === name);
const target = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const pt = (s: GameState, id: ObjectId): [number, number] => [Number(chars(s, id).power), Number(chars(s, id).toughness)];
const hasKeyword = (s: GameState, id: ObjectId, k: string): boolean => chars(s, id).keywords.some((x) => x.keyword === k);


const stackSize = (s: GameState): number => s.zones.stack.length;
const lifeOf = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const dmg = (s: GameState, id: ObjectId): number => Number((s.objects[id] as unknown as { damage?: number }).damage ?? 0);
const gy = (s: GameState, p: 'p1' | 'p2'): number => s.zones.graveyard[p]?.length ?? 0;
const handNames = (s: GameState, p: 'p1' | 'p2'): string[] => (s.zones.hand[p] ?? []).map((id) => chars(s, id).name);
const p2t: TargetChoice = { kind: 'player', id: 'p2' };
void stackSize; void dmg; void gy; void handNames; void hasKeyword; void legal; void advanceTo; void declareAttackers; void toDeclareAttackers; void activate;

describe('CR 701.26a, 608.2c (unverified): "the number of creatures tapped this way" (Angel\'s Trumpet)', () => {
  const TRUMP = card('Test Trumpet', 'Artifact', "At the beginning of each player's end step, tap all untapped creatures that player controls that didn't attack this turn. Test Trumpet deals damage to the player equal to the number of creatures tapped this way.", { cost: '{3}' });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [TRUMP, BEAR];
  it('is automated', () => expect(automated(TRUMP)).toBe(true));
  it('at your end step, each untapped creature that did not attack is tapped and counted: 2 damage to you', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Trumpet', 'Test Bear', 'Test Bear'] }, defs });
    const s = resolveAll(advanceTo(s0, 1, 'end'));
    expect(lifeOf(s, 'p1')).toBe(18);
    for (const id of onBf(s, 'Test Bear', 'p1')) expect(s.objects[id]!.tapped).toBe(true);
  });
  it('NEGATIVE: a creature that was tapped already is not tapped this way, so it is not counted (1 damage, not 2)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Trumpet', 'Test Bear', { name: 'Test Bear', tapped: true }] }, defs });
    const s = resolveAll(advanceTo(s0, 1, 'end'));
    expect(lifeOf(s, 'p1')).toBe(19);
  });
  it('NEGATIVE: the opponent\'s creatures are not tapped or counted at your end step', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Trumpet', 'Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] }, defs });
    const s = resolveAll(advanceTo(s0, 1, 'end'));
    expect(lifeOf(s, 'p1')).toBe(19);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
});

describe('CR 701.26a, 608.2c, 608.2d (unverified): "tap any number of untapped Gates ... draw a card for each Gate tapped this way" (Guild Summit)', () => {
  const SUMMIT = card('Test Summit', 'Enchantment', 'When Test Summit enters, you may tap any number of untapped Wizards you control. Draw a card for each Wizard tapped this way.', { cost: '{2}{U}', colors: ['U'] });
  const WIZ = card('Test Wizard', 'Creature — Human Wizard', '', { pt: ['1', '1'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [SUMMIT, WIZ, BEAR];
  it('is automated', () => expect(automated(SUMMIT)).toBe(true));
  const play = (picks: Picks): GameState => {
    const s0 = scenario([], { p1: { hand: ['Test Summit'], battlefield: ['Test Wizard', 'Test Wizard', 'Test Bear'], library: ['Test Bear', 'Test Bear', 'Test Bear'] }, defs });
    return castAndResolve(s0, 'Test Summit', picks, ['U', 'C', 'C']);
  };
  it('tapping both Wizards draws two cards', () => {
    const s0 = scenario([], { p1: { hand: ['Test Summit'], battlefield: ['Test Wizard', 'Test Wizard', 'Test Bear'], library: ['Test Bear', 'Test Bear', 'Test Bear'] }, defs });
    const ids = onBf(s0, 'Test Wizard', 'p1');
    const s = castAndResolve(s0, 'Test Summit', { objects: [ids] }, ['U', 'C', 'C']);
    expect(handNames(s, 'p1')).toHaveLength(2);
    for (const id of ids) expect(s.objects[id]!.tapped).toBe(true);
  });
  it('NEGATIVE: tapping one Wizard draws one card; the Bear is never offered or tapped', () => {
    const s0 = scenario([], { p1: { hand: ['Test Summit'], battlefield: ['Test Wizard', 'Test Wizard', 'Test Bear'], library: ['Test Bear', 'Test Bear', 'Test Bear'] }, defs });
    const [w1] = onBf(s0, 'Test Wizard', 'p1');
    const s = castAndResolve(s0, 'Test Summit', { objects: [[w1!]] }, ['U', 'C', 'C']);
    expect(handNames(s, 'p1')).toHaveLength(1);
    expect(s.objects[onBf(s, 'Test Bear', 'p1')[0]!]!.tapped).toBe(false);
  });
  it('NEGATIVE: tapping none draws nothing', () => {
    const s = play({ objects: [[]] });
    expect(handNames(s, 'p1')).toHaveLength(0);
  });
});

describe('CR 614.1c, 614.12, 604.2 (unverified): "as long as ~ is tapped, other permanents enter tapped" (Archelos, Lagoon Mystic)', () => {
  const TURTLE = card('Test Turtle', 'Creature — Turtle', 'As long as Test Turtle is tapped, other permanents enter tapped.\nAs long as Test Turtle is untapped, other permanents enter untapped.', { pt: ['2', '2'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{C}' });
  const COVE = card('Test Cove', 'Land', 'Test Cove enters tapped.');
  const defs = [TURTLE, BEAR, COVE];
  it('is automated', () => expect(automated(TURTLE)).toBe(true));
  const cast = (turtleTapped: boolean): GameState => {
    const s0 = scenario([], { p1: { hand: ['Test Bear'], battlefield: [{ name: 'Test Turtle', tapped: turtleTapped }] }, defs });
    return castAndResolve(s0, 'Test Bear', {}, ['C']);
  };
  it('tapped: another permanent enters tapped', () => expect(s_tapped(cast(true), 'Test Bear')).toBe(true));
  it('NEGATIVE: untapped: another permanent enters untapped', () => expect(s_tapped(cast(false), 'Test Bear')).toBe(false));
  it('untapped: a permanent that would enter tapped enters untapped', () => {
    const s0 = scenario([], { p1: { hand: ['Test Cove'], battlefield: ['Test Turtle'] }, defs });
    let s = act(s0, { type: 'playLand', player: 'p1', card: find(s0, 'Test Cove', 'hand', 'p1') });
    // CR 616.1: the land's own "enters tapped" is applied first, then the Turtle's "enters untapped" (the player orders them; the other order leaves it tapped)
    const d = s.pending as unknown as { kind: string; options: { id: string }[] };
    expect(d.kind).toBe('chooseReplacement');
    s = resolveAll(answer(s, { kind: 'chooseReplacement', id: d.options.find((o) => o.id.startsWith('self:'))!.id } as never));
    expect(s_tapped(s, 'Test Cove')).toBe(false);
  });
  it('NEGATIVE: with no Turtle the land enters tapped as printed', () => {
    const s0 = scenario([], { p1: { hand: ['Test Cove'] }, defs });
    const s = act(s0, { type: 'playLand', player: 'p1', card: find(s0, 'Test Cove', 'hand', 'p1') });
    expect(s_tapped(s, 'Test Cove')).toBe(true);
  });
  function s_tapped(s: GameState, name: string): boolean { return s.objects[onBf(s, name, 'p1')[0]!]!.tapped; }
});

describe('CR 613.4b, 611.2a (unverified): "you may have the base power and toughness of other creatures you control become equal to ~\'s" (Tanazir Quandrix)', () => {
  const DRAKE = card('Test Drake', 'Creature — Dragon', "Whenever Test Drake attacks, you may have the base power and toughness of other creatures you control become equal to Test Drake's power and toughness until end of turn.", { pt: ['5', '6'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [DRAKE, BEAR];
  it('is automated', () => expect(automated(DRAKE)).toBe(true));
  const attack = (yes: boolean): GameState => {
    const s0 = scenario([], { p1: { battlefield: ['Test Drake', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] }, defs });
    const s1 = advanceTo(s0, 1, 'beginCombat');
    const s2 = toDeclareAttackers(s1);
    return resolveAll(declareAttackers(s2, [[find(s2, 'Test Drake', 'battlefield', 'p1')]]), { yes });
  };
  it('your other creatures become 5/6; the opponent\'s Bear stays 2/2', () => {
    const s = attack(true);
    expect(pt(s, onBf(s, 'Test Bear', 'p1')[0]!)).toEqual([5, 6]);
    expect(pt(s, onBf(s, 'Test Bear', 'p2')[0]!)).toEqual([2, 2]);
  });
  it('the value is fixed as the effect resolves (ruling 2021-04-16): a later pump of the Drake does not change the Bears', () => {
    const PUMP = card('Test Pump', 'Instant', 'Target creature gets +2/+2 until end of turn.', { cost: '{C}' });
    const d2 = [DRAKE, BEAR, PUMP];
    const s0 = scenario([], { p1: { battlefield: ['Test Drake', 'Test Bear'], hand: ['Test Pump'] }, p2: { battlefield: ['Test Bear'] }, defs: d2 });
    const s1 = toDeclareAttackers(advanceTo(s0, 1, 'beginCombat'));
    let s = resolveAll(declareAttackers(s1, [[find(s1, 'Test Drake', 'battlefield', 'p1')]]), { yes: true });
    expect(s.pending?.kind).toBe('priority');
    s.players[0]!.manaPool.push({ type: 'C' } as never);
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Pump', 'hand', 'p1') }), { targets: [[target(find(s, 'Test Drake', 'battlefield', 'p1'))]] });
    expect(pt(s, find(s, 'Test Drake', 'battlefield', 'p1'))).toEqual([7, 8]);
    expect(pt(s, onBf(s, 'Test Bear', 'p1')[0]!)).toEqual([5, 6]);
  });
  it('NEGATIVE: declining ("may") changes nothing', () => {
    const s = attack(false);
    expect(pt(s, onBf(s, 'Test Bear', 'p1')[0]!)).toEqual([2, 2]);
  });
});

describe('CR 110.2, 608.2c, 701.12 (unverified): "if you control neither creature" after an exchange of control (Modify Memory)', () => {
  const MEM = card('Test Memory', 'Sorcery', 'Exchange control of two target creatures controlled by different players. If you control neither creature, draw three cards.', { cost: '{4}{U}', colors: ['U'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['3', '3'] });
  const defs = [MEM, BEAR, OGRE];
  it('is automated', () => expect(automated(MEM)).toBe(true));
  it('exchanging your creature with an opponent\'s: you still control one of them, so you draw nothing', () => {
    const s0 = scenario([], { p1: { hand: ['Test Memory'], battlefield: ['Test Bear'], library: ['Test Ogre', 'Test Ogre', 'Test Ogre'] }, p2: { battlefield: ['Test Ogre'] }, defs });
    const s = castAndResolve(s0, 'Test Memory', { targets: [[target(onBf(s0, 'Test Bear', 'p1')[0]!), target(onBf(s0, 'Test Ogre', 'p2')[0]!)]] }, ['U', 'C', 'C', 'C', 'C']);
    expect(onBf(s, 'Test Ogre', 'p1')).toHaveLength(1);
    expect(handNames(s, 'p1')).toHaveLength(0);
  });
  // played with three players (test/m12/rules/helpers.ts#mpScenario): two creatures of two OTHER players, you control neither
  it('exchanging creatures of two other players: you control neither, so you draw three cards', () => {
    const s0 = mpScenario({ players: 3, defs, zones: { p1: { hand: ['Test Memory'] }, p2: { battlefield: ['Test Bear'] }, p3: { battlefield: ['Test Ogre'] } } });
    const s = castAndResolve(s0, 'Test Memory', { targets: [[target(onBf(s0, 'Test Bear', 'p2')[0]!), target(onBf(s0, 'Test Ogre', 'p3')[0]!)]] }, ['U', 'C', 'C', 'C', 'C']);
    expect(onBf(s, 'Test Ogre', 'p2')).toHaveLength(1);
    expect(onBf(s, 'Test Bear', 'p3')).toHaveLength(1);
    expect(handNames(s, 'p1')).toHaveLength(handNames(s0, 'p1').length - 1 + 3); // the spell left the hand, three cards were drawn
  });
  // KNOWN LIMIT (reviewer, recorded): an illegal target (shroud given to your own creature in response) is dropped from `is: target`, so "neither creature" is read over the legal one only
  it('the condition is "not (any creature of the two targets is controlled by you)"', () => {
    const j = JSON.stringify(MEM.faces);
    expect(j).toContain('"cond":"not","of":{"cond":"exists","of":{"ref":"each","filter":{"is":{"ref":"target","id":"t0"},"controller":"you"}}}');
  });
});
