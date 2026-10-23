/**
 * std-exile-play-2-2 (lane std-exile-play-2): the template data of parser/templates/zz-cloud/std-exile-play-2-2.json and the round's renderer support: a cast
 * trigger's replacement that exiles the spell's card with a counter on it as it resolves (the r4-repl replacement with a `then` that puts the counter on the card
 * it became in exile, effects/bodies/m5.ts#thenAfterMove; render/steps-lasting.ts#spellExiledAsItResolves), and "you may cast a spell from among cards you own in
 * exile with <kind> counters on them without paying its mana cost" (a choice and a free cast, render/fold.ts#castFromOwnedExileWithCounters). Guard G9 (design
 * 6.8): every example lowers with its template and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON;
 * near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10), checked against the local index when it is present. The behavior is in std-exile-play-2-2-scenarios.test.ts. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/std-exile-play-2-2.json';
import review from '../../m5/golden/cards/std-exile-play-2-2-review.json';
import { automated, card, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const TS = round as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line each template's examples are printed on. */
const TYPE: Readonly<Record<string, string>> = {
  'eff.sxp22.castSpell.exileWithCounterAsItResolves': 'Creature — Giant Wizard',
  'eff.sxp22.cast.fromExile.ownedWithCounters.free': 'Creature — Giant Wizard',
};
const face = (id: string, text: string, typeLine?: string) => {
  const type = typeLine ?? TYPE[id] ?? 'Sorcery';
  return parseCard(card('Example Relic', type, text, type.startsWith('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');

describe('std-exile-play-2-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-exile-play-2-2.json, after zz-cloud/std-eoe.json, before zz-cloud/std-fdn.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-exile-play-2-2.json');
    expect(files.indexOf('zz-cloud/std-exile-play-2-2.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-eoe.json'));
    expect(files.indexOf('zz-cloud/std-exile-play-2-2.json')).toBeLessThan(files.indexOf('zz-cloud/std-fdn.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(TS.map((t) => t.id)).toEqual(Object.keys(TYPE));
    for (const t of TS) {
      expect(t.id, t.id).toMatch(/^eff\.sxp22\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // narrow wordings (both printed on one card of the index): stable on one hand-verified golden card plus these tests and the played scenarios, a 6.9
    // deviation named in the round record
    expect(goldenUsing('eff.sxp22.castSpell.exileWithCounterAsItResolves')).toEqual(['Goliath Daydreamer']);
    expect(goldenUsing('eff.sxp22.cast.fromExile.ownedWithCounters.free')).toEqual(['Goliath Daydreamer']);
    expect(TS.filter((t) => t.status === 'stable').map((t) => t.id)).toEqual(Object.keys(TYPE));
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of TS) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'next', 'then', 'when', 'also', 'during']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-exile-play-2-2 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of TS) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.id, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(t.id, e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
      }
      for (const c of t.counterExamples) {
        const f = face(t.id, c);
        expect(understood(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bexile that card\b/, 'exile that spell'], [/\binto your graveyard\b/, 'into a graveyard'], [/\bas it resolves\b/, 'as it is countered'],
    [/\bcards you own\b/, "cards you don't own"], [/\bin exile\b/, 'in your graveyard'], [/\bwithout paying its mana cost\b/, 'paying {1} less'],
    [/\ba spell from among\b/, 'two spells from among'], [/\bcounter on it\b/, 'counter on ~'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-exile-play-2-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of TS) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(t.id, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = face(t.id, m);
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-exile-play-2-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of TS) {
    it(`${t.id}: replacing any one word of the template's sentence by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.length - 1; // the line of the template (an earlier line is the ability that exiles the cards)
        // the rider's sentence is the last one of its line (the sentences before it are the ones it modifies)
        const start = t.kind === 'rider' ? lines[last]!.lastIndexOf('. ') + 2 : 0;
        const head = lines[last]!.slice(0, start);
        const words = lines[last]!.slice(start).split(' ');
        words.forEach((w, i) => {
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any name (CR 122.1)
          if (w === '~' || w === '~.' || w === '~,') return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...lines.slice(0, last), head + [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ')].join('\n');
          expect(understood(face(t.id, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-exile-play-2-2 renderer support', () => {
  it('CR 614.1a: the plain form stays "exile that spell instead of ..." and the counter form is "exile that card with a <kind> counter on it ..."; two counters are not this form', () => {
    expect(understood(face('x', 'Whenever you cast a sorcery spell from your hand, exile that spell instead of putting it into your graveyard as it resolves.', 'Creature — Giant'))).toBe(true);
    const f = face('eff.sxp22.castSpell.exileWithCounterAsItResolves', TS[0]!.examples[0]!.text);
    expect(JSON.stringify(f.abilities)).toContain('"then":{"as":');
    expect(JSON.stringify(f.abilities)).toContain('"op":"putCounters"');
  });
  it('the free cast is of a nonland card you own in exile with a counter of that kind (a land is never cast, CR 305.9)', () => {
    const f = face('eff.sxp22.cast.fromExile.ownedWithCounters.free', TS[1]!.examples[0]!.text);
    expect(JSON.stringify(f.abilities)).toContain('"filter":{"notTypes":["Land"],"owner":"you","counters":{"kind":"moon"},"zone":"exile"}');
    expect(JSON.stringify(f.abilities)).toContain('"free":true');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-exile-play-2-2 design 6.10 (local index): synthetic examples', () => {
  it('no line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|Equipment|spell|card|Saga)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = TS.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
