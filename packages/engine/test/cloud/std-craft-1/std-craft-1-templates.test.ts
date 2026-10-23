/**
 * std-craft-1 (lane std-craft, Standard cards): the template data of parser/templates/zz-cloud/std-craft-1.json and the hole, segmenter, keyword and renderer
 * support the round needed. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every
 * counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an
 * automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * std-craft-1-scenarios.test.ts.
 *
 *   holes/object.ts (craft link)        "the exiled cards used to craft it / ~" is the craft link, as the singular is (CR 702.167c, 607.2a)
 *   holes/qty.ts#distinctCounts         "the number of colors among the exiled cards used to craft it" (CR 105.1)
 *   segment.ts#keywordItems             "Craft with a Dinosaur, a Merfolk, ..." is ONE keyword whose materials are a list (as "Enchant creature, land, or planeswalker")
 *   keywords/data/craft.json            a craft instance with no `filter` adds no material part: its cost holds the listed materials (CR 702.167a, 118.3)
 *   render/kw.ts#craftListWords         the list of materials; render/np.ts the "exiled <card> used to craft ~" choice; render/steps-cards.ts the colors among the link
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { expandKeyword } from '../../../src/keywords/expand';
import { keywordRegistry } from '../../../src/keywords/registry';
import stdCraft1 from '../../../src/parser/templates/zz-cloud/std-craft-1.json';
import review from '../../m5/golden/cards/std-craft-1-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const CRAFT1 = stdCraft1 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/**
 * Design 6.9 evidence for a stable template: each wording these templates read is printed by one card (The Grim Captain), so none can reach three golden cards
 * ("Narrow wordings", docs/CARD_AUTOMATION.md section 5): each is stable on its hand-verified golden card plus these tests and the played scenarios (a deviation
 * from 6.9 that the round's record names for the owner).
 */
const GOLDEN: Readonly<Record<string, readonly string[]>> = {
  'kw.stdcraft1.craft.list4': ['Throne of the Grim Captain // The Grim Captain'],
  'eff.stdcraft1.put.craftExiled.attacking': ['Throne of the Grim Captain // The Grim Captain'],
};

/** A synthetic card in which an example is an ability of the right kind: a keyword line on an artifact, a triggered ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'ability') return card('Example Relic', 'Artifact', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

/** A transform card whose front crafts with `materials` and whose back face prints `back`. */
function craftDfc(materials: string, back: string, backType = 'Artifact Creature — Golem'): OracleCard {
  return {
    name: 'Example Relic // Example Golem', layout: 'transform', mana_cost: '', type_line: `Artifact // ${backType}`, oracle_text: '', colors: [], keywords: [],
    card_faces: [
      { name: 'Example Relic', mana_cost: '{2}', type_line: 'Artifact', oracle_text: `Craft with ${materials} {3} ({3}, Exile this artifact, Exile ${materials} you control and/or cards from your graveyard: Return this card transformed under its owner's control. Craft only as a sorcery.)` },
      { name: 'Example Golem', mana_cost: '', type_line: backType, oracle_text: back, power: '*', toughness: '*' },
    ],
  } as unknown as OracleCard;
}

describe('std-craft-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-craft-1.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-craft-1.json');
    expect(files.indexOf('zz-cloud/std-craft-1.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-craft-1.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are kw.stdcraft1.* or eff.stdcraft1.*', () => {
    expect(CRAFT1.length).toBe(2);
    for (const t of CRAFT1) {
      expect(t.id, t.id).toMatch(/^(kw|eff)\.stdcraft1\./);
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
    for (const t of CRAFT1.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id},`)).map((g) => g.card);
      expect(cards.slice().sort(), t.id).toEqual([...(GOLDEN[t.id] ?? [])].sort());
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of CRAFT1) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'still']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-craft-1 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of CRAFT1) {
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

describe('std-craft-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of CRAFT1) {
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

describe('std-craft-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of CRAFT1) {
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

describe('std-craft-1 parser, keyword and renderer support', () => {
  const faces = (c: OracleCard) => parseCard(c, OPTS).faces;
  it('CR 702.167c, 607.2a: "the exiled cards used to craft it" (plural) is the craft link, as the singular is; a statistic of it adds up the cards', () => {
    const [front, back] = faces(craftDfc('one or more artifacts', "Example Golem's power and toughness are each equal to the total power of the exiled cards used to craft it."));
    expect(fullyAutomated(front!) && fullyAutomated(back!), JSON.stringify(back!.diagnostics)).toBe(true);
    expect(JSON.stringify(back!.abilities)).toContain('{"q":"stat","stat":"power","of":{"ref":"linked","link":"craft"},"sum":true}');
  });
  it('CR 105.1, 702.167c: "the number of colors among the exiled cards used to craft it" counts the distinct colors of the link; "used to craft this creature" names the same set', () => {
    const [, back] = faces(craftDfc('one or more creatures', "Example Golem's power and toughness are each equal to the number of colors among the exiled cards used to craft it.\n{T}: For each color among the exiled cards used to craft this creature, add one mana of that color."));
    expect(fullyAutomated(back!), JSON.stringify(back!.diagnostics)).toBe(true);
    expect(back!.gate.every((g) => g.ok)).toBe(true);
    const json = JSON.stringify(back!.abilities);
    expect(json).toContain('{"q":"distinct","what":"colors","among":{"ref":"linked","link":"craft"}}');
    expect(json).toContain('"dynamic":{"kind":"eachColorAmong","among":{"ref":"linked","link":"craft"}}');
  });
  it('CR 105.1: only the colors are counted among the link: "the number of card types among the exiled cards used to craft it" is no reading (fail closed)', () => {
    const [, back] = faces(craftDfc('one or more creatures', "Example Golem's power and toughness are each equal to the number of card types among the exiled cards used to craft it."));
    expect(fullyAutomated(back!)).toBe(false);
  });
  it('CR 702.167a: "Craft with a Goblin, an Elf, a Wizard, and a Rogue {3}" is one keyword line (not a list of four keywords), its cost one exile part per material', () => {
    const f = parsedWith(CRAFT1[0]!, 'Craft with a Goblin, an Elf, a Wizard, and a Rogue {3}');
    expect(f.abilities).toHaveLength(1);
    const kw = f.abilities[0] as unknown as { keyword: string; filter?: unknown; cost: { other: { filter: { subtypes: string[] } }[] } };
    expect(kw.keyword).toBe('craft');
    expect(kw.filter).toBeUndefined();
    expect(kw.cost.other.map((p) => p.filter.subtypes[0])).toEqual(['Goblin', 'Elf', 'Wizard', 'Rogue']);
  });
  it('CR 702.167a, 118.3: the expansion of such an instance adds "exile this artifact" and no material part of its own; an instance with a filter keeps its one material part', () => {
    const data = keywordRegistry.get('craft')!;
    const listed = parsedWith(CRAFT1[0]!, 'Craft with a Goblin, an Elf, a Wizard, and a Rogue {3}').abilities[0] as never;
    const [a] = expandKeyword(data, listed, { ordinal: 1, types: ['Artifact'] } as never) as unknown as { cost: { other: { self?: boolean; filter?: unknown }[] } }[];
    expect(a!.cost.other).toHaveLength(5);
    expect(a!.cost.other.filter((p) => p.self === true)).toHaveLength(1);
    const one = parsedWith(CRAFT1[0]!, 'Craft with artifact {3}').abilities[0] as never;
    const [b] = expandKeyword(data, one, { ordinal: 1, types: ['Artifact'] } as never) as unknown as { cost: { other: unknown[] } }[];
    expect(b!.cost.other).toHaveLength(2);
  });
  it('the craft line renders with no period after it, unlike a keyword with a dash cost ("Ward--Pay 3 life.")', () => {
    const f = parsedWith(CRAFT1[0]!, 'Craft with a Goblin, an Elf, a Wizard, and a Rogue {3}');
    expect(f.gate.every((g) => g.ok), JSON.stringify(f.gate)).toBe(true);
    expect(f.gate.map((g) => g.rendered).join(' ')).not.toMatch(/\{3\}\.$/);
  });
  it('CR 702.5a: "Enchant creature, land, or planeswalker" is still one keyword line', () => {
    const f = parseCard(card('Example Aura', 'Enchantment — Aura', 'Enchant creature, land, or planeswalker\nEnchanted permanent gets +1/+1.'), OPTS).faces[0]!;
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-craft-1 design 6.10 (local index): synthetic examples', () => {
  it('no std-craft-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = CRAFT1.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  // the try step on real cards: each card reads its line with the named template, passes the exact render gate and is fully automated
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'kw.stdcraft1.craft.list4': ['Throne of the Grim Captain // The Grim Captain'],
    'eff.stdcraft1.put.craftExiled.attacking': ['Throne of the Grim Captain // The Grim Captain'],
    'kw.e13.craft.orMore': ["Saheeli's Lattice // Mastercraft Raptor"],
    'kw.e13.craft.orMore.any': ['Sunbird Standard // Sunbird Effigy'],
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
