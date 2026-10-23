/**
 * Bounds on JSON from the network (audit 2026-10-12, C4) and the checks of what a guest sends (M3 resume tokens, M4 setStops). The functions that
 * enforce them are called directly with crafted values: no sockets.
 */
import { describe, expect, it } from 'vitest';
import { jsonTextDepth, measureJson } from '../src/protocol/bounded';
import { checkAction, LIMITS, parseGuestMessage, PROTOCOL_VERSION } from '../src/protocol/messages';
import { decodeBody, encodeBody, MAX_JSON_DEPTH } from '../src/wire/codec';
import { deflateRawSync } from 'node:zlib';
import { localVersions } from '../src/protocol/versions';
import { sameStops } from '../src/game/stops';

/** A value nested `depth` deep, built without recursion. */
function nested(depth: number): unknown {
  let v: unknown = 1;
  for (let i = 1; i < depth; i++) v = i % 2 ? [v] : { a: v };
  return v;
}

const deepText = (depth: number) => Buffer.from('['.repeat(depth) + ']'.repeat(depth), 'utf8');

describe('JSON depth before parsing (codec)', () => {
  it('measures the nesting of a JSON text and stops as soon as it passes the bound', () => {
    expect(jsonTextDepth(Buffer.from('{"a":[1,{"b":2}]}'), 10)).toBe(3);
    expect(jsonTextDepth(Buffer.from('"[[[[[[" '), 2)).toBe(0); // brackets inside a string do not count
    expect(jsonTextDepth(Buffer.from('["\\"[[[[", 1]'), 2)).toBe(1); // nor after an escaped quote
    expect(jsonTextDepth(Buffer.from('["é[[[["]'), 2)).toBe(1); // multibyte text
    expect(jsonTextDepth(deepText(100_000), 256)).toBeNull();
  });

  it('decodeBody refuses a 5,000-deep message, raw or deflated, before JSON.parse sees it', () => {
    const raw = Buffer.concat([Buffer.from([0]), deepText(5000)]);
    expect(() => decodeBody(raw)).toThrow(/too deeply nested/);
    const deflated = Buffer.concat([Buffer.from([1]), deflateRawSync(deepText(5000))]);
    expect(() => decodeBody(deflated)).toThrow(/too deeply nested/);
    expect(() => decodeBody(Buffer.concat([Buffer.from([0]), deepText(40)]), 1024, 32)).toThrow(/too deeply nested/);
    expect(decodeBody(encodeBody({ a: [[[1]]] }))).toEqual({ a: [[[1]]] });
    expect(decodeBody(Buffer.concat([Buffer.from([0]), deepText(MAX_JSON_DEPTH)]))).toBeDefined();
  });
});

describe('a parsed action is measured without recursion (checkAction)', () => {
  const bounds = { maxDepth: 12, maxNodes: 8192, maxBytes: 64 * 1024 };

  it('measureJson reports depth, node count and size, whichever is passed first', () => {
    expect(measureJson({ type: 'pass', player: 'p2' }, bounds)).toBeNull();
    expect(measureJson(nested(13), bounds)).toBeNull(); // 12 arrays and objects around a number
    expect(measureJson(nested(14), bounds)).toBe('depth');
    expect(measureJson(nested(100_000), bounds)).toBe('depth');
    expect(measureJson(Array<number>(9000).fill(0), bounds)).toBe('nodes');
    expect(measureJson({ s: 'x'.repeat(70 * 1024) }, bounds)).toBe('bytes');
  });

  it('C4 regression: a 5,000-deep action is refused cleanly instead of throwing RangeError', () => {
    const action = { type: 'answer', player: 'p2', decisionId: 'd1', answer: { kind: 'chooseTargets', targets: nested(5000) } };
    expect(() => checkAction(action)).not.toThrow();
    expect(checkAction(action)).toBe('action too deeply nested');
    const r = parseGuestMessage({ v: PROTOCOL_VERSION, type: 'action', id: 1, seq: 0, action });
    expect(r).toMatchObject({ ok: false, error: 'action too deeply nested' });
    expect(checkAction({ type: 'answer', player: 'p2', decisionId: 'd1', answer: { kind: 'chooseOption', ids: Array<string>(9000).fill('x') } })).toBe('action too large');
  });

  it('a legitimate deep answer (manual adjustments, targets) stays within the bounds', () => {
    const ops = [{ op: 'token', player: 'p2', name: 'Soldier', typeLine: 'Token Creature - Soldier', colors: ['W'], power: '1', toughness: '1' }];
    expect(checkAction({ type: 'answer', player: 'p2', decisionId: 'd1', answer: { kind: 'manualResolve', ops } })).toBeNull();
    expect(LIMITS.actionDepth).toBeGreaterThanOrEqual(8);
  });
});

describe('resume tokens (audit M3)', () => {
  const hello = (resume: unknown) => ({
    v: PROTOCOL_VERSION, type: 'hello', versions: localVersions(null), name: 'G', deck: { main: [], sideboard: [] }, proof: 'ab', resume,
  });

  it('refuses any resume token that is not 32 lowercase hex digits, multibyte ones included, without throwing', () => {
    for (const bad of ['é'.repeat(32), 'A'.repeat(32), 'f'.repeat(31), 'f'.repeat(64), '😀'.repeat(16), 42]) {
      expect(parseGuestMessage(hello(bad))).toMatchObject({ ok: false, error: 'resume token malformed' });
    }
    expect(parseGuestMessage(hello('0123456789abcdef0123456789abcdef'))).toMatchObject({ ok: true });
  });
});

describe('setStops from the network (audit M4)', () => {
  const action = (stops: unknown) => ({ v: PROTOCOL_VERSION, type: 'action', id: 1, seq: 0, action: { type: 'setStops', player: 'p2', stops } });

  it('takes only steps of the turn, a bounded number of them, and drops repeats (turn order, CR 500.1)', () => {
    const r = parseGuestMessage(action({ ownTurn: ['end', 'upkeep', 'end', 'upkeep'], opponentTurn: [], fullControl: false }));
    expect(r.ok && r.message.type === 'action' && r.message.action).toEqual({ type: 'setStops', player: 'p2', stops: { ownTurn: ['upkeep', 'end'], opponentTurn: [], fullControl: false } });
    expect(parseGuestMessage(action({ ownTurn: ['nonsense'], opponentTurn: [], fullControl: false }))).toMatchObject({ ok: false, error: 'stops malformed' });
    expect(parseGuestMessage(action({ ownTurn: Array<string>(25).fill('upkeep'), opponentTurn: [], fullControl: false }))).toMatchObject({ ok: false, error: 'stops malformed' });
    expect(parseGuestMessage(action({ ownTurn: [], opponentTurn: [], fullControl: false, extra: 1 }))).toMatchObject({ ok: false, error: 'stops malformed' });
  });

  it('AP1: takes the optional hold-priority toggle as a boolean, and nothing else beside it', () => {
    const r = parseGuestMessage(action({ ownTurn: [], opponentTurn: [], fullControl: false, holdPriority: true }));
    expect(r.ok && r.message.type === 'action' && r.message.action).toEqual({ type: 'setStops', player: 'p2', stops: { ownTurn: [], opponentTurn: [], fullControl: false, holdPriority: true } });
    expect(parseGuestMessage(action({ ownTurn: [], opponentTurn: [], fullControl: false, holdPriority: 'yes' }))).toMatchObject({ ok: false, error: 'stops malformed' });
    expect(parseGuestMessage(action({ ownTurn: [], opponentTurn: [], fullControl: false, holdPriority: true, extra: 1 }))).toMatchObject({ ok: false, error: 'stops malformed' });
  });

  it('AP1: a change of the hold-priority toggle alone is a change (sameStops); absent and false are the same', () => {
    const base = { ownTurn: [], opponentTurn: [], fullControl: false };
    expect(sameStops(base, { ...base, holdPriority: true })).toBe(false);
    expect(sameStops(base, { ...base, holdPriority: false })).toBe(true);
  });
});

describe('fields of an action from the network (audit M4: the host keeps every applied action in its log)', () => {
  const junk = 'x'.repeat(60_000);
  const parse = (action: unknown) => parseGuestMessage({ v: PROTOCOL_VERSION, type: 'action', id: 1, seq: 0, action });

  it('refuses an action with a field the engine does not read, at the top level, in an answer, and in the objects of an answer', () => {
    const stops = { ownTurn: ['main1'], opponentTurn: [], fullControl: false };
    expect(parse({ type: 'setStops', player: 'p2', stops, junk })).toMatchObject({ ok: false, error: 'unknown action field "junk"' });
    expect(parse({ type: 'pass', player: 'p2', junk })).toMatchObject({ ok: false, error: 'unknown action field "junk"' });
    expect(parse({ type: 'cast', player: 'p2', card: 'o1', method: 'flashback', junk })).toMatchObject({ ok: false });
    expect(parse({ type: 'answer', player: 'p2', decisionId: 'd', answer: { kind: 'yesNo', yes: true, junk } })).toMatchObject({ ok: false, error: 'unknown answer field "junk"' });
    expect(parse({ type: 'answer', player: 'p2', decisionId: 'd', answer: { kind: 'nope' } })).toMatchObject({ ok: false, error: 'unknown answer kind "nope"' });
    expect(parse({ type: 'answer', player: 'p2', decisionId: 'd', answer: { kind: 'chooseTargets', targets: [{ kind: 'object', id: 'o1', junk }] } })).toMatchObject({ ok: false, error: 'unknown answer field "junk"' });
    expect(parse({ type: 'answer', player: 'p2', decisionId: 'd', answer: { kind: 'manualResolve', ops: [{ op: 'life', player: 'p2', delta: 1, junk }] } })).toMatchObject({ ok: false });
    expect(parse({ type: 'answer', player: 'p2', decisionId: 'd', answer: { kind: 'manualResolve', ops: [{ op: 'nope' }] } })).toMatchObject({ ok: false });
  });

  it('accepts every field the engine reads (an honest client is never refused)', () => {
    expect(parse({ type: 'cast', player: 'p2', card: 'o1', face: 1, method: 'flashback' })).toMatchObject({ ok: true });
    expect(parse({ type: 'special', player: 'p2', kind: 'turnFaceUp', object: 'o1' })).toMatchObject({ ok: true });
    const answers = [
      { kind: 'payCost', auto: false, activations: [{ objectId: 'o1', abilityKey: 'a0', color: 'G' }], lifeForPhyrexian: [0], spendPool: [0] },
      { kind: 'declareAttackers', attacks: [{ attacker: 'o1', defender: 'p1' }] },
      { kind: 'declareBlockers', blocks: [{ blocker: 'o1', attacker: 'o2' }] },
      { kind: 'assignDamage', amounts: [{ id: 'o1', amount: 2 }] },
      { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p1' }] },
      { kind: 'manualResolve', ops: [{ op: 'move', object: 'o1', to: 'battlefield', attachTo: 'o2' }, { op: 'mana', player: 'p2', types: ['G'], snow: true }] },
    ];
    for (const answer of answers) expect(parse({ type: 'answer', player: 'p2', decisionId: 'd', answer })).toMatchObject({ ok: true });
  });

  it('so a setStops that is accepted is small: alternating stops cannot carry junk into the log', () => {
    for (let i = 0; i < 100; i++) {
      const stops = { ownTurn: [i % 2 ? 'main1' : 'main2'], opponentTurn: [], fullControl: false };
      const r = parse({ type: 'setStops', player: 'p2', stops, junk });
      expect(r.ok).toBe(false);
      const clean = parse({ type: 'setStops', player: 'p2', stops });
      expect(clean.ok && JSON.stringify(clean.message.type === 'action' && clean.message.action).length).toBeLessThan(400);
    }
  });
});
