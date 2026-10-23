/**
 * std-freecast-2 (lane std-freecast): the template data of parser/templates/zz-cloud/std-freecast-2.json and the round's engine, lowering and renderer support:
 * "you may cast a creature spell from your graveyard this turn" (a resolved effect's graveyard permission for one spell, `single`; statics/play-permits.ts#gyHits,
 * render/stat.ts#oneGraveyardSpell) and its rider "If you do, it enters with a finality counter on it and is a Vampire in addition to its other types"
 * (`entersWith`, `entersSubtypes`; actions/cast.ts, effects/rule-replacements/permit-enters.ts, the enters body's `subtypes`, effects/perform-events.ts).
 * Guard G9 (design 6.8): every example lowers with its template and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic
 * wordings (design 6.10), checked against the local index when it is present. The behavior is in std-freecast-2-scenarios.test.ts. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import type { PermissionDef } from '../../../src/types/ability';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { isGraveyardPermit } from '../../../src/statics/play-permits';
import freecast2 from '../../../src/parser/templates/zz-cloud/std-freecast-2.json';
import review from '../../m5/golden/cards/cloud-std-freecast-2-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const FC = freecast2 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const GOLDEN = [...(review as Golden)];
const goldenUsing = (id: string): string[] => GOLDEN.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on one golden card because Oracle prints the wording on that
 * card only in the whole index, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'eff.stdfreecast2.gy.castOne.thisTurn': "Tarrian's Journal // The Tomb of Aclazotz",
  'rid.stdfreecast2.ifYouDo.entersWith.isSubtype': "Tarrian's Journal // The Tomb of Aclazotz",
};

/** The type line an example is an ability of: an activated ability on an artifact, a static ability on an enchantment or a creature, anything else a sorcery. */
const typeOf = (text: string): string => (/^\{/.test(text) ? 'Artifact' : 'Sorcery');
const face = (text: string, type = typeOf(text)) => parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');

describe('std-freecast-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-freecast-2.json, after zz-cloud/std-fra.json, before zz-cloud/std-hob.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-freecast-2.json');
    expect(files.indexOf('zz-cloud/std-freecast-2.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-fra.json'));
    expect(files.indexOf('zz-cloud/std-freecast-2.json')).toBeLessThan(files.indexOf('zz-cloud/std-hob.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(FC.map((t) => t.id).sort()).toEqual(Object.keys(NARROW).sort());
    for (const t of FC) {
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
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of FC) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'next', 'then', 'when', 'whenever', 'again']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-freecast-2 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of FC) {
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
    [/\byour graveyard\b/, 'your hand'], [/\bfinality\b/, 'shield'], [/\bin addition to its other types\b/, 'instead of its other types'], [/\bIf you do\b/, "If you don't"]];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-freecast-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of FC) {
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

describe('std-freecast-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of FC) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.pop()!;
        const words = last.split(' ');
        words.forEach((w, i) => {
          // CR 122.1: any word names a kind of counter, so the word before "counter" may be anything (an invented kind is a real reading)
          if (/^counters?$/.test(words[i + 1] ?? '')) return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...lines, [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ')].join('\n');
          expect(understood(face(mutated, typeOf(e.text))), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-freecast-2 engine, lowering and renderer support', () => {
  it('CR 601.3, 205.1b: isGraveyardPermit honors `single` and `entersSubtypes` (with `entersWith`) and nothing looser (fail closed)', () => {
    const p: PermissionDef = { s: 'permit', who: { ref: 'you' }, action: 'cast', from: 'graveyard', of: { types: ['Creature'] }, single: true, entersWith: [{ kind: 'finality', count: 1 }], entersSubtypes: ['Vampire'] };
    expect(isGraveyardPermit(p)).toBe(true);
    expect(isGraveyardPermit({ ...p, entersWith: undefined })).toBe(false); // the subtypes ride with the counters only
    expect(isGraveyardPermit({ ...p, entersSubtypes: [] })).toBe(false);
    expect(isGraveyardPermit({ ...p, oncePerTurn: true })).toBe(false);
    expect(isGraveyardPermit({ ...p, action: 'play' })).toBe(false);
  });
  it('"you may cast a creature spell from your graveyard this turn" is one spell (`single`) for this turn; the plural "creature spells" stays c10\'s reading', () => {
    const one = face('Draw a card. You may cast a creature spell from your graveyard this turn.');
    expect(fullyAutomated(one)).toBe(true);
    expect(JSON.stringify(one.abilities)).toContain('"from":"graveyard","single":true');
    const many = face('Draw a card. You may cast creature spells from your graveyard this turn.');
    expect(many.templatesUsed).toContain('eff.c10.thisturn.cast');
    expect(JSON.stringify(many.abilities)).not.toContain('"single"');
  });
  it('the rider after a permission for many spells is not understood (it names "it": one spell only)', () => {
    expect(understood(face('Draw a card. You may cast creature spells from your graveyard this turn. If you do, it enters with a finality counter on it and is a Vampire in addition to its other types.'))).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-freecast-2 design 6.10 (local index): synthetic examples', () => {
  it('no std-freecast-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = FC.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
