/**
 * Commander EDHREC ranks 18,751-19,375, round edh-c-21 (third pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's
 * default compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 *
 *   CR 121.1, 701.9a, 608.2c    "Draw a card for each Island you control, then discard that many cards." (the number of cards the draw drew, after sentences with amounts of their own)
 *   CR 701.23a-b, 401.2         "Search your library for a Plains card, an Island card, a Swamp card, and a Mountain card. Reveal those cards, put them into your hand, then shuffle."
 *   CR 701.23a, 401.4, 701.24a  "Search your library for any number of basic land cards, reveal those cards, then shuffle and put them on top."
 *   CR 701.17a, 608.2c, 122.1   "Choose target creature. Mill four cards, then put a +1/+1 counter on that creature for each creature card milled this way."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, scenario } from '../../m3/scenario';
import { card, full, resolveAll, settle } from '../cmd3/helpers';

const inZone = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p = 'p1'): ObjectId[] => s.zones[zone][p] ?? [];
const names = (s: GameState, ids: ObjectId[]): string[] => ids.map((id) => s.objects[id]!.defId);
const castSpell = (s0: GameState, name: string): GameState => act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
/** Resolve the stack, answering each object choice with `pick` (default: everything offered up to the maximum). */
const run = (s0: GameState, pick: (d: { options: ObjectId[]; min: number; max: number }) => ObjectId[]): GameState => {
  let s = s0;
  for (let i = 0; i < 40 && (s.pending?.kind !== 'priority' || s.zones.stack.length > 0); i++) {
    const d = s.pending as { kind: string; player?: string } | undefined;
    if (d?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: pick(d as never) });
    else if (d?.kind === 'priority') s = act(s, { type: 'pass', player: d.player! });
    else s = settle(s);
  }
  return s;
};
/** A synthetic card with a basic land type line and a color-less cost, as the cmd3 helper makes them. */
const land = (name: string, sub: string): CardDef => compileCard({ name, layout: 'normal', mana_cost: '', type_line: `Basic Land — ${sub}`, oracle_text: '', colors: [] } as OracleCard);

describe('CR 121.1, 701.9a, 608.2c: "Draw a card for each Island you control, then discard that many cards."', () => {
  const SPELL = card('Test Tide Ledger', 'Sorcery', 'Draw a card for each Island you control, then discard that many cards.');
  const ISLE = land('Test Isle', 'Island');
  it('is full', () => expect(full(SPELL)).toBe(true));
  it('draws one card for each Island and discards the same number', () => {
    const s0 = scenario([], { defs: [SPELL, ISLE], p1: { hand: ['Test Tide Ledger'], battlefield: ['Test Isle', 'Test Isle'] } });
    const s = resolveAll(castSpell(s0, 'Test Tide Ledger'));
    expect(inZone(s, 'hand').length).toBe(0); // drew two, discarded two
    expect(inZone(s, 'graveyard').length).toBe(3); // the spell and the two discarded cards
    expect(inZone(s, 'library').length).toBe(s0.zones.library.p1!.length - 2);
  });
  it('negative: with no Island nothing is drawn and nothing is discarded', () => {
    const s0 = scenario([], { defs: [SPELL, ISLE], p1: { hand: ['Test Tide Ledger', 'Test Isle'] } });
    const s = resolveAll(castSpell(s0, 'Test Tide Ledger'));
    expect(inZone(s, 'hand').length).toBe(1);
    expect(inZone(s, 'graveyard').length).toBe(1);
  });
});

describe('CR 701.23a-b, 401.2: "Search your library for a Plains card, an Island card, a Swamp card, and a Mountain card."', () => {
  const SPELL = card('Test Four Corners', 'Sorcery', 'Search your library for a Plains card, an Island card, a Swamp card, and a Mountain card. Reveal those cards, put them into your hand, then shuffle.');
  const LANDS = [land('Test Isle', 'Island'), land('Test Mire', 'Swamp'), land('Test Crag', 'Mountain')];
  it('is full', () => expect(full(SPELL)).toBe(true));
  it('finds one card of each description and puts them into the hand', () => {
    const s0 = scenario([], { defs: [SPELL, ...LANDS], p1: { hand: ['Test Four Corners'], library: ['Test Isle', 'Test Isle', 'Test Mire', 'Test Crag'] } });
    const s = run(castSpell(s0, 'Test Four Corners'), (d) => d.options.slice(0, d.max));
    const got = names(s, inZone(s, 'hand')).sort();
    expect(got).toEqual(['Plains', 'Test Crag', 'Test Isle', 'Test Mire']);
  });
  it('negative: a library without a Swamp still gives the cards that exist (CR 701.23b)', () => {
    const s0 = scenario([], { defs: [SPELL, ...LANDS], p1: { hand: ['Test Four Corners'], library: ['Test Isle', 'Test Crag'] } });
    const s = run(castSpell(s0, 'Test Four Corners'), (d) => d.options.slice(0, d.max));
    expect(names(s, inZone(s, 'hand')).sort()).toEqual(['Plains', 'Test Crag', 'Test Isle']);
  });
});

describe('CR 701.23a, 401.4, 701.24a: "Search your library for any number of basic land cards, reveal those cards, then shuffle and put them on top."', () => {
  const SPELL = card('Test Trail Scout', 'Sorcery', 'Search your library for any number of basic land cards, reveal those cards, then shuffle and put them on top.');
  const ISLE = land('Test Isle', 'Island');
  it('is full', () => expect(full(SPELL)).toBe(true));
  it('puts exactly the chosen cards on top of the shuffled library', () => {
    const s0 = scenario([], { defs: [SPELL, ISLE], p1: { hand: ['Test Trail Scout'], library: ['Test Isle', 'Test Isle', 'Test Isle'] } });
    let chosen: ObjectId[] = [];
    const s = run(castSpell(s0, 'Test Trail Scout'), (d) => (chosen = d.options.filter((id) => s0.objects[id]?.defId === 'Test Isle')));
    expect(chosen.length).toBe(3);
    const lib = inZone(s, 'library');
    expect(names(s, lib.slice(0, 3))).toEqual(['Test Isle', 'Test Isle', 'Test Isle']); // new objects (CR 400.7), the three found cards, on top of the 23-card library after a shuffle
    expect(lib.length).toBe(23);
  });
  it('negative: choosing none leaves the hand and the graveyard as they were', () => {
    const s0 = scenario([], { defs: [SPELL, ISLE], p1: { hand: ['Test Trail Scout'], library: ['Test Isle'] } });
    const s = run(castSpell(s0, 'Test Trail Scout'), () => []);
    expect(inZone(s, 'hand').length).toBe(0);
  });
});

describe('CR 701.17a, 608.2c, 122.1: "Choose target creature. Mill four cards, then put a +1/+1 counter on that creature for each creature card milled this way."', () => {
  const SPELL = card('Test Deep Delve', 'Sorcery', 'Choose target creature. Mill four cards, then put a +1/+1 counter on that creature for each creature card milled this way.');
  const BEAST = card('Test Marsh Beast', 'Creature — Beast', '', ['2', '2']);
  it('is full', () => expect(full(SPELL)).toBe(true));
  it('puts one counter for each creature card the mill put into the graveyard (and not for the other cards)', () => {
    const s0 = scenario([], { defs: [SPELL, BEAST], p1: { hand: ['Test Deep Delve'], battlefield: ['Test Marsh Beast'], library: ['Test Marsh Beast', 'Plains', 'Test Marsh Beast', 'Plains', 'Plains'] } });
    const target = find(s0, 'Test Marsh Beast', 'battlefield', 'p1');
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Deep Delve', 'hand', 'p1') }), { targets: [{ kind: 'object', id: target }] });
    const milledBeasts = names(s, inZone(s, 'graveyard')).filter((n) => n === 'Test Marsh Beast').length;
    expect(inZone(s, 'graveyard').length).toBe(5); // the spell and four milled cards
    expect(s.objects[target]!.counters['+1/+1'] ?? 0).toBe(milledBeasts);
    expect(milledBeasts).toBeGreaterThan(0);
  });
});
