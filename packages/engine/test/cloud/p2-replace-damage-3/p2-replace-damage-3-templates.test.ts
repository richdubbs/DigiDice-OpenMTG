/**
 * Phase 2 lane p2-replace-damage, round p2-replace-damage-3: the template data of parser/templates/zz-cloud/p2-replace-damage-3.json (damage redirection, CR 614.9:
 * "All [combat] damage that would be dealt to <a target | ~ | you> this turn is dealt to <you | a target> instead.", "The next N damage that would be dealt to <a
 * target> this turn is dealt to you instead.", "The next time a source of your choice would deal damage to <you | a target> this turn, that damage is dealt to <an
 * object> instead.") and the round's renderer changes (render/stat.ts: the redirection of all damage for a duration; render/fold-p2rd3.ts: the source-of-your-choice
 * redirection shield).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in p2-replace-damage-3-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { ALT_SITES, EQUIVALENCE_FAMILIES } from '../../../src/render/equivalence';
import p2rd3 from '../../../src/parser/templates/zz-cloud/p2-replace-damage-3.json';
import review from '../../m5/golden/cards/p2-replace-damage-3-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = p2rd3 as Template[];
const MECH_COUNT = 5;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because the tuning half and
 * Standard print the wording on one or two cards only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.p2rd3.redirect.all.toObj.toYou': ['Sivvi\'s Valor'],
  'eff.p2rd3.redirect.combat.toYou.toObj': ['Turn the Tables'],
  'eff.p2rd3.redirect.next.toObj.toYou': ['Vassal\'s Duty'],
  'eff.p2rd3.redirect.nextSourceOfChoice.you': ['Beacon of Destiny', 'General\'s Regalia'],
  'eff.p2rd3.redirect.nextSourceOfChoice.obj': ['Shaman en-Kor'],
};
/** Templates kept experimental (no golden card of the tuning half or Standard prints them; design 6.9). */
const EXPERIMENTAL: readonly string[] = [];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** The type line an example needs: an Equipment or an Aura when it names the equipped or enchanted creature, a creature when it names ~ or has an activated or triggered ability, else an enchantment or an instant. */
function typeFor(t: Template, text: string): { type: string; pt?: boolean } {
  if (/\bequipped (creature|permanent)\b/.test(text)) return { type: 'Artifact — Equipment' };
  if (/\benchanted (creature|permanent)\b/.test(text)) return { type: 'Enchantment — Aura' };
  if (t.kind === 'static') return /~|^(Flying|Vigilance|Haste|Trample)$/m.test(text) ? { type: 'Creature — Spirit', pt: true } : { type: 'Enchantment' };
  return /^(When|Whenever|At)\b/.test(text) || text.includes(': ') ? { type: 'Creature — Spirit', pt: true } : { type: 'Instant' };
}
const parsedWith = (t: Template, text: string) => {
  const { type, pt } = typeFor(t, text);
  return parseCard(card('Example Warden', type, text, pt ? { power: '2', toughness: '2' } : {}), OPTS).faces[0]!;
};

describe('p2-replace-damage-3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-replace-damage-3.json, after zz-cloud/look3.json, before zz-cloud/r3-choose.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-replace-damage-3.json');
    expect(files.indexOf('zz-cloud/p2-replace-damage-3.json')).toBeGreaterThan(files.indexOf('zz-cloud/look3.json'));
    expect(files.indexOf('zz-cloud/p2-replace-damage-3.json')).toBeLessThan(files.indexOf('zz-cloud/r3-choose.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.p2rd3.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(rep|eff|sta)\.p2rd3\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.status, t.id).toBe(EXPERIMENTAL.includes(t.id) ? 'experimental' : 'stable');
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one or two cards that print the wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) for (const c of NARROW[t.id]!) expect(cards, t.id).toContain(c);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review as { card: string; expect?: string }[]) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'choice', 'prevent']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('p2-replace-damage-3 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
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
  const swaps: [RegExp, string][] = [[/\bto you\b/, 'to each player'], [/\bthis turn\b/, 'this combat'], [/\bcombat damage\b/, 'noncombat damage'], [/\bwould deal\b/, 'would be dealt'],
    [/\byour choice\b/, "an opponent's choice"], [/\bprevent all\b/i, 'Prevent half'], [/\bprevent (\d)\b/i, 'prevent all but $1'], [/\bthe next\b/i, 'the first'], [/\byou control\b/, 'you own'],
    [/\ban opponent controls\b/, 'you control'], [/\bdealt by\b/, 'dealt to'], [/\bto players\b/, 'to opponents'], [/\bwhere X is\b/, 'where Y is']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-replace-damage-3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('p2-replace-damage-3 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~,' || w === '~.' || /^\{/.test(w)) return;
          const end = w.match(/[.,:]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('p2-replace-damage-3 design 6.10 (local index): synthetic examples', () => {
  it('no p2-replace-damage-3 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

// ---- the renderer changes -------------------------------------------------------------------------------------------------------------------------------------

const face = (type: string, text: string) => parseCard(card('Example Monk', type, text, /Creature/.test(type) ? { power: '2', toughness: '2' } : {}), OPTS).faces[0]!;
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');

describe('p2-replace-damage-3 renderer (design 6.8 G6): the new reading is a reviewed family; the fold is exact', () => {
  it('the family is in the equivalence table', () => {
    expect(EQUIVALENCE_FAMILIES.map((f) => f.id)).toContain('redirect-all-for-duration');
    expect(ALT_SITES['stat.ts']).toBeGreaterThan(0);
  });
  it('CR 614.9: a redirection with no duration, or of the damage of a described group, is not said "all damage ... this turn" (fail closed)', () => {
    expect(fullFace(face('Instant', 'All damage that would be dealt to target creature is dealt to you instead.'))).toBe(false);
    expect(fullFace(face('Instant', 'All damage that would be dealt to creatures you control this turn is dealt to you instead.'))).toBe(false);
  });
  it('CR 609.7a, 615.7: the source-of-your-choice redirection names the source once; a second use of the shield is not read', () => {
    expect(fullFace(face('Creature — Human', '{1}: The next time a source of your choice would deal damage to you this turn, that damage is dealt to ~ instead.'))).toBe(true);
    expect(fullFace(face('Creature — Human', '{1}: The next two times a source of your choice would deal damage to you this turn, that damage is dealt to ~ instead.'))).toBe(false);
  });
});
