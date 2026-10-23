/**
 * std-ry7 (card wave 2, top-down Commander lane ry7): the round's parser, model and keyword-data changes. The round adds no template file: its readings are three
 * steps a mana ability may have beside adding mana (parser/lower/ability.ts#drawYou, #delayedDrawYou, #selfNoUntapNext, mirrored by model/cap-walk.ts#nativeManaEffect
 * and model/lint-nodes.ts#resolverManaStep), the keyword spectacle as data (its condition read at announcement, model/forms.ts#isTurnPlayerLifeLoss and
 * actions/announce-cond.ts; "its spectacle cost was paid", parser/holes/cond.ts) and the keyword bestow as a cast option (actions/cast-opt/bestow.ts,
 * rules/base-parts/bestow.ts). Wordings are synthetic (design 6.10); the behavior is in std-ry7-scenarios.test.ts. CR cites from memory, unverified (rules/cr/
 * is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type OracleCard } from '../../../src/index';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { announceCondForms, isTurnPlayerLifeLoss } from '../../../src/model/forms';
import { announceReadable } from '../../../src/actions/announce-cond';
import { keywordRegistry } from '../../../src/keywords/registry';
import { bestowedChars, BESTOW_ENCHANT } from '../../../src/rules/base-parts/bestow';
import type { Condition } from '../../../src/types/ability';

const compile = (text: string, type = 'Artifact', o: { cost?: string; pt?: [string, string] } = {}): CardDef =>
  compileCard({ name: 'Example Relic', layout: 'normal', mana_cost: o.cost ?? '{3}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}) } as OracleCard);
const level = (text: string, type?: string, o?: { cost?: string; pt?: [string, string] }): string => compile(text, type, o).automation.level;
const manaAbility = (text: string, type?: string) => compile(text, type).faces[0]!.abilities[0]!;

describe('CR 605.1a, 605.3b: steps a mana ability may have beside adding mana (parser/lower/ability.ts, model/cap-walk.ts, model/lint-nodes.ts)', () => {
  it('"Draw a card." by its controller, also after "Sacrifice ~" as a cost: a mana ability, full', () => {
    const a = manaAbility('{1}, {T}, Sacrifice this artifact: Add {B}{G}. Draw a card.');
    expect(a.kind === 'activated' && a.isMana).toBe(true);
    expect(a.kind === 'activated' && a.effect.steps.map((s) => s.op)).toEqual(['addMana', 'draw']);
    expect(level('{1}, {T}, Sacrifice this artifact: Add {B}{G}. Draw a card.')).toBe('full');
    expect(level('{T}: Add {C}. Draw two cards.')).toBe('full');
  });
  it('a delayed draw for its controller, "Draw a card at the beginning of the next turn\'s upkeep.": full', () => {
    expect(level("{2}, {T}, Sacrifice this artifact: Add one mana of any color. Draw a card at the beginning of the next turn's upkeep.")).toBe('full');
  });
  it('"This land doesn\'t untap during your next untap step.": the source itself through its controller\'s next untap step, full', () => {
    const a = manaAbility("{T}: Add {B} or {G}. This land doesn't untap during your next untap step.", 'Land');
    expect(a.kind === 'activated' && a.isMana).toBe(true);
    expect(level("{T}: Add {B} or {G}. This land doesn't untap during your next untap step.", 'Land')).toBe('full');
  });
  it('near misses stay out of the mana path (fail closed): another player draws, a counted draw, a lasting untap restriction, the source sacrificed before it stays tapped', () => {
    expect(level('{T}: Add {C}. Each opponent draws a card.')).not.toBe('full');
    expect(level('{T}: Add {C}. Draw a card for each artifact you control.')).not.toBe('full');
    expect(level("{T}: Add {C}. This land doesn't untap during your untap step.", 'Land')).not.toBe('full');
    expect(level("{T}, Sacrifice this artifact: Add {C}. This artifact doesn't untap during your next untap step.")).not.toBe('full');
  });
});

describe('CR 702.137a-b: the keyword spectacle as data', () => {
  it('is implemented through its data: an alternative cost named spectacle whose condition is an opponent\'s life loss this turn', () => {
    const d = keywordRegistry.get('spectacle')!;
    expect(d.status).toBe('implemented');
    expect(JSON.stringify(d.expand)).toContain('"name":"spectacle"');
    expect(ENGINE_CAPABILITIES.has('keyword:spectacle')).toBe(true);
    expect(level('Spectacle {R}\nExample Relic deals 2 damage to any target.', 'Instant', { cost: '{2}{R}' })).toBe('full');
  });
  it('"an opponent lost life this turn" is readable at announcement in every position, from the players\' turn statistics (model/forms.ts#isTurnPlayerLifeLoss)', () => {
    const lost: Condition = { cond: 'happened', event: { ev: 'life', change: 'loss', player: 'opponent' }, scope: 'turn' };
    expect(isTurnPlayerLifeLoss(lost)).toBe(true);
    for (const where of ['spec', 'mode', 'activate'] as const) expect(announceReadable(lost, where), where).toBe(true);
    expect(announceCondForms(lost, 'mode')).toContain('feature:announce.happened.turn');
    // an amount or a count of times is something else: unread outside an activation restriction (fail closed)
    const three: Condition = { cond: 'happened', event: { ev: 'life', change: 'loss', player: 'opponent', amount: { op: '>=', value: 3 } }, scope: 'turn' } as Condition;
    expect(isTurnPlayerLifeLoss(three)).toBe(false);
    expect(isTurnPlayerLifeLoss({ cond: 'happened', event: { ev: 'life', change: 'gain', player: 'opponent' }, scope: 'turn' })).toBe(false);
  });
  it('"~\'s spectacle cost was paid" and "its spectacle cost was paid" are the cast record of the alternative cost spectacle (parser/holes/cond.ts, render/cond.ts)', () => {
    for (const text of ["Spectacle {B}\nWhen this creature enters, if its spectacle cost was paid, you gain 3 life.", "Spectacle {B}\nWhen this creature enters, if this creature's spectacle cost was paid, you gain 3 life."]) {
      const d = compile(text, 'Creature — Devil', { cost: '{3}{B}', pt: ['3', '3'] });
      expect(d.automation.level, text).toBe('full');
      expect(JSON.stringify(d.faces[0]!.abilities)).toContain('"via":"spectacle"');
    }
    expect(level("Spectacle {B}\nWhen this creature enters, if its dash cost was paid, you gain 3 life.", 'Creature — Devil', { cost: '{3}{B}', pt: ['3', '3'] })).not.toBe('full');
  });
});

describe('CR 702.103a-b: the keyword bestow as a cast option', () => {
  it('is native: the engine acts on it (actions/cast-opt/bestow.ts), and a bestow card is full', () => {
    expect(keywordRegistry.get('bestow')?.status).toBe('native');
    expect(ENGINE_CAPABILITIES.has('keyword:bestow')).toBe(true);
    expect(level('Bestow {3}{W}\nEnchanted creature gets +1/+1 and has flying.', 'Enchantment Creature — Bird Spirit', { cost: '{2}{W}', pt: ['1', '1'] })).toBe('full');
  });
  it('the bestowed characteristics: no type creature and no creature types, the subtype Aura, "Enchant creature" after the printed abilities, no power or toughness', () => {
    const d = compile('Bestow {3}{W}\nEnchanted creature gets +1/+1 and has flying.', 'Enchantment Creature — Bird Spirit', { cost: '{2}{W}', pt: ['1', '1'] });
    const c = bestowedChars(d, 0)!;
    expect(c.types).toEqual(['Enchantment']);
    expect(c.subtypes).toEqual(['Aura']);
    expect(c.power).toBeUndefined();
    expect(c.toughness).toBeUndefined();
    expect(c.manaCost).toEqual(d.faces[0]!.manaCost); // CR 202.3: the card's mana cost and mana value
    expect(c.abilities.map((a) => a.index)).toEqual([0, 1, 2]);
    expect(c.keywords.map((k) => k.keyword)).toEqual(['bestow', 'enchant']);
    expect(BESTOW_ENCHANT.filter).toEqual({ types: ['Creature'] });
  });
  it('a face that is no creature has no bestowed characteristics', () => {
    expect(bestowedChars(compile('Enchanted creature gets +1/+1.', 'Enchantment — Aura'), 0)).toBeNull();
  });
});
