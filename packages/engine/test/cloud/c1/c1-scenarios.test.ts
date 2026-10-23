/**
 * Cloud C1 (stack riders: "target spell can't be countered", "<spells> you control can't be countered this turn"), played through the engine with synthetic
 * cards compiled by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 101.2, 701.6a     "can't be countered": a counter instruction leaves the spell on the stack, and it resolves
 *   CR 611.2a, 400.7     a resolved effect with no duration lasts as long as its object exists (the spell, until it leaves the stack)
 *   CR 611.2c            a rule-modifying resolved effect ("spells you control") also applies to spells cast after it resolved
 *   CR 514.2             "this turn" ends in the cleanup step
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, life, pass, scenario } from '../../m3/scenario';
import { castCard } from '../../m5/announce/support';

function card(name: string, type: string, text: string, pt?: [string, string], colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** No ability of the card left manual (an experimental template caps the card level at partial, design 6.9). */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'))
  && (d.automation.faces ?? []).every((f) => f.abilities.every((a) => a.level !== 'manual' && a.manual.length === 0));

function settle(s0: GameState, targets: ObjectId[] = []): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.map((id) => ({ kind: 'object' as const, id })) });
    else break;
  }
  return s;
}
/** Both players pass until the stack is empty. */
function resolveAll(s0: GameState): GameState {
  let s = s0;
  for (let guard = 0; s.zones.stack.length > 0 && guard < 30; guard++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s);
  return s;
}
/** Both players pass once: the top object of the stack resolves. */
const resolveTop = (s: GameState): GameState => settle(pass(pass(s)));
/** `player` casts the named card from hand at the given targets (nothing resolves). */
const castBy = (s: GameState, player: 'p1' | 'p2', name: string, ...targets: ObjectId[]): GameState => settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), targets);

const TONIC = card('Test Tonic', 'Instant', 'You gain 2 life.', undefined, ['W']);
const NEGATE = card('Test Negate', 'Instant', 'Counter target spell.', undefined, ['U']);

describe('CR 101.2, 701.6a, 611.2a: "{0}: Target spell can\'t be countered." (eff.c1.target.cantbecountered)', () => {
  const WARDEN = card('Test Hush Warden', 'Creature — Goblin Shaman', "{0}: Target spell can't be countered.", ['1', '1'], ['R']);
  it('is automated', () => {
    expect(automated(WARDEN)).toBe(true);
    expect(automated(NEGATE)).toBe(true);
  });
  it('the spell it targets stays on the stack when an opponent counters it, and resolves', () => {
    let s = scenario([], { p1: { hand: ['Test Tonic'], battlefield: ['Test Hush Warden'] }, p2: { hand: ['Test Negate'] }, defs: [WARDEN, TONIC, NEGATE] });
    const before = life(s, 'p1');
    s = settle(castCard(s, 'Test Tonic'));
    const tonic = s.zones.stack[0]!;
    s = settle(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Hush Warden', 'battlefield', 'p1'), ability: 'p:0:0' }), [tonic]);
    s = resolveTop(s); // the Warden's ability resolves; Tonic is still on the stack
    expect(s.zones.stack).toEqual([tonic]);
    s = pass(s);
    s = castBy(s, 'p2', 'Test Negate', tonic);
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(before + 2);
  });
  it('without the ability the same counter instruction counters the spell (the control case)', () => {
    let s = scenario([], { p1: { hand: ['Test Tonic'], battlefield: ['Test Hush Warden'] }, p2: { hand: ['Test Negate'] }, defs: [WARDEN, TONIC, NEGATE] });
    const before = life(s, 'p1');
    s = settle(castCard(s, 'Test Tonic'));
    const tonic = s.zones.stack[0]!;
    s = pass(s);
    s = castBy(s, 'p2', 'Test Negate', tonic);
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(before);
  });
});

describe('CR 101.2, 611.2c: "You gain 1 life. Spells you control can\'t be countered this turn." (eff.c1.spells.cantbecountered.thisturn)', () => {
  const SHELTER = card('Test Shelter', 'Instant', "You gain 1 life. Spells you control can't be countered this turn.", undefined, ['G']);
  const TONIC2 = card('Test Elixir', 'Instant', 'You gain 3 life.', undefined, ['W']);
  it('is automated', () => {
    expect(automated(SHELTER)).toBe(true);
  });
  it('a spell its controller casts after it resolved can\'t be countered; a spell of the opponent still can', () => {
    let s = scenario([], { p1: { hand: ['Test Shelter', 'Test Tonic', 'Test Negate'] }, p2: { hand: ['Test Negate', 'Test Elixir'] }, defs: [SHELTER, TONIC, NEGATE, TONIC2] });
    const mine = life(s, 'p1');
    const theirs = life(s, 'p2');
    s = resolveAll(settle(castCard(s, 'Test Shelter')));
    expect(life(s, 'p1')).toBe(mine + 1);
    // p1's next spell, cast after the effect began (CR 611.2c: the set of spells is not locked in); the opponent answers with a spell of its own
    s = settle(castCard(s, 'Test Tonic'));
    const tonic = s.zones.stack[0]!;
    s = pass(s);
    s = castBy(s, 'p2', 'Test Elixir');
    const elixir = s.zones.stack[s.zones.stack.length - 1]!;
    expect(elixir).not.toBe(tonic);
    s = pass(s);
    // the opponent's spell is not one "you control": p1 counters it
    s = castBy(s, 'p1', 'Test Negate', elixir);
    s = pass(s);
    s = castBy(s, 'p2', 'Test Negate', tonic);
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(mine + 3);
    expect(life(s, 'p2')).toBe(theirs);
  });
});
