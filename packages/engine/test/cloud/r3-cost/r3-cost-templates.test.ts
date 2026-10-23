/**
 * r3-cost (Standard round 3: costs and mana; tuning half): the template data of parser/templates/zz-cloud/r3-cost.json. Guard G9 (design 6.8): every example
 * lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design
 * 6.10), checked against the local index when it is present. The behavior is in the other files of this folder.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import r3cost from '../../../src/parser/templates/zz-cloud/r3-cost.json';
import review from '../../m5/golden/cards/cloud-r3-cost-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const R3 = r3cost as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/**
 * Design 6.9 evidence for a stable template: three hand-verified golden cards, or, for a sentence few real cards print, every one of them in the tuning half
 * (the line is how the local index finds them; the test at the end checks the list against the index).
 */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp }>> = {
  'eff.r3cost.costmod.abilities.lessX.floorOne': { cards: ['Agatha of the Vile Cauldron'], line: /cost \{X\} less to activate, where X is [^.]+\. This effect can't reduce the mana in that cost to less than one mana/ },
  'eff.r3cost.permit.alt.mana.once.exile': { cards: ['Charred Foyer // Warped Space', 'Tlincalli Hunter // Retrieve Prey'], line: /^Once each turn, you may pay \{[^}]+\} rather than pay the mana cost for an? [^.]*spell you cast from exile\./m },
  'eff.r3cost.permit.alt.mana.once.hand': { cards: ['Darksteel Monolith'], line: /^Once each turn, you may pay \{[^}]+\} rather than pay the mana cost for an? [^.]*spell you cast from your hand\./m },
  'eff.r3cost.permit.free.fromHand': { cards: ['Omniscience'], line: /^You may cast [^.]*spells from your hand without paying their mana costs\./m },
  'eff.r3cost.permit.free': { cards: ['Dracogenesis'], line: /^You may cast [A-Za-z ]*spells without paying their mana costs\./m },
  'eff.r3cost.permit.self.graveyard.removeAmong': { cards: ['Quilled Greatwurm'], line: /^You may cast this card from your graveyard by removing \w+ counters from among [^.]+ in addition to paying its other costs\./m },
  'eff.r3cost.exile.topX.their.damageDealt': { cards: ['Kotis, the Fangkeeper'], line: /exile the top X cards of their library, where X is the amount of damage dealt\./ },
  'eff.r3cost.cast.anyNumber.free.mvOrLess.fromAmong': { cards: ['Kotis, the Fangkeeper', 'Villainous Wealth'], line: /You may cast any number of spells with mana value X or less from among them without paying their mana costs\./ },
  'eff.r3cost.mana.eitherType.forEach': { cards: ['Muerra, Trash Tactician'], line: /add \{[WUBRGC]\} or \{[WUBRGC]\} for each / },
  'eff.r3cost.additional.blightX.max': { cards: ['Soul Immolation'], line: /blight X\. X can't be greater than / },
  'eff.r3cost.costmod.spells.more.opp.fromGraveyardsOrExile': { cards: ['Aven Interrupter'], line: /spells your opponents cast from graveyards or from exile cost \{/i },
  'eff.r3cost.costmod.spells.less.fromGraveyardOrExile': { cards: ['Doc Aurlock, Grizzled Genius'], line: /spells you cast from your graveyard or from exile cost \{/i },
  'eff.r3cost.costmod.spells.less.notFromHand': { cards: ["Fortune Teller's Talent", 'Sage of the Beyond', 'Savvy Trader'], line: /spells you cast from anywhere other than your hand cost \{/i },
  'eff.r3cost.kw.crew.once': { cards: ['Luxurious Locomotive'], line: /^Crew \d+\. Activate only once each turn\./m },
  // std-rx28 (a 6.9 deviation named in its record): promoted on its one printing, Monstrous Emergence (Standard, held-out: both halves are open for Standard cards)
  'eff.r3cost.additional.behold.spelledOut': { cards: ['Monstrous Emergence'], line: /^As an additional cost to cast this spell, choose an? [^.]+ you control or reveal an? [^.]+ card from your hand\./m },
};

/** Golden entries pinned as pending (not full): a card whose other sentence another slice or engine family owns. */
// r5-cost: Improvisation Capstone and Dance with Calamity, evidence of eff.r3cost.cast.anyNumber.free.fromAmong (promoted to stable with Etali, Primal Storm);
// std-rx31: Improvisation Capstone is full (its exile-until-total-mana-value sentence, zz-cloud/std-rx31.json)
// std-rx26: Doc Aurlock, Grizzled Genius is full now (its plot sentence, sta.stdrx26.plotting.fromHand.costsLess), so its entry expects full
const PENDING: ReadonlySet<string> = new Set(['Dance with Calamity', 'Villainous Wealth', 'Aven Interrupter', 'Sage of the Beyond', "Fortune Teller's Talent", 'Luxurious Locomotive']);

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a triggered, activated or static ability on a creature (an additional cost on an enchantment). */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind !== 'static' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  // a permanent spell's additional cost, then its enters trigger: the type line the coverage gate tries a static example under (cards coverage/mutation.ts)
  if (t.id.startsWith('eff.r3cost.additional.')) return card('Example Shrine', 'Enchantment', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('r3-cost template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/r3-cost.json, path order: after look3, before std-) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/r3-cost.json');
    expect(files.indexOf('zz-cloud/r3-cost.json')).toBeGreaterThan(files.indexOf('zz-cloud/look3.json'));
    expect(files.indexOf('zz-cloud/r3-cost.json')).toBeLessThan(files.indexOf('zz-cloud/std-blb.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.r3cost.*', () => {
    for (const t of R3) {
      expect(t.id, t.id).toMatch(/^eff\.r3cost\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three hand-verified golden cards, or every tuning card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of R3.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => (g.verified.match(/eff\.r3cost\.[A-Za-z0-9.]*[A-Za-z0-9]/g) ?? ([] as string[])).includes(t.id)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole.cards].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
    for (const g of golden) expect(g.expect, g.card).toBe(PENDING.has(g.card) ? undefined : 'full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of R3) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('r3-cost guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of R3) {
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

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '').replace(/\."$/, '"');
  const plain = text.endsWith('"') ? [] : [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const out = [...plain];
  const swaps: [RegExp, string][] = [
    [/\bless\b/, 'more'], [/\bone mana\b/, 'two mana'], [/\bwithout paying\b/, 'by paying'], [/\bfrom your hand\b/, 'from your graveyard'], [/\byou control\b/, 'your opponents control'],
    [/\bfrom exile\b/, 'from your hand'], [/\brather than\b/, 'in addition to'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('r3-cost guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of R3) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
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

describe('r3-cost guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of R3) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '~,' || w === "~'s" || /^"?\{/.test(w) || w.includes('\n')) return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const start = w.startsWith('"') ? '"' : '';
          const mutated = [...words.slice(0, i), `${start}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('r3-cost design 6.10 (local index): synthetic examples, the whole corpus of each sentence, real cards', () => {
  it('no r3-cost line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = R3.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  it('each card named as the whole tuning corpus of a sentence prints it (the list was taken from the tuning half with npm run cards, design 6.12)', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      for (const name of w.cards) {
        const c = (index ?? []).find((x) => x.name === name);
        expect(c, name).toBeDefined();
        expect([c!.oracle_text, ...(c!.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && w.line.test(x)), `${id}: ${name}`).toBe(true);
      }
    }
  });

  // the try step on real cards: each card reads its line with the named template, passes the exact render gate and is fully automated
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'eff.r3cost.costmod.abilities.less.floorOne': ['Forensic Gadgeteer', 'Training Grounds', 'Heartstone'],
    'eff.r3cost.costmod.abilities.lessX.floorOne': ['Agatha of the Vile Cauldron'],
    'eff.r3cost.permit.alt.mana': ['Leyline of Mutation', 'Fist of Suns', 'Rooftop Storm'],
    'eff.r3cost.permit.alt.mana.once.exile': ['Charred Foyer // Warped Space', 'Tlincalli Hunter // Retrieve Prey'],
    'eff.r3cost.permit.alt.mana.once.hand': ['Darksteel Monolith'],
    'eff.r3cost.permit.free.fromHand': ['Omniscience'],
    'eff.r3cost.permit.free': ['Dracogenesis'],
    'eff.r3cost.permit.self.graveyard.removeAmong': ['Quilled Greatwurm'],
    'eff.stdtmt.mana.thatMuch': ['Raphael, Ninja Destroyer', 'Sakiko, Mother of Summer', 'The Flux'],
    'eff.r3cost.exile.topX.their.damageDealt': ['Kotis, the Fangkeeper'],
    'eff.r3cost.cast.anyNumber.free.mvOrLess.fromAmong': ['Kotis, the Fangkeeper'],
    'eff.r3cost.cast.anyNumber.free.fromAmong': ['Etali, Primal Storm'], // r5-cost: the top card of each player's library (parser/lower/mentions.ts)
    'eff.r3cost.mana.eitherType.forEach': ['Muerra, Trash Tactician'],
    'eff.r3cost.additional.blightX.max': ['Soul Immolation'],
    'eff.r3cost.costmod.spells.less.notFromHand': ['Savvy Trader'],
  };
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.join(', ')} read the line with it, pass the render gate and are fully automated`, () => {
      for (const name of names) {
        const oracle = (index ?? []).find((c) => c.name === name);
        expect(oracle, name).toBeDefined();
        expect(compileCard(oracle!).automation.level, name).toBe('full');
        const parsed = parseCard(oracle!, OPTS);
        expect(parsed.faces.flatMap((f) => f.templatesUsed), name).toContain(id);
        expect(parsed.faces.every((f) => f.gate.every((g) => g.ok)), name).toBe(true);
      }
    }, 60_000);
  }
});
