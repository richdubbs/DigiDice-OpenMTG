/**
 * T14 (FAST3 wave): the parser, anaphora and renderer changes the T14 shapes need, read on synthetic cards through the game's default compiler (wordings are
 * invented, design 6.10). Each change narrows by what the rules allow, never by a ranking; with two candidates left the sentence stays manual.
 *
 *   CR 118.12a   "unless they pay": the singular "they" for the player the instruction names (never for "each opponent ... unless they pay")
 *   CR 118.12a   the "unless" idiom: "[counter] X unless its controller pays": "its" is X
 *   CR 118.12a   "pays {1} for each artifact you control": `pay.times`, counted when the payment is made (CR 608.2h)
 *   CR 509.1     "blocks or becomes blocked by a creature, ... that creature": the event role `object`, the other combatant of each pattern
 *   CR 120.1     "a creature dealt damage by ~ this turn": the filter `dealtDamageBySourceThisTurn`
 *   CR 115.1     "from a single graveyard": `TargetSpec.sameOwner`; "target player ... target cards from their graveyard": the earlier target of the sentence
 *   CR 404.1     "target cards from graveyards", "all opponents' graveyards"; plural "and/or" types
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type OracleCard } from '../../../src/index';

const compiled = (text: string, type = 'Creature — Golem'): CardDef =>
  compileCard({ name: 'Test Subject', layout: 'normal', type_line: type, oracle_text: text, mana_cost: '{2}', colors: [], power: '2', toughness: '2' } as OracleCard as never);
const json = (d: CardDef): string => JSON.stringify(d.faces[0]!.abilities);
const manual = (d: CardDef): boolean => json(d).includes('"op":"manual"') || d.faces[0]!.abilities.some((a) => a.kind === 'manual');

describe('CR 118.12a: "... unless they pay {N}" names the player the instruction names', () => {
  it('"that player sacrifices a permanent of their choice unless they pay {1}": the payer is that player', () => {
    const d = compiled('Whenever an opponent casts a spell, that player sacrifices a permanent of their choice unless they pay {1}.', 'Enchantment');
    expect(manual(d)).toBe(false);
    expect(json(d)).toContain('"op":"pay","who":{"ref":"event","role":"player"}');
    expect(json(d)).toContain('"op":"sacrificeChoice","who":{"ref":"event","role":"player"}');
  });
  it('"target opponent sacrifices a creature of their choice unless they pay {3}" is automated', () => {
    expect(manual(compiled('Target opponent sacrifices a creature of their choice unless they pay {3}.', 'Sorcery'))).toBe(false);
  });
  // std-rx33 (CR 118.12a, 101.4): changed on purpose: eff.stdrx33.each.opponent.sacrifice.unless.they.pay reads it as one payment per opponent, in turn order
  // (std-mkm's punisher model, a forEach over the opponents), so each of them decides for themselves
  it('"each opponent sacrifices a permanent of their choice unless they pay {2}" is automated: for each opponent, that player pays or sacrifices', () => {
    const d = compiled('When ~ enters, each opponent sacrifices a permanent of their choice unless they pay {2}.');
    expect(manual(d)).toBe(false);
    expect(json(d)).toContain('"op":"forEach","over":{"ref":"each","who":"opponent"}');
  });
});

describe('CR 118.12a: the "unless" idiom, "[counter] X unless its controller pays"', () => {
  it('"counter that spell or ability unless its controller pays {2}": the spell or ability that targeted ~ and its controller', () => {
    const d = compiled('Whenever ~ becomes the target of a spell or ability an opponent controls, counter that spell or ability unless its controller pays {2}.');
    expect(manual(d)).toBe(false);
    expect(json(d)).toContain('"who":{"ref":"controllerOf","object":{"ref":"event","role":"spell"}}');
    expect(json(d)).toContain('"else":[{"op":"counter","what":{"ref":"event","role":"spell"}}]');
  });
  it('"counter target spell unless its controller pays {3}" is unchanged', () => {
    const d = compiled('Counter target spell unless its controller pays {3}.', 'Instant');
    expect(json(d)).toContain('"who":{"ref":"controllerOf","object":{"ref":"target","id":"t0"}}');
  });
  it('"counter that spell or ability" alone names the spell or ability', () => {
    expect(json(compiled('Whenever ~ becomes the target of a spell or ability an opponent controls, counter that spell or ability.'))).toContain('{"op":"counter","what":{"ref":"event","role":"spell"}}');
  });
});

describe('CR 118.12a, 608.2h: "unless its controller pays {1} for each artifact you control"', () => {
  it('the cost is paid once for each artifact, counted when the payment is made', () => {
    const d = compiled('Counter target spell unless its controller pays {1} for each artifact you control.', 'Instant');
    expect(manual(d)).toBe(false);
    expect(json(d)).toContain('"times":{"q":"count","of":{"ref":"each","filter":{"types":["Artifact"],"controller":"you"}}}');
  });
});

describe('CR 118.12: "unless you <cost>" (a cost that is not mana)', () => {
  it.each([
    ['When ~ enters, sacrifice it unless you discard a card.', '"kind":"discard","count":1'],
    ['When ~ enters, sacrifice it unless you exile a card from your graveyard.', '"kind":"exileFrom","zone":"graveyard","count":1'],
    ['When ~ enters, sacrifice it unless you return a non-Elf creature you control to its owner\'s hand.', '"kind":"returnToHand","filter":{"notSubtypes":["Elf"],"types":["Creature"],"controller":"you"}'],
    ['At the beginning of your upkeep, sacrifice ~ unless you pay {E}{E}{E}.', '"kind":"payEnergy","amount":3'],
  ])('%s', (text, part) => {
    const d = compiled(text);
    expect(manual(d)).toBe(false);
    expect(json(d)).toContain(part);
  });
  it('"unless you control a Forest" is a condition, not a cost: unchanged (no pay step)', () => {
    expect(json(compiled('When ~ enters, sacrifice it unless you control a Forest.'))).not.toContain('"op":"pay"');
  });
});

describe('CR 509.1, 603.7c: the other combatant of "blocks or becomes blocked by"', () => {
  it('"destroy that creature at end of combat": the event role `object`, fixed when the delayed trigger is created', () => {
    const d = compiled('Whenever ~ blocks or becomes blocked by a non-Wall creature, destroy that creature at end of combat.');
    expect(manual(d)).toBe(false);
    expect(json(d)).toContain('"do":[{"op":"destroy","what":{"ref":"event","role":"object"}}]');
  });
  it('"~ deals 2 damage to that creature" (no delay) too', () => {
    expect(json(compiled('Whenever ~ blocks or becomes blocked by a creature, ~ deals 2 damage to that creature.'))).toContain('"to":{"ref":"event","role":"object"}');
  });
  it('a bare "it" may be ~ itself: manual', () => {
    expect(manual(compiled('Whenever ~ blocks or becomes blocked by a creature, destroy it at end of combat.'))).toBe(true);
  });
  it('a lone pattern keeps its own role ("blocks a creature": the attacker; "becomes blocked by a Wall, destroy that Wall": the blocker)', () => {
    expect(json(compiled('Whenever ~ blocks a creature, destroy that creature at end of combat.'))).toContain('"what":{"ref":"event","role":"attacker"}');
    const wall = compiled('Whenever ~ becomes blocked by a Wall, destroy that Wall at end of combat.');
    expect(manual(wall)).toBe(false);
    expect(json(wall)).toContain('"what":{"ref":"event","role":"blocker"}');
  });
  it('"blocks or becomes blocked" with no other creature named: "that creature" has no antecedent (unchanged)', () => {
    expect(manual(compiled('Whenever ~ blocks or becomes blocked, destroy that creature at end of combat.'))).toBe(true);
  });
});

describe('CR 120.1, 400.7: "a creature dealt damage by ~ this turn"', () => {
  it('the trigger subject has `dealtDamageBySourceThisTurn`', () => {
    const d = compiled('Whenever a creature dealt damage by ~ this turn dies, put a +1/+1 counter on ~.');
    expect(manual(d)).toBe(false);
    expect(json(d)).toContain('"subject":{"types":["Creature"],"dealtDamageBySourceThisTurn":true}');
  });
  it('"a creature that was dealt damage this turn" is unchanged', () => {
    expect(json(compiled('Whenever a creature that was dealt damage this turn dies, you gain 1 life.'))).toContain('"dealtDamageThisTurn":true');
  });
});

describe('CR 115.1, 404.1: graveyard targets', () => {
  it('"up to three target cards from a single graveyard": one spec with `sameOwner`', () => {
    const d = compiled('Exile up to three target cards from a single graveyard.', 'Sorcery');
    expect(manual(d)).toBe(false);
    expect(json(d)).toContain('"filter":{"isCard":true,"zone":"graveyard"},"sameOwner":true');
  });
  it('"target card from a single graveyard" (one card) is not read: manual', () => {
    expect(manual(compiled('Exile target card from a single graveyard.', 'Sorcery'))).toBe(true);
  });
  it('"up to two target cards from graveyards": any graveyard, no restriction', () => {
    const d = compiled('Exile up to two target cards from graveyards.', 'Sorcery');
    expect(manual(d)).toBe(false);
    expect(json(d)).toContain('"filter":{"zone":"graveyard","isCard":true}');
    expect(json(d)).not.toContain('sameOwner');
  });
  it('"target player shuffles up to three target cards from their graveyard into their library": the cards\' owner is the target player (an earlier target of the sentence)', () => {
    const d = compiled('Target player shuffles up to three target cards from their graveyard into their library.', 'Sorcery');
    expect(manual(d)).toBe(false);
    expect(json(d)).toContain('"filter":{"zone":"graveyard","owner":{"ref":"target","id":"t0"},"isCard":true}');
  });
  it('a pronoun in a target phrase that has two candidates (an earlier target and the object itself) stays manual', () => {
    expect(manual(compiled('Whenever ~ becomes untapped, destroy target artifact you control and target creature an opponent controls that shares a color with it.'))).toBe(true);
  });
  it('"exile all opponents\' graveyards" and plural "and/or" types', () => {
    expect(manual(compiled("Exile all opponents' graveyards.", 'Sorcery'))).toBe(false);
    expect(manual(compiled('Return up to two target artifact and/or enchantment cards from your graveyard to your hand.', 'Sorcery'))).toBe(false);
    expect(manual(compiled('Destroy up to two target artifacts and/or enchantments.', 'Sorcery'))).toBe(false);
  });
});

describe('CR 401.2: libraries of other players', () => {
  it('"each opponent exiles the top card of their library": the top card of each opponent\'s library', () => {
    const d = compiled('Each opponent exiles the top card of their library.', 'Sorcery');
    expect(manual(d)).toBe(false);
    expect(json(d)).toContain('"what":{"ref":"topCards","player":{"ref":"each","who":"opponent"},"count":1}');
  });
  // p2-dig-1 (CR 401.4 "unless the effect says otherwise", 608.2d): the player who looked arranges them, not their owner: the destination's `arrangedBy` (was manual
  // here while the move had no way to say who arranges)
  it('"look at the top three cards of target player\'s library, then put them back in any order" is automated: YOU arrange them (arrangedBy you, CR 401.4)', () => {
    const d = compiled("Look at the top three cards of target player's library, then put them back in any order.", 'Sorcery');
    expect(manual(d)).toBe(false);
    expect(json(d)).toContain('"order":"chosen","arrangedBy":{"ref":"you"}');
  });
});
