/**
 * FAST4 T34: the template data of parser/templates/zz-fast4/t34.json (one-shot player effects: punisher choices, life lost and spell-count quantities, divided
 * damage, wheels, "if it was ..." riders) and the parser and renderer readings the package's shapes needed (design 6.8 G6): the past tense of a condition on
 * what an instruction acted on (parser/holes/cond.ts#pastTense, render/cond.ts#pastPredicates), "it's a land card" (a known object needs no zone), the hole
 * `OtherTargets` ("each of up to two other targets"), "one, two, or three target", "any target that isn't a Dragon", the quantities `lifeLostThisTurn` and
 * `colorsSpent`, the folds of render/fold.ts (wheel, put on the bottom then draw, each opponent draws then you draw, draw and lose X life), the "unless they
 * ..." readings of render/steps-flow.ts. Guard G9 (design 6.8): every example lowers with its template, is fully automated (experimental templates cap the
 * card, not the ability) and passes the exact render gate; every counter-example does not parse or parses to different JSON; near-miss mutations fail or
 * differ; a nonsense word in place of any word of an example never leaves an automated ability (G2). Examples are synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import t34 from '../../../src/parser/templates/zz-fast4/t34.json';
import { automated, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T34 = t34 as Template[];
const OPTS = defaultParseOptions();

/** A trigger or an activated ability is a creature's; anything else is a sorcery (the coverage harness tries the same type lines, cards/coverage/mutation.ts). */
function exampleCard(text: string, type?: string): OracleCard {
  const permanent = /^(When|Whenever|At)\b/.test(text) || /^[^"]*:/.test(text);
  const typeLine = type ?? (permanent ? 'Creature — Human' : 'Sorcery');
  return {
    name: 'Example Subject', layout: 'normal', type_line: typeLine, oracle_text: text.replace(/~/g, 'Example Subject'), mana_cost: '{1}',
    colors: [], keywords: [], ...(/Creature/.test(typeLine) ? { power: '2', toughness: '2' } : {}),
  } as OracleCard;
}
const parsed = (text: string, type?: string) => parseCard(exampleCard(text, type), OPTS).faces[0]!;
const steps = (text: string, type?: string): unknown => {
  const a = parsed(text, type).abilities.find((x) => x.kind !== 'keyword') as unknown as { effect?: { steps: unknown[] } };
  return a.effect?.steps;
};
const full = (text: string, type?: string): boolean => fullyAutomated(parsed(text, type));

describe('T34 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast4/t34.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast4/t34.json');
    expect(files.indexOf('zz-fast4/t34.json')).toBeGreaterThan(files.indexOf('zz-fast4/t30.json'));
    expect(files.indexOf('zz-fast4/t34.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 7 (FAST4)', () => {
    expect(T34.length).toBe(19);
    for (const t of T34) {
      expect(t.kind, t.id).toBe('effect');
      expect(t.id, t.id).toMatch(/^eff\.t34\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(7);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T34) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'chosen', "can't", 'double', 'twice']) if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
    }
  });
});

describe('T34 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T34) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsed(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsed(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
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

describe('T34 lowering: what the shapes mean', () => {
  const ev = { ref: 'event', role: 'player' };
  it('CR 118.12a: "unless they sacrifice a creature of their choice" is a payment the damaged player is offered first; the damage is its `else`', () => {
    expect(steps("At the beginning of each opponent's upkeep, ~ deals 3 damage to that player unless they sacrifice a creature of their choice.")).toEqual([
      { op: 'pay', who: ev, cost: { other: [{ kind: 'sacrifice', filter: { types: ['Creature'] }, count: 1 }] }, else: [{ op: 'damage', source: { ref: 'self' }, to: ev, amount: 3 }] },
    ]);
  });
  it('CR 118.12a: "unless they sacrifice ... or discard a card" offers the sacrifice, then the discard, and only then the loss of life', () => {
    const t = { ref: 'target', id: 't0' };
    expect(steps('When ~ enters, target opponent loses 2 life unless they sacrifice a nonland permanent of their choice or discard a card.')).toEqual([
      { op: 'pay', who: t, cost: { other: [{ kind: 'sacrifice', filter: { notTypes: ['Land'] }, count: 1 }] }, else: [
        { op: 'pay', who: t, cost: { other: [{ kind: 'discard', count: 1 }] }, else: [{ op: 'loseLife', who: t, amount: 2 }] },
      ] },
    ]);
  });
  it('CR 118.12a, 608.2d: "unless that creature\'s controller has ~ deal 5 damage to them" is that player\'s choice; declining deals the first damage', () => {
    const t = { ref: 'target', id: 't0' };
    const ctl = { ref: 'controllerOf', object: t };
    expect(steps("~ deals 3 damage to target creature unless that creature's controller has ~ deal 5 damage to them.", 'Instant')).toEqual([
      { op: 'may', who: ctl, do: [{ op: 'damage', source: { ref: 'self' }, to: ctl, amount: 5 }], otherwise: [{ op: 'damage', source: { ref: 'self' }, to: t, amount: 3 }] },
    ]);
  });
  it('CR 119.3: "each opponent loses life equal to the life they lost this turn" is each opponent in turn, with their own amount', () => {
    const b = { ref: 'bound', name: 'each' };
    expect(steps('At the beginning of your upkeep, each opponent loses life equal to the life they lost this turn.')).toEqual([
      { op: 'forEach', over: { ref: 'each', who: 'opponent' }, as: 'each', do: [{ op: 'loseLife', who: b, amount: { q: 'lifeLostThisTurn', of: b } }] },
    ]);
  });
  it('CR 601.2i: "the number of noncreature spells they\'ve cast this turn" counts the casts of that player only (copies are not cast, CR 707.10)', () => {
    expect(steps("Whenever a player casts a noncreature spell, ~ deals damage to that player equal to the number of noncreature spells they've cast this turn.")).toEqual([
      { op: 'damage', source: { ref: 'self' }, to: ev, amount: { q: 'happenedCount', event: { ev: 'cast', spell: { notTypes: ['Creature'] } }, scope: 'turn', by: ev } },
    ]);
  });
  it('CR 601.2h: converge is `colorsSpent`, substituted for X in both instructions', () => {
    expect(steps('You draw X cards and lose X life, where X is the number of colors of mana spent to cast ~.')).toEqual([
      { op: 'draw', who: { ref: 'you' }, count: { q: 'colorsSpent' } }, { op: 'loseLife', who: { ref: 'you' }, amount: { q: 'colorsSpent' } },
    ]);
  });
  it('CR 115.3: "each of up to two other targets" is one spec of up to two any targets, other than the first', () => {
    const f = parsed('Whenever ~ attacks, ~ deals 3 damage to any target and 2 damage to each of up to two other targets.');
    const a = f.abilities[0] as unknown as { effect: { targets: unknown[]; steps: unknown[] } };
    expect(a.effect.targets).toMatchObject([{ id: 't0', kind: 'anyTarget', min: 1, max: 1 }, { id: 't1', kind: 'anyTarget', min: 0, max: 2, distinctFrom: ['t0'] }]);
    expect(a.effect.steps).toEqual([{ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 3, also: [{ to: { ref: 'target', id: 't1' }, amount: 2 }] }]);
  });
  it('CR 401.4, 608.2c: "put any number of cards from your hand on the bottom of your library, then draw that many cards plus one"', () => {
    expect(steps('Put any number of cards from your hand on the bottom of your library, then draw that many cards plus two.')).toEqual([
      { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { zone: 'hand', owner: 'you' } }, min: 0, max: 'any', as: 'put' },
      { op: 'move', what: { ref: 'bound', name: 'put' }, to: { zone: 'library', position: 'bottom' }, as: 'moved' },
      { op: 'draw', who: { ref: 'you' }, count: { q: 'math', op: '+', args: [{ q: 'resultCount', step: 'moved' }, 2] } },
    ]);
  });
  it('CR 608.2c: "if a creature died this turn, you gain 2 life, surveil 2, then investigate": the condition covers the whole sentence (one reading, G5)', () => {
    const s = steps('Draw a card. If a creature died this turn, you gain 3 life, surveil 1, then investigate.') as { op: string; then?: unknown[] }[];
    expect(s[1]!.op).toBe('if');
    expect(s[1]!.then).toHaveLength(3);
  });
});

describe('T34 condition readings (parser/holes/cond.ts#pastTense, CR 608.2h)', () => {
  const t0 = { ref: 'target', id: 't0' };
  const cond = (text: string): unknown => (steps(text, 'Instant') as { cond?: unknown }[])[1]!.cond;
  it('"if it was tapped", "if it had mana value 3 or less", "if it was dealt damage this turn", "if that permanent was a legendary enchantment"', () => {
    expect(cond('Return target creature to its owner\'s hand. If it was tapped, create a Treasure token.')).toEqual({ cond: 'matches', object: t0, filter: { tapped: true } });
    expect(cond('Exile target creature. If it had mana value 2 or less, surveil 1.')).toEqual({ cond: 'matches', object: t0, filter: { manaValue: { op: '<=', value: 2 } } });
    expect(cond('Exile target creature. If it was dealt damage this turn, draw a card.')).toEqual({ cond: 'matches', object: t0, filter: { dealtDamageThisTurn: true } });
    expect(cond('Destroy target artifact or enchantment. If that permanent was a legendary enchantment, draw a card.')).toEqual({ cond: 'matches', object: t0, filter: { supertypes: ['Legendary'], types: ['Enchantment'] } });
  });
  it('"if it wasn\'t attacking" (CR 506.4: the last known information keeps the combat status) and "if it was a permanent card"', () => {
    expect(cond("Destroy target creature. If it wasn't attacking, its controller draws a card.")).toEqual({ cond: 'not', of: { cond: 'matches', object: t0, filter: { attacking: true } } });
    expect(cond('Exile target card from a graveyard. If it was a permanent card, draw a card.')).toEqual({ cond: 'matches', object: t0, filter: { types: ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'], isCard: true } });
  });
  it('"if it\'s a land card": a card noun about a known object needs no zone (it is tested, never searched for)', () => {
    expect(full("{T}: Exile the top card of target player's library. If it's a land card, you gain 1 life.")).toBe(true);
    expect(full('{1}: Target player exiles a card from their graveyard. If it was a creature card, you gain 2 life.')).toBe(true);
  });
  it('the past tense is not offered for the object itself, nor for a status that last known information does not keep', () => {
    expect(full('Exile target creature. If it was monstrous, draw a card.', 'Instant')).toBe(false);
    expect(full('Exile target creature. If it was blorfty, draw a card.', 'Instant')).toBe(false);
  });
});

describe('T34 renderer readings (design 6.8 G6) that make existing templates gate', () => {
  it('"divided as you choose among one, two, or three target attacking or blocking creatures" (CR 601.2c, 601.2d)', () => {
    expect(full('~ deals 4 damage divided as you choose among one, two, or three target attacking or blocking creatures.', 'Instant')).toBe(true);
  });
  it('"it deals that much damage to any target that isn\'t a Dragon" (CR 115.4): the one filter an any-target spec may have', () => {
    const f = parsed("Whenever a Dragon you control is dealt damage, it deals that much damage to any target that isn't a Dragon.");
    expect(fullyAutomated(f)).toBe(true);
    const a = f.abilities[0] as unknown as { effect: { targets: unknown[] } };
    expect(a.effect.targets).toMatchObject([{ id: 't0', kind: 'anyTarget', min: 1, max: 1, filter: { notSubtypes: ['Dragon'] } }]);
    expect(full("Whenever ~ is dealt damage, it deals that much damage to any target that isn't a Dragon or a Wizard.")).toBe(false);
  });
  it('"When ~ enters, target opponent ... unless they ...": the player of the object\'s own zone change is you, never another "that player" (CR 603.3a)', () => {
    expect(full('When ~ enters, target opponent loses 3 life unless they discard a card.')).toBe(true);
  });
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bdraw\b/, 'mill'], [/\bdraws\b/, 'mills'], [/\bdiscard\b/, 'exile'], [/\bthen\b/, 'and'], [/\beach opponent\b/, 'target opponent'], [/\beach player\b/, 'target player'],
    [/\byou gain\b/, 'you lose'], [/\bwhere X\b/, 'where Y'], [/\bor less\b/, 'or greater'], [/\bif\b/, 'unless'], [/\bunless\b/, 'if'], [/\bthey\b/, 'you'],
    [/\bplus\b/, 'minus'], [/\bother\b/, 'blocking'], [/\bthis way\b/, 'this turn'], [/\bany number of\b/, 'two'], [/\bnoncreature\b/, 'creature'],
    [/\bhand\b/, 'graveyard'], [/\bbottom\b/, 'top'], [/\blost\b/, 'gained'], [/\bsacrifice\b/, 'exile'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ').trim()}.`);
  return out;
}

describe('T34 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T34) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsed(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsed(m);
          expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('T34 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T34) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w) || /^~'s$/.test(w)) return;
          // CR 122.1: any word can name a kind of counter (parser/holes/misc.ts#counterKind), so the word before "counter" is not a nonsense position
          if (/^counters?$/.test(words[i + 1] ?? '')) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : w.endsWith(':') ? 'blorfty:' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsed(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('T34 design 6.10: examples are synthetic', () => {
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
    const verbatim = T34.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => lines.has(x.trim())).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
