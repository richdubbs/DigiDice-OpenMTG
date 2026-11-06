/**
 * Must-finish round edh-next-126 (library, manifest and the rest; code edhn126): the template data of parser/templates/zz-cloud/edh-next-126.json, tested here and in
 * edh-next-126-scenarios.test.ts. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not
 * parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are
 * synthetic wordings (design 6.10). CR cites checked against MagicCompRules 20260925.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhNext126 from '../../../src/parser/templates/zz-cloud/edh-next-126.json';
import review from '../../m5/golden/cards/edh-next-126-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { lintAbility } from '../../../src/model/lint';

const MECH = edhNext126 as Template[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only
 * one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT, owner instruction 2026-10-21).
 * Each wording is printed on one card: Lim-Dûl's Vault; Light-Paws, Emperor's Voice; Kozilek, the Broken Reality (two templates).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhn126.vault.lookPayBottomRepeat': ["Lim-Dûl's Vault"],
  'eff.edhn126.maySearch.putThatCardAttachedTo': ["Light-Paws, Emperor's Voice"],
  'eff.edhn126.players.eachManifestFromHand': ['Kozilek, the Broken Reality'],
  'eff.edhn126.draw.forEachManifestedThisWay': ['Kozilek, the Broken Reality'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });

/** A synthetic card with the example as its ability: a static ability on an enchantment creature, a trigger on an artifact creature. */
const parsedWith = (t: Template, text: string) => parseCard(
  /^(Whenever|When|At the beginning)/.test(text) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : t.kind === 'static' ? card('Example Shrine', 'Enchantment', text) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-126 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-126.json, path order: after edh-next-12.json, before edh-next-13.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-126.json');
    expect(files.indexOf('zz-cloud/edh-next-126.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-12.json'));
    expect(files.indexOf('zz-cloud/edh-next-126.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-13.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhn126.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|kw)\.edhn126\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the cards that print the wording', () => {
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

describe('edh-next-126 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const swaps: [RegExp, string][] = [[/graveyard/, 'hand'], [/exiling/, 'discarding'], [/sacrificing/, 'discarding'], [/tapped/, 'untapped'], [/mutate/, 'flashback']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-126 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-126 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // a counter kind is any word (CR 122.1b)
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});


describe('edh-next-126 engine model changes (one test per change)', () => {
  const errors = (x: unknown) => lintAbility(x as Parameters<typeof lintAbility>[0]).filter((i) => i.severity === 'error').map((i) => i.code);
  const look = (extra: Record<string, unknown>) => ({ op: 'look', who: { ref: 'you' }, at: { ref: 'topCards', player: { ref: 'you' }, count: 3 }, ...extra });
  const spell = (steps: unknown[]) => ({ kind: 'spell', text: 'x', effect: { targets: [], steps } });
  it('CR 608.2c (op:look.rebind): a look may name a group an earlier look bound again only with `rebind`; `rebind` with no earlier binding is refused', () => {
    expect(errors(spell([look({ as: 'g' }), look({ as: 'g', rebind: true })]))).toEqual([]);
    expect(errors(spell([look({ as: 'g' }), look({ as: 'g' })]))).toContain('duplicate-name');
    expect(errors(spell([look({ as: 'g', rebind: true })]))).toContain('unbound-name');
  });
  it('the Vault paragraph is joined into one unit only in its exact shape (parser/lower/join-edhn126.ts): another count word in the repeat stays manual', () => {
    const f = parseCard(card('Example Vault', 'Instant', 'Look at the top four cards of your library. As many times as you choose, you may pay 1 life, put those cards into your hand, then look at the top four cards of your library. Then shuffle and put the last cards you looked at this way on top in any order.'), OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(false);
  });
  it('CR 115.1 (feature:target.equalToughness): "with equal toughness" is read only for several targets; one target stays unread', () => {
    const several = parseCard(card('Example Volley', 'Instant', 'Destroy up to two target creatures with equal toughness.'), OPTS).faces[0]!;
    expect(fullyAutomated(several)).toBe(true);
    expect(JSON.stringify(several.abilities)).toContain('"equalToughness":true');
    expect(fullyAutomated(parseCard(card('Example Shot', 'Instant', 'Destroy target creature with equal toughness.'), OPTS).faces[0]!)).toBe(false);
  });
  it('CR 601.2i (qty:asCast): "as you cast" is read only of the spell itself, with no controller of its own in the description', () => {
    expect(fullyAutomated(parseCard(card('Example Surge', 'Sorcery', 'Draw X cards, where X is the greatest power among creatures you controlled as you cast this spell.'), OPTS).faces[0]!)).toBe(true);
    // review finding (edh-next-126): a permanent's triggered ability never has a cast record of its own, so the reading stays manual there (model/lint-nodes.ts)
    expect(fullyAutomated(parseCard(card('Example Hound', 'Creature — Dog', 'When Example Hound enters, draw X cards, where X is the greatest power among creatures you controlled as you cast Example Hound.', { power: '2', toughness: '2' }), OPTS).faces[0]!)).toBe(false);
    expect(fullyAutomated(parseCard(card('Example Lapse', 'Sorcery', 'Draw X cards, where X is the greatest power among creatures your opponents control you controlled as you cast this spell.'), OPTS).faces[0]!)).toBe(false);
  });
});
