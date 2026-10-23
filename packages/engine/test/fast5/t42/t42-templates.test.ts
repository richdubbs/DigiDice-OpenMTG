/**
 * FAST5 T42 (returns and searches with relative mana value, distinct names, attached or transformed entry): the template data of
 * parser/templates/zz-fast5/t42.json.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present; the real cards each template reads are checked
 * there too (the try step of CONTRIBUTING "Adding a template").
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T42 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import t42 from '../../../src/parser/templates/zz-fast5/t42.json';
import review from '../../m5/golden/cards/fast5-t42-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T42 = t42 as Template[];

/**
 * Design 6.9 evidence for a stable template: three hand-verified golden cards (test/m5/golden/cards/fast5-t42-review.json), or, for a sentence that fewer
 * real cards print, every one of them (the index check below proves there is no other). `partialCards`: a card of that corpus whose other lines stay manual
 * for a reason outside the template, so it is not pinned `expect: "full"` (and has no golden entry).
 */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp; partialCards?: readonly string[] }>> = {
  'eff.t42.return.self.gy.bf.transformed': { cards: ['Garland, Knight of Cornelia // Chaos, the Endless'], line: /: Return (?:this card|[^:.]+?) from your graveyard to the battlefield transformed/ },
  'eff.t42.return.self.gy.bf.attached': { cards: ["Craving of Yeenoghu", "Eagle's Rescue", "Gryff's Boon"], partialCards: ['Craving of Yeenoghu'], line: /: Return (?:this card|[^:.]+?) from your graveyard to the battlefield attached to target creature/ },
  'eff.t42.return.bf.attached': { cards: ['Magnetic Snuffler'], line: /[Rr]eturn target Equipment card from your graveyard to the battlefield attached to (?:this creature|~)/ },
  'eff.t42.return.toBattlefield.lead': { cards: ['Squirming Emergence'], line: /Return to the battlefield target/ },
  'eff.t42.draw.thenMayPutHand.tapped': { cards: ['Anticausal Vestige', 'H.E.R.B.I.E. Scout Unit'], line: /draw a card, then you may put an? [^.]+ from your hand onto the battlefield tapped\./ },
  'eff.t42.search.mvEqual.battlefield': { cards: ['Birthing Pod', 'Enigmatic Incarnation', 'Prime Speaker Vannifar', 'Repurposing Bay'], partialCards: ['Enigmatic Incarnation'], line: /[Ss]earch your library for an? [^.]+ card with mana value equal to [^.]+, put that card onto the battlefield, then shuffle\./ },
  'eff.t42.search.reveal.handOrGraveyard': { cards: ["Dina's Guidance"], line: /reveal it, put it into your hand or graveyard, then shuffle/ },
  // FAST5 batch 4: the bare sentence only; 'Put one of them ...' (Sibsig Appraiser, Visionary's Dance) is FAST5 T43's eff.t43.dig.putHand.rest.graveyard
  'eff.t42.putOneHand.otherGraveyard': { cards: ['Faerie Snoop', 'Codecracker Hound'], line: /look at the top two cards of your library. Put one into your hand and the other into your graveyard/ },
  'eff.t42.search.upTo.differentNames.battlefield.tapped': { cards: ['Reach the Horizon'], line: /Search your library for up to two basic land cards and\/or Town cards with different names/ },
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which a T42 example is an ability of the right kind: an ability or a trigger on a creature, a spell's own text on an instant. */
function exampleCard(_t: Template, text: string): OracleCard {
  if (/~|^\{|^When /.test(text) || text.includes('\n')) return card('Example Brute', 'Creature — Elf Warrior', text);
  return card('Example Volley', 'Instant', text);
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('T42 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast5/t42.json, after zz-fast4/t34.json, before zz-m6/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t42.json');
    expect(files.indexOf('zz-fast5/t42.json')).toBeGreaterThan(files.indexOf('zz-fast4/t34.json'));
    expect(files.indexOf('zz-fast5/t42.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(T42.length).toBe(Object.keys(WHOLE_CORPUS).length + 2); // FAST5 batch 4: eff.t42.putOneHand.otherGraveyard moved to WHOLE_CORPUS (its "of them" cards are T43's)
    for (const t of T42) {
      expect(t.id, t.id).toMatch(/^eff\.t42\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable T42 template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of T42.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole && cards.length < 3) expect(cards.slice().sort(), t.id).toEqual(whole.cards.filter((c) => !whole.partialCards?.includes(c)).sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T42) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'different']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('T42 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T42) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
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

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const lines = text.split('\n');
  const mine = lines.findIndex((l) => !/^(Flying|Trample)$/.test(l));
  const body = lines[mine]!.replace(/\.$/, '');
  const rest = (b: string): string => lines.map((l, i) => (i === mine ? b : l)).join('\n');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bto the battlefield\b/, 'to your hand'], [/\bonto the battlefield\b/, 'into your hand'], [/\btransformed\b/, 'tapped'], [/\bfrom your graveyard\b/, 'from a graveyard'],
    [/\bless than or equal to\b/, 'less than'], [/\bwith different names\b/, 'with the same name'], [/\breveal it\b/, 'reveal them'], [/\bhand or graveyard\b/, 'hand or library'],
    [/\bthe other into your graveyard\b/, 'the other into your hand'], [/\btop two\b/, 'top three'], [/\bequal to\b/, 'less than'], [/\bwhere X is\b/, 'where Y is'],
    [/\bthe number of\b/, 'twice the number of'], [/\bdraw a card\b/i, 'draw two cards'], [/\battached to\b/, 'tapped and attached to'], [/\bup to two\b/, 'two'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out.map((m) => rest(m.replace(/\.$/, '') + '.'));
}

describe('T42 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T42) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
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

describe('T42 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T42) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w) || /^"?\{/.test(w) || w.includes('\n')) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('T42 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  // sentences with no word to vary: rules phrases fixed by their pattern
  const FIXED_WORDING = new Set<string>(['eff.t42.search.reveal.handOrGraveyard']);
  const SETUP = new Set(['Flying', 'Trample', 'Draw a card.', 'Scry 1, then look at the top two cards of your library.']);
  it('no T42 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = T42.filter((t) => !FIXED_WORDING.has(t.id)).flatMap((t) =>
      [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !SETUP.has(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  // the try step on real cards: each card's T42 line is read by the named template and passes the exact render gate, never manual on that line
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'eff.t42.return.self.gy.bf.transformed': ['Garland, Knight of Cornelia // Chaos, the Endless'],
    'eff.t42.return.self.gy.bf.attached': ["Eagle's Rescue", "Gryff's Boon"],
    'eff.t42.return.bf.attached': ['Magnetic Snuffler'],
    'eff.t42.return.toBattlefield.lead': ['Squirming Emergence'],
    'eff.t42.draw.thenMayPutHand.tapped': ['Anticausal Vestige', 'H.E.R.B.I.E. Scout Unit'],
    'eff.t42.return.bf.whereX': ['Astelli Reclaimer', "Moseo, Vein's New Dean", 'Celestine, the Living Saint', 'Unforgiving One'],
    'eff.t42.search.mvEqual.battlefield': ['Repurposing Bay', 'Birthing Pod', 'Prime Speaker Vannifar'],
    'eff.t42.search.reveal.handOrGraveyard': ["Dina's Guidance"],
    'eff.t42.look.topTwo': ['Faerie Snoop', 'Codecracker Hound', 'Sibsig Appraiser', 'Orazca Puzzle-Door'],
    // "put one of them ..." (Sibsig Appraiser, Visionary's Dance) is FAST5 T43's eff.t43.dig.putHand.rest.graveyard, the dig that reads any number looked at
    'eff.t42.putOneHand.otherGraveyard': ['Faerie Snoop', 'Codecracker Hound'],
    'eff.t42.search.upTo.differentNames.battlefield.tapped': ['Reach the Horizon'],
  };
  it('the cards named as the whole corpus of a sentence are every card of the index that prints it', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = (index ?? []).filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && w.line.test(x))).map((c) => c.name);
      expect([...new Set(found)].sort(), id).toEqual([...w.cards].sort());
    }
  }, 120_000);
  const LINE = /graveyard to the battlefield|your library for|look at the top two|put one (?:of )?(?:them |those cards )?into your hand|draw a card, then you may put/i;
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.join(', ')} read the line with it, pass the render gate and leave no manual ability for it`, () => {
      for (const name of names) {
        const c = (index ?? []).find((x) => x.name === name);
        expect(c, name).toBeDefined();
        const f = parseCard(c!, OPTS).faces[0]!;
        expect(f.templatesUsed, name).toContain(id);
        const def = compileCard(c!);
        const manual = def.faces[0]!.abilities.filter((a) => a.kind === 'manual' && LINE.test(a.text));
        expect(manual.map((a) => a.text), name).toEqual([]);
      }
    });
  }
});

describe('T42 neighbors stay as they were (guard G10: a formerly automated unit never gets worse)', () => {
  const parse = (type: string, text: string) => parseCard(card('Example Card', type, text), OPTS).faces[0]!;
  it('"with different names" in a COST is not read (it would be dropped): the cost stays a manual confirmation and the effect stays automated, as before', () => {
    const f = parse('Creature — Wizard', '{1}{U}{U}, Discard three cards with different names: Draw five cards.');
    const a = f.abilities[0]!;
    expect(a.kind).toBe('activated');
    expect(JSON.stringify(a)).toContain('"op":"draw"');
    expect(JSON.stringify(a)).not.toContain('differentNames');
    expect(compileCard(card('Example Card', 'Creature — Wizard', '{1}{U}{U}, Discard three cards with different names: Draw five cards.')).automation.level).toBe('partial');
  });
  it('an Aura that returns itself attached to "that creature" leaves the sentence before it automated (the new attached templates read targets only)', () => {
    const f = parse('Enchantment — Aura', 'Enchant creature\nWhen enchanted creature dies, return that card to the battlefield under its owner\'s control. Return ~ to the battlefield attached to that creature at the beginning of the next end step.');
    const trig = f.abilities.find((a) => a.kind === 'triggered')!;
    expect(JSON.stringify(trig)).toContain('"op":"move"');
    expect(fullyAutomated(f)).toBe(false);
  });
  it('"put one into your hand and the other into your graveyard" with no look before it names an unbound binding: manual, never a guess', () => {
    expect(fullyAutomated(parse('Instant', 'Put one into your hand and the other into your graveyard.'))).toBe(false);
  });
  // std-ry4 (changed on purpose): the additional costs whose count the engine announces as X ("sacrifice X creatures", "discard X cards", ...) give the spell an
  // X too (parser/parse.ts#cardHasXCost; rules/cost.ts#costHasX); a cost the parser does not list still leaves the effect that reads X manual
  it('only the additional costs that announce an X (pay X life; sacrifice, discard, exile or return X) give the other lines an X (CR 107.3a): any other cost with an X leaves the effect that reads X manual', () => {
    expect(fullyAutomated(parse('Sorcery', 'As an additional cost to cast this spell, tap X untapped creatures you control.\nDestroy each creature with mana value X.'))).toBe(false);
    expect(fullyAutomated(parse('Sorcery', 'As an additional cost to cast this spell, sacrifice X creatures.\nDestroy each creature with mana value X.'))).toBe(true);
    expect(fullyAutomated(parse('Sorcery', 'As an additional cost to cast this spell, pay X life.\nDestroy each creature with mana value X.'))).toBe(true);
  });
});
