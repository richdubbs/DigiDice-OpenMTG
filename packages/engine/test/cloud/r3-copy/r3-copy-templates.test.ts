/**
 * Standard round 3, slice r3-copy (copies and control, tuning half): the template data of parser/templates/zz-cloud/r3-copy.json and the parser, lowering and
 * renderer support they needed. Guard G9 (design 6.8): every example lowers with its template,
 * is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a
 * nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in r3-copy-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import r3Copy from '../../../src/parser/templates/zz-cloud/r3-copy.json';
import review from '../../m5/golden/cards/cloud-r3-copy-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const R3 = r3Copy as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a triggered, activated or static ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'effect' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Human Wizard', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
const face = (type: string, text: string) => parseCard(card('Example Brute', type, text, { power: '3', toughness: '3' }), OPTS).faces[0]!;
const spellFace = (text: string) => parseCard(card('Example Volley', 'Sorcery', text), OPTS).faces[0]!;

describe('r3-copy template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/r3-copy.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/r3-copy.json');
    expect(files.indexOf('zz-cloud/r3-copy.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/r3-copy.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.r3copy.* or rid.r3copy.*', () => {
    expect(R3.length).toBe(9); // Standard merge wave 5: eff.r3copy.forEachOther.copyToken folded into std-msh's eff.stdmsh.forEach.filter.copy (the same build)
    for (const t of R3) {
      expect(t.id, t.id).toMatch(/^(eff|rid)\.r3copy\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: at least one hand-verified golden card that uses it', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of R3.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of R3) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'tapped', 'attacking']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('r3-copy guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of R3) {
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

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\bfor each\b/, 'for any'], [/\btapped\b/, 'untapped'], [/\buntil end of turn\b/, 'until your next turn'], [/\bthis turn\b/, 'this game'], [/\bthat much\b/, 'twice that much'],
    [/\bwhenever you\b/, 'whenever an opponent'], [/\bYou\b/, 'Target opponent'], [/\ball\b/, 'each'], [/\bbottom\b/, 'top'], [/\bthat player\b/, 'you'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('r3-copy guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of R3) {
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

describe('r3-copy guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of R3) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^"?\{/.test(w) || w.includes('\n')) return;
          const end = w.match(/[.,:"]+$/)?.[0] ?? '';
          const start = w.startsWith('"') ? '"' : '';
          const mutated = [...words.slice(0, i), `${start}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('r3-copy design 6.10 (local index): synthetic examples', () => {
  it('no r3-copy line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Vehicle)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = R3.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

describe('r3-copy parser, lowering and renderer support', () => {
  it('CR 611.2a, 513.1: "until the next end step" is a duration of the Dur hole (whoever\'s turn it is: the next end step)', () => {
    const f = spellFace('Target creature gets +2/+2 until the next end step.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"duration":{"d":"untilNextStep","step":"end"}');
    expect(fullyAutomated(spellFace('Target creature gets +2/+2 until the next upkeep.'))).toBe(true);
    expect(fullyAutomated(spellFace('Target creature gets +2/+2 until the next end.'))).toBe(false);
  });
  it('CR 110.1: a target permanent of no stated card type is never "that spell": "that spell" is the spell the trigger saw', () => {
    const f = face('Land', 'Whenever you cast a creature spell, up to one other target permanent you control becomes a copy of that spell until end of turn.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"copyOf":{"ref":"event","role":"spell"}');
  });
  it('CR 707.2, 611.2c: several objects each become a copy, "become copies of" (the render gate accepts the plural)', () => {
    const f = face('Creature — Human Wizard', '{T}: Exile target creature you control. Artifacts you control become copies of it until end of turn.');
    expect(f.gate.every((g) => g.ok), JSON.stringify(f.gate)).toBe(true);
    expect(automated(f.abilities)).toBe(true);
  });
  it('CR 707.9b: a list of exceptions says its subject once ("it isn\'t legendary, is a Spirit in addition to its other types, and has haste")', () => {
    const two = spellFace("Create a token that's a copy of target creature you control, except it isn't legendary and is a Spirit in addition to its other types.");
    const three = spellFace("Create a token that's a copy of target creature you control, except it isn't legendary, is a Spirit in addition to its other types, and has haste.");
    expect(two.gate.every((g) => g.ok), JSON.stringify(two.gate)).toBe(true);
    expect(three.gate.every((g) => g.ok), JSON.stringify(three.gate)).toBe(true);
    // the subject said once is said of the first exception: a list with no subject at all is no copy wording
    expect(fullyAutomated(spellFace("Create a token that's a copy of target creature you control, except isn't legendary and is a Spirit in addition to its other types."))).toBe(false);
  });
  it('CR 707.9a, 201.5: the object that becomes a copy of something else is named "~" in its exception ("except ~ has hexproof"), only when it is the card itself', () => {
    expect(face('Creature — Human Wizard', '{1}: ~ becomes a copy of target creature until end of turn, except ~ has flying.').gate.every((g) => g.ok)).toBe(true);
    const other = spellFace('Target creature you control becomes a copy of another target creature until end of turn, except ~ has flying.');
    expect(fullyAutomated(other)).toBe(false);
  });
});
