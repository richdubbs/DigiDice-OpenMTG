/**
 * Commander top-rank part 2, edh-next-86: the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
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
const dmg = (s: GameState, id: ObjectId): number => Number((s.objects[id] as unknown as { damage?: number }).damage ?? 0);
const gy = (s: GameState, p: 'p1' | 'p2'): number => s.zones.graveyard[p]?.length ?? 0;
const handNames = (s: GameState, p: 'p1' | 'p2'): string[] => (s.zones.hand[p] ?? []).map((id) => chars(s, id).name);
const p2t: TargetChoice = { kind: 'player', id: 'p2' };
void stackSize; void dmg; void gy; void handNames; void hasKeyword; void legal; void advanceTo; void declareAttackers; void toDeclareAttackers; void activate;

describe('CR 208.1, 601.2i (unverified): a spell with power 4, 5, or 6 (Sarkhan\'s Unsealing)', () => {
  const SEAL = card('Test Seal', 'Enchantment', 'Whenever you cast a creature spell with power 4, 5, or 6, Test Seal deals 4 damage to any target.', { cost: '{2}{R}', colors: ['R'] });
  const FIVE = card('Test Five', 'Creature — Ogre', '', { pt: ['5', '5'], cost: '{1}' });
  const THREE = card('Test Three', 'Creature — Ogre', '', { pt: ['3', '3'], cost: '{1}' });
  const SEVEN = card('Test Seven', 'Creature — Ogre', '', { pt: ['7', '7'], cost: '{1}' });
  const defs = [SEAL, FIVE, THREE, SEVEN];
  it('is automated', () => expect(automated(SEAL)).toBe(true));
  const cast = (name: string): GameState => {
    const s0 = scenario(['Mountain'], { p1: { hand: [name], battlefield: ['Test Seal'] }, defs });
    return resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), { targets: [[p2t]] }); // `drive` pays {1} from the pool below
  };
  const withMana = (name: string): GameState => {
    const s0 = scenario(['Mountain'], { p1: { hand: [name], battlefield: ['Test Seal'] }, defs });
    s0.players[0]!.manaPool.push({ type: 'C' } as never);
    return resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), { targets: [[p2t]] });
  };
  void cast;
  it('power 5: 4 damage to the chosen target', () => expect(lifeOf(withMana('Test Five'), 'p2')).toBe(16));
  it('NEGATIVE: power 3 and power 7 are not in the list', () => {
    expect(lifeOf(withMana('Test Three'), 'p2')).toBe(20);
    expect(lifeOf(withMana('Test Seven'), 'p2')).toBe(20);
  });
});

describe('CR 119.3, 608.2c (unverified): "the life lost this way" in a rider (Blood Tribute)', () => {
  const TRIB = card('Test Tribute', 'Sorcery', 'Kicker {1}\nTarget opponent loses half their life, rounded up. If this spell was kicked, you gain life equal to the life lost this way.', { cost: '{B}', colors: ['B'] });
  const defs = [TRIB];
  it('is automated', () => expect(automated(TRIB)).toBe(true));
  it('kicked: the opponent loses half (rounded up) and you gain that much', () => {
    const s0 = scenario(['Swamp'], { p1: { hand: ['Test Tribute'] }, life: 15, defs });
    for (const m of ['B', 'C']) s0.players[0]!.manaPool.push({ type: m } as never);
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Tribute', 'hand', 'p1') }), { targets: [[p2t]], yes: true });
    expect(lifeOf(s, 'p2')).toBe(7);
    expect(lifeOf(s, 'p1')).toBe(23);
  });
  it('NEGATIVE: not kicked, you gain nothing', () => {
    const s0 = scenario(['Swamp'], { p1: { hand: ['Test Tribute'] }, life: 15, defs });
    s0.players[0]!.manaPool.push({ type: 'B' } as never);
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Tribute', 'hand', 'p1') }), { targets: [[p2t]], yes: false });
    expect(lifeOf(s, 'p2')).toBe(7);
    expect(lifeOf(s, 'p1')).toBe(15);
  });
});

describe('CR 400.3, 608.2b (unverified): return all except Giants, Wizards, and lands (Cyclone Summoner)', () => {
  const WAVE = card('Test Wave', 'Sorcery', "Return all permanents to their owners' hands except for Giants, Wizards, and lands.", { cost: '{U}', colors: ['U'] });
  const GIANT = card('Test Giant', 'Creature — Giant', '', { pt: ['3', '3'] });
  const WIZ = card('Test Wizard', 'Creature — Human Wizard', '', { pt: ['1', '1'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [WAVE, GIANT, WIZ, BEAR];
  it('is automated', () => expect(automated(WAVE)).toBe(true));
  it('everything else returns; Giants, Wizards and lands stay', () => {
    const s0 = scenario(['Island'], { p1: { hand: ['Test Wave'], battlefield: ['Test Giant', 'Test Bear', 'Island'] }, p2: { battlefield: ['Test Wizard', 'Test Bear'] }, defs });
    s0.players[0]!.manaPool.push({ type: 'U' } as never);
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Wave', 'hand', 'p1') }));
    expect(onBf(s, 'Test Giant', 'p1')).toHaveLength(1);
    expect(onBf(s, 'Test Wizard', 'p2')).toHaveLength(1);
    expect(onBf(s, 'Island', 'p1')).toHaveLength(1);
    expect(onBf(s, 'Test Bear', 'p1')).toHaveLength(0);
    expect(onBf(s, 'Test Bear', 'p2')).toHaveLength(0);
    expect(handNames(s, 'p1')).toContain('Test Bear');
    expect(handNames(s, 'p2')).toContain('Test Bear');
  });
});

describe('CR 613.4c, 613.1f (unverified): "has A, B, and C, and it gets +X/+X, where X is" (Katilda\'s Rising Dawn)', () => {
  const AURA = card('Test Dawn', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature has flying, lifelink, and protection from Vampires, and it gets +X/+X, where X is the number of permanents you control that are Spirits and/or enchantments.', { cost: '{1}{W}', colors: ['W'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [AURA, BEAR];
  it('is automated', () => expect(automated(AURA)).toBe(true));
  it('grants the keywords and +X/+X with X counted live (the Aura itself is an enchantment you control: 1)', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Dawn'], battlefield: ['Test Bear'] }, defs });
    for (const m of ['W', 'C']) s0.players[0]!.manaPool.push({ type: m } as never);
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Dawn', 'hand', 'p1') }), { targets: [[target(onBf(s0, 'Test Bear', 'p1')[0]!)]] });
    const [bear] = onBf(s, 'Test Bear', 'p1');
    expect(pt(s, bear!)).toEqual([3, 3]);
    expect(hasKeyword(s, bear!, 'flying')).toBe(true);
    expect(hasKeyword(s, bear!, 'lifelink')).toBe(true);
  });
});

describe('CR 603.2, 607.2d (unverified): "whenever the chosen player casts a spell" (Sewer Nemesis)', () => {
  const NEM = card('Test Nemesis', 'Creature — Rat', "As Test Nemesis enters, choose a player.\nWhenever the chosen player casts a spell, that player mills a card.", { pt: ['1', '1'], cost: '{1}', colors: ['B'] });
  const SPELL = card('Test Cantrip', 'Instant', 'You gain 1 life.', { cost: '{U}', colors: ['U'] });
  const defs = [NEM, SPELL];
  it('is automated', () => expect(automated(NEM)).toBe(true));
  const play = (chosen: 'p1' | 'p2'): GameState => {
    const s0 = scenario(['Island'], { p1: { hand: ['Test Nemesis', 'Test Cantrip'] }, p2: { hand: ['Test Cantrip'] }, defs });
    s0.players[0]!.manaPool.push({ type: 'C' } as never);
    let s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Nemesis', 'hand', 'p1') }), { options: [[chosen]] });
    expect(onBf(s, 'Test Nemesis', 'p1')).toHaveLength(1);
    const before = { p1: gy(s, 'p1'), p2: gy(s, 'p2') };
    s.players[0]!.manaPool.push({ type: 'U' } as never);
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Cantrip', 'hand', 'p1') }));
    return Object.assign(s, { __before: before });
  };
  it('the chosen player (the opponent) casting nothing: your own spell does not mill them', () => {
    const s = play('p2');
    const b = (s as unknown as { __before: { p1: number; p2: number } }).__before;
    expect(gy(s, 'p2')).toBe(b.p2);
    expect(gy(s, 'p1')).toBe(b.p1 + 1); // only the Cantrip itself
  });
  it('the chosen player is you: your spell mills a card from your library (that player mills)', () => {
    const s = play('p1');
    const b = (s as unknown as { __before: { p1: number; p2: number } }).__before;
    expect(gy(s, 'p1')).toBe(b.p1 + 2); // the Cantrip and the milled card
    expect(gy(s, 'p2')).toBe(b.p2);
  });
});

describe('CR 208.1, 603.10a (unverified): "with lesser toughness" than the creature that died (Colfenor, the Last Yew)', () => {
  const COL = card('Test Yew', 'Legendary Creature — Treefolk', 'Whenever Test Yew or another creature you control dies, return up to one other target creature card with lesser toughness from your graveyard to your hand.', { pt: ['2', '4'] });
  const BIG = card('Test Big', 'Creature — Ogre', '', { pt: ['5', '5'] });
  const SMALL = card('Test Small', 'Creature — Rat', '', { pt: ['1', '2'] });
  const EQUAL = card('Test Equal', 'Creature — Rat', '', { pt: ['1', '5'] });
  const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.', { cost: '{B}', colors: ['B'] });
  const defs = [COL, BIG, SMALL, EQUAL, DOOM];
  it('is automated', () => expect(automated(COL)).toBe(true));
  it('a 5-toughness creature dies: the 2-toughness card returns, the 5-toughness card does not (not lesser)', () => {
    const s0 = scenario(['Swamp'], { p1: { hand: ['Test Doom'], battlefield: ['Test Yew', 'Test Big'], graveyard: ['Test Small', 'Test Equal'] }, defs });
    s0.players[0]!.manaPool.push({ type: 'B' } as never);
    const s1 = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Doom', 'hand', 'p1') }), { targets: [[target(onBf(s0, 'Test Big', 'p1')[0]!)]] });
    const s = resolveAll(s1, { yes: true, targets: [[target(find(s0, 'Test Small', 'graveyard', 'p1'))]] });
    expect(handNames(s, 'p1')).toContain('Test Small');
    expect(handNames(s, 'p1')).not.toContain('Test Equal');
  });
});

describe('CR 400.7, 603.10a (unverified): Colfenor can\'t return the card of the creature whose death caused the trigger (ruling 2020-11-10)', () => {
  const COL = card('Test Yew', 'Legendary Creature — Treefolk', 'Whenever Test Yew or another creature you control dies, return up to one other target creature card with lesser toughness from your graveyard to your hand.', { pt: ['2', '4'] });
  const BEAR = card('Test Grub', 'Creature — Insect', '', { pt: ['1', '1'] });
  const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.', { cost: '{B}', colors: ['B'] });
  const defs = [COL, BEAR, DOOM];
  it('NEGATIVE: a 3/3 (counters) grub dies; its own 1/1 card is not a legal target, so it stays in the graveyard', () => {
    const s0 = scenario(['Swamp'], { p1: { hand: ['Test Doom'], battlefield: ['Test Yew', { name: 'Test Grub', counters: { '+1/+1': 2 } } as never] }, defs });
    s0.players[0]!.manaPool.push({ type: 'B' } as never);
    const grub = onBf(s0, 'Test Grub', 'p1')[0]!;
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Doom', 'hand', 'p1') }), { targets: [[target(grub)]] });
    for (let g = 0; g < 20 && s.pending?.kind !== 'chooseTargets' && s.pending?.kind !== 'declareAttackers' && !(s.zones.stack.length === 0 && g > 0); g++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    expect(s.pending?.kind).not.toBe('chooseTargets'); // no legal target: the trigger is removed from the stack
    expect(handNames(s, 'p1')).not.toContain('Test Grub');
  });
});

describe('CR 115.4, 120.1 (unverified): "any target that was dealt damage this turn" (Needle Drop)', () => {
  const NEEDLE = card('Test Needle', 'Instant', 'Test Needle deals 1 damage to any target that was dealt damage this turn.\nDraw a card.', { cost: '{R}', colors: ['R'] });
  const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 1 damage to any target.', { cost: '{R}', colors: ['R'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['5', '5'] });
  const defs = [NEEDLE, BOLT, BEAR];
  it('is automated', () => expect(automated(NEEDLE)).toBe(true));
  const setup = () => scenario(['Mountain'], { p1: { hand: ['Test Needle', 'Test Bolt'] }, p2: { battlefield: ['Test Bear'] }, defs });
  it('a creature that was dealt damage is a legal target; an undamaged creature and an undamaged player are not', () => {
    const s0 = setup();
    for (const m of ['R', 'R']) s0.players[0]!.manaPool.push({ type: m } as never);
    const bear = onBf(s0, 'Test Bear', 'p2')[0]!;
    const s1 = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Bolt', 'hand', 'p1') }), { targets: [[target(bear)]] }));
    expect(dmg(s1, bear)).toBe(1);
    const cast = act(s1, { type: 'cast', player: 'p1', card: find(s1, 'Test Needle', 'hand', 'p1') });
    const pend = cast.pending as unknown as { kind: string; options?: unknown };
    expect(pend.kind).toBe('chooseTargets');
    const s2 = resolveAll(cast, { targets: [[target(bear)]] });
    expect(dmg(s2, bear)).toBe(2);
    // NEGATIVE: with nothing damaged yet, the only way to cast it would need a target: none is legal, so the cast is rejected
    const s3 = setup();
    s3.players[0]!.manaPool.push({ type: 'R' } as never);
    const tryCast = (): void => { resolveAll(drive(act(s3, { type: 'cast', player: 'p1', card: find(s3, 'Test Needle', 'hand', 'p1') }), { targets: [[target(bear)]] })); };
    expect(tryCast).toThrow();
  });
  it('a player dealt damage this turn is a legal target', () => {
    const s0 = setup();
    for (const m of ['R', 'R']) s0.players[0]!.manaPool.push({ type: m } as never);
    const s1 = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Bolt', 'hand', 'p1') }), { targets: [[p2t]] }));
    expect(lifeOf(s1, 'p2')).toBe(19);
    const s2 = resolveAll(drive(act(s1, { type: 'cast', player: 'p1', card: find(s1, 'Test Needle', 'hand', 'p1') }), { targets: [[p2t]] }));
    expect(lifeOf(s2, 'p2')).toBe(18);
  });
});
