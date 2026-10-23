/**
 * FAST5 T78 (optional cost-like instructions followed by "if you do" / "when you do"): the template data of parser/templates/zz-fast5/t78.json ("you may tap two untapped
 * artifacts and/or creatures you control", "you may tap another untapped Elf you control", "then you may sacrifice an artifact / ~", "you may sacrifice a permanent other than
 * that creature or ~", "you may pay life equal to its power", "you may remove a +1/+1 counter from each of two creatures you control", "you may discard a card or sacrifice a
 * land", "if you do, draw a card and create a token / ~ can't be blocked this turn / ~ gets +2/+0 until end of turn", "tap any number of untapped creatures you control" with
 * "~ gets +1/+1 until end of turn for each creature tapped this way") and the lowering and renderer reading they needed (parser/lower/conditions.ts#foldMayInIf, mentions.ts,
 * quantities.ts, render/fold.ts, render/np.ts, render/qty.ts, design 6.8 G6).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability (G2). Examples are synthetic wordings
 * (design 6.10); the real cards each template reads are checked against the local index when it is present. The engine's behavior is in t78-scenarios.test.ts.
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T78 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import t78 from '../../../src/parser/templates/zz-fast5/t78.json';
import review from '../../m5/golden/cards/fast5-t78-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T78 = t78 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which a T78 example is an ability of the right kind (a trigger is a creature's, an Equipment's when it says so; an effect on its own a spell's). */
function exampleCard(text: string): OracleCard {
  if (/equipped creature/i.test(text)) return card('Example Saw', 'Artifact — Equipment', text);
  if (/^(when|whenever|at) /i.test(text)) return card('Example Brute', 'Creature — Elf Warrior', text);
  return card('Example Volley', 'Sorcery', text);
}
const parsedWith = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;

describe('T78 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast5/t78.json, path order: after zz-fast4/, before zz-m6/ and zz-push/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t78.json');
    expect(files.indexOf('zz-fast5/t78.json')).toBeGreaterThan(files.indexOf('zz-fast4/t34.json'));
    expect(files.indexOf('zz-fast5/t78.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5)', () => {
    expect(T78.length).toBe(13);
    for (const t of T78) {
      expect(t.id, t.id).toMatch(/^eff\.t78\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable T78 template has its evidence: at least one hand-verified golden card that reads a line with it (fewer than three real cards print most of these sentences), and the engine scenarios of t78-scenarios.test.ts play it', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of T78.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(1);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T78) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'then']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('T78 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T78) {
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
    [/untapped/, 'tapped'], [/another/, 'target'], [/sacrifice/, 'exile'], [/\bmay\b/, 'must'], [/Then/, 'And'], [/discard/, 'mill'], [/counter from each of/, 'counter from'],
    [/tap any number/, 'tap up to two'], [/each creature tapped this way/, 'each creature'], [/if you do/i, 'if you don\'t'], [/draw a card/, 'draw two cards'], [/life equal/, 'life equal to twice'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('T78 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T78) {
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

describe('T78 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T78) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~,' || w === '~.' || /^\{/.test(w)) return;
          // CR 122.1: any word can name a kind of counter (parser/holes/misc.ts#counterKind), so the word before "counter" is not a nonsense position
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('T78 "never silently wrong" (the lint and the lowering fail closed)', () => {
  const full = (text: string, type = 'Creature — Elf Warrior'): boolean => fullyAutomated(parseCard(card('Example Brute', type, text), OPTS).faces[0]!);
  it('"for each creature tapped this way" without the named tap step before it is not automated (an unnamed step would count nothing)', () => {
    expect(full('Whenever ~ attacks, ~ gets +1/+1 until end of turn for each creature tapped this way.')).toBe(false);
    expect(full('Whenever ~ attacks, you may tap any number of untapped creatures you control. ~ gets +1/+1 until end of turn for each creature tapped this way.')).toBe(false);
  });
  it('"that many" after paying life is the life paid, and nothing else is offered: after another payment it stays the amount of the event', () => {
    expect(full('Whenever another creature you control enters, you may pay life equal to its power. If you do, put that many +1/+1 counters on it.')).toBe(true);
    expect(JSON.stringify(parseCard(card('Example Brute', 'Creature — Elf Warrior', 'Whenever another creature you control enters, you may pay life equal to its power. If you do, put that many +1/+1 counters on it.'), OPTS).faces[0]!.abilities)).toContain('"q":"var"');
  });
  it('"the sacrificed creature" after a payment that may not have sacrificed anything (a choice of payments) is not automated', () => {
    expect(full("Whenever ~ attacks, you may sacrifice a creature or discard a card. If you do, put a number of +1/+1 counters on ~ equal to the sacrificed creature's power.")).toBe(false);
  });
  it('"If C, you may X. If you don\'t, Y." is still not read through the "if" (not being offered X is not settled by the text)', () => {
    expect(full("Draw a card. If you control a Forest, you may discard a card. If you don't, lose 2 life.", 'Instant')).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('T78 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  it('no T78 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = T78.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => lines.has(x.trim())).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  // the try step on real cards: each card's T78 line is read by the named template and passes the exact render gate
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'eff.t78.may.tap.untapped': ['Caparocti Sunborn', 'Rent Is Due', 'Aziza, Mage Tower Captain', 'Raff, Weatherlight Stalwart'],
    'eff.t78.may.tap.another': ['Meanders Guide', 'Gravelgill Scoundrel', 'Civil Servant'],
    'eff.t78.then.may.sacrifice': ['Lithobraking'],
    'eff.t78.then.may.sacrifice.self': ['Eden, Seat of the Sanctum'],
    'eff.t78.may.sacrifice.otherThan': ['Saw'],
    'eff.t78.may.payLifeEqual.thatMany': ['Madame Null, Power Broker'],
    'eff.t78.may.removeCounter.fromEachOf': ['Dyadrine, Synthesis Amalgam'],
    'eff.t78.may.discardOrSacrifice': ['Highway Robbery'],
    'eff.t78.tap.anyNumber.creatures': ['Orphans of the Wheat'],
    'eff.t78.pump.perTappedThisWay': ['Orphans of the Wheat'],
    'eff.t78.if.drawAnd.token': ['Dyadrine, Synthesis Amalgam', 'The Sackville-Bagginses'],
    'eff.t78.if.drawAnd.cantBeBlocked': ['Vampire Gourmand'],
    'eff.t78.if.drawAnd.pump': ['Reckless Detective'],
  };
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.join(', ')} read the line with it, pass the render gate and are fully understood`, () => {
      for (const name of names) {
        const oracle = (index ?? []).find((c) => c.name === name);
        expect(oracle, name).toBeDefined();
        const c = compileCard(oracle!);
        expect(c.automation.level, name).toBe('full');
        const parsed = parseCard(oracle!, OPTS);
        expect(parsed.faces.flatMap((f) => f.templatesUsed), name).toContain(id);
        expect(parsed.faces.every((f) => f.gate.every((g) => g.ok)), name).toBe(true);
      }
    }, 60_000);
  }
  it('Take Out the Trash ("If you control a Raccoon, you may discard a card. If you do, draw a card.") is fully understood by the conditional-may fold, and Rhovanion Rampager reads the sacrificed creature (partial only because its amass template is experimental)', () => {
    const named = (n: string) => (index ?? []).find((c) => c.name === n)!;
    expect(compileCard(named('Take Out the Trash')).automation.level).toBe('full');
    const rampager = parseCard(named('Rhovanion Rampager'), OPTS);
    expect(JSON.stringify(rampager.faces[0]!.abilities)).toContain('"ref":"costSacrificed"');
    expect(rampager.faces[0]!.abilities.every((a) => a.kind !== 'manual')).toBe(true);
  }, 60_000);
});
