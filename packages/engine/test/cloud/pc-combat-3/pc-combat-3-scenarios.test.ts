/**
 * pc-combat-3 (Commander precon lane pc-combat): the round's readings played through the engine with synthetic cards compiled by the default compiler (design 6.10), four players.
 * CR cites from memory, unverified (no rules/cr in the cloud checkout).
 *
 *   CR 508.1b, 303.4  "Whenever a creature attacks enchanted player, put a +1/+1 counter on it." / "..., its controller gains 1 life."
 *   CR 506.3, 508.1b  "Exile target creature that's attacking you or a planeswalker you control."
 *   CR 508.1a-b, 603.2c  "Whenever an opponent attacks you [with two or more creatures], draw a card."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { cast } from '../cmd3/helpers';
import { answer, find, lifeOf, mpScenario, pass, passUntil, type MpScenario } from '../../m12/rules/helpers';

const card = (name: string, type: string, text: string, pt?: [string, string]): CardDef =>
  compileCard({ name, layout: 'normal', type_line: type, mana_cost: '{0}', oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as unknown as OracleCard);
const GROWTH = card('Test Hex of Growth', 'Enchantment — Aura Curse', 'Enchant player\nWhenever a creature attacks enchanted player, put a +1/+1 counter on it.');
const TITHE = card('Test Hex of Tithes', 'Enchantment — Aura Curse', 'Enchant player\nWhenever a creature attacks enchanted player, its controller gains 1 life.');
const SNARE = card('Test Warding Snare', 'Instant', 'Exile target creature that\'s attacking you or a planeswalker you control.');
const WATCH = card('Test Gate Watch', 'Creature — Human Soldier', 'Whenever an opponent attacks you with two or more creatures, draw a card.', ['1', '1']);
const WARDEN = card('Test Gate Warden', 'Creature — Human Soldier', 'Whenever an opponent attacks you, draw a card.', ['1', '1']);
const WALKER = card('Test Oath Walker', 'Legendary Planeswalker — Testa', '+1: You gain 1 life.');
const RAIDER = card('Test Hill Raider', 'Creature — Goblin', '', ['1', '1']);
const DEFS = [GROWTH, TITHE, SNARE, WATCH, WARDEN, WALKER, RAIDER];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => { for (const d of DEFS) expect(d.automation.level, `${d.name}: ${JSON.stringify(d.automation)}`).toBe('full'); });
});

const named = (s: GameState, name: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name && (p === undefined || s.objects[id]!.controller === p));
const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const WALK = { name: 'Test Oath Walker', counters: { loyalty: 3 } };

/** p2 attacks (turn 1 is p2's); returns the state right after the declaration, then resolves the stack with "yes" answers. */
function attack(s0: GameState, attacks: { attacker: ObjectId; defender: PlayerId | ObjectId }[], resolve = true): GameState {
  let s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === x.turn.activePlayer, 'the attack');
  s = answer(s, { kind: 'declareAttackers', attacks });
  for (let i = 0; resolve && i < 100 && (s.zones.stack.length > 0 || s.pending?.kind === 'order'); i++) {
    const d = s.pending;
    if (d?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, 1) });
    else if (d?.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((x) => x.id) });
    else if (d?.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected ${d?.kind}`);
  }
  return s;
}
const triggers = (s: GameState): number => (s.pending?.kind === 'order' ? s.pending.items.length : s.zones.stack.length);
const game = (zones: NonNullable<MpScenario['zones']>, aura?: string): GameState => mpScenario({
  defs: DEFS, options: { startingPlayer: 'p2' }, zones,
  ...(aura !== undefined ? { setup: (x: GameState) => { x.objects[find(x, aura, 'battlefield', 'p1')]!.attachedTo = 'p3'; } } : {}),
});

describe('CR 508.1b, 303.4: "Whenever a creature attacks enchanted player, put a +1/+1 counter on it." / "its controller gains 1 life"', () => {
  it('each creature attacking the enchanted p3 gets its own counter; one attacking p4 gets none', () => {
    let s = game({ p1: { battlefield: ['Test Hex of Growth'] }, p2: { battlefield: ['Test Hill Raider', 'Test Hill Raider', 'Test Hill Raider'] } }, 'Test Hex of Growth');
    const [a, b, c] = named(s, 'Test Hill Raider', 'p2');
    s = attack(s, [{ attacker: a!, defender: 'p3' }, { attacker: b!, defender: 'p3' }, { attacker: c!, defender: 'p4' }]);
    expect([a, b, c].map((id) => s.objects[id!]!.counters['+1/+1'] ?? 0)).toEqual([1, 1, 0]);
  });
  it('the attacker\'s controller (p2), not the Aura\'s controller (p1), gains the life; a planeswalker p3 controls is not "enchanted player"', () => {
    let s = game({ p1: { battlefield: ['Test Hex of Tithes'] }, p2: { battlefield: ['Test Hill Raider', 'Test Hill Raider'] }, p3: { battlefield: [WALK] } }, 'Test Hex of Tithes');
    const [a, b] = named(s, 'Test Hill Raider', 'p2');
    s = attack(s, [{ attacker: a!, defender: 'p3' }, { attacker: b!, defender: named(s, 'Test Oath Walker', 'p3')[0]! }]);
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([20, 21, 20, 20]);
  });
});

describe('CR 506.3, 508.1b: "Exile target creature that\'s attacking you or a planeswalker you control."', () => {
  function snare(defender: 'p1' | 'walker' | 'p3'): { s: GameState; raider: ObjectId } {
    let s = mpScenario({ defs: DEFS, options: { startingPlayer: 'p2' }, zones: { p1: { battlefield: [WALK], hand: ['Test Warding Snare'] }, p2: { battlefield: ['Test Hill Raider'] } } });
    const raider = named(s, 'Test Hill Raider', 'p2')[0]!;
    s = attack(s, [{ attacker: raider, defender: defender === 'walker' ? named(s, 'Test Oath Walker', 'p1')[0]! : defender }], false);
    for (let i = 0; i < 20 && !(s.pending?.kind === 'priority' && s.pending.player === 'p1'); i++) s = pass(s);
    return { s, raider };
  }
  const legalTargets = (s: GameState, raider: ObjectId): boolean => {
    try { const t = cast(s, 'Test Warding Snare', { targets: [{ kind: 'object', id: raider }] }, 'p1'); return t.zones.stack.length > 0 || t.pending?.kind === 'payCost'; } catch { return false; }
  };
  it('a creature attacking me, and one attacking my planeswalker, can be targeted', () => {
    expect(legalTargets(snare('p1').s, snare('p1').raider)).toBe(true);
    expect(legalTargets(snare('walker').s, snare('walker').raider)).toBe(true);
  });
  it('negative: a creature attacking p3 cannot be targeted', () => {
    const { s, raider } = snare('p3');
    expect(legalTargets(s, raider)).toBe(false);
  });
});

describe('CR 508.1a-b, 603.2c: "Whenever an opponent attacks you [with two or more creatures], draw a card."', () => {
  const setup = (watcher: string): GameState => mpScenario({ defs: DEFS, options: { startingPlayer: 'p2' }, zones: { p1: { battlefield: [watcher, WALK] }, p2: { battlefield: ['Test Hill Raider', 'Test Hill Raider'] } } });
  it('two creatures attacking me: one trigger; one creature attacking me: none (two or more)', () => {
    let s = setup('Test Gate Watch');
    const [a, b] = named(s, 'Test Hill Raider', 'p2');
    let t = attack(s, [{ attacker: a!, defender: 'p1' }, { attacker: b!, defender: 'p1' }], false);
    expect(triggers(t)).toBe(1);
    s = setup('Test Gate Watch');
    t = attack(s, [{ attacker: named(s, 'Test Hill Raider', 'p2')[0]!, defender: 'p1' }], false);
    expect(triggers(t)).toBe(0);
  });
  it('negative: two creatures attacking one at me and one at my planeswalker, or two at p3: no trigger', () => {
    let s = setup('Test Gate Watch');
    const [a, b] = named(s, 'Test Hill Raider', 'p2');
    expect(triggers(attack(s, [{ attacker: a!, defender: 'p1' }, { attacker: b!, defender: named(s, 'Test Oath Walker', 'p1')[0]! }], false))).toBe(0);
    s = setup('Test Gate Watch');
    const [c, d] = named(s, 'Test Hill Raider', 'p2');
    expect(triggers(attack(s, [{ attacker: c!, defender: 'p3' }, { attacker: d!, defender: 'p3' }], false))).toBe(0);
  });
  it('"Whenever an opponent attacks you" is one trigger for two attackers, and I (not the attacker) draw', () => {
    let s = setup('Test Gate Warden');
    const before = hand(s, 'p1');
    const [a, b] = named(s, 'Test Hill Raider', 'p2');
    s = attack(s, [{ attacker: a!, defender: 'p1' }, { attacker: b!, defender: 'p1' }]);
    expect(hand(s, 'p1')).toBe(before + 1);
  });
});
