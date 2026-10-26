/**
 * pc-combat-3 (Commander precon lane pc-combat): the parser, lowering and renderer changes of the round (no new template file), one test each. CR cites from memory,
 * unverified (no rules/cr in the cloud checkout). Behavior is in pc-combat-3-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { bare, card, fullyAutomated } from '../../m5/templates/support';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const lowered = (text: string, type = 'Legendary Creature — Human Warlock'): unknown => {
  const f = parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
  return fullyAutomated(f) ? JSON.parse(JSON.stringify(bare(f.abilities)))[0] : null;
};
const ENCHANTED = { ref: 'enchantedPlayer' };

describe('pc-combat-3 readings', () => {
  it('hole Event (CR 508.1b, 303.4): "a creature attacks enchanted player" is one attack on the enchanted player by one creature (never a planeswalker they control)', () => {
    const a = lowered('Whenever a creature attacks enchanted player, you gain 1 life.') as { trigger: unknown };
    expect(a.trigger).toEqual({ on: [{ ev: 'attacks', attacker: { types: ['Creature'] }, defender: ENCHANTED }] });
    expect(lowered('Whenever a creature attacks enchanted player or a planeswalker they control, you gain 1 life.')).toBeNull();
  });
  it('hole Filter + render (CR 506.3, 508.1b): "attacking you or a planeswalker you control" keeps the planeswalker (orPlaneswalker); "attacking you" does not', () => {
    const a = lowered('Exile target creature that\'s attacking you or a planeswalker you control.', 'Instant') as { effect: { targets: { filter: unknown }[] } };
    expect(a.effect.targets[0]!.filter).toEqual({ types: ['Creature'], attacking: { defender: 'you', orPlaneswalker: true } });
    const b = lowered('Exile target creature that\'s attacking you.', 'Instant') as { effect: { targets: { filter: unknown }[] } };
    expect(b.effect.targets[0]!.filter).toEqual({ types: ['Creature'], attacking: { defender: 'you' } });
  });
  it('hole Event (CR 508.1a-b, 603.2c): "an opponent attacks you [with two or more creatures]" is a declaration by an opponent whose attackers attack you', () => {
    const a = lowered('Whenever an opponent attacks you, you gain 1 life.') as { trigger: unknown };
    expect(a.trigger).toEqual({ on: [{ ev: 'attacks', attacker: { types: ['Creature'], controller: 'opponent' }, count: { op: '>=', value: 1 }, defender: 'you' }], batch: true });
    const b = lowered('Whenever an opponent attacks you with two or more creatures, you gain 1 life.') as { trigger: { on: { count: unknown }[] } };
    expect(b.trigger.on[0]!.count).toEqual({ op: '>=', value: 2 });
    expect(lowered('Whenever an opponent attacks you or a planeswalker you control, you gain 1 life.')).toBeNull();
    expect(lowered('Whenever an opponent attacks you with two creatures, you gain 1 life.')).toBeNull();
  });
});
