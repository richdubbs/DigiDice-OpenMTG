/**
 * Lane std-cardcopy, round std-cardcopy-3: the template data of parser/templates/zz-cloud/std-cardcopy-3.json ("As ~ enters, exile up to X creature cards from your
 * graveyard. It enters with three +1/+1 counters on it for each creature card exiled this way.", "~ becomes a copy of target creature card exiled with it, except
 * it's 0/0 and has this ability."), and the parser, linking and renderer changes of the round (the enters body `exileCards`, "target creature card exiled with
 * it", the copy exception "it's P/T and has this ability").
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-cardcopy-3-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/std-cardcopy-3.json';
import review from '../../m5/golden/cards/cloud-std-cardcopy-3-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const MECH_COUNT = 2;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one card only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'rep.stdcardcopy3.enters.exileUpTo.countersForEach': 'Mimeoplasm, Revered One',
  'eff.stdcardcopy3.becomeCopy.exceptBasePT.thisAbility': 'Mimeoplasm, Revered One',
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** The examples are abilities of a creature (a static "as ~ enters" ability, an activated ability). */
const parsedWith = (_t: Template, text: string) => parseCard(card('Example Ooze', 'Creature — Ooze', text, { power: '0', toughness: '0' }), OPTS).faces[0]!;
const golden = review as { card: string; verified: string; expect?: string }[];
const evidence = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`)).map((g) => g.card);

describe('std-cardcopy-3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-cardcopy-3.json, after std-blb, before std-dft) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-cardcopy-3.json');
    expect(files.indexOf('zz-cloud/std-cardcopy-3.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-blb.json'));
    expect(files.indexOf('zz-cloud/std-cardcopy-3.json')).toBeLessThan(files.indexOf('zz-cloud/std-dft.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are (eff|rep).stdcardcopy3.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|rep)\.stdcardcopy3\./);
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
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-cardcopy-3 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bup to\b/, 'at least'], [/\bfrom your graveyard\b/, 'from a graveyard'], [/\bexiled this way\b/, 'destroyed this way'], [/\bfor each\b/, 'for the first'],
    [/\band has this ability\b/, 'and has flying'], [/\bexcept it's\b/, "except it isn't"], [/\byou control\b/, 'an opponent controls'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-cardcopy-3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('std-cardcopy-3 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

const creature = (text: string) => parseCard(card('Example Ooze', 'Creature — Ooze', text, { power: '0', toughness: '0' }), OPTS).faces[0]!;
const ENTERS = 'As ~ enters, exile up to two creature cards from your graveyard. It enters with a +1/+1 counter on it for each creature card exiled this way.';

describe('std-cardcopy-3 linking (CR 607.2a; parser/parse.ts#linkExiled, model/lint-card.ts): the exile as it enters is the producer of "exiled with it"', () => {
  it('the enters body records its cards under the link "exiled", and the activated ability\'s target reads them', () => {
    const f = creature(`${ENTERS}\n{3}: ~ becomes a copy of target creature card exiled with it, except it's 1/1 and has this ability.`);
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities[0])).toContain('"exileCards":{"filter":{"types":["Creature"],"zone":"graveyard","owner":"you","isCard":true},"max":2,"counters":{"kind":"+1/+1","per":1},"link":"exiled"}');
    expect(JSON.stringify(f.abilities[1])).toContain('"filter":{"types":["Creature"],"zone":"exile","is":{"ref":"linked","link":"exiled"},"isCard":true}');
  });
  it('"target creature card exiled with it" with no instruction of the face that exiles reads nothing: manual (CR 607.1)', () => {
    expect(fullyAutomated(creature("{3}: ~ becomes a copy of target creature card exiled with it, except it's 1/1 and has this ability."))).toBe(false);
  });
});

describe('std-cardcopy-3 renderer (CR 707.9a-b; render/copy-except.ts): "except it\'s P/T and has this ability" is said with one subject', () => {
  it('passes the gate, and another P/T does not give its JSON', () => {
    const a = creature(`${ENTERS}\n{3}: ~ becomes a copy of target creature card exiled with it, except it's 1/1 and has this ability.`);
    expect(a.gate.every((g) => g.ok)).toBe(true);
    const b = creature(`${ENTERS}\n{3}: ~ becomes a copy of target creature card exiled with it, except it's 2/2 and has this ability.`);
    expect(jsonKey(b.abilities) === jsonKey(a.abilities)).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-cardcopy-3 design 6.10 (local index): synthetic examples', () => {
  it('no std-cardcopy-3 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
