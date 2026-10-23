/**
 * Lane std-cardcopy, round std-cardcopy-13: the template data of parser/templates/zz-cloud/std-cardcopy-13.json (a described card exiled from your graveyard at
 * random, a tapped token copy), carried over from round std-cardcopy-4 without its "repeat while" (Sin's "If the exiled card is a land card, repeat this
 * process." is std-cardcopy-1's `repeat.again`), and the round's renderer change (render/fold.ts's random exile of a described card).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-cardcopy-13-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/std-cardcopy-13.json';
import review from '../../m5/golden/cards/cloud-std-cardcopy-13-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const MECH_COUNT = 2;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards, with their template tests
 * (G9, G2) and played scenarios; listed in the round's record for the owner. The random exile of a described card is printed on Sin alone. The bare tapped token
 * copy is printed on seven cards, of which the cards that may be used (section 4) and that it reads are two, Sin and Romana II (Kambal and Mardu Siegebreaker read
 * through other templates; Compy Swarm, Hashaton and Scouring Swarm are held-out non-Standard cards, never evidence).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.stdcardcopy13.exile.filterCard.fromGraveyard.atRandom': ["Sin, Spira's Punishment"],
  'eff.stdcardcopy13.copy.token.tapped': ["Sin, Spira's Punishment", 'Romana II'],
};
const golden = review as { card: string; verified: string; expect?: string }[];
const evidence = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`)).map((g) => g.card);
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (an instant); the others are abilities of a creature (static, activated, triggered; "~ gains" needs a creature). */
const SPELL = new Set<string>();
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Plan', 'Instant', text), OPTS) : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('std-cardcopy-13 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-cardcopy-13.json, after std-cardcopy-1, before std-cardcopy-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-cardcopy-13.json');
    expect(files.indexOf('zz-cloud/std-cardcopy-13.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-cardcopy-1.json'));
    expect(files.indexOf('zz-cloud/std-cardcopy-13.json')).toBeLessThan(files.indexOf('zz-cloud/std-cardcopy-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdcardcopy13.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.stdcardcopy13\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) every usable card that prints the wording', () => {
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = evidence(t.id);
      if (NARROW[t.id] !== undefined) expect([...cards].sort(), t.id).toEqual([...NARROW[t.id]!].sort());
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    expect(MECH.every((t) => t.status === 'stable')).toBe(true);
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

describe('std-cardcopy-13 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bat random\b/, 'of your choice'], [/\byour graveyard\b/, "an opponent's graveyard"], [/\btapped token\b/, 'untapped token'], [/\bland card\b/, 'nonland card'],
    [/\brepeat this process\b/, 'repeat this process once'], [/\bIf\b/, 'Unless'], [/\bpermanent card\b/, 'instant card'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-cardcopy-13 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('std-cardcopy-13 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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
          const f = parsedWith(t, mutated);
          // a cost part the model cannot state is no `op: manual` (it is a manual cost part): the card is partial, so it counts as not automated here
          expect(fullyAutomated(f) && !JSON.stringify(f.abilities).includes('"kind":"manual"'), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-cardcopy-13 design 6.10 (local index): synthetic examples', () => {
  it('no std-cardcopy-13 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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


describe('std-cardcopy-13 renderer change (one test)', () => {
  const artifact = (text: string) => parseCard(card('Example Relic', 'Artifact', text), OPTS).faces[0]!;
  it('render/fold.ts#exileRandomFromGraveyard (CR 608.2d): the described card at random, in Oracle\'s order; the plain card keeps its own wording', () => {
    expect(fullyAutomated(artifact("{T}: Exile a creature card from your graveyard at random, then create a token that's a copy of that card."))).toBe(true);
    expect(fullyAutomated(artifact('{T}: Exile a card at random from your graveyard. You may play that card this turn.'))).toBe(true);
  });
  it('the card exiled is "the exiled card" later: "If the exiled card is a land card, repeat this process." reads the bound card (std-cardcopy-1\'s repeat.again)', () => {
    const f = artifact("{T}: Exile a permanent card from your graveyard at random. If the exiled card is a land card, repeat this process.");
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"cond":{"cond":"matches","object":{"ref":"bound","name":"chosen"}');
    expect(JSON.stringify(f.abilities)).toContain('"process":true,"again":true');
  });
});
