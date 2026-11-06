/**
 * Must-finish round edh-next-145 (group "other"): the template data of parser/templates/zz-cloud/edh-next-145.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-next-145-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. CR cites checked against the Comprehensive Rules of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhNext145 from '../../../src/parser/templates/zz-cloud/edh-next-145.json';
import review from '../../m5/golden/cards/edh-next-145-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext145 as Template[];
const MECH_COUNT = 8;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the card that prints the wording and is full (each wording is printed on that one card)
  'eff.edhn145.eachGets.perListedKeyword.dur': ['Akroma, Vision of Ixidor'],
  'eff.edhn145.whenever.objIsDealtDamage.thisTurn': ['Arcbond'],
  'eff.edhn145.reflexive.powerBecomes': ['Inferno of the Star Mounts'],
  'rid.edhn145.instead.youChooseKeptForEachPlayer': ['Mythos of Snapdax'],
  'eff.edhn145.youCanCastOnlyOneMore.thisTurn': ['Irencrag Feat'],
  'eff.edhn145.sacrifice.upTo': ['Ravenous Rotbelly'],
  'sta.edhn145.lethalDamage.byPower': ['Zilortha, Strength Incarnate'],
  'eff.edhn145.equippedOrNamed.getsX.dur': ['Hand of Vecna'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  /^[+\u2212-]\d+:/.test(text) || /loyalty counter/.test(text) ? card('Example Sage', 'Legendary Planeswalker — Example', text, { loyalty: '4' }) :
  /enchanted (creature|land|artifact|permanent|enchantment)/.test(text) ? card(
    'Example Boon', 'Enchantment — Aura', text) :
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-145 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-145.json, path order: after edh-next-14, before edh-next-15) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-145.json');
    expect(files.indexOf('zz-cloud/edh-next-145.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-14.json'));
    expect(files.indexOf('zz-cloud/edh-next-145.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-15.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhn145.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|dl)\.edhn145\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
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

describe('edh-next-145 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bfirst strike\b/, 'double strike'], [/\bis dealt damage\b/, 'deals damage'], [/\bpower becomes\b/, 'toughness becomes'], [/\beach player\b/, 'each opponent'],
    [/\bone more spell\b/, 'one more creature spell'], [/\bup to\b/, 'exactly'], [/\bby their power\b/, 'by their toughness'], [/\bnamed Vecna\b/, 'named Lich'], [/\bequipped creature or\b/, 'enchanted creature or'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-145 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-145 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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
    }, 120_000); // like the other rounds' G2 guards: one parse per word of each example
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-next-145 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-145 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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




describe('edh-next-145 parser, renderer and engine changes (one test each)', () => {
  const spell = (text: string, type = 'Sorcery') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  const creature = (text: string, type = 'Creature — Elf') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/lower/anaphora.ts#eventObjectRefs (CR 603.7c, 120.3): in "whenever that creature is dealt damage this turn", "it" is that creature; another pronoun still needs one antecedent', () => {
    expect(fullyAutomated(spell('Choose target creature. Whenever that creature is dealt damage this turn, it deals that much damage to each player.', 'Instant'))).toBe(true);
    expect(fullyAutomated(spell('Choose target creature and target artifact. Whenever that creature is dealt damage this turn, it deals that much damage to each player.', 'Instant')), 'two antecedents').toBe(false);
  });
  it('parser/lower/conditions.ts#becomesCondition (CR 603.12, 613.4c): "When its power becomes N this way" needs one pump of one object right before it', () => {
    expect(fullyAutomated(creature('{G}: Example Beast gets +1/+0 until end of turn. When its power becomes 9 this way, draw a card.'))).toBe(true);
    expect(fullyAutomated(creature('{G}: Creatures you control get +1/+0 until end of turn. When its power becomes 9 this way, draw a card.')), 'a group pump').toBe(false);
    expect(fullyAutomated(creature('{G}: Example Beast gets +0/+1 until end of turn. When its power becomes 9 this way, draw a card.')), 'no power change').toBe(false);
  });
  it('render/self-replacement.ts (CR 614.15): only a change of who chooses (you) is "you choose the permanents for each player instead"', () => {
    const base = 'Each player chooses an artifact, a creature, an enchantment, and a planeswalker from among the nonland permanents they control, then sacrifices the rest.';
    expect(fullyAutomated(spell(`${base} If you control a Demon, you choose the permanents for each player instead.`))).toBe(true);
    expect(fullyAutomated(spell(`Each player sacrifices a creature. If you control a Demon, you choose the permanents for each player instead.`))).toBe(false);
  });
  it('statics/hooks.ts + model/cap-walk.ts (CR 601.2i): RestrictionDef.countFrom is registered only for a plain cast limit', () => {
    expect(ENGINE_CAPABILITIES.has('feature:restrict.max.cast.countFrom')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:restrict.countFrom')).toBe(false);
  });
  it('render/fold.ts#chooseThenSacrificeAny (CR 701.21a): "sacrifice up to N" for N of two or more; "up to one" stays its older reading or manual', () => {
    expect(fullyAutomated(spell('Sacrifice up to two artifacts. Draw a card for each artifact sacrificed this way.'))).toBe(true);
    const one = spell('Sacrifice up to one artifact. Draw a card for each artifact sacrificed this way.');
    expect(JSON.stringify(one.abilities).includes('"max":1') && fullyAutomated(one)).toBe(false);
  });
  it('parser/holes/filter.ts + rules/filter.ts (CR 205.3m): "shares a creature type with each creature tapped this way" only after a cost that taps creatures', () => {
    const t = 'You may put a creature card from your hand that shares a creature type with each creature tapped this way onto the battlefield.';
    expect(fullyAutomated(parseCard(card('Example Arch', 'Artifact', `Tap three untapped creatures you control: ${t}`), OPTS).faces[0]!)).toBe(true);
    expect(fullyAutomated(parseCard(card('Example Arch', 'Artifact', `{2}, {T}: ${t}`), OPTS).faces[0]!), 'no creature tapped for the cost').toBe(false);
    // review of edh-next-145: a cost that taps artifacts, and a target's description (chosen before the cost is paid), are not read
    expect(fullyAutomated(parseCard(card('Example Arch', 'Artifact', `Tap two untapped artifacts you control: ${t}`), OPTS).faces[0]!), 'artifacts tapped').toBe(false);
    expect(fullyAutomated(parseCard(card('Example Arch', 'Artifact', 'Tap two untapped creatures you control: Destroy target creature that shares a creature type with each creature tapped this way.'), OPTS).faces[0]!), 'a target').toBe(false);
  });
  it('statics/hooks.ts#lethalThreshold (CR 120.6, 704.5g): lethal damage by power is registered as a rule', () => {
    expect(ENGINE_CAPABILITIES.has('rulemod:lethalDamageUsesPower')).toBe(true);
    expect(fullyAutomated(creature('Lethal damage dealt to creatures your opponents control is determined by their power rather than their toughness.'))).toBe(true);
  });
  it('parser/holes/cost.ts + render/costs.ts + model/cap-walk.ts (CR 119.4, 602.2b): "Pay 1 life for each card in your hand" in an activated ability and an equip cost; not in a mana ability', () => {
    expect(fullyAutomated(parseCard(card('Example Rod', 'Artifact', 'Pay 1 life for each card in your hand: Draw a card.'), OPTS).faces[0]!)).toBe(true);
    expect(fullyAutomated(parseCard(card('Example Claw', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nEquip--Pay 2 life for each card in your hand.'), OPTS).faces[0]!)).toBe(true);
    expect(compileCard(card('Example Rod', 'Artifact', 'Pay 1 life for each card in your hand: Add {C}.')).automation.level, 'a mana ability (its cost is paid elsewhere: needs cost:count.quantity)').not.toBe('full');
    expect(compileCard(card('Example Rod', 'Artifact', 'Pay 1 life for each card in your hand: Draw a card.')).automation.level).toBe('full');
  });
});
