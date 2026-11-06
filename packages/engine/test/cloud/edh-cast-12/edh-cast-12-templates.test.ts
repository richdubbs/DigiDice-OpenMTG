/**
 * Commander lane edh-cast, round edh-cast-12: the template data of parser/templates/zz-cloud/edh-cast-12.json ("If you cast a creature spell this way, it gains haste until end of
 * turn" on a top-of-library cast permission, Thundermane Dragon; "If X is 5 or more, this spell can't be countered and the damage can't be prevented", Banefire) and the parser, renderer
 * and engine changes of the round (one test each at the end). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every
 * counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card
 * (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in edh-cast-12-scenarios.test.ts. CR cites from memory
 * unless named in the record (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhCast12 from '../../../src/parser/templates/zz-cloud/edh-cast-12.json';
import review from '../../m5/golden/cards/edh-cast-12-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';
import { isTopPermit } from '../../../src/statics/play-permits';

const MECH = edhCast12 as Template[];
const MECH_COUNT = 2;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only one
 * or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (decided by the owner's standing rule 2026-10-27).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'sta.edhc12.top.cast.gainsHaste': ['Thundermane Dragon'],
  'sta.edhc12.stack.xAtLeast.cantCounter.cantPrevent': ['Banefire'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (a sorcery); the others are abilities of a creature (static, triggered). */
const SPELL = new Set<string>(['sta.edhc12.stack.xAtLeast.cantCounter.cantPrevent']);
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id)
    ? parseCard(card('Example Plan', 'Sorcery', text), OPTS)
    : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-cast-12 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-cast-12.json, path order: after edh-cast-1, before edh-cast-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-cast-12.json');
    expect(files.indexOf('zz-cloud/edh-cast-12.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-cast-1.json'));
    expect(files.indexOf('zz-cloud/edh-cast-12.json')).toBeLessThan(files.indexOf('zz-cloud/edh-cast-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are eff.edhc12.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm|rst|trg)\.edhc12\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
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

describe('edh-cast-12 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bor more\b/, 'or less'], [/\bhaste\b/, 'flying'], [/\btop\b/, 'bottom'], [/\bonce\b/i, 'twice'], [/\bcast\b/, 'exile'], [/\bwithout paying its mana cost\b/, 'by paying its mana cost'], [/\bor less\b/, 'or more'], [/\bplay\b/, 'cast'], [/\battacked\b/, 'blocked'], [/\bspell\b/, 'ability'], [/\blife\b/, 'cards'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-cast-12 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-cast-12 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-cast-12 design 6.10 (local index): synthetic examples', () => {
  it('no edh-cast-12 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-cast-12 parser, renderer and engine changes (one test each)', () => {
  const face = (text: string, type = 'Sorcery', name = 'Example Plan') => parseCard(card(name, type, text, type.startsWith('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
  it("parser/holes/qty.ts, rules/history.ts (CR 202.3, 601.2i; Call Forth the Tempest): \"the total mana value of other spells you've cast this turn\" sums the cast history's mana values without the spell itself; without \"other\", or of spells another player cast, it is not read", () => {
    const base = "~ deals damage to each creature your opponents control equal to the total mana value of other spells you've cast this turn.";
    expect(fullyAutomated(face(base))).toBe(true);
    expect(JSON.stringify(face(base).abilities)).toContain('"sum":"manaValue"');
    expect(fullyAutomated(face(base.replace('other spells', 'spells')))).toBe(false);
    expect(fullyAutomated(face(base.replace("you've cast", 'your opponents have cast')))).toBe(false);
    expect(fullyAutomated(face(base.replace('the total mana value', 'the total power')))).toBe(false);
  });
  it('parser/lower/anaphora.ts, riders.ts, render/steps-flow.ts (CR 707.10, 707.10c, 614.15; Increasing Vengeance): "that spell" of the instead sentence is the target, not the copy; the option to choose new targets is on both branches and said once', () => {
    const text = 'Copy target instant or sorcery spell you control. If this spell was cast from a graveyard, copy that spell twice instead. You may choose new targets for the copies.';
    const f = face(text, 'Instant');
    expect(fullyAutomated(f)).toBe(true);
    expect((JSON.stringify(f.abilities).match(/"newTargets":"may"/g) ?? []).length).toBe(2);
    // the single-copy rider is unchanged
    expect(fullyAutomated(face('Copy target instant or sorcery spell you control. You may choose new targets for the copy.', 'Instant'))).toBe(true);
    // "twice instead" with another number or no restatement is no fold of this shape
    expect(fullyAutomated(face(text.replace('twice', 'three times'), 'Instant'))).toBe(true); // edh-cast-14: a fixed number of copies is read (eff.edhc14.copy.nTimes), the fold is the same
  });
  it("parser/holes/filter.ts, rules/filter.ts (CR 202.3, 404.1, 608.2b; Drown in the Loch): \"with mana value less than or equal to the number of cards in its controller's graveyard\" is the object's own comparison; other comparisons and the owner's graveyard are not read", () => {
    const base = "Counter target spell with mana value less than or equal to the number of cards in its controller's graveyard.";
    const f = face(base, 'Instant');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"manaValueVsGraveyard"');
    expect(fullyAutomated(face(base.replace('less than or equal to', 'greater than'), 'Instant'))).toBe(false);
    expect(fullyAutomated(face(base.replace('controller', 'owner'), 'Instant'))).toBe(false);
    expect(fullyAutomated(face(base.replace('Counter target spell', 'Destroy target creature'), 'Instant'))).toBe(true);
  });
  it('statics/play-permits.ts#isTopPermit (CR 611.2c, 702.10a): the haste rider is honored on a top-card CAST permission only, and only haste', () => {
    const p = { s: 'permit', who: { ref: 'you' }, action: 'cast', fromTop: true, of: { types: ['Creature'] }, gainsThisTurn: { kind: 'keyword', keyword: 'haste', text: 'haste' } } as const;
    expect(isTopPermit(p as never)).toBe(true);
    expect(isTopPermit({ ...p, gainsThisTurn: { kind: 'keyword', keyword: 'flying', text: 'flying' } } as never)).toBe(false);
    expect(isTopPermit({ ...p, action: 'play' } as never)).toBe(false);
  });
  it('render/stat.ts (CR 611.2c): the haste rider is said only for creature spells; for a permission of another kind of spell the card is not automated (fail closed)', () => {
    const tmpl = (what: string) => `You may cast ${what} from the top of your library. If you cast a creature spell this way, it gains haste until end of turn.`;
    expect(fullyAutomated(face(tmpl('creature spells with power 3 or greater'), 'Creature — Golem'))).toBe(true);
    expect(fullyAutomated(face(tmpl('artifact spells'), 'Creature — Golem'))).toBe(false);
    expect(fullyAutomated(face(tmpl('Elf spells'), 'Creature — Golem'))).toBe(false);
  });
});
