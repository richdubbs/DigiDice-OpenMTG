/**
 * The golden corpus (design 6.8 G10, 15.4 "Golden"), checked with every merged template, and ENFORCED for every source: the golden files
 * (test/m5/golden/cards/*.json: hand-verified JSON in the model's current conventions; content by the template packages and anyone who verifies a card)
 * and the 53 worked examples of design section 13 (15.4 lists "the cards of section 13" among the golden cards; CI fails on them like on any other).
 *
 * For each card: every fully understood ability equals its golden JSON, the automated nodes of every partial ability agree with it (never silently
 * wrong), the parsed faces pass the card-wide lint (an unlinked consumer, CR 607.1, does nothing in play), and the cards pinned `expect: "full"` stay
 * fully understood. Representation differences are allowed only through the reviewed list `EQUIVALENCES` of the harness.
 * Cards outside the fixture set need the local index (git-ignored) and are skipped without it.
 */
import { describe, expect, it } from 'vitest';
import { EQUIVALENCES, checkGolden, goldenCard, goldenOptions, loadGolden } from './harness';

const entries = loadGolden();
const opts = goldenOptions();

describe('golden corpus (G10): golden files and design section 13, enforced', () => {
  for (const e of entries) {
    const card = goldenCard(e.card);
    it.skipIf(card === undefined)(`${e.card} (${e.source}${e.expect ? ', expect full' : ''})`, () => {
      const r = checkGolden(e, card!, opts);
      expect(r.cardLint, `${e.card}: the parsed faces fail the card-wide lint (CR 607.1)`).toEqual([]);
      expect(r.mismatches, `${e.card}: the parser automates an ability (or part of one) whose JSON is not the golden one`).toEqual([]);
      expect(r.ratchet, e.card).toBeUndefined();
    });
  }
  it('has the 53 cards of design section 13 and golden-file entries, each verified and keyed by an Oracle name', () => {
    expect(entries.filter((e) => e.source === 'design 13').length).toBe(53);
    const files = entries.filter((e) => e.source !== 'design 13');
    expect(files.length).toBeGreaterThan(0);
    for (const e of files) expect(e.verified, e.card).toMatch(/CR \d{3}/);
  });
  it('the section 13 cards that are fixture cards are always checked (no local index needed)', () => {
    expect(entries.filter((e) => e.source === 'design 13' && goldenCard(e.card) !== undefined).length).toBeGreaterThanOrEqual(31);
  });
  it('representation equivalences are an explicit, reviewed list, each citing its rule or design section', () => {
    expect(EQUIVALENCES.length).toBeGreaterThan(0);
    for (const q of EQUIVALENCES) expect(q).toMatch(/CR \d{3}|design \d/);
  });
});
