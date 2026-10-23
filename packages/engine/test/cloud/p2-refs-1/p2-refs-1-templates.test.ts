/**
 * p2-refs-1 (Phase 2 lane p2-refs): the template data of parser/templates/zz-cloud/p2-refs-1.json (the plural "return the exiled cards" of a linked exile, CR 607.2a;
 * "<player> exiles all cards from their hand face down, then draws that many cards"), and the round's parser and renderer changes: the card a spell's reveal
 * additional cost revealed is "the revealed card" (`{ref:'costRevealed'}`, parser/lower/ability.ts#revealedMentions), render/steps-zones.ts (family
 * linked-exiled-battlefield-plural), render/fold-p2refs1.ts. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render
 * gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an
 * example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is
 * in p2-refs-1-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import p2Refs1 from '../../../src/parser/templates/zz-cloud/p2-refs-1.json';
import review from '../../m5/golden/cards/cloud-p2-refs-1-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = p2Refs1 as Template[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because the tuning half of the
 * index prints the wording on fewer than three cards this round makes full, with their template tests (G9, G2) and played scenarios. Listed in the round's record.
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.p2refs1.linked.return.hand.owner': ['Hypnox', 'Induced Amnesia'],
  'eff.p2refs1.linked.return.battlefield.owners': ['Petradon'],
  'eff.p2refs1.linked.return.battlefield.tapped.owners': ['Realm Razer'],
  'eff.p2refs1.player.exilesHand.faceDown.drawsThatMany': ['Induced Amnesia'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Codex', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const parsedWith = (_t: Template, text: string) => (/^(When|At) /.test(text) ? face('Creature — Golem', text, ['2', '2']) : face('Sorcery', text));
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');

describe('p2-refs-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-refs-1.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-refs-1.json');
    expect(files.indexOf('zz-cloud/p2-refs-1.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/p2-refs-1.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.p2refs1.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.p2refs1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the cards that print the wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id};`) || g.verified.includes(`(${t.id})`) || g.verified.includes(` ${t.id},`) || g.verified.includes(`(${t.id},`) || g.verified.includes(` ${t.id})`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) expect(cards, t.id).toEqual(expect.arrayContaining([...NARROW[t.id]!]));
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'when']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('p2-refs-1 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [[/their owners?'s? control/, 'your control'], [/their owner's hand/, 'your hand'], [/the exiled cards/, 'the exiled card'], [/ tapped under/, ' untapped under'], [/face down/, 'face up'], [/that many cards/, 'two cards'], [/from their hand/, 'from their graveyard'], [/all cards/, 'a card']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-refs-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
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

describe('p2-refs-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w)) return;
          const end = w.match(/[.,:]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('p2-refs-1 design 6.10 (local index): synthetic examples', () => {
  it('no p2-refs-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment|permanent)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

// ---- parser/lower/ability.ts#revealedMentions, render/refs.ts, render/qty.ts ------------------------------------------------------------------------------

describe('p2-refs-1 parser (CR 601.2b, 701.20a): "the revealed card" of a spell is what its reveal additional cost revealed', () => {
  const COST = 'As an additional cost to cast this spell, reveal a creature card from your hand.';
  it('"the revealed card\'s mana value" reads {ref:costRevealed}, and renders back as Oracle prints it', () => {
    const f = face('Instant', `${COST}\nYou gain life equal to the revealed card's mana value.`);
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"of":{"ref":"costRevealed"}');
  });
  it('without a reveal cost, or with a cost that reveals this card or two cards, the words name nothing: the spell is not automated', () => {
    expect(fullFace(face('Instant', "You gain life equal to the revealed card's mana value."))).toBe(false);
    expect(fullFace(face('Instant', "As an additional cost to cast this spell, reveal two creature cards from your hand.\nYou gain life equal to the revealed card's mana value."))).toBe(false);
  });
  it('an activated or triggered ability never reads it (it paid no such cost; model/lint-nodes.ts)', () => {
    expect(fullFace(face('Creature — Golem', `When ~ enters, you gain life equal to the revealed card's mana value.`, ['2', '2']))).toBe(false);
  });
});
