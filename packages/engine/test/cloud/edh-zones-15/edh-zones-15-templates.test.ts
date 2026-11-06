/**
 * edh-zones-15 (Commander effort, lane edh-zones): the template data of parser/templates/zz-cloud/edh-zones-15.json and the round's other changes: the guarded exile
 * "Exile target creature if its power is less than or equal to the revealed card's power" (render/steps.ts, the cost-revealed card's power: `costRevealed`), "exile any number of
 * <permanents> you control [until ~ leaves the battlefield]" and "you own and control" (render/fold.ts#chooseThenMove, render/np.ts, parser/holes/moved-words.ts#movedBy
 * `allowUntil`), "the exiled cards that weren't cast this way" (parser/lower/mentions.ts#exiledNotCastOf, hole Rest, render/refs.ts#exiledNotCast, render/steps-zones.ts
 * #exiledNotCastMove), "put one into your hand and the other / the rest into your graveyard" (render/fold.ts#onePutOtherGraveyard) and the draw replaced by a look at the top
 * cards. Guard G9 and G2 as the earlier rounds run them; examples are synthetic (design 6.10). The behavior is in edh-zones-15-scenarios.test.ts. CR cites checked against the
 * 2026-09-25 text (see the round record).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhZones15 from '../../../src/parser/templates/zz-cloud/edh-zones-15.json';
import review from '../../m5/golden/cards/edh-zones-15-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EZ15 = edhZones15 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on: a creature for a permanent's line (a trigger, "this creature"), else a sorcery. */
const typeOf = (text: string): string => (/^Whenever|^When|^At the beginning|this creature|^\{/m.test(text) ? 'Creature — Beast' : /^If you would|^If an opponent would/.test(text) ? 'Enchantment' : /^Counter target/.test(text) ? 'Instant' : 'Sorcery');
const face = (text: string, typeLine?: string) => {
  const type = typeLine ?? typeOf(text);
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string, name = 'Example Relic') =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard);
const level = (type: string, text: string, name?: string): string => compiled(type, text, name).automation.level;
const json = (type: string, text: string, name?: string): string => JSON.stringify(compiled(type, text, name).faces);
const strip = (a: string): string => a.replace(/"oracleText":"[^"]*"/g, '').replace(/"text":"[^"]*"/g, '').replace(/"src":\[[^\]]*\]/g, '');
const same = (a: string, b: string): boolean => strip(a) === strip(b);

const IDS = [
  'eff.edhz15.exile.if', 'eff.edhz15.exile.anyNumber.youControl.until', 'eff.edhz15.exile.anyNumber.youOwnAndControl', 'eff.edhz15.player.putsRest.theirLibraryBottomRandom',
  'rep.edhz15.draw.insteadEffects', 'eff.edhz15.look.thenPutOneHand.restGraveyard',
];

describe('edh-zones-15 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-zones-15.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-zones-15.json');
    expect(files.indexOf('zz-cloud/edh-zones-15.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-zones-1.json')); // path order
    expect(files.indexOf('zz-cloud/edh-zones-15.json')).toBeLessThan(files.indexOf('zz-cloud/edh-zones-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(EZ15.map((t) => t.id)).toEqual(IDS);
    for (const t of EZ15) {
      expect(t.id, t.id).toMatch(/^(eff|rid|rep)\.edhz15\./);
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
    // narrow wordings (one or two cards of the index print them), stable on one hand-verified golden card plus these tests and the scenarios: a 6.9 deviation named in the round record
    expect(goldenUsing('eff.edhz15.exile.if')).toEqual(["Titan's Presence"]);
    expect(goldenUsing('eff.edhz15.exile.anyNumber.youControl.until')).toEqual(["Abdel Adrian, Gorion's Ward"]);
    expect(goldenUsing('eff.edhz15.exile.anyNumber.youOwnAndControl')).toEqual(['Yorion, Sky Nomad']);
    expect(goldenUsing('eff.edhz15.player.putsRest.theirLibraryBottomRandom')).toEqual(["Gríma, Saruman's Footman"]);
    expect(goldenUsing('rep.edhz15.draw.insteadEffects')).toEqual(['Underrealm Lich']);
    expect(goldenUsing('eff.edhz15.look.thenPutOneHand.restGraveyard')).toEqual(['Underrealm Lich']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EZ15) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'all']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-zones-15 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EZ15) {
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
    [/\bgraveyard\b/, 'library'], [/\bonto the battlefield\b/, 'into their hand'], [/\bto their owner's hand\b/, 'to your hand'], [/\bunless they\b/, 'if they'], [/\bat random\b/, 'at the top'],
    [/\bfrom their graveyard\b/, 'from their hand'], [/\bto your hand\b/, 'to your graveyard'], [/\ball\b/, 'a'], [/\bon top\b/, 'on the bottom'], [/\band\/or\b/, 'or'], [/\bany number\b/, 'one'], [/\bat random\b/, 'at the top'], [/\bgraveyard\b/, 'hand'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-zones-15 "Exile ... if <condition>" (eff.edhz15.exile.if, render/steps.ts; CR 701.13a, 608.2c) and the cost-revealed card\'s power (ObjRef costRevealed; CR 601.2b, 701.20a)', () => {
  const REVEAL = 'As an additional cost to cast this spell, reveal a creature card from your hand.';
  it('the condition is a guard of the exile: "less than or equal to" the revealed card\'s power reads the cost-revealed card', () => {
    const j = json('Instant', `${REVEAL}\nExile target creature if its power is less than or equal to the revealed card's power.`);
    expect(j).toContain('"guard"');
    expect(j).toContain('"costRevealed"');
    expect(j).toContain('"op":"<="');
    expect(level('Instant', `${REVEAL}\nExile target creature if its power is less than or equal to the revealed card's power.`)).toBe('full');
  });
  it('near misses: "unless", no revealed card in the cost, a different comparison and "instead" are other readings (not this JSON, or not full)', () => {
    expect(level('Instant', `${REVEAL}\nExile target creature unless its power is less than or equal to the revealed card's power.`)).not.toBe('full');
    expect(level('Instant', "Exile target creature if its power is less than or equal to the revealed card's power.")).not.toBe('full'); // no cost revealed a card
    expect(same(json('Instant', `${REVEAL}\nExile target creature if its power is less than or equal to the revealed card's power.`), json('Instant', `${REVEAL}\nExile target creature if its power is greater than the revealed card's power.`))).toBe(false);
    expect(level('Instant', `${REVEAL}\nExile target creature if its power is less than or equal to the revealed card's power instead.`)).not.toBe('full');
  });
  it('the guarded exile does not change the guarded destroy or counter (same JSON as before: a guard on the destroy)', () => {
    expect(level('Instant', 'Destroy target creature if its power is 3 or less.')).toBe('full');
    expect(json('Instant', 'Destroy target creature if its power is 3 or less.')).toContain('"op":"destroy"');
  });
});

describe('edh-zones-15 "exile any number of <permanents> you control" with a duration or a return (render/fold.ts#chooseThenMove, render/np.ts, parser/holes/moved-words.ts#movedBy; CR 608.2d, 610.3, 406.1, 108.3)', () => {
  const T = (what: string, tail: string): string => `When this creature enters, exile any number of ${what}${tail}`;
  it('"you own and control" is a description of its own: the owner and the controller are both you', () => {
    const j = json('Creature — Bird', T('other nonland permanents you own and control', '. Return those cards to the battlefield at the beginning of the next end step.'));
    expect(j).toContain('"owner":"you"');
    expect(j).toContain('"controller":"you"');
    expect(level('Creature — Bird', T('other nonland permanents you own and control', '. Return those cards to the battlefield at the beginning of the next end step.'))).toBe('full');
  });
  it('near misses: only "you control", only "you own", a target and "up to" are not this reading', () => {
    for (const w of ['other nonland permanents you own', 'target nonland permanents you own and control', 'up to two other nonland permanents you own and control'])
      expect(level('Creature — Bird', T(w, '. Return those cards to the battlefield at the beginning of the next end step.')), w).not.toBe('full');
    expect(same(json('Creature — Bird', T('other nonland permanents you own and control', '.')), json('Creature — Bird', T('other nonland permanents you control', '.')))).toBe(false);
  });
  it('the exile with a duration counts what it exiled ("for each permanent exiled this way") and the group is "those cards" afterwards', () => {
    expect(level('Creature — Human', T('other nonland permanents you control', ' until this creature leaves the battlefield. Create a 1/1 white Soldier creature token for each permanent exiled this way.'))).toBe('full');
    expect(level('Creature — Human', T('other nonland permanents you control', ' until end of turn. Create a 1/1 white Soldier creature token for each permanent exiled this way.'))).not.toBe('full');
  });
});

describe('edh-zones-15 "the exiled cards that weren\'t cast this way" (parser/lower/mentions.ts#exiledNotCastOf, hole Rest, render/refs.ts#exiledNotCast, render/steps-zones.ts#exiledNotCastMove; CR 406.1, 601.2a)', () => {
  const EXILE = 'Target opponent exiles cards from the top of their library until they exile an instant or sorcery card. You may cast that card without paying its mana cost.';
  const PUT = "Then put the exiled cards that weren't cast this way on the bottom of that library in a random order.";
  it('is full after an exile-until of another player, and the move is of every exiled card still in exile to the bottom of its owner\'s library', () => {
    expect(level('Artifact', `{4}, {T}: ${EXILE} ${PUT}`)).toBe('full');
    const j = json('Artifact', `{4}, {T}: ${EXILE} ${PUT}`);
    expect(j).toContain('"zone":"exile"');
    expect(j).toContain('"position":"bottom"');
    expect(j).toContain('"order":"random"');
  });
  it('near misses: no exile-until before it, "the rest" (another set: the stopped-at card left out), another place and another order are not this reading', () => {
    expect(level('Artifact', `{4}, {T}: ${PUT}`)).not.toBe('full');
    expect(same(json('Artifact', `{4}, {T}: ${EXILE} ${PUT}`), json('Artifact', `{4}, {T}: Target opponent exiles cards from the top of their library until they exile an instant or sorcery card. Then put the rest on the bottom of that library in a random order.`))).toBe(false);
    expect(level('Artifact', `{4}, {T}: ${EXILE} ${PUT.replace('bottom', 'top')}`)).not.toBe('full');
    expect(level('Artifact', `{4}, {T}: ${EXILE} ${PUT.replace('in a random order', 'in any order')}`)).not.toBe('full');
    expect(level('Artifact', `{4}, {T}: ${EXILE} ${PUT.replace("weren't", 'were')}`)).not.toBe('full');
  });
  it('your own exile-until is the same move (the cards are in your library, so the bottom of your library): full too', () => {
    expect(level('Artifact', "{4}, {T}: Exile cards from the top of your library until you exile an instant or sorcery card. You may cast that card without paying its mana cost. Then put the exiled cards that weren't cast this way on the bottom of your library in a random order.")).toBe('full');
  });
});

describe('edh-zones-15 "put one into your hand and the rest into your graveyard" after a look, and the draw replaced (render/fold.ts#onePutOtherGraveyard; CR 701.20e, 614.1a, 614.6)', () => {
  it('a look at two or more cards, then one into your hand and the rest into your graveyard: one JSON with a look at that many cards', () => {
    const j = json('Sorcery', 'Look at the top two cards of your library, then put one into your hand and the rest into your graveyard.');
    expect(j).toContain('"count":2');
    expect(j).toContain('"zone":"graveyard"');
    expect(level('Sorcery', 'Look at the top five cards of your library, then put one into your hand and the rest into your graveyard.')).toBe('full');
    expect(level('Sorcery', 'Look at the top five cards of your library, then put two into your hand and the rest into your graveyard.')).not.toBe('full');
  });
  it('the replacement of your draws takes steps in their place; an opponent\'s draw and a draw with a condition are other readings', () => {
    const t = 'If you would draw a card, instead look at the top three cards of your library, then put one into your hand and the rest into your graveyard.';
    expect(level('Enchantment', t)).toBe('full');
    expect(level('Enchantment', t.replace('you would', 'an opponent would'))).not.toBe('full');
    expect(same(json('Enchantment', t), json('Enchantment', t.replace('draw a card,', 'draw a card while you control a Forest,')))).toBe(false);
    expect(level('Enchantment', t.replace('three', 'four'))).toBe('full');
    expect(level('Enchantment', 'If you would draw a card, instead you may exile the top card of your library.')).not.toBe('full'); // declining would lose the draw
    expect(level('Enchantment', t.replace('and the rest into your graveyard', 'and the rest on the bottom of your library'))).not.toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-zones-15 design 6.10 (local index): synthetic examples', () => {
  it('no edh-zones-15 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EZ15.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
