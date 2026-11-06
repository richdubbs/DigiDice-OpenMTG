/**
 * Commander lane edh-perms, round edh-perms-8: the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. CR cites from memory unless noted.
 *
 *   CR 303.4f-g, 400.7, 603.7   "When enchanted creature dies, return that card to the battlefield under its owner's control. Return this card to the battlefield attached to that creature at the beginning of the next end step."
 *   CR 202.3, 601.2i, 111.1      "Whenever you cast a creature spell with mana value 4, 5, or 6, create two 0/1 ... Eldrazi Spawn creature tokens ..." (a list of exact mana values)
 *   CR 122.1, 701.10e, 608.2c    "Put a +1/+1 counter on target creature you control, then double the number of +1/+1 counters on each creature that had a +1/+1 counter put on it this way." (+ overload)
 *   CR 111.1, 111.2             "... create X 1/1 ... Spirit creature tokens with flying, where X is the number of tokens you created this turn." (the controller's tokens of this turn)
 *   CR 602.1, 107.5, 305.6       "Untap target creature that has an activated ability with {T} in its cost." (the tap symbol in the cost of an activated or mana ability)
 *   CR 118.8, 608.2h, 119.3      "As an additional cost to cast this spell, sacrifice a creature. You draw cards equal to the sacrificed creature's power, then you gain life equal to its toughness."
 *   CR 122.1, 608.2c, 208.1      "At the beginning of your upkeep, put a number of +1/+1 counters on each other creature you control equal to that creature's toughness."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type Color, type GameState, type ObjectId, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, legal as legalActionsOf, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const automated = (d: CardDef): boolean => d.automation.level === 'full';
const chars = (s: GameState, id: ObjectId) => getChars(s, id)!;

interface Picks { yes?: boolean; targets?: TargetChoice[][] }
/** Answer every decision until a player has priority: yes/no by `yes`, targets in order from `targets`, mana automatically. */
function drive(s0: GameState, o: Picks = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending as unknown as { kind: string; options?: ObjectId[]; min?: number; max?: number };
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options!.slice(0, Math.max(p.min ?? 0, 1)).slice(0, p.max) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((i) => i.id) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: tq.shift() ?? [] });
    else throw new Error(`unexpected decision ${JSON.stringify(s.pending)}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Picks = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
function castAndResolve(s0: GameState, name: string, o: Picks = {}, mana: string[] = ['C']): GameState {
  for (const m of mana) s0.players[0]!.manaPool.push({ type: m } as never);
  return resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), o);
}
const onBf = (s: GameState, name: string, controller: 'p1' | 'p2'): ObjectId[] =>
  s.zones.battlefield.filter((id) => s.objects[id]!.controller === controller && chars(s, id).name === name);
const inYard = (s: GameState, name: string, who: 'p1' | 'p2'): ObjectId[] => s.zones.graveyard[who]!.filter((id) => chars(s, id).name === name);
const target = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

describe('CR 303.4f-g, 400.7, 603.7: "When enchanted creature dies, return that card to the battlefield under its owner\'s control. Return this card to the battlefield attached to that creature at the beginning of the next end step."', () => {
  const GIFT = card('Test Undying Boon', 'Enchantment — Aura', 'Enchant creature\nWhen enchanted creature dies, return that card to the battlefield under its owner\'s control. Return this card to the battlefield attached to that creature at the beginning of the next end step.', { cost: '{1}' });
  const SMITE = card('Test Smite Spell', 'Instant', 'Destroy target creature.', { cost: '{1}' });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const PURGE = card('Test Purge Spell', 'Instant', 'Exile target card from a graveyard.', { cost: '{1}' });
  const defs = [GIFT, SMITE, BEAR, PURGE];
  /** p1's Bear enchanted by the Aura (cast on it), a Smite in hand. */
  const setup = (): { s: GameState; bear: ObjectId } => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bear'], hand: ['Test Undying Boon', 'Test Smite Spell', 'Test Smite Spell', 'Test Purge Spell'] }, defs });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    return { s: castAndResolve(s0, 'Test Undying Boon', { targets: [[target(bear)]] }), bear };
  };
  it('is automated', () => expect(automated(GIFT)).toBe(true));
  it('the creature returns at once; the Aura returns at the next end step attached to the returned creature', () => {
    const { s: s0, bear } = setup();
    const r = castAndResolve(s0, 'Test Smite Spell', { targets: [[target(bear)]] });
    expect(onBf(r, 'Test Bear', 'p1')).toHaveLength(1);
    expect(onBf(r, 'Test Bear', 'p1')[0]).not.toBe(bear);
    expect(inYard(r, 'Test Undying Boon', 'p1')).toHaveLength(1);
    expect(onBf(r, 'Test Undying Boon', 'p1')).toHaveLength(0);
    const end = resolveAll(advanceTo(r, 1, 'end'));
    const aura = onBf(end, 'Test Undying Boon', 'p1');
    expect(aura).toHaveLength(1);
    expect(end.objects[aura[0]!]!.attachedTo).toBe(onBf(end, 'Test Bear', 'p1')[0]);
  });
  it('CR 400.7: the creature that returned is a new object; when it is gone by the end step the Aura stays in the graveyard', () => {
    const { s: s0, bear } = setup();
    const r1 = castAndResolve(s0, 'Test Smite Spell', { targets: [[target(bear)]] });
    const back = onBf(r1, 'Test Bear', 'p1')[0]!;
    const r2 = castAndResolve(r1, 'Test Smite Spell', { targets: [[target(back)]] });
    expect(onBf(r2, 'Test Bear', 'p1')).toHaveLength(0);
    const end = resolveAll(advanceTo(r2, 1, 'end'));
    expect(onBf(end, 'Test Undying Boon', 'p1')).toHaveLength(0);
    expect(inYard(end, 'Test Undying Boon', 'p1')).toHaveLength(1);
  });
  it('CR 400.7: the Aura card is found only while it stays in the graveyard; exiled meanwhile, nothing returns', () => {
    const { s: s0, bear } = setup();
    const r1 = castAndResolve(s0, 'Test Smite Spell', { targets: [[target(bear)]] });
    const r2 = castAndResolve(r1, 'Test Purge Spell', { targets: [[target(inYard(r1, 'Test Undying Boon', 'p1')[0]!)]] });
    expect(inYard(r2, 'Test Undying Boon', 'p1')).toHaveLength(0);
    const end = resolveAll(advanceTo(r2, 1, 'end'));
    expect(onBf(end, 'Test Undying Boon', 'p1')).toHaveLength(0);
    expect(onBf(end, 'Test Bear', 'p1')).toHaveLength(1);
  });
  it('Scryfall ruling 2013-09-15: an enchanted TOKEN that dies does not return, and neither does the Aura', () => {
    const MAKE = card('Test Soldier Maker', 'Instant', 'Create a 1/1 white Soldier creature token.', { cost: '{1}' });
    const s0 = scenario([], { p1: { hand: ['Test Soldier Maker', 'Test Undying Boon', 'Test Smite Spell'] }, defs: [...defs, MAKE] });
    const made = castAndResolve(s0, 'Test Soldier Maker');
    const soldier = made.zones.battlefield.find((id) => made.objects[id]!.kind === 'token')!;
    const enchanted = castAndResolve(made, 'Test Undying Boon', { targets: [[target(soldier)]] });
    expect(enchanted.objects[onBf(enchanted, 'Test Undying Boon', 'p1')[0]!]!.attachedTo).toBe(soldier);
    const dead = castAndResolve(enchanted, 'Test Smite Spell', { targets: [[target(soldier)]] });
    expect(dead.zones.battlefield.some((id) => dead.objects[id]!.kind === 'token')).toBe(false);
    const end = resolveAll(advanceTo(dead, 1, 'end'));
    expect(onBf(end, 'Test Undying Boon', 'p1')).toHaveLength(0);
    expect(inYard(end, 'Test Undying Boon', 'p1')).toHaveLength(1);
  });
  it('the Aura does not return before the end step, and only once', () => {
    const { s: s0, bear } = setup();
    const r1 = castAndResolve(s0, 'Test Smite Spell', { targets: [[target(bear)]] });
    expect(onBf(r1, 'Test Undying Boon', 'p1')).toHaveLength(0);
    const end = resolveAll(advanceTo(r1, 1, 'end'));
    expect(onBf(end, 'Test Undying Boon', 'p1')).toHaveLength(1);
    const next = resolveAll(advanceTo(end, 2, 'end'));
    expect(onBf(next, 'Test Undying Boon', 'p1')).toHaveLength(1);
  });
});

describe('CR 202.3, 601.2i: "Whenever you cast a creature spell with mana value 4, 5, or 6, create two 0/1 colorless Eldrazi Spawn creature tokens ..."', () => {
  const SEAL = card('Test Spawn Seal', 'Enchantment', 'Whenever you cast a creature spell with mana value 4, 5, or 6, create two 0/1 colorless Eldrazi Spawn creature tokens with "Sacrifice this token: Add {C}."', { cost: '{1}' });
  const mk = (name: string, cost: string) => card(name, 'Creature — Bear', 'Flash', { pt: ['1', '1'], cost });
  const [C3, C4, C5, C6, C7] = [mk('Test Cost Three', '{3}'), mk('Test Cost Four', '{4}'), mk('Test Cost Five', '{5}'), mk('Test Cost Six', '{6}'), mk('Test Cost Seven', '{7}')];
  const defs = [SEAL, C3, C4, C5, C6, C7];
  const spawnCount = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && chars(s, id).name.includes('Spawn')).length;
  const castOne = (name: string, who: 'p1' | 'p2' = 'p1'): GameState => {
    const s0 = scenario([], { p1: { battlefield: ['Test Spawn Seal'], hand: who === 'p1' ? [name] : [] }, p2: { hand: who === 'p2' ? [name] : [] }, defs });
    for (let i = 0; i < 7; i++) s0.players[who === 'p1' ? 0 : 1]!.manaPool.push({ type: 'C' } as never);
    if (who === 'p2') return resolveAll(act(pass(s0), { type: 'cast', player: 'p2', card: find(s0, name, 'hand', 'p2') }));
    return resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }));
  };
  it('is automated', () => expect(automated(SEAL)).toBe(true));
  it('mana value 4, 5 and 6 each make two Spawn tokens', () => {
    for (const n of ['Test Cost Four', 'Test Cost Five', 'Test Cost Six']) expect(spawnCount(castOne(n)), n).toBe(2);
  });
  it('mana value 3 and mana value 7 make none (the list is exact values, not a range)', () => {
    for (const n of ['Test Cost Three', 'Test Cost Seven']) expect(spawnCount(castOne(n)), n).toBe(0);
  });
  it('the opponent\'s creature spell of mana value 5 makes none for you', () => {
    expect(spawnCount(castOne('Test Cost Five', 'p2'))).toBe(0);
  });
});

describe('CR 122.1, 701.10e, 608.2c: "Put a +1/+1 counter on target creature you control, then double the number of +1/+1 counters on each creature that had a +1/+1 counter put on it this way."', () => {
  const FANGS = card('Test Doubling Fangs', 'Sorcery', 'Put a +1/+1 counter on target creature you control, then double the number of +1/+1 counters on each creature that had a +1/+1 counter put on it this way.\nOverload {2}', { cost: '{G}' });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [FANGS, BEAR];
  const plus = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['+1/+1'] ?? 0;
  const board = (counters: [number, number] = [0, 0]): GameState => {
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Bear', counters: { '+1/+1': counters[0] } }, { name: 'Test Bear', counters: { '+1/+1': counters[1] } }], hand: ['Test Doubling Fangs'] }, p2: { battlefield: ['Test Bear'] }, defs });
    return s0;
  };
  it('is automated', () => expect(automated(FANGS)).toBe(true));
  it('a creature with no counter gets one and then it is doubled: two', () => {
    const s0 = board();
    const [a, b] = onBf(s0, 'Test Bear', 'p1');
    const r = castAndResolve(s0, 'Test Doubling Fangs', { targets: [[target(a!)]] }, ['G']);
    expect(plus(r, a!)).toBe(2);
    expect(plus(r, b!)).toBe(0); // only the target
    expect(plus(r, onBf(r, 'Test Bear', 'p2')[0]!)).toBe(0);
  });
  it('a creature that already has two counters ends with six (2 + 1 = 3, doubled)', () => {
    const s0 = board([2, 5]);
    const [a, b] = onBf(s0, 'Test Bear', 'p1');
    const r = castAndResolve(s0, 'Test Doubling Fangs', { targets: [[target(a!)]] }, ['G']);
    expect(plus(r, a!)).toBe(6);
    expect(plus(r, b!)).toBe(5); // the other creature's counters are not doubled, it had none put on it
  });
  it('overloaded: each creature you control gets one and is doubled; the opponent\'s creature is untouched', () => {
    const s0 = board([0, 3]);
    const [a, b] = onBf(s0, 'Test Bear', 'p1');
    s0.players[0]!.manaPool.push({ type: 'C' } as never, { type: 'C' } as never);
    const t = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Doubling Fangs', 'hand', 'p1'), method: 'overload' });
    expect(t.pending?.kind).not.toBe('chooseTargets');
    const r = resolveAll(t);
    expect(plus(r, a!)).toBe(2);
    expect(plus(r, b!)).toBe(8);
    expect(plus(r, onBf(r, 'Test Bear', 'p2')[0]!)).toBe(0);
  });
});

describe('CR 111.1, 111.2: "At the beginning of each end step, create X 1/1 white Spirit creature tokens with flying, where X is the number of tokens you created this turn."', () => {
  const MEDIUM = card('Test Token Medium', 'Legendary Creature — Human Cleric', 'At the beginning of each end step, create X 1/1 white Spirit creature tokens with flying, where X is the number of tokens you created this turn.', { pt: ['2', '3'], cost: '{1}' });
  const MAKER = card('Test Token Maker', 'Instant', 'Create three 1/1 white Soldier creature tokens.', { cost: '{1}' });
  const defs = [MEDIUM, MAKER];
  const spirits = (s: GameState, who: 'p1' | 'p2'): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === who && chars(s, id).name.includes('Spirit')).length;
  it('is automated', () => expect(automated(MEDIUM)).toBe(true));
  it('three tokens created this turn: three Spirits at the end step; with none created, none', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Token Medium'], hand: ['Test Token Maker'] }, defs });
    const r = castAndResolve(s0, 'Test Token Maker');
    expect(spirits(resolveAll(advanceTo(r, 1, 'end')), 'p1')).toBe(3);
    const none = scenario([], { p1: { battlefield: ['Test Token Medium'] }, defs });
    expect(spirits(resolveAll(advanceTo(none, 1, 'end')), 'p1')).toBe(0);
  });
  it('the opponent\'s tokens are not counted, and the Spirits it makes are not counted again by the next end step trigger of the same turn', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Token Medium'] }, p2: { hand: ['Test Token Maker'] }, defs });
    s0.players[1]!.manaPool.push({ type: 'C' } as never);
    const t = resolveAll(act(pass(s0), { type: 'cast', player: 'p2', card: find(s0, 'Test Token Maker', 'hand', 'p2') }));
    expect(onBf(t, 'Test Token Medium', 'p1')).toHaveLength(1);
    const end = resolveAll(advanceTo(t, 1, 'end'));
    expect(spirits(end, 'p1')).toBe(0);
    expect(spirits(end, 'p2')).toBe(0);
  });
});

describe('CR 602.1, 107.5, 305.6: "{1}, {T}: Untap target creature that has an activated ability with {T} in its cost."', () => {
  const STONE = card('Test Untap Stone', 'Artifact', '{1}, {T}: Untap target creature that has an activated ability with {T} in its cost.', { cost: '{2}' });
  const TAPPER = card('Test Tapper', 'Creature — Wizard', '{T}: You gain 1 life.', { pt: ['1', '1'] });
  const ELF = card('Test Mana Elf', 'Creature — Elf', '{T}: Add {G}.', { pt: ['1', '1'] });
  const PUMP = card('Test Pumper', 'Creature — Beast', '{1}: Test Pumper gets +1/+0 until end of turn.', { pt: ['1', '1'] });
  const PLAIN = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const TRIG = card('Test Trigger Bear', 'Creature — Bear', 'Whenever ~ attacks, you gain 1 life.', { pt: ['2', '2'] });
  const DRYAD = card('Test Forest Dryad', 'Land Creature — Forest Dryad', '', { pt: ['1', '1'] }); // a basic land type gives {T}: Add {G} (CR 305.6)
  const defs = [STONE, TAPPER, ELF, PUMP, PLAIN, TRIG, DRYAD];
  const names = ['Test Tapper', 'Test Mana Elf', 'Test Pumper', 'Test Plain Bear', 'Test Trigger Bear', 'Test Forest Dryad'];
  const board = (): GameState => scenario([], { p1: { battlefield: ['Test Untap Stone', ...names.map((name) => ({ name, tapped: true }))] }, defs });
  /** The creatures the Stone's ability offers as targets (all five are tapped on the battlefield). */
  const offered = (s0: GameState): { ids: ObjectId[]; start: GameState } => {
    s0.players[0]!.manaPool.push({ type: 'C' } as never);
    const stone = find(s0, 'Test Untap Stone', 'battlefield', 'p1');
    const la = legalActionsOf(s0, 'p1').find((a) => a.kind === 'activate' && (a as { object?: string }).object === stone)!;
    const s1 = act(s0, la.action);
    expect(s1.pending?.kind).toBe('chooseTargets');
    return { ids: (s1.pending as unknown as { objects: ObjectId[] }).objects, start: s1 };
  };
  it('is automated', () => expect(automated(STONE)).toBe(true));
  it('offers a creature with a {T} ability, a mana ability or a basic land type, and no other: not a {1} ability, a triggered ability, or none', () => {
    const s0 = board();
    const id = (n: string): ObjectId => find(s0, n, 'battlefield', 'p1');
    const got = offered(s0).ids;
    expect([...got].sort()).toEqual([id('Test Tapper'), id('Test Mana Elf'), id('Test Forest Dryad')].sort());
  });
  it('untaps the chosen creature and only it', () => {
    const s0 = board();
    const elf = find(s0, 'Test Mana Elf', 'battlefield', 'p1');
    const { start } = offered(s0);
    const r = resolveAll(answer(start, { kind: 'chooseTargets', targets: [target(elf)] }));
    expect(r.objects[elf]!.tapped).toBe(false);
    expect(r.objects[find(s0, 'Test Tapper', 'battlefield', 'p1')]!.tapped).toBe(true);
  });
});

describe('CR 118.8, 608.2h, 119.3: "As an additional cost to cast this spell, sacrifice a creature. You draw cards equal to the sacrificed creature\'s power, then you gain life equal to its toughness."', () => {
  const FALL = card('Test Fall Spell', 'Instant', 'As an additional cost to cast this spell, sacrifice a creature.\nYou draw cards equal to the sacrificed creature\'s power, then you gain life equal to its toughness.', { cost: '{G}' });
  const BRUTE = card('Test Brute', 'Creature — Ogre', '', { pt: ['4', '2'] });
  const WALL = card('Test Wall', 'Creature — Wall', '', { pt: ['0', '6'] });
  const defs = [FALL, BRUTE, WALL];
  const run = (victim: string): { cards: number; life: number } => {
    const s0 = scenario([], { p1: { battlefield: ['Test Brute', 'Test Wall'], hand: ['Test Fall Spell'], library: ['Test Brute', 'Test Brute', 'Test Brute', 'Test Brute', 'Test Brute', 'Test Brute'] }, defs });
    s0.players[0]!.manaPool.push({ type: 'G' } as never);
    const h0 = s0.zones.hand.p1!.length;
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Fall Spell', 'hand', 'p1') });
    for (let i = 0; i < 20 && s.pending && s.pending.kind !== 'priority'; i++) {
      const p = s.pending as unknown as { kind: string; options?: ObjectId[]; max?: number };
      if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [find(s0, victim, 'battlefield', 'p1')] });
      else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected decision ${p.kind}`);
    }
    s = resolveAll(s);
    return { cards: s.zones.hand.p1!.length - (h0 - 1), life: s.players[0]!.life - s0.players[0]!.life };
  };
  it('is automated', () => expect(automated(FALL)).toBe(true));
  it('sacrificing a 4/2 draws four and gains two; sacrificing a 0/6 draws none and gains six (the creature as it last was)', () => {
    expect(run('Test Brute')).toEqual({ cards: 4, life: 2 });
    expect(run('Test Wall')).toEqual({ cards: 0, life: 6 });
  });
});

describe('CR 122.1, 608.2c, 208.1: "At the beginning of your upkeep, put a number of +1/+1 counters on each other creature you control equal to that creature\'s toughness."', () => {
  const DRAKE = card('Test Counter Drake', 'Creature — Dragon', 'At the beginning of your upkeep, put a number of +1/+1 counters on each other creature you control equal to that creature\'s toughness.', { pt: ['5', '5'], cost: '{1}' });
  const A = card('Test Small Bear', 'Creature — Bear', '', { pt: ['1', '1'] });
  const B = card('Test Tall Wall', 'Creature — Wall', '', { pt: ['0', '4'] });
  const defs = [DRAKE, A, B];
  const plus = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['+1/+1'] ?? 0;
  it('is automated', () => expect(automated(DRAKE)).toBe(true));
  it('each other creature of yours gets counters equal to its own toughness; the Drake and the opponent\'s creatures get none', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Counter Drake', 'Test Small Bear', 'Test Tall Wall'] }, p2: { battlefield: ['Test Small Bear'] }, defs });
    const r = resolveAll(advanceTo(s0, 3, 'upkeep'));
    const bear = onBf(r, 'Test Small Bear', 'p1')[0]!;
    const wall = onBf(r, 'Test Tall Wall', 'p1')[0]!;
    expect(plus(r, bear)).toBe(1);
    expect(plus(r, wall)).toBe(4);
    expect(plus(r, onBf(r, 'Test Counter Drake', 'p1')[0]!)).toBe(0);
    expect(plus(r, onBf(r, 'Test Small Bear', 'p2')[0]!)).toBe(0);
  });
});
