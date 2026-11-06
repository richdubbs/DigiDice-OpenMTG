/**
 * Commander lane edh-cast, round edh-cast-5: the template data of parser/templates/zz-cloud/edh-cast-5.json ("for each {B} in a cost, you may pay 2 life rather than pay that
 * mana", "as an additional cost to cast green permanent spells, you may pay 2 life. Those spells cost {G} less ...", "you may exile any number of blue cards from your hand. This
 * spell costs {2} less to cast for each card exiled this way", "you gain half X life and draw half X cards. Round down each time", "exiles the top half of their library, rounded
 * up", "has annihilator X, where X is the number of +1/+1 counters on it") and the parser, renderer and engine changes of the round (one test each at the end). Guard G9
 * (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON;
 * near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10),
 * checked against the local index when it is present. The behavior is in edh-cast-5-scenarios.test.ts. CR cites checked against the Comprehensive Rules 2026-09-25
 * (media.wizards.com), see the record.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { solve, colorsOfSymbol, lifeColorOf } from '../../../src/rules/solver';
import { parseManaCost } from '../../../src/types/mana';
import edhCast5 from '../../../src/parser/templates/zz-cloud/edh-cast-5.json';
import review from '../../m5/golden/cards/edh-cast-5-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhCast5 as Template[];
const MECH_COUNT = 6;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only one
 * or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT, owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'sta.edhc5.lifeFor.eachSymbol': ["K'rrik, Son of Yawgmoth"],
  'sta.edhc5.lifeFor.additionalCost.reduce': ['Defiler of Vigor', 'Defiler of Dreams', 'Defiler of Instinct'],
  'cm.edhc5.additional.exileFromHandAny.lessForEach': ['March of Swirling Mist'],
  'eff.edhc5.gainHalfX.drawHalfX.roundDown': ['Hydroid Krasis'],
  'eff.edhc5.player.exileTop.halfLibraryRoundedUp': ['Ulamog, the Defiler'],
  'kw.edhc5.annihilator.whereX.counters': ['Ulamog, the Defiler'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (a sorcery); the others are abilities of a creature (static, activated, triggered). */
const SPELL = new Set<string>(['cm.edhc5.additional.exileFromHandAny.lessForEach', 'eff.edhc5.gainHalfX.drawHalfX.roundDown', 'eff.edhc5.player.exileTop.halfLibraryRoundedUp']);
/** A synthetic card in which an example is an ability of the right kind ({X} in the cost for the one that reads X, CR 107.3). */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id)
    ? parseCard(card('Example Plan', 'Sorcery', text, t.id === 'eff.edhc5.gainHalfX.drawHalfX.roundDown' ? { mana_cost: '{X}{G}' } : undefined), OPTS)
    : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-cast-5 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-cast-5.json, path order: after edh-cast-3, before edh-combat-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-cast-5.json');
    expect(files.indexOf('zz-cloud/edh-cast-5.json')).toBeGreaterThan(files.indexOf('zz-cloud/cmd5.json'));
    expect(files.indexOf('zz-cloud/edh-cast-5.json')).toBeLessThan(files.indexOf('zz-cloud/edh-combat-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are eff.edhc5.* (or sta., cm., kw.)', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm|rst)\.edhc5\./);
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

describe('edh-cast-5 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bless\b/, 'more'], [/\bonly\b/, 'also'], [/\bhalf\b/, 'twice'], [/\bdown\b/, 'up'], [/\bup\b/, 'down'], [/\bexile\b/, 'sacrifice'], [/\bexiled\b/, 'sacrificed'],
    [/\bpay 2 life\b/, 'pay 3 life'], [/\bpay\b/, 'gain'], [/\bannihilator\b/, 'bushido'], [/\bhand\b/, 'graveyard'], [/\blife\b/, 'cards'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-cast-5 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-cast-5 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-cast-5 design 6.10 (local index): synthetic examples', () => {
  it('no edh-cast-5 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-cast-5 parser, renderer and engine changes (one test each)', () => {
  const face = (text: string, type = 'Creature — Golem', name = 'Example Relic', extra: Record<string, unknown> = {}) => parseCard(card(name, type, text, type.startsWith('Creature') ? { power: '2', toughness: '2', ...extra } : extra), OPTS).faces[0]!;
  const sym = (cost: string) => parseManaCost(cost)!;
  it('rules/solver.ts (CR 118.1, 107.4f): a symbol of a color in `lifeFor` is also paid with 2 life; generic mana, other colors and an exhausted limit are not', () => {
    const symbols = sym('{1}{B}{B}');
    const lifeFor = new Map([['B' as const, Infinity]]);
    expect(colorsOfSymbol(symbols[1]!)).toEqual(['B']);
    expect(lifeColorOf(symbols[0]!, lifeFor)).toBeNull();
    expect(lifeColorOf(symbols[1]!, lifeFor)).toBe('B');
    expect(lifeColorOf(symbols[1]!, undefined)).toBeNull();
    expect(solve({ symbols: sym('{B}{B}'), providers: [], life: 4, lifeFor })?.lifeSymbols).toEqual([0, 1]);
    expect(solve({ symbols: sym('{B}{B}'), providers: [], life: 3, lifeFor })).toBeNull(); // CR 119.4
    expect(solve({ symbols: sym('{B}{B}'), providers: [], life: 4, lifeFor: new Map([['B' as const, 1]]) })).toBeNull(); // once per spell
    expect(solve({ symbols: sym('{2}'), providers: [], life: 20, lifeFor })).toBeNull();
    expect(solve({ symbols: sym('{R}'), providers: [], life: 20, lifeFor })).toBeNull();
  });
  it('model/cap-walk.ts (CR 118.1): the static permission is the capability permit:spendMana.lifeFor', () => {
    expect(ENGINE_CAPABILITIES.has('permit:spendMana.lifeFor')).toBe(true);
    const f = face("For each {B} in a cost, you may pay 2 life rather than pay that mana.");
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"lifeFor":{"color":"B"}');
    expect(fullyAutomated(face('For each {2} in a cost, you may pay 2 life rather than pay that mana.'))).toBe(false);
    expect(fullyAutomated(face('For each {B} in a cost, you may pay 2 life rather than pay that mana. Do this only once each turn.'))).toBe(false);
  });
  it('render/stat.ts (CR 118.8): the Defiler sentence names the same color in its symbol and its last sentence; a different color there is refused by the render gate', () => {
    const w = (sym: string, word: string): string => `As an additional cost to cast green permanent spells, you may pay 2 life. Those spells cost {${sym}} less to cast if you paid life this way. This effect reduces only the amount of ${word} mana you pay.`;
    expect(fullyAutomated(face(w('G', 'green')))).toBe(true);
    expect(fullyAutomated(face(w('G', 'blue')))).toBe(false);
    expect(fullyAutomated(face(w('1', 'green')))).toBe(false);
  });
  it('actions/cast-costs.ts#countCap (CR 118.8, 601.2b): the number announced for "exile any number of ... from your hand" is limited by the hand, not by the battlefield', () => {
    const f = face('As an additional cost to cast this spell, you may exile any number of blue cards from your hand. This spell costs {2} less to cast for each card exiled this way.', 'Sorcery');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"announceCount":true');
    expect(JSON.stringify(f.abilities)).toContain('"zone":"hand"');
  });
  it('render/qty.ts, render/state.ts (CR 601.2f): a cost reduction per card exiled says "card exiled this way", and the sacrifice cost keeps "permanent sacrificed this way"', () => {
    expect(fullyAutomated(face('As an additional cost to cast this spell, you may sacrifice any number of artifacts. This spell costs {1} less to cast for each permanent sacrificed this way.', 'Sorcery'))).toBe(true);
    expect(fullyAutomated(face('As an additional cost to cast this spell, you may exile any number of blue cards from your hand. This spell costs {2} less to cast for each permanent sacrificed this way.', 'Sorcery'))).toBe(false);
    expect(fullyAutomated(face('As an additional cost to cast this spell, you may exile any number of blue cards from your hand. This spell costs {2} less to cast for each card exiled this way.', 'Sorcery'))).toBe(true);
  });
  it('render/fold-edhcast5.ts (CR 107.1a, 119.1, 121.1): "gain half X life and draw half X cards. Round down each time" is two halved, rounded down steps by you; a rounding up or a different amount is not that reading', () => {
    const t = (text: string) => parseCard(card('Example Plan', 'Sorcery', text, { mana_cost: '{X}{G}' }), OPTS).faces[0]!;
    expect(fullyAutomated(t('You gain half X life and draw half X cards. Round down each time.'))).toBe(true);
    expect(fullyAutomated(t('You gain half X life and draw half X cards. Round up each time.'))).toBe(false);
    expect(fullyAutomated(t('You gain half X life and draw X cards. Round down each time.'))).toBe(false);
  });
  it('render/fold-edhcast5.ts (CR 107.1a, 701.13a): "exiles the top half of their library, rounded up" says the player\'s own library; the opponent\'s and the rounding down are other sentences', () => {
    expect(fullyAutomated(face('Target opponent exiles the top half of their library, rounded up.', 'Sorcery'))).toBe(true);
    expect(fullyAutomated(face('Target opponent exiles the top half of their library, rounded down.', 'Sorcery'))).toBe(false);
  });
  it('render/kw.ts (CR 702.86a, 107.3): "has annihilator X, where X is the number of <kind> counters on it" is the keyword with the counters on the object as its amount; another object or a number is not', () => {
    const f = face('This creature has annihilator X, where X is the number of +1/+1 counters on it.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"keyword":"annihilator"');
    expect(JSON.stringify(f.abilities)).toContain('"q":"counters"');
    expect(fullyAutomated(face('This creature has annihilator 2, where X is the number of +1/+1 counters on it.'))).toBe(false);
  });
  it('render/program.ts (CR 107.3, 601.2c, 608.2b; family target-mana-value-where-x): a target\'s mana value limit by a count is also said "mana value X or less, where X is ..."', () => {
    expect(fullyAutomated(face('When this creature enters, counter target spell with mana value X or less, where X is the number of Faeries you control.', 'Creature — Faerie'))).toBe(true);
    expect(fullyAutomated(face('Destroy target creature with mana value X or less, where X is the number of Faeries you control.', 'Sorcery'))).toBe(true);
    expect(fullyAutomated(face('Destroy target creature with mana value X or less, where Y is the number of Faeries you control.', 'Sorcery'))).toBe(false);
  });
});
