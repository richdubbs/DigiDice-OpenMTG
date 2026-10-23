/**
 * FAST4 T31: the template data of parser/templates/zz-fast4/t31.json (zone moves: tutor variants, flicker, reanimation, play permissions for the card an ability
 * just exiled or milled, counter removal) and the parser and renderer readings the package's shapes needed (design 6.8 G6: render/np.ts, render/steps-util.ts,
 * render/steps-zones.ts, render/steps-cards.ts, render/steps-life.ts, render/stat.ts; the Filter hole's ", and/or" list, parser/holes/filter.ts; the impulse
 * idiom of parser/lower/anaphora.ts; "~ and target ... card from your graveyard" in parser/lower/trigger-zone.ts; an X of a non-mana activation cost in
 * model/lint-nodes.ts). Guard G9 (design 6.8): every example lowers with its template, is fully automated (experimental templates cap the card, not the
 * ability) and passes the exact render gate; every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense
 * word in place of any word of an example never leaves an automated ability (G2). Examples are synthetic wordings (design 6.10).
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T31 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { capabilitiesOf, ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import t31 from '../../../src/parser/templates/zz-fast4/t31.json';
import { automated, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T31 = t31 as Template[];
const OPTS = defaultParseOptions();

/** A trigger or an activated ability is a creature's; anything else is a sorcery (the coverage harness tries the same type lines, cards/coverage/mutation.ts). */
function exampleCard(text: string, type?: string): OracleCard {
  const permanent = /^(When|Whenever|At)\b/.test(text) || /^[^"]*:/.test(text);
  const typeLine = type ?? (permanent ? 'Creature — Human' : 'Sorcery');
  return {
    name: 'Example Subject', layout: 'normal', type_line: typeLine, oracle_text: text.replace(/~/g, 'Example Subject'), mana_cost: '{1}',
    colors: [], keywords: [], ...(typeLine.startsWith('Creature') ? { power: '2', toughness: '2' } : {}),
  } as OracleCard;
}
const parsed = (text: string, type?: string) => parseCard(exampleCard(text, type), OPTS).faces[0]!;
const ability = (text: string, type?: string): Record<string, unknown> => parsed(text, type).abilities.find((x) => x.kind !== 'keyword') as unknown as Record<string, unknown>;
const steps = (text: string, type?: string): unknown => (ability(text, type)['effect'] as { steps: unknown[] } | undefined)?.steps;

describe('T31 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast4/t31.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast4/t31.json');
    expect(files.indexOf('zz-fast4/t31.json')).toBeGreaterThan(files.indexOf('zz-fast4/t30.json'));
    expect(files.indexOf('zz-fast4/t31.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 7 (FAST4)', () => {
    expect(T31.length).toBe(17);
    for (const t of T31) {
      expect(t.kind, t.id).toBe('effect');
      expect(t.id, t.id).toMatch(/^eff\.t31\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(7);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T31) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'unless', 'until', 'instead', 'only', 'except', 'chosen', "can't", 'double']) if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
    }
  });
});

describe('T31 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T31) {
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

describe('T31 lowering: what the shapes mean', () => {
  it('CR 611.2c, 400.7: the play permission names the card the previous instruction exiled (or milled), fixed when the effect begins', () => {
    expect(steps('{1}, {T}: Exile the top card of your library. You may play that card this turn.')).toEqual([
      { op: 'move', what: { ref: 'topCards', player: { ref: 'you' }, count: 1 }, to: { zone: 'exile' }, as: 'impulse' },
      { op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'permit', who: { ref: 'you' }, action: 'play', of: { is: { ref: 'bound', name: 'impulse' } } }] },
    ]);
    expect(steps('{2}, {T}: Mill a card. You may play it this turn.')).toEqual([
      { op: 'mill', who: { ref: 'you' }, count: 1, as: 'impulse' },
      { op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'permit', who: { ref: 'you' }, action: 'play', of: { is: { ref: 'bound', name: 'impulse' } } }] },
    ]);
  });
  it('CR 611.2b: "for as long as you control ~" is the source\'s control duration; in the object\'s own enters trigger "that card" is still the exiled card', () => {
    const s = steps('When ~ enters, exile the top card of your library. You may play that card for as long as you control ~.') as Record<string, unknown>[];
    expect(s[1]).toEqual({ op: 'effect', duration: { d: 'whileSource', as: 'controlled' }, effects: [{ s: 'permit', who: { ref: 'you' }, action: 'play', of: { is: { ref: 'bound', name: 'impulse' } } }] });
  });
  it('design 6.4: without an exiled or milled card right before it, "that card" stays unbound (the permission is never guessed)', () => {
    expect(fullyAutomated(parsed('{T}: Draw a card. You may play that card this turn.'))).toBe(false);
    expect(fullyAutomated(parsed('{T}: Exile the top two cards of your library. You may play that card this turn.'))).toBe(false);
  });
  it('FAST5X E25 (CR 406.3, 607.2a): after "exile the top card of your library face down", "that card" is that exiled card (an experimental E25 template: the game path caps it at partial)', () => {
    const s = steps('{T}: Exile the top card of your library face down. You may play that card this turn.') as Record<string, unknown>[];
    expect(s[0]).toMatchObject({ op: 'move', to: { zone: 'exile', faceDown: true } });
    expect(s[1]).toMatchObject({ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'permit', action: 'play', of: { is: { ref: 'bound', name: (s[0] as { as: string }).as } } }] });
  });
  it('the permission needs `permit:play.object` (statics/play-permits.ts); any other play or cast permission stays unregistered (fail closed)', () => {
    const def = ability('{1}, {T}: Exile the top card of your library. You may play that card this turn.');
    const caps = capabilitiesOf(def as never);
    expect(caps).toContain('permit:play.object');
    expect(caps).not.toContain('permit:play');
    expect(caps).not.toContain('feature:permit.play.of');
    expect(ENGINE_CAPABILITIES.has('permit:play.object')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('permit:play')).toBe(false);
    expect(ENGINE_CAPABILITIES.has('permit:cast')).toBe(false);
  });
  it('CR 610.3c, 110.2: flicker keeps "under its owner\'s control" and "under your control" apart, and returns the exiled card (CR 400.7); the binding is named "moved" as in the stable reading eff.exile + eff.return.bf.owner (FAST5 PROMO2: the same JSON, guard G10)', () => {
    const owner = steps('Whenever you cast a noncreature spell, exile up to one target nonland permanent you control, then return that card to the battlefield under its owner\'s control.') as Record<string, unknown>[];
    expect(owner).toEqual([
      { op: 'move', what: { ref: 'target', id: 't0' }, to: { zone: 'exile' }, as: 'moved' },
      { op: 'move', what: { ref: 'bound', name: 'moved' }, to: { zone: 'battlefield', controller: 'owner' } },
    ]);
    const you = steps('When ~ enters, you may exile target non-Elf creature you control, then return that card to the battlefield under your control.') as Record<string, unknown>[];
    expect(you).toEqual([{
      op: 'may', who: { ref: 'you' }, do: [
        { op: 'move', what: { ref: 'target', id: 't0' }, to: { zone: 'exile' }, as: 'moved' },
        { op: 'move', what: { ref: 'bound', name: 'moved' }, to: { zone: 'battlefield', controller: { ref: 'you' } } },
      ],
    }]);
  });
  it('CR 205.2a: "two target artifacts, creatures, and/or lands you control" is one target spec of any of the three types (the Filter hole\'s ", and/or")', () => {
    const a = ability('Exile two target artifacts, creatures, and/or lands you control, then return those cards to the battlefield under your control.') as { effect: { targets: { filter: unknown; min: number; max: number }[] } };
    expect(a.effect.targets).toMatchObject([{ min: 2, max: 2, filter: { types: ['Artifact', 'Creature', 'Land'], controller: 'you' } }]);
    expect(fullyAutomated(parsed('Exile two target artifacts, creatures, and/or lands you control, then return those cards to the battlefield under your control.'))).toBe(true);
  });
  it('CR 701.24a, 401.2: Worldly-Tutor order: search, shuffle, then the found card on top', () => {
    expect(steps('Search your library for an artifact card, reveal it, then shuffle and put the card on top.')).toEqual([
      { op: 'search', who: { ref: 'you' }, zone: 'library', filter: { types: ['Artifact'] }, max: 1, reveal: true, as: 'search' },
      { op: 'shuffle', who: { ref: 'you' } },
      { op: 'move', what: { ref: 'bound', name: 'search' }, to: { zone: 'library', position: 'top' } },
    ]);
  });
  it('CR 608.2c, 608.2e: "If you do, search ..." puts the whole sentence under the condition', () => {
    const s = steps('When ~ enters, you may discard a card. If you do, search your library for an artifact card, reveal it, put it into your hand, then shuffle.') as Record<string, unknown>[];
    expect(s[1]).toMatchObject({ op: 'if', cond: { cond: 'did', step: 'did' } });
    expect((s[1]!['then'] as unknown[]).length).toBe(3);
  });
  it('CR 113.6m: "Return ~ and target land card from your graveyard to the battlefield tapped" functions in the graveyard and moves both at once', () => {
    const a = ability('{4}{G}: Return this card and target land card from your graveyard to the battlefield tapped.');
    expect(a['zone']).toEqual(['graveyard']);
    expect((a['effect'] as { steps: unknown[] }).steps).toEqual([{ op: 'move', what: { ref: 'union', of: [{ ref: 'self' }, { ref: 'target', id: 't0' }] }, to: { zone: 'battlefield', controller: { ref: 'you' }, tapped: true } }]);
  });
  it('CR 107.3a: an X in a non-mana part of an activation cost is announced, so "mana value X" in the effect is understood', () => {
    expect(fullyAutomated(parsed('Pay X life: Return target creature card with mana value X from your graveyard to the battlefield. Activate only as a sorcery.', 'Enchantment'))).toBe(true);
    // without any X in the cost the X is unbound and the ability stays manual (CR 107.3)
    expect(fullyAutomated(parsed('Pay 2 life: Return target creature card with mana value X from your graveyard to the battlefield.', 'Enchantment'))).toBe(false);
  });
  it('CR 122.1, 608.2d: "remove up to N counters" is a removal of any kinds the controller may stop (`upTo`); "remove N counters" is not', () => {
    expect(steps('Remove up to four counters from target permanent.')).toEqual([{ op: 'removeCounters', from: { ref: 'target', id: 't0' }, kind: 'any', count: 4, upTo: true }]);
    expect(JSON.stringify(steps('Remove four counters from target permanent.'))).not.toContain('upTo');
  });
});

describe('T31 renderer readings (design 6.8 G6)', () => {
  it('one card of either description says an article for each, or one article before a shared head word', () => {
    expect(fullyAutomated(parsed('Search your library for a land card or an artifact card with mana value 1 or less, reveal it, put it into your hand, then shuffle.'))).toBe(true);
    expect(fullyAutomated(parsed('When ~ enters, you may search your library for a Goblin or basic Mountain card, reveal it, put it into your hand, then shuffle.'))).toBe(true);
  });
  it('several cards return "under their owner\'s control"', () => {
    expect(fullyAutomated(parsed('Exile up to two target creatures you control, then return those cards to the battlefield under their owner\'s control.'))).toBe(true);
  });
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    // (Cloud std-fin: ", then shuffle" and ", and shuffle" end the same instructions of a lead-in "if" or a search alike, CR 608.2c, 701.24a: no near miss)
    [/\bor less\b/, 'or greater'], [/\bthen\b(?! shuffle)/, 'and'], [/\byour hand\b/, 'your graveyard'], [/\bits owner's control\b/, 'your control'], [/\btheir owner's control\b/, 'your control'],
    [/\bunder your control\b/, "under its owner's control"], [/\bthis turn\b/, 'until your next turn'], [/\bplay\b/, 'cast'], [/\bup to\b/, 'exactly'], [/\btapped\b/, 'untapped'],
    [/\bpower\b/, 'toughness'], [/\bflash\b/, 'flying'], [/\bon top\b/, 'on the bottom'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ').trim()}.`);
  return out;
}

describe('T31 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T31) {
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

describe('T31 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T31) {
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

describe.skipIf(index === null)('T31 design 6.10: examples are synthetic', () => {
  it('no example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|Equipment|Vehicle|card)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = T31.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => lines.has(x.trim())).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
