/**
 * Concept lane delayed-control, edh-next-105: the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
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


const zoneOf = (s: GameState, id: ObjectId): string => s.objects[id]!.zone;
const inGy = (s: GameState, p: 'p1' | 'p2', name: string): ObjectId[] => (s.zones.graveyard[p] ?? []).filter((id) => chars(s, id).name === name);
const inHand = (s: GameState, p: 'p1' | 'p2', name: string): ObjectId[] => (s.zones.hand[p] ?? []).filter((id) => chars(s, id).name === name);
const inExile = (s: GameState, name: string): ObjectId[] => s.zones.exile.filter((id) => chars(s, id).name === name);
void zoneOf;

describe('CR 400.7, 603.7, 614.1a, 608.2c (unverified): return a creature card, it gains haste, exile it at the next end step, and exile it if it would leave (Moira and Teshar)', () => {
  const RITE = card('Test Rite', 'Sorcery', 'Return target creature card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step. If it would leave the battlefield, exile it instead of putting it anywhere else.', { cost: '{1}{B}', colors: ['B'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.', { cost: '{C}' });
  const defs = [RITE, BEAR, KILL];
  it('is automated', () => expect(automated(RITE)).toBe(true));
  it('the creature returns with haste, and at the beginning of the next end step it is exiled (not in the graveyard)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Rite'], graveyard: ['Test Bear'] }, defs });
    const bear = find(s0, 'Test Bear', 'graveyard', 'p1');
    const s1 = castAndResolve(s0, 'Test Rite', { targets: [[target(bear)]] }, ['B', 'C']);
    const [id] = onBf(s1, 'Test Bear', 'p1');
    expect(id).toBeDefined();
    expect(hasKeyword(s1, id!, 'haste')).toBe(true);
    const s2 = resolveAll(advanceTo(s1, 1, 'end'));
    expect(onBf(s2, 'Test Bear', 'p1')).toHaveLength(0);
    expect(inExile(s2, 'Test Bear')).toHaveLength(1);
    expect(inGy(s2, 'p1', 'Test Bear')).toHaveLength(0);
  });
  it('NEGATIVE: if it would leave the battlefield before that (destroyed), it is exiled instead of going to the graveyard', () => {
    const s0 = scenario([], { p1: { hand: ['Test Rite', 'Test Kill'], graveyard: ['Test Bear'] }, defs });
    const bear = find(s0, 'Test Bear', 'graveyard', 'p1');
    const s1 = castAndResolve(s0, 'Test Rite', { targets: [[target(bear)]] }, ['B', 'C']);
    const [id] = onBf(s1, 'Test Bear', 'p1');
    const s2 = castAndResolve(s1, 'Test Kill', { targets: [[target(id!)]] }, ['C']);
    expect(onBf(s2, 'Test Bear', 'p1')).toHaveLength(0);
    expect(inExile(s2, 'Test Bear')).toHaveLength(1);
    expect(inGy(s2, 'p1', 'Test Bear')).toHaveLength(0);
  });
});

describe('CR 614.1a, 608.2n, 603.7 (unverified): exile the spell instead of putting it into the graveyard as it resolves, then return it to hand at the next end step (Feather, the Redeemed)', () => {
  const ANGEL = card('Test Angel', 'Creature — Angel', 'Whenever you cast an instant or sorcery spell, exile that card instead of putting it into your graveyard as it resolves. If you do, return it to your hand at the beginning of the next end step.', { pt: ['2', '2'] });
  const INSIGHT = card('Test Insight', 'Instant', 'Draw a card.', { cost: '{C}' });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{C}' });
  const defs = [ANGEL, INSIGHT, BEAR];
  it('is automated', () => expect(automated(ANGEL)).toBe(true));
  it('the instant is exiled as it resolves and is back in hand at the beginning of the next end step', () => {
    const s0 = scenario([], { p1: { hand: ['Test Insight'], battlefield: ['Test Angel'], library: ['Test Bear', 'Test Bear'] }, defs });
    const s1 = castAndResolve(s0, 'Test Insight', {}, ['C']);
    expect(inExile(s1, 'Test Insight')).toHaveLength(1);
    expect(inGy(s1, 'p1', 'Test Insight')).toHaveLength(0);
    const s2 = resolveAll(advanceTo(s1, 1, 'end'));
    expect(inHand(s2, 'p1', 'Test Insight')).toHaveLength(1);
    expect(inExile(s2, 'Test Insight')).toHaveLength(0);
  });
  it('NEGATIVE: without the creature the instant goes to the graveyard and stays there', () => {
    const s0 = scenario([], { p1: { hand: ['Test Insight'], library: ['Test Bear', 'Test Bear'] }, defs });
    const s1 = castAndResolve(s0, 'Test Insight', {}, ['C']);
    const s2 = resolveAll(advanceTo(s1, 1, 'end'));
    expect(inGy(s2, 'p1', 'Test Insight')).toHaveLength(1);
    expect(inHand(s2, 'p1', 'Test Insight')).toHaveLength(0);
  });
  it('NEGATIVE: a creature spell does not trigger it (it enters the battlefield)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Bear'], battlefield: ['Test Angel'] }, defs });
    const s1 = castAndResolve(s0, 'Test Bear', {}, ['C']);
    expect(onBf(s1, 'Test Bear', 'p1')).toHaveLength(1);
    expect(inExile(s1, 'Test Bear')).toHaveLength(0);
  });
});

describe('CR 607.2a, 122.6, 400.7, 603.7 (unverified): put a creature card exiled with ~ onto the battlefield with a finality counter, it gains haste, sacrifice it at the next end step (Emperor of Bones)', () => {
  const NECRO = card('Test Necro', 'Creature — Skeleton', 'When Test Necro enters, exile target creature card from a graveyard.\nAt the beginning of your upkeep, put a creature card exiled with Test Necro onto the battlefield under your control with a finality counter on it. It gains haste. Sacrifice it at the beginning of the next end step.', { pt: ['1', '1'], cost: '{C}' });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [NECRO, BEAR];
  it('is automated', () => expect(automated(NECRO)).toBe(true));
  it('the exiled creature comes back at your next upkeep with a finality counter and haste, and is sacrificed at the next end step (it dies exiled, CR 122.6)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Necro'] }, p2: { graveyard: ['Test Bear'] }, defs });
    const bear = find(s0, 'Test Bear', 'graveyard', 'p2');
    const s1 = castAndResolve(s0, 'Test Necro', { targets: [[target(bear)]] }, ['C']);
    expect(inExile(s1, 'Test Bear')).toHaveLength(1);
    const s2 = resolveAll(advanceTo(s1, 3, 'upkeep'));
    const [id] = onBf(s2, 'Test Bear', 'p1');
    expect(id).toBeDefined();
    expect(hasKeyword(s2, id!, 'haste')).toBe(true);
    expect((s2.objects[id!] as unknown as { counters?: Record<string, number> }).counters?.['finality']).toBe(1);
    const s3 = resolveAll(advanceTo(s2, 3, 'end'));
    expect(onBf(s3, 'Test Bear', 'p1')).toHaveLength(0);
  });
  it('NEGATIVE: with nothing exiled with it, nothing is put onto the battlefield', () => {
    const s0 = scenario([], { p1: { hand: ['Test Necro'] }, p2: { graveyard: [] }, defs });
    const s1 = castAndResolve(s0, 'Test Necro', { targets: [[]] }, ['C']);
    const s2 = resolveAll(advanceTo(s1, 3, 'upkeep'));
    expect(onBf(s2, 'Test Bear', 'p1')).toHaveLength(0);
  });
});

describe('CR 603.7, 603.4, 400.7 (unverified): return that card at the beginning of the next end step if ~ is still on the battlefield (Shirei, Shizo\'s Caretaker)', () => {
  const WARDEN = card('Test Warden', 'Creature — Spirit', 'Whenever a creature with power 1 or less is put into your graveyard from the battlefield, you may return that card to the battlefield at the beginning of the next end step if Test Warden is still on the battlefield.', { pt: ['3', '3'] });
  const MOUSE = card('Test Mouse', 'Creature — Rat', '', { pt: ['1', '1'] });
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.', { cost: '{C}' });
  const defs = [WARDEN, MOUSE, KILL];
  it('is automated', () => expect(automated(WARDEN)).toBe(true));
  it('the small creature that died returns at the beginning of the next end step', () => {
    const s0 = scenario([], { p1: { hand: ['Test Kill'], battlefield: ['Test Warden', 'Test Mouse'] }, defs });
    const mouse = onBf(s0, 'Test Mouse', 'p1')[0]!;
    const s1 = castAndResolve(s0, 'Test Kill', { targets: [[target(mouse)]] }, ['C']);
    expect(inGy(s1, 'p1', 'Test Mouse')).toHaveLength(1);
    const s2 = resolveAll(advanceTo(s1, 1, 'end'));
    expect(onBf(s2, 'Test Mouse', 'p1')).toHaveLength(1);
    expect(inGy(s2, 'p1', 'Test Mouse')).toHaveLength(0);
  });
  it('NEGATIVE: if the Warden left the battlefield before the end step, the card stays in the graveyard', () => {
    const s0 = scenario([], { p1: { hand: ['Test Kill', 'Test Kill'], battlefield: ['Test Warden', 'Test Mouse'] }, defs });
    const mouse = onBf(s0, 'Test Mouse', 'p1')[0]!;
    const warden = onBf(s0, 'Test Warden', 'p1')[0]!;
    const s1 = castAndResolve(s0, 'Test Kill', { targets: [[target(mouse)]] }, ['C']);
    const s1b = castAndResolve(s1, 'Test Kill', { targets: [[target(warden)]] }, ['C']);
    expect(onBf(s1b, 'Test Warden', 'p1')).toHaveLength(0);
    const s2 = resolveAll(advanceTo(s1b, 1, 'end'));
    expect(onBf(s2, 'Test Mouse', 'p1')).toHaveLength(0);
    expect(inGy(s2, 'p1', 'Test Mouse')).toHaveLength(1);
  });
  it('NEGATIVE: a creature with power 2 does not trigger it', () => {
    const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
    const s0 = scenario([], { p1: { hand: ['Test Kill'], battlefield: ['Test Warden', 'Test Bear'] }, defs: [WARDEN, BEAR, KILL] });
    const bear = onBf(s0, 'Test Bear', 'p1')[0]!;
    const s1 = castAndResolve(s0, 'Test Kill', { targets: [[target(bear)]] }, ['C']);
    const s2 = resolveAll(advanceTo(s1, 1, 'end'));
    expect(onBf(s2, 'Test Bear', 'p1')).toHaveLength(0);
  });
});
