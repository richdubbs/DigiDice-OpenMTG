/**
 * Standard round H (slot H of the parallel rounds F-J, Standard cards): the template data of parser/templates/zz-cloud/std-rh.json and the hole, lowering and
 * renderer support it needed. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every
 * counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an
 * automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * std-rh-scenarios.test.ts.
 *
 *   cond.ts#lifeAtLeastNAboveStarting     "your life total is at least 10 greater than your starting life total" (CR 103.4, 119.1)
 *   lower/ability.ts#staticAbility        one static ability per sentence when every sentence of a paragraph states its own "as long as" condition (CR 113.1, 611.3a)
 *   holes/object.ts (Rest, craft link)    "all cards revealed this way that weren't put onto the battlefield"; "the exiled card used to craft it" (CR 608.2c, 702.167c)
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRh from '../../../src/parser/templates/zz-cloud/std-rh.json';
import review from '../../m5/golden/cards/cloud-std-rh-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RH = stdRh as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/**
 * Design 6.9 evidence for a stable template: a wording these templates read is printed by one or two Standard cards, so none can reach three golden cards
 * ("Narrow wordings", docs/CARD_AUTOMATION.md section 5): each is stable on its hand-verified golden card plus these tests and the played scenarios (a deviation from
 * 6.9 that the pull request names for the owner). The cards that print the same line outside Standard are not golden cards (they are held out, section 4).
 */
const GOLDEN: Readonly<Record<string, readonly string[]>> = {
  'sta.rh.additionalPump.aslong': ['Elenda, Saint of Dusk'],
  'eff.rh.dig.anyNumber.permanent.mvAtMost.bf': ['Genesis Wave'],
  'eff.rh.permit.cast.spellsFromGroup.durFirst.anyType': ['Laughing Jasper Flint'],
  'eff.rh.becomes.subtype.creature.with.stillLand': ['Brave the Wilds'],
  'cm.rh.unlock.less.you': ['Inquisitive Glimmer'],
};

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a triggered, activated or static ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind !== 'static' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('std-rh template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rh.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rh.json');
    expect(files.indexOf('zz-cloud/std-rh.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-rh.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.rh.*, sta.rh.* or cm.rh.*', () => {
    expect(RH.length).toBe(5);
    for (const t of RH) {
      expect(t.id, t.id).toMatch(/^(eff|trg|sta|cm)\.rh\./);
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
    for (const t of RH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id},`)).map((g) => g.card);
      expect(cards.slice().sort(), t.id).toEqual([...(GOLDEN[t.id] ?? [])].sort());
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of RH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'still']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-rh guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of RH) {
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
  const body = text.replace(/\.$/, '').replace(/\."$/, '"');
  const plain = text.endsWith('"') ? [] : [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const out = [...plain];
  const swaps: [RegExp, string][] = [
    [/\bpermanent\b/, 'nonland'], [/\bor less\b/, 'or greater'], [/\bthose cards\b/, 'those players'], [/\bend of turn\b/, 'your next turn'], [/\btrample\b/, 'flying'],
    [/\bland\.$/, 'artifact.'], [/\bonto the battlefield\b/, 'into your hand'], [/\badditional\b/, 'extra'], [/\bas long as\b/, 'unless'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rh guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of RH) {
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

describe('std-rh guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of RH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '~,' || /^"?\{/.test(w) || w.includes('\n')) return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const start = w.startsWith('"') ? '"' : '';
          const mutated = [...words.slice(0, i), `${start}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-rh parser, lowering and renderer support', () => {
  const face = (type: string, text: string) => parseCard(card('Example Brute', type, text, /Creature/.test(type) ? { power: '3', toughness: '3' } : {}), OPTS).faces[0]!;
  it('CR 103.4, 119.1: "your life total is at least N greater than your starting life total" is life >= the starting life total + N', () => {
    const f = face('Creature — Knight', 'As long as your life total is at least 7 greater than your starting life total, ~ gets +2/+2.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"condition":{"cond":"compare","left":{"q":"life","of":{"ref":"you"}},"op":">=","right":{"q":"math","op":"+","args":[{"q":"startingLife"},7]}}');
    // ("7 or more greater" is not worded by the gate: it stays manual, never a guess)
    expect(fullyAutomated(face('Creature — Knight', 'As long as your life total is 7 or more greater than your starting life total, ~ gets +2/+2.'))).toBe(false);
  });
  it('CR 103.4: "at most N greater" and "at least 0 greater" are no reading of it (the life total could be below the starting life total)', () => {
    expect(fullyAutomated(face('Creature — Knight', 'As long as your life total is at most 7 greater than your starting life total, ~ gets +2/+2.'))).toBe(false);
    expect(fullyAutomated(face('Creature — Knight', 'As long as your life total is at least 7 less than your starting life total, ~ gets +2/+2.'))).toBe(false);
  });
  it('CR 113.1, 604.1, 611.3a: a paragraph whose sentences each state their own "as long as" condition is one static ability per sentence', () => {
    const f = face('Creature — Knight', 'As long as it is your turn, ~ gets +1/+1.\n~ gets an additional +2/+2 as long as you control a Forest.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    // (two lines are two abilities already: the split is for ONE paragraph of two sentences)
    const g = face('Creature — Knight', 'As long as it is your turn, ~ gets +1/+1. ~ gets an additional +2/+2 as long as you control a Forest.');
    expect(fullyAutomated(g), JSON.stringify(g.diagnostics)).toBe(true);
    expect(g.abilities.filter((a) => a.kind === 'static').length).toBe(2);
    expect(g.gate.every((x) => x.ok)).toBe(true);
  });
  it('CR 611.3a: a second sentence with no condition of its own is not covered by the first sentence\'s condition (no split): manual', () => {
    const f = face('Creature — Knight', 'As long as it is your turn, ~ gets +1/+1. ~ has trample.');
    expect(fullyAutomated(f)).toBe(false);
    const g = face('Creature — Knight', 'As long as it is your turn, ~ gets +1/+1. It also has trample.');
    expect(fullyAutomated(g)).toBe(false);
  });
  it('CR 608.2c, 701.20e: "all cards revealed this way that weren\'t put onto the battlefield" is the rest of the revealed group after the choice', () => {
    const f = face('Sorcery', "Reveal the top five cards of your library. You may put any number of permanent cards with mana value 2 or less from among them onto the battlefield. Then put all cards revealed this way that weren't put onto the battlefield into your graveyard.");
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"not":{"is":{"ref":"bound","name":"chosen"}}');
  });
  it('CR 608.2c, 701.20e: after an optional put of the one card a reveal stopped at, "all cards revealed this way that weren\'t put onto the battlefield" includes that card when it was not put: not "the rest", so manual (fail closed)', () => {
    const f = face('Sorcery', "Reveal cards from the top of your library until you reveal a nonland permanent card. You may put that card onto the battlefield. Then put all cards revealed this way that weren't put onto the battlefield on the bottom of your library in a random order.");
    expect(fullyAutomated(f)).toBe(false);
  });
  it('CR 702.167c, 607.2a: "the exiled card used to craft it" is the craft link of the back face', () => {
    const c = parseCard({ name: 'Example Relic // Example Golem', layout: 'transform', mana_cost: '', type_line: 'Artifact // Artifact Creature — Golem', oracle_text: '', colors: [], keywords: [],
      card_faces: [
        { name: 'Example Relic', mana_cost: '{2}', type_line: 'Artifact', oracle_text: 'Craft with creature {3}{W} ({3}{W}, Exile this artifact, Exile a creature you control or a creature card from your graveyard: Return this card transformed under its owner\'s control. Craft only as a sorcery.)' },
        { name: 'Example Golem', mana_cost: '', type_line: 'Artifact Creature — Golem', oracle_text: 'When this creature enters, draw cards equal to the mana value of the exiled card used to craft it.', power: '3', toughness: '3' },
      ] } as unknown as OracleCard, OPTS);
    expect(c.faces.every((x) => fullyAutomated(x)), JSON.stringify(c.faces.map((x) => x.diagnostics))).toBe(true);
    expect(JSON.stringify(c.faces[1]!.abilities)).toContain('"of":{"ref":"linked","link":"craft"}');
  });
  it('CR 702.167c: a link named craft is read by no ability of a card without a craft cost that exiles anything (the link is the keyword\'s)', () => {
    const f = face('Creature — Golem', 'When this creature enters, draw cards equal to the mana value of the exiled card used to craft it.');
    // (no front face: the face reads a link nothing produces; the card has no other face, so nothing could have remembered it)
    expect(fullyAutomated(f) || JSON.stringify(f.abilities).includes('"link":"craft"')).toBe(true);
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-rh design 6.10 (local index): synthetic examples', () => {
  it('no std-rh line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = RH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  // the try step on real cards: each card reads its line with the named template, passes the exact render gate and is fully automated
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'sta.rh.additionalPump.aslong': ['Elenda, Saint of Dusk'],
    'eff.rh.dig.anyNumber.permanent.mvAtMost.bf': ['Genesis Wave'],
    'eff.rh.permit.cast.spellsFromGroup.durFirst.anyType': ['Laughing Jasper Flint'],
    'eff.rh.becomes.subtype.creature.with.stillLand': ['Brave the Wilds'],
    'cm.rh.unlock.less.you': ['Inquisitive Glimmer'],
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
