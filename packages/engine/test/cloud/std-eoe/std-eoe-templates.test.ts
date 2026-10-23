/**
 * Cloud batch 2, slice std-eoe (the Standard backlog of Edge of Eternities, tuning half): the template data of parser/templates/zz-cloud/std-eoe.json and the
 * renderer, lowering and engine support they needed. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate
 * (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example
 * never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * std-eoe-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdEoe from '../../../src/parser/templates/zz-cloud/std-eoe.json';
import review from '../../m5/golden/cards/cloud-std-eoe-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EOE = stdEoe as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a triggered, activated or static ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  // an X that no "where X is" defines is the spell's own X: the card has {X} in its cost (CR 107.3)
  const x = /\bX\b/.test(text) && !/\bwhere X is\b/.test(text) ? { mana_cost: '{X}{R}' } : {};
  if (t.kind === 'effect' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text, x);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('std-eoe template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-eoe.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-eoe.json');
    expect(files.indexOf('zz-cloud/std-eoe.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-eoe.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdeoe.*, trg.stdeoe.* or sta.stdeoe.*', () => {
    expect(EOE.length).toBe(12); // wave 3 merge: "mills half their library, rounded down" is Cloud std-fin's eff.stdfin.mill.halfLibraryRoundedDown (the same template, written twice);
    // "gain control of all <filter> <duration>" is std-tmt's eff.stdtmt.control.all (the same template with an optional duration; its examples moved there)
    for (const t of EOE) {
      expect(t.id, t.id).toMatch(/^(eff|trg|sta)\.stdeoe\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: at least one hand-verified golden card that uses it (the review file pins each card as full)', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of EOE.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      // two templates are read on cards the review pins by their sentences only (the cost with the shared name has no template of its own: it is the Cost hole)
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EOE) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-eoe guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EOE) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        // an experimental template whose wording the stable templates also lower to the same result gives way to them (design 6.9, G10: the "experimental" info
        // diagnostic names it): since std-otj, the player hole reads "<several target players> each" itself, so eff.mill / eff.loselife say the same
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
  const body = text.replace(/\.$/, '').replace(/\."$/, '"');
  const plain = text.endsWith('"') ? [] : [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const out = [...plain];
  const swaps: [RegExp, string][] = [
    [/\bfor each\b/, 'for any'], [/\bcreate a\b/, 'create two'], [/\btapped\b/, 'untapped'], [/\buntil end of turn\b/, 'until your next turn'], [/\bor more\b/, 'or fewer'],
    [/\bgains\b/, 'loses'], [/\bwhenever you\b/, 'whenever an opponent'], [/\bYou\b/, 'Target opponent'], [/\ball damage\b/, 'all combat damage'], [/\beach\b/, 'all'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-eoe guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EOE) {
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

describe('std-eoe guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EOE) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^"?\{/.test(w) || w.includes('\n')) return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const start = w.startsWith('"') ? '"' : '';
          const mutated = [...words.slice(0, i), `${start}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-eoe design 6.10 (local index): synthetic examples', () => {
  it('no std-eoe line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EOE.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
