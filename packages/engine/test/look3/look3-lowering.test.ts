/**
 * LOOK3 (a LOOK1 follow-up): "Look at the top card of your library. If it's a land card, you may put it onto the battlefield. If you don't put the card onto the battlefield,
 * put it into your hand." (zz-cloud/look3.json). The condition is the negation of whether the move of that card happened, not an `else`: it holds when the card was not a
 * land card (the move never ran) AND when you chose not to put it there (CR 608.2c). The lowering names the move (`as`) and the condition reads it (`did`, `not`, `to`;
 * lower/conditions.ts#resolveDid, model/focus.ts#notPutMove); the sentence's "it" is the card that move would have moved, never the trigger's object
 * (lower/anaphora.ts#notPutFocus), and the renderer says the same (render/steps.ts#clausesOf), so the exact render gate (G6) passes.
 *
 *   CR 608.2c            "If you don't put the card onto the battlefield" reads the instruction right before it: the option of moving that card (declined or never offered)
 *   CR 701.20e, 400.7    the card looked at stays on top of the library until something moves it; inside the sentence it was not moved, so a move into a hidden zone
 *                        does not rename it (the hand variant)
 *   design 6.4           what the condition does not settle stays with the unique-candidate rule: another zone, an instruction in between, a second reference word,
 *                        a sentence before it that is not understood
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with). Synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, EffectStep, EventPattern } from '../../src/types/ability';
import { defaultParseOptions, parseCard } from '../../src/parser/parse';
import { TEMPLATE_SET } from '../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../src/model/capabilities';
import { notPutMove, notPutZone } from '../../src/model/focus';
import { card, fullyAutomated } from '../m5/templates/support';
import { bound, passes, trig, you } from '../m5/render/build';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
const faceOf = (text: string, type: string) => parseCard(card('Rider Probe', type, text), OPTS).faces[0]!;
const json = (text: string, type: string): string => JSON.stringify(faceOf(text, type).abilities);
const understood = (text: string, type: string): boolean => fullyAutomated(faceOf(text, type));

const LOOK = 'look at the top card of your library.';
/** The look names its card (`seen`), the option moves it under a name of its own, the condition reads that move negated, and the rider moves the card looked at. */
const READ = (zone: 'battlefield' | 'hand'): RegExp => new RegExp(
  `"op":"look"[^]*"as":"(\\w+)"[^]*"op":"may","who":\\{"ref":"you"\\},"do":\\[[^]*\\{"op":"move","what":\\{"ref":"bound","name":"\\1"\\},"to":\\{"zone":"${zone}"[^}]*\\}(?:,"tapped":true)?[^]*?"as":"(\\w+)"\\}\\]\\}\\]\\},\\{"op":"if","cond":\\{"cond":"did","step":"\\2","not":true,"to":"${zone}"\\},"then":\\[[^]*"what":\\{"ref":"bound","name":"\\1"\\}`,
);

describe('LOOK3: "If you don\'t put the card onto the battlefield, put it into your hand." reads the move of the card looked at, negated (CR 608.2c), whatever object the trigger\'s event has', () => {
  const cases: [string, string, string, string][] = [
    ['the object itself attacks', 'Creature — Human Scout', `Whenever this creature attacks, ${LOOK} If it's a land card, you may put it onto the battlefield. If you don't put the card onto the battlefield, put it into your hand.`, '"ref":"event"'],
    ['another creature enters (tapped, "it" in the condition)', 'Creature — Turtle', `Whenever another creature you control enters, ${LOOK} If it's a land card, you may put it onto the battlefield tapped. If you don't put it onto the battlefield, put it into your hand.`, '"role":"subject"'],
    ['the object itself deals combat damage', 'Creature — Rat Rogue', `Whenever this creature deals combat damage to a player, ${LOOK} If it's an artifact card, you may put it onto the battlefield. If you don't put the card onto the battlefield, put it into your hand.`, '"role":"source"'],
    ['the object itself enters', 'Creature — Elf Druid', `When this creature enters, ${LOOK} If it's a creature card, you may put it onto the battlefield. If you don't put the card onto the battlefield, put it on the bottom of your library.`, '"what":{"ref":"self"}'],
  ];
  for (const [name, type, text, wrong] of cases) {
    it(`${name}: full, through the render gate, and the rider moves the card looked at, never the event's object`, () => {
      expect(understood(text, type), JSON.stringify(faceOf(text, type).diagnostics)).toBe(true);
      const j = json(text, type);
      expect(j).toMatch(READ('battlefield'));
      expect(j).not.toContain(wrong);
    });
  }

  it('an activated ability and a spell: the card is the only candidate, the reading is the same', () => {
    const act = `{2}, {T}: Look at the top card of your library. If it's a land card, you may put it onto the battlefield. If you don't put the card onto the battlefield, put it into your hand.`;
    expect(understood(act, 'Artifact')).toBe(true);
    expect(json(act, 'Artifact')).toMatch(READ('battlefield'));
    const sorcery = `Look at the top card of your library. If it's a creature card, you may put it onto the battlefield. If you don't put it onto the battlefield, put it into your graveyard.`;
    expect(understood(sorcery, 'Sorcery')).toBe(true);
    expect(json(sorcery, 'Sorcery')).toMatch(READ('battlefield'));
  });

  it('the option alone (no condition before it) and the condition alone (no option) name the move too', () => {
    const option = `Whenever this creature attacks, ${LOOK} You may put it into your hand. If you don't put it into your hand, put it into your graveyard.`;
    expect(understood(option, 'Creature — Human Scout'), JSON.stringify(faceOf(option, 'Creature — Human Scout').diagnostics)).toBe(true);
    expect(json(option, 'Creature — Human Scout')).toMatch(/"op":"may","who":\{"ref":"you"\},"do":\[\{"op":"move","what":\{"ref":"bound","name":"seen"\},"to":\{"zone":"hand"\},"as":"(\w+)"\}\]\},\{"op":"if","cond":\{"cond":"did","step":"\1","not":true,"to":"hand"\}/);
    const condition = `Whenever this creature attacks, ${LOOK} If it's a land card, put it onto the battlefield. If you don't put the card onto the battlefield, put it into your hand.`;
    expect(understood(condition, 'Creature — Human Scout')).toBe(true);
    expect(json(condition, 'Creature — Human Scout')).toMatch(/"then":\[\{"op":"move","what":\{"ref":"bound","name":"seen"\},"to":\{"zone":"battlefield","controller":\{"ref":"you"\}\},"as":"(\w+)"\}\]\},\{"op":"if","cond":\{"cond":"did","step":"\1","not":true,"to":"battlefield"\}/);
  });
});

describe('LOOK3: "If you don\'t put the card into your hand, ..." (CR 608.2c, 400.7): inside the sentence the card was not put into the hand, so it keeps the name of the card looked at', () => {
  it('the rider moves `seen`, never the name of the move into the hidden zone it negates', () => {
    const text = `Whenever another creature you control enters, ${LOOK} If it's an artifact card, you may put it into your hand. If you don't put the card into your hand, you may put it into your graveyard.`;
    expect(understood(text, 'Creature — Turtle'), JSON.stringify(faceOf(text, 'Creature — Turtle').diagnostics)).toBe(true);
    const j = json(text, 'Creature — Turtle');
    expect(j).toMatch(READ('hand'));
    expect(j).toMatch(/"cond":\{"cond":"did","step":"(\w+)","not":true,"to":"hand"\},"then":\[\{"op":"may","who":\{"ref":"you"\},"do":\[\{"op":"move","what":\{"ref":"bound","name":"seen"\},"to":\{"zone":"graveyard"\}\}\]\}\]/);
    expect(j).not.toContain('"role":"subject"');
  });
});

describe('LOOK3: a target card the option would have moved (CR 608.2c, 400.7)', () => {
  it('"You may put target creature card from your graveyard onto the battlefield. If you don\'t put it onto the battlefield, put it into your hand.": the target, still in the graveyard', () => {
    const text = "You may put target creature card from your graveyard onto the battlefield. If you don't put it onto the battlefield, put it into your hand.";
    const f = faceOf(text, 'Sorcery');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toMatch(/"op":"move","what":\{"ref":"target","id":"(\w+)"\},"to":\{"zone":"battlefield","controller":\{"ref":"you"\}\},"as":"(\w+)"\}[^]*"cond":\{"cond":"did","step":"\2","not":true,"to":"battlefield"\},"then":\[\{"op":"move","what":\{"ref":"target","id":"\1"\},"to":\{"zone":"hand"\}\}\]/);
  });
});

describe('LOOK3 design 6.4: what the condition does not settle stays manual, never guessed', () => {
  const type = 'Creature — Human Scout';
  it('another zone than the move\'s ("onto the battlefield" ... "If you don\'t put the card into your hand"): unresolved', () => {
    const f = faceOf(`Whenever this creature attacks, ${LOOK} If it's a land card, you may put it onto the battlefield. If you don't put the card into your hand, put it into your graveyard.`, type);
    expect(fullyAutomated(f)).toBe(false);
    expect(JSON.stringify(f.abilities)).not.toContain('"not":true,"to":"hand"');
  });
  it('an instruction between the move and the condition: the instruction right before is not the move', () => {
    expect(understood(`Whenever this creature attacks, ${LOOK} If it's a land card, you may put it onto the battlefield. You gain 1 life. If you don't put the card onto the battlefield, put it into your hand.`, type)).toBe(false);
  });
  it('a bare "If you don\'t" after "If C, you may X" stays unresolved (the words do not say whether not being offered counts, T3); "Otherwise" stays the `else` of C (LOOK1)', () => {
    expect(understood(`Whenever this creature attacks, ${LOOK} If it's a land card, you may put it onto the battlefield. If you don't, put it into your hand.`, type)).toBe(false);
    const otherwise = json(`Whenever this creature attacks, ${LOOK} If it's a land card, you may put it onto the battlefield. Otherwise, put it into your hand.`, type);
    expect(otherwise).toContain('"else":[');
    expect(otherwise).not.toContain('"cond":"did"');
  });
  it('a second reference word ("that creature") leaves the pronoun to the unique-candidate rule: the card or the attacking creature, so manual', () => {
    expect(understood(`Whenever this creature attacks, ${LOOK} If it's a land card, you may put it onto the battlefield. If you don't put the card onto the battlefield, put it into your hand and that creature gets +1/+1 until end of turn.`, type)).toBe(false);
  });
  it('a sentence before it that is not understood: the rider is not understood either', () => {
    expect(understood(`Whenever this creature attacks, ${LOOK} If it's a land card, you may blorfty it. If you don't put the card onto the battlefield, put it into your hand.`, type)).toBe(false);
  });
  it('no instruction before it at all: unresolved', () => {
    expect(understood("If you don't put the card onto the battlefield, put it into your hand.", 'Sorcery')).toBe(false);
  });
});

describe('LOOK3: the shared helper (model/focus.ts#notPutMove) and the renderer agree with the parser', () => {
  const move = { op: 'move', what: bound('seen'), to: { zone: 'battlefield', controller: you }, as: 'moved' };
  const look = { op: 'look', who: you, at: { ref: 'topCards', player: you, count: 1 }, as: 'seen' };
  const offer = { op: 'if', cond: { cond: 'matches', object: bound('seen'), filter: { types: ['Land'], isCard: true } }, then: [{ op: 'may', who: you, do: [move] }] };
  const rider = (step: string, what: unknown): Record<string, unknown> => ({ op: 'if', cond: { cond: 'did', step, not: true, to: 'battlefield' }, then: [{ op: 'move', what, to: { zone: 'hand' } }] });

  it('notPutMove finds the move through the `if` and the controller\'s own `may` only; notPutZone reads the condition before and after it is named', () => {
    expect(notPutMove(offer, 'battlefield')).toBe(move);
    expect(notPutMove(offer, 'hand')).toBeNull();
    expect(notPutMove({ ...offer, else: [] }, 'battlefield')).toBeNull();
    expect(notPutMove({ op: 'may', who: { ref: 'each', who: 'opponent' }, do: [move] }, 'battlefield')).toBeNull();
    expect(notPutMove({ op: 'may', who: you, do: [move, { op: 'draw', who: you, count: 1 }] }, 'battlefield')).toBeNull();
    expect(notPutMove({ op: 'may', who: you, do: [{ ...move, what: { ref: 'each', filter: { types: ['Land'] } } }] }, 'battlefield')).toBeNull();
    expect(notPutZone(rider('moved', bound('seen')))).toBe('battlefield');
    expect(notPutZone({ op: 'if', cond: { cond: 'did', step: '', $step: 'previous', not: true, to: 'hand' }, then: [] })).toBe('hand');
    expect(notPutZone({ op: 'if', cond: { cond: 'did', step: 'moved', to: 'hand' }, then: [] })).toBeUndefined();
  });

  // the creature that entered is a candidate of its own for a bare "it" (the object itself, named "~" in its own trigger, is a case the renderer settles otherwise)
  const enters: EventPattern = { ev: 'zoneChange', subject: { types: ['Creature'], controller: 'you', other: true }, to: 'battlefield' } as EventPattern;
  const ctx = { selfNames: ['Test Card'], selfTypes: ['Creature'] };
  const text = "Whenever another creature you control enters, look at the top card of your library. If it's a land card, you may put it onto the battlefield. If you don't put the card onto the battlefield, put it into your hand.";
  const def = (r: Record<string, unknown>): AbilityDef => trig([enters], [look, offer, r] as unknown as EffectStep[]);
  it('the renderer writes the rider\'s "it" for the card looked at (its focus), and the gate passes', () => {
    expect(passes(def(rider('moved', bound('seen'))), text, ctx)).toBe(true);
  });
  it('... and only for it: the creature that entered, or the card under a condition that names another step (no focus), is not "it" there', () => {
    expect(passes(def(rider('moved', { ref: 'event', role: 'subject' })), text, ctx)).toBe(false);
    expect(passes(def(rider('other', bound('seen'))), text, ctx)).toBe(false);
  });
});
