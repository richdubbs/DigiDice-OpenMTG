/**
 * Commander lane edh-perms, round edh-perms-11: the template data of parser/templates/zz-cloud/edh-perms-11.json ("Equipped creature gets +1/+1 for each other creature you control that shares a
 * creature type with it"; "If one or more creature tokens would be created under your control, those tokens plus a T are created instead"). The hole, lowering and renderer changes
 * (base power or toughness, "you had enter", "counters it had on it", "other than ~" after a counted group, "each other planeswalker" beside a creature group, "cards exiled with it") are
 * tested at the end of this file and in edh-perms-11-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in edh-perms-11-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhPm11 from '../../../src/parser/templates/zz-cloud/edh-perms-11.json';
import review from '../../m5/golden/cards/edh-perms-11-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhPm11 as Template[];
const MECH_COUNT = 2;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'sta.edhpm11.pump.foreach.otherShares': ['Stoneforge Masterwork'],
  'rep.edhpm11.creatureTokens.plusA.passive': ['Queen Allenal of Ruadach'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: an Aura or an Equipment for an attached static, an Enchantment for a trigger, else a spell. */
const parsedWith = (t: Template, text: string) => {
  if (t.id.startsWith('rep.')) return parseCard(card('Example Relic', 'Creature — Elf', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  if (t.id.startsWith('sta.')) return parseCard(card('Example Relic', text.includes('Equipped') ? 'Artifact — Equipment' : 'Enchantment — Aura', text), OPTS).faces[0]!;
  if (/^(At the beginning|Whenever)/.test(text)) return parseCard(card('Example Relic', 'Enchantment', text), OPTS).faces[0]!;
  return parseCard(card('Example Plan', 'Instant', text), OPTS).faces[0]!;
};

describe('edh-perms-11 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-perms-11.json, path order: after edh-perms-1, before edh-perms-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-perms-11.json');
    expect(files.indexOf('zz-cloud/edh-perms-11.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-perms-1.json'));
    expect(files.indexOf('zz-cloud/edh-perms-11.json')).toBeLessThan(files.indexOf('zz-cloud/edh-perms-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff./sta./rep.edhpm11.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep)\.edhpm11\./);
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

describe('edh-perms-11 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bremoved this way\b/, 'put this way'], [/\bfor each\b/, 'for every two'], [/\ban additional\b/, 'two additional'], [/\bany number of\b/, 'all'],
    [/\bany type\b/, 'any color'], [/\bany color\b/, 'any type'], [/\bcould produce\b/, 'produced'], [/\bland produced\b/, 'creature produced'],
    [/\byou control\b/, 'an opponent controls'], [/\ban opponent controls\b/, 'you control'], [/\bone mana\b/, 'two mana'], [/\bplus that many\b/, 'plus twice that many'], [/\bthat many\b/, 'twice that many'], [/\bone or more\b/, 'two or more'], [/\bnumber of\b/, 'number of twice'], [/\bequal to\b/, 'equal to twice'], [/\bcan't be blocked\b/, 'can be blocked'], [/\bin addition to\b/, 'instead of'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-perms-11 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-perms-11 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-perms-11 design 6.10 (local index): synthetic examples', () => {
  it('no edh-perms-11 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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




describe('edh-perms-11 parser, lowering and renderer changes (one test each)', () => {
  const creature = (text: string) => parseCard(card('Example Beast', 'Creature — Beast', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  const spell = (text: string) => parseCard(card('Example Plan', 'Instant', text), OPTS).faces[0]!;
  const walker = (text: string, loyalty = '4') => parseCard(card('Example Walker', 'Legendary Planeswalker — Test', text), { ...OPTS }).faces[0]!;
  it('parser/holes/filter.ts + render/np.ts + types ObjectFilter.basePowerOrToughness (CR 208.1, 613.4a-b): "with base power or toughness N" reads on a counted group; "without", "base power and toughness" and a missing number are not read', () => {
    const ok = parseCard(card('Example Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+1 for each creature you control with base power or toughness 2.'), OPTS).faces[0]!;
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"basePowerOrToughness":{"op":"==","value":2}');
    const no = (t: string) => fullyAutomated(parseCard(card('Example Blade', 'Artifact — Equipment', t), OPTS).faces[0]!);
    expect(no('Equipped creature gets +1/+1 for each creature you control without base power or toughness 2.')).toBe(false);
    expect(no('Equipped creature gets +1/+1 for each creature you control with base power and toughness 2.')).toBe(false);
    expect(no('Equipped creature gets +1/+1 for each creature you control with base power or toughness.')).toBe(false);
    expect(no('Equipped creature gets +1/+1 for each creature you control with base power or toughness 2 or less.')).toBe(true);
  });
  it('parser/holes/qty.ts + render/qty.ts (CR 603.6a, 603.4): "the number of Fs you had enter the battlefield under your control this turn" is the turn\'s history of zone changes; an opponent\'s, "you had leave" and a missing "under your control" are not read', () => {
    const t = (tail: string) => creature(`At the beginning of your end step, create a number of Food tokens equal to the number of nontoken creatures you had ${tail} this turn.`);
    const ok = t('enter the battlefield under your control');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"q":"happenedCount"');
    expect(fullyAutomated(t('enter the battlefield under an opponent\'s control'))).toBe(false);
    expect(fullyAutomated(t('leave the battlefield under your control'))).toBe(false);
    expect(fullyAutomated(t('enter the battlefield'))).toBe(false);
  });
  it('parser/holes/qty.ts + render/qty.ts (CR 122.1, 603.10a): "the number of counters it had on it" counts the counters of every kind of the object; "a counter", "counters on it" in the past tense of another object and a missing "on it" are not read', () => {
    const t = (tail: string) => creature(`Whenever a nontoken creature you control dies, if it had counters on it, you gain life equal to ${tail}.`);
    const ok = t('the number of counters it had on it');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"q":"counters"');
    expect(fullyAutomated(t('the number of counters it had'))).toBe(false);
    expect(fullyAutomated(t('the number of counters you had on it'))).toBe(false);
    expect(fullyAutomated(t('the number of counter it had on it'))).toBe(false);
  });
  it('render/np.ts (CR 109.2, 608.2h): a counted group is also "the number of Fs you control other than ~" (other than the source); a group the source is not part of keeps the older refusal', () => {
    const t = (what: string) => creature(`Whenever ~ attacks, you gain life equal to the number of ${what}.`);
    expect(fullyAutomated(t('modified creatures you control other than ~'))).toBe(true);
    expect(fullyAutomated(t('other modified creatures you control'))).toBe(true);
    expect(fullyAutomated(t('modified creatures you control other than ~ and tapped'))).toBe(false);
    expect(fullyAutomated(t('modified artifacts you control other than ~'))).toBe(false); // the source is no artifact: "other" cannot mean "other than ~"
  });
  it('parser/lower/anaphora.ts (CR 109.2, 608.2c, design 6.4): "each other planeswalker" beside a creature group is other than the planeswalker itself; beside a group of its own kind, or in a spell, it stays manual', () => {
    const ok = walker('-2: Put a +1/+1 counter on each creature you control and a loyalty counter on each other planeswalker you control.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(fullyAutomated(walker('-2: Put a +1/+1 counter on each creature you control and a loyalty counter on each other creature you control.'))).toBe(false);
    expect(fullyAutomated(walker('-2: Put a +1/+1 counter on each planeswalker you control and a loyalty counter on each other planeswalker you control.'))).toBe(false);
    expect(fullyAutomated(spell('Put a +1/+1 counter on each creature you control and a loyalty counter on each other planeswalker you control.'))).toBe(false);
    // review finding: groups of overlapping kinds (a subtype and its card type) stay two candidates
    const elf = parseCard(card('Example Elf', 'Creature — Elf', 'When ~ enters, put a +1/+1 counter on each Elf you control and a shield counter on each other creature you control.', { power: '2', toughness: '2' }), OPTS).faces[0]!;
    expect(fullyAutomated(elf)).toBe(false);
  });
  it('parser/holes/qty.ts + render/qty.ts (CR 607.2a): "the number of cards exiled with ~ / it" is the count of the linked exile; it needs the linking ability (none: manual)', () => {
    const cart = (extra: string) => parseCard(card('Example Cart', 'Artifact — Vehicle', `${extra}Example Cart's power and toughness are each equal to the number of cards exiled with it.`), OPTS).faces[0]!;
    expect(fullyAutomated(cart('{T}: Exile up to two target cards from a single graveyard.\n'))).toBe(true);
    expect(fullyAutomated(cart(''))).toBe(false);
  });
});
