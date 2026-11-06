/**
 * Commander lane edh-c (EDHREC ranks 22,001 to 22,500, fourth pass; round edh-c-109, code edhv109): the readings and their negatives (fail closed).
 *   zz-cloud/edh-c-109.json   eff.edhv109.linked.returnEach.filter.battlefield.you, eff.edhv109.linked.returnAll.battlefield.owners, eff.edhv109.counters.removeUpTo.any.objectOrPlayer,
 *                             eff.edhv109.pump.triple.duration, eff.edhv109.mayHave.basePT.xx.whereX: made stable on their golden cards (design 6.9 deviation, named in the record,
 *                             owner's standing rule of 2026-10-27)
 *   parser/holes/object.ts    "target artifact, creature, planeswalker, or opponent" (the serial comma before "or" in the mixed target)
 *   parser/lower/anaphora.ts  "Those creatures" after several single "target creature" phrases = all of those targets (no plural mention to take)
 *   render/*                  steps-zones.ts (return each / all cards exiled with ~ / it), refs.ts (object list and player), steps-lasting.ts (three pumps, one duration), mods.ts (become X/X, where X is)
 * CR cites checked against the Comprehensive Rules of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import review from '../../m5/golden/cards/edh-c-109-review.json';
import { compileCard, type CardDef, type OracleCard } from '../../../src/index';

function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const manual = (type: string, text: string, pt?: [string, string]): boolean => !automated(card('Test Card', type, text, pt));
const json = (type: string, text: string, pt?: [string, string]): string => JSON.stringify(card('Test Card', type, text, pt).faces);
const ids = ['eff.edhv109.linked.returnEach.filter.battlefield.you', 'eff.edhv109.linked.returnAll.battlefield.owners', 'eff.edhv109.counters.removeUpTo.any.objectOrPlayer', 'eff.edhv109.pump.triple.duration', 'eff.edhv109.mayHave.basePT.xx.whereX'];

describe('edh-c-109: the new templates are stable and have golden cards (design 6.9 deviation, named in the record)', () => {
  it('every template of the file is stable and has examples and counterExamples', () => {
    const mine = TEMPLATE_SET.filter((t) => t.id.startsWith('eff.edhv109.'));
    expect(mine.map((t) => t.id).sort()).toEqual([...ids].sort());
    for (const t of mine) {
      expect(t.status, t.id).toBe('stable');
      expect(t.examples?.length ?? 0, t.id).toBeGreaterThan(1);
      expect(t.counterExamples?.length ?? 0, t.id).toBeGreaterThan(1);
    }
  });
  it('the review pins every card as full and names the templates', () => {
    const entries = review as { card: string; expect?: string; verified: string }[];
    for (const e of entries) expect(e.expect, e.card).toBe('full');
    const text = JSON.stringify(entries);
    for (const id of ids) expect(text, id).toContain(id);
    expect(entries.length).toBe(5);
  });
});

describe('edh-c-109: return the cards exiled with ~ to the battlefield (CR 607.2a, 110.2, 108.3)', () => {
  const exile = '{0}: Exile target creature you control.\n';
  it('"each <kind> card ... under your control" needs the kind and your control', () => {
    expect(automated(card('Test Vault', 'Artifact', `${exile}Sacrifice this artifact: Return each creature card exiled with this artifact to the battlefield under your control.`))).toBe(true);
    expect(automated(card('Test Vault', 'Artifact', `${exile}Sacrifice this artifact: Return each creature card exiled with this artifact to the battlefield under its owner's control.`))).toBe(true); // edh-next-56 (Endless Sands, eff.edhn56.linked.returnEach.filter.battlefield.owners) reads a kind with its owner's control
    expect(manual('Artifact', `${exile}Sacrifice this artifact: Return each creature card exiled with this artifact to your hand.`)).toBe(true);
    expect(manual('Artifact', 'Sacrifice this artifact: Return each creature card exiled with this artifact to the battlefield under your control.')).toBe(true); // nothing exiles
  });
  it('"all cards ... under their owners\' control" with one or two exiling abilities', () => {
    const body = `${exile}{0}: Exile target creature you don't control.\nWhen this artifact is put into a graveyard from the battlefield, return all cards exiled with it to the battlefield under their owners' control.`;
    expect(automated(card('Test Reliquary', 'Artifact', body))).toBe(true);
    expect(automated(card('Test Reliquary', 'Artifact', body.replace("their owners' control", 'your control')))).toBe(true); // edh-next-35: "return all cards exiled with it to the battlefield under your control" is its reading now (Promise of Tomorrow); it was no reading of this round
    expect(manual('Artifact', body.replace('battlefield under', 'battlefield tapped under'))).toBe(true);
  });
});

describe('edh-c-109: "Remove up to N counters from target artifact, creature, planeswalker, or opponent" (CR 122.1, 608.2d, 115.1)', () => {
  it('reads the list with the serial comma and a player as one target', () => {
    const j = json('Sorcery', 'Remove up to five counters from target artifact, creature, planeswalker, or opponent.');
    expect(j).toContain('"kind":"objectOrPlayer"');
    expect(j).toContain('"upTo":true');
    expect(automated(card('Test Toll', 'Sorcery', 'Remove up to two counters from target creature or player.'))).toBe(true);
  });
  it('negatives: not "up to", a kind of counter, or each', () => {
    expect(manual('Sorcery', 'Remove five counters from target artifact, creature, planeswalker, or opponent.')).toBe(true);
    expect(manual('Sorcery', 'Remove up to five counters from target artifact, creature you control, or opponent.')).toBe(true); // a qualifier of one kind is not said for the list (review)
    expect(manual('Sorcery', 'Remove up to five counters from each artifact, creature, planeswalker, or opponent.')).toBe(true);
    expect(manual('Sorcery', 'Remove up to five +1/+1 counters from target artifact, creature, planeswalker, or opponent.')).toBe(true); // a kind of counter is another reading, and not for a player
  });
});

describe('edh-c-109: three pumps in one effect and "those creatures" (CR 611.2a, 613.4c, 608.2c)', () => {
  const three = 'Until end of turn, target creature gets +3/+3, up to one other target creature gets +2/+2, and up to one other target creature gets +1/+1.';
  it('three targets, three changes, one duration; "those creatures" is all of them', () => {
    expect(automated(card('Test Rally', 'Instant', three))).toBe(true);
    expect(json('Instant', `${three} Those creatures gain vigilance until end of turn.`)).toContain('"ref":"union"');
  });
  it('negatives: a different joiner, a different change in the list, a trailing duration, and "those creatures" after a single target', () => {
    expect(manual('Instant', three.replace(', and up to', ', or up to'))).toBe(true);
    expect(manual('Instant', three.replace('gets +1/+1', 'gains flying'))).toBe(true);
    expect(manual('Instant', 'Target creature gets +3/+3, up to one other target creature gets +2/+2, and up to one other target creature gets +1/+1 until end of turn.')).toBe(true);
    expect(manual('Instant', 'Target creature gets +3/+3 until end of turn. Those creatures gain vigilance until end of turn.')).toBe(true);
  });
});

describe('edh-c-109: "you may have the base power and toughness of <object> become X/X <duration>, where X is <quantity>" (CR 613.4b, 107.3, 608.2d)', () => {
  const t = (rest: string): string => `Whenever this creature attacks, you may have the base power and toughness of another target creature you control become X/X${rest}`;
  it('is read with the duration and the where clause', () => {
    expect(automated(card('Test Krasis', 'Creature — Beast', t(" until end of turn, where X is this creature's power."), ['3', '3']))).toBe(true);
    expect(json('Creature — Beast', t(' until end of turn, where X is the number of lands you control.'), ['3', '3'])).toContain('"layer":"7b"');
  });
  it('negatives: not optional, no duration, or the power and toughness of the object themselves', () => {
    expect(manual('Creature — Beast', t(" until end of turn, where X is this creature's power.").replace('you may have the', 'the').replace('become', 'becomes'), ['3', '3'])).toBe(true);
    expect(manual('Creature — Beast', t(", where X is this creature's power."), ['3', '3'])).toBe(true);
    expect(manual('Creature — Beast', t(" until end of turn, where X is this creature's power.").replace('base power', 'power'), ['3', '3'])).toBe(true);
  });
});
