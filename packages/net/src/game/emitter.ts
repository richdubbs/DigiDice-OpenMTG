/** A minimal typed event emitter (listeners run in registration order; one that throws does not stop the others). */
export class Emitter<E extends { [K in keyof E]: unknown[] }> {
  private readonly listeners: { [K in keyof E]?: ((...args: E[K]) => void)[] } = {};

  /** Listen to an event; returns a function that removes the listener. */
  on<K extends keyof E>(event: K, fn: (...args: E[K]) => void): () => void {
    (this.listeners[event] ??= []).push(fn);
    return () => {
      const ls = this.listeners[event];
      if (ls) ls.splice(ls.indexOf(fn) >>> 0, 1);
    };
  }

  protected emit<K extends keyof E>(event: K, ...args: E[K]): void {
    for (const fn of [...(this.listeners[event] ?? [])]) {
      try {
        fn(...args);
      } catch (e) {
        queueMicrotask(() => {
          throw e;
        });
      }
    }
  }
}
