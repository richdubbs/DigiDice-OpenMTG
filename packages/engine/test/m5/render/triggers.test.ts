/**
 * WP2 review fixes: the flags of triggers, replacements and target specs are words (CR 603.2c "one or more", CR 614.1 / 616.1 "you may ... instead", CR 601.2c
 * every target spec of a spell must be announced). A flag the renderer drops lets the gate pass a JSON that plays differently from its text.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, EffectStep, EventPattern, StaticEffect } from '../../../src/types/ability';
import '../../../src/render/boot';
import { K } from '../../../src/render/kernel';
import { newState } from '../../../src/render/state';
import { accepts, CTX, draw, objTarget, rejects, spell, trig } from './build';

const own = { types: ['Creature'], controller: 'you' } as const satisfies { types: string[]; controller: 'you' };
const drawn = [draw()];

describe('CR 603.2c: "one or more" is said for every event that can batch', () => {
  it('counters', () => {
    const ev: EventPattern = { ev: 'counters', change: 'put', kind: '+1/+1', on: own };
    accepts(trig([ev], drawn, { batch: true }), 'Whenever one or more +1/+1 counters are put on a creature you control, draw a card.');
    rejects(trig([ev], drawn, { batch: true }), 'Whenever a +1/+1 counter is put on a creature you control, draw a card.');
    accepts(trig([ev], drawn), 'Whenever a +1/+1 counter is put on a creature you control, draw a card.');
    rejects(trig([ev], drawn), 'Whenever one or more +1/+1 counters are put on a creature you control, draw a card.');
  });
  it('damage dealt to objects', () => {
    const ev: EventPattern = { ev: 'damage', recipient: { object: own } };
    accepts(trig([ev], drawn, { batch: true }), 'Whenever one or more creatures you control are dealt damage, draw a card.');
    rejects(trig([ev], drawn, { batch: true }), 'Whenever a creature you control is dealt damage, draw a card.');
  });
  it('actions of a player: sacrifice and discard', () => {
    const sac: EventPattern = { ev: 'action', verb: 'sacrifice', actor: 'you', object: { types: ['Creature'] } };
    accepts(trig([sac], drawn, { batch: true }), 'Whenever you sacrifice one or more creatures, draw a card.');
    rejects(trig([sac], drawn, { batch: true }), 'Whenever you sacrifice a creature, draw a card.');
    const discard: EventPattern = { ev: 'action', verb: 'discard', actor: 'you' };
    accepts(trig([discard], drawn, { batch: true }), 'Whenever you discard one or more cards, draw a card.');
    rejects(trig([discard], drawn, { batch: true }), 'Whenever you discard a card, draw a card.');
  });
  it('creating tokens', () => {
    const ev: EventPattern = { ev: 'createToken', player: 'you' };
    accepts(trig([ev], drawn, { batch: true }), 'Whenever you create one or more tokens, draw a card.');
    rejects(trig([ev], drawn, { batch: true }), 'Whenever you create a token, draw a card.');
  });
  it('rolling dice (p2-c-dieroll-1, CR 603.2c): "one or more dice"', () => {
    const ev: EventPattern = { ev: 'dieRoll', player: 'you' };
    accepts(trig([ev], drawn, { batch: true }), 'Whenever you roll one or more dice, draw a card.');
    rejects(trig([ev], drawn, { batch: true }), 'Whenever you roll a die, draw a card.');
  });
  it('an event with no "one or more" wording refuses the flag instead of dropping it', () => {
    const events: EventPattern[] = [
      { ev: 'cast', player: 'you' }, { ev: 'activate', player: 'you' }, { ev: 'life', player: 'you', change: 'gain' }, { ev: 'draw', player: 'you' },
      { ev: 'step', step: 'upkeep', whose: 'you' },
    ];
    for (const ev of events) {
      const def = trig([ev], drawn, { batch: true });
      expect(() => K.ability(def, newState(CTX)), ev.ev).toThrow();
    }
  });
});

describe('CR 614.1 and 616.1: an optional replacement says "you may"', () => {
  const dies: EventPattern = { ev: 'zoneChange', subject: own, from: 'battlefield', to: 'graveyard' };
  const exile: EffectStep = { op: 'move', what: { ref: 'event', role: 'subject' }, to: { zone: 'exile' } } as EffectStep;
  const replace = (optional?: boolean): AbilityDef => ({ kind: 'static', text: '', effects: [{ s: 'replace', replaces: dies, body: { b: 'instead', do: [exile] }, ...(optional === undefined ? {} : { optional }) } as StaticEffect] });
  it('optional:true prints "you may" and rejects the mandatory wording', () => {
    accepts(replace(true), 'If a creature you control would die, you may exile it instead.');
    rejects(replace(true), 'If a creature you control would die, exile it instead.');
  });
  it('optional:false and absent print the mandatory wording and reject "you may"', () => {
    for (const o of [false, undefined]) {
      accepts(replace(o), 'If a creature you control would die, exile it instead.');
      rejects(replace(o), 'If a creature you control would die, you may exile it instead.');
    }
  });
  it('a modifying replacement is optional in the same way', () => {
    const def: AbilityDef = { kind: 'static', text: '', effects: [{ s: 'replace', replaces: dies, body: { b: 'modify', destination: { zone: 'exile' } }, optional: true }] };
    rejects(def, 'If a creature you control would die, exile it instead.');
  });
});

describe('CR 601.2c: a target spec that no step uses is refused', () => {
  it('a spec beside a program that never names it', () => {
    const unused = spell([draw(2)], [objTarget('a')]);
    rejects(unused, 'Draw two cards.');
  });
  it('the same spec, used, is accepted', () => {
    const used = spell([{ op: 'destroy', what: { ref: 'target', id: 'a' } } as EffectStep], [objTarget('a')]);
    accepts(used, 'Destroy target creature.');
  });
  it('one used and one unused spec is refused', () => {
    const half = spell([{ op: 'destroy', what: { ref: 'target', id: 'a' } } as EffectStep], [objTarget('a'), objTarget('b')]);
    rejects(half, 'Destroy target creature.');
  });
  it('a spec used inside a mode, and a spec used only as a count, are used', () => {
    const modal: AbilityDef = { kind: 'spell', text: '', effect: { targets: [], modes: { min: 1, max: 1, options: [
      { text: '', program: { targets: [objTarget('m')], steps: [{ op: 'destroy', what: { ref: 'target', id: 'm' } } as EffectStep] } },
      { text: '', program: { targets: [], steps: [draw()] } },
    ] }, steps: [] } };
    accepts(modal, 'Choose one -- • Destroy target creature. • Draw a card.');
  });
  it('a target in a reflexive trigger is used by its steps', () => {
    const def = spell([{ op: 'may', who: { ref: 'you' }, do: [draw()], as: 'm' } as EffectStep, { op: 'reflexive', when: { did: 'm' }, targets: [objTarget('r')], do: [{ op: 'destroy', what: { ref: 'target', id: 'r' } } as EffectStep] } as EffectStep]);
    accepts(def, 'You may draw a card. When you do, destroy target creature.');
  });
});
