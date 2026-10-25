/**
 * trek-2 (lane trek, Star Trek cards): the template data of parser/templates/zz-cloud/trek-2.json ("If you gaining life causes a triggered ability of a permanent
 * you control to trigger, that ability triggers an additional time"), and the round's parser, renderer and capability changes:
 *  - parser/front/labels.ts: a flavor word of two or more words in title case is a label even with a word like "When", "Them", "Your" (CR 207.2d);
 *  - parser/holes/cond.ts: "~ is the first spell you've cast this game" (cond firstSpellCast, CR 601.2i);
 *  - parser/holes/event.ts: "you face a dilemma" (the action faceDilemma, CR 700.2; the term is new, its rule number unverified);
 *  - render/stat.ts ("you gaining life"), render/cond.ts, render/evt.ts; the capabilities `feature:triggerMod.lifeGain`, `cond:firstSpellCast`,
 *    `feature:ev.action.faceDilemma`.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in trek-2-scenarios.test.ts. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { capabilitiesOfDef } from '../../../src/model/cap-walk';
import trek2 from '../../../src/parser/templates/zz-cloud/trek-2.json';
import ownReview from '../../m5/golden/cards/trek-2-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = trek2 as Template[];
const MECH_COUNT = 1;
const review = ownReview as { card: string; verified: string; expect?: string }[];
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): a template made stable on fewer than three golden cards because Oracle prints the
 * wording on one card only (held-out, opened by the owner for the Star Trek request of 2026-10-24), with its template tests (G9, G2) and played scenarios. Listed
 * in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'sta.trek2.triggerMod.youGainingLife': 'Dr. Beverly Crusher',
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: an enchantment's static, an instant's effect. */
const parsedWith = (t: Template, text: string) => {
  if (t.kind === 'effect') return parseCard(card('Example Ward Prayer', 'Instant', text), OPTS).faces[0]!;
  return parseCard(card('Example Hum', 'Enchantment', text), OPTS).faces[0]!;
};
const instant = (text: string) => parseCard(card('Example Quiet Gambit', 'Instant', text), OPTS).faces[0]!;
const enchantment = (text: string) => parseCard(card('Example Quiet Hum', 'Enchantment', text), OPTS).faces[0]!;

describe('trek-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/trek-2.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/trek-2.json');
    expect(files.indexOf('zz-cloud/trek-2.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/trek-2.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are sta.trek2.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^sta\.trek2\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
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
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'whenever', 'neither', 'nor', 'twice', 'once']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('trek-2 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} if able.`, `${body} until end of turn.`];
  const swaps: [RegExp, string][] = [
    [/\byou control\b/, 'an opponent controls'], [/\bgaining life\b/, 'losing life'], [/\bIf you\b/, 'If a player'], [/\btriggered\b/, 'activated'], [/\ban additional time\b/, 'twice'],
    [/\ba permanent\b/, 'a creature'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('trek-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/if able/until end of turn" or a swapped key word never gives the example's JSON`, () => {
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

describe('trek-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('trek-2 design 6.10 (local index): synthetic examples', () => {
  it('no trek-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    // a keyword alone ("Flying", "Lifelink") is a line of many cards and no wording of the round
    const own = (l: string): boolean => !/^[A-Z][a-z]+$/.test(l.trim());
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => own(l) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

describe('trek-2 parser/front/labels.ts (CR 207.2d): a flavor word in title case is a label even with a word like "When", "Their", "Them"', () => {
  it('two title-case flavor words before the dash are labels: both modes are understood and the card is fully automated', () => {
    const f = instant('Choose one —\n• Seize Their Banner — Draw a card.\n• Sing When the Bells Ring — You gain 2 life.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    const labels = jsonKey(f.abilities);
    expect(labels).toContain('"label":"Seize Their Banner"');
    expect(labels).toContain('"label":"Sing When the Bells Ring"');
  });
  it('a title-case label with a comma ("Mira, Then the Storm") is a label', () => {
    expect(fullyAutomated(instant('Choose one —\n• Mira, Then the Storm — Draw a card.\n• Quiet Harbor — You gain 2 life.'))).toBe(true);
  });
  it('fail closed: a lower-case game word keeps the prefix as text ("Rally them Now", "Each opponent loses heart"), and so does a one-word prefix ("Them")', () => {
    expect(fullyAutomated(instant('Choose one —\n• Rally them Now — Draw a card.\n• Quiet Harbor — You gain 2 life.'))).toBe(false);
    expect(fullyAutomated(instant('Choose one —\n• Each opponent loses heart — Draw a card.\n• Quiet Harbor — You gain 2 life.'))).toBe(false);
    expect(fullyAutomated(instant('Choose one —\n• Them — Draw a card.\n• Quiet Harbor — You gain 2 life.'))).toBe(false);
  });
});

describe('trek-2 parser/holes/cond.ts (CR 601.2i): "if ~ is the first spell you\'ve cast this game"', () => {
  it('reads as the condition firstSpellCast (scope game) and renders back the same words', () => {
    const f = instant("Draw a card. If this spell is the first spell you've cast this game, you gain 2 life.");
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(jsonKey(f.abilities)).toContain('"cond":{"cond":"firstSpellCast","scope":"game"}');
    expect(f.gate.every((g) => g.ok)).toBe(true);
  });
  it('fail closed: "this turn", "the second spell" and another subject are not this reading', () => {
    expect(fullyAutomated(instant("Draw a card. If this spell is the first spell you've cast this turn, you gain 2 life."))).toBe(false);
    expect(fullyAutomated(instant("Draw a card. If this spell is the second spell you've cast this game, you gain 2 life."))).toBe(false);
    expect(fullyAutomated(instant("Draw a card. If that spell is the first spell you've cast this game, you gain 2 life."))).toBe(false);
  });
  it('the condition is read only while a spell resolves: a static\'s, a trigger\'s or an announcement\'s reader does not have it (capability cond:firstSpellCast only)', () => {
    expect(ENGINE_CAPABILITIES.has('cond:firstSpellCast')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('scond:firstSpellCast')).toBe(false);
    expect(ENGINE_CAPABILITIES.has('feature:announce.cond.firstSpellCast')).toBe(false);
  });
});

describe('trek-2 parser/holes/event.ts (CR 700.2; the term is new, its rule number unverified): "whenever you face a dilemma"', () => {
  it('reads as the action faceDilemma of the player, renders back and is automated', () => {
    const f = enchantment('Whenever you face a dilemma, you gain 1 life.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(jsonKey(f.abilities)).toContain('{"actor":"you","ev":"action","verb":"faceDilemma"}');
    expect(ENGINE_CAPABILITIES.has('feature:ev.action.faceDilemma')).toBe(true);
  });
  it('fail closed: "two dilemmas" and "a villainous choice" are not this reading', () => {
    expect(fullyAutomated(enchantment('Whenever you face two dilemmas, you gain 1 life.'))).toBe(false);
    expect(fullyAutomated(enchantment('Whenever you face a villainous choice, you gain 1 life.'))).toBe(false);
  });
});

describe('trek-2 model/cap-walk.ts, triggers/collect.ts (CR 603.2d): only YOUR life gain as a cause is read', () => {
  const mod = (cause: unknown) => ({ kind: 'static', text: 'x', effects: [{ s: 'triggerMod', cause, abilitiesOf: { controller: 'you' }, additional: 1 }] });
  it('a life gain of the doubler\'s controller is `feature:triggerMod.lifeGain` (registered); an opponent\'s gain, a loss or an amount is not', () => {
    expect(ENGINE_CAPABILITIES.has('feature:triggerMod.lifeGain')).toBe(true);
    expect(capabilitiesOfDef(mod({ ev: 'life', change: 'gain', player: 'you' }))).toContain('feature:triggerMod.lifeGain');
    for (const cause of [{ ev: 'life', change: 'gain', player: 'opponent' }, { ev: 'life', change: 'loss', player: 'you' }, { ev: 'life', change: 'gain', player: 'you', amount: { op: '>=', value: 2 } }]) {
      const caps = capabilitiesOfDef(mod(cause));
      expect(caps, JSON.stringify(cause)).toContain('feature:triggerMod.cause.life');
      expect(ENGINE_CAPABILITIES.has('feature:triggerMod.cause.life')).toBe(false);
    }
  });
});
