/**
 * std-rx17 (wave 2, Commander precon lane rx17): the round's parser, renderer, model and keyword-data changes. The round adds no template file: its readings
 * are an event-hole reading (parser/holes/event.ts: "<creature> exploits a [nontoken] creature"), a renderer form for it (render/evt.ts#exploitParts), the
 * exploiting creature's zone (parser/lower/trigger-zone.ts), keyword data (dash, graft, exploit), the capability of every fixed +X/+Y counter
 * (model/cap-walk.ts#counterForms) and of rad counters (core/rad.ts). Wordings are synthetic (design 6.10); the behavior is in std-rx17-scenarios.test.ts. CR cites
 * from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { counterForms } from '../../../src/model/cap-walk';
import { keywordRegistry } from '../../../src/keywords/registry';
import { RAD_COUNTER_KINDS, radAbility } from '../../../src/core/rad';

const compile = (text: string, type = 'Creature — Zombie') =>
  compileCard({ name: 'Example Relic', layout: 'normal', mana_cost: '{3}', type_line: type, oracle_text: text, colors: [], power: '2', toughness: '2' } as OracleCard);
const abilitiesOf = (text: string, type?: string) => compile(text, type).faces[0]!.abilities;
const level = (text: string, type?: string): string => compile(text, type).automation.level;

describe('CR 702.110b: the event hole reads "<creature> exploits a [nontoken] creature" (parser/holes/event.ts)', () => {
  it('"When this creature exploits a creature" is the exploit action of ~, with no filter on the creature sacrificed', () => {
    const a = abilitiesOf('Exploit\nWhen this creature exploits a creature, draw a card.')[1]!;
    expect(a.kind).toBe('triggered');
    expect(a.kind === 'triggered' && a.trigger.on).toEqual([{ ev: 'action', verb: 'exploit', object: { self: true } }]);
    expect(a.kind === 'triggered' && a.zone).toBeFalsy(); // the exploiting creature is on the battlefield (lower/trigger-zone.ts)
  });
  it('"Whenever a creature you control exploits a nontoken creature" filters both creatures', () => {
    const a = abilitiesOf('Whenever a creature you control exploits a nontoken creature, you gain 2 life.', 'Enchantment')[0]!;
    expect(a.kind === 'triggered' && a.trigger.on).toEqual([{ ev: 'action', verb: 'exploit', object: { types: ['Creature'], controller: 'you' }, exploited: { types: ['Creature'], token: false } }]);
  });
  it('the render gate reads both forms back (render/evt.ts#exploitParts): the cards are full', () => {
    expect(level('Exploit\nWhen this creature exploits a creature, you gain 2 life.')).toBe('full');
    expect(level('Whenever a creature you control exploits a nontoken creature, draw a card.', 'Enchantment')).toBe('full');
  });
  it('CR 702.110b, 201.5: in "When ~ exploits a creature", a pronoun after a target is the target, as in the object\'s own enters trigger (parser/lower/scope.ts, render/refs.ts)', () => {
    const text = "Exploit\nWhen this creature exploits a creature, target creature's owner shuffles it into their library.";
    const a = abilitiesOf(text)[1]!;
    expect(JSON.stringify(a)).not.toContain('"ref":"self"');
    expect(level("Exploit\nWhen this creature exploits a creature, return target creature to its owner's hand. It can't block this turn.")).not.toBe('manual');
    // the rule is the exploiting creature's own trigger only: "whenever ~ attacks" keeps both candidates (design 6.4)
    expect(level("Whenever this creature attacks, target creature's owner puts it on their choice of the top or bottom of their library.")).not.toBe('full');
  });
  it('near misses stay manual: another object sacrificed ("exploits an artifact"), a player exploiting', () => {
    expect(level('When this creature exploits an artifact, draw a card.')).not.toBe('full');
    expect(level('Whenever you exploit a creature, draw a card.', 'Enchantment')).not.toBe('full');
  });
});

describe('keyword data (CR 702.109a dash, 702.58a graft, 702.110a exploit)', () => {
  it('the three keywords are implemented through their data', () => {
    for (const k of ['dash', 'graft', 'exploit']) expect(keywordRegistry.get(k)?.status, k).toBe('implemented');
  });
  it('a keyword line alone is full', () => {
    expect(level('Dash {2}{R}')).toBe('full');
    expect(level('Graft 2')).toBe('full');
    expect(level('Exploit')).toBe('full');
  });
  it('the exploit sacrifice is marked as an exploit, and its capability is registered', () => {
    expect(ENGINE_CAPABILITIES.has('op:sacrificeChoice.exploit')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:ev.action.exploit')).toBe(true);
  });
});

describe('CR 122.1a: a +X/+Y counter with fixed numbers needs no capability of its own (model/cap-walk.ts#counterForms)', () => {
  it('fixed numbers are applied by the core; a counter named with X still asks for its own capability (fail closed)', () => {
    for (const k of ['+1/+0', '-0/-1', '+0/-1', '+2/+2', '-2/-1']) expect(counterForms(k), k).toEqual([]);
    expect(counterForms('+x/+0')).toEqual(['counter:+x/+0']);
  });
  it('a card that puts a -0/-1 counter as a cost is full', () => {
    expect(level('Defender\nPut a -0/-1 counter on this creature: Add {G}. Activate only once each turn.', 'Creature — Plant Wall')).toBe('full');
  });
});

describe('CR 122.1i, 728.1: rad counters (core/rad.ts)', () => {
  it('counter:rad is registered', () => {
    expect(RAD_COUNTER_KINDS).toEqual(['rad']);
    expect(ENGINE_CAPABILITIES.has('counter:rad')).toBe(true);
  });
  it('the inherent ability mills that many, then reads only the nonland cards milled for the life and the counters', () => {
    const a = radAbility('p1');
    expect(a.kind === 'triggered' && a.effect.steps.map((s) => s.op)).toEqual(['mill', 'loseLife', 'removeCounters']);
    expect(JSON.stringify(a)).toContain('"notTypes":["Land"]');
  });
  it('a card that gives rad counters is full', () => {
    expect(level('Each player gets two rad counters.', 'Sorcery')).toBe('full');
  });
});
