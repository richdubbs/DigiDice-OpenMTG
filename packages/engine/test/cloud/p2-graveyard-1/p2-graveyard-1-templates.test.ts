/**
 * p2-graveyard-1 (Phase 2 lane p2-graveyard: graveyard casts and returns): the template data of parser/templates/zz-cloud/p2-graveyard-1.json ("You may cast ~ from your
 * graveyard using its blitz / bestow ability", "Return to the battlefield / to your hand all <cards>", "put a <card> from a graveyard onto the battlefield tapped under your
 * control", "As long as <condition>, ~ gets <pt>, is <color>, and has <abilities>"), and the round's renderer changes ("dies or is put into exile" of any permanent and
 * "that card" after it, the destination first for groups and your hand, a color set anywhere in a static ability's list).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in p2-graveyard-1-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import gy1 from '../../../src/parser/templates/zz-cloud/p2-graveyard-1.json';
import ownReview from '../../m5/golden/cards/p2-graveyard-1-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = gy1 as Template[];
const MECH_COUNT = 6;
const review = ownReview as { card: string; verified: string; expect?: string }[];
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because the tuning half prints the
 * wording on one or two cards only, with their template tests (G9, G2) and played scenarios. Listed in the round's record (DECIDED BY DEFAULT, owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, string>> = {
  'sta.p2gy1.castWith.graveyard.blitz': 'Tenacious Underdog',
  'sta.p2gy1.castWith.graveyard.bestow': "Detective's Phoenix",
  'eff.p2gy1.return.toBattlefield.lead.group': "Faith's Reward",
  'eff.p2gy1.return.toHand.lead.group': 'No Rest for the Wicked',
  'eff.p2gy1.put.fromAGraveyard.tapped': 'Soul of Windgrace',
  'sta.p2gy1.aslong.pump.color.grant': 'Possessed Nomad',
};
/**
 * design 6.10 (DECIDED BY DEFAULT, owner instruction 2026-10-21): the two cast permissions are one fixed Oracle sentence with no hole, so no synthetic wording of them
 * exists; their examples print that sentence beside invented keyword costs, and the check below skips only that sentence (a bare keyword line is a real line too).
 */
const FIXED_WORDING: Readonly<Record<string, string>> = {
  'sta.p2gy1.castWith.graveyard.blitz': 'You may cast ~ from your graveyard using its blitz ability.',
  'sta.p2gy1.castWith.graveyard.bestow': 'You may cast ~ from your graveyard using its bestow ability.',
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a creature's static or trigger, a sorcery's effect. */
const parsedWith = (t: Template, text: string) => {
  if (t.id.startsWith('eff.p2gy1.return')) return parseCard(card('Example Recall', 'Sorcery', text), OPTS).faces[0]!;
  return parseCard(card('Example Lurker', 'Creature — Human', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
};

describe('p2-graveyard-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-graveyard-1.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-graveyard-1.json');
    expect(files.indexOf('zz-cloud/p2-graveyard-1.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/p2-graveyard-1.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are (sta|eff).p2gy1.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(sta|eff)\.p2gy1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) a card that prints the wording', () => {
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = review.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) expect(cards, t.id).toContain(NARROW[t.id]);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review) expect(g.expect, g.card).toBe('full');
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

describe('p2-graveyard-1 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bblitz ability\b/, 'dash ability'], [/\bbestow ability\b/, 'flashback ability'], [/\byour graveyard using\b/, 'your hand using'], [/\bfrom a graveyard\b/, 'from your hand'],
    [/\bthis turn\b/, 'last turn'], [/\bfrom the battlefield\b/, 'from anywhere'], [/\btapped under\b/, 'untapped under'], [/\bis green\b/, 'is blue'], [/\bis black\b/, 'is white'],
    [/\byour hand all\b/, 'your library all'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-graveyard-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('p2-graveyard-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('p2-graveyard-1 design 6.10 (local index): synthetic examples', () => {
  it('no p2-graveyard-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    // a fixed wording with no hole (the castWith lines, as zz-fast5x/e2.json's warp line) has no synthetic form: only its keyword line and its other lines are checked
    const fixed = (t: Template, l: string): boolean => FIXED_WORDING[t.id] === l.trim();
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !fixed(t, l) && !/^[A-Z][a-z]+$/.test(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});


const json = (v: unknown): string => JSON.stringify(v);
const creature = (text: string, type = 'Creature — Human') => parseCard(card('Example Lurker', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : {}), OPTS).faces[0]!;

describe('p2-graveyard-1 renderer (render/evt.ts, render/refs.ts; CR 700.4, 400.7): "dies or is put into exile" of any permanent, and "that card" after it', () => {
  it('"When enchanted permanent dies or is put into exile, return that card to the battlefield under your control" is automated (an Aura of a creature or planeswalker)', () => {
    const f = creature('Enchant creature or planeswalker you control\nWhen enchanted permanent dies or is put into exile, return that card to the battlefield under your control.', 'Enchantment — Aura');
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f.abilities)).toContain('"to":["graveyard","exile"]');
    expect(json(f.abilities)).toContain('{"op":"move","what":{"ref":"event","role":"subject"},"to":{"zone":"battlefield","controller":{"ref":"you"}}}');
  });
  it('a creature subject is still said with "dies" ("Whenever a creature you control dies or is put into exile, you gain 1 life")', () => {
    expect(fullyAutomated(creature('Whenever another creature you control dies or is put into exile, you gain 1 life.'))).toBe(true);
  });
});

describe('p2-graveyard-1 renderer (render/steps-zones.ts; CR 400.3): "your hand" first only for cards you own', () => {
  it('"Return to your hand all creature cards in an opponent\'s graveyard" (cards you do not own) is not automated', () => {
    expect(fullyAutomated(parseCard(card('Example Recall', 'Sorcery', "Return to your hand all creature cards in an opponent's graveyard."), OPTS).faces[0]!)).toBe(false);
  });
  it('"Return to the battlefield tapped all ..." (a destination with a status) is not automated by the destination-first reading', () => {
    expect(fullyAutomated(parseCard(card('Example Recall', 'Sorcery', 'Return to the battlefield tapped all creature cards in your graveyard.'), OPTS).faces[0]!)).toBe(false);
  });
});
