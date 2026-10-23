/**
 * Phase 2 lane p2-replace-damage, round p2-replace-damage-2: the template data of parser/templates/zz-cloud/p2-replace-damage-2.json (damage-increase replacements:
 * "If <a source> would deal [combat] damage to <a recipient> [this turn], <it | that source> deals <double / triple that damage | that much damage plus N | N damage>
 * [to that ...] instead.", "Double all damage that <sources> would deal.") and the round's parser and renderer changes (parser/holes/filter.ts: the weak head
 * "source"; parser/holes/p2rd2.ts: the holes DamageWould and DamageMore; render/evt.ts: "<description> source", "any source", "a source would deal damage to";
 * render/stat.ts: "triple that damage", "to you").
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in p2-replace-damage-2-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { ALT_SITES, EQUIVALENCE_FAMILIES } from '../../../src/render/equivalence';
import p2rd2 from '../../../src/parser/templates/zz-cloud/p2-replace-damage-2.json';
import review from '../../m5/golden/cards/p2-replace-damage-2-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = p2rd2 as Template[];
const MECH_COUNT = 3;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because the tuning half and
 * Standard print the wording on one or two cards only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'rep.p2rd2.double.all.thatFilterWouldDeal': ['Absorbing Man and Titania'],
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

describe('p2-replace-damage-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-replace-damage-2.json, after zz-cloud/look3.json, before zz-cloud/r3-choose.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-replace-damage-2.json');
    expect(files.indexOf('zz-cloud/p2-replace-damage-2.json')).toBeGreaterThan(files.indexOf('zz-cloud/look3.json'));
    expect(files.indexOf('zz-cloud/p2-replace-damage-2.json')).toBeLessThan(files.indexOf('zz-cloud/r3-choose.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.p2rd2.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(rep|eff|sta)\.p2rd2\./);
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

describe('p2-replace-damage-2 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('p2-replace-damage-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('p2-replace-damage-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('p2-replace-damage-2 design 6.10 (local index): synthetic examples', () => {
  it('no p2-replace-damage-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

// ---- the parser and renderer changes ----------------------------------------------------------------------------------------------------------------------

const face = (type: string, text: string) => parseCard(card('Example Monk', type, text, /Creature/.test(type) ? { power: '2', toughness: '2' } : {}), OPTS).faces[0]!;
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');
const steps = (f: ReturnType<typeof face>): string => JSON.stringify(f.abilities);

describe('p2-replace-damage-2 parser/holes/filter.ts (CR 120.3, 609.7): the weak head "source"', () => {
  it('"another red source you control" and "an instant or sorcery source you control" are filters of any object of that kind (no zone, no card)', () => {
    const f = face('Enchantment', 'If another red source you control would deal damage to a permanent or player, it deals that much damage plus 3 to that permanent or player instead.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(steps(f)).toContain('"source":{"colors":["R"],"controller":"you","other":true}');
    const g = face('Enchantment', 'If an instant or sorcery source you control would deal damage to a permanent or player, it deals that much damage plus 3 to that permanent or player instead.');
    expect(steps(g)).toContain('"source":{"types":["Instant","Sorcery"],"controller":"you"}');
  });
  it('design 6.3 rule 2: a template that spells "a source" out keeps its sentence (the next-time shield of a source of your choice is unchanged)', () => {
    const f = face('Instant', 'The next time a red source of your choice would deal damage to you this turn, prevent that damage.');
    expect(fullFace(f)).toBe(true);
    expect(f.templatesUsed).not.toContain('rep.p2rd2.damage.more');
  });
});

describe('p2-replace-damage-2 parser/holes/p2rd2.ts (CR 614.1a, 120.3): DamageWould and DamageMore', () => {
  it('"a source" alone names no source; "would deal 4 or more damage" keeps the amount the damage must have', () => {
    const f = face('Enchantment', 'If a source would deal 5 or more damage to a permanent or player, that source deals 4 damage to that permanent or player instead.');
    expect(fullFace(f)).toBe(true);
    expect(steps(f)).toContain('"replaces":{"ev":"damage","amount":{"op":">=","value":5}}');
    expect(steps(f)).toContain('"body":{"b":"modify","amount":{"set":4}}');
  });
  it('fail closed: a recipient the hole does not know, a repeat that is not the recipient, or a card as the recipient is not read', () => {
    expect(fullFace(face('Enchantment', 'If a source would deal damage to target creature, it deals double that damage instead.'))).toBe(false);
    expect(fullFace(face('Enchantment', 'If a source would deal damage to an opponent, it deals double that damage to that creature instead.'))).toBe(false);
    expect(fullFace(face('Enchantment', 'If a source would deal damage to a creature card in your graveyard, it deals double that damage instead.'))).toBe(false);
    expect(fullFace(face('Enchantment', 'If a source would deal damage to an opponent, it deals half that damage instead.'))).toBe(false);
  });
});

describe('p2-replace-damage-2 renderer (design 6.8 G6): the new readings are reviewed families and the alt() sites are counted', () => {
  it('every family the round adds is in the equivalence table', () => {
    const ids = EQUIVALENCE_FAMILIES.map((f) => f.id);
    for (const id of ['described-source', 'any-source', 'double-triple-that-damage', 'replaced-damage-to-you']) expect(ids, id).toContain(id);
    expect(ALT_SITES['evt.ts']).toBeGreaterThan(0);
  });
});
