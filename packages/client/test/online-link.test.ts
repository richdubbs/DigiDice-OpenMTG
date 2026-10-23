/**
 * The browser's link to its local server for online play (milestone 9, src/online/OnlineLink.ts; docs/design/online.md "Browser and local server"), with a
 * fake socket and a fake session fetch: the token request and the socket URL, the protocol check, commands and replies, the server's messages, and what
 * happens when the socket drops (another tab, the server stopping, a drop that is retried).
 */
import { describe, expect, it } from 'vitest';
import { OnlineLink, OnlineLinkError, socketUrl } from '../src/online/OnlineLink';
import { FakeSocket, IDLE, TOKEN, fakeLink, flush, gameViews, sessionFetch } from './online-fakes';

describe('connecting', () => {
  it('asks the session endpoint for the token, opens ws://<server>/api/online/socket?token=..., and resolves on the first status', async () => {
    const f = fakeLink({ opts: { base: 'http://127.0.0.1:47600' } });
    expect(f.link.linkState()).toBe('connecting');
    await f.link.connect();
    expect(f.session.calls).toEqual(['http://127.0.0.1:47600/api/online/session']);
    expect(f.socket().url).toBe(`ws://127.0.0.1:47600/api/online/socket?token=${TOKEN}`);
    expect(f.link.linkState()).toBe('open');
    expect(f.link.status()).toEqual(IDLE);
    expect(f.link.linkProblem()).toBeNull();
  });

  it('builds the socket URL from the page (same origin), wss for an https page', () => {
    expect(socketUrl('', 'abc')).toBe(`ws://${location.host}/api/online/socket?token=abc`);
    expect(socketUrl('https://example.test:8443', 'a b')).toBe('wss://example.test:8443/api/online/socket?token=a+b');
  });

  it('refuses a server of another protocol version before opening a socket', async () => {
    const f = fakeLink({ session: sessionFetch({ token: TOKEN, protocol: 99 }) });
    const err = await f.link.connect().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OnlineLinkError);
    expect(err).toMatchObject({ code: 'version' });
    expect((err as Error).message).toMatch(/different versions.*Reload the page/);
    expect(f.sockets).toEqual([]);
    expect(f.link.linkState()).toBe('closed');
  });

  it('says when there is no local server or it refuses (HTTP 403)', async () => {
    const none = new OnlineLink({ fetch: () => Promise.reject(new TypeError('Failed to fetch')) });
    await expect(none.connect()).rejects.toMatchObject({ code: 'closed', message: expect.stringMatching(/does not answer.*npm run play/) as string });
    const refused = fakeLink({ session: sessionFetch({ error: 'no' }, 403) });
    await expect(refused.link.connect()).rejects.toMatchObject({ code: 'closed', message: expect.stringMatching(/HTTP 403/) as string });
    const garbage = fakeLink({ session: sessionFetch('not a session') });
    await expect(garbage.link.connect()).rejects.toMatchObject({ code: 'closed' });
  });

  it('rejects when the socket closes before the server said anything (the upgrade was refused)', async () => {
    const f = fakeLink({ auto: false });
    const p = f.link.connect();
    await flush();
    f.socket().drop(1006);
    await expect(p).rejects.toMatchObject({ code: 'disconnected' });
  });
});

describe('commands and server messages', () => {
  it('numbers the commands and resolves each with its own reply; host and join send what the server expects', async () => {
    const f = fakeLink();
    await f.link.connect();
    const s = f.socket();
    const deck = { main: [{ name: 'Forest', count: 40 }], sideboard: [] };
    const host = f.link.host({ name: 'Hana', deck, format: 'casual', port: 47620 });
    const chat = f.link.say('hi');
    expect(s.sent).toEqual([
      { t: 'host', id: 1, name: 'Hana', deck, format: 'casual', port: 47620 },
      { t: 'chat', id: 2, text: 'hi' },
    ]);
    s.push({ t: 'reply', id: 2, ok: true });
    s.push({ t: 'reply', id: 1, ok: false, error: { code: 'portInUse', message: 'UDP port 47620 is in use' } });
    expect(await host).toEqual({ ok: false, error: { code: 'portInUse', message: 'UDP port 47620 is in use' } });
    expect(await chat).toEqual({ ok: true });
    expect(f.link.chat()).toEqual([{ n: 1, from: 'me', text: 'hi' }]);
    const join = f.link.join({ address: '203.0.113.5:47620', code: 'ABCD-EFGH-JKLM-NPQR', name: 'Gus', deck });
    expect(s.last('join')).toEqual({ t: 'join', id: 3, address: '203.0.113.5:47620', code: 'ABCD-EFGH-JKLM-NPQR', name: 'Gus', deck });
    s.reply('join');
    expect(await join).toEqual({ ok: true });
    // A reply nobody waits for, a message that is not JSON, a binary frame: ignored.
    s.push({ t: 'reply', id: 99, ok: true });
    s.raw('not json');
    s.raw(new ArrayBuffer(4));
    expect(f.link.linkState()).toBe('open');
  });

  it('gives up waiting for host or join after the setup timeout (the server may still answer)', async () => {
    const f = fakeLink({ opts: { setupTimeoutMs: 20 } });
    await f.link.connect();
    const r = await f.link.join({ address: '203.0.113.5', code: 'X', name: 'Gus', deck: { main: [], sideboard: [] } });
    expect(r).toMatchObject({ ok: false, error: { code: 'timeout' } });
  });

  it('keeps the latest view (seq only goes up), the status, a waiting proposal, notices and chat; a new game clears the old view', async () => {
    const g = gameViews();
    const f = fakeLink();
    await f.link.connect();
    const s = f.socket();
    let changes = 0;
    f.link.subscribe(() => changes++);
    s.push({ t: 'status', status: { role: 'host', phase: 'playing', me: 'p1', opponent: 'Gus', opponentConnected: true, warnings: [] } });
    const v1 = g.msg('p1');
    s.push(v1);
    const first = f.link.view();
    expect(first).toEqual(v1);
    expect(f.link.view()).toBe(first); // stable between changes
    const events = g.step();
    s.push(g.msg('p1', events));
    expect(f.link.view()!.seq).toBe(1);
    expect(f.link.view()!.events.length).toBeGreaterThan(0);
    s.push({ ...v1, seq: 0 }); // older: ignored
    expect(f.link.view()!.seq).toBe(1);
    s.push({ t: 'manualProposal', proposal: { id: 4, sourceName: 'Fork', text: 'Copy target instant', lines: ['Hana\'s life -3.'] } });
    expect(f.link.proposal()).toMatchObject({ id: 4, sourceName: 'Fork' });
    s.push({ t: 'manualClosed', proposal: 3 });
    expect(f.link.proposal()).not.toBeNull();
    s.push({ t: 'manualClosed', proposal: 4 });
    expect(f.link.proposal()).toBeNull();
    s.push({ t: 'chat', text: 'gl hf' });
    s.push({ t: 'notice', kind: 'opponentDropped', text: 'The guest\'s link dropped.' });
    expect(f.link.chat()).toEqual([{ n: 1, from: 'opponent', text: 'gl hf' }]);
    expect(f.link.notices()).toEqual([{ n: 2, kind: 'opponentDropped', text: 'The guest\'s link dropped.' }]);
    expect(changes).toBe(7); // status, two views, the proposal and its close, chat, notice (the ignored ones change nothing)
    s.push({ t: 'status', status: IDLE });
    expect(f.link.view()).toBeNull();
    expect(f.link.hasGame()).toBe(false);
  });
});

describe('when the socket drops', () => {
  it('answers waiting commands "disconnected" and opens the socket again after a drop; the server resends the status and the view', async () => {
    const g = gameViews();
    const f = fakeLink();
    await f.link.connect();
    const act = f.link.act({ type: 'pass', player: 'p1' });
    f.socket().drop(1006);
    expect(await act).toMatchObject({ ok: false, error: { code: 'disconnected' } });
    expect(f.link.linkState()).toBe('lost');
    expect(f.link.linkProblem()).toMatch(/trying again/);
    expect(await f.link.act({ type: 'pass', player: 'p1' })).toMatchObject({ ok: false, error: { code: 'disconnected' } }); // not sent while lost
    await new Promise((r) => setTimeout(r, 30));
    expect(f.sockets).toHaveLength(2);
    expect(f.link.linkState()).toBe('open');
    f.socket().push(g.msg('p1'));
    expect(f.link.view()).not.toBeNull();
  });

  it('gives up after the retries, with a message that says what to check', async () => {
    const f = fakeLink({ auto: false, opts: { maxRetries: 2 } });
    const p = f.link.connect();
    await flush();
    f.socket().open();
    f.socket().push({ t: 'status', status: IDLE });
    await p;
    for (let i = 0; i < 3; i++) {
      // the open socket drops, then each new one fails before it opens (a success in between would start the count again)
      f.socket().drop(1006);
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(f.sockets).toHaveLength(3);
    expect(f.link.linkState()).toBe('closed');
    expect(f.link.linkProblem()).toMatch(/Check that OpenMTG is still running/);
  });

  it('does not retry when another tab took over (4001) or the server stopped (4003), and says so', async () => {
    const a = fakeLink();
    await a.link.connect();
    a.socket().drop(4001, 'replaced');
    expect(a.link.linkState()).toBe('closed');
    expect(a.link.linkProblem()).toMatch(/another tab or window/);
    const b = fakeLink();
    await b.link.connect();
    b.socket().drop(4003, 'stopping');
    expect(b.link.linkProblem()).toMatch(/server stopped/);
    await new Promise((r) => setTimeout(r, 20));
    expect(a.sockets).toHaveLength(1);
    expect(b.sockets).toHaveLength(1);
  });

  it('close() closes the socket for good (no retry, no problem shown); the game stays at the server', async () => {
    const f = fakeLink();
    await f.link.connect();
    const s: FakeSocket = f.socket();
    f.link.close();
    expect(s.closedWith).toMatchObject({ code: 1000 });
    expect(f.link.linkState()).toBe('closed');
    expect(f.link.linkProblem()).toBeNull();
    s.drop(1006); // the late close event of that socket
    await new Promise((r) => setTimeout(r, 20));
    expect(f.sockets).toHaveLength(1);
    expect(s.sent).toEqual([]); // close() never sends leave
  });
});

describe('M12F: the chat a reloaded page gets back from the local server', () => {
  it('chatHistory replaces the lines held (own lines as "me", senders kept), marked as history; the same list again changes nothing', async () => {
    const f = fakeLink();
    await f.link.connect();
    const s = f.socket();
    let changes = 0;
    f.link.subscribe(() => changes++);
    s.push({ t: 'chatHistory', lines: [{ text: 'gl hf', from: 'p2' }, { text: 'you too', mine: true }, { text: 'thanks' }] });
    expect(f.link.chat()).toEqual([
      { n: 1, from: 'opponent', text: 'gl hf', player: 'p2', history: true },
      { n: 2, from: 'me', text: 'you too', history: true },
      { n: 3, from: 'opponent', text: 'thanks', history: true },
    ]);
    expect(changes).toBe(1);
    const held = f.link.chat();
    s.push({ t: 'chatHistory', lines: [{ text: 'gl hf', from: 'p2' }, { text: 'you too', mine: true }, { text: 'thanks' }] });
    expect(f.link.chat()).toBe(held); // a `status` resend of the same chat: nothing new
    expect(changes).toBe(1);
    s.push({ t: 'chat', text: 'one more', from: 'p3' });
    expect(f.link.chat().at(-1)).toEqual({ n: 4, from: 'opponent', text: 'one more', player: 'p3' });
    s.push({ t: 'chatHistory', lines: [] });
    expect(f.link.chat()).toEqual([]);
  });

  it('a new game being set up starts with no chat; the status of a running game keeps it', async () => {
    const f = fakeLink();
    await f.link.connect();
    const s = f.socket();
    s.push({ t: 'chat', text: 'old game' });
    s.push({ t: 'status', status: { role: 'host', phase: 'playing', me: 'p1', opponent: 'Gus', opponentConnected: true, warnings: [] } });
    expect(f.link.chat()).toHaveLength(1);
    s.push({ t: 'status', status: { role: 'host', phase: 'starting', me: 'p1', warnings: [] } });
    expect(f.link.chat()).toEqual([]);
  });

  it('keeps up to the server\'s 200 lines by default', async () => {
    const f = fakeLink();
    await f.link.connect();
    f.socket().push({ t: 'chatHistory', lines: Array.from({ length: 250 }, (_, i) => ({ text: `l${i}` })) });
    expect(f.link.chat()).toHaveLength(200);
    expect(f.link.chat()[0]!.text).toBe('l50');
  });
});
