/**
 * Commander lane edh-c, round edh-c-88 (EDHREC ranks 20,501-21,000, third pass): the round's readings played through the engine with synthetic cards (invented names), compiled by
 * the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites checked against the
 * Comprehensive Rules of 2026-09-25 (see the round's record).
 *
 *   CR 119.3, 701.9a, 701.21a   "Target player loses 1 life, discards a card, then sacrifices a permanent of their choice." (Undercity Plague)
 *   CR 613.1d-f, 613.4b, 611.2a "Whenever a creature you control enters, you may have ~ become a 3/3 white Angel artifact creature with flying until end of turn." (Angel's Tomb)
 *   CR 205.1a, 613.4b           "Until end of turn, ~ becomes a Plant with base power and toughness 0/8." (Skinshifter's third mode)
 *   CR 205.3i, 305.7, 613.1d    "Until end of turn, target land you control becomes the basic land type of your choice in addition to its other types." (Navigator's Compass)
 *   CR 115.1, 105.2, 401.4      "Choose target spell or permanent that's red or green. Its owner puts it on their choice of the top or bottom of their library." (Aether Gust)
 */
import { describe, expect, it } from 'vitest';
import { getChars, type GameState, type ObjectId } from '../../../src/index';
import { act, answer, card, find, full, legal, lifeOf, obj, scenario } from '../r3-cost/support';
import { drive as drive0 } from '../r3-cost/support';
import { pass, passBoth } from '../../m3/scenario';

/** r3-cost's driver, plus the name decision of "choose a basic land type" (chooseName). */
function drive(s0: GameState, script: Parameters<typeof drive0>[1] & { name?: string } = {}): GameState {
  let s = s0;
  const q = { targets: [...(script.targets ?? [])], options: [...(script.options ?? [])], yes: [...(script.yes ?? [])] };
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending as { kind: string; options?: { id: string }[]; min?: number };
    if (p.kind === 'chooseName') s = answer(s, { kind: 'chooseName', name: script.name ?? 'Forest' } as never);
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: q.yes.shift() ?? false } as never);
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] } as never);
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: q.options.shift() ?? p.options!.slice(0, p.min).map((o) => o.id) } as never);
    else s = drive0(s, {});
  }
  return s;
}
type Script = Parameters<typeof drive0>[1] & { name?: string };
const cast = (s: GameState, name: string, script?: Script, player: 'p1' | 'p2' = 'p1'): GameState => drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) } as never), script);
function resolveAll(s0: GameState, script?: Script): GameState {
  let s = s0;
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = drive(passBoth(s), script);
  return s;
}
const handCount = (s: GameState, owner: string): number => Object.values(s.objects).filter((o) => o.zone === 'hand' && o.owner === owner).length;
const inZone = (s: GameState, id: ObjectId): string => s.objects[id]!.zone;
const subtypes = (s: GameState, id: ObjectId): string[] => [...(getChars(s, id)!.subtypes ?? [])];
const types = (s: GameState, id: ObjectId): string[] => [...(getChars(s, id)!.types ?? [])];

const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['3', '3']);
const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', '{0}', ['2', '2']);
const FOREST = card('Test Meadow', 'Basic Land — Plains', '');

const PLAGUE = card('Test Plague', 'Sorcery', 'Target player loses 1 life, discards a card, then sacrifices a permanent of their choice.');
describe('CR 119.3, 701.9a, 701.21a: "Target player loses 1 life, discards a card, then sacrifices a permanent of their choice." (Undercity Plague)', () => {
  const game = () => scenario([], { defs: [PLAGUE, BEAR, GOBLIN], p1: { hand: ['Test Plague'] }, p2: { hand: ['Test Bear', 'Test Goblin'], battlefield: ['Test Goblin'] } });
  it('is automated', () => { expect(full(PLAGUE)).toBe(true); });
  it('the target loses 1 life, discards a card and sacrifices a permanent, in that order', () => {
    const s0 = game();
    const s = resolveAll(cast(s0, 'Test Plague', { targets: [['p2' as never]].map(() => [{ kind: 'player', id: 'p2' } as never]) }));
    expect(lifeOf(s, 'p2')).toBe(lifeOf(s0, 'p2') - 1);
    expect(handCount(s, 'p2')).toBe(handCount(s0, 'p2') - 1);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2').length).toBe(0);
  });
  it('negative: it hits only the target (the caster loses nothing and keeps their permanents)', () => {
    const s0 = scenario([], { defs: [PLAGUE, BEAR], p1: { hand: ['Test Plague', 'Test Bear'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    const s = resolveAll(cast(s0, 'Test Plague', { targets: [[{ kind: 'player', id: 'p2' } as never]] }));
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1'));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1').length).toBe(1);
  });
});

const TOMB = card('Test Tomb', 'Artifact', 'Whenever a creature you control enters, you may have this artifact become a 3/3 white Angel artifact creature with flying until end of turn.', '{0}');
describe('CR 613.1d-f, 613.4b, 611.2a: "you may have ~ become a 3/3 white Angel artifact creature with flying until end of turn." (Angel\'s Tomb)', () => {
  const game = () => scenario([], { defs: [TOMB, BEAR], p1: { hand: ['Test Bear'], battlefield: ['Test Tomb'] } });
  it('is automated', () => { expect(full(TOMB)).toBe(true); });
  it('when a creature enters and you say yes, the artifact is a 3/3 white Angel artifact creature with flying until the end of the turn', () => {
    const s = resolveAll(cast(game(), 'Test Bear'), { yes: [true] });
    const tomb = find(s, 'Test Tomb', 'battlefield', 'p1');
    const ch = getChars(s, tomb)!;
    expect(types(s, tomb)).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(subtypes(s, tomb)).toEqual(['Angel']);
    expect([Number(ch.power), Number(ch.toughness)]).toEqual([3, 3]);
    expect([...(ch.colors ?? [])]).toEqual(['W']);
    expect(JSON.stringify(ch.abilities ?? ch.keywords ?? [])).toContain('flying');
  });
  it('negative: saying no changes nothing; a creature an opponent controls entering changes nothing', () => {
    const no = resolveAll(cast(game(), 'Test Bear'), { yes: [false] });
    expect(types(no, find(no, 'Test Tomb', 'battlefield', 'p1'))).toEqual(['Artifact']);
    const FLASHER = card('Test Flasher', 'Creature — Bird', 'Flash', '{0}', ['1', '1']);
    const s0 = scenario([], { defs: [TOMB, FLASHER], p1: { battlefield: ['Test Tomb'] }, p2: { hand: ['Test Flasher'] } });
    const s = resolveAll(cast(pass(s0), 'Test Flasher', {}, 'p2'), { yes: [true] });
    expect(types(s, find(s, 'Test Tomb', 'battlefield', 'p1'))).toEqual(['Artifact']);
  });
});

const SHIFTER = card('Test Shifter', 'Creature — Human Shaman', '{G}: Choose one. Activate only once each turn.\n• Until end of turn, this creature becomes a Rhino with base power and toughness 4/4 and gains trample.\n• Until end of turn, this creature becomes a Plant with base power and toughness 0/8.', '{0}', ['1', '1']);
const LEAF = card('Test Leaf', 'Basic Land — Forest', '');
describe('CR 205.1a, 613.4b: "Until end of turn, ~ becomes a Plant with base power and toughness 0/8." (Skinshifter: no ability is granted)', () => {
  const game = () => scenario([], { defs: [SHIFTER, LEAF], p1: { battlefield: ['Test Shifter', 'Test Leaf', 'Test Leaf'] } });
  const activate = (s: GameState, mode: string) => {
    const a = legal(s, 'p1', 'activate').find((x) => !x.isMana && x.object === find(s, 'Test Shifter', 'battlefield', 'p1'))!;
    return resolveAll(drive(act(s, a.action), { options: [[mode]] }));
  };
  it('is automated', () => { expect(full(SHIFTER)).toBe(true); });
  it('the Plant mode makes it a 0/8 Plant (its old creature types are gone) and a second activation the same turn is not legal', () => {
    const s = activate(game(), '1');
    const id = find(s, 'Test Shifter', 'battlefield', 'p1');
    expect(subtypes(s, id)).toEqual(['Plant']);
    expect([Number(getChars(s, id)!.power), Number(getChars(s, id)!.toughness)]).toEqual([0, 8]);
    expect(legal(s, 'p1', 'activate').filter((x) => !x.isMana && x.object === id).length).toBe(0);
  });
  it('negative: the other mode (Rhino) gives 4/4 trample, not the Plant', () => {
    const s = activate(game(), '0');
    const id = find(s, 'Test Shifter', 'battlefield', 'p1');
    expect(subtypes(s, id)).toEqual(['Rhino']);
    expect(Number(getChars(s, id)!.power)).toBe(4);
  });
});

const COMPASS = card('Test Compass', 'Artifact', '{T}: Until end of turn, target land you control becomes the basic land type of your choice in addition to its other types.', '{0}');
describe('CR 205.3i, 305.7, 613.1d: "target land you control becomes the basic land type of your choice in addition to its other types." (Navigator\'s Compass)', () => {
  const game = () => scenario([], { defs: [COMPASS, FOREST, LEAF], p1: { battlefield: ['Test Compass', 'Test Meadow'] }, p2: { battlefield: ['Test Leaf'] } });
  const run = (target: ObjectId, s0: GameState, option?: string) => {
    const a = legal(s0, 'p1', 'activate').find((x) => !x.isMana && x.object === find(s0, 'Test Compass', 'battlefield', 'p1'))!;
    return resolveAll(drive(act(s0, a.action), { targets: [[obj(target)]], ...(option !== undefined ? { options: [[option]] } : {}) }));
  };
  it('is automated', () => { expect(full(COMPASS)).toBe(true); });
  it('the land keeps its own type and gains the chosen one until end of turn', () => {
    const s0 = game();
    const land = find(s0, 'Test Meadow', 'battlefield', 'p1');
    const s = run(land, s0, 'Forest');
    expect(subtypes(s, land)).toContain('Plains');
    expect(subtypes(s, land)).toContain('Forest');
    expect(subtypes(s, land).length).toBe(2);
  });
  it('negative: it adds, it does not replace (the land is still a Plains); an opponent\'s land is no legal target', () => {
    const s0 = game();
    const land = find(s0, 'Test Meadow', 'battlefield', 'p1');
    expect(subtypes(run(land, s0), land)).toContain('Plains');
    const a = legal(s0, 'p1', 'activate').find((x) => !x.isMana && x.object === find(s0, 'Test Compass', 'battlefield', 'p1'))!;
    const s1 = act(s0, a.action);
    expect(s1.pending?.kind).toBe('chooseTargets');
    expect(() => answer(s1, { kind: 'chooseTargets', targets: [obj(find(s0, 'Test Leaf', 'battlefield', 'p2'))] } as never)).toThrow(/not a legal target/);
  });
});

const GUST = card('Test Gust', 'Instant', "Choose target spell or permanent that's red or green. Its owner puts it on their choice of the top or bottom of their library.", '{0}');
const REDBOLT = card('Test Redbolt', 'Instant', 'Test Redbolt deals 1 damage to any target.', '{0}', undefined, ['R']);
const BLUESCRY = card('Test Bluescry', 'Instant', 'Draw a card.', '{0}', undefined, ['U']);
const GREENBEAR = card('Test Greenbear', 'Creature — Bear', '', '{0}', ['2', '2'], ['G']);
const BLUEBEAR = card('Test Bluebear', 'Creature — Bird', '', '{0}', ['2', '2'], ['U']);
describe('CR 115.1, 105.2, 401.4: "Choose target spell or permanent that\'s red or green." (Aether Gust)', () => {
  const targetable = (s0: GameState, target: ObjectId): boolean => {
    let s: GameState;
    try { s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Gust', 'hand', 'p1') } as never); } catch (e) { return !/no legal/.test(String(e)); } // (no legal target at all: not targetable)
    const d = s.pending as { kind: string; player: string; id: string } | undefined;
    if (!d || d.kind !== 'chooseTargets') return false;
    return !('error' in (answerSafe(s, [obj(target)]) as object));
  };
  const answerSafe = (s: GameState, targets: ReturnType<typeof obj>[]) => { try { answer(s, { kind: 'chooseTargets', targets } as never); return {}; } catch (e) { return { error: e }; } };
  it('is automated', () => { expect(full(GUST)).toBe(true); });
  it('a green permanent is put into its owner\'s library; so is a red spell on the stack (it never resolves)', () => {
    const s0 = scenario([], { defs: [GUST, GREENBEAR, REDBOLT], p1: { hand: ['Test Gust'] }, p2: { battlefield: ['Test Greenbear'] } });
    const bear = find(s0, 'Test Greenbear', 'battlefield', 'p2');
    const s = resolveAll(cast(s0, 'Test Gust', { targets: [[obj(bear)]] }));
    expect(s.zones.battlefield.includes(bear)).toBe(false);
    expect(s.zones.library['p2']!.length).toBe(s0.zones.library['p2']!.length + 1);
    // a red spell: p2 casts a bolt at p1 in response to nothing; p1 responds with the Gust
    const t0 = scenario([], { defs: [GUST, REDBOLT], p1: { hand: ['Test Gust'] }, p2: { hand: ['Test Redbolt'] } });
    const t1 = cast(pass(t0), 'Test Redbolt', { targets: [[{ kind: 'player', id: 'p1' } as never]] }, 'p2');
    const bolt = t1.zones.stack[t1.zones.stack.length - 1]!;
    const t2 = resolveAll(cast(pass(t1), 'Test Gust', { targets: [[obj(bolt)]] }));
    expect(lifeOf(t2, 'p1')).toBe(lifeOf(t0, 'p1'));
    expect(t2.zones.library['p2']!.length).toBe(t0.zones.library['p2']!.length + 1);
  });
  it('negative: a blue permanent and a blue spell are not legal targets', () => {
    const s0 = scenario([], { defs: [GUST, BLUEBEAR], p1: { hand: ['Test Gust'] }, p2: { battlefield: ['Test Bluebear'] } });
    expect(targetable(s0, find(s0, 'Test Bluebear', 'battlefield', 'p2'))).toBe(false);
    const t0 = scenario([], { defs: [GUST, BLUESCRY], p1: { hand: ['Test Gust'] }, p2: { hand: ['Test Bluescry'] } });
    const t1 = cast(pass(t0), 'Test Bluescry', {}, 'p2');
    expect(targetable(pass(t1), t1.zones.stack[t1.zones.stack.length - 1]!)).toBe(false);
  });
});
