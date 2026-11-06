/**
 * Commander lane copy, fourth pass, edh-d-60: the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler, each with its negative case. CR cites are from the text of 2026-09-25 where marked "checked", otherwise from memory (unverified).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type Color, type GameState, type ObjectId, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, legal, pass, scenario } from '../../m3/scenario';
import { activate, resolveTop } from '../../m5/cr-examples/helpers';
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


describe('CR 707.9b, 205.4a (unverified): "Each other creature you control becomes a copy of it until end of turn, except those creatures aren\'t legendary." (Echoing Equation)', () => {
  const SPELL = card('Test Echo', 'Sorcery', "Choose target creature you control. Each other creature you control becomes a copy of it until end of turn, except those creatures aren't legendary.", { cost: '{C}' });
  const KING = card('Test King', 'Legendary Creature — Elf', 'Haste', { pt: ['4', '4'] });
  const MOUSE = card('Test Mouse', 'Creature — Mouse', '', { pt: ['1', '1'] });
  const defs = [SPELL, KING, MOUSE];
  it('is automated', () => expect(automated(SPELL)).toBe(true));
  it('the other creatures become 4/4 Elves with haste that are not legendary; the chosen one stays legendary; the opponent\'s are untouched', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Echo'], battlefield: ['Test King', 'Test Mouse', 'Test Mouse'] }, p2: { battlefield: ['Test Mouse'] }, defs });
    const s = castAndResolve(s0, 'Test Echo', { targets: [[target(onBf(s0, 'Test King', 'p1')[0]!)]] }, ['C']);
    const [king] = onBf(s, 'Test King', 'p1');
    expect(chars(s, king!).supertypes).toContain('Legendary');
    const copies = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && id !== king);
    expect(copies.length).toBe(2);
    for (const id of copies) {
      expect(chars(s, id).name).toBe('Test King');
      expect(chars(s, id).supertypes).not.toContain('Legendary');
      expect(pt(s, id)).toEqual([4, 4]);
      expect(hasKeyword(s, id, 'haste')).toBe(true);
    }
    expect(pt(s, onBf(s, 'Test Mouse', 'p2')[0]!)).toEqual([1, 1]);
  });
  it('NEGATIVE: with no creature to choose the spell has no legal target', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Echo'] }, p2: { battlefield: ['Test Mouse'] }, defs });
    s0.players[0]!.manaPool.push({ type: 'C' } as never);
    expect(() => act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Echo', 'hand', 'p1') })).toThrow();
  });
});

describe('CR 707.9b, 205.4a (unverified): "Each creature you control other than the chosen creature becomes a copy of that creature until end of turn, except it isn\'t legendary." (Loki, Lord of Misrule)', () => {
  const SPELL = card('Test Misrule', 'Sorcery', "Choose target creature you control. Each creature you control other than the chosen creature becomes a copy of that creature until end of turn, except it isn't legendary.", { cost: '{C}' });
  const KING = card('Test King', 'Legendary Creature — Elf', '', { pt: ['4', '4'] });
  const MOUSE = card('Test Mouse', 'Creature — Mouse', '', { pt: ['1', '1'] });
  const defs = [SPELL, KING, MOUSE];
  it('is automated', () => expect(automated(SPELL)).toBe(true));
  it('every other creature you control becomes a non-legendary copy; the chosen creature is unchanged', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Misrule'], battlefield: ['Test King', 'Test Mouse'] }, p2: { battlefield: ['Test Mouse'] }, defs });
    const s = castAndResolve(s0, 'Test Misrule', { targets: [[target(onBf(s0, 'Test King', 'p1')[0]!)]] }, ['C']);
    const mine = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1');
    expect(mine.length).toBe(2);
    expect(mine.map((id) => chars(s, id).name)).toEqual(['Test King', 'Test King']);
    expect(mine.filter((id) => chars(s, id).supertypes.includes('Legendary')).length).toBe(1);
    expect(pt(s, onBf(s, 'Test Mouse', 'p2')[0]!)).toEqual([1, 1]);
  });
  it('NEGATIVE: the chosen creature is not one of "the others" (a one-creature board changes nothing, the creature stays legendary)', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Misrule'], battlefield: ['Test King'] }, defs });
    const s = castAndResolve(s0, 'Test Misrule', { targets: [[target(onBf(s0, 'Test King', 'p1')[0]!)]] }, ['C']);
    expect(chars(s, onBf(s, 'Test King', 'p1')[0]!).supertypes).toContain('Legendary');
  });
});

describe('CR 707.10, 110.4b, 601.2a (unverified): "a spell that wasn\'t cast" (Errant, Street Artist)', () => {
  const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 1 damage to any target.', { cost: '{R}', colors: ['R'] });
  const DUP = card('Test Dup', 'Instant', 'Copy target instant spell you control.', { cost: '{R}', colors: ['R'] });
  const ART = card('Test Artist', 'Creature — Human', 'Haste\n{T}: Copy target spell you control that wasn\'t cast. You may choose new targets for the copy.', { pt: ['1', '1'] });
  const defs = [BOLT, DUP, ART];
  it('is automated', () => expect(automated(ART)).toBe(true));
  it('a copy on the stack is a legal target: the artist copies the copy', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Bolt', 'Test Dup'], battlefield: ['Test Artist'] }, defs });
    s0.players[0]!.manaPool.push({ type: 'R' } as never, { type: 'R' } as never);
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Bolt', 'hand', 'p1') }), { targets: [[{ kind: 'player', id: 'p2' }]] });
    const bolt = s.zones.stack[s.zones.stack.length - 1]!;
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Dup', 'hand', 'p1') }), { targets: [[target(bolt)]] });
    s = resolveTop(s); // Test Dup resolves: a copy of the bolt is on the stack above the bolt
    expect(s.zones.stack.length).toBe(2);
    const copy = s.zones.stack[s.zones.stack.length - 1]!;
    expect(copy).not.toBe(bolt);
    const artist = onBf(s, 'Test Artist', 'p1')[0]!;
    s = activate(s, artist, [{ kind: 'chooseTargets', targets: [target(copy)] }, { kind: 'yesNo', yes: false } as never]);
    s = resolveAll(s, { targets: [[{ kind: 'player', id: 'p2' }]], yes: false });
    expect(s.zones.stack.length).toBe(0);
    expect(lifeOf(s, 'p2')).toBe(17); // the bolt, its copy and the copy of the copy
  });
  it('NEGATIVE: with only the cast spell on the stack the ability has no legal target', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Bolt'], battlefield: ['Test Artist'] }, defs });
    s0.players[0]!.manaPool.push({ type: 'R' } as never);
    const s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Bolt', 'hand', 'p1') }), { targets: [[{ kind: 'player', id: 'p2' }]] });
    const artist = onBf(s, 'Test Artist', 'p1')[0]!;
    expect(() => activate(s, artist)).toThrow();
  });
});

describe('CR 707.12 (unverified): a copy of a card that is cast WAS cast (Errant, Street Artist)', () => {
  const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 1 damage to any target.', { cost: '{R}', colors: ['R'] });
  const RAISE = card('Test Raise', 'Instant', 'Exile target instant card from your graveyard and copy it. You may cast the copy.', { cost: '{R}', colors: ['R'] });
  const ART = card('Test Artist', 'Creature — Human', "Haste\n{T}: Copy target spell you control that wasn't cast. You may choose new targets for the copy.", { pt: ['1', '1'] });
  it('NEGATIVE: the cast copy of a card is not a legal target', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Raise'], graveyard: ['Test Bolt'], battlefield: ['Test Artist'] }, defs: [BOLT, RAISE, ART] });
    s0.players[0]!.manaPool.push({ type: 'R' } as never, { type: 'R' } as never);
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Raise', 'hand', 'p1') }), { targets: [[target(find(s0, 'Test Bolt', 'graveyard', 'p1'))]] });
    s = resolveTop(s, [{ kind: 'yesNo', yes: true } as never, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] } as never]);
    expect(s.zones.stack.length).toBe(1); // the cast copy of the bolt
    expect(() => activate(s, onBf(s, 'Test Artist', 'p1')[0]!)).toThrow();
  });
});

describe('CR 205.4, 205.3m (unverified): "legendary or Rat card" (Nashi, Moon\'s Legacy)', () => {
  const SPELL = card('Test Raise', 'Sorcery', 'Exile up to one target legendary or Rat card from your graveyard and copy it. You may cast the copy.', { cost: '{C}' });
  const KING = card('Test King', 'Legendary Creature — Elf', '', { pt: ['4', '4'] });
  const RAT = card('Test Rat', 'Creature — Rat', '', { pt: ['1', '1'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [SPELL, KING, RAT, BEAR];
  it('is automated', () => expect(automated(SPELL)).toBe(true));
  it('a legendary card and a Rat card may be chosen, a plain Bear card may not', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Raise'], graveyard: ['Test King', 'Test Rat', 'Test Bear'] }, defs });
    s0.players[0]!.manaPool.push({ type: 'C' } as never);
    const s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Raise', 'hand', 'p1') });
    const p = s.pending as unknown as { kind: string; specs?: { options?: { id: string }[] }[]; options?: unknown };
    const flat = JSON.stringify(p);
    expect(flat).toContain(find(s0, 'Test King', 'graveyard', 'p1'));
    expect(flat).toContain(find(s0, 'Test Rat', 'graveyard', 'p1'));
    expect(flat).not.toContain(find(s0, 'Test Bear', 'graveyard', 'p1'));
  });
});

describe('CR 707.10, 707.10f, 110.4b (unverified): "If the copy is a permanent spell, it gains haste" after "If you do" (Mizzix, Replica Rider)', () => {
  const RIDER = card('Test Rider', 'Creature — Wizard', 'Whenever you cast a spell, you may pay {1}. If you do, copy that spell. If the copy is a permanent spell, it gains haste.', { pt: ['1', '1'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{1}{G}', colors: ['G'] });
  const defs = [RIDER, BEAR];
  it('is automated', () => expect(automated(RIDER)).toBe(true));
  it('a permanent spell is copied by paying, and the token copy has haste', () => {
    const s0 = scenario(['Forest'], { p1: { hand: ['Test Bear'], battlefield: ['Test Rider', 'Forest', 'Forest', 'Forest'] }, defs });
    for (const m of ['G', 'C', 'C']) s0.players[0]!.manaPool.push({ type: m } as never);
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Bear', 'hand', 'p1') }), { yes: true });
    const bears = onBf(s, 'Test Bear', 'p1');
    expect(bears.length).toBe(2);
    expect(bears.filter((id) => hasKeyword(s, id, 'haste')).length).toBe(1);
  });
  it('NEGATIVE: declining to pay makes no copy', () => {
    const s0 = scenario(['Forest'], { p1: { hand: ['Test Bear'], battlefield: ['Test Rider', 'Forest', 'Forest', 'Forest'] }, defs });
    for (const m of ['G', 'C', 'C']) s0.players[0]!.manaPool.push({ type: m } as never);
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Bear', 'hand', 'p1') }), { yes: false });
    expect(onBf(s, 'Test Bear', 'p1').length).toBe(1);
  });
});

describe('CR 707.10c, 115.1, 601.2c (unverified): "The copy targets that token." (Frontline Heroism)', () => {
  const ENCH = card('Test Heroism', 'Enchantment', 'Whenever you cast a spell that targets only a single creature you control, create a 1/1 red Soldier creature token with haste, then copy that spell. The copy targets that token.', { cost: '{C}' });
  const PUMP = card('Test Pump', 'Instant', 'Target creature you control gets +2/+2 until end of turn.', { cost: '{G}', colors: ['G'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [ENCH, PUMP, BEAR];
  it('is automated', () => expect(automated(ENCH)).toBe(true));
  it('the pump copy goes to the new token, the original to the bear', () => {
    const s0 = scenario(['Forest'], { p1: { hand: ['Test Pump'], battlefield: ['Test Heroism', 'Test Bear'] }, defs });
    s0.players[0]!.manaPool.push({ type: 'G' } as never);
    const bear = onBf(s0, 'Test Bear', 'p1')[0]!;
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Pump', 'hand', 'p1') }), { targets: [[target(bear)]] });
    expect(pt(s, bear)).toEqual([4, 4]); // the original pump: 2/2 -> 4/4
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && id !== bear && chars(s, id).name !== 'Test Heroism');
    expect(tokens.length).toBe(1);
    expect(pt(s, tokens[0]!)).toEqual([3, 3]); // 1/1 token +2/+2 from the copy
  });
  it('NEGATIVE: a spell with two different targets does not trigger it', () => {
    const SWAP = card('Test Swap', 'Instant', 'Target creature you control gets +1/+1 until end of turn. Target creature an opponent controls gets -1/-1 until end of turn.', { cost: '{G}', colors: ['G'] });
    const s0 = scenario(['Forest'], { p1: { hand: ['Test Swap'], battlefield: ['Test Heroism', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] }, defs: [...defs, SWAP] });
    s0.players[0]!.manaPool.push({ type: 'G' } as never);
    const mine = onBf(s0, 'Test Bear', 'p1')[0]!;
    const theirs = onBf(s0, 'Test Bear', 'p2')[0]!;
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Swap', 'hand', 'p1') }), { targets: [[target(mine)], [target(theirs)]] });
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1').length).toBe(2); // Heroism and the bear: no token
    expect(pt(s, mine)).toEqual([3, 3]);
  });
});
