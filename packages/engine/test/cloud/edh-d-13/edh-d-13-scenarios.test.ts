/**
 * Commander coordinator D, round edh-d-13 (EDHREC ranks 11,251-12,500, fourth pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler. CR cites are from memory (no rules folder in cloud sessions): unverified.
 *
 *   CR 119.3, 603.2, 608.2h    "Whenever you lose life, you gain 2 life for each 1 life you lost." (Transcendence)
 *   CR 115.1d, 611.2c, 613.1b  "Gain control of up to two target creatures." (Jace, Ingenious Mind-Mage)
 *   CR 702.71                  transfigure (Fleshwrither)
 */
import { describe, expect, it } from 'vitest';
import { act, find, scenario } from '../../m3/scenario';
import { card, cast, full, named, resolveAll } from '../cmd3/helpers';
import { lifeOf } from '../../m12/rules/helpers';

describe('CR 119.3, 603.2, 608.2h: "Whenever you lose life, you gain 2 life for each 1 life you lost." (Transcendence)', () => {
  const FONT = card('Test Spirit Font', 'Enchantment', 'Whenever you lose life, you gain 2 life for each 1 life you lost.');
  const DRAIN = card('Test Self Drain', 'Sorcery', 'You lose 3 life.');
  const SAP = card('Test Foe Drain', 'Sorcery', 'Target opponent loses 3 life.');
  it('is full', () => expect(full(FONT)).toBe(true));
  it('losing 3 life nets +3: 20 - 3 + 6 = 23', () => {
    const s0 = scenario([], { defs: [FONT, DRAIN], p1: { hand: ['Test Self Drain'], battlefield: ['Test Spirit Font'] }, p2: {} });
    const s = resolveAll(cast(s0, 'Test Self Drain'));
    expect(lifeOf(s, 'p1')).toBe(23);
  });
  it('negative: an opponent losing life does not trigger it', () => {
    const s0 = scenario([], { defs: [FONT, SAP], p1: { hand: ['Test Foe Drain'], battlefield: ['Test Spirit Font'] }, p2: {} });
    const s = resolveAll(cast(s0, 'Test Foe Drain', { targets: [{ kind: 'player', id: 'p2' }] }));
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(lifeOf(s, 'p2')).toBe(17);
  });
});

describe('CR 115.1d, 611.2c, 613.1b: "Gain control of up to two target creatures." (Jace, Ingenious Mind-Mage)', () => {
  const STEAL = card('Test Grand Theft', 'Sorcery', 'Gain control of up to two target creatures.');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  it('is full', () => expect(full(STEAL)).toBe(true));
  it('the two chosen creatures change controller for good; a third stays with its owner', () => {
    const s0 = scenario([], { defs: [STEAL, BEAR], p1: { hand: ['Test Grand Theft'] }, p2: { battlefield: ['Test Plain Bear', 'Test Plain Bear', 'Test Plain Bear'] } });
    const bears = named(s0, 'Test Plain Bear');
    const s = resolveAll(cast(s0, 'Test Grand Theft', { targets: [{ kind: 'object', id: bears[0]! }, { kind: 'object', id: bears[1]! }] }));
    expect(s.objects[bears[0]!]!.controller).toBe('p1');
    expect(s.objects[bears[1]!]!.controller).toBe('p1');
    expect(s.objects[bears[2]!]!.controller).toBe('p2');
  });
  it('up to: choosing no target is legal and nothing changes hands', () => {
    const s0 = scenario([], { defs: [STEAL, BEAR], p1: { hand: ['Test Grand Theft'] }, p2: { battlefield: ['Test Plain Bear'] } });
    const s = resolveAll(cast(s0, 'Test Grand Theft', { targets: [] }));
    expect(s.objects[named(s0, 'Test Plain Bear')[0]!]!.controller).toBe('p2');
  });
});

describe('CR 702.71: "Transfigure {1}{B}{B}" (Fleshwrither)', () => {
  const WRITHER = card('Test Flesh Smith', 'Creature — Horror', 'Transfigure {0}', ['2', '2'], '{2}{B}');
  const TARGET2 = card('Test Two Drop', 'Creature — Bear', '', ['3', '3'], '{1}{G}');
  const RELIC3 = card('Test Three Relic', 'Artifact', '', undefined, '{3}');
  const TARGET3 = card('Test Three Drop', 'Creature — Bear', '', ['4', '4'], '{2}{G}');
  it('is full', () => expect(full(WRITHER)).toBe(true));
  it('sacrifices itself and puts the creature card of the same mana value (3) onto the battlefield, not the other', () => {
    const s0 = scenario([], { defs: [WRITHER, TARGET2, TARGET3, RELIC3], p1: { battlefield: ['Test Flesh Smith'], library: ['Test Two Drop', 'Test Three Drop', 'Test Three Relic'] }, p2: {} });
    let s = act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Flesh Smith', 'battlefield'), ability: 'k:0:0:0' } as never);
    const three = s.zones.library['p1']!.find((id) => s.objects[id]!.defId === 'Test Three Drop')!;
    // pass priority so the ability resolves, then look at the search decision itself: only the creature card of mana value 3 is offered (not the 2-drop, not the artifact)
    s = act(s, { type: 'pass', player: 'p1' } as never);
    if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player } as never);
    expect(s.pending?.kind).toBe('chooseObjects');
    expect((s.pending as { options: string[] }).options).toEqual([three]);
    s = resolveAll(s, { objects: [three] });
    expect(named(s, 'Test Flesh Smith').length).toBe(0);
    expect(named(s, 'Test Three Drop').length).toBe(1);
    expect(named(s, 'Test Two Drop').length).toBe(0);
  });
});
