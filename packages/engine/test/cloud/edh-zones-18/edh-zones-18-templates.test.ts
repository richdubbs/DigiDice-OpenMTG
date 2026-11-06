/**
 * edh-zones-18 (Commander effort, lane edh-zones): the template data of parser/templates/zz-cloud/edh-zones-18.json and the round's other changes: the quantity "for each nonland
 * card revealed this way" (parser/holes/edhz18.ts, Discourse.revealStays), the ability of Selvala is no mana ability (parser/lower/ability.ts#revealTopForMana, CR 605.1a), the joins of the sentences of Explore the Vastlands and Karn's last ability (lower/ability.ts#joinEdhZones18)
 * and the renderer's wordings (render/steps-cards.ts, np.ts, fold-edhzones18.ts). Guard G9 and G2 as the earlier rounds run them; examples are synthetic (design 6.10). The behavior is in
 * edh-zones-18-scenarios.test.ts. CR cites checked against the 2026-09-25 text.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhZones18 from '../../../src/parser/templates/zz-cloud/edh-zones-18.json';
import review from '../../m5/golden/cards/edh-zones-18-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EZ18 = edhZones18 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on: a creature for an activated or triggered ability, a planeswalker line for a loyalty ability, else a sorcery. */
const typeOf = (text: string): string => (/^[+−-]\d/.test(text) ? 'Legendary Planeswalker — Karn' : /^Whenever|^When|^At the beginning|this creature|^\{/mi.test(text) ? 'Creature — Beast' : 'Sorcery');
const face = (text: string, typeLine?: string) => {
  const type = typeLine ?? typeOf(text);
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string, name = 'Example Relic') =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard);
const level = (type: string, text: string, name?: string): string => compiled(type, text, name).automation.level;
const json = (type: string, text: string, name?: string): string => JSON.stringify(compiled(type, text, name).faces);

const IDS = EZ18.map((t) => t.id);

describe('edh-zones-18 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-zones-18.json, after zz-cloud/edh-zones-15.json, before zz-cloud/edh-zones-2.json: path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-zones-18.json');
    expect(files.indexOf('zz-cloud/edh-zones-18.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-zones-15.json')); // path order
    expect(files.indexOf('zz-cloud/edh-zones-18.json')).toBeLessThan(files.indexOf('zz-cloud/edh-zones-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(IDS.length).toBe(7);
    for (const t of EZ18) {
      expect(t.id, t.id).toMatch(/^eff\.edhz18\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) {
      expect(g.expect, g.card).toBe('full');
      expect(g.verified, g.card).toMatch(/CR \d{3}/);
    }
    // narrow wordings (one card of the index prints each as a whole line), stable on one hand-verified golden card plus these tests and the scenarios: a 6.9 deviation named in the round record
    expect(goldenUsing('eff.edhz18.player.revealTop')).toEqual(['Selvala, Explorer Returned']);
    expect(goldenUsing('eff.edhz18.mana.lifeForEachRevealed')).toEqual(['Selvala, Explorer Returned']);
    expect(goldenUsing('eff.edhz18.revealHandOrTop')).toEqual(['Eladamri, Korvecdal']);
    expect(goldenUsing('eff.edhz18.ifRevealedCreatureThisWay.putBattlefield')).toEqual(['Eladamri, Korvecdal']);
    expect(goldenUsing('eff.edhz18.eachPlayer.lookMayRevealLandAndOrSpell.handRestBottom')).toEqual(['Wandering Archaic // Explore the Vastlands']);
    expect(goldenUsing('eff.edhz18.becomes.artifactCreature.ptEqualMv')).toEqual(['Karn, the Great Creator']);
    expect(goldenUsing('eff.edhz18.mayFetchArtifactOutsideOrExile.toHand')).toEqual(['Karn, the Great Creator']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EZ18) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'any number']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
      if (words.includes('up') && words[words.indexOf('up') + 1] === 'to') expect(t.consumes ?? [], `${t.id}: up to`).toContain('up to');
    }
  });
});

describe('edh-zones-18 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EZ18) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
        expect(fullyAutomated(f), e.text).toBe(true);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = face(c, typeOf(t.examples[0]!.text));
        expect(understood(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bgraveyard\b/, 'exile'], [/\bon the bottom\b/, 'on top'], [/\bonto the battlefield\b/, 'into your hand'], [/\binto your hand\b/, 'into your graveyard'], [/\bhand\b/, 'graveyard'],
    [/\brandom\b/, 'chosen'], [/\bexile\b/, 'graveyard'], [/\bnonland\b/, 'land'], [/\bland\b/, 'creature'], [/\bartifact\b/, 'enchantment'], [/\bcreature\b/, 'land'], [/\bmay\b/, 'must'],
    [/\band\/or\b/, 'or'], [/\beach\b/, 'target'], [/\bthe top\b/, 'the bottom'], [/\bgain 1 life\b/, 'lose 1 life'], [/\bmana value\b/, 'power'], [/\bface-up\b/, 'face-down'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-zones-18 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EZ18) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = face(m, typeOf(e.text));
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('edh-zones-18 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EZ18) {
    it(`${t.id}: replacing any one word of the template's sentence by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^\{/.test(w)) return; // a mana symbol is not a word
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any name (CR 122.1)
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(understood(face(mutated, typeOf(e.text))), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-zones-18 design 6.10 (local index): synthetic examples', () => {
  it('no edh-zones-18 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|Equipment|spell|card|Saga)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = EZ18.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

describe('edh-zones-18 "for each <card> revealed this way" (parser/holes/edhz18.ts; CR 701.20a, 608.2c)', () => {
  const reveal = (second: string, first = 'Reveal the top two cards of your library.'): string => `${first} ${second}`;
  it('after a reveal and nothing else with cards, it counts the cards revealed that are of that description, in the library where they stay', () => {
    const j = json('Sorcery', reveal('You gain 1 life for each nonland card revealed this way.'));
    expect(level('Sorcery', reveal('You gain 1 life for each nonland card revealed this way.'))).toBe('full');
    expect(j).toContain('"q":"count"');
    expect(j).toContain('"notTypes":["Land"]');
    expect(j).toContain('"zone":"library"');
  });
  it('near misses: after a look (not a reveal), or after an instruction that moves cards, the count is not read (the cards may no longer be where they were revealed)', () => {
    expect(level('Sorcery', reveal('You gain 1 life for each nonland card revealed this way.', 'Look at the top two cards of your library.'))).not.toBe('full');
    expect(level('Sorcery', reveal('You gain 1 life for each nonland card revealed this way.', 'Reveal the top two cards of your library. Put them into your hand.'))).not.toBe('full');
    expect(level('Sorcery', 'You gain 1 life for each nonland card revealed this way.')).not.toBe('full');
  });
  it('plural and other descriptions are not read: "the number of cards", a card with a controller or an owner', () => {
    expect(level('Sorcery', reveal('You gain life equal to the number of nonland cards revealed this way.'))).not.toBe('full');
    expect(level('Sorcery', reveal('You gain 1 life for each nonland card you own revealed this way.'))).not.toBe('full');
  });
});

describe('edh-zones-18 an ability that adds mana and draws is no mana ability (parser/lower/library-moves.ts; CR 605.1a)', () => {
  const BODY = 'Each player reveals the top card of their library. For each nonland card revealed this way, add {G} and you gain 1 life. Then each player draws a card.';
  it('is a full activated ability without isMana (it uses the stack)', () => {
    expect(level('Creature — Elf', `{T}: ${BODY}`)).toBe('full');
    expect(json('Creature — Elf', `{T}: ${BODY}`)).not.toContain('"isMana"');
  });
  it('near misses: another player reveals, an opponent gains the life, or another instruction follows, is not understood', () => {
    // edh-fix-5: with the draw (CR 605.1a) it is an ordinary ability whoever reveals, so "each opponent reveals" is read too, and is no mana ability
    expect(json('Creature — Elf', `{T}: ${BODY.replace('Each player reveals', 'Each opponent reveals')}`)).not.toContain('"isMana"');
    expect(level('Creature — Elf', `{T}: ${BODY.replace('you gain', 'each opponent gains')}`)).not.toBe('full');
  });
});

describe('edh-zones-18 the joins of the sentences of Explore the Vastlands and of Karn\'s last ability (parser/lower/ability.ts#joinEdhZones18)', () => {
  const ARCH = 'Each player looks at the top five cards of their library and may reveal a land card and/or an instant or sorcery card from among them. Each player puts the cards they revealed this way into their hand and the rest on the bottom of their library in a random order.';
  const KARN = 'You may reveal an artifact card you own from outside the game or choose a face-up artifact card you own in exile. Put that card into your hand.';
  it('the two sentences are read together, also after a cost or a trigger clause', () => {
    expect(level('Sorcery', ARCH)).toBe('full');
    expect(level('Creature — Beast', `When this creature enters, ${ARCH.replace(/^Each/, 'each')}`)).toBe('full');
    expect(level('Sorcery', KARN)).toBe('full');
    expect(level('Legendary Planeswalker — Karn', `-2: ${KARN}`)).toBe('full');
  });
  it('near misses: another second sentence is not joined', () => {
    expect(level('Sorcery', ARCH.replace('into their hand', 'into their graveyard'))).not.toBe('full');
    expect(level('Sorcery', ARCH.replace('in a random order', 'in any order'))).not.toBe('full');
    expect(level('Sorcery', KARN.replace('into your hand', 'onto the battlefield'))).not.toBe('full');
    expect(level('Sorcery', KARN.replace('face-up', 'face-down'))).not.toBe('full');
  });
});

describe('edh-zones-18 the renderer: "their library" after a reveal, and "revealed this way" in a count (render/steps-cards.ts, np.ts)', () => {
  it('"reveals the top card of their library" is the player\'s own library; the card revealed stays named "revealed this way"', () => {
    expect(level('Sorcery', 'Each opponent reveals the top card of their library.')).toBe('full');
    expect(level('Sorcery', 'Each opponent reveals the top card of their library. You gain 1 life for each land card revealed this way.')).toBe('full');
    expect(level('Sorcery', 'Each opponent reveals the top card of your library.')).not.toBe('full');
  });
});
