/**
 * Standard round 9 (new templates and template status): the template data of parser/templates/zz-cloud/std-r9.json, the templates of earlier rounds this round
 * promoted to `stable` (design 6.9; their evidence is in each template's own review file), and the parser, renderer and engine support of the round (the
 * quantity `turnsBegun`, the renderer of "when you next attack this turn"). Guard G9 (design 6.8): every example lowers with its template, is automated and
 * passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in
 * place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it
 * is present. The behavior is in std-r9-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdR9 from '../../../src/parser/templates/zz-cloud/std-r9.json';
import review from '../../m5/golden/cards/cloud-std-r9-review.json';
import r3staticReview from '../../m5/golden/cards/cloud-r3-static-review.json';
import r3digReview from '../../m5/golden/cards/cloud-r3-dig-review.json';
import r4staticReview from '../../m5/golden/cards/cloud-r4-static-review.json';
import r4digReview from '../../m5/golden/cards/cloud-r4-dig-review.json';
import r3chooseReview from '../../m5/golden/cards/cloud-r3-choose-review.json';
import r3copyReview from '../../m5/golden/cards/cloud-r3-copy-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const R9 = stdR9 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** A synthetic card in which an example is an ability of the right kind: the cast restriction on a creature spell, the delayed trigger on a sorcery. */
const exampleCard = (t: Template, text: string): OracleCard =>
  t.kind === 'effect' ? card('Example Volley', 'Sorcery', text) : card('Example Brute', 'Creature — Giant Warrior', text, { power: '3', toughness: '3' });
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
const status = (id: string): string | undefined => TEMPLATE_SET.find((t) => t.id === id)?.status;

describe('std-r9 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-r9.json, after zz-cloud/std-otj.json, before zz-cloud/std-sos.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-r9.json');
    expect(files.indexOf('zz-cloud/std-r9.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-otj.json'));
    expect(files.indexOf('zz-cloud/std-r9.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, is stable with hand-verified golden cards, and is of version 8', () => {
    expect(R9.map((t) => t.id)).toEqual(['rst.stdr9.cast.self.firstThreeTurns', 'eff.stdr9.nextAttack.thisTurn']);
    for (const t of R9) {
      expect(t.id, t.id).toMatch(/^(rst|eff)\.stdr9\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.status, t.id).toBe('stable');
      expect(t.since, t.id).toBe(8);
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // three independently verified golden cards (design 6.9), two Standard-legal (one held-out, open since 2026-10-17) and one of the tuning half (design 6.12)
    expect(goldenUsing('rst.stdr9.cast.self.firstThreeTurns').sort()).toEqual(['Jace Reawakened', 'Serra Avenger', 'Spider-Man 2099']);
    // a narrow wording with one card in the index: stable on one golden card, a 6.9 deviation named in the round record
    expect(goldenUsing('eff.stdr9.nextAttack.thisTurn')).toEqual(['All-Out Assault']);
  });
  it('design 6.9: the templates the round promoted carry their evidence in their own review files; the templates other rounds held back stay experimental', () => {
    const promoted: [string, Golden, string[]][] = [
      ['sta.r3static.anthem.foreach', r3staticReview as Golden, ['Armament Master', 'Heavenly Blademaster', 'Kellan, the Fae-Blooded // Birthright Boon']],
      ['sta.r3static.noMaxHand.noLossForZeroLife', r3staticReview as Golden, ["Marina Vendrell's Grimoire"]],
      ['eff.r3dig.putThat.battlefieldTapped.rest.bottomRandom', r3digReview as Golden, ['Clifftop Lookout', 'The Regalia']],
      ['sta.r4static.aslong.base.grant', r4staticReview as Golden, ['Living Conundrum']],
      ['eff.r4dig.milled.mayPutUpTo.hand', r4digReview as Golden, ["Smuggler's Surprise"]],
      ['eff.r3choose.exile.thenReturn.yours.tappedAttacking', r3chooseReview as Golden, ['The Neutrinos']],
      ['eff.r3copy.copyToken.notLegendary.subtype.has', r3copyReview as Golden, ["The Apprentice's Folly"]],
    ];
    for (const [id, file, cards] of promoted) {
      expect(status(id), id).toBe('stable');
      expect(goldenUsing(id, file).filter((c) => cards.includes(c)).sort(), id).toEqual([...cards].sort());
    }
    // r4-dig's review moved these back to experimental for lack of evidence (held-out non-Standard cards withdrawn); std-finish-1 promoted them on their
    // Standard golden cards (Armored Kincaller, Fblthp, Ninja's Blades; owner approval 2026-10-21), the evidence in r4-dig's and T77's own review files
    for (const id of ['eff.r4dig.search.differentNames.reveal', 'eff.r4dig.reveal.fromHand.one', 'sta.t77.attached.pump.addtype.quoted']) expect(status(id), id).toBe('stable');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of R9) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'next', 'then', 'when']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-r9 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of R9) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
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

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} if able.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bthird\b/, 'fourth'], [/\bfirst\b/, 'last'], [/\byour first\b/, 'their first'], [/\bof the game\b/, 'this game'], [/\bcan't\b/, 'can'],
    [/\bnext attack\b/, 'next block'], [/\bthis turn\b/, 'next turn'], [/\bWhen you\b/, 'When an opponent'], [/\bthis turn\b/, 'this combat'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-r9 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of R9) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
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

describe('std-r9 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of R9) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w.includes('\n')) return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-r9 parser, renderer and engine support', () => {
  const creature = (text: string) => parseCard(card('Example Brute', 'Creature — Giant', text, { power: '3', toughness: '3' }), OPTS).faces[0]!;
  const sorcery = (text: string) => parseCard(card('Example Volley', 'Sorcery', text), OPTS).faces[0]!;
  it('CR 500.7: the quantity `turnsBegun` is an engine capability of the interpreter, the statics and the trigger conditions (q:, sq:, rq:)', () => {
    for (const c of ['q:turnsBegun', 'sq:turnsBegun', 'rq:turnsBegun']) expect(ENGINE_CAPABILITIES.has(c), c).toBe(true);
  });
  it('CR 601.3: the renderer says only the three-turn wording; the same restriction counting two turns has no renderer (manual), and "unless" keeps T32\'s reading', () => {
    const f = creature("You can't cast this spell during your first, second, or third turns of the game.");
    expect(JSON.stringify(f.abilities)).toContain('{"cond":"compare","left":{"q":"turnsBegun"},"op":"<=","right":3}');
    expect(fullyAutomated(creature("You can't cast this spell during your first or second turns of the game."))).toBe(false);
    expect(JSON.stringify(creature("You can't cast this spell unless you control a Wizard.").abilities)).toContain('"mode":"onlyIf"');
  });
  it('CR 606.4, 107.3a: "−X: ..." is a loyalty cost of minus X (cost.loyaltyX), whose effect may read X; "+X" stays manual', () => {
    const walker = (text: string) => parseCard(card('Example Seer', 'Legendary Planeswalker — Testa', text), OPTS).faces[0]!;
    const minus = walker('+1: Draw a card.\n−X: Target player mills X cards.');
    expect(fullyAutomated(minus)).toBe(true);
    expect(JSON.stringify(minus.abilities)).toContain('"cost":{"loyaltyX":true},"isLoyalty":true');
    expect(fullyAutomated(walker('+1: Draw a card.\n+X: Target player mills X cards.'))).toBe(false);
  });
  it('CR 603.7b, 603.2c: "when you next attack this turn" is a once-only, batched delayed trigger of your declaration; "whenever you attack this turn" (T50) triggers each time', () => {
    const next = sorcery('Draw a card. When you next attack this turn, untap all lands you control.');
    expect(JSON.stringify(next.abilities)).toContain('"duration":{"d":"endOfTurn"},"once":true,"batch":true');
    const every = sorcery('Draw a card. Whenever you attack this turn, untap all lands you control.');
    expect(jsonKey(every.abilities)).not.toBe(jsonKey(next.abilities));
    expect(JSON.stringify(every.abilities)).not.toContain('"once":true');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-r9 design 6.10 (local index): synthetic examples', () => {
  it('no std-r9 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Saga)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = R9.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
