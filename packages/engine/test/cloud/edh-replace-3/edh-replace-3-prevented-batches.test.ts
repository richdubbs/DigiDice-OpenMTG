/**
 * edh-replace-3, CR 615.13: "Whenever damage that would be dealt to you is prevented, ..." triggers once each time a prevention effect is applied to one or more
 * SIMULTANEOUS damage events: separate damage events (two sentences of one spell) trigger separately, and the damage of one batch triggers once whatever lies between
 * the events (a blocked attacker between two unblocked ones). Synthetic cards (design 6.10). CR cite from memory (unverified against rules/cr).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, findAll, life, pass, scenario } from '../../m3/scenario';

const card = (name: string, type: string, text: string, pt?: [string, string]): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
const SQUIRE = card('Test Squire', 'Creature — Human', 'Flash\nWhen this creature enters, prevent all damage that would be dealt to you this turn.\nWhenever damage that would be dealt to you is prevented, you gain 1 life.', ['1', '1']);
const WATCHER = card('Test Watcher', 'Creature — Human', 'Whenever damage that would be dealt to you is prevented, you gain 1 life.', ['1', '1']);
const SPELL = card('Test Double Ping', 'Instant', 'This spell deals 1 damage to target player. Then this spell deals 1 damage to that player.');
const FOG = card('Test Flash Warder', 'Instant', 'Prevent all combat damage that would be dealt this turn.');
const BEAR = card('Test Strong Bear', 'Creature — Bear', '', ['3', '3']);
const WALL = card('Test Wall', 'Creature — Wall', 'Defender', ['1', '10']);

function drive(s0: GameState, blocks: () => unknown[] = () => [], targets: unknown[] = []): GameState {
  let s = s0;
  for (let g = 0; g < 60 && s.pending && s.pending.kind !== 'priority'; g++) {
    const p = s.pending as any;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true } as any);
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets } as any);
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x: any) => x.id) } as any);
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: blocks() } as any);
    else throw new Error(`unexpected ${p.kind}: ${p.prompt}`);
  }
  return s;
}

describe('CR 615.13: one trigger per batch of simultaneous damage events', () => {
  it('two separate damage events of one spell (prevented by an earlier effect): two triggers', () => {
    let s = scenario([], { defs: [SQUIRE, SPELL], p1: { hand: ['Test Double Ping'] }, p2: { hand: ['Test Squire'] } });
    s = pass(s);
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Squire', 'hand', 'p2') } as any));
    for (let i = 0; i < 20 && s.zones.stack.length > 0; i++) s = drive(pass(s));
    for (let i = 0; i < 10 && s.pending?.player !== 'p1'; i++) s = pass(s);
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Double Ping', 'hand', 'p1') } as any), () => [], [{ kind: 'player', id: 'p2' }]);
    for (let i = 0; i < 20 && s.zones.stack.length > 0; i++) s = drive(pass(s));
    expect(life(s, 'p2')).toBe(22);
  });
  it.each([false, true])('three attackers all prevented, the middle one blocked by a wall (%s): one trigger for the player, not two', (block) => {
    const s0 = scenario([], { defs: [FOG, BEAR, WALL, WATCHER], p1: { battlefield: ['Test Strong Bear', 'Test Strong Bear', 'Test Strong Bear'] }, p2: { hand: ['Test Flash Warder'], battlefield: ['Test Wall', 'Test Watcher'] } });
    const att = findAll(s0, 'Test Strong Bear', 'battlefield', 'p1');
    const blocks = (s: GameState) => (block ? [{ blocker: find(s, 'Test Wall', 'battlefield', 'p2'), attacker: att[1] }] : []);
    let s = s0;
    for (let i = 0; i < 60 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    s = answer(s, { kind: 'declareAttackers', attacks: att.map((a) => ({ attacker: a, defender: 'p2' as PlayerId })) } as any);
    s = pass(s);
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Flash Warder', 'hand', 'p2') } as any));
    for (let i = 0; i < 200 && s.turn.step !== 'main2'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, () => blocks(s));
    expect(life(s, 'p2')).toBe(21);
  });
});
