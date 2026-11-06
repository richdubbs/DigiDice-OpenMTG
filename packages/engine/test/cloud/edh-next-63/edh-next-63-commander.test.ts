/**
 * edh-next-63 (Commander lane counters), a commander game (CR 903): Reyhan, Last of the Abzan's "dies or is put into the command zone" read with a real commander
 * replacement (CR 903.9a). Synthetic card (design 6.10). CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { act, answerUntilPriority, card, commanderOnBattlefield, commanderScenario, find, legend, pass } from '../../m11/rules/helpers';

const REYHAN = legend('Test Abzan Commander', '{0}', ['1', '1'], null, 'Test Abzan Commander enters with three +1/+1 counters on it.\nWhenever a creature you control dies or is put into the command zone, if it had one or more +1/+1 counters on it, you may put that many +1/+1 counters on target creature.');
const OX = card('Test Ox', '{0}', 'Creature — Ox', '', ['1', '1']);
const SMITE = card('Test Smite', '{0}', 'Instant', 'Destroy target creature.');
const FOE = legend('Test Foe Commander', '{0}', ['1', '1'], null);

function drive(s0: GameState, targets: ObjectId[] = []): GameState {
  let s = s0;
  const queue = [...targets];
  for (let i = 0; i < 60 && s.pending && (s.pending.kind !== 'priority' || s.zones.stack.length > 0); i++) {
    const d = s.pending;
    if (d.kind === 'priority') s = pass(pass(s));
    else if (d.kind === 'payCost') s = answerUntilPriority(s, []);
    else if (d.kind === 'yesNo') s = answerUntilPriority(s, [{ kind: 'yesNo', yes: true }]);
    else if (d.kind === 'chooseTargets') s = answerUntilPriority(s, [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: queue.shift()! }] }]);
    else if (d.kind === 'commanderZone') s = answerUntilPriority(s, [{ kind: 'commanderZone', command: true }]);
    else throw new Error(`unexpected decision ${d.kind}`);
  }
  return s;
}

describe('CR 903.9a, 700.4, 603.10a: a commander that would die and goes to the command zone instead still triggers "dies or is put into the command zone" (Reyhan), with the +1/+1 counters it had', () => {
  it('the commander with three +1/+1 counters is put into the command zone: its own ability puts three +1/+1 counters on the target creature', () => {
    let s = commanderScenario({ p1Commanders: [REYHAN], p2Commanders: [FOE], p1: { battlefield: ['Test Ox', 'Test Abzan Commander'], hand: ['Test Smite'] }, defs: [OX, SMITE] });
    s = commanderOnBattlefield(s, 'Test Abzan Commander');
    const ox = find(s, 'Test Ox', 'battlefield');
    const cmdr = find(s, 'Test Abzan Commander', 'battlefield');
    s = { ...s, objects: { ...s.objects, [cmdr]: { ...s.objects[cmdr]!, counters: { '+1/+1': 3 } } } };
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Smite', 'hand', 'p1') }), [cmdr, ox]);
    expect(s.zones.command.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Abzan Commander')).toBe(true);
    expect(s.objects[ox]!.counters['+1/+1']).toBe(3);
  });
});
