/**
 * Lane std-cardcopy, round std-cardcopy-1: the template data of parser/templates/zz-cloud/std-cardcopy-1.json ("for as long as ~ remains attached to it, that
 * creature becomes a copy of a creature card exiled with ~", "repeat this process" with no count), the parser, lowering and renderer changes of the round (the
 * `share` condition of cards milled this way, "instant, sorcery, and/or Tamiyo planeswalker cards", "<Name> planeswalker card"), and the promotion of r4-copy's
 * "Copy them." / "You may cast any number of the copies." with The Tale of Tamiyo.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-cardcopy-1-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/std-cardcopy-1.json';
import r4copy from '../../../src/parser/templates/zz-cloud/r4-copy.json';
import review from '../../m5/golden/cards/cloud-std-cardcopy-1-review.json';
import r4review from '../../m5/golden/cards/cloud-r4-copy-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const MECH_COUNT = 2;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one card only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'eff.stdcardcopy1.dur.becomeCopy.linkedCard': 'Assimilation Aegis',
};
/** r4-copy's templates this round promoted, with the golden card that is their evidence (in r4-copy's review file, which r4-copy's own test reads). */
const PROMOTED: Readonly<Record<string, string>> = {
  'eff.r4copy.copy.group': 'The Tale of Tamiyo',
  'rid.r4copy.mayCastAnyNumberOfCopies': 'The Tale of Tamiyo',
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (a sorcery); the others are abilities of an Equipment. */
const SPELL = new Set(['eff.stdcardcopy1.repeatProcess.again']);
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Plan', 'Sorcery', text), OPTS) : parseCard(card('Example Relic', 'Artifact — Equipment', text), OPTS)).faces[0]!;
const golden = [...(review as { card: string; verified: string; expect?: string }[]), ...(r4review as { card: string; verified: string; expect?: string }[])];
const evidence = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`)).map((g) => g.card);

describe('std-cardcopy-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-cardcopy-1.json, after std-blb, before std-dft) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-cardcopy-1.json');
    expect(files.indexOf('zz-cloud/std-cardcopy-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-blb.json'));
    expect(files.indexOf('zz-cloud/std-cardcopy-1.json')).toBeLessThan(files.indexOf('zz-cloud/std-dft.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdcardcopy1.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.stdcardcopy1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = evidence(t.id);
      if (NARROW[t.id] !== undefined) expect(cards, t.id).toContain(NARROW[t.id]);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review as { card: string; expect?: string }[]) expect(g.expect, g.card).toBe('full');
  });
  it('design 6.9: r4-copy\'s "Copy them." and "You may cast any number of the copies." are stable, with The Tale of Tamiyo verified as their golden card', () => {
    for (const [id, c] of Object.entries(PROMOTED)) {
      expect((r4copy as Template[]).find((t) => t.id === id)?.status, id).toBe('stable');
      expect(evidence(id), id).toContain(c);
    }
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

describe('std-cardcopy-1 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
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
    [/\bremains attached\b/, 'remains tapped'], [/\bcreature card exiled\b/, 'land card exiled'], [/\bexiled with ~\./, 'exiled with target creature.'],
    [/\bshare a card type\b/, 'share a color'], [/\bshare a color\b/, 'share a card type'], [/\btwo cards that share\b/, 'three cards that share'],
    [/\brepeat this process\./, 'repeat this process once.'], [/\bwere milled\b/, 'were exiled'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-cardcopy-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('std-cardcopy-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

const sorcery = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
const stepsOf = (text: string): unknown => (sorcery(text).abilities[0] as unknown as { effect: { steps: unknown } }).effect.steps;

describe('std-cardcopy-1 parser: "two cards that share a card type / a color were milled this way" (CR 205.2a, 105.2, 608.2c; parser/holes/cond.ts)', () => {
  it('reads the `share` condition over the cards the mill step bound, with the description of the cards ("nonland")', () => {
    const f = sorcery('Mill two cards. If two nonland cards that share a color were milled this way, draw a card.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(stepsOf('Mill two cards. If two nonland cards that share a color were milled this way, draw a card.'))).toContain('"cond":{"cond":"share","what":"color","of":{"ref":"each","filter":{"notTypes":["Land"],"isCard":true,"is":{"ref":"bound","name":"them"},"zone":"any"}},"count":2}');
    expect(JSON.stringify(stepsOf('Mill two cards. If two cards that share a card type were milled this way, draw a card.'))).toContain('"what":"cardType"');
  });
  it('has no reading without a mill before it, with another count, or with another verb', () => {
    for (const text of [
      'Discard two cards. If two cards that share a card type were milled this way, draw a card.',
      'Mill three cards. If three cards that share a card type were milled this way, draw a card.',
      'Mill two cards. If two cards that share a card type were exiled this way, draw a card.',
      'Mill two cards. If two cards that share a creature type were milled this way, draw a card.',
    ]) expect(fullyAutomated(sorcery(text)), text).toBe(false);
  });
});

describe('std-cardcopy-1 lowering: "repeat this process" with no count (CR 608.2c; parser/lower/repeat-process.ts)', () => {
  it('copies the whole effect, the condition\'s sentence included, into the repeat, whose own copy holds the empty marker', () => {
    const steps = stepsOf('Mill two cards. If two cards that share a card type were milled this way, draw a card and repeat this process.') as { op: string; then?: { op: string; do?: unknown[] }[] }[];
    const rep = steps[1]!.then![1]!;
    expect(rep).toMatchObject({ op: 'repeat', process: true, again: true });
    expect(JSON.stringify(rep.do)).toBe(JSON.stringify([steps[0], { ...steps[1], then: [steps[1]!.then![0], { op: 'repeat', times: 1, do: [], process: true, again: true }] }]));
  });
  it('is manual with no condition, with a sentence after it, with nothing before it, or not as the last instruction of its condition', () => {
    for (const text of [
      'Mill two cards. Repeat this process.',
      'Mill two cards. If two cards that share a card type were milled this way, draw a card and repeat this process. Draw a card.',
      'If you control a creature, draw a card and repeat this process.',
      'Mill two cards. If two cards that share a card type were milled this way, repeat this process and draw a card.',
    ]) expect(fullyAutomated(sorcery(text)), text).toBe(false);
  });
});

describe('std-cardcopy-1 parser and renderer: "instant, sorcery, and/or Tamiyo planeswalker cards" (CR 205.2a, 205.3j; parser/holes/filter.ts, render/np.ts)', () => {
  const targetOf = (text: string): unknown => (sorcery(text).abilities[0] as unknown as { effect: { targets: { filter: unknown }[] } }).effect.targets[0]!.filter;
  it('reads the lead card types or the subtype of the permanent type, and renders the type word back (family planeswalker-type)', () => {
    const text = 'Return any number of target instant, sorcery, and/or Gideon planeswalker cards from your graveyard to your hand.';
    const f = sorcery(text);
    expect(fullyAutomated(f), JSON.stringify(f.gate)).toBe(true);
    expect(targetOf(text)).toMatchObject({ anyOf: [{ types: ['Instant', 'Sorcery'] }, { types: ['Planeswalker'], subtypes: ['Gideon'] }] });
    for (const t of ['Exile target Gideon planeswalker card from your graveyard.', 'Exile up to two target Gideon planeswalker cards from your graveyard.']) expect(fullyAutomated(sorcery(t)), t).toBe(true);
  });
  it('has no reading when a lead type could be the last type too ("artifact or Gideon planeswalker cards" stays as before), or with two subtypes last', () => {
    expect(JSON.stringify(targetOf('Exile any number of target instant and/or Gideon planeswalker cards from your graveyard.'))).toContain('"Gideon"');
    for (const t of ['Exile any number of target artifact and/or Gideon planeswalker cards from your graveyard.', 'Exile any number of target instant and/or Elf Warrior creature cards from your graveyard.']) {
      const f = sorcery(t);
      expect(fullyAutomated(f) && JSON.stringify(f.abilities).includes('"anyOf":[{"types":["Artifact"]}'), t).toBe(false);
    }
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-cardcopy-1 design 6.10 (local index): synthetic examples', () => {
  it('no std-cardcopy-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

/** The local index entry type the 6.10 check reads (OracleCard with its faces). */
export type IndexCard = OracleCard;
