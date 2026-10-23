/**
 * Wave 7 merge (r4-copy + r4-repl), CR 616.1, 616.1e, 614.1a: two replacement effects of your token creation, r4-copy's optional "The first time you would create one
 * or more tokens each turn, you may instead create that many tokens that are copies of enchanted permanent." (Moonlit Meditation) and r4-repl's "If one or more
 * tokens would be created under your control, those tokens plus a Food token are created instead." Neither is a self-replacement effect (CR 616.1a), so the
 * affected player chooses which applies first (effects/propose.ts: an optional effect is never order-free); neither silently pre-empts the other.
 * (r4-repl's rid.r4repl.instead.tokens.count, "If ~ was kicked, create three of those tokens instead", is the instruction's own rider: its count is settled
 * before the token event is proposed, as a self-replacement effect applies first, CR 614.15, 616.1a.)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const GIANT = card('Test Giant', 'Creature — Giant', '', ['4', '4']);
const MOON = card('Test Moon', 'Enchantment — Aura', 'Enchant artifact or creature you control\nThe first time you would create one or more tokens each turn, you may instead create that many tokens that are copies of enchanted permanent.');
const PANTRY = card('Test Pantry', 'Enchantment', 'If one or more tokens would be created under your control, those tokens plus a Food token are created instead.');
const MUSTER = card('Test Muster', 'Sorcery', 'Create two 1/1 white Soldier creature tokens.');
const DEFS = [GIANT, MOON, PANTRY, MUSTER];

/** Answers the decisions on the way (targets from `targets`, others from `answers`); stops at an unanswered decision. */
function run(s0: GameState, answers: DecisionAnswer[], targets: TargetChoice[][] = []): GameState {
  let s = s0;
  for (let guard = 0; guard < 80; guard++) {
    if (s.pending?.kind === 'priority') {
      if (s.zones.stack.length === 0) break;
      s = pass(s);
    } else if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending?.kind === 'chooseTargets' && targets.length > 0) s = answer(s, { kind: 'chooseTargets', targets: targets.shift()! });
    else if (s.pending && answers.length > 0) s = answer(s, answers.shift()!);
    else break;
  }
  return s;
}
const count = (s: GameState, pred: (n: string, sub: readonly string[]) => boolean): number =>
  s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && pred(getChars(s, id).name, getChars(s, id).subtypes)).length;

describe('CR 616.1, 616.1e (wave 7 merge): r4-copy\'s first-tokens-as-copies and r4-repl\'s plus-a-Food replacement: the player orders them', () => {
  it('both cards are automated', () => {
    expect(full(MOON)).toBe(true);
    expect(full(PANTRY)).toBe(true);
  });
  const setup = (): GameState => {
    let s = scenario([], { p1: { hand: ['Test Moon', 'Test Muster'], battlefield: ['Test Giant', 'Test Pantry'] }, defs: DEFS });
    const giant = find(s, 'Test Giant', 'battlefield', 'p1');
    s = run(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Moon', 'hand', 'p1') }), [], [[{ kind: 'object', id: giant }]]);
    return run(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Muster', 'hand', 'p1') }), []);
  };
  it('the token event asks p1 which replacement applies first, with both offered', () => {
    const s = setup();
    expect(s.pending?.kind).toBe('chooseReplacement');
    expect(s.pending?.player).toBe('p1');
    const labels = (s.pending as unknown as { options: { label: string }[] }).options.map((o) => o.label).join(' | ');
    expect(labels).toContain('Test Moon');
    expect(labels).toContain('Test Pantry');
  });
  it('the Moon first, accepted: Giant copies instead of the Soldiers, and the Pantry still adds its Food to the tokens created', () => {
    let s = setup();
    const moon = (s.pending as unknown as { options: { id: string; label: string }[] }).options.find((o) => o.label.includes('Test Moon'))!;
    s = run(s, [{ kind: 'chooseReplacement', id: moon.id } as DecisionAnswer, { kind: 'yesNo', yes: true }]);
    expect(count(s, (n) => n === 'Test Giant')).toBe(2);
    expect(count(s, (_n, sub) => sub.includes('Soldier'))).toBe(0);
    expect(count(s, (_n, sub) => sub.includes('Food'))).toBe(1);
  });
  // w8-followups (CR 614.5, 616.1, 616.1e): with the Pantry first, its Food is created by steps right after the event (effects/bodies/m5.ts#thenAfterCreate, base
  // r3-repl design: an effect applied after it applies to the added tokens too); the Moon, applied after it, is asked ONCE and its answer holds for the Food
  // (wave 7 asked again for the Food, and mixed answers gave two Soldiers and a Giant copy, which the rules do not allow)
  it('the Pantry first, the Moon declined once: the Soldiers plus a Food, and the Moon is not asked again for the Food', () => {
    let s = setup();
    const pantry = (s.pending as unknown as { options: { id: string; label: string }[] }).options.find((o) => o.label.includes('Test Pantry'))!;
    s = run(s, [{ kind: 'chooseReplacement', id: pantry.id } as DecisionAnswer, { kind: 'yesNo', yes: false }]);
    expect(s.pending?.kind).toBe('priority');
    expect(count(s, (_n, sub) => sub.includes('Soldier'))).toBe(2);
    expect(count(s, (_n, sub) => sub.includes('Food'))).toBe(1);
    expect(count(s, (n) => n === 'Test Giant')).toBe(0);
  });
  it('the Pantry first, the Moon accepted once: three Giant copies (the two Soldiers and the Food, "that many", CR 616.1e), no second question', () => {
    let s = setup();
    const pantry = (s.pending as unknown as { options: { id: string; label: string }[] }).options.find((o) => o.label.includes('Test Pantry'))!;
    s = run(s, [{ kind: 'chooseReplacement', id: pantry.id } as DecisionAnswer, { kind: 'yesNo', yes: true }]);
    expect(s.pending?.kind).toBe('priority');
    expect(count(s, (n) => n === 'Test Giant')).toBe(3);
    expect(count(s, (_n, sub) => sub.includes('Soldier') || sub.includes('Food'))).toBe(0);
  });
  it('mixed answers are impossible: after the one answer for the event no question is left, whichever answer was given (CR 616.1e)', () => {
    for (const yes of [true, false]) {
      let s = setup();
      const pantry = (s.pending as unknown as { options: { id: string; label: string }[] }).options.find((o) => o.label.includes('Test Pantry'))!;
      s = run(s, [{ kind: 'chooseReplacement', id: pantry.id } as DecisionAnswer]);
      expect(s.pending?.kind).toBe('yesNo');
      s = answer(s, { kind: 'yesNo', yes });
      s = run(s, []);
      expect(s.pending?.kind).toBe('priority');
      expect(s.zones.stack.length).toBe(0);
      const giants = count(s, (n) => n === 'Test Giant');
      const others = count(s, (_n, sub) => sub.includes('Soldier') || sub.includes('Food'));
      expect([giants, others]).toEqual(yes ? [3, 0] : [0, 3]);
    }
  });
});
