/**
 * Coordinator D, round edh-d-40 (lane d-leftovers): the template data of parser/templates/zz-cloud/edh-d-40.json and the round's parser, lowering, engine and renderer changes,
 * tested at the end of this file and in edh-d-40-scenarios.test.ts.
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
import edhD40 from '../../../src/parser/templates/zz-cloud/edh-d-40.json';
import review from '../../m5/golden/cards/edh-d-40-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD40 as Template[];
const MECH_COUNT = 2;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full
  'eff.edhd40.return.fromGraveyard.thenAttachIt': ['Ratonhnhaké꞉ton'],
  'sta.edhd40.enchanted.otherPlayerControls.cantAttackBlock.otherwise.has': ['Dog Umbra'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  /enchanted/i.test(text) && t.kind === 'static' ? card('Example Subject', 'Enchantment — Aura', text) : t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || text.startsWith('~') ? card('Example Subject', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-d-40 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-40.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-40.json');
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhd40.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|rst|trg|ch|rid|ab)\.edhd40\./);
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

describe('edh-d-40 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bhaste\b/, 'x'], [/\bblocked\b/, 'x'], [/\buntapped\b/, 'x'], [/\btoughness\b/, 'power'], [/\battack\b/, 'block'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-d-40 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-d-40 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-d-40 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-40 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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


/** The readings of this round that are holes of the parser, not templates (a condition, an "it", an "other"): each parses to the JSON shown and passes the render gate. */
const lone = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Subject', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
describe('edh-d-40 holes: "<~> hasn\'t dealt damage yet", "it" after it, and "each other creature" in an attack trigger of an Equipment', () => {
  it('"As long as ~ hasn\'t dealt damage yet, it has hexproof and can\'t be blocked." is the not-happened damage condition on itself (CR 120.1, 400.7), with "it" being ~', () => {
    const f = lone('Creature — Human', "As long as ~ hasn't dealt damage yet, it has hexproof and can't be blocked.", ['2', '2']);
    expect(fullyAutomated(f)).toBe(true);
    const a = f.abilities[0] as unknown as { condition: unknown; effects: { s: string; affects?: unknown; subject?: unknown }[] };
    expect(a.condition).toEqual({ cond: 'not', of: { cond: 'happened', event: { ev: 'damage', source: { self: true } }, scope: 'game' } });
    expect(a.effects.map((e) => JSON.stringify(e.affects ?? e.subject))).toEqual(['{"ref":"self"}', '{"ref":"self"}']);
  });
  it('the combat-damage form is the same condition with combat: true, and another object\'s name is no reading of it', () => {
    const f = lone('Creature — Human', "As long as ~ hasn't dealt combat damage yet, ~ has hexproof and can't be blocked.", ['2', '2']);
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities[0])).toContain('"combat":true');
    expect(fullyAutomated(lone('Creature — Human', "As long as target creature hasn't dealt damage yet, ~ has hexproof and can't be blocked.", ['2', '2']))).toBe(false);
    expect(fullyAutomated(lone('Creature — Human', "As long as ~ hasn't dealt damage this turn, it has hexproof and can't be blocked.", ['2', '2']))).toBe(false);
  });
  it('"it gets +1/+1 until end of turn for each other creature you control" in the attack trigger of an Equipment excludes the attacking creature (CR 109.2, 508.1)', () => {
    const f = lone('Artifact — Equipment', 'Whenever equipped creature attacks alone, it gets +1/+1 until end of turn for each other creature you control.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities[0])).toContain('"not":{"is":{"ref":"event","role":"subject"}}');
    // review: an "it" that is a target or a token an earlier sentence made is not the attacker, so "other" is not read as other than the attacker
    expect(fullyAutomated(lone('Artifact — Equipment', 'Whenever equipped creature attacks, tap target creature defending player controls. It gets -1/-1 until end of turn for each other creature you control.'))).toBe(false);
    expect(fullyAutomated(lone('Artifact — Equipment', 'Whenever equipped creature attacks, create a 1/1 white Soldier creature token. It gets +1/+1 until end of turn for each other creature you control.'))).toBe(false);
    // not for a creature's own trigger with a group it can be in (another reading of "other"), nor for a plain group of the attacker's description in a batch
    expect(fullyAutomated(lone('Creature — Human', 'Whenever one or more creatures you control attack, they get +1/+1 until end of turn for each other creature you control.', ['2', '2']))).toBe(false);
  });
});
