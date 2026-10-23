/**
 * FAST5 T60 (R6-B: static continuous grants: equipment that loses, types and grants quoted abilities, spells you cast have delve or affinity, toughness assigns
 * combat damage, base power and toughness from life or a count): the template data of parser/templates/zz-fast5/t60.json.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present; the real cards each template reads are checked
 * there too (the try step of CONTRIBUTING "Adding a template").
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T60 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import t60 from '../../../src/parser/templates/zz-fast5/t60.json';
import review from '../../m5/golden/cards/fast5-t60-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T60 = t60 as Template[];

/**
 * Design 6.9 evidence for a stable template: three hand-verified golden cards (test/m5/golden/cards/fast5-t60-review.json), or, for a sentence that fewer real
 * cards print (at most five), every card of the index that the template reads, each read by hand against its Oracle text (this table; the index check below
 * proves there is no other). READERS read their line completely; REFUSED are cards the template reads whose line the render gate (G6) or another rule keeps
 * manual (a subtype that is also a card type word the template cannot say, a card that is never a permanent, a digital-only card): never wrongly automated.
 */
const READERS: Readonly<Record<string, readonly string[]>> = {
  'sta.t60.attached.pump.loses': ['Colossus Hammer', 'Magebane Armor', 'Starforged Sword', 'Tightening Coils'],
  'sta.t60.attached.pump.quoted.addtype': ["Black Mage's Rod", "Sage's Nouliths", "Thief's Knife", "White Mage's Staff"],
  'sta.t60.attached.quoted.addtype': ["Red Mage's Rapier"],
  'sta.t60.attached.pump.whereX': ['Chainsaw'],
  'sta.t60.attached.basePT.life': ['Aettir and Priwen'],
  'sta.t60.attached.chosenColor': ['Alloy Golem', 'Shimmerwilds Growth'],
  'sta.t60.are.types.addition': ['The Flesh Is Weak', 'Toph, the First Metalbender'],
  'sta.t60.are.subtypes.addition.have': ['Ragost, Deft Gastronaut', 'Senator Peacock'],
  'sta.t60.have.basePT.eachEqual': ["Dollmaker's Shop // Porcelain Gallery"],
  'sta.t60.spells.cast.delve': ['Teval, Arbiter of Virtue'],
  'sta.t60.spells.cast.affinity': ['Mycosynth Golem', 'Pearl-Ear, Imperial Advisor', 'Sami, Wildcat Captain', 'Tezzeret, Master of the Bridge', 'Witherbloom, the Balancer'],
  'sta.t60.rule.toughnessDamage.each': ['Ancient Lumberknot', 'Bedrock Tortoise', 'Ghalta the Immovable', 'Tapestry Warden'],
  'sta.t60.rule.toughnessDamage.equipped': ['Bark of Doran'],
  'sta.t60.self.exiledWith.pump.has': ['Veteran Survivor'],
  'cm.t60.abilities.keyword.otherPermanents.less': ['Boom Scholar'],
};
const REFUSED: Readonly<Record<string, readonly string[]>> = {
  'sta.t60.are.types.addition': ['Nyx'],
  // r4-static: Kylem All-Star and Ygra, Eater of All ("<group> are Gold / Food artifacts in addition to their other types and have ...") are read by
  // sta.r4static.group.are.artifactSubtype.have, which also adds the artifact type this template leaves out (its render gate refused them here)
  'sta.t60.spells.cast.affinity': ['The Grand Goatnapper'],
};
/**
 * FAST5 batch 8 integration: with the merged fast5/main the template also reads the three "<Clues | Blood tokens | non-Equipment artifacts> you control are Equipment
 * in addition to their other types and have \"Equipped creature gets +N/+0\" and equip {N}" lines. Read by hand at the merge: the render gate refuses each one (the
 * grant renders in another order), so every one stays manual; they are no evidence of the template (no card plays by it), so they are not counted in its evidence.
 */
const REFUSED_AT_MERGE: Readonly<Record<string, readonly string[]>> = {
  'sta.t60.are.subtypes.addition.have': ['Armed with Proof', 'Arterial Alchemy', 'Dan Lewis'],
};
/** The lines of a card that are T60 shapes: a cheap filter before parsing, and what a manual ability of a reader must not be. */
const LINE: Readonly<Record<string, RegExp>> = {
  'sta.t60.attached.pump.loses': /^(enchanted|equipped) creature gets [+-]\d+\/[+-]\d+ and loses \w+/i,
  'sta.t60.attached.pump.quoted.addtype': /^(enchanted|equipped) creature gets [+-]\d+\/[+-]\d+, has ".*" and is an? \w+ in addition to its other types/i,
  'sta.t60.attached.quoted.addtype': /^(enchanted|equipped) creature has ".*" and is an? \w+ in addition to its other types/i,
  'sta.t60.attached.pump.whereX': /^(enchanted|equipped) creature gets \+X\/\+0, where X is/i,
  'sta.t60.attached.basePT.life': /^(enchanted|equipped) creature has base power and toughness X\/X, where X is/i,
  'sta.t60.attached.chosenColor': /\bis the chosen color\./i,
  'sta.t60.are.types.addition': /\bare (lands|creatures|artifacts|enchantments|planeswalkers|battles) in addition to their other types/i,
  'sta.t60.are.subtypes.addition.have': /\bare [\w -]+ in addition to their other types and have "/i,
  'sta.t60.have.basePT.eachEqual': /\bhave base power and toughness each equal to/i,
  'sta.t60.spells.cast.delve': /spells you cast have delve/i,
  'sta.t60.spells.cast.affinity': /spells you cast have affinity for/i,
  'sta.t60.rule.toughnessDamage.each': /with toughness greater than its power assigns combat damage equal to its toughness rather than its power/i,
  'sta.t60.rule.toughnessDamage.equipped': /^as long as equipped creature's toughness is greater than its power, it assigns combat damage/i,
  'sta.t60.self.exiledWith.pump.has': /^as long as there are \w+ or more cards exiled with/i,
  'cm.t60.abilities.keyword.otherPermanents.less': /abilities of other permanents you control cost \{\d+\} less to activate/i,
};
const ALL_LINES = new RegExp(Object.values(LINE).map((r) => r.source).join('|'), 'i');
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which a T60 example is an ability of the right kind: an Equipment or an Aura for an attached-creature line, a creature otherwise. */
const exampleCard = (_t: Template, text: string) => {
  const type = /^(Enchanted|enchanted)\b/.test(text) && !text.includes('Equip') ? 'Enchantment — Aura' : /^(Enchanted|Equipped|As long as equipped)\b/.test(text) ? 'Artifact — Equipment' : 'Creature — Elf Druid';
  return card('Example Volley', type, /^Enchant /.test(text) || type === 'Enchantment — Aura' ? (text.startsWith('Enchant ') ? text : `Enchant creature\n${text}`) : text);
};
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('T60 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast5/t60.json, after zz-fast5/t48.json, before zz-fast5x/ and zz-m6/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t60.json');
    expect(files.indexOf('zz-fast5/t60.json')).toBeGreaterThan(files.indexOf('zz-fast5/t48.json'));
    expect(files.indexOf('zz-fast5/t60.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(T60.length).toBe(Object.keys(READERS).length);
    for (const t of T60) {
      expect(t.id, t.id).toMatch(/^(sta|cm)\.t60\./);
      expect(t.kind, t.id).toBe('static');
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable T60 template has its evidence: three hand-verified golden cards, or the (at most five) cards of the corpus that it reads, all read by hand', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of T60.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => (/\(([^)]*)\)/.exec(g.verified)?.[1] ?? '').split(', ').includes(t.id)).map((g) => g.card);
      const readers = READERS[t.id];
      expect(readers, t.id).toBeDefined();
      for (const c of cards) expect(readers, `${t.id}: ${c}`).toContain(c);
      if (cards.length < 3) {
        expect(readers!.length + (REFUSED[t.id]?.length ?? 0), t.id).toBeLessThanOrEqual(5);
        expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
      }
    }
  });
  it('the delve grant is stable: cloud std-tdm made the engine play delve (keyword:delve is a capability, keywords/hooks/delve.ts), and Teval is its golden card', () => {
    expect(T60.find((t) => t.id === 'sta.t60.spells.cast.delve')!.status).toBe('stable');
    expect(ENGINE_CAPABILITIES.has('keyword:delve')).toBe(true);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T60) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('T60 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T60) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
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
  const sentences = text.split(/(?<=\.)\s+/);
  const last = sentences.length - 1;
  const body = sentences[last]!.replace(/\.$/, '');
  const before = sentences.slice(0, last).join(' ');
  const wrap = (m: string): string => `${before === '' ? '' : `${before} `}${m.replace(/\.$/, '')}.`;
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bor\b/, 'and'], [/\band\b/, 'or'], [/\bequipped\b/, 'target'], [/\bless\b/, 'more'], [/\bgreater\b/, 'less'], [/\bloses\b/, 'gains'], [/\bcast\b/, 'control'],
    [/\bchosen\b/, 'revealed'], [/\bhave\b/, 'lose'], [/\bat least\b/, 'at most'], [/\bin addition\b/, 'instead'], [/\bartifacts\b/, 'creatures'], [/\bexiled\b/, 'sacrificed'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out.map(wrap);
}

describe('T60 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T60) {
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

describe('T60 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T60) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w) || /^"?\{/.test(w) || w.includes('\n')) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('T60 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  const linesOf = (c: { oracle_text?: string; card_faces?: { oracle_text?: string }[] }): string[] =>
    [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].filter((x): x is string => typeof x === 'string').flatMap((x) => x.split('\n'));

  it('no T60 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const l of linesOf(c)) {
        const noReminder = l.replace(/\s*\([^)]*\)\s*$/, '').trim(); // the reminder text is no part of the rule
        for (const x of [l, noReminder]) {
          lines.add(x.trim());
          lines.add(x.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = T60.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => ALL_LINES.test(l) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  it('the cards named as the corpus of a template are every card of the index that the template reads', () => {
    for (const [id, names] of Object.entries(READERS)) {
      const want = [...names, ...(REFUSED[id] ?? []), ...(REFUSED_AT_MERGE[id] ?? [])];
      const found = (index ?? []).filter((c) => linesOf(c).some((l) => LINE[id]!.test(l.trim())))
        .filter((c) => parseCard(c, OPTS).faces.some((f) => f.templatesUsed.includes(id))).map((c) => c.name);
      expect([...new Set(found)].sort(), id).toEqual([...want].sort());
    }
  }, 300_000);

  // the try step on real cards: each card's T60 line is read by the named template and passes the exact render gate, never manual on that line
  for (const [id, names] of Object.entries(READERS)) {
    it(`${id}: ${names.join(', ')} read the line with it, pass the render gate and leave no manual ability for it`, () => {
      for (const name of names) {
        const c = (index ?? []).find((x) => x.name === name);
        expect(c, name).toBeDefined();
        const used = parseCard(c!, OPTS).faces.flatMap((f) => f.templatesUsed);
        expect(used, name).toContain(id);
        const def = compileCard(c!);
        const manual = def.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' && ALL_LINES.test(a.text));
        expect(manual.map((a) => a.text), name).toEqual([]);
      }
    });
  }

  it('the refused readers keep their line manual (never a wrong automation)', () => {
    for (const [id, names] of Object.entries(REFUSED)) {
      for (const name of names) {
        const c = (index ?? []).find((x) => x.name === name);
        expect(c, name).toBeDefined();
        const def = compileCard(c!);
        const lineAbilities = def.faces.flatMap((f) => f.abilities).filter((a) => LINE[id]!.test(a.text.trim()) || ALL_LINES.test(a.text));
        expect(lineAbilities.length, `${id}: ${name}`).toBeGreaterThan(0);
        expect(lineAbilities.every((a) => a.kind === 'manual' || def.automation.level !== 'full'), `${id}: ${name}`).toBe(true);
      }
    }
  });
});
