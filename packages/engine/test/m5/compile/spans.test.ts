/**
 * WP18: cards/spans.ts#spansOf, the Oracle text painting of design 10.5: automated spans plain, manual spans with their reason and JSON pointer,
 * reminder text dimmed, labels plain. Ranges are in the face's original text. Never paints manual text as automated.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, spansOf, type CardDef, type TextSpan } from '../../../src/index';
import { compiledDef, fixtureCardNames } from '../../fixtures';
import { card, creature } from './helpers';

const show = (def: CardDef, face = 0): [string, string][] => spansOf(def, face).map((s) => [s.status, def.faces[face]!.oracleText.slice(s.range[0], s.range[1])]);

// M12F (STATUS "Wave M12" gap 9): whole-fixture work (compiling, the CLI, the smoke run) sits near Vitest's 5 s default under load: an explicit
// timeout for every test here (a test's own longer one still applies).
describe('spansOf (design 10.5)', { timeout: 60_000 }, () => {
  it('a fully automated spell is one automated span', () => {
    const def = compileCard(card('Test Card deals 3 damage to any target.'));
    expect(show(def)).toEqual([['auto', 'Test Card deals 3 damage to any target.']]);
    expect(spansOf(def, 0)[0]).toMatchObject({ abilityIndex: 0, range: [0, 39] });
  });

  it('CR 207.2a: reminder text is its own span; a manual keyword is manual with the capability it needs (Aven Warhawk: amplify; std-ry8 implements enlist)', () => {
    // FAST5X E28: Kitchen Finks's persist is automated now (keywords/data/persist.json): its keyword line is painted auto
    const finks = show(compiledDef('Kitchen Finks'));
    expect(finks.slice(0, 2)).toEqual([['auto', 'When this creature enters, you gain 2 life.'], ['auto', 'Persist']]);
    expect(finks.some(([status, text]) => status === 'reminder' && text.startsWith('(When this creature dies'))).toBe(true);
    const def = compiledDef('Aven Warhawk');
    const spans = show(def);
    expect(spans.some(([status, text]) => status === 'manual' && text === 'Amplify 1')).toBe(true);
    expect(spans.some(([status, text]) => status === 'reminder' && text.startsWith('(As this creature enters'))).toBe(true);
    const amplify = spansOf(def, 0).find((s) => s.status === 'manual' && def.faces[0]!.oracleText.slice(s.range[0], s.range[1]) === 'Amplify 1')!;
    expect(amplify.reason).toContain('keyword:amplify');
  });

  // W3 integration: ward is implemented since WP32 (keyword:ward), so the unimplemented keyword here was rampage (CR 702.23); CMD3 implements rampage, so it is absorb (CR 702.64).
  it('a keyword list with one manual item paints only that item manual ("Flying, absorb 2")', () => {
    const def = compileCard(creature('Flying, absorb 2'));
    expect(show(def)).toEqual([['auto', 'Flying,'], ['manual', 'absorb 2']]);
  });

  it('CR 207.2c: an ability word is a label span; ranges are in the original text (an em dash is one character there)', () => {
    const def = compileCard(creature('Landfall — Whenever a land you control enters, frobnicate the quux.'));
    const spans = show(def);
    expect(spans[0]).toEqual(['label', 'Landfall —']);
    // W3b: the landfall trigger is understood (CR 603.2, 305.1); the invented effect stays manual inside the line
    expect(spans.slice(1)).toEqual([['auto', 'Whenever a land you control enters,'], ['manual', 'frobnicate the quux'], ['auto', '.']]);
    const all = spansOf(def, 0);
    expect(all.at(-1)!.range[1]).toBe(def.faces[0]!.oracleText.length);
  });

  it('a manual ability without a line (an unknown mana symbol) does not take a line that an ability claims', () => {
    const def = compileCard(creature('Flying', { mana_cost: '{D}' }));
    // WP18 review: the card is capped manual (CR 202.1b: the engine can't cast it), so "Flying" is the demoted keyword's manual text, not the orphan's
    expect(show(def)).toEqual([['manual', 'Flying']]);
    expect(spansOf(def, 0)[0]).toMatchObject({ abilityIndex: 0, reason: expect.stringMatching(/mana cost \{D\}/) });
  });

  it('a face with no text has no spans; an index without a face has none either', () => {
    expect(spansOf(compileCard(creature('')), 0)).toEqual([]);
    expect(spansOf(compileCard(creature('Flying')), 3)).toEqual([]);
  });

  it('a face the definition did not compile from the parser (a custom compiler, no CardAutomation.faces) is painted manual, never automated', () => {
    const def = compileCard(creature('Frobnicate the quux.'), () => ({ abilities: [{ kind: 'manual', shape: 'unknown', text: 'Frobnicate the quux.', reason: 'test' }], unsupported: ['Frobnicate the quux.'] }));
    expect(show(def)).toEqual([['manual', 'Frobnicate the quux.']]);
  });

  it('property over every fixture card and face: spans are sorted, inside the text, disjoint, cover every non-space character, and a manual ability is never painted auto (but its understood cost, design 10.5)', () => {
    for (const name of fixtureCardNames()) {
      const def = compiledDef(name);
      def.faces.forEach((face, f) => {
        const spans: TextSpan[] = spansOf(def, f);
        const text = face.oracleText;
        let end = 0;
        const covered = new Array<boolean>(text.length).fill(false);
        for (const s of spans) {
          expect(s.range[0], `${name}/${f}`).toBeGreaterThanOrEqual(end);
          expect(s.range[1], `${name}/${f}`).toBeLessThanOrEqual(text.length);
          expect(s.range[0] < s.range[1], `${name}/${f}`).toBe(true);
          end = s.range[1];
          for (let i = s.range[0]; i < s.range[1]; i++) covered[i] = true;
          const owner = face.abilities[s.abilityIndex];
          if (s.status === 'auto' && owner?.kind === 'manual') {
            // "Understood costs stay plain": only the "[cost]:" of a manual ability that kept its cost
            expect(owner.cost, `${name}/${f}: "${text.slice(s.range[0], s.range[1])}"`).toBeDefined();
            expect(text.slice(s.range[0], s.range[1]), `${name}/${f}`).toMatch(/:$/);
          } else if (s.status === 'auto') expect(owner?.kind, `${name}/${f}: "${text.slice(s.range[0], s.range[1])}"`).toBeDefined();
        }
        for (let i = 0; i < text.length; i++) if (!/\s/.test(text[i]!)) expect(covered[i], `${name}/${f}: character ${i} "${text[i]}" of ${JSON.stringify(text)}`).toBe(true);
      });
    }
  }, 120_000); // every fixture card is compiled and spanned: the set grows with every package, so the default 5 s is not enough on a busy machine
});
