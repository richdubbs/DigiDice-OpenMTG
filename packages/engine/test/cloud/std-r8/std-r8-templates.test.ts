/**
 * Standard round 8 (the render gate and antecedents of Standard cards, then of EDHREC top cards of the tuning half): the round adds no template. It changes the
 * renderer (four reviewed equivalence families or readings) and the antecedent passes (four rules of design 6.4), one test each here with its negative case.
 * Every wording is synthetic (design 6.10), checked against the local index when it is present. The behavior is in std-r8-scenarios.test.ts.
 *
 *   render/stat.ts#countWhereX            family cost-where-x: "This spell costs {X} less to cast, where X is the number of ..." (CR 601.2f, 107.3)
 *   render/stat.ts#spellsPhrase           family subtype-list-spells: "Elf and Goblin spells you cast cost {1} less to cast" (CR 205.3, 601.2f)
 *   render/stat.ts#singularOf             family on-the-battlefield: "costs {1} less to cast for each artifact on the battlefield" (CR 400.1, 601.2f)
 *   render/mods.ts#abilityList            family keyword-list-quoted: 'has vigilance, lifelink, and "..."' (CR 702.1, 113.1a)
 *   parser/lower/anaphora.ts              "each other creature" after a sentence that named only graveyard cards (CR 109.2, 400.1)
 *   parser/lower/mentions.ts, render/fold.ts  "cards exiled this way" of a chosen group (CR 608.2c, 400.7)
 *   parser/lower/anaphora.ts#resolveIn    the pronoun in the branch of "if that creature is ..." (CR 608.2c)
 *   model/focus.ts#revealsOneCard         the one card revealed on top of a library is the focus; "that card" for it (CR 701.20a, 608.2c)
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { card, fullyAutomated } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2)
const parsed = (c: OracleCard) => parseCard(c, OPTS).faces[0]!;
const json = (c: OracleCard): string => JSON.stringify(parsed(c).abilities);
const full = (c: OracleCard): boolean => fullyAutomated(parsed(c));
const unbound = (c: OracleCard): boolean => parsed(c).diagnostics.some((d) => d.code === 'unbound-reference');

const SORCERY = (text: string): OracleCard => card('Test Rite', 'Sorcery', text);
const CREATURE = (text: string): OracleCard => card('Test Shade', 'Creature — Shade', text, { power: '2', toughness: '2' });
const VEHICLE = (text: string): OracleCard => card('Test Wagon', 'Artifact — Vehicle', text, { power: '3', toughness: '3' });
const EQUIPMENT = (text: string): OracleCard => card('Test Gauntlet', 'Artifact — Equipment', text);

/** Every synthetic wording of this file (design 6.10: none is a real Oracle line). */
const WORDINGS: string[] = [];
const w = (text: string): string => { WORDINGS.push(text); return text; };

describe('family cost-where-x (render/stat.ts#countWhereX; CR 601.2f, 107.3)', () => {
  it('"This spell costs {X} less to cast, where X is the number of artifact cards in your graveyard." is the count cost change, fully understood', () => {
    const c = SORCERY(w('This spell costs {X} less to cast, where X is the number of artifact cards in your graveyard.\nDraw two cards.'));
    expect(full(c)).toBe(true);
    expect(json(c)).toContain('"generic":{"q":"count","of":{"ref":"each","filter":{"types":["Artifact"],"zone":"graveyard","owner":"you","isCard":true}}}');
  });
  it('a near miss that names another zone than the count is not accepted for it ("... in your hand" against a graveyard count)', () => {
    const c = SORCERY(w('This spell costs {X} less to cast, where X is the number of artifact cards in your hand.\nDraw two cards.'));
    expect(json(c)).not.toContain('"zone":"graveyard"');
  });
});

describe('family subtype-list-spells (render/stat.ts#spellsPhrase; CR 205.3, 601.2f)', () => {
  it('"Elf and Goblin spells you cast cost {1} less to cast." is the cost change of the spells with either subtype', () => {
    const c = EQUIPMENT(w('Elf and Goblin spells you cast cost {1} less to cast.'));
    expect(full(c)).toBe(true);
    expect(json(c)).toContain('"subtypes":["Elf","Goblin"]');
  });
  it('the singular "an Elf and Goblin spell" (a spell with both) is not this reading', () => {
    expect(full(CREATURE(w('Whenever you cast an Elf and Goblin spell, draw a card.')))).toBe(false);
  });
});

describe('family on-the-battlefield for a cost change (render/stat.ts#singularOf through render/qty.ts#countParts; CR 400.1, 601.2f)', () => {
  it('"This spell costs {1} less to cast for each artifact on the battlefield." counts every artifact', () => {
    const c = SORCERY(w('This spell costs {1} less to cast for each artifact on the battlefield.\nDraw a card.'));
    expect(full(c)).toBe(true);
    expect(json(c)).toContain('{"q":"count","of":{"ref":"each","filter":{"types":["Artifact"],"zone":"battlefield"}}}');
  });
  it('"for each artifact you control on the battlefield" (a controller said too) is not accepted', () => {
    expect(full(SORCERY(w('This spell costs {1} less to cast for each artifact you control on the battlefield.\nDraw a card.')))).toBe(false);
  });
});

describe('family keyword-list-quoted (render/mods.ts#abilityList; CR 702.1, 113.1a)', () => {
  it('\'has vigilance, lifelink, and "..."\' grants the two keywords and the quoted ability', () => {
    const c = EQUIPMENT(w('Equipped creature gets +1/+0 and has vigilance, lifelink, and "Whenever this creature blocks, you gain 2 life."\nEquip {2}'));
    expect(full(c)).toBe(true);
    expect(json(c)).toContain('"keyword":"vigilance"');
    expect(json(c)).toContain('"keyword":"lifelink"');
  });
  it('one keyword and one quoted ability keep their one wording ("vigilance and ..."): the serial comma there is no reading', () => {
    expect(full(EQUIPMENT(w('Equipped creature has vigilance, and "Whenever this creature blocks, you gain 2 life."\nEquip {2}')))).toBe(false);
  });
});

describe('design 6.4, CR 109.2, 400.1: "each other creature" after a sentence that named only cards in a graveyard (parser/lower/anaphora.ts#namesOnlyOffField)', () => {
  it('the exiled graveyard cards are no permanents, so "other" is other than ~; "cards exiled this way" counts the chosen cards in exile', () => {
    const c = CREATURE(w('When this creature enters, you may exile one or more artifact cards from your graveyard. When you do, each other creature gets -X/-X until end of turn, where X is the number of cards exiled this way.'));
    expect(full(c)).toBe(true);
    expect(json(c)).toContain('"affects":{"ref":"each","filter":{"other":true,"types":["Creature"]}}');
    expect(json(c)).toContain('"filter":{"zone":"exile","is":{"ref":"bound","name":"them"},"isCard":true}');
  });
  it('a card put onto the battlefield before it is a permanent "other" may leave out: still not resolved', () => {
    const c = CREATURE(w('When this creature enters, you may put a creature card from your hand onto the battlefield. Other creatures you control get +1/+1 until end of turn.'));
    expect(full(c)).toBe(false);
  });
});

describe('design 6.4, CR 608.2c: a bare pronoun in the branch of "if that creature is ..." is the object the condition tests (parser/lower/anaphora.ts#resolveIn)', () => {
  it('"Then if that creature is a Goblin, put a +1/+1 counter on it." after a target: the target, not the Vehicle', () => {
    const c = VEHICLE(w('Whenever this Vehicle attacks, tap target creature that crewed it this turn. Then if that creature is a Goblin, put a +1/+1 counter on it.\nCrew 1'));
    expect(full(c)).toBe(true);
    expect(json(c)).toContain('"then":[{"op":"putCounters","on":{"ref":"target","id":"t0"}');
  });
  it('with "~" named in the branch before the pronoun, the pronoun is left to the unique-candidate rule (manual)', () => {
    const c = VEHICLE(w('Whenever this Vehicle attacks, tap target creature that crewed it this turn. Then if that creature is a Goblin, put a +1/+1 counter on this Vehicle and untap it.\nCrew 1'));
    expect(full(c)).toBe(false);
  });
});

describe('design 6.4, CR 701.20a, 608.2c: the one card revealed on top of a library is the focus (model/focus.ts#revealsOneCard)', () => {
  it('"Reveal the top card of your library. If it\'s a land card, put it onto the battlefield tapped. Otherwise, you may put that card into your graveyard."', () => {
    const c = CREATURE(w('Whenever an opponent casts a spell, reveal the top card of your library. If it\'s a land card, put it onto the battlefield tapped. Otherwise, you may put that card into your graveyard.'));
    expect(full(c)).toBe(true);
    expect(unbound(c)).toBe(false);
    expect(json(c)).toContain('"cond":{"cond":"matches","object":{"ref":"bound"');
  });
  it('"reveal the top card of your library and put that card into your hand": the revealed card', () => {
    const c = CREATURE(w('Whenever this creature deals combat damage to a player, reveal the top card of your library and put that card into your hand.'));
    expect(full(c)).toBe(true);
  });
  it('CR 110.1: after the revealed card was moved onto the battlefield it is a permanent, not "that card": manual', () => {
    const c = CREATURE(w('Whenever an opponent casts a spell, reveal the top card of your library, then put it onto the battlefield. Tap that card.'));
    expect(full(c)).toBe(false);
  });
  it('an instruction after the reveal ends the focus: "it" has two candidates (the revealed card, the spell cast) and stays manual', () => {
    const c = CREATURE(w('Whenever an opponent casts a spell, reveal the top card of your library, then you gain 1 life. If it\'s a land card, put it onto the battlefield tapped.'));
    expect(full(c)).toBe(false);
    expect(unbound(c)).toBe(true);
  });
});

describe('design 6.10: the wordings of this file are synthetic', () => {
  it('none is a line of a real card (local index, when present)', () => {
    const idx = localIndex();
    if (idx === null) return;
    const lines = new Set(idx.flatMap((c) => (c.oracle_text ?? '').split('\n').map((l) => l.trim().toLowerCase())));
    for (const t of WORDINGS) for (const line of t.split('\n')) if (!/^(equip|crew) /i.test(line) && !/^draw (a|two) cards?\.$/i.test(line)) expect(lines.has(line.trim().toLowerCase()), line).toBe(false);
  });
});
