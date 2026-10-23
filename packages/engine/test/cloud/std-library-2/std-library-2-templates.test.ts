/**
 * Lane std-library, round std-library-2: the template data of parser/templates/zz-cloud/std-library-2.json ("return another <card> to your hand"; "each player may
 * put any number of <cards> from their hand onto the battlefield"; "The next time a source of your choice would deal damage to you this turn, prevent that damage.
 * When damage is prevented this way, ~ deals that much damage to that source's controller and you draw that many cards.") and the round's parser, lint and
 * renderer changes ("another" after a sacrifice, parser/lower/targets.ts; the sentence join of the shield and its reflexive trigger, parser/lower/ability.ts; the
 * prevention's name `as`, model/lint-flow.ts; the folds of render/fold-stdlibrary2.ts).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-library-2-scenarios.test.ts. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdLibrary2 from '../../../src/parser/templates/zz-cloud/std-library-2.json';
import review from '../../m5/golden/cards/std-library-2-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdLibrary2 as Template[];
const MECH_COUNT = 3;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one card only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'eff.stdlibrary2.return.another.yourHand': 'Deadly Brew', // every other "return another ... to your hand" in the index is a target ("another target ...")
  'eff.stdlibrary2.eachPlayer.may.putAny.fromHand.bf': 'Worlds Within Worlds', // The Great Aurora prints it too (held-out, not Standard: not opened)
  'eff.stdlibrary2.prevent.nextSourceOfChoice.you.whenPrevented.damageDraw': 'New Way Forward',
};
/** Templates kept experimental (none: each has its golden evidence). */
const EXPERIMENTAL: readonly string[] = [];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a creature (triggered and activated abilities), an instant (a spell's instructions). */
const parsedWith = (_t: Template, text: string) => (/^(When|Whenever|At)\b/.test(text) || text.includes(': ')
  ? parseCard(card('Example Shaman', 'Creature — Goblin Shaman', text, { power: '2', toughness: '2' }), OPTS)
  : parseCard(card('Example Insight', 'Instant', text), OPTS)).faces[0]!;
const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Monk', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');

describe('std-library-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-library-2.json, after zz-cloud/std-lci.json, before zz-cloud/std-misc.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-library-2.json');
    expect(files.indexOf('zz-cloud/std-library-2.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-lci.json'));
    expect(files.indexOf('zz-cloud/std-library-2.json')).toBeLessThan(files.indexOf('zz-cloud/std-misc.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdlibrary2.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.stdlibrary2\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.status, t.id).toBe(EXPERIMENTAL.includes(t.id) ? 'experimental' : 'stable');
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) expect(cards, t.id).toContain(NARROW[t.id]);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
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

describe('std-library-2 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} during combat.`];
  const swaps: [RegExp, string][] = [[/\byour hand\b/, 'your library'], [/\bfrom your graveyard\b/, 'from exile'], [/\beach player\b/, 'each opponent'], [/\bany number of\b/, 'up to two'], [/\bfrom their hand\b/, 'from their graveyard'], [/\byour choice\b/, "an opponent's choice"], [/\bto you this\b/, 'to each player this'], [/\bthis turn\b/, 'this combat'], [/\bthat much damage\b/, 'twice that much damage'], [/\bsource's controller\b/, "source's owner"], [/\bdraw that many cards\b/, 'discard that many cards'], [/\bnext time\b/, 'first time']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-library-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able/during combat" or a swapped key word never gives the example's JSON`, () => {
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

describe('std-library-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w)) return;
          const end = w.match(/[.,:]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-library-2 design 6.10 (local index): synthetic examples', () => {
  it('no std-library-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

// ---- parser/lower/targets.ts#otherNotSource: "another" after a sacrifice ------------------------------------------------------------------------------------

const sorcery = (text: string) => face('Sorcery', text);
const steps = (f: ReturnType<typeof face>): string => JSON.stringify(f.abilities);

describe('std-library-2 lowering (CR 109.2, 608.2c, 701.21a, 400.7): "another <card> from your graveyard" right after a sacrifice of an instant or sorcery', () => {
  it('is other than what the sacrifice put into the graveyard: the sacrifice binds its cards and the choice leaves them out', () => {
    for (const text of [
      'Each player sacrifices a creature of their choice. If you sacrificed a creature this way, you may return another creature card from your graveyard to your hand.',
      'Sacrifice an artifact. Return another artifact card from your graveyard to your hand.',
    ]) {
      const f = sorcery(text);
      expect(fullFace(f), `${text}: ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
      expect(steps(f), text).toContain('"as":"sacrificed"');
      // audit-fix-1 (CR 701.21a, 608.2h): after each player's sacrifice, only the one you sacrificed (`which`); after yours alone, what you sacrificed
      expect(steps(f), text).toContain(text.startsWith('Each player') ? '"not":{"is":{"ref":"bound","name":"sacrificed","which":{"controller":"you"}}}' : '"not":{"is":{"ref":"bound","name":"sacrificed"}}');
      expect(steps(f), text).not.toContain('"other":true');
    }
  });
  it('without a sacrifice right before it, or on a permanent (which "another" may mean), it is not read so (fail closed)', () => {
    const f = sorcery('Draw a card. You may return another creature card from your graveyard to your hand.');
    expect(fullFace(f)).toBe(false);
    expect(steps(f)).not.toContain('"name":"sacrificed"');
    const g = face('Creature — Elf', 'When this creature enters, sacrifice a creature. Return another creature card from your graveyard to your hand.', ['2', '2']);
    expect(steps(g)).not.toContain('"not":{"is":{"ref":"bound","name":"sacrificed"}}');
  });
  it('a target of its own keeps "another target" as it was (the rule reads only a sentence with no target)', () => {
    const f = sorcery('Sacrifice an artifact. Return another target artifact card from your graveyard to your hand.');
    expect(steps(f)).not.toContain('"name":"sacrificed"');
  });
});

// ---- parser/lower/ability.ts#joinPreventedThisWay, model/lint-flow.ts: the reflexive trigger on a prevention ------------------------------------------------

describe('std-library-2 sentence join and lint (CR 603.12, 615.5): the shield and "When damage is prevented this way, ..." are one instruction', () => {
  const TEXT = "The next time a source of your choice would deal damage to you this turn, prevent that damage. When damage is prevented this way, ~ deals that much damage to that source's controller and you draw that many cards.";
  it('the two sentences are read by one template; the prevention is named and the reflexive step waits for that name', () => {
    const f = face('Instant', TEXT);
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(f.templatesUsed).toEqual(['eff.stdlibrary2.prevent.nextSourceOfChoice.you.whenPrevented.damageDraw']);
    expect(steps(f)).toContain('"body":{"b":"prevent","amount":"all","as":"prevented","then":[{"op":"reflexive","when":{"did":"prevented"}');
  });
  it('the existing join (std-rx35: "You gain life equal to the damage prevented this way.") is unchanged', () => {
    const f = face('Instant', 'The next time a source of your choice would deal damage to you this turn, prevent that damage. You gain life equal to the damage prevented this way.');
    expect(fullFace(f)).toBe(true);
    expect(f.templatesUsed).toEqual(['eff.stdrx35.prevent.nextSourceOfChoice.you.gainLife']);
  });
  it('another instruction after "When damage is prevented this way," is not read so (fail closed)', () => {
    const f = face('Instant', TEXT.replace("that source's controller", 'any target'));
    expect(fullFace(f)).toBe(false);
  });
  it('the capability body:prevent.as is registered by the engine', () => {
    expect(ENGINE_CAPABILITIES.has('body:prevent.as')).toBe(true);
  });
});
