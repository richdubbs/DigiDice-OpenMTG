/**
 * T8 (FAST2 wave): the renderer wordings this package added so that existing templates' JSON passes the exact render gate (G6, design 6.8) for the T8 shapes.
 * Each is an alternative of an existing reading (render/text.ts#alt), never a loosening of the gate: the JSON must still say what the text says. Synthetic
 * wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { automated, card } from '../../m5/templates/support';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const parse = (type: string, text: string) => parseCard(card('Example Lantern', type, text, { mana_cost: '{2}' }) as OracleCard, OPTS).faces[0]!;
const ok = (type: string, text: string) => {
  const f = parse(type, text);
  return automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');
};

describe('FAST2 T8 renderer wordings (G6)', () => {
  it('CR 118.12, 608.2d: after "If you do," the controller\'s instruction may keep its subject ("If you do, you gain 2 life")', () => {
    expect(ok('Artifact', 'Whenever a creature dies, you may pay {2}. If you do, you gain 2 life.')).toBe(true);
    expect(ok('Artifact', 'Whenever a creature dies, you may pay {2}. If you do, draw a card.')).toBe(true);
  });
  it('singular "they" for a player named by the trigger, with a plural verb ("they lose 3 life")', () => {
    expect(ok('Creature — Human', 'Whenever an opponent draws a card, they lose 3 life.')).toBe(true);
    expect(ok('Creature — Human', 'Whenever an opponent draws a card, that player loses 3 life.')).toBe(true);
    // "they" never stands for a player that is not named uniquely: two players named, the pronoun is no reading
    expect(ok('Creature — Human', 'Whenever an opponent draws a card, target player draws a card and they lose 3 life.')).toBe(false);
  });
  it('design 3.5: the amount of the triggering event is "that many" cards or counters', () => {
    expect(ok('Creature — Horror', 'Whenever ~ is dealt damage, draw that many cards.')).toBe(true);
    expect(ok('Creature — Horror', 'Whenever you gain life, put that many +1/+1 counters on ~.')).toBe(true);
  });
  it('CR 122.6: counters "on each of up to two target creatures"', () => {
    expect(ok('Creature — Human', 'When ~ enters, put a +1/+1 counter on each of up to three target creatures.')).toBe(true);
    // a single target has no "each of" reading
    expect(ok('Creature — Human', 'When ~ enters, put a +1/+1 counter on each of target creature.')).toBe(false);
  });
  it('"you attacked this turn" (raid) is a creature you controlled attacking this turn', () => {
    expect(ok('Creature — Human', 'At the beginning of your end step, if you attacked this turn, draw a card.')).toBe(true);
    expect(ok('Creature — Human Pirate', '~ enters with two +1/+1 counters on it if you attacked this turn.')).toBe(true);
  });
  it('CR 504.1: "draws an additional card" at the beginning of a draw step only', () => {
    expect(ok('Enchantment', "At the beginning of each opponent's draw step, that player draws an additional card.")).toBe(true);
    expect(ok('Enchantment', "At the beginning of each opponent's upkeep, that player draws an additional card.")).toBe(false);
  });
  it('CR 608.2c: "Then if ..." begins a sentence after another instruction', () => {
    expect(ok('Enchantment — Aura', 'Whenever enchanted creature blocks, put a +1/+1 counter on it. Then if it has two or more +1/+1 counters on it, sacrifice ~.')).toBe(true);
  });
  it('an event role that the trigger does not name ("is dealt damage": the source) is no antecedent of "it"', () => {
    expect(ok('Enchantment', 'Whenever a creature you control is dealt damage, put a +1/+1 counter on it.')).toBe(true);
  });
  it('"deals damage to <recipient> equal to <amount>" and "deals damage to itself equal to its power"', () => {
    expect(ok('Sorcery', '~ deals damage to target creature equal to the number of Forests you control.')).toBe(true);
    expect(ok('Sorcery', '~ deals damage equal to the number of Forests you control to target creature.')).toBe(true);
    expect(ok('Sorcery', 'Target creature deals damage to itself equal to its power.')).toBe(true);
  });
});
