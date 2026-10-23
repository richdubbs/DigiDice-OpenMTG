/**
 * FAST5 T59: the noun-phrase, vocabulary, anaphora and renderer support the removal and counterspell sentences need (parser/holes/filter.ts "A or B" descriptions,
 * "with no counters on it", "target spell or creature", "each of those creatures you don't control", "other than that creature"; parser/holes/vocab.ts the plural
 * "Spacecraft"; parser/lower/anaphora.ts a spell or ability is no creature): what each reads, and, as important, the readings it refuses (design 6.3: no reading is
 * chosen between two meanings; nothing is dropped). Synthetic wordings (design 6.10), parsed with the default template set.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { card, fullyAutomated } from '../../m5/templates/support';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const parse = (c: OracleCard) => parseCard(c, OPTS).faces[0]!;
const spell = (text: string) => parse(card('Example Volley', 'Sorcery', text));
const json = (text: string): string => JSON.stringify(spell(text).abilities);
const creature = (text: string) => parse(card('Example Brute', 'Creature — Elf Warrior', text));

describe('"A or B" descriptions with modifiers of their own (CR 205.2a, 205.4)', () => {
  it('reads each half as a description: a land creature or a nonbasic land; a noncreature artifact or a noncreature enchantment', () => {
    expect(fullyAutomated(spell('Destroy target land creature or nonbasic land.'))).toBe(true);
    expect(json('Destroy target land creature or nonbasic land.')).toContain('"anyOf":[{"allTypes":["Land","Creature"]},{"notSupertypes":["Basic"],"types":["Land"]}]');
    expect(fullyAutomated(spell('Destroy target noncreature artifact or noncreature enchantment.'))).toBe(true);
    expect(fullyAutomated(spell('Destroy target artifact or tapped creature.'))).toBe(true);
    expect(fullyAutomated(spell('Destroy target artifact creature or black creature.'))).toBe(true);
    expect(fullyAutomated(spell('Destroy all noncreature artifacts or noncreature enchantments.'))).toBe(true);
  });
  it('keeps the reading of the plain coordination of card types where it exists ("creature or planeswalker"): one description, the same JSON as before', () => {
    expect(json('Destroy target artifact or enchantment.')).toContain('"filter":{"types":["Artifact","Enchantment"]}');
  });
  it('a bare type beside a description of several type words has two readings, so neither is chosen ("artifact creature or land", "Adventure instant or sorcery spell")', () => {
    expect(fullyAutomated(spell('Destroy target artifact creature or land.'))).toBe(false);
    expect(fullyAutomated(creature('Whenever you cast an Adventure instant or sorcery spell, you gain 1 life.'))).toBe(false);
  });
  it('a "with ..." or other modifier after the whole coordination may belong to the last half only, so it is not read ("legendary creature or creature with mana value 1")', () => {
    expect(fullyAutomated(creature('Whenever another legendary creature or creature with mana value 1 enters under your control, you gain 1 life.'))).toBe(false);
    expect(fullyAutomated(spell('Destroy target artifact or tapped creature with flying.'))).toBe(false);
  });
  it('who controls them holds for both halves', () => {
    expect(json('Destroy target noncreature artifact or noncreature enchantment you control.')).toContain('"controller":"you"');
    expect(fullyAutomated(spell('Destroy target noncreature artifact or noncreature enchantment you control.'))).toBe(true);
  });
  it('a creature spell or a legendary spell: the head noun "spell" is shared by both halves', () => {
    const f = spell('Counter target creature or legendary spell.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"kind":"spell"');
    expect(JSON.stringify(f.abilities)).toContain('"anyOf":[{"types":["Creature"]},{"supertypes":["Legendary"]}]');
  });
  it('"a Wizard or basic land card" keeps the head noun "card" for the templates of searches (no second reading)', () => {
    expect(fullyAutomated(creature('When ~ enters, you may search your library for a Wizard or basic land card, reveal it, put it into your hand, then shuffle.'))).toBe(true);
  });
});

describe('"with no counters on it" (CR 122.1)', () => {
  it('is a creature with no counter of any kind: the sum over every kind is 0', () => {
    const f = spell('Destroy target creature with no counters on it.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"counters":{"kind":"any","cmp":{"op":"==","value":0}}');
  });
  it('is never read for "without a counter on it" (another wording, another rendering)', () => {
    expect(JSON.stringify(spell('Destroy target creature without a counter on it.').abilities)).not.toContain('"cmp":{"op":"==","value":0}');
  });
});

describe('the plural of Spacecraft is Spacecraft (CR 205.3)', () => {
  it('"Exile all creatures and Spacecraft." and "Exile all Spacecraft." are one filter each', () => {
    expect(fullyAutomated(spell('Exile all creatures and Spacecraft.'))).toBe(true);
    expect(json('Exile all creatures and Spacecraft.')).toContain('"anyOf":[{"types":["Creature"]},{"subtypes":["Spacecraft"]}]');
    expect(fullyAutomated(spell('Exile all Spacecraft.'))).toBe(true);
    expect(fullyAutomated(spell('Exile all Spacecrafts.'))).toBe(false);
  });
});

describe('"target spell or <permanent>" (CR 115.1)', () => {
  it('any spell or a permanent of the description; the permanent half takes no modifier of its own', () => {
    expect(fullyAutomated(spell("Return target spell or creature to its owner's hand."))).toBe(true);
    expect(fullyAutomated(spell("Return target spell or nonland permanent to its owner's hand."))).toBe(true);
    expect(fullyAutomated(spell("Return target spell or permanent to its owner's hand."))).toBe(true);
    expect(fullyAutomated(spell("Return target spell or creature you control to its owner's hand."))).toBe(false);
  });
});

describe('"each of those creatures you don\'t control" (CR 608.2c, 109.4)', () => {
  const tap = (tail: string): string => `When ~ enters, tap two target creatures. ${tail}`;
  it('the part of the group a player controls or owns, or does not', () => {
    expect(fullyAutomated(parse(card('Example Maze', 'Enchantment', tap("Put a stun counter on each of those creatures you don't control."))))).toBe(true);
    expect(fullyAutomated(parse(card('Example Maze', 'Enchantment', tap('Put a stun counter on each of those creatures an opponent controls.'))))).toBe(true);
    expect(fullyAutomated(parse(card('Example Maze', 'Enchantment', tap('Put a +1/+1 counter on each of those creatures you control.'))))).toBe(true);
  });
  it('nothing else is read after the group ("with flying" may name a different set)', () => {
    expect(fullyAutomated(parse(card('Example Maze', 'Enchantment', tap('Put a stun counter on each of those creatures with flying.'))))).toBe(false);
  });
});

describe('"other than that creature" and a spell or ability that is no creature (CR 115.1, 115.3)', () => {
  const HERALD = 'Whenever a creature you control becomes the target of a spell or ability an opponent controls, put a +1/+1 counter on target creature you control other than that creature.';
  it('names the creature the trigger is about, never the spell or ability that targets it', () => {
    const f = creature(HERALD);
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"not":{"is":{"ref":"event","role":"subject"}}');
  });
  it('"that creature" beside a trigger about a spell cast is not read as the spell either ("whenever you cast a spell that targets ~, tap target creature. Untap that creature")', () => {
    const f = creature('Whenever you cast a spell that targets ~, tap target creature an opponent controls. That creature doesn\'t untap during its controller\'s next untap step.');
    expect(JSON.stringify(f.abilities)).not.toContain('"role":"spell"');
  });
  it('with nothing for "that creature" to name, the sentence stays manual', () => {
    expect(fullyAutomated(spell('Put a +1/+1 counter on target creature you control other than that creature.'))).toBe(false);
  });
});

describe('"destroy it" after a trigger of two events about one object (CR 603.2)', () => {
  const AURA = (events: string): OracleCard => card('Example Freeze', 'Enchantment — Aura', `Enchant creature\nWhen enchanted creature ${events}, destroy it.`);
  it('reads the creature of both events', () => {
    const f = parse(AURA('becomes tapped or is dealt damage'));
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('{"op":"destroy","what":{"ref":"event","role":"object"}}');
  });
  it('an event that is about something else than the creature leaves "it" with no meaning, so the sentence stays manual', () => {
    expect(fullyAutomated(parse(card('Example Freeze', 'Enchantment — Aura', 'Enchant creature\nWhen enchanted creature becomes tapped or you gain life, destroy it.')))).toBe(false);
  });
});
