/**
 * FAST5 T58: the template data of parser/templates/zz-fast5/t58.json and the front-end, anaphora and render-gate changes that finish the same cards:
 *  - "draw a card for each color among <filter>" (CR 105.1, 105.2, 121.1, 608.2h): the `distinct` colors quantity, read when the draw happens;
 *  - short names (CR 201.5c, 205.3j): a legendary card without a comma in its name is known by the planeswalker type that starts it
 *    (parser/front/selfref.ts#shortNames);
 *  - "you've cast a spell with mana value 4 or greater this turn" is the history condition "one or more such spells" (CR 601.2i; render family
 *    cast-one-or-more);
 *  - a bare pronoun after a target of the object's own enters trigger is the target (design 6.4; parser/lower/anaphora.ts#resolveAnaphor and its mirror
 *    render/refs.ts#candidateCheck).
 * Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate; every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10): no example is a line of a real card.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { lexiconIndex } from '../../../src/parser/front/lexicon-index';
import { shortNames } from '../../../src/parser/front/selfref';
import type { FaceContext } from '../../../src/parser/front/types';
import t58 from '../../../src/parser/templates/zz-fast5/t58.json';
import { automated, exampleCard, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';
import review from '../../m5/golden/cards/fast5-t58-review.json';

const T58 = t58 as Template[];
const OPTS = defaultParseOptions();
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
const parsedAs = (text: string, type: string, name = 'Example Subject') =>
  parseCard({ name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: '{1}', colors: [], keywords: [], ...(/Creature/.test(type) ? { power: '2', toughness: '2' } : {}) } as OracleCard, OPTS).faces[0]!;

describe('T58 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5/t58.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t58.json');
    expect([...files].sort()).toEqual(files);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    for (const t of T58) {
      expect(t.id, t.id).toMatch(/^eff\.t58\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable T58 template has its evidence: three hand-verified golden cards among the cards of the corpus whose parse uses it', () => {
    const golden = review as { card: string; verified: string }[];
    // the only cards of the local index whose parse uses it (whole-index snapshot diff and npm run cards -- try); Mondo Gecko was checked with try too,
    // but its other ability is partial, so it has no golden entry
    const WHOLE_CORPUS: Record<string, string[]> = {
      'eff.t58.draw.foreach.color.among': ['Karn, Gilded Guardian', 'Chromatic Orrery', 'Soul of Ravnica', 'Mondo Gecko'],
    };
    for (const t of T58.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
      for (const c of cards) expect(WHOLE_CORPUS[t.id], `${t.id}: ${c}`).toContain(c);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T58) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('T58 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T58) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const head = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(t, c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(head.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} until end of turn.`];
  const swaps: [RegExp, string][] = [[/\bcolor\b/, 'card type'], [/\bdraw\b/i, 'Discard'], [/\ba card\b/, 'two cards'], [/\byou control\b/, 'an opponent controls']];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('T58 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T58) {
    it(`${t.id}: an appended "unless/instead/at random/twice/until end of turn" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(t, m);
          expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('T58 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T58) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w)) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('T58 design 6.10: examples are synthetic', () => {
  it('no example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|Equipment|Vehicle)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = T58.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

describe('CR 201.5c, 205.3j: short names of legendary cards (parser/front/selfref.ts#shortNames)', () => {
  const ix = lexiconIndex();
  const ctx = (name: string, type: string): FaceContext => {
    const [left, right] = type.split(' — ');
    const words = left!.split(' ');
    return {
      name, otherNames: [], isToken: false,
      supertypes: words.filter((w) => w === 'Legendary').map((w) => w.toLowerCase()),
      types: words.filter((w) => w !== 'Legendary').map((w) => w.toLowerCase()),
      subtypes: (right ?? '').split(' ').filter(Boolean).map((w) => w.toLowerCase()),
    } as unknown as FaceContext;
  };
  it('a planeswalker type before " of " / " the " or as the first word of a legendary card is its short name', () => {
    expect(shortNames(ctx('Kiora of Fire and Ashes', 'Legendary Creature — Merfolk Noble'), ix)).toContain('Kiora');
    expect(shortNames(ctx('Gideon the Oathless', 'Legendary Creature — Human Mercenary'), ix)).toContain('Gideon');
  });
  it('not on a card that is not legendary (CR 201.5c: only a legendary card or a planeswalker uses a short name)', () => {
    expect(shortNames(ctx('Kiora of Fire and Ashes', 'Creature — Merfolk Noble'), ix)).not.toContain('Kiora');
  });
  it('a creature type that starts a name without a comma stays a type ("Sliver Queen" is about Slivers)', () => {
    expect(shortNames(ctx('Sliver Overseer', 'Legendary Creature — Sliver'), ix)).not.toContain('Sliver');
  });
  it('a planeswalker keeps its own planeswalker type as its short name (unchanged)', () => {
    expect(shortNames(ctx('Ajani Vengeant', 'Legendary Planeswalker — Ajani'), ix)).toContain('Ajani');
  });
});

describe('render gate (G6): what the T58 cards needed', () => {
  it('CR 601.2i: "you\'ve cast a spell with mana value 4 or greater this turn" reads as one or more such spells (family cast-one-or-more)', () => {
    const f = parsedAs("Whenever ~ attacks, if you've cast a spell with mana value 5 or greater this turn, you gain 2 life.", 'Creature — Ox');
    expect(fullyAutomated(f)).toBe(true);
    expect(f.abilities[0]).toMatchObject({ interveningIf: { cond: 'happened', event: { ev: 'cast', player: 'you', spell: { manaValue: { op: '>=', value: 5 } } }, scope: 'turn', times: { op: '>=', value: 1 } } });
  });
  it('CR 601.2i: an unfiltered "you\'ve cast a spell this turn" keeps its own wording, and "two or more spells" is no reading of "a spell"', () => {
    expect(fullyAutomated(parsedAs("Whenever ~ attacks, if you've cast a spell this turn, you gain 2 life.", 'Creature — Ox'))).toBe(true);
    const two = parsedAs("Whenever ~ attacks, if you've cast two or more spells with mana value 5 or greater this turn, you gain 2 life.", 'Creature — Ox');
    const one = parsedAs("Whenever ~ attacks, if you've cast a spell with mana value 5 or greater this turn, you gain 2 life.", 'Creature — Ox');
    expect(jsonKey(two.abilities)).not.toBe(jsonKey(one.abilities));
  });
});

describe('design 6.4: a bare pronoun after a target of the object\'s own enters trigger', () => {
  it('is the target ("tap target artifact an opponent controls. Put a stun counter on it")', () => {
    const f = parsedAs('When this creature enters, tap target artifact an opponent controls. Put a stun counter on it.', 'Creature — Elf');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities[0])).toContain('"op":"putCounters","on":{"ref":"target","id":"t0"}');
  });
  it('before the target phrase it is still the object itself ("attach it to target creature you control", CR 301.5)', () => {
    const f = parsedAs('When this Equipment enters, attach it to target creature you control.', 'Artifact — Equipment');
    expect(JSON.stringify(f.abilities[0])).toContain('"op":"attach","what":{"ref":"self"}');
  });
  it('after a target PLAYER it is still the object itself (a player is no antecedent of "it")', () => {
    const f = parsedAs('When this creature enters, target opponent loses 2 life. Put a +1/+1 counter on it.', 'Creature — Elf');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities[0])).toContain('"op":"putCounters","on":{"ref":"self"}');
  });
  it('outside an enters trigger: "whenever ~ attacks, tap target creature. Put a stun counter on it" is decided by the focus rule of FAST5 T76 (model/focus.ts): the target the instruction before it tapped', () => {
    const after = parsedAs('Whenever this creature attacks, tap target creature defending player controls. Put a stun counter on it.', 'Creature — Elf');
    // the attacking creature has not left: "it" may be the object itself or the target (design 6.4); the previous sentence ended with an instruction on the target, so it is the focus
    expect(fullyAutomated(after)).toBe(true);
    expect(JSON.stringify(after.abilities[0])).toContain('"op":"putCounters","on":{"ref":"target","id":"t0"}');
    expect(JSON.stringify(after.abilities[0])).not.toContain('"on":{"ref":"self"}');
  });
});
