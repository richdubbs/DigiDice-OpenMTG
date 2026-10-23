/**
 * RPL-2 (replays design 8, "Pacing"): the replay's clock. It starts the next change once the pacer has shown the previous one, plus a dwell per kind of
 * change divided by the speed; real time waits the players' own pauses, capped at 3 s; a jump is shown at once (the pacer is flushed); at the end the
 * replay stops.
 */
import { describe, expect, it } from 'vitest';
import { createReplayConnection, type ReplayConnection, type ReplayPacer } from '../../src/connection/ReplayConnection';
import { aiGame, instantChecker as instant, ManualTimers, replayFileOf, TEST_BUILD } from './replay-files';


/** A pacer that is busy with every change that has events until the test finishes its animation. */
class FakePacer implements ReplayPacer {
  animating = false;
  flushes = 0;
  private readonly listeners = new Set<() => void>();

  constructor(conn: ReplayConnection) {
    let seq = conn.events().seq;
    conn.subscribe(() => {
      const b = conn.events();
      if (b.seq !== seq && b.events.length > 0) this.animating = true;
      seq = b.seq;
    });
  }

  busy(): boolean {
    return this.animating;
  }

  flush(): void {
    this.flushes++;
    this.done();
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  done(): void {
    this.animating = false;
    for (const l of [...this.listeners]) l();
  }
}

async function setup(opts: Parameters<typeof replayFileOf>[1] = {}) {
  const g = aiGame('rpl2-clock', 0, 1, 400);
  const timers = new ManualTimers();
  const conn = createReplayConnection(replayFileOf(g, opts), { engineBuild: TEST_BUILD, timers, checker: instant, sliceMs: 1000 });
  await Promise.resolve();
  await Promise.resolve();
  timers.runAll(); // the background indexing
  await conn.controller.ready();
  const pacer = new FakePacer(conn);
  conn.controller.attachPacer(pacer);
  return { g, timers, conn, c: conn.controller, pacer };
}

describe('RPL-2: the replay clock (replays design 8)', { timeout: 300_000 }, () => {
  it('waits the dwell of the change on screen, steps, waits for the pacer to show it, then the next dwell', async () => {
    const { timers, c, pacer, conn } = await setup();
    expect(timers.pending).toBe(0);
    c.play();
    expect(c.state().playing).toBe(true);
    // The new game is a turn start: 1,000 ms at 1x.
    expect(timers.nextDelay()).toBe(1000);
    let steps = 0;
    for (let i = 0; i < 30; i++) {
      const before = c.state().position;
      expect(timers.fireNext()).toBe(true);
      expect(c.state().position).toBe(before + 1);
      steps++;
      if (conn.events().events.length > 0) {
        // The pacer is animating the change: the clock waits for it, with no timer of its own.
        expect(pacer.busy()).toBe(true);
        expect(timers.pending).toBe(0);
        pacer.done();
      }
      expect(timers.pending).toBe(1);
      expect([400, 700, 1000]).toContain(timers.nextDelay());
    }
    expect(steps).toBe(30);
    // A step forward is animated (no flush); a jump is shown at once (the pacer is flushed).
    expect(pacer.flushes).toBe(0);
    c.seek(5);
    expect(pacer.flushes).toBe(1);
    expect(c.state().playing).toBe(true);
    c.pause();
    expect(timers.pending).toBe(0);
    c.dispose();
  });

  it('the dwell is divided by the speed; a new speed takes effect at once', async () => {
    const { timers, c } = await setup();
    c.setSpeed(4);
    c.play();
    expect(timers.nextDelay()).toBe(250);
    c.setSpeed(0.25);
    expect(timers.pending).toBe(1);
    expect(timers.nextDelay()).toBe(4000);
    c.setSpeed(16);
    expect(timers.nextDelay()).toBe(62.5);
    c.dispose();
  });

  it('real time waits the gap between the two actions\' times in the file, capped at 3 s', async () => {
    const gaps = (i: number) => [500, 9000, 1200, 2999][i % 4]!;
    const { timers, c, pacer } = await setup({ gapMs: gaps });
    c.setSpeed('real');
    c.play();
    for (let p = 0; p < 12; p++) {
      // Waiting at position p for the action that leads to p + 1: the gap between action p - 1 and action p.
      expect(timers.nextDelay(), `at ${p}`).toBe(Math.min(3000, gaps(p)));
      timers.fireNext();
      if (pacer.busy()) pacer.done();
    }
    c.dispose();
  });

  it('plays to the end and stops; Play at the end starts again from the start', async () => {
    const { timers, c, pacer, g } = await setup();
    c.setSpeed(16);
    c.seek(g.actions.length - 3);
    c.play();
    for (let i = 0; i < 10 && c.state().playing; i++) {
      timers.fireNext();
      if (pacer.busy()) pacer.done();
    }
    expect(c.state().position).toBe(g.actions.length);
    expect(c.state().playing).toBe(false);
    expect(timers.pending).toBe(0);
    c.play();
    expect(c.state().position).toBe(0);
    expect(c.state().playing).toBe(true);
    c.dispose();
  });
});
