/**
 * pc-keywords-mana-3 (precon lane keywords-mana): "faces a villainous choice" played through the engine with synthetic cards (invented names, design 6.10). CR cites from
 * memory in a cloud session (no rules/cr/): unverified.
 *
 *   CR 701.55 (Doctor Who)  the player who faces the choice picks one of two options and it is carried out; "that player"/"they" are that player, "you" the controller
 *   CR 608.2f, 119.3        "each opponent who lost 3 or more life this turn faces ...": only an opponent who did
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type OracleCard } from '../../../src/index';
import { cast, drive, pass, resolveAll, scenario, target } from '../../m6/dfc/support';

function card(name: string, type: string, text: string, cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [] } as OracleCard);
}
const noManual = (d: CardDef): boolean => d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const hand = (s: GameState, p: 'p1' | 'p2'): number => s.zones.hand[p]!.length;
const life = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const yes = (y: boolean): DecisionAnswer => ({ kind: 'yesNo', yes: y }) as DecisionAnswer;

describe('CR 701.55: each opponent faces a villainous choice', () => {
  const PACT = card('Test Dread Pact', 'Sorcery', 'Each opponent faces a villainous choice -- That player discards a card, or you draw a card.');
  const board = (): GameState => scenario(['Plains'], { defs: [PACT], p1: { hand: ['Test Dread Pact'] }, p2: { hand: ['Plains', 'Plains'] } });
  it('compiles full', () => expect(noManual(PACT)).toBe(true));
  it('the opponent chooses the first option: they discard a card and you draw nothing', () => {
    const s0 = board();
    const h1 = hand(s0, 'p1') - 1; // the pact leaves the hand
    const s = resolveAll(cast(s0, 'Test Dread Pact'), [yes(true), { kind: 'chooseObjects', ids: [s0.zones.hand.p2![0]!] } as DecisionAnswer]);
    expect(hand(s, 'p2')).toBe(1);
    expect(hand(s, 'p1')).toBe(h1);
  });
  it('the opponent (not the caster) is the one asked, and may pick an option they cannot carry out (an empty hand, option one): nothing happens', () => {
    const s0 = scenario(['Plains'], { defs: [PACT], p1: { hand: ['Test Dread Pact'] }, p2: { hand: [] } });
    const asked = drive(cast(s0, 'Test Dread Pact'), []);
    const t0 = drive(pass(pass(asked)), []);
    expect(t0.pending?.kind).toBe('yesNo');
    expect(t0.pending?.player).toBe('p2');
    const t = drive(t0, [yes(true)]);
    expect(hand(t, 'p2')).toBe(0);
    expect(hand(t, 'p1')).toBe(hand(s0, 'p1') - 1);
    expect(t.pending?.kind).toBe('priority');
  });
  it('the opponent chooses the second option: you draw a card and they discard nothing', () => {
    const s0 = board();
    const h1 = hand(s0, 'p1') - 1;
    const s = resolveAll(cast(s0, 'Test Dread Pact'), [yes(false)]);
    expect(hand(s, 'p2')).toBe(2);
    expect(hand(s, 'p1')).toBe(h1 + 1);
  });
});

describe('CR 701.55: a targeted player faces the choice', () => {
  const PLAN = card('Test Grim Plan', 'Sorcery', 'Target opponent faces a villainous choice -- They lose 3 life, or you draw two cards.');
  const board = (): GameState => scenario(['Plains'], { defs: [PLAN], p1: { hand: ['Test Grim Plan'] } });
  it('first option: they lose 3 life; second: you draw two cards', () => {
    const s0 = board();
    const a = resolveAll(cast(s0, 'Test Grim Plan', [target('p2')]), [yes(true)]);
    expect(life(a, 'p2')).toBe(17);
    expect(hand(a, 'p1')).toBe(hand(s0, 'p1') - 1);
    const b = resolveAll(cast(s0, 'Test Grim Plan', [target('p2')]), [yes(false)]);
    expect(life(b, 'p2')).toBe(20);
    expect(hand(b, 'p1')).toBe(hand(s0, 'p1') - 1 + 2);
  });
});

describe('CR 119.3, 701.55: each opponent who lost 3 or more life this turn', () => {
  const BURN = card('Test Small Burn', 'Instant', 'Each opponent loses 3 life.');
  const BITE = card('Test Tiny Burn', 'Instant', 'Each opponent loses 2 life.');
  const WRATH = card('Test Judging Eye', 'Sorcery', 'Each opponent who lost 3 or more life this turn faces a villainous choice -- You draw a card, or that player discards a card.');
  it('an opponent who lost 3 life is asked; one who lost only 2 is not', () => {
    expect(noManual(WRATH)).toBe(true);
    const mk = (first: string): GameState => scenario(['Plains'], { defs: [BURN, BITE, WRATH], p1: { hand: [first, 'Test Judging Eye'] }, p2: { hand: ['Plains'] } });
    const s1 = resolveAll(cast(mk('Test Small Burn'), 'Test Small Burn'));
    expect(life(s1, 'p2')).toBe(17);
    const asked = drive(cast(s1, 'Test Judging Eye'), []);
    const q = drive(pass(pass(asked)), []);
    expect(q.pending?.kind).toBe('yesNo');
    expect(q.pending?.player).toBe('p2');
    const t = resolveAll(asked, [yes(true)]); // first option: you draw a card
    expect(hand(t, 'p1')).toBe(hand(s1, 'p1') - 1 + 1);
    const s2 = resolveAll(cast(mk('Test Tiny Burn'), 'Test Tiny Burn'));
    const u = resolveAll(cast(s2, 'Test Judging Eye'), []);
    expect(u.pending?.kind).toBe('priority'); // nobody was asked
    expect(u.zones.stack).toEqual([]);
    expect(hand(u, 'p1')).toBe(hand(s2, 'p1') - 1);
    expect(hand(u, 'p2')).toBe(1);
  });
});
