/**
 * CLOUD std-msh (cloud batch 2, the Standard backlog of Marvel Super Heroes): the template data of parser/templates/zz-cloud/std-msh.json ("until end of turn, ~'s base
 * power and toughness become 6/6 and they gain trample", "create a tapped <token> if <condition>", "double target creature's power and toughness", "you may cast a
 * spell from among them [with mana value ...] without paying its mana cost", "as long as <condition>, you may cast spells as though they had flash", cost reductions
 * with a mana value limit and "where X is", damage plus N to an opponent or a permanent an opponent controls, "for each <description>, create a token that's a copy
 * of that creature", "<player> reveals a number of cards from their hand equal to N" and "you choose one of them", "can't become untapped <duration>", "<object>
 * becomes a copy of <object> <duration>", "double all damage equipped creature would deal", "Equip worthy {1}").
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10); the real cards each template reads are checked against the local index when it is present.
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so these templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdMsh from '../../../src/parser/templates/zz-cloud/std-msh.json';
import review from '../../m5/golden/cards/cloud-std-msh-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MSH = stdMsh as Template[];

/**
 * Design 6.9 evidence for a stable template: three hand-verified golden cards, or, for a sentence that fewer real cards print, every one of them that may be opened:
 * the tuning half and this slice's backlog (`cards`); the held-out half is never opened (design 6.12), its printers are only named (`heldOut`).
 */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; heldOut?: readonly string[]; line: RegExp }>> = {
  'eff.stdmsh.basept.become.lead.gains': { cards: ['Moon Girl and Devil Dinosaur'], line: /base power and toughness become \d+\/\d+ and (it gains|they gain) / },
  'eff.stdmsh.token.tapped.ifCond': { cards: ['HYDRA Troopers'], line: /(^|\n|, )create a tapped [^.]*? token[^.]* if (?!you do)[^.]*\./i },
  'eff.stdmsh.seen.cast.free': { cards: ['Svella, Ice Shaper'], heldOut: ['Aetherworks Marvel'], line: /of your library\. You may cast a spell from among them without paying its mana cost/ },
  'eff.stdmsh.seen.cast.free.mvAtMost': { cards: ['Cosmic Cube'], line: /You may cast a spell from among them with mana value less than or equal to [^.]* without paying its mana cost/ },
  'eff.stdmsh.seen.cast.free.mvOrLess': { cards: ['Perception Bobblehead'], line: /You may cast a spell with mana value \S+ or less from among them without paying its mana cost/ },
  'sta.stdmsh.aslong.flash': { cards: ['Captain Mar-Vell, Space-Born'], heldOut: ['Kianne, Corrupted Memory', 'Quicksilver, Speedster'], line: /(^|\n|— )As long as [^,.]*, you may cast [^.]* as though they had flash/ },
  'cm.stdmsh.spells.less.you.manaValue.whereX': { cards: ['The Scarlet Witch'], line: /spells you cast with mana value \d+ or greater cost \{X\} less to cast, where X is/ },
  'rep.stdmsh.damage.noncombat.opp.plus.insteadFirst.whereX': { cards: ['Hawkeye, Young Avenger'], line: /would deal noncombat damage to an opponent or a permanent an opponent controls, instead it deals that much damage plus X, where X is/ },
  'rep.stdmsh.damage.noncombat.opp.plus': { cards: ["Artist's Talent"], heldOut: ['Tomik, Izzet Sparkmage'], line: /(^|\n)If a source you control would deal noncombat damage to an opponent or a permanent an opponent controls, it deals that much damage plus \d+ instead/ },
  // merge line D: std-msh's rep.stdmsh.damage.opp.plus was the same template as std-dft's (same pattern and JSON); the line keeps std-dft's one
  'rep.stddft.damage.plus.yourSource.toOpponentOrTheirPermanent': { cards: ['Far Fortune, End Boss'], line: /(^|\n|— )If a source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus \d+ instead/ },
  'eff.stdmsh.forEach.filter.copy.notLegendary': { cards: ['Multiversal Incursion'], line: /For each [^,]*, create a token that's a copy of (it|that creature|that permanent|that artifact), except it isn't legendary/ },
  'eff.stdmsh.rst.cant.becomeUntapped': { cards: ['Spider-Woman, Secret Agent'], line: /can't become untapped for as long as/ },
  'rep.stdmsh.damage.double.attached': { cards: ['Mjölnir, Hammer of Thor'], line: /Double all damage (equipped|enchanted) creature would deal/ },
  'kw.stdmsh.equip.worthy': { cards: ['Mjölnir, Hammer of Thor'], line: /Equip worthy \{/ },
};
/** Design 6.10 exceptions: a template whose every wording is a real card's own sentence (one card prints it, WHOLE_CORPUS), so one example is that sentence. */
const VERBATIM_OK: ReadonlySet<string> = new Set(['Double all damage equipped creature would deal.']);
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind (a trigger or a static ability is a creature's, an effect on its own a spell's). */
export function exampleCard(text: string): OracleCard {
  if (/^equip /i.test(text) || /equipped creature/i.test(text)) return card('Example Blade', 'Artifact — Equipment', text);
  if (/^when this aura|enchanted creature/i.test(text)) return card('Example Charm', 'Enchantment — Aura', `Enchant creature\n${text}`);
  if (/^(when|whenever|at|as long as) /i.test(text) || /spells you cast/i.test(text) || /^(\{[^}]*\})+(, \{T\})?: /.test(text)) return card('Example Brute', 'Creature — Human Wizard', text);
  if (/^if a source/i.test(text)) return card('Example Furnace', 'Enchantment', text);
  return card('Example Volley', 'Sorcery', text);
}
const parsedWith = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;

describe('CLOUD std-msh template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-msh.json, path order: after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-msh.json');
    expect(files.indexOf('zz-cloud/std-msh.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-msh.json')).toBeLessThan(files.indexOf('zz-fast1/t4.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(MSH.length).toBe(18); // merge line D: rep.stdmsh.damage.opp.plus dropped as a duplicate of std-dft's rep.stddft.damage.plus.yourSource.toOpponentOrTheirPermanent
    for (const t of MSH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|cm|kw)\.stdmsh\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of MSH.filter((x) => x.status === 'stable')) {
      const cites = new RegExp(`[( ]${t.id.replaceAll('.', '\\.')}[),;]`); // "(<id>; CR ...)", "(<id>)"
      const cards = golden.filter((g) => cites.test(g.verified)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect([...new Set(cards)].sort(), t.id).toEqual([...whole.cards].sort());
      else expect(new Set(cards).size, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MSH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'double', "can't", 'without', 'except', 'would']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('CLOUD std-msh guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MSH) {
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
    [/until end of turn/i, 'until your next turn'], [/base power and toughness/, 'power and toughness'], [/ gains? /, ' loses '], [/ tapped /, ' untapped '],
    [/ less than or equal to /, ' greater than or equal to '], [/ or less /, ' or greater '], [/without paying its mana cost/, 'by paying {1} more'],
    [/ less to cast/, ' more to cast'], [/ plus /, ' minus '], [/noncombat/, 'combat'], [/ an opponent controls/, ' you control'], [/copy of/, 'shard of'],
    [/ one of them/, ' two of them'], [/ their hand/, ' your hand'], [/can't become untapped/, "can't become tapped"], [/Double all/, 'Prevent all'], [/worthy/, 'unworthy'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('CLOUD std-msh guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MSH) {
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

describe('CLOUD std-msh guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of MSH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~,' || /^\{/.test(w) || /^~'s/.test(w)) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('CLOUD std-msh design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  it('no line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~"), except the listed ones', () => {
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
    const verbatim = MSH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => lines.has(x.trim()) && !VERBATIM_OK.has(x)).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
  it('the cards named as the whole corpus of a sentence are every card of the index that prints it', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = (index ?? []).filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && w.line.test(x))).map((c) => c.name);
      expect([...new Set(found)].sort(), id).toEqual([...w.cards, ...(w.heldOut ?? [])].sort());
    }
  }, 120_000);

  // the try step on real cards: each card is read by the named template, passes the exact render gate and is fully automated
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'eff.stdmsh.basept.become.lead.gains': ['Moon Girl and Devil Dinosaur'],
    'eff.stdmsh.token.tapped.ifCond': ['HYDRA Troopers'],
    'eff.stdmsh.double.pt.possessive': ['Epic Fight', "Nylea's Colossus", 'Choose Your Weapon'],
    'eff.stdmsh.seen.cast.free': ['Svella, Ice Shaper'],
    'eff.stdmsh.seen.cast.free.mvAtMost': ['Cosmic Cube'],
    'eff.stdmsh.seen.cast.free.mvOrLess': ['Perception Bobblehead'],
    'sta.stdmsh.aslong.flash': ['Captain Mar-Vell, Space-Born'],
    'cm.stdmsh.spells.less.you.manaValue.whereX': ['The Scarlet Witch'],
    'rep.stdmsh.damage.noncombat.opp.plus.insteadFirst.whereX': ['Hawkeye, Young Avenger'],
    'rep.stdmsh.damage.noncombat.opp.plus': ["Artist's Talent"],
    'rep.stddft.damage.plus.yourSource.toOpponentOrTheirPermanent': ['Far Fortune, End Boss'], // merge line D: the std-dft duplicate of rep.stdmsh.damage.opp.plus
    'eff.stdmsh.forEach.filter.copy': ['Clone Legion', 'Rhys the Redeemed', 'Ocelot Pride'],
    'eff.stdmsh.forEach.filter.copy.notLegendary': ['Multiversal Incursion'],
    'eff.stdmsh.player.reveals.cardsFromHand.equalTo': ['Klaw, Sonic Subjugator', "Mire's Toll", 'Disciple of Phenax'],
    'eff.stdmsh.you.choose.oneOf': ['Klaw, Sonic Subjugator', "Mire's Toll", 'Disciple of Phenax'],
    'eff.stdmsh.rst.cant.becomeUntapped': ['Spider-Woman, Secret Agent'],
    'eff.stdmsh.becomeCopy.dur': ['Secret Invasion', 'Shapesharer', 'Mirage Mirror'],
    'rep.stdmsh.damage.double.attached': ['Mjölnir, Hammer of Thor'],
    'kw.stdmsh.equip.worthy': ['Mjölnir, Hammer of Thor'],
  };
  /** Cards whose other abilities are not all automated (the line the template reads is: the golden file checks it). */
  const PARTIAL_OK: ReadonlySet<string> = new Set(['Ocelot Pride']);
  it('every template has real cards here', () => {
    for (const t of MSH) expect(REAL[t.id]?.length ?? 0, t.id).toBeGreaterThan(0);
  });
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.join(', ')} read with it, pass the render gate and are fully automated`, () => {
      for (const name of names) {
        const oracle = (index ?? []).find((c) => c.name === name);
        expect(oracle, name).toBeDefined();
        const c = compileCard(oracle!);
        if (!PARTIAL_OK.has(name)) expect(c.automation.level, name).toBe('full');
        const parsed = parseCard(oracle!, OPTS);
        expect(parsed.faces.flatMap((f) => f.templatesUsed), name).toContain(id);
        expect(parsed.faces.every((f) => f.gate.every((g) => g.ok)), name).toBe(true);
      }
    });
  }
});
