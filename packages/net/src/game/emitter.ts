/**
 * A minimal typed event emitter (listeners run in registration order; one that throws does not stop the others).
 *
 * F30: a listener's exception is reported and swallowed here, never rethrown: it was rethrown in a microtask, which is an uncaught exception that
 * ends the host's process (every guest's game with it) for a bug in one UI listener. It goes to the handler given to `onListenerError` if there is
 * one, else to console.error. (A separate hook, not an 'error' event: GameGuest's 'error' event carries the host's protocol errors, a different type.)
 */
export type ListenerErrorHandler = (error: unknown, event: string) => void;

export class Emitter<E extends { [K in keyof E]: unknown[] }> {
  private readonly listeners: { [K in keyof E]?: ((...args: E[K]) => void)[] } = {};
  private listenerError: ListenerErrorHandler | null = null;

  /** Listen to an event; returns a function that removes the listener. */
  on<K extends keyof E>(event: K, fn: (...args: E[K]) => void): () => void {
    (this.listeners[event] ??= []).push(fn);
    return () => {
      const ls = this.listeners[event];
      if (ls) ls.splice(ls.indexOf(fn) >>> 0, 1);
    };
  }

  /** F30: where an exception thrown by a listener goes (null: console.error). */
  onListenerError(handler: ListenerErrorHandler | null): void {
    this.listenerError = handler;
  }

  protected emit<K extends keyof E>(event: K, ...args: E[K]): void {
    for (const fn of [...(this.listeners[event] ?? [])]) {
      try {
        fn(...args);
      } catch (e) {
        this.reportListenerError(e, String(event));
      }
    }
  }

  private reportListenerError(error: unknown, event: string): void {
    const handler = this.listenerError;
    if (handler) {
      try {
        handler(error, event);
        return;
      } catch (e) {
        console.error(`openmtg: the listener error handler failed on "${event}":`, e);
      }
    }
    console.error(`openmtg: a listener of "${event}" threw (ignored, the game goes on):`, error);
  }
}
