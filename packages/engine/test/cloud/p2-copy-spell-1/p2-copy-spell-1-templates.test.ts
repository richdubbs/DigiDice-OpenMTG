/**
 * Lane p2-copy-spell, round p2-copy-spell-1: the template data of parser/templates/zz-cloud/p2-copy-spell-1.json ("<player> may copy this spell and may choose a
 * new target for that copy", the Chain spells), and the round's parser and renderer changes: lower/mentions.ts (the controller of a target whose option or optional
 * payment an instruction is, "they" afterwards), render/steps-flow.ts#mayClause ("they may ..."), render/steps-zones.ts#copyNewTargets (the copier's own "and may
 * choose new targets / a new target for the copy").
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in p2-copy-spell-1-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/p2-copy-spell-1.json';
import review from '../../m5/golden/cards/cloud-p2-copy-spell-1-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const MECH_COUNT = 1;
const golden = review as { card: string; verified: string; expect?: string }[];
const evidence = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`)).map((g) => g.card);
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (an instant); the others are abilities of a creature (static, activated, triggered; "~ gains" needs a creature). */
const SPELL = new Set<string>(['eff.p2copyspell1.playerMayCopySelf.newTargets']);
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Plan', 'Sorcery', text), OPTS) : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('p2-copy-spell-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-copy-spell-1.json, after p2-copy-perm-1, before p2-counters-state-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-copy-spell-1.json');
    expect(files.indexOf('zz-cloud/p2-copy-spell-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/p2-copy-perm-1.json'));
    expect(files.indexOf('zz-cloud/p2-copy-spell-1.json')).toBeLessThan(files.indexOf('zz-cloud/p2-counters-state-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.p2copyspell1.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.p2copyspell1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards', () => {
    for (const t of MECH.filter((x) => x.status === 'stable')) expect(evidence(t.id).length, t.id).toBeGreaterThanOrEqual(3);
    expect(MECH.every((t) => t.status === 'stable')).toBe(true);
    for (const g of golden) expect(g.expect, g.card).toBe('full');
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

describe('p2-copy-spell-1 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bmay copy\b/, 'copies'], [/\bthis spell\b/, 'target spell'], [/\bthat copy\b/, 'those copies'], [/\bthe copy\b/, 'the copies'], [/\band may choose\b/, 'and choose'],
    [/\bThat player\b/, 'Each player'], [/\bIts controller\b/, 'Each opponent'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-copy-spell-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('p2-copy-spell-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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
          const f = parsedWith(t, mutated);
          // a cost part the model cannot state is no `op: manual` (it is a manual cost part): the card is partial, so it counts as not automated here
          expect(fullyAutomated(f) && !JSON.stringify(f.abilities).includes('"kind":"manual"'), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('p2-copy-spell-1 design 6.10 (local index): synthetic examples', () => {
  it('no p2-copy-spell-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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


describe('p2-copy-spell-1 parser and renderer changes (one test each)', () => {
  const sorcery = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
  it('lower/mentions.ts (CR 608.2c, 608.2d): the controller of a target whose option an instruction is, is "they" afterwards; also after an optional payment', () => {
    const may = sorcery("Tap target creature. Then that creature's controller may sacrifice a land of their choice. If the player does, they may draw a card.");
    expect(fullyAutomated(may), JSON.stringify(may.diagnostics)).toBe(true);
    const pay = sorcery("Tap target creature. Then that creature's controller may pay {2}. If the player does, they may draw a card.");
    expect(fullyAutomated(pay), JSON.stringify(pay.diagnostics)).toBe(true);
  });
  it('render/steps-flow.ts#mayClause (family they-may): "they may ..." for a player named before', () => {
    expect(fullyAutomated(sorcery("Tap target creature. Then that creature's controller may pay {2}. If the player does, they may draw a card."))).toBe(true);
  });
  it('render/steps-zones.ts#copyNewTargets (family copy-and-may-choose-new-target, CR 707.10c): the copier chooses; another player\'s copy is never "you may choose"', () => {
    expect(fullyAutomated(sorcery('Target player loses 1 life. That player may copy this spell and may choose a new target for that copy.'))).toBe(true);
    expect(fullyAutomated(sorcery('Target player loses 1 life. That player may copy this spell. You may choose new targets for the copy.'))).toBe(false);
  });
});
