/**
 * std-freecast-5 (lane std-freecast): plot from the top of your library, played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the
 * cloud checkout).
 *
 *   CR 702.170a, 702.170f, 116.2k  "The top card of your library has plot. The plot cost is equal to its mana cost." and "You may plot nonland cards from the top of
 *                                  your library.": the top card is plotted for its mana cost (exiled, plotted) and cast on a later turn without paying its mana
 *                                  cost (CR 702.170d), not on the same turn; a land on top is not offered; only in your main phase with an empty stack
 *   CR 702.170a                    a card with plot of its own is offered for that cost too (two ways); without "has plot" only for its own plot cost
 *   CR 400.2, 401.5                only while you may look at the top card
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act, advanceTo, card, drive, full, resolveAll, scenario } from '../r3-cost/support';
import { put } from '../../m6/dfc/support';

const SCOUT = card('Test Lost Scout', 'Creature — Homunculus', 'You may look at the top card of your library any time.\nThe top card of your library has plot. The plot cost is equal to its mana cost.\nYou may plot nonland cards from the top of your library.', '{2}', ['1', '1']);
const NOSY = card('Test Nosy Scout', 'Creature — Homunculus', 'You may look at the top card of your library any time.\nYou may plot nonland cards from the top of your library.', '{2}', ['1', '1']);
const BLIND = card('Test Blind Scout', 'Creature — Homunculus', 'The top card of your library has plot. The plot cost is equal to its mana cost.\nYou may plot nonland cards from the top of your library.', '{2}', ['1', '1']);
const BEAR = card('Test Grove Bear', 'Creature — Bear', '', '{1}{G}', ['2', '2'], ['G']);
const OUTLAW = card('Test Quick Outlaw', 'Creature — Human Rogue', 'Plot {1}', '{3}', ['3', '3']);
const QUICK = card('Test Quick Thought', 'Instant', 'Draw a card.', '{0}');
const DEFS = [SCOUT, NOSY, BLIND, BEAR, OUTLAW, QUICK];

const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const plots = (s: GameState, player: PlayerId = 'p1') => legalActions(s, player).filter((a) => a.kind === 'special' && (a.action as { kind: string }).kind === 'plot');
function board(source: string, library: string[], extra: { hand?: string[]; lands?: number } = {}): GameState {
  const s = scenario(['Forest'], { defs: DEFS, p1: { battlefield: [source, ...Array(extra.lands ?? 2).fill('Forest')], hand: extra.hand ?? [] } });
  s.zones.library['p1'] = [];
  for (const n of [...library, ...Array(10).fill('Forest')]) put(s, 'p1', 'library', n);
  return s;
}

describe('std-freecast-5: the synthetic cards are automated (the templates experimental until reviewed)', () => {
  it('every ability of the synthetic sources is fully understood', () => {
    for (const d of [SCOUT, NOSY, BLIND]) expect(d.automation.faces![0]!.abilities.every((a) => a.level === 'full'), d.name).toBe(true);
    for (const d of [BEAR, OUTLAW, QUICK]) expect(full(d), d.name).toBe(true);
  });
});

describe('CR 702.170a, 702.170f, 116.2k: the top card of your library is plotted for its mana cost', () => {
  it('a {1}{G} creature on top is plotted for {1}{G}: exiled and plotted; not castable this turn; cast on your next turn without paying its mana cost', () => {
    let s = board('Test Lost Scout', ['Test Grove Bear']);
    const ps = plots(s);
    expect(ps).toHaveLength(1);
    expect(ps[0]!.label).toContain('({1}{G})');
    s = drive(act(s, ps[0]!.action));
    const bear = s.zones.exile.find((id) => nameOf(s, id) === 'Test Grove Bear');
    expect(bear).toBeDefined();
    expect(s.objects[bear!]!.chosen?.['plotted']).toBe(1);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped)).toHaveLength(2);
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object === bear)).toBe(false); // CR 702.170d: a later turn
    s = advanceTo(s, 3, 'main1');
    const cast = legalActions(s, 'p1').find((a) => a.kind === 'cast' && a.object === bear);
    expect(cast).toBeDefined();
    expect((cast!.action as { method?: string }).method).toBe('plot');
    s = resolveAll(drive(act(s, cast!.action)));
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Grove Bear')).toBe(true);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped)).toHaveLength(0); // without paying its mana cost
  });
  it('a land on top is not offered (only nonland cards may be plotted from there)', () => {
    expect(plots(board('Test Lost Scout', ['Forest']))).toHaveLength(0);
  });
  it('CR 116.2k: sorcery timing: not with a spell on the stack, not on the opponent\'s turn', () => {
    let s = board('Test Lost Scout', ['Test Grove Bear'], { hand: ['Test Quick Thought'] });
    s = act(s, { type: 'cast', player: 'p1', card: s.zones.hand['p1']!.find((id) => nameOf(s, id) === 'Test Quick Thought')! });
    s = drive(s);
    expect(s.zones.stack.length).toBe(1);
    expect(plots(s)).toHaveLength(0);
    let t = board('Test Lost Scout', ['Test Grove Bear']);
    t = advanceTo(t, 2, 'main1');
    expect(plots(t, 'p1')).toHaveLength(0);
  });
  it('the mana cost must be payable: with one Forest the {1}{G} card is not offered', () => {
    expect(plots(board('Test Lost Scout', ['Test Grove Bear'], { lands: 1 }))).toHaveLength(0);
  });
});

describe('CR 702.170a: the card\'s own plot cost', () => {
  it('with "has plot" a card with plot {1} on top is offered for {1} and for its mana cost {3}', () => {
    const ps = plots(board('Test Lost Scout', ['Test Quick Outlaw'], { lands: 3 }));
    expect(ps.map((p) => p.label).sort()).toEqual(['Plot Test Quick Outlaw from the top of your library ({1})', 'Plot Test Quick Outlaw from the top of your library ({3})']);
  });
  it('without "has plot", only a card with plot of its own is offered, for its own plot cost', () => {
    expect(plots(board('Test Nosy Scout', ['Test Grove Bear']))).toHaveLength(0);
    const ps = plots(board('Test Nosy Scout', ['Test Quick Outlaw'], { lands: 3 }));
    expect(ps.map((p) => p.label)).toEqual(['Plot Test Quick Outlaw from the top of your library ({1})']);
  });
});

describe('CR 400.2, 401.5: only while you may look at the top card', () => {
  it('without "You may look at the top card of your library any time" nothing on top is offered', () => {
    expect(plots(board('Test Blind Scout', ['Test Grove Bear']))).toHaveLength(0);
  });
});
