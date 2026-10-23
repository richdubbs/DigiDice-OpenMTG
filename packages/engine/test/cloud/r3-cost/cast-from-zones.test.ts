/**
 * r3-cost: cost modifications of spells by where they are cast from (render/stat.ts#castFromZones; parser/templates/zz-cloud/r3-cost.json
 * eff.r3cost.costmod.spells.*), played with synthetic cards (design 6.10).
 *
 *   CR 601.2a, 601.2f   "Spells your opponents cast from graveyards or from exile cost {2} more to cast": an opponent's spell from a graveyard or exile, not
 *                       from a hand, and never a spell of yours
 *   CR 400.3            "Spells you cast from your graveyard or from exile cost {2} less to cast": your own graveyard only
 *   CR 400.3            "Spells you cast from anywhere other than your hand cost {1} less to cast": not from your hand; from your graveyard by a permission
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, GameState, ManaSymbol, ObjectId } from '../../../src/index';
import { modifiedPlan } from '../../../src/actions/cast';
import { emptyPlan } from '../../../src/rules/cost';
import { tweak } from '../../m4/helpers';
import { act, card, drive, find, full, legal, named, pool, scenario } from './support';

const manaText = (m: readonly ManaSymbol[]): string => m.map((x) => (x.kind === 'generic' ? `{${x.amount}}` : x.kind === 'colored' ? `{${x.color}}` : `{${x.kind}}`)).join('') || '{0}';
/** The total cost of casting `id` for `player`, after the cost modifiers (CR 601.2f), as fast3/t11 reads it. */
function costOf(s: GameState, id: ObjectId, def: CardDef, player = 'p1'): string {
  const m = modifiedPlan(s, player, id, { ...emptyPlan(), mana: (def.faces[0]!.manaCost ?? []).filter((x) => x.kind !== 'variable') });
  return 'plan' in m ? manaText(m.plan.mana) : `denied: ${m.denial.message}`;
}

const WARDEN = card('Test Exile Warden', 'Creature — Bird', 'Flying\nSpells your opponents cast from graveyards or from exile cost {2} more to cast.', '{2}{U}', ['2', '2']);
const SCHOLAR = card('Test Grave Scholar', 'Creature — Human', 'Spells you cast from your graveyard or from exile cost {2} less to cast.', '{1}{B}{G}', ['2', '2']);
const TRADER = card('Test Far Trader', 'Creature — Human', 'Spells you cast from anywhere other than your hand cost {1} less to cast.', '{2}{G}', ['2', '2']);
const DIGGER = card('Test Grave Digger', 'Enchantment', 'You may cast creature spells from your graveyard.', '{2}{B}');
const THOUGHT = card('Test Thought', 'Sorcery', 'Draw a card.', '{3}{B}');
const BEAR = card('Test Bear', 'Creature — Bear', '', '{2}{G}', ['2', '2']);
const DEFS = [WARDEN, SCHOLAR, TRADER, DIGGER, THOUGHT, BEAR];

/** Test setup: move one card of `player` from its zone to exile (as if an effect had exiled it). */
function toExile(s0: GameState, id: ObjectId): GameState {
  return tweak(s0, (x) => {
    const o = x.objects[id]!;
    const z = o.zone as 'hand' | 'graveyard';
    x.zones[z][o.owner] = x.zones[z][o.owner]!.filter((y) => y !== id);
    o.zone = 'exile';
    x.zones.exile.push(id);
  });
}

describe('r3-cost: the cards are automated', () => {
  it('each wording reads with its template and is full', () => {
    for (const d of DEFS) expect(full(d), d.name).toBe(true);
  });
});

describe('CR 601.2a, 601.2f: "Spells your opponents cast from graveyards or from exile cost {2} more to cast"', () => {
  it('an opponent\'s spell from a graveyard or from exile costs {2} more; from their hand it does not; a spell of yours never does', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Exile Warden'], graveyard: ['Test Thought'] }, p2: { hand: ['Test Thought', 'Test Thought'], graveyard: ['Test Thought'] } });
    const p2hand = s.zones.hand.p2!;
    s = toExile(s, p2hand[1]!);
    expect(costOf(s, find(s, 'Test Thought', 'graveyard', 'p2'), THOUGHT, 'p2')).toBe('{5}{B}');
    expect(costOf(s, s.zones.exile[0]!, THOUGHT, 'p2')).toBe('{5}{B}');
    expect(costOf(s, find(s, 'Test Thought', 'hand', 'p2'), THOUGHT, 'p2')).toBe('{3}{B}');
    expect(costOf(s, find(s, 'Test Thought', 'graveyard', 'p1'), THOUGHT, 'p1')).toBe('{3}{B}');
  });
});

describe('CR 400.3: "Spells you cast from your graveyard or from exile cost {2} less to cast"', () => {
  it('from your graveyard or from exile: {2} less; from your hand or from an opponent\'s graveyard: no change', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Grave Scholar'], hand: ['Test Thought', 'Test Thought'], graveyard: ['Test Thought'] }, p2: { graveyard: ['Test Thought'] } });
    s = toExile(s, s.zones.hand.p1![1]!);
    expect(costOf(s, find(s, 'Test Thought', 'graveyard', 'p1'), THOUGHT)).toBe('{1}{B}');
    expect(costOf(s, s.zones.exile[0]!, THOUGHT)).toBe('{1}{B}');
    expect(costOf(s, find(s, 'Test Thought', 'hand', 'p1'), THOUGHT)).toBe('{3}{B}');
    expect(costOf(s, find(s, 'Test Thought', 'graveyard', 'p2'), THOUGHT)).toBe('{3}{B}');
  });
});

describe('CR 400.3: "Spells you cast from anywhere other than your hand cost {1} less to cast"', () => {
  it('from your hand: no change; from your graveyard or exile: {1} less; an opponent\'s spell: no change', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Far Trader'], hand: ['Test Thought', 'Test Thought'], graveyard: ['Test Thought'] }, p2: { hand: ['Test Thought'], graveyard: ['Test Thought'] } });
    s = toExile(s, s.zones.hand.p1![1]!);
    expect(costOf(s, find(s, 'Test Thought', 'hand', 'p1'), THOUGHT)).toBe('{3}{B}');
    expect(costOf(s, find(s, 'Test Thought', 'graveyard', 'p1'), THOUGHT)).toBe('{2}{B}');
    expect(costOf(s, s.zones.exile[0]!, THOUGHT)).toBe('{2}{B}');
    expect(costOf(s, find(s, 'Test Thought', 'graveyard', 'p2'), THOUGHT, 'p2')).toBe('{3}{B}');
  });
  it('a creature cast from your graveyard by a permission is paid with {1} less (two Forests for a {2}{G} creature, one left untapped of three)', () => {
    let s = scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Test Far Trader', 'Test Grave Digger', 'Forest', 'Forest', 'Forest'], graveyard: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'graveyard');
    expect(costOf(s, bear, BEAR)).toBe('{1}{G}');
    expect(legal(s, 'p1', 'cast').some((a) => a.object === bear)).toBe(true);
    s = drive(act(s, { type: 'cast', player: 'p1', card: bear }), {});
    expect(s.zones.stack.map((id) => s.objects[id]!.defId)).toEqual(['Test Bear']); // a new object on the stack (CR 400.7)
    const forests = named(s, 'Forest');
    expect(forests.filter((id) => s.objects[id]!.tapped === true)).toHaveLength(2);
    expect(pool(s, 'p1')).toBe('');
  });
});
