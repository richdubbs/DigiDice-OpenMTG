/**
 * FAST2 MRE (engine INTERFACE CHANGE): the protocol lets through the by-hand tools for manual triggered and static abilities (actions `manualTrigger` /
 * `manualStatic`, legal-action kinds of the same names) and the `continue` flag of a manualResolve answer (manual resolution in steps); nothing else new.
 */
import { describe, expect, it } from 'vitest';
import { parseGuestMessage, parseHostMessage, PROTOCOL_VERSION } from '../src/protocol/messages';

const action = (a: unknown) => parseGuestMessage({ v: PROTOCOL_VERSION, type: 'action', id: 1, seq: 1, action: a });

describe('MRE actions and answers on the wire', () => {
  it('accepts manualTrigger and manualStatic with a source and an ability key, and nothing more', () => {
    for (const type of ['manualTrigger', 'manualStatic']) {
      expect(action({ type, player: 'p2', source: 'o12', ability: 'p:0:0' }).ok).toBe(true);
      expect(action({ type, player: 'p2', source: 'o12' }).ok).toBe(false);
      expect(action({ type, player: 'p2', source: 'o12', ability: 'p:0:0', junk: 1 }).ok).toBe(false);
    }
  });

  it('accepts a manualResolve answer with continue', () => {
    const ans = { kind: 'manualResolve', ops: [{ op: 'draw', player: 'p2', count: 3 }], continue: true };
    expect(action({ type: 'answer', player: 'p2', decisionId: 'd9', answer: ans }).ok).toBe(true);
    expect(action({ type: 'answer', player: 'p2', decisionId: 'd9', answer: { ...ans, again: true } }).ok).toBe(false);
  });

  it("a view's legal actions may be the by-hand tools", () => {
    for (const kind of ['manualTrigger', 'manualStatic']) {
      const legal = [{ action: { type: kind, player: 'p2', source: 'o12', ability: 'p:0:0' }, kind, label: 'Test: text (by hand)', isMana: false, object: 'o12' }];
      expect(parseHostMessage({ v: PROTOCOL_VERSION, type: 'view', seq: 1, view: {}, events: [], legal })).not.toBeNull();
    }
  });
});
