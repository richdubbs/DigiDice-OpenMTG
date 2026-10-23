/**
 * p2-typechange-3 (Phase 2 lane p2-typechange): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 205.1b, 611.2a,  "Until end of turn, this land becomes a 3/2 blue and black Elemental creature. It's still a land.": a land creature of those colors until
 *   613.1d-e            end of turn, then a colorless land again
 *   CR 205.1b, 611.2a   "Target land becomes a 2/2 green creature that's still a land." (no duration): it stays a creature after the turn
 *   CR 205.1a           "Until end of turn, this artifact becomes a 2/1 blue and red Elemental artifact creature."
 *   CR 700.9, 611.2c    "Until end of turn, each modified creature you control has base power and toughness 7/5.": only the creatures modified as it resolves
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, pass, scenario, tweak } from '../../m5/helpers';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const types = (s: GameState, id: ObjectId): string[] => [...getChars(s, id)!.types].sort();
const subtypes = (s: GameState, id: ObjectId): string[] => [...getChars(s, id)!.subtypes].sort();
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };

/** Answer pending decisions (costs, targets, yes to a may, the queued answers) until a player has priority with an empty stack. */
function settle(s0: GameState, answers: DecisionAnswer[] = [], targets: ObjectId[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; guard < 60 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0); guard++) {
    const d = s.pending;
    if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.map((id) => ({ kind: 'object' as const, id })) });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
    else if (queue.length > 0 && queue[0]!.kind === d.kind) s = answer(s, queue.shift()!);
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected decision ${d.kind}: ${d.prompt}`);
  }
  return s;
}
const activate = (s: GameState, source: ObjectId): GameState => {
  const a = legalActions(s, s.pending!.player).find((x) => x.kind === 'activate' && x.object === source && !x.isMana);
  if (!a) throw new Error('no activation');
  return settle(act(s, a.action));
};
const cast = (s: GameState, name: string, answers: DecisionAnswer[] = [], targets: ObjectId[] = []): GameState =>
  settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), answers, targets);

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });

describe('CR 205.1b, 611.2a, 613.1d-e: "Until end of turn, this land becomes a 3/2 blue and black Elemental creature. It\'s still a land."', () => {
  const MIRE = card('Test Mire', 'Land', "{T}: Add {C}.\n{1}: Until end of turn, this land becomes a 3/2 blue and black Elemental creature. It's still a land.");
  it('is automated; it is a 3/2 blue and black Elemental Creature Land until end of turn, then a colorless land', () => {
    expect(full(MIRE)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Mire', 'Plains'] }, defs: [MIRE] });
    s = advanceTo(s, 1, 'main1');
    const mire = find(s, 'Test Mire', 'battlefield', 'p1');
    s = activate(s, mire);
    expect(types(s, mire)).toEqual(['Creature', 'Land']);
    expect(subtypes(s, mire)).toEqual(['Elemental']);
    expect([...getChars(s, mire)!.colors].sort()).toEqual(['B', 'U']);
    expect(pt(s, mire)).toBe('3/2');
    s = advanceTo(s, 2, 'main1');
    expect(types(s, mire)).toEqual(['Land']);
    expect(getChars(s, mire)!.colors).toEqual([]);
  });
});

describe('CR 205.1b, 611.2a: "Target land becomes a 2/2 green creature that\'s still a land." (no duration)', () => {
  const DRUID = card('Test Druid', 'Creature — Elf', "{T}: Target land becomes a 2/2 green creature that's still a land.", { pt: ['1', '1'] });
  it('is automated; the target is a 2/2 green Creature Land, also after the turn', () => {
    expect(full(DRUID)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Druid', 'Plains'] }, defs: [DRUID] });
    s = advanceTo(s, 1, 'main1');
    const plains = find(s, 'Plains', 'battlefield', 'p1');
    s = settle(act(s, legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.object === find(s, 'Test Druid', 'battlefield', 'p1'))!.action), [], [plains]);
    expect(types(s, plains)).toEqual(['Creature', 'Land']);
    expect(subtypes(s, plains)).toEqual(['Plains']);
    expect(getChars(s, plains)!.colors).toEqual(['G']);
    s = advanceTo(s, 2, 'main1');
    expect(types(s, plains)).toEqual(['Creature', 'Land']);
    expect(pt(s, plains)).toBe('2/2');
  });
});

describe('CR 205.1a, 611.2a: "Until end of turn, this artifact becomes a 2/1 blue and red Elemental artifact creature."', () => {
  const RUNE = card('Test Rune', 'Artifact', '{1}: Until end of turn, this artifact becomes a 2/1 blue and red Elemental artifact creature.');
  it('is automated; it is a 2/1 blue and red Elemental Artifact Creature until end of turn', () => {
    expect(full(RUNE)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Rune', 'Plains'] }, defs: [RUNE] });
    s = advanceTo(s, 1, 'main1');
    const rune = find(s, 'Test Rune', 'battlefield', 'p1');
    s = activate(s, rune);
    expect(types(s, rune)).toEqual(['Artifact', 'Creature']);
    expect(subtypes(s, rune)).toEqual(['Elemental']);
    expect([...getChars(s, rune)!.colors].sort()).toEqual(['R', 'U']);
    expect(pt(s, rune)).toBe('2/1');
    s = advanceTo(s, 2, 'main1');
    expect(types(s, rune)).toEqual(['Artifact']);
  });
});

describe('CR 700.9, 611.2c, 613.4b: "Until end of turn, each modified creature you control has base power and toughness 7/5."', () => {
  const CELLS = card('Test Cells', 'Instant', 'Until end of turn, each modified creature you control has base power and toughness 7/5.');
  it('is automated; a creature with a counter is 7/5 base (8/6 with its +1/+1 counter), one without is not; one modified later is not', () => {
    expect(full(CELLS)).toBe(true);
    let s = scenario([], { p1: { battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 1 } }, 'Test Bear'], hand: ['Test Cells'] }, defs: [CELLS, BEAR] });
    s = advanceTo(s, 1, 'main1');
    const [a, b] = s.zones.battlefield.filter((x) => s.objects[x]!.defId === 'Test Bear');
    const modified = s.objects[a!]!.counters['+1/+1'] ? a! : b!;
    const plain = modified === a ? b! : a!;
    s = cast(s, 'Test Cells');
    expect(pt(s, modified)).toBe('8/6');
    expect(pt(s, plain)).toBe('2/2');
    s = tweak(s, (x) => { x.objects[plain]!.counters['+1/+1'] = 1; });
    expect(pt(s, plain)).toBe('3/3');
  });
});
