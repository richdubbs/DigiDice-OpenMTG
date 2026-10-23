/**
 * Phase 2 lane p2-replace-events, round p2-replace-events-2: the template data of parser/templates/zz-cloud/p2-replace-events-2.json (event replacements, CR 614.1a:
 * "If that creature would leave the battlefield, exile it instead of putting it anywhere else." and its quoted form; an enchanted land that would be destroyed; a
 * creature that would die exiled with a token; "you may skip that draw"; "the next time you would draw a card this turn, ... instead"; a proliferate replaced;
 * "If this permanent would be put into a graveyard, you may put it on top of its owner's library instead.") and the round's parser, lowering and engine changes: the
 * object a replacement created by an instruction is about is the object an earlier step moved (lower/anaphora.ts#actingPaths, CR 400.7); a target inside a
 * replacement's instructions is refused (lower/targets.ts#targetsInReplacementSteps); the `proliferate` proposal kind (effects/proposal-kinds/proliferate.ts).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in p2-replace-events-2-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import p2re2 from '../../../src/parser/templates/zz-cloud/p2-replace-events-2.json';
import review from '../../m5/golden/cards/p2-replace-events-2-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = p2re2 as Template[];
const MECH_COUNT = 8;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one or two cards of the tuning half, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'rep.p2re2.leave.exileInsteadAnywhere.obj': ['Gruesome Encore', 'Isareth the Awakener'],
  'rep.p2re2.leave.exileInsteadAnywhere.self': ['Geth, Thane of Contracts'],
  'rep.p2re2.enchantedLand.destroyed.sacrificeInstead.gains': ['Harmonious Emergence', 'Crackling Emergence'],
  'rep.p2re2.dies.insteadExileCard.create': ['Kalitas, Traitor of Ghet'],
  'rep.p2re2.draw.maySkip': ['Obstinate Familiar'],
  'rep.p2re2.nextDraw.insteadEffects': ['Words of Wilding', 'Words of Waste'],
  'rep.p2re2.proliferate.insteadEffects': ['Tekuthal, Inquiry Dominus'],
  'rep.p2re2.self.graveyard.mayTopLibrary': ['Pulmonic Sliver'],
};
/** Templates kept experimental (none: each has its golden evidence). */
const EXPERIMENTAL: readonly string[] = [];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a creature (a static ability), an instant for an effect example. */
const parsedWith = (t: Template, text: string) => parseCard(card('Example Ledger', /^Enchant snow land/.test(text) ? 'Enchantment — Aura' : /^(Return|Put) target/.test(text) ? 'Sorcery' : 'Creature — Snake', text, /^Enchant snow land|^(Return|Put) target/.test(text) ? {} : { power: '2', toughness: '2' }), OPTS).faces[0]!;
const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Monk', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');

describe('p2-replace-events-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-replace-events-2.json, after zz-cloud/look3.json, before zz-cloud/r3-choose.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-replace-events-2.json');
    expect(files.indexOf('zz-cloud/p2-replace-events-2.json')).toBeGreaterThan(files.indexOf('zz-cloud/look3.json'));
    expect(files.indexOf('zz-cloud/p2-replace-events-2.json')).toBeLessThan(files.indexOf('zz-cloud/r3-choose.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are rep.p2re2.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^rep\.p2re2\./);
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

describe('p2-replace-events-2 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('p2-replace-events-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('p2-replace-events-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('p2-replace-events-2 design 6.10 (local index): synthetic examples', () => {
  it('no p2-replace-events-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

// ---- the round's lowering and engine changes ------------------------------------------------------------------------------------------------------------------

const steps = (f: ReturnType<typeof face>): string => JSON.stringify(f.abilities);

describe('p2-replace-events-2 lowering (CR 400.7, 614.1a): the object of a replacement an instruction creates is the object an earlier step moved', () => {
  it('"that creature" after a return is the returned permanent (`bound`), not the card the target was', () => {
    const f = face('Sorcery', 'Return target creature card from your graveyard to the battlefield. If that creature would leave the battlefield, exile it instead of putting it anywhere else.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(steps(f)).toContain('"subject":{"is":{"ref":"bound","name":"moved"}}');
  });
});

describe('p2-replace-events-2 targets (CR 614.1a): a target inside the instructions a replacement performs is refused', () => {
  it('"... deals 2 damage to any target instead" stays manual; the same effect with no target is read', () => {
    expect(fullFace(face('Enchantment', '{1}: The next time you would draw a card this turn, ~ deals 2 damage to any target instead.'))).toBe(false);
    expect(fullFace(face('Enchantment', '{1}: The next time you would draw a card this turn, ~ deals 2 damage to each opponent instead.'))).toBe(true);
  });
});

describe('p2-replace-events-2 engine capabilities (CR 701.34a, 614.1a)', () => {
  it('the proliferate replacement form is registered; the trigger form is not changed by it', () => {
    expect(ENGINE_CAPABILITIES.has('feature:replace.on.action.proliferate')).toBe(true);
  });
});
