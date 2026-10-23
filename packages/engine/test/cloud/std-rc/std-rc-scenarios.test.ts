/**
 * Standard round C (std-rc): "This ability costs {X} less to activate, where X is <a quantity>" (parser/templates/zz-cloud/std-rc.json,
 * eff.stdrc.cost.ability.less.whereX; family ability-cost-where-x, render/abil.ts#withRestrictions), played through the engine with synthetic cards compiled by
 * the game's default compiler (invented names and wordings, design 6.10). Each test is named after the rule it checks (CR cites from memory, unverified:
 * rules/cr/ is not in the cloud checkout).
 *
 *   CR 602.2b, 601.2f, 107.3  X is counted as the activation cost is determined; only what you control counts; the reduction is of generic mana only
 *   CR 700.4, 406.1, 603.10a  "the number of creatures that died / were exiled under <player's> control this turn": the turn's zone changes from the battlefield,
 *                             the controller as each creature last existed there; a creature of the other player, or one put elsewhere, is not counted
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { cast, resolveAll } from '../../m5/cr-examples/helpers';
import { act, find, scenario } from '../../m5/helpers';
import { drive, resolveTop } from '../../m5/cr-examples/helpers';

function card(name: string, type: string, text: string): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], keywords: [] } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';

describe('CR 602.2b, 601.2f, 107.3: "This ability costs {X} less to activate, where X is the number of artifacts you control."', () => {
  const ENGINE = card('Test Relay Engine', 'Artifact', '{6}, {T}: Draw two cards. This ability costs {X} less to activate, where X is the number of artifacts you control.');
  const COG = card('Test Cog', 'Artifact', '');
  const defs = [ENGINE, COG];
  const plains = (n: number): string[] => Array(n).fill('Plains') as string[];
  const offered = (s: GameState): boolean => legalActions(s, 'p1').some((a) => a.kind === 'activate' && !a.isMana && a.object === find(s, 'Test Relay Engine', 'battlefield'));

  it('is fully automated, and the reduction is the ability\'s own cost change (never a step)', () => {
    expect(full(ENGINE)).toBe(true);
    const a = ENGINE.faces[0]!.abilities.find((x) => x.kind === 'activated')!;
    expect(a.kind === 'activated' && a.costChange?.kind).toBe('reduce');
  });
  it('with three artifacts (itself and two others) it costs {3}: three lands suffice, two do not', () => {
    expect(offered(scenario([], { p1: { battlefield: ['Test Relay Engine', 'Test Cog', 'Test Cog', ...plains(3)] }, defs }))).toBe(true);
    expect(offered(scenario([], { p1: { battlefield: ['Test Relay Engine', 'Test Cog', 'Test Cog', ...plains(2)] }, defs }))).toBe(false);
    let s = scenario([], { p1: { battlefield: ['Test Relay Engine', 'Test Cog', 'Test Cog', ...plains(3)] }, defs });
    const hand = s.zones.hand.p1!.length;
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && !x.isMana && x.object === find(s, 'Test Relay Engine', 'battlefield'))!;
    s = drive(act(s, a.action));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Plains' && s.objects[id]!.tapped)).toHaveLength(3);
    s = resolveTop(s);
    expect(s.zones.hand.p1!.length).toBe(hand + 2);
  });
  it('an opponent\'s artifacts do not count: alone it costs {5}', () => {
    expect(offered(scenario([], { p1: { battlefield: ['Test Relay Engine', ...plains(4)] }, p2: { battlefield: ['Test Cog', 'Test Cog'] }, defs }))).toBe(false);
    expect(offered(scenario([], { p1: { battlefield: ['Test Relay Engine', ...plains(5)] }, p2: { battlefield: ['Test Cog', 'Test Cog'] }, defs }))).toBe(true);
  });
});

describe('CR 700.4, 406.1, 603.10a: "the number of creatures that died / were exiled under <player\'s> control this turn"', () => {
  const BEAR = card('Test Bear', 'Creature — Bear', '');
  const PURGE = card('Test Purge', 'Sorcery', 'Exile all creatures.');
  const WRATH = card('Test Wrath', 'Sorcery', 'Destroy all creatures.');
  const TALLY_X = card('Test Exile Tally', 'Sorcery', "Draw X cards, where X is the number of creatures that were exiled under your opponents' control this turn.");
  const TALLY_D = card('Test Grave Tally', 'Sorcery', 'Draw X cards, where X is the number of creatures that died under your control this turn.');
  const defs = [BEAR, PURGE, WRATH, TALLY_X, TALLY_D];
  const handOf = (s: GameState): number => s.zones.hand.p1!.length;
  const board = (spells: string[]): GameState => scenario([], {
    p1: { hand: spells, battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] }, defs,
  });

  it('the tallies are fully automated', () => {
    for (const d of [TALLY_X, TALLY_D]) expect(full(d), d.name).toBe(true);
  });
  it('CR 406.1, 603.10a: after "Exile all creatures", the opponent\'s two exiled creatures count, not yours (draw 2)', () => {
    let s = resolveAll(cast(board(['Test Purge', 'Test Exile Tally']), 'Test Purge'));
    const before = handOf(s);
    s = resolveAll(cast(s, 'Test Exile Tally'));
    expect(handOf(s)).toBe(before - 1 + 2);
  });
  it('CR 700.4: creatures that died are not creatures that were exiled (draw 0); your own one that died counts for "died under your control" (draw 1)', () => {
    let s = resolveAll(cast(board(['Test Wrath', 'Test Exile Tally', 'Test Grave Tally']), 'Test Wrath'));
    const before = handOf(s);
    s = resolveAll(cast(s, 'Test Exile Tally'));
    expect(handOf(s)).toBe(before - 1);
    s = resolveAll(cast(s, 'Test Grave Tally'));
    expect(handOf(s)).toBe(before - 2 + 1);
  });
});
