/**
 * WP2 review fixes: anaphora follows the unique-candidate rule (design D12, 6.4; CR 608.2b-c). "Destroy that creature" is a valid way to write a
 * reference only when exactly one creature has been named; with two, the sentence cannot be written, and the ability stays manual. A swapped referent
 * (the blocker for the attacker) must therefore never pass the gate on the strength of a shared noun.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, EffectStep, EventPattern } from '../../../src/types/ability';
import { accepts, objTarget, rejects, spell, t, trig } from './build';

const event = (role: string) => ({ ref: 'event', role }) as never;
const destroy = (what: unknown): EffectStep => ({ op: 'destroy', what } as EffectStep);

describe('CR 608.2c and design D12 / 6.4: two creatures named by the trigger make "that creature" ambiguous', () => {
  const blocks: EventPattern = { ev: 'blocks', blocker: { types: ['Creature'], controller: 'you' }, attacker: { types: ['Creature'] } };
  const text = 'Whenever a creature you control blocks a creature, destroy that creature.';
  it('refuses to write either role as "that creature" (the blocker or the attacker)', () => {
    rejects(trig([blocks], [destroy(event('attacker'))]), text);
    rejects(trig([blocks], [destroy(event('blocker'))]), text);
    rejects(trig([blocks], [destroy(event('attacker'))]), 'Whenever a creature you control blocks a creature, destroy it.');
  });
  it('a damage event with a creature source and a creature recipient is ambiguous too', () => {
    const damage: EventPattern = { ev: 'damage', source: { types: ['Creature'] }, recipient: { object: { types: ['Creature'] } } };
    for (const role of ['object', 'source', 'subject']) rejects(trig([damage], [destroy(event(role))]), 'Whenever a creature deals damage to a creature, destroy that creature.');
  });
  it('different nouns make the noun a unique name (but a bare "it" stays ambiguous)', () => {
    const damage: EventPattern = { ev: 'damage', source: { types: ['Creature'] }, recipient: { object: { types: ['Land'] } } };
    accepts(trig([damage], [destroy(event('object'))]), 'Whenever a creature deals damage to a land, destroy that land.');
    accepts(trig([damage], [destroy(event('source'))]), 'Whenever a creature deals damage to a land, destroy that creature.');
    rejects(trig([damage], [destroy(event('object'))]), 'Whenever a creature deals damage to a land, destroy it.');
  });
  it('one event object is "it" or "that creature"', () => {
    const dies: EventPattern = { ev: 'zoneChange', subject: { types: ['Creature'] }, from: 'battlefield', to: 'graveyard' };
    const exile: EffectStep = { op: 'move', what: event('subject'), to: { zone: 'exile' } } as EffectStep;
    accepts(trig([dies], [exile]), 'Whenever a creature dies, exile it.');
    accepts(trig([dies], [exile]), 'Whenever a creature dies, exile that creature.');
  });
});

describe('CR 608.2c and design D12 / 6.4: two targets of one noun', () => {
  const pump = (id: string, n: number): EffectStep => ({ op: 'effect', effects: [{ s: 'continuous', affects: t(id), mods: [{ layer: '7c', power: n, toughness: n }] }], duration: { d: 'endOfTurn' } } as EffectStep);
  const two = (which: string): AbilityDef => spell([pump('a', 1), pump('b', -1), destroy(t(which))], [objTarget('a'), objTarget('b')]);
  it('"Destroy that creature" after two creature targets is refused for either', () => {
    for (const which of ['a', 'b']) rejects(two(which), 'Target creature gets +1/+1 until end of turn. Target creature gets -1/-1 until end of turn. Destroy that creature.');
  });
  it('with one creature target it is accepted', () => {
    const one = spell([pump('a', 1), destroy(t('a'))], [objTarget('a')]);
    accepts(one, 'Target creature gets +1/+1 until end of turn. Destroy that creature.');
    accepts(one, 'Target creature gets +1/+1 until end of turn. Destroy it.');
  });
  it('two players named, then "that player" is ambiguous', () => {
    const players = [{ id: 'p', kind: 'player', min: 1, max: 1, text: '' }, { id: 'q', kind: 'player', min: 1, max: 1, text: '' }] as never;
    const def = spell([{ op: 'loseLife', who: t('p'), amount: 1 } as EffectStep, { op: 'loseLife', who: t('q'), amount: 1 } as EffectStep, { op: 'draw', who: t('p'), count: 1 } as EffectStep], players);
    rejects(def, 'Target player loses 1 life. Target player loses 1 life. That player draws a card.');
  });
});

describe('CR 603.2, 607 and design 3.5: an event role the trigger does not expose is an error of the JSON', () => {
  const dies: EventPattern = { ev: 'zoneChange', subject: { types: ['Creature'] }, from: 'battlefield', to: 'graveyard' };
  it('event.blocker under a zone-change trigger is refused, not printed as some object', () => {
    rejects(trig([dies], [destroy(event('blocker'))]), 'Whenever a creature dies, destroy that creature.');
    rejects(trig([dies], [destroy(event('blocker'))]), 'Whenever a creature dies, destroy it.');
  });
  it('a role the design lists for the event is accepted (zoneChange.player is the controller)', () => {
    const gain = trig([{ ev: 'zoneChange', subject: { types: ['Creature'], controller: 'opponent' }, from: 'battlefield', to: 'graveyard' }], [{ op: 'loseLife', who: event('player'), amount: 1 } as EffectStep]);
    accepts(gain, 'Whenever a creature an opponent controls dies, that player loses 1 life.');
  });
  it('replacement bodies read the roles of the replaced event', () => {
    const def: AbilityDef = { kind: 'static', text: '', effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { types: ['Creature'], controller: 'you' }, from: 'battlefield', to: 'graveyard' }, body: { b: 'instead', do: [{ op: 'move', what: event('subject'), to: { zone: 'exile' } } as EffectStep] } }] };
    accepts(def, 'If a creature you control would die, exile it instead.');
    const bad: AbilityDef = { kind: 'static', text: '', effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { types: ['Creature'], controller: 'you' }, from: 'battlefield', to: 'graveyard' }, body: { b: 'instead', do: [{ op: 'move', what: event('blocker'), to: { zone: 'exile' } } as EffectStep] } }] };
    expect(() => accepts(bad, 'If a creature you control would die, exile it instead.')).toThrow();
  });
});
