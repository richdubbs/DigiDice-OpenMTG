/**
 * std-craft-2 (lane std-craft, The Enigma Jewel): the template data of parser/templates/zz-cloud/std-craft-2.json and the anaphora, statics and renderer support it
 * needed. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2).
 * Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-craft-2-scenarios.test.ts.
 *
 *   lower/anaphora.ts                 "copy it" after "whenever you activate an ability" names the ability on the stack, never its source (CR 707.10)
 *   statics/mods.ts#limitedEachTurn   granted activated abilities limited to once each turn (layer 6 `activatedOfLimit`, CR 602.5b, 613.1f)
 *   render/mods.ts, render/kw.ts      "has each activated ability of ... once each turn"; "nonlands with activated abilities" as craft materials
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdCraft2 from '../../../src/parser/templates/zz-cloud/std-craft-2.json';
import review from '../../m5/golden/cards/std-craft-2-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const CRAFT2 = stdCraft2 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/**
 * Design 6.9 evidence for a stable template: each wording these templates read is printed by one card (The Enigma Jewel), so none can reach three golden cards
 * ("Narrow wordings", docs/CARD_AUTOMATION.md section 5): each is stable on its hand-verified golden card plus these tests and the played scenarios (a deviation
 * from 6.9 that the round's record names for the owner).
 */
const GOLDEN: Readonly<Record<string, readonly string[]>> = {
  'kw.stdcraft2.craft.orMore.nonlandsActivated': ['The Enigma Jewel // Locus of Enlightenment'],
  'sta.stdcraft2.has.eachActivatedOf.onceEachTurn': ['The Enigma Jewel // Locus of Enlightenment'],
};

/** A synthetic card in which an example is an ability of the right kind: a keyword line on an artifact, a triggered ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'ability' || t.kind === 'static') return card('Example Relic', 'Artifact', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('std-craft-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-craft-2.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-craft-2.json');
    expect(files.indexOf('zz-cloud/std-craft-2.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-craft-2.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are kw.stdcraft2.* or sta.stdcraft2.*', () => {
    expect(CRAFT2.length).toBe(2);
    for (const t of CRAFT2) {
      expect(t.id, t.id).toMatch(/^(kw|sta)\.stdcraft2\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 (narrow wordings): a stable template has its hand-verified golden card(s); the review pins every card as full', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of CRAFT2.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id},`)).map((g) => g.card);
      expect(cards.slice().sort(), t.id).toEqual([...(GOLDEN[t.id] ?? [])].sort());
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of CRAFT2) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'still']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-craft-2 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of CRAFT2) {
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
  const out = text.endsWith('.') ? [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`] : [`${text} unless it is blue`, `${text}, and a Wizard`];
  const swaps: [RegExp, string][] = [
    [/\ban Elf\b/, 'two Elves'], [/\bonto the battlefield\b/, 'into your hand'], [/\btapped and attacking\b/, 'tapped'], [/\bexiled\b/, 'discarded'], [/\bused to craft\b/, 'exiled with'],
    [/, and a Rogue\b/, ', or a Rogue'], [/\byou may put\b/, 'put'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-craft-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of CRAFT2) {
    it(`${t.id}: an appended rider or a swapped key word never gives the example's JSON`, () => {
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

describe('std-craft-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of CRAFT2) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '~,' || /^"?\{/.test(w) || w.includes('\n')) return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-craft-2 anaphora, statics and renderer support', () => {
  const face = (type: string, text: string) => parseCard(card('Example Relic', type, text), OPTS).faces[0]!;
  it('CR 707.10, 602.2: "Whenever you activate an ability that isn\'t a mana ability, copy it." copies the ability (the event\'s spell role), never its source', () => {
    const f = face('Artifact', "Whenever you activate an ability that isn't a mana ability, copy it.");
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"what":{"ref":"event","role":"spell"}');
  });
  it('CR 707.10: a "copy it" whose one candidate is already known is unchanged ("Whenever you cast an instant spell, copy it.")', () => {
    const f = face('Enchantment', 'Whenever you cast an instant spell, copy it.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"what":{"ref":"event","role":"spell"}');
  });
  it('CR 602.5b: "only once each turn" is the limit of the granted abilities; another limit or a grant from other objects is no reading (fail closed)', () => {
    const t = CRAFT2.find((x) => x.id === 'sta.stdcraft2.has.eachActivatedOf.onceEachTurn')!;
    expect(JSON.stringify(parsedWith(t, t.examples[0]!.text).abilities)).toContain('"activatedOfLimit":{"per":"turn","max":1}');
    expect(fullyAutomated(parsedWith(t, '~ has each activated ability of creatures you control. You may activate each of those abilities only once each turn.'))).toBe(false);
  });
  it('CR 702.167b: "nonlands with activated abilities" are nonland objects with an activated ability (a mana ability is one)', () => {
    const t = CRAFT2.find((x) => x.id === 'kw.stdcraft2.craft.orMore.nonlandsActivated')!;
    expect(parsedWith(t, t.examples[0]!.text).abilities[0]).toMatchObject({ keyword: 'craft', filter: { notTypes: ['Land'], hasAbility: 'activated' }, amount: 2, quality: 'or more' });
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-craft-2 design 6.10 (local index): synthetic examples', () => {
  it('no std-craft-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const [name, text] of [[c.name, c.oracle_text], ...(c.card_faces ?? []).map((x) => [x.name, x.oracle_text])] as [string, string | undefined][]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = CRAFT2.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  // the try step on real cards: each card reads its line with the named template, passes the exact render gate and is fully automated
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'kw.stdcraft2.craft.orMore.nonlandsActivated': ['The Enigma Jewel // Locus of Enlightenment'],
    'sta.stdcraft2.has.eachActivatedOf.onceEachTurn': ['The Enigma Jewel // Locus of Enlightenment'],
    'eff.copy.spell': ['The Enigma Jewel // Locus of Enlightenment'],
  };
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.join(', ')} read their line with it, pass the render gate and are fully automated`, () => {
      for (const name of names) {
        const c = (index ?? []).find((x) => x.name === name);
        expect(c, name).toBeDefined();
        const p = parseCard(c!, OPTS);
        expect(p.faces.some((f) => f.templatesUsed.includes(id)), `${name}: ${p.faces.map((f) => f.templatesUsed.join(',')).join(' | ')}`).toBe(true);
        for (const f of p.faces) {
          expect(fullyAutomated(f), `${name}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
          expect(f.gate.every((g) => g.ok), name).toBe(true);
        }
      }
    }, 60_000);
  }
});
