/**
 * LOOK3 (a LOOK1 follow-up): "If you don't put the card onto the battlefield, put it into your hand." (zz-cloud/look3.json) is the negation of whether the move of the card
 * looked at was performed, so it answers the choice as well as the condition: a land you choose not to put onto the battlefield goes to your hand, which "Otherwise" (the
 * `else` of the condition alone, LOOK1) would leave on top. Played through the engine with synthetic cards compiled by the game's default compiler (invented names and
 * wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 608.2c            "Whenever this creature attacks, look at the top card of your library. If it's a land card, you may put it onto the battlefield. If you don't put the
 *                        card onto the battlefield, put it into your hand.": a land you decline goes to your hand; a land you put onto the battlefield does not; a nonland
 *                        card goes to your hand without a question (the move never ran); the attacking creature is not touched
 *   CR 701.20e, 608.2c   "Whenever another creature you control enters, ... you may put it onto the battlefield tapped. If you don't put it onto the battlefield, put it
 *                        into your hand.": the same with a tapped land, and the creature that entered is not touched
 *   CR 400.7, 608.2c     "... If it's an artifact card, you may put it into your hand. If you don't put the card into your hand, you may put it into your graveyard.": a card you
 *                        keep out of your hand is still the card on top, so it can go to your graveyard; a card you put into your hand is not asked about again
 *   CR 115.1, 608.2c     "You may put target creature card from your graveyard onto the battlefield. If you don't put it onto the battlefield, put it into your hand.": the
 *                        target, still in the graveyard, goes to your hand when you decline
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../src/index';
import { act, answer, find, findAll, pass, scenario } from '../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual (the parse itself is checked by look3-lowering.test.ts; an experimental template caps the level only, design 6.9). */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const ability = (d: CardDef): string => JSON.stringify(d.faces[0]!.abilities.find((a) => a.kind === 'triggered' || a.kind === 'spell'));
const topOf = (s: GameState, p: PlayerId): ObjectId | undefined => s.zones.library[p]![0]; // index 0 is the top (CR 401.5)
const names = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p: PlayerId = 'p1'): string[] => s.zones[zone][p]!.map((id) => s.objects[id]!.defId);

/** A run of the game with the number of "you may" questions it asked. */
interface Run { s: GameState; asked: number }
type Target = { kind: 'object'; id: ObjectId };

/** Answer the decisions that come up until priority: payments automatic, targets in order, the n-th "you may" with `answers[n]` (the last answer repeats). */
function drive(r: Run, answers: readonly boolean[], targets: Target[][] = []): Run {
  let { s, asked } = r;
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.shift() ?? [] });
    else if (p.kind === 'yesNo') {
      s = answer(s, { kind: 'yesNo', yes: answers[Math.min(asked, answers.length - 1)] ?? true });
      asked++;
    } else throw new Error(`unexpected decision ${p.kind}`);
  }
  return { s, asked };
}
function resolveAll(r0: Run, answers: readonly boolean[]): Run {
  let r = r0;
  for (let i = 0; i < 16 && r.s.zones.stack.length > 0; i++) r = drive({ ...r, s: pass(pass(r.s)) }, answers);
  return r;
}
/** Pass priority to the declare-attackers decision, declare `attacker` attacking p2, and let the attack triggers resolve. */
function attack(s0: GameState, attacker: ObjectId, answers: readonly boolean[]): Run {
  let r: Run = { s: s0, asked: 0 };
  for (let i = 0; i < 60 && r.s.pending?.kind !== 'declareAttackers'; i++) r = r.s.pending?.kind === 'priority' ? { ...r, s: pass(r.s) } : drive(r, answers);
  r = { ...r, s: answer(r.s, { kind: 'declareAttackers', attacks: [{ attacker, defender: 'p2' }] }) };
  return resolveAll(drive(r, answers), answers);
}
/** Cast the named card from p1's hand (with its targets) and let everything that goes on the stack resolve. */
const cast = (s: GameState, name: string, answers: readonly boolean[], targets: Target[][] = []): Run =>
  resolveAll(drive({ s: act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), asked: 0 }, answers, targets), answers);

const GROVE = card('Test Grove', 'Land', '');
const IDOL = card('Test Idol', 'Artifact', '', { cost: '{2}' });
const PUP = card('Test Pup', 'Creature — Dog', '', { pt: ['1', '1'] });

describe('CR 608.2c: "Whenever this creature attacks, look at the top card of your library. If it\'s a land card, you may put it onto the battlefield. If you don\'t put the card onto the battlefield, put it into your hand."', () => {
  const PATHFINDER = card('Test Pathfinder', 'Creature — Human Scout', "Whenever this creature attacks, look at the top card of your library. If it's a land card, you may put it onto the battlefield. If you don't put the card onto the battlefield, put it into your hand.", { pt: ['2', '2'] });
  const DEFS = [PATHFINDER, GROVE, IDOL];
  const start = (library: string[]): GameState => scenario([], { defs: DEFS, p1: { battlefield: [{ name: 'Test Pathfinder', since: 0 }], library } });

  it('is understood: the condition reads the move of the card looked at, negated, and the rider moves that card, never the attacking creature', () => {
    expect(noManual(PATHFINDER)).toBe(true);
    const j = ability(PATHFINDER);
    expect(j).toMatch(/"op":"look"[^]*"as":"(\w+)"[^]*"op":"move","what":\{"ref":"bound","name":"\1"\},"to":\{"zone":"battlefield"[^]*?"as":"(\w+)"[^]*"cond":\{"cond":"did","step":"\2","not":true,"to":"battlefield"\},"then":\[\{"op":"move","what":\{"ref":"bound","name":"\1"\},"to":\{"zone":"hand"\}\}\]/);
    expect(j).not.toContain('"ref":"event"');
  });

  it('CR 608.2c: a land on top that you put onto the battlefield enters, and nothing goes to your hand', () => {
    const s0 = start(['Test Grove', 'Test Idol']);
    const { s, asked } = attack(s0, find(s0, 'Test Pathfinder', 'battlefield', 'p1'), [true]);
    expect(asked).toBe(1);
    const grove = findAll(s, 'Test Grove', 'battlefield', 'p1');
    expect(grove).toHaveLength(1);
    expect(s.objects[grove[0]!]!.tapped).toBe(false);
    expect(names(s, 'hand')).toEqual([]);
    expect(names(s, 'library')[0]).toBe('Test Idol');
  });

  it('CR 608.2c: a land on top that you choose NOT to put onto the battlefield goes to your hand (the move was not performed; "Otherwise" would leave it on top)', () => {
    const s0 = start(['Test Grove', 'Test Idol']);
    const { s, asked } = attack(s0, find(s0, 'Test Pathfinder', 'battlefield', 'p1'), [false]);
    expect(asked).toBe(1);
    expect(names(s, 'hand')).toEqual(['Test Grove']);
    expect(findAll(s, 'Test Grove', 'battlefield', 'p1')).toHaveLength(0);
    expect(names(s, 'library')[0]).toBe('Test Idol');
  });

  it('CR 608.2c, 603.4: a nonland card on top goes to your hand without a question (the condition was false, so the move never ran)', () => {
    const s0 = start(['Test Idol', 'Test Grove']);
    const before = [...s0.zones.battlefield];
    const { s, asked } = attack(s0, find(s0, 'Test Pathfinder', 'battlefield', 'p1'), [true]);
    expect(asked).toBe(0);
    expect(names(s, 'hand')).toEqual(['Test Idol']);
    expect(names(s, 'library')[0]).toBe('Test Grove');
    expect(s.zones.battlefield).toEqual(before);
  });

  it('CR 701.20e: the rider moves the card looked at; the attacking creature stays on the battlefield, attacking', () => {
    const s0 = start(['Test Grove']);
    const pathfinder = find(s0, 'Test Pathfinder', 'battlefield', 'p1');
    const { s } = attack(s0, pathfinder, [false]);
    expect(s.zones.battlefield).toContain(pathfinder);
    expect(s.combat?.attackers.map((a) => a.id)).toEqual([pathfinder]);
    expect(names(s, 'hand')).toEqual(['Test Grove']);
  });
});

describe('CR 701.20e, 608.2c: "Whenever another creature you control enters, ... you may put it onto the battlefield tapped. If you don\'t put it onto the battlefield, put it into your hand."', () => {
  const KEEPER = card('Test Reefkeeper', 'Creature — Turtle', "Whenever another creature you control enters, look at the top card of your library. If it's a land card, you may put it onto the battlefield tapped. If you don't put it onto the battlefield, put it into your hand.", { pt: ['1', '4'] });
  const DEFS = [KEEPER, PUP, GROVE, IDOL];
  const start = (library: string[]): GameState => scenario([], { defs: DEFS, p1: { battlefield: ['Test Reefkeeper'], hand: ['Test Pup'], library } });

  it('is understood, and the rider moves the card looked at, never the creature that entered', () => {
    expect(noManual(KEEPER)).toBe(true);
    expect(ability(KEEPER)).not.toContain('"role":"subject"');
  });

  it('a land you put onto the battlefield enters tapped; your hand stays empty', () => {
    const { s, asked } = cast(start(['Test Grove']), 'Test Pup', [true]);
    expect(asked).toBe(1);
    const grove = findAll(s, 'Test Grove', 'battlefield', 'p1');
    expect(grove).toHaveLength(1);
    expect(s.objects[grove[0]!]!.tapped).toBe(true);
    expect(names(s, 'hand')).toEqual([]);
  });

  it('CR 608.2c: a land you decline goes to your hand; the creature that entered stays on the battlefield', () => {
    const { s, asked } = cast(start(['Test Grove']), 'Test Pup', [false]);
    expect(asked).toBe(1);
    expect(names(s, 'hand')).toEqual(['Test Grove']);
    expect(findAll(s, 'Test Pup', 'battlefield', 'p1')).toHaveLength(1);
  });

  it('a nonland card goes to your hand', () => {
    const { s, asked } = cast(start(['Test Idol']), 'Test Pup', [true]);
    expect(asked).toBe(0);
    expect(names(s, 'hand')).toEqual(['Test Idol']);
  });
});

describe('CR 400.7, 608.2c: "... If it\'s an artifact card, you may put it into your hand. If you don\'t put the card into your hand, you may put it into your graveyard."', () => {
  const ARCHIVIST = card('Test Archivist', 'Creature — Human Wizard', "Whenever another creature you control enters, look at the top card of your library. If it's an artifact card, you may put it into your hand. If you don't put the card into your hand, you may put it into your graveyard.", { pt: ['1', '1'] });
  const DEFS = [ARCHIVIST, PUP, GROVE, IDOL];
  const start = (library: string[]): GameState => scenario([], { defs: DEFS, p1: { battlefield: ['Test Archivist'], hand: ['Test Pup'], library } });

  it('is understood (eff.look3.ifNotPut.hand is stable since the merge with Cloud std-fin, PR #12: its tuning cards read the sentence before it; see look3-templates.test.ts)', () => {
    expect(noManual(ARCHIVIST)).toBe(true);
  });

  it('an artifact you put into your hand is not asked about again', () => {
    const { s, asked } = cast(start(['Test Idol', 'Test Grove']), 'Test Pup', [true]);
    expect(asked).toBe(1);
    expect(names(s, 'hand')).toEqual(['Test Idol']);
    expect(names(s, 'graveyard')).toEqual([]);
  });

  it('CR 400.7: an artifact you keep out of your hand is still the card on top, and it can go to your graveyard', () => {
    const { s, asked } = cast(start(['Test Idol', 'Test Grove']), 'Test Pup', [false, true]);
    expect(asked).toBe(2);
    expect(names(s, 'hand')).toEqual([]);
    expect(names(s, 'graveyard')).toEqual(['Test Idol']);
    expect(names(s, 'library')[0]).toBe('Test Grove');
  });

  it('CR 608.2c: a nonartifact card is offered to your graveyard only; declined, it stays on top', () => {
    const into = cast(start(['Test Grove', 'Test Idol']), 'Test Pup', [true]);
    expect(into.asked).toBe(1);
    expect(names(into.s, 'graveyard')).toEqual(['Test Grove']);
    const kept = start(['Test Grove', 'Test Idol']);
    const grove = topOf(kept, 'p1');
    const left = cast(kept, 'Test Pup', [false]);
    expect(left.asked).toBe(1);
    expect(topOf(left.s, 'p1')).toBe(grove);
    expect(names(left.s, 'hand')).toEqual([]);
  });
});

describe('CR 115.1, 608.2c: "You may put target creature card from your graveyard onto the battlefield. If you don\'t put it onto the battlefield, put it into your hand."', () => {
  const RECALL = card('Test Recall', 'Sorcery', "You may put target creature card from your graveyard onto the battlefield. If you don't put it onto the battlefield, put it into your hand.");
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const DEFS = [RECALL, BEAR];
  const start = (): GameState => scenario([], { defs: DEFS, p1: { hand: ['Test Recall'], graveyard: ['Test Bear'] } });

  it('is understood', () => expect(noManual(RECALL)).toBe(true));

  it('the target you put onto the battlefield enters; nothing goes to your hand', () => {
    const s0 = start();
    const { s, asked } = cast(s0, 'Test Recall', [true], [[{ kind: 'object', id: find(s0, 'Test Bear', 'graveyard', 'p1') }]]);
    expect(asked).toBe(1);
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1')).toHaveLength(1);
    expect(names(s, 'hand')).toEqual([]);
  });

  it('CR 608.2c: the target you decline goes from your graveyard to your hand', () => {
    const s0 = start();
    const { s, asked } = cast(s0, 'Test Recall', [false], [[{ kind: 'object', id: find(s0, 'Test Bear', 'graveyard', 'p1') }]]);
    expect(asked).toBe(1);
    expect(names(s, 'hand')).toEqual(['Test Bear']);
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1')).toHaveLength(0);
    expect(names(s, 'graveyard')).toEqual(['Test Recall']);
  });
});
