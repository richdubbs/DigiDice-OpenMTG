/**
 * Wave 7 merge line r4-repl: review checks of the PR's engine changes (each test named after the rule it checks; cites from memory, rules/cr is not in this
 * checkout). Synthetic cards (invented names, design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const counters = (s: GameState, id: ObjectId, kind = '+1/+1'): number => s.objects[id]!.counters?.[kind] ?? 0;
function drive(s0: GameState, targets: TargetChoice[][] = []): GameState {
  let s = s0;
  const t = [...targets];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: t.shift() ?? [] });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

describe('wave 7 review: Torgal-style "that creature enters with an additional +1/+1 counter on it for each ..." (CR 608.2h, 611.2c)', () => {
  const HOUND = card('Test Hound', 'Creature — Wolf', 'Whenever you cast a creature spell, that creature enters with an additional +1/+1 counter on it for each Elf you control.', { pt: ['3', '3'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'] });
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
  it('CR 608.2h: the number of Elves is counted as the trigger resolves; an Elf that dies before the spell resolves does not change it', () => {
    let s = scenario([], { defs: [HOUND, BEAR, ELF, KILL], p1: { hand: ['Test Bear', 'Test Kill'], battlefield: ['Test Hound', 'Test Elf', 'Test Elf'] } });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bear', 'hand', 'p1') }));
    s = drive(pass(pass(s))); // the trigger resolves; the Bear is still on the stack
    expect(s.zones.stack).toHaveLength(1);
    const elf = find(s, 'Test Elf', 'battlefield');
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Kill', 'hand', 'p1') }), [[obj(elf)]]);
    for (let i = 0; i < 8 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)));
    expect(findAll(s, 'Test Elf', 'battlefield')).toHaveLength(1);
    expect(counters(s, find(s, 'Test Bear', 'battlefield'))).toBe(2);
  });
});

describe('wave 7 review: the draw of the draw step proposed as a draw of one or more cards (drawMany), then each card on its own (CR 504.1, 121.2, 614.1a)', () => {
  const RIDDLER = card('Test Riddler', 'Creature — Sphinx', 'As long as you have one or fewer cards in hand, if you would draw one or more cards, you draw that many cards plus one instead.', { pt: ['4', '4'] });
  const REFLECT = card('Test Reflection', 'Enchantment', 'If you would draw a card, draw two cards instead.');
  const CONUNDRUM = card('Test Conundrum', 'Creature — Elemental', 'If you would draw a card while your library has no cards in it, skip that draw instead.', { pt: ['2', '2'] });
  it('CR 504.1, 121.2: with no replacement, the draw step draws one card', () => {
    const s = advanceTo(scenario([], {}), 3, 'draw');
    expect(s.zones.hand.p1).toHaveLength(1);
  });
  it('CR 121.2, 614.1a: "if you would draw one or more cards, you draw that many plus one instead" changes the draw step\'s draw: two cards', () => {
    const s = advanceTo(scenario([], { defs: [RIDDLER], p1: { battlefield: ['Test Riddler'] } }), 3, 'draw');
    expect(s.zones.hand.p1).toHaveLength(2);
  });
  it('CR 121.6, 614.1a: a single-draw replacement ("If you would draw a card, draw two cards instead") still applies to the draw step\'s card', () => {
    const s = advanceTo(scenario([], { defs: [REFLECT], p1: { battlefield: ['Test Reflection'] } }), 3, 'draw');
    expect(s.zones.hand.p1).toHaveLength(2);
  });
  it('CR 614.10, 121.3: "skip that draw" applies to the draw step\'s card one by one (an empty library: no card, no loss)', () => {
    let s = scenario([], { defs: [CONUNDRUM], p1: { battlefield: ['Test Conundrum'] } });
    for (const id of s.zones.library.p1!) delete s.objects[id];
    s.zones.library.p1 = [];
    s = advanceTo(s, 3, 'main1');
    expect(s.zones.hand.p1).toHaveLength(0);
    expect(s.players.find((p) => p.id === 'p1')!.hasLost).toBe(false);
  });
});
