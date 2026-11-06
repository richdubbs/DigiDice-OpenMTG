/**
 * Commander lane edh-perms, round edh-perms-8: the template data of parser/templates/zz-cloud/edh-perms-8.json ("Return ~ to the battlefield attached to that creature" after an Aura's
 * host died; "Put N counters on target creature, then double the number of counters on each creature that had one put on it this way"; "You draw cards equal to the sacrificed
 * creature's power, then you gain life equal to its toughness"; "Put a number of counters on each other creature you control equal to that creature's toughness"). The hole,
 * lowering, engine and renderer changes (a list of exact mana values, the tokens you created this turn, an activated ability with {T} in its cost, the Aura card named inside a delayed
 * trigger, overload of a counters spell) are tested at the end of this file and in edh-perms-8-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in edh-perms-8-scenarios.test.ts. CR cites from
 * memory unless noted, unverified.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhPm8 from '../../../src/parser/templates/zz-cloud/edh-perms-8.json';
import review from '../../m5/golden/cards/edh-perms-8-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';
import { overloadProgram } from '../../../src/effects/overload';

const MECH = edhPm8 as Template[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'eff.edhpm8.returnSelf.attached': ['Gift of Immortality'],
  'eff.edhpm8.counters.put.thenDoublePut': ['Fangs of Kalonia'],
  'eff.edhpm8.sacrificed.drawPowerGainToughness': ['Momentous Fall'],
  'eff.edhpm8.counters.eachOwnToughness': ['Canopy Gargantuan'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: an Aura for the Aura trigger, a spell with its additional cost, an Enchantment for a trigger, else a spell. */
const parsedWith = (t: Template, text: string) => {
  if (t.id === 'eff.edhpm8.returnSelf.attached') return parseCard(card('Example Relic', 'Enchantment — Aura', `Enchant creature\n${text}`), OPTS).faces[0]!;
  if (/each other creature/.test(text) && /^At the beginning/.test(text)) return parseCard(card('Example Drake', 'Creature — Dragon', text, { power: '3', toughness: '3' }), OPTS).faces[0]!;
  if (/^(At the beginning|Whenever)/.test(text)) return parseCard(card('Example Relic', 'Enchantment', text), OPTS).faces[0]!;
  return parseCard(card('Example Plan', 'Instant', text), OPTS).faces[0]!;
};

describe('edh-perms-8 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-perms-8.json, path order: after edh-perms-5, before look3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-perms-8.json');
    expect(files.indexOf('zz-cloud/edh-perms-8.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-perms-5.json'));
    expect(files.indexOf('zz-cloud/edh-perms-8.json')).toBeLessThan(files.indexOf('zz-cloud/look3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.edhpm8.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.edhpm8\./);
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

describe('edh-perms-8 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\byou control\b/, 'an opponent controls'], [/\ban opponent controls\b/, 'you control'], [/\bone mana\b/, 'two mana'], [/\bplus that many\b/, 'plus twice that many'], [/\bthat many\b/, 'twice that many'], [/\bone or more\b/, 'two or more'], [/\bnumber of\b/, 'number of twice'], [/\bequal to\b/, 'equal to twice'], [/\bcan't be blocked\b/, 'can be blocked'], [/\bin addition to\b/, 'instead of'], [/\bpower\b/, 'mana value'], [/\btoughness\b/, 'mana value'], [/\bdouble\b/, 'triple'], [/\bthat creature\b/, 'that artifact'], [/\battached\b/, 'tapped'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-perms-8 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-perms-8 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-perms-8 design 6.10 (local index): synthetic examples', () => {
  it('no edh-perms-8 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-perms-8 parser, engine and renderer changes (one test each)', () => {
  const spell = (text: string, type = 'Instant') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  const permanent = (text: string, type = 'Enchantment') => parseCard(card('Example Relic', type, text), OPTS).faces[0]!;
  it('parser/holes/filter.ts + render/np.ts (CR 202.3): "with mana value 4, 5, or 6" is a list of exact mana values ending with "or"; "4, 5" without "or", a repeated value and a range are not read as a list', () => {
    const ok = permanent('Whenever you cast a creature spell with mana value 4, 5, or 6, you gain 1 life.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"anyOf":[{"manaValue":{"op":"==","value":4}},{"manaValue":{"op":"==","value":5}},{"manaValue":{"op":"==","value":6}}]');
    expect(fullyAutomated(permanent('Whenever you cast a creature spell with mana value 2 or 3, you gain 1 life.'))).toBe(true);
    expect(fullyAutomated(permanent('Whenever you cast a creature spell with mana value 4, 5, you gain 1 life.'))).toBe(false);
    expect(fullyAutomated(permanent('Whenever you cast a creature spell with mana value 4, 4, or 6, you gain 1 life.'))).toBe(false);
    expect(fullyAutomated(permanent('Whenever you cast a creature spell without mana value 4, 5, or 6, you gain 1 life.'))).toBe(false);
  });
  it('parser/holes/edhpm8.ts + render/qty.ts (CR 111.1): "the number of tokens you created this turn" is the controller\'s createToken history of the turn; another player\'s tokens, last turn and a creature-token-only count are other sentences', () => {
    const ok = permanent('At the beginning of your end step, you gain life equal to the number of tokens you created this turn.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"q":"happenedCount","event":{"ev":"createToken","player":"you"},"scope":"turn"');
    expect(fullyAutomated(permanent('At the beginning of your end step, you gain life equal to the number of tokens an opponent created this turn.'))).toBe(false);
    expect(fullyAutomated(permanent('At the beginning of your end step, you gain life equal to the number of creature tokens you created this turn.'))).toBe(false);
    expect(fullyAutomated(permanent('At the beginning of your end step, you gain life equal to the number of tokens you created last turn.'))).toBe(false);
  });
  it('parser/holes/filter.ts + rules/filter.ts + render/np.ts (CR 602.1, 107.5): "an activated ability with {T} in its cost" reads only with "that has" / "with" and {T}; {Q}, "tap an untapped creature" and a bare "an activated ability" stay different', () => {
    const ok = spell('Untap target creature that has an activated ability with {T} in its cost.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"hasAbility":"activated","abilityTapCost":true');
    const plain = spell('Untap target creature that has an activated ability.');
    expect(jsonKey(plain.abilities)).not.toBe(jsonKey(ok.abilities));
    expect(fullyAutomated(spell('Untap target creature that has an activated ability with {Q} in its cost.'))).toBe(false);
    expect(fullyAutomated(spell('Untap target creature that has an activated ability with {T} in its cost or a triggered ability.'))).toBe(false);
  });
  it('parser/lower/moved-self.ts (CR 400.7, 704.5m): "~" is the Aura card in its graveyard inside a delayed trigger that waits for a step, never inside a delayed trigger with an event of its own, and not for a creature\'s own death', () => {
    const aura = (text: string) => parseCard(card('Example Relic', 'Enchantment — Aura', `Enchant creature\n${text}`), OPTS).faces[0]!;
    const ok = aura('When enchanted Elf dies, return that card to the battlefield under its owner\'s control. Return ~ to the battlefield attached to that creature at the beginning of the next end step.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('{"ref":"self","moved":true}');
    // a delayed trigger of an event ("when it dies this turn") has an event of its own: the Aura stays unnamed there (manual)
    expect(fullyAutomated(aura('When enchanted Elf dies, return that card to the battlefield under its owner\'s control. When that creature dies this turn, return ~ to the battlefield attached to that creature.'))).toBe(false);
    // a creature that returns itself at the next end step keeps its old reading
    const self = parseCard(card('Example Elf', 'Creature — Elf', 'When ~ dies, return ~ to the battlefield at the beginning of the next end step.', { power: '1', toughness: '1' }), OPTS).faces[0]!;
    expect(JSON.stringify(self.abilities)).not.toContain('"moved":true');
  });
  it('effects/overload.ts (CR 702.96a): a counters spell with overload rewrites the `on` of its putCounters step; a spell that reads its target as a value is still refused', () => {
    const fangs = card('Example Plan', 'Sorcery', 'Put two +1/+1 counters on target creature you control, then double the number of +1/+1 counters on each creature that had a +1/+1 counter put on it this way.\nOverload {2}{G}', { mana_cost: '{G}' });
    expect(fullyAutomated(parseCard(fangs, OPTS).faces[0]!)).toBe(true);
    const value = overloadProgram({ targets: [{ id: 't0', kind: 'object', min: 1, max: 1, text: 'target creature', filter: { types: ['Creature'] } }], steps: [{ op: 'putCounters', on: { ref: 'target', id: 't0' }, kind: '+1/+1', count: { q: 'stat', stat: 'power', of: { ref: 'target', id: 't0' } } }] } as never);
    expect(value).toBeNull();
    const plain = overloadProgram({ targets: [{ id: 't0', kind: 'object', min: 1, max: 1, text: 'target creature', filter: { types: ['Creature'] } }], steps: [{ op: 'putCounters', on: { ref: 'target', id: 't0' }, kind: '+1/+1', count: 1 }] } as never);
    expect(JSON.stringify(plain)).toContain('"on":{"ref":"each"');
  });
  it('parser/parse.ts#costReadersWithoutCost (CR 118.8, 701.21a): "the sacrificed creature" is read only where a COST sacrifices; a sacrifice by an instruction, or none, leaves the sentence manual', () => {
    const tail = "You draw cards equal to the sacrificed creature's power, then you gain life equal to its toughness.";
    expect(fullyAutomated(spell(`As an additional cost to cast this spell, sacrifice a nontoken creature.\n${tail}`))).toBe(true);
    expect(fullyAutomated(spell(`Sacrifice a creature. ${tail}`))).toBe(false);
    expect(fullyAutomated(spell(tail))).toBe(false);
  });
});
