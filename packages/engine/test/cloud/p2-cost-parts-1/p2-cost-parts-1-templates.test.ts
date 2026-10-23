/**
 * p2-cost-parts-1 (lane p2-cost-parts: cost parts and payments): the template data of parser/templates/zz-cloud/p2-cost-parts-1.json (a choice of three
 * additional costs, "As an additional cost to cast ~, sacrifice a creature, discard a card, or pay 4 life"), and the round's parser, renderer and engine changes:
 * the cost part `untapTapped` ("Untap two tapped creatures you control"), "Remove N <kind> counters from ~ and sacrifice it / exile it / return it to its owner's
 * hand" (two parts on ~), "Tap enchanted creature" (tapUntapped of the attached permanent) and "Activate only if enchanted creature is untapped" read at
 * announcement (announce.matches.attachedTo).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in p2-cost-parts-1-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import p2cp1 from '../../../src/parser/templates/zz-cloud/p2-cost-parts-1.json';
import ownReview from '../../m5/golden/cards/p2-cost-parts-1-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = p2cp1 as Template[];
const MECH_COUNT = 1;
/** The golden cards of the round: its own review file, and the entries it updated or added in the review files of the cards' earlier rounds (guide section 6). */
const review = [...ownReview] as { card: string; verified: string; expect?: string }[];
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one card only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'cm.p2cp1.additional.choiceOfThree': 'Dusk Mangler',
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic sorcery whose first line is the example (an additional cost of the spell). */
const parsedWith = (_t: Template, text: string) => parseCard(card('Example Rite', 'Sorcery', `${text}
Draw a card.`), OPTS).faces[0]!;

describe('p2-cost-parts-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-cost-parts-1.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-cost-parts-1.json');
    expect(files.indexOf('zz-cloud/p2-cost-parts-1.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/p2-cost-parts-1.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are cm.p2cp1.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^cm\.p2cp1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = review;
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) expect(cards, t.id).toContain(NARROW[t.id]);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of ownReview as { card: string; expect?: string }[]) expect(g.expect, g.card).toBe('full');
    for (const c of Object.values(NARROW)) expect(golden.find((g) => g.card === c)?.expect, c).toBe('full');
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

describe('p2-cost-parts-1 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bmay\b/, 'must'], [/\bremains tapped\b/, 'remains untapped'], [/\bcharge counter\b/, 'charge counters'], [/\bfirst\b/, 'second'], [/\bless\b/, 'more'],
    [/\bhexproof\b/, 'shroud'], [/\bdon't trigger\b/, 'trigger'], [/\bpower\b/, 'toughness'], [/\battack as though\b/, 'block as though'],
    [/\bactivated abilities of all\b/, 'triggered abilities of all'], [/\bany color\b/, 'any type'], [/\byou control\b/, 'an opponent controls'],
    [/\bany number of\b/, 'all'], [/\bin addition to\b/, 'instead of'], [/\blose control\b/, 'gain control'],
    [/\bface down\b/, 'face up'], [/\bturned face up\b/, 'turned face down'], [/\bloses all abilities\b/, 'loses flying'], [/\bartifact creature\b/, 'enchantment creature'],
    [/\bcreature spells you control\b/, 'creature spells you own'], [/\bcreature cards you own\b/, 'creature cards you control'], [/\baren't on the battlefield\b/, 'are on the battlefield'],
    [/\bnamed\b/, 'called'], [/\bis tapped\b/, 'is untapped'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-cost-parts-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('p2-cost-parts-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('p2-cost-parts-1 design 6.10 (local index): synthetic examples', () => {
  it('no p2-cost-parts-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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


const json = (v: unknown): string => JSON.stringify(v);
const artifact = (text: string) => parseCard(card('Example Engine', 'Artifact', text), OPTS).faces[0]!;
const aura = (text: string) => parseCard(card('Example Charm', 'Enchantment — Aura', `Enchant creature you control\n${text}`), OPTS).faces[0]!;

describe('p2-cost-parts-1 cost hole (CR 118.3, 701.26b): "Untap N tapped <permanents> you control" is the part untapTapped', () => {
  it('a fixed count of tapped permanents you control, with the filter of the noun phrase', () => {
    const f = artifact('{T}, Untap two tapped green creatures you control: Draw a card.');
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f.abilities)).toContain('{"kind":"untapTapped","filter":{"colors":["G"],"types":["Creature"],"controller":"you"},"count":2}');
  });
  it('"tapped" and "you control" must be stated; "any number of" and "another" are not read', () => {
    for (const t of ['{T}, Untap two creatures you control: Draw a card.', '{T}, Untap two tapped creatures: Draw a card.', '{T}, Untap any number of tapped creatures you control: Draw a card.',
      '{T}, Untap another tapped creature you control: Draw a card.', '{T}, Untap two tapped creatures an opponent controls: Draw a card.']) {
      // the words stay a manual cost part (the controller confirms it, CR 733.1; the card is then partial), never untapTapped
      const f = artifact(t);
      expect(json(f.abilities), t).not.toContain('untapTapped');
      expect(json(f.abilities), t).toContain('"kind":"manual"');
    }
  });
});

describe('p2-cost-parts-1 cost hole and renderer (CR 118.3, 602.2b): "Remove N counters from ~ and sacrifice it" is two parts on ~', () => {
  it('sacrifice it, exile it, return it to its owner\'s hand', () => {
    const cases: [string, string][] = [
      ['and sacrifice it', '{"kind":"sacrifice","filter":{"self":true},"count":1,"self":true}'],
      ['and exile it', '{"kind":"exileFrom","zone":"battlefield","count":1,"self":true}'],
      ["and return it to its owner's hand", '{"kind":"returnToHand","filter":{"self":true},"count":1,"self":true}'],
    ];
    for (const [tail, part] of cases) {
      const f = artifact(`Remove two charge counters from this artifact ${tail}: Draw a card.`);
      expect(fullyAutomated(f), tail).toBe(true);
      expect(json(f.abilities), tail).toContain(`"other":[{"kind":"removeCounters","counter":"charge","count":2,"self":true},${part}]`);
    }
  });
  it('only after a part on ~: "it" never reads another object ("from target artifact ... and sacrifice it", "and sacrifice them")', () => {
    for (const t of ['Remove two charge counters from target artifact and sacrifice it: Draw a card.', 'Remove two charge counters from this artifact and sacrifice them: Draw a card.',
      'Remove two charge counters from among artifacts you control and sacrifice it: Draw a card.']) {
      const f = artifact(t);
      expect(json(f.abilities), t).not.toContain('"kind":"sacrifice"');
      expect(json(f.abilities), t).toContain('"kind":"manual"');
    }
  });
});

describe('p2-cost-parts-1 cost hole (CR 303.4, 602.5b): "Tap enchanted creature" of an Aura', () => {
  it('taps the permanent the Aura is attached to; the restriction "Activate only if enchanted creature is untapped" is read at announcement', () => {
    const f = aura('Tap enchanted creature: You gain 1 life. Activate only if enchanted creature is untapped.');
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f.abilities)).toContain('{"kind":"tapUntapped","filter":{"is":{"ref":"attachedTo"}},"count":1}');
    expect(json(f.abilities)).toContain('"onlyIf":{"cond":"matches","object":{"ref":"attachedTo"},"filter":{"tapped":false}}');
  });
  it('a bare "Tap enchanted" is not read', () => {
    const f = aura('Tap enchanted: You gain 1 life.');
    expect(json(f.abilities)).not.toContain('attachedTo');
  });
});
