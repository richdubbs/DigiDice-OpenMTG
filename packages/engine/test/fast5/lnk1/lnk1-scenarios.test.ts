/**
 * FAST5 LNK1: "that player" bound to exactly the player another ability (or an earlier sentence of the same ability) chose or targeted. The four cards FAST4 T34
 * moved full -> partial because they played wrong (STATUS "Wave FAST4" gap 1), played through the engine with their Oracle text (mana costs set to {0} so the
 * scenarios need no lands; the cost is not what is tested).
 *
 *   CR 607.1, 603.3a, 608.2b  Laquatus's Champion, Soul Scourge: "When this creature leaves the battlefield, that player gains N life" gives the life to the player
 *                             the enters ability targeted and affected, never to the controller; nothing when that ability never resolved (the link is empty)
 *   CR 400.7                  a new object (the creature that came back) has no link: its own leaves ability gives nothing for the old object's target
 *   CR 608.2c, 608.2h         Dalek Drone: "destroy target creature an opponent controls. That player loses 3 life." the creature's controller (last known
 *                             information once destroyed; also when it is not destroyed); nothing when the target is illegal (CR 608.2b)
 *   CR 400.3, 608.2c          Dinrova Horror: "return target permanent to its owner's hand, then that player discards a card." the permanent's owner discards
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { choicePrompt } from '../../../src/effects/handlers/choose';
import { act, answer, battlefieldNames, find, life, pass, scenario, zoneNames } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated, and the card full. */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });

/** Answer the decisions that come up: target groups from `targets` (one list per group, in order), then `answers`; pay costs automatically; stop at priority. */
function settle(s0: GameState, targets: TargetChoice[][] = [], answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const groups = [...targets];
  const queue = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 30; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets' && groups.length > 0) s = answer(s, { kind: 'chooseTargets', targets: groups.shift()! });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
/** Both players pass: the top of the stack resolves; then the decisions that come up (the targets of a trigger it put on the stack, ...). */
const resolve = (s: GameState, targets: TargetChoice[][] = [], answers: DecisionAnswer[] = []): GameState => settle(pass(pass(s)), targets, answers);
const cast = (s0: GameState, name: string, targets: TargetChoice[][] = []): GameState =>
  settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), targets);

const CHAMPION = card("Laquatus's Champion", 'Creature — Nightmare Horror',
  'When this creature enters, target player loses 6 life.\nWhen this creature leaves the battlefield, that player gains 6 life.\n{B}: Regenerate this creature.', ['6', '3']);
const SCOURGE = card('Soul Scourge', 'Creature — Nightmare Horror',
  'Flying\nWhen this creature enters, target player loses 3 life.\nWhen this creature leaves the battlefield, that player gains 3 life.', ['3', '2']);
const DALEK = card('Dalek Drone', 'Artifact Creature — Dalek',
  'Flying, menace\nExterminate! — When this creature enters, destroy target creature an opponent controls. That player loses 3 life.', ['3', '3']);
const DINROVA = card('Dinrova Horror', 'Creature — Horror', "When this creature enters, return target permanent to its owner's hand, then that player discards a card.", ['4', '4']);
const EXILE = card('Test Banishment', 'Instant', 'Exile target creature.');
const FLICKER = card('Test Blink', 'Instant', "Exile target creature you control, then return that card to the battlefield under its owner's control.");
const ELF = card('Test Elf', 'Creature — Elf', '', ['2', '2']);
const WALL = card('Test Ward Wall', 'Creature — Wall', 'Indestructible', ['0', '4']);
const ROCK = card('Test Rock', 'Artifact', '');
const DEFS = [CHAMPION, SCOURGE, DALEK, DINROVA, EXILE, FLICKER, ELF, WALL, ROCK];

describe('the four cards are full again (STATUS "Wave FAST4" gap 1)', () => {
  it("Laquatus's Champion, Soul Scourge, Dalek Drone, Dinrova Horror", () => {
    for (const d of [CHAMPION, SCOURGE, DALEK, DINROVA]) expect(full(d), d.name).toBe(true);
  });
  it('the linked pair: the enters ability remembers its target (TargetSpec.link), the leaves ability reads it ({ref:"linked"})', () => {
    const [enters, leaves] = CHAMPION.faces[0]!.abilities;
    expect(JSON.stringify(enters)).toContain('"link":"targetedPlayer"');
    expect(JSON.stringify(leaves)).toContain('{"ref":"linked","link":"targetedPlayer"}');
  });
});

describe("CR 607.1: Laquatus's Champion and Soul Scourge give the life back to the player the enters ability targeted", () => {
  it('the targeted opponent loses 6, then gains 6 when the creature leaves; its controller gains nothing', () => {
    const s0 = scenario([], { p1: { hand: ["Laquatus's Champion", 'Test Banishment'] }, defs: DEFS });
    let s = resolve(cast(s0, "Laquatus's Champion"), [[player('p2')]]); // the creature resolves; its enters ability targets p2
    s = resolve(s);
    expect(life(s, 'p2')).toBe(14);
    const champ = find(s, "Laquatus's Champion", 'battlefield', 'p1');
    s = resolve(cast(s, 'Test Banishment', [[obj(champ)]])); // exiled: the leaves ability triggers
    s = resolve(s);
    expect(life(s, 'p2')).toBe(20);
    expect(life(s, 'p1')).toBe(20);
  });
  it('a player who targets themself loses and regains their own life (Soul Scourge)', () => {
    const s0 = scenario([], { p1: { hand: ['Soul Scourge', 'Test Banishment'] }, defs: DEFS });
    let s = resolve(resolve(cast(s0, 'Soul Scourge'), [[player('p1')]]));
    expect(life(s, 'p1')).toBe(17);
    s = resolve(resolve(cast(s, 'Test Banishment', [[obj(find(s, 'Soul Scourge', 'battlefield', 'p1'))]])));
    expect(life(s, 'p1')).toBe(20);
    expect(life(s, 'p2')).toBe(20);
  });
  it('the creature leaves before its enters ability resolves: the leaves ability finds no player and does nothing; the loss still happens', () => {
    const s0 = scenario([], { p1: { hand: ["Laquatus's Champion", 'Test Banishment'] }, defs: DEFS });
    let s = resolve(cast(s0, "Laquatus's Champion"), [[player('p2')]]); // the enters ability is on the stack
    s = cast(s, 'Test Banishment', [[obj(find(s, "Laquatus's Champion", 'battlefield', 'p1'))]]);
    s = resolve(s); // the exile resolves; the leaves ability goes on the stack above the enters ability
    s = resolve(s); // the leaves ability: nothing is linked yet (CR 607.1)
    expect(life(s, 'p2')).toBe(20);
    expect(life(s, 'p1')).toBe(20);
    s = resolve(s); // the enters ability: the creature is gone, the target is still legal (CR 608.2b)
    expect(life(s, 'p2')).toBe(14);
    expect(life(s, 'p1')).toBe(20);
  });
  it('CR 400.7: the creature that comes back is a new object; its own leaves ability reads only its own enters ability', () => {
    const s0 = scenario([], { p1: { hand: ['Soul Scourge', 'Test Blink', 'Test Banishment'] }, defs: DEFS });
    let s = resolve(resolve(cast(s0, 'Soul Scourge'), [[player('p2')]]));
    expect(life(s, 'p2')).toBe(17);
    // flickered: the old object's leaves ability gives p2 the 3 life back; the new object's enters ability targets p1
    s = resolve(cast(s, 'Test Blink', [[obj(find(s, 'Soul Scourge', 'battlefield', 'p1'))]]));
    // both abilities trigger in the one resolution (CR 603.3b: their controller orders them; the leaves ability on top resolves first)
    for (let guard = 0; guard < 8 && (s.zones.stack.length > 0 || (s.pending !== null && s.pending.kind !== 'priority')); guard++) {
      if (s.pending?.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
      else if (s.pending?.kind === 'chooseTargets') s = settle(s, [[player('p1')]]);
      else s = resolve(s);
    }
    expect(life(s, 'p2')).toBe(20);
    expect(life(s, 'p1')).toBe(17);
    // the new object leaves: only ITS target (p1) gains the life
    s = resolve(resolve(cast(s, 'Test Banishment', [[obj(find(s, 'Soul Scourge', 'battlefield', 'p1'))]])));
    expect(life(s, 'p1')).toBe(20);
    expect(life(s, 'p2')).toBe(20);
  });
});

describe('CR 608.2c: Dalek Drone, "destroy target creature an opponent controls. That player loses 3 life."', () => {
  it("the creature's controller loses the life (last known information once it is destroyed); the Drone's controller does not", () => {
    const s0 = scenario([], { p1: { hand: ['Dalek Drone'] }, p2: { battlefield: ['Test Elf'] }, defs: DEFS });
    const elf = find(s0, 'Test Elf', 'battlefield', 'p2');
    const s = resolve(resolve(cast(s0, 'Dalek Drone'), [[obj(elf)]]));
    expect(battlefieldNames(s, 'p2')).not.toContain('Test Elf');
    expect(life(s, 'p2')).toBe(17);
    expect(life(s, 'p1')).toBe(20);
  });
  it('a creature that is not destroyed (indestructible) still makes its controller lose the life', () => {
    const s0 = scenario([], { p1: { hand: ['Dalek Drone'] }, p2: { battlefield: ['Test Ward Wall'] }, defs: DEFS });
    const s = resolve(resolve(cast(s0, 'Dalek Drone'), [[obj(find(s0, 'Test Ward Wall', 'battlefield', 'p2'))]]));
    expect(battlefieldNames(s, 'p2')).toContain('Test Ward Wall');
    expect(life(s, 'p2')).toBe(17);
    expect(life(s, 'p1')).toBe(20);
  });
});

describe("CR 400.3: Dinrova Horror, \"return target permanent to its owner's hand, then that player discards a card\"", () => {
  it("the permanent's owner discards (here the returned card itself, their only card); the Horror's controller keeps their hand", () => {
    const s0 = scenario([], { p1: { hand: ['Dinrova Horror', 'Test Rock'] }, p2: { battlefield: ['Test Elf'] }, defs: DEFS });
    const elf = find(s0, 'Test Elf', 'battlefield', 'p2');
    let s = resolve(cast(s0, 'Dinrova Horror'), [[obj(elf)]]);
    s = resolve(s);
    for (let guard = 0; guard < 4 && s.pending && s.pending.kind !== 'priority'; guard++) s = answer(s, { kind: 'chooseObjects', ids: [...s.zones.hand.p2!] } as DecisionAnswer);
    expect(zoneNames(s, 'graveyard', 'p2')).toContain('Test Elf');
    expect(zoneNames(s, 'hand', 'p2')).toEqual([]);
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Rock']);
  });
  it('returning your own permanent makes you discard', () => {
    const s0 = scenario([], { p1: { hand: ['Dinrova Horror'], battlefield: ['Test Rock'] }, p2: { hand: ['Test Elf'] }, defs: DEFS });
    let s = resolve(cast(s0, 'Dinrova Horror'), [[obj(find(s0, 'Test Rock', 'battlefield', 'p1'))]]);
    s = resolve(s);
    for (let guard = 0; guard < 4 && s.pending && s.pending.kind !== 'priority'; guard++) s = answer(s, { kind: 'chooseObjects', ids: [...s.zones.hand.p1!] } as DecisionAnswer);
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Rock');
    expect(zoneNames(s, 'hand', 'p2')).toEqual(['Test Elf']);
  });
});

describe('FAST4 audit note: the default prompt of a choice has its article', () => {
  it('"choose an option", "choose an opponent", "choose a creature type"', () => {
    expect(choicePrompt('option')).toBe('choose an option');
    expect(choicePrompt('opponent')).toBe('choose an opponent');
    expect(choicePrompt('creatureType')).toBe('choose a creature type');
  });
});
