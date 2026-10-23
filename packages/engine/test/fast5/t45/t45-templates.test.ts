/**
 * FAST5 T45 (copy spells and abilities): the template data of parser/templates/zz-fast5/t45.json, and the parser/renderer support the templates needed.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present; the real cards each template reads are checked
 * there too (the try step of CONTRIBUTING "Adding a template").
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T45 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import t45 from '../../../src/parser/templates/zz-fast5/t45.json';
import review from '../../m5/golden/cards/fast5-t45-review.json';
import r4FxbReview from '../../m5/golden/cards/cloud-r4-fxb-review.json'; // Standard round 4 r4-fxb: Photon Blast Barrage (eff.t45.copy.xTimes)
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T45 = t45 as Template[];

/**
 * Design 6.9 evidence for a stable template: three hand-verified golden cards (test/m5/golden/cards/fast5-t45-review.json), or, for a sentence that fewer real
 * cards print, every one of them (the index check below proves there is no other). `partialCards`: a card of that corpus whose other lines stay manual for a
 * reason outside the template, so it is not pinned `expect: "full"`.
 */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp; partialCards?: readonly string[] }>> = {
  'eff.t45.next.cast.copy.twice': { cards: ['Complete the Circuit', 'Summon: G.F. Cerberus'], line: /when you next cast [^\n(]*copy (that spell|it) twice\./i },
  'eff.t45.next.cast.copy.newTargets': {
    cards: ['Adaptive Training Post', 'Jeong Jeong, the Deserter'],
    line: /when you next cast [^\n(]*copy (that spell|it) and you may choose new targets for the copy/i,
    partialCards: ['Adaptive Training Post'],
  },
  'eff.t45.next.spell.copy': { cards: ['Flamehold Grappler'], line: /copy the next spell you cast this turn when you cast it/i },
  'eff.t45.copy.forEachOtherCastBefore': { cards: ['Thousand-Year Storm'], line: /copy it for each other instant and sorcery spell you've cast before it this turn/i },
  'trg.t45.cast.whileSelfAttacking': { cards: ['Fire Lord Azula'], line: /^whenever you cast a spell while [^\n,]* is attacking/im },
  'eff.t45.copy.andNewTargets': {
    cards: ['Mica, Reader of Ruins', 'Mizzix, Replica Rider', 'Odds // Ends', 'Primal Amulet // Primal Wellspring', "Pyromancer's Goggles", 'The Mystery Raceway'],
    line: /^(?!.*when you next cast)[^(\n]*copy (it|that spell) and you may choose new targets for the copy/im,
    partialCards: ['Mizzix, Replica Rider', 'Odds // Ends', 'Primal Amulet // Primal Wellspring', "Pyromancer's Goggles", 'The Mystery Raceway'],
  },
  // Standard round 4 r4-fxb promoted it (golden: Photon Blast Barrage in test/m5/golden/cards/cloud-r4-fxb-review.json; played in
  // test/cloud/r4-fxb/r4-fxb-scenarios.test.ts, where the cast trigger reads its spell's X, CR 107.3m); Gogo's copy line stays manual for its other riders
  'eff.t45.copy.xTimes': { cards: ['Gogo, Master of Mimicry', 'Photon Blast Barrage'], line: /copy (it|target [^\n.]*) X times/i, partialCards: ['Gogo, Master of Mimicry'] },
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which a T45 example is an ability of the right kind: a spell's own wording on an instant, a trigger on an enchantment, an ability on an artifact. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'trigger' || /^Whenever /.test(text)) return card('Example Engine', 'Enchantment', text);
  if (text.includes(':')) return card('Example Gem', 'Artifact', text);
  if (t.kind === 'effect' || t.kind === 'rider') return card('Example Volley', 'Instant', text);
  return card('Example Brute', 'Creature — Elf Warrior', text);
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('T45 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast5/t45.json, after zz-fast4/t34.json, before zz-m6/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t45.json');
    expect(files.indexOf('zz-fast5/t45.json')).toBeGreaterThan(files.indexOf('zz-fast4/t34.json'));
    expect(files.indexOf('zz-fast5/t45.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(T45.length).toBe(9);
    for (const t of T45) {
      expect(t.id, t.id).toMatch(/^(eff|trg|rid)\.t45\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable T45 template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = [...review, ...r4FxbReview] as { card: string; verified: string }[];
    for (const t of T45.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(`, ${t.id}`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole && cards.length < 3) expect(cards.slice().sort(), t.id).toEqual(whole.cards.filter((c) => !whole.partialCards?.includes(c)).sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T45) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'when', 'whenever', 'while', 'twice']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('T45 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T45) {
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
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bthis turn\b/, 'this combat'], [/\bnext\b/, 'first'], [/\bcast\b/, 'play'], [/\bthat spell\b/, 'target spell'], [/\bcopy\b/, 'exile'], [/\byou\b/, 'an opponent'],
    [/\bcreature\b/, 'land'], [/\battacking\b/, 'blocking'], [/\bartifact\b/, 'creature'], [/\bmay\b/, 'must'], [/\bcopies\b/, 'copy'], [/\bwhenever\b/, 'when'],
    [/\bsource\b/, 'permanent'], [/\bbefore it\b/, 'after it'], [/\bother\b/, 'each'], [/\bonly\b/, 'not'], [/\bsingle\b/, 'second'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('T45 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T45) {
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

describe('T45 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T45) {
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

describe('T45 parser and renderer support (the shapes the templates read are exact, never approximate)', () => {
  const parse = (name: string, type: string, text: string) => parseCard(card(name, type, text), OPTS).faces[0]!;
  const gateOk = (f: ReturnType<typeof parse>): boolean => f.gate.every((g) => g.ok);

  it('a rider reaches the copy inside "you may copy it", "you may pay ... If you do, copy it" and a delayed trigger (CR 707.10c; opt-in @into)', () => {
    for (const text of [
      'Whenever you cast an instant spell, you may copy it. You may choose new targets for the copy.',
      'Whenever you cast an instant spell, you may pay {2}. If you do, copy that spell. You may choose new targets for the copy.',
      'When you next cast a creature spell this turn, copy that spell. You may choose new targets for the copy.',
    ]) {
      const f = parse('Example Engine', text.startsWith('When you next') ? 'Instant' : 'Enchantment', text);
      expect(fullyAutomated(f), text).toBe(true);
      expect(gateOk(f), text).toBe(true);
      expect(JSON.stringify(f.abilities)).toContain('"newTargets":"may"');
    }
  });
  it('a rider never reaches through a wrapper that has another branch ("Otherwise") or through a step that is not the copy', () => {
    const f = parse('Example Engine', 'Enchantment', 'Whenever you cast an instant spell, you may draw a card. You may choose new targets for the copy.');
    expect(fullyAutomated(f)).toBe(false);
  });
  it('the plural rider needs a copy with a number of copies, the singular one a single copy', () => {
    expect(fullyAutomated(parse('Example Volley', 'Instant', 'Copy target instant spell. You may choose new targets for the copies.'))).toBe(false);
    expect(fullyAutomated(parse('Example Volley', 'Instant', 'When you next cast a creature spell this turn, copy it twice. You may choose new targets for the copy.'))).toBe(false);
    expect(fullyAutomated(parse('Example Volley', 'Instant', 'When you next cast a creature spell this turn, copy it twice. You may choose new targets for the copies.'))).toBe(true);
  });
  it('"activated or triggered ability" is either kind of ability on the stack (anyOf the two stack kinds), and "from a/an <type> source" is the source of that ability', () => {
    const f = parse('Example Gem', 'Artifact', '{T}: Copy target activated or triggered ability you control from an artifact source. You may choose new targets for the copy.');
    expect(fullyAutomated(f)).toBe(true);
    expect(gateOk(f)).toBe(true);
    const json = JSON.stringify(f.abilities);
    expect(json).toContain('"abilitySource":{"types":["Artifact"]}');
    expect(json).toContain('{"stackKind":"activatedAbility"},{"stackKind":"triggeredAbility"}');
    // two card types, or a quality other than a type or colorlessness, have no wording: manual, never approximate
    expect(fullyAutomated(parse('Example Gem', 'Artifact', '{T}: Copy target activated or triggered ability you control from an artifact or creature source.'))).toBe(false);
  });
  it('"targets only a single X you control" keeps "you control" with X; "with a single target" is one target (CR 115.9a, 115.9c)', () => {
    const a = parse('Example Engine', 'Enchantment', 'Whenever you cast an instant spell that targets only a single creature you control, draw a card.');
    expect(fullyAutomated(a) && gateOk(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toMatch(/"targetsOnly":\{(?=[^}]*"ref":"each")(?=.*"controller":"you")(?=.*"types":\["Creature"\])/);
    const b = parse('Example Engine', 'Enchantment', 'Whenever you cast an instant spell with a single target, draw a card.');
    expect(fullyAutomated(b) && gateOk(b)).toBe(true);
    expect(JSON.stringify(b.abilities)).toContain('"targetCount":{"op":"==","value":1}');
    expect(fullyAutomated(parse('Example Engine', 'Enchantment', 'Whenever you cast an instant spell with a double target, draw a card.'))).toBe(false);
  });
  it('"from anywhere other than your hand" is a spell not cast from the caster\'s hand, for "you"; another player\'s is "their hand" (std-rm)', () => {
    const f = parse('Example Engine', 'Enchantment', 'Whenever you cast a spell from anywhere other than your hand, draw a card.');
    expect(fullyAutomated(f) && gateOk(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"not":{"castFrom":"hand"}');
    // std-rm (CR 601.2a): an opponent's cast from anywhere other than THEIR hand is read too (Ghostly Pilferer); "your hand" after an opponent stays unread
    expect(fullyAutomated(parse('Example Engine', 'Enchantment', 'Whenever an opponent casts a spell from anywhere other than their hand, draw a card.'))).toBe(true);
    expect(fullyAutomated(parse('Example Engine', 'Enchantment', 'Whenever an opponent casts a spell from anywhere other than your hand, draw a card.'))).toBe(false);
  });
  it('"mana value less than or equal to ~\'s power" is a comparison with a computed number, written in front of it', () => {
    const f = parse('Example Engine', 'Creature — Elf', 'Whenever you cast an instant spell with mana value less than or equal to ~\'s power, draw a card.');
    expect(fullyAutomated(f) && gateOk(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"op":"<="');
  });
  it('an outlaw spell is a spell of one of the five creature types, rendered "outlaw spell" (CR 700.12)', () => {
    const f = parse('Example Engine', 'Enchantment', 'Whenever you cast an outlaw spell, draw a card.');
    expect(fullyAutomated(f) && gateOk(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"subtypes":["Assassin","Mercenary","Pirate","Rogue","Warlock"]');
  });
  it('a flavor word after the numerals of a chapter is a label, no part of the chapter text (CR 207.2d)', () => {
    const f = parseCard(card('Example Saga', 'Enchantment — Saga', 'I — Draw a card.\nII — Double — Draw a card.\nIII — Triple — Draw two cards.'), OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(true);
    expect(f.abilities.map((a) => a.text)).toEqual(['I -- Draw a card.', 'II -- Draw a card.', 'III -- Draw two cards.']);
  });
  it('two activation restrictions are the same in either order (CR 602.5)', () => {
    const f = parse('Example Gem', 'Artifact', '{T}: Draw a card. Activate only during your turn and only once each turn.');
    expect(fullyAutomated(f) && gateOk(f)).toBe(true);
    const g = parse('Example Gem', 'Artifact', '{T}: Draw a card. Activate only once each turn and only during your turn.');
    expect(fullyAutomated(g) && gateOk(g)).toBe(true);
    expect(jsonKey(f.abilities)).toBe(jsonKey(g.abilities));
  });
  it('protection from instants and from sorceries: the plural of sorcery', () => {
    const f = parse('Example Sword', 'Artifact — Equipment', 'Equipped creature gets +2/+2 and has protection from instants and from sorceries.');
    expect(fullyAutomated(f) && gateOk(f)).toBe(true);
  });
});

const index = localIndex();

describe.skipIf(index === null)('T45 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  const SETUP = new Set(['Flying', 'Trample']);
  it('no T45 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = T45.flatMap((t) =>
      [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !SETUP.has(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  // the try step on real cards: each card's T45 line is read by the named template and passes the exact render gate, never manual on that line
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'eff.t45.next.cast.copy': ['Teach by Example', 'Doublecast', 'Galvanic Iteration', 'Dual Strike', "Gadwick's First Duel", 'Loki Laufeyson'],
    'eff.t45.next.cast.copy.twice': ['Complete the Circuit', 'Summon: G.F. Cerberus'],
    'eff.t45.next.cast.copy.newTargets': ['Jeong Jeong, the Deserter', 'Adaptive Training Post'],
    'rid.t45.copy.newTargets.plural': ['Complete the Circuit', 'Thousand-Year Storm', 'Summon: G.F. Cerberus'],
    'eff.t45.next.spell.copy': ['Flamehold Grappler'],
    'eff.t45.copy.forEachOtherCastBefore': ['Thousand-Year Storm'],
    'trg.t45.cast.whileSelfAttacking': ['Fire Lord Azula'],
    'eff.t45.copy.andNewTargets': ['Mica, Reader of Ruins'],
  };
  it('the cards named as the whole corpus of a sentence are every card of the index that prints it', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = (index ?? []).filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && w.line.test(x.replaceAll(c.name, '~')))).map((c) => c.name);
      expect([...new Set(found)].sort(), id).toEqual([...w.cards].sort());
    }
  }, 120_000);
  const LINE = /next cast|copy|attacking/i;
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
