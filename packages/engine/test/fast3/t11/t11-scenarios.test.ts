/**
 * FAST3 T11: the shapes of parser/templates/zz-fast3/t11.json (and the render support they needed) played through the engine with synthetic cards compiled by
 * the game's default compiler (invented wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 601.2c, 601.2f   "~ costs {1} more to cast for each target beyond the first": read from the targets announced before the total cost
 *   CR 601.2f, 305.6    "~ costs {1} less to cast for each basic land type among lands you control": the five basic land types, each once (domain)
 *   CR 601.2a, 400.3    "Spells you cast from your graveyard cost {1} less to cast": only from your own graveyard, only when you cast them
 *   CR 611.3a, 500.1    "During turns other than yours, spells you cast cost {1} less to cast."
 *   CR 601.2f, 601.2i   "The second spell you cast each turn costs {1} less to cast."
 *   CR 106.4, 107.3     "{T}: Add X mana of any one color, where X is ~'s power" (and "the number of Elves on the battlefield", CR 110.1)
 *   CR 605.1b, 607.2d   "Whenever enchanted land is tapped for mana, its controller adds an additional one mana of the chosen color."
 *   CR 601.2f, 205.2    "~ costs {1} less to cast for each instant and sorcery card in your graveyard" (a card that is both counts once)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type Color, type GameState, type ManaSymbol, type ObjectId, type OracleCard } from '../../../src/index';
import { modifiedPlan } from '../../../src/actions/cast';
import { emptyPlan } from '../../../src/rules/cost';
import { act, answer, find, legal, pool, put, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const manaText = (m: readonly ManaSymbol[]): string => m.map((x) => (x.kind === 'generic' ? `{${x.amount}}` : x.kind === 'colored' ? `{${x.color}}` : `{${x.kind}}`)).join('') || '{0}';
/** The total cost of casting `id` (a card in any zone, or a spell on the stack) for `player`, after the cost modifiers (CR 601.2f). */
function costOf(s: GameState, id: ObjectId, def: CardDef, player = 'p1'): string {
  const m = modifiedPlan(s, player, id, { ...emptyPlan(), mana: (def.faces[0]!.manaCost ?? []).filter((x) => x.kind !== 'variable') });
  return 'plan' in m ? manaText(m.plan.mana) : `denied: ${m.denial.message}`;
}

const VOLLEY = card('Test Volley', 'Sorcery', 'This spell costs {1} more to cast for each target beyond the first.\nUntap any number of target lands.', { cost: '{1}{U}', colors: ['U'] });
const STRATA = card('Test Strata', 'Creature — Beast', 'This spell costs {1} less to cast for each basic land type among lands you control.', { cost: '{7}{G}', colors: ['G'], pt: ['5', '5'] });
const DUAL = card('Test Dual', 'Land — Swamp Mountain', '');
const GATE = card('Test Gate', 'Land — Gate', '');
const GEIST = card('Test Geist', 'Creature — Spirit', 'Spells you cast from your graveyard cost {1} less to cast.', { cost: '{2}{B}', colors: ['B'], pt: ['2', '2'] });
const DRAKE = card('Test Drake', 'Creature — Drake', 'During turns other than yours, spells you cast cost {2} less to cast.', { cost: '{3}{U}', colors: ['U'], pt: ['2', '2'] });
const RINGER = card('Test Ringer', 'Creature — Faerie', 'The second spell you cast each turn costs {1} less to cast.', { cost: '{1}{U}', colors: ['U'], pt: ['1', '1'] });
const THOUGHT = card('Test Thought', 'Sorcery', 'Draw a card.', { cost: '{3}{B}', colors: ['B'] });
const QUICK = card('Test Quick Thought', 'Instant', 'Draw a card.', { cost: '{1}{U}', colors: ['U'] });
const ELITE = card('Test Elite', 'Creature — Human Warrior', "{T}: Add X mana of any one color, where X is this creature's power.", { cost: '{2}{G}', colors: ['G'], pt: ['3', '1'] });
const CHANNELER = card('Test Channeler', 'Creature — Elf Druid', '{T}: Add X mana of any one color, where X is the number of Elves on the battlefield.', { cost: '{3}{G}', colors: ['G'], pt: ['1', '3'] });
const ELF = card('Test Elf', 'Creature — Elf', '', { cost: '{G}', colors: ['G'], pt: ['1', '1'] });
const SPRAWL = card('Test Sprawl', 'Enchantment — Aura', 'Enchant Forest\nAs this Aura enters, choose a color.\nWhenever enchanted Forest is tapped for mana, its controller adds an additional one mana of the chosen color.', { cost: '{G}', colors: ['G'] });
const TERROR = card('Test Terror', 'Creature — Serpent', 'This spell costs {1} less to cast for each instant and sorcery card in your graveyard.', { cost: '{6}{U}', colors: ['U'], pt: ['5', '5'] });
const KINDRED = card('Test Kindred Bolt', 'Kindred Instant — Elemental', 'Draw a card.', { cost: '{R}', colors: ['R'] });

describe('design 6.9: the T11 templates are stable, so a card they read completely is fully automated', () => {
  it('CR 601.2f, 106.4, 605.1b: one card per template is full', () => {
    for (const d of [VOLLEY, STRATA, GEIST, DRAKE, RINGER, ELITE, CHANNELER, SPRAWL, TERROR]) expect(d.automation.level, d.name).toBe('full');
  });
});

describe('CR 601.2c, 601.2f: "~ costs {1} more to cast for each target beyond the first"', () => {
  it('no or one target: the mana cost; two targets: {1} more; four targets: {3} more (read from the announced targets)', () => {
    const s = scenario([], { p1: { hand: ['Test Volley'] }, defs: [VOLLEY] });
    const id = find(s, 'Test Volley', 'hand');
    // test setup: the spell on the stack with `n` announced targets (CR 601.2c comes before the total cost, CR 601.2f)
    const onStack = (n: number): GameState => tweak(s, (x) => {
      const o = x.objects[id]!;
      x.zones.hand.p1 = x.zones.hand.p1!.filter((y) => y !== id);
      o.zone = 'stack';
      x.zones.stack.push(id);
      o.stack = { kind: 'spell', face: 0, targets: [Array.from({ length: n }, (_, i) => ({ kind: 'object' as const, id: `land${i}` }))], costsPaid: {}, castFrom: 'hand' } as never;
    });
    expect(costOf(s, id, VOLLEY)).toBe('{1}{U}'); // castCheck: no target is announced yet
    for (const [n, want] of [[0, '{1}{U}'], [1, '{1}{U}'], [2, '{2}{U}'], [4, '{4}{U}']] as const) expect(costOf(onStack(n), id, VOLLEY), `${n} targets`).toBe(want);
  });
});

describe('CR 601.2f, 305.6: "~ costs {1} less to cast for each basic land type among lands you control"', () => {
  it('Plains, Island and a Swamp Mountain: {4} less; two Plains count once, a Gate and an opponent\'s Forest not at all', () => {
    const s = scenario(['Island', 'Forest'], { p1: { hand: ['Test Strata'], battlefield: ['Plains', 'Plains', 'Island', 'Test Dual', 'Test Gate'] }, p2: { battlefield: ['Forest'] }, defs: [STRATA, DUAL, GATE] });
    expect(costOf(s, find(s, 'Test Strata', 'hand'), STRATA)).toBe('{3}{G}');
    const none = scenario([], { p1: { hand: ['Test Strata'], battlefield: ['Test Gate'] }, defs: [STRATA, GATE] });
    expect(costOf(none, find(none, 'Test Strata', 'hand'), STRATA)).toBe('{7}{G}');
  });
  it('CR 118.7a: the reduction never takes the colored part (five types: {2}{G})', () => {
    const s = scenario(['Island', 'Forest', 'Swamp', 'Mountain'], { p1: { hand: ['Test Strata'], battlefield: ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] }, defs: [STRATA] });
    expect(costOf(s, find(s, 'Test Strata', 'hand'), STRATA)).toBe('{2}{G}');
  });
});

describe('CR 601.2a, 601.2f, 400.3: "Spells you cast from your graveyard cost {1} less to cast."', () => {
  it('a card in your graveyard: {1} less; from your hand, or a card of an opponent\'s graveyard: the full cost; an opponent casting from theirs: the full cost', () => {
    const s = scenario([], { p1: { battlefield: ['Test Geist'], graveyard: ['Test Thought'], hand: ['Test Thought'] }, p2: { graveyard: ['Test Thought'] }, defs: [GEIST, THOUGHT] });
    expect(costOf(s, find(s, 'Test Thought', 'graveyard', 'p1'), THOUGHT)).toBe('{2}{B}');
    expect(costOf(s, find(s, 'Test Thought', 'hand', 'p1'), THOUGHT)).toBe('{3}{B}');
    expect(costOf(s, find(s, 'Test Thought', 'graveyard', 'p2'), THOUGHT)).toBe('{3}{B}');
    expect(costOf(s, find(s, 'Test Thought', 'graveyard', 'p2'), THOUGHT, 'p2')).toBe('{3}{B}');
  });
});

describe('CR 611.3a, 500.1: "During turns other than yours, spells you cast cost {2} less to cast."', () => {
  it('on your turn: the full cost; on an opponent\'s turn: {2} less, and only for your spells', () => {
    const s = scenario([], { p1: { battlefield: ['Test Drake'], hand: ['Test Thought'] }, p2: { hand: ['Test Thought'] }, defs: [DRAKE, THOUGHT] });
    const mine = find(s, 'Test Thought', 'hand', 'p1');
    expect(s.turn.activePlayer).toBe('p1');
    expect(costOf(s, mine, THOUGHT)).toBe('{3}{B}');
    const theirs = tweak(s, (t) => { t.turn.activePlayer = 'p2'; });
    expect(costOf(theirs, mine, THOUGHT)).toBe('{1}{B}');
    expect(costOf(theirs, find(theirs, 'Test Thought', 'hand', 'p2'), THOUGHT, 'p2')).toBe('{3}{B}');
  });
});

describe('CR 601.2f, 601.2i: "The second spell you cast each turn costs {1} less to cast."', () => {
  const withCast = (s: GameState, n: number): GameState => tweak(s, (t) => { t.players[0]!.turnStats.spellsCast = n; });
  it('the first spell: the full cost; the second: {1} less; the third: the full cost again', () => {
    const s = scenario([], { p1: { battlefield: ['Test Ringer'], hand: ['Test Thought'] }, defs: [RINGER, THOUGHT] });
    const id = find(s, 'Test Thought', 'hand');
    expect(costOf(withCast(s, 0), id, THOUGHT)).toBe('{3}{B}');
    expect(costOf(withCast(s, 1), id, THOUGHT)).toBe('{2}{B}');
    expect(costOf(withCast(s, 2), id, THOUGHT)).toBe('{3}{B}');
  });
  it('the cast is offered with one Island exactly when the reduction makes {1}{U} payable', () => {
    const s = scenario(['Island'], { p1: { battlefield: ['Test Ringer', 'Island'], hand: ['Test Quick Thought'] }, defs: [RINGER, QUICK] });
    const castable = (t: GameState): boolean => legal(t, 'p1', 'cast').some((a) => a.object === find(t, 'Test Quick Thought', 'hand'));
    expect(castable(withCast(s, 0))).toBe(false);
    expect(castable(withCast(s, 1))).toBe(true);
  });
  it('the opponent\'s spells are not changed (the caster is "you")', () => {
    const s = scenario([], { p1: { battlefield: ['Test Ringer'] }, p2: { hand: ['Test Thought'] }, defs: [RINGER, THOUGHT] });
    const t = tweak(s, (x) => { x.players[0]!.turnStats.spellsCast = 1; x.players[1]!.turnStats.spellsCast = 1; });
    expect(costOf(t, find(t, 'Test Thought', 'hand', 'p2'), THOUGHT, 'p2')).toBe('{3}{B}');
  });
});

describe('CR 106.4, 107.3, 605.3b: "Add X mana of any one color, where X is ..."', () => {
  const activate = (s: GameState, name: string, color: Color): GameState => {
    const id = find(s, name, 'battlefield');
    const a = legal(s, 'p1', 'activate').find((x) => x.object === id);
    if (!a) throw new Error(`${name}: no activation offered`);
    let t = act(s, a.action);
    if (t.pending?.kind === 'chooseColor') t = answer(t, { kind: 'chooseColor', color });
    return t;
  };
  it('"where X is ~\'s power": three mana of the one chosen color from a 3/1', () => {
    const s = scenario([], { p1: { battlefield: ['Test Elite'] }, defs: [ELITE] });
    expect(pool(activate(s, 'Test Elite', 'R'), 'p1')).toBe('RRR');
  });
  it('CR 110.1: "the number of Elves on the battlefield" counts every player\'s Elves, itself included', () => {
    const s = scenario([], { p1: { battlefield: ['Test Channeler', 'Test Elf'] }, p2: { battlefield: ['Test Elf'] }, defs: [CHANNELER, ELF] });
    expect(pool(activate(s, 'Test Channeler', 'B'), 'p1')).toBe('BBB');
  });
});

describe('CR 605.1b, 605.4a, 607.2d: "its controller adds an additional one mana of the chosen color"', () => {
  it('the enchanted Forest makes {G} and one mana of the chosen color at once (no stack); another Forest makes {G}', () => {
    const s0 = scenario(['Forest'], { defs: [SPRAWL], p1: { battlefield: ['Forest', 'Forest'] } });
    const [enchanted, other] = s0.zones.battlefield.filter((id) => s0.defs[s0.objects[id]!.defId]!.name === 'Forest');
    const aura = put(s0, 'p1', 'battlefield', 'Test Sprawl');
    s0.objects[aura]!.attachedTo = enchanted!; // test setup: the Aura on the first Forest (CR 303.4)
    s0.objects[aura]!.links = { color: { values: ['red'] } } as never; // test setup: red was chosen as it entered (CR 607.2d)
    let s = act(s0, { type: 'activate', player: 'p1', source: enchanted!, ability: 'r:basic:G' });
    expect(s.zones.stack).toEqual([]);
    expect(pool(s, 'p1')).toBe('GR');
    s = act(s, { type: 'activate', player: 'p1', source: other!, ability: 'r:basic:G' });
    expect(pool(s, 'p1')).toBe('GGR');
  });
});

describe('CR 601.2f, 205.2: "~ costs {1} less to cast for each instant and sorcery card in your graveyard"', () => {
  it('an instant, a sorcery and a kindred instant: {3} less; an opponent\'s instant does not count', () => {
    const s = scenario([], { p1: { hand: ['Test Terror'], graveyard: ['Test Quick Thought', 'Test Thought', 'Test Kindred Bolt', 'Test Elf'] }, p2: { graveyard: ['Test Quick Thought'] }, defs: [TERROR, QUICK, THOUGHT, KINDRED, ELF] });
    expect(costOf(s, find(s, 'Test Terror', 'hand'), TERROR)).toBe('{3}{U}');
  });
});
