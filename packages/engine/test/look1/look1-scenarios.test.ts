/**
 * LOOK1 (found by cloud slice std-blb): the one card a player looked at on top of a library is what the next sentence's "it" names, never the object of the trigger's
 * event. Before, a look at one top card added no mention, so "it" fell back to the trigger's object: "If it's a land card" asked whether the ATTACKING object was a land
 * card, and the land on top was never put onto the battlefield (Explorer's Scope, Raiders' Karve, Mobile Homestead). The discourse model now names the card
 * (parser/lower/mentions.ts#producedBy) and the focus rule says that a bare "it" right after the look is that card (model/focus.ts#looksAtOneCard,
 * parser/lower/anaphora.ts#focusAt, render/steps.ts#clausesOf). Played through the engine with synthetic cards compiled by the game's default compiler (invented names
 * and wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 701.20e, 608.2c   "Whenever this creature attacks, look at the top card of your library. If it's a land card, you may put it onto the battlefield.": the land on top
 *                        is put onto the battlefield, a nonland card stays on top, and the attacking creature is not touched
 *   CR 603.4, 608.2c     the "if" of the second sentence is no intervening "if" (only an "if" right after the trigger condition is): it is checked as the ability
 *                        resolves, after the look, and it reads the card looked at
 *   CR 305.4             putting a land onto the battlefield this way is not playing a land
 *   CR 701.20e, 608.2c   "Whenever another creature you control enters, look at the top card ... If it's a land card, you may put it onto the battlefield tapped.": the land
 *                        enters tapped; the creature that entered is not touched
 *   CR 608.2c            "... Otherwise, put it into your hand.": the `else` of that condition moves the card looked at (a nonland card goes to your hand), and a land you
 *                        choose not to put onto the battlefield stays on top (lower/anaphora.ts#elseFocus)
 *   CR 701.20e, 406.3    "... look at the top card of that player's library, then exile it face down." (the look idiom, lower/anaphora.ts#lookIdiom): that card is exiled
 *                        face down, never the creature that dealt the damage
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../src/index';
import { act, answer, find, findAll, pass, scenario } from '../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual (the parse itself is checked by look1-anaphora.test.ts). */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const trigger = (d: CardDef): string => JSON.stringify(d.faces[0]!.abilities.find((a) => a.kind === 'triggered'));
const topOf = (s: GameState, p: PlayerId): ObjectId | undefined => s.zones.library[p]![0]; // index 0 is the top (CR 401.5)
const libraryNames = (s: GameState, p: PlayerId): string[] => s.zones.library[p]!.map((id) => s.objects[id]!.defId);

/** A run of the game with the number of "you may" questions it asked. */
interface Run { s: GameState; asked: number }

/** Answer the decisions that come up until priority: payments automatic, every "you may" with `yes`. */
function drive(r: Run, yes: boolean): Run {
  let { s, asked } = r;
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') {
      asked++;
      s = answer(s, { kind: 'yesNo', yes } as DecisionAnswer);
    } else throw new Error(`unexpected decision ${p.kind}`);
  }
  return { s, asked };
}
function resolveAll(r0: Run, yes: boolean): Run {
  let r = r0;
  for (let i = 0; i < 16 && r.s.zones.stack.length > 0; i++) r = drive({ ...r, s: pass(pass(r.s)) }, yes);
  return r;
}
/** Pass priority to the declare-attackers decision, declare `attacker` attacking p2, and let the attack triggers resolve. */
function attack(s0: GameState, attacker: ObjectId, yes = true): Run {
  let r: Run = { s: s0, asked: 0 };
  for (let i = 0; i < 60 && r.s.pending?.kind !== 'declareAttackers'; i++) r = r.s.pending?.kind === 'priority' ? { ...r, s: pass(r.s) } : drive(r, yes);
  r = { ...r, s: answer(r.s, { kind: 'declareAttackers', attacks: [{ attacker, defender: 'p2' }] }) };
  return resolveAll(drive(r, yes), yes);
}
/** Cast the named card from p1's hand and let everything that goes on the stack resolve. */
const cast = (s: GameState, name: string, yes = true): Run => resolveAll(drive({ s: act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), asked: 0 }, yes), yes);

const GROVE = card('Test Grove', 'Land', '');
const IDOL = card('Test Idol', 'Artifact', '', { cost: '{2}' });

describe('CR 701.20e, 608.2c: "Whenever this creature attacks, look at the top card of your library. If it\'s a land card, you may put it onto the battlefield."', () => {
  const SCOUT = card('Test Pathscout', 'Creature — Human Scout', "Whenever this creature attacks, look at the top card of your library. If it's a land card, you may put it onto the battlefield.", { pt: ['2', '2'] });
  const DEFS = [SCOUT, GROVE, IDOL];

  it('is understood, and "it" is the card looked at (a bound name of the look), never the attacking creature', () => {
    expect(noManual(SCOUT)).toBe(true);
    const j = trigger(SCOUT);
    expect(j).toMatch(/"op":"look"[^]*"as":"(\w+)"[^]*"cond":"matches","object":\{"ref":"bound","name":"\1"\}[^]*"op":"move","what":\{"ref":"bound","name":"\1"\}/);
    expect(j).not.toContain('"ref":"event"');
    expect(j).not.toContain('"ref":"self"');
  });

  it('CR 701.20e, 608.2c: a land on top is put onto the battlefield (untapped, under your control); the attacking creature stays where it is', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: [{ name: 'Test Pathscout', since: 0 }], library: ['Test Grove'] } });
    const scout = find(s0, 'Test Pathscout', 'battlefield', 'p1');
    const size = s0.zones.library.p1!.length;
    const { s, asked } = attack(s0, scout);
    expect(asked).toBe(1);
    const grove = findAll(s, 'Test Grove', 'battlefield', 'p1');
    expect(grove).toHaveLength(1);
    expect(s.objects[grove[0]!]!.controller).toBe('p1');
    expect(s.objects[grove[0]!]!.tapped).toBe(false);
    expect(libraryNames(s, 'p1')).not.toContain('Test Grove');
    expect(s.zones.library.p1!.length).toBe(size - 1);
    expect(s.zones.battlefield).toContain(scout);
    expect(s.combat?.attackers.map((a) => a.id)).toEqual([scout]);
  });

  it('CR 305.4: the land put onto the battlefield this way is not the land played this turn', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: [{ name: 'Test Pathscout', since: 0 }], library: ['Test Grove'] } });
    const { s } = attack(s0, find(s0, 'Test Pathscout', 'battlefield', 'p1'));
    expect(findAll(s, 'Test Grove', 'battlefield', 'p1')).toHaveLength(1);
    expect(s.players.find((p) => p.id === 'p1')!.landsPlayedThisTurn).toBe(0);
  });

  it('CR 603.4, 608.2c: a nonland card on top is checked as the ability resolves and stays on top; nothing is asked and nothing enters', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: [{ name: 'Test Pathscout', since: 0 }], library: ['Test Idol', 'Test Grove'] } });
    const idol = topOf(s0, 'p1')!;
    const before = [...s0.zones.battlefield];
    const { s, asked } = attack(s0, find(s0, 'Test Pathscout', 'battlefield', 'p1'));
    expect(asked).toBe(0);
    expect(topOf(s, 'p1')).toBe(idol);
    expect(libraryNames(s, 'p1').slice(0, 2)).toEqual(['Test Idol', 'Test Grove']);
    expect(s.zones.battlefield).toEqual(before);
  });

  it('CR 608.2c: "you may": a land on top that you choose not to put onto the battlefield stays on top', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: [{ name: 'Test Pathscout', since: 0 }], library: ['Test Grove'] } });
    const grove = topOf(s0, 'p1')!;
    const { s, asked } = attack(s0, find(s0, 'Test Pathscout', 'battlefield', 'p1'), false);
    expect(asked).toBe(1);
    expect(topOf(s, 'p1')).toBe(grove);
    expect(findAll(s, 'Test Grove', 'battlefield', 'p1')).toHaveLength(0);
  });
});

describe('CR 701.20e, 608.2c: "Whenever another creature you control enters, look at the top card of your library. If it\'s a land card, you may put it onto the battlefield tapped."', () => {
  const KEEPER = card('Test Shellkeeper', 'Creature — Turtle', "Whenever another creature you control enters, look at the top card of your library. If it's a land card, you may put it onto the battlefield tapped.", { pt: ['1', '4'] });
  const PUP = card('Test Pup', 'Creature — Dog', '', { pt: ['1', '1'] });
  const DEFS = [KEEPER, PUP, GROVE, IDOL];

  it('is understood, and "it" is the card looked at, never the creature that entered', () => {
    expect(noManual(KEEPER)).toBe(true);
    const j = trigger(KEEPER);
    expect(j).toMatch(/"op":"look"[^]*"as":"(\w+)"[^]*"object":\{"ref":"bound","name":"\1"\}[^]*"what":\{"ref":"bound","name":"\1"\}/);
    expect(j).not.toContain('"role":"subject"');
  });

  it('a land on top enters the battlefield tapped; the creature that entered is untapped and untouched', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Shellkeeper'], hand: ['Test Pup'], library: ['Test Grove'] } });
    const { s, asked } = cast(s0, 'Test Pup');
    expect(asked).toBe(1);
    const grove = findAll(s, 'Test Grove', 'battlefield', 'p1');
    expect(grove).toHaveLength(1);
    expect(s.objects[grove[0]!]!.tapped).toBe(true);
    const pup = findAll(s, 'Test Pup', 'battlefield', 'p1');
    expect(pup).toHaveLength(1);
    expect(s.objects[pup[0]!]!.tapped).toBe(false);
  });

  it('a nonland card on top stays on top', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Shellkeeper'], hand: ['Test Pup'], library: ['Test Idol'] } });
    const idol = topOf(s0, 'p1')!;
    const { s, asked } = cast(s0, 'Test Pup');
    expect(asked).toBe(0);
    expect(topOf(s, 'p1')).toBe(idol);
    expect(findAll(s, 'Test Pup', 'battlefield', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Test Idol', 'battlefield', 'p1')).toHaveLength(0);
  });
});

describe('CR 608.2c, 701.20e: "... If it\'s a land card, you may put it onto the battlefield tapped. Otherwise, put it into your hand." ("Otherwise" is the `else` of that condition)', () => {
  const KEEPER = card('Test Burrowkeeper', 'Creature — Turtle', "Whenever another creature you control enters, look at the top card of your library. If it's a land card, you may put it onto the battlefield tapped. Otherwise, put it into your hand.", { pt: ['1', '4'] });
  const PUP = card('Test Pup', 'Creature — Dog', '', { pt: ['1', '1'] });
  const DEFS = [KEEPER, PUP, GROVE, IDOL];
  const handNames = (s: GameState): string[] => s.zones.hand.p1!.map((id) => s.objects[id]!.defId);

  it('is understood: both branches move the card looked at, never the creature that entered', () => {
    expect(noManual(KEEPER)).toBe(true);
    const j = trigger(KEEPER);
    expect(j).toMatch(/"else":\[\{"op":"move","what":\{"ref":"bound","name":"(\w+)"\},"to":\{"zone":"hand"\}\}\]/);
    expect(j).not.toContain('"role":"subject"');
  });

  it('a land on top enters the battlefield tapped and nothing goes to your hand', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Burrowkeeper'], hand: ['Test Pup'], library: ['Test Grove', 'Test Idol'] } });
    const { s, asked } = cast(s0, 'Test Pup');
    expect(asked).toBe(1);
    const grove = findAll(s, 'Test Grove', 'battlefield', 'p1');
    expect(grove).toHaveLength(1);
    expect(s.objects[grove[0]!]!.tapped).toBe(true);
    expect(handNames(s)).toEqual([]);
    expect(libraryNames(s, 'p1')[0]).toBe('Test Idol');
  });

  it('CR 608.2c: a nonland card on top is put into your hand (the `else` of the condition)', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Burrowkeeper'], hand: ['Test Pup'], library: ['Test Idol', 'Test Grove'] } });
    const { s, asked } = cast(s0, 'Test Pup');
    expect(asked).toBe(0);
    expect(handNames(s)).toEqual(['Test Idol']);
    expect(libraryNames(s, 'p1')[0]).toBe('Test Grove');
    expect(findAll(s, 'Test Pup', 'battlefield', 'p1')).toHaveLength(1);
  });

  it('CR 608.2c: "Otherwise" answers the condition, not the choice: a land you choose not to put onto the battlefield stays on top', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Burrowkeeper'], hand: ['Test Pup'], library: ['Test Grove'] } });
    const grove = topOf(s0, 'p1')!;
    const { s, asked } = cast(s0, 'Test Pup', false);
    expect(asked).toBe(1);
    expect(topOf(s, 'p1')).toBe(grove);
    expect(handNames(s)).toEqual([]);
  });
});

/** Play on from an attack until combat damage has been dealt (no blocks), letting what it triggers resolve. */
function toDamage(r0: Run): Run {
  let r = r0;
  for (let i = 0; i < 60 && r.s.turn.step !== 'endCombat' && r.s.turn.step !== 'main2'; i++) {
    const d = r.s.pending;
    if (d?.kind === 'declareBlockers') r = { ...r, s: answer(r.s, { kind: 'declareBlockers', blocks: [] }) };
    else if (d?.kind === 'priority') r = r.s.zones.stack.length > 0 ? resolveAll(r, true) : { ...r, s: pass(r.s) };
    else r = drive(r, true);
  }
  return r;
}

describe('CR 701.20e, 608.2c, 406.3: "Whenever this creature deals combat damage to a player, look at the top card of that player\'s library, then exile it face down." (the look idiom)', () => {
  const SPY = card('Test Tunnel Spy', 'Creature — Rat Rogue', "Whenever this creature deals combat damage to a player, look at the top card of that player's library, then exile it face down.", { pt: ['1', '1'] });
  const DEFS = [SPY, GROVE, IDOL];

  it('is understood, and "it" is the card looked at, never the creature that dealt the damage', () => {
    expect(noManual(SPY)).toBe(true);
    const j = trigger(SPY);
    expect(j).toMatch(/"op":"move","what":\{"ref":"bound","name":"(\w+)"\},"to":\{"zone":"exile","faceDown":true\}/);
    expect(j).not.toContain('"role":"source"');
  });

  it('the top card of the damaged player\'s library is exiled face down; the creature stays on the battlefield', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: [{ name: 'Test Tunnel Spy', since: 0 }] }, p2: { library: ['Test Idol', 'Test Grove'] } });
    const spy = find(s0, 'Test Tunnel Spy', 'battlefield', 'p1');
    const idol = topOf(s0, 'p2')!;
    const { s } = toDamage(attack(s0, spy));
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(19);
    expect(libraryNames(s, 'p2')[0]).toBe('Test Grove');
    expect(libraryNames(s, 'p2')).not.toContain('Test Idol');
    const exiled = s.zones.exile.filter((id) => s.objects[id]!.defId === 'Test Idol');
    expect(exiled).toHaveLength(1);
    expect(s.objects[exiled[0]!]!.faceDown).toBe(true);
    expect(exiled[0]).not.toBe(idol); // CR 400.7: a new object in exile
    expect(s.zones.battlefield).toContain(spy);
  });
});
