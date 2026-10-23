/**
 * Card wave 2, slice s14 (std-rx13): the template data of parser/templates/zz-cloud/std-rx13.json ("You may choose not to untap ~ during your untap step", the rule
 * modification mayNotUntap) and the parser changes of the round (the Event readings "a counter is put on <obj>" and "deals damage to that player").
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-rx13-scenarios.test.ts. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRx13 from '../../../src/parser/templates/zz-cloud/std-rx13.json';
import review from '../../m5/golden/cards/cloud-std-rx13-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdRx13 as Template[];
const MECH_COUNT = 1;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one card only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: an artifact (static and activated abilities). */
const parsedWith = (_t: Template, text: string) => parseCard(card('Example Relic', 'Artifact', text), OPTS).faces[0]!;
const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Monk', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');

describe('std-rx13 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rx13.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rx13.json');
    expect(files.indexOf('zz-cloud/std-rx13.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-rx13.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are sta.stdrx13.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^sta\.stdrx13\./);
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
      if (NARROW[t.id] !== undefined) expect(cards, t.id).toContain(NARROW[t.id]);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
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

describe('std-rx13 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const swaps: [RegExp, string][] = [[/\bmay\b/, 'must'], [/\byour untap step\b/, 'your upkeep'], [/\bnot to untap\b/, 'to untap'], [/\buntap ~/, 'untap target artifact'], [/\byour untap\b/, 'each untap']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rx13 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('std-rx13 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('std-rx13 design 6.10 (local index): synthetic examples', () => {
  it('no std-rx13 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

// ---- core/steps.ts + statics/hooks.ts: the rule modification mayNotUntap -----------------------------------------------------------------------------------

describe('std-rx13 rule mayNotUntap (CR 502.3): the static is full on any permanent, as "this <type>" or the card\'s name', () => {
  it('on a creature, a land and a named legendary artifact', () => {
    expect(fullFace(face('Creature — Elf Druid', 'You may choose not to untap this creature during your untap step.\n{T}: You gain 1 life.', ['1', '1']))).toBe(true);
    expect(fullFace(face('Land', 'You may choose not to untap this land during your untap step.\n{T}: Add {C}.'))).toBe(true);
    const named = parseCard(card('Example Rod of Ages', 'Legendary Artifact', 'You may choose not to untap Example Rod of Ages during your untap step.'), OPTS).faces[0]!;
    expect(fullFace(named), JSON.stringify(named.diagnostics)).toBe(true);
  });
  it('another object, another player\'s untap step or "doesn\'t untap" is not this reading', () => {
    const rule = (t: string): boolean => JSON.stringify(face('Artifact', t).abilities).includes('"mayNotUntap"');
    expect(rule('You may choose not to untap target artifact during your untap step.')).toBe(false);
    expect(rule('You may choose not to untap ~ during each other player\'s untap step.')).toBe(false);
    expect(rule('~ doesn\'t untap during your untap step.')).toBe(false);
    expect(rule('Each player may choose not to untap ~ during their untap step.')).toBe(false);
  });
});

// ---- parser/holes/event.ts: "a counter is put on <obj>" ------------------------------------------------------------------------------------------------------

describe('std-rx13 parser (CR 122.1, 603.2): "Whenever a counter is put on <obj>", any kind (parser/holes/event.ts counterEvents)', () => {
  const trig = (text: string): string => JSON.stringify(face('Enchantment', text).abilities);
  it('is the counters event of any kind on one object, as "a +1/+1 counter is put on" is for one kind', () => {
    const f = face('Enchantment', 'Whenever a counter is put on a creature you control, you gain 1 life.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(trig('Whenever a counter is put on a creature you control, you gain 1 life.')).toContain('{"ev":"counters","change":"put","on":{"types":["Creature"],"controller":"you"}}');
    expect(trig('Whenever a +1/+1 counter is put on a creature you control, you gain 1 life.')).toContain('"kind":"+1/+1"');
  });
  it('"a counters", "a counter are put on" or "one or more counter is put on" is not', () => {
    for (const t of ['Whenever a counters are put on a creature you control, you gain 1 life.', 'Whenever a counter are put on a creature you control, you gain 1 life.', 'Whenever one or more counter is put on a creature you control, you gain 1 life.']) {
      expect(fullFace(face('Enchantment', t)), t).toBe(false);
    }
  });
});

// ---- parser/holes/event.ts: "deals combat damage to that player" ----------------------------------------------------------------------------------------------

describe('std-rx13 parser (CR 603.7c, 608.2c): "deals [combat] damage to that player|opponent" names the player an earlier part of the ability names', () => {
  it('after "Choose target opponent.", the delayed trigger\'s recipient is that target', () => {
    const f = face('Instant', 'Choose target opponent. Whenever a creature you control deals combat damage to that player this turn, you gain 2 life.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"recipient":{"player":{"ref":"target","id":"t0"}}');
  });
  it('with no player named before it, the sentence stays manual (fail closed)', () => {
    expect(fullFace(face('Instant', 'Whenever a creature you control deals combat damage to that player this turn, you gain 2 life.'))).toBe(false);
    expect(fullFace(face('Enchantment', 'Whenever a creature you control deals combat damage to that player, you gain 2 life.'))).toBe(false);
  });
});
