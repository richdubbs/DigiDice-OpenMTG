/**
 * WP14: the predefined tokens of CR 111.10 (effects/predefined-tokens.json). Their rules text comes from the Comprehensive Rules, and their abilities are that
 * text in the ability model: every ability validates (WP1), renders back to the CR's words through the exact gate (WP2), and the list is the lexicon's (WP5).
 * When the rules files are present (rules/cr is git-ignored and lives only in the main checkout) each text is checked against its CR rule as well.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PREDEFINED_TOKENS, predefinedToken, tokenCardDef } from '../../../src/effects/handlers/token-defs';
import { lintAbility, validateAbility } from '../../../src/model';
import { renderGate } from '../../../src/render/gate';
import lexicon from '../../../src/parser/lexicon.generated.json';
import type { AbilityDef } from '../../../src/index';

const HERE = dirname(fileURLToPath(import.meta.url));
const CR_CANDIDATES = [process.env['OPENMTG_CR_DIR'], resolve(HERE, '../../../../../rules/cr'), resolve(HERE, '../../../../../../DigiDice-OpenMTG-archive/rules/cr')].filter((x): x is string => !!x);
const CR_DIR = CR_CANDIDATES.find((d) => existsSync(join(d, '1-game-concepts/111-tokens.md')));

const norm = (t: string): string => t.replace(/(\w)’(\w)/g, "$1'$2").replace(/[“”]/g, '"').replace(/[‘’]/g, '"').replace(/\s+/g, ' ').toLowerCase().trim();
/** A sentence as the CR quotes it inside a longer one ("... gets +1/+1," and ...): without its final punctuation. */
const sentence = (t: string): string => norm(t).replace(/[.,]+$/, '');

/**
 * Abilities whose JSON is right but which the renderer (WP2) does not yet read back in the CR's words. Listed so the gate test stays exact for every other one,
 * and fails here once the renderer learns the wording (then remove the entry).
 */
/** Abilities of predefined tokens the gate is known to refuse (none since WP22 fixed the "+1/+1 for each ..." reading of render/mods.ts, Virtuous Role). */
const KNOWN_RENDER_GAPS: Record<string, string> = {};

describe('CR 111.10: the predefined token table', () => {
  it('lists exactly the predefined tokens of the lexicon (generated from CR 111.10), with their rule numbers', () => {
    expect(PREDEFINED_TOKENS.map((t) => ({ name: t.name, rule: t.rule }))).toEqual(lexicon.predefinedTokens);
  });

  it('every token builds into a definition with its own content-derived id; lookup ignores case', () => {
    const ids = new Set<string>();
    for (const t of PREDEFINED_TOKENS) {
      const def = tokenCardDef({ predefined: t.name });
      if ('reason' in def) throw new Error(def.reason);
      expect(def.isToken).toBe(true);
      ids.add(def.id);
    }
    expect(ids.size).toBe(PREDEFINED_TOKENS.length);
    expect(predefinedToken('treasure')?.name).toBe('Treasure');
  });

  for (const t of PREDEFINED_TOKENS) {
    describe(`CR ${t.rule}: ${t.name}`, () => {
      const abilities = t.faces.flatMap((f) => f.abilities as AbilityDef[]);

      it('its abilities validate and lint without errors (WP1)', () => {
        for (const a of abilities) {
          const issues = [...validateAbility(a), ...lintAbility(a)].filter((i) => i.severity === 'error');
          expect(issues, `${a.text}: ${JSON.stringify(issues)}`).toEqual([]);
        }
      });

      it('each automated ability renders back to its rules text through the exact gate (WP2)', () => {
        for (const f of t.faces) {
          for (const a of f.abilities as AbilityDef[]) {
            if (a.kind === 'manual') continue;
            const g = renderGate(a, a.text.split('\n'), { selfNames: [f.name, 'this token'], selfTypes: [...f.types, ...f.subtypes] });
            expect(g.ok, `${a.text} -> ${g.rendered}`).toBe(!Object.hasOwn(KNOWN_RENDER_GAPS, a.text));
          }
        }
      });

      it.skipIf(!CR_DIR)('its rules text is the text of its CR rule', () => {
        const rules = readFileSync(join(CR_DIR!, '1-game-concepts/111-tokens.md'), 'utf8');
        const line = rules.split('\n').find((l) => l.startsWith(`${t.rule} `));
        expect(line, t.rule).toBeDefined();
        for (const f of t.faces) {
          expect(norm(line!)).toContain(norm(f.name === 'Phyrexian Token' ? 'Phyrexian Token' : f.name));
          for (const text of f.text.split('\n').filter((x) => x.length > 0 && !/^enchant creature$/i.test(x) && !/^indestructible$/i.test(x))) expect(norm(line!), text).toContain(sentence(text));
        }
      });
    });
  }

  // std-ry3: Powerstone and Vibranium's "This mana can't be spent to cast a nonartifact spell." is ManaRestriction.notSpells (FAST5X E23, CR 106.6), so their
  // mana abilities are data now; pc-keywords-mana-1: and Junk's ("You may play that card this turn", a permit on the exiled card, sorcery timing) is data too, so
  // no predefined token keeps a manual ability.
  it('no predefined token keeps a manual ability in the data', () => {
    const withManual = PREDEFINED_TOKENS.filter((t) => t.faces.some((f) => (f.abilities as AbilityDef[]).some((a) => a.kind === 'manual'))).map((t) => t.name);
    expect(withManual).toEqual([]);
    // Whether a token is FULL is not pinned here: it is computed from the engine's capabilities (tokens/review.test.ts recomputes it, design 5.2).
    for (const name of withManual) {
      const def = tokenCardDef({ predefined: name });
      expect('reason' in def ? 'manual' : def.automation.level, name).not.toBe('full');
    }
  });
});
