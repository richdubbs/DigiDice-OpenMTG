/**
 * LOOK1 (found by cloud slice std-blb): the anaphora of the sentence after "look at the top card of [a player's] library" (design 6.4). The card looked at is a singular
 * mention of the discourse (parser/lower/mentions.ts#producedBy) and the focus after the look (model/focus.ts#looksAtOneCard, parser/lower/anaphora.ts#focusAt), so a
 * bare "it" right after the look is that card even when the trigger's event has an object of its own (the attacking creature, the creature that entered); the renderer
 * says the same (render/steps.ts#clausesOf), so the exact render gate (G6) passes. Before, the look added no mention and "it" fell back to the event's object: the
 * condition asked whether the ATTACKING object was a land card (Explorer's Scope, Raiders' Karve, Mobile Homestead were full with that reading).
 *
 *   CR 701.20e, 608.2c   the card looked at stays on top of the library (looking moves nothing) and is what "it" / "that card" names in the next sentence
 *   CR 603.4             the "if" of that sentence is no intervening "if": what it reads is resolved like any instruction's, after the look
 *   design 6.4           what the focus does not decide stays with the unique-candidate rule: a second reference word, an instruction in between, the top cards
 *                        of several libraries (no one card) keep the sentence manual instead of guessing
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with). Synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { defaultParseOptions, parseCard } from '../../src/parser/parse';
import { TEMPLATE_SET } from '../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../src/model/capabilities';
import { focusEffect, looksAtOneCard } from '../../src/model/focus';
import { card, fullyAutomated } from '../m5/templates/support';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
const faceOf = (text: string, type: string) => parseCard(card('Look Probe', type, text), OPTS).faces[0]!;
const json = (text: string, type: string): string => JSON.stringify(faceOf(text, type).abilities);
const understood = (text: string, type: string): boolean => fullyAutomated(faceOf(text, type));

/** The look names the card it looked at (`as`), and the condition and the move of the next sentence read that name. */
const BOUND = /"op":"look"[^]*"as":"seen"[^]*"cond":"matches","object":\{"ref":"bound","name":"seen"\}[^]*"op":"move","what":\{"ref":"bound","name":"seen"\}/;

describe('LOOK1: "it" after a look at one top card is that card (CR 701.20e, 608.2c), whatever object the trigger\'s event has', () => {
  const cases: [string, string, string, string][] = [
    ['the object itself attacks', 'Creature — Human Scout', "Whenever this creature attacks, look at the top card of your library. If it's a land card, you may put it onto the battlefield.", '"ref":"event"'],
    ['equipped creature attacks', 'Artifact — Equipment', "Whenever equipped creature attacks, look at the top card of your library. If it's a land card, you may put it onto the battlefield.\nEquip {1}", '"ref":"event"'],
    ['another creature enters', 'Creature — Turtle', "Whenever another creature you control enters, look at the top card of your library. If it's a land card, you may put it onto the battlefield tapped.", '"role":"subject"'],
    ['the object itself blocks', 'Creature — Human Scout', "Whenever this creature blocks, look at the top card of your library. If it's an artifact card, you may put it into your hand.", '"ref":"event"'],
  ];
  for (const [name, type, text, wrong] of cases) {
    it(`${name}: the condition and the move read the card looked at, never the event's object; full and through the render gate`, () => {
      expect(understood(text, type), JSON.stringify(faceOf(text, type).diagnostics)).toBe(true);
      const j = json(text, type);
      expect(j).toMatch(BOUND);
      expect(j).not.toContain(wrong);
    });
  }

  it('no object in the event (a phase trigger): the card is the only candidate, so the sentence is understood (it had no antecedent before)', () => {
    const text = "At the beginning of your end step, look at the top card of your library. If it's a land card, you may put it onto the battlefield tapped.";
    expect(understood(text, 'Enchantment')).toBe(true);
    expect(json(text, 'Enchantment')).toMatch(BOUND);
  });

  it('an activated ability: the object its cost names is no candidate after the first instruction (PUSH1 T2), the card is', () => {
    const text = "{2}, {T}: Look at the top card of your library. If it's a land card, you may put it onto the battlefield tapped.";
    expect(understood(text, 'Artifact')).toBe(true);
    expect(json(text, 'Artifact')).toMatch(BOUND);
  });
});

describe('LOOK1: the same card in the same sentence (the look idiom) and in an "Otherwise" sentence (the focus of the `if` it completes)', () => {
  it('"look at the top card of that player\'s library, then exile it face down": the card looked at is exiled, never the creature that dealt the damage', () => {
    const text = "Whenever this creature deals combat damage to a player, look at the top card of that player's library, then exile it face down.";
    const f = faceOf(text, 'Creature — Rat Rogue');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    const j = JSON.stringify(f.abilities);
    expect(j).toMatch(/"op":"look"[^]*"as":"seen"[^]*"op":"move","what":\{"ref":"bound","name":"seen"\},"to":\{"zone":"exile","faceDown":true\}/);
    expect(j).not.toContain('"role":"source"');
  });

  it('"create a token, then look at ... and exile it face down": the card looked at, not the token created before it', () => {
    const text = "Whenever one or more creatures you control deal combat damage to a player, create a Food token, then look at the top card of that player's library and exile it face down.";
    const j = json(text, 'Creature — Rat Rogue');
    expect(j).toMatch(/"op":"move","what":\{"ref":"bound","name":"seen"\}/);
    expect(j).not.toMatch(/"op":"move","what":\{"ref":"bound","name":"token"\}/);
  });

  it('"If it\'s a land card, you may put it onto the battlefield tapped. Otherwise, put it into your hand.": the `else` moves the card looked at, never the creature that entered', () => {
    const text = "Whenever another creature you control enters, look at the top card of your library. If it's a land card, you may put it onto the battlefield tapped. Otherwise, put it into your hand.";
    const f = faceOf(text, 'Creature — Turtle');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    const j = JSON.stringify(f.abilities);
    expect(j).toMatch(/"else":\[\{"op":"move","what":\{"ref":"bound","name":"seen"\},"to":\{"zone":"hand"\}\}\]/);
    expect(j).not.toContain('"role":"subject"');
  });

  it('an "Otherwise" of two instructions does not inherit the focus (its own steps are no mentions): manual, not a guess', () => {
    const text = "Whenever another creature you control enters, look at the top card of your library. If it's a land card, you may put it onto the battlefield tapped. Otherwise, you gain 1 life and put it into your hand.";
    const f = faceOf(text, 'Creature — Turtle');
    expect(fullyAutomated(f)).toBe(false);
    expect(JSON.stringify(f.abilities)).not.toContain('"role":"subject"');
  });
});

describe('LOOK1: what the focus does not decide stays with the unique-candidate rule (design 6.4): manual, never a guess', () => {
  it('an instruction between the look and the pronoun ends the focus: "it" has two candidates (the attacking creature and the card)', () => {
    const text = "Whenever this creature attacks, look at the top card of your library. You gain 1 life. If it's a land card, you may put it onto the battlefield.";
    const f = faceOf(text, 'Creature — Human Scout');
    expect(fullyAutomated(f)).toBe(false);
    expect(JSON.stringify(f.abilities)).not.toContain('"ref":"event"');
  });

  it('a sentence that refers back to two things ("it" and "that creature") is left to the unique-candidate rule', () => {
    const text = 'Whenever another creature you control enters, look at the top card of your library. If it shares a creature type with that creature, you may put it into your hand.';
    const f = faceOf(text, 'Creature — Turtle');
    expect(fullyAutomated(f)).toBe(false);
    expect(JSON.stringify(f.abilities)).not.toMatch(/"op":"move","what":\{"ref":"event"/);
  });

  it('the top card of EACH player\'s library is several cards, never "that card": no singular mention (the pronoun stays without an antecedent)', () => {
    const f = faceOf("{T}: Look at the top card of each player's library. You may put that card on the bottom of its owner's library.", 'Artifact');
    expect(fullyAutomated(f)).toBe(false);
    expect(JSON.stringify(f.abilities)).not.toContain('"as":"seen"');
  });

  it('a look at several cards keeps its group (FAST5 T43): "them" is still the plural binding of the look', () => {
    const text = 'Look at the top two cards of your library. Put one of them into your hand and the other into your graveyard.';
    const j = json(text, 'Sorcery');
    expect(understood(text, 'Sorcery')).toBe(true);
    expect(j).toMatch(/"op":"look"[^]*"count":2\},"as":"(\w+)"[^]*"op":"chooseObjects"[^]*"is":\{"ref":"bound","name":"\1"\}/);
    expect(j).not.toContain('"as":"seen"');
  });
});

describe('LOOK1: model/focus.ts#looksAtOneCard and the focus after a look (shared by the parser and the renderer)', () => {
  const look = (player: unknown, count: unknown = 1): Record<string, unknown> => ({ op: 'look', who: { ref: 'you' }, at: { ref: 'topCards', player, count } });
  it('the top card of one player\'s library is one card: yours, a target player\'s, the event\'s player\'s, the defending player\'s', () => {
    for (const p of [{ ref: 'you' }, { ref: 'target', id: 't0' }, { ref: 'event', role: 'player' }, { ref: 'defending' }]) {
      expect(looksAtOneCard(look(p)), JSON.stringify(p)).toBe(true);
      expect(focusEffect(look(p))).toEqual({ kind: 'makes' });
    }
  });
  it('the top card of several libraries, several top cards, or a guarded look is not one card the focus can be', () => {
    expect(looksAtOneCard(look({ ref: 'each', who: 'player' }))).toBe(false);
    expect(looksAtOneCard(look({ ref: 'otherOpponents' }))).toBe(false);
    expect(looksAtOneCard(look({ ref: 'you' }, 3))).toBe(false);
    expect(looksAtOneCard({ op: 'reveal', who: { ref: 'you' }, what: { ref: 'topCards', player: { ref: 'you' }, count: 1 } })).toBe(false);
    expect(focusEffect(look({ ref: 'each', who: 'player' }))).toBeNull();
    expect(focusEffect({ ...look({ ref: 'you' }), guard: { cond: 'turnOf', whose: 'you' } })).toBeNull();
  });
});
