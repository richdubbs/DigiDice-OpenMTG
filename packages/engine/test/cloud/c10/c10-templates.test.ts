/**
 * C10 (cloud batch 3): the template data of parser/templates/zz-cloud/c10.json (casting from the graveyard as a static permission and its riders; CR 601.3,
 * 601.3e, 601.2f, 118.8, 614.1c, 305.1, 611.2a, 614.1a) and the real cards it makes full.
 * Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate; every counter-example does not parse or
 * parses to different JSON. Examples are synthetic wordings (design 6.10). The real cards need the local index (git-ignored) and are skipped without it.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import c10 from '../../../src/parser/templates/zz-cloud/c10.json';
import { automated, fullyAutomated, jsonKey, localIndex } from '../../m5/templates/support';
import review from '../../m5/golden/cards/cloud-c10-review.json';
import { scenario } from '../../m5/helpers';

const C10 = c10 as Template[];
const OPTS = defaultParseOptions();
const NAME = 'Example Subject';

/** A creature for a static ability, a sorcery for an effect or a rider (the sentence is the spell's), compiled like any card. */
const exampleCard = (text: string, kind: Template['kind']): OracleCard => ({
  name: NAME, layout: 'normal', mana_cost: '{1}', colors: [], keywords: [], oracle_text: text.replace(/~/g, NAME),
  ...(kind === 'static' ? { type_line: 'Creature — Spirit', power: '2', toughness: '2' } : { type_line: 'Sorcery' }),
} as unknown as OracleCard);
const parsed = (text: string, kind: Template['kind']) => parseCard(exampleCard(text, kind), OPTS).faces[0]!;

const index = localIndex();
const byName = (name: string): OracleCard | undefined => index?.find((c) => c.name === name);

describe('C10 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-cloud/c10.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    const at = files.indexOf('zz-cloud/c10.json');
    expect(at).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(at).toBeLessThan(files.indexOf('zz-cloud/std-hob.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has examples and two counter-examples, is stable and of version 8', () => {
    for (const t of C10) {
      expect(t.id).toMatch(/^eff\.c10\./);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(1);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.status, t.id).toBe('stable');
      expect(t.since, t.id).toBe(8);
    }
  });
});

describe('C10 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of C10) {
    it(`${t.id} (${t.cr.join(', ')})`, () => {
      const first = parsed(t.examples[0]!.text, t.kind);
      for (const e of t.examples) {
        const f = parsed(e.text, t.kind);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parsed(c, t.kind);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
  it('Noctis\'s sentence lowers to exactly the permission form the engine honors', () => {
    const a = parsed('You may cast artifact spells from your graveyard by paying 3 life in addition to paying their other costs. If you cast a spell this way, that artifact enters with a finality counter on it.', 'static').abilities[0] as unknown as { kind: string; effects: unknown[] };
    expect(a.kind).toBe('static');
    expect(a.effects).toEqual([{
      s: 'permit', who: { ref: 'you' }, action: 'cast', of: { types: ['Artifact'], stackKind: 'spell', zone: 'stack' }, from: 'graveyard',
      addCost: { other: [{ kind: 'payLife', amount: 3 }] }, entersWith: [{ kind: 'finality', count: 1 }],
    }]);
  });
  it('the forms the engine does not honor stay manual (fail closed)', () => {
    for (const text of [
      'Each player may cast creature spells from their graveyard.',
      'You may cast creature spells from your graveyard by paying {2} rather than paying their mana costs.',
      'You may cast spells that have a cycling ability from your graveyard.',
      'Once during each of your turns, you may play a historic land or cast a historic permanent spell from your graveyard.',
      'You may cast creature spells from your graveyard. If you cast a spell this way, it gains haste until end of turn.',
    ]) {
      expect(fullyAutomated(parsed(text, 'static')), text).toBe(false);
    }
  });
});

describe('C10: the real cards (local index)', () => {
  const FULL = (review as { card: string; expect?: string }[]).filter((g) => g.expect === 'full').map((g) => g.card);
  it.skipIf(index === null)('the cards of the golden review compile full', () => {
    expect(FULL.length).toBeGreaterThan(5);
    for (const name of FULL) expect(compileCard(byName(name)!).automation.level, name).toBe('full');
  });
  it.skipIf(index === null)('the cards that had another blocker are full now that it is read', () => {
    // Wave 8 merge: both former blockers are read. Hundred-Battle Veteran: r4-static reads its counter-kinds pump. Kotis, Sibsig Champion: r5-trig reads its
    // intervening "if" (CR 603.4), "one or more of them entered from a graveyard or was cast from a graveyard", cond someMatch; test/cloud/r5-trig/r5-trig-scenarios.test.ts
    // plays that condition. (Exploration Broodship is full since "a permanent spell" is a filter, lines C and D: test/cloud/c10/broodship.test.ts plays it.)
    for (const name of ['Kotis, Sibsig Champion', 'Hundred-Battle Veteran']) {
      const card = byName(name);
      expect(card, name).toBeDefined();
      expect(compileCard(card!).automation.level, name).toBe('full');
    }
  });
  it.skipIf(index === null)('merged with std-blb ("If a card or token would be put into your graveyard from anywhere, exile it instead"), Festival of Embers, Hades and Yawgmoth\'s Agenda are full; with "a permanent spell" (lines C and D), Exploration Broodship', () => {
    // their entries in test/m5/golden/cards/cloud-std-blb-review.json pin the C10 permission JSON (CR 601.3, 305.1)
    for (const name of ['Festival of Embers', 'Emet-Selch, Unsundered // Hades, Sorcerer of Eld', "Yawgmoth's Agenda", 'Exploration Broodship']) {
      const card = byName(name);
      expect(card, name).toBeDefined();
      expect(compileCard(card!).automation.level, name).toBe('full');
    }
  });
});

describe('C10: a permission an ability grants to the card itself in the graveyard (local index)', () => {
  it.skipIf(index === null)('Lightwheel Enhancements: "Max speed -- You may cast this card from your graveyard." works only with max speed (CR 702.179e, 113.6)', () => {
    const def = compileCard(byName('Lightwheel Enhancements')!);
    const s = scenario(['Grizzly Bears', 'Plains'], { p1: { battlefield: ['Grizzly Bears', 'Plains', 'Plains', 'Plains'], graveyard: ['Lightwheel Enhancements'] }, defs: [def] });
    const offered = (speed: number): boolean => {
      const t = { ...s, designations: { ...s.designations, speed: { p1: speed } } };
      return legalActions(t, 'p1').some((a) => a.kind === 'cast' && t.objects[a.object!]?.zone === 'graveyard');
    };
    expect(offered(3)).toBe(false);
    expect(offered(4)).toBe(true);
  });
});
