/**
 * Commander EDHREC ranks 17,501-18,125, round edh-c-5: the template data of parser/templates/zz-cloud/edh-c-5.json (life total to the starting life total, "You discard your hand", all colors, -X/-0 for the cards in your hand, a cost increase on opponents' turns, an attack restriction while monarch, a corrupted pump, a minimum of blockers for a group, "unless its controller has ~ deal N damage to them", a sacrifice per card, an Aura that damages its owner) and the round's parser, engine and renderer changes, tested at the end of this file and in edh-c-5-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-c-5-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC5 from '../../../src/parser/templates/zz-cloud/edh-c-5.json';
import review5 from '../../m5/golden/cards/edh-c-5-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC5 as Template[];
/** The round's golden entries. */
const review = review5 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 12;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhv5.setLife.startingLife': ["Oketra's Last Mercy"],
  'eff.edhv5.discard.hand.you.subject': ['Apocalypse'],
  'sta.edhv5.self.allColors': ['Transguild Courier'],
  'sta.edhv5.all.minusX.zero.whereX': ['Meishin, the Mind Cage'],
  'cm.edhv5.self.more.notYourTurn': ["Hurkyl's Final Meditation"],
  'sta.edhv5.aslongas.cantAttackYou': ['Queen Mother Ramonda'],
  'sta.edhv5.aslong.additionalPumpGrant': ["Zealot's Conviction"],
  'sta.edhv5.each.cantBeBlockedExceptByMin': ['Sonorous Howlbonder'],
  'eff.edhv5.destroy.unlessControllerHasSelfDeal': ['Dwarven Driller'],
  'eff.edhv5.counter.unlessControllerHasSelfDeal': ['Molten Influence'],
  'eff.edhv5.sacrifice.theirChoice.forEach': ['Thoughts of Ruin'],
  'eff.edhv5.enchanted.damageToOwner': ['Enslave'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static line on an Aura, an Equipment or a creature, a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (t: Template, text: string) =>
  parseCard(
    /^\{/.test(text) ? card('Example Plan', 'Artifact', text)
    : /^(When|At the|Whenever)/.test(text) && /enchanted creature/.test(text) ? card('Example Plan', 'Enchantment — Aura', `Enchant creature\n${text}`)
    : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
    : t.id.startsWith('sta.') && /enchanted creature/.test(text) ? card('Example Plan', 'Enchantment — Aura', `Enchant creature\n${text}`)
    : t.id.startsWith('sta.') ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
    : card('Example Plan', 'Sorcery', text),
    OPTS,
  ).faces[0]!;

describe('edh-c-5 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-5.json, path order: before edh-cast-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-5.json');
    expect(files.indexOf('zz-cloud/edh-c-5.json')).toBeLessThan(files.indexOf('zz-cloud/edh-cast-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhv5.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm)\.edhv5\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the cards that print the wording', () => {
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

describe('edh-c-5 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/half/, 'a third of'], [/rounded up/, 'rounded down'], [/round up/, 'round down'], [/your/, 'their'], [/first/, 'second'], [/an opponent/, 'you'], [/less/, 'more'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-c-5 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-5 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-c-5 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-5 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

const sorcery = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
const creature = (text: string) => parseCard(card('Example Plan', 'Creature — Drake', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;
const artifact = (text: string) => parseCard(card('Example Plan', 'Artifact', text), OPTS).faces[0]!;

const equipment = (text: string) => parseCard(card('Example Plan', 'Artifact — Equipment', text), OPTS).faces[0]!;

describe('edh-c-5 parser, engine and renderer changes (one test each)', () => {
  it('parser/holes/cond.ts#matches (CR 205.3m): "equipped creature is a Human or an Angel" is a creature with either type; an unarticled second type, a negated predicate and a non-type description are not this reading', () => {
    const ok = equipment('Equipped creature gets +1/+1.\nAs long as equipped creature is a Human or an Angel, it has vigilance.\nEquip {2}');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"subtypes":["Human","Angel"]');
    for (const bad of ['As long as equipped creature is a Human or an Angel or a Goblin, it has vigilance.', 'As long as equipped creature is a Human or an artifact, it has vigilance.', "As long as equipped creature isn't a Human or an Angel, it has vigilance."]) {
      const f = equipment(`Equipped creature gets +1/+1.\n${bad}\nEquip {2}`);
      expect(fullyAutomated(f) && JSON.stringify(f.abilities).includes('"subtypes":["Human","Angel"]'), bad).toBe(false);
    }
  });
  it('parser/holes/qty.ts and render/qty.ts (CR 208.1, 107.3): "the greatest power and/or toughness among <set>" is the greater of the greatest power and the greatest toughness of the set; "least" and a plain "power" are other readings', () => {
    const ok = creature('Whenever this creature attacks, it gets +X/+X until end of turn, where X is the greatest power and/or toughness among other creatures you control.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"op":"max"');
    expect(fullyAutomated(creature('Whenever this creature attacks, it gets +X/+X until end of turn, where X is the least power and/or toughness among other creatures you control.'))).toBe(false);
    const plain = creature('Whenever this creature attacks, it gets +X/+X until end of turn, where X is the greatest power among other creatures you control.');
    expect(JSON.stringify(plain.abilities)).not.toContain('"op":"max"');
  });
  it('render/steps-flow.ts#unlessHasDamage: "destroy/counter ... unless its controller has ~ deal N damage to them" renders as printed; an unusual amount (a quantity), a different recipient and a different verb stay manual', () => {
    expect(fullyAutomated(sorcery('Counter target spell unless its controller has ~ deal 3 damage to them.'))).toBe(true);
    expect(fullyAutomated(sorcery('Counter target spell unless its controller has ~ deal damage to them equal to the number of cards in your hand.'))).toBe(false);
    expect(fullyAutomated(sorcery('Exile target spell unless its controller has ~ deal 3 damage to them.'))).toBe(false);
    expect(fullyAutomated(sorcery('Counter target spell unless its controller has ~ deal 3 damage to you.'))).toBe(false);
  });
  it('render/steps-life.ts#setLife and render/steps-zones.ts#sacrificeChoice: the starting life total says "becomes equal to"; a sacrifice per described object says "for each"', () => {
    expect(fullyAutomated(sorcery('Your life total becomes equal to your starting life total.'))).toBe(true);
    expect(fullyAutomated(sorcery('Your life total becomes your starting life total.'))).toBe(false);
    expect(fullyAutomated(sorcery('Each opponent sacrifices a creature of their choice for each card in your hand.'))).toBe(true);
    expect(fullyAutomated(sorcery('Each opponent sacrifices a creature of your choice for each card in your hand.'))).toBe(false);
  });
});
