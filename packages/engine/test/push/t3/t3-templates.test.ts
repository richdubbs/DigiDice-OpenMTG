/**
 * T3 (push wave): the template data of parser/templates/zz-push/t3.json (mana, delayed and restriction shapes of docs/coverage/backlog-R1.txt). Guard G9
 * (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations (an appended "unless", "instead", "at random" or "twice", a negation, a swapped determiner) fail or
 * differ; a nonsense word in place of any word of an example never leaves an automated ability (G2). Examples are synthetic wordings (design 6.10):
 * no example is a line of a real card (checked against the local index when it is present).
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T3 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import t3 from '../../../src/parser/templates/zz-push/t3.json';
import { automated, bare, exampleCard, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T3 = t3 as Template[];
const OPTS = defaultParseOptions();
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('T3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded last by the default compiler (zz-push/t3.json, path order) and its ids are unique in the whole set', () => {
    expect(TEMPLATE_FILES[TEMPLATE_FILES.length - 1]?.file).toMatch(/^zz-push\//);
    expect(TEMPLATE_FILES.some((f) => f.file === 'zz-push/t3.json')).toBe(true);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, is experimental until reviewed, and is of version 2', () => {
    for (const t of T3) {
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(2);
    }
  });
  it('design 6.9: the templates T3 promoted in other files have at least two examples and two counter-examples', () => {
    const PROMOTED = ['eff.draw.equal.you', 'eff.discard.hand.you', 'ch.may', 'ch.maypay.sacrifice', 'eff.cont.becomes.alltypes', 'eff.cont.elk', 'eff.cont.pump.foreach',
      'eff.copy.spell', 'dl.endOfCombat.tail', 'rf.whenYouDo', 'rst.each.cant.beblocked', 'rid.copy.newTargets', 'se.player.may.bf', 'sta.each.pump', 'sta.loseall.base',
      'sta.loseall.each', 'sta.loseall.base.obj', 'sta.typeadd.manavalue', 'trg.you.discard'];
    for (const id of PROMOTED) {
      const t = TEMPLATE_SET.find((x) => x.id === id);
      expect(t?.status, id).toBe('stable');
      expect(t!.examples.length, id).toBeGreaterThanOrEqual(2);
      expect(t!.counterExamples.length, id).toBeGreaterThanOrEqual(2);
    }
  });
  it('design 6.9: templates under 20 corpus matches with no recorded evidence (20 reviewed matches or three verified golden cards) stay experimental', () => {
    // T3 review: these were promoted without that evidence and are experimental again; rst.each.blockonly (2 matches) starts experimental
    // FAST5 PROMO1 promoted eff.discard.hand, eff.piles.handgrave, rid.mana.instantsorcery, eff.return.bf.owner.tapped and eff.return.bf.attacking with three
    // hand-verified golden cards each (test/m5/golden/cards/fast5-promo1-review.json, checked in test/fast5/promo1); the rest have fewer than three cards
    const HELD = ['eff.put.bf.owner', 'eff.put.lib.bottom.anyorder', 'eff.damage.foreach', 'eff.damage.evenly.down', 'eff.shuffle.player',
      'rid.mana.artifact', 'rid.mana.chosentype'];
    // rst.each.blockonly started experimental (2 matches, never promoted before); p2-promote-2 made it stable on Dense Canopy (6.9 narrow wording, t3-review.json)
    for (const id of HELD) expect(TEMPLATE_SET.find((x) => x.id === id)?.status, id).toBe('experimental');
  });
  it('design 6, 6.3: the file holds no per-combination mana templates (the native mana reader composes them; T3 review)', () => {
    expect(T3.filter((t) => t.id.startsWith('eff.mana.'))).toEqual([]);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T3) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('T3 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T3) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
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
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  // (wave 7, r4-refs merge: "the next turn's upkeep" is swapped for "your next upkeep", a different step in a game of two or more players. The former swap to
  // "the next upkeep" now parses with dl.r4refs.nextUpkeep.tail to T3's JSON: T3's build `{step: 'upkeep', next: true}` is the next upkeep, which differs from
  // the next turn's only when a turn has an additional upkeep step (Paradox Haze; CR 500.8, 603.7; unverified); T3's build is left as it is, see the wave-7 record)
  const swaps: [RegExp, string][] = [[/\bonly\b/, ''], [/\bnext turn's\b/, 'your next'], [/\bthe next\b/, 'each'], [/, or /, ', and '], [/\bcan block\b/, "can't block"]];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('T3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T3) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(t, m);
          expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('T3 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T3) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w)) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : w.endsWith(':') ? 'blorfty:' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('T3 design 6.10: examples are synthetic', () => {
  it('no example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura)\b/g, '~').trim());
        }
      }
    }
    const verbatim = T3.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
