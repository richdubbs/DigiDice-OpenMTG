/**
 * Commander lane edh-c, round edh-c-16 (EDHREC ranks 19,376 to 20,000): the template data of parser/templates/zz-cloud/edh-c-16.json (a cost reduction during your end step, "roll a four-sided die", an
 * Aura's pump plus a lure in one sentence, "players can't search libraries" for a duration, "you may have ~ deal damage to <target> equal to <qty>") with guards G9 and G2 (design 6.8); behavior in
 * edh-c-16-scenarios.test.ts. Narrow wordings (design 6.9 deviation): each printed by one card of the EDHREC top 20,000 only. CR cites are from the Comprehensive Rules text of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC16 from '../../../src/parser/templates/zz-cloud/edh-c-16.json';
import reviewC16 from '../../m5/golden/cards/edh-c-16-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC16 as Template[];
const review = reviewC16 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 20,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'cm.edhv16.self.less.duringYourStep': ['Closing Statement'],
  'eff.edhv16.rollDie.fourSided': ['Arden Angel'],
  'sta.edhv16.attached.pumpgrant.lure': ['Indrik Umbra'],
  'eff.edhv16.cantSearch.dur': ['Shadow of Doubt'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (t: Template, text: string) =>
  parseCard(t.kind === 'static' ? card('Example Plan', 'Enchantment', text) : /^\{/.test(text) ? card('Example Plan', 'Artifact', text) : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-c-16 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-16.json, path order: edh-c-16 sorts before edh-c-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-16.json');
    expect(files.indexOf('zz-cloud/edh-c-16.json')).toBeLessThan(files.indexOf('zz-cloud/edh-c-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 10; ids are *.edhv16.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm)\.edhv16\./);
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

describe('edh-c-16 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bmay get\b/, 'get'], [/\btwo rad\b/, 'three rad'], [/\bDuring your turn\b/, 'During their turn'], [/\btoughness rather than its power\b/, 'power rather than its toughness'],
    [/\bpays \{X\}\b/, 'pays {1}'], [/\bcounters on that creature\b/, 'cards in your hand'], [/\bplaneswalkers you control\b/, 'planeswalkers'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-c-16 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-16 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-c-16 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-16 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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


/** The readings that are not templates: one test each (hole, lowering and renderer changes of the round), played as synthetic cards (design 6.10). */
const READINGS: { name: string; type: string; text: string; extra?: Partial<OracleCard> }[] = [
  // parser/holes/cond.ts + render/cond.ts: the day/night designation as a condition of a cost change
  { name: 'cost reduction at night', type: 'Sorcery', text: "This spell costs {2} less to cast if it's night.\nDraw a card." },
  { name: 'ability while it is day', type: 'Creature — Wizard', text: "~ has trample as long as it's day.", extra: { power: '2', toughness: '2' } },
  // parser/holes/cond.ts + render/cond.ts: an opponent's empty hand (`countPlayers.sizeIs`)
  { name: 'an opponent has no cards in hand', type: 'Creature — Wizard', text: '~ gets +2/+2 as long as an opponent has no cards in hand.', extra: { power: '2', toughness: '2' } },
  // parser/holes/cond.ts + render/cond.ts: counters of a kind put on a creature this turn (history)
  { name: 'put counters on a creature this turn', type: 'Creature — Knight', text: "As long as you've put one or more +1/+1 counters on a creature this turn, ~ has trample.", extra: { power: '2', toughness: '2' } },
  // render/steps-zones.ts: the two flags before the token words when the token has a quoted ability
  { name: 'tapped and attacking token with a quoted ability', type: 'Creature — Devil', text: 'Whenever ~ attacks, create a tapped and attacking 1/1 red Devil creature token with "When this token dies, it deals 1 damage to any target."', extra: { power: '2', toughness: '2' } },
  // parser/holes/cond.ts + lower/trigger-zone.ts + render/cond.ts: a trigger that functions in the graveyard and on the battlefield
  { name: 'in your graveyard or on the battlefield', type: 'Creature — Angel', text: 'At the beginning of your upkeep, if ~ is in your graveyard or on the battlefield, you may gain 1 life.', extra: { power: '2', toughness: '2' } },
  { name: 'in your graveyard (formerly automated reading)', type: 'Creature — Angel', text: 'At the beginning of your upkeep, if ~ is in your graveyard, you may gain 1 life.', extra: { power: '2', toughness: '2' } },
  // parser/holes/cond.ts + render/cond.ts: an Aura or an Equipment is attached to it
  { name: 'enchanted or equipped', type: 'Creature — Dwarf', text: "Whenever ~ becomes tapped, if it's enchanted or equipped, draw a card.", extra: { power: '2', toughness: '2' } },
];
describe('edh-c-16 readings (hole, lowering and renderer changes): synthetic cards are fully automated and pass the render gate', () => {
  for (const r of READINGS) {
    it(r.name, () => {
      const f = parseCard(card('Example Plan', r.type, r.text, r.extra), OPTS).faces[0]!;
      expect(fullyAutomated(f), `${JSON.stringify(f.diagnostics)}`).toBe(true);
      expect(f.gate.every((g) => g.ok), JSON.stringify(f.gate)).toBe(true);
    });
  }
  it('negatives: a word that is no designation, another zone, a counter kind that is no kind and a third attachment still fail closed', () => {
    for (const text of [
      "This spell costs {2} less to cast if it's dusk.\nDraw a card.",
      '~ gets +2/+2 as long as an opponent has no cards in exile.',
      'At the beginning of your upkeep, if ~ is in your graveyard or in exile, you may gain 1 life.',
      "Whenever ~ becomes tapped, if it's enchanted or sparkly, draw a card.",
      // (edh-c-103 reads "if it's enchanted" alone for the object of the trigger's event, so it is no longer a negative; "enchanted or sparkly" below still is)
      "Whenever ~ becomes tapped, if it's enchanted or equipped or fortified, draw a card.",
    ]) {
      const t = text.startsWith('This spell') ? 'Sorcery' : 'Creature — Angel';
      expect(fullyAutomated(parseCard(card('Example Plan', t, text, t === 'Sorcery' ? undefined : ({ power: '2', toughness: '2' } as Partial<OracleCard>)), OPTS).faces[0]!), text).toBe(false);
    }
  });
});
