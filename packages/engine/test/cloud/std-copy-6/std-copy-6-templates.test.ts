/**
 * std-copy-6 (lane std-copy): the template data of parser/templates/zz-cloud/std-copy-6.json ("copy it, then exile the spell you cast with N time counters on it.
 * If it doesn't have suspend, it gains suspend."; the trigger "Whenever a <creature> attacking causes a triggered ability of that creature to trigger"), and the
 * round's parser and renderer changes: the sentence join parser/lower/ability.ts#joinGainsSuspend, the fold render/fold-stdcopy6.ts, the event `abilityTriggered`
 * (render/evt.ts, render/refs.ts, parser/lower/scope.ts: "that ability"), and "that ability" left out of the focus rule's reference count (lower/anaphora.ts).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-copy-6-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { keywordRegistry } from '../../../src/keywords/registry';
import stdCopy6 from '../../../src/parser/templates/zz-cloud/std-copy-6.json';
import review from '../../m5/golden/cards/cloud-std-copy-6-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdCopy6 as Template[];
const MECH_COUNT = 2;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because the index prints
 * the wording on one card only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'eff.stdcopy6.copy.thenExileSpellCast.timeCounters.gainsSuspend': 'Taigam, Master Opportunist',
  'trg.stdcopy6.attackingCausesTrigger': 'Firebender Ascension',
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Codex', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const parsedWith = (_t: Template, text: string) => face(text.startsWith('Whenever a') ? 'Enchantment' : 'Legendary Creature — Human Monk', text, text.startsWith('Whenever a') ? undefined : ['2', '2']);
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');

describe('std-copy-6 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-copy-6.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-copy-6.json');
    expect(files.indexOf('zz-cloud/std-copy-6.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-copy-6.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdcopy6.* or trg.stdcopy6.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|trg)\.stdcopy6\./);
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

describe('std-copy-6 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const swaps: [RegExp, string][] = [[/time counters/, 'stun counters'], [/the spell you cast/, 'that spell'], [/gains suspend/, 'gains flash'], [/attacking causes/, 'blocking causes'], [/that creature to trigger/, 'a creature to trigger'], [/doesn't have/, 'has']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-copy-6 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('std-copy-6 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('std-copy-6 design 6.10 (local index): synthetic examples', () => {
  it('no std-copy-6 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

// ---- keyword data, the sentence join, the event "that ability" -------------------------------------------------------------------------------------------

describe('std-copy-6 keyword data (CR 702.62a-b): suspend may be granted without a number and a cost', () => {
  it('both parameters are optional (the special action still needs both: core/special/suspend.ts#suspendTermsOf)', () => {
    const d = keywordRegistry.get('suspend')!;
    expect(d.params.every((p) => p.optional === true)).toBe(true);
  });
});

describe('std-copy-6 parser (CR 707.10, 702.62a, 608.2c): the exile-and-suspend sentences', () => {
  it('without "If it doesn\'t have suspend, it gains suspend." the copy-and-exile sentence is not read (fail closed: no template of its own)', () => {
    expect(fullFace(face('Legendary Creature — Human Monk', 'Whenever you cast your second spell each turn, copy it, then exile the spell you cast with four time counters on it.', ['2', '2']))).toBe(false);
  });
  it('the condition and the grant both name the card the exile made (the binding "exiled"), not the spell', () => {
    const f = face('Legendary Creature — Human Monk', "Whenever you cast your second spell each turn, copy it, then exile the spell you cast with four time counters on it. If it doesn't have suspend, it gains suspend.", ['2', '2']);
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"cond":{"cond":"not","of":{"cond":"matches","object":{"ref":"bound","name":"exiled"},"filter":{"keyword":"suspend"}}}');
  });
});

describe('std-copy-6 parser (CR 603.2, 707.10): "copy that ability" of the abilityTriggered event', () => {
  it('"that ability" is the triggered ability of the event (role spell); "it" is the enchantment the sentence before put a counter on (the focus rule)', () => {
    const f = face('Enchantment', 'Whenever a creature you control attacking causes a triggered ability of that creature to trigger, put a quest counter on this enchantment. Then if it has three or more quest counters on it, you may copy that ability.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"object":{"ref":"self"},"filter":{"counters":{"kind":"quest"');
    expect(JSON.stringify(f.abilities)).toContain('"what":{"ref":"event","role":"spell"}');
  });
  it('"that ability" after another trigger (no ability in its event) has no antecedent (fail closed)', () => {
    expect(fullFace(face('Enchantment', 'Whenever a creature you control attacks, you may copy that ability.'))).toBe(false);
  });
});
