/**
 * Phase 2 lane p2-coinflip, round p2-coinflip-2: the template data of parser/templates/zz-cloud/p2-coinflip-2.json ("draw N cards, then discard M cards at random";
 * "reveals a card at random from their hand, then loses life equal to that card's mana value"), the quantity "for each flip you won" (after "flip a coin until you
 * lose a flip") and the renderer's readings of them. Guard G9 (design 6.8): every example lowers with its template,
 * is automated and passes the exact render gate (G6); every counter-example does not give the same JSON; near-miss mutations fail or differ; a nonsense word in
 * place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10, checked against the local index when it is
 * present). CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import p2Coinflip2 from '../../../src/parser/templates/zz-cloud/p2-coinflip-2.json';
import review from '../../m5/golden/cards/cloud-p2-coinflip-2-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = p2Coinflip2 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
/** Design 6.9 deviation (narrow wordings, named in the round's record): stable on a golden card of the one or two cards of the whole index that print the wording
 * (the draw-then-discard's other card is held out: not read, not golden). */
const NARROW: Readonly<Record<string, string>> = {
  'eff.p2cf2.draw.thenDiscard.random': 'Noggle Ransacker',
  'eff.p2cf2.player.reveals.atRandom.thenLosesLife.mv': 'Singe-Mind Ogre',
};

/** Templates whose examples without a trigger are spell text (a sorcery); the others are abilities of a creature. */
const SPELL = new Set(MECH.map((t) => t.id));
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) && !/^(When|Whenever|At)\b/.test(text) ? parseCard(card('Example Plan', 'Sorcery', text), OPTS) : parseCard(card('Example Seer', 'Creature — Human Wizard', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('p2-coinflip-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler in path order (zz-cloud/p2-coinflip-1.json, then zz-cloud/p2-coinflip-2.json, before zz-cloud/p2-copy-perm-1.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-coinflip-2.json');
    expect(files.indexOf('zz-cloud/p2-coinflip-1.json')).toBeLessThan(files.indexOf('zz-cloud/p2-coinflip-2.json'));
    expect(files.indexOf('zz-cloud/p2-coinflip-2.json')).toBeLessThan(files.indexOf('zz-cloud/p2-copy-perm-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.p2cf2.*', () => {
    expect(MECH.length).toBe(2);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.p2cf2\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three hand-verified golden cards that name it, or (a recorded deviation) the one card that prints a narrow wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) expect(cards, t.id).toContain(NARROW[t.id]);
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'random', 'except', 'then']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('p2-coinflip-2 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
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
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\bat random\b/, 'of their choice'], [/\btheir hand\b/, 'their graveyard'], [/\bthen\b/, 'and'], [/\bdiscards\b/, 'exiles'], [/\bdraws\b/, 'mills'],
    [/\bloses life\b/, 'gains life'], [/\bmana value\b/, 'power'], [/\btwo cards\b/, 'two creature cards'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-coinflip-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/twice/if able" or a swapped key word never gives the example's JSON`, () => {
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

describe('p2-coinflip-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
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

describe.skipIf(index === null)('p2-coinflip-2 design 6.10 (local index): synthetic examples', () => {
  it('no example or counter-example line is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

const creature = (text: string) => parseCard(card('Example Seer', 'Creature — Human Wizard', text, { power: '1', toughness: '1' }), OPTS).faces[0]!;

describe('p2-coinflip-2 parser and renderer changes (one test each)', () => {
  it('parser/holes/qty.ts, lower/quantities.ts (CR 705.2): "for each flip you won" counts the won flips of the "flip a coin until you lose a flip" before it; with no such flip it is no quantity (fail closed)', () => {
    const f = creature('At the beginning of your upkeep, flip a coin until you lose a flip. Put a +1/+1 counter on ~ for each flip you won.');
    expect(f.gate.every((g) => g.ok), JSON.stringify(f.gate)).toBe(true);
    expect(automated(f.abilities), JSON.stringify(f.diagnostics)).toBe(true);
    expect(fullyAutomated(creature('At the beginning of your upkeep, flip a coin. Put a +1/+1 counter on ~ for each flip you won.'))).toBe(false);
  });
  it('render/fold-p2coinflip1.ts (CR 119.3): "each opponent reveals a card at random from their hand, then loses life equal to that card\'s mana value" is no single-player reveal: manual (fail closed)', () => {
    expect(fullyAutomated(parseCard(card('Example Plan', 'Sorcery', "Each opponent reveals a card at random from their hand, then loses life equal to that card's mana value."), OPTS).faces[0]!)).toBe(false);
  });
  it('the random discard of "each player draws a card, then discards a card at random" is one card of each player\'s own hand (CR 701.9b), not a choice', () => {
    const f = creature('When ~ enters, each player draws a card, then discards a card at random.');
    expect(JSON.stringify(f.abilities)).toContain('"mode":"random"');
  });
});
