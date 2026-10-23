/**
 * std-copy-2 (lane std-copy): the template data of parser/templates/zz-cloud/std-copy-2.json ("each <filter> becomes prepared"; "you may copy it. If you do,
 * those spells gain <abilities>. You may choose new targets for the copy."), and the round's parser and renderer changes: the filter `prepareSpell` ("a prepared
 * spell", parser/holes/filter.ts#finalize, rules/filter.ts#isPrepareSpell, render/np.ts), the sentence join of parser/lower/ability.ts#joinThoseSpellsGain and
 * the `may` renderer render/steps-flow.ts#mayCopyThoseSpellsGain.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-copy-2-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { SUPPORTED_FILTER_FIELDS } from '../../../src/rules/filter';
import stdCopy2 from '../../../src/parser/templates/zz-cloud/std-copy-2.json';
import review from '../../m5/golden/cards/cloud-std-copy-2-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdCopy2 as Template[];
const MECH_COUNT = 2;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because the index prints
 * the wording on one card only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'eff.stdcopy2.eachBecomesPrepared': 'Codie, Ravenous Codex',
  'eff.stdcopy2.mayCopy.thoseSpellsGain.newTargets': 'Spinerock Tyrant',
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Codex', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const parsedWith = (_t: Template, text: string) => face('Artifact Creature — Construct', text, ['2', '2']);
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');

describe('std-copy-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-copy-2.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-copy-2.json');
    expect(files.indexOf('zz-cloud/std-copy-2.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-copy-2.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdcopy2.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.stdcopy2\./);
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
      const cards = golden.filter((g) => g.verified.includes(`(${t.id};`) || g.verified.includes(`(${t.id})`) || g.verified.includes(` ${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) expect(cards, t.id).toContain(NARROW[t.id]);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'when']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-copy-2 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [[/\bbecomes prepared\b/, 'becomes unprepared'], [/\bEach\b/, 'Target'], [/\beach other\b/, 'target'], [/\bthose spells\b/, 'the copy'], [/\bIf you do\b/, "If you don't"], [/\byou may copy it\b/, 'copy it'], [/\bthe copy\.$/, 'the copies.']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-copy-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able" or a swapped key word never gives the example's JSON`, () => {
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

describe('std-copy-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w)) return;
          const end = w.match(/[.,:]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-copy-2 design 6.10 (local index): synthetic examples', () => {
  it('no std-copy-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment|permanent)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

// ---- parser/holes/filter.ts, rules/filter.ts, render/np.ts: "a prepared spell" ------------------------------------------------------------------------------

describe('std-copy-2 parser (CR 722.3a, 722.3d): "a prepared spell" is a prepare spell, not the designation of a permanent', () => {
  it('"Whenever you cast a prepared spell" reads the spell filter prepareSpell, renders back, and the card is full', () => {
    const f = face('Creature — Human Wizard', 'Whenever you cast a prepared spell, you gain 2 life.', ['2', '2']);
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"spell":{"prepareSpell":true}');
    expect(JSON.stringify(f.abilities)).not.toContain('"prepared":true');
  });
  it('a prepared creature keeps the designation (CR 722.3a): "Whenever a prepared creature you control attacks" never reads prepareSpell', () => {
    const f = face('Enchantment', 'Whenever a prepared creature you control attacks, you gain 1 life.');
    expect(JSON.stringify(f.abilities)).not.toContain('prepareSpell');
  });
  it('the field is evaluated (an engine capability; design 5.2)', () => {
    expect(SUPPORTED_FILTER_FIELDS.has('prepareSpell')).toBe(true);
  });
});

// ---- parser/lower/ability.ts#joinThoseSpellsGain + render/steps-flow.ts#mayCopyThoseSpellsGain ---------------------------------------------------------------

describe('std-copy-2 parser (CR 707.10, 707.10c, 608.2c): "you may copy it. If you do, those spells gain X. You may choose new targets for the copy."', () => {
  it('the three sentences are one instruction: an optional copy bound as "copy", then the grant to the union of the spell and its copy', () => {
    const f = face('Creature — Dragon', 'Whenever you cast an instant spell, you may copy it. If you do, those spells gain lifelink. You may choose new targets for the copy.', ['4', '4']);
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"affects":{"ref":"union","of":[{"ref":"event","role":"spell"},{"ref":"bound","name":"copy"}]}');
    expect(JSON.stringify(f.abilities)).toContain('"newTargets":"may"');
  });
  it('without the new-targets sentence the two sentences are not joined and "those spells" stays unbound (fail closed)', () => {
    expect(fullFace(face('Creature — Dragon', 'Whenever you cast an instant spell, you may copy it. If you do, those spells gain lifelink.', ['4', '4']))).toBe(false);
  });
  it('a duration on the grant is not this wording (fail closed)', () => {
    expect(fullFace(face('Creature — Dragon', 'Whenever you cast an instant spell, you may copy it. If you do, those spells gain lifelink until end of turn. You may choose new targets for the copy.', ['4', '4']))).toBe(false);
  });
});
