/**
 * Commander lane edh-perms, round edh-perms-18: the template data of parser/templates/zz-cloud/edh-perms-18.json ("you may put a A card or a B card from your hand onto the
 * battlefield", "whenever you sacrifice another F during your turn") and the round's parser, lowering and renderer changes, tested at the end of this file and in
 * edh-perms-18-scenarios.test.ts.
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
import edhPm18 from '../../../src/parser/templates/zz-cloud/edh-perms-18.json';
import review from '../../m5/golden/cards/edh-perms-18-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhPm18 as Template[];
const MECH_COUNT = 2;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full
  'eff.edhpm18.put.eitherKind.fromHand.battlefield': ['Purphoros, Bronze-Blooded'],
  'trg.edhpm18.you.sacrifice.duringYourTurn': ['Szarel, Genesis Shepherd'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a trigger on an enchantment, an activated ability on an artifact creature. */
const parsedWith = (_t: Template, text: string) => {
  if (/^(At the beginning|Whenever)/.test(text)) return parseCard(card('Example Relic', 'Enchantment', text), OPTS).faces[0]!;
  return parseCard(card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
};

describe('edh-perms-18 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-perms-18.json, path order: after edh-perms-15, before edh-perms-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-perms-18.json');
    expect(files.indexOf('zz-cloud/edh-perms-18.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-perms-15.json'));
    expect(files.indexOf('zz-cloud/edh-perms-18.json')).toBeLessThan(files.indexOf('zz-cloud/edh-perms-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are trg.edhpm18.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|trg)\.edhpm18\./);
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

describe('edh-perms-18 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/during your turn/, 'during any turn'], [/or an?/, 'and an'], [/from your hand/, 'from your graveyard'], [/another/, 'two'], [/onto the battlefield/, 'into your hand'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-perms-18 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-perms-18 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
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

describe.skipIf(index === null)('edh-perms-18 design 6.10 (local index): synthetic examples', () => {
  it('no edh-perms-18 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-perms-18 parser, lowering and renderer changes (one test each)', () => {
  const spell = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
  const creature = (text: string, type = 'Artifact Creature — Construct') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  const walker = (text: string) => parseCard(card('Example Binder', 'Legendary Planeswalker — Test', text, { loyalty: '5' }), OPTS).faces[0]!;
  it('parser/lower/anaphora.ts (CR 707.2, 608.2h, 400.7): a token copy of "the sacrificed creature" is read; any other action on it stays manual', () => {
    const ok = creature('{3}, {T}, Sacrifice another Zombie: Create two tokens that are copies of the sacrificed creature.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"ref":"costSacrificed"');
    expect(fullyAutomated(creature('{3}, Sacrifice another Zombie: Return the sacrificed creature to the battlefield.'))).toBe(false);
    expect(fullyAutomated(creature('{3}, Sacrifice another Zombie: Create a token that\'s a copy of target creature.'))).toBe(true);
  });
  it('parser/holes/cost.ts + render/costs.ts (CR 701.21a, 118.3): "Sacrifice ~ and N <description>" is two sacrifice parts; "other" in the second part and "any number" are not read', () => {
    const ok = creature('{B}, {T}, Sacrifice this creature and three Clue tokens: Draw a card.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"count":3');
    const costManual = (text: string): boolean => JSON.stringify(creature(text).abilities).includes('"kind":"manual"'); // a cost part the model cannot state is a manual part
    expect(costManual('{B}, {T}, Sacrifice this creature and two other artifacts: Draw a card.')).toBe(true);
    expect(costManual('{B}, {T}, Sacrifice this creature and any number of Clue tokens: Draw a card.')).toBe(true);
    expect(costManual('{B}, {T}, Sacrifice three Clue tokens and this creature: Draw a card.')).toBe(true);
    expect(costManual('{B}, {T}, Sacrifice this creature and three Clue tokens: Draw a card.')).toBe(false);
  });
  it('render/fold.ts (CR 608.2d, 110.2a): a choice among two descriptions of cards in your hand is said "a A card or a B card from your hand"; a different zone is another sentence', () => {
    expect(fullyAutomated(spell('You may put a red creature card or an artifact creature card from your hand onto the battlefield.'))).toBe(true);
    expect(fullyAutomated(spell('You may put a red creature card or an artifact creature card from your graveyard onto the battlefield.'))).toBe(false);
  });
  it('parser/holes/object.ts + render/steps-zones.ts (CR 608.2c, 608.2h): "the creature exiled this way" names the target an exile just moved; after another instruction it is not read', () => {
    const ok = spell('Exile target creature. You gain life equal to the power of the creature exiled this way.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(fullyAutomated(spell('Destroy target creature. You gain life equal to the power of the creature exiled this way.'))).toBe(false);
    expect(fullyAutomated(spell('You gain life equal to the power of the creature exiled this way.'))).toBe(false);
    // review: an exile that may not have happened (may, if, unless) is not "exiled this way"
    expect(fullyAutomated(spell('You may exile target creature. You gain life equal to the power of the creature exiled this way.'))).toBe(false);
    expect(fullyAutomated(spell("Tap target creature. If it's an artifact, exile it. You gain life equal to the power of the creature exiled this way."))).toBe(false);
    expect(fullyAutomated(spell('Exile target creature unless its controller pays {3}. You gain life equal to the power of the creature exiled this way.'))).toBe(false);
  });
  it('render/fold.ts (CR 107.3, 608.2h): "put X counters on a <chosen object>, where X is ..." is the same step as "put a number of counters equal to ... on a <chosen object>"', () => {
    const ok = spell('Put X +1/+1 counters on a creature you control, where X is the number of lands you control.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(fullyAutomated(spell('Put X +1/+1 counters on a creature you control, where X is the number of lands you control and then draw a card.'))).toBe(false);
  });
  it('parser/holes/filter.ts (CR 109.2, 608.2c): "other than that creature or ~" excludes both the object named before and the source; a different second object is not read', () => {
    const ok = walker('−2: Gain control of target creature. Put a lifelink counter on it if you control a white permanent other than that creature or ~.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"self":true');
    expect(fullyAutomated(walker('−2: Gain control of target creature. Put a lifelink counter on it if you control a white permanent other than that creature or target land.'))).toBe(false);
  });
  it('parser/holes/cond.ts (CR 122.6, 603.4): "a counter was put on ~ this turn" is a history of the turn, of any player\'s counter; "last turn" and another object are not read', () => {
    const ok = creature('At the beginning of your end step, if a counter was put on ~ this turn, draw a card.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"scope":"turn"');
    expect(fullyAutomated(creature('At the beginning of your end step, if a counter was put on ~ last turn, draw a card.'))).toBe(false);
    expect(fullyAutomated(creature('At the beginning of your end step, if a counter was put on target creature this turn, draw a card.'))).toBe(false);
  });
});
