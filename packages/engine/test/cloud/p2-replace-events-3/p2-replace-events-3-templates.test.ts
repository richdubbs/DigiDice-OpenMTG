/**
 * Phase 2 lane p2-replace-events, round p2-replace-events-3: the template data of parser/templates/zz-cloud/p2-replace-events-3.json (event replacements, CR 614.1a:
 * an extra turn skipped as it would begin; "If ~ would be put into a graveyard from the battlefield, instead exile it and take an extra turn after this one."; "If you
 * would draw a card while <condition>, instead <instructions>"; a scry replaced) and the round's matcher, capability and engine changes: `beginTurn.extra` compared
 * by the replacement matcher (triggers/match.ts#beginTurn, capability feature:replace.beginTurn.extra), the `scry` proposal kind (effects/proposal-kinds/scry.ts),
 * "that many" of a replaced scry (lower/static-anaphora.ts, model/lint-roles.ts).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in p2-replace-events-3-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import p2re3 from '../../../src/parser/templates/zz-cloud/p2-replace-events-3.json';
import review from '../../m5/golden/cards/p2-replace-events-3-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = p2re3 as Template[];
const MECH_COUNT = 5;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one card of the tuning half, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'rep.p2re3.extraTurn.skip.player': ["Ugin's Nexus"],
  'rep.p2re3.self.graveyardFromBf.insteadExileExtraTurn': ["Ugin's Nexus"],
  'rep.p2re3.draw.while.insteadEffects': ['Blood Scrivener'],
  'rep.p2re3.scry.insteadEffects': ['Eligeth, Crossroads Augur'],
};
/** Templates kept experimental: the cards that print "an opponent would begin an extra turn" (Stranglehold, Trouble in Pairs) are held-out, so no golden card can be its evidence (guide section 4, design 6.9). */
const EXPERIMENTAL: readonly string[] = ['rep.p2re3.extraTurn.skip.opponent'];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a creature (a static ability), an instant for an effect example. */
const parsedWith = (_t: Template, text: string) => parseCard(card('Example Ledger', 'Artifact', text), OPTS).faces[0]!;
const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Monk', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');

describe('p2-replace-events-3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-replace-events-3.json, after zz-cloud/p2-replace-events-1.json, before zz-cloud/r3-choose.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-replace-events-3.json');
    expect(files.indexOf('zz-cloud/p2-replace-events-3.json')).toBeGreaterThan(files.indexOf('zz-cloud/p2-replace-events-1.json'));
    expect(files.indexOf('zz-cloud/p2-replace-events-3.json')).toBeLessThan(files.indexOf('zz-cloud/r3-choose.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are rep.p2re3.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^rep\.p2re3\./);
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
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`) || g.verified.includes(`${t.id})`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) for (const c of NARROW[t.id]!) expect(cards, t.id).toContain(c);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'twice', 'minus', 'no']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('p2-replace-events-3 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const out = [`${body} unless it is blue.`, `${body} at random.`, `${body} if able.`, `${body} during combat.`];
  const swaps: [RegExp, string][] = [[/\bplus one\b/, 'plus two'], [/\bminus one\b/, 'plus one'], [/\btwice\b/, 'three times'], [/\bgain\b/, 'lose'], [/\bgains\b/, 'loses'],
    [/\bopponent\b/, 'player'], [/\byour control\b/, "an opponent's control"], [/\bput on\b/, 'removed from'], [/\bgraveyard\b/, 'hand'], [/\bdraw two cards\b/, 'draw three cards'],
    [/\bthat many\b/, 'three'], [/\bwould enter\b/, 'would die'], [/\bIf you do\b/, "If you don't"], [/\bleave the battlefield\b/, 'die'], [/\bdestroyed\b/, 'exiled'], [/\bthe next time\b/i, 'each time'], [/\bproliferate\b/, 'populate'], [/\bon top of\b/, 'on the bottom of'], [/\bnontoken\b/, 'token']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-replace-events-3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/at random/if able/during combat" or a swapped key word never gives the example's JSON`, () => {
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

describe('p2-replace-events-3 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('p2-replace-events-3 design 6.10 (local index): synthetic examples', () => {
  it('no p2-replace-events-3 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

// ---- the round's matcher and engine changes ----------------------------------------------------------------------------------------------------------------

describe('p2-replace-events-3 engine capabilities (CR 500.7, 614.10, 701.22a)', () => {
  it('the extra-turn replacement field and the scry replacement form are registered; the trigger form of "an extra turn" is not (fail closed)', () => {
    expect(ENGINE_CAPABILITIES.has('feature:replace.beginTurn.extra')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:ev.beginTurn.extra')).toBe(false);
    expect(ENGINE_CAPABILITIES.has('feature:replace.on.action.scry')).toBe(true);
  });
  it('"At the beginning of each extra turn" stays manual (a trigger\'s event does not record it)', () => {
    expect(fullFace(face('Enchantment', 'Whenever a player begins an extra turn, draw a card.'))).toBe(false);
  });
});
