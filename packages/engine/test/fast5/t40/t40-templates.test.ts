/**
 * FAST5 T40 (replacement, prevention and trigger-doubling variants: damage of a filtered source doubled or raised, damage from a chosen type, an opponent's life loss,
 * counters of every kind, combat and noncombat prevention, "triggers an additional time" for any event): the template data of parser/templates/zz-fast5/t40.json.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability (G2).
 * Examples are synthetic wordings (design 6.10), checked against the local index when it is present; the real cards each template reads are checked there too
 * (the try step of CONTRIBUTING "Adding a template").
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T40 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import t40 from '../../../src/parser/templates/zz-fast5/t40.json';
import review from '../../m5/golden/cards/fast5-t40-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T40 = t40 as Template[];

/**
 * Design 6.9 evidence for a stable template: three hand-verified golden cards (test/m5/golden/cards/fast5-t40-review.json), or, for a sentence that fewer real
 * cards print, every one of them (the index check below proves there is no other). `partialCards`: a card of that corpus whose other lines stay manual for a
 * reason outside the template, so it is not pinned. `pending`: a card of that corpus that prints the line but is not evidence yet, with the reason.
 */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp; partialCards?: readonly string[]; pending?: Readonly<Record<string, string>> }>> = {
  'rep.t40.damage.double.filter': {
    cards: ['Gratuitous Violence', 'Uncivil Unrest', 'Kuja, Genome Sorcerer // Trance Kuja, Fate Defied'],
    line: /^(?:Flare Star — )?If an? (?!source would)[^,]* would deal damage to a permanent or player, it deals double that damage instead\./m,
    partialCards: ['Kuja, Genome Sorcerer // Trance Kuja, Fate Defied'],
  },
  'rep.t40.damage.plus.filter': {
    cards: ['Valley Flamecaller'], line: /would deal damage to a permanent or player, it deals that much damage plus \d+ instead\./,
    pending: { 'Searing Soloist': 'in the index since the Scryfall refresh of 2026-10-19 (an Alchemy card: "conjure" is an unknown word); "a red source you control" is not a source filter the template reads (no-template), so the line stays manual' },
  },
  'rep.t40.damage.double.source.noncombat.while': { cards: ['The Rollercrusher Ride'], line: /If a source you control would deal noncombat damage to a permanent or player while there are/ },
  'rep.t40.damage.double.chosenType': { cards: ['Collective Inferno'], line: /^Double all damage that sources you control of the chosen type would deal\./m },
  'rep.t40.life.loss.double.opponent.yourTurn': { cards: ['Bloodletter of Aclazotz'], line: /If an opponent would lose life during your turn, they lose twice that much life instead\./ },
  'rep.t40.counters.double.anyKind': {
    cards: ['Loading Zone'],
    line: /^If one or more counters would be put on [^,]*(?:, [^,]*)*, twice that many of each of those kinds of counters are put on it instead\./m,
  },
  'prv.t40.self.combat.toAndBy': { cards: ['Fog Bank'], line: /^Prevent all combat damage that would be dealt to and dealt by this creature\.$/m },
  'prv.t40.noncombat.to.filter': {
    cards: ['Crystal Barricade', 'Drogskol Reinforcements', 'Mark of Asylum', "Tajic, Legion's Edge"],
    line: /^Prevent all noncombat damage that would be dealt to (?:other creatures|creatures|Spirits) you control\.$/m,
    partialCards: ['Drogskol Reinforcements', "Tajic, Legion's Edge"],
  },
  'eff.t40.prevent.all.to.filter.dur': {
    cards: ['Crystal Fragments // Summon: Alexander', 'Delight in the Hunt'],
    line: /[Pp]revent all damage that would be dealt to creatures you control this turn\./,
    partialCards: ['Delight in the Hunt'],
  },
  'sta.t40.triggerMod.equipped': { cards: ["Wizard's Staff"], line: /^If a triggered ability of equipped creature triggers, that ability triggers an additional time\.$/m },
};
/**
 * A template whose output needs an engine capability that does not exist yet is checked with that capability granted (every other check runs with the engine's
 * real set): the sentence must lower, render and pass the gate; what is missing is the engine, and the card stays manual until it exists.
 */
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
const optsFor = (t: Template) => ((t.needs ?? []).some((n) => !ENGINE_CAPABILITIES.has(n))
  ? defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: new Set([...ENGINE_CAPABILITIES, ...(t.needs ?? [])]) })
  : OPTS);

/** A synthetic card in which a T40 example is an ability of the right kind: a spell's own effect on an instant, a static on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'effect') return card('Example Volley', 'Instant', text);
  if (/this enchantment/.test(text)) return card('Example Charm', 'Enchantment', text);
  return card('Example Brute', 'Creature — Elf Warrior', text);
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), optsFor(t)).faces[0]!;

describe('T40 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast5/t40.json, after zz-fast4/t34.json, before zz-m6/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t40.json');
    expect(files.indexOf('zz-fast5/t40.json')).toBeGreaterThan(files.indexOf('zz-fast4/t34.json'));
    expect(files.indexOf('zz-fast5/t40.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(T40.length).toBe(11);
    for (const t of T40) {
      expect(t.id, t.id).toMatch(/^(rep|prv|eff|sta)\.t40\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable T40 template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of T40.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole && cards.length < 3) expect(cards.slice().sort(), t.id).toEqual(whole.cards.filter((c) => !whole.partialCards?.includes(c)).sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T40) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
  it('a template whose output needs a capability the engine lacks says so in `needs` (never full without it), and nothing else does', () => {
    const missing = T40.filter((t) => (t.needs ?? []).some((n) => !ENGINE_CAPABILITIES.has(n))).map((t) => `${t.id}: ${(t.needs ?? []).join(', ')}`);
    expect(missing).toEqual([]); // Cloud r3-repl registered feature:replace.life.loss.fromDamage (rules/damage.ts#installLifeLossFunnel, CR 120.3a)
  });
});

describe('T40 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T40) {
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
  const mine = lines.findIndex((l) => !/^(Flying|Trample|Equipped creature has flying\.|As this (creature|enchantment) enters, choose a creature type\.)$/.test(l));
  const body = lines[mine]!.replace(/\.$/, '');
  const rest = (b: string): string => lines.map((l, i) => (i === mine ? b : l)).join('\n');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bdouble that damage\b/, 'triple that damage'], [/\btwice that much\b/, 'three times that much'], [/\btwice that many\b/, 'three times that many'], [/\bplus (\d+)\b/, 'minus $1'],
    [/\bnoncombat\b/, 'combat'], [/\ban opponent\b/, 'you'], [/\byou control\b/, 'an opponent controls'], [/\bthis turn\b/, 'this combat'], [/\bduring your turn\b/, 'during your next turn'],
    [/\bchosen type\b/, 'chosen color'], [/\btriggers an additional time\b/, 'triggers two additional times'], [/\btriggered ability\b/, 'activated ability'],
    [/\bwould deal\b/, 'would be dealt'], [/\bdealt to and dealt by\b/, 'dealt by'], [/\bcounters\b/, 'tokens'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out.map((m) => rest(m.replace(/\.$/, '') + '.'));
}

describe('T40 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T40) {
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

describe('T40 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T40) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w) || /^"?\{/.test(w) || w.includes('\n')) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parseCard(exampleCard(t, mutated), optsFor(t)).faces[0]!), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('T40 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  // sentences with no word to vary: rules phrases fixed by their pattern (CR 614.12a, 607.2d; CR 119.3; CR 615.1; CR 603.2d, 301.5)
  const FIXED_WORDING = new Set([
    'rep.t40.damage.double.chosenType', 'rep.t40.life.loss.double.opponent.yourTurn', 'prv.t40.self.combat.toAndBy', 'sta.t40.triggerMod.equipped',
  ]);
  const SETUP = new Set(['Flying', 'Trample', 'Draw a card.', 'Equipped creature has flying.', 'As this enchantment enters, choose a creature type.', 'As this creature enters, choose a creature type.']);
  it('no T40 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = T40.filter((t) => !FIXED_WORDING.has(t.id)).flatMap((t) =>
      [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !SETUP.has(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  // the try step on real cards: each card's T40 line is read by the named template and passes the exact render gate, never manual on that line
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'rep.t40.damage.double.filter': ['Gratuitous Violence', 'Uncivil Unrest'],
    'rep.t40.damage.plus.filter': ['Valley Flamecaller'],
    'rep.t40.damage.double.source.noncombat.while': ['The Rollercrusher Ride'],
    'rep.t40.damage.double.chosenType': ['Collective Inferno'],
    'rep.t40.counters.double.anyKind': ['Loading Zone'],
    'prv.t40.self.combat.toAndBy': ['Fog Bank'],
    'prv.t40.noncombat.to.filter': ['Crystal Barricade', 'Mark of Asylum', "Tajic, Legion's Edge", 'Drogskol Reinforcements'],
    'eff.t40.prevent.all.to.filter.dur': ['Crystal Fragments // Summon: Alexander'],
    'sta.t40.triggerMod.anyCause': ['Splinter, Radical Rat', 'Annie Joins Up', 'Katara, the Fearless', 'Chief of the Wilds', 'Clara Oswald', 'Delney, Streetwise Lookout'],
    'sta.t40.triggerMod.equipped': ["Wizard's Staff"],
  };
  it('the cards named as the whole corpus of a sentence are every card of the index that prints it', () => {
    const mismatches: Record<string, { found: string[]; named: string[] }> = {};
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = [...new Set((index ?? []).filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && w.line.test(x))).map((c) => c.name))].sort();
      const named = [...w.cards, ...Object.keys(w.pending ?? {})].sort();
      if (JSON.stringify(found) !== JSON.stringify(named)) mismatches[id] = { found, named };
    }
    expect(mismatches).toEqual({});
  }, 120_000);
  const LINE = /would deal (noncombat )?damage|would lose life|counters would be put|prevent all (combat |noncombat )?damage|triggered ability|Double all damage|exile it instead/i;
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.join(', ')} read the line with it, pass the render gate and leave no manual ability for it`, () => {
      for (const name of names) {
        const c = (index ?? []).find((x) => x.name === name);
        expect(c, name).toBeDefined();
        const f = parseCard(c!, OPTS).faces.map((x) => x.templatesUsed);
        expect(f.flat(), name).toContain(id);
        const def = compileCard(c!);
        const manual = def.faces.flatMap((x) => x.abilities).filter((a) => a.kind === 'manual' && LINE.test(a.text));
        expect(manual.map((a) => a.text), name).toEqual([]);
      }
    });
  }
  it('Essence Burn: "If that permanent would die this turn, exile it instead" is read by the existing shield template (sh.dies.exile), fully automated', () => {
    const c = (index ?? []).find((x) => x.name === 'Essence Burn');
    expect(c).toBeDefined();
    const f = parseCard(c!, OPTS).faces[0]!;
    expect(f.templatesUsed).toContain('sh.dies.exile');
    expect(compileCard(c!).automation.level).toBe('full');
  });
});
