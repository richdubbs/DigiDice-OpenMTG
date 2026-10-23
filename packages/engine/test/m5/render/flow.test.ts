/**
 * WP2 review fixes: control flow keeps the structure of the model. Who decides first in "unless pays" (CR 118.12a), which steps depend on a choice (CR 608.2c-d),
 * what an intervening "if" is (CR 603.4) and how far "you may" reaches (CR 608.2d) all change what the game does, so each must change the words.
 */
import { describe, it } from 'vitest';
import type { Condition, EffectStep } from '../../../src/types/ability';
import { accepts, draw, mana, rejects, spell, trig, you } from './build';

const creatureCtx = { selfNames: ['Test Card'], selfTypes: ['Creature'] };
const payer = { ref: 'event', role: 'player' } as const;
const opponentCasts = [{ ev: 'cast', player: 'opponent' }] as never;
const enters = [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }] as never;
const forest: Condition = { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Forest'], controller: 'you' } } };
const discard: EffectStep = { op: 'discard', who: you, count: 1 };

describe('CR 118.12a: "unless that player pays" makes the payer decide first', () => {
  const gain = { op: 'gainLife', who: you, amount: 2 } as EffectStep;
  const text = 'Whenever an opponent casts a spell, you may gain 2 life unless that player pays {2}.';
  const payerFirst = trig(opponentCasts, [{ op: 'pay', who: payer, cost: { mana: mana(2) }, else: [{ op: 'may', who: you, do: [gain] }] } as EffectStep]);
  const controllerFirst = trig(opponentCasts, [{ op: 'may', who: you, do: [{ op: 'pay', who: payer, cost: { mana: mana(2) }, else: [gain] } as EffectStep] }]);
  it('accepts the sentence for the payer deciding first (pay with a may in its else branch)', () => accepts(payerFirst, text, creatureCtx));
  it('rejects the sentence for the controller deciding first (a pay by another player inside "you may")', () => rejects(controllerFirst, text, creatureCtx));
});

describe('CR 608.2c-d: a step that depends on "you may" says "if you do"', () => {
  const may = { op: 'may', who: you, do: [discard], as: 'm' } as EffectStep;
  const dependent = { ...draw(), guard: { cond: 'did', step: 'm' } } as EffectStep;
  it('accepts "You may discard a card. If you do, draw a card."', () => accepts(spell([may, dependent]), 'You may discard a card. If you do, draw a card.'));
  it('rejects the unconditional wording for a dependent step', () => rejects(spell([may, dependent]), 'You may discard a card. Draw a card.'));
  it('rejects "if you do" for an independent step', () => rejects(spell([may, draw()]), 'You may discard a card. If you do, draw a card.'));
  it('a dependent step after a pay prints "if you do" too', () => {
    const pay = { op: 'pay', who: you, cost: { mana: mana(1) }, as: 'p' } as EffectStep;
    const after = { ...draw(), guard: { cond: 'did', step: 'p' } } as EffectStep;
    accepts(spell([pay, after]), 'You may pay {1}. If you do, draw a card.');
    rejects(spell([pay, after]), 'You may pay {1}. Draw a card.');
  });
  it('"if you don\'t" still works (the other polarity)', () => {
    const not = { ...draw(), guard: { cond: 'did', step: 'm', not: true } } as EffectStep;
    accepts(spell([may, not]), "You may discard a card. If you don't, draw a card.");
  });
  it('a chosen object that the dependent step names is implied by its anaphor ("that creature")', () => {
    const choose = { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { types: ['Creature'] } }, min: 0, max: 1, as: 'c' } as EffectStep;
    const destroy = { op: 'destroy', what: { ref: 'bound', name: 'c' }, guard: { cond: 'did', step: 'c' } } as EffectStep;
    accepts(spell([choose, destroy]), 'Choose up to one creature. Destroy that creature.');
  });
});

describe('CR 603.4: an "if" right after the trigger is an intervening if; a condition of the effect is not', () => {
  const draws = [draw()];
  const intervening = trig(enters, draws, { interveningIf: forest });
  const resolution = trig(enters, [{ op: 'if', cond: forest, then: draws } as EffectStep]);
  const guarded = trig(enters, [{ ...draw(), guard: forest } as EffectStep]);
  const leading = 'When this creature enters, if you control a Forest, draw a card.';
  const trailing = 'When this creature enters, draw a card if you control a Forest.';
  it('interveningIf prints the leading form only', () => {
    accepts(intervening, leading, creatureCtx);
    rejects(intervening, trailing, creatureCtx);
  });
  it('an `if` step as the first step prints the trailing form only', () => {
    accepts(resolution, trailing, creatureCtx);
    rejects(resolution, leading, creatureCtx);
  });
  it('a guarded first step prints the trailing form only', () => {
    accepts(guarded, trailing, creatureCtx);
    rejects(guarded, leading, creatureCtx);
  });
  it('a conditional step later in the effect keeps the leading form', () => {
    const later = trig(enters, [draw(), { op: 'if', cond: forest, then: [{ op: 'gainLife', who: you, amount: 1 }] } as EffectStep]);
    accepts(later, 'When this creature enters, draw a card. If you control a Forest, gain 1 life.', creatureCtx);
  });
  it('an `if` with an otherwise cannot be an intervening if and keeps the leading form', () => {
    const both = trig(enters, [{ op: 'if', cond: forest, then: draws, else: [{ op: 'gainLife', who: you, amount: 1 }] } as EffectStep]);
    accepts(both, 'When this creature enters, if you control a Forest, draw a card. Otherwise, gain 1 life.', creatureCtx);
  });
});

describe('CR 608.2d: "you may" covers only the steps inside it', () => {
  it('may[draw, discard] reads as one optional sequence', () => {
    const both = spell([{ op: 'may', who: you, do: [draw(), discard] } as EffectStep]);
    accepts(both, 'You may draw a card, then discard a card.');
  });
  it('[may[draw], discard] (the discard is mandatory) never reads as one optional sequence', () => {
    const second = spell([{ op: 'may', who: you, do: [draw()] } as EffectStep, discard]);
    rejects(second, 'You may draw a card, then discard a card.');
    rejects(second, 'You may draw a card and discard a card.');
    accepts(second, 'You may draw a card. Discard a card.');
  });
  it('[draw, may[discard]] (only the discard is optional) keeps "then you may"', () => {
    const first = spell([draw(), { op: 'may', who: you, do: [discard] } as EffectStep]);
    accepts(first, 'Draw a card, then you may discard a card.');
  });
  it('three steps: [may[A, B], C] and may[A, B, C] differ', () => {
    const gain = { op: 'gainLife', who: you, amount: 1 } as EffectStep;
    const scoped = spell([{ op: 'may', who: you, do: [draw(), discard] } as EffectStep, gain]);
    rejects(scoped, 'You may draw a card, then discard a card, then gain 1 life.');
    accepts(scoped, 'You may draw a card, then discard a card. Gain 1 life.');
  });
});

describe('CR 603.4: "fewer than N" is not "no"', () => {
  const creatures = { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } as const;
  const few = trig(enters, [draw()], { interveningIf: { cond: 'not', of: { cond: 'exists', of: creatures, atLeast: 2 } } });
  it('not(exists atLeast 2) is "fewer than two"', () => {
    accepts(few, 'When this creature enters, if you control fewer than two creatures, draw a card.', creatureCtx);
    rejects(few, 'When this creature enters, if you control no creatures, draw a card.', creatureCtx);
  });
  it('not(exists) is still "no"', () => {
    const none = trig(enters, [draw()], { interveningIf: { cond: 'not', of: { cond: 'exists', of: creatures } } });
    accepts(none, 'When this creature enters, if you control no creatures, draw a card.', creatureCtx);
  });
});

describe('CR 118.12: a payment that cannot be declined has no else branch to print', () => {
  it('a mandatory pay with an else or a then is refused instead of printing only the cost', () => {
    const mandatory = (extra: Record<string, unknown>): EffectStep => ({ op: 'pay', who: you, cost: { mana: mana(2) }, mandatory: true, ...extra } as EffectStep);
    rejects(spell([mandatory({ else: [draw()] })]), 'Pay {2}.');
    rejects(spell([mandatory({ then: [draw()] })]), 'Pay {2}.');
    accepts(spell([mandatory({})]), 'Pay {2}.');
  });
});
