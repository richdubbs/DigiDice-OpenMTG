/**
 * T17 (FAST3 wave): the renderer and grammar additions the T17 templates need for the exact render gate (design 6.8, G6). Each case states what the renderer
 * accepts for a JSON and which wording it must NOT accept, so the gate never excuses a different meaning. Wordings are synthetic (design 6.10).
 *
 *   CR 603.2, 608.2h  "create that many ... tokens" / "investigate that many times": the amount of the triggering event (design 3.5 `eventAmount`)
 *   CR 107.3          "create an X/X ... token, where X is ...": one token whose power and toughness are the same computed number
 *   CR 102.3          "the number of opponents you have"
 *   CR 205.3m         "an Ally creature card" (subtype AND type creature) is not "an Ally card" (the subtype alone)
 *   CR 701.20a        "reveal that card" names the card just found, as "reveal it" does
 *   CR 401.4          "then shuffle and put those cards on top in any order"
 *   CR 608.2d         "create your choice of a Clue token, a Food token, or a Treasure token"
 *   CR 701.23a        "up to two basic land cards and/or Desert cards" (a count before a list of descriptions)
 *   CR 111.4          a token name with "of" in it ("named Gnomes of Blue Hill")
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, EffectStep, EventPattern } from '../../../src/index';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { accepts, bound, objTarget, rejects, spell, t, trig, you } from '../../m5/render/build';
import { card } from '../../m5/templates/support';

const damageToPlayer: EventPattern[] = [{ ev: 'damage', source: { self: true }, recipient: { player: 'any' }, combat: true } as unknown as EventPattern];
const insect = { colors: ['G'], types: ['Creature'], subtypes: ['Insect'], power: 1, toughness: 1 };
const tokens = (count: unknown, token: Record<string, unknown> = insect, extra: Record<string, unknown> = {}): EffectStep => ({ op: 'createToken', who: you, count, token, ...extra } as EffectStep);
const parsed = (type: string, text: string) => parseCard(card('Test Subject', type, text), defaultParseOptions()).faces[0]!;
const automated = (f: ReturnType<typeof parsed>): boolean => !JSON.stringify(f.abilities).includes('"manual"') && f.gate.every((g) => g.ok);

describe('CR 603.2, 608.2h: "that many" is the amount of the triggering event', () => {
  it('"create that many ... tokens" for a count of the event amount, never for a fixed number', () => {
    accepts(trig(damageToPlayer, [tokens({ q: 'eventAmount' })]), 'Whenever ~ deals combat damage to a player, create that many 1/1 green Insect creature tokens.');
    rejects(trig(damageToPlayer, [tokens(2)]), 'Whenever ~ deals combat damage to a player, create that many 1/1 green Insect creature tokens.');
  });
  it('"investigate that many times"; a computed count other than the event amount stays refused', () => {
    accepts(trig(damageToPlayer, [{ op: 'action', action: 'investigate', who: you, n: { q: 'eventAmount' } } as EffectStep]), 'Whenever ~ deals combat damage to a player, investigate that many times.');
    rejects(trig(damageToPlayer, [{ op: 'action', action: 'investigate', who: you, n: { q: 'life', of: you } } as EffectStep]), 'Whenever ~ deals combat damage to a player, investigate that many times.');
  });
});

describe('CR 107.3, 608.2h: "create an X/X ... token, where X is ..."', () => {
  const lands = { q: 'count', of: { ref: 'each', filter: { types: ['Land'], controller: 'you' } } };
  it('one token with power and toughness the same computed number', () => {
    accepts(spell([tokens(1, { ...insect, power: lands, toughness: lands })]), 'Create an X/X green Insect creature token, where X is the number of lands you control.');
  });
  it('never for two tokens, or for a power that differs from the toughness', () => {
    rejects(spell([tokens(2, { ...insect, power: lands, toughness: lands })]), 'Create an X/X green Insect creature token, where X is the number of lands you control.');
    rejects(spell([tokens(1, { ...insect, power: lands, toughness: 1 })]), 'Create an X/X green Insect creature token, where X is the number of lands you control.');
  });
});

describe('CR 102.3: "the number of opponents you have"', () => {
  it('a count of the opponents; never of every player', () => {
    accepts(spell([tokens({ q: 'countPlayers', of: { ref: 'each', who: 'opponent' } }, { predefined: 'Food' })]), 'Create a number of Food tokens equal to the number of opponents you have.');
    rejects(spell([tokens({ q: 'countPlayers', of: { ref: 'each', who: 'player' } }, { predefined: 'Food' })]), 'Create a number of Food tokens equal to the number of opponents you have.');
  });
});

describe('CR 205.3m: "an Ally creature card" names the type creature too', () => {
  const find = (filter: Record<string, unknown>): AbilityDef => spell([{ op: 'search', who: you, zone: 'library', filter, max: 1, as: 'found' } as EffectStep, { op: 'move', what: bound('found'), to: { zone: 'hand' } } as EffectStep, { op: 'shuffle', who: you } as EffectStep]);
  it('subtype and type: "an Ally creature card", not "an Ally card"', () => {
    accepts(find({ types: ['Creature'], subtypes: ['Ally'] }), 'Search your library for an Ally creature card, put it into your hand, then shuffle.');
    rejects(find({ types: ['Creature'], subtypes: ['Ally'] }), 'Search your library for an Ally card, put it into your hand, then shuffle.');
  });
  it('the subtype alone: "an Ally card", not "an Ally creature card"', () => {
    accepts(find({ subtypes: ['Ally'] }), 'Search your library for an Ally card, put it into your hand, then shuffle.');
    rejects(find({ subtypes: ['Ally'] }), 'Search your library for an Ally creature card, put it into your hand, then shuffle.');
  });
  it('guard G5: "you may search ... for an Ally creature card, reveal it, ..." now has one reading and is automated', () => {
    const f = parsed('Creature — Human', 'When ~ enters, you may search your library for an Ally creature card, reveal it, put it into your hand, then shuffle.');
    expect(automated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"filter":{"types":["Creature"],"subtypes":["Ally"]}');
  });
});

describe('CR 701.20a, 401.4: "reveal that card"; "put those cards on top in any order"', () => {
  it('"reveal that card" is the card just found, as "reveal it"', () => {
    const one = spell([{ op: 'search', who: you, zone: 'library', filter: { types: ['Artifact'] }, max: 1, reveal: true, as: 'found' } as EffectStep, { op: 'move', what: bound('found'), to: { zone: 'hand' } } as EffectStep, { op: 'shuffle', who: you } as EffectStep]);
    accepts(one, 'Search your library for an artifact card, reveal that card, put it into your hand, then shuffle.');
    accepts(one, 'Search your library for an artifact card, reveal it, put it into your hand, then shuffle.');
  });
  const many = (order: 'chosen' | 'random' | undefined): AbilityDef => spell([
    { op: 'search', who: you, zone: 'library', filter: { subtypes: ['Wizard'] }, min: 0, max: 'any', reveal: true, as: 'found' } as EffectStep,
    { op: 'shuffle', who: you } as EffectStep,
    { op: 'move', what: bound('found'), to: { zone: 'library', position: 'top', ...(order ? { order } : {}) } } as EffectStep,
  ]);
  it('several found cards go on top in an order their owner chooses', () => {
    accepts(many('chosen'), 'Search your library for any number of Wizard cards, reveal them, then shuffle and put those cards on top in any order.');
  });
  it('never for a random order, nor with no order for several cards', () => {
    rejects(many('random'), 'Search your library for any number of Wizard cards, reveal them, then shuffle and put those cards on top in any order.');
    rejects(many(undefined), 'Search your library for any number of Wizard cards, reveal them, then shuffle and put those cards on top in any order.');
  });
});

describe('CR 608.2d, 111.10: "create your choice of a Clue token, a Food token, or a Treasure token"', () => {
  const choice = (names: string[], made: string[]): AbilityDef => spell([
    { op: 'chooseValue', who: you, what: 'option', as: 'c', link: 'c', options: names } as EffectStep,
    ...made.map((m, i) => ({ op: 'if', cond: { cond: 'chosen', link: 'c', equals: names[i] }, then: [tokens(1, { predefined: m })] }) as EffectStep),
  ]);
  it('one branch per option, each creating exactly that token', () => {
    accepts(choice(['Clue', 'Food', 'Treasure'], ['Clue', 'Food', 'Treasure']), 'Create your choice of a Clue token, a Food token, or a Treasure token.');
  });
  it('never when a branch creates another token than its option says', () => {
    rejects(choice(['Clue', 'Food', 'Treasure'], ['Clue', 'Treasure', 'Food']), 'Create your choice of a Clue token, a Food token, or a Treasure token.');
  });
});

describe('CR 701.23a: a count before a list of descriptions', () => {
  const lands = (max: number): AbilityDef => spell([
    { op: 'search', who: you, zone: 'library', filter: { anyOf: [{ supertypes: ['Basic'], types: ['Land'] }, { subtypes: ['Desert'] }] }, min: 0, max, as: 'found' } as EffectStep,
    { op: 'move', what: bound('found'), to: { zone: 'battlefield', controller: you, tapped: true } } as EffectStep,
    { op: 'shuffle', who: you } as EffectStep,
  ]);
  it('"up to two basic land cards and/or Desert cards"', () => {
    accepts(lands(2), 'Search your library for up to two basic land cards and/or Desert cards, put them onto the battlefield tapped, then shuffle.');
  });
  it('the count is said: "up to three" is not "up to two"', () => {
    rejects(lands(3), 'Search your library for up to two basic land cards and/or Desert cards, put them onto the battlefield tapped, then shuffle.');
  });
});

describe('CR 111.4: a token name with "of" in it', () => {
  it('"named Gnomes of Blue Hill" is the whole name', () => {
    const f = parsed('Sorcery', 'Create a 0/1 red Gnome creature token named Gnomes of Blue Hill.');
    expect(automated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"name":"Gnomes of Blue Hill"');
  });
  it('a name never ends with "of"', () => {
    expect(automated(parsed('Sorcery', 'Create a 0/1 red Gnome creature token named Gnomes of.'))).toBe(false);
  });
});

void objTarget;
void t;
