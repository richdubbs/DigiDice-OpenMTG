/**
 * Commander lane copy, round edh-next-57: the template data of parser/templates/zz-cloud/edh-next-57.json ("you create a token that's a copy of X, except it's a Tyranid in addition to its other
 * types", Genestealer Patriarch; "create a tapped and attacking token that's a copy of X, except ...", Shaun, Loki; "that player copies that spell for each other X that spell could
 * target", Mirrorwing Dragon, Precursor Golem; "{X}: This creature has base power and toughness X/X." with no duration, Gigantoplasm; "For each of those creatures, create a token that's
 * a copy of that creature", Hate Mirage, Kindred Charge) and the parser, renderer and engine changes of the round (one test each at the end). Guard G9 (design 6.8): every example lowers
 * with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense
 * word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The
 * behavior is in edh-next-57-scenarios.test.ts. CR cites from the Comprehensive Rules text of 2026-09-25 unless the record names them.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhNext57 from '../../../src/parser/templates/zz-cloud/edh-next-57.json';
import review from '../../m5/golden/cards/edh-next-57-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext57 as Template[];
const MECH_COUNT = 7;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only one
 * or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (decided by the owner's standing rule 2026-10-27).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27, more cards 2026-10-30)
  'eff.edhn57.copyToken.player.except': ['Genestealer Patriarch'],
  'eff.edhn57.copyToken.tappedAttacking.except': ['Shaun, Father of Synths'],
  'eff.edhn57.copyToken.tappedAttacking.notLegendary.subtype': ['Loki, the Deceiver'],
  'eff.edhn57.player.copies.forEach.couldTarget': ['Mirrorwing Dragon', 'Precursor Golem'],
  'eff.edhn57.cont.base.noDuration': ['Gigantoplasm'],
  'eff.edhn57.forEachOfThem.copyToken': ['Hate Mirage'],
  'eff.edhn57.copyToken.tappedAttacking.linkedExiled.subtype': ['Phantom Steed'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (a sorcery); the others are abilities of a creature (static, triggered, activated). */
const SPELL = new Set<string>(['eff.edhn57.forEachOfThem.copyToken']);
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) || (t.id === 'eff.edhn57.copyToken.player.except' && !/^whenever/i.test(text))
    ? parseCard(card('Example Plan', 'Sorcery', text), OPTS)
    : parseCard(card('Example Relic', 'Legendary Artifact Creature — Golem Villain', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-next-57 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-57.json, path order: after edh-next-5, before edh-next-6) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-57.json');
    expect(files.indexOf('zz-cloud/edh-next-57.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-5.json'));
    expect(files.indexOf('zz-cloud/edh-next-57.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-6.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are eff.edhn57.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm|rst|trg)\.edhn57\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
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

describe('edh-next-57 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bor more\b/, 'or less'], [/\bhaste\b/, 'flying'], [/\btop\b/, 'bottom'], [/\bonce\b/i, 'twice'], [/\bcast\b/, 'exile'], [/\bwithout paying its mana cost\b/, 'by paying its mana cost'], [/\bor less\b/, 'or more'], [/\bplay\b/, 'cast'], [/\battacked\b/, 'blocked'], [/\bspell\b/, 'ability'], [/\blife\b/, 'cards'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-57 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-57 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (words.includes('--') && i < words.indexOf('--')) return; // the ability word before the dash has no rules meaning (CR 207.2c)
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

describe.skipIf(index === null)('edh-next-57 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-57 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-next-57 parser, renderer and engine changes (one test each)', () => {
  const face = (text: string, type = 'Sorcery', name = 'Example Plan') => parseCard(card(name, type, text), OPTS).faces[0]!;
  const creature = (text: string) => parseCard(card('Example Relic', 'Legendary Artifact Creature — Golem Villain', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/holes/p2copyperm1.ts (CR 707.9b, 205.1a): the bare "and loses all other card types" is read for "it" (enters as a copy) only; a TOKEN copy stays manual (Myrkul: the card, not the creature, is copied)', () => {
    const tok = "Create a token that's a copy of target creature you control, except it's an enchantment and loses all other card types.";
    expect(fullyAutomated(face(tok))).toBe(false);
    const clone = "You may have this creature enter as a copy of any creature on the battlefield, except it's an enchantment and loses all other card types.";
    expect(fullyAutomated(creature(clone))).toBe(true);
    expect(fullyAutomated(creature(clone.replace(' and loses all other card types', '')))).toBe(false);
  });
  it('parser/holes/p2copyperm1.ts, render/copy-except.ts (CR 707.9b, 105.3; Kaya): a color beside "in addition to its other types" is SET, beside "in addition to its other colors and types" it is added', () => {
    const base = "Create a token that's a copy of target creature you control, except it's a 1/1 white Spirit creature with flying in addition to its other types.";
    expect(fullyAutomated(face(base))).toBe(true);
    expect(JSON.stringify(face(base).abilities)).toContain('"colors":{"set":["W"]}');
    const added = base.replace('its other types', 'its other colors and types');
    expect(JSON.stringify(face(added).abilities)).not.toContain('"set":["W"]');
    expect(fullyAutomated(face(base.replace('white ', 'white blue ')))).toBe(false);
    // combined copy: edh-next-130 (Dino DNA, CopyExceptTokenSet) reads the copy exception without "in addition" as SETTING the card types and subtypes (CR 707.9b, 205.1a)
    expect(fullyAutomated(face(base.replace(' in addition to its other types', '')))).toBe(true);
    expect(JSON.stringify(face(base.replace(' in addition to its other types', '')).abilities)).toContain('{"layer":4,"types":{"set":["Creature"]},"subtypes":{"set":["Spirit"]}}');
  });
  it('lower/mentions.ts (CR 608.2c; Hate Mirage): after a "for each ... create a token that\'s a copy" loop "them" names the tokens; the same words after a single token or without the loop are unchanged', () => {
    const base = "Choose up to two target creatures you don't control. For each of those creatures, create a token that's a copy of that creature. Those tokens gain haste. Exile them at the beginning of the next end step.";
    expect(fullyAutomated(face(base))).toBe(true);
    expect(JSON.stringify(face(base).abilities)).toContain('"gather"');
    expect(fullyAutomated(face(base.replace('For each of those creatures, create a token', 'For each of those creatures, create two tokens')))).toBe(false);
  });
  it('effects/handlers/tokens-copy.ts#retargetCandidates (CR 707.10c, 115.1; Precursor Golem, Zada): "other" in a copy-per-object group means other than the spell\'s target; both sentences are needed', () => {
    const base = 'Whenever a player casts an instant or sorcery spell that targets only a single Golem, that player copies that spell for each other Golem that spell could target. Each copy targets a different one of those Golems.';
    expect(fullyAutomated(creature(base))).toBe(true);
    expect(ENGINE_CAPABILITIES.has('op:copy.retargetEach')).toBe(true);
    expect(fullyAutomated(creature(base.split('. ')[0] + '.'))).toBe(false);
    expect(fullyAutomated(creature(base.replace('that spell could target', 'you could target')))).toBe(false);
    expect(fullyAutomated(creature(base.replace('Each copy targets a different one', 'Each copy targets one')))).toBe(false);
  });
  it('parser/templates edh-next-57 (CR 611.2a, 613.4b; Gigantoplasm): a base power and toughness with no duration lasts for good, but only as a sentence of an ability, never a duration word dropped', () => {
    const base = '{X}: This creature has base power and toughness X/X.';
    expect(fullyAutomated(creature(base))).toBe(true);
    expect(JSON.stringify(creature(base).abilities)).toContain('"d":"permanent"');
    expect(fullyAutomated(creature('{X}: This creature gets base power and toughness X/X.'))).toBe(false);
    expect(fullyAutomated(creature('{X}: This creature has base power and toughness X/X and gains flying.'))).toBe(false);
  });
});
