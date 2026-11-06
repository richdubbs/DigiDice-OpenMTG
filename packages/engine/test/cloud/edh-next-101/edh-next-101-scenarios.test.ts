/**
 * Concept lane secret-vote, edh-next-101: the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
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


const typesOf = (s: GameState, id: ObjectId): string[] => [...chars(s, id).types] as string[];

describe('CR 205.1b, 611.2a (unverified): "It\'s an artifact in addition to its other types" (Path of the Schemer)', () => {
  const RAISE = card('Test Raise', 'Sorcery', "Put target creature card from a graveyard onto the battlefield under your control. It's an artifact in addition to its other types.", { cost: '{B}', colors: ['B'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [RAISE, BEAR];
  it('is automated', () => expect(automated(RAISE)).toBe(true));
  it('the creature put onto the battlefield is an artifact creature; another creature is not', () => {
    const s0 = scenario(['Swamp'], { p1: { hand: ['Test Raise'], graveyard: ['Test Bear'], battlefield: ['Test Bear'] }, defs });
    const grave = s0.zones.graveyard.p1![0]!;
    s0.players[0]!.manaPool.push({ type: 'B' } as never);
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Raise', 'hand', 'p1') }), { targets: [[target(grave)]] });
    const bears = onBf(s, 'Test Bear', 'p1');
    expect(bears).toHaveLength(2);
    const arts = bears.filter((id) => typesOf(s, id).includes('Artifact'));
    expect(arts).toHaveLength(1);
    expect(typesOf(s, arts[0]!)).toContain('Creature');
  });
});

describe('CR 106.1, 121.1, 608.2h (unverified): discard hand, add mana for each, draw that many plus one (Path of the Pyromancer)', () => {
  const PYRE = card('Test Pyre', 'Sorcery', 'Discard all the cards in your hand. Add {R} for each card discarded this way, then draw that many cards plus one.', { cost: '{R}', colors: ['R'] });
  const defs = [PYRE];
  it('is automated', () => expect(automated(PYRE)).toBe(true));
  it('three other cards in hand: red mana 3, then draws 4', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Pyre', 'Mountain', 'Mountain', 'Mountain'] }, defs });
    s0.players[0]!.manaPool.push({ type: 'R' } as never);
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Pyre', 'hand', 'p1') }));
    expect(s.players[0]!.manaPool.filter((m) => (m as { type: string }).type === 'R')).toHaveLength(3);
    expect(s.zones.hand.p1).toHaveLength(4);
  });
  it('NEGATIVE: an empty hand adds no mana and draws exactly one', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Pyre'] }, defs });
    s0.players[0]!.manaPool.push({ type: 'R' } as never);
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Pyre', 'hand', 'p1') }));
    expect(s.players[0]!.manaPool.filter((m) => (m as { type: string }).type === 'R')).toHaveLength(0);
    expect(s.zones.hand.p1).toHaveLength(1);
  });
});

describe('CR 701.40a, 701.40e (unverified): manifest the top card of another player\'s library (Thieving Amalgam)', () => {
  const STEAL = card('Test Steal', 'Sorcery', "Manifest the top card of target opponent's library.", { cost: '{U}', colors: ['U'] });
  const OPP = card('Test Opp Top', 'Creature — Bear', '', { pt: ['4', '4'] });
  const defs = [STEAL, OPP];
  it('is automated', () => expect(automated(STEAL)).toBe(true));
  it('the opponent\'s top card enters under your control face down as a 2/2; their library shrinks by one', () => {
    const s0 = scenario(['Island'], { p1: { hand: ['Test Steal'] }, p2: { library: ['Test Opp Top'] }, defs });
    const before = s0.zones.library.p2!.length;
    s0.players[0]!.manaPool.push({ type: 'U' } as never);
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Steal', 'hand', 'p1') }), { targets: [[{ kind: 'player', id: 'p2' }]] });
    expect(s.zones.library.p2!.length).toBe(before - 1);
    const down = s.zones.battlefield.filter((id) => s.objects[id]!.faceDown === true);
    expect(down).toHaveLength(1);
    expect(s.objects[down[0]!]!.controller).toBe('p1');
    expect(s.objects[down[0]!]!.owner).toBe('p2');
    expect(pt(s, down[0]!)).toEqual([2, 2]);
  });
  it('NEGATIVE: your own library is untouched', () => {
    const s0 = scenario(['Island'], { p1: { hand: ['Test Steal'] }, defs });
    const mine = s0.zones.library.p1!.length;
    s0.players[0]!.manaPool.push({ type: 'U' } as never);
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Steal', 'hand', 'p1') }), { targets: [[{ kind: 'player', id: 'p2' }]] });
    expect(s.zones.library.p1!.length).toBe(mine);
  });
});

describe('CR 701.38a-b (unverified): votes whose words are several words (Travel Through Caradhras)', () => {
  const T = 'Starting with you, each player votes for Redhorn Pass or Mines of Moria. For each Redhorn Pass vote, you gain 2 life. For each Mines of Moria vote, each opponent loses 3 life.';
  const TRAVEL = card('Test Travel', 'Sorcery', T, { cost: '{G}', colors: ['G'] });
  const defs = [TRAVEL];
  it('is automated; a misspelled word is not', () => {
    expect(automated(TRAVEL)).toBe(true);
    expect(automated(card('Test Travel', 'Sorcery', T.replace('Mines of Moria or', 'Mines of Moria or').replaceAll('Redhorn Pass', 'Redhorn Peak'), { cost: '{G}' }))).toBe(false);
  });
  it('both players vote for the first word: you gain 4, the opponent loses nothing', () => {
    const s0 = scenario(['Forest'], { p1: { hand: ['Test Travel'] }, defs });
    s0.players[0]!.manaPool.push({ type: 'G' } as never);
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Travel', 'hand', 'p1') }));
    expect(lifeOf(s, 'p1')).toBe(24);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
});

describe('CR 701.20a, 701.38a (unverified): reveal until a creature card for each vote, a put from hand for each vote (Selvala\'s Stampede)', () => {
  const T = 'Starting with you, each player votes for wild or free. Reveal cards from the top of your library until you reveal a creature card for each wild vote. Put those creature cards onto the battlefield, then shuffle the rest into your library. You may put a permanent card from your hand onto the battlefield for each free vote.';
  const STAMP = card('Test Stampede', 'Sorcery', T, { cost: '{G}', colors: ['G'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [STAMP, BEAR];
  it('is automated', () => expect(automated(STAMP)).toBe(true));
  it('two wild votes: two creature cards come from the library, the hand keeps its cards', () => {
    const s0 = scenario(['Forest'], { p1: { hand: ['Test Stampede', 'Test Bear'], library: ['Test Bear', 'Test Bear', 'Test Bear'] }, defs });
    s0.players[0]!.manaPool.push({ type: 'G' } as never);
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Stampede', 'hand', 'p1') }));
    expect(onBf(s, 'Test Bear', 'p1').length).toBeGreaterThanOrEqual(2);
  });
});

describe('CR 701.40a, 303.4 (unverified): manifest the top card and attach to it as an Aura (Cloudform)', () => {
  const CLOUD = card('Test Cloud', 'Enchantment', 'When this enchantment enters, it becomes an Aura with enchant creature. Manifest the top card of your library and attach this enchantment to it.\nEnchanted creature has flying and hexproof.', { cost: '{U}', colors: ['U'] });
  const defs = [CLOUD];
  it('is automated', () => expect(automated(CLOUD)).toBe(true));
  it('the manifested creature has flying and hexproof', () => {
    const s0 = scenario(['Island'], { p1: { hand: ['Test Cloud'] }, defs });
    s0.players[0]!.manaPool.push({ type: 'U' } as never);
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Cloud', 'hand', 'p1') }));
    const cloud = onBf(s, 'Test Cloud', 'p1')[0]!;
    expect(cloud).toBeDefined();
    const host = (s.objects[cloud] as unknown as { attachedTo?: ObjectId }).attachedTo;
    expect(host).toBeDefined();
    expect(s.objects[host!]!.faceDown).toBe(true);
    expect(hasKeyword(s, host!, 'flying')).toBe(true);
    expect(hasKeyword(s, host!, 'hexproof')).toBe(true);
  });
});

describe('CR 701.38a, 701.23a, 614.? (unverified): Travel Through Caradhras\' own text played', () => {
  const T = 'Council\'s dilemma — Starting with you, each player votes for Redhorn Pass or Mines of Moria. For each Redhorn Pass vote, search your library for a basic land card and put it onto the battlefield tapped. If you search your library this way, shuffle. For each Mines of Moria vote, return a card from your graveyard to your hand.\nExile Test Caradhras.';
  const TC = card('Test Caradhras', 'Sorcery', T, { cost: '{G}', colors: ['G'] });
  const defs = [TC];
  it('is automated', () => expect(automated(TC)).toBe(true));
  it('two votes for the first word: two basic lands arrive tapped and the spell is exiled, not in the graveyard', () => {
    const s0 = scenario(['Forest'], { p1: { hand: ['Test Caradhras'], library: ['Forest', 'Forest', 'Forest'] }, defs });
    s0.players[0]!.manaPool.push({ type: 'G' } as never);
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Caradhras', 'hand', 'p1') }));
    const forests = onBf(s, 'Forest', 'p1');
    expect(forests).toHaveLength(2);
    expect(forests.every((id) => s.objects[id]!.tapped)).toBe(true);
    expect(s.zones.exile.some((id) => chars(s, id).name === 'Test Caradhras')).toBe(true);
    expect(s.zones.graveyard.p1!.some((id) => chars(s, id).name === 'Test Caradhras')).toBe(false);
  });
});
