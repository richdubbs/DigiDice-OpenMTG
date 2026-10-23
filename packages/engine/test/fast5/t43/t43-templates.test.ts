/**
 * FAST5 T43: the template data of parser/templates/zz-fast5/t43.json (library dig: look at or reveal the top N cards, choose from among them, put the rest on
 * the bottom of the library or into the graveyard) and the parser and renderer readings the package's shapes needed (design 6.4, 6.8 G6: lower/mentions.ts
 * makes the cards looked at a group "them" names and a choice among a group leaves "the rest"; the `Rest` hole of parser/holes/object.ts; render/fold.ts,
 * render/refs.ts, render/steps-zones.ts). Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render
 * gate; every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an
 * example never leaves an automated ability (G2). Examples are synthetic wordings (design 6.10).
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T43 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import t43 from '../../../src/parser/templates/zz-fast5/t43.json';
import { automated, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T43 = t43 as Template[];
const OPTS = defaultParseOptions();

/** A trigger or an activated ability is a creature's; anything else is a sorcery (the coverage harness tries the same type lines, cards/coverage/mutation.ts). */
function exampleCard(text: string): OracleCard {
  const permanent = /^(When|Whenever|At)\b/.test(text) || /^[^"]*:/.test(text);
  return {
    name: 'Example Subject', layout: 'normal', type_line: permanent ? 'Creature — Human' : 'Sorcery', oracle_text: text.replace(/~/g, 'Example Subject'), mana_cost: '{1}',
    colors: [], keywords: [], ...(permanent ? { power: '2', toughness: '2' } : {}),
  } as OracleCard;
}
const parsed = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;
const steps = (text: string): unknown => {
  const a = parsed(text).abilities.find((x) => x.kind !== 'keyword') as unknown as { effect?: { steps: unknown[] } };
  return a.effect?.steps;
};

describe('T43 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5/t43.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t43.json');
    expect(files.indexOf('zz-fast5/t43.json')).toBeGreaterThan(files.indexOf('zz-fast5/t37.json'));
    expect(files.indexOf('zz-fast5/t43.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5)', () => {
    expect(T43.length).toBeGreaterThan(0);
    for (const t of T43) {
      expect(t.kind, t.id).toBe('effect');
      expect(t.id, t.id).toMatch(/^eff\.t43\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T43) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', "can't", 'double', 'random']) if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
    }
  });
});

describe('T43 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T43) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
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

const GROUP = { ref: 'bound', name: 'them' };
const CHOSEN = { ref: 'bound', name: 'chosen' };
const LOOK4 = { op: 'look', who: { ref: 'you' }, at: { ref: 'topCards', player: { ref: 'you' }, count: 4 }, as: 'them' };
const REST = { ref: 'each', filter: { is: GROUP, not: { is: CHOSEN }, zone: 'library' } };

describe('T43 lowering: what the shapes mean', () => {
  it('CR 701.20e, 608.2c: "them" is the cards looked at; "the rest" is those cards the choice did not pick, read in the library', () => {
    expect(steps('Look at the top four cards of your library. You may reveal an Elf card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.')).toEqual([
      LOOK4,
      { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { anyOf: [{ subtypes: ['Elf'] }], is: GROUP, zone: 'library' } }, min: 0, max: 1, as: 'chosen' },
      { op: 'reveal', who: { ref: 'you' }, what: CHOSEN },
      { op: 'move', what: CHOSEN, to: { zone: 'hand' } },
      { op: 'move', what: REST, to: { zone: 'library', position: 'bottom', order: 'random' } },
    ]);
  });
  it('CR 401.4: "in any order" is the owner\'s order (`chosen`), "in a random order" is random; "the other" is the same set as "the rest"', () => {
    expect(steps('Look at the top four cards of your library. Put one of them into your hand and the other on the bottom of your library.')).toEqual([
      LOOK4,
      { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { is: GROUP, zone: 'library' } }, min: 1, max: 1, as: 'chosen' },
      { op: 'move', what: CHOSEN, to: { zone: 'hand' } },
      { op: 'move', what: REST, to: { zone: 'library', position: 'bottom' } },
    ]);
    const last = (text: string) => (steps(text) as { to: unknown }[]).at(-1)!.to;
    expect(last('Look at the top four cards of your library. Put two of them into your hand and the rest on the bottom of your library in any order.')).toEqual({ zone: 'library', position: 'bottom', order: 'chosen' });
    expect(last('Look at the top four cards of your library. Put two of them into your hand and the rest on the bottom of your library in a random order.')).toEqual({ zone: 'library', position: 'bottom', order: 'random' });
    expect(last('Look at the top four cards of your library. Put two of them into your hand and the rest into your graveyard.')).toEqual({ zone: 'graveyard' });
  });
  it('CR 110.2, 701.20e: "put a land card from among them onto the battlefield tapped" is put by you, tapped, and the choice may be empty', () => {
    const s = steps('Look at the top four cards of your library. You may put a land card from among them onto the battlefield tapped. Put the rest on the bottom in a random order.') as Record<string, unknown>[];
    expect(s[1]).toMatchObject({ op: 'chooseObjects', min: 0, max: 1 });
    expect(s[2]).toEqual({ op: 'move', what: CHOSEN, to: { zone: 'battlefield', controller: { ref: 'you' }, tapped: true } });
    expect(s[3]).toEqual({ op: 'move', what: REST, to: { zone: 'library', position: 'bottom', order: 'random' } });
  });
  it('CR 401.4, 701.20e: "you may put one of those cards back on top of your library" puts at most one of the cards looked at on top', () => {
    const s = steps('Look at the top four cards of your library. You may put one of those cards back on top of your library. Put the rest into your graveyard.') as Record<string, unknown>[];
    expect(s[1]).toEqual({ op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { is: GROUP, zone: 'library' } }, min: 0, max: 1, as: 'chosen' });
    expect(s[2]).toEqual({ op: 'move', what: CHOSEN, to: { zone: 'library', position: 'top' } });
    expect(s[3]).toEqual({ op: 'move', what: REST, to: { zone: 'graveyard' } });
  });
  it('CR 107.3, 608.2h: "look at the top X cards of your library, where X is the number of lands you control" counts when it resolves', () => {
    const s = steps('Look at the top X cards of your library, where X is the number of lands you control. Put one of them into your hand and the rest into your graveyard.') as Record<string, unknown>[];
    expect(s[0]).toMatchObject({ op: 'look', at: { ref: 'topCards' }, as: 'them' });
    expect(JSON.stringify(s[0])).toContain('"q":"count"');
  });
  it('CR 110.4: "a permanent card" is a card of one of the six permanent types, never any card', () => {
    const s = steps('Look at the top four cards of your library. You may put a permanent card from among them into your hand. Put the rest into your graveyard.') as { from?: { filter: { anyOf: { types: string[] }[] } } }[];
    expect(s[1]!.from!.filter.anyOf[0]!.types).toEqual(['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker']);
    // std-rx20 (changed on purpose): beside a template that does not say it, "permanent" right before the pattern's "card" is the six permanent types too
    // (parser/holes/filter.ts); before, the bare word was no description at all and the render gate refused it
    const f = parsed('Look at the top four cards of your library. You may put a permanent card from among them onto the battlefield. Put the rest into your graveyard.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"types":["Artifact","Battle","Creature","Enchantment","Land","Planeswalker"]');
  });
  it('design 6.4: "the rest" with no choice among a group before it stays a plain manual step (it names nothing an automated step produced)', () => {
    // (Cloud std-lci reads "a creature card and/or a land card from among them" now, eff.stdlci.dig.put.eitherOr.hand: two of one kind is still no understood choice)
    const f = parsed('Reveal the top four cards of your library. You may put two creature cards and/or a land card from among them into your hand. Put the rest into your graveyard.');
    expect(f.abilities[0]!.kind).toBe('spell');
    expect(JSON.stringify(f.abilities)).toContain('"op":"reveal"');
    expect(JSON.stringify(f.abilities)).toContain('"op":"manual"');
  });
  it('design 6.4: "them" is the cards looked at or revealed, never cards another instruction put elsewhere (they are no longer in the library)', () => {
    expect(fullyAutomated(parsed('Exile the top four cards of your library. Put two of them into your hand and the rest into your graveyard.'))).toBe(false);
    expect(fullyAutomated(parsed('Mill four cards. Put two of them into your hand and the rest into your graveyard.'))).toBe(false);
    expect(fullyAutomated(parsed('Reveal the top four cards of your library. Put two of them into your hand and the rest into your graveyard.'))).toBe(true);
  });
  it('design 6.4: a single card looked at is no group, and "them" with nothing looked at stays manual', () => {
    expect(fullyAutomated(parsed('Look at the top card of your library. You may put one of them into your hand and the rest into your graveyard.'))).toBe(false);
    expect(fullyAutomated(parsed('You may reveal a creature card from among them and put it into your hand.'))).toBe(false);
    expect(fullyAutomated(parsed('Put the rest into your graveyard.'))).toBe(false);
  });
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bof them\b/, 'of those'], [/\bthe rest\b/, 'a random card'], [/\bhand\b/, 'graveyard'], [/\bgraveyard\b/, 'hand'], [/\bbottom\b/, 'top'], [/\bmay\b/, 'must'], [/\bwhere X\b/, 'where Y'],
    [/\bor less\b/, 'or greater'], [/\btapped\b/, 'untapped'], [/\blook at\b/, 'reveal'], [/\bpower\b/, 'toughness'], [/\bany order\b/, 'a random order'], [/\ba random order\b/, 'any order'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ').trim()}.`);
  return out;
}

describe('T43 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T43) {
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

describe('T43 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T43) {
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

describe.skipIf(index === null)('T43 design 6.10: examples are synthetic', () => {
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
    const verbatim = T43.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => lines.has(x.trim())).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
