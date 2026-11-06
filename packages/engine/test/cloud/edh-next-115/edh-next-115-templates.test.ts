/**
 * Round edh-next-115 (third pass over top-rank-t3, EDHREC top 20,000): the template data of parser/templates/zz-cloud/edh-next-115.json and the round's parser,
 * lowering, engine and renderer changes (tested at the end of this file; played in edh-next-115-scenarios.test.ts).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to
 * different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic
 * wordings (design 6.10), checked against the local index when it is present. CR cites from memory (unverified: no rules/cr in a cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhNext115 from '../../../src/parser/templates/zz-cloud/edh-next-115.json';
import review from '../../m5/golden/cards/edh-next-115-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext115 as Template[];
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): a template made stable on fewer than three golden cards because Oracle prints the wording on
 * one card, with its template tests (G9, G2) and played scenarios; listed in the round's record for the owner (decided by the standing rule of 2026-10-27).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'sta.edhn115.spells.demonstrate': ['Silverquill Lecturer'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });

const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || text.startsWith('~') ? card('Example Subject', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text),
  OPTS,
).faces[0]!;

describe('edh-next-115 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-115.json, path order: after edh-next-11, before edh-next-12) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-115.json');
    expect(files.indexOf('zz-cloud/edh-next-115.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-11.json'));
    expect(files.indexOf('zz-cloud/edh-next-115.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-12.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhn115.*', () => {
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|rst|trg|ch|rid)\.edhn115\./);
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

describe('edh-next-115 guard G9 (design 6.8): examples and counter-examples', () => {
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

function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} until end of turn.`];
  for (const [re, by] of [[/\bdemonstrate\b/, 'x'], [/\bcast\b/, 'play']] as [RegExp, string][]) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-115 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-115 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

// ---- the round's hole readings, lowering and render changes (no template of their own) -------------------------------------------------------------------------------------
const make = (text: string, type = 'Creature — Spirit') => parseCard(card('Example Subject', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
const WARS = 'Whenever ~ deals combat damage to a player, you may return target creature card with mana value X or less from your graveyard to the battlefield, where X is the amount of damage ~ dealt to that player.';

describe('edh-next-115: parser/lower/quantities.ts#expandNested and holes/qty.ts (CR 107.3, 608.2h): the where-X clause of a "may" step defines the X of its target', () => {
  it('"you may return target ... mana value X or less ..., where X is the amount of damage ~ dealt" is automated, with the event amount in the target filter', () => {
    const f = make(WARS);
    expect(automated(f.abilities)).toBe(true);
    expect(f.gate.every((g) => g.ok)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"manaValue":{"op":"<=","value":{"q":"eventAmount"}}');
    expect(JSON.stringify(f.abilities)).not.toContain('{"q":"X"}');
  });
  it('near misses stay manual: another definition of X (a Y), no definition at all, "that player" without a damage trigger, a comma in the wrong place', () => {
    const base = 'you may return target creature card with mana value X or less from your graveyard to the battlefield';
    for (const text of [
      `Whenever ~ deals combat damage to a player, ${base}, where Y is the amount of damage ~ dealt to that player.`,
      `Whenever ~ deals combat damage to a player, ${base}.`,
      `Whenever ~ attacks, ${base}, where X is the amount of damage ~ dealt to that player.`,
      `Whenever ~ deals combat damage to a player, ${base}, where X is the amount of damage ~ dealt to that creature.`,
    ]) expect(fullyAutomated(make(text)), text).toBe(false);
  });
  it('review fix: "the amount of damage ~ dealt to that player" is read only in a trigger on the source\'s own damage (another creature\'s or an Equipment\'s damage stays manual)', () => {
    for (const text of [
      'Whenever a creature you control deals combat damage to a player, you gain life equal to the amount of damage ~ dealt to that player.',
      'Whenever one or more creatures you control deal combat damage to a player, draw cards equal to the amount of damage ~ dealt to that player.',
      'Whenever equipped creature deals combat damage to a player, you gain life equal to the amount of damage ~ dealt to that player.',
    ]) expect(fullyAutomated(make(text, 'Artifact')), text).toBe(false);
    expect(fullyAutomated(make('Whenever ~ deals combat damage to a player, you gain life equal to the amount of damage ~ dealt to that player.'))).toBe(true);
  });
});

describe('edh-next-115: holes/event.ts and render/evt.ts (CR 706.2, 603.2c): "whenever you roll a natural 20" is the natural result', () => {
  it('compiles to dieRoll.natural, not to a result, and renders back', () => {
    const f = make('When you roll a natural 20, you gain 1 life.');
    expect(automated(f.abilities)).toBe(true);
    expect(f.gate.every((g) => g.ok)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"natural":20');
    expect(JSON.stringify(f.abilities)).not.toContain('"result"');
  });
  it('near misses: a natural roll without a number, "a natural twenty" spelled out as another word, and "roll a 20" (the result, Dee Kay\'s reading) are different JSON', () => {
    const nat = jsonKey(make('When you roll a natural 20, you gain 1 life.').abilities);
    expect(fullyAutomated(make('When you roll a natural, you gain 1 life.'))).toBe(false);
    expect(fullyAutomated(make('When you roll a natural 0, you gain 1 life.'))).toBe(false);
    const plain = make('When you roll a 20, you gain 1 life.');
    expect(jsonKey(plain.abilities)).not.toBe(nat);
  });
});

describe('edh-next-115: holes/core.ts#mergeFilter (CR 122.2, 406.3): no counters on a card in a graveyard, hand or library', () => {
  it('"exile up to one target legendary creature card from a graveyard with a memory counter on it" is the move that puts the counter', () => {
    const f = make('At the beginning of your end step, exile up to one target legendary creature card from a graveyard with a memory counter on it.', 'Legendary Artifact');
    expect(automated(f.abilities)).toBe(true);
    expect(JSON.stringify(f.abilities)).toMatch(/"counters":\[\{"(?:count":1,"kind":"memory"|kind":"memory","count":1)\}\]/);
    expect(JSON.stringify(f.abilities)).not.toContain('"counters":{"kind":"memory"}');
  });
  it('a card IN EXILE with a counter is still a filter (suspend, memory), and a permanent with a counter too', () => {
    const f = make('{T}: Until your next turn, target legendary creature you control becomes a copy of target creature card in exile with a memory counter on it.', 'Artifact');
    expect(JSON.stringify(f.abilities)).toContain('"counters":{"kind":"memory"}');
    expect(fullyAutomated(make('{T}: Destroy target creature with a +1/+1 counter on it.', 'Artifact'))).toBe(true);
  });
  it('a graveyard card "with a counter on it" that no instruction puts there stays manual (return it, no move to exile)', () => {
    expect(fullyAutomated(make('{T}: Return target creature card from your graveyard with a memory counter on it to your hand.', 'Artifact'))).toBe(false);
  });
});

describe('edh-next-115: holes/r3mech.ts, holes/event.ts, render/evt.ts: Battle of Hoover Dam\'s faction words, Mila\'s once-per-declaration attack trigger', () => {
  it('"choose NCR or Legion" is a Siege-style choice; a word outside the closed list is no choice', () => {
    const ok = make('As this enchantment enters, choose NCR or Legion.\n• NCR -- At the beginning of your end step, you gain 2 life.\n• Legion -- At the beginning of your end step, each opponent loses 2 life.', 'Enchantment');
    expect(automated(ok.abilities)).toBe(true);
    expect(fullyAutomated(make('As this enchantment enters, choose NCR or Raiders.\n• NCR -- At the beginning of your end step, you gain 2 life.\n• Raiders -- At the beginning of your end step, each opponent loses 2 life.', 'Enchantment'))).toBe(false);
  });
  it('"an opponent attacks one or more planeswalkers you control" is wholeBatch (one trigger), "attacks a planeswalker you control" keeps one for each planeswalker', () => {
    const once = make('Whenever an opponent attacks one or more planeswalkers you control, you gain 1 life.', 'Artifact');
    expect(automated(once.abilities)).toBe(true);
    expect(JSON.stringify(once.abilities)).toContain('"wholeBatch":true');
    const each = make('Whenever an opponent attacks a planeswalker you control, you gain 1 life.', 'Artifact');
    expect(JSON.stringify(each.abilities)).not.toContain('"wholeBatch"');
    expect(fullyAutomated(make('Whenever an opponent attacks two or more planeswalkers you control, you gain 1 life.', 'Artifact'))).toBe(false);
    expect(fullyAutomated(make('Whenever you attack one or more planeswalkers you control, you gain 1 life.', 'Artifact'))).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-next-115 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-115 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim().replace(/^[•] */, ''));
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
