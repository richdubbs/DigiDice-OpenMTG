/**
 * FAST4 T32 (casting statics: conditional cost modifiers, alternative and free costs, cast restrictions): the template data of
 * parser/templates/zz-fast4/t32.json.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present; the real cards each template reads are checked
 * there too (the try step of CONTRIBUTING "Adding a template").
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T32 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import t32 from '../../../src/parser/templates/zz-fast4/t32.json';
import review from '../../m5/golden/cards/fast4-t32-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T32 = t32 as Template[];

/**
 * Design 6.9 evidence for a stable template: three hand-verified golden cards (test/m5/golden/cards/fast4-t32-review.json), or, for a sentence that fewer
 * real cards print, every one of them (the index check below proves there is no other). `manual`: a card of that corpus whose line stays manual for a reason
 * outside the template (Rakdos, Lord of Riots: "an opponent lost life this turn" is a history the cast check can't read, `rcond:happened`; Demon Detective: "all of your commanders have been revealed" has no Cond reading).
 */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp; manual?: readonly string[] }>> = {
  'cm.t32.self.less.opponentsControl': { cards: ['Lashwhip Predator'], line: /costs \{[^}]+\} less to cast if your opponents control /i },
  'cm.t32.self.less.totalToughness': { cards: ['Orysa, Tide Choreographer'], line: /costs \{[^}]+\} less to cast if [^.]* have total toughness /i },
  'cm.t32.self.less.cardsLeftGraveyard': { cards: ['Wilt in the Heat'], line: /costs \{\d+\} less to cast if .* cards? left your graveyard this turn/i },
  'cm.t32.self.more.ifTargets': { cards: ["Dragon's Prey", 'Vanish into Eternity'], line: /costs \{[^}]+\} more to cast if it targets an? /i },
  'cm.t32.each.spell.more.exceptControllersTurn': { cards: ['Defense Grid'], line: /each spell costs \{[^}]+\} more to cast except during its controller's turn/i },
  'cm.t32.alternative.mana.ifAfter': { cards: ['Blasphemous Edict'], line: /rather than pay [^.]*mana cost if /i },
  'rst.t32.cast.self.unless': { cards: ['Demon Detective', 'Proft, Sinister Mastermind', 'Rakdos, Lord of Riots'], line: /^(\w+ — )?You can't cast [^.]* unless /im, manual: ['Demon Detective', 'Rakdos, Lord of Riots'] },
  'rst.t32.opponents.cast.onlyFromHand': { cards: ['Drannith Magistrate'], line: /^Your opponents can't cast spells from anywhere other than their hands\./m },
  'rst.t32.yourTurn.opponents.castActivate': { cards: ['Grand Abolisher', 'Myrel, Shield of Argive'], line: /your opponents can't cast spells or activate abilities of /i },
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which a T32 example is an ability of the right kind: a spell's own cost or timing on an instant (a creature when a keyword follows). */
function exampleCard(t: Template, text: string): OracleCard {
  // "You can't cast ~ unless ..." is printed on permanent cards (Oracle has it on no instant or sorcery), so its examples are a creature's lines
  const own = /^(cm\.t32\.self|cm\.t32\.alternative|rst\.t32\.cast\.self\.combat)/.test(t.id);
  if (own && !/\n(Flying|Trample)$/.test(text)) return card('Example Volley', 'Instant', text);
  return card('Example Brute', 'Creature — Elf Warrior', text);
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('T32 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast4/t32.json, after zz-fast4/t30.json, before zz-m6/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast4/t32.json');
    expect(files.indexOf('zz-fast4/t32.json')).toBeGreaterThan(files.indexOf('zz-fast4/t30.json'));
    expect(files.indexOf('zz-fast4/t32.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 7', () => {
    expect(T32.length).toBe(14);
    for (const t of T32) {
      expect(t.id, t.id).toMatch(/^(cm|rst)\.t32\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(7);
    }
  });
  it('design 6.9: a stable T32 template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of T32.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual(whole.cards.filter((c) => !whole.manual?.includes(c)).sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T32) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't"]) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('T32 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T32) {
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
  const t32Line = lines.findIndex((l) => !/^(Flying|Trample)$/.test(l));
  const body = lines[t32Line]!.replace(/\.$/, '');
  const rest = (b: string): string => lines.map((l, i) => (i === t32Line ? b : l)).join('\n');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bless\b/, 'more'], [/\bmore to cast\b/, 'less to cast'], [/\byou cast\b/, 'your opponents cast'], [/\byour opponents\b/, 'you'], [/\bduring your turn\b/, 'during combat'],
    [/\banother spell\b/, 'two spells'], [/\bleft your graveyard\b/, 'left your hand'], [/\bit targets\b/, 'you control'], [/\bor greater\b/, 'or less'],
    [/\bexcept during\b/, 'during'], [/\bthe first\b/, 'the second'], [/\beach turn\b/, 'each combat'], [/\brather than\b/, 'in addition to'], [/\bwithout paying\b/, 'by paying'],
    [/\bonly during combat\b/, 'only during your turn'], [/\bunless\b/, 'if'], [/\bother than their hands\b/, 'other than their graveyards'], [/\bactivate abilities\b/, 'play lands'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out.map((m) => rest(m.replace(/\.$/, '') + '.'));
}

describe('T32 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T32) {
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

describe('T32 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T32) {
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

describe.skipIf(index === null)('T32 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  // sentences with no word to vary: rules phrases fixed by their pattern (CR 601.3, 601.2a)
  const FIXED_WORDING = new Set(['rst.t32.cast.self.combat', 'rst.t32.opponents.cast.onlyFromHand']);
  const SETUP = new Set(['Flying', 'Trample', 'Draw a card.', 'Draw two cards.', 'Destroy target creature.', 'Counter target spell.', 'Tap target creature.']);
  it('no T32 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = T32.filter((t) => !FIXED_WORDING.has(t.id)).flatMap((t) =>
      [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !SETUP.has(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  // the try step on real cards: each card's T32 line is read by the named template and passes the exact render gate, never manual on that line
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'cm.t32.self.less.anotherSpell': ['Focus the Mind'],
    'cm.t32.self.less.cardsLeftGraveyard': ['Wilt in the Heat'],
    'cm.t32.self.more.ifTargets': ["Dragon's Prey"],
    'cm.t32.spells.less.you.manaValue': ['It That Heralds the End'],
    'cm.t32.each.spell.more.exceptControllersTurn': ['Defense Grid'],
    'cm.t32.first.spell.each.turn.less': ['Melek, Reforged Researcher'],
    'cm.t32.alternative.mana.ifAfter': ['Blasphemous Edict'],
    'cm.t32.alternative.free.if': ['Refreshing Rain', 'Massacre', 'Mogg Salvage', 'Rushwood Legate'],
    'rst.t32.cast.self.combat': ['Spinal Embrace', 'Surprise Deployment', 'Mandate of Peace'],
    'rst.t32.cast.self.unless': ['Proft, Sinister Mastermind'],
    'rst.t32.opponents.cast.onlyFromHand': ['Drannith Magistrate'],
    'rst.t32.yourTurn.opponents.castActivate': ['Grand Abolisher'],
    'cm.t32.self.less.opponentsControl': ['Lashwhip Predator'],
    'cm.t32.self.less.totalToughness': ['Orysa, Tide Choreographer'],
    'cm.t21.self.less.ifTargets': ['Uneasy Partings'],
  };
  it('the cards named as the whole corpus of a sentence are every card of the index that prints it', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = (index ?? []).filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && w.line.test(x))).map((c) => c.name);
      expect([...new Set(found)].sort(), id).toEqual([...w.cards].sort());
    }
  }, 120_000);
  const LINE = /costs? \{[^}]+\}.* (more|less) to cast|cast (this spell|~) only during combat|rather than pay|without paying|can't cast/i;
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
