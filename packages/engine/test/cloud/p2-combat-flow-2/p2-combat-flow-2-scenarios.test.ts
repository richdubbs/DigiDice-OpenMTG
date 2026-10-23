/**
 * p2-combat-flow-2 (Phase 2 lane p2-combat-flow): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in
 * the cloud checkout).
 *
 *   CR 509.1h, 509.3c, 510.1c  "Target unblocked attacking creature becomes blocked.", "Attacking creatures become blocked."
 *   CR 602.5b, 509.1            "Activate only during combat after blockers are declared."
 *   CR 508.4                    "create two 2/2 ... tokens that are attacking" (untapped, attacking)
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, GameState, ObjectId } from '../../../src/index';
import { act, advanceTo, answer, life, pass, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers } from '../../m4/helpers';
import { card, full, resolveAll, settle } from '../cmd3/helpers';

const BEAR = card('Test Mild Bear', 'Creature — Bear', '', ['2', '2']);
const RUNNER = card('Test Snare Runner', 'Creature — Human Scout', '{T}: Target unblocked attacking creature becomes blocked. Activate only during combat after blockers are declared.', ['1', '1']);
const STALKER = card('Test Thorn Stalker', 'Creature — Elf', 'Whenever this creature becomes blocked, you gain 3 life.\nWhenever this creature becomes blocked by a creature, you lose 1 life.', ['2', '2']);
const FOG = card('Test Clinging Fog', 'Instant', 'Attacking creatures become blocked.');
const CAPTAIN = card('Test Host Captain', 'Creature — Angel', 'Whenever this creature attacks, create two 2/2 white Soldier creature tokens that are attacking.', ['3', '3']);
const DEFS: CardDef[] = [BEAR, RUNNER, STALKER, FOG, CAPTAIN];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS.filter((x) => x !== FOG)) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
  it('the group form ("Attacking creatures become blocked.") is automated; its template is experimental, so the card is capped at partial (design 6.9)', () => {
    expect((FOG.automation.faces ?? [])[0]!.abilities.every((a) => a.level === 'full')).toBe(true);
    expect(FOG.automation.level).toBe('partial');
  });
});

const on = (s: GameState, name: string, player?: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name && (player === undefined || s.objects[id]!.controller === player));
const one = (s: GameState, name: string, player?: string): ObjectId => on(s, name, player)[0]!;
/** To the end of combat (priority, empty stack), resolving what triggers. */
function toEndOfCombat(s0: GameState): GameState {
  let s = s0;
  for (let k = 0; k < 60 && !(s.turn.step === 'endCombat' && s.pending?.kind === 'priority' && s.zones.stack.length === 0); k++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s);
  return s;
}
/** p1 attacks with `ids`; p2 declares no blockers; stop at the first priority of p2 in the declare blockers step. */
function attackUnblockedToBlockers(s0: GameState, ids: ObjectId[]): GameState {
  let s = declareAttackers(toDeclareAttackers(s0), ids.map((id) => [id] as [ObjectId]));
  s = resolveAll(s);
  s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'blockers');
  s = declareBlockers(s, []);
  return resolveAll(s);
}

describe('CR 509.1h, 509.3c, 510.1c: "Target unblocked attacking creature becomes blocked."', () => {
  it('CR 602.5b: not before blockers are declared; after, the attacker is blocked, deals no combat damage, and its "becomes blocked" (not "by a creature") triggers', () => {
    // turn 3: p2's creature has been under p2's control since p2's turn began (CR 302.6)
    let s = advanceTo(scenario(['Plains'], { p1: { battlefield: ['Test Thorn Stalker'] }, p2: { battlefield: ['Test Snare Runner'] }, defs: DEFS }), 3, 'main1');
    const stalker = one(s, 'Test Thorn Stalker');
    const runner = one(s, 'Test Snare Runner');
    s = declareAttackers(toDeclareAttackers(s), [[stalker]]);
    for (let k = 0; k < 5 && s.pending?.player !== 'p2'; k++) s = pass(s);
    expect(s.turn.step).toBe('declareAttackers');
    expect(() => act(s, { type: 'activate', player: 'p2', source: runner, ability: 'p:0:0' })).toThrow();
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'blockers');
    s = declareBlockers(s, []);
    for (let k = 0; k < 5 && s.pending?.player !== 'p2'; k++) s = pass(s);
    s = act(s, { type: 'activate', player: 'p2', source: runner, ability: 'p:0:0' });
    s = resolveAll(answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: stalker }] }));
    expect(s.combat?.attackers.find((a) => a.id === stalker)?.blocked).toBe(true);
    expect(life(s, 'p1')).toBe(23); // "becomes blocked" once; "becomes blocked by a creature" never (no blocker)
    s = toEndOfCombat(s);
    expect(life(s, 'p2')).toBe(20); // a blocked creature with no blocker deals no combat damage (CR 510.1c)
  });
  it('CR 509.1h: a blocked attacker is no legal target ("unblocked")', () => {
    let s = advanceTo(scenario(['Plains'], { p1: { battlefield: ['Test Mild Bear'] }, p2: { battlefield: ['Test Snare Runner', 'Test Mild Bear'] }, defs: DEFS }), 3, 'main1');
    const bear = one(s, 'Test Mild Bear', 'p1');
    s = declareAttackers(toDeclareAttackers(s), [[bear]]);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'blockers');
    s = declareBlockers(s, [[one(s, 'Test Mild Bear', 'p2'), bear]]);
    for (let k = 0; k < 5 && s.pending?.player !== 'p2'; k++) s = pass(s);
    expect(() => act(s, { type: 'activate', player: 'p2', source: one(s, 'Test Snare Runner'), ability: 'p:0:0' })).toThrow();
  });
});

describe('CR 509.1h: "Attacking creatures become blocked."', () => {
  it('CR 509.1h, 510.1c: every attacking creature becomes blocked and none deals combat damage; a creature that is not attacking is unchanged', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Mild Bear', 'Test Thorn Stalker'] }, p2: { battlefield: ['Plains', 'Test Mild Bear'], hand: ['Test Clinging Fog'] }, defs: DEFS });
    s = attackUnblockedToBlockers(s, [one(s, 'Test Mild Bear', 'p1')]);
    for (let k = 0; k < 5 && s.pending?.player !== 'p2'; k++) s = pass(s);
    s = resolveAll(act(s, { type: 'cast', player: 'p2', card: s.zones.hand['p2']!.find((id) => s.objects[id]!.defId === 'Test Clinging Fog')! }));
    expect(s.combat?.attackers.every((a) => a.blocked)).toBe(true);
    expect(life(s, 'p1')).toBe(20); // the Stalker did not attack: its trigger does not fire
    s = toEndOfCombat(s);
    expect(life(s, 'p2')).toBe(20);
  });
});

describe('CR 508.4: "create two 2/2 white Soldier creature tokens that are attacking"', () => {
  it('CR 508.4: the tokens enter attacking and untapped (never declared as attackers) and deal combat damage', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Host Captain'] }, defs: DEFS });
    s = declareAttackers(toDeclareAttackers(s), [[one(s, 'Test Host Captain')]]);
    s = resolveAll(s);
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens).toHaveLength(2);
    for (const t of tokens) {
      expect(s.combat?.attackers.some((a) => a.id === t)).toBe(true);
      expect(s.objects[t]!.tapped).toBe(false);
    }
    s = toEndOfCombat(s);
    expect(life(s, 'p2')).toBe(13);
  });
});
