/**
 * Coordinator D, round edh-d-80 (lane must-finish-5000): the round's readings played through the engine in four-player games with a synthetic card (invented names) of the
 * shape of Slicer, Hired Muscle // Slicer, High-Speed Antagonist, compiled by the game's default compiler. Alice (p1) is the active player of turn 1; turn 2 is p2's, turn 5
 * Alice's again. CR cites checked against the Comprehensive Rules of 2026-09-25 (media.wizards.com text).
 *
 *   CR 603.2, 503.1a            "At the beginning of each opponent's upkeep, ...": it triggers in each opponent's upkeep, not in its controller's.
 *   CR 108.4, 611.2a, 613.1b    "you may have that player gain control of ~ until end of turn": the active opponent controls it until the turn ends; "may" is its controller's choice.
 *   CR 701.26b, 701.15a-b       "If you do, untap ~, goad it, ...": untapped, goaded by the ability's controller (the old controller), so the opponent must attack with it and
 *                               must attack a player other than the goader if able; it stays goaded until the goader's next turn (Scryfall ruling 2022-10-14).
 *   CR 701.21a, 611.2a, 514.2   "... and it can't be sacrificed this turn": no sacrifice (an edict's choice, a cost) can take it this turn; the next turn it can be sacrificed.
 *   CR 701.28a, 712.9           "If you don't, convert it.": declining turns it over (back face up); its controller does not change.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, pass, reject } from '../../m3/scenario';
import { passUntil, tweak } from '../../m4/helpers';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
type Face = { name: string; type: string; text: string; pt?: [string, string]; cost?: string };
function dfc(front: Face, back: Face): CardDef {
  const face = (f: Face) => ({ name: f.name, mana_cost: f.cost ?? '', type_line: f.type, oracle_text: f.text, colors: [], ...(f.pt ? { power: f.pt[0], toughness: f.pt[1] } : {}) });
  return compileCard({ name: `${front.name} // ${back.name}`, layout: 'transform', mana_cost: front.cost ?? '', type_line: `${front.type} // ${back.type}`, oracle_text: '', colors: ['R'], keywords: [], card_faces: [face(front), face(back)] } as unknown as OracleCard);
}
const noManual = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const yes: DecisionAnswer = { kind: 'yesNo', yes: true };
const no: DecisionAnswer = { kind: 'yesNo', yes: false };
const player = (id: string): TargetChoice => ({ kind: 'player', id } as TargetChoice);
const attack = (pairs: [ObjectId, string][]): DecisionAnswer => ({ kind: 'declareAttackers', attacks: pairs.map(([attacker, defender]) => ({ attacker, defender })) });

const HIRELING = dfc(
  { name: 'Test Hireling', type: 'Legendary Artifact Creature — Robot', cost: '{4}{R}', pt: ['3', '4'], text: "More Than Meets the Eye {2}{R} (You may cast this card converted for {2}{R}.)\nDouble strike, haste\nAt the beginning of each opponent's upkeep, you may have that player gain control of Test Hireling until end of turn. If you do, untap Test Hireling, goad it, and it can't be sacrificed this turn. If you don't, convert it." },
  { name: 'Test Racer', type: 'Legendary Artifact — Vehicle', pt: ['3', '2'], text: 'Living metal (During your turn, this Vehicle is also a creature.)\nFirst strike, haste\nWhenever Test Racer deals combat damage to a player, convert it at end of combat.' },
);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const EDICT = card('Test Edict', 'Instant', 'Target player sacrifices a creature.');
const ALTAR = card('Test Altar', 'Artifact', 'Sacrifice a creature: You gain 1 life.');
const PLAIN_SEAT = card('Test Lever', 'Artifact', 'Sacrifice an artifact: You gain 1 life.');

const H = 'Test Hireling // Test Racer';
const idOf = (s: GameState, name: string): ObjectId => Object.values(s.objects).find((o) => s.defs[o.defId]?.name === name && o.zone === 'battlefield')!.id;
const inZone = (s: GameState, name: string, zone: string): boolean => Object.values(s.objects).some((o) => s.defs[o.defId]?.name === name && o.zone === zone);
const nameNow = (s: GameState, id: ObjectId): string => getChars(s, id)!.name;
const isCreature = (s: GameState, id: ObjectId): boolean => getChars(s, id)!.types.includes('Creature' as never);

/** Answer what comes up (targets, chosen objects, yes/no), paying costs automatically; stop at priority. */
function settle(s0: GameState, o: { targets?: TargetChoice[][]; picks?: ObjectId[][]; answers?: DecisionAnswer[] } = {}): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets' && o.targets && o.targets.length > 0) s = answer(s, { kind: 'chooseTargets', targets: o.targets.shift()! });
    else if (p.kind === 'chooseObjects' && o.picks && o.picks.length > 0) s = answer(s, { kind: 'chooseObjects', ids: o.picks.shift()! });
    else if (o.answers && o.answers.length > 0) s = answer(s, o.answers.shift()!);
    else break;
  }
  return s;
}
/** Pass priority until the stack is empty, answering as `settle` does. */
function drain(s0: GameState, o: Parameters<typeof settle>[1] = {}): GameState {
  let s = settle(s0, o);
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 40; guard++) s = settle(pass(s), o);
  return s;
}
/** From Alice's turn 1, to p2's upkeep with the trigger on the stack (Alice's yes/no to come when it resolves). */
function until(s0: GameState, done: (s: GameState) => boolean, what: string): GameState {
  let s = s0;
  for (let guard = 0; guard < 400; guard++) {
    if (done(s)) return s;
    if (s.pending?.kind === 'declareAttackers') s = answer(s, attack([]));
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = pass(s);
    else throw new Error(`Waiting for ${what} but a ${s.pending?.kind} decision is pending`);
  }
  throw new Error(`never reached ${what}`);
}
const toP2Upkeep = (s0: GameState): GameState => until(s0, (x) => x.turn.number === 2 && x.turn.step === 'upkeep' && x.zones.stack.length > 0, "p2's upkeep trigger");
const game = (extra: Record<string, unknown> = {}) => mpScenario({ players: 4, defs: [HIRELING, BEAR, EDICT, ALTAR, PLAIN_SEAT], zones: { p1: { battlefield: [H] }, ...extra } as never });

describe('edh-d-80: the synthetic card is automated (both faces)', () => {
  it('compiles fully', () => { expect(noManual(HIRELING), JSON.stringify(HIRELING.automation)).toBe(true); });
});

describe('CR 603.2, 108.4, 611.2a, 701.26b, 701.15a: "At the beginning of each opponent\'s upkeep, you may have that player gain control of ~ until end of turn. If you do, untap ~, goad it, ..."', () => {
  it('yes: the active opponent controls it until end of turn, untapped and goaded by Alice; it must attack, and not Alice', () => {
    const s0 = tweak(game(), (g) => { g.objects[idOf(g, H)]!.tapped = true; });
    const id = idOf(s0, H);
    let s = toP2Upkeep(s0);
    expect(s.zones.stack.length).toBe(1);
    s = drain(s, { answers: [yes] });
    expect(s.objects[id]!.controller).toBe('p2');
    expect(s.objects[id]!.tapped).toBe(false);
    expect(s.objects[id]!.goaded).toEqual([{ by: 'p1' }]);
    expect(nameNow(s, id)).toBe('Test Hireling');
    // p2's combat: the goaded creature attacks if able (haste: under p2's control since this turn) and attacks a player other than Alice if able
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers', 40);
    expect(s.pending!.player).toBe('p2');
    expect(reject(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: attack([]) } as never).rules.join(' ')).toMatch(/508\.1d|701\.15/);
    expect(reject(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: attack([[id, 'p1']]) } as never).rules.join(' ')).toMatch(/508\.1d|701\.15/);
    const t = answer(s, attack([[id, 'p3']]));
    expect(t.combat!.attackers.map((a) => a.id)).toEqual([id]);
  });
  it('yes: control returns to Alice when the turn ends; it stays goaded by Alice until her next turn', () => {
    let s = drain(toP2Upkeep(game()), { answers: [yes] });
    const id = idOf(s, H);
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers', 40);
    s = answer(s, attack([[id, 'p4']]));
    s = until(s, (x) => x.turn.number === 3 && x.turn.step === 'upkeep', "p3's upkeep");
    expect(s.objects[id]!.controller).toBe('p1');
    expect(s.objects[id]!.goaded).toEqual([{ by: 'p1' }]);
  });
  it('negative (no): Alice declines; it converts (back face up), stays under her control and untapped state unchanged; on p2\'s turn the Vehicle is not a creature', () => {
    const s0 = tweak(game(), (g) => { g.objects[idOf(g, H)]!.tapped = true; });
    const id = idOf(s0, H);
    const s = drain(toP2Upkeep(s0), { answers: [no] });
    expect(s.objects[id]!.controller).toBe('p1');
    expect(nameNow(s, id)).toBe('Test Racer');
    expect(s.objects[id]!.tapped).toBe(true);
    expect(s.objects[id]!.goaded ?? []).toEqual([]);
    expect(isCreature(s, id)).toBe(false); // living metal: a creature only during Alice's turn
  });
  it('negative: it does not trigger in its controller\'s own upkeep', () => {
    let s = drain(toP2Upkeep(game()), { answers: [no] }); // converted: the back face has no upkeep ability, so put the front face back for the check
    const id = idOf(s, H);
    s = tweak(s, (g) => { g.objects[id]!.face = 0; });
    expect(nameNow(s, id)).toBe('Test Hireling');
    // walk p2's, p3's and p4's upkeeps (decline each) to Alice's turn 5 upkeep: nothing of hers triggers there
    for (let guard = 0; guard < 400 && !(s.turn.number === 5 && s.turn.step === 'upkeep'); guard++) {
      if (s.pending?.kind === 'yesNo') s = answer(s, no);
      else if (s.pending?.kind === 'declareAttackers') s = answer(s, attack([]));
      else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (s.pending?.kind === 'priority') s = pass(s);
      else s = settle(s);
    }
    expect(s.turn.number).toBe(5);
    expect(s.turn.step).toBe('upkeep');
    expect(s.zones.stack.length).toBe(0);
  });
});

describe('CR 701.21a, 611.2a, 514.2: "... and it can\'t be sacrificed this turn"', () => {
  it('an edict on p2 takes p2\'s other creature; with only the goaded creature it takes nothing', () => {
    let s = drain(toP2Upkeep(game({ p2: { battlefield: ['Test Bear'] }, p3: { hand: ['Test Edict', 'Test Edict'] } })), { answers: [yes] });
    const id = idOf(s, H);
    expect(s.objects[id]!.controller).toBe('p2');
    s = pass(s); // p2 passes; p3 has priority in p2's upkeep
    expect(s.pending!.player).toBe('p3');
    const edicts = Object.values(s.objects).filter((o) => s.defs[o.defId]?.name === 'Test Edict' && o.zone === 'hand').map((o) => o.id);
    s = drain(settle(act(s, { type: 'cast', player: 'p3', card: edicts[0]! } as never), { targets: [[player('p2')]] }), { picks: [[idOf(s, 'Test Bear')]] });
    expect(inZone(s, 'Test Bear', 'graveyard')).toBe(true);
    expect(s.objects[id]?.zone).toBe('battlefield');
    // only the goaded creature left: the edict takes nothing
    while (s.pending?.kind === 'priority' && s.pending.player !== 'p3') s = pass(s);
    s = drain(settle(act(s, { type: 'cast', player: 'p3', card: edicts[1]! } as never), { targets: [[player('p2')]] }));
    expect(s.objects[id]?.zone).toBe('battlefield');
    expect(s.objects[id]!.controller).toBe('p2');
  });
  it('a sacrifice cost can\'t take it this turn: p2\'s Altar can\'t be activated with it as p2\'s only creature; with a Bear, the Bear is what it takes', () => {
    let s = drain(toP2Upkeep(game({ p2: { battlefield: ['Test Altar'] } })), { answers: [yes] });
    const id = idOf(s, H);
    expect(s.objects[id]!.controller).toBe('p2');
    expect(s.pending!.player).toBe('p2');
    expect(reject(s, { type: 'activate', player: 'p2', source: idOf(s, 'Test Altar'), ability: 'p:0:0' } as never).rules.join(' ')).toMatch(/118\.3|701\.21/);
    let t = drain(toP2Upkeep(game({ p2: { battlefield: ['Test Altar', 'Test Bear'] } })), { answers: [yes] });
    const life = t.players.find((p) => p.id === 'p2')!.life;
    t = drain(settle(act(t, { type: 'activate', player: 'p2', source: idOf(t, 'Test Altar'), ability: 'p:0:0' } as never), { picks: [[idOf(t, 'Test Bear')]] }));
    expect(inZone(t, 'Test Bear', 'graveyard')).toBe(true);
    expect(inZone(t, H, 'battlefield')).toBe(true);
    expect(t.players.find((p) => p.id === 'p2')!.life).toBe(life + 1);
  });
  it('negative: the restriction ends with the turn; on Alice\'s turn 3... an edict on Alice takes it', () => {
    let s = drain(toP2Upkeep(game({ p3: { hand: ['Test Edict'] } })), { answers: [yes] });
    const id = idOf(s, H);
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers', 40);
    s = answer(s, attack([[id, 'p4']]));
    s = until(s, (x) => x.turn.number === 3 && x.turn.step === 'upkeep' && x.zones.stack.length > 0, "p3's upkeep trigger");
    s = drain(s, { answers: [no] }); // Alice declines in p3's upkeep: it converts and stays hers (a Vehicle, not a creature on p3's turn)
    expect(s.objects[id]!.controller).toBe('p1');
    s = tweak(s, (g) => { g.objects[id]!.face = 0; });
    expect(isCreature(s, id)).toBe(true);
    while (s.pending?.kind === 'priority' && s.pending.player !== 'p3') s = pass(s);
    const edict = Object.values(s.objects).find((o) => s.defs[o.defId]?.name === 'Test Edict' && o.zone === 'hand')!.id;
    s = drain(settle(act(s, { type: 'cast', player: 'p3', card: edict } as never), { targets: [[player('p1')]] }), { picks: [[id]] });
    expect(inZone(s, H, 'battlefield')).toBe(false);
  });
});
