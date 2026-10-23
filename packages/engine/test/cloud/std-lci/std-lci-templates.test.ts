/**
 * Cloud std-lci (Standard backlog of The Lost Caverns of Ixalan): the template data of parser/templates/zz-cloud/std-lci.json and the parser readings beside
 * them (explores, "this way", the player with the most life, cards from the top, digs, casting with the mana of ~, mana abilities that do one more thing, the
 * owner of a target, ...).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10); the real cards each template reads are checked against the local index when it is present.
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the std-lci templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdLci from '../../../src/parser/templates/zz-cloud/std-lci.json';
import review from '../../m5/golden/cards/cloud-std-lci-review.json';
import r4FxbReview from '../../m5/golden/cards/cloud-r4-fxb-review.json'; // Standard round 4 r4-fxb: the golden cards of eff.stdlci.dig.put.eitherOr.hand
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex, openCards, openToTuning } from '../../m5/parser/support';

const STD_LCI = stdLci as Template[];

/**
 * Design 6.9 evidence for a stable template: three hand-verified golden cards, or, for a sentence only one or two real cards print, every one of them. Only
 * open cards count (design 6.12: the tuning half and Standard-legal cards; a held-out non-Standard card measures retention and is not read), so "every one"
 * is every open card. `pending`: an open card that prints the line but is not evidence yet, with the reason.
 */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp; pending?: Readonly<Record<string, string>> }>> = {
  // the instruction with "it" or "that creature" as its subject (a replacement's "instead it explores, then it explores again" is another shape)
  'eff.stdlci.explores.again': {
    cards: ['Defossilize'], line: /(When [^.,]+, it|\. That creature) explores, then it explores again/,
    pending: { 'Jadelight Ranger': 'open since the hash split of 2026-10-19; reads the line with the template and compiles full, not hand-verified golden evidence yet (design 6.9)' },
  },
  'eff.stdlci.search.may.or.reveal.top': { cards: ['Compass Gnome'], line: /search your library for a basic land card or [A-Z][a-z]+ card, reveal it, then shuffle and put that card on top/ },
  // the other printing stays manual for its next sentence (reviewed: nothing wrong is automated)
  // Invasion of Gobakhan is HELD_OUT
  'eff.stdlci.may.exile.handcard': { cards: ['Deep-Cavern Bat', 'Invasion of Gobakhan // Lightshield Array'], line: /look at target opponent's hand\. You may exile a nonland card from it/ },
  'eff.stdlci.counters.put.forEachLeftUnderYourControl': { cards: ["Kutzil's Flanker"], line: /for each creature that left the battlefield under your control this turn/ },
  'rid.stdlci.mana.spendOnly.cantBeCountered': { cards: ['Cavern of Souls', 'Delighted Halfling'], line: /, and that spell can't be countered/ },
  // (dethrone's reminder text prints the words too, and "equipped creature" is another subject: neither is a line of this trigger)
  'trg.stdlci.attacks.mostLife': { cards: ['Preacher of the Schism', 'Undercover Butler'], line: /^Whenever this creature attacks the player with the most life or tied for most life/m },
  // Glimpse of Tomorrow is HELD_OUT
  'eff.stdlci.reveal.n.fromTop': { cards: ["Gishath, Sun's Avatar", 'Glimpse of Tomorrow', 'Ojer Kaslem, Deepest Growth // Temple of Cultivation'], line: /reveal that many cards from the top of your library/ },
  'eff.stdlci.dig.anyNumber.bf.rest.bottomRandom': { cards: ["Gishath, Sun's Avatar"], line: /Put any number of [A-Za-z ]+ cards from among them onto the battlefield and the rest on the bottom of your library in a random order/ },
  'eff.stdlci.dig.put.eitherOr.bf': { cards: ['Eivor, Wolf-Kissed', 'Ojer Kaslem, Deepest Growth // Temple of Cultivation'], line: /You may put an? [A-Za-z]+ card and\/or an? [A-Za-z]+ card from among them onto the battlefield/ },
  'eff.stdlci.thenIf.counters.removeTransform': { cards: ["Brass's Tunnel-Grinder // Tecutlan, the Searing Rift"], line: /, remove those counters and transform it/ },
  'eff.stdlci.return.bf.owner.tapped.transformed.counters': { cards: ['Ojer Pakpatiq, Deepest Epoch // Temple of Cyclical Time'], line: /return it to the battlefield tapped and transformed under its owner's control with/ },
  'eff.stdlci.player.discovers.whereX': { cards: ["Zoyowa's Justice"], line: /that player discovers X/ },
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind (a trigger or "{cost}:" is a permanent's, an effect on its own a spell's). */
function exampleCard(text: string): OracleCard {
  if (/^(when|whenever|at) /i.test(text)) return card('Example Brute', 'Creature — Elf Warrior', text);
  if (/^As ~ enters/.test(text)) return card('Example Grotto', 'Land', text);
  if (/^\{[^}]*\}[^:]*:/.test(text)) return card('Example Engine', 'Artifact', text);
  return card('Example Volley', 'Sorcery', text);
}
const parsedWith = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;

describe('std-lci template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-lci.json, path order: after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-lci.json');
    expect(files.indexOf('zz-cloud/std-lci.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-lci.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(STD_LCI.length).toBe(19); // merge of lines C and D: eff.stdlci.look.n.fromTop dropped, std-blb's eff.stdblb.look.nFromTop is the same template
    for (const t of STD_LCI) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg|rid)\.stdlci\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable std-lci template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = [...review, ...r4FxbReview] as { card: string; verified: string }[];
    for (const t of STD_LCI.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole.cards].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('design 6.9: the M6 return "tapped and transformed under its owner\'s control" is stable on three verified golden cards (Aclazotz, Ojer Kaslem, Ojer Taq)', () => {
    expect(TEMPLATE_SET.find((t) => t.id === 'eff.m6.return.bf.owner.tapped.transformed')?.status).toBe('stable');
    const golden = review as { card: string; verified: string }[];
    expect(golden.filter((g) => g.verified.includes('(eff.m6.return.bf.owner.tapped.transformed)')).map((g) => g.card).sort())
      .toEqual(['Aclazotz, Deepest Betrayal // Temple of the Dead', 'Ojer Kaslem, Deepest Growth // Temple of Cultivation', 'Ojer Taq, Deepest Foundation // Temple of Civilization']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of STD_LCI) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z'/]+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'again', 'random', 'and/or']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('std-lci guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of STD_LCI) {
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
    [/ your hand/, ' your graveyard'], [/ onto the battlefield/, ' into your graveyard'], [/ explores again/, ' explores'], [/ most life/, ' least life'],
    [/ from the top of/, ' from the bottom of'], [/ in a random order/, ' in any order'], [/ and\/or /, ' or '], [/ exiled /, ' milled '], [/ mana produced by/, ' mana spent by'],
    [/ three or more/, ' three or fewer'], [/ transform it/, ' sacrifice it'], [/ discovers/, ' scries'], [/ can't be countered/, " can't be copied"],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('std-lci guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of STD_LCI) {
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

describe('std-lci guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of STD_LCI) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '~,' || /^\{/.test(w)) return;
          if (/^counters?$/.test(words[i + 1] ?? '')) return; // counter names are an open class (design 6.11, CR 122.1; as T70's guard)
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

/** Readings beside the templates (parser holes, lowering passes, renderer), each with a synthetic wording, and the near misses that must stay manual. */
describe('std-lci readings outside the template file', () => {
  const full = (text: string, type = 'Sorcery') => fullyAutomated(parseCard(card('Example Card', type, text), OPTS).faces[0]!);
  it('CR 608.2c, 400.7: "for each card exiled this way" counts what the exile itself moved; "those cards" after several target cards exiled', () => {
    expect(full('Exile up to two target cards from your graveyard. Add {R} for each card exiled this way.', 'Instant')).toBe(true);
    expect(full('Exile any number of target cards from your graveyard. Add {R} for each card exiled this way. You may play those cards this turn.')).toBe(true);
    expect(full('Exile target card from a graveyard. You gain 1 life for each card exiled this way.')).toBe(true);
    expect(full('Add {R} for each card exiled this way.', 'Instant')).toBe(false); // nothing exiled before it
    expect(full('Destroy up to two target creatures. You gain 1 life for each creature exiled this way.')).toBe(false); // destroyed, not exiled
  });
  it('CR 608.2c: "if you exiled a land card this way" reads the move that exiled; with no exile it stays manual', () => {
    expect(full('Exile the top two cards of your library. If you exiled a land card this way, you gain 3 life.')).toBe(true);
    expect(full('Mill two cards. If you exiled a land card this way, you gain 3 life.')).toBe(false);
  });
  it('CR 401.2, 603.2: "that many cards from the top of your library" needs a number the trigger or an earlier step gave', () => {
    expect(full('Whenever ~ deals combat damage to a player, exile that many cards from the top of your library.', 'Creature — Elf')).toBe(true);
    expect(full('Exile that many cards from the top of your library.')).toBe(false);
    // the counters a dying creature had are not the event's amount: "that many" stays unresolved
    expect(full('Whenever a creature you control with one or more counters on it dies, draw that many cards.', 'Creature — Elf')).toBe(false);
  });
  it('CR 106.3, 110.4b: "a permanent spell", and "using mana produced by ~" only of the object itself', () => {
    expect(full('Whenever you cast a permanent spell, you gain 1 life.', 'Enchantment')).toBe(true);
    expect(full('{T}: Add {G}.\nWhenever you cast a creature spell using mana produced by ~, you gain 1 life.', 'Artifact')).toBe(true);
    expect(full('Whenever you cast a creature spell using mana produced by a Forest, you gain 1 life.', 'Artifact')).toBe(false);
  });
  it('CR 605.3b: a mana ability may also remove or put a counter on ITSELF, or add one of two plain amounts; anything else stays manual', () => {
    expect(full('{T}: Add {U}. Remove a time counter from ~.', 'Artifact')).toBe(true);
    expect(full('{T}: Add {G}. If you control a creature with power 4 or greater, add {G}{G} instead.', 'Artifact')).toBe(true);
    expect(full('{T}: Add {U}. Put a +1/+1 counter on each creature you control.', 'Artifact')).toBe(false); // not the object itself
    expect(full('{T}: Add {U}. Put a +1/+1 counter on target creature.', 'Artifact')).toBe(true); // a target: no mana ability (CR 605.1a), it uses the stack
    // CMD5 (wave 4, CR 605.3b, 120.3): a pain land's fixed damage to its controller is run by the resolver too (cap-walk.ts#nativeManaEffect); damage to anyone else stays manual
    expect(full('{T}: Add {R} or {G}. ~ deals 1 damage to you.', 'Land')).toBe(true);
    expect(full('{T}: Add {R}. ~ deals 1 damage to each opponent.', 'Land')).toBe(false);
  });
  it('CR 602.5b: "Activate only if it has no time counters on it": "it" is the object itself', () => {
    expect(full('{2}, {T}: Put a +1/+1 counter on ~. Activate only if it has no time counters on it.', 'Artifact')).toBe(true);
  });
  it('CR 701.9a: "Whenever an opponent discards a land card" (a card in a hand, not a permanent)', () => {
    expect(full('Whenever an opponent discards a land card, you gain 1 life.', 'Enchantment')).toBe(true);
  });
  it('CR 119.1: "the player with the most life or tied for most life" is the defending player compared with every player', () => {
    expect(full('Whenever ~ attacks while you have the most life or are tied for most life, draw a card.', 'Creature — Elf')).toBe(true);
  });
  it('CR 122.1: "no time counters on it" (none of one kind) and "creatures you control that are Fungi and/or Saprolings"', () => {
    expect(full('~ gets +1/+1 for each creature you control that is a Fungus or Saproling.', 'Creature — Fungus')).toBe(false); // not a wording the renderer reads
    expect(full("~'s power is equal to the number of creatures you control that are Fungi and/or Saprolings.", 'Creature — Fungus')).toBe(true);
  });
});

const index = localIndex();

/**
 * Cards this slice read while the halves still alternated by position (before 2026-10-19), which the hash split put in the held-out half and which are not
 * Standard-legal (docs/CARD_AUTOMATION.md section 4): no longer read, scanned or used as evidence. Their golden entries were verified while they were
 * tuning-half cards and stay; the owner may strip them as round 4's r4-dig precedent did. The test below fails when one of them becomes open again (a
 * format change), so it can be re-examined.
 */
const HELD_OUT: Readonly<Record<string, string>> = {
  'Invasion of Gobakhan // Lightshield Array': 'eff.stdlci.may.exile.handcard: held-out since the hash split of 2026-10-19 (design 6.12)',
  'Glimpse of Tomorrow': 'eff.stdlci.reveal.n.fromTop: held-out since the hash split of 2026-10-19 (design 6.12)',
  'Kairi, the Swirling Sky': 'eff.stdlci.return.upto.yourhand: held-out since the hash split of 2026-10-19 (design 6.12)',
  "Myojin of Life's Web": 'eff.stdlci.put.anyNumber.bf: held-out since the hash split of 2026-10-19 (design 6.12)',
};
/** Cards held out of the tuning half are never read here (none is named below). */

describe.skipIf(index === null)('std-lci design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads (open cards, design 6.12)', () => {
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
        const names = [c.name, ...(c.card_faces ?? []).map((x) => x.name), ...c.name.split(', ').slice(0, 1)];
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          let r = l;
          for (const n of names) r = r.replaceAll(n, '~');
          lines.add(r.replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|token)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = STD_LCI.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => lines.has(x.trim())).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
  it('the cards named as the whole corpus of a sentence are every open card of the index that prints it, less the held-out ones, plus the pending ones (design 6.12)', () => {
    const mismatches: Record<string, { found: string[]; named: string[] }> = {};
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = [...new Set(open.filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && w.line.test(x))).map((c) => c.name))].sort();
      const named = [...w.cards.filter((c) => !(c in HELD_OUT)), ...Object.keys(w.pending ?? {})].sort();
      if (JSON.stringify(found) !== JSON.stringify(named)) mismatches[id] = { found, named };
    }
    expect(mismatches).toEqual({});
  }, 120_000);

  // the try step on real cards: each card reads its line with the named template, passes the exact render gate, and is fully automated
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'eff.stdlci.explores.again': ['Defossilize'],
    'eff.stdlci.return.upto.yourhand': ['Another Chance'], // Kairi, the Swirling Sky: HELD_OUT
    'eff.stdlci.search.may.or.reveal.top': ['Compass Gnome'],
    'eff.stdlci.put.anyNumber.bf': ['Ghalta, Stampede Tyrant', 'Last March of the Ents'], // Myojin of Life's Web: HELD_OUT
    'eff.stdlci.may.exile.handcard': ['Deep-Cavern Bat'],
    'eff.stdlci.counters.put.forEachLeftUnderYourControl': ["Kutzil's Flanker"],
    'rid.stdlci.mana.spendOnly.cantBeCountered': ['Cavern of Souls', 'Delighted Halfling'],
    'trg.stdlci.attacks.mostLife': ['Preacher of the Schism', 'Undercover Butler'],
    'eff.stdlci.reveal.n.fromTop': ["Gishath, Sun's Avatar", 'Ojer Kaslem, Deepest Growth // Temple of Cultivation'],
    'eff.stdlci.dig.anyNumber.bf.rest.bottomRandom': ["Gishath, Sun's Avatar"],
    'eff.stdlci.dig.put.eitherOr.bf': ['Ojer Kaslem, Deepest Growth // Temple of Cultivation'],
    'eff.stdlci.thenIf.counters.removeTransform': ["Brass's Tunnel-Grinder // Tecutlan, the Searing Rift"],
    'eff.stdlci.return.bf.owner.tapped.transformed.counters': ['Ojer Pakpatiq, Deepest Epoch // Temple of Cyclical Time'],
    'eff.stdlci.player.discovers.whereX': ["Zoyowa's Justice"],
    'eff.m6.return.bf.owner.tapped.transformed': ['Ojer Kaslem, Deepest Growth // Temple of Cultivation'],
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
