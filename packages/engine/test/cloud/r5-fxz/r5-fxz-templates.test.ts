/**
 * Standard round 5, slice r5-fxz (one-shot effects on cards, zones and players; both halves of the Standard cards): the template
 * data of parser/templates/zz-cloud/r5-fxz.json and the parser, lowering and renderer support they needed. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6);
 * every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never
 * leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * r5-fxz-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { CRITICAL_WORDS } from '../../../src/parser/lower/units';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import r5Fxz from '../../../src/parser/templates/zz-cloud/r5-fxz.json';
import review from '../../m5/golden/cards/cloud-r5-fxz-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const R5 = r5Fxz as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/**
 * A synthetic card in which an example is an ability of the right kind: a spell on a sorcery (an instant when it says "this spell"), a Saga chapter on a Saga, an
 * activated ability from the hand on a land, a planeswalker ability on a planeswalker, anything else on a creature.
 */
function exampleCard(t: Template, text: string): OracleCard {
  // a spell that says X without defining it has X in its mana cost (CR 107.3)
  if (/\bX\b/.test(text) && !/where X is/.test(text) && t.kind === 'effect' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text, { mana_cost: '{X}{U}' });
  if (/^I+ —/.test(text)) return { ...card('Example Saga', 'Enchantment — Saga', `(As this Saga enters and after your draw step, add a lore counter.)\n${text}`), layout: 'saga' } as OracleCard;
  if (/from your hand onto the battlefield\./.test(text) && text.includes(':')) return card('Example Grove', 'Land', text);
  if (/\bthis spell\b/i.test(text)) return card('Example Volley', 'Instant', text);
  if (t.kind === 'effect' && !text.includes(':') && !text.includes('~') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('r5-fxz template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/r5-fxz.json, after r4-fxz.json, before std-blb.json and zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/r5-fxz.json');
    expect(files.indexOf('zz-cloud/r5-fxz.json')).toBeGreaterThan(files.indexOf('zz-cloud/r4-fxz.json'));
    expect(files.indexOf('zz-cloud/r5-fxz.json')).toBeLessThan(files.indexOf('zz-cloud/std-blb.json'));
    expect(files.indexOf('zz-cloud/r5-fxz.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.r5fxz.*', () => {
    expect(R5.length).toBeGreaterThan(0);
    for (const t of R5) {
      expect(t.id, t.id).toMatch(/^(eff|sta|dl|kw|trg|rid)\.r5fxz\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a template is stable when its examples, counter-examples and render gate pass (G9 below); the golden review cards are hand-verified and pinned full, and every template id they name exists', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    expect(golden.length).toBeGreaterThan(0);
    const ids = new Set(R5.map((t) => t.id));
    for (const g of golden) {
      expect(g.expect, g.card).toBe('full');
      for (const id of g.verified.match(/\b(?:eff|sta|dl|kw|trg|rid)\.r5fxz\.[A-Za-z0-9.]*[A-Za-z0-9]/g) ?? []) expect(ids.has(id), `${g.card}: ${id}`).toBe(true);
    }
  });
  it('guard G3: a critical word or phrase a pattern spells out (parser/lower/units.ts#CRITICAL_WORDS) is listed in `consumes`', () => {
    for (const t of R5) {
      const literal = ` ${t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ')} `;
      for (const w of CRITICAL_WORDS) if (literal.includes(` ${w} `)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('r5-fxz guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of R5) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        // an experimental template whose wording the stable templates also lower to the same result gives way to them (design 6.9, G10: the "experimental" info
        // diagnostic names it)
        const fellBack = t.status === 'experimental' && f.diagnostics.some((d) => d.code === 'experimental' && d.message.includes(t.id));
        expect(f.templatesUsed.includes(t.id) || fellBack, `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
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

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = text.includes('\n') ? [] : [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\btarget opponent\b/, 'each opponent'], [/\btarget player\b/, 'each player'], [/\bany number of\b/, 'two'], [/\buntil end of turn\b/i, 'until your next turn'],
    [/\bdouble\b/i, 'triple'], [/\btriple\b/i, 'double'], [/\bgains\b/, 'loses'], [/\bodd or even\b/, 'a color'], [/\btapped and attacking\b/, 'tapped'],
    [/\ban opponent's control\b/, "its owner's control"], [/\bmay\b/, 'must'], [/\bscries\b/, 'surveils'], [/\bearthbend\b/, 'airbend'], [/\bX times\b/, 'twice'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('r5-fxz guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of R5) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
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

describe('r5-fxz guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of R5) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '~,' || /^"?\{/.test(w) || w.includes('\n')) return;
          // the word before "counter(s)" is a counter kind, an open class (CR 122.1: any word names a kind of counter; as wp22-mutation.test.ts and r3-mech)
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return;
          const end = w.match(/[.,:"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('r5-fxz design 6.10 (local index): synthetic examples', () => {
  it('no r5-fxz line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = R5.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
