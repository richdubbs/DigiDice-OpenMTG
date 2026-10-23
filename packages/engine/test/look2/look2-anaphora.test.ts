/**
 * LOOK2 (the follow-up of LOOK1: Edward Kenway's "You may play that card for as long as it remains exiled."): the anaphora of "that card" in the sentence after an
 * instruction that moved a BINDING (the card looked at) into exile or a graveyard (design 6.4, the focus rule of FAST5 T76). A binding moved to a public zone follows the
 * card (design 3.1 rule 2), so it never had the `movedBy` that let the focus decide "that card" for a moved target; and the subject of "for as long as it remains
 * exiled" counted as a second thing the sentence refers back to, so the sentence had no focus at all. Both together left "that card" with two candidates (the card,
 * and the creature of the trigger's damage event, which the discourse model may call a card) and the sentence manual and contagious.
 *
 *   CR 400.7, 608.2c   the card an instruction moved into exile or a graveyard is a new object there, and "that card" in the next sentence is that card
 *                      (parser/lower/anaphora.ts#movedCardFocus), never the creature that dealt the damage
 *   CR 611.2b          "for as long as it remains exiled" lasts while the objects of its permission stay exiled: its "it" names what the permission names, no second
 *                      thing (parser/lower/anaphora.ts#sentenceReferences)
 *   CR 110.1, 201.5    a move onto the battlefield makes a permanent, not a card: "that card" after it keeps the unique-candidate rule
 *   design 6.4         what the focus does not decide stays manual: an instruction in between, a move that is not the last instruction, a second reference word
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with). Synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { defaultParseOptions, parseCard } from '../../src/parser/parse';
import { TEMPLATE_SET } from '../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../src/model/capabilities';
import { card, fullyAutomated } from '../m5/templates/support';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
const faceOf = (text: string) => parseCard(card('Raid Probe', 'Enchantment', text), OPTS).faces[0]!;
const json = (text: string): string => JSON.stringify(faceOf(text).abilities);
const understood = (text: string): boolean => fullyAutomated(faceOf(text));
const diagnostics = (text: string): string => JSON.stringify(faceOf(text).diagnostics);

const DAMAGE = 'Whenever an artifact creature you control deals combat damage to a player, look at the top card of that player\'s library, then';
/** The permission names the card the look bound (`seen`), the card the move put into its new zone. */
const PERMITS_SEEN = /"op":"look"[^]*"as":"seen"[^]*"op":"move","what":\{"ref":"bound","name":"seen"\}[^]*"s":"permit"[^]*"of":\{"is":\{"ref":"bound","name":"seen"\}\}/;

describe('LOOK2: "that card" after the instruction that moved the card looked at into exile or a graveyard is that card (CR 400.7, 608.2c), never the trigger\'s creature', () => {
  it('exiled face down, "You may cast that card for as long as it remains exiled.": the card in exile; full and through the render gate', () => {
    const text = `${DAMAGE} exile it face down. You may cast that card for as long as it remains exiled.`;
    expect(understood(text), diagnostics(text)).toBe(true);
    const j = json(text);
    expect(j).toMatch(PERMITS_SEEN);
    expect(j).toContain('"duration":{"d":"remainsExiled"}');
    expect(j).not.toContain('"role":"source"');
  });

  it('put into its owner\'s graveyard, "You may cast that card this turn.": the card in the graveyard (no duration word: the move alone decides)', () => {
    const text = `${DAMAGE} put it into its owner's graveyard. You may cast that card this turn.`;
    expect(understood(text), diagnostics(text)).toBe(true);
    const j = json(text);
    expect(j).toMatch(/"op":"move","what":\{"ref":"bound","name":"seen"\},"to":\{"zone":"graveyard"\}[^]*"of":\{"is":\{"ref":"bound","name":"seen"\}\}/);
    expect(j).not.toContain('"role":"source"');
  });

  it('CR 611.2b: "For as long as that card remains exiled, you may cast it.": the duration\'s subject is no second reference word, so the focus decides the bare "it"', () => {
    const text = `${DAMAGE} exile it face down. For as long as that card remains exiled, you may cast it.`;
    expect(understood(text), diagnostics(text)).toBe(true);
    expect(json(text)).toMatch(PERMITS_SEEN);
  });

  it('the object itself as the damage source was never a candidate ("that card" never names it, CR 201.5): the same reading as before', () => {
    const text = 'Whenever this creature deals combat damage to a player, look at the top card of that player\'s library, then exile it face down. You may cast that card for as long as it remains exiled.';
    const f = parseCard(card('Raid Probe', 'Artifact Creature — Construct', text, { power: '1', toughness: '1' }), OPTS).faces[0]!;
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toMatch(PERMITS_SEEN);
  });
});

describe('LOOK2: what the focus does not decide stays with the unique-candidate rule (design 6.4): manual, never a guess', () => {
  const NOT_THE_CREATURE = /"of":\{"is":\{"ref":"event"/;

  it('an instruction between the move and "that card" ends the focus: two candidates (the creature that dealt the damage and the card)', () => {
    const text = `${DAMAGE} exile it face down. You gain 2 life. You may cast that card for as long as it remains exiled.`;
    expect(understood(text)).toBe(false);
    expect(diagnostics(text)).toContain('\\"that card\\" has 2 compatible antecedents');
    expect(json(text)).not.toMatch(NOT_THE_CREATURE);
  });

  it('the move is not the last instruction of the sentence before ("... exile it face down and you gain 2 life."): no focus', () => {
    const text = `${DAMAGE} exile it face down and you gain 2 life. You may cast that card for as long as it remains exiled.`;
    expect(understood(text)).toBe(false);
    expect(json(text)).not.toMatch(NOT_THE_CREATURE);
  });

  it('CR 110.1: a move onto the battlefield makes a permanent, not a card: "that card" after it keeps both candidates', () => {
    const text = `${DAMAGE} put it onto the battlefield under your control. Tap that card.`;
    expect(understood(text)).toBe(false);
    expect(diagnostics(text)).toContain('\\"that card\\" has 2 compatible antecedents');
  });

  // std-exile-play-1-2 (CR 609.4b): the any-type rider's "cast it" is the permission's own words (parser/lower/anaphora.ts#sentenceReferences), so this sentence refers back
  // to one thing and the focus decides "that card"; a real second reference word still leaves it to the unique-candidate rule
  it('the any-type rider\'s "to cast it" is no second reference word: the focus decides "that card", the card in exile', () => {
    const text = `${DAMAGE} exile it face down. You may cast that card for as long as it remains exiled, and mana of any type can be spent to cast it.`;
    expect(understood(text), diagnostics(text)).toBe(true);
    expect(json(text)).toMatch(PERMITS_SEEN);
    expect(json(text)).not.toMatch(NOT_THE_CREATURE);
  });
  it('a second reference word outside the duration ("... if that creature is tapped") leaves the sentence to the unique-candidate rule', () => {
    const text = `${DAMAGE} exile it face down. You may cast that card for as long as it remains exiled if that creature is tapped.`;
    expect(understood(text)).toBe(false);
    expect(json(text)).not.toMatch(NOT_THE_CREATURE);
  });
});
