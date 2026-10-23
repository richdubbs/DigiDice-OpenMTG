/**
 * p2-attack-block-2 (lane p2-attack-block): the template data of parser/templates/zz-cloud/p2-attack-block-2.json ("<obj> can't block <filter>", "<filter> can't block
 * it", "as long as <cond>, it can attack as though it didn't have defender", "~ can attack as though it didn't have defender as long as <cond>", "Until <dur>, <objs>
 * can't block", "~ can't block unless <cond>"), and one test per parser, lowering and renderer change of the round.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in p2-attack-block-2-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import p2ab2 from '../../../src/parser/templates/zz-cloud/p2-attack-block-2.json';
import review from '../../m5/golden/cards/p2-attack-block-2-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = p2ab2 as Template[];
const MECH_COUNT = 6;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards, with their template tests (G9, G2)
 * and played scenarios; DECIDED BY DEFAULT (owner instruction 2026-10-21: never ask), listed in the round's record for the owner. The value is a golden card that
 * must be among the template's evidence.
 */
const NARROW: Readonly<Record<string, string>> = {
  'sta.p2ab2.filter.cantblock.it': 'Silumgar Assassin',
  'sta.p2ab2.aslong.it.attack.nodefender': 'Scuttlegator',
  'sta.p2ab2.attack.nodefender.aslong': 'Ogre Jailbreaker',
  'eff.p2ab2.dur.each.cant.block': 'Taunt from the Rampart',
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: an instruction is a sorcery's, a static ability a creature's (an Aura's for "enchanted"). */
const exampleOf = (t: Template, text: string) =>
  t.kind === 'effect' ? card('Example Plan', 'Sorcery', text)
    : /enchanted/i.test(text) ? card('Example Charm', 'Enchantment — Aura', `Enchant creature\n${text}`)
      : card('Example Warden', 'Creature — Human Soldier', /didn't have defender/.test(text) ? `Defender\n${text}` : text, { power: '2', toughness: '2' }); // a defender permission is a Wall's
const parsedWith = (t: Template, text: string) => parseCard(exampleOf(t, text), OPTS).faces[0]!;

describe('p2-attack-block-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-attack-block-2.json, after zz-cloud/look3.json, before zz-cloud/r3-choose.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-attack-block-2.json');
    expect(files.indexOf('zz-cloud/p2-attack-block-2.json')).toBeGreaterThan(files.indexOf('zz-cloud/look3.json'));
    expect(files.indexOf('zz-cloud/p2-attack-block-2.json')).toBeLessThan(files.indexOf('zz-cloud/r3-choose.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.p2ab2.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(sta|eff)\.p2ab2\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) its named golden card', () => {
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

describe('p2-attack-block-2 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
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
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\bcan't\b/, 'can'], [/\bblock\b/, 'attack'], [/\bexcept by\b/, 'by'], [/\bdidn't have\b/, 'had'], [/\balone\b/, 'together'], [/\bless than\b/, 'greater than'],
    [/\bwithout\b/, 'with'], [/\bHumans\b/, 'Goblins'], [/\byour next turn\b/, 'end of turn'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-attack-block-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able" or a swapped key word never gives the example's JSON`, () => {
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

describe('p2-attack-block-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
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

describe.skipIf(index === null)('p2-attack-block-2 design 6.10 (local index): synthetic examples', () => {
  it('no line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('p2-attack-block-2: the parser, lowering and renderer changes of the round', () => {
  const face = (text: string, type = 'Creature — Human Soldier') => parseCard(card('Example Warden', type, text, type.startsWith('Creature') ? { power: '2', toughness: '2' } : {}), OPTS).faces[0]!;
  it('Cond (CR 506.2, 404.1): "defending player has seven or more cards in their graveyard" is the size of the defending player\'s graveyard, said so by the renderer', () => {
    const f = face("~ can't attack unless defending player has seven or more cards in their graveyard.");
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(bare(f.abilities))).toContain('{"q":"zoneSize","zone":"graveyard","of":{"ref":"defending"}}');
  });
  it('Cond (CR 506.2, 402.1): "defending player has two or more cards in hand" is the size of the defending player\'s hand', () => {
    const f = face("~ can't attack unless defending player has two or more cards in hand.");
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(bare(f.abilities))).toContain('{"q":"zoneSize","zone":"hand","of":{"ref":"defending"}}');
  });
  it('lowering (CR 701.15a, 608.2c): "those creatures" after "Goad all creatures your opponents control" is the goaded group, bound by the goad step', () => {
    const f = parseCard(card('Example Plan', 'Sorcery', "Goad all creatures your opponents control. Until end of turn, those creatures can't block."), OPTS).faces[0]!;
    const json = JSON.stringify(bare(f.abilities));
    expect(json).toContain('"action":"goad"');
    expect(json).toContain('"subject":{"ref":"bound","name":"them"}');
  });
});
