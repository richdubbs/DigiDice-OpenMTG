/**
 * Standard round B (std-rB, second part): the parser and engine support of the Cond reading "[red] sources you controlled dealt N or more [noncombat] damage
 * this turn" (parser/holes/cond.ts#sourcesDealtDamage, `happenedCount` with `sum` and no `per`, read at announcement by an activation restriction) and of a
 * lasting replacement's "if you do" (parser/lower/conditions.ts#absorbIntoReplacement, `modify.then`). Synthetic wordings (design 6.10); CR cites from memory,
 * unverified. The round's templates are tested in std-rb-templates.test.ts, the behavior in std-rb-damage-plot-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { announceReadable } from '../../../src/actions/announce-cond';
import type { Condition } from '../../../src/types/ability';
import { card, fullyAutomated } from '../../m5/templates/support';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
const creature = (text: string) => parseCard(card('Example Brute', 'Creature — Giant Warrior', text, { power: '3', toughness: '3' }), OPTS).faces[0]!;
const land = (text: string) => parseCard(card('Example Shrine', 'Land', text), OPTS).faces[0]!;

describe('std-rb parser and engine support: this turn\'s damage added up, a lasting replacement\'s "if you do"', () => {
  it('CR 602.5b, 120.1: "Activate only if red sources you controlled dealt 4 or more noncombat damage this turn" is read as the ability is activated', () => {
    const f = land('{T}: Draw a card. Activate only if red sources you controlled dealt 4 or more noncombat damage this turn.');
    expect(fullyAutomated(f)).toBe(true);
    const onlyIf = (f.abilities[0] as { onlyIf?: Condition }).onlyIf!;
    expect(onlyIf).toEqual({ cond: 'compare', left: { q: 'happenedCount', event: { ev: 'damage', source: { colors: ['R'], controller: 'you' }, combat: false }, scope: 'turn', sum: 'amount' }, op: '>=', right: 4 });
    expect(announceReadable(onlyIf, 'activate')).toBe(true);
    // a target's condition (another position) does not read this turn's history: that form is not readable there
    expect(announceReadable(onlyIf, 'spec')).toBe(false);
  });
  it('CR 120.1: the same reading with no color, with "combat damage" and with plain "damage"; "fewer than" has no reading', () => {
    const left = (text: string) => JSON.stringify((land(`{T}: Draw a card. Activate only if ${text}.`).abilities[0] as { onlyIf?: Condition }).onlyIf ?? null);
    expect(left('sources you controlled dealt 3 or more damage this turn')).toContain('"event":{"ev":"damage","source":{"controller":"you"}},"scope":"turn","sum":"amount"');
    expect(left('green sources you controlled dealt 5 or more combat damage this turn')).toContain('"source":{"colors":["G"],"controller":"you"},"combat":true');
    expect(left('red sources you controlled dealt 3 or fewer noncombat damage this turn')).not.toContain('happenedCount');
  });
  it('CR 614.1a, 608.2c: "if you do" after a lasting replacement of a move is that move carried out (`modify.then`); "if you don\'t" is not folded', () => {
    const lilah = 'Whenever you cast an instant spell from your hand, exile that spell instead of putting it into your graveyard as it resolves.';
    const f = creature(`${lilah} If you do, it becomes plotted.`);
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"then":{"as":"moved","do":[{"op":"designateObject","what":{"ref":"bound","name":"moved"},"designation":"plotted"}]}');
    expect(JSON.stringify(creature(`${lilah} If you don't, it becomes plotted.`).abilities)).not.toContain('"then":{"as"');
  });
});
