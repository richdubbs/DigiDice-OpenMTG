/**
 * FAST5X E29: the template data of parser/templates/zz-fast5x/e29.json, impulse-draw permissions for the very cards an effect names (CR 611.2a-c, 601.3, 305.1,
 * 400.7): "you may play that card until the end of your next turn" (CR 611.2a, 514.2), "until end of turn, you may play those cards", "you may play them until
 * your next end step" (CR 611.2a), "you may cast that card for as long as it remains exiled" (CR 611.2b, 400.7), "from exile" (CR 406.1), the CR 609.4b rider
 * "and mana of any type can be spent to cast it", and "if you control a <subtype>" on the permission.
 * Guard G9 (design 6.8): every example lowers with its template, is fully automated (or capped only by the template's status) and passes the exact render gate;
 * every counter-example does not parse or parses to different JSON. Examples are synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import e29 from '../../../src/parser/templates/zz-fast5x/e29.json';
import { automated, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { goldenCard } from '../../m5/golden/harness';
import ownReview from '../../m5/golden/cards/fast5x-e29-review.json';
import r3FxReview from '../../m5/golden/cards/cloud-r3-fx-review.json';
import r5FxbReview from '../../m5/golden/cards/cloud-r5-fxb-promoted.json';
import stdRtReview from '../../m5/golden/cards/cloud-std-rt-review.json';
import stdRx8Review from '../../m5/golden/cards/cloud-std-rx8-review.json';
// r5-fxb: the promotions of design 10.4 are verified in the reviews of the slices that promoted them too (std-rt: eff.e29.permit.play.obj.dur.anyType;
// std-rx8: eff.e29.permit.play.group.durFirst.anyType)
const review = [...ownReview, ...r3FxReview, ...r5FxbReview, ...stdRtReview, ...stdRx8Review];

const E29 = e29 as Template[];
const OPTS = defaultParseOptions();
/**
 * FAST5 batch 9 integration: FAST5X E29 and FAST5 T70 both read the impulse permissions; where the two read one sentence the same way, the one that
 * wins is accepted (the JSON is the same but for the name of the bound cards).
 */
const SAME_SENTENCE_AS: Readonly<Record<string, readonly string[]>> = {
  'eff.e29.permit.play.obj.durFirst': ['eff.t70.permit.play.untilEndOfTurn', 'eff.t70.permit.play.untilNextEndStep'],
  'eff.e29.permit.play.group.dur': ['eff.t70.permit.play.thisTurn.group'],
  'eff.e29.permit.play.group.durFirst': ['eff.t70.permit.play.untilNextEndStep.group'],
};
const readsWith = (used: readonly string[], id: string): boolean => used.includes(id) || (SAME_SENTENCE_AS[id] ?? []).some((x) => used.includes(x));

function exampleCard(text: string, type?: string): OracleCard {
  const spell = /^(Exile|Until|Target|Draw|Gift)\b/.test(text);
  const typeLine = type ?? (spell ? 'Sorcery' : 'Creature — Human');
  return {
    name: 'Example Subject', layout: 'normal', type_line: typeLine, oracle_text: text.replace(/~/g, 'Example Subject'), mana_cost: '{1}',
    colors: [], keywords: [], ...(/Creature/.test(typeLine) ? { power: '2', toughness: '2' } : {}),
  } as OracleCard;
}
const parsed = (text: string, type?: string) => parseCard(exampleCard(text, type), OPTS).faces[0]!;
const steps = (text: string, type?: string): unknown[] => {
  const a = parsed(text, type).abilities.find((x) => x.kind !== 'keyword') as unknown as { effect?: { steps: unknown[] } };
  return a.effect?.steps ?? [];
};

describe('E29 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5x/e29.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5x/e29.json');
    expect(files.indexOf('zz-fast5x/e29.json')).toBe(files.indexOf('zz-fast5x/e3.json') - 1);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5X)', () => {
    for (const t of E29) {
      expect(t.id, t.id).toMatch(/^eff\.e29\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable E29 template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string }[];
    const WHOLE_CORPUS: Record<string, string[]> = WHOLE;
    for (const t of E29.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('the templates without real-card evidence stay experimental (their cards have other blockers, or no card prints them yet)', () => {
    const experimental = E29.filter((t) => t.status === 'experimental').map((t) => t.id).sort();
    // cast.group: Chandra, Heart of Fire ("cards exiled this way") only; the play riders: Court of Locthwain, Gonti, Canny Acquisitor, Reno and Rude, Apple of
    // Eden, Rakdos, the Muscle, all manual for another sentence; the conditions: Gandalf ("they" has two antecedents, design 6.4; Possibility Technician's reading is automated since std-eoe and its template is stable)
    // r5-fxb: permit.play.group.durFirst.while is stable (Gandalf, Goblins' Bane's Flameshape reads automated since the "they" of LOOK1's look-and-exile resolves; promoted with its only card, design 10.4)
    // std-rt: permit.play.obj.dur.anyType is stable (its automated cards of the local index, WHOLE below; Reno and Rude reads it since "the exiled card" names the card
    // exiled from the top of a library, render/steps-zones.ts)
    // std-rx8: permit.play.group.durFirst.anyType is stable (Rakdos, the Muscle reads automated since "exile cards equal to N from the top of target player's
    // library" parses; with Lidless Gaze, every automated card of the local index; design 6.9 deviation, recorded)
    expect(experimental).toEqual([
      'eff.e29.permit.cast.group.dur', 'eff.e29.permit.cast.group.durFirst', 'eff.e29.permit.play.group.dur.anyType',
    ]);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of E29) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

/**
 * The whole-corpus evidence of the stable templates with fewer than three cards: every card of the local index (34,473 cards, snapshot of 2026-10-15) on which
 * the template's reading is AUTOMATED, each hand-verified as a golden card. The other cards that print the sentence keep it manual for another reason (Thief
 * of Sanity, Gonti, Lord of Luxury: a card exiled face down; Dire Fleet Daredevil, Nita, Forum Conciliator: "If that spell would be put into a graveyard";
 * The Magic Bandit: its trigger; Quistis Trepe: the same replacement), so the template never decides how they play; `try` shows its reading on each.
 */
const WHOLE: Record<string, string[]> = {
  'eff.e29.permit.cast.obj.dur.anyType': ["Cruelclaw's Heist"],
  'eff.e29.cast.now.anyType': ['Tinybones, the Pickpocket'],
  // Cloud std-eoe: promoted with its only automated card of the local index (34,473 cards, 2026-10-11 bulk file; 0 held-out cards read it): its "it" now has one
  // antecedent, the card the sentence before exiled (lower/anaphora.ts), so the "two antecedents" note above no longer holds for it
  'eff.e29.permit.play.obj.durFirst.while': ['Possibility Technician'],
  // r5-fxb: promoted with its only automated card of the local index (34,473 cards; verified in test/m5/golden/cards/cloud-r5-fxb-promoted.json)
  'eff.e29.permit.play.group.durFirst.while': ["Gandalf, Goblins' Bane // Flameshape"],
  // std-rt (design 6.9 deviation, named in the round record): promoted with the cards of the local index (34,473 cards, 2026-10-11 bulk file) on which an ability
  // reading it is fully automated, both verified in test/m5/golden/cards/cloud-std-rt-review.json; Court of Locthwain reads it too, in an ability whose monarch
  // sentence is manual (partial); no held-out card outside Standard reads it
  'eff.e29.permit.play.obj.dur.anyType': ['Reno and Rude', 'Gonti, Canny Acquisitor'],
  // std-rx8: promoted with its two automated cards of the local index (34,473 cards, 2026-10-11 bulk file; both verified in
  // test/m5/golden/cards/cloud-std-rx8-review.json): Rakdos, the Muscle (Standard, held-out half: open, owner decision 2026-10-17) and Lidless Gaze (tuning half).
  // Mr. Monopoly, On the Go and Tinybones, Bauble Burglar print the sentence too and stay manual for other sentences
  'eff.e29.permit.play.group.durFirst.anyType': ['Rakdos, the Muscle', 'Lidless Gaze'],
};

describe('E29 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of E29) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsed(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsed(e.text);
        expect(readsWith(f.templatesUsed, t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
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

describe('E29 lowering: what the shapes mean', () => {
  const YOU = { ref: 'you' };
  const permitStep = (action: 'play' | 'cast', d: unknown, extra: Record<string, unknown> = {}): unknown => expect.objectContaining({
    op: 'effect', duration: d, effects: [expect.objectContaining({ s: 'permit', who: YOU, action, of: { is: expect.anything() }, ...extra })],
  });
  it('CR 611.2a, 514.2: "until the end of your next turn" is its own duration, before or after the permission', () => {
    const d = { d: 'endOfNextTurn', whose: YOU };
    expect(steps('Exile the top card of your library. Until the end of your next turn, you may play that card.')[1]).toEqual(permitStep('play', d));
    expect(steps('Exile the top card of your library. You may play that card until the end of your next turn.')[1]).toEqual(permitStep('play', d));
    expect(steps('Exile the top two cards of your library. You may play them until the end of your next turn.')[1]).toEqual(permitStep('play', d));
  });
  it('CR 611.2a: "until your next end step" ends as that step begins; "this turn" and "until end of turn" are the cleanup step (CR 514.2)', () => {
    expect(steps('Exile the top two cards of your library. You may play those cards until your next end step.')[1])
      .toEqual(permitStep('play', { d: 'untilNextStep', step: 'end', whose: 'you' }));
    expect(steps('Exile the top two cards of your library. You may play those cards this turn.')[1]).toEqual(permitStep('play', { d: 'endOfTurn' }));
    expect(steps('Exile the top card of your library. Until end of turn, you may cast that card.')[1]).toEqual(permitStep('cast', { d: 'endOfTurn' }));
  });
  it('a permission with no duration, for someone else, or without paying the mana cost is no reading of these templates', () => {
    for (const text of [
      'Exile the top card of your library. You may play that card.',
      'Exile the top card of your library. Target opponent may play that card until the end of your next turn.',
      'Exile the top card of your library. You may cast that card until the end of your next turn without paying its mana cost.',
    ]) expect(parsed(text).templatesUsed.some((id) => id.startsWith('eff.e29.')), text).toBe(false);
  });
});

describe('E29 real cards (npm run cards -- try)', () => {
  it('the golden cards compile as reviewed', () => {
    for (const g of review as { card: string; expect?: string }[]) {
      // Cloud std-eoe: a card outside the fixture set (Possibility Technician) is read from the local index, and skipped without one (golden/harness.ts#goldenCard)
      const c = goldenCard(g.card);
      if (g.expect === 'full' && c !== undefined) expect(compileCard(c).automation.level, g.card).toBe('full');
    }
  });
});
