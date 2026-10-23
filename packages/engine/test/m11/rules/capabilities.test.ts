/**
 * M11-1 (m11 design 4.6): the capabilities M11-1 turns on, the M6 pattern (a capability exists because its owner's table entry exists): they replace the M11-0
 * pin test/m11/skeleton/absent-m11-1.test.ts. Each one's behavior is tested in this folder (identity-mana, abilities-in-command-zone, cast, command-zone).
 */
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES } from '../../../src/index';
import { COMMANDER_FEATURES } from '../../../src/core/commander';
import { COMMANDER_FILTER_PARTS } from '../../../src/rules/filter-parts/commander';

describe('M11-1: the milestone 11 capabilities are advertised', () => {
  it.each(['feature:mana.commanderIdentity', 'feature:zone.command', 'filter:commander', 'sfilter:commander', 'decision:commanderZone', 'q:commanderCasts'])('%s', (cap) => {
    expect(ENGINE_CAPABILITIES.has(cap)).toBe(true);
  });

  it('the tables M11-1 fills', () => {
    expect(COMMANDER_FEATURES).toEqual(['mana.commanderIdentity', 'zone.command']);
    expect(COMMANDER_FILTER_PARTS).toEqual(['commander']);
  });
});
