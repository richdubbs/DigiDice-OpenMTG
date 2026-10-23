/**
 * Phase 2 lane p2-coinflip, round p2-coinflip-3: the template data of parser/templates/zz-cloud/p2-coinflip-3.json ("return a <filter> card at random from your
 * graveyard to the battlefield"; "for each flip you win, create ... that's tapped and attacking"; "<player> may discard N cards at random"), the quantity "for each
 * flip you win" (after "flip N coins", whose flips it has called: `flipCoin.called`) and the renderer's readings of them. Guard G9 (design 6.8): every example lowers with its template,
 * is automated and passes the exact render gate (G6); every counter-example does not give the same JSON; near-miss mutations fail or differ; a nonsense word in
 * place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10, checked against the local index when it is
 * present). CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import p2Coinflip3 from '../../../src/parser/templates/zz-cloud/p2-coinflip-3.json';
import review from '../../m5/golden/cards/cloud-p2-coinflip-3-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = p2Coinflip3 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
/** Design 6.9 deviation (narrow wordings, named in the round's record): stable on a golden card of the one or two cards of the whole index that print the wording
 * (the draw-then-discard's other card is held out: not read, not golden). */
const NARROW: Readonly<Record<string, string>> = {
  'eff.p2cf3.return.filterCard.randomFromGraveyard.battlefield': 'Tomb Tyrant',
  'eff.p2cf3.forEach.qty.token.tappedAttacking': 'Goblin Traprunner',
  'eff.p2cf3.player.mayDiscard.random': 'Apathy',
};

/** Templates whose examples without a trigger are spell text (a sorcery); the others are abilities of a creature. */
const SPELL = new Set(['eff.p2cf3.player.mayDiscard.random']);
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) && !/^(When|Whenever|At)\b/.test(text) ? parseCard(card('Example Plan', 'Sorcery', text), OPTS) : parseCard(card('Example Seer', 'Creature — Human Wizard', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('p2-coinflip-3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler in path order (zz-cloud/p2-coinflip-2.json, then zz-cloud/p2-coinflip-3.json, before zz-cloud/p2-copy-perm-1.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-coinflip-3.json');
    expect(files.indexOf('zz-cloud/p2-coinflip-2.json')).toBeLessThan(files.indexOf('zz-cloud/p2-coinflip-3.json'));
    expect(files.indexOf('zz-cloud/p2-coinflip-3.json')).toBeLessThan(files.indexOf('zz-cloud/p2-copy-perm-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.p2cf3.*', () => {
    expect(MECH.length).toBe(3);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.p2cf3\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three hand-verified golden cards that name it, or (a recorded deviation) the one card that prints a narrow wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) expect(cards, t.id).toContain(NARROW[t.id]);
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'random', 'except', 'then']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('p2-coinflip-3 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\bat random\b/, 'of their choice'], [/\bthe battlefield\b/, 'your hand'], [/\byour graveyard\b/, "target player's graveyard"], [/\bflip you win\b/, 'coin that comes up heads'],
    [/\btapped and attacking\b/, 'tapped'], [/\bmay discard\b/, 'discards'], [/\bcoins\b/, 'dice'], [/\bcreature card\b/, 'creature cards'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-coinflip-3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/twice/if able" or a swapped key word never gives the example's JSON`, () => {
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

describe('p2-coinflip-3 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('p2-coinflip-3 design 6.10 (local index): synthetic examples', () => {
  it('no example or counter-example line is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

const creature = (text: string) => parseCard(card('Example Seer', 'Creature — Zombie Wizard', text, { power: '1', toughness: '1' }), OPTS).faces[0]!;

describe('p2-coinflip-3 parser and renderer changes (one test each)', () => {
  it('parser/holes/qty.ts, lower/quantities.ts (CR 705.2): "for each flip you win" calls the flips of an earlier "flip N coins" (`called`) and counts the flips won; after a flip that is not that ("flip a coin until you lose a flip", "flip a coin. If you win the flip, ...") it is no quantity (fail closed)', () => {
    const f = creature('{1}: Flip two coins. Create a 1/1 colorless Thopter artifact creature token for each flip you win.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"op":"flipCoin","who":{"ref":"you"},"count":2,"as":"flipcoin","called":true');
    expect(fullyAutomated(creature('{1}: Flip a coin until you lose a flip. Create a 1/1 colorless Thopter artifact creature token for each flip you win.'))).toBe(false);
    expect(fullyAutomated(creature('{1}: Flip a coin. If you win the flip, you gain 2 life. Create a 1/1 colorless Thopter artifact creature token for each flip you win.'))).toBe(false);
  });
  it('render/cond.ts (CR 404.1, 602.5b): "Activate only during your turn and only if there are at least three Zombie creature cards in your graveyard" is the same count as "three or more"', () => {
    const f = creature('{T}: Draw a card. Activate only during your turn and only if there are at least three Zombie creature cards in your graveyard.');
    expect(f.gate.every((g) => g.ok), JSON.stringify(f.gate)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"atLeast":3');
  });
  it('render/fold-p2coinflip1.ts: "return two cards at random from your graveyard to the battlefield" is printed nowhere and has no wording: not automated (fail closed)', () => {
    expect(fullyAutomated(creature('{T}: Return two cards at random from your graveyard to the battlefield.'))).toBe(false);
  });
});
