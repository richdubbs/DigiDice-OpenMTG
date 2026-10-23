/**
 * Standard round 5, slice r5-dig (library digs and impulse play, the units round 4 left; both halves of the Standard pool, design 6.12): the
 * template data of parser/templates/zz-cloud/r5-dig.json and the parser support it needed. Guard G9 (design 6.8): every example lowers with its template, is
 * automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a
 * nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The chart's end anchor "$", the hole readings and the impulse lowering are pinned here too. The behavior is in
 * r5-dig-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { compileTemplates, validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import r5Dig from '../../../src/parser/templates/zz-cloud/r5-dig.json';
import review from '../../m5/golden/cards/cloud-r5-dig-review.json';
import { automated, bare, card, fake, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const DIG = r5Dig as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a triggered, activated or static ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  // an X that no "where X is" defines is the spell's own X: the card has {X} in its cost (CR 107.3)
  const x = /\bX\b/.test(text) && !/\bwhere X is\b/.test(text) ? { mana_cost: '{X}{B}' } : {};
  if (t.kind !== 'trigger' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text, x);
  return card('Example Brute', 'Creature — Elf Druid', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
const sorcery = (text: string) => parseCard(card('Example Volley', 'Sorcery', text), OPTS).faces[0]!;

describe('r5-dig template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/r5-dig.json, after r4-dig.json, before std-*.json and zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/r5-dig.json');
    expect(files.indexOf('zz-cloud/r5-dig.json')).toBeGreaterThan(files.indexOf('zz-cloud/r4-dig.json'));
    expect(files.indexOf('zz-cloud/r5-dig.json')).toBeLessThan(files.indexOf('zz-cloud/std-blb.json'));
    expect(files.indexOf('zz-cloud/r5-dig.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.r5dig.* or rid.r5dig.*', () => {
    expect(DIG.length).toBeGreaterThanOrEqual(5);
    for (const t of DIG) {
      expect(t.id, t.id).toMatch(t.kind === 'rider' ? /^rid\.r5dig\./ : /^eff\.r5dig\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: at least one hand-verified golden card that uses it (the review file pins each card as full)', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of DIG.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of DIG) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('r5-dig guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of DIG) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        const fellBack = t.status === 'experimental' && f.diagnostics.some((d) => d.code === 'experimental' && d.message.includes(t.id));
        expect(f.templatesUsed.includes(t.id) || fellBack, `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
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
  const body = text.replace(/\.$/, '').replace(/\."$/, '"');
  const plain = text.endsWith('"') ? [] : [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const out = [...plain];
  const swaps: [RegExp, string][] = [
    [/\bfor each\b/, 'for any'], [/\btapped\b/, 'untapped'], [/\buntil the end of your next turn\b/, 'until your next turn'], [/\bgains\b/, 'loses'],
    [/\ban opponent\b/, 'target opponent'], [/\bface-down\b/, 'face-up'], [/\bgraveyard\b/, 'hand'], [/\beach\b/, 'all'], [/\bup to\b/, 'exactly'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('r5-dig guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of DIG) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(t, m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    }, 30_000);
  }
});

describe('r5-dig guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of DIG) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^"?\{/.test(w) || w.includes('\n')) return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const start = w.startsWith('"') ? '"' : '';
          const mutated = [...words.slice(0, i), `${start}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    }, 60_000);
  }
});

describe('r5-dig chart: the end anchor "$" (parser/chart.ts, INTERFACE CHANGE)', () => {
  const end = fake('effect', 'you may reveal up to {n:Qty} creature cards from among them $', { op: 'manual', reason: 'test' }, { id: 'test.r5dig.end' });
  it('"$" must be the last symbol of a pattern, and a pattern of anchors alone is empty', () => {
    expect(compileTemplates([fake('effect', 'scry $ {n:Qty}', { op: 'scry', who: { ref: 'you' }, count: '$n' }, { id: 'test.r5dig.mid' })]).errors.map((e) => e.message).join(' ')).toMatch(/"\$" must be the last symbol/);
    expect(compileTemplates([fake('effect', '^ $', { op: 'manual', reason: 'test' }, { id: 'test.r5dig.empty' })]).errors.map((e) => e.message).join(' ')).toMatch(/empty production/);
    expect(compileTemplates([end]).errors).toEqual([]);
  });
  it('CR 701.20a: "You may reveal up to two creature cards from among them." is read only where nothing is joined after it ("... and put them into your hand" is another template\'s)', () => {
    const alone = sorcery('Look at the top seven cards of your library. You may reveal up to two creature cards from among them. Put the revealed cards into your hand. Then shuffle.');
    expect(alone.templatesUsed).toContain('eff.r5dig.dig.mayReveal.upTo');
    const joined = sorcery('Look at the top seven cards of your library. You may reveal up to two creature cards from among them and put them into your hand. Then shuffle.');
    expect(joined.templatesUsed).not.toContain('eff.r5dig.dig.mayReveal.upTo');
  });
});

describe('r5-dig holes and lowering', () => {
  it('CR 611.2a, 607.2a: the duration hole reads "until you exile another card with ~" as untilExiledWith, and nothing else that starts the same way', () => {
    const f = parsedWith(DIG[0]!, 'Whenever you cast an instant spell, you may exile the top card of your library. If you do, you may play that card until you exile another card with ~.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('{"d":"untilExiledWith"}');
    const other = parsedWith(DIG[0]!, 'Whenever you cast an instant spell, you may exile the top card of your library. If you do, you may play that card until you exile another creature card with ~.');
    expect(fullyAutomated(other)).toBe(false);
  });
  it('CR 608.2c, 400.7: "If you do, you may play that card ..." binds to the card the optional exile exiled, never to the spell of the trigger', () => {
    const f = parsedWith(DIG[0]!, 'Whenever you cast an instant spell, you may exile the top card of your library. If you do, you may play that card until you exile another card with ~.');
    const json = JSON.stringify(f.abilities);
    expect(json).toContain('"op":"may"');
    expect(json).toMatch(/"to":\{"zone":"exile"\},"as":"(\w+)"/);
    const as = /"to":\{"zone":"exile"\},"as":"(\w+)"/.exec(json)![1]!;
    expect(json).toContain(`"of":{"is":{"ref":"bound","name":"${as}"}}`);
  });
  it('CR 603.7, 611.2c: an impulse permission after the exile of a delayed trigger that lasts until end of turn is one of the delayed trigger\'s instructions', () => {
    const f = sorcery('Until end of turn, whenever a creature you control dies, exile the top card of your library. You may play it until the end of your next turn.');
    expect(fullyAutomated(f)).toBe(true);
    const delay = (f.abilities[0] as unknown as { effect: { steps: { op: string; do?: { op: string }[] }[] } }).effect.steps.find((s) => s.op === 'delay')!;
    expect(delay.do!.map((s) => s.op)).toEqual(['move', 'effect']);
  });
  it('CR 608.2c: "the revealed cards" names only the cards an earlier reveal of the ability revealed; with no such reveal the sentence is not automated', () => {
    expect(fullyAutomated(sorcery('Look at the top ten cards of your library. Put the revealed cards into your hand. Then shuffle.'))).toBe(false);
  });
  it('CR 608.2c, 400.7: "those cards" after the exile of a target and the top card of your library is both exiled cards (one move, one group)', () => {
    const f = sorcery('Exile target creature and the top card of your library. For each of those cards, its owner may play it until the end of their next turn.');
    expect(fullyAutomated(f)).toBe(true);
    const json = JSON.stringify(f.abilities);
    const as = /"to":\{"zone":"exile"\},"as":"(\w+)"/.exec(json)![1]!;
    expect(json).toContain(`"op":"forEach","over":{"ref":"bound","name":"${as}"}`);
  });
});

const index = localIndex();

describe.skipIf(index === null)('r5-dig design 6.10 (local index): synthetic examples', () => {
  it('no r5-dig line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = DIG.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
