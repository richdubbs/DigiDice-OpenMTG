/**
 * Godot plan phase 1: the table channel's contract (src/table; the Godot project's ARCHITECTURE.md section 4), over a fake socket pair (helpers.ts:
 * every message crosses as JSON text). A scripted hot-seat game: the first view whole, then patches that, applied with the engine's `nextView`, give
 * exactly the views a LocalConnection gives a screen; stale actions refused (packages/hosted's `lastProgressSeq` rule), stop toggles never stale; the
 * hand-off hides the other hand (CR 400.2: no card name of a hand hidden from the screen's viewer in any message); `shown` paces the computer; `leave`
 * concedes (CR 104.3a).
 */
import { chooseAction } from '@openmtg/ai';
import { type Action, type Decision, type GameView } from '@openmtg/engine';
import { LocalConnection, fallback } from '@openmtg/play';
import { afterEach, describe, expect, it } from 'vitest';
import { STALE_MESSAGE, type TableServerMessage } from '../../src/table/api';
import { TableService } from '../../src/table/socket';
import { FakeClient, SECRET, TOKEN, bearsConfig, pause, secretsConfig } from './helpers';

let services: TableService[] = [];
afterEach(async () => {
  for (const s of services) await s.close();
  services = [];
});

function service(tables: ConstructorParameters<typeof TableService>[0] extends infer O ? (O extends { tables?: infer T } ? T : never) : never = {}): TableService {
  const s = new TableService({ token: TOKEN, version: '9.9.9', tables });
  services.push(s);
  return s;
}

/** What a screen reads of a view, as JSON (the client's view must equal the LocalConnection's). */
const json = (v: GameView) => JSON.stringify(v);

/** The AI's answer for the decision on `view`, or the always-legal fallback when the AI's answer is refused (tried on the reference first). */
async function nextAction(ref: LocalConnection, d: Decision): Promise<Action> {
  const a = chooseAction(ref.view(), d, `table:${d.id}`);
  if ((await ref.act(a)).ok) return a;
  const fb = fallback(d)!;
  expect((await ref.act(fb)).ok).toBe(true);
  return fb;
}

describe('the table channel: hello', () => {
  it('answers hello with welcome (protocol 1, the version, the features); anything before hello closes the socket', async () => {
    const s = service();
    const c = new FakeClient(s);
    await c.hello();
    const w = c.messages[0]!;
    expect(w).toMatchObject({ t: 'welcome', protocol: 1, version: '9.9.9' });
    expect(w.t === 'welcome' && w.features).toEqual(expect.arrayContaining(['hotseat', 'computer']));
    const early = new FakeClient(s);
    early.send({ t: 'ping' });
    expect(early.closedWith?.code).toBe(4002);
    const old = new FakeClient(s);
    old.send({ t: 'hello', protocol: 2 });
    expect(old.closedWith?.code).toBe(4002);
  });

  it('needs the launch token from a socket that is not this server\'s own page, and refuses a wrong one from anyone', async () => {
    const s = service();
    const none = new FakeClient(s, false);
    none.send({ t: 'hello', protocol: 1 });
    expect(none.closedWith).toEqual({ code: 4004, reason: 'Token missing.' });
    const wrong = new FakeClient(s, true);
    wrong.send({ t: 'hello', protocol: 1, token: 'cd'.repeat(32) });
    expect(wrong.closedWith?.code).toBe(4004);
    const ok = new FakeClient(s, false);
    await ok.hello(TOKEN);
    expect(ok.closedWith).toBeNull();
    ok.send({ t: 'ping' });
    expect(ok.messages.at(-1)).toEqual({ t: 'pong' });
  });
});

describe('the table channel: a scripted hot-seat game', () => {
  it('sends the first view whole, then patches; applied, they give exactly what a LocalConnection gives a screen, change after change', async () => {
    const cfg = bearsConfig('table-mirror', {}, false);
    const ref = new LocalConnection(cfg);
    const c = new FakeClient(service());
    c.autoShown = true;
    await c.hello();
    c.send({ t: 'start', kind: 'hotseat', config: cfg });
    const table = await c.next('table');
    expect(table).toMatchObject({ kind: 'hotseat', seats: ['p1', 'p2'], viewer: null });
    const first = await c.next('view');
    expect(first.seq).toBe(1);
    expect(first.events).toEqual([]);
    const same = () => {
      expect(json(c.view)).toBe(json(ref.view()));
      expect(c.legal).toEqual(ref.legalActions());
      expect(c.handoff).toBe(ref.handoff());
      expect(c.canUndo).toBe(ref.canUndo());
    };
    same();
    let steps = 0;
    let seq = c.seq;
    for (; steps < 150 && !ref.view().result; steps++) {
      if (ref.handoff()) {
        ref.acceptHandoff();
        c.send({ t: 'handoff', table: c.table });
        expect(c.seq).toBe(++seq); // one change, one seq
        same();
      }
      const d = ref.view().pending!;
      const batchSeq = ref.events().seq;
      const action = await nextAction(ref, d);
      const from = c.messages.length;
      const r = await c.act(action);
      expect(r).toEqual({ t: 'reply', id: r.id, ok: true });
      expect(c.seq).toBe(++seq);
      same();
      // The change came before its reply, with the events LocalConnection gives the screen for it.
      const change = c.messages.slice(from).find((m) => m.t === 'patch' || m.t === 'view') as Extract<TableServerMessage, { t: 'patch' | 'view' }>;
      expect(c.messages.indexOf(change)).toBeLessThan(c.messages.indexOf(r));
      expect(change.events).toEqual(ref.events().seq !== batchSeq ? JSON.parse(JSON.stringify(ref.events().events)) : []);
    }
    expect(steps).toBeGreaterThan(30);
    expect(c.misfits).toBe(0);
    // A change that keeps the viewer is a patch (a hand-off changes the viewer: that view comes whole, as `nextView` refuses a patch to another seat).
    const changes = c.messages.filter((m) => m.t === 'patch' || m.t === 'view') as Extract<TableServerMessage, { t: 'patch' | 'view' }>[];
    expect(changes.filter((m) => m.t === 'patch').length).toBeGreaterThan(30);
    const viewers = new Map<number, string | null>();
    for (const m of changes) if (m.t === 'view') viewers.set(m.seq, m.view.viewer);
    const kept = changes.filter((m, i) => i > 0 && (m.t === 'patch' || viewers.get(changes[i - 1]!.seq) === m.view.viewer));
    expect(kept.filter((m) => m.t === 'patch').length).toBeGreaterThanOrEqual(kept.length * 0.9);
    // Every patch applies to the view the one before it left (base = the previous seq).
    let last = 0;
    for (const m of changes) {
      if (m.t === 'patch') expect(m.base).toBe(last);
      last = m.seq;
    }
  });

  it('sends a full view when the table is more than 6 changes behind what it has shown, and patches again once it catches up', async () => {
    // Against the computer, whose board wait is cut to 20 ms: the table never sends `shown` until late, as a slow table would.
    const c = new FakeClient(service({ delayMs: () => 0, maxBoardWaitMs: 20 }));
    const seen: { t: string; seq: number; viewer: string | null }[] = [];
    c.onMessage = (m) => {
      if (m.t === 'view' || m.t === 'patch') seen.push({ t: m.t, seq: m.seq, viewer: c.view.viewer });
    };
    await c.hello();
    c.send({ t: 'start', kind: 'computer', config: bearsConfig('table-lag', { skipMulligans: true, startingPlayer: 'p1', startingLife: 20 }, false), computers: ['p2'], seed: 'lag' });
    await c.next('view');
    let shownAt = 0;
    for (let i = 0; i < 200 && c.seq < 40 && !c.view.result; i++) {
      if (c.seq > 25 && shownAt === 0) c.send({ t: 'shown', table: c.table, seq: (shownAt = c.seq) });
      if (c.view.pending?.player === 'p1') {
        const d = c.view.pending;
        const a = d.kind === 'priority' ? { type: 'pass', player: 'p1' } : fallback(d);
        await c.act(a);
      } else {
        const at = c.seq;
        await c.next('patch', (m) => m.seq > at, at === 0 ? 0 : undefined, 2000).catch(() => undefined);
        if (c.seq === at) await pause(50);
      }
    }
    expect(c.seq).toBeGreaterThanOrEqual(30);
    // Never more than 6 changes past both the last full view and the last change shown; the catch-up is a full view of the same player.
    let whole = 0;
    for (const m of seen) {
      if (m.t === 'view') whole = m.seq;
      else expect(m.seq - Math.max(whole, m.seq > shownAt ? shownAt : 0)).toBeLessThanOrEqual(6);
    }
    expect(seen.filter((m, i) => i > 0 && m.t === 'view').length).toBeGreaterThan(2);
    expect(seen.every((m) => m.viewer === 'p1')).toBe(true);
    expect(c.misfits).toBe(0);
  }, 20_000);

  it('refuses an action chosen from a view the game has moved on from, and one from a view not sent yet; changes nothing', async () => {
    const c = new FakeClient(service());
    await c.hello();
    c.send({ t: 'start', kind: 'hotseat', config: bearsConfig('table-stale', { skipMulligans: true, startingPlayer: 'p1' }) });
    await c.next('view');
    c.send({ t: 'handoff', table: c.table });
    const s0 = c.seq;
    const p1 = c.view.viewer!;
    expect((await c.act({ type: 'pass', player: p1 })).ok).toBe(true);
    expect(c.seq).toBe(s0 + 1);
    if (c.handoff) c.send({ t: 'handoff', table: c.table });
    const now = c.seq;
    const who = c.view.pending!.player;
    const count = c.messages.length;
    const stale = await c.act({ type: 'pass', player: who }, s0);
    expect(stale).toMatchObject({ ok: false, error: { message: STALE_MESSAGE } });
    const future = await c.act({ type: 'pass', player: who }, now + 5);
    expect(future).toMatchObject({ ok: false, error: { message: STALE_MESSAGE } });
    expect(c.seq).toBe(now);
    expect(c.messages.slice(count).every((m) => m.t === 'reply')).toBe(true);
  });

  it('never finds a stop toggle stale, and a stop toggle does not make the views before it stale', async () => {
    const c = new FakeClient(service());
    await c.hello();
    c.send({ t: 'start', kind: 'hotseat', config: bearsConfig('table-stops', { skipMulligans: true, startingPlayer: 'p1' }) });
    await c.next('view');
    c.send({ t: 'handoff', table: c.table });
    const chosenAt = c.seq;
    const p1 = c.view.viewer!;
    const stops = { ownTurn: ['upkeep' as const], opponentTurn: [], fullControl: false };
    // From a long-gone seq: still applied (`act` with setStops, and the `stops` message with an id).
    expect((await c.act({ type: 'setStops', player: p1, stops }, 0)).ok).toBe(true);
    const id = c.newId();
    const from = c.messages.length;
    c.send({ t: 'stops', table: c.table, player: p1, stops: { ...stops, fullControl: true }, id });
    expect(await c.next('reply', (m) => m.id === id, from)).toEqual({ t: 'reply', id, ok: true });
    expect(c.seq).toBeGreaterThan(chosenAt);
    // The pass chosen before the toggles is not stale: they were no progress.
    expect((await c.act({ type: 'pass', player: p1 }, chosenAt)).ok).toBe(true);
  });

  it('undo takes back the shown player\'s own last action, answered by its id', async () => {
    const c = new FakeClient(service());
    await c.hello();
    c.send({ t: 'start', kind: 'hotseat', config: bearsConfig('table-undo', { skipMulligans: true, startingPlayer: 'p1' }) });
    await c.next('view');
    c.send({ t: 'handoff', table: c.table });
    // Play a land (main phase 1 of p1's first turn: pass until there is one to play).
    for (let i = 0; i < 20; i++) {
      if (c.handoff) c.send({ t: 'handoff', table: c.table });
      if (c.legal.some((a) => a.kind === 'playLand')) break;
      expect((await c.act({ type: 'pass', player: c.view.pending!.player })).ok).toBe(true);
    }
    const land = c.legal.find((a) => a.kind === 'playLand')!;
    expect(land).toBeTruthy();
    const before = json(c.view);
    expect((await c.act(land.action)).ok).toBe(true);
    expect(c.canUndo).toBe(true);
    const id = c.newId();
    const from = c.messages.length;
    c.send({ t: 'undo', table: c.table, id });
    expect(await c.next('reply', (m) => m.id === id, from)).toMatchObject({ ok: true });
    expect(json(c.view)).toBe(before);
    const again = c.newId();
    c.send({ t: 'undo', table: c.table, id: again });
    expect(await c.next('reply', (m) => m.id === again)).toMatchObject({ ok: false });
  });
});

describe('the table channel: hidden information (CR 400.2)', () => {
  it('never names a card of a hand hidden from the screen\'s viewer: the hand-off cover shows no hand, each player sees only their own', async () => {
    const cfg = secretsConfig('table-secrets');
    const ref = new LocalConnection(cfg);
    const c = new FakeClient(service());
    let checked = 0;
    let covers = 0;
    let own = 0;
    /** A secret card is no secret once one of that name is in a public zone. */
    const isPublic = (name: string) => {
      const st = ref.session.state;
      return Object.values(st.objects).some((o) => st.defs[o.defId]?.name === name && o.zone !== 'hand' && o.zone !== 'library');
    };
    c.onMessage = (m, text) => {
      if (!c.held) return;
      const viewer = c.view.viewer;
      if (viewer === null && (m.t === 'view' || m.t === 'patch')) covers++;
      for (const [player, name] of Object.entries(SECRET)) {
        if (player === viewer && text.includes(name)) own++;
        if (player === viewer || isPublic(name)) continue;
        expect(text.includes(name), `${m.t} ${'seq' in m ? m.seq : ''} to viewer ${viewer} names ${name}`).toBe(false);
        checked++;
      }
    };
    await c.hello();
    c.send({ t: 'start', kind: 'hotseat', config: cfg });
    await c.next('view');
    for (let steps = 0; steps < 120 && !ref.view().result; steps++) {
      if (ref.handoff()) {
        ref.acceptHandoff();
        c.send({ t: 'handoff', table: c.table });
      }
      const action = await nextAction(ref, ref.view().pending!);
      expect((await c.act(action)).ok).toBe(true);
      expect(json(c.view)).toBe(json(ref.view()));
    }
    // The checks ran on a real game: many messages, several hand-off covers, both players shown.
    expect(checked).toBeGreaterThan(60);
    expect(own).toBeGreaterThan(5); // the names are in the messages to their own player: the check above is not vacuous
    expect(covers).toBeGreaterThan(4);
    expect(new Set(c.messages.flatMap((m) => (m.t === 'view' ? [m.view.viewer] : [])))).toEqual(new Set([null, 'p1', 'p2']));
    // While a hand-off is pending the view is the spectator's: no hand card has a definition.
    const cover = c.messages.find((m) => m.t === 'view' && m.view.viewer === null && m.handoff !== null) as Extract<TableServerMessage, { t: 'view' }>;
    expect(Object.values(cover.view.defs).map((d) => d.name)).not.toContain(SECRET.p1);
    expect(Object.values(cover.view.defs).map((d) => d.name)).not.toContain(SECRET.p2);
  });
});

describe('the table channel: a game against the computer', () => {
  it('the computer acts only once the table has shown the latest change (`shown`)', async () => {
    let thinking = 0;
    const s = service({ delayMs: () => 0, maxBoardWaitMs: 60_000, choose: (v, d, seed) => (thinking++, chooseAction(v, d, seed)) });
    const c = new FakeClient(s);
    await c.hello();
    c.send({ t: 'start', kind: 'computer', config: bearsConfig('table-pace', { skipMulligans: true, startingPlayer: 'p1' }), computers: ['p2'], seed: 'pace', speed: 'off' });
    expect(await c.next('table')).toMatchObject({ kind: 'computer', seats: ['p1'], viewer: 'p1' });
    await c.next('view');
    // The person passes (never `shown`) until the computer must decide: it does not, however long the table waits.
    for (let i = 0; i < 20 && c.view.pending?.player !== 'p2'; i++) expect((await c.act({ type: 'pass', player: 'p1' })).ok).toBe(true);
    expect(c.view.pending?.player).toBe('p2');
    const at = c.seq;
    await pause(150);
    expect(thinking).toBe(0);
    expect(c.seq).toBe(at);
    // An older view shown is not enough.
    c.send({ t: 'shown', table: c.table, seq: at - 1 });
    await pause(100);
    expect(c.seq).toBe(at);
    c.send({ t: 'shown', table: c.table, seq: at });
    await c.next('patch', (m) => m.seq === at + 1);
    expect(thinking).toBe(1);
    // The computer's own change is not shown yet: it waits again before its next decision.
    if (c.view.pending?.player === 'p2') {
      await pause(150);
      expect(c.seq).toBe(at + 1);
      expect(thinking).toBe(1);
      c.send({ t: 'shown', table: c.table, seq: at + 1 });
      await c.next('patch', (m) => m.seq === at + 2);
      expect(thinking).toBe(2);
    }
  });

  it('`leave` concedes for the players at the screen (CR 104.3a): the screen gets the result, the table is closed', async () => {
    const s = service({ delayMs: () => 0 });
    const c = new FakeClient(s);
    await c.hello();
    c.send({ t: 'start', kind: 'computer', config: bearsConfig('table-leave', { skipMulligans: true, startingPlayer: 'p1' }), computers: ['p2'] });
    await c.next('view');
    const id = c.table!;
    expect(s.tables.get(id)).not.toBeNull();
    const from = c.messages.length;
    c.send({ t: 'leave', table: id });
    const result = await c.next('result', () => true, from);
    expect(result).toMatchObject({ table: id, result: { winner: 'p2' } });
    expect(c.view.result).toMatchObject({ winner: 'p2' });
    await pause(0);
    expect(s.tables.get(id)).toBeNull();
    // A new socket cannot attach a closed table.
    const later = new FakeClient(s);
    await later.hello();
    later.send({ t: 'attach', table: id });
    expect(later.messages.at(-1)).toMatchObject({ t: 'notice', level: 'error' });
  });

  it('a second socket attaches the table (an app restart): it gets the table and a full view, the first is told', async () => {
    const s = service({ delayMs: () => 0 });
    const a = new FakeClient(s);
    await a.hello();
    a.send({ t: 'start', kind: 'hotseat', config: bearsConfig('table-attach') });
    await a.next('view');
    const b = new FakeClient(s);
    await b.hello();
    b.send({ t: 'attach', table: a.table });
    expect(await b.next('table')).toMatchObject({ table: a.table, kind: 'hotseat' });
    const v = await b.next('view');
    expect(v.seq).toBe(a.seq);
    expect(json(v.view)).toBe(json(a.view));
    expect(a.messages.at(-1)).toMatchObject({ t: 'notice', level: 'warning' });
    // The first socket's messages for the table are refused now.
    const r = await a.act({ type: 'concede', player: 'p1' });
    expect(r).toMatchObject({ ok: false, error: { message: 'No such table on this connection.' } });
  });

  it('refuses kinds it cannot build yet, and a bad config, with a notice', async () => {
    const c = new FakeClient(service());
    await c.hello();
    c.send({ t: 'start', kind: 'online', config: bearsConfig('x') });
    expect(c.messages.at(-1)).toMatchObject({ t: 'notice', level: 'error' });
    c.send({ t: 'start', kind: 'computer', config: bearsConfig('x') });
    expect(c.messages.at(-1)).toMatchObject({ t: 'notice', level: 'error', text: expect.stringMatching(/computer player/) });
    c.send({ t: 'start', kind: 'hotseat', config: { seed: 'x', players: [], defs: [] } });
    expect(c.messages.at(-1)).toMatchObject({ t: 'notice', level: 'error' });
  });
});
