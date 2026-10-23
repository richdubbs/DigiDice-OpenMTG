/**
 * WP22 review, template findings: wordings a WP22 template read with a meaning the text does not have. Synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../../../src/types/ability';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { classifyAbility } from '../../../src/model/classify';
import { normalizeForGate } from '../../../src/render/equivalence';
import { automated, card, face, options } from './support';

const opts = options([], { capabilities: ENGINE_CAPABILITIES });
const parse = (type: string, text: string): AbilityDef[] => face(card('Test Review Charm', type, text), opts).abilities;

describe('CR 502.3: "your untap step" is the untap step of the source\'s controller (WP22 review finding 9)', () => {
  it('"Enchanted creature doesn\'t untap during your untap step." is not automated: the Aura\'s controller\'s untap step, which the model cannot say', () => {
    const a = parse('Enchantment — Aura', 'Enchanted creature doesn\'t untap during your untap step.');
    expect(automated(a), JSON.stringify(a)).toBe(false);
  });
  it('"Enchanted creature doesn\'t untap during its controller\'s untap step." and "~ doesn\'t untap during your untap step." still are', () => {
    expect(automated(parse('Enchantment — Aura', 'Enchanted creature doesn\'t untap during its controller\'s untap step.'))).toBe(true);
    expect(automated(parse('Artifact Creature — Golem', '~ doesn\'t untap during your untap step.'))).toBe(true);
  });
});

describe('CR 702.14a-c, 702.16: a granted keyword the keyword code cannot honor is never automated (WP22 review finding 10)', () => {
  const level = (type: string, text: string): string[] => parse(type, text).map((a) => classifyAbility(a, ENGINE_CAPABILITIES).level);
  it('"Creatures you control gain landwalk until end of turn." (a landwalk with no land type) is not full', () => {
    expect(level('Instant', 'Creatures you control gain landwalk until end of turn.')).not.toContain('full');
  });
  // W3 integration: since WP21's review, rules/quality.ts maps the irregular plurals of the lexicon ("Oxen" -> Ox, CR 205.3m), so the quality code can honor
  // this one (test/m5/templates/review.test.ts checks the parsed quality protects from an Ox); the parser reads it as a quality since that merge
  it('"Enchanted creature has protection from Oxen." (an irregular plural rules/quality.ts maps to its subtype since WP21) is full', () => {
    expect(level('Enchantment — Aura', 'Enchanted creature has protection from Oxen.')).toEqual(['full']);
  });
  it('a protection from a regular plural and another keyword stay full: "Enchanted creature has protection from Goblins.", "Creatures you control gain flying until end of turn."', () => {
    expect(level('Instant', 'Creatures you control gain flying until end of turn.')).toEqual(['full']);
    expect(level('Enchantment — Aura', 'Enchanted creature has protection from Goblins.')).toEqual(['full']);
  });
});

describe('CR 716.2a: a Class level line is printed without a period (render/equivalence.ts, WP22 review finding 7)', () => {
  it('the gate normalizes "{2}{R}: Level 2" followed by the level\'s abilities as the renderer writes it ("{2}{R}: Level 2. ..."), and nowhere else', () => {
    expect(normalizeForGate('{2}{R}: Level 2 Creatures you control have haste.', [])).toBe(normalizeForGate('{2}{R}: Level 2. Creatures you control have haste.', []));
    expect(normalizeForGate('{2}{R}: Level 2', [])).toBe('{2}{r}: level 2.');
    expect(normalizeForGate('Level up {1}{U}', [])).toBe('level up {1}{u}');
    expect(normalizeForGate('{T}: Draw a card. Level 2 creatures can\'t block.', [])).not.toContain('level 2.');
  });
});
