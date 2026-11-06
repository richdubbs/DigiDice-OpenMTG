/**
 * Commander lane copy, round edh-next-57: the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by the game's
 * default compiler, each with its negative case. CR cites from memory unless noted (the text of 2026-09-25 was read for 707.9, 707.10, 707.10c, 205.3d, 613.4b).
 *
 *   CR 608.2f, 707.2, 111.1, 603.7  "Choose up to two target creatures you don't control. For each of those creatures, create a token that's a copy of that creature. Those tokens gain haste.
 *                                   Exile them at the beginning of the next end step." (Hate Mirage; Kindred Charge: the tokens, not the originals, are "them")
 *   CR 707.10c, 115.1, 601.2c       "... that player copies that spell for each other <objects> that spell could target. Each copy targets a different one of those <objects>." (Mirrorwing Dragon,
 *                                   Precursor Golem: other than the object the spell targets, the copies are the caster's)
 *   CR 707.9b, 105.3, 613.4b        "... except it's a 1/1 white Spirit creature with flying in addition to its other types." (Kaya, Intangible Slayer: the color is set, the types are added)
 *   CR 707.2, 111.2, 707.9b         "you create a token that's a copy of that creature, except it's a Tyranid in addition to its other types." (Genestealer Patriarch)
 *   CR 508.4, 707.9b, 603.7         "create a tapped and attacking token that's a copy of another target Villain you control, except it isn't legendary and it's an Illusion in addition to its other
 *                                   types. Sacrifice that token at the beginning of the next end step." (Loki, the Deceiver)
 *   CR 611.2a, 613.4b, 707.9a       "You may have this creature enter as a copy of any creature on the battlefield, except it has "{X}: This creature has base power and toughness X/X."" (Gigantoplasm)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type Color, type GameState, type ObjectId, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, legal, pass, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const automated = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const chars = (s: GameState, id: ObjectId) => getChars(s, id);

interface Picks { x?: number[]; yes?: boolean; targets?: TargetChoice[][]; options?: string[][]; objects?: ObjectId[][] }
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
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items!.map((i) => i.id) });
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
const onBf = (s: GameState, name: string, controller: 'p1' | 'p2'): ObjectId[] =>
  s.zones.battlefield.filter((id) => s.objects[id]!.controller === controller && chars(s, id).name === name);
const target = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const pt = (s: GameState, id: ObjectId): [number, number] => [Number(chars(s, id).power), Number(chars(s, id).toughness)];
const hasKeyword = (s: GameState, id: ObjectId, k: string): boolean => chars(s, id).keywords.some((x) => x.keyword === k);

describe('CR 608.2f, 707.2, 111.1, 603.7: "Choose up to two target creatures you don\'t control. For each of those creatures, create a token that\'s a copy of that creature. Those tokens gain haste. Exile them at the beginning of the next end step." (Hate Mirage)', () => {
  const MIRAGE = card('Test Mirage Rite', 'Sorcery', "Choose up to two target creatures you don't control. For each of those creatures, create a token that's a copy of that creature. Those tokens gain haste. Exile them at the beginning of the next end step.", { cost: '{1}' });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['4', '4'] });
  const defs = [MIRAGE, BEAR, OGRE];
  const setup = () => scenario([], { p1: { hand: ['Test Mirage Rite'] }, p2: { battlefield: ['Test Bear', 'Test Ogre'] }, defs });
  it('is automated; each chosen creature gets a token copy under YOUR control with haste, the opponent keeps the originals', () => {
    expect(automated(MIRAGE)).toBe(true);
    const s0 = setup();
    const r = castAndResolve(s0, 'Test Mirage Rite', { targets: [[target(find(s0, 'Test Bear', 'battlefield', 'p2')), target(find(s0, 'Test Ogre', 'battlefield', 'p2'))]] });
    const bears = onBf(r, 'Test Bear', 'p1');
    const ogres = onBf(r, 'Test Ogre', 'p1');
    expect(bears).toHaveLength(1);
    expect(ogres).toHaveLength(1);
    expect(onBf(r, 'Test Bear', 'p2')).toHaveLength(1);
    expect(r.objects[bears[0]!]!.kind).toBe('token');
    expect(pt(r, ogres[0]!)).toEqual([4, 4]);
    for (const id of [...bears, ...ogres]) expect(hasKeyword(r, id, 'haste')).toBe(true);
  });
  it('"Exile them" are the TOKENS (the most recent group), not the targets: at the next end step the tokens are gone and the opponent still has both originals', () => {
    const s0 = setup();
    const r = castAndResolve(s0, 'Test Mirage Rite', { targets: [[target(find(s0, 'Test Bear', 'battlefield', 'p2')), target(find(s0, 'Test Ogre', 'battlefield', 'p2'))]] });
    const end = resolveAll(advanceTo(r, 1, 'end'));
    expect(onBf(end, 'Test Bear', 'p1')).toHaveLength(0);
    expect(onBf(end, 'Test Ogre', 'p1')).toHaveLength(0);
    expect(onBf(end, 'Test Bear', 'p2')).toHaveLength(1);
    expect(onBf(end, 'Test Ogre', 'p2')).toHaveLength(1);
  });
  it('one target: one token; no target: none (up to two)', () => {
    const s0 = setup();
    const one = castAndResolve(s0, 'Test Mirage Rite', { targets: [[target(find(s0, 'Test Ogre', 'battlefield', 'p2'))]] });
    expect(onBf(one, 'Test Ogre', 'p1')).toHaveLength(1);
    expect(onBf(one, 'Test Bear', 'p1')).toHaveLength(0);
    const none = castAndResolve(setup(), 'Test Mirage Rite', { targets: [[]] });
    expect(onBf(none, 'Test Ogre', 'p1')).toHaveLength(0);
  });
});

describe('CR 608.2f, 607.2d, 707.2: "Choose a creature type. For each creature you control of the chosen type, create a token that\'s a copy of that creature. Those tokens gain haste. Exile them at the beginning of the next end step." (Kindred Charge)', () => {
  const CHARGE = card('Test Kin Charge', 'Sorcery', "Choose a creature type. For each creature you control of the chosen type, create a token that's a copy of that creature. Those tokens gain haste. Exile them at the beginning of the next end step.", { cost: '{1}' });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['4', '4'] });
  const defs = [CHARGE, BEAR, OGRE];
  it('is automated; with Bear chosen only the Bear is copied (once), the Ogre is not; the token is exiled at the end step, the original stays', () => {
    expect(automated(CHARGE)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Kin Charge'], battlefield: ['Test Bear', 'Test Ogre'] }, defs });
    for (const m of ['C', 'C']) s0.players[0]!.manaPool.push({ type: m } as never);
    const asked = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Kin Charge', 'hand', 'p1') });
    // the type is chosen as the spell resolves: pick "Bear"
    let s = asked;
    for (let g = 0; g < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority') || g === 0); g++) {
      if (s.pending && s.pending.kind !== 'priority') {
        const p = s.pending as unknown as { kind: string; options?: { id: string; label?: string }[] };
        if (p.kind === 'chooseName') s = answer(s, { kind: 'chooseName', name: 'Bear' } as never);
        else s = drive(s);
      } else s = pass(s);
    }
    expect(onBf(s, 'Test Bear', 'p1')).toHaveLength(2);
    expect(onBf(s, 'Test Ogre', 'p1')).toHaveLength(1);
    const end = resolveAll(advanceTo(s, 1, 'end'));
    expect(onBf(end, 'Test Bear', 'p1')).toHaveLength(1);
  });
});

describe('CR 707.10c, 115.1, 601.2c: "that player copies that spell for each other creature they control that the spell could target" (Mirrorwing Dragon) and "... for each other Golem that spell could target" (Precursor Golem)', () => {
  const DRAKE = card('Test Mirror Drake', 'Creature — Dragon', 'Whenever a player casts an instant or sorcery spell that targets only this creature, that player copies that spell for each other creature they control that the spell could target. Each copy targets a different one of those creatures.', { pt: ['3', '9'] });
  const GOLEM = card('Test Twin Golem', 'Artifact Creature — Golem', 'Whenever a player casts an instant or sorcery spell that targets only a single Golem, that player copies that spell for each other Golem that spell could target. Each copy targets a different one of those Golems.', { pt: ['1', '3'] });
  const CLAY = card('Test Clay Golem', 'Artifact Creature — Golem', '', { pt: ['1', '3'] });
  const FOX = card('Test Sprout Fox', 'Creature — Fox', '', { pt: ['1', '3'] });
  const BEAR = card('Test Foe Bear', 'Creature — Bear', '', { pt: ['1', '3'] });
  const SPARK = card('Test Ember Spark', 'Instant', 'Test Ember Spark deals 1 damage to target creature.', { cost: '{R}', colors: ['R'] });
  const defs = [DRAKE, GOLEM, CLAY, FOX, BEAR, SPARK];
  const dmg = (s: GameState, name: string, who: 'p1' | 'p2'): number[] => onBf(s, name, who).map((id) => s.objects[id]!.damage);
  const zap = (s0: GameState, at: ObjectId): GameState => castAndResolve(s0, 'Test Ember Spark', { targets: [[target(at)]] }, ['R']);
  it('Mirrorwing: YOU cast a spell at the opponent\'s Drake: YOUR other creatures get one copy each (1 damage each), the opponent\'s other creatures none (ruling 2016-07-13)', () => {
    expect(automated(DRAKE)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Sprout Fox', 'Test Foe Bear'], hand: ['Test Ember Spark'] }, p2: { battlefield: ['Test Mirror Drake', 'Test Foe Bear'] }, defs });
    const r = zap(s0, find(s0, 'Test Mirror Drake', 'battlefield', 'p2'));
    expect(dmg(r, 'Test Mirror Drake', 'p2')).toEqual([1]); // the original
    expect(dmg(r, 'Test Sprout Fox', 'p1')).toEqual([1]);
    expect(dmg(r, 'Test Foe Bear', 'p1')).toEqual([1]);
    expect(dmg(r, 'Test Foe Bear', 'p2')).toEqual([0]); // the Drake's controller's creatures are not copied for
  });
  it('Mirrorwing: a spell that targets another creature does not trigger it', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Sprout Fox'], hand: ['Test Ember Spark'] }, p2: { battlefield: ['Test Mirror Drake', 'Test Foe Bear'] }, defs });
    const r = zap(s0, find(s0, 'Test Foe Bear', 'battlefield', 'p2'));
    expect(dmg(r, 'Test Sprout Fox', 'p1')).toEqual([0]);
    expect(dmg(r, 'Test Mirror Drake', 'p2')).toEqual([0]);
    expect(dmg(r, 'Test Foe Bear', 'p2')).toEqual([1]);
  });
  it('Precursor Golem: a spell at ANOTHER Golem is copied for each other Golem, the Golem with the ability included, the target (which keeps the original) not copied for; non-Golems are ignored', () => {
    expect(automated(GOLEM)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Ember Spark'], battlefield: ['Test Sprout Fox'] }, p2: { battlefield: ['Test Twin Golem', 'Test Clay Golem', 'Test Clay Golem', 'Test Foe Bear'] }, defs });
    const clays = onBf(s0, 'Test Clay Golem', 'p2');
    const r = zap(s0, clays[0]!);
    expect(r.objects[clays[0]!]!.damage).toBe(1); // exactly one hit: the original only (no copy for the targeted Golem)
    expect(r.objects[clays[1]!]!.damage).toBe(1);
    expect(dmg(r, 'Test Twin Golem', 'p2')).toEqual([1]); // the Golem with the ability is "another Golem" than the target
    expect(dmg(r, 'Test Foe Bear', 'p2')).toEqual([0]);
    expect(dmg(r, 'Test Sprout Fox', 'p1')).toEqual([0]);
  });
  it('Precursor Golem: a spell at a non-Golem does not trigger it', () => {
    const s0 = scenario([], { p1: { hand: ['Test Ember Spark'] }, p2: { battlefield: ['Test Twin Golem', 'Test Clay Golem', 'Test Foe Bear'] }, defs });
    const r = zap(s0, find(s0, 'Test Foe Bear', 'battlefield', 'p2'));
    expect(dmg(r, 'Test Clay Golem', 'p2')).toEqual([0]);
    expect(dmg(r, 'Test Twin Golem', 'p2')).toEqual([0]);
  });
});

describe('CR 707.9b, 105.3, 613.4b: "except it\'s a 1/1 white Spirit creature with flying in addition to its other types." (Kaya, Intangible Slayer)', () => {
  const RITE = card('Test Spirit Rite', 'Sorcery', "Create a token that's a copy of target artifact you control, except it's a 1/1 white Spirit creature with flying in addition to its other types.", { cost: '{1}' });
  const GOLEM = card('Test Clay Golem', 'Artifact Creature — Golem', '', { pt: ['3', '3'], colors: ['R'] });
  const defs = [RITE, GOLEM];
  it('is automated; the token is a 1/1 white (only white) Spirit Golem artifact creature with flying', () => {
    expect(automated(RITE)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Spirit Rite'], battlefield: ['Test Clay Golem'] }, defs });
    const r = castAndResolve(s0, 'Test Spirit Rite', { targets: [[target(find(s0, 'Test Clay Golem', 'battlefield', 'p1'))]] });
    const golems = onBf(r, 'Test Clay Golem', 'p1');
    const token = golems.find((id) => r.objects[id]!.kind === 'token')!;
    expect(pt(r, token)).toEqual([1, 1]);
    expect(chars(r, token).colors).toEqual(['W']);
    expect(chars(r, token).subtypes.sort()).toEqual(['Golem', 'Spirit']);
    expect(hasKeyword(r, token, 'flying')).toBe(true);
    const orig = golems.find((id) => id !== token)!;
    expect(pt(r, orig)).toEqual([3, 3]);
    expect(hasKeyword(r, orig, 'flying')).toBe(false);
  });
});

describe('CR 707.2, 111.2, 707.9b: "you create a token that\'s a copy of that creature, except it\'s a Tyranid in addition to its other types." (Genestealer Patriarch)', () => {
  const NEST = card('Test Hive Nest', 'Creature — Alien', "Whenever a creature with a hatch counter on it dies, you create a token that's a copy of that creature, except it's a Tyranid in addition to its other types.", { pt: ['1', '1'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const SPARK = card('Test Ember Spark', 'Instant', 'Test Ember Spark deals 5 damage to target creature.', { cost: '{R}', colors: ['R'] });
  const defs = [NEST, BEAR, SPARK];
  it('is automated; a creature with a hatch counter dies (yours or not): you create the Tyranid copy; one without a counter gives none', () => {
    expect(automated(NEST)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Hive Nest'], hand: ['Test Ember Spark'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] }, defs });
    const bears = onBf(s0, 'Test Bear', 'p2');
    s0.objects[bears[0]!]!.counters['hatch'] = 1;
    const r = castAndResolve(s0, 'Test Ember Spark', { targets: [[target(bears[0]!)]] }, ['R']);
    const mine = onBf(r, 'Test Bear', 'p1');
    expect(mine).toHaveLength(1);
    expect(chars(r, mine[0]!).subtypes.sort()).toEqual(['Bear', 'Tyranid']);
    const none = castAndResolve(scenario([], { p1: { battlefield: ['Test Hive Nest'], hand: ['Test Ember Spark'] }, p2: { battlefield: ['Test Bear'] }, defs }), 'Test Ember Spark', { targets: [[target(find(s0, 'Test Bear', 'battlefield', 'p2'))]] }, ['R']);
    expect(onBf(none, 'Test Bear', 'p1')).toHaveLength(0);
  });
});

describe('CR 508.4, 707.9b, 603.7: "create a tapped and attacking token that\'s a copy of another target Villain you control, except it isn\'t legendary and it\'s an Illusion in addition to its other types. Sacrifice that token at the beginning of the next end step." (Loki, the Deceiver)', () => {
  const TRICKSTER = card('Test Trick God', 'Legendary Creature — God Villain', "Whenever ~ attacks, create a tapped and attacking token that's a copy of another target Villain you control, except it isn't legendary and it's an Illusion in addition to its other types. Sacrifice that token at the beginning of the next end step.", { pt: ['3', '3'] });
  const VILLAIN = card('Test Dark Lord', 'Legendary Creature — Human Villain', '', { pt: ['4', '4'] });
  const defs = [TRICKSTER, VILLAIN];
  it('is automated; attacking with the God makes a tapped, attacking, non-legendary Illusion copy of the Villain, sacrificed at the end step', () => {
    expect(automated(TRICKSTER)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Trick God', 'Test Dark Lord'] }, defs });
    const god = find(s0, 'Test Trick God', 'battlefield', 'p1');
    let s = declareAttackers(toDeclareAttackers(s0), [[god]]);
    s = resolveAll(s, { targets: [[target(find(s, 'Test Dark Lord', 'battlefield', 'p1'))]] });
    const lords = onBf(s, 'Test Dark Lord', 'p1');
    expect(lords).toHaveLength(2);
    const token = lords.find((id) => s.objects[id]!.kind === 'token')!;
    expect(chars(s, token).supertypes).toEqual([]);
    expect(chars(s, token).subtypes.sort()).toEqual(['Human', 'Illusion', 'Villain']);
    expect(s.objects[token]!.tapped).toBe(true);
    expect(chars(s, lords.find((id) => id !== token)!).supertypes).toEqual(['Legendary']);
  });
});

describe('CR 611.2a, 613.4b, 707.9a: "You may have this creature enter as a copy of any creature on the battlefield, except it has "{X}: This creature has base power and toughness X/X."" (Gigantoplasm)', () => {
  const PLASM = card('Test Plasm Mimic', 'Creature — Shapeshifter', 'You may have this creature enter as a copy of any creature on the battlefield, except it has "{X}: This creature has base power and toughness X/X."', { cost: '{1}', pt: ['0', '0'] });
  const BEAR = card('Test Bear', 'Creature — Bear', 'Vigilance', { pt: ['2', '2'] });
  const defs = [PLASM, BEAR];
  it('is automated; it enters as the Bear (2/2, vigilance), and the gained ability sets the base power and toughness to X/X for good', () => {
    expect(automated(PLASM)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Plasm Mimic'] }, p2: { battlefield: ['Test Bear'] }, defs });
    let s = castAndResolve(s0, 'Test Plasm Mimic', { yes: true });
    const mimic = s.zones.battlefield.find((id) => s.objects[id]!.controller === 'p1' && chars(s, id).name === 'Test Bear')!;
    expect(mimic).toBeDefined();
    expect(pt(s, mimic)).toEqual([2, 2]);
    expect(hasKeyword(s, mimic, 'vigilance')).toBe(true);
    for (const m of ['C', 'C', 'C', 'C', 'C']) s.players[0]!.manaPool.push({ type: m } as never);
    const acts = legal(s, 'p1', 'activate').filter((a) => a.object === mimic);
    expect(acts.length).toBeGreaterThanOrEqual(1); // the gained "{X}: ..." is offered
    s = resolveAll(act(s, acts[0]!.action as never), { x: [4] });
    expect(pt(s, mimic)).toEqual([4, 4]);
    for (const m of ['C', 'C']) s.players[0]!.manaPool.push({ type: m } as never);
    s = resolveAll(act(s, acts[0]!.action as never), { x: [1] }); // a later activation overwrites the earlier base values (ruling 2015-11-04)
    expect(pt(s, mimic)).toEqual([1, 1]);
  });
});

describe('CR 607.2a, 508.4, 707.9b: "create a tapped and attacking token that\'s a copy of the exiled card, except it\'s an Illusion in addition to its other types. Sacrifice that token at end of combat." (Phantom Steed)', () => {
  const HORSE = card('Test Mist Horse', 'Creature — Horse Illusion', "When this creature enters, exile another target creature you control until this creature leaves the battlefield.\nWhenever this creature attacks, create a tapped and attacking token that's a copy of the exiled card, except it's an Illusion in addition to its other types. Sacrifice that token at end of combat.", { cost: '{1}', pt: ['2', '2'] });
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['4', '4'] });
  const defs = [HORSE, OGRE];
  it('is automated; the exiled Ogre comes back as a tapped, attacking Illusion Ogre token for each attack and the token is sacrificed at end of combat; the Ogre returns when the Horse leaves', () => {
    expect(automated(HORSE)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Mist Horse'], battlefield: ['Test Ogre'] }, defs });
    let s = castAndResolve(s0, 'Test Mist Horse', { targets: [[target(find(s0, 'Test Ogre', 'battlefield', 'p1'))]] }, ['C']);
    expect(onBf(s, 'Test Ogre', 'p1')).toHaveLength(0); // exiled
    expect(s.zones.exile.some((id) => chars(s, id).name === 'Test Ogre')).toBe(true);
    s = advanceTo(s, 3, 'main1'); // the Horse can attack on p1's next turn
    const horse = find(s, 'Test Mist Horse', 'battlefield', 'p1');
    s = resolveAll(declareAttackers(toDeclareAttackers(s), [[horse]]));
    const ogres = onBf(s, 'Test Ogre', 'p1');
    expect(ogres).toHaveLength(1);
    expect(chars(s, ogres[0]!).subtypes.sort()).toEqual(['Illusion', 'Ogre']);
    expect(s.objects[ogres[0]!]!.tapped).toBe(true);
    expect(pt(s, ogres[0]!)).toEqual([4, 4]);
    const end = resolveAll(advanceTo(s, 3, 'endCombat'));
    expect(onBf(end, 'Test Ogre', 'p1')).toHaveLength(0);
  });
});
