/**
 * std-combat-3 (lane std-combat): the parser change of the round, one test (CR 603.10a, 109.4): a player reference inside the description of an object that leaves
 * the battlefield is the event's player. Synthetic wordings (design 6.10). CR cites from memory, unverified.
 */
import { describe, expect, it } from 'vitest';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { bare, card, fullyAutomated } from '../../m5/templates/support';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const lowered = (text: string): unknown => {
  const f = parseCard(card('Example Stalker', 'Creature — Human Warrior', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  return fullyAutomated(f) ? JSON.parse(JSON.stringify(bare(f.abilities)))[0] : null;
};

describe('std-combat-3: lowering, trigger patterns (CR 603.10a, 109.4)', () => {
  it('"that player" in the description of the creature that dies is the player who controlled it (the event\'s player)', () => {
    const a = lowered('Whenever a creature an opponent controls with the greatest toughness among creatures that player controls dies, you gain 1 life.') as { trigger: { on: { subject: unknown }[] } };
    expect(a.trigger.on[0]!.subject).toEqual({ types: ['Creature'], controller: 'opponent', toughness: { op: '>=', value: { q: 'stat', stat: 'toughness', of: { ref: 'each', filter: { types: ['Creature'], controller: { ref: 'event', role: 'player' } } }, agg: 'max' } } });
  });
  it('a player reference in a pattern of an object that does not leave the battlefield is not read this way (it enters: no look-back, the trigger stays unread)', () => {
    expect(lowered('Whenever a creature an opponent controls with the greatest toughness among creatures that player controls enters, you gain 1 life.')).toBeNull();
  });
});
