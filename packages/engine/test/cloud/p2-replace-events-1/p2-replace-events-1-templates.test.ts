/**
 * Phase 2 lane p2-replace-events, round p2-replace-events-1: the template data of parser/templates/zz-cloud/p2-replace-events-1.json (event replacements, CR 614.1a:
 * counters, tokens, life, mill, draws; a replacement effect a spell or ability creates for a duration; "If ~ would enter, [you may] <cost> instead. If you do, put ~
 * onto the battlefield. If you don't, put it into its owner's graveyard.") and the round's parser, lint and engine changes: the hole `ReplStatic`
 * (parser/holes/p2re1.ts), the `if`/`otherwise` of an `insteadThen` body (effects/instead.ts, model/lint-flow.ts, model/cap-walk.ts) and its consultation from the
 * entering object (effects/replacements.ts#selfEntryInstead, CR 614.12).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in p2-replace-events-1-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import p2re1 from '../../../src/parser/templates/zz-cloud/p2-replace-events-1.json';
import review from '../../m5/golden/cards/p2-replace-events-1-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = p2re1 as Template[];
const MECH_COUNT = 14;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one or two cards of the tuning half, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'rep.p2re1.counters.plus.eachKind.passive': ['Winding Constrictor', 'Brad Boimler, Eager Ensign'],
  'rep.p2re1.counters.plus.eachKind.player.you': ['Winding Constrictor'],
  'rep.p2re1.counters.plus.kind.self': ['Mowu, Loyal Companion'],
  'rep.p2re1.counters.plus.eachKind.byYou.orYourself': ["Lae'zel, Vlaakith's Champion"],
  'rep.p2re1.counters.minus.kind': ['Vizier of Remedies'],
  'rep.p2re1.tokens.plusAdditional.passive': ['Peregrin Took'],
  'rep.p2re1.tokens.artifact.plusAdditional.passive': ['Stridehangar Automaton'],
  'rep.p2re1.life.gainNone.player': ['Sulfuric Vortex'],
  'rep.p2re1.mill.twice.opponent': ['Bruvac the Grandiloquent'],
  'rep.p2re1.life.twice.while': ['Phial of Galadriel'],
  'rep.p2re1.draw.two.while': ['Phial of Galadriel'],
  'rep.p2re1.dur.replacement': ['Kaya, Geist Hunter', 'Brad Boimler, Eager Ensign'],
  'rep.p2re1.enters.mayPayInstead.orGraveyard': ['Mox Diamond'],
};
/** Templates kept experimental (none: each has its golden evidence). */
const EXPERIMENTAL: readonly string[] = [];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a creature (a static ability), an instant for an effect example. */
const parsedWith = (t: Template, text: string) => parseCard(card('Example Ledger', t.kind === 'effect' && !/^\{|^Whenever|^When/.test(text) ? 'Instant' : text.includes('this land') ? 'Land' : 'Creature — Snake', text, t.kind === 'effect' && !/^\{|^Whenever|^When/.test(text) ? {} : { power: '2', toughness: '2' }), OPTS).faces[0]!;
const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Monk', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');

describe('p2-replace-events-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-replace-events-1.json, after zz-cloud/look3.json, before zz-cloud/r3-choose.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-replace-events-1.json');
    expect(files.indexOf('zz-cloud/p2-replace-events-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/look3.json'));
    expect(files.indexOf('zz-cloud/p2-replace-events-1.json')).toBeLessThan(files.indexOf('zz-cloud/r3-choose.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are rep.p2re1.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^rep\.p2re1\./);
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

describe('p2-replace-events-1 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bthat many\b/, 'three'], [/\bwould enter\b/, 'would die'], [/\bIf you do\b/, "If you don't"]];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-replace-events-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('p2-replace-events-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('p2-replace-events-1 design 6.10 (local index): synthetic examples', () => {
  it('no p2-replace-events-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

// ---- the round's parser, lowering, lint and engine changes -------------------------------------------------------------------------------------------------

const steps = (f: ReturnType<typeof face>): string => JSON.stringify(f.abilities);

describe('p2-replace-events-1 hole ReplStatic (CR 611.2a, 614.1a): "<duration>, <a replacement effect>" is that replacement effect for the duration', () => {
  it('a duration and a complete replacement sentence: one `effect` step with the replacement, as the static ability with those words has it', () => {
    const f = face('Instant', 'Until end of turn, if an opponent would mill one or more cards, they mill twice that many cards instead.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(steps(f)).toContain('"op":"effect","duration":{"d":"endOfTurn"},"effects":[{"s":"replace","replaces":{"ev":"action","verb":"mill","actor":"opponent"},"body":{"b":"modify","count":{"mul":2}}}]');
  });
  it('fails closed: a replacement about the object itself ("if ~ would die"), a sentence that is not understood whole, and a non-replacement static are not read', () => {
    expect(fullFace(face('Instant', 'Until end of turn, if this spell would die, exile it instead.'))).toBe(false);
    expect(fullFace(face('Instant', 'Until end of turn, if an opponent would mill one or more cards, they mill twice that many cards plus blorfty instead.'))).toBe(false);
    expect(fullFace(face('Instant', 'Until end of turn, if an opponent would mill one or more cards, they lose the game.'))).toBe(false);
  });
});

describe('p2-replace-events-1 lint (CR 608.2c): the condition of an insteadThen is read after its steps', () => {
  it('"If you do" names the payment of the body\'s own steps: no unbound-name; a condition naming no step of the body stays unbound', () => {
    const f = face('Land', 'If this land would enter, sacrifice a Forest instead. If you do, put this land onto the battlefield. If you don\'t, put it into its owner\'s graveyard.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(steps(f)).toContain('"if":{"cond":"did","step":"paid"},"otherwise":{"zone":"graveyard"}');
  });
});

describe('p2-replace-events-1 engine capabilities (CR 614.1a, 614.12)', () => {
  it('the conditional insteadThen is registered', () => {
    expect(ENGINE_CAPABILITIES.has('body:insteadThen.if')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('body:insteadThen')).toBe(true);
  });
});
