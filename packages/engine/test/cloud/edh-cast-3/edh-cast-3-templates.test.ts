/**
 * Commander lane edh-cast, round edh-cast-3: the template data of parser/templates/zz-cloud/edh-cast-3.json ("creature spells you cast cost {1} less to cast for each 1 life
 * your opponents have lost this turn", "each opponent can cast spells only any time they could cast a sorcery", "until your next turn, you may cast sorcery spells as though they
 * had flash", "each player who has cast a nonartifact spell this turn can't cast additional nonartifact spells") and the parser, renderer and engine changes of the round (one test
 * each at the end). Guard G9 (design 6.8): every example lowers
 * with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ;
 * a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when
 * it is present. The behavior is in edh-cast-3-scenarios.test.ts. CR cites checked against the Comprehensive Rules 2026-09-25 (media.wizards.com), see the record.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhCast3 from '../../../src/parser/templates/zz-cloud/edh-cast-3.json';
import review from '../../m5/golden/cards/edh-cast-3-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhCast3 as Template[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'cm.edhc3.spells.less.forEach.qty': ['Rakdos, Lord of Riots'],
  'rst.edhc3.player.cast.onlySorcerySpeed': ['Teferi, Time Raveler'],
  'eff.edhc3.flash.dur': ['Teferi, Time Raveler'],
  'rst.edhc3.player.cant.cast.additionalKind': ['Ethersworn Canonist'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (an instant); the others are abilities of a creature (static, activated, triggered; "~ gains" needs a creature). */
const SPELL = new Set<string>(['eff.edhc3.flash.dur']);
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Plan', 'Sorcery', text), OPTS) : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-cast-3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-cast-3.json, path order: after cmd5 and edh-cast-1, before look3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-cast-3.json');
    expect(files.indexOf('zz-cloud/edh-cast-3.json')).toBeGreaterThan(files.indexOf('zz-cloud/cmd5.json'));
    expect(files.indexOf('zz-cloud/edh-cast-3.json')).toBeLessThan(files.indexOf('zz-cloud/look3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.edhc3.* (or sta., cm.)', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm|rst)\.edhc3\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) for (const n of NARROW[t.id]!) expect(cards, t.id).toContain(n);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review as { card: string; expect?: string }[]) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-cast-3 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(t, c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} until end of turn.`];
  const swaps: [RegExp, string][] = [
    [/\bless\b/, 'more'], [/\bopponents\b/, 'creatures'], [/\bonly\b/, 'also'], [/\bsorcery\b/, 'instant'], [/\bcan't\b/, 'can'], [/\bflash\b/, 'haste'],
    [/\byour next turn\b/, 'end of turn'], [/\bcast additional\b/, 'activate additional'], [/\blost\b/, 'gained'], [/\bhas cast\b/, 'has activated'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-cast-3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able/until end of turn" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(t, m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('edh-cast-3 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any word (CR 122.1): "a blorfty counter" is a counter kind, not nonsense
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-cast-3 design 6.10 (local index): synthetic examples', () => {
  it('no edh-cast-3 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

describe('edh-cast-3 parser, renderer and engine changes (one test each)', () => {
  const face = (text: string, type = 'Creature — Golem', name = 'Example Relic') => parseCard(card(name, type, text, type.startsWith('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
  it('parser/holes/qty.ts, model/types (CR 109.4, 601.2f): "the greatest number of <things> an opponent controls" is the most ONE opponent controls (q mostByController); the plural "your opponents control" is a total and stays manual', () => {
    const f = face('This spell costs {X} less to cast, where X is the greatest number of artifacts an opponent controls.', 'Creature — Dragon');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"q":"mostByController"');
    expect(fullyAutomated(face('This spell costs {X} less to cast, where X is the greatest number of artifacts your opponents control.', 'Creature — Dragon'))).toBe(false);
    expect(fullyAutomated(face('This spell costs {X} less to cast, where X is the greatest number of artifacts you control.', 'Creature — Dragon'))).toBe(false);
  });
  it('parser/holes/qty.ts, render/qty.ts, statics/match.ts (CR 119.3, 601.2f): the life all the opponents lost this turn is one added-up quantity (q lifeLostTotal); "you" and "an opponent" are not that reading', () => {
    const f = face('This spell costs {1} less to cast for each 1 life your opponents have lost this turn.', 'Creature — Dragon');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"q":"lifeLostTotal"');
    expect(fullyAutomated(face('This spell costs {1} less to cast for each 1 life you have lost this turn.', 'Creature — Dragon'))).toBe(false);
  });
  it('parser/holes/qty.ts, render/qty.ts, statics/match.ts (CR 120.1, 601.2f): "the total amount of noncombat damage dealt to your opponents this turn" adds up the damage (sum of amounts, combat: false); combat damage and damage of any kind have their own wordings', () => {
    const w = (kind: string): string => `This spell costs {X} less to cast, where X is the total amount of ${kind}damage dealt to your opponents this turn.`;
    const f = face(w('noncombat '), 'Creature — Dragon');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"combat":false');
    expect(JSON.stringify(f.abilities)).toContain('"sum":"amount"');
    expect(JSON.stringify(face(w('combat '), 'Creature — Dragon').abilities)).toContain('"combat":true');
    expect(fullyAutomated(face(w(''), 'Creature — Dragon'))).toBe(true);
    expect(fullyAutomated(face(w('noncombat ').replace('your opponents', 'you'), 'Creature — Dragon'))).toBe(false);
  });
  it('types/ability.ts, statics/hooks.ts, rules/timing.ts (CR 117.1a, 101.2): the rule castAtInstantSpeed is a capability of its own; a "can cast spells only during combat" is another wording and stays manual', () => {
    expect(ENGINE_CAPABILITIES.has('rule:castAtInstantSpeed')).toBe(true);
    const f = face('Each opponent can cast spells only any time they could cast a sorcery.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"action":"castAtInstantSpeed"');
    expect(fullyAutomated(face('Each opponent can cast spells only during combat.'))).toBe(false);
  });
  it('render/stat.ts (CR 601.2i; family cant-cast-additional-kind): a limit of one spell of a kind each turn is also said as the additional casts; the kind named twice must be one kind', () => {
    expect(fullyAutomated(face("Each player can't cast more than one artifact spell each turn."))).toBe(true);
    expect(fullyAutomated(face("Each player who has cast an artifact spell this turn can't cast additional artifact spells."))).toBe(true);
    expect(fullyAutomated(face("Each player who has cast an artifact spell this turn can't cast additional creature spells."))).toBe(false);
    expect(fullyAutomated(face("Each opponent who has cast an artifact spell this turn can't cast additional artifact spells."))).toBe(false);
  });
  it('statics/match.ts, effects/eval.ts (CR 120.1): a static quantity that sums damage carries `sum: amount` (statics/match.ts passes it on; the played proof of 3 + 2 damage = 5 is in the scenarios file)', () => {
    const f = face('This spell costs {X} less to cast, where X is the total amount of noncombat damage dealt to your opponents this turn.', 'Creature — Dragon');
    expect(JSON.stringify(f.abilities)).toContain('"sum":"amount"');
  });
});
