/**
 * In a TWO-player online game the host's own by-hand (manual) changes need the guest's approval, the same rule as a 3-4
 * player game ("every other player approves"). Until then (milestone 9, kept by M12-5a) they applied at once. The guest sees the
 * proposal described from its own view (CR 400.2) and answers with `vote`; the host's UI gets `manualPending` (waiting for the guest) and
 * `manualClosed` (applied, rejected by the guest with its reason, or withdrawn when the host acts otherwise). The guest's own proposals keep milestone 9's
 * rule (the host answers them; no proposal message reaches the guest). In process (MemoryTransport), normal traffic only.
 *
 * Fork is fully manual in the fixtures: cast without a target, it resolves by hand (a `manualResolve` decision for its controller).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Action, GameView, ManualOp } from '@openmtg/engine';
import { autoAction } from '../../src/game/autoplay';
import { GameGuest } from '../../src/game/guest';
import { GameHost, GUEST_MESSAGE_BYTES, GUEST_MESSAGE_DEPTH, type ManualProposal } from '../../src/game/host';
import { MemoryTransport } from '../../src/link/memory';
import { deck, FAST_LINK, fixtureDb, until } from '../helpers';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

type Msg = { type?: string; proposal?: { id: number; player: string; lines: string[]; waiting: string[] } | number; outcome?: string; by?: string; reason?: string };
const of = (inbox: unknown[], type: string) => (inbox as Msg[]).filter((m) => m.type === type);

/** A two-player game: the host (Hana) plays Mountains and Fork; the guest (Gus) is a bot. Returns once Fork resolves by hand for the host. */
async function hostResolvesByHand(seed: string) {
  const transport = new MemoryTransport({ maxReceiveBytes: GUEST_MESSAGE_BYTES, maxReceiveDepth: GUEST_MESSAGE_DEPTH });
  const host = await GameHost.attach({ name: 'Hana', deck: deck({ Mountain: 20, Fork: 20 }), cards: fixtureDb(), seed, gameOptions: { skipMulligans: true } as never }, transport);
  cleanups.push(() => host.close('test over', 200));
  const inbox: unknown[] = [];
  const guest = await GameGuest.join({
    host: 'memory', port: 0, code: host.code, name: 'Gus', deck: deck({ Forest: 20, 'Grizzly Bears': 20 }), link: FAST_LINK,
    connector: (o) => transport.connect(o.link), inspect: (m) => inbox.push(m),
  });
  cleanups.push(() => guest.close());
  await until(() => guest.view !== null, 5000, 'the first view');
  // The guest's bot: it answers whatever it is asked (never a by-hand change of its own: it has no manual cards).
  let stopped = false;
  let busy = false;
  const stepGuest = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      for (let n = 0; n < 1000 && !stopped; n++) {
        const v = guest.view;
        if (!v || v.result || v.pending?.player !== 'p2' || guest.seq !== host.seq) return;
        const a = autoAction(v, guest.legal, 'p2');
        if (!a) return;
        const r = await guest.act(a);
        if (!r.ok) return;
      }
    } finally {
      busy = false;
    }
  };
  guest.on('view', () => void stepGuest());
  cleanups.unshift(() => {
    stopped = true;
  });
  void stepGuest();
  // The host plays Mountains and casts Fork until Fork resolves by hand.
  let v: GameView | null = null;
  for (let i = 0; i < 4000; i++) {
    v = host.view();
    if (v?.pending?.kind === 'manualResolve' && v.pending.player === 'p1') break;
    if (!v || v.result) throw new Error('the game ended before Fork resolved');
    if (v.pending?.player !== 'p1') {
      await new Promise((r) => setTimeout(r, 2));
      continue;
    }
    let a: Action | null = autoAction(v, host.legal(), 'p1');
    if (v.pending.kind === 'priority') a = (host.legal().find((l) => l.kind === 'playLand') ?? host.legal().find((l) => l.kind === 'cast'))?.action ?? a;
    if (a) host.act(a);
  }
  if (v?.pending?.kind !== 'manualResolve') throw new Error('Fork never resolved by hand');
  const pending: ManualProposal[] = [];
  const closed: unknown[][] = [];
  host.on('manualPending', (p) => pending.push(p));
  host.on('manualClosed', (...a) => closed.push(a));
  const hostProposals: ManualProposal[] = [];
  host.on('manualProposal', (p) => hostProposals.push(p));
  const decision = v.pending;
  const answer = (ops: ManualOp[]): Action => ({ type: 'answer', player: 'p1', decisionId: decision.id, answer: { kind: 'manualResolve', ops } });
  const life = (id: string) => host.state!.players.find((p) => p.id === id)!.life;
  return { host, guest, inbox, pending, closed, hostProposals, answer, life, decision };
}

describe('a two-player host\'s by-hand changes need the guest\'s approval', () => {
  it('approved: nothing is applied until the guest accepts; the guest reads it as it may know the game; both hear it applied', async () => {
    const s = await hostResolvesByHand('duel-manual-1');
    const own = s.host.view()!.zones.hand['p1']![0]!;
    const ownName = s.host.state!.defs[s.host.state!.objects[own]!.defId]!.name;
    expect(s.host.act(s.answer([{ op: 'life', player: 'p2', delta: -3 }, { op: 'move', object: own, to: 'graveyard' }]))).toEqual({ ok: true });
    // The host's UI: its own proposal, waiting for the guest; nothing applied; the host is not asked to answer it.
    expect(s.pending).toHaveLength(1);
    expect(s.pending[0]).toMatchObject({ player: 'p1', sourceName: 'Fork', waiting: ['p2'] });
    expect(s.pending[0]!.lines).toEqual(['Gus\'s life -3.', `Move ${ownName} (Hana's hand) to graveyard.`]);
    expect(s.hostProposals).toEqual([]);
    expect(s.host.pendingManual).toBeNull();
    expect(s.life('p2')).toBe(20);
    expect(s.host.view()!.pending?.kind).toBe('manualResolve'); // the decision waits for the answer
    // The guest: the proposal in words from its own view (the host's hand card is a hidden card, CR 400.2); never the raw operations.
    await until(() => s.guest.proposal !== null, 3000, 'the proposal at the guest');
    expect(s.guest.proposal).toEqual({ id: s.pending[0]!.id, player: 'p1', sourceName: 'Fork', text: expect.any(String) as string, lines: ['Gus\'s life -3.', 'Move a hidden card (Hana\'s hand) to graveyard.'], waiting: ['p2'] });
    expect(JSON.stringify(of(s.inbox, 'manualProposal'))).not.toContain('"ops"');
    // The host cannot answer its own proposal.
    expect(s.host.answerManual(s.pending[0]!.id, true)).toMatchObject({ ok: false, error: { code: 'manualRejected' } });
    // The guest accepts: applied as the host's answer.
    expect(s.guest.vote(s.pending[0]!.id, true)).toBe(true);
    await until(() => s.closed.length === 1, 3000, 'the close');
    expect(s.closed[0]).toEqual([s.pending[0]!.id, 'applied', undefined, undefined]);
    expect(s.life('p2')).toBe(17);
    expect(s.host.state!.objects[own]?.zone ?? 'graveyard').not.toBe('hand');
    await until(() => of(s.inbox, 'manualClosed').length === 1, 3000, 'the close at the guest');
    expect(of(s.inbox, 'manualClosed')[0]).toMatchObject({ proposal: s.pending[0]!.id, outcome: 'applied' });
    expect(s.guest.proposal).toBeNull();
  }, 60000);

  it('rejected: the guest\'s rejection and reason reach the host; nothing is applied and the host still resolves Fork', async () => {
    const s = await hostResolvesByHand('duel-manual-2');
    expect(s.host.act(s.answer([{ op: 'life', player: 'p2', delta: -5 }]))).toEqual({ ok: true });
    await until(() => s.guest.proposal !== null, 3000, 'the proposal at the guest');
    const id = s.pending[0]!.id;
    expect(s.guest.vote(id, false, 'Fork does not do that')).toBe(true);
    await until(() => s.closed.length === 1, 3000, 'the close');
    expect(s.closed[0]).toEqual([id, 'rejected', 'p2', 'Fork does not do that']);
    expect(s.life('p2')).toBe(20);
    await until(() => of(s.inbox, 'manualClosed').length === 1, 3000, 'the close at the guest');
    expect(of(s.inbox, 'manualClosed')[0]).toMatchObject({ proposal: id, outcome: 'rejected', by: 'p2', reason: 'Fork does not do that' });
    // A second answer is refused (the guest is told by an error), and the host's decision is still open: a note needs nobody's consent.
    const errors: string[] = [];
    s.guest.on('error', (e) => errors.push(e.message));
    s.guest.vote(id, true);
    await until(() => errors.length === 1, 3000, 'the refusal');
    expect(errors[0]).toMatch(/no such proposal/);
    expect(s.host.view()!.pending?.id).toBe(s.decision.id);
    expect(s.host.act(s.answer([{ op: 'note', text: 'Fork had no spell to copy.' }]))).toEqual({ ok: true });
    expect(s.host.view()!.pending?.kind).not.toBe('manualResolve');
    expect(s.pending).toHaveLength(1);
  }, 60000);

  it('withdrawn: the host acting otherwise withdraws its waiting proposal; the guest hears it and can no longer answer', async () => {
    const s = await hostResolvesByHand('duel-manual-3');
    expect(s.host.act(s.answer([{ op: 'life', player: 'p1', delta: 4 }]))).toEqual({ ok: true });
    await until(() => s.guest.proposal !== null, 3000, 'the proposal at the guest');
    const id = s.pending[0]!.id;
    // Instead the host resolves Fork with a note only (no consent needed): applied at once, and the proposal is withdrawn.
    expect(s.host.act(s.answer([{ op: 'note', text: 'Never mind.' }]))).toEqual({ ok: true });
    expect(s.closed[0]).toEqual([id, 'withdrawn', undefined, undefined]);
    expect(s.life('p1')).toBe(20);
    await until(() => of(s.inbox, 'manualClosed').length === 1, 3000, 'the close at the guest');
    expect(of(s.inbox, 'manualClosed')[0]).toMatchObject({ proposal: id, outcome: 'withdrawn' });
    expect(s.guest.proposal).toBeNull();
    const errors: string[] = [];
    s.guest.on('error', (e) => errors.push(e.message));
    s.guest.vote(id, true);
    await until(() => errors.length === 1, 3000, 'the refusal');
    expect(errors[0]).toMatch(/no such proposal/);
    expect(s.life('p1')).toBe(20);
  }, 60000);
});
