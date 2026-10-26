/**
 * Precon lane pc-counters, round pc-counters-4: no new template. The readings of the round, each with its near misses: "<A>. Then <B>." after a "you may" sentence
 * (render/steps.ts, CR 608.2c) and "creature that entered the battlefield under your control this turn" (parser/holes/filter.ts, render/np.ts, CR 400.7, 110.2).
 * CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { card, fullyAutomated } from '../../m5/templates/support';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const parse = (text: string, type = 'Sorcery') => parseCard(card('Example Ooze', type, text, {}), OPTS).faces[0]!;

describe('pc-counters-4: "You may A. Then B." (CR 608.2c, 608.2d)', () => {
  it('B after a may sentence, with "Then", is automated and is a step of its own after the may', () => {
    for (const text of ['You may draw a card. Then discard a card.', 'You may put a +1/+1 counter on a creature you control. Then all creatures get -4/-4 until end of turn.', 'You may gain 3 life. Then target creature gets -1/-1 until end of turn.']) {
      const f = parse(text);
      expect(fullyAutomated(f), `${text}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
      const steps = (f.abilities[0] as { effect: { steps: { op: string }[] } }).effect.steps;
      expect(steps[0]!.op).toBe('may');
      expect(steps.length).toBe(2);
    }
  });
  it('"If you do, B" stays the reflexive form (inside the may), and "Then" before an unknown word is no reading', () => {
    expect(fullyAutomated(parse('You may draw a card. If you do, discard a card.'))).toBe(true);
    expect(fullyAutomated(parse('You may draw a card. Then blorf a card.'))).toBe(false);
  });
});

describe('pc-counters-4: "creature that entered the battlefield under your control this turn" stays manual', () => {
  it('"under your control" at entry is not "you control it now" (CR 400.7, 110.2; Shaile\'s ruling): no reading, so the card is partial rather than wrong', () => {
    expect(fullyAutomated(parse('Put a +1/+1 counter on each creature that entered the battlefield under your control this turn.'))).toBe(false);
    expect(fullyAutomated(parse('Put a +1/+1 counter on each creature you control that entered the battlefield this turn.'))).toBe(true);
  });
});
