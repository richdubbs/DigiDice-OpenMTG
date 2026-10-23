/**
 * Cloud batch 2, slice std-tla (the Standard backlog of Avatar: The Last Airbender, tuning half): the template data of parser/templates/zz-cloud/std-tla.json and the
 * hole, lowering and renderer support they needed. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6);
 * every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never
 * leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * std-tla-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdTla from '../../../src/parser/templates/zz-cloud/std-tla.json';
import review from '../../m5/golden/cards/cloud-std-tla-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const TLA = stdTla as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a triggered or static ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'effect' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('std-tla template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-tla.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-tla.json');
    expect(files.indexOf('zz-cloud/std-tla.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-tla.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdtla.* or sta.stdtla.*', () => {
    expect(TLA.length).toBe(8);
    for (const t of TLA) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.stdtla\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence, hand-verified golden cards of the tuning half that use it (the review file pins each card as full)', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of TLA.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of TLA) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during']) {
        if (words.includes(w) && !(w === 'then' && t.id === 'eff.stdtla.flicker.it')) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-tla guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of TLA) {
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
    [/\buntil end of turn\b/, 'until your next turn'], [/\bor more\b/, 'or fewer'], [/\beach\b/, 'all'], [/\bget\b/, 'gain'], [/\bgain\b/, 'lose'], [/\bhas\b/, 'loses'],
    [/\bDuring your turn\b/, 'During your end step'], [/\bflash\b/, 'haste'], [/\bits owner's control\b/, 'your control'], [/\binto your hand\b/, 'onto the battlefield'],
    [/\bmilled this way\b/, 'discarded this way'], [/\bloses all abilities\b/, 'loses flying'], [/\bmana cost\b/, 'power'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-tla guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of TLA) {
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

describe('std-tla guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of TLA) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~,' || /^\{/.test(w)) return;
          const end = w.match(/[.,]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-tla hole, lowering and renderer support', () => {
  const spellFace = (text: string) => parseCard(card('Example Volley', 'Sorcery', text), OPTS).faces[0]!;
  const creatureFace = (name: string, text: string) => parseCard(card(name, 'Legendary Creature — Spirit Ally', text, { power: '3', toughness: '3' }), OPTS).faces[0]!;
  it('CR 701.17a, 608.2c: "a land card was milled this way" / "is milled this way" / "at least one ... is milled this way" read the cards a mill step put into a graveyard, and nothing without a mill', () => {
    for (const s of ['If a land card was milled this way', 'If a land card is milled this way', 'If at least one land card is milled this way']) {
      const f = spellFace(`Mill three cards. ${s}, draw a card.`);
      expect(fullyAutomated(f), s).toBe(true);
      expect(JSON.stringify(f.abilities), s).toContain('"cond":"exists"');
    }
    expect(jsonKey(spellFace('Mill three cards. If a land card was milled this way, draw a card.').abilities))
      .toBe(jsonKey(spellFace('Mill three cards. If a land card is milled this way, draw a card.').abilities));
    expect(automated(spellFace('If a land card was milled this way, draw a card.').abilities)).toBe(false);
    expect(automated(spellFace('Discard two cards. If a land card was milled this way, draw a card.').abilities)).toBe(false);
  });
  it('CR 701.17a, 608.2c: "the cards milled this way" is the same group as "the milled cards"', () => {
    const a = spellFace('Mill three cards. You may put a creature card from among the cards milled this way into your hand.');
    const b = spellFace('Mill three cards. You may put a creature card from among the milled cards into your hand.');
    expect(fullyAutomated(a)).toBe(true);
    expect(jsonKey(a.abilities)).toBe(jsonKey(b.abilities));
  });
  it('CR 202.3, 608.2c: a group described by mana value that lost its abilities is "those creatures" next (mana value does not change in layer 6)', () => {
    const f = spellFace('Each creature with mana value 2 or less loses all abilities until end of turn. Destroy those creatures.');
    expect(fullyAutomated(f)).toBe(true);
    const steps = (f.abilities[0] as { effect: { steps: { what?: unknown; effects?: { affects: unknown }[] }[] } }).effect.steps;
    expect(steps[1]!.what).toEqual(steps[0]!.effects![0]!.affects);
  });
  it('CR 201.5: a plural name takes a plural verb in an attack trigger ("Whenever ~ attack"), the object itself', () => {
    const f = creatureFace('Toph and Katara', 'Whenever Toph and Katara attack, put a +1/+1 counter on each tapped creature you control.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"attacker":{"self":true}');
  });
  it('CR 702.34a, 604.1: the flashback cost equal to the mana cost may be granted by a static ability too, and only to flashback with no cost of its own', () => {
    const ok = creatureFace('Example Sage', 'During your turn, each instant card in your graveyard has flashback. The flashback cost is equal to that card\'s mana cost.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"costIsManaCost":true');
    expect(automated(creatureFace('Example Sage', 'During your turn, each instant card in your graveyard has flashback {2}. The flashback cost is equal to that card\'s mana cost.').abilities)).toBe(false);
  });
  it('CR 508.1b, 603.2c: "whenever you attack a player [with one or more ...]" is a batch of the attackers of a player; another count, or a planeswalker, is not read', () => {
    for (const s of ['Whenever you attack a player with one or more Elves, you gain 1 life.', 'Whenever you attack a player, you gain 1 life.']) {
      const f = creatureFace('Example Scout', s);
      expect(fullyAutomated(f), s).toBe(true);
      expect(JSON.stringify(f.abilities), s).toContain('"defender":"any"');
      expect(JSON.stringify(f.abilities), s).toContain('"batch":true');
    }
    const elves = JSON.stringify(creatureFace('Example Scout', 'Whenever you attack a player with one or more Elves, you gain 1 life.').abilities);
    expect(elves).toContain('"subtypes":["Elf"]');
    expect(elves).toContain('"controller":"you"');
    // the declaration's count is of all its attackers, not of the ones at one player: only "one or more" is read with a player
    expect(automated(creatureFace('Example Scout', 'Whenever you attack a player with two or more Elves, you gain 1 life.').abilities)).toBe(false);
    expect(automated(creatureFace('Example Scout', 'Whenever you attack a planeswalker with one or more Elves, you gain 1 life.').abilities)).toBe(false);
    expect(JSON.stringify(creatureFace('Example Scout', 'Whenever you attack with one or more Elves, you gain 1 life.').abilities)).not.toContain('"defender"');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-tla design 6.10 (local index): synthetic examples', () => {
  it('no std-tla line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = TLA.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
