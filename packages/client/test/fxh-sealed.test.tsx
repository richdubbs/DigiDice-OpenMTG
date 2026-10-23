/**
 * FXH (audit 2026-10-12 m5, CR 400.2): the hot-seat game screen and everything it renders hold only the sealed connection (game/sealed.ts), never the
 * LocalConnection or the GameSession behind it, so the other player's hand and the libraries can't be read from React props or state (React DevTools, the
 * `__reactProps`/`__reactFiber` keys of a DOM node). The only game data in the tree is the shown player's `viewFor`.
 */
import { act as reactAct, fireEvent, render, screen } from '@testing-library/react';
import { GameSession, HIDDEN_DEF, type GameView } from '@openmtg/engine';
import { describe, expect, it } from 'vitest';
import { LocalConnection } from '../src/connection/LocalConnection';
import { ComputerGame } from '../src/game/computer';
import { sealConnection } from '../src/game/sealed';
import { hotSeatConfig, renderGameApp } from './game-fixtures';

/** Whether `x` is (or holds, a few levels down) something that would give away the whole game. */
function leaks(x: unknown, seen = new Set<unknown>(), depth = 0): string | null {
  if (x === null || typeof x !== 'object' || seen.has(x) || depth > 8) return null;
  seen.add(x);
  if (x instanceof LocalConnection) return 'a LocalConnection';
  if (x instanceof ComputerGame) return 'a ComputerGame';
  if (x instanceof GameSession) return 'a GameSession';
  if (typeof Node !== 'undefined' && x instanceof Node) return null;
  const o = x as Record<string, unknown>;
  if ('rng' in o && 'zones' in o && 'objects' in o) return 'a raw game state';
  if ('stateNode' in o && 'return' in o) return null; // another fiber: scanned on its own
  for (const v of Object.values(o)) {
    const hit = leaks(v, seen, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/** Every fiber above every DOM node of the page. */
function fibers(): object[] {
  const out = new Set<object>();
  for (const el of document.body.querySelectorAll('*')) {
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    let f = key ? ((el as unknown as Record<string, unknown>)[key] as { return: unknown } | null) : null;
    while (f && !out.has(f)) {
      out.add(f);
      f = f.return as { return: unknown } | null;
    }
  }
  return [...out];
}

/** What any component of the tree holds: its props and its hooks' state. */
function treeLeak(): string | null {
  for (const f of fibers() as { memoizedProps?: unknown; memoizedState?: unknown; type?: { name?: string } }[]) {
    const hit = leaks(f.memoizedProps) ?? leaks(f.memoizedState);
    if (hit) return `${hit} in ${typeof f.type === 'function' ? f.type.name : String(f.type)}`;
  }
  return null;
}

/** Every view object any component holds: none of them names a card of the other player's hand. */
function viewsInTree(): GameView[] {
  const views: GameView[] = [];
  const collect = (x: unknown, seen: Set<unknown>, depth: number): void => {
    if (x === null || typeof x !== 'object' || seen.has(x) || depth > 6) return;
    seen.add(x);
    const o = x as Record<string, unknown>;
    if ('stateNode' in o && 'return' in o) return;
    if ('viewer' in o && 'zones' in o && 'objects' in o) views.push(x as GameView);
    for (const v of Object.values(o)) collect(v, seen, depth + 1);
  };
  const seen = new Set<unknown>();
  for (const f of fibers() as { memoizedProps?: unknown; memoizedState?: unknown }[]) {
    collect(f.memoizedProps, seen, 0);
    collect(f.memoizedState, seen, 0);
  }
  return views;
}

describe('sealConnection (audit m5, CR 400.2)', () => {
  it('has only the GameConnection members, each a function, is frozen, and is the same object on every call', () => {
    const conn = new LocalConnection(hotSeatConfig('fxh-seal'));
    const sealed = sealConnection(conn);
    expect(Object.isFrozen(sealed)).toBe(true);
    // ui/arena: `events` (the redacted event feed for the board's animations) is a GameConnection member too.
    expect(Object.keys(sealed).sort()).toEqual(['acceptHandoff', 'act', 'canUndo', 'events', 'handoff', 'kind', 'legalActions', 'seated', 'subscribe', 'undo', 'view']);
    expect(Object.entries(sealed).every(([k, v]) => (k === 'kind' ? v === 'local' : typeof v === 'function'))).toBe(true);
    expect(leaks(sealed)).toBeNull();
    expect(sealConnection(conn)).toBe(sealed);
    expect(sealConnection(sealed)).toBe(sealed);
    expect(sealed.view()).toBe(conn.view());
    expect(sealed.handoff()).toBe(conn.handoff());
  });

  it('forwards actions, subscriptions, the hand-off and undo to the connection', async () => {
    const conn = new LocalConnection(hotSeatConfig('fxh-forward'));
    const sealed = sealConnection(conn);
    let calls = 0;
    const off = sealed.subscribe(() => calls++);
    const first = sealed.handoff()!;
    sealed.acceptHandoff();
    expect(conn.view().viewer).toBe(first);
    const d = sealed.view().pending!;
    expect(d.player).toBe(first);
    const r = await sealed.act({ type: 'concede', player: first });
    expect(r.ok).toBe(true);
    expect(calls).toBeGreaterThan(0);
    expect(sealed.view().result).not.toBeNull();
    off();
  });

  it('a hot-seat game screen holds nothing but the shown player\'s view: no connection, session or raw state in any prop or state', async () => {
    const conn = new LocalConnection(hotSeatConfig('fxh-tree'));
    render(renderGameApp(sealConnection(conn)));
    expect(treeLeak()).toBeNull(); // behind the pass cover
    await reactAct(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /^I am / }));
    });
    const me = conn.view().viewer!;
    const other = conn.view().players.find((p) => p.id !== me)!.id;
    expect(treeLeak()).toBeNull();
    const views = viewsInTree();
    expect(views.length).toBeGreaterThan(0);
    expect(views.some((v) => v.viewer === me)).toBe(true);
    for (const v of views) {
      expect([me, null]).toContain(v.viewer); // the shown player's view, or the spectator view of the cover before it
      expect((v.zones.hand[other] ?? []).every((id) => v.objects[id]!.defId === HIDDEN_DEF)).toBe(true);
      expect(v.zones.library[other]!.every((id) => v.objects[id]!.defId === HIDDEN_DEF)).toBe(true);
    }
  });

  it('a raw connection handed straight to the game screen is sealed before anything below the screen sees it', async () => {
    const conn = new LocalConnection(hotSeatConfig('fxh-raw'));
    render(renderGameApp(conn));
    await reactAct(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /^I am / }));
    });
    type Fiber = { memoizedProps?: unknown; memoizedState?: unknown; type?: unknown; return: Fiber | null };
    const nameOf = (f: Fiber) => (typeof f.type === 'function' ? f.type.name : '');
    const below = (f: Fiber): boolean => {
      for (let a: Fiber | null = f; a; a = a.return) if (nameOf(a) === 'GameTable') return true;
      return false;
    };
    const inside = (fibers() as Fiber[]).filter(below);
    expect(inside.length).toBeGreaterThan(10);
    // The route holders above the screen (the test's nav provider and shell, the GameScreen wrapper) see the raw connection; nothing the screen renders does.
    expect(inside.filter((f) => leaks(f.memoizedProps) ?? leaks(f.memoizedState)).map(nameOf)).toEqual([]);
  });
});
