/**
 * Lane p2-copy-perm, round p2-copy-perm-1: the template data of parser/templates/zz-cloud/p2-copy-perm-1.json (a permanent entering as a copy, token copies, a
 * permanent becoming a copy, each "except <exceptions>"), the copy-exception list holes of parser/holes/p2copyperm1.ts (`CopyExcept`, `CopyExceptToken`,
 * `CopyExceptTokens`), the clause-list renderer of render/copy-except.ts and the walker's "this ability" inside a reflexive trigger (model/cap-walk.ts).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in p2-copy-perm-1-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { adaptTokens, runHole } from '../../../src/parser/holes';
import { tokenize } from '../../../src/parser/tokenize';
import round from '../../../src/parser/templates/zz-cloud/p2-copy-perm-1.json';
import review from '../../m5/golden/cards/p2-copy-perm-1-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const MECH_COUNT = 6;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A one-shot effect is a sorcery's; an ability ("When ~ enters, ...", "You may have ~ enter as ...") is a creature's. */
const parse = (text: string) => (/^(Create|Each|Target|Choose)\b/.test(text)
  ? parseCard(card('Example Spell', 'Sorcery', text), OPTS)
  : parseCard(card('Example Ooze', 'Creature — Ooze', text, { power: '0', toughness: '0' }), OPTS)).faces[0]!;
const golden = review as { card: string; verified: string; expect?: string }[];
const evidence = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`)).map((g) => g.card);

describe('p2-copy-perm-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-copy-perm-1.json, after look3, before r3-choose) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-copy-perm-1.json');
    expect(files.indexOf('zz-cloud/p2-copy-perm-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/look3.json'));
    expect(files.indexOf('zz-cloud/p2-copy-perm-1.json')).toBeLessThan(files.indexOf('zz-cloud/r3-choose.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are (eff|rep).p2copyperm1.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|rep)\.p2copyperm1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has three or more hand-verified golden cards; the others stay experimental (no deviation)', () => {
    for (const t of MECH.filter((x) => x.status === 'stable')) expect(evidence(t.id).length, t.id).toBeGreaterThanOrEqual(3);
    expect(MECH.filter((x) => x.status === 'experimental').map((t) => t.id).sort()).toEqual([
      'eff.p2copyperm1.becomeCopy.except', 'eff.p2copyperm1.copyToken.except', 'eff.p2copyperm1.eachOther.becomeCopy.dur.except',
    ]);
    for (const g of golden) expect(g.expect, g.card).toBe('full');
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

describe('p2-copy-perm-1 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parse(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parse(e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parse(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\bisn't legendary\b/, 'is legendary'], [/ in addition to (its|their) other types/, ''], [/\bother creature\b/, 'creature'],
    [/\bits name is ~/, 'its name is Bob'], [/\bhas trample\b/, 'gains trample'], [/\bthey're 1\/1\b/, "it's 1/1"], [/\byou control\b/, 'an opponent controls'],
    [/\band this ability\b/, 'and that ability'], [/\buntil end of turn\b/, 'until your next turn'], [/, except /, ' except '],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-copy-perm-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parse(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parse(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('p2-copy-perm-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parse(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const ENV = { lexicon: OPTS.lexicon, keywords: OPTS.keywords };
const hole = (type: 'CopyExcept' | 'CopyExceptToken' | 'CopyExceptTokens', text: string) => {
  const toks = adaptTokens(tokenize(text));
  return runHole(type, toks, 0, ENV).filter((a) => a.end === toks.length);
};

describe('p2-copy-perm-1 hole CopyExcept (parser/holes/p2copyperm1.ts; CR 707.9b): one exception per clause, in Oracle\'s order, every parse weak', () => {
  it('"it isn\'t legendary, is a Spirit in addition to its other types, and has haste": three clauses, the later ones without their subject', () => {
    const r = hole('CopyExcept', "it isn't legendary, is a Spirit in addition to its other types, and has haste");
    expect(r.length).toBe(1);
    expect(r[0]!.weak).toBe(1);
    expect(r[0]!.value).toEqual([
      { layer: 4, supertypes: { remove: ['Legendary'] } },
      { layer: 4, subtypes: { add: ['Spirit'] } },
      { layer: 6, add: [expect.objectContaining({ kind: 'keyword', keyword: 'haste' })] },
    ]);
  });
  it('CR 205.1b: "it\'s a 2/2 Golem artifact creature in addition to its other types" is one layer 4 change (types and subtypes added) and a base P/T', () => {
    expect(hole('CopyExcept', "it's a 2/2 Golem artifact creature in addition to its other types").map((a) => a.value)).toEqual([[
      { layer: 4, types: { add: ['Artifact', 'Creature'] }, subtypes: { add: ['Golem'] } }, { layer: '7b', power: 2, toughness: 2 },
    ]]);
  });
  it('CR 105.3: a color only with "in addition to its other colors and types"; with "its other types" no parse (the color would be set)', () => {
    expect(hole('CopyExcept', "it's a 3/3 red Goblin in addition to its other colors and types").map((a) => a.value)).toEqual([[
      { layer: 4, subtypes: { add: ['Goblin'] } }, { layer: '7b', power: 3, toughness: 3 }, { layer: 5, colors: { add: ['R'] } },
    ]]);
    expect(hole('CopyExcept', "it's a 3/3 red Goblin in addition to its other types")).toEqual([]);
  });
  it('CR 707.9b: "its name is ~" first only; "it has flying and this ability"; "this ability and <ability>"', () => {
    expect(hole('CopyExcept', 'its name is ~ and it has flying and this ability').map((a) => a.value)).toEqual([[
      { retain: ['name'] }, { layer: 6, add: [expect.objectContaining({ keyword: 'flying' })] }, { thisAbility: true },
    ]]);
    expect(hole('CopyExcept', 'it has flying and its name is ~')).toEqual([]);
  });
  it('a list of three needs the serial comma; no kind of clause twice; a bare "it\'s an artifact" and "loses all other card types" do not parse (CR 205.1a)', () => {
    expect(hole('CopyExcept', "it isn't legendary, it's 1/1 and it has flying")).toEqual([]);
    expect(hole('CopyExcept', "it's 1/1 and it's 2/2")).toEqual([]);
    expect(hole('CopyExcept', "it's an artifact")).toEqual([]);
    expect(hole('CopyExcept', "it's an artifact and it loses all other card types")).toEqual([]);
  });
  it('number: "the token isn\'t legendary" is said of one token only; "they\'re 1/1 Thopter artifacts in addition to their other types" of several only', () => {
    expect(hole('CopyExceptToken', "the token isn't legendary").length).toBe(1);
    expect(hole('CopyExcept', "the token isn't legendary")).toEqual([]);
    expect(hole('CopyExceptTokens', "they're 1/1 Thopter artifacts in addition to their other types").map((a) => a.value)).toEqual([[
      { layer: 4, types: { add: ['Artifact'] }, subtypes: { add: ['Thopter'] } }, { layer: '7b', power: 1, toughness: 1 },
    ]]);
    expect(hole('CopyExceptToken', "they're 1/1 Thopter artifacts in addition to their other types")).toEqual([]);
    expect(hole('CopyExceptTokens', "they're 1/1 Thopter artifact in addition to their other types")).toEqual([]);
  });
});

describe('p2-copy-perm-1 weak readings (design 6.3 rule 2): a template that spells the exceptions out keeps its sentence', () => {
  it('"create a token that\'s a copy of target creature, except it isn\'t legendary" is still the M6 template\'s', () => {
    const f = parse("Create a token that's a copy of target creature you control, except it isn't legendary.");
    expect(f.templatesUsed).toContain('eff.m6.copy.token.notLegendary');
    expect(f.templatesUsed.some((id) => id.startsWith('eff.p2copyperm1.'))).toBe(false);
  });
  it('"you may have ~ enter as a copy of any creature on the battlefield, except it has flying" is still r4-copy\'s', () => {
    const f = parse('You may have ~ enter as a copy of any creature on the battlefield, except it has flying.');
    expect(f.templatesUsed).toContain('rep.r4copy.enters.copy.any.exceptHas');
  });
});

describe('p2-copy-perm-1 renderer (render/copy-except.ts#copyExceptText, mods.ts): the clause list is an alternative wording', () => {
  it('CR 205.4a: a supertype alone is said without an article, "it\'s legendary in addition to its other types"', () => {
    const f = parse("You may have ~ enter as a copy of any creature on the battlefield, except its name is ~, it's legendary in addition to its other types, and it has haste.");
    expect(fullyAutomated(f), JSON.stringify(f.gate)).toBe(true);
  });
  it('CR 611.2a: the duration of a copy that keeps its name goes before "except" ("become a copy of it until end of turn, except its name is ~ ...")', () => {
    const f = parse("Whenever a Wizard you control enters, you may have ~ become a copy of it until end of turn, except its name is ~ and it has flying.");
    expect(fullyAutomated(f), JSON.stringify(f.gate)).toBe(true);
  });
  it('a quoted ability of several token copies: "they have \\"...\\""', () => {
    const f = parse('Create two tokens that are copies of target creature you control, except they have "When this creature enters, you gain 2 life."');
    expect(fullyAutomated(f), JSON.stringify(f.gate)).toBe(true);
  });
});

const index = localIndex();

describe.skipIf(index === null)('p2-copy-perm-1 design 6.10 (local index): synthetic examples', () => {
  it('no p2-copy-perm-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
