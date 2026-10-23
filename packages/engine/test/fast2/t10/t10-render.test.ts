/**
 * T10 (FAST2 wave): the renderer additions the T10 templates and the anaphora rules need for the exact render gate (design 6.8, G6). Each case states what
 * the renderer accepts for a JSON and which wording it must NOT accept, so the gate never excuses a different meaning. Wordings are synthetic (design 6.10).
 *
 *   CR 701.23a        the search idiom: "search ..., put it ..." names the card found, even after a trigger named ~
 *   CR 701.24a        "..., then shuffle and put that card on top"
 *   CR 401.4          "look at the top N cards of your library, then put them back in any order"
 *   CR 400.7          what a move put in a new zone is "that card" there, the same thing as what was moved ("exile target creature. Return it ...")
 *   CR 201.5          while a trigger's event leaves ~ where it is, "that creature" is the other object, never ~
 *   CR 301.5c         "attach ~ to it": it is never ~ itself
 *   CR 701.21a        "sacrifice it" never names the spell or ability that targeted ~
 *   CR 110.4          "a Rebel permanent card"
 */
import { describe, it } from 'vitest';
import type { AbilityDef, EffectStep, EventPattern } from '../../../src/index';
import { accepts, bound, objTarget, rejects, self, spell, t, trig, you } from '../../m5/render/build';

const search = (filter: Record<string, unknown>, extra: Record<string, unknown> = {}): EffectStep => ({ op: 'search', who: you, zone: 'library', filter, max: 1, as: 'found', ...extra } as EffectStep);
const shuffle: EffectStep = { op: 'shuffle', who: you } as EffectStep;
const enters: EventPattern[] = [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' } as EventPattern];
const basicLand = { supertypes: ['Basic'], types: ['Land'] };
const toBattlefieldTapped = { zone: 'battlefield', controller: you, tapped: true };

describe('CR 701.23a: the search idiom names the card found "it" or "that card"', () => {
  const etb = (extra: EffectStep[] = []): AbilityDef => trig(enters, [search(basicLand), ...extra, { op: 'move', what: bound('found'), to: toBattlefieldTapped } as EffectStep, shuffle]);
  it('CR 701.23a: right after the search, "it" is the card found even though the trigger named ~', () => {
    accepts(etb(), 'When ~ enters, search your library for a basic land card, put it onto the battlefield tapped, then shuffle.');
    accepts(etb(), 'When ~ enters, search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.');
  });
  it('design 6.4: with another instruction between them, "it" may be ~ again, so it is not written', () => {
    rejects(etb([{ op: 'draw', who: you, count: 1 } as EffectStep]), 'When ~ enters, search your library for a basic land card, draw a card, put it onto the battlefield tapped, then shuffle.');
  });
  it('the moved card is the one found, never ~ ("put ~ onto the battlefield" is a different JSON)', () => {
    const wrong = trig(enters, [search(basicLand), { op: 'move', what: self, to: toBattlefieldTapped } as EffectStep, shuffle]);
    rejects(wrong, 'When ~ enters, search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.');
  });
});

describe('CR 701.24a: "then shuffle and put that card on top"', () => {
  const top = (position: 'top' | 'bottom'): AbilityDef => spell([search({ types: ['Artifact'] }, { reveal: true }), shuffle, { op: 'move', what: bound('found'), to: { zone: 'library', position } } as EffectStep]);
  it('the shuffle, then the found card on top of the library', () => {
    accepts(top('top'), 'Search your library for an artifact card, reveal it, then shuffle and put that card on top.');
  });
  it('never for the bottom of the library, nor for the card put there before the shuffle', () => {
    rejects(top('bottom'), 'Search your library for an artifact card, reveal it, then shuffle and put that card on top.');
    const before = spell([search({ types: ['Artifact'] }, { reveal: true }), { op: 'move', what: bound('found'), to: { zone: 'library', position: 'top' } } as EffectStep, shuffle]);
    rejects(before, 'Search your library for an artifact card, reveal it, then shuffle and put that card on top.');
  });
});

describe('CR 401.4: "look at the top N cards of your library, then put them back in any order"', () => {
  const look = (order: 'chosen' | 'random', count = 3): AbilityDef => spell([
    { op: 'look', who: you, at: { ref: 'topCards', player: you, count }, as: 'seen' } as EffectStep,
    { op: 'move', what: bound('seen'), to: { zone: 'library', position: 'top', order } } as EffectStep,
  ]);
  it('the looked-at cards go back on top in an order their owner chooses', () => {
    accepts(look('chosen'), 'Look at the top three cards of your library, then put them back in any order.');
  });
  it('never for a random order or another number of cards', () => {
    rejects(look('random'), 'Look at the top three cards of your library, then put them back in any order.');
    rejects(look('chosen', 4), 'Look at the top three cards of your library, then put them back in any order.');
  });
});

describe('CR 400.7, 610.3: what a move put into exile is "that card" there, and "it" is still the one thing', () => {
  const blink = (back: 'owner' | 'you'): AbilityDef => spell([
    { op: 'move', what: t('t0'), to: { zone: 'exile' }, as: 'moved' } as EffectStep,
    { op: 'move', what: bound('moved'), to: { zone: 'battlefield', controller: back === 'owner' ? 'owner' : you } } as EffectStep,
  ], [objTarget('t0')]);
  it('"Return that card" and "return it" both name the exiled card', () => {
    accepts(blink('owner'), "Exile target creature. Return that card to the battlefield under its owner's control.");
    accepts(blink('owner'), "Exile target creature, then return it to the battlefield under its owner's control.");
  });
  it('the controller it returns under is kept exact', () => {
    rejects(blink('you'), "Exile target creature. Return that card to the battlefield under its owner's control.");
  });
});

describe('CR 400.7: the card a zone change put into a graveyard is "that card"', () => {
  const dies: EventPattern[] = [{ ev: 'zoneChange', subject: { types: ['Creature'], controller: 'you' }, from: 'battlefield', to: 'graveyard' } as EventPattern];
  it('"return that card to its owner\'s hand" for the creature that died', () => {
    accepts(trig(dies, [{ op: 'move', what: { ref: 'event', role: 'subject' }, to: { zone: 'hand' } } as EffectStep]), "Whenever a creature you control dies, return that card to its owner's hand.");
  });
  it('a creature that entered the battlefield is not "that card"', () => {
    const entered: EventPattern[] = [{ ev: 'zoneChange', subject: { types: ['Creature'], controller: 'you' }, to: 'battlefield' } as EventPattern];
    rejects(trig(entered, [{ op: 'move', what: { ref: 'event', role: 'subject' }, to: { zone: 'hand' } } as EffectStep]), "Whenever a creature you control enters, return that card to its owner's hand.");
  });
});

describe('CR 201.5: while the event leaves ~ where it is, "that creature" is the other creature', () => {
  const blocked: EventPattern[] = [{ ev: 'becomesBlocked', attacker: { self: true }, by: { allTypes: ['Artifact', 'Creature'] } } as EventPattern];
  it('"destroy that creature" is the blocker', () => {
    accepts(trig(blocked, [{ op: 'destroy', what: { ref: 'event', role: 'blocker' } } as EffectStep]), 'Whenever ~ becomes blocked by an artifact creature, destroy that creature.');
  });
  it('~ itself is never written "that creature"', () => {
    rejects(trig(blocked, [{ op: 'destroy', what: self } as EffectStep]), 'Whenever ~ becomes blocked by an artifact creature, destroy that creature.');
  });
});

describe('CR 301.5c: "attach ~ to it" never attaches ~ to itself', () => {
  const token: EffectStep = { op: 'createToken', who: you, count: 1, token: { power: 1, toughness: 1, colors: ['W'], types: ['Creature'], subtypes: ['Soldier'] }, as: 'token' } as EffectStep;
  const ctx = { selfNames: ['Test Blade'], selfTypes: ['Artifact'] };
  it('"create a token, then attach ~ to it": it is the token', () => {
    accepts(trig(enters, [token, { op: 'attach', what: self, to: bound('token') } as EffectStep]), 'When ~ enters, create a 1/1 white Soldier creature token, then attach ~ to it.', ctx);
  });
  it('without the token, "it" has no other antecedent than ~ and is not written', () => {
    rejects(trig(enters, [{ op: 'attach', what: self, to: self } as EffectStep]), 'When ~ enters, attach ~ to it.', ctx);
  });
});

describe('CR 701.21a: "sacrifice it" names a permanent, not the spell or ability that targeted ~', () => {
  const targeted: EventPattern[] = [{ ev: 'becomes', what: 'targeted', object: { self: true } } as EventPattern];
  it('the object itself', () => {
    accepts(trig(targeted, [{ op: 'sacrifice', what: { ref: 'event', role: 'subject' } } as EffectStep]), 'When ~ becomes the target of a spell or ability, sacrifice it.');
  });
  it('"counter it" may name either, so it is not written', () => {
    rejects(trig(targeted, [{ op: 'counter', what: { ref: 'event', role: 'source' } } as EffectStep]), 'When ~ becomes the target of a spell or ability, counter it.');
  });
});

describe('CR 110.4, 202.3: "a Rebel permanent card with mana value 3 or less"', () => {
  const recruit = (types: string[]): AbilityDef => spell([search({ types, subtypes: ['Rebel'], manaValue: { op: '<=', value: 3 } }), { op: 'move', what: bound('found'), to: { zone: 'battlefield', controller: you } } as EffectStep, shuffle]);
  it('the subtype with exactly the six permanent types reads "Rebel permanent card"', () => {
    accepts(recruit(['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker']), 'Search your library for a Rebel permanent card with mana value 3 or less, put it onto the battlefield, then shuffle.');
  });
  it('another set of types is not "permanent card"', () => {
    rejects(recruit(['Creature']), 'Search your library for a Rebel permanent card with mana value 3 or less, put it onto the battlefield, then shuffle.');
  });
});
