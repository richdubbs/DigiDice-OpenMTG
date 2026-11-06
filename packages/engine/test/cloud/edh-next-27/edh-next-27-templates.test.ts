/**
 * Commander lane edh-next, round edh-next-27: the template data of parser/templates/zz-cloud/edh-next-27.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-next-27-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. CR cites checked against the Comprehensive Rules of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhNext27 from '../../../src/parser/templates/zz-cloud/edh-next-27.json';
import review from '../../m5/golden/cards/edh-next-27-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext27 as Template[];
const MECH_COUNT = 3;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full
  'eff.edhn27.each.exilesNFromHand.opponent': ['Nicol Bolas, God-Pharaoh'],
  'kw.edhn27.equip.subtypeList': ['Robe of the Archmagi'],
  'eff.edhn27.counters.twoKindsTwoObjects': ['Arwen, Mortal Queen'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  text.startsWith('Equip ') ? card('Example Plate', 'Artifact — Equipment', text) : t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-27 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-27.json, path order: after edh-next-22, before edh-next-3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-27.json');
    expect(files.indexOf('zz-cloud/edh-next-27.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-22.json'));
    expect(files.indexOf('zz-cloud/edh-next-27.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhn27.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|kw)\.edhn27\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
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

describe('edh-next-27 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bElf\b/, 'Elves'], [/\bflying\b/, 'x'], [/\btwo\b/, 'three'], [/\bexiles\b/, 'gains'], [/\bcounter\b/, 'x'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-27 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-27 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // a counter kind is any word (CR 122.1b: a counter with a name no rule defines is allowed)
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

describe.skipIf(index === null)('edh-next-27 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-27 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-next-27 renderer, lowering and engine changes (one test each)', () => {
  const creature = (text: string, type = 'Creature — Wizard', name = 'Example Beast') => parseCard(card(name, type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  const spell = (text: string, type = 'Instant') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  const equipment = (text: string) => parseCard(card('Example Plate', 'Artifact — Equipment', text), OPTS).faces[0]!;
  it('render/steps-cards.ts (CR 106.1b, 106.4; Grand Warlord Radha): "add that much mana in any combination of {R} and/or {G}" after a batch attack trigger; a third type or an added duration stays out', () => {
    expect(fullyAutomated(creature('Whenever one or more creatures you control attack, add that much mana in any combination of {R} and/or {G}.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever one or more creatures you control attack, add that much mana in any combination of {R} and/or {G} and/or {W}.'))).toBe(false);
    expect(fullyAutomated(creature('Whenever one or more creatures you control attack, add that much mana in any combination of {R} and/or {G} until end of turn.'))).toBe(false);
  });
  it('render/steps-cards.ts (CR 701.17a, 107.3; Jace, the Perfected Mind): "mills three times X cards"; X must be the ability\'s own X', () => {
    expect(fullyAutomated(creature('{X}: Target player mills three times X cards.'))).toBe(true);
    expect(fullyAutomated(creature('{X}: Target player mills three times Y cards.'))).toBe(false);
  });
  it('render/steps-life.ts (CR 122.1, 119.3, 603.3d; Betor): "a number of +1/+1 counters on <target> equal to the amount of life you gained this turn"; the unreadable "equal to" amount stays out', () => {
    expect(fullyAutomated(creature('At the beginning of your end step, put a number of +1/+1 counters on up to one other target creature you control equal to the amount of life you gained this turn.'))).toBe(true);
    expect(fullyAutomated(creature('At the beginning of your end step, put a number of +1/+1 counters on up to one other target creature you control equal to the amount of life you gamed this turn.'))).toBe(false);
  });
  it('render/program.ts + steps-lasting.ts (CR 107.3, 603.12; Go-Shintai): a reflexive trigger\'s target limited by a count is also said "toughness X or less, where X is ..."', () => {
    expect(fullyAutomated(creature('At the beginning of your end step, you may pay {1}. When you do, destroy target creature with toughness X or less, where X is the number of Shrines you control.'))).toBe(true);
    expect(fullyAutomated(creature('At the beginning of your end step, you may pay {1}. When you do, destroy target creature with toughness X or less, where Y is the number of Shrines you control.'))).toBe(false);
  });
  it('front/selfref.ts (CR 201.5c; King Darien XLVIII): a legendary name ending in a Roman numeral is also called without it; a card that is not legendary is not', () => {
    const legend = parseCard(card('Test Sovereign XLVIII', 'Legendary Creature — Human', '{2}: Put a +1/+1 counter on Test Sovereign.', { power: '2', toughness: '2' }), OPTS).faces[0]!;
    expect(fullyAutomated(legend)).toBe(true);
    const plain = parseCard(card('Test Sovereign XLVIII', 'Creature — Human', '{2}: Put a +1/+1 counter on Test Sovereign.', { power: '2', toughness: '2' }), OPTS).faces[0]!;
    expect(fullyAutomated(plain)).toBe(false);
  });
  it('parser/segment.ts + render/kw.ts (CR 702.6c; Robe of the Archmagi): "Equip A, B, or C {N}" is ONE equip ability, and two equip abilities in one line are still two', () => {
    expect(fullyAutomated(equipment('Equip Elf, Druid, or Scout {1}'))).toBe(true);
    const two = equipment('Equip {2}, Equip {3}');
    expect(two.abilities.filter((a) => a.kind === 'keyword').length).toBe(2);
    expect(fullyAutomated(equipment('Equip Elf, Druid {1}'))).toBe(false);
  });
  it('render/fold-edhn27.ts (CR 406.1, 608.2d, 101.4): "each opponent exiles two cards from their hand" renders; "target opponent exiles ..." keeps its own reading', () => {
    expect(fullyAutomated(spell('Each opponent exiles two cards from their hand.', 'Sorcery'))).toBe(true);
    expect(fullyAutomated(spell('Target opponent exiles three cards from their hand.', 'Sorcery'))).toBe(true);
    expect(fullyAutomated(spell('Each opponent exiles two cards from your hand.', 'Sorcery'))).toBe(false);
  });
});
