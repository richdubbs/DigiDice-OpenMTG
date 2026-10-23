/**
 * T10 (FAST2 wave): the anaphora rules the T10 shapes need (design 6.4, the unique-candidate rule), read on synthetic cards through the game's default
 * compiler. Each rule narrows the candidates by what the rules allow, never by a ranking; with two candidates left the sentence stays manual.
 *
 *   CR 201.5          while a trigger's event leaves ~ where it is, "that creature" is never ~ (Mention.selfObject)
 *   CR 701.21a, 701.8a "sacrifice it" / "destroy it" never name the spell or ability that targeted ~ (Mention.stackObject)
 *   CR 301.5c         "attach ~ to it": it is never ~
 *   CR 701.23a        the search idiom: "search ..., put it ...": the "it" of the move right after the search is the card found
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type OracleCard } from '../../../src/index';

const compiled = (text: string, type = 'Creature — Golem'): CardDef =>
  compileCard({ name: 'Test Subject', layout: 'normal', type_line: type, oracle_text: text, mana_cost: '{2}', colors: [], power: '2', toughness: '2' } as OracleCard as never);
const json = (d: CardDef): string => JSON.stringify(d.faces[0]!.abilities);
const manual = (d: CardDef): boolean => json(d).includes('"op":"manual"') || d.faces[0]!.abilities.some((a) => a.kind === 'manual');

describe('CR 201.5: "that creature" is never ~ while the event leaves ~ where it is', () => {
  it('"Whenever ~ becomes blocked by a creature, destroy that creature": the blocker', () => {
    const d = compiled('Whenever ~ becomes blocked by a creature, destroy that creature.');
    expect(manual(d)).toBe(false);
    expect(json(d)).toContain('{"op":"destroy","what":{"ref":"event","role":"blocker"}}');
  });
  it('"Whenever ~ deals combat damage to a creature, tap that creature": the creature dealt damage', () => {
    const d = compiled('Whenever ~ deals combat damage to a creature, tap that creature.');
    expect(manual(d)).toBe(false);
    expect(json(d)).toContain('{"op":"tap","what":{"ref":"event","role":"object"}}');
  });
  it('with ~ the only object the event names, "that creature" has no antecedent: manual', () => {
    expect(manual(compiled('Whenever ~ attacks, tap that creature.'))).toBe(true);
  });
  it('a bare "it" may still be ~, so with another candidate it stays manual', () => {
    expect(manual(compiled('Whenever ~ becomes blocked by a creature, tap it.'))).toBe(true);
  });
});

describe('CR 701.21a, 701.8a: "sacrifice it" names a permanent', () => {
  it('"When ~ becomes the target of a spell or ability, sacrifice it": the object itself', () => {
    const d = compiled('When ~ becomes the target of a spell or ability, sacrifice it.');
    expect(manual(d)).toBe(false);
    expect(json(d)).toContain('{"op":"sacrifice","what":{"ref":"event","role":"subject"}}');
  });
  it('an instruction that may act on a spell or ability ("tap it" is not one of them, but the rule is only for destroy and sacrifice) stays manual', () => {
    expect(manual(compiled('When ~ becomes the target of a spell or ability, tap it.'))).toBe(true);
  });
});

describe('CR 301.5c: "attach ~ to it"', () => {
  it('"create a token, then attach ~ to it": the token', () => {
    const d = compiled('When ~ enters, create a 1/1 white Soldier creature token, then attach ~ to it.', 'Artifact — Equipment');
    expect(manual(d)).toBe(false);
    expect(json(d)).toMatch(/"op":"attach","what":\{"ref":"self"\},"to":\{"ref":"bound","name":"token"\}/);
  });
});

describe('CR 701.23a: the search idiom', () => {
  it('"When ~ enters, search ..., put it onto the battlefield tapped, then shuffle": the card found, not ~', () => {
    const d = compiled('When ~ enters, search your library for a basic land card, put it onto the battlefield tapped, then shuffle.');
    expect(manual(d)).toBe(false);
    expect(json(d)).toMatch(/"op":"search".*"as":"search".*"op":"move","what":\{"ref":"bound","name":"search"\}/);
  });
  it('with an instruction between the search and the move, "it" has two candidates: manual', () => {
    expect(manual(compiled('When ~ enters, search your library for a basic land card, draw a card, then put it onto the battlefield tapped.'))).toBe(true);
  });
});
