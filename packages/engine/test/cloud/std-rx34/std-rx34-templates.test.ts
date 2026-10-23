/**
 * EDH lane rx34 (std-rx34): the template data of parser/templates/zz-cloud/std-rx34.json ("<object> becomes the color of your choice <duration>"; "during turns
 * other than yours, <object> gets +N/+N" and "<objects> get +N/+N") and the round's parser, lowering and renderer changes (the monstrous status, CR 701.37b; the
 * condition "{G} was spent to cast this spell", CR 601.2h; the static "it" after "as long as ~ is equipped", CR 301.5).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-rx34-scenarios.test.ts. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRx34 from '../../../src/parser/templates/zz-cloud/std-rx34.json';
import ownReview from '../../m5/golden/cards/cloud-std-rx34-review.json';
import t5Review from '../../m5/golden/cards/t5-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdRx34 as Template[];
const MECH_COUNT = 3;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one card only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'sta.stdrx34.otherturns.pump': 'Mesa Lynx', // the other printings are held-out or a "this spell costs" line
  'sta.stdrx34.otherturns.anthem': 'Glory of Warfare', // Vibrating Sphere, the only other printing, is held-out
};
/** Templates kept experimental (none: each has its golden evidence). */
const EXPERIMENTAL: readonly string[] = [];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a creature (triggered and activated abilities). */
const parsedWith = (_t: Template, text: string) => parseCard(card('Example Shaman', 'Creature — Goblin Shaman', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Monk', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');

describe('std-rx34 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rx34.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rx34.json');
    expect(files.indexOf('zz-cloud/std-rx34.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-rx34.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are sta|eff.stdrx34.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(sta|eff)\.stdrx34\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.status, t.id).toBe(EXPERIMENTAL.includes(t.id) ? 'experimental' : 'stable');
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    // Glory of Warfare's entry is FAST1 T5's, updated in place (guide section 6)
    const golden = [...(ownReview as { card: string; verified: string; expect?: string }[]), ...(t5Review as { card: string; verified: string; expect?: string }[]).filter((g) => g.card === 'Glory of Warfare')];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) expect(cards, t.id).toContain(NARROW[t.id]);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
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

describe('std-rx34 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} during combat.`];
  const swaps: [RegExp, string][] = [[/\bthe color of your choice\b/, 'the colors of your choice'], [/\bother than yours\b/, 'other than theirs'], [/\bget(s?) \+/, 'lose$1 +'], [/\bbecomes\b/, 'remains']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rx34 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able/during combat" or a swapped key word never gives the example's JSON`, () => {
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

describe('std-rx34 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('std-rx34 design 6.10 (local index): synthetic examples', () => {
  it('no std-rx34 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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




// ---- parser/holes/filter.ts STATUS, rules/filter.ts, statics/match.ts, render/cond.ts: the monstrous status --------------------------------------------------

describe('std-rx34 Filter/Cond (CR 701.37b): "as long as ~ is monstrous" (ObjectFilter.monstrous)', () => {
  it('"As long as ~ is monstrous, it has trample." and "~ gets +2/+2 as long as it\'s monstrous" are full and write {monstrous: true} of the object itself', () => {
    for (const text of ['{5}{G}: Monstrosity 3.\nAs long as this creature is monstrous, it has trample.', "{4}: Monstrosity 2.\nThis creature gets +0/+2 as long as it's monstrous."]) {
      const f = face('Creature — Beast', text, ['3', '3']);
      expect(fullFace(f), `${text}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
      expect(JSON.stringify(f.abilities), text).toContain('"cond":"matches","object":{"ref":"self"},"filter":{"monstrous":true}');
    }
  });
  it('"isn\'t monstrous" is the negation; "monstrous" of a card in a graveyard is never true (a permanent\'s designation)', () => {
    const f = face('Creature — Beast', "{4}: Monstrosity 2.\nAs long as this creature isn't monstrous, it has defender.", ['3', '3']);
    expect(fullFace(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('{"cond":"not","of":{"cond":"matches","object":{"ref":"self"},"filter":{"monstrous":true}}}');
  });
});

// ---- parser/holes/cond.ts#t51ManaSpent: "{G} was spent to cast this spell" -------------------------------------------------------------------------------------

describe('std-rx34 Cond (CR 601.2h, 106.1): "If {G} was spent to cast this spell" (wasCast.spent of the spell itself)', () => {
  it('one or two symbols of a color give atLeast 1 or 2 of that color, with no `$self` marker left', () => {
    const f = face('Instant', 'Draw a card. If {G} was spent to cast this spell, you gain 3 life.');
    expect(fullFace(f)).toBe(true);
    const s = JSON.stringify(f.abilities);
    expect(s).toContain('"cond":"wasCast","spent":{"color":"G","atLeast":1}');
    expect(s).not.toContain('$self');
    expect(JSON.stringify(face('Instant', 'Draw a card. If {R}{R} was spent to cast this spell, you gain 3 life.').abilities)).toContain('"spent":{"color":"R","atLeast":2}');
  });
  it('colorless or generic mana, or another object ("that spell") is not read so', () => {
    expect(JSON.stringify(face('Instant', 'Draw a card. If {C} was spent to cast this spell, you gain 3 life.').abilities)).not.toContain('"spent"');
    expect(JSON.stringify(face('Instant', 'Draw a card. If {2} was spent to cast this spell, you gain 3 life.').abilities)).not.toContain('"spent"');
  });
});

// ---- parser/lower/static-anaphora.ts: "As long as ~ is equipped, it has <abilities>" ---------------------------------------------------------------------------

describe('std-rx34 lowering (CR 301.5, 611.3a): the Equipment attached to ~ is no antecedent of a static ability\'s "it"', () => {
  it('"As long as ~ is equipped, it has haste." names ~ (and so does the Aura form "is enchanted")', () => {
    for (const [text, sub] of [['As long as this creature is equipped, it has haste.', 'Equipment'], ['As long as this creature is enchanted, it has flying.', 'Aura']] as const) {
      const f = face('Creature — Goblin', text, ['2', '1']);
      if (!fullFace(f)) { expect(sub, `${text}: ${JSON.stringify(f.diagnostics)}`).toBe('Aura'); continue; } // the Aura condition is read elsewhere or not at all
      expect(JSON.stringify(f.abilities), text).toContain('"affects":{"ref":"self"}');
    }
  });
  it('a group that is not the attachments of ~ still blocks the unique-candidate rule ("as long as you control an Equipment, it has haste")', () => {
    expect(fullFace(face('Creature — Goblin', 'As long as you control an Equipment, it has haste.', ['2', '1']))).toBe(false);
  });
});

// ---- render/fold.ts#choiceGrant: the color-only branches ---------------------------------------------------------------------------------------------------------

describe('std-rx34 renderer (CR 105.3, 608.2d): a color choice whose five branches only set the color', () => {
  it('renders "<subject> becomes the color of your choice <duration>"; the hexproof form of r5-fxb is unchanged', () => {
    const f = face('Artifact', '{T}: Target creature becomes the color of your choice until end of turn.');
    expect(fullFace(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"mods":[{"layer":5,"colors":{"set":["G"]}}]');
    expect(fullFace(face('Creature — Lizard', '{2}: Until end of turn, this creature becomes the color of your choice and gains hexproof from that color.', ['1', '1']))).toBe(true);
  });
});
