/**
 * FAST5 T75 (look at / reveal the top N, then pick a card from among them with a richer filter; library searches for one of two kinds of card): the template
 * data of parser/templates/zz-fast5/t75.json ("You may reveal a Wizard creature card or a Swamp card from among them and put it into your hand", "... a land card or
 * a card with {X} in its mana cost ...", "... a noncreature, nonland card ...", "Put a random creature card from among them onto the battlefield", "... a creature
 * card with mana value less than or equal to the number of lands you control ... onto the battlefield", "Search your library for a basic land card or a Cave card,
 * reveal it, put it into your hand, then shuffle", "Mill four cards. You may put a land card from among them into your hand. If you put a Town card into your hand
 * this way, ...", "Search your library for up to two Forest cards and reveal them. Put one of them onto the battlefield tapped and the other into your hand, then
 * shuffle") and the parser and renderer readings they needed (the `Milled` and `Found` holes, the discourse the pronoun holes read, `did` with `to: 'hand'`,
 * render/fold.ts, render/np.ts, design 6.4, 6.8 G6).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10); the real cards each template reads are checked against the local index when it is present.
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T75 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import t43 from '../../../src/parser/templates/zz-fast5/t43.json';
import t75 from '../../../src/parser/templates/zz-fast5/t75.json';
import review from '../../m5/golden/cards/fast5-t75-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T75 = t75 as Template[];

/** Design 6.9 evidence for a stable template: three hand-verified golden cards, or, for a sentence only one or two real cards print, those cards. */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp }>> = {
  'eff.t75.dig.reveal.hand.or': { cards: ['Frontier Seeker'], line: /you may reveal (a|an) [^.]*? card or (a|an) [^.]*? card from among them and put (it|that card) into your hand/i },
  'eff.t75.dig.reveal.hand.orX': { cards: ['Paradox Surveyor'], line: /you may reveal (a|an) [^.]*? card or a card with \{X\} in its mana cost from among them and put (it|that card) into your hand/i },
  'eff.t75.dig.put.battlefield.random': { cards: ['Getaway Barrel'], line: /put a random [^.]*? card from among them onto the battlefield/i },
  'eff.t75.dig.reveal.battlefield.mvAtMost': { cards: ['Loot, Exuberant Explorer'], line: /you may reveal (a|an) [^.]*? card with mana value less than or equal to [^.]*? from among them and put (it|that card) onto the battlefield/i },
  'eff.t75.search.or.reveal.hand': { cards: ['Outcaster Greenblade', 'Spinewoods Armadillo'], line: /(^|[.:] |, )search your library for (a|an) [^.,]*? card or (a|an) [^.,]*? card, reveal it, put it into your hand, then shuffle/i },
  'eff.t75.search.may.or.reveal.hand': { cards: ['Gatecreeper Vine'], line: /you may search your library for (a|an) [^.,]*? card or (a|an) [^.,]*? card, reveal it, put it into your hand, then shuffle/i },
  'eff.t75.found.putBattlefieldTapped.restHand': { cards: ['Flourishing Bloom-Kin', 'Viewpoint Synchronization'], line: /(^|\. )Put (one|two|three) of them onto the battlefield tapped and (the other|the rest) into your hand, then shuffle/ },
};
/** A stable template whose evidence is two golden cards beside a stable twin that differs only in the filter. */
const TWINS: Readonly<Record<string, string>> = { 'eff.t75.milled.may.put.hand.permanent': 'eff.t75.milled.may.put.hand' };
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which a T75 example is an ability of the right kind (a trigger is a creature's, an effect on its own a spell's). */
function exampleCard(text: string): OracleCard {
  if (/^(when|whenever|at) /i.test(text)) return card('Example Brute', 'Creature — Elf Warrior', text);
  return card('Example Volley', 'Sorcery', text);
}
const parsedWith = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;
const steps = (text: string): unknown => {
  const a = parsedWith(text).abilities.find((x) => x.kind !== 'keyword') as unknown as { effect?: { steps: unknown[] } };
  return a.effect?.steps;
};

describe('T75 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast5/t75.json, path order: after zz-fast4/, before zz-m6/ and zz-push/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t75.json');
    expect(files.indexOf('zz-fast5/t75.json')).toBeGreaterThan(files.indexOf('zz-fast4/t34.json'));
    expect(files.indexOf('zz-fast5/t75.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5)', () => {
    expect(T75.length).toBe(11);
    for (const t of T75) {
      expect(t.kind, t.id).toBe('effect');
      expect(t.id, t.id).toMatch(/^eff\.t75\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable T75 template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence, or (a twin) two golden cards beside a stable template that differs in its filter only', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of T75.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      const twin = TWINS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole.cards].sort());
      else if (twin) {
        // "a permanent card" cannot be read by the Filter hole beside the word "card" (it is a head phrase of its own): the same template with the six permanent types written out
        const other = T75.find((x) => x.id === twin)!;
        expect(other.status, t.id).toBe('stable');
        expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(2);
        // the build is the other's with the description of the cards left out; the pattern is the other's with "a permanent card" in the place of "( a | an ) {f:Filter} card"
        const noFilter = (t2: Template): unknown => { const b = JSON.parse(JSON.stringify(t2.build)) as { from: { filter: { anyOf: unknown[] } } }[]; b[0]!.from.filter.anyOf = []; return b; };
        expect(noFilter(t)).toEqual(noFilter(other));
        expect(t.pattern).toBe(other.pattern.replace('( a | an ) {f:Filter} card', 'a permanent card'));
      } else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T75) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'random']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      if (/\bup to\b/.test(t.pattern)) expect(t.consumes ?? [], t.id).toContain('up to');
    }
  });
  it('FAST5 T75 promotes eff.t43.dig.rest.bottomRandomShort ("Put the rest on the bottom in a random order."): it builds exactly what the stable eff.t43.dig.rest.bottomRandom builds, and only the words differ', () => {
    const all = t43 as Template[];
    const short = all.find((x) => x.id === 'eff.t43.dig.rest.bottomRandomShort')!;
    const long = all.find((x) => x.id === 'eff.t43.dig.rest.bottomRandom')!;
    expect(short.status).toBe('stable');
    expect(long.status).toBe('stable');
    expect(short.build).toEqual(long.build);
    expect(short.pattern).toBe('put {r:Rest} on the bottom in a random order');
    expect(long.pattern).toBe('put {r:Rest} on the bottom of your library in a random order');
  });
});

describe('T75 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T75) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(fullyAutomated(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/ hand/, ' graveyard'], [/reveal/, 'exile'], [/battlefield tapped/, 'graveyard'], [/battlefield/, 'graveyard'], [/search/, 'mill'], [/random/, 'chosen'], [/ or /, ' and '],
    [/top/, 'bottom'], [/among them/, 'from your graveyard'], [/shuffle/, 'draw'], [/mill/, 'draw'], [/up to/, 'exactly'], [/less than or equal to/, 'greater than'], [/Put/, 'Return'],
    [/ two /, ' three '], [/ them/, ' it'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('T75 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T75) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('T75 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T75) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~,' || /^\{/.test(w)) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const GROUP = (name: string) => ({ ref: 'bound', name });
const CHOSEN = { ref: 'bound', name: 'chosen' };

describe('T75 lowering: what the shapes mean', () => {
  it('CR 701.20a, 608.2d: two descriptions joined by "or" are one choice of at most one card that fits either (never both a creature and a land)', () => {
    expect(steps('Look at the top four cards of your library. You may reveal a Wizard creature card or a Swamp card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.')).toEqual([
      { op: 'look', who: { ref: 'you' }, at: { ref: 'topCards', player: { ref: 'you' }, count: 4 }, as: 'them' },
      { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { anyOf: [{ types: ['Creature'], subtypes: ['Wizard'] }, { subtypes: ['Swamp'] }], is: GROUP('them'), zone: 'library' } }, min: 0, max: 1, as: 'chosen' },
      { op: 'reveal', who: { ref: 'you' }, what: CHOSEN },
      { op: 'move', what: CHOSEN, to: { zone: 'hand' } },
      { op: 'move', what: { ref: 'each', filter: { is: GROUP('them'), not: { is: CHOSEN }, zone: 'library' } }, to: { zone: 'library', position: 'bottom', order: 'random' } },
    ]);
  });
  it('CR 107.3, 202.1: "a card with {X} in its mana cost" is the filter `manaCostHasX`', () => {
    const s = steps('Look at the top four cards of your library. You may reveal a land card or a card with {X} in its mana cost from among them and put it into your hand. Put the rest on the bottom of your library in a random order.') as { op: string; from?: { filter: unknown } }[];
    expect(s[1]!.from!.filter).toEqual({ anyOf: [{ types: ['Land'] }, { manaCostHasX: true }], is: GROUP('them'), zone: 'library' });
  });
  it('CR 205.4b: "a noncreature, nonland card" is a card that is neither a creature nor a land', () => {
    const s = steps('Look at the top four cards of your library. You may reveal a noncreature, nonland card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.') as { from?: { filter: unknown } }[];
    expect(s[1]!.from!.filter).toEqual({ anyOf: [{ notTypes: ['Creature', 'Land'] }], is: GROUP('them'), zone: 'library' });
  });
  it('CR 608.2d: "a random creature card" is chosen at random (no player decides) and enters under your control', () => {
    const s = steps('Reveal the top four cards of your library. Put a random creature card from among them onto the battlefield. Put the rest on the bottom of your library in a random order.') as unknown[];
    expect(s[1]).toEqual({ op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { anyOf: [{ types: ['Creature'] }], is: GROUP('them'), zone: 'library' } }, min: 1, max: 1, random: true, as: 'chosen' });
    expect(s[2]).toEqual({ op: 'move', what: CHOSEN, to: { zone: 'battlefield', controller: { ref: 'you' } } });
  });
  it('CR 202.3, 608.2h: "mana value less than or equal to the number of lands you control" compares the printed mana value with the count as the card is chosen', () => {
    const s = steps('Look at the top four cards of your library. You may reveal a creature card with mana value less than or equal to the number of lands you control from among them and put it onto the battlefield. Put the rest on the bottom of your library in a random order.') as { from?: { filter: unknown } }[];
    expect(s[1]!.from!.filter).toEqual({
      anyOf: [{ types: ['Creature'] }],
      manaValue: { op: '<=', value: { q: 'count', of: { ref: 'each', filter: { types: ['Land'], controller: 'you' } } } },
      is: GROUP('them'), zone: 'library',
    });
  });
  it('CR 701.17a, 608.2c: after a mill, "them" in the next sentence is the milled cards (read wherever they are now); after a look it is still the cards looked at, in the library', () => {
    const milled = steps('Mill four cards. You may put a land card from among them into your hand.') as { op: string; from?: { filter: unknown }; as?: string }[];
    expect(milled[0]).toEqual({ op: 'mill', who: { ref: 'you' }, count: 4, as: 'them' });
    expect(milled[1]!.from!.filter).toEqual({ anyOf: [{ types: ['Land'] }], is: GROUP('them'), zone: 'any' });
    const looked = steps('Look at the top four cards of your library. You may put a land card from among them into your hand.') as { from?: { filter: unknown } }[];
    expect(looked[1]!.from!.filter).toEqual({ anyOf: [{ types: ['Land'] }], is: GROUP('them'), zone: 'library' });
  });
  it('CR 608.2c, 608.2h, 400.7: "If you put a Town card into your hand this way" reads the card the move to the hand really put there, as it was before it moved', () => {
    const s = steps('Mill four cards. You may put a land card from among them into your hand. If you put a Town card into your hand this way, you gain 2 life.') as { op: string; as?: string; cond?: unknown }[];
    expect(s[2]).toEqual({ op: 'move', what: CHOSEN, to: { zone: 'hand' }, as: 'did' });
    expect(s[3]).toEqual({ op: 'if', cond: { cond: 'did', step: 'did', which: { subtypes: ['Town'], isCard: true }, to: 'hand' }, then: [{ op: 'gainLife', who: { ref: 'you' }, amount: 2 }] });
  });
  it('CR 608.2c: "put ... into your hand this way" needs a move to the hand; with none the sentence stays manual', () => {
    expect(fullyAutomated(parsedWith('Mill four cards. You may put a land card from among them into your graveyard. If you put a Town card into your hand this way, you gain 2 life.'))).toBe(false);
    expect(fullyAutomated(parsedWith('Mill four cards. If you put a Town card into your hand this way, you gain 2 life.'))).toBe(false);
    // Cloud C7 (CR 608.2c; lower/conditions.ts#onlyEarlier): after another instruction it is the ONE earlier move to the hand of the ability (all its sentences
    // understood), as a count of what an instruction moved finds its instruction (lower/quantities.ts); this used to stay manual
    expect(fullyAutomated(parsedWith('Mill four cards. You may put a land card from among them into your hand. You gain 1 life. If you put a Town card into your hand this way, you gain 2 life.'))).toBe(true);
    expect(fullyAutomated(parsedWith('Mill four cards. You may put a land card from among them into your hand. Return target creature to its owner\'s hand. You gain 1 life. If you put a Town card into your hand this way, you gain 2 life.'))).toBe(false); // two moves to a hand
  });
  it('CR 701.23a, 608.2c, 110.2: the cards found are the group "them" names; one is chosen to enter tapped, the others ("the other", "the rest") go to the hand, then the library is shuffled', () => {
    expect(steps('Search your library for up to two Forest cards and reveal them. Put one of them onto the battlefield tapped and the other into your hand, then shuffle.')).toEqual([
      { op: 'search', who: { ref: 'you' }, zone: 'library', filter: { subtypes: ['Forest'] }, min: 0, max: 2, reveal: true, as: 'search' },
      { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { is: GROUP('search'), zone: 'library' } }, min: 1, max: 1, as: 'chosen' },
      { op: 'move', what: CHOSEN, to: { zone: 'battlefield', controller: { ref: 'you' }, tapped: true } },
      { op: 'move', what: { ref: 'each', filter: { is: GROUP('search'), not: { is: CHOSEN }, zone: 'library' } }, to: { zone: 'hand' } },
      { op: 'shuffle', who: { ref: 'you' } },
    ]);
  });
  it('"them" after a search is the cards found only: after a look or a mill the sentence does not read it', () => {
    expect(fullyAutomated(parsedWith('Look at the top three cards of your library. Put one of them onto the battlefield tapped and the other into your hand, then shuffle.'))).toBe(false);
    expect(fullyAutomated(parsedWith('Mill three cards. Put one of them onto the battlefield tapped and the other into your hand, then shuffle.'))).toBe(false);
  });
});

describe('T75 discourse (parser/holes/core.ts#Discourse): the pronoun holes read what the sentences before made', () => {
  it('a mill AND a look before "them": two readings, so the sentence stays manual (guard G5), never the wrong group', () => {
    const f = parsedWith('Look at the top two cards of your library. Mill two cards. You may put a land card from among them into your hand.');
    expect(fullyAutomated(f)).toBe(false);
  });
  it('a look alone keeps every T43 reading (the pool is the library); a mill alone gets the graveyard reading and no other', () => {
    const look = parsedWith('Look at the top four cards of your library. You may put a land card from among them into your hand. Put the rest into your graveyard.');
    expect(look.templatesUsed).toContain('eff.t43.dig.put.hand');
    expect(look.templatesUsed).not.toContain('eff.t75.milled.may.put.hand');
    const mill = parsedWith('Mill four cards. You may put a land card from among them into your hand.');
    expect(mill.templatesUsed).toContain('eff.t75.milled.may.put.hand');
    expect(mill.templatesUsed).not.toContain('eff.t43.dig.put.hand');
  });
  it('a card in a graveyard is not a card of the library: after a mill, "put the rest" has no group to leave and stays manual', () => {
    expect(fullyAutomated(parsedWith('Mill four cards. You may put a land card from among them into your hand. Put the rest on the bottom of your library in a random order.'))).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('T75 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  it('no T75 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = T75.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => lines.has(x.trim())).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
  it('the cards named as the whole corpus of a sentence are every card of the index that prints it', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = (index ?? []).filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && w.line.test(x))).map((c) => c.name);
      expect([...new Set(found)].sort(), id).toEqual([...w.cards].sort());
    }
  }, 120_000);

  // the try step on real cards: each card's T75 line is read by the named template and passes the exact render gate
  const REAL: Readonly<Record<string, { cards: readonly string[]; line: RegExp }>> = {
    'eff.t75.dig.reveal.hand.or': { cards: ['Frontier Seeker'], line: /card or (a|an) .*? card from among them/i },
    'eff.t75.dig.reveal.hand.orX': { cards: ['Paradox Surveyor'], line: /\{X\} in its mana cost from among them/ },
    'eff.t75.dig.reveal.hand.noncreatureNonland': { cards: ['Thundertrap Trainer', 'Wandering Mind'], line: /noncreature, nonland card from among them/i },
    'eff.t75.dig.put.battlefield.random': { cards: ['Getaway Barrel'], line: /put a random/i },
    'eff.t75.dig.reveal.battlefield.mvAtMost': { cards: ['Loot, Exuberant Explorer'], line: /less than or equal to the number of lands you control from among them/i },
    'eff.t75.search.or.reveal.hand': { cards: ['Outcaster Greenblade', 'Spinewoods Armadillo'], line: /search your library for a basic land card or a Desert card/i },
    'eff.t75.search.may.or.reveal.hand': { cards: ['Gatecreeper Vine'], line: /you may search your library for a basic land card or a Gate card/i },
    'eff.t75.milled.may.put.hand': { cards: ['Town Greeter', 'Eerie Gravestone', 'Ostrich-Horse', "Dredger's Insight"], line: /you may put (a|an) \w+ card from among them into your hand/i },
    'eff.t75.milled.may.put.hand.permanent': { cards: ['Scout the City', 'Something Worth Saving', 'Rapid Rescue'], line: /you may put a permanent card from among them into your hand/i },
    'eff.t75.search.upTo.andReveal': { cards: ['Flourishing Bloom-Kin', 'Viewpoint Synchronization', 'Fork in the Road'], line: /and reveal them/i },
    'eff.t75.found.putBattlefieldTapped.restHand': { cards: ['Flourishing Bloom-Kin', 'Viewpoint Synchronization'], line: /of them onto the battlefield tapped and the other into your hand/i },
  };
  for (const [id, { cards, line }] of Object.entries(REAL)) {
    it(`${id}: ${cards.join(', ')} read the line with it, pass the render gate and leave no manual ability for it`, () => {
      for (const name of cards) {
        const oracle = (index ?? []).find((c) => c.name === name);
        expect(oracle, name).toBeDefined();
        const c = compileCard(oracle!);
        const lineOk = c.faces.every((f) => f.abilities.every((a) => !(a.kind === 'manual' && line.test(a.text))));
        expect(lineOk, name).toBe(true);
        const parsed = parseCard(oracle!, OPTS);
        expect(parsed.faces.flatMap((f) => f.templatesUsed), name).toContain(id);
        expect(parsed.faces.every((f) => f.gate.every((g) => g.ok)), name).toBe(true);
      }
    }, 60_000);
  }
  it('FAST5 T75 promoted "Put the rest on the bottom in a random order.": the cards of the index that print it as an instruction (not as reminder text) and are read with it pass the render gate', () => {
    const line = /(^|\. |\n|• )Put the rest on the bottom in a random order\./;
    const printing = (index ?? []).filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && line.test(x.replace(/\([^)]*\)/g, ' '))));
    expect(printing.map((c) => c.name).sort()).toEqual(['Catch-Up Mechanic', "Kaslem's Stonetree // Kaslem's Strider", 'Loot, Exuberant Explorer', 'Ojer Kaslem, Deepest Growth // Temple of Cultivation', 'The Unknown Wizard']);
    const read = printing.filter((oracle) => parseCard(oracle, OPTS).faces.flatMap((f) => f.templatesUsed).includes('eff.t43.dig.rest.bottomRandomShort'));
    expect(read.map((c) => c.name).sort()).toEqual(["Kaslem's Stonetree // Kaslem's Strider", 'Loot, Exuberant Explorer', 'Ojer Kaslem, Deepest Growth // Temple of Cultivation', 'The Unknown Wizard']);
    for (const name of ["Kaslem's Stonetree // Kaslem's Strider", 'Loot, Exuberant Explorer']) {
      const oracle = read.find((c) => c.name === name)!;
      expect(parseCard(oracle, OPTS).faces.every((f) => f.gate.every((g) => g.ok)), name).toBe(true);
      expect(compileCard(oracle).faces.every((f) => f.abilities.every((a) => a.kind !== 'manual')), name).toBe(true);
    }
  }, 180_000);
});
