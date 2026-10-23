/**
 * std-rx7 (card wave 2, slice s20): the round's keyword expansion, its static template and its "that many" reading, played through the engine with synthetic
 * cards compiled by the game's default compiler (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites
 * from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 702.153a        casualty N: as the spell is cast its controller may sacrifice a creature with power N or greater; if they do, the spell is copied (not with
 *                      a creature of less power, not when they decline)
 *   CR 613.1f, 601.2b  "Each instant and sorcery spell you cast has casualty 1" (sta.stdrx7.spells.cast.each.casualty): offered for an instant and a sorcery,
 *                      not for a creature spell, not for a spell cast while an opponent controls the source
 *   CR 603.10a, 608.2h "Whenever a creature you control with one or more counters on it dies, exile that many cards ..." (parser/lower/scope.ts): the counters on
 *                      it as it last existed on the battlefield, of every kind; no trigger for a creature without counters or an opponent's creature
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type GameState, type ObjectId } from '../../../src/index';
import { act, find, life, scenario } from '../../m3/scenario';
import { card, cast, full, named, resolveAll } from '../cmd3/helpers';

const SALVE = card('Test Salve', 'Instant', 'Casualty 2\nYou gain 2 life.');
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['2', '2']);
const RAT = card('Test Rat', 'Creature — Rat', '', ['1', '1']);
const QUILL = card('Test Quill', 'Creature — Dragon', 'Flying\nEach instant and sorcery spell you cast has casualty 1.', ['3', '3']);
const TONIC = card('Test Tonic', 'Instant', 'You gain 2 life.');
const STUDY = card('Test Study', 'Sorcery', 'You gain 3 life.');
const CUB = card('Test Cub', 'Creature — Bear', '', ['2', '2']);
const URCHIN = card('Test Urchin', 'Creature — Ouphe', 'Whenever a creature you control with one or more counters on it dies, exile that many cards from the top of your library. Until your next end step, you may play those cards.', ['2', '2']);
const DOOM = card('Test Doom', 'Sorcery', 'Destroy target creature.');
const DEFS = [SALVE, OGRE, RAT, QUILL, TONIC, STUDY, CUB, URCHIN, DOOM];

const yesNoAbout = (s: GameState, word: RegExp): boolean => s.pending?.kind === 'yesNo' && word.test((s.pending as unknown as { prompt: string }).prompt);
const exiled = (s: GameState): number => s.zones.exile.length;
const exileCasts = (s: GameState): number => legalActions(s, 'p1').filter((a) => (a.kind === 'playLand' || a.kind === 'cast') && s.objects[a.object!]?.zone === 'exile').length;

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 702.153a: casualty N', () => {
  it('sacrificing a creature with power N or greater as the spell is cast copies it (the copy resolves too)', () => {
    let s = scenario([], { p1: { hand: ['Test Salve'], battlefield: ['Test Ogre'] }, defs: DEFS });
    const before = life(s, 'p1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Salve', 'hand') });
    expect(yesNoAbout(s, /casualty/i)).toBe(true);
    s = resolveAll(s, { yes: true });
    expect(named(s, 'Test Ogre')).toHaveLength(0); // sacrificed (CR 701.21a)
    expect(life(s, 'p1')).toBe(before + 4);
  });
  it('declining keeps the creature and gives no copy', () => {
    let s = scenario([], { p1: { hand: ['Test Salve'], battlefield: ['Test Ogre'] }, defs: DEFS });
    const before = life(s, 'p1');
    s = resolveAll(cast(s, 'Test Salve', { yes: false }), { yes: false });
    expect(named(s, 'Test Ogre')).toHaveLength(1);
    expect(life(s, 'p1')).toBe(before + 2);
  });
  it('a creature with less power than N can\'t pay it: no question, no copy', () => {
    let s = scenario([], { p1: { hand: ['Test Salve'], battlefield: ['Test Rat'] }, defs: DEFS });
    const before = life(s, 'p1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Salve', 'hand') });
    expect(yesNoAbout(s, /casualty/i)).toBe(false);
    s = resolveAll(s, { yes: true });
    expect(named(s, 'Test Rat')).toHaveLength(1);
    expect(life(s, 'p1')).toBe(before + 2);
  });
});

describe('CR 613.1f, 601.2b, 702.153a: "Each instant and sorcery spell you cast has casualty 1"', () => {
  for (const [spell, gain] of [['Test Tonic', 2], ['Test Study', 3]] as const) {
    it(`${spell}: the casualty cost is offered as it is cast; paying it copies the spell`, () => {
      let s = scenario([], { p1: { hand: [spell], battlefield: ['Test Quill', 'Test Rat'] }, defs: DEFS });
      const before = life(s, 'p1');
      s = act(s, { type: 'cast', player: 'p1', card: find(s, spell, 'hand') });
      expect(yesNoAbout(s, /casualty/i)).toBe(true);
      s = resolveAll(s, { yes: true, objects: [find(s, 'Test Rat', 'battlefield')] });
      expect(named(s, 'Test Rat')).toHaveLength(0);
      expect(life(s, 'p1')).toBe(before + 2 * gain);
    });
  }
  it('a creature spell is not offered casualty', () => {
    let s = scenario([], { p1: { hand: ['Test Cub'], battlefield: ['Test Quill', 'Test Rat'] }, defs: DEFS });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Cub', 'hand') });
    expect(yesNoAbout(s, /casualty/i)).toBe(false);
  });
  it('an opponent\'s Quill gives my instant nothing ("you cast" is its controller)', () => {
    let s = scenario([], { p1: { hand: ['Test Tonic'], battlefield: ['Test Rat'] }, p2: { battlefield: ['Test Quill'] }, defs: DEFS });
    const before = life(s, 'p1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Tonic', 'hand') });
    expect(yesNoAbout(s, /casualty/i)).toBe(false);
    s = resolveAll(s, { yes: true });
    expect(life(s, 'p1')).toBe(before + 2);
  });
});

describe('CR 603.10a, 608.2h: "that many" is the counters on the creature that died, as it last existed', () => {
  const kill = (victim: string | { name: string; counters: Record<string, number> }, mine = true): { s: GameState; victimId: ObjectId } => {
    const zones = { battlefield: [victim] };
    let s = scenario([], { p1: { hand: ['Test Doom'], battlefield: ['Test Urchin', ...(mine ? [victim] : [])] }, ...(mine ? {} : { p2: zones }), defs: DEFS });
    const name = typeof victim === 'string' ? victim : victim.name;
    const victimId = find(s, name, 'battlefield', mine ? 'p1' : 'p2');
    s = resolveAll(cast(s, 'Test Doom', { targets: [{ kind: 'object', id: victimId } as never] }));
    return { s, victimId };
  };
  it('a creature with three +1/+1 counters dies: the top three cards are exiled, and may be played until your next end step', () => {
    const { s } = kill({ name: 'Test Ogre', counters: { '+1/+1': 3 } });
    expect(named(s, 'Test Ogre')).toHaveLength(0);
    expect(exiled(s)).toBe(3);
    expect(exileCasts(s)).toBeGreaterThan(0); // a Plains from exile (the scenario's library is Plains; CR 305.1)
  });
  it('counters of every kind count ("one or more counters": two +1/+1 and one oil counter are three)', () => {
    const { s } = kill({ name: 'Test Ogre', counters: { '+1/+1': 2, oil: 1 } });
    expect(exiled(s)).toBe(3);
  });
  it('a creature without counters: no trigger, nothing exiled', () => {
    const { s } = kill('Test Ogre');
    expect(exiled(s)).toBe(0);
  });
  it('an opponent\'s creature with counters: no trigger ("a creature you control")', () => {
    const { s } = kill({ name: 'Test Ogre', counters: { '+1/+1': 2 } }, false);
    expect(exiled(s)).toBe(0);
  });
});
