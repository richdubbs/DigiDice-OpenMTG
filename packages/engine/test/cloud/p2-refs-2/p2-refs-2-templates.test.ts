/**
 * p2-refs-2 (Phase 2 lane p2-refs): the template data of parser/templates/zz-cloud/p2-refs-2.json (the rider "<noun> destroyed this way can't be regenerated", CR 701.19c),
 * and the round's parser and renderer changes: "if this spell was kicked" names ~ (parser/lower/mentions.ts#namedIn), so does "~ can attack this turn as though it
 * didn't have defender" (namedObjects) and a rider's own condition (riderCondMentions); render/steps-zones.ts#noRegeneration (family destroyed-this-way-no-regen),
 * render/steps.ts (the guarded destroy; family may-then-may). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render
 * gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an
 * example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is
 * in p2-refs-2-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import p2Refs2 from '../../../src/parser/templates/zz-cloud/p2-refs-2.json';
import review from '../../m5/golden/cards/cloud-p2-refs-2-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = p2Refs2 as Template[];
const MECH_COUNT = 1;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because the tuning half of the
 * index prints the wording on fewer than three cards this round makes full, with their template tests (G9, G2) and played scenarios. Listed in the round's record.
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'rid.p2refs2.noregen.destroyedThisWay': ['Soul Rend'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Codex', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const parsedWith = (_t: Template, text: string) => face('Sorcery', text);

describe('p2-refs-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-refs-2.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-refs-2.json');
    expect(files.indexOf('zz-cloud/p2-refs-2.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/p2-refs-2.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are rid.p2refs2.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^rid\.p2refs2\./);
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

describe('p2-refs-2 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const swaps: [RegExp, string][] = [[/can't be regenerated/, 'can be regenerated'], [/destroyed this way/, 'exiled this way'], [/A creature destroyed/, 'An artifact destroyed'], [/Artifacts destroyed/, 'Creatures destroyed'], [/Creatures destroyed/, 'Artifacts destroyed'], [/^Destroy/, 'Exile']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-refs-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('p2-refs-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('p2-refs-2 design 6.10 (local index): synthetic examples', () => {
  it('no p2-refs-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

// ---- parser/lower/mentions.ts, render/steps.ts -------------------------------------------------------------------------------------------------------------

const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');
const creature = (text: string) => face('Creature — Wall', text, ['2', '2']);

describe('p2-refs-2 parser (design 6.4): what names ~ for a later pronoun', () => {
  it('CR 702.33d: "If this spell was kicked, it deals 3 damage to that player": "it" is ~', () => {
    const f = face('Sorcery', 'Kicker {R}\nTarget player loses 2 life. If this spell was kicked, it deals 3 damage to that player.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"source":{"ref":"self"}');
  });
  it('CR 603.4: "if this creature wasn\'t kicked, sacrifice it": "it" is ~', () => {
    const f = creature("Kicker {R}\nAt the beginning of your end step, if this creature wasn't kicked, sacrifice it.");
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('{"op":"sacrifice","what":{"ref":"self"}}');
  });
  it('CR 702.3b: "~ can attack this turn as though it didn\'t have defender. Exile it ...": "it" is ~', () => {
    const f = creature("Defender\n{1}: This creature can attack this turn as though it didn't have defender. Exile it at the beginning of the next end step.");
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
  });
  it('Mention.condSelf: ~ named only by "if this spell was kicked" yields to another object: "gain control of that creature ..., untap it" untaps the creature', () => {
    const f = face('Sorcery', 'Kicker {3}\nTarget creature can\'t block this turn. If this spell was kicked, gain control of that creature until end of turn, untap it, and it gains haste until end of turn.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('{"op":"untap","what":{"ref":"target","id":"t0"}}');
    expect(JSON.stringify(f.abilities).includes('"ref":"self"')).toBe(false);
  });
  it('a pronoun with another candidate is not bound to ~: "If this spell was kicked, destroy target artifact. Return it ..." does not return ~', () => {
    const f = face('Sorcery', "Kicker {R}\nIf this spell was kicked, destroy target artifact. Return it to its owner's hand.");
    expect(JSON.stringify(f.abilities).includes('"what":{"ref":"self"}')).toBe(false);
  });
});

describe('p2-refs-2 renderer (CR 608.2d): "you may A, then you may B"', () => {
  it('two "you may" choices of the same player join with ", then"', () => {
    expect(fullFace(face('Instant', 'You may tap or untap target permanent, then you may tap or untap another target permanent.'))).toBe(true);
  });
});
