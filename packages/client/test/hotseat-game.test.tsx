/**
 * A full scripted hot-seat game through LocalConnection and the game screen (docs/design/m8-client.md "Data flow", screens 6-8): who plays first
 * (CR 103.1), a mulligan (CR 103.5), lands (CR 305.1), a spell with a target (CR 601.2c, 115), combat with attacks and a block (CR 508, 509, 510), undo
 * of a land (CR 733.1 floor), and the end of the game (CR 104.3, 704.5a) with the game-over screen (branding slot 7) and a rematch.
 *
 * At every hand-off the pass cover must hide everything (CR 400.2: hands and libraries are hidden zones): no hand, no card name on screen; after the
 * click the next player sees their own hand by name and only a count of the other hand.
 */
import { act as reactAct, fireEvent, render, screen, within } from '@testing-library/react';
import { HIDDEN_DEF, type Action, type Decision, type GameView, type PlayerId } from '@openmtg/engine';
import { describe, expect, it } from 'vitest';
import { LocalConnection } from '../src/connection/LocalConnection';
import { localRematch } from '../src/game/services';
import { CARD_NAMES, hotSeatConfig, renderGameApp } from './game-fixtures';

const name = (v: GameView, id: PlayerId) => v.players.find((p) => p.id === id)!.name;
const nameOf = (v: GameView, id: string) => v.defs[v.objects[id]!.defId]?.name ?? '?';

interface Tally {
  covers: number;
  mulligans: number;
  lands: number;
  targetedSpells: number;
  attacks: number;
  blocks: number;
  undone: number;
}

/** The pass cover is up: nothing of the table is rendered, and no card name at all is on screen. */
function expectCoverHidesEverything(conn: LocalConnection): void {
  const v = conn.view();
  expect(v.viewer).toBeNull(); // the connection hands out a spectator view meanwhile
  const next = name(v, conn.handoff()!);
  expect(screen.getByRole('dialog', { name: `Pass to ${next}` })).toBeTruthy();
  expect(screen.queryByLabelText(/'s hand/)).toBeNull();
  expect(screen.queryByRole('region', { name: 'Prompt' })).toBeNull();
  const text = document.body.textContent ?? '';
  for (const card of CARD_NAMES) expect(text).not.toContain(card);
}

/** After the click: the shown player's hand by name, the other hand only as a count (CR 400.2). */
function expectOwnHandOnly(conn: LocalConnection): void {
  const v = conn.view();
  const me = v.viewer!;
  const other = v.players.find((p) => p.id !== me)!.id;
  const mine = v.zones.hand[me] ?? [];
  expect(mine.every((id) => v.objects[id]!.defId !== HIDDEN_DEF)).toBe(true);
  // C4's board: the own hand face up, each card named; the other hand as card backs with a count.
  const handList = screen.getByLabelText(`${name(v, me)}'s hand (${mine.length})`);
  expect([...handList.querySelectorAll('.board-card')].map((c) => c.getAttribute('aria-label'))).toEqual(mine.map((id) => nameOf(v, id)));
  const theirs = v.zones.hand[other] ?? [];
  expect(theirs.every((id) => v.objects[id]!.defId === HIDDEN_DEF)).toBe(true);
  const hidden = screen.getByLabelText(`${name(v, other)}'s hand: ${theirs.length} ${theirs.length === 1 ? 'card' : 'cards'}`);
  expect(hidden.querySelectorAll('[data-face="down"]')).toHaveLength(Math.min(10, theirs.length));
  for (const id of theirs) expect(hidden.querySelector(`.board-card[data-object-id="${id}"]`)).toBeNull();
}

function ownMainPhase(v: GameView, me: PlayerId): boolean {
  return v.turn.activePlayer === me && (v.turn.step === 'main1' || v.turn.step === 'main2') && v.zones.stack.length === 0;
}

/** The scripted players: Alice mulligans once; both play a land and cast what they can in their main phases; Alice's Test Shock targets a Bear when
 * there is one, else Bob; everyone attacks with everything; Bob blocks once. */
function choose(conn: LocalConnection, d: Decision, t: Tally): Action {
  const v = conn.view();
  const me = d.player;
  const answer = (a: Extract<Action, { type: 'answer' }>['answer']): Action => ({ type: 'answer', player: me, decisionId: d.id, answer: a });
  switch (d.kind) {
    case 'playFirst':
      return answer({ kind: 'playFirst', player: 'p1' });
    case 'mulligan': {
      const again = me === 'p1' && t.mulligans === 0;
      if (again) t.mulligans++;
      return answer({ kind: 'mulligan', keep: !again });
    }
    case 'chooseObjects':
      return answer({ kind: 'chooseObjects', ids: d.options.slice(0, d.min) });
    case 'payCost':
      return answer({ kind: 'payCost', auto: true });
    case 'chooseTargets': {
      const bear = d.objects.find((id) => v.objects[id]?.controller !== me);
      t.targetedSpells++;
      return answer({ kind: 'chooseTargets', targets: [bear ? { kind: 'object', id: bear } : { kind: 'player', id: d.players.find((p) => p !== me)! }] });
    }
    case 'declareAttackers': {
      const attacks = d.candidates.map((c) => ({ attacker: c.id, defender: c.defenders.find((x) => v.players.some((p) => p.id === x))! }));
      t.attacks += attacks.length;
      return answer({ kind: 'declareAttackers', attacks });
    }
    case 'declareBlockers': {
      const c = d.candidates.find((x) => x.attackers.length > 0);
      if (t.blocks === 0 && c) {
        t.blocks++;
        return answer({ kind: 'declareBlockers', blocks: [{ blocker: c.id, attacker: c.attackers[0]! }] });
      }
      return answer({ kind: 'declareBlockers', blocks: [] });
    }
    case 'priority': {
      const legal = conn.legalActions();
      if (ownMainPhase(v, me)) {
        const land = legal.find((l) => l.kind === 'playLand');
        if (land) return land.action;
        const cast = legal.find((l) => l.kind === 'cast');
        if (cast) return cast.action;
      }
      return { type: 'pass', player: me };
    }
    default:
      throw new Error(`The script has no answer for ${d.kind}: ${d.prompt}`);
  }
}

async function send(conn: LocalConnection, a: Action): Promise<void> {
  let r: Awaited<ReturnType<LocalConnection['act']>> | undefined;
  await reactAct(async () => {
    r = await conn.act(a);
  });
  if (!r!.ok) throw new Error(`${a.type} rejected: ${r!.error.message}`);
}

describe('a scripted hot-seat game (C7)', () => {
  it('CR 103-104, 704.5a, 400.2: drives a whole game through LocalConnection to a win on life with the screen rendered; the pass cover hides every hand at every hand-off', async () => {
    const conn = new LocalConnection(hotSeatConfig('c7-hotseat'));
    render(renderGameApp(conn, undefined, localRematch(conn.session.config, () => 'c7-hotseat-rematch')));
    const t: Tally = { covers: 0, mulligans: 0, lands: 0, targetedSpells: 0, attacks: 0, blocks: 0, undone: 0 };

    for (let i = 0; i < 4000 && !conn.view().result; i++) {
      if (conn.handoff()) {
        expectCoverHidesEverything(conn);
        const next = name(conn.view(), conn.handoff()!);
        fireEvent.click(screen.getByRole('button', { name: `I am ${next}: continue` }));
        t.covers++;
        expectOwnHandOnly(conn);
        continue;
      }
      const d = conn.view().pending!;
      expect(d.player).toBe(conn.view().viewer);
      const a = choose(conn, d, t);
      await send(conn, a);
      if (a.type === 'playLand') {
        t.lands++;
        // CR 733.1: playing a land shows nothing hidden, so the player may take it back (Z) and play it again.
        if (t.undone === 0) {
          expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(false);
          fireEvent.keyDown(window, { key: 'z' });
          expect(conn.view().zones.hand[a.player]).toContain(a.card);
          t.undone++;
          await send(conn, a);
        }
      }
    }

    const v = conn.view();
    expect(v.result).not.toBeNull();
    expect(v.result!.winner).not.toBeNull(); // not a draw (CR 104.4a)
    expect(v.players.find((p) => p.id !== v.result!.winner)!.lostReason).toBe('has 0 or less life'); // CR 704.5a
    expect(t.mulligans).toBe(1);
    expect(v.players.find((p) => p.id === 'p1')!.mulligans).toBe(1);
    expect(t.lands).toBeGreaterThan(2);
    expect(t.targetedSpells).toBeGreaterThan(0);
    expect(t.attacks).toBeGreaterThan(0);
    expect(t.blocks).toBe(1);
    expect(t.undone).toBe(1);
    expect(t.covers).toBeGreaterThan(4);

    // Game over (branding slot 7): the result, then a rematch opens a fresh game behind a new pass cover.
    const over = screen.getByRole('region', { name: 'Game over' });
    const winner = v.result!.winner;
    expect(within(over).getByRole('heading', { level: 2 }).textContent).toBe(winner ? `${name(v, winner)} wins` : 'The game is a draw');
    expect(within(over).getByText(v.result!.reason)).toBeTruthy();
    expect(within(over).getByAltText('DigiDice logo')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true); // CR 104.1: a finished game is never undone
    expect(screen.queryByRole('button', { name: 'Concede' })).toBeNull();
    fireEvent.click(within(over).getByRole('button', { name: 'Rematch' }));
    expect(screen.queryByRole('region', { name: 'Game over' })).toBeNull();
    expect(screen.getByRole('dialog', { name: /^Pass to (Alice|Bob)$/ })).toBeTruthy();
    expect(screen.queryByText('Start of the game')).toBeNull(); // the cover hides even the turn
  }, 120_000); // the real board (C4) and prompt bar (C5) render every view of a whole game
});
