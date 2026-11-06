/**
 * Commander top-rank part 4, round edh-next-88 (code edhn88): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites are from memory (no rules/cr in cloud sessions): unverified.
 *
 *   CR 702.16a, 122.1         "Protection from permanents with corruption counters on them" (Geyadrone Dihada)
 *   CR 601.2h, 106.1          "Destroy target nonland permanent if it's a creature or if {G}{W} was spent to cast this spell." (Mythos of Nethroi)
 *   CR 601.2a, 608.2h         "... where X is 1 plus the number of spells you've cast from anywhere other than your hand this turn." (Impending Flux)
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type GameState } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { hasProtectionFrom } from '../../../src/rules/protection';
import { act, card, cast, drive, find, full, lifeOf, obj, resolveAll, scenario } from '../r3-cost/support';

describe('"Protection from permanents with corruption counters on them" (CR 702.16a, 122.1; Geyadrone Dihada)', () => {
  const GUARD = card('Test Guard', 'Creature — Soldier', 'Protection from permanents with fate counters on them', '{0}', ['2', '2']);
  const OTHER = card('Test Other', 'Artifact', '');
  const defs = [GUARD, OTHER];
  const start = (counters?: Record<string, number>): GameState => scenario([], { p1: { battlefield: ['Test Guard'] }, p2: { battlefield: [counters ? { name: 'Test Other', counters } : 'Test Other'] }, defs });
  it('has no manual part', () => expect(full(GUARD)).toBe(true));
  it('protects from a permanent that has a counter of that kind, not from one without or with another kind', () => {
    for (const [counters, expected] of [[{ fate: 1 }, true], [undefined, false], [{ doom: 2 }, false]] as const) {
      const s = start(counters as Record<string, number> | undefined);
      expect(hasProtectionFrom(getChars(s, find(s, 'Test Guard', 'battlefield', 'p1')), getChars(s, find(s, 'Test Other', 'battlefield', 'p2'))), JSON.stringify(counters)).toBe(expected);
    }
  });
});

describe('"Destroy target nonland permanent if it\'s a creature or if {G}{W} was spent to cast this spell." (CR 601.2h, 106.1; Mythos of Nethroi)', () => {
  const REND = card('Test Rend', 'Instant', "Destroy target nonland permanent if it's a creature or if {G}{W} was spent to cast this spell.", '{2}');
  const RELIC = card('Test Relic', 'Artifact', '');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const defs = [REND, RELIC, BEAR];
  const run = (lands: string[], target: string): GameState => {
    const s0 = scenario(['Forest', 'Plains'], { p1: { hand: ['Test Rend'], battlefield: lands }, p2: { battlefield: [target] }, defs });
    return resolveAll(cast(s0, 'Test Rend', { targets: [[obj(find(s0, target, 'battlefield', 'p2'))]] }));
  };
  const alive = (s: GameState, name: string): boolean => s.zones.battlefield.some((id) => s.objects[id]!.defId === name);
  it('has no manual part', () => expect(full(REND)).toBe(true));
  it('destroys a noncreature permanent when green and white mana were both spent', () => expect(alive(run(['Forest', 'Plains'], 'Test Relic'), 'Test Relic')).toBe(false));
  it('negative: green and green does not destroy a noncreature permanent; any mana destroys a creature', () => {
    expect(alive(run(['Forest', 'Forest'], 'Test Relic'), 'Test Relic')).toBe(true);
    expect(alive(run(['Forest', 'Forest'], 'Test Bear'), 'Test Bear')).toBe(false);
  });
});

describe('"~ deals X damage to each opponent and each creature they control, where X is 1 plus the number of spells you\'ve cast from anywhere other than your hand this turn." (CR 601.2a, 608.2h; Impending Flux)', () => {
  const FLUX = card('Test Flux', 'Sorcery', "Test Flux deals X damage to each opponent and each creature they control, where X is 1 plus the number of spells you've cast from anywhere other than your hand this turn.");
  const ECHO = card('Test Echo', 'Sorcery', 'You gain 1 life.\nFlashback {0}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const defs = [FLUX, ECHO, BEAR];
  const bears = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Bear').length;
  it('has no manual part', () => expect(full(FLUX)).toBe(true));
  it('X is 1 when only spells from the hand were cast: 1 damage to the opponent, the bear survives', () => {
    const s0 = scenario([], { p1: { hand: ['Test Flux'] }, p2: { battlefield: ['Test Bear'] }, defs });
    const s = resolveAll(cast(s0, 'Test Flux'));
    expect(lifeOf(s, 'p2')).toBe(19);
    expect(bears(s)).toBe(1);
  });
  it('X is 2 after a spell was cast from the graveyard this turn: 2 damage to the opponent, the 2/2 bear dies', () => {
    const s0 = scenario([], { p1: { hand: ['Test Flux'], graveyard: ['Test Echo'] }, p2: { battlefield: ['Test Bear'] }, defs });
    const s1 = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Echo', 'graveyard', 'p1'), method: 'flashback' })));
    const s = resolveAll(cast(s1, 'Test Flux'));
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(bears(s)).toBe(0);
  });
});
