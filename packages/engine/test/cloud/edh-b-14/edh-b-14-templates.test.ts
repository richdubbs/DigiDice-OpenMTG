/**
 * Commander lane edh-b, round edh-b-14: the template data of parser/templates/zz-cloud/edh-b-14.json ("Enchanted creature gets +2/+2 for each other creature on the battlefield that shares a creature type
 * with it"; "All creatures can attack your opponents and planeswalkers your opponents control as though those creatures had haste"). The hole, lowering and renderer changes (mana value shared
 * with a named object, "other" with a name shared with the target) are tested in edh-b-14-scenarios.test.ts and at the end of this file.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. CR cites checked against the CR text of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhB14 from '../../../src/parser/templates/zz-cloud/edh-b-14.json';
import review from '../../m5/golden/cards/edh-b-14-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhB14 as Template[];
const MECH_COUNT = 5;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'sta.edhb14.pump.foreach.otherSharesAll': ['Alpha Status'],
  'sta.edhb14.permit.attackHaste.opponents': ['Frenzied Saddlebrute'],
  'eff.edhb14.self.verseCounter.thenItDealsCounters': ['Aria of Flame'],
  'eff.edhb14.destroyAll.notOfChosenTypeThisWay': ['Harsh Mercy'],
  'eff.edhb14.player.returns.commanders.theyControl': ['Leadership Vacuum'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: an Aura or an Equipment for an attached static, an Enchantment for a trigger, else a spell. */
const parsedWith = (t: Template, text: string) => {
  if (t.id.startsWith('eff.') && /^(Whenever)/.test(text)) return parseCard(card('Example Relic', 'Enchantment', text), OPTS).faces[0]!;
  if (t.id.startsWith('sta.')) return parseCard(card('Example Relic', text.includes('Equipped') ? 'Artifact — Equipment' : /Enchanted/.test(text) ? 'Enchantment — Aura' : 'Creature — Orc', text, /Creature/.test(text) ? {} : {}), OPTS).faces[0]!;
  if (/^(At the beginning|Whenever)/.test(text)) return parseCard(card('Example Relic', 'Enchantment', text), OPTS).faces[0]!;
  return parseCard(card('Example Plan', 'Instant', text), OPTS).faces[0]!;
};

describe('edh-b-14 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-b-14.json, path order: after edh-perms-1, before edh-b-9) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-b-14.json');
    expect(files.indexOf('zz-cloud/edh-b-14.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-b-1.json'));
    expect(files.indexOf('zz-cloud/edh-b-14.json')).toBeLessThan(files.indexOf('zz-cloud/edh-b-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff./sta./rep.edhb14.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep)\.edhb14\./);
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

describe('edh-b-14 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-b-14 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-b-14 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-b-14 design 6.10 (local index): synthetic examples', () => {
  it('no edh-b-14 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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





describe('edh-b-14 parser, lowering and renderer changes (one test each)', () => {
  const spell = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
  it('parser/holes/filter.ts + render/np.ts + types ObjectFilter.sharesWith.quality manaValue (CR 202.3): "with the same mana value as that permanent" reads after a target; "without", "a different mana value" and a missing object are not read', () => {
    const t = (tail: string) => spell(`Return target nonland permanent and each other nonland permanent ${tail} to their owners' hands.`);
    const ok = t('with the same mana value as that permanent');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"quality":"manaValue"');
    expect(fullyAutomated(t('with a different mana value than that permanent'))).toBe(false);
    expect(fullyAutomated(t('without the same mana value as that permanent'))).toBe(false);
    expect(fullyAutomated(t('with the same mana value'))).toBe(false);
  });
  it('parser/lower/anaphora.ts#otherSharesNameWithTarget (CR 201.2, 608.2c): on a permanent, "target X not named ~ and all other permanents with the same name as that permanent" is read; without "not named", or sharing another quality, it stays manual', () => {
    const perm = (text: string) => parseCard(card('Example Sphere', 'Enchantment', text), OPTS).faces[0]!;
    const ok = perm('When this enchantment enters, you may exile target nonland permanent not named Example Sphere and all other permanents with the same name as that permanent.');
    expect(automated(ok.abilities)).toBe(true);
    expect(automated(perm('When this enchantment enters, you may exile target nonland permanent and all other permanents with the same name as that permanent.').abilities)).toBe(false);
    expect(automated(perm('When this enchantment enters, you may exile target nonland permanent not named Example Sphere and all other permanents with the same mana value as that permanent.').abilities)).toBe(false);
  });
  it('render/np.ts + render/mods.ts (CR 205.3m, 613.4c): under an Aura, "each other creature that shares a creature type with it" is said with `sharesWith.other` against the enchanted creature; "each creature" or another quality is not the same ability', () => {
    const aura = (text: string) => parseCard(card('Example Aura', 'Enchantment — Aura', `Enchant creature\n${text}`), OPTS).faces[0]!;
    expect(fullyAutomated(aura('Enchanted creature gets +1/+1 for each other creature on the battlefield that shares a creature type with it.'))).toBe(true);
    expect(fullyAutomated(aura('Enchanted creature gets +1/+1 for each creature on the battlefield that shares a creature type with it.'))).toBe(false);
    expect(fullyAutomated(aura('Enchanted creature gets +1/+1 for each other creature on the battlefield that shares a color with it.'))).toBe(false);
  });
});
