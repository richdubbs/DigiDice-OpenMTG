/**
 * edh-misc-6 (Commander lane edh-misc): the template data of parser/templates/zz-cloud/edh-misc-6.json ("move any number of counters from among <objects> onto
 * <object>", "move a counter of each kind not on ~ from <object> onto ~", "move one or more counters from <object> onto <object>", "a player of your choice adds
 * <mana>") and the round's renderer changes (render/steps-life.ts#moveCounters, render/steps-cards.ts#addMana). Guard G9 (design 6.8): every example lowers with
 * its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or
 * differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against
 * the local index when it is present. The behavior is in edh-misc-6-scenarios.test.ts. CR cites are from the Comprehensive Rules 2026-09-25 where the round
 * checked them; unverified ones are listed in the round's record.
 *
 * Status (design 6.9): every template is `stable` on one hand-verified golden card (Slippery Bogbonder, Goldberry, River-Daughter and Victory Chimes, all
 * held-out half, opened by the owner's commander request 2026-10-27) plus these tests and the scenarios: each wording is printed on one card (two for the
 * Goldberry wordings), so a second golden card is out of reach (guide section 5, "Narrow wordings"; decided by the owner's standing rule 2026-10-27; named in the
 * round's record).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhx6 from '../../../src/parser/templates/zz-cloud/edh-misc-6.json';
import review from '../../m5/golden/cards/edh-misc-6-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhx6 as Template[];
const MECH_COUNT = 5;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Codex', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const typeOf = (text: string): [string, [string, string] | undefined] => (/^(When|Whenever|At)\b|^\{/.test(text) ? ['Creature — Beast', ['2', '2']] : ['Sorcery', undefined]);
const parsed = (text: string) => { const [type, pt] = typeOf(text); return face(type, text, pt); };
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');
const abilitiesJson = (f: ReturnType<typeof face>): string => JSON.stringify(f.abilities);

describe('edh-misc-6 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-misc-6.json, after zz-cloud/edh-misc-4.json) and its ids are unique', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-misc-6.json');
    expect(files.indexOf('zz-cloud/edh-misc-6.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-misc-4.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.edhx6.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.edhx6\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 (narrow wordings, guide section 5): a stable template has at least one hand-verified golden card (tuning half) naming it', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`) || g.verified.includes(`(${t.id};`) || g.verified.includes(`(${t.id},`) || g.verified.includes(` ${t.id},`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'second', 'again', 'then', 'additional', 'except']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-misc-6 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsed(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsed(e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parsed(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} if able.`, `${body} for each Elf you control.`];
  const swaps: [RegExp, string][] = [[/a counter of each kind/, 'a +1/+1 counter of each kind'], [/any number of counters/, 'up to one counter'], [/one or more counters/, 'one or more +1\/+1 counters'], [/among/, 'from'],
    [/a player of your choice/, 'target player'], [/adds \{/, 'gains {'], [/^Move/, 'Remove'], [/Move/, 'Remove']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-misc-6 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/if able/for each" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsed(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsed(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('edh-misc-6 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '~,' || /^\{/.test(w)) return;
          const end = w.match(/[.,:]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsed(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-misc-6 design 6.10 (local index): synthetic examples', () => {
  it('no line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => lines.has(x.trim())).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

// ---- the readings and the renderer ---------------------------------------------------------------------------------------------------------------------

describe('edh-misc-6 (CR 122.5, 608.2d): counters moved from several objects, of each new kind, one or more', () => {
  it('"move any number of counters from among <group> onto <object>" is `among` with every counter there (the controller chooses how many of each kind each object gives)', () => {
    const f = face('Sorcery', 'Move any number of counters from among creatures you control onto target creature.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(abilitiesJson(f)).toContain('"kind":"any","count":"all","upTo":true,"among":true');
  });
  it('fail closed: other wordings of gathering counters (no "among", one kind named, a group receiving) stay manual or read by another template', () => {
    expect(fullFace(face('Creature — Beast', 'Move any number of counters from other creatures you control onto ~.', ['2', '2']))).toBe(false);
    expect(jsonKey(face('Sorcery', 'Move any number of +1/+1 counters from among creatures you control onto target creature.').abilities)).not.toContain('"among":true');
  });
  it('"move a counter of each kind not on ~ from <object> onto ~" is `eachNewKind` onto the source; the receiver is the source only', () => {
    const f = face('Artifact', '{T}: Move a counter of each kind not on ~ from target creature onto ~.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(abilitiesJson(f)).toContain('"kind":"any","count":1,"eachNewKind":true');
    expect(abilitiesJson(f)).toContain('"to":{"ref":"self"}');
  });
  it('"move one or more counters" is `upTo` with `atLeastOne`; "if you do" follows its step', () => {
    const f = face('Creature — Beast', '{T}: Move one or more counters from ~ onto target creature. If you do, draw a card.', ['2', '2']);
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(abilitiesJson(f)).toContain('"kind":"any","count":"all","upTo":true');
    expect(abilitiesJson(f)).toContain('"atLeastOne":true');
    expect(abilitiesJson(f)).toContain('"cond":"did"');
  });
});

describe('edh-misc-6 (CR 106.4, 605.1a): "a player of your choice adds <mana>"', () => {
  it('is a mana ability (no stack, CR 605.3b) with one addMana step that has `ofYourChoice`', () => {
    const f = face('Artifact', '{T}: A player of your choice adds {C}{C}.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(abilitiesJson(f)).toContain('"isMana":true');
    expect(abilitiesJson(f)).toContain('"op":"addMana"');
    expect(abilitiesJson(f)).toContain('"ofYourChoice":true');
  });
  it('fail closed: mana of an unfixed kind or restricted, and another player named a different way, are not this reading', () => {
    expect(jsonKey(face('Artifact', '{T}: A player of your choice adds one mana of any color.').abilities)).not.toContain('"ofYourChoice"');
    expect(fullFace(face('Artifact', '{T}: A player of your choice gains {C}.'))).toBe(false);
  });
});

describe('edh-misc-6 (CR 603.12, 608.2c): "Otherwise, you may pay {X}. When you do, ..." (parser/lower/conditions.ts#foldReflexiveInElse)', () => {
  const lead = 'Whenever another creature you control enters, you gain 1 life if this is the first time this ability has resolved this turn.';
  const beast = (text: string) => face('Creature — Beast', text, ['2', '2']);
  it('the reflexive trigger waits for the payment of the `else` branch and moves into it: with the condition true nothing is paid and nothing triggers', () => {
    const f = beast(`${lead} Otherwise, you may pay {X}. When you do, ~ deals X damage to any target.`);
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    const step = (f.abilities[0] as { effect: { steps: { op: string; then: unknown[]; else: { op: string; as?: string; when?: { did: string } }[] }[] } }).effect.steps[0]!;
    expect(step.op).toBe('if');
    expect(step.then.map((x) => (x as { op: string }).op)).toEqual(['gainLife']);
    expect(step.else.map((x) => x.op)).toEqual(['pay', 'reflexive']);
    expect(step.else[1]!.when!.did).toBe(step.else[0]!.as);
  });
  it('fail closed: a "then" branch with an option or payment of its own, "you do" instead of "when you do", "when you don\'t", and a non-payment "otherwise" stay manual', () => {
    for (const text of [
      `Whenever another creature you control enters, if you control an Elf, you may pay {1}. Otherwise, you may pay {X}. When you do, ~ deals X damage to any target.`,
      `${lead} Otherwise, you may pay {X}. If you do, draw a card.`,
      `${lead} Otherwise, you may pay {X}. When you don't, ~ deals 2 damage to any target.`,
      `${lead} Otherwise, you gain 2 life. When you do, ~ deals 1 damage to any target.`,
    ]) expect(fullFace(beast(text)), text).toBe(false);
  });
});
