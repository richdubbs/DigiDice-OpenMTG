/**
 * CMD3 (commander batch): echo (CR 702.30a), played through the engine with synthetic cards (wordings invented, design 6.10).
 *
 *   CR 702.30a  "At the beginning of your upkeep, if this permanent came under your control since the beginning of your last upkeep, sacrifice it unless you
 *               pay [cost]": once, at the first upkeep of its controller after it came under that player's control (an intervening if, CR 603.4)
 *   CR 118.12a  "unless you pay": the player decides whether to pay; not paying is the sacrifice
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { act, advanceTo, find, scenario } from '../../m3/scenario';
import { passUntil } from '../../m4/helpers';
import { card, cast, full, inYard, named, resolveAll, settle } from './helpers';

const RAVEN = card('Test Echo Raven', 'Creature — Bird', 'Flying\nEcho {1}', ['2', '2'], '{1}');
const LURKER = card('Test Echo Lurker', 'Creature — Faerie', 'Flash\nEcho {1}', ['1', '1'], '{1}');
const IMP = card('Test Echo Imp', 'Creature — Imp', 'Echo—Discard a card.', ['2', '2']);
const FILLER = card('Test Filler', 'Sorcery', 'You gain 1 life.');
const DEFS = [RAVEN, LURKER, IMP, FILLER];

const lands = ['Plains', 'Plains', 'Plains'];
/** Pass to the given upkeep and return the state with its triggers on the stack (or the upkeep with none). */
const toUpkeep = (s: GameState, turn: number): GameState => {
  const u = advanceTo(s, turn, 'upkeep');
  return u.zones.stack.length > 0 ? u : passUntil(u, (x) => x.zones.stack.length > 0 || x.turn.step !== 'upkeep', 'the upkeep triggers');
};

describe('the cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 702.30a: echo', () => {
  it('cast in your main phase: at your next upkeep you pay the echo cost and keep it; it never triggers again', () => {
    let s = scenario(lands, { p1: { hand: ['Test Echo Raven'], battlefield: lands }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Echo Raven'));
    const raven = find(s, 'Test Echo Raven', 'battlefield');
    s = toUpkeep(s, 3);
    expect(s.zones.stack).toHaveLength(1);
    s = resolveAll(s, { yes: true });
    expect(named(s, 'Test Echo Raven')).toEqual([raven]);
    s = toUpkeep(s, 5);
    expect(s.turn.number === 5 && s.zones.stack.length).toBe(0); // it came under your control before your last upkeep
    expect(named(s, 'Test Echo Raven')).toEqual([raven]);
  });

  it("not paid: it is sacrificed (CR 118.12a)", () => {
    let s = scenario(lands, { p1: { hand: ['Test Echo Raven'], battlefield: lands }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Echo Raven'));
    s = resolveAll(toUpkeep(s, 3), { yes: false });
    expect(named(s, 'Test Echo Raven')).toEqual([]);
    expect(inYard(s, 'Test Echo Raven')).toBe(true);
  });

  it("not in the opponent's upkeep: the trigger is \"your upkeep\"", () => {
    let s = scenario(lands, { p1: { hand: ['Test Echo Raven'], battlefield: lands }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Echo Raven'));
    s = advanceTo(s, 2, 'upkeep');
    s = passUntil(s, (x) => x.zones.stack.length > 0 || x.turn.step !== 'upkeep', 'the end of the upkeep');
    expect(s.zones.stack).toHaveLength(0);
  });

  it("it entered during the opponent's turn: it triggers at your next upkeep (it came under your control since your last one)", () => {
    let s = scenario(lands, { p1: { hand: ['Test Echo Lurker'], battlefield: lands }, defs: DEFS });
    s = advanceTo(s, 2, 'main1');
    s = passUntil(s, (x) => x.pending?.player === 'p1', 'priority for p1');
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Echo Lurker', 'hand') })));
    const lurker = find(s, 'Test Echo Lurker', 'battlefield');
    expect(s.objects[lurker]!.controlledSinceTurn).toBe(2);
    s = toUpkeep(s, 3);
    expect(s.zones.stack).toHaveLength(1);
    s = resolveAll(s, { yes: false });
    expect(named(s, 'Test Echo Lurker')).toEqual([]);
  });

  it('a permanent you have controlled since before your last upkeep does not trigger', () => {
    let s = scenario(lands, { p1: { battlefield: [...lands, 'Test Echo Raven'] }, defs: DEFS });
    s = toUpkeep(s, 3);
    expect(s.turn.number === 3 && s.zones.stack.length).toBe(0);
    expect(named(s, 'Test Echo Raven')).toHaveLength(1);
  });

  it('a cost other than mana: "Echo—Discard a card" is paid by discarding, or the permanent is sacrificed', () => {
    let s = scenario(lands, { p1: { hand: ['Test Echo Imp', 'Test Filler'], battlefield: lands }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Echo Imp'));
    const hand = s.zones.hand['p1']!.length;
    s = resolveAll(toUpkeep(s, 3), { yes: true });
    expect(named(s, 'Test Echo Imp')).toHaveLength(1);
    expect(s.zones.hand['p1']!.length).toBe(hand - 1); // turn 3 has no draw yet: the upkeep comes first (CR 503, 504)
    expect(s.zones.graveyard['p1']!.length).toBe(1);
    let n = scenario(lands, { p1: { hand: ['Test Echo Imp', 'Test Filler'], battlefield: lands }, defs: DEFS });
    n = resolveAll(toUpkeep(resolveAll(cast(n, 'Test Echo Imp')), 3), { yes: false });
    expect(named(n, 'Test Echo Imp')).toEqual([]);
    expect(n.zones.hand['p1']!.length).toBe(1);
  });
});
