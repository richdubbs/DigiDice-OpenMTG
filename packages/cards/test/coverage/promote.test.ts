/**
 * WP25: `coverage --promote` (design 11.6): template induction from reviewed abilities, with the G9 and G10 checks CI would run. The reviewed
 * abilities here are produced by the parser itself from invented wordings (design 6.10) and then "forgotten" by removing the template that made them.
 */
import { describe, expect, it } from 'vitest';
import { BOOTSTRAP_TEMPLATES, type AbilityDef } from '@openmtg/engine';
import { fixtureCards } from '../../src/coverage/corpus';
import { createCoverageEngine } from '../../src/coverage/engine';
import { promote, proposeTemplate } from '../../src/coverage/promote';
import { synthetic } from './support';

const engine = createCoverageEngine({ templates: BOOTSTRAP_TEMPLATES });
const ability = (typeLine: string, text: string): AbilityDef => engine.run(synthetic('Sample Source', typeLine, text)).parse.faces[0]!.abilities[0]!;

describe('WP25 template proposals (design 11.6)', () => {
  it('turns target phrases and numbers into typed holes, keeps "~", and builds an experimental template with synthetic examples', () => {
    const p = proposeTemplate({ card: 'Sample Source', ability: ability('Instant', 'Sample Source deals 5 damage to any target.') }, 0);
    expect(p.refused).toBeUndefined();
    const t = p.template!;
    expect(t.pattern).toBe('~ deals {n0:Qty} damage to {t0:Recipient}');
    expect(t.build).toEqual({ op: 'damage', source: { ref: 'self' }, to: '$t0', amount: '$n0' });
    expect(t.status).toBe('experimental');
    expect(t.kind).toBe('effect');
    expect(t.cr.length).toBeGreaterThan(0);
    expect(t.examples.map((e) => e.text)).not.toContain('~ deals 5 damage to any target.');
    expect(t.examples.length).toBeGreaterThanOrEqual(1);
    expect(t.counterExamples.length).toBeGreaterThanOrEqual(2);
  });
  it('refuses what it cannot generalize honestly: a literal wording, a triggered ability, several steps', () => {
    expect(proposeTemplate({ card: 'x', ability: ability('Sorcery', 'Draw a card.') }, 0).refused).toMatch(/nothing to generalize/);
    expect(proposeTemplate({ card: 'x', ability: ability('Creature — Elf', 'When Sample Source enters, draw two cards.') }, 0).refused).toMatch(/triggered/);
    const two: AbilityDef = { kind: 'spell', text: 'Draw two cards. Draw two cards.', effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: 2 }, { op: 'draw', who: { ref: 'you' }, count: 2 }] } } as AbilityDef;
    expect(proposeTemplate({ card: 'x', ability: two }, 0).refused).toMatch(/2 steps/);
  });
  it('checks each proposal: G9 (examples parse, no counter-example or near miss keeps the JSON) and G10 (only formerly manual units change)', () => {
    const reviewed = { card: 'Sample Source', ability: ability('Instant', 'Sample Source deals 5 damage to any target.') };
    const base = BOOTSTRAP_TEMPLATES.filter((t) => t.id !== 'eff.damage');
    const [p] = promote([reviewed], base, fixtureCards());
    expect(p!.template).toBeDefined();
    expect(p!.checks!.g9).toEqual([]);
    expect(p!.checks!.g10).toEqual([]);
    expect(p!.checks!.changedCards).toBeGreaterThan(0);
  }, 120_000);
});
