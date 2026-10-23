/**
 * FAST5 T55 (tokens with quoted abilities, keyword-N riders and names): the template data of parser/templates/zz-fast5/t55.json, the hole grammar `NamedToken`
 * (parser/holes/token.ts), and the parser and renderer support the family needed: an "Activate only as a sorcery." inside the quotes of a token's ability
 * (parser/lower/quoted.ts), a keyword with a parameter said as words ("with crew 1", "with flying and \"...\"", "and equip {2}"), a loyalty cost in brackets inside
 * quotes, an ability word inside quotes, a possessive inside a token's name, and "Attach it to ~".
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability (G2).
 * Examples are synthetic wordings (design 6.10), checked against the local index when it is present; the real cards each template reads are checked there
 * too (the try step of CONTRIBUTING "Adding a template").
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T55 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import t55 from '../../../src/parser/templates/zz-fast5/t55.json';
import review from '../../m5/golden/cards/fast5-t55-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T55 = t55 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic spell in which a T55 example is the text. */
const parsedWith = (text: string) => parseCard(card('Example Probe', 'Sorcery', text), OPTS).faces[0]!;
/** A synthetic permanent (a static or triggered ability) with the text. */
const permanentWith = (text: string, type = 'Creature — Elf') => parseCard(card('Example Probe', type, text), OPTS).faces[0]!;
const isStatic = (t: Template): boolean => t.kind === 'static';
const parsedFor = (t: Template, text: string) => (isStatic(t) ? permanentWith(text) : parsedWith(text));

describe('T55 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast5/t55.json, after zz-fast5/t46.json, before zz-fast5x/ and zz-m6/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t55.json');
    expect(files.indexOf('zz-fast5/t55.json')).toBeGreaterThan(files.indexOf('zz-fast5/t46.json'));
    expect(files.indexOf('zz-fast5/t55.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(T55.length).toBe(2);
    for (const t of T55) {
      expect(t.id, t.id).toMatch(/^(eff|rst)\.t55\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable T55 template has its evidence: three hand-verified golden cards (test/m5/golden/cards/fast5-t55-review.json)', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of T55.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T55) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('T55 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T55) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedFor(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedFor(t, e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = parsedFor(t, c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example text (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} this turn.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bcan't block or be blocked\b/, 'can block or be blocked'], [/\bcan't block or be blocked by\b/, "can't block or be blocked except by"], [/\bblocked by\b/, 'blocked by more than one'],
    [/\ba legendary\b/, 'a'], [/\bCreate\b/, 'Each player creates'], [/\bcreates\b/, 'may create'], [/\bToken\b/i, 'creature'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('T55 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T55) {
    it(`${t.id}: an appended "unless/instead/this turn/twice" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedFor(t, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedFor(t, m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('T55 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T55) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w) || w.includes('\n')) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedFor(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('T55 the name of a token is a characteristic of the token, never a reference to the card (CR 111.4, 201.2)', () => {
  it('"create Mowu, a legendary 3/3 ..." needs the comma, the article and a capitalized name', () => {
    expect(fullyAutomated(parsedWith('Create Mowu, a legendary 3/3 green Dog creature token.'))).toBe(true);
    expect(fullyAutomated(parsedWith('Create mowu, a legendary 3/3 green Dog creature token.'))).toBe(false);
    expect(fullyAutomated(parsedWith('Create Mowu a legendary 3/3 green Dog creature token.'))).toBe(false);
    expect(fullyAutomated(parsedWith('Create Mowu, two legendary 3/3 green Dog creature tokens.'))).toBe(false);
  });
  it('a name with a possessive and a name of several words: "named Koma\'s Coil", "The Void"', () => {
    const f = parsedWith("Create four 3/3 blue Serpent creature tokens named Koma's Coil.");
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"name":"Koma\'s Coil"');
    const v = parsedWith('Target opponent creates The Void, a legendary 5/5 black Horror Villain creature token with flying, indestructible, and "The Void attacks each combat if able."');
    expect(automated(v.abilities)).toBe(true);
    expect(JSON.stringify(v.abilities)).toContain('"name":"The Void"');
  });
  it('the name inside the quotes of a named token is the token (a triggered ability on itself), and only that name', () => {
    const f = parsedWith('Create Redwing, a legendary 1/1 blue Bird Scout creature token with flying and "Whenever Redwing attacks, surveil 1."');
    expect(automated(f.abilities)).toBe(true);
    expect(f.gate.every((g) => g.ok)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"attacker":{"self":true}');
    // another name in the quotes is a word the grammar does not know: not understood, never the token
    expect(fullyAutomated(parsedWith('Create Redwing, a legendary 1/1 blue Bird Scout creature token with flying and "Whenever Falcon attacks, surveil 1."'))).toBe(false);
  });
});

describe('T55 quoted abilities of a token: restrictions, labels, brackets (CR 602.5d, 207.2c, 606.4)', () => {
  const MERC = (restriction: string) => `Create a 1/1 red Mercenary creature token with "{T}: Target creature you control gets +1/+0 until end of turn.${restriction}"`;
  it('"Activate only as a sorcery." inside the quotes is the ability\'s sorcery speed, not an instruction', () => {
    const f = parsedWith(MERC(' Activate only as a sorcery.'));
    expect(automated(f.abilities)).toBe(true);
    expect(f.gate.every((g) => g.ok)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"sorcerySpeed":true');
    expect(JSON.stringify(f.abilities)).not.toContain('"op":"manual"');
    // without it the ability is the plain one
    expect(JSON.stringify(parsedWith(MERC('')).abilities)).not.toContain('sorcerySpeed');
  });
  it('another restriction the parser reads is kept; one it cannot state is not guessed (the controller would have to attest it): the sentence stays manual', () => {
    expect(JSON.stringify(parsedWith(MERC(' Activate only once each turn.')).abilities)).toMatch(/"limit":\{[^}]*"per":"turn"/);
    expect(fullyAutomated(parsedWith(MERC(' Activate only if you cast a quux spell this turn.')))).toBe(false);
  });
  it('an ability word before the dash inside the quotes is a label (no rules meaning) that the rendering gives back; a flavor word is not accepted', () => {
    const f = parsedWith('Create a 2/2 green Cat creature token with "Landfall — Whenever a land you control enters, put a +1/+1 counter on this token."');
    expect(automated(f.abilities)).toBe(true);
    expect(f.gate.every((g) => g.ok)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"label":"Landfall"');
    expect(fullyAutomated(parsedWith('Create a 2/2 green Cat creature token with "Pounce — Whenever a land you control enters, put a +1/+1 counter on this token."'))).toBe(false);
  });
  it('a loyalty cost in brackets is the loyalty cost of an ability the permanents have', () => {
    const f = permanentWith('Planeswalkers you control have "[−2]: Create a 2/2 colorless Wizard Soldier creature token named Cadet. Surveil 1."', 'Legendary Enchantment');
    expect(automated(f.abilities)).toBe(true);
    expect(f.gate.every((g) => g.ok)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"loyalty":-2');
  });
});

describe('T55 keywords with parameters in a token\'s description are said as words (CR 702.122a, 702.6a)', () => {
  it('"with crew 1", "with firebending 1", "and equip {2}"', () => {
    for (const text of [
      'Create a 3/2 colorless Vehicle artifact token with crew 1.',
      'Create two 2/2 red Soldier creature tokens with firebending 1.',
      'Create a colorless Equipment artifact token named Axe with "Equipped creature gets +1/+0" and equip {2}.',
      'Create a colorless Equipment artifact token named Sturdy Shield with "Equipped creature gets +1/+2" and equip {2}. Attach it to ~.',
    ]) {
      const f = parsedWith(text);
      expect(automated(f.abilities), text).toBe(true);
      expect(f.gate.every((g) => g.ok), text).toBe(true);
    }
  });
  it('a keyword and a quoted ability: "with flying and \\"This token can block only creatures with flying.\\""', () => {
    const f = parsedWith('Create a 1/1 colorless Drone artifact creature token with flying and "This token can block only creatures with flying."');
    expect(fullyAutomated(f)).toBe(true);
    expect(f.gate.every((g) => g.ok)).toBe(true);
  });
  it('the equip keyword line of a card is still read by its keyword template (the optional filter of equip is for lists only)', () => {
    const f = permanentWith('Equipped creature gets +1/+1.\nEquip {2}', 'Artifact — Equipment');
    expect(f.templatesUsed).toContain('kw.equip');
    expect(f.templatesUsed).not.toContain('eff.t55.token.named');
  });
  it('"Attach it to ~": what is attached is the token, never the card it is attached to (CR 301.5c)', () => {
    const f = permanentWith('When ~ enters, create a colorless Equipment artifact token named Axe with "Equipped creature gets +1/+0" and equip {2}. Attach it to ~.');
    expect(fullyAutomated(f)).toBe(true);
    expect(f.gate.every((g) => g.ok)).toBe(true);
  });
});

const index = localIndex();

describe.skipIf(index === null)('T55 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  it('no T55 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = T55.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  // the try step on real cards: each card's T55 sentences are read by the named templates and pass the exact render gate, never manual on those sentences
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'eff.t55.token.named': ['Jiang Yanggu, Never Alone', 'Rinoa Heartilly', 'Falcon, Winged Wonder', 'Mabel, Heir to Cragflame', 'Rufus Shinra', 'The Coming of Galactus', 'Ka-Zar of the Savage Land', 'Sophia, Dogged Detective', 'There and Back Again', 'Verix Bladewing', 'Tomb of Urami', 'Battle at the Helvault', 'Jiang Yanggu', "Tolsimir, Midnight's Light", 'Kari Zev, Skyship Raider', 'Setzer, Wandering Gambler', 'Tatsunari, Toad Rider', 'The Sentry, Golden Guardian'],
    'rst.t55.cant.block.beblockedby': ['Foggy Swamp Spirit Keeper', 'Realm of Koh', 'Lost in the Spirit World', 'Sneaky Homunculus', 'Baboon Spirit', 'The Legend of Kuruk // Avatar Kuruk'],
  };
  const LINE = /create [A-Z][^,]*, an? |creates [A-Z][^,]*, an? |can't block or be blocked by/;
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.length} real cards read the sentence with it (those the local index has), pass the render gate and leave no manual ability for it`, () => {
      for (const name of names) {
        const c = (index ?? []).find((x) => x.name === name);
        if (c === undefined) continue;
        const parsed = parseCard(c as OracleCard, OPTS);
        const used = parsed.faces.flatMap((f) => f.templatesUsed);
        expect(used, name).toContain(id);
        const def = compileCard(c as OracleCard);
        const manual = def.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' && LINE.test(a.text));
        expect(manual.map((a) => a.text), name).toEqual([]);
      }
    });
  }
  it('the Standard cards of the family are fully automated (the measured gain)', () => {
    const FULL = [
      'Unfortunate Accident', 'Prosperity Tycoon', 'Prickly Pair', "Mourner's Surprise", 'Nezumi Linkbreaker', 'Lassoed by the Law', 'Wanted Griffin', 'Brimstone Roundup', 'Form a Posse',
      'The Legend of Kuruk // Avatar Kuruk', 'Realm of Koh', 'Foggy Swamp Spirit Keeper', 'Pinnacle Emissary', 'Station Monitor', 'Desculpting Blast', 'Into the Fae Court',
      'Mu Yanling, Wind Rider', 'Cruel Administrator', 'Fire Nation Attacks', 'Rufus Shinra', 'Jiang Yanggu, Never Alone', 'Rinoa Heartilly', 'Koma, World-Eater', 'Falcon, Winged Wonder',
      'The Coming of Galactus', 'White Tiger, Ava Ayala', 'Iron Hills Blacksmith', 'U.S.Agent, John Walker', 'Mabel, Heir to Cragflame', 'Way of the Healer', 'The Sentry, Golden Guardian',
    ];
    for (const name of FULL) {
      const c = (index ?? []).find((x) => x.name === name);
      if (c === undefined) continue;
      expect(compileCard(c as OracleCard).automation?.level, name).toBe('full');
    }
  });
});
