/**
 * Commander top-rank round part 7, edh-next-91: the round's readings (no new template file: hole readings, renderer alternatives, lowering and lint changes), each with a positive wording
 * that must be fully automated and a near miss that must stay manual or differ (guard G9 spirit, design 6.8). Synthetic wordings (design 6.10). CR cites are from memory (unverified).
 */
import { describe, expect, it } from 'vitest';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { card, fullyAutomated, jsonKey } from '../../m5/templates/support';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const parse = (name: string, type: string, text: string) => parseCard(card(name, type, text), OPTS).faces[0]!;
const ability = (text: string) => parse('Example Relic', 'Artifact Creature — Construct', text);
const spell = (text: string) => parse('Example Rite', 'Sorcery', text);
const full = (f: ReturnType<typeof parse>): boolean => fullyAutomated(f);

describe('CR 120.2, 603.2: "combat damage is dealt to you" is the event "you are dealt combat damage"', () => {
  it('both wordings are automated and are the same ability', () => {
    const a = ability('Whenever combat damage is dealt to you, draw a card.');
    const b = ability('Whenever you are dealt combat damage, draw a card.');
    expect(full(a)).toBe(true);
    expect(full(b)).toBe(true);
    expect(jsonKey(a.abilities)).toBe(jsonKey(b.abilities));
    expect(full(ability('Whenever damage is dealt to you, draw a card.'))).toBe(true);
  });
  it('negative: damage dealt to another player, or noncombat damage said as combat, is not this reading', () => {
    const you = jsonKey(ability('Whenever combat damage is dealt to you, draw a card.').abilities);
    expect(jsonKey(ability('Whenever combat damage is dealt to an opponent, draw a card.').abilities)).not.toBe(you);
    expect(jsonKey(ability('Whenever damage is dealt to you, draw a card.').abilities)).not.toBe(you);
    expect(full(ability('Whenever combat damage is dealt to you by a creature, draw a card.')) && jsonKey(ability('Whenever combat damage is dealt to you by a creature, draw a card.').abilities) === you).toBe(false);
  });
});

describe('CR 201.5c: a legendary name with an apostrophe inside a word is known by its first word', () => {
  it('"When Brannoc enters" names the card itself', () => {
    const f = parse("Brannoc Do'Hast", 'Legendary Creature — Elf Ranger', 'When Brannoc enters, draw a card.');
    expect(full(f)).toBe(true);
  });
  it('negative: a name that is a possessive is no person ("Heroes\' Banner" is not "Heroes")', () => {
    const f = parse("Heroes' Banner", 'Legendary Artifact', 'When Heroes enters, draw a card.');
    expect(full(f)).toBe(false);
  });
  it('negative: a card that is not legendary keeps its full name only', () => {
    const f = parse("Brannoc Do'Hast", 'Creature — Elf Ranger', 'When Brannoc enters, draw a card.');
    expect(full(f)).toBe(false);
  });
});

describe('CR 101.4, 608.2c, 608.2d: "For each opponent who does" after "Each opponent may return a creature card ..."', () => {
  const OFFER = 'Return a creature card from your graveyard to the battlefield. Each opponent may return a creature card from their graveyard to the battlefield. For each opponent who does, return a creature card from your graveyard to the battlefield.';
  it('is automated', () => { expect(full(spell(OFFER))).toBe(true); });
  it('negatives: "who doesn\'t", and a different group of players, stay manual', () => {
    expect(full(spell(OFFER.replace('who does,', "who doesn't,")))).toBe(false);
    expect(full(spell(OFFER.replace('For each opponent who does', 'For each player who does')))).toBe(false);
  });
  it('two sentences whose templates choose into the same name each mean their own choice (a sequence of two returns is automated; an `if` branch binding the same name is not renamed)', () => {
    expect(full(spell('Return a creature card from your graveyard to the battlefield. Return a creature card from your graveyard to the battlefield.'))).toBe(true);
  });
});

describe('CR 601.2i, 603.2: "the first noncreature spell of a turn is cast" counts every player\'s spells', () => {
  it('is automated, and differs from the per-player wording', () => {
    const any = ability('Whenever the first noncreature spell of a turn is cast, counter that spell.');
    const each = ability('Whenever a player casts their first noncreature spell each turn, counter that spell.');
    expect(full(any)).toBe(true);
    expect(full(each)).toBe(true);
    expect(jsonKey(any.abilities)).not.toBe(jsonKey(each.abilities));
    expect(JSON.stringify(any.abilities)).toContain('"anyCaster":true');
    expect(JSON.stringify(each.abilities)).not.toContain('anyCaster');
  });
  it('negatives: with no kind of spell, or in "each turn" wording, this reading does not apply', () => {
    expect(JSON.stringify(ability('Whenever the first spell of a turn is cast, counter that spell.').abilities)).not.toContain('"anyCaster":true');
    expect(JSON.stringify(ability('Whenever the first noncreature spell each turn is cast, counter that spell.').abilities)).not.toContain('"anyCaster":true');
  });
});

describe('CR 608.2c: "you may discard any number of land cards. Put that many +1/+1 counters on ~ and draw that many cards."', () => {
  const TEXT = 'When this creature enters, you may discard any number of land cards. Put that many +1/+1 counters on this creature and draw that many cards.';
  it('is automated, also with one "that many"', () => {
    expect(full(parse('Example Digger', 'Creature — Insect', TEXT))).toBe(true);
    expect(full(parse('Example Digger', 'Creature — Insect', 'When this creature enters, you may discard any number of land cards. Draw that many cards.'))).toBe(true);
    expect(full(spell('Discard any number of land cards. Put that many +1/+1 counters on target creature.'))).toBe(true);
  });
  it('negative: a "that many" with nothing to count before it stays manual', () => {
    expect(full(parse('Example Digger', 'Creature — Insect', 'When this creature enters, put that many +1/+1 counters on this creature and draw that many cards.'))).toBe(false);
  });
});
