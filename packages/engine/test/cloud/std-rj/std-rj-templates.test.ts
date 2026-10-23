/**
 * Standard round J (std-rj, slot J of the parallel rounds F-J): the template data of parser/templates/zz-cloud/std-rj.json and the hole, lowering, lint and renderer
 * support the templates needed. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every
 * counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves
 * an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * std-rj-scenarios.test.ts.
 *
 *   parser/holes/cond.ts#batchCast         "if they entered or were cast from a graveyard" (CR 603.4, 603.6a)              render/cond.ts   family some-match-they
 *   parser/holes/r4dig.ts#cardsDesc        "legendary and/or enchantment cards" (CR 205.4a, 205.2a)                        render/np.ts     family legendary-and-or
 *   parser/holes/object.ts#theExiledCards  "from among the exiled cards" (CR 406.1, 608.2c)                                render/steps-zones.ts, fold.ts   family exiled-cards-group
 *   parser/lower/conditions.ts#foldReflexive  a sentence after "When you do" reads what the trigger's own steps made (CR 603.12a, 608.2c)
 *   parser/lower/conditions.ts#castOfStep, model/lint-flow.ts  "If you don't cast that card this way" after a cast under an "if" (CR 608.2c, 601.2)   family didnt-cast-this-way
 *   parser/lower/quantities.ts#elseSameLifeAmount  "that much" in the otherwise branch of a life loss (CR 119.3, 608.2h)    render/steps-flow.ts   family lose-life-trailing-if
 *   render/fold.ts                         "mill that many cards ... any number of ... from among them", "put it onto the battlefield tapped and attacking and the rest ...",
 *                                          "create a token that's a copy of one of them", "cast up to two spells from among ..."
 *   render/steps-flow.ts                   family cast-free-spell-mv: "You may cast that card without paying its mana cost if the spell's mana value is less than N"
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRj from '../../../src/parser/templates/zz-cloud/std-rj.json';
import review from '../../m5/golden/cards/cloud-std-rj-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RJ = stdRj as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a triggered or static ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'effect' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
const spellFace = (text: string) => parseCard(card('Example Volley', 'Sorcery', text), OPTS).faces[0]!;
const creatureFace = (text: string) => parseCard(card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' }), OPTS).faces[0]!;

describe('std-rj template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rj.json, after std-otj.json, before std-sos.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rj.json');
    expect(files.indexOf('zz-cloud/std-rj.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-otj.json'));
    expect(files.indexOf('zz-cloud/std-rj.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdrj.* or sta.stdrj.*', () => {
    expect(RJ.length).toBe(6);
    for (const t of RJ) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.stdrj\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence, hand-verified golden cards of Standard that use it (the review file pins each card as full)', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of RJ.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of RJ) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-rj guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of RJ) {
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
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\buntil end of turn\b/, 'until your next turn'], [/\bor more\b/, 'or fewer'], [/\beach\b/, 'all'], [/\bany number of\b/, 'up to two'], [/\bup to two\b/, 'up to three'],
    [/\bless than\b/, 'greater than'], [/\bnonland\b/, 'land'], [/\battacking\b/, 'blocking'], [/\bbottom\b/, 'top'], [/\bmana cost\b/, 'power'], [/\bgraveyard\b/, 'hand'],
    [/\binto your hand\b/, 'onto the battlefield'], [/\bone of them\b/, 'each of them'], [/\bif you control\b/, 'unless you control'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rj guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of RJ) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able" or a swapped key word never gives the example's JSON`, () => {
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

describe('std-rj guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of RJ) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~,' || /^\{/.test(w)) return;
          const end = w.match(/[.,]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-rj hole, lowering, lint and renderer support', () => {
  it('CR 603.4, 603.6a: "if they entered or were cast from a graveyard" is some object of the batch; from exile, or a bare "entered", is not read', () => {
    const f = creatureFace('Whenever one or more other creatures you control enter, if they entered or were cast from a graveyard, draw a card.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"interveningIf":{"cond":"someMatch"');
    expect(jsonKey(f.abilities)).toBe(jsonKey(creatureFace('Whenever one or more other creatures you control enter, if one or more of them entered from a graveyard or was cast from a graveyard, draw a card.').abilities));
    expect(automated(creatureFace('Whenever one or more other creatures you control enter, if they entered from a graveyard, draw a card.').abilities)).toBe(false);
    expect(automated(creatureFace('Whenever one or more other creatures you control enter, if they entered or were cast from the battlefield, draw a card.').abilities)).toBe(false);
  });
  it('CR 205.4a, 205.2a: "legendary and/or enchantment cards" are the legendary cards and the enchantment cards; another word beside the supertype is not read', () => {
    const f = spellFace('Mill three cards. You may put any number of legendary and/or enchantment cards from among them into your hand.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"anyOf":[{"supertypes":["Legendary"]},{"types":["Enchantment"]}]');
    expect(jsonKey(f.abilities)).toBe(jsonKey(spellFace('Mill three cards. You may put any number of legendary or enchantment cards from among them into your hand.').abilities));
    expect(automated(spellFace('Mill three cards. You may put any number of legendary and/or red enchantment cards from among them into your hand.').abilities)).toBe(false);
    expect(automated(spellFace('Mill three cards. You may put any number of snow and/or enchantment cards from among them into your hand.').abilities)).toBe(false);
  });
  it('CR 701.17a, 608.2d: "mill that many cards" and a numbered mill both feed "any number of ... from among them"; a destination other than the hand is not read', () => {
    expect(fullyAutomated(spellFace('Mill four cards. You may put any number of land cards from among them into your hand.'))).toBe(true);
    expect(fullyAutomated(creatureFace('Whenever this creature deals combat damage to a player, you mill that many cards. You may put any number of land cards from among them into your hand.'))).toBe(true);
    expect(automated(spellFace('Mill four cards. You may put any number of land cards from among them onto the battlefield.').abilities)).toBe(false);
  });
  it('CR 406.1, 608.2c: "the exiled cards" are the cards an earlier exile step made; a group nothing exiled is unbound', () => {
    expect(fullyAutomated(spellFace('Exile the top four cards of your library. You may cast up to two spells from among the exiled cards without paying their mana costs.'))).toBe(true);
    expect(automated(spellFace('Draw two cards. You may cast up to two spells from among the exiled cards without paying their mana costs.').abilities)).toBe(false);
    expect(automated(spellFace('Exile the top four cards of your library. You may cast up to one spells from among the exiled cards without paying their mana costs.').abilities)).toBe(false);
  });
  it('CR 603.12a, 608.2c: a sentence after "When you do" that reads what the trigger\'s own steps made is an instruction of the trigger; one that reads a name from outside is not moved into it', () => {
    const inside = creatureFace('Whenever this creature attacks, you may pay {1}. When you do, target opponent exiles the top three cards of their library. You may cast up to two spells from among the exiled cards without paying their mana costs.');
    expect(fullyAutomated(inside)).toBe(true);
    const abilities = inside.abilities as unknown as { effect: { steps: { op: string; do?: { op: string }[] }[] } }[];
    const refl = abilities[0]!.effect.steps.find((s) => s.op === 'reflexive')!;
    expect(refl.do!.map((s) => s.op)).toEqual(['move', 'chooseObjects', 'cast']);
    // the group was made before the reflexive trigger: its sentence stays after it, outside the trigger's instructions
    const outside = creatureFace('Whenever this creature attacks, exile the top three cards of your library. You may pay {1}. When you do, draw a card. You may cast up to two spells from among the exiled cards without paying their mana costs.');
    const steps = (outside.abilities[0] as unknown as { effect: { steps: { op: string; do?: { op: string }[] }[] } }).effect.steps;
    const r2 = steps.find((s) => s.op === 'reflexive');
    if (r2 !== undefined) expect(r2.do!.map((s) => s.op)).not.toContain('chooseObjects');
  });
  it('CR 608.2c, 601.2: "If you don\'t cast that card this way" names the cast right before it (also inside an "if"); with no cast before it, it is unresolved', () => {
    const f = spellFace("Exile cards from the top of your library until you exile a nonland card. You may cast that card without paying its mana cost if the spell's mana value is less than your life total. If you don't cast that card this way, put it into your hand.");
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"cond":"did","step":"cast","not":true');
    expect(automated(spellFace("Draw a card. If you don't cast that card this way, put it into your hand.").abilities)).toBe(false);
    // the wording is for the cast only: not "do" (positive), not another verb
    expect(automated(spellFace("Exile cards from the top of your library until you exile a nonland card. You may cast that card without paying its mana cost. If you cast that card this way, put it into your hand.").abilities)).toBe(false);
  });
  it("CR 119.3, 608.2h: \"that much\" of the otherwise branch is the life amount of the first branch; with a plain number there it is unresolved", () => {
    const f = creatureFace("Whenever this creature attacks, reveal the top card of your library and put it into your hand. You lose life equal to that card's mana value if you control a Zombie. Otherwise, each opponent loses that much life.");
    expect(fullyAutomated(f)).toBe(true);
    const steps = (f.abilities[0] as unknown as { effect: { steps: { op: string; then?: { amount: unknown }[]; else?: { amount: unknown }[] }[] } }).effect.steps;
    const iff = steps.find((s) => s.op === 'if')!;
    expect(JSON.stringify(iff.else![0]!.amount)).toBe(JSON.stringify(iff.then![0]!.amount));
    expect(automated(creatureFace('Whenever this creature attacks, you lose 2 life if you control a Zombie. Otherwise, each opponent loses that much life.').abilities)).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-rj design 6.10 (local index): synthetic examples', () => {
  it('no std-rj line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = RJ.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
