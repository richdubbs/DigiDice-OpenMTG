/**
 * std-rn (parallel slot N, Commander precon cards, tuning half): the round's readings played through the engine with synthetic cards compiled by the game's
 * default compiler (invented names and wordings, design 6.10). Each test is named after the rule it checks (CR cites from memory, unverified: rules/cr/ is not
 * in the cloud checkout).
 *
 *   CR 602.5b                    "Activate only during the end of combat step" / "during an opponent's turn": the restriction holds on every turn, not only yours
 *   CR 601.2i, 505.1             "If you cast this spell during your main phase": decided when the spell became cast, for the player who cast it
 *   CR 701.24a, 400.3, 608.2e    "Each player shuffles their hand and graveyard into their library, then draws N cards": each card into its owner's library
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { find, findAll, scenario } from '../../m5/helpers';
import { activate, cast, pt, resolveAll, target } from '../../m5/cr-examples/helpers';
import { advanceTo, life, pass } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';

const LANTERN = card('Test Dusk Lantern', 'Artifact', '{T}: You gain 1 life. Activate only during the end of combat step.');
const SENTRY = card('Test Night Sentry', 'Artifact', "{T}: You gain 1 life. Activate only during an opponent's turn.");
const RALLY = card('Test Rally', 'Instant', 'Target creature gets +1/+1 until end of turn. If you cast this spell during your main phase, that creature gets +3/+3 until end of turn instead.');
const TWIST = card('Test Twist', 'Sorcery', 'Each player shuffles their hand and graveyard into their library, then draws two cards.');
const SIFT = card('Test Sift', 'Sorcery', 'Each player shuffles their graveyard into their library.');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const SPARK = card('Test Spark', 'Instant', 'You gain 1 life.');
const DEFS = [LANTERN, SENTRY, RALLY, TWIST, SIFT, BEAR, SPARK];
const CARDS = ['Plains'];

const activations = (s: GameState, name: string): number => {
  const id = find(s, name, 'battlefield');
  return legalActions(s, 'p1').filter((a) => a.kind === 'activate' && a.object === id).length;
};

describe('std-rn cards compile fully', () => {
  it('the synthetic cards of these scenarios are fully automated', () => {
    for (const d of [LANTERN, SENTRY, RALLY, TWIST, SIFT]) expect(full(d), d.name).toBe(true);
  });
});

describe('CR 602.5b: "Activate only during the end of combat step." holds in the end of combat step of any turn', () => {
  it('not in the main phase; in the end of combat step of your turn and of the opponent\'s turn', () => {
    let s = scenario(CARDS, { p1: { battlefield: ['Test Dusk Lantern'] }, defs: DEFS });
    expect(activations(s, 'Test Dusk Lantern')).toBe(0);
    s = advanceTo(s, 1, 'endCombat');
    expect(activations(s, 'Test Dusk Lantern')).toBe(1);
    s = resolveAll(activate(s, find(s, 'Test Dusk Lantern', 'battlefield')));
    expect(life(s, 'p1')).toBe(21);
    s = advanceTo(scenario(CARDS, { p1: { battlefield: ['Test Dusk Lantern'] }, defs: DEFS }), 2, 'endCombat');
    s = pass(s); // the active player (p2) passes: p1 has priority in p2's end of combat step
    expect(s.pending?.player).toBe('p1');
    expect(activations(s, 'Test Dusk Lantern')).toBe(1);
  });
  it('not in the beginning of combat or the end step (a neighbouring step)', () => {
    let s = scenario(CARDS, { p1: { battlefield: ['Test Dusk Lantern'] }, defs: DEFS });
    s = advanceTo(s, 1, 'beginCombat');
    expect(activations(s, 'Test Dusk Lantern')).toBe(0);
    s = advanceTo(s, 1, 'end');
    expect(activations(s, 'Test Dusk Lantern')).toBe(0);
  });
});

describe('CR 602.5b: "Activate only during an opponent\'s turn."', () => {
  it('not during your own turn; during the opponent\'s turn', () => {
    let s = scenario(CARDS, { p1: { battlefield: ['Test Night Sentry'] }, defs: DEFS });
    expect(activations(s, 'Test Night Sentry')).toBe(0);
    s = advanceTo(s, 2, 'upkeep');
    s = pass(s);
    expect(s.pending?.player).toBe('p1');
    expect(activations(s, 'Test Night Sentry')).toBe(1);
    s = resolveAll(activate(s, find(s, 'Test Night Sentry', 'battlefield')));
    expect(life(s, 'p1')).toBe(21);
  });
});

describe('CR 601.2i, 505.1: "If you cast this spell during your main phase, ..." is decided for the caster, as the spell is cast', () => {
  it('cast in your main phase: +3/+3 instead of +1/+1', () => {
    let s = scenario(CARDS, { p1: { hand: ['Test Rally'], battlefield: ['Test Bear'] }, defs: DEFS });
    const bear = find(s, 'Test Bear', 'battlefield');
    s = resolveAll(cast(s, 'Test Rally', [target(bear)]));
    expect(pt(s, bear)).toEqual([5, 5]);
  });
  it('cast in your beginning of combat step (not a main phase): +1/+1', () => {
    let s = scenario(CARDS, { p1: { hand: ['Test Rally'], battlefield: ['Test Bear'] }, defs: DEFS });
    const bear = find(s, 'Test Bear', 'battlefield');
    s = advanceTo(s, 1, 'beginCombat');
    s = resolveAll(cast(s, 'Test Rally', [target(bear)]));
    expect(pt(s, bear)).toEqual([3, 3]);
  });
  it('cast by the opponent during your main phase: not their main phase, +1/+1', () => {
    let s = scenario(CARDS, { p2: { hand: ['Test Rally'], battlefield: ['Test Bear'] }, defs: DEFS });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = pass(s); // p1 passes in its own main phase with an empty stack: p2 has priority
    expect(s.pending?.player).toBe('p2');
    s = resolveAll(cast(s, 'Test Rally', [target(bear)], 'p2'));
    expect(pt(s, bear)).toEqual([3, 3]);
  });
});

describe('CR 701.24a, 400.3, 608.2e: "Each player shuffles their hand and graveyard into their library, then draws two cards."', () => {
  it('every card of each player\'s hand and graveyard goes into its owner\'s library, then each player draws two', () => {
    let s = scenario(CARDS, { p1: { hand: ['Test Twist', 'Test Bear', 'Test Bear'], graveyard: ['Test Spark'] }, p2: { hand: ['Test Bear'], graveyard: ['Test Spark', 'Test Spark'] }, defs: DEFS });
    const lib1 = s.zones.library.p1!.length;
    const lib2 = s.zones.library.p2!.length;
    s = resolveAll(cast(s, 'Test Twist'));
    expect(s.zones.hand.p1).toHaveLength(2);
    expect(s.zones.hand.p2).toHaveLength(2);
    expect(findAll(s, 'Test Twist', 'graveyard', 'p1')).toHaveLength(1); // the spell itself goes to the graveyard after it resolves
    expect(s.zones.graveyard.p1).toHaveLength(1);
    expect(s.zones.graveyard.p2).toHaveLength(0);
    expect(s.zones.library.p1!.length).toBe(lib1 + 3 - 2);
    expect(s.zones.library.p2!.length).toBe(lib2 + 3 - 2);
    for (const id of s.zones.library.p2!) expect(s.objects[id]!.owner).toBe('p2'); // no card of p2 went into p1's library
  });
  it('"Each player shuffles their graveyard into their library." leaves the hands alone', () => {
    let s = scenario(CARDS, { p1: { hand: ['Test Sift', 'Test Bear'], graveyard: ['Test Spark'] }, p2: { hand: ['Test Bear'], graveyard: ['Test Spark', 'Test Spark'] }, defs: DEFS });
    const lib2 = s.zones.library.p2!.length;
    s = resolveAll(cast(s, 'Test Sift'));
    expect(s.zones.hand.p1).toHaveLength(1);
    expect(s.zones.hand.p2).toHaveLength(1);
    expect(s.zones.graveyard.p2).toHaveLength(0);
    expect(s.zones.library.p2!.length).toBe(lib2 + 2);
    expect(findAll(s, 'Test Spark', 'library', 'p1')).toHaveLength(1);
  });
});

