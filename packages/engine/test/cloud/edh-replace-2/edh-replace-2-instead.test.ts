/**
 * edh-replace-2: the parser and lowering changes of the round, read through the default compiler with synthetic cards (design 6.10): which "instead" sentences fold
 * into `if C then X else Y` (render/self-replacement.ts, parser/lower/riders.ts), and the near misses that must stay manual (guard G9 spirit: a wider reading would
 * compile a different card wrongly). CR cites from memory, unverified where marked (rules/cr/ is not in the cloud checkout; CR 614.15 and 608.2c were checked against the
 * 2026-09-25 text).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type OracleCard } from '../../../src/index';

function spell(text: string): CardDef {
  return compileCard({ name: 'Example Rite', layout: 'normal', mana_cost: '{0}', type_line: 'Instant', oracle_text: text, colors: [], keywords: [] } as OracleCard);
}
function trigger(text: string): CardDef {
  return compileCard({ name: 'Example Brute', layout: 'normal', mana_cost: '{0}', type_line: 'Creature — Elf', oracle_text: text, colors: [], keywords: [], power: '1', toughness: '1' } as OracleCard);
}
const steps = (d: CardDef): unknown[] => d.faces.flatMap((f) => f.abilities.flatMap((a) => ('effect' in a && a.effect ? a.effect.steps : [])));
const isManual = (d: CardDef): boolean => JSON.stringify(d.faces).includes('"op":"manual"') || d.faces.some((f) => f.abilities.some((a) => a.kind === 'manual'));
const folds = (d: CardDef): boolean => !isManual(d) && steps(d).length === 1 && (steps(d)[0] as { op: string }).op === 'if';

describe('edh-replace-2: "instead" folds (CR 614.15, 608.2c)', () => {
  it('one instruction of you by another one of you: "Scry 1. If C, draw a card instead."', () => {
    expect(folds(spell('Scry 1. If you control three or more creatures, draw a card instead.'))).toBe(true);
    expect(folds(spell('You gain 2 life. If you control three or more creatures, draw two cards instead.'))).toBe(true);
  });
  it('near misses stay manual: another player, a target, a second kind of instruction', () => {
    expect(isManual(spell('Draw a card. If you control three or more creatures, each opponent draws a card instead.'))).toBe(true);
    expect(isManual(spell('Target player scries 1. If you control three or more creatures, you draw a card instead.'))).toBe(true);
    expect(isManual(spell('Scry 1 and gain 2 life. If you control three or more creatures, draw a card instead.'))).toBe(true);
  });
  it('review: an earlier instruction of the same kind makes the swap unclear, so it stays manual', () => {
    expect(isManual(spell('Draw a card. You gain 2 life. If you control an artifact, draw two cards instead.'))).toBe(true);
    expect(isManual(trigger('When ~ enters, scry 2. You lose 1 life. If you control an artifact, draw a card instead.'))).toBe(true);
    expect(isManual(spell('Draw a card. If you control an Elf, you gain 2 life. If you control a Wizard, draw two cards instead.'))).toBe(true);
  });
  it('review: a shield for "that creature" after "dealt damage this way" is not built on the target (Burn from Within stays partial)', () => {
    expect(isManual(spell('~ deals X damage to any target. If a creature is dealt damage this way, it loses indestructible until end of turn. If that creature would die this turn, exile it instead.'))).toBe(true);
  });
  it('a sacrifice choice by the same players with another filter and count', () => {
    expect(folds(spell('Each opponent sacrifices a creature of their choice. If you control three or more creatures, instead each opponent sacrifices half the creatures they control of their choice, rounded up.'))).toBe(true);
    expect(isManual(spell('Each opponent sacrifices a creature of their choice. If you control three or more creatures, instead each player sacrifices half the creatures they control of their choice, rounded up.'))).toBe(true);
  });
  it('a choice of cards by the same player from the same zone with another description; another zone stays manual', () => {
    expect(folds(spell('You may put a land card from your hand onto the battlefield tapped. If you control three or more creatures, instead you may put a creature or land card from your hand onto the battlefield tapped.'))).toBe(true);
    expect(isManual(spell('You may put a land card from your hand onto the battlefield tapped. If you control three or more creatures, instead you may put a creature or land card from your graveyard onto the battlefield tapped.'))).toBe(true);
  });
  it('a "for each" restated with another payment and another loss; another group stays manual', () => {
    expect(folds(spell('Each opponent loses 3 life unless they discard a card. If you control three or more creatures, instead each opponent loses 6 life unless they discard two cards.'))).toBe(true);
    expect(isManual(spell('Each opponent loses 3 life unless they discard a card. If you control three or more creatures, instead each player loses 6 life unless they discard two cards.'))).toBe(true);
  });
  it('inside the consequence of a payment: only a payment with ONE consequence', () => {
    const one = trigger("Whenever another creature you control enters, you may pay {G/W}. If you do, put a +1/+1 counter on it. If it's a Unicorn, put two +1/+1 counters on it instead.");
    expect(isManual(one)).toBe(false);
    const two = trigger("Whenever another creature you control enters, you may pay {G/W}. If you do, draw a card and put a +1/+1 counter on it. If it's a Unicorn, put two +1/+1 counters on it instead.");
    expect(isManual(two)).toBe(true);
  });
});

describe('edh-replace-2: readings', () => {
  it('"its power" in the damage a source deals is that source (the object itself), not the spell the trigger is about', () => {
    const d = trigger('Whenever an opponent casts a noncreature spell, ~ deals damage equal to its power to that player.');
    expect(isManual(d)).toBe(false);
    expect(JSON.stringify(steps(d))).toContain('"stat":"power","of":{"ref":"self"}');
  });
  it('"black and/or red" is "black or red"', () => {
    const a = spell('Destroy target black and/or red creature.');
    const b = spell('Destroy target black or red creature.');
    expect(isManual(a)).toBe(false);
    expect(JSON.stringify(steps(a))).toBe(JSON.stringify(steps(b)));
  });
  it('"the amount of damage those creatures dealt to that player" and "that damage" read the batch total only after a damage trigger; elsewhere they stay manual', () => {
    expect(isManual(trigger('Whenever one or more creatures you control with trample deal combat damage to a player, you gain life equal to the amount of damage those creatures dealt to that player.'))).toBe(false);
    expect(isManual(trigger('Whenever you cast a spell, you gain life equal to the amount of damage those creatures dealt to that player.'))).toBe(true);
  });
  it('"If a Dinosaur is dealt damage this way, ..." needs the damage instruction right before it', () => {
    expect(isManual(trigger('Whenever another creature you control enters, ~ deals 2 damage to it. If a Dinosaur is dealt damage this way, ~ gets +2/+0 until end of turn.'))).toBe(false);
    expect(isManual(spell('If a Dinosaur is dealt damage this way, you gain 2 life.'))).toBe(true);
  });
});
