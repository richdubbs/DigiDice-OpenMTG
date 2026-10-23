/**
 * Cloud std-fin (the Final Fantasy slice of the Standard backlog): the template data of parser/templates/zz-cloud/std-fin.json ("mills half their library, rounded
 * down", "Then <group> gain <abilities> <duration>", "destroy all / up to N <Equipment> attached to <it>", "deals X damage to <any other target> and X damage to itself,
 * where X is its power", "you may search your library for a <type> or basic land card, reveal it, put it into your hand, then shuffle", "Whenever <event> during your
 * turn", "Whenever A and whenever B", "draws cards equal to", "put a number of <kind> counters equal to <qty> on <objs>", "you may reveal it and put it into your
 * hand", "You may cast it" (now), "Until end of turn, ~'s base power becomes equal to", "shuffle <cards> into your library", "attach any number of / an <Equipment>
 * to <it>", "If you do, unattach it at the beginning of the next end step").
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10); the real cards each template reads are checked against the local index when it is present, from its
 * open cards only (design 6.12: the tuning half and Standard-legal cards; a held-out non-Standard card is never looked at).
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the std-fin templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdFin from '../../../src/parser/templates/zz-cloud/std-fin.json';
import review from '../../m5/golden/cards/cloud-std-fin-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex, openCards, openToTuning } from '../../m5/parser/support';
import { CRITICAL_WORDS } from '../../../src/parser/lower/units';

const STD_FIN = stdFin as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/**
 * Design 6.9 evidence for a stable template: three hand-verified golden cards (test/m5/golden/cards/cloud-std-fin-review.json), or, for a sentence fewer real cards
 * read, every one of them: the cards of the tuning half of the local index whose parse uses the template (found among the cards whose text matches `hint`).
 */
const EVERY_CARD: Readonly<Record<string, { cards: readonly string[]; hint: RegExp; pending?: Readonly<Record<string, string>> }>> = {
  'eff.stdfin.then.group.gain': {
    cards: ["Moogles' Valor"], hint: /\. Then [^.]* gain /i,
    pending: { 'Ingris Stingerquill': 'open since the hash split of 2026-10-19; reads the line with the template and compiles full, not hand-verified golden evidence yet (design 6.9)', 'For the Common Good': 'open since the hash split of 2026-10-19; reads the line with the template and compiles full, not hand-verified golden evidence yet (design 6.9)' },
  },
  'eff.stdfin.destroy.upTo.attachedTo': { cards: ['Light of Judgment'], hint: /destroy up to \w+ [^.]*attached to/i },
  'eff.stdfin.damage.andItself.whereXItsPower': { cards: ['Self-Destruct'], hint: /damage to itself, where X is its power/i },
  'eff.stdfin.search.may.orBasicLand.reveal.hand': { cards: ['Sazh Katzroy'], hint: /or basic land card, reveal it, put it into your hand/i },
  'trg.stdfin.whenever.andWhenever': {
    cards: ['Giott, King of the Dwarves', 'Necklace of Girion'], hint: / and whenever /i,
    pending: { "Astrologian's Planisphere": 'open since the hash split of 2026-10-19; reads the line with the template and compiles full, not hand-verified golden evidence yet (design 6.9)', 'Fire Lord Zuko': 'open since the hash split of 2026-10-19; reads the line with the template and compiles full, not hand-verified golden evidence yet (design 6.9)' },
  },
  'eff.stdfin.basepower.becomesEqual.lead': { cards: ['PuPu UFO'], hint: /base power becomes equal to/i },
  'eff.stdfin.attach.anyNumber': {
    cards: ['Beatrix, Loyal General', 'Battlefield Improvisation'], hint: /attach any number of/i, // Battlefield Improvisation is HELD_OUT
    pending: { 'Armed and Armored': 'open since the hash split of 2026-10-19; reads the line with the template and compiles full, not hand-verified golden evidence yet (design 6.9)' },
  },
  'eff.stdfin.attach.one': {
    cards: ['Unexpected Request', 'Nahiri, Heir of the Ancients'], hint: /attach an? [A-Z]\w* you control to/, // Nahiri, Heir of the Ancients is HELD_OUT
    pending: {
      'Resolute Strike': 'open since the hash split of 2026-10-19; reads the line with the template and compiles full, not hand-verified golden evidence yet (design 6.9)',
      'Vow to Erebor': 'Standard-legal and in the held-out half, so open under the owner rule of 2026-10-17; reads the line with the template and compiles full, not hand-verified golden evidence yet (design 6.9)',
      'Winter Soldier, Icy Assassin': 'open since the hash split of 2026-10-19; reads the line with the template and compiles full, not hand-verified golden evidence yet (design 6.9)',
      'Nahiri, the Lithomancer': 'open since the hash split of 2026-10-19; reads the line with the template, but its -10 ("It has indestructible, \"Equipped creature gets +5/+5 and has double strike,\" and equip {0}") has no template, so the card is partial',
    },
  },
  'eff.stdfin.if.unattach.nextEnd': { cards: ['Unexpected Request'], hint: /unattach it at the beginning of the next end step/i },
};

/** A synthetic card in which an example is an ability of the right kind (a trigger or an activated ability is a creature's, an effect on its own a sorcery's). */
function exampleCard(text: string): OracleCard {
  if (/^(when|whenever|at) /i.test(text) || /^\{[^}]*\}(, \{[^}]*\})*: /.test(text)) return card('Example Brute', 'Creature — Elf Warrior', text);
  return card('Example Volley', 'Sorcery', text);
}
const parsedWith = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;

describe('std-fin template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-fin.json, path order: after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-fin.json');
    expect(files.indexOf('zz-cloud/std-fin.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-fin.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, is stable and of version 8', () => {
    expect(STD_FIN.length).toBe(17);
    for (const t of STD_FIN) {
      expect(t.id, t.id).toMatch(/^(eff|trg)\.stdfin\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.status, t.id).toBe('stable');
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three hand-verified golden cards, or every card of the tuning half that it reads', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of STD_FIN) {
      const cards = golden.filter((g) => g.verified.includes(t.id)).map((g) => g.card);
      const every = EVERY_CARD[t.id];
      if (every) expect(cards.slice().sort(), t.id).toEqual([...every.cards].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
    for (const g of golden) expect(g.verified, g.card).toMatch(/CR \d{3}/);
  });
  it('design 6.9: eff.t34.thenIf, promoted to stable here, has three hand-verified golden cards', () => {
    const t34 = TEMPLATE_SET.find((t) => t.id === 'eff.t34.thenIf');
    expect(t34?.status).toBe('stable');
    const cards = (review as { card: string; verified: string }[]).filter((g) => g.verified.includes('eff.t34.thenIf')).map((g) => g.card);
    expect(cards.length, cards.join(', ')).toBeGreaterThanOrEqual(3);
  });
  it('guard G3: a critical word or phrase a pattern spells out (parser/lower/units.ts#CRITICAL_WORDS) is listed in `consumes`', () => {
    for (const t of STD_FIN) {
      const literal = ` ${t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' | ').replace(/[^a-z' ]+/g, ' | ').replace(/\s+/g, ' ')} `;
      for (const w of CRITICAL_WORDS) if (literal.includes(` ${w} `)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('std-fin guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of STD_FIN) {
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
    [/rounded down/, 'rounded up'], [/half their library/, 'half your library'], [/ gain (vigilance|haste)/, ' lose $1'], [/Destroy all/, 'Exile all'], [/destroy all/, 'exile all'],
    [/attached to/, 'blocking'], [/up to (one|two)/, 'exactly $1'], [/to itself/, 'to you'], [/its power\./, 'its toughness.'], [/or basic land card/, 'or land card'],
    [/during your turn/, "during an opponent's turn"], [/ draws? cards/, ' discards cards'], [/\+1\/\+1 counters/, '-1/-1 counters'],
    [/put it into your hand/, 'put it onto the battlefield'], [/ and whenever /, ' or whenever '], [/You may cast/, 'You may play'], [/base power/, 'base toughness'],
    [/into your library/, 'into your hand'], [/any number of/, 'up to two'], [/Attach an /, 'Attach two '], [/attach an /, 'attach two '], [/unattach it/, 'sacrifice it'],
    [/the next end step/, 'your next upkeep'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('std-fin guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of STD_FIN) {
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

describe('std-fin guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of STD_FIN) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          // (a counter's name is any word, CR 122.1: "a blorfty counter" is a kind of counter, not a nonsense word)
          if (w === '~' || w === '~,' || w === "~'s" || /^\{/.test(w) || /^[+-]\d+\/[+-]\d+$/.test(w)) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

/**
 * Design 6.12: the cards this slice may read (test/m5/parser/support.ts#openCards): the tuning half of the index (the cards whose key hashes even,
 * parser/metrics.ts#halfOfKey, the split of cards/coverage/corpus.ts#halvesOf) and every Standard-legal card (both halves open, owner decision 2026-10-17).
 */
/**
 * Cards this slice read while the halves still alternated by position (before 2026-10-19), which the hash split put in the held-out half and which are not
 * Standard-legal (docs/CARD_AUTOMATION.md section 4): no longer read, scanned or used as evidence. Their golden entries were verified while they were
 * tuning-half cards and stay; the owner may strip them as round 4's r4-dig precedent did. The test below fails when one of them becomes open again (a
 * format change), so it can be re-examined.
 */
const HELD_OUT: Readonly<Record<string, string>> = {
  'Battlefield Improvisation': 'eff.stdfin.attach.anyNumber: held-out since the hash split of 2026-10-19 (design 6.12)',
  'Nahiri, Heir of the Ancients': 'eff.stdfin.attach.one: held-out since the hash split of 2026-10-19 (design 6.12)',
  'Traumatize': 'eff.stdfin.mill.halfLibraryRoundedDown: held-out since the hash split of 2026-10-19 (design 6.12)',
  'Treefolk Mystic': 'eff.stdfin.destroy.all.attachedTo: held-out since the hash split of 2026-10-19 (design 6.12)',
  'Hermit of the Natterknolls // Lone Wolf of the Natterknolls': 'trg.stdfin.when.duringYourTurn: held-out since the hash split of 2026-10-19 (design 6.12)',
  'Chakram Retriever': 'trg.stdfin.when.duringYourTurn: held-out since the hash split of 2026-10-19 (design 6.12)',
  'Domri Rade': 'eff.stdfin.may.reveal.putIntoHand: held-out since the hash split of 2026-10-19 (design 6.12)',
  "Piper's Melody": 'eff.stdfin.shuffle.objs.intoYourLibrary: held-out since the hash split of 2026-10-19 (design 6.12)',
};
const textOf = (c: OracleCard): string => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].filter((x): x is string => typeof x === 'string').join('\n');

describe.skipIf(index === null)('std-fin design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads (open cards, design 6.12)', () => {
  const open = openCards(index ?? []);
  it('every card listed as held-out is in the index, in the held-out half and not Standard-legal (re-examine it when this fails)', () => {
    for (const name of Object.keys(HELD_OUT)) {
      const c = (index ?? []).find((x) => x.name === name);
      expect(c, name).toBeDefined();
      expect(openToTuning(c!), `${name}: ${HELD_OUT[name]}`).toBe(false);
    }
  });

  it('no line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|Equipment)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = STD_FIN.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => lines.has(x.trim())).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
  it('the cards named as every card a template reads are every open card whose parse uses it (less the held-out ones, plus the pending ones, with their reasons)', () => {
    const mismatches: Record<string, { found: string[]; named: string[] }> = {};
    for (const [id, w] of Object.entries(EVERY_CARD)) {
      const found = [...new Set(open.filter((c) => w.hint.test(textOf(c))).filter((c) => parseCard(c, OPTS).faces.some((f) => f.templatesUsed.includes(id))).map((c) => c.name))].sort();
      const named = [...w.cards.filter((c) => !(c in HELD_OUT)), ...Object.keys(w.pending ?? {})].sort();
      if (JSON.stringify(found) !== JSON.stringify(named)) mismatches[id] = { found, named };
    }
    expect(mismatches).toEqual({});
  }, 120_000);

  // the try step on real cards: each card's line is read by the named template, passes the exact render gate, and the card is fully automated
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'eff.stdfin.mill.halfLibraryRoundedDown': ['Jidoor, Aristocratic Capital // Overture'], // Traumatize: HELD_OUT
    'eff.stdfin.then.group.gain': ["Moogles' Valor"],
    'eff.stdfin.destroy.all.attachedTo': ['Blastfire Bolt', 'Street Sweeper'], // Treefolk Mystic: HELD_OUT
    'eff.stdfin.destroy.upTo.attachedTo': ['Light of Judgment'],
    'eff.stdfin.damage.andItself.whereXItsPower': ['Self-Destruct'],
    'eff.stdfin.search.may.orBasicLand.reveal.hand': ['Sazh Katzroy'],
    'trg.stdfin.when.duringYourTurn': ['Jenova, Ancient Calamity'], // Hermit of the Natterknolls, Chakram Retriever: HELD_OUT
    'eff.stdfin.draw.equal.player': ['Jenova, Ancient Calamity', "Nissa's Revelation"],
    'eff.stdfin.counters.put.equalTo.before': ["Galuf's Final Act", 'Jenova, Ancient Calamity'],
    'eff.stdfin.may.reveal.putIntoHand': ['Sidequest: Catch a Fish // Cooking Campsite', 'Bucolic Ranch'], // Domri Rade: HELD_OUT
    'trg.stdfin.whenever.andWhenever': ['Giott, King of the Dwarves', 'Necklace of Girion'],
    'eff.stdfin.cast.now': ['Vaan, Street Thief'],
    'eff.stdfin.basepower.becomesEqual.lead': ['PuPu UFO'],
    'eff.stdfin.shuffle.objs.intoYourLibrary': ['Elixir', 'Put Away'], // Piper's Melody: HELD_OUT
    'eff.stdfin.attach.anyNumber': ['Beatrix, Loyal General'], // Battlefield Improvisation: HELD_OUT
    'eff.stdfin.attach.one': ['Unexpected Request'], // Nahiri, Heir of the Ancients: HELD_OUT
    'eff.stdfin.if.unattach.nextEnd': ['Unexpected Request'],
  };
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.join(', ')} read the line with it, pass the render gate and are fully automated`, () => {
      for (const name of names) {
        const oracle = (index ?? []).find((c) => c.name === name);
        expect(oracle, name).toBeDefined();
        expect(open.includes(oracle!), `${name} is an open card (tuning half or Standard-legal, design 6.12)`).toBe(true);
        expect(compileCard(oracle!).automation.level, name).toBe('full');
        const parsed = parseCard(oracle!, OPTS);
        expect(parsed.faces.flatMap((f) => f.templatesUsed), name).toContain(id);
        expect(parsed.faces.every((f) => f.gate.every((g) => g.ok)), name).toBe(true);
      }
    }, 60_000);
  }
});
