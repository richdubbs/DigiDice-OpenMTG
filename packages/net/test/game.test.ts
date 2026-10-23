/**
 * Host-authoritative games over UDP on 127.0.0.1 (docs/design/online.md): a full scripted game between a host and a guest in which every message
 * the guest receives is inspected for the host's hidden cards (CR 400.2), and resuming after a simulated disconnect.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HIDDEN_DEF, viewFor, type Action, type GameEvent, type GameView, type LegalAction } from '@openmtg/engine';
import { autoAction } from '../src/game/autoplay';
import { GameGuest } from '../src/game/guest';
import { GameHost, type ManualProposal } from '../src/game/host';
import { FaultInjector } from '../src/link/faults';
import type { ViewMessage } from '../src/protocol/messages';
import { deck, FAST_LINK, fixtureDb, until } from './helpers';

/** A card only the host's deck contains, which its bot never casts or discards: its name must never reach the guest. */
const MARKER = 'Abzan Charm';
const HOST_DECK = deck({ Forest: 13, 'Grizzly Bears': 14, [MARKER]: 3 });
const GUEST_DECK = deck({ Mountain: 13, 'Hill Giant': 8, 'Raging Goblin': 9 });

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function startHost(extra: Partial<Parameters<typeof GameHost.start>[0]> = {}): Promise<GameHost> {
  const host = await GameHost.start({ name: 'Hana', deck: HOST_DECK, cards: fixtureDb(), port: 0, address: '127.0.0.1', seed: 'net-game-1', link: FAST_LINK, ...extra });
  cleanups.push(() => host.close());
  return host;
}

async function joinGuest(host: GameHost, extra: Partial<Parameters<typeof GameGuest.join>[0]> = {}): Promise<GameGuest> {
  const guest = await GameGuest.join({ host: '127.0.0.1', port: host.port, code: host.code, name: 'Gus', deck: GUEST_DECK, link: FAST_LINK, handshakeTimeout: 2000, ...extra });
  cleanups.push(() => guest.close());
  return guest;
}

/** The host's bot: the simple auto player, but it keeps the marker cards when it has to choose cards (discard to hand size, CR 514.1). */
function hostBot(host: GameHost, problems: string[]): () => void {
  const isMarker = (v: GameView, id: string) => v.defs[v.objects[id]?.defId ?? '']?.name === MARKER;
  return () => {
    const s = host.state;
    if (!s || s.result) return;
    const v = host.view()!;
    let a: Action | null = autoAction(v, host.legal(), host.player);
    if (a?.type === 'answer' && a.answer.kind === 'chooseObjects' && v.pending?.kind === 'chooseObjects') {
      const d = v.pending;
      const ids = [...d.options].sort((x, y) => Number(isMarker(v, x)) - Number(isMarker(v, y))).slice(0, d.min);
      a = { ...a, answer: { kind: 'chooseObjects', ids } };
    }
    if (!a) return;
    const r = host.act(a);
    if (!r.ok) problems.push(`host: ${r.error.message}`);
  };
}

/** The guest's bot acts on the latest view; a rejected action is retried only if a newer view arrived meanwhile. */
function guestBot(guest: GameGuest, problems: string[], limit = 4000): () => Promise<void> {
  let busy = false;
  let count = 0;
  return async () => {
    if (busy) return;
    busy = true;
    try {
      for (;;) {
        const v = guest.view;
        if (!v || v.result || !guest.connected) return;
        const a = autoAction(v, guest.legal, guest.player);
        if (!a) return;
        if (++count > limit) throw new Error('guest bot: too many actions');
        const seq = guest.seq;
        const r = await guest.act(a);
        if (!r.ok && guest.seq === seq) {
          problems.push(`guest: ${r.error.message}`);
          return;
        }
      }
    } finally {
      busy = false;
    }
  };
}

function hostCardsHidden(view: GameView): { hidden: number } {
  let hidden = 0;
  for (const o of Object.values(view.objects)) {
    if (o.owner !== 'p1' || (o.zone !== 'hand' && o.zone !== 'library')) continue;
    if (o.revealedTo?.includes('p2')) continue;
    expect(o.defId).toBe(HIDDEN_DEF);
    expect(o.stack).toBeUndefined();
    hidden++;
  }
  return { hidden };
}

/** A view as it travels: JSON (fields that are undefined are not sent). The guest's view must be exactly the host's `viewFor` for it (H1: no renaming). */
function normalized(view: GameView): unknown {
  return JSON.parse(JSON.stringify(view));
}

describe('online game (host-authoritative)', () => {
  it.each([
    ['a clean path', undefined],
    ['a path with loss, duplication and reordering', { loss: 0.05, duplicate: 0.05, delay: 0.1, maxDelayMs: 20 }],
  ])('plays a full game over %s; the guest never receives the host\'s hand or library contents (CR 400.2)', async (_label, faults) => {
    const problems: string[] = [];
    const host = await startHost({ ...(faults ? { faults: new FaultInjector({ ...faults, seed: 21 }) } : {}), seed: faults ? 'net-game-2' : 'net-game-1' });
    const stepHost = hostBot(host, problems);
    host.on('view', () => setImmediate(stepHost));
    const inbox: unknown[] = [];
    const guest = await joinGuest(host, { inspect: (m) => inbox.push(m), ...(faults ? { faults: new FaultInjector({ ...faults, seed: 22 }) } : {}) });
    const stepGuest = guestBot(guest, problems);
    guest.on('view', () => setImmediate(() => void stepGuest()));
    setImmediate(() => void stepGuest());
    setImmediate(stepHost);

    await until(() => host.state?.result != null, 90000, 'the end of the game');
    await until(() => guest.view?.result != null, 5000, 'the final view at the guest');
    expect(problems).toEqual([]);
    expect(guest.player).toBe('p2');
    expect(guest.seq).toBe(host.state!.actionCount); // the guest saw the view after the last action
    expect(host.state!.turn.number).toBeGreaterThan(5);

    // The guest's final view is exactly what viewFor gives the guest (CR 400.2: viewFor hides the host's cards; the host adds and renames nothing).
    expect(normalized(guest.view!)).toEqual(normalized(viewFor(host.state!, 'p2')));

    // Inspect every message the guest received.
    let views = 0;
    let hiddenSeen = 0;
    let hostDraws = 0;
    let ownDraws = 0;
    for (const m of inbox) {
      const text = JSON.stringify(m);
      expect(text.includes(MARKER)).toBe(false);
      const t = (m as { type: string }).type;
      expect(['welcome', 'view', 'error', 'chat', 'bye']).toContain(t);
      if (t !== 'view') continue;
      const vm = m as ViewMessage;
      views++;
      expect(vm.view.viewer).toBe('p2');
      for (const key of ['rng', 'seed', 'suspended']) expect(key in vm.view).toBe(false);
      hiddenSeen += hostCardsHidden(vm.view).hidden;
      for (const e of vm.events as GameEvent[]) {
        if (e.type === 'drew') {
          if (e.player === 'p1') hostDraws++;
          else ownDraws++;
        }
        // a card of the host moving into or inside a hidden zone keeps its identity to itself (redact.ts)
        if (e.type === 'zoneChanged' && e.owner === 'p1' && (e.to === 'hand' || e.to === 'library')) {
          expect(e.name).toBe('');
          expect(e.before).toBeUndefined();
        }
      }
      // the guest's own hand is visible to the guest
      for (const o of Object.values(vm.view.objects)) if (o.owner === 'p2' && o.zone === 'hand') expect(o.defId).not.toBe(HIDDEN_DEF);
    }
    expect(views).toBeGreaterThan(30);
    expect(hiddenSeen).toBeGreaterThan(100);
    expect(hostDraws).toBeGreaterThan(3);
    expect(ownDraws).toBeGreaterThan(3);
    // The marker really was in the host's hand or library the whole game (the check above was not vacuous).
    const markers = Object.values(host.state!.objects).filter((o) => o.defId === MARKER);
    expect(markers).toHaveLength(3);
    for (const o of markers) expect(['hand', 'library']).toContain(o.zone);
  }, 120000);

  it('resumes after a simulated disconnect: the guest reconnects and gets the latest view', async () => {
    const hostFaults = new FaultInjector({ seed: 5 });
    const guestFaults = new FaultInjector({ seed: 6 });
    const link = { ...FAST_LINK, idleTimeout: 500 };
    const host = await startHost({ faults: hostFaults, link });
    const guest = await joinGuest(host, { faults: guestFaults, link, handshakeTimeout: 300, reconnect: { attempts: 100, delayMs: 50 } });
    await until(() => guest.view !== null, 3000, 'the first view');
    const events: string[] = [];
    host.on('guestLeft', () => events.push('host: guest left'));
    host.on('guestResumed', () => events.push('host: guest resumed'));
    guest.on('disconnected', () => events.push('guest: disconnected'));
    guest.on('reconnected', () => events.push('guest: reconnected'));

    // Pull the cable.
    hostFaults.config.blackhole = true;
    guestFaults.config.blackhole = true;
    await until(() => events.includes('guest: disconnected') && events.includes('host: guest left'), 5000, 'both sides to notice');
    expect(guest.connected).toBe(false);
    const r = await guest.act({ type: 'pass', player: 'p2' });
    expect(r.ok).toBe(false);

    // The game goes on at the host meanwhile (here: the host changes its stops, an action like any other).
    const seqBefore = guest.seq;
    expect(host.act({ type: 'setStops', player: 'p1', stops: { ownTurn: ['main1'], opponentTurn: [], fullControl: false } }).ok).toBe(true);
    expect(host.act({ type: 'setStops', player: 'p1', stops: { ownTurn: ['main2'], opponentTurn: [], fullControl: false } }).ok).toBe(true);

    // Plug it back in.
    hostFaults.config.blackhole = false;
    guestFaults.config.blackhole = false;
    await until(() => events.includes('guest: reconnected') && guest.seq === seqBefore + 2, 10000, 'the resumed view');
    expect(events).toContain('host: guest resumed');
    expect(guest.player).toBe('p2');
    expect(normalized(guest.view!)).toEqual(normalized(viewFor(host.state!, 'p2')));

    // And the guest can play on.
    const problems: string[] = [];
    const before = host.state!.actionCount;
    const stepGuest = guestBot(guest, problems, 50);
    const stepHost = hostBot(host, problems);
    host.on('view', () => setImmediate(stepHost));
    guest.on('view', () => setImmediate(() => void stepGuest()));
    setImmediate(stepHost);
    void stepGuest();
    await until(() => host.state!.actionCount > before + 5, 10000, 'play after the resume');
    expect(problems).toEqual([]);
  }, 60000);

  it('refuses a wrong join code', async () => {
    const host = await startHost();
    const other = host.code.startsWith('0') ? `1${host.code.slice(1)}` : `0${host.code.slice(1)}`;
    await expect(joinGuest(host, { code: other })).rejects.toMatchObject({ code: 'badCode' });
    expect(host.started).toBe(false);
  });

  it('refuses a deck the host cannot resolve, naming the unknown card and suggesting names', async () => {
    const host = await startHost();
    const err = await joinGuest(host, { deck: deck({ Mountain: 20, 'Grizly Bears': 4 }) }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'deckRejected' });
    expect((err as { details: string[] }).details.join(' ')).toMatch(/Unknown card "Grizly Bears".*Grizzly Bears/);
    expect(host.started).toBe(false);
  });

  it('validates decks for the host\'s format (CR 100.2a)', async () => {
    await expect(startHost({ format: 'modern' })).rejects.toMatchObject({ code: 'deckRejected' }); // 30 cards
    const big = deck({ Forest: 30, 'Grizzly Bears': 30 });
    const host = await startHost({ format: 'modern', deck: big, validate: (d, f) => ({ errors: d.main.length && f === 'modern' ? [] : ['?'], warnings: ['custom validator'] }) });
    const guest = await joinGuest(host, { deck: big });
    expect(guest.warnings).toContain('custom validator');
    expect(host.warnings).toContain('custom validator'); // the host's own deck warnings are kept too
  });

  // Actions for the other player, startGame, malformed answers, resends and stale actions are tested in process (host-guard.test.ts): the socket
  // tests here play normal games only.

  it('refuses a second guest (gameFull), also while the seated guest is away; the seated guest resumes with its token', async () => {
    const host = await startHost();
    const guest = await joinGuest(host, { reconnect: { attempts: 0 } });
    await until(() => guest.view !== null);
    await expect(joinGuest(host, { name: 'Intruder' })).rejects.toMatchObject({ code: 'gameFull' });
    const token = guest.session!;
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    guest.connection!.destroy('crashed'); // no bye: the host still holds the seat
    await expect(joinGuest(host, { name: 'Intruder' })).rejects.toMatchObject({ code: 'gameFull' });
    // A new guest process (the old one is gone) takes the seat back with the token.
    const back = await joinGuest(host, { resume: token, deck: { main: [], sideboard: [] } });
    await until(() => back.view !== null, 3000, 'the resumed view');
    expect(back.player).toBe('p2');
    expect(host.guestConnected).toBe(true);
    expect((await back.act({ type: 'setStops', player: 'p2', stops: { ownTurn: [], opponentTurn: [], fullControl: false } })).ok).toBe(true);
  });

  it('relays chat both ways', async () => {
    const host = await startHost();
    const guest = await joinGuest(host);
    const atHost: string[] = [];
    const atGuest: string[] = [];
    host.on('chat', (t) => atHost.push(t));
    guest.on('chat', (t) => atGuest.push(t));
    guest.chat('gl hf');
    host.chat('you too');
    await until(() => atHost.length === 1 && atGuest.length === 1);
    expect(atHost).toEqual(['gl hf']);
    expect(atGuest).toEqual(['you too']);
  });

  it('FAST5 MX7, CR 400.11a: both sideboards are in the game, outside it; the guest sees only its own (CR 400.2)', async () => {
    const host = await startHost({ deck: deck({ Forest: 13, 'Grizzly Bears': 14, [MARKER]: 3 }, { 'Hill Giant': 2 }) });
    const guest = await joinGuest(host, { deck: deck({ Mountain: 13, 'Hill Giant': 8, 'Raging Goblin': 9 }, { 'Grizzly Bears': 1 }) });
    await until(() => guest.view !== null);
    const outside = host.state!.outside!;
    expect(outside[host.player]!.map((d) => host.state!.defs[d]!.name)).toEqual(['Hill Giant', 'Hill Giant']);
    expect(outside[guest.player]!.map((d) => host.state!.defs[d]!.name)).toEqual(['Grizzly Bears']);
    expect(Object.keys(guest.view!.outside ?? {})).toEqual([guest.player]);
  });

  it('CR 103.5, 400.2: after a mulligan the guest cannot find the cards of its old hand in its shuffled library', async () => {
    const host = await startHost();
    const inbox: ViewMessage[] = [];
    const guest = await joinGuest(host, { inspect: (m) => { if ((m as { type?: string }).type === 'view') inbox.push(m as ViewMessage); } });
    const stepHost = () => {
      const v = host.view();
      if (!v || v.pending?.player !== 'p1') return;
      const a = autoAction(v, host.legal(), 'p1');
      if (a) host.act(a);
    };
    host.on('view', () => setImmediate(stepHost));
    setImmediate(stepHost);
    let hand: { id: string; cardId: string | undefined }[] | null = null;
    let mark = 0;
    let seqAt = 0;
    let busy = false;
    const stepGuest = async () => {
      const v = guest.view;
      if (busy || hand || !v || v.pending?.player !== 'p2') return;
      busy = true;
      if (v.pending.kind === 'mulligan') {
        hand = v.zones.hand['p2']!.map((id) => ({ id, cardId: v.objects[id]!.cardId }));
        mark = inbox.length;
        seqAt = guest.seq;
        await guest.act({ type: 'answer', player: 'p2', decisionId: v.pending.id, answer: { kind: 'mulligan', keep: false } });
      } else {
        const a = autoAction(v, guest.legal, 'p2');
        if (a) await guest.act(a);
      }
      busy = false;
    };
    guest.on('view', () => setImmediate(() => void stepGuest()));
    setImmediate(() => void stepGuest());
    await until(() => hand !== null && guest.seq > seqAt && guest.view?.pending?.player === 'p2', 5000, 'the next decision after the mulligan');

    const kept = hand!;
    expect(kept).toHaveLength(7);
    expect(kept.every((h) => h.cardId !== undefined)).toBe(true); // the guest saw its own hand, cardIds included
    // Follow each old hand card through every event the guest received since (oldId -> newId).
    const now = new Map(kept.map((h) => [h.id, h.id]));
    for (const vm of inbox.slice(mark)) {
      for (const e of vm.events) {
        if (e.type !== 'zoneChanged' || e.newId === null) continue;
        for (const [k, cur] of now) if (cur === e.oldId) now.set(k, e.newId);
      }
    }
    const v = guest.view!;
    const ids = new Set(kept.map((h) => h.id));
    const cards = new Set(kept.map((h) => h.cardId));
    const followed = new Set(now.values());
    for (const id of v.zones.library['p2']!) {
      expect(ids.has(id)).toBe(false);
      expect(followed.has(id)).toBe(false);
      expect(v.objects[id]!.cardId).toBeUndefined();
      expect(cards.has(v.objects[id]!.cardId)).toBe(false);
    }
    // Not vacuous: cards of the old hand really are in the library now.
    const s = host.state!;
    expect(s.zones.library['p2']!.filter((id) => cards.has(s.objects[id]!.cardId)).length).toBeGreaterThan(0);
  });

  it('a guest\'s manual adjustments need the host\'s consent: it cannot move the host\'s hidden cards or set its life on its own (CR 400.2)', async () => {
    const host = await startHost({ deck: deck({ Forest: 20, [MARKER]: 20 }), gameOptions: { skipMulligans: true } as never });
    const guest = await joinGuest(host, { deck: deck({ Mountain: 20, Fork: 20 }) });
    const proposals: ManualProposal[] = [];
    host.on('manualProposal', (p) => proposals.push(p));
    const stepHost = () => {
      const v = host.view();
      if (!v || v.result || v.pending?.player !== 'p1') return;
      const a = autoAction(v, host.legal(), 'p1');
      if (a) host.act(a);
    };
    host.on('view', () => setImmediate(stepHost));
    setImmediate(stepHost);
    await until(() => guest.view !== null);
    // The guest plays Mountains and casts Fork (fully manual in the fixtures) until Fork resolves by hand.
    for (let i = 0; i < 2000 && guest.view!.pending?.kind !== 'manualResolve'; i++) {
      const v = guest.view!;
      if (v.result) break;
      if (v.pending?.player !== 'p2' || guest.seq !== host.state!.actionCount) {
        await new Promise((r) => setTimeout(r, 2));
        continue;
      }
      let a = autoAction(v, guest.legal, 'p2');
      if (v.pending.kind === 'priority') a = (guest.legal.find((l) => l.kind === 'playLand') ?? guest.legal.find((l) => l.kind === 'cast'))?.action ?? a;
      if (a) await guest.act(a);
    }
    const v = guest.view!;
    const d = v.pending!;
    expect(d.kind).toBe('manualResolve');
    const s0 = host.state!;
    const before = { exile: s0.zones.exile.length, hand: s0.zones.hand['p1']!.length, library: s0.zones.library['p1']!.length, life: s0.players.find((p) => p.id === 'p1')!.life };
    const snapshot = () => {
      const s = host.state!;
      return { exile: s.zones.exile.length, hand: s.zones.hand['p1']!.length, library: s.zones.library['p1']!.length, life: s.players.find((p) => p.id === 'p1')!.life };
    };
    const cheat = guest.act({
      type: 'answer', player: 'p2', decisionId: d.id,
      answer: { kind: 'manualResolve', ops: [
        { op: 'move', object: v.zones.library['p1']![0]!, to: 'exile' },
        ...v.zones.hand['p1']!.slice(0, 2).map((id) => ({ op: 'move' as const, object: id, to: 'exile' as const })),
        { op: 'life', player: 'p1', delta: -100 },
      ] },
    });
    await until(() => proposals.length === 1, 3000, 'the proposal at the host');
    expect(snapshot()).toEqual(before); // nothing applied yet
    const p = proposals[0]!;
    expect(p.player).toBe('p2');
    expect(p.sourceName).toBe('Fork');
    expect(p.ops).toHaveLength(4);
    expect(p.lines.join('\n')).toMatch(/library/);
    expect(p.lines.join('\n')).toMatch(/-100/);
    expect(host.pendingManual?.id).toBe(p.id);
    expect(host.answerManual(p.id, false, 'Fork does not do that.')).toEqual({ ok: true });
    expect(await cheat).toMatchObject({ ok: false, error: { code: 'manualRejected' } });
    expect(snapshot()).toEqual(before);
    expect(host.pendingManual).toBeNull();
    for (const id of guest.view!.zones.exile) expect(guest.view!.defs[guest.view!.objects[id]!.defId]?.name).not.toBe(MARKER);

    // A fair answer, accepted by the host, is applied.
    const fair = guest.act({ type: 'answer', player: 'p2', decisionId: d.id, answer: { kind: 'manualResolve', ops: [{ op: 'life', player: 'p2', delta: -1 }] } });
    await until(() => proposals.length === 2, 3000, 'the second proposal');
    expect(host.answerManual(proposals[1]!.id, true)).toEqual({ ok: true });
    expect(await fair).toEqual({ ok: true });
    expect(host.state!.players.find((pl) => pl.id === 'p2')!.life).toBe(19);
    expect(host.answerManual(proposals[1]!.id, true)).toMatchObject({ ok: false }); // answered already
  }, 30000);


  it('a restarted guest continues its action ids after the last one the host applied', async () => {
    const host = await startHost();
    const guest = await joinGuest(host, { reconnect: { attempts: 0 } });
    await until(() => guest.view !== null);
    const stops: Extract<Action, { type: 'setStops' }> = { type: 'setStops', player: 'p2', stops: { ownTurn: ['main1'], opponentTurn: [], fullControl: false } };
    // Two different stops (an unchanged setStops is answered without being applied, audit 2026-10-12 M4).
    expect(await guest.act(stops)).toEqual({ ok: true });
    expect(await guest.act({ ...stops, stops: { ...stops.stops, ownTurn: ['main2'] } })).toEqual({ ok: true });
    const count = host.state!.actionCount;
    // The same stops again: nothing to apply; the host answers with an ack (audit M5: no full view), which settles the guest's act.
    expect(await guest.act({ ...stops, stops: { ...stops.stops, ownTurn: ['main2'] } })).toEqual({ ok: true });
    expect(host.state!.actionCount).toBe(count);
    const token = guest.session!;
    guest.connection!.destroy('crashed');
    const back = await joinGuest(host, { resume: token, deck: { main: [], sideboard: [] } });
    await until(() => back.view !== null, 3000, 'the resumed view');
    expect(await back.act(stops)).toEqual({ ok: true });
    expect(host.state!.actionCount).toBe(count + 1); // applied, not taken for a repeat of id 1
  });

  it('the host can end the game for a guest that does not come back (its concession, CR 104.3a)', async () => {
    const host = await startHost();
    const left: [string, boolean, boolean][] = [];
    host.on('guestLeft', (r, final, bye) => left.push([r, final, bye]));
    const guest = await joinGuest(host, { reconnect: { attempts: 0 } });
    await until(() => guest.view !== null);
    expect(host.forfeitGuest()).toMatchObject({ ok: false }); // the guest is here
    await guest.close('gone for good');
    await until(() => left.length === 1, 3000, 'the host to notice');
    expect(left[0]![1]).toBe(false); // the game is not over: the seat waits for a resume
    expect(left[0]![2]).toBe(true); // CL4: it said bye (it left on purpose), not a dropped link
    expect(host.forfeitGuest()).toEqual({ ok: true });
    expect(host.state!.result).toMatchObject({ winner: 'p1' });
  });

  it('CL4: a guest whose link drops (no bye) is reported as a drop, not as leaving', async () => {
    const link = { ...FAST_LINK, idleTimeout: 300 };
    const host = await startHost({ link });
    const left: [string, boolean, boolean][] = [];
    host.on('guestLeft', (r, final, bye) => left.push([r, final, bye]));
    const guest = await joinGuest(host, { link, reconnect: { attempts: 0 } });
    await until(() => guest.view !== null);
    guest.connection!.destroy('crashed');
    await until(() => left.length === 1, 5000, 'the host to notice the drop');
    expect(left[0]!.slice(1)).toEqual([false, false]);
    expect(host.state!.result).toBeNull(); // the seat waits for a resume
  });

  it('a guest leaving after the game is over is final; a host closing reports no guest leaving', async () => {
    const host = await startHost();
    const left: [string, boolean][] = [];
    host.on('guestLeft', (r, final) => left.push([r, final]));
    const guest = await joinGuest(host);
    await until(() => guest.view !== null);
    expect((await guest.act({ type: 'concede', player: 'p2' })).ok).toBe(true);
    await guest.close();
    await until(() => left.length === 1, 3000, 'the host to notice');
    expect(left[0]![1]).toBe(true);

    const host2 = await startHost();
    const left2: string[] = [];
    host2.on('guestLeft', (r) => left2.push(r));
    const guest2 = await joinGuest(host2);
    await until(() => guest2.view !== null);
    await host2.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(left2).toEqual([]);
  });

  it('types the legal actions of a view as the engine\'s LegalAction (milestone 8 GameConnection)', async () => {
    const host = await startHost();
    const guest = await joinGuest(host);
    await until(() => guest.view !== null);
    const legal: readonly LegalAction[] = guest.legal;
    for (const l of legal) expect(['pass', 'playLand', 'cast', 'activate']).toContain(l.kind);
  });
});
