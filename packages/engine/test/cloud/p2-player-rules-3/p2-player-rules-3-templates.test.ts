/**
 * p2-player-rules-3 (Phase 2 lane p2-player-rules): the template data of parser/templates/zz-cloud/p2-player-rules-3.json and the event and renderer support it
 * needed. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2).
 * Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in p2-player-rules-3-scenarios.test.ts.
 *
 *   effects/handlers/cards-library.ts#clashHandler, triggers/*   the `action` event `clash` with `won` for each clashing player (CR 701.30b-c)
 *   render/evt.ts#clashParts                                       "whenever you clash (and win)"; "whenever you win a clash" (family clash-and-win)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import p2pr3 from '../../../src/parser/templates/zz-cloud/p2-player-rules-3.json';
import review from '../../m5/golden/cards/p2-player-rules-3-review.json';
import t68Review from '../../m5/golden/cards/fast5-t68-review.json'; // Conqueror's Flail: its earlier entry, updated (docs/CARD_AUTOMATION.md section 6)
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const P2PR3 = p2pr3 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/**
 * Design 6.9 evidence: each wording is printed by one tuning-half card ("Narrow wordings", docs/CARD_AUTOMATION.md section 5): stable on its hand-verified golden card
 * plus these tests and the played scenarios (a deviation from 6.9 that the round's record names). trg.p2pr3.youClash reads no tuning-half card: experimental.
 */
const GOLDEN: Readonly<Record<string, readonly string[]>> = {
  'sta.p2pr3.aslong.cantCast.yourTurn': ["Conqueror's Flail"],
  'trg.p2pr3.youClashAndWin': ['Sylvan Echoes'],
};

/** A synthetic card in which an example is an ability of the right kind: a keyword line on an artifact, a triggered ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'ability' || t.kind === 'static') return card('Example Relic', 'Artifact', text);
  if (t.kind === 'effect' && !/^When/.test(text)) return card('Example Edict', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('p2-player-rules-3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-player-rules-3.json, after look3.json, before r3-choose.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-player-rules-3.json');
    expect(files.indexOf('zz-cloud/p2-player-rules-3.json')).toBeGreaterThan(files.indexOf('zz-cloud/look3.json'));
    expect(files.indexOf('zz-cloud/p2-player-rules-3.json')).toBeLessThan(files.indexOf('zz-cloud/r3-choose.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are sta.p2pr3.* or eff.p2pr3.*', () => {
    expect(P2PR3.length).toBe(3);
    for (const t of P2PR3) {
      expect(t.id, t.id).toMatch(/^(sta|eff|trg)\.p2pr3\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 (narrow wordings): a stable template has its hand-verified golden card(s); the review pins every card as full', () => {
    const golden = [...review, ...(t68Review as { card: string; verified: string }[]).filter((g) => g.verified.includes('p2-player-rules-3'))] as { card: string; verified: string; expect?: string }[];
    for (const t of P2PR3.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id},`)).map((g) => g.card);
      expect(cards.slice().sort(), t.id).toEqual([...(GOLDEN[t.id] ?? [])].sort());
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of P2PR3) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'still']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('p2-player-rules-3 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of P2PR3) {
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

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = text.endsWith('.') ? [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`] : [`${text} unless it is blue`, `${text}, and a Wizard`];
  const swaps: [RegExp, string][] = [
    [/\bduring your turn\b/, 'during combat'], [/\byour opponents\b/, 'you'], [/\bAs long as\b/, 'Unless'], [/\band win\b/, 'and lose'], [/\bwin a clash\b/, 'lose a clash'], [/\bWhenever you\b/, 'Whenever an opponent'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-player-rules-3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of P2PR3) {
    it(`${t.id}: an appended rider or a swapped key word never gives the example's JSON`, () => {
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

describe('p2-player-rules-3 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of P2PR3) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '~,' || /^"?\{/.test(w) || w.includes('\n')) return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('p2-player-rules-3 event and renderer support', () => {
  const face = (type: string, text: string) => parseCard(card('Example Relic', type, text), OPTS).faces[0]!;
  it('CR 701.30c: "whenever you clash and win" and "whenever you win a clash" are one event, a clash of yours that you won', () => {
    const a = JSON.stringify(face('Enchantment', 'Whenever you clash and win, you gain 2 life.').abilities[0]);
    expect(a).toContain('"ev":"action","verb":"clash","actor":"you","won":true');
    expect(jsonKey(face('Enchantment', 'Whenever you clash and win, you gain 2 life.').abilities)).toBe(jsonKey(face('Enchantment', 'Whenever you win a clash, you gain 2 life.').abilities));
  });
  it('CR 701.30: a clash event of another player is no reading here (fail closed)', () => {
    expect(fullyAutomated(face('Enchantment', 'Whenever an opponent clashes, you gain 1 life.'))).toBe(false);
  });
  it('CR 611.3a: the condition of "As long as C, your opponents can\'t cast spells during your turn" is the static ability\'s own', () => {
    const t = P2PR3.find((x) => x.id === 'sta.p2pr3.aslong.cantCast.yourTurn')!;
    expect(JSON.stringify(parsedWith(t, t.examples[0]!.text).abilities)).toContain('"condition":');
  });
});

const index = localIndex();

describe.skipIf(index === null)('p2-player-rules-3 design 6.10 (local index): synthetic examples', () => {
  it('no p2-player-rules-3 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const [name, text] of [[c.name, c.oracle_text], ...(c.card_faces ?? []).map((x) => [x.name, x.oracle_text])] as [string, string | undefined][]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = P2PR3.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  // the try step on real cards: each card reads its line with the named template, passes the exact render gate and is fully automated
  const REAL: Readonly<Record<string, readonly string[]>> = {
    ...GOLDEN,
  };
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.join(', ')} read their line with it, pass the render gate and are fully automated`, () => {
      for (const name of names) {
        const c = (index ?? []).find((x) => x.name === name);
        expect(c, name).toBeDefined();
        const p = parseCard(c!, OPTS);
        expect(p.faces.some((f) => f.templatesUsed.includes(id)), `${name}: ${p.faces.map((f) => f.templatesUsed.join(',')).join(' | ')}`).toBe(true);
        for (const f of p.faces) {
          expect(fullyAutomated(f), `${name}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
          expect(f.gate.every((g) => g.ok), name).toBe(true);
        }
      }
    }, 60_000);
  }
});
