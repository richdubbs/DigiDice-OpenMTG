/** What the browser may send over the online socket (src/online/messages.ts): pure validation functions, in process. */
import { describe, expect, it } from 'vitest';
import type { GameView, LegalAction } from '@openmtg/engine';
import { MAX_CLIENT_MESSAGE_BYTES } from '../src/online/api';
import { checkClientAction, parseClientMessage, parseGameAddress } from '../src/online/messages';

const DECK = { main: [{ name: 'Forest', count: 20 }, { name: 'Grizzly Bears', count: 20 }], sideboard: [] };
const parse = (m: unknown) => parseClientMessage(JSON.stringify(m));

describe('parseClientMessage', () => {
  it('accepts each command with its fields, cleaning names and texts', () => {
    expect(parse({ t: 'status', id: 1 })).toEqual({ ok: true, message: { t: 'status', id: 1 } });
    expect(parse({ t: 'host', id: 2, name: ' Hana\u0007 ', deck: DECK, format: 'modern', port: 0 })).toEqual({ ok: true, message: { t: 'host', id: 2, name: 'Hana', deck: DECK, format: 'modern', port: 0 } });
    expect(parse({ t: 'join', id: 3, address: ' 203.0.113.5:47620 ', code: '7kq2-m9xd-4trb-hc8p', name: 'Gus', deck: DECK })).toMatchObject({ ok: true, message: { address: '203.0.113.5:47620' } });
    expect(parse({ t: 'act', id: 4, action: { type: 'pass', player: 'p1' } })).toMatchObject({ ok: true });
    expect(parse({ t: 'manual', id: 5, proposal: 1, accept: false, reason: 'no\u0000' })).toEqual({ ok: true, message: { t: 'manual', id: 5, proposal: 1, accept: false, reason: 'no' } });
    expect(parse({ t: 'chat', id: 6, text: 'hi\u001b[31m' })).toEqual({ ok: true, message: { t: 'chat', id: 6, text: 'hi[31m' } });
    expect(parse({ t: 'leave', id: 7 })).toEqual({ ok: true, message: { t: 'leave', id: 7 } });
    // Only names and counts of a deck are kept.
    const extra = parse({ t: 'host', id: 8, name: 'H', deck: { main: [{ name: 'Forest', count: 40, oracleId: 'x' }], sideboard: [] } });
    expect(extra.ok && extra.message.t === 'host' && extra.message.deck.main[0]).toEqual({ name: 'Forest', count: 40 });
  });

  it('refuses what is malformed, naming the id when there is one', () => {
    expect(parseClientMessage('nope')).toEqual({ ok: false, error: 'not JSON' });
    expect(parse([1])).toMatchObject({ ok: false, error: 'unknown message' });
    expect(parse({ t: 'shutdown', id: 1 })).toMatchObject({ ok: false, error: 'unknown message' });
    expect(parse({ t: 'toString', id: 1 })).toMatchObject({ ok: false, error: 'unknown message' });
    expect(parse({ t: 'status' })).toMatchObject({ ok: false, error: 'id missing (a positive integer)' });
    expect(parse({ t: 'status', id: 0 })).toMatchObject({ ok: false });
    expect(parse({ t: 'status', id: 1.5 })).toMatchObject({ ok: false });
    expect(parse({ t: 'status', id: 1, x: 1 })).toEqual({ ok: false, id: 1, error: 'unknown field "x"' });
    expect(parse({ t: 'host', id: 1, name: 'H', deck: { main: [{ name: 'Forest', count: 0 }], sideboard: [] } })).toMatchObject({ ok: false, id: 1 });
    expect(parse({ t: 'host', id: 1, name: 'H', deck: { main: [{ name: 'Forest', count: 251 }], sideboard: [] } })).toMatchObject({ ok: false, id: 1 });
    expect(parse({ t: 'host', id: 1, name: 'H', deck: DECK, port: 70000 })).toMatchObject({ ok: false, error: 'port must be 0-65535' });
    expect(parse({ t: 'host', id: 1, name: 'H', deck: DECK, format: 'x<script>' })).toMatchObject({ ok: false, error: 'format malformed' });
    expect(parse({ t: 'host', id: 1, deck: DECK })).toMatchObject({ ok: false, error: 'name missing' });
    expect(parse({ t: 'join', id: 1, address: '203.0.113.5', code: 'short', name: 'G', deck: DECK })).toMatchObject({ ok: false, id: 1 });
    expect(parse({ t: 'join', id: 1, address: 'a b', code: '7KQ2-M9XD-4TRB-HC8P', name: 'G', deck: DECK })).toMatchObject({ ok: false, id: 1 });
    expect(parse({ t: 'act', id: 1, action: { type: 'startGame', player: 'p1' } })).toMatchObject({ ok: false, error: 'unknown action type' });
    expect(parse({ t: 'act', id: 1, action: { type: 'pass', player: 'p1', note: 'x' } })).toMatchObject({ ok: false, id: 1 });
    expect(parse({ t: 'manual', id: 1, proposal: 1, accept: 'yes' })).toMatchObject({ ok: false });
    expect(parse({ t: 'chat', id: 1, text: 'x'.repeat(501) })).toMatchObject({ ok: false });
  });

  it('bounds size and nesting before parsing (audit C4\'s rule for anything from outside)', () => {
    expect(parseClientMessage(`{"t":"chat","id":1,"text":"${'x'.repeat(MAX_CLIENT_MESSAGE_BYTES)}"}`)).toEqual({ ok: false, error: 'message too large' });
    expect(parseClientMessage(`${'['.repeat(10000)}${']'.repeat(10000)}`)).toEqual({ ok: false, error: 'message too deeply nested' });
    let deep: unknown = { op: 'note', text: 'x' };
    for (let i = 0; i < 8; i++) deep = { kind: 'manualResolve', ops: [deep] }; // within the message bound (24), past the action bound (LIMITS.actionDepth 12)
    expect(parse({ t: 'act', id: 1, action: { type: 'answer', player: 'p1', decisionId: 'd1', answer: deep } })).toMatchObject({ ok: false, id: 1 });
  });
});

describe('parseGameAddress', () => {
  it('reads IPv4, bracketed IPv6 and host names, with or without the port (default 47620)', () => {
    expect(parseGameAddress('203.0.113.5:47620')).toEqual({ host: '203.0.113.5', port: 47620 });
    expect(parseGameAddress(' 203.0.113.5 ')).toEqual({ host: '203.0.113.5', port: 47620 });
    expect(parseGameAddress('[2001:db8::1]:5000')).toEqual({ host: '2001:db8::1', port: 5000 });
    expect(parseGameAddress('[2001:db8::1]')).toEqual({ host: '2001:db8::1', port: 47620 });
    expect(parseGameAddress('friend.example.org:47621')).toEqual({ host: 'friend.example.org', port: 47621 });
  });

  it('refuses what is not an address', () => {
    for (const bad of ['', ':47620', '2001:db8::1', '203.0.113.5:0', '203.0.113.5:65536', '203.0.113.5:x', '256.1.1.1', 'a b', 'evil.test/x', '-bad.example', 'x:1:2']) {
      expect(parseGameAddress(bad).error, bad).toBeDefined();
    }
  });
});

describe('checkClientAction (CR 117.1: priority actions are the legal ones)', () => {
  const view = (pending: unknown, result?: unknown) => ({ pending, ...(result ? { result } : {}) }) as unknown as GameView;
  const priority = view({ kind: 'priority', id: 'd7', player: 'p1' });
  const legal = [
    { kind: 'pass', label: 'Pass', isMana: false, action: { type: 'pass', player: 'p1' } },
    { kind: 'cast', label: 'Cast Bears', isMana: false, object: 'o5', action: { type: 'cast', player: 'p1', card: 'o5' } },
    { kind: 'activate', label: 'Tap', isMana: true, object: 'o9', action: { type: 'activate', player: 'p1', source: 'o9', ability: 'a0' } },
  ] as LegalAction[];

  it('lets through legal priority actions, concessions and stops', () => {
    expect(checkClientAction({ type: 'pass', player: 'p1' }, 'p1', priority, legal)).toBeNull();
    expect(checkClientAction({ type: 'cast', player: 'p1', card: 'o5', face: 0 }, 'p1', priority, legal)).toBeNull(); // face and method: the engine checks them
    expect(checkClientAction({ type: 'activate', player: 'p1', source: 'o9', ability: 'a0' }, 'p1', priority, legal)).toBeNull();
    expect(checkClientAction({ type: 'concede', player: 'p1' }, 'p1', null, [])).toBeNull(); // CR 104.3a: at any time
    expect(checkClientAction({ type: 'setStops', player: 'p1', stops: { ownTurn: [], opponentTurn: [], fullControl: false } }, 'p1', view(null), [])).toBeNull();
  });

  it('refuses another player\'s action, an action that is not legal now, an answer to another decision, and anything after game over', () => {
    expect(checkClientAction({ type: 'pass', player: 'p2' }, 'p1', priority, legal)).toMatchObject({ code: 'notYourPlayer' });
    expect(checkClientAction({ type: 'cast', player: 'p1', card: 'o6' }, 'p1', priority, legal)).toMatchObject({ code: 'illegalAction', rules: ['CR 117.1'] });
    expect(checkClientAction({ type: 'activate', player: 'p1', source: 'o9', ability: 'a1' }, 'p1', priority, legal)).toMatchObject({ code: 'illegalAction' });
    expect(checkClientAction({ type: 'playLand', player: 'p1', card: 'o5' }, 'p1', priority, legal)).toMatchObject({ code: 'illegalAction' });
    const choosing = view({ kind: 'chooseObjects', id: 'd8', player: 'p1' });
    expect(checkClientAction({ type: 'pass', player: 'p1' }, 'p1', choosing, [])).toMatchObject({ code: 'stale', rules: ['CR 117.1'] });
    expect(checkClientAction({ type: 'answer', player: 'p1', decisionId: 'd7', answer: { kind: 'chooseObjects', ids: [] } }, 'p1', choosing, [])).toMatchObject({ code: 'stale' });
    expect(checkClientAction({ type: 'answer', player: 'p1', decisionId: 'd8', answer: { kind: 'chooseObjects', ids: [] } }, 'p1', choosing, [])).toBeNull();
    const theirs = view({ kind: 'priority', id: 'd9', player: 'p2' });
    expect(checkClientAction({ type: 'pass', player: 'p1' }, 'p1', theirs, [])).toMatchObject({ code: 'stale' });
    expect(checkClientAction({ type: 'cancel', player: 'p1' }, 'p1', theirs, [])).toMatchObject({ code: 'stale' });
    expect(checkClientAction({ type: 'pass', player: 'p1' }, 'p1', view(null, { winner: 'p2' }), [])).toMatchObject({ code: 'illegalAction', rules: ['CR 104.1'] });
    expect(checkClientAction({ type: 'pass', player: 'p1' }, 'p1', null, [])).toMatchObject({ code: 'notStarted' });
  });

  it('M6-11, CR 116.2b: a special action (turning a face-down permanent face up) needs priority and must be one the view offers', () => {
    const special = { kind: 'special', label: 'Turn Exalted Angel face up (morph {2}{W}{W})', isMana: false, object: 'o4', action: { type: 'special', player: 'p1', kind: 'turnFaceUp', object: 'o4', via: 'morph' } } as LegalAction;
    const offered = [...legal, special];
    expect(checkClientAction({ type: 'special', player: 'p1', kind: 'turnFaceUp', object: 'o4', via: 'morph', x: 2 }, 'p1', priority, offered)).toBeNull(); // X: the engine checks it
    expect(checkClientAction({ type: 'special', player: 'p1', kind: 'turnFaceUp', object: 'o4' }, 'p1', priority, offered)).toBeNull(); // the engine asks for via when there are several
    expect(checkClientAction({ type: 'special', player: 'p1', kind: 'turnFaceUp', object: 'o4', via: 'disguise' }, 'p1', priority, offered)).toMatchObject({ code: 'illegalAction' });
    expect(checkClientAction({ type: 'special', player: 'p1', kind: 'turnFaceUp', object: 'o5' }, 'p1', priority, offered)).toMatchObject({ code: 'illegalAction' });
    expect(checkClientAction({ type: 'special', player: 'p1', kind: 'turnFaceUp', object: 'o4' }, 'p1', view({ kind: 'chooseObjects', id: 'd8', player: 'p1' }), offered)).toMatchObject({ code: 'stale' });
  });
});
