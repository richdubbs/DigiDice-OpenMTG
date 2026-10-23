/**
 * std-freecast-1 (lane std-freecast): the template data of parser/templates/zz-cloud/std-freecast-1.json and the round's engine, lowering and renderer support:
 * "The first spell each player casts during each of their turns may be cast without paying its mana cost" (a permit with `firstSpellThisTurn`, who the active
 * player; statics/play-permits.ts#isAltCostPermit, render/stat.ts#alternativePermit, family may-can-be-cast-free) and "the next <spell> you cast this turn can be
 * cast without paying its mana cost" (nextSpell rider `free`; statics/play-permits.ts#grantedAlternatives, render/steps-stdr10.ts). It also promotes r3-choose's
 * eff.r3choose.dur.double.its.pt.gains (World War Hulk, its golden entry in cloud-r3-choose-review.json).
 * Guard G9 (design 6.8): every example lowers with its template and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic
 * wordings (design 6.10), checked against the local index when it is present. The behavior is in std-freecast-1-scenarios.test.ts. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import type { PermissionDef } from '../../../src/types/ability';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { isAltCostPermit } from '../../../src/statics/play-permits';
import freecast1 from '../../../src/parser/templates/zz-cloud/std-freecast-1.json';
import r3choose from '../../../src/parser/templates/zz-cloud/r3-choose.json';
import review from '../../m5/golden/cards/cloud-std-freecast-1-review.json';
import r3chooseReview from '../../m5/golden/cards/cloud-r3-choose-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const FC1 = freecast1 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const GOLDEN = [...(review as Golden), ...(r3chooseReview as Golden)];
const goldenUsing = (id: string): string[] => GOLDEN.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on one golden card because Oracle prints the wording on that
 * card only in the whole index, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'sta.stdfreecast1.firstSpell.eachPlayer.free': 'Weftwalking',
  'eff.stdfreecast1.nextSpell.free': 'World War Hulk',
};
/** r3-choose's template this round promotes on the same deviation (World War Hulk is the only card of the index that prints it). */
const PROMOTED: Readonly<Record<string, string>> = { 'eff.r3choose.dur.double.its.pt.gains': 'World War Hulk' };

/** The type line an example is an ability of: an activated ability on an artifact, a static ability on an enchantment or a creature, anything else a sorcery. */
const typeOf = (text: string): string => (/^\{/.test(text) ? 'Artifact' : /^The first\b/.test(text) ? 'Enchantment' : /^Ward\b/.test(text) ? 'Creature — Human' : 'Sorcery');
const face = (text: string, type = typeOf(text)) => parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');

describe('std-freecast-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-freecast-1.json, after zz-cloud/std-fra.json, before zz-cloud/std-hob.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-freecast-1.json');
    expect(files.indexOf('zz-cloud/std-freecast-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-fra.json'));
    expect(files.indexOf('zz-cloud/std-freecast-1.json')).toBeLessThan(files.indexOf('zz-cloud/std-hob.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(FC1.map((t) => t.id).sort()).toEqual(Object.keys(NARROW).sort());
    for (const t of FC1) {
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
      expect(goldenUsing(t.id), t.id).toEqual([NARROW[t.id]]);
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
  });
  it('design 6.9: the promoted r3-choose template is stable with its golden card in its own round\'s review file', () => {
    for (const [id, cardName] of Object.entries(PROMOTED)) {
      const t = (r3choose as Template[]).find((x) => x.id === id)!;
      expect(t.status, id).toBe('stable');
      expect(goldenUsing(id), id).toEqual([cardName]);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of FC1) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'next', 'then', 'when', 'whenever', 'again']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-freecast-1 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of FC1) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
        expect(fullyAutomated(f), e.text).toBe(true);
      }
      for (const c of t.counterExamples) {
        const f = face(c, typeOf(t.examples[0]!.text));
        expect(understood(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = text.includes('\n') ? [] : [`${body} unless it is blue.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [[/\bthis turn\b/, 'this game'], [/\byou cast\b/, 'an opponent casts'], [/\bfirst\b/, 'second'], [/\btheir turns\b/, 'your turns'],
    [/\beach player\b/, 'each opponent'], [/\bwithout paying\b/, 'by paying']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-freecast-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of FC1) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(e.text);
        for (const m of nearMisses(e.text)) {
          const f = face(m, typeOf(e.text));
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-freecast-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of FC1) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.pop()!;
        const words = last.split(' ');
        words.forEach((w, i) => {
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...lines, [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ')].join('\n');
          expect(understood(face(mutated, typeOf(e.text))), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-freecast-1 engine, lowering and renderer support', () => {
  it('CR 118.9, 102.1: isAltCostPermit honors `firstSpellThisTurn` with who "you" or the active player, of all spells only (fail closed)', () => {
    const p: PermissionDef = { s: 'permit', who: { ref: 'active' }, action: 'cast', costChange: { kind: 'set', cost: {} }, firstSpellThisTurn: true };
    expect(isAltCostPermit(p)).toBe(true);
    expect(isAltCostPermit({ ...p, who: { ref: 'you' } })).toBe(true);
    expect(isAltCostPermit({ ...p, firstSpellThisTurn: undefined })).toBe(false); // the active player without the first-spell limit: no such form
    expect(isAltCostPermit({ ...p, of: { types: ['Creature'] } })).toBe(false); // "the first creature spell" would need a count of creature spells
    expect(isAltCostPermit({ ...p, who: { ref: 'each', who: 'player' } })).toBe(false);
  });
  it('"the first spell each player casts during each of their turns" is a permit for the active player with `firstSpellThisTurn` and no `of`', () => {
    const f = face('The first spell each player casts during each of their turns can be cast without paying its mana cost.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"who":{"ref":"active"},"action":"cast","costChange":{"kind":"set","cost":{}},"firstSpellThisTurn":true');
  });
  it('"the first creature spell each player casts during each of their turns ..." is not understood (no template counts the creature spells cast)', () => {
    expect(understood(face('The first creature spell each player casts during each of their turns may be cast without paying its mana cost.'))).toBe(false);
  });
  it('CR 118.9, 611.2: "the next red creature spell you cast this turn can be cast without paying its mana cost" is a nextSpell rider `free` with the filter', () => {
    const f = face('{2}, {T}: The next red creature spell you cast this turn can be cast without paying its mana cost.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"op":"nextSpell","who":{"ref":"you"},"filter":{"colors":["R"],"types":["Creature"],"stackKind":"spell","zone":"stack"},"rider":"free"');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-freecast-1 design 6.10 (local index): synthetic examples', () => {
  it('no std-freecast-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|Equipment|spell|card|Saga|Vehicle)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = FC1.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
