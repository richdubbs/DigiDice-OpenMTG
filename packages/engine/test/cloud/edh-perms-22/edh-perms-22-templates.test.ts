/**
 * Commander lane edh-perms, round edh-perms-22: the template data of parser/templates/zz-cloud/edh-perms-22.json ("phases out until ~ leaves the battlefield", "tap it as it phases in", "distribute up to that many counters") and the round's parser, lowering and renderer changes, tested at the end of this file and in
 * edh-perms-22-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. CR cites checked against the Comprehensive Rules of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhPm22 from '../../../src/parser/templates/zz-cloud/edh-perms-22.json';
import review from '../../m5/golden/cards/edh-perms-22-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhPm22 as Template[];
const MECH_COUNT = 3;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full
  'eff.edhpm22.phaseOut.until': ['Oubliette', 'The Moment'],
  'eff.edhpm22.phaseIn.tapped': ['Oubliette'],
  'eff.edhpm22.counters.distribute.upTo': ['Lathiel, the Bounteous Dawn'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a trigger on an enchantment, an activated ability on an artifact creature. */
const parsedWith = (_t: Template, text: string) => {
  if (/^(At the beginning|Whenever|When )/.test(text)) return parseCard(card('Example Relic', 'Enchantment', text), OPTS).faces[0]!;
  if (/^\{/.test(text)) return parseCard(card('Example Relic', 'Artifact', text), OPTS).faces[0]!;
  return parseCard(card('Example Relic', 'Sorcery', text), OPTS).faces[0]!;
};

describe('edh-perms-22 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-perms-22.json, path order: after edh-perms-20, before edh-perms-3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-perms-22.json');
    expect(files.indexOf('zz-cloud/edh-perms-22.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-perms-20.json'));
    expect(files.indexOf('zz-cloud/edh-perms-22.json')).toBeLessThan(files.indexOf('zz-cloud/edh-perms-3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.edhpm22.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|trg)\.edhpm22\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) for (const n of NARROW[t.id]!) expect(cards, t.id).toContain(n);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review as { card: string; expect?: string }[]) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-perms-22 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
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

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} until end of turn.`];
  const swaps: [RegExp, string][] = [
    [/during your turn/, 'during any turn'], [/or an?/, 'and an'], [/from your hand/, 'from your graveyard'], [/another/, 'two'], [/onto the battlefield/, 'into your hand'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-perms-22 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able/until end of turn" or a swapped key word never gives the example's JSON`, () => {
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

describe('edh-perms-22 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any word (CR 122.1): "a blorfty counter" is a counter kind, not nonsense
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-perms-22 design 6.10 (local index): synthetic examples', () => {
  it('no edh-perms-22 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

describe('edh-perms-22 parser, lowering, renderer and engine changes (one test each)', () => {
  /** The level the game plays a card at: the parse AND the engine's capabilities (a form the engine does not run is manual). */
  const played = (type: string, text: string): string => compileCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : {}) as OracleCard).automation.level;
  const enchantment = (text: string) => parseCard(card('Example Relic', 'Enchantment', text), OPTS).faces[0]!;
  const spell = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
  it('lower/phase-tapped.ts + effects/handlers/zones-status.ts (CR 702.26b-c, 610.3): "phases out until ~ leaves the battlefield. Tap that creature as it phases in this way." is ONE phase-out with `tapped`; the second sentence alone, another object or a duration of another event is not read', () => {
    const ok = enchantment('When this enchantment enters, target creature phases out until this enchantment leaves the battlefield. Tap that creature as it phases in this way.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"tapped":true');
    expect(JSON.stringify(ok.abilities)).toContain('"op":"phaseOut"');
    expect(JSON.stringify(ok.abilities).match(/"op":"phaseOut"/g)).toHaveLength(1);
    // the same without the second sentence: the object phases in untapped
    const plain = enchantment('When this enchantment enters, target creature phases out until this enchantment leaves the battlefield.');
    expect(fullyAutomated(plain)).toBe(true);
    expect(JSON.stringify(plain.abilities)).not.toContain('tapped');
    // the tap sentence alone, or after a phase-out with no duration, or after a phase-out of ANOTHER object: manual (the lone `tapped` step is no registered form)
    expect(fullyAutomated(enchantment('When this enchantment enters, tap target creature as it phases in this way.'))).toBe(false);
    expect(fullyAutomated(enchantment('When this enchantment enters, target creature phases out. Tap that creature as it phases in this way.'))).toBe(false);
    expect(played('Enchantment', 'When this enchantment enters, target creature phases out until end of turn. Tap that creature as it phases in this way.')).not.toBe('full');
    expect(played('Enchantment', 'When this enchantment enters, target creature phases out until a player gains life. Tap that creature as it phases in this way.')).not.toBe('full');
    expect(played('Enchantment', 'When this enchantment enters, target creature phases out until this enchantment leaves the battlefield. Tap that creature as it phases in this way.')).toBe('full');
    expect(fullyAutomated(enchantment('When this enchantment enters, target creature phases out until this enchantment leaves the battlefield. Tap another creature as it phases in this way.'))).toBe(false);
  });
  it('the pronoun after a cost or an earlier instruction (CR 608.2c): "Untap target creature you control. It phases out until ~ leaves the battlefield." is read and said with "it"', () => {
    const ok = parseCard(card('Example Relic', 'Artifact', '{2}, {T}: Untap target creature you control. It phases out until this artifact leaves the battlefield.'), OPTS).faces[0]!;
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"op":"phaseOut"');
  });
  it('model/capabilities.ts + model/cap-walk.ts (op:phaseOut.until): only "until the source leaves the battlefield" is registered; another duration is manual', () => {
    expect(ENGINE_CAPABILITIES.has('op:phaseOut.until')).toBe(true);
    expect(played('Enchantment', 'When this enchantment enters, target creature phases out until your next turn.')).not.toBe('full');
    expect(played('Enchantment', 'When this enchantment enters, target creature phases out until this enchantment leaves the battlefield.')).toBe('full');
  });
  it('parser/lower/targets.ts + quantities.ts#gainedLifeCount + render/steps-life.ts (CR 601.2d, 603.3d, 119.3): "distribute up to that many +1/+1 counters among any number of other target creatures" after "if you gained life this turn"; without that condition "that many" has no amount', () => {
    const ok = parseCard(card('Example Beast', 'Creature — Cleric', 'At the beginning of your end step, if you gained life this turn, distribute up to that many +1/+1 counters among any number of other target creatures.', { power: '2', toughness: '2' }), OPTS).faces[0]!;
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"upTo":true');
    expect(JSON.stringify(ok.abilities)).toContain('"q":"lifeGainedThisTurn"');
    expect(played('Creature — Cleric', 'At the beginning of your end step, distribute up to that many +1/+1 counters among any number of other target creatures.')).not.toBe('full');
    expect(played('Creature — Cleric', 'At the beginning of your end step, if you lost life this turn, distribute up to that many +1/+1 counters among any number of other target creatures.')).not.toBe('full');
    expect(played('Creature — Cleric', 'At the beginning of your end step, if you gained life this turn, distribute up to that many +1/+1 counters among any number of other target creatures.')).toBe('full');
    // an exact total stays the exact division (no `upTo`)
    const exact = parseCard(card('Example Beast', 'Creature — Cleric', 'At the beginning of your end step, distribute three +1/+1 counters among one, two, or three target creatures.', { power: '2', toughness: '2' }), OPTS).faces[0]!;
    expect(JSON.stringify(exact.abilities)).not.toContain('upTo');
  });
  it('parser/holes/moved.ts#COUNTED_RETURN + render/moved.ts (CR 608.2c, 608.2h, 400.7): "if you return four or more nontoken permanents you control this way" counts the permanents of that description the ONE earlier move to a hand moved, as they last existed; a count of cards, of another kind or after another instruction is not read', () => {
    const ok = spell("Return all nonland permanents to their owners' hands. If you return four or more nontoken permanents you control this way, you may put a permanent card from your hand onto the battlefield.");
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"q":"resultCount"');
    expect(JSON.stringify(ok.abilities)).toContain('"controller":{"ref":"you"}');
    expect(fullyAutomated(spell("Destroy all nonland permanents. If you return four or more nontoken permanents you control this way, you may put a permanent card from your hand onto the battlefield."))).toBe(false);
    expect(fullyAutomated(spell("Return all nonland permanents to their owners' hands. If you exile four or more nontoken permanents you control this way, you may put a permanent card from your hand onto the battlefield."))).toBe(false);
    expect(fullyAutomated(spell("Return all nonland permanents to their owners' hands. If you return four or more nontoken permanents an opponent controls this way, you may put a permanent card from your hand onto the battlefield."))).toBe(false);
  });
  it('parser/lower/quantities.ts#differenceOf + render/qty.ts (CR 208.1, 608.2h): "equal to the difference" after "if that creature has greater power than ~" is that power minus this power; another statistic or the same object is not read', () => {
    const creature = parseCard(card('Example Beast', 'Creature — Construct', 'Whenever this creature attacks, tap target creature defending player controls. If that creature has greater power than this creature, put a number of +1/+1 counters on this creature equal to the difference.', { power: '2', toughness: '2' }), OPTS).faces[0]!;
    expect(fullyAutomated(creature)).toBe(true);
    expect(JSON.stringify(creature.abilities)).toContain('"op":"-"');
    expect(fullyAutomated(parseCard(card('Example Beast', 'Creature — Construct', 'Whenever this creature attacks, tap target creature defending player controls. If that creature has greater power than this creature, put a number of +1/+1 counters on this creature equal to the difference between their toughnesses.', { power: '2', toughness: '2' }), OPTS).faces[0]!)).toBe(false);
  });
});
