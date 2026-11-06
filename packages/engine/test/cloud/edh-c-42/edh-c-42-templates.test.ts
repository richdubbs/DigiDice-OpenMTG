/**
 * edh-c-42 (Commander effort, EDHREC ranks 29,001-29,500): the template data of parser/templates/zz-cloud/edh-c-42.json and the round's other readings: amplify and
 * recover (keywords/data/amplify.json, recover.json; effects/bodies/m5.ts#revealHand), "~ can't attack unless you control a Knight or a Soldier" (render/cond.ts),
 * "damage that would be dealt by ~ can't be prevented" and half damage rounded down (render/stat.ts). Guard G9 (design 6.8): every example lowers with its template and
 * passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of
 * any word of an example never leaves an automated card (G2). Examples are synthetic wordings where the wording allows it (design 6.10: the unpreventable-damage and
 * half-damage sentences have one wording, the Oracle line of their one card), checked against the local index when it is present. The behavior is in
 * edh-c-42-scenarios.test.ts. CR cites were checked against the Comprehensive Rules of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC42 from '../../../src/parser/templates/zz-cloud/edh-c-42.json';
import review from '../../m5/golden/cards/edh-c-42-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const C42 = edhC42 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line each template's examples are printed on. */
const TYPE: Readonly<Record<string, string>> = {
  'rep.edhv42.enters.revealHand.countersForEach': 'Artifact Creature — Construct',
  'sta.edhv42.players.cantPlayLands': 'Enchantment',
  'eff.edhv42.player.cantPlayLands.dur': 'Sorcery',
  'sta.edhv42.self.damageCantBePrevented': 'Creature — Avatar',
  'sta.edhv42.damage.half.anySource': 'Creature — Spirit',
  'sta.edhv42.self.cantAttack.unlessControlEither': 'Creature — Bird',
};
const face = (id: string, text: string, typeLine?: string) => {
  const type = typeLine ?? TYPE[id] ?? 'Sorcery';
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string, pt?: [string, string]) =>
  compileCard({ name: 'Example Relic', layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
const level = (type: string, text: string, pt?: [string, string]): string => compiled(type, text, pt).automation.level;

describe('edh-c-42 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-42.json, after zz-cloud/edh-c-4.json, before zz-cloud/edh-c-5.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-42.json');
    expect(files.indexOf('zz-cloud/edh-c-42.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-c-4.json'));
    expect(files.indexOf('zz-cloud/edh-c-42.json')).toBeLessThan(files.indexOf('zz-cloud/edh-c-5.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 9', () => {
    expect(C42.map((t) => t.id)).toEqual(Object.keys(TYPE));
    for (const t of C42) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep)\.edhv42\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(9);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // narrow wordings (one to three Oracle cards each in the whole index): stable on one hand-verified golden card plus these tests and the scenarios, a 6.9
    // deviation named in the round record (owner's standing rule 2026-10-27)
    expect(goldenUsing('rep.edhv42.enters.revealHand.countersForEach')).toEqual(['Arsenal Thresher']);
    expect(goldenUsing('sta.edhv42.players.cantPlayLands')).toEqual(['Territorial Dispute']);
    expect(goldenUsing('eff.edhv42.player.cantPlayLands.dur')).toEqual(['Solfatara']);
    expect(goldenUsing('sta.edhv42.self.damageCantBePrevented')).toEqual(['Excruciator']);
    expect(goldenUsing('sta.edhv42.damage.half.anySource')).toEqual(['Ghosts of the Innocent']);
    expect(goldenUsing('sta.edhv42.self.cantAttack.unlessControlEither')).toEqual(['War Falcon']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of C42) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'next', 'then', 'when', 'also']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-c-42 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of C42) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.id, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(t.id, e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
        expect(fullyAutomated(f), e.text).toBe(true);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = face(t.id, c);
        expect(understood(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} twice.`, `${body} until end of turn.`];
  const swaps: [RegExp, string][] = [
    [/\bany number of\b/, 'up to three'], [/\brounded down\b/, 'rounded up'], [/\bhalf\b/, 'double'], [/\bplay lands\b/, 'cast spells'], [/\bdealt by\b/, 'dealt to'],
    [/\bcan't be prevented\b/, 'can be prevented'], [/\bfrom your hand\b/, 'from your graveyard'], [/\bPlayers\b/, 'You'], [/\bEach opponent\b/, 'You'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-c-42 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of C42) {
    it(`${t.id}: an appended condition or duration, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(t.id, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = face(t.id, m);
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('edh-c-42 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of C42) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.length - 1; // the line of the template (an earlier line is a keyword or another ability of the card)
        const words = lines[last]!.split(' ');
        words.forEach((w, i) => {
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // the CounterKind hole reads any word before "counter" (as in std-cardcopy-3's template)
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...lines.slice(0, last), [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ')].join('\n');
          expect(understood(face(t.id, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('edh-c-42 keywords amplify and recover (CR 702.38a, 702.59a)', () => {
  const keywordOf = (type: string, text: string) => JSON.stringify(compiled(type, text, ['1', '1']).faces);
  it('"Amplify N" expands to one entering replacement that reveals cards of the hand that share a creature type with it', () => {
    expect(level('Creature — Beast', 'Amplify 1', ['1', '1'])).toBe('full');
    expect(keywordOf('Creature — Beast', 'Amplify 2')).toContain('"keyword":"amplify","amount":2');
  });
  it('"Recover {cost}" is a triggered ability of the card in the graveyard', () => {
    expect(level('Instant', 'Draw a card.\nRecover {2}{U}')).toBe('full');
    expect(keywordOf('Sorcery', 'Draw a card.\nRecover {2}{U}')).toContain('"keyword":"recover"');
  });
  it('fails closed: an amplify with no number and a recover with no cost stay manual', () => {
    expect(level('Creature — Beast', 'Amplify', ['1', '1'])).not.toBe('full');
    expect(level('Instant', 'Draw a card.\nRecover')).not.toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-c-42 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-42 example or counter-example line is a line of a real card, except the two one-wording sentences named in the header', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|Equipment|spell|card|Saga)\b/gi, '~').trim());
        }
      }
    }
    const context = /^(Flying|Reach|Trample|Vigilance)$/;
    const oneWording = new Set(['sta.edhv42.self.damageCantBePrevented', 'sta.edhv42.damage.half.anySource']);
    const verbatim = C42.filter((t) => !oneWording.has(t.id)).flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !context.test(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
