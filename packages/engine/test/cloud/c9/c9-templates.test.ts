/**
 * Cloud batch 3, row C9: an "instead" sentence that replaces another instruction or a whole sentence of several (render/self-replacement.ts#notWideReplacement,
 * the fold of parser/lower/riders.ts), the template data of parser/templates/zz-cloud/c9.json and the one search for a card of each of two descriptions
 * (`search.and`). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does
 * not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card
 * (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in c9-scenarios.test.ts.
 *
 * The readings (each test is named after the rule it pins; CR numbers from memory, the rules folder is not in this checkout):
 *   CR 608.2c, 614.15   one instruction replaced by ANOTHER instruction on exactly the same objects; a search by a search; several instructions on the same objects;
 *                       a sentence of several instructions by a sentence that restates it op for op
 *   CR 601.2c           no new target under a condition decided as the ability resolves
 *   CR 608.2d           a "may" on either side stays manual (WP23)
 *   CR 614.15           a subset of a group, some layers of an effect, instructions on players only, a sentence not restated op for op: manual
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, EffectStep, OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { capabilitiesOfDef } from '../../../src/model/cap-walk';
import { notWideReplacement } from '../../../src/render/self-replacement';
import c9 from '../../../src/parser/templates/zz-cloud/c9.json';
import review from '../../m5/golden/cards/cloud-c9-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';
import { accepts, bound, draw, rejects, spell, t, objTarget, you } from '../../m5/render/build';

const C9 = c9 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a triggered or activated ability on a creature. */
function exampleCard(_t: Template, text: string): OracleCard {
  if (!text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (tp: Template, text: string) => parseCard(exampleCard(tp, text), OPTS).faces[0]!;
const parse = (type: string, text: string) => parseCard(card('Example Volley', type, text, type.startsWith('Creature') ? { power: '2', toughness: '2' } : {}), OPTS).faces[0]!;
const stepsOf = (f: ReturnType<typeof parse>, i = 0): EffectStep[] => (f.abilities[i] as { effect: { steps: EffectStep[] } }).effect.steps;

describe('c9 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/c9.json, after trigger.json, before the other zz-cloud files and zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/c9.json');
    expect(files.indexOf('zz-cloud/c9.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/c9.json')).toBeLessThan(files.indexOf('zz-cloud/std-hob.json'));
    expect(files.indexOf('zz-cloud/c9.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.c9.*', () => {
    expect(C9.length).toBe(3);
    for (const x of C9) {
      expect(x.id, x.id).toMatch(/^eff\.c9\./);
      expect(x.cr.length, x.id).toBeGreaterThan(0);
      for (const cr of x.cr) expect(cr, x.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(x.examples.length, x.id).toBeGreaterThanOrEqual(2);
      expect(x.counterExamples.length, x.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], x.id).toContain(x.status);
      expect(x.since, x.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: at least one hand-verified golden card that uses it (the review file pins each card as full)', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const x of C9.filter((y) => y.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${x.id}`) || g.verified.includes(` ${x.id}`) || g.verified.includes(`${x.id},`) || g.verified.includes(`${x.id})`));
      expect(cards.length, x.id).toBeGreaterThanOrEqual(1);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const x of C9) {
      const words = x.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then']) {
        if (words.includes(w)) expect(x.consumes ?? [], `${x.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('c9 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const x of C9) {
    it(`${x.id} (${x.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(x, x.examples[0]!.text);
      for (const e of x.examples) {
        const f = parsedWith(x, e.text);
        expect(f.templatesUsed.includes(x.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of x.counterExamples) {
        const f = parsedWith(x, c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [[/\byour library\b/, 'your graveyard'], [/\binto your hand\b/, 'onto the battlefield'], [/\btapped\b/, 'untapped'], [/\bany card\b/, 'any two cards'], [/\band an\b/, 'or an']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('c9 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const x of C9) {
    it(`${x.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
      for (const e of x.examples) {
        const orig = parsedWith(x, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(x, m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('c9 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const x of C9) {
    it(`${x.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of x.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          const end = w.match(/[.,]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(x, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('CR 608.2c, 614.15: "instead" replaces another instruction only when it acts on exactly the same objects', () => {
  it('CR 614.15: "All creatures get -1/-1 until end of turn. If you gained life this turn, destroy all creatures instead." folds the destroy over the effect', () => {
    const f = parse('Sorcery', 'All creatures get -1/-1 until end of turn. If you gained life this turn, destroy all creatures instead.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    const [s] = stepsOf(f) as unknown as [{ op: string; then: EffectStep[]; else: EffectStep[] }];
    expect(s.op).toBe('if');
    expect(s.then.map((x) => x.op)).toEqual(['destroy']);
    expect(s.else.map((x) => x.op)).toEqual(['effect']);
  });
  it('CR 614.15: the same with "instead" first ("If it\'s tapped, instead put two +1/+1 counters on it") and last ("Put a +1/+1 counter on it instead if ...")', () => {
    expect(fullyAutomated(parse('Instant', "Target creature gets +2/+2 until end of turn. If it's tapped, instead put two +1/+1 counters on it."))).toBe(true);
    expect(fullyAutomated(parse('Instant', "Target creature gets +1/+1 until end of turn. Put a +1/+1 counter on it instead if it's a Knight."))).toBe(true);
  });
  it('CR 400.7, 701.8a: "Destroy target creature. If that creature is a Goblin, exile it instead.": the exile moves the target, not the card the destroy would move', () => {
    const f = parse('Instant', 'Destroy target creature. If that creature is a Goblin, exile it instead.');
    expect(fullyAutomated(f)).toBe(true);
    const [s] = stepsOf(f) as unknown as [{ then: { what: unknown }[] }];
    expect(s.then[0]!.what).toEqual({ ref: 'target', id: 't0' });
  });
  it('CR 601.2c: another instruction with a NEW target under a condition decided on resolution stays manual', () => {
    expect(fullyAutomated(parse('Instant', 'Target creature gets +2/+2 until end of turn. If you control a Wizard, destroy target artifact instead.'))).toBe(false);
  });
  it('CR 614.15: another instruction on other objects stays manual ("~ gets +2/+2 ... If ~ is an Aura, enchanted creature gets +2/+2 ... instead" is not read as this rule)', () => {
    expect(fullyAutomated(parse('Instant', 'Target creature gets +2/+2 until end of turn. If you control a Wizard, destroy all artifacts instead.'))).toBe(false);
  });
  it('WP23 review (kept): instructions on players only ("You gain 2 life. If ..., draw two cards instead.") and a subset of a group stay manual', () => {
    expect(fullyAutomated(parse('Instant', 'You gain 2 life. If you control a Forest, draw two cards instead.'))).toBe(false);
    expect(fullyAutomated(parse('Instant', 'Each player draws a card. If you control an Elf, you draw two cards instead.'))).toBe(false);
  });
  it('CR 608.2d (kept): a "may" on either side stays manual', () => {
    expect(fullyAutomated(parse('Instant', 'Destroy target creature. If you control a Wizard, you may exile it instead.'))).toBe(false);
  });
  it('CR 613.1, 614.15: a continuous effect that changes FEWER layers replaces only part of the effect and stays manual; one that changes every layer and more is a whole replacement', () => {
    expect(fullyAutomated(parse('Instant', 'Target creature gets +2/+2 and gains flying until end of turn. If you control a Wizard, it gets +4/+4 until end of turn instead.'))).toBe(false);
    expect(fullyAutomated(parse('Instant', 'Target creature gets +1/+1 until end of turn. If you control a Wizard, it gets +2/+2 and gains flying until end of turn instead.'))).toBe(true);
  });
});

describe('CR 608.2c, 701.23: a search replaced by a search', () => {
  it('CR 701.23b: "Search your library for a Forest card. If you control a Wizard, instead search your library for an artifact card. Reveal that card, ..." is one search in either branch, then the reveal', () => {
    const f = parse('Sorcery', 'Search your library for a Forest card. If you control a Wizard, instead search your library for an artifact card. Reveal that card, put it into your hand, then shuffle.');
    expect(fullyAutomated(f)).toBe(true);
    expect(stepsOf(f).map((x) => x.op)).toEqual(['if', 'reveal', 'move', 'shuffle']);
  });
  it('CR 701.23a: a search for a Forest card replaced by a search for two descriptions: "those cards" names what either branch found', () => {
    const f = parse('Sorcery', 'Kicker {1}\nSearch your library for a Forest card. If this spell was kicked, instead search your library for a Forest card and an Island card. Reveal those cards, put them into your hand, then shuffle.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
  });
});

describe('CR 608.2c, 614.15: several instructions', () => {
  it('CR 614.15: one instruction replaced by several, each on the same object ("instead put a +1/+1 counter on it and it gets +1/+1 until end of turn")', () => {
    const f = parse('Instant', 'Target creature gets +2/+2 until end of turn. If you control a Wizard, instead put a +1/+1 counter on it and it gets +1/+1 until end of turn.');
    expect(fullyAutomated(f)).toBe(true);
    const [s] = stepsOf(f) as unknown as [{ then: EffectStep[]; else: EffectStep[] }];
    expect(s.then.map((x) => x.op)).toEqual(['putCounters', 'effect']);
  });
  it('CR 614.15: one instruction replaced by several where one acts on something else (a player) stays manual under a condition decided on resolution', () => {
    expect(fullyAutomated(parse('Instant', 'Target creature gets +2/+2 until end of turn. If you control a Wizard, instead put a +1/+1 counter on it and you draw a card.'))).toBe(false);
  });
  it('CR 608.2c: a sentence of several instructions restated op for op is replaced as a whole ("Target player draws two cards, then discards a card. If ..., instead that player draws three cards, then discards two cards.")', () => {
    const f = parse('Instant', 'Target player draws two cards, then discards a card. If you control a Wizard, instead that player draws three cards, then discards two cards.');
    expect(fullyAutomated(f)).toBe(true);
    const steps = stepsOf(f) as { op: string; then?: EffectStep[]; else?: EffectStep[] }[];
    expect(steps).toHaveLength(1);
    expect(steps[0]!.then!.map((x) => x.op)).toEqual(['draw', 'discard']);
    expect(steps[0]!.else!.map((x) => x.op)).toEqual(['draw', 'discard']);
  });
  it('CR 608.2c: the restated sentence\'s "put it" names its own search, not the card the replaced sentence put into the hand', () => {
    const f = parse('Sorcery', 'Search your library for a Goblin card, reveal it, put it into your hand, then shuffle. If you control an Elf, instead search your library for any card, put it into your hand, then shuffle.');
    expect(fullyAutomated(f)).toBe(true);
    const [s] = stepsOf(f) as unknown as [{ then: { op: string; what?: unknown; as?: string }[] }];
    expect(s.then[1]).toMatchObject({ op: 'move', what: { ref: 'bound', name: s.then[0]!.as } });
  });
  it('CR 614.15: after a sentence of several instructions, one instruction (which part it replaces is not said) stays manual', () => {
    expect(fullyAutomated(parse('Sorcery', 'Search your library for a Goblin card, reveal it, put it into your hand, then shuffle. If you control an Elf, instead search your library for any card.'))).toBe(false);
    expect(fullyAutomated(parse('Instant', 'Draw a card and target player draws a card. If you control an Elf, draw three cards instead.'))).toBe(false);
  });
  it('CR 614.15: a sentence of several instructions that is not restated op for op stays manual', () => {
    expect(fullyAutomated(parse('Instant', 'Draw two cards, then discard a card. If you control a Wizard, instead discard a card, then draw three cards.'))).toBe(false);
  });
});

describe('CR 608.2c, 701.19c: a rider right after an "instead" sentence modifies that sentence\'s instruction', () => {
  it('"... If you control a Swamp, instead destroy that creature. It can\'t be regenerated." puts the rider on the destroy of the instead branch', () => {
    const f = parse('Instant', "Target creature gets -1/-1 until end of turn. If you control a Swamp, instead destroy that creature. It can't be regenerated.");
    expect(fullyAutomated(f)).toBe(true);
    const [s] = stepsOf(f) as unknown as [{ then: Record<string, unknown>[] }];
    expect(s.then[0]).toMatchObject({ op: 'destroy', regeneration: 'cant' });
  });
  it('a rider whose op is not the last instruction of the instead branch stays manual (never put on the replaced instruction)', () => {
    expect(fullyAutomated(parse('Instant', "Destroy target creature. If you control a Swamp, instead exile that creature. It can't be regenerated."))).toBe(false);
  });
});

describe('render gate (G6): the wide "instead" readings are offered only for the shapes the parser folds (render/self-replacement.ts#notWideReplacement)', () => {
  const swamp = { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Swamp'], controller: 'you' } } };
  const shrink = { op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: t('a'), mods: [{ layer: '7c', power: -1, toughness: -1 }] }] } as EffectStep;
  it('CR 614.15: `if C then [destroy it] else [it gets -1/-1]` reads "Y. If C, X instead." and "Y. If C, instead X."', () => {
    const def = spell([{ op: 'if', cond: swamp, then: [{ op: 'destroy', what: t('a') } as EffectStep], else: [shrink] } as EffectStep], [objTarget('a')]);
    accepts(def, 'Target creature gets -1/-1 until end of turn. If you control a Swamp, destroy that creature instead.');
    accepts(def, 'Target creature gets -1/-1 until end of turn. If you control a Swamp, instead destroy that creature.');
  });
  it('CR 601.2c: with another target in X the instead reading is refused (only "If C, X. Otherwise, Y.")', () => {
    const def = spell([{ op: 'if', cond: swamp, then: [{ op: 'destroy', what: t('b') } as EffectStep], else: [shrink] } as EffectStep], [objTarget('a'), objTarget('b', { types: ['Artifact'] })]);
    rejects(def, 'Target creature gets -1/-1 until end of turn. If you control a Swamp, destroy target artifact instead.');
  });
  it('CR 614.15: a sentence of two instructions is read with "instead" only when X restates both', () => {
    const def = spell([{ op: 'if', cond: swamp, then: [draw(3), { op: 'discard', who: you, count: 2 } as EffectStep], else: [draw(2), { op: 'discard', who: you, count: 1 } as EffectStep] } as EffectStep]);
    accepts(def, 'Draw two cards, then discard a card. If you control a Swamp, instead draw three cards, then discard two cards.');
    const partial = spell([{ op: 'if', cond: swamp, then: [draw(3)], else: [draw(2), { op: 'discard', who: you, count: 1 } as EffectStep] } as EffectStep]);
    rejects(partial, 'Draw two cards, then discard a card. If you control a Swamp, instead draw three cards.');
  });
  it('the predicate itself: the WP23 refusals still hold, and a search for a search of another player is refused', () => {
    const search = (who: unknown, filter: unknown) => ({ op: 'search', who, zone: 'library', filter, max: 1, as: 's' });
    expect(notWideReplacement([draw(1)], [{ op: 'gainLife', who: you, amount: 2 }], swamp)).not.toBeNull();
    expect(notWideReplacement([search(you, { subtypes: ['Forest'] })], [search(you, { types: ['Artifact'] })], swamp)).toBeNull();
    expect(notWideReplacement([search(you, { subtypes: ['Forest'] })], [search({ ref: 'opponent' }, { types: ['Artifact'] })], swamp)).not.toBeNull();
    expect(notWideReplacement([{ op: 'move', what: bound('x'), to: { zone: 'hand' } }], [{ op: 'may', who: you, do: [] }], swamp)).not.toBeNull();
  });
});

describe('CR 701.23a: a search for a card of each of two descriptions (`search.and`) needs its own capability', () => {
  it('the step names op:search.and, so an engine without it degrades the ability instead of running half of it (design 5.2)', () => {
    const f = parse('Sorcery', 'Search your library for a Swamp card and an Island card, put them into your hand, then shuffle.');
    expect(fullyAutomated(f)).toBe(true);
    expect(capabilitiesOfDef(f.abilities[0] as AbilityDef)).toContain('op:search.and');
    expect(ENGINE_CAPABILITIES.has('op:search.and')).toBe(true);
  });
  it('the render gate never reads `and` with a count or several cards per description', () => {
    const def = spell([{ op: 'search', who: you, zone: 'library', filter: { subtypes: ['Swamp'] }, min: 0, max: 2, and: [{ subtypes: ['Island'] }], as: 's' } as EffectStep]);
    rejects(def, 'Search your library for up to two Swamp cards and an Island card.');
  });
});

const index = localIndex();

describe.skipIf(index === null)('c9 design 6.10 (local index): synthetic examples', () => {
  it('no c9 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = C9.flatMap((x) => [...x.examples.map((e) => e.text), ...x.counterExamples].filter((y) => y.split('\n').some((l) => lines.has(l.trim()))).map((y) => `${x.id}: ${y}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
