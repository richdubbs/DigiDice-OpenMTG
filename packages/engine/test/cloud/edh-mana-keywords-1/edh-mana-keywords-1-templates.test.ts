/**
 * Commander lane edh-mana-keywords, round edh-mana-keywords-1: the template data of parser/templates/zz-cloud/edh-mana-keywords-1.json ("add one mana of any color
 * among <filter>", "Equip legendary creature {cost}", "the exiled card's colors", "add N mana in any combination of colors / of two or three types", "..., add N mana of
 * that type instead", "a Shaman or another Wizard you control" for trigger doubling). Ported in part from the stopped p2-mana-3.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in edh-mana-keywords-1-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhMk1 from '../../../src/parser/templates/zz-cloud/edh-mana-keywords-1.json';
import review from '../../m5/golden/cards/edh-mana-keywords-1-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';
import p2Mana1Review from '../../m5/golden/cards/cloud-p2-mana-1-review.json';

const MECH = edhMk1 as Template[];
const MECH_COUNT = 9;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'kw.edhmk1.equip.legendary': ['Blackblade Reforged', 'Excalibur, Sword of Eden'],
  'eff.edhmk1.mana.exiledCardColors': ['Chrome Mox'],
  'sta.edhmk1.triggerMod.sharedController': ['Harmonic Prodigy'],
  'rid.edhmk1.instead.thatType': ['Incubation Druid'],
  'eff.edhmk1.mana.anyCombination.qty': ['Cascading Cataracts'],
  'eff.edhmk1.mana.anyCombination.twoTypes': ['Orcish Lumberjack'],
  'eff.edhmk1.mana.anyCombination.twoTypes.whereX': ['Burnt Offering', 'Vivi Ornitier'],
  'eff.edhmk1.mana.anyCombination.threeTypes': ['Relic of Sauron'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (an instant); the others are abilities of a creature (static, activated, triggered; "~ gains" needs a creature). */
const SPELL = new Set<string>();
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Plan', 'Instant', text), OPTS) : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-mana-keywords-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-mana-keywords-1.json, path order: after cmd5, before look3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-mana-keywords-1.json');
    expect(files.indexOf('zz-cloud/edh-mana-keywords-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/cmd5.json'));
    expect(files.indexOf('zz-cloud/edh-mana-keywords-1.json')).toBeLessThan(files.indexOf('zz-cloud/look3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.edhmk1.* (or kw., sta., rid.)', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw)\.edhmk1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = [...(review as { card: string; verified: string; expect?: string }[]), ...(p2Mana1Review as { card: string; verified: string; expect?: string }[])]; // Incubation Druid's entry is in the file of the template it promotes (guide section 6)
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

describe('edh-mana-keywords-1 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bremoved this way\b/, 'put this way'], [/\bfor each\b/, 'for every two'], [/\ban additional\b/, 'two additional'], [/\bany number of\b/, 'all'],
    [/\bany type\b/, 'any color'], [/\bany color\b/, 'any type'], [/\bcould produce\b/, 'produced'], [/\bland produced\b/, 'creature produced'],
    [/\byou control\b/, 'an opponent controls'], [/\ban opponent controls\b/, 'you control'], [/\bone mana\b/, 'two mana'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-mana-keywords-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-mana-keywords-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-mana-keywords-1 design 6.10 (local index): synthetic examples', () => {
  it('no edh-mana-keywords-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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



describe('edh-mana-keywords-1 parser and renderer changes (one test each)', () => {
  const face = (text: string, type = 'Artifact') => parseCard(card('Example Relic', type, text), OPTS).faces[0]!;
  it('CR 602.5d, 605.3a: "Activate only as an instant." on a mana ability stays manual (it forbids activating while a cost is paid; the model has no field for it)', () => {
    expect(fullyAutomated(face('{T}, Sacrifice ~: Add {C}{C}. Activate only as an instant.'))).toBe(false);
  });
  it('render/kw.ts (CR 702.6c): "Equip legendary creature {1}" prints back as itself; "Equip legendary creatures you control {1}" and a nonlegendary quality do not parse to it', () => {
    expect(fullyAutomated(face('Equip legendary creature {1}', 'Artifact — Equipment'))).toBe(true);
    expect(JSON.stringify(face('Equip legendary creature {1}', 'Artifact — Equipment').abilities)).toContain('"supertypes":["Legendary"]');
    expect(fullyAutomated(face('Equip nonlegendary creature {1}', 'Artifact — Equipment'))).toBe(false);
  });
  it('render/steps-flow.ts#thatTypeInstead (CR 614.15): "add three mana of that type instead" only replaces a could-produce production of the same objects', () => {
    const ok = face('{T}: Add one mana of any type that a land you control could produce. If ~ has a +1/+1 counter on it, add three mana of that type instead.', 'Creature — Elf');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"oneType":true');
    expect(fullyAutomated(face('{T}: Add one mana of any color. If ~ has a +1/+1 counter on it, add three mana of that type instead.', 'Creature — Elf'))).toBe(false);
  });
  it('eff.p2mana1.mana.couldProduce.type is stable (promoted with Reflecting Pool, Horizon of Progress and Incubation Druid as golden cards)', () => {
    const t = TEMPLATE_SET.find((x) => x.id === 'eff.p2mana1.mana.couldProduce.type')!;
    expect(t.status).toBe('stable');
    const golden = (p2Mana1Review as { card: string; verified: string }[]).filter((g) => g.verified.includes('(eff.p2mana1.mana.couldProduce.type') || g.verified.includes(' eff.p2mana1.mana.couldProduce.type')).map((g) => g.card);
    expect(golden).toEqual(expect.arrayContaining(['Reflecting Pool', 'Horizon of Progress', 'Incubation Druid']));
  });
});
