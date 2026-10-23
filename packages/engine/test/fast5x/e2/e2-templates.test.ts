/**
 * FAST5X E2: the template data of parser/templates/zz-fast5x/e2.json and the parser and renderer readings warp and void needed (design 6.8 G6):
 *  - the condition "a spell was warped this turn" (parser/holes/cond.ts#warped: a spell cast for its warp cost this turn, CR 702.185c), which with "a nonland
 *    permanent left the battlefield this turn" and the "or" chain is the void ability word's condition (CR 207.2c, 603.4);
 *  - the self-replacement with the condition after "instead" (CR 614.15): "That creature gets -5/-5 until end of turn instead if C", "~ deals 3 damage
 *    instead if C" (render/steps-flow.ts);
 *  - "draw another card" after a draw by the same player (render/steps-cards.ts);
 *  - "sacrifice ~ unless C" for a history condition of this turn (render/steps-flow.ts#turnHistory, template eff.m6.sacrifice.unless).
 * Guard G9 (design 6.8): every example lowers with its template, is fully automated (experimental templates cap the card, not the ability) and passes the exact
 * render gate; every counter-example does not parse or parses to different JSON. Examples are synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import e2 from '../../../src/parser/templates/zz-fast5x/e2.json';
import { automated, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { getCard } from '../../fixtures';
import review from '../../m5/golden/cards/fast5x-e2-review.json';

const E2 = e2 as Template[];
const OPTS = defaultParseOptions();

function exampleCard(text: string, type?: string): OracleCard {
  const permanent = /^(When|Whenever|At)\b/.test(text) || /^[^"]*:/.test(text);
  const typeLine = type ?? (permanent ? 'Creature — Human' : 'Sorcery');
  return {
    name: 'Example Subject', layout: 'normal', type_line: typeLine, oracle_text: text.replace(/~/g, 'Example Subject'), mana_cost: '{1}',
    colors: [], keywords: [], ...(/Creature/.test(typeLine) ? { power: '2', toughness: '2' } : {}),
  } as OracleCard;
}
const parsed = (text: string, type?: string) => parseCard(exampleCard(text, type), OPTS).faces[0]!;
const steps = (text: string, type?: string): unknown => {
  const a = parsed(text, type).abilities.find((x) => x.kind !== 'keyword') as unknown as { effect?: { steps: unknown[] } };
  return a.effect?.steps;
};

const VOID = {
  cond: 'any',
  of: [
    { cond: 'happened', event: { ev: 'zoneChange', subject: { notTypes: ['Land'] }, from: 'battlefield' }, scope: 'turn' },
    { cond: 'happened', event: { ev: 'cast', via: 'warp' }, scope: 'turn' },
  ],
};
const VOID_TEXT = 'a nonland permanent left the battlefield this turn or a spell was warped this turn';

describe('E2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5x/e2.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5x/e2.json');
    expect([...files].sort()).toEqual(files);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5X)', () => {
    for (const t of E2) {
      expect(t.id, t.id).toMatch(/^(eff|rid|sta)\.e2\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable E2 template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string }[];
    // Hymn of the Faller is the only card of the local index that prints "draw another card", Timeline Culler the only one with "using its warp ability"
    const WHOLE_CORPUS: Record<string, string[]> = { 'eff.e2.draw.another': ['Hymn of the Faller'], 'sta.e2.castWith.graveyard.warp': ['Timeline Culler'] };
    for (const t of E2.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of E2) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('E2 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of E2) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsed(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsed(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parsed(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

describe('E2 lowering: what the shapes mean', () => {
  const t0 = { ref: 'target', id: 't0' };
  it('CR 207.2c, 702.185c: the void condition is "a nonland permanent left the battlefield this turn" or "a spell was cast for its warp cost this turn"', () => {
    expect((parsed(`At the beginning of your end step, if ${VOID_TEXT}, put a +1/+1 counter on ~.`).abilities[0] as unknown as { interveningIf: unknown }).interveningIf).toEqual(VOID);
    // a spell cast normally is not "warped"; nothing else reads as warped
    expect(fullyAutomated(parsed('At the beginning of your end step, if a spell was kicked this turn, draw a card.'))).toBe(false);
  });
  it('CR 614.15: "That creature gets -5/-5 until end of turn instead if C" replaces the first instruction as a whole', () => {
    const pump = (n: number) => ({ op: 'effect', effects: [{ s: 'continuous', affects: t0, mods: [{ layer: '7c', power: n, toughness: n }] }], duration: { d: 'endOfTurn' } });
    expect(steps(`Target creature gets -2/-2 until end of turn. That creature gets -10/-10 until end of turn instead if ${VOID_TEXT}.`)).toEqual([
      { op: 'if', cond: VOID, then: [pump(-10)], else: [pump(-2)] },
    ]);
  });
  it('CR 614.15: "~ deals 3 damage instead if C" is the same damage with another amount', () => {
    const dmg = (n: number) => ({ op: 'damage', source: { ref: 'self' }, to: t0, amount: n });
    expect(steps(`~ deals 2 damage to any target. ~ deals 3 damage instead if ${VOID_TEXT}.`)).toEqual([{ op: 'if', cond: VOID, then: [dmg(3)], else: [dmg(2)] }]);
  });
  it('CR 121.2: "draw another card" is one more card for the player who drew', () => {
    expect(steps(`Surveil 1, then you draw a card and lose 1 life. If ${VOID_TEXT}, draw another card.`)).toEqual([
      { op: 'surveil', who: { ref: 'you' }, count: 1 }, { op: 'draw', who: { ref: 'you' }, count: 1 }, { op: 'loseLife', who: { ref: 'you' }, amount: 1 },
      { op: 'if', cond: VOID, then: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] },
    ]);
  });
  it('CR 406.1, 115.1: "target exiled card with warp" is a target card in exile with the keyword', () => {
    const f = parsed("Put target exiled card with warp on the bottom of its owner's library.");
    const a = f.abilities[0] as unknown as { effect: { targets: unknown[]; steps: unknown[] } };
    expect(fullyAutomated(f)).toBe(true);
    expect(a.effect.targets).toMatchObject([{ id: 't0', kind: 'object', min: 1, max: 1, filter: { keyword: 'warp', isCard: true, zone: 'exile' } }]);
    expect(a.effect.steps).toEqual([{ op: 'move', what: t0, to: { zone: 'library', position: 'bottom' } }]);
    // only a card head: "target exiled creature" is no reading
    expect(fullyAutomated(parsed("Put target exiled creature on the bottom of its owner's library."))).toBe(false);
  });
  it('CR 608.2c: "sacrifice ~ unless C" for a history condition is "if not C, sacrifice ~"', () => {
    expect(steps(`At the beginning of your end step, sacrifice ~ unless ${VOID_TEXT}.`, 'Enchantment')).toEqual([
      { op: 'if', cond: { cond: 'not', of: VOID }, then: [{ op: 'sacrifice', what: { ref: 'self' } }] },
    ]);
  });
});

describe('E2 real cards (npm run cards -- try): the void cards whose only blocker was the void condition', () => {
  it('the void triggers compile full', () => {
    for (const name of ['Kavaron Skywarden', 'Insatiable Skittermaw', 'Elegy Acolyte', 'Voidforged Titan', 'Hylderblade']) expect(compileCard(getCard(name)).automation.level, name).toBe('full');
  });
  it('the void spells compile full', () => {
    for (const name of ['Hymn of the Faller', 'Plasma Bolt', 'Tragic Trajectory']) expect(compileCard(getCard(name)).automation.level, name).toBe('full');
  });
});
