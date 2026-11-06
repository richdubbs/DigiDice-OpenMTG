/**
 * edh-zones-20 (Commander effort, lane edh-zones): the template data of parser/templates/zz-cloud/edh-zones-20.json and the round's other changes: the top card of the library as
 * a static object reference (statics/match.ts), "who controls more lands than you" after a trigger's player (parser/holes/edhz20.ts, render/abil.ts), "cards put into their graveyard
 * from anywhere this turn" (render/qty.ts), the discard an effect causes (`byEffect` on a zone change, effects/replacements.ts). Guard G9 and G2 as the earlier rounds run them;
 * examples are synthetic (design 6.10). The behavior is in edh-zones-20-scenarios.test.ts. CR cites checked against the 2026-09-25 text.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhZones20 from '../../../src/parser/templates/zz-cloud/edh-zones-20.json';
import review from '../../m5/golden/cards/edh-zones-20-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EZ20 = edhZones20 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on. */
const TYPE: Record<string, string> = {
  'sta.edhz20.aslong.has.allActivatedOf': 'Creature — Ooze',
  'sta.edhz20.aslong.topCard.has.allActivatedOf': 'Creature — Goblin',
  'eff.edhz20.mill.enchantedPlayer.whereX.putIntoTheirGraveyard': 'Enchantment — Aura',
  'trg.edhz20.self.dealsCombatDamage.toPlayerWho': 'Creature — Bird',
  'rep.edhz20.youDiscard.byEffect.mayTopLibrary': 'Artifact',
};
const typeOf = (_text: string, id?: string): string => (id !== undefined ? TYPE[id] ?? 'Sorcery' : 'Sorcery');
const face = (text: string, typeLine: string) =>
  parseCard(card('Example Relic', typeLine, text, typeLine.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string, name = 'Example Relic') =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard);
const level = (type: string, text: string, name?: string): string => compiled(type, text, name).automation.level;
const json = (type: string, text: string, name?: string): string => JSON.stringify(compiled(type, text, name).faces);
const strip = (a: string): string => a.replace(/"oracleText":"[^"]*"/g, '').replace(/"text":"[^"]*"/g, '').replace(/"src":\[[^\]]*\]/g, '');
const same = (a: string, b: string): boolean => strip(a) === strip(b);

const IDS = ["sta.edhz20.aslong.has.allActivatedOf", "sta.edhz20.aslong.topCard.has.allActivatedOf", "eff.edhz20.mill.enchantedPlayer.whereX.putIntoTheirGraveyard", "trg.edhz20.self.dealsCombatDamage.toPlayerWho", "rep.edhz20.youDiscard.byEffect.mayTopLibrary"];

describe('edh-zones-20 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-zones-20.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-zones-20.json');
    expect(files.indexOf('zz-cloud/edh-zones-20.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-zones-2.json')); // path order
    expect(files.indexOf('zz-cloud/edh-zones-20.json')).toBeLessThan(files.indexOf('zz-cloud/edh-zones-3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(EZ20.map((t) => t.id)).toEqual(IDS);
    for (const t of EZ20) {
      expect(t.id, t.id).toMatch(/^(eff|rep|sta|trg)\.edhz20\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) {
      expect(g.expect, g.card).toBe('full');
      expect(g.verified, g.card).toMatch(/CR \d{3}/);
    }
    // narrow wordings (one or two cards of the index print them), stable on one hand-verified golden card plus these tests and the scenarios: a 6.9 deviation named in the round record
    expect(goldenUsing('sta.edhz20.aslong.has.allActivatedOf')).toEqual(['Necrotic Ooze']);
    expect(goldenUsing('sta.edhz20.aslong.topCard.has.allActivatedOf')).toEqual(['Conspicuous Snoop']);
    expect(goldenUsing('eff.edhz20.mill.enchantedPlayer.whereX.putIntoTheirGraveyard')).toEqual(['Fraying Sanity']);
    expect(goldenUsing('trg.edhz20.self.dealsCombatDamage.toPlayerWho')).toEqual(["Cartographer's Hawk"]);
    expect(goldenUsing('rep.edhz20.youDiscard.byEffect.mayTopLibrary')).toEqual(['Library of Leng']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EZ20) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'all']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-zones-20 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EZ20) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.examples[0]!.text, typeOf(t.examples[0]!.text, t.id));
      for (const e of t.examples) {
        const f = face(e.text, typeOf(e.text, t.id));
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
        expect(fullyAutomated(f), e.text).toBe(true);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = face(c, typeOf(t.examples[0]!.text, t.id));
        expect(understood(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bgraveyard\b/, 'library'], [/\bgraveyard\b/, 'hand'], [/\bto your hand\b/, 'to your graveyard'], [/\bon top\b/, 'on the bottom'], [/\bany number\b/, 'one'], [/\bface down\b/, 'face up'],
    [/\bthe top\b/, 'the bottom'], [/\bopponent\b/, 'player'], [/\bsearch\b/, 'draw'], [/\bfrom your hand\b/, 'from your graveyard'], [/\bbottom\b/, 'top'], [/\bowner\b/, 'controller'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-zones-20 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EZ20) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(e.text, typeOf(e.text, t.id));
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = face(m, typeOf(e.text, t.id));
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('edh-zones-20 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EZ20) {
    it(`${t.id}: replacing any one word of the template's sentence by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^\{/.test(w)) return; // a mana symbol is not a word
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any name (CR 122.1)
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(understood(face(mutated, typeOf(e.text, t.id))), mutated).toBe(false);
        });
      }
    }, 240_000); // one parse per word of every example
  }
});


