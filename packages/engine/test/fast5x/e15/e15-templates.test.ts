/**
 * FAST5X E15 (MX18): the parser side of "the greatest / least <stat> among <set>". The Qty hole reads it as the `stat` quantity with `agg` (CR 208.1, 202.3),
 * the Filter hole reads "with the greatest <stat> among <set>" as a comparison with it (CR 608.2d: the tied greatest, the chooser picks), the Qty hole reads
 * "N or Q, whichever is greater" (CR 107.3) and "the number of cards drawn this way" (CR 121.2, 608.2c), and the templates of
 * parser/templates/zz-fast5x/e15.json. Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate;
 * every counter-example does not parse or parses to different JSON. Examples are synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, OracleCard } from '../../../src/index';
import { validateAbility } from '../../../src/model';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import e15 from '../../../src/parser/templates/zz-fast5x/e15.json';
import { automated, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';

const E15 = e15 as Template[];
const OPTS = defaultParseOptions({ capabilities: ENGINE_CAPABILITIES });

function exampleCard(text: string, type?: string): OracleCard {
  const spell = /^(Target opponent|Draw|Put|Counter|You gain|~ deals|Example Subject deals)/.test(text);
  const typeLine = type ?? (spell ? 'Sorcery' : 'Artifact Creature — Robot');
  return {
    name: 'Example Subject', layout: 'normal', type_line: typeLine, oracle_text: text.replace(/~/g, 'Example Subject'), mana_cost: /\bX\b/.test(text) && /^Put X/.test(text) ? '{X}{G}' : '{1}',
    colors: [], keywords: [], ...(/Creature/.test(typeLine) ? { power: '2', toughness: '2' } : {}),
  } as OracleCard;
}
const parsed = (text: string, type?: string) => parseCard(exampleCard(text, type), OPTS).faces[0]!;
const json = (text: string, type?: string): string => JSON.stringify(parsed(text, type).abilities.map((a) => ('effect' in a ? a.effect : a)));

describe('E15 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler in path order among the zz-fast5x files (e15 sorts after e1, before e2), and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5x/e15.json');
    // path order: after e1 and the e1x files before it (e10-e14), before e16, e18 and e2 (batch 4 integration)
    expect(files.indexOf('zz-fast5x/e15.json')).toBe(files.indexOf('zz-fast5x/e14.json') + 1);
    expect(files.indexOf('zz-fast5x/e15.json')).toBeLessThan(files.indexOf('zz-fast5x/e2.json'));
    expect(files.indexOf('zz-fast5x/e15.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5X)', () => {
    expect(E15.length).toBe(5);
    for (const t of E15) {
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of E15) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'chosen', "can't", 'double', 'twice']) if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
    }
  });
});

describe('E15 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of E15) {
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

describe('the Qty hole: "the greatest / highest / least <stat> among <set>" (CR 208.1, 202.3)', () => {
  it('"the greatest power among creatures you control" is the `stat` quantity with agg max over the set', () => {
    expect(json('Draw cards equal to the greatest power among creatures you control.')).toContain('{"q":"stat","stat":"power","of":{"ref":"each","filter":{"types":["Creature"],"controller":"you"}},"agg":"max"}');
  });
  it('"highest" is the same maximum; "least" is the minimum', () => {
    expect(json('Draw cards equal to the highest mana value among artifacts you control.')).toContain('"stat":"manaValue"');
    expect(json('Draw cards equal to the highest mana value among artifacts you control.')).toContain('"agg":"max"');
    expect(json('You gain life equal to the least toughness among creatures you control.')).toContain('"agg":"min"');
  });
  it('G10: "the total power of creatures you control" keeps its sum reading byte for byte (no agg)', () => {
    const j = json('You gain life equal to the total power of creatures you control.');
    expect(j).toContain('"sum":true');
    expect(j).not.toContain('"agg"');
  });
  it('a set read from cards in a graveyard ("among cards in your graveyard")', () => {
    expect(json('Draw cards equal to the greatest mana value among cards in your graveyard.')).toContain('"zone":"graveyard"');
  });
});

describe('the Filter hole: "with the greatest <stat> among <set>" (CR 608.2d)', () => {
  it('is a comparison: at least the greatest value of the set ("they" is the target opponent)', () => {
    const j = json('Target opponent sacrifices a creature with the greatest power among creatures they control.');
    expect(j).toContain('"power":{"op":">=","value":{"q":"stat","stat":"power","of":{"ref":"each","filter":{"types":["Creature"],"controller":{"ref":"target","id":"t0"}}},"agg":"max"}}');
  });
  it('guard G5: "they control" belongs to the set, never to the outer noun (one reading, fully automated)', () => {
    const f = parsed('Target opponent sacrifices a creature with the greatest power among creatures they control.');
    expect(fullyAutomated(f)).toBe(true);
    expect(f.diagnostics.filter((d) => d.code === 'ambiguous')).toEqual([]);
  });
  it('"without the greatest ..." is not read', () => {
    expect(fullyAutomated(parsed('Target opponent sacrifices a creature without the greatest power among creatures they control.'))).toBe(false);
  });
});

describe('the Qty hole: "N or Q, whichever is greater" (CR 107.3)', () => {
  it('is the greater of the two', () => {
    expect(json('Example Subject deals damage to target creature equal to 2 or the greatest power among Dinosaurs you control, whichever is greater.')).toContain('{"q":"math","op":"max","args":[2,{"q":"stat"');
  });
  it('"whichever is less" is the lesser', () => {
    expect(json('Example Subject deals damage to target creature equal to 3 or the number of creatures you control, whichever is less.')).toContain('{"q":"math","op":"min","args":[3,');
  });
});

describe('"the number of cards drawn this way" (CR 121.2, 608.2c)', () => {
  it('is the result count of the one draw step before it', () => {
    const j = json('Draw cards equal to the greatest power among creatures you control. You lose life equal to the number of cards drawn this way.');
    expect(j).toMatch(/"op":"draw".*"as":"(\w+)".*"op":"loseLife".*"amount":\{"q":"resultCount","step":"\1"\}/);
  });
  it('with no draw step before it the sentence is not automated', () => {
    expect(fullyAutomated(parsed('Mill two cards. You lose life equal to the number of cards drawn this way.'))).toBe(false);
  });
});

describe('"where X is" inside a reflexive trigger (CR 603.12, 608.2h)', () => {
  it('X is replaced inside the reflexive ability\'s own steps', () => {
    const f = parsed('When ~ enters, mill three cards. When you do, target creature an opponent controls gets -X/-X until end of turn, where X is the greatest mana value among cards in your graveyard.', 'Creature — Rat');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).not.toContain('"lower"');
    expect(JSON.stringify(f.abilities)).toContain('"agg":"max"');
  });
});

describe('model lint (design 3.4): a stat quantity names a total or a greatest / least value, never both', () => {
  const draw = (count: unknown): AbilityDef => ({ kind: 'spell', text: 'x', effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count }] } } as unknown as AbilityDef);
  const set = { ref: 'each', filter: { types: ['Creature'], controller: 'you' } };
  it('agg alone is clean; sum with agg is an executable gap', () => {
    expect(validateAbility(draw({ q: 'stat', stat: 'power', of: set, agg: 'max' })).filter((i) => i.severity === 'error')).toEqual([]);
    expect(validateAbility(draw({ q: 'stat', stat: 'power', of: set, sum: true, agg: 'max' })).map((i) => i.code)).toContain('executable-gap');
  });
});
