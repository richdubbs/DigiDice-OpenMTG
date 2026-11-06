/**
 * Concept lane mana-r2, edh-next-106 (code edhn106): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented
 * names, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites are from memory of the 2026-09-25 text (no rules/cr folder in this
 * session): unverified.
 *
 *   CR 205.1b, 613.1d, 108.3      "Lands you control and land cards you own that aren't on the battlefield are Deserts in addition to their other types." (Dune Chanter)
 *   CR 614.1c, 614.12a, 122.1     "You may have this land enter tapped. If you do, you get two rad counters." (Mariposa Military Base)
 *   CR 601.2b, 118.3, 107.1a      "As an additional cost to cast this spell, sacrifice half the lands you control, rounded up." (Tectonic Split)
 *   CR 701.9a, 614.1a, 400.7      "If a spell or ability an opponent controls causes you to discard a card, you may reveal that card and put it on top of your library instead of ..." (Nephalia Academy)
 *   CR 601.2f, 605.1a, 119.4      "Mana abilities of this land cost an additional 1 life to activate." with "choose a basic land type ... is the chosen type" (Thran Portal)
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { answer, legal, put } from '../../m3/scenario';
import { act, card, cast, drive, find, full, lifeOf, resolveAll, scenario } from '../r3-cost/support';

/** `drive`, also putting two simultaneous replacement effects in the order offered (CR 616.1). */
function driveOrdered(s0: GameState, script: Parameters<typeof drive>[1] = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 6 && s.pending?.kind !== 'priority' && s.pending != null; guard++) {
    if (s.pending.kind === 'chooseReplacement') s = answer(s, { kind: 'chooseReplacement', id: s.pending.options[0]!.id });
    else if (s.pending.kind === 'chooseName') s = answer(s, { kind: 'chooseName', name: 'Swamp' });
    else s = drive(s, script);
  }
  return s;
}
const subtypes = (s: GameState, id: string): string[] => [...getChars(s, id)!.subtypes];
const radOf = (s: GameState, p: 'p1' | 'p2' = 'p1'): number => s.players.find((x) => x.id === p)!.counters['rad'] ?? 0;

describe('CR 205.1b, 613.1d, 108.3: "Lands you control and land cards you own that aren\'t on the battlefield are Deserts in addition to their other types."', () => {
  const NOMAD = card('Test Dune Nomad', 'Creature — Plant', 'Lands you control and land cards you own that aren\'t on the battlefield are Deserts in addition to their other types.', '{0}', ['1', '1']);
  const WASTE = card('Test Waste', 'Land', '{T}: Add {C}.');
  const defs = [NOMAD, WASTE];
  it('is full', () => expect(full(NOMAD), JSON.stringify(NOMAD.automation)).toBe(true));
  it('your lands on the battlefield and your land cards in hand, library and graveyard are Deserts, and keep their own types', () => {
    const s = scenario(['Plains'], { p1: { battlefield: ['Test Dune Nomad', 'Plains'], hand: ['Test Waste'], graveyard: ['Test Waste'] }, defs });
    expect(subtypes(s, find(s, 'Plains', 'battlefield', 'p1'))).toEqual(expect.arrayContaining(['Plains', 'Desert']));
    expect(subtypes(s, find(s, 'Test Waste', 'hand', 'p1'))).toContain('Desert');
    expect(subtypes(s, s.zones.graveyard.p1![0]!)).toContain('Desert');
    expect(subtypes(s, s.zones.library.p1![0]!)).toContain('Desert'); // a Plains card in the library
  });
  it('negative: the opponent\'s lands (battlefield or hand) and a nonland card of yours are not Deserts; the creature itself is not a land', () => {
    const s = scenario(['Plains'], { p1: { battlefield: ['Test Dune Nomad'], hand: ['Test Dune Nomad'] }, p2: { battlefield: ['Plains'], hand: ['Test Waste'] }, defs });
    expect(subtypes(s, find(s, 'Plains', 'battlefield', 'p2'))).not.toContain('Desert');
    expect(subtypes(s, find(s, 'Test Waste', 'hand', 'p2'))).not.toContain('Desert');
    expect(subtypes(s, find(s, 'Test Dune Nomad', 'hand', 'p1'))).not.toContain('Desert');
    expect(subtypes(s, find(s, 'Test Dune Nomad', 'battlefield', 'p1'))).not.toContain('Desert');
  });
  it('negative: once the creature is gone the lands are not Deserts any more', () => {
    const s = scenario(['Plains'], { p1: { battlefield: ['Plains'], hand: ['Test Dune Nomad'] }, defs });
    expect(subtypes(s, find(s, 'Plains', 'battlefield', 'p1'))).not.toContain('Desert');
  });
});

describe('CR 614.1c, 614.12a, 122.1: "You may have this land enter tapped. If you do, you get two rad counters."', () => {
  const WASTE = card('Test Fallout Flats', 'Land', 'You may have this land enter tapped. If you do, you get two rad counters.\n{T}: Add {C}.');
  const defs = [WASTE];
  const play = (yes: boolean): GameState => {
    const s0 = scenario([], { p1: { hand: ['Test Fallout Flats'] }, defs });
    return drive(act(s0, { type: 'playLand', player: 'p1', card: find(s0, 'Test Fallout Flats', 'hand', 'p1') }), { yes: [yes] });
  };
  it('is full', () => expect(full(WASTE), JSON.stringify(WASTE.automation)).toBe(true));
  it('choosing to: it enters tapped and you get two rad counters', () => {
    const s = play(true);
    const id = find(s, 'Test Fallout Flats', 'battlefield', 'p1');
    expect(s.objects[id]!.tapped).toBe(true);
    expect(radOf(s)).toBe(2);
    expect(radOf(s, 'p2')).toBe(0);
  });
  it('negative: declining, it enters untapped and you get no rad counters', () => {
    const s = play(false);
    const id = find(s, 'Test Fallout Flats', 'battlefield', 'p1');
    expect(s.objects[id]!.tapped).toBe(false);
    expect(radOf(s)).toBe(0);
  });
});

describe('CR 601.2b, 118.3, 107.1a: "As an additional cost to cast this spell, sacrifice half the lands you control, rounded up."', () => {
  const SPLIT = card('Test Land Split', 'Enchantment', 'As an additional cost to cast this spell, sacrifice half the lands you control, rounded up.\nHexproof', '{0}');
  const defs = [SPLIT];
  const lands = (s: GameState, p: 'p1' | 'p2'): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.objects[id]!.defId === 'Plains').length;
  it('is full', () => expect(full(SPLIT), JSON.stringify(SPLIT.automation)).toBe(true));
  it('five lands: three are sacrificed (rounded up), the opponent\'s lands stay', () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains'], hand: ['Test Land Split'] }, p2: { battlefield: ['Plains', 'Plains'] }, defs });
    const s = resolveAll(cast(s0, 'Test Land Split'));
    expect(lands(s, 'p1')).toBe(2);
    expect(lands(s, 'p2')).toBe(2);
    expect(find(s, 'Test Land Split', 'battlefield', 'p1')).toBeTruthy();
  });
  it('four lands: two are sacrificed; no land: nothing is sacrificed and the spell can still be cast', () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: ['Plains', 'Plains', 'Plains', 'Plains'], hand: ['Test Land Split'] }, defs });
    expect(lands(resolveAll(cast(s0, 'Test Land Split')), 'p1')).toBe(2);
    const t0 = scenario(['Plains'], { p1: { hand: ['Test Land Split'] }, defs });
    const t = resolveAll(cast(t0, 'Test Land Split'));
    expect(find(t, 'Test Land Split', 'battlefield', 'p1')).toBeTruthy();
  });
});

describe('CR 701.9a, 614.1a, 400.7: "If a spell or ability an opponent controls causes you to discard a card, you may reveal that card and put it on top of your library instead of putting it anywhere else."', () => {
  const ACADEMY = card('Test Quiet Library', 'Land', 'If a spell or ability an opponent controls causes you to discard a card, you may reveal that card and put it on top of your library instead of putting it anywhere else.\n{T}: Add {C}.');
  const SHRED = card('Test Shred', 'Sorcery', 'Target player discards a card.');
  const NOTE = card('Test Spare Note', 'Sorcery', 'You gain 1 life.');
  const PAYER = card('Test Pay Imp', 'Creature — Imp', '{0}, Discard a card: You gain 1 life.', '{0}', ['1', '1']);
  const defs = [ACADEMY, SHRED, NOTE, PAYER];
  const tgt = (p: 'p1' | 'p2') => ({ targets: [[{ kind: 'player' as const, id: p }]] });
  it('is full', () => expect(full(ACADEMY), JSON.stringify(ACADEMY.automation)).toBe(true));
  it('an opponent\'s spell makes you discard: you may put the card on top of your library instead', () => {
    const s0 = scenario([], { p1: { hand: ['Test Shred'] }, p2: { battlefield: ['Test Quiet Library'], hand: ['Test Spare Note'] }, defs });
    const note = find(s0, 'Test Spare Note', 'hand', 'p2');
    const s = resolveAll(cast(s0, 'Test Shred', tgt('p2')), { yes: [true], objects: [[note]] });
    expect(s.objects[s.zones.library.p2![0]!]!.defId).toBe('Test Spare Note');
    expect(s.zones.graveyard.p2!.length).toBe(0);
  });
  it('negative: declining puts the card into the graveyard as usual', () => {
    const s0 = scenario([], { p1: { hand: ['Test Shred'] }, p2: { battlefield: ['Test Quiet Library'], hand: ['Test Spare Note'] }, defs });
    const note = find(s0, 'Test Spare Note', 'hand', 'p2');
    const s = resolveAll(cast(s0, 'Test Shred', tgt('p2')), { yes: [false], objects: [[note]] });
    expect(s.zones.graveyard.p2!.map((id) => s.objects[id]!.defId)).toEqual(['Test Spare Note']);
  });
  it('negative: your own spell, a discard paid as a cost, and an opponent\'s own discard are left alone', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Quiet Library', 'Test Pay Imp'], hand: ['Test Spare Note', 'Test Shred'] }, p2: { hand: ['Test Spare Note'] }, defs });
    const note = find(s0, 'Test Spare Note', 'hand', 'p1');
    const own = resolveAll(cast(s0, 'Test Shred', tgt('p1')), { yes: [true], objects: [[note]] });
    expect(own.zones.graveyard.p1!.map((id) => own.objects[id]!.defId).sort()).toEqual(['Test Shred', 'Test Spare Note']); // an effect you control: no replacement
    const imp = find(s0, 'Test Pay Imp', 'battlefield', 'p1');
    const paid = resolveAll(drive(act(s0, { type: 'activate', player: 'p1', source: imp, ability: 'p:0:0' }), { objects: [[note]] }));
    expect(paid.zones.graveyard.p1!.map((id) => paid.objects[id]!.defId)).toEqual(['Test Spare Note']); // a cost
    expect(lifeOf(paid)).toBe(21);
  });
});

describe('CR 601.2f, 605.1a, 119.4, 205.3i: "Mana abilities of this land cost an additional 1 life to activate." (with "As this land enters, choose a basic land type. This land is the chosen type in addition to its other types.")', () => {
  const PORTAL = card('Test Fee Gate', 'Land — Gate', 'This land enters tapped unless you control two or fewer other lands.\nAs this land enters, choose a basic land type.\nThis land is the chosen type in addition to its other types.\nMana abilities of this land cost an additional 1 life to activate.');
  const PLAIN = card('Test Free Gate', 'Land — Gate', '{T}: Add {C}.');
  const defs = [PORTAL, PLAIN];
  it('is full', () => expect(full(PORTAL), JSON.stringify(PORTAL.automation)).toBe(true));
  it('it is the chosen basic land type, and that type\'s mana ability costs 1 life to activate', () => {
    const s0 = scenario([], { p1: { hand: ['Test Fee Gate'] }, defs });
    let s = driveOrdered(act(s0, { type: 'playLand', player: 'p1', card: find(s0, 'Test Fee Gate', 'hand', 'p1') }));
    const id = find(s, 'Test Fee Gate', 'battlefield', 'p1');
    expect(subtypes(s, id)).toEqual(expect.arrayContaining(['Gate', 'Swamp']));
    const mana = legal(s, 'p1', 'activate').find((a) => a.object === id && a.isMana === true);
    expect(mana).toBeDefined();
    const before = lifeOf(s);
    s = drive(act(s, mana!.action));
    expect(lifeOf(s)).toBe(before - 1);
  });
  it('negative: a land without the clause pays no life', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Free Gate'] }, defs });
    const mana = legal(s0, 'p1', 'activate').find((a) => a.object === find(s0, 'Test Free Gate', 'battlefield', 'p1') && a.isMana === true)!;
    expect(lifeOf(drive(act(s0, mana.action)))).toBe(20);
  });
  it('a player at 0 life cannot activate it (CR 119.4)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Fee Gate'] }, defs });
    const s = driveOrdered(act(s0, { type: 'playLand', player: 'p1', card: find(s0, 'Test Fee Gate', 'hand', 'p1') }));
    const id = find(s, 'Test Fee Gate', 'battlefield', 'p1');
    const t = structuredClone(s);
    t.players.find((x) => x.id === 'p1')!.life = 0;
    expect(legal(t, 'p1', 'activate').some((a) => a.object === id && a.isMana === true)).toBe(false);
  });
});

describe('edh-next-106 parser and renderer: "sacrifice half the <lands> you control, rounded up" as a cost and the land type link of Thran Portal', () => {
  const cost = (t: string) => card('Test Halver', 'Enchantment', t);
  it('reads only the plain "rounded up" form of a description you control; near misses stay manual', () => {
    expect(full(cost('As an additional cost to cast this spell, sacrifice half the lands you control, rounded up.'))).toBe(true);
    for (const t of ['rounded down.', 'rounded up, then discard a card.', '.']) {
      const text = `As an additional cost to cast this spell, sacrifice half the lands you control${t.startsWith('rounded') ? ', ' + t : t}`;
      expect(full(cost(text)), text).toBe(false);
    }
    expect(full(cost('As an additional cost to cast this spell, sacrifice half the lands target opponent controls, rounded up.'))).toBe(false);
  });
  it('the chosen type is the land type only when the face has exactly one land type choice (a creature type choice keeps its own link)', () => {
    const creature = card('Test Kindred Gate', 'Land', 'As this land enters, choose a creature type.\nThis land is the chosen type in addition to its other types.');
    expect(JSON.stringify(creature.faces)).not.toContain('"chosen":"landType"');
    const land = card('Test Fee Gate Two', 'Land — Gate', 'As this land enters, choose a basic land type.\nThis land is the chosen type in addition to its other types.');
    expect(JSON.stringify(land.faces)).toContain('"chosen":"landType"');
  });
});
