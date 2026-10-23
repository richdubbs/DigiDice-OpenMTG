/**
 * p2-c-dieroll-2 (Phase 2 lane p2-c-dieroll, second round): no template of its own; the parser and renderer support that round 1's die-roll templates needed
 * (CR 706; cites written from memory, unverified: rules/cr/ is not in cloud checkouts), and the promotion of eff.p2cdr1.rollDie.sixSided (its evidence is in
 * p2-c-dieroll-1-review.json, the template's own round, and pinned by p2-c-dieroll-1-templates.test.ts). The behavior is in p2-c-dieroll-2-scenarios.test.ts.
 *
 *   lower/quantities.ts#unitSources            the result of ONE die rolled by you is a number of its own: "If the result is 3 or less, you lose that much life."
 *   render/qty.ts, render/steps-util.ts        "that much" / "that many" for that result (family die-result-that-much)
 *   lower/choose.ts#thenRoll                   "choose target creature an opponent controls, then roll a d20." over result rows that name the target
 *   render/program.ts#chosenFirst              ", then roll" after the announcement (family choose-then-roll, ALT_SITES program.ts +1)
 */
import { describe, expect, it } from 'vitest';
import { compileCard } from '../../../src/index';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import review from '../../m5/golden/cards/p2-c-dieroll-2-review.json';
import { card, fullyAutomated } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const face = (type: string, text: string) => parseCard(card('Example Brute', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
const json = (type: string, text: string): string => JSON.stringify(face(type, text).abilities);

describe('p2-c-dieroll-2: "that much" is the result of the roll before it (CR 706.2, 608.2h)', () => {
  it('after one die rolled by you, "that much" in a later sentence is q:dieResult; the render gate passes', () => {
    const f = face('Creature — Clown', 'When ~ enters, roll a d20. If the result is 5 or less, you lose that much life.');
    expect(fullyAutomated(f)).toBe(true);
    expect(f.gate.every((g) => g.ok)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"then":[{"op":"loseLife","who":{"ref":"you"},"amount":{"q":"dieResult"}}]');
    expect(json('Creature — Clown', 'When ~ dies, roll a d20. If the result is 5 or less, ~ deals that much damage to you.')).toContain('"amount":{"q":"dieResult"}');
  });
  it('design 6.4, fail closed: two rolls make "that much" ambiguous; a roll with a table is no number of its own', () => {
    expect(fullyAutomated(face('Creature — Clown', 'When ~ enters, roll a d20. Roll a d4. You lose that much life.'))).toBe(false);
    expect(fullyAutomated(face('Creature — Clown', 'When ~ enters, roll a d20. Draw a card. You lose that much life.'))).toBe(false);
  });
  it('a roll is still not "that many" of a counted instruction after it ("Roll a d20. Draw two cards. You gain that much life." reads two candidates)', () => {
    expect(fullyAutomated(face('Creature — Clown', 'When ~ enters, roll a d20. Draw two cards. You gain that much life.'))).toBe(false);
  });
});

describe('p2-c-dieroll-2: "choose target ..., then roll a d20." over result rows (CR 115.1, 601.2c, 706.3a)', () => {
  const TEXT = 'When ~ enters, choose target creature an opponent controls, then roll a d20.\n1—12 | Tap that creature.\n13—20 | Destroy that creature.';
  it('announces the target and keeps the roll; the rows name the target; full and gated', () => {
    const f = face('Creature — Elf', TEXT);
    expect(fullyAutomated(f)).toBe(true);
    expect(f.gate.every((g) => g.ok)).toBe(true);
    const j = JSON.stringify(f.abilities);
    expect(j).toContain('"targets":[{"id":"t0","kind":"object","min":1,"max":1,"text":"target creature an opponent controls"');
    expect(j).toContain('"steps":[{"op":"rollDie","who":{"ref":"you"},"sides":20,"table":[{"min":1,"max":12,"do":[{"op":"tap","what":{"ref":"target","id":"t0"}}]},{"min":13,"max":20,"do":[{"op":"destroy","what":{"ref":"target","id":"t0"}}]}]}]');
    expect(compileCard(card('Example Brute', 'Creature — Elf', TEXT, { power: '2', toughness: '2' })).automation.level).toBe('full');
  });
  it('fail closed: "choose ..., then" another instruction, or a roll whose rows never name the target, is not read so', () => {
    expect(fullyAutomated(face('Creature — Elf', 'When ~ enters, choose target creature an opponent controls, then draw a card.'))).toBe(false);
    expect(fullyAutomated(face('Creature — Elf', 'When ~ enters, choose target creature an opponent controls, then roll a d20.\n1—12 | Draw a card.\n13—20 | Draw two cards.'))).toBe(false);
  });
});

describe('p2-c-dieroll-2 golden review', () => {
  it('every card of the review is pinned full', () => {
    for (const g of review as { card: string; expect?: string }[]) expect(g.expect, g.card).toBe('full');
    expect((review as { card: string }[]).map((g) => g.card)).toEqual(['Scion of Stygia', 'Aberrant Mind Sorcerer']);
  });
});

const index = localIndex();

describe.skipIf(index === null)('p2-c-dieroll-2 (local index): the real cards', () => {
  for (const name of ['Scion of Stygia', 'Aberrant Mind Sorcerer', 'Dissatisfied Customer', 'Non-Human Cannonball']) {
    it(`${name} is fully automated and passes the render gate`, () => {
      const c = (index ?? []).find((x) => x.name === name);
      expect(c, name).toBeDefined();
      for (const f of parseCard(c!, OPTS).faces) {
        expect(fullyAutomated(f), `${name}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), name).toBe(true);
      }
    }, 60_000);
  }
});
