/**
 * Must-finish round edh-next-141 (mana and costs, EDHREC ranks 5,001-10,000): the template data of parser/templates/zz-cloud/edh-next-141.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-next-141-scenarios.test.ts.
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
import edhNext141 from '../../../src/parser/templates/zz-cloud/edh-next-141.json';
import review from '../../m5/golden/cards/edh-next-141-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext141 as Template[];
const MECH_COUNT = 7;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the card of the EDHREC top 10,000 that prints the wording and is full (each wording is printed on that one card)
  'cm.edhn141.spells.more.opp.manaValue': ["Reidane, God of the Worthy // Valkmira, Protector's Shield"],
  'rep.edhn141.prevent.oppSource.youOr': ["Reidane, God of the Worthy // Valkmira, Protector's Shield"],
  'sta.edhn141.manaBurn': ['Yurlok of Scorch Thrash'],
  'eff.edhn141.gains.allActivatedOf.dur': ['Grell Philosopher'],
  'rid.edhn141.spendColorAsAny.thoseAbilities': ['Grell Philosopher'],
  'sta.edhn141.duringYourTurn.spells.fromHand.mvXOrLess.cascade': ['Abaddon the Despoiler'],
  'sta.edhn141.triggerMod.turnedFaceUp': ['Panoptic Projektor'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  /^[+\u2212-]\d+:/.test(text) || /loyalty counter/.test(text) ? card('Example Sage', 'Legendary Planeswalker — Example', text, { loyalty: '4' }) :
  /enchanted (creature|land|artifact|permanent|enchantment)/.test(text) ? card(
    'Example Boon', 'Enchantment — Aura', text) :
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-141 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-141.json, path order: after edh-next-14, before edh-next-15) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-141.json');
    expect(files.indexOf('zz-cloud/edh-next-141.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-14.json'));
    expect(files.indexOf('zz-cloud/edh-next-141.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-15.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhn141.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|dl)\.edhn141\./);
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

describe('edh-next-141 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bmore\b/, 'less'], [/\bor greater\b/, 'or less'], [/\bopponents\b/, 'allies'], [/\bprevent 2\b/, 'prevent all'], [/\bto lose\b/, 'to gain'], [/\bactivated abilities\b/, 'static abilities'],
    [/\bany color\b/, 'any type'], [/\bcascade\b/, 'convoke'], [/\bX or less\b/, 'X or greater'], [/\bface up\b/, 'face down'], [/\ban additional time\b/, 'two additional times'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-141 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-141 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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
    }, 120_000); // like the other rounds' G2 guards: one parse per word of each example
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-next-141 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-141 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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




describe('edh-next-141 parser, renderer and engine changes (one test each)', () => {
  const spell = (text: string, type = 'Sorcery') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  const legend = (text: string, type = 'Legendary Creature — Human Soldier') => parseCard(card('Example Captain', type, text, { power: '3', toughness: '3' }), OPTS).faces[0]!;
  const relic = (text: string) => parseCard(card('Example Relic', 'Legendary Artifact', text), OPTS).faces[0]!;
  it('parser/holes/event.ts + render/evt.ts (CR 115.1, 603.2): "you or another permanent you control becomes the target of ..." (the object event excludes the source)', () => {
    const f = relic('Whenever you or another permanent you control becomes the target of a spell or ability an opponent controls, counter that spell or ability unless its controller pays {1}.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"other":true');
  });
  it('parser/lower/riders.ts + render/steps-flow.ts (CR 614.15, 608.2d): an "instead" grant after "gains your choice of K1 or K2" replaces the choice and both grants; another object or duration is refused', () => {
    const t = 'At the beginning of combat on your turn, target creature gains your choice of flying or vigilance until end of turn.';
    expect(fullyAutomated(legend(`${t} If that creature is equipped, it gains flying and vigilance until end of turn instead.`))).toBe(true);
    expect(fullyAutomated(legend(`${t} If that creature is equipped, it gains flying and vigilance until your next turn instead.`))).toBe(false);
    expect(fullyAutomated(legend(`${t} If that creature is equipped, ~ gains flying and vigilance until end of turn instead.`))).toBe(false);
  });
  it('parser/front/labels.ts + selfref.ts (CR 207.2d): "Throw ..." and "... Catch" are flavor words; "... Throw ..." and an ellipsis inside rules text are not', () => {
    const f = legend('Throw ... — {3}: Example Captain deals 2 damage to any target.\n... Catch — At the beginning of combat on your turn, you gain 1 life.');
    expect(fullyAutomated(f)).toBe(true);
    expect(fullyAutomated(legend('... Throw ... — {3}: Example Captain deals 2 damage to any target.'))).toBe(false);
  });
  it('parser/holes/cost.ts + lower/ability.ts + effects/refs.ts (CR 701.3d, 601.2b): "Unattach an Equipment from ~" names "that Equipment"; the reference needs that cost (model/lint-card.ts)', () => {
    const f = legend('{2}, Unattach an Equipment from Example Captain: You gain life equal to that Equipment\'s mana value.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"ref":"costUnattached"');
    expect(fullyAutomated(legend('{2}: You gain life equal to that Equipment\'s mana value.'))).toBe(false);
  });
  it('parser/holes/qty.ts + render/qty.ts (CR 119.3): "the total amount of life your opponents have lost this turn"', () => {
    expect(fullyAutomated(spell('You gain life equal to the total amount of life your opponents have lost this turn.'))).toBe(true);
  });
  it('effects/handlers/next-spell.ts + model/cap-walk.ts (CR 708.4): a next-spell filter "face-down" (true only) is read', () => {
    expect(fullyAutomated(relic('{T}: The next face-down creature spell you cast this turn costs {2} less to cast.'))).toBe(true);
  });
});
