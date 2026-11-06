/**
 * Commander lane edh-perms, round edh-perms-20: the template data of parser/templates/zz-cloud/edh-perms-20.json ("return it to the battlefield under your control with an
 * additional counter on it") and the round's parser, lowering and renderer changes, tested at the end of this file and in
 * edh-perms-20-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. CR cites checked against the Comprehensive Rules of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhPm20 from '../../../src/parser/templates/zz-cloud/edh-perms-20.json';
import review from '../../m5/golden/cards/edh-perms-20-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhPm20 as Template[];
const MECH_COUNT = 1;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full
  'eff.edhpm20.return.bf.control.additionalCounters': ['Grave Betrayal'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a trigger on an enchantment, an activated ability on an artifact creature. */
const parsedWith = (_t: Template, text: string) => {
  if (/^(At the beginning|Whenever)/.test(text)) return parseCard(card('Example Relic', 'Enchantment', text), OPTS).faces[0]!;
  return parseCard(card('Example Relic', 'Sorcery', text), OPTS).faces[0]!;
};

describe('edh-perms-20 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-perms-20.json, path order: after edh-perms-2, before edh-perms-3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-perms-20.json');
    expect(files.indexOf('zz-cloud/edh-perms-20.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-perms-2.json'));
    expect(files.indexOf('zz-cloud/edh-perms-20.json')).toBeLessThan(files.indexOf('zz-cloud/edh-perms-3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.edhpm20.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|trg)\.edhpm20\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
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

describe('edh-perms-20 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/during your turn/, 'during any turn'], [/or an?/, 'and an'], [/from your hand/, 'from your graveyard'], [/another/, 'two'], [/onto the battlefield/, 'into your hand'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-perms-20 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-perms-20 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
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

describe.skipIf(index === null)('edh-perms-20 design 6.10 (local index): synthetic examples', () => {
  it('no edh-perms-20 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-perms-20 parser, lowering and renderer changes (one test each)', () => {
  const spell = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
  const creature = (text: string, type = 'Creature — Construct') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  const enchantment = (text: string) => parseCard(card('Example Relic', 'Enchantment', text), OPTS).faces[0]!;
  it('parser/lower/quantities.ts#movedGroups + render/moved.ts (CR 701.21a, 608.2c, 608.2h): "the greatest power among creatures sacrificed this way" is the stat of what ONE earlier sacrifice sacrificed; another earlier instruction or a different description is not read', () => {
    const ok = enchantment('When this enchantment enters, each opponent sacrifices a creature. You gain life equal to the greatest power among creatures sacrificed this way.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"agg":"max"');
    expect(fullyAutomated(enchantment('When this enchantment enters, destroy target creature. You gain life equal to the greatest power among creatures sacrificed this way.'))).toBe(false);
    expect(fullyAutomated(enchantment('When this enchantment enters, each opponent sacrifices a creature. You gain life equal to the greatest power among artifact creatures sacrificed this way.'))).toBe(false);
    expect(fullyAutomated(enchantment('When this enchantment enters, each opponent sacrifices a land. You gain life equal to the greatest power among creatures sacrificed this way.'))).toBe(false);
    expect(fullyAutomated(enchantment('When this enchantment enters, each opponent sacrifices a creature. You gain life equal to the greatest power among creatures sacrificed this way.\nWhen this enchantment leaves the battlefield, each player sacrifices a creature.'))).toBe(true);
  });
  it('parser/holes/moved-words.ts + lower/quantities.ts + context.ts + render/qty.ts (CR 603.2c, 701.17a): "the number of <cards> milled this way" in a mill trigger is the amount of the triggering batch, only for the trigger\'s own description', () => {
    const ok = enchantment('Whenever one or more nonland cards are milled, put a +1/+1 counter on each of up to X target creatures, where X is the number of nonland cards milled this way.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"wholeBatch":true');
    expect(JSON.stringify(ok.abilities)).toContain('"max":{"q":"eventAmount"}');
    expect(fullyAutomated(enchantment('Whenever one or more nonland cards are milled, put a +1/+1 counter on each of up to X target creatures, where X is the number of creature cards milled this way.'))).toBe(false);
    expect(fullyAutomated(enchantment('Whenever one or more cards are milled, put a +1/+1 counter on each of up to X target creatures, where X is the number of nonland cards milled this way.'))).toBe(false);
    expect(fullyAutomated(enchantment('Whenever one or more nonland cards are milled, put a +1/+1 counter on each of up to X target creatures, where X is the number of nonland cards discarded this way.'))).toBe(false);
    expect(fullyAutomated(enchantment('Whenever you discard one or more cards, put a +1/+1 counter on each of up to X target creatures, where X is the number of nonland cards milled this way.'))).toBe(false);
    // a single "a card is milled" trigger is not a batch: no wholeBatch
    expect(JSON.stringify(enchantment('Whenever a nonland card is milled, draw a card.').abilities)).not.toContain('wholeBatch');
  });
  it('parser/holes/filter.ts + rules/filter.ts + render/np.ts (CR 603.10a, 608.2h): "an Aura you controlled that was attached to it" counts the Auras that were attached as the creature left; "you control" or another host is not that', () => {
    const ok = enchantment('Whenever an enchanted creature dies, draw a card for each Aura you controlled that was attached to it.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"wasAttachedTo"');
    expect(JSON.stringify(ok.abilities)).toContain('"zone":"any"');
    expect(fullyAutomated(enchantment('Whenever an enchanted creature dies, draw a card for each Aura you control that was attached to it.'))).toBe(false);
    expect(fullyAutomated(enchantment('Whenever an enchanted creature dies, draw a card for each Aura an opponent controlled that was attached to it.'))).toBe(false);
  });
  it('parser/holes/qty.ts (CR 121.2, 608.2c): "for each card drawn this way" counts what the ONE earlier draw drew; with no earlier draw it is not read', () => {
    const ok = enchantment('When this enchantment enters, each opponent draws a card. Put a time counter on this enchantment for each card drawn this way.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"q":"resultCount"');
    expect(fullyAutomated(enchantment('When this enchantment enters, put a time counter on this enchantment for each card drawn this way.'))).toBe(false);
  });
  it('parser/lower/delay-tail.ts + render/steps-lasting.ts (CR 603.7, 400.7): a sentence that names only what a trailing delayed trigger returns is an instruction of that trigger; one that names something else stays outside', () => {
    const ok = enchantment("Whenever a creature you don't control dies, return it to the battlefield under your control with an additional +1/+1 counter on it at the beginning of the next end step. That creature is a black Zombie in addition to its other colors and types.");
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toMatch(/"op":"delay".*"op":"effect".*"subtypes"/);
    // a sentence after the delay that does not name the returned object is its own (now) instruction
    const other = enchantment("Whenever a creature you don't control dies, return it to the battlefield under your control at the beginning of the next end step. You gain 2 life.");
    expect(JSON.stringify(other.abilities)).not.toMatch(/"op":"delay".*"op":"gainLife"[^]*"op":"gainLife"/);
    const delay = (other.abilities[0] as { effect?: { steps?: { op: string }[] } }).effect?.steps ?? [];
    expect(delay.map((x) => x.op)).toEqual(['delay', 'gainLife']);
  });
  it('rules/filter.ts, effects/eval.ts, triggers/context.ts: nothing about the older readings changed (see the scenarios)', () => {
    expect(creature('Flying').abilities.length).toBeGreaterThan(0);
  });
});
