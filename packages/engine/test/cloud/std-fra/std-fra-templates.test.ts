/**
 * CLOUD std-fra (the Standard backlog of one set, tuning half; docs/CARD_WORK.md): the template data of parser/templates/zz-cloud/std-fra.json ("gains your choice of A, B, or
 * C until end of turn", sentence-initial "Then ...", "for each opponent, tap / destroy / return ... up to one target ... that player controls", "if C, sacrifice ~, it deals N
 * damage to each opponent, and you gain N life") and the lowering, rendering and engine reading they needed (parser/lower/mentions.ts, parser/holes/cond.ts#compareForm,
 * render/refs.ts, render/steps-zones.ts, render/steps-life.ts, render/fold.ts, actions/announce-cond.ts, model/forms.ts#isPlainHistoryThisTurn).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability (G2). Examples are synthetic wordings
 * (design 6.10); the real cards each template reads are checked against the local index when it is present. The engine's behavior is in std-fra-scenarios.test.ts.
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so these templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES, missingCapabilities } from '../../../src/model/capabilities';
import stdfra from '../../../src/parser/templates/zz-cloud/std-fra.json';
import review from '../../m5/golden/cards/cloud-std-fra-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const STDFRA = stdfra as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind (a trigger is a creature's; an effect on its own a spell's). */
function exampleCard(text: string): OracleCard {
  if (/^(when|whenever|at) /i.test(text)) return card('Example Brute', 'Creature — Elf Warrior', text);
  return card('Example Volley', 'Sorcery', text);
}
const parsedWith = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;

describe('std-fra template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-fra.json, path order: after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-fra.json');
    expect(files.indexOf('zz-cloud/std-fra.json')).toBeLessThan(files.indexOf('zz-fast1/t4.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(STDFRA.length).toBe(6);
    for (const t of STDFRA) {
      expect(t.id, t.id).toMatch(/^eff\.stdfra\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: at least one hand-verified golden card that reads a line with it (few real cards print these sentences), and the engine scenarios of std-fra-scenarios.test.ts play it', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of STDFRA.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(1);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of STDFRA) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'then']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('std-fra guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of STDFRA) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(fullyAutomated(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
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
    [/\btap\b/, 'untap'], [/\bdestroy\b/, 'exile'], [/for each opponent/, 'for each player'], [/\bone target\b/, 'two target'], [/Then/, 'And'], [/your choice of/, 'both'], [/ or haste/, ' and haste'],
    [/sacrifice ~/, 'exile ~'], [/gain (\d+) life/, 'lose $1 life'], [/to its owner's hand/, 'to your hand'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('std-fra guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of STDFRA) {
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

describe('std-fra guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of STDFRA) {
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

describe('std-fra "never silently wrong" (the lint and the lowering fail closed)', () => {
  /** Automated, through the render gate, and nothing the engine lacks (design 5.2, 6.8 G6 and G8). */
  const full = (text: string, type = 'Creature — Elf Warrior'): boolean => {
    const f = parseCard(card('Example Brute', type, text), OPTS).faces[0]!;
    return fullyAutomated(f) && f.abilities.every((a) => missingCapabilities(a, ENGINE_CAPABILITIES).length === 0);
  };
  it('"those creatures" after one target for each opponent names the set of targets, and "it" does not (a set of targets is not one object)', () => {
    expect(full('When ~ enters, for each opponent, tap up to one target creature that player controls. Put a stun counter on each of those creatures.')).toBe(true);
    expect(full('When ~ enters, for each opponent, tap up to one target creature that player controls. Put a stun counter on it.')).toBe(false);
  });
  it('a target "that player controls" with no "for each opponent," in front of it is not one target for each opponent (it needs a player the sentence does not name)', () => {
    expect(full('When ~ enters, destroy up to one target creature that player controls.')).toBe(false);
  });
  it('"gains your choice of A, B, or C" without a duration, with a fourth keyword, or with "and" is not this reading', () => {
    expect(full('Target creature you control gains your choice of flying, vigilance, or menace.', 'Instant')).toBe(false);
    expect(full('Target creature you control gains your choice of flying, vigilance, menace, or reach until end of turn.', 'Instant')).toBe(false);
  });
  it('"Then" opening a sentence only sequences what the sentence after it says; a sentence "Then" cannot read stays manual', () => {
    expect(full('Create a Treasure token. Then blorf target creature.', 'Sorcery')).toBe(false);
  });
  it('"If its mana value was N or less" is read only as "N or less" or "N or greater" of a statistic of the object a step of the same resolution acted on, never as an equality', () => {
    expect(full("Exile target creature. If that creature's mana value was 3, you gain 2 life.", 'Instant')).toBe(false);
    expect(full("Exile target creature. If that creature's mana value was 3 or less, you gain 2 life.", 'Instant')).toBe(true);
  });
  // merge of lines C and D: std-blb's one reader of this turn's history at announcement (CR 602.5b) also reads a filtered history ("a creature spell"); the
  // engine checks it from the turn's cast entries (scenario in std-fra-scenarios.test.ts)
  it('an activation restriction on this turn\'s history is read at announcement, a filtered one too (std-blb\'s reader)', () => {
    expect(full("{0}: Draw a card. Activate only if you've cast a spell this turn.", 'Creature — Elf Warrior')).toBe(true);
    expect(full("{0}: Draw a card. Activate only if you've cast a creature spell this turn.", 'Creature — Elf Warrior')).toBe(true);
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-fra design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  it('no std-fra line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = STDFRA.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => lines.has(x.trim())).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  // the try step on real cards: each card's line is read by the named template and passes the exact render gate
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'eff.stdfra.gains.choice3': ['Hungering Puppetbeast', 'Golem Artisan', 'Steel Seraph'],
    // The Theorist, Jace Beleren's -6 ("Then put X +1/+1 counters ..., where X is ...") is no longer listed here: since p2-counters-state-2 its line has a second
    // derivation with the same JSON (eff.p2cs2.effects.whereX over eff.t28.then.counters.put), and the chart picks among equal readings by template ids (chart.ts#better);
    // the card is still checked fully understood below (eff.stdfra.return.hand.forEachOpponent)
    'eff.stdfra.then.effects': ['Aerid Konstrari'],
    'eff.stdfra.tap.forEachOpponent': ['Hapatra, the Desert Frost'],
    'eff.stdfra.destroy.forEachOpponent': ["Lich's Relic"],
    'eff.stdfra.return.hand.forEachOpponent': ['The Theorist, Jace Beleren'],
    'eff.stdfra.if.sacrificeSelf.damageAndGain': ['Eye of Jace'],
  };
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.join(', ')} read the line with it, pass the render gate and are fully understood`, () => {
      for (const name of names) {
        const oracle = (index ?? []).find((c) => c.name === name);
        if (oracle === undefined) continue; // a card the local index does not have
        const c = compileCard(oracle);
        expect(c.automation.level, name).toBe('full');
        const parsed = parseCard(oracle, OPTS);
        expect(parsed.faces.flatMap((f) => f.templatesUsed), name).toContain(id);
        expect(parsed.faces.every((f) => f.gate.every((g) => g.ok)), name).toBe(true);
      }
    }, 60_000);
  }
  it('Vindictive Triumph ("If that permanent\'s mana value was 3 or less, return it ...") and Proctor of Potential ("Activate only if you\'ve scried or surveilled this turn") are fully understood', () => {
    for (const name of ['Vindictive Triumph', 'Proctor of Potential']) {
      const oracle = (index ?? []).find((c) => c.name === name);
      if (oracle === undefined) continue;
      expect(compileCard(oracle).automation.level, name).toBe('full');
    }
  }, 60_000);
});
