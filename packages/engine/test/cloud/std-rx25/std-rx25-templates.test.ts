/**
 * std-rx25 (wave 2, EDH lane rx25): the template data of parser/templates/zz-cloud/std-rx25.json and the round's parser, renderer and engine support: the
 * adamant condition "at least N <color> mana was spent to cast ~" (parser/holes/cond.ts#adamant); "pays {X}, where X is ..." (render/costs.ts, family
 * pays-x-where); "<player> draws X cards and loses X life, where X is ..." for another player (render/fold.ts#letLifeDrawWhereX); one reference to two players
 * exchanging life totals (render/steps-zones.ts, effects/handlers/zones-status.ts#exchange); "~ or another artifact creature" (render/evt.ts#selfOrAnother,
 * family self-or-another). Guard G9 (design 6.8): every example lowers with its template and passes the exact render gate (G6); every counter-example does not
 * parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2).
 * Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-rx25-scenarios.test.ts. CR cites
 * from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRx25 from '../../../src/parser/templates/zz-cloud/std-rx25.json';
import review from '../../m5/golden/cards/cloud-std-rx25-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RX25 = stdRx25 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on: an artifact for an activated ability, a creature for a trigger, else a sorcery. */
const typeOf = (text: string): string =>
  /\{T\}:/.test(text) ? 'Artifact' : /^(Whenever|When|At)\b/m.test(text) ? 'Creature — Beast' : 'Sorcery';
const face = (text: string, typeLine?: string) => {
  const type = typeLine ?? typeOf(text);
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const level = (type: string, text: string): string =>
  compileCard({ name: 'Example Relic', layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard).automation.level;

const IDS = [
  'trg.stdrx25.you.cycle.another',
  'wrap.stdrx25.payelse.xWhere',
  'eff.stdrx25.playerDrawsLoses.whereX',
  'eff.stdrx25.exchange.lifeTotals.twoTargets',
  'eff.stdrx25.may.have.exchange.lifeTotals',
];

describe('std-rx25 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rx25.json, after zz-cloud/std-rx18.json, before zz-cloud/std-rx3.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rx25.json');
    expect(files.indexOf('zz-cloud/std-rx25.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rx18.json'));
    expect(files.indexOf('zz-cloud/std-rx25.json')).toBeLessThan(files.indexOf('zz-cloud/std-rx3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(RX25.map((t) => t.id)).toEqual(IDS);
    for (const t of RX25) {
      expect(t.id, t.id).toMatch(/^(eff|trg|wrap)\.stdrx25\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // three or more hand-verified golden cards (design 6.9 met)
    expect(goldenUsing('wrap.stdrx25.payelse.xWhere')).toEqual(['Spell Rupture', 'Rethink', 'Lilting Refrain', 'Mausoleum Wanderer']);
    // narrow wordings, stable on one or two hand-verified golden cards plus these tests and the scenarios: a 6.9 deviation named in the round record and the PR
    expect(goldenUsing('trg.stdrx25.you.cycle.another')).toEqual(['Flourishing Fox', 'Drannith Stinger']);
    expect(goldenUsing('eff.stdrx25.playerDrawsLoses.whereX')).toEqual(['Eldritch Pact', 'Pact of the Serpent']);
    expect(goldenUsing('eff.stdrx25.exchange.lifeTotals.twoTargets')).toEqual(['Soul Conduit']);
    expect(goldenUsing('eff.stdrx25.may.have.exchange.lifeTotals')).toEqual(['Axis of Mortality']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of RX25) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'next', 'then', 'when', 'also', 'whenever']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-rx25 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of RX25) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
        expect(fullyAutomated(f), e.text).toBe(true);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = face(c, typeOf(t.examples[0]!.text));
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
    [/cycle another card/, 'cycle another creature card'], [/^Whenever you/, 'Whenever an opponent'], [/unless/, 'if'], [/pays \{X\}/, 'pays X life'],
    [/loses X life/, 'gains X life'], [/draws X cards/, 'discards X cards'], [/exchange life totals/, 'exchange hands'], [/two target players/, 'target player and you'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rx25 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of RX25) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = face(m, typeOf(e.text));
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-rx25 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of RX25) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.length - 1; // the line of the template (an earlier line is a keyword of the card)
        const words = lines[last]!.split(' ');
        words.forEach((w, i) => {
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...lines.slice(0, last), [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ')].join('\n');
          expect(understood(face(mutated, typeOf(e.text))), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-rx25 parser, renderer and engine support (G6: the render gate is exact; each new reading is one reviewed alternative)', () => {
  it('parser/holes/cond.ts#adamant (CR 601.2h): "if at least three <color> mana was spent to cast ~" is wasCast.spent; without "at least" it stays manual', () => {
    const f = face('Draw a card. If at least three green mana was spent to cast this spell, draw a card.');
    expect(understood(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"cond":{"cond":"wasCast","spent":{"color":"G","atLeast":3}}');
    expect(level('Sorcery', 'Draw a card. If three green mana was spent to cast this spell, draw a card.')).not.toBe('full');
  });
  it('render/costs.ts (family pays-x-where): "pays {X}, where X is Q" and "pays mana equal to Q" are the same payment', () => {
    for (const text of ['Counter target spell unless its controller pays {X}, where X is the number of cards in your hand.', 'Draw a card. Then counter target spell unless its controller pays mana equal to the number of cards in your hand.']) {
      const f = face(text, 'Instant');
      expect(understood(f), text).toBe(true);
      expect(JSON.stringify(f.abilities), text).toContain('"times":{"q":"zoneSize","zone":"hand","of":{"ref":"you"}}');
    }
  });
  it('render/fold.ts#letLifeDrawWhereX (CR 608.2h): another single player draws and loses the same fixed X; "their" names that player; different amounts do not fold', () => {
    const f = face('Target player draws X cards and loses X life, where X is the number of cards in their hand.');
    expect(understood(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"value":{"q":"zoneSize","zone":"hand","of":{"ref":"target","id":"t0"}}');
    expect(understood(face('Target player draws X cards and loses 2 life, where X is the number of cards in their hand.'))).toBe(false);
  });
  it('render/steps-zones.ts + effects/handlers/zones-status.ts (CR 701.12c): one reference to exactly two target players exchanges their life totals; one target player or "up to two" fails closed', () => {
    expect(level('Artifact', '{T}: Two target players exchange life totals.')).toBe('full');
    expect(level('Artifact', '{T}: Target player exchange life totals.')).not.toBe('full');
    expect(level('Artifact', '{T}: Up to two target players exchange life totals.')).not.toBe('full');
  });
  it('render/evt.ts#selfOrAnother (family self-or-another): "~ or another artifact creature dies" only on an artifact creature; on a plain creature it fails closed', () => {
    expect(level('Artifact Creature — Insect', 'Whenever this creature or another artifact creature dies, you gain 1 life.')).toBe('full');
    expect(level('Creature — Insect', 'Whenever this creature or another artifact creature dies, you gain 1 life.')).not.toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-rx25 design 6.10 (local index): synthetic examples', () => {
  it('no std-rx25 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    // (a line that is only a keyword ability, "Flash", "Enchant creature", gives the example its card type and is not the template's)
    const context = /^(Flash|Flying|Enchant creature)$/;
    const verbatim = RX25.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !context.test(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
