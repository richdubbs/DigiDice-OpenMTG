/**
 * Commander lane edh-mana-keywords, round edh-mana-keywords-9: the template data of parser/templates/zz-cloud/edh-mana-keywords-9.json ("Whenever a land with the same name as the exiled
 * card is tapped for mana" (Extraplanar Lens) and "Choose any target, then choose another target for each time ~ was kicked" (Comet Storm)), and the parser, renderer and engine
 * changes of the round (one test each at the end). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every
 * counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated
 * card (G2). Examples are synthetic wordings (design 6.10). The behavior is in edh-mana-keywords-9-scenarios.test.ts. CR cites checked against the Comprehensive Rules 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhMk9 from '../../../src/parser/templates/zz-cloud/edh-mana-keywords-9.json';
import review from '../../m5/golden/cards/edh-mana-keywords-9-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhMk9 as Template[];
const MECH_COUNT = 2;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards that print each wording and are full (Extraplanar Lens is held-out, opened by the owner, commander request 2026-10-27; Comet Storm is of the tuning half)
  'trg.edhmk9.landSameNameExiled.tappedForMana': ['Extraplanar Lens'],
  'eff.edhmk9.choose.anyTarget.thenAnotherPerKick': ['Comet Storm'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (an instant); the others are abilities of a creature (static, activated, triggered; "~ gains" needs a creature). */
const SPELL = new Set<string>(['eff.edhmk9.choose.anyTarget.thenAnotherPerKick']);
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Plan', 'Instant', text), OPTS) : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-mana-keywords-9 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-mana-keywords-9.json, path order: after edh-mana-keywords-7, before look3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-mana-keywords-9.json');
    expect(files.indexOf('zz-cloud/edh-mana-keywords-9.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-mana-keywords-7.json'));
    expect(files.indexOf('zz-cloud/edh-mana-keywords-9.json')).toBeLessThan(files.indexOf('zz-cloud/look3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are trg./rid./eff.edhmk9.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm|trg)\.edhmk9\./);
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

describe('edh-mana-keywords-9 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bsame name as\b/, 'same mana value as'], [/\bis tapped for mana\b/, 'enters'], [/\bthe exiled card\b/, 'a land you control'], [/\bwas kicked\b/, 'was cast'], [/\banother target\b/, 'the same target'],
    [/\bany target\b/, 'target creature'], [/\bfor each time\b/, 'once'], [/\beach of them\b/, 'one of them'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-mana-keywords-9 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-mana-keywords-9 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-mana-keywords-9 design 6.10 (local index): synthetic examples', () => {
  it('no edh-mana-keywords-9 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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



describe('edh-mana-keywords-9 parser, renderer and engine changes (one test each)', () => {
  const face = (text: string, type = 'Artifact', cost = '{0}') => parseCard(card('Example Relic', type, text, { mana_cost: cost }), OPTS).faces[0]!;
  const LENS = 'When ~ enters, you may exile target land you control.\n';
  it('parser/lower/ability.ts (CR 603.2h, 603.4, 106.4; Carpet of Flowers): "if you haven\'t added mana with this ability this turn" is a once-each-turn limit on taking the option, only on "you may add ... mana"', () => {
    const base = "At the beginning of each of your main phases, if you haven't added mana with this ability this turn, you may add X mana of any one color, where X is the number of Islands target opponent controls.";
    const f = face(base, 'Enchantment');
    expect(fullyAutomated(f)).toBe(true);
    const def = f.abilities[0] as unknown as { limit?: unknown; interveningIf?: unknown };
    expect(def.limit).toEqual({ per: 'turn', max: 1, action: true });
    expect(def.interveningIf).toBeUndefined();
    // the option must be the adding of mana: another effect, no option, or a second instruction keeps the clause out of the model
    expect(fullyAutomated(face("At the beginning of each of your main phases, if you haven't added mana with this ability this turn, you may draw a card.", 'Enchantment'))).toBe(false);
    expect(fullyAutomated(face("At the beginning of each of your main phases, if you haven't added mana with this ability this turn, add {G}.", 'Enchantment'))).toBe(false);
    expect(fullyAutomated(face("At the beginning of each of your main phases, if you haven't added mana with this ability this turn, you may add {G}. You gain 1 life.", 'Enchantment'))).toBe(false);
    expect(fullyAutomated(face("At the beginning of each of your main phases, if you haven't added mana with this ability this turn, you may add {G}. Do this only once each turn.", 'Enchantment'))).toBe(false);
    // a different clause is not this one
    expect(fullyAutomated(face("At the beginning of each of your main phases, if you've added mana with this ability this turn, you may add {G}.", 'Enchantment'))).toBe(false);
  });
  it('render/steps-cards.ts (CR 107.3, 115.1): "X mana of any one color, where X is ..." names a target of the amount as its first mention', () => {
    expect(fullyAutomated(face('At the beginning of your upkeep, add X mana of any one color, where X is the number of cards in target opponent\'s graveyard.', 'Enchantment'))).toBe(true);
    expect(fullyAutomated(face('At the beginning of your upkeep, add X mana of any one color, where X is the number of creatures you control.', 'Enchantment'))).toBe(true);
  });
  it('render/np.ts (CR 607.2a; the parser\'s rule that a filter\'s own reference names nothing): the card a trigger compares names with is no antecedent of "its"', () => {
    expect(fullyAutomated(face(`${LENS}Whenever a land with the same name as the exiled card is tapped for mana, its controller adds one mana of any type that land produced.`))).toBe(true);
    expect(fullyAutomated(face(`${LENS}Whenever a land with the same name as the exiled card is tapped for mana, its controller gains 1 life.`))).toBe(true);
    // the exiled card of a trigger with no exiling ability on the face is unlinked
    expect(fullyAutomated(face('Whenever a land with the same name as the exiled card is tapped for mana, its controller gains 1 life.'))).toBe(false);
  });
  it('parser/lower/ability.ts, model/lint-nodes.ts, model/cap-walk.ts (CR 605.1a, 605.3b, 706.2; Vexing Puzzlebox): a mana ability may also roll one die (no table, by its controller); other rolls beside mana are not read', () => {
    expect(fullyAutomated(face('{T}: Add one mana of any color. Roll a d20.'))).toBe(true);
    expect(fullyAutomated(face('{T}: Add {C}. Roll a d6.'))).toBe(true);
    expect(fullyAutomated(face('{T}: Add {C}. Each opponent rolls a d6.'))).toBe(false);
    expect(fullyAutomated(face('{T}: Add {C}. Roll a d6.\n1—3 | You gain 1 life.\n4—6 | You gain 2 life.'))).toBe(false);
  });
  it('model/cap-walk.ts (CR 706.2, 603.2c; Vexing Puzzlebox ruling 2022-06-10): "whenever you roll one or more dice, ... equal to the result" is read (the result of one roll is the total of its dice)', () => {
    expect(fullyAutomated(face('Whenever you roll one or more dice, put a number of charge counters on this artifact equal to the result.'))).toBe(true);
    expect(fullyAutomated(face('Whenever you roll one or more dice, put a number of charge counters on this artifact equal to the number of dice you rolled.'))).toBe(false);
  });
  it('parser/lower/mentions.ts#announcedGroup, render/program.ts#chosenKicked (CR 115.1, 115.3, 601.2c, 702.33c; Comet Storm): "each of them" names the any target and the others chosen for each kick, only for the damage of the spell', () => {
    const text = 'Multikicker {1}\nChoose any target, then choose another target for each time ~ was kicked. ~ deals X damage to each of them.';
    expect(fullyAutomated(face(text, 'Instant', '{X}{R}'))).toBe(true);
    expect(fullyAutomated(face(text.replace('deals X damage', 'deals X damage and you gain 1 life'), 'Instant', '{X}{R}'))).toBe(false);
    expect(fullyAutomated(face(text.replace('each of them', 'it'), 'Instant', '{X}{R}'))).toBe(false);
    expect(fullyAutomated(face(text.replace('Multikicker {1}', 'Kicker {1}').replace('each time ~ was kicked', 'each time ~ was cast'), 'Instant', '{X}{R}'))).toBe(false);
  });
});
