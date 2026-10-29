/** F30: a listener that throws is reported and swallowed (it was rethrown in a microtask: an uncaught exception that ended the host's process). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../src/game/emitter';

class Thing extends Emitter<{ tick: [n: number] }> {
  fire(n: number): void {
    this.emit('tick', n);
  }
}

afterEach(() => vi.restoreAllMocks());

describe('Emitter (F30)', () => {
  it('a throwing listener is logged or handed to onListenerError, never rethrown; the other listeners still run', async () => {
    const uncaught: unknown[] = [];
    const onUncaught = (e: unknown) => uncaught.push(e);
    process.on('uncaughtException', onUncaught);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const t = new Thing();
      const seen: number[] = [];
      t.on('tick', () => {
        throw new Error('listener bug');
      });
      t.on('tick', (n) => seen.push(n));
      expect(() => t.fire(1)).not.toThrow();
      expect(seen).toEqual([1]);
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0]![0])).toMatch(/"tick" threw/);
      const handled: [unknown, string][] = [];
      t.onListenerError((e, event) => handled.push([e, event]));
      t.fire(2);
      expect(seen).toEqual([1, 2]);
      expect(handled).toHaveLength(1);
      expect(handled[0]![1]).toBe('tick');
      expect((handled[0]![0] as Error).message).toBe('listener bug');
      expect(log).toHaveBeenCalledTimes(1); // handled: not logged
      await new Promise((r) => setTimeout(r, 10)); // past any microtask
      expect(uncaught).toEqual([]);
    } finally {
      process.off('uncaughtException', onUncaught);
    }
  });
});
