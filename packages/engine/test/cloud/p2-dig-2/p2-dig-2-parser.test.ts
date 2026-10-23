/**
 * Lane p2-dig, round p2-dig-2: the Cond "a <card> is revealed this way" after a reveal of one card (parser/holes/cond.ts#revealedThisWayCond), the antecedent of
 * its branch's "it" (parser/lower/anaphora.ts#revealedCondMention) and its render (render/cond.ts, family revealed-this-way-cond in render/equivalence.ts). The
 * behavior is in p2-dig-2-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { card, fullyAutomated } from '../../m5/templates/support';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const face = (text: string) => parseCard(card('Example Seer', 'Sorcery', text), OPTS).faces[0]!;
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');
const steps = (f: ReturnType<typeof face>): string => JSON.stringify(f.abilities);
const REVEAL = 'You may reveal the top card of your library. ';

describe('p2-dig-2 Cond (CR 701.20a, 608.2c): "If a <card> is revealed this way" tests the one card the reveal revealed', () => {
  it('after a reveal of the top card: full, a `matches` of the revealed card', () => {
    const f = face(`${REVEAL}If a creature card is revealed this way, draw a card.`);
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(steps(f)).toContain('"cond":{"cond":"matches","object":{"ref":"bound","name":"them"},"filter":{"types":["Creature"],"isCard":true}}');
  });
  it('the branch\'s "it" is the revealed card (its one compatible antecedent)', () => {
    const f = face(`${REVEAL}If a land card is revealed this way, put it onto the battlefield.`);
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(steps(f)).toContain('"op":"move","what":{"ref":"bound","name":"them"}');
  });
  it('fails closed: a reveal of several cards, and the past tense the render does not say', () => {
    expect(fullFace(face('Reveal the top two cards of your library. If a creature card is revealed this way, draw a card.'))).toBe(false);
    expect(fullFace(face(`${REVEAL}If a creature card was revealed this way, draw a card.`))).toBe(false);
  });
});
