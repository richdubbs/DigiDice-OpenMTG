/**
 * M12-5a (m12 design 6): by-hand (manual) changes online need the approval of every other player still in the game, the host's own
 * proposals too. Each player is shown the proposal as they may know the game (CR 400.2): their own cards by name, everyone else's hidden cards as hidden
 * cards; the raw operations never reach another screen. In process (MemoryTransport), normal traffic only.
 *
 * Fork is fully manual in the fixtures: cast without a target, it resolves by hand (a `manualResolve` decision for its controller).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Action, GameView, LegalAction, PlayerId } from '@openmtg/engine';
import { autoAction } from '../../src/game/autoplay';
import type { ManualProposal } from '../../src/game/host';
import { ManualVotes } from '../../src/game/manual';
import { deck } from '../helpers';
import { openTable, runBots, until, type Table } from './table';

const FORK_DECK = deck({ Mountain: 20, Fork: 20 });
const open: Table[] = [];
afterEach(async () => {
  for (const t of open.splice(0)) await t.close();
});

/** Plays lands and casts Fork for `me` (from what it sees) until Fork resolves by hand; returns the view with the manualResolve decision. */
async function untilManual(me: PlayerId, side: { view: () => GameView | null; legal: () => LegalAction[]; act: (a: Action) => Promise<unknown>; synced: () => boolean }): Promise<GameView> {
  for (let i = 0; i < 4000; i++) {
    const v = side.view();
    if (v?.pending?.kind === 'manualResolve' && v.pending.player === me) return v;
    if (!v || v.result) throw new Error('the game ended before Fork resolved');
    if (v.pending?.player !== me || !side.synced()) {
      await new Promise((r) => setTimeout(r, 2));
      continue;
    }
    let a: Action | null = autoAction(v, side.legal(), me);
    if (v.pending.kind === 'priority') a = (side.legal().find((l) => l.kind === 'playLand') ?? side.legal().find((l) => l.kind === 'cast'))?.action ?? a;
    if (a) await side.act(a);
  }
  throw new Error('Fork never resolved by hand');
}

type Msg = { type?: string; proposal?: { id: number; player: string; lines: string[]; waiting: string[] } | number; outcome?: string; by?: string };
const of = (inbox: unknown[], type: string) => (inbox as Msg[]).filter((m) => m.type === type);

async function forkTable(forkSeat: number): Promise<Table> {
  const t = await openTable(3, { host: { gameOptions: { skipMulligans: true } as never }, order: [2, 3], decks: { [forkSeat]: FORK_DECK } });
  open.push(t);
  await until(() => t.host.started && t.guests.every((g) => g.guest.started), 5000, 'the start');
  return t;
}

describe('M12-5a: manual adjustments approved by every other player', () => {
  it('a guest\'s proposal goes to the host and to the other guest, each described as they may know it; applied once both accepted', async () => {
    const t = await forkTable(2);
    const [gus, bianca] = t.guests as [Table['guests'][0], Table['guests'][0]];
    const bots = runBots(t, ['p2']);
    const hostProposals: ManualProposal[] = [];
    t.host.on('manualProposal', (p) => hostProposals.push(p));
    const v = await untilManual('p2', { view: () => gus.guest.view, legal: () => gus.guest.legal, act: (a) => gus.guest.act(a), synced: () => gus.guest.seq === t.host.seq });
    const hostCard = v.zones.hand['p1']![0]!; // an m4 alias of Gus's view
    const own = v.zones.hand['p2']![0]!;
    const answer = gus.guest.act({
      type: 'answer', player: 'p2', decisionId: v.pending!.id,
      answer: { kind: 'manualResolve', ops: [{ op: 'move', object: hostCard, to: 'exile' }, { op: 'move', object: own, to: 'graveyard' }, { op: 'life', player: 'p3', delta: -2 }] },
    });
    await until(() => hostProposals.length === 1 && of(bianca.inbox, 'manualProposal').length === 1 && of(gus.inbox, 'manualProposal').length === 1, 5000, 'the proposal everywhere');
    // The host reads its own card by name and Gus's as hidden (CR 400.2)...
    const h = hostProposals[0]!;
    expect(h.player).toBe('p2');
    expect(h.lines[0]).toMatch(/^Move (Forest|Grizzly Bears|Abzan Charm) \(Hana's hand\) to exile\.$/);
    expect(h.lines[1]).toBe('Move a hidden card (Gus\'s hand) to graveyard.');
    expect(h.lines[2]).toBe('Bianca\'s life -2.');
    expect([...h.waiting!].sort()).toEqual(['p1', 'p3']);
    // ...Bianca reads both hands' cards as hidden; Gus reads his own card by name. Nobody gets the raw operations.
    const b = of(bianca.inbox, 'manualProposal')[0]!.proposal as { lines: string[]; player: string };
    expect(b.player).toBe('p2');
    expect(b.lines).toEqual(['Move a hidden card (Hana\'s hand) to exile.', 'Move a hidden card (Gus\'s hand) to graveyard.', 'Bianca\'s life -2.']);
    const g = of(gus.inbox, 'manualProposal')[0]!.proposal as { lines: string[] };
    expect(g.lines[0]).toBe('Move a hidden card (Hana\'s hand) to exile.');
    expect(g.lines[1]).toMatch(/^Move (Mountain|Fork) \(Gus's hand\) to graveyard\.$/);
    for (const s of [bianca, gus]) expect(JSON.stringify(s.inbox.filter((m) => (m as Msg).type === 'manualProposal'))).not.toContain('"ops"');

    // The host accepts: still waiting for Bianca (everyone is told who is left).
    expect(t.host.answerManual(h.id, true)).toEqual({ ok: true });
    await until(() => of(bianca.inbox, 'manualProposal').length === 2, 3000, 'the update');
    expect((of(bianca.inbox, 'manualProposal')[1]!.proposal as { waiting: string[] }).waiting).toEqual(['p3']);
    expect(t.host.state!.zones.exile).toEqual([]); // nothing applied yet
    // Bianca accepts: applied as Gus's answer; Gus's action resolves; everyone hears it closed.
    expect(bianca.guest.proposal?.id).toBe(h.id);
    expect(bianca.guest.vote(h.id, true)).toBe(true);
    expect(await answer).toEqual({ ok: true });
    expect(t.host.state!.zones.exile).toHaveLength(1);
    expect(t.host.state!.players.find((p) => p.id === 'p3')!.life).toBe(18);
    await until(() => of(bianca.inbox, 'manualClosed').length === 1 && of(gus.inbox, 'manualClosed').length === 1, 3000, 'the close');
    expect(of(bianca.inbox, 'manualClosed')[0]).toMatchObject({ proposal: h.id, outcome: 'applied' });
    expect(bianca.guest.proposal).toBeNull();
    bots.stop();
  }, 60000);

  it('one rejection rejects it: the proposer is told who and why; an answer of the proposer itself, or a second answer, is refused', async () => {
    const t = await forkTable(2);
    const [gus, bianca] = t.guests as [Table['guests'][0], Table['guests'][0]];
    const bots = runBots(t, ['p2']);
    const closed: unknown[][] = [];
    t.host.on('manualClosed', (...a) => closed.push(a));
    const v = await untilManual('p2', { view: () => gus.guest.view, legal: () => gus.guest.legal, act: (a) => gus.guest.act(a), synced: () => gus.guest.seq === t.host.seq });
    const answer = gus.guest.act({ type: 'answer', player: 'p2', decisionId: v.pending!.id, answer: { kind: 'manualResolve', ops: [{ op: 'life', player: 'p1', delta: -5 }] } });
    await until(() => bianca.guest.proposal !== null && t.host.pendingManual !== null, 5000, 'the proposal');
    const id = t.host.pendingManual!.id;
    // Gus cannot answer his own proposal (his vote is refused by the host as an error).
    const errors: string[] = [];
    gus.guest.on('error', (e) => errors.push(e.message));
    gus.guest.vote(id, true);
    await until(() => errors.length === 1, 3000, 'the refusal');
    expect(errors[0]).toMatch(/your own adjustments/);
    expect(bianca.guest.vote(id, false, 'Fork does not do that')).toBe(true);
    expect(await answer).toEqual({ ok: false, error: { code: 'manualRejected', message: 'Bianca did not accept your manual adjustments: Fork does not do that', rules: [] } });
    expect(closed).toEqual([[id, 'rejected', 'p3', 'Fork does not do that']]);
    expect(t.host.answerManual(id, true)).toMatchObject({ ok: false, error: { code: 'manualRejected' } }); // answered already
    expect(t.host.state!.players.find((p) => p.id === 'p1')!.life).toBe(20);
    bots.stop();
  }, 60000);

  it('the host\'s own proposal needs every guest\'s approval too; a guest leaving the game no longer counts (CR 800.4a)', async () => {
    const t = await forkTable(1);
    const [gus, bianca] = t.guests as [Table['guests'][0], Table['guests'][0]];
    const bots = runBots(t, ['p1']);
    const pending: ManualProposal[] = [];
    const closed: unknown[][] = [];
    t.host.on('manualPending', (p) => pending.push(p));
    t.host.on('manualClosed', (...a) => closed.push(a));
    const v = await untilManual('p1', { view: () => t.host.view(), legal: () => t.host.legal(), act: async (a) => t.host.act(a), synced: () => true });
    expect(t.host.act({ type: 'answer', player: 'p1', decisionId: v.pending!.id, answer: { kind: 'manualResolve', ops: [{ op: 'life', player: 'p2', delta: -3 }] } })).toEqual({ ok: true });
    expect(pending).toHaveLength(1);
    expect([...pending[0]!.waiting!].sort()).toEqual(['p2', 'p3']);
    expect(t.host.state!.players.find((p) => p.id === 'p2')!.life).toBe(20); // nothing applied before every answer
    await until(() => gus.guest.proposal !== null && bianca.guest.proposal !== null, 3000, 'the proposal at the guests');
    expect(gus.guest.proposal!.lines).toEqual(['Gus\'s life -3.']);
    gus.guest.vote(pending[0]!.id, true);
    await until(() => pending.length === 2, 3000, 'Gus\'s answer');
    expect(pending[1]!.waiting).toEqual(['p3']);
    // Bianca leaves the game instead of answering (her concession, CR 104.3a): her answer is no longer needed, so it applies (CR 800.4a).
    expect((await bianca.guest.act({ type: 'concede', player: 'p3' })).ok).toBe(true);
    await until(() => closed.length === 1, 3000, 'the close');
    expect(closed[0]).toEqual([pending[0]!.id, 'applied', undefined, undefined]);
    expect(t.host.state!.players.find((p) => p.id === 'p2')!.life).toBe(17);
    bots.stop();
  }, 60000);
});

describe('ManualVotes (pure)', () => {
  it('every voter must accept; one rejection rejects; a voter who leaves no longer counts', () => {
    const v = new ManualVotes(1, 'p2', ['p1', 'p2', 'p3', 'p4']);
    expect(v.waiting).toEqual(['p1', 'p3', 'p4']);
    expect(v.vote('p2', true)).toBe('notVoter');
    expect(v.vote('p1', true)).toBe('pending');
    expect(v.vote('p1', true)).toBe('answered');
    expect(v.drop('p4')).toBe('pending');
    expect(v.vote('p3', true)).toBe('accepted');
    const w = new ManualVotes(2, 'p1', ['p1', 'p2', 'p3']);
    expect(w.vote('p3', false)).toBe('rejected');
    expect(w.done).toBe('rejected');
    expect(w.vote('p2', true)).toBe('answered');
  });
});
