/**
 * Standard round slot A (std-ra): the template data of parser/templates/zz-cloud/std-ra.json ("<group> get +N/+N for each <kind> counter on ~") and the parser,
 * lowering and renderer changes of the round. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate
 * (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an
 * example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior
 * is in std-ra-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { capabilitiesOfDef } from '../../../src/model/cap-walk';
import stdRa from '../../../src/parser/templates/zz-cloud/std-ra.json';
import review from '../../m5/golden/cards/cloud-std-ra-review.json';
import { renderGate } from '../../../src/index';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdRa as Template[];
const MECH_COUNT = 1;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a static ability on an artifact. */
function exampleCard(_t: Template, text: string): OracleCard {
  return card('Example Banner', 'Artifact', text);
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Brute', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');

describe('std-ra template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-ra.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-ra.json');
    expect(files.indexOf('zz-cloud/std-ra.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-ra.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are sta.stdra.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.stdra\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence, hand-verified golden cards that use it (three or more, design 6.9)', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
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

describe('std-ra guard G9 (design 6.8): examples and counter-examples', () => {
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

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} until end of turn.`];
  const swaps: [RegExp, string][] = [[/\bget\b/, 'gain'], [/\bon ~/, 'on it'], [/\bfor each\b/, 'for every two'], [/\byou control\b/, 'an opponent controls']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-ra guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('std-ra guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // the word in front of "counter(s)" is an open class by design (6.11, the CounterKind hole), as wp22-mutation.test.ts
          const end = w.match(/[.,]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-ra design 6.10 (local index): synthetic examples', () => {
  it('no std-ra line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

// ---- parser/holes/moved.ts + lower/quantities.ts#movedReflexive + render (refs.ts#countWord, moved.ts): "When you discard one or more <cards> this way" ----------

describe('std-ra parser (CR 603.12, 608.2c): "When you discard one or more <cards> this way, ... that many ..." (parser/holes/moved.ts, lower/quantities.ts)', () => {
  const ETB = 'When ~ enters, draw three cards, then discard two cards.';
  it('the plural reflexive condition and its "that many" are understood, and the count is of the matching discarded cards', () => {
    const f = face('Creature — Human Wizard', `${ETB} When you discard one or more creature cards this way, tap up to that many target creatures.`, ['2', '2']);
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    const json = JSON.stringify(f.abilities);
    expect(json).toContain('"op":"reflexive"');
    expect(json).toContain('"q":"resultCount"');
    expect(json).toMatch(/"q":"resultCount","step":"[^"]+","which":\{[^}]*"Creature"/); // the count reads `which`: the creature cards, not every discarded card
  });
  it('the singular "a creature card" keeps its reading (r3-moved) and the plural reading gives the same condition', () => {
    const one = face('Creature — Human Wizard', `${ETB} When you discard a creature card this way, you gain 2 life.`, ['2', '2']);
    const more = face('Creature — Human Wizard', `${ETB} When you discard one or more creature cards this way, you gain 2 life.`, ['2', '2']);
    expect(fullFace(one)).toBe(true);
    expect(fullFace(more)).toBe(true);
    expect(jsonKey(more.abilities)).toBe(jsonKey(one.abilities));
  });
  it('a singular noun after "one or more", or "one or more" after a negated verb, is not this reading', () => {
    expect(fullFace(face('Creature — Human Wizard', `${ETB} When you discard one or more creature card this way, you gain 2 life.`, ['2', '2']))).toBe(false);
    expect(fullFace(face('Creature — Human Wizard', `${ETB} When you don't discard one or more creature cards this way, you gain 2 life.`, ['2', '2']))).toBe(false);
  });
});

// ---- render/steps-life.ts (perForms): "put a <kind> counter on ~ for each <X> target opponent controls" ---------------------------------------------------

describe('std-ra renderer (CR 115.1, 122.1, 608.2c): a for-each count of what a target player controls, said after the recipient', () => {
  const RCTX = { selfNames: ['Test Edge'], selfTypes: ['Artifact', 'Equipment'] };
  const t0 = { id: 't0', kind: 'player', min: 1, max: 1, players: { who: 'opponent' } };
  const count = { q: 'count', of: { ref: 'each', filter: { controller: { ref: 'target', id: 't0' }, types: ['Creature'] } } };
  const def = { kind: 'spell', effect: { targets: [t0], steps: [{ op: 'putCounters', on: { ref: 'self' }, kind: 'hone', count }] } } as never;
  it('"put a hone counter on ~ for each creature target opponent controls" is accepted, as is the reading that names the target first', () => {
    expect(renderGate(def, ['Put a hone counter on Test Edge for each creature target opponent controls.'], RCTX).ok).toBe(true);
    expect(renderGate(def, ['Put a number of hone counters on Test Edge equal to the number of creatures target opponent controls.'], RCTX).ok).toBe(true);
  });
  it('a count of your own creatures, or of an opponent\'s with no target, is refused (the reading from the state after the target, "... that player controls", stays as std-r10 kept it)', () => {
    expect(renderGate(def, ['Put a hone counter on Test Edge for each creature you control.'], RCTX).ok).toBe(false);
    expect(renderGate(def, ['Put a hone counter on Test Edge for each creature an opponent controls.'], RCTX).ok).toBe(false);
  });
});

// ---- statics/hone.ts: the capability ---------------------------------------------------------------------------------------------------------------------

describe('std-ra engine capability (CR 122.1, design 5.2): putting a hone counter needs counter:hone, which the layer system registers', () => {
  it('counter:hone is an engine capability and a putCounters of hone counters needs it', () => {
    expect(ENGINE_CAPABILITIES.has('counter:hone')).toBe(true);
    const def = { kind: 'spell', effect: { targets: [], steps: [{ op: 'putCounters', on: { ref: 'self' }, kind: 'hone', count: 1 }] } } as never;
    expect(capabilitiesOfDef(def)).toContain('counter:hone');
  });
});

// ---- render/qty.ts: a sacrificed count is "that much" only after a condition that does not compare that very count -----------------------------------------

describe('std-ra renderer (CR 107.3, 608.2h): "If X is three or more" after "where X is the number of permanents you\'ve sacrificed this turn"', () => {
  it('the X of the condition is the count said in full in the instruction before (render/fold.ts#whereXThenIfX)', () => {
    const f = face('Enchantment', "{T}: Put X +1/+1 counters on target creature, where X is the number of permanents you've sacrificed this turn. If X is three or more, that creature gains flying until end of turn.");
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
  });
  it('FAST5X E22 keeps its reading: "that much" after "if you sacrificed one or more permanents this turn"', () => {
    const f = face('Enchantment', 'At the beginning of your end step, if you sacrificed one or more permanents this turn, you gain that much life.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
  });
});
