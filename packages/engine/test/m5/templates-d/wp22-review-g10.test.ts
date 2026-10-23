/**
 * WP22 review, finding 2: guard G10 (design 6.8, 10.3) on abilities that are not fully automated. Adding a template may change only formerly-manual units:
 * when a WP22 template matches a sentence the renderer cannot read back (the exact gate G6 refuses it), the WHOLE ability used to become manual, so an
 * ability whose cost, trigger or targets were automated (with one manual step) lost them. Since the fix parseCard lowers a refused ability again without
 * the template the gate refused (parser/parse.ts), so the sentence is a manual step again, as it was before the template existed. Synthetic wordings
 * (design 6.10) of the shapes the review found.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../../../src/types/ability';
import { BOOTSTRAP_TEMPLATES } from '../../../src/parser/parse';
import { card, face, options } from './support';

const all = options();
const boot = options([], { templates: [...BOOTSTRAP_TEMPLATES] });
const parse = (text: string, o = all): AbilityDef[] => face(card('Test Review Ogre', 'Creature — Ogre', text, { mana_cost: '{X}{2}' }), o).abilities;

describe('design 6.8 G10: a template the render gate refuses never makes a formerly partial ability manual', () => {
  it.each([
    ['{3}: All creatures get -2/-0 until end of turn.'], // a "-0" side the renderer prints "+0"
    ['When ~ enters, creatures your opponents control get -2/-0 until end of turn.'],
    ['When ~ enters, other Golem creatures get +1/+1 until end of turn.'], // "other X creatures", rendered "each other X creature"
    ['{2}{R}: Your opponents can\'t gain life this turn.'], // "your opponents ... this turn", rendered "each opponent ... until end of turn"
    ['When ~ enters, target artifact you control gains "{T}: Draw a card" until end of turn.'], // a quoted ability printed without its period
    ['{X}{1}, {T}: Target creature gets +X/+0 and gains haste until end of turn.'], // "+X/+0", rendered with "where X is X"
  ])('CR 602.1, 603.1: "%s" keeps its automated parts (not a ManualAbilityDef), as with the bootstrap templates alone', (text) => {
    const before = parse(text, boot);
    expect(before.map((a) => a.kind)).not.toContain('manual'); // the premise: partial (a manual step) before WP22
    const after = parse(text);
    expect(after.map((a) => a.kind), JSON.stringify(after)).not.toContain('manual');
  });
});
