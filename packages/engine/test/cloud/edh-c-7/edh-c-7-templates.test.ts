/**
 * Commander lane edh-c-7 (EDHREC ranks 18,751 to 19,375; code edhv7): promotions and readings.
 *   dur.lead.have, dl.yourNextUpkeep.tail   promoted to stable (design 6.9): dur.lead.have on three golden cards (Makeshift Mannequin, Mathas, Fiend Seeker,
 *                                           Obsidian Fireheart); dl.yourNextUpkeep.tail on two (Force of Rage, Rally the Ancestors; narrow wording, 6.9 deviation
 *                                           under the owner's standing rule of 2026-10-27)
 *   parser/holes/cond.ts, render/cond.ts   "an opponent was dealt damage this turn" (CR 120.1, 603.4, 602.5b; Skarrgan Firebird)
 *   render/np.ts, render/mods.ts            alts: "creatures of the chosen color without flying", "for each other creature on the battlefield with flying"
 *   parser/lower/mentions.ts                a whileObject duration names the permanent an earlier move made (CR 400.7, 611.2a; Makeshift Mannequin)
 * CR cites checked against the Comprehensive Rules of 2026-09-25 where marked, else from memory.
 */
import { describe, expect, it } from 'vitest';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import review from '../../m5/golden/cards/edh-c-7-review.json';
import { compileCard, type CardDef, type OracleCard } from '../../../src/index';

function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

describe('edh-c-7: the promoted templates are stable and have their golden cards (design 6.9)', () => {
  it('dur.lead.have and dl.yourNextUpkeep.tail are stable', () => {
    for (const id of ['dur.lead.have', 'dl.yourNextUpkeep.tail']) expect(TEMPLATE_SET.find((t) => t.id === id)?.status, id).toBe('stable');
  });
  it('the review pins every card as full and names the templates', () => {
    const entries = review as { card: string; expect?: string; verified: string }[];
    for (const e of entries) expect(e.expect, e.card).toBe('full');
    const text = JSON.stringify(entries);
    expect(text).toContain('dur.lead.have');
    expect(text).toContain('dl.yourNextUpkeep.tail');
    for (const n of ['Makeshift Mannequin', 'Mathas, Fiend Seeker', 'Obsidian Fireheart', 'Force of Rage', 'Rally the Ancestors']) expect(entries.some((e) => e.card === n), n).toBe(true);
  });
});

describe('edh-c-7: new readings, with their negatives (fail closed)', () => {
  it('"an opponent was dealt damage this turn" is an activation restriction and an intervening if; a described source stays asked', () => {
    expect(automated(card('Test Imp', 'Creature — Imp', '{R}: Draw a card. Activate only if an opponent was dealt damage this turn.', ['1', '1']))).toBe(true);
    expect(automated(card('Test Imp', 'Creature — Imp', 'At the beginning of your end step, if an opponent has been dealt damage this turn, draw a card.', ['1', '1']))).toBe(true);
    // a described source is not this reading: the restriction stays one the controller attests (onlyIf ask)
    expect(JSON.stringify(card('Test Imp', 'Creature — Imp', '{R}: Draw a card. Activate only if an opponent was dealt damage by a Goblin this turn.', ['1', '1']).faces)).toContain('"cond":"ask"');
  });
  it('"creatures of the chosen color without flying" is read with the chosen color and the lacked keyword', () => {
    expect(automated(card('Test Moat', 'Enchantment', "As this enchantment enters, choose a color.\nCreatures of the chosen color without flying can't attack you."))).toBe(true);
  });
  it('a chosen color alone is not enough: "creatures of the chosen color with flying" stays a different set', () => {
    expect(JSON.stringify(card('Test Moat', 'Enchantment', "As this enchantment enters, choose a color.\nCreatures of the chosen color with flying can't attack you.").faces)).not.toContain('"notKeyword"');
  });
});
