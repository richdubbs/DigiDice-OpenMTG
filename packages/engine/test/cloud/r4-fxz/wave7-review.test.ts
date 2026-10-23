/**
 * Wave 7 merge line r4-fxz: review fixes of the merge with waves 5-6 (r3-dig's one-sentence dig, r3-trig's cast trigger of the spell itself).
 */
import { describe, expect, it } from 'vitest';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { automated, card, fullyAutomated } from '../../m5/templates/support';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const parse = (typeLine: string, text: string, extra = {}) => parseCard(card('Example Card', typeLine, text, extra), OPTS).faces[0]!;

describe('CR 701.20e, 608.2c, 701.24a: the look, the choice of any number of cards among them and the shuffle, said in one sentence or in three', () => {
  it('one sentence keeps r3-dig\'s reading (eff.r3dig.look.putAny.battlefieldTapped.shuffle, priority over r4-fxz\'s clause) and passes the render gate', () => {
    const f = parse('Sorcery', 'Look at the top twenty cards of your library, put any number of land cards from among them onto the battlefield tapped, then shuffle. You gain 8 life.');
    expect(fullyAutomated(f)).toBe(true);
    expect(f.templatesUsed).toContain('eff.r3dig.look.putAny.battlefieldTapped.shuffle');
  });
  it('three sentences read with r4-fxz\'s clause and pass the render gate (r3-dig\'s one-sentence fold no longer takes them)', () => {
    const f = parse('Sorcery', 'Look at the top six cards of your library. Put any number of land cards from among them onto the battlefield tapped. Then shuffle.');
    expect(fullyAutomated(f)).toBe(true);
    expect(f.templatesUsed).toContain('eff.fxz.dig.anyNumber.bf.tapped');
  });
});

describe('CR 113.6k, 603.4, 601.2i: "When you cast this spell, if you\'ve cast another spell this turn" functions on the stack, where the spell is its source', () => {
  it('a creature spell\'s own cast trigger is not refused by r4-fxz\'s "another spell" lint (Sage of the Skies)', () => {
    const f = parse('Creature — Human Monk', "When you cast this spell, if you've cast another spell this turn, copy this spell.\nFlying, lifelink", { power: '2', toughness: '3', mana_cost: '{2}{W}' });
    expect(automated(f.abilities)).toBe(true);
  });
  it('a permanent\'s ability that reads "another spell" from the battlefield is still refused (its own spell is a different object, CR 400.7)', () => {
    const f = parse('Creature — Human Wizard', "{T}: If you've cast another spell this turn, draw a card.", { power: '1', toughness: '1' });
    expect(automated(f.abilities)).toBe(false);
  });
});
