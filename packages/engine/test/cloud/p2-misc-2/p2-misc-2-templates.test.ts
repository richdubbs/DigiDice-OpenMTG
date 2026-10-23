/**
 * p2-misc-2 (Phase 2 lane p2-misc): the template data of parser/templates/zz-cloud/p2-misc-2.json ("If a triggered ability of <a spell> or <another permanent>
 * triggers, that ability triggers an additional time"; "Until your next turn, your life total can't change and you gain protection from everything"), and the
 * round's engine and renderer changes (triggers/collect.ts#timesTriggered reads a spell's triggered abilities for a description that names spells; the two-member
 * union and the five restrictions said as Oracle says them).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in p2-misc-2-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import p2misc2 from '../../../src/parser/templates/zz-cloud/p2-misc-2.json';
import ownReview from '../../m5/golden/cards/p2-misc-2-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = p2misc2 as Template[];
const MECH_COUNT = 2;
const review = ownReview as { card: string; verified: string; expect?: string }[];
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one tuning-half card only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'sta.p2misc2.triggerMod.orAnother': 'Echoes of Eternity',
  'eff.p2misc2.untilNextTurn.lifeFixed.protectionEverything': "Teferi's Protection",
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: an enchantment's static, an instant's effect. */
const parsedWith = (t: Template, text: string) => {
  if (t.kind === 'effect') return parseCard(card('Example Ward Prayer', 'Instant', text), OPTS).faces[0]!;
  return parseCard(card('Example Hum', 'Enchantment', text), OPTS).faces[0]!;
};

describe('p2-misc-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-misc-2.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-misc-2.json');
    expect(files.indexOf('zz-cloud/p2-misc-2.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/p2-misc-2.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are (eff|sta).p2misc2.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.p2misc2\./);
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

describe('p2-misc-2 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) {
          const got = bare(f.abilities) as { kind: string; trigger?: unknown }[];
          expect(t.kind === 'trigger' ? got.map((a) => a.trigger) : got, e.text).toEqual(t.kind === 'trigger' ? [e.expect] : e.expect);
        }
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
    [/\byou control\b/, 'an opponent controls'], [/\banother\b/, 'a'], [/\bspell\b/, 'creature'], [/\btriggered\b/, 'activated'], [/\ban additional time\b/, 'twice'],
    [/\byour next turn\b/, 'end of turn'], [/\beverything\b/, 'creatures'], [/\bcan't change\b/, "can't increase"], [/\byou gain protection\b/, 'you gain hexproof'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-misc-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('p2-misc-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('p2-misc-2 design 6.10 (local index): synthetic examples', () => {
  it('no p2-misc-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    // a keyword alone ("Flying", "Vigilance") is a line of many cards and no wording of the round
    const own = (l: string): boolean => !/^[A-Z][a-z]+$/.test(l.trim());
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => own(l) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

describe('p2-misc-2 engine and renderer (triggers/collect.ts#timesTriggered, render/stat.ts triggerMod)', () => {
  it('fail closed: a union of three descriptions is not this reading', () => {
    expect(fullyAutomated(parsedWith(MECH[0]!, 'If a triggered ability of a red spell you control, a red permanent you control or a blue permanent you control triggers, that ability triggers an additional time.'))).toBe(false);
  });
  it('design 6.3 rule 2: the union is weak, so a single description that already reads "<A> or <B> you control" keeps T40\'s template (no G5 ambiguity)', () => {
    expect(MECH[0]!.weak).toBe(1);
    const f = parsedWith(MECH[0]!, 'If a triggered ability of another Elf or battle you control triggers, that ability triggers an additional time.');
    expect(f.templatesUsed).toContain('sta.t40.triggerMod.anyCause');
    expect(f.templatesUsed).not.toContain('sta.p2misc2.triggerMod.orAnother');
    expect(fullyAutomated(f)).toBe(true);
  });
  it('fail closed: "a Druid or another Elf you control" (one "you control" for both descriptions) is not automated', () => {
    expect(fullyAutomated(parsedWith(MECH[0]!, 'If a triggered ability of a Druid or another Elf you control triggers, that ability triggers an additional time.'))).toBe(false);
  });
  it('the union keeps each description whole: "another" stays on the permanent and the spell keeps the stack', () => {
    const j = jsonKey(parsedWith(MECH[0]!, MECH[0]!.examples[0]!.text).abilities);
    expect(j).toContain('"zone":"stack"');
    expect(j).toContain('"other":true');
  });
  it('"protection from everything" for a player is the three restrictions with no source description, beside the two of a life total that can\'t change', () => {
    const j = jsonKey(parsedWith(MECH[1]!, MECH[1]!.examples[0]!.text).abilities);
    for (const a of ['gainLife', 'loseLife', 'beEnchanted', 'beTargeted', 'receiveDamage']) expect(j).toContain(`"action":"${a}"`);
    expect(j).not.toContain('"other"');
    expect(j).toContain('"d":"untilNextTurn"');
  });
});
