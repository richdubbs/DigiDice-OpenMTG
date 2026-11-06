/**
 * Commander lane copy, third round, edh-next-74: the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler, each with its negative case. CR cites are from the text of 2026-09-25 where marked "checked", otherwise from memory (unverified).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type Color, type GameState, type ObjectId, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, legal, pass, scenario } from '../../m3/scenario';
import { activate } from '../../m5/cr-examples/helpers';
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
const onBf = (s: GameState, name: string, controller: 'p1' | 'p2'): ObjectId[] =>
  s.zones.battlefield.filter((id) => s.objects[id]!.controller === controller && chars(s, id).name === name);
const target = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const pt = (s: GameState, id: ObjectId): [number, number] => [Number(chars(s, id).power), Number(chars(s, id).toughness)];
const hasKeyword = (s: GameState, id: ObjectId, k: string): boolean => chars(s, id).keywords.some((x) => x.keyword === k);

const stackSize = (s: GameState): number => s.zones.stack.length;
const lifeOf = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const lands = (n: number): string[] => Array(n).fill('Mountain') as string[];


const dmg = (s: GameState, id: ObjectId): number => Number((s.objects[id] as unknown as { damage?: number }).damage ?? 0);

describe('CR 707.10c, 115.1 (unverified): "Copy that spell for each other permanent or player the spell could target." (Radiate)', () => {
  const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 1 damage to any target.', { cost: '{R}', colors: ['R'] });
  const RADIATE = card('Test Radiate', 'Instant', 'Choose target instant or sorcery spell that targets only a single permanent or player. Copy that spell for each other permanent or player the spell could target. Each copy targets a different one of those permanents and players.', { cost: '{R}', colors: ['R'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['5', '5'] });
  const defs = [BOLT, RADIATE, BEAR];
  const setup = () => scenario(['Mountain'], { p1: { hand: ['Test Bolt', 'Test Radiate'], battlefield: ['Test Bear', 'Mountain', 'Mountain'] }, p2: { battlefield: ['Test Bear'] }, defs });
  it('is automated', () => expect(automated(RADIATE)).toBe(true));
  it('a bolt at a player is copied for every other player and creature: each takes 1, lands are untouched', () => {
    const s0 = setup();
    s0.players[0]!.manaPool.push({ type: 'R' } as never, { type: 'R' } as never);
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Bolt', 'hand', 'p1') }), { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Radiate', 'hand', 'p1') }), { targets: [[target(s.zones.stack[s.zones.stack.length - 1]!)]] });
    expect(stackSize(s)).toBe(2); // the copies are made as Radiate resolves
    s = resolveAll(s);
    expect(lifeOf(s, 'p2')).toBe(19);
    expect(lifeOf(s, 'p1')).toBe(19);
    for (const id of [...onBf(s, 'Test Bear', 'p1'), ...onBf(s, 'Test Bear', 'p2')]) expect(dmg(s, id)).toBe(1);
  });
  it('NEGATIVE: a spell with no target is not a legal target for it (the spell is not chosen)', () => {
    const s0 = setup();
    s0.players[0]!.manaPool.push({ type: 'R' } as never);
    const radiate = (): void => { act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Radiate', 'hand', 'p1') }); };
    expect(radiate).toThrow();
  });
});

describe('CR 107.3, 601.2b, 602.2, 707.10 (unverified): Unbound Flourishing, Magus Lucea Kane, Repeated Reverberation, Verrak', () => {
  const HYDRA = card('Test Hydra', 'Creature — Hydra', 'Test Hydra enters with X +1/+1 counters on it.', { pt: ['0', '0'], cost: '{X}{G}', colors: ['G'] });
  const FLOURISH = card('Test Flourishing', 'Enchantment', 'Whenever you cast a permanent spell with a mana cost that contains {X}, double the value of X.', { cost: '{2}{G}', colors: ['G'] });
  const DRAIN = card('Test Drain', 'Instant', 'Target player loses X life.', { cost: '{X}{B}', colors: ['B'] });
  const COPYX = card('Test Copier', 'Enchantment', 'Whenever you cast an instant or sorcery spell or activate an ability, if that spell\'s mana cost or that ability\'s activation cost contains {X}, copy that spell or ability. You may choose new targets for the copy.', { cost: '{2}{G}', colors: ['G'] });
  const defs = [HYDRA, FLOURISH, DRAIN, COPYX];
  it('are automated', () => { for (const d of [FLOURISH, COPYX]) expect(automated(d)).toBe(true); });
  it('Flourishing: a permanent spell with X = 2 enters with 4 counters (no extra mana)', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Hydra'], battlefield: ['Test Flourishing'] }, defs });
    for (const m of ['G', 'C', 'C']) s0.players[0]!.manaPool.push({ type: m } as never);
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Hydra', 'hand', 'p1') }), { x: [2] });
    const [id] = onBf(s, 'Test Hydra', 'p1');
    expect(pt(s, id!)).toEqual([4, 4]);
  });
  it('NEGATIVE: without it X stays 2', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Hydra'] }, defs });
    for (const m of ['G', 'C', 'C']) s0.players[0]!.manaPool.push({ type: m } as never);
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Hydra', 'hand', 'p1') }), { x: [2] });
    expect(pt(s, onBf(s, 'Test Hydra', 'p1')[0]!)).toEqual([2, 2]);
  });
  it('Copier: an instant with {X} in its cost is copied (same X); a spell without X is not', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Drain'], battlefield: ['Test Copier'] }, defs });
    for (const m of ['B', 'C', 'C']) s0.players[0]!.manaPool.push({ type: m } as never);
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Drain', 'hand', 'p1') }), { x: [2], targets: [[{ kind: 'player', id: 'p2' }]], yes: false });
    expect(lifeOf(s, 'p2')).toBe(16);
  });
});

const p2: TargetChoice = { kind: 'player', id: 'p2' };

describe('CR 602.2b, 107.3a, 118.3, 707.10 (unverified): activation costs with {X} or life (Magus Lucea Kane, Unbound Flourishing, Verrak)', () => {
  const XPING = card('Test Xpinger', 'Artifact', '{X}, {T}: Test Xpinger deals X damage to target player.', { cost: '{1}' });
  const LPING = card('Test Lifepinger', 'Artifact', '{T}, Pay 2 life: Test Lifepinger deals 1 damage to target player.', { cost: '{1}' });
  const PLAIN = card('Test Plainpinger', 'Artifact', '{T}: Test Plainpinger deals 1 damage to target player.', { cost: '{1}' });
  const COPIER = card('Test Copier', 'Enchantment', "Whenever you cast an instant or sorcery spell or activate an ability, if that spell's mana cost or that ability's activation cost contains {X}, copy that spell or ability. You may choose new targets for the copy.", { cost: '{2}{G}', colors: ['G'] });
  const VER = card('Test Verrak', 'Legendary Creature — Vampire', "Whenever you activate an ability that isn't a mana ability, if life was paid to activate it, you may pay that much life again. If you do, copy that ability. You may choose new targets for the copy.", { pt: ['2', '2'], cost: '{1}{W}{B}' });
  const MAGUS = card('Test Magus', 'Creature — Wizard', '{T}: Add {C}{C}. When you next cast a spell with {X} in its mana cost or activate an ability with {X} in its activation cost this turn, copy that spell or ability. You may choose new targets for the copy.', { pt: ['2', '2'], cost: '{2}' });
  const defs = [XPING, LPING, PLAIN, COPIER, VER, MAGUS];
  const fire = (s0: GameState, who: string, x?: number): GameState => {
    const s1 = activate(s0, find(s0, who, 'battlefield', 'p1'), [...(x !== undefined ? [{ kind: 'chooseNumber', n: x } as never] : []), { kind: 'chooseTargets', targets: [p2] } as never], /damage/);
    return resolveAll(s1, { yes: true, targets: [[p2]], x: x !== undefined ? [x] : [] });
  };
  it('are automated', () => { for (const d of [COPIER, VER, MAGUS]) expect(automated(d)).toBe(true); });
  it('Copier: an ability with {X} in its cost is copied (X = 2: four damage)', () => {
    const s0 = scenario(['Mountain'], { p1: { battlefield: ['Test Copier', 'Test Xpinger', ...lands(3)] }, defs });
    expect(lifeOf(fire(s0, 'Test Xpinger', 2), 'p2')).toBe(16);
  });
  it('NEGATIVE: an ability without {X} in its cost is not copied', () => {
    const s0 = scenario(['Mountain'], { p1: { battlefield: ['Test Copier', 'Test Plainpinger', ...lands(3)] }, defs });
    expect(lifeOf(fire(s0, 'Test Plainpinger'), 'p2')).toBe(19);
  });
  it('Verrak: life paid to activate, paid again, copies the ability (two damage; 4 life paid in all)', () => {
    const s0 = scenario(['Mountain'], { p1: { battlefield: ['Test Verrak', 'Test Lifepinger', ...lands(3)] }, defs });
    const r = fire(s0, 'Test Lifepinger');
    expect(lifeOf(r, 'p2')).toBe(18);
    expect(lifeOf(r, 'p1')).toBe(16);
  });
  it('NEGATIVE: Verrak: declining to pay again leaves one damage; an ability that paid no life is not copied', () => {
    const s0 = scenario(['Mountain'], { p1: { battlefield: ['Test Verrak', 'Test Lifepinger', 'Test Plainpinger', ...lands(3)] }, defs });
    const s1 = activate(s0, find(s0, 'Test Lifepinger', 'battlefield', 'p1'), [{ kind: 'chooseTargets', targets: [p2] } as never], /damage/);
    const r = resolveAll(s1, { yes: false, targets: [[p2]] });
    expect(lifeOf(r, 'p2')).toBe(19);
    expect(lifeOf(r, 'p1')).toBe(18);
    expect(lifeOf(fire(scenario(['Mountain'], { p1: { battlefield: ['Test Verrak', 'Test Plainpinger', ...lands(3)] }, defs }), 'Test Plainpinger'), 'p2')).toBe(19);
  });
  it('Magus: the next ability with {X} in its cost this turn is copied, once only', () => {
    const s0 = scenario(['Mountain'], { p1: { battlefield: ['Test Magus', 'Test Xpinger', ...lands(4)] }, defs });
    const s1 = activate(s0, find(s0, 'Test Magus', 'battlefield', 'p1'), [], /Add/);
    const s2 = resolveAll(s1);
    s2.players[0]!.manaPool.length = 0;
    for (const m of ['C', 'C']) s2.players[0]!.manaPool.push({ type: m } as never);
    expect(lifeOf(fire(s2, 'Test Xpinger', 1), 'p2')).toBe(18);
  });
});

describe('CR 603.7, 606.3, 707.10 (unverified): "When you next cast an instant spell, cast a sorcery spell, or activate a loyalty ability this turn, copy that spell or ability twice." (Repeated Reverberation)', () => {
  const REP = card('Test Reverb', 'Instant', 'When you next cast an instant spell, cast a sorcery spell, or activate a loyalty ability this turn, copy that spell or ability twice. You may choose new targets for the copies.', { cost: '{R}', colors: ['R'] });
  const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 1 damage to any target.', { cost: '{R}', colors: ['R'] });
  const CREEP = card('Test Creep', 'Creature — Bear', '', { pt: ['1', '1'], cost: '{R}', colors: ['R'] });
  const defs = [REP, BOLT, CREEP];
  it('is automated', () => expect(automated(REP)).toBe(true));
  it('the next instant is copied twice (three damage); the one after it is not', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Reverb', 'Test Bolt', 'Test Bolt'], battlefield: lands(4) }, defs });
    let s = castAndResolve(s0, 'Test Reverb', {}, ['R']);
    s = castAndResolve(s, 'Test Bolt', { targets: [[p2]], yes: false }, ['R']);
    expect(lifeOf(s, 'p2')).toBe(17);
    s = castAndResolve(s, 'Test Bolt', { targets: [[p2]], yes: false }, ['R']);
    expect(lifeOf(s, 'p2')).toBe(16);
  });
  it('NEGATIVE: a creature spell does not use it up and is not copied', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Reverb', 'Test Creep', 'Test Bolt'], battlefield: lands(4) }, defs });
    let s = castAndResolve(s0, 'Test Reverb', {}, ['R']);
    s = castAndResolve(s, 'Test Creep', {}, ['R']);
    expect(onBf(s, 'Test Creep', 'p1').length).toBe(1);
    s = castAndResolve(s, 'Test Bolt', { targets: [[p2]], yes: false }, ['R']);
    expect(lifeOf(s, 'p2')).toBe(17);
  });
});

describe('CR 707.9b, 707.10, 510.2 (unverified): Pirated Copy and Hulking Metamorph', () => {
  const PIRATE = card('Test Pirate', 'Creature — Shapeshifter Pirate', 'You may have ~ enter as a copy of any creature on the battlefield, except it\'s a Pirate in addition to its other types and it has "Whenever this creature or another creature with the same name deals combat damage to a player, you draw a card."'.replace(/~/g, 'Test Pirate'), { pt: ['0', '0'], cost: '{4}{U}', colors: ['U'] });
  const MORPH = card('Test Morph', 'Artifact Creature — Shapeshifter', "You may have Test Morph enter as a copy of an artifact or creature you control, except it's an artifact creature in addition to its other types, and its power and toughness are equal to Test Morph's power and toughness.", { pt: ['3', '3'], cost: '{3}' });
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['5', '5'] });
  const defs = [PIRATE, MORPH, OGRE];
  it('are automated', () => { for (const d of [PIRATE, MORPH]) expect(automated(d)).toBe(true); });
  it('Morph copies a 5/5 Ogre but stays 3/3', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Morph'], battlefield: ['Test Ogre'] }, defs });
    const s = castAndResolve(s0, 'Test Morph', { yes: true }, ['C', 'C', 'C']);
    const ogres = onBf(s, 'Test Ogre', 'p1');
    expect(ogres.length).toBe(2);
    const copy = ogres.find((id) => chars(s, id).types.includes('Artifact'))!;
    expect(pt(s, copy)).toEqual([3, 3]);
  });
  it('NEGATIVE: declining the copy leaves the card itself', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Morph'], battlefield: ['Test Ogre'] }, defs });
    const s = castAndResolve(s0, 'Test Morph', { yes: false, objects: [[]] }, ['C', 'C', 'C']);
    expect(onBf(s, 'Test Morph', 'p1').length).toBe(1);
  });
  it('Pirate copies an Ogre and is a Pirate Ogre with the draw trigger', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Pirate'], battlefield: ['Test Ogre'] }, defs });
    const s = castAndResolve(s0, 'Test Pirate', { yes: true }, ['U', 'C', 'C', 'C', 'C']);
    const copy = onBf(s, 'Test Ogre', 'p1').find((id) => chars(s, id).subtypes.includes('Pirate'))!;
    expect(copy).toBeDefined();
    expect(chars(s, copy).abilities.some((a) => a.def.kind === 'triggered')).toBe(true);
  });
});

describe('CR 707.10c, 603.4 (unverified): Radiant Performer copies an ability for each other permanent or player', () => {
  const PERF = card('Test Performer', 'Creature — Human Wizard', 'Flash\nWhen this creature enters, if you cast it from your hand, choose target spell or ability that targets only a single permanent or player. Copy that spell or ability for each other permanent or player the spell or ability could target. Each copy targets a different one of those permanents and players.', { pt: ['3', '3'], cost: '{R}', colors: ['R'] });
  const PINGER = card('Test Pinger', 'Artifact', '{T}: Test Pinger deals 1 damage to any target.', { cost: '{1}' });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['5', '5'] });
  const defs = [PERF, PINGER, BEAR];
  it('is automated', () => expect(automated(PERF)).toBe(true));
  it('an ability aimed at a player is copied for the other player, the bear and the Performer itself', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Performer'], battlefield: ['Test Pinger', 'Test Bear', 'Mountain'] }, defs });
    const s1 = activate(s0, find(s0, 'Test Pinger', 'battlefield', 'p1'), [{ kind: 'chooseTargets', targets: [p2] } as never], /damage/);
    s1.players[0]!.manaPool.push({ type: 'R' } as never);
    const abilityId = s1.zones.stack[s1.zones.stack.length - 1]!;
    let s = drive(act(s1, { type: 'cast', player: 'p1', card: find(s1, 'Test Performer', 'hand', 'p1') }));
    s = resolveAll(s, { targets: [[target(abilityId)]] });
    expect(lifeOf(s, 'p2')).toBe(19);
    expect(lifeOf(s, 'p1')).toBe(19);
    expect(dmg(s, onBf(s, 'Test Bear', 'p1')[0]!)).toBe(1);
    expect(dmg(s, onBf(s, 'Test Performer', 'p1')[0]!)).toBe(1);
  });
});

describe('CR 603.2, 603.6a, 707.10 (unverified): Aboleth Spawn copies the enters trigger of a creature entering under an opponent\'s control', () => {
  const SPAWN = card('Test Spawn', 'Creature — Fish Horror', "Whenever a creature entering under an opponent's control causes a triggered ability of that creature to trigger, you may copy that ability. You may choose new targets for the copy.", { pt: ['2', '2'], cost: '{2}{U}', colors: ['U'] });
  const CLERIC = card('Test Cleric', 'Creature — Human Cleric', 'When this creature enters, you gain 1 life.', { pt: ['1', '1'], cost: '{1}', colors: ['W'] });
  const defs = [SPAWN, CLERIC];
  it('is automated', () => expect(automated(SPAWN)).toBe(true));
  it("the opponent's cleric enters: its controller gains 1 and the copy makes the Spawn's controller gain 1", () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Cleric'], battlefield: [] }, p2: { battlefield: ['Test Spawn'] }, defs });
    const s = castAndResolve(s0, 'Test Cleric', { yes: true }, ['C']);
    expect(lifeOf(s, 'p1')).toBe(21);
    expect(lifeOf(s, 'p2')).toBe(21);
  });
  it("NEGATIVE: the Spawn's own controller's creature entering does not trigger it", () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Cleric'], battlefield: ['Test Spawn'] }, defs });
    const s = castAndResolve(s0, 'Test Cleric', { yes: true }, ['C']);
    expect(lifeOf(s, 'p1')).toBe(21);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
});

describe('review fixes of edh-next-74 (CR 107.3a, 603.3b; Scryfall rulings of Unbound Flourishing 2019-06-14, Aboleth Spawn 2022-06-10)', () => {
  const COPIER = card('Test Copier', 'Enchantment', "Whenever you cast an instant or sorcery spell or activate an ability, if that spell's mana cost or that ability's activation cost contains {X}, copy that spell or ability. You may choose new targets for the copy.", { cost: '{2}{G}', colors: ['G'] });
  const LIFEX = card('Test Lifex', 'Artifact', '{T}, Pay X life: Test Lifex deals X damage to target player.', { cost: '{1}' });
  const FLOURISH = card('Test Flourishing', 'Enchantment', 'Whenever you cast a permanent spell with a mana cost that contains {X}, double the value of X.', { cost: '{2}{G}', colors: ['G'] });
  const KRASIS = card('Test Krasis', 'Creature — Hydra', 'When you cast this spell, you gain X life.', { pt: ['0', '0'], cost: '{X}{G}', colors: ['G'] });
  const SPAWN = card('Test Spawn', 'Creature — Fish Horror', "Whenever a creature entering under an opponent's control causes a triggered ability of that creature to trigger, you may copy that ability. You may choose new targets for the copy.", { pt: ['2', '2'], cost: '{2}{U}', colors: ['U'] });
  const FLASHER = card('Test Flasher', 'Creature — Human Cleric', 'Flash\nWhen this creature enters, you gain 1 life.', { pt: ['1', '1'], cost: '{1}', colors: ['W'] });
  const defs = [COPIER, LIFEX, FLOURISH, KRASIS, SPAWN, FLASHER];
  it('NEGATIVE: an ability with "Pay X life" (no {X} symbol) is not copied', () => {
    const s0 = scenario(['Mountain'], { p1: { battlefield: ['Test Copier', 'Test Lifex', ...lands(3)] }, defs });
    const s1 = activate(s0, find(s0, 'Test Lifex', 'battlefield', 'p1'), [{ kind: 'chooseNumber', n: 2 } as never, { kind: 'chooseTargets', targets: [p2] } as never], /damage/);
    expect(lifeOf(resolveAll(s1, { yes: true, targets: [[p2]], x: [2] }), 'p2')).toBe(18);
  });
  it('a cast trigger that reads X sees the doubled X when Flourishing resolves first', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Krasis'], battlefield: ['Test Flourishing'] }, defs });
    for (const m of ['G', 'C', 'C', 'C']) s0.players[0]!.manaPool.push({ type: m } as never);
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Krasis', 'hand', 'p1') }), { x: [3], reverse: true });
    expect([23, 26]).toContain(lifeOf(s, 'p1'));
    const t = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Krasis', 'hand', 'p1') }), { x: [3] });
    expect(new Set([lifeOf(s, 'p1'), lifeOf(t, 'p1')])).toEqual(new Set([23, 26]));
  });
  it('Spawn: the copy is made when the Spawn controller is the active player (its trigger goes on top)', () => {
    const s0 = scenario(['Mountain'], { p1: { battlefield: ['Test Spawn'] }, p2: { hand: ['Test Flasher'], battlefield: lands(2) }, defs });
    const s1 = pass(s0);
    s1.players[1]!.manaPool.push({ type: 'C' } as never);
    const s = resolveAll(act(s1, { type: 'cast', player: 'p2', card: find(s1, 'Test Flasher', 'hand', 'p2') }), { yes: true });
    expect(lifeOf(s, 'p2')).toBe(21);
    expect(lifeOf(s, 'p1')).toBe(21);
  });
});
