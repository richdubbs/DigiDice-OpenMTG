/**
 * Cloud commander batch, slice cmd5 (the Commander backlog with two or more colors, tuning half): the template data of parser/templates/zz-cloud/cmd5.json and the
 * renderer support it needed (render/fold.ts#drawLoseWhereX, #gainDrawWhereX, #tokenAndToken; render/stat.ts "during combat"). Guard G9 (design 6.8): every example
 * lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10),
 * checked against the local index when it is present. The behavior is in cmd5-scenarios.test.ts and cmd5-mana.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import cmd5 from '../../../src/parser/templates/zz-cloud/cmd5.json';
import review from '../../m5/golden/cards/cloud-cmd5-review.json';
import t21Review from '../../m5/golden/cards/fast4-t21-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const CMD5 = cmd5 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a triggered, activated or static ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'effect' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('cmd5 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/cmd5.json, after trigger.json, before zz-cloud/std-hob.json and zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/cmd5.json');
    expect(files.indexOf('zz-cloud/cmd5.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/cmd5.json')).toBeLessThan(files.indexOf('zz-cloud/std-hob.json'));
    expect(files.indexOf('zz-cloud/cmd5.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.cmd5.* or sta.cmd5.*', () => {
    for (const t of CMD5) {
      expect(t.id, t.id).toMatch(/^(eff|trg|sta)\.cmd5\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  // p2-promote-1 (6.9 deviation, narrow wording: printed on one card): stable on that card alone, with its template tests and the scenario of test/cloud/cmd5;
  // its golden entry is the card's earlier one, FAST4 T21's (fast4-t21-review.json), pinned full
  const NARROW: Readonly<Record<string, string>> = {
    'sta.cmd5.spells.less.you.targetSelf': 'Elderwood Scion',
  };
  it('design 6.9: a stable template has its evidence: at least three hand-verified golden cards that name it (the review file pins each card as full or names its pending sentence), or the one card that prints a narrow wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of CMD5.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`) || g.verified.includes(`(${t.id},`) || g.verified.includes(` ${t.id})`) || g.verified.includes(` ${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) expect([...cards, ...(t21Review as { card: string; verified: string; expect?: string }[]).filter((g) => g.expect === 'full' && g.verified.includes(`(${t.id})`)).map((g) => g.card)], t.id).toContain(NARROW[t.id]);
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of CMD5) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('cmd5 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of CMD5) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed, `${e.text}: ${f.templatesUsed.join(', ')}`).toContain(t.id);
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
    [/\banother\b/, 'each other'], [/\bduring combat\b/, 'during your turn'], [/\bless\b/, 'more'], [/\byour opponents\b/, 'each player'], [/\b(lose|gain)\b/, 'pay'],
    [/\bdraw X cards\b/, 'draw two cards'], [/\bwhere X is the number of\b/, 'where X is twice the number of'], [/\ba Treasure token\b/, 'a tapped Treasure token'], [/ and a /, ' or a '],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('cmd5 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of CMD5) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able" or a swapped key word never gives the example's JSON`, () => {
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

describe('cmd5 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of CMD5) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^"?\{/.test(w) || w.includes('\n')) return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('cmd5 design 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  it('no cmd5 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = CMD5.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  // the try step on real cards: each card's line is read by the named template and passes the render gate
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'eff.cmd5.sacrifice.another': ['Korvold, Fae-Cursed King', 'Morkrut Necropod', 'Rust Elemental'],
    'eff.cmd5.drawAndYouLoseLife.whereX': ["Be'lakor, the Dark Master", 'Champion of Dusk', "Minions' Murmurs", 'Corpse Augur', 'Parting Thoughts', 'Sanguimancy'],
    'eff.cmd5.gainLifeAndDraw.whereX': ['Camaraderie', 'Nissa, Voice of Zendikar', 'Fruit of the First Tree'],
    'sta.cmd5.player.cant.cast.combat': ['Marisi, Breaker of the Coil', 'Basandra, Battle Seraph'],
    'sta.cmd5.spells.less.you.targetSelf': ['Elderwood Scion'],
    'eff.cmd5.token.two': ['Madame Vastra', 'Song of Eärendil', 'Specimen Collector'],
    'eff.cmd5.energy.qty': ['Sphinx of the Revelation', 'Empyreal Voyager', 'Peema Trailblazer'],
  };
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.join(', ')} read a line with it and pass the render gate`, () => {
      for (const name of names) {
        const oracle = (index ?? []).find((c) => c.name === name);
        expect(oracle, name).toBeDefined();
        const parsed = parseCard(oracle!, OPTS);
        expect(parsed.faces.flatMap((f) => f.templatesUsed), name).toContain(id);
        expect(parsed.faces.every((f) => f.gate.every((g) => g.ok)), name).toBe(true);
        expect(compileCard(oracle!).faces.length, name).toBeGreaterThan(0);
      }
    }, 60_000);
  }
});
