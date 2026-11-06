/**
 * Commander lane time-counters (concept round), edh-d-68: the template data of parser/templates/zz-cloud/edh-d-68.json ("put a time counter on it for each suspended card you own and each other
 * permanent you control with a time counter on it", Rose Tyler; "choose a suspended card you own and remove that many time counters from it", Amy Pond; "exile a card from your hand with a number of
 * time counters on it equal to its mana value", The Eleventh Doctor) and the parser, renderer and engine changes of the round (one test each at the end). Guard G9 (design 6.8): every example lowers
 * with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place
 * of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10). The behavior is in edh-d-68-scenarios.test.ts. CR cites from the 2026-09-25 text where marked.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhD68 from '../../../src/parser/templates/zz-cloud/edh-d-68.json';
import review from '../../m5/golden/cards/edh-d-68-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD68 as Template[];
const MECH_COUNT = 3;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only one
 * or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (decided by the owner's standing rule 2026-10-27).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhd68.counters.put.forEach.and': ['Rose Tyler'],
  'eff.edhd68.choose.suspended.removeThatMany': ['Amy Pond'],
  'eff.edhd68.exile.fromHand.withCountersEqualMv': ['The Eleventh Doctor'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (a sorcery); the others are abilities of a creature (static, triggered, replacement). */
const SPELL = new Set<string>([]);
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id)
    ? parseCard(card('Example Plan', 'Sorcery', text, { mana_cost: '{X}{R}' }), OPTS)
    : parseCard(card('Example Relic', 'Legendary Artifact Creature — Golem Villain', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-d-68 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-68.json, path order: after edh-d-6, before edh-d-7) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-68.json');
    expect(files.indexOf('zz-cloud/edh-d-68.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-d-6.json'));
    expect(files.indexOf('zz-cloud/edh-d-68.json')).toBeLessThan(files.indexOf('zz-cloud/edh-d-7.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are eff.edhd68.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm|rst|trg|rep)\.edhd68\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(12);
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

describe('edh-d-68 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-d-68 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-d-68 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (words.includes('--') && i < words.indexOf('--')) return; // the ability word before the dash has no rules meaning (CR 207.2c)
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

describe.skipIf(index === null)('edh-d-68 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-68 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-d-68 parser, renderer and engine changes (one test each)', () => {
  /** fully automated, and no cost part or step left to the controller (a manual cost is not an `op: manual`) */
  const full = (f: ReturnType<typeof parseCard>['faces'][number]) => fullyAutomated(f) && f.diagnostics.every((d) => d.level !== 'manual');
  const creature = (text: string) => parseCard(card('Example Relic', 'Legendary Artifact Creature — Golem Villain', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/holes/event.ts, render/evt.ts, effects (CR 122.1, 702.62a, 603.2; Watcher of Hours): "whenever you remove a time counter from ~ while it\'s exiled" is the removal by its controller, of the card itself, in exile', () => {
    const t = (w: string) => `Suspend 4--{1}{U}\nWhenever ${w} a time counter from this card while it\'s exiled, draw a card.`;
    expect(full(creature(t('you remove')))).toBe(true);
    expect(JSON.stringify(creature(t('you remove')).abilities)).toContain('"by":"you"');
    expect(full(creature(t('an opponent removes')))).toBe(false);
    expect(full(creature(t('you put')))).toBe(false);
    expect(full(creature('Whenever you remove a time counter from this card, draw a card.'))).toBe(false); // not while it is exiled: no reading
  });
  it('parser/lower/units.ts (guard G3): "for each time counter" is the counter kind, never the phrase "each time"; a real "each time" stays critical', () => {
    expect(full(creature('This creature gets +1/+1 for each time counter on it.'))).toBe(true);
    expect(full(creature('Whenever this creature attacks, draw a card each time.'))).toBe(false);
    expect(full(creature('This creature gets +1/+1 each time counter on it.'))).toBe(false);
  });
  it('parser/holes/cost.ts, rules/cost-pick.ts, render/costs.ts, render/np.ts (CR 702.62b, 118.3, 122.1; Rift Elemental): "remove a time counter from a permanent you control or suspended card you own" is a cost with the payer\'s choice among the two halves', () => {
    const t = (c: string) => `{1}{R}, Remove a time counter from ${c}: This creature gets +2/+0 until end of turn.`;
    expect(full(creature(t('a permanent you control or suspended card you own')))).toBe(true);
    expect(full(creature(t('a permanent you control or suspended card an opponent owns')))).toBe(false);
    expect(full(creature(t('a permanent you control')))).toBe(true); // (the older reading, unchanged)
  });
  it('render/qty.ts (CR 608.2h): "for each A and each B" is the sum of two counts, only for exactly two', () => {
    const t = (c: string) => `Whenever this creature attacks, put a time counter on it for each ${c}.`;
    expect(full(creature(t('creature you control and each land you control')))).toBe(true);
    expect(full(creature(t('creature you control and land you control')))).toBe(false);
  });
  it('front/labels.ts (CR 207.2d; The Eleventh Doctor): a title in capitals ending in "!" may have full stops; rules text with a full stop before a dash does not', () => {
    expect(full(creature('I. AM. TALKING! -- Whenever this creature attacks, draw a card.'))).toBe(true);
    expect(full(creature('You. May. Go. -- Whenever this creature attacks, draw a card.'))).toBe(false);
  });
});
