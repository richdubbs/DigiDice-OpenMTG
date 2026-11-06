/**
 * Commander lane edh-misc, round edh-misc-2: the template data of parser/templates/zz-cloud/edh-misc-2.json ("put one of them onto the battlefield", "return it to the
 * command zone", "put ~ onto the battlefield from the command zone", "repeat the following process X times" with the sentence after it as the process) and the promotion of
 * sta.stdmana1.tapForMana.twice. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example
 * does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2).
 * Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in edh-misc-2-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/edh-misc-2.json';
import review from '../../m5/golden/cards/edh-misc-2-review.json';
import manaReview from '../../m5/golden/cards/cloud-std-mana-1-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
/** The synthetic card an example is an ability of: a trigger or an activated ability of a creature, a spell (with {X} in its cost for the repeat) otherwise. */
const cardOf = (id: string, text: string) => {
  if (id === 'eff.edhx2.repeatFollowing') return card('Example Storm', 'Sorcery', text, { mana_cost: '{X}{B}' });
  if (id === 'eff.edhx2.return.commandZone') return card('Example Recall', 'Instant', text);
  return card('Example Advisor', 'Creature — Advisor', text, { power: '1', toughness: '1' });
};
const parse = (id: string, text: string) => parseCard(cardOf(id, text), OPTS).faces[0]!;
type Golden = { card: string; verified: string; expect?: string }[];
const golden = review as Golden;

describe('edh-misc-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-misc-2.json, after edh-misc-1, before edh-perms-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-misc-2.json');
    expect(files.indexOf('zz-cloud/edh-misc-2.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-misc-1.json'));
    expect(files.indexOf('zz-cloud/edh-misc-2.json')).toBeLessThan(files.indexOf('zz-cloud/edh-perms-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.edhx2.*', () => {
    expect(MECH.map((t) => t.id)).toEqual(['eff.edhx2.put.oneOfThem.bf', 'eff.edhx2.return.commandZone', 'eff.edhx2.repeatFollowing', 'eff.edhx2.put.self.command.battlefield']);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.edhx2\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 deviation (guide section 5, "Narrow wordings"): each template is stable on the one card of the EDHREC top 5,000 that prints its wording, golden and played', () => {
    const by = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id})`) || g.verified.includes(`(${id},`) || g.verified.includes(` ${id},`) || g.verified.includes(` ${id})`)).map((g) => g.card).sort();
    expect(by('eff.edhx2.put.oneOfThem.bf')).toEqual(['Colossal Grave-Reaver']);
    expect(by('eff.edhx2.return.commandZone')).toEqual(['Hellkite Courser']);
    expect(by('eff.edhx2.repeatFollowing')).toEqual(['Torment of Hailfire']);
    expect(by('eff.edhx2.put.self.command.battlefield')).toEqual(['Derevi, Empyrial Tactician']);
    for (const t of MECH) expect(t.status, t.id).toBe('stable');
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('the promotion of this round: sta.stdmana1.tapForMana.twice is stable on its one golden card, Mana Reflection (6.9 narrow wording, named in the record)', () => {
    const t = TEMPLATE_SET.find((x) => x.id === 'sta.stdmana1.tapForMana.twice');
    expect(t?.status).toBe('stable');
    expect((manaReview as Golden).filter((g) => g.verified.includes('(sta.stdmana1.tapForMana.twice')).map((g) => g.card)).toEqual(['Mana Reflection']);
    expect(TEMPLATE_SET.find((x) => x.id === 'sta.stdmana1.tapForMana.threeTimes')?.status).toBe('stable');
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

describe('edh-misc-2 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parse(t.id, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parse(t.id, e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parse(t.id, c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\bone of them\b/, 'each of them'], [/\bone of them\b/, 'two of them'], [/\bcommand zone\b/, 'graveyard'], [/\bthe following process\b/, 'this process'], [/\bfrom the command zone\b/, 'from your hand'],
    [/\bto the command zone\b/, 'to the battlefield'], [/\bonto the battlefield\b/, 'into your hand'], [/\bthree times\b/, 'once'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}
describe('edh-misc-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parse(t.id, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parse(t.id, m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('edh-misc-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parse(t.id, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('edh-misc-2 weak readings and neighbours (design 6.3 rule 2): the specific wordings keep their templates', () => {
  it('"put a commander ... from the command zone onto the battlefield" is the choice template\'s, "repeat this process" the r4-mech one', () => {
    expect(parse('x', 'When this creature enters, you may put a commander you own from the command zone onto the battlefield.').templatesUsed).toContain('ch.put.fromHand');
    expect(parseCard(card('Example Echo', 'Sorcery', 'Draw a card. Repeat this process once.'), OPTS).faces[0]!.templatesUsed).toContain('eff.r4mech.repeatProcess');
  });
  it('"Repeat the following process" with no sentence after it, or one that has its own target, stays manual', () => {
    const alone = parseCard(card('Example Storm', 'Sorcery', 'Repeat the following process three times.', { mana_cost: '{X}{B}' }), OPTS).faces[0]!;
    expect(fullyAutomated(alone)).toBe(false);
    const targeted = parseCard(card('Example Storm', 'Sorcery', 'Repeat the following process three times. Destroy target creature.', { mana_cost: '{X}{B}' }), OPTS).faces[0]!;
    expect(fullyAutomated(targeted)).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-misc-2 design 6.10 (local index): synthetic examples', () => {
  it('no edh-misc-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
