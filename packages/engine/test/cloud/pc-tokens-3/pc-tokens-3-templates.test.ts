/**
 * Lane pc-tokens, round pc-tokens-3 (Commander precon decks): the tests of the templates it ported from the stopped round p2-typechange-4
 * (parser/templates/zz-cloud/p2-typechange-4.json) and of the renderer family quoted-then-keyword (render/mods.ts#abilityList). Guard G9 (design 6.8): every example
 * lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail
 * or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the
 * local index when it is present. The behavior is in pc-tokens-3-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/p2-typechange-4.json';
import review from '../../m5/golden/cards/pc-tokens-3-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const MECH_COUNT = 6;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A spell: the sentences of a sorcery. */
const kindOf = (text: string): string => (/^Enchant creature/.test(text) ? 'Enchantment — Aura' : /Equip \{/.test(text) ? 'Artifact — Equipment' : / are (enchantments|artifacts)\b/.test(text) ? 'Enchantment' : 'Sorcery');
const parse = (text: string, type = kindOf(text), pt?: { power: string; toughness: string }) => parseCard(card('Example Ooze', type, text, pt ?? {}), OPTS).faces[0]!;
const golden = review as { card: string; verified: string; expect?: string }[];
const evidence = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`)).map((g) => g.card);

describe('pc-tokens-3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-typechange-4.json, after p2-typechange-3, before p2-zone-moves-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-typechange-4.json');
    expect(files.indexOf('zz-cloud/p2-typechange-4.json')).toBeGreaterThan(files.indexOf('zz-cloud/p2-typechange-3.json'));
    expect(files.indexOf('zz-cloud/p2-typechange-4.json')).toBeLessThan(files.indexOf('zz-cloud/p2-zone-moves-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are rep.p2tc4.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.p2tc4\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 DEVIATION (named in the round record): the templates were made stable by the stopped round p2-typechange-4; here each is stable on the hand-verified golden cards of this round', () => {
    // sta.p2tc4.group.are.artifacts.inAddition stays experimental: no full golden card reads it (Mycosynth Lattice and Mycosynthwave stay partial / manual)
    expect(MECH.filter((x) => x.status === 'stable').map((x) => x.id)).not.toContain('sta.p2tc4.group.are.artifacts.inAddition');
    expect(MECH.filter((x) => x.status === 'stable').length).toBe(MECH_COUNT - 1);
    expect(evidence('eff.p2tc4.group.pump.gainAllCreatureTypes').sort()).toEqual(['Shields of Velis Vel', 'Volatile Claws']);
    expect(evidence('eff.p2tc4.group.pump.loseAllCreatureTypes')).toEqual(['Ego Erasure']);
    expect(evidence('sta.p2tc4.attached.pump.everyCreatureType')).toEqual(['Amorphous Axe']);
    expect(evidence('sta.p2tc4.group.are.enchantments.inAddition')).toEqual(['Enchanted Evening']);
    expect(evidence('sta.p2tc4.attached.pump.isArtifact.inAddition')).toEqual(['Silverskin Armor']);
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'same']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('pc-tokens-3 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parse(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parse(e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parse(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} this turn.`];
  const swaps: [RegExp, string][] = [
    [/\bgain all creature types\b/, 'gain all colors'], [/\blose all creature types\b/, 'lose all abilities'], [/\bare artifacts\b/, 'are creatures'], [/\bare enchantments\b/, 'are lands'],
    [/\bevery creature type\b/, 'every color'], [/\bin addition to their other types\b/, 'instead'], [/\bin addition to its other types\b/, 'instead'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('pc-tokens-3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/this turn" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parse(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parse(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('pc-tokens-3 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parse(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('pc-tokens-3 renderer: the family quoted-then-keyword', () => {
  it('CR 113.1a, 702.6a: one keyword and one quoted ability granted together read with the quoted ability first (Armed with Proof, Arterial Alchemy)', () => {
    const f = parseCard(card('Example Wiki', 'Enchantment', 'Clues you control are Equipment in addition to their other types and have "Equipped creature gets +2/+0" and equip {2}.', {}), OPTS).faces[0]!;
    expect(fullyAutomated(f), JSON.stringify(f.gate)).toBe(true);
    // the keyword first, as the plain wording of the renderer says it, is no Oracle wording: "attached creature" for the equipped creature
    const g = parseCard(card('Example Wiki', 'Enchantment', 'Clues you control are Equipment in addition to their other types and have equip {2} and "Equipped creature gets +2/+0".', {}), OPTS).faces[0]!;
    expect(fullyAutomated(g)).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('pc-tokens-3 design 6.10 (local index): synthetic examples', () => {
  it('no pc-tokens-3 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !/^(Equip \{\d\}|Enchant creature)$/.test(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
