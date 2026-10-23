/**
 * FAST5X-4: the parser side of speed (Aetherdrift). The keyword line "Start your engines!" (CR 702.179, its "!" is part of the name), "Max speed -- [Ability]"
 * as the static ability it means (CR 702.178a-b: "As long as your speed is 4, this object has [Ability]", from the zones that ability names), the condition
 * "you have max speed" (CR 702.179e), and the template data of parser/templates/zz-fast5x/e4.json. Guard G9 (design 6.8): every example lowers with its
 * template, is fully automated and passes the exact render gate; every counter-example does not parse or parses to different JSON. Examples are synthetic
 * wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard, StaticAbilityDef } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import e4 from '../../../src/parser/templates/zz-fast5x/e4.json';
import { automated, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';

const E4 = e4 as Template[];
const OPTS = defaultParseOptions({ capabilities: ENGINE_CAPABILITIES });

function exampleCard(text: string, type?: string): OracleCard {
  const permanent = /^(When|Whenever|At)\b/.test(text) || /^[^"]*:/.test(text) || !/^(Search|Draw|Destroy)\b/.test(text);
  const typeLine = type ?? (permanent ? 'Creature — Human' : 'Sorcery');
  return {
    name: 'Example Subject', layout: 'normal', type_line: typeLine, oracle_text: text.replace(/~/g, 'Example Subject'), mana_cost: '{1}',
    colors: [], keywords: [], ...(/Creature/.test(typeLine) ? { power: '2', toughness: '2' } : {}),
  } as OracleCard;
}
const parsed = (text: string, type?: string) => parseCard(exampleCard(text, type), OPTS).faces[0]!;

describe('E4 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler after the existing zz-fast entries, before zz-m6/ and zz-push/ (path order), and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5x/e4.json');
    expect(files.indexOf('zz-fast5x/e4.json')).toBeGreaterThan(files.indexOf('zz-fast4/t34.json'));
    expect(files.indexOf('zz-fast5x/e4.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5X)', () => {
    expect(E4.length).toBe(5);
    for (const t of E4) {
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of E4) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'chosen', "can't", 'double', 'twice']) if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
    }
  });
});

describe('E4 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of E4) {
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

describe('CR 702.179: the keyword line "Start your engines!"', () => {
  it('is the keyword ability, automated, and renders with its "!"', () => {
    const f = parsed('Start your engines!\nFlying');
    expect(f.abilities[0]).toMatchObject({ kind: 'keyword', keyword: 'start your engines!' });
    expect(fullyAutomated(f)).toBe(true);
  });
  it('without its "!" or with other words it is no keyword', () => {
    expect(automated(parsed('Start your engines').abilities)).toBe(false);
    expect(automated(parsed('Start your engines twice!').abilities)).toBe(false);
  });
});

describe('CR 702.178a-b: "Max speed -- [Ability]" is "As long as your speed is 4, this object has [Ability]"', () => {
  const maxSpeed = { cond: 'designation', who: { ref: 'you' }, what: 'maxSpeed' };
  const grant = (text: string, type?: string): StaticAbilityDef => {
    const f = parsed(text, type);
    expect(fullyAutomated(f), `${text}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
    const a = f.abilities.find((x) => x.kind === 'static' && (x as StaticAbilityDef).keyword === 'max speed') as StaticAbilityDef | undefined;
    expect(a, text).toBeDefined();
    expect(a!.condition).toEqual(maxSpeed);
    expect(a!.effects).toHaveLength(1);
    expect(a!.effects[0]).toMatchObject({ s: 'continuous', affects: { ref: 'self' } });
    return a!;
  };
  const granted = (a: StaticAbilityDef): Record<string, unknown> => (a.effects[0] as unknown as { mods: { layer: number; add: Record<string, unknown>[] }[] }).mods[0]!.add[0]!;
  it('a static ability ("This creature has double strike.")', () => {
    const a = grant('Max speed — This creature has double strike.');
    expect(granted(a)).toMatchObject({ kind: 'static' });
    expect(a.zone).toBeUndefined();
  });
  it('an activated ability, a mana ability, a triggered ability', () => {
    expect(granted(grant('Max speed — {T}: Target creature gains haste until end of turn.'))).toMatchObject({ kind: 'activated' });
    expect(granted(grant('Max speed — {T}: Add {C}{C}.', 'Land'))).toMatchObject({ kind: 'activated', isMana: true });
    expect(granted(grant('Max speed — At the beginning of your end step, create a 2/2 black Zombie creature token.'))).toMatchObject({ kind: 'triggered' });
    expect(granted(grant('Max speed — Whenever you draw a card, each opponent mills two cards.', 'Artifact'))).toMatchObject({ kind: 'triggered' });
  });
  it('CR 702.178b, 113.6c: an ability that works from the graveyard makes the max speed ability work there', () => {
    const a = grant('Max speed — {2}, Exile this card from your graveyard: Draw a card.');
    expect(a.zone).toEqual(['graveyard']);
    expect(granted(a)).toMatchObject({ kind: 'activated', zone: ['graveyard'] });
  });
  it('a granted ability that is not understood keeps the whole line manual (never half)', () => {
    const f = parsed('Max speed — Frobnicate the zorbles.');
    expect(automated(f.abilities)).toBe(false);
  });
});

describe('CR 702.179e: "you have max speed" as a condition', () => {
  it('"~ can\'t attack or block unless you have max speed"', () => {
    const f = parsed("~ can't attack or block unless you have max speed.", 'Legendary Creature — God');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"what":"maxSpeed"');
  });
});
