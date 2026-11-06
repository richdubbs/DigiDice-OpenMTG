/**
 * Commander lane edh-perms, round edh-perms-23: the template data of parser/templates/zz-cloud/edh-perms-23.json ("each other <permanents> you control becomes a copy of
 * <object>" with no duration) and the round's parser and engine changes ("that token" after a choice, "that token" in an "if", an X announced for "Tap X untapped
 * tokens you control" in a mana ability), tested at the end of this file and in edh-perms-23-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. CR cites checked against the Comprehensive Rules of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { instantiate, validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhPm23 from '../../../src/parser/templates/zz-cloud/edh-perms-23.json';
import review from '../../m5/golden/cards/edh-perms-23-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhPm23 as Template[];
const MECH_COUNT = 1;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards of the EDHREC top 5,000 (or elsewhere only on cards out of reach), with their template tests (G9, G2) and played scenarios. Listed in
 * the round's record for the owner (DECIDED BY DEFAULT, owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhpm23.eachOther.becomeCopy.noDur': ['Brudiclad, Telchor Engineer'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind (a trigger or "{cost}:" is a permanent's, an effect on its own a spell's). */
function exampleCard(text: string): OracleCard {
  if (/^(when|whenever|at) /i.test(text)) return card('Example Engine', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' });
  if (/^\{[^}]*\}[^:]*:/.test(text)) return card('Example Relic', 'Artifact', text);
  return card('Example Volley', 'Sorcery', text);
}
const parsedWith = (_t: Template, text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;

describe('edh-perms-23 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-perms-23.json, path order: after edh-perms-22, before edh-perms-3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-perms-23.json');
    expect(files.indexOf('zz-cloud/edh-perms-23.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-perms-22.json'));
    expect(files.indexOf('zz-cloud/edh-perms-23.json')).toBeLessThan(files.indexOf('zz-cloud/edh-perms-3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids end with the round code edhpm23', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid)\.edhpm23\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the cards that print the wording', () => {
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

describe('edh-perms-23 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/each other/, 'each'], [/ becomes a copy of /, ' becomes a token copy of '], [/you control/, 'an opponent controls'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-perms-23 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-perms-23 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter kind is any word (Oracle invents them)
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

describe.skipIf(index === null)('edh-perms-23 design 6.10 (local index): synthetic examples', () => {
  it('no edh-perms-23 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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


describe('edh-perms-23 parser, lowering, renderer and engine changes (one test each)', () => {
  const act = (text: string, type = 'Artifact') => parseCard(card('Example Relic', type, text), OPTS).faces[0]!;
  it('lower/anaphora.ts (CR 608.2c, 111.1): "that token" in an "if" is the target token, not the copy made of it; with a wildcard target or outside a condition it stays ambiguous', () => {
    const hazel = (cond: string) => parseCard(card('Example Squirrel', 'Creature — Squirrel', `At the beginning of your end step, create a token that's a copy of target token you control. ${cond}`, { power: '1', toughness: '1' }), OPTS).faces[0]!;
    expect(fullyAutomated(hazel('If that token is a Squirrel, instead create two tokens that are copies of it.'))).toBe(true);
    expect(fullyAutomated(hazel('That token gains haste until end of turn.'))).toBe(false);
    const any = parseCard(card('Example Squirrel', 'Creature — Squirrel', "At the beginning of your end step, create a token that's a copy of target permanent you control. If that token is a Squirrel, instead create two tokens that are copies of it.", { power: '1', toughness: '1' }), OPTS).faces[0]!;
    expect(fullyAutomated(any)).toBe(false);
  });
  it('lower/anaphora.ts (CR 608.2c): "that token" after a choice among tokens is the chosen token, not the one created before; a choice of something that is not a token does not make it so', () => {
    const brud = (text: string) => parseCard(card('Example Engineer', 'Creature — Construct', `At the beginning of combat on your turn, create a Treasure token. ${text}`, { power: '2', toughness: '2' }), OPTS).faces[0]!;
    expect(fullyAutomated(brud('Then you may choose a token you control. If you do, each other token you control becomes a copy of that token.'))).toBe(true);
    expect(fullyAutomated(brud('Then you may choose a token you control. If you do, put a +1/+1 counter on that token.'))).toBe(true);
    expect(fullyAutomated(brud('Then you may choose a creature you control. If you do, each other token you control becomes a copy of that token.'))).toBe(false); // a chosen creature is not "that token": the created token is, but "each other" then means other than the creature
  });
  it('rules/mana.ts#counterXPart + rules/pay.ts#maxX + model/cap-walk.ts (CR 107.3a, 605.3b): X of "Tap X untapped tokens you control" is announced as the mana ability is activated; X in the cost of any other kind stays a gap', () => {
    const ok = act('{T}, Tap X untapped tokens you control: Add X mana in any combination of colors.', 'Creature — Squirrel');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"kind":"tapUntapped"');
    expect(JSON.stringify(ok.abilities)).toContain('"isMana":true');
    const draw = act('{T}, Tap X untapped tokens you control: Draw X cards.', 'Creature — Squirrel'); // not a mana ability: announced like any X
    expect(fullyAutomated(draw)).toBe(true);
    expect(JSON.stringify(draw.abilities)).not.toContain('"isMana":true');
  });
});
