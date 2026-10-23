/**
 * WP13: addMana (CR 106.1b, 106.3, 106.4, 106.6, 107.4h, 605.3b).
 */
import { describe, expect, it, vi } from 'vitest';
import type { GameState, ManaRestriction } from '../../../src/index';
import { Game } from '../../../src/core/game';
import { activateManaAbility } from '../../../src/rules/mana';
import { normalize } from '../../../src/triggers/normalize';
import { clone } from '../../../src/util/clone';
import { find, scenario } from '../helpers';
import { onStack, prog, runAll, runOn, sorcery } from './harness';

vi.mock('../../../src/effects/propose', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./fakes')).proposeModule() }));
vi.mock('../../../src/effects/manual', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./fakes')).manualModule() }));

const SPELL = 'Test Mana Spell';
const s0 = scenario(['Llanowar Elves', 'Snow-Covered Forest', 'Forest'], { p1: { battlefield: ['Llanowar Elves', 'Snow-Covered Forest'] }, defs: [sorcery(SPELL, prog([]))] });
const you = { ref: 'you' } as const;
const pool = (s: GameState, p = 'p1') => s.players.find((x) => x.id === p)!.manaPool;
const elves = find(s0, 'Llanowar Elves', 'battlefield');

describe('addMana (CR 106)', () => {
  it('CR 106.3, 106.4: with no stack object the mana is added and the unit records its source; the handler does not claim an activation (CR 605.3b is the activation path\'s to say)', () => {
    const out = runOn(s0, elves, prog([{ op: 'addMana', who: you, units: [['G']] }]));
    expect(pool(out.s)).toEqual([{ type: 'G', sourceId: elves, sourceSubtypes: ['Elf', 'Druid'] }]); // FAST5X E19 (CR 106.3): the source's subtypes as it produced the mana
    expect(out.events).toEqual([{ type: 'manaAdded', player: 'p1', mana: ['G'], sourceId: elves }]);
    expect(out.results.get('#0')).toEqual({ performed: true, count: 1 });
  });

  it('CR 106.3: mana a spell produces has that spell as its source; mana from a non-mana ability on the stack has the source of that ability as its source', () => {
    const spell = onStack(s0, { name: SPELL });
    expect(pool(runOn(spell.s, spell.id, prog([{ op: 'addMana', who: you, units: [['B'], ['B']] }])).s)).toEqual([{ type: 'B', sourceId: spell.id }, { type: 'B', sourceId: spell.id }]);
    const ability = onStack(s0, { name: 'Llanowar Elves', kind: 'triggered', sourceId: elves });
    const out = runOn(ability.s, ability.id, prog([{ op: 'addMana', who: you, units: [['C']] }]));
    expect(pool(out.s)).toEqual([{ type: 'C', sourceId: elves, sourceSubtypes: ['Elf', 'Druid'] }]);
    expect(out.events).toEqual([{ type: 'manaAdded', player: 'p1', mana: ['C'], sourceId: elves }]);
  });

  it('CR 605.1b, 605.4a: the mana of a triggered mana ability (no stack object) is not an activation, so a "tap for mana" trigger cannot trigger on its own mana', () => {
    const out = runOn(s0, elves, prog([{ op: 'addMana', who: you, units: [['G']] }]));
    const g = new Game(clone(out.s));
    expect(normalize(g, out.events, 1).filter((e) => e.ev === 'activate')).toEqual([]);
  });

  it('CR 605.3b: activating a mana ability (milestone 3\'s activation path) marks the mana as added by an activation, which the normalizer reads as one', () => {
    const g = new Game(clone(s0));
    activateManaAbility(g, 'p1', elves, 'p:0:0');
    const added = g.events.filter((e) => e.type === 'manaAdded');
    expect(added).toEqual([{ type: 'manaAdded', player: 'p1', mana: ['G'], sourceId: elves, viaActivation: true, tapped: true }]); // std-mana-1: its cost has {T} (CR 106.12)
    expect(normalize(g, added, 1).map((e) => [e.ev, e.data['mana']])).toEqual([['activate', true]]);
  });

  it('CR 106.1b: a unit with several possible types asks the player which one', () => {
    const program = prog([{ op: 'addMana', who: you, units: [['R', 'G']] }]);
    const first = runOn(s0, elves, program);
    expect(first.pending).toMatchObject({ kind: 'chooseColor', player: 'p1', options: ['R', 'G'] });
    expect(pool(runOn(s0, elves, program, [{ kind: 'chooseColor', color: 'R' }]).s).map((u) => u.type)).toEqual(['R']);
  });

  it('CR 106.1b, 106.4: "N mana in any combination of colors" asks for each unit; "N mana of any one color" asks once', () => {
    const colors = ['W', 'U'] as const;
    let asked = 0;
    const any = runAll(s0, elves, prog([{ op: 'addMana', who: you, dynamic: { kind: 'anyColor', count: 2 } }]), () => ({ kind: 'chooseColor', color: colors[asked++]! }));
    expect(any.decisions).toHaveLength(2);
    expect(pool(any.s).map((u) => u.type)).toEqual(['W', 'U']);
    const one = runAll(s0, elves, prog([{ op: 'addMana', who: you, dynamic: { kind: 'anyOneColor', count: 3 } }]), () => ({ kind: 'chooseColor', color: 'B' }));
    expect(one.decisions).toHaveLength(1);
    expect(pool(one.s).map((u) => u.type)).toEqual(['B', 'B', 'B']);
  });

  it('CR 106.4, 107.1b: "an amount of {G} equal to ..." (a quantity); 0 adds nothing', () => {
    const out = runOn(s0, elves, prog([{ op: 'addMana', who: you, dynamic: { kind: 'ofType', type: 'G', count: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } } } }]));
    expect(pool(out.s).map((u) => u.type)).toEqual(['G']);
    const none = runOn(s0, elves, prog([{ op: 'addMana', who: you, dynamic: { kind: 'ofType', type: 'G', count: 0 } }]));
    expect(none.events).toEqual([]);
    expect(none.results.get('#0')).toEqual({ performed: false, count: 0 });
  });

  it('CR 607.2d: "mana of the chosen color" reads the linked choice of the source; no choice means no mana (CR 607.5a)', () => {
    const chosen = structuredClone(s0);
    chosen.objects[elves]!.links = { color: { values: ['blue'] } };
    const program = prog([{ op: 'addMana', who: you, dynamic: { kind: 'chosen', link: 'color', count: 2 } }]);
    expect(pool(runOn(chosen, elves, program).s).map((u) => u.type)).toEqual(['U', 'U']);
    expect(pool(runOn(s0, elves, program).s)).toEqual([]);
  });

  it('CR 106.1b, 608.2: "one mana of any type that was spent to activate this ability" reads the mana paid; without a record the players resolve it by hand', () => {
    const paid = onStack(s0, { name: 'Llanowar Elves', kind: 'activated', sourceId: elves, costsPaid: { manaSpent: [{ type: 'R' }, { type: 'G' }] } });
    const program = prog([{ op: 'addMana', who: you, dynamic: { kind: 'sameAsSpent' } }]);
    expect(runOn(paid.s, paid.id, program).pending).toMatchObject({ kind: 'chooseColor', options: ['R', 'G'] });
    const manual = runOn(s0, elves, program);
    expect(manual.pending).toMatchObject({ kind: 'manualResolve', player: 'p1' });
  });

  it('CR 107.4h: mana produced by a snow source is snow mana', () => {
    const snow = find(s0, 'Snow-Covered Forest', 'battlefield');
    expect(pool(runOn(s0, snow, prog([{ op: 'addMana', who: you, units: [['G']] }])).s)).toEqual([{ type: 'G', sourceId: snow, snow: true, sourceSubtypes: ['Forest'] }]);
  });

  it('CR 106.6: a spending restriction travels with every unit (a copy, never shared with the card definition)', () => {
    const restriction: ManaRestriction = { spells: { types: ['Creature'] }, spellRider: 'cantBeCountered' };
    const program = prog([{ op: 'addMana', who: you, units: [['G'], ['G']], restriction }]);
    const out = runOn(s0, elves, program);
    expect(pool(out.s).map((u) => u.restriction)).toEqual([restriction, restriction]);
    expect(pool(out.s)[0]!.restriction).not.toBe(restriction);
    expect(out.s.log.some((l) => l.text === 'Alice adds {G}{G} (restricted).' && l.rules?.includes('CR 106.6'))).toBe(true);
  });

  it('CR 101.4, 106.4: each player adds mana in APNAP order', () => {
    const spell = onStack(s0, { name: SPELL });
    const out = runOn(spell.s, spell.id, prog([{ op: 'addMana', who: { ref: 'each', who: 'player' }, units: [['C']] }]));
    expect(pool(out.s, 'p1')).toHaveLength(1);
    expect(pool(out.s, 'p2')).toHaveLength(1);
    expect(out.results.get('#0')!.count).toBe(2);
  });
});
