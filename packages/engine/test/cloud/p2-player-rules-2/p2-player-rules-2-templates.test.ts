/**
 * p2-player-rules-2 (Phase 2 lane p2-player-rules): the template data of parser/templates/zz-cloud/p2-player-rules-2.json and the step, handler, fold and renderer
 * support it needed. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does
 * not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2).
 * Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in p2-player-rules-2-scenarios.test.ts.
 *
 *   types/ability.ts, effects/handlers/cards-library.ts#clashHandler   step `clash` (CR 701.30): reveal, compare mana values, top or bottom, the branch of the result
 *   parser/lower/clash.ts                              "If you win, X. Otherwise, Y." after the clash right before it become its `onWin` / `onLose`
 *   render/steps-lasting.ts                            "clash with an opponent. if you win, X. otherwise, Y."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import p2pr2 from '../../../src/parser/templates/zz-cloud/p2-player-rules-2.json';
import review from '../../m5/golden/cards/p2-player-rules-2-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const P2PR2 = p2pr2 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Design 6.9 evidence for a stable template: three or more hand-verified golden cards (tuning half). */
const GOLDEN: Readonly<Record<string, readonly string[]>> = {
  'eff.p2pr2.clash': ['Research the Deep', 'Revive the Fallen', 'Release the Ants', 'Redeem the Lost', 'Weed Strangle', "Nath's Elite", 'Paperfin Rascal'],
  'eff.p2pr2.ifClash.win': ['Research the Deep', 'Revive the Fallen', 'Release the Ants', 'Redeem the Lost', 'Weed Strangle', "Nath's Elite", 'Paperfin Rascal'],
};

/** A synthetic card in which an example is an ability of the right kind: a keyword line on an artifact, a triggered ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'ability' || t.kind === 'static') return card('Example Relic', 'Artifact', text);
  if (t.kind === 'effect' && !/^When/.test(text)) return card('Example Edict', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('p2-player-rules-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-player-rules-2.json, after look3.json, before r3-choose.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-player-rules-2.json');
    expect(files.indexOf('zz-cloud/p2-player-rules-2.json')).toBeGreaterThan(files.indexOf('zz-cloud/look3.json'));
    expect(files.indexOf('zz-cloud/p2-player-rules-2.json')).toBeLessThan(files.indexOf('zz-cloud/r3-choose.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are sta.p2pr2.* or eff.p2pr2.*', () => {
    expect(P2PR2.length).toBe(2);
    for (const t of P2PR2) {
      expect(t.id, t.id).toMatch(/^(sta|eff)\.p2pr2\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 (narrow wordings): a stable template has its hand-verified golden card(s); the review pins every card as full', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of P2PR2.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id},`)).map((g) => g.card);
      expect(cards.slice().sort(), t.id).toEqual([...(GOLDEN[t.id] ?? [])].sort());
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of P2PR2) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'still']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('p2-player-rules-2 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of P2PR2) {
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
    [/\bIf you win\b/, 'If you lose'], [/\bClash with\b/, 'Fight with'], [/\ban opponent\b/, 'target opponent'], [/\bOtherwise\b/, 'Then'], [/\bclash with\b/, 'fight with'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-player-rules-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of P2PR2) {
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

describe('p2-player-rules-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of P2PR2) {
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

describe('p2-player-rules-2 fold and renderer support', () => {
  const face = (type: string, text: string) => parseCard(card('Example Edict', type, text), OPTS).faces[0]!;
  const steps = (text: string): string => JSON.stringify(face('Sorcery', text).abilities);
  it('CR 701.30, 608.2c: "If you win, X. Otherwise, Y." right after the clash become its branches; the clash is with the opponent you choose', () => {
    expect(steps('Clash with an opponent. If you win, draw two cards. Otherwise, you lose 1 life.')).toContain('"op":"clash","who":{"ref":"you"},"with":{"ref":"anOpponent"},"onWin":[');
    expect(steps('Clash with an opponent. If you win, draw two cards. Otherwise, you lose 1 life.')).toContain('"onLose":[');
  });
  it('CR 608.2c, design 6.4: "If you win" with no clash right before it, or after a sentence that is not understood, is no reading', () => {
    expect(fullyAutomated(face('Sorcery', 'Draw a card. If you win, you gain 4 life.'))).toBe(false);
    expect(fullyAutomated(face('Sorcery', 'Clash with an opponent. Blorft a card. If you win, you gain 4 life.'))).toBe(false);
  });
  it('CR 701.30: a clash whose result sentence is not understood is not left automated (it would clash with nobody acting on the result)', () => {
    const f = face('Sorcery', 'Clash with an opponent. If you win, blorft two cards.');
    expect(fullyAutomated(f)).toBe(false);
    expect(JSON.stringify(f.abilities)).not.toContain('"op":"clash"');
  });
  it('CR 705.2: "If you win the flip" is still the coin flip\'s, never a clash result', () => {
    expect(steps('Flip a coin. If you win the flip, draw a card.')).toContain('"op":"flipCoin"');
  });
});

const index = localIndex();

describe.skipIf(index === null)('p2-player-rules-2 design 6.10 (local index): synthetic examples', () => {
  it('no p2-player-rules-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = P2PR2.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
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
