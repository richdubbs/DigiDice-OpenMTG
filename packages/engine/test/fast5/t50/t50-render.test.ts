/**
 * FAST5 T50: the exact render gate (design 6.8, G6) for the delayed triggers of t50.json: "Until end of turn, whenever ..." is one duration wording of
 * a delayed trigger with a stated end-of-turn duration (CR 603.7b, 514.2); "dies under your control" is worded for a referenced object only (CR 603.10a); a
 * batch delay says "one or more" and an event that is not a batch cannot (CR 603.2c). Nothing here is loosened: a wording the JSON does not say is rejected.
 */
import { describe, expect, it } from 'vitest';
import type { EffectStep, EventPattern } from '../../../src/types/ability';
import { accepts, draw, objTarget, rejects, spell, t } from '../../m5/render/build';

const eot = { d: 'endOfTurn' };
const dies: EventPattern = { ev: 'zoneChange', subject: { types: ['Creature'] }, from: 'battlefield', to: 'graveyard' };
const damage: EventPattern = { ev: 'damage', source: { types: ['Creature'], controller: 'you' }, combat: true, recipient: { player: 'any' } };
const delay = (event: EventPattern, extra: Record<string, unknown> = {}): EffectStep => ({ op: 'delay', when: { at: 'event', event }, do: [draw()], duration: eot, ...extra }) as EffectStep;

describe('CR 603.7b, 514.2: "Until end of turn, whenever ..." and "Whenever ... this turn" are one delayed trigger with an end-of-turn duration', () => {
  const def = spell([delay(dies)]);
  it('accepts the three wordings of the same JSON', () => {
    accepts(def, 'Until end of turn, whenever a creature dies, draw a card.');
    accepts(def, 'Whenever a creature dies this turn, draw a card.');
    accepts(def, 'When a creature dies this turn, draw a card.');
  });
  it('rejects the wording with no time limit, and the leading wording after the effect', () => {
    rejects(def, 'Whenever a creature dies, draw a card.');
    rejects(def, 'Draw a card until end of turn, whenever a creature dies.');
  });
  it('a delayed trigger with no duration does not say "until end of turn"', () => {
    const once = spell([{ op: 'delay', when: { at: 'event', event: dies }, do: [draw()] } as EffectStep]);
    accepts(once, 'When a creature dies, draw a card.');
    rejects(once, 'Until end of turn, whenever a creature dies, draw a card.');
  });
  it('a delayed trigger at a step cannot be worded "until end of turn, whenever"', () => {
    const atEnd = spell([{ op: 'delay', when: { at: 'step', step: 'end', next: true }, do: [draw()], duration: eot } as EffectStep]);
    rejects(atEnd, 'Until end of turn, whenever a creature dies, draw a card.');
  });
});

describe('CR 603.2c: a batch delay says "one or more"; the same event without the batch cannot', () => {
  it('accepts "one or more creatures ... deal" for the batch and rejects it without', () => {
    accepts(spell([delay(damage, { batch: true })]), 'Whenever one or more creatures you control deal combat damage to a player this turn, draw a card.');
    rejects(spell([delay(damage)]), 'Whenever one or more creatures you control deal combat damage to a player this turn, draw a card.');
    rejects(spell([delay(damage, { batch: true })]), 'Whenever a creature you control deals combat damage to a player this turn, draw a card.');
  });
  it('a batch of an event with no "one or more" wording is refused', () => {
    const casts: EventPattern = { ev: 'cast', player: 'you' };
    rejects(spell([delay(casts, { batch: true })]), 'Whenever you cast a spell this turn, draw a card.');
  });
});

describe('CR 603.10a, 700.4: "When it dies under your control this turn"', () => {
  const underYou: EventPattern = { ev: 'zoneChange', subject: { is: t('t0'), controller: 'you' }, from: 'battlefield', to: 'graveyard' };
  const def = spell([delay(underYou)], [objTarget('t0')]);
  it('accepts the wording of a referenced object judged by who controlled it as it died', () => {
    accepts(def, 'When target creature dies under your control this turn, draw a card.');
  });
  it('rejects the wording without the controller, and refuses every other controller or event', () => {
    rejects(def, 'When target creature dies this turn, draw a card.');
    const opp = spell([delay({ ...underYou, subject: { is: t('t0'), controller: 'opponent' } } as EventPattern)], [objTarget('t0')]);
    rejects(opp, 'Target creature. When it dies under an opponent\'s control this turn, draw a card.');
    const exiled = spell([delay({ ...underYou, to: 'exile' } as EventPattern)], [objTarget('t0')]);
    rejects(exiled, 'When target creature is put into exile from the battlefield under your control this turn, draw a card.');
  });
});

void expect;
