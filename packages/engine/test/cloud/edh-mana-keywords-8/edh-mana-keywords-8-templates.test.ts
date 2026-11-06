/**
 * Commander lane edh-mana-keywords, round edh-mana-keywords-8: the template data of parser/templates/zz-cloud/edh-mana-keywords-8.json ("each creature that convoked ~ connives",
 * "exile all creatures except those that share a creature type with a creature that convoked ~, ...", "you may pay {0} rather than pay the equip cost of the first equip ability
 * you activate each turn / during each of your turns", "during your turn, you may activate equip abilities any time you could cast an instant", "spend this mana only to cast
 * monocolored spells of that color", "then if it has N or more K counters on it, remove all of them and ...") and the parser, renderer and engine changes of the round. Guard G9
 * (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON;
 * near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10).
 * The behavior is in edh-mana-keywords-8-scenarios.test.ts. CR cites from the Comprehensive Rules 2026-09-25 (CR 702.51a/c, 701.50a, 205.3m, 406.2, 702.6a, 602.2b, 602.5d, 118.9,
 * 117.1a, 106.6, 105.2, 122.1, 608.2c).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhMk8 from '../../../src/parser/templates/zz-cloud/edh-mana-keywords-8.json';
import review from '../../m5/golden/cards/edh-mana-keywords-8-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhMk8 as Template[];
const MECH_COUNT = 7;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards that print the wording (EDHREC top 5,000; held-out ones opened by the owner, commander request 2026-10-27)
  'eff.edhmk8.convokers.connive': ['Lethal Scheme'],
  'eff.edhmk8.exile.exceptConvokerTypes': ['Everything Comes to Dust'],
  'sta.edhmk8.costMod.firstEquip.free': ['Bruenor Battlehammer'],
  'sta.edhmk8.costMod.firstEquip.free.yourTurns': ['Forge Anew'],
  'sta.edhmk8.permit.equipAsInstant': ['Forge Anew'],
  'rid.edhmk8.mana.monocoloredChosen': ['Throne of Eldraine'],
  'eff.edhmk8.thenIf.removeAllCounters.and': ['Replicating Ring'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (an instant); the others are abilities of a creature (static, activated, triggered; "~ gains" needs a creature). */
const SPELL = new Set<string>(['eff.edhmk8.convokers.connive', 'eff.edhmk8.exile.exceptConvokerTypes']);
/** A synthetic card in which an example is an ability of the right kind. */
/** The templates whose examples need the face's own "choose a color" (a line too common to be an example: design 6.10); the test adds it. */
const CHOOSES_COLOR = new Set<string>(['rid.edhmk8.mana.monocoloredChosen']);
const parsedWith = (t: Template, text: string) => {
  const body = CHOOSES_COLOR.has(t.id) ? `As this creature enters, choose a color.\n${text}` : text;
  return (SPELL.has(t.id) || (t.id === 'eff.edhmk8.thenIf.removeAllCounters.and' && !/^At the beginning/.test(text)) ? parseCard(card('Example Plan', 'Instant', body), OPTS) : parseCard(card('Example Relic', 'Artifact Creature — Golem', body, { power: '2', toughness: '2' }), OPTS)).faces[0]!;
};

describe('edh-mana-keywords-8 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-mana-keywords-8.json, path order: after edh-mana-keywords-4, before look3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-mana-keywords-8.json');
    expect(files.indexOf('zz-cloud/edh-mana-keywords-8.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-mana-keywords-4.json'));
    expect(files.indexOf('zz-cloud/edh-mana-keywords-8.json')).toBeLessThan(files.indexOf('zz-cloud/look3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are eff.edhmk8.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm|trg)\.edhmk8\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) for (const n of NARROW[t.id]!) expect(cards, t.id).toContain(n);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review as { card: string; expect?: string }[]) expect(g.expect, g.card).toBe('full');
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

describe('edh-mana-keywords-8 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} until end of turn.`];
  const swaps: [RegExp, string][] = [
    [/\bdifferent colors\b/, 'the same color'], [/\bless\b/, 'more'], [/\byou activate\b/, 'your opponents activate'], [/\btwo mana\b/, 'three mana'], [/\bfor each\b/, 'for every two'], [/\ban additional\b/, 'two additional'], [/\bany number of\b/, 'all'],
    [/\bany type\b/, 'any color'], [/\bany color\b/, 'any type'], [/\bcould produce\b/, 'produced'], [/\bland produced\b/, 'creature produced'],
    [/\byou control\b/, 'an opponent controls'], [/\ban opponent controls\b/, 'you control'], [/\bone mana\b/, 'two mana'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-mana-keywords-8 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able/until end of turn" or a swapped key word never gives the example's JSON`, () => {
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

describe('edh-mana-keywords-8 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any word (CR 122.1): "a blorfty counter" is a counter kind, not nonsense
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    }, 120_000); // one parse per word of every example: over the default 5 s on the loaded combined copy
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-mana-keywords-8 design 6.10 (local index): synthetic examples', () => {
  it('no edh-mana-keywords-8 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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



describe('edh-mana-keywords-8 parser, renderer and engine changes (one test each)', () => {
  /** The card as the game compiles it (the engine's capabilities decide: a form nothing registers degrades the card). */
  const full = (text: string, type = 'Artifact', pt?: [string, string]): boolean => {
    const d = compileCard(card('Example Relic', type, text, pt === undefined ? {} : { power: pt[0], toughness: pt[1] }) as OracleCard);
    return d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && !JSON.stringify(d.faces).includes('"kind":"manual"');
  };
  it('actions/activate.ts#abilityPlan, parser/lower/activation.ts (CR 106.6, 602.2b): "Spend only mana of the chosen color to activate this ability." needs the face\'s entering color choice', () => {
    expect(full('As this artifact enters, choose a color.\n{3}, {T}: Draw a card. Spend only mana of the chosen color to activate this ability.')).toBe(true);
    expect(full('{3}, {T}: Draw a card. Spend only mana of the chosen color to activate this ability.')).toBe(false); // nothing chose a color
    expect(full('As this artifact enters, choose a color.\n{3}, {T}: Draw a card. Spend only mana of the chosen type to activate this ability.')).toBe(false);
    expect(full('As this artifact enters, choose a color.\n{3}, {T}: Draw a card. Spend only colorless mana to activate this ability.')).toBe(false);
  });
  it('model/forms.ts: a mana ability with the spend-only restriction is not automated (mana abilities use no plan of the activation code)', () => {
    expect(full('As this artifact enters, choose a color.\n{T}: Add {C}. Spend only mana of the chosen color to activate this ability.')).toBe(false);
  });
  it('model/lint-nodes.ts (CR 702.51c, 707.10): the reference to the convoking creatures belongs to a spell: a triggered ability that reads it is not understood', () => {
    expect(full('Whenever ~ attacks, each creature that convoked this spell connives.', 'Creature — Human', ['2', '2'])).toBe(false);
  });
});
