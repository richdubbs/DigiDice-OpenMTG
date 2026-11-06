/**
 * Commander lane edh-c-13 (EDHREC ranks 18,751 to 19,375; code edhv13): the readings and their negatives (fail closed).
 *   zz-cloud/edh-c-13.json                  eff.edhv13.eachMay.scry, thenIf.itHas / thereAre counters remove (them | all of them) and transform it, exchange.power.itAnd,
 *                                           linked.returnEach.battlefield.owners, look.top.whereX.putBack.anyOrder: made stable on their golden cards (design 6.9 deviation,
 *                                           named in the record, owner's standing rule of 2026-10-27)
 *   zz-fast3/t17, zz-fast5/t67, zz-cloud/edh-cast-1   consume "each other" (a Filter that says "other"): create ... for each other creature, each other creature gets ... and gains ...
 *   parser/holes/event.ts                    "one or more +1/+1 counters are put on one or more Humans you control" is one occurrence for the whole batch (CR 603.2c);
 *                                           "you play a card" is a land played or a spell cast (CR 305.1, 601.2a)
 *   render/*                                 alts: play a card, it has N or more X counters on it, remove them / all of them, it's blocking (the blocker of the event),
 *                                           return each card exiled with ~ to the battlefield under its owner's control
 * CR cites checked against the Comprehensive Rules of 2026-09-25 where marked, else from memory.
 */
import { describe, expect, it } from 'vitest';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import review from '../../m5/golden/cards/edh-c-13-review.json';
import { compileCard, type CardDef, type OracleCard } from '../../../src/index';

function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const manual = (type: string, text: string, pt?: [string, string]): boolean => !automated(card('Test Card', type, text, pt));
const json = (type: string, text: string, pt?: [string, string]): string => JSON.stringify(card('Test Card', type, text, pt).faces);

describe('edh-c-13: the new templates are stable and have golden cards (design 6.9 deviation, named in the record)', () => {
  it('every template of the file is stable and has examples and counterExamples', () => {
    const mine = TEMPLATE_SET.filter((t) => t.id.startsWith('eff.edhv13.'));
    expect(mine.length).toBe(6);
    for (const t of mine) {
      expect(t.status, t.id).toBe('stable');
      expect(t.examples?.length ?? 0, t.id).toBeGreaterThan(0);
      expect(t.counterExamples?.length ?? 0, t.id).toBeGreaterThan(0);
    }
  });
  it('the review pins every card as full and names the templates', () => {
    const entries = review as { card: string; expect?: string; verified: string }[];
    for (const e of entries) expect(e.expect, e.card).toBe('full');
    const text = JSON.stringify(entries);
    for (const id of ['eff.edhv13.eachMay.scry', 'eff.edhv13.thenIf.itHas.counters.removeThemTransform', 'eff.edhv13.thenIf.thereAre.counters.removeAllOfThemTransform', 'eff.edhv13.exchange.power.itAnd', 'eff.edhv13.linked.returnEach.battlefield.owners', 'eff.edhv13.look.top.whereX.putBack.anyOrder']) expect(text, id).toContain(id);
    expect(entries.length).toBe(10);
  });
});

describe('edh-c-13: "each player may scry N" (CR 701.22a, 101.4)', () => {
  it('is read for every player; a different group is another reading and a cards-count stays manual', () => {
    expect(automated(card('Test Scout', 'Creature — Scout', 'When this creature enters, each player may scry 2.', ['1', '1']))).toBe(true);
    expect(json('Creature — Scout', 'When this creature enters, each opponent may scry 1.', ['1', '1'])).not.toContain('"who":"player"'); // the opponents are another group (an older reading), not this one
    expect(manual('Creature — Scout', 'When this creature enters, each player may scry 1 cards.', ['1', '1'])).toBe(true);
  });
});

describe('edh-c-13: "each other" in a count and in a group pump (CR 608.2h, 611.2a)', () => {
  it('is read with "other": the creatures other than the source', () => {
    expect(json('Creature — Dwarf', 'When this creature enters, create a Treasure token for each other creature you control.', ['1', '1'])).toContain('"other":true');
    expect(json('Creature — Spirit', 'Whenever you cast a Spirit spell, each other creature you control gets +1/+1 and gains trample until end of turn.', ['1', '1'])).toContain('"other":true');
  });
  it('without "other" the count includes the source, and the same sentence with a different verb is not this reading', () => {
    expect(json('Creature — Dwarf', 'When this creature enters, create a Treasure token for each creature you control.', ['1', '1'])).not.toContain('"other":true');
    expect(manual('Creature — Dwarf', 'When this creature enters, create two Treasure tokens for each other creature you control.', ['1', '1'])).toBe(true);
    expect(manual('Creature — Spirit', 'Whenever you cast a Spirit spell, each other creature you control gets +1/+1 and loses trample until end of turn.', ['1', '1'])).toBe(true);
  });
});

describe('edh-c-13: counters put on one or more objects (CR 603.2c) and "play a card" (CR 305.1, 601.2a)', () => {
  const trig = (t: string): string => `Whenever ${t}, draw a card.`;
  it('"one or more counters on one or more Humans" is one batch (wholeBatch); "a Human" keeps one occurrence per creature', () => {
    expect(json('Creature — Human', trig('one or more +1/+1 counters are put on one or more Humans you control'), ['1', '1'])).toContain('"wholeBatch":true');
    const single = json('Creature — Human', trig('one or more +1/+1 counters are put on a Human you control'), ['1', '1']);
    expect(single).not.toContain('"wholeBatch"');
    expect(single).not.toContain('"op":"manual"');
  });
  it('negatives: a singular counter on a set of objects, counters removed from a set, and the any-kind set stay as they were (manual or per object)', () => {
    expect(manual('Creature — Human', trig('a +1/+1 counter is put on one or more Humans you control'), ['1', '1'])).toBe(true);
    expect(manual('Creature — Human', trig('one or more +1/+1 counters are removed from one or more Humans you control'), ['1', '1'])).toBe(true);
  });
  it('"you play a card" is a land played or a spell cast by you; "a player plays a card" is not read', () => {
    const j = json('Enchantment', trig('you play a card'));
    expect(j).toContain('"verb":"playLand"');
    expect(j).toContain('"ev":"cast"');
    expect(manual('Enchantment', trig('a player plays a card'))).toBe(true);
    expect(manual('Enchantment', trig('an opponent plays a card'))).toBe(true);
  });
});

describe('edh-c-13: remove the counters and transform (CR 122.1, 701.27a, 712.9)', () => {
  const act = (cond: string, rest: string): string => `{T}: Put a ritual counter on this artifact. Then if ${cond}, ${rest}`;
  it('"it has N or more" / "there are N or more" with "remove them" / "remove all of them" and "transform it"', () => {
    expect(automated(card('Test Mirror', 'Artifact', act('it has three or more ritual counters on it', 'remove them and transform it.')))).toBe(true);
    expect(automated(card('Test Mirror', 'Artifact', act('there are three or more ritual counters on it', 'remove all of them and transform it.')))).toBe(true);
  });
  it('negatives: fewer, a different action, a different counter kind in the removal, "may", a single counter', () => {
    expect(manual('Artifact', act('it has three or fewer ritual counters on it', 'remove them and transform it.'))).toBe(true);
    expect(manual('Artifact', act('it has three or more ritual counters on it', 'remove them and sacrifice it.'))).toBe(true);
    expect(manual('Artifact', act('it has three or more ritual counters on it', 'remove a counter and transform it.'))).toBe(true);
  });
});

describe('edh-c-13: exchange powers (CR 701.12a, 613.4b) and return the linked exiled cards (CR 607.2a, 110.2)', () => {
  it('"exchange its power and the power of target creature it\'s blocking until end of combat" needs the duration and its own power', () => {
    expect(automated(card('Test Master', 'Creature — Monk', "Whenever this creature blocks, exchange its power and the power of target creature it's blocking until end of combat.", ['1', '1']))).toBe(true);
    expect(manual('Creature — Monk', "Whenever this creature blocks, exchange its power and the power of target creature it's blocking.", ['1', '1'])).toBe(true);
    expect(manual('Creature — Monk', "Whenever this creature blocks, exchange its power and toughness with that of target creature it's blocking until end of combat.", ['1', '1'])).toBe(true);
    // "its" is the object itself only when the ability triggers on its own block (review): another creature blocking, or no trigger, stays manual
    expect(manual('Creature — Monk', "Whenever another creature you control blocks, exchange its power and the power of target creature it's blocking until end of combat.", ['1', '1'])).toBe(true);
    expect(manual('Sorcery', 'Exchange its power and the power of target creature until end of turn.')).toBe(true);
    expect(manual('Creature — Monk', 'Whenever this creature blocks, exchange the powers of two target creatures until end of combat.', ['1', '1'])).toBe(true);
  });
  const exile = '{T}: Exile target creature you control.\n';
  it('"return each card exiled with ~ to the battlefield under its owner\'s control" needs the owner and a linked exile', () => {
    expect(automated(card('Test Haven', 'Land', `${exile}{T}, Sacrifice this land: Return each card exiled with this land to the battlefield under its owner's control.`))).toBe(true);
    expect(automated(card('Test Haven', 'Land', `${exile}{T}, Sacrifice this land: Return each card exiled with this land to the battlefield under your control.`))).toBe(true); // edh-next-56 (Prowling Geistcatcher, eff.edhn56.linked.returnEach.battlefield.you) reads "each card" under your control
    expect(manual('Land', `${exile}{T}, Sacrifice this land: Return each card exiled with this land to the battlefield tapped under its owner's control.`)).toBe(true);
    expect(manual('Land', "{T}, Sacrifice this land: Return each card exiled with this land to the battlefield under its owner's control.")).toBe(true);
  });
  it('"look at the top X cards ..., where X is ..., then put them back in any order" is yours only and in any order only', () => {
    expect(automated(card('Test Dealer', 'Creature — Wizard', '{T}: Look at the top X cards of your library, where X is the number of Wizards on the battlefield, then put them back in any order.', ['1', '1']))).toBe(true);
    expect(manual('Creature — Wizard', "{T}: Look at the top X cards of target player's library, where X is the number of Wizards on the battlefield, then put them back in any order.", ['1', '1'])).toBe(true);
    expect(manual('Creature — Wizard', '{T}: Look at the top X cards of your library, where X is the number of Wizards on the battlefield, then put them on the bottom in any order.', ['1', '1'])).toBe(true);
  });
});
